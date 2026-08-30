-- Duas mudanças que vêm do protótipo da etapa 2.
--
-- 1. ETAPA INCOMPLETA É IGNORADA, NÃO ZERA A LISTA.
--    A tela cria a condição vazia como {"campo":"","operador":""} — string
--    vazia, não null. `condicao_avalia` só tratava null, então a condição vazia
--    caía no ramo do dado ausente, devolvia `sem_dado`, e a etapa cortava a base
--    inteira. Quem montava uma etapa e ainda não escolhera o campo via a lista ir
--    a zero sem entender por quê.
--
--    Agora existe um quarto estado: `ignorar`. Condição sem campo ou sem operador
--    não vota nem decide — é como se não estivesse ali. Etapa com todas as
--    condições incompletas deixa todo mundo passar.
--
-- 2. "SÓ ESSES" — o terceiro modo para quem não tem o dado.
--    Antes eram dois: tira (filtro) ou mantém (refino). Falta o inverso — "quem
--    comprou e NÃO tem conta na MemberClass" — que é uma pergunta de negócio real
--    e era impossível de fazer. `so` inverte o resultado da etapa inteira.
--
--    `modo_sem_dado` ('tira' | 'mantem' | 'so') substitui o booleano
--    `manter_sem_dado`, que continua sendo lido para os modelos já salvos.
--
-- NOTA: os nomes desta migration são intermediários. A migration 67 os troca
-- pelos definitivos — `sem_dado`: 'excluir' | 'manter' | 'apenas'.

create or replace function qualificador.condicao_avalia(p_dados jsonb, p_cond jsonb)
returns text
language plpgsql
stable
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  -- nullif com '' : a tela cria a condição vazia como string, não como null
  caminho text := nullif(p_cond->>'campo', '');
  op      text := nullif(p_cond->>'operador', '');
  val     jsonb := p_cond->'valor';
  fonte   text := nullif(p_cond->>'fonte', '');
  nativo  boolean := coalesce((p_cond->>'nativo')::boolean,
                              fonte in ('hubspot_contato','hubspot_negocio'));
  quant   text := lower(coalesce(p_cond->>'quantificador', 'algum'));
  v jsonb; vals jsonb; n int; positivos int;
begin
  -- condição pela metade não vota nem decide: some do cálculo
  if caminho is null or op is null then return 'ignorar'; end if;

  -- operadores que pedem valor, sem valor escolhido, também estão pela metade
  if op not in ('vazio','preenchido','e_verdadeiro','e_falso')
     and (val is null or val = 'null'::jsonb
          or (jsonb_typeof(val) = 'string' and nullif(btrim(val #>> '{}'), '') is null)
          or (jsonb_typeof(val) = 'array'  and jsonb_array_length(val) = 0))
  then return 'ignorar'; end if;

  -- coleção: os N negócios do HubSpot
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
  -- 'tira' | 'mantem' | 'so'. O booleano antigo continua valendo para o que já
  -- estava salvo: manter_sem_dado true == 'mantem'.
  modo  text := lower(coalesce(
                  nullif(p_etapa->>'modo_sem_dado', ''),
                  case when coalesce((p_etapa->>'manter_sem_dado')::boolean, false)
                       then 'mantem' else 'tira' end));
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

  -- etapa inteira pela metade: ninguém é cortado por ela, nem mesmo pelo `so`
  if n_julgavel = 0 then return true; end if;

  if n_verdadeiro = 0 and n_falso = 0 then
    -- nenhuma condição pôde ser julgada: o modo decide
    ok := (modo = 'mantem');
  elsif comb = 'todas' then
    ok := n_falso = 0 and n_verdadeiro > 0;
  else
    ok := n_verdadeiro > 0;
  end if;

  -- "só esses": inverte a etapa. Vira "quem NÃO satisfaz" — que é como se
  -- pergunta "quem comprou e não tem conta na área de membros".
  if modo = 'so' then return not ok; end if;
  return ok;
end $function$;

do $do$
declare f text;
begin
  foreach f in array array[
    'qualificador.condicao_avalia(jsonb, jsonb)',
    'qualificador.campo_bate(jsonb, jsonb)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $do$;
