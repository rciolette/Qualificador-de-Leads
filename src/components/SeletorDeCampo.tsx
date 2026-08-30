import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { listarCobertura, type CampoFiltravel } from '@/lib/iniciativas'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/**
 * Escolhe um campo do catálogo — por plataforma ou por busca.
 *
 * Era um `<Select>` com 55 itens agrupados: para achar "Origem de tráfego do
 * negócio" o usuário rolava a lista inteira, e três rótulos começam igual
 * ("Origem de tráfego · primeira", "· mais recente", "do negócio"). Digitar
 * duas letras resolve o que rolar não resolvia.
 *
 * A entrada por plataforma veio depois, e por um motivo diferente da busca:
 * quem monta uma etapa quase sempre pensa "quero cruzar com a MemberClass"
 * antes de saber que campo quer. Os dois caminhos convivem — clicar numa
 * plataforma estreita a lista, digitar ignora a plataforma e procura em tudo.
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
  const [plataforma, setPlataforma] = useState<string | null>(null)
  const entrada = useRef<HTMLInputElement>(null)

  const escolhido = campos.find((c) => `${c.fonte}|${c.caminho}` === valor)

  // tabela pronta, não cálculo: ver o comentário de listarCobertura
  const cobertura = useQuery({
    queryKey: ['cobertura'],
    queryFn: listarCobertura,
    staleTime: 10 * 60_000,
  })

  const semAcento = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

  // a ordem das plataformas é a do catálogo: ela vai do mais usado ao menos
  const plataformas = useMemo(() => {
    const vistas: string[] = []
    for (const c of campos) {
      const g = c.grupo ?? 'Outros'
      if (!vistas.includes(g)) vistas.push(g)
    }
    return vistas
  }, [campos])

  const filtrados = useMemo(() => {
    const q = semAcento(busca.trim())
    // digitar procura em tudo: quem já sabe o nome do campo não quer ser
    // barrado por uma plataforma que escolheu antes
    if (q) {
      return campos.filter((c) =>
        semAcento(c.rotulo).includes(q) ||
        semAcento(c.grupo ?? '').includes(q) ||
        // o nome interno importa: quem vem da doc do HubSpot procura por ele
        semAcento(c.caminho).includes(q))
    }
    if (plataforma) return campos.filter((c) => (c.grupo ?? 'Outros') === plataforma)
    return campos
  }, [campos, busca, plataforma])

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

  /** Quantos por cento da base têm o campo, ou null se ainda não foi medido. */
  function pct(c: CampoFiltravel): number | null {
    const cob = cobertura.data?.get(c.id)
    if (!cob || !cob.base) return null
    return Math.round((100 * cob.com_dado) / cob.base)
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
        className="w-[min(28rem,92vw)] animate-none p-0 opacity-100"
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

        {/* some enquanto há busca: aí a lista já ignora a plataforma, e deixar o
            chip aceso enquanto ele não filtra nada é mentira visual */}
        {!busca.trim() && (
          <div className="flex flex-wrap gap-1 border-b border-border px-2 py-2">
            <ChipPlataforma
              ativo={plataforma === null}
              aoClicar={() => setPlataforma(null)}
            >
              Todas
            </ChipPlataforma>
            {plataformas.map((g) => (
              <ChipPlataforma
                key={g}
                ativo={plataforma === g}
                aoClicar={() => setPlataforma(plataforma === g ? null : g)}
              >
                {g}
              </ChipPlataforma>
            ))}
          </div>
        )}

        <div className="max-h-72 overflow-y-auto p-1">
          {filtrados.length === 0 && (
            <p className="px-3 py-6 text-center text-label text-muted-foreground">
              {busca.trim()
                ? `Nenhum campo com “${busca}”.`
                : 'Essa plataforma não tem campo no catálogo.'}
            </p>
          )}

          {[...porGrupo.entries()].map(([grupo, lista]) => (
            <div key={grupo} className="mb-1 last:mb-0">
              <p className="px-2 py-1 text-micro uppercase text-muted-foreground">{grupo}</p>
              {lista.map((c) => {
                const atual = `${c.fonte}|${c.caminho}` === valor
                const p = pct(c)
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
                    <span className="flex-1 truncate">{c.rotulo}</span>
                    {p !== null && (
                      <span
                        className={cn(
                          'shrink-0 text-micro tabular-nums',
                          // sem dado é diferente de dado escasso: o primeiro não
                          // filtra nada, o segundo filtra demais
                          p === 0 ? 'text-destructive'
                            : p < 20 ? 'text-amber-600 dark:text-amber-500'
                              : 'text-muted-foreground',
                        )}
                        title={`${p}% da base tem esse dado`}
                      >
                        {p}%
                      </span>
                    )}
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

function ChipPlataforma({
  ativo, aoClicar, children,
}: {
  ativo: boolean
  aoClicar: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={aoClicar}
      className={cn(
        'rounded-full border px-2.5 py-1 text-micro transition-colors',
        ativo
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border text-muted-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  )
}
