-- `caixa` não existe no portal. A property é `caixa_disponivel` — label "Caixa
-- Disponível", descrição "Representa o Caixa disponível daquele lead". Pedir o
-- nome errado não dá erro no HubSpot: ele simplesmente devolve o negócio sem a
-- chave, e a coluna vira 0 em silêncio. Foi o que aconteceu em 1.565 negócios.
update qualificador.integracao
   set config = jsonb_set(config, '{props_negocio}',
         (select jsonb_agg(distinct p order by p)
            from jsonb_array_elements_text(
              (config->'props_negocio') - 'caixa' || '["caixa_disponivel"]'::jsonb) p))
 where slug = 'hubspot';

select jsonb_array_length(config->'props_negocio') from qualificador.integracao where slug='hubspot';
