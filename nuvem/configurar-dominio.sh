#!/usr/bin/env bash
# Executar somente depois de registrar o domínio e apontar o DNS.
set -euo pipefail

[[ "$EUID" -eq 0 ]] || { echo 'Execute com sudo.' >&2; exit 1; }
DOMINIO="${1:-correaveiculosbb.com.br}"
IP_PUBLICO='137.131.242.110'
[[ "$DOMINIO" =~ ^[a-z0-9][a-z0-9-]*\.com\.br$ ]] || { echo 'Domínio inválido.' >&2; exit 1; }
WWW="www.$DOMINIO"
for ferramenta in caddy systemctl dig curl; do command -v "$ferramenta" >/dev/null || { echo "Falta: $ferramenta" >&2; exit 1; }; done
[[ -f /etc/caddy/Caddyfile ]] || { echo 'Caddyfile não encontrado.' >&2; exit 1; }
systemctl is-active --quiet correa-veiculos || { echo 'O serviço atual precisa estar ativo.' >&2; exit 1; }
if grep -Fq "$DOMINIO" /etc/caddy/Caddyfile; then
  echo 'O domínio já aparece no Caddyfile. Revise a configuração existente antes de alterar.' >&2
  exit 1
fi
# O resolvedor local pode guardar uma resposta negativa anterior ao registro.
# Confere diretamente o servidor autoritativo usado por este domínio no Registro.br.
DNS_AUTORITATIVO="${DNS_AUTORITATIVO:-a.auto.dns.br}"
for nome in "$DOMINIO" "$WWW"; do
  ips="$(dig "@$DNS_AUTORITATIVO" "$nome" A +short +time=3 +tries=1 | awk '/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ {print}' | sort -u)" || { echo "DNS ainda não responde: $nome" >&2; exit 1; }
  [[ "$ips" == "$IP_PUBLICO" ]] || { echo "O DNS de $nome ainda não aponta somente para $IP_PUBLICO. Nenhuma alteração aplicada." >&2; exit 1; }
done

BACKUP="/var/lib/correa/backups/dominio-$(date -u +%Y%m%dT%H%M%SZ)"
OVERRIDE='/etc/systemd/system/correa-veiculos.service.d/30-dominio.conf'
install -d -m 700 "$BACKUP"
cp /etc/caddy/Caddyfile "$BACKUP/Caddyfile"
if [[ -f "$OVERRIDE" ]]; then cp "$OVERRIDE" "$BACKUP/30-dominio.conf"; fi
TEMPORARIO="$(mktemp)"
alterado=0
restaurar() {
  resultado=$?
  trap - EXIT
  rm -f -- "$TEMPORARIO"
  if [[ "$resultado" -ne 0 && "$alterado" -eq 1 ]]; then
    echo 'Falha na ativação. Restaurando a configuração anterior.' >&2
    cp "$BACKUP/Caddyfile" /etc/caddy/Caddyfile
    if [[ -f "$BACKUP/30-dominio.conf" ]]; then cp "$BACKUP/30-dominio.conf" "$OVERRIDE"; else rm -f -- "$OVERRIDE"; fi
    systemctl daemon-reload
    systemctl restart correa-veiculos
    systemctl reload caddy
  fi
  exit "$resultado"
}
trap restaurar EXIT
cat /etc/caddy/Caddyfile > "$TEMPORARIO"
cat >> "$TEMPORARIO" <<EOF

$DOMINIO {
  redir https://$WWW{uri} permanent
}
$WWW {
  encode gzip
  request_body {
    max_size 30MB
  }
  reverse_proxy 127.0.0.1:3000
}
EOF
caddy validate --config "$TEMPORARIO" --adapter caddyfile
alterado=1
install -m 644 "$TEMPORARIO" /etc/caddy/Caddyfile
install -d -m 755 /etc/systemd/system/correa-veiculos.service.d
printf '[Service]\nEnvironment=ENDERECO_PUBLICO=https://%s\n' "$WWW" > "$OVERRIDE"
systemctl daemon-reload
systemctl reload caddy
systemctl restart correa-veiculos
echo "Aguardando HTTPS em $WWW…"
pronto=0
for tentativa in {1..12}; do
  # --resolve escolhe o IP conferido, mantendo a validação do certificado e do nome.
  if curl -fsS --connect-timeout 3 --max-time 5 --resolve "$WWW:443:$IP_PUBLICO" "https://$WWW/api/publico/catalogo" >/dev/null && curl -fsS --connect-timeout 3 --max-time 5 --resolve "$DOMINIO:443:$IP_PUBLICO" "https://$DOMINIO/" >/dev/null; then pronto=1; break; fi
  sleep 2
done
[[ "$pronto" -eq 1 ]] || { echo 'Não foi possível confirmar HTTPS. Confira DNS e registros AAAA.' >&2; exit 1; }
echo "Pronto: https://$WWW"
echo "Backup: $BACKUP"
