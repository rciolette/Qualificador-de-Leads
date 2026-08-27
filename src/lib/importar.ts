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
/** O que a tela mostra enquanto o arquivo é lido. */
export interface Progresso {
  arquivo: string
  /** 0-based: qual arquivo da fila */
  indice: number
  total: number
  fase: 'contando' | 'enviando' | 'processando' | 'pronto'
  /** linhas contadas AQUI no navegador, antes de enviar */
  linhas?: number
  bytesLidos?: number
  bytesTotais?: number
}

const BINARIOS = /\.(xlsx|xls|ods)$/i

/**
 * Conta as linhas do arquivo no próprio navegador, em streaming.
 *
 * Existe por um motivo de interface, não de dados: o POST para a Edge Function é
 * uma espera cega de dezenas de segundos, e sem nada na tela o usuário não sabe
 * se o app travou. Contar aqui dá um número real para mostrar antes de enviar.
 *
 * É uma contagem de quebras de linha: um CSV com quebra dentro de aspas conta a
 * mais. Por isso o número que fica na tela no fim é o do servidor, não este.
 */
export async function contarLinhas(
  arquivo: File,
  aoContar?: (linhas: number, bytesLidos: number, bytesTotais: number) => void,
): Promise<number | undefined> {
  // .xlsx é zip binário: contar \n não significa nada
  if (BINARIOS.test(arquivo.name)) return undefined

  const total = arquivo.size
  let lidos = 0
  let linhas = 0
  let ultimoAviso = 0

  const leitor = arquivo.stream().getReader()
  const dec = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await leitor.read()
      if (done) break
      lidos += value.byteLength
      const txt = dec.decode(value, { stream: true })
      for (let i = 0; i < txt.length; i++) {
        if (txt.charCodeAt(i) === 10) linhas++
      }
      // no máximo ~12 avisos por segundo, e devolve o controle ao browser:
      // sem isso a barra congela porque o laço monopoliza a thread
      const agora = performance.now()
      if (agora - ultimoAviso > 80) {
        ultimoAviso = agora
        aoContar?.(linhas, lidos, total)
        await new Promise((r) => setTimeout(r, 0))
      }
    }
  } finally {
    leitor.releaseLock()
  }

  aoContar?.(linhas, total, total)
  return linhas
}

/** POST com progresso de envio. `fetch` não expõe upload progress; XHR expõe. */
function enviarComProgresso(
  form: FormData,
  jwt: string,
  aoEnviar: (bytes: number, total: number) => void,
): Promise<{ ok: boolean; status: number; dados: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${FUNCTIONS_URL}/qualificador-importar`)
    xhr.setRequestHeader('Authorization', `Bearer ${jwt}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) aoEnviar(e.loaded, e.total)
    }
    xhr.onload = () => {
      let dados: Record<string, unknown> = {}
      try { dados = JSON.parse(xhr.responseText) } catch { /* corpo não-JSON */ }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, dados })
    }
    xhr.onerror = () => reject(new Error('conexão interrompida'))
    xhr.ontimeout = () => reject(new Error('tempo esgotado'))
    xhr.send(form)
  })
}

export async function analisarArquivos(
  arquivos: File[],
  opcoes: {
    linhaCabecalho?: number
    aoProgresso?: (p: Progresso) => void
  } = {},
): Promise<RespostaAnalise> {
  const juntos: RespostaAnalise = { analisados: [], documentos: [], campos: [] }
  const avisar = (p: Progresso) => opcoes.aoProgresso?.(p)

  for (const [i, arquivo] of arquivos.entries()) {
    const base = { arquivo: arquivo.name, indice: i, total: arquivos.length }

    // 1. contar aqui, para a tela ter um número desde o primeiro segundo
    avisar({ ...base, fase: 'contando', linhas: 0, bytesLidos: 0, bytesTotais: arquivo.size })
    const linhas = await contarLinhas(arquivo, (n, lidos, totalBytes) =>
      avisar({ ...base, fase: 'contando', linhas: n, bytesLidos: lidos, bytesTotais: totalBytes }))

    const form = new FormData()
    form.append('arquivos', arquivo)
    if (opcoes.linhaCabecalho !== undefined) {
      form.append('linha_cabecalho', String(opcoes.linhaCabecalho))
    }

    try {
      const jwt = await token()
      avisar({ ...base, fase: 'enviando', linhas, bytesLidos: 0, bytesTotais: arquivo.size })

      const r = await enviarComProgresso(form, jwt, (bytes, totalBytes) => {
        avisar({
          ...base,
          // 100% enviado não é 100% pronto: a função ainda vai processar
          fase: bytes >= totalBytes ? 'processando' : 'enviando',
          linhas, bytesLidos: bytes, bytesTotais: totalBytes,
        })
      })
      const dados = r.dados as {
        analisados?: Analise[]
        // documento (.md/.txt) não é planilha: vira contexto, não dado
        documentos?: { id: string; arquivo: string }[]
        campos?: CampoCanonico[]
        erro?: string
      }

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

  avisar({ arquivo: '', indice: arquivos.length, total: arquivos.length, fase: 'pronto' })
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
