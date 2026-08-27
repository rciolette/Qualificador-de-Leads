-- Trava: um espelhamento por vez no projeto inteiro.
--
-- O HubSpot morreu tres vezes com HTTP 546 (WORKER_LIMIT) sem nunca ter culpa.
-- Causa: cada espelhamento segura um worker por ate 60 s seguidos, e duas fontes
-- espelhando ao mesmo tempo nao deixam slot para mais nada no projeto -- inclusive
-- para o qualificador-sync, que e outra funcao e outro assunto.
--
-- A trava vive aqui, e nao no front, porque a regra e do servidor: qualquer
-- cliente que chame a Edge Function esbarra nela. E fica em registrar_execucao
-- porque e o unico ponto por onde TODO espelhamento novo passa -- a retomada de
-- pagina reaproveita a execucao existente e nao chega aqui.
--
-- Janela de 10 minutos: execucao mais velha que isso e worker morto, nao trabalho
-- em andamento, e nao pode travar o projeto para sempre.

create or replace function qualificador.registrar_execucao(
  p_slug text, p_operacao text, p_status text,
  p_registros integer default null, p_duracao_ms integer default null,
  p_erro text default null
) returns bigint
language plpgsql security definer set search_path = qualificador, public as $$
declare
  v_id bigint;
  v_ocupada text;
begin
  if p_operacao = 'espelhar' and p_status = 'em_andamento' then
    select i.slug into v_ocupada
      from qualificador.integracao_execucao e
      join qualificador.integracao i on i.id = e.integracao_id
     where e.operacao = 'espelhar'
       and e.status = 'em_andamento'
       and e.executado_em > now() - interval '10 minutes'
     limit 1;

    if v_ocupada is not null then
      raise exception
        'Ja existe um espelhamento em andamento (%). Espere terminar: duas fontes ao mesmo tempo esgotam os workers do projeto e derrubam ate o sync do HubSpot.',
        v_ocupada;
    end if;
  end if;

  insert into qualificador.integracao_execucao
    (integracao_id, operacao, status, registros, duracao_ms, erro)
  select i.id, p_operacao, p_status, p_registros, p_duracao_ms, left(p_erro, 2000)
  from qualificador.integracao i where i.slug = p_slug
  returning id into v_id;

  return v_id;
end $$;
