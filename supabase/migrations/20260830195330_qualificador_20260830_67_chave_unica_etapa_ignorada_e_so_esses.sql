-- Três correções da Etapa 2, numa migration só porque se sustentam entre si.
--
-- 1. DUAS CHAVES PARA O MESMO CAMPO.
--    `campo_filtravel` expõe `id` (`mc.tem_conta`) — e é o `id` que a tela já
--    grava em `colunas[]`. Mas `condicoes[].campo` esperava o `caminho`
--    (`tem_memberclass`). Uma condição escrita com o id não achava dado nenhum,
--    virava "sem dado" para todo mundo, e com `manter_sem_dado:false` cortava
--    100% da base sem uma linha de erro. Medido: 0 pessoas com o id, 2.364 com
--    o caminho, mesma condição.
--
--    Agora existe UMA chave: `resolver_condicao` aceita o id do catálogo e
--    traduz para (fonte, caminho). O caminho continua aceito como fallback,
--    senão toda etapa já salva quebraria.
--
-- 2. CAMPO INVÁLIDO NÃO É PESSOA SEM O DADO.
--    Os dois casos davam "indeterminado", e `manter_sem_dado:false` tratava os
--    dois como corte. São coisas diferentes: um é erro de montagem da etapa, o
--    outro é um fato sobre a pessoa. Campo vazio, desconhecido ou operador
--    ausente agora marca a condição com `_ignorar`, e uma etapa cujas condições
--    foram todas ignoradas não corta ninguém.
--
-- 3. O TERCEIRO ESTADO.
--    `sem_dado`: 'excluir' (padrão) · 'manter' · 'apenas'. O `apenas` inverte a
--    etapa inteira — é como se pergunta "quem comprou e NÃO tem conta na área de
--    membros", que com dois estados era impossível de montar. O booleano
--    `manter_sem_dado` continua sendo lido nas etapas já salvas.

-- ---------------------------------------------------------------- resolução
create or replace function qualificador.resolver_condicao(p_cond jsonb)
returns jsonb
language plpgsql
stable
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  chave text := nullif(btrim(coalesce(p_cond->>'campo', '')), '');
  op    text := nullif(btrim(coalesce(p_cond->>'operador', '')), '');
  f     text := nullif(p_cond->>'fonte', '');
  cf    qualificador.campo_filtravel%rowtype;
begin
  if chave is null or op is null then
    return p_cond || '{"_ignorar": true}'::jsonb;
  end if;

  -- o id do catálogo é a chave preferida: é o que a tela já grava em colunas[]
  select * into cf from qualificador.campo_filtravel where id = chave;

  if not found then
    -- fallback: as etapas salvas antes desta migration guardam o caminho.
    -- "Dias sem acessar" existe em duas fontes, então a fonte da condição
    -- desempata quando ela vem.
    select * into cf from qualificador.campo_filtravel
     where caminho = chave and (f is null or fonte = f)
     order by ordem limit 1;
  end if;

  -- campo que não existe no catálogo é etapa mal montada, não pessoa sem dado
  if not found then
    return p_cond || '{"_ignorar": true}'::jsonb;
  end if;

  return p_cond || jsonb_build_object('campo', cf.caminho, 'fonte', cf.fonte);
end $function$;

create or replace function qualificador.resolver_etapa(p_etapa jsonb)
returns jsonb
language sql
stable
set search_path to 'qualificador', 'pg_catalog'
as $function$
  select case
    -- formato antigo: a própria etapa é a condição
    when jsonb_typeof(p_etapa->'condicoes') <> 'array' then
      p_etapa || jsonb_build_object('condicoes',
        jsonb_build_array(qualificador.resolver_condicao(p_etapa)))
    else
      p_etapa || jsonb_build_object('condicoes', coalesce((
        select jsonb_agg(qualificador.resolver_condicao(c.value) order by c.ord)
          from jsonb_array_elements(p_etapa->'condicoes') with ordinality c(value, ord)
      ), '[]'::jsonb))
  end
$function$;

create or replace function qualificador.resolver_etapas(p_etapas jsonb)
returns jsonb
language sql
stable
set search_path to 'qualificador', 'pg_catalog'
as $function$
  select coalesce((
    select jsonb_agg(qualificador.resolver_etapa(e.value) order by e.ord)
      from jsonb_array_elements(coalesce(p_etapas, '[]'::jsonb)) with ordinality e(value, ord)
  ), '[]'::jsonb)
$function$;

-- Sobre a etapa JÁ resolvida: nenhuma condição sobreviveu ao `_ignorar`.
create or replace function qualificador.etapa_ignorada(p_etapa jsonb)
returns boolean
language sql
stable
set search_path to 'qualificador', 'pg_catalog'
as $function$
  select not exists (
    select 1 from jsonb_array_elements(coalesce(p_etapa->'condicoes', '[]'::jsonb)) c
     where not coalesce((c.value->>'_ignorar')::boolean, false))
$function$;

-- ---------------------------------------------------------------- avaliação
create or replace function qualificador.condicao_avalia(p_dados jsonb, p_cond jsonb)
returns text
language plpgsql
stable
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  caminho text := nullif(p_cond->>'campo', '');
  op      text := nullif(p_cond->>'operador', '');
  val     jsonb := p_cond->'valor';
  fonte   text := nullif(p_cond->>'fonte', '');
  nativo  boolean := coalesce((p_cond->>'nativo')::boolean,
                              fonte in ('hubspot_contato','hubspot_negocio'));
  quant   text := lower(coalesce(p_cond->>'quantificador', 'algum'));
  v jsonb; vals jsonb; n int; positivos int;
begin
  -- carimbado por `resolver_condicao`: campo vazio, desconhecido, ou sem operador
  if coalesce((p_cond->>'_ignorar')::boolean, false) then return 'ignorar'; end if;
  if caminho is null or op is null then return 'ignorar'; end if;

  -- operador que o motor não sabe avaliar não vota: `operador_bate` devolveria
  -- true para todo mundo e a etapa deixaria de filtrar em silêncio
  if op not in ('e_verdadeiro','e_falso','igual','diferente','contem','e_um_de',
                'nao_e_um_de','contem_algum','nao_contem_nenhum','maior_igual',
                'menor_igual','entre','depois_de','antes_de','proximos_dias',
                'vazio','preenchido')
  then return 'ignorar'; end if;

  if op not in ('vazio','preenchido','e_verdadeiro','e_falso')
     and (val is null or val = 'null'::jsonb
          or (jsonb_typeof(val) = 'string' and nullif(btrim(val #>> '{}'), '') is null)
          or (jsonb_typeof(val) = 'array'  and jsonb_array_length(val) = 0))
  then return 'ignorar'; end if;

  if nativo and fonte = 'hubspot_negocio' then
    vals := qualificador.valores_do_negocio(p_dados, caminho);
    n := jsonb_array_length(vals);
    if op in ('vazio','preenchido') then
      return case when (op = 'preenchido') = (n > 0) then 'verdadeiro' else 'falso' end;
    end if;
    if n = 0 then return 'sem_dado'; end if;

    select count(*) into positivos
      from jsonb_array_elements(vals) x
     where qualificador.operador_bate(x.value, op, val);

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

create or replace function qualificador.campo_bate(p_dados jsonb, p_etapa jsonb)
returns boolean
language plpgsql
stable
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  conds jsonb;
  comb  text := lower(coalesce(p_etapa->>'combinador', 'qualquer'));
  -- 'excluir' (padrão) | 'manter' | 'apenas'.
  -- `modo_sem_dado` foi um nome intermediário; `manter_sem_dado` é o booleano
  -- original. Os dois continuam sendo lidos: há etapa salva com cada um deles.
  modo  text := lower(coalesce(
                  nullif(p_etapa->>'sem_dado', ''),
                  case nullif(p_etapa->>'modo_sem_dado', '')
                    when 'tira'   then 'excluir'
                    when 'mantem' then 'manter'
                    when 'so'     then 'apenas'
                    else null
                  end,
                  case when coalesce((p_etapa->>'manter_sem_dado')::boolean, false)
                       then 'manter' else 'excluir' end));
  c jsonb; r text;
  n_verdadeiro int := 0; n_falso int := 0; n_julgavel int := 0;
  ok boolean;
begin
  conds := case when jsonb_typeof(p_etapa->'condicoes') = 'array'
                then p_etapa->'condicoes'
                else jsonb_build_array(p_etapa) end;
  if jsonb_array_length(conds) = 0 then return true; end if;

  for c in select value from jsonb_array_elements(conds) loop
    r := qualificador.condicao_avalia(p_dados, c);
    if r = 'ignorar' then continue; end if;   -- não conta para nada
    n_julgavel := n_julgavel + 1;
    if    r = 'verdadeiro' then n_verdadeiro := n_verdadeiro + 1;
    elsif r = 'falso'      then n_falso      := n_falso + 1;
    end if;
  end loop;

  -- etapa inteira pela metade: ninguém é cortado por ela, nem mesmo pelo
  -- `apenas` — inverter uma etapa que não sabe julgar nada devolveria a base
  -- inteira como se fosse resposta
  if n_julgavel = 0 then return true; end if;

  if n_verdadeiro = 0 and n_falso = 0 then
    -- nenhuma condição pôde ser julgada: o modo decide
    ok := (modo = 'manter');
  elsif comb = 'todas' then
    ok := n_falso = 0 and n_verdadeiro > 0;
  else
    ok := n_verdadeiro > 0;
  end if;

  if modo = 'apenas' then return not ok; end if;
  return ok;
end $function$;

do $do$
declare f text;
begin
  foreach f in array array[
    'qualificador.resolver_condicao(jsonb)',
    'qualificador.resolver_etapa(jsonb)',
    'qualificador.resolver_etapas(jsonb)',
    'qualificador.etapa_ignorada(jsonb)',
    'qualificador.condicao_avalia(jsonb, jsonb)',
    'qualificador.campo_bate(jsonb, jsonb)'
  ] loop
    -- CREATE OR REPLACE devolve EXECUTE a PUBLIC; revogar depois não é opcional.
    -- Mas note que estas são INVOKER: tirar de `authenticated` quebraria quem
    -- chama (foi o 403 da migration 41).
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $do$;
