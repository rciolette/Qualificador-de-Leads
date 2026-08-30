-- `operador_bate` termina com `else return true`, então um operador que ela não
-- conhece faz a condição valer para todo mundo — a etapa deixa de filtrar e
-- ninguém percebe. Descobri isso escrevendo `maior_ou_igual` no lugar de
-- `maior_igual`: a etapa "3+ aulas" devolveu as 4.339 pessoas com dado, em vez
-- das 2.280 que realmente batem.
--
-- Hoje o catálogo inteiro está coberto, então isso só dispara com operador
-- inválido — um modelo salvo com um operador que depois saiu do catálogo, ou um
-- typo. Nos dois casos a condição não pode ser julgada, e o estado certo para
-- isso já existe: `ignorar`. A condição some do cálculo em vez de aprovar a base.

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

revoke execute on function qualificador.condicao_avalia(jsonb, jsonb) from public, anon;
grant execute on function qualificador.condicao_avalia(jsonb, jsonb) to authenticated, service_role;
