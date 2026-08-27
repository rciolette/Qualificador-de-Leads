-- Os 14 campos nativos catalogados na migration 53 são `enum` na tela: o
-- construtor pede as opções a `valores_do_campo` em vez de exigir digitação
-- exata. Mas ela só lia `v_pessoa_completa` — para property crua do HubSpot o
-- seletor viria VAZIO, e o usuário concluiria que a fonte não sincronizou.
--
-- Passa a receber a fonte. Sem ela, o comportamento é o de sempre.
drop function if exists qualificador.valores_do_campo(text, integer);

create function qualificador.valores_do_campo(
  p_caminho text, p_limite integer default 200, p_fonte text default null
)
returns table(valor text, pessoas bigint)
language plpgsql
stable
set search_path to 'qualificador', 'pg_catalog'
as $function$
begin
  -- property do NEGÓCIO: uma pessoa contribui com os valores dos N negócios dela
  if p_fonte = 'hubspot_negocio' then
    return query
    select x.item, count(distinct c.pessoa_id)
    from qualificador.crm_snapshot c,
         lateral jsonb_each(coalesce(c.props_deals, '{}'::jsonb)) n,
         lateral (select n.value ->> p_caminho as item) x
    where nullif(btrim(x.item), '') is not null
    group by x.item
    order by count(distinct c.pessoa_id) desc, x.item
    limit greatest(1, least(p_limite, 1000));
    return;
  end if;

  -- property do CONTATO
  if p_fonte = 'hubspot_contato' then
    return query
    select c.props ->> p_caminho, count(*)
    from qualificador.crm_snapshot c
    where nullif(btrim(c.props ->> p_caminho), '') is not null
    group by 1
    order by count(*) desc, 1
    limit greatest(1, least(p_limite, 1000));
    return;
  end if;

  -- coluna de v_pessoa_completa, como sempre foi
  return query
  with d as (select to_jsonb(v) as j from qualificador.v_pessoa_completa v),
  bruto as (
    select x.item as v
    from d, lateral jsonb_array_elements_text(
      case when jsonb_typeof(d.j->p_caminho) = 'array' then d.j->p_caminho else '[]'::jsonb end
    ) as x(item)
    union all
    select d.j->>p_caminho from d
    where jsonb_typeof(d.j->p_caminho) not in ('array','null','object') and d.j ? p_caminho
  )
  select b.v, count(*)
  from bruto b
  where nullif(btrim(b.v), '') is not null
  group by b.v
  order by count(*) desc, b.v
  limit greatest(1, least(p_limite, 1000));
end $function$;

revoke execute on function qualificador.valores_do_campo(text, integer, text) from public, anon;
grant execute on function qualificador.valores_do_campo(text, integer, text)
  to authenticated, service_role;
