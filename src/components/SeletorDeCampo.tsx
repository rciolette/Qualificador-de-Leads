import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import type { CampoFiltravel } from '@/lib/iniciativas'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/**
 * Escolhe um campo do catálogo, com busca.
 *
 * Era um `<Select>` com 55 itens agrupados: para achar "Origem de tráfego do
 * negócio" o usuário rolava a lista inteira, e três rótulos começam igual
 * ("Origem de tráfego · primeira", "· mais recente", "do negócio"). Digitar
 * duas letras resolve o que rolar não resolvia.
 *
 * A busca ignora acento e casa também com o nome interno da property — quem
 * chega da documentação do HubSpot procura por `origem_de_trafego`, não pelo
 * rótulo que demos a ele.
 */
export function SeletorDeCampo({
  campos, valor, aoEscolher, id,
}: {
  campos: CampoFiltravel[]
  /** `${fonte}|${caminho}` do campo atual, ou '' */
  valor: string
  aoEscolher: (campo: CampoFiltravel) => void
  id?: string
}) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const entrada = useRef<HTMLInputElement>(null)

  const escolhido = campos.find((c) => `${c.fonte}|${c.caminho}` === valor)

  const semAcento = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

  const filtrados = useMemo(() => {
    const q = semAcento(busca.trim())
    if (!q) return campos
    return campos.filter((c) =>
      semAcento(c.rotulo).includes(q) ||
      semAcento(c.grupo ?? '').includes(q) ||
      // o nome interno importa: quem vem da doc do HubSpot procura por ele
      semAcento(c.caminho).includes(q))
  }, [campos, busca])

  const porGrupo = useMemo(() => {
    const m = new Map<string, CampoFiltravel[]>()
    for (const c of filtrados) {
      const g = c.grupo ?? 'Outros'
      m.set(g, [...(m.get(g) ?? []), c])
    }
    return m
  }, [filtrados])

  // o foco vai para a busca ao abrir: quem abriu quer digitar, não rolar
  useEffect(() => {
    if (aberto) {
      const t = setTimeout(() => entrada.current?.focus(), 30)
      return () => clearTimeout(t)
    }
    setBusca('')
  }, [aberto])

  function escolher(c: CampoFiltravel) {
    aoEscolher(c)
    setAberto(false)
  }

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={aberto}
          aria-label="Onde consultar"
          className={cn(
            'flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-border',
            'bg-transparent px-3 py-2 text-label transition-colors hover:bg-muted/40',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            !escolhido && 'text-muted-foreground',
          )}
        >
          <span className="truncate">{escolhido?.rotulo ?? 'escolha o campo'}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
        </button>
      </PopoverTrigger>

      {/* `animate-none opacity-100` de propósito: o PopoverContent padrão nasce
          com opacity 0 e conta com a animação `enter` para chegar a 1. Uma aba
          em segundo plano pausa animações CSS, e `prefers-reduced-motion` as
          desliga — nos dois casos o seletor abriria invisível. Visibilidade não
          pode depender de animação. */}
      <PopoverContent
        align="start"
        className="w-[min(24rem,90vw)] animate-none p-0 opacity-100"
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={entrada}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setAberto(false)
              // Enter escolhe o único resultado: com a busca boa, é o caso comum
              if (e.key === 'Enter' && filtrados.length === 1) escolher(filtrados[0])
            }}
            placeholder="Buscar campo ou plataforma…"
            aria-label="Buscar campo"
            className="h-10 w-full bg-transparent text-label outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="max-h-72 overflow-y-auto p-1">
          {filtrados.length === 0 && (
            <p className="px-3 py-6 text-center text-label text-muted-foreground">
              Nenhum campo com “{busca}”.
            </p>
          )}

          {[...porGrupo.entries()].map(([grupo, lista]) => (
            <div key={grupo} className="mb-1 last:mb-0">
              <p className="px-2 py-1 text-micro uppercase text-muted-foreground">{grupo}</p>
              {lista.map((c) => {
                const atual = `${c.fonte}|${c.caminho}` === valor
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => escolher(c)}
                    title={c.descricao ?? undefined}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-label',
                      'transition-colors hover:bg-muted focus:bg-muted focus:outline-none',
                      atual && 'bg-muted',
                    )}
                  >
                    <Check className={cn('h-3.5 w-3.5 shrink-0',
                      atual ? 'opacity-100 text-primary' : 'opacity-0')} aria-hidden />
                    <span className="truncate">{c.rotulo}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
