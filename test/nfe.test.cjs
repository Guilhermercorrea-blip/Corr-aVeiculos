'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
process.env.PASTA_DADOS = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'correa-nfe-test-'));
const db = require('../db');
const nfe = require('../nfe');

const dono = { nome: 'Fulana de Teste', cpf: '52998224725', endereco: 'Rua das Flores', numero: '10', bairro: 'Centro', cidade: 'Barra Bonita', uf: 'SP', cep: '17340000' };
const carro = { marca_modelo: 'GM Meriva Joy 1.4', ano_fab: 2011, ano_mod: 2011, cor: 'Prata', placa: 'AAA1B23', renavam: '00123456789', chassi: '9BGXL75XBC0000000', tipo_entrada: 'consignacao', valor_compra: 3400000 };

test('dígito da chave confere com uma nota real autorizada', () => {
  assert.equal(nfe.digitoChave('3526100779310600013955001000001079154073054'), 9);
  assert.equal(nfe.digitoChave('3526080779310600013955001000001041101018000'), 1);
});

test('NCM sugerido pelo modelo', () => {
  assert.equal(nfe.sugerirNcm({ marca_modelo: 'VW Gol 1.0' }), '87032100');
  assert.equal(nfe.sugerirNcm({ marca_modelo: 'Citroen C3 1.4 Excl' }), '87032210');
  assert.equal(nfe.sugerirNcm({ marca_modelo: 'Ford Fiesta 1,6 Flex' }), '87032310');
  assert.equal(nfe.sugerirNcm({ marca_modelo: 'Honda CG 160 Titan' }), '87112020');
  assert.equal(nfe.sugerirNcm({ marca_modelo: 'Suzuki GSXR 1000' }), '87115000');
});

test('gera a entrada de consignação no padrão das notas do Sebrae', async () => {
  const { id } = db.criarCompra({ pessoa: dono, veiculo: carro });
  const s = nfe.sugestaoEntrada(id);
  assert.equal(s.permitido, true);
  assert.equal(s.numero, 1080);
  assert.equal(s.ncm, '87032210');
  assert.equal(s.valor, 3400000);

  const r = await nfe.gerarEntradaConsignacao(id, { numero: 1080, ncm: '87032100', valor: 3400000, data: '2026-11-03T10:15' });
  assert.match(r.chave, /^35261107793106000139550010000010801\d{9}$/);
  assert.equal(Number(r.chave.slice(-1)), nfe.digitoChave(r.chave.slice(0, 43)));
  assert.match(r.arquivo, /\.txt$/);
  const l = r.conteudo.split('\r\n');
  const cNF = r.chave.slice(35, 43), cDV = r.chave.slice(43);
  assert.deepEqual(l, [
    'NOTAFISCAL|1',
    `A|4.00|NFe${r.chave}|`,
    `B|35|${cNF}|CONSIGNAÇÃO|55|1|1080|2026-11-03T10:15:00-03:00|2026-11-03T10:15:00-03:00||0|1|3505302||1|1|${cDV}|1|1|||0|0|||3|4.01_sebrae_b057|||`,
    'C|CORREA COMERCIO DE VEICULOS LTDA|CORREA VEICULOS|202093745118||341940|4511102|3||',
    'C02|07793106000139|',
    'C05|AV PAPA JOAO PAULO II|3143||JD OURO VERDE|3505302|Barra Bonita|SP|17342450|1058|BRASIL|36418510|',
    'E|FULANA DE TESTE|9|||||',
    'E03|52998224725|',
    'E05|Rua das Flores|10||Centro|3505302|Barra Bonita|SP|17340000|1058|BRASIL||',
    'H|1||',
    `I|S${id}|||GM MERIVA JOY 1.4 2011/2011 PRATA PLACA AAA1B23 RENAVAM 00123456789 CHASSI 9BGXL75XBC0000000|87032100|||1917|UN|1.0000|34000.0000000000|34000.00|||UN|1.0000|34000.0000000000|||||1||||||`,
    'M||', 'N|', 'N04|0|20|3|90.00|0.00|18.0000|0.00|||||||', 'Q|', 'Q04|07|', 'S|', 'S04|07|', 'W|',
    'W02|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|34000.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|34000.00|0.00|',
    'W04c|0.00|', 'W04e|0.00|', 'W04g|0.00|', 'X|0|', 'YA', 'YA01||90||0.00||||',
  ]);
  const teste = await nfe.gerarEntradaConsignacao(id, { numero: 1080, ncm: '87032100', valor: 3400000, homologacao: true });
  assert.match(teste.conteudo, /\|2\|1\|\|\|0\|0\|/);
  assert.match(teste.conteudo, /E\|NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL\|/);

  // próximo número avança; mesmo número em outro carro é recusado
  const outro = db.criarCompra({ pessoa: { ...dono, cpf: '11144477735' }, veiculo: { ...carro, placa: 'BBB2C34' } }).id;
  assert.equal(nfe.sugestaoEntrada(outro).numero, 1081);
  await assert.rejects(nfe.gerarEntradaConsignacao(outro, { numero: 1080, ncm: '87032100', valor: 100 }), { status: 409 });
  // regerar o mesmo carro com o mesmo número é permitido
  await nfe.gerarEntradaConsignacao(id, { numero: 1080, ncm: '87032100', valor: 3500000, data: '2026-11-03T10:20' });
  assert.equal(nfe.sugestaoEntrada(id).valor, 3500000);
});

test('avisa o que falta no cadastro e recusa compra comum', async () => {
  const semEndereco = db.criarCompra({ pessoa: { nome: 'Sem Endereço', cpf: '12345678909' }, veiculo: { ...carro, placa: 'CCC3D45' } }).id;
  await assert.rejects(nfe.gerarEntradaConsignacao(semEndereco, { numero: 1090, ncm: '87032100', valor: 100 }), /rua, número da casa, bairro, cidade, UF, CEP/);
  const compra = db.criarCompra({ pessoa: { ...dono, cpf: '98765432100' }, veiculo: { ...carro, placa: 'DDD4E56', tipo_entrada: 'compra' } }).id;
  assert.equal(nfe.sugestaoEntrada(compra).permitido, false);
  await assert.rejects(nfe.gerarEntradaConsignacao(compra, { numero: 1091, ncm: '87032100', valor: 100 }), { status: 400 });
});

test('gera a nota de venda no padrão da nota 1054 (com RENAVE)', async () => {
  const fox = { marca_modelo: 'VW Fox 1.0', ano_fab: 2008, ano_mod: 2009, cor: 'Prata', placa: 'EEE5F67', renavam: '00971407304', chassi: '9BWAA05Z094000000', combustivel: 'Álcool/Gasolina', tipo_entrada: 'compra', valor_compra: 1950000 };
  const id = db.criarCompra({ pessoa: { ...dono, cpf: '71428793860' }, veiculo: fox }).id;
  assert.equal(nfe.sugestao(id, 'venda').permitido, false);
  db.registrarVenda(id, { pessoa: { ...dono, nome: 'Comprador Teste', cpf: '86288366757' }, venda: { valor_venda: 2050000, meios_pagamento: ['pix'], valor_pix: 2050000, km_saida: 1000 } });
  const s = nfe.sugestao(id, 'venda');
  assert.equal(s.permitido, true);
  assert.equal(s.valor, 2050000);
  assert.deepEqual(s.calculo, { baseIcms: 205000, icms: 36900, baseLucro: 100000, pis: 650, cofins: 3000 });
  assert.equal(s.ficha.combustivel, '16');
  assert.equal(s.ficha.cor, '10');
  assert.equal(s.ficha.cilindrada, '999');
  await assert.rejects(nfe.gerarNota(id, 'venda', { numero: 1100, ncm: '87032100', valor: 2050000 }), /motor/);

  const ficha = { motor: 'CCN018448', potencia: '75', cilindrada: '999', peso: '1,48', lotacao: '5', combustivel: '16', tipo: '06', especie: '1', cor: '10', pintura: 'M' };
  const r = await nfe.gerarNota(id, 'venda', { numero: 1100, ncm: '87032210', valor: 2050000, data: '2026-11-04T09:00', ficha });
  const l = r.conteudo.split('\r\n');
  assert.equal(l[2], `B|35|${r.chave.slice(35, 43)}|SAIDA|55|1|1100|2026-11-04T09:00:00-03:00|2026-11-04T09:00:00-03:00||1|1|3505302||1|1|${r.chave.slice(43)}|1|1|||1|0|||3|4.01_sebrae_b057|||`);
  assert.equal(l[6], 'E|COMPRADOR TESTE|9|||||');
  assert.equal(l[10], `I|S${id}|||VW FOX 1.0 2008/2009 PRATA PLACA EEE5F67 RENAVAM 00971407304 CHASSI 9BWAA05Z094000000|87032210|||5102|UN|1.0000|20500.0000000000|20500.00|||UN|1.0000|20500.0000000000|||||1|||||SP020110|`);
  assert.equal(l[11], 'J|3|9BWAA05Z094000000|10|PRATA|75|999|1.4800|1.4800|1|16|CCN018448|1.4800|2|2009|2008|M|06|1|N|1|1|10|5|0|');
  assert.deepEqual(l.slice(12), [
    'M||', 'N|', 'N04|0|20|3|90.0000|2050.00|18.0000|369.00|||||||',
    'Q|', 'Q02|01|1000.00|0.6500|6.50|', 'S|', 'S02|01|1000.00|3.0000|30.00|', 'W|',
    'W02|2050.00|369.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|20500.00|0.00|0.00|0.00|0.00|0.00|0.00|6.50|30.00|0.00|20500.00|0.00|',
    'W04c|0.00|', 'W04e|0.00|', 'W04g|0.00|', 'X|1|', 'YA', 'YA01|0|17||20500.00||||',
  ]);
  // a ficha fica guardada para a próxima vez
  assert.equal(nfe.sugestao(id, 'venda').ficha.motor, 'CCN018448');
});

test('formas de pagamento fecham com o valor da nota', () => {
  const p = nfe.pagamentosVenda({ valor_pix: 1000000, valor_financiado: 3000000, valor_troca: 1500000, valor_saldo: 500000 }, 6000000);
  assert.deepEqual(p.map(x => [x.indPag, x.tPag, x.valor]), [[0, '17', 1000000], [0, '18', 3000000], [0, '99', 1500000], [1, '05', 500000]]);
  assert.equal(nfe.pagamentosVenda({ valor_pix: 100 }, 300).at(-1).valor, 200);
  assert.throws(() => nfe.pagamentosVenda({ valor_pix: 500 }, 300), /passa do valor/);
});

test('devolução de consignação no padrão das notas 1067-1069 (aponta a chave da entrada)', async () => {
  const id = db.criarCompra({ pessoa: { ...dono, cpf: '39053344705' }, veiculo: { ...carro, placa: 'FFF6G78' } }).id;
  const sem = nfe.sugestao(id, 'devolucao_consignacao');
  assert.equal(sem.referencia, '');
  await assert.rejects(nfe.gerarNota(id, 'devolucao_consignacao', { numero: 1200, ncm: '87032100', valor: 100 }), /chave de acesso/);

  const entrada = await nfe.gerarNota(id, 'entrada_consignacao', { numero: 1199, ncm: '87032100', valor: 3000000, data: '2026-11-01T09:00' });
  const s = nfe.sugestao(id, 'devolucao_consignacao');
  assert.equal(s.referencia, entrada.chave);
  assert.equal(s.entrada.numero, 1199);
  assert.equal(s.valor, 3000000);
  assert.equal(s.numero, 1200);

  const r = await nfe.gerarNota(id, 'devolucao_consignacao', { numero: 1200, ncm: '87032100', valor: 3000000, data: '2026-11-04T15:00', referencia: s.referencia });
  const l = r.conteudo.split('\r\n');
  assert.equal(l[2], `B|35|${r.chave.slice(35, 43)}|DEVOLUÇÃO|55|1|1200|2026-11-04T15:00:00-03:00|2026-11-04T15:00:00-03:00||0|1|3505302||1|1|${r.chave.slice(43)}|1|4|||0|0|||3|4.01_sebrae_b057|||`);
  assert.equal(l[3], 'BA|');
  assert.equal(l[4], `BA02|${entrada.chave}|`);
  assert.match(l[12], /\|87032100\|\|\|1918\|UN\|/);
  assert.deepEqual(l.slice(13), ['M||', 'N|', 'N04|0|20|3|90.00|0.00|18.0000|0.00|||||||', 'Q|', 'Q04|07|', 'S|', 'S04|07|', 'W|',
    'W02|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|30000.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|30000.00|0.00|',
    'W04c|0.00|', 'W04e|0.00|', 'W04g|0.00|', 'X|0|', 'YA', 'YA01||90||0.00||||']);
  assert.match(r.arquivo, /devolucao-consignacao/);
  // chave colada à mão (entrada feita no Sebrae) também vale, desde que o dígito confira
  const outra = '35261007793106000139550010000010791540730549';
  const r2 = await nfe.gerarNota(id, 'devolucao_consignacao', { numero: 1200, ncm: '87032100', valor: 3000000, referencia: outra.replace(/(\d{4})/g, '$1 ') });
  assert.ok(r2.conteudo.includes(`BA02|${outra}|`));
  await assert.rejects(nfe.gerarNota(id, 'devolucao_consignacao', { numero: 1200, ncm: '87032100', valor: 3000000, referencia: outra.slice(0, 43) + '0' }), /chave de acesso/);
});
