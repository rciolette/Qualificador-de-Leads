import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { AppShell } from '@/components/AppShell'
import { LoginPage } from '@/pages/LoginPage'
import { IntegracoesPage } from '@/pages/IntegracoesPage'
import { CatalogoPage } from '@/pages/CatalogoPage'
import { ImportarPage } from '@/pages/ImportarPage'
import { SaudePage } from '@/pages/SaudePage'
import { IniciativasPage } from '@/pages/IniciativasPage'
import { ListasPage } from '@/pages/ListasPage'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } },
})

function Protegido() {
  const { user, carregando, semPapel } = useAuth()

  if (carregando) {
    return (
      <div className="flex min-h-screen items-center justify-center text-label text-muted-foreground">
        Carregando…
      </div>
    )
  }
  if (!user) return <Navigate to="/entrar" replace />

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

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/entrar" element={<LoginPage />} />
            <Route element={<Protegido />}>
              <Route index element={<Navigate to="/integracoes" replace />} />
              <Route path="/importar" element={<ImportarPage />} />
              <Route path="/integracoes" element={<IntegracoesPage />} />
              <Route path="/saude" element={<SaudePage />} />
              <Route path="/iniciativas" element={<IniciativasPage />} />
              <Route path="/listas" element={<ListasPage />} />
              <Route path="/catalogo" element={<CatalogoPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/integracoes" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors closeButton />
      </AuthProvider>
    </QueryClientProvider>
  )
}
