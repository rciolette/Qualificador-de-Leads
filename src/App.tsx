import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { supabaseConfigurado } from '@/lib/supabase'
import { AppShell } from '@/components/AppShell'
import { LoginPage } from '@/pages/LoginPage'
import { IntegracoesPage } from '@/pages/IntegracoesPage'
import { CatalogoPage } from '@/pages/CatalogoPage'
import { SaudePage } from '@/pages/SaudePage'

import { IniciativasPage } from '@/pages/IniciativasPage'
import { FluxoPage } from '@/pages/FluxoPage'
import { ListasPage } from '@/pages/ListasPage'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } },
})

function Protegido() {
  const { user, carregando, semPapel, erroPapel } = useAuth()
  const local = useLocation()

  if (carregando) {
    return (
      <div className="flex min-h-screen items-center justify-center text-label text-muted-foreground">
        Carregando…
      </div>
    )
  }
  if (!user) {
    return <Navigate to="/entrar" replace state={{ de: local.pathname + local.search }} />
  }

  // o erro mais provável na primeira subida: o PostgREST ainda não expõe o schema
  if (erroPapel) {
    const ehSchema = erroPapel.includes('Invalid schema') || erroPapel.includes('PGRST106')
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle className="text-heading text-destructive">
              {ehSchema ? 'Schema não exposto na API' : 'Não foi possível verificar seu acesso'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-label text-muted-foreground">
            {ehSchema ? (
              <>
                <p>
                  Você está autenticado, mas o PostgREST não expõe o schema{' '}
                  <code>qualificador</code> — hoje expõe apenas <code>public</code>,{' '}
                  <code>graphql_public</code> e <code>dash</code>.
                </p>
                <p>
                  No painel do Supabase: <strong>Settings → API → Exposed schemas</strong>,
                  adicione <code>qualificador</code>. É o mesmo passo que o schema{' '}
                  <code>dash</code> já teve; nenhum schema existente sai da lista.
                </p>
              </>
            ) : (
              <p className="font-mono">{erroPapel}</p>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  // existe em auth, mas ninguém deu papel no Qualificador: RLS devolveria tudo vazio,
  // o que pareceria "sistema sem dados". Melhor dizer o que realmente aconteceu.
  if (semPapel) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-heading">Acesso ainda não liberado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-label text-muted-foreground">
            <p>
              Sua conta existe, mas ninguém lhe deu papel no Qualificador. O acesso aqui é
              separado do Gerador de Links — ter conta lá não dá acesso a este app.
            </p>
            <p>Peça a alguém com papel <strong>gestão</strong> para liberar.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return <AppShell />
}

/**
 * Sem as variáveis de ambiente o app não tem o que fazer — mas tem que dizer isso.
 * Erro no import derrubaria a página inteira e o usuário veria tela preta.
 */
function NaoConfigurado() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-heading">Aplicação não configurada</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-label text-muted-foreground">
          <p>
            Faltam <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> no
            build. Elas são embutidas no bundle em tempo de compilação, não lidas em runtime.
          </p>
          <p>
            Em desenvolvimento: copie <code>.env.example</code> para <code>.env</code>.
            No build de produção: os valores vêm de <code>.env.production</code>, que é
            versionado — as duas são públicas por design.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export default function App() {
  if (!supabaseConfigurado) return <NaoConfigurado />

  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/entrar" element={<LoginPage />} />
            <Route element={<Protegido />}>
              {/* o fluxo guiado é o caminho principal (docs/tarefa-2-fluxo-guiado.md) */}
              <Route index element={<Navigate to="/fluxo" replace />} />
              <Route path="/fluxo" element={<FluxoPage />} />
              {/* /importar e /iniciativas/nova eram as versões avulsas dos passos
                  1 e 2 do fluxo — mesmo upload, mesmo de-para, mesmo construtor
                  de etapas, mesmo motor. Duas UIs para o mesmo trabalho divergem:
                  o rascunho em sessionStorage, o desfazer e o aviso de cobertura
                  foram só para o fluxo, e quem entrasse pela porta antiga usava
                  uma versão pior sem saber. As rotas ficam de pé como redirect
                  porque já circularam em link colado. */}
              <Route path="/importar" element={<Navigate to="/fluxo" replace />} />
              <Route path="/integracoes" element={<IntegracoesPage />} />
              {/* A tarefa 3 pediu /saude-dos-dados; /saude fica de pé porque
                  já circulou em link colado. Mesma tela, um caminho canônico. */}
              <Route path="/saude-dos-dados" element={<SaudePage />} />
              <Route path="/saude" element={<Navigate to="/saude-dos-dados" replace />} />
              <Route path="/iniciativas" element={<IniciativasPage />} />
              <Route path="/iniciativas/nova" element={<Navigate to="/fluxo" replace />} />
              <Route path="/listas" element={<ListasPage />} />
              <Route path="/catalogo" element={<CatalogoPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/fluxo" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors closeButton />
      </AuthProvider>
    </QueryClientProvider>
  )
}
