-- Consolidate request-only read authorization; verified by isolated differential tests.
-- Preserve both SELECT policies and all existing functions/write policies/data.
-- A statement gets one uncorrelated identity/feature context per SELECT policy.
-- No request GUC/cache and no new SECURITY DEFINER privileges are introduced.
BEGIN;
DO $preflight$
DECLARE expected record;
BEGIN
 IF to_regnamespace('lti_read_private') IS NOT NULL THEN
  RAISE EXCEPTION 'Private read schema already exists; inspect before creating any helper';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.lti_records'::regclass AND relrowsecurity) THEN
  RAISE EXCEPTION 'Record RLS must be enabled';
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
  IF to_regprocedure(expected.identity_signature) IS NULL OR
     md5(pg_get_functiondef(to_regprocedure(expected.identity_signature))) IS DISTINCT FROM expected.definition_md5 THEN
   RAISE EXCEPTION 'Original helper % changed; inspect before modifying SELECT policies',expected.identity_signature;
  END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_policy WHERE polrelid='public.lti_records'::regclass AND polcmd IN ('r','*'))<>2 THEN
  RAISE EXCEPTION 'Unexpected SELECT policy set';
 END IF;
 FOR expected IN SELECT * FROM (VALUES
  ('record_read',true,'374bf08efbc00aa3d4f975c022892e65'),
  ('feature_read',false,'61ffd14912ca815a469e9aeac9623ae1')
 ) AS e(policy_name,permissive,qual_md5)
 LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid='public.lti_records'::regclass
     AND p.polname=expected.policy_name AND p.polcmd='r' AND p.polpermissive=expected.permissive
     AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]
     AND p.polwithcheck IS NULL AND md5(pg_get_expr(p.polqual,p.polrelid))=expected.qual_md5) THEN
   RAISE EXCEPTION 'Unexpected original SELECT policy %',expected.policy_name;
  END IF;
 END LOOP;
END;
$preflight$;

CREATE SCHEMA lti_read_private;
REVOKE ALL ON SCHEMA lti_read_private FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA lti_read_private TO authenticated;

CREATE FUNCTION lti_read_private.context() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''
AS $function$
DECLARE r text; u uuid; s text; settings jsonb;
BEGIN
 u:=auth.uid();
 r:=public.lti_role();
 IF r IS NOT NULL THEN s:=public.lti_school(); END IF;
 -- This is the same invoker/RLS-protected school lookup as feature_enabled.
 -- Missing/NULL schools and NULL settings retain the per-feature enabled default.
 IF r IS NOT NULL AND r<>'admin' THEN
  SELECT school.feature_settings INTO settings FROM public.lti_schools school WHERE school.id=s;
 END IF;
 RETURN jsonb_build_object('role',r,'userId',u,'schoolId',s,'settings',settings);
END;
$function$;

CREATE FUNCTION lti_read_private.record_allowed(k text,o uuid,s text,student text,d jsonb,c jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=''
AS $function$
DECLARE r text:=c->>'role'; school text:=c->>'schoolId'; u text:=c->>'userId';
BEGIN
 RETURN coalesce(r IS NOT NULL AND (
  r='admin'
  OR (k IN ('references','notes') AND o::text=u)
  OR (k='papers' AND (d->>'status'='公開中' OR (r='teacher' AND s=school)))
  OR (k='paper_threads' AND r='teacher' AND s=school)
  OR (k IN ('assignments','materials') AND s=school)
  OR (k='submissions' AND s=school AND (student=u OR r='teacher'))
  OR (k='feedback' AND s=school AND (student=u OR r='teacher'))
  OR (k='notices' AND (
   coalesce(d->>'targetType','all')='all'
   OR (d->>'targetType'='specific' AND jsonb_typeof(d->'targetSchoolIds')='array'
    AND (d->'targetSchoolIds') ? school)
  ))
  OR (k='contests' AND (d->>'targetType'='all' OR (d->'targetSchoolIds') ? school))
 ),false);
END;
$function$;

CREATE FUNCTION lti_read_private.feature_allowed(k text,st text,s text,d jsonb,c jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=''
AS $function$
DECLARE r text:=c->>'role'; school text:=c->>'schoolId'; settings jsonb:=c->'settings'; allowed boolean; community boolean;
BEGIN
 community:=CASE WHEN r='admin' THEN true WHEN r IS NULL THEN false
  ELSE coalesce(settings->>(r||':みんなの論文'),'enabled')='enabled' END;
 IF r='admin' THEN allowed:=true;
 ELSIF r IS NULL THEN allowed:=false;
 ELSIF k='feedback' AND r='teacher' AND (d->>'source'='manual' OR nullif(d->>'assignmentId','') IS NOT NULL) THEN
  allowed:=coalesce(d->>'source','manual')='manual'
   AND nullif(d->>'assignmentId','') IS NOT NULL
   AND d->'result' IS NOT DISTINCT FROM '{"corrections":[],"advice":[],"nextExperiments":[]}'::jsonb
   AND coalesce(settings->>(r||':進捗管理'),'enabled')='enabled';
 ELSIF k='feedback' AND r='teacher' AND coalesce(d->>'source','ai')<>'ai' THEN allowed:=false;
 ELSE
  CASE k
  WHEN 'papers' THEN allowed:=(st='公開中' AND community)
   OR (r='teacher' AND coalesce(settings->>(r||':探究論文の公開申請'),'enabled')='enabled');
  WHEN 'paper_threads' THEN allowed:=coalesce(settings->>(r||':探究論文の公開申請'),'enabled')='enabled';
  WHEN 'materials' THEN allowed:=coalesce(settings->>(r||':教材'),'enabled')='enabled';
  WHEN 'contests' THEN allowed:=coalesce(settings->>(r||':学会・コンテスト'),'enabled')='enabled';
  WHEN 'references' THEN allowed:=coalesce(settings->>(r||':学術論文の検索'),'enabled')='enabled';
  WHEN 'assignments','submissions' THEN
   IF r='student' THEN allowed:=coalesce(settings->>(r||':課題・提出物'),'enabled')='enabled';
   ELSE allowed:=coalesce(settings->>(r||':課題配信'),'enabled')='enabled'
    OR coalesce(settings->>(r||':進捗管理'),'enabled')='enabled'; END IF;
  WHEN 'feedback' THEN
   IF r='student' THEN allowed:=coalesce(settings->>(r||':先生からのフィードバック'),'enabled')='enabled';
   ELSE allowed:=coalesce(settings->>(r||':AI添削'),'enabled')='enabled'; END IF;
  ELSE allowed:=true;
  END CASE;
 END IF;
 -- Keep the original SQL three-valued condition, including NULL paper status.
 RETURN allowed AND (k<>'papers' OR st<>'公開中' OR community OR s=school);
END;
$function$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA lti_read_private FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA lti_read_private TO authenticated;

DO $private_boundary$
DECLARE n record; f record; auth_role oid;
BEGIN
 SELECT oid INTO auth_role FROM pg_roles WHERE rolname='authenticated';
 SELECT oid,nspowner,nspacl INTO n FROM pg_namespace WHERE nspname='lti_read_private';
 IF EXISTS(SELECT 1 FROM aclexplode(n.nspacl) a
    WHERE a.grantee NOT IN (n.nspowner,auth_role)
      OR (a.grantee=auth_role AND (a.privilege_type<>'USAGE' OR a.is_grantable))) THEN
  RAISE EXCEPTION 'Unexpected private schema ACL from default privileges';
 END IF;
 IF NOT has_schema_privilege('authenticated',n.oid,'USAGE')
    OR has_schema_privilege('authenticated',n.oid,'CREATE')
    OR has_schema_privilege('anon',n.oid,'USAGE')
    OR has_schema_privilege('service_role',n.oid,'USAGE') THEN
  RAISE EXCEPTION 'Unexpected effective private schema privileges';
 END IF;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace=n.oid)<>3 THEN
  RAISE EXCEPTION 'Unexpected private helper count';
 END IF;
 FOR f IN SELECT p.*,l.lanname FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.pronamespace=n.oid LOOP
  IF f.prosecdef OR f.lanname<>'plpgsql'
    OR (f.proname='context' AND f.provolatile<>'s')
    OR (f.proname<>'context' AND f.provolatile<>'i') THEN
   RAISE EXCEPTION 'Unexpected private helper security or volatility';
  END IF;
  IF EXISTS(SELECT 1 FROM aclexplode(f.proacl) a
     WHERE a.grantee NOT IN (f.proowner,auth_role)
       OR (a.grantee=auth_role AND (a.privilege_type<>'EXECUTE' OR a.is_grantable))) THEN
   RAISE EXCEPTION 'Unexpected private function ACL from default privileges';
  END IF;
  IF NOT has_function_privilege('authenticated',f.oid,'EXECUTE')
     OR has_function_privilege('anon',f.oid,'EXECUTE')
     OR has_function_privilege('service_role',f.oid,'EXECUTE') THEN
   RAISE EXCEPTION 'Unexpected effective private helper privileges';
  END IF;
 END LOOP;
END;
$private_boundary$;

ALTER POLICY record_read ON public.lti_records USING (
 lti_read_private.record_allowed(kind,owner_id,school_id,student_id,data,(SELECT lti_read_private.context()))
);
ALTER POLICY feature_read ON public.lti_records USING (
 lti_read_private.feature_allowed(kind,status,school_id,data,(SELECT lti_read_private.context()))
);
COMMIT;
