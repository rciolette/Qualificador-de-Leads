-- `create temp table` exige função volatile. Marcada stable, a 62 falhava com
-- 0A000 na primeira chamada — a função existia e nunca rodava.
create or replace function qualificador.cobertura_campos()
returns table (campo_id text, com_dado bigint, base bigint)
language plpgsql
volatile
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  n bigint;
begin
  create temp table _cob on commit drop as
    select to_jsonb(v) j from qualificador.v_pessoa_completa v;
  select count(*) into n from _cob;

  return query
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
end $function$;

-- CREATE OR REPLACE devolve EXECUTE a PUBLIC: revogar depois não é opcional
revoke execute on function qualificador.cobertura_campos() from public, anon;
grant execute on function qualificador.cobertura_campos() to authenticated, service_role;
