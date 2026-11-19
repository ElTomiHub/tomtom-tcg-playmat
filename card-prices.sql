-- Run once in the Supabase SQL Editor. Uses the existing Playmat owner login.
-- No service key is exposed to the browser; requests can only reach Card Rush.
begin;
create extension if not exists http with schema extensions;
create table if not exists playmat_private.price_pages (
  reference text primary key,
  content text not null,
  checked_at timestamptz not null default now()
);
revoke all on playmat_private.price_pages from public, anon, authenticated;

create or replace function public.playmat_price_lookup(set_code text, collector_number text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  response_status integer;
  page_content text;
  reference_key text;
  saved_at timestamptz;
begin
  if not exists (select 1 from playmat_private.library where owner_id = (select auth.uid())) then
    raise insufficient_privilege using message = 'Library owner required';
  end if;
  if set_code is null or set_code !~ '^[A-Z0-9][A-Z0-9.-]{0,23}$'
    or collector_number is null or collector_number !~ '^[A-Z0-9-]{1,16}(/[A-Z0-9-]{1,16})?$' then
    raise invalid_parameter_value using message = 'Invalid print reference';
  end if;
  reference_key := set_code || ':' || collector_number;
  select content, checked_at into page_content, saved_at from playmat_private.price_pages
    where reference = reference_key and checked_at > now() - interval '24 hours';
  if found then return jsonb_build_object('status','success','html',page_content,'checkedAt',saved_at); end if;
  select status, content into response_status, page_content from extensions.http_get(
    'https://www.cardrush-pokemon.jp/product-list?keyword=' || set_code || '%20' || replace(collector_number,'/','%2F')
  );
  if response_status <> 200 or page_content ~* 'cf-chl-|Just a moment|Enable JavaScript and cookies' then
    return jsonb_build_object('status','blocked');
  end if;
  -- Retain complete result pages only. Oversized responses must not become partial quotes.
  if length(page_content) > 2000000 then return jsonb_build_object('status','unavailable'); end if;
  -- Cache only listing metadata, never the shop's navigation, scripts or images.
  select coalesce(string_agg(
    '<div class="item_data" data-product-id="' || substring(block from 'data-product-id="([0-9]+)"') ||
    '"><p><span class="goods_name">' || substring(block from '(?s)<span class="goods_name">(.*?)</p>') ||
    '</p><span class="figure">' || substring(block from 'class="figure">([0-9,]+)円') || '円</span></div>', ''),'')
    into page_content
    from regexp_split_to_table(page_content, '<div class="item_data"') with ordinality as parts(block,position)
    where position > 1;
  delete from playmat_private.price_pages where checked_at < now() - interval '7 days';
  insert into playmat_private.price_pages(reference,content,checked_at) values(reference_key,page_content,now())
    on conflict(reference) do update set content=excluded.content, checked_at=excluded.checked_at;
  return jsonb_build_object('status','success','html',page_content,'checkedAt',now());
exception when sqlstate '57014' then
  return jsonb_build_object('status','unavailable');
end;
$$;
revoke all on function public.playmat_price_lookup(text,text) from public, anon, authenticated;
grant execute on function public.playmat_price_lookup(text,text) to authenticated;
commit;
