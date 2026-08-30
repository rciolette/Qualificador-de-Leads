-- A rotina noturna: uma fonte por vez, retomando de onde parou.
--
-- POR QUE UM ORQUESTRADOR, E NÃO QUATRO JOBS DE HORÁRIO FIXO:
--
-- `registrar_execucao` recusa um espelhamento quando já há outro em andamento,
-- com esta mensagem, que não é exagero: "duas fontes ao mesmo tempo esgotam os
-- workers do projeto e derrubam até o sync do HubSpot". Quatro jobs em horários
-- fixos funcionam enquanto cada fonte cabe na sua janela -- e no dia em que a
-- MemberClass demorar 40 min em vez de 22, o job seguinte falha. Um único job
-- que pergunta "o que falta agora?" nunca cria concorrência.
--
-- E `pg_net` dispara sem esperar resposta, então o encadeamento não pode viver
-- dentro de uma chamada: vive no estado. Cada disparo avança uma fatia; o
-- seguinte, dois minutos depois, continua.
--
-- ORDEM: as fontes espelhadas primeiro, da menor para a maior (MemberKit ~15 s,
-- Sellflux, MemberClass ~22 min), depois o HubSpot lote a lote, e só no fim a
-- manutenção. Assim uma noite interrompida deixa o máximo de fontes completas,
-- em vez de todas pela metade.

create or replace function qualificador.cron_madrugada()
returns text
language plpgsql
volatile
security definer
set search_path to 'qualificador', 'pg_catalog', 'extensions'
as $function$
declare
  v_url text := 'https://qevnfgopjupsmwvflcza.supabase.co/functions/v1/';
  -- chave anon: pública por definição, serve só para passar pelo gateway
  -- (verify_jwt). Quem autoriza de verdade é o x-cron-secret, que vem do vault.
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFldm5mZ29wanVwc213dmZsY3phIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMTU5MzcsImV4cCI6MjA5OTc5MTkzN30._9g0MQIvE0X0luU5ndL0CUyJuIdNvdwSiJIjpw-iyrM';
  v_segredo text;
  v_headers jsonb;
  v_fonte text;
  v_falta int;
begin
  select decrypted_secret into v_segredo
    from vault.decrypted_secrets where name = 'qualificador_cron_secret';
  if v_segredo is null then
    return 'sem segredo no vault: qualificador_cron_secret';
  end if;

  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || v_anon,
    'x-cron-secret', v_segredo);

  -- 1. NADA em paralelo. Uma execução recente em andamento significa que a
  --    fatia anterior ainda está rodando; 20 min é o teto de uma invocação
  --    (orçamento de 60 s) com folga generosa para o worker morrer sem avisar.
  if exists (
    select 1 from qualificador.integracao_execucao
     where status = 'em_andamento' and executado_em > now() - interval '20 minutes')
  then
    return 'ocupado: espelhamento em andamento';
  end if;

  -- 2. Fonte espelhada que ainda não fechou hoje, da menor para a maior.
  select f into v_fonte from unnest(array['memberkit','sellflux','memberclass']) f
   where not exists (
     select 1 from qualificador.espelho_progresso p
      where p.fonte = f
        and p.concluido_em is not null
        and p.concluido_em > date_trunc('day', now() at time zone 'America/Sao_Paulo')
                             at time zone 'America/Sao_Paulo')
   limit 1;

  if v_fonte is not null then
    perform net.http_post(
      url := v_url || 'qualificador-espelhar',
      headers := v_headers,
      body := jsonb_build_object('fonte', v_fonte),
      timeout_milliseconds := 180000);
    return 'espelhar ' || v_fonte;
  end if;

  -- 3. HubSpot: lote a lote. `qualificador-sync` já é retomável por natureza --
  --    ele pega quem tem `sync_em` mais velho que a janela, então repetir a
  --    chamada avança sozinho até não sobrar ninguém.
  select count(*) into v_falta
    from qualificador.pessoa p
    left join qualificador.crm_snapshot c on c.pessoa_id = p.id
   where c.sync_em is null or c.sync_em < now() - interval '20 hours';

  if v_falta > 0 then
    perform net.http_post(
      url := v_url || 'qualificador-sync',
      headers := v_headers,
      body := jsonb_build_object('fonte', 'hubspot', 'limite', 100, 'max_idade_horas', 20),
      timeout_milliseconds := 180000);
    return format('sync hubspot (faltam %s)', v_falta);
  end if;

  -- 4. Tudo espelhado e sincronizado: remede o que a tela lê. `garantir_pessoa_dados`
  --    reconstrói a foto do funil, que os triggers marcaram suja durante a noite --
  --    fazer isso agora poupa 2,2 s do primeiro recálculo da manhã.
  perform qualificador.garantir_pessoa_dados();
  perform qualificador.medir_cobertura();
  return 'nada pendente: foto e cobertura remedidas';
end $function$;

comment on function qualificador.cron_madrugada() is
  'Um passo da rotina noturna. Serial de proposito: registrar_execucao recusa '
  'espelhamentos concorrentes, e duas fontes juntas esgotam os workers do projeto.';

revoke execute on function qualificador.cron_madrugada() from public, anon, authenticated;
grant execute on function qualificador.cron_madrugada() to service_role;

-- O AGENDAMENTO em si vive em `cron.job`, fora do schema qualificador -- é a
-- unica excecao a essa regra no projeto, e existe porque pg_cron nao tem outro
-- lugar. Mesmo padrao dos 8 jobs do dash/gerador que ja convivem aqui.
--
--   select cron.schedule(
--     'qualificador-madrugada',
--     '*/2 4-6 * * *',                    -- 01:00 as 03:59 de Brasilia
--     $cron$select qualificador.cron_madrugada();$cron$);
--
-- Nao esta como comando executavel nesta migration de proposito: aplicar o repo
-- num projeto de teste nao deve criar um cron que chama a URL de producao.
