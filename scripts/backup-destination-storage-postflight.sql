-- Read-only catalog assertions after applying the old-project-only migration.
-- Also compare every preserved_* value from backup-destination-storage-fingerprint.sql.
DO $postflight$
DECLARE target_table text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc
      WHERE oid=to_regprocedure('lti_migration_control.guard_backup_storage_writes()')
        AND md5(prosrc)='c53e075de1071826c94050846bdbf40f'
        AND NOT prosecdef AND proconfig=ARRAY['search_path=pg_catalog']
        AND NOT has_function_privilege('anon',oid,'EXECUTE')
        AND NOT has_function_privilege('authenticated',oid,'EXECUTE')) THEN
    RAISE EXCEPTION 'Backup Storage guard differs from the tested definition or privileges';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc
      WHERE oid=to_regprocedure('lti_migration_control.reject_writes()')
        AND md5(prosrc)='3f91a9b05f6465b861e12fed142707db'
        AND NOT prosecdef AND proconfig=ARRAY['search_path=pg_catalog']) THEN
    RAISE EXCEPTION 'Original shared write freeze changed';
  END IF;
  FOREACH target_table IN ARRAY ARRAY['buckets','objects','s3_multipart_uploads','s3_multipart_uploads_parts']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
        WHERE tgrelid=('storage.'||target_table)::regclass
          AND tgname='lti_migration_write_freeze' AND tgtype=31 AND tgenabled='O'
          AND tgfoid='lti_migration_control.guard_backup_storage_writes()'::regprocedure)
      OR NOT EXISTS (SELECT 1 FROM pg_trigger
        WHERE tgrelid=('storage.'||target_table)::regclass
          AND tgname='lti_migration_truncate_freeze' AND tgtype=34 AND tgenabled='O'
          AND tgfoid='lti_migration_control.reject_writes()'::regprocedure) THEN
      RAISE EXCEPTION 'Expected row and truncate guards missing from storage.%', target_table;
    END IF;
  END LOOP;
END;
$postflight$;
SELECT 'Backup-only Storage guards match the tested definitions; compare preserved fingerprints separately.' AS result;
