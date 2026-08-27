# Validação para produção — filtros e front

27/08/2026. Varredura sistemática do app, com os defeitos achados e o que foi
feito com cada um. Tudo medido na versão publicada, com sessão de usuário real.

## Os defeitos que estavam no ar

### 1. Sete das oito telas em branco

`useRef is not defined`. Ao extrair o dropzone para `<ZonaDeUpload/>`, o import
saiu da `ImportarPage` e a linha que o usava ficou. Derrubava o bundle inteiro —
só `/fluxo` sobrevivia, por não passar por aquele módulo. Nenhuma requisição
falhava: era `ReferenceError` no console.

**E o motivo de não ter sido pego é mais importante que o bug.** `tsc --noEmit`
na raiz **não checa arquivo nenhum**: o `tsconfig.json` tem `"files": []` e só
referencia os subprojetos, então o comando sai com 0 sempre. O certo é
`tsc -p tsconfig.app.json --noEmit`, e na primeira vez que rodei o certo ele
achou dois erros reais.

### 2. O rascunho sumia ao trocar de página

O `/fluxo` guardava nome, etapas, colunas e pesos em `useState`. Sair para
"Listas geradas" e voltar apagava tudo — sem erro, sem aviso. Agora vai para
`sessionStorage` a cada mudança e volta no passo em que estava.

### 3. Escolher o campo perdia a condição

O mais traiçoeiro. Escolher um campo muda três coisas — a condição, a coluna
trazida e o rótulo da etapa — e eram **três chamadas de `aoAtualizar` em
sequência**, cada uma montando o objeto a partir do `etapa` do render atual. A
última sobrescrevia as anteriores.

O sintoma enganava: a coluna aparecia, o rótulo aparecia, e a condição ficava
vazia. O funil então cortava todo mundo, porque condição sem campo nunca é
satisfeita. Agora é **uma atualização só**.

### 4. `gerar_lista` estourava o statement timeout

HTTP 500 com `57014: canceling statement due to statement timeout`. Não era
regressão: a base cresceu de 1.293 para 4.430 pessoas e `filtrar_em_etapas`
passou a custar ~4 s sozinho — só que `gerar_lista` o rodava **duas vezes**, uma
dentro de `funil()` e outra para os itens.

Agora roda uma vez e materializa em `_gl`; funil e itens saem dela. A
sobreposição também deixou de ser subquery por pessoa. **8 s+ → 3,38 s.**

## O que mudou por usabilidade, não por defeito

**O seletor de campo ganhou busca.** Eram 55 campos num `<Select>` agrupado, e
três começam igual ("Origem de tráfego · primeira", "· mais recente", "do
negócio"). Agora abre um popover com busca que ignora acento e casa também com o
nome interno da property — quem chega da documentação do HubSpot procura por
`origem_de_trafego`, não pelo rótulo que demos.

**O popover não depende de animação para aparecer.** O `PopoverContent` padrão
nasce com `opacity: 0` e conta com a animação `enter` para chegar a 1. Uma aba em
segundo plano pausa animações CSS e `prefers-reduced-motion` as desliga — nos
dois casos o seletor abriria invisível. Visibilidade não pode depender de
animação.

**Sliders de peso ganharam `aria-label`.** Eram os oito únicos controles sem nome
acessível na tela.

## Aceite

| # | O que | Resultado |
|---|---|---|
| 1 | As 8 rotas abrem | ✅ zero erro de JS, zero HTTP falho |
| 2 | Criar, reordenar, desativar e remover etapa | ✅ |
| 3 | Adicionar e remover 2ª condição | ✅ combinador aparece só com 2+ |
| 4 | Buscar e escolher campo | ✅ "origem de trafego do neg" → 1 resultado |
| 5 | Duas condições gravam certo | ✅ `memberclass/aulas=1` + `hubspot_negocio/origem` |
| 6 | Quantificador aparece só em campo de negócio | ✅ |
| 7 | Funil recalcula | ✅ 4.430 → 3.174 → 86 |
| 8 | Sair da tela e voltar preserva tudo | ✅ nome, etapas, combinador e funil |
| 9 | Prévia com as colunas trazidas | ✅ 50 linhas |
| 10 | Gerar e baixar | ✅ 89.712 bytes |
| 11 | `gerar_lista` dentro do timeout | ✅ 3,38 s (era 8 s+) |

## O que fica de atenção

- **`filtrar_em_etapas` custa ~4 s** para 4.430 pessoas, e o teto do PostgREST é
  8 s. Hoje cabe com margem de 2×, mas a margem encolhe conforme a base cresce. O
  gargalo é o `to_jsonb(v)` de uma view com 61 colunas, linha a linha.
- **Um HTTP 500 transitório** apareceu numa das rodadas e não se repetiu. Na
  ocasião o sync do HubSpot rodava em lotes ao mesmo tempo — provável saturação
  de conexão, não defeito de código. Vale observar se reaparece.
- **O sync do HubSpot não foi retomado.** 3.204 pessoas seguem sem `crm_snapshot`;
  a correção da fila (migration 57) está no ar e a v6 da Edge Function grava
  "procurei e não achei", então rodar agora termina em vez de repetir.
