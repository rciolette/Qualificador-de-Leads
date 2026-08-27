# O fluxo guiado vira o caminho principal

Entregue em 27/08/2026. Fecha a parte da especificação
(`docs/tarefa-2-fluxo-guiado.md`) que estava aberta desde o começo: o app era um
painel de seis abas, e o trabalho real é uma sequência só.

## O que mudou na tela

A raiz (`/`) agora abre `/fluxo`, e a navegação tem **um** item em destaque —
"Montar uma lista" — com as seis telas antigas recolhidas num menu **Avançado**.
Nenhuma foi apagada: Integrações continua sendo onde a credencial é gravada e as
fontes são espelhadas, e o motor de score continua rodando por baixo.

O fluxo tem três passos, e dá para voltar em qualquer um:

| Passo | O que faz |
|---|---|
| **1. A base** | arrasta a planilha da Assiny, confere o de-para das colunas, importa |
| **2. Os filtros** | monta as etapas, vê o funil recalcular ao lado, salva como modelo |
| **3. A lista** | prévia com as colunas que você trouxe, gera e baixa o XLSX |

O passo 1 **reusa** o que já existia — `analisarArquivos`, `MapeamentoArquivo`,
`qualificador-importar`. Não foi refeito, foi encaixado na sequência.

## O que entrou junto, no motor

Os passos 3 e 4 do desenho de `docs/tarefa-2-multiplas-plataformas-e-de-para.md`:

- **14 campos nativos catalogados** (migration 53) — 6 de contato e 8 de negócio.
  Três critérios de corte: nada com 0% de cobertura, nada que já exista como campo
  derivado, e nada que dependa de de-para para ser legível (`dealstage` e
  `pipeline` são IDs e esperam o vocabulário).
- **`valores_do_campo` passou a ler props** (migration 54). Sem isso os 14 campos
  novos, todos `enum`, viriam com o seletor de opções vazio — e o usuário
  concluiria que a fonte não sincronizou.

## Aceite, na tela publicada

| # | O que | Resultado |
|---|---|---|
| 1 | `/` abre o fluxo, não `/integracoes` | ✅ |
| 2 | Nav com "Montar uma lista" + menu Avançado | ✅ |
| 3 | Passo 1 mostra o dropzone e o que já foi importado | ✅ |
| 4 | Seletor de campos lista os 55 (41 + 14 novos) | ✅ |
| 5 | Modelo com duas condições carrega e mostra o combinador | ✅ "satisfizer qualquer uma" |
| 6 | Condição de negócio mostra o quantificador | ✅ "A pessoa tem vários negócios" |
| 7 | Funil calcula com property de negócio | ✅ 619 → **249** |
| 8 | Prévia traz colunas de negócio e contato juntas | ✅ `[L06] Desafio Seller 100k` · `IniciAmazon \| Nath` · `Faixa D` |
| 9 | Gerar e baixar | ✅ 244.450 bytes |
| 10 | Zero erro HTTP em toda a jornada | ✅ |

O aceite 7 é o que mais importa: até a migration 52, aquela etapa devolveria
**zero** — a property de negócio era ilegível.

## Uma limitação do meu teste, dita com todas as letras

Não consegui **acionar o seletor de campos por clique** no navegador headless: o
Radix Select não responde a evento sintético nem a clique por coordenada nesse
ambiente. Validei o caminho React → RPC criando um modelo já no formato novo e
carregando-o pela tela — o que prova que o front lê, renderiza e envia
`condicoes`, `combinador` e `quantificador` corretamente.

**O que não está provado é o clique humano de montar a etapa do zero na
interface.** Vale um teste manual seu antes de confiar nele para valer.

## Decisões

- **`normalizarEtapa` no front, não migração no banco.** O motor aceita os dois
  formatos; a tela converte o antigo ao carregar. Assim existe uma UI só, e nenhum
  modelo salvo precisou ser tocado.
- **O quantificador só aparece quando a condição é de negócio.** É a única coleção
  por pessoa. Mostrar sempre seria ruído.
- **O combinador só aparece com duas ou mais condições.** Com uma, não há o que
  combinar.
- **Escolher um campo já o traz como coluna.** Quem filtra por leadscore quase
  sempre quer ver o leadscore na planilha. Dá para tirar no seletor de colunas.

## O que continua em aberto

- **Passo 4 do desenho: o de-para de vocabulário.** `modelo_fluxo.de_para` existe
  e está vazio; `traduzir` ainda não foi escrita. Enquanto isso, `dealstage` e
  `pipeline` ficam fora do catálogo, porque filtrar por ID não serve.
- **O re-sync do HubSpot.** `caixa_disponivel` e `investimento_disponivel` estão
  no config e em zero — entraram depois da última leitura. E o
  `qualificador-sync` morre com HTTP 546 na base inteira: precisa ser fatiado
  antes de rodar de novo.
- **`divisao_times`.** Toda lista ainda cai no primeiro time da prioridade.
