'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const FICHA = { motor: 'ABC123456', potencia: 80, cilindrada: 1400, peso: '1.5', cmt: '1.9', eixos: 2, combustivel: '16', tipo: '06', especie: '1', lotacao: 5, cor: '10', pintura: 'S', marca_modelo: '1' };
process.env.PASTA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'correa-xmlaut-test-'));
const db = require('../db');
const nfe = require('../nfe');
const direta = require('../nfe-direta');
const danfe = require('../danfe');

const pessoa = { nome: 'Fulana de Teste', cpf: '52998224725', endereco: 'Rua das Flores', numero: '10', bairro: 'Centro', cidade: 'Barra Bonita', uf: 'SP', cep: '17340000' };
const carro = { marca_modelo: 'GM Meriva Joy 1.4', ano_fab: 2011, ano_mod: 2011, cor: 'Prata', placa: 'AAA1B23', renavam: '00123456789', chassi: '9BGXL75XBC0000000', tipo_entrada: 'consignacao', valor_compra: 3400000 };

// Monta o "procNfe" como o Emissor grava: NFe + protocolo de autorização
async function procNfe(id, numero, cStat = '100') {
  const g = await nfe.gerarNota(id, 'entrada_consignacao', { ficha: FICHA, numero, ncm: '87032210', valor: 3400000, data: '2026-11-19T10:00', xml: true });
  const prot = cStat ? `<protNFe versao="4.00"><infProt><tpAmb>1</tpAmb><chNFe>${g.chave}</chNFe><dhRecbto>2026-11-19T10:05:00-03:00</dhRecbto><nProt>135260000000777</nProt><cStat>${cStat}</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>` : '';
  return { chave: g.chave, xml: `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe xmlns="http://www.portalfiscal.inf.br/nfe">${g.xml}</NFe>${prot}</nfeProc>` };
}

test('anexar o XML autorizado libera o download do XML e o DANFE', async () => {
  const { id } = db.criarCompra({ pessoa, veiculo: carro });
  const p = await procNfe(id, 1100);
  assert.equal(nfe.sugestao(id, 'entrada_consignacao').ultima.temXml, false);
  const r = direta.anexarXml(id, 'entrada_consignacao', p.xml);
  assert.equal(r.numero, 1100);
  assert.equal(r.protocolo, '135260000000777');
  const s = nfe.sugestao(id, 'entrada_consignacao').ultima;
  assert.equal(s.temXml, true);
  assert.equal(s.protocolo, '135260000000777');
  const baixar = direta.xmlDaNotaRegistrada(s.id);
  assert.equal(baixar.arquivo, `NFe-1100-${p.chave}.xml`);
  assert.equal(baixar.conteudo, p.xml);
  const html = danfe.gerarDanfe(baixar.conteudo);
  assert.ok(html.includes('135260000000777'));
  assert.ok(html.includes('Nº 000.001.100'));
});

test('XML de outra nota, sem autorização ou que não é NF-e: recusa com a explicação', async () => {
  const { id } = db.criarCompra({ pessoa: { ...pessoa, cpf: '11144477735' }, veiculo: { ...carro, placa: 'BBB1B23' } });
  await nfe.gerarNota(id, 'entrada_consignacao', { ficha: FICHA, numero: 1101, ncm: '87032210', valor: 3400000, data: '2026-11-19T10:00' });
  const outra = db.criarCompra({ pessoa: { ...pessoa, cpf: '39053344705' }, veiculo: { ...carro, placa: 'CCC1B23' } });
  const doOutro = await procNfe(outra.id, 1102);
  assert.throws(() => direta.anexarXml(id, 'entrada_consignacao', doOutro.xml), /outra nota/);
  const semProtocolo = await procNfe(id, 1101, '');
  assert.throws(() => direta.anexarXml(id, 'entrada_consignacao', semProtocolo.xml), /autorização|protocolo/);
  assert.throws(() => direta.anexarXml(id, 'entrada_consignacao', '<qualquer/>'), /não parece o XML/);
  assert.throws(() => direta.anexarXml(999999, 'entrada_consignacao', doOutro.xml), /Gere primeiro/);
  assert.throws(() => direta.xmlDaNotaRegistrada(db.conexao.prepare('SELECT id FROM nfe_notas WHERE numero = 1101').get().id), /ainda não tem o XML/);
});
