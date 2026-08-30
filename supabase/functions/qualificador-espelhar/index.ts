// Qualificador de Leads ROI · Tarefa 0-B · espelhamento de fonte
//
// POST { fonte, pagina_inicial?, execucao_id?, reconciliar? }
//   fonte: memberkit | memberclass | sellflux
//
// Espelha a fonte INTEIRA em qualificador.espelho_<fonte> e, ao terminar a última
// página, reconcilia em SQL. Substitui o laço "uma chamada HTTP por pessoa" dos
// adaptadores memberkit.ts / memberclass.ts / sellflux.ts.
//
// Custo antes x depois:
//   memberkit   1.293 chamadas / ~11 min  ->  ~29 chamadas / ~15 s
//   memberclass 3+ chamadas por pessoa    ->  1 chamada por 100 alunos
//   sellflux    1-2 chamadas por pessoa   ->  total_pages chamadas
//
// A linha de execução nasce ANTES da primeira página e só é fechada no fim:
// nenhum botão pode ficar "Sincronizando…" sem linha correspondente no banco.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import postgres from 'npm:postgres@3.4.5'
import { FONTES, dormir, type Registro } from './fontes.ts'

/** Depois disso a função re-invoca a si mesma: o teto do worker é bem menor que o da fonte. */
const ORCAMENTO_MS = 60_000
const MAX_PAGINAS_POR_INVOCACAO = 400

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

  // Autenticação: sessão de usuário OU o segredo do cron.
  //
  // O cron não tem sessão — ele é o próprio servidor. A alternativa seria criar
  // um usuário de serviço em `user_profiles`, mas aí ele existiria também para o
  // app, e uma credencial de robô que serve de login é exatamente o tipo de
  // porta que ninguém lembra de fechar. O segredo vive só no vault: quem
  // consegue lê-lo já tem acesso ao banco.
  const segredoCron = req.headers.get('x-cron-secret')
  const autorizacao = req.headers.get('Authorization')
  if (!segredoCron && !autorizacao) {
    return responder({ erro: 'Cabeçalho Authorization ausente' }, 401)
  }

  let user: { id: string } | null = null
  if (!segredoCron) {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: autorizacao! } } },
    )
    const { data, error: erroAuth } = await supabase.auth.getUser()
    if (erroAuth || !data.user) return responder({ erro: 'Sessão inválida' }, 401)
    user = data.user
  }

  let corpo: {
    fonte?: string
    pagina_inicial?: number
    execucao_id?: number
    /** false pula a reconciliação -- só para depurar o espelho isolado */
    reconciliar?: boolean
  }
  try {
    corpo = await req.json()
  } catch {
    return responder({ erro: 'Corpo da requisição não é JSON' }, 400)
  }

  const slug = corpo.fonte?.trim() ?? ''
  const fonte = FONTES[slug]
  if (!fonte) {
    return responder(
      { erro: `Fonte sem espelho: "${slug}"`, disponiveis: Object.keys(FONTES) },
      400,
    )
  }

  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1 })
  const inicio = Date.now()
  let execucaoId: number | null = corpo.execucao_id ?? null
  let paginaAtual = Math.max(corpo.pagina_inicial ?? 1, 1)

  try {
    if (segredoCron) {
      // o segredo só é conferido aqui, onde já existe conexão com o banco.
      // Comparação de tamanho fixo (64 hex), gerado por gen_random_bytes.
      const [s] = await sql`
        select decrypted_secret from vault.decrypted_secrets
         where name = 'qualificador_cron_secret'`
      if (!s?.decrypted_secret || s.decrypted_secret !== segredoCron) {
        return responder({ erro: 'Segredo do cron inválido' }, 401)
      }
    } else {
      // papel mínimo: operador
      const [perfil] = await sql`
        select papel::text from qualificador.user_profiles where user_id = ${user!.id}::uuid`
      if (!perfil || !['operador', 'gestao'].includes(perfil.papel)) {
        return responder(
          { erro: 'Espelhar exige papel operador ou gestao', papel: perfil?.papel ?? null },
          403,
        )
      }
    }

    // O cron não encadeia respostas: `pg_net` dispara e esquece. Então, quando a
    // chamada vem do cron sem página explícita, o ponto de retomada vem do
    // banco. Sem isto, cada disparo do cron recomeçaria da página 1 — e como a
    // primeira invocação APAGA o espelho, a fonte nunca terminaria de espelhar.
    if (segredoCron && corpo.pagina_inicial === undefined) {
      const [r] = await sql`select * from qualificador.espelho_retomar(${slug})`
      if (r?.pagina > 1 && r?.execucao_id) {
        paginaAtual = Number(r.pagina)
        execucaoId = Number(r.execucao_id)
        corpo.pagina_inicial = paginaAtual
      }
    }

    const [integracao] = await sql`
      select base_url, coalesce(config, '{}'::jsonb) as config, ativa
      from qualificador.integracao where slug = ${slug}`
    if (!integracao) return responder({ erro: `Integração "${slug}" não cadastrada` }, 404)
    if (!integracao.ativa) {
      return responder({ erro: `Integração "${slug}" inativa — grave a credencial primeiro` }, 409)
    }

    const [{ credencial_ler: credencial }] = await sql`
      select qualificador.credencial_ler(${slug}) as credencial_ler`

    const ctx = {
      credencial,
      baseUrl: integracao.base_url ?? '',
      config: integracao.config as Record<string, unknown>,
    }

    // a linha de log nasce antes da rede: se o worker morrer, sobra o rastro
    if (execucaoId === null) {
      const [linha] = await sql`
        select qualificador.registrar_execucao(
          ${slug}, 'espelhar', 'em_andamento', null, null, null) as id`
      execucaoId = Number(linha.id)
      await sql`delete from qualificador.${sql(fonte.tabela)}`  // espelho é foto, não histórico
    }

    // fora do try do laço: se a página N estourar, o erro precisa dizer QUAL foi,
    // porque o espelho já tem as N-1 anteriores e a retomada parte daí
    let pagina = Math.max(corpo.pagina_inicial ?? 1, 1)
    let gravados = 0
    let chamadas = 0
    let total: number | null = null
    let paginasNestaInvocacao = 0

    for (;;) {
      paginaAtual = pagina
      const p = await fonte.pagina(pagina, ctx)
      chamadas += p.chamadas
      paginasNestaInvocacao++
      if (p.total !== null) total = p.total

      // Critério de aceite 2: totalCount 0 na primeira página é chave de outro
      // tenant, não base vazia. Parar aqui vale mais que espelhar nada em silêncio.
      if (pagina === 1 && total === 0) {
        const msg = `${slug}: a fonte declarou 0 registros no total — ` +
          `credencial provavelmente de outro tenant`
        await sql`select qualificador.finalizar_execucao(
          ${execucaoId}, 'erro', 0, ${Date.now() - inicio}, ${msg})`
        return responder({ fonte: slug, status: 'erro', total: 0, erro: msg }, 200)
      }

      if (p.registros.length) {
        await gravarPagina(sql, fonte.tabela, p.registros)
        gravados += p.registros.length
      }

      // Página vazia com a fonte dizendo que há mais: foi assim que a MemberClass
      // percorreu 50 páginas sem gravar nada. Página sem registro é o fim, mesmo
      // que hasNextPage insista no contrário.
      const acabou = p.proxima === null || p.registros.length === 0

      if (acabou) {
        // ------------------------------------------------------ fim: reconcilia
        const [{ n: linhasEspelho }] = await sql`
          select count(*)::int as n from qualificador.${sql(fonte.tabela)}`

        let casamento: { casou_por: string; pessoas: number }[] = []
        if (corpo.reconciliar !== false) {
          casamento = await sql`select * from qualificador.reconciliar(${slug})`
        }

        const resumo = casamento.map((c) => `${c.casou_por}=${c.pessoas}`).join(' ')
        await sql`select qualificador.finalizar_execucao(
          ${execucaoId}, 'ok', ${linhasEspelho}, ${Date.now() - inicio},
          ${resumo ? `casou_por: ${resumo}` : null})`

        if (segredoCron) {
          await sql`select qualificador.espelho_marcar(${slug}, 1, null, true)`
        }

        return responder({
          fonte: slug,
          status: 'concluido',
          total_declarado: total,
          linhas_espelho: linhasEspelho,
          paginas: pagina,
          chamadas_http: chamadas,
          casamento,
          duracao_ms: Date.now() - inicio,
        })
      }

      pagina = p.proxima!

      // ------------------------------------------------------ orçamento do worker
      //
      // A função NÃO se re-invoca. A primeira versão fazia isso E devolvia
      // `continua` ao front, que também retomava: dois ramos por vez, cada um se
      // duplicando. O log do projeto virou dezenas de `booted`/`shutdown` por
      // segundo, o pool de workers saturou e o `qualificador-sync` do HubSpot,
      // que não tinha nada a ver com isso, morreu com HTTP 546 (WORKER_LIMIT).
      //
      // Quem retoma é UM chamador só, de fora: o front, mostrando a página na
      // tela, ou o cron, lendo `espelho_progresso`. Nunca a própria função.
      if (Date.now() - inicio > ORCAMENTO_MS || paginasNestaInvocacao >= MAX_PAGINAS_POR_INVOCACAO) {
        if (segredoCron) {
          await sql`select qualificador.espelho_marcar(
            ${slug}, ${pagina}, ${execucaoId}, false)`
        }
        return responder({
          fonte: slug,
          status: 'continua',
          pagina,
          execucao_id: execucaoId,
          gravados_ate_aqui: gravados,
          chamadas_http: chamadas,
        })
      }

      await dormir(fonte.pausaMs)
    }
  } catch (e) {
    const mensagem = String((e as Error)?.message ?? e) +
      (paginaAtual > 1 ? ` (página ${paginaAtual}; as anteriores já estão no espelho)` : '')
    try {
      if (execucaoId !== null) {
        await sql`select qualificador.finalizar_execucao(
          ${execucaoId}, 'erro', null, ${Date.now() - inicio}, ${mensagem})`
      } else {
        await sql`select qualificador.registrar_execucao(
          ${slug}, 'espelhar', 'erro', null, ${Date.now() - inicio}, ${mensagem})`
      }
      if (segredoCron) {
        // deixa o progresso onde parou, mas com o relógio parado: se a próxima
        // rodada vier dentro do teto, retoma; se não, recomeça limpo
        await sql`select qualificador.espelho_marcar(
          ${slug}, ${paginaAtual}, ${execucaoId}, false)`
      }
    } catch { /* o log não pode mascarar o erro original */ }
    return responder({ erro: mensagem, fonte: slug }, 500)
  } finally {
    await sql.end()
  }
})

/**
 * Uma página inteira num insert só. Nunca uma transação por registro -- foi isso
 * que fez a sincronização antiga levar minutos.
 *
 * `sql.json(payload)`, nunca JSON.stringify: com stringify o driver serializa
 * duas vezes e a coluna guarda uma STRING de JSON, não um objeto -- aí todo
 * `payload ->> 'campo'` vira null e a reconciliação casa zero.
 */
async function gravarPagina(
  // deno-lint-ignore no-explicit-any
  sql: any,
  tabela: string,
  registros: Registro[],
): Promise<void> {
  const fatia = registros.map((r) => ({
    externo_id: r.externo_id,
    chave_email: r.chave_email,
    chave_documento: r.chave_documento,
    chave_telefone: r.chave_telefone,
    payload: sql.json(r.payload),
  }))

  await sql`
    insert into qualificador.${sql(tabela)} ${
      sql(fatia, 'externo_id', 'chave_email', 'chave_documento', 'chave_telefone', 'payload')
    }
    on conflict (externo_id) do update set
      chave_email     = excluded.chave_email,
      chave_documento = excluded.chave_documento,
      chave_telefone  = excluded.chave_telefone,
      payload         = excluded.payload,
      coletado_em     = now()`
}
