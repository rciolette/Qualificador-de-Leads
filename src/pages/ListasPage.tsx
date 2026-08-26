import { TituloPagina } from '@/components/AppShell'
import { Card, CardContent } from '@/components/ui/card'

export function ListasPage() {
  return (
    <>
      <TituloPagina titulo="Listas geradas" descricao="Histórico de extrações e resultado por contato" />
      <Card>
        <CardContent className="py-12 text-center text-label text-muted-foreground">
          Depende da fase 4.
        </CardContent>
      </Card>
    </>
  )
}
