-- O núcleo da filtragem, separado do score.
--
-- `funil()` chamava `filtrar_em_etapas`, que monta os 8 eixos de score e a faixa
-- para as 4.430 pessoas -- e o funil descarta tudo menos `pessoa_id` e `ordem`.
-- Score é da lista, não do funil: quem está explorando filtros não precisa saber
-- a ordem de quem sobrou.
--
-- E os 8 UPDATEs sequenciais viram um só. Cada um deles reescrevia as linhas que
-- casavam (MVCC: update em temp table cria versão nova), e o `where saida is
-- null` de cada um relia a tabela inteira. Um CASE resolve na mesma passada, e a
-- ordem dos WHENs preserva a precedência que a sequência de updates tinha.
--
-- NOTA: as migrations 74 e 76 reescrevem esta função. Este arquivo é o passo
-- intermediário, mantido porque o repo reproduz a ordem em que o banco mudou.
create or replace function qualificador.filtrar(p_etapas jsonb, p_config jsonb default '{}'::jsonb)
returns table (pessoa_id uuid, ordem integer, etapa text, rotulo text)
language plpgsql
volatile
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  i int := 10;
  et jsonb;
  perdido_dias int := coalesce((p_config->>'excluir_perdido_dias')::int, 15);
  fadiga_dias  int := coalesce((p_config->>'anti_fadiga_dias')::int, 7);
  times text[] := qualificador.txt_array(p_config->'times');
  pular_bloqueio boolean := coalesce((p_config->>'pular_bloqueio_duro')::boolean, false);
  tem_foto boolean;
begin
  p_etapas := qualificador.resolver_etapas(p_etapas);
  tem_foto := qualificador.garantir_pessoa_dados();

  drop table if exists _et;
  if tem_foto then
    create temp table _et on commit drop as
      select d.pessoa_id, d.dados, null::int as saida from qualificador.pessoa_dados d;
  else
    create temp table _et on commit drop as
      select v.pessoa_id,
             to_jsonb(v)
               || jsonb_build_object('props',       coalesce(c.props, '{}'::jsonb))
               || jsonb_build_object('props_deals', coalesce(c.props_deals, '{}'::jsonb)) as dados,
             null::int as saida
        from qualificador.v_pessoa_completa v
        left join qualificador.crm_snapshot c on c.pessoa_id = v.pessoa_id;
  end if;

  if not pular_bloqueio then
    update _et set saida = case
      when dados->>'telefone_e164' is null then 1
      when coalesce(qualificador.como_bool(dados->>'unsub_whats'), false) then 2
      when coalesce(qualificador.como_bool(dados->>'em_cadencia_automatica'), false) then 3
      when coalesce(qualificador.como_bool(dados->>'falha_sellflux'), false) then 4
      when coalesce(qualificador.como_bool(dados->>'perdido_na_cadencia'), false) then 5
      when qualificador.como_ts(dados->>'perdido_em') > now() - make_interval(days => perdido_dias) then 6
      when coalesce(qualificador.como_bool(dados->>'cadencia_iniciada'), false)
           and qualificador.como_bool(dados->>'conectou') is false then 7
      when exists (
        select 1 from qualificador.disparo_registro dr
         where dr.pessoa_id = _et.pessoa_id
           and dr.data_do_disparo > current_date - fadiga_dias
           and (times is null or dr.time::text = any (times))
           and (_et.dados->>'preferential_whats_id' is null
                or dr.numero_whats = _et.dados->>'preferential_whats_id')) then 8
      else null
    end;
  end if;

  for et in select value from jsonb_array_elements(coalesce(p_etapas, '[]'::jsonb)) loop
    if coalesce((et->>'ativa')::boolean, true) then
      update _et set saida = i
       where saida is null and not qualificador.campo_bate(dados, et);
    end if;
    i := i + 1;
  end loop;

  return query
  select f.pessoa_id, f.saida,
         case f.saida
           when 1 then 'sem_telefone' when 2 then 'optout_whats'
           when 3 then 'novos_em_conexao' when 4 then 'falha_de_entrega'
           when 5 then 'perdido_na_cadencia' when 6 then 'perdido_recente'
           when 7 then 'disparo_sem_conexao' when 8 then 'anti_fadiga'
           else coalesce(e.valor->>'id', 'etapa_' || f.saida)
         end,
         case f.saida
           when 1 then 'sem telefone válido' when 2 then 'opt-out de WhatsApp'
           when 3 then 'Novos / Em conexão' when 4 then 'falha de entrega'
           when 5 then 'perdido na cadência'
           when 6 then format('perdido há ≤ %s dias', perdido_dias)
           when 7 then 'disparo anterior sem conexão'
           when 8 then format('anti-fadiga · %s dias', fadiga_dias)
           else coalesce(nullif(e.valor->>'rotulo',''), 'etapa ' || (f.saida - 9))
         end
    from _et f
    left join lateral (
      select x.valor from jsonb_array_elements(coalesce(p_etapas,'[]'::jsonb))
        with ordinality x(valor, ord)
       where f.saida >= 10 and x.ord = f.saida - 9
    ) e on true;
end $function$;

comment on function qualificador.filtrar(jsonb, jsonb) is
  'Núcleo do funil: quem sai, em que etapa. Sem score -- o funil descarta o '
  'score, e montá-lo custa um join lateral por pessoa em v_eixos_score.';

revoke execute on function qualificador.filtrar(jsonb, jsonb) from public, anon;
grant execute on function qualificador.filtrar(jsonb, jsonb) to authenticated, service_role;
