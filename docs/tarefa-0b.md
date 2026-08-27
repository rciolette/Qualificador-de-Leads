# Tarefa 0-B — MemberKit, MemberClass e Sellflux

Aplicada em 27/08/2026. Substitui o PRD §8.2, §8.3 e §8.4 e os adaptadores
`memberkit.ts`, `memberclass.ts` e `sellflux.ts` da `qualificador-sync`.

## O erro que as três tinham em comum

Os adaptadores perguntavam **uma pessoa por vez**: para cada uma das 1.293 pessoas,
uma ou mais chamadas HTTP. Nenhuma das três fontes é grande — a maior tem 1.433
registros. A fase de rede era proporcional à *nossa* base, não à fonte.

| fonte | tamanho real | custo antes | custo agora |
|---|---|---|---|
| MemberKit | 1.433 membros | 1.293 chamadas · ~11 min | ~29 chamadas · ~15 s |
| MemberClass | 1 endpoint devolve o tenant inteiro | 3+ chamadas por pessoa | 1 chamada por 100 alunos |
| Sellflux | 30 leads por página | 1–2 chamadas por pessoa | `total_pages` chamadas |

**Correção:** espelhar a fonte inteira em tabela local e cruzar em SQL.

## Os três bugs específicos

- **Sellflux, bug 1 — o filtro de e-mail descartava tudo.** O adaptador casava
  `l.email === alvo.email`, e na Sellflux `email` vem `null` na maioria dos leads
  (está no próprio exemplo oficial). O `find` devolvia `null` e o lead era pulado.
  Era esta linha que fazia "não conferir nada".
- **Sellflux, bug 2 — o telefone nunca casava.** A API devolve `"phone": 51999999999`
  (sem DDI, sem máscara) e `pessoa.telefone_e164` guarda `+5551999999999`.
  Agora os dois lados viram **últimos 11 dígitos**, no TS e no SQL.
- **Sellflux, bug 3 — nunca rodou.** Zero linhas em `integracao_execucao`.
- **MemberClass — endpoint errado.** Usava `/user/informations?email=…`, que devolve
  `404 USER_NOT_FOUND` quando não acha; como `buscar()` lança em 404, todo
  "não tem conta" virava linha de erro. Existe `/api/v1/student/report?page=N&limit=100`,
  o relatório do tenant inteiro, sem filtro de e-mail.
- **MemberKit — não estava quebrado, estava mal usado.** Os 404 são legítimos: a base
  Assiny é IniciAmazon e a academia conectada é Consultorias/Mentorias. A sobreposição
  é pequena por natureza do negócio. `registros: 1` no log era `encontrados = 1`,
  não "1 processado".

## O que foi construído

**Migrations** `qualificador_20260827_14_espelhos` e `..._15_reconciliacao`:

- `espelho_memberkit`, `espelho_memberclass`, `espelho_sellflux` — `externo_id` PK,
  três chaves de cruzamento indexadas, `payload jsonb`, `coletado_em`. RLS ligada,
  mesma política das demais tabelas (leitor lê, operador escreve).
- `chave_email` / `chave_documento` / `chave_telefone` — as regras de normalização,
  **espelhadas em TS** em `fontes.ts`. Se uma mudar sem a outra, o casamento para
  de casar em silêncio.
- `v_chaves_pessoa` — todas as chaves conhecidas de cada pessoa, vindas de `pessoa`
  **e** de `pessoa_identificador` (5.167 linhas que o SQL do briefing deixaria de fora).
- `casar_espelho(fonte)` — e-mail vence documento, que vence telefone; uma linha por
  pessoa, com `casou_por` registrado.
- `reconciliar(fonte)` — preenche `engajamento` (MemberKit/MemberClass) e
  `saude_disparo` (Sellflux) por `insert … select`, sem HTTP. Devolve a contagem
  quebrada por `casou_por`.
- `finalizar_execucao(id, …)` — fecha a linha aberta em `em_andamento`.
- `engajamento.casou_por` e `saude_disparo.casou_por` — proveniência do cruzamento.
- `v_cobertura_espelhos` — quantas pessoas da nossa base existem em cada fonte.
  Substitui o "404 por pessoa" que virava erro no log.

**Edge Function `qualificador-espelhar`** (`POST { fonte, pagina_inicial?, execucao_id? }`):
grava a linha de execução **antes** da primeira página, apaga o espelho (é foto, não
histórico), pagina a fonte gravando cada página **em bulk**, re-invoca a si mesma
quando passa de 60 s, e na última página reconcilia e fecha o log.

**Removidos:** `memberkit.ts`, `memberclass.ts` e `sellflux.ts` da `qualificador-sync`
(movidos para `_to_delete/tarefa-0b/`). O `qualificador-sync` agora só tem o HubSpot —
a única fonte grande demais para espelhar. Pedir sync de uma fonte espelhada responde
409 apontando para a função certa. O **teste de conexão** das quatro fontes continua
em `qualificador-sync`.

**Front:** o botão das três fontes vira "Espelhar e cruzar" e mostra a página em
andamento. `espelhar()` em `src/lib/dados.ts` retoma sozinho se a re-invocação morrer.

## Estado dos critérios de aceite

| # | Critério | Situação |
|---|---|---|
| 1 | `memberkit` termina em <60 s com 1.433 linhas | pendente — precisa de execução real |
| 2 | `memberclass` registra `totalCount`; 0 ⇒ parar e reportar outro tenant | **implementado**, pendente de execução |
| 3 | `sellflux` registra `total`; grava `unsub_whats`; nenhum lead descartado por email null | **implementado**, pendente de execução |
| 4 | Contagem por `casou_por` (email/documento/telefone) | **implementado e testado** — teste com telefone sem DDI casou por `telefone` |
| 5 | Toda execução escreve linha, inclusive em andamento e com erro | **implementado** |
| 6 | Nada fora do schema `qualificador`; nenhum `pg_cron` novo | **OK** |

## Falta um deploy

As migrations já estão no banco `qevnfgopjupsmwvflcza` e a função
`qualificador-espelhar` já está no ar (v1). Ainda **não** foram publicados:

```bash
supabase functions deploy qualificador-sync --project-ref qevnfgopjupsmwvflcza  # remove os 3 adaptadores de produção
npm run deploy                                                                  # front com o botão novo
```

Até lá, produção segue com o `qualificador-sync` antigo — inofensivo, porque o
front novo não chama mais aquele caminho para as três fontes.
