-- Qualificador de Leads ROI · Fase 2 · migration 10
-- Gravacao e leitura de credenciais no Supabase Vault, prefixo qualificador_ (PRD 8.5).
-- O valor do token nunca fica em tabela do schema e nao ha caminho de leitura para o front.

create or replace function qualificador.credencial_salvar(
  p_user_id uuid, p_slug text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $fn$
declare
  v_papel     qualificador.papel;
  v_nome      text;
  v_existente uuid;
  v_token     text := btrim(p_token);
  v_mascara   text;
begin
  select papel into v_papel from qualificador.user_profiles where user_id = p_user_id;
  if v_papel is distinct from 'gestao'::qualificador.papel then
    raise exception 'Somente o papel gestao grava credencial (usuario %, papel %)',
      p_user_id, coalesce(v_papel::text, 'nenhum') using errcode = 'insufficient_privilege';
  end if;

  if v_token is null or length(v_token) < 8 then
    raise exception 'Token ausente ou curto demais' using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(credencial_ref, 'qualificador_' || slug) into v_nome
    from qualificador.integracao where slug = p_slug;
  if not found then
    raise exception 'Integracao "%" nao existe em qualificador.integracao', p_slug
      using errcode = 'no_data_found';
  end if;

  -- trava do PRD 11: jamais reaproveitar segredo de outro sistema
  if v_nome not like 'qualificador\_%' then
    raise exception 'credencial_ref "%" nao comeca com qualificador_', v_nome
      using errcode = 'check_violation';
  end if;

  select id into v_existente from vault.secrets where name = v_nome;
  if v_existente is null then
    perform vault.create_secret(
      new_secret => v_token, new_name => v_nome,
      new_description => 'Qualificador de Leads ROI - ' || p_slug);
  else
    perform vault.update_secret(
      secret_id => v_existente, new_secret => v_token, new_name => v_nome,
      new_description => 'Qualificador de Leads ROI - ' || p_slug);
  end if;

  v_mascara := repeat(chr(8226), 6) || right(v_token, 4);

  update qualificador.integracao set
    credencial_ref       = v_nome,
    credencial_mascara   = v_mascara,
    credencial_criada_em = now(),
    ativa                = true
  where slug = p_slug;

  return jsonb_build_object(
    'slug', p_slug, 'credencial_ref', v_nome, 'mascara', v_mascara,
    'substituida', v_existente is not null, 'gravada_em', now());
end
$fn$;

comment on function qualificador.credencial_salvar(uuid, text, text) is
  'Grava o token no Vault sob qualificador_<slug> e guarda apenas nome e mascara na tabela.
   Exige papel gestao. Nao existe funcao que devolva o token ao front.';

create or replace function qualificador.credencial_ler(p_slug text)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $fn$
declare v_nome text; v_token text;
begin
  select credencial_ref into v_nome from qualificador.integracao where slug = p_slug;
  if v_nome is null then
    raise exception 'Integracao "%" sem credencial gravada', p_slug using errcode = 'no_data_found';
  end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where name = v_nome;
  if v_token is null then
    raise exception 'Segredo "%" nao encontrado no Vault', v_nome using errcode = 'no_data_found';
  end if;
  return v_token;
end
$fn$;

comment on function qualificador.credencial_ler(text) is
  'SOMENTE para os conectores (Edge Function). Nunca conceder a authenticated nem a anon.';

create or replace function qualificador.registrar_execucao(
  p_slug text, p_operacao text, p_status text,
  p_registros int default null, p_duracao_ms int default null, p_erro text default null)
returns bigint
language sql
security definer
set search_path = pg_catalog
as $fn$
  insert into qualificador.integracao_execucao
    (integracao_id, operacao, status, registros, duracao_ms, erro)
  select i.id, p_operacao, p_status, p_registros, p_duracao_ms, left(p_erro, 2000)
  from qualificador.integracao i where i.slug = p_slug
  returning id;
$fn$;

-- Ninguem alem do service_role toca nessas tres.
revoke execute on function qualificador.credencial_salvar(uuid, text, text) from public, anon, authenticated;
revoke execute on function qualificador.credencial_ler(text)                from public, anon, authenticated;
revoke execute on function qualificador.registrar_execucao(text, text, text, int, int, text)
  from public, anon, authenticated;
grant execute on function qualificador.credencial_salvar(uuid, text, text) to service_role;
grant execute on function qualificador.credencial_ler(text)                to service_role;
grant execute on function qualificador.registrar_execucao(text, text, text, int, int, text) to service_role;
