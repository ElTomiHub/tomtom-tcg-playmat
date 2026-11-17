-- Run after library-sync.sql. This reuses the existing owner and session.
begin;
alter table playmat_private.library
  add column if not exists progress_revision integer not null default 0,
  add column if not exists progress jsonb;

create or replace function public.playmat_progress_read()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  select jsonb_build_object('revision',progress_revision,'progress',progress)
    into result from playmat_private.library where owner_id = (select auth.uid());
  if not found then raise insufficient_privilege using message = 'Library owner required'; end if;
  return result;
end;
$$;

create or replace function public.playmat_progress_write(expected_revision integer, progress_data jsonb)
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
    or jsonb_typeof(progress_data) is distinct from 'object'
    or pg_column_size(progress_data) > 20000000
    or (progress_data ->> 'schemaVersion') is distinct from '1'
    or jsonb_typeof(progress_data -> 'deckStats') is distinct from 'object'
    or jsonb_typeof(progress_data -> 'receipts') is distinct from 'array'
    or coalesce(jsonb_typeof(progress_data -> 'campaign'),'') not in ('object','null')
    or (progress_data - array['schemaVersion','deckStats','campaign','receipts']) <> '{}'::jsonb then
    raise invalid_parameter_value using message = 'Invalid progress snapshot';
  end if;
  update playmat_private.library
    set progress_revision = progress_revision + 1, progress = progress_data
    where owner_id = (select auth.uid()) and progress_revision = expected_revision
    returning progress_revision into next_revision;
  return next_revision;
end;
$$;

revoke all on function public.playmat_progress_read() from public, anon, authenticated;
revoke all on function public.playmat_progress_write(integer,jsonb) from public, anon, authenticated;
grant execute on function public.playmat_progress_read() to authenticated;
grant execute on function public.playmat_progress_write(integer,jsonb) to authenticated;

commit;
