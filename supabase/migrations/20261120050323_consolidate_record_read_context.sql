-- Reuse one request context for both SELECT conditions. The restrictive policy
-- keeps the full record AND feature gate, including for future permissive rules.
-- Changes exactly two USING expressions; helpers, ACLs, write policies and data stay intact.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $preflight$
DECLARE expected record; f record; n record; private_oids oid[];
BEGIN

 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Unexpected DDL role'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid='public.lti_records'::regclass
   AND c.relacl IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,anon=Dxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}'::aclitem[]) THEN
  RAISE EXCEPTION 'Record table ACL drifted';
 END IF;
 IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.lti_records'::regclass AND attnum>0 AND NOT attisdropped)<>8 THEN
  RAISE EXCEPTION 'Record column set drifted';
 END IF;
 FOR expected IN SELECT * FROM (VALUES
  ('kind','text',true,'',NULL),
  ('id','text',true,'',NULL),
  ('owner_id','uuid',true,'','auth.uid()'),
  ('data','jsonb',true,'',NULL),
  ('school_id','text',false,'s','(data ->> ''schoolId''::text)'),
  ('student_id','text',false,'s','(data ->> ''studentId''::text)'),
  ('status','text',false,'s','(data ->> ''status''::text)'),
  ('version','integer',true,'','1')
 ) AS e(column_name,type_name,not_null,generated,expression)
 LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='public.lti_records'::regclass AND a.attname=expected.column_name
      AND a.attnum>0 AND NOT a.attisdropped AND format_type(a.atttypid,a.atttypmod)=expected.type_name
      AND a.attnotnull=expected.not_null AND a.attgenerated::text=expected.generated AND a.attacl IS NULL
      AND (a.atttypid<>'text'::regtype OR a.attcollation='pg_catalog."default"'::regcollation)
      AND pg_get_expr(d.adbin,d.adrelid) IS NOT DISTINCT FROM expected.expression) THEN
   RAISE EXCEPTION 'Record column % type, nullability, generation, default or ACL drifted',expected.column_name;
  END IF;
 END LOOP;
 IF NOT EXISTS(
  SELECT 1 FROM pg_attribute a JOIN pg_attrdef d
   ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attrelid='public.lti_records'::regclass
   AND a.attname='status' AND a.attnum>0 AND NOT a.attisdropped
   AND a.attgenerated='s'
   AND a.atttypid='pg_catalog.text'::regtype
   AND a.attcollation='pg_catalog."default"'::regcollation
   AND pg_get_expr(d.adbin,d.adrelid)='(data ->> ''status''::text)'
 ) THEN
  RAISE EXCEPTION 'Stored status generated-column type, collation or expression drifted';
 END IF;

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
  ('record_read','r',true,'842c14fd0576ee5a470779513350468b',NULL),
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

ALTER POLICY record_read ON public.lti_records USING(true);ALTER POLICY feature_read ON public.lti_records USING(EXISTS(WITH c AS MATERIALIZED(SELECT lti_read_private.context() AS value) SELECT 1 FROM c WHERE (
  coalesce((c.value->>'role') IS NOT NULL AND (
    (c.value->>'role')='admin'
    OR (kind IN ('references','notes') AND owner_id=((c.value->>'userId')::uuid))
    OR (kind='papers' AND (status='公開中'
      OR ((c.value->>'role')='teacher' AND school_id=(c.value->>'schoolId'))))
    OR (kind='paper_threads' AND (c.value->>'role')='teacher' AND school_id=(c.value->>'schoolId'))
    OR (kind IN ('assignments','materials') AND school_id=(c.value->>'schoolId'))
    OR (kind='submissions' AND school_id=(c.value->>'schoolId')
      AND (student_id=((c.value->>'userId')::uuid)::text OR (c.value->>'role')='teacher'))
    OR (kind='feedback' AND school_id=(c.value->>'schoolId')
      AND (student_id=((c.value->>'userId')::uuid)::text OR (c.value->>'role')='teacher'))
    OR (kind='notices' AND (
      coalesce(data->>'targetType','all')='all'
      OR (data->>'targetType'='specific' AND jsonb_typeof(data->'targetSchoolIds')='array'
        AND (data->'targetSchoolIds') ? (c.value->>'schoolId'))
    ))
    OR (kind='contests' AND (data->>'targetType'='all'
      OR (data->'targetSchoolIds') ? (c.value->>'schoolId')))
  ),false)) AND (
  CASE
    WHEN (c.value->>'role')='admin' THEN true
    WHEN (c.value->>'role') IS NULL THEN false
    -- Same read-only branch as the four-argument helper. In particular, a
    -- withdrawn/missing assignment stays readable when the stored manual shape
    -- is valid; the helper's assignment/student existence checks apply to writes.
    WHEN kind='feedback' AND (c.value->>'role')='teacher'
      AND (data->>'source'='manual' OR nullif(data->>'assignmentId','') IS NOT NULL)
    THEN coalesce(data->>'source','manual')='manual'
      AND nullif(data->>'assignmentId','') IS NOT NULL
      AND data->'result' IS NOT DISTINCT FROM '{"corrections":[],"advice":[],"nextExperiments":[]}'::jsonb
      AND (CASE WHEN c.value->>'role'='admin' THEN true WHEN c.value->>'role' IS NULL THEN false ELSE coalesce(c.value->'settings'->>((c.value->>'role')||':進捗管理'),'enabled')='enabled' END)
    WHEN kind='feedback' AND (c.value->>'role')='teacher'
      AND coalesce(data->>'source','ai')<>'ai' THEN false
    ELSE CASE kind
      WHEN 'papers' THEN
        (status='公開中' AND (CASE WHEN c.value->>'role'='admin' THEN true WHEN c.value->>'role' IS NULL THEN false ELSE coalesce(c.value->'settings'->>((c.value->>'role')||':みんなの論文'),'enabled')='enabled' END))
        OR ((c.value->>'role')='teacher' AND (CASE WHEN c.value->>'role'='admin' THEN true WHEN c.value->>'role' IS NULL THEN false ELSE coalesce(c.value->'settings'->>((c.value->>'role')||':探究論文の公開申請'),'enabled')='enabled' END))
      WHEN 'paper_threads' THEN (CASE WHEN c.value->>'role'='admin' THEN true WHEN c.value->>'role' IS NULL THEN false ELSE coalesce(c.value->'settings'->>((c.value->>'role')||':探究論文の公開申請'),'enabled')='enabled' END)
      WHEN 'materials' THEN (CASE WHEN c.value->>'role'='admin' THEN true WHEN c.value->>'role' IS NULL THEN false ELSE coalesce(c.value->'settings'->>((c.value->>'role')||':教材'),'enabled')='enabled' END)
      WHEN 'contests' THEN (CASE WHEN c.value->>'role'='admin' THEN true WHEN c.value->>'role' IS NULL THEN false ELSE coalesce(c.value->'settings'->>((c.value->>'role')||':学会・コンテスト'),'enabled')='enabled' END)
      WHEN 'references' THEN (CASE WHEN c.value->>'role'='admin' THEN true WHEN c.value->>'role' IS NULL THEN false ELSE coalesce(c.value->'settings'->>((c.value->>'role')||':学術論文の検索'),'enabled')='enabled' END)
      WHEN 'assignments' THEN CASE WHEN (c.value->>'role')='student'
        THEN (CASE WHEN c.value->>'role'='admin' THEN true WHEN c.value->>'role' IS NULL THEN false ELSE coalesce(c.value->'settings'->>((c.value->>'role')||':課題・提出物'),'enabled')='enabled' END)
        ELSE (CASE WHEN c.value->>'role'='admin' THEN true WHEN c.value->>'role' IS NULL THEN false ELSE coalesce(c.value->'settings'->>((c.value->>'role')||':課題配信'),'enabled')='enabled' END) OR (CASE WHEN c.value->>'role'='admin' THEN true WHEN c.value->>'role' IS NULL THEN false ELSE coalesce(c.value->'settings'->>((c.value->>'role')||':進捗管理'),'enabled')='enabled' END) END
      WHEN 'submissions' THEN CASE WHEN (c.value->>'role')='student'
        THEN (CASE WHEN c.value->>'role'='admin' THEN true WHEN c.value->>'role' IS NULL THEN false ELSE coalesce(c.value->'settings'->>((c.value->>'role')||':課題・提出物'),'enabled')='enabled' END)
        ELSE (CASE WHEN c.value->>'role'='admin' THEN true WHEN c.value->>'role' IS NULL THEN false ELSE coalesce(c.value->'settings'->>((c.value->>'role')||':課題配信'),'enabled')='enabled' END) OR (CASE WHEN c.value->>'role'='admin' THEN true WHEN c.value->>'role' IS NULL THEN false ELSE coalesce(c.value->'settings'->>((c.value->>'role')||':進捗管理'),'enabled')='enabled' END) END
      WHEN 'feedback' THEN CASE WHEN (c.value->>'role')='student'
        THEN (CASE WHEN c.value->>'role'='admin' THEN true WHEN c.value->>'role' IS NULL THEN false ELSE coalesce(c.value->'settings'->>((c.value->>'role')||':先生からのフィードバック'),'enabled')='enabled' END)
        ELSE (CASE WHEN c.value->>'role'='admin' THEN true WHEN c.value->>'role' IS NULL THEN false ELSE coalesce(c.value->'settings'->>((c.value->>'role')||':AI添削'),'enabled')='enabled' END) END
      ELSE true
    END
  END
  -- Keep this original condition and its SQL NULL behaviour unchanged.
  AND (kind<>'papers' OR status<>'公開中'
    OR (CASE WHEN c.value->>'role'='admin' THEN true WHEN c.value->>'role' IS NULL THEN false ELSE coalesce(c.value->'settings'->>((c.value->>'role')||':みんなの論文'),'enabled')='enabled' END)
    OR school_id=(c.value->>'schoolId')))));

DO $postflight$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid='public.lti_records'::regclass
  AND p.polname='record_read' AND p.polcmd='r' AND p.polpermissive
  AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]
  AND p.polwithcheck IS NULL AND md5(pg_get_expr(p.polqual,p.polrelid))='b326b5062b2f0e69046810717534cb09') THEN
  RAISE EXCEPTION 'Combined record-read postflight mismatch';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid='public.lti_records'::regclass
  AND p.polname='feature_read' AND p.polcmd='r' AND NOT p.polpermissive
  AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]
  AND p.polwithcheck IS NULL AND md5(pg_get_expr(p.polqual,p.polrelid))='7cfd3a59f6e8cc4090b106d9150649fe') THEN
  RAISE EXCEPTION 'Combined restrictive gate postflight mismatch';
 END IF;
END;
$postflight$;
COMMIT;
