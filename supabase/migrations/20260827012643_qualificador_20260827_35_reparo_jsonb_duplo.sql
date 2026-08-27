-- Qualificador de Leads ROI · migration 35
--
-- 659 das 738 linhas de crm_snapshot tinham deals, econt e disparo gravados como
-- STRING de JSON em vez de objeto — a armadilha que o CLAUDE.md seção 5 já
-- nomeia ("sql.json(dados), nunca JSON.stringify"). O sync antigo gravou assim
-- antes da correção; os dados ficaram no banco, silenciosamente inúteis:
-- jsonb_typeof devolvia "string" e todo deals->'itens' virava null.
--
-- O dado é recuperável — a string contém o JSON íntegro. Este reparo o desembrulha.
--
-- Sintoma que levou a encontrar: v_pessoa_completa quebrando com
-- "cannot extract elements from a scalar" ao rodar jsonb_array_elements sobre
-- deals->'itens' de uma linha corrompida.

update qualificador.crm_snapshot set
  deals   = case when jsonb_typeof(deals)   = 'string' then (deals   #>> '{}')::jsonb else deals   end,
  econt   = case when jsonb_typeof(econt)   = 'string' then (econt   #>> '{}')::jsonb else econt   end,
  disparo = case when jsonb_typeof(disparo) = 'string' then (disparo #>> '{}')::jsonb else disparo end
where jsonb_typeof(deals)   = 'string'
   or jsonb_typeof(econt)   = 'string'
   or jsonb_typeof(disparo) = 'string';

-- Defesa em profundidade: mesmo reparado, a view não pode quebrar a extração
-- inteira por causa de uma linha malformada que entre amanhã.
create or replace function qualificador.itens_de(p jsonb)
returns jsonb language sql immutable
set search_path = pg_catalog as $fn$
  select case
    when p is null then '[]'::jsonb
    when jsonb_typeof(p) = 'array'  then p
    when jsonb_typeof(p) = 'object' then case
      when jsonb_typeof(p->'itens') = 'array' then p->'itens' else '[]'::jsonb end
    else '[]'::jsonb   -- string, número, booleano: trata como vazio, não explode
  end
$fn$;

comment on function qualificador.itens_de(jsonb) is
  'Devolve sempre um array. Uma linha malformada não pode derrubar a extração
   inteira — o filtro simplesmente não encontra nada para aquela pessoa.';

revoke execute on function qualificador.itens_de(jsonb) from public, anon;
grant  execute on function qualificador.itens_de(jsonb) to authenticated, service_role;
