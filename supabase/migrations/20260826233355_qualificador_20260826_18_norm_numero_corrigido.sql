-- Qualificador de Leads ROI · migration 18
-- norm_numero: a primeira versão errava "1.234,56" (o formato mais comum numa
-- planilha brasileira) porque a condição era ilegível. Regra explícita agora:
-- quando há vírgula e ponto, o separador decimal é o que estiver MAIS À DIREITA.

create or replace function qualificador.norm_numero(v text)
returns numeric language plpgsql immutable
set search_path = pg_catalog as $fn$
declare
  t text;
  dist_virgula int;   -- distância a partir do fim; 0 = ausente, menor = mais à direita
  dist_ponto   int;
begin
  t := btrim(coalesce(v, ''));
  if t = '' then return null; end if;
  t := regexp_replace(t, '[^0-9,.\-]', '', 'g');   -- descarta R$, espaços, %, etc.
  if t !~ '\d' then return null; end if;

  dist_virgula := strpos(reverse(t), ',');
  dist_ponto   := strpos(reverse(t), '.');

  if dist_virgula > 0 and dist_ponto > 0 then
    if dist_virgula < dist_ponto then
      t := replace(replace(t, '.', ''), ',', '.');   -- 1.234,56 -> 1234.56
    else
      t := replace(t, ',', '');                      -- 1,234.56 -> 1234.56
    end if;
  elsif dist_virgula > 0 then
    t := replace(t, ',', '.');                       -- 1234,56 -> 1234.56
  elsif dist_ponto > 0 then
    -- Um ponto só é decimal (é o que a Assiny exporta). Mais de um ponto só
    -- faz sentido como separador de milhar: 12.345.678 -> 12345678.
    if length(t) - length(replace(t, '.', '')) > 1 then
      t := replace(t, '.', '');
    end if;
  end if;

  begin
    return t::numeric;
  exception when others then
    return null;
  end;
end $fn$;

comment on function qualificador.norm_numero(text) is
  'Número tolerante a formato. Com vírgula e ponto, o decimal é o mais à direita.
   Um ponto sozinho é decimal; dois ou mais são separador de milhar.
   Caso ambíguo conhecido: "12.345" é lido como 12.345, não como 12345.';
