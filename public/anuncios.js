'use strict';
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let carros = [], selecionado = null, alterado = false, salvando = false;
async function api(metodo, url, dados) {
  const r = await fetch('/api/site' + url, { method: metodo, headers: dados ? { 'Content-Type': 'application/json' } : {}, body: dados ? JSON.stringify(dados) : undefined });
  if (r.status === 401) { location.href = '/login.html'; throw new Error('Sua sessão expirou. Faça login novamente.'); }
  const resposta = await r.json();
  if (!r.ok) throw new Error(resposta.erro || 'Não foi possível salvar. Tente novamente.');
  return resposta;
}
function status(texto, erro = false) { $('status').textContent = texto; $('status').className = erro ? 'erro' : ''; $('status').hidden = false; }
function lista() {
  const termo = $('busca-anuncio').value.toLocaleLowerCase('pt-BR').trim();
  const visiveis = carros.filter(c => `${c.marca_modelo} ${c.titulo || ''}`.toLocaleLowerCase('pt-BR').includes(termo));
  $('lista').innerHTML = visiveis.length ? visiveis.map(c => `<button class="item-anuncio" type="button" data-carro="${c.id}" aria-pressed="${selecionado === c.id}"><strong>${esc(c.marca_modelo)}</strong><small>${esc([c.ano_fab, c.ano_mod].filter(Boolean).join('/'))}</small><br><span class="tag-anuncio ${c.publicado && c.status === 'estoque' ? 'no-ar' : ''}">${c.status !== 'estoque' ? 'Fora do estoque · oculto' : c.publicado ? 'No site' : 'Não publicado'}</span></button>`).join('') : '<p class="suave pequeno">Nenhum carro encontrado. Cadastre os carros no estoque do sistema.</p>';
  document.querySelectorAll('[data-carro]').forEach(b => { b.disabled = salvando; b.addEventListener('click', () => abrir(Number(b.dataset.carro))); });
}
function parsePreco(texto) {
  const t = texto.trim().replace(/R\$\s*/i, '');
  if (!t) return null;
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(t)) throw new Error('Confira o preço. Exemplo: 45.900,00.');
  const [inteiro, centavos = ''] = t.replace(/\./g, '').split(',');
  const n = Number(inteiro) * 100 + Number(centavos.padEnd(2, '0'));
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error('Informe um preço maior que zero ou deixe o campo vazio.');
  return n;
}
function abrir(id) {
  if (salvando || alterado && !confirm('Há alterações não salvas neste anúncio. Deseja descartá-las?')) return;
  const c = carros.find(x => x.id === id); if (!c) return;
  selecionado = id; alterado = false; lista();
  $('editor').innerHTML = `<h2>${esc(c.marca_modelo)}</h2><p class="suave pequeno">${esc([c.ano_fab, c.ano_mod].filter(Boolean).join('/'))} · ${c.status === 'estoque' ? 'Em estoque' : 'Fora do estoque'}</p>
    <form id="form-anuncio"><fieldset id="campos-anuncio"><label class="campo"><span>Título do anúncio</span><input name="titulo" required maxlength="140" value="${esc(c.titulo || c.marca_modelo)}"></label>
    <label class="campo"><span>Preço para anunciar</span><input name="preco" inputmode="decimal" placeholder="Ex.: 45.900,00" value="${c.preco ? esc((c.preco / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })) : ''}"><small class="suave">Em branco, o site mostra “Sob consulta”. O custo de compra do sistema não muda.</small></label>
    <label class="campo"><span>Descrição pública do carro</span><textarea name="descricao" rows="5" maxlength="6000" placeholder="Versão, opcionais e informações que o cliente deve conhecer…">${esc(c.descricao || '')}</textarea></label>
    <h3>Fotos do anúncio</h3><p class="nota-editor">Marque somente as fotos que quer mostrar. Escolha uma delas para a capa. Documentos e fotos do hodômetro não aparecem nesta seleção.</p>
    ${c.fotos_disponiveis.length ? `<div class="fotos-anuncio">${c.fotos_disponiveis.map((f, i) => `<div class="foto-opcao"><a href="${f.url}" target="_blank" rel="noopener"><img src="${f.url}" alt="Foto ${i + 1} do carro" loading="lazy"></a><label><input type="checkbox" name="foto" value="${f.id}" ${c.fotos_selecionadas.includes(f.id) ? 'checked' : ''}> Publicar foto ${i + 1}</label><label><input type="radio" name="capa" value="${f.id}" ${c.fotos_selecionadas[0] === f.id ? 'checked' : ''}> Usar como capa</label></div>`).join('')}</div>` : '<p class="aviso-publicacao">Este carro ainda não tem fotos de veículo. Você pode salvar o anúncio agora e adicionar as fotos pelo sistema depois.</p>'}
    <a class="texto-link" href="/sistema#/carro/${c.id}/editar">Adicionar fotos ou corrigir os dados do carro no sistema →</a>
    <div class="aviso-publicacao">Ano, cor, combustível e quilometragem vêm do cadastro do carro. Placa, documentos, dados de clientes, custos e lucro não são exibidos no site.</div>
    <label class="opcao-publicacao"><input type="checkbox" name="destaque" ${c.destaque ? 'checked' : ''}><span>Destacar este carro<small>Os destaques aparecem primeiro na vitrine.</small></span></label>
    <label class="opcao-publicacao"><input type="checkbox" name="publicado" ${c.publicado && c.status === 'estoque' ? 'checked' : ''} ${c.status !== 'estoque' ? 'disabled' : ''}><span>Publicar no site<small>${c.status === 'estoque' ? 'Ao salvar, o anúncio e as fotos marcadas ficam visíveis para qualquer visitante.' : 'Este carro está fora do estoque e não pode aparecer na vitrine.'}</small></span></label>
    <div class="acoes-form"><button type="submit" id="salvar-anuncio">Salvar anúncio</button>${c.publicado && c.status === 'estoque' ? `<a class="botao-link secundario" href="/carro/${c.id}" target="_blank" rel="noopener">Ver anúncio ↗</a><button type="button" id="retirar" class="perigo">Retirar do site</button>` : ''}</div></fieldset></form>`;
  const form = $('form-anuncio');
  form.addEventListener('input', () => { alterado = true; });
  form.querySelectorAll('[name=capa]').forEach(r => r.addEventListener('change', () => { form.querySelector(`[name=foto][value="${r.value}"]`).checked = true; }));
  form.querySelectorAll('[name=foto]').forEach(r => r.addEventListener('change', () => { if (!r.checked) form.querySelector(`[name=capa][value="${r.value}"]`).checked = false; }));
  form.addEventListener('submit', async e => {
    e.preventDefault(); if (salvando || !form.reportValidity()) return;
    try {
      const fotos = Array.from(form.querySelectorAll('[name=foto]:checked'), x => Number(x.value));
      const capa = Number(form.querySelector('[name=capa]:checked')?.value);
      if (fotos.includes(capa)) fotos.sort((a, b) => a === capa ? -1 : b === capa ? 1 : 0);
      const dados = { titulo: form.elements.titulo.value, descricao: form.elements.descricao.value, preco: parsePreco(form.elements.preco.value), publicado: form.elements.publicado.checked, destaque: form.elements.destaque.checked, fotos };
      bloqueio(true);
      await api('PUT', '/anuncios/' + c.id, dados);
      alterado = false;
      carros = await api('GET', '/anuncios');
      bloqueio(false); abrir(c.id);
      status(dados.publicado ? 'Anúncio salvo e publicado no site.' : 'Anúncio salvo. Ele não está visível no site.');
    } catch (erro) { status(erro.message, true); bloqueio(false); }
  });
  $('retirar')?.addEventListener('click', async () => {
    if (!confirm('Retirar este carro do site? Ele continuará no estoque do sistema.')) return;
    try { bloqueio(true); await api('DELETE', '/anuncios/' + c.id); alterado = false; carros = await api('GET', '/anuncios'); bloqueio(false); abrir(c.id); status('Anúncio retirado do site.'); }
    catch (erro) { status(erro.message, true); bloqueio(false); }
  });
}
function bloqueio(ativo) { salvando = ativo; if ($('campos-anuncio')) $('campos-anuncio').disabled = ativo; lista(); }
async function iniciar() {
  try {
    const [listaCarros, config] = await Promise.all([api('GET', '/anuncios'), api('GET', '/config')]);
    carros = listaCarros; lista();
    Object.entries(config).forEach(([chave, valor]) => { const campo = $('form-config').elements.namedItem(chave); if (campo) campo.value = valor; });
    const pedido = Number(new URLSearchParams(location.search).get('carro')); if (pedido) abrir(pedido);
  } catch (erro) { status(erro.message, true); $('lista').textContent = 'Não foi possível carregar. Atualize a página para tentar novamente.'; }
}
$('busca-anuncio').addEventListener('input', lista);
$('abrir-config').addEventListener('click', () => { $('config-site').hidden = !$('config-site').hidden; });
$('fechar-config').addEventListener('click', () => { $('config-site').hidden = true; });
$('form-config').addEventListener('submit', async e => {
  e.preventDefault(); if (!$('form-config').reportValidity()) return;
  const dados = Object.fromEntries(new FormData($('form-config')));
  $('campos-config').disabled = true;
  try { await api('PUT', '/config', dados); status('Informações do site atualizadas.'); }
  catch (erro) { status(erro.message, true); }
  finally { $('campos-config').disabled = false; }
});
window.addEventListener('beforeunload', e => { if (alterado || salvando) { e.preventDefault(); e.returnValue = ''; } });
iniciar();
