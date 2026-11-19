'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
process.env.PASTA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'correa-nfexml-test-'));
const db = require('../db');
const nfe = require('../nfe');
const nfse = require('../nfse');
const sefaz = require('../nfe-sefaz');

const pessoa = { nome: 'Fulana de Teste', cpf: '52998224725', endereco: 'Rua das Flores', numero: '10', bairro: 'Centro', cidade: 'Barra Bonita', uf: 'SP', cep: '17340000' };
const carro = { marca_modelo: 'GM Meriva Joy 1.4', ano_fab: 2011, ano_mod: 2011, cor: 'Prata', placa: 'AAA1B23', renavam: '00123456789', chassi: '9BGXL75XBC0000000', tipo_entrada: 'consignacao', valor_compra: 3400000 };

test('XML da entrada de consignação tem os mesmos valores do TXT e passa na assinatura', async t => {
  const { id } = db.criarCompra({ pessoa, veiculo: carro });
  const g = await nfe.gerarNota(id, 'entrada_consignacao', { numero: 801, ncm: '87032210', valor: 3400000, data: '2026-11-19T10:00', homologacao: true, xml: true });
  const x = g.xml;
  assert.ok(x.startsWith(`<infNFe Id="NFe${g.chave}" versao="4.00"><ide><cUF>35</cUF>`));
  for (const trecho of ['<nNF>801</nNF>', '<tpNF>0</tpNF>', '<tpAmb>2</tpAmb>', '<CFOP>1917</CFOP>', '<NCM>87032210</NCM>', '<vProd>34000.00</vProd>', '<vNF>34000.00</vNF>',
    '<CPF>52998224725</CPF>', '<xNome>NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xNome>', '<ICMS20><orig>0</orig><CST>20</CST><modBC>3</modBC><pRedBC>90.00</pRedBC>',
    '<PISNT><CST>07</CST></PISNT>', '<tPag>90</tPag><vPag>0.00</vPag>', '<dhEmi>2026-11-19T10:00:00-03:00</dhEmi>']) {
    assert.ok(x.includes(trecho), 'faltou: ' + trecho);
  }
  assert.ok(!/<(\w+)><\/\1>/.test(x), 'não pode ter tag vazia');
  assert.ok(!/<(\w+)\/>/.test(x), 'não pode ter tag autofechada');
  assert.ok(g.conteudo.includes(`A|4.00|NFe${g.chave}|`), 'TXT e XML com a mesma chave');

  try { execFileSync('openssl', ['version'], { stdio: 'pipe' }); } catch { return t.skip('sem openssl'); }
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nfe-cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(pasta, 'k.pem'), '-out', path.join(pasta, 'c.pem'), '-days', '2', '-subj', '/CN=TESTE'], { stdio: 'pipe' });
  execFileSync('openssl', ['pkcs12', '-export', '-inkey', path.join(pasta, 'k.pem'), '-in', path.join(pasta, 'c.pem'), '-out', path.join(pasta, 'c.pfx'), '-passout', 'pass:x1'], { stdio: 'pipe' });
  const cert = nfse.carregarCertificado(path.join(pasta, 'c.pfx'), 'x1');
  const nfeXml = sefaz.assinarNfe(x, g.chave, cert);
  assert.ok(nfeXml.startsWith('<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe '));
  const digest = nfeXml.match(/<DigestValue>(.+?)<\/DigestValue>/)[1];
  assert.equal(digest, crypto.createHash('sha1').update(x.replace('<infNFe ', '<infNFe xmlns="http://www.portalfiscal.inf.br/nfe" ')).digest('base64'));
  const si = nfeXml.match(/<SignedInfo>[\s\S]+?<\/SignedInfo>/)[0].replace('<SignedInfo>', '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">');
  assert.ok(crypto.createVerify('RSA-SHA1').update(si).verify(cert.certPem, nfeXml.match(/<SignatureValue>(.+?)<\/SignatureValue>/)[1], 'base64'));
  assert.ok(nfeXml.includes(`<Reference URI="#NFe${g.chave}">`));
});

test('nota de venda ainda não sai direto pela SEFAZ (fica no Emissor por enquanto)', () => {
  assert.throws(() => require('../nfe-xml').montarInfNFe({ venda: true }), /venda ainda não sai/);
});

test('Ciência da Operação (210210): evento montado e assinado no padrão da SEFAZ', t => {
  try { execFileSync('openssl', ['version'], { stdio: 'pipe' }); } catch { return t.skip('sem openssl'); }
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'evt-cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(pasta, 'k.pem'), '-out', path.join(pasta, 'c.pem'), '-days', '2', '-subj', '/CN=TESTE'], { stdio: 'pipe' });
  execFileSync('openssl', ['pkcs12', '-export', '-inkey', path.join(pasta, 'k.pem'), '-in', path.join(pasta, 'c.pem'), '-out', path.join(pasta, 'c.pfx'), '-passout', 'pass:x1'], { stdio: 'pipe' });
  const cert = nfse.carregarCertificado(path.join(pasta, 'c.pfx'), 'x1');
  const chave = '35261043952001000149550010000123451000000019';
  const { id, inf } = sefaz.montarCiencia(chave, '07793106000139', new Date('2026-11-19T15:00:00Z'));
  assert.equal(id, `ID210210${chave}01`);
  for (const trecho of ['<cOrgao>91</cOrgao>', '<tpAmb>1</tpAmb>', '<tpEvento>210210</tpEvento>', '<nSeqEvento>1</nSeqEvento>', '<descEvento>Ciencia da Operacao</descEvento>', '<dhEvento>2026-11-19T12:00:00-03:00</dhEvento>']) assert.ok(inf.includes(trecho), trecho);
  const ev = sefaz.assinarEvento(inf, id, cert);
  const digest = ev.match(/<DigestValue>(.+?)<\/DigestValue>/)[1];
  assert.equal(digest, crypto.createHash('sha1').update(inf.replace('<infEvento ', '<infEvento xmlns="http://www.portalfiscal.inf.br/nfe" ')).digest('base64'));
  const si = ev.match(/<SignedInfo>[\s\S]+?<\/SignedInfo>/)[0].replace('<SignedInfo>', '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">');
  assert.ok(crypto.createVerify('RSA-SHA1').update(si).verify(cert.certPem, ev.match(/<SignatureValue>(.+?)<\/SignatureValue>/)[1], 'base64'));
  assert.ok(ev.includes(`<Reference URI="#${id}">`));
});

test('distribuição de DF-e: lê o resumo de uma NF-e recebida', () => {
  const zlib = require('node:zlib');
  const xml = '<resNFe xmlns="http://www.portalfiscal.inf.br/nfe"><chNFe>35261043952001000149550010000123451000000019</chNFe><CNPJ>43952001000149</CNPJ><xNome>GRACIANO TESTE</xNome><dhEmi>2026-10-15T10:00:00-03:00</dhEmi><tpNF>1</tpNF><vNF>26000.00</vNF></resNFe>';
  const r = sefaz.lerDocZip({ nsu: '7', schema: 'resNFe_v1.01', conteudo: zlib.gzipSync(Buffer.from(xml)).toString('base64') });
  assert.equal(r.emitCnpj, '43952001000149');
  assert.equal(r.vNF, '26000.00');
  assert.equal(r.chave.length, 44);
});
