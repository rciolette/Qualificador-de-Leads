-- A regra antiga era `right(digitos, 11)`, e errava em três situações:
--
--   +551133334444  (fixo BR com DDI, 12 dígitos)  ->  51133334444
--       o "5" do DDI 55 entrava na chave, e o mesmo número sem DDI
--       (1133334444) gerava outra chave. Nunca casavam.
--
--   +351910649613  (Portugal, 12 dígitos)          ->  51910649613
--       vira um celular de DDD 51. FALSO POSITIVO — pior que não cruzar,
--       porque cruza a pessoa errada em silêncio. 43 pessoas na base têm
--       telefone estrangeiro de 12 dígitos.
--
--   5199999999 x 51999999999 (o nono dígito)
--       o mesmo celular, cadastrado antes e depois da mudança da Anatel,
--       gerava chaves diferentes.
--
-- A chave canônica resolve as três: para o Brasil, `55 + DDD + os 8 últimos
-- dígitos` — o nono é descartado dos dois lados, então tanto faz. Para os
-- outros países, o número inteiro com DDI, que é o que impede a colisão.
create or replace function qualificador.chave_telefone(v text)
returns text
language sql
immutable
set search_path to 'pg_catalog'
as $$
  with d as (select regexp_replace(coalesce(v, ''), '\D', '', 'g') as n)
  select case
    -- BR com DDI: 55 + DDD + 8 (fixo) ou 55 + DDD + 9 (celular)
    when length(n) in (12, 13) and left(n, 2) = '55'
      then '55' || substr(n, 3, 2) || right(n, 8)
    -- BR sem DDI: DDD + 8 ou DDD + 9
    when length(n) in (10, 11)
      then '55' || left(n, 2) || right(n, 8)
    -- qualquer outro país: preserva inteiro, senão o DDI vira DDD
    when length(n) between 8 and 15
      then n
  end
  from d
$$;

comment on function qualificador.chave_telefone(text) is
  'Chave canônica de telefone. BR: 55+DDD+8 últimos dígitos (o nono é descartado dos dois lados). Outros países: número inteiro com DDI, para o DDI não virar DDD. A MESMA regra existe em chaveTelefone() em supabase/functions/qualificador-espelhar/fontes.ts — mudar uma sem a outra faz o cruzamento parar de casar em silêncio.';

revoke execute on function qualificador.chave_telefone(text) from public, anon;
grant execute on function qualificador.chave_telefone(text) to authenticated, service_role;

-- as chaves gravadas nos espelhos foram calculadas com a regra velha
update qualificador.espelho_sellflux
   set chave_telefone = qualificador.chave_telefone(payload->>'phone')
 where chave_telefone is distinct from qualificador.chave_telefone(payload->>'phone');

update qualificador.espelho_memberkit
   set chave_telefone = qualificador.chave_telefone(
         coalesce(payload->'metadata'->>'phone_local_code','') ||
         coalesce(payload->'metadata'->>'phone_number',''))
 where payload->'metadata'->>'phone_number' is not null;
