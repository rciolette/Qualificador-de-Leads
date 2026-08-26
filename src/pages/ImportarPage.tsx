import { TituloPagina } from '@/components/AppShell'
import { Card, CardContent } from '@/components/ui/card'

export function ImportarPage() {
  return (
    <>
      <TituloPagina titulo="Importar" descricao="Upload do relatório da Assiny" />
      <Card>
        <CardContent className="py-12 text-center text-label text-muted-foreground">
          Precisa da Edge Function qualificador-importar-assiny. Hoje a carga é feita por script — ver docs/fase-1.md.
        </CardContent>
      </Card>
    </>
  )
}
