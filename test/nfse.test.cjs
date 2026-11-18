'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const nfse = require('../nfse');

const base = { tomador: 'santander-financiamento', valor: 61165, competencia: '2026-11-05', nDps: 4, serie: 1, ambiente: 'teste', agora: new Date('2026-11-18T18:00:00Z') };

test('identificador do DPS segue a regra de 45 posições (igual ao do Emissor, série 70000)', () => {
  assert.equal(nfse.idDps(70000, 2), 'DPS350530220779310600013970000000000000000002');
  assert.equal(nfse.idDps(1, 4).length, 45);
});

test('ISS de 3% arredondado em centavos (confere com as notas emitidas)', () => {
  assert.equal(nfse.issEmCentavos(59538), 1786);
  assert.equal(nfse.issEmCentavos(61165), 1835);
  assert.equal(nfse.issEmCentavos(244), 7);
});

test('DPS do Santander financiamento: código 10.02.01, NBS, descrição e valores', () => {
  const d = nfse.montarDps(base);
  assert.match(d.infDps, /<tpAmb>2<\/tpAmb>/);
  assert.match(d.infDps, /<dhEmi>2026-11-18T14:59:00-03:00<\/dhEmi>/);
  assert.match(d.infDps, /<cTribNac>100201<\/cTribNac>/);
  assert.match(d.infDps, /<cNBS>109013300<\/cNBS>/);
  assert.match(d.infDps, /COMISSAO REF\. 11\/2026</);
  assert.match(d.infDps, /<vServ>611\.65<\/vServ>/);
  assert.match(d.infDps, /<vTotTribMun>18\.35<\/vTotTribMun>/);
  assert.equal(d.id, 'DPS' + '3505302' + '2' + '07793106000139' + '00001' + '000000000000004');
});

test('seguros usam 10.01.02 e levam o ticket na descrição', () => {
  const d = nfse.montarDps({ ...base, tomador: 'santander-seguros', valor: 8081, ticket: '1234567' });
  assert.match(d.infDps, /<cTribNac>100102<\/cTribNac>/);
  assert.match(d.infDps, /<cNBS>109061100<\/cNBS>/);
  assert.match(d.infDps, /SEGUROS - COMISSAO REF\. 11\/2026 - TICKET 1234567</);
});

test('recusa dados inválidos', () => {
  assert.throws(() => nfse.montarDps({ ...base, tomador: 'x' }), /Tomador/);
  assert.throws(() => nfse.montarDps({ ...base, valor: 12.5 }), /Valor/);
  assert.throws(() => nfse.montarDps({ ...base, competencia: '05/11/2026' }), /Competência/);
  assert.throws(() => nfse.montarDps({ ...base, nDps: 0 }), /Número/);
  assert.throws(() => nfse.montarDps({ ...base, ambiente: 'x' }), /Ambiente/);
  assert.throws(() => nfse.montarDps({ ...base, ticket: '12 34' }), /Ticket/);
});

test('assinatura confere: digest do infDPS e RSA-SHA256 do SignedInfo', t => {
  let bin;
  try { bin = execFileSync('openssl', ['version'], { stdio: 'pipe' }) && 'openssl'; } catch { return t.skip('sem openssl'); }
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-teste-'));
  const k = path.join(pasta, 'k.pem'), c = path.join(pasta, 'c.pem'), p = path.join(pasta, 'c.pfx');
  execFileSync(bin, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', k, '-out', c, '-days', '2', '-subj', '/CN=TESTE'], { stdio: 'pipe' });
  execFileSync(bin, ['pkcs12', '-export', '-inkey', k, '-in', c, '-out', p, '-passout', 'pass:senha-de-teste'], { stdio: 'pipe' });
  const cert = nfse.carregarCertificado(p, 'senha-de-teste');
  assert.throws(() => nfse.carregarCertificado(p, 'errada'), /senha errada|Não foi possível/);
  const d = nfse.montarDps(base);
  const xml = nfse.assinarDps(d.infDps, d.id, cert);
  const digest = xml.match(/<DigestValue>(.+?)<\/DigestValue>/)[1];
  assert.equal(digest, crypto.createHash('sha256').update(nfse.canonicoInfDps(d.infDps)).digest('base64'));
  const signedInfo = xml.match(/<SignedInfo>[\s\S]+?<\/SignedInfo>/)[0].replace('<SignedInfo>', '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">');
  const valor = xml.match(/<SignatureValue>(.+?)<\/SignatureValue>/)[1];
  assert.ok(crypto.createVerify('RSA-SHA256').update(signedInfo).verify(cert.certPem, valor, 'base64'));
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="'));
  fs.rmSync(pasta, { recursive: true, force: true });
});

test('tomador pessoa física: CPF validado, nome sem acento, descrição de teste', () => {
  assert.equal(nfse.cpfValido('529.982.247-25'), true);
  assert.equal(nfse.cpfValido('111.111.111-11'), false);
  assert.equal(nfse.cpfValido('529.982.247-26'), false);
  const d = nfse.montarDps({ ...base, tomador: 'pessoa-fisica', cpf: '529.982.247-25', nome: 'Fulano de Tal Corrêa', valor: 1000, ambiente: 'producao' });
  assert.match(d.infDps, /<toma><CPF>52998224725<\/CPF><xNome>FULANO DE TAL CORREA<\/xNome><\/toma>/);
  assert.match(d.infDps, /COMISSAO \(TESTE DO SISTEMA\)/);
  assert.match(d.infDps, /<vServ>10\.00<\/vServ>/);
  assert.match(d.infDps, /<vTotTribMun>0\.30<\/vTotTribMun>/);
  assert.match(d.infDps, /<tpAmb>1<\/tpAmb>/);
  assert.ok(!/finNFSe/.test(d.infDps));
  assert.throws(() => nfse.montarDps({ ...base, tomador: 'pessoa-fisica', cpf: '123', nome: 'A B' }), /CPF/);
  assert.throws(() => nfse.montarDps({ ...base, tomador: 'pessoa-fisica', cpf: '52998224725', nome: 'Fulano' }), /nome completo/);
});

test('todos os bancos cadastrados têm CNPJ válido (dígitos conferem)', () => {
  const valido = c => {
    const d = c.split('').map(Number);
    const dv = n => { let p = n - 7, s = 0; for (let i = 0; i < n; i++) { s += d[i] * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
    return d.length === 14 && dv(12) === d[12] && dv(13) === d[13];
  };
  for (const [id, t] of Object.entries(nfse.TOMADORES)) assert.ok(valido(t.cnpj), id + ' com CNPJ inválido');
  assert.equal(nfse.TOMADORES['bv-financiamento'].nome, 'BANCO VOTORANTIM S.A.');
  const d = nfse.montarDps({ ...base, tomador: 'bv-financiamento', valor: 100000 });
  assert.match(d.infDps, /<CNPJ>59588111000103<\/CNPJ><xNome>BANCO VOTORANTIM S\.A\.<\/xNome>/);
  assert.match(d.infDps, /<cTribNac>100501<\/cTribNac>/);
});

test('cliente de carro consignado: dono como tomador e o carro na descrição', () => {
  const d = nfse.montarDps({ ...base, tomador: 'cliente-consignacao', cpf: '529.982.247-25', nome: 'Fulano de Tal Corrêa', veiculoTexto: 'Chevrolet Classic LS 2011/2012 Preta PLACA EYH4910', valor: 50000, ambiente: 'producao' });
  assert.match(d.infDps, /<toma><CPF>52998224725<\/CPF><xNome>FULANO DE TAL CORREA<\/xNome><\/toma>/);
  assert.match(d.infDps, /INTERMEDIACAO NA VENDA DE VEICULO CONSIGNADO - CHEVROLET CLASSIC LS 2011\/2012 PRETA PLACA EYH4910 - COMISSAO REF\. 11\/2026</);
  assert.match(d.infDps, /<cTribNac>100501<\/cTribNac>/);
  assert.match(d.infDps, /<vServ>500\.00<\/vServ>/);
  assert.match(d.infDps, /<vTotTribMun>15\.00<\/vTotTribMun>/);
  assert.throws(() => nfse.montarDps({ ...base, tomador: 'cliente-consignacao', cpf: '123', nome: 'Fulano de Tal', veiculoTexto: 'X' }), /CPF/);
  assert.throws(() => nfse.montarDps({ ...base, tomador: 'cliente-consignacao', cpf: '52998224725', nome: 'Fulano de Tal', veiculoTexto: '' }), /carro/);
});
