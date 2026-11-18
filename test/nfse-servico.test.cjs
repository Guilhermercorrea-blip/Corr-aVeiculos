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

const donoConsig = { nome: 'Dona Maria Consignante', cpf: '52998224725', endereco: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'Barra Bonita', uf: 'SP', cep: '17340000' };
const carroConsig = { marca_modelo: 'Fiat Uno Mille', ano_fab: 2010, ano_mod: 2010, cor: 'Branco', placa: 'UNO1A11', tipo_entrada: 'consignacao', valor_compra: 2000000 };

test('nota ao dono de carro consignado: lista os carros, prévia com dono e carro, aviso de duplicidade', async t => {
  const { id } = db.criarCompra({ pessoa: donoConsig, veiculo: carroConsig });
  const lista = servico.listar().carrosConsignados;
  const c = lista.find(x => x.id === id);
  assert.equal(c.dono, 'Dona Maria Consignante');
  assert.equal(c.cpfOk, true);
  const p = servico.previa({ tomador: 'cliente-consignacao', veiculo_id: id, valor: 50000, competencia: '2026-11-05' });
  assert.equal(p.banco, 'DONA MARIA CONSIGNANTE');
  assert.equal(p.documento, 'CPF 52998224725');
  assert.match(p.descricao, /VENDA DE VEICULO CONSIGNADO - FIAT UNO MILLE 2010\/2010 BRANCO PLACA UNO1A11 - COMISSAO REF\. 11\/2026/);
  assert.equal(p.iss, 1500);
  assert.deepEqual(p.avisos, []);
  if (!temOpenssl) return;
  const original = nfse.enviarDps;
  nfse.enviarDps = async () => ({ status: 201, json: {}, nfseXml: '<NFSe/>', chaveAcesso: CHAVE });
  try {
    await servico.emitir({ tomador: 'cliente-consignacao', veiculo_id: id, valor: 50000, competencia: '2026-11-05', senha: 'abc123', confirmar: true });
    const nota = servico.listar().notas[0];
    assert.equal(nota.veiculo_id, id);
    assert.equal(nota.tomador_nome, 'Dona Maria Consignante');
    const de_novo = servico.previa({ tomador: 'cliente-consignacao', veiculo_id: id, valor: 50000, competencia: '2026-11-05' });
    assert.match(de_novo.avisos[0], /Já existe a nota nº 5/);
    assert.equal(servico.listar().carrosConsignados.find(x => x.id === id).notaEmitida, '5');
  } finally { nfse.enviarDps = original; }
});

test('nota de consignado: recusa carro que não é consignado, sem CPF válido ou sem escolher', () => {
  const compra = db.criarCompra({ pessoa: { ...donoConsig, cpf: '11144477735' }, veiculo: { ...carroConsig, placa: 'CMP1A11', tipo_entrada: 'compra' } });
  assert.throws(() => servico.previa({ tomador: 'cliente-consignacao', veiculo_id: compra.id, valor: 1000, competencia: '2026-11-05' }), /não é de consignação/);
  const semCpf = db.criarCompra({ pessoa: { nome: 'Sem Documento Algum' }, veiculo: { ...carroConsig, placa: 'SEM1A11' } });
  assert.throws(() => servico.previa({ tomador: 'cliente-consignacao', veiculo_id: semCpf.id, valor: 1000, competencia: '2026-11-05' }), /CPF válido/);
  assert.throws(() => servico.previa({ tomador: 'cliente-consignacao', valor: 1000, competencia: '2026-11-05' }), /Escolha o carro/);
  assert.throws(() => servico.previa({ tomador: 'cliente-consignacao', veiculo_id: 999999, valor: 1000, competencia: '2026-11-05' }), /Escolha o carro/);
});
