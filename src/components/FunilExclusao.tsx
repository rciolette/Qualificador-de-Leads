import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Lock, Users } from 'lucide-react'
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

export function FunilExclusao({
  funil, carregando, etapas, iniciativa,
}: {
  funil: LinhaFunil[]
  carregando: boolean
  etapas: Etapa[]
  iniciativa: Partial<Iniciativa>
}) {
  const [aberto, setAberto] = useState<LinhaFunil | null>(null)

  if (carregando && funil.length === 0) {
    return <Skeleton className="h-80 rounded-xl" />
  }

  const universo = funil[0] ? funil[0].saem_aqui + funil[0].restam : 0
  const final = funil.find((l) => l.ordem === 999)

  return (
    <>
      <div className={cn('space-y-0.5', carregando && 'opacity-60 transition-opacity')}>
        <div className="flex items-baseline justify-between px-2 py-1.5 text-label">
          <span className="text-muted-foreground">Universo importado</span>
          <span className="font-medium tabular-nums">{formatarNumero(universo)}</span>
        </div>

        {funil.filter((l) => l.ordem !== 999).map((linha) => (
          <button
            key={linha.ordem}
            onClick={() => linha.saem_aqui > 0 && setAberto(linha)}
            disabled={linha.saem_aqui === 0}
            className={cn(
              'flex w-full items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-label transition-colors',
              linha.saem_aqui > 0
                ? 'hover:bg-muted cursor-pointer'
                : 'cursor-default text-muted-foreground/60',
            )}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              {linha.bloqueio_duro && (
                <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="bloqueio duro" />
              )}
              <span className="truncate">− {linha.rotulo}</span>
            </span>
            <span className="shrink-0 tabular-nums">
              {linha.saem_aqui > 0
                ? <span className="text-destructive">{formatarNumero(linha.saem_aqui)}</span>
                : <span>0</span>}
              <span className="ml-3 text-muted-foreground">{formatarNumero(linha.restam)}</span>
            </span>
          </button>
        ))}

        <div className="mt-2 flex items-baseline justify-between border-t border-border px-2 pt-2.5">
          <span className="font-medium">= LISTA FINAL</span>
          <button
            onClick={() => final && final.saem_aqui > 0 && setAberto(final)}
            className="text-xl font-semibold tabular-nums text-primary hover:underline"
          >
            {formatarNumero(final?.saem_aqui ?? 0)}
          </button>
        </div>
      </div>

      <p className="mt-3 flex items-start gap-1.5 px-2 text-micro text-muted-foreground">
        <Lock className="mt-0.5 h-3 w-3 shrink-0" />
        As etapas com cadeado são bloqueio duro: valem sempre, não reordenam e não desligam.
        Clique em qualquer linha para ver quem saiu ali.
      </p>

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
  const trazidas = colunas.data ?? []

  const pessoas = useQuery({
    queryKey: ['quem-saiu', linha?.ordem, etapas, iniciativa.pesos],
    queryFn: () => pessoasDaEtapa(etapas, iniciativa, ehFinal ? null : linha!.ordem, 300),
    enabled: Boolean(linha),
  })

  return (
    <Dialog open={Boolean(linha)} onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            {ehFinal ? 'Lista final' : `Saíram em "${linha?.rotulo}"`}
            <Badge variant="secondary">{formatarNumero(linha?.saem_aqui ?? 0)}</Badge>
          </DialogTitle>
        </DialogHeader>

        {pessoas.isLoading ? (
          <Skeleton className="h-64" />
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Faixa</TableHead>
                  <TableHead className="text-right">Compras</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  {trazidas.map((c) => (
                    <TableHead key={c.id}>{c.rotulo}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(pessoas.data ?? []).map((p: Record<string, unknown>) => (
                  <TableRow key={String(p.pessoa_id)}>
                    <TableCell className="text-label">{String(p.nome ?? '—')}</TableCell>
                    <TableCell className="text-label text-muted-foreground">
                      {String(p.email ?? '—')}
                    </TableCell>
                    <TableCell className="text-label text-muted-foreground">
                      {String(p.telefone ?? '—')}
                    </TableCell>
                    <TableCell className="text-label">
                      {p.faixa_leadscore ? String(p.faixa_leadscore) : '—'}
                    </TableCell>
                    <TableCell className="text-right text-label">
                      {formatarNumero(Number(p.compras ?? 0))}
                    </TableCell>
                    <TableCell className="text-right text-label">
                      {p.valor_total
                        ? Number(p.valor_total).toLocaleString('pt-BR',
                            { style: 'currency', currency: 'BRL' })
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right text-label tabular-nums">
                      {Number(p.score ?? 0).toFixed(1)}
                      <span className="ml-1 text-muted-foreground">{String(p.faixa ?? '')}</span>
                    </TableCell>
                    {trazidas.map((c) => (
                      <TableCell key={c.id} className="max-w-[220px] truncate text-label">
                        {mostrar((p.extras as Record<string, unknown> | null)?.[c.id])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {(pessoas.data ?? []).length >= 300 && (
              <p className="p-3 text-center text-micro text-muted-foreground">
                Mostrando as 300 primeiras por score. A exportação traz todas.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
