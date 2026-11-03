'use strict';
// Galeria de fotos da loja: envio, ordem, remoção e o que fica público.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dados = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'correa-galeria-test-'));
process.env.PASTA_DADOS = dados;
const db = require('../db');
process.on('exit', () => { try { db.conexao.close(); } catch {} fs.rmSync(dados, { recursive: true, force: true }); });
const g = require('../galeria-loja');
let verificacoes = 0;
const ok = (v, texto) => { assert.ok(v, texto); verificacoes++; };
const rejeita = (fn, status = 400) => { assert.throws(fn, e => e.status === status); verificacoes++; };

const jpg = fs.readFileSync(path.join(__dirname, '..', 'public/img/banner.jpg'));
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]);
ok(g.listar().length === 0, 'Começa sem fotos');
rejeita(() => g.adicionar({ conteudo: Buffer.from('não é imagem'), tipoMime: 'image/jpeg' }));
rejeita(() => g.adicionar({ conteudo: jpg, tipoMime: 'application/pdf' }));
rejeita(() => g.adicionar({ conteudo: Buffer.alloc(0), tipoMime: 'image/jpeg' }));
let fotos = g.adicionar({ conteudo: jpg, tipoMime: 'image/jpeg', nomeOriginal: 'fachada.jpg' });
fotos = g.adicionar({ conteudo: webp, tipoMime: 'image/webp', nomeOriginal: 'noite.webp' });
ok(fotos.length === 2 && fotos[0].url === `/midia/loja/${fotos[0].id}`, 'Fotos entram na ordem de envio com endereço público');
const [a, b] = fotos.map(f => f.id);
ok(g.ordenar([b, a])[0].id === b, 'Ordem pode ser trocada');
rejeita(() => g.ordenar([a]));
rejeita(() => g.ordenar([a, a]));
ok(g.fotoPublica(a).tipo_mime === 'image/jpeg', 'Foto da galeria é pública');

// Documento de cliente nunca sai pelo endereço da galeria
const doc = db.criarAnexo({ conteudo: jpg, tipoMime: 'image/jpeg', nomeOriginal: 'cnh.jpg' });
db.definirTipoAnexo(doc, 'cnh');
rejeita(() => g.fotoPublica(doc), 404);
rejeita(() => g.remover(doc), 404);
ok(db.obterAnexo(doc), 'Documento continua guardado');

const caminho = db.obterAnexo(a).caminho;
ok(g.remover(a).length === 1 && !fs.existsSync(caminho), 'Remover apaga a foto e o arquivo');
rejeita(() => g.fotoPublica(a), 404);
console.log(`Galeria da loja: ${verificacoes} verificações aprovadas`);
