-- Source Singapore ONLY, after Tokyo restore/functional checks pass.
-- Transactional DDL drains existing writers; bounded locks fail atomically.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
CREATE SCHEMA lti_migration_control;
REVOKE ALL ON SCHEMA lti_migration_control FROM PUBLIC, anon, authenticated;
CREATE FUNCTION lti_migration_control.reject_writes() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='55000',
    MESSAGE='LTI migration maintenance: reload the application after migration.';
END;
$$;
REVOKE ALL ON FUNCTION lti_migration_control.reject_writes() FROM PUBLIC, anon, authenticated;
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT n.nspname,c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p')
      AND (n.nspname,c.relname) NOT IN (('auth','schema_migrations'),('storage','migrations'),('storage','buckets_vectors'),('storage','vector_indexes'))
    ORDER BY n.nspname,c.relname
  LOOP
    EXECUTE format('CREATE TRIGGER lti_migration_write_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION lti_migration_control.reject_writes()',t.nspname,t.relname);
  END LOOP;
END; $$;
