-- Qualificador de Leads ROI · Fase 2 · migration 12
-- Mapa de etapas do HubSpot validado contra dados reais em 26/08/2026
-- (contagem de negocios por pipeline x dealstage no portal 49607200).
-- O bloqueio duro do PRD 7.1 nao pode filtrar por label: "Novos"/"Novo" e
-- "Em conexao"/"Em Conexao" variam entre pipelines. Sempre por ID.

update qualificador.integracao set config = config || jsonb_build_object(
  'stages_bloqueio_duro', jsonb_build_array(
     1037982864, 1037982865,   -- AE    · Novos      · Em conexao
     1038878479, 1038878480,   -- IS    · Novos      · Em Conexao
     1047780485, 1047780486),  -- ECONT · Novo       · Em conexao
  'stages_por_pipeline', jsonb_build_object(
    '710485361', jsonb_build_object('time','AE','novos',1037982864,'em_conexao',1037982865,
       'conectado',1037982866,'ganho',1037811332,'perdido',1037811333),
    '711246125', jsonb_build_object('time','IS','novos',1038878479,'em_conexao',1038878480,
       'conectado',1038878481,'qualificacao',1284877843,'ganho',1038914120,'perdido',1038914121),
    '717654561', jsonb_build_object('time','ECONT','novos',1047780485,'em_conexao',1047780486,
       'conectado',1047780487,'banco_de_leads',1232916556,'em_negociacao',1345942844,
       'ganho',1047780490,'perdido',1047780491)),
  'props_contato', jsonb_build_array(
     'email','firstname','lastname','phone','mobilephone',
     'classificacao_leadscore','leadscore',
     'produtos__servicos_ativos','produtos_servicos_contratados',
     'aux_econt_servico','plano_econt','duracao_plano_econt',
     'data_inicio_plano_econt','data_fim_plano_econt',
     'auxecont_abertura_de_cnpj','auxecont_alteracao_cnpj','auxecont_multa_cnpj',
     'origem_de_trafego_origem_mais_recente','cliente_no_funil','tipo_de_venda',
     'data_da_compra_do_iniciamazon','data_da_ultima_compra',
     'disparo_sellflux_cadencia_iniciada','disparo_sellflux_datahora_do_inicio_da_cadencia',
     'disparo_sellflux_conectou','disparo_sellflux_datahora_da_conexao',
     'disparo_sellflux_mensagem_da_cadencia','disparo_sellflux_econt_conectado',
     'reversao___perdido_na_cadencia','cadencia_sdr_mensagens_enviadas',
     'aux_proprietario_sellflux','sdr_conectado',
     'sdr_motivo_de_perdido','nhub_motivo_de_perdido',
     'assiny_client_id','assiny_documento_do_cliente'),
  'props_negocio', jsonb_build_array(
     'pipeline','dealstage','hs_is_closed_lost','closedate','createdate','amount',
     'origem_de_trafego','produtos___servicos_contratados','tipo_de_venda',
     'aux_falha_sellflux','disparo_sellflux_msg_de_erro_da_cadencia',
     'disparo_sellflux_tempo_ate_receber_cadencia'),
  'correcoes_ao_anexo_b', jsonb_build_object(
     'aux_falha_sellflux', 'Esta no NEGOCIO, nao no contato. O bloqueio duro
        "falha de entrega" exige descer ao deal -- nao sai de um lote de contatos.',
     'cliente_no_funil', 'Label real e "Origem de Trafego (Primeira Origem)",
        nao "Cliente no Funil da Nath ou Tome".',
     'etapas_extras', 'Qualificacao (1284877843) no IS; Banco de Leads (1232916556)
        e Em Negociacao (1345942844) no ECONT -- nenhuma citada no PRD.')
) where slug = 'hubspot';
