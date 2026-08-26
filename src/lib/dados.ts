import { exigirSupabase, supabase, FUNCTIONS_URL } from './supabase'
import type {
  Execucao, Frescor, Importacao, Integracao, Papel, Projeto,
  ResultadoCredencial, ResultadoImportacao, ResultadoSync,
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

export function sincronizar(fonte: string, limite = 100, maxIdadeHoras = 24) {
  return chamarFuncao<ResultadoSync>('qualificador-sync', {
    fonte, limite, max_idade_horas: maxIdadeHoras,
  })
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
