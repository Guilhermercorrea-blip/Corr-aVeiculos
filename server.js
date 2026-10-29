'use strict';
// Servidor da Corrêa Veículos: entrega as telas (pasta public) e a API em /api.
// Tudo exige login, menos a tela de login e a página do celular (que entra pelo código do QR Code).
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('./db');
const auth = require('./auth');
const leitor = require('./leitor');
const contratos = require('./contratos');

const PORTA = Number(process.env.PORT) || 3000;
const PUBLICO = path.join(__dirname, 'public');
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json',
};

// Endereços que abrem sem login
const PAGINAS_LIVRES = new Set(['/login.html', '/celular.html', '/redefinir.html', '/estilo.css', '/manifest.webmanifest']);
const API_LIVRE = [
  ['POST', /^\/api\/login$/],
  ['GET', /^\/api\/redefinir-senha\/[\w-]+$/],
  ['POST', /^\/api\/redefinir-senha$/],
  ['POST', /^\/api\/logout$/],
  ['GET', /^\/api\/primeiro-usuario$/],
  ['POST', /^\/api\/primeiro-usuario$/],
  ['GET', /^\/api\/envios\/[\w-]+$/],
  ['POST', /^\/api\/envios\/[\w-]+\/foto$/],
];

function acessoLivre(metodo, caminho) {
  if (caminho.startsWith('/api/')) return API_LIVRE.some(([m, re]) => m === metodo && re.test(caminho));
  return PAGINAS_LIVRES.has(caminho) || caminho.startsWith('/img/');
}

const rotas = [];
function rota(metodo, padrao, fn) {
  const chaves = [];
  const re = new RegExp('^' + padrao.replace(/:(\w+)/g, (_, k) => (chaves.push(k), '([^/]+)')) + '$');
  rotas.push({ metodo, re, chaves, fn });
}

// ---------- login ----------

function lerCookie(req, nome) {
  const par = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(nome + '='));
  try { return par ? decodeURIComponent(par.slice(nome.length + 1)) : null; }
  catch { return null; }
}

// Atrás do proxy HTTPS da nuvem, o endereço real do visitante vem no cabeçalho
function ipDe(req) {
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const encaminhado = req.headers['x-forwarded-for'];
  return local && encaminhado ? encaminhado.split(',')[0].trim() : req.socket.remoteAddress;
}

// O primeiro usuário só pode ser criado no próprio computador do sistema (nunca pela internet)
const pedidoLocal = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['x-forwarded-for'];

function gravarCookie(ctx, token, maxAge) {
  const seguro = ctx.req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  ctx.res.setHeader('Set-Cookie', `sessao=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${seguro}`);
}

rota('POST', '/api/login', (p, q, corpo, ctx) => {
  const { token, maxAge } = auth.entrar(corpo, ipDe(ctx.req));
  gravarCookie(ctx, token, maxAge);
  return { ok: true };
});
rota('POST', '/api/logout', (p, q, corpo, ctx) => {
  auth.sair(ctx.token);
  gravarCookie(ctx, '', 0);
  return { ok: true };
});
rota('GET', '/api/primeiro-usuario', (p, q, c, ctx) => ({ disponivel: !auth.temUsuarios() && pedidoLocal(ctx.req), temUsuarios: auth.temUsuarios() }));
rota('POST', '/api/primeiro-usuario', (p, q, corpo, ctx) => {
  if (auth.temUsuarios()) throw db.erro('Já existe usuário. Entre com usuário e senha.', 403);
  if (!pedidoLocal(ctx.req)) throw db.erro('O primeiro usuário só pode ser criado no computador onde o sistema está instalado.', 403);
  auth.criarUsuario(corpo);
  const { token, maxAge } = auth.entrar(corpo, ipDe(ctx.req));
  gravarCookie(ctx, token, maxAge);
  return { ok: true };
});
rota('GET', '/api/redefinir-senha/:token', p => auth.usuarioDaRedefinicao(p.token));
rota('POST', '/api/redefinir-senha', (p, q, corpo) => auth.redefinirSenha(corpo));
rota('GET', '/api/eu', (p, q, c, ctx) => ctx.usuario);
rota('GET', '/api/usuarios', () => auth.listarUsuarios());
rota('POST', '/api/usuarios', (p, q, corpo) => auth.criarUsuario(corpo));
rota('DELETE', '/api/usuarios/:id', (p, q, c, ctx) => auth.removerUsuario(p.id, ctx.usuario.id));
rota('PUT', '/api/minha-senha', (p, q, corpo, ctx) => auth.trocarSenha(ctx.usuario.id, ctx.token, corpo));

// ---------- dados da loja ----------

rota('GET', '/api/resumo', () => db.resumo());
rota('GET', '/api/veiculos', (p, q) => db.listarVeiculos(q.get('status')));
rota('GET', '/api/veiculos/:id', p => db.obterVeiculo(p.id));
rota('PUT', '/api/veiculos/:id', (p, q, corpo) => db.atualizarVeiculo(p.id, corpo));
rota('POST', '/api/compras', (p, q, corpo) => db.criarCompra(corpo));
rota('POST', '/api/estoque-rapido', (p, q, corpo) => db.criarEstoqueRapido(corpo.carros));
rota('DELETE', '/api/veiculos/:id', p => db.excluirVeiculo(p.id));
rota('POST', '/api/veiculos/:id/gastos', (p, q, corpo) => db.adicionarGasto(p.id, corpo));
rota('DELETE', '/api/gastos/:id', p => db.removerGasto(p.id));
rota('POST', '/api/veiculos/:id/venda', (p, q, corpo) => db.registrarVenda(p.id, corpo));
rota('PUT', '/api/veiculos/:id/venda', (p, q, corpo) => db.atualizarKmVenda(p.id, corpo));
rota('DELETE', '/api/veiculos/:id/venda', p => db.desfazerVenda(p.id));
rota('GET', '/api/pessoas', (p, q) => db.listarPessoas({ busca: q.get('busca'), cpf: q.get('cpf') }));
rota('GET', '/api/categorias', () => db.CATEGORIAS_GASTO);

// Endereços para abrir o sistema de outro computador ou do celular na mesma rede Wi-Fi
function enderecosRede() {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter(i => i.family === 'IPv4' && !i.internal && /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address))
    .map(i => `http://${i.address}:${PORTA}`);
  return { nome: `http://${os.hostname()}:${PORTA}`, ips };
}
// Na nuvem (ENDERECO_PUBLICO definido), o QR Code usa o endereço da internet
rota('GET', '/api/rede', () => (process.env.ENDERECO_PUBLICO
  ? { nome: process.env.ENDERECO_PUBLICO, ips: [process.env.ENDERECO_PUBLICO] }
  : enderecosRede()));
rota('GET', '/api/config', () => db.obterConfig());
rota('PUT', '/api/config', (p, q, corpo) => db.salvarConfig(corpo));
rota('GET', '/api/leitura/disponivel', () => ({ disponivel: Boolean(leitor.lerChave()) }));

// Recebe a foto/PDF em base64, guarda o arquivo e devolve o que foi lido nele
rota('POST', '/api/documentos/ler', (p, q, corpo) => lerDocumentoEnviado(corpo));
rota('POST', '/api/fotos', (p, q, corpo) => guardarFotoVeiculo(corpo));
rota('POST', '/api/hodometro/ler', (p, q, corpo) => lerHodometroEnviado(corpo));

// Envio pelo celular: o computador (logado) abre um "envio" com um código secreto, mostrado em QR Code.
// O celular manda as fotos para esse código sem precisar de login; o computador busca o que chegou.
const envios = new Map();
const VALIDADE_ENVIO = 3 * 3600e3;

rota('POST', '/api/envios', (p, q, corpo) => {
  const contexto = corpo.contexto || 'entrada';
  if (!['entrada', 'venda'].includes(contexto)) throw db.erro('Tipo de envio inválido');
  for (const [codigo, e] of envios) if (Date.now() - e.criado > VALIDADE_ENVIO) envios.delete(codigo);
  const codigo = crypto.randomBytes(12).toString('base64url');
  envios.set(codigo, { criado: Date.now(), contexto, itens: [] });
  return { codigo };
});

function pegarEnvio(codigo) {
  const envio = envios.get(String(codigo));
  if (!envio || Date.now() - envio.criado > VALIDADE_ENVIO) {
    throw db.erro('Código não encontrado ou vencido. Gere um QR Code novo no computador.', 404);
  }
  return envio;
}

rota('GET', '/api/envios/:codigo', p => pegarEnvio(p.codigo));

rota('POST', '/api/envios/:codigo/foto', async (p, q, corpo) => {
  const envio = pegarEnvio(p.codigo);
  const finalidade = corpo.finalidade || 'documento';
  if (!['documento', 'foto_veiculo', 'hodometro'].includes(finalidade)) throw db.erro('Tipo de arquivo inválido');
  if (corpo.destino === 'troca' && envio.contexto !== 'venda') throw db.erro('Este envio não é para um carro da troca');
  const item = { id: envio.itens.length + 1, nome: corpo.nome || `foto ${envio.itens.length + 1}`, status: 'lendo', resultado: null };
  envio.itens.push(item);
  try {
    item.resultado = finalidade === 'foto_veiculo' ? guardarFotoVeiculo(corpo)
      : finalidade === 'hodometro' ? await lerHodometroEnviado(corpo) : await lerDocumentoEnviado(corpo);
  } catch (e) {
    item.resultado = { erro: e.message };
  }
  item.status = 'pronto';
  const r = item.resultado;
  return { ok: !r.erro, tipo: r.tipo || null, nome: r.pessoa?.nome || r.veiculo?.placa || null, km: r.km ?? null, avisos: r.avisos || [], erro: r.erro || null };
});

// Fotos do carro são guardadas como imagens, sem leitura automática de documentos.
function guardarFotoVeiculo(corpo, tipo = 'foto_veiculo') {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(corpo.tipo_mime)) {
    throw db.erro('Para fotos do carro, envie uma imagem JPG, PNG ou WebP');
  }
  const destino = corpo.destino || 'principal';
  if (!['principal', 'troca'].includes(destino)) throw db.erro('Escolha o carro das fotos');
  const conteudo = Buffer.from(String(corpo.base64 || ''), 'base64');
  if (!conteudo.length) throw db.erro('Arquivo vazio');
  const assinatura = corpo.tipo_mime === 'image/jpeg' ? conteudo[0] === 0xff && conteudo[1] === 0xd8 && conteudo[2] === 0xff
    : corpo.tipo_mime === 'image/png' ? conteudo.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : conteudo.toString('ascii', 0, 4) === 'RIFF' && conteudo.toString('ascii', 8, 12) === 'WEBP';
  if (!assinatura) throw db.erro('A imagem não pôde ser reconhecida. Envie novamente como JPG, PNG ou WebP');
  const anexo_id = db.criarAnexo({ conteudo, tipoMime: corpo.tipo_mime, nomeOriginal: corpo.nome });
  db.definirTipoAnexo(anexo_id, tipo);
  return { anexo_id, tipo, destino, avisos: [] };
}

async function lerHodometroEnviado(corpo) {
  const salvo = guardarFotoVeiculo(corpo, 'hodometro');
  try {
    const lido = await leitor.lerHodometro({ conteudo: Buffer.from(corpo.base64, 'base64'), tipoMime: corpo.tipo_mime });
    return { ...salvo, ...lido };
  } catch (e) {
    if (!e.status) console.error(e);
    return { ...salvo, km: null, erro: e.status ? e.message : 'Não foi possível ler o km. Preencha manualmente ou tente outra foto.' };
  }
}

async function lerDocumentoEnviado(corpo) {
  const conteudo = Buffer.from(String(corpo.base64 || ''), 'base64');
  if (!conteudo.length) throw db.erro('Arquivo vazio');
  const anexo_id = db.criarAnexo({ conteudo, tipoMime: corpo.tipo_mime, nomeOriginal: corpo.nome });
  // Se a leitura falhar, o arquivo continua anexado e o usuário preenche à mão
  try {
    const lido = await leitor.lerDocumento({ conteudo, tipoMime: corpo.tipo_mime });
    db.definirTipoAnexo(anexo_id, lido.tipo);
    return { anexo_id, ...lido };
  } catch (e) {
    if (!e.status) console.error(e);
    return { anexo_id, erro: e.status ? e.message : 'Erro ao ler o documento: ' + e.message };
  }
}

// ---------- HTTP ----------

// Fotos de celular vão reduzidas pelo navegador, mas PDF pode ser maior
const LIMITE_CORPO = 30 * 1024 * 1024;

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.setEncoding('utf8');
    req.on('data', parte => {
      dados += parte;
      if (dados.length > LIMITE_CORPO) {
        reject(Object.assign(new Error('Arquivo grande demais (máximo 20 MB)'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const corpo = dados ? JSON.parse(dados) : {};
        if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new Error('Objeto esperado');
        resolve(corpo);
      }
      catch { reject(Object.assign(new Error('JSON inválido'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function responder(res, status, corpo) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(corpo ?? null));
}

async function api(req, res, url, ctx) {
  for (const r of rotas) {
    const m = r.metodo === req.method && url.pathname.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.chaves.map((k, i) => [k, /^\d+$/.test(m[i + 1]) ? Number(m[i + 1]) : m[i + 1]]));
    try {
      let corpo = null;
      if (['POST', 'PUT'].includes(req.method)) {
        // Só aceita JSON: bloqueia formulários de outros sites tentando agir em nome de quem está logado
        if (!String(req.headers['content-type'] || '').includes('application/json')) throw db.erro('Envio inválido', 415);
        corpo = await lerCorpo(req);
      }
      return responder(res, 200, await r.fn(params, url.searchParams, corpo, ctx));
    } catch (e) {
      if (!e.status) console.error(e);
      return responder(res, e.status || 500, { erro: e.status ? e.message : 'Erro interno: ' + e.message });
    }
  }
  responder(res, 404, { erro: 'Rota não encontrada' });
}

function estatico(res, url) {
  let relativo;
  try { relativo = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, ''); }
  catch { res.writeHead(400); return res.end('Endereço inválido'); }
  if (relativo.includes('\0')) { res.writeHead(400); return res.end('Endereço inválido'); }
  const arquivo = path.normalize(path.join(PUBLICO, relativo));
  if (arquivo !== PUBLICO && !arquivo.startsWith(PUBLICO + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(arquivo, (err, conteudo) => {
    if (err) { res.writeHead(404); return res.end('Não encontrado'); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(conteudo);
  });
}

function enviarAnexo(res, id) {
  let anexo;
  try { anexo = db.obterAnexo(id); } catch { res.writeHead(404); return res.end('Anexo não encontrado'); }
  fs.readFile(anexo.caminho, (err, conteudo) => {
    if (err) { res.writeHead(404); return res.end('Arquivo não encontrado'); }
    res.writeHead(200, { 'Content-Type': anexo.tipo_mime, 'Content-Disposition': `inline; filename="${anexo.arquivo}"`, 'Cache-Control': 'private, no-store' });
    res.end(conteudo);
  });
}

// Página simples de aviso (contrato que não pode sair, por exemplo)
function paginaAviso(res, status, mensagem) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Atenção</title><body style="font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px">
<h2 style="color:#b42318">Não foi possível gerar</h2><p style="font-size:1.1rem">${String(mensagem).replace(/</g, '&lt;')}</p>
<p><button onclick="close()" style="font:600 15px system-ui;padding:10px 18px;border-radius:8px;border:1px solid #1f3a5f;background:#fff;color:#1f3a5f">Fechar</button></p></body>`);
}

http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch { return responder(res, 400, { erro: 'Endereço inválido' }); }
  const token = lerCookie(req, 'sessao');
  const usuario = auth.usuarioDaSessao(token);
  const ctx = { req, res, token, usuario };

  if (!usuario && !acessoLivre(req.method, url.pathname)) {
    if (url.pathname.startsWith('/api/')) return responder(res, 401, { erro: 'Faça login para continuar' });
    res.writeHead(302, { Location: '/login.html' });
    return res.end();
  }

  const anexo = url.pathname.match(/^\/anexos\/(\d+)$/);
  if (anexo) return enviarAnexo(res, Number(anexo[1]));
  const contrato = url.pathname.match(/^\/contrato\/(\d+)\/(entrada|compra|consignacao|venda)$/);
  if (contrato) {
    try {
      const html = contratos.gerarContrato(Number(contrato[1]), contrato[2]);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    } catch (e) {
      if (!e.status) console.error(e);
      return paginaAviso(res, e.status || 500, e.message);
    }
  }
  if (url.pathname.startsWith('/api/')) return api(req, res, url, ctx);
  estatico(res, url);
}).listen(PORTA, () => {
  const rede = enderecosRede();
  console.log(`Corrêa Veículos rodando em http://localhost:${PORTA}`);
  console.log(`No outro computador ou no celular (mesmo Wi-Fi): ${[...rede.ips, rede.nome].join('  ou  ')}`);
  if (!auth.temUsuarios()) console.log('Primeiro acesso: abra http://localhost:' + PORTA + ' NESTE computador para criar o usuário.');
  console.log('Para fechar o sistema, feche esta janela.');
});
