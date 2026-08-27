# Tarefa 1 — Motor de iniciativas

Entregue em 27/08/2026. O motor existe, foi exercitado contra dado real e
**produziu a primeira lista**: 133 pessoas.

## O que mudou de rumo no meio

A Tarefa 1 foi especificada como um formulário fixo de oito cartões (A a H).
No meio da construção o pedido mudou, e para melhor:

> "o processo de definir de onde vou extrair e/ou filtrar cada coisa eu posso usar
> em etapas para ir aos poucos filtrando os leads pelas plataformas e dados que eu
> quero por campos de qualificação e campos nativos de dados do contato/negócio"

Isso é um construtor em etapas, não um formulário. Os oito cartões viraram
**catálogo de campos** (`campo_filtravel`, 42 entradas) e a filtragem virou uma
**cascata**: cada etapa recebe quem sobrou da anterior. Um filtro sobre property
nativa do HubSpot é uma etapa como qualquer outra.

Os dois motores coexistem: `avaliar()` aplica os oito cartões do PRD;
`filtrar_em_etapas()` aplica a cascata. Ambos compartilham bloqueio duro e score.

## Aceites

| # | Aceite | Resultado |
|---|---|---|
| 3 | Peso 0 desliga o eixo | passou — score virou o eixo restante puro (30,0) |
| 4 | CNPJ ordena diferente de Launch atrair | passou — 1.277 de 1.293 mudam de posição; top 50 com 17 em comum |
| 5 | `incluir_sem_leadscore` não descarta faixa nula | passou — 804 de 804 passam; `exigir_faixa` deixa 0 |
| 6 | Anti-fadiga por time + número | passou — mesmo time barra 1, time diferente barra 0, fora da janela barra 0 |
| 7 | Perdido 10d fora, 20d entra | passou |
| 8 | Cada linha do funil abre quem saiu | passou — `pessoas_da_etapa(ordem)` |
| 1 | ECONT-MemberKit 228 → 95 | **não rodado — falta dado** |
| 2 | IS/AE 617 → 460 + 109 | **não rodado — falta dado** |

Os dois últimos exigem a base ECONT importada (hoje 0 transações) e MemberKit
reconciliado. Forjar o número seria pior que reportar o bloqueio.

## O defeito que o motor revelou

Ao exercitar o funil com dado real, **todos os bloqueios duros contavam zero**.
A causa não estava no motor: 659 das 738 linhas de `crm_snapshot` tinham `deals`,
`econt` e `disparo` gravados como **string de JSON**, não objeto — a armadilha do
`JSON.stringify` que o `CLAUDE.md` seção 5 já nomeia, cometida pelo sync antes da
correção. `jsonb_typeof` devolvia `"string"` e todo `deals->'itens'` virava null.

Depois do reparo (migration 35, o dado era recuperável):

| Etapa | Antes | Depois |
|---|---|---|
| Novos / Em conexão | 0 | **99** |
| falha de entrega | 0 | **18** |
| perdido há ≤ 15 dias | 0 | **296** |

**413 pessoas que uma lista gerada ontem teria incluído indevidamente** — entre
elas 99 que já recebem cadência automática e 296 que disseram não nos últimos 15 dias.

O reparo expôs um segundo defeito: `econt->>'fim'` passou a devolver `""` em vez
de null, e `''::date` derrubava a view inteira. Daí os casts tolerantes
(`como_data`, `como_ts`, `como_bool`) da migration 37.

## Alertas de segurança fechados

`get_advisors` citava **26** ocorrências de `qualificador`. O mais grave:
`credencial_ler` executável por `authenticated` — qualquer um dos quatro usuários
com login podia ler o Private App token do HubSpot em texto puro. A migration 10
já revogava isso; um `CREATE OR REPLACE` posterior restaurou o grant padrão
(EXECUTE para PUBLIC), que é o comportamento do Postgres ao recriar função.

**Revogar depois de cada `CREATE OR REPLACE` não é opcional.**

Restou **1** alerta, intencional: `has_min_papel` precisa ser executável por
`authenticated` porque todas as policies de RLS a chamam em nome do usuário.
Não devolve segredo — só um booleano sobre o papel de quem já está autenticado.

## Decisões

**Peso 0 sai da soma E do divisor.** Se ficasse no divisor, desligar um eixo
rebaixaria todo mundo em vez de tornar o eixo irrelevante.

**Eixo sem dado devolve valor neutro, nunca zero.** Zerar por ausência de
sincronização transformaria "não sabemos" em "é ruim" — o oposto da regra de
conduta do blueprint sobre o Leadscore.

**`lista_item.score` virou `numeric(5,1)`.** Era `int` como no PRD 5.5, e o
arredondamento produzia linhas com score 80 e faixa B (a faixa fora calculada com
79,9). Dois números iguais com faixas diferentes na mesma tela é o tipo de detalhe
que faz a operação parar de confiar na ferramenta.

**Divisão por time é provisória.** Hoje todos vão para `prioridade_times[1]`.
A lista gerada saiu com 133/133 em IS. `divisao_times` existe na tabela e ainda
não é lida — falta a regra por faixa de score ou por condição.

## A decisão em aberto do rascunho do funil

O rascunho "Funil de qualificação" pergunta: quando a pessoa não existe na
plataforma consultada numa etapa, ela sai ou fica? Está resolvido, por etapa,
com a flag `manter_sem_dado` (migration 41):

| Flag | Comportamento |
|---|---|
| ausente / `false` | a etapa é **filtro** — quem não tem o dado sai |
| `true` | a etapa é **refino** — quem não tem o dado segue, sem ser julgado |

Medido com a etapa "MemberClass 3+ aulas": **16 → 0** como filtro, **16 → 16**
como refino.

O rascunho supõe que o enriquecimento aconteceria dentro da etapa. Não acontece,
e é de propósito: as fontes espelhadas já populam `engajamento`, `crm_snapshot` e
`saude_disparo`, e `v_pessoa_completa` as junta com left join antes de o funil
começar. Consultar a plataforma dentro da etapa seria voltar ao laço por pessoa
que a Tarefa 0-B removeu. O que resta decidir por etapa é só se a ausência exclui.

## O que falta

- Tela `/iniciativas/nova` — o motor responde, a interface não existe
- Telas `/listas` e `/saude-dos-dados`
- Exportação XLSX/CSV
- Aceites 1 e 2, quando houver base ECONT e MemberKit reconciliado
