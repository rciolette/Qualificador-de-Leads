-- `DELETE requires a WHERE clause` -- o funil parou de calcular NA TELA, e só na
-- tela.
--
-- O projeto carrega `supautils` em `session_preload_libraries`, e ela recusa
-- `delete` sem `where` para roles não privilegiados. Como `postgres` a mesma
-- função roda sem reclamar -- e é como `postgres` que o MCP executa. Foi por isso
-- que as duas passaram em todos os testes e quebraram no primeiro uso real:
-- quem abre o app é `authenticated`.
--
-- `where true` é a forma de dizer "sim, é a tabela inteira, de propósito". As
-- duas são caches derivados reconstruídos na mesma transação; apagar tudo é o
-- comportamento correto, o que faltava era declará-lo.

create or replace function qualificador.garantir_pessoa_dados()
returns boolean
language plpgsql
volatile
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  e qualificador.pessoa_dados_estado%rowtype;
begin
  select * into e from qualificador.pessoa_dados_estado;
  if found and not e.suja and e.dia = current_date then
    return true;
  end if;

  perform pg_advisory_xact_lock(hashtext('qualificador.pessoa_dados'));

  select * into e from qualificador.pessoa_dados_estado;
  if found and not e.suja and e.dia = current_date then
    return true;
  end if;

  -- `where true`: supautils recusa delete sem where para authenticated
  delete from qualificador.pessoa_dados where true;

  insert into qualificador.pessoa_dados (
    pessoa_id, dados,
    telefone_e164, unsub_whats, em_cadencia_auto, falha_sellflux,
    perdido_na_cadencia, perdido_em, cadencia_iniciada, conectou, whats_preferencial)
  select v.pessoa_id, d.dados,
         d.dados->>'telefone_e164',
         qualificador.como_bool(d.dados->>'unsub_whats'),
         qualificador.como_bool(d.dados->>'em_cadencia_automatica'),
         qualificador.como_bool(d.dados->>'falha_sellflux'),
         qualificador.como_bool(d.dados->>'perdido_na_cadencia'),
         qualificador.como_ts(d.dados->>'perdido_em'),
         qualificador.como_bool(d.dados->>'cadencia_iniciada'),
         qualificador.como_bool(d.dados->>'conectou'),
         d.dados->>'preferential_whats_id'
    from qualificador.v_pessoa_completa v
    left join qualificador.crm_snapshot c on c.pessoa_id = v.pessoa_id
    cross join lateral (
      select to_jsonb(v)
               || jsonb_build_object('props',       coalesce(c.props, '{}'::jsonb))
               || jsonb_build_object('props_deals', coalesce(c.props_deals, '{}'::jsonb)) as dados
    ) d;

  update qualificador.pessoa_dados_estado
     set suja = false, dia = current_date, atualizada_em = now();
  return true;
exception when insufficient_privilege then
  return false;
end $function$;

create or replace function qualificador.medir_cobertura()
returns table (campo_id text, com_dado bigint, base bigint)
language plpgsql
volatile
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  n bigint;
begin
  create temp table _cob on commit drop as
    select to_jsonb(v)
             || jsonb_build_object('props',       coalesce(c.props, '{}'::jsonb))
             || jsonb_build_object('props_deals', coalesce(c.props_deals, '{}'::jsonb)) as j
      from qualificador.v_pessoa_completa v
      left join qualificador.crm_snapshot c on c.pessoa_id = v.pessoa_id;
  select count(*) into n from _cob;

  -- `where true`: supautils recusa delete sem where para authenticated
  delete from qualificador.cobertura_campo where true;

  insert into qualificador.cobertura_campo (campo_id, com_dado, base)
  select c.id,
         count(*) filter (where
           case
             when c.fonte = 'hubspot_negocio'
               then jsonb_array_length(qualificador.valores_do_negocio(d.j, c.caminho)) > 0
             when c.fonte = 'hubspot_contato'
               then not qualificador.valor_ausente(d.j->'props'->c.caminho)
             else not qualificador.valor_ausente(d.j->c.caminho)
           end),
         n
    from qualificador.campo_filtravel c
    cross join _cob d
   group by c.id;

  return query
    select cc.campo_id, cc.com_dado, cc.base from qualificador.cobertura_campo cc;
end $function$;

do $do$
declare f text;
begin
  foreach f in array array[
    'qualificador.garantir_pessoa_dados()',
    'qualificador.medir_cobertura()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $do$;
