# Fase 1 — Catálogo e ingestão

Concluída em 26/08/2026. Entrega: histórico da Assiny consultável em um lugar,
com pessoas deduplicadas.

## Critérios de aceite

| Critério | Resultado |
|---|---|
| `apply_migration` só criou objetos em `qualificador` | OK — verificado por OID contra o schema |
| `get_advisors` sem alertas de segurança | OK — 114 alertas no projeto, **0** citam `qualificador` |
| Importar um CSV real e conferir contagem | OK — 25 itens → 16 transações, valores batem com cálculo independente |
| Projeto desconhecido bloqueia a importação | OK — `ECONT CONTABILIDADE DO ECOMMERCE` barrado com `check_violation` |
| Reimportar o mesmo arquivo não duplica | OK — 2ª passada: 0 transações novas, 0 pessoas criadas |
| Dois e-mails em grafias diferentes viram uma pessoa | OK — 7 asserts de identidade |
| Nenhum objeto novo em `public` ou `dash` | OK |
| RLS em 100% das tabelas | OK — 7 asserts de RBAC (sem perfil / leitor / operador / gestão) |

## Divergências entre o PRD e o dado real

Auditados 36 relatórios `report-transaction` (196.787 linhas).

### 1. `transaction_id` não é único

O PRD (5.3) define `transacao.transaction_id` como primary key. No export da Assiny,
**uma transação tem N itens** — ENTRY mais order bumps, upsell e downsell.

```
196.787 linhas  →  122.029 transações
83.599 transações com 1 item · 21.462 com 2 · 7.332 com 3 · até 16 itens
```

Ficar com um item por transação perderia ~38% do valor e os produtos comprados.
A ingestão agrega por `transaction_id`: valor e valor líquido somados, produtos
concatenados com `" + "`, oferta e funil do item principal (ENTRY, ou o de maior valor).
Coluna nova `transacao.itens` registra quantos itens compõem a linha.

### 2. Nomes e IDs do anexo A

| Anexo A | Export real |
|---|---|
| `E-cont BH (ROI Ventures)` | `E-cont BH` |
| org `ECONTBH CONTABILIDADE DO ECOMMERCE` | `…DO ECOMMERCE LTDA` |
| NANA GALEAZZI sem IDs | org `047d7bc7-…` · projeto `ad1101df-…` |
| `Funil Coelho` | não aparece em nenhum dos 36 relatórios |

`public.assiny_projetos` usa **nomes diferentes** dos do export (`Consutorias & Mentorias`
com typo, `[CS] Cross & Extensao` sem acento, org `ROI Ventures` sem `LTDA`).
Por isso `qualificador.resolver_projeto()` casa por `ProjectId` primeiro e só então por nome.

### 3. Projeto fora do catálogo — pendente de decisão

`ECONT CONTABILIDADE DO ECOMMERCE` (projeto `e13f8d5d-9a2c-444c-aa82-308a18bb5dee`,
org `500c661f-c8bf-47d7-a84b-44717b8e0fa9`) tem **2.370 transações** e não está no anexo A.
Deixado fora do seed de propósito: hoje bloqueia a importação, como manda o PRD 5.1.

Também pendente: `ECONT BH` está sem `area_membros` — o PRD não classifica.
A métrica da camada 1 exige "projetos Assiny sem área de membros = 0".

### 4. Valores em centavos

O CSV exporta centavos (`Valor=3700` → R$ 37,00). A ingestão divide por 100.
`CriadoEm` não traz timezone; é interpretado como `America/Sao_Paulo` e gravado em UTC.

## Decisão de arquitetura: o alcance do `security_invoker`

As quatro views `v_ext_*` usam `security_invoker = true`, como manda o PRD 3.2.
Consequência medida com um usuário `authenticated` que tem papel no Qualificador
mas **não** tem perfil em `public.profiles`:

| View | Linhas visíveis |
|---|---|
| `v_ext_assiny_catalogo` | 120 |
| `v_ext_deals` | 0 |
| `v_ext_contato_hubspot` | 0 |
| `v_ext_atribuicao` | 0 |

Não é bug: `public.gerador_sales` tem RLS que exige perfil do Gerador de Links.
O catálogo Assiny tem policy permissiva, por isso passa.

Isso significa que **o app não pode depender dessas três views no caminho do usuário**.
A leitura de `public` tem de acontecer no sync (Edge Function com `service_role`,
que bypassa RLS) e ser materializada nas tabelas do próprio Qualificador
(`crm_snapshot`, `engajamento`, …). As views continuam valendo como camada de
contrato e para uso administrativo. Confirmar na fase 2.

## Limite conhecido: carga em volume

Carregar CSV por `execute_sql` não escala — cada lote passa pelo contexto do agente.
Um relatório de 6.685 linhas exigiria dezenas de chamadas.
A fase 2 precisa da Edge Function `qualificador-importar-assiny` recebendo o arquivo
por POST e escrevendo direto no staging.

## Objetos criados

```
schema qualificador
  enums        area_membros · tipo_identificador · fonte_dado · tipo_iniciativa
               fase_iniciativa · time_comercial · tipo_integracao · papel
  tabelas      user_profiles · projeto · pessoa · pessoa_identificador
               importacao · transacao · staging_assiny            (RLS em todas)
  views        v_ext_assiny_catalogo · v_ext_deals
               v_ext_contato_hubspot · v_ext_atribuicao           (security_invoker)
  funções      has_min_papel · resolver_projeto · ingerir_assiny
               norm_email · norm_documento · norm_telefone · tg_atualizado_em
```

Dados no banco: 8 projetos no catálogo, 16 pessoas, 16 transações, 64 identificadores,
1 importação (`report-transaction-…2026_04_17`, recorte de 25 itens). Nenhum dado sintético.
