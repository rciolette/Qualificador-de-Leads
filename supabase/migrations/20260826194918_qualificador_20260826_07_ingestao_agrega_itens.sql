-- Qualificador de Leads ROI · Fase 1 · migration 07
-- Correcao ao PRD 5.3: no report da Assiny transaction_id NAO e unico.
-- Uma transacao tem N itens (ENTRY + ORDERBUMP + UPSELL + DOWNSELL).
-- Medido em 36 relatorios: 196.787 linhas -> 122.029 transacoes (31% sao itens extras).
-- Manter uma linha por item quebraria a PK; ficar so com um item perderia ~38% do valor.
-- Solucao: agregar por transaction_id -- valor somado, produtos concatenados,
-- oferta/funil do item principal (ENTRY, ou o de maior valor).

alter table qualificador.transacao add column itens int;
comment on column qualificador.transacao.itens is
  'Quantos itens do report compoem esta transacao (ENTRY + order bumps).';
comment on column qualificador.transacao.produto is
  'Produtos da transacao concatenados com " + ". Ex.: "[IA] Front + [IA] Acesso Vitalicio".';
comment on column qualificador.transacao.oferta is
  'Oferta do item principal (ENTRY, ou o de maior valor).';

create or replace function qualificador.ingerir_assiny(p_importacao_id uuid)
returns jsonb
language plpgsql
set search_path = qualificador, pg_catalog
as $fn$
declare
  v_desconhecidos text[];
  v_itens    int := 0;
  v_lidas    int := 0;
  v_novas    int := 0;
  v_sem_id   int := 0;
  v_pessoas  int := 0;
begin
  -- A. uma linha por TRANSACAO, agregando os itens
  create temp table _norm on commit drop as
  with itens as (
    select
      btrim(s.transaction_id)                              as transaction_id,
      s.linha,
      nullif(btrim(s.tipo_de_checkout), '')                as tipo_checkout,
      nullif(btrim(s.nome_do_produto), '')                 as produto,
      nullif(btrim(s.nome_da_oferta), '')                  as oferta,
      nullif(btrim(s.nome_do_funil), '')                   as funil,
      nullif(btrim(s.utm_source), '')                      as utm_source,
      nullif(btrim(s.status), '')                          as status,
      nullif(btrim(s.project_id), '')                      as project_id,
      btrim(s.nome_do_projeto)                             as nome_do_projeto,
      qualificador.norm_email(s.email_do_cliente)          as email,
      qualificador.norm_telefone(s.telefone_do_cliente)    as telefone,
      qualificador.norm_documento(s.documento_do_cliente)  as documento,
      nullif(btrim(s.nome_completo_do_cliente), '')        as nome,
      nullif(btrim(s.client_id), '')                       as client_id,
      nullif(btrim(s.valor), '')::numeric / 100            as valor,
      nullif(btrim(s.valor_liquido), '')::numeric / 100    as valor_liquido,
      (nullif(btrim(s.criado_em), '')::timestamp
         at time zone 'America/Sao_Paulo')                 as criado_em
    from qualificador.staging_assiny s
    where s.importacao_id = p_importacao_id
      and nullif(btrim(s.transaction_id), '') is not null
  ),
  -- item principal: ENTRY primeiro; sem ENTRY, o de maior valor
  principal as (
    select distinct on (transaction_id) *
    from itens
    order by transaction_id,
             (tipo_checkout = 'ENTRY') desc nulls last,
             valor desc nulls last,
             linha
  ),
  agregado as (
    select transaction_id,
           count(*)                                       as itens,
           sum(valor)                                     as valor,
           sum(valor_liquido)                             as valor_liquido,
           min(criado_em)                                 as criado_em,
           string_agg(distinct produto, ' + ' order by produto) as produtos
    from itens group by transaction_id
  )
  select p.transaction_id, p.email, p.telefone, p.documento, p.nome, p.client_id,
         p.project_id, p.nome_do_projeto, p.oferta, p.funil, p.utm_source, p.status,
         a.produtos as produto, a.valor, a.valor_liquido, a.criado_em, a.itens,
         null::uuid as pessoa_id
  from principal p join agregado a using (transaction_id);

  select count(*), coalesce(sum(itens), 0) into v_lidas, v_itens from _norm;

  -- B. bloqueio duro: projeto fora do catalogo nao passa. Nunca adivinhar (PRD 5.1).
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

  -- C. identidade: e-mail e a chave; documento e telefone sao reforco (PRD 5.2)
  update _norm n set pessoa_id = p.id from qualificador.pessoa p
   where n.email is not null and p.email = n.email;
  update _norm n set pessoa_id = p.id from qualificador.pessoa p
   where n.pessoa_id is null and n.documento is not null and p.documento = n.documento;
  update _norm n set pessoa_id = p.id from qualificador.pessoa p
   where n.pessoa_id is null and n.telefone is not null and p.telefone_e164 = n.telefone;

  create temp table _novos on commit drop as
  select gen_random_uuid() as id, x.*
  from (
    select distinct on (coalesce(email, documento, telefone))
      coalesce(email, documento, telefone) as chave,
      email, telefone, documento, nome, client_id
    from _norm
    where pessoa_id is null and coalesce(email, documento, telefone) is not null
    order by coalesce(email, documento, telefone), transaction_id desc
  ) x;

  insert into qualificador.pessoa (id, nome, email, telefone_e164, documento, assiny_client_id)
  select v.id, v.nome, v.email, v.telefone, v.documento, v.client_id from _novos v;
  get diagnostics v_pessoas = row_count;

  update _norm n set pessoa_id = v.id from _novos v
   where n.pessoa_id is null and coalesce(n.email, n.documento, n.telefone) = v.chave;

  -- D. enriquecer quem ja existia, sem sobrescrever o preenchido
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

  -- E. identificadores. A chave e (tipo, valor_norm): o primeiro dono vence.
  insert into qualificador.pessoa_identificador (pessoa_id, tipo, valor_norm, fonte)
  select distinct on (u.tipo, u.valor) u.pessoa_id, u.tipo, u.valor, 'assiny_csv'::qualificador.fonte_dado
  from (
    select pessoa_id, 'email'::qualificador.tipo_identificador,            email     from _norm where pessoa_id is not null and email     is not null
    union all
    select pessoa_id, 'documento'::qualificador.tipo_identificador,        documento from _norm where pessoa_id is not null and documento is not null
    union all
    select pessoa_id, 'telefone'::qualificador.tipo_identificador,         telefone  from _norm where pessoa_id is not null and telefone  is not null
    union all
    select pessoa_id, 'assiny_client_id'::qualificador.tipo_identificador, client_id from _norm where pessoa_id is not null and client_id is not null
  ) u(pessoa_id, tipo, valor)
  order by u.tipo, u.valor, u.pessoa_id
  on conflict (tipo, valor_norm) do nothing;

  -- F. transacoes. Reimportar o mesmo arquivo nao duplica.
  insert into qualificador.transacao
    (transaction_id, pessoa_id, projeto_id, importacao_id,
     produto, oferta, funil, utm_source, valor, valor_liquido, status, criado_em, itens)
  select n.transaction_id, n.pessoa_id,
         qualificador.resolver_projeto(n.project_id, n.nome_do_projeto), p_importacao_id,
         n.produto, n.oferta, n.funil, n.utm_source, n.valor, n.valor_liquido,
         n.status, n.criado_em, n.itens
  from _norm n
  where n.pessoa_id is not null
  on conflict (transaction_id) do nothing;
  get diagnostics v_novas = row_count;

  select count(*) into v_sem_id from _norm where pessoa_id is null;

  update qualificador.importacao i set
    linhas_lidas     = v_itens,
    linhas_novas     = v_novas,
    linhas_ignoradas = v_lidas - v_novas,
    periodo_ini      = (select min(criado_em)::date from _norm),
    periodo_fim      = (select max(criado_em)::date from _norm)
  where i.id = p_importacao_id;

  return jsonb_build_object(
    'importacao_id',         p_importacao_id,
    'itens_no_arquivo',      v_itens,
    'transacoes',            v_lidas,
    'transacoes_novas',      v_novas,
    'transacoes_ja_havia',   v_lidas - v_novas - v_sem_id,
    'sem_identidade',        v_sem_id,
    'pessoas_criadas',       v_pessoas
  );
end
$fn$;

revoke execute on function qualificador.ingerir_assiny(uuid) from public;
grant  execute on function qualificador.ingerir_assiny(uuid) to authenticated, service_role;
