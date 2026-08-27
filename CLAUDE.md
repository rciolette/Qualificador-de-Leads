# CLAUDE.md — Qualificador de Leads ROI

Instruções para qualquer sessão de agente neste repositório.
**Este arquivo é o ponto de sincronia entre sessões.** Quem terminar uma tarefa
atualiza a seção 3 aqui antes de sair.
Última atualização: 27/08/2026, 23h10.

## 0. Protocolo entre sessões (leia primeiro)

Mais de uma sessão de agente já trabalhou neste repo ao mesmo tempo, no **mesmo
working tree**, e isso já produziu dois estragos reais: um commit com mensagem
trocada (`Tarefa 1 · motor de iniciativas` contém arquivos da Tarefa 0-B) e uma
numeração de migration fora de ordem. Regras para não repetir:

1. **Um único projeto Supabase: `qevnfgopjupsmwvflcza`.** Pelo MCP, é o servidor
   **`supabase-link-generator`** — confira com `get_project_url` antes de aplicar
   qualquer coisa. Os outros servidores Supabase da conta (`supabase-roi-mcp`,
   `Supabase-rot-rc_concarga`, `Supabase`) **não** pertencem a este projeto.
2. **`git commit` só do que você mexeu.** Nunca `git add -A` / `git commit -a`:
   pode haver arquivos de outra sessão no meio do caminho.
3. **Migration nova sempre com o timestamp do dia e o próximo número livre.**
   Confira com `list_migrations` antes de escolher o número — a numeração já
   pulou 22 e 23 e recebeu 14 e 15 depois do 21.
4. **Antes de começar, leia a seção 3.** Depois de entregar, atualize a seção 3 e
   escreva um `docs/<tarefa>.md` com aceite, divergências e decisões.
5. `git status` pode falhar com `index.lock` — é outra sessão commitando ou o
   sandbox que não apaga arquivos. Renomeie o lock para `_to_delete/`, não force.

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
| MCP do banco | **`supabase-link-generator`** (é o mesmo projeto) |
| CLI | `npx supabase` existe na máquina, **sem token** — `supabase login` nunca foi feito, então deploy de função hoje só pelo MCP |

**Convivência crítica:** o mesmo projeto Supabase hospeda o **Gerador de Links**
(`public`) e o **Dashboard financeiro** (`dash`), **ambos em produção**.
Nada do Qualificador pode criar, alterar ou apagar objeto fora do schema
`qualificador`. Depois de qualquer `apply_migration`, conferir por OID que nada
nasceu em `public` ou `dash`.

O RBAC é próprio: `qualificador.user_profiles` (papéis `leitor` / `operador` /
`gestao`). **Não** herda de `public.profiles` nem usa `public.is_gestao()`.
Ter conta no Gerador de Links não dá acesso aqui.

## 3. Estado real (27/08/2026, 23h10)

| Fase / tarefa | Entrega | Situação |
|---|---|---|
| Fase 1 | Catálogo e ingestão Assiny | concluída e validada |
| Fase 2 | Integrações | HubSpot rodou de verdade (584 linhas em `crm_snapshot`) |
| Tarefa 0 | Teste de conexão por integração | entregue |
| Tarefa 0-B | Espelho de MemberKit/MemberClass/Sellflux | **rodou** (outra sessão): MK 1.439 · MC 11.197 · SF 19.949 |
| Tarefa 1 | Motor de iniciativas: filtros, funil, 8 eixos de score | **entregue**; 6 de 8 aceites passaram, 2 barrados por falta de dado |
| Tarefa 2 | Funil de etapas encadeadas (`filtrar_em_etapas`) | **entregue com tela** — construtor, funil ao vivo, XLSX |
| Fase 3 | Métricas e saúde de dados | **entregue** — `/saude-dos-dados` com `v_saude_dados` e `v_panorama` |
| Fase 5 | Interface | completa: + `/iniciativas`, `/iniciativas/nova`, `/listas`, `/saude-dos-dados` |
| Fase 6 | Ciclo fechado | não iniciada |

**Tabelas e volume (27/08 23h):** `pessoa` 1.293 · `pessoa_identificador` 5.197 ·
`transacao` 1.302 · `crm_snapshot` 935 · `espelho_sellflux` 19.949 ·
`espelho_memberclass` 11.197 · `espelho_memberkit` 1.439 ·
`saude_disparo` 783 · `engajamento` 56 · `staging_assiny` 1.311 ·
`staging_generico` 1.286 · `lista_item` 133 · `campo_filtravel` 42 ·
`recorte` 9 · `projeto` 9 · `perfil_peso` 7 · `integracao` 5 ·
`user_profiles` 4 · `importacao` 3 · `integracao_execucao` 36 ·
`fonte_importacao` 1 · `iniciativa` 1 · `lista` 1 ·
**vazias:** `disparo_registro`, `participacao`, `documento`.

**A primeira lista existe:** 133 pessoas, iniciativa "Corujão · recuperar
perdido (agosto)". O funil dela: 1.293 → 99 em cadência automática → 18 com
falha de entrega → 296 perdidos há ≤ 15 dias → 549 sem HubSpot → 193 sem
negócio em IS/AE → 5 com E-cont → **133**.

**Funções de negócio no banco:** `ingerir_assiny` · `ingerir_generico` ·
`sugerir_fonte` · `validar_regras` · `resolver_projeto` · `pessoas_para_sync` ·
`credencial_salvar` / `credencial_ler` · `registrar_execucao` /
`finalizar_execucao` · `casar_espelho` · `reconciliar` (+ `_memberkit`,
`_memberclass`, `_sellflux`) · `avaliar` · `aplicar_pesos` · `faixa_de` ·
`chave_email` / `chave_documento` / `chave_telefone`.

**Edge Functions no ar:** `qualificador-credencial-salvar` ·
`qualificador-sync` (HubSpot + teste de conexão das 4) · `qualificador-espelhar` ·
`qualificador-importar` · `qualificador-importar-assiny`.

**Publicado em 27/08 23h10** (Version `7bad54e8`): as telas do motor de
iniciativas, a rota `/saude-dos-dados` e o conserto do deep link. Aceite ponta a
ponta no ar em `docs/telas-iniciativas.md` — 8 de 8 itens, zero erro HTTP.

**Cruzamento medido** (`casar_espelho`): Sellflux 1.099 pessoas (1.074 por
e-mail, 25 por telefone) · MemberClass 324 · MemberKit 56. Todos por e-mail na
prática — ver a armadilha da Sellflux na seção 5.

**Presas agora:** as execuções 35 (memberclass) e 36 (sellflux) estão em
`em_andamento` desde 01:30 e 01:46 UTC — estouraram o tempo da Edge Function sem
chamar `finalizar_execucao`. O dado entrou; a reconciliação da MemberClass não
rodou (`engajamento` tem só as 56 do MemberKit). São de outra sessão.

## 3b. A regra que a Tarefa 0-B estabeleceu

**Fonte pequena se espelha, fonte grande se consulta.**

MemberKit, MemberClass e Sellflux não sincronizam mais pessoa a pessoa — as três
são pequenas (a maior tem 1.433 registros) e perguntar uma por vez custava 1.293
chamadas HTTP por execução para não cruzar nada. A fonte inteira vai para
`qualificador.espelho_<fonte>` pela função `qualificador-espelhar` e o cruzamento
acontece em SQL (`qualificador.reconciliar`). Só o HubSpot fica em
`qualificador-sync`. Detalhes em `docs/tarefa-0b.md`.

## 4. Trabalho em aberto (pegue daqui)

0. ~~Publicar o que está no repo mas não em produção.~~ **Fechado em 27/08 22h.**
1. ~~Rodar as três fontes espelhadas de verdade.~~ **Fechado**: MemberKit 1.439
   (casou 56), MemberClass 11.197 (casa 324), Sellflux 19.949 (casa 1.099).
   A previsão de que a Sellflux cruzaria por telefone estava errada — ver seção 5.
2. ~~Encher `iniciativa` / `lista` / `lista_item`, e a tela.~~ **Fechado em 27/08
   23h10**: `/iniciativas/nova`, `/listas`, `/saude-dos-dados` e o XLSX estão no
   ar e testados de ponta a ponta. Ver `docs/telas-iniciativas.md`.
3. **Reconciliar a MemberClass.** O espelho casa 324 pessoas, mas `engajamento`
   só tem as 56 do MemberKit: a execução 35 travou em `em_andamento` sem chamar
   `finalizar_execucao`. A tela de saúde mostra "sem sincronização" por isso.
4. **Fatiar o espelhamento para caber no tempo da Edge Function.** MemberClass e
   Sellflux estouraram; precisam retomar de onde pararam, não recomeçar.
5. **Ler `divisao_times`.** Hoje toda a lista cai em `prioridade_times[1]` — foi
   por isso que a lista de teste saiu inteira como "IS".
6. Decidir `ECONT CONTABILIDADE DO ECOMMERCE` (2.370 transações fora do catálogo,
   hoje bloqueia a importação) e a `area_membros` de `ECONT BH`.
7. Decidir qual escala de classificação manda: `classificacao_leadscore` (5),
   `[LEAD] TIER *` do MemberKit (5) ou `dash.leadscore_faixas` (7).

## 4b. Funil de etapas — a decisão em aberto já tem resposta

O rascunho "Funil de qualificação" pergunta o que fazer quando a pessoa não existe
na plataforma consultada numa etapa: filtro (sai) ou enriquecimento (fica)?

**Resolvido por etapa, com a flag `manter_sem_dado`:**

| Flag | Comportamento | Quando usar |
|---|---|---|
| ausente / `false` | quem não tem o dado **sai** | "só quem está no MemberKit segue" |
| `true` | quem não tem o dado **segue**, sem ser julgado | "quem tem 3+ aulas é melhor, mas não corte quem não tem conta" |

Medido: a mesma etapa "MemberClass 3+ aulas" leva 16 → 0 como filtro e 16 → 16
como refino.

**O enriquecimento não acontece por etapa, e isso é de propósito.** As fontes
espelhadas já populam `engajamento` / `crm_snapshot` / `saude_disparo`, e
`v_pessoa_completa` as junta com left join antes do funil começar. Consultar a
plataforma dentro da etapa seria voltar ao laço por pessoa que a Tarefa 0-B
removeu. O que sobra de verdade para decidir por etapa é só uma coisa: a ausência
do dado exclui, ou não.

## 5. Armadilhas já pagas — não repetir

- **`transaction_id` não é único.** Uma transação tem N itens (ENTRY + bumps +
  upsell/downsell). Ficar com um item por transação perde ~38% do valor.
- **Views `v_ext_*` usam `security_invoker`** e devolvem **0 linhas** para quem
  não tem perfil em `public.profiles`. A leitura de `public` acontece no sync
  (Edge Function com `service_role`) e é materializada em tabelas próprias.
- **`sql.json(dados)`, nunca `JSON.stringify`** ao gravar jsonb com o driver
  `postgres` — senão a coluna guarda uma *string* e todo `dados ->> 'x'` vira null.
  Isso já corrompeu 659 linhas de `crm_snapshot` em silêncio: `deals`, `econt` e
  `disparo` viraram string, todo `deals->'itens'` virou null e **todos os bloqueios
  duros passaram a contar zero**. Reparado na migration 35 — o dado era recuperável
  com `(coluna #>> '{}')::jsonb`. Se um funil mostrar bloqueio duro zerado,
  desconfie do `jsonb_typeof` antes de desconfiar do motor.
- **`CREATE OR REPLACE FUNCTION` restaura `EXECUTE` para `PUBLIC`.** É o padrão do
  Postgres ao recriar função. Foi assim que `credencial_ler` — que devolve o token
  do HubSpot em texto puro — voltou a ser executável por `authenticated` depois de
  a migration 10 tê-la revogado. **Revogar depois de cada replace não é opcional.**
- **Revogar de `authenticated` só vale para função `SECURITY DEFINER`.** Numa
  função `INVOKER` a revogação quebra quem chama: a migration 41 tirou
  `campo_bate` de `authenticated` por zelo, e como `filtrar_em_etapas` é INVOKER,
  o PostgREST passou a devolver **403 em toda a tela `/iniciativas/nova`** — que
  o console mostrava como um 500 genérico. `campo_bate` é função pura, não lia
  tabela nenhuma. Reparado na migration 43.
- **Não declare `carregando = false` antes de `getSession()` responder.** No
  primeiro render `session` é null porque a resposta não chegou, não porque a
  pessoa está deslogada. Confundir os dois mandava quem colava `/listas` para
  `/entrar`, e de lá para `/integracoes`: **todo deep link virava a home, em
  silêncio.** O `AuthContext` agora tem `sessaoLida`, e o `Protegido` carimba
  `state.de` para o login voltar ao destino certo.
- **Cast de campo vindo de API precisa ser tolerante.** APIs devolvem `""` onde não
  há valor, e `''::date` derruba a view inteira. Use `qualificador.como_data`,
  `como_ts`, `como_bool`.
- **Valores da Assiny vêm em centavos**; `CriadoEm` é `America/Sao_Paulo` e é
  gravado em UTC.
- **HubSpot: `aux_falha_sellflux` está no NEGÓCIO, não no contato.** O conector
  faz três chamadas por lote; o terceiro passo não é opcional.
- **HubSpot: etapas do funil por ID, nunca por label.** IDs em
  `integracao.config.stages_bloqueio_duro`.
- **Bloqueio duro de disparo:** contatos nas etapas *Novos* e *Em conexão* já
  recebem cadência automática — nunca entram em lista.
- **HubSpot MCP `query_crm_data` trunca em 500 linhas em silêncio.** Para volume,
  REST com lotes de ≤300 e-mails, conferindo declarado × recebido.
- **Chave de telefone = últimos 11 dígitos, sem DDI.** A Sellflux devolve
  `"phone": 51999999999` e nós guardamos `+5551999999999`. A regra existe em DOIS
  lugares — `qualificador.chave_telefone()` no banco e `chaveTelefone()` em
  `fontes.ts`. Mudar uma sem a outra faz o cruzamento parar de casar **em silêncio**.
- **Sellflux: `email` vem `null` em muitos leads** — nunca filtrar lead por
  e-mail exato, foi o bug que fazia a integração "não conferir nada". Mas a
  previsão de que ela cruzaria *majoritariamente por telefone* **estava errada**:
  medido em `casar_espelho`, são 1.074 por e-mail contra 25 por telefone.
  `espelho_memberclass`, essa sim, não traz telefone nenhum (0 de 11.197).
- **MemberClass: usar `/api/v1/student/report`**, o relatório do tenant inteiro.
  `/user/informations?email=…` devolve 404 quando não acha, e todo "não tem conta"
  virava linha de erro.
- **MemberKit: 404 é resposta legítima.** A base Assiny é IniciAmazon e a academia
  conectada é Consultorias/Mentorias — a sobreposição é pequena por natureza do
  negócio, não por falha. Auth por query param `api_key`: **nunca logar a URL**.
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

Nomear sempre `qualificador_AAAAMMDD_NN_descricao`, com `NN` conferido em
`list_migrations` — ver seção 0, regra 3.

## 7. Convenções

- **Código, comentários, commits e UI em português.** Nomes de tabela, coluna e
  função em português sem acento (`ingerir_assiny`, `saude_disparo`).
- Comentário explica **por que**, não o que — o padrão do repo é comentar a
  armadilha que gerou a linha.
- RLS em **todas** as tabelas novas, sem exceção.
- Antes de fechar uma tarefa: `get_advisors` e conferir que **nenhum** alerta
  cita `qualificador`.
- Cada entrega vira um `docs/<nome>.md` com aceite, divergências e decisões.

## 8. Documentação

- `docs/fase-1.md` — catálogo e ingestão
- `docs/fase-2.md` — integrações
- `docs/tarefa-0b.md` — por que as três fontes pequenas não cruzavam nada
- `docs/telas-iniciativas.md` — as telas do motor, o aceite no ar e os 3 defeitos
- Projeto Claude "Qualificador de Leads" → `claude/mapa-apis-v1.md` (as 4 APIs) e
  `claude/estado-do-projeto.md` (espelho desta seção 3, para quem não abre o repo)
