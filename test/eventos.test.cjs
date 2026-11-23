'use strict';
// Cancelamento e carta de correção das notas da loja (SEFAZ simulada)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
process.env.PASTA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'correa-eventos-test-'));

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'eventos-cert-'));
let temOpenssl = true;
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(pasta, 'k.pem'), '-out', path.join(pasta, 'c.pem'), '-days', '2', '-subj', '/CN=TESTE'], { stdio: 'pipe' });
  execFileSync('openssl', ['pkcs12', '-export', '-inkey', path.join(pasta, 'k.pem'), '-in', path.join(pasta, 'c.pem'), '-out', path.join(pasta, 'c.pfx'), '-passout', 'pass:abc123'], { stdio: 'pipe' });
  process.env.NFSE_PFX = path.join(pasta, 'c.pfx');
} catch { temOpenssl = false; }

const db = require('../db');
const nfe = require('../nfe');
const sefaz = require('../nfe-sefaz');
const eventos = require('../nfe-eventos');
const direta = require('../nfe-direta');
const notasMes = require('../notas-mes');

const FICHA = { motor: 'ABC123456', potencia: 80, cilindrada: 1400, peso: '1.5', cmt: '1.9', eixos: 2, combustivel: '16', tipo: '06', especie: '1', lotacao: 5, cor: '10', pintura: 'S', marca_modelo: '1' };
const CPFS = ['52998224725', '11144477735', '39053344705', '16899535009'];
let i = 0;
async function notaAutorizada(numero, dhRecbto) {
  const { id } = db.criarCompra({
    pessoa: { nome: 'Fulana', cpf: CPFS[i++], endereco: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'Barra Bonita', uf: 'SP', cep: '17340000' },
    veiculo: { marca_modelo: 'GM Meriva', ano_fab: 2011, ano_mod: 2011, cor: 'Prata', placa: `EVT1A0${i}`, chassi: '9BGXL75XBC0000000', tipo_entrada: 'consignacao', valor_compra: 3400000 },
  });
  const g = await nfe.gerarNota(id, 'entrada_consignacao', { ficha: FICHA, numero, ncm: '87032210', valor: 3400000, data: '2026-11-20T10:00', xml: true });
  const prot = `<protNFe versao="4.00"><infProt><tpAmb>1</tpAmb><chNFe>${g.chave}</chNFe><dhRecbto>${dhRecbto}</dhRecbto><nProt>13526500000${numero}</nProt><cStat>100</cStat><xMotivo>Autorizado</xMotivo></infProt></protNFe>`;
  db.conexao.prepare('UPDATE nfe_notas SET xml_autorizado = ?, protocolo = ? WHERE numero = ?')
    .run(`<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe xmlns="http://www.portalfiscal.inf.br/nfe">${g.xml}</NFe>${prot}</nfeProc>`, `13526500000${numero}`, numero);
  return { veiculo: id, nota: db.conexao.prepare('SELECT id FROM nfe_notas WHERE numero = ?').get(numero).id, chave: g.chave };
}
const agoraMenos = horas => new Date(Date.now() - horas * 3600e3 - 3 * 3600e3).toISOString().slice(0, 19) + '-03:00';
const retorno = (cStat, chave, tp) => `<retEnvEvento><cStat>128</cStat><retEvento versao="1.00"><infEvento><tpAmb>1</tpAmb><cOrgao>35</cOrgao><cStat>${cStat}</cStat><xMotivo>Evento registrado</xMotivo><chNFe>${chave}</chNFe><tpEvento>${tp}</tpEvento><nProt>135265000099999</nProt></infEvento></retEvento></retEnvEvento>`;
async function comSefaz(cStat, fn) {
  const o = sefaz.chamar;
  let enviado = null;
  sefaz.chamar = async (amb, serv, corpo) => { enviado = { amb, serv, corpo }; return { status: 200, xml: retorno(cStat, (corpo.match(/<chNFe>(\d{44})/) || [])[1], (corpo.match(/<tpEvento>(\d+)/) || [])[1]) }; };
  try { return { r: await fn(), enviado }; } finally { sefaz.chamar = o; }
}

test('evento de cancelamento: formato do leiaute (SEFAZ-SP, cOrgao 35, nProt e justificativa sem acento)', () => {
  const { id, inf } = eventos.montarEvento({ tipo: 'cancelamento', chave: '3'.repeat(44), seq: 1, ambiente: 'producao', protocolo: '135265000000001', texto: eventos.textoSefaz('Nota emitida com o valor errado'), agora: new Date('2026-11-20T15:00:00Z') });
  assert.equal(id, 'ID110111' + '3'.repeat(44) + '01');
  assert.match(inf, /<cOrgao>35<\/cOrgao><tpAmb>1<\/tpAmb><CNPJ>07793106000139<\/CNPJ>/);
  assert.match(inf, /<dhEvento>2026-11-20T12:00:00-03:00<\/dhEvento><tpEvento>110111<\/tpEvento><nSeqEvento>1<\/nSeqEvento>/);
  assert.match(inf, /<descEvento>Cancelamento<\/descEvento><nProt>135265000000001<\/nProt><xJust>Nota emitida com o valor errado<\/xJust>/);
  const c = eventos.montarEvento({ tipo: 'cce', chave: '3'.repeat(44), seq: 2, ambiente: 'producao', texto: 'Bairro correto: Jardim Jorge Atalla' });
  assert.match(c.inf, /<tpEvento>110110<\/tpEvento><nSeqEvento>2<\/nSeqEvento>.*<descEvento>Carta de Correcao<\/descEvento><xCorrecao>Bairro correto: Jardim Jorge Atalla<\/xCorrecao><xCondUso>A Carta de Correcao e disciplinada/);
  assert.equal(eventos.textoSefaz('  Correção: ÁGUA   e  café '), 'Correcao: AGUA e cafe');
});

test('cancelar dentro de 24 h: registra, marca a nota cancelada, PDF com a marca e ZIP com o XML do cancelamento', async t => {
  if (!temOpenssl) return t.skip('sem openssl');
  const n = await notaAutorizada(9500, agoraMenos(2));
  assert.equal(eventos.situacao(n.nota).podeCancelar, true);
  await assert.rejects(eventos.cancelar(n.nota, { justificativa: 'curta', senha: 'abc123', confirmar: true }), /15 letras/);
  await assert.rejects(eventos.cancelar(n.nota, { justificativa: 'Nota emitida com o valor errado', senha: 'abc123' }), /Confirme/);
  const { r, enviado } = await comSefaz('135', () => eventos.cancelar(n.nota, { justificativa: 'Nota emitida com o valor errado', senha: 'abc123', confirmar: true }));
  assert.equal(enviado.serv, 'eventoSP');
  assert.equal(enviado.amb, 'producao');
  assert.match(enviado.corpo, /<envEvento xmlns="http:\/\/www.portalfiscal.inf.br\/nfe" versao="1.00"><idLote>\d+<\/idLote><evento /);
  assert.match(enviado.corpo, /<Signature xmlns="http:\/\/www.w3.org\/2000\/09\/xmldsig#">/);
  assert.equal(r.protocolo, '135265000099999');
  const s = eventos.situacao(n.nota);
  assert.equal(s.cancelada, true);
  assert.equal(s.podeCancelar, false);
  const nota = direta.notasDoCarro(n.veiculo)[0];
  assert.equal(nota.cancelada, true);
  assert.ok(eventos.xmlDoEvento(r.id).conteudo.includes('<procEventoNFe'));
  // PDF com a marca CANCELADA
  const xml = db.conexao.prepare('SELECT xml_autorizado x FROM nfe_notas WHERE id = ?').get(n.nota).x;
  assert.ok(require('../danfe-pdf').gerarDanfePdf(xml, { cancelada: true }).pdf.toString('latin1').includes('(CANCELADA)'));
  // ZIP do mês leva o XML do cancelamento e o resumo diz CANCELADA
  const arquivos = notasMes.lerZip(notasMes.zipDoMes('2026-11').zip);
  assert.ok(arquivos.some(f => /NFe-9500-.*-cancelamento\.xml$/.test(f.nome)));
  assert.ok(arquivos.find(f => f.nome === 'resumo.csv').dados.toString('utf8').includes('CANCELADA'));
  // não cancela de novo
  await assert.rejects(eventos.cancelar(n.nota, { justificativa: 'Nota emitida com o valor errado', senha: 'abc123', confirmar: true }), /já está cancelada/);
});

test('depois de 24 h não cancela; carta de correção numera em sequência e recusa da SEFAZ fica registrada', async t => {
  if (!temOpenssl) return t.skip('sem openssl');
  const n = await notaAutorizada(9501, agoraMenos(30));
  assert.equal(eventos.situacao(n.nota).podeCancelar, false);
  await assert.rejects(eventos.cancelar(n.nota, { justificativa: 'Nota emitida com o valor errado', senha: 'abc123', confirmar: true }), /24 horas/);
  const a = await comSefaz('135', () => eventos.cartaCorrecao(n.nota, { texto: 'Onde se le bairro Centro, leia-se Jardim Jorge Atalla', senha: 'abc123' }));
  assert.equal(a.r.seq, 1);
  const b = await comSefaz('135', () => eventos.cartaCorrecao(n.nota, { texto: 'Onde se le cor Prata, leia-se Branca, conforme CRLV', senha: 'abc123' }));
  assert.equal(b.r.seq, 2);
  assert.match(b.enviado.corpo, /<nSeqEvento>2<\/nSeqEvento>/);
  await comSefaz('573', () => assert.rejects(eventos.cartaCorrecao(n.nota, { texto: 'Mais uma correcao de teste aqui', senha: 'abc123' }), /SEFAZ recusou: 573/));
  assert.equal(eventos.eventosDaNota(n.nota).length, 2);
  assert.match(eventos.paginaCce(a.r.id), /CARTA DE CORREÇÃO ELETRÔNICA[\s\S]*Jardim Jorge Atalla/);
});
