'use strict';
// Liga o sistema à Página do Facebook e ao Instagram da loja.
// 1) No servidor, crie CHAVE-META.txt (modelo em nuvem/CHAVE-META.exemplo.txt) com APP_ID, APP_SECRET e USER_TOKEN.
// 2) Rode: sudo -u correa node nuvem/conectar-meta.js
// O script troca o token curto por um permanente da Página, acha o Instagram ligado a ela e grava
// PAGE_ID, PAGE_TOKEN e IG_ID no mesmo arquivo. Nenhum token é mostrado na tela.
const fs = require('node:fs');
const path = require('node:path');

const ARQUIVO = process.env.ARQUIVO_CHAVE_META || path.join(__dirname, '..', 'CHAVE-META.txt');
const GRAPH = process.env.META_GRAPH_URL || `https://graph.facebook.com/${process.env.META_GRAPH_VERSAO || 'v26.0'}`;

function ler() {
  const texto = fs.readFileSync(ARQUIVO, 'utf8');
  return Object.fromEntries(texto.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
}

async function get(caminho, params) {
  const r = await fetch(`${GRAPH}/${caminho}?${new URLSearchParams(params)}`);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error?.message || `A Meta respondeu ${r.status}`);
  return d;
}

(async () => {
  const c = ler();
  for (const k of ['APP_ID', 'APP_SECRET', 'USER_TOKEN']) if (!c[k]) throw new Error(`Falta ${k} em ${ARQUIVO}`);

  // Token de usuário de longa duração; tokens de Página tirados dele não expiram
  const longo = await get('oauth/access_token', { grant_type: 'fb_exchange_token', client_id: c.APP_ID, client_secret: c.APP_SECRET, fb_exchange_token: c.USER_TOKEN });
  const paginas = (await get('me/accounts', { access_token: longo.access_token, fields: 'id,name,access_token' })).data || [];
  if (!paginas.length) throw new Error('Nenhuma Página encontrada. Confira se você é administrador da Página e marcou as permissões de páginas.');
  const pagina = paginas.find(p => /corr[eê]a/i.test(p.name)) || paginas[0];
  const ig = await get(pagina.id, { fields: 'instagram_business_account{id,username}', access_token: pagina.access_token });
  const igConta = ig.instagram_business_account || null;

  const linhas = [
    '# Conexão com Facebook e Instagram. NUNCA envie este arquivo para ninguém.',
    `# Página: ${pagina.name}${igConta ? ` · Instagram: @${igConta.username}` : ' · Instagram não ligado à Página'}`,
    `PAGE_ID=${pagina.id}`,
    `PAGE_TOKEN=${pagina.access_token}`,
    igConta ? `IG_ID=${igConta.id}` : '# IG_ID= (ligue o Instagram profissional à Página e rode de novo)',
    `APP_ID=${c.APP_ID}`,
  ];
  fs.writeFileSync(ARQUIVO, linhas.join('\n') + '\n', { mode: 0o600 });
  console.log(`Conectado à Página "${pagina.name}".`);
  console.log(igConta ? `Instagram conectado: @${igConta.username}.` : 'Instagram NÃO encontrado: ligue a conta profissional à Página e rode o script de novo.');
})().catch(e => { console.error('Não deu certo:', e.message); process.exit(1); });
