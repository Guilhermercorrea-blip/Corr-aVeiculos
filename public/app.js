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
      ${campo('Inscrição estadual (só empresa)', `${prefixo}.ie`, { valor: p.ie, largura: 'c6' })}
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
function ligarPessoa(form, prefixo, { buscarCadastro = true, atualizarEndereco = false } = {}) {
  const pegar = n => form.elements[`${prefixo}.${n}`];
  const cpf = pegar('cpf');
  cpf.addEventListener('blur', async () => {
    const dig = cpf.value.replace(/\D/g, '');
    const dica = cpf.parentElement.querySelector('.dica');
    cpf.classList.remove('invalido');
    dica.textContent = '';
    if (!dig) return;
    if (dig.length !== 14 && !cpfValido(dig)) {
      cpf.classList.add('invalido');
      dica.textContent = 'CPF parece errado, confira os números';
      return;
    }
    cpf.value = formatarCPF(dig);
    if (!buscarCadastro) return;
    try {
      const p = await api('GET', `/pessoas?cpf=${dig}`);
      if (!p) return;
      for (const [k, v] of Object.entries(p)) {
        const el = pegar(k);
        if (el && k !== 'cpf' && v != null && !el.value) el.value = v;
      }
      dica.style.color = 'var(--verde)';
      dica.textContent = p.arquivado_em ? 'Cadastro arquivado encontrado. Será reativado ao salvar esta operação.' : 'Cliente já cadastrado, dados preenchidos';
    } catch { /* sem cadastro, segue */ }
  });

  const cep = pegar('cep');
  let ultimoCep = cep.value.replace(/\D/g, '');
  cep.addEventListener('blur', async () => {
    const dig = cep.value.replace(/\D/g, '');
    if (dig.length !== 8) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${dig}/json/`).then(x => x.json());
      if (r.erro || cep.value.replace(/\D/g, '') !== dig) return;
      const mudou = atualizarEndereco && dig !== ultimoCep;
      if (mudou || !pegar('endereco').value) pegar('endereco').value = r.logradouro || '';
      if (mudou || !pegar('bairro').value) pegar('bairro').value = r.bairro || '';
      ultimoCep = dig;
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
  <div class="cartao" id="cartao-aniversarios" hidden></div>
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
  mostrarAniversarios();
}

// Aniversariantes (compradores e vendedores): hoje com botão de parabéns no WhatsApp; próximos 7 dias como aviso
async function mostrarAniversarios(lista) {
  const caixa = document.getElementById('cartao-aniversarios');
  if (!caixa) return;
  try { lista ??= await api('GET', '/aniversarios'); } catch { return; }
  if (!document.body.contains(caixa)) return;
  caixa.hidden = !lista.length;
  if (!lista.length) return;
  const hoje = lista.filter(a => a.faltam === 0), proximos = lista.filter(a => a.faltam > 0);
  const quando = a => a.faltam === 1 ? 'amanhã' : `em ${a.faltam} dias`;
  caixa.innerHTML = `
    <h2>🎂 Aniversariantes</h2>
    ${hoje.map(a => `
      <div class="aniversario">
        <div><strong>${esc(a.nome)}</strong> <span class="suave pequeno">faz ${a.idade} anos hoje (${esc(a.data)})</span>
          ${a.enviado ? '<br><span class="positivo pequeno">✓ Parabéns enviado</span>' : ''}</div>
        <div class="acoes">
          ${a.url ? `<a class="botao-link${a.enviado ? ' secundario' : ''}" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">Mandar parabéns no WhatsApp</a>`
            : `<a class="botao-link secundario" href="#/pessoas/${a.pessoa_id}">Cadastrar o celular</a>`}
          ${a.url && !a.enviado ? `<button type="button" class="secundario" data-aniversario-enviado="${a.pessoa_id}">Já enviei</button>` : ''}
        </div>
      </div>`).join('')}
    ${hoje.length ? '<p class="suave pequeno">Abrir a conversa não envia a mensagem: confira o texto, toque em Enviar no WhatsApp e depois em “Já enviei”.</p>' : ''}
    ${proximos.length ? `<p class="pequeno" style="margin-bottom:4px"><strong>Próximos dias</strong></p><ul class="pequeno" style="margin-top:0">${proximos.map(a => `<li><a href="#/pessoas/${a.pessoa_id}">${esc(a.nome)}</a> · ${esc(a.data)} (${quando(a)}, ${a.idade} anos)${a.url ? '' : ' · <span class="suave">sem celular</span>'}</li>`).join('')}</ul>` : ''}
    ${hoje.length ? `<details class="pequeno"><summary>Ver a mensagem</summary><pre style="white-space:pre-wrap;font:inherit">${esc(hoje[0].mensagem)}</pre></details>` : ''}`;
  caixa.querySelectorAll('[data-aniversario-enviado]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try { mostrarAniversarios(await api('POST', `/aniversarios/${b.dataset.aniversarioEnviado}/enviado`)); aviso('Parabéns marcado como enviado'); }
    catch (e) { b.disabled = false; aviso(e.message, true); }
  }));
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
  const pendente = id ? null : lerContratoPendente();
  const v = atual?.veiculo || { tipo_entrada: pendente?.modelo === 'consignacao' ? 'consignacao' : 'compra', entrada_em: agoraLocal() };
  const ehTroca = v.tipo_entrada === 'troca';
  const opcao = (valor, titulo, texto) => `
    <label class="opcao"><input type="radio" name="veiculo.tipo_entrada" value="${valor}" ${v.tipo_entrada === valor ? 'checked' : ''}>
      <span><strong>${titulo}</strong><small>${texto}</small></span></label>`;

  app.innerHTML = `
  <div class="cabecalho"><div><h1>${id ? 'Editar carro' : 'Entrada de carro'}</h1>
    <div class="suave">${id ? esc(v.marca_modelo) : 'Compra ou consignação'}</div></div></div>
  ${avisoContratoPendente(pendente, 'entrada')}
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
    <details id="bloco-crv" class="cartao" ${atual?.proprietarioCrv ? 'open' : ''}>
      <summary><strong>O documento (CRV) está no nome de outra pessoa? (procuração)</strong></summary>
      <p class="suave pequeno">Preencha só se o dono do documento for diferente de quem entrega o carro. O contrato fica no nome de quem entrega, com o proprietário do CRV indicado; a nota fiscal sai no nome de quem está no CRV.</p>
      <p><button type="button" class="secundario" id="copiar-end-crv">Copiar endereço e telefone de quem entrega o carro</button></p>
      ${blocoPessoa('proprietario_crv', 'Proprietário no CRV', atual?.proprietarioCrv || {})}
    </details>
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
      <a class="botao-link secundario" href="${id ? `#/carro/${id}` : pendente ? '#/contratos' : '#/estoque'}">Cancelar</a>
      <button type="submit">${id ? 'Salvar alterações' : 'Salvar entrada'}</button>
    </div>
  </form>`;

  const form = document.getElementById('form');
  ligarPessoa(form, 'pessoa');
  ligarPessoa(form, 'proprietario_crv');
  document.getElementById('copiar-end-crv').addEventListener('click', () => {
    for (const campo of ['cep', 'endereco', 'numero', 'bairro', 'cidade', 'uf', 'telefone']) form.elements[`proprietario_crv.${campo}`].value = form.elements[`pessoa.${campo}`].value;
    aviso('Endereço copiado. Confira o nome e o CPF do proprietário do CRV.');
  });
  form.querySelectorAll('[name^="proprietario_crv."]').forEach(i => { i.required = false; }); // opcional: só quando o CRV é de outra pessoa
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
        // Veio da aba Contratos: segue para a venda (CNH do comprador) ou volta com o carro escolhido
        const p = lerContratoPendente();
        if (p && precisaComprador(p.modelo)) { gravarContratoPendente({ modelo: p.modelo, venda: r.id }); return ir(`#/carro/${r.id}/vender`); }
        if (p) { gravarContratoPendente({ modelo: p.modelo, carro: r.id }); return ir('#/contratos'); }
        ir(`#/carro/${r.id}`);
      }
    });
  });
}

function dadosPessoa(p) {
  if (!p) return '<span class="suave">—</span>';
  const end = [p.endereco && `${p.endereco}${p.numero ? ', ' + p.numero : ''}`, p.bairro, p.cidade && `${p.cidade}/${p.uf || ''}`]
    .filter(Boolean).join(' · ');
  return `<strong>${esc(p.nome)}</strong> <a class="pequeno" href="#/pessoas/${p.id}">Editar cadastro</a><br><span class="suave pequeno">CPF ${esc(formatarCPF(p.cpf))}${p.telefone ? ' · ' + esc(p.telefone) : ''}${end ? '<br>' + esc(end) : ''}</span>`;
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
      ${v.impostos ? `<div><span>Impostos da venda</span><span>${reais(v.impostos.total)}</span></div>` : ''}
      <div class="total"><span>Custo total</span><span>${reais(v.custo_total)}</span></div>
      ${vendido ? `
      <div><span>Valor de venda</span><span>${reais(v.valor_venda)}</span></div>
      <div class="total"><span>Lucro</span><span class="${v.lucro >= 0 ? 'positivo' : 'negativo'}">${reais(v.lucro)}</span></div>` : ''}
    </div>
  </div>

  ${v.impostos ? `
  <div class="cartao">
    <h2>Impostos da venda</h2>
    <p class="pequeno">Diferença entre venda e compra: <strong>${reais(v.impostos.margem)}</strong>. É sobre ela que incidem PIS, COFINS, IRPJ e CSLL.</p>
    <div class="tabela-rolagem"><table>
      <thead><tr><th>Imposto</th><th>Como calcula</th><th class="num">Base</th><th class="num">Valor</th><th>Quando</th><th>Vencimento</th></tr></thead>
      <tbody>${v.impostos.itens.map(i => `
        <tr><td><strong>${i.nome}</strong></td><td class="pequeno">${i.regra}</td><td class="num">${reais(i.base)}</td><td class="num">${reais(i.valor)}</td>
        <td class="pequeno">${esc(i.quando)}</td><td class="pequeno">${/^\d{4}-/.test(i.vence || '') ? dataBR(i.vence) : esc(i.vence || '—')}</td></tr>`).join('')}
      </tbody>
      <tfoot>
        <tr><td colspan="3">Já na nota (ICMS, PIS, COFINS)</td><td class="num">${reais(v.impostos.naNota)}</td><td colspan="2"></td></tr>
        <tr><td colspan="3">Trimestrais, pagos depois (IRPJ, CSLL)</td><td class="num">${reais(v.impostos.futuros)}</td><td colspan="2"></td></tr>
        <tr><td colspan="3"><strong>Total de impostos</strong></td><td class="num"><strong>${reais(v.impostos.total)}</strong></td><td colspan="2"></td></tr>
      </tfoot>
    </table></div>
    <p class="suave pequeno">Estimativa no regime de lucro presumido, igual às suas notas de venda. Vencimentos já pulando fim de semana e feriados nacionais fixos. Confirme os valores com o contador.</p>
  </div>` : ''}

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
    <p><a class="botao-link secundario" href="/placa.html?id=${id}" target="_blank">Imprimir placa de preço para o vidro (A4)</a></p>
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
      <a class="botao-link secundario" href="/contrato/${id}/repasse" target="_blank">Imprimir contrato de repasse</a>
      ${d.venda?.troca_veiculo_id ? `<a class="botao-link secundario" href="/contrato/${d.venda.troca_veiculo_id}/entrada" target="_blank">Imprimir consignação do carro da troca</a>` : ''}
    </div>
    <p class="suave pequeno">Os campos que faltarem saem com uma linha em branco para preencher à mão.</p>
  </div>

  ${vendido ? '<div class="cartao" id="cartao-avaliacao"><h2>Avaliação no Google</h2><p class="suave pequeno">Carregando convite…</p></div>' : ''}
  ${v.tipo_entrada === 'compra' ? `<div class="cartao" id="cartao-nfe-entrada_compra"><h2>${TITULO_NFE.entrada_compra}</h2><p class="suave pequeno">Carregando…</p></div><div class="cartao" id="cartao-nfe-devolucao_compra"><h2>${TITULO_NFE.devolucao_compra}</h2><p class="suave pequeno">Carregando…</p></div>` : ''}
  ${['consignacao', 'compra_sem_transferir', 'troca'].includes(v.tipo_entrada) ? ['entrada_consignacao', 'devolucao_consignacao'].map(t => `<div class="cartao" id="cartao-nfe-${t}"><h2>${TITULO_NFE[t]}</h2><p class="suave pequeno">Carregando…</p></div>`).join('') : ''}
  ${vendido ? '<div class="cartao" id="cartao-nfe-venda"><h2>Nota fiscal de venda</h2><p class="suave pequeno">Carregando…</p></div>' : ''}

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
    ${d.proprietarioCrv ? `<p class="pequeno" style="margin-top:10px"><strong>Proprietário no CRV (outra pessoa, por procuração):</strong></p>${dadosPessoa(d.proprietarioCrv)}` : ''}
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
  if (vendido) cartaoAvaliacao(id);
  for (const tipo of Object.keys(TITULO_NFE)) if (document.getElementById(`cartao-nfe-${tipo}`)) cartaoNfe(id, tipo);
  if (location.hash.endsWith('/nota')) setTimeout(() => document.getElementById('cartao-nfe-venda')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 600);
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

// O WhatsApp exige a confirmação humana do envio. O histórico abaixo é declarado pela equipe.
async function cartaoAvaliacao(id) {
  const caixa = document.getElementById('cartao-avaliacao');
  try {
    const d = await api('GET', `/veiculos/${id}/avaliacao`);
    if (!caixa?.isConnected) return;
    caixa.innerHTML = `<h2>Avaliação no Google</h2>
      <p>Após a entrega, agradeça ao cliente e convide-o a contar como foi a experiência com a loja.</p>
      ${d.confirmado_em ? `<p role="status"><strong>Envio confirmado pela equipe em ${esc(dataBR(d.confirmado_em.replace(' ', 'T')))}.</strong></p><p class="pequeno suave">O sistema não verifica se o cliente recebeu ou avaliou. Evite repetir o convite.</p>` : ''}
      <div id="preparar-avaliacao" ${d.confirmado_em ? 'hidden' : ''}>
        <label class="campo"><span>Mensagem para o cliente</span><textarea id="mensagem-avaliacao" rows="7" readonly>${esc(d.mensagem)}</textarea></label>
        <p class="pequeno">Envie pela conta da loja: <strong>(14) 99887-0734</strong>. Confira a conta aberta no WhatsApp antes de enviar.</p>
        ${d.url ? `<p class="pequeno">WhatsApp do comprador: ${esc(d.telefone)}</p>` : '<p class="pequeno">O comprador está sem um telefone válido com DDD. Atualize o cadastro para abrir a conversa.</p>'}
        <div class="acoes">
          ${d.url ? `<a class="botao-link" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Abrir convite no WhatsApp</a>` : `<a class="botao-link secundario" href="#/pessoas/${d.comprador_id}">Atualizar telefone do comprador</a>`}
          ${d.confirmado_em ? '' : '<button type="button" id="confirmar-avaliacao" class="secundario">Já enviei o convite</button>'}
        </div>
        <p class="suave pequeno">Abrir a conversa não envia a mensagem. Depois de tocar em Enviar no WhatsApp, clique em “Já enviei o convite”.</p>
      </div>
      ${d.confirmado_em ? '<button type="button" id="reabrir-avaliacao" class="secundario mini">Preparar convite novamente</button>' : ''}`;
    caixa.querySelector('#reabrir-avaliacao')?.addEventListener('click', e => {
      caixa.querySelector('#preparar-avaliacao').hidden = false;
      e.currentTarget.hidden = true;
    });
    caixa.querySelector('#confirmar-avaliacao')?.addEventListener('click', async e => {
      const botao = e.currentTarget; botao.disabled = true;
      try {
        await api('POST', `/veiculos/${id}/avaliacao/enviado`, { venda_id: d.venda_id });
        await cartaoAvaliacao(id);
        aviso('Confirmação de envio registrada.');
      } catch (erro) { aviso(erro.message, true); botao.disabled = false; }
    });
  } catch (erro) {
    if (caixa?.isConnected) caixa.innerHTML = `<h2>Avaliação no Google</h2><p>${esc(erro.message)}</p><button type="button" id="tentar-avaliacao" class="secundario">Tentar novamente</button>`;
    caixa?.querySelector('#tentar-avaliacao')?.addEventListener('click', () => cartaoAvaliacao(id));
  }
}

// Gera o arquivo TXT da nota para importar no Emissor do Sebrae (Sistema → Importar arquivos).
// tipo: 'entrada_consignacao' (CFOP 1917), 'devolucao_consignacao' (CFOP 1918, aponta a entrada)
// ou 'venda' (CFOP 5102, com os dados do RENAVE).
const TITULO_NFE = {
  entrada_compra: 'Nota fiscal de entrada (compra · CFOP 1102)',
  entrada_consignacao: 'Nota fiscal de entrada (consignação)',
  devolucao_consignacao: 'Nota fiscal de devolução (consignação)',
  devolucao_compra: 'Nota fiscal de devolução de compra (CFOP 5202)',
  venda: 'Nota fiscal de venda',
};
// Salva o arquivo da nota. No Chrome/Edge abre a janela "Salvar como" já na última pasta usada para as notas
// (o navegador lembra a pasta pelo id 'notas-fiscais'); nos outros navegadores vai para Downloads como antes.
// Devolve false se a pessoa cancelou a janela.
async function salvarArquivoNota(r) {
  const blob = new Blob([r.conteudo], { type: 'text/plain;charset=utf-8' });
  if (window.showSaveFilePicker) {
    try {
      const arquivo = await window.showSaveFilePicker({
        id: 'notas-fiscais', startIn: 'desktop', suggestedName: r.arquivo,
        types: [{ description: 'Arquivo da nota (TXT)', accept: { 'text/plain': ['.txt'] } }],
      });
      const escrita = await arquivo.createWritable();
      await escrita.write(blob);
      await escrita.close();
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
      // Janela bloqueada (por exemplo, demorou para gerar): baixa do jeito antigo
    }
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = r.arquivo;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  return true;
}

// NF-e direto na SEFAZ (sem o Emissor do Sebrae): usa os mesmos campos do formulário da nota acima
const SITUACAO_NFE = { autorizada: 'Autorizada', rejeitada: 'Recusada', incerta: 'Conferir (sem resposta)', enviando: 'Enviando…' };
async function blocoNfeDireta(id, tipo, form) {
  const caixa = document.getElementById(`nfe-direta-${tipo}`);
  let s;
  try { s = await api('GET', `/veiculos/${id}/nfe/${tipo}/direta`); } catch (e) { caixa.innerHTML = `<p class="suave pequeno">${esc(e.message)}</p>`; return; }
  if (!s.suportado) { caixa.remove(); return; }
  const real = s.ambiente === 'producao';
  const envios = s.jaAutorizada ? s.envios.filter(e => e.situacao === 'autorizada' && e.ambiente === 'producao') : s.envios;
  const lista = envios.length ? `<table class="pequeno" style="margin-top:8px"><thead><tr><th>Quando</th><th>Ambiente</th><th>Nº</th><th>Situação</th><th>Protocolo / motivo</th><th></th></tr></thead><tbody>${envios.map(e => `<tr>
      <td>${esc(e.criado_em.slice(0, 16))}</td><td>${e.ambiente === 'producao' ? 'Real' : 'Teste'}</td><td>${e.numero}</td>
      <td>${esc(SITUACAO_NFE[e.situacao] || e.situacao)}</td><td>${esc(e.protocolo || e.motivo || '')}</td>
      <td>${e.situacao === 'autorizada' ? `<a class="botao-link" href="/danfe/${e.id}.pdf" download>Baixar PDF</a> <button type="button" class="secundario" data-xml-nfe="${e.id}">Baixar XML</button> <a class="botao-link secundario" href="/danfe/${e.id}" target="_blank" rel="noopener">Imprimir</a>` : ''}</td></tr>`).join('')}</tbody></table>` : '';
  caixa.innerHTML = `
    <h3 style="margin:0 0 6px">${s.jaAutorizada ? 'Nota autorizada' : 'Emitir nota'}</h3>
    ${s.jaAutorizada ? '' : `<p class="pequeno" style="border-left:4px solid ${real ? '#b42318' : '#b7791f'};padding-left:8px"><strong>${real ? 'NOTA REAL: vale de verdade e não volta atrás.' : 'Ambiente de TESTE da SEFAZ: a nota não vale e usa um número de teste.'}</strong></p>`}
    ${s.jaAutorizada ? `<p class="pequeno"><strong>Autorizada:</strong> nota nº ${s.jaAutorizada.numero}, protocolo ${esc(s.jaAutorizada.protocolo)}.</p>` : s.habilitado ? `
    <p class="suave pequeno">Usa os dados do formulário acima (número, tipo, valor, data${tipo === 'devolucao_consignacao' ? ' e chave da entrada' : ''}). Confira antes.</p>
    <label class="pequeno" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="nfe-ok-${tipo}" style="width:auto;margin:0"> Conferi os dados${real ? ' e quero emitir a nota real' : ''}</label>
    <div class="grade" style="margin-top:6px">
      <div class="campo c4"><label for="nfe-senha-${tipo}">Senha do certificado digital</label><input id="nfe-senha-${tipo}" type="password" autocomplete="off" placeholder="não fica guardada"></div>
      <div class="campo c4" style="align-self:end"><button type="button" id="nfe-emitir-${tipo}">Emitir nota</button></div>
    </div>` : '<p class="suave pequeno">O certificado digital não está disponível aqui. A emissão direta só funciona onde o certificado está instalado.</p>'}
    ${lista}`;
  if (s.jaAutorizada) document.getElementById(`cartao-nfe-${tipo}`).querySelectorAll('[data-some-autorizada]').forEach(x => { x.style.display = 'none'; });
  caixa.querySelectorAll('[data-xml-nfe]').forEach(b => b.addEventListener('click', async () => {
    try {
      const r = await api('GET', `/nfe-envios/${b.dataset.xmlNfe}/xml`);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([r.conteudo], { type: 'application/xml;charset=utf-8' }));
      link.download = r.arquivo;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    } catch (e) { aviso(e.message, true); }
  }));
  const botao = document.getElementById(`nfe-emitir-${tipo}`);
  if (!botao) return;
  botao.addEventListener('click', async () => {
    if (!form.reportValidity()) return;
    if (!document.getElementById(`nfe-ok-${tipo}`).checked) return aviso('Marque que você conferiu os dados.', true);
    const senha = document.getElementById(`nfe-senha-${tipo}`).value;
    if (!senha) return aviso('Digite a senha do certificado.', true);
    let dados;
    try { dados = lerForm(form); } catch (e) { return aviso(e.message, true); }
    botao.disabled = true;
    botao.textContent = 'Enviando à SEFAZ… não feche';
    try {
      const r = await api('POST', `/veiculos/${id}/nfe/${tipo}/direta`, { ...dados, origemXml: form._origemXml || undefined, senha, confirmar: true, confirmarProducao: real });
      aviso(`${real ? 'Nota' : 'Nota de TESTE'} nº ${r.numero} autorizada. Protocolo ${r.protocolo}.`);
    } catch (e) {
      aviso(e.message, true);
    }
    document.getElementById(`nfe-senha-${tipo}`).value = '';
    cartaoNfe(id, tipo);
  });
}

async function cartaoNfe(id, tipo) {
  const el = document.getElementById(`cartao-nfe-${tipo}`);
  const titulo = TITULO_NFE[tipo];
  try {
    const s = await api('GET', `/veiculos/${id}/nfe/${tipo}`);
    if (!s.permitido) { el.innerHTML = `<h2>${titulo}</h2><p class="pequeno">${esc(s.motivo)}</p>`; return; }
    const o = s.opcoes;
    const f = s.ficha || {};
    const c = s.calculo;
    el.innerHTML = `
    <h2>${titulo}</h2>
    <p class="pequeno" data-some-autorizada>Gera o arquivo da nota com os dados do ${tipo === 'venda' ? 'comprador' : tipo === 'entrada_compra' ? 'vendedor' : 'dono'} e do carro. Depois, no Emissor do Sebrae: <b>Sistema → Importar arquivos</b>, confira e transmita.</p>
    ${s.ultima ? `<p class="pequeno" data-some-autorizada>Já gerada: nota nº <b>${s.ultima.numero}</b> em ${dataBR(s.ultima.criado_em.replace(' ', 'T'))}. Gerar de novo com o mesmo número substitui o arquivo.</p>
    <div class="pequeno" data-some-autorizada style="margin:6px 0 10px;padding:8px;border:1px solid #c9d1dc;border-radius:6px">
      ${s.ultima.temXml
        ? `<strong>Autorizada</strong> · protocolo ${esc(s.ultima.protocolo)} &nbsp;
           <a class="botao-link" href="/danfe-nota/${s.ultima.id}.pdf" download>Baixar PDF</a>
           <button type="button" class="secundario" data-baixar-xml="${s.ultima.id}">Baixar XML</button>
           <a class="botao-link secundario" href="/danfe-nota/${s.ultima.id}" target="_blank" rel="noopener">Imprimir</a>
           <span class="suave"> · trocar o XML: <input type="file" accept=".xml,text/xml" data-anexar-xml></span>`
        : `<span class="suave">Depois que o Emissor transmitir e a SEFAZ autorizar, anexe aqui o <b>XML autorizado</b> (pasta Notas, o arquivo que termina em <b>-procNfe.xml</b>) para liberar <b>Baixar PDF</b> e <b>Baixar XML</b>:</span> <input type="file" accept=".xml,text/xml" data-anexar-xml>`}
    </div>` : ''}
    <form id="form-nfe-${tipo}" class="grade" data-some-autorizada novalidate>
      ${campo('Número da nota', 'numero', { valor: s.numero, obrig: true, largura: 'c3', extra: 'inputmode="numeric"' })}
      ${selecao('Tipo do veículo (NCM)', 'ncm', Object.fromEntries(Object.entries(o.ncms).map(([k, t]) => [k, `${t} · ${k}`])), s.ncm, 'c5')}
      ${campo('Valor da nota', 'valor', { valor: paraTexto(s.valor), dinheiro: true, obrig: true, largura: 'c4' })}
      ${campo('Data e hora', 'data', { valor: agoraLocal().slice(0, 16), tipo: 'datetime-local', obrig: true, largura: 'c4' })}
      ${tipo === 'entrada_compra' ? selecao('Forma de pagamento', 'pagamento', { pix: 'PIX', deposito: 'Depósito bancário / TED' }, 'pix', 'c4') : ''}
      ${s.referencia !== null ? `
      ${campo(tipo === 'devolucao_compra' ? 'Chave da nota de venda da loja (ou da sua entrada)' : 'Chave da nota de entrada', 'referencia', { valor: s.referencia, obrig: true, largura: 'c12', extra: 'inputmode="numeric" maxlength="54" placeholder="44 números da DANFE da entrada"' })}
      <div class="campo c12"><small class="suave">${s.entrada ? `Já preenchida com a nota de entrada nº ${s.entrada.numero}, gerada pelo sistema.` : 'Se a entrada foi feita direto no Sebrae, copie a chave de acesso dela (está na DANFE).'} ${tipo === 'devolucao_compra' ? 'Use quando o carro comprado volta para quem vendeu. Se a loja emitiu nota de venda, a devolução aponta a nota dela.' : 'Use quando o carro volta para o dono ou quando o dono transfere direto para o comprador.'}</small></div>` : ''}
      ${tipo === 'devolucao_compra' ? `
      <div class="campo c12"><label for="xml-origem-${tipo}"><b>XML da nota de venda da loja</b> (recomendado: a devolução sai com o mesmo ICMS da nota dela, para a loja estornar o ICMS)</label>
        <input id="xml-origem-${tipo}" type="file" accept=".xml,text/xml,application/xml">
        <small class="suave" id="xml-origem-info-${tipo}">Sem o XML, o ICMS sai no padrão (18% sobre 10% do valor), que pode não bater com o da nota da loja. PIS/COFINS saem 07, como sempre.</small></div>` : ''}
      ${`
      ${f.motor ? '<div class="campo c12"><details><summary class="suave pequeno">Dados do CRLV do carro (já preenchidos na entrada: clique para conferir ou corrigir)</summary><div class="grade" style="margin-top:8px">' : ''}
      <div class="campo c12"><span><b>Dados do CRLV para a aba "Veículo Novo"</b> (vão em todas as notas). Ficam guardados no carro: na próxima nota já vêm preenchidos.</span></div>
      ${campo('Nº do motor', 'ficha.motor', { valor: f.motor, obrig: true, largura: 'c4' })}
      ${campo('Potência (CV)', 'ficha.potencia', { valor: f.potencia, obrig: true, largura: 'c2', extra: 'inputmode="numeric"' })}
      ${campo('Cilindradas (cm³)', 'ficha.cilindrada', { valor: f.cilindrada, obrig: true, largura: 'c2', extra: 'inputmode="numeric"' })}
      ${campo('Peso bruto (t)', 'ficha.peso', { valor: f.peso, obrig: true, largura: 'c2', extra: 'inputmode="decimal" placeholder="1,51"' })}
      ${campo('CMT (t)', 'ficha.cmt', { valor: f.cmt, largura: 'c2', extra: 'inputmode="decimal" placeholder="igual ao peso"' })}
      ${campo('Eixos', 'ficha.eixos', { valor: f.eixos, largura: 'c2', extra: 'inputmode="numeric"' })}
      ${campo('Lotação', 'ficha.lotacao', { valor: f.lotacao, obrig: true, largura: 'c2', extra: 'inputmode="numeric"' })}
      ${selecao('Combustível', 'ficha.combustivel', o.combustiveis, f.combustivel, 'c4')}
      ${selecao('Tipo', 'ficha.tipo', o.tipos, f.tipo, 'c4')}
      ${selecao('Espécie', 'ficha.especie', o.especies, f.especie, 'c4')}
      ${selecao('Cor (DENATRAN)', 'ficha.cor', o.cores, f.cor, 'c4')}
      ${selecao('Pintura', 'ficha.pintura', o.pinturas, f.pintura, 'c4')}
      ${campo('Código marca/modelo', 'ficha.marca_modelo', { valor: f.marca_modelo, largura: 'c4', extra: 'inputmode="numeric"' })}
      ${f.motor ? '</div></details></div>' : ''}`}
      ${['entrada_consignacao', 'devolucao_consignacao', 'entrada_compra', 'devolucao_compra'].includes(tipo)
        ? '<div class="campo c12"><details><summary class="suave pequeno">Alternativa: gerar o arquivo para importar no Emissor do Sebrae</summary><div style="margin-top:8px"><button type="submit" class="secundario">Baixar arquivo da nota</button></div></details></div>'
        : '<div class="campo c4" style="justify-content:flex-end"><button type="submit">Baixar arquivo da nota</button></div>'}
    </form>
    ${['entrada_consignacao', 'devolucao_consignacao', 'entrada_compra', 'devolucao_compra', 'venda'].includes(tipo) ? `<div id="nfe-direta-${tipo}" class="conferencia" style="margin-top:12px"></div>` : ''}
    ${s.venda ? `<div id="tributos-venda" class="pequeno" style="margin-top:10px;padding:10px;border:1px solid #c9d1dc;border-radius:6px"></div>` : ''}
    <p class="suave pequeno" data-some-autorizada>Confira o número com o próximo do Sebrae. ${{ venda: 'CFOP 5102, cBenef SP020110, igual às suas vendas.', entrada_compra: 'CFOP 1102, igual às suas notas de compra 1034, 1038 e 1039 (pagamento em PIX).', entrada_consignacao: 'CFOP 1917, igual às suas notas de consignação.', devolucao_consignacao: 'CFOP 1918, igual às suas devoluções 1067 a 1069.', devolucao_compra: 'CFOP 5202 (6202 se a loja for de outro estado), igual às devoluções 1066 e 1073.' }[tipo]}</p>`;
    // Nota feita pelo Emissor: anexar o XML autorizado libera "Baixar nota" (DANFE) e "Baixar XML"
    el.querySelectorAll('[data-anexar-xml]').forEach(inp => inp.addEventListener('change', async () => {
      const arq = inp.files[0];
      if (!arq) return;
      try {
        const r = await api('POST', `/veiculos/${id}/nfe/${tipo}/xml`, { xml: await arq.text() });
        aviso(`XML da nota nº ${r.numero} anexado. Já dá para baixar o PDF e o XML.`);
        cartaoNfe(id, tipo);
      } catch (e) { aviso(e.message, true); inp.value = ''; }
    }));
    el.querySelectorAll('[data-baixar-xml]').forEach(b => b.addEventListener('click', async () => {
      try {
        const r = await api('GET', `/nfe-notas/${b.dataset.baixarXml}/xml`);
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([r.conteudo], { type: 'application/xml;charset=utf-8' }));
        link.download = r.arquivo;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 5000);
      } catch (e) { aviso(e.message, true); }
    }));
    const form = document.getElementById(`form-nfe-${tipo}`);
    // Nota de venda: tributos calculados na hora, conforme o valor digitado (pode ser diferente do contrato)
    const caixaTributos = document.getElementById('tributos-venda');
    if (caixaTributos) {
      const mostrar = () => {
        let valor = null;
        try { valor = paraCentavos(form.elements.valor.value); } catch { valor = null; }
        const contrato = s.venda.valorContrato ? `Valor da venda no contrato: <b>${reais(s.venda.valorContrato)}</b>. Compra: ${reais(s.venda.valorCompra)}.` : '';
        if (!valor || valor <= 0) { caixaTributos.innerHTML = `<b>Tributos da venda</b><br><span class="suave">Digite o valor da nota para ver os impostos.</span><br>${contrato}`; return; }
        const baseIcms = Math.round(valor * 0.10), icms = Math.round(baseIcms * 0.18);
        const lucro = Math.max(0, valor - s.venda.valorCompra), pis = Math.round(lucro * 0.0065), cofins = Math.round(lucro * 0.03);
        caixaTributos.innerHTML = `<b>Tributos desta nota</b> (valor ${reais(valor)})
          <table class="pequeno" style="margin:6px 0"><tbody>
          <tr><td>ICMS: 18% sobre 10% do valor (${reais(baseIcms)})</td><td class="num"><b>${reais(icms)}</b></td></tr>
          <tr><td>PIS: 0,65% sobre o lucro (${reais(lucro)} = venda − compra)</td><td class="num"><b>${reais(pis)}</b></td></tr>
          <tr><td>COFINS: 3% sobre o lucro</td><td class="num"><b>${reais(cofins)}</b></td></tr>
          <tr><td><b>Total de tributos</b></td><td class="num"><b>${reais(icms + pis + cofins)}</b></td></tr>
          </tbody></table>${contrato}${s.venda.valorContrato && valor !== s.venda.valorContrato ? ' <span style="color:#b7791f">O valor da nota está diferente do contrato.</span>' : ''}`;
      };
      form.elements.valor.addEventListener('input', mostrar);
      mostrar();
    }
    // Devolução de compra: lê o XML da nota de venda da loja e mostra o que vai sair espelhado (o servidor confere tudo de novo)
    const xmlOrigem = document.getElementById(`xml-origem-${tipo}`);
    if (xmlOrigem) xmlOrigem.addEventListener('change', async () => {
      const info = document.getElementById(`xml-origem-info-${tipo}`);
      form._origemXml = null;
      const arq = xmlOrigem.files[0];
      if (!arq) return;
      const texto = await arq.text();
      const doc = new DOMParser().parseFromString(texto, 'application/xml');
      const chave = (doc.querySelector('infNFe')?.getAttribute('Id') || '').replace(/^NFe/, '');
      if (!/^\d{44}$/.test(chave)) { info.textContent = 'Esse arquivo não parece o XML de uma NF-e. Escolha o XML da nota de venda da loja.'; return; }
      const tot = doc.getElementsByTagName('ICMSTot')[0];
      const totv = n => Math.round(Number(tot?.getElementsByTagName(n)[0]?.textContent || 0) * 100);
      const nome = doc.getElementsByTagName('emit')[0]?.getElementsByTagName('xNome')[0]?.textContent || '';
      const nNF = doc.getElementsByTagName('nNF')[0]?.textContent || '';
      form._origemXml = texto;
      form.elements.referencia.value = chave;
      form.elements.valor.value = 'R$ ' + paraTexto(totv('vNF'));
      info.innerHTML = `Espelho da nota nº <b>${esc(nNF)}</b> de <b>${esc(nome)}</b>: valor ${reais(totv('vNF'))}, base do ICMS ${reais(totv('vBC'))}, ICMS ${reais(totv('vICMS'))}. A loja, o valor, a chave e o ICMS saem iguais aos da nota dela (PIS/COFINS 07).`;
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      enviar(form, async dados => {
        const r = await api('POST', `/veiculos/${id}/nfe/${tipo}`, { ...dados, origemXml: form._origemXml || undefined });
        const salvo = await salvarArquivoNota(r);
        aviso(salvo === false
          ? `Nota nº ${r.numero} gerada, mas o arquivo não foi salvo. Clique em "Baixar arquivo da nota" de novo (o número é o mesmo).`
          : `Nota nº ${r.numero} gerada. Agora importe o arquivo no Emissor do Sebrae.`, salvo === false);
        cartaoNfe(id, tipo);
      });
    });
    if (document.getElementById(`nfe-direta-${tipo}`)) blocoNfeDireta(id, tipo, form);
  } catch (e) {
    el.innerHTML = `<h2>${titulo}</h2><p class="pequeno">${esc(e.message)}</p>`;
  }
}

async function telaVenda(id) {
  const d = await api('GET', `/veiculos/${id}`);
  const v = d.veiculo;
  if (v.status !== 'estoque') return ir(`#/carro/${id}`);
  // Só vale o aviso/volta para Contratos se a venda é do carro que acabou de ser cadastrado lá
  const pendenteVenda = lerContratoPendente()?.venda === id ? lerContratoPendente() : null;

  app.innerHTML = `
  <div class="cabecalho"><div><h1>Registrar venda</h1>
    <div class="suave">${esc(v.marca_modelo)} · <span class="placa">${esc(formatarPlaca(v.placa))}</span> · custo total ${reais(v.custo_total)}</div></div></div>
  ${avisoContratoPendente(pendenteVenda, 'venda')}
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
      <a class="botao-link secundario" href="${pendenteVenda ? '#/contratos' : `#/carro/${id}`}">Cancelar</a>
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
       · Lucro previsto antes dos impostos: <strong class="${lucro >= 0 ? 'positivo' : 'negativo'}">${reais(lucro)}</strong>`;
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
      if (pendenteVenda) { gravarContratoPendente({ modelo: pendenteVenda.modelo, carro: id }); return ir('#/contratos'); }
      // Carro da loja: já abre a página do carro no cartão da nota de venda, com o comprador e os pagamentos preenchidos
      ir(v.tipo_entrada === 'compra' ? `#/carro/${id}/nota` : `#/carro/${id}`);
    });
  });
}

async function confirmarExclusaoPessoa(pessoa, totalVinculos) {
  const mensagem = totalVinculos
    ? `Excluir ${pessoa.nome} da lista principal de Pessoas?\n\nComo há compras ou vendas vinculadas, o cadastro será arquivado. O histórico dos veículos será mantido e você poderá restaurar o cadastro na lista de Arquivados.`
    : `Excluir definitivamente o cadastro de ${pessoa.nome}?\n\nEsta pessoa não possui compra ou venda vinculada.`;
  if (!confirm(mensagem)) return false;
  const resultado = await api('DELETE', `/pessoas/${pessoa.id}`);
  aviso(resultado.acao === 'arquivado' ? 'Cadastro arquivado. O histórico dos veículos foi mantido.' : 'Cadastro excluído');
  return true;
}

async function telaPessoas() {
  app.innerHTML = `
  <div class="cabecalho"><div><h1>Pessoas</h1><div class="suave">Clique no nome para consultar ou editar o cadastro.</div></div>
    <div class="filtros-pessoas"><input class="busca" type="search" placeholder="Buscar nome ou CPF" aria-label="Buscar nome ou CPF" id="busca">
    <select id="situacao-pessoas" aria-label="Situação dos cadastros"><option value="ativas">Ativos</option><option value="arquivadas">Arquivados</option></select></div></div>
  <div class="cartao"><div class="tabela-rolagem" id="tabela"></div></div>`;
  const tabela = document.getElementById('tabela');
  const busca = document.getElementById('busca');
  const situacao = document.getElementById('situacao-pessoas');
  let pessoas = [];
  let pedido = 0;
  const carregar = async () => {
    const atual = ++pedido;
    try {
      const arquivadas = situacao.value === 'arquivadas';
      const resposta = await api('GET', `/pessoas?busca=${encodeURIComponent(busca.value)}&arquivadas=${arquivadas ? '1' : '0'}`);
      if (atual !== pedido || !document.body.contains(tabela)) return;
      pessoas = resposta;
      tabela.innerHTML = pessoas.length ? `<table>
        <thead><tr><th>Nome</th><th>CPF</th><th>Telefone</th><th>Cidade</th><th>Ações</th></tr></thead>
        <tbody>${pessoas.map(p => `<tr>
          <td><a class="link-pessoa" href="#/pessoas/${p.id}">${esc(p.nome)}</a></td>
          <td>${esc(formatarCPF(p.cpf))}</td><td>${esc(p.telefone || '—')}</td><td>${esc(p.cidade ? `${p.cidade}/${p.uf || ''}` : '—')}</td>
          <td><div class="acoes-pessoa"><a class="botao-link secundario" href="#/pessoas/${p.id}">Editar</a>
          ${p.arquivado_em ? `<button type="button" data-acao-pessoa="restaurar" data-id="${p.id}">Restaurar</button>` : ''}
          ${!p.arquivado_em || !p.total_vinculos ? `<button type="button" class="perigo" data-acao-pessoa="excluir" data-id="${p.id}">Excluir</button>` : ''}</div></td>
        </tr>`).join('')}</tbody>
      </table>` : `<div class="vazio">${arquivadas ? 'Nenhuma pessoa arquivada encontrada.' : 'Nenhuma pessoa encontrada.'}</div>`;
    } catch (erro) {
      if (atual === pedido && document.body.contains(tabela)) { tabela.innerHTML = '<div class="vazio">Não foi possível carregar os cadastros.</div>'; aviso(erro.message, true); }
    }
  };
  tabela.addEventListener('click', async e => {
    const botao = e.target.closest('[data-acao-pessoa]');
    if (!botao) return;
    const pessoa = pessoas.find(p => p.id === Number(botao.dataset.id));
    if (!pessoa) return;
    botao.disabled = true;
    try {
      if (botao.dataset.acaoPessoa === 'excluir') { if (await confirmarExclusaoPessoa(pessoa, pessoa.total_vinculos)) await carregar(); }
      else { await api('POST', `/pessoas/${pessoa.id}/restaurar`); aviso('Cadastro restaurado'); await carregar(); }
    } catch (erro) { aviso(erro.message, true); }
    finally { botao.disabled = false; }
  });
  let t;
  busca.addEventListener('input', () => { clearTimeout(t); t = setTimeout(carregar, 250); });
  situacao.addEventListener('change', () => { clearTimeout(t); carregar(); });
  await carregar();
}

async function telaPessoa(id) {
  const { pessoa, vinculos } = await api('GET', `/pessoas/${id}`);
  const podeExcluir = !pessoa.arquivado_em || !vinculos.length;
  app.innerHTML = `
  <div class="cabecalho"><div><h1>Editar pessoa</h1><div class="suave">${esc(pessoa.nome)} ${pessoa.arquivado_em ? '· Arquivado' : ''}</div></div>
    <div class="acoes"><a class="botao-link secundario" href="#/pessoas">Voltar para Pessoas</a>
    ${pessoa.arquivado_em ? '<button type="button" id="restaurar-pessoa">Restaurar cadastro</button>' : ''}
    ${podeExcluir ? '<button type="button" class="perigo" id="excluir-pessoa">Excluir cadastro</button>' : ''}</div></div>
  ${pessoa.arquivado_em ? '<p class="conferencia">Este cadastro está arquivado. Use Restaurar cadastro para devolvê-lo à lista principal.</p>' : ''}
  <form id="form-pessoa" novalidate>
    ${blocoPessoa('pessoa', 'Dados do cliente', pessoa)}
    <p class="suave pequeno">As correções serão usadas nas próximas consultas e impressões dos veículos vinculados.</p>
    <div class="acoes-form"><a class="botao-link secundario" href="#/pessoas">Cancelar</a><button type="submit">Salvar alterações</button></div>
  </form>
  <div class="cartao"><h2>Veículos vinculados</h2>
    ${vinculos.length ? `<ul class="vinculos-pessoa">${vinculos.map(v => `<li><a href="#/carro/${v.id}">${esc(v.marca_modelo)}${v.placa ? ' · ' + esc(formatarPlaca(v.placa)) : ''}</a><span class="suave pequeno">${esc(v.papel)} · ${v.status === 'vendido' ? 'Vendido' : v.status === 'devolvido' ? 'Devolvido' : 'Em estoque'}</span></li>`).join('')}</ul>` : '<p class="suave">Nenhuma compra ou venda vinculada a este cadastro.</p>'}
  </div>`;
  const form = document.getElementById('form-pessoa');
  ligarPessoa(form, 'pessoa', { buscarCadastro: false, atualizarEndereco: true });
  form.addEventListener('submit', e => {
    e.preventDefault();
    enviar(form, async dados => { await api('PUT', `/pessoas/${id}`, dados.pessoa); await telaPessoa(id); aviso('Dados do cliente atualizados'); });
  });
  document.getElementById('excluir-pessoa')?.addEventListener('click', async e => {
    const botao = e.currentTarget; botao.disabled = true;
    try { if (await confirmarExclusaoPessoa(pessoa, vinculos.length)) ir('#/pessoas'); }
    catch (erro) { aviso(erro.message, true); } finally { botao.disabled = false; }
  });
  document.getElementById('restaurar-pessoa')?.addEventListener('click', async e => {
    const botao = e.currentTarget; botao.disabled = true;
    try { await api('POST', `/pessoas/${id}/restaurar`); await telaPessoa(id); aviso('Cadastro restaurado'); }
    catch (erro) { aviso(erro.message, true); } finally { botao.disabled = false; }
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

// Aba Contratos: todos os modelos num lugar só. Escolhe o modelo, escolhe o carro e imprime.
const MODELOS_CONTRATO = [
  { tipo: 'compra', nome: 'Compra', texto: 'A loja compra o carro e ele vai para o nome dela.', vendido: false },
  { tipo: 'consignacao', nome: 'Consignação', texto: 'O dono deixa o carro na loja e recebe quando vender. Entra o adendo de quitação nos carros de troca ou compra sem transferir.', vendido: false },
  { tipo: 'venda', nome: 'Venda com garantia', texto: 'Venda ao cliente com garantia de motor e câmbio (dias ou km). Só sai depois de registrar a venda e o km na entrega.', vendido: true },
  { tipo: 'repasse', nome: 'Repasse', texto: 'Venda de carro recebido na troca, pelo mesmo valor, sem garantia contratual extra. Com o carro em estoque, comprador e preço saem em branco.', vendido: false, branco: true },
  { tipo: 'avaliacao', nome: 'Carta de avaliação', texto: 'Informa quanto a loja avalia o veículo, sem obrigar a comprar. Já abre em "Adicionar novo veículo" (carro de fora): anexe o documento e digite o valor. Também dá para escolher um carro do estoque. Em "Em branco" tudo sai em linhas para preencher à mão.', vendido: false, avaliacao: true, branco: true },
];

// "Adicionar novo veículo" na aba Contratos: guarda o modelo escolhido enquanto o carro é cadastrado
// (entrada com CRLV + CNH do vendedor e, se o modelo pede comprador, a venda com CNH do comprador)
const CONTRATO_PENDENTE = 'contratoPendente';
function lerContratoPendente() {
  try { return JSON.parse(sessionStorage.getItem(CONTRATO_PENDENTE) || 'null'); } catch { return null; }
}
function gravarContratoPendente(dados) {
  try { dados ? sessionStorage.setItem(CONTRATO_PENDENTE, JSON.stringify(dados)) : sessionStorage.removeItem(CONTRATO_PENDENTE); } catch { /* sem armazenamento: só não volta sozinho */ }
}
const precisaComprador = modelo => modelo === 'venda' || modelo === 'repasse';
function avisoContratoPendente(pendente, etapa) {
  if (!pendente) return '';
  const nome = MODELOS_CONTRATO.find(m => m.tipo === pendente.modelo)?.nome || 'contrato';
  const texto = etapa === 'entrada'
    ? `Cadastro para o contrato de <strong>${esc(nome)}</strong>. Anexe o documento do carro (CRLV) e a CNH ou RG do vendedor/dono: o sistema preenche sozinho. ${precisaComprador(pendente.modelo) ? 'Depois de salvar, abre a venda para anexar a CNH do comprador.' : 'Depois de salvar, volta para Contratos com o carro já escolhido.'}`
    : `Venda para o contrato de <strong>${esc(nome)}</strong>. Anexe a CNH ou RG do comprador: o sistema preenche sozinho. Depois de confirmar, volta para Contratos com o carro já escolhido.`;
  return `<div class="cartao" style="border-left:4px solid #17385f"><p style="margin:0">${texto}</p></div>`;
}

async function telaContratos() {
  const [estoque, vendidos] = await Promise.all([api('GET', '/veiculos?status=estoque'), api('GET', '/veiculos?status=vendido')]);
  const rotuloCarro = v => `${v.marca_modelo}${v.placa ? ' · ' + formatarPlaca(v.placa) : ''}`;
  const opcoes = lista => lista.map(v => `<option value="${v.id}">${esc(rotuloCarro(v))}</option>`).join('');
  // Voltando do cadastro de um carro novo: já deixa o modelo e o carro escolhidos
  const pendente = lerContratoPendente();
  const pronto = pendente?.carro ? pendente : null;
  if (pendente) gravarContratoPendente(null);
  app.innerHTML = `
  <div class="cabecalho"><div><h1>Contratos</h1><div class="suave">Escolha o modelo e o carro. A janela de impressão abre sozinha.</div></div></div>
  <div class="cartao">
    <h2>Montar contrato</h2>
    <div class="grade">
      <div class="campo c6"><label for="contrato-modelo">Modelo</label>
        <select id="contrato-modelo">${MODELOS_CONTRATO.map(m => `<option value="${m.tipo}">${esc(m.nome)}</option>`).join('')}</select></div>
      <div class="campo c6"><label for="contrato-carro">Carro</label>
        <select id="contrato-carro"></select></div>
    </div>
    <div class="grade" id="contrato-avaliacao" hidden>
      <div class="campo c4"><label for="contrato-valor">Valor da avaliação</label>
        <input id="contrato-valor" inputmode="decimal" data-dinheiro placeholder="R$ 0,00"></div>
      <div class="campo c8"><label for="contrato-extras">Observação no fim dos dados (opcional)</label>
        <input id="contrato-extras" placeholder="Ex.: ótimo estado de conservação"></div>
    </div>
    <form id="form" novalidate hidden>
      <p class="suave pequeno" style="margin:12px 0 0">Carro de fora: anexe a foto ou o PDF do documento (CRLV) e o sistema preenche os dados abaixo. Ele <strong>não</strong> entra no estoque.</p>
      ${blocoAnexos('o documento do carro')}
      ${blocoVeiculo('veiculo', 'Dados do carro avaliado')}
    </form>
    <p class="suave pequeno" id="contrato-descricao"></p>
    <div class="acoes"><button type="button" id="contrato-gerar">Abrir para imprimir</button></div>
  </div>
  <div class="cartao">
    <h2>Modelos disponíveis</h2>
    <ul>${MODELOS_CONTRATO.map(m => `<li><strong>${esc(m.nome)}</strong> <span class="suave pequeno">· ${esc(m.texto)}</span></li>`).join('')}</ul>
    <p class="suave pequeno">Os campos que faltarem saem com uma linha em branco para preencher à mão. Para trocar o texto de um modelo, é só pedir.</p>
  </div>`;
  const modelo = document.getElementById('contrato-modelo');
  const carro = document.getElementById('contrato-carro');
  const form = document.getElementById('form');
  const botaoGerar = document.getElementById('contrato-gerar');
  ligarAnexos(form, 'entrada');
  // Na avaliação de carro de fora só interessa o documento: esconde km do painel e fotos do carro
  form.querySelectorAll('details.fotos-opcionais').forEach(d => (d.hidden = true));
  // A carta de avaliação não leva chassi nem km: esconde esses campos
  for (const nome of ['veiculo.chassi', 'veiculo.km_entrada']) { const c = form.elements[nome]?.closest('.campo'); if (c) c.hidden = true; }
  // Abre sempre em Consignação (o mais usado), a não ser que esteja voltando do cadastro de um carro novo
  modelo.value = pronto && MODELOS_CONTRATO.some(m => m.tipo === pronto.modelo) ? pronto.modelo : 'consignacao';
  const novo = () => carro.value === 'novo';
  const ajustarCarro = () => {
    const avaliacaoDeFora = novo() && modelo.value === 'avaliacao';
    form.hidden = !avaliacaoDeFora;
    botaoGerar.textContent = novo() && !avaliacaoDeFora ? 'Cadastrar o carro e anexar documentos' : 'Abrir para imprimir';
  };
  const atualizar = () => {
    const m = MODELOS_CONTRATO.find(x => x.tipo === modelo.value);
    const emBranco = m.branco ? '<option value="0">Em branco (preencher à mão)</option>' : '';
    const opcaoNovo = `<option value="novo">+ Adicionar novo veículo (foto do documento${m.avaliacao ? '' : ' e da CNH'})</option>`;
    const lista = m.vendido
      ? (vendidos.length ? `<optgroup label="Vendidos">${opcoes(vendidos)}</optgroup>` : '')
      : `${estoque.length ? `<optgroup label="Em estoque">${opcoes(estoque)}</optgroup>` : ''}${vendidos.length ? `<optgroup label="Vendidos">${opcoes(vendidos)}</optgroup>` : ''}`;
    carro.innerHTML = `${opcaoNovo}${emBranco}${lista}`;
    // Todos os modelos abrem em "+ Adicionar novo veículo" (o mais usado); o carro do estoque é só escolher na lista
    carro.value = 'novo';
    document.getElementById('contrato-descricao').textContent = m.texto;
    document.getElementById('contrato-avaliacao').hidden = !m.avaliacao;
    ajustarCarro();
  };
  modelo.addEventListener('change', atualizar);
  carro.addEventListener('change', ajustarCarro);
  atualizar();
  if (pronto && carro.querySelector(`option[value="${Number(pronto.carro)}"]`)) {
    carro.value = String(Number(pronto.carro));
    ajustarCarro();
    aviso('Carro cadastrado. Confira e clique em "Abrir para imprimir".');
  }
  botaoGerar.addEventListener('click', () => {
    if (!carro.value) return aviso('Escolha um carro para montar o contrato.', true);
    // Carro novo (menos na avaliação): cadastra pela entrada de carro, que lê CRLV e CNH, e volta para cá
    if (novo() && modelo.value !== 'avaliacao') {
      gravarContratoPendente({ modelo: modelo.value });
      return ir('#/nova-entrada');
    }
    let consulta = '';
    const q = new URLSearchParams();
    if (modelo.value === 'avaliacao') {
      let centavos = null;
      try { centavos = paraCentavos(document.getElementById('contrato-valor').value); } catch { return aviso('Valor da avaliação inválido.', true); }
      if (centavos) q.set('valor', centavos);
      const extras = document.getElementById('contrato-extras').value.trim();
      if (extras) q.set('extras', extras);
      if (novo()) {
        if (form._uploadsPendentes > 0 || form._celularPendente) return aviso('Aguarde a leitura do documento.', true);
        const v = lerForm(form).veiculo || {};
        if (!v.marca_modelo) { form.elements['veiculo.marca_modelo'].focus(); return aviso('Anexe o documento ou digite a marca/modelo do carro.', true); }
        for (const k of ['marca_modelo', 'placa', 'ano_fab', 'ano_mod', 'cor', 'chassi', 'renavam']) {
          if (v[k]) q.set(k, k === 'placa' || k === 'chassi' ? String(v[k]).toUpperCase().replace(/[^A-Z0-9]/g, '') : v[k]);
        }
      }
    }
    consulta = q.toString() ? `?${q}` : '';
    window.open(`/contrato/${novo() ? 0 : carro.value}/${modelo.value}${consulta}`, '_blank');
  });
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

// ---------- nota de serviço (comissão de banco) ----------

async function baixarXmlNfse(id) {
  const r = await api('GET', `/nfse/${id}/xml`);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([r.conteudo], { type: 'application/xml;charset=utf-8' }));
  link.download = r.arquivo;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

const STATUS_NFSE = { emitida: 'Emitida', recusada: 'Recusada', incerta: 'Conferir no portal', enviando: 'Enviando…' };

async function telaNotaServico() {
  const d = await api('GET', '/nfse');
  const real = d.ambiente === 'producao';
  const nomeBanco = n => (['pessoa-fisica', 'cliente-consignacao'].includes(n.tomador) ? `${n.tomador_nome || ''} (CPF ${n.tomador_doc || ''})` : d.tomadores.find(t => t.id === n.tomador)?.nome || n.tomador);
  app.innerHTML = `
  <div class="cabecalho"><div><h1>Nota de serviço</h1><div class="suave">Comissão de banco (financiamento e seguros), emitida direto na Receita.</div></div></div>
  ${real && d.habilitado ? '' : `<div class="cartao" style="border-left:4px solid ${real ? '#b42318' : '#b7791f'}">
    <strong>${real ? 'NOTA REAL: ela vale de verdade e não volta atrás.' : 'Ambiente de TESTES da Receita: a nota não vale.'}</strong>
    <p class="suave pequeno">${d.habilitado ? `Certificado: ${esc(d.certificado)}. Próximo número de DPS: ${d.proximoNumero}.` : 'O certificado digital não está neste computador (ou você abriu o sistema por fora da loja). A emissão só funciona no PC da loja.'}</p>
  </div>`}
  <div class="cartao">
    <h2>Nova nota</h2>
    <form id="form-nfse" class="grade" novalidate>
      <div class="campo c6"><label for="nfse-banco">Banco ou cliente</label>
        <select id="nfse-banco">${d.tomadores.map(t => `<option value="${t.id}" data-tipo="${t.tipo}">${esc(t.nome)} · código ${t.codigo.replace(/^(\d\d)(\d\d)(\d\d)$/, '$1.$2.$3')}</option>`).join('')}</select></div>
      <div class="campo c3"><label for="nfse-valor">Valor da comissão</label>
        <input id="nfse-valor" inputmode="decimal" data-dinheiro placeholder="R$ 0,00"></div>
      <div class="campo c3"><label for="nfse-competencia">Data de competência</label>
        <input id="nfse-competencia" type="date" value="${esc(d.hoje)}" max="${esc(d.hoje)}"></div>
      <div class="campo c12" id="nfse-carro-campo" hidden><label for="nfse-carro">Carro consignado (o dono vira o cliente da nota)</label>
        <select id="nfse-carro"><option value="">Escolha o carro…</option>${d.carrosConsignados.map(c => `<option value="${c.id}" ${c.cpfOk ? '' : 'disabled'}>${esc(c.rotulo)} — ${esc(c.dono || 'sem dono')}${c.vendido ? ' (vendido em ' + dataBR(c.vendidoEm) + ')' : ' (em estoque)'}${c.notaEmitida ? ' · já tem a nota nº ' + esc(c.notaEmitida) : ''}${c.cpfOk ? '' : ' · SEM CPF VÁLIDO no cadastro'}</option>`).join('')}</select>
        <div class="suave pequeno" id="nfse-carro-info" style="margin-top:6px"></div></div>
      <div class="campo c4" id="nfse-cpf-campo" hidden><label for="nfse-cpf">CPF do tomador</label>
        <input id="nfse-cpf" inputmode="numeric" placeholder="000.000.000-00"></div>
      <div class="campo c8" id="nfse-nome-campo" hidden><label for="nfse-nome">Nome completo do tomador</label>
        <input id="nfse-nome"></div>
      <div class="campo c4" id="nfse-ticket-campo" hidden><label for="nfse-ticket">Ticket do seguro</label>
        <input id="nfse-ticket" inputmode="numeric" placeholder="só números"></div>
      <div class="campo c12 suave pequeno">A competência tem que ser do mesmo mês da operação no banco. O Santander confere isso.</div>
      <div class="campo c12"><button type="submit" ${d.habilitado ? '' : 'disabled'}>Ver resumo antes de emitir</button></div>
    </form>
    <div id="nfse-resumo"></div>
  </div>
  <div class="cartao">
    <h2>Notas emitidas por aqui</h2>
    ${d.notas.length ? `<table><thead><tr><th>Quando</th><th>Banco</th><th>Competência</th><th class="num">Valor</th><th>Nº NFS-e</th><th>Situação</th><th></th></tr></thead><tbody>
      ${d.notas.map(n => `<tr>
        <td>${esc(n.criado_em.slice(0, 16))}${n.ambiente === 'teste' ? ' <span class="suave">(teste)</span>' : ''}</td>
        <td>${esc(nomeBanco(n))}${n.ticket ? ' · ticket ' + esc(n.ticket) : ''}</td>
        <td>${esc(n.competencia.split('-').reverse().join('/'))}</td>
        <td class="num">${reais(n.valor)}</td>
        <td>${esc(n.numero_nfse || '—')}</td>
        <td title="${esc(n.mensagem || '')}">${esc(STATUS_NFSE[n.status] || n.status)}</td>
        <td>${n.status === 'emitida' ? `<button type="button" class="secundario" data-xml="${n.id}">Baixar XML</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : '<p class="suave">Nenhuma nota emitida por este sistema ainda. As anteriores continuam no portal da Receita.</p>'}
  </div>`;

  const form = document.getElementById('form-nfse');
  const caixa = document.getElementById('nfse-resumo');
  const selecionado = () => document.getElementById('nfse-banco').selectedOptions[0];
  const ajustarTicket = () => {
    const tipo = selecionado().dataset.tipo;
    document.getElementById('nfse-ticket-campo').hidden = tipo !== 'seguros';
    document.getElementById('nfse-carro-campo').hidden = tipo !== 'consig';
    document.getElementById('nfse-cpf-campo').hidden = tipo !== 'pf';
    document.getElementById('nfse-nome-campo').hidden = tipo !== 'pf';
  };
  document.getElementById('nfse-banco').addEventListener('change', () => { ajustarTicket(); caixa.innerHTML = ''; });
  // Escolheu o carro: mostra o dono, sugere a data da venda e a diferença (venda menos o líquido do dono) só como lembrete
  document.getElementById('nfse-carro').addEventListener('change', e => {
    caixa.innerHTML = '';
    const c = d.carrosConsignados.find(x => String(x.id) === e.target.value);
    const info = document.getElementById('nfse-carro-info');
    if (!c) { info.textContent = ''; return; }
    if (c.vendidoEm) document.getElementById('nfse-competencia').value = c.vendidoEm <= d.hoje ? c.vendidoEm : d.hoje;
    info.innerHTML = `Cliente da nota: <strong>${esc(c.dono)}</strong>.` + (c.vendido && c.valorVenda != null ? ` Vendido por ${reais(c.valorVenda)}, líquido ao dono ${reais(c.valorLiquido)}${c.diferenca != null ? ' (diferença ' + reais(c.diferenca) + ')' : ''}. Digite o valor da nota abaixo.` : ' Esse carro ainda não foi vendido no sistema.');
  });
  ajustarTicket();
  app.querySelectorAll('[data-xml]').forEach(b => b.addEventListener('click', () => baixarXmlNfse(b.dataset.xml).catch(e => aviso(e.message, true))));

  const pedido = () => ({
    tomador: document.getElementById('nfse-banco').value,
    valor: paraCentavos(document.getElementById('nfse-valor').value),
    competencia: document.getElementById('nfse-competencia').value,
    ticket: document.getElementById('nfse-ticket').value.trim() || null,
    ...(document.getElementById('nfse-banco').value === 'cliente-consignacao' ? { veiculo_id: Number(document.getElementById('nfse-carro').value) || null } : {}),
    ...(document.getElementById('nfse-banco').value === 'pessoa-fisica' ? { cpf: document.getElementById('nfse-cpf').value, nome: document.getElementById('nfse-nome').value } : {}),
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    caixa.innerHTML = '';
    try {
      const dados = pedido();
      if (!dados.valor) throw new Error('Informe o valor da comissão.');
      const p = await api('POST', '/nfse/previa', dados);
      caixa.innerHTML = `
      <div class="conferencia" style="margin-top:12px">
        <h3>Confira antes de emitir</h3>
        <table><tbody>
          <tr><td>Cliente (tomador)</td><td>${esc(p.banco)}<br><span class="suave pequeno">${esc(p.documento)}</span></td></tr>
          <tr><td>Serviço</td><td>${esc(p.descricao)}<br><span class="suave pequeno">Código ${esc(p.codigo)} · NBS ${esc(p.nbs)}</span></td></tr>
          <tr><td>Competência</td><td>${esc(p.competencia.split('-').reverse().join('/'))}</td></tr>
          <tr><td>Valor</td><td><strong>${reais(p.valor)}</strong></td></tr>
          <tr><td>ISS (${p.aliquota}%)</td><td>${reais(p.iss)} · não retido</td></tr>
          <tr><td>Número do DPS</td><td>${p.numeroDps}</td></tr>
        </tbody></table>
        ${(p.avisos || []).map(a => `<p class="pequeno" style="color:#b42318"><strong>Atenção:</strong> ${esc(a)}</p>`).join('')}
        <p class="${real ? '' : 'suave'} pequeno"><strong>${real ? 'Esta nota vale de verdade e não pode ser desfeita por aqui.' : 'Ambiente de testes: nada disso vale.'}</strong></p>
        <label class="pequeno" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="nfse-ok" style="width:auto;margin:0"> Conferi o banco, o valor e a competência${real ? ' e quero emitir a nota real' : ''}</label>
        <div class="grade" style="margin-top:8px">
          <div class="campo c4"><label for="nfse-senha">Senha do certificado digital</label>
            <input id="nfse-senha" type="password" autocomplete="off" placeholder="não fica guardada"></div>
          <div class="campo c4" style="align-self:end"><button type="button" id="nfse-emitir">Emitir nota</button></div>
        </div>
      </div>`;
      document.getElementById('nfse-emitir').addEventListener('click', async ev => {
        const botao = ev.currentTarget;
        if (!document.getElementById('nfse-ok').checked) return aviso('Marque que você conferiu os dados.', true);
        const senha = document.getElementById('nfse-senha').value;
        if (!senha) return aviso('Digite a senha do certificado.', true);
        botao.disabled = true;
        botao.textContent = 'Enviando… não feche';
        try {
          const r = await api('POST', '/nfse/emitir', { ...dados, senha, confirmar: true, confirmarProducao: real });
          document.getElementById('nfse-senha').value = '';
          aviso(`Nota nº ${r.numero} emitida.`);
          await telaNotaServico();
        } catch (er) {
          document.getElementById('nfse-senha').value = '';
          aviso(er.message, true);
          await telaNotaServico();
        }
      });
    } catch (er) { aviso(er.message, true); }
  });
}

// ---------- navegação ----------

// ---------- notas emitidas no mês (XML e PDF para o contador) ----------
function mesAnteriorISO() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const NOME_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

async function telaNotasEmitidas(mesPedido) {
  const mes = /^\d{4}-\d{2}$/.test(mesPedido || '') ? mesPedido : mesAnteriorISO();
  const d = await api('GET', `/notas-mes?mes=${mes}`);
  const [ano, m] = mes.split('-');
  const linhas = d.itens.map(i => `<tr>
      <td>${dataBR(i.data)}</td><td>${esc(i.rotulo)}</td><td>${esc(i.numero)}</td>
      <td>${i.veiculo_id ? `<a href="#/carro/${i.veiculo_id}">${esc(i.modelo)}${i.placa ? ' · ' + esc(i.placa) : ''}</a>` : esc(i.tomador || '')}</td>
      <td style="text-align:right">${reais(i.valor || 0)}</td>
      <td>${i.pdf ? `<a class="botao-link" href="${i.pdf}" download>PDF</a> ` : ''}<button type="button" class="secundario" data-xml-url="${esc(i.xml)}">XML</button></td></tr>`).join('');
  const pendentes = d.semXml.length ? `<div class="cartao"><strong>Gerada no Emissor, sem o XML anexado (não entra no pacote)</strong>
    <p class="suave pequeno">Anexe o arquivo que termina em <b>-procNfe.xml</b> na página do carro para ela aparecer aqui.</p>
    <ul class="pequeno">${d.semXml.map(i => `<li>Nº ${esc(i.numero)} · ${esc(i.rotulo)} · <a href="#/carro/${i.veiculo_id}">${esc(i.modelo)} ${esc(i.placa)}</a></li>`).join('')}</ul></div>` : '';
  app.innerHTML = `
  <div class="cabecalho"><div><h1>Notas emitidas</h1><div class="suave">Todas as notas do mês, com XML e PDF. Cada nota continua guardada no carro dela.</div></div></div>
  <div class="cartao">
    <div class="grade">
      <div class="campo c4"><label for="mes-notas">Mês</label><input id="mes-notas" type="month" value="${mes}"></div>
      <div class="campo c8" style="align-self:end;display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" id="mes-anterior" class="secundario">Mês passado</button>
        ${d.itens.length ? `<a class="botao-link" href="/notas-mes/${mes}.zip" download>Baixar tudo de ${NOME_MES[Number(m) - 1]} (ZIP)</a>` : ''}
      </div>
    </div>
    ${d.itens.length ? `<p class="pequeno"><strong>${d.itens.length}</strong> nota(s) em ${NOME_MES[Number(m) - 1]} de ${ano}, total ${reais(d.total)}. O ZIP leva os XML e os PDF (NF-e) e um resumo.csv.</p>
    <table class="pequeno"><thead><tr><th>Data</th><th>Tipo</th><th>Nº</th><th>Carro / cliente</th><th style="text-align:right">Valor</th><th></th></tr></thead><tbody>${linhas}</tbody></table>`
      : `<p class="suave">Nenhuma nota com XML autorizado em ${NOME_MES[Number(m) - 1]} de ${ano}.</p>`}
  </div>
  ${pendentes}`;
  document.getElementById('mes-notas').addEventListener('change', e => { if (e.target.value) ir(`#/notas-fiscais/${e.target.value}`); });
  document.getElementById('mes-anterior').addEventListener('click', () => ir(`#/notas-fiscais/${mesAnteriorISO()}`));
  app.querySelectorAll('[data-xml-url]').forEach(b => b.addEventListener('click', async () => {
    try {
      const r = await api('GET', b.dataset.xmlUrl.replace(/^\/api/, ''));
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([r.conteudo], { type: 'application/xml;charset=utf-8' }));
      link.download = r.arquivo;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    } catch (e) { aviso(e.message, true); }
  }));
}

async function navegar() {
  const partes = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [pagina, id, acao] = partes;
  // Saiu do caminho "Contratos > novo veículo" (entrada e venda): esquece o pedido para não voltar à toa
  if (!['contratos', 'nova-entrada'].includes(pagina) && !(pagina === 'carro' && acao === 'vender')) gravarContratoPendente(null);
  document.querySelectorAll('[data-menu]').forEach(a => a.classList.toggle('ativo', a.dataset.menu === (pagina || 'painel')));
  window.scrollTo(0, 0);
  try {
    if (!pagina) await telaPainel();
    else if (pagina === 'estoque') await telaLista('estoque');
    else if (pagina === 'vendidos') await telaLista('vendido');
    else if (pagina === 'pessoas' || pagina === 'pessoa') { if (id) await telaPessoa(Number(id)); else await telaPessoas(); }
    else if (pagina === 'contratos') await telaContratos();
    else if (pagina === 'nota-servico') await telaNotaServico();
    else if (pagina === 'notas-fiscais') await telaNotasEmitidas(id);
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
