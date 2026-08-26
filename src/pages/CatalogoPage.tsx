import { useQuery } from '@tanstack/react-query'
import { TituloPagina } from '@/components/AppShell'
import { listarProjetos } from '@/lib/dados'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function CatalogoPage() {
  const projetos = useQuery({ queryKey: ['projetos'], queryFn: listarProjetos })

  const semClassificacao = (projetos.data ?? []).filter(
    (p) => p.area_membros === null && !p.area_membros_nao_se_aplica,
  ).length

  return (
    <>
      <TituloPagina
        titulo="Catálogo Assiny"
        descricao="Projeto desconhecido bloqueia a importação. O projeto não classifica o lead — só diz onde procurar o engajamento dele."
      />

      {projetos.isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <Card>
          <CardContent className="pt-6">
            {semClassificacao > 0 && (
              <p className="mb-4 rounded-lg bg-warning/15 px-3 py-2 text-label text-warning">
                {semClassificacao} projeto(s) sem área de membros classificada. A métrica da
                camada 1 exige zero.
              </p>
            )}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organização</TableHead>
                    <TableHead>Projeto</TableHead>
                    <TableHead>Área de membros</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Observação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(projetos.data ?? []).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-label">{p.organizacao_assiny}</TableCell>
                      <TableCell className="text-label font-medium">{p.nome_assiny}</TableCell>
                      <TableCell>
                        {p.area_membros ? (
                          <Badge variant="secondary">{p.area_membros}</Badge>
                        ) : p.area_membros_nao_se_aplica ? (
                          <span className="text-label text-muted-foreground">não se aplica</span>
                        ) : (
                          <Badge variant="destructive">não classificada</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.ativo ? 'default' : 'secondary'}>
                          {p.ativo ? 'ativo' : 'só retroativo'}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-md text-label text-muted-foreground">
                        {p.observacao ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  )
}
