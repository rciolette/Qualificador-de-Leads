-- `v_eixos_score` custa 369 ms quando o planner pode escolher hash join, e 4 s
-- quando escolhe nested loop e executa a view uma vez por pessoa.
--
-- O que decide é a estatística: uma temp table recém-criada não tem nenhuma, e
-- o planner assume que ela é minúscula. `analyze` custa milissegundos e muda o
-- plano inteiro. Mesma armadilha vale para qualquer temp table grande que
-- alimente um join aqui.
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
  analyze _fe;   -- sem isto o planner acha que _fe tem ~1 linha e vai de nested loop

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
