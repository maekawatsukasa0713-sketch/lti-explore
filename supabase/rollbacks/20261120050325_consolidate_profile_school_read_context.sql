-- Preserve self-profile short-circuiting and restore the V5 profile list checks.
-- Exactly profile_read USING changes; both school policies are checked but unchanged.
-- School ALL USING/WITH CHECK, profile UPDATE policy, helpers, grants, triggers,
-- schema, application data and issued credentials stay intact.
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
  ('profile_read','r',true,'47d00db4952ec9d6df0e30598250e3cc',NULL),
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

DO $preflight$
DECLARE expected record; f record;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Unexpected DDL role'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('public.lti_schools')
   AND c.relrowsecurity AND NOT c.relforcerowsecurity
   AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres')
   AND c.relacl IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,anon=Dxtm/postgres,authenticated=rdDxtm/postgres,service_role=arwdDxtm/postgres}'::aclitem[]
   AND has_table_privilege('authenticated',c.oid,'SELECT')
   AND has_table_privilege('authenticated',c.oid,'DELETE')
   AND NOT has_table_privilege('authenticated',c.oid,'INSERT')
   AND NOT has_table_privilege('authenticated',c.oid,'UPDATE')
   AND NOT has_table_privilege('anon',c.oid,'SELECT')) THEN
  RAISE EXCEPTION 'School table RLS, owner, ACL or effective privileges drifted';
 END IF;
 IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.lti_schools'::regclass AND attnum>0 AND NOT attisdropped)<>6 THEN
  RAISE EXCEPTION 'School columns drifted';
 END IF;
 FOR expected IN SELECT * FROM (VALUES
  ('id','text',true,'{authenticated=a/postgres}'::aclitem[]),
  ('name','text',true,'{authenticated=aw/postgres}'::aclitem[]),
  ('next_student_number','integer',true,NULL::aclitem[]),
  ('next_teacher_number','integer',true,NULL::aclitem[]),
  ('deleted_at','timestamp with time zone',false,NULL::aclitem[]),
  ('feature_settings','jsonb',true,'{authenticated=w/postgres}'::aclitem[])
 ) AS e(column_name,type_name,not_null,column_acl)
 LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.lti_schools'::regclass
    AND a.attname=expected.column_name AND a.attnum>0 AND NOT a.attisdropped
    AND format_type(a.atttypid,a.atttypmod)=expected.type_name
    AND a.attnotnull=expected.not_null AND a.attacl IS NOT DISTINCT FROM expected.column_acl) THEN
   RAISE EXCEPTION 'School column % type, nullability or ACL drifted',expected.column_name;
  END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_policy WHERE polrelid='public.lti_schools'::regclass)<>2 THEN
  RAISE EXCEPTION 'Unexpected school policy count';
 END IF;
 FOR expected IN SELECT * FROM (VALUES
  ('school_admin','*','855e9ac2b038c6198236f7dae7cfbad1','353b8d4a0ee6632142a56fe7d3d9f407'),
  ('school_read','r','0e84248a113bade1ab4de8ec3585559f',NULL)
 ) AS e(policy_name,command,qual_md5,check_md5)
 LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid='public.lti_schools'::regclass
    AND p.polname=expected.policy_name AND p.polcmd::text=expected.command AND p.polpermissive
    AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]
    AND md5(pg_get_expr(p.polqual,p.polrelid)) IS NOT DISTINCT FROM expected.qual_md5
    AND md5(pg_get_expr(p.polwithcheck,p.polrelid)) IS NOT DISTINCT FROM expected.check_md5) THEN
   RAISE EXCEPTION 'School policy % drifted',expected.policy_name;
  END IF;
 END LOOP;
 FOR expected IN SELECT * FROM (VALUES
  ('public.lti_role()','93c57c12d86eb7e3b6377cbd4f3f5dbf'),
  ('public.lti_school()','9a442315d9888858bdf7e8223a91b113')
 ) AS e(signature,definition_md5)
 LOOP
  SELECT p.* INTO f FROM pg_proc p WHERE p.oid=to_regprocedure(expected.signature);
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM expected.definition_md5
    OR f.proowner<>(SELECT oid FROM pg_roles WHERE rolname='postgres')
    OR f.proacl IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[]
    OR f.provolatile<>'s' OR NOT f.prosecdef THEN
   RAISE EXCEPTION 'Request helper % definition, owner, ACL or STABLE property drifted',expected.signature;
  END IF;
 END LOOP;
END;
$preflight$;

DO $profile_columns$
BEGIN
 IF ARRAY(SELECT a.attname::text FROM pg_attribute a
   WHERE a.attrelid='public.lti_profiles'::regclass AND a.attnum>0 AND NOT a.attisdropped
   AND has_column_privilege('authenticated',a.attrelid,a.attname,'UPDATE') ORDER BY a.attname)
   IS DISTINCT FROM ARRAY['class','dept','name','theme']::text[] THEN
  RAISE EXCEPTION 'Profile editable column privileges drifted';
 END IF;
END;
$profile_columns$;

ALTER POLICY profile_read ON public.lti_profiles USING ((id = (SELECT auth.uid())) OR ((SELECT public.lti_role()) = 'admin') OR (((SELECT public.lti_role()) = 'teacher') AND (school_id = (SELECT public.lti_school()))) OR (((SELECT public.lti_role()) = 'student') AND (school_id = (SELECT public.lti_school())) AND (role = 'teacher') AND active));

DO $postflight$
DECLARE expected record;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('lti_profiles','profile_read','r','884447102dafcb3a5a16a0268453bd74',NULL),
  ('lti_profiles','profile_self_update','w','ea1f5df45681e1946eaa85c22966d773','ea1f5df45681e1946eaa85c22966d773'),
  ('lti_schools','school_read','r','0e84248a113bade1ab4de8ec3585559f',NULL),
  ('lti_schools','school_admin','*','855e9ac2b038c6198236f7dae7cfbad1','353b8d4a0ee6632142a56fe7d3d9f407')
 ) AS e(table_name,policy_name,command,qual_md5,check_md5)
 LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_policy p
    WHERE p.polrelid=to_regclass('public.'||expected.table_name)
    AND p.polname=expected.policy_name AND p.polcmd::text=expected.command AND p.polpermissive
    AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]
    AND md5(pg_get_expr(p.polqual,p.polrelid)) IS NOT DISTINCT FROM expected.qual_md5
    AND md5(pg_get_expr(p.polwithcheck,p.polrelid)) IS NOT DISTINCT FROM expected.check_md5) THEN
   RAISE EXCEPTION 'Profile/school policy postflight mismatch: %',expected.policy_name;
  END IF;
 END LOOP;
END;
$postflight$;

COMMIT;
