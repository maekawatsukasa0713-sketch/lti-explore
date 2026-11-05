-- Authorization-only migration: no user, credential, profile, or record mutations.
begin;

create or replace function public.lti_read_record(k text, o uuid, s text, student text, d jsonb)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.lti_role() is not null and (
 public.lti_role()='admin' or
 (k in ('references','notes') and o=auth.uid()) or
 (k='papers' and (d->>'status'='公開中' or (public.lti_role()='teacher' and s=public.lti_school()))) or
 (k='paper_threads' and public.lti_role()='teacher' and s=public.lti_school()) or
 (k in ('assignments','materials') and s=public.lti_school()) or
 (k='submissions' and s=public.lti_school() and (student=auth.uid()::text or public.lti_role()='teacher')) or
 (k='feedback' and s=public.lti_school() and (student=auth.uid()::text or public.lti_role()='teacher')) or
 -- Notices created before targeting was added have no targetType and remain global.
 (k='notices' and (
   coalesce(d->>'targetType','all')='all' or
   (d->>'targetType'='specific' and jsonb_typeof(d->'targetSchoolIds')='array' and (d->'targetSchoolIds') ? public.lti_school())
 )) or
 (k='contests' and (d->>'targetType'='all' or (d->'targetSchoolIds') ? public.lti_school()))
 ),false)
$$;

-- Keep the existing three-argument function for callers that do not have a record.
-- Only the record policies use this data-aware overload; AI execution still has
-- its independent AI feature/quota checks.
create or replace function public.lti_record_feature_enabled(record_kind text, record_status text, writing boolean, record_data jsonb)
returns boolean language plpgsql stable security invoker set search_path='' as $$
begin
 if public.lti_role()='admin' then return true; end if;
 if public.lti_role() is null then return false; end if;
 if record_kind='feedback' and public.lti_role()='teacher' then
  -- Existing hand-written comments have assignmentId and an empty review result.
  -- A client-controlled source label alone must never enable the manual route.
  if record_data->>'source'='manual' or nullif(record_data->>'assignmentId','') is not null then
   if coalesce(record_data->>'source','manual')<>'manual'
      or nullif(record_data->>'assignmentId','') is null
      or record_data->'result' is distinct from '{"corrections":[],"advice":[],"nextExperiments":[]}'::jsonb
      or not public.lti_feature_enabled('進捗管理') then
    return false;
   end if;
   -- History remains readable after an assignment is withdrawn. Writes must be
   -- attached to a real same-school assignment and an actual same-school pupil.
   return not writing or (
    record_data->>'schoolId'=public.lti_school()
    and exists(select 1 from public.lti_records a where a.kind='assignments'
      and a.id=record_data->>'assignmentId' and a.school_id=public.lti_school())
    and exists(select 1 from public.lti_profiles p where p.id::text=record_data->>'studentId'
      and p.role='student' and p.school_id=public.lti_school())
   );
  end if;
  if coalesce(record_data->>'source','ai')<>'ai' then return false; end if;
 end if;
 return public.lti_record_feature_enabled(record_kind,record_status,writing);
end
$$;
revoke all on function public.lti_record_feature_enabled(text,text,boolean,jsonb) from public,anon;
grant execute on function public.lti_record_feature_enabled(text,text,boolean,jsonb) to authenticated;

alter policy feature_read on public.lti_records using (
 public.lti_record_feature_enabled(kind,status,false,data)
 and (kind <> 'papers' or status <> '公開中' or public.lti_feature_enabled('みんなの論文') or school_id=public.lti_school())
);
alter policy feature_insert on public.lti_records with check (public.lti_record_feature_enabled(kind,status,true,data));
alter policy feature_update on public.lti_records
 using (public.lti_record_feature_enabled(kind,status,true,data))
 with check (public.lti_record_feature_enabled(kind,status,true,data));
alter policy feature_delete on public.lti_records using (public.lti_record_feature_enabled(kind,status,true,data));

commit;
