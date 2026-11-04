# Corrêa Veículos

Site da loja e sistema de gestão no mesmo projeto, com Node.js e SQLite.

## Acessos

- `/`: site público com os carros que a equipe escolheu anunciar.
- `/acesso.html`: depois do login, permite escolher **Sistema da loja** ou **Gerenciar anúncios**.
- `/sistema`: estoque, pessoas, compras, vendas, gastos, pagamentos e contratos.
- `/anuncios.html`: preparar anúncios, escolher fotos, preço, descrição e destaque, publicar ou retirar do site.

O login usa as mesmas contas já cadastradas no sistema. Para cadastrar contas, use **Configurações** no sistema.

## Publicar um carro

1. Entre em **Gerenciar anúncios → Novo anúncio**. Não é necessário cadastrar uma compra, vendedor ou contrato. Para aproveitar um veículo existente, use **Trazer do estoque**.
2. No painel à esquerda, selecione tipo de veículo, ano e fabricante; preencha modelo, quilometragem, preço e descrição. Use **Outro** para um fabricante que não esteja na lista. Preço em branco aparece como **Sob consulta**.
3. Adicione fotos do computador/galeria, arraste e solte ou tire uma foto pelo celular. São aceitas até 40 fotos selecionadas; use **Capa** ou as setas para ordenar. As fotos novas são enviadas ao salvar. Documentos do estoque não aparecem entre as opções.
4. A prévia à direita acompanha o preenchimento. No celular, alterne entre **Preencher** e **Ver prévia**. Use **Avançar** para completar detalhes e opcionais e chegar à conferência final.
5. **Salvar rascunho** guarda o cadastro sem divulgá-lo. Na última etapa, **Publicar no site** torna o anúncio visível. Em anúncios já publicados, **Salvar alterações** atualiza o conteúdo no ar. **Retirar do site** preserva o cadastro como rascunho.

Nenhum veículo ou foto é anunciado automaticamente. O preço do anúncio é independente do custo de compra e dos contratos. Em anúncios vinculados ao estoque, registrar a venda oculta o carro e suas fotos da vitrine pública. Desfazer a venda permite que um anúncio ainda publicado volte a aparecer. Em anúncios independentes, **Marcar como vendido** oculta a divulgação sem registrar uma venda financeira; **Voltar para rascunho** permite prepará-lo novamente.

Os anúncios usam as tabelas `publicacoes`, `publicacao_fotos` e `publicacao_uploads`. A migração preserva os IDs e links dos anúncios antigos, seus preços, seleção de fotos e estado de publicação. Atualizações conferem a revisão do registro para impedir que uma aba antiga sobrescreva outra. O cadastro usa uma chave de reenvio para evitar duplicação ao repetir uma tentativa com falha de conexão.

Em **Dados do site**, edite nome, chamada principal, apresentação, contatos, endereço, horário, Facebook e Instagram. Essas informações não alteram os dados dos contratos.

### Enviar fotos do anúncio por QR Code

Em **Novo anúncio** ou ao editar um anúncio, preencha o modelo e use **Usar celular (QR Code)** na área de fotos. Um anúncio novo é salvo como rascunho antes de gerar o código. Aponte a câmera do telefone, abra o link e use **Tirar foto** ou **Escolher fotos da galeria**; não precisa entrar no sistema pelo celular. As fotos aparecem automaticamente no computador. Clique **Concluir envio**, confira a capa e **salve o anúncio** para aplicar a seleção.

O link vale por uma hora, permite somente enviar até 40 imagens para aquele anúncio e deixa de funcionar ao concluir ou gerar outro código. As fotos recebidas ficam guardadas na biblioteca privada; o link não permite consultar documentos, alterar preços ou publicar. Reiniciar o serviço invalida os códigos abertos, preservando as fotos já recebidas. O QR Code é desenhado no próprio navegador com a biblioteca local em `public/vendor`.

Facebook e Instagram aparecem logo abaixo da navegação na página inicial e também na área de contato. Os endereços podem ser atualizados em **Dados do site**, nos campos **Facebook** e **Instagram**. Eles abrem em outra aba.

Na etapa **Conferir e publicar**, **Prévia para Facebook e Instagram** monta título, descrição, preço do anúncio e o rodapé fornecido pela loja. O WhatsApp `(14) 99629-7483` é exclusivo desse texto; o contato do site permanece separado. A prévia pode ser copiada e usa os dados em preenchimento sem salvar ou publicar. O envio automático às redes ainda depende de conectar e autorizar as contas na Meta.

## Executar no computador

A descrição com IA alterna abordagens de escrita e evita as oito últimas aberturas geradas pelo serviço. Se a abertura se repetir, faz no máximo uma tentativa adicional. O histórico é temporário e reinicia com o serviço; os fatos do veículo continuam restritos aos dados informados pela equipe.

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

O site público disponibiliza somente título, descrição, preço de anúncio, tipo de veículo, fabricante, modelo, versão, ano, cor, combustível, câmbio, portas, quilometragem, opcionais e fotos explicitamente selecionadas. Dados de pessoas, documentos, placa, chassi, RENAVAM, custos e lucro continuam em rotas com login. As fotos públicas são conferidas a cada acesso, inclusive após retirar o anúncio ou vender o carro.

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

## Convite para avaliação no Google

Depois de registrar a venda, abra o carro em **Vendidos**. Logo abaixo dos contratos, **Avaliação no Google → Abrir convite no WhatsApp** prepara uma mensagem com o primeiro nome do comprador e o link de avaliação da loja. O telefone vem do cadastro do comprador; se estiver ausente ou inválido, a tela oferece o acesso para corrigi-lo.

Confira se o WhatsApp aberto está na conta da loja **(14) 99887-0734** e toque em **Enviar**. O sistema não envia automaticamente nem escolhe a conta do WhatsApp. Depois do envio, clique em **Já enviei o convite**. A confirmação da equipe fica guardada por venda, inclusive entre computadores. Abrir o convite não confirma envio e o sistema não identifica entrega, leitura ou avaliação. Convites confirmados ficam recolhidos para evitar repetição; **Preparar convite novamente** permite reabri-los conscientemente. Desfazer a venda remove a confirmação daquela venda.

As rotas de convite e confirmação exigem login. A tabela adicional `avaliacao_convites` guarda somente o ID da venda e a data da confirmação, sem alterar contratos, clientes, impostos ou publicações nas redes. Os testes usam dados fictícios e não enviam mensagens.
