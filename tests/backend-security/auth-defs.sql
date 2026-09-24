CREATE OR REPLACE FUNCTION public.lti_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select p.role from public.lti_profiles p where p.id=auth.uid() and p.active
 and not p.must_change_password
 and (p.session_valid_after='-infinity'::timestamptz or exists (
  select 1 from auth.sessions s where s.id::text=auth.jwt()->>'session_id' and s.user_id=p.id and s.created_at>=p.session_valid_after
 ))
 and ((p.role<>'admin' and not exists(select 1 from auth.mfa_factors f where f.user_id=p.id and f.status='verified')) or auth.jwt()->>'aal'='aal2')
$function$
;
CREATE OR REPLACE FUNCTION public.lti_school()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select school_id from public.lti_profiles where id=auth.uid() and public.lti_role() is not null
$function$
;
CREATE OR REPLACE FUNCTION public.lti_feature_enabled(tab_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case when public.lti_role()='admin' then true when public.lti_role() is null then false else
 coalesce((select s.feature_settings->>(public.lti_role()||':'||tab_name) from public.lti_schools s where s.id=public.lti_school()),'enabled')='enabled' end
$function$
;
CREATE OR REPLACE FUNCTION public.lti_record_feature_enabled(record_kind text, record_status text, writing boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
 if public.lti_role()='admin' then return true; end if;
 if public.lti_role() is null then return false; end if;
 case record_kind
 when 'papers' then return (not writing and record_status='公開中' and public.lti_feature_enabled('みんなの論文')) or (public.lti_role()='teacher' and public.lti_feature_enabled('探究論文の公開申請'));
 when 'paper_threads' then return public.lti_feature_enabled('探究論文の公開申請');
 when 'materials' then return public.lti_feature_enabled('教材');
 when 'contests' then return public.lti_feature_enabled('学会・コンテスト');
 when 'references' then return public.lti_feature_enabled('学術論文の検索');
 when 'assignments','submissions' then
   if public.lti_role()='student' then return public.lti_feature_enabled('課題・提出物'); end if;
   return public.lti_feature_enabled('課題配信') or (not writing and public.lti_feature_enabled('進捗管理'));
 when 'feedback' then
   if public.lti_role()='student' then return public.lti_feature_enabled('先生からのフィードバック'); end if;
   return public.lti_feature_enabled('AI添削');
 else return true;
 end case;
end $function$
;
CREATE OR REPLACE FUNCTION public.lti_read_record(k text, o uuid, s text, student text, d jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(public.lti_role() is not null and (
 public.lti_role()='admin' or
 (k in ('references','notes') and o=auth.uid()) or
 (k='papers' and (d->>'status'='公開中' or (public.lti_role()='teacher' and s=public.lti_school()))) or
 (k='paper_threads' and public.lti_role()='teacher' and s=public.lti_school()) or
 (k in ('assignments','materials') and s=public.lti_school()) or
 (k='submissions' and s=public.lti_school() and (student=auth.uid()::text or public.lti_role()='teacher')) or
 (k='feedback' and s=public.lti_school() and (student=auth.uid()::text or public.lti_role()='teacher')) or
 k='notices' or
 (k='contests' and (d->>'targetType'='all' or (d->'targetSchoolIds') ? public.lti_school()))
 ),false)
$function$
;
CREATE OR REPLACE FUNCTION public.lti_refund_ai_quota(usage_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_deleted integer;
begin
 if auth.uid() is null or usage_id is null then return false; end if;
 delete from public.lti_ai_usage where id=usage_id and user_id=auth.uid() and created_at>now()-interval '15 minutes';
 get diagnostics v_deleted=row_count;
 return v_deleted=1;
end $function$
;