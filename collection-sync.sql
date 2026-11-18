-- Run once in the same Supabase project after library-sync.sql.
begin;

alter table playmat_private.library
  add column if not exists collection_revision integer not null default 0,
  add column if not exists collection_payload jsonb;

create or replace function public.playmat_collection_read()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  select jsonb_build_object('revision',collection_revision,'collection',collection_payload)
    into result from playmat_private.library where owner_id = (select auth.uid());
  if not found then raise insufficient_privilege using message = 'Library owner required'; end if;
  return result;
end;
$$;

create or replace function public.playmat_collection_write(expected_revision integer, collection_data jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare next_revision integer;
begin
  if not exists (select 1 from playmat_private.library where owner_id = (select auth.uid())) then
    raise insufficient_privilege using message = 'Library owner required';
  end if;
  if expected_revision is null or expected_revision < 0
    or jsonb_typeof(collection_data) is distinct from 'object'
    or pg_column_size(collection_data) > 10000000
    or (collection_data ->> 'schemaVersion') is distinct from '1'
    or jsonb_typeof(collection_data -> 'cards') is distinct from 'array'
    or jsonb_typeof(collection_data -> 'binder') is distinct from 'array'
    or jsonb_typeof(collection_data -> 'preferences') is distinct from 'array'
    or (collection_data - array['schemaVersion','cards','binder','preferences']) <> '{}'::jsonb then
    raise invalid_parameter_value using message = 'Invalid collection snapshot';
  end if;
  update playmat_private.library
    set collection_revision = collection_revision + 1, collection_payload = collection_data
    where owner_id = (select auth.uid()) and collection_revision = expected_revision
    returning collection_revision into next_revision;
  return next_revision;
end;
$$;

revoke all on function public.playmat_collection_read() from public, anon, authenticated;
revoke all on function public.playmat_collection_write(integer,jsonb) from public, anon, authenticated;
grant execute on function public.playmat_collection_read() to authenticated;
grant execute on function public.playmat_collection_write(integer,jsonb) to authenticated;

commit;
