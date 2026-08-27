-- Qualificador de Leads ROI · Fase 1 · migration 06
-- Staging do CSV da Assiny + ingestao com normalizacao e resolucao de identidade.

create table qualificador.staging_assiny (
  importacao_id             uuid not null references qualificador.importacao(id) on delete cascade,
  linha                     int  not null,
  transaction_id            text,
  nome_do_produto           text,
  tipo_de_checkout          text,
  nome_do_projeto           text,
  project_id                text,
  nome_da_organizacao       text,
  organization_id           text,
  valor                     text,
  taxa                      text,
  valor_liquido             text,
  parcelas                  text,
  moeda                     text,
  criado_em                 text,
  atualizado_em             text,
  status                    text,
  tipo_de_pagamento         text,
  offer_id                  text,
  nome_da_oferta            text,
  nome_do_funil             text,
  client_id                 text,
  nome_completo_do_cliente  text,
  telefone_do_cliente       text,
  email_do_cliente          text,
  documento_do_cliente      text,
  tipo_documento_do_cliente text,
  utm_campaign              text,
  utm_content               text,
  utm_medium                text,
  utm_source                text,
  utm_term                  text,
  short_funnel_id           text,
  node_id                   text,
  funnel_id                 text,
  primary key (importacao_id, linha)
);
comment on table qualificador.staging_assiny is
  'Recorte do report-transaction da Assiny (63 colunas no export; guardamos as 34 uteis).
   Tudo text: o cast e a normalizacao acontecem em qualificador.ingerir_assiny().';

alter table qualificador.staging_assiny enable row level security;
create policy staging_assiny_leitor on qualificador.staging_assiny
  for select to authenticated using (qualificador.has_min_papel('leitor'));
create policy staging_assiny_operador on qualificador.staging_assiny
  for all to authenticated
  using (qualificador.has_min_papel('operador')) with check (qualificador.has_min_papel('operador'));
grant select, insert, update, delete on qualificador.staging_assiny to authenticated;
grant all on qualificador.staging_assiny to service_role;

-- ---------------------------------------------------------------- ingestao
create or replace function qualificador.ingerir_assiny(p_importacao_id uuid)
returns jsonb
language plpgsql
set search_path = qualificador, pg_catalog
as $fn$
declare
  v_desconhecidos text[];
  v_lidas    int := 0;
  v_novas    int := 0;
  v_sem_id   int := 0;
  v_pessoas  int := 0;
begin
  -- A. recorte normalizado, uma linha por transacao (ultima ocorrencia vence)
  create temp table _norm on commit drop as
  select distinct on (btrim(s.transaction_id))
    btrim(s.transaction_id)                              as transaction_id,
    qualificador.norm_email(s.email_do_cliente)          as email,
    qualificador.norm_telefone(s.telefone_do_cliente)    as telefone,
    qualificador.norm_documento(s.documento_do_cliente)  as documento,
    nullif(btrim(s.nome_completo_do_cliente), '')        as nome,
    nullif(btrim(s.client_id), '')                       as client_id,
    nullif(btrim(s.project_id), '')                      as project_id,
    btrim(s.nome_do_projeto)                             as nome_do_projeto,
    nullif(btrim(s.nome_do_produto), '')                 as produto,
    nullif(btrim(s.nome_da_oferta), '')                  as oferta,
    nullif(btrim(s.nome_do_funil), '')                   as funil,
    nullif(btrim(s.utm_source), '')                      as utm_source,
    nullif(btrim(s.status), '')                          as status,
    nullif(btrim(s.valor), '')::numeric / 100            as valor,
    nullif(btrim(s.valor_liquido), '')::numeric / 100    as valor_liquido,
    (nullif(btrim(s.criado_em), '')::timestamp
       at time zone 'America/Sao_Paulo')                 as criado_em,
    null::uuid                                           as pessoa_id
  from qualificador.staging_assiny s
  where s.importacao_id = p_importacao_id
    and nullif(btrim(s.transaction_id), '') is not null
  order by btrim(s.transaction_id), s.linha desc;

  select count(*) into v_lidas from _norm;

  -- B. bloqueio duro: projeto desconhecido nao passa. Nunca adivinhar (PRD 5.1).
  select array_agg(distinct coalesce(n.nome_do_projeto, '(sem nome)')
                            || ' [' || coalesce(n.project_id, 'sem ProjectId') || ']')
    into v_desconhecidos
  from _norm n
  where qualificador.resolver_projeto(n.project_id, n.nome_do_projeto) is null;

  if v_desconhecidos is not null then
    raise exception
      'Importacao bloqueada: % projeto(s) fora do catalogo -> %. Classifique em qualificador.projeto antes de reimportar.',
      array_length(v_desconhecidos, 1), array_to_string(v_desconhecidos, ' | ')
      using errcode = 'check_violation';
  end if;

  -- C. resolucao de identidade: e-mail e a chave; documento e telefone sao reforco (PRD 5.2)
  update _norm n set pessoa_id = p.id
    from qualificador.pessoa p
   where n.email is not null and p.email = n.email;

  update _norm n set pessoa_id = p.id
    from qualificador.pessoa p
   where n.pessoa_id is null and n.documento is not null and p.documento = n.documento;

  update _norm n set pessoa_id = p.id
    from qualificador.pessoa p
   where n.pessoa_id is null and n.telefone is not null and p.telefone_e164 = n.telefone;

  -- pessoas novas, deduplicadas dentro do proprio arquivo
  create temp table _novos on commit drop as
  select gen_random_uuid() as id, x.*
  from (
    select distinct on (coalesce(email, documento, telefone))
      coalesce(email, documento, telefone) as chave,
      email, telefone, documento, nome, client_id
    from _norm
    where pessoa_id is null
      and coalesce(email, documento, telefone) is not null
    order by coalesce(email, documento, telefone), transaction_id desc
  ) x;

  insert into qualificador.pessoa (id, nome, email, telefone_e164, documento, assiny_client_id)
  select v.id, v.nome, v.email, v.telefone, v.documento, v.client_id from _novos v;
  get diagnostics v_pessoas = row_count;

  update _norm n set pessoa_id = v.id
    from _novos v
   where n.pessoa_id is null
     and coalesce(n.email, n.documento, n.telefone) = v.chave;

  -- D. enriquecer quem ja existia, sem sobrescrever o que ja esta preenchido
  update qualificador.pessoa p set
    nome             = coalesce(p.nome, n.nome),
    telefone_e164    = coalesce(p.telefone_e164, n.telefone),
    documento        = coalesce(p.documento, n.documento),
    assiny_client_id = coalesce(p.assiny_client_id, n.client_id),
    email            = case
                         when p.email is not null or n.email is null then p.email
                         when exists (select 1 from qualificador.pessoa p2
                                       where p2.email = n.email and p2.id <> p.id) then p.email
                         else n.email
                       end
  from (
    select distinct on (pessoa_id) pessoa_id, nome, email, telefone, documento, client_id
    from _norm where pessoa_id is not null
    order by pessoa_id, transaction_id desc
  ) n
  where p.id = n.pessoa_id;

  -- E. identificadores (a chave e (tipo, valor_norm) -- o primeiro dono vence)
  insert into qualificador.pessoa_identificador (pessoa_id, tipo, valor_norm, fonte)
  select distinct on (u.tipo, u.valor) u.pessoa_id, u.tipo, u.valor, 'assiny_csv'::qualificador.fonte_dado
  from (
    select pessoa_id, 'email'::qualificador.tipo_identificador            as tipo, email     as valor from _norm where pessoa_id is not null and email     is not null
    union all
    select pessoa_id, 'documento'::qualificador.tipo_identificador,             documento         from _norm where pessoa_id is not null and documento is not null
    union all
    select pessoa_id, 'telefone'::qualificador.tipo_identificador,              telefone          from _norm where pessoa_id is not null and telefone  is not null
    union all
    select pessoa_id, 'assiny_client_id'::qualificador.tipo_identificador,      client_id         from _norm where pessoa_id is not null and client_id is not null
  ) u
  order by u.tipo, u.valor, u.pessoa_id
  on conflict (tipo, valor_norm) do nothing;

  -- F. transacoes. Reimportar o mesmo arquivo nao duplica.
  insert into qualificador.transacao
    (transaction_id, pessoa_id, projeto_id, importacao_id,
     produto, oferta, funil, utm_source, valor, valor_liquido, status, criado_em)
  select n.transaction_id, n.pessoa_id,
         qualificador.resolver_projeto(n.project_id, n.nome_do_projeto), p_importacao_id,
         n.produto, n.oferta, n.funil, n.utm_source, n.valor, n.valor_liquido, n.status, n.criado_em
  from _norm n
  where n.pessoa_id is not null
  on conflict (transaction_id) do nothing;
  get diagnostics v_novas = row_count;

  select count(*) into v_sem_id from _norm where pessoa_id is null;

  update qualificador.importacao i set
    linhas_lidas     = v_lidas,
    linhas_novas     = v_novas,
    linhas_ignoradas = v_lidas - v_novas,
    periodo_ini      = (select min(criado_em)::date from _norm),
    periodo_fim      = (select max(criado_em)::date from _norm)
  where i.id = p_importacao_id;

  return jsonb_build_object(
    'importacao_id',        p_importacao_id,
    'transacoes_lidas',     v_lidas,
    'transacoes_novas',     v_novas,
    'transacoes_ja_havia',  v_lidas - v_novas - v_sem_id,
    'linhas_sem_identidade', v_sem_id,
    'pessoas_criadas',      v_pessoas
  );
end
$fn$;

comment on function qualificador.ingerir_assiny(uuid) is
  'Le qualificador.staging_assiny da importacao, normaliza, resolve identidade e carrega
   pessoa/pessoa_identificador/transacao. Bloqueia se houver projeto fora do catalogo.
   Valores convertidos de centavos para reais; datas interpretadas como America/Sao_Paulo.';

revoke execute on function qualificador.ingerir_assiny(uuid) from public;
grant  execute on function qualificador.ingerir_assiny(uuid) to authenticated, service_role;
