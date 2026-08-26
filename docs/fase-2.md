# Fase 2 — Camada de integrações

Estado em 26/08/2026: **código completo e no ar; validação de ponta a ponta bloqueada
por credenciais.** Ver "O que falta" no fim.

## O que foi entregue

| Item do PRD | Situação |
|---|---|
| Tabelas `integracao` e `integracao_execucao` | prontas, com RLS e as 5 fontes semeadas |
| Edge Function de credencial + Vault | no ar, 9 asserts passando |
| Contrato de adaptador | `contrato.ts` |
| Conectores de leitura (HubSpot, MemberKit, MemberClass, Sellflux) | escritos e no ar |
| Tabelas de snapshot (`engajamento`, `crm_snapshot`, `saude_disparo`) | prontas, com RLS |
| View de frescor por fonte (métrica da camada 1) | `v_frescor_integracoes` |

## Credenciais

O token vai para o Vault sob `qualificador_<slug>` e **não existe caminho de leitura
para o front** — só substituição. A tabela guarda o nome do segredo e uma máscara.

Testado com rollback (9 asserts): operador bloqueado, token curto recusado, slug
inexistente recusado, gravação por gestão, valor não vazando na tabela, leitura pelo
conector, substituição, isolamento dos 22 segredos de outros sistemas, frescor.
A máscara sai como o PRD especifica: `••••••3f2a`.

```bash
curl -X POST https://qevnfgopjupsmwvflcza.supabase.co/functions/v1/qualificador-credencial-salvar \
  -H "Authorization: Bearer <SEU_JWT>" -H 'Content-Type: application/json' \
  -d '{"slug":"hubspot","token":"pat-na1-..."}'
```

Slugs: `hubspot` · `memberclass` · `memberkit` · `sellflux`.

## Sincronização

```bash
curl -X POST https://qevnfgopjupsmwvflcza.supabase.co/functions/v1/qualificador-sync \
  -H "Authorization: Bearer <SEU_JWT>" -H 'Content-Type: application/json' \
  -d '{"fonte":"hubspot","limite":300}'
```

Escolhe os alvos mais desatualizados (`pessoas_para_sync`), chama o adaptador, grava
o snapshot **numa transação por pessoa** — falha de rede no meio do lote não deixa
meio snapshot no banco — e registra a execução com contagem, duração e erro.

A resposta traz `alvos`, `encontrados` e `nao_encontrados` separados, que é o
"declarado × recebido" que o PRD pede.

## Correções ao PRD encontradas nas APIs reais

### HubSpot — `aux_falha_sellflux` está no negócio, não no contato

O anexo B lista essa property em "Contato · saúde de disparo". Ela **não existe em
contato**; existe em **negócio**. Consequência: o bloqueio duro "falha de entrega
registrada" (PRD 7.1) não sai de um lote de contatos, ao contrário do que o PRD 8.2
afirma no fecho. O conector faz três chamadas por lote — contatos, associações,
negócios — e o terceiro passo não é opcional.

### HubSpot — etapas não podem ser filtradas por label

Validado contra o portal (contagem de negócios por pipeline × etapa):

| Pipeline | "Novos" | "Em conexão" |
|---|---|---|
| AE `710485361` | `1037982864` | `1037982865` |
| IS `711246125` | `1038878479` | `1038878480` |
| E-cont `717654561` | `1047780485` (label "Novo") | `1047780486` |

Os labels variam entre pipelines ("Novos"/"Novo", "Em conexão"/"Em Conexão").
O bloqueio duro usa IDs, gravados em `integracao.config.stages_bloqueio_duro`.

Ganho e Perdido do PRD conferem exatamente. Três etapas não citadas no PRD:
`Qualificação` (1284877843, IS), `Banco de Leads` (1232916556, E-cont),
`Em Negociação` (1345942844, E-cont).

`cliente_no_funil` tem label real "Origem de Tráfego (Primeira Origem)" — não é
"Cliente no Funil da Nath ou Tomé" como o anexo B sugere.

### MemberKit — o PRD subestima a API

| PRD 8.3 / anexo D | Documentação oficial |
|---|---|
| "Não tem CPF nem telefone. Se o e-mail divergir, a pessoa some." | `GET /users/{id}` devolve `cpf_cnpj`, `phone_local_code`, `phone_number` |
| (auth não especificada) | query param `api_key`, **não** header |
| (rate limit não citado) | 120 requisições por minuto, documentado |
| `access.memberships[].level` | REST devolve `memberships[]` com `membership_level_id`; o formato do PRD é do MCP |

Existe segunda chave de cruzamento no MemberKit. O conector grava documento e telefone
em `pessoa_identificador`, o que fecha o furo que o anexo D dava como insolúvel.

Como a chave viaja na URL, nenhuma mensagem de erro do adaptador MemberKit inclui a URL.

Os 11 níveis do anexo C conferem nas contagens; os **IDs** são novos e estão em
`integracao.config.niveis`, já separados em `tier_lead`, `produto_pago` e
`trilha_progressao` — a separação que o PRD pede em 7.5 e no anexo C.

## O que falta

**Nenhum conector foi exercido contra a API real.** Os quatro precisam de credencial,
que só você pode gravar. Até lá os critérios de aceite abaixo seguem abertos:

- [ ] HubSpot: lote de 300 e-mails, conferir total declarado × recebido
- [ ] MemberClass: `limit=100` e paginação até `hasNextPage=false`
- [ ] MemberKit: consulta por e-mail, não por enumeração
- [ ] Sellflux: `acting_user_id` resolvido antes das rotas de CRM
- [ ] Falha de rede não corrompe snapshot

Os dois primeiros itens da fase 2 (credencial e log de execução) **estão** validados.

MemberClass merece atenção redobrada: não há MCP, o domínio é bloqueado no ambiente do
agente, e os endpoints vieram só da tabela do PRD 8.4. A primeira execução real é o teste.

Também pendente: a Edge Function `qualificador-importar-assiny`, que resolve a carga
em volume do CSV (ver `docs/fase-1.md`).
