-- Qualificador de Leads ROI · Fase 1 · migration 05
-- Corrige o seed do anexo A contra os nomes/IDs REAIS observados em 36 relatorios
-- de transacao da Assiny (196.787 linhas). Divergencias documentadas em observacao.

alter table qualificador.projeto
  add constraint projeto_id_projeto_assiny_key unique (id_projeto_assiny);

create or replace function qualificador.resolver_projeto(p_project_id text, p_nome text)
returns uuid language sql stable
set search_path = qualificador, pg_catalog as $$
  select coalesce(
    (select id from qualificador.projeto
      where id_projeto_assiny = nullif(btrim(p_project_id),'')),
    (select id from qualificador.projeto
      where nome_assiny = btrim(p_nome))
  )
$$;
comment on function qualificador.resolver_projeto(text,text) is
  'Resolve projeto por ProjectId (confiavel) e so entao por nome. public.assiny_projetos tem
   nomes divergentes ("Consutorias & Mentorias", "[CS] Cross & Extensao") -- nao casar por nome com ele.';

-- limpa o seed anterior (nomes sem acento) e regrava com os nomes do export
delete from qualificador.projeto
 where nome_assiny in ('Funil IniciAmazon Tome','CS [Cross & Extensao]','E-cont BH (ROI Ventures)');

insert into qualificador.projeto
  (organizacao_assiny, id_organizacao_assiny, nome_assiny, id_projeto_assiny, area_membros, ativo, observacao)
values
  -- IniciAmazon · produto de entrada · espelho MemberClass
  ('NANA GALEAZZI MIDIA DIGITAL LTDA', '047d7bc7-ff06-4bbf-b803-56a4c841b6b8',
   'NANA GALEAZZI MIDIA DIGITAL', 'ad1101df-8465-47ff-92ba-dc7577cbeb58', 'memberclass', true,
   'IDs ausentes no anexo A do PRD; preenchidos a partir do export.'),
  ('ROI Ventures LTDA', 'ad1a78f6-1f21-40f6-af86-a3165def0a0a',
   'Funil IniciAmazon Nathalia', '66d4699c-3894-47cd-81a7-8d99464ee138', 'memberclass', true, null),
  ('ROI Ventures LTDA', 'ad1a78f6-1f21-40f6-af86-a3165def0a0a',
   'Funil IniciAmazon Tome', 'ab2e617d-1f3d-46ce-852f-b2a35c712183', 'memberclass', true, null),
  ('ROI Ventures LTDA', 'ad1a78f6-1f21-40f6-af86-a3165def0a0a',
   'Funil Coelho', '289b863e-bbf4-4a9a-afb5-dbc65ef4a2e4', 'memberclass', true,
   'Do anexo A. Nao aparece em nenhum dos 36 relatorios analisados -- confirmar se ainda transaciona.'),

  -- Consultorias e Mentorias · mid e high ticket · espelho MemberKit
  ('ROI Ventures LTDA', 'ad1a78f6-1f21-40f6-af86-a3165def0a0a',
   'Consultorias & Mentorias', 'c508ee5b-453d-4cf2-9231-0bd11c686d87', 'memberkit', true, null),
  ('ROI Ventures LTDA', 'ad1a78f6-1f21-40f6-af86-a3165def0a0a',
   'CS [Cross & Extensao]', '619f14b3-af92-4b63-a648-680b1d2c2496', 'memberkit', true, null),
  ('ROI Ventures LTDA', 'ad1a78f6-1f21-40f6-af86-a3165def0a0a',
   'E-cont BH', '0dd85bd3-c08a-4661-8232-d875c5dc689c', 'memberkit', false,
   'Anexo A chama de "E-cont BH (ROI Ventures)"; o export usa "E-cont BH". Projeto antigo:
    nunca usar para venda nova, so retroativo. O definitivo e "ECONT BH".'),

  -- E-cont Contabilidade
  ('ECONTBH CONTABILIDADE DO ECOMMERCE LTDA', '1d7d9a35-ee37-4df3-9364-c2b971b85679',
   'ECONT BH', '811990c2-ccfb-4d9d-82ab-c5b2af5de6a9', null, true,
   'Definitivo desde junho/2026. Area de membros NAO classificada no PRD -- pendencia.')
on conflict (nome_assiny) do update set
  organizacao_assiny    = excluded.organizacao_assiny,
  id_organizacao_assiny = excluded.id_organizacao_assiny,
  id_projeto_assiny     = excluded.id_projeto_assiny,
  area_membros          = excluded.area_membros,
  ativo                 = excluded.ativo,
  observacao            = excluded.observacao;

-- Acentos: o export usa "Funil IniciAmazon Tome" com acento agudo e "CS [Cross & Extensao]"
-- com til. Gravados aqui via update para nao depender do encoding do arquivo de migration.
update qualificador.projeto set nome_assiny = 'Funil IniciAmazon Tom' || chr(233)
 where id_projeto_assiny = 'ab2e617d-1f3d-46ce-852f-b2a35c712183';
update qualificador.projeto set nome_assiny = 'CS [Cross & Extens' || chr(227) || 'o]'
 where id_projeto_assiny = '619f14b3-af92-4b63-a648-680b1d2c2496';

-- NAO seedado de proposito, para exercer o bloqueio do PRD 5.1:
--   ECONT CONTABILIDADE DO ECOMMERCE  proj=e13f8d5d-9a2c-444c-aa82-308a18bb5dee
--   org=500c661f-c8bf-47d7-a84b-44717b8e0fa9  -- 2.370 transacoes, ausente do anexo A.

revoke execute on function qualificador.resolver_projeto(text,text) from public;
grant  execute on function qualificador.resolver_projeto(text,text) to authenticated, service_role;
