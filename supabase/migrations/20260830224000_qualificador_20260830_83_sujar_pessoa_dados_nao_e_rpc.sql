-- `sujar_pessoa_dados` é função de TRIGGER: ninguém deve poder chamá-la pelo
-- PostgREST. Deixá-la executável por `authenticated` levantava
-- `authenticated_security_definer_function_executable`, e o repo fecha tarefa
-- com zero alerta novo citando `qualificador`.
--
-- Revogar aqui é seguro, ao contrário do caso de `has_min_papel`: o Postgres
-- checa EXECUTE de função de trigger na hora de CRIAR o trigger, não a cada
-- disparo. Conferido: com o grant revogado, um update em `pessoa` continua
-- marcando a foto como suja. Ela segue DEFINER porque escreve em
-- pessoa_dados_estado em nome de quem só pode ler as tabelas-fonte.
revoke execute on function qualificador.sujar_pessoa_dados() from public, anon, authenticated;
grant execute on function qualificador.sujar_pessoa_dados() to service_role;
