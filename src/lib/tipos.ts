// Espelha o schema `qualificador`. Regenerável com:
//   supabase gen types typescript --project-id qevnfgopjupsmwvflcza --schema qualificador

export type Papel = 'leitor' | 'operador' | 'gestao'
export type AreaMembros = 'memberclass' | 'memberkit'
export type TimeComercial = 'IS' | 'AE' | 'ECONT'
export type TipoIniciativa = 'corujao' | 'launch' | 'webinar' | 'pontual'
export type FaseIniciativa = 'atrair' | 'converter' | 'pre' | 'pos'
export type TipoIntegracao = 'fonte_venda' | 'area_membros' | 'crm' | 'disparo'

export const PAPEIS: Papel[] = ['leitor', 'operador', 'gestao']

export function temPapelMinimo(papel: Papel | null, minimo: Papel): boolean {
  if (!papel) return false
  return PAPEIS.indexOf(papel) >= PAPEIS.indexOf(minimo)
}

export interface Integracao {
  id: string
  slug: string
  nome_exibicao: string
  tipo: TipoIntegracao
  base_url: string | null
  credencial_ref: string | null
  credencial_mascara: string | null
  credencial_criada_em: string | null
  config: Record<string, unknown> | null
  ativa: boolean
  frescor_limite_horas: number | null
}

export interface Frescor {
  slug: string
  nome_exibicao: string
  tipo: TipoIntegracao
  ativa: boolean
  frescor_limite_horas: number | null
  ultima_execucao: string | null
  ultimo_status: string | null
  ultimos_registros: number | null
  horas_desde: number | null
  vencida: boolean
}

export interface Execucao {
  id: number
  integracao_id: string | null
  operacao: string | null
  status: string | null
  registros: number | null
  duracao_ms: number | null
  erro: string | null
  executado_em: string
}

export interface Projeto {
  id: string
  organizacao_assiny: string
  id_organizacao_assiny: string | null
  nome_assiny: string
  id_projeto_assiny: string | null
  area_membros: AreaMembros | null
  area_membros_nao_se_aplica: boolean
  ativo: boolean
  observacao: string | null
  criado_em: string
}

export interface Importacao {
  id: string
  arquivo: string
  nome: string | null
  descricao: string | null
  tags: string[] | null
  fonte_importacao_id: string | null
  regras: Record<string, unknown> | null
  formato: string | null
  status: 'pendente' | 'analisado' | 'ingerido' | 'erro'
  projeto_id: string | null
  periodo_ini: string | null
  periodo_fim: string | null
  linhas_lidas: number | null
  linhas_novas: number | null
  linhas_ignoradas: number | null
  importado_por: string | null
  importado_em: string
}

/** Resposta de qualificador-sync. */
export interface ResultadoSync {
  fonte: string
  alvos: number
  encontrados?: number
  nao_encontrados?: number
  chamadas_http?: number
  gravadas?: Record<string, number>
  duracao_ms?: number
  avisos?: string[]
  mensagem?: string
}

/** Resposta de qualificador-credencial-salvar. */
export interface ResultadoCredencial {
  slug: string
  credencial_ref: string
  mascara: string
  substituida: boolean
  gravada_em: string
}

/** Resposta de qualificador-importar-assiny. */
export interface ResultadoImportacao {
  importacao_id: string
  arquivo: string
  itens_no_arquivo: number
  transacoes: number
  transacoes_novas: number
  transacoes_ja_havia: number
  sem_identidade: number
  pessoas_criadas: number
  colunas_ignoradas?: string[]
  duracao_ms?: number
}
