-- "Ver quem saiu" precisa de nomes E do motivo, e o motivo não é um detalhe de
-- apresentação: `sem dado` e `não atende` levam a decisões opostas.
--
--   sem dado    -> a pessoa não está na plataforma. Trocar o modo da etapa para
--                  "Mantém na lista" a traz de volta, ou sincronizar a origem.
--   não atende  -> a pessoa está lá e não satisfaz. Mexer no operador é o
--                  caminho; sincronizar não muda nada.
--
-- Sem essa distinção, quem vê a lista murchar tenta sincronizar quando o
-- problema era o filtro, ou afrouxa o filtro quando o problema era o dado.

create or replace function qualificador.motivo_da_etapa(p_dados jsonb, p_etapa jsonb)
returns text
language plpgsql
stable
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  conds jsonb; c jsonb; r text;
  julgaveis int := 0;
begin
  conds := case when jsonb_typeof(p_etapa->'condicoes') = 'array'
                then p_etapa->'condicoes' else jsonb_build_array(p_etapa) end;
  for c in select value from jsonb_array_elements(conds) loop
    r := qualificador.condicao_avalia(p_dados, c);
    if r in ('verdadeiro','falso') then julgaveis := julgaveis + 1; end if;
  end loop;
  -- nenhuma condição pôde ser julgada: a pessoa não tem o dado, não é que ela
  -- tenha o dado e não sirva
  return case when julgaveis = 0 then 'sem_dado' else 'nao_atende' end;
end $function$;

create or replace function qualificador.amostra_da_etapa(
  p_etapas jsonb, p_config jsonb default '{}'::jsonb,
  p_ordem int default null, p_limite int default 6)
returns table (pessoa_id uuid, nome text, email text, motivo text)
language plpgsql
volatile
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  et jsonb;
begin
  -- só a etapa do usuário tem motivo: bloqueio duro é regra fixa, e o "motivo"
  -- dele é o próprio nome da linha
  if p_ordem is not null and p_ordem >= 10 then
    select x.valor into et
      from jsonb_array_elements(qualificador.resolver_etapas(p_etapas))
        with ordinality x(valor, ord)
     where x.ord = p_ordem - 9;
  end if;

  return query
  select f.pessoa_id,
         d.dados->>'nome', d.dados->>'email',
         case when et is null then null
              else qualificador.motivo_da_etapa(d.dados, et) end
    from qualificador.filtrar(p_etapas, p_config) f
    join qualificador.pessoa_dados d on d.pessoa_id = f.pessoa_id
   where f.ordem is not distinct from p_ordem
   order by d.dados->>'nome' nulls last
   limit greatest(p_limite, 1);
end $function$;

comment on function qualificador.amostra_da_etapa(jsonb, jsonb, int, int) is
  'Amostra de quem saiu numa etapa, com o motivo (sem_dado / nao_atende). '
  'Para a gaveta "ver quem saiu" do cartao de consulta.';

do $do$
declare f text;
begin
  foreach f in array array[
    'qualificador.motivo_da_etapa(jsonb, jsonb)',
    'qualificador.amostra_da_etapa(jsonb, jsonb, int, int)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $do$;
