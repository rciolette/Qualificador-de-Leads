-- `cobertura_campos()` custa 6,7 s. O teto do PostgREST é 8 s, e ele já derrubou
-- `gerar_lista` uma vez (57014, que chega no front como um 500 opaco). Chamar
-- isso a cada abertura da tela seria repetir o erro com margem de 1,3 s.
--
-- A cobertura só muda quando o dado muda — depois de importar, sincronizar ou
-- reconciliar. Então ela é medida sob demanda e fica gravada; a tela lê a tabela
-- e responde na hora.

create table if not exists qualificador.cobertura_campo (
  campo_id  text primary key references qualificador.campo_filtravel(id) on delete cascade,
  com_dado  bigint not null,
  base      bigint not null,
  medido_em timestamptz not null default now()
);

comment on table qualificador.cobertura_campo is
  'Quantas pessoas têm cada campo preenchido, medido por qualificador.medir_cobertura(). '
  'Foto, não histórico: cada medição substitui a anterior.';

alter table qualificador.cobertura_campo enable row level security;

drop policy if exists cobertura_campo_leitor on qualificador.cobertura_campo;
create policy cobertura_campo_leitor on qualificador.cobertura_campo
  for select to authenticated
  using (qualificador.has_min_papel('leitor'::qualificador.papel));

-- só `medir_cobertura` escreve, e ela é definer
revoke all on qualificador.cobertura_campo from public, anon;
grant select on qualificador.cobertura_campo to authenticated;

create or replace function qualificador.medir_cobertura()
returns table (campo_id text, com_dado bigint, base bigint)
language plpgsql
volatile
security definer
set search_path to 'qualificador', 'pg_catalog'
as $function$
declare
  n bigint;
begin
  -- definer: a checagem de papel tem que ser explícita, a RLS não protege aqui
  if not qualificador.has_min_papel('operador'::qualificador.papel) then
    raise exception 'sem permissão para medir cobertura';
  end if;

  create temp table _cob on commit drop as
    select to_jsonb(v) j from qualificador.v_pessoa_completa v;
  select count(*) into n from _cob;

  -- foto, não histórico: a medição anterior é substituída inteira
  delete from qualificador.cobertura_campo;

  insert into qualificador.cobertura_campo (campo_id, com_dado, base)
  select c.id,
         count(*) filter (where
           case
             when c.fonte = 'hubspot_negocio'
               then jsonb_array_length(qualificador.valores_do_negocio(d.j, c.caminho)) > 0
             when c.fonte = 'hubspot_contato'
               then not qualificador.valor_ausente(d.j->'props'->c.caminho)
             else not qualificador.valor_ausente(d.j->c.caminho)
           end),
         n
    from qualificador.campo_filtravel c
    cross join _cob d
   group by c.id;

  return query
    select cc.campo_id, cc.com_dado, cc.base from qualificador.cobertura_campo cc;
end $function$;

comment on function qualificador.medir_cobertura() is
  'Remede a cobertura de todos os campos e grava em cobertura_campo. '
  'Custa ~7 s: chamar depois de importar/sincronizar/reconciliar, nunca por render de tela.';

revoke execute on function qualificador.medir_cobertura() from public, anon;
grant execute on function qualificador.medir_cobertura() to authenticated, service_role;

-- a de leitura pura some: quem quer o número lê a tabela
drop function if exists qualificador.cobertura_campos();
