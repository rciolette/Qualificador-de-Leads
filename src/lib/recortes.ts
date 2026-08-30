import type { Condicao, Etapa, Recorte } from './iniciativas'

/**
 * Traduz um recorte pronto para etapas editáveis.
 *
 * Os recortes guardam os filtros num vocabulário próprio, anterior ao motor de
 * etapas: `{"membros":{"memberclass":{"aulas_concluidas":{"min":3}}}}`. Até
 * agora clicar num recorte só mostrava um toast com o critério escrito em
 * português e aplicava o perfil de pesos — o filtro em si a pessoa montava à
 * mão, lendo o texto. Era um segundo mecanismo de filtro que não filtrava nada.
 *
 * NEM TUDO É TRADUZÍVEL, e isso não pode ser escondido. Quatro coisas dos
 * recortes não têm campo no catálogo — situação e pipeline do negócio no
 * HubSpot, janela de disparo sem resposta, cruzamento card × ativos, e o `ou`
 * entre grupos (o motor tem um nível de combinador, decisão fechada com o
 * Raphael). Um recorte traduzido pela metade e aplicado em silêncio seria pior
 * que o toast: a etapa pareceria completa e filtraria outra coisa.
 *
 * Então a tradução devolve as duas listas — o que virou etapa e o que ficou de
 * fora — e a tela mostra as duas.
 */

interface Traduzido {
  etapas: Etapa[]
  /** o que o catálogo ainda não sabe expressar, em português */
  naoCoube: string[]
}

let seq = 0
const novoId = () => `recorte_${Date.now()}_${seq++}`

/** Uma etapa de uma condição só, que é o formato em que os recortes cabem. */
function etapa(rotulo: string, origem: string, cond: Condicao, colunas: string[]): Etapa {
  return {
    id: novoId(),
    rotulo,
    ativa: true,
    origem,
    combinador: 'todas',
    // recorte pronto é filtro: quem não tem o dado sai. Quem quiser refinar
    // troca o modo no cartão — o ponto é que a escolha fica visível.
    sem_dado: 'excluir',
    condicoes: [cond],
    colunas,
  }
}

type Faixa = { min?: number; max?: number }

export function recorteParaEtapas(r: Recorte): Traduzido {
  const f = (r.filtros ?? {}) as Record<string, any>
  const etapas: Etapa[] = []
  const naoCoube: string[] = []

  const assiny = f.assiny ?? {}
  const membros = f.membros ?? {}
  const hubspot = f.hubspot ?? {}
  const saude = f.saude_disparo ?? {}
  const evento = f.evento ?? {}

  // ---------------------------------------------------------------- Assiny
  const dPrimeira = assiny.dias_desde_primeira_compra as Faixa | undefined
  if (dPrimeira) {
    etapas.push(etapa('Primeira compra na janela', 'assiny', {
      fonte: 'assiny', campo: 'assiny.dias_primeira', operador: 'entre',
      valor: { min: dPrimeira.min, max: dPrimeira.max },
    }, ['assiny.dias_primeira']))
  }
  const dUltima = assiny.dias_desde_ultima_compra as Faixa | undefined
  if (dUltima?.max !== undefined) {
    etapas.push(etapa('Comprou recentemente', 'assiny', {
      fonte: 'assiny', campo: 'assiny.dias_ultima', operador: 'menor_igual',
      valor: dUltima.max,
    }, ['assiny.dias_ultima']))
  }
  // `tem_compra` não vira etapa de propósito: a base É a Assiny, então a
  // condição vale para todo mundo e só ocuparia um cartão sem cortar ninguém

  // ------------------------------------------------------------ MemberClass
  const mc = membros.memberclass ?? {}
  if (mc.aulas_concluidas?.min !== undefined) {
    etapas.push(etapa(`MemberClass · ${mc.aulas_concluidas.min}+ aulas`, 'memberclass', {
      fonte: 'memberclass', campo: 'mc.aulas', operador: 'maior_igual',
      valor: mc.aulas_concluidas.min,
    }, ['mc.aulas']))
  }
  const acesso = mc.ultimo_acesso_dias as Faixa | undefined
  if (acesso?.max !== undefined) {
    etapas.push(etapa(`Acessou nos últimos ${acesso.max} dias`, 'memberclass', {
      fonte: 'memberclass', campo: 'mc.dias_acesso', operador: 'menor_igual',
      valor: acesso.max,
    }, ['mc.dias_acesso']))
  }
  if (acesso?.min !== undefined) {
    etapas.push(etapa(`Sem acessar há ${acesso.min}+ dias`, 'memberclass', {
      fonte: 'memberclass', campo: 'mc.dias_acesso', operador: 'maior_igual',
      valor: acesso.min,
    }, ['mc.dias_acesso']))
  }

  // -------------------------------------------------------------- MemberKit
  if (membros.memberkit?.tem_produto_pago) {
    etapas.push(etapa('Tem produto pago no MemberKit', 'memberkit', {
      fonte: 'memberkit', campo: 'mk.produto_pago', operador: 'e_verdadeiro',
    }, ['mk.produto_pago']))
  }

  // ---------------------------------------------------------------- HubSpot
  const excluir = hubspot.produtos_ativos_excluir as string[] | undefined
  if (excluir?.length) {
    etapas.push(etapa('Sem esses produtos ativos', 'hubspot', {
      fonte: 'hubspot', campo: 'hs.ativos', operador: 'nao_contem_nenhum',
      valor: excluir,
    }, ['hs.ativos']))
  }
  const econt = hubspot.econt ?? {}
  if (econt.servico_ativo === true) {
    etapas.push(etapa('Tem E-cont ativo', 'hubspot', {
      fonte: 'hubspot', campo: 'hs.econt_ativo', operador: 'e_verdadeiro',
    }, ['hs.econt_ativo']))
  }
  if (econt.abertura_cnpj === false) {
    etapas.push(etapa('Ainda não abriu CNPJ', 'hubspot', {
      fonte: 'hubspot', campo: 'hs.econt_cnpj', operador: 'e_falso',
    }, ['hs.econt_cnpj']))
  }
  if (econt.fim_plano?.proximos_dias !== undefined) {
    etapas.push(etapa(`Plano vence em ${econt.fim_plano.proximos_dias} dias`, 'hubspot', {
      fonte: 'hubspot', campo: 'hs.econt_fim', operador: 'proximos_dias',
      valor: econt.fim_plano.proximos_dias,
    }, ['hs.econt_fim']))
  }

  // ----------------------------------------------------------------- evento
  if (evento.presenca === 'ausente') {
    etapas.push(etapa('Faltou ao evento', 'evento', {
      fonte: 'evento', campo: 'ev.ausente', operador: 'e_verdadeiro',
    }, ['ev.ausente']))
  }
  if (evento.presenca === 'presente') {
    etapas.push(etapa('Compareceu ao evento', 'evento', {
      fonte: 'evento', campo: 'ev.presente', operador: 'e_verdadeiro',
    }, ['ev.presente']))
  }

  // ------------------------------------------------- o que o catálogo não tem
  if (hubspot.situacao || hubspot.pipelines) {
    naoCoube.push('situação e pipeline do negócio no HubSpot — não há campo no catálogo')
  }
  if (hubspot.cruzamento_produto) {
    naoCoube.push('cruzamento card × produtos ativos — não há campo no catálogo')
  }
  if (saude.sem_disparo_dias !== undefined || saude.toques_sem_resposta_min !== undefined) {
    naoCoube.push('janela de disparo sem resposta — não há campo no catálogo')
  }
  if (Array.isArray(f.ou)) {
    naoCoube.push('as alternativas do "ou" entre grupos — cada etapa tem um nível de combinador')
  }

  return { etapas, naoCoube }
}
