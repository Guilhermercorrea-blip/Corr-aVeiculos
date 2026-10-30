# Domínio escolhido: correaveiculosbb.com.br

O site está ativo em **https://www.correaveiculosbb.com.br**, com HTTPS e redirecionamento de **https://correaveiculosbb.com.br**. O endereço temporário continua disponível.

O domínio foi registrado pelo proprietário em 30/10/2026. O painel do Registro.br exibe status **Publicado** e expiração em **30/10/2028**. O endereço `137.131.242.110` foi salvo e conferido em **Configurar endereçamento**, usando o DNS simplificado do Registro.br. O DNS autoritativo e a consulta pública confirmaram o apontamento dos dois nomes.

O HTTPS foi ativado em 30/10/2026. O Caddy preserva o endereço temporário e encaminha o novo domínio para a mesma aplicação. A configuração de `ENDERECO_PUBLICO=https://www.correaveiculosbb.com.br` fica em `/etc/systemd/system/correa-veiculos.service.d/30-dominio.conf`. O backup anterior à ativação está em `/var/lib/correa/backups/dominio-20261030T130256Z`.

As seções abaixo documentam a configuração aplicada e servem de referência para manutenção. O script já foi executado para este domínio; não é necessário executá-lo novamente.

## 1. Conferir o DNS

O domínio é administrado na conta do proprietário no [Registro.br](https://registro.br/), com os servidores DNS do próprio Registro.br. O apontamento foi feito pela configuração simplificada. Na configuração avançada, os registros equivalentes são:

| Tipo | Nome | Destino |
| --- | --- | --- |
| A | @ (raiz) | 137.131.242.110 |
| CNAME | www | correaveiculosbb.com.br |

Use o TTL padrão do provedor. Caso `www` já use um registro A, ele também pode apontar diretamente para `137.131.242.110` em vez do CNAME. Não mantenha destinos antigos conflitantes nos registros A/AAAA do site. Preserve os registros de e-mail e outros serviços.

## 2. Ativar no servidor

Depois de o domínio estar registrado e os dois nomes resolverem para o servidor, envie o arquivo `nuvem/configurar-dominio.sh` ao servidor e execute como administrador:

```sh
sudo bash configurar-dominio.sh correaveiculosbb.com.br
```

O script:

- Confere os registros IPv4 dos dois nomes diretamente no DNS autoritativo, evitando respostas negativas antigas em cache no resolvedor local.
- Guarda uma cópia do Caddyfile e da configuração de endereço público.
- Preserva o site no endereço temporário e acrescenta o domínio novo.
- Configura HTTPS no Caddy, com redirecionamento da raiz para `www`.
- Atualiza `ENDERECO_PUBLICO` para os QR Codes e reinicia o serviço.
- Confere a resposta por HTTPS nos dois nomes, mantendo a validação dos certificados. Se falhar, restaura as configurações anteriores.

O script pressupõe a instalação atual, com serviço `correa-veiculos`, Caddy e IP `137.131.242.110`. Ele não compra domínios nem modifica DNS. Se encontrar o domínio já mencionado no Caddyfile, para e pede revisão da configuração existente.

## 3. Conferir antes de divulgar

Abra o endereço com e sem `www`, teste login, as duas áreas, um anúncio e o envio pelo QR Code. O endereço antigo continua disponível; o redirecionamento dele poderá ser configurado depois da validação do novo domínio.
