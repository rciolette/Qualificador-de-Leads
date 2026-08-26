// Leitura de planilha: CSV, XLSX/XLS, TSV — e texto solto (.md, .txt).
//
// O CSV é parseado à mão porque o export da Assiny tem vírgula dentro de aspas,
// quebra de linha em campo, BOM e CRLF. XLSX vai pelo SheetJS.

import * as XLSX from 'npm:xlsx@0.18.5'

export type Formato = 'csv' | 'xlsx' | 'texto'

export interface Planilha {
  colunas: string[]
  linhas: Record<string, string>[]
  /** 0-indexado: quantas linhas de título foram puladas antes do cabeçalho */
  linhaCabecalho: number
}

export function formatoDe(nome: string): Formato {
  const ext = nome.toLowerCase().split('.').pop() ?? ''
  if (['xlsx', 'xls', 'xlsm', 'ods'].includes(ext)) return 'xlsx'
  if (['csv', 'tsv'].includes(ext)) return 'csv'
  if (['md', 'markdown', 'txt', 'json'].includes(ext)) return 'texto'
  return 'csv' // extensão desconhecida: tenta como texto delimitado
}

/** Detecta o delimitador pela linha de cabeçalho: vírgula, ponto e vírgula ou tab. */
function delimitadorDe(primeiraLinha: string): string {
  const candidatos = [',', ';', '\t']
  let melhor = ','
  let maior = -1
  for (const d of candidatos) {
    // conta só as ocorrências fora de aspas
    let n = 0, aspas = false
    for (const c of primeiraLinha) {
      if (c === '"') aspas = !aspas
      else if (c === d && !aspas) n++
    }
    if (n > maior) { maior = n; melhor = d }
  }
  return melhor
}

export function lerDelimitado(texto: string, linhaCabecalho?: number): Planilha {
  const conteudo = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto
  const primeiraQuebra = conteudo.search(/\r?\n/)
  const delim = delimitadorDe(
    primeiraQuebra === -1 ? conteudo : conteudo.slice(0, primeiraQuebra),
  )

  const linhas: string[][] = []
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
      if (linha.length > 1 || linha[0] !== '') linhas.push(linha)
      linha = []; celula = ''
      continue
    }
    celula += c
  }
  if (celula !== '' || linha.length > 0) {
    linha.push(celula)
    if (linha.length > 1 || linha[0] !== '') linhas.push(linha)
  }

  return montar(linhas)
}

/**
 * Acha a linha de cabeçalho. Planilha de gente costuma ter título, logo ou linha
 * em branco antes dos nomes das colunas — pegar a linha 1 cegamente produz
 * "coluna_2", "coluna_3" e um mapeamento inútil.
 *
 * Heurística: entre as primeiras linhas, a de cabeçalho é a primeira que preenche
 * quase tantas células quanto a linha mais preenchida do topo.
 */
export function detectarCabecalho(matriz: string[][], limite = 15): number {
  const topo = matriz.slice(0, limite)
  if (topo.length === 0) return 0
  const preenchidas = topo.map((l) => l.filter((c) => (c ?? '').trim() !== '').length)
  const maximo = Math.max(...preenchidas)
  if (maximo < 2) return 0
  const indice = preenchidas.findIndex((n) => n >= Math.ceil(maximo * 0.6) && n >= 2)
  return indice === -1 ? 0 : indice
}

export function lerXlsx(bytes: ArrayBuffer, linhaCabecalho?: number): Planilha {
  const wb = XLSX.read(new Uint8Array(bytes), { type: 'array', cellDates: false, raw: false })
  const nomeAba = wb.SheetNames[0]
  if (!nomeAba) return { colunas: [], linhas: [], linhaCabecalho: 0 }
  const matriz = XLSX.utils
    .sheet_to_json<string[]>(wb.Sheets[nomeAba], {
      header: 1, raw: false, defval: '', blankrows: false,
    })
    .map((l) => l.map((c) => String(c ?? '')))
  const inicio = linhaCabecalho ?? detectarCabecalho(matriz)
  return montar(matriz.slice(inicio), inicio)
}

/**
 * Primeira linha vira cabeçalho. Colunas sem nome ganham "coluna_N" e nomes
 * repetidos ganham sufixo — senão uma sobrescreve a outra no objeto.
 */
function montar(linhas: string[][], linhaCabecalho = 0): Planilha {
  const bruto = linhas.shift() ?? []
  const vistos = new Map<string, number>()
  const colunas = bruto.map((h, i) => {
    let nome = (h ?? '').trim() || `coluna_${i + 1}`
    const n = vistos.get(nome) ?? 0
    vistos.set(nome, n + 1)
    if (n > 0) nome = `${nome} (${n + 1})`
    return nome
  })

  const registros = linhas
    .map((l) => {
      const r: Record<string, string> = {}
      colunas.forEach((c, i) => { r[c] = (l[i] ?? '').trim() })
      return r
    })
    // descarta linha totalmente vazia (comum no fim de planilha)
    .filter((r) => Object.values(r).some((v) => v !== ''))

  return { colunas, linhas: registros, linhaCabecalho }
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
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[_\s-]/g, '')

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
