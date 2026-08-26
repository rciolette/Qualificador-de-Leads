import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { TituloPagina } from '@/components/AppShell'
import { useAuth } from '@/contexts/AuthContext'
import {
  formatarData, formatarDuracao, formatarNumero,
  listarExecucoes, listarFrescor, listarIntegracoes, salvarCredencial, sincronizar,
} from '@/lib/dados'
import type { Integracao } from '@/lib/tipos'
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
  integracao: ig, frescor, podeGravar, podeSincronizar, aoMudar,
}: {
  integracao: Integracao
  frescor?: { vencida: boolean; horas_desde: number | null; ultima_execucao: string | null }
  podeGravar: boolean
  podeSincronizar: boolean
  aoMudar: () => void
}) {
  const [token, setToken] = useState('')
  const semApi = ig.slug === 'assiny' // entrada é upload de CSV, não API

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

  const sync = useMutation({
    mutationFn: () => sincronizar(ig.slug, 100),
    onSuccess: (r) => {
      toast.success(`${ig.nome_exibicao} sincronizada`, {
        description: r.mensagem
          ?? `${formatarNumero(r.encontrados)} de ${formatarNumero(r.alvos)} encontrados` +
             ` · ${formatarNumero(r.chamadas_http)} chamadas · ${formatarDuracao(r.duracao_ms)}`,
      })
      if (r.avisos?.length) toast.warning(`${r.avisos.length} aviso(s)`, { description: r.avisos[0] })
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

            <Button
              variant="outline"
              className="w-full gap-2"
              disabled={!ig.ativa || !podeSincronizar || sync.isPending}
              onClick={() => sync.mutate()}
            >
              <RefreshCw className={sync.isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              {sync.isPending ? 'Sincronizando…' : 'Sincronizar agora'}
            </Button>
            {!ig.ativa && (
              <p className="text-micro text-muted-foreground">
                Grave a credencial para habilitar a sincronização.
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
