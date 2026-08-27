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

/**
 * fetch com recuo em 429 e 5xx, respeitando Retry-After.
 *
 * A MemberClass devolveu 429 na página 50 de ~252 com pausa fixa de 200 ms: o
 * limite existe e não está documentado. Pausa fixa não resolve — o que resolve é
 * obedecer ao Retry-After e dobrar a espera a cada tentativa.
 *
 * `rotulo` nunca inclui a URL: a chave do MemberKit viaja na query string.
 */
export async function buscarComRecuo(
  url: string,
  init: RequestInit,
  rotulo: string,
  tentativas = 5,
): Promise<Response> {
  let ultimo = ''
  for (let i = 0; i < tentativas; i++) {
    let r: Response
    try {
      r = await fetch(url, init)
    } catch {
      // a mensagem nativa do fetch carrega a URL, e a URL pode carregar a chave
      ultimo = `${rotulo}: falha de rede`
      await dormir(Math.min(1000 * 2 ** i, 20_000))
      continue
    }
    if (r.ok) return r
    if (r.status === 429 || r.status >= 500) {
      const cabecalho = Number(r.headers.get('Retry-After'))
      const espera = Number.isFinite(cabecalho) && cabecalho > 0
        ? cabecalho * 1000
        : 1000 * 2 ** i
      ultimo = `${rotulo}: HTTP ${r.status}`
      await dormir(Math.min(espera, 20_000))
      continue
    }
    throw new Error(`${rotulo}: HTTP ${r.status}`)
  }
  throw new Error(`${ultimo} — esgotou ${tentativas} tentativas`)
}

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
/**
 * Chave canônica de telefone. TEM QUE SER IDÊNTICA a
 * `qualificador.chave_telefone()` no banco — mudar uma sem a outra faz o
 * cruzamento parar de casar em silêncio (seção 5 do CLAUDE.md).
 *
 * A regra antiga era `slice(-11)`, e errava em três situações:
 *   +551133334444 (fixo BR com DDI) -> o "5" do DDI entrava na chave;
 *   +351910649613 (Portugal)        -> virava um celular de DDD 51, cruzando
 *                                      a pessoa ERRADA em silêncio;
 *   5199999999 x 51999999999        -> o nono dígito separava o mesmo celular.
 *
 * Agora: BR vira `55 + DDD + 8 últimos dígitos` (o nono é descartado dos dois
 * lados). Outros países preservam o número inteiro com DDI.
 */
export function chaveTelefone(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const bruto = String(v).trim()
  const n = bruto.replace(/\D/g, '')

  // DDI explícito por "+": ele decide, sempre. Sem isso, +1 415 555 2671 (EUA,
  // 11 dígitos) seria lido como celular BR, que também tem 11.
  if (bruto.startsWith('+')) {
    if (n.startsWith('55') && (n.length === 12 || n.length === 13)) {
      return '55' + n.slice(2, 4) + n.slice(-8)
    }
    return n.length >= 8 && n.length <= 15 ? n : null
  }

  // sem "+": número nacional brasileiro, que é como Assiny e Sellflux mandam
  if (n.length === 10 || n.length === 11) return '55' + n.slice(0, 2) + n.slice(-8)
  if ((n.length === 12 || n.length === 13) && n.startsWith('55')) {
    return '55' + n.slice(2, 4) + n.slice(-8)
  }
  if (n.length >= 8 && n.length <= 15) return n
  return null
}


/**
 * Acha o array de registros dentro do envelope da resposta.
 *
 * A MemberClass chegou à página 50 gravando ZERO linhas: `pagination.hasNextPage`
 * dizia `true` (então o laço seguia) mas o array de alunos não estava em nenhuma
 * das chaves que a lista conhecia. Uma lista fixa de chaves não sobrevive a uma
 * API que ninguém documentou: se nenhuma bater, vale o primeiro array de objetos
 * que existir no corpo.
 */
// deno-lint-ignore no-explicit-any
function corpoLista(corpo: any): any[] {
  if (Array.isArray(corpo)) return corpo
  for (const chave of ['data', 'items', 'users', 'leads', 'students', 'alunos',
                       'results', 'records', 'report', 'rows', 'content']) {
    if (Array.isArray(corpo?.[chave])) return corpo[chave]
  }
  if (corpo && typeof corpo === 'object') {
    for (const valor of Object.values(corpo)) {
      if (Array.isArray(valor) && (valor.length === 0 || typeof valor[0] === 'object')) {
        return valor as any[]
      }
    }
  }
  return []
}

/**
 * Página 1 que responde 200 e não produz um registro sequer é envelope
 * desconhecido, não base vazia. Falhar aqui, dizendo QUAIS chaves vieram, custa
 * uma execução; seguir em silêncio custou 50 páginas e um espelho vazio.
 */
// deno-lint-ignore no-explicit-any
function exigirRegistros(n: number, registros: Registro[], corpo: any, rotulo: string) {
  if (n > 1 || registros.length > 0) return
  const chaves = corpo && typeof corpo === 'object' ? Object.keys(corpo).join(', ') : typeof corpo
  throw new Error(
    `${rotulo}: a fonte respondeu 200 mas nenhum registro foi reconhecido na página 1. ` +
    `Chaves do corpo: ${chaves}`,
  )
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

    const r = await buscarComRecuo(
      url, { headers: { Accept: 'application/json' } }, 'memberkit users')

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

    exigirRegistros(n, registros, corpo, 'memberkit users')

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
  // 200 ms levou a 429 na página 50. O tenant tem ~25 mil alunos (~252 páginas):
  // é a fonte mais longa das três, e a que mais precisa ir devagar.
  pausaMs: 700,

  async pagina(n, ctx) {
    const r = await buscarComRecuo(
      `${ctx.baseUrl}/api/v1/student/report?page=${n}&limit=100`,
      { headers: { 'x-api-key': ctx.credencial, Accept: 'application/json' } },
      'memberclass student/report',
    )

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

    exigirRegistros(n, registros, corpo, 'memberclass student/report')

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
    const r = await buscarComRecuo(
      `${ctx.baseUrl}/api/v1/lead/project?page=${n}`,
      { headers: { Authorization: `Bearer ${ctx.credencial}`, Accept: 'application/json' } },
      'sellflux lead/project',
    )

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

    exigirRegistros(n, registros, corpo, 'sellflux lead/project')

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
