'use strict';
// Nota de serviço (NFS-e) de comissão de banco emitida pelo sistema, direto na API da Receita.
// Segurança: só emite no computador da loja (o arquivo do certificado fica aqui) e a senha do certificado
// chega a cada emissão, usada na hora e descartada. Nada é enviado sem o aviso de confirmação da tela.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const db = require('./db');
const nfse = require('./nfse');

// Série própria do sistema (a 1 já foi usada por outra nota da loja: a Receita recusou com E0014)
// No servidor da nuvem usa-se a série 101 (NFSE_SERIE), para nunca bater com a numeração do PC
const SERIE = Number(process.env.NFSE_SERIE) || 100;
const PFX_PADRAO = ['D:\\Formatar\\CertificadoCorrea.pfx', path.join(os.homedir(), 'OneDrive', 'Área de Trabalho', 'CertificadoCorreaVeiculos.pfx')];

function caminhoCertificado() {
  const c = process.env.NFSE_PFX;
  if (c) return fs.existsSync(c) ? c : null;
  return PFX_PADRAO.find(p => fs.existsSync(p)) || null;
}

// A produção só entra quando for pedida (NFSE_AMBIENTE=producao). Até lá, o sistema fala com o ambiente de testes.
function ambienteAtual() { return process.env.NFSE_AMBIENTE === 'producao' ? 'producao' : 'teste'; }

function proximoNumero(ambiente) {
  const r = db.conexao.prepare('SELECT MAX(n_dps) AS n FROM nfse_notas WHERE ambiente = ? AND serie = ?').get(ambiente, SERIE);
  return (r.n || 0) + 1;
}

function hojeISO() {
  const d = new Date(Date.now() - 3 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

// Carro consignado: o dono (consignante) é o tomador e o carro entra na descrição. Tudo vem do cadastro, não da tela.
function dadosConsignado(veiculoId) {
  const v = db.conexao.prepare('SELECT v.*, p.nome AS dono_nome, p.cpf AS dono_cpf FROM veiculos v LEFT JOIN pessoas p ON p.id = v.fornecedor_id WHERE v.id = ?').get(Number(veiculoId));
  if (!v) throw db.erro('Escolha o carro consignado.', 400);
  if (v.tipo_entrada !== 'consignacao') throw db.erro('Esse carro não é de consignação.', 400);
  if (!nfse.cpfValido(v.dono_cpf)) throw db.erro('O dono desse carro não tem CPF válido no cadastro. Corrija em Pessoas e tente de novo.', 400);
  const texto = [v.marca_modelo, v.ano_fab && v.ano_mod ? v.ano_fab + '/' + v.ano_mod : '', v.cor, v.placa ? 'PLACA ' + v.placa : ''].filter(Boolean).join(' ');
  return { veiculo_id: v.id, cpf: String(v.dono_cpf).replace(/\D/g, ''), nome: v.dono_nome, veiculoTexto: texto };
}

function validarPedido(c) {
  if (c.tomador === 'cliente-consignacao') {
    const d = dadosConsignado(c.veiculo_id);
    const valor = Number(c.valor);
    if (!Number.isInteger(valor) || valor <= 0) throw db.erro('Informe o valor da comissão.', 400);
    if (valor > 5000000) throw db.erro('Valor acima de R$ 50.000,00: confira se está certo.', 400);
    const competencia = String(c.competencia || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(competencia)) throw db.erro('Informe a data de competência.', 400);
    if (competencia > hojeISO()) throw db.erro('A competência não pode ser uma data futura.', 400);
    return { tomador: c.tomador, valor, competencia, ticket: null, ...d };
  }
  const pf = c.tomador === 'pessoa-fisica';
  const t = pf ? { tipo: 'pf' } : nfse.TOMADORES[c.tomador];
  if (!t) throw db.erro('Escolha o banco.', 400);
  if (pf) {
    if (!nfse.cpfValido(c.cpf)) throw db.erro('CPF inválido.', 400);
    if (String(c.nome || '').trim().split(/\s+/).length < 2) throw db.erro('Informe o nome completo.', 400);
  }
  const valor = Number(c.valor);
  if (!Number.isInteger(valor) || valor <= 0) throw db.erro('Informe o valor da comissão.', 400);
  if (valor > 5000000) throw db.erro('Valor acima de R$ 50.000,00: confira se está certo.', 400);
  const competencia = String(c.competencia || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(competencia)) throw db.erro('Informe a data de competência.', 400);
  if (competencia > hojeISO()) throw db.erro('A competência não pode ser uma data futura.', 400);
  const ticket = c.ticket ? String(c.ticket).trim() : '';
  if (t.tipo === 'seguros' && !/^\d{1,20}$/.test(ticket)) throw db.erro('Nota de seguros precisa do número do ticket (só números).', 400);
  if (t.tipo !== 'seguros' && ticket) throw db.erro('Só nota de seguros leva ticket.', 400);
  return { tomador: c.tomador, valor, competencia, ticket: ticket || null, ...(pf ? { cpf: String(c.cpf).replace(/\D/g, ''), nome: String(c.nome).trim() } : {}) };
}

function listar() {
  const notas = db.conexao.prepare('SELECT id, ambiente, serie, n_dps, tomador, tomador_doc, tomador_nome, veiculo_id, competencia, valor, ticket, status, chave, numero_nfse, mensagem, criado_em FROM nfse_notas ORDER BY id DESC LIMIT 100').all();
  const amb = ambienteAtual();
  return {
    habilitado: !!caminhoCertificado(),
    ambiente: amb,
    certificado: caminhoCertificado() ? path.basename(caminhoCertificado()) : null,
    proximoNumero: proximoNumero(amb),
    hoje: hojeISO(),
    tomadores: [...Object.entries(nfse.TOMADORES).map(([id, t]) => ({ id, nome: t.nome, tipo: t.tipo, cnpj: t.cnpj, codigo: t.cTribNac })), { id: 'cliente-consignacao', nome: 'Cliente: dono de carro consignado (comissão da venda)', tipo: 'consig', codigo: '100501' }, { id: 'pessoa-fisica', nome: 'Pessoa física (nota de teste do sistema)', tipo: 'pf', codigo: '100501' }],
    carrosConsignados: carrosConsignados(),
    notas,
  };
}

// Carros em consignação (vendidos primeiro): são os que dão nota de serviço ao dono quando a loja fica com a diferença
function carrosConsignados() {
  const linhas = db.conexao.prepare(`
    SELECT v.id, v.marca_modelo, v.ano_fab, v.ano_mod, v.placa, v.status, v.valor_compra, vd.vendido_em, vd.valor_venda, p.nome AS dono_nome, p.cpf AS dono_cpf
    FROM veiculos v LEFT JOIN vendas vd ON vd.veiculo_id = v.id LEFT JOIN pessoas p ON p.id = v.fornecedor_id
    WHERE v.tipo_entrada = 'consignacao'
    ORDER BY (vd.vendido_em IS NULL), vd.vendido_em DESC, v.id DESC LIMIT 60`).all();
  const emitidas = new Map(db.conexao.prepare("SELECT veiculo_id, numero_nfse FROM nfse_notas WHERE status = 'emitida' AND veiculo_id IS NOT NULL").all().map(n => [n.veiculo_id, n.numero_nfse]));
  return linhas.map(l => ({
    id: l.id, rotulo: [l.marca_modelo, l.placa].filter(Boolean).join(' · '), dono: l.dono_nome, cpfOk: nfse.cpfValido(l.dono_cpf),
    vendido: l.status === 'vendido', vendidoEm: l.vendido_em ? String(l.vendido_em).slice(0, 10) : null,
    valorVenda: l.valor_venda ?? null, valorLiquido: l.valor_compra ?? null,
    diferenca: l.valor_venda != null && l.valor_compra != null ? l.valor_venda - l.valor_compra : null,
    notaEmitida: emitidas.get(l.id) || null,
  }));
}

function avisosDoCarro(veiculoId) {
  const ja = db.conexao.prepare("SELECT numero_nfse, criado_em FROM nfse_notas WHERE veiculo_id = ? AND status = 'emitida' ORDER BY id DESC").get(veiculoId);
  return ja ? [`Já existe a nota nº ${ja.numero_nfse} emitida para este carro (${String(ja.criado_em).slice(0, 10).split('-').reverse().join('/')}). Só emita outra se for mesmo necessário.`] : [];
}

// Mostra o que será enviado, sem enviar nada
function previa(corpo) {
  const p = validarPedido(corpo);
  const n = proximoNumero(ambienteAtual());
  const d = nfse.montarDps({ ...p, nDps: n, serie: SERIE, ambiente: ambienteAtual() });
  return {
    ambiente: ambienteAtual(),
    banco: d.tomador.nome, documento: d.tomador.cpf ? 'CPF ' + d.tomador.cpf : 'CNPJ ' + d.tomador.cnpj,
    avisos: p.veiculo_id ? avisosDoCarro(p.veiculo_id) : [], codigo: d.tomador.cTribNac, nbs: d.tomador.nbs,
    descricao: nfse.descricaoServico(d.tomador, p.competencia, p.ticket),
    competencia: p.competencia, valor: p.valor, iss: d.iss, aliquota: 3, numeroDps: n,
  };
}

async function emitir(corpo) {
  const caminho = caminhoCertificado();
  if (!caminho) throw db.erro('O certificado digital não está neste computador. A emissão só funciona no PC da loja.', 400);
  if (corpo.confirmar !== true) throw db.erro('Confirme a emissão na tela antes de enviar.', 400);
  const p = validarPedido(corpo);
  const ambiente = ambienteAtual();
  if (ambiente === 'producao' && corpo.confirmarProducao !== true) throw db.erro('Esta nota vale de verdade. Marque a confirmação de nota real.', 400);
  const cert = nfse.carregarCertificado(caminho, String(corpo.senha || ''));

  // Reserva o número ANTES de enviar: se a conexão cair no meio, o número não é reaproveitado por engano
  const nDps = proximoNumero(ambiente);
  const dps = nfse.montarDps({ ...p, nDps, serie: SERIE, ambiente });
  const info = db.conexao.prepare(
    "INSERT INTO nfse_notas (ambiente, serie, n_dps, tomador, tomador_doc, tomador_nome, veiculo_id, competencia, valor, ticket, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'enviando')"
  ).run(ambiente, SERIE, nDps, p.tomador, p.cpf || null, p.nome || null, p.veiculo_id || null, p.competencia, p.valor, p.ticket);
  const id = Number(info.lastInsertRowid);
  const atualizar = (status, extra = {}) => db.conexao.prepare(
    'UPDATE nfse_notas SET status = ?, chave = ?, numero_nfse = ?, mensagem = ?, xml_nfse = ? WHERE id = ?'
  ).run(status, extra.chave || null, extra.numero || null, extra.mensagem || null, extra.xml || null, id);

  let r;
  try {
    r = await nfse.enviarDps(nfse.assinarDps(dps.infDps, dps.id, cert), ambiente, cert);
  } catch (e) {
    atualizar('incerta', { mensagem: 'Sem resposta da Receita: ' + e.message });
    throw db.erro('Sem resposta da Receita. NÃO envie de novo ainda: confira no portal nfse.gov.br se a nota saiu. (' + e.message + ')', 502);
  }
  if (r.nfseXml && r.chaveAcesso) {
    const numero = String(Number(r.chaveAcesso.slice(23, 36)));
    atualizar('emitida', { chave: r.chaveAcesso, numero, xml: r.nfseXml });
    return { ok: true, id, numero, chave: r.chaveAcesso, ambiente };
  }
  const erros = (r.json && r.json.erros) || [];
  const msg = erros.length ? erros.map(e => `${e.Codigo || e.codigo}: ${e.Descricao || e.descricao}${e.Complemento ? ' (' + e.Complemento + ')' : ''}`).join(' | ') : (r.bruto || 'Resposta inesperada da Receita (HTTP ' + r.status + ')');
  // Recusa clara = o número não foi gasto, a tentativa fica registrada
  atualizar(erros.length && r.status === 400 ? 'recusada' : 'incerta', { mensagem: msg });
  throw db.erro('A Receita recusou: ' + msg, 422);
}

function xmlDaNota(id) {
  const n = db.conexao.prepare('SELECT numero_nfse, xml_nfse FROM nfse_notas WHERE id = ? AND status = ?').get(id, 'emitida');
  if (!n) throw db.erro('Nota não encontrada.', 404);
  return { arquivo: `NFSe-${n.numero_nfse}.xml`, conteudo: n.xml_nfse };
}

module.exports = { listar, previa, emitir, xmlDaNota, proximoNumero };
