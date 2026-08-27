import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function LoginPage() {
  const { user, entrar } = useAuth()
  const local = useLocation()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  // quem colou /listas e caiu aqui por não estar logado volta para /listas,
  // não para a home. O destino vem carimbado por `Protegido`.
  const destino = (local.state as { de?: string } | null)?.de ?? '/fluxo'
  if (user) return <Navigate to={destino} replace />

  async function aoEnviar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    setEnviando(true)
    try {
      await entrar(email.trim(), senha)
    } catch (err) {
      setErro(
        (err as Error).message.includes('Invalid login')
          ? 'E-mail ou senha incorretos.'
          : (err as Error).message,
      )
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="tracking-tight">Qualificador de Leads</CardTitle>
          <CardDescription>
            Mesma conta do Gerador de Links. O acesso ao Qualificador é liberado à parte.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={aoEnviar} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email" type="email" autoComplete="email" required
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@roiventures.com.br"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="senha">Senha</Label>
              <Input
                id="senha" type="password" autoComplete="current-password" required
                value={senha} onChange={(e) => setSenha(e.target.value)}
              />
            </div>

            {erro && (
              <p className="rounded-lg bg-destructive/15 px-3 py-2 text-label text-destructive">
                {erro}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={enviando}>
              {enviando ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
