-- Give LTI admins enough headroom for bulk paper registration while keeping teacher review limits conservative.
create or replace function public.lti_consume_ai_quota(request_mode text) returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text;
begin
 v_role := public.lti_role();
 if auth.uid() is null or v_role is null or request_mode not in ('register','review') then return false; end if;
 if request_mode='register' and v_role<>'admin' then return false; end if;

 perform pg_advisory_xact_lock(hashtext('public.lti_ai_usage'));
 delete from public.lti_ai_usage where created_at < now()-interval '2 days';

 if request_mode='register' then
  if (select count(*) from public.lti_ai_usage where user_id=auth.uid() and mode='register' and created_at > now()-interval '1 hour') >= 100 then return false; end if;
  if (select count(*) from public.lti_ai_usage where mode='register' and created_at > now()-interval '1 day') >= 1000 then return false; end if;
 else
  if (select count(*) from public.lti_ai_usage where user_id=auth.uid() and mode='review' and created_at > now()-interval '1 hour') >= 20 then return false; end if;
  if (select count(*) from public.lti_ai_usage where mode='review' and created_at > now()-interval '1 day') >= 200 then return false; end if;
 end if;

 insert into public.lti_ai_usage(user_id, mode) values (auth.uid(), request_mode);
 return true;
end $$;

revoke all on function public.lti_consume_ai_quota(text) from public, anon;
grant execute on function public.lti_consume_ai_quota(text) to authenticated;
