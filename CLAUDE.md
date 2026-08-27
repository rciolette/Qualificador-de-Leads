# CLAUDE.md — Qualificador de Leads ROI

Instruções para qualquer sessão de Claude Code neste repositório.
Última atualização: 27/08/2026.

## 1. O que este app é

App interno da **ROI Ventures**. Cruza o histórico de vendas da **Assiny**
(fonte da verdade) com **MemberClass**, **MemberKit**, **HubSpot** e **Sellflux**,
e produz **listas de contatos qualificados** por time comercial e prioridade.

Duas regras de produto que não se negociam:

1. **A saída é sempre um arquivo** (xlsx/csv) entregue a quem dispara.
   O app **não envia mensagem** para ninguém.
2. **Sellflux é somente leitura** via API. Nada de POST que dispare cadência.

## 2. Ambiente

| Item | Valor |
|---|---|
| Repo | `github.com/rciolette/Qualificador-de-Leads` (branch `main`) |
| Front | Vite + React 18 + TS + Tailwind + shadcn/ui + React Query |
| Deploy | Cloudflare (`wrangler`), `npm run deploy` |
| Banco | Supabase `qevnfgopjupsmwvflcza`, schema **`qualificador`** |
| MCP do banco | use o servidor **`supabase-link-generator`** (é o mesmo projeto) |

**Convivência crítica:** o mesmo projeto Supabase hospeda o **Gerador de Links**
(`public`) e o **Dashboard financeiro** (`dash`), **ambos em produção**.
Nada do Qualificador pode criar, alterar ou apagar objeto fora do schema
`qualificador`. Depois de qualquer `apply_migration`, conferir por OID que nada
nasceu em `public` ou `dash`.

O RBAC é próprio: `qualificador.user_profiles` (papéis `leitor` / `operador` /
`gestao`). **Não** herda de `public.profiles` nem usa `public.is_gestao()`.
Ter conta no Gerador de Links não dá acesso aqui.

## 3. Estado real (27/08/2026)

| Fase | Entrega | Situação |
|---|---|---|
| 1 | Catálogo e ingestão Assiny | concluída e validada |
| 2 | Camada de integrações | código no ar; **nenhum conector exercido contra API real — falta credencial** |
| 2b | Importador genérico (arrastar-e-soltar, de-para manual) | **em curso, não commitado** |
| 3 | Métricas e saúde de dados | não iniciada |
| 4 | Motor de iniciativas e saída | não iniciada |
| 5 | Interface | esqueleto navegável; páginas 3–6 vazias |
| 6 | Ciclo fechado | não iniciada |

Tabelas do schema e volume atual: `pessoa` 1.293 · `pessoa_identificador` 5.167 ·
`transacao` 1.302 · `staging_assiny` 1.311 · `staging_generico` 1.286 ·
`projeto` 9 · `integracao` 5 · `integracao_execucao` 11 · `user_profiles` 4 ·
`importacao` 3 · `fonte_importacao` 1 · **`engajamento`, `crm_snapshot`,
`saude_disparo` e `documento` ainda com 0 linhas** — é exatamente o que falta
das integrações rodarem de verdade.

Front: `/importar`, `/integracoes` e `/catalogo` funcionam.
`/saude`, `/iniciativas`, `/listas` são casca.

Edge Functions no ar: `qualificador-credencial-salvar`, `qualificador-sync`,
`qualificador-espelhar`, `qualificador-importar` (genérico), `qualificador-importar-assiny`.

## 3b. Tarefa 0-B — as três fontes pequenas (27/08)

MemberKit, MemberClass e Sellflux **não sincronizam mais pessoa a pessoa**. As três
são pequenas (a maior tem 1.433 registros); perguntar uma por vez custava 1.293
chamadas HTTP por execução para não cruzar nada. Agora a fonte inteira é espelhada
em `qualificador.espelho_<fonte>` pela função `qualificador-espelhar` e o cruzamento
acontece em SQL (`qualificador.reconciliar`). Detalhes em `docs/tarefa-0b.md`.

Regra que vale daqui em diante: **fonte pequena se espelha, fonte grande se consulta.**
Só o HubSpot fica em `qualificador-sync`.

## 4. Trabalho em aberto (pegue daqui)

0. **Publicar o que já está no repo mas não em produção:**
   `supabase functions deploy qualificador-sync` (tira os 3 adaptadores antigos) e
   `npm run deploy` (front com o botão "Espelhar e cruzar").
1. **Gravar as 4 credenciais** (hubspot, memberclass, memberkit, sellflux) e
   rodar os aceites da fase 2 — só o Raphael pode gravar; é o bloqueio nº 1.
2. **Fechar o importador genérico** (4 arquivos alterados sem commit:
   `src/lib/importar.ts`, `src/pages/ImportarPage.tsx`,
   `supabase/functions/qualificador-importar/{index,planilha}.ts`).
   O que mudou: um arquivo por requisição em série + streaming por lotes de 200
   linhas, para não estourar `WORKER_LIMIT` (HTTP 546) com relatórios da Assiny
   de ~6.700 × 63.
3. Decidir o projeto `ECONT CONTABILIDADE DO ECOMMERCE` (2.370 transações fora
   do catálogo, hoje bloqueia a importação) e a `area_membros` de `ECONT BH`.
4. Decidir qual escala de classificação manda: `classificacao_leadscore` (5),
   `[LEAD] TIER *` do MemberKit (5) ou `dash.leadscore_faixas` (7).

## 5. Armadilhas já pagas — não repetir

- **`transaction_id` não é único.** Uma transação tem N itens (ENTRY + bumps +
  upsell/downsell). Ficar com um item por transação perde ~38% do valor.
  A ingestão agrega por `transaction_id`.
- **Views `v_ext_*` usam `security_invoker`** e devolvem **0 linhas** para quem
  não tem perfil em `public.profiles`. Portanto **o app não lê `public` no
  caminho do usuário**: a leitura acontece no sync (Edge Function com
  `service_role`) e é materializada em tabelas do próprio Qualificador.
- **`sql.json(dados)`, nunca `JSON.stringify`** ao gravar jsonb com o driver
  `postgres` — senão a coluna guarda uma *string* e todo `dados ->> 'coluna'`
  vira null.
- **Valores da Assiny vêm em centavos**; `CriadoEm` é `America/Sao_Paulo` e é
  gravado em UTC.
- **HubSpot: `aux_falha_sellflux` está no NEGÓCIO, não no contato.** O conector
  faz três chamadas por lote (contatos → associações → negócios); o terceiro
  passo não é opcional.
- **HubSpot: etapas do funil por ID, nunca por label** (os labels variam entre
  pipelines: "Novos"/"Novo", "Em conexão"/"Em Conexão"). IDs em
  `integracao.config.stages_bloqueio_duro`.
- **Bloqueio duro de disparo:** contatos nas etapas *Novos* e *Em conexão*
  já recebem cadência automática — nunca entram em lista.
- **HubSpot MCP `query_crm_data` trunca em 500 linhas em silêncio.** Para volume,
  usar a REST (lotes de ≤300 e-mails) e conferir declarado × recebido.
- **MemberKit:** auth por query param `api_key` (não header), 120 req/min.
  Como a chave viaja na URL, **nenhuma mensagem de erro do adaptador MemberKit
  pode incluir a URL**. `find_members` traz no máximo 50 — consultar por e-mail,
  nunca enumerar.
- **MemberClass:** header `x-api-key`, `limit` máx 100, paginar até
  `hasNextPage=false`. Sem telefone; CPF só em `/student/report`.
- **Sellflux:** rotas de CRM exigem `acting_user_id`, obtido antes em
  `GET /api/v1/crm/team/users`.
- **Chave de telefone = últimos 11 dígitos, sem DDI.** A Sellflux devolve
  `"phone": 51999999999` e nós guardamos `+5551999999999`: comparação exata nunca
  casa. A regra existe em DOIS lugares — `qualificador.chave_telefone()` no banco e
  `chaveTelefone()` em `fontes.ts`. Mudar uma sem a outra faz o cruzamento parar de
  casar **em silêncio**.
- **Sellflux: `email` vem `null` na maioria dos leads.** Nunca filtrar lead por
  e-mail exato — foi o bug que fazia a integração "não conferir nada".
- **MemberClass: usar `/api/v1/student/report`**, o relatório do tenant inteiro.
  `/user/informations?email=…` devolve 404 quando não acha, e todo "não tem conta"
  virava linha de erro.
- **MemberKit: 404 é resposta legítima.** A base Assiny é IniciAmazon e a academia
  conectada é Consultorias/Mentorias — a sobreposição é pequena por natureza do
  negócio, não por falha.
- **`Qualificador de Leads/`** na raiz é um clone vazio de 26/08, já no
  `.gitignore`. O trabalho vive na raiz. Não editar lá dentro.
- **O sandbox não apaga arquivos:** renomeie para `_to_delete/` em vez de `rm`.

## 6. Migrations

Aplicadas via MCP (`apply_migration`), registradas em
`supabase_migrations.schema_migrations`. **Os `.sql` ainda não estão no repo.**
Para trazê-los:

```bash
supabase link --project-ref qevnfgopjupsmwvflcza && supabase db pull --schema qualificador
```

Nomear sempre `qualificador_AAAAMMDD_NN_descricao`.

## 7. Convenções

- **Código, comentários, commits e UI em português.** Nomes de tabela, coluna e
  função em português sem acento (`ingerir_assiny`, `saude_disparo`).
- Comentário explica **por que**, não o que — o padrão do repo é comentar a
  armadilha que gerou a linha.
- RLS em **todas** as tabelas novas, sem exceção.
- Antes de fechar uma fase: rodar `get_advisors` e conferir que **nenhum** alerta
  cita `qualificador`.
- Cada fase entregue vira um `docs/fase-N.md` com critérios de aceite,
  divergências do PRD e decisões.

## 8. Documentação

- `docs/fase-1.md` — catálogo e ingestão
- `docs/fase-2.md` — integrações
- Projeto Claude "Qualificador de Leads" → `claude/mapa-apis-v1.md`
  (levantamento das 4 APIs) e `claude/estado-do-projeto.md`
