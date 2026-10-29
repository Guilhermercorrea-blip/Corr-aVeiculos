'use strict';
// Banco de dados da loja (SQLite embutido no Node 24, sem instalar nada).
// Todos os valores em dinheiro ficam em CENTAVOS (número inteiro) para não ter erro de arredondamento.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// PASTA_DADOS permite rodar testes sem mexer nos dados reais da loja
const PASTA_DADOS = process.env.PASTA_DADOS || path.join(__dirname, 'data');
fs.mkdirSync(PASTA_DADOS, { recursive: true });
const db = new DatabaseSync(path.join(PASTA_DADOS, 'loja.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS pessoas (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  cpf TEXT UNIQUE,
  rg TEXT,
  nascimento TEXT,
  telefone TEXT,
  email TEXT,
  cep TEXT,
  endereco TEXT,
  numero TEXT,
  bairro TEXT,
  cidade TEXT,
  uf TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS veiculos (
  id INTEGER PRIMARY KEY,
  marca_modelo TEXT NOT NULL,
  ano_fab INTEGER,
  ano_mod INTEGER,
  cor TEXT,
  combustivel TEXT,
  placa TEXT,
  renavam TEXT,
  chassi TEXT,
  km_entrada INTEGER,
  -- compra: vai para o nome da loja
  -- compra_sem_transferir: loja já pagou, fica em consignação com adendo de quitação
  -- consignacao: dono recebe quando vender
  -- troca: entrou como parte do pagamento de uma venda
  tipo_entrada TEXT NOT NULL CHECK (tipo_entrada IN ('compra', 'compra_sem_transferir', 'consignacao', 'troca')),
  status TEXT NOT NULL DEFAULT 'estoque' CHECK (status IN ('estoque', 'vendido', 'devolvido')),
  fornecedor_id INTEGER REFERENCES pessoas(id),
  entrada_em TEXT NOT NULL,
  valor_compra INTEGER NOT NULL DEFAULT 0,
  comissao INTEGER,
  forma_pagamento TEXT,
  obs TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS gastos (
  id INTEGER PRIMARY KEY,
  veiculo_id INTEGER NOT NULL REFERENCES veiculos(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  categoria TEXT NOT NULL,
  descricao TEXT,
  valor INTEGER NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS vendas (
  id INTEGER PRIMARY KEY,
  veiculo_id INTEGER NOT NULL UNIQUE REFERENCES veiculos(id),
  comprador_id INTEGER NOT NULL REFERENCES pessoas(id),
  vendido_em TEXT NOT NULL,
  km_saida INTEGER,
  valor_venda INTEGER NOT NULL,
  valor_entrada INTEGER,
  forma_entrada TEXT,
  valor_financiado INTEGER,
  banco TEXT,
  parcelas INTEGER,
  valor_troca INTEGER,
  troca_veiculo_id INTEGER REFERENCES veiculos(id),
  valor_saldo INTEGER,
  saldo_vencimento TEXT,
  obs TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Fotos e PDFs anexados (CNH, CRLV...). O arquivo fica em data/anexos/<id>.<ext>
CREATE TABLE IF NOT EXISTS anexos (
  id INTEGER PRIMARY KEY,
  veiculo_id INTEGER REFERENCES veiculos(id) ON DELETE CASCADE,
  tipo TEXT,
  nome_original TEXT,
  tipo_mime TEXT NOT NULL,
  arquivo TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Dados da loja usados nos contratos
CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE INDEX IF NOT EXISTS idx_gastos_veiculo ON gastos(veiculo_id);
CREATE INDEX IF NOT EXISTS idx_anexos_veiculo ON anexos(veiculo_id);
CREATE INDEX IF NOT EXISTS idx_veiculos_status ON veiculos(status);

CREATE VIEW IF NOT EXISTS v_veiculos AS
SELECT v.*,
       p.nome AS fornecedor_nome,
       COALESCE((SELECT SUM(g.valor) FROM gastos g WHERE g.veiculo_id = v.id), 0) AS total_gastos,
       vd.valor_venda, vd.vendido_em, vd.comprador_id, c.nome AS comprador_nome
FROM veiculos v
LEFT JOIN pessoas p ON p.id = v.fornecedor_id
LEFT JOIN vendas vd ON vd.veiculo_id = v.id
LEFT JOIN pessoas c ON c.id = vd.comprador_id;
`);

// Colunas novas em bancos criados antes delas existirem
const colunasVenda = db.prepare('PRAGMA table_info(vendas)').all().map(c => c.name);
for (const [coluna, tipo] of [['forma_pagamento', 'TEXT'], ['valor_pix', 'INTEGER'], ['valor_deposito', 'INTEGER'], ['valor_dinheiro', 'INTEGER']]) {
  if (!colunasVenda.includes(coluna)) db.exec(`ALTER TABLE vendas ADD COLUMN ${coluna} ${tipo}`);
}

const TIPOS_ENTRADA =['compra', 'compra_sem_transferir', 'consignacao', 'troca'];
const CATEGORIAS_GASTO = ['oficina', 'pecas', 'combustivel', 'documentacao', 'estetica', 'comissao', 'outros'];

const CAMPOS_PESSOA = ['nome', 'cpf', 'rg', 'nascimento', 'telefone', 'email', 'cep', 'endereco', 'numero', 'bairro', 'cidade', 'uf'];
const CAMPOS_VEICULO = ['marca_modelo', 'ano_fab', 'ano_mod', 'cor', 'combustivel', 'placa', 'renavam', 'chassi', 'km_entrada',
  'tipo_entrada', 'entrada_em', 'valor_compra', 'comissao', 'forma_pagamento', 'obs'];
const CAMPOS_GASTO = ['data', 'categoria', 'descricao', 'valor'];
const CAMPOS_VENDA = ['vendido_em', 'km_saida', 'valor_venda', 'forma_pagamento', 'valor_pix', 'valor_deposito', 'valor_dinheiro',
  'valor_financiado', 'banco', 'parcelas', 'valor_troca', 'valor_saldo', 'saldo_vencimento', 'obs'];
const INTEIROS = new Set(['ano_fab', 'ano_mod', 'km_entrada', 'valor_compra', 'comissao', 'valor', 'km_saida', 'valor_venda',
  'valor_entrada', 'valor_pix', 'valor_deposito', 'valor_dinheiro', 'valor_financiado', 'parcelas', 'valor_troca', 'valor_saldo']);
// Formas de pagamento da venda: à vista (PIX, depósito e/ou dinheiro), entrada + financiamento, ou só financiamento
const FORMAS_PAGAMENTO = ['avista', 'entrada_financiamento', 'financiamento'];
const SO_DIGITOS = new Set(['cpf', 'renavam', 'cep']);
const MAIUSCULAS = new Set(['placa', 'chassi', 'uf']);

function erro(mensagem, status = 400) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

// Data e hora local no formato do campo datetime-local: 2026-10-29T14:30
function agora() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// Pega só os campos permitidos e normaliza (vazio vira null, números viram inteiros, placa em maiúsculas...)
function limpar(campos, dados = {}) {
  const saida = {};
  for (const c of campos) {
    if (!(c in dados)) continue;
    let v = dados[c];
    if (v === '' || v === undefined) v = null;
    if (v !== null && INTEIROS.has(c)) {
      v = Number(v);
      if (!Number.isFinite(v)) throw erro(`Valor inválido no campo "${c}"`);
      v = Math.round(v);
    } else if (v !== null) {
      v = String(v).trim();
      if (SO_DIGITOS.has(c)) v = v.replace(/\D/g, '');
      if (MAIUSCULAS.has(c)) v = v.toUpperCase().replace(c === 'placa' ? /[^A-Z0-9]/g : /\s/g, '');
      if (v === '') v = null;
    }
    saida[c] = v;
  }
  return saida;
}

function inserir(tabela, obj) {
  const cols = Object.keys(obj);
  const sql = `INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${cols.map(c => '@' + c).join(', ')})`;
  return Number(db.prepare(sql).run(obj).lastInsertRowid);
}

function atualizar(tabela, id, obj) {
  const cols = Object.keys(obj);
  if (!cols.length) return;
  db.prepare(`UPDATE ${tabela} SET ${cols.map(c => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...obj, id });
}

function transacao(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function diasEntre(inicio, fim) {
  return Math.max(0, Math.floor((new Date(fim) - new Date(inicio)) / 86400000));
}

// Custo total = compra + gastos; lucro = venda - custo total
function comCalculos(v) {
  const custo_total = v.valor_compra + v.total_gastos;
  return {
    ...v,
    custo_total,
    lucro: v.valor_venda == null ? null : v.valor_venda - custo_total,
    dias_estoque: diasEntre(v.entrada_em, v.vendido_em || agora()),
  };
}

// Cadastra a pessoa ou, se o CPF já existe, atualiza o cadastro dela. Devolve o id.
function salvarPessoa(dados) {
  const p = limpar(CAMPOS_PESSOA, dados);
  if (!p.nome) throw erro('Informe o nome da pessoa');
  if (p.cpf) {
    const existente = db.prepare('SELECT id FROM pessoas WHERE cpf = ?').get(p.cpf);
    if (existente) {
      const preenchidos = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null));
      atualizar('pessoas', existente.id, preenchidos);
      return existente.id;
    }
  }
  return inserir('pessoas', p);
}

function validarVeiculo(v) {
  if (!v.marca_modelo) throw erro('Informe a marca/modelo do carro');
  if (v.tipo_entrada && !TIPOS_ENTRADA.includes(v.tipo_entrada)) throw erro('Tipo de entrada inválido');
}

const PASTA_ANEXOS = path.join(PASTA_DADOS, 'anexos');
fs.mkdirSync(PASTA_ANEXOS, { recursive: true });
const EXTENSOES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

function criarAnexo({ conteudo, tipoMime, nomeOriginal }) {
  const ext = EXTENSOES[tipoMime];
  if (!ext) throw erro('Envie uma foto (JPG, PNG) ou um PDF');
  const id = inserir('anexos', { tipo_mime: tipoMime, nome_original: nomeOriginal || null, arquivo: 'pendente' });
  const arquivo = `${id}.${ext}`;
  fs.writeFileSync(path.join(PASTA_ANEXOS, arquivo), conteudo);
  atualizar('anexos', id, { arquivo });
  return id;
}

function definirTipoAnexo(id, tipo) {
  atualizar('anexos', id, { tipo });
}

function obterAnexo(id) {
  const a = db.prepare('SELECT * FROM anexos WHERE id = ?').get(id);
  if (!a) throw erro('Anexo não encontrado', 404);
  return { ...a, caminho: path.join(PASTA_ANEXOS, a.arquivo) };
}

// Liga ao carro os anexos lidos antes de salvar (só os que ainda não têm carro)
function vincularAnexos(ids, veiculoId) {
  const lista = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger);
  const sql = db.prepare('UPDATE anexos SET veiculo_id = ? WHERE id = ? AND veiculo_id IS NULL');
  for (const id of lista) sql.run(veiculoId, id);
}

function criarCompra({ pessoa, veiculo, anexos } = {}) {
  const v = limpar(CAMPOS_VEICULO, veiculo);
  validarVeiculo(v);
  if (!v.tipo_entrada || v.tipo_entrada === 'troca') throw erro('Escolha se é compra ou consignação');
  if (v.valor_compra == null) throw erro('Informe o valor do carro');
  v.entrada_em = v.entrada_em || agora();
  return transacao(() => {
    const fornecedor_id = salvarPessoa(pessoa);
    const id = inserir('veiculos', { ...v, fornecedor_id, status: 'estoque' });
    vincularAnexos(anexos, id);
    return { id };
  });
}

function listarVeiculos(status) {
  const linhas = status
    ? db.prepare('SELECT * FROM v_veiculos WHERE status = ? ORDER BY COALESCE(vendido_em, entrada_em) DESC').all(status)
    : db.prepare('SELECT * FROM v_veiculos ORDER BY entrada_em DESC').all();
  return linhas.map(comCalculos);
}

function obterVeiculo(id) {
  const v = db.prepare('SELECT * FROM v_veiculos WHERE id = ?').get(id);
  if (!v) throw erro('Carro não encontrado', 404);
  const pessoa = pid => (pid ? db.prepare('SELECT * FROM pessoas WHERE id = ?').get(pid) : null);
  const venda = db.prepare('SELECT * FROM vendas WHERE veiculo_id = ?').get(id) || null;
  const origemTroca = db.prepare(`
    SELECT vd.vendido_em, ve.id, ve.marca_modelo, ve.placa
    FROM vendas vd JOIN veiculos ve ON ve.id = vd.veiculo_id
    WHERE vd.troca_veiculo_id = ?`).get(id) || null;
  return {
    veiculo: comCalculos(v),
    fornecedor: pessoa(v.fornecedor_id),
    gastos: db.prepare('SELECT * FROM gastos WHERE veiculo_id = ? ORDER BY data DESC, id DESC').all(id),
    anexos: db.prepare('SELECT id, tipo, nome_original, tipo_mime, criado_em FROM anexos WHERE veiculo_id = ? ORDER BY id').all(id),
    venda,
    comprador: venda ? pessoa(venda.comprador_id) : null,
    troca: venda?.troca_veiculo_id ? db.prepare('SELECT id, marca_modelo, placa FROM veiculos WHERE id = ?').get(venda.troca_veiculo_id) : null,
    origemTroca,
  };
}

function atualizarVeiculo(id, { veiculo, pessoa } = {}) {
  obterVeiculo(id);
  const v = limpar(CAMPOS_VEICULO, veiculo);
  if ('marca_modelo' in v) validarVeiculo(v);
  transacao(() => {
    if (pessoa?.nome) v.fornecedor_id = salvarPessoa(pessoa);
    atualizar('veiculos', id, v);
  });
  return { id };
}

function adicionarGasto(veiculoId, dados) {
  obterVeiculo(veiculoId);
  const g = limpar(CAMPOS_GASTO, dados);
  if (!g.valor || g.valor <= 0) throw erro('Informe o valor do gasto');
  if (!CATEGORIAS_GASTO.includes(g.categoria)) throw erro('Escolha a categoria do gasto');
  g.data = g.data || agora().slice(0, 10);
  return { id: inserir('gastos', { ...g, veiculo_id: veiculoId }) };
}

function removerGasto(id) {
  db.prepare('DELETE FROM gastos WHERE id = ?').run(id);
  return { ok: true };
}

// anexos: CNH do comprador fica no carro vendido; CRLV da troca fica no carro da troca
function registrarVenda(id, { pessoa, venda, troca, anexos, anexosTroca } = {}) {
  const { veiculo } = obterVeiculo(id);
  if (veiculo.status !== 'estoque') throw erro('Este carro não está em estoque');
  const vd = limpar(CAMPOS_VENDA, venda);
  if (!vd.valor_venda || vd.valor_venda <= 0) throw erro('Informe o valor da venda');
  if (vd.km_saida == null) throw erro('Informe o km na entrega: é obrigatório para o contrato e para a garantia por km');
  vd.vendido_em = vd.vendido_em || agora();
  if (!troca) vd.valor_troca = null;

  if (!FORMAS_PAGAMENTO.includes(vd.forma_pagamento)) throw erro('Escolha a forma de pagamento');
  const financia = vd.forma_pagamento !== 'avista';
  if (financia) {
    if (!vd.banco) throw erro('Escolha o banco do financiamento');
    if (!vd.valor_financiado || vd.valor_financiado <= 0) throw erro('Informe o valor financiado');
  } else {
    vd.valor_financiado = vd.banco = vd.parcelas = null;
  }
  if (vd.forma_pagamento === 'financiamento') vd.valor_pix = vd.valor_deposito = vd.valor_dinheiro = null;
  // Entrada (ou pagamento à vista) = PIX + depósito + dinheiro; o texto resume como foi pago
  const partes = [['PIX', vd.valor_pix], ['Depósito bancário', vd.valor_deposito], ['Dinheiro', vd.valor_dinheiro]].filter(([, v]) => v > 0);
  vd.valor_entrada = partes.length ? partes.reduce((s, [, v]) => s + v, 0) : null;
  vd.forma_entrada = partes.length ? partes.map(([n]) => n).join(' + ') : null;
  if (vd.forma_pagamento === 'entrada_financiamento' && !vd.valor_entrada) throw erro('Informe o valor da entrada (PIX, depósito ou dinheiro)');
  const pago = (vd.valor_entrada || 0) + (vd.valor_financiado || 0) + (vd.valor_troca || 0) + (vd.valor_saldo || 0);
  if (pago !== vd.valor_venda) {
    const dif = (Math.abs(vd.valor_venda - pago) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    throw erro(pago < vd.valor_venda ? `O pagamento não fecha: faltam ${dif} para o valor da venda` : `O pagamento passa ${dif} do valor da venda`);
  }

  return transacao(() => {
    const comprador_id = salvarPessoa(pessoa);
    if (troca) {
      const t = limpar(CAMPOS_VEICULO, troca);
      validarVeiculo(t);
      if (!vd.valor_troca || vd.valor_troca <= 0) throw erro('Informe o valor do carro da troca');
      vd.troca_veiculo_id = inserir('veiculos', {
        ...t,
        tipo_entrada: 'troca',
        status: 'estoque',
        fornecedor_id: comprador_id,
        entrada_em: vd.vendido_em,
        valor_compra: vd.valor_troca,
      });
    }
    inserir('vendas', { ...vd, veiculo_id: id, comprador_id });
    atualizar('veiculos', id, { status: 'vendido' });
    if (vd.troca_veiculo_id) vincularAnexos(anexosTroca, vd.troca_veiculo_id);
    vincularAnexos(anexos, id);
    return { id, troca_veiculo_id: vd.troca_veiculo_id || null };
  });
}

// Completa o km de uma venda já registrada (vendas antigas, de antes do km ser obrigatório)
function atualizarKmVenda(id, dados) {
  const { km_saida } = limpar(['km_saida'], dados);
  if (km_saida == null) throw erro('Informe o km na entrega');
  const r = db.prepare('UPDATE vendas SET km_saida = ? WHERE veiculo_id = ?').run(km_saida, id);
  if (!r.changes) throw erro('Este carro não tem venda registrada', 404);
  return { id };
}

function desfazerVenda(id) {
  const venda = db.prepare('SELECT * FROM vendas WHERE veiculo_id = ?').get(id);
  if (!venda) throw erro('Este carro não tem venda registrada');
  transacao(() => {
    if (venda.troca_veiculo_id) {
      const t = db.prepare('SELECT status FROM veiculos WHERE id = ?').get(venda.troca_veiculo_id);
      if (t && t.status !== 'estoque') throw erro('O carro que entrou na troca já foi vendido. Desfaça aquela venda primeiro.');
    }
    db.prepare('DELETE FROM vendas WHERE id = ?').run(venda.id);
    if (venda.troca_veiculo_id) db.prepare('DELETE FROM veiculos WHERE id = ?').run(venda.troca_veiculo_id);
    atualizar('veiculos', id, { status: 'estoque' });
  });
  return { id };
}

// Apaga o carro com gastos e anexos (para cadastros de teste ou feitos por engano)
function excluirVeiculo(id) {
  const { veiculo, origemTroca } = obterVeiculo(id);
  if (veiculo.status === 'vendido') throw erro('Este carro está vendido. Desfaça a venda antes de excluir.');
  if (origemTroca) throw erro(`Este carro entrou na troca do ${origemTroca.marca_modelo}. Desfaça aquela venda para tirá-lo do estoque.`);
  const arquivos = db.prepare('SELECT arquivo FROM anexos WHERE veiculo_id = ?').all(id);
  db.prepare('DELETE FROM veiculos WHERE id = ?').run(id);
  for (const a of arquivos) fs.rmSync(path.join(PASTA_ANEXOS, a.arquivo), { force: true });
  return { ok: true };
}

// Cadastro rápido do estoque que já existe: só o carro e o valor, sem vendedor nem contrato
function criarEstoqueRapido(lista = []) {
  const carros = lista.map(item => limpar(CAMPOS_VEICULO, item)).filter(v => v.marca_modelo || v.placa);
  if (!carros.length) throw erro('Preencha pelo menos um carro');
  carros.forEach((v, i) => {
    if (!v.marca_modelo) throw erro(`Linha ${i + 1}: informe a marca/modelo`);
    if (v.valor_compra == null) throw erro(`Linha ${i + 1}: informe o valor pago`);
  });
  return transacao(() => ({
    ids: carros.map(v => inserir('veiculos', {
      ...v,
      tipo_entrada: v.tipo_entrada && v.tipo_entrada !== 'troca' ? v.tipo_entrada : 'compra',
      entrada_em: v.entrada_em || agora(),
      status: 'estoque',
    })),
  }));
}

function resumo() {
  const todos = listarVeiculos();
  const mes = agora().slice(0, 7);
  const soma = (lista, campo) => lista.reduce((s, v) => s + (v[campo] || 0), 0);
  const estoque = todos.filter(v => v.status === 'estoque');
  const vendidos = todos.filter(v => v.status === 'vendido').sort((a, b) => b.vendido_em.localeCompare(a.vendido_em));
  const vendidosMes = vendidos.filter(v => v.vendido_em.startsWith(mes));
  return {
    mes,
    estoque: { qtd: estoque.length, investido: soma(estoque, 'custo_total') },
    vendasMes: { qtd: vendidosMes.length, faturamento: soma(vendidosMes, 'valor_venda'), lucro: soma(vendidosMes, 'lucro') },
    parados: estoque.filter(v => v.dias_estoque >= 60).sort((a, b) => b.dias_estoque - a.dias_estoque),
    ultimasVendas: vendidos.slice(0, 5),
  };
}

const CONFIG_PADRAO = {
  razao_social: 'CORRÊA VEÍCULOS LTDA',
  cnpj: '07.793.106/0001-39',
  endereco: 'Avenida Papa João Paulo II, nº 3143 - Jd. Ouro Verde',
  cidade: 'Barra Bonita/SP',
  cep: '17342-450',
  telefone: '(14) 3641-8510',
  whatsapp: '(14) 99887-0734',
  representante: '',
  representante_cpf: '',
  foro: 'Barra Bonita/SP',
  garantia_dias: '90',
  garantia_km: '3000',
};

function obterConfig() {
  const salvos = Object.fromEntries(db.prepare('SELECT chave, valor FROM config').all().map(r => [r.chave, r.valor]));
  return { ...CONFIG_PADRAO, ...salvos };
}

function salvarConfig(dados = {}) {
  const sql = db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor');
  for (const chave of Object.keys(CONFIG_PADRAO)) {
    if (chave in dados) sql.run(chave, String(dados[chave] ?? '').trim());
  }
  return obterConfig();
}

function listarPessoas({ busca, cpf } = {}) {
  if (cpf) return db.prepare('SELECT * FROM pessoas WHERE cpf = ?').get(cpf.replace(/\D/g, '')) || null;
  const termo = `%${(busca || '').trim()}%`;
  return db.prepare('SELECT * FROM pessoas WHERE nome LIKE ? OR cpf LIKE ? ORDER BY nome LIMIT 200').all(termo, termo);
}

module.exports = {
  conexao: db, CATEGORIAS_GASTO, erro,
  criarAnexo, definirTipoAnexo, obterAnexo,
  criarCompra, listarVeiculos, obterVeiculo, atualizarVeiculo,
  adicionarGasto, removerGasto, registrarVenda, atualizarKmVenda, desfazerVenda, excluirVeiculo, criarEstoqueRapido,
  resumo, listarPessoas, obterConfig, salvarConfig,
};
