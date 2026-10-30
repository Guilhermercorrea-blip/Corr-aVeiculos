'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dados = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'correa-site-test-'));
process.on('exit', () => { try { sql.close(); } catch {} fs.rmSync(dados, { recursive: true, force: true }); });
process.env.PASTA_DADOS = dados;
const db = require(path.join(root, 'db'));
const auth = require(path.join(root, 'auth'));
const { conexao: sql } = db;
auth.criarUsuario({ nome: 'Equipe de demonstração', usuario: 'teste-site', senha: 'TesteLocal123' });
const veiculo = (titulo, placa) => db.criarCompra({ pessoa: { nome: 'Cliente fictício', cpf: '52998224725' }, veiculo: { marca_modelo: titulo, placa, renavam: '12345678900', chassi: 'CHASSI-PRIVADO', ano_fab: 2020, ano_mod: 2021, cor: 'Prata', combustivel: 'Flex', km_entrada: 45000, tipo_entrada: 'compra', valor_compra: 3100000, obs: 'Observação interna privada' } }).id;
const carro1 = veiculo('Demonstração · VW Gol 1.0', 'ABC1D23');
const carro2 = veiculo('Demonstração · Chevrolet Onix', 'XYZ9A87');
function foto(carro, tipo = 'foto_veiculo', tipoMime = 'image/jpeg') {
  const f = db.criarAnexo({ conteudo: fs.readFileSync(path.join(root, 'public/img/banner.jpg')), tipoMime, nomeOriginal: 'arquivo-teste.jpg' });
  db.definirTipoAnexo(f, tipo);
  sql.prepare('UPDATE anexos SET veiculo_id = ? WHERE id = ?').run(carro, f);
  return f;
}
const f1 = foto(carro1), f2 = foto(carro1), doc = foto(carro1, 'cnh'), painel = foto(carro1, 'hodometro'), fotoOutro = foto(carro2), pdf = foto(carro1, 'foto_veiculo', 'application/pdf');
db.salvarConfig({ representante: 'Representante privado', representante_cpf: '99999999999' });
const anuncios = require(path.join(root, 'anuncios'));
let checks = 0;
const check = (cond, mensagem) => { assert.ok(cond, mensagem); checks++; };
const entrada = (extra = {}) => ({ titulo: 'Demonstração · VW Gol 1.0', descricao: 'Descrição pública de teste', preco: 4590000, publicado: false, destaque: true, fotos: [f2, f1], ...extra });
async function main() {
  check(anuncios.catalogo().carros.length === 0, 'Estoque não é publicado automaticamente');
  check(sql.prepare('SELECT COUNT(*) AS n FROM veiculos').get().n === 2, 'Inicialização preserva dados anteriores');
  anuncios.salvarAnuncio(carro1, entrada());
  check(anuncios.catalogo().carros.length === 0, 'Rascunho continua privado');
  for (const extra of [{ fotos: [doc] }, { fotos: [painel] }, { fotos: [fotoOutro] }, { fotos: [pdf] }, { fotos: [f1, f1] }, { preco: -1 }, { preco: 1.2 }, { preco: '4590000' }, { titulo: '' }, { publicado: 'true' }, { destaque: 1 }, { fotos: [] , preco: undefined }]) {
    assert.throws(() => anuncios.salvarAnuncio(carro1, entrada(extra))); checks++;
  }
  assert.throws(() => anuncios.fotoPublica(carro1, f1), { status: 404 }); checks++;
  anuncios.salvarAnuncio(carro1, entrada({ publicado: true }));
  let catalogo = anuncios.catalogo();
  check(catalogo.carros.length === 1 && catalogo.carros[0].fotos[0].id === f2, 'Publicação respeita seleção e capa');
  assert.deepEqual(Object.keys(catalogo.carros[0]).sort(), ['id', 'titulo', 'descricao', 'preco', 'destaque', 'ano_fab', 'ano_mod', 'cor', 'combustivel', 'km', 'fotos'].sort()); checks++;
  const publico = JSON.stringify(catalogo);
  for (const segredo of ['52998224725', '99999999999', 'Cliente fictício', 'Representante privado', 'ABC1D23', 'CHASSI-PRIVADO', '3100000', 'Observação interna privada']) check(!publico.includes(segredo), 'API pública não expõe ' + segredo);
  check(anuncios.fotoPublica(carro1, f1).tipo === 'foto_veiculo', 'Foto selecionada liberada');
  for (const id of [doc, painel, fotoOutro, pdf]) { assert.throws(() => anuncios.fotoPublica(carro1, id), { status: 404 }); checks++; }
  anuncios.retirarAnuncio(carro1);
  assert.throws(() => anuncios.anuncioPublico(carro1), { status: 404 }); checks++;
  assert.throws(() => anuncios.fotoPublica(carro1, f1), { status: 404 }); checks++;
  anuncios.salvarAnuncio(carro1, entrada({ publicado: true }));
  db.registrarVenda(carro1, { pessoa: { nome: 'Comprador fictício', cpf: '11144477735' }, venda: { vendido_em: '2026-10-30T10:00', km_saida: 45000, valor_venda: 4590000, meios_pagamento: ['pix'], valor_pix: 4590000 } });
  check(anuncios.catalogo().carros.length === 0, 'Venda retira carro da vitrine automaticamente');
  assert.throws(() => anuncios.fotoPublica(carro1, f1), { status: 404 }); checks++;
  assert.throws(() => anuncios.salvarAnuncio(carro1, entrada({ publicado: true }))); checks++;
  db.desfazerVenda(carro1);
  anuncios.salvarAnuncio(carro1, entrada({ publicado: true }));
  anuncios.salvarAnuncio(carro2, entrada({ titulo: 'Demonstração · Chevrolet Onix', preco: null, destaque: false, publicado: true, fotos: [] }));
  check(anuncios.anuncioPublico(carro2).carro.preco === null, 'Sob consulta independente do custo');
  for (const dados of [{ instagram: 'javascript:alert(1)' }, { instagram: 'https://instagram.com.evil.example/' }, { nome: '' }, { whatsapp: '123' }, { nome: {} }]) { assert.throws(() => anuncios.configurarSite(dados)); checks++; }
  anuncios.configurarSite({ nome: 'Corrêa Veículos', whatsapp: '(14) 99887-0734', horario: 'Horário de teste', representante_cpf: 'NAO-PODE-SAIR' });
  check(!('representante_cpf' in anuncios.configPublica()), 'Config pública ignora campos privados');
  check(db.obterConfig().representante_cpf === '99999999999', 'Alterações do site não afetam contratos');
  check(sql.prepare('PRAGMA quick_check').get().quick_check === 'ok', 'Banco íntegro');
  check(sql.prepare('PRAGMA foreign_key_check').all().length === 0, 'Vínculos íntegros');
  sql.close();
  const bootstrap = path.join(__dirname, 'fixtures', 'servidor.cjs');
  const child = fork(bootstrap, [], { cwd: root, env: { ...process.env, SITE_TEST_ROOT: root, PASTA_DADOS: dados, PORT: '3000' }, silent: true });
  let log = ''; child.stderr.on('data', b => { log += b; });
  try {
    const port = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Timeout servidor: ' + log)), 20000); child.once('message', m => { clearTimeout(timer); resolve(m.port); }); child.once('exit', c => reject(new Error('Servidor encerrou: ' + c + log))); });
    const base = 'http://127.0.0.1:' + port;
    const request = async (p, opts = {}) => fetch(base + p, { redirect: 'manual', ...opts });
    for (const p of ['/', '/loja.js', '/loja.css', '/carro/' + carro1, '/api/publico/catalogo', '/api/publico/carros/' + carro1]) check((await request(p)).status === 200, 'Rota pública ' + p);
    for (const p of ['/sistema', '/index.html', '/acesso.html', '/anuncios.html', '/anuncios.js', '/anexos/' + f1, '/contrato/' + carro1 + '/compra']) check((await request(p)).status === 302, 'Login obrigatório ' + p);
    for (const p of ['/api/resumo', '/api/pessoas', '/api/config', '/api/site/anuncios', '/api/site/config']) check((await request(p)).status === 401, 'API privada ' + p);
    for (const p of ['/img/..%2findex.html', '/img/%252e%252e%252findex.html', '/img/..%5cindex.html']) check((await request(p)).status === 400, 'Caminho público não contorna login');
    for (const id of [doc, painel, pdf, fotoOutro]) check((await request(`/midia/anuncios/${carro1}/${id}`)).status === 404, 'Documento privado via mídia pública');
    let r = await request(`/midia/anuncios/${carro1}/${f1}`);
    check(r.status === 200 && r.headers.get('cache-control').includes('no-store'), 'Mídia selecionada sem cache persistente');
    r = await request('/api/site/anuncios/' + carro1, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entrada({ publicado: true })) });
    check(r.status === 401, 'Visitante não pode editar anúncio');

    r = await request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'teste-site', senha: 'TesteLocal123' }) });
    check(r.status === 200, 'Login continua disponível');
    const cookie = r.headers.get('set-cookie').split(';')[0];
    for (const pagina of ['/acesso.html', '/sistema', '/anuncios.html']) check((await request(pagina, { headers: { cookie } })).status === 200, 'Área autenticada ' + pagina);
    r = await request('/api/site/anuncios/' + carro1, { method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(entrada({ publicado: true, preco: 4790050 })) });
    check(r.status === 200, 'Usuário pode editar anúncio');
    r = await request('/api/publico/carros/' + carro1);
    check((await r.json()).carro.preco === 4790050, 'Preço do anúncio atualizado por API');
    r = await request('/api/site/anuncios/' + carro1, { method: 'DELETE', headers: { cookie } });
    check(r.status === 200, 'Usuário pode retirar anúncio');
    check((await request('/api/publico/carros/' + carro1)).status === 404, 'Retirada fecha anúncio público');
    check((await request('/midia/anuncios/' + carro1 + '/' + f1)).status === 404, 'Retirada fecha fotos públicas');
    r = await request('/api/logout', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
    check(r.status === 200, 'Saída encerra sessão');
    check((await request('/api/site/anuncios', { headers: { cookie } })).status === 401, 'Sessão encerrada não acessa anúncios');
    console.log(JSON.stringify({ ok: true, verificacoes: checks }));
  } finally { child.kill(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
