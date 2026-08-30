import { exigirSupabase } from './supabase'
import type { TimeComercial, TipoIniciativa, FaseIniciativa } from './tipos'

/** Uma condição dentro de uma etapa: um campo, um operador, um valor. */
export interface Condicao {
  fonte: string
  campo: string
  operador: string
  valor?: unknown
  /**
   * Só vale para `fonte: 'hubspot_negocio'`, que é a única coleção por pessoa.
   * 'algum' (padrão) — basta um negócio satisfazer.
   * 'todo'           — todos precisam satisfazer.
   * 483 das 567 pessoas têm negócios que discordam entre si: o padrão decide muito.
   */
  quantificador?: 'algum' | 'todo'
}

/** Uma etapa do funil montada na tela. */
export interface Etapa {
  id: string
  rotulo: string
  ativa: boolean
  /**
   * As condições da etapa. O motor também aceita o formato antigo
   * (fonte/campo/operador/valor direto na etapa) e o embrulha como condição
   * única — nenhum modelo salvo precisou ser migrado.
   */
  condicoes?: Condicao[]
  /** 'qualquer' (padrão) = união · 'todas' = interseção. Vale para a etapa. */
  combinador?: 'qualquer' | 'todas'

  // ---- formato antigo, preservado para os modelos já salvos
  fonte?: string
  campo?: string
  operador?: string
  valor?: unknown
  /** true = property nativa do HubSpot, lida de props / props_deals */
  nativo?: boolean
  /**
   * false (padrão) — a etapa é FILTRO: quem não tem o dado sai.
   * true            — a etapa é REFINO: quem não tem o dado segue sem ser julgado.
   *
   * Substituído por `sem_dado`; continua sendo lido nos modelos já salvos.
   */
  manter_sem_dado?: boolean
  /**
   * O que fazer com quem a etapa não conseguiu julgar — e, no caso do `apenas`,
   * o que fazer com a etapa inteira.
   *
   * 'excluir' (padrão) — tira da lista: quem não tem o dado sai.
   * 'manter'           — mantém na lista: quem não tem o dado segue sem ser julgado.
   * 'apenas'           — inverte a etapa: fica só quem NÃO a satisfaz.
   *
   * O `apenas` existe porque "quem comprou e não tem conta na área de membros" é
   * uma pergunta de negócio real, e com dois estados era impossível de fazer.
   */
  sem_dado?: 'excluir' | 'manter' | 'apenas'
  /**
   * Ids de `campo_filtravel` que esta etapa TRAZ para o resultado.
   * Enriquecer não é só deixar de excluir: as colunas consultadas aqui chegam
   * na tela e no arquivo exportado.
   */
  colunas?: string[]
}

/** Uma coluna trazida, já resolvida pelo banco. */
export interface ColunaResolvida {
  id: string
  rotulo: string
  caminho: string
  fonte: string
  tipo: string
  nativo: boolean
}

/** Um fluxo salvo para reusar — as etapas, as colunas e os pesos juntos. */
export interface ModeloFluxo {
  id: string
  nome: string
  descricao: string | null
  etapas: Etapa[]
  colunas: string[]
  pesos: Record<string, number>
  config: Record<string, unknown>
  /** reservado para o de-para entre plataformas; vazio até ele existir */
  de_para: Record<string, unknown>
  criado_em: string
  atualizado_em: string
}

export interface CampoFiltravel {
  id: string
  fonte: string
  caminho: string
  rotulo: string
  grupo: string | null
  tipo: 'texto' | 'numero' | 'data' | 'booleano' | 'lista' | 'enum'
  operadores: string[]
  descricao: string | null
  ordem: number
}

export interface LinhaFunil {
  ordem: number
  etapa: string
  rotulo: string
  bloqueio_duro: boolean
  saem_aqui: number
  restam: number
  /**
   * A etapa não tem nenhuma condição que o motor consiga julgar — campo em
   * branco, campo fora do catálogo ou operador ausente. Ela não corta ninguém,
   * e a tela precisa dizer isso: sem o aviso, "não cortou" fica igual a
   * "cortou zero".
   */
  ignorada?: boolean
}

export interface PessoaAvaliada {
  pessoa_id: string
  ordem: number | null
  etapa: string | null
  rotulo: string | null
  score: number
  faixa: string
  eixos: Record<string, number>
}

export interface PerfilPeso {
  slug: string
  nome: string
  tipo: TipoIniciativa | null
  fase: FaseIniciativa | null
  pesos: Record<string, number>
  observacao: string | null
  ordem: number
}

export interface Recorte {
  slug: string
  nome: string
  criterio: string
  filtros: Record<string, unknown>
  perfil_peso: string | null
  diagnostico: boolean
  destino: string | null
  ordem: number
}

export interface Iniciativa {
  id: string
  nome: string
  tipo: TipoIniciativa
  fase: FaseIniciativa | null
  objetivo: string
  times: TimeComercial[]
  prioridade_times: TimeComercial[] | null
  janela_ini: string | null
  janela_fim: string | null
  anti_fadiga_dias: number
  excluir_perdido_dias: number
  filtros: { etapas?: Etapa[] } & Record<string, unknown>
  pesos: Record<string, number>
  perfil_peso: string | null
  recorte: string | null
  observacao: string | null
  aberta: boolean
  criada_em: string
}

export const EIXOS = [
  { chave: 'relacao_comercial',    rotulo: 'Relação comercial',   ajuda: 'Ganho, perdido, sem conexão' },
  { chave: 'recencia_compra',      rotulo: 'Recência de compra',  ajuda: 'Quão recente foi a última compra' },
  { chave: 'valor_historico',      rotulo: 'Valor histórico',     ajuda: 'Valor acumulado, contra o percentil 95 da base' },
  { chave: 'engajamento_conteudo', rotulo: 'Engajamento',         ajuda: 'Aulas e último acesso nas áreas de membros' },
  { chave: 'nivel_memberkit',      rotulo: 'Nível MemberKit',     ajuda: 'Produto pago é prova de operação em andamento' },
  { chave: 'posse_produto',        rotulo: 'Posse de produto',    ajuda: 'Cruzamento card × ativos: renovação, furo, expansão' },
  { chave: 'saude_disparo',        rotulo: 'Saúde de disparo',    ajuda: 'Histórico de resposta a disparos anteriores' },
  { chave: 'leadscore',            rotulo: 'Leadscore',           ajuda: 'Perfil e capacidade. Sem faixa é neutro, não penalidade' },
] as const

export const OPERADORES: Record<string, string> = {
  preenchido: 'está preenchido',
  vazio: 'está vazio',
  e_verdadeiro: 'é sim',
  e_falso: 'é não',
  igual: 'é igual a',
  diferente: 'é diferente de',
  contem: 'contém o texto',
  e_um_de: 'é um destes',
  nao_e_um_de: 'não é nenhum destes',
  contem_algum: 'contém algum destes',
  nao_contem_nenhum: 'não contém nenhum destes',
  maior_igual: 'é no mínimo',
  menor_igual: 'é no máximo',
  entre: 'está entre',
  depois_de: 'é a partir de',
  antes_de: 'é até',
  proximos_dias: 'vence nos próximos N dias',
}

/** Operadores que não pedem valor. */
export const SEM_VALOR = new Set(['preenchido', 'vazio', 'e_verdadeiro', 'e_falso'])

/**
 * Traz uma etapa do formato antigo para o novo, sem perder nada. O motor aceita
 * os dois, mas a tela só sabe editar o novo — converter na leitura evita ter
 * duas UIs.
 */
export function normalizarEtapa(e: Etapa): Etapa {
  // o booleano antigo vira o estado novo: os dois convivem no motor, mas o editor
  // só sabe mexer em `sem_dado`, e um modelo salvo antes não tem o campo
  const modo = e.sem_dado ?? (e.manter_sem_dado ? 'manter' : 'excluir')
  if (Array.isArray(e.condicoes)) return e.sem_dado ? e : { ...e, sem_dado: modo }
  const { fonte, campo, operador, valor, quantificador, ...resto } =
    e as Etapa & { quantificador?: 'algum' | 'todo' }
  return {
    ...resto,
    sem_dado: modo,
    combinador: e.combinador ?? 'qualquer',
    condicoes: campo
      ? [{ fonte: fonte ?? '', campo, operador: operador ?? '', valor, quantificador }]
      : [],
  }
}

export const condicoesDe = (e: Etapa): Condicao[] =>
  Array.isArray(e.condicoes)
    ? e.condicoes
    : e.campo
      ? [{ fonte: e.fonte ?? '', campo: e.campo, operador: e.operador ?? '', valor: e.valor }]
      : []

/**
 * As colunas do resultado são a união do que cada etapa ativa trouxe, na ordem em
 * que apareceram. Etapa desligada não contribui — senão o arquivo teria coluna de
 * um filtro que o usuário desistiu de aplicar.
 */
export function colunasDe(etapas: Etapa[]): string[] {
  const vistas = new Set<string>()
  for (const e of etapas) {
    if (e.ativa === false) continue
    for (const c of e.colunas ?? []) vistas.add(c)
  }
  return [...vistas]
}

function config(i: Partial<Iniciativa>) {
  return {
    pesos: i.pesos ?? {},
    times: i.times ?? [],
    anti_fadiga_dias: i.anti_fadiga_dias ?? 7,
    excluir_perdido_dias: i.excluir_perdido_dias ?? 15,
  }
}

export async function calcularFunil(etapas: Etapa[], i: Partial<Iniciativa>): Promise<LinhaFunil[]> {
  const { data, error } = await exigirSupabase()
    .rpc('funil', { p_etapas: etapas, p_config: config(i) })
  if (error) throw error
  return (data ?? []) as LinhaFunil[]
}

/** Quem saiu numa etapa específica — o clique na linha do funil. */
export async function pessoasDaEtapa(
  etapas: Etapa[], i: Partial<Iniciativa>, ordem: number | null, limite = 200,
  colunas?: string[],
) {
  const { data, error } = await exigirSupabase()
    .rpc('pessoas_da_etapa', {
      p_etapas: etapas, p_config: config(i), p_ordem: ordem, p_limite: limite,
      p_colunas: colunas ?? colunasDe(etapas),
    })
  if (error) throw error
  return data ?? []
}

export async function listarCampos(): Promise<CampoFiltravel[]> {
  const { data, error } = await exigirSupabase()
    .from('campo_filtravel').select('*').order('ordem')
  if (error) throw error
  return data ?? []
}

/** Quantas pessoas da base têm cada campo preenchido. */
export interface Cobertura {
  campo_id: string
  com_dado: number
  base: number
  medido_em: string
}

/**
 * A cobertura vem de uma tabela, não de um cálculo na hora.
 *
 * Medir os 57 campos custa ~7 s, e o teto do PostgREST é 8 s — o mesmo teto que
 * já derrubou `gerar_lista` com um 500 opaco. Como a cobertura só muda quando o
 * dado muda, ela é gravada por `medir_cobertura()` e lida pronta aqui.
 *
 * Tabela vazia é resposta legítima: quer dizer "ainda não medimos", e a tela
 * simplesmente não mostra o aviso. Nunca é motivo para bloquear o filtro.
 */
export async function listarCobertura(): Promise<Map<string, Cobertura>> {
  const { data, error } = await exigirSupabase().from('cobertura_campo').select('*')
  if (error) throw error
  return new Map((data ?? []).map((c: Cobertura) => [c.campo_id, c]))
}

/** Remede tudo. Custa ~7 s: só sob demanda, nunca por render de tela. */
export async function medirCobertura(): Promise<void> {
  const { error } = await exigirSupabase().rpc('medir_cobertura')
  if (error) throw error
}

/** Valores distintos de um campo, para o seletor não exigir digitação exata. */
export async function valoresDe(campo: CampoFiltravel, limite = 200): Promise<string[]> {
  // a fonte é obrigatória para property crua: ela mora em props/props_deals,
  // não em v_pessoa_completa, e sem isso o seletor vinha vazio
  const { data, error } = await exigirSupabase()
    .rpc('valores_do_campo', {
      p_caminho: campo.caminho, p_limite: limite,
      p_fonte: campo.fonte.startsWith('hubspot_') ? campo.fonte : null,
    })
  if (error) throw error
  return (data ?? []).map((r: { valor: string }) => r.valor)
}

export async function listarPerfis(): Promise<PerfilPeso[]> {
  const { data, error } = await exigirSupabase()
    .from('perfil_peso').select('*').order('ordem')
  if (error) throw error
  return data ?? []
}

export async function listarRecortes(): Promise<Recorte[]> {
  const { data, error } = await exigirSupabase()
    .from('recorte').select('*').order('ordem')
  if (error) throw error
  return data ?? []
}

export async function listarIniciativas(): Promise<Iniciativa[]> {
  const { data, error } = await exigirSupabase()
    .from('iniciativa').select('*').order('criada_em', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function salvarIniciativa(i: Partial<Iniciativa> & { etapas: Etapa[] }) {
  const { etapas, ...resto } = i
  const linha = { ...resto, filtros: { etapas } }
  const { data, error } = await exigirSupabase()
    .from('iniciativa').upsert(linha).select().single()
  if (error) throw error
  return data as Iniciativa
}

export async function gerarLista(iniciativaId: string, etapas: Etapa[], i: Partial<Iniciativa>) {
  const { data, error } = await exigirSupabase()
    .rpc('gerar_lista', {
      p_iniciativa_id: iniciativaId, p_etapas: etapas, p_config: config(i),
      p_colunas: colunasDe(etapas),
    })
  if (error) throw error
  return data as { lista_id: string; total: number; por_time: Record<string, number> }
}

/**
 * Os rótulos das colunas vêm do banco, não do catálogo cru: é lá que o
 * "Dias sem acessar" da MemberClass ganha sobrenome para não se confundir com o
 * do MemberKit. Tela e xlsx precisam usar a mesma fonte, senão o cabeçalho da
 * prévia não bate com o do arquivo.
 */
export async function resolverColunas(ids: string[]): Promise<ColunaResolvida[]> {
  if (ids.length === 0) return []
  const { data, error } = await exigirSupabase()
    .rpc('resolver_colunas', { p_colunas: ids })
  if (error) throw error
  return (data ?? []) as ColunaResolvida[]
}

// ---------------------------------------------------------------- modelos

export async function listarModelos(): Promise<ModeloFluxo[]> {
  const { data, error } = await exigirSupabase()
    .from('modelo_fluxo').select('*').order('atualizado_em', { ascending: false })
  if (error) throw error
  return data ?? []
}

/**
 * Salvar o fluxo NÃO gera lista. Era a única forma de guardar uma receita antes,
 * e obrigava a produzir uma lista descartável só para não perder o trabalho.
 */
export async function salvarModelo(m: {
  id?: string
  nome: string
  descricao?: string | null
  etapas: Etapa[]
  pesos: Record<string, number>
  config: Record<string, unknown>
}): Promise<ModeloFluxo> {
  const linha = {
    ...(m.id ? { id: m.id } : {}),
    nome: m.nome,
    descricao: m.descricao ?? null,
    etapas: m.etapas,
    colunas: colunasDe(m.etapas),
    pesos: m.pesos,
    config: m.config,
    atualizado_em: new Date().toISOString(),
  }
  const { data, error } = await exigirSupabase()
    .from('modelo_fluxo').upsert(linha, { onConflict: 'id' }).select().single()
  if (error) throw error
  return data as ModeloFluxo
}

export async function apagarModelo(id: string) {
  const { error } = await exigirSupabase().from('modelo_fluxo').delete().eq('id', id)
  if (error) throw error
}
