import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ListChecks } from 'lucide-react'
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

interface LinhaLista {
  id: string
  gerada_em: string
  total: number | null
  por_time: Record<string, number> | null
  exportada_em: string | null
  iniciativa: { nome: string; tipo: string; objetivo: string } | null
}

async function listar(): Promise<LinhaLista[]> {
  const { data, error } = await exigirSupabase()
    .from('lista')
    .select('id, gerada_em, total, por_time, exportada_em, iniciativa:iniciativa_id(nome, tipo, objetivo)')
    .order('gerada_em', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as LinhaLista[]
}

export function ListasPage() {
  const qc = useQueryClient()
  const [baixando, setBaixando] = useState<string | null>(null)
  const listas = useQuery({ queryKey: ['listas'], queryFn: listar })

  const baixar = useMutation({
    mutationFn: async (l: LinhaLista) => {
      setBaixando(l.id)
      const arquivo = await baixarLista(l.id, l.iniciativa?.nome ?? 'lista')
      // carimba a exportação: o blueprint pede exportado_em por item
      await exigirSupabase().from('lista')
        .update({ exportada_em: new Date().toISOString() }).eq('id', l.id)
      return arquivo
    },
    onSuccess: (arquivo) => {
      toast.success('Arquivo gerado', { description: arquivo })
      qc.invalidateQueries({ queryKey: ['listas'] })
    },
    onError: (e: Error) => toast.error('Falha ao gerar o arquivo', { description: e.message }),
    onSettled: () => setBaixando(null),
  })

  return (
    <>
      <TituloPagina
        titulo="Listas geradas"
        descricao="O arquivo é regerado do banco a cada download — nada fica guardado. Quem dispara sobe na Sellflux; o app nunca envia nada."
      />

      {listas.isLoading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : listas.data?.length ? (
        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Iniciativa</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Por time</TableHead>
                    <TableHead>Gerada em</TableHead>
                    <TableHead>Exportada</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listas.data.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-label">
                        <div className="font-medium">{l.iniciativa?.nome ?? '—'}</div>
                        <div className="text-micro text-muted-foreground">
                          {l.iniciativa?.objetivo}
                        </div>
                      </TableCell>
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
                          onClick={() => baixar.mutate(l)}>
                          <Download className="h-3.5 w-3.5" />
                          {baixando === l.id ? 'Gerando…' : 'XLSX'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <ListChecks className="h-8 w-8 text-muted-foreground" />
            <p className="text-body font-medium">Nenhuma lista gerada ainda</p>
            <p className="max-w-md text-label text-muted-foreground">
              Monte uma iniciativa, ajuste o funil até a conta fechar, e gere a lista.
            </p>
          </CardContent>
        </Card>
      )}
    </>
  )
}
