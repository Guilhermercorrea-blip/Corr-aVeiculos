'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
process.env.PASTA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'correa-ficha-test-'));
const db = require('../db');
const nfe = require('../nfe');

const FICHA = { motor: 'ABC123456', potencia: 80, cilindrada: 1400, peso: '1.5', cmt: '1.9', eixos: 2, combustivel: '16', tipo: '06', especie: '1', lotacao: 5, cor: '10', pintura: 'S', marca_modelo: '1' };
const dono = { nome: 'Fulana de Teste', cpf: '11144477735', endereco: 'Rua das Flores', numero: '10', bairro: 'Centro', cidade: 'Barra Bonita', uf: 'SP', cep: '17340000' };
const carro = { marca_modelo: 'GM Meriva Joy 1.4', ano_fab: 2011, ano_mod: 2011, cor: 'Prata', placa: 'REQ1A23', renavam: '00123456789', chassi: '9BGXL75XBC0000000', tipo_entrada: 'consignacao', valor_compra: 3400000 };

test('os dados do CRLV (aba Veículo Novo) são exigidos e vão em TODAS as notas, e ficam guardados no carro', async () => {
  const { id } = db.criarCompra({ pessoa: dono, veiculo: carro });
  await assert.rejects(nfe.gerarNota(id, 'entrada_consignacao', { numero: 1300, ncm: '87032100', valor: 100 }), /motor/);

  const r = await nfe.gerarNota(id, 'entrada_consignacao', { ficha: FICHA, numero: 1300, ncm: '87032100', valor: 3400000, data: '2026-11-19T10:00', xml: true });
  const linhas = r.conteudo.split('\r\n');
  assert.ok(linhas.includes('J|3|9BGXL75XBC0000000|10|PRATA|80|1400|1.5000|1.5000|1|16|ABC123456|1.9000|2|2011|2011|S|06|1|N|1|1|10|5|0|'));
  const esperado = '<veicProd><tpOp>3</tpOp><chassi>9BGXL75XBC0000000</chassi><cCor>10</cCor><xCor>PRATA</xCor><pot>80</pot><cilin>1400</cilin>' +
    '<pesoL>1.5000</pesoL><pesoB>1.5000</pesoB><nSerie>1</nSerie><tpComb>16</tpComb><nMotor>ABC123456</nMotor><CMT>1.9000</CMT><dist>2</dist>' +
    '<anoMod>2011</anoMod><anoFab>2011</anoFab><tpPint>S</tpPint><tpVeic>06</tpVeic><espVeic>1</espVeic><VIN>N</VIN><condVeic>1</condVeic>' +
    '<cMod>1</cMod><cCorDENATRAN>10</cCorDENATRAN><lota>5</lota><tpRest>0</tpRest></veicProd></prod>';
  assert.ok(r.xml.includes(esperado), 'XML sem o grupo veicProd no lugar certo');

  // ficou guardado no carro: a próxima nota (devolução) já sai sem digitar de novo
  assert.equal(nfe.sugestao(id, 'devolucao_consignacao').ficha.motor, 'ABC123456');
  const dev = await nfe.gerarNota(id, 'devolucao_consignacao', { numero: 1301, ncm: '87032100', valor: 3400000, data: '2026-11-19T11:00', referencia: r.chave });
  assert.ok(dev.conteudo.split('\r\n').some(l => l.startsWith('J|3|9BGXL75XBC0000000|')));
});

test('entrada de compra e devolução de compra também levam os dados do CRLV', async () => {
  const { id } = db.criarCompra({ pessoa: { ...dono, cpf: '39053344705' }, veiculo: { ...carro, placa: 'REQ1A24', tipo_entrada: 'compra' } });
  await assert.rejects(nfe.gerarNota(id, 'entrada_compra', { numero: 1310, ncm: '87032100', valor: 100 }), /motor/);
  const e = await nfe.gerarNota(id, 'entrada_compra', { ficha: FICHA, numero: 1310, ncm: '87032100', valor: 2600000, data: '2026-11-19T10:00' });
  assert.ok(e.conteudo.split('\r\n').some(l => l.startsWith('J|3|')));
  const d = await nfe.gerarNota(id, 'devolucao_compra', { numero: 1311, ncm: '87032100', valor: 2600000, data: '2026-11-19T11:00', referencia: e.chave });
  assert.ok(d.conteudo.split('\r\n').some(l => l.startsWith('J|3|')));
});
