-- Qualificador de Leads ROI · Fase 4 · migration 28
-- Os oito eixos de score (blueprint seção 04).
--
-- Cada eixo devolve 0–100 de forma independente. O peso da iniciativa é aplicado
-- só depois, e a soma é normalizada — é isso que impede um score global e faz
-- peso 0 desligar o eixo de verdade, em vez de apenas reduzi-lo.
--
-- Regra de conduta do blueprint que vale para todos: ausência de dado não é sinal
-- negativo. Onde não sabemos, o eixo devolve um valor neutro, nunca zero.

create or replace view qualificador.v_eixos_score
with (security_invoker = true) as
with faixa_valor as (
  -- percentil do valor acumulado: comparar com a própria base é mais honesto
  -- que uma escala absoluta que envelhece a cada mudança de preço
  select coalesce(percentile_cont(0.95) within group (order by valor_total), 1) as p95
  from qualificador.v_pessoa_completa where valor_total > 0
)
select
  v.pessoa_id,

  -- relação comercial: ganho > aberto > perdido > sem negócio
  case
    when v.deals is null                                     then 30   -- neutro: CRM não sincronizado
    when exists (select 1 from jsonb_array_elements(coalesce(v.deals->'itens','[]'::jsonb)) d
                 where (d->>'ganho')::boolean)               then 100
    when exists (select 1 from jsonb_array_elements(coalesce(v.deals->'itens','[]'::jsonb)) d
                 where not coalesce((d->>'perdido')::boolean, false))  then 75
    when jsonb_array_length(coalesce(v.deals->'itens','[]'::jsonb)) > 0 then 50
    else 25
  end::numeric as relacao_comercial,

  -- recência: 0 dias = 100, um ano = 0
  case when v.dias_desde_ultima_compra is null then 30
       else greatest(0, 100 - (v.dias_desde_ultima_compra / 3.65)) end::numeric as recencia_compra,

  -- valor histórico contra o percentil 95 da base
  case when coalesce(v.valor_total, 0) = 0 then 0
       else least(100, 100 * v.valor_total / (select p95 from faixa_valor)) end::numeric as valor_historico,

  -- engajamento: metade aulas, metade recência de acesso
  case
    when not v.tem_memberclass and not v.tem_memberkit then 30  -- neutro: sem conta em nenhuma
    else least(100,
         coalesce(least(60, coalesce(v.aulas_concluidas, 0) * 6), 0)
       + case when v.mc_dias_sem_acessar is null then 0
              else greatest(0, 40 - v.mc_dias_sem_acessar) end)
  end::numeric as engajamento_conteudo,

  -- nível MemberKit: produto pago é prova de operação em andamento, não engajamento
  case
    when not v.tem_memberkit                                  then 20
    when v.mk_produto_pago                                    then 100
    when v.mk_tier_lead @> '["[LEAD] TIER A"]'::jsonb         then 80
    when v.mk_tier_lead @> '["[LEAD] TIER B"]'::jsonb         then 65
    when v.mk_tier_lead @> '["[LEAD] TIER C"]'::jsonb         then 50
    when v.mk_tier_lead @> '["[LEAD] TIER D"]'::jsonb         then 40
    when v.mk_tier_lead @> '["[LEAD] TIER E"]'::jsonb         then 30
    else 35
  end::numeric as nivel_memberkit,

  -- posse: o cruzamento card × ativos (blueprint seção 02)
  case
    when not v.tem_crm then 30
    when array_length(v.produtos_ativos, 1) > 0
     and v.produtos_ativos && v.produtos_do_negocio              then 100  -- expansão
    when array_length(v.produtos_do_negocio, 1) > 0
     and not (v.produtos_do_negocio && v.produtos_ativos)        then 75   -- renovação
    when array_length(v.produtos_ativos, 1) > 0
     and coalesce(array_length(v.produtos_do_negocio, 1), 0) = 0 then 50   -- furo
    else 25
  end::numeric as posse_produto,

  -- saúde de disparo: nunca disparado vale mais que disparado sem resposta
  case
    when not v.tem_crm and not v.tem_sellflux then 60   -- neutro
    when v.unsub_whats                        then 0
    when v.conectou is true                   then 100
    when not v.cadencia_iniciada              then 80   -- base intocada
    when v.conectou is false                  then 20
    else 60
  end::numeric as saude_disparo,

  -- leadscore: sem faixa é NEUTRO, nunca penalidade (blueprint seção 04)
  case v.classificacao_leadscore
    when 'Faixa A' then 100 when 'Faixa B' then 80  when 'Faixa C' then 60
    when 'Faixa D' then 40  when 'Faixa E' then 20  else 50
  end::numeric as leadscore

from qualificador.v_pessoa_completa v;

comment on view qualificador.v_eixos_score is
  'Oito eixos 0–100, independentes do peso. Onde a fonte não sincronizou, o eixo
   devolve valor neutro — nunca zero. Zerar por ausência de dado transformaria
   "não sabemos" em "é ruim", que é o erro que o blueprint manda evitar.';

grant select on qualificador.v_eixos_score to authenticated, service_role;

-- Aplica os pesos da iniciativa e normaliza para 0–100.
create or replace function qualificador.aplicar_pesos(p_eixos jsonb, p_pesos jsonb)
returns numeric language sql immutable
set search_path = pg_catalog as $fn$
  with e(eixo, valor) as (select key, value::numeric from jsonb_each_text(p_eixos)),
       p(eixo, peso)  as (select key, greatest(0, least(10, value::numeric))
                          from jsonb_each_text(p_pesos))
  select case when coalesce(sum(p.peso), 0) = 0 then 0
              else round(sum(e.valor * p.peso) / sum(p.peso), 1) end
  from e join p using (eixo)
  where p.peso > 0   -- peso 0 não entra na soma NEM no divisor: desliga o eixo
$fn$;

comment on function qualificador.aplicar_pesos(jsonb, jsonb) is
  'Peso 0 sai da soma e do divisor. Se ficasse no divisor, desligar um eixo
   rebaixaria todo mundo em vez de tornar o eixo irrelevante.';

create or replace function qualificador.faixa_de(p_score numeric)
returns text language sql immutable
set search_path = pg_catalog as $fn$
  select case when p_score >= 80 then 'A' when p_score >= 60 then 'B'
              when p_score >= 40 then 'C' when p_score >= 20 then 'D' else 'E' end
$fn$;

revoke execute on function qualificador.aplicar_pesos(jsonb, jsonb) from public, anon;
revoke execute on function qualificador.faixa_de(numeric) from public, anon;
grant execute on function qualificador.aplicar_pesos(jsonb, jsonb), qualificador.faixa_de(numeric)
  to authenticated, service_role;
