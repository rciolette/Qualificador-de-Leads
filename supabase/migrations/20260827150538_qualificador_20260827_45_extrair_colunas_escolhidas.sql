-- Resolve os ids de `campo_filtravel` UMA vez por consulta, não por pessoa.
-- Ler a tabela dentro do laço de 1.293 linhas seria o mesmo erro de escala que a
-- Tarefa 0-B corrigiu, só que em SQL em vez de HTTP.
create or replace function qualificador.resolver_colunas(p_colunas jsonb)
returns jsonb
language sql
stable
set search_path to 'qualificador', 'pg_catalog'
as $$
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', c.id, 'rotulo', c.rotulo, 'caminho', c.caminho,
             'fonte', c.fonte, 'tipo', c.tipo,
             -- `nativo` diz se o valor mora em props/props_deals do HubSpot em vez
             -- de numa coluna de v_pessoa_completa. Mesma regra de `campo_bate`.
             'nativo', c.fonte in ('hubspot_contato', 'hubspot_negocio'))
           order by x.ord), '[]'::jsonb)
  from jsonb_array_elements_text(coalesce(p_colunas, '[]'::jsonb))
       with ordinality as x(cid, ord)
  join qualificador.campo_filtravel c on c.id = x.cid
$$;

-- Extrai o valor de um campo do jsonb que `filtrar_em_etapas` já montou.
-- Pura de propósito: nenhuma leitura de tabela, para poder rodar por linha sem custo.
create or replace function qualificador.valor_do_campo(p_dados jsonb, p_spec jsonb)
returns jsonb
language sql
immutable
set search_path to 'pg_catalog'
as $$
  select case
    when coalesce((p_spec->>'nativo')::boolean, false)
      then case when p_spec->>'fonte' = 'hubspot_negocio'
                then p_dados->'props_deals'->(p_spec->>'caminho')
                else p_dados->'props'->(p_spec->>'caminho') end
    else p_dados->(p_spec->>'caminho')
  end
$$;

-- Monta o objeto {id_do_campo: valor} de uma pessoa, para as colunas escolhidas.
create or replace function qualificador.extrair_colunas(p_dados jsonb, p_specs jsonb)
returns jsonb
language sql
immutable
set search_path to 'qualificador', 'pg_catalog'
as $$
  select coalesce(jsonb_object_agg(s->>'id', qualificador.valor_do_campo(p_dados, s)),
                  '{}'::jsonb)
  from jsonb_array_elements(coalesce(p_specs, '[]'::jsonb)) s
$$;

-- Estas três são INVOKER e são chamadas por `pessoas_da_etapa`/`gerar_lista`, que
-- também são INVOKER: sem o grant, o PostgREST devolve 403 na tela inteira.
-- Foi exatamente o que a migration 41 causou com `campo_bate` — ver seção 5 do CLAUDE.md.
revoke execute on function qualificador.resolver_colunas(jsonb) from public, anon;
revoke execute on function qualificador.valor_do_campo(jsonb, jsonb) from public, anon;
revoke execute on function qualificador.extrair_colunas(jsonb, jsonb) from public, anon;
grant execute on function qualificador.resolver_colunas(jsonb) to authenticated, service_role;
grant execute on function qualificador.valor_do_campo(jsonb, jsonb) to authenticated, service_role;
grant execute on function qualificador.extrair_colunas(jsonb, jsonb) to authenticated, service_role;
