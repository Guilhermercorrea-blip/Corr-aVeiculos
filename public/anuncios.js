'use strict';
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reais = v => v === null ? 'Sob consulta' : (v / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
let anuncios = [], atual = null, fotos = [], ordem = [], alterado = false, salvando = false, sequenciaFoto = 0;
let timerAviso, etapa = 1, fotoPrevia = 0, cidadeLoja = 'Barra Bonita/SP';
const TIPOS_VEICULO = ['Carro/picape', 'Motocicleta', 'Veículos para esportes', 'Trailer', 'Reboque', 'Barco', 'Comercial/industrial', 'Outro'];
const FABRICANTES = ['Agrale', 'Alfa Romeo', 'Aston Martin', 'Audi', 'BMW', 'BYD', 'Bentley', 'CAOA Chery', 'Chevrolet', 'Chrysler', 'Citroën', 'Dodge', 'Ducati', 'Ferrari', 'Fiat', 'Ford', 'GWM', 'Harley-Davidson', 'Honda', 'Hyundai', 'Iveco', 'JAC', 'Jaguar', 'Jeep', 'Kawasaki', 'Kia', 'Land Rover', 'Lexus', 'Lifan', 'MAN', 'Maserati', 'Mazda', 'Mercedes-Benz', 'Mini', 'Mitsubishi', 'Nissan', 'Peugeot', 'Porsche', 'RAM', 'Renault', 'Royal Enfield', 'Scania', 'Subaru', 'Suzuki', 'Toyota', 'Troller', 'Volkswagen', 'Volvo', 'Yamaha'];

async function api(metodo, url, dados) {
  const r = await fetch('/api/site' + url, { method: metodo, headers: dados !== undefined ? { 'Content-Type': 'application/json' } : {}, body: dados !== undefined ? JSON.stringify(dados) : undefined });
  if (r.status === 401) { location.href = '/login.html'; throw new Error('Sua sessão expirou. Faça login novamente.'); }
  const resposta = await r.json().catch(() => { throw new Error('A resposta do servidor veio incompleta. Confira a conexão e tente novamente.'); });
  if (!r.ok) throw new Error(resposta.erro || 'Não foi possível concluir. Tente novamente.');
  return resposta;
}
function aviso(texto, erro = false) {
  clearTimeout(timerAviso);
  $('status').className = erro ? 'erro' : '';
  $('status').innerHTML = `<span>${esc(texto)}</span><button type="button" aria-label="Fechar aviso">×</button>`;
  $('status').hidden = false;
  $('status').querySelector('button').onclick = () => { $('status').hidden = true; };
  if (!erro) timerAviso = setTimeout(() => { $('status').hidden = true; }, 7000);
}
function normal(texto) { return String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function situacao(p) { return p.veiculo_id && p.estado_estoque !== 'estoque' ? 'Fora do estoque' : p.situacao === 'vendido' ? 'Vendido' : p.visivel ? 'No site' : 'Rascunho'; }
function lista() {
  $('resumo-anuncios').innerHTML = `<div><strong>${anuncios.filter(p => p.visivel).length}</strong><span>No site</span></div><div><strong>${anuncios.filter(p => p.situacao === 'rascunho').length}</strong><span>Rascunhos</span></div><div><strong>${anuncios.filter(p => p.situacao === 'vendido' || p.veiculo_id && p.estado_estoque !== 'estoque').length}</strong><span>Vendidos / fora do estoque</span></div>`;
  const busca = normal($('busca-anuncio').value.trim()), filtro = $('filtro-anuncios').value;
  const visiveis = anuncios.filter(p => normal(p.titulo + ' ' + p.marca_modelo).includes(busca) &&
    (filtro === 'todos' || filtro === 'publicados' && p.visivel || filtro === 'rascunhos' && p.situacao === 'rascunho' || filtro === 'vendidos' && (p.situacao === 'vendido' || p.veiculo_id && p.estado_estoque !== 'estoque')));
  $('lista').innerHTML = visiveis.length ? visiveis.map(p => `<button class="item-anuncio" type="button" data-anuncio="${p.id}" aria-pressed="${atual?.id === p.id}">${p.fotos[0] ? `<img src="${p.fotos[0].url}" alt="" loading="lazy">` : ''}<span><strong>${esc(p.titulo)}</strong><small>${esc([p.ano_fab, p.ano_mod].filter(Boolean).join('/'))} · ${reais(p.preco)}</small><br><span class="tag-anuncio ${p.visivel ? 'no-ar' : ''}">${situacao(p)}</span></span></button>`).join('') : '<p class="suave pequeno">Nenhum anúncio encontrado. Use Novo anúncio ou traga um carro do estoque.</p>';
  document.querySelectorAll('[data-anuncio]').forEach(b => { b.disabled = salvando; b.onclick = () => abrir(Number(b.dataset.anuncio)); });
}
async function podeTrocar() { return !salvando && (!alterado || await confirmarAcao('Há alterações e fotos não salvas. Deseja descartá-las?', 'Descartar alterações')); }
function limparTemporarias() { fotos.filter(f => f.arquivo).forEach(f => URL.revokeObjectURL(f.url)); }
async function novo(dados = {}) {
  if (!await podeTrocar()) return;
  editor({ id: null, veiculo_id: null, titulo: '', marca_modelo: '', versao: '', ano_fab: null, ano_mod: null, km: null, cor: '', combustivel: '', cambio: '', portas: null, opcionais: [], descricao: '', preco: null, situacao: 'rascunho', destaque: false, revisao: null, fotos: [], fotos_disponiveis: [], ...dados, chave_criacao: crypto.randomUUID() });
  $('form-anuncio').elements.tipo_veiculo.focus();
}
async function abrir(id) {
  if (!await podeTrocar()) return;
  const p = anuncios.find(x => x.id === id); if (p) editor(p);
}
function campo(nome, rotulo, valor = '', opcoes = '') {
  return `<label class="campo"><span>${rotulo}</span><input name="${nome}" value="${esc(valor ?? '')}" ${opcoes}></label>`;
}
function opcoes(valores, atual, vazio = 'Selecione') {
  return `<option value="">${vazio}</option>` + valores.map(v => `<option value="${esc(v)}" ${String(atual ?? '') === String(v) ? 'selected' : ''}>${esc(v)}</option>`).join('');
}
function selecionar(nome, rotulo, valores, valor, extra = '') {
  return `<label class="campo"><span>${rotulo}</span><select name="${nome}" ${extra}>${opcoes(valores, valor)}</select></label>`;
}
function separarModelo(p) {
  if (p.modelo) return { fabricante: p.fabricante, modelo: p.modelo };
  const fabricante = [...FABRICANTES].sort((a,b) => b.length - a.length).find(v => normal(p.marca_modelo).startsWith(normal(v) + ' '));
  return { fabricante: fabricante || '', modelo: fabricante ? p.marca_modelo.slice(fabricante.length).trim() : p.marca_modelo };
}
function editor(p) {
  limparTemporarias(); atual = { ...p }; alterado = false; etapa = 1; fotoPrevia = 0;
  fotos = p.fotos_disponiveis.map(f => ({ ...f })); ordem = p.fotos.map(f => f.id);
  lista(); document.body.classList.add('editando-anuncio'); fundoInerte(true);
  const bloqueado = p.veiculo_id && p.estado_estoque !== 'estoque';
  const partes = separarModelo(p), outro = partes.fabricante && !FABRICANTES.includes(partes.fabricante);
  const anos = Array.from({length: new Date().getFullYear() + 2 - 1900}, (_,i) => new Date().getFullYear() + 1 - i);
  const automatico = [p.marca_modelo, p.versao].filter(Boolean).join(' ');
  $('editor').innerHTML = `<div class="compositor">
    <aside class="compositor-painel">
      <div class="compositor-topo"><div class="compositor-voltar"><button type="button" id="fechar-editor" class="secundario" aria-label="Voltar aos anúncios">←</button><a href="/" target="_blank" rel="noopener">Corrêa Veículos ↗</a></div><div class="compositor-titulo"><div><p class="suave pequeno">${p.veiculo_id ? 'Do estoque da loja' : 'Anúncio independente'}</p><h1>Veículo à venda</h1></div><button type="button" id="salvar-rascunho" class="secundario">${p.visivel || p.situacao === 'vendido' ? 'Salvar alterações' : 'Salvar rascunho'}</button></div><div class="alternar-previa" role="group" aria-label="Visualização"><button type="button" id="aba-editar" aria-pressed="true">Preencher</button><button type="button" id="aba-previa" class="secundario" aria-pressed="false">Ver prévia</button></div></div>
      <form id="form-anuncio"><fieldset id="campos-anuncio">
        <div class="compositor-rolagem">
          ${bloqueado ? '<p class="aviso-publicacao">Este carro está fora do estoque e fica oculto no site.</p>' : p.visivel ? '<p class="aviso-publicacao">Anúncio no ar. Salvar alterações atualiza o site.</p>' : ''}
          <section data-etapa="1"><h2 class="titulo-etapa">Fotos e informações</h2>
            ${selecionar('tipo_veiculo', 'Tipo de veículo', TIPOS_VEICULO, p.tipo_veiculo || 'Carro/picape', 'required')}
            <section class="secao-fotos"><h3>Fotos <span id="contador-fotos" class="suave pequeno"></span></h3><p class="nota-editor">A primeira foto será a capa do anúncio.</p>
              <div class="enviar-fotos" id="area-fotos"><button type="button" id="escolher-fotos" class="secundario"><span class="icone-upload" aria-hidden="true">＋</span><strong>Adicionar fotos</strong><span>ou arraste e solte aqui</span></button><button type="button" id="tirar-foto" class="secundario mini">Tirar foto pelo celular</button><input type="file" id="novas-fotos" accept="image/*" multiple hidden><input type="file" id="camera-anuncio" accept="image/*" capture="environment" hidden><small class="suave">Até 40 fotos. Enviadas ao salvar.</small></div>
              <div id="fotos-selecionadas" class="fotos-anuncio"></div><details id="biblioteca" hidden><summary>Outras fotos disponíveis <span id="total-biblioteca"></span></summary><button type="button" id="selecionar-todas" class="secundario mini">Adicionar todas</button><div id="fotos-disponiveis" class="fotos-anuncio"></div></details>
              <div class="atalho-celular"><span aria-hidden="true">▦</span><div><strong>Fotos direto do celular</strong><p>Aponte a câmera para o QR Code e envie para este anúncio.</p><button type="button" id="usar-celular-anuncio" class="secundario">Usar celular (QR Code)</button>${!p.id ? '<small>Primeiro preencha o modelo. Ao gerar o código, um rascunho será salvo.</small>' : ''}</div></div>
            </section>
            <h3>Sobre este veículo</h3><p class="local-anuncio">⌖ <span id="local-form">${esc(cidadeLoja)}</span></p>
            ${selecionar('ano_mod', 'Ano do modelo', anos, p.ano_mod)}
            ${selecionar('fabricante', 'Fabricante', [...FABRICANTES, 'Outro'], outro ? 'Outro' : partes.fabricante)}
            <div id="outro-fabricante" ${outro ? '' : 'hidden'}>${campo('fabricante_outro', 'Nome do fabricante', outro ? partes.fabricante : '', 'maxlength="60"')}</div>
            ${campo('modelo', 'Modelo', partes.modelo, 'required maxlength="140" placeholder="Ex.: Onix"')}
            ${campo('km', 'Quilometragem', p.km, 'type="number" min="0" step="1" placeholder="Ex.: 45000"')}
            ${selecionar('ano_fab', 'Ano de fabricação', anos, p.ano_fab)}
            ${selecionar('combustivel', 'Combustível', [...new Set(['Flex', 'Gasolina', 'Etanol', 'Diesel', 'Híbrido', 'Elétrico', 'GNV', p.combustivel].filter(Boolean))], p.combustivel)}
            ${selecionar('cambio', 'Câmbio', ['Manual', 'Automático', 'Automatizado', 'CVT'], p.cambio)}
            <h3>Preço</h3>${campo('preco', 'Preço do veículo', p.preco === null ? '' : (p.preco / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }), 'inputmode="decimal" placeholder="Ex.: 45.900,00"')}
            <p class="nota-editor">Em branco, aparece “Sob consulta”.</p>
            <h3>Descrição</h3><label class="campo"><span>Descrição do veículo</span><textarea name="descricao" rows="5" maxlength="6000" placeholder="Conte sobre o estado do veículo e seus diferenciais…">${esc(p.descricao)}</textarea></label>
          </section>
          <section data-etapa="2" hidden><h2 class="titulo-etapa">Conferir e publicar</h2><p class="nota-editor">Confira a prévia. Ao publicar, o anúncio ficará disponível no site da loja.</p>
            ${campo('titulo', 'Título personalizado (opcional)', p.titulo === automatico ? '' : p.titulo, 'maxlength="140" placeholder="Usa fabricante, modelo e versão"')}
            <label class="opcao-publicacao"><input type="checkbox" name="destaque" ${p.destaque ? 'checked' : ''}><span>Destacar este veículo<small>Aparece primeiro na vitrine da loja.</small></span></label>
            <div id="resumo-publicacao" class="aviso-publicacao"></div>
            ${p.veiculo_id ? `<p class="nota-editor">Vinculado ao estoque. As alterações aqui valem apenas para o anúncio. <a href="/sistema#/carro/${p.veiculo_id}" target="_blank" rel="noopener">Abrir no sistema ↗</a></p>` : '<p class="nota-editor">Este cadastro é só para divulgação. Não cria uma compra, venda ou contrato.</p>'}
            ${p.id ? `<div class="acoes acoes-situacao">${p.visivel ? `<a class="botao-link secundario" href="/carro/${p.id}" target="_blank" rel="noopener">Ver no site ↗</a><button type="button" id="retirar" class="perigo">Retirar do site</button>` : ''}${!p.veiculo_id && p.situacao !== 'vendido' ? '<button type="button" id="marcar-vendido" class="secundario">Marcar como vendido</button>' : ''}${p.situacao === 'vendido' ? '<button type="button" id="voltar-rascunho" class="secundario">Voltar para rascunho</button>' : ''}</div>` : ''}
          </section>
          <div id="progresso-fotos" role="status" hidden></div>
        </div>
        <div class="compositor-rodape"><div class="passos-anuncio" aria-label="Progresso"><span></span><span></span></div><p id="etapa-atual" class="nota-editor" aria-live="polite"></p><div class="acoes-etapas"><button type="button" id="etapa-anterior" class="secundario" hidden>Voltar</button><button type="button" id="proxima-etapa">Avançar</button><button type="button" id="publicar-anuncio" hidden ${bloqueado || p.situacao === 'vendido' ? 'disabled' : ''}>${p.visivel ? 'Salvar alterações' : 'Publicar no site'}</button></div></div>
      </fieldset></form>
    </aside>
    <section class="compositor-previa" aria-label="Prévia do anúncio"><div class="previa-papel"><div class="previa-cabecalho"><strong>Prévia do anúncio</strong><span>Atualiza enquanto você preenche</span></div><div id="previa-viva"></div></div></section>
  </div>`;
  const form = $('form-anuncio');
  form.addEventListener('input', () => { alterado = true; atualizarPrevia(); });
  form.addEventListener('change', () => { alterado = true; atualizarPrevia(); });
  form.addEventListener('submit', e => { e.preventDefault(); if (etapa < ETAPAS.length) avancarEtapa(); });
  form.elements.preco.addEventListener('blur', () => { try { const n = parsePreco(form.elements.preco.value); if (n !== null) form.elements.preco.value = (n / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }); atualizarPrevia(); } catch {} });
  form.elements.fabricante.onchange = () => { const outro = form.elements.fabricante.value === 'Outro'; $('outro-fabricante').hidden = !outro; form.elements.fabricante_outro.required = outro; atualizarPrevia(); };
  form.elements.fabricante_outro.required = Boolean(outro);
  $('novas-fotos').addEventListener('change', e => adicionarArquivos(e.target));
  $('camera-anuncio').addEventListener('change', e => adicionarArquivos(e.target));
  $('escolher-fotos').onclick = () => $('novas-fotos').click();
  $('tirar-foto').onclick = () => $('camera-anuncio').click();
  $('usar-celular-anuncio').onclick = abrirCelularAnuncio;
  const area = $('area-fotos');
  area.ondragover = e => { e.preventDefault(); if (!salvando) area.classList.add('arrastando'); };
  area.ondragleave = () => area.classList.remove('arrastando');
  area.ondrop = e => { e.preventDefault(); area.classList.remove('arrastando'); adicionarArquivos({ files: e.dataTransfer.files, value: '' }); };
  $('selecionar-todas').onclick = () => { for (const f of fotos) if (!ordem.includes(f.id) && ordem.length < 40) ordem.push(f.id); alterado = true; renderFotos(); };
  $('fechar-editor').onclick = fecharEditor;
  $('salvar-rascunho').onclick = () => gravar(bloqueado ? 'rascunho' : atual.situacao);
  $('proxima-etapa').onclick = avancarEtapa;
  $('etapa-anterior').onclick = () => mostrarEtapa(etapa - 1);
  $('publicar-anuncio').onclick = () => gravar('publicado');
  $('aba-editar').onclick = () => alternarPrevia(false);
  $('aba-previa').onclick = () => alternarPrevia(true);
  $('retirar')?.addEventListener('click', retirar);
  $('marcar-vendido')?.addEventListener('click', async () => { if (await confirmarAcao('Marcar este anúncio como vendido e retirá-lo do site? Isso atualiza somente a divulgação, sem registrar uma venda financeira.', 'Marcar como vendido')) gravar('vendido'); });
  $('voltar-rascunho')?.addEventListener('click', () => gravar('rascunho'));
  alternarPrevia(false); mostrarEtapa(1); renderFotos();
}
async function fecharEditor() {
  if (!await podeTrocar()) return;
  limparTemporarias(); atual = null; fotos = []; ordem = []; alterado = false;
  document.body.classList.remove('editando-anuncio'); fundoInerte(false); $('editor').innerHTML = '<div class="vazio"><h2>Escolha um anúncio para editar</h2><p>Ou use Novo anúncio para anunciar outro veículo.</p></div>'; lista(); $('novo-anuncio').focus();
}
function fundoInerte(ativo) {
  document.querySelectorAll('body > .banner, body > .topo, main > .cabecalho, #resumo-anuncios, #config-site, .anuncios-lista').forEach(e => { e.inert = ativo; });
}
function alternarPrevia(ativo) {
  $('editor').classList.toggle('mostra-previa', ativo);
  $('aba-editar').setAttribute('aria-pressed', String(!ativo)); $('aba-previa').setAttribute('aria-pressed', String(ativo));
}
// Duas etapas: preencher tudo numa tela só e depois conferir e publicar
const ETAPAS = ['Fotos e informações', 'Conferir e publicar'];
function mostrarEtapa(n) {
  etapa = Math.max(1, Math.min(ETAPAS.length, n));
  document.querySelectorAll('[data-etapa]').forEach(s => { s.hidden = Number(s.dataset.etapa) !== etapa; });
  document.querySelectorAll('.passos-anuncio span').forEach((s,i) => { s.classList.toggle('concluido', i < etapa); });
  $('etapa-atual').textContent = `Etapa ${etapa} de ${ETAPAS.length} · ${ETAPAS[etapa - 1]}`;
  const ultima = etapa === ETAPAS.length;
  $('etapa-anterior').hidden = etapa === 1; $('proxima-etapa').hidden = ultima; $('publicar-anuncio').hidden = !ultima;
  document.querySelector('.compositor-rolagem').scrollTop = 0;
  atualizarPrevia();
}
function avancarEtapa() {
  const secao = document.querySelector(`[data-etapa="${etapa}"]`);
  const invalido = [...secao.querySelectorAll('input,select,textarea')].find(e => !e.checkValidity());
  if (invalido) return invalido.reportValidity();
  try { parsePreco($('form-anuncio').elements.preco.value); } catch(e) { return aviso(e.message, true); }
  const e = $('form-anuncio').elements;
  if (e.ano_fab.value && e.ano_mod.value && Number(e.ano_mod.value) < Number(e.ano_fab.value)) return aviso('O ano do modelo não pode ser anterior ao de fabricação.', true);
  mostrarEtapa(etapa + 1);
}
function lerForm() {
  const form = $('form-anuncio'), e = form.elements, num = nome => e[nome].value === '' ? null : Number(e[nome].value);
  const fabricante = (e.fabricante.value === 'Outro' ? e.fabricante_outro.value : e.fabricante.value).trim(), modelo = e.modelo.value.trim();
  let preco = null; try { preco = parsePreco(e.preco.value); } catch {}
  // Versão, cor, portas e opcionais saíram do formulário: mantém o que o anúncio já tinha
  return { tipo_veiculo: e.tipo_veiculo.value, fabricante, modelo, marca_modelo: [fabricante, modelo].filter(Boolean).join(' '), versao: atual.versao || '', titulo: e.titulo.value.trim(), ano_fab: num('ano_fab'), ano_mod: num('ano_mod'), km: num('km'), cor: atual.cor || '', combustivel: e.combustivel.value, cambio: e.cambio.value, portas: atual.portas ?? null, opcionais: atual.opcionais || [], descricao: e.descricao.value.trim(), preco, destaque: e.destaque.checked };
}
function atualizarPrevia() {
  if (!$('previa-viva')) return;
  const p = lerForm(), titulo = p.titulo || [p.marca_modelo, p.versao].filter(Boolean).join(' ') || 'Título do veículo';
  fotoPrevia = Math.min(fotoPrevia, Math.max(0, ordem.length - 1));
  const capa = fotos.find(f => f.id === ordem[fotoPrevia]);
  $('previa-viva').innerHTML = `<div class="classificado-previa"><div class="previa-galeria">${capa ? `<img class="previa-foto-principal" src="${esc(capa.url)}" alt="Foto ${fotoPrevia + 1} de ${esc(titulo)}"><span class="contagem-galeria">${fotoPrevia + 1} / ${ordem.length}</span>` : '<div class="previa-sem-foto"><span aria-hidden="true">▧</span><h2>Prévia do seu anúncio</h2><p>Adicione as fotos e preencha os dados.<br>Veja aqui como o veículo será apresentado.</p></div>'}${ordem.length > 1 ? `<div class="previa-miniaturas">${ordem.map((id,i) => `<button type="button" data-previa-foto="${i}" aria-label="Ver foto ${i + 1}" aria-pressed="${fotoPrevia === i}"><img src="${esc(fotos.find(f => f.id === id).url)}" alt=""></button>`).join('')}</div>` : ''}</div><div class="previa-conteudo"><span class="previa-marca">CORRÊA VEÍCULOS</span><h2>${esc(titulo)}</h2><p class="previa-preco">${p.preco === null && !$('form-anuncio').elements.preco.value ? 'Sob consulta' : p.preco === null ? 'Confira o preço' : reais(p.preco)}</p><p class="suave pequeno">${esc(cidadeLoja)}</p><hr><h3>Sobre este veículo</h3><dl class="previa-ficha">${[['Tipo', p.tipo_veiculo], ['Ano', [p.ano_fab, p.ano_mod].filter(Boolean).join('/')], ['Quilometragem', p.km === null ? '' : p.km.toLocaleString('pt-BR') + ' km'], ['Cor', p.cor], ['Combustível', p.combustivel], ['Câmbio', p.cambio], ['Portas', p.portas]].filter(([,v]) => v !== null && v !== '').map(([k,v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl><h3>Descrição</h3><p class="previa-descricao ${p.descricao ? '' : 'suave'}">${esc(p.descricao || 'A descrição do veículo aparecerá aqui.')}</p>${p.opcionais.length ? `<h3>Opcionais</h3><ul class="previa-opcionais">${p.opcionais.map(v => `<li>${esc(v)}</li>`).join('')}</ul>` : ''}<div class="previa-contato">Tenho interesse · WhatsApp</div><p class="nota-editor">Prévia para a equipe. ${atual.visivel ? 'As mudanças aparecem no site ao salvar.' : 'O anúncio aparece no site após publicar.'}</p></div></div>`;
  document.querySelectorAll('[data-previa-foto]').forEach(b => { b.onclick = () => { fotoPrevia = Number(b.dataset.previaFoto); atualizarPrevia(); }; });
  $('resumo-publicacao').innerHTML = `<strong>${esc(titulo)}</strong><br>${reais(p.preco)} · ${ordem.length} foto(s)<br>${esc(cidadeLoja)}`;
}

function renderFotos() {
  $('contador-fotos').textContent = `${ordem.length}/40`;
  $('fotos-selecionadas').innerHTML = ordem.length ? ordem.map((id, i) => {
    const f = fotos.find(x => x.id === id);
    return `<div class="foto-opcao ${i === 0 ? 'foto-capa' : ''}"><img src="${esc(f.url)}" alt="Foto ${i + 1} do anúncio" loading="lazy"><span class="rotulo-foto">${i === 0 ? 'Capa' : 'Foto ' + (i + 1)}${f.arquivo ? ' · nova' : ''}</span><div class="botoes-foto"><button type="button" class="secundario mini" data-foto-acao="esquerda" data-foto="${id}" ${i === 0 ? 'disabled' : ''} aria-label="Mover foto ${i + 1} para antes">←</button><button type="button" class="secundario mini" data-foto-acao="direita" data-foto="${id}" ${i === ordem.length - 1 ? 'disabled' : ''} aria-label="Mover foto ${i + 1} para depois">→</button>${i > 0 ? `<button type="button" class="secundario mini" data-foto-acao="capa" data-foto="${id}">Capa</button>` : ''}<button type="button" class="perigo mini" data-foto-acao="remover" data-foto="${id}" aria-label="Remover foto ${i + 1} do anúncio">Remover</button></div></div>`;
  }).join('') : '<p class="nota-editor">Nenhuma foto selecionada. Você pode adicionar agora ou publicar sem foto.</p>';
  const outras = fotos.filter(f => !ordem.includes(f.id));
  $('biblioteca').hidden = !outras.length; $('total-biblioteca').textContent = `(${outras.length})`;
  $('fotos-disponiveis').innerHTML = outras.map(f => `<div class="foto-opcao"><img src="${esc(f.url)}" alt="Foto disponível" loading="lazy"><button type="button" class="secundario mini" data-foto-acao="adicionar" data-foto="${f.id}">Adicionar ao anúncio</button></div>`).join('');
  document.querySelectorAll('[data-foto-acao]').forEach(b => { b.disabled = b.disabled || salvando; b.onclick = () => acaoFoto(b.dataset.fotoAcao, b.dataset.foto); });
  atualizarPrevia();
}
function acaoFoto(acao, valor) {
  if (salvando) return;
  const foto = fotos.find(f => String(f.id) === valor); if (!foto) return;
  const id = foto.id, i = ordem.indexOf(id);
  if (acao === 'adicionar') { if (ordem.length >= 40) return aviso('Escolha no máximo 40 fotos.', true); ordem.push(id); }
  if (acao === 'remover') ordem.splice(i, 1);
  if (acao === 'capa') { ordem.splice(i, 1); ordem.unshift(id); }
  if (acao === 'esquerda' && i > 0) [ordem[i - 1], ordem[i]] = [ordem[i], ordem[i - 1]];
  if (acao === 'direita' && i < ordem.length - 1) [ordem[i + 1], ordem[i]] = [ordem[i], ordem[i + 1]];
  alterado = true; renderFotos();
}
function adicionarArquivos(input) {
  if (salvando) return;
  let erros = [];
  for (const arquivo of input.files) {
    if (ordem.length >= 40) { erros.push('O limite é de 40 fotos selecionadas.'); break; }
    if (!arquivo.type.startsWith('image/')) { erros.push(`${arquivo.name}: escolha uma imagem.`); continue; }
    if (arquivo.size > 20 * 1024 * 1024) { erros.push(`${arquivo.name}: a foto deve ter até 20 MB.`); continue; }
    const id = 'nova-' + (++sequenciaFoto); fotos.push({ id, url: URL.createObjectURL(arquivo), arquivo }); ordem.push(id); alterado = true;
  }
  input.value = ''; renderFotos();
  if (erros.length) aviso(erros.join(' '), true);
}
function parsePreco(valor) {
  const t = valor.trim().replace(/^R\$\s*/i, ''); if (!t) return null;
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(t)) throw new Error('Confira o preço. Exemplo: 45.900,00.');
  const [inteiro, fracao = ''] = t.replace(/\./g, '').split(','), n = Number(inteiro) * 100 + Number(fracao.padEnd(2, '0'));
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error('Informe um preço maior que zero ou deixe sob consulta.');
  return n;
}
function dadosForm(situacaoDesejada) {
  const form = $('form-anuncio');
  const invalido = [...form.querySelectorAll('input,select,textarea')].find(e => !e.checkValidity());
  if (invalido) { alternarPrevia(false); mostrarEtapa(Number(invalido.closest('[data-etapa]').dataset.etapa)); invalido.reportValidity(); return null; }
  return { ...lerForm(), preco: parsePreco(form.elements.preco.value), situacao: situacaoDesejada };
}
async function prepararFoto(arquivo) {
  let imagem;
  try { imagem = await createImageBitmap(arquivo); } catch { throw new Error(`Não foi possível abrir ${arquivo.name}. Use uma foto JPG, PNG ou WebP.`); }
  try {
    const escala = Math.min(1, 2000 / Math.max(imagem.width, imagem.height)), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(imagem.width * escala)); canvas.height = Math.max(1, Math.round(imagem.height * escala));
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(imagem, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!blob) throw new Error('Não foi possível preparar a foto');
    const base64 = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.onerror = () => reject(new Error('Não foi possível ler a foto')); r.readAsDataURL(blob); });
    return { nome: arquivo.name, tipo_mime: 'image/jpeg', base64 };
  } finally { imagem.close(); }
}
function bloquear(ativo) {
  salvando = ativo; if ($('campos-anuncio')) $('campos-anuncio').disabled = ativo;
  for (const id of ['salvar-rascunho', 'fechar-editor']) if ($(id)) $(id).disabled = ativo;
  for (const id of ['novo-anuncio', 'trazer-estoque', 'abrir-config']) $(id).disabled = ativo;
  lista();
}
async function gravar(situacaoDesejada) {
  if (salvando) return;
  let dados;
  try { dados = dadosForm(situacaoDesejada); } catch (e) { return aviso(e.message, true); }
  if (!dados) return;
  bloquear(true);
  try {
    if (!atual.id) {
      const r = await api('POST', '/publicacoes', { ...dados, situacao: 'rascunho', veiculo_id: atual.veiculo_id, chave_criacao: atual.chave_criacao, fotos: [] });
      atual.id = r.id; atual.revisao = r.revisao;
    }
    const novas = ordem.map(id => fotos.find(f => f.id === id)).filter(f => f.arquivo);
    for (let i = 0; i < novas.length; i++) {
      $('progresso-fotos').hidden = false; $('progresso-fotos').textContent = `Enviando foto ${i + 1} de ${novas.length}… Não feche esta tela.`;
      const f = novas[i], originalId = f.id, originalUrl = f.url;
      const enviada = await api('POST', `/publicacoes/${atual.id}/fotos`, await prepararFoto(f.arquivo));
      Object.assign(f, enviada, { arquivo: null }); ordem = ordem.map(id => id === originalId ? f.id : id); URL.revokeObjectURL(originalUrl);
    }
    const salvo = await api('PUT', `/publicacoes/${atual.id}`, { ...dados, revisao: atual.revisao, fotos: ordem });
    const i = anuncios.findIndex(p => p.id === salvo.id); if (i < 0) anuncios.unshift(salvo); else anuncios[i] = salvo;
    alterado = false; bloquear(false);
    // Publicou: já abre um anúncio novo em branco para o próximo carro
    if (situacaoDesejada === 'publicado' && salvo.visivel) {
      await novo();
      aviso(`${salvo.titulo} publicado no site. Pronto para o próximo carro.`);
      return salvo;
    }
    editor(salvo);
    aviso(salvo.visivel ? 'Anúncio salvo e publicado no site.' : salvo.situacao === 'vendido' ? 'Anúncio marcado como vendido e retirado do site.' : 'Rascunho salvo. Ele ainda não aparece no site.');
    return salvo;
  } catch (e) { alterado = true; aviso(e.message + ' Suas alterações continuam nesta tela para você conferir e tentar novamente.', true); bloquear(false); $('progresso-fotos').hidden = true; renderFotos(); }
}
function confirmarAcao(texto, rotulo) {
  const dialog = $('dialog-confirmar');
  if (dialog.open) return Promise.resolve(false);
  dialog.innerHTML = `<h2 id="titulo-confirmar">${esc(rotulo)}</h2><p>${esc(texto)}</p><div class="acoes-form"><button type="button" id="cancelar-acao" class="secundario">Cancelar</button><button type="button" id="confirmar-acao">${esc(rotulo)}</button></div>`;
  return new Promise(resolve => {
    let terminou = false;
    const fim = valor => { if (terminou) return; terminou = true; dialog.close(); resolve(valor); };
    $('cancelar-acao').onclick = () => fim(false); $('confirmar-acao').onclick = () => fim(true);
    dialog.oncancel = () => fim(false); dialog.onclose = () => fim(false);
    dialog.showModal();
  });
}
async function retirar() {
  if (salvando || !await confirmarAcao(`Retirar este anúncio do site? O carro continua cadastrado.${alterado ? ' As alterações ainda não salvas serão descartadas.' : ''}`, 'Retirar do site')) return;
  try {
    bloquear(true); const salvo = await api('POST', `/publicacoes/${atual.id}/retirar`, { revisao: atual.revisao });
    anuncios = anuncios.map(p => p.id === salvo.id ? salvo : p); alterado = false; bloquear(false); editor(salvo); aviso('Anúncio retirado do site e guardado como rascunho.');
  } catch (e) { bloquear(false); aviso(e.message, true); }
}
async function escolherEstoque() {
  if (salvando) return;
  try {
    const itens = await api('GET', '/estoque');
    $('carro-estoque').innerHTML = '<option value="">Selecione um carro</option>' + itens.map(p => `<option value="${p.id}" data-anuncio="${p.anuncio_id || ''}">${esc(p.marca_modelo)} ${esc([p.ano_fab, p.ano_mod].filter(Boolean).join('/'))}${p.anuncio_id ? ' · anúncio existente' : ''}</option>`).join('');
    if (!itens.length) return aviso('Nenhum carro em estoque. Você pode usar Novo anúncio para um cadastro independente.');
    $('dialog-estoque').showModal();
  } catch (e) { aviso(e.message, true); }
}
async function iniciar() {
  try {
    const [itens, config] = await Promise.all([api('GET', '/publicacoes'), api('GET', '/config')]);
    anuncios = itens; cidadeLoja = config.cidade || 'Barra Bonita/SP'; lista();
    Object.entries(config).forEach(([k, v]) => { const campo = $('form-config').elements.namedItem(k); if (campo) campo.value = v; });
    const pedido = Number(new URLSearchParams(location.search).get('carro'));
    if (pedido) {
      const existente = anuncios.find(p => p.veiculo_id === pedido);
      if (existente) await abrir(existente.id); else { const carro = await api('GET', '/estoque/' + pedido); await novo({ ...carro, id: null, veiculo_id: carro.id, estado_estoque: carro.status, titulo: carro.marca_modelo }); }
    }
  } catch (e) { aviso(e.message, true); $('lista').textContent = 'Não foi possível carregar. Atualize a página para tentar novamente.'; }
}
$('novo-anuncio').onclick = () => novo();
$('primeiro-anuncio').onclick = () => novo();
$('trazer-estoque').onclick = escolherEstoque;
$('cancelar-estoque').onclick = () => $('dialog-estoque').close();
$('form-estoque').onsubmit = async e => {
  e.preventDefault(); const opcao = $('carro-estoque').selectedOptions[0]; if (!opcao.value) return;
  try { const id = Number(opcao.dataset.anuncio); if (id) await abrir(id); else { const carro = await api('GET', '/estoque/' + opcao.value); await novo({ ...carro, id: null, veiculo_id: carro.id, estado_estoque: carro.status, titulo: carro.marca_modelo }); } $('dialog-estoque').close(); }
  catch (erro) { aviso(erro.message, true); }
};
$('busca-anuncio').addEventListener('input', lista);
$('filtro-anuncios').addEventListener('change', lista);
$('abrir-config').onclick = () => { $('config-site').hidden = !$('config-site').hidden; };
$('fechar-config').onclick = () => { $('config-site').hidden = true; };
$('form-config').onsubmit = async e => {
  e.preventDefault(); if (!$('form-config').reportValidity()) return;
  const dados = Object.fromEntries(new FormData($('form-config'))); $('campos-config').disabled = true;
  try { await api('PUT', '/config', dados); cidadeLoja = dados.cidade || 'Barra Bonita/SP'; atualizarPrevia(); if ($('local-form')) $('local-form').textContent = cidadeLoja; aviso('Informações do site atualizadas.'); }
  catch (erro) { aviso(erro.message, true); }
  finally { $('campos-config').disabled = false; }
};
let envioCelularAnuncio = null, timerCelularAnuncio, encerrandoCelularAnuncio = false, abrindoCelularAnuncio = false;
function incluirFotosCelular(envio) {
  if (!envioCelularAnuncio || atual?.id !== envioCelularAnuncio.id) return;
  let novas = 0;
  for (const foto of envio.fotos) if (!fotos.some(f => f.id === foto.id)) {
    fotos.push(foto); if (ordem.length < 40) ordem.push(foto.id); novas++;
  }
  if (novas) { alterado = true; renderFotos(); }
  $('status-celular-anuncio').textContent = envio.recebidas ? `${envio.recebidas} foto(s) recebida(s). Confira e salve o anúncio ao concluir.` : 'Aguardando fotos do celular…';
  if (ordem.length >= 40) $('status-celular-anuncio').textContent += ' A seleção está completa; as demais ficam em Outras fotos disponíveis.';
}
async function abrirCelularAnuncio() {
  if (salvando || envioCelularAnuncio || abrindoCelularAnuncio) return;
  abrindoCelularAnuncio = true;
  const botao = $('usar-celular-anuncio'); botao.disabled = true;
  try {
    if (!atual.id && !await gravar('rascunho')) return;
    const id = atual.id, envio = await api('POST', `/publicacoes/${id}/celular`, {});
    envioCelularAnuncio = { ...envio, id };
    const dialog = $('dialog-celular-anuncio');
    dialog.innerHTML = `<div class="cabecalho"><div><h2 id="titulo-celular-anuncio">Enviar fotos pelo celular</h2><p class="suave pequeno">${esc(atual.titulo)}</p></div></div><div class="qr-anuncio-grade"><div id="qr-anuncio" aria-label="QR Code para abrir o envio no celular"></div><div><ol><li>Aponte a câmera do celular para o código.</li><li>Abra o link e escolha a galeria ou tire as fotos.</li><li>As fotos chegam aqui. Conclua e salve o anúncio.</li></ol><p class="nota-editor">Válido por 1 hora. Este link serve apenas para enviar fotos a este anúncio.</p><label class="campo"><span>Link para abrir no celular</span><input id="link-celular-anuncio" type="url" readonly value="${esc(envio.url)}"></label><button type="button" id="copiar-link-anuncio" class="secundario mini">Copiar link</button></div></div><p id="status-celular-anuncio" class="aviso-publicacao" role="status" aria-live="polite">Aguardando fotos do celular…</p><p class="nota-editor">Receber fotos não altera o anúncio publicado. Confira a capa e salve para atualizar o site.</p><div class="acoes-form"><button type="button" id="concluir-celular-anuncio">Concluir envio</button></div>`;
    $('concluir-celular-anuncio').onclick = encerrarCelularAnuncio;
    dialog.oncancel = e => { e.preventDefault(); encerrarCelularAnuncio(); };
    $('copiar-link-anuncio').onclick = async () => {
      try { await navigator.clipboard.writeText(envio.url); $('copiar-link-anuncio').textContent = 'Link copiado'; }
      catch { $('link-celular-anuncio').focus(); $('link-celular-anuncio').select(); aviso('Selecione e copie o link para abrir no celular.'); }
    };
    dialog.showModal();
    new window.QRCode($('qr-anuncio'), { text: envio.url, width: 220, height: 220, correctLevel: window.QRCode.CorrectLevel.M });
    acompanharCelularAnuncio();
  } catch (e) {
    if (envioCelularAnuncio) {
      const envio = envioCelularAnuncio; envioCelularAnuncio = null;
      await api('POST', `/publicacoes/${envio.id}/celular/${envio.codigo}/encerrar`, {}).catch(() => {});
      $('dialog-celular-anuncio').close();
    }
    aviso(e.message, true);
  } finally { abrindoCelularAnuncio = false; if ($('usar-celular-anuncio')) $('usar-celular-anuncio').disabled = false; }
}
async function acompanharCelularAnuncio() {
  const envio = envioCelularAnuncio; if (!envio || encerrandoCelularAnuncio) return;
  try {
    const recebido = await api('GET', `/publicacoes/${envio.id}/celular/${envio.codigo}`);
    if (envioCelularAnuncio !== envio || encerrandoCelularAnuncio) return;
    incluirFotosCelular(recebido);
  } catch (e) {
    if (envioCelularAnuncio !== envio) return;
    $('status-celular-anuncio').textContent = e.message + ' As fotos já recebidas continuam guardadas.';
  }
  if (envioCelularAnuncio === envio && !encerrandoCelularAnuncio) timerCelularAnuncio = setTimeout(acompanharCelularAnuncio, 2000);
}
async function encerrarCelularAnuncio() {
  const envio = envioCelularAnuncio; if (!envio || encerrandoCelularAnuncio) return;
  encerrandoCelularAnuncio = true; clearTimeout(timerCelularAnuncio);
  $('concluir-celular-anuncio').disabled = true;
  try {
    const recebido = await api('POST', `/publicacoes/${envio.id}/celular/${envio.codigo}/encerrar`, {});
    incluirFotosCelular(recebido);
    envioCelularAnuncio = null; $('dialog-celular-anuncio').close();
    if (recebido.recebidas) aviso('Fotos recebidas. Confira a capa e salve o anúncio.');
  } catch (e) {
    // Um código vencido não pode mais receber fotos; a biblioteca continua salva.
    if (e.message.includes('venceu') || e.message.includes('não encontrado')) {
      envioCelularAnuncio = null; $('dialog-celular-anuncio').close(); aviso(e.message, true);
    } else {
      $('status-celular-anuncio').textContent = e.message + ' Tente concluir novamente.';
      $('concluir-celular-anuncio').disabled = false;
    }
  } finally { encerrandoCelularAnuncio = false; }
}
window.addEventListener('beforeunload', e => { if (alterado || salvando) { e.preventDefault(); e.returnValue = ''; } });
iniciar();
