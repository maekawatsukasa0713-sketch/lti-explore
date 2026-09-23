create or replace function public.lti_consume_ai_quota(request_mode text)
returns boolean language plpgsql security definer set search_path=''
as $function$
declare v_role text;
begin
 v_role:=public.lti_role();
 if auth.uid() is null or v_role is null or request_mode not in ('register','review') then return false; end if;
 if request_mode='register' and v_role<>'admin' then return false; end if;
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
end $function$;

create or replace function public.lti_claim_ai_quota(request_mode text)
returns bigint language plpgsql security definer set search_path=''
as $function$
declare v_role text; v_usage_id bigint;
begin
 v_role:=public.lti_role();
 if auth.uid() is null or v_role is null or request_mode not in ('register','review') then return null; end if;
 if request_mode='register' and v_role<>'admin' then return null; end if;
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
end $function$;

create or replace function public.lti_refund_ai_quota(usage_id bigint)
returns boolean language plpgsql security definer set search_path=''
as $function$
declare v_deleted integer;
begin
 if auth.uid() is null or usage_id is null then return false; end if;
 delete from public.lti_ai_usage where id=usage_id and user_id=auth.uid() and created_at>now()-interval '15 minutes';
 get diagnostics v_deleted=row_count;
 return v_deleted=1;
end $function$;

revoke all on function public.lti_claim_ai_quota(text) from public, anon;
revoke all on function public.lti_refund_ai_quota(bigint) from public, anon;
grant execute on function public.lti_claim_ai_quota(text) to authenticated;
grant execute on function public.lti_refund_ai_quota(bigint) to authenticated;
