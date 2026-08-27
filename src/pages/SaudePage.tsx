import { useQuery } from '@tanstack/react-query'
import { AlertCircle, CircleHelp } from 'lucide-react'
import { TituloPagina } from '@/components/AppShell'
import { exigirSupabase } from '@/lib/supabase'
import { listarFrescor, formatarData, formatarNumero } from '@/lib/dados'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface Metrica {
  chave: string; rotulo: string; fonte: string
  percentual: number | null; linha_base: number | null; meta: number | null
  numerador: number; denominador: number; tem_dado: boolean; porque: string
}

async function saude(): Promise<Metrica[]> {
  const { data, error } = await exigirSupabase().from('v_saude_dados').select('*')
  if (error) throw error
  return data ?? []
}

async function panorama() {
  const { data, error } = await exigirSupabase().from('v_panorama').select('*').single()
  if (error) throw error
  return data as Record<string, number | string | null>
}

export function SaudePage() {
  const metricas = useQuery({ queryKey: ['saude'], queryFn: saude })
  const geral = useQuery({ queryKey: ['panorama'], queryFn: panorama })
  const frescor = useQuery({ queryKey: ['frescor'], queryFn: listarFrescor })

  return (
    <>
      <TituloPagina
        titulo="Saúde dos dados"
        descricao="O que os filtros conseguem enxergar hoje. Uma métrica baixa por falta de sincronização é diferente de uma métrica baixa de verdade — e aqui elas aparecem separadas."
      />

      {/* panorama */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Pessoas', geral.data?.pessoas],
          ['Transações', geral.data?.transacoes],
          ['Listas geradas', geral.data?.listas_geradas],
          ['Integrações ativas', geral.data?.integracoes_ativas],
        ].map(([rotulo, valor]) => (
          <Card key={String(rotulo)}>
            <CardContent className="pt-5">
              <div className="text-micro uppercase text-muted-foreground">{String(rotulo)}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {geral.isLoading ? '—' : formatarNumero(Number(valor ?? 0))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* camada 1 */}
      <Card className="mb-6">
        <CardHeader><CardTitle className="text-heading">Camada 1 · saúde dos dados</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {metricas.isLoading ? <Skeleton className="h-64" /> : (metricas.data ?? []).map((m) => {
            const atinge = m.meta === null || (m.percentual ?? 0) >= m.meta
            return (
              <div key={m.chave} className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-label">
                    {m.rotulo}
                    <Badge variant="secondary" className="ml-2 text-micro">{m.fonte}</Badge>
                  </span>
                  <span className="text-label tabular-nums">
                    {!m.tem_dado ? (
                      <span className="text-muted-foreground">sem sincronização</span>
                    ) : (
                      <>
                        <span className={cn('font-medium',
                          atinge ? 'text-success' : 'text-warning')}>
                          {m.percentual ?? 0}%
                        </span>
                        <span className="ml-2 text-muted-foreground">
                          {formatarNumero(m.numerador)}/{formatarNumero(m.denominador)}
                        </span>
                      </>
                    )}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className={cn('h-full rounded-full transition-all',
                    !m.tem_dado ? 'bg-muted-foreground/30'
                      : atinge ? 'bg-success' : 'bg-warning')}
                    style={{ width: `${Math.min(100, m.percentual ?? 0)}%` }} />
                </div>
                <div className="flex flex-wrap gap-x-4 text-micro text-muted-foreground">
                  {m.linha_base !== null && <span>linha de base ~{m.linha_base}%</span>}
                  {m.meta !== null ? <span>meta &gt; {m.meta}%</span> : <span>sem meta</span>}
                  <span className="flex items-start gap-1">
                    <CircleHelp className="mt-px h-3 w-3 shrink-0" />{m.porque}
                  </span>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* frescor */}
      <Card>
        <CardHeader><CardTitle className="text-heading">Frescor por fonte</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(frescor.data ?? []).filter((f) => f.tipo !== 'fonte_venda').map((f) => (
            <div key={f.slug} className="flex items-baseline justify-between text-label">
              <span>{f.nome_exibicao}</span>
              <span className="tabular-nums">
                {!f.ativa ? (
                  <span className="text-muted-foreground">sem credencial</span>
                ) : f.ultima_execucao === null ? (
                  <span className="text-muted-foreground">nunca sincronizou</span>
                ) : f.vencida ? (
                  <span className="flex items-center gap-1 text-warning">
                    <AlertCircle className="h-3 w-3" />
                    {f.horas_desde}h — passou do limite de {f.frescor_limite_horas}h
                  </span>
                ) : (
                  <span className="text-success">
                    {f.horas_desde}h · {formatarData(f.ultima_execucao, true)}
                  </span>
                )}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  )
}
