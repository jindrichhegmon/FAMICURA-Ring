#!/usr/bin/env bash
# Nasazení / aktualizace SQL části Famicura Ring na VPS (spouštět z Macu ve složce projektu):  ./deploy/vps-deploy.sh
# Poprvé: na VPS vytvořit /opt/famicura-ring/.env podle .env.example a přidat blok z deploy/Caddyfile.snippet.
set -e
VPS="${VPS:-root@95.216.201.2}"
KEY="${KEY:-$HOME/.ssh/id_ed25519_jhnapps}"
DIR=/opt/famicura-ring
PORT="${PORT:-3111}"
SSH="ssh -i $KEY -o BatchMode=yes"

# Port si smí držet jen tahle aplikace. Jinak by se níže ptalo na /api/health
# cizí aplikace a vypadalo by to, že je vše v pořádku.
# Porovnává se PID, ne jméno procesu – ss ho zkracuje na 15 znaků, takže
# "node /opt/famicura-ring" se ve výpisu nikdy celé neobjeví.
PORT_PID=$($SSH "$VPS" "ss -ltnp 2>/dev/null | grep ':$PORT ' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2" || true)
if [ -n "$PORT_PID" ]; then
  NASE_PID=$($SSH "$VPS" "su - jhnapps -c 'pm2 pid famicura-ring' 2>/dev/null | tr -d '\r'" || true)
  if [ "$PORT_PID" != "$NASE_PID" ]; then
    echo "Port $PORT na $VPS drží jiná aplikace (pid $PORT_PID):"
    $SSH "$VPS" "ss -ltnp | grep ':$PORT '" || true
    echo
    echo "Vyberte volný port, přepište PORT v /opt/famicura-ring/.env"
    echo "i v deploy/Caddyfile.snippet a spusťte:  PORT=<cislo> ./deploy/vps-deploy.sh"
    exit 1
  fi
fi

cd "$(dirname "$0")/.."
# verze.json: co přesně se nasazuje (commit, větev, čas) – server ji vrací v /api/health
printf '{"commit":"%s","vetev":"%s","nasazeno":"%s"}\n' "$(git rev-parse --short HEAD 2>/dev/null || echo ?)" "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ?)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > verze.json
$SSH "$VPS" "mkdir -p $DIR && chown jhnapps:jhnapps $DIR"
rsync -az -e "$SSH" --exclude node_modules --exclude .git --exclude .DS_Store --exclude .env --exclude .netlify ./ "$VPS:$DIR/"
$SSH "$VPS" "chown -R jhnapps:jhnapps $DIR && su - jhnapps -c 'cd $DIR && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -1 && (pm2 restart famicura-ring --update-env 2>/dev/null || pm2 start deploy/ecosystem.config.cjs) && pm2 save && sleep 2 && curl -s localhost:$PORT/api/health'"
echo
echo "Hotovo. Log: ssh -i $KEY $VPS \"su - jhnapps -c 'pm2 logs famicura-ring --lines 50'\""
