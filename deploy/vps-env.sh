#!/usr/bin/env bash
# Doplní tajné hodnoty do /opt/famicura-ring/.env na VPS. Spouštět z Macu ve složce projektu:
#   ./deploy/vps-env.sh
#
# SQL_PASSWORD se převezme přímo na serveru z aplikace se stejným SQL
# serverem i uživatelem (clb1_app), takže nikudy necestuje. RING_HMAC_KEY
# musí být stejný jako v Netlify – na ten se skript zeptá; hodnota jde do
# ssh přes stdin, ne na příkazovou řádku, a v historii ani ve výpisu
# procesů se neobjeví.
set -e
VPS="${VPS:-root@95.216.201.2}"
KEY="${KEY:-$HOME/.ssh/id_ed25519_jhnapps}"
DIR=/opt/famicura-ring
PORT="${PORT:-3111}"
SQL_ZDROJ="${SQL_ZDROJ:-/opt/pecedoma-sestra/.env}"
SSH="ssh -i $KEY -o BatchMode=yes"
JAKO="su - jhnapps -c"

cd "$(dirname "$0")/.."
# Pomocník musí být na VPS i tehdy, když se od posledního nasazení změnil.
rsync -az -e "$SSH" scripts/set-env.mjs "$VPS:$DIR/scripts/"
$SSH "$VPS" "chown jhnapps:jhnapps $DIR/scripts/set-env.mjs"

echo "Před:"
$SSH "$VPS" "$JAKO 'cd $DIR && node scripts/set-env.mjs stav'"
echo

$SSH "$VPS" "$JAKO 'cd $DIR && node scripts/set-env.mjs prevezmi SQL_PASSWORD $SQL_ZDROJ'" || {
  echo "Heslo se převzít nepodařilo – zadejte ho ručně."
  read -rs -p "SQL_PASSWORD: " H; echo
  printf '%s' "$H" | $SSH "$VPS" "$JAKO 'cd $DIR && node scripts/set-env.mjs nastav SQL_PASSWORD'"
  unset H
}

echo "RING_HMAC_KEY najdete v Netlify: Site configuration → Environment variables."
read -rs -p "RING_HMAC_KEY (Enter = nechat, jak je): " K; echo
if [ -n "$K" ]; then
  printf '%s' "$K" | $SSH "$VPS" "$JAKO 'cd $DIR && node scripts/set-env.mjs nastav RING_HMAC_KEY'"
fi
unset K

echo
echo "Po:"
$SSH "$VPS" "$JAKO 'cd $DIR && node scripts/set-env.mjs stav'"

# server.mjs čte .env jen při startu.
$SSH "$VPS" "$JAKO 'cd $DIR && PORT=$PORT pm2 startOrRestart deploy/ecosystem.config.cjs --update-env >/dev/null && pm2 save >/dev/null'"
echo
echo "Aplikace restartována. Tabulky:"
echo "  ssh -i $KEY $VPS \"$JAKO 'cd $DIR && node scripts/init-db.mjs'\""
