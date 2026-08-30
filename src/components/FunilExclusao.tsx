import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Lock, Users } from 'lucide-react'
import {
  colunasDe, pessoasDaEtapa, resolverColunas,
  type Etapa, type Iniciativa, type LinhaFunil,
} from '@/lib/iniciativas'
import { formatarNumero, mostrar } from '@/lib/dados'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

/**
 * O funil, com o que o usuário decidiu em primeiro plano.
 *
 * Os 8 bloqueios duros ocupavam oito linhas permanentes no topo, empurrando
 * para baixo as etapas que a pessoa montou. Eles não são decisão dela — são
 * regra fixa — e hoje cortam 1.987 de 4.430, quase metade da base. Merecem uma
 * linha com o total, que expande quando alguém quiser a conta detalhada.
 *
 * Essa linha fica logo abaixo da base, e não no fim, porque é onde ela é
 * verdadeira: os bloqueios são aplicados ANTES das etapas do usuário. Pô-la no
 * fim daria o desenho mais bonito e a aritmética errada — com duas etapas,
 * 4.430 − 79 dá 4.351, e a linha seguinte mostraria "restam 2.364".
 */
export function FunilExclusao({
  funil, carregando, etapas, iniciativa,
}: {
  funil: LinhaFunil[]
  carregando: boolean
  etapas: Etapa[]
  iniciativa: Partial<Iniciativa>
}) {
  const [aberto, setAberto] = useState<LinhaFunil | null>(null)
  const [duroAberto, setDuroAberto] = useState(false)

  if (carregando && funil.length === 0) {
    return <Skeleton className="h-80 rounded-xl" />
  }

  const universo = funil[0] ? funil[0].saem_aqui + funil[0].restam : 0
  const final = funil.find((l) => l.ordem === 999)
  const duros = funil.filter((l) => l.bloqueio_duro)
  const minhas = funil.filter((l) => !l.bloqueio_duro && l.ordem !== 999)
  const cortadosDuros = duros.reduce((t, l) => t + l.saem_aqui, 0)
  const aposDuros = duros.length ? duros[duros.length - 1].restam : universo

  return (
    <>
      <div className={cn('space-y-0.5', carregando && 'opacity-60 transition-opacity')}>
        <p className="px-2 pb-1 text-micro uppercase text-muted-foreground">Seu funil</p>

        <div className="flex items-baseline justify-between px-2 py-1.5 text-label">
          <span className="text-muted-foreground">A base</span>
          <span className="font-medium tabular-nums">{formatarNumero(universo)}</span>
        </div>

        {/* os oito viram um, e o um abre */}
        {duros.length > 0 && (
          <div className="rounded-lg bg-muted/40">
            <button
              onClick={() => setDuroAberto(!duroAberto)}
              aria-expanded={duroAberto}
              className="flex w-full items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-label transition-colors hover:bg-muted"
            >
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                {duroAberto
                  ? <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
                  : <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />}
                <Lock className="h-3 w-3 shrink-0" aria-hidden />
                <span className="truncate">{duros.length} regras de segurança</span>
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="text-destructive">−{formatarNumero(cortadosDuros)}</span>
                <span className="ml-3 text-muted-foreground">{formatarNumero(aposDuros)}</span>
              </span>
            </button>

            {duroAberto && (
              <div className="space-y-0.5 border-t border-border/60 px-1 py-1">
                {duros.map((l) => (
                  <button
                    key={l.ordem}
                    onClick={() => l.saem_aqui > 0 && setAberto(l)}
                    disabled={l.saem_aqui === 0}
                    className={cn(
                      'flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left text-micro transition-colors',
                      l.saem_aqui > 0
                        ? 'cursor-pointer hover:bg-background'
                        : 'cursor-default text-muted-foreground/50',
                    )}
                  >
                    <span className="truncate">{l.rotulo}</span>
                    <span className="shrink-0 tabular-nums">
                      {l.saem_aqui > 0
                        ? <span className="text-destructive">−{formatarNumero(l.saem_aqui)}</span>
                        : <span>0</span>}
                      <span className="ml-3 text-muted-foreground">{formatarNumero(l.restam)}</span>
                    </span>
                  </button>
                ))}
                <p className="px-2 pt-1 text-micro text-muted-foreground">
                  Valem sempre, antes dos seus filtros. Não reordenam e não desligam.
                </p>
              </div>
            )}
          </div>
        )}

        {minhas.map((linha) => (
          <div key={linha.ordem}>
            <button
              onClick={() => {
                // rola até o cartão que gerou esta linha: com quatro ou cinco
                // cartões, achar de qual deles veio o corte era procurar à mão
                document.getElementById(`etapa-${linha.ordem - 10}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }}
              className={cn(
                'flex w-full items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-label transition-colors hover:bg-muted',
                linha.ignorada && 'border border-dashed border-warning/60 opacity-70',
              )}
            >
              <span className="min-w-0 truncate">{linha.rotulo}</span>
              <span className="shrink-0 tabular-nums">
                {linha.saem_aqui > 0
                  ? <span className="text-destructive">−{formatarNumero(linha.saem_aqui)}</span>
                  : <span className="text-muted-foreground">0</span>}
                <span className="ml-3 text-muted-foreground">{formatarNumero(linha.restam)}</span>
              </span>
            </button>

            {linha.ignorada && (
              <p className="px-2 pb-1 text-micro text-warning">
                etapa incompleta — ignorada no cálculo
              </p>
            )}

            {linha.saem_aqui > 0 && (
              <button
                onClick={() => setAberto(linha)}
                className="flex items-center gap-1 px-2 pb-1 text-micro text-muted-foreground hover:text-foreground"
              >
                <Users className="h-3 w-3" aria-hidden /> ver quem saiu
              </button>
            )}
          </div>
        ))}

        {minhas.length === 0 && (
          <p className="px-2 py-2 text-micro text-muted-foreground">
            Nenhum filtro seu ainda — a lista é a base menos as regras de segurança.
          </p>
        )}

        <div className="mt-2 flex items-baseline justify-between border-t-2 border-border px-2 pt-2.5">
          <span className="font-medium">= LISTA FINAL</span>
          <button
            onClick={() => final && final.saem_aqui > 0 && setAberto(final)}
            className="text-xl font-semibold tabular-nums text-primary hover:underline"
          >
            {formatarNumero(final?.saem_aqui ?? 0)}
          </button>
        </div>
      </div>

      <QuemSaiu
        linha={aberto}
        etapas={etapas}
        iniciativa={iniciativa}
        aoFechar={() => setAberto(null)}
      />
    </>
  )
}

function QuemSaiu({
  linha, etapas, iniciativa, aoFechar,
}: {
  linha: LinhaFunil | null
  etapas: Etapa[]
  iniciativa: Partial<Iniciativa>
  aoFechar: () => void
}) {
  const ehFinal = linha?.ordem === 999
  const ids = colunasDe(etapas)
  const colunas = useQuery({
    queryKey: ['colunas-resolvidas', ids],
    queryFn: () => resolverColunas(ids),
    enabled: ids.length > 0,
  })

  const pessoas = useQuery({
    queryKey: ['pessoas-etapa', linha?.ordem, etapas, iniciativa],
    queryFn: () => pessoasDaEtapa(etapas, iniciativa, ehFinal ? null : linha!.ordem, 200, ids),
    enabled: Boolean(linha),
  })

  return (
    <Dialog open={Boolean(linha)} onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {ehFinal ? 'Quem entra na lista' : `Quem saiu em “${linha?.rotulo}”`}
            <Badge variant="secondary" className="ml-2">
              {formatarNumero(linha?.saem_aqui ?? 0)}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {pessoas.isLoading ? (
          <Skeleton className="h-64 rounded-lg" />
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  {(colunas.data ?? []).map((c) => (
                    <TableHead key={c.id}>{c.rotulo}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(pessoas.data ?? []).map((p: Record<string, unknown>) => (
                  <TableRow key={String(p.pessoa_id)}>
                    <TableCell className="text-label">{mostrar(p.nome)}</TableCell>
                    <TableCell className="text-label">{mostrar(p.email)}</TableCell>
                    {(colunas.data ?? []).map((c) => (
                      <TableCell key={c.id} className="text-label">{mostrar(p[c.id])}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {(pessoas.data?.length ?? 0) >= 200 && (
              <p className="pt-2 text-micro text-muted-foreground">
                Mostrando as 200 primeiras. O arquivo exportado traz todas.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
