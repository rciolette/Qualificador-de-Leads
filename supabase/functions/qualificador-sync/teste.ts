// Teste de conexão: uma chamada barata por fonte, que não depende de nenhum
// e-mail específico existir. Serve para separar três coisas que o sync mistura:
// credencial inválida, credencial válida sem permissão, e credencial boa cujo
// resultado é zero porque as pessoas não estão naquela base.

import type { Contexto } from './contrato.ts'

export interface Diagnostico {
  ok: boolean
  status: number | null
  titulo: string
  detalhe: string
  /** o que fazer, quando não está ok */
  acao?: string
}

const TEMPO_LIMITE = 15_000

async function chamar(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TEMPO_LIMITE)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

export async function testar(slug: string, ctx: Contexto): Promise<Diagnostico> {
  try {
    switch (slug) {
      case 'hubspot':     return await testarHubspot(ctx)
      case 'memberclass': return await testarMemberclass(ctx)
      case 'memberkit':   return await testarMemberkit(ctx)
      case 'sellflux':    return await testarSellflux(ctx)
      default:
        return { ok: false, status: null, titulo: 'Fonte sem teste',
                 detalhe: `Não há teste de conexão para "${slug}".` }
    }
  } catch (e) {
    const msg = (e as Error)?.name === 'AbortError'
      ? `A API não respondeu em ${TEMPO_LIMITE / 1000}s.`
      : `Falha de rede: ${(e as Error).message}`
    return { ok: false, status: null, titulo: 'Não foi possível alcançar a API', detalhe: msg }
  }
}

async function testarHubspot(ctx: Contexto): Promise<Diagnostico> {
  // endpoint mais barato que exige autenticação e o escopo de contatos
  const r = await chamar(`${ctx.baseUrl}/crm/v3/properties/contacts?limit=1`, {
    headers: { Authorization: `Bearer ${ctx.credencial}`, 'Content-Type': 'application/json' },
  })
  if (r.ok) {
    const d = await r.json().catch(() => ({}))
    return { ok: true, status: 200, titulo: 'HubSpot conectado',
             detalhe: `Portal respondeu com ${d.results?.length ?? 0} propriedade(s) de contato.` }
  }
  const corpo = await r.text().catch(() => '')

  // 401 e 403 têm causas diferentes e conselhos diferentes
  if (r.status === 401) {
    return { ok: false, status: 401, titulo: 'Token recusado pelo HubSpot',
      detalhe: 'O token tem o formato certo (pat-na1-…), mas o portal não o reconhece.',
      acao: 'O Private App foi apagado, o token foi revogado, ou ele pertence a outro portal. '
          + 'Em Settings → Integrations → Private Apps, gere um token novo e grave aqui.' }
  }
  if (r.status === 403) {
    return { ok: false, status: 403, titulo: 'Token sem os escopos necessários',
      detalhe: corpo.slice(0, 300),
      acao: 'No Private App, marque crm.objects.contacts.read e crm.objects.deals.read.' }
  }
  return { ok: false, status: r.status, titulo: `HubSpot respondeu ${r.status}`,
           detalhe: corpo.slice(0, 300) }
}

async function testarMemberclass(ctx: Contexto): Promise<Diagnostico> {
  // /student/report não filtra por pessoa: é o teste ideal, mostra o tenant inteiro
  const r = await chamar(`${ctx.baseUrl}/api/v1/student/report?page=1&limit=1`, {
    headers: { 'x-api-key': ctx.credencial, Accept: 'application/json' },
  })
  const corpo = await r.text().catch(() => '')
  if (r.ok) {
    let total: number | null = null
    try {
      const d = JSON.parse(corpo)
      total = d.totalCount ?? d.total ?? (Array.isArray(d) ? d.length : null)
    } catch { /* corpo não-JSON não invalida a conexão */ }
    return { ok: true, status: 200, titulo: 'MemberClass conectada',
      detalhe: total === null
        ? 'A chave autenticou.'
        : `A chave autenticou. O tenant tem ${total} aluno(s) no relatório.`,
      acao: total === 0
        ? 'O tenant está vazio: a chave é válida, mas aponta para uma base sem alunos. '
        + 'Confira se é a chave do produto certo.'
        : undefined }
  }
  if (r.status === 401 || r.status === 403) {
    return { ok: false, status: r.status, titulo: 'Chave recusada pela MemberClass',
             detalhe: corpo.slice(0, 300), acao: 'Gere uma nova chave mc_live_… e grave aqui.' }
  }
  return { ok: false, status: r.status, titulo: `MemberClass respondeu ${r.status}`,
           detalhe: corpo.slice(0, 300) }
}

async function testarMemberkit(ctx: Contexto): Promise<Diagnostico> {
  // a chave viaja na query string: nenhuma mensagem daqui pode conter a URL
  const r = await chamar(
    `${ctx.baseUrl}/membership_levels?api_key=${encodeURIComponent(ctx.credencial)}`,
    { headers: { Accept: 'application/json' } },
  )
  if (r.ok) {
    const d = await r.json().catch(() => []) as unknown[]
    return { ok: true, status: 200, titulo: 'MemberKit conectado',
             detalhe: `A chave autenticou. ${Array.isArray(d) ? d.length : 0} nível(is) de acesso na academia.` }
  }
  return { ok: false, status: r.status,
           titulo: r.status === 401 ? 'Chave recusada pelo MemberKit' : `MemberKit respondeu ${r.status}`,
           detalhe: 'A resposta não foi 200.',
           acao: r.status === 401 ? 'Gere uma nova chave de API no MemberKit e grave aqui.' : undefined }
}

async function testarSellflux(ctx: Contexto): Promise<Diagnostico> {
  // Armadilha circular: /crm/team/users é a rota que FORNECE o acting_user_id,
  // mas ela mesma é rota de CRM e o exige — responde 500 "Chave de API sem usuário".
  // Por isso o teste começa por /lead/project, que não é rota de CRM. É de lá que
  // sai o opt-out de WhatsApp, o único dado da Sellflux que a v1 realmente precisa.
  const r = await chamar(`${ctx.baseUrl}/api/v1/lead/project?page=1`, {
    headers: { Authorization: `Bearer ${ctx.credencial}`, Accept: 'application/json' },
  })
  const corpo = await r.text().catch(() => '')

  if (!r.ok) {
    return { ok: false, status: r.status,
      titulo: r.status === 401 ? 'Chave recusada pela Sellflux' : `Sellflux respondeu ${r.status}`,
      detalhe: corpo.slice(0, 300),
      acao: r.status === 401 ? 'Gere um novo token na Sellflux e grave aqui.' : undefined }
  }

  let leads = 0
  try {
    const d = JSON.parse(corpo)
    leads = (Array.isArray(d) ? d : d.data ?? d.leads ?? []).length
  } catch { /* corpo não-JSON não invalida a conexão */ }

  // acting_user_id é opcional: sem ele o opt-out funciona, só os tickets ficam de fora
  const configurado = (ctx.config.acting_user_id as string | undefined) ?? null
  let tickets = configurado
    ? 'acting_user_id configurado à mão — tickets disponíveis.'
    : 'Sem acting_user_id: o opt-out funciona, mas os tickets ficam de fora.'

  if (!configurado) {
    const u = await chamar(`${ctx.baseUrl}/api/v1/crm/team/users`, {
      headers: { Authorization: `Bearer ${ctx.credencial}`, Accept: 'application/json' },
    })
    if (u.ok) {
      const d = await u.json().catch(() => [])
      const lista = Array.isArray(d) ? d : d.data ?? d.users ?? []
      if (lista.length) tickets = `acting_user_id resolvido sozinho (${lista.length} usuário(s) no time).`
    }
  }

  return { ok: true, status: 200, titulo: 'Sellflux conectada',
    detalhe: `A chave autenticou e devolveu ${leads} lead(s) na primeira página. ${tickets}`,
    acao: configurado ? undefined
      : 'Para habilitar tickets, grave o sis_user do projeto em integracao.config.acting_user_id.' }
}
