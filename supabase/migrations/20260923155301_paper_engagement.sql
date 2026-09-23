create table if not exists public.lti_paper_views (
  user_id uuid not null references auth.users(id) on delete cascade,
  paper_id text not null,
  viewed_on date not null default current_date,
  created_at timestamptz not null default now(),
  primary key (user_id, paper_id, viewed_on)
);
create index if not exists lti_paper_views_paper_id_idx on public.lti_paper_views(paper_id);

create table if not exists public.lti_paper_citations (
  user_id uuid not null references auth.users(id) on delete cascade,
  paper_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, paper_id)
);
create index if not exists lti_paper_citations_paper_id_idx on public.lti_paper_citations(paper_id);

create table if not exists public.lti_paper_bookmarks (
  user_id uuid not null references auth.users(id) on delete cascade,
  paper_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, paper_id)
);
create index if not exists lti_paper_bookmarks_paper_id_idx on public.lti_paper_bookmarks(paper_id);

alter table public.lti_paper_views enable row level security;
alter table public.lti_paper_citations enable row level security;
alter table public.lti_paper_bookmarks enable row level security;

revoke all on table public.lti_paper_views from public, anon, authenticated;
revoke all on table public.lti_paper_citations from public, anon, authenticated;
revoke all on table public.lti_paper_bookmarks from public, anon, authenticated;

create or replace function public.lti_paper_engagement_counts(paper_ids text[])
returns table(paper_id text, views bigint, citations bigint, bookmarks bigint)
language sql security definer stable set search_path=''
as $function$
  with requested as (
    select distinct unnest(paper_ids) as paper_id
    where auth.uid() is not null and coalesce(cardinality(paper_ids),0) between 1 and 500
  ),
  allowed as (
    select q.paper_id,
           case when coalesce(r.data->>'views','') ~ '^[0-9]+$' then (r.data->>'views')::bigint else 0 end as base_views
    from requested q
    join public.lti_records r on r.kind='papers' and r.id=q.paper_id
    where r.data->>'status'='公開中' or public.lti_role()='admin'
  ),
  v as (select paper_id,count(*)::bigint n from public.lti_paper_views group by paper_id),
  c as (select paper_id,count(*)::bigint n from public.lti_paper_citations group by paper_id),
  b as (select paper_id,count(*)::bigint n from public.lti_paper_bookmarks group by paper_id)
  select a.paper_id,a.base_views+coalesce(v.n,0),coalesce(c.n,0),coalesce(b.n,0)
  from allowed a left join v using(paper_id) left join c using(paper_id) left join b using(paper_id);
$function$;

create or replace function public.lti_my_paper_bookmarks(paper_ids text[])
returns table(paper_id text)
language sql security definer stable set search_path=''
as $function$
  select b.paper_id
  from public.lti_paper_bookmarks b
  join public.lti_records r on r.kind='papers' and r.id=b.paper_id
  where b.user_id=auth.uid()
    and b.paper_id=any(paper_ids)
    and coalesce(cardinality(paper_ids),0) between 1 and 500
    and (r.data->>'status'='公開中' or public.lti_role()='admin');
$function$;

create or replace function public.lti_toggle_paper_bookmark(target_paper_id text)
returns boolean
language plpgsql security definer set search_path=''
as $function$
declare deleted_count integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not exists (
    select 1 from public.lti_records r
    where r.kind='papers' and r.id=target_paper_id
      and (r.data->>'status'='公開中' or public.lti_role()='admin')
  ) then raise exception 'paper unavailable'; end if;
  delete from public.lti_paper_bookmarks where user_id=auth.uid() and paper_id=target_paper_id;
  get diagnostics deleted_count=row_count;
  if deleted_count=1 then return false; end if;
  insert into public.lti_paper_bookmarks(user_id,paper_id) values(auth.uid(),target_paper_id) on conflict do nothing;
  return true;
end
$function$;

create or replace function public.lti_record_paper_view(target_paper_id text)
returns bigint
language plpgsql security definer set search_path=''
as $function$
declare base_views bigint:=0; total_views bigint:=0;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select case when coalesce(r.data->>'views','') ~ '^[0-9]+$' then (r.data->>'views')::bigint else 0 end
    into base_views
  from public.lti_records r
  where r.kind='papers' and r.id=target_paper_id
    and (r.data->>'status'='公開中' or public.lti_role()='admin');
  if not found then raise exception 'paper unavailable'; end if;
  insert into public.lti_paper_views(user_id,paper_id) values(auth.uid(),target_paper_id) on conflict do nothing;
  select base_views+count(*)::bigint into total_views from public.lti_paper_views where paper_id=target_paper_id;
  return total_views;
end
$function$;

create or replace function public.lti_record_paper_citation(target_paper_id text)
returns bigint
language plpgsql security definer set search_path=''
as $function$
declare total_citations bigint;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not exists (
    select 1 from public.lti_records r
    where r.kind='papers' and r.id=target_paper_id
      and (r.data->>'status'='公開中' or public.lti_role()='admin')
  ) then raise exception 'paper unavailable'; end if;
  insert into public.lti_paper_citations(user_id,paper_id) values(auth.uid(),target_paper_id) on conflict do nothing;
  select count(*)::bigint into total_citations from public.lti_paper_citations where paper_id=target_paper_id;
  return total_citations;
end
$function$;

revoke all on function public.lti_paper_engagement_counts(text[]) from public, anon;
revoke all on function public.lti_my_paper_bookmarks(text[]) from public, anon;
revoke all on function public.lti_toggle_paper_bookmark(text) from public, anon;
revoke all on function public.lti_record_paper_view(text) from public, anon;
revoke all on function public.lti_record_paper_citation(text) from public, anon;
grant execute on function public.lti_paper_engagement_counts(text[]) to authenticated;
grant execute on function public.lti_my_paper_bookmarks(text[]) to authenticated;
grant execute on function public.lti_toggle_paper_bookmark(text) to authenticated;
grant execute on function public.lti_record_paper_view(text) to authenticated;
grant execute on function public.lti_record_paper_citation(text) to authenticated;
