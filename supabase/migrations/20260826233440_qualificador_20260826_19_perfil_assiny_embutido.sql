-- Qualificador de Leads ROI · migration 19
-- Perfil embutido da Assiny: serve para o app reconhecer o arquivo sozinho e já
-- sugerir o de-para. Marcado como `embutido` porque a ingestão dele NÃO passa por
-- ingerir_generico -- o relatório da Assiny tem N itens por transacao (order bumps)
-- e precisa da agregação de ingerir_assiny.

insert into qualificador.fonte_importacao
  (nome, descricao, mapeamento, transformacoes, regras, assinatura, embutido)
values (
  'Relatório de transações da Assiny',
  'Export padrão do painel da Assiny. Reconhecido sozinho pelas colunas. Usa o parser
   especializado: agrega os itens (ENTRY + order bumps) numa transação só.',
  jsonb_build_object(
    'transaction_id',   'TransactionId',
    'email',            'EmailDoCliente',
    'telefone',         'TelefoneDoCliente',
    'documento',        'DocumentoDoCliente',
    'nome',             'NomeCompletoDoCliente',
    'assiny_client_id', 'ClientId',
    'produto',          'NomeDoProduto',
    'oferta',           'NomeDaOferta',
    'funil',            'NomeDoFunil',
    'utm_source',       'UtmSource',
    'valor',            'Valor',
    'valor_liquido',    'ValorLiquido',
    'status',           'Status',
    'criado_em',        'CriadoEm',
    'projeto_nome',     'NomeDoProjeto',
    'projeto_id',       'ProjectId'),
  jsonb_build_object('valor', 'centavos_para_reais',
                     'valor_liquido', 'centavos_para_reais',
                     'criado_em', 'brt_para_utc'),
  jsonb_build_object('exigir_projeto_no_catalogo', true),
  array['TransactionId','ProjectId','NomeDoProjeto','EmailDoCliente','Valor','CriadoEm'],
  true
)
on conflict (nome) do update set
  mapeamento     = excluded.mapeamento,
  transformacoes = excluded.transformacoes,
  regras         = excluded.regras,
  assinatura     = excluded.assinatura,
  embutido       = true;

-- Sugere o perfil cujo conjunto de colunas está inteiro no arquivo, do mais
-- específico para o mais genérico.
create or replace function qualificador.sugerir_fonte(p_colunas text[])
returns table (id uuid, nome text, embutido boolean, colunas_casadas int)
language sql stable
set search_path = qualificador, pg_catalog
as $fn$
  select f.id, f.nome, f.embutido, array_length(f.assinatura, 1)
  from qualificador.fonte_importacao f
  where f.assinatura is not null and f.assinatura <@ p_colunas
  order by array_length(f.assinatura, 1) desc
$fn$;

revoke execute on function qualificador.sugerir_fonte(text[]) from public, anon;
grant  execute on function qualificador.sugerir_fonte(text[]) to authenticated, service_role;
