import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BookmarkPlus, Trash2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  apagarModelo, listarModelos, listarRecortes,
  type Etapa, type ModeloFluxo, type Recorte,
} from '@/lib/iniciativas'
import { recorteParaEtapas } from '@/lib/recortes'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/**
 * Um ponto de partida, não um filtro paralelo.
 *
 * "Recortes prontos" e "Meus modelos" eram dois blocos permanentes na Etapa 2,
 * concorrendo com os cartões pelo mesmo espaço e pela mesma pergunta. Pior: o
 * recorte não filtrava nada — mostrava um toast com o critério em português e
 * deixava a pessoa remontar aquilo à mão.
 *
 * Agora os dois viram um painel que só abre quando se pede, e o que sai dele são
 * ETAPAS — editáveis, visíveis, contáveis no funil como qualquer outra. O
 * modelo deixa de ser um caminho paralelo e vira o primeiro rascunho.
 */
export function PainelDeModelos({
  aoAplicar,
}: {
  /** recebe as etapas montadas e, quando é modelo salvo, o modelo inteiro */
  aoAplicar: (
    e: Etapa[],
    extras?: {
      pesos?: Record<string, number>
      perfil?: string | null
      modelo?: ModeloFluxo
    },
  ) => void
}) {
  const [aberto, setAberto] = useState(false)

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Wand2 className="h-3.5 w-3.5" /> Começar de um modelo
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Começar de um modelo</DialogTitle>
          <DialogDescription>
            Cada um destes vira um conjunto de cartões que você ajusta. Nada é
            aplicado sem aparecer no funil.
          </DialogDescription>
        </DialogHeader>
        <Conteudo aoAplicar={aoAplicar} aoFechar={() => setAberto(false)} />
      </DialogContent>
    </Dialog>
  )
}

function Conteudo({
  aoAplicar, aoFechar,
}: {
  aoAplicar: (
    e: Etapa[],
    extras?: {
      pesos?: Record<string, number>
      perfil?: string | null
      modelo?: ModeloFluxo
    },
  ) => void
  aoFechar: () => void
}) {
  const qc = useQueryClient()
  const recortes = useQuery({ queryKey: ['recortes'], queryFn: listarRecortes })
  const modelos = useQuery({ queryKey: ['modelos'], queryFn: listarModelos })

  function aplicarRecorte(r: Recorte) {
    const { etapas, naoCoube } = recorteParaEtapas(r)

    if (etapas.length === 0) {
      // acontece com os recortes que dependem inteiramente de campo que o
      // catálogo não tem. Dizer isso é melhor que criar um cartão vazio.
      toast.error(`"${r.nome}" ainda não pode virar etapas`, {
        description: naoCoube.join(' · ') || r.criterio,
        duration: 12000,
      })
      return
    }

    aoAplicar(etapas, { perfil: r.perfil_peso })
    aoFechar()

    if (naoCoube.length > 0) {
      // silêncio aqui seria o pior resultado possível: cartões que parecem
      // completos filtrando menos do que o nome do recorte promete
      toast.warning(`"${r.nome}" veio parcial`, {
        description: `Ficou de fora: ${naoCoube.join(' · ')}. Complete à mão antes de gerar.`,
        duration: 15000,
      })
    } else {
      toast.success(`"${r.nome}" virou ${etapas.length} cartão(ões)`)
    }
  }

  function aplicarModelo(m: ModeloFluxo) {
    aoAplicar(m.etapas ?? [], { pesos: m.pesos, modelo: m })
    aoFechar()
    toast.success(`Modelo "${m.nome}" carregado`)
  }

  return (
    <div className="mt-6 space-y-6">
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-label font-medium">
          <BookmarkPlus className="h-3.5 w-3.5" /> Meus modelos
        </h3>
        {modelos.isLoading ? (
          <Skeleton className="h-20 rounded-lg" />
        ) : (modelos.data ?? []).length === 0 ? (
          <p className="text-label text-muted-foreground">
            Nenhum ainda. Um fluxo que você monta pode ser salvo como modelo no fim
            da Etapa 2, com ou sem gerar lista.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {(modelos.data ?? []).map((m) => (
              <li key={m.id} className="flex items-center gap-1 rounded-lg border border-border">
                <button onClick={() => aplicarModelo(m)}
                  className="flex-1 px-3 py-2 text-left text-label hover:text-primary">
                  {m.nome}
                  <span className="ml-2 text-micro text-muted-foreground">
                    {(m.etapas ?? []).length} cartão(ões)
                  </span>
                  {m.descricao && (
                    <span className="block text-micro text-muted-foreground">{m.descricao}</span>
                  )}
                </button>
                <button
                  onClick={async () => {
                    await apagarModelo(m.id)
                    qc.invalidateQueries({ queryKey: ['modelos'] })
                    toast.success(`Modelo "${m.nome}" apagado`)
                  }}
                  className="p-2 text-muted-foreground hover:text-destructive"
                  aria-label={`Apagar ${m.nome}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 flex items-center gap-2 text-label font-medium">
          <Wand2 className="h-3.5 w-3.5" /> Recortes prontos
        </h3>
        {recortes.isLoading ? (
          <Skeleton className="h-32 rounded-lg" />
        ) : (
          <ul className="space-y-1.5">
            {(recortes.data ?? []).map((r) => {
              const { etapas, naoCoube } = recorteParaEtapas(r)
              return (
                <li key={r.slug}>
                  <button
                    onClick={() => aplicarRecorte(r)}
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted',
                      r.diagnostico ? 'border-warning/50' : 'border-border',
                    )}
                  >
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-label font-medium">{r.nome}</span>
                      {r.diagnostico
                        ? <Badge variant="outline" className="border-warning/50 text-warning">não dispara</Badge>
                        : <Badge variant="secondary">{etapas.length} cartão(ões)</Badge>}
                    </span>
                    <span className="mt-0.5 block text-micro text-muted-foreground">
                      {r.criterio}
                    </span>
                    {naoCoube.length > 0 && (
                      <span className="mt-1.5 flex items-start gap-1.5 text-micro text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                        <span>
                          {etapas.length === 0
                            ? 'Nada disto vira etapa ainda: '
                            : 'Vem parcial — fica de fora: '}
                          {naoCoube.join(' · ')}
                        </span>
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
