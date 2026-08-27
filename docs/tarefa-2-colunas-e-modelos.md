# Tarefa 2, itens (1) e (4) — colunas no resultado e modelo sem gerar lista

Entregue em 27/08/2026. Fecha os dois itens que o Raphael marcou como "menores e
que destravam o dia a dia". Os itens (2) múltiplas plataformas por etapa e
(3) de-para entre plataformas **não** entraram: mudam o formato do motor e o
desenho vai antes do código.

## (1) Enriquecer passou a trazer as colunas

Antes, `manter_sem_dado` só decidia se quem não tem o dado sai do funil. A
exportação tinha 18 colunas fixas: dava para filtrar por leadscore e não ver o
leadscore no arquivo.

Agora cada etapa declara o que **traz**:

```json
{"id":"e1","campo":"aulas_concluidas","operador":"maior_igual","valor":"1",
 "colunas":["mc.aulas","hs.leadscore_faixa","sf.tags"]}
```

As colunas do resultado são a união do que cada etapa **ativa** trouxe, na ordem
em que apareceram — etapa desligada não contribui, senão o arquivo teria coluna de
um filtro que o usuário desistiu de aplicar.

Ao escolher o campo da etapa, ele entra sozinho como coluna: quem filtra por
"aulas assistidas" quase sempre quer ver o número. Dá para tirar no seletor.

### Onde isso vive

| Objeto | Papel |
|---|---|
| `resolver_colunas(jsonb)` | resolve os ids de `campo_filtravel` **uma vez por consulta**, não por pessoa |
| `valor_do_campo(jsonb, jsonb)` | pura, IMMUTABLE — extrai um valor do jsonb da pessoa |
| `extrair_colunas(jsonb, jsonb)` | monta `{id: valor}` de uma pessoa |
| `v_dados_pessoa` | o mesmo jsonb que `filtrar_em_etapas` monta, agora nomeado |
| `lista.colunas` | o cabeçalho **resolvido**, congelado na geração |
| `lista_item.extras` | os valores por pessoa, congelados |

O cabeçalho vai resolvido, não como ids: se o campo for renomeado ou sair do
catálogo, o arquivo antigo continua legível. Mesma razão pela qual `lista.funil`
já era congelado.

## (4) Salvar o fluxo não gera mais lista

Antes só havia o botão "Gerar lista": guardar uma receita obrigava a produzir uma
lista descartável, porque a `iniciativa` só nascia junto com ela.

Agora existe `qualificador.modelo_fluxo` — nome, etapas, colunas, pesos, config.
Não cabia em `recorte` (que é seed embutido, não do usuário) nem em `iniciativa`
(que é a execução, não a receita).

A coluna `de_para jsonb` já nasce aqui, vazia. É onde o mapeamento entre
plataformas vai morar quando o item (3) existir — o spec exige que ele seja salvo
junto com o modelo, e adicionar a coluna depois seria migrar dado em produção.

`iniciativa.modelo_id` guarda de onde a execução saiu.

## Aceite executado no app publicado

Sessão de usuário real, não `service_role`.

| # | O que | Resultado |
|---|---|---|
| 1 | Etapa "Aulas assistidas ≥ 1" traz sua coluna sozinha | passou |
| 2 | Marcar 4 colunas a mais, de 3 plataformas | passou — 5 no total |
| 3 | Funil recalcula: 675 → 100 | passou |
| 4 | Prévia mostra as 5 colunas com valor real | passou |
| 5 | "Salvar como modelo" **não** gera lista | passou — `lista` continuou em 1 |
| 6 | Recarregar a tela e carregar o modelo reproduz o funil idêntico | passou — 675 → 100 |
| 7 | Gerar lista congela cabeçalho e valores | passou — 100 pessoas |
| 8 | XLSX sai com as colunas trazidas | passou — 143.185 bytes |
| 9 | Zero erro HTTP em todo o percurso | passou |
| 10 | `get_advisors` sem alerta novo citando `qualificador` | passou |

A lista "Reativar quem assiste aula" (100 pessoas) ficou no banco — é uma lista
legítima, não lixo de teste. Apagar se não servir.

## Um defeito achado no meio do caminho

**"Dias sem acessar" existe na MemberClass E no MemberKit.** Marcadas as duas, o
cabeçalho saía com a mesma palavra repetida e ninguém sabia qual era qual.
`resolver_colunas` agora detecta rótulo repetido no catálogo e acrescenta a
plataforma: "Dias sem acessar · MemberClass".

Isso obrigou a uma decisão: **o rótulo é do banco, não do catálogo cru.** A tela
passou a chamar `resolver_colunas` também, em vez de ler `campo_filtravel`
direto — senão o cabeçalho da prévia não bateria com o do arquivo.

## As duas regras, conferidas

- **Zero HTTP por pessoa.** `resolver_colunas` é STABLE e lê `campo_filtravel`
  uma vez por consulta; `valor_do_campo` e `extrair_colunas` são IMMUTABLE e não
  leem tabela nenhuma. Ler o catálogo dentro do laço de 1.293 linhas seria o mesmo
  erro de escala da Tarefa 0-B, só que em SQL em vez de HTTP.
- **Nada fora de `qualificador`.** Migrations 44 a 48, todas no schema.

## Divergências

- `pessoas_da_etapa` e `gerar_lista` mudaram de assinatura (ganharam `p_colunas`).
  Como o tipo de retorno de `pessoas_da_etapa` mudou, foi `drop` e recria — o front
  foi atualizado no mesmo commit, mas **qualquer chamador externo quebra**.
- `node_modules/` estava vazio quando fui buildar (outra sessão, ou o sandbox).
  `npm install` resolveu. O projeto não tem `tsc` no `package.json`: `npm run build`
  é `vite build`, que **não faz typecheck**. Rodei `./node_modules/.bin/tsc --noEmit`
  à mão, sem erro.
