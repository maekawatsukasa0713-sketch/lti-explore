-- Source Singapore ONLY. Use if final snapshot fails BEFORE cutover.
-- After Tokyo accepts production writes, reconcile data before rollback.
SET LOCAL lock_timeout = '10s';
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT n.nspname,c.relname FROM pg_trigger tr
    JOIN pg_class c ON c.oid=tr.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=tr.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
    WHERE tr.tgname='lti_migration_write_freeze' AND pn.nspname='lti_migration_control'
      AND p.proname='reject_writes' AND n.nspname IN ('public','auth','storage')
  LOOP
    EXECUTE format('DROP TRIGGER lti_migration_write_freeze ON %I.%I',t.nspname,t.relname);
  END LOOP;
END; $$;
DROP FUNCTION lti_migration_control.reject_writes();
DROP SCHEMA lti_migration_control;
