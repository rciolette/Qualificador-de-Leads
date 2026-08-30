-- São DOIS campos diferentes, não o mesmo em dois lugares:
--
--   caixa             CONTATO · grupo "Pesquisa"              · resposta do onboarding
--   caixa_disponivel  NEGÓCIO  · grupo "Informações do negócio" · insumo do leadscore
--
-- O `caixa_disponivel` do negócio já está no config desde a migration 50 e
-- funciona (a chave chega em 6.851 de 8.580 negócios, 2.194 preenchidos). Este
-- arquivo NÃO o toca.
--
-- O que faltava era o `caixa` do CONTATO: nunca esteve em `props_contato`, então
-- zero contatos têm essa chave em `props`. Como o Batch Read do HubSpot ignora
-- property não pedida sem erro, a ausência era silenciosa.
update qualificador.integracao
   set config = jsonb_set(config, '{props_contato}',
         (select jsonb_agg(distinct p order by p)
            from jsonb_array_elements_text(
              (config->'props_contato') || '["caixa"]'::jsonb) p))
 where slug = 'hubspot';

-- Os dois entram no catálogo com rótulos que dizem de onde vêm. Sem isso, dois
-- campos chamados "Caixa" no seletor seriam indistinguíveis — o mesmo problema
-- do "Dias sem acessar" da MemberClass e do MemberKit (seção 5 do CLAUDE.md).
insert into qualificador.campo_filtravel
  (id, fonte, caminho, rotulo, grupo, tipo, operadores, descricao, ordem)
values
  ('hsc.caixa', 'hubspot_contato', 'caixa',
   'Caixa (resposta da pesquisa)', 'HubSpot · contato', 'enum',
   array['e_um_de','nao_e_um_de','contem','preenchido','vazio'],
   'HubSpot, CONTATO: property `caixa`, grupo "Pesquisa" — é o que a pessoa respondeu no onboarding. Não confundir com "Caixa disponível (negócio)", que é outra property, em outro objeto.', 94),

  ('hsn.caixa_disponivel', 'hubspot_negocio', 'caixa_disponivel',
   'Caixa disponível (negócio)', 'HubSpot · negócio', 'enum',
   array['e_um_de','nao_e_um_de','contem','preenchido','vazio'],
   'HubSpot, NEGÓCIO: property `caixa_disponivel`, grupo "Informações do negócio" — insumo do leadscore. Não confundir com "Caixa (resposta da pesquisa)", que é do contato.', 95)
on conflict (id) do update
  set rotulo = excluded.rotulo,
      descricao = excluded.descricao,
      operadores = excluded.operadores;
