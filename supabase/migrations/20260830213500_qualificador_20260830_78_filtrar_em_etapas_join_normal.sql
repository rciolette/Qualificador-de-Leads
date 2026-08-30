-- O `join lateral` com `v_eixos_score` custava 4,1 s. `filtrar()` é um function
-- scan sem estatísticas, então o planner escolhia nested loop e executava a view
-- inteira uma vez POR PESSOA. Com join normal ele pode fazer hash join -- a
-- mesma view custa 369 ms quando planejada assim.
--
-- E `aplicar_pesos` era chamada duas vezes por linha (uma para o score, outra
-- dentro de `faixa_de`). Agora é uma, num lateral que só calcula.
--
-- NOTA: só isto não bastou (4.031 ms). Faltava o `analyze` da migration 79.
create or replace function qualificador.filtrar_em_etapas(p_etapas jsonb, p_config jsonb default '{}'::jsonb)
returns table(pessoa_id uuid, ordem integer, etapa text, rotulo text, score numeric, faixa text, eixos jsonb)
language plpgsql
volatile
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  pesos jsonb := coalesce(p_config->'pesos', '{}'::jsonb);
begin
  drop table if exists _fe;
  create temp table _fe on commit drop as
    select * from qualificador.filtrar(p_etapas, p_config);

  return query
  select f.pessoa_id, f.ordem, f.etapa, f.rotulo, c.sc,
         qualificador.faixa_de(c.sc), e.eixos
  from _fe f
  join qualificador.v_eixos_score s on s.pessoa_id = f.pessoa_id
  cross join lateral (
    select jsonb_build_object(
      'relacao_comercial', s.relacao_comercial, 'recencia_compra', s.recencia_compra,
      'valor_historico', s.valor_historico, 'engajamento_conteudo', s.engajamento_conteudo,
      'nivel_memberkit', s.nivel_memberkit, 'posse_produto', s.posse_produto,
      'saude_disparo', s.saude_disparo, 'leadscore', s.leadscore) as eixos
  ) e
  cross join lateral (select qualificador.aplicar_pesos(e.eixos, pesos) as sc) c;
end $function$;

revoke execute on function qualificador.filtrar_em_etapas(jsonb, jsonb) from public, anon;
grant execute on function qualificador.filtrar_em_etapas(jsonb, jsonb) to authenticated, service_role;
