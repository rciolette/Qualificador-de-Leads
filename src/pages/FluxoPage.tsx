import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, ArrowLeft, ArrowRight, BookmarkPlus, Check, Database, Download,
  Filter, ListChecks, Sparkles, Undo2,
} from 'lucide-react'
import { toast } from 'sonner'
import { MapeamentoArquivo } from '@/components/MapeamentoArquivo'
import { ConstrutorEtapas } from '@/components/ConstrutorEtapas'
import { PainelDeModelos } from '@/components/PainelDeModelos'
import { FunilExclusao } from '@/components/FunilExclusao'
import { formatarNumero, listarImportacoes, mostrar } from '@/lib/dados'
import { analisarArquivos, type Analise, type CampoCanonico, type Progresso } from '@/lib/importar'
import { ZonaDeUpload } from '@/components/ZonaDeUpload'
import {
  calcularFunil, colunasDe, gerarLista, listarPerfis,
  pessoasDaEtapa, resolverColunas, salvarIniciativa, salvarModelo,
  EIXOS, type Etapa, type Iniciativa, type LinhaFunil, type ModeloFluxo,
} from '@/lib/iniciativas'
import { baixarLista } from '@/lib/exportar'
import type { TimeComercial, TipoIniciativa } from '@/lib/tipos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useDebounceComEstado } from '@/lib/useDebounce'
import { cn } from '@/lib/utils'

const TIPOS: { valor: TipoIniciativa; rotulo: string }[] = [
  { valor: 'corujao', rotulo: 'Corujão' }, { valor: 'launch', rotulo: 'Launch' },
  { valor: 'webinar', rotulo: 'Webinar' }, { valor: 'pontual', rotulo: 'Pontual' },
]
const TIMES: TimeComercial[] = ['IS', 'AE', 'ECONT']

const PASSOS = [
  { n: 1, rotulo: 'A base',     ajuda: 'de onde vêm as pessoas', icone: Database },
  { n: 2, rotulo: 'Os filtros', ajuda: 'quem sobra, etapa a etapa', icone: Filter },
  { n: 3, rotulo: 'A lista',    ajuda: 'confira e exporte', icone: ListChecks },
] as const

/**
 * O rascunho do fluxo sobrevive à navegação.
 *
 * O estado morava só em `useState`, e sair para "Listas geradas" e voltar
 * apagava nome, etapas, colunas e pesos — o trabalho inteiro. `sessionStorage`
 * porque o rascunho é da aba: fechar a janela descarta, o que é o esperado para
 * algo que ainda não virou lista.
 */
const CHAVE_RASCUNHO = 'qualificador:fluxo:rascunho'

interface Rascunho {
  passo: 1 | 2 | 3
  nome: string
  tipo: TipoIniciativa
  times: TimeComercial[]
  antiFadiga: number
  perdidoDias: number
  pularBloqueio: boolean
  etapas: Etapa[]
  pesos: Record<string, number>
  listaId: string | null
}

function lerRascunho(): Partial<Rascunho> {
  // pode lançar em aba anônima ou com armazenamento bloqueado: sem rascunho é
  // um começo válido, não um erro
  try {
    return JSON.parse(sessionStorage.getItem(CHAVE_RASCUNHO) ?? '{}') as Partial<Rascunho>
  } catch {
    return {}
  }
}

function gravarRascunho(r: Rascunho) {
  try {
    sessionStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(r))
  } catch { /* quota ou armazenamento bloqueado: não vale derrubar a tela */ }
}

/**
 * O caminho principal do app: uma jornada linear, do arquivo à planilha.
 *
 * As telas de Importar / Iniciativas / Listas continuam existindo em "Avançado" —
 * elas são as mesmas peças, avulsas. Aqui elas viram uma sequência, porque é
 * assim que o trabalho acontece de verdade: sobe a base da Assiny, cruza com as
 * plataformas, estreita, exporta.
 */
export function FluxoPage() {
  const qc = useQueryClient()
  const [inicial] = useState(lerRascunho)
  const [passo, setPasso] = useState<1 | 2 | 3>(inicial.passo ?? 1)

  // ---------------------------------------------------------------- passo 1
  const [progresso, setProgresso] = useState<Progresso | null>(null)
  const [analises, setAnalises] = useState<Analise[]>([])
  const [camposArquivo, setCamposArquivo] = useState<CampoCanonico[]>([])
  /**
   * Mais de um arquivo abre uma pergunta antes de processar.
   *
   * Soltar três relatórios e ver o app começar a ler os três sem dizer o que vai
   * fazer com quem aparece em dois deles é o tipo de coisa que só se descobre
   * depois. A pergunta é curta e o padrão é o que quase sempre se quer.
   */
  const [aConfirmar, setAConfirmar] = useState<File[] | null>(null)

  function receberArquivos(arquivos: File[]) {
    if (arquivos.length > 1) setAConfirmar(arquivos)
    else analisar.mutate(arquivos)
  }

  const importacoes = useQuery({ queryKey: ['importacoes'], queryFn: () => listarImportacoes(20) })

  const analisar = useMutation({
    mutationFn: (arquivos: File[]) => analisarArquivos(arquivos, {
      aoProgresso: setProgresso,
    }),
    onSettled: () => setProgresso(null),
    onSuccess: (r) => {
      const bons = r.analisados.filter((a) => !a.erro)
      for (const a of r.analisados.filter((x) => x.erro)) {
        toast.error(a.arquivo, { description: a.erro })
      }
      setAnalises((atuais) => [...atuais, ...bons])
      setCamposArquivo(r.campos)
      if (bons.length) {
        toast.info(`${bons.length} planilha(s) lida(s)`, {
          description: 'Confira o de-para das colunas antes de importar.',
        })
      }
      qc.invalidateQueries({ queryKey: ['importacoes'] })
    },
    onError: (e: Error) =>
      toast.error('Não foi possível ler os arquivos', { description: e.message }),
  })

  // ---------------------------------------------------------------- passo 2
  const [nome, setNome] = useState(inicial.nome ?? '')
  const [tipo, setTipo] = useState<TipoIniciativa>(inicial.tipo ?? 'corujao')
  const [times, setTimes] = useState<TimeComercial[]>(inicial.times ?? ['IS'])
  const [antiFadiga, setAntiFadiga] = useState(inicial.antiFadiga ?? 7)
  const [perdidoDias, setPerdidoDias] = useState(inicial.perdidoDias ?? 15)
  /**
   * Desligar as regras de segurança inteiras.
   *
   * Elas existem para não disparar para quem não pode receber, e por isso são o
   * padrão. Mas nem toda lista vira disparo: conferir se as vendas da Assiny
   * constam como ganho no CRM é auditoria, e aí cortar quem está "em conexão" ou
   * "perdido há ≤ 15 dias" esconde justamente os casos que se quer achar.
   * Medido numa conferência real: 71 pessoas com os bloqueios desligados, 27 com
   * eles ligados — e as 44 que somem são dado, não ruído.
   */
  const [pularBloqueio, setPularBloqueio] = useState(inicial.pularBloqueio ?? false)
  const [etapas, setEtapas] = useState<Etapa[]>(inicial.etapas ?? [])
  /**
   * Desfazer o funil, e só ele.
   *
   * Remover uma etapa é um clique num ícone de lixeira sem confirmação, e a
   * etapa levava junto as colunas e o rótulo que a pessoa escreveu. Sem
   * histórico, o único caminho de volta era remontar tudo à mão.
   *
   * Guarda 20 passos porque montar um funil é uma sequência de ajustes miúdos —
   * e vive fora do rascunho de propósito: recarregar a aba recomeça o histórico,
   * mas não perde o funil.
   */
  const [historico, setHistorico] = useState<Etapa[][]>([])
  function mudarEtapas(novas: Etapa[]) {
    setHistorico((h) => [...h, etapas].slice(-20))
    setEtapas(novas)
  }
  function desfazer() {
    // os dois `set` são independentes de propósito: chamar `setEtapas` de dentro
    // do updater de `setHistorico` é efeito colateral em função que o StrictMode
    // executa duas vezes
    if (historico.length === 0) return
    setEtapas(historico[historico.length - 1])
    setHistorico(historico.slice(0, -1))
  }
  const [pesos, setPesos] = useState<Record<string, number>>(inicial.pesos ?? {})

  const perfis = useQuery({ queryKey: ['perfis'], queryFn: listarPerfis })

  const config = useMemo(() => ({
    pesos, times, anti_fadiga_dias: antiFadiga, excluir_perdido_dias: perdidoDias,
    pular_bloqueio_duro: pularBloqueio,
  }), [pesos, times, antiFadiga, perdidoDias, pularBloqueio])

  /**
   * O funil recalcula com atraso, de propósito.
   *
   * Cada tecla num campo de valor era uma chamada à RPC: arrastar um mínimo de
   * 0 a 10 enfileirava dez recálculos de 384 ms, e nada garantia que o último a
   * chegar fosse o da última pergunta. `obsoleto` é o que separa "o número está
   * sendo recalculado" de "o número na tela responde a outra pergunta" — e é
   * ele que trava o botão de avançar.
   */
  const [etapasQ, etapasMudando] = useDebounceComEstado(etapas)
  const [configQ, configMudando] = useDebounceComEstado(config)

  const calcular = useQuery({
    queryKey: ['funil', etapasQ, configQ],
    queryFn: () => calcularFunil(etapasQ, configQ),
    enabled: passo >= 2,
    // segura o funil anterior enquanto recalcula, em vez de piscar para vazio.
    // Era um `useState` espelhado por `useEffect`, e ele tinha um efeito
    // colateral grave: em erro o espelho ficava `[]` e a tela mostrava
    // "universo 0 · lista final 0" — um número inventado, indistinguível de um
    // funil que de fato não sobrou ninguém. Erro tem que aparecer como erro.
    placeholderData: (anterior) => anterior,
  })

  const funil: LinhaFunil[] = calcular.data ?? []
  const funilFalhou = calcular.isError && !calcular.data
  // o número na tela ainda não responde ao que está montado
  const obsoleto = etapasMudando || configMudando || calcular.isFetching
  const final = funil.find((l) => l.ordem === 999)?.saem_aqui ?? 0
  const universo = funil[0] ? funil[0].saem_aqui + funil[0].restam : 0
  const semPeso = Object.values(pesos).every((v) => !v)

  // ---------------------------------------------------------------- passo 3
  const [listaId, setListaId] = useState<string | null>(inicial.listaId ?? null)

  // guarda o rascunho a cada mudança: sair da aba e voltar não pode custar o funil
  useEffect(() => {
    gravarRascunho({ passo, nome, tipo, times, antiFadiga, perdidoDias, pularBloqueio, etapas, pesos, listaId })
  })


  const previa = useQuery({
    queryKey: ['previa', etapas, config],
    queryFn: () => pessoasDaEtapa(etapas, config, null, 50),
    enabled: passo === 3 && final > 0,
  })
  const colunas = useQuery({
    queryKey: ['colunas-resolvidas', colunasDe(etapas)],
    queryFn: () => resolverColunas(colunasDe(etapas)),
    enabled: passo === 3 && colunasDe(etapas).length > 0,
  })

  const gerar = useMutation({
    mutationFn: async () => {
      const ini = await salvarIniciativa({
        nome: nome.trim() || 'Iniciativa sem nome', tipo, objetivo: nome.trim(),
        times, prioridade_times: times, anti_fadiga_dias: antiFadiga,
        excluir_perdido_dias: perdidoDias, pesos, etapas,
      } as Partial<Iniciativa> & { etapas: Etapa[] })
      return gerarLista(ini.id, etapas, config)
    },
    onSuccess: (r) => {
      setListaId(r.lista_id)
      toast.success('Lista gerada', {
        description: `${formatarNumero(r.total)} pessoas · ` +
          Object.entries(r.por_time).map(([t, n]) => `${t}: ${n}`).join(' · '),
      })
      qc.invalidateQueries({ queryKey: ['listas'] })
    },
    onError: (e: Error) => toast.error('Não foi possível gerar', { description: e.message }),
  })

  const baixar = useMutation({
    mutationFn: () => baixarLista(listaId!, nome.trim() || 'lista'),
    onSuccess: (arquivo) => toast.success('Arquivo baixado', { description: arquivo }),
    onError: (e: Error) => toast.error('Não foi possível exportar', { description: e.message }),
  })

  const guardar = useMutation({
    mutationFn: () => salvarModelo({
      nome: nome.trim() || 'Modelo sem nome', etapas, pesos, config,
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

  /**
   * Um modelo ou recorte escolhido vira ETAPAS, não um estado paralelo.
   *
   * Substitui o funil inteiro de propósito: "começar de um modelo" é começar,
   * não misturar. E passa por `mudarEtapas`, então o Desfazer alcança —
   * carregar o modelo errado com quatro cartões montados não custa o trabalho.
   */
  function aplicarModelo(
    novas: Etapa[],
    extras?: {
      pesos?: Record<string, number>
      perfil?: string | null
      /** modelo salvo: traz nome, times e as janelas junto com as etapas */
      modelo?: ModeloFluxo
    },
  ) {
    mudarEtapas(novas)
    if (extras?.pesos) setPesos(extras.pesos)
    else if (extras?.perfil) aplicarPerfil(extras.perfil)

    const m = extras?.modelo
    if (m) {
      setNome(m.nome)
      const c = (m.config ?? {}) as Record<string, unknown>
      if (Array.isArray(c.times)) setTimes(c.times as TimeComercial[])
      if (typeof c.anti_fadiga_dias === 'number') setAntiFadiga(c.anti_fadiga_dias)
      if (typeof c.excluir_perdido_dias === 'number') setPerdidoDias(c.excluir_perdido_dias)
      // um modelo de conferência guarda que não quer os bloqueios; um de disparo,
      // que quer. A escolha é do modelo, não do último estado da tela.
      if (typeof c.pular_bloqueio_duro === 'boolean') setPularBloqueio(c.pular_bloqueio_duro)
    }
  }

  function aplicarPerfil(slug: string) {
    const p = perfis.data?.find((x) => x.slug === slug)
    if (!p) return
    setPesos(p.pesos)
    toast.info(`Pesos de "${p.nome}"`, { description: p.observacao ?? undefined })
  }


  return (
    <>
      <TrilhaDePassos passo={passo} aoIr={setPasso} />

      {passo === 1 && (
        <div className="space-y-6">
          <ZonaDeUpload
            progresso={progresso}
            ocupado={analisar.isPending}
            aoReceber={receberArquivos}
            titulo="Solte os relatórios da Assiny aqui — pode ser mais de um"
            ajuda="Ou clique para escolher. O app lê as colunas e pergunta o de-para antes de gravar."
          />

          {aConfirmar && (
            <ConfirmarVariosArquivos
              arquivos={aConfirmar}
              aoMesclar={() => { analisar.mutate(aConfirmar); setAConfirmar(null) }}
              aoSeparar={() => {
                // um de cada vez: a pessoa confere a contribuição de cada
                // arquivo antes de soltar o próximo
                analisar.mutate([aConfirmar[0]])
                setAConfirmar(aConfirmar.length > 1 ? aConfirmar.slice(1) : null)
              }}
              aoCancelar={() => setAConfirmar(null)}
            />
          )}

          {analises.length > 0 && (
            <div className="space-y-6">
              {analises.map((a) => (
                <MapeamentoArquivo
                  key={a.importacao_id}
                  analise={a}
                  campos={camposArquivo}
                  aoConcluir={() => {
                    const restantes = analises.filter((y) => y.importacao_id !== a.importacao_id)
                    setAnalises(restantes)
                    qc.invalidateQueries({ queryKey: ['importacoes'] })
                    qc.invalidateQueries({ queryKey: ['funil'] })
                    qc.invalidateQueries({ queryKey: ['origens'] })
                    // o último arquivo leva junto para a Etapa 2: importar não é
                    // o objetivo de ninguém, é o que se faz para poder filtrar
                    if (restantes.length === 0) {
                      setPasso(2)
                      toast.success('Base importada', {
                        description: 'Escolha de onde consultar para começar a filtrar.',
                      })
                    } else {
                      toast.success('Arquivo importado', {
                        description: `Faltam ${restantes.length}.`,
                      })
                    }
                  }}
                  aoDescartar={() =>
                    setAnalises((x) => x.filter((y) => y.importacao_id !== a.importacao_id))}
                />
              ))}
            </div>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-heading">O que já está no app</CardTitle>
            </CardHeader>
            <CardContent>
              {importacoes.data?.length ? (
                <ul className="space-y-1.5">
                  {importacoes.data.map((i) => (
                    <li key={i.id} className="flex items-baseline justify-between gap-3 text-label">
                      <span className="truncate">
                        {i.nome ?? i.arquivo}
                        <Badge variant={i.status === 'ingerido' ? 'secondary' : 'destructive'}
                          className="ml-2 text-micro">
                          {i.status === 'ingerido' ? 'pronto' : i.status}
                        </Badge>
                      </span>
                      {/* "327 novas de 1.853" lia-se como se 1.526 tivessem
                          falhado. São 1.853 linhas do arquivo que produziram 327
                          pessoas que o app ainda não conhecia — o resto já
                          estava lá, e isso é o esperado, não uma perda. */}
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatarNumero(i.linhas_lidas)} linhas ·{' '}
                        {formatarNumero(i.linhas_novas)} pessoas novas
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-4 text-center text-label text-muted-foreground">
                  Nenhuma base importada ainda.
                </p>
              )}
              <p className="mt-4 text-micro text-muted-foreground">
                Não precisa subir nada agora se a base já está aqui — siga para os filtros.
                As plataformas (HubSpot, Sellflux, MemberClass, MemberKit) são cruzadas
                automaticamente, em Avançado → Integrações.
              </p>
            </CardContent>
          </Card>

          {/* O botão "Ir para os filtros" saiu: a ingestão leva sozinha. Ele
              continua fazendo falta em um caso — a base já está no app e não há
              nada a subir — e para esse caso a trilha de passos no topo já
              serve. */}
        </div>
      )}

      {passo === 2 && (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-6">
            {/* Recolhido por padrão: nome, tipo, times e as duas janelas só
                importam na hora de gerar, e ocupavam o topo da tela durante todo
                o tempo em que a pessoa está montando o funil. */}
            <details className="rounded-xl border border-border bg-card">
              <summary className="cursor-pointer px-6 py-3 text-heading">
                Configuração do disparo
                <span className="ml-2 text-label font-normal text-muted-foreground">
                  {nome || 'sem nome'} · {TIPOS.find((t) => t.valor === tipo)?.rotulo}
                  {times.length > 0 && ` · ${times.join(' → ')}`}
                </span>
              </summary>
              <div className="grid gap-4 border-t border-border px-6 py-4 sm:grid-cols-2">
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
                          ? times.filter((x) => x !== t) : [...times, t])}
                        className={cn('rounded-lg border px-3 py-1 text-label transition-colors',
                          times.includes(t)
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground')}>
                        {t}{times.includes(t) && ` · ${times.indexOf(t) + 1}º`}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="af">Anti-fadiga (dias)</Label>
                  <Input id="af" type="number" min={7} value={antiFadiga}
                    onChange={(e) => setAntiFadiga(Math.max(7, Number(e.target.value)))} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pd">Excluir perdido há (dias)</Label>
                  <Input id="pd" type="number" min={0} value={perdidoDias}
                    onChange={(e) => setPerdidoDias(Number(e.target.value))} />
                  <p className="text-micro text-muted-foreground">
                    É o maior dos bloqueios. 0 desliga só ele.
                  </p>
                </div>

                <label className="flex items-start justify-between gap-4 rounded-lg bg-muted/40 px-3 py-2 sm:col-span-2">
                  <span className="text-label">
                    Desligar todas as regras de segurança
                    <span className="mt-0.5 block text-micro text-muted-foreground">
                      {pularBloqueio
                        ? 'Modo conferência: ninguém é cortado por opt-out, cadência ou perda recente. Use para auditar, não para disparar.'
                        : 'Recomendado. Opt-out, cadência automática, falha de entrega e perda recente cortam antes dos seus filtros.'}
                    </span>
                  </span>
                  <Switch checked={pularBloqueio} onCheckedChange={setPularBloqueio}
                    aria-label="Desligar regras de segurança" />
                </label>
              </div>
            </details>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-heading">O funil, etapa a etapa</CardTitle>
                  <div className="flex items-center gap-1">
                    <PainelDeModelos aoAplicar={aplicarModelo} />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5"
                      onClick={desfazer}
                      disabled={historico.length === 0}
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      Desfazer
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ConstrutorEtapas etapas={etapas} aoMudar={mudarEtapas} iniciativa={config} />
              </CardContent>
            </Card>

          </div>

          <div className="lg:sticky lg:top-20 lg:self-start">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-heading">
                  Funil
                  {obsoleto && (
                    <span className="text-micro font-normal text-muted-foreground">recalculando…</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {funilFalhou ? (
                  <div className="space-y-3 rounded-lg bg-destructive/10 px-3 py-3 text-label text-destructive">
                    <p className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <span>
                        Não consegui calcular o funil. Os números abaixo seriam inventados,
                        então não mostro nenhum.
                      </span>
                    </p>
                    <p className="text-micro opacity-80">{(calcular.error as Error)?.message}</p>
                    <Button variant="outline" size="sm" onClick={() => calcular.refetch()}>
                      Tentar de novo
                    </Button>
                  </div>
                ) : (
                  <FunilExclusao funil={funil} carregando={obsoleto}
                    etapas={etapasQ} iniciativa={configQ} />
                )}

                {!funilFalhou && universo > 0 && final === 0 && etapas.length > 0 && (
                  <p className="mt-4 rounded-lg bg-warning/15 px-3 py-2 text-label text-warning">
                    Nenhuma pessoa sobrou. Alguma etapa pode estar cortando por dado que ainda
                    não sincronizou — experimente ligar "manter quem não tem esse dado" nela.
                  </p>
                )}
                {semPeso && final > 0 && (
                  <p className="mt-4 flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-label text-muted-foreground">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Sem nenhum peso, todo mundo fica com score 0 e a lista sai sem ordem.
                  </p>
                )}

                <div className="mt-4 flex gap-2">
                  <Button variant="outline" className="gap-2" onClick={() => setPasso(1)}>
                    <ArrowLeft className="h-4 w-4" /> Base
                  </Button>
                  <Button className="flex-1 gap-2" disabled={final === 0 || obsoleto}
                    onClick={() => setPasso(3)}>
                    Ver os {formatarNumero(final)} <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>

                <Button variant="ghost" className="mt-2 w-full gap-2 text-label"
                  disabled={etapas.length === 0 || guardar.isPending}
                  onClick={() => guardar.mutate()}>
                  <BookmarkPlus className="h-3.5 w-3.5" />
                  {guardar.isPending ? 'Salvando…' : 'Salvar como modelo'}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {passo === 3 && (
        <div className="space-y-6">
          {/* Os pesos vieram da Etapa 2 para cá: ordenar só faz sentido vendo
              quem sobrou. Na Etapa 2 eles competiam com os filtros pela atenção
              e não mudavam nenhum número da tela. */}
          <div className="grid gap-6 lg:grid-cols-[340px_1fr] lg:items-start">
            <div className="lg:sticky lg:top-20">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-heading">Como ordenar estes</CardTitle>
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
                        aria-label={`Peso de ${eixo.rotulo}`}
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
                  A tabela ao lado reordena junto.
                </p>
              </CardContent>
            </Card>
            </div>
            <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-heading">
                <span>
                  {nome.trim() || 'Sua lista'}
                  <Badge variant="secondary" className="ml-2">{formatarNumero(final)} pessoas</Badge>
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" className="gap-2" onClick={() => setPasso(2)}>
                    <ArrowLeft className="h-4 w-4" /> Ajustar filtros
                  </Button>
                  {listaId ? (
                    <Button className="gap-2" disabled={baixar.isPending}
                      onClick={() => baixar.mutate()}>
                      <Download className="h-4 w-4" />
                      {baixar.isPending ? 'Gerando…' : 'Baixar XLSX'}
                    </Button>
                  ) : (
                    <Button className="gap-2" disabled={gerar.isPending || times.length === 0}
                      onClick={() => gerar.mutate()}>
                      <Check className="h-4 w-4" />
                      {gerar.isPending ? 'Gerando…' : 'Gerar a lista'}
                    </Button>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-label text-muted-foreground">
                {listaId
                  ? 'Lista gravada. O arquivo é regerado do banco a cada download — nada fica guardado. Quem dispara sobe na Sellflux; o app nunca envia nada.'
                  : 'Prévia das 50 primeiras por score. Gerar a lista congela estas pessoas e estas colunas.'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              {previa.isLoading ? (
                <Skeleton className="h-64" />
              ) : (
                <div className="max-h-[60vh] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>E-mail</TableHead>
                        <TableHead>Telefone</TableHead>
                        <TableHead className="text-right">Score</TableHead>
                        {(colunas.data ?? []).map((c) => (
                          <TableHead key={c.id}>{c.rotulo}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {((previa.data ?? []) as Record<string, unknown>[]).map((p) => (
                        <TableRow key={String(p.pessoa_id)}>
                          <TableCell className="text-label">{String(p.nome ?? '—')}</TableCell>
                          <TableCell className="text-label text-muted-foreground">
                            {String(p.email ?? '—')}
                          </TableCell>
                          <TableCell className="text-label text-muted-foreground">
                            {String(p.telefone ?? '—')}
                          </TableCell>
                          <TableCell className="text-right text-label tabular-nums">
                            {Number(p.score ?? 0).toFixed(1)}
                            <span className="ml-1 text-muted-foreground">{String(p.faixa ?? '')}</span>
                          </TableCell>
                          {(colunas.data ?? []).map((c) => (
                            <TableCell key={c.id} className="max-w-[220px] truncate text-label">
                              {mostrar((p.extras as Record<string, unknown> | null)?.[c.id])}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {(previa.data ?? []).length >= 50 && (
                    <p className="p-3 text-center text-micro text-muted-foreground">
                      Mostrando as 50 primeiras por score. O arquivo traz todas.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * O que fazer com vários arquivos de uma vez.
 *
 * Uma ressalva que a tela precisa dizer, porque é contraintuitiva: **as duas
 * opções produzem o mesmo banco**. `qualificador.pessoa` não tem coluna de lote,
 * e a ingestão faz upsert por e-mail → documento → telefone; a mesma pessoa em
 * dois arquivos vira uma linha nos dois caminhos. Prometer isolamento aqui seria
 * mentir sobre o que o schema faz.
 *
 * O que muda de verdade é o RITMO: mesclar processa tudo de uma vez, separar
 * processa um por vez para você conferir a contribuição de cada arquivo antes
 * de soltar o próximo. Isolar universos de verdade exigiria uma coluna de lote
 * em pessoa/transacao e um filtro por lote no funil — decisão de produto, não
 * de tela.
 */
function ConfirmarVariosArquivos({
  arquivos, aoMesclar, aoSeparar, aoCancelar,
}: {
  arquivos: File[]
  aoMesclar: () => void
  aoSeparar: () => void
  aoCancelar: () => void
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-heading">
          {arquivos.length} arquivos de uma vez
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="flex flex-wrap gap-1.5">
          {arquivos.map((a) => (
            <Badge key={a.name} variant="secondary" className="font-normal">{a.name}</Badge>
          ))}
        </ul>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            onClick={aoMesclar}
            className="rounded-lg border border-primary bg-primary/5 p-3 text-left transition-colors hover:bg-primary/10"
          >
            <span className="block text-label font-medium">Mesclar num universo só</span>
            <span className="mt-0.5 block text-micro text-muted-foreground">
              Lê os {arquivos.length} de uma vez. Recomendado.
            </span>
          </button>
          <button
            onClick={aoSeparar}
            className="rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted"
          >
            <span className="block text-label font-medium">Tratar separados</span>
            <span className="mt-0.5 block text-micro text-muted-foreground">
              Um de cada vez, para conferir o de-para e a contagem de cada um.
            </span>
          </button>
        </div>

        <p className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-micro text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Nos dois casos, quem aparece em mais de um arquivo continua sendo{' '}
          <strong>uma pessoa só</strong> — o cruzamento é por e-mail, depois
          documento, depois telefone. O que muda é o ritmo da conferência, não o
          resultado no banco.
        </p>

        <Button variant="ghost" size="sm" onClick={aoCancelar}>Cancelar</Button>
      </CardContent>
    </Card>
  )
}

function TrilhaDePassos({
  passo, aoIr,
}: {
  passo: 1 | 2 | 3
  aoIr: (p: 1 | 2 | 3) => void
}) {
  return (
    <nav aria-label="Passos" className="mb-8">
      <ol className="flex flex-wrap items-stretch gap-2">
        {PASSOS.map((p) => {
          const Icone = p.icone
          const atual = p.n === passo
          const feito = p.n < passo
          return (
            <li key={p.n} className="min-w-[180px] flex-1">
              <button
                onClick={() => aoIr(p.n as 1 | 2 | 3)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                  atual ? 'border-primary bg-primary/10'
                    : feito ? 'border-border bg-muted/40 hover:bg-muted'
                    : 'border-border text-muted-foreground hover:bg-muted/30',
                )}
                aria-current={atual ? 'step' : undefined}
              >
                <span className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                  atual ? 'bg-primary text-primary-foreground'
                    : feito ? 'bg-muted-foreground/20' : 'bg-muted',
                )}>
                  {feito ? <Check className="h-4 w-4" /> : <Icone className="h-4 w-4" />}
                </span>
                <span className="min-w-0">
                  <span className={cn('block truncate text-label',
                    atual && 'font-medium text-primary')}>
                    {p.n}. {p.rotulo}
                  </span>
                  <span className="block truncate text-micro text-muted-foreground">{p.ajuda}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
