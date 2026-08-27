-- O terceiro insumo do leadscore (valor de investimento) estava documentado como
-- `invest_mes`, que é o nome no Typeform, não no HubSpot. Confirmado com o
-- Raphael em 27/08: a property do negócio é `investimento_disponivel`
-- (label "Investimento disponível"). Os outros candidatos medidos
-- — cs_valor_disponivel_para_investimento, agendamento__capital_para_investimento,
-- potencial_de_investimento — ficam de fora.
--
-- Vale a mesma armadilha da migration 50: o Batch Read do HubSpot ignora
-- property inexistente SEM ERRO. Nome errado não falha, devolve vazio.
update qualificador.integracao
   set config = jsonb_set(config, '{props_negocio}',
         (select jsonb_agg(distinct p order by p)
            from jsonb_array_elements_text(
              (config->'props_negocio') || '["investimento_disponivel"]'::jsonb) p))
 where slug = 'hubspot';
