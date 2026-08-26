// Qualificador de Leads ROI · fase 1 (carga em volume) · fase 5 (tela de upload)
//
// Recebe o report-transaction da Assiny e carrega em qualificador.staging_assiny,
// depois chama qualificador.ingerir_assiny(), que normaliza, resolve identidade e
// popula pessoa / pessoa_identificador / transacao.
//
// Existe porque carregar CSV por SQL não escala: um relatório de 6.685 linhas
// exigiria dezenas de chamadas. Aqui o arquivo chega inteiro, num POST.
//
// POST multipart/form-data com o campo `arquivo`
//   -> { importacao_id, arquivo, itens_no_arquivo, transacoes, transacoes_novas, ... }
//
// Projeto fora do catálogo derruba a importação inteira, por desenho (PRD 5.1):
// a transação é revertida e nada fica pela metade.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import postgres from 'npm:postgres@3.4.5'
import { lerCsv, recortar } from './csv.ts'

const LOTE = 500          // linhas por INSERT
const MAX_BYTES = 60 * 1024 * 1024

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

  let nomeArquivo = 'upload.csv'
  let texto: string
  try {
    const form = await req.formData()
    const arquivo = form.get('arquivo')
    if (!(arquivo instanceof File)) {
      return responder({ erro: 'Envie o CSV no campo "arquivo" (multipart/form-data)' }, 400)
    }
    if (arquivo.size > MAX_BYTES) {
      return responder(
        { erro: `Arquivo de ${(arquivo.size / 1048576).toFixed(1)} MB excede o limite de 60 MB` },
        413,
      )
    }
    nomeArquivo = arquivo.name || nomeArquivo
    texto = await arquivo.text()
  } catch (e) {
    return responder({ erro: `Não foi possível ler o arquivo: ${(e as Error).message}` }, 400)
  }

  let recorte
  try {
    const { cabecalho, linhas } = lerCsv(texto)
    if (linhas.length === 0) return responder({ erro: 'O arquivo não tem nenhuma linha' }, 400)
    recorte = recortar(cabecalho, linhas)
  } catch (e) {
    return responder({ erro: (e as Error).message }, 422)
  }

  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1 })
  const inicio = Date.now()

  try {
    const [perfil] = await sql`
      select papel::text from qualificador.user_profiles where user_id = ${user.id}::uuid`
    if (!perfil || !['operador', 'gestao'].includes(perfil.papel)) {
      return responder(
        { erro: 'Importar exige papel operador ou gestao', papel: perfil?.papel ?? null },
        403,
      )
    }

    // tudo ou nada: se a ingestão barrar por projeto desconhecido, nem a importação
    // nem o staging sobram no banco
    const resultado = await sql.begin(async (tx) => {
      const [imp] = await tx`
        insert into qualificador.importacao (arquivo, importado_por)
        values (${nomeArquivo}, ${user.id}::uuid)
        returning id`

      const colunas = ['importacao_id', 'linha', ...recorte.colunas]
      for (let i = 0; i < recorte.valores.length; i += LOTE) {
        const fatia = recorte.valores.slice(i, i + LOTE).map((valores, j) => {
          const linha: Record<string, unknown> = { importacao_id: imp.id, linha: i + j + 1 }
          recorte.colunas.forEach((c, k) => { linha[c] = valores[k] })
          return linha
        })
        await tx`insert into qualificador.staging_assiny ${tx(fatia, ...colunas)}`
      }

      const [{ ingerir_assiny: r }] = await tx`
        select qualificador.ingerir_assiny(${imp.id}) as ingerir_assiny`
      return { ...r, arquivo: nomeArquivo }
    })

    await sql`select qualificador.registrar_execucao(
      'assiny', 'importar_csv', 'ok', ${resultado.transacoes_novas ?? null},
      ${Date.now() - inicio}, null)`

    return responder({
      ...resultado,
      colunas_ignoradas: recorte.ignoradas,
      duracao_ms: Date.now() - inicio,
    })
  } catch (e) {
    const mensagem = String((e as Error)?.message ?? e)
    try {
      await sql`select qualificador.registrar_execucao(
        'assiny', 'importar_csv', 'erro', null, ${Date.now() - inicio}, ${mensagem})`
    } catch { /* o log não pode mascarar o erro original */ }

    // projeto fora do catálogo não é falha do sistema: é decisão pendente
    const bloqueio = mensagem.includes('Importacao bloqueada')
    return responder({ erro: mensagem, bloqueio_de_catalogo: bloqueio }, bloqueio ? 409 : 500)
  } finally {
    await sql.end()
  }
})
