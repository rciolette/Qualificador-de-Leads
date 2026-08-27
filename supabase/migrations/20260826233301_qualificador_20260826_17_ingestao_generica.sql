-- Qualificador de Leads ROI · migration 17
-- Ingestão de qualquer planilha a partir de um mapeamento de colunas.

-- --------------------------------------------------- normalizadores tolerantes
-- Planilha brasileira escreve 1.234,56; export americano escreve 1234.56.
-- Quem digita a coluna errada no mapeamento merece NULL, não um número errado.
create or replace function qualificador.norm_numero(v text)
returns numeric language plpgsql immutable
set search_path = pg_catalog as $fn$
declare t text;
begin
  t := btrim(coalesce(v, ''));
  if t = '' then return null; end if;
  t := regexp_replace(t, '[^0-9,.\-]', '', 'g');
  if t = '' then return null; end if;
  -- vírgula depois do último ponto => vírgula é o separador decimal
  if position(',' in t) > 0 and position(',' in t) > coalesce(nullif(length(t) - length(replace(t,'.','')), 0) * 0 + strpos(reverse(t), '.'), 0) then
    t := replace(replace(t, '.', ''), ',', '.');
  elsif position(',' in t) > 0 and position('.' in t) = 0 then
    t := replace(t, ',', '.');
  end if;
  begin return t::numeric; exception when others then return null; end;
end $fn$;

create or replace function qualificador.norm_data(v text, brt boolean default true)
returns timestamptz language plpgsql immutable
set search_path = pg_catalog as $fn$
declare t text; d timestamp;
begin
  t := btrim(coalesce(v, ''));
  if t = '' then return null; end if;
  -- dd/mm/aaaa (o formato que sai de planilha brasileira) vira aaaa-mm-dd
  if t ~ '^\d{2}/\d{2}/\d{4}' then
    t := substr(t,7,4) || '-' || substr(t,4,2) || '-' || substr(t,1,2) || substr(t,11);
  end if;
  begin
    d := t::timestamp;
  exception when others then
    return null;
  end;
  return case when brt then d at time zone 'America/Sao_Paulo' else d at time zone 'UTC' end;
end $fn$;

create or replace function qualificador.extrair(p_dados jsonb, p_mapa jsonb, p_campo text)
returns text language sql immutable
set search_path = pg_catalog as $fn$
  select case when p_mapa ? p_campo
              then nullif(btrim(coalesce(p_dados ->> (p_mapa ->> p_campo), '')), '') end
$fn$;

-- ------------------------------------------------------------------ ingestão
create or replace function qualificador.ingerir_generico(p_importacao_id uuid)
returns jsonb
language plpgsql
set search_path = qualificador, pg_catalog
as $fn$
declare
  v_mapa    jsonb;
  v_transf  jsonb;
  v_regras  jsonb;
  v_exige_projeto boolean;
  v_status_ok text[];
  v_de date; v_ate date;
  v_valor_centavos boolean;
  v_data_brt boolean;
  v_desconhecidos text[];
  v_linhas int := 0; v_pessoas int := 0; v_transacoes int := 0;
  v_sem_id int := 0; v_fora_regra int := 0;
begin
  select coalesce(f.mapeamento, '{}'::jsonb), coalesce(f.transformacoes, '{}'::jsonb),
         coalesce(i.regras, '{}'::jsonb)
    into v_mapa, v_transf, v_regras
  from qualificador.importacao i
  left join qualificador.fonte_importacao f on f.id = i.fonte_importacao_id
  where i.id = p_importacao_id;

  if v_mapa is null or v_mapa = '{}'::jsonb then
    raise exception 'Importacao % sem mapeamento de colunas', p_importacao_id
      using errcode = 'invalid_parameter_value';
  end if;
  if not (v_mapa ? 'email' or v_mapa ? 'telefone' or v_mapa ? 'documento') then
    raise exception 'O mapeamento precisa de pelo menos um identificador: email, telefone ou documento'
      using errcode = 'invalid_parameter_value';
  end if;

  v_exige_projeto  := coalesce((v_regras ->> 'exigir_projeto_no_catalogo')::boolean, false);
  v_status_ok      := case when v_regras ? 'status_aceitos'
                           then array(select jsonb_array_elements_text(v_regras -> 'status_aceitos')) end;
  v_de             := nullif(v_regras #>> '{periodo,de}', '')::date;
  v_ate            := nullif(v_regras #>> '{periodo,ate}', '')::date;
  v_valor_centavos := coalesce(v_transf ->> 'valor', '') = 'centavos_para_reais';
  v_data_brt       := coalesce(v_transf ->> 'criado_em', 'brt_para_utc') = 'brt_para_utc';

  create temp table _g on commit drop as
  select
    s.linha,
    qualificador.norm_email(qualificador.extrair(s.dados, v_mapa, 'email'))         as email,
    qualificador.norm_telefone(qualificador.extrair(s.dados, v_mapa, 'telefone'))   as telefone,
    qualificador.norm_documento(qualificador.extrair(s.dados, v_mapa, 'documento')) as documento,
    qualificador.extrair(s.dados, v_mapa, 'nome')             as nome,
    qualificador.extrair(s.dados, v_mapa, 'assiny_client_id') as client_id,
    qualificador.extrair(s.dados, v_mapa, 'transaction_id')   as transaction_id,
    qualificador.extrair(s.dados, v_mapa, 'produto')          as produto,
    qualificador.extrair(s.dados, v_mapa, 'oferta')           as oferta,
    qualificador.extrair(s.dados, v_mapa, 'funil')            as funil,
    qualificador.extrair(s.dados, v_mapa, 'utm_source')       as utm_source,
    qualificador.extrair(s.dados, v_mapa, 'status')           as status,
    qualificador.extrair(s.dados, v_mapa, 'projeto_nome')     as projeto_nome,
    qualificador.extrair(s.dados, v_mapa, 'projeto_id')       as projeto_id,
    case when v_valor_centavos
         then qualificador.norm_numero(qualificador.extrair(s.dados, v_mapa, 'valor')) / 100
         else qualificador.norm_numero(qualificador.extrair(s.dados, v_mapa, 'valor')) end as valor,
    case when v_valor_centavos
         then qualificador.norm_numero(qualificador.extrair(s.dados, v_mapa, 'valor_liquido')) / 100
         else qualificador.norm_numero(qualificador.extrair(s.dados, v_mapa, 'valor_liquido')) end as valor_liquido,
    qualificador.norm_data(qualificador.extrair(s.dados, v_mapa, 'criado_em'), v_data_brt) as criado_em,
    null::uuid as pessoa_id
  from qualificador.staging_generico s
  where s.importacao_id = p_importacao_id;

  select count(*) into v_linhas from _g;

  -- regras de tratamento da importação
  if v_status_ok is not null then
    delete from _g where status is null or not (status = any (v_status_ok));
  end if;
  if v_de  is not null then delete from _g where criado_em is not null and criado_em::date < v_de;  end if;
  if v_ate is not null then delete from _g where criado_em is not null and criado_em::date > v_ate; end if;
  select v_linhas - count(*) into v_fora_regra from _g;

  -- Projeto no catálogo só é exigido quando a importação diz que exige.
  -- Uma lista de webinar não tem projeto Assiny e não pode ser barrada por isso.
  if v_exige_projeto then
    select array_agg(distinct coalesce(g.projeto_nome, '(sem nome)')
                              || ' [' || coalesce(g.projeto_id, 'sem id') || ']')
      into v_desconhecidos
    from _g g
    where qualificador.resolver_projeto(g.projeto_id, g.projeto_nome) is null;
    if v_desconhecidos is not null then
      raise exception
        'Importacao bloqueada: % projeto(s) fora do catalogo -> %.',
        array_length(v_desconhecidos, 1), array_to_string(v_desconhecidos, ' | ')
        using errcode = 'check_violation';
    end if;
  end if;

  -- identidade: mesma ordem de sempre -- e-mail, documento, telefone (PRD 5.2)
  update _g g set pessoa_id = p.id from qualificador.pessoa p
   where g.email is not null and p.email = g.email;
  update _g g set pessoa_id = p.id from qualificador.pessoa p
   where g.pessoa_id is null and g.documento is not null and p.documento = g.documento;
  update _g g set pessoa_id = p.id from qualificador.pessoa p
   where g.pessoa_id is null and g.telefone is not null and p.telefone_e164 = g.telefone;

  create temp table _gnovos on commit drop as
  select gen_random_uuid() as id, x.*
  from (
    select distinct on (coalesce(email, documento, telefone))
      coalesce(email, documento, telefone) as chave, email, telefone, documento, nome, client_id
    from _g
    where pessoa_id is null and coalesce(email, documento, telefone) is not null
    order by coalesce(email, documento, telefone), linha
  ) x;

  insert into qualificador.pessoa (id, nome, email, telefone_e164, documento, assiny_client_id)
  select v.id, v.nome, v.email, v.telefone, v.documento, v.client_id from _gnovos v;
  get diagnostics v_pessoas = row_count;

  update _g g set pessoa_id = v.id from _gnovos v
   where g.pessoa_id is null and coalesce(g.email, g.documento, g.telefone) = v.chave;

  update qualificador.pessoa p set
    nome          = coalesce(p.nome, g.nome),
    telefone_e164 = coalesce(p.telefone_e164, g.telefone),
    documento     = coalesce(p.documento, g.documento)
  from (
    select distinct on (pessoa_id) pessoa_id, nome, telefone, documento
    from _g where pessoa_id is not null order by pessoa_id, linha desc
  ) g
  where p.id = g.pessoa_id;

  insert into qualificador.pessoa_identificador (pessoa_id, tipo, valor_norm, fonte)
  select distinct on (u.tipo, u.valor) u.pessoa_id, u.tipo, u.valor,
         'importacao_manual'::qualificador.fonte_dado
  from (
    select pessoa_id, 'email'::qualificador.tipo_identificador,     email     from _g where pessoa_id is not null and email     is not null
    union all
    select pessoa_id, 'documento'::qualificador.tipo_identificador, documento from _g where pessoa_id is not null and documento is not null
    union all
    select pessoa_id, 'telefone'::qualificador.tipo_identificador,  telefone  from _g where pessoa_id is not null and telefone  is not null
  ) u(pessoa_id, tipo, valor)
  order by u.tipo, u.valor, u.pessoa_id
  on conflict (tipo, valor_norm) do nothing;

  -- transação só quando o arquivo tem uma. Lista de contatos sem venda vira só pessoa.
  if v_mapa ? 'transaction_id' then
    insert into qualificador.transacao
      (transaction_id, pessoa_id, projeto_id, importacao_id,
       produto, oferta, funil, utm_source, valor, valor_liquido, status, criado_em, itens)
    select g.transaction_id, g.pessoa_id,
           qualificador.resolver_projeto(g.projeto_id, g.projeto_nome), p_importacao_id,
           g.produto, g.oferta, g.funil, g.utm_source, g.valor, g.valor_liquido,
           g.status, g.criado_em, 1
    from (select distinct on (transaction_id) * from _g
           where pessoa_id is not null and transaction_id is not null
           order by transaction_id, linha desc) g
    on conflict (transaction_id) do nothing;
    get diagnostics v_transacoes = row_count;
  end if;

  select count(*) into v_sem_id from _g where pessoa_id is null;

  update qualificador.importacao i set
    linhas_lidas     = v_linhas,
    linhas_novas     = v_pessoas + v_transacoes,
    linhas_ignoradas = v_sem_id + v_fora_regra,
    periodo_ini      = (select min(criado_em)::date from _g),
    periodo_fim      = (select max(criado_em)::date from _g),
    status           = 'ingerido'
  where i.id = p_importacao_id;

  return jsonb_build_object(
    'importacao_id',      p_importacao_id,
    'linhas_no_arquivo',  v_linhas,
    'fora_das_regras',    v_fora_regra,
    'pessoas_criadas',    v_pessoas,
    'transacoes_novas',   v_transacoes,
    'sem_identidade',     v_sem_id
  );
end
$fn$;

revoke execute on function qualificador.ingerir_generico(uuid) from public, anon, authenticated;
grant  execute on function qualificador.ingerir_generico(uuid) to service_role;
revoke execute on function qualificador.norm_numero(text), qualificador.norm_data(text, boolean),
                           qualificador.extrair(jsonb, jsonb, text) from public, anon;
grant  execute on function qualificador.norm_numero(text), qualificador.norm_data(text, boolean),
                           qualificador.extrair(jsonb, jsonb, text) to authenticated, service_role;
