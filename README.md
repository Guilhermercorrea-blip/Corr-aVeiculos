# Corrêa Veículos

Site da loja e sistema de gestão no mesmo projeto, com Node.js e SQLite.

## Acessos

- `/`: site público com os carros que a equipe escolheu anunciar.
- `/acesso.html`: depois do login, permite escolher **Sistema da loja** ou **Gerenciar anúncios**.
- `/sistema`: estoque, pessoas, compras, vendas, gastos, pagamentos e contratos.
- `/anuncios.html`: preparar anúncios, escolher fotos, preço, descrição e destaque, publicar ou retirar do site.

O login usa as mesmas contas já cadastradas no sistema. Para cadastrar contas, use **Configurações** no sistema.

## Publicar um carro

1. Cadastre o veículo no estoque do sistema. As fotos de carro podem ser enviadas pelo mesmo QR Code usado para documentos.
2. Abra **Anúncios** e selecione o veículo.
3. Informe o título, o preço de anúncio (em branco: **Sob consulta**) e a descrição pública.
4. Marque as fotos que deseja mostrar e escolha a capa.
5. Marque **Publicar no site** e salve.

Nenhum veículo ou foto é anunciado automaticamente. O preço do anúncio é independente do custo de compra e dos contratos. Ao registrar a venda, o carro e suas fotos deixam de ser disponibilizados na vitrine pública. Ao desfazer a venda, um anúncio ainda marcado como publicado volta a aparecer. Para mantê-lo oculto, retire o anúncio do site.

Em **Dados do site**, edite nome, chamada principal, apresentação, contatos, endereço, horário e Instagram. Essas informações não alteram os dados dos contratos.

## Executar no computador

Requer Node.js 24 e as dependências do `package-lock.json`.

```sh
npm ci
npm start
```

Execute `npm test` para conferir a publicação, retirada, proteção de documentos, separação dos campos públicos e autenticação, usando somente uma base fictícia temporária. A vitrine e o painel também foram conferidos no navegador em computador e celular.

Abra `http://localhost:3000`. Sem usuários cadastrados, crie a primeira conta pela tela de login **no próprio computador onde o servidor está rodando**. No Windows, o arquivo `Abrir sistema.bat` abre diretamente o sistema.

## Dados e configurações privadas

O SQLite e os anexos ficam na pasta definida por `PASTA_DADOS` (padrão: `data/`). Essa pasta deve ter backup próprio e **não pertence ao repositório Git**.

A leitura de documentos e do hodômetro usa a integração Anthropic existente. Configure a chave no servidor pelo mecanismo já usado pelo sistema (`CHAVE-API-CLAUDE.txt` ou variável de ambiente aceita pelo leitor). A chave não deve ser versionada.

O site público disponibiliza somente título, descrição, preço de anúncio, ano, cor, combustível, quilometragem e fotos de veículo explicitamente selecionadas. Dados de pessoas, documentos, placa, chassi, RENAVAM, custos e lucro continuam em rotas com login. As fotos públicas são conferidas a cada acesso, inclusive após retirar o anúncio ou vender o carro.

## Servidor e domínio

A aplicação roda no servidor Oracle em `/opt/correa-veiculos`, com dados em `/var/lib/correa/data` e serviço `correa-veiculos`. O Caddy entrega HTTPS e encaminha para a aplicação na porta 3000.

O site está ativo em **https://www.correaveiculosbb.com.br**, com HTTPS e redirecionamento do endereço sem `www`. O domínio foi registrado pelo proprietário e o painel exibe expiração em **30/10/2028**. O DNS simplificado do Registro.br aponta para o servidor Oracle; `ENDERECO_PUBLICO` foi atualizado para os QR Codes. O endereço temporário continua disponível. Veja o [registro da configuração e instruções de manutenção](nuvem/DOMINIO.md). Para uma futura mudança de domínio, as etapas são:

1. Configurar o DNS do domínio para o servidor e conferir os registros de `www`.
2. Configurar o domínio no Caddy, validar a configuração e ativar HTTPS.
3. Atualizar `ENDERECO_PUBLICO` no serviço para que os QR Codes usem o novo endereço.
4. Validar site, login, sistema, anúncios e envio pelo QR Code antes de redirecionar o endereço antigo.

Não altere DNS nem o endereço do serviço antes de confirmar a posse e a resolução do domínio. Ao atualizar o código, preserve a chave da API e a pasta de dados, faça backup e evite substituir arquivos de configuração por uma instalação nova.

## Continuidade do desenvolvimento

O código versionado é a referência para futuras alterações. Não envie o banco, documentos de clientes, chaves, senhas ou PDFs com dados da conta ao GitHub.

O cadastro de pessoas permite edição, exclusão de pessoas sem vínculos e arquivamento de pessoas ligadas a compras ou vendas, com confirmação. O filtro **Arquivados** permite restaurar o cadastro. Arquivar mantém os vínculos e o histórico dos veículos. Uma nova operação com o mesmo CPF reaproveita e reativa o cadastro; editar um veículo antigo não o reativa automaticamente.
