import { TituloPagina } from '@/components/AppShell'
import { Card, CardContent } from '@/components/ui/card'

export function SaudePage() {
  return (
    <>
      <TituloPagina titulo="Saúde dos dados" descricao="Camadas 1 e 2 das métricas" />
      <Card>
        <CardContent className="py-12 text-center text-label text-muted-foreground">
          Depende da fase 3. As integrações precisam ter rodado ao menos uma vez.
        </CardContent>
      </Card>
    </>
  )
}
