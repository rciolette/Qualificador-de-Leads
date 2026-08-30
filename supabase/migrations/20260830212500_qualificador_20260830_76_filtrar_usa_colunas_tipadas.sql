-- O CASE do bloqueio duro passa a comparar colunas tipadas, sem chamar função
-- nenhuma. O cast tolerante já aconteceu na materialização (migration 75).
--
-- Resultado da série 71-76, com a foto quente: 6.029 ms -> 384 ms.
create or replace function qualificador.filtrar(p_etapas jsonb, p_config jsonb default '{}'::jsonb)
returns table (pessoa_id uuid, ordem integer, etapa text, rotulo text)
language plpgsql
volatile
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  i int := 10;
  et jsonb;
  perdido_dias int := coalesce((p_config->>'excluir_perdido_dias')::int, 15);
  fadiga_dias  int := coalesce((p_config->>'anti_fadiga_dias')::int, 7);
  times text[] := qualificador.txt_array(p_config->'times');
  pular_bloqueio boolean := coalesce((p_config->>'pular_bloqueio_duro')::boolean, false);
  tem_foto boolean;
begin
  p_etapas := qualificador.resolver_etapas(p_etapas);
  tem_foto := qualificador.garantir_pessoa_dados();

  drop table if exists _et;   -- reentrante: a mesma transação pode chamar duas vezes

  if tem_foto then
    create temp table _et on commit drop as
      select d.pessoa_id, d.dados,
             case when not pular_bloqueio then
               case
                 when d.telefone_e164 is null            then 1
                 when d.unsub_whats                      then 2
                 when d.em_cadencia_auto                 then 3
                 when d.falha_sellflux                   then 4
                 when d.perdido_na_cadencia              then 5
                 when d.perdido_em > now() - make_interval(days => perdido_dias) then 6
                 when d.cadencia_iniciada and d.conectou is false then 7
                 when exists (
                   select 1 from qualificador.disparo_registro dr
                    where dr.pessoa_id = d.pessoa_id
                      and dr.data_do_disparo > current_date - fadiga_dias
                      and (times is null or dr.time::text = any (times))
                      and (d.whats_preferencial is null
                           or dr.numero_whats = d.whats_preferencial)) then 8
               end
             end as saida
        from qualificador.pessoa_dados d;
  else
    -- sem permissão de reconstruir a foto: monta e converte na hora. Lento
    -- (~2,2 s + os casts), mas correto -- devolver a foto velha seria devolver
    -- número errado.
    create temp table _et on commit drop as
      select v.pessoa_id,
             to_jsonb(v)
               || jsonb_build_object('props',       coalesce(c.props, '{}'::jsonb))
               || jsonb_build_object('props_deals', coalesce(c.props_deals, '{}'::jsonb)) as dados,
             null::int as saida
        from qualificador.v_pessoa_completa v
        left join qualificador.crm_snapshot c on c.pessoa_id = v.pessoa_id;
    if not pular_bloqueio then
      update _et set saida = case
        when dados->>'telefone_e164' is null then 1
        when coalesce(qualificador.como_bool(dados->>'unsub_whats'), false) then 2
        when coalesce(qualificador.como_bool(dados->>'em_cadencia_automatica'), false) then 3
        when coalesce(qualificador.como_bool(dados->>'falha_sellflux'), false) then 4
        when coalesce(qualificador.como_bool(dados->>'perdido_na_cadencia'), false) then 5
        when qualificador.como_ts(dados->>'perdido_em')
             > now() - make_interval(days => perdido_dias) then 6
        when coalesce(qualificador.como_bool(dados->>'cadencia_iniciada'), false)
             and qualificador.como_bool(dados->>'conectou') is false then 7
        when exists (
          select 1 from qualificador.disparo_registro dr
           where dr.pessoa_id = _et.pessoa_id
             and dr.data_do_disparo > current_date - fadiga_dias
             and (times is null or dr.time::text = any (times))
             and (_et.dados->>'preferential_whats_id' is null
                  or dr.numero_whats = _et.dados->>'preferential_whats_id')) then 8
        else null end;
    end if;
  end if;

  for et in select value from jsonb_array_elements(coalesce(p_etapas, '[]'::jsonb)) loop
    if coalesce((et->>'ativa')::boolean, true) then
      update _et set saida = i
       where saida is null and not qualificador.campo_bate(dados, et);
    end if;
    i := i + 1;
  end loop;

  drop table if exists _rot;
  create temp table _rot on commit drop as
    select * from (values
      (1,'sem_telefone','sem telefone válido'),
      (2,'optout_whats','opt-out de WhatsApp'),
      (3,'novos_em_conexao','Novos / Em conexão'),
      (4,'falha_de_entrega','falha de entrega'),
      (5,'perdido_na_cadencia','perdido na cadência'),
      (6,'perdido_recente', format('perdido há ≤ %s dias', perdido_dias)),
      (7,'disparo_sem_conexao','disparo anterior sem conexão'),
      (8,'anti_fadiga', format('anti-fadiga · %s dias', fadiga_dias))
    ) as b(o, e, r)
    union all
    select (9 + x.ord)::int,
           coalesce(x.valor->>'id', 'etapa_' || (9 + x.ord)),
           coalesce(nullif(x.valor->>'rotulo',''), 'etapa ' || x.ord)
      from jsonb_array_elements(coalesce(p_etapas,'[]'::jsonb)) with ordinality x(valor, ord);

  return query
  select f.pessoa_id, f.saida, r.e, r.r
    from _et f left join _rot r on r.o = f.saida;
end $function$;

revoke execute on function qualificador.filtrar(jsonb, jsonb) from public, anon;
grant execute on function qualificador.filtrar(jsonb, jsonb) to authenticated, service_role;
