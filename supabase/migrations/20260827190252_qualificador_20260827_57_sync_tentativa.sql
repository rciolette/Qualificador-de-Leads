-- "Consultei e a pessoa não existe lá" é uma resposta legítima, e o app não
-- tinha onde guardá-la.
--
-- `pessoas_para_sync` escolhe quem não tem `crm_snapshot`. Quem não existe no
-- HubSpot nunca vai ter — então voltava para a fila em toda rodada, para sempre.
-- Medido: um lote de 100 achou 44, e as outras 56 reapareceram na rodada
-- seguinte. Com 4.430 pessoas e ~44% de sobreposição, o sync nunca terminava e
-- queimava chamada de API repetindo as mesmas ausências.
--
-- Agora a tentativa é gravada, ache ou não ache. Quem foi procurado há pouco sai
-- da fila pelo mesmo prazo de quem foi encontrado.
create table if not exists qualificador.sync_tentativa (
  pessoa_id  uuid not null references qualificador.pessoa(id) on delete cascade,
  fonte      text not null,
  tentado_em timestamptz not null default now(),
  -- false = a fonte respondeu e a pessoa não está lá. Não é erro.
  encontrado boolean not null,
  primary key (pessoa_id, fonte)
);

comment on table qualificador.sync_tentativa is
  'Uma linha por pessoa por fonte: quando foi procurada e se foi achada. Existe para que "não está lá" saia da fila igual a "está lá" — senão o sync repete as ausências para sempre.';

create index if not exists sync_tentativa_fonte_idx
  on qualificador.sync_tentativa (fonte, tentado_em desc);

alter table qualificador.sync_tentativa enable row level security;

drop policy if exists sync_tentativa_leitor on qualificador.sync_tentativa;
create policy sync_tentativa_leitor on qualificador.sync_tentativa
  for select using (qualificador.has_min_papel('leitor'::qualificador.papel));

drop policy if exists sync_tentativa_operador on qualificador.sync_tentativa;
create policy sync_tentativa_operador on qualificador.sync_tentativa
  for all using (qualificador.has_min_papel('operador'::qualificador.papel))
       with check (qualificador.has_min_papel('operador'::qualificador.papel));

grant select, insert, update, delete on qualificador.sync_tentativa to authenticated;
grant all on qualificador.sync_tentativa to service_role;

-- ------------------------------------------------- gravar o lote de uma vez
create or replace function qualificador.registrar_tentativas(
  p_fonte text, p_todos uuid[], p_encontrados uuid[]
)
returns integer
language sql
security definer
set search_path to 'qualificador', 'pg_catalog'
as $$
  with gravadas as (
    insert into qualificador.sync_tentativa (pessoa_id, fonte, tentado_em, encontrado)
    select x, p_fonte, now(), x = any(coalesce(p_encontrados, '{}'::uuid[]))
    from unnest(coalesce(p_todos, '{}'::uuid[])) x
    on conflict (pessoa_id, fonte) do update
      set tentado_em = excluded.tentado_em,
          encontrado = excluded.encontrado
    returning 1
  )
  select count(*)::int from gravadas
$$;

revoke execute on function qualificador.registrar_tentativas(text, uuid[], uuid[])
  from public, anon;
grant execute on function qualificador.registrar_tentativas(text, uuid[], uuid[])
  to service_role;

-- ------------------------------------------------- a fila passa a respeitá-la
create or replace function qualificador.pessoas_para_sync(
  p_fonte text, p_limite integer default 100, p_max_idade_horas integer default 24
)
returns table(pessoa_id uuid, email text)
language sql
stable
set search_path to 'qualificador', 'pg_catalog'
as $$
  select p.id, p.email
  from qualificador.pessoa p
  left join lateral (
    select case p_fonte
             when 'hubspot'     then (select c.sync_em     from qualificador.crm_snapshot  c where c.pessoa_id = p.id)
             when 'sellflux'    then (select s.coletado_em from qualificador.saude_disparo s where s.pessoa_id = p.id)
             when 'memberclass' then (select e.coletado_em from qualificador.engajamento   e where e.pessoa_id = p.id and e.plataforma = 'memberclass')
             when 'memberkit'   then (select e.coletado_em from qualificador.engajamento   e where e.pessoa_id = p.id and e.plataforma = 'memberkit')
           end as visto_em
  ) v on true
  -- a tentativa vale tanto quanto o dado: procurar e não achar também "viu"
  left join qualificador.sync_tentativa t
    on t.pessoa_id = p.id and t.fonte = p_fonte
  where p.email is not null
    and (v.visto_em is null
         or v.visto_em < now() - make_interval(hours => p_max_idade_horas))
    and (t.tentado_em is null
         or t.tentado_em < now() - make_interval(hours => p_max_idade_horas))
  order by coalesce(v.visto_em, t.tentado_em) asc nulls first, p.criado_em
  limit p_limite;
$$;

revoke execute on function qualificador.pessoas_para_sync(text, integer, integer)
  from public, anon;
grant execute on function qualificador.pessoas_para_sync(text, integer, integer)
  to authenticated, service_role;

-- as 1.396 pessoas que JÁ têm snapshot foram encontradas: registra o histórico
-- para elas não competirem com as que nunca foram procuradas
insert into qualificador.sync_tentativa (pessoa_id, fonte, tentado_em, encontrado)
select c.pessoa_id, 'hubspot', c.sync_em, true
from qualificador.crm_snapshot c
on conflict (pessoa_id, fonte) do nothing;
