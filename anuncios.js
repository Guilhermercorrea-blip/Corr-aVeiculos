'use strict';
// Vitrine pública: somente campos e fotos escolhidos para anúncio saem do sistema.
const { conexao: db, erro, obterConfig } = require('./db');

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

const publicacoes = require('./publicacoes');
const CAMPOS_SITE = ['nome', 'chamada', 'sobre', 'endereco', 'cidade', 'telefone', 'whatsapp', 'horario', 'instagram', 'facebook'];
function objeto(dados) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw erro('Dados inválidos');
  return dados;
}
function texto(valor, campo, max) {
  if (typeof valor !== 'string' || valor.length > max) throw erro(`Confira o campo ${campo} (até ${max} caracteres)`);
  return valor.trim();
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
  for (const campo of ['instagram', 'facebook']) if (valores[campo]) {
    let url;
    try { url = new URL(valores[campo]); } catch { throw erro(`Informe o endereço completo do ${campo}`); }
    if (url.protocol !== 'https:' || ![`${campo}.com`, `www.${campo}.com`].includes(url.hostname) || url.username || url.password || url.port) throw erro(`Use um endereço https://www.${campo}.com/ da loja`);
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
    horario: '', instagram: 'https://www.instagram.com/correa.veiculos/', facebook: 'https://www.facebook.com/correaveiculosltda', ...salvos,
  };
}
function catalogo() {
  return { loja: configPublica(), carros: publicacoes.listarPublicos() };
}
function anuncioPublico(id) {
  return { loja: configPublica(), carro: publicacoes.publico(id) };
}
function fotoPublica(veiculoId, anexoId) {
  return publicacoes.fotoPublica(veiculoId, anexoId);
}
function listarAnuncios() {
  return publicacoes.listarLegado();
}
function salvarAnuncio(veiculoId, dados) {
  return publicacoes.salvarLegado(veiculoId, dados);
}
function retirarAnuncio(id) {
  return publicacoes.retirarLegado(id);
}
module.exports = { catalogo, anuncioPublico, fotoPublica, listarAnuncios, salvarAnuncio, retirarAnuncio, configPublica, configurarSite };
