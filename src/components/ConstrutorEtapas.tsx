import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronDown, ChevronUp, Columns3, GripVertical, Plus, Trash2, X,
} from 'lucide-react'
import {
  listarCampos, valoresDe, normalizarEtapa, OPERADORES, SEM_VALOR,
  type CampoFiltravel, type Condicao, type Etapa,
} from '@/lib/iniciativas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

let contador = 0
const novoId = () => `etapa_${Date.now()}_${contador++}`

const CONDICAO_VAZIA: Condicao = { fonte: '', campo: '', operador: '', valor: undefined }

export function ConstrutorEtapas({
  etapas, aoMudar,
}: {
  etapas: Etapa[]
  aoMudar: (e: Etapa[]) => void
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

  function adicionar() {
    aoMudar([...normalizadas, {
      id: novoId(), rotulo: '', ativa: true,
      combinador: 'qualquer', condicoes: [{ ...CONDICAO_VAZIA }], colunas: [],
    }])
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
          aoAtualizar={(m) => atualizar(i, m)}
          aoRemover={() => remover(i)}
          aoMover={(d) => mover(i, d)}
        />
      ))}

      <Button variant="outline" className="w-full gap-2" onClick={adicionar}>
        <Plus className="h-4 w-4" />
        {normalizadas.length === 0 ? 'Começar pela primeira etapa' : 'Filtrar mais um pouco'}
      </Button>

      {normalizadas.length === 0 && (
        <p className="text-label text-muted-foreground">
          Cada etapa recebe quem sobrou da anterior. Comece pela Assiny — quem comprou o quê —
          e vá estreitando com as outras plataformas.
        </p>
      )}
    </div>
  )
}

function CartaoEtapa({
  etapa, indice, total, porGrupo, campos, aoAtualizar, aoRemover, aoMover,
}: {
  etapa: Etapa
  indice: number
  total: number
  porGrupo: Map<string, CampoFiltravel[]>
  campos: CampoFiltravel[]
  aoAtualizar: (m: Partial<Etapa>) => void
  aoRemover: () => void
  aoMover: (delta: number) => void
}) {
  const condicoes = etapa.condicoes ?? []
  const varias = condicoes.length > 1

  function mudarCondicao(k: number, m: Partial<Condicao>) {
    aoAtualizar({ condicoes: condicoes.map((c, i) => (i === k ? { ...c, ...m } : c)) })
  }

  function addCondicao() {
    aoAtualizar({ condicoes: [...condicoes, { ...CONDICAO_VAZIA }] })
  }

  function tirarCondicao(k: number) {
    aoAtualizar({ condicoes: condicoes.filter((_, i) => i !== k) })
  }

  return (
    <Card className={cn(!etapa.ativa && 'opacity-50')}>
      <CardContent className="space-y-3 pt-4">
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
              porGrupo={porGrupo}
              campos={campos}
              etapaSemRotulo={!etapa.rotulo}
              aoMudar={(m) => mudarCondicao(k, m)}
              aoRotular={(r) => aoAtualizar({ rotulo: r })}
              aoRemover={() => tirarCondicao(k)}
              aoTrazerColuna={(id) => {
                const atuais = etapa.colunas ?? []
                if (!atuais.includes(id)) aoAtualizar({ colunas: [...atuais, id] })
              }}
            />
          ))}
        </div>

        <Button variant="ghost" size="sm" className="gap-1.5 text-label" onClick={addCondicao}>
          <Plus className="h-3.5 w-3.5" /> Consultar outra plataforma nesta etapa
        </Button>

        {/* a decisão que separa filtro de refino */}
        <label className="flex items-start justify-between gap-4 rounded-lg bg-muted/40 px-3 py-2">
          <span className="text-label">
            Manter quem não tem esse dado
            <span className="mt-0.5 block text-micro text-muted-foreground">
              {etapa.manter_sem_dado
                ? varias
                  ? 'Refino: quem não pôde ser julgado por nenhuma das condições segue no funil.'
                  : 'Refino: quem não está nessa plataforma segue no funil sem ser julgado aqui.'
                : varias
                  ? 'Filtro: quem não pôde ser julgado por nenhuma das condições sai do funil.'
                  : 'Filtro: quem não está nessa plataforma sai do funil nesta etapa.'}
            </span>
          </span>
          <Switch
            checked={etapa.manter_sem_dado ?? false}
            onCheckedChange={(v) => aoAtualizar({ manter_sem_dado: v })}
          />
        </label>

        <ColunasTrazidas
          etapa={etapa}
          campos={campos}
          porGrupo={porGrupo}
          aoAtualizar={aoAtualizar}
        />
      </CardContent>
    </Card>
  )
}

function LinhaCondicao({
  condicao, indice, podeRemover, porGrupo, campos, etapaSemRotulo,
  aoMudar, aoRotular, aoRemover, aoTrazerColuna,
}: {
  condicao: Condicao
  indice: number
  podeRemover: boolean
  porGrupo: Map<string, CampoFiltravel[]>
  campos: CampoFiltravel[]
  etapaSemRotulo: boolean
  aoMudar: (m: Partial<Condicao>) => void
  aoRotular: (r: string) => void
  aoRemover: () => void
  aoTrazerColuna: (id: string) => void
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
          {indice === 0 ? 'Condição' : `Condição ${indice + 1}`}
        </span>
        {podeRemover && (
          <button onClick={aoRemover} aria-label="Remover condição"
            className="text-muted-foreground hover:text-destructive">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-micro uppercase text-muted-foreground">Onde consultar</Label>
          <Select
            value={campo ? `${campo.fonte}|${campo.caminho}` : ''}
            onValueChange={(v) => {
              const [fonte, caminho] = v.split('|')
              const novo = campos.find((c) => c.fonte === fonte && c.caminho === caminho)
              aoMudar({
                fonte, campo: caminho,
                operador: novo?.operadores[0] ?? '',
                valor: undefined,
                quantificador: fonte === 'hubspot_negocio' ? 'algum' : undefined,
              })
              if (etapaSemRotulo && novo?.rotulo) aoRotular(novo.rotulo)
              // quem filtra por um campo quase sempre quer vê-lo na planilha
              if (novo) aoTrazerColuna(novo.id)
            }}
          >
            <SelectTrigger><SelectValue placeholder="escolha o campo" /></SelectTrigger>
            <SelectContent>
              {[...porGrupo.entries()].map(([grupo, lista]) => (
                <SelectGroup key={grupo}>
                  <SelectLabel>{grupo}</SelectLabel>
                  {lista.map((c) => (
                    <SelectItem key={c.id} value={`${c.fonte}|${c.caminho}`}>{c.rotulo}</SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-micro uppercase text-muted-foreground">Condição</Label>
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

        <div className="space-y-1">
          <Label className="text-micro uppercase text-muted-foreground">Valor</Label>
          {!precisaValor ? (
            <div className="flex h-10 items-center text-label text-muted-foreground">
              não precisa
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
