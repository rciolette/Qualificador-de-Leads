-- Qualificador de Leads ROI · Fase 4 · migration 26a
-- Participação em evento: o dado que o cartão H (EVENTO) filtra.
--
-- Uma lista de webinar não gera transação, então sem esta tabela o participante
-- entrava como pessoa e a informação de qual evento e se compareceu se perdia.
-- O blueprint é explícito: "presença no evento é o filtro mais forte que existe
-- na fase pós".

create table qualificador.participacao (
  pessoa_id     uuid not null references qualificador.pessoa(id) on delete cascade,
  evento        text not null,
  presente      boolean,
  data          timestamptz,
  importacao_id uuid references qualificador.importacao(id) on delete set null,
  registrado_em timestamptz not null default now(),
  primary key (pessoa_id, evento)
);
comment on column qualificador.participacao.presente is
  'NULL = inscrito, presença desconhecida. Diferente de false (faltou).';
create index participacao_evento_idx on qualificador.participacao (evento, presente);

alter table qualificador.participacao enable row level security;
create policy participacao_leitor on qualificador.participacao
  for select to authenticated using (qualificador.has_min_papel('leitor'));
create policy participacao_operador on qualificador.participacao
  for all to authenticated
  using (qualificador.has_min_papel('operador')) with check (qualificador.has_min_papel('operador'));
grant select, insert, update, delete on qualificador.participacao to authenticated;
grant all on qualificador.participacao to service_role;

-- "sim/não", "presente/ausente", "compareceu" viram booleano.
-- Qualquer outra coisa vira NULL: melhor não saber do que inventar presença.
create or replace function qualificador.norm_presenca(v text)
returns boolean language sql immutable
set search_path = pg_catalog as $fn$
  select case lower(btrim(coalesce(v, '')))
    when 'sim' then true      when 'yes' then true       when 's' then true
    when 'y' then true        when 'true' then true      when '1' then true
    when 'x' then true        when 'presente' then true  when 'compareceu' then true
    when 'participou' then true
    when 'nao' then false     when 'não' then false      when 'no' then false
    when 'n' then false       when 'false' then false    when '0' then false
    when 'ausente' then false when 'faltou' then false   when 'no-show' then false
    when 'noshow' then false
  end
$fn$;

revoke execute on function qualificador.norm_presenca(text) from public, anon;
grant  execute on function qualificador.norm_presenca(text) to authenticated, service_role;
