-- Qualificador de Leads ROI · migration 08
-- Decisao do Raphael em 26/08/2026: os dois projetos E-cont sao servico contabil
-- e nao tem area de membros. Isso e diferente de "ainda nao classificado" --
-- a metrica da camada 1 (fase 3) precisa distinguir os dois casos.

alter table qualificador.projeto
  add column area_membros_nao_se_aplica boolean not null default false;

comment on column qualificador.projeto.area_membros_nao_se_aplica is
  'true = projeto de servico, sem area de membros por natureza (E-cont).
   A metrica "projetos Assiny sem area de membros" conta apenas
   area_membros is null AND NOT area_membros_nao_se_aplica.';

alter table qualificador.projeto
  add constraint projeto_area_membros_coerente
  check (not (area_membros is not null and area_membros_nao_se_aplica));

-- ECONT CONTABILIDADE DO ECOMMERCE: 2.370 transacoes, ausente do anexo A do PRD.
-- Entra no catalogo para deixar de bloquear a importacao.
insert into qualificador.projeto
  (organizacao_assiny, id_organizacao_assiny, nome_assiny, id_projeto_assiny,
   area_membros, area_membros_nao_se_aplica, ativo, observacao)
values
  ('ECONT CONTABILIDADE DO ECOMMERCE LTDA', '500c661f-c8bf-47d7-a84b-44717b8e0fa9',
   'ECONT CONTABILIDADE DO ECOMMERCE', 'e13f8d5d-9a2c-444c-aa82-308a18bb5dee',
   null, true, true,
   'Ausente do anexo A do PRD; encontrado no export com 2.370 transacoes.
    Classificado por decisao do Raphael em 26/08/2026: servico contabil, sem area de membros.')
on conflict (nome_assiny) do update set
  id_organizacao_assiny     = excluded.id_organizacao_assiny,
  id_projeto_assiny         = excluded.id_projeto_assiny,
  area_membros_nao_se_aplica = excluded.area_membros_nao_se_aplica,
  observacao                = excluded.observacao;

update qualificador.projeto set
  area_membros_nao_se_aplica = true,
  observacao = 'Definitivo desde junho/2026. Servico contabil: sem area de membros por natureza
                (decisao do Raphael em 26/08/2026), nao por falta de classificacao.'
where id_projeto_assiny = '811990c2-ccfb-4d9d-82ab-c5b2af5de6a9';   -- ECONT BH
