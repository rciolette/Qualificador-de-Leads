-- Qualificador de Leads ROI · migration 16
-- Importador genérico: qualquer planilha, com mapeamento manual de colunas.
--
-- O PRD 2 diz "a Assiny é sempre a entrada". Isso deixa de valer aqui, por decisão
-- do Raphael em 26/08/2026: listas de webinar, exports do HubSpot e planilhas de
-- evento passam a ser universo de entrada válido. A Assiny continua sendo o caminho
-- principal e mantém seu parser especializado -- só deixou de ser o único.

alter type qualificador.fonte_dado add value if not exists 'importacao_manual';

-- ---------------------------------------------------------- perfis de importação
create table qualificador.fonte_importacao (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null unique,
  descricao      text,
  -- campo canônico -> nome da coluna no arquivo. Ex.: {"email": "E-mail do lead"}
  mapeamento     jsonb not null,
  -- campo canônico -> transformação. Ex.: {"valor": "centavos_para_reais"}
  transformacoes jsonb not null default '{}'::jsonb,
  -- defaults de tratamento, sobrescrevíveis a cada importação
  regras         jsonb not null default '{}'::jsonb,
  -- colunas que identificam este formato, para sugerir o perfil sozinho
  assinatura     text[],
  embutido       boolean not null default false,
  criado_por     uuid,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

comment on table qualificador.fonte_importacao is
  'Perfil de importação reutilizável: o de-para de colunas de uma origem recorrente.
   Campos canônicos aceitos: email, telefone, documento, nome, assiny_client_id,
   transaction_id, produto, oferta, funil, utm_source, valor, valor_liquido, status,
   criado_em, projeto_nome, projeto_id.
   Transformações: centavos_para_reais, brt_para_utc, so_digitos, minusculas.';

create trigger fonte_importacao_set_atualizado_em before update on qualificador.fonte_importacao
  for each row execute function qualificador.tg_atualizado_em();

-- ------------------------------------------------- identificação da base importada
alter table qualificador.importacao
  add column nome                text,
  add column descricao           text,
  add column tags                text[],
  add column fonte_importacao_id uuid references qualificador.fonte_importacao(id),
  add column regras              jsonb not null default '{}'::jsonb,
  add column formato             text,
  add column status              text not null default 'pendente';

comment on column qualificador.importacao.nome is
  'Como a operação chama esta base. Cai no filtro de origem ao montar uma iniciativa.';
comment on column qualificador.importacao.regras is
  'Tratamento aplicado NESTA importação: duplicados, status aceitos, recorte de período,
   se exige projeto no catálogo. Uma lista de webinar não tem projeto Assiny -- e não deve
   ser barrada por isso.';
comment on column qualificador.importacao.status is
  'pendente | analisado | ingerido | erro. "analisado" é o arquivo no staging esperando
   o mapeamento; nada foi para pessoa/transacao ainda.';

create index importacao_tags_idx on qualificador.importacao using gin (tags);
create index importacao_status_idx on qualificador.importacao (status, importado_em desc);

-- ------------------------------------------------------------- staging genérico
create table qualificador.staging_generico (
  importacao_id uuid not null references qualificador.importacao(id) on delete cascade,
  linha         int  not null,
  dados         jsonb not null,
  primary key (importacao_id, linha)
);
comment on table qualificador.staging_generico is
  'Uma linha do arquivo como veio, chaveada pelo nome da coluna. O mapeamento é
   aplicado só na ingestão -- então dá para reimportar com outro de-para sem
   subir o arquivo de novo.';

-- --------------------------------------------------------------- documentos soltos
create table qualificador.documento (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  formato       text,
  conteudo      text,
  tags          text[],
  importacao_id uuid references qualificador.importacao(id) on delete set null,
  criado_por    uuid,
  criado_em     timestamptz not null default now()
);
comment on table qualificador.documento is
  'Arquivo arrastado que não é planilha (.md, .txt): briefing, critérios, anotações.
   Não vira dado -- fica como contexto da base.';
create index documento_tags_idx on qualificador.documento using gin (tags);

-- ------------------------------------------------------------------ RLS + grants
alter table qualificador.fonte_importacao enable row level security;
alter table qualificador.staging_generico enable row level security;
alter table qualificador.documento        enable row level security;

do $do$
declare t text;
begin
  foreach t in array array['fonte_importacao','staging_generico','documento'] loop
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
  on qualificador.fonte_importacao, qualificador.staging_generico, qualificador.documento
  to authenticated;
grant all
  on qualificador.fonte_importacao, qualificador.staging_generico, qualificador.documento
  to service_role;
