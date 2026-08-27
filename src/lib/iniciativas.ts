import { exigirSupabase } from './supabase'
import type { TimeComercial, TipoIniciativa, FaseIniciativa } from './tipos'

/** Uma etapa do funil montada na tela. */
export interface Etapa {
  id: string
  rotulo: string
  fonte: string
  campo: string
  operador: string
  valor?: unknown
  ativa: boolean
  /** true = property nativa do HubSpot, lida de props / props_deals */
  nativo?: boolean
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
) {
  const { data, error } = await exigirSupabase()
    .rpc('pessoas_da_etapa', {
      p_etapas: etapas, p_config: config(i), p_ordem: ordem, p_limite: limite,
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

/** Valores distintos de um campo, para o seletor não exigir digitação exata. */
export async function valoresDe(campo: CampoFiltravel, limite = 200): Promise<string[]> {
  const { data, error } = await exigirSupabase()
    .rpc('valores_do_campo', { p_caminho: campo.caminho, p_limite: limite })
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
    })
  if (error) throw error
  return data as { lista_id: string; total: number; por_time: Record<string, number> }
}
