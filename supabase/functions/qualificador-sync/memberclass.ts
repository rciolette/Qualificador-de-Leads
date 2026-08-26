// Adaptador MemberClass — REST direta, header x-api-key (PRD 8.4).
//
// Não há MCP para esta plataforma e o domínio api.memberclass.com.br é bloqueado
// no ambiente do agente, então este código só pode ser exercido a partir daqui.
// Os endpoints abaixo vêm da tabela do PRD 8.4 e ainda não foram vistos responder:
// a primeira execução real é o teste.
//
// Nenhum endpoint aceita id como filtro — todos filtram por email. Por isso
// id_da_memberclass serve para deduplicar, nunca para buscar.

import {
  Adaptador, Alvo, Contexto, Gravacao, Resultado,
  buscar, comoData,
} from './contrato.ts'

const LIMIT = 100 // o default da API é 10; o PRD manda subir sempre para 100

export const memberclass: Adaptador = {
  slug: 'memberclass',

  async sincronizar(alvos: Alvo[], ctx: Contexto): Promise<Resultado> {
    const cabecalhos = { 'x-api-key': ctx.credencial, Accept: 'application/json' }
    const gravacoes: Gravacao[] = []
    const avisos: string[] = []
    let chamadas = 0
    let encontrados = 0

    for (const alvo of alvos) {
      const q = `email=${encodeURIComponent(alvo.email)}&limit=${LIMIT}`

      let info: Record<string, unknown> | null = null
      try {
        const r = await buscar(
          `${ctx.baseUrl}/api/v1/user/informations?${q}&page=1`,
          { headers: cabecalhos },
          'memberclass user/informations',
        )
        chamadas++
        const corpo = await r.json()
        const lista = Array.isArray(corpo) ? corpo : corpo.data ?? corpo.items ?? []
        info = lista.find(
          (u: Record<string, unknown>) =>
            String(u.email ?? '').toLowerCase() === alvo.email.toLowerCase(),
        ) ?? null
      } catch (e) {
        avisos.push(`memberclass informations ${alvo.email}: ${(e as Error).message}`)
        continue
      }

      if (!info) continue // não tem conta na área de membros
      encontrados++

      // aulas concluídas: percorre a paginação real (hasNextPage), não o default de 10
      let aulas: number | null = null
      let ultimaAula: string | null = null
      try {
        let pagina = 1
        let total = 0
        for (;;) {
          const r = await buscar(
            `${ctx.baseUrl}/api/v1/user/lessons/completed?${q}&page=${pagina}`,
            { headers: cabecalhos },
            'memberclass lessons/completed',
          )
          chamadas++
          const corpo = await r.json()
          const itens = Array.isArray(corpo) ? corpo : corpo.data ?? corpo.items ?? []
          total += itens.length
          for (const it of itens) {
            const d = comoData((it as Record<string, unknown>).completedAt)
            if (d && (!ultimaAula || d > ultimaAula)) ultimaAula = d
          }
          const temMais = corpo.hasNextPage ??
            (corpo.totalPages ? pagina < Number(corpo.totalPages) : itens.length === LIMIT)
          if (!temMais || itens.length === 0) break
          pagina++
          if (pagina > 200) { avisos.push(`memberclass ${alvo.email}: paginação longa demais`); break }
        }
        aulas = total
      } catch (e) {
        avisos.push(`memberclass lessons ${alvo.email}: ${(e as Error).message}`)
      }

      // último acesso vem de dois lugares; o summary é o mais confiável
      let ultimoAcesso = comoData(info.lastAccess ?? info.ultimoAcesso)
      let cacheEm: unknown = null
      try {
        const r = await buscar(
          `${ctx.baseUrl}/api/v1/user/activity/summary?${q}`,
          { headers: cabecalhos },
          'memberclass activity/summary',
        )
        chamadas++
        const corpo = await r.json()
        const lista = Array.isArray(corpo) ? corpo : corpo.data ?? corpo.items ?? []
        const linha = lista.find(
          (u: Record<string, unknown>) =>
            String(u.email ?? '').toLowerCase() === alvo.email.toLowerCase(),
        )
        if (linha?.ultimoAcesso) ultimoAcesso = comoData(linha.ultimoAcesso) ?? ultimoAcesso
        // a API declara o próprio frescor — alimenta a métrica da camada 1
        cacheEm = corpo.cachedAt ?? null
      } catch (e) {
        avisos.push(`memberclass summary ${alvo.email}: ${(e as Error).message}`)
      }

      gravacoes.push({
        tabela: 'engajamento',
        pessoa_id: alvo.pessoa_id,
        plataforma: 'memberclass',
        aulas_concluidas: aulas,
        ultimo_acesso: ultimoAcesso,
        cadastro: comoData(info.data_cadastro ?? info.createdAt),
        niveis: Array.isArray(info.deliveries)
          ? (info.deliveries as unknown[]).map((d) =>
              typeof d === 'string' ? d : String((d as Record<string, unknown>).name ?? d),
            )
          : null,
        dados: {
          memberclass_id: info.userId ?? info.aluno_id ?? null,
          is_paid: info.isPaid ?? null,
          ultima_aula_em: ultimaAula,
          entregas: info.deliveries ?? null,
          cached_at: cacheEm,
        },
      })

      // id_da_memberclass: chave de deduplicação. A property homônima do HubSpot
      // existe mas está vazia (PRD anexo E) — guardamos do lado de cá.
      const idMc = info.userId ?? info.aluno_id
      if (idMc) {
        gravacoes.push({
          tabela: 'pessoa_identificador',
          pessoa_id: alvo.pessoa_id,
          tipo: 'memberclass_id',
          valor: String(idMc),
          fonte: 'memberclass',
        })
      }
    }

    return { encontrados, chamadas, gravacoes, avisos }
  },
}
