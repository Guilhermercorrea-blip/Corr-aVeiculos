'use strict';
// Conversa direta com a SEFAZ-SP (NF-e modelo 55, layout 4.00), sem o Emissor do Sebrae.
// Usa o mesmo certificado A1 da nota de serviço (carregado por nfse.carregarCertificado; a senha nunca é gravada).
// Começa pelo ambiente de HOMOLOGAÇÃO (tpAmb 2): nada emitido lá tem valor fiscal.
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const tls = require('node:tls');

// A SEFAZ-SP usa certificado de servidor da cadeia ICP-Brasil, que o Node não conhece.
// Raiz oficial do ITI (Autoridade Certificadora Raiz Brasileira v10, SHA-256 6E:0B:FF:06:9A:26:99:4C...),
// conferida com a cópia do Windows em 19/11/2026. Mantém a verificação ligada (nunca desligar).
const CONFIANCA = [...tls.rootCertificates, fs.readFileSync(path.join(__dirname, 'certificados', 'icp-brasil-raiz-v10.crt'), 'utf8')];

const NS_NFE = 'http://www.portalfiscal.inf.br/nfe';
const UF_SP = '35';

const SERVICOS = {
  status: { caminho: '/ws/nfestatusservico4.asmx', wsdl: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4', operacao: 'nfeStatusServicoNF' },
  autorizacao: { caminho: '/ws/nfeautorizacao4.asmx', wsdl: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4', operacao: 'nfeAutorizacaoLote' },
  consulta: { caminho: '/ws/nfeconsultaprotocolo4.asmx', wsdl: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4', operacao: 'nfeConsultaNF' },
  cadastro: { caminho: '/ws/cadconsultacadastro4.asmx', wsdl: 'http://www.portalfiscal.inf.br/nfe/wsdl/CadConsultaCadastro4', operacao: 'consultaCadastro' },
  evento: { host: 'www.nfe.fazenda.gov.br', caminho: '/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx', wsdl: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4', operacao: 'nfeRecepcaoEvento' },
  distribuicao: { host: 'www1.nfe.fazenda.gov.br', caminho: '/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx', wsdl: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe', operacao: 'nfeDistDFeInteresse' },
  retorno: { caminho: '/ws/nferetautorizacao4.asmx', wsdl: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRetAutorizacao4', operacao: 'nfeRetAutorizacaoLote' },
};
const AMBIENTES = {
  homologacao: { tpAmb: '2', host: 'homologacao.nfe.fazenda.sp.gov.br' },
  producao: { tpAmb: '1', host: 'nfe.fazenda.sp.gov.br' },
};

function envelope(servico, corpoXml) {
  return '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    `<soap12:Body><nfeDadosMsg xmlns="${servico.wsdl}">${corpoXml}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;
}

// Igual ao chamar(), mas o corpo já vem completo (a distribuição de DF-e usa outro formato de envelope) e sempre em produção
function chamarCru(nomeServico, corpoCompleto, cert) {
  const servico = SERVICOS[nomeServico];
  const corpo = '<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>' + corpoCompleto + '</soap12:Body></soap12:Envelope>';
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: servico.host || AMBIENTES.producao.host, path: servico.caminho, method: 'POST', key: cert.chavePem, cert: cert.cadeiaPem, ca: CONFIANCA, timeout: 60000,
      headers: { 'Content-Type': 'application/soap+xml; charset=utf-8; action="' + servico.wsdl + '/' + servico.operacao + '"', 'Content-Length': Buffer.byteLength(corpo) },
    }, res => {
      const partes = [];
      res.on('data', d => partes.push(d));
      res.on('end', () => resolve({ status: res.statusCode, xml: Buffer.concat(partes).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado falando com a Receita')));
    req.on('error', reject);
    req.end(corpo);
  });
}

function chamar(ambiente, nomeServico, corpoXml, cert) {
  const amb = AMBIENTES[ambiente];
  const servico = SERVICOS[nomeServico];
  if (!amb || !servico) throw new Error('Ambiente ou serviço inválido');
  const corpo = envelope(servico, corpoXml);
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: (ambiente === 'producao' && servico.host) || amb.host, path: servico.caminho, method: 'POST', key: cert.chavePem, cert: cert.cadeiaPem, ca: CONFIANCA, timeout: 60000,
      headers: {
        'Content-Type': `application/soap+xml; charset=utf-8; action="${servico.wsdl}/${servico.operacao}"`,
        'Content-Length': Buffer.byteLength(corpo),
      },
    }, res => {
      const partes = [];
      res.on('data', d => partes.push(d));
      res.on('end', () => resolve({ status: res.statusCode, xml: Buffer.concat(partes).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado falando com a SEFAZ')));
    req.on('error', reject);
    req.end(corpo);
  });
}

// Lê o primeiro valor de uma tag (as respostas da SEFAZ são pequenas e de formato fixo)
const tag = (xml, nome) => (String(xml).match(new RegExp(`<(?:\\w+:)?${nome}>([^<]*)</(?:\\w+:)?${nome}>`)) || [])[1];

// "O serviço está no ar?" Não emite nada. Resposta esperada: cStat 107 (Serviço em Operação)
async function statusServico(ambiente, cert) {
  const amb = AMBIENTES[ambiente];
  const xml = `<consStatServ versao="4.00" xmlns="${NS_NFE}"><tpAmb>${amb.tpAmb}</tpAmb><cUF>${UF_SP}</cUF><xServ>STATUS</xServ></consStatServ>`;
  const r = await chamar(ambiente, 'status', xml, cert);
  return { http: r.status, cStat: tag(r.xml, 'cStat'), xMotivo: tag(r.xml, 'xMotivo'), dhRecbto: tag(r.xml, 'dhRecbto'), tMed: tag(r.xml, 'tMed'), bruto: tag(r.xml, 'cStat') ? undefined : r.xml.slice(0, 600) };
}


// Assinatura da NF-e (padrão da SEFAZ): RSA-SHA1, digest SHA1, C14N; a assinatura vai dentro de <NFe>, depois do <infNFe>
const NS_DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
function assinarNfe(infNFe, chave, cert) {
  const crypto = require('node:crypto');
  const canonInf = infNFe.replace('<infNFe ', `<infNFe xmlns="${NS_NFE}" `);
  const digest = crypto.createHash('sha1').update(canonInf, 'utf8').digest('base64');
  const signedInfo =
    `<SignedInfo><CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod>` +
    `<Reference URI="#NFe${chave}"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform>` +
    `<Transform Algorithm="${C14N}"></Transform></Transforms>` +
    `<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
  const valor = crypto.createSign('RSA-SHA1').update(signedInfo.replace('<SignedInfo>', `<SignedInfo xmlns="${NS_DSIG}">`), 'utf8').sign(cert.chavePem, 'base64');
  const x509 = cert.certPem.replace(/-----[A-Z ]+-----|\s/g, '');
  return `<NFe xmlns="${NS_NFE}">${infNFe}<Signature xmlns="${NS_DSIG}">${signedInfo}<SignatureValue>${valor}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${x509}</X509Certificate></X509Data></KeyInfo></Signature></NFe>`;
}

// Envia uma NF-e assinada (lote de 1, modo síncrono). cStat 100 = autorizada. Devolve o XML final (nfeProc) quando autoriza.
async function autorizar(ambiente, nfeAssinada, cert) {
  const lote = String(Date.now()).slice(-15);
  const corpo = `<enviNFe xmlns="${NS_NFE}" versao="4.00"><idLote>${lote}</idLote><indSinc>1</indSinc>${nfeAssinada}</enviNFe>`;
  const r = await chamar(ambiente, 'autorizacao', corpo, cert);
  const prot = (r.xml.match(/<protNFe[\s\S]*?<\/protNFe>/) || [])[0] || null;
  const res = {
    http: r.status, lote,
    cStatLote: tag(r.xml, 'cStat'), xMotivoLote: tag(r.xml, 'xMotivo'),
    cStat: prot ? tag(prot, 'cStat') : null, xMotivo: prot ? tag(prot, 'xMotivo') : null,
    nProt: prot ? tag(prot, 'nProt') : null, chNFe: prot ? tag(prot, 'chNFe') : null,
    bruto: prot || tag(r.xml, 'cStat') ? undefined : r.xml.slice(0, 800),
  };
  if (res.cStat === '100') res.nfeProc = `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="${NS_NFE}" versao="4.00">${nfeAssinada}${prot}</nfeProc>`;
  return res;
}


// Consulta a situação de uma NF-e pela chave (só leitura, não altera nada). 100 = autorizada; 101/135 = cancelada
async function consultarChave(ambiente, chave, cert) {
  const amb = AMBIENTES[ambiente];
  const xml = `<consSitNFe versao="4.00" xmlns="${NS_NFE}"><tpAmb>${amb.tpAmb}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${chave}</chNFe></consSitNFe>`;
  const r = await chamar(ambiente, 'consulta', xml, cert);
  const prot = (r.xml.match(/<protNFe[\s\S]*?<\/protNFe>/) || [])[0] || '';
  const eventos = (r.xml.match(/<procEventoNFe[\s\S]*?<\/procEventoNFe>/g) || []).map(ev => ({ tpEvento: tag(ev, 'tpEvento'), descEvento: tag(ev, 'descEvento'), cStat: tag(ev.match(/<retEvento[\s\S]*$/)?.[0] || '', 'cStat'), dh: tag(ev, 'dhRegEvento') }));
  return {
    http: r.status, cStat: tag(r.xml, 'cStat'), xMotivo: tag(r.xml, 'xMotivo'),
    protocolo: prot ? tag(prot, 'nProt') : null, autorizadaEm: prot ? tag(prot, 'dhRecbto') : null, cStatProt: prot ? tag(prot, 'cStat') : null,
    eventos, bruto: tag(r.xml, 'cStat') ? undefined : r.xml.slice(0, 500), protXml: prot || null,
  };
}

// ---------- Consulta cadastral (SEFAZ-SP, produção): IE, razão social e endereço de uma empresa pelo CNPJ ----------
async function consultarCadastro(cnpj, cert) {
  const corpo = `<ConsCad xmlns="${NS_NFE}" versao="2.00"><infCons><xServ>CONS-CAD</xServ><UF>SP</UF><CNPJ>${String(cnpj).replace(/\D/g, '')}</CNPJ></infCons></ConsCad>`;
  const r = await chamar('producao', 'cadastro', corpo, cert);
  const inf = (r.xml.match(/<infCad>[\s\S]*?<\/infCad>/) || [])[0] || '';
  const ender = (inf.match(/<ender>[\s\S]*?<\/ender>/) || [])[0] || '';
  return {
    http: r.status, cStat: tag(r.xml, 'cStat'), xMotivo: tag(r.xml, 'xMotivo'),
    ie: tag(inf, 'IE'), cnpj: tag(inf, 'CNPJ'), nome: tag(inf, 'xNome'), fantasia: tag(inf, 'xFant'), situacao: tag(inf, 'cSit'), regime: tag(inf, 'xRegApur'),
    endereco: { xLgr: tag(ender, 'xLgr'), nro: tag(ender, 'nro'), xBairro: tag(ender, 'xBairro'), cMun: tag(ender, 'cMun'), xMun: tag(ender, 'xMun'), cep: tag(ender, 'CEP') },
    bruto: tag(r.xml, 'cStat') ? undefined : r.xml.slice(0, 500),
  };
}

// ---------- Distribuição de DF-e (Ambiente Nacional): NF-e emitidas CONTRA o CNPJ da loja (só leitura) ----------
// Pagina pelo NSU. Cada documento vem compactado (docZip: base64 de gzip). Evite repetir a consulta: a Receita limita (656 = aguarde 1 hora).
function lerDocZip(doc) {
  const zlib = require('node:zlib');
  const xml = zlib.gunzipSync(Buffer.from(doc.conteudo, 'base64')).toString('utf8');
  return {
    nsu: doc.nsu, schema: doc.schema,
    chave: tag(xml, 'chNFe') || (xml.match(/Id="NFe(\d{44})"/) || [])[1] || '',
    emitCnpj: tag(xml, 'CNPJ'), emitNome: tag(xml, 'xNome'), dhEmi: tag(xml, 'dhEmi'), vNF: tag(xml, 'vNF'), tpNF: tag(xml, 'tpNF'), cStat: tag(xml, 'cSitNFe') || tag(xml, 'cStat'),
    cfop: tag(xml, 'CFOP'),
  };
}

async function distribuicaoDFe(cnpjLoja, cert, { ultNSU = '0', maxPaginas = 6 } = {}) {
  const docs = [];
  let atual = String(ultNSU).padStart(15, '0'), ultima = null;
  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const corpo = `<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg><distDFeInt xmlns="${NS_NFE}" versao="1.01"><tpAmb>1</tpAmb><cUFAutor>35</cUFAutor><CNPJ>${cnpjLoja}</CNPJ><distNSU><ultNSU>${atual}</ultNSU></distNSU></distDFeInt></nfeDadosMsg></nfeDistDFeInteresse>`;
    const r = await chamarCru('distribuicao', corpo, cert);
    const cStat = tag(r.xml, 'cStat');
    ultima = { cStat, xMotivo: tag(r.xml, 'xMotivo'), ultNSU: tag(r.xml, 'ultNSU'), maxNSU: tag(r.xml, 'maxNSU') };
    for (const m of r.xml.matchAll(/<docZip NSU="(\d+)" schema="([^"]+)">([^<]+)<\/docZip>/g)) {
      try { docs.push(lerDocZip({ nsu: m[1], schema: m[2], conteudo: m[3] })); } catch { /* documento que não é NF-e */ }
    }
    if (cStat !== '138' || !ultima.ultNSU || ultima.ultNSU === ultima.maxNSU) break;
    atual = ultima.ultNSU;
  }
  return { docs, ...ultima };
}

// ---------- Manifestação do Destinatário: Ciência da Operação (evento 210210) e download do XML da NF-e recebida ----------
// A Receita só entrega o XML completo de uma NF-e destinada depois que o destinatário registra a ciência. O evento não tem
// efeito fiscal (não é confirmação nem recusa), mas fica registrado na nota. Assinatura igual à da NF-e (RSA-SHA1, C14N).
function assinarEvento(infEvento, id, cert) {
  const crypto = require('node:crypto');
  const canonInf = infEvento.replace('<infEvento ', `<infEvento xmlns="${NS_NFE}" `);
  const digest = crypto.createHash('sha1').update(canonInf, 'utf8').digest('base64');
  const signedInfo =
    `<SignedInfo><CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod>` +
    `<Reference URI="#${id}"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform>` +
    `<Transform Algorithm="${C14N}"></Transform></Transforms>` +
    `<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
  const valor = crypto.createSign('RSA-SHA1').update(signedInfo.replace('<SignedInfo>', `<SignedInfo xmlns="${NS_DSIG}">`), 'utf8').sign(cert.chavePem, 'base64');
  const x509 = cert.certPem.replace(/-----[A-Z ]+-----|\s/g, '');
  return `<evento xmlns="${NS_NFE}" versao="1.00">${infEvento}<Signature xmlns="${NS_DSIG}">${signedInfo}<SignatureValue>${valor}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${x509}</X509Certificate></X509Data></KeyInfo></Signature></evento>`;
}

function montarCiencia(chave, cnpjLoja, agora = new Date()) {
  const dh = new Date(agora.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 19) + '-03:00';
  const id = `ID210210${chave}01`;
  const inf = `<infEvento Id="${id}"><cOrgao>91</cOrgao><tpAmb>1</tpAmb><CNPJ>${cnpjLoja}</CNPJ><chNFe>${chave}</chNFe><dhEvento>${dh}</dhEvento>` +
    '<tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento></infEvento>';
  return { id, inf };
}

async function registrarCiencia(chave, cnpjLoja, cert) {
  if (!/^\d{44}$/.test(chave)) throw new Error('Chave inválida');
  const { id, inf } = montarCiencia(chave, cnpjLoja);
  const corpo = `<envEvento xmlns="${NS_NFE}" versao="1.00"><idLote>${String(Date.now()).slice(-15)}</idLote>${assinarEvento(inf, id, cert)}</envEvento>`;
  const r = await chamar('producao', 'evento', corpo, cert);
  const ret = (r.xml.match(/<retEvento[\s\S]*?<\/retEvento>/) || [])[0] || '';
  return {
    http: r.status, cStatLote: tag(r.xml, 'cStat'), xMotivoLote: tag(r.xml, 'xMotivo'),
    cStat: ret ? tag(ret, 'cStat') : null, xMotivo: ret ? tag(ret, 'xMotivo') : null, nProt: ret ? tag(ret, 'nProt') : null,
    // 135 = evento registrado; 573 = já havia sido registrado (tudo bem)
    ok: ['135', '136', '573'].includes(ret ? tag(ret, 'cStat') : ''),
    bruto: ret || tag(r.xml, 'cStat') ? undefined : r.xml.slice(0, 500),
  };
}

// Pede o XML completo de uma NF-e destinada à loja (só funciona depois da ciência). Devolve o nfeProc com o protocolo
async function baixarNFe(chave, cnpjLoja, cert) {
  const corpo = `<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg><distDFeInt xmlns="${NS_NFE}" versao="1.01"><tpAmb>1</tpAmb><cUFAutor>35</cUFAutor><CNPJ>${cnpjLoja}</CNPJ><consChNFe><chNFe>${chave}</chNFe></consChNFe></distDFeInt></nfeDadosMsg></nfeDistDFeInteresse>`;
  const r = await chamarCru('distribuicao', corpo, cert);
  const zlib = require('node:zlib');
  let completo = null, resumo = null;
  for (const m of r.xml.matchAll(/<docZip NSU="(\d+)" schema="([^"]+)">([^<]+)<\/docZip>/g)) {
    const xml = zlib.gunzipSync(Buffer.from(m[3], 'base64')).toString('utf8');
    if (/^procNFe/.test(m[2]) || xml.includes('<nfeProc')) completo = xml; else resumo = xml;
  }
  return { http: r.status, cStat: tag(r.xml, 'cStat'), xMotivo: tag(r.xml, 'xMotivo'), xml: completo, soResumo: !completo && !!resumo };
}

module.exports = { AMBIENTES, SERVICOS, envelope, chamar, chamarCru, tag, statusServico, assinarNfe, autorizar, consultarChave, consultarCadastro, distribuicaoDFe, lerDocZip, assinarEvento, montarCiencia, registrarCiencia, baixarNFe };
