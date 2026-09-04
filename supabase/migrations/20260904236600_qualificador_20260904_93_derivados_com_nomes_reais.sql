-- Os campos de negócio passam a falar a língua do CRM.
--
-- Antes: "IS · Ganho", "ECONT · Em Conexao" -- o time vinha do config e o nome da
-- etapa era a chave do JSON com initcap. Agora: "Vendas | Inside Sales · Ganho",
-- "Vendas | E-cont · Em conexão" -- exatamente o que a operação vê no HubSpot,
-- inclusive as 4 etapas de AE que o mapa manual não conhecia (DBA Agendado, DBA
-- Realizado, Proposta enviada, Promessa de pagamento).
--
-- `times_ganho` continua existindo e continua usando IS/AE/ECONT: ele responde
-- "de qual TIME é a venda", que é pergunta nossa, não do CRM. Os dois convivem
-- porque respondem coisas diferentes -- um é o time, o outro é a etapa exata.

create or replace function qualificador.vocabulario_hubspot()
returns table (pipeline text, dealstage text, time_comercial text, etapa text)
language sql
stable
set search_path to 'qualificador', 'pg_catalog'
as $function$
  -- da tabela vinda da API, que tem todos os pipelines e todas as etapas
  select e.pipeline_id, e.stage_id, e.time_comercial, e.stage_label
    from qualificador.hubspot_etapa e
  union all
  -- fallback para o config, enquanto a tabela não tiver sido preenchida:
  -- sem isto, um projeto novo ficaria sem vocabulário nenhum até o primeiro sync
  select p.key, e.value #>> '{}', p.value->>'time',
         initcap(replace(e.key, '_', ' '))
    from qualificador.integracao i
    cross join lateral jsonb_each(coalesce(i.config->'stages_por_pipeline','{}'::jsonb)) p
    cross join lateral jsonb_each(p.value) e
   where i.slug = 'hubspot' and e.key <> 'time'
     and not exists (select 1 from qualificador.hubspot_etapa)
$function$;

create or replace function qualificador.derivados_negocio(p_deals jsonb)
returns jsonb
language sql
stable
set search_path to 'qualificador', 'pg_catalog'
as $function$
  with itens as (
    select d.value v from jsonb_array_elements(qualificador.itens_de(p_deals)) d
  )
  select jsonb_build_object(
    'times_ganho', coalesce((
      select array_agg(distinct v->>'time')
        from itens where (v->>'ganho')::boolean and nullif(v->>'time','') is not null), '{}'),
    'times_perdido', coalesce((
      select array_agg(distinct v->>'time')
        from itens where coalesce((v->>'perdido')::boolean, false)
                     and nullif(v->>'time','') is not null), '{}'),
    -- "Vendas | Inside Sales · Ganho": pipeline e etapa como o CRM os chama
    'etapas_negocio', coalesce((
      select array_agg(distinct e.pipeline_label || ' · ' || e.stage_label)
        from itens i
        join qualificador.hubspot_etapa e
          on e.pipeline_id = i.v->>'pipeline' and e.stage_id = i.v->>'dealstage'), '{}'),
    -- só o pipeline, para quem quer "tem negócio em Inside Sales", sem etapa
    'pipelines_negocio', coalesce((
      select array_agg(distinct e.pipeline_label)
        from itens i
        join qualificador.hubspot_etapa e
          on e.pipeline_id = i.v->>'pipeline' and e.stage_id = i.v->>'dealstage'), '{}'),
    -- as etapas de GANHO, pelo `ganho` da API (probabilidade 1), não pelo nome:
    -- "Ganho" em um pipeline é "Negócio fechado" em outro
    'ganhos_negocio', coalesce((
      select array_agg(distinct e.pipeline_label || ' · ' || e.stage_label)
        from itens i
        join qualificador.hubspot_etapa e
          on e.pipeline_id = i.v->>'pipeline' and e.stage_id = i.v->>'dealstage'
       where e.ganho), '{}'),
    'ganho_em', (
      select max(qualificador.como_data(v->>'closedate'))
        from itens where (v->>'ganho')::boolean),
    'dias_desde_ganho', (
      select current_date - max(qualificador.como_data(v->>'closedate'))
        from itens where (v->>'ganho')::boolean)
  )
$function$;

insert into qualificador.campo_filtravel
  (id, fonte, caminho, rotulo, grupo, tipo, operadores, descricao, ordem)
values
  ('hs.pipelines_negocio', 'hubspot', 'pipelines_negocio',
   'Pipeline do negócio', 'HubSpot', 'lista',
   array['contem_algum','nao_contem_nenhum','vazio','preenchido'],
   'Em quais pipelines a pessoa tem negócio, pelo nome real: "Vendas | Inside Sales", '
   '"Vendas | E-cont". Sem olhar a etapa.', 45),

  ('hs.ganhos_negocio', 'hubspot', 'ganhos_negocio',
   'Ganho em (pipeline · etapa)', 'HubSpot', 'lista',
   array['contem_algum','nao_contem_nenhum','vazio','preenchido'],
   'Só as etapas de ganho, pelo que a API do HubSpot marca como fechado-ganho -- '
   'não pelo nome, porque "Ganho" num pipeline é "Negócio fechado" em outro.', 46)
on conflict (id) do update
  set rotulo = excluded.rotulo, grupo = excluded.grupo, tipo = excluded.tipo,
      operadores = excluded.operadores, descricao = excluded.descricao, ordem = excluded.ordem;

update qualificador.pessoa_dados_estado set suja = true;
