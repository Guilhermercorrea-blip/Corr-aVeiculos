'use strict';
// Impostos da venda de carro comprado pela loja (valores em centavos).
// Mesmo padrão das notas que a loja já emite pelo Sebrae (lucro presumido, revenda de usado
// equiparada a consignação - Lei 9.716/98, art. 5º): a receita tributável é a diferença venda - compra.
//   ICMS:   18% sobre 10% do valor de venda (redução de base de 90%)       -> na nota, apuração mensal
//   PIS:    0,65% sobre (venda - compra)                                   -> na nota, vence dia 25 do mês seguinte
//   COFINS: 3% sobre (venda - compra)                                      -> na nota, vence dia 25 do mês seguinte
//   IRPJ:   15% sobre 32% de (venda - compra)                              -> trimestral
//   CSLL:   9% sobre 32% de (venda - compra)                               -> trimestral
// O adicional de 10% do IRPJ (lucro presumido acima de R$ 60 mil no trimestre) não entra. Estimativa: confirmar com o contador.
const TAXAS = { icmsBase: 0.10, icms: 0.18, pis: 0.0065, cofins: 0.03, presuncao: 0.32, irpj: 0.15, csll: 0.09 };

const iso = d => d.toISOString().slice(0, 10);
// Feriados nacionais de data fixa (Carnaval, Paixão e Corpus Christi, que mudam de data, não entram)
const FERIADOS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];
const naoUtil = d => [0, 6].includes(d.getUTCDay()) || FERIADOS.includes(iso(d).slice(5));
function antecipar(d) {
  while (naoUtil(d)) d.setUTCDate(d.getUTCDate() - 1);
  return iso(d);
}

// Último dia útil do mês (vencimento do IRPJ e CSLL trimestrais)
const ultimoDiaUtil = (ano, mes) => antecipar(new Date(Date.UTC(ano, mes + 1, 0)));

// Dia 25 do mês seguinte; se não for dia útil, antecipa (PIS e COFINS)
const dia25MesSeguinte = (ano, mes) => antecipar(new Date(Date.UTC(ano, mes + 1, 25)));

function calcularImpostosVenda(valorVenda, valorCompra, dataVenda) {
  const baseIcms = Math.round(valorVenda * TAXAS.icmsBase);
  const margem = Math.max(0, valorVenda - (valorCompra || 0));
  const presumido = Math.round(margem * TAXAS.presuncao);
  const icms = Math.round(baseIcms * TAXAS.icms);
  const pis = Math.round(margem * TAXAS.pis);
  const cofins = Math.round(margem * TAXAS.cofins);
  const irpj = Math.round(presumido * TAXAS.irpj);
  const csll = Math.round(presumido * TAXAS.csll);

  const [ano, mes] = String(dataVenda || '').slice(0, 7).split('-').map(Number);
  const temData = ano > 2000 && mes >= 1;
  const m = mes - 1;
  const trimestre = temData ? Math.floor(m / 3) + 1 : null;
  const venc = {
    mensal: temData ? `${String(m + 2 > 12 ? 1 : m + 2).padStart(2, '0')}/${m + 2 > 12 ? ano + 1 : ano}` : null,
    pisCofins: temData ? dia25MesSeguinte(ano, m) : null,
    trimestral: temData ? ultimoDiaUtil(ano, trimestre * 3) : null,
  };
  const itens = [
    { chave: 'icms', nome: 'ICMS', valor: icms, base: baseIcms, regra: '18% sobre 10% do valor da venda', quando: 'na nota', vence: venc.mensal ? `apuração mensal, paga em ${venc.mensal}` : 'apuração mensal' },
    { chave: 'pis', nome: 'PIS', valor: pis, base: margem, regra: '0,65% sobre venda − compra', quando: 'na nota', vence: venc.pisCofins },
    { chave: 'cofins', nome: 'COFINS', valor: cofins, base: margem, regra: '3% sobre venda − compra', quando: 'na nota', vence: venc.pisCofins },
    { chave: 'irpj', nome: 'IRPJ', valor: irpj, base: presumido, regra: '15% sobre 32% de venda − compra', quando: trimestre ? `${trimestre}º trimestre/${ano}` : 'trimestral', vence: venc.trimestral },
    { chave: 'csll', nome: 'CSLL', valor: csll, base: presumido, regra: '9% sobre 32% de venda − compra', quando: trimestre ? `${trimestre}º trimestre/${ano}` : 'trimestral', vence: venc.trimestral },
  ];
  return { margem, itens, total: itens.reduce((s, i) => s + i.valor, 0), naNota: icms + pis + cofins, futuros: irpj + csll };
}

module.exports = { calcularImpostosVenda, TAXAS, ultimoDiaUtil, dia25MesSeguinte };
