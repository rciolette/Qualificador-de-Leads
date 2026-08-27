-- Tarefa 2, itens (2) e (3) · passo 1 do desenho aprovado
-- (docs/tarefa-2-multiplas-plataformas-e-de-para.md, seções 3 e 9).
--
-- Duas coisas ao mesmo tempo, porque uma não fecha sem a outra:
--   a) o conserto do `props_deals`, que é indexado por ID DE NEGÓCIO e vinha
--      sendo lido como objeto plano — todo filtro e toda coluna sobre property
--      de negócio devolvia vazio, sem erro;
--   b) a condição com TRÊS estados, que é o que permite combinar plataformas
--      sem que um dado faltando faça a etapa inteira passar.
--
-- Nada de HTTP: tudo lê o jsonb que `filtrar_em_etapas` já montou em memória.

-- ---------------------------------------------------------------- ausência
create or replace function qualificador.valor_ausente(v jsonb)
returns boolean
language sql
immutable
set search_path to 'pg_catalog'
as $$
  select v is null
      or v = 'null'::jsonb
      or (jsonb_typeof(v) = 'string' and nullif(btrim(v #>> '{}'), '') is null)
      or (jsonb_typeof(v) = 'array'  and jsonb_array_length(v) = 0)
$$;

-- ------------------------------------------------- os valores de N negócios
-- `props_deals` é {deal_id: {property: valor}}. Uma pessoa tem em média 3,05
-- negócios (máximo 10), e 483 das 567 discordam de si mesmas em
-- `origem_de_trafego`. Por isso a resposta é uma LISTA, nunca um escalar.
create or replace function qualificador.valores_do_negocio(
  p_dados jsonb, p_caminho text, p_distintos boolean default false
)
returns jsonb
language sql
immutable
set search_path to 'qualificador', 'pg_catalog'
as $$
  select coalesce(
    case when p_distintos
      then (select jsonb_agg(distinct n.value -> p_caminho)
              from jsonb_each(coalesce(p_dados->'props_deals','{}'::jsonb)) n
             where not qualificador.valor_ausente(n.value -> p_caminho))
      else (select jsonb_agg(n.value -> p_caminho)
              from jsonb_each(coalesce(p_dados->'props_deals','{}'::jsonb)) n
             where not qualificador.valor_ausente(n.value -> p_caminho))
    end, '[]'::jsonb)
$$;
comment on function qualificador.valores_do_negocio(jsonb, text, boolean) is
  'Os valores de uma property entre os N negócios da pessoa. Sem distinto para o filtro (o quantificador "todo" precisa contar todos), com distinto para a coluna.';

-- --------------------------------------------- um operador sobre UM valor
-- Extraída de `campo_bate`: aqui o valor já está presente. Ausência é decidida
-- fora, porque agora tem um terceiro estado.
create or replace function qualificador.operador_bate(v jsonb, op text, val jsonb)
returns boolean
language plpgsql
stable
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  txt text; num numeric; dt date; do_dado text[]; da_regra text[];
begin
  txt := case when jsonb_typeof(v) = 'string' then v #>> '{}' else v::text end;

  case op
    when 'e_verdadeiro' then return coalesce((txt)::boolean, false) is true;
    when 'e_falso'      then return coalesce((txt)::boolean, false) is false;
    when 'igual'        then return txt is not distinct from (val #>> '{}');
    when 'diferente'    then return txt is distinct from (val #>> '{}');
    when 'contem'       then return coalesce(txt, '') ilike '%' || coalesce(val #>> '{}', '') || '%';
    when 'e_um_de'      then return txt = any (qualificador.txt_array(val));
    when 'nao_e_um_de'  then return txt is null or not (txt = any (qualificador.txt_array(val)));
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
end $function$;

-- -------------------------------------------------- a condição, em 3 estados
-- `sem_dado` NÃO VOTA. Se ele devolvesse `true`, um único dado faltando faria a
-- etapa inteira passar sob o combinador `qualquer` — o refino destruiria o filtro.
create or replace function qualificador.condicao_avalia(p_dados jsonb, p_cond jsonb)
returns text
language plpgsql
stable
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  caminho text := p_cond->>'campo';
  op      text := p_cond->>'operador';
  val     jsonb := p_cond->'valor';
  fonte   text := p_cond->>'fonte';
  nativo  boolean := coalesce((p_cond->>'nativo')::boolean,
                              fonte in ('hubspot_contato','hubspot_negocio'));
  quant   text := lower(coalesce(p_cond->>'quantificador', 'algum'));
  v jsonb; vals jsonb; n int; positivos int;
begin
  if caminho is null or op is null then return 'verdadeiro'; end if;

  -- coleção: os N negócios do HubSpot
  if nativo and fonte = 'hubspot_negocio' then
    vals := qualificador.valores_do_negocio(p_dados, caminho);
    n := jsonb_array_length(vals);

    -- vazio/preenchido existem para testar a ausência: nunca devolvem sem_dado
    if op in ('vazio','preenchido') then
      return case when (op = 'preenchido') = (n > 0) then 'verdadeiro' else 'falso' end;
    end if;
    if n = 0 then return 'sem_dado'; end if;

    select count(*) into positivos
      from jsonb_array_elements(vals) x
     where qualificador.operador_bate(x.value, op, val);

    -- um negócio sem a property não vota: quem tem 4 negócios e só 1 com o dado
    -- é julgada por esse 1, não reprovada pelos 3 silenciosos
    if quant = 'todo' then
      return case when positivos = n then 'verdadeiro' else 'falso' end;
    end if;
    return case when positivos > 0 then 'verdadeiro' else 'falso' end;
  end if;

  v := case when nativo then p_dados->'props'->caminho else p_dados->caminho end;

  if op in ('vazio','preenchido') then
    return case when (op = 'preenchido') = (not qualificador.valor_ausente(v))
                then 'verdadeiro' else 'falso' end;
  end if;
  if qualificador.valor_ausente(v) then return 'sem_dado'; end if;

  return case when qualificador.operador_bate(v, op, val) then 'verdadeiro' else 'falso' end;
end $function$;

-- ------------------------------------------------------ a etapa, combinada
-- Aceita os DOIS formatos. Etapa sem `condicoes` é embrulhada como condição
-- única, e o resultado é idêntico ao de hoje, valor por valor: nenhum modelo
-- salvo nem iniciativa existente precisa ser migrado.
create or replace function qualificador.campo_bate(p_dados jsonb, p_etapa jsonb)
returns boolean
language plpgsql
stable
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  conds  jsonb;
  comb   text := lower(coalesce(p_etapa->>'combinador', 'qualquer'));
  manter boolean := coalesce((p_etapa->>'manter_sem_dado')::boolean, false);
  c jsonb; r text;
  n_verdadeiro int := 0; n_falso int := 0;
begin
  conds := case when jsonb_typeof(p_etapa->'condicoes') = 'array'
                then p_etapa->'condicoes'
                else jsonb_build_array(p_etapa) end;
  if jsonb_array_length(conds) = 0 then return true; end if;

  for c in select value from jsonb_array_elements(conds) loop
    r := qualificador.condicao_avalia(p_dados, c);
    if    r = 'verdadeiro' then n_verdadeiro := n_verdadeiro + 1;
    elsif r = 'falso'      then n_falso      := n_falso + 1;
    end if;
  end loop;

  -- nenhuma condição pôde ser julgada: aí sim `manter_sem_dado` decide.
  -- É o que preserva o comportamento medido antes (16 → 0 como filtro, 16 → 16
  -- como refino) para a etapa de condição única.
  if n_verdadeiro = 0 and n_falso = 0 then return manter; end if;

  if comb = 'todas' then
    return n_falso = 0 and n_verdadeiro > 0;
  end if;
  return n_verdadeiro > 0;
end $function$;

-- --------------------------------------------------- a coluna, corrigida
-- Property de negócio vira lista de valores distintos. `mostrar()` no front já
-- junta lista com " · ", então uma pessoa com um valor só continua legível.
create or replace function qualificador.valor_do_campo(p_dados jsonb, p_spec jsonb)
returns jsonb
language sql
stable
set search_path to 'qualificador', 'pg_catalog'
as $$
  select case
    when coalesce((p_spec->>'nativo')::boolean, false)
     and p_spec->>'fonte' = 'hubspot_negocio'
      then nullif(qualificador.valores_do_negocio(p_dados, p_spec->>'caminho', true), '[]'::jsonb)
    when coalesce((p_spec->>'nativo')::boolean, false)
      then p_dados->'props'->(p_spec->>'caminho')
    else p_dados->(p_spec->>'caminho')
  end
$$;

-- CREATE OR REPLACE devolve EXECUTE para PUBLIC (seção 5 do CLAUDE.md), e estas
-- são chamadas por `filtrar_em_etapas`, que é INVOKER: sem o grant a
-- `authenticated` o PostgREST devolve 403 na tela inteira — foi o que a
-- migration 41 causou e a 43 consertou.
do $do$
declare f text;
begin
  foreach f in array array[
    'qualificador.valor_ausente(jsonb)',
    'qualificador.valores_do_negocio(jsonb, text, boolean)',
    'qualificador.operador_bate(jsonb, text, jsonb)',
    'qualificador.condicao_avalia(jsonb, jsonb)',
    'qualificador.campo_bate(jsonb, jsonb)',
    'qualificador.valor_do_campo(jsonb, jsonb)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $do$;
