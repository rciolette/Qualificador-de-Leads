-- Quantas pessoas da base têm cada campo preenchido.
--
-- Sem isso, montar uma etapa é um tiro no escuro: escolher um campo do MemberKit
-- leva 4.430 pessoas a 105 e a única forma de descobrir era filtrar e ver a
-- lista murchar. A pergunta "quantos têm esse dado?" não existia na tela.
--
-- O custo está em MONTAR `v_pessoa_completa` (61 colunas, subplans por pessoa):
-- 2,5 s para um campo só. Um `cross join` com o catálogo montaria a view 57
-- vezes e estourava o statement timeout. Materializar uma vez numa temp table e
-- cruzar depois é o mesmo remédio da migration 58, pelo mesmo motivo.

create or replace function qualificador.cobertura_campos()
returns table (campo_id text, com_dado bigint, base bigint)
language plpgsql
stable
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  n bigint;
begin
  create temp table _cob on commit drop as
    select to_jsonb(v) j from qualificador.v_pessoa_completa v;
  select count(*) into n from _cob;

  return query
    select c.id,
           count(*) filter (where
             case
               when c.fonte = 'hubspot_negocio'
                 then jsonb_array_length(qualificador.valores_do_negocio(d.j, c.caminho)) > 0
               when c.fonte = 'hubspot_contato'
                 then not qualificador.valor_ausente(d.j->'props'->c.caminho)
               else not qualificador.valor_ausente(d.j->c.caminho)
             end),
           n
      from qualificador.campo_filtravel c
      cross join _cob d
     group by c.id;
end $function$;

comment on function qualificador.cobertura_campos() is
  'Por campo do catálogo, quantas das N pessoas da base têm o dado preenchido. '
  'A tela usa para avisar antes de filtrar: "esse campo cobre 2% da base".';

revoke execute on function qualificador.cobertura_campos() from public, anon;
grant execute on function qualificador.cobertura_campos() to authenticated, service_role;
