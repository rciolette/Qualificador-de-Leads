-- Qualificador de Leads ROI · Fase 2 · migration 11
-- Snapshots das fontes externas (PRD 5.4). Snapshot, nao historico:
-- uma linha por pessoa por plataforma, sobrescrita a cada sync.

create table qualificador.engajamento (
  pessoa_id        uuid not null references qualificador.pessoa(id) on delete cascade,
  plataforma       qualificador.area_membros not null,
  aulas_concluidas int,
  ultimo_acesso    date,
  cadastro         date,
  niveis           text[],
  dados            jsonb,
  coletado_em      timestamptz not null default now(),
  primary key (pessoa_id, plataforma)
);
comment on column qualificador.engajamento.niveis is
  'MemberKit: access.memberships[].level. Mistura tiers de lead e produtos pagos --
   ver anexo C do PRD. Produto pago e sinal diferente de engajamento em aulas.';

create table qualificador.crm_snapshot (
  pessoa_id               uuid primary key references qualificador.pessoa(id) on delete cascade,
  classificacao_leadscore text,
  leadscore               numeric,
  produtos_ativos         text[],
  produtos_historico      text[],
  econt                   jsonb,   -- aux_econt_servico, plano, vigencia, flags CNPJ
  deals                   jsonb,   -- pipeline, etapa, ganho/perdido, closedate, origem
  disparo                 jsonb,   -- familia disparo_sellflux_*
  sync_em                 timestamptz not null default now()
);
comment on column qualificador.crm_snapshot.produtos_ativos is
  'HubSpot produtos__servicos_ativos (DOIS sublinhados) -- validos agora.';
comment on column qualificador.crm_snapshot.produtos_historico is
  'HubSpot produtos_servicos_contratados (UM sublinhado) -- tudo que a pessoa ja teve.
   Nao confundir com produtos___servicos_contratados (TRES), que e do negocio (PRD 7.4).';
comment on column qualificador.crm_snapshot.classificacao_leadscore is
  'Faixa A-E. NULL significa "nunca preencheu formulario", nao "ruim" -- nao penalizar (PRD 7.5).';

create table qualificador.saude_disparo (
  pessoa_id             uuid primary key references qualificador.pessoa(id) on delete cascade,
  lead_id_sellflux      text,
  unsub_whats           boolean,
  unsub_sms             boolean,
  unsub_call            boolean,
  tags                  text[],
  preferential_whats_id text,
  ticket_aberto         boolean,
  atualizado_em         timestamptz,
  coletado_em           timestamptz not null default now()
);

create index engajamento_plataforma_idx   on qualificador.engajamento (plataforma, ultimo_acesso desc);
create index crm_snapshot_leadscore_idx   on qualificador.crm_snapshot (classificacao_leadscore);
create index crm_snapshot_sync_idx        on qualificador.crm_snapshot (sync_em);
create index saude_disparo_unsub_idx      on qualificador.saude_disparo (unsub_whats);

alter table qualificador.engajamento    enable row level security;
alter table qualificador.crm_snapshot   enable row level security;
alter table qualificador.saude_disparo  enable row level security;

do $do$
declare t text;
begin
  foreach t in array array['engajamento','crm_snapshot','saude_disparo'] loop
    execute format(
      'create policy %1$s_leitor on qualificador.%1$I for select to authenticated
         using (qualificador.has_min_papel(''leitor''))', t);
    execute format(
      'create policy %1$s_operador on qualificador.%1$I for all to authenticated
         using (qualificador.has_min_papel(''operador''))
         with check (qualificador.has_min_papel(''operador''))', t);
  end loop;
end $do$;

grant select, insert, update, delete
  on qualificador.engajamento, qualificador.crm_snapshot, qualificador.saude_disparo
  to authenticated;
grant all on qualificador.engajamento, qualificador.crm_snapshot, qualificador.saude_disparo
  to service_role;

-- Quem sincronizar primeiro: quem nunca foi, depois o mais velho.
create or replace function qualificador.pessoas_para_sync(
  p_fonte text, p_limite int default 100, p_max_idade_horas int default 24)
returns table (pessoa_id uuid, email text)
language sql stable
set search_path = qualificador, pg_catalog
as $fn$
  select p.id, p.email
  from qualificador.pessoa p
  left join lateral (
    select case p_fonte
             when 'hubspot'     then (select c.sync_em     from qualificador.crm_snapshot  c where c.pessoa_id = p.id)
             when 'sellflux'    then (select s.coletado_em from qualificador.saude_disparo s where s.pessoa_id = p.id)
             when 'memberclass' then (select e.coletado_em from qualificador.engajamento   e where e.pessoa_id = p.id and e.plataforma = 'memberclass')
             when 'memberkit'   then (select e.coletado_em from qualificador.engajamento   e where e.pessoa_id = p.id and e.plataforma = 'memberkit')
           end as visto_em
  ) v on true
  where p.email is not null
    and (v.visto_em is null
         or v.visto_em < now() - make_interval(hours => p_max_idade_horas))
  order by v.visto_em asc nulls first, p.criado_em
  limit p_limite;
$fn$;

revoke execute on function qualificador.pessoas_para_sync(text, int, int) from public, anon;
grant  execute on function qualificador.pessoas_para_sync(text, int, int) to authenticated, service_role;
