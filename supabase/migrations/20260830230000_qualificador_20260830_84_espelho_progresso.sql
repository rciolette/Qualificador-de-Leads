-- Onde o espelhamento parou, para que o cron possa retomar.
--
-- `qualificador-espelhar` processa ~60 s por invocação e devolve
-- `status: 'continua'` com a página e a execução. Quem retomava era o front, no
-- laço do navegador -- o que sempre foi frágil (fechar a aba deixa o espelho
-- parcial, e a função APAGA a tabela antes de reconstruir) e é impossível para
-- um cron: `pg_net` é assíncrono e não encadeia respostas.
--
-- Com o progresso no banco, cada chamada do cron avança um pedaço e a seguinte
-- continua de onde parou. A função continua NÃO se re-invocando -- essa decisão
-- veio de um incidente real em que dois ramos de retomada se duplicaram, o pool
-- de workers saturou e derrubou o `qualificador-sync`, que nada tinha a ver.
--
-- Fecha a dívida 4 da seção 4 do CLAUDE.md.

create table if not exists qualificador.espelho_progresso (
  fonte         text primary key,
  pagina        int not null default 1,
  execucao_id   bigint,
  iniciado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  concluido_em  timestamptz
);

comment on table qualificador.espelho_progresso is
  'Ponto de retomada do espelhamento por fonte. Uma linha por fonte; '
  'concluido_em nao nulo = a ultima rodada terminou e a proxima comeca do zero.';

alter table qualificador.espelho_progresso enable row level security;

drop policy if exists espelho_progresso_leitor on qualificador.espelho_progresso;
create policy espelho_progresso_leitor on qualificador.espelho_progresso
  for select to authenticated
  using (qualificador.has_min_papel('leitor'::qualificador.papel));

-- quem escreve é a Edge Function, pelo SUPABASE_DB_URL
revoke all on qualificador.espelho_progresso from public, anon;
grant select on qualificador.espelho_progresso to authenticated;

-- Uma rodada abandonada há mais de `p_teto_horas` é descartada e o espelhamento
-- recomeça: a alternativa seria retomar da página 300 de uma foto cuja primeira
-- metade tem dois dias, e um espelho meio velho meio novo é pior que um espelho
-- inteiro velho -- ninguém consegue dizer qual parte confiar.
create or replace function qualificador.espelho_retomar(p_fonte text, p_teto_horas int default 6)
returns table (pagina int, execucao_id bigint)
language sql
volatile
set search_path to 'qualificador', 'pg_catalog'
as $function$
  select case when p.concluido_em is null
                   and p.atualizado_em > now() - make_interval(hours => p_teto_horas)
              then p.pagina else 1 end,
         case when p.concluido_em is null
                   and p.atualizado_em > now() - make_interval(hours => p_teto_horas)
              then p.execucao_id else null end
    from qualificador.espelho_progresso p
   where p.fonte = p_fonte
  union all
  select 1, null::bigint
   where not exists (select 1 from qualificador.espelho_progresso where fonte = p_fonte)
  limit 1
$function$;

create or replace function qualificador.espelho_marcar(
  p_fonte text, p_pagina int, p_execucao bigint, p_concluido boolean)
returns void
language sql
volatile
set search_path to 'qualificador', 'pg_catalog'
as $function$
  insert into qualificador.espelho_progresso
    (fonte, pagina, execucao_id, iniciado_em, atualizado_em, concluido_em)
  values (p_fonte, p_pagina, p_execucao, now(), now(),
          case when p_concluido then now() end)
  on conflict (fonte) do update set
    pagina        = excluded.pagina,
    execucao_id   = excluded.execucao_id,
    atualizado_em = now(),
    concluido_em  = case when p_concluido then now() end,
    -- só reinicia o relógio da rodada quando ela de fato recomeça
    iniciado_em   = case when excluded.pagina <= 1
                         then now() else qualificador.espelho_progresso.iniciado_em end
$function$;

do $do$
declare f text;
begin
  foreach f in array array[
    'qualificador.espelho_retomar(text, int)',
    'qualificador.espelho_marcar(text, int, bigint, boolean)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $do$;
