'use strict';
// NFS-e Nacional (comissões de banco): monta o DPS (layout 1.01), assina com o certificado A1 da loja
// e envia à API Sefin Nacional (POST /nfse). Sem bibliotecas: o XML é sempre do mesmo formato, então a
// forma canônica (C14N) é escrita direto, sem parser. O certificado (.pfx) e a senha NUNCA são gravados:
// a senha chega por chamada, vira variável de ambiente só do processo do openssl e é descartada.
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const PRESTADOR = { cnpj: '07793106000139', cMun: '3505302', nome: 'CORREA COMERCIO DE VEICULOS LTDA' };
const NS = 'http://www.sped.fazenda.gov.br/nfse';
const NS_DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const VER_APLIC = 'CorreaSite_1.0';
const ALIQUOTA_ISS = 3; // %

// Bancos que pagam comissão à loja. Código de tributação nacional e NBS conforme as notas já emitidas.
const TOMADORES = {
  'santander-financiamento': { cnpj: '07707650000110', nome: 'SANTANDER SOCIEDADE DE CREDITO, FINANCIAMENTO E INVESTIMENTO S.A.', cTribNac: '100201', nbs: '109013300', tipo: 'financiamento' },
  'santander-seguros': { cnpj: '04270778000171', nome: 'SANTANDER CORRETORA DE SEGUROS, INVESTIMENTOS E SERVICOS S.A.', cTribNac: '100102', nbs: '109061100', tipo: 'seguros' },
  'itau-financiamento': { cnpj: '60872504000123', nome: 'ITAU UNIBANCO HOLDING S.A.', cTribNac: '100501', nbs: '109013300', tipo: 'financiamento' },
  'c6-financiamento': { cnpj: '31872495000172', nome: 'BANCO C6 S.A.', cTribNac: '100501', nbs: '109013300', tipo: 'financiamento' },
};

// Pessoa física como tomador (nota de teste do sistema): o CPF e o nome vêm do pedido
const TOMADOR_PF = { cTribNac: '100501', nbs: '109013300', tipo: 'pf' };
function cpfValido(cpf) {
  const d = String(cpf || '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    if (Number(d[n]) !== ((soma * 10) % 11) % 10) return false;
  }
  return true;
}
const semAcento = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 .,&-]/g, '').replace(/\s+/g, ' ').trim();

const AMBIENTES = {
  teste: { tpAmb: 2, host: 'sefin.producaorestrita.nfse.gov.br', base: '/API/SefinNacional' },
  producao: { tpAmb: 1, host: 'sefin.nfse.gov.br', base: '/SefinNacional' },
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
const dinheiro = centavos => (centavos / 100).toFixed(2);
const soDigitos = s => String(s || '').replace(/\D/g, '');

function issEmCentavos(valor) { return Math.round((valor * ALIQUOTA_ISS) / 100); }

function descricaoServico(tomador, competencia, ticket) {
  const [ano, mes] = competencia.split('-');
  const ref = `${mes}/${ano}`;
  if (tomador.tipo === 'pf') return 'AGENCIAMENTO, CORRETAGEM OU INTERMEDIACAO DE CONTRATOS DE FINANCIAMENTO DE VEICULOS - COMISSAO (TESTE DO SISTEMA)';
  if (tomador.tipo === 'seguros') {
    return `AGENCIAMENTO, CORRETAGEM OU INTERMEDIACAO DE SEGUROS - COMISSAO REF. ${ref}` + (ticket ? ` - TICKET ${ticket}` : '');
  }
  return `AGENCIAMENTO, CORRETAGEM OU INTERMEDIACAO DE CONTRATOS DE FINANCIAMENTO DE VEICULOS - COMISSAO REF. ${ref}`;
}

function dataHoraBrasilia(d) {
  // Barra Bonita fica em UTC-3 o ano todo (sem horário de verão desde 2019)
  const b = new Date(d.getTime() - 3 * 3600 * 1000);
  return b.toISOString().slice(0, 19) + '-03:00';
}

function idDps(serie, nDps) {
  return 'DPS' + PRESTADOR.cMun + '2' + PRESTADOR.cnpj + String(serie).padStart(5, '0') + String(nDps).padStart(15, '0');
}

// Valida e monta o XML do DPS (sem assinatura). `ambiente`: 'teste' | 'producao'
function montarDps(o) {
  let tomador = TOMADORES[o.tomador];
  if (o.tomador === 'pessoa-fisica') {
    if (!cpfValido(o.cpf)) throw new Error('CPF inválido');
    const nome = semAcento(o.nome);
    if (nome.split(' ').length < 2) throw new Error('Informe o nome completo');
    tomador = { ...TOMADOR_PF, cpf: String(o.cpf).replace(/\D/g, ''), nome };
  }
  if (!tomador) throw new Error('Tomador desconhecido: ' + o.tomador);
  if (!Number.isInteger(o.valor) || o.valor <= 0) throw new Error('Valor inválido (em centavos)');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.competencia)) throw new Error('Competência deve ser AAAA-MM-DD');
  const nDps = Number(o.nDps);
  if (!Number.isInteger(nDps) || nDps < 1) throw new Error('Número do DPS inválido');
  const serie = Number(o.serie || 1);
  if (!Number.isInteger(serie) || serie < 1 || serie > 49999) throw new Error('Série inválida (sistema próprio usa 1 a 49999)');
  const amb = AMBIENTES[o.ambiente];
  if (!amb) throw new Error('Ambiente inválido');
  if (o.ticket && !/^\d{1,20}$/.test(String(o.ticket))) throw new Error('Ticket inválido');

  // O ambiente de testes já usa o esquema novo (20/10/2026: finNFSe obrigatório, cNBS antes da descrição); a produção ainda usa o 1.01 de 09/02/2026
  const novo = o.ambiente === 'teste';
  const iss = issEmCentavos(o.valor);
  const id = idDps(serie, nDps);
  const emissao = dataHoraBrasilia(new Date((o.agora ? o.agora.getTime() : Date.now()) - 60 * 1000));
  const infDps =
    `<infDPS Id="${id}">` +
    `<tpAmb>${amb.tpAmb}</tpAmb><dhEmi>${emissao}</dhEmi><verAplic>${VER_APLIC}</verAplic>` +
    `<serie>${serie}</serie><nDPS>${nDps}</nDPS><dCompet>${o.competencia}</dCompet><tpEmit>1</tpEmit>${novo ? '<finNFSe>0</finNFSe>' : ''}<cLocEmi>${PRESTADOR.cMun}</cLocEmi>` +
    `<prest><CNPJ>${PRESTADOR.cnpj}</CNPJ><regTrib><opSimpNac>1</opSimpNac><regEspTrib>0</regEspTrib></regTrib></prest>` +
    `<toma>${tomador.cpf ? `<CPF>${tomador.cpf}</CPF>` : `<CNPJ>${tomador.cnpj}</CNPJ>`}<xNome>${esc(tomador.nome)}</xNome></toma>` +
    `<serv><locPrest><cLocPrestacao>${PRESTADOR.cMun}</cLocPrestacao></locPrest>` +
    `<cServ><cTribNac>${tomador.cTribNac}</cTribNac>${novo ? `<cNBS>${tomador.nbs}</cNBS>` : ''}<xDescServ>${esc(descricaoServico(tomador, o.competencia, o.ticket))}</xDescServ>${novo ? '' : `<cNBS>${tomador.nbs}</cNBS>`}</cServ></serv>` +
    `<valores><vServPrest><vServ>${dinheiro(o.valor)}</vServ></vServPrest>` +
    `<trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun>` +
    `<totTrib><vTotTrib><vTotTribFed>0.00</vTotTribFed><vTotTribEst>0.00</vTotTribEst><vTotTribMun>${dinheiro(iss)}</vTotTribMun></vTotTrib></totTrib></trib></valores>` +
    `</infDPS>`;
  return { id, infDps, iss, tomador, nDps, serie, ambiente: o.ambiente };
}

// Forma canônica do infDPS isolado: o namespace do DPS vem declarado no próprio elemento
function canonicoInfDps(infDps) {
  return infDps.replace('<infDPS ', `<infDPS xmlns="${NS}" `);
}

// Certificado: lê o .pfx com o openssl (o Node não abre PKCS#12 para assinar). A senha vai por variável de ambiente
function acharOpenssl() {
  const candidatos = [process.env.OPENSSL_BIN, 'openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe', 'C:\\msys64\\ucrt64\\bin\\openssl.exe'].filter(Boolean);
  for (const c of candidatos) {
    try { execFileSync(c, ['version'], { stdio: 'pipe' }); return c; } catch { /* tenta o próximo */ }
  }
  throw new Error('openssl não encontrado (instale o Git para Windows ou defina OPENSSL_BIN)');
}

function carregarCertificado(caminhoPfx, senha) {
  if (!caminhoPfx || !fs.existsSync(caminhoPfx)) throw new Error('Arquivo do certificado não encontrado');
  if (!senha) throw new Error('Senha do certificado não informada');
  const bin = acharOpenssl();
  const env = { ...process.env, NFSE_PFX_SENHA: senha };
  let pem;
  for (const extra of [['-legacy'], []]) { // certificados ICP-Brasil antigos pedem o provedor legacy
    try {
      pem = execFileSync(bin, ['pkcs12', '-in', caminhoPfx, '-nodes', '-passin', 'env:NFSE_PFX_SENHA', ...extra], { env, stdio: 'pipe' }).toString('utf8');
      break;
    } catch (e) { pem = null; }
  }
  if (!pem) throw new Error('Não foi possível abrir o certificado (senha errada ou arquivo inválido)');
  const chave = pem.match(/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC )?PRIVATE KEY-----/);
  const certs = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
  if (!chave || !certs.length) throw new Error('Certificado sem chave privada');
  const privada = crypto.createPrivateKey(chave[0]);
  const pubDer = crypto.createPublicKey(privada).export({ type: 'spki', format: 'der' });
  const folha = certs.find(c => new crypto.X509Certificate(c).publicKey.export({ type: 'spki', format: 'der' }).equals(pubDer));
  if (!folha) throw new Error('Certificado não corresponde à chave');
  const x509 = new crypto.X509Certificate(folha);
  const agora = new Date();
  if (agora < new Date(x509.validFrom) || agora > new Date(x509.validTo)) throw new Error('Certificado fora da validade (valido de ' + x509.validFrom + ' ate ' + x509.validTo + ')');
  return { chavePem: chave[0], certPem: folha, cadeiaPem: certs.join('\n'), validade: x509.validTo, titular: x509.subject.replace(/\n/g, ', ') };
}

// Assina o infDPS (enveloped, RSA-SHA256, C14N) e devolve o XML completo do DPS
function assinarDps(infDps, id, cert) {
  const digest = crypto.createHash('sha256').update(canonicoInfDps(infDps), 'utf8').digest('base64');
  const signedInfo =
    `<SignedInfo><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></SignatureMethod>` +
    `<Reference URI="#${id}"><Transforms>` +
    `<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform>` +
    `<Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></Transform></Transforms>` +
    `<DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></DigestMethod><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
  const canonSignedInfo = signedInfo.replace('<SignedInfo>', `<SignedInfo xmlns="${NS_DSIG}">`);
  const assinatura = crypto.createSign('RSA-SHA256').update(canonSignedInfo, 'utf8').sign(cert.chavePem, 'base64');
  const x509 = cert.certPem.replace(/-----[A-Z ]+-----|\s/g, '');
  const sig =
    `<Signature xmlns="${NS_DSIG}">${signedInfo}<SignatureValue>${assinatura}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${x509}</X509Certificate></X509Data></KeyInfo></Signature>`;
  return `<?xml version="1.0" encoding="UTF-8"?><DPS xmlns="${NS}" versao="1.01">${infDps}${sig}</DPS>`;
}

function postar(amb, caminho, corpoJson, cert) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: amb.host, path: amb.base + caminho, method: 'POST', key: cert.chavePem, cert: cert.cadeiaPem, timeout: 60000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(corpoJson) },
    }, res => {
      const partes = [];
      res.on('data', d => partes.push(d));
      res.on('end', () => resolve({ status: res.statusCode, corpo: Buffer.concat(partes).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado falando com a Receita')));
    req.on('error', reject);
    req.end(corpoJson);
  });
}

// Envia o DPS assinado. Não repete sozinho: um reenvio com o mesmo número é recusado, mas sempre consulte antes.
async function enviarDps(dpsXml, ambiente, cert) {
  const amb = AMBIENTES[ambiente];
  const corpo = JSON.stringify({ dpsXmlGZipB64: zlib.gzipSync(Buffer.from(dpsXml, 'utf8')).toString('base64') });
  const r = await postar(amb, '/nfse', corpo, cert);
  let json = null;
  try { json = JSON.parse(r.corpo); } catch { /* resposta não-JSON */ }
  const resultado = { status: r.status, json, bruto: json ? undefined : r.corpo.slice(0, 500) };
  if (json && json.nfseXmlGZipB64) {
    resultado.nfseXml = zlib.gunzipSync(Buffer.from(json.nfseXmlGZipB64, 'base64')).toString('utf8');
    resultado.chaveAcesso = json.chaveAcesso;
  }
  return resultado;
}

module.exports = { cpfValido, TOMADORES, AMBIENTES, PRESTADOR, issEmCentavos, descricaoServico, idDps, montarDps, canonicoInfDps, carregarCertificado, assinarDps, enviarDps };
