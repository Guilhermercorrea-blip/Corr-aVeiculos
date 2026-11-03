'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const {montarPublicacao}=require('../redes-sociais');
test('texto contém descrição, centavos corretos e o rodapé com o contato da loja',() => {
  const {texto}=montarPublicacao({marca_modelo:'Carro fictício',descricao:'Primeira linha.\nSegunda linha.',preco:5990050,valor_compra:3000000,cpf:'DADO-PRIVADO',whatsapp:'NUMERO-DO-SITE'});
  assert.ok(texto.startsWith('Carro fictício\n\nPrimeira linha.\nSegunda linha.'));
  assert.ok(texto.includes('💰 Valor: R$ 59.900,50'));
  assert.ok(texto.includes('📌 Av. Papa João Paulo II, 3143\nJardim Ouro Verde – Barra Bonita/SP'));
  assert.ok(texto.includes('WhatsApp: (14) 99887-0734'));
  assert.ok(texto.includes('Telefone: (14) 3641-8510'));
  assert.ok(texto.endsWith('🤝 Transparência, procedência e confiança.'));
  assert.ok(texto.includes('🌐 Veja todos os nossos carros: www.correaveiculosbb.com.br\n'));
  assert.ok(!montarPublicacao({titulo:'Teste',id:12}).texto.includes('/carro/'));
  for(const s of ['3000000','DADO-PRIVADO','NUMERO-DO-SITE']) assert.ok(!texto.includes(s));
});
test('preço não informado aparece sob consulta; valores inválidos são rejeitados',() => {
  assert.ok(montarPublicacao({titulo:'Anúncio fictício',preco:null}).texto.includes('Valor: sob consulta'));
  for(const preco of [0,-1,1.5,'59900',NaN,Infinity]) assert.throws(() => montarPublicacao({titulo:'Teste',preco}),e => e.status===400);
  assert.throws(() => montarPublicacao({}),e => e.status===400);
});
