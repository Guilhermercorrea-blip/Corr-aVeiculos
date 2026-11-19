'use strict';
// DANFE (Documento Auxiliar da NF-e) gerado pelo sistema a partir do XML autorizado (nfeProc), sem bibliotecas.
// É uma página A4 para imprimir ou "Salvar como PDF" no navegador, como os contratos.
// Segue os blocos do leiaute do MOC (canhoto, emitente, chave com código de barras Code-128C, protocolo,
// destinatário, cálculo do imposto, transporte, produtos, dados adicionais). Em homologação sai "SEM VALOR FISCAL".

// ---------- Código de barras Code-128 (conjunto C: pares de dígitos) ----------
// Larguras de barra/espaço de cada símbolo (0 a 105) e o STOP (106). Cada símbolo soma 11 módulos; o STOP, 13.
const PADROES_128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_C = 105, STOP = 106;

// Valores do Code-128C para uma sequência de dígitos (comprimento par), já com START, dígito de controle e STOP
function valores128C(digitos) {
  if (!/^(\d\d)+$/.test(digitos)) throw new Error('Code-128C precisa de número par de dígitos');
  const dados = digitos.match(/\d\d/g).map(Number);
  const soma = dados.reduce((s, v, i) => s + v * (i + 1), START_C);
  return [START_C, ...dados, soma % 103, STOP];
}

function codigoBarrasSvg(digitos, { altura = 34, modulo = 1 } = {}) {
  let x = 10 * modulo; // zona de silêncio
  let barras = '';
  for (const v of valores128C(digitos)) {
    const p = PADROES_128[v];
    for (let i = 0; i < p.length; i++) {
      const w = Number(p[i]) * modulo;
      if (i % 2 === 0) barras += `<rect x="${x}" y="0" width="${w}" height="${altura}"/>`;
      x += w;
    }
  }
  x += 10 * modulo;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} ${altura}" preserveAspectRatio="none" class="barras">${barras}</svg>`;
}

// ---------- Leitura do XML autorizado ----------
const pega = (xml, nome) => (String(xml || '').match(new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`)) || [])[1] || '';
const valor = (xml, nome) => desescapar(pega(xml, nome));
function desescapar(s) { return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const dinheiro = v => (v === '' || v == null ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const quantidade = v => (v === '' ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }));
const doc = d => (d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : d);
const cep = c => (c.length === 8 ? c.replace(/(\d{5})(\d{3})/, '$1-$2') : c);
const fone = f => (f.length === 10 ? f.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3') : f.length === 11 ? f.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3') : f);
const data = dh => (dh ? dh.slice(0, 10).split('-').reverse().join('/') : '');
const hora = dh => (dh ? dh.slice(11, 19) : '');
const chaveFormatada = c => c.replace(/(\d{4})/g, '$1 ').trim();
const numeroNota = n => String(n).padStart(9, '0').replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3');
const MOD_FRETE = { 0: '0 - Emitente', 1: '1 - Destinatário', 2: '2 - Terceiros', 3: '3 - Próprio remetente', 4: '4 - Próprio destinatário', 9: '9 - Sem frete' };

function lerNota(xml) {
  const ide = pega(xml, 'ide'), emit = pega(xml, 'emit'), dest = pega(xml, 'dest'), ender = pega(dest, 'enderDest'), enderEmit = pega(emit, 'enderEmit');
  const tot = pega(xml, 'ICMSTot'), prot = pega(xml, 'infProt');
  const chave = (String(xml).match(/Id="NFe(\d{44})"/) || [])[1];
  if (!chave) throw new Error('XML sem chave de acesso');
  const itens = [...String(xml).matchAll(/<det nItem="\d+">([\s\S]*?)<\/det>/g)].map(m => {
    const prod = pega(m[1], 'prod'), icms = pega(m[1], 'ICMS');
    return {
      codigo: valor(prod, 'cProd'), descricao: valor(prod, 'xProd'), ncm: valor(prod, 'NCM'), cfop: valor(prod, 'CFOP'), un: valor(prod, 'uCom'),
      qtd: valor(prod, 'qCom'), vUn: valor(prod, 'vUnCom'), vProd: valor(prod, 'vProd'),
      cst: valor(icms, 'orig') + (valor(icms, 'CST') || valor(icms, 'CSOSN')), vBC: valor(icms, 'vBC'), pICMS: valor(icms, 'pICMS'), vICMS: valor(icms, 'vICMS'),
    };
  });
  return {
    chave, homologacao: valor(ide, 'tpAmb') === '2', natOp: valor(ide, 'natOp'), numero: valor(ide, 'nNF'), serie: valor(ide, 'serie'),
    tpNF: valor(ide, 'tpNF'), dhEmi: valor(ide, 'dhEmi'), dhSaiEnt: valor(ide, 'dhSaiEnt'),
    emit: { nome: valor(emit, 'xNome'), cnpj: valor(emit, 'CNPJ'), ie: valor(emit, 'IE'), xLgr: valor(enderEmit, 'xLgr'), nro: valor(enderEmit, 'nro'), bairro: valor(enderEmit, 'xBairro'), mun: valor(enderEmit, 'xMun'), uf: valor(enderEmit, 'UF'), cep: valor(enderEmit, 'CEP'), fone: valor(enderEmit, 'fone') },
    dest: { nome: valor(dest, 'xNome'), doc: valor(dest, 'CNPJ') || valor(dest, 'CPF'), ie: valor(dest, 'IE'), xLgr: valor(ender, 'xLgr'), nro: valor(ender, 'nro'), bairro: valor(ender, 'xBairro'), mun: valor(ender, 'xMun'), uf: valor(ender, 'UF'), cep: valor(ender, 'CEP'), fone: valor(ender, 'fone') },
    tot: Object.fromEntries(['vBC', 'vICMS', 'vBCST', 'vST', 'vII', 'vICMSUFRemet', 'vFCP', 'vPIS', 'vProd', 'vFrete', 'vSeg', 'vDesc', 'vOutro', 'vIPI', 'vICMSUFDest', 'vTotTrib', 'vCOFINS', 'vNF'].map(k => [k, valor(tot, k)])),
    modFrete: valor(pega(xml, 'transp'), 'modFrete'),
    infCpl: valor(pega(xml, 'infAdic'), 'infCpl'),
    protocolo: valor(prot, 'nProt'), dhRecbto: valor(prot, 'dhRecbto'), cStat: valor(prot, 'cStat'),
    itens,
  };
}

// ---------- Página ----------
const campo = (rotulo, conteudo, classe = '') => `<div class="c ${classe}"><span class="r">${esc(rotulo)}</span><span class="v">${conteudo === '' || conteudo == null ? '&nbsp;' : esc(conteudo)}</span></div>`;

function gerarDanfe(xml) {
  const n = lerNota(xml);
  if (n.cStat && n.cStat !== '100') throw new Error('Esta nota não está autorizada: não dá para imprimir o DANFE.');
  const e = n.emit, d = n.dest, t = n.tot;
  const endEmit = `${e.xLgr}, ${e.nro} - ${e.bairro} - ${e.mun}/${e.uf} - CEP ${cep(e.cep)}${e.fone ? ' - Fone ' + fone(e.fone) : ''}`;
  const itens = n.itens.map(i => `<tr><td>${esc(i.codigo)}</td><td class="esq">${esc(i.descricao)}</td><td>${esc(i.ncm)}</td><td>${esc(i.cst)}</td><td>${esc(i.cfop)}</td><td>${esc(i.un)}</td>
    <td class="num">${quantidade(i.qtd)}</td><td class="num">${dinheiro(i.vUn)}</td><td class="num">${dinheiro(i.vProd)}</td><td class="num">${dinheiro(i.vBC)}</td><td class="num">${dinheiro(i.vICMS)}</td><td class="num">0,00</td><td class="num">${dinheiro(i.pICMS)}</td><td class="num">0,00</td></tr>`).join('');

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>DANFE ${esc(n.numero)}${n.homologacao ? ' (TESTE)' : ''}</title>
<style>
  @page { size: A4; margin: 7mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 7pt; color: #000; margin: 0; background: #e9ebee; }
  .barra-acoes { text-align: center; padding: 10px; }
  .barra-acoes button { font-size: 12pt; padding: 6px 18px; margin: 0 6px; cursor: pointer; }
  .folha { position: relative; background: #fff; width: 210mm; min-height: 297mm; margin: 0 auto 16px; padding: 7mm; }
  .linha { display: flex; }
  .c { border: 1px solid #000; margin: -1px 0 0 -1px; padding: 1px 3px 2px; min-height: 8mm; display: flex; flex-direction: column; flex: 1; overflow: hidden; }
  .c .r { font-size: 5.5pt; text-transform: uppercase; }
  .c .v { font-size: 8pt; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .titulo { font-size: 6.5pt; font-weight: 700; text-transform: uppercase; margin: 5px 0 1px; }
  .canhoto { display: flex; border-bottom: 1px dashed #000; padding-bottom: 4px; margin-bottom: 5px; }
  .emitente { flex: 4; text-align: center; justify-content: center; }
  .emitente .nome { font-size: 11pt; font-weight: 700; margin-bottom: 4px; }
  .danfe { flex: 2.2; text-align: center; justify-content: center; }
  .danfe .grande { font-size: 13pt; font-weight: 700; }
  .danfe .tp { display: inline-block; border: 1px solid #000; width: 7mm; font-size: 12pt; font-weight: 700; margin-left: 6px; }
  .chave { flex: 4.5; justify-content: center; }
  .barras { width: 100%; height: 12mm; display: block; fill: #000; }
  table.itens { width: 100%; border-collapse: collapse; }
  table.itens th, table.itens td { border: 1px solid #000; padding: 2px 3px; font-size: 6.5pt; text-align: center; }
  table.itens th { font-size: 5.5pt; font-weight: 400; text-transform: uppercase; }
  table.itens td.esq { text-align: left; }
  table.itens td.num { text-align: right; }
  .adic { min-height: 30mm; white-space: normal; }
  .adic .v { white-space: normal; font-weight: 400; font-size: 7pt; }
  .marca { position: absolute; top: 120mm; left: 0; right: 0; text-align: center; font-size: 46pt; font-weight: 700; color: rgba(200,0,0,.18); transform: rotate(-28deg); pointer-events: none; }
  @media print { body { background: #fff; } .barra-acoes { display: none; } .folha { margin: 0; width: auto; min-height: 0; padding: 0; } }
</style></head><body>
<div class="barra-acoes"><button onclick="print()">Imprimir / Salvar PDF</button><button onclick="close()">Fechar</button></div>
<div class="folha">
  ${n.homologacao ? '<div class="marca">SEM VALOR FISCAL</div>' : ''}
  <div class="canhoto">
    <div style="flex:5">
      <div class="c" style="min-height:7mm"><span class="r">Recebemos de ${esc(e.nome)} os produtos/serviços constantes da nota fiscal indicada ao lado</span></div>
      <div class="linha">${campo('Data de recebimento', '')}${campo('Identificação e assinatura do recebedor', '', '')}</div>
    </div>
    <div class="c" style="flex:1.2;text-align:center;justify-content:center"><span class="v" style="font-size:11pt">NF-e</span><span class="v">Nº ${numeroNota(n.numero)}</span><span class="v">SÉRIE ${esc(String(n.serie).padStart(3, '0'))}</span></div>
  </div>

  <div class="linha">
    <div class="c emitente"><span class="nome">${esc(e.nome)}</span><span>${esc(endEmit)}</span></div>
    <div class="c danfe"><span class="grande">DANFE</span><span>Documento Auxiliar da Nota Fiscal Eletrônica</span>
      <span style="margin:4px 0">0 - Entrada<br>1 - Saída <span class="tp">${esc(n.tpNF)}</span></span>
      <span class="v">Nº ${numeroNota(n.numero)}</span><span class="v">SÉRIE ${esc(String(n.serie).padStart(3, '0'))}</span><span>FOLHA 1/1</span></div>
    <div class="c chave">${codigoBarrasSvg(n.chave)}
      <span class="r" style="margin-top:3px">Chave de acesso</span><span class="v" style="font-size:7.8pt;white-space:normal;letter-spacing:-0.1px">${chaveFormatada(n.chave)}</span>
      <span style="margin-top:4px;font-size:7pt">Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora</span></div>
  </div>
  <div class="linha">${campo('Natureza da operação', n.natOp)}${campo('Protocolo de autorização de uso', `${n.protocolo} - ${data(n.dhRecbto)} ${hora(n.dhRecbto)}`)}</div>
  <div class="linha">${campo('Inscrição estadual', e.ie)}${campo('Inscrição estadual do subst. trib.', '')}${campo('CNPJ', doc(e.cnpj))}</div>

  <div class="titulo">Destinatário / remetente</div>
  <div class="linha">${campo('Nome / razão social', d.nome, '')}<div style="flex:0 0 42mm;display:flex">${campo('CNPJ / CPF', doc(d.doc))}</div><div style="flex:0 0 26mm;display:flex">${campo('Data da emissão', data(n.dhEmi))}</div></div>
  <div class="linha">${campo('Endereço', `${d.xLgr}, ${d.nro}`)}<div style="flex:0 0 42mm;display:flex">${campo('Bairro / distrito', d.bairro)}</div><div style="flex:0 0 22mm;display:flex">${campo('CEP', cep(d.cep))}</div><div style="flex:0 0 26mm;display:flex">${campo('Data da saída/entrada', data(n.dhSaiEnt))}</div></div>
  <div class="linha">${campo('Município', d.mun)}<div style="flex:0 0 34mm;display:flex">${campo('Fone / fax', fone(d.fone))}</div><div style="flex:0 0 10mm;display:flex">${campo('UF', d.uf)}</div><div style="flex:0 0 30mm;display:flex">${campo('Inscrição estadual', d.ie)}</div><div style="flex:0 0 26mm;display:flex">${campo('Hora da saída/entrada', hora(n.dhSaiEnt))}</div></div>

  <div class="titulo">Cálculo do imposto</div>
  <div class="linha">${campo('Base de cálc. do ICMS', dinheiro(t.vBC))}${campo('Valor do ICMS', dinheiro(t.vICMS))}${campo('Base cálc. ICMS ST', dinheiro(t.vBCST))}${campo('Valor do ICMS ST', dinheiro(t.vST))}${campo('V. imp. importação', dinheiro(t.vII))}${campo('V. ICMS UF remet.', dinheiro(t.vICMSUFRemet))}${campo('Valor do FCP', dinheiro(t.vFCP))}${campo('Valor do PIS', dinheiro(t.vPIS))}${campo('V. total produtos', dinheiro(t.vProd))}</div>
  <div class="linha">${campo('Valor do frete', dinheiro(t.vFrete))}${campo('Valor do seguro', dinheiro(t.vSeg))}${campo('Desconto', dinheiro(t.vDesc))}${campo('Outras despesas', dinheiro(t.vOutro))}${campo('Valor total IPI', dinheiro(t.vIPI))}${campo('V. ICMS UF dest.', dinheiro(t.vICMSUFDest))}${campo('V. tot. tributos', dinheiro(t.vTotTrib))}${campo('Valor da COFINS', dinheiro(t.vCOFINS))}${campo('Valor total da nota', dinheiro(t.vNF))}</div>

  <div class="titulo">Transportador / volumes transportados</div>
  <div class="linha">${campo('Nome / razão social', '')}${campo('Frete por conta', MOD_FRETE[n.modFrete] || n.modFrete)}${campo('Código ANTT', '')}${campo('Placa do veículo', '')}${campo('UF', '')}${campo('CNPJ / CPF', '')}</div>

  <div class="titulo">Dados dos produtos / serviços</div>
  <table class="itens"><thead><tr><th>Código</th><th>Descrição do produto / serviço</th><th>NCM/SH</th><th>O/CST</th><th>CFOP</th><th>Un</th><th>Quant.</th><th>Valor unit.</th><th>Valor total</th><th>B. cálc. ICMS</th><th>Valor ICMS</th><th>Valor IPI</th><th>Alíq. ICMS</th><th>Alíq. IPI</th></tr></thead>
  <tbody>${itens}</tbody></table>

  <div class="titulo">Dados adicionais</div>
  <div class="linha">
    <div class="c adic" style="flex:3"><span class="r">Informações complementares</span><span class="v">${esc(n.homologacao ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL. ' : '')}${esc(n.infCpl)}</span></div>
    <div class="c adic" style="flex:1.4"><span class="r">Reservado ao fisco</span><span class="v">&nbsp;</span></div>
  </div>
</div>
</body></html>`;
}

module.exports = { gerarDanfe, lerNota, codigoBarrasSvg, valores128C, PADROES_128 };
