// Leitura de planilha: CSV, XLSX/XLS, TSV — e texto solto (.md, .txt).
//
// Tudo aqui é INCREMENTAL, por causa de um limite real: a Edge Function morre com
// HTTP 546 (WORKER_LIMIT) se materializar um relatório da Assiny inteiro em memória.
// São ~6.700 linhas × 63 colunas; um objeto JS por linha, com 63 chaves cada, passa
// de 400 mil strings vivas ao mesmo tempo — e isso para UM arquivo.
//
// Por isso as linhas saem de um gerador e são entregues em lotes, que o chamador
// grava e descarta. O pico de memória passa a ser o tamanho do lote, não do arquivo.

import * as XLSX from 'npm:xlsx@0.18.5'

export type Formato = 'csv' | 'xlsx' | 'texto'

export interface Cabecalho {
  colunas: string[]
  linhaCabecalho: number
  amostra: Record<string, string>[]
  total: number
}

export type AoLote = (linhas: Record<string, string>[], primeira: number) => Promise<void>

export function formatoDe(nome: string): Formato {
  const ext = nome.toLowerCase().split('.').pop() ?? ''
  if (['xlsx', 'xls', 'xlsm', 'ods'].includes(ext)) return 'xlsx'
  if (['csv', 'tsv'].includes(ext)) return 'csv'
  if (['md', 'markdown', 'txt', 'json'].includes(ext)) return 'texto'
  return 'csv' // extensão desconhecida: tenta como texto delimitado
}

/** Detecta o delimitador pela linha de cabeçalho: vírgula, ponto e vírgula ou tab. */
function delimitadorDe(primeiraLinha: string): string {
  let melhor = ','
  let maior = -1
  for (const d of [',', ';', '\t']) {
    let n = 0, aspas = false
    for (const c of primeiraLinha) {
      if (c === '"') aspas = !aspas
      else if (c === d && !aspas) n++
    }
    if (n > maior) { maior = n; melhor = d }
  }
  return melhor
}

/**
 * Percorre o texto uma vez e emite uma linha por vez. Mantém em memória apenas a
 * célula e a linha correntes — nunca o arquivo convertido.
 */
function* linhasDe(conteudo: string, delim: string): Generator<string[]> {
  let celula = ''
  let linha: string[] = []
  let aspas = false

  for (let i = 0; i < conteudo.length; i++) {
    const c = conteudo[i]
    if (aspas) {
      if (c === '"') {
        if (conteudo[i + 1] === '"') { celula += '"'; i++ } else aspas = false
      } else celula += c
      continue
    }
    if (c === '"') { aspas = true; continue }
    if (c === delim) { linha.push(celula); celula = ''; continue }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && conteudo[i + 1] === '\n') i++
      linha.push(celula)
      if (linha.length > 1 || linha[0] !== '') yield linha
      linha = []
      celula = ''
      continue
    }
    celula += c
  }
  if (celula !== '' || linha.length > 0) {
    linha.push(celula)
    if (linha.length > 1 || linha[0] !== '') yield linha
  }
}

/**
 * Acha a linha de cabeçalho. Planilha de gente costuma ter título, logo ou linha
 * em branco antes dos nomes das colunas — pegar a linha 1 cegamente produz
 * "coluna_2", "coluna_3" e um mapeamento inútil.
 */
export function detectarCabecalho(topo: string[][]): number {
  if (topo.length === 0) return 0
  const preenchidas = topo.map((l) => l.filter((c) => (c ?? '').trim() !== '').length)
  const maximo = Math.max(...preenchidas)
  if (maximo < 2) return 0
  const indice = preenchidas.findIndex((n) => n >= Math.ceil(maximo * 0.6) && n >= 2)
  return indice === -1 ? 0 : indice
}

/** Colunas sem nome viram "coluna_N"; nomes repetidos ganham sufixo. */
function nomearColunas(bruto: string[]): string[] {
  const vistos = new Map<string, number>()
  return bruto.map((h, i) => {
    let nome = (h ?? '').trim() || `coluna_${i + 1}`
    const n = vistos.get(nome) ?? 0
    vistos.set(nome, n + 1)
    if (n > 0) nome = `${nome} (${n + 1})`
    return nome
  })
}

/** Devolve null para linha totalmente vazia — comum no fim de planilha. */
function paraRegistro(linha: string[], colunas: string[]): Record<string, string> | null {
  const r: Record<string, string> = {}
  let algum = false
  colunas.forEach((c, i) => {
    const v = (linha[i] ?? '').trim()
    r[c] = v
    if (v !== '') algum = true
  })
  return algum ? r : null
}

const OLHAR_PARA_CABECALHO = 15
const AMOSTRA = 5

export async function processarDelimitado(
  texto: string,
  linhaCabecalho: number | undefined,
  tamanhoLote: number,
  aoLote: AoLote,
): Promise<Cabecalho> {
  const conteudo = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto
  const quebra = conteudo.search(/\r?\n/)
  const delim = delimitadorDe(quebra === -1 ? conteudo : conteudo.slice(0, quebra))

  const it = linhasDe(conteudo, delim)

  // buffer pequeno, só para decidir onde está o cabeçalho
  const topo: string[][] = []
  for (let i = 0; i < OLHAR_PARA_CABECALHO; i++) {
    const n = it.next()
    if (n.done) break
    topo.push(n.value)
  }
  const inicio = linhaCabecalho ?? detectarCabecalho(topo)
  const colunas = nomearColunas(topo[inicio] ?? [])

  const amostra: Record<string, string>[] = []
  let lote: Record<string, string>[] = []
  let total = 0

  const empurrar = async (registro: Record<string, string>) => {
    total++
    if (amostra.length < AMOSTRA) amostra.push(registro)
    lote.push(registro)
    if (lote.length >= tamanhoLote) {
      await aoLote(lote, total - lote.length + 1)
      lote = []   // o lote gravado fica elegível para coleta
    }
  }

  for (const linha of topo.slice(inicio + 1)) {
    const r = paraRegistro(linha, colunas)
    if (r) await empurrar(r)
  }
  for (const linha of it) {
    const r = paraRegistro(linha, colunas)
    if (r) await empurrar(r)
  }
  if (lote.length) await aoLote(lote, total - lote.length + 1)

  return { colunas, linhaCabecalho: inicio, amostra, total }
}

export async function processarXlsx(
  bytes: ArrayBuffer,
  linhaCabecalho: number | undefined,
  tamanhoLote: number,
  aoLote: AoLote,
): Promise<Cabecalho> {
  const wb = XLSX.read(new Uint8Array(bytes), {
    type: 'array', cellDates: false, raw: false, cellStyles: false, cellHTML: false,
  })
  const nomeAba = wb.SheetNames[0]
  const vazio = { colunas: [], linhaCabecalho: 0, amostra: [], total: 0 }
  if (!nomeAba) return vazio
  const aba = wb.Sheets[nomeAba]
  const ref = aba['!ref']
  if (!ref) return vazio

  const range = XLSX.utils.decode_range(ref)
  const ler = (de: number, ate: number): string[][] =>
    XLSX.utils.sheet_to_json<string[]>(aba, {
      header: 1, raw: false, defval: '', blankrows: false,
      range: { s: { r: de, c: range.s.c }, e: { r: Math.min(ate, range.e.r), c: range.e.c } },
    }).map((l) => l.map((c) => String(c ?? '')))

  const topo = ler(range.s.r, range.s.r + OLHAR_PARA_CABECALHO - 1)
  const inicio = linhaCabecalho ?? detectarCabecalho(topo)
  const colunas = nomearColunas(topo[inicio] ?? [])

  const amostra: Record<string, string>[] = []
  let total = 0
  // lê a aba em blocos: o range evita converter a planilha inteira de uma vez
  for (let r = range.s.r + inicio + 1; r <= range.e.r; r += tamanhoLote) {
    const bloco = ler(r, r + tamanhoLote - 1)
    const lote: Record<string, string>[] = []
    for (const linha of bloco) {
      const reg = paraRegistro(linha, colunas)
      if (!reg) continue
      total++
      if (amostra.length < AMOSTRA) amostra.push(reg)
      lote.push(reg)
    }
    if (lote.length) await aoLote(lote, total - lote.length + 1)
  }

  return { colunas, linhaCabecalho: inicio, amostra, total }
}

/** Campos canônicos que o Qualificador entende, na ordem em que a tela os mostra. */
export const CAMPOS_CANONICOS = [
  { campo: 'email', rotulo: 'E-mail', grupo: 'identidade', chave: true },
  { campo: 'telefone', rotulo: 'Telefone', grupo: 'identidade', chave: true },
  { campo: 'documento', rotulo: 'CPF / CNPJ', grupo: 'identidade', chave: true },
  { campo: 'nome', rotulo: 'Nome', grupo: 'identidade' },
  { campo: 'assiny_client_id', rotulo: 'ID do cliente na Assiny', grupo: 'identidade' },
  { campo: 'transaction_id', rotulo: 'ID da transação', grupo: 'transacao' },
  { campo: 'produto', rotulo: 'Produto', grupo: 'transacao' },
  { campo: 'oferta', rotulo: 'Oferta', grupo: 'transacao' },
  { campo: 'funil', rotulo: 'Funil', grupo: 'transacao' },
  { campo: 'utm_source', rotulo: 'UTM source', grupo: 'transacao' },
  { campo: 'valor', rotulo: 'Valor', grupo: 'transacao' },
  { campo: 'valor_liquido', rotulo: 'Valor líquido', grupo: 'transacao' },
  { campo: 'status', rotulo: 'Status', grupo: 'transacao' },
  { campo: 'criado_em', rotulo: 'Data', grupo: 'transacao' },
  { campo: 'projeto_nome', rotulo: 'Projeto (nome)', grupo: 'projeto' },
  { campo: 'projeto_id', rotulo: 'Projeto (ID)', grupo: 'projeto' },
] as const

/** Palpite de de-para por semelhança de nome, para a tela já vir preenchida. */
export function adivinharMapeamento(colunas: string[]): Record<string, string> {
  const pistas: Record<string, string[]> = {
    email: ['email', 'e-mail', 'mail', 'correio'],
    telefone: ['telefone', 'phone', 'celular', 'whatsapp', 'whats', 'fone', 'mobile'],
    documento: ['documento', 'cpf', 'cnpj', 'doc'],
    nome: ['nome completo', 'nomecompleto', 'fullname', 'full name', 'nome', 'name', 'cliente'],
    transaction_id: ['transactionid', 'transaction id', 'id da transacao', 'pedido', 'order'],
    produto: ['produto', 'product', 'item'],
    oferta: ['oferta', 'offer', 'plano'],
    funil: ['funil', 'funnel'],
    utm_source: ['utmsource', 'utm source', 'utm_source', 'origem'],
    valor: ['valor bruto', 'valor', 'amount', 'preco', 'preço', 'total'],
    valor_liquido: ['valorliquido', 'valor liquido', 'valor líquido', 'liquido', 'net'],
    status: ['status', 'situacao', 'situação'],
    criado_em: ['criadoem', 'criado em', 'data', 'date', 'created'],
    projeto_nome: ['nomedoprojeto', 'nome do projeto', 'projeto', 'project'],
    projeto_id: ['projectid', 'project id', 'id do projeto'],
  }
  const normalizar = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[_\s-]/g, '')

  const mapa: Record<string, string> = {}
  const usadas = new Set<string>()
  for (const [campo, termos] of Object.entries(pistas)) {
    for (const termo of termos) {
      const alvo = normalizar(termo)
      const achada = colunas.find((c) => !usadas.has(c) && normalizar(c) === alvo)
        ?? colunas.find((c) => !usadas.has(c) && normalizar(c).includes(alvo))
      if (achada) { mapa[campo] = achada; usadas.add(achada); break }
    }
  }
  return mapa
}
