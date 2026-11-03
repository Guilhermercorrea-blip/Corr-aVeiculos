'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { criarVariacoes } = require('../descricao-variacoes');
test('estilos alternam e o histórico de aberturas é limitado', () => {
  const v = criarVariacoes({sortear: () => 0}); let anterior;
  for(let i=0;i<20;i++) { const pedido=v.preparar(); assert.notEqual(pedido,anterior); anterior=pedido; }
  for(let i=0;i<10;i++) v.registrar(`Apresentação número ${i}: conheça os detalhes.`);
  assert.equal(v.repetida('APRESENTAÇÃO NÚMERO 9: conheça os detalhes.'),true);
  assert.equal(v.repetida('Apresentação número 0: conheça os detalhes.'),false);
  assert.equal(v.repetida('🔥 Conforto, desempenho e procedência em um só carro!'),true);
});
function gerador(respostas) {
  const pedidos=[];
  class API { constructor(){ this.messages={create:async pedido => { pedidos.push(pedido); return {content:[{type:'text',text:respostas.shift()}],stop_reason:'end_turn'}; }}; } }
  for(const nome of ['AuthenticationError','RateLimitError','APIConnectionError','APIError']) API[nome]=class extends Error {};
  const contexto={module:{exports:{}},require:nome => {
    if(nome==='@anthropic-ai/sdk') return {default:API};
    if(nome==='./db') return {erro:(mensagem,status=400) => Object.assign(new Error(mensagem),{status})};
    if(nome==='./leitor') return {lerChave:() => 'chave-ficticia-local'};
    if(nome==='./descricao-variacoes') return {criarVariacoes};
    throw new Error('Dependência inesperada');
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../descricao.js'),'utf8'),contexto);
  return {gerar:contexto.module.exports.gerarDescricao,pedidos};
}
test('repetição provoca uma nova tentativa e o exemplo fixo não é enviado', async () => {
  const a='Conheça este veículo e todos os detalhes informados.';
  const g=gerador([a,a,'Um convite para conhecer o modelo na loja.']);
  assert.equal((await g.gerar({modelo:'Modelo fictício'})).descricao,a);
  assert.equal((await g.gerar({modelo:'Modelo fictício'})).descricao,'Um convite para conhecer o modelo na loja.');
  assert.equal(g.pedidos.length,3);
  assert.ok(g.pedidos[1].messages[0].content.includes(a));
  assert.ok(!g.pedidos[0].system.includes('Volkswagen Fox'));
  assert.ok(g.pedidos[0].system.includes('Nunca invente'));
});
test('tentativas são limitadas e uma repetição persistente retorna erro', async () => {
  const a='Confira as informações deste veículo na loja.';
  const g=gerador([a,a,a]); await g.gerar({modelo:'Teste'});
  await assert.rejects(g.gerar({modelo:'Teste'}),e => e.status===422);
  assert.equal(g.pedidos.length,3);
});
