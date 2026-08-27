-- Qualificador de Leads ROI · migration 32
-- O funil como a tela precisa: TODAS as etapas, inclusive as que não removeram
-- ninguém. Etapa com zero é informação — significa "este filtro não está fazendo
-- nada", e some justamente quando você precisaria vê-la para retirá-la.

create or replace function qualificador.funil(
  p_etapas jsonb, p_config jsonb default '{}'::jsonb)
returns table (
  ordem int, etapa text, rotulo text, bloqueio_duro boolean,
  saem_aqui bigint, restam bigint
)
language plpgsql volatile
set search_path = qualificador, pg_catalog
as $fn$
declare
  universo bigint;
  pular boolean := coalesce((p_config->>'pular_bloqueio_duro')::boolean, false);
  fadiga int := coalesce((p_config->>'anti_fadiga_dias')::int, 7);
  perdido int := coalesce((p_config->>'excluir_perdido_dias')::int, 15);
begin
  create temp table _res on commit drop as
  select r.pessoa_id, r.ordem, r.etapa, r.rotulo
  from qualificador.filtrar_em_etapas(p_etapas, p_config) r;

  select count(*) into universo from _res;

  return query
  with etapas_previstas as (
    -- bloqueio duro: sempre nesta ordem, sempre visível
    select * from (values
      (1,'sem_telefone','sem telefone válido',true),
      (2,'optout_whats','opt-out de WhatsApp',true),
      (3,'novos_em_conexao','Novos / Em conexão',true),
      (4,'falha_de_entrega','falha de entrega',true),
      (5,'perdido_na_cadencia','perdido na cadência',true),
      (6,'perdido_recente', format('perdido há ≤ %s dias', perdido), true),
      (7,'disparo_sem_conexao','disparo anterior sem conexão',true),
      (8,'anti_fadiga', format('anti-fadiga · %s dias', fadiga), true)
    ) as b(ordem, etapa, rotulo, bloqueio) where not pular
    union all
    -- etapas montadas na tela, na ordem em que foram empilhadas
    select (9 + e.ord)::int,
           coalesce(e.valor->>'id', 'etapa_' || (9 + e.ord)),
           coalesce(nullif(e.valor->>'rotulo',''), 'etapa ' || e.ord),
           false
    from jsonb_array_elements(coalesce(p_etapas, '[]'::jsonb))
         with ordinality as e(valor, ord)
    where coalesce((e.valor->>'ativa')::boolean, true)
  ),
  contagem as (
    select p.ordem, p.etapa, p.rotulo, p.bloqueio,
           coalesce((select count(*) from _res r where r.ordem = p.ordem), 0) as saem
    from etapas_previstas p
  )
  select c.ordem, c.etapa, c.rotulo, c.bloqueio, c.saem,
         universo - sum(c.saem) over (order by c.ordem
                                      rows between unbounded preceding and current row) as restam
  from contagem c
  union all
  select 999, 'lista_final', '= LISTA FINAL', false,
         (select count(*) from _res where ordem is null),
         (select count(*) from _res where ordem is null)
  order by 1;
end $fn$;

comment on function qualificador.funil(jsonb, jsonb) is
  'Funil pronto para a tela: uma linha por etapa, com quantos saíram e quantos
   restam. Etapas com zero aparecem — some justamente a informação de que o
   filtro não está fazendo nada.';

revoke execute on function qualificador.funil(jsonb, jsonb) from public, anon;
grant execute on function qualificador.funil(jsonb, jsonb) to authenticated, service_role;
