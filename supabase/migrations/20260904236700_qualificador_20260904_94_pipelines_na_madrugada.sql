-- Os pipelines entram na rotina noturna.
--
-- Etapa nova criada no HubSpot, pipeline renomeado, etapa arquivada: nada disso
-- avisa. Sem releitura, o seletor da tela vai divergindo do CRM em silêncio -- e
-- um filtro que aponta para um stage_id que não existe mais simplesmente para de
-- casar, sem erro.
--
-- `pg_net` dispara e esquece, então buscar e gravar são dois passos: o cron pede
-- num disparo e grava no seguinte, dois minutos depois. É o mesmo padrão do
-- espelhamento.

create or replace function qualificador.pipelines_pedir()
returns bigint
language plpgsql
volatile
security definer
set search_path to 'qualificador', 'pg_catalog', 'extensions'
as $function$
declare v_req bigint;
begin
  select net.http_get(
    url := 'https://api.hubapi.com/crm/v3/pipelines/deals',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || qualificador.credencial_ler('hubspot'),
      'Content-Type', 'application/json'),
    timeout_milliseconds := 60000) into v_req;
  return v_req;
end $function$;

create or replace function qualificador.pipelines_gravar(p_req bigint)
returns int
language plpgsql
volatile
security definer
set search_path to 'qualificador', 'pg_catalog', 'extensions'
as $function$
declare v_corpo jsonb; v_status int;
begin
  select r.status_code, r.content::jsonb into v_status, v_corpo
    from net._http_response r where r.id = p_req;
  if v_status is null then return 0; end if;          -- ainda não respondeu
  if v_status <> 200 then
    raise exception 'HubSpot pipelines respondeu %', v_status;
  end if;
  return qualificador.gravar_etapas_hubspot(v_corpo);
end $function$;

-- guarda o pedido em voo entre um disparo do cron e o seguinte
create table if not exists qualificador.pipelines_pedido (
  unico   boolean primary key default true check (unico),
  req_id  bigint,
  pedido_em timestamptz,
  gravado_em timestamptz
);
insert into qualificador.pipelines_pedido (unico) values (true) on conflict do nothing;

alter table qualificador.pipelines_pedido enable row level security;
drop policy if exists pipelines_pedido_leitor on qualificador.pipelines_pedido;
create policy pipelines_pedido_leitor on qualificador.pipelines_pedido
  for select to authenticated using (qualificador.has_min_papel('leitor'::qualificador.papel));
revoke all on qualificador.pipelines_pedido from public, anon;
grant select on qualificador.pipelines_pedido to authenticated;

do $do$
declare f text;
begin
  foreach f in array array[
    'qualificador.pipelines_pedir()',
    'qualificador.pipelines_gravar(bigint)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $do$;
