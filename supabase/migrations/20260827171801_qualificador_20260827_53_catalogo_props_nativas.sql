-- Tarefa 2 · passo 3 do desenho: as properties cruas do HubSpot entram no
-- catálogo com `fonte` nativa, que é o que liga o caminho `props` / `props_deals`
-- em `condicao_avalia` e `valor_do_campo`.
--
-- Só agora é seguro: até a migration 52, todo campo com fonte nativa de NEGÓCIO
-- devolveria vazio. Ordem confirmada pelo Raphael (opção B).
--
-- Três critérios de corte, para o seletor não encher de campo inútil:
--   1. cobertura real medida em 27/08 — nada com 0%;
--   2. nada que já exista como campo derivado (produtos, E-cont, leadscore,
--      falha_sellflux, times_com_deal já estão catalogados e continuam valendo);
--   3. nada que dependa de de-para para ser legível — `dealstage` e `pipeline`
--      são IDs e esperam o vocabulário do passo 4.

insert into qualificador.campo_filtravel
  (id, fonte, caminho, rotulo, grupo, tipo, operadores, descricao, ordem)
values
-- ------------------------------------------------- contato (props)
  ('hsc.primeira_origem', 'hubspot_contato', 'cliente_no_funil',
   'Origem de tráfego · primeira', 'HubSpot · contato', 'enum',
   array['e_um_de','nao_e_um_de','contem','preenchido','vazio'],
   'HubSpot, contato: `cliente_no_funil`. O nome interno engana — o label no portal é "Origem de Tráfego (Primeira Origem)". 99,8% de cobertura; o valor mais comum é "IniciAmazon | Nath".', 80),

  ('hsc.origem_recente', 'hubspot_contato', 'origem_de_trafego_origem_mais_recente',
   'Origem de tráfego · mais recente', 'HubSpot · contato', 'enum',
   array['e_um_de','nao_e_um_de','contem','preenchido','vazio'],
   'HubSpot, contato: `origem_de_trafego_origem_mais_recente`. 99,8% de cobertura.', 81),

  ('hsc.tipo_de_venda', 'hubspot_contato', 'tipo_de_venda',
   'Tipo de venda · contato', 'HubSpot · contato', 'enum',
   array['e_um_de','nao_e_um_de','contem','preenchido','vazio'],
   'HubSpot, contato: `tipo_de_venda`. 99,6% de cobertura.', 82),

  ('hsc.compra_iniciamazon', 'hubspot_contato', 'data_da_compra_do_iniciamazon',
   'Data da compra do IniciAmazon', 'HubSpot · contato', 'data',
   array['depois_de','antes_de','entre','preenchido','vazio'],
   'HubSpot, contato: `data_da_compra_do_iniciamazon`. 99,6% de cobertura.', 83),

  ('hsc.ultima_compra', 'hubspot_contato', 'data_da_ultima_compra',
   'Data da última compra · HubSpot', 'HubSpot · contato', 'data',
   array['depois_de','antes_de','entre','preenchido','vazio'],
   'HubSpot, contato: `data_da_ultima_compra`. Só 15% de cobertura — a data da Assiny (`Data da última compra`, grupo Compra) é mais confiável.', 84),

  ('hsc.assiny_client_id', 'hubspot_contato', 'assiny_client_id',
   'Tem ClientId da Assiny no CRM', 'HubSpot · contato', 'texto',
   array['preenchido','vazio','igual'],
   'HubSpot, contato: `assiny_client_id`. 78% de cobertura. Serve para achar quem o CRM ainda não amarrou à Assiny.', 85),

-- ------------------------------------------------- negócio (props_deals)
-- Estes iteram os N negócios da pessoa. O `quantificador` da condição
-- (`algum`, padrão, ou `todo`) decide se basta um negócio satisfazer.
  ('hsn.origem_de_trafego', 'hubspot_negocio', 'origem_de_trafego',
   'Origem de tráfego do negócio', 'HubSpot · negócio', 'enum',
   array['e_um_de','nao_e_um_de','contem','preenchido','vazio'],
   'HubSpot, negócio: `origem_de_trafego`. 100% das pessoas com negócio. ATENÇÃO: 483 das 567 têm negócios que discordam entre si — use o quantificador.', 86),

  ('hsn.tipo_de_venda', 'hubspot_negocio', 'tipo_de_venda',
   'Tipo de venda do negócio', 'HubSpot · negócio', 'enum',
   array['e_um_de','nao_e_um_de','contem','preenchido','vazio'],
   'HubSpot, negócio: `tipo_de_venda`. 99,6% das pessoas com negócio.', 87),

  ('hsn.amount', 'hubspot_negocio', 'amount',
   'Valor do negócio', 'HubSpot · negócio', 'numero',
   array['maior_igual','menor_igual','entre','preenchido','vazio'],
   'HubSpot, negócio: `amount`. 99,6% das pessoas com negócio.', 88),

  ('hsn.createdate', 'hubspot_negocio', 'createdate',
   'Data de criação do negócio', 'HubSpot · negócio', 'data',
   array['depois_de','antes_de','entre','preenchido','vazio'],
   'HubSpot, negócio: `createdate`. 100% das pessoas com negócio.', 89),

  ('hsn.closedate', 'hubspot_negocio', 'closedate',
   'Data de fechamento do negócio', 'HubSpot · negócio', 'data',
   array['depois_de','antes_de','entre','preenchido','vazio'],
   'HubSpot, negócio: `closedate`. 99% das pessoas com negócio.', 90),

  ('hsn.tempo_cadencia', 'hubspot_negocio', 'disparo_sellflux_tempo_ate_receber_cadencia',
   'Tempo até receber a cadência', 'HubSpot · negócio', 'numero',
   array['maior_igual','menor_igual','entre','preenchido','vazio'],
   'HubSpot, negócio: `disparo_sellflux_tempo_ate_receber_cadencia`. 60% das pessoas com negócio.', 91),

  ('hsn.renda_mensal', 'hubspot_negocio', 'renda_mensal',
   'Renda mensal declarada', 'HubSpot · negócio', 'enum',
   array['e_um_de','nao_e_um_de','contem','preenchido','vazio'],
   'HubSpot, negócio: `renda_mensal`. Insumo do leadscore, vem do Typeform. 13% das pessoas com negócio — só quem respondeu a pesquisa.', 92),

  ('hsn.nivel_consciencia', 'hubspot_negocio', 'nivel_de_consciencia',
   'Nível de consciência', 'HubSpot · negócio', 'enum',
   array['e_um_de','nao_e_um_de','contem','preenchido','vazio'],
   'HubSpot, negócio: `nivel_de_consciencia`. Insumo do leadscore. 13% das pessoas com negócio.', 93)
on conflict (id) do nothing;

-- `caixa_disponivel` e `investimento_disponivel` NÃO entram ainda: estão em 0%
-- porque foram acrescentadas ao config depois da última leitura. Catalogar campo
-- que devolve vazio é o que a ordem do Raphael (opção B) evita. Entram depois do
-- re-sync — ver seção 4 do CLAUDE.md.
--
-- `dealstage` e `pipeline` também ficam de fora: são IDs, e sem o vocabulário do
-- passo 4 o usuário filtraria por número. `Time com negócio` (`hs.times_deal`) já
-- cobre o caso prático hoje.
