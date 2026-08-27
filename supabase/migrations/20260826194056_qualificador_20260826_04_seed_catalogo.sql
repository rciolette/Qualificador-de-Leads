-- Qualificador de Leads ROI · Fase 1 · migration 04
-- Seed do catalogo Assiny (PRD anexo A). Idempotente por nome_assiny.

insert into qualificador.projeto
  (organizacao_assiny, id_organizacao_assiny, nome_assiny, id_projeto_assiny, area_membros, ativo, observacao)
values
  -- IniciAmazon · produto de entrada · espelho MemberClass
  ('NANA GALEAZZI MIDIA DIGITAL LTDA', null,
   'NANA GALEAZZI MIDIA DIGITAL', null, 'memberclass', true, null),
  ('ROI Ventures LTDA', 'ad1a78f6-1f21-40f6-af86-a3165def0a0a',
   'Funil IniciAmazon Nathalia', '66d4699c-3894-47cd-81a7-8d99464ee138', 'memberclass', true, null),
  ('ROI Ventures LTDA', 'ad1a78f6-1f21-40f6-af86-a3165def0a0a',
   'Funil IniciAmazon Tome', 'ab2e617d-1f3d-46ce-852f-b2a35c712183', 'memberclass', true,
   'Nome no relatorio Assiny: "Funil IniciAmazon Tome" (com acento no export).'),
  ('ROI Ventures LTDA', 'ad1a78f6-1f21-40f6-af86-a3165def0a0a',
   'Funil Coelho', '289b863e-bbf4-4a9a-afb5-dbc65ef4a2e4', 'memberclass', true, null),

  -- Consultorias e Mentorias · mid e high ticket · espelho MemberKit
  ('ROI Ventures LTDA', 'ad1a78f6-1f21-40f6-af86-a3165def0a0a',
   'Consultorias & Mentorias', 'c508ee5b-453d-4cf2-9231-0bd11c686d87', 'memberkit', true, null),
  ('ROI Ventures LTDA', 'ad1a78f6-1f21-40f6-af86-a3165def0a0a',
   'CS [Cross & Extensao]', '619f14b3-af92-4b63-a648-680b1d2c2496', 'memberkit', true, null),
  ('ROI Ventures LTDA', 'ad1a78f6-1f21-40f6-af86-a3165def0a0a',
   'E-cont BH (ROI Ventures)', '0dd85bd3-c08a-4661-8232-d875c5dc689c', 'memberkit', false,
   'Projeto antigo. Nunca usar para venda nova -- so retroativo. O definitivo e "ECONT BH".'),

  -- E-cont Contabilidade
  ('ECONTBH CONTABILIDADE DO ECOMMERCE', '1d7d9a35-ee37-4df3-9364-c2b971b85679',
   'ECONT BH', '811990c2-ccfb-4d9d-82ab-c5b2af5de6a9', null, true,
   'Definitivo desde junho/2026. Area de membros NAO classificada no PRD -- pendencia da fase 3.')
on conflict (nome_assiny) do update set
  organizacao_assiny    = excluded.organizacao_assiny,
  id_organizacao_assiny = excluded.id_organizacao_assiny,
  id_projeto_assiny     = excluded.id_projeto_assiny,
  area_membros          = excluded.area_membros,
  ativo                 = excluded.ativo,
  observacao            = excluded.observacao;
