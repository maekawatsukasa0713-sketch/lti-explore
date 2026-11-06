-- Preserve SELECT authorization while evaluating request-only helpers once per statement.
-- Tokyo public.lti_records SELECT policies; contains no application/Auth/Storage DML.
-- Existing public helper functions, grants, RLS enabled state, all write policies,
-- and all application/Auth/Storage data remain untouched.
-- Validated by differential fixtures and independent semantic review; catalog
-- preflight stops on unexpected policy/helper drift.
-- The helpers below are STABLE and depend only on the request identity/settings.
-- SELECT wrappers permit uncorrelated initPlans once per statement; never cache
-- row-dependent lti_read_record(...) or lti_record_feature_enabled(...data).

DO $preflight$
DECLARE expected record;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.lti_records'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'Record RLS must already be enabled';
  END IF;
  -- Full pg_get_functiondef text (UTF-8, including its trailing newline), from
  -- current-access-metadata.json. Identity signatures disambiguate overloads.
  -- A helper's security mode, volatility, search_path, or body drift must stop
  -- this exact semantic expansion before either SELECT policy is altered.
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
      RAISE EXCEPTION 'Original helper % changed; inspect the current definition first',expected.identity_signature;
    END IF;
  END LOOP;
  FOR expected IN SELECT * FROM (VALUES
    ('record_read',true,'83e677638b253804da40f9b24f965f77'),
    ('feature_read',false,'f532ced795bb6c5bb4270ec488ec60b3')
  ) AS e(policy_name,permissive,qual_md5)
  LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_policy p
      WHERE p.polrelid='public.lti_records'::regclass AND p.polname=expected.policy_name
        AND p.polcmd='r' AND p.polpermissive=expected.permissive
        AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]
        AND p.polwithcheck IS NULL
        AND md5(pg_get_expr(p.polqual,p.polrelid))=expected.qual_md5) THEN
      RAISE EXCEPTION 'Original SELECT policy % changed; inspect the current definition first',expected.policy_name;
    END IF;
  END LOOP;
END;
$preflight$;

ALTER POLICY record_read ON public.lti_records USING (
  coalesce((SELECT public.lti_role()) IS NOT NULL AND (
    (SELECT public.lti_role())='admin'
    OR (kind IN ('references','notes') AND owner_id=(SELECT auth.uid()))
    OR (kind='papers' AND (data->>'status'='公開中'
      OR ((SELECT public.lti_role())='teacher' AND school_id=(SELECT public.lti_school()))))
    OR (kind='paper_threads' AND (SELECT public.lti_role())='teacher' AND school_id=(SELECT public.lti_school()))
    OR (kind IN ('assignments','materials') AND school_id=(SELECT public.lti_school()))
    OR (kind='submissions' AND school_id=(SELECT public.lti_school())
      AND (student_id=(SELECT auth.uid())::text OR (SELECT public.lti_role())='teacher'))
    OR (kind='feedback' AND school_id=(SELECT public.lti_school())
      AND (student_id=(SELECT auth.uid())::text OR (SELECT public.lti_role())='teacher'))
    OR (kind='notices' AND (
      coalesce(data->>'targetType','all')='all'
      OR (data->>'targetType'='specific' AND jsonb_typeof(data->'targetSchoolIds')='array'
        AND (data->'targetSchoolIds') ? (SELECT public.lti_school()))
    ))
    OR (kind='contests' AND (data->>'targetType'='all'
      OR (data->'targetSchoolIds') ? (SELECT public.lti_school())))
  ),false)
);

ALTER POLICY feature_read ON public.lti_records USING (
  CASE
    WHEN (SELECT public.lti_role())='admin' THEN true
    WHEN (SELECT public.lti_role()) IS NULL THEN false
    -- Same read-only branch as the four-argument helper. In particular, a
    -- withdrawn/missing assignment stays readable when the stored manual shape
    -- is valid; the helper's assignment/student existence checks apply to writes.
    WHEN kind='feedback' AND (SELECT public.lti_role())='teacher'
      AND (data->>'source'='manual' OR nullif(data->>'assignmentId','') IS NOT NULL)
    THEN coalesce(data->>'source','manual')='manual'
      AND nullif(data->>'assignmentId','') IS NOT NULL
      AND data->'result' IS NOT DISTINCT FROM '{"corrections":[],"advice":[],"nextExperiments":[]}'::jsonb
      AND (SELECT public.lti_feature_enabled('進捗管理'))
    WHEN kind='feedback' AND (SELECT public.lti_role())='teacher'
      AND coalesce(data->>'source','ai')<>'ai' THEN false
    ELSE CASE kind
      WHEN 'papers' THEN
        (status='公開中' AND (SELECT public.lti_feature_enabled('みんなの論文')))
        OR ((SELECT public.lti_role())='teacher' AND (SELECT public.lti_feature_enabled('探究論文の公開申請')))
      WHEN 'paper_threads' THEN (SELECT public.lti_feature_enabled('探究論文の公開申請'))
      WHEN 'materials' THEN (SELECT public.lti_feature_enabled('教材'))
      WHEN 'contests' THEN (SELECT public.lti_feature_enabled('学会・コンテスト'))
      WHEN 'references' THEN (SELECT public.lti_feature_enabled('学術論文の検索'))
      WHEN 'assignments' THEN CASE WHEN (SELECT public.lti_role())='student'
        THEN (SELECT public.lti_feature_enabled('課題・提出物'))
        ELSE (SELECT public.lti_feature_enabled('課題配信')) OR (SELECT public.lti_feature_enabled('進捗管理')) END
      WHEN 'submissions' THEN CASE WHEN (SELECT public.lti_role())='student'
        THEN (SELECT public.lti_feature_enabled('課題・提出物'))
        ELSE (SELECT public.lti_feature_enabled('課題配信')) OR (SELECT public.lti_feature_enabled('進捗管理')) END
      WHEN 'feedback' THEN CASE WHEN (SELECT public.lti_role())='student'
        THEN (SELECT public.lti_feature_enabled('先生からのフィードバック'))
        ELSE (SELECT public.lti_feature_enabled('AI添削')) END
      ELSE true
    END
  END
  -- Keep this original condition and its SQL NULL behaviour unchanged.
  AND (kind<>'papers' OR status<>'公開中'
    OR (SELECT public.lti_feature_enabled('みんなの論文'))
    OR school_id=(SELECT public.lti_school()))
);
