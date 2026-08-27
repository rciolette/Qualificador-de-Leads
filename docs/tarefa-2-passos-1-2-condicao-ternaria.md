# Tarefa 2 · passos 1 e 2 — a condição ternária e o conserto dos negócios

Entregue em 27/08/2026. Implementa os passos 1 e 2 da seção 8 de
`docs/tarefa-2-multiplas-plataformas-e-de-para.md`, com o desenho aprovado pelo
Raphael (seção 9 daquele documento).

**Só banco.** A tela ainda não oferece o combinador — é o passo 5, e depende
destes dois estarem no ar. O que muda hoje é que o motor aceita o formato novo e
o bug do `props_deals` morreu.

Ordem confirmada pelo Raphael: **consertar primeiro, catalogar depois** (opção B).
Catalogar as props de negócio antes do conserto entregaria ~19 campos no seletor
devolvendo vazio para todo mundo.

## O bug que estava armado

`crm_snapshot.props_deals` é indexado **por id de negócio**:

```json
{ "60762002225": { "origem_de_trafego": "Forms Onboarding Nath" },
  "60762230932": { "origem_de_trafego": "IniciAmazon | Nath"    } }
```

`campo_bate` e `valor_do_campo` liam `props_deals->caminho`, como se fosse um
objeto plano. Toda property de negócio devolvia vazio, **sem erro nenhum**.

Não tinha disparado só porque `campo_filtravel` não tem nenhum campo com fonte
`hubspot_contato` / `hubspot_negocio` — que é o que liga o caminho `nativo`.
Catalogar as props era o gatilho.

Achado pela sessão de nuvem; confirmado aqui de forma independente antes de
aceitar, na mesma pessoa que ela mediu.

## Por que o conserto exigiu decisão de produto

Uma pessoa tem N negócios, e não existe resposta única para "qual a origem de
tráfego dela?". Medido em 27/08:

| | |
|---|---|
| Pessoas com property de negócio | 567 |
| Com mais de um negócio | 508 (90%) |
| Média de negócios por pessoa | 3,05 · máximo 10 |
| Que **discordam de si mesmas** em `origem_de_trafego` | **483** (85%) |

Daí o `quantificador`: `algum` (padrão) ou `todo`.

## O que foi criado

| Função | Papel |
|---|---|
| `valor_ausente(jsonb)` | null, `""` ou `[]` — a definição de ausência, num lugar só |
| `valores_do_negocio(jsonb, text, boolean)` | os valores de uma property entre os N negócios; sem distinto para o filtro, com distinto para a coluna |
| `operador_bate(jsonb, text, jsonb)` | um operador sobre **um** valor já presente |
| `condicao_avalia(jsonb, jsonb)` | **três estados**: `verdadeiro` / `falso` / `sem_dado` |
| `campo_bate(jsonb, jsonb)` | combina as condições da etapa; aceita os dois formatos |
| `valor_do_campo(jsonb, jsonb)` | corrigida: property de negócio vira lista |

### A regra que faz o `qualquer` funcionar

`sem_dado` **não vota**. Se devolvesse `true`, um único dado faltando faria a
etapa inteira passar sob o combinador `qualquer` — o refino destruiria o filtro.

| Combinador | Passa quando |
|---|---|
| `qualquer` | ao menos uma condição é `verdadeiro` |
| `todas` | nenhuma é `falso` **e** ao menos uma é `verdadeiro` |

`manter_sem_dado` virou o **desempate para quando nenhuma condição pôde ser
julgada**. É isso que preserva o comportamento antigo para etapa de condição
única.

`vazio` e `preenchido` continuam sendo a exceção: existem para testar a ausência,
então nunca devolvem `sem_dado`.

## Aceite

Os 10 aceites propostos na seção 7 do desenho. Nove executados; o 9 depende do
passo 4 (vocabulário), que não entrou.

| # | O que | Resultado |
|---|---|---|
| 1 | `qualquer` devolve mais que cada condição sozinha | **115** vs 78 (MC) e 42 (MK) ✅ |
| 2 | `todas` devolve ≤ a menor | **38** ≤ 42 ✅ |
| 3 | `qualquer` com uma condição sem dado não passa todo mundo | **78**, não 619 ✅ |
| 4 | Todas sem dado: filtro zera, refino preserva | **0** e **619** ✅ |
| 5 | `campo_bate` sobre property de negócio | era `false`, agora **`true`** ✅ |
| 6 | `valor_do_campo` da mesma property | era `null`, agora **`["Forms Onboarding Nath","IniciAmazon | Nath"]`** ✅ |
| 7 | `algum` inclui, `todo` exclui, mesma condição | `verdadeiro` / `falso` ✅ |
| 8 | Formato antigo roda sem edição e dá o mesmo | **87 = 87** e **547 = 547** ✅ |
| 9 | Vocabulário com duas plataformas | não executado — passo 4 |
| 10 | `get_advisors` sem alerta novo | 154 alertas no projeto, **1 cita `qualificador`** e é o pré-existente ✅ |

Além disso, na tela publicada: `/iniciativas/nova` carrega, o modelo salvo no
formato antigo roda (619 → 87) e **zero erro HTTP**. Era o risco real — a
migration 41 derrubou a tela inteira com 403 exatamente por recriar `campo_bate`.

## Uma divergência de número que não é regressão

O aceite 8 dá **87**, e a mesma etapa dava **100** na entrega anterior. Não é
mudança de comportamento: formato antigo e formato novo dão **exatamente o mesmo
valor** hoje (87 = 87, 547 = 547).

A base mudou entre as duas medições. O espelho da Sellflux foi de 19.949 para
**35.697** linhas, `saude_disparo` cresceu, e os bloqueios duros subiram junto —
o universo depois dos bloqueios caiu de 675 para **619**.

## Decisões e armadilhas

- **`STABLE`, não `IMMUTABLE`.** A `campo_bate` antiga era `IMMUTABLE` e usava
  `current_date` no operador `proximos_dias` — mentira para o planejador. As
  novas que dependem de `current_date` são `STABLE`; só `valor_ausente` e
  `valores_do_negocio` seguem `IMMUTABLE`, porque são puras de verdade.
- **Grants refeitos em bloco.** `CREATE OR REPLACE` devolve `EXECUTE` para
  `PUBLIC`, e estas funções são chamadas por `filtrar_em_etapas`, que é
  `INVOKER`. O `do $do$` no fim da migration revoga de `public`/`anon` e concede
  a `authenticated`/`service_role` nas seis de uma vez.
- **Nenhuma migração de dado.** A etapa sem `condicoes` é embrulhada como
  condição única. O modelo salvo e as 3 iniciativas existentes continuam
  funcionando sem serem tocados.

## O que vem a seguir

Passo 3 do desenho: catalogar em `campo_filtravel` as 19 props de negócio e as 36
de contato, com `fonte` nativa. Agora é seguro — antes do conserto, entregaria
campo que devolve vazio.
