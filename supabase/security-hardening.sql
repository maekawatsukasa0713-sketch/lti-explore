-- Applied 2026-09-24. Deploy research-ai using the internal refund before revoking the legacy refund.
begin;
create or replace function public.lti_refund_ai_quota_internal(usage_id bigint, actor uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if actor is null or usage_id is null then return false; end if;
 delete from public.lti_ai_usage where id=usage_id and user_id=actor and created_at>now()-interval '15 minutes';
 get diagnostics n=row_count; return n=1;
end $$;
revoke all on function public.lti_refund_ai_quota_internal(bigint,uuid) from public,anon,authenticated;
grant execute on function public.lti_refund_ai_quota_internal(bigint,uuid) to service_role;
create or replace function public.lti_can_access_paper(target_paper_id text)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.lti_role() is not null and exists (
 select 1 from public.lti_records r where r.kind='papers' and r.id=target_paper_id
 and (r.status='公開中' or public.lti_role()='admin')
 and public.lti_read_record(r.kind,r.owner_id,r.school_id,r.student_id,r.data)
 and public.lti_record_feature_enabled(r.kind,r.status,false)
 and (r.status<>'公開中' or public.lti_feature_enabled('みんなの論文') or r.school_id=public.lti_school())
 ),false)
$$;
revoke all on function public.lti_can_access_paper(text) from public,anon;
grant execute on function public.lti_can_access_paper(text) to authenticated,service_role;
CREATE OR REPLACE FUNCTION public.lti_my_paper_bookmarks(paper_ids text[])
 RETURNS TABLE(paper_id text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select b.paper_id
  from public.lti_paper_bookmarks b
  join public.lti_records r on r.kind='papers' and r.id=b.paper_id
  where b.user_id=auth.uid()
    and b.paper_id=any(paper_ids)
    and coalesce(cardinality(paper_ids),0) between 1 and 500
    and (public.lti_can_access_paper(r.id));
$function$
;
CREATE OR REPLACE FUNCTION public.lti_paper_engagement_counts(paper_ids text[])
 RETURNS TABLE(paper_id text, views bigint, citations bigint, bookmarks bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with requested as (
    select distinct unnest(paper_ids) as paper_id
    where auth.uid() is not null and coalesce(cardinality(paper_ids),0) between 1 and 500
  ),
  allowed as (
    select q.paper_id,
           case when coalesce(r.data->>'views','') ~ '^[0-9]+$' then (r.data->>'views')::bigint else 0 end as base_views
    from requested q
    join public.lti_records r on r.kind='papers' and r.id=q.paper_id
    where public.lti_can_access_paper(r.id)
  ),
  v as (select paper_id,count(*)::bigint n from public.lti_paper_views group by paper_id),
  c as (select paper_id,count(*)::bigint n from public.lti_paper_citations group by paper_id),
  b as (select paper_id,count(*)::bigint n from public.lti_paper_bookmarks group by paper_id)
  select a.paper_id,a.base_views+coalesce(v.n,0),coalesce(c.n,0),coalesce(b.n,0)
  from allowed a left join v using(paper_id) left join c using(paper_id) left join b using(paper_id);
$function$
;
CREATE OR REPLACE FUNCTION public.lti_record_paper_citation(target_paper_id text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare total_citations bigint;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not exists (
    select 1 from public.lti_records r
    where r.kind='papers' and r.id=target_paper_id
      and (public.lti_can_access_paper(r.id))
  ) then raise exception 'paper unavailable'; end if;
  insert into public.lti_paper_citations(user_id,paper_id) values(auth.uid(),target_paper_id) on conflict do nothing;
  select count(*)::bigint into total_citations from public.lti_paper_citations where paper_id=target_paper_id;
  return total_citations;
end
$function$
;
CREATE OR REPLACE FUNCTION public.lti_record_paper_view(target_paper_id text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare base_views bigint:=0; total_views bigint:=0;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select case when coalesce(r.data->>'views','') ~ '^[0-9]+$' then (r.data->>'views')::bigint else 0 end
    into base_views
  from public.lti_records r
  where r.kind='papers' and r.id=target_paper_id
    and (public.lti_can_access_paper(r.id));
  if not found then raise exception 'paper unavailable'; end if;
  insert into public.lti_paper_views(user_id,paper_id) values(auth.uid(),target_paper_id) on conflict do nothing;
  select base_views+count(*)::bigint into total_views from public.lti_paper_views where paper_id=target_paper_id;
  return total_views;
end
$function$
;
CREATE OR REPLACE FUNCTION public.lti_toggle_paper_bookmark(target_paper_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare deleted_count integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not exists (
    select 1 from public.lti_records r
    where r.kind='papers' and r.id=target_paper_id
      and (public.lti_can_access_paper(r.id))
  ) then raise exception 'paper unavailable'; end if;
  delete from public.lti_paper_bookmarks where user_id=auth.uid() and paper_id=target_paper_id;
  get diagnostics deleted_count=row_count;
  if deleted_count=1 then return false; end if;
  insert into public.lti_paper_bookmarks(user_id,paper_id) values(auth.uid(),target_paper_id) on conflict do nothing;
  return true;
end
$function$
;
create or replace function public.lti_can_delete_document(object_name text)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.lti_role() is not null
 and split_part(object_name,'/',1)=auth.uid()::text
 and not exists(select 1 from public.lti_records r where r.data->>'storagePath'=object_name),false)
$$;
revoke all on function public.lti_can_delete_document(text) from public,anon;
grant execute on function public.lti_can_delete_document(text) to authenticated,service_role;
alter policy lti_pdf_delete on storage.objects using (bucket_id='lti-documents' and public.lti_can_delete_document(name));
commit;
begin;
CREATE OR REPLACE FUNCTION public.lti_claim_ai_quota(request_mode text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role text; v_usage_id bigint;
begin
 v_role:=public.lti_role();
 if auth.uid() is null or v_role is null or request_mode not in ('register','review') then return null; end if;
 if request_mode='register' and v_role<>'admin' then return null; end if;
 if request_mode='review' and (v_role not in ('teacher','admin') or not public.lti_feature_enabled('AI添削')) then return null; end if;
 perform pg_advisory_xact_lock(hashtext('public.lti_ai_usage'));
 delete from public.lti_ai_usage where created_at < now()-interval '2 days';
 if request_mode='register' then
  if (select count(*) from public.lti_ai_usage where user_id=auth.uid() and mode='register' and created_at>now()-interval '1 hour')>=300 then return null; end if;
  if (select count(*) from public.lti_ai_usage where mode='register' and created_at>now()-interval '1 day')>=3000 then return null; end if;
 else
  if (select count(*) from public.lti_ai_usage where user_id=auth.uid() and mode='review' and created_at>now()-interval '1 hour')>=20 then return null; end if;
  if (select count(*) from public.lti_ai_usage where mode='review' and created_at>now()-interval '1 day')>=200 then return null; end if;
 end if;
 insert into public.lti_ai_usage(user_id,mode) values(auth.uid(),request_mode) returning id into v_usage_id;
 return v_usage_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.lti_consume_ai_quota(request_mode text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role text;
begin
 v_role:=public.lti_role();
 if auth.uid() is null or v_role is null or request_mode not in ('register','review') then return false; end if;
 if request_mode='register' and v_role<>'admin' then return false; end if;
 if request_mode='review' and (v_role not in ('teacher','admin') or not public.lti_feature_enabled('AI添削')) then return false; end if;
 perform pg_advisory_xact_lock(hashtext('public.lti_ai_usage'));
 delete from public.lti_ai_usage where created_at < now()-interval '2 days';
 if request_mode='register' then
  if (select count(*) from public.lti_ai_usage where user_id=auth.uid() and mode='register' and created_at>now()-interval '1 hour')>=300 then return false; end if;
  if (select count(*) from public.lti_ai_usage where mode='register' and created_at>now()-interval '1 day')>=3000 then return false; end if;
 else
  if (select count(*) from public.lti_ai_usage where user_id=auth.uid() and mode='review' and created_at>now()-interval '1 hour')>=20 then return false; end if;
  if (select count(*) from public.lti_ai_usage where mode='review' and created_at>now()-interval '1 day')>=200 then return false; end if;
 end if;
 insert into public.lti_ai_usage(user_id,mode) values(auth.uid(),request_mode);
 return true;
end $function$
;
commit;
revoke execute on function public.lti_refund_ai_quota(bigint) from public,anon,authenticated;
