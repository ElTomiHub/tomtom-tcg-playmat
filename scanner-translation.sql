-- Enables inline Limitless English translations for the existing Playmat owner.
begin;
create extension if not exists http with schema extensions;

create or replace function public.playmat_scan_translation(set_code text, collector_number text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  page_status integer;
  page_content text;
begin
  if not exists (select 1 from playmat_private.library where owner_id = (select auth.uid())) then
    raise insufficient_privilege using message = 'Library owner required';
  end if;
  if set_code is null or set_code !~ '^[A-Za-z0-9]{1,16}([.-][A-Za-z0-9]{1,12})?$'
     or collector_number is null or collector_number !~ '^[A-Z0-9-]{1,16}$' then
    raise invalid_parameter_value using message = 'Invalid Japanese print reference';
  end if;
  select status, content into page_status, page_content from extensions.http_get(
    'https://limitlesstcg.com/cards/jp/' || set_code || '/' || collector_number || '?translate=en'
  );
  if page_status <> 200 then return null; end if;
  return left(substring(page_content from '(?is)<div class="card-text">(.*?)<div class="card-legality">'), 48000);
end;
$$;

revoke all on function public.playmat_scan_translation(text,text) from public, anon, authenticated;
grant execute on function public.playmat_scan_translation(text,text) to authenticated;
commit;
