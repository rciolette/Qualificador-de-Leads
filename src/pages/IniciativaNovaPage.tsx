import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BookmarkPlus, Save, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { TituloPagina } from '@/components/AppShell'
import { ConstrutorEtapas } from '@/components/ConstrutorEtapas'
import { FunilExclusao } from '@/components/FunilExclusao'
import {
  apagarModelo, calcularFunil, colunasDe, gerarLista, listarModelos, listarPerfis,
  listarRecortes, salvarIniciativa, salvarModelo,
  EIXOS, type Etapa, type Iniciativa, type LinhaFunil, type ModeloFluxo,
} from '@/lib/iniciativas'
import { formatarNumero } from '@/lib/dados'
import type { TimeComercial, TipoIniciativa } from '@/lib/tipos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

const TIPOS: { valor: TipoIniciativa; rotulo: string }[] = [
  { valor: 'corujao', rotulo: 'Corujão' }, { valor: 'launch', rotulo: 'Launch' },
  { valor: 'webinar', rotulo: 'Webinar' }, { valor: 'pontual', rotulo: 'Pontual' },
]
const TIMES: TimeComercial[] = ['IS', 'AE', 'ECONT']

export function IniciativaNovaPage() {
  const navegar = useNavigate()
  const qc = useQueryClient()
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<TipoIniciativa>('corujao')
  const [objetivo, setObjetivo] = useState('')
  const [times, setTimes] = useState<TimeComercial[]>(['IS'])
  const [antiFadiga, setAntiFadiga] = useState(7)
  const [perdidoDias, setPerdidoDias] = useState(15)
  const [etapas, setEtapas] = useState<Etapa[]>([])
  const [pesos, setPesos] = useState<Record<string, number>>({})
  const [funil, setFunil] = useState<LinhaFunil[]>([])

  const perfis = useQuery({ queryKey: ['perfis'], queryFn: listarPerfis })
  const recortes = useQuery({ queryKey: ['recortes'], queryFn: listarRecortes })
  const modelos = useQuery({ queryKey: ['modelos'], queryFn: listarModelos })

  const config = useMemo(() => ({
    pesos, times, anti_fadiga_dias: antiFadiga, excluir_perdido_dias: perdidoDias,
  }), [pesos, times, antiFadiga, perdidoDias])

  // recalcula a cada mudança, com uma pausa para não disparar a cada tecla
  const calcular = useQuery({
    queryKey: ['funil', etapas, config],
    queryFn: () => calcularFunil(etapas, config),
    enabled: true,
  })
  useEffect(() => { if (calcular.data) setFunil(calcular.data) }, [calcular.data])

  const final = funil.find((l) => l.ordem === 999)?.saem_aqui ?? 0
  const universo = funil[0] ? funil[0].saem_aqui + funil[0].restam : 0

  const salvar = useMutation({
    mutationFn: async () => {
      const ini = await salvarIniciativa({
        nome: nome.trim() || 'Iniciativa sem nome', tipo, objetivo: objetivo.trim() || nome,
        times, prioridade_times: times, anti_fadiga_dias: antiFadiga,
        excluir_perdido_dias: perdidoDias, pesos, etapas,
      } as Partial<Iniciativa> & { etapas: Etapa[] })
      return gerarLista(ini.id, etapas, config)
    },
    onSuccess: (r) => {
      toast.success('Lista gerada', {
        description: `${formatarNumero(r.total)} pessoas · ` +
          Object.entries(r.por_time).map(([t, n]) => `${t}: ${n}`).join(' · '),
      })
      navegar('/listas')
    },
    onError: (e: Error) => toast.error('Não foi possível gerar', { description: e.message }),
  })

  /**
   * Salvar o fluxo não gera lista. Antes, guardar uma receita obrigava a produzir
   * uma lista descartável — a iniciativa só nascia junto com ela.
   */
  const guardar = useMutation({
    mutationFn: () => salvarModelo({
      nome: nome.trim() || 'Modelo sem nome',
      descricao: objetivo.trim() || null,
      etapas, pesos, config,
    }),
    onSuccess: (m) => {
      toast.success(`Modelo "${m.nome}" salvo`, {
        description: `${etapas.length} etapa(s) · ${colunasDe(etapas).length} coluna(s). ` +
          'Nenhuma lista foi gerada.',
      })
      qc.invalidateQueries({ queryKey: ['modelos'] })
    },
    onError: (e: Error) => toast.error('Não foi possível salvar', { description: e.message }),
  })

  function carregarModelo(m: ModeloFluxo) {
    setNome(m.nome)
    setEtapas(m.etapas ?? [])
    setPesos(m.pesos ?? {})
    if (m.descricao) setObjetivo(m.descricao)
    const c = (m.config ?? {}) as Record<string, unknown>
    if (Array.isArray(c.times)) setTimes(c.times as TimeComercial[])
    if (typeof c.anti_fadiga_dias === 'number') setAntiFadiga(c.anti_fadiga_dias)
    if (typeof c.excluir_perdido_dias === 'number') setPerdidoDias(c.excluir_perdido_dias)
    toast.info(`Modelo "${m.nome}" carregado`, {
      description: 'Ajuste o que quiser — salvar de novo com o mesmo nome sobrescreve.',
    })
  }

  function aplicarPerfil(slug: string) {
    const p = perfis.data?.find((x) => x.slug === slug)
    if (!p) return
    setPesos(p.pesos)
    toast.info(`Pesos de "${p.nome}"`, { description: p.observacao ?? undefined })
  }

  const semPeso = Object.values(pesos).every((v) => !v)

  return (
    <>
      <TituloPagina
        titulo="Nova iniciativa"
        descricao="Monte o funil etapa a etapa. Cada uma recebe quem sobrou da anterior, e a conta à direita recalcula sozinha."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* cabeçalho */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-heading">A iniciativa</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="nome">Nome</Label>
                <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)}
                  placeholder="Corujão de agosto · recuperar perdido" />
              </div>
              <div className="space-y-1">
                <Label>Tipo</Label>
                <Select value={tipo} onValueChange={(v) => setTipo(v as TipoIniciativa)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIPOS.map((t) => (
                      <SelectItem key={t.valor} value={t.valor}>{t.rotulo}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Times, em ordem de prioridade</Label>
                <div className="flex gap-1.5 pt-1.5">
                  {TIMES.map((t) => (
                    <button key={t}
                      onClick={() => setTimes(times.includes(t)
                        ? times.filter((x) => x !== t)
                        : [...times, t])}
                      className={cn('rounded-lg border px-3 py-1 text-label transition-colors',
                        times.includes(t)
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground')}>
                      {t}{times.includes(t) && ` · ${times.indexOf(t) + 1}º`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="obj">Objetivo</Label>
                <Input id="obj" value={objetivo} onChange={(e) => setObjetivo(e.target.value)}
                  placeholder="É o que justifica os pesos" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="af">Anti-fadiga (dias)</Label>
                <Input id="af" type="number" min={7} value={antiFadiga}
                  onChange={(e) => setAntiFadiga(Math.max(7, Number(e.target.value)))} />
                <p className="text-micro text-muted-foreground">Configurável para cima, nunca abaixo de 7.</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="pd">Excluir perdido há (dias)</Label>
                <Input id="pd" type="number" min={0} value={perdidoDias}
                  onChange={(e) => setPerdidoDias(Number(e.target.value))} />
              </div>
            </CardContent>
          </Card>

          {/* modelos salvos pelo usuário — diferente dos recortes, que são seed */}
          {(modelos.data ?? []).length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-heading">
                  <BookmarkPlus className="h-4 w-4" /> Meus modelos
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {(modelos.data ?? []).map((m) => (
                  <span key={m.id}
                    className="flex items-center gap-1 rounded-lg border border-border pl-3 pr-1">
                    <button onClick={() => carregarModelo(m)}
                      className="py-1.5 text-label hover:text-primary">
                      {m.nome}
                      <span className="ml-1.5 text-micro text-muted-foreground">
                        {(m.etapas ?? []).length} etapa(s)
                      </span>
                    </button>
                    <button
                      onClick={async () => {
                        await apagarModelo(m.id)
                        qc.invalidateQueries({ queryKey: ['modelos'] })
                        toast.success(`Modelo "${m.nome}" apagado`)
                      }}
                      className="p-1 text-muted-foreground hover:text-destructive"
                      aria-label={`Apagar ${m.nome}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </CardContent>
            </Card>
          )}

          {/* recortes prontos */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-heading">
                <Wand2 className="h-4 w-4" /> Recortes prontos
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {(recortes.data ?? []).map((r) => (
                <button key={r.slug}
                  onClick={() => {
                    if (r.perfil_peso) aplicarPerfil(r.perfil_peso)
                    toast.info(r.nome, {
                      description: r.diagnostico
                        ? `${r.criterio} — DIAGNÓSTICO: ${r.destino}`
                        : r.criterio,
                      duration: 10000,
                    })
                  }}
                  className={cn('rounded-lg border px-3 py-1.5 text-label transition-colors hover:bg-muted',
                    r.diagnostico ? 'border-warning/50 text-warning' : 'border-border')}>
                  {r.nome}
                  {r.diagnostico && <span className="ml-1.5 text-micro">· não dispara</span>}
                </button>
              ))}
            </CardContent>
          </Card>

          {/* etapas */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-heading">O funil, etapa a etapa</CardTitle>
            </CardHeader>
            <CardContent>
              <ConstrutorEtapas etapas={etapas} aoMudar={setEtapas} />
            </CardContent>
          </Card>

          {/* pesos */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-heading">Como ordenar quem sobrou</CardTitle>
                <Select onValueChange={aplicarPerfil}>
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="usar um perfil de peso" />
                  </SelectTrigger>
                  <SelectContent>
                    {(perfis.data ?? []).map((p) => (
                      <SelectItem key={p.slug} value={p.slug}>{p.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {EIXOS.map((eixo) => (
                <div key={eixo.chave} className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className={cn('text-label',
                        !pesos[eixo.chave] && 'text-muted-foreground line-through')}>
                        {eixo.rotulo}
                      </span>
                      <span className="text-micro text-muted-foreground">{eixo.ajuda}</span>
                    </div>
                    <input type="range" min={0} max={10} value={pesos[eixo.chave] ?? 0}
                      onChange={(e) => setPesos({ ...pesos, [eixo.chave]: Number(e.target.value) })}
                      className="mt-1 w-full accent-primary" />
                  </div>
                  <span className={cn('w-6 text-right text-label tabular-nums',
                    !pesos[eixo.chave] && 'text-muted-foreground')}>
                    {pesos[eixo.chave] ?? 0}
                  </span>
                </div>
              ))}
              <p className="text-micro text-muted-foreground">
                Peso 0 desliga o eixo — ele sai da conta em vez de rebaixar todo mundo.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* coluna fixa */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-heading">
                Funil
                {calcular.isFetching && (
                  <span className="text-micro font-normal text-muted-foreground">recalculando…</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FunilExclusao funil={funil} carregando={calcular.isFetching}
                etapas={etapas} iniciativa={config} />

              {universo > 0 && final === 0 && etapas.length > 0 && (
                <p className="mt-4 flex items-start gap-2 rounded-lg bg-warning/15 px-3 py-2 text-label text-warning">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Nenhuma pessoa sobrou. Uma etapa pode estar cortando por dado que ainda não
                  sincronizou — experimente ligar "manter quem não tem esse dado" nela.
                </p>
              )}
              {semPeso && final > 0 && (
                <p className="mt-4 flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-label text-muted-foreground">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Sem nenhum peso, todo mundo fica com score 0 e a lista sai sem ordem.
                </p>
              )}

              <Button className="mt-4 w-full gap-2"
                disabled={final === 0 || salvar.isPending || times.length === 0}
                onClick={() => salvar.mutate()}>
                <Save className="h-4 w-4" />
                {salvar.isPending
                  ? 'Gerando…'
                  : `Gerar lista com ${formatarNumero(final)}`}
              </Button>

              <Button variant="outline" className="mt-2 w-full gap-2"
                disabled={etapas.length === 0 || guardar.isPending}
                onClick={() => guardar.mutate()}>
                <BookmarkPlus className="h-4 w-4" />
                {guardar.isPending ? 'Salvando…' : 'Salvar como modelo'}
              </Button>
              <p className="mt-1.5 text-center text-micro text-muted-foreground">
                Guarda etapas, colunas e pesos. Não gera lista.
              </p>
              {times.length === 0 && (
                <p className="mt-2 text-center text-micro text-muted-foreground">
                  Escolha ao menos um time.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
