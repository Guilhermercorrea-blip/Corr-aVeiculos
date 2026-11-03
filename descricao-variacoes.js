'use strict';
// Sorteia uma "direção" diferente para cada descrição gerada pela IA (tom, abertura, formato e emojis),
// sem repetir as últimas usadas, e evita aberturas parecidas com as recentes.
const { randomInt } = require('node:crypto');
const TONS = [
  'Tom de vendedor animado e simpático, com entusiasmo genuíno, como quem mostra o carro no pátio.',
  'Tom de conversa entre amigos: leve, bem-humorado e próximo, com uma brincadeira sutil.',
  'Tom direto e confiante, para quem já sabe o que quer: frases curtas, nada de enrolação.',
  'Tom que conta uma pequena cena do dia a dia que o carro resolve (trabalho, família, viagem, cidade), sem inventar fatos do carro.',
  'Tom de oportunidade: senso de urgência leve e elegante, sem exagero nem promessa de preço.',
  'Tom caprichado e acolhedor, valorizando o cuidado da loja ao escolher cada veículo, sem afirmar fatos não informados.',
  'Tom regional e caloroso, falando com quem é de Barra Bonita e região.',
];
const ABERTURAS = [
  'Abra com uma pergunta curta e instigante.',
  'Abra com uma frase de impacto de até 8 palavras.',
  'Abra destacando o item mais interessante entre os informados.',
  'Abra com o nome do modelo e o ano de um jeito criativo.',
  'Abra com uma exclamação que chame a atenção no feed.',
  'Abra pintando uma cena rápida (ex.: estrada, trânsito, fim de semana) e traga o carro logo em seguida.',
  'Abra com um "Procurando..." ou "Se você quer..." falando direto com quem busca esse tipo de veículo.',
  'Abra com um destaque confirmado pela equipe; se não houver, use o tipo de veículo.',
];
const FORMATOS = [
  'Formato: um parágrafo curto e depois os itens em lista com um emoji por linha.',
  'Formato: dois parágrafos corridos, sem lista, com os itens citados dentro do texto.',
  'Formato: frases curtas em linhas separadas, ritmo rápido, estilo post de rede social.',
  'Formato: um bloco "Destaques" em lista e um fechamento de uma linha.',
];
const EMOJIS = ['Use poucos emojis (2 a 3).', 'Use emojis com vontade, um por linha de item.', 'Use emojis moderadamente (4 a 6).'];

const abertura = texto => String(texto).trim().split(/\n|(?<=[.!?])\s/)[0].slice(0,220).trim();
const assinatura = texto => abertura(texto).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').trim().split(/\s+/).slice(0,8).join(' ');

function criarVariacoes({ sortear = randomInt } = {}) {
  const recentes = [];
  // Para cada lista, guarda os últimos índices usados para não repetir em sequência
  const memoria = new Map();
  function escolher(nome, lista, guardar) {
    const usados = memoria.get(nome) || [];
    const livres = lista.map((_, i) => i).filter(i => !usados.includes(i));
    const i = livres[sortear(livres.length)];
    memoria.set(nome, [...usados, i].slice(-guardar));
    return lista[i];
  }
  function preparar() {
    const direcao = [escolher('tom', TONS, 3), escolher('abertura', ABERTURAS, 3), escolher('formato', FORMATOS, 1), escolher('emoji', EMOJIS, 1)];
    return `Direção editorial desta geração (siga, mas não copie estas instruções na resposta):\n${direcao.join('\n')}\nUse apenas os fatos disponíveis, mesmo quando a direção mencionar um dado ausente. Crie uma primeira linha nova; nada de frase pronta.${recentes.length ? '\nAberturas recentes a evitar, inclusive pequenas variações:\n' + recentes.map(s => '- ' + s).join('\n') : ''}`;
  }
  function repetida(texto) {
    const chave = assinatura(texto);
    return !chave || chave.startsWith('conforto desempenho e procedencia em um so carro') || recentes.some(s => assinatura(s) === chave);
  }
  function registrar(texto) { recentes.push(abertura(texto)); if (recentes.length > 12) recentes.shift(); }
  return { preparar, repetida, registrar };
}
module.exports = { criarVariacoes };
