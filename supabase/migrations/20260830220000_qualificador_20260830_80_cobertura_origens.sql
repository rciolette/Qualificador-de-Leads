-- O que o seletor de origem precisa saber para o usuário escolher com
-- informação, em vez de descobrir depois que a lista murchou.
--
-- Cobertura aqui é por PLATAFORMA, não por campo: quantas pessoas da base
-- existem naquela origem. É outra pergunta da que `cobertura_campo` responde --
-- "Aulas assistidas" cobre 97,9% *das pessoas que estão na MemberClass*, e a
-- pergunta do cartão é quantas estão lá, ponto.
--
-- `ultima_sync` conta só as operações que TRAZEM dado (`sync`, `espelhar`,
-- `importar`). `testar` só verifica a credencial e não atualiza nada -- contá-la
-- faria uma origem parada há três dias parecer fresca por causa de um clique em
-- "testar conexão".
--
-- O status gravado é 'ok', não 'concluida': foi conferido em
-- integracao_execucao antes de escrever isto.
create or replace function qualificador.cobertura_origens()
returns table (
  slug text, nome text, ativa boolean,
  pessoas bigint, base bigint,
  ultima_sync timestamptz, horas_desde numeric,
  vencida boolean, limite_horas int
)
language sql
volatile
set search_path to 'qualificador', 'pg_catalog'
as $function$
  with b as (
    select count(*) as total,
           count(*) filter (where (dados->>'tem_crm')::boolean)        as hubspot,
           count(*) filter (where (dados->>'tem_memberclass')::boolean) as memberclass,
           count(*) filter (where (dados->>'tem_memberkit')::boolean)   as memberkit,
           count(*) filter (where (dados->>'tem_sellflux')::boolean)    as sellflux
      from qualificador.pessoa_dados
  ),
  ult as (
    select e.integracao_id, max(e.executado_em) as quando
      from qualificador.integracao_execucao e
     where e.status = 'ok' and e.operacao in ('sync','espelhar','importar')
     group by e.integracao_id
  )
  select i.slug, i.nome_exibicao, i.ativa,
         case i.slug
           when 'hubspot' then b.hubspot when 'memberclass' then b.memberclass
           when 'memberkit' then b.memberkit when 'sellflux' then b.sellflux
           else 0::bigint end,
         b.total,
         u.quando,
         round(extract(epoch from (now() - u.quando)) / 3600.0, 1),
         -- nunca sincronizada conta como vencida: é o estado em que menos se
         -- pode confiar, não o mais fresco
         u.quando is null
           or now() - u.quando > make_interval(hours => coalesce(i.frescor_limite_horas, 24)),
         coalesce(i.frescor_limite_horas, 24)
    from qualificador.integracao i
    cross join b
    left join ult u on u.integracao_id = i.id
   where i.slug in ('hubspot','memberclass','memberkit','sellflux')
   order by 4 desc
$function$;

comment on function qualificador.cobertura_origens() is
  'Por plataforma: quantas pessoas da base existem nela, quando foi a ultima '
  'sincronizacao que trouxe dado, e se passou do frescor_limite_horas.';

revoke execute on function qualificador.cobertura_origens() from public, anon;
grant execute on function qualificador.cobertura_origens() to authenticated, service_role;
