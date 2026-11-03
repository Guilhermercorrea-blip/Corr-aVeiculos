'use strict';
const { randomInt } = require('node:crypto');
const ABORDAGENS = [
  'Abra apresentando o modelo e convidando o leitor a conhecer esta unidade, com uma frase original.',
  'Abra com uma pergunta curta que convide o leitor a conhecer o modelo, sem supor como ele usa o carro.',
  'Abra destacando um acessório informado pela equipe. Se nenhum foi informado, apresente o modelo de forma direta.',
  'Abra com um destaque confirmado pela equipe. Se não houver, convide para conferir os dados do veículo.',
  'Abra com uma apresentação curta e objetiva do veículo, sem slogan ou adjetivos genéricos.',
  'Abra com um convite para conhecer o veículo na loja, mencionando o modelo naturalmente.',
  'Abra combinando o nome do modelo e um dado concreto informado, em uma frase fluida.',
  'Abra com uma chamada breve de conversa, sem clichês, e apresente o veículo logo em seguida.',
  'Abra usando o ano e o modelo, se o ano foi informado. Varie a construção da frase.',
  'Abra com uma frase curta que desperte curiosidade pelos detalhes informados, sem promessas ou superlativos.',
];
const ESTRUTURAS = [
  'Após a abertura, apresente o veículo em um parágrafo curto e organize os dados confirmados em uma lista.',
  'Após a abertura, dê prioridade aos dados principais e depois aos acessórios e destaques confirmados.',
  'Após a abertura, escreva uma apresentação de uma ou duas frases; agrupe os detalhes confirmados em tópicos curtos.',
];
const abertura = texto => String(texto).trim().split(/\n|(?<=[.!?])\s/)[0].slice(0,220).trim();
const assinatura = texto => abertura(texto).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').trim().split(/\s+/).slice(0,8).join(' ');
function criarVariacoes({ sortear = randomInt } = {}) {
  const recentes = [], usadas = []; let estruturaAnterior = -1;
  function preparar() {
    const disponiveis = ABORDAGENS.map((_,i) => i).filter(i => !usadas.includes(i));
    const indice = disponiveis[sortear(disponiveis.length)]; usadas.push(indice); if (usadas.length > 3) usadas.shift();
    const estruturas = ESTRUTURAS.map((_,i) => i).filter(i => i !== estruturaAnterior);
    estruturaAnterior = estruturas[sortear(estruturas.length)];
    return `Direção editorial desta geração (não copie estas instruções na resposta):\n${ABORDAGENS[indice]}\n${ESTRUTURAS[estruturaAnterior]}\nUse apenas os fatos disponíveis, mesmo quando o estilo sugerido mencionar um dado ausente. Escreva uma abertura nova; não use uma frase pronta recorrente.${recentes.length ? '\nAberturas recentes a evitar, inclusive pequenas variações:\n' + recentes.map(s => '- ' + s).join('\n') : ''}`;
  }
  function repetida(texto) {
    const chave = assinatura(texto);
    return !chave || chave.startsWith('conforto desempenho e procedencia em um so carro') || recentes.some(s => assinatura(s) === chave);
  }
  function registrar(texto) { recentes.push(abertura(texto)); if (recentes.length > 8) recentes.shift(); }
  return { preparar, repetida, registrar };
}
module.exports = { criarVariacoes };
