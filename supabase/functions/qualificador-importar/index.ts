// Qualificador de Leads ROI · importador genérico
//
// Duas ações, porque importar planilha de origem desconhecida tem dois momentos:
//
//   analisar  — recebe os arquivos, guarda as linhas cruas no staging e devolve
//               as colunas encontradas, uma amostra e um palpite de de-para.
//               NADA vai para pessoa/transacao ainda.
//   ingerir   — recebe o mapeamento revisado por quem importou e só então grava.
//
// Separar os dois é o que permite arrastar qualquer planilha: o de-para é decidido
// olhando o conteúdo real, e dá para refazer a ingestão com outro mapeamento sem
// subir o arquivo de novo.
//
// Arquivo que não é planilha (.md, .txt) vira documento anexo, não vira dado.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import postgres from 'npm:postgres@3.4.5'
import {
  adivinharMapeamento, CAMPOS_CANONICOS, formatoDe,
  processarDelimitado, processarXlsx, type Cabecalho,
} from './planilha.ts'

// Lotes pequenos de propósito: o pico de memória da função é o tamanho do lote,
// não o do arquivo. Foi lote grande + arquivo inteiro em memória que produziu
// HTTP 546 (WORKER_LIMIT) ao subir vários relatórios da Assiny de uma vez.
const LOTE = 200
const MAX_BYTES = 60 * 1024 * 1024
/** Acima disso, um único worker não dá conta de vários arquivos por requisição. */
const MAX_ARQUIVOS_POR_REQUISICAO = 4

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return responder({ erro: 'Use POST' }, 405)

  const autorizacao = req.headers.get('Authorization')
  if (!autorizacao) return responder({ erro: 'Cabeçalho Authorization ausente' }, 401)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: autorizacao } } },
  )
  const { data: { user }, error: erroAuth } = await supabase.auth.getUser()
  if (erroAuth || !user) return responder({ erro: 'Sessão inválida' }, 401)

  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1 })

  try {
    const [perfil] = await sql`
      select papel::text from qualificador.user_profiles where user_id = ${user.id}::uuid`
    if (!perfil || !['operador', 'gestao'].includes(perfil.papel)) {
      return responder(
        { erro: 'Importar exige papel operador ou gestao', papel: perfil?.papel ?? null },
        403,
      )
    }

    const tipo = req.headers.get('content-type') ?? ''
    return tipo.includes('multipart/form-data')
      ? await analisar(req, sql, user.id)
      : await ingerir(req, sql)
  } catch (e) {
    return responder({ erro: String((e as Error)?.message ?? e) }, 500)
  } finally {
    await sql.end()
  }
})

// --------------------------------------------------------------------- analisar

// deno-lint-ignore no-explicit-any
async function analisar(req: Request, sql: any, userId: string): Promise<Response> {
  const form = await req.formData()
  const arquivos = form.getAll('arquivos').filter((a): a is File => a instanceof File)
  // permite refazer a leitura apontando a linha do cabeçalho, quando a planilha
  // tem título ou notas antes dos nomes das colunas e a detecção erra
  const linhaCabecalho = form.get('linha_cabecalho')
    ? Number(form.get('linha_cabecalho'))
    : undefined
  if (arquivos.length === 0) {
    return responder({ erro: 'Envie ao menos um arquivo no campo "arquivos"' }, 400)
  }
  if (arquivos.length > MAX_ARQUIVOS_POR_REQUISICAO) {
    return responder({
      erro: `Máximo de ${MAX_ARQUIVOS_POR_REQUISICAO} arquivos por vez (recebidos ${arquivos.length}).`,
      dica: 'O front envia um arquivo por requisição; esta trava existe para chamadas diretas.',
    }, 413)
  }

  const resultados: unknown[] = []
  const documentos: unknown[] = []

  for (const arquivo of arquivos) {
    if (arquivo.size > MAX_BYTES) {
      resultados.push({
        arquivo: arquivo.name,
        erro: `${(arquivo.size / 1048576).toFixed(1)} MB excede o limite de 60 MB`,
      })
      continue
    }

    const formato = formatoDe(arquivo.name)

    if (formato === 'texto') {
      const [doc] = await sql`
        insert into qualificador.documento (nome, formato, conteudo, criado_por)
        values (${arquivo.name}, ${arquivo.name.split('.').pop() ?? 'txt'},
                ${await arquivo.text()}, ${userId}::uuid)
        returning id`
      documentos.push({ id: doc.id, arquivo: arquivo.name })
      continue
    }

    // a importação nasce antes da leitura: os lotes são gravados enquanto o
    // arquivo é percorrido, sem nunca materializar a planilha inteira
    const [imp] = await sql`
      insert into qualificador.importacao (arquivo, formato, status, importado_por)
      values (${arquivo.name}, ${formato}, 'analisado', ${userId}::uuid)
      returning id`

    const gravarLote = async (linhas: Record<string, string>[], primeira: number) => {
      // objeto via sql.json: o driver serializa uma vez para jsonb. Com JSON.stringify
      // aqui, ele serializa de novo e a coluna guarda uma STRING de JSON, não um objeto --
      // jsonb_typeof passa a devolver "string" e todo `dados ->> 'coluna'` vira null.
      const fatia = linhas.map((dados, j) => ({
        importacao_id: imp.id,
        linha: primeira + j,
        dados: sql.json(dados),
      }))
      await sql`insert into qualificador.staging_generico ${
        sql(fatia, 'importacao_id', 'linha', 'dados')
      }`
    }

    let planilha: Cabecalho
    try {
      planilha = formato === 'xlsx'
        ? await processarXlsx(await arquivo.arrayBuffer(), linhaCabecalho, LOTE, gravarLote)
        : await processarDelimitado(await arquivo.text(), linhaCabecalho, LOTE, gravarLote)
    } catch (e) {
      await sql`delete from qualificador.importacao where id = ${imp.id}`.catch(() => {})
      resultados.push({ arquivo: arquivo.name, erro: `Não foi possível ler: ${(e as Error).message}` })
      continue
    }

    if (planilha.total === 0) {
      await sql`delete from qualificador.importacao where id = ${imp.id}`.catch(() => {})
      resultados.push({ arquivo: arquivo.name, erro: 'Nenhuma linha de dados no arquivo' })
      continue
    }

    const sugestoes = await sql`
      select * from qualificador.sugerir_fonte(${planilha.colunas})`
    if (sugestoes[0]) {
      await sql`update qualificador.importacao set fonte_importacao_id = ${sugestoes[0].id}
                where id = ${imp.id}`
    }

    // se um perfil salvo reconheceu o arquivo, o de-para dele vale mais que o palpite
    let mapeamento = adivinharMapeamento(planilha.colunas)
    let transformacoes: Record<string, string> = {}
    let regras: Record<string, unknown> = {}
    if (sugestoes[0]) {
      const [f] = await sql`
        select mapeamento, transformacoes, regras
        from qualificador.fonte_importacao where id = ${sugestoes[0].id}`
      mapeamento = f.mapeamento
      transformacoes = f.transformacoes
      regras = f.regras
    }

    resultados.push({
      importacao_id: imp.id,
      arquivo: arquivo.name,
      formato,
      linhas: planilha.total,
      linha_cabecalho: planilha.linhaCabecalho,
      colunas: planilha.colunas,
      amostra: planilha.amostra,
      fonte_sugerida: sugestoes[0]
        ? { id: sugestoes[0].id, nome: sugestoes[0].nome, embutido: sugestoes[0].embutido }
        : null,
      mapeamento,
      transformacoes,
      regras,
    })
  }

  return responder({ analisados: resultados, documentos, campos: CAMPOS_CANONICOS })
}

// ---------------------------------------------------------------------- ingerir

interface CorpoIngestao {
  importacao_id?: string
  mapeamento?: Record<string, string>
  transformacoes?: Record<string, string>
  regras?: Record<string, unknown>
  nome?: string
  descricao?: string
  tags?: string[]
  /** grava o de-para como perfil reutilizável com este nome */
  salvar_como?: string
  /** assinatura do perfil novo: colunas que passam a identificar este formato */
  assinatura?: string[]
}

// deno-lint-ignore no-explicit-any
async function ingerir(req: Request, sql: any): Promise<Response> {
  let corpo: CorpoIngestao
  try {
    corpo = await req.json()
  } catch {
    return responder({ erro: 'Corpo da requisição não é JSON' }, 400)
  }

  const id = corpo.importacao_id
  if (!id) return responder({ erro: 'Informe importacao_id' }, 400)

  const [imp] = await sql`
    select i.id, i.status, i.fonte_importacao_id, f.embutido
    from qualificador.importacao i
    left join qualificador.fonte_importacao f on f.id = i.fonte_importacao_id
    where i.id = ${id}::uuid`
  if (!imp) return responder({ erro: 'Importação não encontrada' }, 404)
  if (imp.status === 'ingerido') {
    return responder({ erro: 'Esta importação já foi ingerida' }, 409)
  }

  const inicio = Date.now()
  try {
    const resultado = await sql.begin(async (tx: typeof sql) => {
      let fonteId = imp.fonte_importacao_id

      // perfil novo, ou atualização de um perfil que não seja embutido
      if (corpo.salvar_como) {
        const [f] = await tx`
          insert into qualificador.fonte_importacao
            (nome, mapeamento, transformacoes, regras, assinatura)
          values (${corpo.salvar_como}, ${sql.json(corpo.mapeamento ?? {})},
                  ${sql.json(corpo.transformacoes ?? {})},
                  ${sql.json(corpo.regras ?? {})},
                  ${corpo.assinatura ?? null})
          on conflict (nome) do update set
            mapeamento     = excluded.mapeamento,
            transformacoes = excluded.transformacoes,
            regras         = excluded.regras,
            assinatura     = coalesce(excluded.assinatura, qualificador.fonte_importacao.assinatura)
          where not qualificador.fonte_importacao.embutido
          returning id`
        if (f) fonteId = f.id
      }

      await tx`
        update qualificador.importacao set
          nome                = coalesce(${corpo.nome ?? null}, nome),
          descricao           = coalesce(${corpo.descricao ?? null}, descricao),
          tags                = coalesce(${corpo.tags ?? null}, tags),
          fonte_importacao_id = ${fonteId},
          mapeamento          = ${sql.json(corpo.mapeamento ?? {})},
          transformacoes      = ${sql.json(corpo.transformacoes ?? {})},
          regras              = ${sql.json(corpo.regras ?? {})}
        where id = ${id}::uuid`

      // O relatório da Assiny tem N itens por transação e precisa do parser que
      // agrega order bumps. Só ele passa por staging_assiny.
      if (imp.embutido) {
        await tx`
          insert into qualificador.staging_assiny
            (importacao_id, linha, transaction_id, nome_do_produto, tipo_de_checkout,
             nome_do_projeto, project_id, valor, valor_liquido, criado_em, status,
             nome_da_oferta, nome_do_funil, client_id, nome_completo_do_cliente,
             telefone_do_cliente, email_do_cliente, documento_do_cliente, utm_source)
          select g.importacao_id, g.linha,
                 g.dados->>'TransactionId',          g.dados->>'NomeDoProduto',
                 g.dados->>'TipoDeCheckout',         g.dados->>'NomeDoProjeto',
                 g.dados->>'ProjectId',              g.dados->>'Valor',
                 g.dados->>'ValorLiquido',           g.dados->>'CriadoEm',
                 g.dados->>'Status',                 g.dados->>'NomeDaOferta',
                 g.dados->>'NomeDoFunil',            g.dados->>'ClientId',
                 g.dados->>'NomeCompletoDoCliente',  g.dados->>'TelefoneDoCliente',
                 g.dados->>'EmailDoCliente',         g.dados->>'DocumentoDoCliente',
                 g.dados->>'UtmSource'
          from qualificador.staging_generico g
          where g.importacao_id = ${id}::uuid
          on conflict (importacao_id, linha) do nothing`

        const [{ r }] = await tx`select qualificador.ingerir_assiny(${id}::uuid) as r`
        await tx`update qualificador.importacao set status = 'ingerido' where id = ${id}::uuid`
        return { ...r, caminho: 'assiny' }
      }

      const [{ r }] = await tx`
        select qualificador.ingerir_generico(
          ${id}::uuid,
          ${sql.json(corpo.mapeamento ?? {})},
          ${sql.json(corpo.transformacoes ?? {})},
          ${sql.json(corpo.regras ?? {})}
        ) as r`
      return { ...r, caminho: 'generico' }
    })

    await sql`select qualificador.registrar_execucao(
      'assiny', 'importar', 'ok', ${resultado.transacoes_novas ?? resultado.pessoas_criadas ?? null},
      ${Date.now() - inicio}, null)`

    return responder({ ...resultado, duracao_ms: Date.now() - inicio })
  } catch (e) {
    const mensagem = String((e as Error)?.message ?? e)
    await sql`update qualificador.importacao set status = 'erro' where id = ${id}::uuid`
      .catch(() => {})
    await sql`select qualificador.registrar_execucao(
      'assiny', 'importar', 'erro', null, ${Date.now() - inicio}, ${mensagem})`.catch(() => {})

    const bloqueio = mensagem.includes('Importacao bloqueada')
    return responder({ erro: mensagem, bloqueio_de_catalogo: bloqueio }, bloqueio ? 409 : 500)
  }
}
