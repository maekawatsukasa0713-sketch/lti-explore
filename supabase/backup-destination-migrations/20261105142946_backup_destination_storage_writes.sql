-- OLD SINGAPORE PROJECT ozmulwqzybhiekmolvyk ONLY.
-- Intentionally outside supabase/migrations: never db-push this to Tokyo.
-- Apply once, inside one transaction, before the new backup bucket is created.
-- Storage objects/buckets must still be created through the Storage/S3 API.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE storage.buckets, storage.objects,
  storage.s3_multipart_uploads, storage.s3_multipart_uploads_parts
  IN ACCESS EXCLUSIVE MODE;

DO $preflight$
DECLARE target_table text;
BEGIN
  IF to_regprocedure('lti_migration_control.reject_writes()') IS NULL THEN
    RAISE EXCEPTION 'Old-project write freeze is absent; refusing this target';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = 'lti_migration_control.reject_writes()'::regprocedure
      AND md5(prosrc) = '3f91a9b05f6465b861e12fed142707db'
      AND NOT prosecdef AND proconfig = ARRAY['search_path=pg_catalog']
  ) THEN
    RAISE EXCEPTION 'Existing migration freeze definition changed; inspect before applying';
  END IF;
  IF to_regprocedure('lti_migration_control.guard_backup_storage_writes()') IS NOT NULL THEN
    RAISE EXCEPTION 'Backup write guard already exists; inspect migration history';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='storage' AND table_name='buckets' AND (
        (column_name='type' AND udt_name='buckettype' AND is_nullable='NO'
          AND column_default=$default$'STANDARD'::storage.buckettype$default$)
        OR (column_name='versioning_status' AND udt_name='text' AND is_nullable='NO'
          AND column_default=$default$'DISABLED'::text$default$)
        OR (column_name='lifecycle_configuration' AND udt_name='jsonb'
          AND is_nullable='YES' AND column_default IS NULL)
        OR (column_name='public' AND udt_name='bool' AND column_default='false')
      )) <> 4 THEN
    RAISE EXCEPTION 'Storage private-bucket default definitions changed; inspect before applying';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets
             WHERE id = 'lti-production-backup' OR id LIKE 'lti-restore-check-%'
                OR name = 'lti-production-backup' OR name LIKE 'lti-restore-check-%') THEN
    RAISE EXCEPTION 'Backup/restore bucket namespace is already occupied; existing data must remain frozen';
  END IF;
  FOREACH target_table IN ARRAY ARRAY['buckets','objects','s3_multipart_uploads','s3_multipart_uploads_parts']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = ('storage.' || target_table)::regclass
        AND tgname = 'lti_migration_write_freeze' AND tgenabled = 'O'
        AND tgtype = 62 AND NOT tgisinternal
        AND tgfoid = 'lti_migration_control.reject_writes()'::regprocedure
    ) THEN
      RAISE EXCEPTION 'Expected complete statement freeze is absent on storage.%', target_table;
    END IF;
  END LOOP;
END;
$preflight$;

CREATE FUNCTION lti_migration_control.guard_backup_storage_writes()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $guard$
DECLARE
  old_row jsonb;
  new_row jsonb;
  old_bucket text;
  new_bucket text;
BEGIN
  IF TG_TABLE_SCHEMA <> 'storage' OR TG_TABLE_NAME NOT IN
       ('buckets','objects','s3_multipart_uploads','s3_multipart_uploads_parts')
       OR TG_LEVEL <> 'ROW' OR TG_OP NOT IN ('INSERT','UPDATE','DELETE') THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Old-project writes remain frozen outside the backup namespace.';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    old_row := to_jsonb(OLD);
    old_bucket := old_row->>CASE WHEN TG_TABLE_NAME='buckets' THEN 'id' ELSE 'bucket_id' END;
    IF NOT coalesce(old_bucket = 'lti-production-backup'
         OR old_bucket ~ '^lti-restore-check-[0-9]{1,20}-[0-9]{1,20}$', false) THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Existing old-project Storage data remains frozen.';
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_row := to_jsonb(NEW);
    new_bucket := new_row->>CASE WHEN TG_TABLE_NAME='buckets' THEN 'id' ELSE 'bucket_id' END;
    IF NOT coalesce(new_bucket = 'lti-production-backup'
         OR new_bucket ~ '^lti-restore-check-[0-9]{1,20}-[0-9]{1,20}$', false) THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Old-project writes are permitted only in the new backup namespace.';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND old_bucket IS DISTINCT FROM new_bucket THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Moving or renaming buckets across backup namespaces is forbidden.';
  END IF;
  IF TG_TABLE_NAME = 'buckets' THEN
    IF TG_OP <> 'INSERT' AND (
         old_row->>'name' IS DISTINCT FROM old_bucket
         OR old_row->'public' IS DISTINCT FROM 'false'::jsonb
         OR old_row->>'type' IS DISTINCT FROM 'STANDARD') THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Only private standard backup buckets may be modified.';
    END IF;
    IF TG_OP <> 'DELETE' AND (
         new_row->>'name' IS DISTINCT FROM new_bucket
         OR new_row->'public' IS DISTINCT FROM 'false'::jsonb
         OR new_row->>'type' IS DISTINCT FROM 'STANDARD'
         OR new_row->>'versioning_status' IS DISTINCT FROM 'DISABLED'
         OR new_row->>'lifecycle_configuration' IS NOT NULL) THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Backup buckets must remain private and standard, without lifecycle deletion.';
    END IF;
    IF TG_OP = 'DELETE' AND old_bucket = 'lti-production-backup' THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Deleting the backup bucket is forbidden.';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION lti_migration_control.guard_backup_storage_writes() FROM PUBLIC, anon, authenticated;

DO $triggers$
DECLARE target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['buckets','objects','s3_multipart_uploads','s3_multipart_uploads_parts']
  LOOP
    EXECUTE format('DROP TRIGGER lti_migration_write_freeze ON storage.%I', target_table);
    EXECUTE format('CREATE TRIGGER lti_migration_write_freeze BEFORE INSERT OR UPDATE OR DELETE ON storage.%I FOR EACH ROW EXECUTE FUNCTION lti_migration_control.guard_backup_storage_writes()', target_table);
    EXECUTE format('CREATE TRIGGER lti_migration_truncate_freeze BEFORE TRUNCATE ON storage.%I FOR EACH STATEMENT EXECUTE FUNCTION lti_migration_control.reject_writes()', target_table);
  END LOOP;
END;
$triggers$;
