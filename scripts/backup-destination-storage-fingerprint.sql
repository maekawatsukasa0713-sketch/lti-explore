-- Read-only: run before and after the old-project-only migration and compare.
-- Returns only aggregate fingerprints and intended guard metadata, no rows,
-- credentials, object names, or document bodies. All "preserved_*" fields match.
WITH preserved_triggers AS (
  SELECT n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE NOT t.tgisinternal AND n.nspname IN ('public','auth','storage')
    AND NOT (n.nspname='storage'
      AND c.relname IN ('buckets','objects','s3_multipart_uploads','s3_multipart_uploads_parts')
      AND t.tgname IN ('lti_migration_write_freeze','lti_migration_truncate_freeze'))
), preserved_policies AS (
  SELECT * FROM pg_policies WHERE schemaname IN ('public','auth','storage')
), preserved_table_access AS (
  SELECT n.nspname,c.relname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p')
), old_storage_objects AS (
  SELECT to_jsonb(o)::text AS metadata FROM storage.objects o WHERE bucket_id='lti-documents'
), old_storage_buckets AS (
  SELECT to_jsonb(b)::text AS metadata FROM storage.buckets b WHERE id='lti-documents'
)
SELECT jsonb_build_object(
  'preserved_triggers', (SELECT md5(string_agg(to_jsonb(t)::text,E'\n' ORDER BY nspname,relname,tgname)) FROM preserved_triggers t),
  'preserved_policies', (SELECT md5(string_agg(to_jsonb(p)::text,E'\n' ORDER BY schemaname,tablename,policyname)) FROM preserved_policies p),
  'preserved_table_access', (SELECT md5(string_agg(to_jsonb(a)::text,E'\n' ORDER BY nspname,relname)) FROM preserved_table_access a),
  'preserved_freeze_function', (SELECT md5(pg_get_functiondef(oid)||coalesce(proacl::text,'')) FROM pg_proc WHERE oid='lti_migration_control.reject_writes()'::regprocedure),
  'preserved_old_bucket_metadata', (SELECT md5(string_agg(metadata,E'\n' ORDER BY metadata)) FROM old_storage_buckets),
  'preserved_old_object_metadata', (SELECT md5(string_agg(metadata,E'\n' ORDER BY metadata)) FROM old_storage_objects),
  'preserved_old_object_count', (SELECT count(*) FROM old_storage_objects),
  'backup_bucket_exists', EXISTS(SELECT 1 FROM storage.buckets WHERE id='lti-production-backup'),
  'restore_namespace_exists', EXISTS(SELECT 1 FROM storage.buckets WHERE id LIKE 'lti-restore-check-%'),
  'backup_guard', (SELECT jsonb_build_object('source_md5',md5(prosrc),'security_definer',prosecdef,'configuration',proconfig,
      'anon_execute',has_function_privilege('anon',oid,'EXECUTE'),
      'authenticated_execute',has_function_privilege('authenticated',oid,'EXECUTE'))
    FROM pg_proc WHERE oid=to_regprocedure('lti_migration_control.guard_backup_storage_writes()')),
  'planned_storage_guards', (SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'enabled',t.tgenabled,
      'type',t.tgtype,'definition',pg_get_triggerdef(t.oid)) ORDER BY c.relname,t.tgname)
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='storage' AND c.relname IN ('buckets','objects','s3_multipart_uploads','s3_multipart_uploads_parts')
      AND t.tgname IN ('lti_migration_write_freeze','lti_migration_truncate_freeze'))
) AS fingerprint;
