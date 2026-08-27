-- Qualificador de Leads ROI · migration 34
-- As três funções que a tela de montagem chama.

-- 1) Quem saiu numa etapa — o clique na linha do funil.
create or replace function qualificador.pessoas_da_etapa(
  p_etapas jsonb, p_config jsonb default '{}'::jsonb,
  p_ordem int default null, p_limite int default 200)
returns table (
  pessoa_id uuid, nome text, email text, telefone text,
  faixa_leadscore text, score numeric, faixa text,
  compras bigint, valor_total numeric, projetos text[]
)
language plpgsql volatile
set search_path = qualificador, pg_catalog
as $fn$
begin
  return query
  select r.pessoa_id, v.nome, v.email, v.telefone_e164,
         v.classificacao_leadscore, r.score, r.faixa,
         v.compras, v.valor_total, v.projetos
  from qualificador.filtrar_em_etapas(p_etapas, p_config) r
  join qualificador.v_pessoa_completa v on v.pessoa_id = r.pessoa_id
  where (p_ordem is null and r.ordem is null)      -- null = a lista final
     or (p_ordem is not null and r.ordem = p_ordem)
  order by r.score desc, v.nome
  limit greatest(1, least(p_limite, 2000));
end $fn$;

-- 2) Valores distintos de um campo, para o seletor não exigir digitação exata.
create or replace function qualificador.valores_do_campo(
  p_caminho text, p_limite int default 200)
returns table (valor text, pessoas bigint)
language plpgsql stable
set search_path = qualificador, pg_catalog
as $fn$
begin
  return query
  with d as (select to_jsonb(v) as j from qualificador.v_pessoa_completa v),
  bruto as (
    -- campo de lista: cada item vira uma opção
    select x.item as v from d, lateral jsonb_array_elements_text(d.j->p_caminho) as x(item)
    where jsonb_typeof(d.j->p_caminho) = 'array'
    union all
    -- campo escalar
    select d.j->>p_caminho from d
    where jsonb_typeof(d.j->p_caminho) not in ('array','null') and d.j ? p_caminho
  )
  select b.v, count(*)
  from bruto b
  where nullif(btrim(b.v), '') is not null
  group by b.v
  order by count(*) desc, b.v
  limit greatest(1, least(p_limite, 1000));
end $fn$;

-- 3) Congela a lista: itens, score, time e sobreposição com outras iniciativas abertas.
create or replace function qualificador.gerar_lista(
  p_iniciativa_id uuid, p_etapas jsonb, p_config jsonb default '{}'::jsonb)
returns jsonb
language plpgsql volatile
set search_path = qualificador, pg_catalog
as $fn$
declare
  v_lista uuid;
  v_times qualificador.time_comercial[];
  v_prior qualificador.time_comercial[];
  v_total int;
  v_por_time jsonb;
  v_funil jsonb;
begin
  select times, coalesce(prioridade_times, times) into v_times, v_prior
  from qualificador.iniciativa where id = p_iniciativa_id;
  if v_times is null then
    raise exception 'Iniciativa % não encontrada', p_iniciativa_id using errcode = 'no_data_found';
  end if;

  select jsonb_agg(to_jsonb(f)) into v_funil from qualificador.funil(p_etapas, p_config) f;

  insert into qualificador.lista (iniciativa_id, funil)
  values (p_iniciativa_id, v_funil) returning id into v_lista;

  -- Divisão por time: sem regra explícita, todos vão para o primeiro da prioridade.
  -- O blueprint é claro que prioridade é parâmetro da base, não hierarquia do sistema —
  -- por isso o default é o que foi marcado nesta extração, não uma ordem fixa.
  insert into qualificador.lista_item (lista_id, pessoa_id, time, score, faixa, motivo, sobreposicao)
  select v_lista, r.pessoa_id, v_prior[1], r.score, r.faixa, r.eixos,
         (select array_agg(distinct l.iniciativa_id)
          from qualificador.lista_item li
          join qualificador.lista l on l.id = li.lista_id
          join qualificador.iniciativa i on i.id = l.iniciativa_id
          where li.pessoa_id = r.pessoa_id and i.aberta and i.id <> p_iniciativa_id)
  from qualificador.filtrar_em_etapas(p_etapas, p_config) r
  where r.ordem is null;

  select count(*) into v_total from qualificador.lista_item where lista_id = v_lista;
  select jsonb_object_agg(coalesce(time::text,'sem time'), n) into v_por_time
  from (select time, count(*) as n from qualificador.lista_item
        where lista_id = v_lista group by time) x;

  update qualificador.lista set total = v_total, por_time = v_por_time where id = v_lista;

  return jsonb_build_object('lista_id', v_lista, 'total', v_total,
                            'por_time', coalesce(v_por_time, '{}'::jsonb));
end $fn$;

revoke execute on function qualificador.pessoas_da_etapa(jsonb, jsonb, int, int) from public, anon;
revoke execute on function qualificador.valores_do_campo(text, int) from public, anon;
revoke execute on function qualificador.gerar_lista(uuid, jsonb, jsonb) from public, anon;
grant execute on function qualificador.pessoas_da_etapa(jsonb, jsonb, int, int),
                          qualificador.valores_do_campo(text, int),
                          qualificador.gerar_lista(uuid, jsonb, jsonb)
  to authenticated, service_role;
