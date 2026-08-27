import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { exigirSupabase } from '@/lib/supabase'
import { buscarPapel } from '@/lib/dados'
import { temPapelMinimo, type Papel } from '@/lib/tipos'

interface Auth {
  user: User | null
  session: Session | null
  papel: Papel | null
  carregando: boolean
  /** true quando o usuário existe em auth mas ninguém deu papel a ele no Qualificador */
  semPapel: boolean
  /** falha de infra ao ler o papel — não confundir com "não tem papel" */
  erroPapel: string | null
  pode: (minimo: Papel) => boolean
  entrar: (email: string, senha: string) => Promise<void>
  sair: () => Promise<void>
}

const Ctx = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [papel, setPapel] = useState<Papel | null>(null)
  const [erroPapel, setErroPapel] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  /** a primeira resposta de `getSession()` já chegou? */
  const [sessaoLida, setSessaoLida] = useState(false)

  useEffect(() => {
    let vivo = true

    // o listener é registrado antes do getSession para não perder o primeiro evento
    const { data: { subscription } } = exigirSupabase().auth.onAuthStateChange((_evento, s) => {
      if (!vivo) return
      setSession(s)
      if (!s) setPapel(null)
    })

    exigirSupabase().auth.getSession().then(({ data }) => {
      if (vivo) {
        setSession(data.session)
        setSessaoLida(true)
        if (!data.session) setCarregando(false)
      }
    })

    return () => { vivo = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    // Só é honesto dizer "terminei de carregar" depois que a primeira leitura de
    // sessão voltou. Antes disso `session` é null porque `getSession()` ainda não
    // respondeu — e não porque o usuário está deslogado. Declarar carregando=false
    // aí mandava quem colou um link para /entrar, e de lá para /integracoes:
    // todo deep link virava a home, em silêncio.
    if (!session?.user) {
      setPapel(null); setErroPapel(null)
      if (sessaoLida) setCarregando(false)
      return
    }
    let vivo = true
    setCarregando(true)
    buscarPapel(session.user.id)
      .then((p) => { if (vivo) { setPapel(p); setErroPapel(null) } })
      // ler o papel e falhar é diferente de ler e não achar: um é infra, o outro
      // é permissão. Confundir os dois manda o usuário resolver o problema errado.
      .catch((e: Error) => { if (vivo) { setPapel(null); setErroPapel(e.message) } })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [session?.user?.id, sessaoLida])

  const valor = useMemo<Auth>(() => ({
    user: session?.user ?? null,
    session,
    papel,
    carregando,
    erroPapel,
    semPapel: Boolean(session?.user) && !carregando && papel === null && erroPapel === null,
    pode: (minimo: Papel) => temPapelMinimo(papel, minimo),
    entrar: async (email, senha) => {
      const { error } = await exigirSupabase().auth.signInWithPassword({ email, password: senha })
      if (error) throw error
    },
    sair: async () => { await exigirSupabase().auth.signOut() },
  }), [session, papel, erroPapel, carregando])

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): Auth {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth precisa estar dentro de AuthProvider')
  return ctx
}
