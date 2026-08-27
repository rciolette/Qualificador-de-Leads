-- Qualificador de Leads ROI · Fase 1 · migration 02
-- Normalizacao, catalogo de projetos, identidade e transacoes (PRD 5.1 a 5.3).

-- ------------------------------------------------------- normalizacao
create or replace function qualificador.norm_email(v text)
returns text language sql immutable
set search_path = pg_catalog as $$
  select nullif(lower(btrim(coalesce(v,''))), '')
$$;

create or replace function qualificador.norm_documento(v text)
returns text language sql immutable
set search_path = pg_catalog as $$
  select case
    when length(regexp_replace(coalesce(v,''), '\D', '', 'g')) >= 11
    then regexp_replace(v, '\D', '', 'g')
  end
$$;
comment on function qualificador.norm_documento(text) is
  'So digitos. Descarta com menos de 11 digitos (PRD 5.2).';

create or replace function qualificador.norm_telefone(v text)
returns text language sql immutable
set search_path = pg_catalog as $$
  with d as (select regexp_replace(coalesce(v,''), '\D', '', 'g') as n)
  select case
    -- ja veio com DDI 55: 55 + 10 (fixo) ou 55 + 11 (movel)
    when length(n) in (12,13) and left(n,2) = '55' then '+' || n
    -- nacional: DDD + 8/9 digitos
    when length(n) in (10,11)                      then '+55' || n
    -- internacional explicito (input comecava com +), preserva
    when btrim(coalesce(v,'')) like '+%' and length(n) between 8 and 15 then '+' || n
  end
  from d
$$;
comment on function qualificador.norm_telefone(text) is
  'E.164. BR: +55DDNNNNNNNNN. Retorna NULL quando nao da para inferir DDD (PRD 5.2).';

create or replace function qualificador.tg_atualizado_em()
returns trigger language plpgsql
set search_path = pg_catalog as $$
begin new.atualizado_em := now(); return new; end $$;

-- ------------------------------------------------------- 5.1 catalogo
create table qualificador.projeto (
  id                    uuid primary key default gen_random_uuid(),
  organizacao_assiny    text not null,
  id_organizacao_assiny text,
  nome_assiny           text not null unique,
  id_projeto_assiny     text,
  area_membros          qualificador.area_membros,
  ativo                 boolean not null default true,
  observacao            text,
  criado_em             timestamptz not null default now()
);
comment on table qualificador.projeto is
  'Catalogo Assiny (PRD anexo A). Projeto desconhecido bloqueia a importacao -- nunca adivinhar.';
comment on column qualificador.projeto.area_membros is
  'Onde procurar o engajamento desse comprador. Nao classifica o lead.';
create index projeto_id_projeto_assiny_idx on qualificador.projeto (id_projeto_assiny);

-- ------------------------------------------------------- 5.2 identidade
create table qualificador.pessoa (
  id               uuid primary key default gen_random_uuid(),
  hubspot_id       text unique,
  nome             text,
  email            text,
  telefone_e164    text,
  documento        text,
  assiny_client_id text,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
comment on table qualificador.pessoa is
  'Identidade espelhada. Chave primaria de cruzamento: e-mail. Documento e telefone sao reforco (PRD 5.2).';
create unique index pessoa_email_uidx on qualificador.pessoa (email) where email is not null;
create index pessoa_telefone_idx  on qualificador.pessoa (telefone_e164);
create index pessoa_documento_idx on qualificador.pessoa (documento);

create trigger pessoa_set_atualizado_em before update on qualificador.pessoa
  for each row execute function qualificador.tg_atualizado_em();

create table qualificador.pessoa_identificador (
  pessoa_id  uuid not null references qualificador.pessoa(id) on delete cascade,
  tipo       qualificador.tipo_identificador not null,
  valor_norm text not null,
  fonte      qualificador.fonte_dado not null,
  primary key (tipo, valor_norm)
);
create index pessoa_identificador_pessoa_idx on qualificador.pessoa_identificador (pessoa_id);

-- ------------------------------------------------------- 5.3 transacoes
create table qualificador.importacao (
  id               uuid primary key default gen_random_uuid(),
  arquivo          text not null,
  projeto_id       uuid references qualificador.projeto(id),
  periodo_ini      date,
  periodo_fim      date,
  linhas_lidas     int,
  linhas_novas     int,
  linhas_ignoradas int,
  importado_por    uuid,
  importado_em     timestamptz not null default now()
);

create table qualificador.transacao (
  transaction_id text primary key,
  pessoa_id      uuid not null references qualificador.pessoa(id),
  projeto_id     uuid references qualificador.projeto(id),
  importacao_id  uuid references qualificador.importacao(id),
  produto        text,
  oferta         text,
  funil          text,
  utm_source     text,
  valor          numeric,
  valor_liquido  numeric,
  status         text,
  criado_em      timestamptz
);
comment on column qualificador.transacao.valor is
  'Em REAIS. O CSV da Assiny exporta centavos; a ingestao divide por 100.';
create index transacao_pessoa_idx    on qualificador.transacao (pessoa_id);
create index transacao_projeto_idx   on qualificador.transacao (projeto_id, criado_em desc);
create index transacao_criado_em_idx on qualificador.transacao (criado_em desc);
create index transacao_status_idx    on qualificador.transacao (status);

-- ------------------------------------------------------- RLS + grants
alter table qualificador.projeto              enable row level security;
alter table qualificador.pessoa               enable row level security;
alter table qualificador.pessoa_identificador enable row level security;
alter table qualificador.importacao           enable row level security;
alter table qualificador.transacao            enable row level security;

-- configuracao: leitura por leitor, escrita por gestao
create policy projeto_leitor on qualificador.projeto
  for select to authenticated using (qualificador.has_min_papel('leitor'));
create policy projeto_gestao on qualificador.projeto
  for all to authenticated
  using (qualificador.has_min_papel('gestao')) with check (qualificador.has_min_papel('gestao'));

-- dados operacionais: leitura por leitor, escrita por operador
do $do$
declare t text;
begin
  foreach t in array array['pessoa','pessoa_identificador','importacao','transacao'] loop
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
  on qualificador.projeto, qualificador.pessoa, qualificador.pessoa_identificador,
     qualificador.importacao, qualificador.transacao
  to authenticated;
grant all on all tables in schema qualificador to service_role;

revoke execute on function qualificador.norm_email(text)     from public;
revoke execute on function qualificador.norm_documento(text) from public;
revoke execute on function qualificador.norm_telefone(text)  from public;
grant execute on function qualificador.norm_email(text), qualificador.norm_documento(text),
                          qualificador.norm_telefone(text)
  to authenticated, service_role;
