'use strict';
// Correções da revisão de 19/11/2026: nota fiscal guardada, nota autorizada travada, envio sem resposta, devolução
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
process.env.PASTA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'correa-revisao-test-'));
delete process.env.NFE_AMBIENTE;

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'revisao-cert-'));
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
const CPFS = ['52998224725', '11144477735', '39053344705', '16899535009', '45317828791', '86924249868', '28208385883', '86288366757', '71428793860'];
let n = 0;
function carro(extra = {}) {
  const i = n++;
  return db.criarCompra({
    pessoa: { nome: 'Fulana de Teste', cpf: CPFS[i], endereco: 'Rua das Flores', numero: '10', bairro: 'Centro', cidade: 'Barra Bonita', uf: 'SP', cep: '17340000' },
    veiculo: { marca_modelo: 'GM Meriva Joy 1.4', ano_fab: 2011, ano_mod: 2011, cor: 'Prata', placa: `REV1A${10 + i}`, chassi: '9BGXL75XBC0000000', tipo_entrada: 'consignacao', valor_compra: 3400000, ...extra },
  }).id;
}
const pedido = numero => ({ ficha: FICHA, numero, ncm: '87032210', valor: 3400000, senha: 'abc123', confirmar: true, confirmarProducao: true });
const trocar = async (obj, nome, fn, corpo) => { const o = obj[nome]; obj[nome] = fn; try { return await corpo(); } finally { obj[nome] = o; } };

test('carro com nota fiscal autorizada não pode ser excluído', async () => {
  const id = carro();
  await nfe.gerarNota(id, 'entrada_consignacao', { ficha: FICHA, numero: 7000, ncm: '87032210', valor: 3400000 });
  db.conexao.prepare("UPDATE nfe_notas SET xml_autorizado = '<x/>', protocolo = '1' WHERE numero = 7000").run();
  assert.throws(() => db.excluirVeiculo(id), /NF-e nº 7000/);
  assert.equal(db.conexao.prepare('SELECT COUNT(*) n FROM nfe_notas WHERE numero = 7000').get().n, 1);
  const semNota = carro();
  assert.deepEqual(db.excluirVeiculo(semNota), { ok: true });
});

test('nota já autorizada não pode ser gerada de novo (a chave não muda)', async () => {
  const id = carro();
  const g = await nfe.gerarNota(id, 'entrada_consignacao', { ficha: FICHA, numero: 7010, ncm: '87032210', valor: 3400000 });
  db.conexao.prepare("UPDATE nfe_notas SET xml_autorizado = '<x/>', protocolo = '1' WHERE numero = 7010").run();
  await assert.rejects(nfe.gerarNota(id, 'entrada_consignacao', { ficha: FICHA, numero: 7010, ncm: '87032210', valor: 3400000 }), /já está autorizada/);
  assert.equal(db.conexao.prepare('SELECT chave FROM nfe_notas WHERE numero = 7010').get().chave, g.chave);
});

test('envio sem resposta: na próxima vez consulta a chave e recupera a nota autorizada, sem emitir outra', async t => {
  if (!temOpenssl) return t.skip('sem openssl');
  process.env.NFE_AMBIENTE = 'producao';
  try {
    const id = carro();
    await trocar(sefaz, 'autorizar', async () => { throw new Error('socket hang up'); }, () => assert.rejects(direta.emitir(id, 'entrada_consignacao', pedido(7020)), /NÃO emita de novo/));
    const pend = db.conexao.prepare('SELECT chave, xml FROM nfe_envios WHERE veiculo_id = ?').get(id);
    assert.ok(pend.xml.includes('<Signature'), 'XML assinado guardado antes do envio');
    let enviou = false;
    const prot = `<protNFe versao="4.00"><infProt><tpAmb>1</tpAmb><chNFe>${pend.chave}</chNFe><dhRecbto>2026-11-19T10:01:02-03:00</dhRecbto><nProt>135269999999999</nProt><cStat>100</cStat><xMotivo>Autorizado</xMotivo></infProt></protNFe>`;
    const r = await trocar(sefaz, 'consultarChave', async () => ({ cStat: '100', cStatProt: '100', protocolo: '135269999999999', protXml: prot }),
      () => trocar(sefaz, 'autorizar', async () => { enviou = true; return {}; }, () => direta.emitir(id, 'entrada_consignacao', pedido(7021))));
    assert.equal(enviou, false, 'não pode mandar outra nota');
    assert.equal(r.recuperada, true);
    assert.equal(r.numero, 7020);
    assert.equal(db.conexao.prepare('SELECT situacao FROM nfe_envios WHERE veiculo_id = ?').get(id).situacao, 'autorizada');
    assert.ok(db.conexao.prepare('SELECT xml_autorizado x FROM nfe_notas WHERE numero = 7020').get().x.includes('<nfeProc'));
    assert.throws(() => db.excluirVeiculo(id), /NF-e/);
  } finally { delete process.env.NFE_AMBIENTE; }
});

test('resposta sem o resultado da nota fica "conferir"; consulta 217 libera emitir de novo', async t => {
  if (!temOpenssl) return t.skip('sem openssl');
  process.env.NFE_AMBIENTE = 'producao';
  try {
    const id = carro();
    await trocar(sefaz, 'autorizar', async () => ({ cStatLote: '104', xMotivoLote: 'Lote processado' }), () => assert.rejects(direta.emitir(id, 'entrada_consignacao', pedido(7030)), /sem dizer se autorizou/));
    assert.equal(db.conexao.prepare('SELECT situacao FROM nfe_envios WHERE veiculo_id = ?').get(id).situacao, 'incerta');
    const r = await trocar(sefaz, 'consultarChave', async () => ({ cStat: '217', xMotivo: 'NF-e não consta na base' }),
      () => trocar(sefaz, 'autorizar', async () => ({ cStat: '100', xMotivo: 'Autorizado', nProt: '135260000000077', nfeProc: '<nfeProc/>' }), () => direta.emitir(id, 'entrada_consignacao', pedido(7030))));
    assert.equal(r.protocolo, '135260000000077');
    assert.deepEqual(db.conexao.prepare('SELECT situacao FROM nfe_envios WHERE veiculo_id = ? ORDER BY id').all(id).map(e => e.situacao), ['rejeitada', 'autorizada']);
  } finally { delete process.env.NFE_AMBIENTE; }
});

test('duplo clique: a segunda emissão do mesmo carro espera a primeira', async t => {
  if (!temOpenssl) return t.skip('sem openssl');
  const id = carro();
  let soltar;
  const espera = new Promise(r => { soltar = r; });
  await trocar(sefaz, 'autorizar', async () => { await espera; return { cStat: '100', xMotivo: 'ok', nProt: '1', nfeProc: '<nfeProc/>' }; }, async () => {
    const primeira = direta.emitir(id, 'entrada_consignacao', pedido(7040));
    await new Promise(r => setTimeout(r, 50));
    await assert.rejects(direta.emitir(id, 'entrada_consignacao', pedido(7040)), /já está sendo enviada/);
    soltar();
    await primeira;
  });
});

test('devolução sugere a entrada autorizada, não um arquivo gerado depois e nunca transmitido', async () => {
  const id = carro();
  const boa = await nfe.gerarNota(id, 'entrada_consignacao', { ficha: FICHA, numero: 7050, ncm: '87032210', valor: 3400000 });
  db.conexao.prepare("UPDATE nfe_notas SET xml_autorizado = '<x/>', protocolo = '1' WHERE numero = 7050").run();
  db.conexao.prepare("INSERT INTO nfe_notas (veiculo_id, tipo, serie, numero, chave, valor) VALUES (?, 'entrada_consignacao', 1, 7051, '35261107793106000139550010000070511000000001', 3400000)").run(id);
  assert.equal(nfe.sugestao(id, 'devolucao_consignacao').referencia, boa.chave);
});

test('devolução de consignação de carro antigo sem dados do CRLV: sai igual à entrada (descrição e código), CFOP 1918, sem grupo do veículo', async () => {
  // nota de entrada "do Emissor": gerada num carro auxiliar e anexada ao carro antigo (sem ficha e sem chassi)
  const aux = carro();
  const ent = await nfe.gerarNota(aux, 'entrada_consignacao', { ficha: FICHA, numero: 7060, ncm: '87032210', valor: 4600000, data: '2026-06-06T15:00', xml: true });
  const prot = `<protNFe versao="4.00"><infProt><tpAmb>1</tpAmb><chNFe>${ent.chave}</chNFe><dhRecbto>2026-06-06T15:09:00-03:00</dhRecbto><nProt>135262214682586</nProt><cStat>100</cStat><xMotivo>Autorizado</xMotivo></infProt></protNFe>`;
  const xmlEntrada = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe xmlns="http://www.portalfiscal.inf.br/nfe">${ent.xml.replace(/<xProd>[^<]*<\/xProd>/, '<xProd>CHEVROLET COBALT 1.4 LTZ, PRETA, 2013/2013 RENAVAM 00533030366 PLACA FIZ8I04</xProd>').replace(/<cProd>[^<]*<\/cProd>/, '<cProd>11</cProd>')}</NFe>${prot}</nfeProc>`;
  const { id } = db.criarCompra({ pessoa: { nome: 'Sergio Teste', cpf: '27407999856', endereco: 'Rua Sao Joao', numero: '64', bairro: 'Centro', cidade: 'Barra Bonita', uf: 'SP', cep: '17340000' },
    veiculo: { marca_modelo: 'Chevrolet Cobalt 1.4 LTZ', ano_fab: 2013, ano_mod: 2013, cor: 'Preta', placa: 'FIZ8I04', tipo_entrada: 'consignacao', valor_compra: 4600000 } });
  db.conexao.prepare("INSERT INTO nfe_notas (veiculo_id, tipo, serie, numero, chave, valor, xml_autorizado, protocolo) VALUES (?, 'entrada_consignacao', 1, 7061, ?, 4600000, ?, '135262214682586')").run(id, ent.chave, xmlEntrada);
  const s = nfe.sugestao(id, 'devolucao_consignacao');
  assert.equal(s.referencia, ent.chave);
  const d = await nfe.gerarNota(id, 'devolucao_consignacao', { numero: 7062, ncm: '87032210', valor: 4600000, data: '2026-11-20T10:00', referencia: s.referencia, xml: true, homologacao: true });
  assert.match(d.xml, /<cProd>11<\/cProd><cEAN>SEM GTIN<\/cEAN><xProd>CHEVROLET COBALT 1.4 LTZ, PRETA, 2013\/2013 RENAVAM 00533030366 PLACA FIZ8I04<\/xProd>/);
  assert.match(d.xml, /<CFOP>1918<\/CFOP>/);
  assert.match(d.xml, new RegExp(`<refNFe>${ent.chave}</refNFe>`));
  assert.ok(!d.xml.includes('<veicProd>'));
  assert.ok(d.conteudo.split('\r\n').some(l => l.startsWith('I|11|||CHEVROLET COBALT')) && !d.conteudo.includes('\r\nJ|'));
  // entrada continua exigindo os dados do CRLV
  const novo = carro();
  await assert.rejects(nfe.gerarNota(novo, 'entrada_consignacao', { numero: 7063, ncm: '87032210', valor: 100 }), /motor/);
});

test('consignado devolvido ao dono sai do estoque e pode voltar; carro comprado não', () => {
  const id = carro();
  assert.equal(db.marcarDevolvido(id).status, 'devolvido');
  assert.ok(!db.listarVeiculos('estoque').some(v => v.id === id));
  assert.ok(db.listarVeiculos('devolvido').some(v => v.id === id));
  assert.equal(db.marcarDevolvido(id, false).status, 'estoque');
  const comprado = carro({ tipo_entrada: 'compra' });
  assert.throws(() => db.marcarDevolvido(comprado), /Só carro em consignação/);
});

test('devoluções em lote: só carros devolvidos sem devolução, números em sequência, para na primeira recusa', async t => {
  if (!temOpenssl) return t.skip('sem openssl');
  process.env.NFE_AMBIENTE = 'producao';
  try {
    const montarDevolvido = async (numeroEntrada, cpf, placa) => {
      const aux = db.criarCompra({ pessoa: { nome: 'Dono Aux', cpf, endereco: 'Rua A', numero: '1', bairro: 'C', cidade: 'Barra Bonita', uf: 'SP', cep: '17340000' },
        veiculo: { marca_modelo: 'VW Gol 1.0', ano_fab: 2010, ano_mod: 2010, cor: 'Prata', placa, chassi: '9BWAA05Z094000000', tipo_entrada: 'consignacao', valor_compra: 2000000 } }).id;
      const ent = await nfe.gerarNota(aux, 'entrada_consignacao', { ficha: FICHA, numero: numeroEntrada, ncm: '87032100', valor: 2000000, data: '2026-06-06T15:00', xml: true });
      const prot = `<protNFe versao="4.00"><infProt><tpAmb>1</tpAmb><chNFe>${ent.chave}</chNFe><dhRecbto>2026-06-06T15:09:00-03:00</dhRecbto><nProt>1352600000${numeroEntrada}</nProt><cStat>100</cStat><xMotivo>Autorizado</xMotivo></infProt></protNFe>`;
      db.conexao.prepare('UPDATE nfe_notas SET xml_autorizado = ?, protocolo = ? WHERE numero = ?').run(`<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe xmlns="http://www.portalfiscal.inf.br/nfe">${ent.xml}</NFe>${prot}</nfeProc>`, '1', numeroEntrada);
      db.conexao.prepare("UPDATE veiculos SET ficha_nfe = NULL WHERE id = ?").run(aux); // carro antigo, sem CRLV
      db.marcarDevolvido(aux);
      return aux;
    };
    const a = await montarDevolvido(7100, '93541134780', 'LOT1A01');
    const b = await montarDevolvido(7101, '12345678062', 'LOT1A02');
    const c = await montarDevolvido(7102, '98765432029', 'LOT1A03');
    const pend = direta.devolucoesPendentes().map(p => p.id);
    assert.ok([a, b, c].every(id => pend.includes(id)));
    let n = 0;
    const r = await trocar(sefaz, 'autorizar', async (amb, xml) => {
      n++;
      if (n === 2) return { cStatLote: '104', cStat: '999', xMotivo: 'Recusa de teste' };
      return { cStat: '100', xMotivo: 'Autorizado', nProt: '13526000000' + n, nfeProc: '<nfeProc>' + xml.match(/<nNF>\d+<\/nNF>/)[0] + '</nfeProc>' };
    }, () => direta.emitirDevolucoes({ ids: [a, b, c], senha: 'abc123', confirmar: true, confirmarProducao: true }));
    assert.equal(r.emitidas, 1);
    assert.equal(r.resultados.length, 2, 'parou na recusa, a terceira não foi enviada');
    assert.equal(r.resultados[1].ok, false);
    assert.equal(n, 2);
    const pendDepois = direta.devolucoesPendentes().map(p => p.id);
    assert.ok(!pendDepois.includes(a) && pendDepois.includes(b) && pendDepois.includes(c));
  } finally { delete process.env.NFE_AMBIENTE; }
});

test('contrato de repasse com o carro em estoque: comprador, preço, desconto e pagamento salvos no carro', () => {
  const contratos = require('../contratos');
  const id = carro();
  db.salvarRascunhoRepasse(id, { comprador: { nome: 'GUSTAVO HENRIQUE DE OLIVEIRA', cpf: '418.203.648-44', rg: '48984807', endereco: 'Rua Guerino Ferrucci', numero: '26', bairro: 'Jardim Carolina', cidade: 'Jaú', uf: 'sp', cep: '17207-740' }, preco: 5490000, desconto: 590000, km: 148225, despesas: 'comprador', data: '2026-11-27T15:03' });
  let html = contratos.gerarContrato(id, 'repasse').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(html.includes('GUSTAVO HENRIQUE DE OLIVEIRA') && html.includes('418.203.648-44'));
  assert.ok(html.includes('R$ 54.900,00') && html.includes('R$ 5.900,00') && html.includes('R$ 49.000,00'));
  assert.ok(html.includes('148.225') && html.includes('a cargo do COMPRADOR'));
  assert.ok(!html.includes('VENDEDORA'));
  db.salvarRascunhoRepasse(id, { ...db.obterRascunhoRepasse(id), pagamento: 'PIX R$ 10.000 + dinheiro R$ 5.000 + financiamento R$ 34.000' });
  html = contratos.gerarContrato(id, 'repasse').replace(/<[^>]+>/g, ' ');
  assert.ok(html.includes('PIX R$ 10.000 + dinheiro R$ 5.000 + financiamento R$ 34.000'));
  assert.throws(() => db.salvarRascunhoRepasse(id, { preco: 100, desconto: 200 }), /desconto/);
});
