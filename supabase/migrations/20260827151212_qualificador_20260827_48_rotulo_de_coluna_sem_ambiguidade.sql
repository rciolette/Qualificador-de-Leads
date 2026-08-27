-- "Dias sem acessar" existe na MemberClass E no MemberKit. Marcadas as duas, o
-- cabeçalho saía com a mesma palavra repetida e ninguém sabia qual era qual.
-- Quando o rótulo se repete no catálogo, ele passa a carregar a plataforma.
create or replace function qualificador.resolver_colunas(p_colunas jsonb)
returns jsonb
language sql
stable
set search_path to 'qualificador', 'pg_catalog'
as $$
  with repetidos as (
    select rotulo from qualificador.campo_filtravel
    group by rotulo having count(*) > 1
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', c.id,
             'rotulo', case when c.rotulo in (select rotulo from repetidos)
                            -- "IniciAmazon (MemberClass)" vira só "MemberClass"
                            then c.rotulo || ' · ' ||
                                 coalesce(substring(c.grupo from '\((.*)\)'), c.grupo, c.fonte)
                            else c.rotulo end,
             'caminho', c.caminho,
             'fonte', c.fonte, 'tipo', c.tipo,
             'nativo', c.fonte in ('hubspot_contato', 'hubspot_negocio'))
           order by x.ord), '[]'::jsonb)
  from jsonb_array_elements_text(coalesce(p_colunas, '[]'::jsonb))
       with ordinality as x(cid, ord)
  join qualificador.campo_filtravel c on c.id = x.cid
$$;

-- CREATE OR REPLACE devolve EXECUTE para PUBLIC — ver seção 5 do CLAUDE.md.
revoke execute on function qualificador.resolver_colunas(jsonb) from public, anon;
grant execute on function qualificador.resolver_colunas(jsonb) to authenticated, service_role;
