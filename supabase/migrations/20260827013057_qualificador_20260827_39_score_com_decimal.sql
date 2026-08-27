-- Qualificador de Leads ROI · migration 39
-- lista_item.score era int (como no PRD 5.5), mas aplicar_pesos devolve uma casa
-- decimal. O arredondamento na gravação produzia linhas com score 80 e faixa B —
-- porque a faixa foi calculada com 79,9 e o score gravado virou 80.
--
-- Duas pessoas com o mesmo número e faixas diferentes na mesma tela é o tipo de
-- detalhe que faz a operação parar de confiar na ferramenta.

alter table qualificador.lista_item
  alter column score type numeric(5,1) using score::numeric(5,1);

comment on column qualificador.lista_item.score is
  'Uma casa decimal, igual ao que aplicar_pesos devolve. Arredondar aqui
   dessincroniza score e faixa.';
