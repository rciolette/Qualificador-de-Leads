-- `gerar_lista` estourava o statement timeout do PostgREST (8 s) e devolvia
-- HTTP 500 com o código 57014. Não era regressão do motor: a base cresceu de
-- 1.293 para 4.430 pessoas e `filtrar_em_etapas` passou a custar ~4 s sozinho.
--
-- O problema é que `gerar_lista` o rodava DUAS vezes — uma dentro de `funil()`,
-- outra para os itens da lista. Dois filtros idênticos, 8 s, e ainda o subquery
-- de sobreposição por cima.
--
-- Agora roda uma vez, materializa em `_gl`, e tanto o funil quanto os itens
-- saem dela. A sobreposição também deixa de ser subquery por pessoa: vira um
-- agregado calculado uma vez.
create or replace function qualificador.gerar_lista(
  p_iniciativa_id uuid,
  p_etapas jsonb,
  p_config jsonb default '{}'::jsonb,
  p_colunas jsonb default null
)
returns jsonb
language plpgsql
set search_path to 'qualificador', 'pg_catalog'
as $function$
#variable_conflict use_column
declare
  v_lista uuid;
  v_times qualificador.time_comercial[];
  v_prior qualificador.time_comercial[];
  v_total int;
  v_por_time jsonb;
  v_funil jsonb;
  v_specs jsonb := qualificador.resolver_colunas(p_colunas);
  v_universo bigint;
  v_pular   boolean := coalesce((p_config->>'pular_bloqueio_duro')::boolean, false);
  v_fadiga  int     := coalesce((p_config->>'anti_fadiga_dias')::int, 7);
  v_perdido int     := coalesce((p_config->>'excluir_perdido_dias')::int, 15);
begin
  select times, coalesce(prioridade_times, times) into v_times, v_prior
  from qualificador.iniciativa where id = p_iniciativa_id;
  if v_times is null then
    raise exception 'Iniciativa % não encontrada', p_iniciativa_id using errcode = 'no_data_found';
  end if;

  -- UMA passada do motor. Tudo abaixo lê daqui.
  drop table if exists _gl;
  create temp table _gl on commit drop as
  select r.pessoa_id, r.ordem, r.score, r.faixa, r.eixos
  from qualificador.filtrar_em_etapas(p_etapas, p_config) r;

  create index on _gl (ordem);
  select count(*) into v_universo from _gl;

  -- o funil, montado a partir da mesma passada
  select jsonb_agg(to_jsonb(f) order by f.o) into v_funil
  from (
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
             coalesce((select count(*) from _gl s where s.ordem = p.o), 0) as saem
      from previstas p
    )
    select c.o as ordem, c.e as etapa, c.r as rotulo, c.bd as bloqueio_duro,
           c.saem as saem_aqui,
           v_universo - sum(c.saem) over (order by c.o
                          rows between unbounded preceding and current row) as restam,
           c.o
    from contado c
    union all
    select 999, 'lista_final', '= LISTA FINAL', false,
           (select count(*) from _gl where ordem is null),
           (select count(*) from _gl where ordem is null), 999
  ) f;

  insert into qualificador.lista (iniciativa_id, funil, colunas)
  values (p_iniciativa_id, v_funil, v_specs) returning id into v_lista;

  -- sobreposição: quem mais está em lista de iniciativa aberta. Era um subquery
  -- por pessoa; vira um agregado só, calculado uma vez.
  drop table if exists _sobrep;
  create temp table _sobrep on commit drop as
  select li.pessoa_id, array_agg(distinct l.iniciativa_id) as iniciativas
  from qualificador.lista_item li
  join qualificador.lista l      on l.id = li.lista_id
  join qualificador.iniciativa i on i.id = l.iniciativa_id
  where i.aberta and i.id <> p_iniciativa_id
  group by li.pessoa_id;

  create index on _sobrep (pessoa_id);

  -- Divisão por time: sem regra explícita, todos vão para o primeiro da prioridade.
  -- O blueprint é claro que prioridade é parâmetro da base, não hierarquia do sistema.
  insert into qualificador.lista_item
    (lista_id, pessoa_id, time, score, faixa, motivo, sobreposicao, extras)
  select v_lista, g.pessoa_id, v_prior[1], g.score, g.faixa, g.eixos,
         s.iniciativas,
         qualificador.extrair_colunas(d.dados, v_specs)
  from _gl g
  join qualificador.v_dados_pessoa d on d.pessoa_id = g.pessoa_id
  left join _sobrep s on s.pessoa_id = g.pessoa_id
  where g.ordem is null;

  select count(*) into v_total from qualificador.lista_item where lista_id = v_lista;
  select jsonb_object_agg(coalesce(time::text,'sem time'), n) into v_por_time
  from (select time, count(*) as n from qualificador.lista_item
        where lista_id = v_lista group by time) x;

  update qualificador.lista set total = v_total, por_time = v_por_time where id = v_lista;

  return jsonb_build_object('lista_id', v_lista, 'total', v_total,
                            'por_time', coalesce(v_por_time, '{}'::jsonb));
end $function$;

revoke execute on function qualificador.gerar_lista(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function qualificador.gerar_lista(uuid, jsonb, jsonb, jsonb)
  to authenticated, service_role;
