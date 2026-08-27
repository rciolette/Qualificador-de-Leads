-- Tarefa 0-B · espelhos das fontes pequenas.
--
-- Os adaptadores MemberKit, MemberClass e Sellflux perguntavam "uma pessoa por vez":
-- 1.293 chamadas HTTP por execucao. Nenhuma das tres fontes e grande -- MemberKit tem
-- 1.433 membros no total. Espelhar a fonte inteira e cruzar em SQL troca a fase de rede
-- proporcional a NOSSA base por uma proporcional a fonte.
--
-- Tudo dentro do schema qualificador. Nada em public nem em dash.

-- ------------------------------------------------------------------ normalizacao
-- Mesma regra dos tres espelhos e da tabela pessoa. Chave de telefone sao os ultimos
-- 11 digitos porque a Sellflux devolve o numero sem DDI e sem mascara (51999999999),
-- enquanto pessoa.telefone_e164 guarda +5551999999999.

create or replace function qualificador.chave_email(v text)
returns text language sql immutable as $$
  select nullif(lower(trim(coalesce(v, ''))), '')
$$;

create or replace function qualificador.chave_documento(v text)
returns text language sql immutable as $$
  select case
    when length(regexp_replace(coalesce(v, ''), '\D', '', 'g')) >= 11
      then regexp_replace(v, '\D', '', 'g')
  end
$$;

create or replace function qualificador.chave_telefone(v text)
returns text language sql immutable as $$
  select case
    when length(regexp_replace(coalesce(v, ''), '\D', '', 'g')) >= 10
      then right(regexp_replace(v, '\D', '', 'g'), 11)
  end
$$;

-- ------------------------------------------------------------------ tabelas espelho

create table if not exists qualificador.espelho_memberkit (
  externo_id      text primary key,
  chave_email     text,
  chave_documento text,
  chave_telefone  text,
  payload         jsonb not null,
  coletado_em     timestamptz not null default now()
);

create table if not exists qualificador.espelho_memberclass (
  externo_id      text primary key,
  chave_email     text,
  chave_documento text,
  chave_telefone  text,
  payload         jsonb not null,
  coletado_em     timestamptz not null default now()
);

create table if not exists qualificador.espelho_sellflux (
  externo_id      text primary key,
  chave_email     text,
  chave_documento text,
  chave_telefone  text,
  payload         jsonb not null,
  coletado_em     timestamptz not null default now()
);

create index if not exists espelho_memberkit_email_idx   on qualificador.espelho_memberkit (chave_email);
create index if not exists espelho_memberkit_doc_idx     on qualificador.espelho_memberkit (chave_documento);
create index if not exists espelho_memberkit_tel_idx     on qualificador.espelho_memberkit (chave_telefone);
create index if not exists espelho_memberclass_email_idx on qualificador.espelho_memberclass (chave_email);
create index if not exists espelho_memberclass_doc_idx   on qualificador.espelho_memberclass (chave_documento);
create index if not exists espelho_memberclass_tel_idx   on qualificador.espelho_memberclass (chave_telefone);
create index if not exists espelho_sellflux_email_idx    on qualificador.espelho_sellflux (chave_email);
create index if not exists espelho_sellflux_doc_idx      on qualificador.espelho_sellflux (chave_documento);
create index if not exists espelho_sellflux_tel_idx      on qualificador.espelho_sellflux (chave_telefone);

comment on table qualificador.espelho_memberkit is
  'Copia local da academia MemberKit inteira (~1.433 membros). Cruzamento e em SQL, nao em HTTP.';
comment on table qualificador.espelho_memberclass is
  'Copia local do /api/v1/student/report -- o relatorio do tenant inteiro, sem filtro de email.';
comment on table qualificador.espelho_sellflux is
  'Copia local de /api/v1/lead/project. email vem null na maioria dos leads: o casamento e por telefone.';

alter table qualificador.espelho_memberkit   enable row level security;
alter table qualificador.espelho_memberclass enable row level security;
alter table qualificador.espelho_sellflux    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['espelho_memberkit','espelho_memberclass','espelho_sellflux'] loop
    execute format('drop policy if exists %I_leitor on qualificador.%I', t, t);
    execute format('drop policy if exists %I_operador on qualificador.%I', t, t);
    execute format(
      'create policy %I_leitor on qualificador.%I for select using (qualificador.has_min_papel(''leitor''))', t, t);
    execute format(
      'create policy %I_operador on qualificador.%I for all using (qualificador.has_min_papel(''operador'')) with check (qualificador.has_min_papel(''operador''))', t, t);
    execute format('grant select, insert, update, delete on qualificador.%I to authenticated, service_role', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ log de execucao
-- registrar_execucao ja devolve o id da linha. Faltava fechar uma execucao aberta:
-- criterio de aceite 5 -- nenhum botao "Sincronizando..." sem linha correspondente.

create or replace function qualificador.finalizar_execucao(
  p_id bigint, p_status text, p_registros integer default null,
  p_duracao_ms integer default null, p_erro text default null
) returns bigint
language sql security definer set search_path = qualificador, public as $$
  update qualificador.integracao_execucao
     set status = p_status,
         registros = coalesce(p_registros, registros),
         duracao_ms = coalesce(p_duracao_ms, duracao_ms),
         erro = left(p_erro, 2000)
   where id = p_id
  returning id;
$$;

-- ------------------------------------------------------------------ casamento
-- Todas as chaves conhecidas de uma pessoa, vindas da tabela pessoa E de
-- pessoa_identificador (5.167 linhas que o SQL do briefing deixaria de fora).

create or replace view qualificador.v_chaves_pessoa as
  select p.id as pessoa_id, 'email'::text as tipo, qualificador.chave_email(p.email) as chave
    from qualificador.pessoa p where p.email is not null
  union
  select p.id, 'documento', qualificador.chave_documento(p.documento)
    from qualificador.pessoa p where p.documento is not null
  union
  select p.id, 'telefone', qualificador.chave_telefone(p.telefone_e164)
    from qualificador.pessoa p where p.telefone_e164 is not null
  union
  select pi.pessoa_id, 'documento', qualificador.chave_documento(pi.valor_norm)
    from qualificador.pessoa_identificador pi where pi.tipo = 'documento'
  union
  select pi.pessoa_id, 'telefone', qualificador.chave_telefone(pi.valor_norm)
    from qualificador.pessoa_identificador pi where pi.tipo = 'telefone'
  union
  select pi.pessoa_id, 'email', qualificador.chave_email(pi.valor_norm)
    from qualificador.pessoa_identificador pi where pi.tipo = 'email';

grant select on qualificador.v_chaves_pessoa to authenticated, service_role;

-- Casa o espelho de uma fonte com as pessoas. Email vence documento, que vence
-- telefone -- so a melhor chave de cada pessoa sobrevive, e ela fica registrada
-- em casou_por: e esse numero que mostra quanto da base so existe por telefone.
create or replace function qualificador.casar_espelho(p_fonte text)
returns table (pessoa_id uuid, externo_id text, payload jsonb, casou_por text)
language plpgsql stable security definer set search_path = qualificador, public as $$
declare
  v_tabela text;
begin
  v_tabela := case p_fonte
    when 'memberkit'   then 'espelho_memberkit'
    when 'memberclass' then 'espelho_memberclass'
    when 'sellflux'    then 'espelho_sellflux'
    else null end;
  if v_tabela is null then
    raise exception 'Fonte sem espelho: %', p_fonte;
  end if;

  return query execute format($f$
    select distinct on (k.pessoa_id)
           k.pessoa_id, e.externo_id, e.payload, k.tipo
      from qualificador.v_chaves_pessoa k
      join qualificador.%I e
        on (k.tipo = 'email'     and e.chave_email     = k.chave)
        or (k.tipo = 'documento' and e.chave_documento = k.chave)
        or (k.tipo = 'telefone'  and e.chave_telefone  = k.chave)
     where k.chave is not null
     order by k.pessoa_id,
              case k.tipo when 'email' then 1 when 'documento' then 2 else 3 end,
              e.coletado_em desc
  $f$, v_tabela);
end $$;

grant execute on function qualificador.casar_espelho(text) to authenticated, service_role;

-- ------------------------------------------------------------------ proveniencia
-- Sem isso a tela de integracoes nao consegue responder "casou por que chave?".

alter table qualificador.engajamento   add column if not exists casou_por text;
alter table qualificador.saude_disparo add column if not exists casou_por text;
