# Tarefa 2 — Fluxo guiado

Especificação. Decisões tomadas pelo Raphael em 27/08/2026.
Substitui o rascunho `claude/funil-de-qualificacao-rascunho.md` do projeto Claude.

## O problema

O app hoje é um painel: Importar, Saúde dos dados, Iniciativas, Listas geradas,
Catálogo — cada tela por conta própria, e o usuário tem que saber a ordem de cabeça.

O que o Raphael faz na vida real é uma sequência só, e sempre a mesma forma:

> pegar a base de vendas da Assiny → cruzar com a área de membros → ver quem está
> mais engajado (quantas aulas assistiu, último acesso) → filtrar → **exportar a
> planilha** que alimenta o disparo de WhatsApp de reativação.

Ele já fez isso à mão uma vez. O app precisa ser esse caminho, com botão.

## O que construir

**Um fluxo guiado, linear, tipo formulário.** Cada dado informado e cada filtro
aplicado avança uma etapa. Dá para **voltar e refazer** qualquer etapa. No fim, a
lista aparece na tela **e** é exportável (xlsx/csv) para a máquina do usuário.

### Etapa 1 — a base de origem
- Upload de **uma ou mais planilhas** (export da Assiny ou de qualquer ferramenta).
- O sistema lê as colunas e **pergunta o de-para**.
- O usuário aplica o primeiro filtro (status, produto, o que for).
- Já existe: a Edge Function `qualificador-importar` faz upload, leitura de colunas,
  sugestão de de-para e `fonte_importacao` (perfil salvo). **Reaproveitar, não refazer.**
- Fica em aberto para o futuro: puxar a base direto de uma área de membros, sem planilha.

### Etapas 2..N — as conferências
Cada etapa tem quatro escolhas do usuário:

1. **Plataforma(s)** — múltipla escolha entre MemberClass, MemberKit, HubSpot e Sellflux.
   A ordem **não é fixa**: a E-cont não tem área de membros, então essa base vai
   direto ao HubSpot, pulando a etapa de área de membros.
2. **Modo** — `filtrar` (quem não está lá sai da lista) ou `enriquecer`
   (continua, só sem aquele dado). **Por etapa**, não global.
3. **Combinação**, quando marca mais de uma plataforma — `qualquer uma` (união) ou
   `todas` (interseção). **Por etapa.**
4. **Campos** — quais colunas daquela plataforma trazer, para filtrar e comparar.
   Já existe: `qualificador.campo_filtravel` (42 campos catalogados, com tipo e
   operadores válidos). É a matéria-prima desta escolha.

Depois de trazer os campos, o usuário aplica os filtros daquela etapa e segue.

### De-para entre plataformas
Pedido explícito do Raphael, e **não existe hoje**: ele quer declarar, dentro do
sistema, que o `email` de lá é o `email` daqui, que o `status` de lá corresponde a
tal coisa. Hoje o de-para só vai do arquivo para os nossos campos canônicos.
Isso precisa virar mapeamento **entre plataformas**, editável por ele, e salvo junto
com o modelo do fluxo.

### Etapa final — a saída
- A lista na tela, com as colunas que ele trouxe pelo caminho.
- Export xlsx/csv. **A saída é sempre um arquivo. O app não dispara nada.**

### Contagem por etapa
A tela mostra **quantos restaram a cada etapa**. É isso que faz um funil ser legível
— sem esse número, o usuário não sabe qual filtro matou a lista.

## Decisões já tomadas — não reabrir

| Pergunta | Decisão |
|---|---|
| Pessoa sem match na plataforma | O usuário escolhe **por etapa**: filtrar ou enriquecer |
| Duas plataformas na mesma etapa | O usuário escolhe **na etapa**: qualquer uma ou todas |
| Telas atuais | O fluxo guiado vira o **caminho principal**; as telas atuais viram **avançado** |
| Reuso | O fluxo montado **fica salvo como modelo reutilizável**, junto com o de-para |

Sobre as telas atuais: **Integrações continua necessária** (gravar credencial,
espelhar fonte) e o motor de score da Tarefa 1 (`avaliar`, `aplicar_pesos`,
`faixa_de`, `perfil_peso`, `recorte`) continua servindo **por baixo** do fluxo.
Nada disso é descartado — muda de lugar, não de existência.

## Sobre o que isto se apoia

Não parte do zero. Já está pronto e testado:

- `qualificador-importar` — upload de qualquer planilha, leitura de colunas, de-para
- `qualificador-espelhar` + `qualificador.reconciliar` — as três fontes pequenas
  espelhadas localmente e cruzadas em SQL, com `casou_por` (email/documento/telefone)
- `qualificador-sync` — HubSpot por lote
- `campo_filtravel` (42), `recorte` (9), `perfil_peso` (7)

**Regra que não pode ser quebrada:** uma etapa do fluxo **nunca** faz chamada HTTP
por pessoa. Consulta a plataforma pelo espelho local (MemberKit, MemberClass,
Sellflux) ou pelo `crm_snapshot` (HubSpot). Foi exatamente esse erro que a Tarefa 0-B
acabou de corrigir — ver `docs/tarefa-0b.md`.

## Pré-requisito

As três fontes espelhadas precisam estar rodando de ponta a ponta antes de a Tarefa 2
começar a valer. Sem espelho, cada etapa do funil vira chamada por pessoa de novo.
