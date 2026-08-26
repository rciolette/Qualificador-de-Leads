// Qualificador de Leads ROI · fase 2
// Grava a credencial de uma integração no Supabase Vault sob qualificador_<slug>.
//
// O token NUNCA é logado, nunca volta na resposta e nunca chega a uma tabela do schema.
// A autorização é dupla: o gateway exige JWT válido, e qualificador.credencial_salvar()
// só aceita quem tem papel 'gestao' em qualificador.user_profiles.
//
// POST { "slug": "hubspot", "token": "pat-na1-..." }
//   -> { slug, credencial_ref, mascara, substituida, gravada_em }

import { createClient } from 'jsr:@supabase/supabase-js@2'
import postgres from 'npm:postgres@3.4.5'

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

  let corpo: { slug?: string; token?: string }
  try {
    corpo = await req.json()
  } catch {
    return responder({ erro: 'Corpo da requisição não é JSON' }, 400)
  }

  const slug = corpo.slug?.trim()
  const token = corpo.token
  if (!slug || !token) return responder({ erro: 'Informe slug e token' }, 400)

  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1 })
  try {
    const [linha] = await sql`
      select qualificador.credencial_salvar(${user.id}::uuid, ${slug}, ${token}) as r
    `
    return responder(linha.r)
  } catch (e) {
    // a mensagem do Postgres nunca carrega o token — credencial_salvar só ecoa nome e máscara
    const mensagem = String((e as Error)?.message ?? e)
    const status = mensagem.includes('gestao')
      ? 403
      : mensagem.includes('não existe') || mensagem.includes('nao existe')
      ? 404
      : 400
    return responder({ erro: mensagem }, status)
  } finally {
    await sql.end()
  }
})
