-- Qualificador de Leads ROI · migration 31
-- Filtragem em etapas: cada etapa recebe quem sobrou da anterior.
--
-- Substitui o formulário fixo de oito cartões pelo que a operação realmente faz:
-- escolher a plataforma, escolher o campo, aplicar, ver a conta cair, e empilhar
-- a próxima. Funciona com campo modelado ou com property nativa do HubSpot, sem
-- lista fixa em código — o portal tem 1.039 properties de contato.

create or replace function qualificador.campo_bate(p_dados jsonb, p_etapa jsonb)
returns boolean
language plpgsql immutable
set search_path = pg_catalog as $fn$
declare
  caminho text  := p_etapa->>'campo';
  op      text  := p_etapa->>'operador';
  val     jsonb := p_etapa->'valor';
  v       jsonb;
  txt     text;
  num     numeric;
  dt      date;
  do_dado text[];
  da_regra text[];
begin
  if caminho is null or op is null then return true; end if;

  -- campo nativo lê de props (contato) ou props_deals (negócio)
  v := case
         when coalesce((p_etapa->>'nativo')::boolean, false)
           then case when p_etapa->>'fonte' = 'hubspot_negocio'
                     then p_dados->'props_deals'->caminho
                     else p_dados->'props'->caminho end
         else p_dados->caminho
       end;

  txt := case when v is null or v = 'null'::jsonb then null
              when jsonb_typeof(v) = 'string' then v #>> '{}'
              else v::text end;

  case op
    when 'preenchido' then
      return v is not null and v <> 'null'::jsonb
         and (jsonb_typeof(v) <> 'string' or nullif(btrim(v #>> '{}'), '') is not null)
         and (jsonb_typeof(v) <> 'array'  or jsonb_array_length(v) > 0);
    when 'vazio' then
      return v is null or v = 'null'::jsonb
          or (jsonb_typeof(v) = 'string' and nullif(btrim(v #>> '{}'), '') is null)
          or (jsonb_typeof(v) = 'array'  and jsonb_array_length(v) = 0);
    when 'e_verdadeiro' then return coalesce((txt)::boolean, false) is true;
    when 'e_falso'      then return coalesce((txt)::boolean, false) is false;

    when 'igual'     then return txt is not distinct from (val #>> '{}');
    when 'diferente' then return txt is distinct from (val #>> '{}');
    when 'contem'    then return coalesce(txt, '') ilike '%' || coalesce(val #>> '{}', '') || '%';

    when 'e_um_de'     then return txt = any (qualificador.txt_array(val));
    when 'nao_e_um_de' then return txt is null or not (txt = any (qualificador.txt_array(val)));

    -- o dado é lista: interseção com os valores escolhidos
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
      return dt is not null and dt >= current_date
         and dt <= current_date + (val #>> '{}')::int;
    else
      return true;   -- operador desconhecido não filtra ninguém em silêncio
  end case;
exception when others then
  -- valor que não converte (data inválida, texto onde se espera número) não pode
  -- derrubar a extração inteira: a pessoa simplesmente não bate naquela etapa
  return false;
end $fn$;

comment on function qualificador.campo_bate(jsonb, jsonb) is
  'true = a pessoa PASSA nesta etapa. Operador desconhecido devolve true (não filtra),
   valor que não converte devolve false — nunca derruba a extração inteira.';

-- ---------------------------------------------------------------- a cascata
create or replace function qualificador.filtrar_em_etapas(
  p_etapas jsonb, p_config jsonb default '{}'::jsonb)
returns table (
  pessoa_id uuid, ordem int, etapa text, rotulo text,
  score numeric, faixa text, eixos jsonb
)
language plpgsql stable
set search_path = qualificador, pg_catalog
as $fn$
declare
  i int := 10;
  et jsonb;
  pesos jsonb := coalesce(p_config->'pesos', '{}'::jsonb);
  perdido_dias int := coalesce((p_config->>'excluir_perdido_dias')::int, 15);
  fadiga_dias  int := coalesce((p_config->>'anti_fadiga_dias')::int, 7);
  times text[] := qualificador.txt_array(p_config->'times');
  pular_bloqueio boolean := coalesce((p_config->>'pular_bloqueio_duro')::boolean, false);
begin
  create temp table _et on commit drop as
  select v.pessoa_id,
         to_jsonb(v)
           || jsonb_build_object('props',       coalesce(c.props, '{}'::jsonb))
           || jsonb_build_object('props_deals', coalesce(c.props_deals, '{}'::jsonb)) as dados,
         null::int as saida, null::text as etapa_nome, null::text as etapa_rotulo
  from qualificador.v_pessoa_completa v
  left join qualificador.crm_snapshot c on c.pessoa_id = v.pessoa_id;

  -- BLOQUEIO DURO — ordem fixa, antes de qualquer etapa do usuário.
  -- Só é pulado em recorte de diagnóstico, que não gera disparo.
  if not pular_bloqueio then
    update _et set saida = 1, etapa_nome = 'sem_telefone', etapa_rotulo = 'sem telefone válido'
     where saida is null and dados->>'telefone_e164' is null;
    update _et set saida = 2, etapa_nome = 'optout_whats', etapa_rotulo = 'opt-out de WhatsApp'
     where saida is null and coalesce((dados->>'unsub_whats')::boolean, false);
    update _et set saida = 3, etapa_nome = 'novos_em_conexao', etapa_rotulo = 'Novos / Em conexão'
     where saida is null and coalesce((dados->>'em_cadencia_automatica')::boolean, false);
    update _et set saida = 4, etapa_nome = 'falha_de_entrega', etapa_rotulo = 'falha de entrega'
     where saida is null and coalesce((dados->>'falha_sellflux')::boolean, false);
    update _et set saida = 5, etapa_nome = 'perdido_na_cadencia', etapa_rotulo = 'perdido na cadência'
     where saida is null and coalesce((dados->>'perdido_na_cadencia')::boolean, false);
    update _et set saida = 6, etapa_nome = 'perdido_recente',
                   etapa_rotulo = format('perdido há ≤ %s dias', perdido_dias)
     where saida is null and (dados->>'perdido_em')::timestamptz > now() - make_interval(days => perdido_dias);
    update _et set saida = 7, etapa_nome = 'disparo_sem_conexao', etapa_rotulo = 'disparo anterior sem conexão'
     where saida is null and coalesce((dados->>'cadencia_iniciada')::boolean, false)
       and (dados->>'conectou')::boolean is false;
    update _et set saida = 8, etapa_nome = 'anti_fadiga',
                   etapa_rotulo = format('anti-fadiga · %s dias', fadiga_dias)
     where saida is null and exists (
       select 1 from qualificador.disparo_registro dr
       where dr.pessoa_id = _et.pessoa_id
         and dr.data_do_disparo > current_date - fadiga_dias
         and (times is null or dr.time::text = any (times))
         and (_et.dados->>'preferential_whats_id' is null
              or dr.numero_whats = _et.dados->>'preferential_whats_id'));
  end if;

  -- ETAPAS DO USUÁRIO — em ordem, cada uma sobre quem sobrou
  for et in select value from jsonb_array_elements(coalesce(p_etapas, '[]'::jsonb)) loop
    if coalesce((et->>'ativa')::boolean, true) then
      update _et set saida = i,
                     etapa_nome = coalesce(et->>'id', 'etapa_' || i),
                     etapa_rotulo = coalesce(nullif(et->>'rotulo',''), 'etapa ' || (i - 9))
       where saida is null and not qualificador.campo_bate(dados, et);
    end if;
    i := i + 1;
  end loop;

  return query
  select f.pessoa_id, f.saida, f.etapa_nome, f.etapa_rotulo,
         qualificador.aplicar_pesos(
           jsonb_build_object(
             'relacao_comercial', e.relacao_comercial, 'recencia_compra', e.recencia_compra,
             'valor_historico', e.valor_historico, 'engajamento_conteudo', e.engajamento_conteudo,
             'nivel_memberkit', e.nivel_memberkit, 'posse_produto', e.posse_produto,
             'saude_disparo', e.saude_disparo, 'leadscore', e.leadscore), pesos) as score,
         qualificador.faixa_de(qualificador.aplicar_pesos(
           jsonb_build_object(
             'relacao_comercial', e.relacao_comercial, 'recencia_compra', e.recencia_compra,
             'valor_historico', e.valor_historico, 'engajamento_conteudo', e.engajamento_conteudo,
             'nivel_memberkit', e.nivel_memberkit, 'posse_produto', e.posse_produto,
             'saude_disparo', e.saude_disparo, 'leadscore', e.leadscore), pesos)) as faixa,
         jsonb_build_object(
             'relacao_comercial', e.relacao_comercial, 'recencia_compra', e.recencia_compra,
             'valor_historico', e.valor_historico, 'engajamento_conteudo', e.engajamento_conteudo,
             'nivel_memberkit', e.nivel_memberkit, 'posse_produto', e.posse_produto,
             'saude_disparo', e.saude_disparo, 'leadscore', e.leadscore) as eixos
  from _et f
  join qualificador.v_eixos_score e on e.pessoa_id = f.pessoa_id;
end $fn$;

comment on function qualificador.filtrar_em_etapas(jsonb, jsonb) is
  'Cascata de etapas. ordem NULL = passou por tudo. 1–8 é o bloqueio duro (fixo);
   10+ são as etapas montadas na tela, na ordem em que foram empilhadas.';

revoke execute on function qualificador.campo_bate(jsonb, jsonb) from public, anon;
revoke execute on function qualificador.filtrar_em_etapas(jsonb, jsonb) from public, anon;
grant execute on function qualificador.campo_bate(jsonb, jsonb),
                          qualificador.filtrar_em_etapas(jsonb, jsonb)
  to authenticated, service_role;
