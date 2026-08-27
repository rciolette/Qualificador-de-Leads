-- Qualificador de Leads ROI · Fase 1 · migration 03
-- Camada de contrato (PRD 3.2). Nenhuma leitura direta de tabela de outro schema.
-- Se public mudar, quebra aqui e so aqui.

create or replace view qualificador.v_ext_assiny_catalogo
with (security_invoker = true) as
select
  o.id        as organizacao_id,
  o.nome      as organizacao_nome,
  p.id        as projeto_id,
  p.nome      as projeto_nome,
  c.id        as catalogo_id,
  c.product_id,
  c.sku,
  c.oferta_id,
  c.oferta_nome,
  c.funil_id,
  c.funil_nome,
  c.valor,
  c.equipe,
  c.sale_type,
  c.confirmado_assiny
from public.assiny_catalogo c
join public.assiny_organizacoes o on o.id = c.organizacao_id
join public.assiny_projetos     p on p.id = c.projeto_id;

create or replace view qualificador.v_ext_deals
with (security_invoker = true) as
select sale_id, deal_id
from public.gerador_sales
where deal_id is not null;
comment on view qualificador.v_ext_deals is
  'Atalho transacao -> deal HubSpot. Economiza chamadas de API (PRD 3.3).';

create or replace view qualificador.v_ext_contato_hubspot
with (security_invoker = true) as
select * from public.v_gerador_contato_hubspot;

create or replace view qualificador.v_ext_atribuicao
with (security_invoker = true) as
select * from public.v_atribuicao_vendas;

grant select on qualificador.v_ext_assiny_catalogo,
                qualificador.v_ext_deals,
                qualificador.v_ext_contato_hubspot,
                qualificador.v_ext_atribuicao
  to authenticated, service_role;
