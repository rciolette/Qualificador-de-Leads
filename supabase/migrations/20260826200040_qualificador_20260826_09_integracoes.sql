-- Qualificador de Leads ROI · Fase 2 · migration 09
-- Registro das integracoes e log de execucao (PRD 5.7).
-- A credencial NUNCA fica aqui: integracao.credencial_ref guarda o NOME no Vault.

create table qualificador.integracao (
  id                   uuid primary key default gen_random_uuid(),
  slug                 text not null unique,
  nome_exibicao        text not null,
  tipo                 qualificador.tipo_integracao not null,
  base_url             text,
  credencial_ref       text,          -- NOME do segredo no Vault, nunca o valor
  credencial_mascara   text,          -- exibicao: "......3f2a"
  credencial_criada_em timestamptz,
  config               jsonb,
  ativa                boolean not null default false,
  frescor_limite_horas int default 24
);
comment on column qualificador.integracao.credencial_ref is
  'Nome do segredo no Supabase Vault, sempre com prefixo qualificador_. O valor nunca
   passa por esta tabela e nao ha caminho de leitura de volta -- so substituicao.';

create table qualificador.integracao_execucao (
  id            bigserial primary key,
  integracao_id uuid references qualificador.integracao(id),
  operacao      text,
  status        text,
  registros     int,
  duracao_ms    int,
  erro          text,
  executado_em  timestamptz not null default now()
);
create index integracao_execucao_recente_idx
  on qualificador.integracao_execucao (integracao_id, executado_em desc);

-- frescor por fonte (metrica da camada 1: "idade da ultima sincronizacao < 24h")
create or replace view qualificador.v_frescor_integracoes
with (security_invoker = true) as
select i.slug, i.nome_exibicao, i.tipo, i.ativa, i.frescor_limite_horas,
       u.executado_em                                  as ultima_execucao,
       u.status                                        as ultimo_status,
       u.registros                                     as ultimos_registros,
       round(extract(epoch from (now() - u.executado_em)) / 3600.0, 1) as horas_desde,
       (u.executado_em is null
        or now() - u.executado_em > make_interval(hours => i.frescor_limite_horas)) as vencida
from qualificador.integracao i
left join lateral (
  select e.executado_em, e.status, e.registros
  from qualificador.integracao_execucao e
  where e.integracao_id = i.id and e.status = 'ok'
  order by e.executado_em desc limit 1
) u on true;

alter table qualificador.integracao           enable row level security;
alter table qualificador.integracao_execucao  enable row level security;

create policy integracao_leitor on qualificador.integracao
  for select to authenticated using (qualificador.has_min_papel('leitor'));
create policy integracao_gestao on qualificador.integracao
  for all to authenticated
  using (qualificador.has_min_papel('gestao')) with check (qualificador.has_min_papel('gestao'));

create policy integracao_execucao_leitor on qualificador.integracao_execucao
  for select to authenticated using (qualificador.has_min_papel('leitor'));
create policy integracao_execucao_operador on qualificador.integracao_execucao
  for all to authenticated
  using (qualificador.has_min_papel('operador')) with check (qualificador.has_min_papel('operador'));

grant select, insert, update, delete
  on qualificador.integracao, qualificador.integracao_execucao to authenticated;
grant usage, select on sequence qualificador.integracao_execucao_id_seq to authenticated, service_role;
grant all on qualificador.integracao, qualificador.integracao_execucao to service_role;
grant select on qualificador.v_frescor_integracoes to authenticated, service_role;

-- as cinco fontes. Inativas ate a credencial ser gravada no Vault.
insert into qualificador.integracao (slug, nome_exibicao, tipo, base_url, credencial_ref, config) values
  ('assiny', 'Assiny (relatorio de transacoes)', 'fonte_venda', null, null,
   jsonb_build_object(
     'modo', 'upload_csv',
     'observacao', 'Sem API nesta versao. A entrada e o report-transaction exportado a mao.')),

  ('hubspot', 'HubSpot', 'crm', 'https://api.hubapi.com', 'qualificador_hubspot',
   jsonb_build_object(
     'portal_id', 49607200,
     'escopos', jsonb_build_array('crm.objects.contacts.read','crm.objects.deals.read'),
     'somente_leitura', true,
     'pipelines', jsonb_build_object(
        'IS', 711246125, 'AE', 710485361, 'ECONT', 717654561),
     'stages', jsonb_build_object(
        'IS',    jsonb_build_object('ganho', 1038914120, 'perdido', 1038914121),
        'AE',    jsonb_build_object('ganho', 1037811332, 'perdido', 1037811333),
        'ECONT', jsonb_build_object('ganho', 1047780490, 'perdido', 1047780491)),
     'lote_batch_read', 100,
     'lote_search', 200)),

  ('memberclass', 'MemberClass', 'area_membros', 'https://api.memberclass.com.br',
   'qualificador_memberclass',
   jsonb_build_object(
     'header_auth', 'x-api-key',
     'limit_maximo', 100,
     'observacao', 'Nenhum endpoint filtra por id -- todos filtram por email. CPF so em /student/report.')),

  ('memberkit', 'MemberKit', 'area_membros', 'https://memberkit.com.br/api/v1',
   'qualificador_memberkit',
   jsonb_build_object(
     'consulta_por', 'email',
     'base_url_confirmar', true,
     'observacao', 'Sem CPF e sem telefone. Se o e-mail divergir, a pessoa some.')),

  ('sellflux', 'Sellflux', 'disparo', 'https://apis.sellflux.app', 'qualificador_sellflux',
   jsonb_build_object(
     'header_auth', 'Authorization: Bearer',
     'somente_leitura', true,
     'exige_acting_user_id', true,
     'lead_project_por_pagina', 30,
     'tickets_limit_maximo', 100,
     'observacao', 'Sem webhooks e sem leitura de mensagem. Sincronizacao e polling.'));
