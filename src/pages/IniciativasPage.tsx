import { TituloPagina } from '@/components/AppShell'
import { Card, CardContent } from '@/components/ui/card'

export function IniciativasPage() {
  return (
    <>
      <TituloPagina titulo="Iniciativas" descricao="Definir tipo, filtros, pesos e times" />
      <Card>
        <CardContent className="py-12 text-center text-label text-muted-foreground">
          Depende da fase 4 — o motor de iniciativas ainda não existe.
        </CardContent>
      </Card>
    </>
  )
}
