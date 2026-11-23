'use strict';
// "Notas emitidas": todas as notas com XML autorizado de um mês (NF-e de entrada/devolução/venda e NFS-e de comissão),
// para baixar uma a uma ou tudo junto em um ZIP (para o contador, no primeiro dia útil do mês).
const db = require('./db');

const ROTULO = {
  entrada_compra: 'Entrada de compra', entrada_consignacao: 'Entrada de consignação', devolucao_consignacao: 'Devolução de consignação',
  devolucao_compra: 'Devolução de compra', venda: 'Venda',
};

function mesValido(mes) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes || ''))) throw db.erro('Escolha o mês no formato AAAA-MM.', 400);
  return mes;
}
function mesAnterior(hoje = new Date()) {
  const d = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function limpoNome(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, ''); }

// Lista as notas do mês (pela data de emissão que consta no XML)
function listar(mes) {
  require('./nfe-eventos'); // cria a tabela de eventos e a coluna cancelada_em se ainda não existirem
  mesValido(mes);
  const { lerNota } = require('./danfe');
  const carros = new Map(db.conexao.prepare('SELECT id, placa, marca_modelo FROM veiculos').all().map(v => [v.id, v]));
  const porChave = new Map();

  // 1) Notas registradas (Emissor ou site); o XML autorizado pode estar anexado
  for (const n of db.conexao.prepare('SELECT id, veiculo_id, tipo, numero, chave, valor, criado_em, xml_autorizado, cancelada_em FROM nfe_notas ORDER BY id').all()) {
    porChave.set(n.chave, { nota: n, xml: n.xml_autorizado || null, envio: null });
  }
  // 2) Envios autorizados direto pelo site em produção (a nota registrada pode ainda não ter o XML copiado)
  for (const e of db.conexao.prepare("SELECT id, veiculo_id, tipo, numero, chave, xml FROM nfe_envios WHERE ambiente = 'producao' AND situacao = 'autorizada' ORDER BY id").all()) {
    const atual = porChave.get(e.chave) || { nota: null, xml: null, envio: null };
    atual.envio = e;
    if (!atual.xml) atual.xml = e.xml;
    if (!atual.nota) atual.nota = { id: null, veiculo_id: e.veiculo_id, tipo: e.tipo, numero: e.numero, chave: e.chave, valor: null, criado_em: null };
    porChave.set(e.chave, atual);
  }

  const itens = [];
  const semXml = [];
  for (const [chave, { nota, xml, envio }] of porChave) {
    const carro = carros.get(nota.veiculo_id) || {};
    const base = { tipo: 'nfe', numero: nota.numero, rotulo: ROTULO[nota.tipo] || nota.tipo, chave, veiculo_id: nota.veiculo_id, placa: carro.placa || '', modelo: carro.marca_modelo || '' };
    if (!xml) { // gerada pelo Emissor, sem o XML autorizado anexado: não dá para saber se foi transmitida
      if ((nota.criado_em || '').slice(0, 7) === mes) semXml.push({ ...base, data: (nota.criado_em || '').slice(0, 10), valor: nota.valor });
      continue;
    }
    let n;
    try { n = lerNota(xml); } catch { continue; }
    if (n.homologacao || String(n.dhEmi || '').slice(0, 7) !== mes) continue;
    const vNF = Math.round(Number(n.tot?.vNF || 0) * 100);
    const viaEnvio = !nota.id || !nota.xml_autorizado;
    itens.push({
      ...base, data: String(n.dhEmi).slice(0, 10), valor: vNF || nota.valor, protocolo: n.protocolo, cancelada: !!nota.cancelada_em, notaId: nota.id || null,
      pdf: viaEnvio && envio ? `/danfe/${envio.id}.pdf` : `/danfe-nota/${nota.id}.pdf`,
      xml: viaEnvio && envio ? `/api/nfe-envios/${envio.id}/xml` : `/api/nfe-notas/${nota.id}/xml`,
    });
  }
  // 3) NFS-e de comissão emitidas
  for (const s of db.conexao.prepare("SELECT id, ambiente, numero_nfse, tomador, tomador_nome, veiculo_id, valor, criado_em, xml_nfse FROM nfse_notas WHERE status = 'emitida' AND ambiente = 'producao' ORDER BY id").all()) {
    if (String(s.criado_em).slice(0, 7) !== mes || !s.xml_nfse) continue;
    const carro = carros.get(s.veiculo_id) || {};
    itens.push({ tipo: 'nfse', numero: s.numero_nfse, rotulo: 'NFS-e comissão', chave: null, veiculo_id: s.veiculo_id, placa: carro.placa || '', modelo: carro.marca_modelo || '', data: String(s.criado_em).slice(0, 10), valor: s.valor, tomador: s.tomador_nome || s.tomador, pdf: null, xml: `/api/nfse/${s.id}/xml`, nfseId: s.id });
  }
  itens.sort((a, b) => (a.data + String(a.numero).padStart(12, '0')).localeCompare(b.data + String(b.numero).padStart(12, '0')));
  semXml.sort((a, b) => a.numero - b.numero);
  return { mes, itens, semXml, total: itens.reduce((t, i) => t + (i.valor || 0), 0) };
}

// ---------- ZIP simples (sem compressão), para não depender de biblioteca ----------
const TABELA_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

function montarZip(arquivos, agora = new Date()) {
  const dosHora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | Math.floor(agora.getSeconds() / 2);
  const dosData = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
  const locais = [], central = [];
  let pos = 0;
  for (const { nome, dados } of arquivos) {
    const nomeB = Buffer.from(nome, 'utf8'), crc = crc32(dados);
    const cab = Buffer.alloc(30);
    cab.writeUInt32LE(0x04034b50, 0); cab.writeUInt16LE(20, 4); cab.writeUInt16LE(0x0800, 6); cab.writeUInt16LE(0, 8);
    cab.writeUInt16LE(dosHora, 10); cab.writeUInt16LE(dosData, 12); cab.writeUInt32LE(crc, 14);
    cab.writeUInt32LE(dados.length, 18); cab.writeUInt32LE(dados.length, 22); cab.writeUInt16LE(nomeB.length, 26); cab.writeUInt16LE(0, 28);
    locais.push(cab, nomeB, dados);
    const reg = Buffer.alloc(46);
    reg.writeUInt32LE(0x02014b50, 0); reg.writeUInt16LE(20, 4); reg.writeUInt16LE(20, 6); reg.writeUInt16LE(0x0800, 8); reg.writeUInt16LE(0, 10);
    reg.writeUInt16LE(dosHora, 12); reg.writeUInt16LE(dosData, 14); reg.writeUInt32LE(crc, 16);
    reg.writeUInt32LE(dados.length, 20); reg.writeUInt32LE(dados.length, 24); reg.writeUInt16LE(nomeB.length, 28);
    reg.writeUInt32LE(pos, 42);
    central.push(reg, nomeB);
    pos += 30 + nomeB.length + dados.length;
  }
  const tamCentral = central.reduce((t, b) => t + b.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(tamCentral, 12); fim.writeUInt32LE(pos, 16);
  return Buffer.concat([...locais, ...central, fim]);
}

// ZIP do mês: uma pasta NF-e (XML + PDF de cada nota) e uma NFS-e (XML), mais um resumo
function zipDoMes(mes) {
  const lista = listar(mes);
  if (!lista.itens.length) throw db.erro('Não há notas emitidas neste mês.', 404);
  const nfeDireta = require('./nfe-direta');
  const nfseServico = require('./nfse-servico');
  const { gerarDanfePdf } = require('./danfe-pdf');
  const arquivos = [];
  const resumo = ['Tipo;Número;Data;Descrição;Placa;Valor;Situação;Arquivo'];
  for (const i of lista.itens) {
    const nomeBase = limpoNome(`${i.tipo === 'nfe' ? 'NFe' : 'NFSe'}-${i.numero}-${i.rotulo}-${i.placa || i.tomador || ''}`);
    if (i.tipo === 'nfe') {
      const origem = i.xml.includes('/nfe-envios/') ? nfeDireta.xmlDoEnvio(Number(i.xml.split('/')[3])) : nfeDireta.xmlDaNotaRegistrada(Number(i.xml.split('/')[3]));
      arquivos.push({ nome: `NF-e/${nomeBase}.xml`, dados: Buffer.from(origem.conteudo, 'utf8') });
      try { arquivos.push({ nome: `NF-e/${nomeBase}.pdf`, dados: gerarDanfePdf(origem.conteudo, { cancelada: i.cancelada }).pdf }); } catch { /* sem PDF: o XML segue no pacote */ }
      // cancelamento e cartas de correção da nota (o contador precisa dos XML dos eventos)
      if (i.notaId) {
        for (const ev of db.conexao.prepare("SELECT tipo, seq, xml FROM nfe_eventos WHERE nota_id = ? AND situacao = 'registrado' ORDER BY id").all(i.notaId)) {
          arquivos.push({ nome: `NF-e/${nomeBase}-${ev.tipo === 'cancelamento' ? 'cancelamento' : 'carta-correcao-' + ev.seq}.xml`, dados: Buffer.from(ev.xml, 'utf8') });
        }
      }
    } else {
      arquivos.push({ nome: `NFS-e/${nomeBase}.xml`, dados: Buffer.from(nfseServico.xmlDaNota(i.nfseId).conteudo, 'utf8') });
    }
    resumo.push([i.rotulo, i.numero, i.data, i.modelo, i.placa, ((i.valor || 0) / 100).toFixed(2).replace('.', ','), i.cancelada ? 'CANCELADA' : 'autorizada', nomeBase].join(';'));
  }
  arquivos.push({ nome: 'resumo.csv', dados: Buffer.from('﻿' + resumo.join('\r\n') + '\r\n', 'utf8') });
  return { arquivo: `Notas-Correa-${mes}.zip`, zip: montarZip(arquivos), quantidade: lista.itens.length };
}

// Todas as notas, de cada mês, numa pasta por mês (AAAA-MM/NF-e/...): usado pela cópia automática para o PC da loja
function zipTodas(desde = '2026-01', ate = mesAtual()) {
  const arquivos = [];
  let total = 0;
  for (let mes = desde; mes <= ate; mes = proximoMes(mes)) {
    if (!listar(mes).itens.length) continue;
    const z = zipDoMes(mes);
    total += z.quantidade;
    for (const f of lerZip(z.zip)) arquivos.push({ nome: `${mes}/${f.nome}`, dados: f.dados });
  }
  return { zip: montarZip(arquivos), quantidade: total };
}
function mesAtual(hoje = new Date()) { return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`; }
function proximoMes(mes) { const [a, m] = mes.split('-').map(Number); return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`; }
// Lê de volta um ZIP feito por montarZip (sem compressão)
function lerZip(buf) {
  const fim = buf.length - 22, n = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const lista = [];
  for (let i = 0; i < n; i++) {
    const tam = buf.readUInt32LE(p + 20), nomeLen = buf.readUInt16LE(p + 28), local = buf.readUInt32LE(p + 42);
    lista.push({ nome: buf.slice(p + 46, p + 46 + nomeLen).toString('utf8'), dados: buf.slice(local + 30 + nomeLen, local + 30 + nomeLen + tam) });
    p += 46 + nomeLen;
  }
  return lista;
}

module.exports = { listar, zipDoMes, zipTodas, lerZip, mesAnterior, montarZip, crc32, mesValido };

// No servidor: node notas-mes.js exportar > notas.zip   (a tarefa do PC da loja usa isso para copiar os PDF e XML para o OneDrive)
if (require.main === module && process.argv[2] === 'exportar') process.stdout.write(zipTodas().zip);
