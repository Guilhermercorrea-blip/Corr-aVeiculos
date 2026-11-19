'use strict';
// Lê o XML da NF-e de VENDA que outra loja emitiu para nós, para a devolução de compra sair como ESPELHO dela:
// mesmos valores de ICMS, PIS e COFINS (a loja precisa deles para estornar os tributos), mesma chave na referência,
// e os dados da loja (nome, CNPJ, IE, endereço) exatamente como ela emitiu.
const NOSSO_CNPJ = '07793106000139';

const pega = (xml, nome) => (String(xml || '').match(new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`)) || [])[1] || '';
const desesc = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const v = (xml, nome) => desesc(pega(xml, nome)).trim();
const centavos = s => (s === '' ? null : Math.round(Number(s) * 100));

// Primeiro grupo filho de <ICMS>, <PIS> ou <COFINS> (ex.: ICMS20, PISAliq, COFINSNT)
function grupo(imposto) {
  const m = String(imposto).match(/<(\w+)>([\s\S]*?)<\/\1>/);
  return m ? { nome: m[1], xml: m[2] } : null;
}

function lerNotaOrigem(xml) {
  const texto = String(xml || '');
  const chave = (texto.match(/Id="NFe(\d{44})"/) || [])[1];
  if (!chave) throw new Error('Esse arquivo não parece o XML de uma NF-e (não achei a chave de acesso).');
  const ide = pega(texto, 'ide'), emit = pega(texto, 'emit'), ender = pega(emit, 'enderEmit'), dest = pega(texto, 'dest'), tot = pega(texto, 'ICMSTot');
  if (v(ide, 'tpNF') !== '1') throw new Error('Essa nota não é de saída (venda) da loja: confira o arquivo.');
  if ((v(dest, 'CNPJ') || '') !== NOSSO_CNPJ) throw new Error('Essa nota não foi emitida para a Corrêa Veículos (o destinatário é outro CNPJ).');
  const dets = [...texto.matchAll(/<det nItem="\d+">([\s\S]*?)<\/det>/g)].map(m => m[1]);
  if (dets.length !== 1) throw new Error('A nota da loja tem mais de um item: a devolução de um carro precisa de nota com um item só.');
  const det = dets[0], prod = pega(det, 'prod');
  const icms = grupo(pega(det, 'ICMS')), pis = grupo(pega(det, 'PIS')), cofins = grupo(pega(det, 'COFINS'));
  if (!icms) throw new Error('Não achei o ICMS na nota da loja.');
  const lerTrib = (g, base, aliq, valor) => (g ? { grupo: g.nome, CST: v(g.xml, 'CST'), vBC: centavos(v(g.xml, 'vBC')), aliquota: v(g.xml, aliq), valor: centavos(v(g.xml, valor)) } : null);
  return {
    chave,
    numero: v(ide, 'nNF'), dhEmi: v(ide, 'dhEmi'),
    loja: {
      nome: v(emit, 'xNome'), cnpj: v(emit, 'CNPJ'), ie: v(emit, 'IE'), telefone: v(ender, 'fone'),
      endereco: v(ender, 'xLgr'), numero: v(ender, 'nro'), bairro: v(ender, 'xBairro'), cMun: v(ender, 'cMun'), cidade: v(ender, 'xMun'), uf: v(ender, 'UF'), cep: v(ender, 'CEP'),
    },
    valor: centavos(v(tot, 'vNF')), vProd: centavos(v(prod, 'vProd')), ncm: v(prod, 'NCM'), xProd: v(prod, 'xProd'),
    icms: { grupo: icms.nome, orig: v(icms.xml, 'orig'), CST: v(icms.xml, 'CST') || v(icms.xml, 'CSOSN'), modBC: v(icms.xml, 'modBC'), pRedBC: v(icms.xml, 'pRedBC'), vBC: centavos(v(icms.xml, 'vBC')), pICMS: v(icms.xml, 'pICMS'), vICMS: centavos(v(icms.xml, 'vICMS')) },
    pis: lerTrib(pis, 'vBC', 'pPIS', 'vPIS'),
    cofins: lerTrib(cofins, 'vBC', 'pCOFINS', 'vCOFINS'),
  };
}

module.exports = { lerNotaOrigem, NOSSO_CNPJ };
