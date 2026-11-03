'use strict';
// Placa de preço para o vidro do carro (folha A4). Junta os dados do carro, do anúncio (se houver)
// e da loja; o que a equipe ajustar na placa fica guardado para reimprimir depois.
const { conexao: db, erro, obterVeiculo, obterConfig } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS placas (
  veiculo_id INTEGER PRIMARY KEY REFERENCES veiculos(id) ON DELETE CASCADE,
  dados TEXT NOT NULL,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
`);

const MAX_OPCIONAIS = 4;

function obter(id) {
  const { veiculo: v } = obterVeiculo(id);
  const linhaAnuncio = db.prepare('SELECT preco, versao, opcionais FROM publicacoes WHERE veiculo_id = ?').get(id);
  let opcionais = [];
  try { opcionais = linhaAnuncio ? JSON.parse(linhaAnuncio.opcionais) : []; } catch { /* anúncio sem opcionais válidos */ }
  const salvo = db.prepare('SELECT dados FROM placas WHERE veiculo_id = ?').get(id);
  const c = obterConfig();
  return {
    veiculo: { id: v.id, marca_modelo: v.marca_modelo, ano_fab: v.ano_fab, ano_mod: v.ano_mod, valor_consignacao: v.valor_consignacao ?? null },
    anuncio: linhaAnuncio ? { preco: linhaAnuncio.preco, versao: linhaAnuncio.versao, opcionais } : null,
    salvo: salvo ? JSON.parse(salvo.dados) : null,
    loja: { telefone: c.telefone, whatsapp: c.whatsapp, endereco: c.endereco, cidade: c.cidade },
  };
}

function texto(v, max) {
  if (v == null) return '';
  if (typeof v !== 'string') throw erro('Dados da placa inválidos');
  return v.trim().slice(0, max);
}

function salvar(id, dados = {}) {
  obterVeiculo(id);
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw erro('Dados da placa inválidos');
  const preco = dados.preco === null || dados.preco === '' || dados.preco === undefined ? null : Number(dados.preco);
  if (preco !== null && (!Number.isSafeInteger(preco) || preco <= 0)) throw erro('Confira o preço da placa');
  const opcionais = Array.isArray(dados.opcionais) ? dados.opcionais.map(o => texto(o, 40)).filter(Boolean) : [];
  if (opcionais.length > MAX_OPCIONAIS) throw erro(`Escolha no máximo ${MAX_OPCIONAIS} opcionais para a placa`);
  const limpo = {
    modelo: texto(dados.modelo, 30),
    versao: texto(dados.versao, 40),
    ano: texto(dados.ano, 12),
    destaque: texto(dados.destaque, 40),
    preco,
    opcionais,
  };
  db.prepare(`INSERT INTO placas (veiculo_id, dados) VALUES (?, ?)
    ON CONFLICT(veiculo_id) DO UPDATE SET dados = excluded.dados, atualizado_em = datetime('now', 'localtime')`)
    .run(id, JSON.stringify(limpo));
  return { ok: true };
}

module.exports = { obter, salvar, MAX_OPCIONAIS };
