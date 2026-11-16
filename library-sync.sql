-- Run once as the project database owner. Set the only allowed Auth user below.
begin;

create schema if not exists playmat_private;
revoke all on schema playmat_private from public, anon, authenticated;

create table if not exists playmat_private.library (
  singleton boolean primary key default true check (singleton),
  owner_id uuid not null references auth.users(id) on delete cascade,
  revision integer not null default 0 check (revision >= 0),
  payload jsonb,
  check ((revision = 0) = (payload is null))
);
alter table playmat_private.library enable row level security;
revoke all on table playmat_private.library from public, anon, authenticated;

create or replace function public.playmat_library_read()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  select jsonb_build_object('revision',revision,'library',payload)
    into result from playmat_private.library where owner_id = (select auth.uid());
  if not found then raise insufficient_privilege using message = 'Library owner required'; end if;
  return result;
end;
$$;

create or replace function public.playmat_library_write(expected_revision integer, library_data jsonb)
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
  if expected_revision is null or expected_revision < 0 or library_data is null
    or jsonb_typeof(library_data) is distinct from 'object'
    or pg_column_size(library_data) > 20000000
    or (library_data ->> 'schemaVersion') is distinct from '1'
    or jsonb_typeof(library_data -> 'decks') is distinct from 'array'
    or jsonb_typeof(library_data -> 'cards') is distinct from 'array'
    or jsonb_typeof(library_data -> 'deckOrder') is distinct from 'array'
    or jsonb_typeof(library_data -> 'deletedDeckIds') is distinct from 'array'
    or jsonb_typeof(library_data -> 'deletedCardIds') is distinct from 'array'
    or (library_data - array['schemaVersion','decks','cards','deckOrder','deletedDeckIds','deletedCardIds']) <> '{}'::jsonb then
    raise invalid_parameter_value using message = 'Invalid library snapshot';
  end if;
  update playmat_private.library
    set revision = revision + 1, payload = library_data
    where owner_id = (select auth.uid()) and revision = expected_revision
    returning revision into next_revision;
  return next_revision;
end;
$$;

revoke all on function public.playmat_library_read() from public, anon, authenticated;
revoke all on function public.playmat_library_write(integer,jsonb) from public, anon, authenticated;
grant execute on function public.playmat_library_read() to authenticated;
grant execute on function public.playmat_library_write(integer,jsonb) to authenticated;

commit;

-- After creating your single user in Supabase Authentication, run this separately
-- with their User UID. It will never replace an owner that already exists.
-- insert into playmat_private.library (owner_id) values ('YOUR_AUTH_USER_UUID') on conflict do nothing;
