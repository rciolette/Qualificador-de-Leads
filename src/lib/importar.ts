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

/**
 * Sobe os arquivos e devolve o que foi encontrado. Nada vira dado ainda.
 *
 * Um arquivo por requisição, em série. Mandar vários no mesmo POST derrubava a
 * Edge Function com HTTP 546 (WORKER_LIMIT): um relatório da Assiny tem ~6.700
 * linhas × 63 colunas, e o worker tem memória de sobra para um, não para quatro.
 * Em série, cada arquivo pega um worker limpo — e um que falhe não leva os outros.
 */
export async function analisarArquivos(
  arquivos: File[],
  opcoes: {
    linhaCabecalho?: number
    aoProgresso?: (feitos: number, total: number, arquivo: string) => void
  } = {},
): Promise<RespostaAnalise> {
  const juntos: RespostaAnalise = { analisados: [], documentos: [], campos: [] }

  for (const [i, arquivo] of arquivos.entries()) {
    opcoes.aoProgresso?.(i, arquivos.length, arquivo.name)

    const form = new FormData()
    form.append('arquivos', arquivo)
    if (opcoes.linhaCabecalho !== undefined) {
      form.append('linha_cabecalho', String(opcoes.linhaCabecalho))
    }

    try {
      const r = await fetch(`${FUNCTIONS_URL}/qualificador-importar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await token()}` },
        body: form,
      })
      const dados = await r.json().catch(() => ({}))

      if (!r.ok) {
        // um arquivo problemático não pode cancelar os outros da fila
        juntos.analisados.push({
          arquivo: arquivo.name,
          erro: dados?.erro ?? explicarHttp(r.status),
        } as Analise)
        continue
      }
      juntos.analisados.push(...(dados.analisados ?? []))
      juntos.documentos.push(...(dados.documentos ?? []))
      if (dados.campos?.length) juntos.campos = dados.campos
    } catch (e) {
      juntos.analisados.push({
        arquivo: arquivo.name,
        erro: `Falha de rede: ${(e as Error).message}`,
      } as Analise)
    }
  }

  opcoes.aoProgresso?.(arquivos.length, arquivos.length, '')
  return juntos
}

function explicarHttp(status: number): string {
  if (status === 546) {
    return 'O arquivo é grande demais para uma leitura só. Tente dividi-lo em partes menores.'
  }
  if (status === 413) return 'Arquivo acima do limite de 60 MB.'
  if (status === 504) return 'A leitura demorou demais e foi interrompida.'
  return `Análise falhou: HTTP ${status}`
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
