'use strict';
// Gera um link para criar senha nova (para quem esqueceu). Rodar no servidor:
//   node redefinir-senha.js <usuario>
// O link vale 30 minutos e só pode ser usado uma vez.
const auth = require('./auth');

const usuario = process.argv[2];
if (!usuario) {
  console.log('Uso: node redefinir-senha.js <usuario>');
  process.exit(1);
}
const endereco = process.env.ENDERECO_PUBLICO || `http://localhost:${process.env.PORT || 3000}`;
const token = auth.criarRedefinicao(usuario);
console.log(`Link para criar senha nova (vale 30 minutos):\n${endereco}/redefinir.html?t=${token}`);
