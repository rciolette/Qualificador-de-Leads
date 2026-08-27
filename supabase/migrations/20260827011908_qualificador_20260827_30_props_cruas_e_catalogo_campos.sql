-- Qualificador de Leads ROI · migration 30
-- Filtragem em etapas por qualquer campo, inclusive properties nativas do HubSpot.
--
-- Até aqui o crm_snapshot guardava só o subconjunto de properties que o código
-- conhecia. Para filtrar por "campos nativos do contato e do negócio" é preciso
-- guardar o que veio, cru — o portal tem 1.039 properties de contato e nenhuma
-- lista fixa em código sobreviveria ao primeiro campo novo que a operação criar.

alter table qualificador.crm_snapshot
  add column props       jsonb,
  add column props_deals jsonb;

comment on column qualificador.crm_snapshot.props is
  'Properties do CONTATO como o HubSpot devolveu. Filtro por campo nativo lê daqui.';
comment on column qualificador.crm_snapshot.props_deals is
  'Properties dos NEGÓCIOS, um objeto por deal. aux_falha_sellflux e a família
   disparo_sellflux_aux_da_N_msg só existem aqui — no contato elas não estão.';

create index crm_snapshot_props_idx       on qualificador.crm_snapshot using gin (props);
create index crm_snapshot_props_deals_idx on qualificador.crm_snapshot using gin (props_deals);

-- ------------------------------------------------------------- catálogo de campos
-- O que a tela oferece para filtrar. Campos modelados entram no seed; campos
-- nativos são descobertos do próprio dado, para não haver lista para manter.
create table qualificador.campo_filtravel (
  id         text primary key,
  fonte      text not null,
  caminho    text not null,
  rotulo     text not null,
  grupo      text,
  tipo       text not null,
  operadores text[] not null,
  descricao  text,
  ordem      int not null default 0
);
comment on table qualificador.campo_filtravel is
  'Campos que a tela oferece. tipo determina o editor e os operadores válidos:
   texto, numero, data, booleano, lista, enum.';

alter table qualificador.campo_filtravel enable row level security;
create policy campo_filtravel_leitor on qualificador.campo_filtravel
  for select to authenticated using (qualificador.has_min_papel('leitor'));
create policy campo_filtravel_gestao on qualificador.campo_filtravel
  for all to authenticated
  using (qualificador.has_min_papel('gestao')) with check (qualificador.has_min_papel('gestao'));
grant select, insert, update, delete on qualificador.campo_filtravel to authenticated;
grant all on qualificador.campo_filtravel to service_role;

insert into qualificador.campo_filtravel (id, fonte, caminho, rotulo, grupo, tipo, operadores, descricao, ordem) values
 -- ---------------------------------------------------------------- identidade
 ('pessoa.email',      'pessoa','email','E-mail','Identidade','texto',
  array['preenchido','vazio','contem','igual'], null, 1),
 ('pessoa.telefone',   'pessoa','telefone_e164','Telefone','Identidade','texto',
  array['preenchido','vazio','contem'], 'Sem telefone válido a pessoa nunca entra em lista.', 2),
 ('pessoa.documento',  'pessoa','documento','CPF / CNPJ','Identidade','texto',
  array['preenchido','vazio','contem'], null, 3),

 -- -------------------------------------------------------------------- Assiny
 ('assiny.projetos',    'assiny','projetos','Projeto','Compra (Assiny)','lista',
  array['contem_algum','nao_contem_nenhum'], null, 10),
 ('assiny.organizacoes','assiny','organizacoes','Organização','Compra (Assiny)','lista',
  array['contem_algum','nao_contem_nenhum'], null, 11),
 ('assiny.produtos',    'assiny','produtos','Produto comprado','Compra (Assiny)','lista',
  array['contem_algum','nao_contem_nenhum'], null, 12),
 ('assiny.ofertas',     'assiny','ofertas','Oferta','Compra (Assiny)','lista',
  array['contem_algum','nao_contem_nenhum'], null, 13),
 ('assiny.utm_sources', 'assiny','utm_sources','UTM source','Compra (Assiny)','lista',
  array['contem_algum','nao_contem_nenhum'], null, 14),
 ('assiny.compras',     'assiny','compras','Número de compras','Compra (Assiny)','numero',
  array['maior_igual','menor_igual','entre','igual'], null, 15),
 ('assiny.valor_total', 'assiny','valor_total','Valor acumulado','Compra (Assiny)','numero',
  array['maior_igual','menor_igual','entre'], 'Soma de todas as transações da pessoa, em reais.', 16),
 ('assiny.dias_ultima', 'assiny','dias_desde_ultima_compra','Dias desde a última compra','Compra (Assiny)','numero',
  array['maior_igual','menor_igual','entre'], null, 17),
 ('assiny.dias_primeira','assiny','dias_desde_primeira_compra','Dias desde a primeira compra','Compra (Assiny)','numero',
  array['maior_igual','menor_igual','entre'], null, 18),
 ('assiny.ultima_compra','assiny','ultima_compra','Data da última compra','Compra (Assiny)','data',
  array['depois_de','antes_de','entre'], null, 19),

 -- --------------------------------------------------------------- MemberClass
 ('mc.tem_conta',   'memberclass','tem_memberclass','Tem conta na MemberClass','IniciAmazon (MemberClass)','booleano',
  array['e_verdadeiro','e_falso'], 'Falso pode significar que a fonte nunca sincronizou — confira o frescor.', 20),
 ('mc.aulas',       'memberclass','aulas_concluidas','Aulas assistidas','IniciAmazon (MemberClass)','numero',
  array['maior_igual','menor_igual','entre'], null, 21),
 ('mc.dias_acesso', 'memberclass','mc_dias_sem_acessar','Dias sem acessar','IniciAmazon (MemberClass)','numero',
  array['maior_igual','menor_igual','entre'], null, 22),
 ('mc.cadastro',    'memberclass','mc_cadastro','Data de cadastro','IniciAmazon (MemberClass)','data',
  array['depois_de','antes_de','entre'], null, 23),
 ('mc.pagante',     'memberclass','mc_pagante','É pagante','IniciAmazon (MemberClass)','booleano',
  array['e_verdadeiro','e_falso'], null, 24),

 -- ----------------------------------------------------------------- MemberKit
 ('mk.tem_conta',    'memberkit','tem_memberkit','Tem conta no MemberKit','Mentoria (MemberKit)','booleano',
  array['e_verdadeiro','e_falso'], null, 30),
 ('mk.niveis',       'memberkit','mk_niveis','Nível de acesso','Mentoria (MemberKit)','lista',
  array['contem_algum','nao_contem_nenhum'], 'Mistura tiers de lead e produtos pagos — ver o campo abaixo.', 31),
 ('mk.produto_pago', 'memberkit','mk_produto_pago','Tem produto pago','Mentoria (MemberKit)','booleano',
  array['e_verdadeiro','e_falso'], 'Produto pago é prova de operação em andamento, não engajamento.', 32),
 ('mk.dias_acesso',  'memberkit','mk_dias_sem_acessar','Dias sem acessar','Mentoria (MemberKit)','numero',
  array['maior_igual','menor_igual','entre'], null, 33),
 ('mk.bloqueado',    'memberkit','mk_bloqueado','Está bloqueado','Mentoria (MemberKit)','booleano',
  array['e_verdadeiro','e_falso'], null, 34),

 -- ------------------------------------------------------------------- HubSpot
 ('hs.tem_crm',      'hubspot','tem_crm','Existe no HubSpot','HubSpot','booleano',
  array['e_verdadeiro','e_falso'], null, 40),
 ('hs.leadscore_faixa','hubspot','classificacao_leadscore','Faixa de Leadscore','HubSpot','enum',
  array['e_um_de','nao_e_um_de','preenchido','vazio'],
  'Vazio significa "nunca preencheu formulário" — não é lead ruim.', 41),
 ('hs.leadscore_num','hubspot','leadscore','Leadscore numérico','HubSpot','numero',
  array['maior_igual','menor_igual','entre'], null, 42),
 ('hs.ativos',       'hubspot','produtos_ativos','Produtos e serviços ativos','HubSpot','lista',
  array['contem_algum','nao_contem_nenhum','vazio','preenchido'],
  'produtos__servicos_ativos — DOIS sublinhados. Válidos agora.', 43),
 ('hs.historico',    'hubspot','produtos_historico','Produtos no histórico','HubSpot','lista',
  array['contem_algum','nao_contem_nenhum'],
  'produtos_servicos_contratados — UM sublinhado. Tudo que já teve.', 44),
 ('hs.produtos_deal','hubspot','produtos_do_negocio','Produtos no negócio','HubSpot','lista',
  array['contem_algum','nao_contem_nenhum'],
  'produtos___servicos_contratados — TRÊS sublinhados. Do card, não do contato.', 45),
 ('hs.econt_ativo',  'hubspot','econt_ativo','Tem serviço E-cont ativo','HubSpot','booleano',
  array['e_verdadeiro','e_falso'], 'Atributo, não condenação: cada iniciativa decide.', 46),
 ('hs.econt_fim',    'hubspot','econt_fim_plano','Fim do plano E-cont','HubSpot','data',
  array['depois_de','antes_de','entre','proximos_dias'], null, 47),
 ('hs.econt_cnpj',   'hubspot','econt_abertura_cnpj','Já fez abertura de CNPJ','HubSpot','booleano',
  array['e_verdadeiro','e_falso'], null, 48),
 ('hs.times_deal',   'hubspot','times_com_deal','Time com negócio','HubSpot','lista',
  array['contem_algum','nao_contem_nenhum'], null, 49),

 -- ------------------------------------------------------------------ Sellflux
 ('sf.tem',          'sellflux','tem_sellflux','Existe na Sellflux','Saúde de disparo','booleano',
  array['e_verdadeiro','e_falso'], null, 60),
 ('sf.optout',       'sellflux','unsub_whats','Opt-out de WhatsApp','Saúde de disparo','booleano',
  array['e_verdadeiro','e_falso'], 'Sempre excluído no bloqueio duro — aqui só para inspecionar.', 61),
 ('sf.tags',         'sellflux','tags_sellflux','Tags da Sellflux','Saúde de disparo','lista',
  array['contem_algum','nao_contem_nenhum'], null, 62),
 ('sf.ticket',       'sellflux','ticket_aberto','Ticket aberto','Saúde de disparo','booleano',
  array['e_verdadeiro','e_falso'], 'Conversa ativa com vendedor: não atropelar.', 63),
 ('hs.conectou',     'hubspot','conectou','Conectou em disparo anterior','Saúde de disparo','booleano',
  array['e_verdadeiro','e_falso'], null, 64),
 ('hs.cadencia',     'hubspot','cadencia_iniciada','Já entrou em cadência','Saúde de disparo','booleano',
  array['e_verdadeiro','e_falso'], null, 65),

 -- ------------------------------------------------------------------- eventos
 ('ev.eventos',   'evento','eventos','Inscrito no evento','Evento','lista',
  array['contem_algum','nao_contem_nenhum'], null, 70),
 ('ev.presente',  'evento','presente_em','Compareceu ao evento','Evento','lista',
  array['contem_algum','nao_contem_nenhum'], null, 71),
 ('ev.ausente',   'evento','ausente_em','Faltou ao evento','Evento','lista',
  array['contem_algum','nao_contem_nenhum'], 'O filtro mais forte que existe na fase pós.', 72);
