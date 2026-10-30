'use strict';
// Links antigos do sistema continuam funcionando quando abertos pelo endereço principal.
if (location.pathname === '/' && location.hash.startsWith('#/')) location.replace('/sistema' + location.hash);
const el = id => document.getElementById(id);
const esc = valor => String(valor ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dinheiro = v => v === null || v === undefined ? 'Sob consulta' : (v / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const numero = v => v === null || v === undefined ? 'Não informado' : Number(v).toLocaleString('pt-BR');
let loja = {}, carros = [];
function whatsapp(mensagem) {
  let n = String(loja.whatsapp || '').replace(/\D/g, '');
  if ([10, 11].includes(n.length)) n = '55' + n;
  return /^55\d{10,11}$/.test(n) ? `https://wa.me/${n}?text=${encodeURIComponent(mensagem)}` : null;
}
function contato(url, texto) { return url ? `<a class="botao" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(texto)} <span aria-hidden="true">↗</span></a>` : '<a class="botao" href="#contato">Falar com a loja ↗</a>'; }
function preencherLoja(dados) {
  loja = dados;
  el('cidade-topo').textContent = loja.cidade || loja.nome;
  el('nome-rodape').textContent = loja.nome;
  el('cidade-contato').textContent = loja.cidade || 'nossa loja.';
  el('sobre-texto').textContent = loja.sobre;
  el('endereco').textContent = loja.endereco;
  if (loja.chamada) el('titulo-hero').textContent = loja.chamada;
  if (loja.horario) { el('horario').hidden = false; el('horario').textContent = loja.horario; }
  const wa = whatsapp(`Olá! Gostaria de saber mais sobre os carros da ${loja.nome}.`);
  if (wa) {
    el('whatsapp').href = wa; el('whatsapp').target = '_blank'; el('whatsapp').rel = 'noopener noreferrer'; el('whatsapp').hidden = false;
    el('hero-contato').href = wa; el('hero-contato').target = '_blank'; el('hero-contato').rel = 'noopener noreferrer';
  }
  const tel = String(loja.telefone || '').replace(/[^\d+]/g, '');
  if (tel) { el('telefone').href = 'tel:' + tel; el('telefone').textContent = loja.telefone; el('telefone').hidden = false; }
  if (loja.instagram && /^https:\/\/(www\.)?instagram\.com\//.test(loja.instagram)) { el('instagram').href = loja.instagram; el('instagram').hidden = false; }
  if (loja.endereco) { el('mapa').href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(`${loja.nome}, ${loja.endereco}, ${loja.cidade}`); el('mapa').hidden = false; }
}
function imagem(foto, titulo, classe = '') {
  return foto ? `<img class="${classe}" src="${esc(foto.url)}" alt="${esc(titulo)}" loading="lazy" data-foto>` : '<span class="falha-foto">Fotos em breve</span>';
}
function renderizar() {
  const busca = el('busca').value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const teto = Number(el('preco').value) || Infinity;
  const filtrados = carros.filter(c => c.titulo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(busca) && (teto === Infinity || c.preco !== null && c.preco <= teto));
  const ordem = el('ordem').value;
  if (ordem === 'menor') filtrados.sort((a, b) => (a.preco ?? Infinity) - (b.preco ?? Infinity));
  if (ordem === 'maior') filtrados.sort((a, b) => (b.preco ?? -1) - (a.preco ?? -1));
  if (ordem === 'ano') filtrados.sort((a, b) => (b.ano_mod || b.ano_fab || 0) - (a.ano_mod || a.ano_fab || 0));
  el('contagem').textContent = `${filtrados.length} ${filtrados.length === 1 ? 'carro disponível' : 'carros disponíveis'}`;
  el('carros').innerHTML = filtrados.length ? filtrados.map(c => `<a class="cartao-carro" href="/carro/${c.id}" aria-label="Ver ${esc(c.titulo)}">
    <div class="foto-cartao">${imagem(c.fotos[0], c.titulo)}${c.destaque ? '<span class="tag">DESTAQUE</span>' : ''}</div>
    <div class="info-cartao"><h3>${esc(c.titulo)}</h3><div class="especificacoes"><span>${esc([c.ano_fab, c.ano_mod].filter(Boolean).join('/'))}</span>${c.km !== null ? `<span>${numero(c.km)} km</span>` : ''}${c.combustivel ? `<span>${esc(c.combustivel)}</span>` : ''}</div><div class="preco-cartao"><strong>${dinheiro(c.preco)}</strong><span aria-hidden="true">↗</span></div></div></a>`).join('') : `<div class="vazio"><h3>${carros.length ? 'Nenhum carro com esses filtros' : 'Em breve, novos carros por aqui'}</h3><p>${carros.length ? 'Experimente buscar outro modelo ou ampliar a faixa de preço.' : 'Estamos preparando nossos anúncios. Fale com a equipe para consultar o estoque.'}</p>${carros.length ? '<button type="button" class="botao" id="limpar-filtros">Limpar filtros</button>' : contato(whatsapp('Olá! Gostaria de consultar os carros disponíveis.'), 'Consultar o estoque')}</div>`;
  el('limpar-filtros')?.addEventListener('click', () => { el('busca').value = ''; el('preco').value = ''; el('ordem').value = 'destaques'; renderizar(); });
}
function detalhe(carro) {
  el('inicio').hidden = true; el('detalhe').hidden = false;
  document.title = `${carro.titulo} | ${loja.nome}`;
  const atributos = [['Ano', [carro.ano_fab, carro.ano_mod].filter(Boolean).join('/') || 'Não informado'], ['Quilometragem', carro.km === null ? 'Não informada' : numero(carro.km) + ' km'], ['Combustível', carro.combustivel || 'Não informado'], ['Cor', carro.cor || 'Não informada']];
  el('detalhe').innerHTML = `<a class="voltar" href="/#estoque">← Voltar para os carros</a><div class="detalhe-grid"><div><div id="foto-principal">${imagem(carro.fotos[0], carro.titulo, 'foto-grande')}</div>${carro.fotos.length > 1 ? `<div class="miniaturas" aria-label="Fotos do carro">${carro.fotos.map((f, i) => `<button type="button" aria-label="Ver foto ${i + 1}" aria-pressed="${i === 0}" data-foto-indice="${i}">${imagem(f, `Foto ${i + 1} de ${carro.titulo}`)}</button>`).join('')}</div>` : ''}</div><div><p class="etiqueta">${esc(loja.nome.toUpperCase())}</p><h1>${esc(carro.titulo)}</h1><p class="preco-detalhe">${dinheiro(carro.preco)}</p><dl class="ficha">${atributos.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>${contato(whatsapp(`Olá! Tenho interesse no ${carro.titulo}. ${location.origin}/carro/${carro.id}`), 'Tenho interesse neste carro')}<p class="descricao">${esc(carro.descricao)}</p><p class="nota">Consulte a equipe para confirmar disponibilidade, valores e condições.</p></div></div>`;
  document.querySelectorAll('[data-foto-indice]').forEach(b => b.addEventListener('click', () => {
    el('foto-principal').innerHTML = imagem(carro.fotos[Number(b.dataset.fotoIndice)], carro.titulo, 'foto-grande');
    document.querySelectorAll('[data-foto-indice]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));
}
async function carregar() {
  const id = /^\/carro\/(\d+)$/.exec(location.pathname)?.[1];
  try {
    const resposta = await fetch(id ? `/api/publico/carros/${id}` : '/api/publico/catalogo');
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(resposta.status === 404 ? 'Este anúncio não está mais disponível. Confira os outros carros da loja.' : 'Não foi possível carregar os carros agora. Tente novamente em instantes.');
    preencherLoja(dados.loja);
    document.title = id ? document.title : `${loja.nome} | Encontre seu próximo carro`;
    if (id) return detalhe(dados.carro);
    carros = dados.carros; renderizar();
    const destaque = carros.find(c => c.fotos.length);
    if (destaque) el('hero-vitrine').innerHTML = `<a href="/carro/${destaque.id}">${imagem(destaque.fotos[0], destaque.titulo, 'hero-foto')}<div class="hero-carro"><small>NO NOSSO ESTOQUE</small><h2>${esc(destaque.titulo)}</h2><p>${dinheiro(destaque.preco)} <span aria-hidden="true">↗</span></p></div></a>`;
  } catch (erro) {
    el('mensagem').hidden = false; el('mensagem').textContent = erro.message;
    if (id) { el('inicio').hidden = true; el('detalhe').hidden = false; el('detalhe').innerHTML = '<a class="botao" href="/#estoque">Ver os carros da loja ↗</a>'; }
    else { el('contagem').textContent = 'Estoque indisponível no momento'; el('carros').innerHTML = '<div class="vazio"><h3>Não conseguimos carregar os anúncios</h3><p>Atualize a página ou entre em contato com a loja.</p><button class="botao" type="button" id="tentar">Tentar novamente</button></div>'; el('tentar').addEventListener('click', () => location.reload()); }
  }
}
document.addEventListener('error', e => { if (e.target.matches?.('img[data-foto]')) { const aviso = document.createElement('span'); aviso.className = 'falha-foto'; aviso.textContent = 'Foto indisponível'; e.target.replaceWith(aviso); } }, true);
el('filtros').addEventListener('submit', e => e.preventDefault());
['busca', 'preco', 'ordem'].forEach(id => el(id).addEventListener(id === 'busca' ? 'input' : 'change', renderizar));
el('ano').textContent = new Date().getFullYear();
carregar();
