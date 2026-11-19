'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const FICHA = { motor: 'ABC123456', potencia: 80, cilindrada: 1400, peso: '1.5', cmt: '1.9', eixos: 2, combustivel: '16', tipo: '06', especie: '1', lotacao: 5, cor: '10', pintura: 'S', marca_modelo: '1' };
process.env.PASTA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'correa-crv-test-'));
const db = require('../db');
const nfe = require('../nfe');
const contratos = require('../contratos');

const entrega = { nome: 'Fulano Entrega Silva', cpf: '52998224725', endereco: 'Rua das Flores', numero: '10', bairro: 'Centro', cidade: 'Barra Bonita', uf: 'SP', cep: '17340000' };
const donoCrv = { nome: 'Beltrano Dono Documento', cpf: '11144477735', endereco: 'Rua das Flores', numero: '10', bairro: 'Centro', cidade: 'Barra Bonita', uf: 'SP', cep: '17340000' };
const carro = { marca_modelo: 'Chevrolet Classic LS', ano_fab: 2011, ano_mod: 2012, cor: 'Preta', placa: 'EYH4910', renavam: '00351150846', chassi: '9BGSU19F0CB108910', tipo_entrada: 'consignacao', valor_compra: 3300000 };

test('CRV em nome de outra pessoa: guarda as duas e a nota sai no nome de quem está no CRV', async () => {
  const { id } = db.criarCompra({ pessoa: entrega, veiculo: carro, proprietario_crv: donoCrv });
  const d = db.obterVeiculo(id);
  assert.equal(d.fornecedor.nome, 'Fulano Entrega Silva');
  assert.equal(d.proprietarioCrv.nome, 'Beltrano Dono Documento');
  const r = await nfe.gerarEntradaConsignacao(id, { ficha: FICHA, numero: 1085, ncm: '87032100', valor: 3300000, data: '2026-11-18T17:23' });
  assert.match(r.conteudo, /\r\nE\|BELTRANO DONO DOCUMENTO\|/);
  assert.match(r.conteudo, /\r\nE03\|11144477735\|/);
  assert.ok(!/FULANO ENTREGA/.test(r.conteudo));
  assert.match(r.chave, /^35\d{4}07793106000139550010000010851\d{9}$/);
});

test('contrato de consignação: consignante é quem entrega, CRV mostra o outro, com a cláusula da procuração', () => {
  const { id } = db.criarCompra({ pessoa: { ...entrega, cpf: '39053344705' }, veiculo: { ...carro, placa: 'ABC1D23', renavam: '11111111111', chassi: '9BGSU19F0CB100000' }, proprietario_crv: donoCrv });
  const html = contratos.gerarContrato(id, 'consignacao').html || contratos.gerarContrato(id, 'consignacao');
  const texto = String(html);
  assert.match(texto, /Fulano Entrega Silva/);
  assert.match(texto, /Proprietário no CRV\/ATPV-e/);
  assert.match(texto, /Beltrano Dono Documento/);
  assert.match(texto, /111\.444\.777-35/);
  assert.match(texto, /Procuração/);
  assert.match(texto, /Consignante/);
});

test('sem procuração, nada muda: nota e contrato seguem o dono do cadastro', async () => {
  const { id } = db.criarCompra({ pessoa: { ...entrega, cpf: '16899535009' }, veiculo: { ...carro, placa: 'XYZ9K88', renavam: '22222222222', chassi: '9BGSU19F0CB200000' } });
  assert.equal(db.obterVeiculo(id).proprietarioCrv, null);
  const r = await nfe.gerarEntradaConsignacao(id, { ficha: FICHA, numero: 1090, ncm: '87032100', valor: 3300000, data: '2026-11-18T17:23' });
  assert.match(r.conteudo, /\r\nE\|FULANO ENTREGA SILVA\|/);
  const texto = String(contratos.gerarContrato(id, 'consignacao').html || contratos.gerarContrato(id, 'consignacao'));
  assert.ok(!/Procuração/.test(texto));
  assert.match(texto, /Consignante \/ Proprietário/);
});

test('editar o carro e informar o proprietário do CRV depois', () => {
  const { id } = db.criarCompra({ pessoa: { ...entrega, cpf: '45317828791' }, veiculo: { ...carro, placa: 'KKK1A11', renavam: '33333333333', chassi: '9BGSU19F0CB300000' } });
  db.atualizarVeiculo(id, { veiculo: { placa: 'KKK1A12' }, proprietario_crv: donoCrv });
  const d = db.obterVeiculo(id);
  assert.equal(d.veiculo.placa, 'KKK1A12');
  assert.equal(d.proprietarioCrv.cpf, '11144477735');
});
