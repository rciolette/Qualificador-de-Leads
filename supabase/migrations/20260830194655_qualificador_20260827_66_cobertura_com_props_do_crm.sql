-- A medição da 64/65 dava 0% para TODOS os 14 campos nativos do HubSpot,
-- inclusive `caixa_disponivel` e `renda_mensal`, que estão medidos e preenchidos
-- no banco. O motor não estava errado: `v_pessoa_completa` simplesmente não tem
-- as colunas `props` / `props_deals` — quem as junta é `filtrar_em_etapas`, que
-- monta `to_jsonb(v) || props || props_deals` do `crm_snapshot`.
--
-- A medição precisa montar o MESMO objeto que o funil julga, senão ela mede uma
-- coisa e o filtro faz outra — e o aviso de cobertura, que existe justamente
-- para dar confiança, mentiria com 0%.
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

  -- o mesmo objeto que `filtrar_em_etapas` monta, pelo mesmo motivo
  create temp table _cob on commit drop as
    select to_jsonb(v)
             || jsonb_build_object('props',       coalesce(c.props, '{}'::jsonb))
             || jsonb_build_object('props_deals', coalesce(c.props_deals, '{}'::jsonb)) as j
      from qualificador.v_pessoa_completa v
      left join qualificador.crm_snapshot c on c.pessoa_id = v.pessoa_id;
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
