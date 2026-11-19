'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
process.env.PASTA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'correa-danfepdf-test-'));
const db = require('../db');
const nfe = require('../nfe');
const danfePdf = require('../danfe-pdf');

const FICHA = { motor: 'ABC123456', potencia: 80, cilindrada: 1400, peso: '1.5', cmt: '1.9', eixos: 2, combustivel: '16', tipo: '06', especie: '1', lotacao: 5, cor: '10', pintura: 'S', marca_modelo: '1' };

async function nfeProc(homologacao, cStat = '100') {
  const { id } = db.criarCompra({
    pessoa: { nome: 'Fulana de Teste Ltda', cpf: '52998224725', endereco: 'Rua das Flores', numero: '10', bairro: 'Centro', cidade: 'Barra Bonita', uf: 'SP', cep: '17340000' },
    veiculo: { marca_modelo: 'GM Meriva Joy 1.4', ano_fab: 2011, ano_mod: 2011, cor: 'Prata', placa: homologacao ? 'AAA1B23' : 'AAA1B24', chassi: '9BGXL75XBC0000000', tipo_entrada: 'consignacao', valor_compra: 3400000 },
  });
  const g = await nfe.gerarNota(id, 'entrada_consignacao', { ficha: FICHA, numero: homologacao ? 1090 : 1091, ncm: '87032210', valor: 3400000, data: '2026-11-19T10:00', homologacao, xml: true });
  const prot = `<protNFe versao="4.00"><infProt><tpAmb>${homologacao ? 2 : 1}</tpAmb><chNFe>${g.chave}</chNFe><dhRecbto>2026-11-19T10:01:02-03:00</dhRecbto><nProt>135260000000009</nProt><cStat>${cStat}</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`;
  return `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe xmlns="http://www.portalfiscal.inf.br/nfe">${g.xml}</NFe>${prot}</nfeProc>`;
}

test('PDF do DANFE: arquivo PDF válido, com as posições do índice conferindo e o conteúdo da nota', async () => {
  const r = danfePdf.gerarDanfePdf(await nfeProc(false));
  const s = r.pdf.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  const inicioXref = Number(s.match(/startxref\n(\d+)/)[1]);
  assert.equal(s.slice(inicioXref, inicioXref + 4), 'xref');
  const posicoes = [...s.slice(inicioXref).matchAll(/(\d{10}) 00000 n/g)].map(m => Number(m[1]));
  assert.equal(posicoes.length, 7);
  posicoes.forEach((p, i) => assert.ok(s.slice(p).startsWith(`${i + 1} 0 obj`), `objeto ${i + 1} fora do lugar`));
  // o tamanho declarado do fluxo de desenho bate com o conteúdo
  const m = s.match(/\/Length (\d+) >>\nstream\n/);
  const ini = s.indexOf('stream\n', s.indexOf('4 0 obj')) + 7;
  assert.equal(s.slice(ini + Number(m[1]), ini + Number(m[1]) + 10), '\nendstream');
  // conteúdo da nota presente (o texto vai em Helvetica; acentos em Latin-1)
  for (const trecho of ['(NF-e)', '(Nº 000.001.091)', '(DANFE)', '135260000000009', '34.000,00', '(CONSIGNAÇÃO)', '529.982.247-25']) assert.ok(s.includes(trecho), 'faltou ' + trecho);
  assert.ok(!s.includes('SEM VALOR FISCAL'), 'nota real não leva a marca de teste');
  assert.equal(r.numero, '1091');
  assert.equal(r.chave.length, 44);
});

test('PDF em homologação leva a marca "SEM VALOR FISCAL"; nota não autorizada não gera PDF', async () => {
  const xml = await nfeProc(true);
  const s = danfePdf.gerarDanfePdf(xml).pdf.toString('latin1');
  assert.ok(s.includes('(SEM VALOR FISCAL)'));
  assert.throws(() => danfePdf.gerarDanfePdf(xml.replace('<cStat>100</cStat>', '<cStat>539</cStat>')), /não está autorizada/);
});

test('medida do texto: Helvetica, em pontos', () => {
  // "A" tem 667 milésimos do corpo; 10 pt => 6,67 pt
  assert.equal(Math.round(danfePdf.larguraTexto('A', 10, false) * 100) / 100, 6.67);
  assert.ok(danfePdf.larguraTexto('WWW', 10, true) > danfePdf.larguraTexto('iii', 10, true));
});
