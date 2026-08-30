-- `medir_cobertura` era SECURITY DEFINER só porque `cobertura_campo` tinha
-- policy de SELECT e nada mais — o insert/delete da própria medição batia na
-- RLS. Isso levantou o alerta `authenticated_security_definer_function_executable`,
-- e o repo tem por regra fechar tarefa com zero alerta citando `qualificador`.
--
-- A saída certa não é revogar a execução: é a tabela ter a policy que descreve
-- quem pode remedir. Com ela, a função vira INVOKER e a RLS decide — em vez de
-- a função decidir por conta própria com um `raise exception` que replicava a
-- regra num segundo lugar.
drop policy if exists cobertura_campo_operador on qualificador.cobertura_campo;
create policy cobertura_campo_operador on qualificador.cobertura_campo
  for all to authenticated
  using (qualificador.has_min_papel('operador'::qualificador.papel))
  with check (qualificador.has_min_papel('operador'::qualificador.papel));

grant insert, delete on qualificador.cobertura_campo to authenticated;

create or replace function qualificador.medir_cobertura()
returns table (campo_id text, com_dado bigint, base bigint)
language plpgsql
volatile
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  n bigint;
begin
  -- o mesmo objeto que `filtrar_em_etapas` monta: medir contra um objeto
  -- diferente do que o funil julga faria o aviso de cobertura mentir
  create temp table _cob on commit drop as
    select to_jsonb(v)
             || jsonb_build_object('props',       coalesce(c.props, '{}'::jsonb))
             || jsonb_build_object('props_deals', coalesce(c.props_deals, '{}'::jsonb)) as j
      from qualificador.v_pessoa_completa v
      left join qualificador.crm_snapshot c on c.pessoa_id = v.pessoa_id;
  select count(*) into n from _cob;

  -- foto, não histórico. Sem papel de operador, a RLS barra aqui.
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

-- INVOKER: revogar de `authenticated` aqui quebraria quem chama (migration 41)
revoke execute on function qualificador.medir_cobertura() from public, anon;
grant execute on function qualificador.medir_cobertura() to authenticated, service_role;
