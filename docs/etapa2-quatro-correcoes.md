# Etapa 2 — as quatro correções do roteiro de 30/08

Roteiro do Raphael, verificado por ele direto no banco e no app. Ordem seguida
como pedida. Tudo medido contra a base real de 4.430 pessoas.

## 1 · O painel do funil mostrava 0 em tudo

**Não era o motor.** `qualificador.funil('[]', '{}')` sempre devolveu
4.430 → 2.443 com as 8 linhas de bloqueio corretas.

A causa estava na ponte. `FluxoPage` mantinha um `useState` espelhando a query:

```tsx
const [funil, setFunil] = useState<LinhaFunil[]>([])
useEffect(() => { if (calcular.data) setFunil(calcular.data) }, [calcular.data])
```

O espelho só é preenchido em **sucesso**. Com a RPC em erro, ele fica `[]`, e
`universo` e `final` caem para `0` — um número inventado, indistinguível de um
funil que de fato não sobrou ninguém.

Corrigido: a query é a fonte única (`calcular.data ?? []`), com
`placeholderData: (anterior) => anterior` para não piscar durante o recálculo, e
`isError` tratado explicitamente. Em erro o painel diz *"Não consegui calcular o
funil. Os números abaixo seriam inventados, então não mostro nenhum"*, com a
mensagem do erro e um botão de tentar de novo.

## 2 · Duas chaves para o mesmo campo

`campo_filtravel` expõe `id` (`mc.tem_conta`) e `caminho` (`tem_memberclass`).
A tela grava o **id** em `colunas[]`; `condicoes[].campo` esperava o **caminho**.

| condição | pessoas |
|---|---|
| `{"campo":"mc.tem_conta"}` | **0** |
| `{"campo":"tem_memberclass"}` | 2.364 |

Uma chave só, agora: `resolver_condicao` (migration 67) aceita o id e traduz
para (fonte, caminho); o caminho continua aceito como fallback, senão toda etapa
já salva quebraria.

A tradução roda **uma vez por etapa**, em `filtrar_em_etapas`, antes do laço —
nunca por pessoa. `resolver_condicao` consulta `campo_filtravel`, e chamá-la de
dentro de `condicao_avalia` seria uma leitura de tabela por pessoa × condição.

### 2b · Campo inválido não é pessoa sem o dado

Eram tratados igual, e `sem_dado: excluir` cortava nos dois casos. Um é erro de
montagem, o outro é um fato sobre a pessoa.

Hoje a condição sem campo, com campo fora do catálogo, sem operador, ou com
operador que pede valor e não tem, recebe `_ignorar` e **some do cálculo**.
Etapa sem nenhuma condição julgável não corta ninguém, e `funil()` devolve
`ignorada: true` com `saem_aqui: 0`. Na tela, o cartão fica tracejado com
*"Etapa incompleta — ignorada no cálculo"*, e a linha do painel também.

Um caso vizinho apareceu no caminho: `operador_bate` termina com
`else return true`, então um operador que ela não conhece fazia a condição valer
para todo mundo. Descobri escrevendo `maior_ou_igual` em vez de `maior_igual` —
a etapa "3+ aulas" devolveu 4.339 em vez de 2.280. `condicao_avalia` agora
valida o operador contra a lista conhecida e devolve `ignorar`.

## 3 · O terceiro estado

`sem_dado`: `excluir` (padrão) · `manter` · `apenas`. O booleano
`manter_sem_dado` continua sendo lido nas etapas já salvas.

```
ok = semDado ? false : (combinador === 'todas' ? todas : alguma)
if (semDado && sem_dado === 'manter') ok = true
if (sem_dado === 'apenas') ok = !ok
```

Uma exceção deliberada: **etapa sem condição julgável não é invertida**.
Inverter uma etapa que não sabe julgar nada devolveria a base inteira como se
fosse resposta.

Na tela, três botões lado a lado — `Tira da lista` · `Mantém na lista` ·
`Só esses — inverte`. Lado a lado de propósito: escondidos atrás do switch
anterior, o segundo e o terceiro estado não existiam para quem não lia a
documentação.

Medido com `mc.tem_conta`: `excluir` → 2.364 · `apenas` → **79**.
Somam 2.443, o universo pós-bloqueio.

## 4 · "Os filtros estão cortando demais"

Investigado antes de mexer em regra de negócio, como o roteiro pediu.

**Causa principal: o item 2.** Qualquer condição escrita com o id do catálogo
zerava a lista — e é o id que a tela grava.

**`excluir_perdido_dias` não está fixo em 15.** Medido pela RPC:

| valor | perdido recente | lista final |
|---|---|---|
| 0 | 0 | 3.917 |
| 7 | 1.315 | 2.602 |
| 15 | 1.474 | 2.443 |
| 30 | 1.694 | 2.223 |

O valor do formulário chega inteiro (`config()` em `iniciativas.ts`). O que
faltava era **visibilidade**: o painel agora traz um subtotal dos bloqueios
duros antes das etapas do usuário, para a queda de 4.430 → 2.443 não parecer
culpa dos filtros que a pessoa montou.

## Além do roteiro, na mesma passada

- **Cobertura por campo.** `cobertura_campo` + `medir_cobertura()` respondem
  "quantos da base têm esse dado?". O seletor mostra o % ao lado de cada campo, e
  a etapa avisa antes de filtrar quando a cobertura é baixa — *"Aulas assistidas
  existe para 4.339 das 4.430 pessoas (98%). Como filtro, esta etapa devolve no
  máximo isso"*. Custa ~7 s, então é medida sob demanda e gravada; o teto do
  PostgREST é 8 s e ele já derrubou `gerar_lista` uma vez.
- **Seletor por plataforma.** Chips no topo do popover, porque quem monta uma
  etapa quase sempre pensa "quero cruzar com a MemberClass" antes de saber que
  campo quer. A busca continua ignorando a plataforma escolhida.
- **Desfazer** no construtor de etapas, 20 passos. Remover uma etapa é um clique
  numa lixeira sem confirmação, e ela leva junto as colunas e o rótulo.

## O que ficou de fora

`cobertura_origens()`, o redesenho da pilha de cartões, a Etapa 1 com pergunta
de mesclagem e a limpeza de vocabulário — como o roteiro definiu.

Também segue pendente o **re-sync do HubSpot**: `hsc.caixa` está catalogado e em
**0% de cobertura**, porque a property entrou em `props_contato` (migration 59)
depois da última leitura. A cobertura medida é a evidência disso.

## Migrations

59 (caixa) · 60–61 (ternário, operador desconhecido) · 62–66, 70 (cobertura) ·
67 (chave única, `_ignorar`, `sem_dado`) · 68 (`ignorada` no funil) ·
69 (resolução antes do laço). Todas versionadas em `supabase/migrations/`.

`get_advisors` fica com **um** alerta citando `qualificador`:
`has_min_papel` como SECURITY DEFINER executável — e é para ficar assim. Todas
as policies do schema a chamam; revogá-la de `authenticated` quebraria a RLS
inteira, a mesma armadilha da migration 41.
