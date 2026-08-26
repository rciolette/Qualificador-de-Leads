// Cliente Supabase — projeto qevnfgopjupsmwvflcza, schema `qualificador`.
//
// Se as variáveis faltarem, `supabase` fica null e a UI mostra "não configurado"
// em vez de quebrar. Mesmo padrão do Gerador de Links: um erro lançado aqui é um
// erro no import, e um erro no import derruba a página inteira antes de qualquer
// componente montar — o usuário vê tela preta e nenhuma pista do motivo.

import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigurado = Boolean(url && anonKey)

/**
 * `db.schema` fixa `qualificador` em toda leitura: o app nunca toca em `public`
 * nem em `dash`. O que precisar de fora vem pelas views `v_ext_*`, que moram
 * dentro do nosso schema.
 *
 * Requisito de infra: `qualificador` precisa estar na lista de schemas expostos
 * do PostgREST (Settings → API → Exposed schemas), como `dash` já está. Sem isso
 * o PostgREST responde PGRST106 "Invalid schema".
 */
function criarCliente() {
  return createClient(url!, anonKey!, {
    db: { schema: 'qualificador' },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: 'qualificador-leads-auth',
    },
  })
}

export type ClienteQualificador = ReturnType<typeof criarCliente>

export const supabase: ClienteQualificador | null = supabaseConfigurado ? criarCliente() : null

/** Uso interno: só chame depois de checar `supabaseConfigurado`. */
export function exigirSupabase(): ClienteQualificador {
  if (!supabase) {
    throw new Error(
      'Supabase não configurado — defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.',
    )
  }
  return supabase
}

export const FUNCTIONS_URL = url ? `${url}/functions/v1` : ''
