-- Qualificador de Leads ROI · migration 42 · Fase 3
-- Camada 1 das métricas (blueprint seção 08): saúde dos dados.
--
-- Cada métrica traz o valor de hoje, a linha de base medida no cruzamento manual
-- e a meta. E, principalmente, `tem_dado`: sem ele, 0% de cobertura parece
-- catástrofe quando é só "a fonte nunca sincronizou".

create or replace view qualificador.v_saude_dados
with (security_invoker = true) as
with
compradores as (
  select count(distinct t.pessoa_id)::numeric as total,
         count(distinct t.pessoa_id) filter (
           where exists (select 1 from qualificador.engajamento e
                          where e.pessoa_id = t.pessoa_id and e.plataforma = 'memberclass')
         )::numeric as com_conta
  from qualificador.transacao t
  join qualificador.projeto p on p.id = t.projeto_id
  where p.area_membros = 'memberclass'
),
crm as (
  select count(*)::numeric as sincronizados,
         count(*) filter (where classificacao_leadscore is not null)::numeric as com_leadscore
  from qualificador.crm_snapshot
),
econt as (
  select count(*)::numeric as total,
         count(*) filter (where nullif(d->>'origem_de_trafego','') is not null)::numeric as com_origem
  from qualificador.crm_snapshot c,
       lateral jsonb_array_elements(qualificador.itens_de(c.deals)) d
  where d->>'time' = 'ECONT'
),
pessoas as (
  select count(*)::numeric as total,
         count(*) filter (where telefone_e164 is not null)::numeric as com_telefone,
         count(*) filter (where email is not null)::numeric         as com_email
  from qualificador.pessoa
),
projetos as (
  select count(*)::numeric as total,
         count(*) filter (where area_membros is null
                            and not area_membros_nao_se_aplica)::numeric as sem_classificacao
  from qualificador.projeto where ativo
)
select * from (values
  ('compradores_memberclass', 'Compradores do front com conta na MemberClass', 'MemberClass',
   (select case when total > 0 then round(100 * com_conta / total, 1) end from compradores),
   46::numeric, 90::numeric,
   (select com_conta from compradores), (select total from compradores),
   (select exists (select 1 from qualificador.engajamento where plataforma = 'memberclass')),
   'Se metade dos compradores não tem conta, toda regra de engajamento enxerga menos da metade do universo.'),

  ('econt_com_origem', 'Negócios E-cont com origem de tráfego', 'HubSpot',
   (select case when total > 0 then round(100 * com_origem / total, 1) end from econt),
   60::numeric, 100::numeric,
   (select com_origem from econt), (select total from econt),
   (select exists (select 1 from qualificador.crm_snapshot)),
   'Sem origem, qualquer análise de atribuição no E-cont fica cega.'),

  ('base_com_leadscore', 'Contatos sincronizados com Leadscore apurado', 'HubSpot',
   (select case when sincronizados > 0 then round(100 * com_leadscore / sincronizados, 1) end from crm),
   95::numeric, null::numeric,
   (select com_leadscore from crm), (select sincronizados from crm),
   (select exists (select 1 from qualificador.crm_snapshot)),
   'Sem meta: depende de a pessoa ter passado por formulário. Ausência não penaliza.'),

  ('projetos_classificados', 'Projetos ativos com área de membros definida', 'Assiny',
   (select case when total > 0 then round(100 * (total - sem_classificacao) / total, 1) end from projetos),
   null::numeric, 100::numeric,
   (select total - sem_classificacao from projetos), (select total from projetos),
   true,
   'Projeto sem classificação é engajamento que ninguém vai procurar.'),

  ('pessoas_com_telefone', 'Pessoas com telefone válido em E.164', 'Assiny',
   (select case when total > 0 then round(100 * com_telefone / total, 1) end from pessoas),
   null::numeric, 95::numeric,
   (select com_telefone from pessoas), (select total from pessoas),
   true,
   'Sem telefone válido a pessoa não entra em nenhuma lista: é bloqueio duro.'),

  ('pessoas_com_email', 'Pessoas com e-mail', 'Assiny',
   (select case when total > 0 then round(100 * com_email / total, 1) end from pessoas),
   null::numeric, 99::numeric,
   (select com_email from pessoas), (select total from pessoas),
   true,
   'E-mail é a chave de cruzamento com as quatro plataformas.')
) as t(chave, rotulo, fonte, percentual, linha_base, meta, numerador, denominador, tem_dado, porque);

grant select on qualificador.v_saude_dados to authenticated, service_role;

-- Panorama do que existe: o denominador de todo o resto.
create or replace view qualificador.v_panorama
with (security_invoker = true) as
select
  (select count(*) from qualificador.pessoa)                                      as pessoas,
  (select count(*) from qualificador.transacao)                                   as transacoes,
  (select coalesce(round(sum(valor)::numeric, 2), 0) from qualificador.transacao)  as valor_total,
  (select count(*) from qualificador.importacao where status = 'ingerido')        as bases_importadas,
  (select count(*) from qualificador.projeto where ativo)                         as projetos_ativos,
  (select min(criado_em)::date from qualificador.transacao)                       as primeira_transacao,
  (select max(criado_em)::date from qualificador.transacao)                       as ultima_transacao,
  (select count(*) from qualificador.iniciativa where aberta)                     as iniciativas_abertas,
  (select count(*) from qualificador.lista)                                       as listas_geradas,
  (select count(*) from qualificador.integracao where ativa and tipo <> 'fonte_venda') as integracoes_ativas;

grant select on qualificador.v_panorama to authenticated, service_role;
