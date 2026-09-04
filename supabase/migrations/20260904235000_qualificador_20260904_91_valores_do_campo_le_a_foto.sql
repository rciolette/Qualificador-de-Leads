-- "Nenhum valor na base ainda — a fonte pode não ter sincronizado."
--
-- A mensagem estava errada e o conselho que ela dá também: a fonte TINHA
-- sincronizado. `valores_do_campo` lia de `v_pessoa_completa`, e os campos
-- derivados de negócio (`etapas_negocio`, `times_ganho`, `times_perdido`) não
-- moram lá -- moram em `pessoa_dados`, montados por `derivados_negocio`.
--
-- O efeito era pior que um seletor vazio: a condição ficava sem valor, e uma
-- condição sem valor é ignorada pelo motor. A etapa aparecia montada na tela e
-- não filtrava nada.
--
-- A correção é ler da mesma foto que o funil julga. Isso vale para todos os
-- casos, não só os derivados: `pessoa_dados.dados` já contém as colunas da view,
-- as props do contato e as props dos negócios. Uma fonte só, e a garantia de
-- que o seletor oferece exatamente os valores que o filtro sabe encontrar.

create or replace function qualificador.valores_do_campo(
  p_caminho text, p_limite integer default 200, p_fonte text default null)
returns table (valor text, pessoas bigint)
language plpgsql
volatile
set search_path to 'qualificador', 'pg_catalog'
as $function$
begin
  -- a foto precisa existir: é dela que os valores saem
  perform qualificador.garantir_pessoa_dados();

  -- property do NEGÓCIO: uma pessoa contribui com os valores dos N negócios dela
  if p_fonte = 'hubspot_negocio' then
    return query
    select x.item, count(distinct d.pessoa_id)
      from qualificador.pessoa_dados d,
           lateral jsonb_each(coalesce(d.dados->'props_deals', '{}'::jsonb)) n,
           lateral (select n.value ->> p_caminho as item) x
     where nullif(btrim(x.item), '') is not null
     group by x.item
     order by count(distinct d.pessoa_id) desc, x.item
     limit greatest(1, least(p_limite, 1000));
    return;
  end if;

  -- property do CONTATO
  if p_fonte = 'hubspot_contato' then
    return query
    select d.dados->'props' ->> p_caminho, count(*)
      from qualificador.pessoa_dados d
     where nullif(btrim(d.dados->'props' ->> p_caminho), '') is not null
     group by 1
     order by count(*) desc, 1
     limit greatest(1, least(p_limite, 1000));
    return;
  end if;

  -- coluna da view OU campo derivado: os dois vivem na raiz do objeto
  return query
  with bruto as (
    select x.item as v
      from qualificador.pessoa_dados d,
           lateral jsonb_array_elements_text(
             case when jsonb_typeof(d.dados->p_caminho) = 'array'
                  then d.dados->p_caminho else '[]'::jsonb end) as x(item)
    union all
    select d.dados->>p_caminho
      from qualificador.pessoa_dados d
     where jsonb_typeof(d.dados->p_caminho) not in ('array','null','object')
       and d.dados ? p_caminho
  )
  select b.v, count(*)
    from bruto b
   where nullif(btrim(b.v), '') is not null
   group by b.v
   order by count(*) desc, b.v
   limit greatest(1, least(p_limite, 1000));
end $function$;

revoke execute on function qualificador.valores_do_campo(text, integer, text) from public, anon;
grant execute on function qualificador.valores_do_campo(text, integer, text) to authenticated, service_role;
