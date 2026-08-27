-- Qualificador de Leads ROI · migration 41
-- Resolve a "decisão em aberto" do rascunho do funil de qualificação:
-- quando a pessoa não existe na plataforma consultada numa etapa, ela sai ou fica?
--
-- A resposta é POR ETAPA, com a flag `manter_sem_dado`:
--   ausente/false → a etapa é FILTRO. Quem não tem o dado sai. (inner join)
--   true          → a etapa é REFINO. Quem não tem o dado segue, sem ser julgado.
--
-- Por que não é um left join de verdade: o enriquecimento já aconteceu antes do
-- funil. As fontes espelhadas populam engajamento / crm_snapshot / saude_disparo,
-- e v_pessoa_completa já as junta com left join. Consultar a plataforma "dentro da
-- etapa" seria voltar ao laço por pessoa que a Tarefa 0-B removeu. O que sobra de
-- verdade para decidir por etapa é só isto: ausência do dado exclui, ou não?

create or replace function qualificador.campo_bate(p_dados jsonb, p_etapa jsonb)
returns boolean
language plpgsql immutable
set search_path = pg_catalog as $fn$
declare
  caminho text  := p_etapa->>'campo';
  op      text  := p_etapa->>'operador';
  val     jsonb := p_etapa->'valor';
  manter  boolean := coalesce((p_etapa->>'manter_sem_dado')::boolean, false);
  v       jsonb;
  txt     text;
  num     numeric;
  dt      date;
  do_dado text[];
  da_regra text[];
  ausente boolean;
begin
  if caminho is null or op is null then return true; end if;

  v := case
         when coalesce((p_etapa->>'nativo')::boolean, false)
           then case when p_etapa->>'fonte' = 'hubspot_negocio'
                     then p_dados->'props_deals'->caminho
                     else p_dados->'props'->caminho end
         else p_dados->caminho
       end;

  ausente := v is null or v = 'null'::jsonb
          or (jsonb_typeof(v) = 'string' and nullif(btrim(v #>> '{}'), '') is null)
          or (jsonb_typeof(v) = 'array'  and jsonb_array_length(v) = 0);

  -- Etapa de refino: sem o dado, a pessoa não é julgada por esta etapa.
  -- Não vale para 'vazio'/'preenchido', que existem justamente para testar ausência.
  if manter and ausente and op not in ('vazio','preenchido') then
    return true;
  end if;

  txt := case when ausente then null
              when jsonb_typeof(v) = 'string' then v #>> '{}'
              else v::text end;

  case op
    when 'preenchido' then return not ausente;
    when 'vazio'      then return ausente;
    when 'e_verdadeiro' then return coalesce((txt)::boolean, false) is true;
    when 'e_falso'      then return coalesce((txt)::boolean, false) is false;
    when 'igual'     then return txt is not distinct from (val #>> '{}');
    when 'diferente' then return txt is distinct from (val #>> '{}');
    when 'contem'    then return coalesce(txt, '') ilike '%' || coalesce(val #>> '{}', '') || '%';
    when 'e_um_de'     then return txt = any (qualificador.txt_array(val));
    when 'nao_e_um_de' then return txt is null or not (txt = any (qualificador.txt_array(val)));
    when 'contem_algum' then
      do_dado  := case when jsonb_typeof(v) = 'array' then qualificador.txt_array(v) end;
      da_regra := qualificador.txt_array(val);
      return da_regra is null or (do_dado is not null and do_dado && da_regra);
    when 'nao_contem_nenhum' then
      do_dado  := case when jsonb_typeof(v) = 'array' then qualificador.txt_array(v) end;
      da_regra := qualificador.txt_array(val);
      return da_regra is null or do_dado is null or not (do_dado && da_regra);
    when 'maior_igual' then
      num := nullif(txt, '')::numeric; return num is not null and num >= (val #>> '{}')::numeric;
    when 'menor_igual' then
      num := nullif(txt, '')::numeric; return num is not null and num <= (val #>> '{}')::numeric;
    when 'entre' then
      num := nullif(txt, '')::numeric;
      return num is not null
         and (val->>'min' is null or num >= (val->>'min')::numeric)
         and (val->>'max' is null or num <= (val->>'max')::numeric);
    when 'depois_de' then
      dt := nullif(txt, '')::date; return dt is not null and dt >= (val #>> '{}')::date;
    when 'antes_de' then
      dt := nullif(txt, '')::date; return dt is not null and dt <= (val #>> '{}')::date;
    when 'proximos_dias' then
      dt := nullif(txt, '')::date;
      return dt is not null and dt >= current_date and dt <= current_date + (val #>> '{}')::int;
    else return true;
  end case;
exception when others then
  return false;
end $fn$;

comment on function qualificador.campo_bate(jsonb, jsonb) is
  'true = a pessoa PASSA nesta etapa. manter_sem_dado=true torna a etapa um refino:
   quem não tem o dado segue no funil em vez de ser cortado por ausência.';

revoke execute on function qualificador.campo_bate(jsonb, jsonb) from public, anon, authenticated;
grant  execute on function qualificador.campo_bate(jsonb, jsonb) to service_role;
