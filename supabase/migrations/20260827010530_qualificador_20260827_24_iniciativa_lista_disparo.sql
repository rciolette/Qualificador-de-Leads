-- Qualificador de Leads ROI · Fase 4 · migration 24
-- Iniciativa, lista e anti-fadiga (PRD 5.5 e 5.6 / blueprint seção 04).

create table qualificador.iniciativa (
  id                   uuid primary key default gen_random_uuid(),
  nome                 text not null,
  tipo                 qualificador.tipo_iniciativa not null,
  fase                 qualificador.fase_iniciativa,
  objetivo             text not null,
  times                qualificador.time_comercial[] not null,
  -- ordem de precedência NESTA base. Sem default de propósito: o blueprint diz
  -- que prioridade entre times é parâmetro da base, não regra do sistema.
  prioridade_times     qualificador.time_comercial[],
  janela_ini           date,
  janela_fim           date,
  anti_fadiga_dias     int  not null default 7,
  excluir_perdido_dias int  not null default 15,
  filtros              jsonb not null default '{}'::jsonb,
  pesos                jsonb not null default '{}'::jsonb,
  divisao_times        jsonb,
  perfil_peso          text,
  recorte              text,
  observacao           text,
  aberta               boolean not null default true,
  criada_por           uuid,
  criada_em            timestamptz not null default now(),
  atualizada_em        timestamptz not null default now()
);
comment on column qualificador.iniciativa.anti_fadiga_dias is
  'Configurável para cima, nunca para baixo do default de 7 (blueprint seção 04).';
comment on column qualificador.iniciativa.aberta is
  'Iniciativa aberta entra no cálculo de sobreposição de outras.';

alter table qualificador.iniciativa
  add constraint iniciativa_anti_fadiga_minimo check (anti_fadiga_dias >= 7);

create trigger iniciativa_set_atualizada_em before update on qualificador.iniciativa
  for each row execute function qualificador.tg_atualizado_em();

create table qualificador.lista (
  id            uuid primary key default gen_random_uuid(),
  iniciativa_id uuid not null references qualificador.iniciativa(id) on delete cascade,
  nome          text,
  gerada_em     timestamptz not null default now(),
  total         int,
  por_time      jsonb,
  funil         jsonb,   -- o funil de exclusão congelado no momento da geração
  exportada_em  timestamptz,
  gerada_por    uuid
);
comment on column qualificador.lista.funil is
  'Cópia do funil de exclusão de quando a lista foi gerada. Os dados mudam; o que
   a lista viu, não. Sem isso não dá para explicar meses depois por que alguém saiu.';

create table qualificador.lista_item (
  lista_id     uuid not null references qualificador.lista(id) on delete cascade,
  pessoa_id    uuid not null references qualificador.pessoa(id),
  time         qualificador.time_comercial,
  score        int,
  faixa        text,
  motivo       jsonb,     -- por que entrou, eixo a eixo
  sobreposicao uuid[],    -- outras iniciativas abertas em que também caiu
  resultado    text not null default 'pendente',
  primary key (lista_id, pessoa_id)
);
alter table qualificador.lista_item
  add constraint lista_item_resultado_valido check (resultado in
    ('pendente','enviado','respondido','negocio_criado','ganho','perdido','optout'));
create index lista_item_pessoa_idx on qualificador.lista_item (pessoa_id);
create index lista_item_time_idx   on qualificador.lista_item (lista_id, time, score desc);

create table qualificador.disparo_registro (
  iniciativa_id   uuid not null references qualificador.iniciativa(id) on delete cascade,
  pessoa_id       uuid not null references qualificador.pessoa(id) on delete cascade,
  time            qualificador.time_comercial not null,
  numero_whats    text not null,
  data_do_disparo date not null,
  primary key (iniciativa_id, pessoa_id, time, numero_whats)
);
comment on table qualificador.disparo_registro is
  'Anti-fadiga. O número entra na chave: a regra é sobre a combinação time + número,
   não sobre a pessoa. Times diferentes podem abordar a mesma pessoa na mesma semana.';
create index disparo_registro_janela_idx
  on qualificador.disparo_registro (pessoa_id, time, numero_whats, data_do_disparo desc);

alter table qualificador.iniciativa       enable row level security;
alter table qualificador.lista            enable row level security;
alter table qualificador.lista_item       enable row level security;
alter table qualificador.disparo_registro enable row level security;

do $do$
declare t text;
begin
  foreach t in array array['iniciativa','lista','lista_item','disparo_registro'] loop
    execute format(
      'create policy %1$s_leitor on qualificador.%1$I for select to authenticated
         using (qualificador.has_min_papel(''leitor''))', t);
    execute format(
      'create policy %1$s_operador on qualificador.%1$I for all to authenticated
         using (qualificador.has_min_papel(''operador''))
         with check (qualificador.has_min_papel(''operador''))', t);
  end loop;
end $do$;

grant select, insert, update, delete
  on qualificador.iniciativa, qualificador.lista, qualificador.lista_item,
     qualificador.disparo_registro
  to authenticated;
grant all
  on qualificador.iniciativa, qualificador.lista, qualificador.lista_item,
     qualificador.disparo_registro
  to service_role;
