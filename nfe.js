'use strict';
// Monta a NF-e (modelo 55, layout 4.00) no formato TXT de importação do Emissor NF-e do Sebrae
// (Sistema → Importar arquivos). O Sebrae só importa XML já assinado; o TXT entra como nota nova,
// que ele assina com o certificado e transmite para a SEFAZ. Os códigos fiscais seguem as notas que a loja já emite
// pelo Sebrae (entrada de consignação: CFOP 1917, ICMS CST 20 com redução de 90%, PIS/COFINS 07).
const crypto = require('node:crypto');
const db = require('./db');

const EMITENTE = {
  cnpj: '07793106000139',
  xNome: 'CORREA COMERCIO DE VEICULOS LTDA',
  xFant: 'CORREA VEICULOS',
  xLgr: 'AV PAPA JOAO PAULO II',
  nro: '3143',
  xBairro: 'JD OURO VERDE',
  cMun: '3505302',
  xMun: 'Barra Bonita',
  uf: 'SP',
  cep: '17342450',
  fone: '36418510',
  ie: '202093745118',
  im: '341940',
  cnae: '4511102',
  crt: '3',
};
const C_UF = { RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53 };

// Classificação fiscal (NCM) mais usada nas notas da loja
const NCM = {
  87032100: 'Carro até 1.0',
  87032210: 'Carro 1.0 a 1.5',
  87032310: 'Carro 1.5 a 3.0',
  87042190: 'Picape/utilitário diesel',
  87043190: 'Picape/utilitário gasolina/flex',
  87112010: 'Moto até 125 cc',
  87112020: 'Moto 125 a 250 cc',
  87113000: 'Moto 250 a 500 cc',
  87114000: 'Moto 500 a 800 cc',
  87115000: 'Moto acima de 800 cc',
};

// Cidades que já apareceram nas notas; as outras são buscadas pelo CEP no ViaCEP.
const MUNICIPIOS = {
  'barra bonita/SP': '3505302', 'igaracu do tiete/SP': '3520004', 'jau/SP': '3525300', 'bauru/SP': '3506003',
  'bariri/SP': '3505203', 'aracatuba/SP': '3502804', 'sao carlos/SP': '3548906', 'americana/SP': '3501608',
  'araras/SP': '3503307', 'boituva/SP': '3507001', 'itu/SP': '3523909', 'dois corregos/SP': '3514106',
  'mineiros do tiete/SP': '3529906', 'pederneiras/SP': '3537107', 'macatuba/SP': '3528205', 'lencois paulista/SP': '3526803',
};

const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const chaveCidade = (cidade, uf) => `${semAcento(cidade).toLowerCase().replace(/\s+/g, ' ').trim()}/${String(uf || '').toUpperCase()}`;
const digitos = s => String(s ?? '').replace(/\D/g, '');
// Campo do TXT: sem "|" nem quebra de linha (separam campos e registros)
const campoTxt = (s, max = 60) => String(s ?? '').replace(/[|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const dinheiro = centavos => (centavos / 100).toFixed(2);

// Dígito verificador da chave de acesso (módulo 11, pesos 2 a 9 da direita para a esquerda)
function digitoChave(chave43) {
  let soma = 0;
  for (let i = chave43.length - 1, peso = 2; i >= 0; i--, peso = peso === 9 ? 2 : peso + 1) soma += Number(chave43[i]) * peso;
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

function sugerirNcm(v) {
  const t = semAcento(`${v.marca_modelo} ${v.obs || ''}`).toUpperCase();
  const moto = /\b(MOTO|HONDA\s*\/?\s*(CG|CB|BIZ|POP|PCX|XRE|NXR|BROS|XR|CBR|ELITE|ADV|NC)|YAMAHA|YBR|FAZER|LANDER|XTZ|FACTOR|NMAX|SUZUKI\s*\/?\s*GSX|KAWASAKI|TITAN|FAN\b|DAFRA|SHINERAY|HARLEY|TRIUMPH|BMW\s*\/?\s*[FGRS]\s?\d{3,4})/.test(t);
  if (moto) {
    const cc = Number((t.match(/\b(\d{2,4})\s*(CC|CILINDRADAS)?\b/) || [])[1]);
    if (cc > 800) return '87115000';
    if (cc > 500) return '87114000';
    if (cc > 250) return '87113000';
    if (cc && cc <= 125) return '87112010';
    return '87112020';
  }
  const motor = t.match(/\b([1-6])[.,](\d)\b/);
  if (motor) {
    const litros = Number(`${motor[1]}.${motor[2]}`);
    if (litros <= 1.0) return '87032100';
    if (litros <= 1.5) return '87032210';
    return '87032310';
  }
  return '87032100';
}

function descricaoVeiculo(v) {
  const partes = [
    v.marca_modelo,
    v.ano_fab || v.ano_mod ? `${v.ano_fab || v.ano_mod}/${v.ano_mod || v.ano_fab}` : '',
    v.cor,
    v.placa ? `PLACA ${v.placa}` : '',
    v.renavam ? `RENAVAM ${v.renavam}` : '',
    v.chassi ? `CHASSI ${v.chassi}` : '',
  ];
  return semAcento(partes.filter(Boolean).join(' ')).toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 120);
}

async function codigoMunicipio(p) {
  const conhecido = MUNICIPIOS[chaveCidade(p.cidade, p.uf)];
  if (conhecido) return conhecido;
  const cep = digitos(p.cep);
  if (cep.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    if (j && /^\d{7}$/.test(j.ibge || '') && (!p.uf || String(j.uf).toUpperCase() === String(p.uf).toUpperCase())) return j.ibge;
  } catch { /* sem internet: pede para conferir a cidade */ }
  return null;
}

// Agora em Brasília, no formato da nota: 2026-10-29T16:08:00-03:00
function dataHoraNota(entrada) {
  const valor = entrada || new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 16);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(valor)) throw db.erro('Data e hora da nota inválidas');
  return `${valor.slice(0, 16)}:00-03:00`;
}


// Tabelas do RENAVE / DENATRAN usadas no grupo "Veículo Novo" (registro J) da nota de venda
const COMBUSTIVEIS = { '16': 'Flex (álcool/gasolina)', '02': 'Gasolina', '01': 'Álcool', '03': 'Diesel', '17': 'Gasolina/álcool/GNV', '18': 'Gasolina/elétrico' };
const TIPOS_VEICULO = { '06': 'Automóvel', '23': 'Caminhonete', '13': 'Camioneta', '25': 'Utilitário', '04': 'Motocicleta', '03': 'Motoneta', '14': 'Caminhão' };
const ESPECIES = { '1': 'Passageiro', '2': 'Carga', '3': 'Misto', '6': 'Especial' };
const CORES = { '01': 'Amarela', '02': 'Azul', '03': 'Bege', '04': 'Branca', '05': 'Cinza', '06': 'Dourada', '07': 'Grená', '08': 'Laranja', '09': 'Marrom', '10': 'Prata', '11': 'Preta', '12': 'Rosa', '13': 'Roxa', '14': 'Verde', '15': 'Vermelha', '16': 'Fantasia' };
const PINTURAS = { S: 'Sólida', M: 'Metálica', P: 'Perolizada' };

const TIPOS_CONSIGNACAO = ['consignacao', 'compra_sem_transferir', 'troca'];
const ehMoto = v => sugerirNcm(v).startsWith('8711');

// Tipos de nota. Os códigos seguem as notas que a loja já emite pelo Sebrae.
const TIPOS_NOTA = {
  entrada_consignacao: {
    nome: 'entrada de consignação', natOp: 'CONSIGNAÇÃO', cfop: 1917, tpNF: 0,
    pessoa: d => d.fornecedor, quem: 'dono',
    bloqueio: d => (TIPOS_CONSIGNACAO.includes(d.veiculo.tipo_entrada) ? null : 'A nota de entrada de consignação é só para carro em consignação, troca ou compra sem transferir'),
    valor: d => (d.veiculo.tipo_entrada === 'compra_sem_transferir' ? d.veiculo.valor_consignacao : d.veiculo.valor_compra),
  },
  venda: {
    nome: 'venda', natOp: 'SAIDA', cfop: 5102, tpNF: 1,
    pessoa: d => d.comprador, quem: 'comprador',
    bloqueio: d => (!d.venda ? 'Registre a venda antes de gerar a nota de venda'
      : d.veiculo.tipo_entrada !== 'compra' ? 'Por enquanto a nota de venda é só para carro comprado pela loja. Para carro consignado ou de troca, confirme com o contador qual nota emitir.'
        : null),
    valor: d => d.venda?.valor_venda,
  },
};

function proximoNumero() {
  const configurado = Number(db.obterConfig().nfe_ultimo_numero) || 0;
  const emitido = db.conexao.prepare('SELECT MAX(numero) AS n FROM nfe_notas').get().n || 0;
  return Math.max(configurado, emitido) + 1;
}

function lerFicha(veiculoId) {
  const linha = db.conexao.prepare('SELECT ficha_nfe FROM veiculos WHERE id = ?').get(veiculoId);
  try { return JSON.parse(linha?.ficha_nfe || '{}'); } catch { return {}; }
}

// Dados técnicos do carro para o RENAVE: o que já foi salvo, senão um palpite pelo cadastro.
function sugerirFicha(v, salvo = {}) {
  const t = semAcento(`${v.combustivel || ''}`).toUpperCase();
  const cor = semAcento(v.cor || '').toUpperCase();
  const codigoCor = Object.entries(CORES).find(([, nome]) => cor.startsWith(semAcento(nome).toUpperCase().slice(0, 4)))?.[0]
    || (cor.startsWith('BRANC') ? '04' : cor.startsWith('PRET') ? '11' : '16');
  const motor = semAcento(v.marca_modelo || '').match(/\b([1-6])[.,](\d)\b/);
  const moto = ehMoto(v);
  return {
    motor: '', potencia: '', cilindrada: motor ? String(Math.round(Number(`${motor[1]}.${motor[2]}`) * 1000) - (motor[1] === '1' && motor[2] === '0' ? 1 : 0)) : '',
    peso: '', cmt: '', eixos: '2',
    combustivel: /DIESEL/.test(t) ? '03' : /FLEX|ALCOOL\s*\/\s*GASOLINA|GASOLINA\s*\/\s*ALCOOL/.test(t) ? '16' : /GASOLINA/.test(t) ? '02' : /ALCOOL|ETANOL/.test(t) ? '01' : '16',
    tipo: moto ? '04' : '06', especie: '1', lotacao: moto ? '2' : '5', cor: codigoCor, pintura: 'S', marca_modelo: '1',
    ...Object.fromEntries(Object.entries(salvo).filter(([, x]) => x != null && x !== '')),
  };
}

// Valores calculados da venda (centavos), no padrão das vendas da loja:
// ICMS sobre 10% do valor (redução de 90%) a 18%; PIS 0,65% e COFINS 3% sobre (venda - compra).
function calcularVenda(valor, valorCompra) {
  const baseIcms = Math.round(valor * 0.10);
  const baseLucro = Math.max(0, valor - (valorCompra || 0));
  return {
    baseIcms, icms: Math.round(baseIcms * 0.18),
    baseLucro, pis: Math.round(baseLucro * 0.0065), cofins: Math.round(baseLucro * 0.03),
  };
}

// Formas de pagamento da venda no formato da nota (tPag). A soma fecha com o valor da nota.
function pagamentosVenda(vd, valor) {
  const lista = [];
  const add = (indPag, tPag, centavos, xPag = '') => { if (centavos > 0) lista.push({ indPag, tPag, xPag, valor: centavos }); };
  add(0, '17', vd.valor_pix);
  add(0, '16', vd.valor_deposito);
  add(0, '01', vd.valor_dinheiro);
  if (!vd.valor_pix && !vd.valor_deposito && !vd.valor_dinheiro) add(0, '99', vd.valor_entrada, campoTxt(vd.forma_entrada || 'Entrada', 60));
  add(0, '18', vd.valor_financiado);
  add(0, '99', vd.valor_troca, 'Veiculo usado recebido na troca');
  add(1, '05', vd.valor_saldo);
  const soma = lista.reduce((s, p) => s + p.valor, 0);
  if (soma > valor) throw db.erro('A soma das formas de pagamento passa do valor da venda. Confira a venda.');
  add(0, '99', valor - soma, 'Outros');
  return lista;
}

function opcoesTela() {
  return { ncms: NCM, combustiveis: COMBUSTIVEIS, tipos: TIPOS_VEICULO, especies: ESPECIES, cores: CORES, pinturas: PINTURAS };
}

// O que a tela mostra antes de gerar cada tipo de nota.
function sugestao(veiculoId, tipo) {
  const config = TIPOS_NOTA[tipo];
  if (!config) throw db.erro('Tipo de nota inválido', 404);
  const d = db.obterVeiculo(veiculoId);
  const anterior = db.conexao.prepare('SELECT * FROM nfe_notas WHERE veiculo_id = ? AND tipo = ? ORDER BY id DESC').get(veiculoId, tipo);
  const valor = anterior?.valor ?? config.valor(d) ?? null;
  return {
    tipo, permitido: !config.bloqueio(d), motivo: config.bloqueio(d),
    numero: anterior?.numero || proximoNumero(),
    ncm: anterior?.ncm || sugerirNcm(d.veiculo),
    valor,
    ficha: tipo === 'venda' ? sugerirFicha(d.veiculo, lerFicha(veiculoId)) : null,
    calculo: tipo === 'venda' && valor ? calcularVenda(valor, d.veiculo.valor_compra) : null,
    ultima: anterior ? { numero: anterior.numero, criado_em: anterior.criado_em } : null,
    opcoes: opcoesTela(),
  };
}
const sugestaoEntrada = id => sugestao(id, 'entrada_consignacao');

function validarFicha(f, v) {
  const n = (x, nome, max = 9999) => {
    const valor = Number(String(x ?? '').replace(',', '.'));
    if (!(valor > 0) || valor > max) throw db.erro(`Informe ${nome} (dados do CRLV)`);
    return valor;
  };
  const motor = campoTxt(f.motor, 21).toUpperCase();
  if (!motor) throw db.erro('Informe o número do motor (está no CRLV)');
  const chassi = String(v.chassi || '').toUpperCase().replace(/\s/g, '');
  if (chassi.length !== 17) throw db.erro('O chassi do carro precisa ter 17 caracteres. Corrija em "Editar dados".');
  if (!v.ano_fab || !v.ano_mod) throw db.erro('Preencha o ano de fabricação e o ano modelo em "Editar dados"');
  const peso = n(f.peso, 'o peso bruto em toneladas (ex.: 1,51)', 99);
  return {
    motor, chassi,
    // Moto costuma vir com "0CV" no CRLV: zero é aceito, vazio não
    potencia: String(f.potencia ?? '').trim() === '0' ? 0 : Math.round(n(f.potencia, 'a potência em CV (no CRLV de moto pode ser 0)')),
    cilindrada: Math.round(n(f.cilindrada, 'as cilindradas')),
    peso, cmt: f.cmt ? n(f.cmt, 'a CMT em toneladas', 99) : peso,
    eixos: String(Math.round(n(f.eixos || 2, 'os eixos', 99))),
    combustivel: COMBUSTIVEIS[f.combustivel] ? f.combustivel : (() => { throw db.erro('Escolha o combustível'); })(),
    tipo: TIPOS_VEICULO[f.tipo] ? f.tipo : (() => { throw db.erro('Escolha o tipo do veículo'); })(),
    especie: ESPECIES[f.especie] ? f.especie : '1',
    lotacao: String(Math.round(n(f.lotacao, 'a lotação', 999))),
    cor: CORES[f.cor] ? f.cor : (() => { throw db.erro('Escolha a cor (tabela DENATRAN)'); })(),
    pintura: PINTURAS[f.pintura] ? f.pintura : 'S',
    marca_modelo: /^\d{1,6}$/.test(String(f.marca_modelo || '')) ? String(f.marca_modelo) : '1',
  };
}

async function gerarNota(veiculoId, tipo, dados = {}) {
  const config = TIPOS_NOTA[tipo];
  if (!config) throw db.erro('Tipo de nota inválido', 404);
  const d = db.obterVeiculo(veiculoId);
  const v = d.veiculo;
  const p = config.pessoa(d);
  const bloqueio = config.bloqueio(d);
  if (bloqueio) throw db.erro(bloqueio);

  const numero = Number(dados.numero);
  if (!Number.isSafeInteger(numero) || numero < 1 || numero > 999999999) throw db.erro('Número da nota inválido');
  const ncm = String(dados.ncm || '');
  if (!NCM[ncm]) throw db.erro('Escolha o tipo do veículo (NCM)');
  const valor = Number(dados.valor);
  if (!Number.isSafeInteger(valor) || valor <= 0) throw db.erro('Informe o valor da nota');
  const usado = db.conexao.prepare('SELECT veiculo_id, tipo FROM nfe_notas WHERE numero = ? AND serie = 1').get(numero);
  if (usado && (usado.veiculo_id !== Number(veiculoId) || usado.tipo !== tipo)) throw db.erro(`A nota nº ${numero} já foi gerada para outra nota. Use o próximo número.`, 409);

  const doc = digitos(p?.cpf);
  const faltando = [
    !p?.nome && `nome do ${config.quem}`,
    ![11, 14].includes(doc.length) && `CPF/CNPJ do ${config.quem}`,
    !p?.endereco && 'rua',
    !p?.numero && 'número da casa',
    !p?.bairro && 'bairro',
    !p?.cidade && 'cidade',
    !/^[A-Z]{2}$/i.test(p?.uf || '') && 'UF',
    digitos(p?.cep).length !== 8 && 'CEP',
    !v.placa && !v.chassi && 'placa ou chassi',
  ].filter(Boolean);
  if (faltando.length) throw db.erro(`Para a nota, falta no cadastro: ${faltando.join(', ')}. Complete e tente de novo.`);
  const uf = p.uf.toUpperCase();
  if (!C_UF[uf]) throw db.erro(`UF do ${config.quem} inválida`);
  const ficha = tipo === 'venda' ? validarFicha({ ...lerFicha(veiculoId), ...(dados.ficha || {}) }, v) : null;
  const cMun = await codigoMunicipio(p);
  if (!cMun) throw db.erro(`Não achei o código IBGE da cidade "${p.cidade}/${uf}". Confira a cidade e o CEP do ${config.quem}.`);
  const pagamentos = tipo === 'venda' ? pagamentosVenda(d.venda, valor) : null;

  const dhEmi = dataHoraNota(dados.data);
  const aamm = dhEmi.slice(2, 4) + dhEmi.slice(5, 7);
  let cNF;
  do cNF = String(crypto.randomInt(1e7, 1e8)); while (Number(cNF) === numero);
  const chave43 = `${C_UF.SP}${aamm}${EMITENTE.cnpj}55001${String(numero).padStart(9, '0')}1${cNF}`;
  const cDV = digitoChave(chave43);
  const chave = chave43 + cDV;
  const valorTxt = dinheiro(valor);
  const fone = digitos(p.telefone);
  // Homologação: só para testar a importação no Sebrae em ambiente de teste (sem valor fiscal)
  const homologacao = dados.homologacao === true;
  const nomeDest = homologacao ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : semAcento(p.nome).toUpperCase();
  const vUn = (valor / 100).toFixed(10);
  // Venda a pessoa não contribuinte (indIEDest 9) vai como consumidor final, senão a SEFAZ rejeita (696)
  const indFinal = config.tpNF === 1 ? 1 : 0;
  const venda = tipo === 'venda';
  const c = venda ? calcularVenda(valor, v.valor_compra) : null;
  const zeros = n => Array(n).fill('0.00').join('|');

  // Layout TXT do Emissor Sebrae 4.01, copiado de notas exportadas pelo próprio emissor (1079 e 1054).
  const linhas = [
    'NOTAFISCAL|1',
    `A|4.00|NFe${chave}|`,
    `B|${C_UF.SP}|${cNF}|${config.natOp}|55|1|${numero}|${dhEmi}|${dhEmi}||${config.tpNF}|${uf === 'SP' ? 1 : 2}|${EMITENTE.cMun}||1|1|${cDV}|${homologacao ? 2 : 1}|1|||${indFinal}|0|||3|4.01_sebrae_b057|||`,
    `C|${EMITENTE.xNome}|${EMITENTE.xFant}|${EMITENTE.ie}||${EMITENTE.im}|${EMITENTE.cnae}|${EMITENTE.crt}||`,
    `C02|${EMITENTE.cnpj}|`,
    `C05|${EMITENTE.xLgr}|${EMITENTE.nro}||${EMITENTE.xBairro}|${EMITENTE.cMun}|${EMITENTE.xMun}|${EMITENTE.uf}|${EMITENTE.cep}|1058|BRASIL|${EMITENTE.fone}|`,
    `E|${campoTxt(nomeDest)}|9|||||`,
    `${doc.length === 11 ? 'E03' : 'E02'}|${doc}|`,
    `E05|${campoTxt(p.endereco)}|${campoTxt(p.numero)}||${campoTxt(p.bairro)}|${cMun}|${campoTxt(p.cidade)}|${uf}|${digitos(p.cep)}|1058|BRASIL|${fone.length >= 6 && fone.length <= 14 ? fone : ''}|`,
    'H|1||',
    `I|S${veiculoId}|||${campoTxt(descricaoVeiculo(v), 120)}|${ncm}|||${config.cfop}|UN|1.0000|${vUn}|${valorTxt}|||UN|1.0000|${vUn}|||||1|||||${venda ? 'SP020110' : ''}|`,
    ...(venda ? [`J|3|${ficha.chassi}|${ficha.cor}|${campoTxt(semAcento(v.cor || CORES[ficha.cor]).toUpperCase(), 40)}|${ficha.potencia}|${ficha.cilindrada}|${ficha.peso.toFixed(4)}|${ficha.peso.toFixed(4)}|1|${ficha.combustivel}|${ficha.motor}|${ficha.cmt.toFixed(4)}|${ficha.eixos}|${v.ano_mod}|${v.ano_fab}|${ficha.pintura}|${ficha.tipo}|${ficha.especie}|N|1|${ficha.marca_modelo}|${ficha.cor}|${ficha.lotacao}|0|`] : []),
    'M||',
    'N|',
    venda ? `N04|0|20|3|90.0000|${dinheiro(c.baseIcms)}|18.0000|${dinheiro(c.icms)}|||||||` : 'N04|0|20|3|90.00|0.00|18.0000|0.00|||||||',
    'Q|',
    venda ? `Q02|01|${dinheiro(c.baseLucro)}|0.6500|${dinheiro(c.pis)}|` : 'Q04|07|',
    'S|',
    venda ? `S02|01|${dinheiro(c.baseLucro)}|3.0000|${dinheiro(c.cofins)}|` : 'S04|07|',
    'W|',
    venda
      ? `W02|${dinheiro(c.baseIcms)}|${dinheiro(c.icms)}|${zeros(12)}|${valorTxt}|${zeros(6)}|${dinheiro(c.pis)}|${dinheiro(c.cofins)}|0.00|${valorTxt}|0.00|`
      : `W02|${zeros(14)}|${valorTxt}|${zeros(9)}|${valorTxt}|0.00|`,
    'W04c|0.00|',
    'W04e|0.00|',
    'W04g|0.00|',
    `X|${venda ? 1 : 0}|`,
    'YA',
    ...(venda ? pagamentos.map(pg => `YA01|${pg.indPag}|${pg.tPag}|${pg.xPag}|${dinheiro(pg.valor)}||||`) : ['YA01||90||0.00||||']),
  ];
  const conteudo = linhas.join('\r\n');

  if (!homologacao) {
    db.conexao.prepare(`INSERT INTO nfe_notas (veiculo_id, tipo, serie, numero, chave, valor, ncm) VALUES (?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(serie, numero) DO UPDATE SET chave = excluded.chave, valor = excluded.valor, ncm = excluded.ncm, criado_em = datetime('now', 'localtime')`)
      .run(veiculoId, tipo, numero, chave, valor, ncm);
    if (ficha) db.conexao.prepare('UPDATE veiculos SET ficha_nfe = ? WHERE id = ?').run(JSON.stringify({ ...ficha, chassi: undefined }), veiculoId);
  }

  const sufixo = tipo === 'venda' ? 'venda' : 'entrada-consignacao';
  return { conteudo, chave, numero, arquivo: `NFe-${numero}-${sufixo}-${(v.placa || 'S' + veiculoId).toUpperCase()}.txt` };
}
const gerarEntradaConsignacao = (id, dados) => gerarNota(id, 'entrada_consignacao', dados);

module.exports = { gerarNota, gerarEntradaConsignacao, sugestao, sugestaoEntrada, sugerirNcm, sugerirFicha, calcularVenda, pagamentosVenda, digitoChave, descricaoVeiculo, NCM };
