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

/**
 * Resposta de qualificador-espelhar. `status: 'continua'` significa que o worker
 * esgotou o orçamento de 60 s e re-invocou a si mesmo — a mesma execução segue
 * viva no banco, só a resposta HTTP voltou antes.
 */
export interface ResultadoEspelho {
  fonte: string
  status: 'concluido' | 'continua' | 'erro'
  total_declarado?: number | null
  linhas_espelho?: number
  paginas?: number
  chamadas_http?: number
  casamento?: { casou_por: string; pessoas: number }[]
  duracao_ms?: number
  pagina?: number
  execucao_id?: number
  gravados_ate_aqui?: number
  erro?: string
}

/** Resposta de qualificador-credencial-salvar. */
export interface ResultadoCredencial {
  slug: string
  credencial_ref: string
  mascara: string
  substituida: boolean
  gravada_em: string
}


/** Resposta de qualificador-sync com acao "testar". */
export interface Diagnostico {
  fonte: string
  ok: boolean
  status: number | null
  titulo: string
  detalhe: string
  acao?: string
}
