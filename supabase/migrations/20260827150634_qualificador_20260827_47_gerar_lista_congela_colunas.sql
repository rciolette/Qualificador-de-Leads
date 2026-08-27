drop function if exists qualificador.gerar_lista(uuid, jsonb, jsonb);

create function qualificador.gerar_lista(
  p_iniciativa_id uuid,
  p_etapas jsonb,
  p_config jsonb default '{}'::jsonb,
  p_colunas jsonb default null
)
returns jsonb
language plpgsql
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  v_lista uuid;
  v_times qualificador.time_comercial[];
  v_prior qualificador.time_comercial[];
  v_total int;
  v_por_time jsonb;
  v_funil jsonb;
  v_specs jsonb := qualificador.resolver_colunas(p_colunas);
begin
  select times, coalesce(prioridade_times, times) into v_times, v_prior
  from qualificador.iniciativa where id = p_iniciativa_id;
  if v_times is null then
    raise exception 'Iniciativa % não encontrada', p_iniciativa_id using errcode = 'no_data_found';
  end if;

  select jsonb_agg(to_jsonb(f)) into v_funil from qualificador.funil(p_etapas, p_config) f;

  -- o cabeçalho vai resolvido, não como ids: se o campo for renomeado ou sair do
  -- catálogo, o arquivo antigo continua legível
  insert into qualificador.lista (iniciativa_id, funil, colunas)
  values (p_iniciativa_id, v_funil, v_specs) returning id into v_lista;

  -- Divisão por time: sem regra explícita, todos vão para o primeiro da prioridade.
  -- O blueprint é claro que prioridade é parâmetro da base, não hierarquia do sistema —
  -- por isso o default é o que foi marcado nesta extração, não uma ordem fixa.
  insert into qualificador.lista_item
    (lista_id, pessoa_id, time, score, faixa, motivo, sobreposicao, extras)
  select v_lista, r.pessoa_id, v_prior[1], r.score, r.faixa, r.eixos,
         (select array_agg(distinct l.iniciativa_id)
          from qualificador.lista_item li
          join qualificador.lista l on l.id = li.lista_id
          join qualificador.iniciativa i on i.id = l.iniciativa_id
          where li.pessoa_id = r.pessoa_id and i.aberta and i.id <> p_iniciativa_id),
         qualificador.extrair_colunas(d.dados, v_specs)
  from qualificador.filtrar_em_etapas(p_etapas, p_config) r
  join qualificador.v_dados_pessoa d on d.pessoa_id = r.pessoa_id
  where r.ordem is null;

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
