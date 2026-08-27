// Qualificador de Leads ROI · contrato de adaptador (PRD fase 2)
//
// Todo conector recebe a mesma coisa — alvos e contexto — e devolve a mesma coisa:
// gravações tipadas. Quem escreve no banco é o orquestrador, num lugar só.
// Nenhum adaptador toca no Postgres nem no Vault.

export interface Alvo {
  pessoa_id: string
  email: string
}

export interface Contexto {
  credencial: string
  baseUrl: string
  config: Record<string, unknown>
  /** teto de itens por página/lote, resolvido pelo orquestrador a partir do config */
  lote: number
}

export interface GravacaoCrm {
  tabela: 'crm_snapshot'
  pessoa_id: string
  hubspot_id: string | null
  /** properties do contato como vieram — habilita filtrar por campo nativo */
  props: Record<string, unknown> | null
  /** properties dos negócios, uma entrada por deal */
  props_deals: Record<string, unknown> | null
  classificacao_leadscore: string | null
  leadscore: number | null
  produtos_ativos: string[] | null
  produtos_historico: string[] | null
  econt: unknown
  deals: unknown
  disparo: unknown
}

export interface GravacaoEngajamento {
  tabela: 'engajamento'
  pessoa_id: string
  plataforma: 'memberclass' | 'memberkit'
  aulas_concluidas: number | null
  ultimo_acesso: string | null
  cadastro: string | null
  niveis: string[] | null
  dados: unknown
}

export interface GravacaoSaude {
  tabela: 'saude_disparo'
  pessoa_id: string
  lead_id_sellflux: string | null
  unsub_whats: boolean | null
  unsub_sms: boolean | null
  unsub_call: boolean | null
  tags: string[] | null
  preferential_whats_id: string | null
  ticket_aberto: boolean | null
  atualizado_em: string | null
}

/** identificador extra descoberto na fonte — vira linha em pessoa_identificador */
export interface GravacaoIdentificador {
  tabela: 'pessoa_identificador'
  pessoa_id: string
  tipo: 'documento' | 'telefone' | 'memberclass_id'
  valor: string
  fonte: 'hubspot' | 'memberclass' | 'memberkit' | 'sellflux'
}

export type Gravacao =
  | GravacaoCrm
  | GravacaoEngajamento
  | GravacaoSaude
  | GravacaoIdentificador

export interface Resultado {
  /** quantos alvos a fonte reconheceu */
  encontrados: number
  /** quantas chamadas HTTP foram feitas — entra no log de execução */
  chamadas: number
  gravacoes: Gravacao[]
  /** falhas por alvo que não derrubam o lote inteiro */
  avisos: string[]
}

export interface Adaptador {
  slug: string
  sincronizar(alvos: Alvo[], ctx: Contexto): Promise<Resultado>
}

// ------------------------------------------------------------------ auxiliares

export const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function fatiar<T>(itens: T[], tamanho: number): T[][] {
  const saida: T[][] = []
  for (let i = 0; i < itens.length; i += tamanho) saida.push(itens.slice(i, i + tamanho))
  return saida
}

/** Enum de múltiplos valores do HubSpot vem como "a;b;c". */
export function listaHubspot(v: unknown): string[] | null {
  if (typeof v !== 'string' || v.trim() === '') return null
  return v.split(';').map((s) => s.trim()).filter(Boolean)
}

export function comoBooleano(v: unknown): boolean | null {
  if (v === true || v === 'true') return true
  if (v === false || v === 'false') return false
  return null
}

export function comoNumero(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function comoData(v: unknown): string | null {
  if (!v) return null
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/** Só dígitos, descarta com menos de 11 — mesma regra de qualificador.norm_documento. */
export function normDocumento(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const d = v.replace(/\D/g, '')
  return d.length >= 11 ? d : null
}

/** E.164 BR — mesma regra de qualificador.norm_telefone. */
export function normTelefone(v: unknown): string | null {
  if (typeof v !== 'string' || v.trim() === '') return null
  const n = v.replace(/\D/g, '')
  if ((n.length === 12 || n.length === 13) && n.startsWith('55')) return '+' + n
  if (n.length === 10 || n.length === 11) return '+55' + n
  if (v.trim().startsWith('+') && n.length >= 8 && n.length <= 15) return '+' + n
  return null
}

/**
 * fetch com retentativa em 429 e 5xx, respeitando Retry-After.
 * Nunca inclui a URL na mensagem de erro: a chave do MemberKit viaja na query string.
 */
export async function buscar(
  url: string,
  init: RequestInit,
  rotulo: string,
  tentativas = 3,
): Promise<Response> {
  let ultimoErro = ''
  for (let i = 0; i < tentativas; i++) {
    const r = await fetch(url, init)
    if (r.ok) return r
    if (r.status === 429 || r.status >= 500) {
      const espera = Number(r.headers.get('Retry-After')) * 1000 || 1000 * 2 ** i
      ultimoErro = `${rotulo}: HTTP ${r.status}`
      await dormir(Math.min(espera, 15000))
      continue
    }
    const corpo = await r.text().catch(() => '')
    throw new Error(`${rotulo}: HTTP ${r.status} ${corpo.slice(0, 300)}`)
  }
  throw new Error(`${ultimoErro || rotulo}: esgotou ${tentativas} tentativas`)
}
