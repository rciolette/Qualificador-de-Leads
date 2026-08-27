-- Correcao: "Reconciliar exige papel operador ou gestao" abortava o espelhamento
-- no fim, depois de a fonte inteira ja ter sido baixada.
--
-- Causa: qualificador-espelhar fala com o banco pela SUPABASE_DB_URL, uma conexao
-- Postgres direta -- nao uma requisicao PostgREST com JWT. Dentro dela auth.uid()
-- e nulo, entao has_min_papel() sempre devolve falso. A funcao barrava justamente
-- quem tinha autorizacao: a Edge Function ja confere o papel do usuario logo na
-- entrada, antes de tocar em qualquer coisa.
--
-- A checagem continua valendo para chamada via PostgREST (onde auth.uid() existe),
-- para que um leitor nao consiga executar a RPC direto. Sem JWT no contexto, quem
-- chamou foi codigo de servidor que ja autenticou -- e ai a checagem sai do caminho.

create or replace function qualificador.reconciliar(p_fonte text)
returns table (casou_por text, pessoas bigint)
language plpgsql security definer set search_path = qualificador, public as $$
begin
  if auth.uid() is not null and not qualificador.has_min_papel('operador') then
    raise exception 'Reconciliar exige papel operador ou gestao';
  end if;
  case p_fonte
    when 'memberkit'   then return query select * from qualificador.reconciliar_memberkit();
    when 'memberclass' then return query select * from qualificador.reconciliar_memberclass();
    when 'sellflux'    then return query select * from qualificador.reconciliar_sellflux();
    else raise exception 'Fonte sem reconciliacao: %', p_fonte;
  end case;
end $$;

grant execute on function qualificador.reconciliar(text) to authenticated, service_role;
