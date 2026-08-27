import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from 'lucide-react'
import {
  listarCampos, valoresDe, OPERADORES, SEM_VALOR,
  type CampoFiltravel, type Etapa,
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

  function adicionar() {
    aoMudar([...etapas, {
      id: novoId(), rotulo: '', fonte: '', campo: '',
      operador: '', valor: undefined, ativa: true,
    }])
  }

  function atualizar(i: number, mudanca: Partial<Etapa>) {
    aoMudar(etapas.map((e, k) => (k === i ? { ...e, ...mudanca } : e)))
  }

  function remover(i: number) {
    aoMudar(etapas.filter((_, k) => k !== i))
  }

  function mover(i: number, delta: number) {
    const j = i + delta
    if (j < 0 || j >= etapas.length) return
    const copia = [...etapas]
    ;[copia[i], copia[j]] = [copia[j], copia[i]]
    aoMudar(copia)
  }

  return (
    <div className="space-y-3">
      {etapas.map((etapa, i) => (
        <CartaoEtapa
          key={etapa.id}
          etapa={etapa}
          indice={i}
          total={etapas.length}
          porGrupo={porGrupo}
          campos={campos.data ?? []}
          aoAtualizar={(m) => atualizar(i, m)}
          aoRemover={() => remover(i)}
          aoMover={(d) => mover(i, d)}
        />
      ))}

      <Button variant="outline" className="w-full gap-2" onClick={adicionar}>
        <Plus className="h-4 w-4" />
        {etapas.length === 0 ? 'Começar pela primeira etapa' : 'Filtrar mais um pouco'}
      </Button>

      {etapas.length === 0 && (
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
  const campo = campos.find((c) => c.caminho === etapa.campo && c.fonte === etapa.fonte)
  const precisaValor = etapa.operador && !SEM_VALOR.has(etapa.operador)
  const ehLista = campo?.tipo === 'lista' || campo?.tipo === 'enum'

  // opções vindas do próprio dado: evita depender de digitação exata
  const valores = useQuery({
    queryKey: ['valores', campo?.caminho],
    queryFn: () => valoresDe(campo!),
    enabled: Boolean(campo && ehLista),
    staleTime: 5 * 60_000,
  })

  const selecionados: string[] = Array.isArray(etapa.valor) ? etapa.valor as string[] : []

  function alternar(v: string) {
    aoAtualizar({
      valor: selecionados.includes(v)
        ? selecionados.filter((x) => x !== v)
        : [...selecionados, v],
    })
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

        <div className="grid gap-2 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-micro uppercase text-muted-foreground">Onde consultar</Label>
            <Select
              value={campo ? `${campo.fonte}|${campo.caminho}` : ''}
              onValueChange={(v) => {
                const [fonte, caminho] = v.split('|')
                const novo = campos.find((c) => c.fonte === fonte && c.caminho === caminho)
                aoAtualizar({
                  fonte, campo: caminho,
                  operador: novo?.operadores[0] ?? '',
                  valor: undefined,
                  rotulo: etapa.rotulo || (novo?.rotulo ?? ''),
                })
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
              value={etapa.operador}
              onValueChange={(v) => aoAtualizar({ operador: v, valor: undefined })}
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
            ) : etapa.operador === 'entre' ? (
              <div className="flex gap-2">
                <Input type="number" placeholder="mín"
                  value={(etapa.valor as { min?: string })?.min ?? ''}
                  onChange={(e) => aoAtualizar({
                    valor: { ...(etapa.valor as object), min: e.target.value || undefined },
                  })} />
                <Input type="number" placeholder="máx"
                  value={(etapa.valor as { max?: string })?.max ?? ''}
                  onChange={(e) => aoAtualizar({
                    valor: { ...(etapa.valor as object), max: e.target.value || undefined },
                  })} />
              </div>
            ) : campo?.tipo === 'data' ? (
              <Input type="date" value={(etapa.valor as string) ?? ''}
                onChange={(e) => aoAtualizar({ valor: e.target.value })} />
            ) : campo?.tipo === 'numero' ? (
              <Input type="number" value={(etapa.valor as string) ?? ''}
                onChange={(e) => aoAtualizar({ valor: e.target.value })} />
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
              <Input value={(etapa.valor as string) ?? ''}
                onChange={(e) => aoAtualizar({ valor: e.target.value })}
                placeholder="texto" />
            )}
          </div>
        </div>

        {campo?.descricao && (
          <p className="text-micro text-muted-foreground">{campo.descricao}</p>
        )}

        {/* a decisão que separa filtro de refino */}
        <label className="flex items-start justify-between gap-4 rounded-lg bg-muted/40 px-3 py-2">
          <span className="text-label">
            Manter quem não tem esse dado
            <span className="mt-0.5 block text-micro text-muted-foreground">
              {etapa.manter_sem_dado
                ? 'Refino: quem não está nessa plataforma segue no funil sem ser julgado aqui.'
                : 'Filtro: quem não está nessa plataforma sai do funil nesta etapa.'}
            </span>
          </span>
          <Switch
            checked={etapa.manter_sem_dado ?? false}
            onCheckedChange={(v) => aoAtualizar({ manter_sem_dado: v })}
          />
        </label>
      </CardContent>
    </Card>
  )
}
