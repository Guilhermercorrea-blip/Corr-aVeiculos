'use strict';
// Posta um anúncio publicado no site na Página do Facebook e no Instagram da loja (API Graph da Meta).
// As credenciais ficam no arquivo CHAVE-META.txt do servidor (nunca no Git). As fotos vão pelo
// endereço público do site, que a Meta busca no momento da postagem.
const fs = require('node:fs');
const path = require('node:path');
const { conexao: db, erro, obterAnexo } = require('./db');
const publicacoes = require('./publicacoes');
const { montarPublicacao } = require('./redes-sociais');

const ARQUIVO_CHAVES = process.env.ARQUIVO_CHAVE_META || path.join(__dirname, 'CHAVE-META.txt');
const VERSAO = process.env.META_GRAPH_VERSAO || 'v26.0';
const GRAPH = process.env.META_GRAPH_URL || `https://graph.facebook.com/${VERSAO}`;
const MAX_FOTOS = 10;
const MAX_LEGENDA_INSTAGRAM = 2200;
const REDES = ['facebook', 'instagram'];

db.exec(`
CREATE TABLE IF NOT EXISTS publicacoes_redes (
  publicacao_id INTEGER NOT NULL REFERENCES publicacoes(id) ON DELETE CASCADE,
  rede TEXT NOT NULL CHECK (rede IN ('facebook', 'instagram')),
  status TEXT NOT NULL CHECK (status IN ('postado', 'erro')),
  post_id TEXT,
  erro TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  PRIMARY KEY (publicacao_id, rede)
);
`);

// Arquivo no formato CHAVE=valor (linhas com # são comentários)
function lerChaves() {
  let texto = '';
  try { texto = fs.readFileSync(ARQUIVO_CHAVES, 'utf8'); } catch { return {}; }
  return Object.fromEntries(texto.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]).filter(([, v]) => v));
}

function conexao() {
  const c = lerChaves();
  return {
    facebook: Boolean(c.PAGE_ID && c.PAGE_TOKEN),
    instagram: Boolean(c.IG_ID && c.PAGE_TOKEN),
  };
}

// Sem internet ou Meta fora do ar: mensagem que dá para entender
async function buscar(url, opcoes) {
  try { return await fetch(url, opcoes); } catch { throw erro('Não foi possível falar com o Facebook/Instagram agora. Tente de novo em alguns minutos', 502); }
}

async function chamar(caminho, params) {
  const r = await buscar(`${GRAPH}/${caminho}`, { method: 'POST', body: new URLSearchParams(params) });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok || dados.error) {
    const msg = dados.error?.error_user_msg || dados.error?.message || `A Meta respondeu ${r.status}`;
    throw Object.assign(new Error(msg), { meta: dados.error || null });
  }
  return dados;
}

async function consultar(caminho, params) {
  const r = await buscar(`${GRAPH}/${caminho}?${new URLSearchParams(params)}`);
  const dados = await r.json().catch(() => ({}));
  if (!r.ok || dados.error) throw new Error(dados.error?.message || `A Meta respondeu ${r.status}`);
  return dados;
}

// Facebook: fotos sobem sem publicar e entram juntas num só post; se a Meta recusar o post com
// várias fotos, posta só a capa com o texto, para o anúncio não ficar sem divulgação.
async function postarFacebook({ PAGE_ID, PAGE_TOKEN }, fotos, texto) {
  if (!fotos.length) return (await chamar(`${PAGE_ID}/feed`, { message: texto, access_token: PAGE_TOKEN })).id;
  try {
    const ids = [];
    for (const url of fotos) ids.push((await chamar(`${PAGE_ID}/photos`, { url, published: 'false', access_token: PAGE_TOKEN })).id);
    const params = { message: texto, access_token: PAGE_TOKEN };
    ids.forEach((id, i) => { params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
    return (await chamar(`${PAGE_ID}/feed`, params)).id;
  } catch (e) {
    if (fotos.length === 1) throw e;
    const r = await chamar(`${PAGE_ID}/photos`, { url: fotos[0], caption: texto, access_token: PAGE_TOKEN });
    return r.post_id || r.id;
  }
}

// Instagram: só JPEG; 1 foto = post simples, 2 ou mais = carrossel
async function postarInstagram({ IG_ID, PAGE_TOKEN }, fotos, texto) {
  if (!fotos.length) throw erro('O Instagram exige pelo menos uma foto (JPG) no anúncio');
  const legenda = texto.length > MAX_LEGENDA_INSTAGRAM ? texto.slice(0, MAX_LEGENDA_INSTAGRAM - 1) + '…' : texto;
  let criacao;
  if (fotos.length === 1) {
    criacao = (await chamar(`${IG_ID}/media`, { image_url: fotos[0], caption: legenda, access_token: PAGE_TOKEN })).id;
  } else {
    const filhos = [];
    for (const url of fotos) filhos.push((await chamar(`${IG_ID}/media`, { image_url: url, is_carousel_item: 'true', access_token: PAGE_TOKEN })).id);
    criacao = (await chamar(`${IG_ID}/media`, { media_type: 'CAROUSEL', children: filhos.join(','), caption: legenda, access_token: PAGE_TOKEN })).id;
  }
  try {
    return (await chamar(`${IG_ID}/media_publish`, { creation_id: criacao, access_token: PAGE_TOKEN })).id;
  } catch (e) {
    // A Meta às vezes ainda está processando as fotos: espera e tenta publicar de novo (até ~1 minuto)
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, Number(process.env.META_ESPERA_MS) || 10000));
      const { status_code } = await consultar(criacao, { fields: 'status_code', access_token: PAGE_TOKEN });
      if (status_code === 'FINISHED') return (await chamar(`${IG_ID}/media_publish`, { creation_id: criacao, access_token: PAGE_TOKEN })).id;
      if (status_code === 'ERROR' || status_code === 'EXPIRED') break;
    }
    throw e;
  }
}

function registrar(publicacaoId, rede, resultado) {
  db.prepare(`INSERT INTO publicacoes_redes (publicacao_id, rede, status, post_id, erro) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(publicacao_id, rede) DO UPDATE SET status = excluded.status, post_id = excluded.post_id, erro = excluded.erro,
    atualizado_em = datetime('now', 'localtime')`)
    .run(publicacaoId, rede, resultado.ok ? 'postado' : 'erro', resultado.post_id || null, resultado.erro || null);
}

function situacao(publicacaoId) {
  const linhas = db.prepare('SELECT rede, status, post_id, erro, atualizado_em FROM publicacoes_redes WHERE publicacao_id = ?').all(publicacaoId);
  return { conectado: conexao(), redes: Object.fromEntries(linhas.map(l => [l.rede, l])) };
}

// Posta o anúncio nas redes escolhidas. Não posta de novo onde já foi postado, a menos que "repetir" venha marcado.
async function postar(publicacaoId, { redes = [], repetir = false } = {}) {
  const escolhidas = [...new Set(Array.isArray(redes) ? redes : [])].filter(r => REDES.includes(r));
  if (!escolhidas.length) throw erro('Escolha Facebook e/ou Instagram');
  const chaves = lerChaves();
  const conectado = conexao();
  const naoConectadas = escolhidas.filter(r => !conectado[r]);
  if (naoConectadas.length) throw erro(`Conta não conectada: ${naoConectadas.join(' e ')}. Veja o arquivo CHAVE-META.txt no servidor.`);
  const base = process.env.ENDERECO_PUBLICO;
  if (!base || !base.startsWith('https://')) throw erro('O endereço público do site (https) não está configurado no servidor');

  const anuncio = publicacoes.publico(publicacaoId); // só anúncio publicado e visível no site
  const fotos = anuncio.fotos.slice(0, MAX_FOTOS);
  const urls = fotos.map(f => new URL(f.url, base).href);
  const urlsJpeg = fotos.filter(f => obterAnexo(f.id).tipo_mime === 'image/jpeg').map(f => new URL(f.url, base).href);
  const { texto } = montarPublicacao(anuncio);
  const ja = situacao(publicacaoId).redes;

  const resultado = {};
  for (const rede of escolhidas) {
    if (ja[rede]?.status === 'postado' && !repetir) {
      resultado[rede] = { ok: true, post_id: ja[rede].post_id, ja_postado: true };
      continue;
    }
    try {
      const post_id = rede === 'facebook' ? await postarFacebook(chaves, urls, texto) : await postarInstagram(chaves, urlsJpeg, texto);
      resultado[rede] = { ok: true, post_id };
    } catch (e) {
      resultado[rede] = { ok: false, erro: e.message };
    }
    registrar(publicacaoId, rede, resultado[rede]);
  }
  return resultado;
}

module.exports = { conexao, situacao, postar, lerChaves, ARQUIVO_CHAVES };
