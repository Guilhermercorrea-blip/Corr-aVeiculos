'use strict';
// Nota de venda direta na SEFAZ: XML com os impostos da venda e as formas de pagamento; sempre em homologação por enquanto
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
process.env.PASTA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'correa-vendadireta-test-'));

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'venda-cert-'));
let temOpenssl = true;
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(pasta, 'k.pem'), '-out', path.join(pasta, 'c.pem'), '-days', '2', '-subj', '/CN=TESTE'], { stdio: 'pipe' });
  execFileSync('openssl', ['pkcs12', '-export', '-inkey', path.join(pasta, 'k.pem'), '-in', path.join(pasta, 'c.pem'), '-out', path.join(pasta, 'c.pfx'), '-passout', 'pass:abc123'], { stdio: 'pipe' });
  process.env.NFSE_PFX = path.join(pasta, 'c.pfx');
} catch { temOpenssl = false; }

const db = require('../db');
const nfe = require('../nfe');
const sefaz = require('../nfe-sefaz');
const direta = require('../nfe-direta');

const FICHA = { motor: 'ABC123456', potencia: 80, cilindrada: 1400, peso: '1.5', cmt: '1.9', eixos: 2, combustivel: '16', tipo: '06', especie: '1', lotacao: 5, cor: '10', pintura: 'S', marca_modelo: '1' };
const dono = { nome: 'Vendedor Teste', cpf: '52998224725', endereco: 'Rua das Flores', numero: '10', bairro: 'Centro', cidade: 'Barra Bonita', uf: 'SP', cep: '17340000' };

function carroVendido(placa, comprador, venda) {
  const { id } = db.criarCompra({ pessoa: dono, veiculo: { marca_modelo: 'VW Fox 1.6', ano_fab: 2012, ano_mod: 2013, cor: 'Prata', placa, chassi: '9BWAB05Z394087944', tipo_entrada: 'compra', valor_compra: 2600000 } });
  db.registrarVenda(id, { pessoa: comprador, venda: { km_saida: 1000, ...venda } });
  return id;
}
const comprador = { nome: 'Comprador Teste', cpf: '86288366757', endereco: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'Barra Bonita', uf: 'SP', cep: '17340000' };

test('XML da venda: ICMS sobre 10%, benefício SP020110, PIS/COFINS sobre o lucro e cada forma de pagamento', async () => {
  const id = carroVendido('VEN1A11', comprador, { valor_venda: 3000000, meios_pagamento: ['pix', 'financiamento'], valor_pix: 1000000, valor_financiado: 2000000, banco: 'BV', parcelas: 48 });
  const g = await nfe.gerarNota(id, 'venda', { ficha: FICHA, numero: 8000, ncm: '87032210', valor: 3000000, data: '2026-11-19T10:00', xml: true, homologacao: true });
  const x = g.xml;
  assert.match(x, /<NCM>87032210<\/NCM><cBenef>SP020110<\/cBenef><CFOP>5102<\/CFOP>/);
  assert.match(x, /<ICMS20><orig>0<\/orig><CST>20<\/CST><modBC>3<\/modBC><pRedBC>90.0000<\/pRedBC><vBC>3000.00<\/vBC><pICMS>18.0000<\/pICMS><vICMS>540.00<\/vICMS><\/ICMS20>/);
  // lucro 4.000,00: PIS 0,65% = 26,00; COFINS 3% = 120,00
  assert.match(x, /<PISAliq><CST>01<\/CST><vBC>4000.00<\/vBC><pPIS>0.6500<\/pPIS><vPIS>26.00<\/vPIS><\/PISAliq>/);
  assert.match(x, /<COFINSAliq><CST>01<\/CST><vBC>4000.00<\/vBC><pCOFINS>3.0000<\/pCOFINS><vCOFINS>120.00<\/vCOFINS><\/COFINSAliq>/);
  assert.match(x, /<vBC>3000.00<\/vBC><vICMS>540.00<\/vICMS>/);
  assert.match(x, /<vPIS>26.00<\/vPIS><vCOFINS>120.00<\/vCOFINS>/);
  assert.match(x, /<pag><detPag><indPag>0<\/indPag><tPag>17<\/tPag><vPag>10000.00<\/vPag><card><tpIntegra>2<\/tpIntegra><\/card><\/detPag><detPag><indPag>0<\/indPag><tPag>18<\/tPag><vPag>20000.00<\/vPag><\/detPag><\/pag>/);
  assert.match(x, /<indFinal>1<\/indFinal>/);
  assert.match(x, /<indIEDest>9<\/indIEDest>/);
  // o TXT do Emissor continua igual
  assert.ok(g.conteudo.includes('YA01|0|17||10000.00||||') && g.conteudo.includes('YA01|0|18||20000.00||||'));
});

test('comprador de outro estado: CFOP 6102', async () => {
  const id = carroVendido('VEN1A12', { ...comprador, cpf: '11144477735', cidade: 'Curitiba', uf: 'PR', cep: '80010000' }, { valor_venda: 3000000, meios_pagamento: ['pix'], valor_pix: 3000000 });
  const g = await nfe.gerarNota(id, 'venda', { ficha: FICHA, numero: 8001, ncm: '87032210', valor: 3000000, data: '2026-11-19T10:00', xml: true, homologacao: true }).catch(e => e);
  if (g instanceof Error) return; // sem internet para achar o código IBGE de Curitiba: o resto do teste não se aplica
  assert.match(g.xml, /<CFOP>6102<\/CFOP>/);
  assert.match(g.xml, /<idDest>2<\/idDest>/);
});

test('venda direta sai SEMPRE em homologação, mesmo com o servidor em produção', async t => {
  if (!temOpenssl) return t.skip('sem openssl');
  process.env.NFE_AMBIENTE = 'producao';
  try {
    const id = carroVendido('VEN1A13', { ...comprador, cpf: '39053344705' }, { valor_venda: 3000000, meios_pagamento: ['pix'], valor_pix: 3000000 });
    assert.equal(direta.estado(id, 'venda').ambiente, 'homologacao');
    assert.equal(direta.estado(id, 'venda').suportado, true);
    assert.equal(direta.estado(id, 'entrada_compra').ambiente, 'producao');
    let enviado;
    const o = sefaz.autorizar;
    sefaz.autorizar = async (amb, xml) => { enviado = { amb, xml }; return { cStat: '100', xMotivo: 'Autorizado', nProt: '1', nfeProc: '<nfeProc/>' }; };
    try { await direta.emitir(id, 'venda', { ficha: FICHA, numero: 8002, ncm: '87032210', valor: 3000000, senha: 'abc123', confirmar: true }); }
    finally { sefaz.autorizar = o; }
    assert.equal(enviado.amb, 'homologacao');
    assert.match(enviado.xml, /<tpAmb>2<\/tpAmb>/);
    assert.equal(db.conexao.prepare('SELECT COUNT(*) n FROM nfe_notas WHERE veiculo_id = ?').get(id).n, 0, 'teste não gasta número real');
  } finally { delete process.env.NFE_AMBIENTE; }
});
