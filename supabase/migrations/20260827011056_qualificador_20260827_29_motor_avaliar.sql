-- Qualificador de Leads ROI · Fase 4 · migration 29
-- O motor. Para cada pessoa devolve a PRIMEIRA etapa que a excluiu, ou NULL se passou.
--
-- Devolver a etapa de saída, em vez de só a lista final, é o que torna o funil
-- clicável: o funil é um group by desta função, e "ver quem saiu aqui" é um where.
-- Sem isso, cada linha do funil exigiria recalcular a regra inteira de novo.

create or replace function qualificador.txt_array(p jsonb)
returns text[] language sql immutable
set search_path = pg_catalog as $fn$
  select case when p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) = 0
              then null else array(select jsonb_array_elements_text(p)) end
$fn$;

create or replace function qualificador.avaliar(p_config jsonb)
returns table (
  pessoa_id uuid, etapa text, ordem int, rotulo text,
  score numeric, faixa text, eixos jsonb
)
language sql stable
set search_path = qualificador, pg_catalog
as $fn$
with cfg as (
  select
    coalesce(p_config->'filtros', '{}'::jsonb)                    as f,
    coalesce(p_config->'pesos',   '{}'::jsonb)                    as pesos,
    coalesce((p_config->>'anti_fadiga_dias')::int, 7)             as fadiga_dias,
    coalesce((p_config->>'excluir_perdido_dias')::int, 15)        as perdido_dias,
    qualificador.txt_array(p_config->'times')                     as times,
    (p_config->>'iniciativa_id')::uuid                            as iniciativa_id
),
base as (
  select v.*, cfg.*,
    jsonb_build_object(
      'relacao_comercial',    e.relacao_comercial,
      'recencia_compra',      e.recencia_compra,
      'valor_historico',      e.valor_historico,
      'engajamento_conteudo', e.engajamento_conteudo,
      'nivel_memberkit',      e.nivel_memberkit,
      'posse_produto',        e.posse_produto,
      'saude_disparo',        e.saude_disparo,
      'leadscore',            e.leadscore
    ) as eixos_json
  from qualificador.v_pessoa_completa v
  join qualificador.v_eixos_score e using (pessoa_id)
  cross join cfg
),
marcado as (
  select b.*,
  -- ------------------------------------------------- BLOQUEIO DURO (1 a 7)
  -- Ordem fixa, não desliga, não reordena. Blueprint seção 04.
  case
    when b.telefone_e164 is null                          then 1
    when b.unsub_whats                                    then 2
    when b.em_cadencia_automatica                         then 3
    when b.falha_sellflux                                 then 4
    when b.perdido_na_cadencia                            then 5
    when b.perdido_em is not null
     and b.perdido_em > now() - make_interval(days => b.perdido_dias) then 6
    when b.cadencia_iniciada and b.conectou is false      then 7

  -- ------------------------------------------------------- A · COMPRA (10)
    when coalesce((b.f#>>'{assiny,ativo}')::boolean, false) and (
         (qualificador.txt_array(b.f#>'{assiny,organizacao}') is not null
          and not (b.organizacoes && qualificador.txt_array(b.f#>'{assiny,organizacao}')))
      or (qualificador.txt_array(b.f#>'{assiny,projeto}') is not null
          and not (b.projetos && qualificador.txt_array(b.f#>'{assiny,projeto}')))
      or (qualificador.txt_array(b.f#>'{assiny,produto}') is not null
          and not (b.produtos && qualificador.txt_array(b.f#>'{assiny,produto}')))
      or (qualificador.txt_array(b.f#>'{assiny,oferta}') is not null
          and not (b.ofertas && qualificador.txt_array(b.f#>'{assiny,oferta}')))
      or (qualificador.txt_array(b.f#>'{assiny,utm_source}') is not null
          and not (b.utm_sources && qualificador.txt_array(b.f#>'{assiny,utm_source}')))
      or (nullif(b.f#>>'{assiny,periodo,de}','')  is not null
          and (b.ultima_compra is null or b.ultima_compra < (b.f#>>'{assiny,periodo,de}')::date))
      or (nullif(b.f#>>'{assiny,periodo,ate}','') is not null
          and (b.ultima_compra is null or b.ultima_compra > ((b.f#>>'{assiny,periodo,ate}')::date + 1)))
      or (nullif(b.f#>>'{assiny,valor_acumulado,min}','') is not null
          and coalesce(b.valor_total,0) < (b.f#>>'{assiny,valor_acumulado,min}')::numeric)
      or (nullif(b.f#>>'{assiny,valor_acumulado,max}','') is not null
          and coalesce(b.valor_total,0) > (b.f#>>'{assiny,valor_acumulado,max}')::numeric)
      or (nullif(b.f#>>'{assiny,compras,min}','') is not null
          and coalesce(b.compras,0) < (b.f#>>'{assiny,compras,min}')::int)
      or (nullif(b.f#>>'{assiny,compras,max}','') is not null
          and coalesce(b.compras,0) > (b.f#>>'{assiny,compras,max}')::int)
      or (b.f#>>'{assiny,tipo_compra}' = 'primeira' and coalesce(b.compras,0) <> 1)
      or (b.f#>>'{assiny,tipo_compra}' = 'recompra' and coalesce(b.compras,0) < 2)
      or (nullif(b.f#>>'{assiny,dias_desde_primeira_compra,min}','') is not null
          and coalesce(b.dias_desde_primeira_compra, -1) < (b.f#>>'{assiny,dias_desde_primeira_compra,min}')::int)
      or (nullif(b.f#>>'{assiny,dias_desde_primeira_compra,max}','') is not null
          and coalesce(b.dias_desde_primeira_compra, 999999) > (b.f#>>'{assiny,dias_desde_primeira_compra,max}')::int)
      or (nullif(b.f#>>'{assiny,dias_desde_ultima_compra,max}','') is not null
          and coalesce(b.dias_desde_ultima_compra, 999999) > (b.f#>>'{assiny,dias_desde_ultima_compra,max}')::int)
    ) then 10

  -- -------------------------------------------- B · INICIAMAZON (11)
    when coalesce((b.f#>>'{memberclass,ativo}')::boolean, false) and (
         (b.f#>>'{memberclass,tem_conta}' = 'sim' and not b.tem_memberclass)
      or (b.f#>>'{memberclass,tem_conta}' = 'nao' and b.tem_memberclass)
      or (nullif(b.f#>>'{memberclass,aulas,min}','') is not null
          and coalesce(b.aulas_concluidas,0) < (b.f#>>'{memberclass,aulas,min}')::int)
      or (nullif(b.f#>>'{memberclass,aulas,max}','') is not null
          and coalesce(b.aulas_concluidas,0) > (b.f#>>'{memberclass,aulas,max}')::int)
      or (nullif(b.f#>>'{memberclass,dias_sem_acessar,min}','') is not null
          and coalesce(b.mc_dias_sem_acessar, -1) < (b.f#>>'{memberclass,dias_sem_acessar,min}')::int)
      or (nullif(b.f#>>'{memberclass,dias_sem_acessar,max}','') is not null
          and coalesce(b.mc_dias_sem_acessar, 999999) > (b.f#>>'{memberclass,dias_sem_acessar,max}')::int)
      or (b.f#>>'{memberclass,pagante}' = 'true'  and not b.mc_pagante)
      or (b.f#>>'{memberclass,pagante}' = 'false' and b.mc_pagante)
    ) then 11

  -- ------------------------------------------------ C · MENTORIA (12)
    when coalesce((b.f#>>'{memberkit,ativo}')::boolean, false) and (
         (b.f#>>'{memberkit,tem_conta}' = 'sim' and not b.tem_memberkit)
      or (b.f#>>'{memberkit,tem_conta}' = 'nao' and b.tem_memberkit)
      or (qualificador.txt_array(b.f#>'{memberkit,niveis}') is not null
          and not (coalesce(b.mk_niveis,'{}') && qualificador.txt_array(b.f#>'{memberkit,niveis}')))
      or (b.f#>>'{memberkit,tipo_nivel}' = 'pago' and not b.mk_produto_pago)
      or (b.f#>>'{memberkit,tipo_nivel}' = 'lead' and b.mk_produto_pago)
      or (b.f#>>'{memberkit,bloqueado}' = 'false' and b.mk_bloqueado)
      or (nullif(b.f#>>'{memberkit,dias_sem_acessar,max}','') is not null
          and coalesce(b.mk_dias_sem_acessar, 999999) > (b.f#>>'{memberkit,dias_sem_acessar,max}')::int)
    ) then 12

  -- -------------------------------------------------- D · PERFIL (13)
    when coalesce((b.f#>>'{perfil,ativo}')::boolean, false) and (
      -- Três estados, não dois. incluir_sem_leadscore mantém quem tem faixa nula.
         (b.f#>>'{perfil,leadscore_modo}' = 'exigir_faixa'
          and (b.classificacao_leadscore is null
               or (qualificador.txt_array(b.f#>'{perfil,faixas}') is not null
                   and not (b.classificacao_leadscore = any (qualificador.txt_array(b.f#>'{perfil,faixas}'))))))
      or (b.f#>>'{perfil,leadscore_modo}' = 'incluir_sem_leadscore'
          and b.classificacao_leadscore is not null
          and qualificador.txt_array(b.f#>'{perfil,faixas}') is not null
          and not (b.classificacao_leadscore = any (qualificador.txt_array(b.f#>'{perfil,faixas}'))))
      or (nullif(b.f#>>'{perfil,leadscore_num,min}','') is not null
          and coalesce(b.leadscore, -1) < (b.f#>>'{perfil,leadscore_num,min}')::numeric)
    ) then 13

  -- ------------------------------------------------ E · PRODUTOS (14)
    when coalesce((b.f#>>'{produtos,ativo}')::boolean, false) and (
         (qualificador.txt_array(b.f#>'{produtos,ativos_incluir}') is not null
          and not (b.produtos_ativos && qualificador.txt_array(b.f#>'{produtos,ativos_incluir}')))
      or (qualificador.txt_array(b.f#>'{produtos,ativos_excluir}') is not null
          and b.produtos_ativos && qualificador.txt_array(b.f#>'{produtos,ativos_excluir}'))
      or (qualificador.txt_array(b.f#>'{produtos,historico_excluir}') is not null
          and b.produtos_historico && qualificador.txt_array(b.f#>'{produtos,historico_excluir}'))
      -- E-cont é atributo, não condenação: o default é ignorar
      or (b.f#>>'{produtos,econt_modo}' = 'excluir' and b.econt_ativo)
      or (b.f#>>'{produtos,econt_modo}' = 'incluir' and not b.econt_ativo)
      or (b.f#>>'{produtos,abertura_cnpj}' = 'false' and b.econt_abertura_cnpj)
      or (nullif(b.f#>>'{produtos,fim_plano_proximos_dias}','') is not null
          and (b.econt_fim_plano is null
               or b.econt_fim_plano > current_date + (b.f#>>'{produtos,fim_plano_proximos_dias}')::int
               or b.econt_fim_plano < current_date))
      or (b.f#>>'{produtos,cruzamento}' = 'expansao'
          and not (array_length(b.produtos_ativos,1) > 0 and b.produtos_ativos && b.produtos_do_negocio))
      or (b.f#>>'{produtos,cruzamento}' = 'renovacao'
          and not (array_length(b.produtos_do_negocio,1) > 0 and not (b.produtos_do_negocio && b.produtos_ativos)))
      or (b.f#>>'{produtos,cruzamento}' = 'furo'
          and not (array_length(b.produtos_ativos,1) > 0 and coalesce(array_length(b.produtos_do_negocio,1),0) = 0))
    ) then 14

  -- ---------------------------------------- F · ESTADO COMERCIAL (15)
    when coalesce((b.f#>>'{estado_comercial,ativo}')::boolean, false) and (
         (qualificador.txt_array(b.f#>'{estado_comercial,times}') is not null
          and not (b.times_com_deal && qualificador.txt_array(b.f#>'{estado_comercial,times}')))
      or (b.f#>>'{estado_comercial,situacao}' = 'ganho'
          and not exists (select 1 from jsonb_array_elements(coalesce(b.deals->'itens','[]'::jsonb)) d
                          where (d->>'ganho')::boolean))
      or (b.f#>>'{estado_comercial,situacao}' = 'perdido'
          and not exists (select 1 from jsonb_array_elements(coalesce(b.deals->'itens','[]'::jsonb)) d
                          where (d->>'perdido')::boolean))
      or (b.f#>>'{estado_comercial,situacao}' = 'sem_negocio'
          and jsonb_array_length(coalesce(b.deals->'itens','[]'::jsonb)) > 0)
      or (b.f#>>'{estado_comercial,situacao}' = 'aberto'
          and not exists (select 1 from jsonb_array_elements(coalesce(b.deals->'itens','[]'::jsonb)) d
                          where not coalesce((d->>'ganho')::boolean,false)
                            and not coalesce((d->>'perdido')::boolean,false)))
    ) then 15

  -- ------------------------------------------ G · SAÚDE DE DISPARO (16)
    when coalesce((b.f#>>'{saude_disparo,ativo}')::boolean, false) and (
         (b.f#>>'{saude_disparo,conectou}' = 'sim' and b.conectou is distinct from true)
      or (b.f#>>'{saude_disparo,conectou}' = 'nao' and b.conectou is not false)
      or (b.f#>>'{saude_disparo,ticket_aberto_excluir}' = 'true' and b.ticket_aberto is true)
      or (qualificador.txt_array(b.f#>'{saude_disparo,tags_excluir}') is not null
          and b.tags_sellflux && qualificador.txt_array(b.f#>'{saude_disparo,tags_excluir}'))
      or (qualificador.txt_array(b.f#>'{saude_disparo,tags_incluir}') is not null
          and not (b.tags_sellflux && qualificador.txt_array(b.f#>'{saude_disparo,tags_incluir}')))
    ) then 16

  -- --------------------------------------------------- H · EVENTO (17)
    when coalesce((b.f#>>'{evento,ativo}')::boolean, false) and (
         (nullif(b.f#>>'{evento,referencia}','') is not null
          and not (b.eventos @> array[b.f#>>'{evento,referencia}']))
      or (b.f#>>'{evento,presenca}' = 'compareceu'
          and not (b.presente_em @> array[coalesce(b.f#>>'{evento,referencia}','')]
                   or (nullif(b.f#>>'{evento,referencia}','') is null and array_length(b.presente_em,1) > 0)))
      or (b.f#>>'{evento,presenca}' = 'ausente'
          and not (b.ausente_em @> array[coalesce(b.f#>>'{evento,referencia}','')]
                   or (nullif(b.f#>>'{evento,referencia}','') is null and array_length(b.ausente_em,1) > 0)))
    ) then 17

  -- ------------------------------------------------ ANTI-FADIGA (18)
  -- A regra é sobre time + número, não sobre a pessoa. Times diferentes podem
  -- abordar a mesma pessoa na mesma semana; o que se protege é o aparelho.
    when exists (
      select 1 from qualificador.disparo_registro dr
      where dr.pessoa_id = b.pessoa_id
        and dr.data_do_disparo > current_date - b.fadiga_dias
        and (b.times is null or dr.time::text = any (b.times))
        and (b.preferential_whats_id is null or dr.numero_whats = b.preferential_whats_id)
    ) then 18
    else null
  end as ordem_saida
  from base b
)
select
  m.pessoa_id,
  case m.ordem_saida
    when 1 then 'sem_telefone'        when 2 then 'optout_whats'
    when 3 then 'novos_em_conexao'    when 4 then 'falha_de_entrega'
    when 5 then 'perdido_na_cadencia' when 6 then 'perdido_recente'
    when 7 then 'disparo_sem_conexao' when 10 then 'filtro_compra'
    when 11 then 'filtro_iniciamazon' when 12 then 'filtro_mentoria'
    when 13 then 'filtro_perfil'      when 14 then 'filtro_produtos'
    when 15 then 'filtro_comercial'   when 16 then 'filtro_saude_disparo'
    when 17 then 'filtro_evento'      when 18 then 'anti_fadiga'
  end as etapa,
  m.ordem_saida as ordem,
  case m.ordem_saida
    when 1 then 'sem telefone válido'          when 2 then 'opt-out de WhatsApp'
    when 3 then 'Novos / Em conexão'           when 4 then 'falha de entrega registrada'
    when 5 then 'perdido na cadência'          when 6 then 'perdido recentemente'
    when 7 then 'disparo anterior sem conexão' when 10 then 'compra (Assiny)'
    when 11 then 'IniciAmazon (MemberClass)'   when 12 then 'mentoria (MemberKit)'
    when 13 then 'perfil (Leadscore)'          when 14 then 'produtos'
    when 15 then 'estado comercial'            when 16 then 'saúde de disparo'
    when 17 then 'evento'                      when 18 then 'anti-fadiga'
  end as rotulo,
  qualificador.aplicar_pesos(m.eixos_json, m.pesos) as score,
  qualificador.faixa_de(qualificador.aplicar_pesos(m.eixos_json, m.pesos)) as faixa,
  m.eixos_json as eixos
from marcado m
$fn$;

comment on function qualificador.avaliar(jsonb) is
  'Funil de exclusão por pessoa. etapa NULL = passou por tudo. As etapas 1–7 são o
   bloqueio duro do blueprint: ordem fixa, não desligam. 10–17 são os oito cartões
   de filtro, cada um só aplicado quando ativo=true. 18 é o anti-fadiga.';

revoke execute on function qualificador.avaliar(jsonb) from public, anon;
revoke execute on function qualificador.txt_array(jsonb) from public, anon;
grant execute on function qualificador.avaliar(jsonb), qualificador.txt_array(jsonb)
  to authenticated, service_role;
