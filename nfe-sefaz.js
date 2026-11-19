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

function chamar(ambiente, nomeServico, corpoXml, cert) {
  const amb = AMBIENTES[ambiente];
  const servico = SERVICOS[nomeServico];
  if (!amb || !servico) throw new Error('Ambiente ou serviço inválido');
  const corpo = envelope(servico, corpoXml);
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: amb.host, path: servico.caminho, method: 'POST', key: cert.chavePem, cert: cert.cadeiaPem, ca: CONFIANCA, timeout: 60000,
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
    eventos, bruto: tag(r.xml, 'cStat') ? undefined : r.xml.slice(0, 500),
  };
}

module.exports = { AMBIENTES, SERVICOS, envelope, chamar, tag, statusServico, assinarNfe, autorizar, consultarChave };
