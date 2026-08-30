-- Recalcular o funil custava 6,0 s. Medido fase a fase, com 4.430 pessoas:
--
--   montar o objeto de dados por pessoa ... 2.175 ms
--   os 8 updates de bloqueio duro .........  492 ms
--   o laço de etapas (`campo_bate`) .......  138 ms
--   o join lateral com v_eixos_score ......  134 ms
--
-- A suspeita de que `condicao_avalia` linha a linha fosse o gargalo estava
-- errada: o laço inteiro custa 138 ms. O peso está em MONTAR o objeto --
-- `to_jsonb(v)` de uma view de 61 colunas cujos subplans rodam por pessoa
-- (jsonb_array_elements + sort, 4.430 loops cada). E isso era refeito a cada
-- clique, embora o dado não mude entre um clique e outro.
--
-- Então ele passa a ser materializado. A validade tem duas condições:
--
--   1. nenhuma tabela-fonte mudou desde a última montagem -- garantido por
--      triggers statement-level que marcam a foto como suja;
--   2. é o mesmo dia -- `v_pessoa_completa` usa CURRENT_DATE em
--      `dias_desde_ultima_compra` e afins, então a foto envelhece sozinha à
--      meia-noite, sem que fonte nenhuma tenha mudado.
--
-- Sem a condição 2 o funil passaria a mentir todo dia de manhã, em silêncio --
-- exatamente o tipo de erro que este schema já pagou caro.

create table if not exists qualificador.pessoa_dados (
  pessoa_id uuid primary key references qualificador.pessoa(id) on delete cascade,
  dados     jsonb not null
);

comment on table qualificador.pessoa_dados is
  'Foto do objeto que o funil julga: to_jsonb(v_pessoa_completa) + props + props_deals. '
  'Cache derivado, reconstruído por garantir_pessoa_dados(); nunca fonte da verdade.';

create table if not exists qualificador.pessoa_dados_estado (
  unico        boolean primary key default true check (unico),
  suja         boolean not null default true,
  dia          date,
  atualizada_em timestamptz
);
insert into qualificador.pessoa_dados_estado (unico, suja) values (true, true)
  on conflict (unico) do nothing;

alter table qualificador.pessoa_dados        enable row level security;
alter table qualificador.pessoa_dados_estado enable row level security;

-- Quem monta lista é operador, e é quem paga a reconstrução. O papel `leitor`
-- só lê: se a foto estiver suja para ele, o funil cai no caminho lento em vez
-- de devolver dado velho.
drop policy if exists pessoa_dados_leitor on qualificador.pessoa_dados;
create policy pessoa_dados_leitor on qualificador.pessoa_dados
  for select to authenticated using (qualificador.has_min_papel('leitor'::qualificador.papel));
drop policy if exists pessoa_dados_operador on qualificador.pessoa_dados;
create policy pessoa_dados_operador on qualificador.pessoa_dados
  for all to authenticated
  using (qualificador.has_min_papel('operador'::qualificador.papel))
  with check (qualificador.has_min_papel('operador'::qualificador.papel));

drop policy if exists pessoa_dados_estado_leitor on qualificador.pessoa_dados_estado;
create policy pessoa_dados_estado_leitor on qualificador.pessoa_dados_estado
  for select to authenticated using (qualificador.has_min_papel('leitor'::qualificador.papel));
drop policy if exists pessoa_dados_estado_operador on qualificador.pessoa_dados_estado;
create policy pessoa_dados_estado_operador on qualificador.pessoa_dados_estado
  for all to authenticated
  using (qualificador.has_min_papel('operador'::qualificador.papel))
  with check (qualificador.has_min_papel('operador'::qualificador.papel));

revoke all on qualificador.pessoa_dados, qualificador.pessoa_dados_estado from public, anon;
grant select, insert, update, delete on qualificador.pessoa_dados to authenticated;
grant select, update on qualificador.pessoa_dados_estado to authenticated;

create or replace function qualificador.sujar_pessoa_dados()
returns trigger
language plpgsql
security definer
set search_path to 'qualificador', 'pg_catalog'
as $function$
begin
  update qualificador.pessoa_dados_estado set suja = true where not suja;
  return null;
end $function$;

comment on function qualificador.sujar_pessoa_dados() is
  'Trigger STATEMENT-level: marca a foto de pessoa_dados como suja. '
  'Statement-level de proposito -- por linha, uma ingestao de 4.947 transacoes '
  'faria 4.947 updates na mesma linha de controle.';

do $do$
declare t text;
begin
  foreach t in array array[
    'pessoa','transacao','projeto','engajamento','crm_snapshot','saude_disparo','participacao'
  ] loop
    execute format('drop trigger if exists %I on qualificador.%I', 'trg_sujar_' || t, t);
    execute format(
      'create trigger %I after insert or update or delete or truncate on qualificador.%I
         for each statement execute function qualificador.sujar_pessoa_dados()',
      'trg_sujar_' || t, t);
  end loop;
end $do$;

create or replace function qualificador.garantir_pessoa_dados()
returns boolean
language plpgsql
volatile
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  e qualificador.pessoa_dados_estado%rowtype;
begin
  select * into e from qualificador.pessoa_dados_estado;
  if found and not e.suja and e.dia = current_date then
    return true;   -- foto válida
  end if;

  -- serializa: dois recálculos simultâneos reconstruiriam a mesma foto duas vezes
  perform pg_advisory_xact_lock(hashtext('qualificador.pessoa_dados'));

  select * into e from qualificador.pessoa_dados_estado;
  if found and not e.suja and e.dia = current_date then
    return true;   -- outra transação reconstruiu enquanto esperávamos o lock
  end if;

  delete from qualificador.pessoa_dados;
  insert into qualificador.pessoa_dados (pessoa_id, dados)
  select v.pessoa_id,
         to_jsonb(v)
           || jsonb_build_object('props',       coalesce(c.props, '{}'::jsonb))
           || jsonb_build_object('props_deals', coalesce(c.props_deals, '{}'::jsonb))
    from qualificador.v_pessoa_completa v
    left join qualificador.crm_snapshot c on c.pessoa_id = v.pessoa_id;

  update qualificador.pessoa_dados_estado
     set suja = false, dia = current_date, atualizada_em = now();
  return true;
exception when insufficient_privilege then
  -- papel `leitor` não reconstrói: quem chamou cai no caminho lento, que é
  -- lento mas correto. Devolver a foto velha seria devolver número errado.
  return false;
end $function$;

comment on function qualificador.garantir_pessoa_dados() is
  'Reconstrói pessoa_dados se estiver suja ou for de outro dia. '
  'Devolve false quando quem chamou não tem permissão de escrever -- aí o '
  'chamador precisa montar o objeto na hora, nunca usar a foto velha.';

do $do$
declare f text;
begin
  foreach f in array array[
    'qualificador.garantir_pessoa_dados()',
    'qualificador.sujar_pessoa_dados()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $do$;
