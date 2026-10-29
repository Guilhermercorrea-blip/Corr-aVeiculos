#!/usr/bin/env bash
# Instala o sistema da Corrêa Veículos num servidor Ubuntu (Oracle Cloud Always Free).
# Rodar no servidor, de dentro da pasta enviada:  sudo bash nuvem/instalar.sh
# Pode rodar de novo para atualizar: os dados em /var/lib/correa ficam intactos.
set -euo pipefail

APP=/opt/correa-veiculos
DADOS=/var/lib/correa/data
ORIGEM="$(cd "$(dirname "$0")/.." && pwd)"

# Endereço com HTTPS grátis: o IP público vira um nome em sslip.io (ex.: 129-148-1-2.sslip.io)
IP_PUBLICO="${IP_PUBLICO:-$(curl -fsS https://ifconfig.me)}"
DOMINIO="${DOMINIO:-${IP_PUBLICO//./-}.sslip.io}"
echo ">> Endereço do sistema: https://$DOMINIO"

# Servidor grátis pequeno (E2.1.Micro tem 1 GB): cria 2 GB de memória extra em disco para a instalação não travar
if [[ ! -f /swapfile ]] && (( $(awk '/MemTotal/ {print $2}' /proc/meminfo) < 2000000 )); then
  echo ">> Criando 2 GB de swap"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo ">> Instalando Node.js 24 e Caddy (HTTPS automático)"
apt-get update -y
echo iptables-persistent iptables-persistent/autosave_v4 boolean true | debconf-set-selections
echo iptables-persistent iptables-persistent/autosave_v6 boolean true | debconf-set-selections
DEBIAN_FRONTEND=noninteractive apt-get install -y curl rsync ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https iptables-persistent
if ! command -v node >/dev/null || [[ "$(node -v)" != v24* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo ">> Liberando as portas 80 e 443 no firewall do Ubuntu"
# A imagem da Oracle tem uma regra REJECT no fim: a liberação precisa entrar ANTES dela
for porta in 80 443; do
  if ! iptables -C INPUT -p tcp --dport "$porta" -m state --state NEW -j ACCEPT 2>/dev/null; then
    posicao=$(iptables -L INPUT -n --line-numbers | awk '/REJECT/ {print $1; exit}')
    iptables -I INPUT "${posicao:-1}" -p tcp --dport "$porta" -m state --state NEW -j ACCEPT
  fi
done
netfilter-persistent save

echo ">> Copiando o sistema para $APP"
id correa >/dev/null 2>&1 || useradd --system --home /var/lib/correa --shell /usr/sbin/nologin correa
mkdir -p "$APP" "$DADOS" /var/lib/correa/backups
rsync -a --delete --exclude data --exclude node_modules --exclude nuvem/dados-para-enviar "$ORIGEM"/ "$APP"/
cd "$APP" && npm ci --omit=dev

# Dados enviados do notebook (só na primeira vez: não sobrescreve um banco que já existe)
if [[ -f "$ORIGEM/nuvem/dados-para-enviar/loja.db" && ! -f "$DADOS/loja.db" ]]; then
  echo ">> Importando os dados do notebook"
  cp "$ORIGEM/nuvem/dados-para-enviar/loja.db" "$DADOS/loja.db"
  [[ -d "$ORIGEM/nuvem/dados-para-enviar/anexos" ]] && cp -r "$ORIGEM/nuvem/dados-para-enviar/anexos" "$DADOS/"
fi
chown -R correa:correa /var/lib/correa
chmod 700 /var/lib/correa
chown correa:correa "$APP/CHAVE-API-CLAUDE.txt" 2>/dev/null || true
chmod 600 "$APP/CHAVE-API-CLAUDE.txt" 2>/dev/null || true

echo ">> Criando o serviço (liga sozinho e reinicia se cair)"
cat > /etc/systemd/system/correa-veiculos.service <<EOF
[Unit]
Description=Sistema Correa Veiculos
After=network.target

[Service]
User=correa
WorkingDirectory=$APP
Environment=PORT=3000
Environment=PASTA_DADOS=$DADOS
Environment=ENDERECO_PUBLICO=https://$DOMINIO
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

echo ">> Configurando HTTPS para $DOMINIO"
cat > /etc/caddy/Caddyfile <<EOF
$DOMINIO {
  encode gzip
  request_body {
    max_size 30MB
  }
  reverse_proxy 127.0.0.1:3000
}
EOF

echo ">> Backup diário às 3h da manhã (guarda 30 dias)"
cat > /etc/cron.d/correa-backup <<EOF
0 3 * * * correa cd $APP && PASTA_DADOS=$DADOS /usr/bin/node backup.js /var/lib/correa/backups >> /var/lib/correa/backup.log 2>&1
EOF

systemctl daemon-reload
systemctl enable --now correa-veiculos
systemctl restart correa-veiculos
systemctl reload caddy || systemctl restart caddy

echo
echo "================================================================"
echo " Pronto! Abra no navegador:  https://$DOMINIO"
echo " Backups diários em /var/lib/correa/backups"
echo "================================================================"
