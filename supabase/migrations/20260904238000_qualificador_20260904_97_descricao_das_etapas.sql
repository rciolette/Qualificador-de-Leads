-- O texto de ajuda embaixo do campo ainda dizia "Traduzido dos IDs de dealstage
-- pelo config da integração" e dava exemplos no formato antigo ("IS · Ganho").
-- Desde a migration 93 vem da API, com os nomes reais e todos os pipelines --
-- ajuda que descreve o comportamento antigo é pior que ajuda nenhuma.
update qualificador.campo_filtravel set descricao =
  'Pipeline e etapa de cada negócio, com o nome que o HubSpot usa: '
  '"Vendas | Inside Sales · Ganho", "Vendas | E-cont · Em conexão". '
  'Lido da API do HubSpot, todas as etapas de todos os pipelines.'
where id = 'hs.etapas_negocio';

update qualificador.campo_filtravel set descricao =
  'Só as etapas de ganho, pelo que a API marca como fechado-ganho — não pelo nome, '
  'porque "Ganho" num pipeline é "Negócio fechado" em outro.'
where id = 'hs.ganhos_negocio';
