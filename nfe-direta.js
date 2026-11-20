'use strict';
// NF-e emitida pelo sistema direto na SEFAZ-SP (sem o Emissor do Sebrae), a partir da página do carro.
// Usa os mesmos dados do arquivo do Emissor (nfe.gerarNota) e registra cada envio (autorizado, rejeitado ou incerto).
// Ambiente: HOMOLOGAÇÃO por padrão (não vale como nota); produção só com NFE_AMBIENTE=producao e confirmação de nota real.
// O certificado é o mesmo da nota de serviço; a senha chega a cada emissão e não é gravada.
const db = require('./db');
const nfe = require('./nfe');
const nfse = require('./nfse');
const sefaz = require('./nfe-sefaz');
const nfseServico = require('./nfse-servico');

// Por enquanto só as notas que o XML direto já cobre (a venda tem o grupo do veículo e continua pelo Emissor)
const TIPOS_DIRETOS = ['entrada_consignacao', 'devolucao_consignacao', 'entrada_compra', 'devolucao_compra', 'venda'];

function ambienteAtual(tipo) {
  // A nota de venda fica em homologação (teste) até a loja liberar: NFE_VENDA_AMBIENTE=producao
  if (tipo === 'venda' && process.env.NFE_VENDA_AMBIENTE !== 'producao') return 'homologacao';
  return process.env.NFE_AMBIENTE === 'producao' ? 'producao' : 'homologacao';
}

function envios(veiculoId, tipo) {
  return db.conexao.prepare('SELECT id, ambiente, numero, chave, situacao, motivo, protocolo, criado_em FROM nfe_envios WHERE veiculo_id = ? AND tipo = ? ORDER BY id DESC LIMIT 10').all(Number(veiculoId), tipo);
}

function autorizadaEmProducao(veiculoId, tipo) {
  return db.conexao.prepare("SELECT numero, protocolo FROM nfe_envios WHERE veiculo_id = ? AND tipo = ? AND ambiente = 'producao' AND situacao = 'autorizada' ORDER BY id DESC").get(Number(veiculoId), tipo) || null;
}

function estado(veiculoId, tipo) {
  return {
    suportado: TIPOS_DIRETOS.includes(tipo),
    habilitado: !!nfseServico.caminhoCertificado(),
    ambiente: ambienteAtual(tipo),
    jaAutorizada: autorizadaEmProducao(veiculoId, tipo),
    envios: envios(veiculoId, tipo),
  };
}

// Uma emissão de cada vez por carro e tipo (duplo clique não manda duas notas)
const emAndamento = new Set();

// Envio anterior que ficou sem resposta: pergunta à SEFAZ pela chave antes de deixar emitir outra
async function resolverPendente(veiculoId, tipo, ambiente, cert) {
  const p = db.conexao.prepare("SELECT id, numero, chave, xml FROM nfe_envios WHERE veiculo_id = ? AND tipo = ? AND ambiente = ? AND situacao IN ('incerta', 'enviando') ORDER BY id DESC").get(Number(veiculoId), tipo, ambiente);
  if (!p) return null;
  let c;
  try { c = await sefaz.consultarChave(ambiente, p.chave, cert); }
  catch (e) { throw db.erro(`A nota nº ${p.numero} ficou sem resposta e a SEFAZ não respondeu à consulta agora. Tente de novo em alguns minutos. (${e.message})`, 502); }
  if (c.cStatProt === '100' && c.protXml) {
    if (!p.xml || !p.xml.includes(p.chave)) throw db.erro(`A nota nº ${p.numero} FOI autorizada (protocolo ${c.protocolo}), mas o XML assinado não ficou guardado. Me chame para recuperar. Não emita de novo.`, 409);
    const nfeProc = `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${p.xml}${c.protXml}</nfeProc>`;
    db.conexao.prepare("UPDATE nfe_envios SET situacao = 'autorizada', cstat = '100', motivo = 'Autorizada (confirmada por consulta)', protocolo = ?, xml = ? WHERE id = ?").run(c.protocolo, nfeProc, p.id);
    if (ambiente === 'producao') db.conexao.prepare('UPDATE nfe_notas SET xml_autorizado = ?, protocolo = ? WHERE chave = ?').run(nfeProc, c.protocolo, p.chave);
    if (ambiente === 'producao' && tipo === 'devolucao_consignacao') db.conexao.prepare("UPDATE veiculos SET status = 'devolvido' WHERE id = ? AND status = 'estoque'").run(Number(veiculoId));
    return { ok: true, id: p.id, ambiente, numero: p.numero, chave: p.chave, protocolo: c.protocolo, recuperada: true };
  }
  if (c.cStat === '217') { // a SEFAZ não recebeu: o envio não vale e pode emitir de novo
    db.conexao.prepare("UPDATE nfe_envios SET situacao = 'rejeitada', motivo = 'Não chegou à SEFAZ (consulta: 217)' WHERE id = ?").run(p.id);
    return null;
  }
  throw db.erro(`A nota nº ${p.numero} ainda está sem resposta (consulta: ${c.cStat || '?'} ${c.xMotivo || ''}). Não emita de novo; tente daqui a alguns minutos.`, 409);
}

async function emitir(veiculoId, tipo, dados = {}) {
  const trava = `${veiculoId}:${tipo}`;
  if (emAndamento.has(trava)) throw db.erro('Esta nota já está sendo enviada. Aguarde a resposta.', 409);
  emAndamento.add(trava);
  try { return await emitirUmaVez(veiculoId, tipo, dados); } finally { emAndamento.delete(trava); }
}

async function emitirUmaVez(veiculoId, tipo, dados) {
  if (!TIPOS_DIRETOS.includes(tipo)) throw db.erro('Essa nota ainda não sai direto pela SEFAZ. Use o arquivo do Emissor do Sebrae.', 400);
  const caminho = nfseServico.caminhoCertificado();
  if (!caminho) throw db.erro('O certificado digital não está neste computador.', 400);
  if (dados.confirmar !== true) throw db.erro('Confirme a emissão na tela antes de enviar.', 400);
  const ambiente = ambienteAtual(tipo);
  const homologacao = ambiente === 'homologacao';
  if (!homologacao && dados.confirmarProducao !== true) throw db.erro('Esta nota vale de verdade. Marque a confirmação de nota real.', 400);
  const ja = !homologacao && autorizadaEmProducao(veiculoId, tipo);
  if (ja) throw db.erro(`Esta nota já foi autorizada (nº ${ja.numero}, protocolo ${ja.protocolo}). Não emita de novo.`, 409);
  const cert = nfse.carregarCertificado(caminho, String(dados.senha || ''));
  const recuperada = await resolverPendente(veiculoId, tipo, ambiente, cert);
  if (recuperada) return recuperada;
  if (!homologacao && autorizadaEmProducao(veiculoId, tipo)) throw db.erro('Esta nota já foi autorizada. Não emita de novo.', 409);

  // Em homologação usa um número alto e único, para não esbarrar em testes anteriores nem gastar a numeração real
  const numero = homologacao ? 800000000 + (Math.floor(Date.now() / 1000) % 100000000) : Number(dados.numero);
  const g = await nfe.gerarNota(veiculoId, tipo, { numero, ncm: dados.ncm, valor: dados.valor, data: dados.data, referencia: dados.referencia, pagamento: dados.pagamento, origemXml: dados.origemXml, ficha: dados.ficha, homologacao, xml: true });
  // O XML assinado fica guardado ANTES do envio: se a resposta se perder, dá para recuperar a nota pela consulta da chave
  const assinado = sefaz.assinarNfe(g.xml, g.chave, cert);
  const id = Number(db.conexao.prepare("INSERT INTO nfe_envios (veiculo_id, tipo, ambiente, numero, chave, situacao, xml) VALUES (?, ?, ?, ?, ?, 'enviando', ?)")
    .run(Number(veiculoId), tipo, ambiente, numero, g.chave, assinado).lastInsertRowid);
  const atualizar = (situacao, extra = {}) => db.conexao.prepare('UPDATE nfe_envios SET situacao = ?, cstat = ?, motivo = ?, protocolo = ?, xml = ? WHERE id = ?')
    .run(situacao, extra.cStat || null, extra.motivo || null, extra.protocolo || null, extra.xml || null, id);

  let r;
  try {
    r = await sefaz.autorizar(ambiente, assinado, cert);
  } catch (e) {
    atualizar('incerta', { motivo: 'Sem resposta da SEFAZ: ' + e.message, xml: assinado });
    throw db.erro('Sem resposta da SEFAZ. NÃO emita de novo ainda: me peça para consultar a chave ' + g.chave + '. (' + e.message + ')', 502);
  }
  if (r.cStat === '100') {
    atualizar('autorizada', { cStat: r.cStat, motivo: r.xMotivo, protocolo: r.nProt, xml: r.nfeProc });
    // Em produção, o XML autorizado também fica guardado na nota do carro (aparece em "Notas emitidas" e na página do carro)
    if (!homologacao) db.conexao.prepare('UPDATE nfe_notas SET xml_autorizado = ?, protocolo = ? WHERE chave = ?').run(r.nfeProc, r.nProt, g.chave);
    if (!homologacao && tipo === 'devolucao_consignacao') db.conexao.prepare("UPDATE veiculos SET status = 'devolvido' WHERE id = ? AND status = 'estoque'").run(Number(veiculoId));
    return { ok: true, id, ambiente, numero, chave: g.chave, protocolo: r.nProt };
  }
  // Recusa de verdade: a nota veio com código de rejeição, ou o lote inteiro foi recusado. Qualquer outra resposta fica para conferir.
  if (!r.cStat && (!r.cStatLote || ['103', '104', '105'].includes(r.cStatLote))) {
    atualizar('incerta', { cStat: r.cStatLote, motivo: 'Resposta sem o resultado da nota: ' + (r.xMotivoLote || r.bruto || 'resposta inesperada'), xml: assinado });
    throw db.erro('A SEFAZ respondeu sem dizer se autorizou. NÃO emita de novo: na próxima tentativa o sistema consulta a chave ' + g.chave + ' antes.', 502);
  }
  const motivo = r.cStat ? `${r.cStat}: ${r.xMotivo}` : `${r.cStatLote || 'sem código'}: ${r.xMotivoLote || r.bruto || 'resposta inesperada'}`;
  atualizar('rejeitada', { cStat: r.cStat || r.cStatLote, motivo });
  throw db.erro('A SEFAZ recusou: ' + motivo, 422);
}

function xmlDoEnvio(id) {
  const e = db.conexao.prepare("SELECT numero, chave, ambiente, xml FROM nfe_envios WHERE id = ? AND situacao = 'autorizada'").get(Number(id));
  if (!e) throw db.erro('Nota não encontrada.', 404);
  return { arquivo: `NFe-${e.ambiente === 'homologacao' ? 'TESTE-' : ''}${e.numero}-${e.chave}.xml`, conteudo: e.xml };
}

// ---------- Nota feita pelo Emissor do Sebrae: anexa o XML autorizado e libera "Baixar nota" (DANFE) e "Baixar XML" ----------
function anexarXml(veiculoId, tipo, xml) {
  const nota = db.conexao.prepare('SELECT id, numero, chave FROM nfe_notas WHERE veiculo_id = ? AND tipo = ? ORDER BY id DESC').get(Number(veiculoId), tipo);
  if (!nota) throw db.erro('Gere primeiro o arquivo desta nota. O XML só se anexa a uma nota já registrada.', 404);
  const texto = String(xml || '');
  if (texto.length > 500000) throw db.erro('Arquivo grande demais para ser o XML de uma NF-e.', 400);
  let n;
  try { n = require('./danfe').lerNota(texto); } catch (e) { throw db.erro('Esse arquivo não parece o XML de uma NF-e autorizada. Use o XML da pasta Notas (termina em -procNfe.xml).', 400); }
  if (n.chave !== nota.chave) throw db.erro('Esse XML é de outra nota (chave diferente da nota nº ' + nota.numero + '). Confira o arquivo.', 409);
  if (n.cStat !== '100' || !n.protocolo) throw db.erro('Esse XML não tem a autorização da SEFAZ (protocolo). Anexe o XML depois que a nota for transmitida e autorizada.', 400);
  db.conexao.prepare('UPDATE nfe_notas SET xml_autorizado = ?, protocolo = ? WHERE id = ?').run(texto, n.protocolo, nota.id);
  return { ok: true, numero: nota.numero, protocolo: n.protocolo };
}

function xmlDaNotaRegistrada(id) {
  const n = db.conexao.prepare('SELECT numero, chave, xml_autorizado FROM nfe_notas WHERE id = ?').get(Number(id));
  if (!n || !n.xml_autorizado) throw db.erro('Essa nota ainda não tem o XML autorizado anexado.', 404);
  return { arquivo: `NFe-${n.numero}-${n.chave}.xml`, conteudo: n.xml_autorizado };
}

// ---------- Devoluções em lote ----------
// Carros devolvidos ao dono com a entrada autorizada no carro e sem devolução real autorizada (nem envio esperando resposta)
function devolucoesPendentes() {
  return db.conexao.prepare(`
    SELECT v.id, v.placa, v.marca_modelo, e.numero AS entrada, e.valor, p.nome AS dono
    FROM veiculos v
    JOIN nfe_notas e ON e.veiculo_id = v.id AND e.tipo = 'entrada_consignacao' AND e.xml_autorizado IS NOT NULL
    LEFT JOIN pessoas p ON p.id = COALESCE(v.proprietario_crv_id, v.fornecedor_id)
    WHERE v.status = 'devolvido'
      AND NOT EXISTS (SELECT 1 FROM nfe_notas d WHERE d.veiculo_id = v.id AND d.tipo = 'devolucao_consignacao' AND (d.xml_autorizado IS NOT NULL OR d.protocolo IS NOT NULL))
      AND NOT EXISTS (SELECT 1 FROM nfe_envios s WHERE s.veiculo_id = v.id AND s.tipo = 'devolucao_consignacao' AND s.ambiente = 'producao' AND s.situacao IN ('autorizada', 'incerta', 'enviando'))
    GROUP BY v.id ORDER BY e.numero`).all();
}

// Emite uma por uma, na ordem, com a mesma senha. Para na primeira que não for autorizada (o resto fica para depois).
async function emitirDevolucoes(dados = {}) {
  const ids = (Array.isArray(dados.ids) ? dados.ids : []).map(Number).filter(n => Number.isSafeInteger(n) && n > 0);
  if (!ids.length) throw db.erro('Escolha as devoluções que vão sair.', 400);
  if (dados.confirmar !== true) throw db.erro('Confirme a emissão na tela antes de enviar.', 400);
  const pendentes = new Map(devolucoesPendentes().map(p => [p.id, p]));
  const resultados = [];
  for (const id of ids) {
    const p = pendentes.get(id);
    if (!p) { resultados.push({ id, ok: false, erro: 'Já tem devolução ou não está como devolvido.' }); continue; }
    const s = nfe.sugestao(id, 'devolucao_consignacao');
    try {
      const r = await emitir(id, 'devolucao_consignacao', {
        numero: s.numero, ncm: s.ncm, valor: s.valor, referencia: s.referencia,
        senha: dados.senha, confirmar: true, confirmarProducao: dados.confirmarProducao === true,
      });
      resultados.push({ id, ok: true, placa: p.placa, numero: r.numero, protocolo: r.protocolo, ambiente: r.ambiente });
    } catch (e) {
      resultados.push({ id, ok: false, placa: p.placa, numero: s.numero, erro: e.message });
      break; // não segue depois de uma recusa ou falta de resposta
    }
  }
  return { resultados, emitidas: resultados.filter(r => r.ok).length, ambiente: ambienteAtual('devolucao_consignacao') };
}

module.exports = { TIPOS_DIRETOS, estado, emitir, devolucoesPendentes, emitirDevolucoes, xmlDoEnvio, ambienteAtual, anexarXml, xmlDaNotaRegistrada };
