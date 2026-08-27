-- Qualificador de Leads ROI · migration 40
-- Fecha os 26 alertas do get_advisors que citavam `qualificador`.
--
-- O mais grave: credencial_ler estava executável por `authenticated`. Qualquer um
-- dos quatro usuários com login podia chamar credencial_ler('hubspot') e receber
-- o Private App token em texto puro — e o mesmo para Sellflux, MemberKit e
-- MemberClass. A migration 10 já revogava isso; um CREATE OR REPLACE posterior
-- restaurou o grant padrão (EXECUTE para PUBLIC), que é o comportamento do
-- Postgres ao recriar função. Revogar depois de cada replace não é opcional.
--
-- Nenhuma destas funções é chamada pelo front: quem as usa são as Edge Functions,
-- que conectam por SUPABASE_DB_URL como postgres e não passam por estes grants.

do $do$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'qualificador' and p.prosecdef
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.assinatura);
    execute format('grant execute on function %s to service_role', f.assinatura);
  end loop;
end $do$;

-- has_min_papel é a exceção: as policies de RLS a chamam em nome do usuário,
-- então authenticated PRECISA poder executá-la. É SECURITY DEFINER de propósito
-- (lê user_profiles ignorando a RLS da própria tabela) e não devolve segredo:
-- só um booleano sobre o papel de quem já está autenticado.
grant execute on function qualificador.has_min_papel(qualificador.papel) to authenticated;

-- search_path explícito nas funções que ficaram sem (regra 8 do blueprint).
-- ALTER em vez de CREATE OR REPLACE: não precisamos do corpo para fixar o path.
do $do$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'qualificador'
      and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = pg_catalog', f.assinatura);
  end loop;
end $do$;

-- As duas views da Tarefa 0-B nasceram SECURITY DEFINER (padrão do Postgres).
-- Lêem apenas tabelas de `qualificador`, então invoker funciona e respeita a RLS
-- de quem consulta — que é o padrão de todas as outras views do schema.
alter view qualificador.v_chaves_pessoa      set (security_invoker = true);
alter view qualificador.v_cobertura_espelhos set (security_invoker = true);
