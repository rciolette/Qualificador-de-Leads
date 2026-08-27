-- Qualificador de Leads ROI · migration 14
-- Prepara o schema para ser exposto no Data API (PostgREST).
--
-- A doc do Supabase ("Using Custom Schemas") sugere GRANT ALL ... TO anon,
-- authenticated, service_role. NÃO seguimos isso por dois motivos:
--
--   1. `anon` nunca deve enxergar nada aqui. O Qualificador é ferramenta interna;
--      não existe caminho anônimo. A RLS já barraria, mas negar USAGE do schema
--      é a primeira camada, e camada que não depende de policy escrita certa.
--   2. GRANT ALL ON ALL ROUTINES desfaria os revokes de credencial_salvar,
--      credencial_ler e registrar_execucao, que só o service_role pode executar.
--      Um GRANT amplo aqui daria a qualquer usuário logado o token do HubSpot.

revoke all on schema qualificador from anon;

-- tabelas e views futuras já nascem legíveis para quem deve ler
alter default privileges for role postgres in schema qualificador
  grant select, insert, update, delete on tables to authenticated;
alter default privileges for role postgres in schema qualificador
  grant all on tables to service_role;
alter default privileges for role postgres in schema qualificador
  grant usage, select on sequences to authenticated, service_role;

-- funções novas NÃO ganham execute automático: cada uma decide, uma a uma.
alter default privileges for role postgres in schema qualificador
  revoke execute on functions from public;

comment on schema qualificador is
  'Qualificador de Leads ROI (PRD v1.0). Isolado de public e dash: RBAC proprio,
   segredos proprios, zero FK cruzando schema. Exposto no Data API para authenticated;
   anon nao tem USAGE.';
