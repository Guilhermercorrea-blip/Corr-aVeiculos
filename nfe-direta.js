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
const TIPOS_DIRETOS = ['entrada_consignacao', 'devolucao_consignacao', 'entrada_compra', 'devolucao_compra'];

function ambienteAtual() { return process.env.NFE_AMBIENTE === 'producao' ? 'producao' : 'homologacao'; }

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
    ambiente: ambienteAtual(),
    jaAutorizada: autorizadaEmProducao(veiculoId, tipo),
    envios: envios(veiculoId, tipo),
  };
}

async function emitir(veiculoId, tipo, dados = {}) {
  if (!TIPOS_DIRETOS.includes(tipo)) throw db.erro('Essa nota ainda não sai direto pela SEFAZ. Use o arquivo do Emissor do Sebrae.', 400);
  const caminho = nfseServico.caminhoCertificado();
  if (!caminho) throw db.erro('O certificado digital não está neste computador.', 400);
  if (dados.confirmar !== true) throw db.erro('Confirme a emissão na tela antes de enviar.', 400);
  const ambiente = ambienteAtual();
  const homologacao = ambiente === 'homologacao';
  if (!homologacao && dados.confirmarProducao !== true) throw db.erro('Esta nota vale de verdade. Marque a confirmação de nota real.', 400);
  const ja = !homologacao && autorizadaEmProducao(veiculoId, tipo);
  if (ja) throw db.erro(`Esta nota já foi autorizada (nº ${ja.numero}, protocolo ${ja.protocolo}). Não emita de novo.`, 409);
  const cert = nfse.carregarCertificado(caminho, String(dados.senha || ''));

  // Em homologação usa um número alto e único, para não esbarrar em testes anteriores nem gastar a numeração real
  const numero = homologacao ? 800000000 + (Math.floor(Date.now() / 1000) % 100000000) : Number(dados.numero);
  const g = await nfe.gerarNota(veiculoId, tipo, { numero, ncm: dados.ncm, valor: dados.valor, data: dados.data, referencia: dados.referencia, origemXml: dados.origemXml, homologacao, xml: true });
  const id = Number(db.conexao.prepare("INSERT INTO nfe_envios (veiculo_id, tipo, ambiente, numero, chave, situacao) VALUES (?, ?, ?, ?, ?, 'enviando')")
    .run(Number(veiculoId), tipo, ambiente, numero, g.chave).lastInsertRowid);
  const atualizar = (situacao, extra = {}) => db.conexao.prepare('UPDATE nfe_envios SET situacao = ?, cstat = ?, motivo = ?, protocolo = ?, xml = ? WHERE id = ?')
    .run(situacao, extra.cStat || null, extra.motivo || null, extra.protocolo || null, extra.xml || null, id);

  let r;
  try {
    r = await sefaz.autorizar(ambiente, sefaz.assinarNfe(g.xml, g.chave, cert), cert);
  } catch (e) {
    atualizar('incerta', { motivo: 'Sem resposta da SEFAZ: ' + e.message });
    throw db.erro('Sem resposta da SEFAZ. NÃO emita de novo ainda: me peça para consultar a chave ' + g.chave + '. (' + e.message + ')', 502);
  }
  if (r.cStat === '100') {
    atualizar('autorizada', { cStat: r.cStat, motivo: r.xMotivo, protocolo: r.nProt, xml: r.nfeProc });
    return { ok: true, id, ambiente, numero, chave: g.chave, protocolo: r.nProt };
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

module.exports = { TIPOS_DIRETOS, estado, emitir, xmlDoEnvio, ambienteAtual };
