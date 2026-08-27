# Telas do motor de iniciativas — `/iniciativas/nova`, `/listas`, `/saude-dos-dados`

Entregue em 27/08/2026. Fecha o item 2 da seção 4 do `CLAUDE.md`: o motor já
respondia por SQL, mas ninguém conseguia usá-lo sem abrir o banco.

## O que entrou

| Arquivo | Papel |
|---|---|
| `src/pages/IniciativaNovaPage.tsx` | tela em 3 colunas: cabeçalho, recortes prontos, construtor de etapas, pesos; coluna fixa com o funil ao vivo |
| `src/components/ConstrutorEtapas.tsx` | etapa = campo + condição + valor, reordenável, com a chave `manter_sem_dado` |
| `src/components/FunilExclusao.tsx` | funil clicável — cada linha abre quem saiu ali (`pessoas_da_etapa`) |
| `src/pages/ListasPage.tsx` | listas geradas, com download |
| `src/pages/SaudePage.tsx` | as métricas de `v_saude_dados` e `v_panorama` |
| `src/lib/iniciativas.ts` | camada de acesso ao motor |
| `src/lib/exportar.ts` | XLSX de 4 abas, regerado do banco a cada download |

## Aceite executado no ar

Feito no app publicado, com a sessão do usuário real — não por `service_role`.

| # | O que | Resultado |
|---|---|---|
| 1 | `/iniciativas/nova` carrega com 42 campos filtráveis e 9 recortes | passou |
| 2 | Funil calcula sem etapa: 1.293 → 805, bloqueios duros contando (115 / 23 / 350) | passou |
| 3 | Etapa "Número de compras ≥ 2" entra no funil: 778 → 8 | passou |
| 4 | Perfil de peso "Corujão · recuperar perdido" aplica os 8 eixos | passou |
| 5 | Gerar lista grava e redireciona para `/listas` | passou — 8 pessoas, IS: 8 |
| 6 | Download XLSX | passou — 27.766 bytes, `iniciativa-...-2026-08-27.xlsx` |
| 7 | `/saude-dos-dados` mostra as 6 métricas e o frescor das 4 fontes | passou |
| 8 | Zero erro HTTP em todo o percurso | passou |

A iniciativa de teste e a lista de 8 foram apagadas depois. `lista` voltou a 1.

## Três defeitos achados e corrigidos no caminho

**1. `rpc/funil` devolvia 403 para o usuário logado.** A migration 41 revogou
`campo_bate` de `authenticated`. Mas `filtrar_em_etapas` é `SECURITY INVOKER`:
ela chama `campo_bate` em nome de quem está logado, não do dono da função. O
resultado foi a tela inteira parar — e o erro aparecer no console como um 500
genérico. `campo_bate` recebe jsonb e devolve boolean, não lê tabela nenhuma:
revogá-la não protegia nada. Migration 43 devolve o `execute` a `authenticated`
e mantém `anon` de fora.

> A regra geral: **revogar de `authenticated` só vale para função `SECURITY
> DEFINER`.** Numa função `INVOKER`, revogar quebra quem chama.

**2. Todo deep link caía em `/integracoes`, em silêncio.** Colar `/listas` no
navegador abria a home. A causa está no `AuthContext`: o efeito que lê o papel
rodava no primeiro render, via `session` null — porque `getSession()` ainda não
tinha respondido, não porque o usuário estava deslogado — e já declarava
`carregando = false`. Aí `Protegido` mandava para `/entrar`, a sessão chegava, e
o `LoginPage` jogava todo mundo em `/integracoes`. Agora existe `sessaoLida`:
só se diz "terminei de carregar" depois da primeira resposta. E o `Protegido`
carimba `state.de` para o `LoginPage` voltar ao destino certo.

**3. A rota era `/saude`, a tarefa 3 pedia `/saude-dos-dados`.** `/saude-dos-dados`
virou a canônica; `/saude` redireciona, porque já circulou em link colado.

## Divergências em relação ao previsto

- **A Sellflux cruza por e-mail, não por telefone.** O `CLAUDE.md` previa
  "cruzando majoritariamente por telefone". Medido em `casar_espelho('sellflux')`:
  1.099 pessoas casadas, **1.074 por e-mail** e 25 por telefone. O `distinct on`
  prefere e-mail quando os dois existem, e a Sellflux tem e-mail em mais leads do
  que se supunha. É um resultado melhor que o previsto, não pior — mas a previsão
  no `CLAUDE.md` estava errada e foi corrigida.
- **`espelho_memberclass` não traz telefone nenhum** (0 de 11.197 linhas). O
  cruzamento com a MemberClass depende inteiramente do e-mail hoje: 324 pessoas.

## O que ficou fora

- **A reconciliação da MemberClass não rodou.** `engajamento` tem 56 linhas, todas
  do MemberKit, embora `casar_espelho('memberclass')` case 324 pessoas. As
  execuções 35 (memberclass) e 36 (sellflux) estão presas em `em_andamento` desde
  01:30 e 01:46 — estouraram o tempo da Edge Function sem chamar
  `finalizar_execucao`. Eram de outra sessão, em andamento no momento desta
  entrega; não mexi nelas.
- **A divisão por time continua provisória.** `divisao_times` existe e não é lida:
  todo mundo cai em `prioridade_times[1]` — foi por isso que a lista de teste saiu
  "IS: 8".
