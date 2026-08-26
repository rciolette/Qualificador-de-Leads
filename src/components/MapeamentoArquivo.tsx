import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AlertCircle, FileSpreadsheet, Save, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { ingerirImportacao, type Analise, type CampoCanonico, type Regras } from '@/lib/importar'
import { formatarDuracao, formatarNumero } from '@/lib/dados'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const SEM_COLUNA = '__nenhuma__'

const ROTULO_GRUPO: Record<string, string> = {
  identidade: 'Quem é a pessoa',
  transacao: 'O que ela comprou',
  projeto: 'De onde veio',
}

export function MapeamentoArquivo({
  analise, campos, aoConcluir, aoDescartar,
}: {
  analise: Analise
  campos: CampoCanonico[]
  aoConcluir: () => void
  aoDescartar: () => void
}) {
  const [mapeamento, setMapeamento] = useState<Record<string, string>>(analise.mapeamento ?? {})
  const [transformacoes, setTransformacoes] = useState<Record<string, string>>(
    analise.transformacoes ?? {},
  )
  const [regras, setRegras] = useState<Regras>(analise.regras ?? {})
  const [nome, setNome] = useState(
    analise.arquivo.replace(/\.[^.]+$/, '').slice(0, 80),
  )
  const [descricao, setDescricao] = useState('')
  const [tagsTexto, setTagsTexto] = useState('')
  const [salvarPerfil, setSalvarPerfil] = useState(false)
  const [nomePerfil, setNomePerfil] = useState('')

  const embutido = analise.fonte_sugerida?.embutido ?? false

  const identificadores = useMemo(
    () => ['email', 'telefone', 'documento'].filter((c) => mapeamento[c]),
    [mapeamento],
  )
  const podeImportar = identificadores.length > 0

  const importar = useMutation({
    mutationFn: () => ingerirImportacao({
      importacao_id: analise.importacao_id,
      mapeamento,
      transformacoes,
      regras,
      nome: nome.trim() || undefined,
      descricao: descricao.trim() || undefined,
      tags: tagsTexto.split(',').map((t) => t.trim()).filter(Boolean),
      salvar_como: salvarPerfil && nomePerfil.trim() ? nomePerfil.trim() : undefined,
      assinatura: salvarPerfil ? Object.values(mapeamento).filter(Boolean) : undefined,
    }),
    onSuccess: (r) => {
      toast.success(`${analise.arquivo} importado`, {
        description: [
          r.caminho === 'assiny'
            ? `${formatarNumero(r.transacoes_novas)} transações novas de ${formatarNumero(r.transacoes)}`
            : `${formatarNumero(r.pessoas_criadas)} pessoas · ${formatarNumero(r.transacoes_novas)} transações`,
          r.fora_das_regras ? `${formatarNumero(r.fora_das_regras)} fora das regras` : null,
          r.sem_identidade ? `${formatarNumero(r.sem_identidade)} sem identificador` : null,
          r.duracao_ms ? formatarDuracao(r.duracao_ms) : null,
        ].filter(Boolean).join(' · '),
      })
      aoConcluir()
    },
    onError: (e: Error & { bloqueio?: boolean }) =>
      toast.error(
        e.bloqueio ? 'Projeto fora do catálogo' : `Falha ao importar ${analise.arquivo}`,
        {
          description: e.bloqueio
            ? `${e.message} Se esta base não vem da Assiny, desligue "Exigir projeto no catálogo".`
            : e.message,
          duration: 12000,
        },
      ),
  })

  function definir(campo: string, coluna: string) {
    setMapeamento((m) => {
      const novo = { ...m }
      if (coluna === SEM_COLUNA) delete novo[campo]
      else novo[campo] = coluna
      return novo
    })
    // um filtro sobre coluna não mapeada removeria todas as linhas em silêncio:
    // desmapear a coluna limpa o filtro que dependia dela
    if (coluna === SEM_COLUNA) {
      if (campo === 'status') setRegras((r) => ({ ...r, status_aceitos: undefined }))
      if (campo === 'criado_em') setRegras((r) => ({ ...r, periodo: undefined }))
      if (campo === 'projeto_nome' || campo === 'projeto_id') {
        setRegras((r) => ({ ...r, exigir_projeto_no_catalogo: false }))
      }
    }
  }

  const grupos = ['identidade', 'transacao', 'projeto'] as const

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-heading">
              <FileSpreadsheet className="h-4 w-4 shrink-0" />
              <span className="truncate">{analise.arquivo}</span>
            </CardTitle>
            <p className="mt-1 text-label text-muted-foreground">
              {formatarNumero(analise.linhas)} linhas · {analise.colunas.length} colunas
              {analise.linha_cabecalho > 0 &&
                ` · cabeçalho na linha ${analise.linha_cabecalho + 1}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {analise.fonte_sugerida && (
              <Badge className="gap-1">
                <Sparkles className="h-3 w-3" />
                {analise.fonte_sugerida.nome}
              </Badge>
            )}
            <Button variant="ghost" size="icon" onClick={aoDescartar} aria-label="Descartar">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {embutido ? (
          <p className="rounded-lg bg-primary/10 px-3 py-2 text-label">
            Formato reconhecido. Este arquivo usa o parser da Assiny, que junta os itens
            de uma mesma transação (produto principal e order bumps) numa linha só.
            O de-para abaixo está fixo.
          </p>
        ) : (
          <p className="text-label text-muted-foreground">
            Diga o que é cada coluna. Só os campos que você preencher são importados —
            o resto do arquivo é ignorado.
          </p>
        )}

        {/* de-para */}
        <div className="space-y-5">
          {grupos.map((grupo) => {
            const doGrupo = campos.filter((c) => c.grupo === grupo)
            if (!doGrupo.length) return null
            return (
              <div key={grupo}>
                <h4 className="mb-2 text-micro uppercase text-muted-foreground">
                  {ROTULO_GRUPO[grupo]}
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  {doGrupo.map((c) => (
                    <div key={c.campo} className="space-y-1">
                      <Label className="flex items-center gap-1.5 text-label">
                        {c.rotulo}
                        {c.chave && (
                          <span className="text-micro text-muted-foreground">(identificador)</span>
                        )}
                      </Label>
                      <Select
                        value={mapeamento[c.campo] ?? SEM_COLUNA}
                        onValueChange={(v) => definir(c.campo, v)}
                        disabled={embutido}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="— não importar —" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SEM_COLUNA}>— não importar —</SelectItem>
                          {analise.colunas.map((col) => (
                            <SelectItem key={col} value={col}>{col}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {!podeImportar && (
          <p className="flex items-start gap-2 rounded-lg bg-warning/15 px-3 py-2 text-label text-warning">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Escolha ao menos um identificador — e-mail, telefone ou CPF/CNPJ. Sem isso não
            há como saber de quem é cada linha.
          </p>
        )}

        {/* amostra */}
        {analise.amostra.length > 0 && podeImportar && (
          <div>
            <h4 className="mb-2 text-micro uppercase text-muted-foreground">
              Como vai ficar — primeiras linhas
            </h4>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-label">
                <thead className="bg-muted/50">
                  <tr>
                    {campos.filter((c) => mapeamento[c.campo]).map((c) => (
                      <th key={c.campo} className="px-3 py-2 text-left font-medium">
                        {c.rotulo}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {analise.amostra.map((linha, i) => (
                    <tr key={i} className="border-t border-border">
                      {campos.filter((c) => mapeamento[c.campo]).map((c) => (
                        <td key={c.campo} className="max-w-[16rem] truncate px-3 py-2 text-muted-foreground">
                          {linha[mapeamento[c.campo]] || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* tratamento */}
        <div className="space-y-4 rounded-lg border border-border p-4">
          <h4 className="text-micro uppercase text-muted-foreground">Tratamento desta base</h4>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`nome-${analise.importacao_id}`}>Nome da base</Label>
              <Input
                id={`nome-${analise.importacao_id}`}
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Webinar de agosto"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`tags-${analise.importacao_id}`}>Etiquetas</Label>
              <Input
                id={`tags-${analise.importacao_id}`}
                value={tagsTexto}
                onChange={(e) => setTagsTexto(e.target.value)}
                placeholder="webinar, agosto, mentoria"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor={`desc-${analise.importacao_id}`}>Descrição</Label>
            <Input
              id={`desc-${analise.importacao_id}`}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="De onde veio e para que serve"
            />
          </div>

          {mapeamento.criado_em ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`de-${analise.importacao_id}`}>Só a partir de</Label>
              <Input
                id={`de-${analise.importacao_id}`}
                type="date"
                value={regras.periodo?.de ?? ''}
                onChange={(e) => setRegras((r) => ({
                  ...r, periodo: { ...r.periodo, de: e.target.value || undefined },
                }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`ate-${analise.importacao_id}`}>Só até</Label>
              <Input
                id={`ate-${analise.importacao_id}`}
                type="date"
                value={regras.periodo?.ate ?? ''}
                onChange={(e) => setRegras((r) => ({
                  ...r, periodo: { ...r.periodo, ate: e.target.value || undefined },
                }))}
              />
            </div>
          </div>
          ) : (
            <p className="text-micro text-muted-foreground">
              Mapeie uma coluna como <strong>Data</strong> para poder recortar por período.
            </p>
          )}

          {mapeamento.status ? (
            <div className="space-y-1">
              <Label htmlFor={`status-${analise.importacao_id}`}>Aceitar apenas estes status</Label>
              <Input
                id={`status-${analise.importacao_id}`}
                value={regras.status_aceitos?.join(', ') ?? ''}
                onChange={(e) => setRegras((r) => ({
                  ...r,
                  status_aceitos: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                }))}
                placeholder="paid, approved — vazio aceita todos"
              />
            </div>
          ) : (
            <p className="text-micro text-muted-foreground">
              Mapeie uma coluna como <strong>Status</strong> para poder filtrar por status.
            </p>
          )}

          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="text-label">Exigir projeto no catálogo</span>
              <span className="mt-0.5 block text-micro text-muted-foreground">
                Barra a importação se o projeto não estiver cadastrado. Ligue para relatórios
                da Assiny; desligue para listas de evento, webinar ou export de outra ferramenta.
              </span>
            </span>
            <Switch
              checked={regras.exigir_projeto_no_catalogo ?? false}
              onCheckedChange={(v) => setRegras((r) => ({ ...r, exigir_projeto_no_catalogo: v }))}
              disabled={embutido || !(mapeamento.projeto_nome || mapeamento.projeto_id)}
            />
          </label>

          {mapeamento.valor && (
            <label className="flex items-start justify-between gap-4">
              <span>
                <span className="text-label">O valor está em centavos</span>
                <span className="mt-0.5 block text-micro text-muted-foreground">
                  A Assiny exporta 3700 para R$ 37,00. Planilha feita à mão normalmente não.
                </span>
              </span>
              <Switch
                checked={transformacoes.valor === 'centavos_para_reais'}
                onCheckedChange={(v) => setTransformacoes((t) => ({
                  ...t,
                  valor: v ? 'centavos_para_reais' : '',
                  valor_liquido: v ? 'centavos_para_reais' : '',
                }))}
                disabled={embutido}
              />
            </label>
          )}

          {mapeamento.criado_em && (
            <label className="flex items-start justify-between gap-4">
              <span>
                <span className="text-label">A data está no horário de Brasília</span>
                <span className="mt-0.5 block text-micro text-muted-foreground">
                  Desligue se o arquivo já traz UTC. Guardamos sempre em UTC.
                </span>
              </span>
              <Switch
                checked={(transformacoes.criado_em ?? 'brt_para_utc') === 'brt_para_utc'}
                onCheckedChange={(v) => setTransformacoes((t) => ({
                  ...t, criado_em: v ? 'brt_para_utc' : 'utc',
                }))}
                disabled={embutido}
              />
            </label>
          )}
        </div>

        {/* perfil reutilizável */}
        {!embutido && (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <label className="flex items-start justify-between gap-4">
              <span>
                <span className="flex items-center gap-1.5 text-label">
                  <Save className="h-3.5 w-3.5" />
                  Guardar este de-para para a próxima vez
                </span>
                <span className="mt-0.5 block text-micro text-muted-foreground">
                  Da próxima vez que você arrastar um arquivo com estas colunas, o app
                  reconhece sozinho e já preenche tudo.
                </span>
              </span>
              <Switch checked={salvarPerfil} onCheckedChange={setSalvarPerfil} />
            </label>
            {salvarPerfil && (
              <Input
                value={nomePerfil}
                onChange={(e) => setNomePerfil(e.target.value)}
                placeholder="Nome do perfil — ex.: Export de contatos do HubSpot"
              />
            )}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={aoDescartar}>Descartar</Button>
          <Button
            onClick={() => importar.mutate()}
            disabled={!podeImportar || importar.isPending || (salvarPerfil && !nomePerfil.trim())}
          >
            {importar.isPending
              ? 'Importando…'
              : `Importar ${formatarNumero(analise.linhas)} linhas`}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
