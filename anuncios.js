'use strict';
// Vitrine pública: somente campos e fotos escolhidos para anúncio saem do sistema.
const { conexao: db, erro, obterConfig, obterAnexo } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS anuncios (
  veiculo_id INTEGER PRIMARY KEY REFERENCES veiculos(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  preco INTEGER,
  publicado INTEGER NOT NULL DEFAULT 0 CHECK (publicado IN (0, 1)),
  destaque INTEGER NOT NULL DEFAULT 0 CHECK (destaque IN (0, 1)),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS anuncio_fotos (
  veiculo_id INTEGER NOT NULL REFERENCES anuncios(veiculo_id) ON DELETE CASCADE,
  anexo_id INTEGER NOT NULL REFERENCES anexos(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL,
  PRIMARY KEY (veiculo_id, anexo_id)
);
CREATE TABLE IF NOT EXISTS site_config (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
`);

const TIPOS_FOTO = new Set(['image/jpeg', 'image/png', 'image/webp']);
const CAMPOS_SITE = ['nome', 'chamada', 'sobre', 'endereco', 'cidade', 'telefone', 'whatsapp', 'horario', 'instagram'];
function objeto(dados) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw erro('Dados inválidos');
  return dados;
}
function texto(valor, campo, max) {
  if (typeof valor !== 'string' || valor.length > max) throw erro(`Confira o campo ${campo} (até ${max} caracteres)`);
  return valor.trim();
}
function idValido(valor) {
  const id = Number(valor);
  if (!Number.isSafeInteger(id) || id <= 0) throw erro('Carro não encontrado', 404);
  return id;
}
function configurarSite(dados) {
  objeto(dados);
  const valores = {};
  for (const campo of CAMPOS_SITE) if (campo in dados) valores[campo] = texto(dados[campo], campo, campo === 'sobre' ? 3000 : 240);
  if ('nome' in valores && !valores.nome) throw erro('Informe o nome da loja');
  for (const campo of ['telefone', 'whatsapp']) {
    if (valores[campo] && !/^[+\d\s().-]{8,30}$/.test(valores[campo])) throw erro(`Confira o ${campo} da loja`);
  }
  if (valores.whatsapp) {
    const n = valores.whatsapp.replace(/\D/g, '');
    if (![10, 11].includes(n.length) && !(/^55\d{10,11}$/.test(n))) throw erro('Informe o WhatsApp com DDD');
  }
  if (valores.instagram) {
    let url;
    try { url = new URL(valores.instagram); } catch { throw erro('Informe o endereço completo do Instagram'); }
    if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname) || url.username || url.password) throw erro('Use um endereço https://www.instagram.com/ da loja');
  }
  const gravar = db.prepare('INSERT INTO site_config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor');
  db.exec('BEGIN');
  try {
    for (const [campo, valor] of Object.entries(valores)) gravar.run(campo, valor);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return configPublica();
}
function configPublica() {
  const loja = obterConfig();
  const salvos = Object.fromEntries(db.prepare('SELECT chave, valor FROM site_config').all().filter(x => CAMPOS_SITE.includes(x.chave)).map(x => [x.chave, x.valor]));
  return {
    nome: 'Corrêa Veículos', chamada: 'Seu próximo carro está aqui.',
    sobre: 'Conheça os veículos da Corrêa Veículos e fale com a nossa equipe para saber mais.',
    endereco: loja.endereco, cidade: loja.cidade, telefone: loja.telefone, whatsapp: loja.whatsapp,
    horario: '', instagram: '', ...salvos,
  };
}
function fotosDoAnuncio(id, publica = false) {
  return db.prepare(`SELECT x.id FROM anuncio_fotos f JOIN anexos x ON x.id = f.anexo_id
    WHERE f.veiculo_id = ? AND x.veiculo_id = f.veiculo_id AND x.tipo = 'foto_veiculo'
    AND x.tipo_mime IN ('image/jpeg', 'image/png', 'image/webp') ORDER BY f.ordem`).all(id)
    .map(f => ({ id: f.id, url: publica ? `/midia/anuncios/${id}/${f.id}` : `/anexos/${f.id}` }));
}
function dadosPublicos(linha) {
  // A consulta já é uma lista explícita de campos. Não usar v.* nesta API.
  return { ...linha, destaque: Boolean(linha.destaque), fotos: fotosDoAnuncio(linha.id, true) };
}
const SELECT_PUBLICO = `SELECT v.id, a.titulo, a.descricao, a.preco, a.destaque,
  v.ano_fab, v.ano_mod, v.cor, v.combustivel, v.km_entrada AS km
  FROM anuncios a JOIN veiculos v ON v.id = a.veiculo_id
  WHERE a.publicado = 1 AND v.status = 'estoque'`;
function catalogo() {
  return { loja: configPublica(), carros: db.prepare(SELECT_PUBLICO + ' ORDER BY a.destaque DESC, a.atualizado_em DESC, v.id DESC').all().map(dadosPublicos) };
}
function anuncioPublico(id) {
  const linha = db.prepare(SELECT_PUBLICO + ' AND v.id = ?').get(idValido(id));
  if (!linha) throw erro('Anúncio não disponível', 404);
  return { loja: configPublica(), carro: dadosPublicos(linha) };
}
function fotoPublica(veiculoId, anexoId) {
  const id = idValido(veiculoId), fotoId = idValido(anexoId);
  const liberada = db.prepare(`SELECT 1 FROM anuncio_fotos f
    JOIN anuncios a ON a.veiculo_id = f.veiculo_id JOIN veiculos v ON v.id = a.veiculo_id
    JOIN anexos x ON x.id = f.anexo_id
    WHERE f.veiculo_id = ? AND f.anexo_id = ? AND x.veiculo_id = f.veiculo_id
    AND a.publicado = 1 AND v.status = 'estoque' AND x.tipo = 'foto_veiculo'
    AND x.tipo_mime IN ('image/jpeg', 'image/png', 'image/webp')`).get(id, fotoId);
  if (!liberada) throw erro('Foto não disponível', 404);
  return obterAnexo(fotoId);
}
function listarAnuncios() {
  return db.prepare(`SELECT v.id, v.marca_modelo, v.ano_fab, v.ano_mod, v.cor, v.combustivel, v.km_entrada AS km, v.status,
    a.titulo, a.descricao, a.preco, COALESCE(a.publicado, 0) AS publicado, COALESCE(a.destaque, 0) AS destaque
    FROM veiculos v LEFT JOIN anuncios a ON a.veiculo_id = v.id
    WHERE v.status = 'estoque' OR a.veiculo_id IS NOT NULL ORDER BY v.status = 'estoque' DESC, v.id DESC`).all().map(v => ({
      ...v, publicado: Boolean(v.publicado), destaque: Boolean(v.destaque),
      fotos_selecionadas: fotosDoAnuncio(v.id).map(f => f.id),
      fotos_disponiveis: db.prepare(`SELECT id FROM anexos WHERE veiculo_id = ? AND tipo = 'foto_veiculo'
        AND tipo_mime IN ('image/jpeg', 'image/png', 'image/webp') ORDER BY id`).all(v.id).map(f => ({ id: f.id, url: `/anexos/${f.id}` })),
    }));
}
function salvarAnuncio(veiculoId, dados) {
  const id = idValido(veiculoId);
  objeto(dados);
  const carro = db.prepare('SELECT status FROM veiculos WHERE id = ?').get(id);
  if (!carro) throw erro('Carro não encontrado', 404);
  const titulo = texto(dados.titulo, 'título', 140), descricao = texto(dados.descricao ?? '', 'descrição', 6000);
  if (!titulo) throw erro('Informe o título do anúncio');
  if (typeof dados.publicado !== 'boolean' || typeof dados.destaque !== 'boolean') throw erro('Opções de publicação inválidas');
  if (dados.publicado && carro.status !== 'estoque') throw erro('Só é possível anunciar um carro que está no estoque');
  const preco = dados.preco;
  if (preco !== null && (typeof preco !== 'number' || !Number.isSafeInteger(preco) || preco <= 0)) throw erro('Informe um preço maior que zero ou deixe sob consulta');
  if (!Array.isArray(dados.fotos) || dados.fotos.length > 40 || dados.fotos.some(f => !Number.isSafeInteger(f) || f <= 0) || new Set(dados.fotos).size !== dados.fotos.length) throw erro('Seleção de fotos inválida');
  for (const foto of dados.fotos) {
    const f = db.prepare('SELECT veiculo_id, tipo, tipo_mime FROM anexos WHERE id = ?').get(foto);
    if (!f || f.veiculo_id !== id || f.tipo !== 'foto_veiculo' || !TIPOS_FOTO.has(f.tipo_mime)) throw erro('Escolha somente fotos deste carro. Documentos não podem ser publicados');
  }
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO anuncios (veiculo_id, titulo, descricao, preco, publicado, destaque) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(veiculo_id) DO UPDATE SET titulo = excluded.titulo, descricao = excluded.descricao, preco = excluded.preco,
      publicado = excluded.publicado, destaque = excluded.destaque, atualizado_em = datetime('now')`).run(id, titulo, descricao, preco, Number(dados.publicado), Number(dados.destaque));
    db.prepare('DELETE FROM anuncio_fotos WHERE veiculo_id = ?').run(id);
    const inserir = db.prepare('INSERT INTO anuncio_fotos (veiculo_id, anexo_id, ordem) VALUES (?, ?, ?)');
    dados.fotos.forEach((f, i) => inserir.run(id, f, i));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { id, publicado: dados.publicado };
}
function retirarAnuncio(id) {
  db.prepare('UPDATE anuncios SET publicado = 0 WHERE veiculo_id = ?').run(idValido(id));
  return { ok: true };
}
module.exports = { catalogo, anuncioPublico, fotoPublica, listarAnuncios, salvarAnuncio, retirarAnuncio, configPublica, configurarSite };
