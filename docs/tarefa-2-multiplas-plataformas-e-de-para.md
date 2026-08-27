# Tarefa 2 · itens (2) e (3) — múltiplas plataformas por etapa e de-para

**Isto é desenho, não código.** O Raphael pediu explicitamente o desenho antes da
implementação (CLAUDE.md, seção 4, item 5b). Nada aqui foi aplicado no banco.

Cobre os dois itens que ficaram abertos na especificação do fluxo guiado
(`docs/tarefa-2-fluxo-guiado.md`):

- **(2)** múltiplas plataformas na mesma etapa, com `qualquer uma` / `todas`
- **(3)** de-para entre plataformas, declarado pelo usuário e salvo com o modelo

Medições deste documento: 27/08/2026, sobre o estado real do banco.

---

## 1. O que a etapa é hoje

Uma etapa é **uma condição só**. O formato, em `modelo_fluxo.etapas` e em
`iniciativa.filtros`:

```json
{ "id": "e1", "rotulo": "MemberClass 3+ aulas", "ativa": true,
  "fonte": "memberclass", "campo": "mc.aulas", "operador": "maior_igual",
  "valor": 3, "nativo": false, "manter_sem_dado": true,
  "colunas": ["mc.aulas", "mc.ultimo_acesso"] }
```

`qualificador.campo_bate(dados, etapa)` devolve **booleano**, e
`filtrar_em_etapas` corta quem devolveu `false`. Uma etapa = um `update`.

Isso funciona, e os 10 aceites da entrega anterior passaram em cima disso. O que
falta é justamente a pluralidade: **não há onde colocar a segunda condição**, nem
como dizer se ela soma ou multiplica.

---

## 2. O achado que muda o plano: as properties de negócio estão inalcançáveis

Antes de desenhar o item (2), medi o caminho `nativo` — o que lê as properties
cruas do HubSpot. Ele está **quebrado**, e de um jeito silencioso.

`crm_snapshot.props_deals` é indexado **por id de negócio**:

```json
{ "60762002225": { "origem_de_trafego": "Forms Onboarding Nath", "amount": null },
  "60762230932": { "origem_de_trafego": null,                    "amount": "47"  } }
```

Mas `campo_bate` e `valor_do_campo` leem como se fosse um objeto plano:

```sql
p_dados->'props_deals'->caminho     -- procura a property no lugar do id do negócio
```

Medido numa pessoa com 4 negócios, um deles com `origem_de_trafego` preenchida:

| Chamada | Devolveu |
|---|---|
| `dados->'props_deals'->'origem_de_trafego'` | `null` |
| `campo_bate(..., operador 'preenchido')` | **`false`** |
| `valor_do_campo(...)` | **`null`** |

Ou seja: **todo filtro e toda coluna sobre property de negócio do HubSpot
devolveria vazio**, sem erro nenhum. É a mesma família da armadilha do
`sql.json` que corrompeu 659 linhas em silêncio (CLAUDE.md, seção 5).

**A boa notícia é que ainda não explodiu.** `campo_filtravel` tem hoje 41 campos
e **nenhum** com `fonte` em `('hubspot_contato','hubspot_negocio')` — que é
exatamente o que `resolver_colunas` usa para marcar `nativo = true`. O caminho
existe no código, mas nenhum campo catalogado passa por ele.

A armadilha está **armada, não disparada**. E o próximo passo natural — catalogar
as 18 props de negócio já configuradas em `integracao.config.props_negocio` — é
o que puxa o gatilho. Por isso entra neste desenho, e não depois.

### 2.1. Consertar exige uma decisão de produto, não só um `->` a mais

Uma pessoa tem N negócios. Perguntar "qual a origem de tráfego dela?" não tem
resposta única. Medido:

| | |
|---|---|
| Pessoas com property de negócio | 567 |
| Com **mais de um** negócio | **508** (90%) |
| Média de negócios por pessoa | 3,05 · máximo 10 |
| Que **discordam de si mesmas** em `origem_de_trafego` | **483** (85%) |

Em 85% dos casos os negócios da mesma pessoa dão respostas diferentes. Não existe
default seguro: o motor precisa que o usuário diga se a condição vale para
**algum** negócio ou para **todos**.

E essa é a mesma pergunta do item (2), um nível abaixo. É por isso que os dois
andam juntos.

---

## 3. Item (2) — o desenho

### 3.1. A etapa passa a carregar uma lista de condições

```json
{ "id": "e1", "rotulo": "Engajado em alguma área de membros", "ativa": true,
  "combinador": "qualquer",
  "manter_sem_dado": true,
  "colunas": ["mc.aulas", "mk.progresso"],
  "condicoes": [
    { "fonte": "memberclass", "campo": "mc.aulas",     "operador": "maior_igual", "valor": 3 },
    { "fonte": "memberkit",   "campo": "mk.progresso", "operador": "maior_igual", "valor": 50 }
  ] }
```

Muda o que precisa mudar e nada mais:

- `combinador` (`qualquer` | `todas`) e `manter_sem_dado` são **da etapa**, como
  a especificação decidiu.
- `fonte` / `campo` / `operador` / `valor` descem para **dentro da condição**.
- `colunas` continua na etapa: o que a etapa traz para o resultado é da etapa,
  não de cada condição.

### 3.2. A condição passa a ter três respostas, não duas

Este é o miolo do desenho, e a razão de ele não ser trivial.

Se `manter_sem_dado` continuasse sendo aplicado **dentro** da condição — como é
hoje —, uma condição sem dado devolveria `true`. Com o combinador `qualquer`
(OR), um único dado faltando faria a etapa inteira passar sempre. O refino
destruiria o filtro.

Então a condição passa a devolver **três estados**:

| Estado | Quando |
|---|---|
| `verdadeiro` | tem o dado e o dado satisfaz o operador |
| `falso` | tem o dado e o dado não satisfaz |
| `sem_dado` | não tem o dado (`null`, `""`, `[]`) |

`sem_dado` **não vota**. Ele não é nem a favor nem contra:

| Combinador | A etapa deixa passar quando |
|---|---|
| `qualquer` | ao menos uma condição é `verdadeiro` |
| `todas` | nenhuma condição é `falso` **e** ao menos uma é `verdadeiro` |

E aí `manter_sem_dado` volta a ter um papel claro, no nível da etapa: ele é o
**desempate para quando nenhuma condição pôde ser julgada** (todas `sem_dado`).

| `manter_sem_dado` | Todas as condições sem dado → |
|---|---|
| `false` (padrão) | a pessoa **sai** — a etapa é filtro |
| `true` | a pessoa **segue** — a etapa é refino |

Isso preserva exatamente o comportamento medido na entrega anterior: "MemberClass
3+ aulas" leva 16 → 0 como filtro e 16 → 16 como refino. Uma etapa com uma
condição só se comporta como hoje, valor por valor.

Os operadores `vazio` e `preenchido` continuam sendo a exceção: existem para
testar a ausência, então nunca devolvem `sem_dado` — devolvem `verdadeiro` ou
`falso` sobre a própria ausência.

### 3.3. O quantificador, para quando o dado é uma coleção

Cada condição ganha um campo opcional:

```json
{ "fonte": "hubspot_negocio", "campo": "hs.neg.origem", "operador": "igual",
  "valor": "IniciAmazon | Nath", "quantificador": "algum" }
```

| `quantificador` | Significado | Vale para |
|---|---|---|
| `algum` (padrão) | basta um negócio satisfazer | negócios do HubSpot |
| `todo` | todos os negócios precisam satisfazer | negócios do HubSpot |

Só se aplica a `fonte = 'hubspot_negocio'`, que é a única coleção por pessoa
hoje. Com ele, `campo_bate` itera `jsonb_each(props_deals)` em vez de indexar
direto — e o bug da seção 2 morre junto.

Um negócio sem a property não vota, pela mesma regra ternária: uma pessoa com 4
negócios em que só 1 tem `origem_de_trafego` é julgada por esse 1, não reprovada
pelos 3 silenciosos.

### 3.4. Por que não um combinador aninhado (grupos de grupos)

Seria mais geral, e é o que uma engine de regras genérica faria. Está fora de
escopo de propósito: a especificação pede *"múltipla escolha de plataformas numa
etapa"*, e a etapa já é a unidade de aninhamento — encadear etapas **é** o AND
externo. Um usuário que precisa de `(A ou B) e C` faz duas etapas. Um nível de
combinador cobre o pedido; dois níveis custam uma UI de árvore que ninguém pediu.

---

## 4. Item (3) — o de-para

### 4.1. Dois de-paras diferentes, e só um deles é do usuário

O pedido do Raphael, na especificação: *"declarar que o `email` de lá é o `email`
daqui, que o `status` de lá corresponde a tal coisa."* São duas coisas, e tratá-las
como uma seria um erro caro.

| | O que é | Quem manda |
|---|---|---|
| **Identidade** | qual campo casa pessoa com pessoa | **o sistema** — fechado |
| **Vocabulário** | o "Ativo" de lá é o "ativo" de cá | **o usuário** — é o item (3) |

A identidade **não entra** no de-para editável. Ela já está resolvida em
`chave_email` / `chave_documento` / `chave_telefone` + `casar_espelho`, e carrega
a armadilha do telefone que vive em dois lugares (`chave_telefone()` no banco e
`chaveTelefone()` em `fontes.ts`) — mudar um sem o outro faz o cruzamento parar
de casar em silêncio. Dar essa alavanca ao usuário na tela é convidar o bug de
volta. O cruzamento medido (Sellflux 1.099, MemberClass 324, MemberKit 56) é
consequência disso e não deve ficar editável.

O que falta, e é o que ele quer de verdade, é o **vocabulário**.

### 4.2. Formato proposto para `modelo_fluxo.de_para`

A coluna existe e está vazia. Proposta:

```json
{ "vocabularios": [
    { "id": "status_do_aluno",
      "rotulo": "Status do aluno",
      "valores": ["ativo", "inativo", "cancelado"],
      "mapa": {
        "memberclass": { "campo": "mc.status",
                         "de": { "Ativo": "ativo", "Trancado": "inativo" } },
        "memberkit":   { "campo": "mk.status",
                         "de": { "active": "ativo", "expired": "cancelado" } },
        "hubspot":     { "campo": "hs.leadscore_faixa",
                         "de": { "Cliente": "ativo" } }
      } } ] }
```

O usuário cria um **valor canônico** e diz, por plataforma, qual campo o alimenta
e como cada valor de lá vira um valor de cá. Uma condição pode então filtrar pelo
vocabulário em vez de pelo campo de uma plataforma:

```json
{ "vocabulario": "status_do_aluno", "operador": "e_um_de", "valor": ["ativo"] }
```

Uma função nova, `qualificador.traduzir(dados, de_para, vocabulario) → text[]`,
devolve o conjunto de valores canônicos que a pessoa tem naquele vocabulário,
somando todas as plataformas mapeadas. `e_um_de` e `contem_algum` passam a
funcionar sem que o usuário saiba de qual plataforma veio cada um.

### 4.3. Por que traduzir na hora, e não materializar

Tentador gravar o valor traduzido no espelho e acabar com o custo. Não:

- o de-para é **por modelo** e editável — materializar significaria re-espelhar
  as três fontes a cada edição de rótulo;
- o espelho é **cópia fiel da fonte**, princípio que a Tarefa 0-B estabeleceu.
  Um espelho com valores traduzidos deixa de ser conferível contra a origem.

Traduzir dentro do funil é lookup em `jsonb` sobre dado já em memória temporária
(`_et`). Não há chamada HTTP, não há join novo — a regra de ouro da especificação
("uma etapa nunca faz chamada HTTP por pessoa") continua intacta.

---

## 5. Retrocompatibilidade

**Nenhuma migração de dado.** `campo_bate` passa a aceitar os dois formatos:

```
se a etapa tem 'condicoes'  → formato novo
senão                       → embrulha a própria etapa como condição única
```

O modelo salvo hoje (1 registro, com colunas, `de_para` vazio) e a iniciativa que
gerou as 233 linhas de `lista_item` continuam funcionando sem serem tocados. Isso
também dá reversibilidade: se o formato novo der problema, as etapas antigas
seguem válidas.

`de_para` vazio (`{}` ou `{"vocabularios": []}`) significa "sem tradução" — que é
o comportamento de hoje.

---

## 6. O que muda, arquivo por arquivo

| Onde | Mudança |
|---|---|
| `qualificador.campo_bate` | devolve **3 estados**; aceita `condicoes`; itera negócios com `quantificador`; conserta o `props_deals` |
| `qualificador.filtrar_em_etapas` | combina as condições por etapa; aplica `manter_sem_dado` como desempate |
| `qualificador.valor_do_campo` | lê `props_deals` por negócio, com `quantificador` |
| `qualificador.traduzir` | **nova** — resolve vocabulário → `text[]` |
| `campo_filtravel` | catalogar as 18 props de negócio + 36 de contato com `fonte` nativa |
| `src/lib/iniciativas.ts` | `Etapa` ganha `combinador` e `condicoes`; `Condicao` nova |
| tela `/iniciativas/nova` | multi-seleção de plataforma, escolha do combinador, editor de vocabulário |

**Atenção obrigatória:** `campo_bate` é `IMMUTABLE` e chamada por
`filtrar_em_etapas`, que é `INVOKER`. Depois de qualquer `CREATE OR REPLACE`, o
`EXECUTE` volta para `PUBLIC` (armadilha da seção 5) — e revogar de
`authenticated` foi exatamente o que derrubou a tela inteira com 403 na migration
41, consertado na 43. **Recriar sem revogar, e conferir a tela depois.**

---

## 7. Aceite proposto

Mensurável, para a implementação ter onde bater:

1. Uma etapa com `memberclass 3+ aulas` **ou** `memberkit progresso ≥ 50` e
   combinador `qualquer` devolve **mais** pessoas que qualquer uma das duas
   sozinha.
2. A mesma etapa com combinador `todas` devolve **menos** ou igual à menor delas.
3. Uma etapa com combinador `qualquer` em que **uma** das condições não tem dado
   **não** passa todo mundo — o `sem_dado` não vota.
4. Etapa com todas as condições sem dado: `manter_sem_dado: false` zera,
   `true` preserva. (Hoje: 16 → 0 e 16 → 16.)
5. `campo_bate` sobre `origem_de_trafego` de negócio com `quantificador: algum`
   devolve **verdadeiro** para a pessoa medida na seção 2 — hoje devolve `false`.
6. `valor_do_campo` da mesma property devolve o valor, não `null`.
7. Uma das 483 pessoas com origens divergentes é **incluída** por `algum` e
   **excluída** por `todo`, na mesma condição.
8. Um modelo salvo no formato antigo roda sem edição e dá o mesmo total de hoje.
9. Um vocabulário com duas plataformas mapeadas casa pessoas que só existem em
   uma delas.
10. `get_advisors` sem alerta novo citando `qualificador`.

---

## 8. Ordem sugerida

O conserto do `props_deals` vem primeiro porque é bug, e porque catalogar as
props de negócio sem ele entrega campos que devolvem vazio.

1. `campo_bate` / `valor_do_campo` — negócios + 3 estados (aceites 5, 6, 7)
2. `filtrar_em_etapas` — combinador e desempate (aceites 1–4, 8)
3. catalogar as props em `campo_filtravel` com fonte nativa
4. `traduzir` + formato do `de_para` (aceite 9)
5. tela

Os passos 1–2 já valem sozinhos: consertam um bug latente e não dependem do
de-para.

---

## 9. O que preciso do Raphael antes de codar

1. **O desempate ternário está certo?** É a decisão menos óbvia daqui: `sem_dado`
   não votar, e `manter_sem_dado` só valer quando *nenhuma* condição pôde ser
   julgada. A alternativa seria `manter_sem_dado` por condição — mais flexível,
   mas quebra o `qualquer` como descrito em 3.2.
2. **`algum` como padrão do quantificador** — com 85% das pessoas discordando de
   si mesmas entre negócios, o padrão decide muita coisa. `algum` é mais
   permissivo e me parece o que ele espera de "essa pessoa veio do IniciAmazon".
3. **Identidade fora do de-para editável** (seção 4.1) — é um "não" a metade do
   pedido literal, com motivo. Se ele quiser mesmo editar chave de cruzamento, o
   lugar é outro e a conversa é outra.
4. **Um nível de combinador, sem grupos aninhados** (seção 3.4).

---

## 10. Estado medido em 27/08/2026

Para o desenho não flutuar quando alguém reler daqui a duas semanas:

| | |
|---|---|
| `campo_filtravel` | 41 campos · **0** com fonte nativa |
| `crm_snapshot` | 1.217 linhas · 567 com `props`/`props_deals` · 650 nulos |
| `pessoa` sem `crm_snapshot` | 76 (todas com e-mail, nenhuma com `hubspot_id`) |
| `props_negocio` no config | 18 · aplicadas em só **94** pessoas |
| `caixa_disponivel` | **0** pessoas — nem a chave; config já corrigido, falta reler |
| `modelo_fluxo` | 1 · com colunas · `de_para` vazio |
| `lista_item` | 233 |
| Migrations `qualificador` | 52, **nenhuma em arquivo no repo** |
