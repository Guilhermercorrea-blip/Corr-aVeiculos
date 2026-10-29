'use strict';
// Monta os contratos como páginas prontas para imprimir (a janela de impressão abre sozinha).
// Visual igual ao modelo de consignação da Corrêa Veículos: Arial compacta, faixa azul no título,
// seções numeradas em azul e quadros com borda para os dados.
const db = require('./db');

// ---------- formatação ----------

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Dentro do texto: valor em negrito; vazio vira linha para preencher à mão
const campo = (v, largura = 140) => (v == null || v === '' ? `<span class="linha" style="min-width:${largura}px"></span>` : `<b>${esc(v)}</b>`);
// Dentro dos quadros: valor normal; vazio vira linha
const celula = (v, largura = 200) => (v == null || v === '' ? `<span class="linha" style="min-width:${largura}px"></span>` : esc(v));

const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze',
  'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function ate999(n) {
  if (n === 100) return 'cem';
  const partes = [];
  const c = Math.floor(n / 100);
  const r = n % 100;
  if (c) partes.push(CENTENAS[c]);
  if (r < 20 && r) partes.push(UNIDADES[r]);
  else if (r) partes.push(DEZENAS[Math.floor(r / 10)] + (r % 10 ? ' e ' + UNIDADES[r % 10] : ''));
  return partes.join(' e ');
}

function inteiroPorExtenso(n) {
  if (n === 0) return 'zero';
  const grupos = [];
  for (let x = n; x > 0; x = Math.floor(x / 1000)) grupos.push(x % 1000);
  const nomes = [null, ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']];
  const partes = [];
  const ultimo = grupos.findIndex(v => v > 0);
  for (let g = grupos.length - 1; g >= 0; g--) {
    const v = grupos[g];
    if (!v) continue;
    let t = g === 0 ? ate999(v) : g === 1 ? (v === 1 ? 'mil' : `${ate999(v)} mil`) : `${ate999(v)} ${nomes[g][v === 1 ? 0 : 1]}`;
    // "trinta mil e quinhentos", mas "trinta mil quinhentos e dez"
    if (partes.length) t = (g === ultimo && (v < 100 || v % 100 === 0) ? 'e ' : '') + t;
    partes.push(t);
  }
  return partes.join(' ');
}

function reaisPorExtenso(centavos) {
  const inteiro = Math.floor(centavos / 100);
  const cent = centavos % 100;
  const partes = [];
  if (inteiro) {
    const de = inteiro >= 1e6 && inteiro % 1e6 === 0 ? ' de' : '';
    partes.push(`${inteiroPorExtenso(inteiro)}${de} ${inteiro === 1 ? 'real' : 'reais'}`);
  }
  if (cent) partes.push(`${inteiroPorExtenso(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`);
  return partes.join(' e ') || 'zero reais';
}

const reais = centavos => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// "R$ 30.500,00 (trinta mil e quinhentos reais)"
function valor(centavos) {
  if (centavos == null) return `R$ ${campo(null, 120)}`;
  return `<b>${reais(centavos)}</b> (${reaisPorExtenso(centavos)})`;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function dataCurta(iso) {
  if (!iso) return null;
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}
const hora = iso => (iso && iso.length > 10 ? iso.slice(11, 16) : null);
const dataHora = iso => (iso ? `${dataCurta(iso)}${hora(iso) ? ' às ' + hora(iso) : ''}` : null);
function somarDias(iso, dias) {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  const data = new Date(Date.UTC(a, m - 1, d + dias));
  return data.toISOString().slice(0, 10);
}
function dataPorExtenso(iso) {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

const cpf = c => (c && c.length === 11 ? c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  : c && c.length === 14 ? c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : c);
const placa = p => (p ? p.replace(/^([A-Z]{3})(\d)/, '$1-$2') : null);
const km = n => (n == null ? null : n.toLocaleString('pt-BR'));
const cep = c => (c ? c.replace(/(\d{5})(\d{3})/, '$1-$2') : null);
const rua = p => (p?.endereco ? `${p.endereco}${p.numero ? ', nº ' + p.numero : ''}${p.bairro ? ' - ' + p.bairro : ''}` : null);
const cidadeUf = p => (p?.cidade ? `${p.cidade}/${p.uf || ''}` : null);

// ---------- blocos do layout ----------

function cabecalho(c) {
  return `
  <header class="cab">
    <img src="/img/logo.jpg" alt="${esc(c.razao_social)}">
    <div class="dados-loja">
      <b>${esc(c.razao_social)}</b><br>
      CNPJ: ${esc(c.cnpj)}<br>
      ${esc(c.endereco)}<br>
      ${esc(c.cidade)} - CEP ${esc(c.cep)}<br>
      Fone: ${esc(c.telefone)} | Whats: ${esc(c.whatsapp)}
    </div>
  </header>`;
}

const faixa = titulo => `<div class="faixa">${titulo}</div>`;
const secao = (n, titulo) => `<h2>${n}. ${titulo}</h2>`;
const clausula = (n, titulo, texto) => `<p><b>${n}.${titulo ? ' ' + titulo + '.' : ''}</b> ${texto}</p>`;

// Quadro de duas colunas "Rótulo | valor", como "Qualificação das partes"
function quadro(linhas) {
  return `<table class="quadro">${linhas.map(l => (l.titulo
    ? `<tr><th colspan="2">${l.titulo}</th></tr>`
    : `<tr><td class="rot">${l[0]}:</td><td>${l[1]}</td></tr>`)).join('')}</table>`;
}

// Quadro de pares lado a lado, como "Dados do veículo"
function quadroPares(pares) {
  const linhas = [];
  for (let i = 0; i < pares.length; i += 2) {
    const [a, b] = [pares[i], pares[i + 1]];
    linhas.push(`<tr><td><b>${a[0]}:</b> ${a[1]}</td><td>${b ? `<b>${b[0]}:</b> ${b[1]}` : ''}</td></tr>`);
  }
  return `<table class="quadro pares">${linhas.join('')}</table>`;
}

function linhasPessoa(p, rotulo) {
  return [
    [rotulo, celula(p?.nome, 320)],
    ['CPF/CNPJ', celula(cpf(p?.cpf))],
    ['RG', celula(p?.rg)],
    ['Endereço', celula(rua(p), 320)],
    ['Cidade/UF - CEP', `${celula(cidadeUf(p), 160)}${p?.cep ? ' - CEP ' + esc(cep(p.cep)) : ' &nbsp; CEP: <span class="linha" style="min-width:90px"></span>'}`],
    ['Telefone/WhatsApp', celula(p?.telefone)],
  ];
}

function linhasLoja(c) {
  return [
    ['Razão social', `<b>${esc(c.razao_social)}</b> - CNPJ ${esc(c.cnpj)}`],
    ['Endereço', `${esc(c.endereco)}, ${esc(c.cidade)} - CEP ${esc(c.cep)}`],
    ['Representante', `${celula(c.representante, 220)} &nbsp; CPF: ${celula(c.representante_cpf, 110)}`],
  ];
}

function paresVeiculo(v, extras = []) {
  return [
    ['Marca/Modelo', celula(v.marca_modelo, 150)],
    ['Tipo/Cor', celula(v.cor, 120)],
    ['Placa', celula(placa(v.placa), 120)],
    ['Renavam', celula(v.renavam, 120)],
    ['Chassi', celula(v.chassi, 150)],
    ['Combustível', celula(v.combustivel, 120)],
    ['Ano Fab./Modelo', v.ano_fab || v.ano_mod ? `${v.ano_fab || '____'}/${v.ano_mod || '____'}` : celula(null, 110)],
    ...extras,
  ];
}

function localData(c, iso) {
  return `<p class="local-data">${esc(c.cidade)}, ${iso ? dataPorExtenso(iso) : '______ de ______________________ de 20______'}.</p>`;
}

function assinaturas(esquerda, direita) {
  return `
  <div class="assinaturas">
    <div><div class="traco"></div>${esquerda}</div>
    <div><div class="traco"></div>${direita}</div>
  </div>`;
}

const testemunhas = () => `
  <h2>Testemunhas</h2>
  <div class="testemunhas">
    <div>1ª: <span class="linha"></span></div><div>2ª: <span class="linha"></span></div>
    <div>CPF: <span class="linha"></span></div><div>CPF: <span class="linha"></span></div>
    <div>Ass.: <span class="linha"></span></div><div>Ass.: <span class="linha"></span></div>
  </div>`;

const assinaturaPessoa = (titulo, p) => `<b>${titulo}</b><br>${p?.nome ? esc(p.nome) + '<br>' : ''}CPF/CNPJ: ${p?.cpf ? esc(cpf(p.cpf)) : '<span class="linha" style="min-width:150px"></span>'}`;
const assinaturaLoja = c => `<b>${esc(c.razao_social)}</b><br>CNPJ: ${esc(c.cnpj)}`;

function pagina(titulo, corpo) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<style>
  @page { size: A4; margin: 12mm 14mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 8.3pt; line-height: 1.3; color: #000; margin: 0; background: #e9ebee; }
  .folha { background: #fff; width: 210mm; min-height: 297mm; margin: 16px auto; padding: 12mm 14mm 14mm; box-shadow: 0 1px 6px rgba(0,0,0,.15); }
  .cab { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .cab img { height: 19mm; width: auto; }
  .cab .dados-loja { text-align: center; font-size: 8.3pt; line-height: 1.25; padding-right: 20mm; }
  .faixa { background: #17385f; color: #fff; font-weight: 700; font-size: 10.5pt; text-align: center; text-transform: uppercase; padding: 4px 6px; margin: 4px 0 6px; }
  h2 { color: #17385f; font-size: 9.2pt; font-weight: 700; text-transform: uppercase; margin: 8px 0 4px; }
  p { margin: 0 0 2px; }
  .quadro { width: 100%; border-collapse: collapse; margin-bottom: 3px; }
  .quadro td, .quadro th { border: 1px solid #c9d1dc; padding: 5px 7px; vertical-align: top; }
  .quadro td.rot { font-weight: 700; width: 30%; }
  .quadro th { background: #eef2f7; color: #17385f; text-align: left; text-transform: uppercase; font-size: 8pt; }
  .quadro.pares td { width: 50%; }
  .linha { display: inline-block; border-bottom: 1px solid #000; height: 1em; vertical-align: -2px; }
  .caixa { border: 1px solid #c9d1dc; padding: 0 0 4px; margin-top: 8px; page-break-inside: avoid; }
  .caixa .faixa { margin-top: 0; }
  .caixa p { padding: 0 8px; }
  .local-data { text-align: center; font-weight: 700; margin: 14px 0 0; }
  .assinaturas { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin: 38px 6px 0; text-align: center; page-break-inside: avoid; }
  .traco { border-top: 1px solid #000; margin-bottom: 4px; }
  .testemunhas { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 40px; font-size: 10pt; margin: 0 6px; page-break-inside: avoid; }
  .testemunhas > div { display: flex; gap: 4px; } .testemunhas .linha { flex: 1; }
  .quebra { page-break-before: always; }
  .barra { position: sticky; top: 0; background: #17385f; padding: 10px; text-align: center; }
  .barra button { font: 600 15px Arial, sans-serif; padding: 9px 18px; border-radius: 6px; border: 0; margin: 0 4px; cursor: pointer; background: #fff; color: #17385f; }
  .barra button.fechar { background: transparent; color: #fff; border: 1px solid #fff; }
  @media print {
    body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .folha { box-shadow: none; margin: 0; padding: 0; width: auto; min-height: 0; }
    .barra { display: none; }
  }
</style></head>
<body>
<div class="barra"><button onclick="print()">Imprimir</button><button class="fechar" onclick="close()">Fechar</button></div>
<div class="folha">${corpo}</div>
<script>if (!location.search.includes('previa')) window.addEventListener('load', () => setTimeout(print, 300));</script>
</body></html>`;
}

// ---------- contratos ----------

function contratoCompra(d, c) {
  const v = d.veiculo;
  const p = d.fornecedor;
  return pagina(`Contrato de compra - ${placa(v.placa) || v.marca_modelo}`, `
  ${cabecalho(c)}
  ${faixa('Contrato particular de compra e venda de veículo usado')}
  ${secao(1, 'Qualificação das partes')}
  ${quadro([{ titulo: 'Vendedor' }, ...linhasPessoa(p, 'Nome'), { titulo: 'Comprador' }, ...linhasLoja(c)])}
  <p>O VENDEDOR vende ao COMPRADOR o veículo abaixo, nos termos deste contrato.</p>
  ${secao(2, 'Dados do veículo')}
  ${quadroPares(paresVeiculo(v, [['Km de Entrada', celula(km(v.km_entrada), 120)], ['Data/Hora Entrada', celula(dataHora(v.entrada_em), 120)]]))}
  ${secao(3, 'Preço e pagamento')}
  ${quadro([['Valor total', valor(v.valor_compra)], ['Forma de pagamento', celula(v.forma_pagamento, 320)]])}
  ${secao(4, 'Entrega e responsabilidades')}
  ${clausula('4.1', 'Entrega', `O veículo é entregue neste ato, em ${campo(dataCurta(v.entrada_em))}, às ${campo(hora(v.entrada_em), 60)}, junto com chave(s), manual e documentos.`)}
  ${clausula('4.2', 'Responsabilidades', 'A partir desta data e hora, a responsabilidade por multas, infrações e danos passa ao COMPRADOR. Tudo o que ocorreu antes é de responsabilidade do VENDEDOR, ainda que identificado ou cobrado posteriormente.')}
  ${secao(5, 'Declarações do vendedor')}
  ${clausula('5.1', '', 'O VENDEDOR declara ser o único proprietário do veículo e ter poderes para vendê-lo.')}
  ${clausula('5.2', '', 'O veículo está livre de financiamento, alienação fiduciária, penhora, restrição judicial ou administrativa, exceto: <span class="linha" style="min-width:260px"></span>.')}
  ${clausula('5.3', '', 'Não há IPVA, licenciamento, seguro obrigatório ou multas em aberto até esta data, exceto: <span class="linha" style="min-width:260px"></span>. Os débitos que aparecerem depois, com fato anterior a esta data, serão pagos pelo VENDEDOR ou descontados do preço.')}
  ${clausula('5.4', '', 'O veículo não tem chassi, motor ou numerações adulterados, e não é objeto de furto, roubo ou sinistro com perda total.')}
  ${secao(6, 'Documentação')}
  ${clausula('6.1', '', 'O VENDEDOR assina e reconhece a assinatura na ATPV-e (Autorização para Transferência de Propriedade do Veículo) em favor do COMPRADOR ou de quem ele indicar, e entrega o CRLV.')}
  ${secao(7, 'Foro')}
  ${clausula('7.1', '', `Para dirimir controvérsias decorrentes deste contrato, fica eleito o foro da Comarca de ${esc(c.foro)}.`)}
  ${v.obs ? `<p><b>Observações:</b> ${esc(v.obs)}</p>` : ''}
  ${localData(c, v.entrada_em)}
  ${assinaturas(assinaturaPessoa('VENDEDOR', p), assinaturaLoja(c))}
  ${testemunhas()}`);
}

function contratoVenda(d, c) {
  const v = d.veiculo;
  const vd = d.venda;
  const comprador = d.comprador;
  const troca = d.trocaVeiculo;
  const dias = Number(c.garantia_dias) || 90;
  const kmGarantia = Number(c.garantia_km) || 3000;
  // Vendas antigas (antes da escolha de forma) só têm "entrada" em texto livre
  const detalhado = Boolean(vd.forma_pagamento);
  const prefixo = vd.forma_pagamento === 'avista' ? 'À vista' : 'Entrada';
  const pagamento = [
    ['Valor total', valor(vd.valor_venda)],
    detalhado && ['Forma de pagamento', `<b>${esc(vd.descricao_pagamento || db.descreverPagamento(vd))}</b>`],
    detalhado && vd.valor_pix && [`${prefixo} - PIX`, valor(vd.valor_pix)],
    detalhado && vd.valor_deposito && [`${prefixo} - Depósito bancário`, valor(vd.valor_deposito)],
    detalhado && vd.valor_dinheiro && [`${prefixo} - Dinheiro`, valor(vd.valor_dinheiro)],
    !detalhado && vd.valor_entrada && ['Entrada', `${valor(vd.valor_entrada)}${vd.forma_entrada ? ' - ' + esc(vd.forma_entrada) : ''}`],
    vd.valor_financiado && ['Financiamento', `${valor(vd.valor_financiado)}${vd.banco ? ' - <b>' + esc(vd.banco) + '</b>' : ''}${vd.parcelas ? ', ' + vd.parcelas + ' parcelas' : ''} (contratado pelo COMPRADOR)`],
    vd.valor_troca && ['Veículo na troca', `${valor(vd.valor_troca)} - ver item 7`],
    vd.valor_saldo && ['Saldo', `${valor(vd.valor_saldo)}${vd.saldo_vencimento ? ' até ' + dataCurta(vd.saldo_vencimento) : ''}`],
  ].filter(Boolean);
  if (pagamento.length === 1) pagamento.push(['Forma de pagamento', celula(null, 320)]);
  const foro = troca ? 8 : 7;

  return pagina(`Contrato de venda - ${placa(v.placa) || v.marca_modelo}`, `
  ${cabecalho(c)}
  ${faixa('Contrato de compra e venda de veículo usado com termo de garantia')}
  ${secao(1, 'Qualificação das partes')}
  ${quadro([{ titulo: 'Vendedora' }, ...linhasLoja(c), { titulo: 'Comprador' }, ...linhasPessoa(comprador, 'Nome'), ['E-mail', celula(comprador?.email)]])}
  <p>A VENDEDORA vende ao COMPRADOR o veículo abaixo, nos termos deste contrato.</p>
  ${secao(2, 'Dados do veículo')}
  ${quadroPares(paresVeiculo(v, [['Km na Entrega', celula(km(vd.km_saida), 120)], ['Data/Hora Entrega', celula(dataHora(vd.vendido_em), 120)]]))}
  ${secao(3, 'Preço e pagamento')}
  ${quadro(pagamento)}
  ${clausula('3.1', 'Transferência', 'O veículo só é transferido depois de todo o preço ser pago ou liberado pelo banco.')}
  ${secao(4, 'Vistoria e estado do veículo')}
  ${clausula('4.1', '', 'O COMPRADOR declara que examinou o veículo, fez test-drive e o recebe no estado em que se encontra, sabendo que é usado.')}
  ${clausula('4.2', 'Itens fora da garantia', `Itens já informados ao COMPRADOR antes da compra: ${vd.obs ? `<b>${esc(vd.obs)}</b>` : '<span class="linha" style="min-width:300px"></span>'}.`)}
  ${secao(5, 'Entrega e responsabilidades')}
  ${clausula('5.1', 'Responsabilidades', `A partir da entrega, em ${campo(dataCurta(vd.vendido_em))} às ${campo(hora(vd.vendido_em), 60)}, multas, infrações, IPVA proporcional e danos são do COMPRADOR.`)}
  ${clausula('5.2', 'Transferência', 'O COMPRADOR transfere o veículo para o seu nome no prazo de 30 dias exigido pelo Código de Trânsito Brasileiro (art. 123).')}
  ${clausula('5.3', 'Comunicação de venda', 'A VENDEDORA faz a comunicação de venda ao órgão de trânsito.')}
  ${secao(6, 'Garantia')}
  ${clausula('6.1', 'Prazo', `${dias} (${inteiroPorExtenso(dias)}) dias contados da data de entrega <b>ou ${km(kmGarantia)} (${inteiroPorExtenso(kmGarantia)}) km rodados</b> a partir da quilometragem de entrega (${km(vd.km_saida)} km), <b>o que ocorrer primeiro</b>. A garantia termina, portanto, em ${dataCurta(somarDias(vd.vendido_em, dias))} ou aos <b>${km(vd.km_saida + kmGarantia)} km</b> no hodômetro, o que acontecer antes.`)}
  ${clausula('6.2', 'Cobertura principal', 'defeitos nas peças internas e lubrificadas do <b>motor</b> (bloco, cabeçote, virabrequim, bielas, pistões, anéis, bronzinas, comando de válvulas, válvulas e bomba de óleo) e do <b>câmbio</b> (engrenagens, eixos, sincronizados, rolamentos internos e, no automático, o conjunto interno da caixa).')}
  ${clausula('6.3', 'Desgaste natural', 'não são defeito e não têm garantia os itens que se desgastam com o uso normal: pneus, bateria, pastilhas e discos de freio, embreagem (disco, platô e rolamento), amortecedores, buchas, correias, velas, filtros, palhetas, lâmpadas, óleos e fluidos, além de pintura, lataria, tapeçaria, vidros e acessórios.')}
  ${clausula('6.4', 'Perda da garantia', 'se o defeito vier de mau uso, falta de manutenção (troca de óleo, nível de água), superaquecimento por continuar rodando com a luz de alerta acesa, acidente, enchente, uso em competição, ou se o motor ou o câmbio forem abertos ou alterados por oficina não autorizada pela VENDEDORA.')}
  ${clausula('6.5', 'Como acionar', `ao notar o problema, o COMPRADOR para de usar o veículo e avisa a VENDEDORA por escrito (WhatsApp ${esc(c.whatsapp)} ou e-mail) dentro do prazo. O conserto é feito em oficina indicada pela VENDEDORA.`)}
  ${troca ? `
  ${secao(7, 'Veículo dado como parte do pagamento')}
  ${quadroPares(paresVeiculo(troca, [['Km', celula(km(troca.km_entrada), 120)], ['Valor da troca', vd.valor_troca != null ? reais(vd.valor_troca) : celula(null, 120)]]))}
  ${clausula('7.1', '', 'O COMPRADOR declara ser o proprietário desse veículo e que ele está livre de financiamento, restrições, débitos e multas, exceto: <span class="linha" style="min-width:240px"></span>.')}
  ${clausula('7.2', '', 'Como o veículo não será transferido para o nome da VENDEDORA, as partes assinam neste ato o Contrato de Consignação anexo, que autoriza a VENDEDORA a vendê-lo a terceiros.')}
  ${clausula('7.3', '', `Multas, infrações e débitos desse veículo com fato anterior a ${campo(dataCurta(vd.vendido_em))}, às ${campo(hora(vd.vendido_em), 60)}, são do COMPRADOR. Se aparecerem depois, serão pagos por ele ou cobrados pela VENDEDORA.`)}
  ${clausula('7.4', '', 'O COMPRADOR assina a ATPV-e do veículo em favor de quem a VENDEDORA indicar quando ele for vendido.')}` : ''}
  ${secao(foro, 'Foro')}
  ${clausula(`${foro}.1`, '', 'Fica eleito o foro do domicílio do COMPRADOR, conforme o Código de Defesa do Consumidor.')}
  ${localData(c, vd.vendido_em)}
  ${assinaturas(assinaturaLoja(c), assinaturaPessoa('COMPRADOR', comprador))}
  ${testemunhas()}`);
}

// Modelo de consignação da loja. Com "quitado", entra o adendo de veículo já pago pela loja (troca ou compra sem transferir).
function contratoConsignacao(d, c) {
  const v = d.veiculo;
  const p = d.fornecedor;
  const quitado = v.tipo_entrada === 'troca' || v.tipo_entrada === 'compra_sem_transferir';
  const origem = d.origemTroca;
  const compraSemTransferir = v.tipo_entrada === 'compra_sem_transferir';
  const valorComercial = compraSemTransferir ? v.valor_consignacao : v.valor_compra;
  const rotuloValor = compraSemTransferir ? 'Valor para venda' : 'Valor líquido ao CONSIGNANTE';
  const comissao = quitado ? 'Não se aplica (ver adendo)'
    : v.comissao != null ? reais(v.comissao) : '<span class="linha" style="min-width:40px"></span>% ou R$ <span class="linha" style="min-width:90px"></span>';

  return pagina(`Consignação - ${placa(v.placa) || v.marca_modelo}`, `
  ${cabecalho(c)}
  ${faixa('Contrato de consignação de veículo e termo de responsabilidade')}
  ${secao(1, 'Qualificação das partes')}
  ${quadro(linhasPessoa(p, 'Consignante / Proprietário').filter(l => l[0] !== 'RG'))}
  <p>A <b>CONSIGNATÁRIA</b> é ${esc(c.razao_social)}, CNPJ nº ${esc(c.cnpj)}, estabelecida no endereço indicado no cabeçalho. O CONSIGNANTE entrega o veículo abaixo, autorizando sua exposição, divulgação, intermediação e venda nos termos deste contrato.</p>
  ${secao(2, 'Dados do veículo')}
  ${quadroPares(paresVeiculo(v, [
    ['Km de Entrada', celula(km(v.km_entrada), 120)],
    ['Data/Hora Entrada', celula(dataHora(v.entrada_em), 120)],
    ['Proprietário no CRV/ATPV-e', celula(p?.nome, 100)],
  ]))}
  ${secao(3, 'Condições comerciais')}
  ${quadroPares([[rotuloValor, valorComercial != null ? reais(valorComercial) : 'R$ ' + celula(null, 120)], ['Comissão', comissao]])}
  ${clausula('3.1', 'Repasse', 'O valor devido ao CONSIGNANTE será repassado após a efetiva venda e confirmação da liquidação financeira integral do negócio.')}
  ${clausula('3.2', 'Comissão', 'A CONSIGNATÁRIA poderá reter diretamente a comissão pactuada dos valores recebidos na negociação.')}
  ${clausula('3.3', 'Valor excedente', 'Se o veículo for vendido acima do valor líquido ajustado, a diferença positiva pertencerá à CONSIGNATÁRIA como remuneração adicional, salvo ajuste escrito em contrário.')}
  ${clausula('3.4', 'Venda posterior', 'A comissão continuará devida se, após a retirada, o CONSIGNANTE vender o veículo a pessoa apresentada ou captada pela CONSIGNATÁRIA durante a vigência deste contrato.')}
  ${secao(4, 'Multas, débitos e responsabilidades')}
  ${clausula('4.1', 'Débitos anteriores', 'O CONSIGNANTE responde por multas, IPVA, licenciamento, restrições, encargos e demais débitos ou fatos geradores existentes até a data e hora de entrada, ainda que identificados ou cobrados posteriormente.')}
  ${clausula('4.2', 'Custódia', 'Da entrada até a venda ou devolução formal, a CONSIGNATÁRIA assume a guarda física do veículo e responde pelas infrações decorrentes da circulação realizada por ela, seus funcionários, representantes ou terceiros por ela autorizados.')}
  ${clausula('4.3', 'Indicação de condutor', 'Havendo autuação no período de custódia, as partes fornecerão e assinarão, no prazo aplicável, os documentos necessários à identificação do efetivo condutor. Sendo a infração de responsabilidade da CONSIGNATÁRIA ou de pessoa por ela autorizada, esta arcará com o respectivo valor.')}
  ${clausula('4.4', 'Ressarcimento', 'Se uma parte pagar débito que seja de responsabilidade da outra, terá direito ao ressarcimento mediante comprovação.')}
  ${secao(5, 'Guarda, test drive e utilização')}
  ${clausula('5.1', '', 'O CONSIGNANTE autoriza exposição, anúncios físicos e digitais e deslocamentos necessários à comercialização.')}
  ${clausula('5.2', '', 'Ficam autorizados test drives acompanhados ou previamente permitidos pela CONSIGNATÁRIA e deslocamentos para vistoria, oficina, lavagem, abastecimento, avaliação, documentação e providências relacionadas à venda.')}
  ${clausula('5.3', '', 'A CONSIGNATÁRIA adotará cuidados razoáveis na guarda e utilização e responderá por danos diretamente decorrentes de culpa comprovada de seus funcionários ou representantes, ressalvados desgaste natural, defeitos preexistentes, vícios ocultos, caso fortuito e força maior, conforme aplicável.')}
  ${secao(6, 'Declarações do proprietário')}
  ${clausula('6.1', '', 'O CONSIGNANTE declara ser legítimo proprietário do veículo ou possuir poderes suficientes para consigná-lo e comercializá-lo, responsabilizando-se pela veracidade das informações prestadas.')}
  ${clausula('6.2', '', 'O CONSIGNANTE responde pela procedência do veículo, evicção, vícios ocultos ou redibitórios preexistentes e por restrições ou débitos anteriores não informados à CONSIGNATÁRIA.')}
  ${clausula('6.3', '', 'Concretizada a venda, o CONSIGNANTE compromete-se a fornecer e assinar tempestivamente os documentos necessários à transferência de propriedade e aos procedimentos administrativos aplicáveis.')}
  ${secao(7, 'Venda e documentação')}
  ${clausula('7.1', '', 'Concretizada a negociação, as partes comprometem-se a praticar, dentro dos prazos legais, os atos necessários à formalização da venda, transferência do veículo e demais comunicações exigidas pelos órgãos de trânsito.')}
  ${clausula('7.2', '', 'Este contrato de consignação não substitui os procedimentos e documentos exigidos pelo órgão de trânsito para formalização da transferência ou comunicação da venda.')}
  ${secao(8, 'Prazo e retirada')}
  ${clausula('8.1', '', 'A consignação terá prazo inicial de 30 (trinta) dias, prorrogando-se automaticamente enquanto o veículo permanecer na posse da CONSIGNATÁRIA e não houver manifestação expressa em contrário.')}
  ${clausula('8.2', '', 'A retirada sem venda será formalizada pelo Termo de Devolução, encerrando-se a responsabilidade da CONSIGNATÁRIA pela guarda na data e hora da efetiva entrega.')}
  ${secao(9, 'Cobrança e foro')}
  ${clausula('9.1', '', 'Valores comprovadamente pagos por uma parte e que sejam de responsabilidade da outra poderão ser cobrados com os respectivos comprovantes, observada a legislação aplicável.')}
  ${clausula('9.2', '', `Para dirimir controvérsias decorrentes deste contrato, fica eleito o foro da Comarca de ${esc(c.foro)}, observadas as hipóteses legais de competência obrigatória.`)}
  ${quitado ? `
  <div class="caixa">
    ${faixa('Adendo – veículo já quitado pela consignatária')}
    <p>O veículo deste contrato foi recebido pela CONSIGNATÁRIA ${origem
      ? `como parte do pagamento do veículo placa <b>${esc(placa(origem.placa) || origem.marca_modelo)}</b>, conforme contrato de venda de <b>${dataCurta(origem.vendido_em)}</b>`
      : `por compra, pago em <b>${dataCurta(v.entrada_em)}</b>${v.forma_pagamento ? ' via ' + esc(v.forma_pagamento) : ''}`}, pelo valor de ${valor(v.valor_compra)}.
    O CONSIGNANTE declara que <b>recebeu integralmente esse valor</b> e que nada mais tem a receber. Por isso, não se aplicam as cláusulas 3.1 a 3.4 (repasse e comissão) nem o direito de retirada da cláusula 8. O valor da futura venda pertence integralmente à CONSIGNATÁRIA. O CONSIGNANTE se compromete a assinar a ATPV-e em favor do comprador que a CONSIGNATÁRIA indicar. As demais cláusulas, principalmente as de multas e débitos anteriores (4.1) e de procedência do veículo (6.2), continuam valendo.</p>
  </div>` : ''}
  ${localData(c, v.entrada_em)}
  ${assinaturas(assinaturaPessoa('CONSIGNANTE / PROPRIETÁRIO', p), assinaturaLoja(c))}
  ${testemunhas()}
  ${quitado ? '' : `
  <div style="page-break-inside: avoid">
    <div style="height:14px"></div>
    ${faixa('Termo de devolução do veículo - uso somente em caso de retirada sem venda')}
    <p>Declaro que nesta data recebi de volta o veículo objeto deste contrato de consignação, tendo realizado sua conferência quanto às condições aparentes de conservação e funcionamento, ressalvados o desgaste normal decorrente da movimentação autorizada e eventuais observações registradas abaixo.</p>
    <table class="quadro">
      <tr><td style="white-space:nowrap"><b>Km de Saída:</b> <span class="linha" style="min-width:90px"></span></td><td><b>Data:</b> ____/____/________ &nbsp; <b>Hora:</b> <span class="linha" style="min-width:60px"></span></td></tr>
      <tr><td class="rot">Observações:</td><td><span class="linha" style="min-width:100%"></span></td></tr>
      <tr><td></td><td><span class="linha" style="min-width:100%"></span></td></tr>
    </table>
    ${assinaturas('<b>CONSIGNANTE / PROPRIETÁRIO</b>', `<b>${esc(c.razao_social)}</b>`)}
  </div>`}`);
}

// tipo: 'entrada' (compra ou consignação, conforme o carro entrou), 'compra', 'consignacao' ou 'venda'.
// Na compra sem transferir a loja imprime os dois: o de compra e a consignação com adendo.
function gerarContrato(veiculoId, tipo) {
  const d = db.obterVeiculo(veiculoId);
  const c = db.obterConfig();
  if (tipo === 'venda') {
    if (!d.venda) throw db.erro('Este carro ainda não foi vendido', 404);
    if (d.venda.km_saida == null) {
      throw db.erro('O contrato de venda só sai com o km na entrega preenchido. Volte na página do carro, preencha o km e tente de novo.', 400);
    }
    d.trocaVeiculo = d.venda.troca_veiculo_id ? db.obterVeiculo(d.venda.troca_veiculo_id).veiculo : null;
    return contratoVenda(d, c);
  }
  if (tipo === 'compra') return contratoCompra(d, c);
  if (tipo === 'consignacao') return contratoConsignacao(d, c);
  if (tipo === 'entrada') return d.veiculo.tipo_entrada === 'compra' ? contratoCompra(d, c) : contratoConsignacao(d, c);
  throw db.erro('Tipo de contrato inválido', 404);
}

module.exports = { gerarContrato, reaisPorExtenso };
