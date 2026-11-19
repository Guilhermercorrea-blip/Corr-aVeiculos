'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const FICHA = { motor: 'ABC123456', potencia: 80, cilindrada: 1400, peso: '1.5', cmt: '1.9', eixos: 2, combustivel: '16', tipo: '06', especie: '1', lotacao: 5, cor: '10', pintura: 'S', marca_modelo: '1' };
const { execFileSync } = require('node:child_process');
process.env.PASTA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'correa-nfedireta-test-'));
delete process.env.NFE_AMBIENTE;

// Certificado de mentira (a SEFAZ é simulada)
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nfe-direta-cert-'));
let temOpenssl = true;
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(pasta, 'k.pem'), '-out', path.join(pasta, 'c.pem'), '-days', '2', '-subj', '/CN=TESTE'], { stdio: 'pipe' });
  execFileSync('openssl', ['pkcs12', '-export', '-inkey', path.join(pasta, 'k.pem'), '-in', path.join(pasta, 'c.pem'), '-out', path.join(pasta, 'c.pfx'), '-passout', 'pass:abc123'], { stdio: 'pipe' });
  process.env.NFSE_PFX = path.join(pasta, 'c.pfx');
} catch { temOpenssl = false; }

const db = require('../db');
const sefaz = require('../nfe-sefaz');
const direta = require('../nfe-direta');

const pessoa = { nome: 'Fulana de Teste', cpf: '52998224725', endereco: 'Rua das Flores', numero: '10', bairro: 'Centro', cidade: 'Barra Bonita', uf: 'SP', cep: '17340000' };
const carro = { marca_modelo: 'GM Meriva Joy 1.4', ano_fab: 2011, ano_mod: 2011, cor: 'Prata', placa: 'AAA1B23', renavam: '00123456789', chassi: '9BGXL75XBC0000000', tipo_entrada: 'consignacao', valor_compra: 3400000 };
const pedido = { ficha: FICHA, numero: 1090, ncm: '87032210', valor: 3400000, senha: 'abc123', confirmar: true };
const comSefaz = async (resposta, fn) => {
  const original = sefaz.autorizar;
  sefaz.autorizar = typeof resposta === 'function' ? resposta : async () => resposta;
  try { return await fn(); } finally { sefaz.autorizar = original; }
};

test('estado: só as notas que o XML cobre, em homologação por padrão', () => {
  const { id } = db.criarCompra({ pessoa, veiculo: carro });
  assert.equal(direta.estado(id, 'entrada_consignacao').suportado, true);
  assert.equal(direta.estado(id, 'venda').suportado, false);
  assert.equal(direta.estado(id, 'entrada_consignacao').ambiente, 'homologacao');
});

test('sem confirmar ou com nota que não é suportada: não envia', async () => {
  const { id } = db.criarCompra({ pessoa: { ...pessoa, cpf: '11144477735' }, veiculo: { ...carro, placa: 'BBB1B23' } });
  await assert.rejects(direta.emitir(id, 'entrada_consignacao', { ...pedido, confirmar: false }), /Confirme/);
  await assert.rejects(direta.emitir(id, 'venda', pedido), /ainda não sai direto/);
});

test('homologação: número de teste, autorização registrada e XML para baixar, sem gastar a numeração real', async t => {
  if (!temOpenssl) return t.skip('sem openssl');
  const { id } = db.criarCompra({ pessoa: { ...pessoa, cpf: '39053344705' }, veiculo: { ...carro, placa: 'CCC1B23' } });
  let enviado;
  const r = await comSefaz(async (amb, xml) => { enviado = { amb, xml }; return { cStat: '100', xMotivo: 'Autorizado', nProt: '135260000000001', nfeProc: '<nfeProc>ok</nfeProc>' }; },
    () => direta.emitir(id, 'entrada_consignacao', pedido));
  assert.equal(enviado.amb, 'homologacao');
  assert.match(enviado.xml, /<tpAmb>2<\/tpAmb>/);
  assert.match(enviado.xml, /<IBSCBS>/);
  assert.ok(r.numero >= 800000000);
  assert.equal(r.protocolo, '135260000000001');
  const e = direta.estado(id, 'entrada_consignacao');
  assert.equal(e.envios[0].situacao, 'autorizada');
  assert.equal(direta.xmlDoEnvio(e.envios[0].id).conteudo, '<nfeProc>ok</nfeProc>');
  assert.equal(db.conexao.prepare('SELECT COUNT(*) n FROM nfe_notas WHERE veiculo_id = ?').get(id).n, 0, 'teste não reserva número real');
});

test('recusa e queda de conexão ficam registradas com o motivo', async t => {
  if (!temOpenssl) return t.skip('sem openssl');
  const { id } = db.criarCompra({ pessoa: { ...pessoa, cpf: '16899535009' }, veiculo: { ...carro, placa: 'DDD1B23' } });
  await comSefaz({ cStatLote: '104', cStat: '539', xMotivo: 'Duplicidade de NF-e' }, () => assert.rejects(direta.emitir(id, 'entrada_consignacao', pedido), /539: Duplicidade/));
  assert.equal(direta.estado(id, 'entrada_consignacao').envios[0].situacao, 'rejeitada');
  await comSefaz(async () => { throw new Error('socket hang up'); }, () => assert.rejects(direta.emitir(id, 'entrada_consignacao', pedido), /NÃO emita de novo/));
  assert.equal(direta.estado(id, 'entrada_consignacao').envios[0].situacao, 'incerta');
});

test('produção: exige confirmação de nota real, sai sem IBS/CBS, reserva o número e não deixa emitir duas vezes', async t => {
  if (!temOpenssl) return t.skip('sem openssl');
  process.env.NFE_AMBIENTE = 'producao';
  try {
    const { id } = db.criarCompra({ pessoa: { ...pessoa, cpf: '45317828791' }, veiculo: { ...carro, placa: 'EEE1B23' } });
    await assert.rejects(direta.emitir(id, 'entrada_consignacao', pedido), /nota real/);
    let enviado;
    await comSefaz(async (amb, xml) => { enviado = { amb, xml }; return { cStat: '100', xMotivo: 'Autorizado', nProt: '135260000000002', nfeProc: '<nfeProc/>' }; },
      () => direta.emitir(id, 'entrada_consignacao', { ...pedido, confirmarProducao: true }));
    assert.equal(enviado.amb, 'producao');
    assert.match(enviado.xml, /<tpAmb>1<\/tpAmb>/);
    assert.ok(!enviado.xml.includes('IBSCBS'));
    assert.match(enviado.xml, /<nNF>1090<\/nNF>/);
    assert.match(enviado.xml, /<xNome>FULANA DE TESTE<\/xNome>/);
    assert.equal(db.conexao.prepare('SELECT numero FROM nfe_notas WHERE veiculo_id = ?').get(id).numero, 1090);
    await assert.rejects(direta.emitir(id, 'entrada_consignacao', { ...pedido, confirmarProducao: true }), /já foi autorizada/);
  } finally { delete process.env.NFE_AMBIENTE; }
});
