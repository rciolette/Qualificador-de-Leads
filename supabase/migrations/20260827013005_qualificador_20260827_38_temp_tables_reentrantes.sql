-- Qualificador de Leads ROI · migration 38
-- "relation _et already exists": on commit drop só apaga no fim da TRANSAÇÃO,
-- e gerar_lista chama funil() e filtrar_em_etapas() na mesma transação.
-- A segunda chamada encontrava a temp table da primeira.
--
-- Drop explícito antes de criar torna as funções reentrantes.

create or replace function qualificador.filtrar_em_etapas(
  p_etapas jsonb, p_config jsonb default '{}'::jsonb)
returns table (
  pessoa_id uuid, ordem int, etapa text, rotulo text,
  score numeric, faixa text, eixos jsonb
)
language plpgsql volatile
set search_path = qualificador, pg_catalog
as $fn$
declare
  i int := 10;
  et jsonb;
  pesos jsonb := coalesce(p_config->'pesos', '{}'::jsonb);
  perdido_dias int := coalesce((p_config->>'excluir_perdido_dias')::int, 15);
  fadiga_dias  int := coalesce((p_config->>'anti_fadiga_dias')::int, 7);
  times text[] := qualificador.txt_array(p_config->'times');
  pular_bloqueio boolean := coalesce((p_config->>'pular_bloqueio_duro')::boolean, false);
begin
  drop table if exists _et;   -- reentrante: a mesma transação pode chamar duas vezes
  create temp table _et on commit drop as
  select v.pessoa_id,
         to_jsonb(v)
           || jsonb_build_object('props',       coalesce(c.props, '{}'::jsonb))
           || jsonb_build_object('props_deals', coalesce(c.props_deals, '{}'::jsonb)) as dados,
         null::int as saida, null::text as etapa_nome, null::text as etapa_rotulo
  from qualificador.v_pessoa_completa v
  left join qualificador.crm_snapshot c on c.pessoa_id = v.pessoa_id;

  if not pular_bloqueio then
    update _et set saida = 1, etapa_nome = 'sem_telefone', etapa_rotulo = 'sem telefone válido'
     where saida is null and dados->>'telefone_e164' is null;
    update _et set saida = 2, etapa_nome = 'optout_whats', etapa_rotulo = 'opt-out de WhatsApp'
     where saida is null and coalesce(qualificador.como_bool(dados->>'unsub_whats'), false);
    update _et set saida = 3, etapa_nome = 'novos_em_conexao', etapa_rotulo = 'Novos / Em conexão'
     where saida is null and coalesce(qualificador.como_bool(dados->>'em_cadencia_automatica'), false);
    update _et set saida = 4, etapa_nome = 'falha_de_entrega', etapa_rotulo = 'falha de entrega'
     where saida is null and coalesce(qualificador.como_bool(dados->>'falha_sellflux'), false);
    update _et set saida = 5, etapa_nome = 'perdido_na_cadencia', etapa_rotulo = 'perdido na cadência'
     where saida is null and coalesce(qualificador.como_bool(dados->>'perdido_na_cadencia'), false);
    update _et set saida = 6, etapa_nome = 'perdido_recente',
                   etapa_rotulo = format('perdido há ≤ %s dias', perdido_dias)
     where saida is null
       and qualificador.como_ts(dados->>'perdido_em') > now() - make_interval(days => perdido_dias);
    update _et set saida = 7, etapa_nome = 'disparo_sem_conexao', etapa_rotulo = 'disparo anterior sem conexão'
     where saida is null and coalesce(qualificador.como_bool(dados->>'cadencia_iniciada'), false)
       and qualificador.como_bool(dados->>'conectou') is false;
    update _et set saida = 8, etapa_nome = 'anti_fadiga',
                   etapa_rotulo = format('anti-fadiga · %s dias', fadiga_dias)
     where saida is null and exists (
       select 1 from qualificador.disparo_registro dr
       where dr.pessoa_id = _et.pessoa_id
         and dr.data_do_disparo > current_date - fadiga_dias
         and (times is null or dr.time::text = any (times))
         and (_et.dados->>'preferential_whats_id' is null
              or dr.numero_whats = _et.dados->>'preferential_whats_id'));
  end if;

  for et in select value from jsonb_array_elements(coalesce(p_etapas, '[]'::jsonb)) loop
    if coalesce((et->>'ativa')::boolean, true) then
      update _et set saida = i,
                     etapa_nome = coalesce(et->>'id', 'etapa_' || i),
                     etapa_rotulo = coalesce(nullif(et->>'rotulo',''), 'etapa ' || (i - 9))
       where saida is null and not qualificador.campo_bate(dados, et);
    end if;
    i := i + 1;
  end loop;

  return query
  select f.pessoa_id, f.saida, f.etapa_nome, f.etapa_rotulo,
         qualificador.aplicar_pesos(e.eixos, pesos),
         qualificador.faixa_de(qualificador.aplicar_pesos(e.eixos, pesos)),
         e.eixos
  from _et f
  join lateral (
    select jsonb_build_object(
      'relacao_comercial', s.relacao_comercial, 'recencia_compra', s.recencia_compra,
      'valor_historico', s.valor_historico, 'engajamento_conteudo', s.engajamento_conteudo,
      'nivel_memberkit', s.nivel_memberkit, 'posse_produto', s.posse_produto,
      'saude_disparo', s.saude_disparo, 'leadscore', s.leadscore) as eixos
    from qualificador.v_eixos_score s where s.pessoa_id = f.pessoa_id
  ) e on true;
end $fn$;

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
  drop table if exists _res;
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

revoke execute on function qualificador.filtrar_em_etapas(jsonb, jsonb) from public, anon;
revoke execute on function qualificador.funil(jsonb, jsonb) from public, anon;
grant execute on function qualificador.filtrar_em_etapas(jsonb, jsonb),
                          qualificador.funil(jsonb, jsonb) to authenticated, service_role;
