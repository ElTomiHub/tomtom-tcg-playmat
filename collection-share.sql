-- Run once in the Playmat Supabase SQL Editor. Sharing stays off until the owner requests a link.
begin;
alter table playmat_private.library add column if not exists collection_share_key uuid;

create or replace function public.playmat_collection_share_link()
returns uuid language plpgsql security definer set search_path = '' as $$
declare link_key uuid;
begin
  update playmat_private.library
  set collection_share_key = coalesce(collection_share_key, gen_random_uuid())
  where owner_id = (select auth.uid()) and collection_payload is not null
  returning collection_share_key into link_key;
  if link_key is null then raise exception 'Sync the collection before sharing'; end if;
  return link_key;
end;
$$;

create or replace function public.playmat_collection_view(link_key uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'cards', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', c->'id', 'pokemonKey', c->'pokemonKey', 'pokemonId', c->'pokemonId',
      'name', c->'name', 'set', c->'set', 'number', c->'number', 'variant', c->'variant',
      'image', c->'image', 'featured', c->'featured') order by n), '[]')
      from jsonb_array_elements(collection_payload->'cards') with ordinality as cards(c,n)),
    'binder', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', c->'id', 'name', c->'name', 'set', c->'set', 'number', c->'number',
      'variant', c->'variant', 'image', c->'image', 'tags', c->'tags',
      'pokemonId', c->'pokemonId') order by n), '[]')
      from jsonb_array_elements(collection_payload->'binder') with ordinality as binder(c,n)),
    'preferences', (select coalesce(jsonb_agg(case when p->>'id' = 'binder:special-order'
      then jsonb_build_object('id',p->'id','order',p->'order')
      else jsonb_build_object('id',p->'id','cardId',p->'cardId') end), '[]')
      from jsonb_array_elements(collection_payload->'preferences') p
      where p->>'id' like 'featured:%' or p->>'id' = 'binder:special-order'))
  from playmat_private.library where collection_share_key = link_key;
$$;
revoke all on function public.playmat_collection_share_link() from public, anon, authenticated;
grant execute on function public.playmat_collection_share_link() to authenticated;
revoke all on function public.playmat_collection_view(uuid) from public, anon, authenticated;
grant execute on function public.playmat_collection_view(uuid) to anon, authenticated;
commit;
