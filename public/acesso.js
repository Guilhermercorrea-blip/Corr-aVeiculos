'use strict';
fetch('/api/eu').then(async r => {
  if (r.status === 401) { location.replace('/login.html'); return; }
  if (!r.ok) throw new Error('Não foi possível consultar seu acesso. Atualize a página.');
  const p = await r.json();
  document.getElementById('saudacao').textContent = `Olá, ${p.nome}. Escolha uma área para continuar.`;
}).catch(e => { document.getElementById('saudacao').textContent = e.message; });
document.getElementById('sair').addEventListener('click', async e => {
  e.target.disabled = true;
  try {
    const r = await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!r.ok) throw new Error('Não foi possível sair. Tente novamente.');
    location.href = '/';
  } catch (erro) { alert(erro.message); e.target.disabled = false; }
});
