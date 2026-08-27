-- Qualificador de Leads ROI · Fase 4 · migration 27
-- Uma linha por pessoa com tudo que os filtros precisam.
-- Existe para o motor não repetir oito joins em cada regra -- e para que
-- "tem_memberclass = false" signifique de verdade "não tem conta", e não
-- "a fonte nunca sincronizou".

create or replace view qualificador.v_pessoa_completa
with (security_invoker = true) as
select
  p.id as pessoa_id, p.nome, p.email, p.telefone_e164, p.documento, p.hubspot_id,

  -- ---------------------------------------------------------------- Assiny
  a.primeira_compra, a.ultima_compra, a.valor_total, a.compras,
  a.projetos, a.produtos, a.ofertas, a.utm_sources, a.organizacoes,
  case when a.primeira_compra is not null
       then (current_date - a.primeira_compra::date) end as dias_desde_primeira_compra,
  case when a.ultima_compra is not null
       then (current_date - a.ultima_compra::date) end   as dias_desde_ultima_compra,

  -- ------------------------------------------------------------ MemberClass
  (mc.pessoa_id is not null)                as tem_memberclass,
  mc.aulas_concluidas,
  mc.ultimo_acesso                          as mc_ultimo_acesso,
  case when mc.ultimo_acesso is not null
       then (current_date - mc.ultimo_acesso) end as mc_dias_sem_acessar,
  mc.cadastro                               as mc_cadastro,
  mc.niveis                                 as mc_entregas,
  coalesce((mc.dados->>'is_paid')::boolean, false) as mc_pagante,

  -- -------------------------------------------------------------- MemberKit
  (mk.pessoa_id is not null)                as tem_memberkit,
  mk.niveis                                 as mk_niveis,
  mk.ultimo_acesso                          as mk_ultimo_acesso,
  case when mk.ultimo_acesso is not null
       then (current_date - mk.ultimo_acesso) end as mk_dias_sem_acessar,
  coalesce((mk.dados->>'tem_produto_pago')::boolean, false) as mk_produto_pago,
  coalesce(mk.dados->'tier_lead',    '[]'::jsonb) as mk_tier_lead,
  coalesce(mk.dados->'produto_pago', '[]'::jsonb) as mk_produtos_pagos,
  coalesce((mk.dados->>'bloqueado')::boolean, false) as mk_bloqueado,

  -- ---------------------------------------------------------------- HubSpot
  (c.pessoa_id is not null)                 as tem_crm,
  c.classificacao_leadscore, c.leadscore,
  coalesce(c.produtos_ativos,    '{}')      as produtos_ativos,
  coalesce(c.produtos_historico, '{}')      as produtos_historico,
  c.econt, c.deals, c.disparo, c.sync_em,
  coalesce((c.econt->>'servico_ativo')::boolean, false)  as econt_ativo,
  coalesce((c.econt->>'abertura_cnpj')::boolean, false)  as econt_abertura_cnpj,
  (c.econt->>'fim')::date                                as econt_fim_plano,
  coalesce((c.deals->>'em_cadencia_automatica')::boolean, false) as em_cadencia_automatica,
  coalesce((c.deals->>'falha_sellflux')::boolean, false)         as falha_sellflux,
  (c.deals->>'perdido_recente_em')::timestamptz                  as perdido_em,
  coalesce((c.disparo->>'perdido_na_cadencia')::boolean, false)  as perdido_na_cadencia,
  (c.disparo->>'conectou')::boolean                              as conectou,
  coalesce((c.disparo->>'cadencia_iniciada')::boolean, false)    as cadencia_iniciada,
  c.disparo->>'mensagens_enviadas'                               as toques,
  coalesce((select array_agg(distinct pr)
            from jsonb_array_elements(coalesce(c.deals->'itens','[]'::jsonb)) d,
                 jsonb_array_elements_text(coalesce(d->'produtos_do_negocio','[]'::jsonb)) pr
           ), '{}') as produtos_do_negocio,
  coalesce((select array_agg(distinct d->>'time')
            from jsonb_array_elements(coalesce(c.deals->'itens','[]'::jsonb)) d
            where d->>'time' is not null), '{}') as times_com_deal,

  -- --------------------------------------------------------------- Sellflux
  (s.pessoa_id is not null)                 as tem_sellflux,
  coalesce(s.unsub_whats, false)            as unsub_whats,
  coalesce(s.tags, '{}')                    as tags_sellflux,
  s.ticket_aberto, s.preferential_whats_id,

  -- ---------------------------------------------------------------- eventos
  coalesce(ev.eventos, '{}')                as eventos,
  coalesce(ev.presente_em, '{}')            as presente_em,
  coalesce(ev.ausente_em, '{}')             as ausente_em

from qualificador.pessoa p
left join lateral (
  select min(t.criado_em) as primeira_compra, max(t.criado_em) as ultima_compra,
         sum(t.valor) as valor_total, count(*) as compras,
         array_agg(distinct pr.nome_assiny)        filter (where pr.nome_assiny is not null)        as projetos,
         array_agg(distinct pr.organizacao_assiny) filter (where pr.organizacao_assiny is not null) as organizacoes,
         array_agg(distinct t.produto)             filter (where t.produto is not null)             as produtos,
         array_agg(distinct t.oferta)              filter (where t.oferta is not null)              as ofertas,
         array_agg(distinct t.utm_source)          filter (where t.utm_source is not null)          as utm_sources
  from qualificador.transacao t
  left join qualificador.projeto pr on pr.id = t.projeto_id
  where t.pessoa_id = p.id
) a on true
left join qualificador.engajamento  mc on mc.pessoa_id = p.id and mc.plataforma = 'memberclass'
left join qualificador.engajamento  mk on mk.pessoa_id = p.id and mk.plataforma = 'memberkit'
left join qualificador.crm_snapshot c  on c.pessoa_id  = p.id
left join qualificador.saude_disparo s on s.pessoa_id  = p.id
left join lateral (
  select array_agg(distinct pa.evento)                                    as eventos,
         array_agg(distinct pa.evento) filter (where pa.presente)         as presente_em,
         array_agg(distinct pa.evento) filter (where pa.presente is false) as ausente_em
  from qualificador.participacao pa where pa.pessoa_id = p.id
) ev on true;

comment on view qualificador.v_pessoa_completa is
  'Uma linha por pessoa com Assiny, MemberClass, MemberKit, HubSpot, Sellflux e eventos.
   Os campos tem_* distinguem "não tem" de "a fonte nunca sincronizou" -- sem isso,
   um filtro de engajamento descartaria em silêncio metade da base por falta de sync.';

grant select on qualificador.v_pessoa_completa to authenticated, service_role;
