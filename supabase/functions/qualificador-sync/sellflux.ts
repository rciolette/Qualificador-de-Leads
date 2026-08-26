// Adaptador Sellflux — SOMENTE LEITURA (PRD 4.1: a integração não escreve).
//
// É daqui que sai o opt-out de WhatsApp, um dos bloqueios duros do PRD 7.1.
//
// Restrições da API (PRD 8.2), todas respeitadas aqui:
//   · rotas de CRM com chave de API exigem acting_user_id, obtido em /crm/team/users
//   · /lead/project pagina de 30 em 30 e o filtro é `search`, não e-mail exato
//   · /crm/tickets tem limit máximo de 100 e o search varre os dados do lead
//   · não existe webhook nem leitura de mensagem: sincronização é polling
//   · rate limit não documentado — tratamos 429 com recuo e medimos as chamadas

import {
  Adaptador, Alvo, Contexto, Gravacao, Resultado,
  buscar, comoBooleano, dormir,
} from './contrato.ts'

interface LeadSf {
  id?: number | string
  email?: string
  unsub_whats?: unknown
  unsub_sms?: unknown
  unsub_call?: unknown
  tags?: unknown
  preferential_whats_id?: unknown
  updated_at?: string | null
}

/** acting_user_id é pré-requisito das rotas de CRM — resolvido uma vez por execução. */
async function resolverActingUser(ctx: Contexto, cabecalhos: HeadersInit): Promise<string | null> {
  try {
    const r = await buscar(
      `${ctx.baseUrl}/api/v1/crm/team/users`,
      { headers: cabecalhos },
      'sellflux crm/team/users',
    )
    const corpo = await r.json()
    const lista = Array.isArray(corpo) ? corpo : corpo.data ?? corpo.users ?? []
    return lista.length ? String(lista[0].id ?? lista[0].user_id) : null
  } catch {
    return null
  }
}

function comoLista(v: unknown): string[] | null {
  if (Array.isArray(v)) {
    return v.map((t) => (typeof t === 'string' ? t : String((t as Record<string, unknown>)?.name ?? t)))
  }
  if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean)
  return null
}

export const sellflux: Adaptador = {
  slug: 'sellflux',

  async sincronizar(alvos: Alvo[], ctx: Contexto): Promise<Resultado> {
    const cabecalhos = {
      Authorization: `Bearer ${ctx.credencial}`,
      Accept: 'application/json',
    }
    const gravacoes: Gravacao[] = []
    const avisos: string[] = []
    let chamadas = 0
    let encontrados = 0

    const conferirTickets = ctx.config.conferir_tickets === true
    let actingUserId: string | null = null
    if (conferirTickets) {
      actingUserId = await resolverActingUser(ctx, cabecalhos)
      chamadas++
      if (!actingUserId) {
        avisos.push('sellflux: acting_user_id não resolvido — tickets não conferidos neste lote')
      }
    }

    for (const alvo of alvos) {
      let lead: LeadSf | null = null
      try {
        const r = await buscar(
          `${ctx.baseUrl}/api/v1/lead/project?page=1&search=${encodeURIComponent(alvo.email)}`,
          { headers: cabecalhos },
          'sellflux lead/project',
        )
        chamadas++
        const corpo = await r.json()
        const lista = Array.isArray(corpo) ? corpo : corpo.data ?? corpo.leads ?? []
        // `search` é busca ampla: só aceitamos o lead cujo e-mail bate exatamente
        lead = lista.find(
          (l: LeadSf) => String(l.email ?? '').toLowerCase() === alvo.email.toLowerCase(),
        ) ?? null
      } catch (e) {
        avisos.push(`sellflux lead ${alvo.email}: ${(e as Error).message}`)
        continue
      }

      if (!lead) continue // não está na base de disparo
      encontrados++

      let ticketAberto: boolean | null = null
      if (conferirTickets && actingUserId) {
        try {
          const r = await buscar(
            `${ctx.baseUrl}/api/v1/crm/tickets?limit=100&acting_user_id=${actingUserId}` +
              `&search=${encodeURIComponent(alvo.email)}`,
            { headers: cabecalhos },
            'sellflux crm/tickets',
          )
          chamadas++
          const corpo = await r.json()
          const lista = Array.isArray(corpo) ? corpo : corpo.data ?? corpo.tickets ?? []
          ticketAberto = lista.some(
            (t: Record<string, unknown>) =>
              !['closed', 'archived', 'resolved'].includes(String(t.status ?? '').toLowerCase()),
          )
        } catch (e) {
          avisos.push(`sellflux tickets ${alvo.email}: ${(e as Error).message}`)
        }
        await dormir(150) // rate limit não documentado: ir devagar por escolha
      }

      gravacoes.push({
        tabela: 'saude_disparo',
        pessoa_id: alvo.pessoa_id,
        lead_id_sellflux: lead.id != null ? String(lead.id) : null,
        unsub_whats: comoBooleano(lead.unsub_whats),
        unsub_sms: comoBooleano(lead.unsub_sms),
        unsub_call: comoBooleano(lead.unsub_call),
        tags: comoLista(lead.tags),
        preferential_whats_id:
          lead.preferential_whats_id != null ? String(lead.preferential_whats_id) : null,
        ticket_aberto: ticketAberto,
        atualizado_em: lead.updated_at ?? null,
      })

      await dormir(150)
    }

    return { encontrados, chamadas, gravacoes, avisos }
  },
}
