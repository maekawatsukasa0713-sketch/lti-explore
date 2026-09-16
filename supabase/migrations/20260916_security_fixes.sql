-- School feature settings are saved by LTI admins from the account screen; RLS (school_admin) limits the write to admins.
grant update (feature_settings) on public.lti_schools to authenticated;

-- Paper review threads between LTI and the submitting school's teachers.
alter table public.lti_records drop constraint lti_records_kind_check;
alter table public.lti_records add constraint lti_records_kind_check check (kind = any (array['papers','paper_threads','assignments','submissions','materials','contests','notices','feedback','references','notes']));

create or replace function public.lti_read_record(k text, o uuid, s text, student text, d jsonb) returns boolean language sql stable security definer set search_path='' as $$
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
$$;

alter policy record_insert on public.lti_records with check ((owner_id = auth.uid()) AND (lti_role() IS NOT NULL) AND ((lti_role() = 'admin'::text) OR ((kind = ANY (ARRAY['references'::text, 'notes'::text])) AND (school_id = lti_school())) OR ((kind = ANY (ARRAY['papers'::text, 'paper_threads'::text, 'assignments'::text, 'feedback'::text])) AND (lti_role() = 'teacher'::text) AND (school_id = lti_school())) OR ((kind = 'submissions'::text) AND (lti_role() = 'student'::text) AND (school_id = lti_school()) AND (student_id = (auth.uid())::text))));

-- WITH CHECK matches USING so an update can never produce a row the caller could not have updated.
alter policy record_update on public.lti_records
 using ((lti_role() = 'admin'::text) OR ((kind = ANY (ARRAY['references'::text, 'notes'::text])) AND (owner_id = auth.uid()) AND (lti_role() IS NOT NULL)) OR ((kind = ANY (ARRAY['assignments'::text, 'papers'::text, 'paper_threads'::text, 'feedback'::text])) AND (lti_role() = 'teacher'::text) AND (school_id = lti_school())) OR ((kind = ANY (ARRAY['submissions'::text, 'feedback'::text])) AND (lti_role() = 'student'::text) AND (student_id = (auth.uid())::text) AND (school_id = lti_school())))
 with check ((lti_role() = 'admin'::text) OR ((kind = ANY (ARRAY['references'::text, 'notes'::text])) AND (owner_id = auth.uid()) AND (lti_role() IS NOT NULL)) OR ((kind = ANY (ARRAY['assignments'::text, 'papers'::text, 'paper_threads'::text, 'feedback'::text])) AND (lti_role() = 'teacher'::text) AND (school_id = lti_school())) OR ((kind = ANY (ARRAY['submissions'::text, 'feedback'::text])) AND (lti_role() = 'student'::text) AND (student_id = (auth.uid())::text) AND (school_id = lti_school())));

-- Teachers may remove a thread only together with withdrawing its paper (the paper row is deleted first in the same save).
alter policy record_delete on public.lti_records using ((lti_role() = 'admin'::text) OR ((kind = ANY (ARRAY['references'::text, 'notes'::text])) AND (owner_id = auth.uid()) AND (lti_role() IS NOT NULL)) OR ((kind = 'submissions'::text) AND (lti_role() = 'student'::text) AND (student_id = (auth.uid())::text) AND (school_id = lti_school())) OR ((kind = ANY (ARRAY['assignments'::text, 'feedback'::text, 'paper_threads'::text])) AND (lti_role() = 'teacher'::text) AND (school_id = lti_school())) OR ((kind = 'papers'::text) AND (lti_role() = 'teacher'::text) AND (school_id = lti_school()) AND (status <> '公開中'::text)));

create or replace function public.lti_validate_record() returns trigger language plpgsql set search_path='' as $$
declare p public.lti_profiles; a public.lti_records; paper public.lti_records; old_messages jsonb; new_messages jsonb; i integer;
begin
 if tg_op='UPDATE' then
  if new.id<>old.id or new.kind<>old.kind or new.owner_id<>old.owner_id or (new.data->>'schoolId') is distinct from (old.data->>'schoolId') or (new.data->>'studentId') is distinct from (old.data->>'studentId') then raise exception '所有者・学校・宛先は変更できません'; end if;
  new.version=old.version+1;
 end if;
 if new.data ? 'storagePath' and coalesce(new.data->>'storagePath','')<>'' then
  if tg_op='INSERT' or (new.data->>'storagePath') is distinct from (old.data->>'storagePath') then
   if split_part(new.data->>'storagePath','/',1) <> auth.uid()::text then raise exception '他人のファイルは添付できません'; end if;
  end if;
 end if;
 if new.kind='assignments' and new.data ? 'submissions' then raise exception '提出物は個別に保存してください'; end if;
 if new.kind='papers' then
  if new.data->>'status' is null or new.data->>'status' not in ('承認待ち','公開中','差し戻し','公開停止') then raise exception '不正な公開状態'; end if;
  if public.lti_role() is distinct from 'admin' then
   -- AI results are shown to every school as LTI's analysis, so only LTI may create or edit them.
   if tg_op='INSERT' and new.data ?| array['aiAnalysis','aiState','aiReviewedAt'] then raise exception 'AI解析結果は運営のみ保存できます'; end if;
   if tg_op='UPDATE' and (new.data->'aiAnalysis' is distinct from old.data->'aiAnalysis' or new.data->'aiState' is distinct from old.data->'aiState' or new.data->'aiReviewedAt' is distinct from old.data->'aiReviewedAt') then raise exception 'AI解析結果は運営のみ変更できます'; end if;
   if tg_op='UPDATE' and old.data->>'status'='公開中' then
    if (new.data-'withdrawalRequested') is distinct from (old.data-'withdrawalRequested') or new.data->>'withdrawalRequested' is distinct from 'true' then raise exception '公開中は差し止め申請のみ可能です'; end if;
   elsif new.data->>'status'<>'承認待ち' then raise exception '公開の承認は運営が行います'; end if;
  end if;
 end if;
 if new.kind='paper_threads' then
  select * into paper from public.lti_records where kind='papers' and id=new.id;
  if paper.id is null or paper.school_id is distinct from new.data->>'schoolId' then raise exception '論文と学校が一致しません'; end if;
  new_messages=new.data->'messages';
  if jsonb_typeof(new_messages) is distinct from 'array' then raise exception 'メッセージの形式が不正です'; end if;
  if public.lti_role() is distinct from 'admin' then
   if (new.data-'id'-'schoolId'-'messages')<>'{}'::jsonb then raise exception 'やり取りに保存できない項目があります'; end if;
   old_messages=case when tg_op='UPDATE' and jsonb_typeof(old.data->'messages')='array' then old.data->'messages' else '[]'::jsonb end;
   -- Teachers can only append their own messages; earlier messages (including LTI's) stay as sent.
   if jsonb_array_length(new_messages)<jsonb_array_length(old_messages) then raise exception '送信済みのメッセージは変更できません'; end if;
   for i in 0..jsonb_array_length(old_messages)-1 loop
    if new_messages->i is distinct from old_messages->i then raise exception '送信済みのメッセージは変更できません'; end if;
   end loop;
   for i in jsonb_array_length(old_messages)..jsonb_array_length(new_messages)-1 loop
    if new_messages->i->>'sender' is distinct from 'teacher' then raise exception '教員として送信してください'; end if;
   end loop;
  end if;
 end if;
 if new.kind='feedback' then
  select * into p from public.lti_profiles where id::text=new.data->>'studentId';
  if p.id is null or p.role<>'student' or p.school_id is distinct from new.data->>'schoolId' then raise exception '宛先の生徒と学校を確認してください'; end if;
  if tg_op='UPDATE' and public.lti_role()='student' and (new.data-'read') is distinct from (old.data-'read') then raise exception '生徒は既読状態のみ変更できます'; end if;
 end if;
 if new.kind='submissions' then
  select * into a from public.lti_records where kind='assignments' and id=new.data->>'assignmentId';
  if a.id is null or a.school_id is distinct from new.data->>'schoolId' or new.id <> (a.id || ':' || (new.data->>'studentId')) then raise exception '課題と学校が一致しません'; end if;
  if public.lti_role()='student' then
   new.data=jsonb_set(new.data,'{submittedAt}',to_jsonb(clock_timestamp()));
   if coalesce(a.data->>'deadline','') ~ '^\d{4}[-/]\d{2}[-/]\d{2}$' then
    new.data=jsonb_set(new.data,'{late}',to_jsonb(clock_timestamp()>((replace(a.data->>'deadline','/','-')||' 23:59:59+09')::timestamptz)));
   else new.data=jsonb_set(new.data,'{late}','false'::jsonb); end if;
  end if;
 end if;
 return new;
end $$;

create or replace function public.lti_guard_record_delete() returns trigger language plpgsql set search_path='' as $$
begin
 if old.kind='paper_threads' and public.lti_role() is distinct from 'admin' then
  perform 1 from public.lti_records where kind='papers' and id=old.id;
  if found then raise exception 'やり取りは論文の申請取消と同時にのみ削除できます'; end if;
 end if;
 return old;
end $$;
revoke all on function public.lti_guard_record_delete() from public, anon, authenticated;
create trigger lti_guard_record_delete before delete on public.lti_records for each row execute function public.lti_guard_record_delete();

-- Provider billing limit shared by all function instances: 20 calls per user per hour, 200 calls per day overall.
create table public.lti_ai_usage (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 mode text not null check (mode in ('register','review')),
 created_at timestamptz not null default now()
);
create index lti_ai_usage_user_time on public.lti_ai_usage (user_id, created_at);
create index lti_ai_usage_time on public.lti_ai_usage (created_at);
alter table public.lti_ai_usage enable row level security;
revoke all on public.lti_ai_usage from public, anon, authenticated;

create or replace function public.lti_consume_ai_quota(request_mode text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.lti_role() is null or request_mode not in ('register','review') then return false; end if;
 perform pg_advisory_xact_lock(hashtext('public.lti_ai_usage'));
 delete from public.lti_ai_usage where created_at < now()-interval '2 days';
 if (select count(*) from public.lti_ai_usage where user_id=auth.uid() and created_at > now()-interval '1 hour') >= 20 then return false; end if;
 if (select count(*) from public.lti_ai_usage where created_at > now()-interval '1 day') >= 200 then return false; end if;
 insert into public.lti_ai_usage(user_id, mode) values (auth.uid(), request_mode);
 return true;
end $$;
revoke all on function public.lti_consume_ai_quota(text) from public, anon;
grant execute on function public.lti_consume_ai_quota(text) to authenticated;
