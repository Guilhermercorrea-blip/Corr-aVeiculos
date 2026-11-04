'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { calcularImpostosVenda } = require('../impostos');

test('impostos da venda da moto (nota 1080: venda 14.500, compra 13.800)', () => {
  const r = calcularImpostosVenda(1450000, 1380000, '2026-11-04T10:26');
  const v = Object.fromEntries(r.itens.map(i => [i.chave, i.valor]));
  assert.deepEqual(v, { icms: 26100, pis: 455, cofins: 2100, irpj: 3360, csll: 2016 });
  assert.equal(r.margem, 70000);
  assert.equal(r.naNota, 28655);
  assert.equal(r.futuros, 5376);
  assert.equal(r.total, 34031);
  const venc = Object.fromEntries(r.itens.map(i => [i.chave, i.vence]));
  assert.equal(venc.pis, '2026-12-24'); // 25/12 é Natal: antecipa
  assert.equal(venc.irpj, '2027-01-29');
  assert.match(venc.icms, /12\/2026/);
  assert.equal(r.itens.find(i => i.chave === 'csll').quando, '4º trimestre/2026');
});

test('venda com prejuízo não gera PIS/COFINS/IRPJ/CSLL negativos', () => {
  const r = calcularImpostosVenda(1000000, 1200000, '2026-03-10');
  assert.equal(r.margem, 0);
  assert.equal(r.futuros, 0);
  assert.equal(r.itens.find(i => i.chave === 'icms').valor, 18000);
  assert.equal(r.itens.find(i => i.chave === 'irpj').vence, '2026-04-30');
});
