import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { listarOrigens, type Origem } from '@/lib/iniciativas'
import { espelhar, formatarNumero, sincronizarTudo, FONTES_ESPELHADAS } from '@/lib/dados'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Escolher a plataforma antes do campo.
 *
 * Quem monta uma etapa pensa "quero cruzar com a MemberClass" antes de saber
 * que campo quer — e o campo só faz sentido depois. Por isso são cartões e não
 * um dropdown: um dropdown esconde justamente o que decide a escolha, que é a
 * cobertura. Escolher MemberKit leva 4.430 pessoas a 105, e até aqui a única
 * forma de descobrir isso era filtrar e ver a lista murchar.
 *
 * O botão de sincronizar fica NO CARTÃO. Mandar alguém para /integracoes no
 * meio do raciocínio é perder o raciocínio: quando voltasse, o rascunho estaria
 * lá, mas a linha de pensamento não.
 */

/** O que cada plataforma responde, em uma linha. */
const O_QUE_RESPONDE: Record<string, string> = {
  hubspot: 'Negócios, etapa do funil, leadscore e produtos contratados.',
  memberclass: 'IniciAmazon: aulas assistidas, último acesso, se é pagante.',
  memberkit: 'Mentorias e consultorias: nível de acesso e produto pago.',
  sellflux: 'Saúde de disparo: tags, opt-out e falha de entrega.',
}

export function SeletorDeOrigem({
  aoEscolher, aoCancelar,
}: {
  aoEscolher: (origem: Origem) => void
  /** ausente quando não há etapa nenhuma: aí não há o que cancelar */
  aoCancelar?: () => void
}) {
  const origens = useQuery({ queryKey: ['origens'], queryFn: listarOrigens })

  return (
    <div className="rounded-xl border border-dashed border-border p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-body font-medium">Onde consultar?</h3>
          <p className="text-label text-muted-foreground">
            Cada origem responde uma coisa diferente sobre a mesma pessoa.
          </p>
        </div>
        {aoCancelar && (
          <Button variant="ghost" size="sm" onClick={aoCancelar}>Cancelar</Button>
        )}
      </div>

      {origens.isLoading ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
        </div>
      ) : origens.isError ? (
        <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-label text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Não consegui ler a cobertura das origens: {(origens.error as Error).message}
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {(origens.data ?? []).map((o) => (
            <CartaoOrigem key={o.slug} origem={o} aoEscolher={() => aoEscolher(o)} />
          ))}
        </div>
      )}
    </div>
  )
}

function CartaoOrigem({ origem, aoEscolher }: { origem: Origem; aoEscolher: () => void }) {
  const qc = useQueryClient()
  const [progresso, setProgresso] = useState<string | null>(null)

  const pct = origem.base ? Math.round((100 * origem.pessoas) / origem.base) : 0
  // abaixo de 25% a origem não é uma escolha ruim, é uma escolha que precisa
  // ser consciente: como filtro ela sozinha define o teto da lista
  const escassa = pct < 25

  const atualizar = useMutation({
    mutationFn: async () => {
      if (FONTES_ESPELHADAS.includes(origem.slug)) {
        return espelhar(origem.slug, (pagina, gravados) =>
          setProgresso(`página ${pagina} · ${formatarNumero(gravados)} registros`))
      }
      return sincronizarTudo(origem.slug, {
        aoProgresso: (p) => setProgresso(
          p.fase === 'reduzindo'
            ? `lote grande demais, reduzindo para ${p.lote}`
            : `${formatarNumero(p.processados)} pessoas · ${formatarNumero(p.encontrados)} encontradas`),
      })
    },
    onSuccess: () => {
      toast.success(`${origem.nome} atualizada`)
      // a foto de pessoa_dados foi invalidada pelo trigger; o funil e a
      // cobertura precisam reler
      qc.invalidateQueries({ queryKey: ['origens'] })
      qc.invalidateQueries({ queryKey: ['funil'] })
      qc.invalidateQueries({ queryKey: ['cobertura'] })
    },
    onError: (e: Error) =>
      toast.error(`Falha ao atualizar ${origem.nome}`, { description: e.message }),
    onSettled: () => setProgresso(null),
  })

  return (
    <div
      className={cn(
        'rounded-lg border p-3 transition-colors',
        escassa ? 'border-amber-500/50 bg-amber-500/5' : 'border-border',
      )}
    >
      <button
        type="button"
        onClick={aoEscolher}
        disabled={atualizar.isPending}
        className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-label font-medium">{origem.nome}</span>
          <span className={cn('shrink-0 text-label tabular-nums',
            escassa ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
            {pct}%
          </span>
        </div>
        <p className="mt-0.5 text-micro text-muted-foreground">
          {O_QUE_RESPONDE[origem.slug] ?? 'Origem conectada.'}
        </p>
        <p className="mt-1.5 text-micro text-muted-foreground">
          {formatarNumero(origem.pessoas)} das {formatarNumero(origem.base)} pessoas da base
        </p>
      </button>

      {atualizar.isPending ? (
        <p className="mt-2 flex items-center gap-1.5 text-micro text-muted-foreground">
          <RefreshCw className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
          {progresso ?? 'atualizando…'}
        </p>
      ) : origem.vencida ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-micro text-muted-foreground">
            {origem.ultima_sync
              ? `sincronizada há ${Math.round(origem.horas_desde ?? 0)}h`
              : 'nunca sincronizada'}
          </span>
          <Button
            variant="outline" size="sm" className="h-7 gap-1.5 text-micro"
            onClick={(e) => { e.stopPropagation(); atualizar.mutate() }}
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            Atualizar agora
          </Button>
        </div>
      ) : (
        <p className="mt-2 flex items-center gap-1.5 text-micro text-muted-foreground">
          <Check className="h-3 w-3 shrink-0 text-primary" aria-hidden />
          atualizada há {Math.round(origem.horas_desde ?? 0)}h
        </p>
      )}
    </div>
  )
}
