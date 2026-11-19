'use strict';
// XML da NF-e 4.00 (modelo 55) com os MESMOS valores que vão no TXT do Emissor Sebrae (nfe.js),
// para enviar direto à SEFAZ-SP. Escrito já na forma canônica (C14N): sem espaços, atributos em ordem,
// sem tags vazias, para a assinatura conferir sem precisar de biblioteca de XML.
// Por enquanto cobre as notas de entrada e devolução de consignação e a entrada de compra (sem o grupo de veículo novo).

const NS = 'http://www.portalfiscal.inf.br/nfe';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
const el = (nome, valor) => (valor === null || valor === undefined || valor === '' ? '' : `<${nome}>${esc(valor)}</${nome}>`);
const dinheiro = centavos => (centavos / 100).toFixed(2);

// IBS/CBS (reforma tributária): a HOMOLOGAÇÃO da SEFAZ já exige o grupo (rejeição 1115); a produção ainda não
// (NT 2025.002 v1.51-v1.53: "implementação futura"; notas do Emissor Sebrae saem sem ele e são autorizadas).
// Só em homologação usamos CST 000 / cClassTrib 000001 com as alíquotas de teste de 2026, para provar o resto do envio.
// NÃO é a classificação certa da consignação: para produção, usar o que o contador indicar.
function grupoIbsCbsTeste(centavos) {
  const vIBSUF = Math.round(centavos * 0.001), vCBS = Math.round(centavos * 0.009);
  const item = '<IBSCBS>' + el('CST', '000') + el('cClassTrib', '000001') + '<gIBSCBS>' + el('vBC', dinheiro(centavos)) +
    '<gIBSUF>' + el('pIBSUF', '0.1000') + el('vIBSUF', dinheiro(vIBSUF)) + '</gIBSUF>' +
    '<gIBSMun>' + el('pIBSMun', '0.0000') + el('vIBSMun', '0.00') + '</gIBSMun>' + el('vIBS', dinheiro(vIBSUF)) +
    '<gCBS>' + el('pCBS', '0.9000') + el('vCBS', dinheiro(vCBS)) + '</gCBS></gIBSCBS></IBSCBS>';
  const total = '<IBSCBSTot>' + el('vBCIBSCBS', dinheiro(centavos)) +
    '<gIBS><gIBSUF>' + el('vDif', '0.00') + el('vDevTrib', '0.00') + el('vIBSUF', dinheiro(vIBSUF)) + '</gIBSUF>' +
    '<gIBSMun>' + el('vDif', '0.00') + el('vDevTrib', '0.00') + el('vIBSMun', '0.00') + '</gIBSMun>' +
    el('vIBS', dinheiro(vIBSUF)) + el('vCredPres', '0.00') + el('vCredPresCondSus', '0.00') + '</gIBS>' +
    '<gCBS>' + el('vDif', '0.00') + el('vDevTrib', '0.00') + el('vCBS', dinheiro(vCBS)) + el('vCredPres', '0.00') + el('vCredPresCondSus', '0.00') + '</gCBS>' +
    '</IBSCBSTot>';
  return { item, total };
}

// Impostos do item: ICMS copiado da nota de venda da loja (devolução de compra em espelho); PIS/COFINS 07
function impostosEspelho(e) {
  const r = c => dinheiro(c || 0);
  const i = e.icms;
  const icms = '<ICMS><ICMS20>' + el('orig', i.orig) + el('CST', '20') + el('modBC', i.modBC) + el('pRedBC', i.pRedBC) + el('vBC', r(i.vBC)) +
    el('pICMS', i.pICMS) + el('vICMS', r(i.vICMS)) + '</ICMS20></ICMS>';
  const pc = (t, nome, aliq, val) => {
    if (!t) return `<${nome}><${nome}NT>${el('CST', '07')}</${nome}NT></${nome}>`;
    if (t.grupo === nome + 'Aliq') return `<${nome}><${nome}Aliq>${el('CST', t.CST)}${el('vBC', r(t.vBC))}${el(aliq, t.aliquota)}${el(val, r(t.valor))}</${nome}Aliq></${nome}>`;
    return `<${nome}><${nome}NT>${el('CST', t.CST)}</${nome}NT></${nome}>`;
  };
  return icms + pc(null, 'PIS') + pc(null, 'COFINS');
}

// Grupo do veículo (aba "Veículo Novo"): mesmos valores da linha J do arquivo do Emissor
function veicProd(f, xCor, anoMod, anoFab) {
  if (!f) return '';
  const q4 = x => Number(x).toFixed(4);
  return '<veicProd>' + el('tpOp', '3') + el('chassi', f.chassi) + el('cCor', f.cor) + el('xCor', xCor) + el('pot', f.potencia) + el('cilin', f.cilindrada) +
    el('pesoL', q4(f.peso)) + el('pesoB', q4(f.peso)) + el('nSerie', '1') + el('tpComb', f.combustivel) + el('nMotor', f.motor) + el('CMT', q4(f.cmt)) +
    el('dist', f.eixos) + el('anoMod', anoMod) + el('anoFab', anoFab) + el('tpPint', f.pintura) + el('tpVeic', f.tipo) + el('espVeic', f.especie) +
    el('VIN', 'N') + el('condVeic', '1') + el('cMod', f.marca_modelo) + el('cCorDENATRAN', f.cor) + el('lota', f.lotacao) + el('tpRest', '0') + '</veicProd>';
}

// n = valores calculados em nfe.gerarNota (mesmos do TXT)
function montarInfNFe(n) {
  if (n.venda) throw new Error('A nota de venda ainda não sai direto pela SEFAZ: use o Emissor do Sebrae por enquanto.');
  const e = n.emitente;
  const ibs = n.homologacao ? grupoIbsCbsTeste(n.valor) : { item: '', total: '' };
  const valor = dinheiro(n.valor);
  const ide =
    '<ide>' +
    el('cUF', '35') + el('cNF', n.cNF) + el('natOp', n.natOp) + el('mod', '55') + el('serie', '1') + el('nNF', n.numero) +
    el('dhEmi', n.dhEmi) + el('dhSaiEnt', n.dhEmi) + el('tpNF', n.tpNF) + el('idDest', n.uf === 'SP' ? '1' : '2') + el('cMunFG', e.cMun) +
    el('tpImp', '1') + el('tpEmis', '1') + el('cDV', n.cDV) + el('tpAmb', n.homologacao ? '2' : '1') + el('finNFe', n.finNFe || 1) +
    el('indFinal', n.indFinal) + el('indPres', '0') + el('procEmi', '0') + el('verProc', 'CorreaSite_1.0') +
    (n.referencia ? `<NFref>${el('refNFe', n.referencia)}</NFref>` : '') +
    '</ide>';
  const emit =
    '<emit>' + el('CNPJ', e.cnpj) + el('xNome', e.xNome) + el('xFant', e.xFant) +
    '<enderEmit>' + el('xLgr', e.xLgr) + el('nro', e.nro) + el('xBairro', e.xBairro) + el('cMun', e.cMun) + el('xMun', e.xMun) +
    el('UF', e.uf) + el('CEP', e.cep) + el('cPais', '1058') + el('xPais', 'BRASIL') + el('fone', e.fone) + '</enderEmit>' +
    el('IE', e.ie) + el('IM', e.im) + el('CNAE', e.cnae) + el('CRT', e.crt) + '</emit>';
  const p = n.pessoa;
  const dest =
    '<dest>' + (n.doc.length === 11 ? el('CPF', n.doc) : el('CNPJ', n.doc)) + el('xNome', n.nomeDest) +
    '<enderDest>' + el('xLgr', p.endereco) + el('nro', p.numero) + el('xBairro', p.bairro) + el('cMun', n.cMun) + el('xMun', p.cidade) +
    el('UF', n.uf) + el('CEP', n.cep) + el('cPais', '1058') + el('xPais', 'BRASIL') + el('fone', n.fone) + '</enderDest>' +
    el('indIEDest', n.indIEDest || 9) + el('IE', n.ieDest) + '</dest>';
  // Impostos do item: espelho da nota da loja (devolução de compra) ou o padrão das notas da loja
  const impostoItem = n.espelho ? impostosEspelho(n.espelho) : ('<ICMS><ICMS20>' + el('orig', '0') + el('CST', '20') + el('modBC', '3') + el('pRedBC', n.pRedBC || '90.00') +
    el('vBC', n.icmsNota ? dinheiro(n.icmsNota.base) : '0.00') + el('pICMS', '18.0000') + el('vICMS', n.icmsNota ? dinheiro(n.icmsNota.valor) : '0.00') + '</ICMS20></ICMS>' +
    '<PIS><PISNT>' + el('CST', '07') + '</PISNT></PIS><COFINS><COFINSNT>' + el('CST', '07') + '</COFINSNT></COFINS>');
  const ed = n.espelho;
  const tvBC = ed ? dinheiro(ed.icms.vBC || 0) : n.icmsNota ? dinheiro(n.icmsNota.base) : '0.00';
  const tvICMS = ed ? dinheiro(ed.icms.vICMS || 0) : n.icmsNota ? dinheiro(n.icmsNota.valor) : '0.00';
  const tvPIS = '0.00';
  const tvCOFINS = '0.00';
  const det =
    '<det nItem="1"><prod>' +
    el('cProd', 'S' + n.veiculoId) + el('cEAN', 'SEM GTIN') + el('xProd', n.xProd) + el('NCM', n.ncm) + el('CFOP', n.cfop) +
    el('uCom', 'UN') + el('qCom', '1.0000') + el('vUnCom', n.vUn) + el('vProd', valor) + el('cEANTrib', 'SEM GTIN') +
    el('uTrib', 'UN') + el('qTrib', '1.0000') + el('vUnTrib', n.vUn) + el('indTot', '1') + veicProd(n.ficha, n.xCor, n.anoMod, n.anoFab) + '</prod>' +
    '<imposto>' + impostoItem + ibs.item + '</imposto></det>';
  const zero = '0.00';
  const total =
    '<total><ICMSTot>' + el('vBC', tvBC) + el('vICMS', tvICMS) + el('vICMSDeson', zero) + el('vFCP', zero) + el('vBCST', zero) + el('vST', zero) +
    el('vFCPST', zero) + el('vFCPSTRet', zero) + el('vProd', valor) + el('vFrete', zero) + el('vSeg', zero) + el('vDesc', zero) + el('vII', zero) +
    el('vIPI', zero) + el('vIPIDevol', zero) + el('vPIS', tvPIS) + el('vCOFINS', tvCOFINS) + el('vOutro', zero) + el('vNF', valor) + '</ICMSTot>' + ibs.total + '</total>';
  const transp = `<transp>${el('modFrete', n.modFrete)}</transp>`;
  const pag = n.pagamentoPix
    // PIX (17) agora exige o grupo card (rejeição 391); tpIntegra 2 = pagamento não integrado à automação (sem maquininha)
    ? `<pag><detPag>${el('indPag', '0')}${el('tPag', '17')}${el('vPag', valor)}<card>${el('tpIntegra', '2')}</card></detPag></pag>`
    : `<pag><detPag>${el('tPag', '90')}${el('vPag', zero)}</detPag></pag>`;
  return `<infNFe Id="NFe${n.chave}" versao="4.00">${ide}${emit}${dest}${det}${total}${transp}${pag}</infNFe>`;
}

module.exports = { NS, montarInfNFe, esc };
