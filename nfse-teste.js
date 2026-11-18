'use strict';
// Teste da emissão de NFS-e no AMBIENTE DE TESTES da Receita (nada disso vale como nota de verdade).
// Uso:  node nfse-teste.js            -> pede a senha do certificado e envia uma nota de teste
// A senha não aparece na tela, não é gravada e só existe na memória durante o teste.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const nfse = require('./nfse');

const PFX = process.env.NFSE_PFX || path.join(os.homedir(), 'OneDrive', 'Área de Trabalho', 'CertificadoCorreaVeiculos.pfx');
const SAIDA = process.env.NFSE_SAIDA || path.join(__dirname, '..', 'nfse-api', 'resultado-teste.json');

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
  console.log('Teste de NFS-e no ambiente de TESTES da Receita (não vale como nota)');
  console.log('Certificado:', PFX);
  const senha = await pedirSenha('Senha do certificado (não aparece): ');
  const cert = nfse.carregarCertificado(PFX, senha);
  console.log('Certificado aberto. Válido até', cert.validade);
  console.log('Titular:', cert.titular.split(', ').filter(x => /^CN=/.test(x)).join(' '));

  const dps = nfse.montarDps({
    tomador: 'santander-financiamento', valor: 10000, competencia: new Date().toISOString().slice(0, 10),
    serie: 1, nDps: Math.floor(Date.now() / 1000) % 1e9, ambiente: 'teste',
  });
  const xml = nfse.assinarDps(dps.infDps, dps.id, cert);
  console.log('DPS de teste:', dps.id, '| valor R$ 100,00 | ISS', (dps.iss / 100).toFixed(2));
  const r = await nfse.enviarDps(xml, 'teste', cert);
  console.log('Resposta da Receita: HTTP', r.status);
  console.log(JSON.stringify(r.json || r.bruto, null, 2).slice(0, 1500));
  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, JSON.stringify({ quando: new Date().toISOString(), id: dps.id, status: r.status, resposta: r.json || r.bruto, enviado: xml }, null, 2));
  if (r.nfseXml) fs.writeFileSync(SAIDA.replace('.json', '-nfse.xml'), r.nfseXml);
  console.log('Resultado salvo em', SAIDA);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
