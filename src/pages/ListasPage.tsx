import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, Download, ListChecks, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { TituloPagina } from '@/components/AppShell'
import { exigirSupabase } from '@/lib/supabase'
import { baixarLista } from '@/lib/exportar'
import { formatarData, formatarNumero } from '@/lib/dados'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/**
 * Iniciativa e lista eram duas telas, e a separação não pagava o próprio custo.
 *
 * A iniciativa é a campanha — os filtros e os pesos que produziram o arquivo. A
 * lista é o resultado. Na prática nunca se procura uma sem a outra: quem abre
 * "Iniciativas" quer saber o que ela gerou, e quem abre "Listas" quer saber de
 * onde aquela lista veio. Duas telas obrigavam a cruzar as duas na cabeça.
 *
 * A consulta parte da INICIATIVA, não da lista. Elas nascem juntas — o fluxo
 * chama `salvarIniciativa` e `gerarLista` na mesma mutation — mas `gerar_lista`
 * já estourou o statement timeout de 8 s uma vez, e nesse caso sobra uma
 * iniciativa sem lista. Justamente a que interessa ver.
 */

interface ListaDaIniciativa {
  id: string
  gerada_em: string
  total: number | null
  por_time: Record<string, number> | null
  exportada_em: string | null
}

interface LinhaIniciativa {
  id: string
  nome: string
  tipo: string
  objetivo: string | null
  times: string[] | null
  filtros: { etapas?: unknown[] } | null
  aberta: boolean
  criada_em: string
  listas: ListaDaIniciativa[]
}

async function listar(): Promise<LinhaIniciativa[]> {
  const { data, error } = await exigirSupabase()
    .from('iniciativa')
    .select('id, nome, tipo, objetivo, times, filtros, aberta, criada_em, '
      + 'listas:lista(id, gerada_em, total, por_time, exportada_em)')
    .order('criada_em', { ascending: false })
    .order('gerada_em', { referencedTable: 'lista', ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as LinhaIniciativa[]
}

export function ListasPage() {
  const qc = useQueryClient()
  const [baixando, setBaixando] = useState<string | null>(null)
  const dados = useQuery({ queryKey: ['listas'], queryFn: listar })

  const baixar = useMutation({
    mutationFn: async ({ lista, nome }: { lista: ListaDaIniciativa; nome: string }) => {
      setBaixando(lista.id)
      const arquivo = await baixarLista(lista.id, nome)
      // carimba a exportação: o blueprint pede exportado_em por item
      await exigirSupabase().from('lista')
        .update({ exportada_em: new Date().toISOString() }).eq('id', lista.id)
      return arquivo
    },
    onSuccess: (arquivo) => {
      toast.success('Arquivo gerado', { description: arquivo })
      qc.invalidateQueries({ queryKey: ['listas'] })
    },
    onError: (e: Error) => toast.error('Falha ao gerar o arquivo', { description: e.message }),
    onSettled: () => setBaixando(null),
  })

  const temAlguma = dados.data?.some((i) => i.listas.length > 0)

  return (
    <>
      <TituloPagina
        titulo="Listas geradas"
        descricao="Cada lista aparece sob a iniciativa que a produziu — os filtros e os pesos que a geraram. O arquivo é regerado do banco a cada download; nada fica guardado. Quem dispara sobe na Sellflux, o app nunca envia nada."
        acao={
          <Button asChild className="gap-2">
            <Link to="/fluxo"><Plus className="h-4 w-4" /> Montar uma lista</Link>
          </Button>
        }
      />

      {dados.isLoading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : dados.data?.length ? (
        <div className="space-y-4">
          {dados.data.map((ini) => (
            <Card key={ini.id}>
              <CardContent className="pt-6">
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-heading font-medium">{ini.nome}</h2>
                    {ini.objetivo && (
                      <p className="text-label text-muted-foreground">{ini.objetivo}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary">{ini.tipo}</Badge>
                    {(ini.times ?? []).map((t) => (
                      <Badge key={t} variant="outline">{t}</Badge>
                    ))}
                    <Badge variant="outline">
                      {formatarNumero(ini.filtros?.etapas?.length ?? 0)} etapas
                    </Badge>
                    <Badge variant={ini.aberta ? 'default' : 'secondary'}>
                      {ini.aberta ? 'aberta' : 'fechada'}
                    </Badge>
                    <span className="text-micro text-muted-foreground">
                      {formatarData(ini.criada_em, true)}
                    </span>
                  </div>
                </div>

                {ini.listas.length > 0 ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead>Por time</TableHead>
                          <TableHead>Gerada em</TableHead>
                          <TableHead>Exportada</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ini.listas.map((l) => (
                          <TableRow key={l.id}>
                            <TableCell className="text-right text-label tabular-nums">
                              {formatarNumero(l.total)}
                            </TableCell>
                            <TableCell className="text-label">
                              <div className="flex flex-wrap gap-1">
                                {Object.entries(l.por_time ?? {}).map(([t, n]) => (
                                  <Badge key={t} variant="secondary">{t}: {n}</Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-label text-muted-foreground">
                              {formatarData(l.gerada_em, true)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-label text-muted-foreground">
                              {l.exportada_em ? formatarData(l.exportada_em, true) : '—'}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button variant="outline" size="sm" className="gap-1.5"
                                disabled={baixando === l.id}
                                onClick={() => baixar.mutate({ lista: l, nome: ini.nome })}>
                                <Download className="h-3.5 w-3.5" />
                                {baixando === l.id ? 'Gerando…' : 'XLSX'}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  /* a iniciativa foi salva e a geração não terminou — sem isto
                     ela ficaria invisível, e é a que mais interessa diagnosticar */
                  <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-label text-warning">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    Nenhuma lista gerada. A iniciativa foi salva, mas a geração não
                    chegou ao fim — monte de novo pelo fluxo para produzir o arquivo.
                  </p>
                )}
              </CardContent>
            </Card>
          ))}

          {!temAlguma && (
            <p className="text-label text-muted-foreground">
              Há iniciativas salvas, mas nenhuma chegou a gerar arquivo.
            </p>
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <ListChecks className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-body font-medium">Nenhuma lista gerada ainda</p>
              <p className="mt-1 max-w-md text-label text-muted-foreground">
                Suba a base, estreite o funil até a conta fechar, e exporte. Os filtros
                e os pesos ficam guardados na iniciativa — é isso que permite comparar
                um disparo com outro depois.
              </p>
            </div>
            <Button asChild className="gap-2">
              <Link to="/fluxo"><Plus className="h-4 w-4" /> Montar a primeira</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </>
  )
}
