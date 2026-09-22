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
# PORT se předává pm2 a --update-env ho vynutí i na už běžícím procesu.
# Bez toho by v pm2 mohl zůstat port z dřívějška; server.mjs dává prostředí
# přednost před .env, takže by ho .env nepřebilo a proces by padal na
# EADDRINUSE. startOrRestart navíc znovu přečte ecosystem.config.cjs.
$SSH "$VPS" "chown -R jhnapps:jhnapps $DIR && su - jhnapps -c 'cd $DIR && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -1 && PORT=$PORT pm2 startOrRestart deploy/ecosystem.config.cjs --update-env && pm2 save'"

# Naslouchá na $PORT opravdu náš proces? pm2 hlásí "online" i u aplikace,
# která se po startu v kruhu restartuje.
sleep 3
NAS_PID=$($SSH "$VPS" "su - jhnapps -c 'pm2 pid famicura-ring' 2>/dev/null | tr -d '\r'" || true)
PORT_PID=$($SSH "$VPS" "ss -ltnp 2>/dev/null | grep ':$PORT ' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2" || true)
if [ -z "$PORT_PID" ] || [ "$PORT_PID" != "$NAS_PID" ]; then
  echo
  echo "Aplikace neposlouchá na portu $PORT (pm2 pid ${NAS_PID:-?}, na portu ${PORT_PID:-nikdo})."
  $SSH "$VPS" "su - jhnapps -c 'pm2 logs famicura-ring --lines 15 --nostream --err'" || true
  echo
  echo "Častá příčina: v /opt/famicura-ring/.env je jiný PORT, nebo port drží někdo jiný."
  exit 1
fi
$SSH "$VPS" "su - jhnapps -c 'curl -s localhost:$PORT/api/health'"
echo

# Na localhost odpovídáme vždycky; na veřejné adrese nemusíme, když pro ni
# v Caddy chybí blok a hostname spadne na sousední aplikaci. Odpověď proto
# musí být naše - poznáme to podle "aplikace":"famicura-ring".
VEREJNA="${VEREJNA:-https://famicuraring.95-216-201-2.sslip.io}"
ODPOVED=$(curl -s -m 15 "$VEREJNA/api/health" || true)
case "$ODPOVED" in
  *'"aplikace":"famicura-ring"'*)
    echo "Veřejná adresa $VEREJNA odpovídá správně."
    ;;
  *)
    echo
    echo "POZOR: na $VEREJNA neodpovídá tahle aplikace."
    echo "Vrátilo se: ${ODPOVED:-(nic)}"
    echo
    echo "V /etc/caddy/Caddyfile nejspíš chybí blok z deploy/Caddyfile.snippet,"
    echo "nebo míří na cizí port (3099 pecedoma-sestra, 3101 datec, náš $PORT)."
    echo "Zkontrolovat:"
    echo "  ssh -i $KEY $VPS \"grep -n -A3 famicuraring /etc/caddy/Caddyfile\""
    echo "Po opravě:"
    echo "  ssh -i $KEY $VPS \"caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy\""
    exit 1
    ;;
esac

echo "Hotovo. Log: ssh -i $KEY $VPS \"su - jhnapps -c 'pm2 logs famicura-ring --lines 50'\""
