// Qualificador de Leads ROI · Tarefa 0-B · paginadores de espelho
//
// Uma fonte de espelho sabe fazer UMA coisa: devolver a página N da fonte inteira,
// já normalizada em chaves de cruzamento. Não conhece o Postgres, não conhece
// nossa base de pessoas e nunca recebe uma lista de alvos -- foi exatamente isso
// (uma chamada HTTP por pessoa) que fez as três integrações levarem minutos para
// não cruzar nada.

export interface Contexto {
  credencial: string
  baseUrl: string
  config: Record<string, unknown>
}

export interface Registro {
  externo_id: string
  chave_email: string | null
  chave_documento: string | null
  chave_telefone: string | null
  payload: unknown
}

export interface Pagina {
  registros: Registro[]
  /** número da próxima página, ou null quando acabou */
  proxima: number | null
  /** total declarado pela fonte -- só vem na primeira página, e vai para o log */
  total: number | null
  chamadas: number
}

export interface FonteEspelho {
  slug: string
  tabela: string
  /** pausa entre páginas, para respeitar rate limit documentado */
  pausaMs: number
  pagina(n: number, ctx: Contexto): Promise<Pagina>
}

export const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------------ normalização
// Idêntica às funções qualificador.chave_* do banco. Se uma das duas mudar, o
// casamento silenciosamente para de casar -- mudar sempre as duas juntas.

export function chaveEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  return s === '' ? null : s
}

export function chaveDocumento(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const d = String(v).replace(/\D/g, '')
  return d.length >= 11 ? d : null
}

/**
 * Últimos 11 dígitos, sem DDI. A Sellflux devolve o telefone como NÚMERO cru
 * (`"phone": 51999999999`) e nossa pessoa.telefone_e164 guarda +5551999999999.
 * Comparar as duas formas inteiras nunca casa -- foi o bug 2 do diagnóstico.
 */
export function chaveTelefone(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const d = String(v).replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-11) : null
}

// deno-lint-ignore no-explicit-any
function corpoLista(corpo: any): any[] {
  if (Array.isArray(corpo)) return corpo
  return corpo?.data ?? corpo?.items ?? corpo?.users ?? corpo?.leads ?? corpo?.students ?? []
}

// ------------------------------------------------------------------ MemberKit
// GET /users?page=N&page_limit=50 -- a academia inteira são ~29 páginas.
// A chave viaja na QUERY STRING: nenhuma mensagem de erro daqui pode conter a URL.
// Rate limit documentado: 120 req/min -> 500 ms entre páginas = ~15 s no total.

export const memberkit: FonteEspelho = {
  slug: 'memberkit',
  tabela: 'espelho_memberkit',
  pausaMs: 500,

  async pagina(n, ctx) {
    const url = `${ctx.baseUrl}/users?page=${n}&page_limit=50` +
      `&api_key=${encodeURIComponent(ctx.credencial)}`

    let r: Response
    try {
      r = await fetch(url, { headers: { Accept: 'application/json' } })
    } catch {
      // a mensagem nativa do fetch carrega a URL, e a URL carrega a chave
      throw new Error('memberkit: falha de rede ao listar membros')
    }
    if (!r.ok) throw new Error(`memberkit: HTTP ${r.status} ao listar membros`)

    const corpo = await r.json()
    const lista = corpoLista(corpo)
    const totalPaginas = Number(r.headers.get('Total-Pages')) || null
    const total = Number(r.headers.get('Total-Count')) || null

    // deno-lint-ignore no-explicit-any
    const registros: Registro[] = lista
      .filter((m: any) => m?.id != null)
      .map((m: any) => ({
        externo_id: String(m.id),
        chave_email: chaveEmail(m.email),
        chave_documento: chaveDocumento(m.cpf_cnpj),
        chave_telefone: chaveTelefone(`${m.phone_local_code ?? ''}${m.phone_number ?? ''}`),
        payload: m,
      }))

    const proxima = totalPaginas
      ? (n < totalPaginas ? n + 1 : null)
      : (lista.length === 50 ? n + 1 : null)

    return { registros, proxima, total: n === 1 ? total : null, chamadas: 1 }
  },
}

// ------------------------------------------------------------------ MemberClass
// GET /api/v1/student/report?page=N&limit=100 -- relatório do TENANT INTEIRO,
// sem filtro de e-mail. O adaptador antigo usava /user/informations?email=…, que
// devolve 404 quando não acha: todo "não tem conta" virava linha de erro.
// Cache Redis de 300 s no endpoint -- não vale repetir antes disso.

export const memberclass: FonteEspelho = {
  slug: 'memberclass',
  tabela: 'espelho_memberclass',
  pausaMs: 200,

  async pagina(n, ctx) {
    const r = await fetch(
      `${ctx.baseUrl}/api/v1/student/report?page=${n}&limit=100`,
      { headers: { 'x-api-key': ctx.credencial, Accept: 'application/json' } },
    )
    if (!r.ok) throw new Error(`memberclass student/report: HTTP ${r.status}`)

    const corpo = await r.json()
    const lista = corpoLista(corpo)
    const pag = corpo?.pagination ?? {}

    // deno-lint-ignore no-explicit-any
    const registros: Registro[] = lista
      .filter((a: any) => a?.aluno_id != null || a?.email)
      .map((a: any) => ({
        externo_id: String(a.aluno_id ?? a.email),
        chave_email: chaveEmail(a.email),
        chave_documento: chaveDocumento(a.cpf),
        chave_telefone: null, // a MemberClass não expõe telefone em lugar nenhum
        payload: a,
      }))

    const proxima = pag.hasNextPage === true
      ? n + 1
      : (pag.totalPages ? (n < Number(pag.totalPages) ? n + 1 : null)
                        : (lista.length === 100 ? n + 1 : null))

    return {
      registros,
      proxima,
      total: n === 1 ? (Number(pag.totalCount) || 0) : null,
      chamadas: 1,
    }
  },
}

// ------------------------------------------------------------------ Sellflux
// GET /api/v1/lead/project?page=N -- 30 por página, fixo.
// A listagem já traz unsub_whats, o bloqueio duro do PRD 7.1: não existe motivo
// para uma chamada por pessoa. E NENHUM lead é descartado por ter email null --
// o `find` por e-mail exato era o bug 1, a causa do "não confere nada".

export const sellflux: FonteEspelho = {
  slug: 'sellflux',
  tabela: 'espelho_sellflux',
  pausaMs: 150, // rate limit não documentado: ir devagar por escolha

  async pagina(n, ctx) {
    const r = await fetch(
      `${ctx.baseUrl}/api/v1/lead/project?page=${n}`,
      { headers: { Authorization: `Bearer ${ctx.credencial}`, Accept: 'application/json' } },
    )
    if (!r.ok) throw new Error(`sellflux lead/project: HTTP ${r.status}`)

    const corpo = await r.json()
    const lista = corpoLista(corpo)
    const totalPaginas = Number(corpo?.total_pages) || null

    // deno-lint-ignore no-explicit-any
    const registros: Registro[] = lista
      .filter((l: any) => l?.id != null)
      .map((l: any) => ({
        externo_id: String(l.id),
        chave_email: chaveEmail(l.email),
        chave_documento: null, // a Sellflux não guarda documento
        chave_telefone: chaveTelefone(l.phone),
        payload: l,
      }))

    const proxima = totalPaginas
      ? (n < totalPaginas ? n + 1 : null)
      : (lista.length === 30 ? n + 1 : null)

    return {
      registros,
      proxima,
      total: n === 1 ? (Number(corpo?.total) || 0) : null,
      chamadas: 1,
    }
  },
}

export const FONTES: Record<string, FonteEspelho> = { memberkit, memberclass, sellflux }
