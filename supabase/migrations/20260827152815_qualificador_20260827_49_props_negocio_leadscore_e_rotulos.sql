-- As properties que sustentam o leadscore moram no NEGÓCIO, não no contato — o
-- fluxo do Typeform só LÊ `classificacao_leadscore` já pronta. Nunca foram pedidas,
-- por isso voltavam 0 em 1.445 negócios: ausência de pedido, não ausência de dado.
--
-- `*_do_contato_associado` são o espelho do contato dentro do negócio. O fluxo
-- [SELLFLUX][TAGS] ae-conectado usa `telefone_do_contato_associado` com
-- CONTAINS_TOKEN para achar o negócio quando não tem o link do HubSpot — é uma
-- quarta chave de cruzamento que não estava mapeada.
update qualificador.integracao
   set config = jsonb_set(config, '{props_negocio}',
         (select jsonb_agg(distinct p order by p)
            from jsonb_array_elements_text(
              (config->'props_negocio') ||
              '["caixa","renda_mensal","nivel_de_consciencia",
                "telefone_do_contato_associado","email_do_contato_associado",
                "nome_do_contato_associado"]'::jsonb) p))
 where slug = 'hubspot';

-- Três properties de nome quase idêntico, todas com dado. Contar sublinhados não
-- é interface: o rótulo diz de onde vem, e a descrição carrega o nome interno para
-- quem precisar auditar contra o HubSpot.
update qualificador.campo_filtravel set
  rotulo = 'Produtos ativos · contato',
  descricao = 'HubSpot, contato: produtos__servicos_ativos (dois sublinhados). O que a pessoa tem ativo hoje.'
 where id = 'hs.ativos';

update qualificador.campo_filtravel set
  rotulo = 'Produtos contratados · histórico do contato',
  descricao = 'HubSpot, contato: produtos_servicos_contratados (um sublinhado). Tudo que já foi contratado, ativo ou não.'
 where id = 'hs.historico';

update qualificador.campo_filtravel set
  rotulo = 'Produtos do negócio',
  descricao = 'HubSpot, negócio: produtos___servicos_contratados (três sublinhados). O que está naquele deal.'
 where id = 'hs.produtos_deal';

-- A faixa fica; a nota sai. `leadscore` numérico está preenchido em 2 de 1.099
-- pessoas — oferecê-lo como filtro só produz lista vazia e faz o usuário
-- desconfiar do motor. Listas já geradas não perdem nada: `lista.colunas` guarda
-- o cabeçalho resolvido, não o id do catálogo.
delete from qualificador.campo_filtravel where id = 'hs.leadscore_num';

update qualificador.campo_filtravel set
  descricao = 'HubSpot: classificacao_leadscore, faixas A–E. Preenchida em 908 de 1.099. É a única escala utilizável — o leadscore numérico existe em 2 pessoas.'
 where id = 'hs.leadscore_faixa';
