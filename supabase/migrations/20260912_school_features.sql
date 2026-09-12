alter table public.lti_schools add column if not exists feature_settings jsonb not null default '{}'::jsonb;
alter table public.lti_schools add constraint lti_feature_settings_object check (jsonb_typeof(feature_settings)='object');
create or replace function public.lti_feature_enabled(tab_name text) returns boolean language sql stable security definer set search_path='' as $$
 select case when public.lti_role()='admin' then true when public.lti_role() is null then false else
 coalesce((select s.feature_settings->>(public.lti_role()||':'||tab_name) from public.lti_schools s where s.id=public.lti_school()),'enabled')='enabled' end
$$;
revoke all on function public.lti_feature_enabled(text) from public;
grant execute on function public.lti_feature_enabled(text) to authenticated;
create or replace function public.lti_record_feature_enabled(record_kind text, record_status text, writing boolean) returns boolean language plpgsql stable security definer set search_path='' as $$
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
end $$;
revoke all on function public.lti_record_feature_enabled(text,text,boolean) from public;
grant execute on function public.lti_record_feature_enabled(text,text,boolean) to authenticated;
create policy feature_read on public.lti_records as restrictive for select to authenticated using (public.lti_record_feature_enabled(kind,status,false));
create policy feature_insert on public.lti_records as restrictive for insert to authenticated with check (public.lti_record_feature_enabled(kind,status,true));
create policy feature_update on public.lti_records as restrictive for update to authenticated using (public.lti_record_feature_enabled(kind,status,true)) with check (public.lti_record_feature_enabled(kind,status,true));
create policy feature_delete on public.lti_records as restrictive for delete to authenticated using (public.lti_record_feature_enabled(kind,status,true));
