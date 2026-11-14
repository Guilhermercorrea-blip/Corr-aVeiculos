'use strict';
// Aniversariantes: clientes (compradores e vendedores) que fazem aniversário hoje e nos próximos dias.
// Só prepara a mensagem de parabéns para o WhatsApp; quem envia é a equipe (abrir a conversa não envia nada).
const db = require('./db');
const { telefoneWhatsApp } = require('./avaliacoes');
const sql = db.conexao;

sql.exec(`CREATE TABLE IF NOT EXISTS aniversario_envios (
  pessoa_id INTEGER NOT NULL REFERENCES pessoas(id) ON DELETE CASCADE,
  ano INTEGER NOT NULL,
  enviado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  PRIMARY KEY (pessoa_id, ano)
);`);

const FUSO = process.env.FUSO_LOJA || 'America/Sao_Paulo';
// Data de hoje na loja, como {ano, mes, dia}
function hojeNaLoja(agora = new Date()) {
  const [ano, mes, dia] = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(agora).split('-').map(Number);
  return { ano, mes, dia };
}
const ehBissexto = a => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;

function mensagem(nomeCompleto) {
  const nome = String(nomeCompleto || '').trim().split(/\s+/)[0];
  const primeiro = nome ? nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase() : '';
  return `🎉 Feliz aniversário${primeiro ? ', ' + primeiro : ''}! 🎂

Hoje o dia é todo seu! A família Corrêa Veículos deseja muita saúde, alegria e muitos quilômetros de conquistas pela frente. 🚗💨

Obrigado por fazer parte da nossa história. Conte sempre com a gente!

Um grande abraço,
Equipe Corrêa Veículos 💙❤️`;
}

// Hoje e os próximos `dias` dias (padrão 7). Quem nasceu em 29/02 comemora em 28/02 nos anos que não são bissextos.
function listar({ dias = 7, agora = new Date() } = {}) {
  const limite = Math.min(Math.max(Number(dias) || 0, 0), 31);
  const hoje = hojeNaLoja(agora);
  const base = Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia);
  const pessoas = sql.prepare(`SELECT id, nome, telefone, nascimento FROM pessoas
    WHERE arquivado_em IS NULL AND nascimento IS NOT NULL AND nascimento <> ''`).all();
  const enviados = new Set(sql.prepare('SELECT pessoa_id FROM aniversario_envios WHERE ano = ?').all(hoje.ano).map(e => e.pessoa_id));
  const lista = [];
  for (const p of pessoas) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(p.nascimento);
    if (!m) continue;
    const [nAno, nMes, nDia] = [Number(m[1]), Number(m[2]), Number(m[3])];
    // Próximo aniversário a partir de hoje (este ano ou o que vem)
    let proximo = null;
    for (const ano of [hoje.ano, hoje.ano + 1]) {
      const dia = nMes === 2 && nDia === 29 && !ehBissexto(ano) ? 28 : nDia;
      const t = Date.UTC(ano, nMes - 1, dia);
      if (t >= base) { proximo = { ano, t }; break; }
    }
    if (!proximo) continue;
    const faltam = Math.round((proximo.t - base) / 86400000);
    if (faltam > limite) continue;
    const telefone = telefoneWhatsApp(p.telefone);
    const texto = mensagem(p.nome);
    lista.push({
      pessoa_id: p.id, nome: p.nome, telefone: p.telefone || '', faltam,
      data: `${String(nDia).padStart(2, '0')}/${String(nMes).padStart(2, '0')}`,
      idade: proximo.ano - nAno,
      mensagem: texto,
      url: telefone ? `https://wa.me/${telefone}?text=${encodeURIComponent(texto)}` : null,
      enviado: faltam === 0 && enviados.has(p.id),
    });
  }
  return lista.sort((a, b) => a.faltam - b.faltam || a.nome.localeCompare(b.nome, 'pt-BR'));
}

// "Já enviei": marca que os parabéns deste ano foram mandados (só no dia do aniversário)
function confirmar(pessoaId, agora = new Date()) {
  const id = Number(pessoaId);
  if (!listar({ dias: 0, agora }).some(a => a.pessoa_id === id)) throw db.erro('Hoje não é o aniversário desta pessoa.', 409);
  sql.prepare('INSERT INTO aniversario_envios (pessoa_id, ano) VALUES (?, ?) ON CONFLICT DO NOTHING').run(id, hojeNaLoja(agora).ano);
  return listar({ agora });
}

module.exports = { listar, confirmar, mensagem, hojeNaLoja };
