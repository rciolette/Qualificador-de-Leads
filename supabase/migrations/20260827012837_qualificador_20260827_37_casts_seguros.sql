-- Qualificador de Leads ROI · migration 37
-- Casts que não explodem.
--
-- Depois do reparo da migration 35, econt->>'fim' passou a devolver "" em vez de
-- null para quem não tem plano — e ''::date derruba a view inteira. O jsonb
-- corrompido escondia isso: como era string, todo ->> devolvia null.
-- Uma string vazia vinda de API não pode derrubar a extração de 1.293 pessoas.

create or replace function qualificador.como_data(v text)
returns date language plpgsql immutable
set search_path = pg_catalog as $fn$
begin
  return nullif(btrim(coalesce(v, '')), '')::date;
exception when others then return null;
end $fn$;

create or replace function qualificador.como_ts(v text)
returns timestamptz language plpgsql immutable
set search_path = pg_catalog as $fn$
begin
  return nullif(btrim(coalesce(v, '')), '')::timestamptz;
exception when others then return null;
end $fn$;

create or replace function qualificador.como_bool(v text)
returns boolean language plpgsql immutable
set search_path = pg_catalog as $fn$
begin
  return nullif(btrim(coalesce(v, '')), '')::boolean;
exception when others then return null;
end $fn$;

comment on function qualificador.como_data(text) is
  'Cast tolerante. API devolve "" onde não há valor, e ''''::date derruba a consulta inteira.';

revoke execute on function qualificador.como_data(text), qualificador.como_ts(text),
                          qualificador.como_bool(text) from public, anon;
grant execute on function qualificador.como_data(text), qualificador.como_ts(text),
                          qualificador.como_bool(text) to authenticated, service_role;

create or replace view qualificador.v_pessoa_completa
with (security_invoker = true) as
select
  p.id as pessoa_id, p.nome, p.email, p.telefone_e164, p.documento, p.hubspot_id,
  a.primeira_compra, a.ultima_compra, a.valor_total, a.compras,
  a.projetos, a.produtos, a.ofertas, a.utm_sources, a.organizacoes,
  case when a.primeira_compra is not null
       then (current_date - a.primeira_compra::date) end as dias_desde_primeira_compra,
  case when a.ultima_compra is not null
       then (current_date - a.ultima_compra::date) end   as dias_desde_ultima_compra,

  (mc.pessoa_id is not null)                as tem_memberclass,
  mc.aulas_concluidas,
  mc.ultimo_acesso                          as mc_ultimo_acesso,
  case when mc.ultimo_acesso is not null
       then (current_date - mc.ultimo_acesso) end as mc_dias_sem_acessar,
  mc.cadastro                               as mc_cadastro,
  mc.niveis                                 as mc_entregas,
  coalesce(qualificador.como_bool(mc.dados->>'is_paid'), false) as mc_pagante,

  (mk.pessoa_id is not null)                as tem_memberkit,
  mk.niveis                                 as mk_niveis,
  mk.ultimo_acesso                          as mk_ultimo_acesso,
  case when mk.ultimo_acesso is not null
       then (current_date - mk.ultimo_acesso) end as mk_dias_sem_acessar,
  coalesce(qualificador.como_bool(mk.dados->>'tem_produto_pago'), false) as mk_produto_pago,
  coalesce(mk.dados->'tier_lead',    '[]'::jsonb) as mk_tier_lead,
  coalesce(mk.dados->'produto_pago', '[]'::jsonb) as mk_produtos_pagos,
  coalesce(qualificador.como_bool(mk.dados->>'bloqueado'), false) as mk_bloqueado,

  (c.pessoa_id is not null)                 as tem_crm,
  nullif(c.classificacao_leadscore, '')     as classificacao_leadscore,
  c.leadscore,
  coalesce(c.produtos_ativos,    '{}')      as produtos_ativos,
  coalesce(c.produtos_historico, '{}')      as produtos_historico,
  c.econt, c.deals, c.disparo, c.sync_em,
  coalesce(qualificador.como_bool(c.econt->>'servico_ativo'), false)  as econt_ativo,
  coalesce(qualificador.como_bool(c.econt->>'abertura_cnpj'), false)  as econt_abertura_cnpj,
  qualificador.como_data(c.econt->>'fim')                             as econt_fim_plano,
  coalesce(qualificador.como_bool(c.deals->>'em_cadencia_automatica'), false) as em_cadencia_automatica,
  coalesce(qualificador.como_bool(c.deals->>'falha_sellflux'), false)         as falha_sellflux,
  qualificador.como_ts(c.deals->>'perdido_recente_em')                       as perdido_em,
  coalesce(qualificador.como_bool(c.disparo->>'perdido_na_cadencia'), false)  as perdido_na_cadencia,
  qualificador.como_bool(c.disparo->>'conectou')                             as conectou,
  coalesce(qualificador.como_bool(c.disparo->>'cadencia_iniciada'), false)    as cadencia_iniciada,
  nullif(c.disparo->>'mensagens_enviadas', '')                               as toques,
  coalesce((select array_agg(distinct pr)
            from jsonb_array_elements(qualificador.itens_de(c.deals)) d,
                 jsonb_array_elements_text(qualificador.itens_de(d->'produtos_do_negocio')) pr
           ), '{}') as produtos_do_negocio,
  coalesce((select array_agg(distinct d->>'time')
            from jsonb_array_elements(qualificador.itens_de(c.deals)) d
            where nullif(d->>'time','') is not null), '{}') as times_com_deal,

  (s.pessoa_id is not null)                 as tem_sellflux,
  coalesce(s.unsub_whats, false)            as unsub_whats,
  coalesce(s.tags, '{}')                    as tags_sellflux,
  s.ticket_aberto, s.preferential_whats_id,

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
  select array_agg(distinct pa.evento)                                     as eventos,
         array_agg(distinct pa.evento) filter (where pa.presente)          as presente_em,
         array_agg(distinct pa.evento) filter (where pa.presente is false) as ausente_em
  from qualificador.participacao pa where pa.pessoa_id = p.id
) ev on true;

grant select on qualificador.v_pessoa_completa to authenticated, service_role;
