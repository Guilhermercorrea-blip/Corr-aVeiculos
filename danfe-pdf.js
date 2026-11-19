'use strict';
// DANFE em arquivo PDF (para "Baixar PDF"), gerado direto do XML autorizado, sem bibliotecas.
// Desenha o mesmo leiaute da página do danfe.js (caixas, textos e código de barras Code-128C em vetor) com as fontes
// padrão do PDF (Helvetica), então o arquivo é pequeno e o texto fica selecionável. Em homologação leva "SEM VALOR FISCAL".
const fs = require('node:fs');
const path = require('node:path');
const { lerNota, valores128C, PADROES_128 } = require('./danfe');

const MM = 72 / 25.4; // pontos por milímetro
const PAG_H = 297;

// Larguras da Helvetica (1/1000 do corpo) para quebrar e centralizar o texto
const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

function larguraTexto(texto, tam, negrito) {
  const tab = negrito ? W_BOLD : W_REG;
  let s = 0;
  for (const c of String(texto)) { const k = c.charCodeAt(0); s += (k >= 32 && k <= 126 ? tab[k - 32] : 556); }
  return (s * tam) / 1000; // em pontos
}

// ---------- Formatação (igual à da página) ----------
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

// ---------- Desenho ----------
class Pagina {
  constructor() { this.ops = []; }
  y(ymm) { return (PAG_H - ymm) * MM; }
  linha(w) { this.ops.push(`${w} w`); }
  caixa(x, y, w, h, largura = 0.5) { this.ops.push(`${largura} w ${(x * MM).toFixed(2)} ${this.y(y + h).toFixed(2)} ${(w * MM).toFixed(2)} ${(h * MM).toFixed(2)} re S`); }
  retaCheia(x, y, w, h) { this.ops.push(`${(x * MM).toFixed(2)} ${this.y(y + h).toFixed(2)} ${(w * MM).toFixed(2)} ${(h * MM).toFixed(2)} re f`); }
  tracejado(x1, y, x2) { this.ops.push(`[3 2] 0 d 0.5 w ${(x1 * MM).toFixed(2)} ${this.y(y).toFixed(2)} m ${(x2 * MM).toFixed(2)} ${this.y(y).toFixed(2)} l S [] 0 d`); }
  cor(r, g, b) { this.ops.push(`${r} ${g} ${b} rg`); }

  // Texto em uma posição (x, y do TOPO da linha, em mm). align: 'e' | 'c' | 'd'
  texto(str, x, y, { tam = 8, negrito = false, align = 'e', w = 0 } = {}) {
    const t = this.escapar(str);
    if (!t) return;
    const larg = larguraTexto(str, tam, negrito);
    let px = x * MM;
    if (align === 'c') px = (x + w / 2) * MM - larg / 2;
    else if (align === 'd') px = (x + w) * MM - larg;
    this.ops.push(`BT /${negrito ? 'F2' : 'F1'} ${tam} Tf ${px.toFixed(2)} ${(this.y(y) - tam * 0.8).toFixed(2)} Td (${t}) Tj ET`);
  }
  // Quebra em linhas que cabem na largura (mm) e escreve; devolve a quantidade de linhas
  paragrafo(str, x, y, w, { tam = 7, negrito = false, align = 'e', entre = 1.15, max = 99 } = {}) {
    const palavras = String(str || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const linhas = [];
    let atual = '';
    for (const p of palavras) {
      const tenta = atual ? atual + ' ' + p : p;
      if (larguraTexto(tenta, tam, negrito) <= w * MM || !atual) atual = tenta; else { linhas.push(atual); atual = p; }
    }
    if (atual) linhas.push(atual);
    linhas.slice(0, max).forEach((l, i) => this.texto(l, x, y + i * tam * entre / MM, { tam, negrito, align, w }));
    return Math.min(linhas.length, max);
  }
  // Campo com rótulo pequeno em cima e valor embaixo (como na DANFE)
  campo(x, y, w, h, rotulo, valor, { negrito = true, tam = 8, align = 'e' } = {}) {
    this.caixa(x, y, w, h);
    this.texto(String(rotulo).toUpperCase(), x + 0.9, y + 0.5, { tam: 5 });
    let v = String(valor ?? ''), t = tam;
    while (t > 5 && larguraTexto(v, t, negrito) > (w - 1.8) * MM) t -= 0.5; // reduz o corpo para caber
    this.texto(v, x + 0.9, y + h - t / MM - 0.8, { tam: t, negrito, align, w: w - 1.8 });
  }
  escapar(s) {
    return Buffer.from(String(s ?? ''), 'latin1').toString('latin1').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[\r\n]+/g, ' ');
  }
  barras(digitos, x, y, w, h) {
    const valores = valores128C(digitos);
    const modulos = valores.reduce((s, v) => s + [...PADROES_128[v]].reduce((a, c) => a + Number(c), 0), 0);
    const m = w / (modulos + 20); // 10 módulos de silêncio de cada lado
    let px = x + 10 * m;
    this.cor(0, 0, 0);
    for (const v of valores) {
      [...PADROES_128[v]].forEach((c, i) => { const largura = Number(c) * m; if (i % 2 === 0) this.retaCheia(px, y, largura, h); px += largura; });
    }
  }
}

// Logo da loja (public/img/logo.jpg): JPEG entra direto no PDF, sem recompressão
function lerLogo() {
  try {
    const b = fs.readFileSync(path.join(__dirname, 'public', 'img', 'logo.jpg'));
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xFF) { i++; continue; }
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xC0 && m <= 0xC3) return { jpg: b, h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7), comp: b[i + 9] };
      i += 2 + len;
    }
  } catch { /* sem logo: o DANFE sai só com o nome */ }
  return null;
}
const LOGO = lerLogo();

function desenhar(n) {
  const p = new Pagina();
  const e = n.emit, d = n.dest, t = n.tot;
  if (n.homologacao) {
    // marca d'água inclinada, bem clara, atrás do conteúdo
    const cx = 105 * MM, cy = p.y(150);
    const ang = 30 * Math.PI / 180, c = Math.cos(ang).toFixed(4), s = Math.sin(ang).toFixed(4);
    const larg = larguraTexto('SEM VALOR FISCAL', 54, true);
    p.ops.push(`0.97 0.82 0.82 rg BT /F2 54 Tf ${c} ${s} ${(-s)} ${c} ${(cx - (larg / 2) * c).toFixed(2)} ${(cy - (larg / 2) * s).toFixed(2)} Tm (SEM VALOR FISCAL) Tj ET 0 0 0 rg`);
  }
  p.cor(0, 0, 0);
  const X = 7, L = 196;

  // Canhoto
  p.caixa(X, 7, 160, 8);
  p.texto(`RECEBEMOS DE ${e.nome} OS PRODUTOS/SERVIÇOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO`.toUpperCase().slice(0, 120), X + 1, 8, { tam: 5.5 });
  p.campo(X, 15, 50, 8, 'Data de recebimento', '');
  p.campo(X + 50, 15, 110, 8, 'Identificação e assinatura do recebedor', '');
  p.caixa(X + 160, 7, 36, 16);
  p.texto('NF-e', X + 160, 9, { tam: 11, negrito: true, align: 'c', w: 36 });
  p.texto(`Nº ${numeroNota(n.numero)}`, X + 160, 14, { tam: 8, negrito: true, align: 'c', w: 36 });
  p.texto(`SÉRIE ${String(n.serie).padStart(3, '0')}`, X + 160, 18.5, { tam: 8, negrito: true, align: 'c', w: 36 });
  p.tracejado(X, 25, X + L);

  // Cabeçalho: emitente | DANFE | chave
  p.caixa(X, 27, 70, 30); p.caixa(X + 70, 27, 40, 30); p.caixa(X + 110, 27, 86, 30);
  // com logo: logo à esquerda (24 mm) e nome/endereço ao lado; sem logo: texto em toda a largura
  const tx = LOGO ? X + 26 : X + 2, tw = LOGO ? 43 : 66;
  if (LOGO) {
    const lw = 23, lh = lw * LOGO.h / LOGO.w;
    p.ops.push(`q ${(lw * MM).toFixed(2)} 0 0 ${(lh * MM).toFixed(2)} ${((X + 2) * MM).toFixed(2)} ${p.y(42 + lh / 2).toFixed(2)} cm /Im1 Do Q`);
  }
  const linhasNome = p.paragrafo(e.nome, tx, 30, tw, { tam: LOGO ? 8.5 : 11, negrito: true, align: 'c', max: 3 });
  p.paragrafo(`${e.xLgr}, ${e.nro} - ${e.bairro} - ${e.mun}/${e.uf} - CEP ${cep(e.cep)}${e.fone ? ' - Fone ' + fone(e.fone) : ''}`, tx, 30 + linhasNome * (LOGO ? 3.8 : 4.8) + 1.5, tw, { tam: LOGO ? 6 : 6.5, align: 'c', max: 5 });
  p.texto('DANFE', X + 70, 28.5, { tam: 13, negrito: true, align: 'c', w: 40 });
  p.paragrafo('Documento Auxiliar da Nota Fiscal Eletrônica', X + 72, 33.5, 36, { tam: 6, align: 'c', max: 2 });
  p.texto('0 - Entrada', X + 70, 38.5, { tam: 6.5, align: 'c', w: 40 });
  p.texto('1 - Saída', X + 74, 41.5, { tam: 6.5 });
  p.caixa(X + 97, 40.8, 7, 5.2); p.texto(String(n.tpNF), X + 97, 41.2, { tam: 10, negrito: true, align: 'c', w: 7 });
  p.texto(`Nº ${numeroNota(n.numero)}`, X + 70, 47, { tam: 8, negrito: true, align: 'c', w: 40 });
  p.texto(`SÉRIE ${String(n.serie).padStart(3, '0')}`, X + 70, 50.3, { tam: 7.5, negrito: true, align: 'c', w: 40 });
  p.texto('FOLHA 1/1', X + 70, 53.6, { tam: 6.5, align: 'c', w: 40 });
  p.barras(n.chave, X + 112, 29, 82, 11);
  p.texto('CHAVE DE ACESSO', X + 111, 41.3, { tam: 5 });
  p.texto(chaveFormatada(n.chave), X + 111, 43.5, { tam: 8, negrito: true, w: 84 });
  p.paragrafo('Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora', X + 111, 48, 84, { tam: 6.5, max: 3 });

  p.campo(X, 57, 98, 8, 'Natureza da operação', n.natOp);
  p.campo(X + 98, 57, 98, 8, 'Protocolo de autorização de uso', `${n.protocolo} - ${data(n.dhRecbto)} ${hora(n.dhRecbto)}`);
  p.campo(X, 65, 65, 8, 'Inscrição estadual', e.ie);
  p.campo(X + 65, 65, 65, 8, 'Inscrição estadual do subst. trib.', '');
  p.campo(X + 130, 65, 66, 8, 'CNPJ', doc(e.cnpj));

  // Destinatário
  p.texto('DESTINATÁRIO / REMETENTE', X, 74, { tam: 6.5, negrito: true });
  p.campo(X, 77, 112, 8, 'Nome / razão social', d.nome);
  p.campo(X + 112, 77, 44, 8, 'CNPJ / CPF', doc(d.doc));
  p.campo(X + 156, 77, 40, 8, 'Data da emissão', data(n.dhEmi));
  p.campo(X, 85, 100, 8, 'Endereço', `${d.xLgr}, ${d.nro}`);
  p.campo(X + 100, 85, 40, 8, 'Bairro / distrito', d.bairro);
  p.campo(X + 140, 85, 26, 8, 'CEP', cep(d.cep));
  p.campo(X + 166, 85, 30, 8, 'Data da saída/entrada', data(n.dhSaiEnt));
  p.campo(X, 93, 90, 8, 'Município', d.mun);
  p.campo(X + 90, 93, 34, 8, 'Fone / fax', fone(d.fone));
  p.campo(X + 124, 93, 10, 8, 'UF', d.uf);
  p.campo(X + 134, 93, 36, 8, 'Inscrição estadual', d.ie);
  p.campo(X + 170, 93, 26, 8, 'Hora da saída/entrada', hora(n.dhSaiEnt));

  // Cálculo do imposto
  p.texto('CÁLCULO DO IMPOSTO', X, 102, { tam: 6.5, negrito: true });
  const linha1 = [['Base de cálc. do ICMS', t.vBC], ['Valor do ICMS', t.vICMS], ['Base cálc. ICMS ST', t.vBCST], ['Valor do ICMS ST', t.vST], ['V. imp. importação', t.vII], ['V. ICMS UF remet.', t.vICMSUFRemet], ['Valor do FCP', t.vFCP], ['Valor do PIS', t.vPIS], ['V. total produtos', t.vProd]];
  const linha2 = [['Valor do frete', t.vFrete], ['Valor do seguro', t.vSeg], ['Desconto', t.vDesc], ['Outras despesas', t.vOutro], ['Valor total IPI', t.vIPI], ['V. ICMS UF dest.', t.vICMSUFDest], ['V. tot. tributos', t.vTotTrib], ['Valor da COFINS', t.vCOFINS], ['Valor total da nota', t.vNF]];
  const cw = L / 9;
  linha1.forEach(([r, v], i) => p.campo(X + i * cw, 105, cw, 8, r, dinheiro(v), { align: 'd', tam: 7.5 }));
  linha2.forEach(([r, v], i) => p.campo(X + i * cw, 113, cw, 8, r, dinheiro(v), { align: 'd', tam: 7.5 }));

  // Transportador
  p.texto('TRANSPORTADOR / VOLUMES TRANSPORTADOS', X, 122, { tam: 6.5, negrito: true });
  p.campo(X, 125, 70, 8, 'Nome / razão social', '');
  p.campo(X + 70, 125, 36, 8, 'Frete por conta', MOD_FRETE[n.modFrete] || n.modFrete);
  p.campo(X + 106, 125, 26, 8, 'Código ANTT', '');
  p.campo(X + 132, 125, 26, 8, 'Placa do veículo', '');
  p.campo(X + 158, 125, 10, 8, 'UF', '');
  p.campo(X + 168, 125, 28, 8, 'CNPJ / CPF', '');

  // Produtos
  p.texto('DADOS DOS PRODUTOS / SERVIÇOS', X, 134, { tam: 6.5, negrito: true });
  const cols = [['Código', 12], ['Descrição do produto / serviço', 52], ['NCM/SH', 15], ['O/CST', 9], ['CFOP', 10], ['Un', 8], ['Quant.', 13], ['Valor unit.', 17], ['Valor total', 17], ['B. cálc. ICMS', 14], ['Valor ICMS', 13], ['Valor IPI', 8], ['Alíq. ICMS', 8]];
  let cx = X;
  for (const [nome, w] of cols) { p.caixa(cx, 137, w, 6); p.paragrafo(nome.toUpperCase(), cx + 0.4, 137.6, w - 0.8, { tam: 4.6, align: 'c', max: 2 }); cx += w; }
  let y = 143;
  for (const i of n.itens) {
    const vals = [i.codigo, i.descricao, i.ncm, i.cst, i.cfop, i.un, quantidade(i.qtd), dinheiro(i.vUn), dinheiro(i.vProd), dinheiro(i.vBC), dinheiro(i.vICMS), '0,00', dinheiro(i.pICMS)];
    const altura = 12;
    cx = X;
    cols.forEach(([, w], k) => {
      p.caixa(cx, y, w, altura);
      if (k === 1) p.paragrafo(vals[k], cx + 0.6, y + 0.8, w - 1.2, { tam: 6, max: 4 });
      else p.texto(String(vals[k]), cx, y + 0.8, { tam: 6.2, align: k >= 6 ? 'd' : 'c', w: w - (k >= 6 ? 0.8 : 0) });
      cx += w;
    });
    y += altura;
  }

  // Dados adicionais
  y += 3;
  p.texto('DADOS ADICIONAIS', X, y, { tam: 6.5, negrito: true });
  y += 3;
  p.caixa(X, y, 130, 42); p.caixa(X + 130, y, 66, 42);
  p.texto('INFORMAÇÕES COMPLEMENTARES', X + 0.9, y + 0.5, { tam: 5 });
  p.texto('RESERVADO AO FISCO', X + 130.9, y + 0.5, { tam: 5 });
  p.paragrafo(`${n.homologacao ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL. ' : ''}${n.infCpl || ''}`, X + 1, y + 3.6, 128, { tam: 7, max: 9 });
  return p.ops.join('\n');
}

// ---------- Montagem do arquivo PDF ----------
function gerarDanfePdf(xml) {
  const n = lerNota(xml);
  if (n.cStat && n.cStat !== '100') throw new Error('Esta nota não está autorizada: não dá para gerar o PDF do DANFE.');
  const conteudo = Buffer.from(desenhar(n), 'latin1');
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 5 0 R /F2 6 0 R >>${LOGO ? ' /XObject << /Im1 7 0 R >>' : ''} >> /Contents 4 0 R >>`,
    null, // conteúdo (stream)
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  if (LOGO) objetos.push({ imagem: LOGO });
  const partes = [Buffer.from('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n', 'latin1')];
  const offsets = [];
  let pos = partes[0].length;
  objetos.forEach((o, i) => {
    offsets.push(pos);
    const corpo = o && o.imagem
      ? Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${o.imagem.w} /Height ${o.imagem.h} /ColorSpace ${o.imagem.comp === 1 ? '/DeviceGray' : '/DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${o.imagem.jpg.length} >>\nstream\n`, 'latin1'), o.imagem.jpg, Buffer.from('\nendstream\nendobj\n', 'latin1')])
      : o === null
      ? Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< /Length ${conteudo.length} >>\nstream\n`, 'latin1'), conteudo, Buffer.from('\nendstream\nendobj\n', 'latin1')])
      : Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1');
    partes.push(corpo);
    pos += corpo.length;
  });
  let xref = `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += String(off).padStart(10, '0') + ' 00000 n \n';
  xref += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  partes.push(Buffer.from(xref, 'latin1'));
  return { pdf: Buffer.concat(partes), numero: n.numero, chave: n.chave };
}

module.exports = { gerarDanfePdf, larguraTexto };
