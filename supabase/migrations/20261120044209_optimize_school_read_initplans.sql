-- Cache request-only helpers in school SELECT/ALL USING expressions.
-- Exactly two USING clauses change. The ALL WITH CHECK, role set, grants,
-- functions, triggers, schema, application data and issued credentials stay intact.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
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
  ('school_admin','*','353b8d4a0ee6632142a56fe7d3d9f407','353b8d4a0ee6632142a56fe7d3d9f407'),
  ('school_read','r','c6378cddfba8f438eb1578442fc74892',NULL)
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

ALTER POLICY school_admin ON public.lti_schools USING ((SELECT public.lti_role())='admin');
ALTER POLICY school_read ON public.lti_schools USING (((SELECT public.lti_role())='admin') OR (id=(SELECT public.lti_school())));

DO $postflight$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid='public.lti_schools'::regclass
   AND p.polname='school_admin' AND p.polcmd='*' AND p.polpermissive
   AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]
   AND md5(pg_get_expr(p.polqual,p.polrelid))='855e9ac2b038c6198236f7dae7cfbad1'
   AND md5(pg_get_expr(p.polwithcheck,p.polrelid))='353b8d4a0ee6632142a56fe7d3d9f407') THEN
  RAISE EXCEPTION 'School ALL policy postflight mismatch';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid='public.lti_schools'::regclass
   AND p.polname='school_read' AND p.polcmd='r' AND p.polpermissive
   AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]
   AND p.polwithcheck IS NULL
   AND md5(pg_get_expr(p.polqual,p.polrelid))='0e84248a113bade1ab4de8ec3585559f') THEN
  RAISE EXCEPTION 'School SELECT policy postflight mismatch';
 END IF;
END;
$postflight$;
COMMIT;
