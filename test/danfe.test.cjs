'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
process.env.PASTA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'correa-danfe-test-'));
const db = require('../db');
const nfe = require('../nfe');
const danfe = require('../danfe');

test('tabela do Code-128: 107 símbolos distintos, 11 módulos cada e STOP com 13', () => {
  const soma = p => [...p].reduce((s, c) => s + Number(c), 0);
  assert.equal(danfe.PADROES_128.length, 107);
  assert.ok(danfe.PADROES_128.slice(0, 106).every(p => p.length === 6 && soma(p) === 11));
  assert.equal(soma(danfe.PADROES_128[106]), 13);
  assert.equal(new Set(danfe.PADROES_128).size, 107);
});

test('Code-128C: START C, pares de dígitos, dígito de controle módulo 103 e STOP', () => {
  // Exemplo conferível à mão: "1234" -> pares 12 e 34; controle = (105 + 12*1 + 34*2) % 103 = 185 % 103 = 82
  assert.deepEqual(danfe.valores128C('1234'), [105, 12, 34, 82, 106]);
  assert.throws(() => danfe.valores128C('123'), /par/);
  const svg = danfe.codigoBarrasSvg('35261107793106000139550010000010851840762234');
  assert.match(svg, /^<svg /);
  assert.equal((svg.match(/<rect /g) || []).length, 3 * 25 + 1); // 3 barras por símbolo e 4 no STOP
});

test('DANFE a partir do XML autorizado: chave, protocolo, destinatário, valores e marca de teste', async () => {
  const { id } = db.criarCompra({
    pessoa: { nome: 'Fulana de Teste', cpf: '52998224725', endereco: 'Rua das Flores', numero: '10', bairro: 'Centro', cidade: 'Barra Bonita', uf: 'SP', cep: '17340000' },
    veiculo: { marca_modelo: 'GM Meriva Joy 1.4', ano_fab: 2011, ano_mod: 2011, cor: 'Prata', placa: 'AAA1B23', tipo_entrada: 'consignacao', valor_compra: 3400000 },
  });
  const g = await nfe.gerarNota(id, 'entrada_consignacao', { numero: 1090, ncm: '87032210', valor: 3400000, data: '2026-11-19T10:00', homologacao: true, xml: true });
  const prot = `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${g.chave}</chNFe><dhRecbto>2026-11-19T10:01:02-03:00</dhRecbto><nProt>135260000000009</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`;
  const xml = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe xmlns="http://www.portalfiscal.inf.br/nfe">${g.xml}</NFe>${prot}</nfeProc>`;
  const html = danfe.gerarDanfe(xml);
  assert.ok(html.includes(g.chave.replace(/(\d{4})/g, '$1 ').trim()));
  assert.ok(html.includes('135260000000009 - 19/11/2026 10:01:02'));
  assert.ok(html.includes('Nº 000.001.090'));
  assert.ok(html.includes('529.982.247-25'));
  assert.ok(html.includes('34.000,00'));
  assert.ok(html.includes('CONSIGNAÇÃO'));
  assert.ok(html.includes('SEM VALOR FISCAL'));
  assert.ok(html.includes('0 - Emitente'));
  assert.ok(html.includes('<td>1917</td>'));
  assert.throws(() => danfe.gerarDanfe(xml.replace('<cStat>100</cStat>', '<cStat>539</cStat>')), /não está autorizada/);
});
