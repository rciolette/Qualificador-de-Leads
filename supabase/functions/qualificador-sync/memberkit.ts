// Adaptador MemberKit — consulta por e-mail, uma pessoa por vez.
//
// GET /api/v1/users/{email}?api_key=… aceita e-mail direto no path, então o app
// nunca enumera a base (PRD anexo D: find_members tem teto de 50 e filtro de data
// não confiável — aqui não usamos nenhum dos dois).
//
// Dois desvios do PRD 8.3, conferidos na documentação oficial em 26/08/2026:
//   · a chave vai em QUERY STRING (api_key), não em header — por isso nenhuma
//     mensagem de erro deste arquivo pode conter a URL;
//   · a resposta TEM cpf_cnpj e phone_number. O PRD afirma que não tem e conclui
//     que "se o e-mail divergir, a pessoa some". Existe segunda chave: guardamos
//     documento e telefone em pessoa_identificador.
//
// Rate limit documentado: 120 requisições por minuto.

import {
  Adaptador, Alvo, Contexto, Gravacao, Resultado,
  buscar, dormir, normDocumento, normTelefone,
} from './contrato.ts'

interface Matricula {
  id: number
  status: string
  course_id?: number
  classroom_id?: number
  expire_date?: string | null
}

interface Assinatura {
  id: number
  status: string
  membership_level_id: number
  expire_date?: string | null
}

interface MembroMk {
  id: number
  full_name?: string
  email?: string
  blocked?: boolean
  unlimited?: boolean
  sign_in_count?: number
  current_sign_in_at?: string | null
  created_at?: string | null
  updated_at?: string | null
  cpf_cnpj?: string | null
  phone_local_code?: string | null
  phone_number?: string | null
  enrollments?: Matricula[]
  memberships?: Assinatura[]
}

const RATE_LIMITE_MIN = 120
const INTERVALO_MS = Math.ceil(60_000 / RATE_LIMITE_MIN) // ~500ms entre chamadas

export const memberkit: Adaptador = {
  slug: 'memberkit',

  async sincronizar(alvos: Alvo[], ctx: Contexto): Promise<Resultado> {
    const niveis = (ctx.config.niveis ?? {}) as {
      tier_lead?: Record<string, string>
      produto_pago?: Record<string, string>
      trilha_progressao?: Record<string, string>
    }
    const nomeDoNivel = (id: number | string): string | null =>
      niveis.tier_lead?.[String(id)] ??
      niveis.produto_pago?.[String(id)] ??
      niveis.trilha_progressao?.[String(id)] ??
      null

    const gravacoes: Gravacao[] = []
    const avisos: string[] = []
    let chamadas = 0
    let encontrados = 0

    for (const alvo of alvos) {
      // a chave viaja na query string: nunca logar nem ecoar esta URL
      const url = `${ctx.baseUrl}/users/${encodeURIComponent(alvo.email)}` +
        `?api_key=${encodeURIComponent(ctx.credencial)}`

      let membro: MembroMk | null = null
      try {
        const r = await fetch(url, { headers: { Accept: 'application/json' } })
        chamadas++
        if (r.status === 404) {
          await dormir(INTERVALO_MS)
          continue // não está na academia — silêncio é resposta válida
        }
        if (r.status === 429) {
          const espera = Number(r.headers.get('Retry-After')) * 1000 || 5000
          await dormir(espera)
          const r2 = await buscar(url, { headers: { Accept: 'application/json' } }, 'memberkit users')
          chamadas++
          membro = await r2.json()
        } else if (!r.ok) {
          avisos.push(`memberkit ${alvo.email}: HTTP ${r.status}`)
          await dormir(INTERVALO_MS)
          continue
        } else {
          membro = await r.json()
        }
      } catch (e) {
        // a mensagem do fetch pode carregar a URL, e a URL carrega a chave
        avisos.push(`memberkit ${alvo.email}: falha de rede`)
        void e
        await dormir(INTERVALO_MS)
        continue
      }

      if (!membro || !membro.id) {
        await dormir(INTERVALO_MS)
        continue
      }
      encontrados++

      const assinaturasAtivas = (membro.memberships ?? []).filter((m) => m.status === 'active')
      const nomes = assinaturasAtivas
        .map((m) => nomeDoNivel(m.membership_level_id) ?? String(m.membership_level_id))

      // O anexo C mistura tier de lead com produto pago numa lista só.
      // Produto pago é prova de operação em andamento; tier é perfil.
      // São dois atributos, nunca a mesma coluna.
      const tiers = assinaturasAtivas
        .filter((m) => niveis.tier_lead?.[String(m.membership_level_id)])
        .map((m) => niveis.tier_lead![String(m.membership_level_id)])
      const pagos = assinaturasAtivas
        .filter((m) => niveis.produto_pago?.[String(m.membership_level_id)])
        .map((m) => niveis.produto_pago![String(m.membership_level_id)])
      const trilha = assinaturasAtivas
        .filter((m) => niveis.trilha_progressao?.[String(m.membership_level_id)])
        .map((m) => niveis.trilha_progressao![String(m.membership_level_id)])

      const matriculasAtivas = (membro.enrollments ?? []).filter((e) => e.status === 'active')

      gravacoes.push({
        tabela: 'engajamento',
        pessoa_id: alvo.pessoa_id,
        plataforma: 'memberkit',
        // a API de membro não devolve contagem de aulas concluídas
        aulas_concluidas: null,
        ultimo_acesso: membro.current_sign_in_at
          ? new Date(membro.current_sign_in_at).toISOString().slice(0, 10)
          : null,
        cadastro: membro.created_at
          ? new Date(membro.created_at).toISOString().slice(0, 10)
          : null,
        niveis: nomes.length ? nomes : null,
        dados: {
          memberkit_id: membro.id,
          nome: membro.full_name ?? null,
          bloqueado: membro.blocked ?? null,
          ilimitado: membro.unlimited ?? null,
          logins: membro.sign_in_count ?? null,
          atualizado_em: membro.updated_at ?? null,
          tier_lead: tiers,
          produto_pago: pagos,
          trilha_progressao: trilha,
          tem_produto_pago: pagos.length > 0,
          cursos_ativos: matriculasAtivas.length,
          assinaturas: assinaturasAtivas.map((m) => ({
            nivel_id: m.membership_level_id,
            nivel: nomeDoNivel(m.membership_level_id),
            expira_em: m.expire_date ?? null,
          })),
        },
      })

      // a segunda chave que o PRD dá como inexistente
      const doc = normDocumento(membro.cpf_cnpj)
      if (doc) {
        gravacoes.push({
          tabela: 'pessoa_identificador',
          pessoa_id: alvo.pessoa_id,
          tipo: 'documento',
          valor: doc,
          fonte: 'memberkit',
        })
      }
      const tel = normTelefone(
        `${membro.phone_local_code ?? ''}${membro.phone_number ?? ''}`,
      )
      if (tel) {
        gravacoes.push({
          tabela: 'pessoa_identificador',
          pessoa_id: alvo.pessoa_id,
          tipo: 'telefone',
          valor: tel,
          fonte: 'memberkit',
        })
      }

      await dormir(INTERVALO_MS)
    }

    return { encontrados, chamadas, gravacoes, avisos }
  },
}
