-- Qualificador de Leads ROI · migration 33
-- "ordem" é ao mesmo tempo coluna de retorno da função e coluna das CTEs.
-- #variable_conflict use_column resolve a favor da coluna, que é o que se quer aqui.

create or replace function qualificador.funil(
  p_etapas jsonb, p_config jsonb default '{}'::jsonb)
returns table (
  ordem int, etapa text, rotulo text, bloqueio_duro boolean,
  saem_aqui bigint, restam bigint
)
language plpgsql volatile
set search_path = qualificador, pg_catalog
as $fn$
#variable_conflict use_column
declare
  v_universo bigint;
  v_pular   boolean := coalesce((p_config->>'pular_bloqueio_duro')::boolean, false);
  v_fadiga  int     := coalesce((p_config->>'anti_fadiga_dias')::int, 7);
  v_perdido int     := coalesce((p_config->>'excluir_perdido_dias')::int, 15);
begin
  create temp table _res on commit drop as
  select r.pessoa_id, r.ordem as saida
  from qualificador.filtrar_em_etapas(p_etapas, p_config) r;

  select count(*) into v_universo from _res;

  return query
  with previstas as (
    select * from (values
      (1,'sem_telefone','sem telefone válido',true),
      (2,'optout_whats','opt-out de WhatsApp',true),
      (3,'novos_em_conexao','Novos / Em conexão',true),
      (4,'falha_de_entrega','falha de entrega',true),
      (5,'perdido_na_cadencia','perdido na cadência',true),
      (6,'perdido_recente', format('perdido há ≤ %s dias', v_perdido), true),
      (7,'disparo_sem_conexao','disparo anterior sem conexão',true),
      (8,'anti_fadiga', format('anti-fadiga · %s dias', v_fadiga), true)
    ) as b(o, e, r, bd) where not v_pular
    union all
    select (9 + x.ord)::int,
           coalesce(x.valor->>'id', 'etapa_' || (9 + x.ord)),
           coalesce(nullif(x.valor->>'rotulo',''), 'etapa ' || x.ord),
           false
    from jsonb_array_elements(coalesce(p_etapas, '[]'::jsonb)) with ordinality as x(valor, ord)
    where coalesce((x.valor->>'ativa')::boolean, true)
  ),
  contado as (
    select p.o, p.e, p.r, p.bd,
           coalesce((select count(*) from _res s where s.saida = p.o), 0) as saem
    from previstas p
  ),
  final as (
    select c.o, c.e, c.r, c.bd, c.saem,
           v_universo - sum(c.saem) over (order by c.o
                                          rows between unbounded preceding and current row) as restam
    from contado c
    union all
    select 999, 'lista_final', '= LISTA FINAL', false,
           (select count(*) from _res where saida is null),
           (select count(*) from _res where saida is null)
  )
  select f.o::int, f.e::text, f.r::text, f.bd::boolean, f.saem::bigint, f.restam::bigint
  from final f order by f.o;
end $fn$;

revoke execute on function qualificador.funil(jsonb, jsonb) from public, anon;
grant execute on function qualificador.funil(jsonb, jsonb) to authenticated, service_role;
