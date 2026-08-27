-- Qualificador de Leads ROI · migration 15
--
-- ATENÇÃO: esta é a ÚNICA migration do projeto que toca algo fora do schema
-- `qualificador`, e foi aplicada com autorização explícita do Raphael em 26/08/2026.
-- Registrada aqui para ninguém redescobrir isso do zero daqui a seis meses.
--
-- O QUE ACONTECEU
-- O painel do Supabase (Integrations -> Data API -> Settings -> Exposed schemas)
-- mostrava "4 of 4 schemas exposed" com `qualificador` marcado e o botão Save
-- desabilitado -- ou seja, a UI dava a alteração como salva. O Postgres discordava:
-- pgrst.db_schemas continuava com três schemas, e toda chamada REST respondia
-- PGRST106 "Invalid schema: qualificador". Salvar de novo pelo painel não resolveu,
-- e `notify pgrst, 'reload config'` também não -- a config no banco é a fonte, e
-- ela é que não tinha sido atualizada.
--
-- É ADITIVO: os três schemas que já existiam continuam na lista. Verificado depois
-- de aplicar que `public` (Gerador de Links) e `dash` (Dashboard) seguem intactos.
--
-- SE O PAINEL SOBRESCREVER ISTO um dia, o sintoma volta a ser PGRST106 e o app
-- mostra a tela "Schema não exposto na API", que explica o caminho. Como a UI já
-- considera os quatro schemas expostos, um Save futuro tende a convergir, não a
-- reverter.

alter role authenticator set pgrst.db_schemas = 'public, graphql_public, dash, qualificador';

-- reload config carrega a lista de schemas; reload schema recarrega o cache de
-- tabelas e funções. Sem o segundo, o PostgREST responde 404 "Could not find the
-- table in the schema cache" mesmo com o schema já exposto.
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
