'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const test = require('node:test');
process.env.PASTA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'correa-notasmes-test-'));
const db = require('../db');
const nfe = require('../nfe');
const notas = require('../notas-mes');

const FICHA = { motor: 'ABC123456', potencia: 80, cilindrada: 1400, peso: '1.5', cmt: '1.9', eixos: 2, combustivel: '16', tipo: '06', especie: '1', lotacao: 5, cor: '10', pintura: 'S', marca_modelo: '1' };

async function criarNota(placa, cpf, numero, homologacao) {
  const { id } = db.criarCompra({
    pessoa: { nome: 'Fulana de Teste', cpf, endereco: 'Rua das Flores', numero: '10', bairro: 'Centro', cidade: 'Barra Bonita', uf: 'SP', cep: '17340000' },
    veiculo: { marca_modelo: 'GM Meriva Joy 1.4', ano_fab: 2011, ano_mod: 2011, cor: 'Prata', placa, chassi: '9BGXL75XBC0000000', tipo_entrada: 'consignacao', valor_compra: 3400000 },
  });
  const g = await nfe.gerarNota(id, 'entrada_consignacao', { ficha: FICHA, numero, ncm: '87032210', valor: 3400000, data: '2026-10-15T10:00', homologacao, xml: true });
  const prot = `<protNFe versao="4.00"><infProt><tpAmb>${homologacao ? 2 : 1}</tpAmb><chNFe>${g.chave}</chNFe><dhRecbto>2026-10-15T10:01:02-03:00</dhRecbto><nProt>135260000000009</nProt><cStat>100</cStat><xMotivo>Autorizado</xMotivo></infProt></protNFe>`;
  return { id, g, xml: `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe xmlns="http://www.portalfiscal.inf.br/nfe">${g.xml}</NFe>${prot}</nfeProc>` };
}

test('lista só as notas reais do mês (XML do site ou anexado), separa as sem XML e ignora teste e outros meses', async () => {
  const a = await criarNota('AAA1B11', '52998224725', 2001, false); // direta pelo site: XML só no envio
  db.conexao.prepare("INSERT INTO nfe_envios (veiculo_id, tipo, ambiente, numero, chave, situacao, protocolo, xml) VALUES (?, 'entrada_consignacao', 'producao', 2001, ?, 'autorizada', '1', ?)").run(a.id, a.g.chave, a.xml);
  const b = await criarNota('BBB1B22', '11144477735', 2002, false); // do Emissor, XML anexado
  db.conexao.prepare('UPDATE nfe_notas SET xml_autorizado = ? WHERE chave = ?').run(b.xml, b.g.chave);
  await criarNota('CCC1B33', '39053344705', 2003, false); // do Emissor, sem XML
  const t = await criarNota('DDD1B44', '16899535009', 2004, true); // teste
  db.conexao.prepare("INSERT INTO nfe_envios (veiculo_id, tipo, ambiente, numero, chave, situacao, protocolo, xml) VALUES (?, 'entrada_consignacao', 'homologacao', 2004, ?, 'autorizada', '1', ?)").run(t.id, t.g.chave, t.xml);

  const r = notas.listar('2026-10');
  assert.deepEqual(r.itens.map(i => i.numero), [2001, 2002]);
  assert.ok(r.itens[0].pdf.startsWith('/danfe/') && r.itens[1].pdf.startsWith('/danfe-nota/'));
  assert.equal(r.itens[0].valor, 3400000);
  assert.equal(notas.listar('2026-09').itens.length, 0);
  assert.throws(() => notas.listar('10/2026'), /AAAA-MM/);
});

test('ZIP do mês: arquivos XML e PDF de cada nota, resumo e cabeçalhos conferem', () => {
  const r = notas.zipDoMes('2026-10');
  const z = r.zip;
  const fim = z.length - 22;
  assert.equal(z.readUInt32LE(fim), 0x06054b50);
  const n = z.readUInt16LE(fim + 10);
  let p = z.readUInt32LE(fim + 16);
  const nomes = [];
  for (let i = 0; i < n; i++) {
    const tam = z.readUInt32LE(p + 20), nomeLen = z.readUInt16LE(p + 28), local = z.readUInt32LE(p + 42);
    const nome = z.slice(p + 46, p + 46 + nomeLen).toString('utf8');
    nomes.push(nome);
    const dados = z.slice(local + 30 + nomeLen, local + 30 + nomeLen + tam);
    assert.equal(zlib.crc32 ? zlib.crc32(dados) : notas.crc32(dados), z.readUInt32LE(p + 16), 'CRC de ' + nome);
    p += 46 + nomeLen;
  }
  assert.equal(nomes.filter(x => x.endsWith('.xml')).length, 2);
  assert.equal(nomes.filter(x => x.endsWith('.pdf')).length, 2);
  assert.ok(nomes.includes('resumo.csv'));
  assert.equal(r.quantidade, 2);
  assert.throws(() => notas.zipDoMes('2026-09'), /Não há notas/);
});

test('entrada de compra: PIX sai com tPag 17 e grupo card; depósito sai com tPag 16', async () => {
  const { id } = db.criarCompra({
    pessoa: { nome: 'Fulano Vendedor', cpf: '86924249868', endereco: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'Americana', uf: 'SP', cep: '13478540' },
    veiculo: { marca_modelo: 'VW Fox 1.6 Plus', ano_fab: 2008, ano_mod: 2009, cor: 'Prata', placa: 'PAG1A23', chassi: '9BWAB05Z394087944', tipo_entrada: 'compra', valor_compra: 2200000 },
  });
  const pix = await nfe.gerarNota(id, 'entrada_compra', { ficha: FICHA, numero: 3001, ncm: '87032210', valor: 2200000, data: '2026-11-19T10:00', xml: true });
  assert.match(pix.xml, /<tPag>17<\/tPag><vPag>22000.00<\/vPag><card><tpIntegra>2<\/tpIntegra><\/card>/);
  assert.match(pix.xml, /<indIEDest>9<\/indIEDest>/);
  const dep = await nfe.gerarNota(id, 'entrada_compra', { ficha: FICHA, numero: 3001, ncm: '87032210', valor: 2200000, data: '2026-11-19T10:00', xml: true, pagamento: 'deposito' });
  assert.match(dep.xml, /<tPag>16<\/tPag><vPag>22000.00<\/vPag><\/detPag>/);
  assert.ok(dep.conteudo.includes('YA01|0|16|'));
});
