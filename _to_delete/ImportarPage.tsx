import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { TituloPagina } from '@/components/AppShell'
import { MapeamentoArquivo } from '@/components/MapeamentoArquivo'
import { ZonaDeUpload } from '@/components/ZonaDeUpload'
import { formatarData, formatarNumero, listarImportacoes } from '@/lib/dados'
import {
  analisarArquivos,
  type Analise, type CampoCanonico, type Progresso,
} from '@/lib/importar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

export function ImportarPage() {
  const qc = useQueryClient()
  const [progresso, setProgresso] = useState<Progresso | null>(null)
  const [analises, setAnalises] = useState<Analise[]>([])
  const [campos, setCampos] = useState<CampoCanonico[]>([])

  const importacoes = useQuery({ queryKey: ['importacoes'], queryFn: () => listarImportacoes(20) })

  const analisar = useMutation({
    mutationFn: (arquivos: File[]) => analisarArquivos(arquivos, { aoProgresso: setProgresso }),
    onSettled: () => setProgresso(null),
    onSuccess: (r) => {
      const bons = r.analisados.filter((a) => !a.erro)
      const ruins = r.analisados.filter((a) => a.erro)
      setAnalises((atuais) => [...atuais, ...bons])
      setCampos(r.campos)

      for (const a of ruins) toast.error(a.arquivo, { description: a.erro })
      if (r.documentos.length) {
        toast.success(`${r.documentos.length} documento(s) anexado(s)`, {
          description: r.documentos.map((d) => d.arquivo).join(', ') +
            ' — guardado como contexto, não vira dado.',
        })
      }
      if (bons.length) {
        toast.info(`${bons.length} planilha(s) lida(s)`, {
          description: 'Confira o de-para das colunas antes de importar.',
        })
      }
      qc.invalidateQueries({ queryKey: ['importacoes'] })
    },
    onError: (e: Error) => toast.error('Não foi possível ler os arquivos', { description: e.message }),
  })

  return (
    <>
      <TituloPagina
        titulo="Importar"
        descricao="Arraste planilhas de qualquer origem. O app lê as colunas, propõe o de-para e só grava depois que você confirmar."
      />

      <ZonaDeUpload
        progresso={progresso}
        ocupado={analisar.isPending}
        aoReceber={(arquivos) => analisar.mutate(arquivos)}
        titulo="Arraste os arquivos aqui ou clique para escolher"
        ajuda="Vários de uma vez. Planilhas em .csv, .tsv, .xlsx, .xls e .ods viram dados; .md e .txt ficam anexados como contexto."
      />

      {analises.length > 0 && (
        <div className="mt-8 space-y-6">
          {analises.map((a) => (
            <MapeamentoArquivo
              key={a.importacao_id}
              analise={a}
              campos={campos}
              aoConcluir={() => {
                setAnalises((atuais) => atuais.filter((x) => x.importacao_id !== a.importacao_id))
                qc.invalidateQueries({ queryKey: ['importacoes'] })
                qc.invalidateQueries({ queryKey: ['fontes'] })
              }}
              aoDescartar={() =>
                setAnalises((atuais) => atuais.filter((x) => x.importacao_id !== a.importacao_id))}
            />
          ))}
        </div>
      )}

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="text-heading">Importações</CardTitle>
        </CardHeader>
        <CardContent>
          {importacoes.data?.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Base</TableHead>
                    <TableHead>Arquivo</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead className="text-right">Lidas</TableHead>
                    <TableHead className="text-right">Novas</TableHead>
                    <TableHead>Período</TableHead>
                    <TableHead>Quando</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importacoes.data.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="text-label">
                        <div className="font-medium">{i.nome ?? '—'}</div>
                        {i.tags?.length ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {i.tags.map((t) => (
                              <Badge key={t} variant="secondary" className="text-micro">{t}</Badge>
                            ))}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-label text-muted-foreground">
                        {i.arquivo}
                      </TableCell>
                      <TableCell>
                        <Badge variant={
                          i.status === 'ingerido' ? 'default'
                          : i.status === 'erro' ? 'destructive' : 'secondary'
                        }>
                          {i.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-label">{formatarNumero(i.linhas_lidas)}</TableCell>
                      <TableCell className="text-right text-label">{formatarNumero(i.linhas_novas)}</TableCell>
                      <TableCell className="whitespace-nowrap text-label text-muted-foreground">
                        {i.periodo_ini ? `${formatarData(i.periodo_ini)} → ${formatarData(i.periodo_fim)}` : '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-label text-muted-foreground">
                        {formatarData(i.importado_em, true)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="py-6 text-center text-label text-muted-foreground">
              Nenhuma importação ainda.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  )
}
