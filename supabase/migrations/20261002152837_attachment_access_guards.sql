-- Protect every app document reference without rewriting existing data.
begin;
create or replace function public.lti_can_delete_document(object_name text)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.lti_role() is not null
 and split_part(object_name,'/',1)=auth.uid()::text
 and not exists (
   select 1 from public.lti_records r
   where r.data->>'storagePath'=object_name
      or r.data->>'attachmentPath'=object_name
      or r.data->>'brochurePath'=object_name
 ),false)
$$;
revoke all on function public.lti_can_delete_document(text) from public,anon;
grant execute on function public.lti_can_delete_document(text) to authenticated,service_role;
create or replace function public.lti_validate_document_refs()
returns trigger language plpgsql set search_path='' as $$
declare ref_key text; object_name text;
begin
 foreach ref_key in array array['storagePath','attachmentPath','brochurePath'] loop
  if new.data ? ref_key then
   if jsonb_typeof(new.data->ref_key) not in ('string','null') then
    raise exception '添付ファイルの保存先が不正です';
   end if;
   object_name:=coalesce(new.data->>ref_key,'');
   if object_name<>'' and (tg_op='INSERT' or new.data->>ref_key is distinct from old.data->>ref_key) then
    if auth.uid() is null or split_part(object_name,'/',1) is distinct from auth.uid()::text then
     raise exception '他人のファイルは添付できません';
    end if;
    if not exists(select 1 from storage.objects o where o.bucket_id='lti-documents' and o.name=object_name) then
     raise exception '添付ファイルが存在しません。アップロードを確認してください';
    end if;
   end if;
  end if;
 end loop;
 return new;
end $$;
revoke all on function public.lti_validate_document_refs() from public,anon,authenticated;
grant execute on function public.lti_validate_document_refs() to service_role;
create or replace trigger lti_validate_document_refs
 before insert or update on public.lti_records
 for each row execute function public.lti_validate_document_refs();
alter policy lti_pdf_read on storage.objects using (
 bucket_id='lti-documents' and public.lti_role() is not null and (
  (storage.foldername(name))[1]=auth.uid()::text
  or exists (
   select 1 from public.lti_records r
   where (r.kind in ('papers','submissions') and r.data->>'storagePath'=objects.name)
      or (r.kind='assignments' and r.data->>'attachmentPath'=objects.name)
      or (r.kind='contests' and r.data->>'brochurePath'=objects.name)
  )
 )
);
commit;
