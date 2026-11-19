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
  if (modo === 'devolucao') {
    // Devolução de compra ESPELHADA, em homologação: loja de teste com os dados da JAVEP (empresa, da nota 1066),
    // XML de venda montado só para o teste (mesmo ICMS da 1066 e PIS/COFINS de exemplo). Banco temporário.
    const fs = require('node:fs');
    process.env.PASTA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'nfe-homolog-dev-'));
    const db = require('./db');
    const nfe = require('./nfe');
    const ref = '35260950752211000230550020002810531745567770';
    const origemXml = `<nfeProc><NFe><infNFe Id="NFe${ref}" versao="4.00"><ide><nNF>281053</nNF><tpNF>1</tpNF></ide>` +
      '<emit><CNPJ>50752211000230</CNPJ><xNome>JAVEP VEICULOS PECAS E SERVICOS LTDA</xNome><enderEmit><xLgr>AV COMENDADOR ALFREDO MAFFEI</xLgr><nro>200</nro><xBairro>JD GIBERTONI</xBairro><cMun>3548906</cMun><xMun>Sao Carlos</xMun><UF>SP</UF><CEP>13561270</CEP><fone>162107700</fone></enderEmit><IE>637249930116</IE></emit>' +
      '<dest><CNPJ>07793106000139</CNPJ></dest><det nItem="1"><prod><NCM>87032210</NCM><vProd>25500.00</vProd></prod><imposto>' +
      '<ICMS><ICMS20><orig>0</orig><CST>20</CST><modBC>3</modBC><pRedBC>90.00</pRedBC><vBC>2550.00</vBC><pICMS>18.00</pICMS><vICMS>459.00</vICMS></ICMS20></ICMS>' +
      '<PIS><PISAliq><CST>01</CST><vBC>1000.00</vBC><pPIS>0.6500</pPIS><vPIS>6.50</vPIS></PISAliq></PIS><COFINS><COFINSAliq><CST>01</CST><vBC>1000.00</vBC><pCOFINS>3.0000</pCOFINS><vCOFINS>30.00</vCOFINS></COFINSAliq></COFINS></imposto></det>' +
      '<total><ICMSTot><vBC>2550.00</vBC><vICMS>459.00</vICMS><vPIS>6.50</vPIS><vCOFINS>30.00</vCOFINS><vNF>25500.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>';
    const { id } = db.criarCompra({ pessoa: { nome: 'JAVEP VEICULOS PECAS E SERVICOS LTDA', cpf: '50752211000230', endereco: 'AV COMENDADOR ALFREDO MAFFEI', numero: '200', bairro: 'JD GIBERTONI', cidade: 'Sao Carlos', uf: 'SP', cep: '13561270' },
      veiculo: { marca_modelo: 'CARRO DE TESTE FOX', ano_fab: 2012, ano_mod: 2012, cor: 'Prata', placa: 'TST1A23', chassi: '9BWAA05Z0C4000001', tipo_entrada: 'compra', valor_compra: 2550000 } });
    const numero = 800000000 + (Math.floor(Date.now() / 1000) % 100000000);
    const g = await nfe.gerarNota(id, 'devolucao_compra', { numero, ncm: '87032210', valor: 2550000, homologacao: true, xml: true, origemXml });
    console.log('Devolução de TESTE nº', numero, '| espelho:', JSON.stringify(g.espelho));
    const r = await sefaz.autorizar('homologacao', sefaz.assinarNfe(g.xml, g.chave, cert), cert);
    console.log('Lote: cStat', r.cStatLote, '|', r.xMotivoLote);
    console.log('Nota: cStat', r.cStat, '|', r.xMotivo, r.nProt ? '| protocolo ' + r.nProt : '');
    if (r.bruto) console.log(r.bruto);
    console.log(r.cStat === '100' ? 'AUTORIZADA em homologação (sem valor fiscal).' : 'Não autorizou: me mostre esta tela.');
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
