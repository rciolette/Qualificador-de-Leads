-- Uma etapa ignorada some do cálculo, mas não pode sumir da tela: quem montou
-- meia etapa precisa ver que ela não está valendo. Sem isso o comportamento
-- certo (não cortar ninguém) fica indistinguível de uma etapa que simplesmente
-- não filtrou nada.
--
-- `ignorada` entra no retorno, então é drop + create: `create or replace` não
-- muda a lista de colunas de um RETURNS TABLE.
drop function if exists qualificador.funil(jsonb, jsonb);

create function qualificador.funil(p_etapas jsonb, p_config jsonb default '{}'::jsonb)
returns table (
  ordem integer, etapa text, rotulo text, bloqueio_duro boolean,
  saem_aqui bigint, restam bigint, ignorada boolean
)
language plpgsql
set search_path to 'qualificador', 'pg_catalog'
as $function$
#variable_conflict use_column
declare
  v_universo bigint;
  v_pular   boolean := coalesce((p_config->>'pular_bloqueio_duro')::boolean, false);
  v_fadiga  int     := coalesce((p_config->>'anti_fadiga_dias')::int, 7);
  v_perdido int     := coalesce((p_config->>'excluir_perdido_dias')::int, 15);
  v_resolvidas jsonb := qualificador.resolver_etapas(p_etapas);
begin
  drop table if exists _res;
  create temp table _res on commit drop as
  select r.pessoa_id, r.ordem as saida
  from qualificador.filtrar_em_etapas(p_etapas, p_config) r;

  select count(*) into v_universo from _res;

  return query
  with previstas as (
    select * from (values
      (1,'sem_telefone','sem telefone válido',true,false),
      (2,'optout_whats','opt-out de WhatsApp',true,false),
      (3,'novos_em_conexao','Novos / Em conexão',true,false),
      (4,'falha_de_entrega','falha de entrega',true,false),
      (5,'perdido_na_cadencia','perdido na cadência',true,false),
      (6,'perdido_recente', format('perdido há ≤ %s dias', v_perdido), true,false),
      (7,'disparo_sem_conexao','disparo anterior sem conexão',true,false),
      (8,'anti_fadiga', format('anti-fadiga · %s dias', v_fadiga), true,false)
    ) as b(o, e, r, bd, ig) where not v_pular
    union all
    select (9 + x.ord)::int,
           coalesce(x.valor->>'id', 'etapa_' || (9 + x.ord)),
           coalesce(nullif(x.valor->>'rotulo',''), 'etapa ' || x.ord),
           false,
           qualificador.etapa_ignorada(x.valor)
    from jsonb_array_elements(v_resolvidas) with ordinality as x(valor, ord)
    where coalesce((x.valor->>'ativa')::boolean, true)
  ),
  contado as (
    select p.o, p.e, p.r, p.bd, p.ig,
           coalesce((select count(*) from _res s where s.saida = p.o), 0) as saem
    from previstas p
  ),
  final as (
    select c.o, c.e, c.r, c.bd, c.ig, c.saem,
           v_universo - sum(c.saem) over (order by c.o
                                          rows between unbounded preceding and current row) as restam
    from contado c
    union all
    select 999, 'lista_final', '= LISTA FINAL', false, false,
           (select count(*) from _res where saida is null),
           (select count(*) from _res where saida is null)
  )
  select f.o::int, f.e::text, f.r::text, f.bd::boolean,
         f.saem::bigint, f.restam::bigint, f.ig::boolean
  from final f order by f.o;
end $function$;

revoke execute on function qualificador.funil(jsonb, jsonb) from public, anon;
grant execute on function qualificador.funil(jsonb, jsonb) to authenticated, service_role;
