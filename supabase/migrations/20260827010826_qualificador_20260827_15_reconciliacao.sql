-- Tarefa 0-B · reconciliacao em SQL.
-- engajamento sai dos espelhos MemberKit/MemberClass e saude_disparo do espelho
-- Sellflux, por insert...select. Zero HTTP nesta etapa: roda em segundos.

-- Cast defensivo: o payload e o JSON cru da fonte, entao qualquer campo pode vir
-- num formato inesperado. Data invalida vira null, nunca aborta a reconciliacao.
create or replace function qualificador.como_data(v text)
returns date language plpgsql immutable as $$
begin
  if v is null or btrim(v) = '' then return null; end if;
  return (v::timestamptz)::date;
exception when others then
  begin return v::date; exception when others then return null; end;
end $$;

-- unsub_whats vem ora true, ora "true", ora 1. Os tres significam a mesma coisa.
create or replace function qualificador.como_booleano(v jsonb)
returns boolean language sql immutable as $$
  select case
    when v is null or jsonb_typeof(v) = 'null' then null
    when jsonb_typeof(v) = 'boolean' then (v)::text::boolean
    when jsonb_typeof(v) = 'number'  then (v)::text <> '0'
    when lower(v #>> '{}') in ('true','1','t','yes','sim')  then true
    when lower(v #>> '{}') in ('false','0','f','no','nao')  then false
  end
$$;

-- ------------------------------------------------------------------ memberkit
create or replace function qualificador.reconciliar_memberkit()
returns table (casou_por text, pessoas bigint)
language plpgsql security definer set search_path = qualificador, public as $$
declare v_niveis jsonb;
begin
  select coalesce(config -> 'niveis', '{}'::jsonb) into v_niveis
    from qualificador.integracao where slug = 'memberkit';

  create temp table _mk on commit drop as
    select * from qualificador.casar_espelho('memberkit');

  insert into qualificador.engajamento
    (pessoa_id, plataforma, aulas_concluidas, ultimo_acesso, cadastro, niveis,
     dados, casou_por, coletado_em)
  select m.pessoa_id,
         'memberkit'::qualificador.area_membros,
         null,
         qualificador.como_data(m.payload ->> 'current_sign_in_at'),
         qualificador.como_data(m.payload ->> 'created_at'),
         nullif(array(
           select coalesce(
             v_niveis -> 'tier_lead'          ->> (a ->> 'membership_level_id'),
             v_niveis -> 'produto_pago'       ->> (a ->> 'membership_level_id'),
             v_niveis -> 'trilha_progressao'  ->> (a ->> 'membership_level_id'),
             a ->> 'membership_level_id')
           from jsonb_array_elements(coalesce(m.payload -> 'memberships', '[]'::jsonb)) a
           where coalesce(a ->> 'status', 'active') = 'active'
         ), '{}'),
         jsonb_build_object(
           'memberkit_id', m.externo_id,
           'nome', m.payload ->> 'full_name',
           'bloqueado', qualificador.como_booleano(m.payload -> 'blocked'),
           'logins', m.payload ->> 'sign_in_count',
           'tem_produto_pago', exists (
             select 1 from jsonb_array_elements(coalesce(m.payload -> 'memberships', '[]'::jsonb)) a
             where v_niveis -> 'produto_pago' ? (a ->> 'membership_level_id')
               and coalesce(a ->> 'status', 'active') = 'active'),
           'origem', 'espelho'),
         m.casou_por,
         now()
    from _mk m
  on conflict (pessoa_id, plataforma) do update set
    ultimo_acesso = excluded.ultimo_acesso,
    cadastro      = excluded.cadastro,
    niveis        = excluded.niveis,
    dados         = excluded.dados,
    casou_por     = excluded.casou_por,
    coletado_em   = excluded.coletado_em;

  -- o CPF e o telefone que o PRD dava como inexistentes no MemberKit
  insert into qualificador.pessoa_identificador (pessoa_id, tipo, valor_norm, fonte)
  select m.pessoa_id, 'documento'::qualificador.tipo_identificador,
         e.chave_documento, 'memberkit'::qualificador.fonte_dado
    from _mk m join qualificador.espelho_memberkit e using (externo_id)
   where e.chave_documento is not null
  on conflict (tipo, valor_norm) do nothing;

  return query select m.casou_por, count(*) from _mk m group by 1 order by 1;
end $$;

-- ------------------------------------------------------------------ memberclass
create or replace function qualificador.reconciliar_memberclass()
returns table (casou_por text, pessoas bigint)
language plpgsql security definer set search_path = qualificador, public as $$
begin
  create temp table _mc on commit drop as
    select * from qualificador.casar_espelho('memberclass');

  insert into qualificador.engajamento
    (pessoa_id, plataforma, aulas_concluidas, ultimo_acesso, cadastro, niveis,
     dados, casou_por, coletado_em)
  select m.pessoa_id,
         'memberclass'::qualificador.area_membros,
         nullif(m.payload ->> 'quantidade_aulas_assistidas', '')::int,
         qualificador.como_data(m.payload ->> 'ultimo_acesso'),
         qualificador.como_data(m.payload ->> 'data_cadastro'),
         nullif(array(
           select coalesce(d ->> 'name', d ->> 'nome', d #>> '{}')
           from jsonb_array_elements(
             case jsonb_typeof(m.payload -> 'entregas_vinculadas')
               when 'array' then m.payload -> 'entregas_vinculadas'
               else '[]'::jsonb end) d
         ), '{}'),
         jsonb_build_object(
           'memberclass_id', m.externo_id,
           'entregas', m.payload -> 'entregas_vinculadas',
           'origem', 'espelho'),
         m.casou_por,
         now()
    from _mc m
  on conflict (pessoa_id, plataforma) do update set
    aulas_concluidas = excluded.aulas_concluidas,
    ultimo_acesso    = excluded.ultimo_acesso,
    cadastro         = excluded.cadastro,
    niveis           = excluded.niveis,
    dados            = excluded.dados,
    casou_por        = excluded.casou_por,
    coletado_em      = excluded.coletado_em;

  insert into qualificador.pessoa_identificador (pessoa_id, tipo, valor_norm, fonte)
  select m.pessoa_id, 'memberclass_id'::qualificador.tipo_identificador,
         m.externo_id, 'memberclass'::qualificador.fonte_dado
    from _mc m
  on conflict (tipo, valor_norm) do nothing;

  insert into qualificador.pessoa_identificador (pessoa_id, tipo, valor_norm, fonte)
  select m.pessoa_id, 'documento'::qualificador.tipo_identificador,
         e.chave_documento, 'memberclass'::qualificador.fonte_dado
    from _mc m join qualificador.espelho_memberclass e using (externo_id)
   where e.chave_documento is not null
  on conflict (tipo, valor_norm) do nothing;

  return query select m.casou_por, count(*) from _mc m group by 1 order by 1;
end $$;

-- ------------------------------------------------------------------ sellflux
create or replace function qualificador.reconciliar_sellflux()
returns table (casou_por text, pessoas bigint)
language plpgsql security definer set search_path = qualificador, public as $$
begin
  create temp table _sf on commit drop as
    select * from qualificador.casar_espelho('sellflux');

  insert into qualificador.saude_disparo
    (pessoa_id, lead_id_sellflux, unsub_whats, unsub_sms, unsub_call, tags,
     preferential_whats_id, ticket_aberto, atualizado_em, casou_por, coletado_em)
  select m.pessoa_id,
         m.externo_id,
         qualificador.como_booleano(m.payload -> 'unsub_whats'),
         qualificador.como_booleano(m.payload -> 'unsub_sms'),
         qualificador.como_booleano(m.payload -> 'unsub_call'),
         nullif(array(
           select coalesce(t ->> 'name', t #>> '{}')
           from jsonb_array_elements(
             case jsonb_typeof(m.payload -> 'tags')
               when 'array' then m.payload -> 'tags' else '[]'::jsonb end) t
         ), '{}'),
         nullif(m.payload ->> 'preferential_whats_id', ''),
         null,   -- ticket_aberto vem de /crm/tickets, fora do espelho de leads
         nullif(m.payload ->> 'updated_at', '')::timestamptz,
         m.casou_por,
         now()
    from _sf m
  on conflict (pessoa_id) do update set
    lead_id_sellflux      = excluded.lead_id_sellflux,
    unsub_whats           = excluded.unsub_whats,
    unsub_sms             = excluded.unsub_sms,
    unsub_call            = excluded.unsub_call,
    tags                  = excluded.tags,
    preferential_whats_id = excluded.preferential_whats_id,
    atualizado_em         = excluded.atualizado_em,
    casou_por             = excluded.casou_por,
    coletado_em           = excluded.coletado_em;

  return query select m.casou_por, count(*) from _sf m group by 1 order by 1;
end $$;

-- ------------------------------------------------------------------ despachante
create or replace function qualificador.reconciliar(p_fonte text)
returns table (casou_por text, pessoas bigint)
language plpgsql security definer set search_path = qualificador, public as $$
begin
  if not qualificador.has_min_papel('operador') then
    raise exception 'Reconciliar exige papel operador ou gestao';
  end if;
  case p_fonte
    when 'memberkit'   then return query select * from qualificador.reconciliar_memberkit();
    when 'memberclass' then return query select * from qualificador.reconciliar_memberclass();
    when 'sellflux'    then return query select * from qualificador.reconciliar_sellflux();
    else raise exception 'Fonte sem reconciliacao: %', p_fonte;
  end case;
end $$;

grant execute on function qualificador.reconciliar(text) to authenticated, service_role;

-- ------------------------------------------------------------------ diagnostico
-- Quem esta na nossa base e NAO existe na fonte. Substitui o "404 por pessoa"
-- que virava linha de erro no log.
create or replace view qualificador.v_cobertura_espelhos as
  select f.fonte,
         (select count(*) from qualificador.pessoa) as pessoas_base,
         f.no_espelho,
         (select count(*) from qualificador.pessoa) - f.no_espelho as sem_conta
    from (
      select 'memberkit' as fonte,
             (select count(distinct pessoa_id) from qualificador.casar_espelho('memberkit')) as no_espelho
      union all select 'memberclass',
             (select count(distinct pessoa_id) from qualificador.casar_espelho('memberclass'))
      union all select 'sellflux',
             (select count(distinct pessoa_id) from qualificador.casar_espelho('sellflux'))
    ) f;

grant select on qualificador.v_cobertura_espelhos to authenticated, service_role;
