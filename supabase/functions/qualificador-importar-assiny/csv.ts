// Parser de CSV para o report-transaction da Assiny.
//
// Escrito à mão de propósito: o arquivo tem campos com vírgula dentro de aspas
// (UserAgent, UtmCampaign, nomes de oferta), quebras de linha dentro de aspas,
// BOM no início e CRLF. Um `split(',')` erra em todos esses casos.

/** Lê o CSV inteiro e devolve cabeçalho + linhas, cada linha como array de células. */
export function lerCsv(texto: string): { cabecalho: string[]; linhas: string[][] } {
  // o export da Assiny vem com BOM UTF-8
  const conteudo = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto

  const linhas: string[][] = []
  let celula = ''
  let linha: string[] = []
  let dentroDeAspas = false

  for (let i = 0; i < conteudo.length; i++) {
    const c = conteudo[i]

    if (dentroDeAspas) {
      if (c === '"') {
        if (conteudo[i + 1] === '"') { celula += '"'; i++ } // aspas escapada
        else dentroDeAspas = false
      } else {
        celula += c
      }
      continue
    }

    if (c === '"') { dentroDeAspas = true; continue }
    if (c === ',') { linha.push(celula); celula = ''; continue }

    if (c === '\r' || c === '\n') {
      if (c === '\r' && conteudo[i + 1] === '\n') i++
      linha.push(celula)
      // ignora linha em branco (o arquivo termina com quebra)
      if (linha.length > 1 || linha[0] !== '') linhas.push(linha)
      linha = []
      celula = ''
      continue
    }

    celula += c
  }

  // última linha sem quebra no fim
  if (celula !== '' || linha.length > 0) {
    linha.push(celula)
    if (linha.length > 1 || linha[0] !== '') linhas.push(linha)
  }

  const cabecalho = linhas.shift() ?? []
  return { cabecalho: cabecalho.map((h) => h.trim()), linhas }
}

/** Coluna do CSV da Assiny -> coluna de qualificador.staging_assiny. */
export const MAPA: Array<[string, string]> = [
  ['TransactionId', 'transaction_id'],
  ['NomeDoProduto', 'nome_do_produto'],
  ['TipoDeCheckout', 'tipo_de_checkout'],
  ['NomeDoProjeto', 'nome_do_projeto'],
  ['ProjectId', 'project_id'],
  ['NomeDaOrganizacao', 'nome_da_organizacao'],
  ['OrganizationId', 'organization_id'],
  ['Valor', 'valor'],
  ['Taxa', 'taxa'],
  ['ValorLiquido', 'valor_liquido'],
  ['Parcelas', 'parcelas'],
  ['Moeda', 'moeda'],
  ['CriadoEm', 'criado_em'],
  ['AtualizadoEm', 'atualizado_em'],
  ['Status', 'status'],
  ['TipoDePagamento', 'tipo_de_pagamento'],
  ['OfferId', 'offer_id'],
  ['NomeDaOferta', 'nome_da_oferta'],
  ['NomeDoFunil', 'nome_do_funil'],
  ['ClientId', 'client_id'],
  ['NomeCompletoDoCliente', 'nome_completo_do_cliente'],
  ['TelefoneDoCliente', 'telefone_do_cliente'],
  ['EmailDoCliente', 'email_do_cliente'],
  ['DocumentoDoCliente', 'documento_do_cliente'],
  ['TipoDocumentoDoCliente', 'tipo_documento_do_cliente'],
  ['UtmCampaign', 'utm_campaign'],
  ['UtmContent', 'utm_content'],
  ['UtmMedium', 'utm_medium'],
  ['UtmSource', 'utm_source'],
  ['UtmTerm', 'utm_term'],
  ['ShortFunnelId', 'short_funnel_id'],
  ['NodeId', 'node_id'],
  ['FunnelId', 'funnel_id'],
]

/** Sem estas o arquivo não é um report-transaction da Assiny. */
export const OBRIGATORIAS = [
  'TransactionId', 'NomeDoProjeto', 'ProjectId', 'Valor', 'CriadoEm', 'EmailDoCliente',
]

export interface Recorte {
  colunas: string[]
  valores: (string | null)[][]
  ignoradas: string[]
}

/**
 * Reduz o CSV às colunas que o staging guarda.
 * Colunas extras do export (CoProducer_*_Amount_*, que variam por arquivo) são
 * descartadas — o nome delas muda conforme o coprodutor da oferta.
 */
export function recortar(cabecalho: string[], linhas: string[][]): Recorte {
  const indice = new Map(cabecalho.map((h, i) => [h, i]))
  const faltando = OBRIGATORIAS.filter((c) => !indice.has(c))
  if (faltando.length) {
    throw new Error(
      `Não parece um relatório de transações da Assiny: faltam as colunas ${faltando.join(', ')}.`,
    )
  }

  const presentes = MAPA.filter(([origem]) => indice.has(origem))
  const ignoradas = cabecalho.filter((h) => !MAPA.some(([o]) => o === h))

  const valores = linhas.map((l) =>
    presentes.map(([origem]) => {
      const v = l[indice.get(origem)!]
      return v === undefined || v === '' ? null : v
    })
  )

  return { colunas: presentes.map(([, destino]) => destino), valores, ignoradas }
}
