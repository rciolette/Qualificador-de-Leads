// Qualificador de Leads ROI · fase 2 · orquestrador de sincronização
//
// POST { fonte, limite?, max_idade_horas?, emails? }
//   fonte: hubspot | memberkit | memberclass | sellflux
//
// Fluxo: autentica o usuário (papel mínimo operador) -> lê a credencial do Vault
// -> escolhe os alvos mais desatualizados -> chama o adaptador -> grava o snapshot
// -> registra a execução. Falha em qualquer ponto vira linha de log com status erro.
//
// Toda escrita no banco acontece AQUI. Os adaptadores só devolvem dados.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import postgres from 'npm:postgres@3.4.5'
import type { Adaptador, Alvo, Gravacao } from './contrato.ts'
import { hubspot } from './hubspot.ts'
import { testar } from './teste.ts'

// Tarefa 0-B: memberkit, memberclass e sellflux SAÍRAM daqui. As três fontes são
// pequenas (a maior tem 1.433 registros) e perguntar uma pessoa por vez custava
// 1.293 chamadas HTTP por execução para não cruzar nada. Elas agora são espelhadas
// inteiras pela função `qualificador-espelhar` e cruzadas em SQL.
// O HubSpot continua aqui: é a única fonte grande demais para espelhar.
const ADAPTADORES: Record<string, Adaptador> = {
  hubspot: hubspot,
}

/** Fontes que migraram para o espelho. Só o teste de conexão continua passando por aqui. */
const ESPELHADAS = ['memberkit', 'memberclass', 'sellflux']

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return responder({ erro: 'Use POST' }, 405)

  const autorizacao = req.headers.get('Authorization')
  if (!autorizacao) return responder({ erro: 'Cabeçalho Authorization ausente' }, 401)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: autorizacao } } },
  )
  const { data: { user }, error: erroAuth } = await supabase.auth.getUser()
  if (erroAuth || !user) return responder({ erro: 'Sessão inválida' }, 401)

  let corpo: {
    fonte?: string; limite?: number; max_idade_horas?: number; emails?: string[]
    /** 'testar' só checa a credencial; não lê nem grava nada */
    acao?: 'sincronizar' | 'testar'
  }
  try {
    corpo = await req.json()
  } catch {
    return responder({ erro: 'Corpo da requisição não é JSON' }, 400)
  }

  const fonte = corpo.fonte?.trim() ?? ''
  // a validação da fonte acontece depois de ler a credencial: o teste de conexão
  // vale para as quatro fontes, mas sincronizar só vale para as que têm adaptador

  const limite = Math.min(Math.max(corpo.limite ?? 100, 1), 1000)
  const maxIdadeHoras = Math.max(corpo.max_idade_horas ?? 24, 0)

  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1 })
  const inicio = Date.now()

  try {
    // papel mínimo: operador
    const [perfil] = await sql`
      select papel::text from qualificador.user_profiles where user_id = ${user.id}::uuid`
    if (!perfil || !['operador', 'gestao'].includes(perfil.papel)) {
      return responder(
        { erro: 'Sincronizar exige papel operador ou gestao', papel: perfil?.papel ?? null },
        403,
      )
    }

    const [integracao] = await sql`
      select slug, base_url, coalesce(config, '{}'::jsonb) as config, ativa
      from qualificador.integracao where slug = ${fonte}`
    if (!integracao) return responder({ erro: `Integração "${fonte}" não cadastrada` }, 404)
    if (!integracao.ativa) {
      return responder({
        fonte, ok: false, status: null,
        titulo: 'Sem credencial',
        detalhe: `A integração "${fonte}" ainda não tem credencial gravada.`,
        acao: 'Grave o token no campo acima para habilitar teste e sincronização.',
        erro: `Integração "${fonte}" inativa — grave a credencial primeiro`,
      }, corpo.acao === 'testar' ? 200 : 409)
    }

    const [{ credencial_ler: credencial }] = await sql`
      select qualificador.credencial_ler(${fonte}) as credencial_ler`

    // Teste de conexão: uma chamada barata, sem tocar em pessoa nem em snapshot.
    // Separa "credencial inválida" de "credencial boa e resultado zero".
    if (corpo.acao === 'testar') {
      const d = await testar(fonte, {
        credencial,
        baseUrl: integracao.base_url ?? '',
        config: integracao.config,
        lote: 1,
      })
      await sql`select qualificador.registrar_execucao(
        ${fonte}, 'testar', ${d.ok ? 'ok' : 'erro'}, null, ${Date.now() - inicio},
        ${d.ok ? null : `${d.titulo}: ${d.detalhe}`})`
      return responder({ fonte, ...d }, d.ok ? 200 : 200)  // 200 sempre: o diagnóstico É a resposta
    }

    const adaptador = ADAPTADORES[fonte]
    if (!adaptador) {
      if (ESPELHADAS.includes(fonte)) {
        return responder({
          erro: `"${fonte}" não sincroniza mais por aqui — use a função qualificador-espelhar`,
          motivo: 'A fonte é pequena: espelhar tudo e cruzar em SQL custa menos que ' +
            'uma chamada HTTP por pessoa.',
          funcao: 'qualificador-espelhar',
        }, 409)
      }
      return responder(
        { erro: `Fonte desconhecida: "${fonte}"`, disponiveis: Object.keys(ADAPTADORES) },
        400,
      )
    }

    // alvos: os pedidos explicitamente, ou os mais desatualizados
    const alvos: Alvo[] = corpo.emails?.length
      ? (await sql<Alvo[]>`
          select id as pessoa_id, email from qualificador.pessoa
          where email = any(${corpo.emails.map((e) => e.trim().toLowerCase())})`)
      : (await sql<Alvo[]>`
          select pessoa_id, email
          from qualificador.pessoas_para_sync(${fonte}, ${limite}, ${maxIdadeHoras})`)

    if (alvos.length === 0) {
      await sql`select qualificador.registrar_execucao(
        ${fonte}, 'sync', 'ok', 0, ${Date.now() - inicio}, null)`
      return responder({ fonte, alvos: 0, mensagem: 'Nada a sincronizar nesta janela' })
    }

    const resultado = await adaptador.sincronizar(alvos, {
      credencial,
      baseUrl: integracao.base_url ?? '',
      config: integracao.config,
      lote: Number(integracao.config.lote_batch_read ?? 100),
    })

    const gravadas = await gravar(sql, resultado.gravacoes)

    // "procurei e não achei" também é resposta, e precisa ser gravada: sem isso
    // quem não existe na fonte volta para a fila em toda rodada, para sempre.
    // Medido no HubSpot: um lote de 100 achava 44, e as outras 56 reapareciam.
    const idsEncontrados = [
      ...new Set(
        resultado.gravacoes
          .filter((g) => g.tabela === 'crm_snapshot')
          .map((g) => g.pessoa_id),
      ),
    ]
    await sql`select qualificador.registrar_tentativas(
      ${fonte},
      ${alvos.map((a) => a.pessoa_id)}::uuid[],
      ${idsEncontrados}::uuid[])`

    const duracao = Date.now() - inicio
    await sql`select qualificador.registrar_execucao(
      ${fonte}, 'sync', 'ok', ${resultado.encontrados}, ${duracao},
      ${resultado.avisos.length ? resultado.avisos.slice(0, 20).join(' | ') : null})`

    return responder({
      fonte,
      alvos: alvos.length,
      encontrados: resultado.encontrados,
      // o PRD manda conferir declarado x recebido: a diferença é explícita
      nao_encontrados: alvos.length - resultado.encontrados,
      // essas saem da fila pelo mesmo prazo: foram procuradas, não estão lá
      marcadas_ausentes: alvos.length - idsEncontrados.length,
      chamadas_http: resultado.chamadas,
      gravadas,
      duracao_ms: duracao,
      avisos: resultado.avisos.slice(0, 20),
    })
  } catch (e) {
    const mensagem = String((e as Error)?.message ?? e)
    try {
      await sql`select qualificador.registrar_execucao(
        ${fonte}, 'sync', 'erro', null, ${Date.now() - inicio}, ${mensagem})`
    } catch { /* o log não pode mascarar o erro original */ }
    return responder({ erro: mensagem, fonte }, 500)
  } finally {
    await sql.end()
  }
})

/**
 * Grava os snapshots.
 *
 * UMA transação para o lote inteiro, não uma por pessoa. A versão anterior
 * abria `sql.begin()` por pessoa — com lote de 100, eram 100 round-trips em
 * série ao Postgres, e a Edge Function estourava com HTTP 546
 * (WORKER_RESOURCE_LIMIT) antes de terminar. Não era memória: medido, o
 * payload é 1,7 KB por pessoa e 3,4 negócios em média. Era o vai-e-vem.
 *
 * A garantia da fase 2 — "falha no meio não deixa metade de um snapshot" —
 * continua valendo, e mais forte: agora o lote inteiro é atômico.
 */
async function gravar(
  // deno-lint-ignore no-explicit-any
  sql: any,
  gravacoes: Gravacao[],
): Promise<Record<string, number>> {
  const contagem: Record<string, number> = {}
  const porPessoa = new Map<string, Gravacao[]>()
  for (const g of gravacoes) {
    const atual = porPessoa.get(g.pessoa_id) ?? []
    atual.push(g)
    porPessoa.set(g.pessoa_id, atual)
  }

  // deno-lint-ignore no-explicit-any
  await sql.begin(async (tx: any) => {
    for (const [, itens] of porPessoa) {
      for (const g of itens) {
        contagem[g.tabela] = (contagem[g.tabela] ?? 0) + 1
        switch (g.tabela) {
          case 'crm_snapshot':
            await tx`
              insert into qualificador.crm_snapshot (pessoa_id, classificacao_leadscore,
                leadscore, produtos_ativos, produtos_historico, econt, deals, disparo,
                props, props_deals, sync_em)
              values (${g.pessoa_id}::uuid, ${g.classificacao_leadscore}, ${g.leadscore},
                ${g.produtos_ativos}, ${g.produtos_historico},
                ${tx.json(g.econt)}, ${tx.json(g.deals)}, ${tx.json(g.disparo)},
                ${tx.json(g.props ?? {})}, ${tx.json(g.props_deals ?? {})}, now())
              on conflict (pessoa_id) do update set
                classificacao_leadscore = excluded.classificacao_leadscore,
                leadscore = excluded.leadscore,
                produtos_ativos = excluded.produtos_ativos,
                produtos_historico = excluded.produtos_historico,
                econt = excluded.econt, deals = excluded.deals,
                disparo = excluded.disparo, props = excluded.props,
                props_deals = excluded.props_deals, sync_em = excluded.sync_em`
            if (g.hubspot_id) {
              // o hubspot_id é unique: se já pertence a outra pessoa, não sobrescreve
              await tx`
                update qualificador.pessoa set hubspot_id = ${g.hubspot_id}
                where id = ${g.pessoa_id}::uuid
                  and hubspot_id is distinct from ${g.hubspot_id}
                  and not exists (select 1 from qualificador.pessoa p2
                                  where p2.hubspot_id = ${g.hubspot_id})`
            }
            break

          case 'engajamento':
            await tx`
              insert into qualificador.engajamento (pessoa_id, plataforma, aulas_concluidas,
                ultimo_acesso, cadastro, niveis, dados, coletado_em)
              values (${g.pessoa_id}::uuid, ${g.plataforma}::qualificador.area_membros,
                ${g.aulas_concluidas}, ${g.ultimo_acesso}::date, ${g.cadastro}::date,
                ${g.niveis}, ${tx.json(g.dados)}, now())
              on conflict (pessoa_id, plataforma) do update set
                aulas_concluidas = excluded.aulas_concluidas,
                ultimo_acesso = excluded.ultimo_acesso,
                cadastro = excluded.cadastro, niveis = excluded.niveis,
                dados = excluded.dados, coletado_em = excluded.coletado_em`
            break

          case 'saude_disparo':
            await tx`
              insert into qualificador.saude_disparo (pessoa_id, lead_id_sellflux, unsub_whats,
                unsub_sms, unsub_call, tags, preferential_whats_id, ticket_aberto,
                atualizado_em, coletado_em)
              values (${g.pessoa_id}::uuid, ${g.lead_id_sellflux}, ${g.unsub_whats},
                ${g.unsub_sms}, ${g.unsub_call}, ${g.tags}, ${g.preferential_whats_id},
                ${g.ticket_aberto}, ${g.atualizado_em}::timestamptz, now())
              on conflict (pessoa_id) do update set
                lead_id_sellflux = excluded.lead_id_sellflux,
                unsub_whats = excluded.unsub_whats, unsub_sms = excluded.unsub_sms,
                unsub_call = excluded.unsub_call, tags = excluded.tags,
                preferential_whats_id = excluded.preferential_whats_id,
                ticket_aberto = excluded.ticket_aberto,
                atualizado_em = excluded.atualizado_em, coletado_em = excluded.coletado_em`
            break

          case 'pessoa_identificador':
            // a chave é (tipo, valor_norm): o primeiro dono vence, ninguém rouba
            await tx`
              insert into qualificador.pessoa_identificador (pessoa_id, tipo, valor_norm, fonte)
              values (${g.pessoa_id}::uuid, ${g.tipo}::qualificador.tipo_identificador,
                ${g.valor}, ${g.fonte}::qualificador.fonte_dado)
              on conflict (tipo, valor_norm) do nothing`
            break
        }
      }
    }
  })
  return contagem
}
