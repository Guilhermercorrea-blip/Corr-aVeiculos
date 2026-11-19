'use strict';
// Teste da NF-e direta na SEFAZ-SP, ambiente de HOMOLOGAÇÃO (nada vale como nota).
// Uso: node nfe-teste.js status   -> só pergunta se o serviço está no ar (não emite nada)
// A senha do certificado não aparece na tela, não é gravada e só fica na memória durante o teste.
const os = require('node:os');
const path = require('node:path');
const nfse = require('./nfse');
const sefaz = require('./nfe-sefaz');

const FICHA_TESTE = { motor: 'TESTE12345', potencia: 80, cilindrada: 1400, peso: '1.5', cmt: '1.9', eixos: 2, combustivel: '16', tipo: '06', especie: '1', lotacao: 5, cor: '11', pintura: 'S', marca_modelo: '1' };
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
  console.log(modo === 'cadastro' ? 'Cadastro de empresa na SEFAZ-SP (só leitura) - PRODUÇÃO' : modo === 'graciano' ? 'Nota da Graciano: consulta e, com a sua confirmação, ciência e download - PRODUÇÃO' : modo === 'destinadas' ? 'Consulta (só leitura) de cadastro e NF-e destinadas - PRODUÇÃO' : modo === 'consultar' ? 'Consulta (só leitura) das notas na SEFAZ-SP - PRODUÇÃO' : 'NF-e direto na SEFAZ-SP - ambiente de HOMOLOGAÇÃO (não vale como nota)');
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
    const g = await nfe.gerarNota(id, 'entrada_consignacao', { numero, ncm: '87032100', valor: 3300000, ficha: FICHA_TESTE, homologacao: true, xml: true });
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
    const g = await nfe.gerarNota(id, 'devolucao_compra', { numero, ncm: '87032210', valor: 2550000, ficha: FICHA_TESTE, homologacao: true, xml: true, origemXml });
    console.log('Devolução de TESTE nº', numero, '| espelho:', JSON.stringify(g.espelho));
    const r = await sefaz.autorizar('homologacao', sefaz.assinarNfe(g.xml, g.chave, cert), cert);
    console.log('Lote: cStat', r.cStatLote, '|', r.xMotivoLote);
    console.log('Nota: cStat', r.cStat, '|', r.xMotivo, r.nProt ? '| protocolo ' + r.nProt : '');
    if (r.bruto) console.log(r.bruto);
    console.log(r.cStat === '100' ? 'AUTORIZADA em homologação (sem valor fiscal).' : 'Não autorizou: me mostre esta tela.');
  }
  if (modo === 'destinadas') {
    // SÓ LEITURA, produção. (1) IE e endereço oficiais da Graciano; (2) NF-e emitidas contra o CNPJ da loja desde setembro/2026
    const CNPJ_LOJA = '07793106000139', GRACIANO = '43952001000149';
    const cad = await sefaz.consultarCadastro(GRACIANO, cert);
    console.log('Cadastro da Graciano: cStat', cad.cStat, '|', cad.xMotivo);
    console.log(JSON.stringify({ ie: cad.ie, nome: cad.nome, situacao: cad.situacao, endereco: cad.endereco }));
    const d = await sefaz.distribuicaoDFe(CNPJ_LOJA, cert);
    console.log('Distribuição de DF-e: cStat', d.cStat, '|', d.xMotivo, '| documentos lidos:', d.docs.length, '| NSU', d.ultNSU, '/', d.maxNSU);
    const nfes = d.docs.filter(x => x.chave && x.dhEmi >= '2026-09-01');
    for (const x of nfes) console.log(' ', x.dhEmi.slice(0, 10), '|', x.emitNome, '| CNPJ', x.emitCnpj, '| R$', x.vNF, '| tpNF', x.tpNF, '| situação', x.cStat, '| chave', x.chave);
    const g = nfes.filter(x => x.emitCnpj === GRACIANO);
    console.log(g.length ? 'ACHEI NF-e da Graciano para a loja: ' + g.length : 'NENHUMA NF-e da Graciano contra a loja nos documentos lidos.');
  }
  if (modo === 'graciano') {
    // Acha a NF-e de venda da Graciano contra a loja, e (só se você confirmar aqui) registra a Ciência da Operação,
    // baixa o XML completo e gera o DANFE para mandar ao contador. Salva em Desktop\NotasSites.
    const fs = require('node:fs');
    const readline = require('node:readline');
    const danfe = require('./danfe');
    const CNPJ_LOJA = '07793106000139', GRACIANO = '43952001000149';
    const perguntar = texto => new Promise(resolve => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(texto, r => { rl.close(); resolve(r.trim().toLowerCase()); }); });

    const cad = await sefaz.consultarCadastro(GRACIANO, cert);
    console.log('Cadastro da Graciano: cStat', cad.cStat, '|', cad.xMotivo);
    console.log('  IE', cad.ie, '|', cad.nome, '| situação', cad.situacao, '|', JSON.stringify(cad.endereco));
    fs.writeFileSync(path.join(__dirname, '..', 'nfse-api', 'graciano-cadastro.json'), JSON.stringify(cad, null, 2));

    const d = await sefaz.distribuicaoDFe(CNPJ_LOJA, cert);
    console.log('Distribuição de DF-e: cStat', d.cStat, '|', d.xMotivo, '| documentos lidos:', d.docs.length);
    const nfes = d.docs.filter(x => x.chave && x.dhEmi >= '2026-09-01');
    for (const x of nfes) console.log(' ', x.dhEmi.slice(0, 10), '|', x.emitNome, '| R$', x.vNF, '| tpNF', x.tpNF, '| chave', x.chave);
    const g = nfes.filter(x => x.emitCnpj === GRACIANO);
    if (!g.length) { console.log('NENHUMA NF-e da Graciano contra a loja nos documentos lidos. Nada foi alterado.'); return; }
    const nota = g[g.length - 1];
    console.log(`\nNota da Graciano: emitida em ${nota.dhEmi.slice(0, 10)}, valor R$ ${nota.vNF}, chave ${nota.chave}`);
    const r = await perguntar('Registrar a "Ciência da Operação" desta nota (evento oficial, sem efeito fiscal) e baixar o XML? (s/n) ');
    if (r !== 's') { console.log('Nada foi registrado.'); return; }

    const c = await sefaz.registrarCiencia(nota.chave, CNPJ_LOJA, cert);
    console.log('Ciência: lote', c.cStatLote, c.xMotivoLote, '| evento', c.cStat, c.xMotivo, c.nProt ? '| protocolo ' + c.nProt : '');
    if (!c.ok) { console.log('A Receita não registrou a ciência. Me mostre esta tela.'); if (c.bruto) console.log(c.bruto); return; }
    await new Promise(r2 => setTimeout(r2, 4000));
    const b = await sefaz.baixarNFe(nota.chave, CNPJ_LOJA, cert);
    console.log('Download: cStat', b.cStat, '|', b.xMotivo);
    if (!b.xml) { console.log(b.soResumo ? 'A Receita ainda devolveu só o resumo. Rode de novo em alguns minutos.' : 'Não veio o XML completo. Me mostre esta tela.'); return; }
    const info = danfe.lerNota(b.xml);
    const pasta = path.join(os.homedir(), 'Desktop', 'NotasSites');
    fs.mkdirSync(pasta, { recursive: true });
    const base = `NFe-recebida-${info.numero}-GRACIANO`;
    fs.writeFileSync(path.join(pasta, base + '.xml'), b.xml);
    fs.writeFileSync(path.join(pasta, base.replace('NFe-recebida', 'DANFE-recebida') + '.html'), danfe.gerarDanfe(b.xml));
    console.log('\nSalvo em', pasta);
    console.log('  XML   :', base + '.xml');
    console.log('  DANFE :', base.replace('NFe-recebida', 'DANFE-recebida') + '.html (abra e use "Imprimir / Salvar PDF")');
    console.log(`  Nota nº ${info.numero}, valor R$ ${info.tot.vNF}, protocolo ${info.protocolo}, item: ${info.itens[0]?.descricao?.slice(0, 70)}`);
  }
  if (modo === 'cadastro') {
    // SÓ LEITURA: IE, razão social e endereço oficiais de uma empresa pelo CNPJ (para a nota de entrada)
    const fs = require('node:fs');
    const cnpj = String(process.argv[3] || '').replace(/\D/g, '');
    if (cnpj.length !== 14) throw new Error('Use: node nfe-teste.js cadastro <CNPJ>');
    const cad = await sefaz.consultarCadastro(cnpj, cert);
    console.log('Cadastro: cStat', cad.cStat, '|', cad.xMotivo);
    console.log('  IE', cad.ie, '|', cad.nome, '| situação', cad.situacao);
    console.log('  ', JSON.stringify(cad.endereco));
    fs.writeFileSync(path.join(__dirname, '..', 'nfse-api', 'cadastro-' + cnpj + '.json'), JSON.stringify(cad, null, 2));
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
