-- "canceling statement due to statement timeout" ao gerar a lista.
--
-- Fui eu que causei, na migration 95. Pôr `derivados_negocio(c.deals)` dentro de
-- `v_dados_pessoa` fez a view passar a CALCULAR os derivados por pessoa, com
-- joins em `hubspot_etapa` -- 5.438 ms só para montá-la, e `gerar_lista` faz mais
-- coisa em cima disso. O teto do PostgREST é 8 s.
--
-- A correção é não calcular nada: `pessoa_dados` já tem esse objeto montado, com
-- os derivados dentro, materializado uma vez por dia. A view vira um apelido
-- dela. Medido depois: gerar_lista em 642 ms.
--
-- Isso é seguro porque quem lê a view -- `pessoas_da_etapa` e `gerar_lista` --
-- passa por `filtrar`, que chama `garantir_pessoa_dados()` antes de qualquer
-- coisa. Quando a view é lida, a foto já foi reconstruída se precisava.
--
-- Efeito colateral bom: some o quarto lugar que sabia montar o objeto. Agora são
-- três, e a view não é mais um deles.
create or replace view qualificador.v_dados_pessoa as
  select d.pessoa_id, d.dados from qualificador.pessoa_dados d;

comment on view qualificador.v_dados_pessoa is
  'Apelido de pessoa_dados, mantido porque pessoas_da_etapa e gerar_lista leem '
  'dele. Nao monta nada: a foto ja vem pronta, e montar por pessoa custava 5,4 s.';
