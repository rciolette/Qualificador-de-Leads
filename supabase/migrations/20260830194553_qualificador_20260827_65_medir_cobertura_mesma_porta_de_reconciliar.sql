-- `medir_cobertura` barrava também quem chega sem sessão — service_role, Edge
-- Function, psql — e é exatamente por aí que a medição roda depois de um sync.
-- O precedente do repo é `reconciliar`: a checagem de papel só vale quando HÁ
-- sessão; sem `auth.uid()` quem chamou já passou por uma porta privilegiada.
create or replace function qualificador.medir_cobertura()
returns table (campo_id text, com_dado bigint, base bigint)
language plpgsql
volatile
security definer
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  n bigint;
begin
  if auth.uid() is not null
     and not qualificador.has_min_papel('operador'::qualificador.papel) then
    raise exception 'sem permissão para medir cobertura';
  end if;

  create temp table _cob on commit drop as
    select to_jsonb(v) j from qualificador.v_pessoa_completa v;
  select count(*) into n from _cob;

  delete from qualificador.cobertura_campo;

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

revoke execute on function qualificador.medir_cobertura() from public, anon;
grant execute on function qualificador.medir_cobertura() to authenticated, service_role;
