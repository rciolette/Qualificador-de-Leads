-- Qualificador de Leads ROI · Fase 4 · migration 25
-- Perfis de peso e recortes prontos (blueprint seção 04).
-- Em tabela, não em código: o próprio blueprint diz que os perfis serão calibrados
-- contra resultado real depois do primeiro ciclo. Ajustar peso não pode exigir deploy.

create table qualificador.perfil_peso (
  slug        text primary key,
  nome        text not null,
  tipo        qualificador.tipo_iniciativa,
  fase        qualificador.fase_iniciativa,
  pesos       jsonb not null,
  observacao  text,
  ordem       int not null default 0
);

insert into qualificador.perfil_peso (slug, nome, tipo, fase, pesos, observacao, ordem) values
 ('corujao_recuperar_perdido', 'Corujão · recuperar perdido', 'corujao', null,
  '{"relacao_comercial":10,"recencia_compra":6,"valor_historico":7,"engajamento_conteudo":2,
    "nivel_memberkit":2,"posse_produto":3,"saude_disparo":8,"leadscore":4}', null, 1),
 ('corujao_expansao', 'Corujão · expansão de carteira', 'corujao', null,
  '{"relacao_comercial":6,"recencia_compra":8,"valor_historico":8,"engajamento_conteudo":5,
    "nivel_memberkit":4,"posse_produto":10,"saude_disparo":6,"leadscore":3}', null, 2),
 ('launch_atrair', 'Launch · atrair', 'launch', 'atrair',
  '{"relacao_comercial":2,"recencia_compra":3,"valor_historico":2,"engajamento_conteudo":8,
    "nivel_memberkit":2,"posse_produto":4,"saude_disparo":9,"leadscore":6}', null, 3),
 ('launch_converter', 'Launch · converter', 'launch', 'converter',
  '{"relacao_comercial":5,"recencia_compra":4,"valor_historico":6,"engajamento_conteudo":10,
    "nivel_memberkit":5,"posse_produto":7,"saude_disparo":7,"leadscore":5}', null, 4),
 ('webinar_pre', 'Webinar · pré', 'webinar', 'pre',
  '{"relacao_comercial":2,"recencia_compra":2,"valor_historico":2,"engajamento_conteudo":8,
    "nivel_memberkit":2,"posse_produto":3,"saude_disparo":9,"leadscore":7}', null, 5),
 ('webinar_pos', 'Webinar · pós', 'webinar', 'pos',
  '{"relacao_comercial":6,"recencia_compra":3,"valor_historico":5,"engajamento_conteudo":10,
    "nivel_memberkit":3,"posse_produto":5,"saude_disparo":6,"leadscore":3}', null, 6),
 ('econt_abertura_cnpj', 'Abertura de CNPJ · E-cont', 'pontual', null,
  '{"relacao_comercial":8,"recencia_compra":9,"valor_historico":2,"engajamento_conteudo":9,
    "nivel_memberkit":10,"posse_produto":10,"saude_disparo":7,"leadscore":1}',
  'O teste do modelo: Leadscore quase desligado, nível MemberKit no máximo. Ter mentoria já
   provou a operação — renda declarada em formulário não acrescenta nada.', 7);

-- ------------------------------------------------------------------- recortes
create table qualificador.recorte (
  slug        text primary key,
  nome        text not null,
  criterio    text not null,
  filtros     jsonb not null,
  perfil_peso text references qualificador.perfil_peso(slug),
  -- Diagnóstico não gera disparo: vira tarefa ou descanso. O app precisa saber
  -- disso para não deixar alguém exportar um recorte de diagnóstico como lista.
  diagnostico boolean not null default false,
  destino     text,
  ordem       int not null default 0
);

insert into qualificador.recorte (slug, nome, criterio, filtros, perfil_peso, diagnostico, destino, ordem) values
 ('perdido_com_dinheiro', 'Perdido com dinheiro',
  'Deal Perdido em IS ou AE · teve compra na Assiny · sem disparo há 30d',
  '{"hubspot":{"situacao":["perdido"],"pipelines":[711246125,710485361]},
    "assiny":{"tem_compra":true},
    "saude_disparo":{"sem_disparo_dias":30}}',
  'corujao_recuperar_perdido', false, null, 1),

 ('comprou_e_sumiu', 'Comprou e sumiu',
  '1ª compra há 60–180d · sem recompra · último acesso > 30d',
  '{"assiny":{"dias_desde_primeira_compra":{"min":60,"max":180},"tipo_compra":"primeira"},
    "membros":{"memberclass":{"ultimo_acesso_dias":{"min":30}}}}',
  'corujao_recuperar_perdido', false, null, 2),

 ('aluno_quente_sem_mentoria', 'Aluno quente sem mentoria',
  'MemberClass aulas alto + acesso ≤ 7d · sem produto de mentoria nos ativos',
  '{"membros":{"memberclass":{"aulas_concluidas":{"min":3},"ultimo_acesso_dias":{"max":7}}},
    "hubspot":{"produtos_ativos_excluir":["Mentoria ROI","Consultoria Estratégica","Mentoria 1x1"]}}',
  'launch_converter', false, null, 3),

 ('expansao', 'Expansão',
  'Produto no card e nos ativos → oferta adjacente',
  '{"hubspot":{"cruzamento_produto":"expansao"}}',
  'corujao_expansao', false, null, 4),

 ('renovacao_a_vencer', 'Renovação a vencer',
  'data_fim_plano_econt nos próximos 45d · aux_econt_servico = true',
  '{"hubspot":{"econt":{"modo":"incluir","servico_ativo":true,
     "fim_plano":{"proximos_dias":45}}}}',
  'corujao_expansao', false, null, 5),

 ('candidato_a_cnpj', 'Candidato a CNPJ',
  'Mentoria comprada ≤ 90d ou IniciAmazon muito engajado · sem auxecont_abertura_de_cnpj',
  '{"hubspot":{"econt":{"modo":"ignorar","abertura_cnpj":false}},
    "ou":[{"membros":{"memberkit":{"tem_produto_pago":true}},
           "assiny":{"dias_desde_ultima_compra":{"max":90}}},
          {"membros":{"memberclass":{"aulas_concluidas":{"min":5}}}}]}',
  'econt_abertura_cnpj', false, null, 6),

 ('inscrito_ausente', 'Inscrito ausente',
  'Inscrito no webinar · não compareceu',
  '{"evento":{"presenca":"ausente"}}',
  'webinar_pos', false, null, 7),

 ('furo_de_atribuicao', 'Furo de atribuição',
  'Produto nos ativos, em nenhum card',
  '{"hubspot":{"cruzamento_produto":"furo"}}',
  null, true, 'Vira tarefa no HubSpot: precisa de dono comercial antes de qualquer contato.', 8),

 ('sem_conexao_historica', 'Sem conexão histórica',
  '3+ disparos em 90d com disparo_sellflux_conectou = false',
  '{"saude_disparo":{"toques_sem_resposta_min":3,"janela_dias":90}}',
  null, true, 'Candidato a descanso, não a lista.', 9);

alter table qualificador.perfil_peso enable row level security;
alter table qualificador.recorte     enable row level security;

create policy perfil_peso_leitor on qualificador.perfil_peso
  for select to authenticated using (qualificador.has_min_papel('leitor'));
create policy perfil_peso_gestao on qualificador.perfil_peso
  for all to authenticated
  using (qualificador.has_min_papel('gestao')) with check (qualificador.has_min_papel('gestao'));
create policy recorte_leitor on qualificador.recorte
  for select to authenticated using (qualificador.has_min_papel('leitor'));
create policy recorte_gestao on qualificador.recorte
  for all to authenticated
  using (qualificador.has_min_papel('gestao')) with check (qualificador.has_min_papel('gestao'));

grant select, insert, update, delete on qualificador.perfil_peso, qualificador.recorte to authenticated;
grant all on qualificador.perfil_peso, qualificador.recorte to service_role;
