'use strict';
// Fotos da loja (fachada, pátio, atendimento) mostradas no site, perto do mapa do "Como chegar".
const fs = require('node:fs');
const { conexao: db, erro, criarAnexo, definirTipoAnexo, obterAnexo } = require('./db');

const MAX_FOTOS = 30;
const MAX_BYTES = 20 * 1024 * 1024;

db.exec(`
CREATE TABLE IF NOT EXISTS loja_fotos (
  anexo_id INTEGER PRIMARY KEY REFERENCES anexos(id),
  ordem INTEGER NOT NULL DEFAULT 0
);
`);

function listar() {
  return db.prepare('SELECT anexo_id AS id FROM loja_fotos ORDER BY ordem, anexo_id').all()
    .map(f => ({ id: f.id, url: `/midia/loja/${f.id}` }));
}

function adicionar({ conteudo: b, tipoMime, nomeOriginal }) {
  const tipoOk = tipoMime === 'image/jpeg' ? b[0] === 255 && b[1] === 216 && b[2] === 255
    : tipoMime === 'image/png' ? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : tipoMime === 'image/webp' ? b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' : false;
  if (!Buffer.isBuffer(b) || !b.length || b.length > MAX_BYTES) throw erro('Envie uma foto de até 20 MB');
  if (!tipoOk) throw erro('Envie uma foto JPG, PNG ou WebP');
  const total = db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(ordem), -1) AS ultima FROM loja_fotos').get();
  if (total.n >= MAX_FOTOS) throw erro(`A galeria aceita até ${MAX_FOTOS} fotos. Remova alguma antes de enviar outra.`);
  const id = criarAnexo({ conteudo: b, tipoMime, nomeOriginal: String(nomeOriginal || 'foto-loja').slice(0, 250) });
  definirTipoAnexo(id, 'foto_loja');
  db.prepare('INSERT INTO loja_fotos (anexo_id, ordem) VALUES (?, ?)').run(id, total.ultima + 1);
  return listar();
}

function remover(id) {
  const n = Number(id);
  if (!db.prepare('SELECT 1 FROM loja_fotos WHERE anexo_id = ?').get(n)) throw erro('Foto não encontrada', 404);
  const a = obterAnexo(n);
  db.prepare('DELETE FROM loja_fotos WHERE anexo_id = ?').run(n);
  db.prepare('DELETE FROM anexos WHERE id = ?').run(n);
  fs.rmSync(a.caminho, { force: true });
  return listar();
}

// Recebe a lista de ids na ordem desejada (a primeira foto é a que aparece primeiro no site)
function ordenar(ids) {
  const atuais = listar().map(f => f.id);
  if (!Array.isArray(ids) || ids.length !== atuais.length || ids.some(id => !atuais.includes(id)) || new Set(ids).size !== ids.length) throw erro('Ordem das fotos inválida');
  const gravar = db.prepare('UPDATE loja_fotos SET ordem = ? WHERE anexo_id = ?');
  db.exec('BEGIN');
  try { ids.forEach((id, i) => gravar.run(i, id)); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  return listar();
}

// Só entrega arquivos que estão na galeria (nunca outros anexos, como documentos de clientes)
function fotoPublica(id) {
  const n = Number(id);
  if (!db.prepare('SELECT 1 FROM loja_fotos WHERE anexo_id = ?').get(n)) throw erro('Foto não encontrada', 404);
  return obterAnexo(n);
}

module.exports = { listar, adicionar, remover, ordenar, fotoPublica, MAX_FOTOS };
