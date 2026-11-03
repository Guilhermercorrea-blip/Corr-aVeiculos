'use strict';
// Rodapé fornecido pela loja, colocado no fim de cada post do Facebook e do Instagram.
const RODAPE = `📍 Corrêa Veículos
📌 Av. Papa João Paulo II, 3143
Jardim Ouro Verde – Barra Bonita/SP

📲 WhatsApp: (14) 99887-0734
☎️ Telefone: (14) 3641-8510
{SITE}

🤝 Transparência, procedência e confiança.`;
const SITE_PADRAO = 'https://www.correaveiculosbb.com.br';
function invalido(mensagem) { return Object.assign(new Error(mensagem), {status:400}); }
function texto(valor, maximo) {
  if (valor == null) return '';
  if (typeof valor !== 'string' || valor.length > maximo) throw invalido('Confira os dados do texto para as redes.');
  return valor.trim();
}
function montarPublicacao(dados) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw invalido('Dados da publicação inválidos.');
  const titulo = texto(dados.titulo,140) || [texto(dados.marca_modelo,140),texto(dados.versao,140)].filter(Boolean).join(' ');
  if (!titulo || titulo.length > 140) throw invalido('Informe o modelo ou título do anúncio.');
  const descricao = texto(dados.descricao,6000);
  const preco = dados.preco ?? null;
  if (preco !== null && (!Number.isSafeInteger(preco) || preco <= 0)) throw invalido('Confira o preço para anunciar.');
  const valor = preco === null ? '💰 Valor: sob consulta' : '💰 Valor: ' + (preco / 100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/\u00a0/g,' ');
  // Link do próprio carro no site (sem o https://, que o Facebook reconhece igual e fica mais limpo)
  const site = (process.env.ENDERECO_PUBLICO || SITE_PADRAO).replace(/\/+$/,'');
  const id = Number.isSafeInteger(dados.id) && dados.id > 0 ? dados.id : null;
  const link = '🌐 ' + (id ? 'Mais fotos e detalhes: ' : 'Veja nossos carros: ') + (site + (id ? '/carro/' + id : '')).replace(/^https?:\/\//,'');
  return {texto:[titulo,descricao,valor,RODAPE.replace('{SITE}',link)].filter(Boolean).join('\n\n')};
}
module.exports = {montarPublicacao};
