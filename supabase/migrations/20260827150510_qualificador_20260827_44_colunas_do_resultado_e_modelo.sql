-- (1) As colunas que o usuário trouxe pelo caminho precisam sobreviver à geração
-- da lista. `lista.colunas` guarda o cabeçalho resolvido e `lista_item.extras` os
-- valores por pessoa: assim o XLSX baixado em outubro sai igual ao de agosto,
-- mesmo que o espelho da plataforma já tenha mudado. É a mesma razão pela qual
-- `lista.funil` já era congelado.
alter table qualificador.lista      add column if not exists colunas jsonb;
alter table qualificador.lista_item add column if not exists extras  jsonb;

-- (4) O fluxo montado vira modelo reutilizável. Não cabe em `recorte` (que é seed
-- embutido, não do usuário) nem em `iniciativa` (que é a execução, não a receita).
-- `de_para` já nasce aqui, vazio: é onde o mapeamento entre plataformas vai morar
-- quando existir, e o spec exige que ele seja salvo junto com o modelo.
create table if not exists qualificador.modelo_fluxo (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  descricao   text,
  etapas      jsonb not null default '[]'::jsonb,
  colunas     jsonb not null default '[]'::jsonb,
  pesos       jsonb not null default '{}'::jsonb,
  config      jsonb not null default '{}'::jsonb,
  de_para     jsonb not null default '{}'::jsonb,
  criado_por  uuid default auth.uid(),
  criado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on column qualificador.modelo_fluxo.de_para is
  'Reservado para o de-para entre plataformas declarado pelo usuário (item 3 da Tarefa 2). Vazio até lá.';

create unique index if not exists modelo_fluxo_nome_uq
  on qualificador.modelo_fluxo (lower(nome));

alter table qualificador.modelo_fluxo enable row level security;

drop policy if exists modelo_fluxo_leitor on qualificador.modelo_fluxo;
create policy modelo_fluxo_leitor on qualificador.modelo_fluxo
  for select using (qualificador.has_min_papel('leitor'::qualificador.papel));

drop policy if exists modelo_fluxo_operador on qualificador.modelo_fluxo;
create policy modelo_fluxo_operador on qualificador.modelo_fluxo
  for all using (qualificador.has_min_papel('operador'::qualificador.papel))
       with check (qualificador.has_min_papel('operador'::qualificador.papel));

grant select on qualificador.modelo_fluxo to authenticated;
grant insert, update, delete on qualificador.modelo_fluxo to authenticated;

-- de onde a iniciativa saiu, para o histórico não perder a receita
alter table qualificador.iniciativa
  add column if not exists modelo_id uuid references qualificador.modelo_fluxo(id) on delete set null;
