import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, KeyRound, Plug2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { TituloPagina } from '@/components/AppShell'
import { useAuth } from '@/contexts/AuthContext'
import {
  formatarData, formatarDuracao, formatarNumero,
  espelhar, FONTES_ESPELHADAS,
  listarExecucoes, listarFrescor, listarIntegracoes, ocupadoPor, salvarCredencial,
  sincronizarTudo, testarConexao,
  type ProgressoSync,
} from '@/lib/dados'
import type { Diagnostico, Integracao } from '@/lib/tipos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

const ROTULO_TIPO: Record<string, string> = {
  fonte_venda: 'Fonte de venda',
  area_membros: 'Área de membros',
  crm: 'CRM',
  disparo: 'Disparo',
}

export function IntegracoesPage() {
  const { pode } = useAuth()
  const qc = useQueryClient()

  const integracoes = useQuery({ queryKey: ['integracoes'], queryFn: listarIntegracoes })
  const frescor = useQuery({ queryKey: ['frescor'], queryFn: listarFrescor, refetchInterval: 60_000 })
  const execucoes = useQuery({ queryKey: ['execucoes'], queryFn: () => listarExecucoes(30) })
  // 5 s: um espelhamento leva de 40 s a minutos, e o botão precisa liberar sozinho
  const ocupada = useQuery({ queryKey: ['ocupada'], queryFn: ocupadoPor, refetchInterval: 5_000 })

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['integracoes'] })
    qc.invalidateQueries({ queryKey: ['frescor'] })
    qc.invalidateQueries({ queryKey: ['execucoes'] })
  }

  if (integracoes.error) {
    return <ErroDeSchema mensagem={(integracoes.error as Error).message} />
  }

  return (
    <>
      <TituloPagina
        titulo="Integrações"
        descricao="O token vai direto para o Vault do Supabase. Só a máscara fica visível — não há como lê-lo de volta, apenas substituir."
      />

      {integracoes.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(integracoes.data ?? []).map((ig) => (
            <CartaoIntegracao
              key={ig.id}
              integracao={ig}
              frescor={frescor.data?.find((f) => f.slug === ig.slug)}
              podeGravar={pode('gestao')}
              podeSincronizar={pode('operador')}
              ocupada={ocupada.data ?? null}
              aoMudar={invalidar}
            />
          ))}
        </div>
      )}

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="text-heading">Últimas execuções</CardTitle>
        </CardHeader>
        <CardContent>
          {execucoes.data?.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead>
                    <TableHead>Operação</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Registros</TableHead>
                    <TableHead className="text-right">Duração</TableHead>
                    <TableHead>Erro</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {execucoes.data.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap text-label">
                        {formatarData(e.executado_em, true)}
                      </TableCell>
                      <TableCell className="text-label">{e.operacao ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={e.status === 'ok' ? 'default' : 'destructive'}>
                          {e.status ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-label">
                        {formatarNumero(e.registros)}
                      </TableCell>
                      <TableCell className="text-right text-label">
                        {formatarDuracao(e.duracao_ms)}
                      </TableCell>
                      <TableCell className="max-w-md truncate text-label text-muted-foreground">
                        {e.erro ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="py-6 text-center text-label text-muted-foreground">
              Nenhuma sincronização registrada ainda.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  )
}

function CartaoIntegracao({
  integracao: ig, frescor, podeGravar, podeSincronizar, ocupada, aoMudar,
}: {
  integracao: Integracao
  frescor?: { vencida: boolean; horas_desde: number | null; ultima_execucao: string | null }
  podeGravar: boolean
  podeSincronizar: boolean
  /** nome da fonte que está ocupando os workers agora, se houver outra */
  ocupada: string | null
  aoMudar: () => void
}) {
  const [token, setToken] = useState('')
  const [diagnostico, setDiagnostico] = useState<Diagnostico | null>(null)
  const semApi = ig.slug === 'assiny' // entrada é upload de CSV, não API
  // outra fonte está ocupando os workers: a função recusaria, então nem oferece
  const bloqueadaPorOutra = Boolean(ocupada) && ocupada !== ig.nome_exibicao

  const testar = useMutation({
    mutationFn: () => testarConexao(ig.slug),
    onSuccess: (d) => {
      setDiagnostico(d)
      if (d.ok) toast.success(d.titulo, { description: d.detalhe })
      else toast.error(d.titulo, { description: [d.detalhe, d.acao].filter(Boolean).join(' '), duration: 15000 })
      aoMudar()
    },
    onError: (e: Error) => {
      setDiagnostico({ fonte: ig.slug, ok: false, status: null,
        titulo: 'Não foi possível testar', detalhe: e.message })
      toast.error('Não foi possível testar', { description: e.message })
    },
  })

  const gravar = useMutation({
    mutationFn: () => salvarCredencial(ig.slug, token),
    onSuccess: (r) => {
      setToken('') // o valor não fica no estado depois de gravado
      toast.success(
        r.substituida ? `Credencial do ${ig.nome_exibicao} substituída` : `Credencial gravada`,
        { description: `No Vault como ${r.credencial_ref} · ${r.mascara}` },
      )
      aoMudar()
    },
    onError: (e: Error) => toast.error('Não foi possível gravar', { description: e.message }),
  })

  // MemberKit, MemberClass e Sellflux não perguntam mais pessoa a pessoa: espelham
  // a fonte inteira e cruzam em SQL. O botão é o mesmo; o caminho por baixo é outro.
  const ehEspelhada = FONTES_ESPELHADAS.includes(ig.slug)
  const [pagina, setPagina] = useState<number | null>(null)

  const espelho = useMutation({
    mutationFn: () => espelhar(ig.slug, (p) => setPagina(p)),
    onSettled: () => setPagina(null),
    onSuccess: (r) => {
      if (r.status === 'erro') {
        toast.error(`${ig.nome_exibicao}: espelhamento interrompido`, { description: r.erro })
        aoMudar()
        return
      }
      const casou = (r.casamento ?? [])
        .map((c) => `${c.pessoas} por ${c.casou_por}`)
        .join(' · ')
      toast.success(`${ig.nome_exibicao} espelhada`, {
        description:
          `${formatarNumero(r.linhas_espelho)} registros na fonte` +
          ` · ${formatarNumero(r.chamadas_http)} chamadas · ${formatarDuracao(r.duracao_ms)}` +
          (casou ? ` — cruzou ${casou}` : ' — nenhuma pessoa cruzou'),
      })
      aoMudar()
    },
    onError: (e: Error) => toast.error(`Falha ao espelhar ${ig.nome_exibicao}`, {
      description: e.message,
    }),
  })

  // o andamento fica na tela: a base tem milhares de pessoas e isso leva minutos
  const [andamento, setAndamento] = useState<ProgressoSync | null>(null)

  const sync = useMutation({
    mutationFn: () => sincronizarTudo(ig.slug, { lote: 100, aoProgresso: setAndamento }),
    onSettled: () => setAndamento(null),
    onSuccess: (r) => {
      const completo = r.parouPor === 'nada a sincronizar'
      const desc =
        `${formatarNumero(r.encontrados)} encontrados em ` +
        `${formatarNumero(r.processados)} consultados · ${r.rodadas} lote(s)`
      if (completo) {
        toast.success(`${ig.nome_exibicao} sincronizada`, { description: desc })
      } else {
        // parar no meio não é sucesso: o resto da base continua sem dado
        toast.warning(`${ig.nome_exibicao} parou antes do fim`, {
          description: `${desc}. Motivo: ${r.parouPor}. Rode de novo para continuar de onde parou.`,
          duration: 12000,
        })
      }
      aoMudar()
    },
    onError: (e: Error) => toast.error(`Falha ao sincronizar ${ig.nome_exibicao}`, {
      description: e.message,
    }),
  })

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-heading">{ig.nome_exibicao}</CardTitle>
            <p className="mt-0.5 text-micro uppercase text-muted-foreground">
              {ROTULO_TIPO[ig.tipo] ?? ig.tipo} · {ig.slug}
            </p>
          </div>
          {ig.ativa ? (
            <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" /> ativa</Badge>
          ) : (
            <Badge variant="secondary">inativa</Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-label">
          <div>
            <dt className="text-muted-foreground">Credencial</dt>
            <dd className="font-mono">{ig.credencial_mascara ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Gravada em</dt>
            <dd>{formatarData(ig.credencial_criada_em, true)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Última sincronização</dt>
            <dd>{formatarData(frescor?.ultima_execucao ?? null, true)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Frescor</dt>
            <dd>
              {!frescor || frescor.ultima_execucao === null ? (
                <span className="text-muted-foreground">nunca</span>
              ) : frescor.vencida ? (
                <span className="inline-flex items-center gap-1 text-warning">
                  <AlertCircle className="h-3 w-3" /> {frescor.horas_desde}h — vencida
                </span>
              ) : (
                <span className="text-success">{frescor.horas_desde}h</span>
              )}
            </dd>
          </div>
        </dl>

        {semApi ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-label text-muted-foreground">
            Sem API nesta versão. A entrada é o relatório de transações exportado à mão —
            use a tela <strong>Importar</strong>.
          </p>
        ) : (
          <>
            {podeGravar ? (
              <form
                className="space-y-2"
                onSubmit={(e) => { e.preventDefault(); gravar.mutate() }}
              >
                <Label htmlFor={`token-${ig.slug}`} className="flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5" />
                  {ig.credencial_mascara ? 'Substituir credencial' : 'Gravar credencial'}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id={`token-${ig.slug}`}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={ig.slug === 'hubspot' ? 'pat-na1-…' : 'token da API'}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                  <Button type="submit" disabled={token.length < 8 || gravar.isPending}>
                    {gravar.isPending ? 'Gravando…' : 'Gravar'}
                  </Button>
                </div>
                <p className="flex items-start gap-1.5 text-micro text-muted-foreground">
                  <ShieldCheck className="mt-px h-3 w-3 shrink-0" />
                  Vai para o Vault como <code>qualificador_{ig.slug}</code>. Não fica no
                  navegador nem em nenhuma tabela — só a máscara.
                </p>
              </form>
            ) : (
              <p className="text-label text-muted-foreground">
                Só o papel <strong>gestão</strong> grava credencial.
              </p>
            )}

            {diagnostico && (
              <p className={
                'flex items-start gap-2 rounded-lg px-3 py-2 text-label ' +
                (diagnostico.ok ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive')
              }>
                {diagnostico.ok
                  ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                <span>
                  <strong>{diagnostico.titulo}</strong> — {diagnostico.detalhe}
                  {diagnostico.acao && (
                    <span className="mt-1 block opacity-90">{diagnostico.acao}</span>
                  )}
                </span>
              </p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="gap-2"
                disabled={!ig.ativa || testar.isPending}
                onClick={() => testar.mutate()}
              >
                <Plug2 className={testar.isPending ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} />
                {testar.isPending ? 'Testando…' : 'Testar conexão'}
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                disabled={!ig.ativa || !podeSincronizar || sync.isPending || espelho.isPending
                          || bloqueadaPorOutra}
                title={bloqueadaPorOutra
                  ? `Espere ${ocupada} terminar — duas fontes ao mesmo tempo esgotam os workers`
                  : undefined}
                onClick={() => (ehEspelhada ? espelho.mutate() : sync.mutate())}
              >
                <RefreshCw
                  className={sync.isPending || espelho.isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
                />
                {bloqueadaPorOutra
                  ? `Aguardando ${ocupada}`
                  : espelho.isPending
                  ? (pagina ? `Espelhando… página ${pagina}` : 'Espelhando…')
                  : sync.isPending
                    ? andamento
                      ? andamento.fase === 'reduzindo'
                        ? `Lote grande demais — tentando com ${andamento.lote}`
                        : `Sincronizando… ${formatarNumero(andamento.processados)} consultados`
                      : 'Sincronizando…'
                    : ehEspelhada ? 'Espelhar e cruzar' : 'Sincronizar'}
              </Button>
            </div>

            {sync.isPending && andamento && (
              <p className="text-micro text-muted-foreground">
                Lote {andamento.rodada} · {formatarNumero(andamento.encontrados)} encontrados de{' '}
                {formatarNumero(andamento.processados)} consultados.
                {andamento.fase === 'reduzindo'
                  ? ' O worker estourou; o lote diminuiu e a fila continua.'
                  : ' Vai em lotes até acabar — pode levar minutos.'}
              </p>
            )}
            {!ig.ativa && (
              <p className="text-micro text-muted-foreground">
                Grave a credencial para habilitar a sincronização.
              </p>
            )}
            {bloqueadaPorOutra && ig.ativa && (
              <p className="text-micro text-muted-foreground">
                <strong className="text-foreground">{ocupada}</strong> está rodando agora.
                Duas fontes ao mesmo tempo esgotam os workers do projeto e derrubam
                o que já está em andamento — este botão libera sozinho quando ela terminar.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** O erro mais provável na primeira execução — vale explicar em vez de mostrar o código cru. */
function ErroDeSchema({ mensagem }: { mensagem: string }) {
  const ehSchema = mensagem.includes('Invalid schema') || mensagem.includes('PGRST106')
  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-heading text-destructive">
          <AlertCircle className="h-4 w-4" />
          {ehSchema ? 'Schema não exposto na API' : 'Não foi possível ler as integrações'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-label">
        {ehSchema ? (
          <>
            <p>
              O PostgREST ainda não expõe o schema <code>qualificador</code>. Hoje ele expõe
              apenas <code>public</code>, <code>graphql_public</code> e <code>dash</code>.
            </p>
            <p className="text-muted-foreground">
              No painel do Supabase: <strong>Settings → API → Exposed schemas</strong>, adicione{' '}
              <code>qualificador</code> à lista. É o mesmo passo que o schema <code>dash</code> já
              teve. Nenhum schema existente precisa ser removido.
            </p>
          </>
        ) : (
          <p className="font-mono text-muted-foreground">{mensagem}</p>
        )}
      </CardContent>
    </Card>
  )
}
