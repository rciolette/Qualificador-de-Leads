-- O mesmo jsonb que `filtrar_em_etapas` monta na temp table, agora nomeado: as
-- colunas escolhidas pelo usuário saem daqui, sem repetir o join em cada função.
create or replace view qualificador.v_dados_pessoa
with (security_invoker = true) as
select v.pessoa_id,
       to_jsonb(v)
         || jsonb_build_object('props',       coalesce(c.props, '{}'::jsonb))
         || jsonb_build_object('props_deals', coalesce(c.props_deals, '{}'::jsonb)) as dados
from qualificador.v_pessoa_completa v
left join qualificador.crm_snapshot c on c.pessoa_id = v.pessoa_id;

grant select on qualificador.v_dados_pessoa to authenticated, service_role;

-- `extras` carrega as colunas que o usuário trouxe pelo caminho. O tipo de retorno
-- muda, então é drop e recria — o front é atualizado no mesmo commit.
drop function if exists qualificador.pessoas_da_etapa(jsonb, jsonb, integer, integer);

create function qualificador.pessoas_da_etapa(
  p_etapas jsonb,
  p_config jsonb default '{}'::jsonb,
  p_ordem  integer default null,
  p_limite integer default 200,
  p_colunas jsonb default null
)
returns table(pessoa_id uuid, nome text, email text, telefone text,
              faixa_leadscore text, score numeric, faixa text,
              compras bigint, valor_total numeric, projetos text[],
              extras jsonb)
language plpgsql
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  v_specs jsonb := qualificador.resolver_colunas(p_colunas);
begin
  return query
  select r.pessoa_id, v.nome, v.email, v.telefone_e164,
         v.classificacao_leadscore, r.score, r.faixa,
         v.compras, v.valor_total, v.projetos,
         qualificador.extrair_colunas(d.dados, v_specs)
  from qualificador.filtrar_em_etapas(p_etapas, p_config) r
  join qualificador.v_pessoa_completa v on v.pessoa_id = r.pessoa_id
  join qualificador.v_dados_pessoa    d on d.pessoa_id = r.pessoa_id
  where (p_ordem is null and r.ordem is null)      -- null = a lista final
     or (p_ordem is not null and r.ordem = p_ordem)
  order by r.score desc, v.nome
  limit greatest(1, least(p_limite, 2000));
end $function$;

revoke execute on function qualificador.pessoas_da_etapa(jsonb, jsonb, integer, integer, jsonb)
  from public, anon;
grant execute on function qualificador.pessoas_da_etapa(jsonb, jsonb, integer, integer, jsonb)
  to authenticated, service_role;
