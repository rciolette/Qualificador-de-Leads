-- As etapas do HubSpot vêm da API, não de um mapa escrito à mão.
--
-- `config.stages_por_pipeline` conhecia 3 pipelines e 5-7 etapas de cada, com
-- nomes derivados da chave do JSON ("Em Conexao", sem acento e sem ser o nome
-- que a operação vê). A API devolve 11 pipelines com TODAS as etapas e os nomes
-- reais, na ordem do funil:
--
--   Vendas | Account Executives: Novos, Em conexão, Conectado, DBA Agendado,
--     DBA Realizado, Proposta enviada, Promessa de pagamento, Ganho, Perdido
--
-- Quatro das nove nem existiam no mapa manual. Quem quisesse filtrar por
-- "Proposta enviada" não tinha como.
--
-- O config continua valendo para uma coisa que a API não sabe: qual pipeline é
-- de qual time comercial (IS / AE / ECONT). Isso é decisão nossa, não do CRM.

create table if not exists qualificador.hubspot_etapa (
  pipeline_id    text not null,
  stage_id       text not null,
  pipeline_label text not null,
  stage_label    text not null,
  ordem          int  not null default 0,
  -- a API diz se a etapa fecha o negócio e com que probabilidade: 1 = ganho,
  -- 0 = perdido. É mais confiável que casar o nome "Ganho" por texto.
  fechado        boolean not null default false,
  ganho          boolean not null default false,
  time_comercial text,
  atualizado_em  timestamptz not null default now(),
  primary key (pipeline_id, stage_id)
);

comment on table qualificador.hubspot_etapa is
  'Pipelines e etapas do HubSpot, lidos da API. Nomes reais e ordem do funil -- '
  'o config so sabia 3 pipelines com metade das etapas.';

alter table qualificador.hubspot_etapa enable row level security;

drop policy if exists hubspot_etapa_leitor on qualificador.hubspot_etapa;
create policy hubspot_etapa_leitor on qualificador.hubspot_etapa
  for select to authenticated
  using (qualificador.has_min_papel('leitor'::qualificador.papel));
drop policy if exists hubspot_etapa_operador on qualificador.hubspot_etapa;
create policy hubspot_etapa_operador on qualificador.hubspot_etapa
  for all to authenticated
  using (qualificador.has_min_papel('operador'::qualificador.papel))
  with check (qualificador.has_min_papel('operador'::qualificador.papel));

revoke all on qualificador.hubspot_etapa from public, anon;
grant select, insert, update, delete on qualificador.hubspot_etapa to authenticated;

-- Recebe o JSON em vez de buscá-lo: `pg_net` é assíncrono e a resposta chega
-- numa tabela, então quem busca e quem grava são passos diferentes. Assim a
-- mesma função serve para o cron, para um botão na tela e para um teste.
create or replace function qualificador.gravar_etapas_hubspot(p_corpo jsonb)
returns int
language plpgsql
volatile
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  n int;
  mapa jsonb;
begin
  if jsonb_typeof(p_corpo->'results') <> 'array' then
    raise exception 'resposta sem results: %', left(p_corpo::text, 200);
  end if;

  -- de qual time é cada pipeline: isso o CRM não sabe, é decisão nossa
  select coalesce(config->'stages_por_pipeline', '{}'::jsonb) into mapa
    from qualificador.integracao where slug = 'hubspot';

  insert into qualificador.hubspot_etapa
    (pipeline_id, stage_id, pipeline_label, stage_label, ordem, fechado, ganho,
     time_comercial, atualizado_em)
  select p->>'id', s->>'id', p->>'label', s->>'label',
         coalesce((s->'metadata'->>'displayOrder')::int, 0),
         coalesce((s->'metadata'->>'isClosed')::boolean, false),
         -- probability 1 é a etapa de ganho; o nome "Ganho" varia entre
         -- pipelines ("Negócio fechado", "Fechado Ganho")
         coalesce((s->'metadata'->>'probability')::numeric, 0) >= 1,
         mapa->(p->>'id')->>'time',
         now()
    from jsonb_array_elements(p_corpo->'results') p,
         jsonb_array_elements(p->'stages') s
  on conflict (pipeline_id, stage_id) do update set
    pipeline_label = excluded.pipeline_label,
    stage_label    = excluded.stage_label,
    ordem          = excluded.ordem,
    fechado        = excluded.fechado,
    ganho          = excluded.ganho,
    time_comercial = excluded.time_comercial,
    atualizado_em  = now();

  get diagnostics n = row_count;
  return n;
end $function$;

revoke execute on function qualificador.gravar_etapas_hubspot(jsonb) from public, anon;
grant execute on function qualificador.gravar_etapas_hubspot(jsonb) to authenticated, service_role;
