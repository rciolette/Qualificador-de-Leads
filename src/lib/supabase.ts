import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anon) {
  throw new Error(
    'VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórias. Copie .env.example para .env.',
  )
}

/**
 * Cliente do projeto compartilhado (Gerador de Links + Dashboard + Qualificador).
 *
 * `db.schema` fixa `qualificador` em toda leitura: o app nunca toca em `public`
 * nem em `dash`. O que precisar de fora vem pelas views `v_ext_*`, que moram
 * dentro do nosso schema.
 *
 * Requisito de infra: `qualificador` precisa estar na lista de schemas expostos
 * do PostgREST (Settings → API → Exposed schemas), do mesmo jeito que `dash` já
 * está. Sem isso o PostgREST responde PGRST106 "Invalid schema".
 */
export const supabase = createClient(url, anon, {
  db: { schema: 'qualificador' },
  auth: { persistSession: true, autoRefreshToken: true },
})

export const FUNCTIONS_URL = `${url}/functions/v1`
