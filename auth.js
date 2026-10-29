'use strict';
// Login: usuários com senha criptografada (scrypt) e sessões guardadas no banco.
const crypto = require('node:crypto');
const { conexao: db, erro } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE TABLE IF NOT EXISTS redefinicoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira INTEGER NOT NULL
);
`);

const DURACAO_SESSAO = 30 * 24 * 3600 * 1000; // 30 dias logado no mesmo aparelho
const JANELA_TENTATIVAS = 15 * 60 * 1000;
const MAX_TENTATIVAS = 10;
const tentativas = new Map(); // ip -> { n, desde }

function gerarHash(senha, sal = crypto.randomBytes(16).toString('hex')) {
  return `${sal}:${crypto.scryptSync(String(senha), sal, 64).toString('hex')}`;
}

function senhaConfere(senha, guardado) {
  const [sal, hash] = guardado.split(':');
  const esperado = Buffer.from(hash, 'hex');
  const calculado = crypto.scryptSync(String(senha), sal, 64);
  return esperado.length === calculado.length && crypto.timingSafeEqual(esperado, calculado);
}

function validarSenha(senha) {
  if (!senha || String(senha).length < 6) throw erro('A senha precisa ter pelo menos 6 caracteres');
}

const temUsuarios = () => Boolean(db.prepare('SELECT 1 FROM usuarios LIMIT 1').get());

function criarUsuario({ nome, usuario, senha } = {}) {
  const login = String(usuario || '').trim().toLowerCase();
  if (!String(nome || '').trim()) throw erro('Informe o nome');
  if (!/^[a-z0-9._-]{3,30}$/.test(login)) throw erro('Usuário: de 3 a 30 letras ou números, sem espaço e sem acento');
  validarSenha(senha);
  if (db.prepare('SELECT 1 FROM usuarios WHERE usuario = ?').get(login)) throw erro('Esse usuário já existe');
  const r = db.prepare('INSERT INTO usuarios (nome, usuario, senha_hash) VALUES (?, ?, ?)').run(String(nome).trim(), login, gerarHash(senha));
  return { id: Number(r.lastInsertRowid) };
}

function entrar({ usuario, senha } = {}, ip) {
  const t = tentativas.get(ip);
  const recente = t && Date.now() - t.desde < JANELA_TENTATIVAS;
  if (recente && t.n >= MAX_TENTATIVAS) throw erro('Muitas tentativas erradas. Espere 15 minutos e tente de novo.', 429);
  const u = db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(String(usuario || '').trim().toLowerCase());
  if (!u || !senhaConfere(senha || '', u.senha_hash)) {
    const registro = recente ? t : { n: 0, desde: Date.now() };
    registro.n++;
    tentativas.set(ip, registro);
    throw erro('Usuário ou senha incorretos', 401);
  }
  tentativas.delete(ip);
  db.prepare('DELETE FROM sessoes WHERE expira < ?').run(Date.now());
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessoes (token, usuario_id, expira) VALUES (?, ?, ?)').run(token, u.id, Date.now() + DURACAO_SESSAO);
  return { token, maxAge: DURACAO_SESSAO / 1000 };
}

function usuarioDaSessao(token) {
  if (!token) return null;
  const s = db.prepare(`SELECT s.expira, u.id, u.nome, u.usuario FROM sessoes s
    JOIN usuarios u ON u.id = s.usuario_id WHERE s.token = ?`).get(token);
  if (!s) return null;
  if (s.expira < Date.now()) {
    sair(token);
    return null;
  }
  return { id: s.id, nome: s.nome, usuario: s.usuario };
}

function sair(token) {
  if (token) db.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
}

const listarUsuarios = () => db.prepare('SELECT id, nome, usuario, criado_em FROM usuarios ORDER BY nome').all();

// Troca a senha e desconecta os outros aparelhos desse usuário (o atual continua logado)
function trocarSenha(usuarioId, tokenAtual, { atual, nova } = {}) {
  const u = db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').get(usuarioId);
  if (!u || !senhaConfere(atual || '', u.senha_hash)) throw erro('A senha atual está errada');
  validarSenha(nova);
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(gerarHash(nova), usuarioId);
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND token <> ?').run(usuarioId, tokenAtual);
  return { ok: true };
}

// Esqueceu a senha: quem tem acesso ao servidor gera um link de uso único (vale 30 minutos)
// e a própria pessoa escolhe a senha nova nele. Ninguém mais fica sabendo a senha.
const VALIDADE_REDEFINICAO = 30 * 60 * 1000;

function criarRedefinicao(usuario) {
  const u = db.prepare('SELECT id FROM usuarios WHERE usuario = ?').get(String(usuario || '').trim().toLowerCase());
  if (!u) throw erro('Usuário não encontrado');
  db.prepare('DELETE FROM redefinicoes WHERE usuario_id = ? OR expira < ?').run(u.id, Date.now());
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO redefinicoes (token, usuario_id, expira) VALUES (?, ?, ?)').run(token, u.id, Date.now() + VALIDADE_REDEFINICAO);
  return token;
}

function usuarioDaRedefinicao(token) {
  const r = db.prepare(`SELECT r.expira, u.id, u.nome, u.usuario FROM redefinicoes r
    JOIN usuarios u ON u.id = r.usuario_id WHERE r.token = ?`).get(String(token || ''));
  if (!r || r.expira < Date.now()) throw erro('Link vencido ou já usado. Peça um link novo.', 404);
  return { id: r.id, nome: r.nome, usuario: r.usuario };
}

function redefinirSenha({ token, nova } = {}) {
  const u = usuarioDaRedefinicao(token);
  validarSenha(nova);
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(gerarHash(nova), u.id);
  db.prepare('DELETE FROM redefinicoes WHERE usuario_id = ?').run(u.id);
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(u.id);
  return { usuario: u.usuario };
}

function removerUsuario(id, usuarioAtualId) {
  if (id === usuarioAtualId) throw erro('Você não pode remover o próprio usuário');
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
  return { ok: true };
}

module.exports = {
  temUsuarios, criarUsuario, entrar, usuarioDaSessao, sair, listarUsuarios, trocarSenha, removerUsuario,
  criarRedefinicao, usuarioDaRedefinicao, redefinirSenha,
};
