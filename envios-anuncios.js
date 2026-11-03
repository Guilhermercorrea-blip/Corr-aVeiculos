'use strict';
// O código do celular permite apenas enviar imagens a um anúncio específico.
// A lista de arquivos e seus endereços ficam restritos à sessão da equipe.
const crypto = require('node:crypto');
const publicacoes = require('./publicacoes');
const { erro } = require('./db');

function criarGerenciador({ agora = Date.now } = {}) {
  const envios = new Map(), validade = 3600e3;
  function obter(codigo) {
    const envio = envios.get(String(codigo));
    if (!envio || agora() >= envio.expira) {
      envios.delete(String(codigo));
      throw erro('Este QR Code venceu ou foi encerrado. Gere outro no computador.', 404);
    }
    return envio;
  }
  function resumo(e) {
    const p = publicacoes.obter(e.publicacao);
    return { titulo: p.titulo, expira_em: new Date(e.expira).toISOString(), recebidas: e.fotos.length, limite: 40 };
  }
  function criar(id) {
    const p = publicacoes.obter(id);
    for (const [codigo, e] of envios) if (agora() >= e.expira || e.publicacao === p.id) envios.delete(codigo);
    if (envios.size >= 200) throw erro('Há muitos envios abertos. Conclua um envio e tente novamente.', 429);
    const codigo = crypto.randomBytes(32).toString('base64url');
    const envio = { publicacao: p.id, expira: agora() + validade, fotos: [], chaves: new Map() };
    envios.set(codigo, envio);
    return { codigo, ...resumo(envio) };
  }
  function publico(codigo) { return resumo(obter(codigo)); }
  function acompanhar(id, codigo) {
    const e = obter(codigo);
    if (e.publicacao !== Number(id)) throw erro('Envio não encontrado para este anúncio', 404);
    return { ...resumo(e), fotos: e.fotos };
  }
  function encerrar(id, codigo) {
    const r = acompanhar(id, codigo);
    envios.delete(String(codigo));
    return r;
  }
  function enviar(codigo, dados) {
    const e = obter(codigo);
    if (typeof dados.chave !== 'string' || !/^[a-f\d-]{36}$/i.test(dados.chave)) throw erro('Identificação da foto inválida');
    if (e.chaves.has(dados.chave)) return { ok: true, ...resumo(e) };
    if (e.fotos.length >= 40) throw erro('Este envio já recebeu 40 fotos. Conclua no computador.', 409);
    const foto = publicacoes.adicionarFoto(e.publicacao, dados);
    e.fotos.push(foto); e.chaves.set(dados.chave, foto.id);
    return { ok: true, ...resumo(e) };
  }
  return { criar, publico, acompanhar, encerrar, enviar };
}
module.exports = { ...criarGerenciador(), criarGerenciador };
