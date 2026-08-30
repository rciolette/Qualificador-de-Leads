import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle, ChevronDown, ChevronUp, Columns3, GripVertical, Plus, Trash2, Users, X,
} from 'lucide-react'
import {
  listarCampos, listarCobertura, valoresDe, normalizarEtapa, OPERADORES, SEM_VALOR,
  quemSaiu, FONTES_DA_ORIGEM,
  type CampoFiltravel, type Condicao, type Etapa, type Iniciativa, type Origem,
  type QuemSaiuItem,
} from '@/lib/iniciativas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent } from '@/components/ui/card'
import { SeletorDeCampo } from '@/components/SeletorDeCampo'
import { SeletorDeOrigem } from '@/components/SeletorDeOrigem'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

let contador = 0
const novoId = () => `etapa_${Date.now()}_${contador++}`

const CONDICAO_VAZIA: Condicao = { fonte: '', campo: '', operador: '', valor: undefined }

export function ConstrutorEtapas({
  etapas, aoMudar, iniciativa,
}: {
  etapas: Etapa[]
  aoMudar: (e: Etapa[]) => void
  /** para o rodapé do cartão dizer quem saiu ali, com os mesmos parâmetros do funil */
  iniciativa: Partial<Iniciativa>
}) {
  const campos = useQuery({ queryKey: ['campos'], queryFn: listarCampos })

  const porGrupo = useMemo(() => {
    const m = new Map<string, CampoFiltravel[]>()
    for (const c of campos.data ?? []) {
      const g = c.grupo ?? 'Outros'
      m.set(g, [...(m.get(g) ?? []), c])
    }
    return m
  }, [campos.data])

  // modelo salvo no formato antigo vira formato novo ao entrar na tela:
  // o motor aceita os dois, mas o editor só sabe mexer no novo
  const normalizadas = useMemo(() => etapas.map(normalizarEtapa), [etapas])

  /**
   * O seletor de origem abre sozinho quando não há etapa nenhuma: a primeira
   * pergunta de quem chega aqui é "de onde eu consulto?", e uma tela vazia com
   * um botão não responde isso.
   */
  const [escolhendoOrigem, setEscolhendoOrigem] = useState(etapas.length === 0)

  function adicionarDaOrigem(origem: Origem) {
    aoMudar([...normalizadas, {
      id: novoId(), rotulo: '', ativa: true, origem: origem.slug,
      combinador: 'qualquer', condicoes: [{ ...CONDICAO_VAZIA }], colunas: [],
    }])
    setEscolhendoOrigem(false)
  }

  /**
   * "Filtrar de novo aqui" é outra coisa de "Consultar outra origem", e os
   * nomes precisam dizer isso. Uma condição a mais no mesmo cartão é uma
   * pergunta a mais sobre a MESMA plataforma, combinada por E/OU; um cartão
   * novo é outra plataforma, aplicada a quem sobrou do anterior. Um botão só
   * chamado "adicionar" deixava as duas indistinguíveis.
   */
  function filtrarDeNovoNoUltimo() {
    if (normalizadas.length === 0) return
    const i = normalizadas.length - 1
    atualizar(i, { condicoes: [...(normalizadas[i].condicoes ?? []), { ...CONDICAO_VAZIA }] })
  }

  function atualizar(i: number, mudanca: Partial<Etapa>) {
    aoMudar(normalizadas.map((e, k) => (k === i ? { ...e, ...mudanca } : e)))
  }

  function remover(i: number) {
    aoMudar(normalizadas.filter((_, k) => k !== i))
  }

  function mover(i: number, delta: number) {
    const j = i + delta
    if (j < 0 || j >= normalizadas.length) return
    const copia = [...normalizadas]
    ;[copia[i], copia[j]] = [copia[j], copia[i]]
    aoMudar(copia)
  }

  return (
    <div className="space-y-3">
      {normalizadas.map((etapa, i) => (
        <CartaoEtapa
          key={etapa.id}
          etapa={etapa}
          indice={i}
          total={normalizadas.length}
          porGrupo={porGrupo}
          campos={campos.data ?? []}
          etapas={normalizadas}
          iniciativa={iniciativa}
          aoAtualizar={(m) => atualizar(i, m)}
          aoRemover={() => remover(i)}
          aoMover={(d) => mover(i, d)}
        />
      ))}

      {escolhendoOrigem ? (
        <SeletorDeOrigem
          aoEscolher={adicionarDaOrigem}
          aoCancelar={normalizadas.length > 0 ? () => setEscolhendoOrigem(false) : undefined}
        />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" className="gap-2" onClick={() => setEscolhendoOrigem(true)}>
            <Plus className="h-4 w-4" /> Consultar outra origem
          </Button>
          <Button variant="ghost" className="gap-2" onClick={filtrarDeNovoNoUltimo}
            disabled={normalizadas.length === 0}>
            <Plus className="h-4 w-4" /> Filtrar de novo aqui
          </Button>
        </div>
      )}

      {normalizadas.length === 0 && !escolhendoOrigem && (
        <p className="text-label text-muted-foreground">
          Cada cartão recebe quem sobrou do anterior.
        </p>
      )}
    </div>
  )
}

function CartaoEtapa({
  etapa, indice, total, porGrupo, campos, etapas, iniciativa,
  aoAtualizar, aoRemover, aoMover,
}: {
  etapa: Etapa
  indice: number
  total: number
  porGrupo: Map<string, CampoFiltravel[]>
  campos: CampoFiltravel[]
  etapas: Etapa[]
  iniciativa: Partial<Iniciativa>
  aoAtualizar: (m: Partial<Etapa>) => void
  aoRemover: () => void
  aoMover: (delta: number) => void
}) {
  // o motor numera as etapas do usuário a partir de 10 (1-8 são bloqueio duro)
  const ordemNoFunil = indice + 10
  const fontes = etapa.origem ? FONTES_DA_ORIGEM[etapa.origem] : undefined
  const condicoes = etapa.condicoes ?? []
  const varias = condicoes.length > 1

  /**
   * A mesma regra do motor, para a tela não discordar dele: condição sem campo,
   * sem operador, ou com operador que pede valor e não tem, é ignorada. Etapa
   * cujas condições foram todas ignoradas não corta ninguém — e precisa dizer
   * isso, senão "não cortou" fica igual a "cortou zero".
   */
  const incompleta = condicoes.every((c) => {
    const k = campos.find((x) => x.fonte === c.fonte && x.caminho === c.campo)
    if (!k || !c.operador) return true
    if (SEM_VALOR.has(c.operador)) return false
    return c.valor === undefined || c.valor === null || c.valor === ''
      || (Array.isArray(c.valor) && c.valor.length === 0)
  })

  function mudarCondicao(k: number, m: Partial<Condicao>) {
    aoAtualizar({ condicoes: condicoes.map((c, i) => (i === k ? { ...c, ...m } : c)) })
  }

  /**
   * Escolher o campo muda TRÊS coisas — a condição, a coluna trazida e (se
   * estiver vazio) o rótulo da etapa. Tem que ser uma atualização só.
   *
   * Eram três chamadas de `aoAtualizar` em sequência, e cada uma montava o
   * objeto a partir do `etapa` do render atual: a última sobrescrevia as
   * anteriores. O sintoma era silencioso e enganoso — a coluna aparecia, o
   * rótulo aparecia, e a condição ficava vazia. O funil então cortava todo
   * mundo, porque uma condição sem campo nunca é satisfeita.
   */
  function escolherCampo(k: number, novo: CampoFiltravel) {
    const cols = etapa.colunas ?? []
    aoAtualizar({
      condicoes: condicoes.map((c, i) => (i === k ? {
        ...c,
        fonte: novo.fonte,
        campo: novo.caminho,
        operador: novo.operadores[0] ?? '',
        valor: undefined,
        // só o negócio é coleção por pessoa; nas outras fontes não faz sentido
        quantificador: novo.fonte === 'hubspot_negocio'
          ? ('algum' as const)
          : undefined,
      } : c)),
      // quem filtra por um campo quase sempre quer vê-lo na planilha
      colunas: cols.includes(novo.id) ? cols : [...cols, novo.id],
      // o rótulo só é sugerido enquanto o usuário não escreveu o dele
      ...(etapa.rotulo ? {} : { rotulo: novo.rotulo }),
    })
  }

  function addCondicao() {
    aoAtualizar({ condicoes: [...condicoes, { ...CONDICAO_VAZIA }] })
  }

  function tirarCondicao(k: number) {
    aoAtualizar({ condicoes: condicoes.filter((_, i) => i !== k) })
  }

  return (
    <Card
      id={`etapa-${indice}`}
      className={cn(
        !etapa.ativa && 'opacity-50',
        incompleta && 'border-dashed border-warning/60',
      )}
    >
      <CardContent className="space-y-3 pt-4">
        {incompleta && (
          <p role="status" className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-micro text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Etapa incompleta — ignorada no cálculo. Ela não tira ninguém da lista
            enquanto estiver assim.
          </p>
        )}
        <div className="flex items-center gap-2">
          <div className="flex flex-col">
            <button onClick={() => aoMover(-1)} disabled={indice === 0}
              className="text-muted-foreground disabled:opacity-30" aria-label="Subir">
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => aoMover(1)} disabled={indice === total - 1}
              className="text-muted-foreground disabled:opacity-30" aria-label="Descer">
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>
          <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Badge variant="secondary" className="shrink-0">{indice + 1}ª</Badge>
          <Input
            value={etapa.rotulo}
            onChange={(e) => aoAtualizar({ rotulo: e.target.value })}
            placeholder="Como chamar esta etapa no funil"
            className="flex-1"
          />
          <Switch checked={etapa.ativa}
            onCheckedChange={(v) => aoAtualizar({ ativa: v })}
            aria-label="Ativar etapa" />
          <Button variant="ghost" size="icon" onClick={aoRemover} aria-label="Remover">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {/* o combinador só faz sentido com duas ou mais condições */}
        {varias && (
          <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
            <span className="text-label text-muted-foreground">A pessoa segue se</span>
            <Select
              value={etapa.combinador ?? 'qualquer'}
              onValueChange={(v) => aoAtualizar({ combinador: v as 'qualquer' | 'todas' })}
            >
              <SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="qualquer">satisfizer qualquer uma</SelectItem>
                <SelectItem value="todas">satisfizer todas</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-label text-muted-foreground">das condições abaixo.</span>
          </div>
        )}

        <div className="space-y-2">
          {condicoes.map((cond, k) => (
            <LinhaCondicao
              key={k}
              condicao={cond}
              indice={k}
              podeRemover={condicoes.length > 1}
              campos={campos}
              fontes={fontes}
              aoMudar={(m) => mudarCondicao(k, m)}
              aoEscolherCampo={(novo) => escolherCampo(k, novo)}
              aoRemover={() => tirarCondicao(k)}
            />
          ))}
        </div>

        <Button variant="ghost" size="sm" className="gap-1.5 text-label" onClick={addCondicao}>
          <Plus className="h-3.5 w-3.5" /> Filtrar de novo aqui
        </Button>

        <ModoDaEtapa etapa={etapa} varias={varias} aoAtualizar={aoAtualizar} />

        <AvisoDeCobertura etapa={etapa} campos={campos} />

        <ColunasTrazidas
          etapa={etapa}
          campos={campos}
          porGrupo={porGrupo}
          aoAtualizar={aoAtualizar}
        />

        <QuemSaiuAqui etapas={etapas} iniciativa={iniciativa} ordem={ordemNoFunil} />
      </CardContent>
    </Card>
  )
}

/**
 * O que a etapa faz — três modos, não dois.
 *
 * Era um switch "manter quem não tem esse dado", que só sabia responder filtro
 * ou refino. Faltava o inverso: "quem comprou e NÃO tem conta na MemberClass" é
 * uma pergunta que o time comercial faz toda semana e que não dava para montar.
 *
 * Os três aparecem lado a lado de propósito. Escondidos atrás de um switch, o
 * segundo e o terceiro modo não existiam para quem não lia a documentação.
 */
function ModoDaEtapa({
  etapa, varias, aoAtualizar,
}: {
  etapa: Etapa
  varias: boolean
  aoAtualizar: (m: Partial<Etapa>) => void
}) {
  const atual = etapa.sem_dado ?? (etapa.manter_sem_dado ? 'manter' : 'excluir')

  const modos = [
    {
      v: 'excluir' as const,
      titulo: 'Tira da lista',
      curto: 'quem não bate sai',
      longo: varias
        ? 'Segue quem satisfaz a etapa. Quem não pôde ser julgado por nenhuma das condições sai.'
        : 'Segue quem satisfaz a etapa. Quem não está nessa plataforma sai.',
    },
    {
      v: 'manter' as const,
      titulo: 'Mantém na lista',
      curto: 'sem conta continua',
      longo: varias
        ? 'Segue quem satisfaz a etapa, e também quem nenhuma condição conseguiu julgar.'
        : 'Segue quem satisfaz a etapa, e também quem não está nessa plataforma.',
    },
    {
      v: 'apenas' as const,
      titulo: 'Só esses',
      curto: 'inverte a etapa',
      longo: 'Inverte: segue exatamente quem NÃO satisfaz a etapa — inclusive quem não tem o dado.',
    },
  ]

  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <p className="mb-2 text-micro uppercase text-muted-foreground">O que esta etapa faz</p>
      <div className="grid gap-1.5 sm:grid-cols-3">
        {modos.map((m) => (
          <button
            key={m.v}
            type="button"
            aria-pressed={atual === m.v}
            onClick={() => aoAtualizar({
              sem_dado: m.v,
              // o booleano antigo acompanha, para o caso de o modelo ser lido
              // por algo que ainda não conheça `sem_dado`
              manter_sem_dado: m.v === 'manter',
            })}
            className={cn(
              'rounded-md border px-2.5 py-2 text-left transition-colors',
              atual === m.v
                ? 'border-primary bg-background shadow-sm'
                : 'border-transparent hover:bg-background/60',
            )}
          >
            <span className={cn('block text-label',
              atual === m.v ? 'font-medium text-foreground' : 'text-muted-foreground')}>
              {m.titulo}
            </span>
            <span className="block text-micro text-muted-foreground">{m.curto}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-micro text-muted-foreground">
        {modos.find((m) => m.v === atual)?.longo}
      </p>
    </div>
  )
}

/**
 * Quantos da base a etapa pode alcançar, antes de ela rodar.
 *
 * Escolher um campo do MemberKit leva 4.430 pessoas a 105, e até aqui a única
 * forma de descobrir isso era gerar a lista e ver o número murchar — depois de
 * montar o fluxo inteiro. O teto é uma conta simples: como filtro, a etapa não
 * pode devolver mais gente do que tem o dado.
 *
 * Só avisa quando há o que avisar. Campo bem coberto não vira aviso, senão o
 * aviso perde o sentido de existir; e no modo refino a cobertura baixa não é
 * problema nenhum — é exatamente para isso que o refino serve.
 */
function AvisoDeCobertura({ etapa, campos }: { etapa: Etapa; campos: CampoFiltravel[] }) {
  const cobertura = useQuery({
    queryKey: ['cobertura'],
    queryFn: listarCobertura,
    staleTime: 10 * 60_000,
  })

  const modo = etapa.sem_dado ?? (etapa.manter_sem_dado ? 'manter' : 'excluir')
  if (modo !== 'excluir' || !cobertura.data?.size) return null

  const usados = (etapa.condicoes ?? [])
    .map((c) => campos.find((k) => k.fonte === c.fonte && k.caminho === c.campo))
    .filter((k): k is CampoFiltravel => Boolean(k))
    .map((k) => ({ campo: k, cob: cobertura.data!.get(k.id) }))
    .filter((x) => x.cob && x.cob.base > 0)
  if (usados.length === 0) return null

  // 'todas' exige o dado das duas pontas, então o teto é o campo mais escasso;
  // 'qualquer' basta uma, então o teto é o mais coberto
  const combinador = etapa.combinador ?? 'qualquer'
  const escolhido = usados.reduce((a, b) =>
    (combinador === 'todas'
      ? (a.cob!.com_dado <= b.cob!.com_dado ? a : b)
      : (a.cob!.com_dado >= b.cob!.com_dado ? a : b)))

  const { com_dado: com, base } = escolhido.cob!
  const pct = Math.round((100 * com) / base)
  if (pct >= 60) return null

  const grave = pct === 0
  return (
    <p
      role="status"
      className={cn(
        'flex items-start gap-2 rounded-lg px-3 py-2 text-micro',
        grave
          ? 'bg-destructive/10 text-destructive'
          : 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
      )}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        {grave ? (
          <>
            Ninguém da base tem <strong>{escolhido.campo.rotulo}</strong> preenchido.
            Como filtro, esta etapa zera a lista. Use “Mantém na lista”, ou sincronize a
            plataforma antes.
          </>
        ) : (
          <>
            <strong>{escolhido.campo.rotulo}</strong> existe para {com.toLocaleString('pt-BR')}{' '}
            das {base.toLocaleString('pt-BR')} pessoas ({pct}%). Como filtro, esta etapa
            devolve no máximo isso — quem não tem o dado sai.
          </>
        )}
      </span>
    </p>
  )
}

/**
 * "Ver quem saiu" — seis nomes e o porquê.
 *
 * O número do funil diz quantos saíram; ele não diz se saíram porque não têm o
 * dado ou porque têm e não servem. São diagnósticos opostos: `sem dado` se
 * resolve trocando o modo da etapa ou sincronizando a origem, `não atende` só
 * se resolve mexendo no operador. Sem isso, quem vê a lista murchar sincroniza
 * quando o problema era o filtro.
 *
 * Fechado por padrão e só consulta quando aberto: são 6 linhas de diagnóstico,
 * não algo que precise custar uma chamada a cada recálculo.
 */
function QuemSaiuAqui({
  etapas, iniciativa, ordem,
}: {
  etapas: Etapa[]
  iniciativa: Partial<Iniciativa>
  ordem: number
}) {
  const [aberto, setAberto] = useState(false)

  const amostra = useQuery({
    queryKey: ['quem-saiu', ordem, etapas, iniciativa],
    queryFn: () => quemSaiu(etapas, iniciativa, ordem),
    enabled: aberto,
  })

  const rotuloMotivo = (m: QuemSaiuItem['motivo']) =>
    m === 'sem_dado' ? 'sem dado' : m === 'nao_atende' ? 'não atende' : '—'

  return (
    <div className="rounded-lg border border-border">
      <button
        onClick={() => setAberto(!aberto)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-2 text-label">
          <Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          Ver quem saiu aqui
        </span>
        {aberto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {aberto && (
        <div className="border-t border-border p-3">
          {amostra.isLoading && (
            <p className="text-micro text-muted-foreground">buscando…</p>
          )}
          {amostra.isError && (
            <p className="text-micro text-destructive">
              {(amostra.error as Error).message}
            </p>
          )}
          {amostra.data?.length === 0 && (
            <p className="text-micro text-muted-foreground">
              Ninguém saiu nesta etapa.
            </p>
          )}
          <ul className="space-y-1">
            {(amostra.data ?? []).map((p) => (
              <li key={p.pessoa_id}
                className="flex items-baseline justify-between gap-3 text-label">
                <span className="min-w-0 truncate">
                  {p.nome ?? p.email ?? '—'}
                </span>
                <Badge
                  variant="outline"
                  className={cn('shrink-0 font-normal',
                    p.motivo === 'sem_dado' && 'border-amber-500/50 text-amber-700 dark:text-amber-400')}
                >
                  {rotuloMotivo(p.motivo)}
                </Badge>
              </li>
            ))}
          </ul>
          {(amostra.data?.length ?? 0) > 0 && (
            <p className="mt-2 text-micro text-muted-foreground">
              Amostra de 6. <strong>sem dado</strong> = a pessoa não está nessa
              plataforma; muda com “Mantém na lista” ou sincronizando a origem.{' '}
              <strong>não atende</strong> = está lá e não satisfaz; só muda mexendo
              na condição.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function LinhaCondicao({
  condicao, indice, podeRemover, campos, fontes,
  aoMudar, aoEscolherCampo, aoRemover,
}: {
  condicao: Condicao
  indice: number
  podeRemover: boolean
  campos: CampoFiltravel[]
  /** as fontes da plataforma do cartão: o seletor já abre restrito a elas */
  fontes?: string[]
  aoMudar: (m: Partial<Condicao>) => void
  aoEscolherCampo: (campo: CampoFiltravel) => void
  aoRemover: () => void
}) {
  const campo = campos.find((c) => c.caminho === condicao.campo && c.fonte === condicao.fonte)
  const precisaValor = condicao.operador && !SEM_VALOR.has(condicao.operador)
  const ehLista = campo?.tipo === 'lista' || campo?.tipo === 'enum'
  // só o negócio é coleção por pessoa: uma pessoa tem N deals, cada um com o campo
  const ehNegocio = condicao.fonte === 'hubspot_negocio'

  const valores = useQuery({
    queryKey: ['valores', campo?.fonte, campo?.caminho],
    queryFn: () => valoresDe(campo!),
    enabled: Boolean(campo && ehLista),
    staleTime: 5 * 60_000,
  })

  const selecionados: string[] = Array.isArray(condicao.valor) ? condicao.valor as string[] : []

  function alternar(v: string) {
    aoMudar({
      valor: selecionados.includes(v)
        ? selecionados.filter((x) => x !== v)
        : [...selecionados, v],
    })
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-micro uppercase text-muted-foreground">
          {podeRemover ? `${indice + 1}ª condição` : 'Condição'}
        </span>
        {podeRemover && (
          <button onClick={aoRemover} aria-label="Remover condição"
            className="text-muted-foreground hover:text-destructive">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Uma frase, não três colunas rotuladas.
          ONDE CONSULTAR / CONDIÇÃO / VALOR obrigava a ler três cabeçalhos para
          entender uma regra que se diz numa linha — e os cabeçalhos não eram
          nem os termos do negócio. "Manter quem tem 3 ou mais aulas assistidas"
          é a mesma informação, na ordem em que se pensa nela. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-label text-muted-foreground">Manter quem</span>

        <div className="min-w-[12rem] flex-1">
          <SeletorDeCampo
            campos={campos}
            fontes={fontes}
            valor={campo ? `${campo.fonte}|${campo.caminho}` : ''}
            aoEscolher={aoEscolherCampo}
          />
        </div>

        <div className="min-w-[9rem]">
          <Select
            value={condicao.operador}
            onValueChange={(v) => aoMudar({ operador: v, valor: undefined })}
            disabled={!campo}
          >
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {(campo?.operadores ?? []).map((op) => (
                <SelectItem key={op} value={op}>{OPERADORES[op] ?? op}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-[9rem] flex-1">
          {!precisaValor ? (
            <div className="flex h-10 items-center text-label text-muted-foreground">
              —
            </div>
          ) : condicao.operador === 'entre' ? (
            <div className="flex gap-2">
              <Input type="number" placeholder="mín"
                value={(condicao.valor as { min?: string })?.min ?? ''}
                onChange={(e) => aoMudar({
                  valor: { ...(condicao.valor as object), min: e.target.value || undefined },
                })} />
              <Input type="number" placeholder="máx"
                value={(condicao.valor as { max?: string })?.max ?? ''}
                onChange={(e) => aoMudar({
                  valor: { ...(condicao.valor as object), max: e.target.value || undefined },
                })} />
            </div>
          ) : campo?.tipo === 'data' ? (
            <Input type="date" value={(condicao.valor as string) ?? ''}
              onChange={(e) => aoMudar({ valor: e.target.value })} />
          ) : campo?.tipo === 'numero' ? (
            <Input type="number" value={(condicao.valor as string) ?? ''}
              onChange={(e) => aoMudar({ valor: e.target.value })} />
          ) : ehLista ? (
            <div className="max-h-32 overflow-y-auto rounded-lg border border-border p-2">
              {valores.isLoading && (
                <p className="text-micro text-muted-foreground">carregando opções…</p>
              )}
              {(valores.data ?? []).map((v) => (
                <label key={v} className="flex cursor-pointer items-center gap-2 py-0.5 text-label">
                  <input type="checkbox" checked={selecionados.includes(v)}
                    onChange={() => alternar(v)} className="accent-primary" />
                  <span className="truncate">{v}</span>
                </label>
              ))}
              {valores.data?.length === 0 && (
                <p className="text-micro text-muted-foreground">
                  Nenhum valor na base ainda — a fonte pode não ter sincronizado.
                </p>
              )}
            </div>
          ) : (
            <Input value={(condicao.valor as string) ?? ''}
              onChange={(e) => aoMudar({ valor: e.target.value })}
              placeholder="texto" />
          )}
        </div>
      </div>

      {/* uma pessoa tem N negócios, e 483 de 567 discordam de si mesmas:
          sem escolher, o filtro não tem resposta */}
      {ehNegocio && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-1.5">
          <span className="text-label text-muted-foreground">A pessoa tem vários negócios —</span>
          <Select
            value={condicao.quantificador ?? 'algum'}
            onValueChange={(v) => aoMudar({ quantificador: v as 'algum' | 'todo' })}
          >
            <SelectTrigger className="h-7 w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="algum">basta um satisfazer</SelectItem>
              <SelectItem value="todo">todos precisam satisfazer</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {campo?.descricao && (
        <p className="mt-2 text-micro text-muted-foreground">{campo.descricao}</p>
      )}
    </div>
  )
}

/**
 * As colunas que esta etapa traz para o resultado. Enriquecer não é só deixar de
 * excluir quem não tem o dado: o que foi consultado aqui precisa chegar na tela e
 * no arquivo. Sem isto, o usuário filtra por leadscore e não vê o leadscore.
 */
function ColunasTrazidas({
  etapa, campos, porGrupo, aoAtualizar,
}: {
  etapa: Etapa
  campos: CampoFiltravel[]
  porGrupo: Map<string, CampoFiltravel[]>
  aoAtualizar: (m: Partial<Etapa>) => void
}) {
  const [aberto, setAberto] = useState(false)
  const escolhidas = etapa.colunas ?? []

  function alternar(id: string) {
    aoAtualizar({
      colunas: escolhidas.includes(id)
        ? escolhidas.filter((x) => x !== id)
        : [...escolhidas, id],
    })
  }

  return (
    <div className="rounded-lg border border-border">
      <button
        onClick={() => setAberto(!aberto)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-2 text-label">
          <Columns3 className="h-3.5 w-3.5 text-muted-foreground" />
          Colunas que esta etapa traz
          {escolhidas.length > 0 && (
            <Badge variant="secondary">{escolhidas.length}</Badge>
          )}
        </span>
        {aberto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {escolhidas.length > 0 && !aberto && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {escolhidas.map((id) => (
            <Badge key={id} variant="outline" className="font-normal">
              {campos.find((c) => c.id === id)?.rotulo ?? id}
            </Badge>
          ))}
        </div>
      )}

      {aberto && (
        <div className="max-h-64 overflow-y-auto border-t border-border p-3">
          {[...porGrupo.entries()].map(([grupo, lista]) => (
            <div key={grupo} className="mb-3 last:mb-0">
              <p className="mb-1 text-micro uppercase text-muted-foreground">{grupo}</p>
              {lista.map((c) => (
                <label key={c.id}
                  className="flex cursor-pointer items-center gap-2 py-0.5 text-label">
                  <input type="checkbox" checked={escolhidas.includes(c.id)}
                    onChange={() => alternar(c.id)} className="accent-primary" />
                  <span className="truncate">{c.rotulo}</span>
                </label>
              ))}
            </div>
          ))}
          <p className="pt-1 text-micro text-muted-foreground">
            Vale para a prévia e para o arquivo exportado. Etapa desligada não
            contribui com coluna nenhuma.
          </p>
        </div>
      )}
    </div>
  )
}
