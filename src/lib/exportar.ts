import * as XLSX from 'xlsx'
import { exigirSupabase } from './supabase'

/**
 * O arquivo é regerado do banco a cada pedido — nunca guardamos o xlsx.
 * O blueprint diz que a saída é sempre um arquivo entregue a quem dispara;
 * guardar o arquivo criaria uma segunda verdade que envelhece sozinha.
 */
export async function baixarLista(listaId: string, nomeBase: string) {
  const sb = exigirSupabase()

  const { data: lista, error: e1 } = await sb
    .from('lista')
    .select('id, nome, gerada_em, total, por_time, funil, iniciativa_id')
    .eq('id', listaId).single()
  if (e1) throw e1

  const { data: iniciativa } = await sb
    .from('iniciativa').select('*').eq('id', lista.iniciativa_id).single()

  const { data: itens, error: e2 } = await sb
    .from('lista_item')
    .select('pessoa_id, time, score, faixa, motivo, sobreposicao, resultado')
    .eq('lista_id', listaId).order('score', { ascending: false })
  if (e2) throw e2

  // os dados da pessoa vêm da view, em lotes: o `in` do PostgREST tem limite de URL
  const ids = (itens ?? []).map((i) => i.pessoa_id)
  const pessoas = new Map<string, Record<string, unknown>>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb
      .from('v_pessoa_completa')
      .select('pessoa_id, nome, email, telefone_e164, documento, classificacao_leadscore, ' +
              'compras, valor_total, projetos, produtos_ativos, ultima_compra, ' +
              'tem_memberclass, tem_memberkit, aulas_concluidas, mc_dias_sem_acessar')
      .in('pessoa_id', ids.slice(i, i + 200))
    for (const p of (data ?? []) as unknown as Record<string, unknown>[]) {
      pessoas.set(p.pessoa_id as string, p)
    }
  }

  const linhas = (itens ?? []).map((it) => {
    const p = pessoas.get(it.pessoa_id) ?? {}
    return {
      'Nome': p.nome ?? '',
      'E-mail': p.email ?? '',
      'Telefone': p.telefone_e164 ?? '',
      'CPF/CNPJ': p.documento ?? '',
      'Time': it.time ?? '',
      'Score': it.score,
      'Faixa': it.faixa,
      'Faixa Leadscore': p.classificacao_leadscore ?? '',
      'Compras': p.compras ?? 0,
      'Valor acumulado': p.valor_total ?? 0,
      'Última compra': p.ultima_compra ? String(p.ultima_compra).slice(0, 10) : '',
      'Projetos': Array.isArray(p.projetos) ? (p.projetos as string[]).join(' · ') : '',
      'Produtos ativos': Array.isArray(p.produtos_ativos)
        ? (p.produtos_ativos as string[]).join(' · ') : '',
      'Tem MemberClass': p.tem_memberclass ? 'sim' : 'não',
      'Tem MemberKit': p.tem_memberkit ? 'sim' : 'não',
      'Aulas': p.aulas_concluidas ?? '',
      'Dias sem acessar': p.mc_dias_sem_acessar ?? '',
      // a coluna que o blueprint exige: em quantas outras iniciativas abertas a pessoa caiu
      'Sobreposição': Array.isArray(it.sobreposicao) ? it.sobreposicao.length : 0,
      'Resultado': it.resultado,
    }
  })

  const wb = XLSX.utils.book_new()

  // Resumo primeiro: quem abre o arquivo precisa saber de onde ele veio
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    { Campo: 'Iniciativa', Valor: iniciativa?.nome ?? '' },
    { Campo: 'Objetivo', Valor: iniciativa?.objetivo ?? '' },
    { Campo: 'Tipo', Valor: iniciativa?.tipo ?? '' },
    { Campo: 'Times', Valor: (iniciativa?.times ?? []).join(' · ') },
    { Campo: 'Gerada em', Valor: new Date(lista.gerada_em).toLocaleString('pt-BR') },
    { Campo: 'Total', Valor: lista.total },
    ...Object.entries(lista.por_time ?? {}).map(([t, n]) => ({ Campo: `Time ${t}`, Valor: n })),
    { Campo: 'Anti-fadiga (dias)', Valor: iniciativa?.anti_fadiga_dias ?? '' },
    { Campo: 'Excluir perdido há (dias)', Valor: iniciativa?.excluir_perdido_dias ?? '' },
  ]), 'Resumo')

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'Lista final')

  // O funil congelado: explica meses depois por que alguém não está na lista
  const funil = (lista.funil ?? []) as Record<string, unknown>[]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    funil.map((f) => ({
      'Ordem': f.ordem,
      'Etapa': f.rotulo,
      'Bloqueio duro': f.bloqueio_duro ? 'sim' : 'não',
      'Saíram aqui': f.saem_aqui,
      'Restaram': f.restam,
    })),
  ), 'Funil de exclusão')

  const distrib = new Map<string, number>()
  for (const l of linhas) distrib.set(String(l.Faixa), (distrib.get(String(l.Faixa)) ?? 0) + 1)
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    [...distrib.entries()].sort().map(([faixa, n]) => ({
      'Faixa': faixa, 'Pessoas': n,
      'Percentual': linhas.length ? `${((100 * n) / linhas.length).toFixed(1)}%` : '0%',
    })),
  ), 'Distribuições')

  const data = new Date(lista.gerada_em).toISOString().slice(0, 10)
  const arquivo = `${nomeBase.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${data}.xlsx`
  XLSX.writeFile(wb, arquivo)
  return arquivo
}
