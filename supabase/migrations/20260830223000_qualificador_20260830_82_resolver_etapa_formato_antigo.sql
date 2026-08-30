-- REGRESSÃO introduzida pela migration 67, encontrada ao conferir o aceite da
-- iniciativa "Corujão · recuperar perdido": ela abria com 3 etapas e devolvia
-- 2.443 -- exatamente a base sem filtro nenhum.
--
-- `resolver_etapa` decidia o ramo com
--
--     when jsonb_typeof(p_etapa->'condicoes') <> 'array' then ...
--
-- Numa etapa do formato antigo não existe a chave `condicoes`, então
-- `jsonb_typeof` devolve NULL, e `NULL <> 'array'` é **NULL, não TRUE**. O CASE
-- caía no ELSE, que agrega `jsonb_array_elements(NULL)` -- zero linhas, logo
-- `coalesce(..., '[]')` -- e a etapa saía com `"condicoes": []`. `campo_bate`
-- então via uma etapa sem condição e deixava todo mundo passar.
--
-- O efeito era exatamente o que este schema mais teme: TODA etapa salva no
-- formato antigo parou de filtrar, sem erro, sem aviso, e com a etapa ainda
-- listada na tela como se estivesse valendo.
--
-- `is distinct from` é o comparador que trata NULL como valor.
create or replace function qualificador.resolver_etapa(p_etapa jsonb)
returns jsonb
language sql
stable
set search_path to 'qualificador', 'pg_catalog'
as $function$
  select case
    -- formato antigo: a própria etapa é a condição.
    -- `is distinct from` e não `<>`: sem a chave `condicoes`, `jsonb_typeof`
    -- devolve NULL e `<>` devolveria NULL em vez de TRUE.
    when jsonb_typeof(p_etapa->'condicoes') is distinct from 'array' then
      p_etapa || jsonb_build_object('condicoes',
        jsonb_build_array(qualificador.resolver_condicao(p_etapa)))
    else
      p_etapa || jsonb_build_object('condicoes', coalesce((
        select jsonb_agg(qualificador.resolver_condicao(c.value) order by c.ord)
          from jsonb_array_elements(p_etapa->'condicoes') with ordinality c(value, ord)
      ), '[]'::jsonb))
  end
$function$;

revoke execute on function qualificador.resolver_etapa(jsonb) from public, anon;
grant execute on function qualificador.resolver_etapa(jsonb) to authenticated, service_role;
