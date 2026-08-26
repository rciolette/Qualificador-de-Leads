import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { buscarPapel } from '@/lib/dados'
import { temPapelMinimo, type Papel } from '@/lib/tipos'

interface Auth {
  user: User | null
  session: Session | null
  papel: Papel | null
  carregando: boolean
  /** true quando o usuário existe em auth mas ninguém deu papel a ele no Qualificador */
  semPapel: boolean
  pode: (minimo: Papel) => boolean
  entrar: (email: string, senha: string) => Promise<void>
  sair: () => Promise<void>
}

const Ctx = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [papel, setPapel] = useState<Papel | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let vivo = true

    // o listener é registrado antes do getSession para não perder o primeiro evento
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_evento, s) => {
      if (!vivo) return
      setSession(s)
      if (!s) setPapel(null)
    })

    supabase.auth.getSession().then(({ data }) => {
      if (vivo) {
        setSession(data.session)
        if (!data.session) setCarregando(false)
      }
    })

    return () => { vivo = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!session?.user) { setPapel(null); setCarregando(false); return }
    let vivo = true
    setCarregando(true)
    buscarPapel(session.user.id)
      .then((p) => { if (vivo) setPapel(p) })
      .catch(() => { if (vivo) setPapel(null) })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [session?.user?.id])

  const valor = useMemo<Auth>(() => ({
    user: session?.user ?? null,
    session,
    papel,
    carregando,
    semPapel: Boolean(session?.user) && !carregando && papel === null,
    pode: (minimo: Papel) => temPapelMinimo(papel, minimo),
    entrar: async (email, senha) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
      if (error) throw error
    },
    sair: async () => { await supabase.auth.signOut() },
  }), [session, papel, carregando])

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): Auth {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth precisa estar dentro de AuthProvider')
  return ctx
}
