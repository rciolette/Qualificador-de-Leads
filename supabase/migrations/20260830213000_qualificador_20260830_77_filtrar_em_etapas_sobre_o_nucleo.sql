-- `filtrar_em_etapas` vira uma casca fina: o núcleo `filtrar` decide quem sai
-- onde, e ela só acrescenta o score. Assim `gerar_lista` e `pessoas_da_etapa`
-- herdam a mesma foto materializada, em vez de cada uma remontar o objeto.
--
-- NOTA: as migrations 78 e 79 corrigem o plano desta consulta. O corpo final
-- está na 79.
create or replace function qualificador.filtrar_em_etapas(p_etapas jsonb, p_config jsonb default '{}'::jsonb)
returns table(pessoa_id uuid, ordem integer, etapa text, rotulo text, score numeric, faixa text, eixos jsonb)
language plpgsql
volatile
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  pesos jsonb := coalesce(p_config->'pesos', '{}'::jsonb);
begin
  return query
  select f.pessoa_id, f.ordem, f.etapa, f.rotulo,
         qualificador.aplicar_pesos(e.eixos, pesos),
         qualificador.faixa_de(qualificador.aplicar_pesos(e.eixos, pesos)),
         e.eixos
  from qualificador.filtrar(p_etapas, p_config) f
  join lateral (
    select jsonb_build_object(
      'relacao_comercial', s.relacao_comercial, 'recencia_compra', s.recencia_compra,
      'valor_historico', s.valor_historico, 'engajamento_conteudo', s.engajamento_conteudo,
      'nivel_memberkit', s.nivel_memberkit, 'posse_produto', s.posse_produto,
      'saude_disparo', s.saude_disparo, 'leadscore', s.leadscore) as eixos
    from qualificador.v_eixos_score s where s.pessoa_id = f.pessoa_id
  ) e on true;
end $function$;

revoke execute on function qualificador.filtrar_em_etapas(jsonb, jsonb) from public, anon;
grant execute on function qualificador.filtrar_em_etapas(jsonb, jsonb) to authenticated, service_role;
