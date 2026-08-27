-- A migration 41 revogou `campo_bate` de `authenticated` por zelo. Mas
-- `filtrar_em_etapas` é SECURITY INVOKER: ela chama `campo_bate` em nome do
-- usuário logado, e o PostgREST devolvia 403 em toda a tela `/iniciativas/nova`.
--
-- `campo_bate` é função pura — recebe jsonb, devolve boolean, não lê tabela
-- nenhuma. Revogá-la não protegia dado algum; só quebrava o motor.
grant execute on function qualificador.campo_bate(jsonb, jsonb) to authenticated;

-- anon continua de fora: quem não fez login não avalia etapa.
revoke execute on function qualificador.campo_bate(jsonb, jsonb) from public, anon;
