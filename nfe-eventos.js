'use strict';
// Eventos da NF-e emitida pela loja, na SEFAZ-SP: cancelamento (110111) e carta de correção (110110).
// Vale para as notas do site e para as do Emissor que têm o XML autorizado anexado no carro.
// Regras da SEFAZ: cancelamento só até 24 h depois da autorização; carta de correção não muda valor, imposto,
// remetente/destinatário nem datas, até 20 por nota, e a última substitui as anteriores.
const db = require('./db');
const nfse = require('./nfse');
const sefaz = require('./nfe-sefaz');
const { lerNota } = require('./danfe');

const NS = 'http://www.portalfiscal.inf.br/nfe';
const CNPJ_LOJA = '07793106000139';
// Texto fixo exigido pela SEFAZ na carta de correção (sem acentos, exatamente assim)
const COND_USO = 'A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.';

db.conexao.exec(`
CREATE TABLE IF NOT EXISTS nfe_eventos (
  id INTEGER PRIMARY KEY,
  nota_id INTEGER NOT NULL,
  chave TEXT NOT NULL,
  tipo TEXT NOT NULL,            -- 'cancelamento' | 'cce'
  seq INTEGER NOT NULL,
  texto TEXT NOT NULL,
  situacao TEXT NOT NULL,        -- 'registrado' | 'rejeitado' | 'incerto'
  cstat TEXT,
  motivo TEXT,
  protocolo TEXT,
  xml TEXT,                      -- procEventoNFe (evento assinado + retorno da SEFAZ)
  criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_nfe_eventos_nota ON nfe_eventos(nota_id);
`);
if (!db.conexao.prepare('PRAGMA table_info(nfe_notas)').all().some(c => c.name === 'cancelada_em')) db.conexao.exec('ALTER TABLE nfe_notas ADD COLUMN cancelada_em TEXT');

// Remove acentos e caracteres que o leiaute não aceita; junta espaços
const textoSefaz = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function nota(id) {
  const n = db.conexao.prepare('SELECT * FROM nfe_notas WHERE id = ?').get(Number(id));
  if (!n || !n.xml_autorizado) throw db.erro('Essa nota não tem o XML autorizado no sistema.', 404);
  const l = lerNota(n.xml_autorizado);
  if (l.cStat !== '100' || !l.protocolo) throw db.erro('Essa nota não está autorizada.', 409);
  return { n, l, ambiente: l.homologacao ? 'homologacao' : 'producao' };
}

// Prazo do cancelamento: 24 h depois da autorização (a SEFAZ confere de novo)
function prazoCancelamento(l) {
  const t = Date.parse(l.dhRecbto || '');
  return Number.isFinite(t) ? new Date(t + 24 * 3600 * 1000) : null;
}

function eventosDaNota(notaId) {
  return db.conexao.prepare("SELECT id, tipo, seq, texto, situacao, protocolo, criado_em FROM nfe_eventos WHERE nota_id = ? AND situacao = 'registrado' ORDER BY id").all(Number(notaId));
}

// Resumo para a tela: pode cancelar até quando, cartas já registradas
function situacao(notaId) {
  const { n, l } = nota(notaId);
  const ate = prazoCancelamento(l);
  return {
    cancelada: !!n.cancelada_em, canceladaEm: n.cancelada_em || null,
    cancelarAte: ate ? ate.toISOString() : null,
    podeCancelar: !n.cancelada_em && !!ate && Date.now() < ate.getTime(),
    eventos: eventosDaNota(notaId),
  };
}

function dhEvento(agora = new Date()) {
  return new Date(agora.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 19) + '-03:00';
}

function montarEvento({ tipo, chave, seq, ambiente, protocolo, texto, agora }) {
  const tp = tipo === 'cancelamento' ? '110111' : '110110';
  const id = `ID${tp}${chave}${String(seq).padStart(2, '0')}`;
  const det = tipo === 'cancelamento'
    ? `<detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>${protocolo}</nProt><xJust>${esc(texto)}</xJust></detEvento>`
    : `<detEvento versao="1.00"><descEvento>Carta de Correcao</descEvento><xCorrecao>${esc(texto)}</xCorrecao><xCondUso>${COND_USO}</xCondUso></detEvento>`;
  const inf = `<infEvento Id="${id}"><cOrgao>35</cOrgao><tpAmb>${ambiente === 'producao' ? 1 : 2}</tpAmb><CNPJ>${CNPJ_LOJA}</CNPJ><chNFe>${chave}</chNFe>` +
    `<dhEvento>${dhEvento(agora)}</dhEvento><tpEvento>${tp}</tpEvento><nSeqEvento>${seq}</nSeqEvento><verEvento>1.00</verEvento>${det}</infEvento>`;
  return { id, inf };
}

const emAndamento = new Set();

async function enviarEvento(notaId, tipo, dados = {}) {
  const { n, l, ambiente } = nota(notaId);
  if (n.cancelada_em) throw db.erro('Esta nota já está cancelada.', 409);
  const texto = textoSefaz(tipo === 'cancelamento' ? dados.justificativa : dados.texto);
  const max = tipo === 'cancelamento' ? 255 : 1000;
  if (texto.length < 15) throw db.erro(`Escreva pelo menos 15 letras ${tipo === 'cancelamento' ? 'no motivo do cancelamento' : 'na correção'}.`, 400);
  if (texto.length > max) throw db.erro(`O texto passa de ${max} caracteres.`, 400);
  if (tipo === 'cancelamento') {
    if (dados.confirmar !== true) throw db.erro('Confirme que quer cancelar a nota.', 400);
    const ate = prazoCancelamento(l);
    if (!ate || Date.now() >= ate.getTime()) throw db.erro('O prazo de 24 horas para cancelar já passou. Fale com o contador: a correção agora é por nota de devolução/entrada.', 409);
  }
  const caminho = require('./nfse-servico').caminhoCertificado();
  if (!caminho) throw db.erro('O certificado digital não está disponível aqui.', 400);
  const trava = String(notaId);
  if (emAndamento.has(trava)) throw db.erro('Já tem um envio desta nota em andamento. Aguarde.', 409);
  emAndamento.add(trava);
  try {
    let cert;
    try { cert = nfse.carregarCertificado(caminho, String(dados.senha || '')); }
    catch (e) { throw db.erro(e.message, 400); }
    const seq = tipo === 'cancelamento' ? 1
      : (db.conexao.prepare("SELECT MAX(seq) s FROM nfe_eventos WHERE nota_id = ? AND tipo = 'cce' AND situacao = 'registrado'").get(n.id).s || 0) + 1;
    if (tipo === 'cce' && seq > 20) throw db.erro('Esta nota já tem 20 cartas de correção (o máximo).', 409);
    const { id, inf } = montarEvento({ tipo, chave: l.chave, seq, ambiente, protocolo: l.protocolo, texto });
    const assinado = sefaz.assinarEvento(inf, id, cert);
    const evId = Number(db.conexao.prepare("INSERT INTO nfe_eventos (nota_id, chave, tipo, seq, texto, situacao, xml) VALUES (?, ?, ?, ?, ?, 'incerto', ?)")
      .run(n.id, l.chave, tipo, seq, texto, assinado).lastInsertRowid);
    const corpo = `<envEvento xmlns="${NS}" versao="1.00"><idLote>${String(Date.now()).slice(-15)}</idLote>${assinado}</envEvento>`;
    let r;
    try { r = await sefaz.chamar(ambiente, 'eventoSP', corpo, cert); }
    catch (e) {
      db.conexao.prepare("UPDATE nfe_eventos SET motivo = ? WHERE id = ?").run('Sem resposta da SEFAZ: ' + e.message, evId);
      throw db.erro('Sem resposta da SEFAZ. Antes de tentar de novo, consulte a nota (pode ter sido registrado). ' + e.message, 502);
    }
    const ret = (r.xml.match(/<retEvento[\s\S]*?<\/retEvento>/) || [])[0] || '';
    const cStat = ret ? sefaz.tag(ret, 'cStat') : sefaz.tag(r.xml, 'cStat');
    const xMotivo = ret ? sefaz.tag(ret, 'xMotivo') : sefaz.tag(r.xml, 'xMotivo');
    // 135 = registrado e vinculado à NF-e; 136 = registrado sem vínculo; 155 = cancelamento fora de prazo homologado
    if (['135', '136', '155'].includes(cStat)) {
      const nProt = sefaz.tag(ret, 'nProt');
      const proc = `<?xml version="1.0" encoding="UTF-8"?><procEventoNFe xmlns="${NS}" versao="1.00">${assinado}${ret}</procEventoNFe>`;
      db.conexao.prepare("UPDATE nfe_eventos SET situacao = 'registrado', cstat = ?, motivo = ?, protocolo = ?, xml = ? WHERE id = ?").run(cStat, xMotivo, nProt, proc, evId);
      if (tipo === 'cancelamento') db.conexao.prepare("UPDATE nfe_notas SET cancelada_em = datetime('now', 'localtime') WHERE id = ?").run(n.id);
      return { ok: true, id: evId, tipo, seq, protocolo: nProt, cStat, xMotivo };
    }
    db.conexao.prepare("UPDATE nfe_eventos SET situacao = 'rejeitado', cstat = ?, motivo = ? WHERE id = ?").run(cStat || null, xMotivo || r.xml.slice(0, 300), evId);
    throw db.erro(`A SEFAZ recusou: ${cStat || '?'}: ${xMotivo || 'resposta inesperada'}`, 422);
  } finally { emAndamento.delete(trava); }
}

const cancelar = (notaId, dados) => enviarEvento(notaId, 'cancelamento', dados);
const cartaCorrecao = (notaId, dados) => enviarEvento(notaId, 'cce', dados);

function xmlDoEvento(id) {
  const e = db.conexao.prepare("SELECT e.*, n.numero FROM nfe_eventos e JOIN nfe_notas n ON n.id = e.nota_id WHERE e.id = ? AND e.situacao = 'registrado'").get(Number(id));
  if (!e) throw db.erro('Evento não encontrado.', 404);
  return { arquivo: `NFe-${e.numero}-${e.tipo === 'cancelamento' ? 'cancelamento' : 'carta-correcao-' + e.seq}.xml`, conteudo: e.xml, evento: e };
}

// Página para imprimir a carta de correção (o navegador salva em PDF)
function paginaCce(id) {
  const { evento: e } = xmlDoEvento(id);
  if (e.tipo !== 'cce') throw db.erro('Isso não é uma carta de correção.', 404);
  const l = lerNota(db.conexao.prepare('SELECT xml_autorizado FROM nfe_notas WHERE id = ?').get(e.nota_id).xml_autorizado);
  const h = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const chave = l.chave.replace(/(\d{4})/g, '$1 ').trim();
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Carta de correção ${e.seq} - NF-e ${h(l.numero)}</title>
<style>body{font:13px Arial,sans-serif;max-width:190mm;margin:10mm auto;color:#000}h1{font-size:18px;text-align:center;margin:0 0 4px}
.c{border:1px solid #000;padding:6px 8px;margin:-1px 0 0}.r{font-size:10px;text-transform:uppercase;color:#333;display:block}
.l{display:flex}.l .c{flex:1;margin-left:-1px}.t{min-height:60mm;white-space:pre-wrap}@media print{button{display:none}}</style></head><body>
<button onclick="print()" style="float:right;padding:6px 12px">Imprimir / salvar PDF</button>
<h1>CARTA DE CORREÇÃO ELETRÔNICA</h1><p style="text-align:center;margin:0 0 10px">Documento auxiliar do evento 110110 registrado na SEFAZ-SP</p>
<div class="c"><span class="r">Emitente</span>${h(l.emit.nome)} · CNPJ ${h(l.emit.cnpj)}</div>
<div class="l"><div class="c"><span class="r">NF-e</span>Nº ${h(l.numero)} · série ${h(l.serie)}</div><div class="c"><span class="r">Destinatário</span>${h(l.dest.nome)}</div></div>
<div class="c"><span class="r">Chave de acesso</span>${chave}</div>
<div class="l"><div class="c"><span class="r">Sequência da carta</span>${e.seq}</div><div class="c"><span class="r">Registrada em</span>${h(e.criado_em)}</div><div class="c"><span class="r">Protocolo</span>${h(e.protocolo)}</div></div>
<div class="c t"><span class="r">Correção</span>${h(e.texto)}</div>
<div class="c" style="font-size:10px"><span class="r">Condições de uso</span>${h(COND_USO)}</div></body></html>`;
}

module.exports = { situacao, cancelar, cartaCorrecao, xmlDoEvento, paginaCce, eventosDaNota, montarEvento, textoSefaz, prazoCancelamento, COND_USO };
