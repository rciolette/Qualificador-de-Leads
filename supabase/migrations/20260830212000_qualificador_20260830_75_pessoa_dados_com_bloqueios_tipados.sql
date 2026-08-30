-- Os 7 bloqueios duros custavam 1.514 ms dos 1.632 ms do funil -- e não era o
-- volume: o `EXISTS` do anti-fadiga, que parecia o suspeito, custa 7,7 ms.
--
-- São `como_bool` / `como_ts`. As duas são plpgsql com `exception when others
-- then return null`, e no Postgres um bloco de exceção abre uma SUBTRANSAÇÃO
-- por chamada. Com 4.430 pessoas x 7 campos são ~31 mil subtransações a cada
-- clique -- para converter texto que não muda entre um clique e outro.
--
-- Elas continuam existindo e continuam certas: cast tolerante é exatamente o
-- que se quer para dado vindo de API (seção 5 do CLAUDE.md). O que muda é
-- QUANDO são chamadas -- uma vez, ao materializar a foto, e não a cada
-- recálculo. As colunas tipadas ficam gravadas.

alter table qualificador.pessoa_dados
  add column if not exists telefone_e164        text,
  add column if not exists unsub_whats          boolean,
  add column if not exists em_cadencia_auto     boolean,
  add column if not exists falha_sellflux       boolean,
  add column if not exists perdido_na_cadencia  boolean,
  add column if not exists perdido_em           timestamptz,
  add column if not exists cadencia_iniciada    boolean,
  add column if not exists conectou             boolean,
  add column if not exists whats_preferencial   text;

comment on column qualificador.pessoa_dados.perdido_em is
  'Já tipado. A janela (excluir_perdido_dias) continua sendo parâmetro de '
  'consulta -- o que sai do caminho quente é o cast, não a comparação.';

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

  delete from qualificador.pessoa_dados;
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

revoke execute on function qualificador.garantir_pessoa_dados() from public, anon;
grant execute on function qualificador.garantir_pessoa_dados() to authenticated, service_role;

update qualificador.pessoa_dados_estado set suja = true;
