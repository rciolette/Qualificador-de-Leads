-- A lista exportada vinha com as colunas do HubSpot VAZIAS.
--
-- Nome, e-mail e telefone chegavam certos; "Etapa do negócio", "Ganho em
-- (pipeline · etapa)" e "Dias desde o ganho" vinham todas null. O filtro
-- funcionava -- 229 -> 196 -- e a lista não mostrava por quê.
--
-- `v_dados_pessoa` é o QUARTO lugar que monta o objeto de dados da pessoa, e o
-- único que eu não tinha atualizado: `garantir_pessoa_dados`, `medir_cobertura`
-- e `filtrar` ganharam `derivados_negocio` nas migrations 88 e 89, esta view
-- ficou para trás. Como `pessoas_da_etapa` e `gerar_lista` leem dela, a prévia e
-- o XLSX perderam exatamente os campos novos.
--
-- Corrigir na view resolve os dois de uma vez, e reduz de quatro para três os
-- lugares que precisam saber como esse objeto é montado.
create or replace view qualificador.v_dados_pessoa as
  select v.pessoa_id,
         to_jsonb(v.*)
           || jsonb_build_object('props',       coalesce(c.props, '{}'::jsonb))
           || jsonb_build_object('props_deals', coalesce(c.props_deals, '{}'::jsonb))
           || qualificador.derivados_negocio(c.deals) as dados
    from qualificador.v_pessoa_completa v
    left join qualificador.crm_snapshot c on c.pessoa_id = v.pessoa_id;
