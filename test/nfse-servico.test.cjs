'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
process.env.PASTA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'correa-nfse-test-'));
const db = require('../db');
const nfse = require('../nfse');

// Certificado de mentira para os testes (a Receita é simulada)
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-cert-'));
let temOpenssl = true;
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(pasta, 'k.pem'), '-out', path.join(pasta, 'c.pem'), '-days', '2', '-subj', '/CN=TESTE'], { stdio: 'pipe' });
  execFileSync('openssl', ['pkcs12', '-export', '-inkey', path.join(pasta, 'k.pem'), '-in', path.join(pasta, 'c.pem'), '-out', path.join(pasta, 'c.pfx'), '-passout', 'pass:abc123'], { stdio: 'pipe' });
  process.env.NFSE_PFX = path.join(pasta, 'c.pfx');
} catch { temOpenssl = false; }
delete process.env.NFSE_AMBIENTE;
const servico = require('../nfse-servico');

const pedido = { tomador: 'santander-financiamento', valor: 61165, competencia: '2026-11-05' };
const CHAVE = '35053022207793106000139' + '0000000000005' + '261005569' + '681821';

test('prévia mostra o que será emitido e o próximo número, sem gravar nada', () => {
  const p = servico.previa(pedido);
  assert.equal(p.ambiente, 'teste');
  assert.equal(p.codigo, '100201');
  assert.equal(p.valor, 61165);
  assert.equal(p.iss, 1835);
  assert.equal(p.numeroDps, 1);
  assert.match(p.descricao, /COMISSAO REF\. 11\/2026/);
  assert.equal(servico.proximoNumero('teste'), 1);
});

test('recusa pedido inválido', () => {
  assert.throws(() => servico.previa({ ...pedido, tomador: 'x' }), /banco/);
  assert.throws(() => servico.previa({ ...pedido, valor: 0 }), /valor/);
  assert.throws(() => servico.previa({ ...pedido, valor: 9999999 }), /acima/);
  assert.throws(() => servico.previa({ ...pedido, competencia: '2999-01-01' }), /futura/);
  assert.throws(() => servico.previa({ ...pedido, ticket: '123' }), /ticket/);
  assert.throws(() => servico.previa({ ...pedido, tomador: 'santander-seguros' }), /ticket/);
});

test('sem confirmar na tela, não envia nada', async t => {
  if (!temOpenssl) return t.skip('sem openssl');
  await assert.rejects(servico.emitir({ ...pedido, senha: 'abc123' }), /Confirme/);
  assert.equal(db.conexao.prepare('SELECT COUNT(*) n FROM nfse_notas').get().n, 0);
});

test('nota emitida: grava a chave e o número da NFS-e e o próximo DPS avança', async t => {
  if (!temOpenssl) return t.skip('sem openssl');
  const original = nfse.enviarDps;
  nfse.enviarDps = async () => ({ status: 201, json: {}, nfseXml: '<NFSe/>', chaveAcesso: CHAVE });
  try {
    const r = await servico.emitir({ ...pedido, senha: 'abc123', confirmar: true });
    assert.equal(r.numero, '5');
    assert.equal(servico.proximoNumero('teste'), 2);
    const l = servico.listar();
    assert.equal(l.notas[0].status, 'emitida');
    assert.equal(l.notas[0].chave, CHAVE);
    assert.equal(servico.xmlDaNota(r.id).conteudo, '<NFSe/>');
  } finally { nfse.enviarDps = original; }
});

test('senha errada não gasta número', async t => {
  if (!temOpenssl) return t.skip('sem openssl');
  const antes = servico.proximoNumero('teste');
  await assert.rejects(servico.emitir({ ...pedido, senha: 'errada', confirmar: true }));
  assert.equal(servico.proximoNumero('teste'), antes);
});

test('recusa da Receita fica registrada com o motivo', async t => {
  if (!temOpenssl) return t.skip('sem openssl');
  const original = nfse.enviarDps;
  nfse.enviarDps = async () => ({ status: 400, json: { erros: [{ Codigo: 'E0037', Descricao: 'município inexistente' }] } });
  try {
    await assert.rejects(servico.emitir({ ...pedido, senha: 'abc123', confirmar: true }), /E0037/);
    const n = servico.listar().notas[0];
    assert.equal(n.status, 'recusada');
    assert.match(n.mensagem, /município inexistente/);
  } finally { nfse.enviarDps = original; }
});

test('queda de conexão: marca como incerta e manda conferir no portal', async t => {
  if (!temOpenssl) return t.skip('sem openssl');
  const original = nfse.enviarDps;
  nfse.enviarDps = async () => { throw new Error('socket hang up'); };
  try {
    await assert.rejects(servico.emitir({ ...pedido, senha: 'abc123', confirmar: true }), /NÃO envie de novo/);
    assert.equal(servico.listar().notas[0].status, 'incerta');
  } finally { nfse.enviarDps = original; }
});

test('sem certificado neste computador, a emissão fica desligada', () => {
  const guardado = process.env.NFSE_PFX;
  process.env.NFSE_PFX = path.join(pasta, 'nao-existe.pfx');
  try { assert.equal(servico.listar().habilitado, false); } finally { process.env.NFSE_PFX = guardado; }
});
