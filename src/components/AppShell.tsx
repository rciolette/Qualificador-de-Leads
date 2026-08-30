import { NavLink, Outlet } from 'react-router-dom'
import {
  Activity, ChevronDown, Database, ListChecks, LogOut, Plug, Route, Target,
} from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * O fluxo guiado é o caminho principal — é a jornada que o Raphael faz de
 * verdade: sobe a base, cruza, estreita, exporta. As telas antigas continuam
 * existindo, mas como peças avulsas: viraram "Avançado".
 */
const PRINCIPAL = { para: '/fluxo', rotulo: 'Montar uma lista', icone: Route }

// "Importar" saiu: era a mesma tela do passo 1 do fluxo. O que sobrou aqui não
// é caminho alternativo para montar lista — é o que o fluxo NÃO faz: conectar as
// plataformas, medir a saúde do dado, rebaixar uma lista antiga, ver o catálogo.
const AVANCADO = [
  { para: '/integracoes', rotulo: 'Integrações', icone: Plug },
  { para: '/saude-dos-dados', rotulo: 'Saúde dos dados', icone: Activity },
  { para: '/iniciativas', rotulo: 'Iniciativas', icone: Target },
  { para: '/listas', rotulo: 'Listas geradas', icone: ListChecks },
  { para: '/catalogo', rotulo: 'Catálogo', icone: Database },
]

const NAV = [PRINCIPAL, ...AVANCADO]

function MenuAvancado() {
  const [aberto, setAberto] = useState(false)
  return (
    <div className="relative" onMouseLeave={() => setAberto(false)}>
      <button
        onClick={() => setAberto(!aberto)}
        onMouseEnter={() => setAberto(true)}
        aria-expanded={aberto}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-label text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        Avançado
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </button>
      {aberto && (
        <div className="absolute left-0 top-full z-50 w-56 rounded-xl border border-border bg-background p-1 shadow-lg">
          {AVANCADO.map(({ para, rotulo, icone: Icone }) => (
            <NavLink
              key={para}
              to={para}
              onClick={() => setAberto(false)}
              className={({ isActive }) =>
                cn('flex items-center gap-2 rounded-lg px-3 py-2 text-label transition-colors',
                  isActive ? 'bg-muted text-foreground'
                           : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground')
              }
            >
              <Icone className="h-3.5 w-3.5" aria-hidden />
              {rotulo}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

export function AppShell() {
  const { user, papel, sair } = useAuth()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <div className="flex items-baseline gap-2">
            <span className="text-display tracking-tight">Qualificador</span>
            <span className="text-micro uppercase text-muted-foreground">ROI</span>
          </div>

          <nav className="hidden flex-1 items-center gap-1 md:flex">
            <NavLink
              to={PRINCIPAL.para}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-label transition-colors',
                  isActive
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-foreground hover:bg-muted/50',
                )
              }
            >
              <PRINCIPAL.icone className="h-3.5 w-3.5" aria-hidden />
              {PRINCIPAL.rotulo}
            </NavLink>

            <MenuAvancado />
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-label leading-tight">{user?.email}</div>
              <div className="text-micro uppercase text-muted-foreground">{papel ?? 'sem papel'}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={sair} aria-label="Sair">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto border-t border-border/60 px-4 py-2 md:hidden">
          {NAV.map(({ para, rotulo }) => (
            <NavLink
              key={para}
              to={para}
              className={({ isActive }) =>
                cn(
                  'whitespace-nowrap rounded-lg px-3 py-1.5 text-label',
                  isActive ? 'bg-muted text-foreground' : 'text-muted-foreground',
                )
              }
            >
              {rotulo}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  )
}

export function TituloPagina({ titulo, descricao, acao }: {
  titulo: string
  descricao?: string
  acao?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        {descricao && <p className="mt-1 max-w-2xl text-label text-muted-foreground">{descricao}</p>}
      </div>
      {acao}
    </div>
  )
}
