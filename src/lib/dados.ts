import { exigirSupabase, supabase, FUNCTIONS_URL } from './supabase'
import type {
  Diagnostico, Execucao, Frescor, Importacao, Integracao, Papel, Projeto,
  ResultadoCredencial, ResultadoEspelho, ResultadoImportacao, ResultadoSync,
} from './tipos'

/** Chama uma Edge Function do Qualificador com o JWT da sessão atual. */
async function chamarFuncao<T>(nome: string, corpo: unknown): Promise<T> {
  const { data: { session } } = await exigirSupabase().auth.getSession()
  if (!session) throw new Error('Sessão expirada. Entre de novo.')

  const r = await fetch(`${FUNCTIONS_URL}/${nome}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(corpo),
  })
  const dados = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(dados?.erro ?? `${nome}: HTTP ${r.status}`)
  return dados as T
}

// ------------------------------------------------------------------ perfil

export async function buscarPapel(userId: string): Promise<Papel | null> {
  const { data, error } = await exigirSupabase().from('user_profiles').select('papel').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return (data?.papel as Papel) ?? null
}

// ------------------------------------------------------------- integrações

export async function listarIntegracoes(): Promise<Integracao[]> {
  const { data, error } = await exigirSupabase().from('integracao').select('*').order('tipo')
  if (error) throw error
  return data ?? []
}

export async function listarFrescor(): Promise<Frescor[]> {
  const { data, error } = await exigirSupabase().from('v_frescor_integracoes').select('*')
  if (error) throw error
  return data ?? []
}

export async function listarExecucoes(limite = 30): Promise<Execucao[]> {
  const { data, error } = await exigirSupabase().from('integracao_execucao').select('*')
    .order('executado_em', { ascending: false }).limit(limite)
  if (error) throw error
  return data ?? []
}

/**
 * Envia o token para a Edge Function, que grava no Vault.
 * O valor nunca é guardado no estado do app depois desta chamada.
 */
export function salvarCredencial(slug: string, token: string) {
  return chamarFuncao<ResultadoCredencial>('qualificador-credencial-salvar', { slug, token })
}

/**
 * Envia o CSV da Assiny para a Edge Function, que carrega o staging e ingere.
 * Não usa `chamarFuncao` porque o corpo é multipart, não JSON.
 */
export async function importarAssiny(arquivo: File): Promise<ResultadoImportacao> {
  const { data: { session } } = await exigirSupabase().auth.getSession()
  if (!session) throw new Error('Sessão expirada. Entre de novo.')

  const form = new FormData()
  form.append('arquivo', arquivo)

  const r = await fetch(`${FUNCTIONS_URL}/qualificador-importar-assiny`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: form,
  })
  const dados = await r.json().catch(() => ({}))
  if (!r.ok) {
    const erro = new Error(dados?.erro ?? `Importação falhou: HTTP ${r.status}`)
    // projeto fora do catálogo é decisão pendente, não falha do sistema
    ;(erro as Error & { bloqueio?: boolean }).bloqueio = Boolean(dados?.bloqueio_de_catalogo)
    throw erro
  }
  return dados as ResultadoImportacao
}

/** Checa a credencial sem ler nem gravar nada. O diagnóstico É a resposta. */
export function testarConexao(fonte: string) {
  return chamarFuncao<Diagnostico>('qualificador-sync', { fonte, acao: 'testar' })
}

export function sincronizar(fonte: string, limite = 100, maxIdadeHoras = 24) {
  return chamarFuncao<ResultadoSync>('qualificador-sync', {
    fonte, limite, max_idade_horas: maxIdadeHoras,
  })
}

export interface ProgressoSync {
  rodada: number
  processados: number
  encontrados: number
  /** quantas pessoas ainda faltam, segundo a última rodada */
  lote: number
  fase: 'rodando' | 'reduzindo' | 'pronto'
}

/**
 * Sincroniza a fonte inteira, em lotes, até não sobrar ninguém.
 *
 * Uma chamada só não dá conta: a Edge Function tem orçamento fixo e o HubSpot
 * faz três chamadas por lote (contatos, associações, negócios). Com a base em
 * 4.430 pessoas, pedir tudo de uma vez devolve HTTP 546 (WORKER_RESOURCE_LIMIT)
 * depois de já ter gravado parte — e sem registrar a execução, porque morre
 * antes de `finalizar_execucao`.
 *
 * Então: lotes pequenos, um worker limpo por lote. Se um lote estourar mesmo
 * assim, o tamanho cai pela metade e tenta de novo — em vez de abortar tudo.
 */
export async function sincronizarTudo(
  fonte: string,
  opcoes: {
    lote?: number
    maxIdadeHoras?: number
    aoProgresso?: (p: ProgressoSync) => void
    /** teto de segurança: nunca virar laço infinito */
    maxRodadas?: number
  } = {},
): Promise<{ rodadas: number; processados: number; encontrados: number; parouPor: string }> {
  let lote = opcoes.lote ?? 100
  const maxIdade = opcoes.maxIdadeHoras ?? 24
  const maxRodadas = opcoes.maxRodadas ?? 80

  let rodadas = 0
  let processados = 0
  let encontrados = 0

  while (rodadas < maxRodadas) {
    rodadas++
    try {
      const r = await sincronizar(fonte, lote, maxIdade)

      // a função devolve `alvos: 0` quando não há mais ninguém na janela
      if (!r.alvos) {
        opcoes.aoProgresso?.({ rodada: rodadas, processados, encontrados, lote, fase: 'pronto' })
        return { rodadas, processados, encontrados, parouPor: 'nada a sincronizar' }
      }

      processados += r.alvos
      encontrados += r.encontrados ?? 0
      opcoes.aoProgresso?.({ rodada: rodadas, processados, encontrados, lote, fase: 'rodando' })
    } catch (e) {
      const msg = String((e as Error).message ?? e)
      // 546 = o worker estourou. Não é erro de dado: é lote grande demais.
      const estourou = msg.includes('546') || /WORKER|RESOURCE_LIMIT/i.test(msg)
      if (estourou && lote > 10) {
        lote = Math.max(10, Math.floor(lote / 2))
        opcoes.aoProgresso?.({ rodada: rodadas, processados, encontrados, lote, fase: 'reduzindo' })
        continue
      }
      return { rodadas, processados, encontrados, parouPor: msg }
    }
  }
  return { rodadas, processados, encontrados, parouPor: `teto de ${maxRodadas} rodadas` }
}

/** Fontes pequenas o bastante para espelhar inteiras em vez de perguntar por pessoa. */
export const FONTES_ESPELHADAS = ['memberkit', 'memberclass', 'sellflux']

/**
 * Espelha a fonte inteira e reconcilia em SQL.
 *
 * A função tem orçamento de 60 s por invocação e re-invoca a si mesma quando a
 * fonte tem mais páginas que isso. O `while` abaixo existe para o caso de essa
 * re-invocação morrer junto com o worker: o front retoma da mesma página, na
 * mesma linha de execução. Nunca duplica — o espelho tem chave primária.
 */
export async function espelhar(
  fonte: string,
  aoProgresso?: (pagina: number, gravados: number) => void,
): Promise<ResultadoEspelho> {
  let corpo: Record<string, unknown> = { fonte }

  for (let tentativa = 0; tentativa < 60; tentativa++) {
    const r = await chamarFuncao<ResultadoEspelho>('qualificador-espelhar', corpo)
    if (r.status !== 'continua') return r
    aoProgresso?.(r.pagina ?? 0, r.gravados_ate_aqui ?? 0)
    corpo = { fonte, pagina_inicial: r.pagina, execucao_id: r.execucao_id }
  }
  throw new Error('Espelhamento não terminou em 60 retomadas — verifique o log de execução')
}

// ---------------------------------------------------------------- catálogo

export async function listarProjetos(): Promise<Projeto[]> {
  const { data, error } = await exigirSupabase().from('projeto').select('*').order('organizacao_assiny').order('nome_assiny')
  if (error) throw error
  return data ?? []
}

export async function listarImportacoes(limite = 20): Promise<Importacao[]> {
  const { data, error } = await exigirSupabase().from('importacao').select('*')
    .order('importado_em', { ascending: false }).limit(limite)
  if (error) throw error
  return data ?? []
}

// ----------------------------------------------------------------- formato

export function formatarData(iso: string | null, comHora = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    ...(comHora ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

export function formatarNumero(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString('pt-BR')
}

export function formatarDuracao(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`
}

/**
 * Um valor vindo do jsonb pode ser lista, booleano ou nulo. A prévia na tela e o
 * xlsx usam esta mesma regra, para o que a pessoa vê ser o que sai no arquivo.
 */
export function mostrar(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (Array.isArray(v)) return v.length ? v.join(' · ') : '—'
  if (typeof v === 'boolean') return v ? 'sim' : 'não'
  return String(v)
}
