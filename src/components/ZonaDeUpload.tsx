import { useCallback, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { formatarNumero } from '@/lib/dados'
import { EXTENSOES_ACEITAS, type Progresso } from '@/lib/importar'
import { cn } from '@/lib/utils'

const FASES: Record<Progresso['fase'], string> = {
  contando:    'Lendo o arquivo',
  enviando:    'Enviando',
  processando: 'Processando no servidor',
  pronto:      'Pronto',
}

function tamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * A área de soltar arquivo, com o que está acontecendo à vista.
 *
 * O POST para a Edge Function é uma espera de dezenas de segundos. Antes, a tela
 * dizia só "Lendo 2 de 2" e ficava parada: não dava para saber se o app tinha
 * travado, quanto faltava, nem quantas linhas o arquivo tinha. Agora cada fase
 * aparece com número — linhas contadas, bytes enviados, e o aviso explícito de
 * que 100% enviado ainda não é 100% pronto.
 */
export function ZonaDeUpload({
  progresso, ocupado, aoReceber, titulo, ajuda, rodape,
}: {
  progresso: Progresso | null
  ocupado: boolean
  aoReceber: (arquivos: File[]) => void
  titulo: string
  ajuda: string
  rodape?: ReactNode
}) {
  const [arrastando, setArrastando] = useState(false)
  const entrada = useRef<HTMLInputElement>(null)

  const receber = useCallback((lista: FileList | null) => {
    const arquivos = Array.from(lista ?? [])
    if (arquivos.length) aoReceber(arquivos)
  }, [aoReceber])

  return (
    <div
      onDragOver={(e: DragEvent) => { e.preventDefault(); if (!ocupado) setArrastando(true) }}
      onDragLeave={() => setArrastando(false)}
      onDrop={(e: DragEvent) => {
        e.preventDefault(); setArrastando(false)
        if (!ocupado) receber(e.dataTransfer.files)
      }}
      onClick={() => { if (!ocupado) entrada.current?.click() }}
      role="button"
      aria-busy={ocupado}
      tabIndex={ocupado ? -1 : 0}
      onKeyDown={(e) => {
        if (!ocupado && (e.key === 'Enter' || e.key === ' ')) entrada.current?.click()
      }}
      className={cn(
        'rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors',
        ocupado
          ? 'cursor-default border-primary/40 bg-primary/5'
          : arrastando
            ? 'cursor-pointer border-primary bg-primary/5'
            : 'cursor-pointer border-border hover:border-primary/50 hover:bg-muted/30',
      )}
    >
      <input ref={entrada} type="file" multiple accept={EXTENSOES_ACEITAS}
        className="hidden" disabled={ocupado}
        onChange={(e) => { receber(e.target.files); e.target.value = '' }} />

      {ocupado && progresso ? (
        <Andamento progresso={progresso} />
      ) : (
        <div className="flex flex-col items-center gap-3">
          <Upload className={cn('h-9 w-9', arrastando ? 'text-primary' : 'text-muted-foreground')} />
          <div>
            <p className="text-body font-medium">{titulo}</p>
            <p className="mt-1 text-label text-muted-foreground">{ajuda}</p>
          </div>
          {rodape}
        </div>
      )}
    </div>
  )
}

function Andamento({ progresso: p }: { progresso: Progresso }) {
  const totalBytes = p.bytesTotais ?? 0
  const lidos = p.bytesLidos ?? 0
  const pct = totalBytes > 0 ? Math.min(100, Math.round((lidos / totalBytes) * 100)) : 0
  // o servidor não reporta andamento: nessa fase a barra fica indeterminada
  const indeterminada = p.fase === 'processando'

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3">
      <div className="flex items-center gap-2 text-primary">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        <span className="text-body font-medium">{FASES[p.fase]}</span>
      </div>

      <p className="flex items-center gap-1.5 text-label text-muted-foreground">
        <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="max-w-[26rem] truncate">{p.arquivo}</span>
        {p.total > 1 && (
          <span className="shrink-0 tabular-nums">· {p.indice + 1} de {p.total}</span>
        )}
      </p>

      {/* a barra: determinada ao contar e ao enviar, pulsando ao processar */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={indeterminada ? undefined : pct}
        aria-valuemin={0} aria-valuemax={100}
        aria-label={FASES[p.fase]}>
        <div
          className={cn('h-full rounded-full bg-primary transition-[width] duration-150',
            indeterminada &&
              'barra-indeterminada w-1/3 animate-[upload-indeterminado_1.4s_ease-in-out_infinite]')}
          style={indeterminada ? undefined : { width: `${pct}%` }}
        />
      </div>

      <div className="flex flex-wrap items-baseline justify-center gap-x-4 gap-y-1 text-label">
        {p.linhas !== undefined && (
          <span className="tabular-nums">
            <strong className="text-foreground">{formatarNumero(p.linhas)}</strong>
            {' '}
            <span className="text-muted-foreground">
              {p.fase === 'contando' ? 'linhas lidas' : 'linhas no arquivo'}
            </span>
          </span>
        )}
        {totalBytes > 0 && !indeterminada && (
          <span className="tabular-nums text-muted-foreground">
            {tamanho(lidos)} de {tamanho(totalBytes)} · {pct}%
          </span>
        )}
      </div>

      <p className="text-micro text-muted-foreground">
        {p.fase === 'contando'
          ? 'Contando as linhas aqui no navegador, antes de enviar.'
          : p.fase === 'enviando'
            ? 'Enviando o arquivo. Não feche esta aba.'
            : 'O arquivo chegou inteiro. O servidor está lendo as colunas — ' +
              'isso leva alguns segundos e não dá para medir daqui.'}
      </p>
    </div>
  )
}
