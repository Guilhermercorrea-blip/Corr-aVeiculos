'use strict';
// Anúncios têm cadastro próprio. O vínculo com o estoque é opcional.
const fs = require('node:fs');
const { conexao: db, erro, criarAnexo, definirTipoAnexo, obterAnexo } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS publicacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  veiculo_id INTEGER UNIQUE REFERENCES veiculos(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  marca_modelo TEXT NOT NULL,
  versao TEXT NOT NULL DEFAULT '',
  descricao TEXT NOT NULL DEFAULT '',
  preco INTEGER,
  ano_fab INTEGER, ano_mod INTEGER, km INTEGER,
  cor TEXT NOT NULL DEFAULT '', combustivel TEXT NOT NULL DEFAULT '',
  cambio TEXT NOT NULL DEFAULT '', portas INTEGER,
  opcionais TEXT NOT NULL DEFAULT '[]',
  situacao TEXT NOT NULL DEFAULT 'rascunho' CHECK (situacao IN ('rascunho', 'publicado', 'vendido')),
  destaque INTEGER NOT NULL DEFAULT 0 CHECK (destaque IN (0, 1)),
  revisao INTEGER NOT NULL DEFAULT 1,
  chave_criacao TEXT UNIQUE,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS publicacao_fotos (
  publicacao_id INTEGER NOT NULL REFERENCES publicacoes(id) ON DELETE CASCADE,
  anexo_id INTEGER NOT NULL REFERENCES anexos(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL,
  PRIMARY KEY (publicacao_id, anexo_id)
);
CREATE TABLE IF NOT EXISTS publicacao_uploads (
  anexo_id INTEGER PRIMARY KEY REFERENCES anexos(id) ON DELETE CASCADE,
  publicacao_id INTEGER NOT NULL REFERENCES publicacoes(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS site_migracoes (nome TEXT PRIMARY KEY);
CREATE INDEX IF NOT EXISTS idx_publicacao_uploads ON publicacao_uploads(publicacao_id);
`);

// Colunas adicionais também são aplicadas em instalações que já têm publicações.
const colunas = new Set(db.prepare('PRAGMA table_info(publicacoes)').all().map(c => c.name));
for (const [nome, padrao] of [['tipo_veiculo', 'Carro/picape'], ['fabricante', ''], ['modelo', '']]) {
  if (!colunas.has(nome)) db.exec(`ALTER TABLE publicacoes ADD COLUMN ${nome} TEXT NOT NULL DEFAULT '${padrao}'`);
}

function transacao(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Preserva IDs, links, preços, rascunhos e ordem das fotos da versão anterior.
if (!db.prepare('SELECT 1 FROM site_migracoes WHERE nome = ?').get('publicacoes-v2')) {
  transacao(() => {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'anuncios'").get()) {
      db.exec(`INSERT INTO publicacoes (id, veiculo_id, titulo, marca_modelo, descricao, preco, ano_fab, ano_mod, km, cor, combustivel, situacao, destaque, atualizado_em)
        SELECT a.veiculo_id, a.veiculo_id, a.titulo, v.marca_modelo, a.descricao, a.preco,
        v.ano_fab, v.ano_mod, v.km_entrada, COALESCE(v.cor, ''), COALESCE(v.combustivel, ''),
        CASE WHEN a.publicado = 1 THEN 'publicado' ELSE 'rascunho' END, a.destaque, a.atualizado_em
        FROM anuncios a JOIN veiculos v ON v.id = a.veiculo_id;
        INSERT INTO publicacao_fotos (publicacao_id, anexo_id, ordem)
        SELECT f.veiculo_id, f.anexo_id, f.ordem FROM anuncio_fotos f JOIN publicacoes p ON p.id = f.veiculo_id;`);
    }
    db.prepare('INSERT INTO site_migracoes (nome) VALUES (?)').run('publicacoes-v2');
  });
}

const MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SITUACOES = new Set(['rascunho', 'publicado', 'vendido']);
const CAMBIOS = new Set(['', 'Manual', 'Automático', 'Automatizado', 'CVT']);
const TIPOS = new Set(['Carro/picape', 'Motocicleta', 'Veículos para esportes', 'Trailer', 'Reboque', 'Barco', 'Comercial/industrial', 'Outro']);
const CAMPOS = ['titulo', 'marca_modelo', 'tipo_veiculo', 'fabricante', 'modelo', 'versao', 'descricao', 'preco', 'ano_fab', 'ano_mod', 'km', 'cor', 'combustivel', 'cambio', 'portas', 'opcionais', 'situacao', 'destaque'];

function idValido(v) {
  const id = Number(v);
  if (!Number.isSafeInteger(id) || id <= 0) throw erro('Anúncio não encontrado', 404);
  return id;
}
function texto(v, campo, max) {
  if (typeof v !== 'string' || v.length > max) throw erro(`Confira ${campo} (até ${max} caracteres)`);
  return v.trim();
}
function objeto(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw erro('Dados do anúncio inválidos');
}
function inteiro(v, nome, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (v === null || v === '') return null;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) throw erro(`Confira ${nome}`);
  return v;
}
function linha(id) {
  const r = db.prepare('SELECT p.*, v.status AS estado_estoque FROM publicacoes p LEFT JOIN veiculos v ON v.id = p.veiculo_id WHERE p.id = ?').get(idValido(id));
  if (!r) throw erro('Anúncio não encontrado', 404);
  return r;
}
function confereRevisao(atual, revisao) {
  if (!Number.isSafeInteger(revisao) || revisao !== atual.revisao) throw erro('Este anúncio foi alterado em outra tela. Recarregue o cadastro antes de salvar para não sobrescrever as alterações.', 409);
}
function normalizar(dados, atual = {}) {
  objeto(dados);
  const p = { titulo: '', marca_modelo: '', tipo_veiculo: 'Carro/picape', fabricante: '', modelo: '', versao: '', descricao: '', preco: null, ano_fab: null, ano_mod: null, km: null, cor: '', combustivel: '', cambio: '', portas: null, opcionais: [], situacao: 'rascunho', destaque: false, ...atual };
  for (const c of CAMPOS) if (c in dados) p[c] = dados[c];
  for (const [c, limite] of [['titulo', 140], ['marca_modelo', 140], ['fabricante', 60], ['modelo', 140], ['versao', 140], ['descricao', 6000], ['cor', 60], ['combustivel', 60], ['cambio', 30]]) p[c] = texto(p[c], c, limite);
  if (!TIPOS.has(p.tipo_veiculo)) throw erro('Escolha o tipo de veículo');
  if ('modelo' in dados || 'fabricante' in dados) {
    if (!p.modelo) throw erro('Informe o modelo do veículo');
    p.marca_modelo = [p.fabricante, p.modelo].filter(Boolean).join(' ');
    if (p.marca_modelo.length > 140) throw erro('Fabricante e modelo devem ter até 140 caracteres juntos');
  } else if ('marca_modelo' in dados && dados.marca_modelo !== atual.marca_modelo) {
    p.fabricante = ''; p.modelo = '';
  }
  if (!p.marca_modelo) throw erro('Informe a marca e o modelo do carro');
  p.titulo = p.titulo || [p.marca_modelo, p.versao].filter(Boolean).join(' ');
  if (p.titulo.length > 140) throw erro('O título deve ter até 140 caracteres');
  p.preco = inteiro(p.preco, 'o preço do anúncio', 1);
  p.km = inteiro(p.km, 'a quilometragem');
  for (const c of ['ano_fab', 'ano_mod']) p[c] = inteiro(p[c], 'o ano', 1900, new Date().getFullYear() + 1);
  if (p.ano_fab !== null && p.ano_mod !== null && p.ano_mod < p.ano_fab) throw erro('O ano do modelo não pode ser anterior ao de fabricação');
  if (!CAMBIOS.has(p.cambio)) throw erro('Escolha o tipo de câmbio');
  p.portas = inteiro(p.portas, 'a quantidade de portas', 2, 5);
  if (!SITUACOES.has(p.situacao)) throw erro('Situação do anúncio inválida');
  if (typeof p.destaque !== 'boolean') throw erro('Opção de destaque inválida');
  if (!Array.isArray(p.opcionais) || p.opcionais.length > 40) throw erro('Confira a lista de opcionais');
  p.opcionais = [...new Set(p.opcionais.map(v => texto(v, 'cada opcional', 80)).filter(Boolean))];
  return Object.fromEntries(CAMPOS.map(c => [c, p[c]]));
}
function visivel(p) { return p.situacao === 'publicado' && (p.veiculo_id === null || p.estado_estoque === 'estoque'); }
function fontesFotos(p) {
  return db.prepare(`SELECT x.id, CASE WHEN u.publicacao_id IS NOT NULL THEN 'anuncio' ELSE 'estoque' END AS origem
    FROM anexos x LEFT JOIN publicacao_uploads u ON u.anexo_id = x.id
    WHERE x.tipo_mime IN ('image/jpeg', 'image/png', 'image/webp') AND (
      (x.tipo = 'foto_anuncio' AND u.publicacao_id = @id) OR
      (x.tipo = 'foto_veiculo' AND x.veiculo_id = @veiculo AND u.anexo_id IS NULL)
    ) ORDER BY x.id`).all({ id: p.id, veiculo: p.veiculo_id }).map(f => ({ ...f, url: `/anexos/${f.id}` }));
}
function fotosSelecionadas(p, publica = false) {
  const permitidas = new Set(fontesFotos(p).map(f => f.id));
  return db.prepare('SELECT anexo_id AS id FROM publicacao_fotos WHERE publicacao_id = ? ORDER BY ordem').all(p.id)
    .filter(f => permitidas.has(f.id)).map(f => ({ id: f.id, url: publica ? `/midia/anuncios/${p.id}/${f.id}` : `/anexos/${f.id}` }));
}
function gravarFotos(p, ids) {
  if (!Array.isArray(ids) || ids.length > 40 || ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) throw erro('Escolha até 40 fotos, sem repetir');
  const permitidas = new Set(fontesFotos(p).map(f => f.id));
  if (ids.some(id => !permitidas.has(id))) throw erro('Escolha somente fotos deste anúncio ou do carro vinculado. Documentos não podem ser publicados');
  db.prepare('DELETE FROM publicacao_fotos WHERE publicacao_id = ?').run(p.id);
  const inserir = db.prepare('INSERT INTO publicacao_fotos (publicacao_id, anexo_id, ordem) VALUES (?, ?, ?)');
  ids.forEach((id, i) => inserir.run(p.id, id, i));
}
function dtoAdmin(p) {
  return { ...p, opcionais: JSON.parse(p.opcionais), destaque: Boolean(p.destaque), visivel: visivel(p), fotos: fotosSelecionadas(p), fotos_disponiveis: fontesFotos(p) };
}
function obter(id) { return dtoAdmin(linha(id)); }
function listar() {
  return db.prepare('SELECT p.*, v.status AS estado_estoque FROM publicacoes p LEFT JOIN veiculos v ON v.id = p.veiculo_id ORDER BY p.atualizado_em DESC, p.id DESC').all().map(dtoAdmin);
}
function estoque() {
  return db.prepare(`SELECT v.id, v.marca_modelo, v.ano_fab, v.ano_mod, v.cor, v.combustivel, v.km_entrada AS km, p.id AS anuncio_id
    FROM veiculos v LEFT JOIN publicacoes p ON p.veiculo_id = v.id WHERE v.status = 'estoque' ORDER BY v.marca_modelo, v.id`).all();
}
function dadosEstoque(id) {
  const p = db.prepare('SELECT id, marca_modelo, ano_fab, ano_mod, cor, combustivel, km_entrada AS km, status FROM veiculos WHERE id = ?').get(idValido(id));
  if (!p) throw erro('Carro não encontrado', 404);
  return { ...p, cor: p.cor || '', combustivel: p.combustivel || '', fotos_disponiveis: fontesFotos({ id: -1, veiculo_id: p.id }) };
}
function params(p) { return { ...p, destaque: Number(p.destaque), opcionais: JSON.stringify(p.opcionais) }; }
function criar(dados) {
  objeto(dados);
  const chave = dados.chave_criacao ?? null;
  if (chave !== null && (typeof chave !== 'string' || !/^[a-f0-9-]{36}$/i.test(chave))) throw erro('Identificação de cadastro inválida');
  if (chave) {
    const existente = db.prepare('SELECT id FROM publicacoes WHERE chave_criacao = ?').get(chave);
    if (existente) return obter(existente.id);
  }
  const veiculoId = dados.veiculo_id === undefined || dados.veiculo_id === null ? null : idValido(dados.veiculo_id);
  let origem = {};
  if (veiculoId !== null) {
    origem = dadosEstoque(veiculoId);
    if (origem.status !== 'estoque') throw erro('Escolha um carro que esteja no estoque');
    if (db.prepare('SELECT 1 FROM publicacoes WHERE veiculo_id = ?').get(veiculoId)) throw erro('Este carro já tem um anúncio. Abra o anúncio existente.', 409);
  }
  const p = normalizar(dados, origem);
  return transacao(() => {
    const obj = { ...params(p), veiculo_id: veiculoId, chave_criacao: chave };
    const chaves = Object.keys(obj);
    const r = db.prepare(`INSERT INTO publicacoes (${chaves.join(',')}) VALUES (${chaves.map(c => '@' + c).join(',')})`).run(obj);
    const id = Number(r.lastInsertRowid);
    gravarFotos(linha(id), 'fotos' in dados ? dados.fotos : []);
    return obter(id);
  });
}
function salvar(id, dados, { legado = false } = {}) {
  objeto(dados);
  const atual = linha(id);
  if (!legado) confereRevisao(atual, dados.revisao);
  if ('veiculo_id' in dados && dados.veiculo_id !== atual.veiculo_id) throw erro('O vínculo com o estoque não pode ser trocado depois do cadastro');
  const p = normalizar(dados, { ...atual, opcionais: JSON.parse(atual.opcionais), destaque: Boolean(atual.destaque) });
  if (p.situacao === 'publicado' && atual.veiculo_id !== null && atual.estado_estoque !== 'estoque') throw erro('Este carro está fora do estoque e não pode ser publicado');
  return transacao(() => {
    const obj = params(p);
    db.prepare(`UPDATE publicacoes SET ${Object.keys(obj).map(c => c + ' = @' + c).join(',')}, revisao = revisao + 1, atualizado_em = datetime('now') WHERE id = @id`).run({ ...obj, id: atual.id });
    if ('fotos' in dados) gravarFotos(atual, dados.fotos);
    return obter(id);
  });
}
function retirar(id, revisao) {
  return salvar(id, { situacao: 'rascunho', revisao });
}
function adicionarFoto(id, dados) {
  const p = linha(id);
  if (!MIMES.has(dados.tipoMime)) throw erro('Envie uma foto JPG, PNG ou WebP');
  const b = dados.conteudo;
  if (!Buffer.isBuffer(b) || !b.length || b.length > 20 * 1024 * 1024) throw erro('Envie uma foto de até 20 MB');
  const assinatura = dados.tipoMime === 'image/jpeg' ? b[0] === 255 && b[1] === 216 && b[2] === 255
    : dados.tipoMime === 'image/png' ? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
  if (!assinatura) throw erro('A imagem não pôde ser reconhecida. Use JPG, PNG ou WebP');
  if (db.prepare('SELECT COUNT(*) AS n FROM publicacao_uploads WHERE publicacao_id = ?').get(p.id).n >= 100) throw erro('Este anúncio atingiu o limite de 100 fotos enviadas');
  const nome = texto(dados.nomeOriginal || 'foto-carro', 'o nome da foto', 250);
  const anexoId = criarAnexo({ conteudo: b, tipoMime: dados.tipoMime, nomeOriginal: nome });
  try {
    transacao(() => {
      definirTipoAnexo(anexoId, 'foto_anuncio');
      db.prepare('INSERT INTO publicacao_uploads (anexo_id, publicacao_id) VALUES (?, ?)').run(anexoId, p.id);
    });
  } catch (e) {
    const a = obterAnexo(anexoId);
    db.prepare('DELETE FROM anexos WHERE id = ?').run(anexoId);
    fs.rmSync(a.caminho, { force: true });
    throw e;
  }
  // Enviar uma foto não altera o anúncio que já está no ar: a seleção só muda ao salvar.
  return { id: anexoId, url: `/anexos/${anexoId}`, origem: 'anuncio' };
}
function dtoPublico(p) {
  const campos = ['id', 'titulo', 'marca_modelo', 'tipo_veiculo', 'fabricante', 'modelo', 'versao', 'descricao', 'preco', 'ano_fab', 'ano_mod', 'km', 'cor', 'combustivel', 'cambio', 'portas'];
  return { ...Object.fromEntries(campos.map(c => [c, p[c]])), destaque: Boolean(p.destaque), opcionais: JSON.parse(p.opcionais), fotos: fotosSelecionadas(p, true) };
}
function listarPublicos() {
  return db.prepare(`SELECT p.*, v.status AS estado_estoque FROM publicacoes p LEFT JOIN veiculos v ON v.id = p.veiculo_id
    WHERE p.situacao = 'publicado' AND (p.veiculo_id IS NULL OR v.status = 'estoque') ORDER BY p.destaque DESC, p.atualizado_em DESC, p.id DESC`).all().map(dtoPublico);
}
function publico(id) {
  const p = linha(id);
  if (!visivel(p)) throw erro('Anúncio não disponível', 404);
  return dtoPublico(p);
}
function fotoPublica(id, fotoId) {
  const p = linha(id);
  const fid = idValido(fotoId);
  if (!visivel(p) || !fotosSelecionadas(p).some(f => f.id === fid)) throw erro('Foto não disponível', 404);
  return obterAnexo(fid);
}

// Compatibilidade com a primeira tela de anúncios, inclusive abas antigas ainda abertas.
function listarLegado() {
  const porVeiculo = new Map(listar().filter(p => p.veiculo_id !== null).map(p => [p.veiculo_id, p]));
  return db.prepare("SELECT id, marca_modelo, ano_fab, ano_mod, cor, combustivel, km_entrada AS km, status FROM veiculos WHERE status = 'estoque' OR id IN (SELECT veiculo_id FROM publicacoes) ORDER BY id DESC").all().map(v => {
    const p = porVeiculo.get(v.id);
    return { ...v, titulo: p?.titulo ?? null, descricao: p?.descricao ?? null, preco: p?.preco ?? null, publicado: p?.situacao === 'publicado', destaque: p?.destaque || false,
      fotos_selecionadas: p ? p.fotos.map(f => f.id) : [], fotos_disponiveis: p?.fotos_disponiveis || dadosEstoque(v.id).fotos_disponiveis };
  });
}
function salvarLegado(veiculoId, dados) {
  objeto(dados);
  if (typeof dados.titulo !== 'string' || !dados.titulo.trim()) throw erro('Informe o título do anúncio');
  if (!Array.isArray(dados.fotos)) throw erro('Seleção de fotos inválida');
  if (typeof dados.publicado !== 'boolean' || typeof dados.destaque !== 'boolean') throw erro('Opções de publicação inválidas');
  const id = idValido(veiculoId), atual = db.prepare('SELECT id FROM publicacoes WHERE veiculo_id = ?').get(id);
  const proximo = Number(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'publicacoes'").get()?.seq || 0) + 1;
  if (atual && atual.id !== id || !atual && proximo !== id) throw erro('A área de anúncios foi atualizada. Recarregue a página para continuar neste cadastro.', 409);
  const p = { ...dados, situacao: dados.publicado ? 'publicado' : 'rascunho' };
  const r = atual ? salvar(atual.id, p, { legado: true }) : criar({ ...p, veiculo_id: id });
  return { id, publicado: r.situacao === 'publicado' };
}
function retirarLegado(veiculoId) {
  const p = db.prepare('SELECT id FROM publicacoes WHERE veiculo_id = ?').get(idValido(veiculoId));
  if (p) salvar(p.id, { situacao: 'rascunho' }, { legado: true });
  return { ok: true };
}
module.exports = { criar, salvar, retirar, listar, obter, estoque, dadosEstoque, adicionarFoto, listarPublicos, publico, fotoPublica, listarLegado, salvarLegado, retirarLegado };
