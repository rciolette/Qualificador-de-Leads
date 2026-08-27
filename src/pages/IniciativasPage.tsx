import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Target } from 'lucide-react'
import { TituloPagina } from '@/components/AppShell'
import { listarIniciativas } from '@/lib/iniciativas'
import { formatarData, formatarNumero } from '@/lib/dados'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function IniciativasPage() {
  const iniciativas = useQuery({ queryKey: ['iniciativas'], queryFn: listarIniciativas })

  return (
    <>
      <TituloPagina
        titulo="Iniciativas"
        descricao="Cada iniciativa guarda os filtros e os pesos que geraram suas listas. É isso que permite comparar um disparo com outro depois."
        acao={
          <Button asChild className="gap-2">
            <Link to="/iniciativas/nova"><Plus className="h-4 w-4" /> Nova iniciativa</Link>
          </Button>
        }
      />

      {iniciativas.isLoading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : iniciativas.data?.length ? (
        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Times</TableHead>
                    <TableHead>Etapas</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Criada em</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {iniciativas.data.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="text-label">
                        <div className="font-medium">{i.nome}</div>
                        <div className="text-micro text-muted-foreground">{i.objetivo}</div>
                      </TableCell>
                      <TableCell><Badge variant="secondary">{i.tipo}</Badge></TableCell>
                      <TableCell className="text-label">{(i.times ?? []).join(' · ')}</TableCell>
                      <TableCell className="text-label">
                        {formatarNumero(i.filtros?.etapas?.length ?? 0)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={i.aberta ? 'default' : 'secondary'}>
                          {i.aberta ? 'aberta' : 'fechada'}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-label text-muted-foreground">
                        {formatarData(i.criada_em, true)}
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
            <Target className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-body font-medium">Nenhuma iniciativa ainda</p>
              <p className="mt-1 text-label text-muted-foreground">
                Uma iniciativa é um objetivo com filtros e pesos próprios. É a partir dela
                que sai a lista de disparo.
              </p>
            </div>
            <Button asChild className="gap-2">
              <Link to="/iniciativas/nova"><Plus className="h-4 w-4" /> Criar a primeira</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </>
  )
}
