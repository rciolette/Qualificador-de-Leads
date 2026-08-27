-- Correção da migration 55, achada testando `+1 415 555 2671`: um número dos
-- EUA tem 11 dígitos (1 + 10), exatamente como um celular BR (DDD + 9). A regra
-- da 55 mandava os dois para o ramo brasileiro, e o americano virava
-- `551455552671` — o mesmo falso positivo que a 55 existia para consertar.
--
-- O `+` desfaz a ambiguidade: quando ele está lá, o DDI é explícito e manda.
-- Sem ele, assumir Brasil é correto — é o formato em que a Assiny e a Sellflux
-- mandam número nacional.
create or replace function qualificador.chave_telefone(v text)
returns text
language sql
immutable
set search_path to 'pg_catalog'
as $$
  with e as (
    select btrim(coalesce(v, '')) as bruto,
           regexp_replace(coalesce(v, ''), '\D', '', 'g') as n
  )
  select case
    -- DDI explícito por "+": ele decide, sempre
    when bruto like '+%' then
      case when left(n, 2) = '55' and length(n) in (12, 13)
             then '55' || substr(n, 3, 2) || right(n, 8)   -- BR
           when length(n) between 8 and 15
             then n                                        -- outro país, inteiro
      end
    -- sem "+": número nacional brasileiro
    when length(n) in (10, 11)
      then '55' || left(n, 2) || right(n, 8)
    when length(n) in (12, 13) and left(n, 2) = '55'
      then '55' || substr(n, 3, 2) || right(n, 8)
    when length(n) between 8 and 15
      then n
  end
  from e
$$;

comment on function qualificador.chave_telefone(text) is
  'Chave canônica de telefone. Com "+", o DDI explícito manda; sem "+", assume Brasil. BR vira 55+DDD+8 últimos dígitos, então o nono é descartado dos dois lados. A MESMA regra existe em chaveTelefone() em supabase/functions/qualificador-espelhar/fontes.ts.';

revoke execute on function qualificador.chave_telefone(text) from public, anon;
grant execute on function qualificador.chave_telefone(text) to authenticated, service_role;

-- recalcula as chaves dos espelhos com a regra corrigida
update qualificador.espelho_sellflux
   set chave_telefone = qualificador.chave_telefone(payload->>'phone')
 where chave_telefone is distinct from qualificador.chave_telefone(payload->>'phone');

update qualificador.espelho_memberkit
   set chave_telefone = qualificador.chave_telefone(
         coalesce(payload->'metadata'->>'phone_local_code','') ||
         coalesce(payload->'metadata'->>'phone_number',''))
 where payload->'metadata'->>'phone_number' is not null;
