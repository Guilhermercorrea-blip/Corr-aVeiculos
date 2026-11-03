'use strict';
// Placa de preço A4 para o vidro: preenche com o carro/anúncio, a equipe ajusta e imprime.

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const id = Number(new URLSearchParams(location.search).get('id'));
const form = $('form');
const MAX_OPCIONAIS = 4;
let loja = {};

// Ícones simples em preto, desenhados em SVG (imprimem nítidos em qualquer impressora)
const traco = 'fill="none" stroke="#000" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"';
const ICONES = {
  'Ar-condicionado': `<svg viewBox="0 0 100 100" ${traco}><path d="M50 8v84M13.6 29l72.8 42M13.6 71l72.8-42"/><path d="M40 14l10 10 10-10M40 86l10-10 10 10M16 41l14-4-4-14M84 59l-14 4 4 14M16 59l14 4-4 14M84 41l-14-4 4-14"/></svg>`,
  'Direção hidráulica': `<svg viewBox="0 0 100 100" ${traco}><circle cx="50" cy="50" r="40" stroke-width="8"/><circle cx="50" cy="55" r="9" fill="#000"/><path d="M12 46c12-6 26-8 38-8s26 2 38 8M44 62l-10 26M56 62l10 26" stroke-width="8"/></svg>`,
  'Direção elétrica': `<svg viewBox="0 0 100 100" ${traco}><circle cx="50" cy="50" r="40" stroke-width="8"/><path d="M12 46c12-6 26-8 38-8s26 2 38 8" stroke-width="8"/><path d="M54 52l-10 16h12l-8 16" stroke-width="6"/></svg>`,
  'Vidros elétricos': `<svg viewBox="0 0 100 100" ${traco}><path d="M14 80V34l26-20h46v66z"/><path d="M60 28v40M50 38l10-10 10 10M50 58l10 10 10-10"/></svg>`,
  'Travas elétricas': `<svg viewBox="0 0 100 100" ${traco}><rect x="20" y="44" width="60" height="44" rx="6"/><path d="M32 44V30a18 18 0 0 1 36 0v14"/><circle cx="50" cy="64" r="5" fill="#000"/><path d="M50 69v8"/></svg>`,
  'Alarme': `<svg viewBox="0 0 100 100" ${traco}><path d="M50 10l34 12v24c0 22-15 36-34 44C31 82 16 68 16 46V22z"/><path d="M50 34v18M50 62v2"/></svg>`,
  'Rádio original de fábrica': `<svg viewBox="0 0 100 100" ${traco}><rect x="10" y="30" width="80" height="50" rx="6"/><circle cx="34" cy="55" r="12"/><path d="M58 46h22M58 56h22M58 66h14M30 30l40-16"/></svg>`,
  'Central multimídia': `<svg viewBox="0 0 100 100" ${traco}><rect x="10" y="18" width="80" height="54" rx="6"/><path d="M42 34l18 11-18 11zM36 86h28M50 72v14"/></svg>`,
  'Câmera de ré': `<svg viewBox="0 0 100 100" ${traco}><path d="M10 34h18l8-12h28l8 12h18v46H10z"/><circle cx="50" cy="56" r="15"/></svg>`,
  'Sensor de estacionamento': `<svg viewBox="0 0 100 100" ${traco}><path d="M10 80h30V58l-8-14H10"/><path d="M58 40c6 6 6 16 0 22M70 32c11 11 11 27 0 38M82 24c16 16 16 38 0 54"/></svg>`,
  'Rodas de liga leve': `<svg viewBox="0 0 100 100" ${traco}><circle cx="50" cy="50" r="40"/><circle cx="50" cy="50" r="10"/><path d="M50 40V14M59.5 46.9l24.7-8M55.9 58.1l15.3 21M44.1 58.1l-15.3 21M40.5 46.9l-24.7-8"/></svg>`,
  'Airbags': `<svg viewBox="0 0 100 100" ${traco}><circle cx="30" cy="22" r="9"/><path d="M30 31v28l16 26M30 47l18-6"/><circle cx="68" cy="42" r="20"/></svg>`,
  'Freios ABS': `<svg viewBox="0 0 100 100" ${traco}><circle cx="50" cy="50" r="30"/><path d="M14 30a44 44 0 0 0 0 40M86 30a44 44 0 0 1 0 40"/><text x="50" y="58" text-anchor="middle" font-family="Arial" font-weight="900" font-size="22" fill="#000" stroke="none">ABS</text></svg>`,
  'Bancos de couro': `<svg viewBox="0 0 100 100" ${traco}><path d="M30 12h22l4 40h22l6 22H40z"/><path d="M40 74l-6 16M78 74l4 16"/></svg>`,
  'Piloto automático': `<svg viewBox="0 0 100 100" ${traco}><path d="M14 72a38 38 0 1 1 72 0"/><path d="M50 62l18-26"/><circle cx="50" cy="64" r="6" fill="#000"/></svg>`,
  'Teto solar': `<svg viewBox="0 0 100 100" ${traco}><path d="M12 70l12-34h52l12 34z"/><rect x="34" y="42" width="32" height="16"/><path d="M50 8v12M28 14l6 10M72 14l-6 10"/></svg>`,
  'Câmbio automático': `<svg viewBox="0 0 100 100" ${traco}><rect x="24" y="10" width="52" height="80" rx="8"/><text x="50" y="58" text-anchor="middle" font-family="Arial" font-weight="900" font-size="30" fill="#000" stroke="none">A</text></svg>`,
  'Completo': `<svg viewBox="0 0 100 100" ${traco}><path d="M50 10l12 26 28 3-21 19 6 28-25-14-25 14 6-28-21-19 28-3z"/></svg>`,
};
const icone = nome => ICONES[nome] || ICONES.Completo;
const TELEFONE = `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="#000"/><path d="M36 26c3-2 6 0 7 2l5 10c1 3 0 5-2 6l-4 3c3 7 9 13 16 16l3-4c1-2 3-3 6-2l10 5c2 1 4 4 2 7-3 7-9 10-15 9-20-3-35-18-38-38-1-6 2-11 10-14z" fill="#fff"/></svg>`;
const WHATSAPP = `<svg viewBox="0 0 100 100"><path d="M50 4a46 46 0 0 0-40 69L4 96l24-6A46 46 0 1 0 50 4z" fill="#000"/><path d="M50 14a36 36 0 0 0-31 55l-4 13 14-4a36 36 0 1 0 21-64z" fill="#fff"/><path d="M38 30c2-1 4 0 5 2l4 9c1 2 0 4-1 5l-3 3c3 6 8 11 14 14l3-3c1-1 3-2 5-1l9 4c2 1 3 3 2 5-2 6-7 8-12 7-17-3-29-15-32-32-1-5 1-10 6-13z" fill="#000"/></svg>`;
const PINO = `<svg viewBox="0 0 80 100"><path d="M40 4C21 4 6 19 6 38c0 26 34 58 34 58s34-32 34-58C74 19 59 4 40 4z" fill="#000"/><circle cx="40" cy="38" r="13" fill="#fff"/></svg>`;

async function api(metodo, url, corpo) {
  const r = await fetch('/api' + url, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : {},
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (r.status === 401) { location.href = '/login.html'; throw new Error('Faça login para continuar'); }
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || 'Erro ' + r.status);
  return dados;
}

function aviso(texto, erro = false) {
  $('aviso').textContent = texto;
  $('aviso').className = 'aviso' + (erro ? ' erro' : '');
}

// "46.900", "46900" ou "46.900,00" -> centavos
function paraCentavos(texto) {
  let s = String(texto || '').replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Confira o preço. Exemplo: 46.900');
  return Math.round(n * 100);
}

// "GM/MONTANA LS" -> modelo MONTANA, versão LS; "Fiat Strada Hard Working" -> STRADA / HARD WORKING
const MARCAS = ['GM', 'CHEVROLET', 'VW', 'VOLKSWAGEN', 'FIAT', 'FORD', 'RENAULT', 'HONDA', 'TOYOTA', 'HYUNDAI', 'NISSAN', 'PEUGEOT', 'CITROEN',
  'JEEP', 'MITSUBISHI', 'KIA', 'YAMAHA', 'SUZUKI', 'BMW', 'AUDI', 'MERCEDES', 'MERCEDES-BENZ', 'CAOA', 'CHERY', 'JAC', 'TROLLER', 'LAND', 'RAM'];
function separarModelo(marcaModelo) {
  let partes = String(marcaModelo || '').toUpperCase().replace(/\//g, ' ').split(/\s+/).filter(Boolean);
  if (partes.length > 1 && MARCAS.includes(partes[0])) partes = partes.slice(1);
  return { modelo: partes[0] || '', versao: partes.slice(1).join(' ') };
}

function ler() {
  const e = form.elements;
  const destaque = e.destaque_opcao.value === 'outro' ? e.destaque_outro.value.trim() : e.destaque_opcao.value;
  return {
    modelo: e.modelo.value.trim(),
    versao: e.versao.value.trim(),
    ano: e.ano.value.trim(),
    destaque,
    preco: paraCentavos(e.preco.value),
    opcionais: [...form.querySelectorAll('[name=opcional]:checked')].map(c => c.value),
  };
}

// Diminui a letra até o texto caber na largura da folha
function caber(el, max) {
  let tamanho = max;
  el.style.fontSize = tamanho + 'mm';
  while (el.scrollWidth > el.clientWidth && tamanho > 6) {
    tamanho -= 1;
    el.style.fontSize = tamanho + 'mm';
  }
}

function desenhar() {
  let d;
  try { d = ler(); aviso(''); } catch (e) { aviso(e.message, true); return; }
  const inteiro = d.preco === null ? null : Math.floor(d.preco / 100).toLocaleString('pt-BR');
  const cent = d.preco === null ? '' : String(d.preco % 100).padStart(2, '0');
  const endereco = [loja.endereco, loja.cidade && loja.cidade.replace('/', ' - ')].filter(Boolean);
  $('folha').innerHTML = `
    <div class="cab"><div class="barra esq"></div><img src="img/logo.jpg" alt="Corrêa Veículos"><div class="barra dir"></div></div>
    <div class="linha"></div>
    <div class="modelo" id="t-modelo">${esc(d.modelo || 'MODELO')}</div>
    ${d.versao ? `<div class="versao"><span id="t-versao">${esc(d.versao)}</span></div>` : ''}
    ${d.ano ? `<div class="ano">${esc(d.ano)}</div>` : ''}
    ${d.destaque ? `<div class="destaque" id="t-destaque">${esc(d.destaque)}</div>` : ''}
    <div class="preco ${d.preco === null ? 'consulta' : ''}">${d.preco === null
      ? '<span class="valor">CONSULTE</span>'
      : `<span class="rs">R$</span><span class="valor">${inteiro}</span><span class="cent">,${cent}</span>`}</div>
    <div class="opc">${d.opcionais.map(o => `<div class="item">${icone(o)}<span>${esc(o)}</span></div>`).join('')}</div>
    <div class="linha"></div>
    <div class="contatos">
      <div class="contato">${TELEFONE}<span>${formatarFone(loja.telefone)}</span></div>
      <div class="sep"></div>
      <div class="contato">${WHATSAPP}<span>${formatarFone(loja.whatsapp)}</span></div>
    </div>
    <div class="linha"></div>
    <div class="endereco">${PINO}<span>${endereco.map(esc).join('<br>')}</span></div>`;
  caber($('t-modelo'), 60);
  if ($('t-versao')) caber($('t-versao'), 15);
  if ($('t-destaque')) caber($('t-destaque'), 15);
  ajustarEscala();
}

function formatarFone(f) {
  const m = String(f || '').match(/^\s*(\(\d{2}\))\s*(.+)$/);
  return m ? `<small>${esc(m[1])}</small> ${esc(m[2])}` : esc(f);
}

// Na tela, a folha encolhe para caber; na impressão sai no tamanho real
function ajustarEscala() {
  const area = document.querySelector('.previa');
  const largura = $('folha').offsetWidth, altura = $('folha').offsetHeight;
  const escala = Math.min(1, (area.clientWidth - 48) / largura, window.innerWidth > 900 ? (window.innerHeight - 48) / altura : 1);
  $('escala').style.transform = `scale(${escala})`;
  $('escala').style.height = altura * escala + 'px';
  $('escala').style.width = largura * escala + 'px';
}

async function salvar() {
  const dados = ler();
  await api('PUT', `/veiculos/${id}/placa`, dados);
}

async function iniciar() {
  if (!Number.isInteger(id) || id <= 0) { aviso('Carro não informado.', true); return; }
  const [info, opcoes] = await Promise.all([api('GET', `/veiculos/${id}/placa`), api('GET', '/site/descricao/opcoes').catch(() => ({ acessorios: [] }))]);
  loja = info.loja;
  const v = info.veiculo;
  $('carro').textContent = `${v.marca_modelo}${v.ano_fab || v.ano_mod ? ' · ' + [v.ano_fab, v.ano_mod].filter(Boolean).join('/') : ''}`;
  const sugerido = separarModelo(v.marca_modelo);
  const s = info.salvo || {
    modelo: sugerido.modelo,
    versao: (info.anuncio?.versao || sugerido.versao || '').toUpperCase(),
    ano: String(v.ano_mod || v.ano_fab || ''),
    destaque: '',
    preco: info.anuncio?.preco ?? v.valor_consignacao ?? null,
    opcionais: (info.anuncio?.opcionais || []).slice(0, MAX_OPCIONAIS),
  };
  const e = form.elements;
  e.modelo.value = s.modelo || '';
  e.versao.value = s.versao || '';
  e.ano.value = s.ano || '';
  const conhecido = [...e.destaque_opcao.options].some(o => o.value === s.destaque);
  e.destaque_opcao.value = !s.destaque ? '' : conhecido ? s.destaque : 'outro';
  e.destaque_outro.value = conhecido ? '' : s.destaque || '';
  $('campo-destaque-outro').hidden = e.destaque_opcao.value !== 'outro';
  e.preco.value = s.preco == null ? '' : (s.preco / 100).toLocaleString('pt-BR');
  const lista = [...new Set([...(opcoes.acessorios || []), 'Câmbio automático', 'Completo', ...(s.opcionais || [])])];
  $('opcionais').innerHTML = lista.map(o => `<label><input type="checkbox" name="opcional" value="${esc(o)}" ${s.opcionais?.includes(o) ? 'checked' : ''}> ${esc(o)}</label>`).join('');
  document.title = `Placa ${s.modelo || v.marca_modelo} - Corrêa Veículos`;
  if (document.fonts) await document.fonts.ready;
  desenhar();
}

form.addEventListener('input', desenhar);
form.addEventListener('change', e => {
  if (e.target.name === 'destaque_opcao') $('campo-destaque-outro').hidden = e.target.value !== 'outro';
  if (e.target.name === 'opcional') {
    const marcados = form.querySelectorAll('[name=opcional]:checked');
    if (marcados.length > MAX_OPCIONAIS) { e.target.checked = false; aviso(`Cabem no máximo ${MAX_OPCIONAIS} opcionais na placa.`, true); return; }
  }
  desenhar();
});
$('salvar').onclick = async () => {
  try { await salvar(); aviso('Placa salva.'); } catch (e) { aviso(e.message, true); }
};
$('imprimir').onclick = async () => {
  try { await salvar(); aviso('Placa salva.'); window.print(); } catch (e) { aviso(e.message, true); }
};
window.addEventListener('resize', ajustarEscala);
iniciar().catch(e => aviso(e.message, true));
