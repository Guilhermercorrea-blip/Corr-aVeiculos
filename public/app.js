'use strict';
// Telas da Corrêa Veículos. Navegação pelo endereço (#/estoque, #/carro/3 ...).

const app = document.getElementById('app');

const TIPO_ENTRADA = {
  compra: 'Compra',
  compra_sem_transferir: 'Compra sem transferir',
  consignacao: 'Consignação',
  troca: 'Troca',
};
const CATEGORIAS = {
  oficina: 'Oficina / mão de obra',
  pecas: 'Peças',
  combustivel: 'Combustível',
  documentacao: 'Documentação / despachante',
  estetica: 'Lavagem / estética',
  comissao: 'Comissão',
  outros: 'Outros',
};
const BANCOS = ['Santander', 'BV Financeira', 'C6 Bank', 'Omni', 'Itaucred'];
const FORMA_PAGAMENTO = { avista: 'À vista', entrada_financiamento: 'Entrada + financiamento', financiamento: 'Financiamento' };
const MEIOS_PAGAMENTO = { pix: { nome: 'PIX', campo: 'valor_pix' }, deposito: { nome: 'Depósito bancário / TED', campo: 'valor_deposito' }, dinheiro: { nome: 'Dinheiro', campo: 'valor_dinheiro' }, financiamento: { nome: 'Financiamento', campo: 'valor_financiado' } };
const COMBUSTIVEIS =['Flex', 'Gasolina', 'Etanol', 'Diesel', 'GNV', 'Elétrico', 'Híbrido'];

// ---------- utilidades ----------

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(metodo, url, corpo) {
  // POST e PUT sempre vão como JSON (o servidor recusa outro formato, por segurança), mesmo sem dados
  const comCorpo = metodo === 'POST' || metodo === 'PUT';
  const r = await fetch('/api' + url, {
    method: metodo,
    headers: comCorpo ? { 'Content-Type': 'application/json' } : {},
    body: comCorpo ? JSON.stringify(corpo ?? {}) : undefined,
  });
  if (r.status === 401) {
    location.href = '/login.html';
    throw new Error('Faça login para continuar');
  }
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || 'Erro ' + r.status);
  return dados;
}

function reais(centavos) {
  if (centavos == null) return '—';
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// "45.000,00", "45000", "45.000" ou "45000,5" -> centavos
function paraCentavos(texto) {
  let s = String(texto ?? '').replace(/R\$|\s/g, '');
  if (!s) return null;
  const invalido = () => new Error(`Valor em dinheiro inválido: "${texto}". Use, por exemplo, 40000 ou 40.000,00.`);
  if (s.includes(',')) {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(s)) throw invalido();
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  else if (!/^\d+(?:\.\d{1,2})?$/.test(s)) throw invalido();
  const [inteiro, decimal = ''] = s.split('.');
  const centavos = Number(inteiro) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(centavos)) throw invalido();
  return centavos;
}

function paraQuilometragem(texto) {
  let s = String(texto ?? '').replace(/\s/g, '');
  if (!s) return null;
  if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+$/.test(s) || !Number.isSafeInteger(Number(s))) throw new Error('Quilometragem inválida. Use, por exemplo, 85000 ou 85.000.');
  return Number(s);
}

const paraTexto = c => (c == null ? '' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function dataBR(iso) {
  if (!iso) return '—';
  const [d, h] = iso.split('T');
  const [a, m, dia] = d.split('-');
  return `${dia}/${m}/${a}` + (h ? ` ${h.slice(0, 5)}` : '');
}

function agoraLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const formatarCPF = c => (c && c.length === 11 ? c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : c || '—');
const formatarPlaca = p => (p ? p.replace(/^([A-Z]{3})(\d)/, '$1-$2') : 'SEM PLACA');

function cpfValido(cpf) {
  const c = String(cpf).replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const t of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(c[i]) * (t + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(c[t])) return false;
  }
  return true;
}

function aviso(texto, erro = false) {
  const el = document.getElementById('aviso');
  el.textContent = texto;
  el.className = 'aviso-flutuante' + (erro ? ' erro' : '');
  el.hidden = false;
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => (el.hidden = true), erro ? 6000 : 3000);
}

const ir = hash => (location.hash = hash);

function anosTexto(v) {
  if (!v.ano_fab && !v.ano_mod) return '';
  return `${v.ano_fab || '?'}/${v.ano_mod || '?'}`;
}

// ---------- pedaços de formulário ----------

function campo(rotulo, nome, o = {}) {
  let valor = o.dinheiro && o.valor ? 'R$ ' + o.valor : o.valor;
  if (o.milhar && valor != null && valor !== '') valor = Number(valor).toLocaleString('pt-BR');
  const attrs = [
    `name="${nome}"`,
    `type="${o.tipo || 'text'}"`,
    `value="${esc(valor ?? '')}"`,
    o.obrig ? 'required' : '',
    o.dinheiro ? 'data-dinheiro inputmode="decimal" placeholder="R$ 0,00"' : '',
    o.milhar ? 'data-milhar inputmode="numeric" placeholder="0"' : '',
    o.extra || '',
  ].join(' ');
  return `<label class="campo ${o.largura || 'c4'}"><span>${rotulo}${o.obrig ? ' *' : ''}</span><input ${attrs}>${o.dica ? '<small class="dica"></small>' : ''}</label>`;
}

function selecao(rotulo, nome, opcoes, valor, largura = 'c4') {
  const ops = Object.entries(opcoes).map(([v, t]) => `<option value="${esc(v)}" ${v === (valor ?? '') ? 'selected' : ''}>${esc(t)}</option>`);
  return `<label class="campo ${largura}"><span>${rotulo}</span><select name="${nome}">${ops.join('')}</select></label>`;
}

function blocoPessoa(prefixo, titulo, p = {}) {
  return `
  <fieldset data-pessoa="${prefixo}">
    <legend>${titulo}</legend>
    <div class="grade">
      ${campo('CPF', `${prefixo}.cpf`, { valor: formatarCPF(p.cpf) === '—' ? '' : formatarCPF(p.cpf), largura: 'c4', dica: true, extra: 'inputmode="numeric" placeholder="000.000.000-00"' })}
      ${campo('Nome completo', `${prefixo}.nome`, { valor: p.nome, obrig: true, largura: 'c8' })}
      ${campo('RG', `${prefixo}.rg`, { valor: p.rg, largura: 'c4' })}
      ${campo('Nascimento', `${prefixo}.nascimento`, { valor: p.nascimento, tipo: 'date', largura: 'c4' })}
      ${campo('Telefone / WhatsApp', `${prefixo}.telefone`, { valor: p.telefone, largura: 'c4', extra: 'inputmode="tel"' })}
      ${campo('CEP', `${prefixo}.cep`, { valor: p.cep, largura: 'c3', extra: 'inputmode="numeric" placeholder="00000-000"' })}
      ${campo('Rua', `${prefixo}.endereco`, { valor: p.endereco, largura: 'c6' })}
      ${campo('Número', `${prefixo}.numero`, { valor: p.numero, largura: 'c3' })}
      ${campo('Bairro', `${prefixo}.bairro`, { valor: p.bairro, largura: 'c5' })}
      ${campo('Cidade', `${prefixo}.cidade`, { valor: p.cidade, largura: 'c5' })}
      ${campo('UF', `${prefixo}.uf`, { valor: p.uf, largura: 'c2', extra: 'maxlength="2"' })}
      ${campo('E-mail', `${prefixo}.email`, { valor: p.email, tipo: 'email', largura: 'c6' })}
    </div>
  </fieldset>`;
}

function blocoVeiculo(prefixo, titulo, v = {}) {
  const comb = Object.fromEntries([['', '—'], ...COMBUSTIVEIS.map(c => [c, c])]);
  return `
  <fieldset>
    <legend>${titulo}</legend>
    <div class="grade">
      ${campo('Marca / modelo', `${prefixo}.marca_modelo`, { valor: v.marca_modelo, obrig: true, largura: 'c8', extra: 'placeholder="Ex.: VW Gol 1.0 MPI"' })}
      ${campo('Placa', `${prefixo}.placa`, { valor: v.placa, largura: 'c4', extra: 'style="text-transform:uppercase" placeholder="ABC1D23"' })}
      ${campo('Ano fabricação', `${prefixo}.ano_fab`, { valor: v.ano_fab, tipo: 'number', largura: 'c3', extra: 'min="1950" max="2100"' })}
      ${campo('Ano modelo', `${prefixo}.ano_mod`, { valor: v.ano_mod, tipo: 'number', largura: 'c3', extra: 'min="1950" max="2100"' })}
      ${campo('Cor', `${prefixo}.cor`, { valor: v.cor, largura: 'c3' })}
      ${selecao('Combustível', `${prefixo}.combustivel`, comb, v.combustivel, 'c3')}
      ${campo('RENAVAM', `${prefixo}.renavam`, { valor: v.renavam, largura: 'c4', extra: 'inputmode="numeric"' })}
      ${campo('Chassi', `${prefixo}.chassi`, { valor: v.chassi, largura: 'c5', extra: 'style="text-transform:uppercase"' })}
      ${campo('Km de entrada', `${prefixo}.km_entrada`, { valor: v.km_entrada, milhar: true, largura: 'c3' })}
    </div>
  </fieldset>`;
}

// Lê o formulário e monta um objeto: "pessoa.nome" -> { pessoa: { nome } }. Campos de dinheiro viram centavos.
function lerForm(form) {
  const obj = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled || el.closest('fieldset:disabled')) continue;
    if ((el.type === 'radio' || el.type === 'checkbox') && !el.checked) continue;
    let v = el.type === 'checkbox' ? true : el.value.trim();
    if (el.hasAttribute('data-dinheiro')) v = paraCentavos(v);
    if (el.hasAttribute('data-milhar')) v = paraQuilometragem(v);
    const partes = el.name.split('.');
    let alvo = obj;
    while (partes.length > 1) {
      const p = partes.shift();
      alvo = alvo[p] ??= {};
    }
    alvo[partes[0]] = v;
  }
  return obj;
}

// CPF: valida, e se a pessoa já existe, preenche o resto. CEP: busca rua/bairro/cidade.
function ligarPessoa(form, prefixo) {
  const pegar = n => form.elements[`${prefixo}.${n}`];
  const cpf = pegar('cpf');
  cpf.addEventListener('blur', async () => {
    const dig = cpf.value.replace(/\D/g, '');
    const dica = cpf.parentElement.querySelector('.dica');
    cpf.classList.remove('invalido');
    dica.textContent = '';
    if (!dig) return;
    if (!cpfValido(dig)) {
      cpf.classList.add('invalido');
      dica.textContent = 'CPF parece errado, confira os números';
      return;
    }
    cpf.value = formatarCPF(dig);
    try {
      const p = await api('GET', `/pessoas?cpf=${dig}`);
      if (!p) return;
      for (const [k, v] of Object.entries(p)) {
        const el = pegar(k);
        if (el && k !== 'cpf' && v != null && !el.value) el.value = v;
      }
      dica.style.color = 'var(--verde)';
      dica.textContent = 'Cliente já cadastrado, dados preenchidos';
    } catch { /* sem cadastro, segue */ }
  });

  const cep = pegar('cep');
  cep.addEventListener('blur', async () => {
    const dig = cep.value.replace(/\D/g, '');
    if (dig.length !== 8) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${dig}/json/`).then(x => x.json());
      if (r.erro) return;
      if (!pegar('endereco').value) pegar('endereco').value = r.logradouro || '';
      if (!pegar('bairro').value) pegar('bairro').value = r.bairro || '';
      pegar('cidade').value = r.localidade || pegar('cidade').value;
      pegar('uf').value = r.uf || pegar('uf').value;
      pegar('numero').focus();
    } catch { /* sem internet: digita na mão */ }
  });
}

// ---------- anexar CNH / CRLV ----------

const NOME_DOC = { cnh: 'CNH', crlv: 'CRLV', rg: 'RG', outro: 'Documento', foto_veiculo: 'Foto do carro', hodometro: 'Foto do hodômetro' };

function blocoAnexos(texto) {
  return `
  <div class="anexar">
    <div class="acoes">
      <label class="botao-anexo"><input type="file" id="camera" accept="image/*" capture="environment" hidden>
        Tirar foto</label>
      <label class="botao-anexo secundario"><input type="file" id="arquivos" accept="image/*,application/pdf" multiple hidden>
        Anexar ${texto} (foto ou PDF)</label>
      <button type="button" class="botao-anexo secundario" id="usar-celular">Usar o celular (QR Code)</button>
    </div>
    <details class="fotos-opcionais">
      <summary>Ler km do painel (opcional)</summary>
      <p class="suave pequeno">Fotografe o hodômetro total (ODO), com todos os números legíveis. Confira o km antes de salvar.</p>
      <label class="campo" id="destino-leitura-km" hidden><span>Ler o km de qual carro?</span><select id="destino-km"><option value="principal">Carro vendido — km na entrega</option><option value="troca">Carro da troca — km de entrada</option></select></label>
      <div class="acoes">
        <label class="botao-anexo secundario"><input type="file" id="camera-km" accept="image/*" capture="environment" hidden>Tirar foto do km</label>
        <label class="botao-anexo secundario"><input type="file" id="arquivo-km" accept="image/*" hidden>Escolher foto do km</label>
      </div>
    </details>
    <details class="fotos-opcionais">
      <summary>Fotos do carro (opcional)</summary>
      <div class="acoes" style="margin-top:8px">
        <label class="botao-anexo secundario"><input type="file" id="camera-carro" accept="image/*" capture="environment" hidden>Tirar foto do carro</label>
        <label class="botao-anexo secundario"><input type="file" id="fotos-carro" accept="image/*" multiple hidden>Escolher fotos do carro</label>
      </div>
      <label class="campo" id="destino-fotos-carro" hidden><span>Fotos de qual carro?</span><select id="destino-fotos"><option value="principal">Carro vendido</option><option value="troca">Carro da troca</option></select></label>
      <p class="suave pequeno">Você também pode enviar estas fotos pelo mesmo QR Code dos documentos.</p>
    </details>
    <div id="painel-celular" class="painel-celular" hidden></div>
    <div class="suave pequeno" id="anexo-dica">Pode mandar mais de um de uma vez. O sistema preenche e marca em amarelo o que você deve conferir.</div>
    <ul class="lista-anexos" id="lista-anexos"></ul>
  </div>`;
}

function paraBase64(blob) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result).split(',')[1]);
    leitor.onerror = () => reject(new Error('Não deu para abrir o arquivo'));
    leitor.readAsDataURL(blob);
  });
}

// Foto de celular é grande: reduz para no máximo 2000 px em JPEG antes de enviar
async function prepararArquivo(arquivo) {
  if (arquivo.type === 'application/pdf') return { tipo_mime: 'application/pdf', base64: await paraBase64(arquivo) };
  let imagem;
  try { imagem = await createImageBitmap(arquivo); }
  catch { throw new Error('Formato de imagem não aceito. Use JPG, PNG ou PDF.'); }
  const escala = Math.min(1, 2000 / Math.max(imagem.width, imagem.height));
  const tela = document.createElement('canvas');
  tela.width = Math.round(imagem.width * escala);
  tela.height = Math.round(imagem.height * escala);
  tela.getContext('2d').drawImage(imagem, 0, 0, tela.width, tela.height);
  const jpeg = await new Promise(r => tela.toBlob(r, 'image/jpeg', 0.88));
  return { tipo_mime: 'image/jpeg', base64: await paraBase64(jpeg) };
}

// Preenche só os campos vazios e marca em amarelo
function preencher(form, prefixo, dados) {
  let preenchidos = 0;
  for (const [chave, valor] of Object.entries(dados || {})) {
    const el = form.elements[`${prefixo}.${chave}`];
    if (!el || valor == null || valor === '' || el.value) continue;
    el.value = valor;
    if (el.tagName === 'SELECT' && el.value !== String(valor)) continue;
    el.classList.add('lido');
    preenchidos++;
  }
  const cpf = form.elements[`${prefixo}.cpf`];
  if (cpf?.classList.contains('lido')) cpf.dispatchEvent(new Event('blur'));
  return preenchidos;
}

// contexto 'entrada': CNH -> vendedor, CRLV -> carro (+ dono). 'venda': CNH -> comprador, CRLV -> carro da troca.
function ligarAnexos(form, contexto) {
  form._anexos = [];
  form._anexosTroca = [];
  form._uploadsPendentes = 0;
  form._celularPendente = false;
  const lista = document.getElementById('lista-anexos');
  document.getElementById('destino-fotos-carro').hidden = contexto !== 'venda';
  document.getElementById('destino-leitura-km').hidden = contexto !== 'venda';
  form.addEventListener('input', e => e.target.classList?.remove('lido'));

  api('GET', '/leitura/disponivel').then(r => {
    if (!r.disponivel) {
      document.getElementById('anexo-dica').innerHTML =
        '<strong>A leitura automática está desligada</strong>: falta colar a chave no arquivo CHAVE-API-CLAUDE.txt. Os arquivos ficam anexados mesmo assim.';
    }
  }).catch(() => {});

  // Coloca o que foi lido no formulário (vale para foto daqui ou enviada pelo celular)
  const aplicar = (r, nome, item) => {
    const ver = `<a href="/anexos/${r.anexo_id}" target="_blank">ver arquivo</a>`;
    if (r.tipo === 'hodometro') {
      const ehTroca = contexto === 'venda' && r.destino === 'troca';
      if (ehTroca) {
        const troca = document.getElementById('tem-troca');
        if (!troca.checked) { troca.checked = true; troca.dispatchEvent(new Event('change')); }
      }
      if (r.anexo_id) (ehTroca ? form._anexosTroca : form._anexos).push(r.anexo_id);
      const nomeCampo = contexto === 'venda' ? (ehTroca ? 'troca.km_entrada' : 'venda.km_saida') : 'veiculo.km_entrada';
      const campoKm = form.elements[nomeCampo];
      const avisos = [...(r.avisos || []), ...(r.erro ? [r.erro] : [])];
      if (!campoKm || !Number.isSafeInteger(r.km) || r.km < 0) {
        item.className = 'atencao';
        item.innerHTML = `<strong>Não foi possível preencher o km com segurança.</strong> ${avisos.map(esc).join(' ')} ${r.anexo_id ? '· ' + ver : ''}`;
        return;
      }
      const textoKm = r.km.toLocaleString('pt-BR');
      const rotulo = contexto === 'venda' && !ehTroca ? 'Km na entrega' : ehTroca ? 'Km de entrada da troca' : 'Km de entrada';
      const atual = campoKm.value.trim();
      const diferente = atual !== '' && Number(atual.replace(/\D/g, '')) !== r.km;
      const usar = () => {
        campoKm.value = textoKm;
        campoKm.dispatchEvent(new Event('input', { bubbles: true }));
        campoKm.classList.add('lido');
        item.querySelector('button')?.remove();
      };
      item.className = 'atencao';
      item.innerHTML = `<strong>${rotulo}: ${textoKm} km lidos.</strong> Confira a foto antes de salvar. ${avisos.map(esc).join(' ')} · ${ver}` +
        (diferente ? `<br>O campo já tem ${esc(atual)} km. <button type="button" class="mini">Usar ${textoKm} km</button>` : '');
      if (diferente) item.querySelector('button').addEventListener('click', usar);
      else usar();
      return;
    }
    if (r.erro) {
      if (r.anexo_id) form._anexos.push(r.anexo_id);
      item.className = 'erro';
      item.innerHTML = r.anexo_id
        ? `<strong>${esc(nome)}</strong> anexado, mas não lido: ${esc(r.erro)} · ${ver}`
        : `<strong>${esc(nome)}</strong> não enviado: ${esc(r.erro)}`;
      return;
    }
    if (r.tipo === 'foto_veiculo') {
      const ehTroca = contexto === 'venda' && r.destino === 'troca';
      if (ehTroca) {
        const troca = document.getElementById('tem-troca');
        if (!troca.checked) { troca.checked = true; troca.dispatchEvent(new Event('change')); }
        form._anexosTroca.push(r.anexo_id);
      } else {
        form._anexos.push(r.anexo_id);
      }
      item.className = 'ok';
      item.innerHTML = `<strong>Foto ${ehTroca ? 'do carro da troca' : 'do carro'}</strong>: ${esc(nome)} · ${ver}<br><span class="suave pequeno">Salve o formulário para vincular a foto ao carro.</span>`;
      return;
    }
    let n = 0;
    let destino = '';
    if (r.tipo === 'crlv') {
      if (contexto === 'venda') {
        const troca = document.getElementById('tem-troca');
        if (!troca.checked) { troca.checked = true; troca.dispatchEvent(new Event('change')); }
        n = preencher(form, 'troca', r.veiculo);
        form._anexosTroca.push(r.anexo_id);
        destino = 'carro da troca';
      } else {
        n = preencher(form, 'veiculo', r.veiculo) + preencher(form, 'pessoa', { nome: r.pessoa.nome, cpf: r.pessoa.cpf });
        form._anexos.push(r.anexo_id);
        destino = 'dados do carro e do dono';
      }
    } else if (r.tipo === 'cnh' || r.tipo === 'rg') {
      n = preencher(form, 'pessoa', r.pessoa);
      form._anexos.push(r.anexo_id);
      destino = contexto === 'venda' ? 'comprador' : 'vendedor';
    } else {
      form._anexos.push(r.anexo_id);
    }
    const quem = r.pessoa?.nome || r.veiculo?.placa || '';
    item.className = r.avisos.length ? 'atencao' : 'ok';
    item.innerHTML = r.tipo === 'outro'
      ? `<strong>${esc(nome)}</strong>: não parece CNH nem CRLV. Ficou anexado. · ${ver}`
      : `<strong>${NOME_DOC[r.tipo]}</strong> ${esc(quem)}: ${n} campo(s) preenchido(s) em ${destino} · ${ver}` +
        (r.avisos.length ? `<ul>${r.avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : '');
  };

  // "Tirar foto" (câmera) e "Anexar" (arquivo ou galeria) passam pelo mesmo caminho
  const processar = async (entrada, finalidade = 'documento') => {
    const fotoCarro = finalidade === 'foto_veiculo';
    const hodometro = finalidade === 'hodometro';
    const destinoFotos = contexto === 'venda' ? document.getElementById(hodometro ? 'destino-km' : 'destino-fotos').value : 'principal';
    const arquivos = [...entrada.files];
    entrada.value = '';
    for (const arquivo of arquivos) {
      const item = document.createElement('li');
      item.innerHTML = `<span class="girando"></span> ${fotoCarro ? 'Enviando foto' : hodometro ? 'Lendo km' : 'Lendo'} <strong>${esc(arquivo.name)}</strong>...`;
      lista.append(item);
      form._uploadsPendentes++;
      try {
        const preparado = await prepararArquivo(arquivo);
        aplicar(await api('POST', fotoCarro ? '/fotos' : hodometro ? '/hodometro/ler' : '/documentos/ler', { nome: arquivo.name, ...preparado, ...(fotoCarro || hodometro ? { destino: destinoFotos } : {}) }), arquivo.name, item);
      } catch (e) {
        item.className = 'erro';
        item.innerHTML = `<strong>${esc(arquivo.name)}</strong>: ${esc(e.message)}`;
      } finally { form._uploadsPendentes--; }
    }
  };
  for (const id of ['camera', 'arquivos']) {
    const entrada = document.getElementById(id);
    entrada.addEventListener('change', () => processar(entrada));
  }

  for (const id of ['camera-carro', 'fotos-carro']) {
    const entrada = document.getElementById(id);
    entrada.addEventListener('change', () => processar(entrada, 'foto_veiculo'));
  }

  for (const id of ['camera-km', 'arquivo-km']) {
    const entrada = document.getElementById(id);
    entrada.addEventListener('change', () => processar(entrada, 'hodometro'));
  }

  // "Usar o celular": mostra um QR Code; as fotos tiradas no celular chegam aqui sozinhas
  document.getElementById('usar-celular').addEventListener('click', async e => {
    const botao = e.currentTarget;
    const painel = document.getElementById('painel-celular');
    if (!painel.hidden) return;
    botao.disabled = true;
    try {
      const [envio, rede] = await Promise.all([api('POST', '/envios', { contexto }), api('GET', '/rede')]);
      const endereco = `${rede.ips[0] || rede.nome}/celular.html?c=${envio.codigo}`;
      painel.hidden = false;
      painel.innerHTML = `
        <div id="qr-celular" class="qrcode"></div>
        <div>
          <strong>Aponte a câmera do celular para o QR Code</strong>
          <p class="pequeno">Abra o QR Code no celular para enviar os documentos e, se quiser, as fotos do carro. Depois confira e salve o formulário aqui.</p>
          <p class="suave pequeno">Código: <strong>${esc(envio.codigo)}</strong> · ${esc(endereco)}</p>
          <p class="pequeno" id="status-celular"><span class="girando"></span> Esperando fotos do celular...</p>
        </div>`;
      desenharQRCode(document.getElementById('qr-celular'), endereco);
      acompanharCelular(envio.codigo);
    } catch (erro) {
      aviso(erro.message, true);
    } finally {
      botao.disabled = false;
    }
  });

  // Pergunta ao servidor a cada 2 segundos se chegou foto nova; para quando sair da tela
  const acompanharCelular = codigo => {
    const recebidos = new Map();
    const tela = location.hash;
    const vez = async () => {
      if (location.hash !== tela || !document.body.contains(form)) return;
      try {
        const envio = await api('GET', `/envios/${codigo}`);
        form._celularPendente = envio.itens.some(item => item.status === 'lendo');
        for (const r of envio.itens) {
          if (!recebidos.has(r.id)) {
            const item = document.createElement('li');
            lista.append(item);
            recebidos.set(r.id, item);
          }
          const item = recebidos.get(r.id);
          if (r.status === 'lendo') {
            item.innerHTML = `<span class="girando"></span> Lendo foto do celular <strong>${esc(r.nome)}</strong>...`;
          } else if (!item.dataset.aplicado) {
            item.dataset.aplicado = '1';
            aplicar(r.resultado, `${r.nome} (celular)`, item);
          }
        }
        const status = document.getElementById('status-celular');
        if (status && envio.itens.length) status.innerHTML = `<span class="girando"></span> ${envio.itens.length} foto(s) recebida(s). Pode mandar mais.`;
      } catch { /* servidor ocupado: tenta de novo */ }
      setTimeout(vez, 2000);
    };
    vez();
  };
}

async function enviar(form, fn) {
  if (form._salvando || !form.reportValidity()) return;
  if (form._uploadsPendentes > 0 || form._celularPendente) { aviso('Aguarde o envio e a leitura dos arquivos antes de salvar.', true); return; }
  form._salvando = true;
  const botao = form.querySelector('button[type=submit]');
  botao.disabled = true;
  try {
    await fn(lerForm(form));
  } catch (e) {
    aviso(e.message, true);
  } finally {
    botao.disabled = false;
    form._salvando = false;
  }
}

function cartaoCarro(v) {
  const parado = v.status === 'estoque' && v.dias_estoque >= 60;
  const direita = v.status === 'vendido'
    ? `<span class="${v.lucro >= 0 ? 'positivo' : 'negativo'}">Lucro ${reais(v.lucro)}</span>`
    : `<span>Custo ${reais(v.custo_total)}</span>`;
  return `
  <a class="carro" href="#/carro/${v.id}">
    <div class="linha" style="margin-top:0"><span class="placa">${esc(formatarPlaca(v.placa))}</span><span class="etiqueta">${TIPO_ENTRADA[v.tipo_entrada]}</span></div>
    <div class="modelo" style="margin-top:8px">${esc(v.marca_modelo)} <span class="suave">${anosTexto(v)}</span></div>
    <div class="linha suave">
      <span>${v.status === 'vendido' ? 'Vendido ' + dataBR(v.vendido_em).slice(0, 10) : `<span class="${parado ? 'etiqueta alerta' : ''}">${v.dias_estoque} dias no pátio</span>`}</span>
      ${direita}
    </div>
  </a>`;
}

// ---------- telas ----------

async function telaPainel() {
  const r = await api('GET', '/resumo');
  const [ano, mes] = r.mes.split('-');
  const nomeMes = new Date(ano, mes - 1).toLocaleString('pt-BR', { month: 'long' });
  app.innerHTML = `
  <div class="cabecalho"><div><h1>Painel</h1><div class="suave">Resumo de ${nomeMes} de ${ano}</div></div></div>
  <div class="numeros">
    <div class="numero"><div class="rotulo">Carros no estoque</div><div class="valor">${r.estoque.qtd}</div></div>
    <div class="numero"><div class="rotulo">Dinheiro parado no estoque</div><div class="valor">${reais(r.estoque.investido)}</div></div>
    <div class="numero"><div class="rotulo">Vendas no mês</div><div class="valor">${r.vendasMes.qtd}</div></div>
    <div class="numero"><div class="rotulo">Faturamento no mês</div><div class="valor">${reais(r.vendasMes.faturamento)}</div></div>
    <div class="numero"><div class="rotulo">Lucro no mês</div><div class="valor ${r.vendasMes.lucro >= 0 ? 'positivo' : 'negativo'}">${reais(r.vendasMes.lucro)}</div></div>
  </div>
  ${r.parados.length ? `
  <div class="cartao">
    <h2>Parados há mais de 60 dias</h2>
    <div class="lista-carros">${r.parados.map(cartaoCarro).join('')}</div>
  </div>` : ''}
  <div class="cartao">
    <h2>Últimas vendas</h2>
    ${r.ultimasVendas.length ? `
    <div class="tabela-rolagem"><table>
      <thead><tr><th>Data</th><th>Carro</th><th>Comprador</th><th class="num">Venda</th><th class="num">Lucro</th></tr></thead>
      <tbody>${r.ultimasVendas.map(v => `
        <tr class="clicavel" onclick="ir('#/carro/${v.id}')">
          <td>${dataBR(v.vendido_em).slice(0, 10)}</td>
          <td>${esc(v.marca_modelo)} <span class="placa">${esc(formatarPlaca(v.placa))}</span></td>
          <td>${esc(v.comprador_nome)}</td>
          <td class="num">${reais(v.valor_venda)}</td>
          <td class="num ${v.lucro >= 0 ? 'positivo' : 'negativo'}">${reais(v.lucro)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>` : '<div class="vazio">Nenhuma venda registrada ainda.</div>'}
  </div>`;
}

async function telaLista(status) {
  const carros = await api('GET', `/veiculos?status=${status}`);
  const titulo = status === 'estoque' ? 'Estoque' : 'Vendidos';
  const totais = status === 'estoque'
    ? `${carros.length} carros · ${reais(carros.reduce((s, v) => s + v.custo_total, 0))} investidos`
    : `${carros.length} carros · lucro total ${reais(carros.reduce((s, v) => s + v.lucro, 0))}`;
  app.innerHTML = `
  <div class="cabecalho">
    <div><h1>${titulo}</h1><div class="suave">${totais}</div></div>
    <div class="acoes">
      ${status === 'estoque' ? '<a class="botao-link secundario" href="#/estoque-rapido">Cadastrar estoque atual (rápido)</a>' : ''}
      <input class="busca" type="search" placeholder="Buscar placa ou modelo" id="busca">
    </div>
  </div>
  <div class="lista-carros" id="lista"></div>`;
  const lista = document.getElementById('lista');
  const desenhar = termo => {
    const t = termo.toUpperCase().replace(/[^A-Z0-9 ]/g, '');
    const filtrados = carros.filter(v => !t || `${v.placa} ${v.marca_modelo}`.toUpperCase().includes(t));
    lista.innerHTML = filtrados.map(cartaoCarro).join('') ||
      `<div class="vazio">${carros.length ? 'Nada encontrado.' : status === 'estoque' ? 'Nenhum carro no estoque. Use "+ Entrada de carro".' : 'Nenhum carro vendido ainda.'}</div>`;
  };
  document.getElementById('busca').addEventListener('input', e => desenhar(e.target.value));
  desenhar('');
}

// Entrada de carro (nova) ou edição dos dados de um carro já cadastrado
async function telaEntrada(id) {
  const atual = id ? await api('GET', `/veiculos/${id}`) : null;
  const v = atual?.veiculo || { tipo_entrada: 'compra', entrada_em: agoraLocal() };
  const ehTroca = v.tipo_entrada === 'troca';
  const opcao = (valor, titulo, texto) => `
    <label class="opcao"><input type="radio" name="veiculo.tipo_entrada" value="${valor}" ${v.tipo_entrada === valor ? 'checked' : ''}>
      <span><strong>${titulo}</strong><small>${texto}</small></span></label>`;

  app.innerHTML = `
  <div class="cabecalho"><div><h1>${id ? 'Editar carro' : 'Entrada de carro'}</h1>
    <div class="suave">${id ? esc(v.marca_modelo) : 'Compra ou consignação'}</div></div></div>
  <form id="form" novalidate>
    ${blocoAnexos('CNH e CRLV')}
    ${ehTroca ? `<p class="suave">Este carro entrou como troca. O valor dele vem da venda.</p>` : `
    <fieldset>
      <legend>Como o carro está entrando?</legend>
      <div class="opcoes">
        ${opcao('compra', 'Compra', 'Vai transferir para o nome da loja. Gera contrato de compra.')}
        ${opcao('compra_sem_transferir', 'Compra sem transferir', 'A loja já pagou, mas o carro fica no nome do dono. Gera os dois: contrato de compra e consignação com adendo de quitação.')}
        ${opcao('consignacao', 'Consignação', 'O dono deixa o carro e recebe quando vender. Gera seu contrato de consignação.')}
      </div>
    </fieldset>`}
    ${blocoPessoa('pessoa', ehTroca ? 'Dono anterior (comprador da venda)' : 'Vendedor / dono do carro', atual?.fornecedor || {})}
    ${blocoVeiculo('veiculo', 'Dados do carro', v)}
    <fieldset>
      <legend>Valores</legend>
      <div class="grade">
        ${campo('Data e hora da entrada', 'veiculo.entrada_em', { valor: v.entrada_em, tipo: 'datetime-local', largura: 'c4' })}
        ${ehTroca ? `<div class="campo c4"><span>Valor da troca</span><strong style="padding:9px 0">${reais(v.valor_compra)}</strong></div>` :
          campo('<span id="rotulo-valor">Valor pago</span>', 'veiculo.valor_compra', { valor: paraTexto(v.valor_compra), obrig: true, dinheiro: true, largura: 'c4' })}
        <div id="bloco-valor-consignacao" class="campo c4" style="padding:0" hidden>${campo('Valor do contrato de consignação', 'veiculo.valor_consignacao', { valor: paraTexto(v.valor_consignacao), dinheiro: true, obrig: true, largura: 'c12' })}<small class="suave">Preço para colocar o carro à venda.</small></div>
        <div id="bloco-comissao" class="campo c4" style="padding:0">${campo('Comissão da loja (R$)', 'veiculo.comissao', { valor: paraTexto(v.comissao), dinheiro: true, largura: 'c12' })}</div>
        ${campo('Forma de pagamento', 'veiculo.forma_pagamento', { valor: v.forma_pagamento, largura: 'c12', extra: 'placeholder="Ex.: PIX, quitação de financiamento no banco X..."' })}
        <label class="campo"><span>Observações</span><textarea name="veiculo.obs" rows="2">${esc(v.obs)}</textarea></label>
      </div>
    </fieldset>
    <div class="acoes-form">
      <a class="botao-link secundario" href="${id ? `#/carro/${id}` : '#/estoque'}">Cancelar</a>
      <button type="submit">${id ? 'Salvar alterações' : 'Salvar entrada'}</button>
    </div>
  </form>`;

  const form = document.getElementById('form');
  ligarPessoa(form, 'pessoa');
  ligarAnexos(form, 'entrada');
  const ajustarTipo = () => {
    const tipo = form.querySelector('input[name="veiculo.tipo_entrada"]:checked')?.value;
    const rotulo = document.getElementById('rotulo-valor');
    if (rotulo) rotulo.textContent = tipo === 'consignacao' ? 'Valor líquido ao dono' : tipo === 'compra_sem_transferir' ? 'Valor do contrato de compra' : 'Valor pago';
    const doisContratos = tipo === 'compra_sem_transferir';
    document.getElementById('bloco-valor-consignacao').hidden = !doisContratos;
    const valorConsignacao = form.elements['veiculo.valor_consignacao'];
    valorConsignacao.disabled = !doisContratos;
    valorConsignacao.required = doisContratos;
    document.getElementById('bloco-comissao').style.display = tipo === 'consignacao' ? '' : 'none';
    form.elements['veiculo.comissao'].disabled = tipo !== 'consignacao';
  };
  form.addEventListener('change', e => { if (e.target.name === 'veiculo.tipo_entrada') ajustarTipo(); });
  ajustarTipo();

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!form.elements['veiculo.valor_consignacao'].disabled && !form.elements['veiculo.valor_consignacao'].reportValidity()) return;
    enviar(form, async dados => {
      if (id) {
        await api('PUT', `/veiculos/${id}`, { ...dados, anexos: form._anexos });
        aviso('Alterações salvas');
        ir(`#/carro/${id}`);
      } else {
        const r = await api('POST', '/compras', { ...dados, anexos: form._anexos });
        aviso('Carro cadastrado no estoque');
        ir(`#/carro/${r.id}`);
      }
    });
  });
}

function dadosPessoa(p) {
  if (!p) return '<span class="suave">—</span>';
  const end = [p.endereco && `${p.endereco}${p.numero ? ', ' + p.numero : ''}`, p.bairro, p.cidade && `${p.cidade}/${p.uf || ''}`]
    .filter(Boolean).join(' · ');
  return `<strong>${esc(p.nome)}</strong> <a class="pequeno" href="#/pessoa/${p.id}">Editar cadastro</a><br><span class="suave pequeno">CPF ${esc(formatarCPF(p.cpf))}${p.telefone ? ' · ' + esc(p.telefone) : ' · <strong>sem telefone</strong>'}${end ? '<br>' + esc(end) : ''}</span>`;
}

async function telaCarro(id) {
  const d = await api('GET', `/veiculos/${id}`);
  const v = d.veiculo;
  const vendido = v.status === 'vendido';
  const hoje = agoraLocal().slice(0, 10);

  app.innerHTML = `
  <div class="cabecalho">
    <div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
        <span class="placa">${esc(formatarPlaca(v.placa))}</span>
        <span class="etiqueta">${TIPO_ENTRADA[v.tipo_entrada]}</span>
        <span class="etiqueta ${vendido ? 'vendido' : ''}">${vendido ? 'Vendido' : 'Em estoque'}</span>
      </div>
      <h1>${esc(v.marca_modelo)} <span class="suave">${anosTexto(v)}</span></h1>
      <div class="suave">${vendido ? `Vendido em ${dataBR(v.vendido_em)} · ficou ${v.dias_estoque} dias` : `${v.dias_estoque} dias no pátio`}</div>
    </div>
    <div class="acoes">
      <a class="botao-link secundario" href="#/carro/${id}/editar">Editar dados</a>
      ${vendido ? '<button class="perigo" id="desfazer">Desfazer venda</button>' : `<a class="botao-link" href="#/carro/${id}/vender">Registrar venda</a>`}
      ${vendido ? '' : '<button class="perigo" id="excluir">Excluir carro</button>'}
    </div>
  </div>

  <div class="cartao">
    <h2>Quanto custou ${vendido ? 'e quanto deu de lucro' : 'até agora'}</h2>
    <div class="conta">
      <div><span>${v.tipo_entrada === 'consignacao' ? 'Valor líquido ao dono' : v.tipo_entrada === 'troca' ? 'Valor da troca' : 'Valor de compra'}</span><span>${reais(v.valor_compra)}</span></div>
      <div><span>Gastos (${d.gastos.length})</span><span>${reais(v.total_gastos)}</span></div>
      <div class="total"><span>Custo total</span><span>${reais(v.custo_total)}</span></div>
      ${vendido ? `
      <div><span>Valor de venda</span><span>${reais(v.valor_venda)}</span></div>
      <div class="total"><span>Lucro</span><span class="${v.lucro >= 0 ? 'positivo' : 'negativo'}">${reais(v.lucro)}</span></div>` : ''}
    </div>
  </div>

  <div class="cartao">
    <h2>Gastos com o carro</h2>
    ${vendido ? '' : `
    <form id="form-gasto" class="grade" style="margin-bottom:12px">
      ${campo('Data', 'data', { tipo: 'date', valor: hoje, largura: 'c3' })}
      ${selecao('Categoria', 'categoria', CATEGORIAS, 'oficina', 'c3')}
      ${campo('Descrição', 'descricao', { largura: 'c3', extra: 'placeholder="Ex.: troca de embreagem"' })}
      ${campo('Valor', 'valor', { dinheiro: true, largura: 'c2' })}
      <div class="campo c1" style="justify-content:flex-end;grid-column:span 12"><button type="submit">Adicionar gasto</button></div>
    </form>`}
    ${d.gastos.length ? `
    <div class="tabela-rolagem"><table>
      <thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th class="num">Valor</th><th></th></tr></thead>
      <tbody>${d.gastos.map(g => `
        <tr><td>${dataBR(g.data)}</td><td>${CATEGORIAS[g.categoria] || g.categoria}</td><td>${esc(g.descricao)}</td>
        <td class="num">${reais(g.valor)}</td>
        <td class="num">${vendido ? '' : `<button class="mini perigo" data-apagar="${g.id}">Apagar</button>`}</td></tr>`).join('')}
      </tbody>
    </table></div>` : '<div class="vazio">Nenhum gasto lançado.</div>'}
  </div>

  <div class="cartao">
    <h2>Dados do carro</h2>
    <div class="dados">
      <div><span>Placa</span>${esc(formatarPlaca(v.placa))}</div>
      <div><span>RENAVAM</span>${esc(v.renavam || '—')}</div>
      <div><span>Chassi</span>${esc(v.chassi || '—')}</div>
      <div><span>Cor</span>${esc(v.cor || '—')}</div>
      <div><span>Combustível</span>${esc(v.combustivel || '—')}</div>
      <div><span>Km de entrada</span>${v.km_entrada != null ? v.km_entrada.toLocaleString('pt-BR') : '—'}</div>
      <div><span>Entrada</span>${dataBR(v.entrada_em)}</div>
      ${v.comissao != null ? `<div><span>Comissão combinada</span>${reais(v.comissao)}</div>` : ''}
      ${v.forma_pagamento ? `<div><span>Pagamento</span>${esc(v.forma_pagamento)}</div>` : ''}
    </div>
    ${v.obs ? `<p class="suave">${esc(v.obs)}</p>` : ''}
  </div>

  ${vendido && d.venda.km_saida == null ? `
  <div class="cartao" style="border-color:var(--vermelho)">
    <h2>Falta o km na entrega</h2>
    <p class="pequeno">O contrato de venda só sai com o km preenchido, porque a garantia é por dias ou km.</p>
    <form id="form-km" class="grade" novalidate>
      ${campo('Km na entrega', 'km_saida', { milhar: true, obrig: true, largura: 'c4' })}
      <div class="campo c4" style="justify-content:flex-end"><button type="submit">Salvar km</button></div>
    </form>
  </div>` : ''}

  <div class="cartao">
    <h2>Contratos</h2>
    ${v.tipo_entrada === 'compra_sem_transferir' ? `<p>Valor do contrato de compra: <strong>${reais(v.valor_compra)}</strong><br>Valor do contrato de consignação (preço para venda): <strong>${reais(v.valor_consignacao)}</strong></p>` : ''}
    <div class="acoes">
      ${v.tipo_entrada === 'compra_sem_transferir' ? `
      <a class="botao-link" href="/contrato/${id}/compra" target="_blank">Imprimir contrato de compra</a>
      <a class="botao-link" href="/contrato/${id}/consignacao" target="_blank">Imprimir consignação com adendo de quitação</a>` : `
      <a class="botao-link" href="/contrato/${id}/entrada" target="_blank">Imprimir ${{
        compra: 'contrato de compra',
        consignacao: 'contrato de consignação',
        troca: 'consignação da troca (com adendo)',
      }[v.tipo_entrada]}</a>`}
      ${vendido ? `<a class="botao-link" href="/contrato/${id}/venda" target="_blank">Imprimir contrato de venda${d.venda.troca_veiculo_id ? ' (com cláusula de troca)' : ''}</a>` : ''}
      ${d.venda?.troca_veiculo_id ? `<a class="botao-link secundario" href="/contrato/${d.venda.troca_veiculo_id}/entrada" target="_blank">Imprimir consignação do carro da troca</a>` : ''}
    </div>
    <p class="suave pequeno">Os campos que faltarem saem com uma linha em branco para preencher à mão.</p>
  </div>

  ${d.anexos.some(a => a.tipo === 'foto_veiculo') ? `
  <div class="cartao">
    <h2>Fotos do carro</h2>
    <div class="galeria-carro">${d.anexos.filter(a => a.tipo === 'foto_veiculo').map(a => `
      <a href="/anexos/${a.id}" target="_blank" rel="noopener"><img src="/anexos/${a.id}" alt="${esc(a.nome_original || 'Foto do carro')}" loading="lazy"><span>${esc(a.nome_original || 'Foto do carro')}</span></a>`).join('')}</div>
  </div>` : ''}

  ${d.anexos.some(a => a.tipo !== 'foto_veiculo') ? `
  <div class="cartao">
    <h2>Documentos anexados</h2>
    <ul class="lista-anexos">${d.anexos.filter(a => a.tipo !== 'foto_veiculo').map(a => `
      <li><a href="/anexos/${a.id}" target="_blank">${NOME_DOC[a.tipo] || 'Arquivo'}${a.nome_original ? ' · ' + esc(a.nome_original) : ''}</a>
      <span class="suave pequeno">${dataBR(a.criado_em.replace(' ', 'T'))}</span></li>`).join('')}
    </ul>
  </div>` : ''}

  <div class="cartao">
    <h2>${v.tipo_entrada === 'troca' ? 'Veio na troca de' : v.tipo_entrada === 'consignacao' ? 'Dono (consignante)' : 'Comprado de'}</h2>
    ${dadosPessoa(d.fornecedor)}
    ${d.origemTroca ? `<p class="pequeno">Entrou como parte do pagamento do <a href="#/carro/${d.origemTroca.id}">${esc(d.origemTroca.marca_modelo)} ${esc(formatarPlaca(d.origemTroca.placa))}</a> em ${dataBR(d.origemTroca.vendido_em)}.</p>` : ''}
  </div>

  ${d.venda ? `
  <div class="cartao">
    <h2>Venda</h2>
    ${dadosPessoa(d.comprador)}
    <div class="dados" style="margin-top:12px">
      <div><span>Data</span>${dataBR(d.venda.vendido_em)}</div>
      <div><span>Km na saída</span>${d.venda.km_saida != null ? d.venda.km_saida.toLocaleString('pt-BR') : '—'}</div>
      ${d.venda.descricao_pagamento && d.venda.descricao_pagamento !== 'Não informado' ? `<div><span>Forma de pagamento</span>${esc(d.venda.descricao_pagamento || FORMA_PAGAMENTO[d.venda.forma_pagamento] || 'Não informado')}</div>` : ''}
      ${d.venda.valor_pix ? `<div><span>PIX</span>${reais(d.venda.valor_pix)}</div>` : ''}
      ${d.venda.valor_deposito ? `<div><span>Depósito bancário</span>${reais(d.venda.valor_deposito)}</div>` : ''}
      ${d.venda.valor_dinheiro ? `<div><span>Dinheiro</span>${reais(d.venda.valor_dinheiro)}</div>` : ''}
      ${d.venda.valor_entrada && !d.venda.forma_pagamento ? `<div><span>Entrada${d.venda.forma_entrada ? ' (' + esc(d.venda.forma_entrada) + ')' : ''}</span>${reais(d.venda.valor_entrada)}</div>` : ''}
      ${d.venda.valor_financiado ? `<div><span>Financiado${d.venda.banco ? ' · ' + esc(d.venda.banco) : ''}${d.venda.parcelas ? ' · ' + d.venda.parcelas + 'x' : ''}</span>${reais(d.venda.valor_financiado)}</div>` : ''}
      ${d.venda.valor_troca ? `<div><span>Troca</span>${reais(d.venda.valor_troca)}${d.troca ? ` · <a href="#/carro/${d.troca.id}">${esc(d.troca.marca_modelo)}</a>` : ''}</div>` : ''}
      ${d.venda.valor_saldo ? `<div><span>Saldo${d.venda.saldo_vencimento ? ' até ' + dataBR(d.venda.saldo_vencimento) : ''}</span>${reais(d.venda.valor_saldo)}</div>` : ''}
    </div>
    ${d.venda.obs ? `<p class="suave">${esc(d.venda.obs)}</p>` : ''}
  </div>` : ''}`;

  const formGasto = document.getElementById('form-gasto');
  formGasto?.addEventListener('submit', e => {
    e.preventDefault();
    enviar(formGasto, async dados => {
      await api('POST', `/veiculos/${id}/gastos`, dados);
      aviso('Gasto lançado');
      telaCarro(id);
    });
  });
  app.querySelectorAll('[data-apagar]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Apagar este gasto?')) return;
    try {
      await api('DELETE', `/gastos/${b.dataset.apagar}`);
      telaCarro(id);
    } catch (e) { aviso(e.message, true); }
  }));
  const formKm = document.getElementById('form-km');
  formKm?.addEventListener('submit', e => {
    e.preventDefault();
    enviar(formKm, async dados => {
      await api('PUT', `/veiculos/${id}/venda`, dados);
      aviso('Km salvo. O contrato de venda já pode ser impresso.');
      telaCarro(id);
    });
  });
  document.getElementById('excluir')?.addEventListener('click', async () => {
    const nome = `${v.marca_modelo}${v.placa ? ' ' + formatarPlaca(v.placa) : ''}`;
    if (!confirm(`Excluir ${nome}?\n\nApaga o carro, os gastos e os documentos anexados. Não dá para desfazer.`)) return;
    try {
      await api('DELETE', `/veiculos/${id}`);
      aviso('Carro excluído');
      ir('#/estoque');
    } catch (e) { aviso(e.message, true); }
  });
  document.getElementById('desfazer')?.addEventListener('click', async () => {
    const extra = d.venda?.troca_veiculo_id ? '\n\nO carro que entrou na troca também sai do estoque.' : '';
    if (!confirm('Desfazer a venda e voltar o carro para o estoque?' + extra)) return;
    try {
      await api('DELETE', `/veiculos/${id}/venda`);
      aviso('Venda desfeita');
      telaCarro(id);
    } catch (e) { aviso(e.message, true); }
  });
}

async function telaVenda(id) {
  const d = await api('GET', `/veiculos/${id}`);
  const v = d.veiculo;
  if (v.status !== 'estoque') return ir(`#/carro/${id}`);

  app.innerHTML = `
  <div class="cabecalho"><div><h1>Registrar venda</h1>
    <div class="suave">${esc(v.marca_modelo)} · <span class="placa">${esc(formatarPlaca(v.placa))}</span> · custo total ${reais(v.custo_total)}</div></div></div>
  <form id="form" novalidate>
    ${blocoAnexos('CNH do comprador e CRLV da troca')}
    ${blocoPessoa('pessoa', 'Comprador')}
    <fieldset>
      <legend>Venda</legend>
      <div class="grade">
        ${campo('Data e hora', 'venda.vendido_em', { tipo: 'datetime-local', valor: agoraLocal(), largura: 'c4' })}
        ${campo('Km na entrega', 'venda.km_saida', { milhar: true, obrig: true, largura: 'c4' })}
        ${campo('Valor total da venda', 'venda.valor_venda', { dinheiro: true, obrig: true, largura: 'c4' })}
      </div>
    </fieldset>
    <fieldset>
      <legend>Como o comprador vai pagar?</legend>
      <p class="suave pequeno">Marque uma ou mais opções. Os campos aparecem conforme a seleção.</p>
      <div class="opcoes opcoes-linha opcoes-pagamento">
        ${Object.entries(MEIOS_PAGAMENTO).map(([meio, dados]) => `<label class="opcao"><input type="checkbox" data-meio="${meio}"><span><strong>${dados.nome}</strong><small>${meio === 'financiamento' ? 'Valor liberado pelo banco' : 'Valor recebido pela loja'}</small></span></label>`).join('')}
      </div>
      <p id="resumo-pagamento" class="resumo-pagamento" aria-live="polite">Selecione as formas de pagamento.</p>
      ${Object.entries(MEIOS_PAGAMENTO).filter(([meio]) => meio !== 'financiamento').map(([meio, dados]) => `<fieldset id="pg-${meio}" class="sub" disabled hidden>
        <legend>${dados.nome}</legend><div class="grade">${campo('Valor em ' + dados.nome, 'venda.' + dados.campo, { dinheiro: true, obrig: true, largura: 'c6' })}</div>
      </fieldset>`).join('')}
      <fieldset id="pg-financiamento" class="sub" disabled hidden>
        <legend>Financiamento</legend>
        <div class="grade">
          ${selecao('Banco', 'venda.banco', Object.fromEntries([['', 'Escolha o banco'], ...BANCOS.map(b => [b, b]), ['Outro', 'Outro (digitar)']]), '', 'c4')}
          <label class="campo c4" id="campo-banco-outro" hidden><span>Nome do banco *</span><input name="banco_outro" disabled></label>
          ${campo('Valor financiado', 'venda.valor_financiado', { dinheiro: true, obrig: true, largura: 'c4' })}
          ${campo('Quantidade de parcelas', 'venda.parcelas', { tipo: 'number', obrig: true, largura: 'c4', extra: 'min="1" step="1" placeholder="Ex.: 48"' })}
        </div>
      </fieldset>
      <label class="marcador" style="margin-top:14px"><input type="checkbox" id="tem-saldo"> Tem saldo para receber depois</label>
      <fieldset id="pg-saldo" class="sub" disabled hidden>
        <legend>Saldo a receber</legend>
        <div class="grade">
          ${campo('Saldo a receber', 'venda.valor_saldo', { dinheiro: true, obrig: true, largura: 'c4' })}
          ${campo('Vencimento do saldo', 'venda.saldo_vencimento', { tipo: 'date', obrig: true, largura: 'c4' })}
        </div>
      </fieldset>
      <label class="marcador" style="margin-top:14px"><input type="checkbox" id="tem-troca"> Tem carro na troca</label>
    </fieldset>
    <fieldset id="bloco-troca" disabled hidden>
      <legend>Carro da troca</legend>
      <p class="suave pequeno" style="margin-top:0">Ele entra no estoque como "Troca", no nome do comprador, com o contrato de consignação e o adendo de quitação.</p>
      <div class="grade">${campo('Valor dado na troca', 'venda.valor_troca', { dinheiro: true, obrig: true, largura: 'c4' })}</div>
    </fieldset>
    <div id="bloco-troca-veiculo" hidden></div>
    <div class="conferencia" id="conferencia"></div>
    <label class="campo" style="margin-top:12px"><span>Observações</span><textarea name="venda.obs" rows="2"></textarea></label>
    <div class="acoes-form">
      <a class="botao-link secundario" href="#/carro/${id}">Cancelar</a>
      <button type="submit">Confirmar venda</button>
    </div>
  </form>`;

  const form = document.getElementById('form');
  ligarPessoa(form, 'pessoa');
  ligarAnexos(form, 'venda');
  const blocoTroca = document.getElementById('bloco-troca');
  const blocoTrocaVeiculo = document.getElementById('bloco-troca-veiculo');
  blocoTrocaVeiculo.innerHTML = `<fieldset id="fs-troca-veiculo" disabled>${blocoVeiculo('troca', 'Dados do carro da troca').replace(/^\s*<fieldset>|<\/fieldset>\s*$/g, '')}</fieldset>`;

  document.getElementById('tem-troca').addEventListener('change', e => {
    const sim = e.target.checked;
    blocoTroca.hidden = blocoTrocaVeiculo.hidden = !sim;
    blocoTroca.disabled = document.getElementById('fs-troca-veiculo').disabled = !sim;
    conferir();
  });

  const meiosSelecionados = () => [...form.querySelectorAll('[data-meio]:checked')].map(el => el.dataset.meio);
  const mostrar = (bloco, sim) => { bloco.hidden = !sim; bloco.disabled = !sim; };
  form.elements['venda.banco'].required = true;
  const ajustarBanco = () => {
    const outro = form.querySelector('[data-meio="financiamento"]').checked && form.elements['venda.banco'].value === 'Outro';
    document.getElementById('campo-banco-outro').hidden = !outro;
    form.elements.banco_outro.disabled = !outro;
    form.elements.banco_outro.required = outro;
  };
  form.addEventListener('change', e => {
    if (e.target.matches('[data-meio]')) {
      for (const meio of Object.keys(MEIOS_PAGAMENTO)) mostrar(document.getElementById('pg-' + meio), form.querySelector(`[data-meio="${meio}"]`).checked);
      ajustarBanco();
      conferir();
    }
    if (e.target.id === 'tem-saldo') { mostrar(document.getElementById('pg-saldo'), e.target.checked); conferir(); }
    if (e.target.name === 'venda.banco') { ajustarBanco(); if (!form.elements.banco_outro.disabled) form.elements.banco_outro.focus(); }
  });

  // Mostra se as formas de pagamento fecham com o valor da venda, e o lucro previsto
  const conferir = () => {
    const el = document.getElementById('conferencia');
    const formas = meiosSelecionados().map(m => MEIOS_PAGAMENTO[m].nome);
    if (document.getElementById('tem-troca').checked) formas.push('Carro na troca');
    if (document.getElementById('tem-saldo').checked) formas.push('Saldo a receber');
    document.getElementById('resumo-pagamento').textContent = formas.length ? formas.join(' + ') : 'Selecione as formas de pagamento.';
    let dados;
    try { dados = lerForm(form).venda || {}; } catch { el.textContent = 'Confira os valores digitados.'; return; }
    const total = dados.valor_venda || 0;
    const pago = ['valor_pix', 'valor_deposito', 'valor_dinheiro', 'valor_financiado', 'valor_troca', 'valor_saldo'].reduce((s, k) => s + (dados[k] || 0), 0);
    const falta = total - pago;
    const lucro = total - v.custo_total;
    el.className = 'conferencia' + (total && falta === 0 ? ' ok' : '');
    el.innerHTML = !total ? 'Digite o valor da venda.' :
      `${falta === 0 ? 'Pagamento fecha com o valor da venda.' : falta > 0 ? `Falta distribuir <strong>${reais(falta)}</strong> nas formas de pagamento.` : `As formas de pagamento passam <strong>${reais(-falta)}</strong> do valor da venda.`}
       · Lucro previsto: <strong class="${lucro >= 0 ? 'positivo' : 'negativo'}">${reais(lucro)}</strong>`;
  };
  form.addEventListener('input', conferir);
  conferir();

  form.addEventListener('submit', e => {
    e.preventDefault();
    enviar(form, async dados => {
      if (dados.venda?.km_saida === '' || dados.venda?.km_saida == null) {
        form.elements['venda.km_saida'].classList.add('invalido');
        form.elements['venda.km_saida'].focus();
        throw new Error('Preencha o km na entrega: sem ele o contrato e a garantia por km não saem.');
      }
      const meios = meiosSelecionados();
      if (!meios.length && !document.getElementById('tem-troca').checked && !document.getElementById('tem-saldo').checked) throw new Error('Marque como vai receber: PIX, depósito, dinheiro, financiamento, carro na troca ou saldo a receber.');
      dados.venda.meios_pagamento = meios;
      dados.venda.forma_pagamento = meios.includes('financiamento') ? (meios.some(m => m !== 'financiamento') ? 'entrada_financiamento' : 'financiamento') : 'avista';
      if (dados.venda.banco === 'Outro') {
        if (!dados.banco_outro) throw new Error('Digite o nome do banco do financiamento.');
        dados.venda.banco = dados.banco_outro;
      }
      const temTroca = document.getElementById('tem-troca').checked;
      const corpo = {
        pessoa: dados.pessoa, venda: dados.venda, troca: temTroca ? dados.troca : null,
        anexos: form._anexos, anexosTroca: form._anexosTroca,
      };
      const r = await api('POST', `/veiculos/${id}/venda`, corpo);
      aviso(r.troca_veiculo_id ? 'Venda registrada. O carro da troca entrou no estoque.' : 'Venda registrada');
      ir(`#/carro/${id}`);
    });
  });
}

async function telaPessoas() {
  app.innerHTML = `
  <div class="cabecalho"><div><h1>Pessoas</h1><div class="suave">Quem vendeu e quem comprou da loja</div></div>
    <input class="busca" type="search" placeholder="Buscar nome ou CPF" id="busca"></div>
  <div class="cartao"><div class="tabela-rolagem" id="tabela"></div></div>`;
  const tabela = document.getElementById('tabela');
  const carregar = async termo => {
    const pessoas = await api('GET', `/pessoas?busca=${encodeURIComponent(termo)}`);
    tabela.innerHTML = pessoas.length ? `<table>
      <thead><tr><th>Nome</th><th>CPF</th><th>Telefone</th><th>Cidade</th></tr></thead>
      <tbody>${pessoas.map(p => `<tr class="clicavel" onclick="ir('#/pessoa/${p.id}')"><td>${esc(p.nome)}</td><td>${esc(formatarCPF(p.cpf))}</td><td>${esc(p.telefone || '—')}</td><td>${esc(p.cidade ? `${p.cidade}/${p.uf || ''}` : '—')}</td></tr>`).join('')}</tbody>
    </table><p class="suave pequeno">Clique numa pessoa para ver ou editar o cadastro.</p>` : '<div class="vazio">Ninguém cadastrado ainda. As pessoas entram aqui sozinhas quando você registra uma compra ou venda.</div>';
  };
  let t;
  document.getElementById('busca').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => carregar(e.target.value), 250); });
  carregar('');
}

// Cadastro de uma pessoa: corrigir ou atualizar endereço, telefone etc. (vale para os próximos contratos impressos)
async function telaPessoa(id) {
  const p = await api('GET', `/pessoas/${id}`);
  app.innerHTML = `
  <div class="cabecalho"><div><h1>${esc(p.nome)}</h1><div class="suave">CPF ${esc(formatarCPF(p.cpf))}</div></div></div>
  <form id="form" novalidate>
    ${blocoPessoa('pessoa', 'Cadastro', p)}
    <div class="acoes-form">
      <a class="botao-link secundario" href="#/pessoas">Voltar</a>
      <button type="submit">Salvar alterações</button>
    </div>
  </form>
  <div class="cartao">
    <h2>Carros</h2>
    ${p.carros.length ? `<div class="tabela-rolagem"><table>
      <thead><tr><th>Data</th><th>Carro</th><th>O que fez</th></tr></thead>
      <tbody>${p.carros.map(c => `<tr class="clicavel" onclick="ir('#/carro/${c.id}')"><td>${dataBR(c.data).slice(0, 10)}</td>
        <td>${esc(c.marca_modelo)} <span class="placa">${esc(formatarPlaca(c.placa))}</span></td><td>${c.papel}</td></tr>`).join('')}</tbody>
    </table></div>` : '<div class="vazio">Nenhum carro ligado a esta pessoa.</div>'}
  </div>`;
  const form = document.getElementById('form');
  ligarPessoa(form, 'pessoa');
  form.addEventListener('submit', e => {
    e.preventDefault();
    enviar(form, async dados => {
      // Campo apagado vira vazio de verdade (lerForm devolve '' e o servidor grava como vazio)
      await api('PUT', `/pessoas/${id}`, dados.pessoa);
      aviso('Cadastro atualizado. Os próximos contratos já saem com os dados novos.');
      telaPessoa(id);
    });
  });
}

// Vários carros de uma vez, sem vendedor nem contrato, só para controlar estoque e gastos
function telaEstoqueRapido() {
  const linha = i => `
    <div class="linha-rapida">
      <span class="num">${i + 1}</span>
      ${campo('Marca / modelo', `carros.${i}.marca_modelo`, { largura: '', extra: 'placeholder="Ex.: VW Gol 1.0"' })}
      ${campo('Placa', `carros.${i}.placa`, { largura: '', extra: 'style="text-transform:uppercase"' })}
      ${campo('Ano fab.', `carros.${i}.ano_fab`, { tipo: 'number', largura: '' })}
      ${campo('Ano mod.', `carros.${i}.ano_mod`, { tipo: 'number', largura: '' })}
      ${campo('Km', `carros.${i}.km_entrada`, { milhar: true, largura: '' })}
      ${campo('Data de entrada', `carros.${i}.entrada_em`, { tipo: 'date', largura: '' })}
      ${campo('Valor pago', `carros.${i}.valor_compra`, { dinheiro: true, largura: '' })}
    </div>`;
  let total = 5;
  app.innerHTML = `
  <div class="cabecalho"><div><h1>Cadastrar estoque atual</h1>
    <div class="suave">Para os carros que já estão no pátio: só o carro e quanto pagou. Sem vendedor e sem contrato.</div></div></div>
  <form id="form" novalidate>
    <div class="cartao" id="linhas">${Array.from({ length: total }, (_, i) => linha(i)).join('')}</div>
    <button type="button" class="secundario" id="mais">+ Mais 5 linhas</button>
    <p class="suave pequeno">Linhas vazias são ignoradas. Depois você abre cada carro para lançar os gastos, e pode completar os dados em "Editar dados".</p>
    <div class="acoes-form">
      <a class="botao-link secundario" href="#/estoque">Cancelar</a>
      <button type="submit">Salvar carros</button>
    </div>
  </form>`;
  const form = document.getElementById('form');
  document.getElementById('mais').addEventListener('click', () => {
    document.getElementById('linhas').insertAdjacentHTML('beforeend', Array.from({ length: 5 }, (_, i) => linha(total + i)).join(''));
    total += 5;
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    enviar(form, async dados => {
      const carros = Object.values(dados.carros || {}).filter(c => c.marca_modelo || c.placa);
      const r = await api('POST', '/estoque-rapido', { carros });
      aviso(`${r.ids.length} carro(s) cadastrado(s) no estoque`);
      ir('#/estoque');
    });
  });
}

// QR Code com o endereço do sistema (biblioteca carregada só nesta tela; sem internet, fica só o endereço escrito)
function desenharQRCode(el, texto) {
  const desenhar = () => new window.QRCode(el, { text: texto, width: 180, height: 180 });
  if (window.QRCode) return desenhar();
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
  s.onload = desenhar;
  s.onerror = () => el.remove();
  document.head.append(s);
}

async function telaConfiguracoes() {
  const [c, rede] = await Promise.all([api('GET', '/config'), api('GET', '/rede')]);
  const principal = rede.ips[0] || rede.nome;
  app.innerHTML = `
  <div class="cabecalho"><div><h1>Configurações</h1><div class="suave">Acesso pela rede e dados da loja que aparecem nos contratos</div></div></div>
  <div class="cartao acesso-rede">
    <div>
      <h2>Usar no outro computador e no celular</h2>
      <p>Com este computador ligado e o sistema aberto, qualquer aparelho <strong>no mesmo Wi-Fi da loja</strong> abre o sistema neste endereço:</p>
      <p class="endereco">${esc(principal)}</p>
      ${[...rede.ips.slice(1), rede.nome].filter(e => e !== principal).map(e => `<p class="suave pequeno">ou ${esc(e)}</p>`).join('')}
      <ul class="pequeno">
        <li><strong>Outro computador:</strong> abra o navegador, digite o endereço e salve nos favoritos.</li>
        <li><strong>Celular:</strong> aponte a câmera para o QR Code. Depois, no menu do navegador, escolha <em>Adicionar à tela inicial</em>: vira um ícone como um aplicativo.</li>
      </ul>
    </div>
    <div id="qrcode" class="qrcode" title="${esc(principal)}"></div>
  </div>
  <form id="form">
    <fieldset>
      <legend>Loja</legend>
      <div class="grade">
        ${campo('Razão social', 'razao_social', { valor: c.razao_social, largura: 'c8' })}
        ${campo('CNPJ', 'cnpj', { valor: c.cnpj, largura: 'c4' })}
        ${campo('Endereço', 'endereco', { valor: c.endereco, largura: 'c8' })}
        ${campo('Cidade/UF', 'cidade', { valor: c.cidade, largura: 'c4' })}
        ${campo('CEP', 'cep', { valor: c.cep, largura: 'c4' })}
        ${campo('Telefone', 'telefone', { valor: c.telefone, largura: 'c4' })}
        ${campo('WhatsApp', 'whatsapp', { valor: c.whatsapp, largura: 'c4' })}
      </div>
    </fieldset>
    <fieldset>
      <legend>Quem assina pela loja</legend>
      <div class="grade">
        ${campo('Nome do representante', 'representante', { valor: c.representante, largura: 'c8' })}
        ${campo('CPF do representante', 'representante_cpf', { valor: c.representante_cpf, largura: 'c4' })}
      </div>
    </fieldset>
    <fieldset>
      <legend>Contratos</legend>
      <div class="grade">
        ${campo('Foro (cidade/UF)', 'foro', { valor: c.foro, largura: 'c6' })}
        ${campo('Dias de garantia na venda', 'garantia_dias', { valor: c.garantia_dias, tipo: 'number', largura: 'c3', extra: 'min="90"' })}
        ${campo('Km de garantia na venda', 'garantia_km', { valor: c.garantia_km, tipo: 'number', largura: 'c3', extra: 'min="0"' })}
      </div>
      <p class="suave pequeno">No contrato de venda: garantia de X dias ou Y km rodados, o que ocorrer primeiro.</p>
    </fieldset>
    <div class="acoes-form"><button type="submit">Salvar</button></div>
  </form>

  <div class="cartao">
    <h2>Usuários que podem entrar no sistema</h2>
    <div class="tabela-rolagem" id="usuarios"></div>
    <form id="form-usuario" class="grade" style="margin-top:12px" novalidate>
      ${campo('Nome', 'nome', { largura: 'c4' })}
      ${campo('Usuário (login)', 'usuario', { largura: 'c3', extra: 'autocapitalize="none" autocomplete="off"' })}
      ${campo('Senha (mín. 6)', 'senha', { tipo: 'password', largura: 'c3', extra: 'autocomplete="new-password"' })}
      <div class="campo c2" style="justify-content:flex-end"><button type="submit">Adicionar</button></div>
    </form>
  </div>

  <div class="cartao">
    <h2>Trocar minha senha</h2>
    <form id="form-senha" class="grade" novalidate>
      ${campo('Senha atual', 'atual', { tipo: 'password', largura: 'c4', extra: 'autocomplete="current-password"' })}
      ${campo('Nova senha (mín. 6)', 'nova', { tipo: 'password', largura: 'c4', extra: 'autocomplete="new-password"' })}
      <div class="campo c4" style="justify-content:flex-end"><button type="submit">Trocar senha</button></div>
    </form>
  </div>`;

  const eu = await api('GET', '/eu');
  const carregarUsuarios = async () => {
    const lista = await api('GET', '/usuarios');
    document.getElementById('usuarios').innerHTML = `<table>
      <thead><tr><th>Nome</th><th>Usuário</th><th>Desde</th><th></th></tr></thead>
      <tbody>${lista.map(u => `<tr><td>${esc(u.nome)}</td><td>${esc(u.usuario)}</td><td>${dataBR(u.criado_em.replace(' ', 'T')).slice(0, 10)}</td>
        <td class="num">${u.id === eu.id ? '<span class="suave pequeno">você</span>' : `<button class="mini perigo" data-remover="${u.id}">Remover</button>`}</td></tr>`).join('')}</tbody>
    </table>`;
    document.querySelectorAll('[data-remover]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Remover este usuário? Ele não vai mais conseguir entrar.')) return;
      try { await api('DELETE', `/usuarios/${b.dataset.remover}`); carregarUsuarios(); } catch (e) { aviso(e.message, true); }
    }));
  };
  carregarUsuarios();

  const formUsuario = document.getElementById('form-usuario');
  formUsuario.addEventListener('submit', e => {
    e.preventDefault();
    enviar(formUsuario, async dados => {
      await api('POST', '/usuarios', dados);
      formUsuario.reset();
      aviso('Usuário adicionado');
      carregarUsuarios();
    });
  });
  const formSenha = document.getElementById('form-senha');
  formSenha.addEventListener('submit', e => {
    e.preventDefault();
    enviar(formSenha, async dados => {
      await api('PUT', '/minha-senha', dados);
      formSenha.reset();
      aviso('Senha trocada. Os outros aparelhos vão pedir a senha nova.');
    });
  });
  desenharQRCode(document.getElementById('qrcode'), principal);
  const form = document.getElementById('form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    enviar(form, async dados => {
      await api('PUT', '/config', dados);
      aviso('Configurações salvas');
    });
  });
}

// ---------- navegação ----------

async function navegar() {
  const partes = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [pagina, id, acao] = partes;
  document.querySelectorAll('[data-menu]').forEach(a => a.classList.toggle('ativo', a.dataset.menu === (pagina || 'painel')));
  window.scrollTo(0, 0);
  try {
    if (!pagina) await telaPainel();
    else if (pagina === 'estoque') await telaLista('estoque');
    else if (pagina === 'vendidos') await telaLista('vendido');
    else if (pagina === 'pessoas') await telaPessoas();
    else if (pagina === 'pessoa') await telaPessoa(Number(id));
    else if (pagina === 'configuracoes') await telaConfiguracoes();
    else if (pagina === 'estoque-rapido') telaEstoqueRapido();
    else if (pagina === 'nova-entrada') await telaEntrada();
    else if (pagina === 'carro' && acao === 'vender') await telaVenda(Number(id));
    else if (pagina === 'carro' && acao === 'editar') await telaEntrada(Number(id));
    else if (pagina === 'carro') await telaCarro(Number(id));
    else app.innerHTML = '<div class="vazio">Página não encontrada.</div>';
  } catch (e) {
    app.innerHTML = `<div class="cartao"><strong>Não deu para carregar.</strong><p class="suave">${esc(e.message)}</p></div>`;
  }
}

// Ao sair do campo: dinheiro "40000" vira "R$ 40.000,00"; km "85000" vira "85.000"
document.addEventListener('focusout', e => {
  const el = e.target;
  if (el.matches?.('input[data-milhar]')) {
    el.classList.remove('invalido');
    try {
      const km = paraQuilometragem(el.value);
      el.value = km == null ? '' : km.toLocaleString('pt-BR');
    } catch { el.classList.add('invalido'); }
    return;
  }
  if (!el.matches?.('input[data-dinheiro]')) return;
  el.classList.remove('invalido');
  try {
    const centavos = paraCentavos(el.value);
    if (centavos != null) el.value = 'R$ ' + paraTexto(centavos);
  } catch {
    el.classList.add('invalido');
  }
  el.form?.dispatchEvent(new Event('input'));
});

api('GET', '/eu').then(u => { document.getElementById('nome-usuario').textContent = u?.nome || ''; }).catch(() => {});
document.getElementById('sair').addEventListener('click', async () => {
  try { await api('POST', '/logout', {}); } finally { location.href = '/login.html'; }
});

window.addEventListener('hashchange', navegar);
navegar();
