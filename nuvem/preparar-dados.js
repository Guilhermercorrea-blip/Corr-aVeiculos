'use strict';
// Junta os dados do notebook (banco + anexos) em nuvem/dados-para-enviar, para levar ao servidor.
// Pode rodar com o sistema aberto: a cópia do banco é consistente.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const raiz = path.join(__dirname, '..');
const dados = path.join(raiz, 'data');
const saida = path.join(__dirname, 'dados-para-enviar');

fs.rmSync(saida, { recursive: true, force: true });
fs.mkdirSync(saida, { recursive: true });
const db = new DatabaseSync(path.join(dados, 'loja.db'));
db.exec(`VACUUM INTO '${path.join(saida, 'loja.db').replace(/'/g, "''")}'`);
const resumo = db.prepare('SELECT (SELECT COUNT(*) FROM veiculos) carros, (SELECT COUNT(*) FROM usuarios) usuarios').get();
db.close();
if (fs.existsSync(path.join(dados, 'anexos'))) fs.cpSync(path.join(dados, 'anexos'), path.join(saida, 'anexos'), { recursive: true });
console.log(`Dados prontos para enviar: ${resumo.carros} carro(s), ${resumo.usuarios} usuário(s) -> ${saida}`);
