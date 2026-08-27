# Qualificador de Leads ROI

Cruza o relatório de transações da Assiny com MemberClass, MemberKit, HubSpot e Sellflux
e produz listas de contatos qualificados por time e prioridade.

- **PRD:** v1.0 · 27/08/2026
- **Banco:** Supabase `qevnfgopjupsmwvflcza`, schema `qualificador`
- **Convivência:** o mesmo projeto hospeda o Gerador de Links (`public`) e o Dashboard
  financeiro (`dash`), ambos em produção. Nada do Qualificador vive fora de `qualificador`.

## Estado

| Fase | Entrega | Situação |
|---|---|---|
| 1 | Catálogo e ingestão | concluída |
| 2 | Camada de integrações | código no ar; falta credencial para validar |
| 3 | Métricas e saúde de dados | não iniciada |
| 4 | Motor de iniciativas e saída | não iniciada |
| 5 | Interface | não iniciada |
| 6 | Ciclo fechado | não iniciada |

## Migrations

Aplicadas via MCP, registradas em `supabase_migrations.schema_migrations`:

```
qualificador_20260826_01_schema_enums_rbac
qualificador_20260826_02_normalizacao_catalogo_identidade
qualificador_20260826_03_views_externas
qualificador_20260826_04_seed_catalogo
qualificador_20260826_05_seed_catalogo_corrigido
qualificador_20260826_06_staging_parser_assiny
qualificador_20260826_07_ingestao_agrega_itens
qualificador_20260826_08_catalogo_econt_classificado
qualificador_20260826_09_integracoes
qualificador_20260826_10_credenciais_vault
qualificador_20260826_11_snapshots_externos
qualificador_20260826_12_hubspot_config_validado
qualificador_20260826_13_memberkit_config_validado
qualificador_20260827_14_espelhos
qualificador_20260827_15_reconciliacao
```

## Edge Functions

| Função | Papel mínimo | O que faz |
|---|---|---|
| `qualificador-credencial-salvar` | gestão | grava o token da integração no Vault sob `qualificador_<slug>` |
| `qualificador-sync` | operador | sincroniza o HubSpot (a única fonte grande) e testa a conexão das quatro |
| `qualificador-espelhar` | operador | espelha MemberKit, MemberClass ou Sellflux inteiras e reconcilia em SQL |

```bash
supabase functions deploy qualificador-sync --project-ref qevnfgopjupsmwvflcza
```

Para trazer os arquivos `.sql` para este repo:

```bash
supabase link --project-ref qevnfgopjupsmwvflcza && supabase db pull --schema qualificador
```

## Carregar um relatório da Assiny

```bash
python3 scripts/assiny_para_sql.py <report-transaction-*.csv> <dir_saida> 400
```

Gera `000.sql` (cria a importação) e `NNN.sql` (lotes para `qualificador.staging_assiny`).
Depois, no banco:

```sql
select qualificador.ingerir_assiny('<importacao_id>');
```

`--essenciais` limita às 17 colunas que a ingestão consome, para lotes menores.

> Esta rota é para validação. A carga em volume precisa da Edge Function
> `qualificador-importar-assiny` (fase 2) — ver `docs/fase-1.md`.

## Documentação

- [docs/fase-1.md](docs/fase-1.md) — catálogo e ingestão: aceite, divergências do PRD, decisões
- [docs/fase-2.md](docs/fase-2.md) — integrações: credenciais, conectores, correções às APIs
- [docs/tarefa-0b.md](docs/tarefa-0b.md) — por que MemberKit, MemberClass e Sellflux não cruzavam nada, e o que substituiu os três adaptadores
