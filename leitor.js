'use strict';
// Lê foto ou PDF de CNH / CRLV com a API do Claude e devolve os campos separados.
const fs = require('node:fs');
const path = require('node:path');
const Anthropic = require('@anthropic-ai/sdk').default;
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');
const { z } = require('zod');
const { erro } = require('./db');

const ARQUIVO_CHAVE = path.join(__dirname, 'CHAVE-API-CLAUDE.txt');

const texto = () => z.string().nullable();
const Documento = z.object({
  tipo_documento: z.enum(['cnh', 'crlv', 'rg', 'outro']),
  pessoa: z.object({
    nome: texto(),
    cpf: texto(),
    rg: texto(),
    nascimento: texto(),
  }),
  veiculo: z.object({
    marca_modelo: texto(),
    placa: texto(),
    renavam: texto(),
    chassi: texto(),
    cor: texto(),
    combustivel: texto(),
    ano_fab: texto(),
    ano_mod: texto(),
  }),
  avisos: z.array(z.string()),
});

const INSTRUCOES = `Você lê documentos brasileiros para o cadastro de uma loja de carros usados.

O arquivo pode ser:
- CNH (carteira de motorista, física ou digital): preencha "pessoa" com nome completo, CPF, número do documento de identidade (RG) com órgão emissor e UF se aparecerem, e data de nascimento. "veiculo" fica todo null.
- CRLV / CRLV-e (documento do carro): preencha "veiculo" com placa, RENAVAM, chassi, marca/modelo/versão como está escrito, cor predominante, combustível, ano de fabricação e ano modelo. Em "pessoa", coloque o NOME e o CPF/CNPJ do proprietário que aparecem no documento (rg e nascimento null).
- RG: preencha "pessoa".
- Qualquer outra coisa: tipo_documento "outro" e campos null.

Regras:
- Copie os números exatamente como estão. Se um dígito não estiver legível, deixe o campo null em vez de adivinhar, e explique em "avisos".
- CPF, RENAVAM e chassi sem pontos, traços ou espaços. Placa em maiúsculas, sem traço.
- Datas no formato AAAA-MM-DD. Anos com 4 dígitos.
- Combustível com uma destas palavras quando possível: Flex, Gasolina, Etanol, Diesel, GNV, Elétrico, Híbrido ("ALCOOL/GASOLINA" é Flex).
- Em "avisos", só escreva quando houver um problema concreto num campo: dígito ilegível, parte cortada ou com reflexo sobre um dado, CNH vencida (validade anterior a hoje). Uma frase curta em português por problema, dizendo qual campo conferir.
- Não escreva avisos genéricos ("confira com o original", "a leitura pode ter erro") nem comente partes do documento que não são cadastradas (título, foto, categoria). Se tudo estiver legível, a lista fica vazia.`;

function lerChave() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY.trim();
  try {
    const linha = fs.readFileSync(ARQUIVO_CHAVE, 'utf8').split(/\r?\n/).map(l => l.trim()).find(l => l.startsWith('sk-ant-'));
    return linha || null;
  } catch {
    return null;
  }
}

function soDigitos(s) {
  return s ? String(s).replace(/\D/g, '') : null;
}

function cpfValido(c) {
  if (!c || c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const t of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(c[i]) * (t + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(c[t])) return false;
  }
  return true;
}

// Dígito verificador do RENAVAM (11 dígitos)
function renavamValido(r) {
  if (!r || r.length !== 11) return false;
  const pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const soma = pesos.reduce((s, p, i) => s + p * Number(r[i]), 0);
  const dv = (soma * 10) % 11;
  return (dv === 10 ? 0 : dv) === Number(r[10]);
}

function paraData(s) {
  if (!s) return null;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function paraAno(s) {
  const n = Number(soDigitos(s));
  return n >= 1950 && n <= 2100 ? n : null;
}

// Arruma o formato e confere os dígitos verificadores, para avisar o que pode estar errado
function normalizar(d) {
  const avisos = [...d.avisos];
  const p = d.pessoa;
  const v = d.veiculo;
  const pessoa = {
    nome: p.nome?.trim() || null,
    cpf: soDigitos(p.cpf),
    rg: p.rg?.trim() || null,
    nascimento: paraData(p.nascimento),
  };
  const veiculo = {
    marca_modelo: v.marca_modelo?.trim() || null,
    placa: v.placa ? v.placa.toUpperCase().replace(/[^A-Z0-9]/g, '') : null,
    renavam: soDigitos(v.renavam),
    chassi: v.chassi ? v.chassi.toUpperCase().replace(/\s/g, '') : null,
    cor: v.cor?.trim() || null,
    combustivel: v.combustivel?.trim() || null,
    ano_fab: paraAno(v.ano_fab),
    ano_mod: paraAno(v.ano_mod),
  };
  // CNPJ (14 dígitos) no CRLV de carro de empresa: não é CPF, não confere
  if (pessoa.cpf && pessoa.cpf.length === 11 && !cpfValido(pessoa.cpf)) avisos.push('O CPF lido não confere. Confira os números.');
  if (veiculo.renavam && !renavamValido(veiculo.renavam.padStart(11, '0'))) avisos.push('O RENAVAM lido não confere. Confira os números.');
  else if (veiculo.renavam) veiculo.renavam = veiculo.renavam.padStart(11, '0');
  if (veiculo.chassi && veiculo.chassi.length !== 17) avisos.push('O chassi deveria ter 17 caracteres. Confira.');
  return { tipo: d.tipo_documento, pessoa, veiculo, avisos };
}

async function lerDocumento({ conteudo, tipoMime }) {
  const apiKey = lerChave();
  if (!apiKey) throw erro('Falta configurar a chave da API do Claude. Veja o arquivo CHAVE-API-CLAUDE.txt na pasta do sistema.');

  const client = new Anthropic({ apiKey });
  const dados = conteudo.toString('base64');
  const arquivo = tipoMime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: dados } }
    : { type: 'image', source: { type: 'base64', media_type: tipoMime, data: dados } };

  let resposta;
  try {
    // Haiku 5.5: o modelo mais barato (cerca de R$ 0,01 por documento). Não tem fallback no servidor.
    resposta = await client.messages.parse({
      model: 'claude-haiku-5-5',
      max_tokens: 8000,
      output_config: { effort: 'low', format: zodOutputFormat(Documento) },
      system: INSTRUCOES,
      messages: [{ role: 'user', content: [arquivo, { type: 'text', text: 'Leia este documento e extraia os dados.' }] }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw erro('A chave da API do Claude não foi aceita. Confira o arquivo CHAVE-API-CLAUDE.txt.');
    if (e instanceof Anthropic.RateLimitError) throw erro('Muitas leituras ao mesmo tempo. Espere alguns segundos e tente de novo.', 429);
    if (e instanceof Anthropic.APIConnectionError) throw erro('Sem conexão com a internet para ler o documento. Preencha à mão ou tente de novo.', 503);
    if (e instanceof Anthropic.APIError) throw erro(`A leitura falhou (${e.status}): ${e.message}`, 502);
    throw e;
  }

  if (resposta.stop_reason === 'refusal') throw erro('Não foi possível ler este documento. Preencha à mão.', 422);
  if (resposta.stop_reason === 'max_tokens' || !resposta.parsed_output) {
    throw erro('Não consegui entender o documento. Tente uma foto mais nítida ou o PDF.', 422);
  }
  return normalizar(resposta.parsed_output);
}

module.exports = { lerDocumento, lerChave, normalizar };
