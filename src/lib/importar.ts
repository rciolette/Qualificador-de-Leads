import { exigirSupabase, FUNCTIONS_URL } from './supabase'

export interface CampoCanonico {
  campo: string
  rotulo: string
  grupo: 'identidade' | 'transacao' | 'projeto'
  chave?: boolean
}

export interface Analise {
  importacao_id: string
  arquivo: string
  formato: 'csv' | 'xlsx' | 'texto'
  linhas: number
  linha_cabecalho: number
  colunas: string[]
  amostra: Record<string, string>[]
  fonte_sugerida: { id: string; nome: string; embutido: boolean } | null
  mapeamento: Record<string, string>
  transformacoes: Record<string, string>
  regras: Regras
  erro?: string
}

export interface Regras {
  exigir_projeto_no_catalogo?: boolean
  status_aceitos?: string[]
  periodo?: { de?: string; ate?: string }
}

export interface RespostaAnalise {
  analisados: Analise[]
  documentos: { id: string; arquivo: string }[]
  campos: CampoCanonico[]
}

export interface ResultadoIngestao {
  caminho: 'assiny' | 'generico'
  importacao_id: string
  linhas_no_arquivo?: number
  itens_no_arquivo?: number
  transacoes?: number
  transacoes_novas?: number
  transacoes_ja_havia?: number
  pessoas_criadas?: number
  sem_identidade?: number
  fora_das_regras?: number
  duracao_ms?: number
}

export interface FonteImportacao {
  id: string
  nome: string
  descricao: string | null
  mapeamento: Record<string, string>
  transformacoes: Record<string, string>
  regras: Regras
  assinatura: string[] | null
  embutido: boolean
  criado_em: string
}

async function token(): Promise<string> {
  const { data: { session } } = await exigirSupabase().auth.getSession()
  if (!session) throw new Error('Sessão expirada. Entre de novo.')
  return session.access_token
}

/** Sobe os arquivos e devolve o que foi encontrado. Nada vira dado ainda. */
export async function analisarArquivos(
  arquivos: File[],
  linhaCabecalho?: number,
): Promise<RespostaAnalise> {
  const form = new FormData()
  for (const a of arquivos) form.append('arquivos', a)
  if (linhaCabecalho !== undefined) form.append('linha_cabecalho', String(linhaCabecalho))

  const r = await fetch(`${FUNCTIONS_URL}/qualificador-importar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}` },
    body: form,
  })
  const dados = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(dados?.erro ?? `Análise falhou: HTTP ${r.status}`)
  return dados as RespostaAnalise
}

/** Confirma o de-para e grava de verdade. */
export async function ingerirImportacao(corpo: {
  importacao_id: string
  mapeamento: Record<string, string>
  transformacoes?: Record<string, string>
  regras?: Regras
  nome?: string
  descricao?: string
  tags?: string[]
  salvar_como?: string
  assinatura?: string[]
}): Promise<ResultadoIngestao> {
  const r = await fetch(`${FUNCTIONS_URL}/qualificador-importar`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(corpo),
  })
  const dados = await r.json().catch(() => ({}))
  if (!r.ok) {
    const erro = new Error(dados?.erro ?? `Importação falhou: HTTP ${r.status}`)
    ;(erro as Error & { bloqueio?: boolean }).bloqueio = Boolean(dados?.bloqueio_de_catalogo)
    throw erro
  }
  return dados as ResultadoIngestao
}

export async function listarFontes(): Promise<FonteImportacao[]> {
  const { data, error } = await exigirSupabase()
    .from('fonte_importacao').select('*').order('embutido', { ascending: false }).order('nome')
  if (error) throw error
  return data ?? []
}

export const EXTENSOES_ACEITAS = '.csv,.tsv,.xlsx,.xls,.xlsm,.ods,.md,.markdown,.txt,.json'

export function ehPlanilha(arquivo: File): boolean {
  const ext = arquivo.name.toLowerCase().split('.').pop() ?? ''
  return !['md', 'markdown', 'txt', 'json'].includes(ext)
}
