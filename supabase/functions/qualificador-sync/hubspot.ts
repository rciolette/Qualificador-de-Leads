// Adaptador HubSpot — SOMENTE LEITURA (PRD 4.1: a v1 não escreve no CRM).
//
// Três chamadas por lote de 100 e-mails:
//   1. contacts/batch/read com idProperty=email
//   2. v4/associations/contacts/deals/batch/read
//   3. deals/batch/read
//
// O passo 3 não é opcional: aux_falha_sellflux — fonte do bloqueio duro
// "falha de entrega registrada" (PRD 7.1) — vive no NEGÓCIO, não no contato,
// ao contrário do que diz o anexo B. Sem descer ao deal, esse bloqueio não existe.

import {
  Adaptador, Alvo, Contexto, Gravacao, Resultado,
  buscar, comoBooleano, comoNumero, fatiar, listaHubspot, normDocumento, normTelefone,
} from './contrato.ts'

interface ContatoHs { id: string; properties: Record<string, string | null> }
interface NegocioHs { id: string; properties: Record<string, string | null> }

const LOTE_MAXIMO = 100 // teto do batch/read do HubSpot

export const hubspot: Adaptador = {
  slug: 'hubspot',

  async sincronizar(alvos: Alvo[], ctx: Contexto): Promise<Resultado> {
    const propsContato = (ctx.config.props_contato as string[]) ?? ['email']
    const propsNegocio = (ctx.config.props_negocio as string[]) ?? ['pipeline', 'dealstage']
    const stagesPorPipeline =
      (ctx.config.stages_por_pipeline as Record<string, Record<string, unknown>>) ?? {}
    const stagesBloqueio = new Set(
      ((ctx.config.stages_bloqueio_duro as number[]) ?? []).map(String),
    )

    const cabecalhos = {
      Authorization: `Bearer ${ctx.credencial}`,
      'Content-Type': 'application/json',
    }

    const gravacoes: Gravacao[] = []
    const avisos: string[] = []
    let chamadas = 0
    let encontrados = 0

    const porEmail = new Map(alvos.map((a) => [a.email.toLowerCase(), a]))

    for (const lote of fatiar(alvos, Math.min(ctx.lote, LOTE_MAXIMO))) {
      // 1. contatos por e-mail -------------------------------------------------
      const rContatos = await buscar(
        `${ctx.baseUrl}/crm/v3/objects/contacts/batch/read`,
        {
          method: 'POST',
          headers: cabecalhos,
          body: JSON.stringify({
            idProperty: 'email',
            properties: propsContato,
            inputs: lote.map((a) => ({ id: a.email })),
          }),
        },
        'hubspot contacts/batch/read',
      )
      chamadas++
      const dadosContatos = await rContatos.json()
      const contatos: ContatoHs[] = dadosContatos.results ?? []

      // O batch/read devolve 207 com "errors" quando parte dos e-mails não existe.
      // Isso é esperado — o PRD manda conferir declarado x recebido, não abortar.
      if (dadosContatos.numErrors) {
        avisos.push(
          `hubspot: ${dadosContatos.numErrors} de ${lote.length} e-mails sem contato no CRM`,
        )
      }
      if (contatos.length === 0) continue

      // 2. associações contato -> negócios -------------------------------------
      const porContato = new Map<string, string[]>()
      const rAssoc = await buscar(
        `${ctx.baseUrl}/crm/v4/associations/contacts/deals/batch/read`,
        {
          method: 'POST',
          headers: cabecalhos,
          body: JSON.stringify({ inputs: contatos.map((c) => ({ id: c.id })) }),
        },
        'hubspot associations contacts/deals',
      )
      chamadas++
      for (const r of (await rAssoc.json()).results ?? []) {
        porContato.set(
          String(r.from?.id ?? r._from?.id),
          (r.to ?? []).map((t: { toObjectId: string | number }) => String(t.toObjectId)),
        )
      }

      // 3. negócios ------------------------------------------------------------
      const idsNegocios = [...new Set([...porContato.values()].flat())]
      const negocios = new Map<string, NegocioHs>()
      for (const loteDeals of fatiar(idsNegocios, LOTE_MAXIMO)) {
        const rDeals = await buscar(
          `${ctx.baseUrl}/crm/v3/objects/deals/batch/read`,
          {
            method: 'POST',
            headers: cabecalhos,
            body: JSON.stringify({
              properties: propsNegocio,
              inputs: loteDeals.map((id) => ({ id })),
            }),
          },
          'hubspot deals/batch/read',
        )
        chamadas++
        for (const d of (await rDeals.json()).results ?? []) negocios.set(d.id, d)
      }

      // 4. montar o snapshot ---------------------------------------------------
      for (const contato of contatos) {
        const p = contato.properties ?? {}
        const alvo = porEmail.get((p.email ?? '').toLowerCase())
        if (!alvo) continue
        encontrados++

        const deals = (porContato.get(contato.id) ?? [])
          .map((id) => negocios.get(id))
          .filter((d): d is NegocioHs => Boolean(d))
          .map((d) => {
            const dp = d.properties ?? {}
            const mapa = stagesPorPipeline[String(dp.pipeline)] ?? {}
            return {
              deal_id: d.id,
              pipeline: dp.pipeline ?? null,
              time: (mapa.time as string) ?? null,
              dealstage: dp.dealstage ?? null,
              // por ID, nunca por label: "Novos"/"Novo" e "Em conexão"/"Em Conexão"
              // variam entre pipelines (validado no portal em 26/08/2026)
              em_cadencia_automatica: stagesBloqueio.has(String(dp.dealstage)),
              ganho: String(dp.dealstage) === String(mapa.ganho),
              perdido: comoBooleano(dp.hs_is_closed_lost) ?? false,
              closedate: dp.closedate ?? null,
              createdate: dp.createdate ?? null,
              amount: comoNumero(dp.amount),
              origem_de_trafego: dp.origem_de_trafego ?? null,
              tipo_de_venda: dp.tipo_de_venda ?? null,
              // produtos___servicos_contratados: TRÊS sublinhados, é do negócio (PRD 7.4)
              produtos_do_negocio: listaHubspot(dp.produtos___servicos_contratados),
              falha_sellflux: comoBooleano(dp.aux_falha_sellflux),
              msg_de_erro_da_cadencia: dp.disparo_sellflux_msg_de_erro_da_cadencia ?? null,
              tempo_ate_receber_cadencia: comoNumero(
                dp.disparo_sellflux_tempo_ate_receber_cadencia,
              ),
            }
          })

        gravacoes.push({
          tabela: 'crm_snapshot',
          pessoa_id: alvo.pessoa_id,
          hubspot_id: contato.id,
          // NULL aqui significa "nunca preencheu formulário", não "ruim" (PRD 7.5)
          classificacao_leadscore: p.classificacao_leadscore ?? null,
          leadscore: comoNumero(p.leadscore),
          produtos_ativos: listaHubspot(p.produtos__servicos_ativos),        // 2 sublinhados
          produtos_historico: listaHubspot(p.produtos_servicos_contratados), // 1 sublinhado
          econt: {
            servico_ativo: comoBooleano(p.aux_econt_servico),
            plano: p.plano_econt ?? null,
            duracao: p.duracao_plano_econt ?? null,
            inicio: p.data_inicio_plano_econt ?? null,
            fim: p.data_fim_plano_econt ?? null,
            abertura_cnpj: comoBooleano(p.auxecont_abertura_de_cnpj),
            alteracao_cnpj: comoBooleano(p.auxecont_alteracao_cnpj),
            multa_cnpj: comoBooleano(p.auxecont_multa_cnpj),
          },
          deals: {
            total: deals.length,
            // bloqueios duros do PRD 7.1 que só o negócio conhece
            em_cadencia_automatica: deals.some((d) => d.em_cadencia_automatica),
            falha_sellflux: deals.some((d) => d.falha_sellflux === true),
            perdido_recente_em: deals
              .filter((d) => d.perdido && d.closedate)
              .map((d) => d.closedate)
              .sort()
              .at(-1) ?? null,
            itens: deals,
          },
          disparo: {
            cadencia_iniciada: comoBooleano(p.disparo_sellflux_cadencia_iniciada),
            inicio_cadencia: p.disparo_sellflux_datahora_do_inicio_da_cadencia ?? null,
            conectou: comoBooleano(p.disparo_sellflux_conectou),
            datahora_conexao: p.disparo_sellflux_datahora_da_conexao ?? null,
            mensagem_cadencia: p.disparo_sellflux_mensagem_da_cadencia ?? null,
            econt_conectado: comoBooleano(p.disparo_sellflux_econt_conectado),
            perdido_na_cadencia: comoBooleano(p.reversao___perdido_na_cadencia),
            mensagens_enviadas: p.cadencia_sdr_mensagens_enviadas ?? null,
            proprietario_sellflux: p.aux_proprietario_sellflux ?? null,
            sdr_conectado: comoBooleano(p.sdr_conectado),
            motivo_perdido: p.sdr_motivo_de_perdido ?? p.nhub_motivo_de_perdido ?? null,
            origem_mais_recente: p.origem_de_trafego_origem_mais_recente ?? null,
            primeira_origem: p.cliente_no_funil ?? null,
            tipo_de_venda: p.tipo_de_venda ?? null,
          },
        })

        // identificadores que o CRM conhece e a Assiny pode não ter trazido
        const doc = normDocumento(p.assiny_documento_do_cliente)
        if (doc) {
          gravacoes.push({
            tabela: 'pessoa_identificador',
            pessoa_id: alvo.pessoa_id,
            tipo: 'documento',
            valor: doc,
            fonte: 'hubspot',
          })
        }
        for (const bruto of [p.mobilephone, p.phone]) {
          const tel = normTelefone(bruto)
          if (tel) {
            gravacoes.push({
              tabela: 'pessoa_identificador',
              pessoa_id: alvo.pessoa_id,
              tipo: 'telefone',
              valor: tel,
              fonte: 'hubspot',
            })
          }
        }
      }
    }

    return { encontrados, chamadas, gravacoes, avisos }
  },
}
