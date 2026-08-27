-- Qualificador de Leads ROI · Fase 2 · migration 13
-- API do MemberKit conferida na documentacao oficial e contra a academia real em 26/08/2026.
-- Corrige tres pontos do PRD 8.3 / anexo D.

update qualificador.integracao set
  base_url = 'https://memberkit.com.br/api/v1',
  config = jsonb_build_object(
    'auth', jsonb_build_object(
      'modo', 'query_param',
      'parametro', 'api_key',
      'atencao', 'A chave vai na URL, nao em header. NUNCA logar a URL completa.'),
    'endpoint_membro', '/users/{email_ou_id}',
    'rate_limit_por_minuto', 120,
    'page_limit_maximo', 50,
    'headers_paginacao', jsonb_build_array(
      'Current-Page','Page-Limit','Total-Pages','Total-Count','Link'),

    -- anexo C do PRD confirmado nas contagens; os IDs sao novos.
    -- O PRD manda separar tier de lead de produto pago: aqui esta a separacao.
    'niveis', jsonb_build_object(
      'tier_lead', jsonb_build_object(
        '37252','NOVO LEAD',      '37190','[LEAD] TIER A', '37191','[LEAD] TIER B',
        '37192','[LEAD] TIER C',  '37193','[LEAD] TIER D', '37194','[LEAD] TIER E'),
      'produto_pago', jsonb_build_object(
        '36279','Mentoria ROI', '37971','METODO ROI', '37974','MENTORIA ROI LAUNCH'),
      'trilha_progressao', jsonb_build_object(
        '37195','PRIMEIROS R$10.000', '37196','[3/3] - PRIMEIROS R$100.000')),

    'correcoes_ao_prd', jsonb_build_object(
      'cpf_e_telefone',
        'O PRD 8.3 e o anexo D afirmam que o MemberKit nao tem CPF nem telefone e que
         "se o e-mail divergir, a pessoa some". A API retorna cpf_cnpj, phone_local_code
         e phone_number em GET /users/{id}. Existe segunda chave de cruzamento.',
      'auth',
        'Autenticacao e por query param api_key, nao por header.',
      'estrutura',
        'A resposta REST traz enrollments[] e memberships[] na raiz, com membership_level_id.
         O formato access.memberships[].level descrito no PRD e do MCP, que reformata.',
      'rate_limit',
        'Documentado: 120 requisicoes por minuto. O PRD nao menciona.')
  )
where slug = 'memberkit';
