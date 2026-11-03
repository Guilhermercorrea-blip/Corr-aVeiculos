'use strict';
// Postagem no Facebook e no Instagram contra uma Meta simulada (nenhuma chamada sai do computador).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dados = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'correa-redes-test-'));
process.env.PASTA_DADOS = dados;
process.env.ARQUIVO_CHAVE_META = path.join(dados, 'CHAVE-META.txt');
process.env.ENDERECO_PUBLICO = 'https://www.exemplo-loja.test';
process.env.META_ESPERA_MS = '5';
let servidor, sql;
process.on('exit', () => { try { sql.close(); } catch {} fs.rmSync(dados, { recursive: true, force: true }); });

// Meta simulada: guarda cada chamada e responde como a API Graph
const chamadas = [];
let falharFeed = false, igProcessando = 0;
function meta(req, res) {
  let corpo = '';
  req.on('data', c => corpo += c);
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const p = Object.fromEntries(new URLSearchParams(req.method === 'POST' ? corpo : url.search));
    const caminho = url.pathname.slice(1);
    chamadas.push({ metodo: req.method, caminho, p });
    const responde = (d, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };
    if (p.access_token !== 'TOKEN-PAGINA') return responde({ error: { message: 'Token inválido' } }, 400);
    if (caminho === 'PAGINA/feed' && falharFeed && p['attached_media[0]']) return responde({ error: { message: 'Recusado' } }, 400);
    if (caminho === 'PAGINA/photos') return responde(p.caption ? { id: 'FOTO', post_id: 'PAGINA_POST_FOTO' } : { id: 'FOTO' + chamadas.length });
    if (caminho === 'PAGINA/feed') return responde({ id: 'PAGINA_POST' });
    if (caminho === 'IG/media') return responde({ id: p.media_type === 'CAROUSEL' ? 'CARROSSEL' : 'ITEM' + chamadas.length });
    if (caminho === 'IG/media_publish') return igProcessando-- > 0 ? responde({ error: { message: 'Mídia ainda não está pronta' } }, 400) : responde({ id: 'IG_POST' });
    if (req.method === 'GET') return responde({ status_code: 'FINISHED' });
    responde({ error: { message: 'Rota inesperada ' + caminho } }, 404);
  });
}

async function main() {
  servidor = http.createServer(meta);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  process.env.META_GRAPH_URL = `http://127.0.0.1:${servidor.address().port}`;
  const db = require('../db'); sql = db.conexao;
  const p = require('../publicacoes');
  const redes = require('../redes-meta');
  let verificacoes = 0;
  const ok = (v, texto) => { assert.ok(v, texto); verificacoes++; };

  const imagem = fs.readFileSync(path.join(root, 'public/img/banner.jpg'));
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, ...Buffer.alloc(32)]);
  const anuncio = p.criar({ marca_modelo: 'Carro fictício de teste', titulo: 'Fictício 1.0 2020', descricao: 'Descrição de teste.', preco: 4590000 });
  const a = p.adicionarFoto(anuncio.id, { conteudo: imagem, tipoMime: 'image/jpeg', nomeOriginal: 'a.jpg' });
  const b = p.adicionarFoto(anuncio.id, { conteudo: png, tipoMime: 'image/png', nomeOriginal: 'b.png' });
  const c = p.adicionarFoto(anuncio.id, { conteudo: imagem, tipoMime: 'image/jpeg', nomeOriginal: 'c.jpg' });

  // Sem o arquivo de chaves: nada conectado e nada é enviado
  assert.deepEqual(redes.conexao(), { facebook: false, instagram: false }); verificacoes++;
  await assert.rejects(redes.postar(anuncio.id, { redes: ['facebook'] }), /não conectada/); verificacoes++;
  fs.writeFileSync(process.env.ARQUIVO_CHAVE_META, '# teste\nPAGE_ID=PAGINA\nPAGE_TOKEN=TOKEN-PAGINA\nIG_ID=IG\n');
  assert.deepEqual(redes.conexao(), { facebook: true, instagram: true }); verificacoes++;
  await assert.rejects(redes.postar(anuncio.id, { redes: [] }), /Escolha/); verificacoes++;
  await assert.rejects(redes.postar(anuncio.id, { redes: ['facebook'] }), e => e.status === 404); verificacoes++; // rascunho não vai para as redes
  ok(chamadas.length === 0, 'Nada foi enviado antes de publicar');

  const salvo = p.salvar(anuncio.id, { revisao: anuncio.revisao, situacao: 'publicado', fotos: [a.id, b.id, c.id] });
  let r = await redes.postar(salvo.id, { redes: ['facebook', 'instagram'] });
  ok(r.facebook.ok && r.facebook.post_id === 'PAGINA_POST', 'Facebook postado com várias fotos');
  ok(r.instagram.ok && r.instagram.post_id === 'IG_POST', 'Instagram postado em carrossel');
  const feed = chamadas.find(x => x.caminho === 'PAGINA/feed');
  ok(feed.p['attached_media[2]'] && !feed.p['attached_media[3]'], 'Post do Facebook leva as 3 fotos');
  ok(feed.p.message.includes('Fictício 1.0 2020') && feed.p.message.includes('R$') && feed.p.message.includes('Transparência, procedência e confiança'), 'Texto tem título, preço e o rodapé da loja');
  const fotosFb = chamadas.filter(x => x.caminho === 'PAGINA/photos');
  ok(fotosFb.every(x => x.p.published === 'false' && x.p.url.startsWith('https://www.exemplo-loja.test/')), 'Fotos vão pelo endereço público e sem publicar sozinhas');
  const itensIg = chamadas.filter(x => x.caminho === 'IG/media' && x.p.is_carousel_item === 'true');
  ok(itensIg.length === 2, 'Instagram recebe só as fotos JPG');
  const carrossel = chamadas.find(x => x.p.media_type === 'CAROUSEL');
  ok(carrossel.p.children.split(',').length === 2 && carrossel.p.caption.includes('Corrêa Veículos'), 'Carrossel junta os itens com a legenda');
  ok(!JSON.stringify(redes.situacao(salvo.id)).includes('TOKEN'), 'Situação não expõe o token');
  ok(redes.situacao(salvo.id).redes.facebook.status === 'postado', 'Situação registrada');

  // Não repete sem pedir; repete quando pedido
  let antes = chamadas.length;
  r = await redes.postar(salvo.id, { redes: ['facebook', 'instagram'] });
  ok(r.facebook.ja_postado && r.instagram.ja_postado && chamadas.length === antes, 'Não posta de novo sem pedir');

  // Facebook recusa o álbum: posta a capa com o texto
  falharFeed = true;
  r = await redes.postar(salvo.id, { redes: ['facebook'], repetir: true });
  ok(r.facebook.ok && r.facebook.post_id === 'PAGINA_POST_FOTO', 'Facebook cai para a foto de capa com texto');
  falharFeed = false;

  // Instagram ainda processando: espera e publica
  igProcessando = 1;
  r = await redes.postar(salvo.id, { redes: ['instagram'], repetir: true });
  ok(r.instagram.ok && chamadas.some(x => x.metodo === 'GET' && x.p.fields === 'status_code'), 'Instagram espera o processamento e publica');

  // Erro da Meta fica registrado, sem derrubar o sistema
  fs.writeFileSync(process.env.ARQUIVO_CHAVE_META, 'PAGE_ID=PAGINA\nPAGE_TOKEN=ERRADO\nIG_ID=IG\n');
  r = await redes.postar(salvo.id, { redes: ['facebook'], repetir: true });
  ok(!r.facebook.ok && r.facebook.erro === 'Token inválido' && redes.situacao(salvo.id).redes.facebook.status === 'erro', 'Erro da Meta é registrado');

  // Só o Instagram conectado
  fs.writeFileSync(process.env.ARQUIVO_CHAVE_META, 'PAGE_TOKEN=TOKEN-PAGINA\nIG_ID=IG\n');
  assert.deepEqual(redes.conexao(), { facebook: false, instagram: true }); verificacoes++;
  console.log(`Redes sociais: ${verificacoes} verificações aprovadas`);
}

main().then(() => servidor.close(), e => { console.error(e); servidor?.close(); process.exitCode = 1; });
