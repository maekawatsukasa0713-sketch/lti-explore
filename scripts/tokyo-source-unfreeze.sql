-- Source Singapore ONLY. Use if final snapshot fails BEFORE cutover.
-- After Tokyo accepts production writes, reconcile data before rollback.
-- Replace only our own trigger function; managed-table ownership is unchanged.
CREATE OR REPLACE FUNCTION lti_migration_control.reject_writes() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RETURN NULL; -- statement triggers have no return-value effect
END;
$$;
