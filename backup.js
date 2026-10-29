'use strict';
// Faz uma cópia segura do banco (mesmo com o sistema aberto) e dos anexos.
// Uso: node backup.js [pasta-destino]   (padrão: data/backups)
// Guarda os últimos 30 backups e apaga os mais antigos.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PASTA_DADOS = process.env.PASTA_DADOS || path.join(__dirname, 'data');
const destino = process.argv[2] || path.join(PASTA_DADOS, 'backups');
const MANTER = 30;

const carimbo = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const pasta = path.join(destino, `backup-${carimbo}`);
fs.mkdirSync(pasta, { recursive: true });

// VACUUM INTO gera uma cópia consistente mesmo com o sistema gravando ao mesmo tempo
const db = new DatabaseSync(path.join(PASTA_DADOS, 'loja.db'));
db.exec(`VACUUM INTO '${path.join(pasta, 'loja.db').replace(/'/g, "''")}'`);
db.close();

const anexos = path.join(PASTA_DADOS, 'anexos');
if (fs.existsSync(anexos)) fs.cpSync(anexos, path.join(pasta, 'anexos'), { recursive: true });

const antigos = fs.readdirSync(destino).filter(n => n.startsWith('backup-')).sort();
for (const nome of antigos.slice(0, Math.max(0, antigos.length - MANTER))) {
  fs.rmSync(path.join(destino, nome), { recursive: true, force: true });
}
console.log(`Backup salvo em ${pasta}`);
