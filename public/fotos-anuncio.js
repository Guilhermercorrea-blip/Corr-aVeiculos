'use strict';
const elemento = id => document.getElementById(id);
const codigoEnvio = new URLSearchParams(location.search).get('c') || '';
let enviandoFotos = false, envioAtivo = false;
async function pedidoEnvio(dados) {
  const resposta = await fetch(`/api/anuncios-celular/${encodeURIComponent(codigoEnvio)}${dados ? '/fotos' : ''}`, { method: dados ? 'POST' : 'GET', headers: dados ? {'Content-Type':'application/json'} : {}, body: dados ? JSON.stringify(dados) : undefined, referrerPolicy: 'no-referrer', cache: 'no-store' });
  const r = await resposta.json().catch(() => { throw new Error('A conexão foi interrompida. Tente enviar novamente.'); });
  if (!resposta.ok) { const erro = new Error(r.erro || 'Não foi possível enviar. Tente novamente.'); erro.status = resposta.status; throw erro; }
  return r;
}
function bloquearFotos(ativo) { for (const id of ['camera-fotos', 'galeria-fotos']) elemento(id).disabled = ativo || !envioAtivo; }
function atualizarEnvio(r) {
  elemento('titulo-anuncio').textContent = r.titulo;
  elemento('contagem-envio').textContent = `${r.recebidas} de ${r.limite} fotos recebidas neste envio`;
  elemento('validade-envio').textContent = 'Link válido até ' + new Date(r.expira_em).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}) + '. Ao concluir no computador, este link é encerrado.';
  if (r.recebidas >= r.limite) { envioAtivo = false; elemento('mensagem-fotos').textContent = 'Todas as 40 fotos foram recebidas. Conclua no computador.'; elemento('mensagem-fotos').hidden = false; }
}
async function prepararImagem(arquivo) {
  if (!arquivo.type.startsWith('image/')) throw new Error('Escolha uma foto JPG, PNG ou WebP. PDF não é aceito neste envio.');
  if (arquivo.size > 20 * 1024 * 1024) throw new Error('Escolha uma foto de até 20 MB.');
  let imagem;
  try { imagem = await createImageBitmap(arquivo); } catch { throw new Error('Não foi possível abrir a foto. Tente salvar em JPG ou PNG.'); }
  try {
    const escala = Math.min(1, 2000 / Math.max(imagem.width, imagem.height));
    const tela = document.createElement('canvas'); tela.width = Math.max(1, Math.round(imagem.width * escala)); tela.height = Math.max(1, Math.round(imagem.height * escala));
    const contexto = tela.getContext('2d'); contexto.fillStyle = '#fff'; contexto.fillRect(0,0,tela.width,tela.height); contexto.drawImage(imagem,0,0,tela.width,tela.height);
    const blob = await new Promise(resolve => tela.toBlob(resolve,'image/jpeg',.88)); if (!blob) throw new Error('Não foi possível preparar a foto.');
    const base64 = await new Promise((resolve,reject) => { const leitor = new FileReader(); leitor.onload = () => resolve(String(leitor.result).split(',')[1]); leitor.onerror = () => reject(new Error('Não foi possível ler a foto.')); leitor.readAsDataURL(blob); });
    return {tipo_mime:'image/jpeg', base64};
  } finally { imagem.close(); }
}
async function enviarUmaFoto(arquivo, chave, item) {
  item.className = ''; item.textContent = 'Enviando foto…';
  try {
    const r = await pedidoEnvio({nome:arquivo.name || 'foto.jpg', chave, ...await prepararImagem(arquivo)});
    atualizarEnvio(r); item.className = 'ok'; item.textContent = '✓ Foto recebida no computador. Confira e salve o anúncio por lá.';
  } catch(e) {
    item.className = 'erro'; item.textContent = e.message;
    if (e.status === 404) {
      envioAtivo = false; elemento('mensagem-fotos').hidden = false; elemento('mensagem-fotos').className = 'erro'; elemento('mensagem-fotos').textContent = e.message;
    } else {
      const tentar = document.createElement('button'); tentar.type = 'button'; tentar.textContent = 'Tentar novamente';
      tentar.onclick = async () => { if (enviandoFotos || !envioAtivo) return; enviandoFotos = true; bloquearFotos(true); try { await enviarUmaFoto(arquivo,chave,item); } finally { enviandoFotos = false; bloquearFotos(false); } };
      item.append(document.createElement('br'),tentar);
    }
  }
}
async function enviarFotos(entrada) {
  if (enviandoFotos || !envioAtivo) return;
  const arquivos = [...entrada.files]; entrada.value = ''; enviandoFotos = true; bloquearFotos(true);
  try {
    for (const arquivo of arquivos) {
      if (!envioAtivo) break;
      const item = document.createElement('li'); elemento('lista-envios').prepend(item);
      await enviarUmaFoto(arquivo,chaveFoto(),item);
    }
  } finally { enviandoFotos = false; bloquearFotos(false); }
}
function chaveFoto() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const h = [...bytes].map(n => n.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
async function iniciarEnvio() {
  try {
    if (!/^[\w-]{43}$/.test(codigoEnvio)) throw new Error('Abra o QR Code gerado no computador para enviar as fotos.');
    const r = await pedidoEnvio(); envioAtivo = true; atualizarEnvio(r);
    elemento('envio-pronto').hidden = false;
    if (envioAtivo) elemento('mensagem-fotos').hidden = true;
    bloquearFotos(false);
    for (const id of ['camera-fotos','galeria-fotos']) elemento(id).onchange = e => enviarFotos(e.target);
  } catch(e) { elemento('mensagem-fotos').textContent = e.message; elemento('mensagem-fotos').className = 'erro'; }
}
window.addEventListener('beforeunload', e => { if (enviandoFotos) { e.preventDefault(); e.returnValue = ''; } });
iniciarEnvio();
