# CLAUDE.md — Qualificador de Leads ROI

Instruções para qualquer sessão de agente neste repositório.
**Este arquivo é o ponto de sincronia entre sessões.** Quem terminar uma tarefa
atualiza a seção 3 aqui antes de sair.
Última atualização: 27/08/2026 — o fluxo guiado virou o caminho principal.

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
   pulou 22 e 23 e recebeu 14 e 15 depois do 21. E **traga o `.sql` para
   `supabase/migrations/` no mesmo commit** — desde 27/08 o repo reproduz o
   schema, e aplicar sem versionar o arquivo faz ele divergir de novo (seção 6).
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

## 3. Estado real (27/08/2026, 17h — `main` é oficial a partir daqui)

O `main` está em `d5bbf15` e **reproduz o banco**: as 53 migrations do schema
estão em `supabase/migrations/` (ver seção 6). Local e remoto sincronizados, sem
branch pendente — `main-j9m1xx` já está contido no `main`.

| Fase / tarefa | Entrega | Situação |
|---|---|---|
| Fase 1 | Catálogo e ingestão Assiny | concluída e validada |
| Fase 2 | Integrações | HubSpot rodou de verdade |
| Tarefa 0 | Teste de conexão por integração | entregue |
| Tarefa 0-B | Espelho de MemberKit/MemberClass/Sellflux | rodou · MK 1.439 · MC 11.197 · SF 35.697 |
| Tarefa 1 | Motor de iniciativas: filtros, funil, 8 eixos de score | entregue; 6 de 8 aceites |
| Tarefa 2 | Funil de etapas encadeadas (`filtrar_em_etapas`) | entregue com tela |
| Tarefa 2 · (1) e (4) | colunas no resultado · modelo sem gerar lista | **entregues**, 10/10 aceites |
| Tarefa 2 · (2) e (3) | múltiplas plataformas por etapa · de-para | passos **1, 2, 3 e 5 no ar**; falta o 4 (vocabulário) |
| Fase 3 | Métricas e saúde de dados | entregue — `/saude-dos-dados` |
| Fase 5 | Interface | **o fluxo guiado é o caminho principal**; as 6 telas viraram "Avançado" |
| Fase 6 | Ciclo fechado | não iniciada |

**Volume medido em 27/08 20h40**, depois do reespelhamento completo da
MemberClass: `espelho_sellflux` 35.697 · `espelho_memberclass` **26.670** ·
`pessoa` 4.430 · `transacao` 4.947 · `engajamento` **4.444** (4.339
MemberClass + 105 MemberKit) · `saude_disparo` 4.242 · `crm_snapshot` 3.485 ·
`espelho_memberkit` 1.442 · `campo_filtravel` 55 (14 com fonte nativa) ·
`lista_item` 133 · `iniciativa` 1 · `lista` 1 · `modelo_fluxo` 2.

**O espelho da MemberClass estava PARCIAL desde o começo, e ninguém percebeu.**
Ele tinha 11.197 linhas — o resto da execução 35, que travou em `em_andamento`
em 27/08 01h30. Como `qualificador-espelhar` apaga a tabela antes de
reconstruir, o que sobrou parecia um espelho completo. O reespelhamento de
27/08 20h17 trouxe **26.670 alunos** (todos distintos, zero repetição) em 22
minutos.

O efeito no cruzamento é grande — todos os números anteriores da MemberClass
foram medidos contra o espelho parcial:

| | antes (parcial) | agora |
|---|---|---|
| pessoas cruzadas | 342 | **4.339** (97,9% da base) |
| com 1+ aula | 219 | **2.709** |
| com 3+ aulas | 194 | **2.280** |
| com último acesso | 298 | **3.761** |

A MemberClass deixou de ser fonte só de refino e virou **a mais rica do
projeto**, à frente da Sellflux (4.242) e do HubSpot (3.485). Uma etapa
"3+ aulas" leva 2.394 → 1.065 sobre a base atual.

**Decisões do Raphael já tomadas** (registradas na seção 9 de
`docs/tarefa-2-multiplas-plataformas-e-de-para.md`, não reabrir): desempate
ternário com `sem_dado` que não vota · `algum` como padrão do quantificador ·
identidade fora do de-para editável · um nível de combinador, sem aninhamento.

**A MemberClass reconciliou.** `engajamento` tem 380 (324 MemberClass + 56
MemberKit) e `saude_disparo` 1.237 — 96% da base. Como filtro ela sustenta:
219 pessoas com 1+ aula, 188 com 3+.

**Cruzamento medido** (`casar_espelho`): Sellflux 1.099 pessoas (1.074 por
e-mail, 25 por telefone) · MemberClass 324 · MemberKit 56 — ver a armadilha da
Sellflux na seção 5.

**O re-sync do HubSpot está pela metade, e morreu de estouro.**
`config.props_negocio` tem 19 props (as 6 do leadscore + `caixa_disponivel` +
`investimento_disponivel`), mas `caixa_disponivel` e `investimento_disponivel`
estão em **zero**: entraram no config depois da última leitura, e o Batch Read do
HubSpot **ignora property inexistente sem erro**. O config já está certo; falta
reler.

O re-sync **rodou pela Edge Function**, disparado pela tela em 27/08 15h29.
Gravou 1.217 linhas e morreu com **HTTP 546 `WORKER_RESOURCE_LIMIT`** por volta
de 200 s, **antes** de chamar `registrar_execucao` — daí a escrita aparecer em
`crm_snapshot.sync_em` e a execução não aparecer em `integracao_execucao`.
Não adianta "reler pela função": **a função não aguenta a base inteira.** O
`qualificador-sync` precisa ser fatiado e retomável, igual ao espelhamento.

**Funções de negócio no banco** (43, conferidas no `pg_proc` em 27/08):
`ingerir_assiny` · `ingerir_generico` · `sugerir_fonte` · `validar_regras` ·
`resolver_projeto` · `pessoas_para_sync` · `credencial_salvar` / `credencial_ler` ·
`registrar_execucao` / `finalizar_execucao` · `casar_espelho` · `reconciliar`
(+ `_memberkit`, `_memberclass`, `_sellflux`) · `avaliar` · `aplicar_pesos` ·
`faixa_de` · `filtrar_em_etapas` / `campo_bate` / `funil` / `pessoas_da_etapa` /
`gerar_lista` · `resolver_colunas` / `valor_do_campo` / `extrair_colunas` ·
`chave_email` / `chave_documento` / `chave_telefone` · `norm_*` · `como_*` ·
`itens_de` · `txt_array` · `valores_do_campo` · `extrair`.

**Edge Functions no ar:** `qualificador-credencial-salvar` ·
`qualificador-sync` (HubSpot + teste de conexão das 4; v4 = o que está no repo) ·
`qualificador-espelhar` · `qualificador-importar` · `qualificador-importar-assiny`.

**Publicado em 28/08 00h20** (Version `be987f5a`): as colunas trazidas pelo funil
chegam na prévia e no XLSX, e o fluxo pode ser salvo como modelo sem gerar lista.

## 3b. A regra que a Tarefa 0-B estabeleceu

**Fonte pequena se espelha, fonte grande se consulta.**

MemberKit, MemberClass e Sellflux não sincronizam mais pessoa a pessoa — as três
são pequenas (a maior tem 1.433 registros) e perguntar uma por vez custava 1.293
chamadas HTTP por execução para não cruzar nada. A fonte inteira vai para
`qualificador.espelho_<fonte>` pela função `qualificador-espelhar` e o cruzamento
acontece em SQL (`qualificador.reconciliar`). Só o HubSpot fica em
`qualificador-sync`. Detalhes em `docs/tarefa-0b.md`.

## 4. Trabalho em aberto (pegue daqui)

### Etapa 2 — roteiro de 30/08: os quatro itens estão fechados

Verificação do Raphael direto no banco e no app, seguida de correção. Medido
depois: base 4.430 → **2.443** após os bloqueios duros.

| # | Item | Situação |
|---|---|---|
| 1 | Painel do funil mostrava 0 em tudo | **fechado** — era erro engolido, não zero |
| 2 | Duas chaves para o mesmo campo (id × caminho) | **fechado** — migration 67 |
| 2b | Campo inválido ≠ pessoa sem o dado | **fechado** — `_ignorar` + `ignorada` no funil |
| 3 | Terceiro estado `sem_dado` | **fechado** — `excluir`/`manter`/`apenas` |
| 4 | "Os filtros cortam demais" | **investigado** — ver abaixo |

Números medidos, todos batendo com o esperado do roteiro:

| caso | restam |
|---|---|
| sem etapa nenhuma | 2.443 |
| `mc.tem_conta` pelo **id** do catálogo | 2.364 *(era 0)* |
| `tem_memberclass` pelo caminho (legado) | 2.364 |
| etapa incompleta `{"campo":"","operador":""}` | 2.443 *(era 0)* |
| campo que não existe no catálogo | 2.443 |
| `mc.tem_conta` com `sem_dado: apenas` | **79** |

2.364 + 79 = 2.443: os dois lados são complementares dentro do universo
pós-bloqueio, como tinham que ser.

**Sobre o item 4 — os filtros não estavam cortando demais.** Duas conclusões:

1. A causa real era o item 2. Qualquer condição escrita com o id do catálogo
   zerava a lista, e a tela grava o id.
2. **`excluir_perdido_dias` NÃO está fixo em 15.** Medido pela RPC:
   0 → 3.917 · 7 → 2.602 · 15 → 2.443 · 30 → 2.223. O valor do formulário chega
   inteiro (`config()` em `iniciativas.ts` → `p_config`). O que faltava era
   visibilidade: o painel agora traz um **subtotal dos bloqueios duros** antes
   das etapas do usuário, para a queda de 4.430 → 2.443 não parecer culpa dos
   filtros que a pessoa montou.

### As telas duplicadas saíram (30/08)

`/importar` e `/iniciativas/nova` eram as versões avulsas dos passos 1 e 2 do
fluxo guiado — mesmo upload, mesmo `MapeamentoArquivo` (que já traz o botão
"Importar N linhas"), mesmo `ConstrutorEtapas`, mesmo motor. **Duas UIs para o
mesmo trabalho divergem:** o rascunho em `sessionStorage`, o desfazer, o aviso
de cobertura e o tratamento de erro do funil foram só para o `/fluxo`, e quem
entrasse pela porta antiga usava uma versão pior sem saber disso.

As rotas continuam de pé como `Navigate` para `/fluxo`, porque já circularam em
link colado. Os arquivos estão em `_to_delete/` (o sandbox não apaga).
`listarImportacoes` no fluxo subiu de 5 para 20 para não perder o histórico que
a tela de importar mostrava.

**O que ficou em "Avançado" não é caminho alternativo para montar lista** — é o
que o fluxo não faz:

| tela | por que fica |
|---|---|
| `/integracoes` | credenciais, teste de conexão, espelhamento, sync — nada disso existe no fluxo |
| `/saude-dos-dados` | métricas da base; é o lugar natural do botão de remedir cobertura |
| `/listas` | rebaixar o XLSX de uma lista antiga; o fluxo só dá acesso à da sessão |
| `/catalogo` | referência dos projetos e do de-para |
| `/iniciativas` | histórico das campanhas salvas (o `/fluxo` salva uma a cada lista gerada) |

### Cobertura dos campos — novo

`qualificador.cobertura_campo` (tabela) + `medir_cobertura()` respondem
"quantos da base têm esse dado?". O seletor mostra o % por campo e a etapa avisa
antes de filtrar. **Custa ~7 s e o teto do PostgREST é 8 s** — por isso é medida
sob demanda e gravada, nunca calculada por render. Rodar depois de importar,
sincronizar ou reconciliar.

Cobertura medida em 30/08 (4.430 pessoas): Assiny e identidade 100% ·
MemberClass 97,9% · Sellflux 95,8% · HubSpot derivados 78% · negócio 38–64% ·
**MemberKit 2,3%** · `hsc.caixa` **0%** (o re-sync ainda não rodou) ·
evento 0% (não há dado de evento na base).


0. ~~Publicar o que está no repo mas não em produção.~~ **Fechado em 27/08 22h.**
1. ~~Rodar as três fontes espelhadas de verdade.~~ **Fechado**: MemberKit 1.439
   (casou 56), MemberClass 11.197 (casa 324), Sellflux 19.949 (casa 1.099).
   A previsão de que a Sellflux cruzaria por telefone estava errada — ver seção 5.
2. ~~Encher `iniciativa` / `lista` / `lista_item`, e a tela.~~ **Fechado em 27/08
   23h10**: `/iniciativas/nova`, `/listas`, `/saude-dos-dados` e o XLSX estão no
   ar e testados de ponta a ponta. Ver `docs/telas-iniciativas.md`.
3. ~~Reconciliar a MemberClass.~~ **Fechado em 27/08 20h40** — e era pior do
   que parecia: o espelho estava parcial (11.197 do que deveriam ser 26.670),
   sobra da execução 35 que travou. Reespelhado e reconciliado: 4.339 pessoas,
   97,9% da base.
4. **Fatiar o espelhamento para caber no tempo da Edge Function.** MemberClass e
   Sellflux estouraram; precisam retomar de onde pararam, não recomeçar.
5. **Ler `divisao_times`.** Hoje toda a lista cai em `prioridade_times[1]` — foi
   por isso que a lista de teste saiu inteira como "IS".
5b. **Tarefa 2, itens (2) e (3)** — desenho em
   `docs/tarefa-2-multiplas-plataformas-e-de-para.md`, **aprovado pelo Raphael**
   (as 4 decisões estão na seção 9 daquele doc, não reabrir). Dos 5 passos da
   seção 8: **1 e 2 entregues** (migration 52 — condição ternária, combinador
   `qualquer`/`todas`, quantificador nos negócios). Faltam o 3 (catalogar), o 4
   (`traduzir` + `de_para`) e o 5 (tela com multi-seleção).
5b-bis. ~~BUG LATENTE: as properties de NEGÓCIO do HubSpot estão
   inalcançáveis.~~ **Consertado em 27/08, migration 52.** `props_deals` é
   indexado por id de negócio e vinha sendo lido como objeto plano; agora
   `condicao_avalia` itera os negócios e o `quantificador` (`algum` / `todo`)
   decide se a condição vale para um ou para todos. Medido na mesma pessoa:
   `campo_bate` era `false`, virou `true`; `valor_do_campo` era `null`, virou
   `["Forms Onboarding Nath","IniciAmazon | Nath"]`.
   Ver `docs/tarefa-2-passos-1-2-condicao-ternaria.md`.
5b-ter. ~~Passo 3: catalogar as props em `campo_filtravel`.~~ **Feito**,
   migration 53: 14 campos nativos (6 de contato, 8 de negócio). Ficaram de fora
   os de 0% de cobertura, os que já existem como derivados, e `dealstage` /
   `pipeline`, que são IDs e esperam o vocabulário do passo 4.
   `valores_do_campo` também passou a ler props (migration 54) — sem isso os 14,
   todos `enum`, viriam com seletor vazio.
5c. ~~O fluxo guiado ainda não é o caminho principal.~~ **Fechado em 27/08.**
   `/` abre `/fluxo`, a nav tem "Montar uma lista" em destaque e as 6 telas
   antigas num menu "Avançado". O passo 1 do fluxo **começa por upload** e reusa
   `analisarArquivos` + `MapeamentoArquivo`. Ver `docs/fluxo-guiado.md`.
   **Não testado:** montar uma etapa clicando no seletor de campos — o Radix
   Select não responde a evento sintético no navegador headless. Validei
   carregando um modelo já no formato novo. Vale um teste manual.
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

- **DUAS CHAVES PARA O MESMO CAMPO, e a errada cortava 100% em silêncio.**
  `campo_filtravel` expõe `id` (`mc.tem_conta`) e `caminho` (`tem_memberclass`).
  A tela grava o **id** em `colunas[]`, mas `condicoes[].campo` esperava o
  **caminho**. Uma condição escrita com o id não achava dado nenhum, virava
  "sem dado" para todo mundo, e com `sem_dado: excluir` zerava a lista sem erro.
  Medido: **0 pessoas com o id, 2.364 com o caminho**, mesma condição.
  Resolvido na migration 67: `resolver_condicao` aceita as duas e traduz o id
  para (fonte, caminho), **uma vez por etapa, nunca por pessoa** — ela consulta
  `campo_filtravel`, e fazer isso dentro de `condicao_avalia` seria uma leitura
  de tabela por pessoa × condição.
- **Campo inválido não é pessoa sem o dado.** Os dois davam "indeterminado", e
  `sem_dado: excluir` cortava nos dois casos. Um é erro de montagem da etapa, o
  outro é um fato sobre a pessoa. Hoje campo vazio/desconhecido ou operador
  ausente marca a condição com `_ignorar`, e **etapa sem nenhuma condição
  julgável não corta ninguém** — nem quando o modo é `apenas`, porque inverter
  uma etapa que não sabe julgar nada devolveria a base inteira como resposta.
- **`operador_bate` termina com `else return true`.** Operador que ela não
  conhece faz a condição valer para todo mundo: a etapa deixa de filtrar e
  ninguém percebe. Descobri escrevendo `maior_ou_igual` no lugar de
  `maior_igual` — a etapa "3+ aulas" devolveu 4.339 em vez de 2.280. Hoje
  `condicao_avalia` valida o operador contra a lista e devolve `ignorar`.
- **Espelhar uma query do React Query num `useState` engole o erro.** O painel
  do funil fazia `useEffect(() => { if (data) setFunil(data) })`: em erro o
  espelho ficava `[]`, e a tela mostrava **"Universo 0 · LISTA FINAL 0"** — um
  número inventado, indistinguível de um funil que de fato não sobrou ninguém.
  Use `placeholderData: (anterior) => anterior` para não piscar, e **trate
  `isError` explicitamente**: erro tem que aparecer como erro.
- **`create temp table` exige função VOLATILE.** Marcada `stable`, ela falha com
  `0A000` só na primeira chamada — a função existe e nunca roda.
- **`qualificador.has_min_papel` sempre aparece no `get_advisors`**
  (`authenticated_security_definer_function_executable`) e **é para ficar
  assim**. Ela é DEFINER de propósito e todas as policies do schema a chamam:
  revogá-la de `authenticated` quebraria a RLS inteira, que é a mesma armadilha
  da migration 41. É o único alerta aceito citando `qualificador`.

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
- **Importar não reconcilia.** A ingestão cria `pessoa` e `transacao`, e para
  por aí: `engajamento` e `saude_disparo` continuam com o casamento da base
  anterior, **sem erro nenhum**. Depois de toda importação, rodar
  `qualificador.reconciliar('memberkit' | 'memberclass' | 'sellflux')` — é SQL
  puro, segundos, zero HTTP. Foi o que faltava depois da importação de 27/08:
  os espelhos estavam certos e `saude_disparo` cobria só 28% da base nova.
- **`props_deals` é indexado por ID DE NEGÓCIO, não por property.** A estrutura
  é `{deal_id: {property: valor}}`. Ler `props_deals->'origem_de_trafego'`
  devolve null **sem erro**, e todo filtro e coluna sobre negócio vira vazio em
  silêncio. Consertado na migration 52: `valores_do_negocio` itera
  `jsonb_each(props_deals)`. E o conserto não é só um `->` a mais — 483 das 567
  pessoas discordam de si mesmas entre os próprios negócios, então a condição
  precisa do `quantificador` (`algum` / `todo`) para ter resposta.
- **Uma condição de etapa tem TRÊS estados, não dois.** `verdadeiro`, `falso` e
  `sem_dado` — e o `sem_dado` **não vota**. Se ele valesse `true`, um único dado
  faltando faria a etapa inteira passar sob o combinador `qualquer`, e o refino
  destruiria o filtro. `manter_sem_dado` só decide quando **nenhuma** condição
  pôde ser julgada.
- **Rótulo de campo não é único no catálogo.** "Dias sem acessar" existe na
  MemberClass e no MemberKit. Ao expor rótulos como cabeçalho de coluna, os dois
  saíam iguais e ninguém sabia qual era qual. `resolver_colunas` qualifica o
  repetido com a plataforma — e a **tela chama a mesma função**, em vez de ler
  `campo_filtravel` direto, senão o cabeçalho da prévia não bate com o do arquivo.
- **`npm run build` é `vite build` e NÃO faz typecheck. E `tsc --noEmit` sozinho
  também não.** O `tsconfig.json` da raiz tem `"files": []` e só aponta para os
  subprojetos — então `./node_modules/.bin/tsc --noEmit` **sai com 0 sem checar
  arquivo nenhum**. Isso é pior que não checar: dá a impressão de que passou.
  Foi assim que um `useRef` sem import chegou em produção e deixou **7 das 8
  telas em branco**. O comando certo é:

  ```bash
  ./node_modules/.bin/tsc -p tsconfig.app.json --noEmit
  ```

  Na primeira vez que rodei o certo, ele achou dois erros reais que o outro
  deixava passar. E `node_modules/` já apareceu vazio no meio da sessão (outra
  sessão ou o sandbox): `npm install` antes de acusar o build.
- **`qualificador-espelhar` APAGA a tabela antes de reconstruir.** A primeira
  invocação faz `delete from espelho_<fonte>` — "espelho é foto, não histórico".
  A consequência é que **interromper no meio deixa o espelho parcial**, e o
  cruzamento cai junto, sem erro nenhum. Fechar a aba, recarregar a página ou
  navegar para outra rota mata o laço. Antes de disparar um espelhamento grande
  (MemberClass leva ~8 min para 11.200 alunos), avise que a aba não pode ser
  mexida — ou torne a operação retomável sem apagar.
- **O sync do HubSpot não registra `em_andamento`.** Ele só grava a linha em
  `integracao_execucao` ao terminar o lote, então nada consegue saber que ele
  está rodando pela tabela. Isso quebra o critério 5 da Tarefa 0-B ("toda
  execução escreve linha, inclusive as em andamento") e obrigou `ocupadoPor()`
  a inferir pelo `crm_snapshot.sync_em` recente. **Dívida:** fazer o sync
  registrar no início, como `qualificador-espelhar` faz.
- **Um handler que muda N coisas precisa de UMA chamada de estado.** Escolher o
  campo de uma condição mudava condição, coluna e rótulo em três chamadas
  seguidas de `aoAtualizar`, cada uma montando o objeto a partir do render
  atual: a última sobrescrevia as outras. O sintoma enganava — a coluna e o
  rótulo apareciam, e a condição ficava vazia, o que fazia o funil **cortar
  todo mundo**, porque condição sem campo nunca é satisfeita.
- **`gerar_lista` roda `filtrar_em_etapas` UMA vez.** Ele o chamava duas —
  dentro de `funil()` e para os itens. Com 4.430 pessoas isso passou de 8 s e
  o PostgREST cancelou com `57014: statement timeout`, que chega no front como
  um 500 opaco. Hoje custa 3,38 s. **O teto é 8 s**: se a base dobrar, o
  gargalo volta, e ele é o `to_jsonb(v)` de uma view com 61 colunas por linha.
- **Visibilidade não pode depender de animação CSS.** O `PopoverContent` do
  shadcn nasce com `opacity: 0` e conta com a animação `enter` para chegar a 1.
  Aba em segundo plano pausa animações e `prefers-reduced-motion` as desliga —
  nos dois casos o componente abre invisível. Use `animate-none opacity-100`
  onde o conteúdo precisa aparecer sempre.
- **Estado de tela que o usuário construiu não pode viver só em `useState`.**
  O `/fluxo` guardava nome, etapas, colunas e pesos em estado local: sair para
  "Listas geradas" e voltar apagava o trabalho inteiro, sem erro nenhum. Agora vai
  para `sessionStorage` a cada mudança (`qualificador:fluxo:rascunho`) — da aba,
  não do navegador: fechar a janela descarta, que é o esperado para um rascunho.
  E cuidado com a ordem: o `useEffect` que grava precisa vir **depois** de todos
  os `useState` que lê, senão é TDZ e a tela fica em branco.
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
  previsão de que ela cruzaria *majoritariamente por telefone* **estava errada**,
  e continua errada na base grande: medido em `casar_espelho` sobre 4.430 pessoas,
  são **4.211 por e-mail contra 30 por telefone**. O critério de aceite 4 da
  Tarefa 0-B ("espera-se que a maioria case por telefone") não se confirma — o
  espelho guarda telefone de 35.575 dos 35.697 leads, então não é falta de dado:
  é que o e-mail casa antes, e a prioridade e-mail → documento → telefone está
  certa.
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

**As 53 migrations do schema `qualificador` agora estão no repo**, em
`supabase/migrations/`, nomeadas `<version>_<name>.sql`. Extraídas de
`supabase_migrations.schema_migrations.statements` em 27/08 — é o SQL exato que
foi aplicado, comentários inclusive. Antes disso o banco era a única cópia, e o
`main` não reproduzia o schema.

Aplicadas via MCP (`apply_migration`). Quem aplicar uma nova **precisa trazer o
`.sql` para o repo no mesmo commit**, senão o repo volta a divergir do banco.
Para reextrair tudo do zero, sem depender do CLI (que continua sem token):

```sql
select json_agg(json_build_object(
         'arquivo', version || '_' || name || '.sql',
         'sql', array_to_string(statements, E'\n\n')
       ) order by version)::text
from supabase_migrations.schema_migrations where name like 'qualificador%';
```

O resultado estoura o limite do MCP e é salvo em arquivo — processe com
`json.loads(..., strict=False)`, porque o envelope traz caracteres de controle
literais dentro da string.

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
- `docs/tarefa-2-fluxo-guiado.md` — a especificação do fluxo guiado (4 decisões fechadas)
- `docs/tarefa-2-colunas-e-modelos.md` — itens (1) e (4) da spec, entregues
- `docs/tarefa-2-multiplas-plataformas-e-de-para.md` — o desenho de (2) e (3), com as 4 decisões
- `docs/tarefa-2-passos-1-2-condicao-ternaria.md` — passos 1 e 2 do desenho, entregues
- `docs/fluxo-guiado.md` — o fluxo vira o caminho principal (passos 3 e 5)
- `docs/validacao-para-producao.md` — a varredura do front, 4 defeitos e 11 aceites
- `docs/etapa2-quatro-correcoes.md` — o roteiro de 30/08: as 4 correções e os números
- Projeto Claude "Qualificador de Leads" → `claude/mapa-apis-v1.md` (as 4 APIs) e
  `claude/estado-do-projeto.md` (espelho desta seção 3, para quem não abre o repo)
