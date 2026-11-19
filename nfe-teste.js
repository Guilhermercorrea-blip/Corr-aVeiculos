'use strict';
// Teste da NF-e direta na SEFAZ-SP, ambiente de HOMOLOGAÇÃO (nada vale como nota).
// Uso: node nfe-teste.js status   -> só pergunta se o serviço está no ar (não emite nada)
// A senha do certificado não aparece na tela, não é gravada e só fica na memória durante o teste.
const os = require('node:os');
const path = require('node:path');
const nfse = require('./nfse');
const sefaz = require('./nfe-sefaz');

const PFX = process.env.NFSE_PFX || 'D:/Formatar/CertificadoCorrea.pfx';

function pedirSenha(texto) {
  return new Promise(resolve => {
    process.stdout.write(texto);
    const stdin = process.stdin;
    let senha = '';
    stdin.setRawMode && stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const ao = ch => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { stdin.setRawMode && stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', ao); process.stdout.write('\n'); return resolve(senha); }
        if (c === '\u0003') process.exit(1);
        if (c === '\u007f' || c === '\b') { if (senha) { senha = senha.slice(0, -1); process.stdout.write('\b \b'); } } else { senha += c; process.stdout.write('*'); }
      }
    };
    stdin.on('data', ao);
  });
}

(async () => {
  const modo = process.argv[2] || 'status';
  console.log(modo === 'consultar' ? 'Consulta (só leitura) das notas na SEFAZ-SP - PRODUÇÃO' : 'NF-e direto na SEFAZ-SP - ambiente de HOMOLOGAÇÃO (não vale como nota)');
  console.log('Certificado:', PFX);
  const cert = nfse.carregarCertificado(PFX, await pedirSenha('Senha do certificado (aparece *): '));
  console.log('Certificado aberto. Válido até', cert.validade);
  if (modo === 'status') {
    const r = await sefaz.statusServico('homologacao', cert);
    console.log('Resposta da SEFAZ: HTTP', r.http, '| cStat', r.cStat, '|', r.xMotivo, '| tempo médio', r.tMed, 's');
    if (r.bruto) console.log(r.bruto);
    console.log(r.cStat === '107' ? 'OK: o certificado conversa com a SEFAZ-SP.' : 'Algo diferente do esperado (107). Me mostre esta tela.');
  }
  if (modo === 'emitir') {
    // Banco temporário com um carro e uma pessoa de mentira: não toca nos dados da loja
    const fs = require('node:fs');
    process.env.PASTA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'nfe-homolog-'));
    const db = require('./db');
    const nfe = require('./nfe');
    const pessoa = { nome: 'Teste Homologacao', cpf: '52998224725', endereco: 'Rua das Flores', numero: '10', bairro: 'Centro', cidade: 'Barra Bonita', uf: 'SP', cep: '17340000' };
    const veiculo = { marca_modelo: 'CARRO DE TESTE', ano_fab: 2011, ano_mod: 2012, cor: 'Preta', placa: 'TST1A23', renavam: '12345678901', chassi: '9BGSU19F0CB000001', tipo_entrada: 'consignacao', valor_compra: 3300000 };
    const { id } = db.criarCompra({ pessoa, veiculo });
    const numero = 800000000 + (Math.floor(Date.now() / 1000) % 100000000);
    const g = await nfe.gerarNota(id, 'entrada_consignacao', { numero, ncm: '87032100', valor: 3300000, homologacao: true, xml: true });
    const assinada = sefaz.assinarNfe(g.xml, g.chave, cert);
    console.log('Nota de teste nº', numero, '| chave', g.chave);
    const r = await sefaz.autorizar('homologacao', assinada, cert);
    console.log('Lote: cStat', r.cStatLote, '|', r.xMotivoLote);
    console.log('Nota: cStat', r.cStat, '|', r.xMotivo, r.nProt ? '| protocolo ' + r.nProt : '');
    if (r.bruto) console.log(r.bruto);
    const saida = path.join(__dirname, '..', 'nfse-api');
    fs.writeFileSync(path.join(saida, 'nfe-homolog-enviada.xml'), assinada);
    fs.writeFileSync(path.join(saida, 'nfe-homolog-resposta.json'), JSON.stringify(r, null, 2));
    if (r.nfeProc) fs.writeFileSync(path.join(saida, `nfe-homolog-${numero}-autorizada.xml`), r.nfeProc);
    console.log(r.cStat === '100' ? 'AUTORIZADA em homologação (sem valor fiscal).' : 'Não autorizou: me mostre esta tela.');
  }
  if (modo === 'consultar') {
    // Só leitura, em PRODUÇÃO: situação das notas emitidas pelo Emissor do Sebrae (lista em nfse-api/chaves-emissor.txt)
    const fs = require('node:fs');
    const linhas = fs.readFileSync(path.join(__dirname, '..', 'nfse-api', 'chaves-emissor.txt'), 'utf8').split(String.fromCharCode(10)).map(x => x.trim()).filter(Boolean);
    for (const l of linhas) {
      const [numero, chave] = l.split(' ');
      const r = await sefaz.consultarChave('producao', chave, cert);
      const ev = r.eventos.map(e => e.descEvento + (e.cStat ? ' (' + e.cStat + ')' : '')).join(', ');
      console.log('Nota', Number(numero), '| cStat', r.cStat, '|', r.xMotivo, r.protocolo ? '| protocolo ' + r.protocolo + ' em ' + (r.autorizadaEm || '').slice(0, 16) : '', ev ? '| eventos: ' + ev : '');
      if (r.bruto) console.log(r.bruto);
    }
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
