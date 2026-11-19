'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const FICHA = { motor: 'ABC123456', potencia: 80, cilindrada: 1400, peso: '1.5', cmt: '1.9', eixos: 2, combustivel: '16', tipo: '06', especie: '1', lotacao: 5, cor: '10', pintura: 'S', marca_modelo: '1' };
process.env.PASTA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'correa-devcompra-test-'));
const db = require('../db');
const nfe = require('../nfe');

const loja = { nome: 'LOJA VENDEDORA TESTE LTDA', cpf: '11222333000181', ie: '111.222.333.444', endereco: 'Av das Lojas', numero: '200', bairro: 'Centro', cidade: 'Barra Bonita', uf: 'SP', cep: '17340000' };
const carro = { marca_modelo: 'VW Fox 1.0', ano_fab: 2012, ano_mod: 2012, cor: 'Prata', placa: 'FOX1A23', renavam: '00347147631', chassi: '9BWAA05Z0C4000001', tipo_entrada: 'compra', valor_compra: 2550000 };
const CHAVE_LOJA = '35260911222333000181550020002810531745567774';

// XML (resumido) de uma nota de VENDA emitida pela loja para a Corrêa
function xmlVendaLoja({ dest = '07793106000139', tpNF = '1', icms = '<ICMS20><orig>0</orig><CST>20</CST><modBC>3</modBC><pRedBC>90.00</pRedBC><vBC>2550.00</vBC><pICMS>18.00</pICMS><vICMS>459.00</vICMS></ICMS20>' } = {}) {
  return `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${CHAVE_LOJA}" versao="4.00"><ide><nNF>281053</nNF><tpNF>${tpNF}</tpNF><dhEmi>2026-09-29T10:00:00-03:00</dhEmi></ide>` +
    '<emit><CNPJ>11222333000181</CNPJ><xNome>LOJA VENDEDORA TESTE LTDA</xNome><enderEmit><xLgr>AV COMENDADOR TESTE</xLgr><nro>200</nro><xBairro>JD TESTE</xBairro><cMun>3548906</cMun><xMun>Sao Carlos</xMun><UF>SP</UF><CEP>13561270</CEP><fone>1621077000</fone></enderEmit><IE>637249930116</IE></emit>' +
    `<dest><CNPJ>${dest}</CNPJ><xNome>CORREA</xNome></dest>` +
    `<det nItem="1"><prod><cProd>60</cProd><xProd>FOX</xProd><NCM>87032210</NCM><CFOP>5102</CFOP><vProd>25500.00</vProd></prod><imposto><ICMS>${icms}</ICMS>` +
    '<PIS><PISAliq><CST>01</CST><vBC>1000.00</vBC><pPIS>0.6500</pPIS><vPIS>6.50</vPIS></PISAliq></PIS><COFINS><COFINSAliq><CST>01</CST><vBC>1000.00</vBC><pCOFINS>3.0000</pCOFINS><vCOFINS>30.00</vCOFINS></COFINSAliq></COFINS></imposto></det>' +
    '<total><ICMSTot><vBC>2550.00</vBC><vICMS>459.00</vICMS><vProd>25500.00</vProd><vPIS>6.50</vPIS><vCOFINS>30.00</vCOFINS><vNF>25500.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>';
}

test('sem o XML da loja: igual às devoluções 1066/1073 (5202, saída, finalidade 4, ICMS 18% sobre 10%, IE da loja)', async () => {
  const { id } = db.criarCompra({ pessoa: loja, veiculo: carro });
  const g = await nfe.gerarNota(id, 'devolucao_compra', { ficha: FICHA, numero: 1095, ncm: '87032210', valor: 2550000, referencia: CHAVE_LOJA, data: '2026-11-19T10:00', xml: true, homologacao: true });
  const l = g.conteudo.split('\r\n');
  assert.ok(l.find(x => x.startsWith('B|')).includes('|DEVOLUÇÃO DE MERCADORIA|55|1|1095|'));
  assert.match(l.find(x => x.startsWith('B|')), /\|\|1\|1\|\d\|2\|4\|\|\|0\|0\|/); // tpNF 1 ... finNFe 4, indFinal 0
  assert.ok(l.includes(`BA02|${CHAVE_LOJA}|`));
  assert.ok(l.includes('E|NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL|1|111222333444||||'));
  assert.ok(l.includes('E02|11222333000181|'));
  assert.ok(l.some(x => x.startsWith('I|') && x.includes('|5202|')));
  assert.ok(l.includes('N04|0|20|3|90.0000|2550.00|18.0000|459.00|||||||'));
  assert.ok(l.includes('Q04|07|') && l.includes('S04|07|'));
  assert.ok(l.includes('X|1|'));
  assert.match(g.xml, /<indIEDest>1<\/indIEDest><IE>111222333444<\/IE>/);
  assert.match(g.xml, /<vBC>2550\.00<\/vBC><pICMS>18\.0000<\/pICMS><vICMS>459\.00<\/vICMS>/);
  assert.match(g.xml, /<tpNF>1<\/tpNF>/);
  assert.match(g.xml, /<finNFe>4<\/finNFe>/);
  assert.match(g.xml, new RegExp(`<NFref><refNFe>${CHAVE_LOJA}</refNFe></NFref>`));
  assert.equal(g.espelho, null);
});

test('com o XML da loja: espelho do ICMS (loja, IE, endereço, chave, valor e ICMS dela; PIS/COFINS 07)', async () => {
  const { id } = db.criarCompra({ pessoa: { ...loja, cpf: '11444777000161' }, veiculo: { ...carro, placa: 'FOX1A24' } });
  const g = await nfe.gerarNota(id, 'devolucao_compra', { ficha: FICHA, numero: 1096, ncm: '87032100', valor: 1, referencia: '', data: '2026-11-19T10:00', xml: true, origemXml: xmlVendaLoja() });
  const l = g.conteudo.split('\r\n');
  assert.ok(l.includes(`BA02|${CHAVE_LOJA}|`), 'referência = chave da nota da loja');
  assert.ok(l.includes('E|LOJA VENDEDORA TESTE LTDA|1|637249930116||||'), 'nome e IE da loja como ela emitiu');
  assert.ok(l.includes('E02|11222333000181|'));
  assert.ok(l.some(x => x.startsWith('E05|AV COMENDADOR TESTE|200||JD TESTE|3548906|Sao Carlos|SP|13561270|')));
  assert.ok(l.some(x => x.startsWith('I|') && x.includes('|87032210|') && x.includes('|25500.00|')), 'NCM e valor da nota da loja');
  assert.ok(l.includes('N04|0|20|3|90.00|2550.00|18.00|459.00|||||||'));
  // Só o ICMS é espelhado (a loja precisa dele para estornar o débito). PIS/COFINS ficam 07, como nas devoluções 1066 e 1073.
  assert.ok(l.includes('Q04|07|') && l.includes('S04|07|'), 'PIS/COFINS 07 mesmo com PIS/COFINS na nota da loja');
  assert.ok(l.includes('W02|2550.00|459.00|' + Array(12).fill('0.00').join('|') + '|25500.00|' + Array(9).fill('0.00').join('|') + '|25500.00|0.00|'));
  assert.ok(g.xml.includes('<PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS>'));
  assert.ok(g.xml.includes('<vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS>'));
  assert.ok(g.xml.includes('<ICMS20><orig>0</orig><CST>20</CST><modBC>3</modBC><pRedBC>90.00</pRedBC><vBC>2550.00</vBC><pICMS>18.00</pICMS><vICMS>459.00</vICMS></ICMS20>'));
  assert.deepEqual({ ...g.espelho }, { chave: CHAVE_LOJA, numero: '281053', loja: 'LOJA VENDEDORA TESTE LTDA', valor: 2550000, vICMS: 45900, vBC: 255000 });
});

test('XML errado ou caso não coberto: avisa e não gera', async () => {
  const { id } = db.criarCompra({ pessoa: { ...loja, cpf: '45723174000110' }, veiculo: { ...carro, placa: 'FOX1A25' } });
  const base = { ficha: FICHA, numero: 1097, ncm: '87032210', valor: 2550000, data: '2026-11-19T10:00' };
  await assert.rejects(nfe.gerarNota(id, 'devolucao_compra', { ...base, origemXml: xmlVendaLoja({ dest: '99999999000191' }) }), /não foi emitida para a Corrêa/);
  await assert.rejects(nfe.gerarNota(id, 'devolucao_compra', { ...base, origemXml: xmlVendaLoja({ tpNF: '0' }) }), /não é de saída/);
  await assert.rejects(nfe.gerarNota(id, 'devolucao_compra', { ...base, origemXml: xmlVendaLoja({ icms: '<ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>25500.00</vBC><pICMS>18.00</pICMS><vICMS>4590.00</vICMS></ICMS00>' }) }), /ICMS00/);
  await assert.rejects(nfe.gerarNota(id, 'devolucao_compra', { ...base, origemXml: '<qualquer/>' }), /não parece o XML/);
});

test('loja de outro estado: CFOP 6202; carro consignado não tem devolução de compra', async () => {
  const { id } = db.criarCompra({ pessoa: { ...loja, cpf: '19131243000197', cidade: 'Belo Horizonte', uf: 'MG', cep: '30110000' }, veiculo: { ...carro, placa: 'FOX1A26' } });
  const g = await nfe.gerarNota(id, 'devolucao_compra', { ficha: FICHA, numero: 1098, ncm: '87032210', valor: 2550000, referencia: CHAVE_LOJA, data: '2026-11-19T10:00' });
  assert.ok(g.conteudo.split('\r\n').some(x => x.startsWith('I|') && x.includes('|6202|')));
  const consig = db.criarCompra({ pessoa: { ...loja, cpf: '04252011000110' }, veiculo: { ...carro, placa: 'FOX1A27', tipo_entrada: 'consignacao' } });
  await assert.rejects(nfe.gerarNota(consig.id, 'devolucao_compra', { ficha: FICHA, numero: 1099, ncm: '87032210', valor: 2550000, referencia: CHAVE_LOJA }), /só para carro comprado/);
});
