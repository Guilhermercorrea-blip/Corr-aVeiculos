'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const dados = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'correa-avaliacoes-test-'));
process.env.PASTA_DADOS = dados;
const db = require('../db');
const a = require('../avaliacoes');

test('convite privado, telefone brasileiro, confirmação explícita e nova venda', async () => {
  let child;
  try {
    for (const n of ['(14) 99887-0734', '+55 (14) 99887-0734', '5514998870734', '005514998870734']) assert.equal(a.telefoneWhatsApp(n), '5514998870734');
    assert.equal(a.telefoneWhatsApp('(55) 3222-1234'), '555532221234');
    for (const n of ['', '998870734', '0014998870734', '123', '14 99887-0734 ramal 2', '00999999999']) assert.equal(a.telefoneWhatsApp(n), null);
    const id = db.criarCompra({ pessoa: { nome: 'Fornecedor fictício' }, veiculo: { marca_modelo: 'Carro fictício', tipo_entrada: 'compra', valor_compra: 1000000 } }).id;
    assert.throws(() => a.obter(id), e => e.status === 409);
    const vender = telefone => db.registrarVenda(id, { pessoa: { nome: 'Ana Teste', telefone }, venda: { km_saida: 100, valor_venda: 1500000, forma_pagamento: 'avista', valor_pix: 1500000 } });
    vender('(14) 99999-1234');
    const convite = a.obter(id);
    const url = new URL(convite.url);
    assert.equal(url.hostname, 'wa.me');
    assert.equal(url.pathname, '/5514999991234');
    assert.equal(url.searchParams.get('text'), convite.mensagem);
    assert.match(convite.mensagem, /^Olá, Ana!/);
    assert.ok(convite.mensagem.includes('https://g.page/r/CVnf0nCRZDLVEBM/review'));
    assert.ok(!convite.mensagem.includes('1500000'));
    assert.equal(a.obter(id).confirmado_em, null); // Ler/preparar não confirma nem envia.
    assert.equal(db.conexao.prepare('SELECT count(*) AS n FROM avaliacao_convites').get().n, 0);
    assert.throws(() => a.confirmar(id, { venda_id: -1 }), e => e.status === 409);
    const confirmado = a.confirmar(id, { venda_id: convite.venda_id });
    assert.ok(confirmado.confirmado_em);
    assert.equal(a.confirmar(id, { venda_id: convite.venda_id }).confirmado_em, confirmado.confirmado_em);
    db.desfazerVenda(id);
    assert.equal(db.conexao.prepare('SELECT count(*) AS n FROM avaliacao_convites').get().n, 0);
    vender('123');
    assert.equal(a.obter(id).url, null);
    assert.equal(a.obter(id).confirmado_em, null);

    require('../auth').criarUsuario({ nome: 'Teste', usuario: 'teste-avaliacao', senha: 'TesteLocal123' });
    child = fork(path.join(__dirname, 'fixtures/servidor.cjs'), [], { env: { ...process.env, SITE_TEST_ROOT: path.resolve(__dirname, '..') }, silent: true });
    let erro = ''; child.stderr.on('data', b => erro += b);
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Servidor não iniciou: ' + erro)), 20000);
      child.once('message', m => { clearTimeout(timer); resolve(m.port); });
      child.once('exit', n => { clearTimeout(timer); reject(new Error('Servidor encerrou: ' + n + erro)); });
    });
    const base = 'http://127.0.0.1:' + port;
    const endpoint = `/api/veiculos/${id}/avaliacao`;
    assert.equal((await fetch(base + endpoint)).status, 401);
    assert.equal((await fetch(base + endpoint + '/enviado', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'teste-avaliacao', senha: 'TesteLocal123' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const r = await fetch(base + endpoint, { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    const atual = await r.json();
    assert.equal(atual.confirmado_em, null);
    const salvo = await fetch(base + endpoint + '/enviado', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ venda_id: atual.venda_id }) });
    assert.equal(salvo.status, 200);
    assert.ok((await salvo.json()).confirmado_em);
  } finally {
    if (child && child.exitCode === null) { const fim = new Promise(r => child.once('exit', r)); child.kill(); await fim; }
    db.conexao.close();
    fs.rmSync(dados, { recursive: true, force: true });
  }
});
