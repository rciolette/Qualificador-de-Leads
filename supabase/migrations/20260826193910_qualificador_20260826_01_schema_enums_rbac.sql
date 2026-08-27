-- Qualificador de Leads ROI · Fase 1 · migration 01
-- Schema isolado, enums e RBAC proprio. Nada fora de "qualificador".

create schema if not exists qualificador;
comment on schema qualificador is
  'Qualificador de Leads ROI (PRD v1.0). Isolado de public e dash: RBAC proprio, segredos proprios, zero FK cruzando schema.';

-- ---------------------------------------------------------------- enums
create type qualificador.area_membros        as enum ('memberclass','memberkit');
create type qualificador.tipo_identificador  as enum ('email','documento','telefone','assiny_client_id','memberclass_id');
create type qualificador.fonte_dado          as enum ('assiny_csv','hubspot','memberclass','memberkit','sellflux');
create type qualificador.tipo_iniciativa     as enum ('corujao','launch','webinar','pontual');
create type qualificador.fase_iniciativa     as enum ('atrair','converter','pre','pos');
create type qualificador.time_comercial      as enum ('IS','AE','ECONT');
create type qualificador.tipo_integracao     as enum ('fonte_venda','area_membros','crm','disparo');
create type qualificador.papel               as enum ('leitor','operador','gestao');

-- ---------------------------------------------------------------- RBAC
create table qualificador.user_profiles (
  user_id   uuid primary key,          -- auth.uid() -- SEM foreign key para auth
  papel     qualificador.papel not null default 'leitor',
  criado_em timestamptz not null default now()
);
comment on table qualificador.user_profiles is
  'RBAC do Qualificador. Nao herda de public.profiles nem usa public.is_gestao().';

create or replace function qualificador.has_min_papel(minimo qualificador.papel)
returns boolean
language sql
stable
security definer
set search_path = qualificador, pg_catalog
as $$
  select exists (
    select 1
    from qualificador.user_profiles
    where user_id = auth.uid()
      and array_position(enum_range(null::qualificador.papel), papel)
       >= array_position(enum_range(null::qualificador.papel), minimo)
  );
$$;
comment on function qualificador.has_min_papel(qualificador.papel) is
  'Papel minimo do usuario corrente no Qualificador. search_path fixo, security definer.';

alter table qualificador.user_profiles enable row level security;

create policy up_self_select on qualificador.user_profiles
  for select to authenticated
  using (user_id = auth.uid() or qualificador.has_min_papel('gestao'));

create policy up_gestao_write on qualificador.user_profiles
  for all to authenticated
  using (qualificador.has_min_papel('gestao'))
  with check (qualificador.has_min_papel('gestao'));

-- ---------------------------------------------------------------- grants
grant usage on schema qualificador to authenticated, service_role;
revoke all on schema qualificador from anon;

grant select, insert, update, delete on qualificador.user_profiles to authenticated;
grant all on qualificador.user_profiles to service_role;

revoke execute on function qualificador.has_min_papel(qualificador.papel) from public;
grant  execute on function qualificador.has_min_papel(qualificador.papel) to authenticated, service_role;
