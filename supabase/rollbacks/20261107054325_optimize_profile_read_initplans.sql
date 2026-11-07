-- NOT APPLIED. Restore only the original profile_read USING expression.
-- Requires exact wrapper policy plus the unchanged profile catalog/helper
-- boundaries. Leaves school/ALL/write/helper/grant/account/data unchanged.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $preflight$
DECLARE expected record; f record;
BEGIN
 IF current_user<>'postgres' THEN
  RAISE EXCEPTION 'Unexpected DDL role';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('public.lti_profiles')
   AND c.relrowsecurity AND NOT c.relforcerowsecurity
   AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres')
   AND c.relacl IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,anon=Dxtm/postgres,authenticated=rDxtm/postgres,service_role=arwdDxtm/postgres}'::aclitem[]
   AND has_table_privilege('authenticated',c.oid,'SELECT')
   AND NOT has_table_privilege('anon',c.oid,'SELECT')
   AND has_table_privilege('service_role',c.oid,'SELECT')) THEN
  RAISE EXCEPTION 'Profile table RLS, owner, ACL or effective SELECT drifted';
 END IF;
 IF (SELECT count(*) FROM pg_policy WHERE polrelid=to_regclass('public.lti_profiles'))<>2 THEN
  RAISE EXCEPTION 'Unexpected profile policy set';
 END IF;
 FOR expected IN SELECT * FROM (VALUES
  ('profile_read','r',true,'884447102dafcb3a5a16a0268453bd74',NULL),
  ('profile_self_update','w',true,'ea1f5df45681e1946eaa85c22966d773','ea1f5df45681e1946eaa85c22966d773')
 ) AS e(policy_name,command,permissive,qual_md5,check_md5)
 LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=to_regclass('public.lti_profiles')
    AND p.polname=expected.policy_name AND p.polcmd::text=expected.command
    AND p.polpermissive=expected.permissive
    AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]
    AND md5(pg_get_expr(p.polqual,p.polrelid)) IS NOT DISTINCT FROM expected.qual_md5
    AND md5(pg_get_expr(p.polwithcheck,p.polrelid)) IS NOT DISTINCT FROM expected.check_md5) THEN
   RAISE EXCEPTION 'Profile policy % drifted',expected.policy_name;
  END IF;
 END LOOP;
 FOR expected IN SELECT * FROM (VALUES
  ('public.lti_role()','93c57c12d86eb7e3b6377cbd4f3f5dbf'),
  ('public.lti_school()','9a442315d9888858bdf7e8223a91b113')
 ) AS e(identity_signature,definition_md5)
 LOOP
  SELECT p.* INTO f FROM pg_proc p WHERE p.oid=to_regprocedure(expected.identity_signature);
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM expected.definition_md5
    OR f.proowner<>(SELECT oid FROM pg_roles WHERE rolname='postgres')
    OR f.proacl IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[] THEN
   RAISE EXCEPTION 'Request helper % definition, owner or ACL drifted',expected.identity_signature;
  END IF;
 END LOOP;
 -- Auth builtins differ from the offline claims fixture. Require only the
 -- zero-argument signatures, expected types and STABLE semantics here. Root
 -- compares their actual definitions/owners/ACLs before and after production.
 FOR expected IN SELECT * FROM (VALUES
  ('auth.uid()','pg_catalog.uuid'),('auth.jwt()','pg_catalog.jsonb')
 ) AS e(identity_signature,result_type)
 LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(expected.identity_signature)
    AND p.prokind='f' AND p.pronargs=0
    AND p.prorettype=to_regtype(expected.result_type) AND p.provolatile='s'
    AND has_function_privilege('authenticated',p.oid,'EXECUTE')) THEN
   RAISE EXCEPTION 'Auth request builtin % signature/type/STABLE property drifted',expected.identity_signature;
  END IF;
 END LOOP;
END;
$preflight$;

ALTER POLICY profile_read ON public.lti_profiles USING (
 ((id = auth.uid()) OR (lti_role() = 'admin'::text) OR ((lti_role() = 'teacher'::text) AND (school_id = lti_school())) OR ((lti_role() = 'student'::text) AND (school_id = lti_school()) AND (role = 'teacher'::text) AND active))
);

DO $postflight$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid='public.lti_profiles'::regclass
   AND p.polname='profile_read' AND p.polcmd='r' AND p.polpermissive
   AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]
   AND p.polwithcheck IS NULL
   AND md5(pg_get_expr(p.polqual,p.polrelid))='d56499cfd778d79fd9508202f04a5ad6') THEN
  RAISE EXCEPTION 'Profile SELECT policy postflight mismatch';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid='public.lti_profiles'::regclass
   AND p.polname='profile_self_update' AND p.polcmd='w' AND p.polpermissive
   AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]
   AND md5(pg_get_expr(p.polqual,p.polrelid))='ea1f5df45681e1946eaa85c22966d773'
   AND md5(pg_get_expr(p.polwithcheck,p.polrelid))='ea1f5df45681e1946eaa85c22966d773') THEN
  RAISE EXCEPTION 'Profile write policy changed';
 END IF;
END;
$postflight$;
COMMIT;
