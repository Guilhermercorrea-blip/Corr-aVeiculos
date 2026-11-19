'use strict';
// Correções da revisão de 19/11/2026: nota fiscal guardada, nota autorizada travada, envio sem resposta, devolução
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
process.env.PASTA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'correa-revisao-test-'));
delete process.env.NFE_AMBIENTE;

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'revisao-cert-'));
let temOpenssl = true;
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(pasta, 'k.pem'), '-out', path.join(pasta, 'c.pem'), '-days', '2', '-subj', '/CN=TESTE'], { stdio: 'pipe' });
  execFileSync('openssl', ['pkcs12', '-export', '-inkey', path.join(pasta, 'k.pem'), '-in', path.join(pasta, 'c.pem'), '-out', path.join(pasta, 'c.pfx'), '-passout', 'pass:abc123'], { stdio: 'pipe' });
  process.env.NFSE_PFX = path.join(pasta, 'c.pfx');
} catch { temOpenssl = false; }

const db = require('../db');
const nfe = require('../nfe');
const sefaz = require('../nfe-sefaz');
const direta = require('../nfe-direta');

const FICHA = { motor: 'ABC123456', potencia: 80, cilindrada: 1400, peso: '1.5', cmt: '1.9', eixos: 2, combustivel: '16', tipo: '06', especie: '1', lotacao: 5, cor: '10', pintura: 'S', marca_modelo: '1' };
const CPFS = ['52998224725', '11144477735', '39053344705', '16899535009', '45317828791', '86924249868', '28208385883'];
let n = 0;
function carro(extra = {}) {
  const i = n++;
  return db.criarCompra({
    pessoa: { nome: 'Fulana de Teste', cpf: CPFS[i], endereco: 'Rua das Flores', numero: '10', bairro: 'Centro', cidade: 'Barra Bonita', uf: 'SP', cep: '17340000' },
    veiculo: { marca_modelo: 'GM Meriva Joy 1.4', ano_fab: 2011, ano_mod: 2011, cor: 'Prata', placa: `REV1A${10 + i}`, chassi: '9BGXL75XBC0000000', tipo_entrada: 'consignacao', valor_compra: 3400000, ...extra },
  }).id;
}
const pedido = numero => ({ ficha: FICHA, numero, ncm: '87032210', valor: 3400000, senha: 'abc123', confirmar: true, confirmarProducao: true });
const trocar = async (obj, nome, fn, corpo) => { const o = obj[nome]; obj[nome] = fn; try { return await corpo(); } finally { obj[nome] = o; } };

test('carro com nota fiscal autorizada não pode ser excluído', async () => {
  const id = carro();
  await nfe.gerarNota(id, 'entrada_consignacao', { ficha: FICHA, numero: 7000, ncm: '87032210', valor: 3400000 });
  db.conexao.prepare("UPDATE nfe_notas SET xml_autorizado = '<x/>', protocolo = '1' WHERE numero = 7000").run();
  assert.throws(() => db.excluirVeiculo(id), /NF-e nº 7000/);
  assert.equal(db.conexao.prepare('SELECT COUNT(*) n FROM nfe_notas WHERE numero = 7000').get().n, 1);
  const semNota = carro();
  assert.deepEqual(db.excluirVeiculo(semNota), { ok: true });
});

test('nota já autorizada não pode ser gerada de novo (a chave não muda)', async () => {
  const id = carro();
  const g = await nfe.gerarNota(id, 'entrada_consignacao', { ficha: FICHA, numero: 7010, ncm: '87032210', valor: 3400000 });
  db.conexao.prepare("UPDATE nfe_notas SET xml_autorizado = '<x/>', protocolo = '1' WHERE numero = 7010").run();
  await assert.rejects(nfe.gerarNota(id, 'entrada_consignacao', { ficha: FICHA, numero: 7010, ncm: '87032210', valor: 3400000 }), /já está autorizada/);
  assert.equal(db.conexao.prepare('SELECT chave FROM nfe_notas WHERE numero = 7010').get().chave, g.chave);
});

test('envio sem resposta: na próxima vez consulta a chave e recupera a nota autorizada, sem emitir outra', async t => {
  if (!temOpenssl) return t.skip('sem openssl');
  process.env.NFE_AMBIENTE = 'producao';
  try {
    const id = carro();
    await trocar(sefaz, 'autorizar', async () => { throw new Error('socket hang up'); }, () => assert.rejects(direta.emitir(id, 'entrada_consignacao', pedido(7020)), /NÃO emita de novo/));
    const pend = db.conexao.prepare('SELECT chave, xml FROM nfe_envios WHERE veiculo_id = ?').get(id);
    assert.ok(pend.xml.includes('<Signature'), 'XML assinado guardado antes do envio');
    let enviou = false;
    const prot = `<protNFe versao="4.00"><infProt><tpAmb>1</tpAmb><chNFe>${pend.chave}</chNFe><dhRecbto>2026-11-19T10:01:02-03:00</dhRecbto><nProt>135269999999999</nProt><cStat>100</cStat><xMotivo>Autorizado</xMotivo></infProt></protNFe>`;
    const r = await trocar(sefaz, 'consultarChave', async () => ({ cStat: '100', cStatProt: '100', protocolo: '135269999999999', protXml: prot }),
      () => trocar(sefaz, 'autorizar', async () => { enviou = true; return {}; }, () => direta.emitir(id, 'entrada_consignacao', pedido(7021))));
    assert.equal(enviou, false, 'não pode mandar outra nota');
    assert.equal(r.recuperada, true);
    assert.equal(r.numero, 7020);
    assert.equal(db.conexao.prepare('SELECT situacao FROM nfe_envios WHERE veiculo_id = ?').get(id).situacao, 'autorizada');
    assert.ok(db.conexao.prepare('SELECT xml_autorizado x FROM nfe_notas WHERE numero = 7020').get().x.includes('<nfeProc'));
    assert.throws(() => db.excluirVeiculo(id), /NF-e/);
  } finally { delete process.env.NFE_AMBIENTE; }
});

test('resposta sem o resultado da nota fica "conferir"; consulta 217 libera emitir de novo', async t => {
  if (!temOpenssl) return t.skip('sem openssl');
  process.env.NFE_AMBIENTE = 'producao';
  try {
    const id = carro();
    await trocar(sefaz, 'autorizar', async () => ({ cStatLote: '104', xMotivoLote: 'Lote processado' }), () => assert.rejects(direta.emitir(id, 'entrada_consignacao', pedido(7030)), /sem dizer se autorizou/));
    assert.equal(db.conexao.prepare('SELECT situacao FROM nfe_envios WHERE veiculo_id = ?').get(id).situacao, 'incerta');
    const r = await trocar(sefaz, 'consultarChave', async () => ({ cStat: '217', xMotivo: 'NF-e não consta na base' }),
      () => trocar(sefaz, 'autorizar', async () => ({ cStat: '100', xMotivo: 'Autorizado', nProt: '135260000000077', nfeProc: '<nfeProc/>' }), () => direta.emitir(id, 'entrada_consignacao', pedido(7030))));
    assert.equal(r.protocolo, '135260000000077');
    assert.deepEqual(db.conexao.prepare('SELECT situacao FROM nfe_envios WHERE veiculo_id = ? ORDER BY id').all(id).map(e => e.situacao), ['rejeitada', 'autorizada']);
  } finally { delete process.env.NFE_AMBIENTE; }
});

test('duplo clique: a segunda emissão do mesmo carro espera a primeira', async t => {
  if (!temOpenssl) return t.skip('sem openssl');
  const id = carro();
  let soltar;
  const espera = new Promise(r => { soltar = r; });
  await trocar(sefaz, 'autorizar', async () => { await espera; return { cStat: '100', xMotivo: 'ok', nProt: '1', nfeProc: '<nfeProc/>' }; }, async () => {
    const primeira = direta.emitir(id, 'entrada_consignacao', pedido(7040));
    await new Promise(r => setTimeout(r, 50));
    await assert.rejects(direta.emitir(id, 'entrada_consignacao', pedido(7040)), /já está sendo enviada/);
    soltar();
    await primeira;
  });
});

test('devolução sugere a entrada autorizada, não um arquivo gerado depois e nunca transmitido', async () => {
  const id = carro();
  const boa = await nfe.gerarNota(id, 'entrada_consignacao', { ficha: FICHA, numero: 7050, ncm: '87032210', valor: 3400000 });
  db.conexao.prepare("UPDATE nfe_notas SET xml_autorizado = '<x/>', protocolo = '1' WHERE numero = 7050").run();
  db.conexao.prepare("INSERT INTO nfe_notas (veiculo_id, tipo, serie, numero, chave, valor) VALUES (?, 'entrada_consignacao', 1, 7051, '35261107793106000139550010000070511000000001', 3400000)").run(id);
  assert.equal(nfe.sugestao(id, 'devolucao_consignacao').referencia, boa.chave);
});
