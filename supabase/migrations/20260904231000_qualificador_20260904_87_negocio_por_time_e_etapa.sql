-- Filtrar por PIPELINE e ETAPA do HubSpot, com nomes em vez de IDs.
--
-- `pipeline` e `dealstage` ficaram fora do catálogo desde a migration 53 por um
-- motivo real: eles são IDs (`711246125`, `1038914120`), e um seletor que oferece
-- "1038914120" como opção não é utilizável. O que faltava era o vocabulário --
-- e ele já existe, em `integracao.config.stages_por_pipeline`:
--
--   710485361 -> AE    (ganho 1037811332, perdido 1037811333, novos, ...)
--   711246125 -> IS    (ganho 1038914120, ...)
--   717654561 -> ECONT (ganho 1047780490, ...)
--
-- Então em vez de expor o ID cru, derivamos os campos que se pergunta de fato:
-- em que time a pessoa tem negócio GANHO, em que etapa cada negócio está, e
-- quando o ganho aconteceu. "Ganho em AE ou IS, e não ganho em Econt" vira duas
-- etapas legíveis, sem ninguém precisar saber o que é 1047780490.

create or replace function qualificador.vocabulario_hubspot()
returns table (pipeline text, dealstage text, time_comercial text, etapa text)
language sql
stable
set search_path to 'qualificador', 'pg_catalog'
as $function$
  select p.key,
         e.value #>> '{}',
         p.value->>'time',
         -- 'em_conexao' -> 'Em Conexao'; a tela mostra o que vier daqui
         initcap(replace(e.key, '_', ' '))
    from qualificador.integracao i
    cross join lateral jsonb_each(coalesce(i.config->'stages_por_pipeline','{}'::jsonb)) p
    cross join lateral jsonb_each(p.value) e
   where i.slug = 'hubspot'
     and e.key <> 'time'
$function$;

comment on function qualificador.vocabulario_hubspot() is
  'De-para de pipeline/dealstage do HubSpot para time e nome de etapa, lido do '
  'config. E o passo 4 do desenho da Tarefa 2: sem ele, so daria para filtrar por ID.';

-- As chaves derivadas de negócio que entram no objeto que o funil julga.
--
-- Separada em função própria porque TRÊS lugares montam esse objeto --
-- `garantir_pessoa_dados`, `medir_cobertura` e o caminho lento de `filtrar`.
-- Repetir a lógica nos três seria garantir que um dia eles discordem, e um
-- filtro que vale na medição e não vale no funil é o pior tipo de erro aqui.
create or replace function qualificador.derivados_negocio(p_deals jsonb)
returns jsonb
language sql
stable
set search_path to 'qualificador', 'pg_catalog'
as $function$
  with itens as (
    select d.value v from jsonb_array_elements(qualificador.itens_de(p_deals)) d
  ),
  voc as (select * from qualificador.vocabulario_hubspot())
  select jsonb_build_object(
    -- time onde há negócio GANHO. `ganho` já vem calculado pelo adaptador,
    -- comparando dealstage com o id de ganho daquele pipeline.
    'times_ganho', coalesce((
      select array_agg(distinct v->>'time')
        from itens where (v->>'ganho')::boolean and nullif(v->>'time','') is not null), '{}'),
    'times_perdido', coalesce((
      select array_agg(distinct v->>'time')
        from itens where coalesce((v->>'perdido')::boolean, false)
                     and nullif(v->>'time','') is not null), '{}'),
    -- "IS · Ganho", "ECONT · Em Conexao" -- uma entrada por negócio
    'etapas_negocio', coalesce((
      select array_agg(distinct coalesce(voc.time_comercial, i.v->>'time') || ' · ' || voc.etapa)
        from itens i
        join voc on voc.pipeline = i.v->>'pipeline'
                and voc.dealstage = i.v->>'dealstage'), '{}'),
    'pipelines_negocio', coalesce((
      select array_agg(distinct v->>'time') from itens
       where nullif(v->>'time','') is not null), '{}'),
    -- data do ganho mais recente: é o que responde "ganhou nos últimos 90 dias"
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
  ('hs.times_ganho', 'hubspot', 'times_ganho',
   'Time com negócio GANHO', 'HubSpot', 'lista',
   array['contem_algum','nao_contem_nenhum','vazio','preenchido'],
   'Times em que a pessoa tem negócio na etapa de Ganho: IS, AE, ECONT. '
   '"Ganhou em AE ou IS" é contém algum; "não ganhou em Econt" é não contém nenhum.', 40),

  ('hs.times_perdido', 'hubspot', 'times_perdido',
   'Time com negócio perdido', 'HubSpot', 'lista',
   array['contem_algum','nao_contem_nenhum','vazio','preenchido'],
   'Times em que a pessoa tem negócio marcado como perdido.', 41),

  ('hs.etapas_negocio', 'hubspot', 'etapas_negocio',
   'Etapa do negócio', 'HubSpot', 'lista',
   array['contem_algum','nao_contem_nenhum','vazio','preenchido'],
   'Time e etapa de cada negócio, como "IS · Ganho" ou "ECONT · Em Conexao". '
   'Traduzido dos IDs de dealstage pelo config da integração.', 42),

  ('hs.dias_desde_ganho', 'hubspot', 'dias_desde_ganho',
   'Dias desde o ganho', 'HubSpot', 'numero',
   array['maior_igual','menor_igual','entre'],
   'Dias desde o negócio ganho mais recente. Para "ganhou nos últimos 90 dias", '
   'use no máximo 90.', 43),

  ('hs.ganho_em', 'hubspot', 'ganho_em',
   'Data do ganho mais recente', 'HubSpot', 'data',
   array['depois_de','antes_de','entre'],
   'Data de fechamento do negócio ganho mais recente.', 44)
on conflict (id) do update
  set rotulo = excluded.rotulo, grupo = excluded.grupo, tipo = excluded.tipo,
      operadores = excluded.operadores, descricao = excluded.descricao,
      ordem = excluded.ordem;

do $do$
declare f text;
begin
  foreach f in array array[
    'qualificador.vocabulario_hubspot()',
    'qualificador.derivados_negocio(jsonb)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $do$;
