-- NOT APPLIED. Roll back only the exact reviewed CTE SELECT-policy patch to V2.
-- Guarded source SHA256 23d8fbdc3f01b78954059fb55ce7f625d86adc7e693769cf86733c3ab478104b.
-- All 9 helpers/owners/ACLs, private schema, RLS and non-read policies are pinned.
-- No function/schema DROP, data DML, GRANT/REVOKE or settings change occurs.
-- Required rollback order: (1) this file restores V2 with all private helpers;
-- (2) only then, if needed, read-policy-context-rollback.sql restores V1 and
-- removes the exact three private helpers/schema with RESTRICT.
BEGIN;
DO $preflight$
DECLARE expected record; f record; n record; private_oids oid[];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.lti_records'::regclass
   AND relrowsecurity AND NOT relforcerowsecurity
   AND relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres')) THEN
  RAISE EXCEPTION 'Record RLS flags or owner drifted';
 END IF;
 FOR expected IN SELECT * FROM (VALUES
  ('public.lti_role()', '93c57c12d86eb7e3b6377cbd4f3f5dbf'),
  ('public.lti_school()', '9a442315d9888858bdf7e8223a91b113'),
  ('public.lti_feature_enabled(text)', '43a7c9f8772b17dfc34ab025c35eec97'),
  ('public.lti_read_record(text,uuid,text,text,jsonb)', '59f8b1a2c6e36fc7b5cda33ee78dd473'),
  ('public.lti_record_feature_enabled(text,text,boolean)', '51be06a0ae3a42b8694574445309e655'),
  ('public.lti_record_feature_enabled(text,text,boolean,jsonb)', '627c32699145903125fd7434308cfc60')
 ) AS e(identity_signature,definition_md5)
 LOOP
  SELECT p.* INTO f FROM pg_proc p WHERE p.oid=to_regprocedure(expected.identity_signature);
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM expected.definition_md5
    OR f.proowner<>(SELECT oid FROM pg_roles WHERE rolname='postgres')
    OR f.proacl IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[] THEN
   RAISE EXCEPTION 'Existing helper % definition, owner or ACL drifted',expected.identity_signature;
  END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_policy WHERE polrelid='public.lti_records'::regclass)<>8 THEN
  RAISE EXCEPTION 'Unexpected record policy count';
 END IF;
 FOR expected IN SELECT * FROM (VALUES
  ('record_read','r',true,'7ab727f92dfd5698edf844da9e5784bd',NULL),
  ('feature_read','r',false,'c82a6a779bdd013134b6451cbc683ce2',NULL),
  ('feature_delete','d',false,'78fa54973ceaefb71dd39db6550ad8a4',NULL),
  ('feature_insert','a',false,NULL,'78fa54973ceaefb71dd39db6550ad8a4'),
  ('feature_update','w',false,'78fa54973ceaefb71dd39db6550ad8a4','78fa54973ceaefb71dd39db6550ad8a4'),
  ('record_delete','d',true,'67ac6d56806fbe8495f4bef3aab45ec9',NULL),
  ('record_insert','a',true,NULL,'577767ab9b09430bb6a25cd97bc27d8c'),
  ('record_update','w',true,'b6821ad49c200fee452fc45baf4a8b55','b6821ad49c200fee452fc45baf4a8b55')
 ) AS e(policy_name,command,permissive,qual_md5,check_md5)
 LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_policy p
   WHERE p.polrelid='public.lti_records'::regclass AND p.polname=expected.policy_name
    AND p.polcmd::text=expected.command AND p.polpermissive=expected.permissive
    AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]
    AND md5(pg_get_expr(p.polqual,p.polrelid)) IS NOT DISTINCT FROM expected.qual_md5
    AND md5(pg_get_expr(p.polwithcheck,p.polrelid)) IS NOT DISTINCT FROM expected.check_md5) THEN
   RAISE EXCEPTION 'Policy % drifted',expected.policy_name;
  END IF;
 END LOOP;
 SELECT oid,nspowner,nspacl INTO n FROM pg_namespace WHERE nspname='lti_read_private';
 IF NOT FOUND OR n.nspowner<>(SELECT oid FROM pg_roles WHERE rolname='postgres')
   OR n.nspacl IS DISTINCT FROM '{postgres=UC/postgres,authenticated=U/postgres}'::aclitem[] THEN
  RAISE EXCEPTION 'Private schema owner or ACL drifted';
 END IF;
 IF NOT has_schema_privilege('authenticated',n.oid,'USAGE')
   OR has_schema_privilege('authenticated',n.oid,'CREATE')
   OR has_schema_privilege('anon',n.oid,'USAGE')
   OR has_schema_privilege('service_role',n.oid,'USAGE') THEN
  RAISE EXCEPTION 'Private schema effective privileges drifted';
 END IF;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace=n.oid)<>3 THEN
  RAISE EXCEPTION 'Unexpected private helper count';
 END IF;
 FOR expected IN SELECT * FROM (VALUES
  ('lti_read_private.context()','81b080dd3376ed1ce5e235aaa5861a01'),
  ('lti_read_private.feature_allowed(text,text,text,jsonb,jsonb)','f495618e5d3c4fb0791b0678c8b4ff23'),
  ('lti_read_private.record_allowed(text,uuid,text,text,jsonb,jsonb)','1bc0a102b59bedb9894b5cd2c38594a1')
 ) AS e(identity_signature,definition_md5)
 LOOP
  SELECT p.* INTO f FROM pg_proc p WHERE p.oid=to_regprocedure(expected.identity_signature);
  IF NOT FOUND OR f.pronamespace<>n.oid
    OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM expected.definition_md5
    OR f.proowner<>n.nspowner
    OR f.proacl IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'::aclitem[]
    OR NOT has_function_privilege('authenticated',f.oid,'EXECUTE')
    OR has_function_privilege('anon',f.oid,'EXECUTE')
    OR has_function_privilege('service_role',f.oid,'EXECUTE') THEN
   RAISE EXCEPTION 'Private helper % definition, owner or ACL drifted',expected.identity_signature;
  END IF;
 END LOOP;
 SELECT array_agg(oid) INTO private_oids FROM pg_proc WHERE pronamespace=n.oid;
 -- Any other namespace member (table/view/type/operator/default ACL/etc.) blocks
 -- deletion. External tracked dependents other than the two exact policies do
 -- too. Untracked routine-body references are not visible in pg_depend; RESTRICT
 -- remains the final PostgreSQL boundary for all tracked dependencies.
 IF EXISTS(SELECT 1 FROM pg_depend d WHERE d.refclassid='pg_namespace'::regclass
   AND d.refobjid=n.oid AND NOT(d.classid='pg_proc'::regclass AND d.objid=ANY(private_oids))) THEN
  RAISE EXCEPTION 'Unrelated private schema member exists';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_depend d WHERE d.refclassid='pg_proc'::regclass
   AND d.refobjid=ANY(private_oids) AND NOT(d.classid='pg_policy'::regclass
    AND d.objid IN(SELECT oid FROM pg_policy WHERE polrelid='public.lti_records'::regclass
      AND polname IN('record_read','feature_read')))) THEN
  RAISE EXCEPTION 'Unrelated tracked private helper dependency exists';
 END IF;
END;
$preflight$;

ALTER POLICY record_read ON public.lti_records USING (
 lti_read_private.record_allowed(kind,owner_id,school_id,student_id,data,(SELECT lti_read_private.context()))
);
ALTER POLICY feature_read ON public.lti_records USING (
 lti_read_private.feature_allowed(kind,status,school_id,data,(SELECT lti_read_private.context()))
);

DO $postflight$
DECLARE expected record;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('record_read','f905e7e0d3d22581645bb60e4aaeab16'),
  ('feature_read','f7df3acbd7839e97a3354aa72ab06cab')
 ) AS e(policy_name,qual_md5)
 LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid='public.lti_records'::regclass
    AND p.polname=expected.policy_name AND md5(pg_get_expr(p.polqual,p.polrelid))=expected.qual_md5) THEN
   RAISE EXCEPTION 'V2 SELECT policy % was not restored exactly',expected.policy_name;
  END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace=to_regnamespace('lti_read_private'))<>3 THEN
  RAISE EXCEPTION 'V2 private helpers must remain intact';
 END IF;
END;
$postflight$;
COMMIT;
