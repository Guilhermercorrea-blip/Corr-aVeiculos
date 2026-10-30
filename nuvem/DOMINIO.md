# Domínio escolhido: correaveiculosbb.com.br

O site já funciona no endereço temporário. O endereço final será **https://www.correaveiculosbb.com.br**, com redirecionamento de **https://correaveiculosbb.com.br**.

O usuário escolheu o nome em 30/10/2026. A consulta RDAP oficial nessa data não encontrou registro para ele, mas isso não reserva o domínio nem substitui a confirmação de disponibilidade no Registro.br. O domínio ainda precisa ser registrado na conta do proprietário.

## 1. Registrar e configurar o DNS

Registre o domínio no [Registro.br](https://registro.br/) ou no provedor escolhido. A compra e os dados da conta ficam com o proprietário.

Na zona DNS, configure:

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

- Confere a resolução IPv4 dos dois nomes antes de alterar a configuração.
- Guarda uma cópia do Caddyfile e da configuração de endereço público.
- Preserva o site no endereço temporário e acrescenta o domínio novo.
- Configura HTTPS no Caddy, com redirecionamento da raiz para `www`.
- Atualiza `ENDERECO_PUBLICO` para os QR Codes e reinicia o serviço.
- Confere a resposta por HTTPS. Se falhar, restaura as configurações anteriores.

O script pressupõe a instalação atual, com serviço `correa-veiculos`, Caddy e IP `137.131.242.110`. Ele não compra domínios nem modifica DNS. Se encontrar o domínio já mencionado no Caddyfile, para e pede revisão da configuração existente.

## 3. Conferir antes de divulgar

Abra o endereço com e sem `www`, teste login, as duas áreas, um anúncio e o envio pelo QR Code. O endereço antigo continua disponível; o redirecionamento dele poderá ser configurado depois da validação do novo domínio.
