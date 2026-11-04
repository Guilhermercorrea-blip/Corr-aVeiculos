'use strict';
// Prepara o convite. Não envia mensagens nem considera um clique como envio.
const db = require('./db');
const sql = db.conexao;
const LINK = 'https://g.page/r/CVnf0nCRZDLVEBM/review';
sql.exec(`CREATE TABLE IF NOT EXISTS avaliacao_convites (
  venda_id INTEGER PRIMARY KEY REFERENCES vendas(id) ON DELETE CASCADE,
  confirmado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);`);

function telefoneWhatsApp(valor) {
  const texto = String(valor || '').trim();
  if (!/^[+\d\s().-]+$/.test(texto)) return null;
  let n = texto.replace(/\D/g, '');
  if (n.startsWith('0055')) n = n.slice(2);
  if ((n.length === 12 || n.length === 13) && n.startsWith('55')) n = n.slice(2);
  // DDD + fixo de oito dígitos ou celular de nove; DDDs usados no Brasil.
  const ddds = new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));
  if (!ddds.has(n.slice(0, 2)) || !/^\d{2}(?:[2-5]\d{7}|9\d{8})$/.test(n)) return null;
  return '55' + n;
}

function obter(id) {
  const d = db.obterVeiculo(id);
  if (!d.venda || d.veiculo.status !== 'vendido') throw db.erro('Registre a venda antes de preparar o convite de avaliação.', 409);
  const telefone = telefoneWhatsApp(d.comprador?.telefone);
  const nome = String(d.comprador?.nome || '').trim().split(/\s+/)[0];
  const mensagem = `${nome ? 'Olá, ' + nome + '!' : 'Olá!'} Obrigado por escolher a Corrêa Veículos. Esperamos que aproveite seu carro!\n\nComo foi sua experiência com a nossa loja? Se puder, deixe sua avaliação sincera no Google:\n${LINK}\n\nSua opinião nos ajuda a melhorar. Muito obrigado!`;
  return {
    venda_id: d.venda.id,
    comprador_id: d.comprador.id,
    telefone: d.comprador.telefone || '',
    mensagem,
    url: telefone ? `https://wa.me/${telefone}?text=${encodeURIComponent(mensagem)}` : null,
    confirmado_em: sql.prepare('SELECT confirmado_em FROM avaliacao_convites WHERE venda_id = ?').get(d.venda.id)?.confirmado_em || null,
  };
}

function confirmar(id, dados = {}) {
  const atual = obter(id);
  if (dados.venda_id !== atual.venda_id) throw db.erro('A venda mudou. Atualize a tela antes de confirmar o envio.', 409);
  // Repetir a confirmação preserva a data, em vez de simular um novo envio.
  sql.prepare('INSERT INTO avaliacao_convites (venda_id) VALUES (?) ON CONFLICT(venda_id) DO NOTHING').run(atual.venda_id);
  return obter(id);
}
module.exports = { obter, confirmar, telefoneWhatsApp };
