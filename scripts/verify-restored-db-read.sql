-- 2026-10-11に実行した復元先DBの読み取り権限検証。
-- 実行先: project_id zzaljxqectngziawxakn (lti-restore-test-20261011)
-- public 9テーブル、公開論文534件という当日のデータに基づく。
-- 管理用接続から実行し、最初のSQLエラーで停止すること。
-- READ ONLY / SET LOCAL / ROLLBACKのみ。データ・Auth設定を変更しない。
-- 実ログイン・JWT発行・二段階認証の試験ではない。
-- 生徒・教員のUIDと既存session_idはDB内で選び、結果へ出力しない。

-- 生徒: 13項目

BEGIN READ ONLY;
DO $setup$
DECLARE actor uuid; session_uuid uuid; expected_profiles bigint;
BEGIN
 SELECT p.id,s.id INTO actor,session_uuid FROM public.lti_profiles p
 JOIN public.lti_schools school ON school.id=p.school_id
 JOIN LATERAL(SELECT id FROM auth.sessions WHERE user_id=p.id AND created_at>=p.session_valid_after ORDER BY created_at DESC LIMIT 1) s ON true
 WHERE p.role='student' AND p.active AND NOT p.must_change_password
 AND coalesce(school.feature_settings->>'student:みんなの論文','enabled')='enabled'
 ORDER BY p.school_id,p.id LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'No eligible student fixture available'; END IF;
 SELECT 1+count(*) INTO expected_profiles FROM public.lti_profiles
 WHERE school_id=(SELECT school_id FROM public.lti_profiles WHERE id=actor) AND role='teacher' AND active;
 PERFORM set_config('restore_test.expected_profiles',expected_profiles::text,true);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','session_id',session_uuid)::text,true);
END $setup$;
SET LOCAL ROLE authenticated;
DO $verify$
DECLARE c bigint;
BEGIN
 IF public.lti_role() IS DISTINCT FROM 'student' THEN RAISE EXCEPTION 'Student role helper mismatch'; END IF;
 IF public.lti_school() IS NULL THEN RAISE EXCEPTION 'Student school helper missing'; END IF;
 SELECT count(*) INTO c FROM public.lti_schools;
 IF c<>1 THEN RAISE EXCEPTION 'Student must see exactly own school: %',c; END IF;
 IF EXISTS(SELECT 1 FROM public.lti_schools WHERE id<>public.lti_school()) THEN RAISE EXCEPTION 'Other school visible'; END IF;
 SELECT count(*) INTO c FROM public.lti_profiles;
 IF c<>current_setting('restore_test.expected_profiles')::bigint THEN RAISE EXCEPTION 'Student profile visibility mismatch: %',c; END IF;
 IF EXISTS(SELECT 1 FROM public.lti_profiles WHERE id<>auth.uid() AND (school_id IS DISTINCT FROM public.lti_school() OR role<>'teacher' OR NOT active)) THEN RAISE EXCEPTION 'Unauthorized profile visible'; END IF;
 SELECT count(*) INTO c FROM public.lti_records WHERE kind='papers' AND status='公開中';
 IF c<>534 THEN RAISE EXCEPTION 'Published paper count mismatch: %',c; END IF;
 SELECT count(*) INTO c FROM public.lti_records WHERE kind='papers' AND status='公開中' AND jsonb_typeof(data->'aiAnalysis')='object';
 IF c<>534 THEN RAISE EXCEPTION 'Saved analysis read mismatch: %',c; END IF;
 IF EXISTS(SELECT 1 FROM public.lti_records WHERE kind='papers' AND status='公開中' AND NOT public.lti_can_access_paper(id)) THEN RAISE EXCEPTION 'Paper access RPC denied accessible paper'; END IF;
 IF EXISTS(SELECT 1 FROM public.lti_records WHERE kind='papers' AND status<>'公開中') THEN RAISE EXCEPTION 'Unpublished paper visible to student'; END IF;
 IF EXISTS(SELECT 1 FROM public.lti_records WHERE kind IN ('assignments','materials','submissions','feedback','paper_threads') AND school_id IS DISTINCT FROM public.lti_school()) THEN RAISE EXCEPTION 'Other school private record visible'; END IF;
 IF EXISTS(SELECT 1 FROM public.lti_records WHERE kind IN ('submissions','feedback') AND student_id IS DISTINCT FROM auth.uid()::text) THEN RAISE EXCEPTION 'Another student private record visible'; END IF;
 IF EXISTS(SELECT 1 FROM public.lti_records WHERE kind IN ('references','notes') AND owner_id<>auth.uid()) THEN RAISE EXCEPTION 'Another account notes visible'; END IF;
END $verify$;
RESET ROLE;
ROLLBACK;
SELECT jsonb_build_object('status','PASS','actor','student','read_only',true,'published_papers',534,'saved_analysis_objects',534,'checks',13) AS policy_test;

-- 教員: 12項目

BEGIN READ ONLY;
DO $setup$
DECLARE actor uuid; session_uuid uuid; expected_profiles bigint;
BEGIN
 SELECT p.id,s.id INTO actor,session_uuid FROM public.lti_profiles p
 JOIN public.lti_schools school ON school.id=p.school_id
 JOIN LATERAL(SELECT id FROM auth.sessions WHERE user_id=p.id AND created_at>=p.session_valid_after ORDER BY created_at DESC LIMIT 1) s ON true
 WHERE p.role='teacher' AND p.active AND NOT p.must_change_password
 AND coalesce(school.feature_settings->>'teacher:みんなの論文','enabled')='enabled'
 ORDER BY p.school_id,p.id LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'No eligible teacher fixture available'; END IF;
 SELECT count(*) INTO expected_profiles FROM public.lti_profiles WHERE school_id=(SELECT school_id FROM public.lti_profiles WHERE id=actor);
 PERFORM set_config('restore_test.expected_profiles',expected_profiles::text,true);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','session_id',session_uuid)::text,true);
END $setup$;
SET LOCAL ROLE authenticated;
DO $verify$
DECLARE c bigint;
BEGIN
 IF public.lti_role() IS DISTINCT FROM 'teacher' THEN RAISE EXCEPTION 'Teacher role helper mismatch'; END IF;
 IF public.lti_school() IS NULL THEN RAISE EXCEPTION 'Teacher school helper missing'; END IF;
 SELECT count(*) INTO c FROM public.lti_schools;
 IF c<>1 THEN RAISE EXCEPTION 'Teacher must see own school only'; END IF;
 IF EXISTS(SELECT 1 FROM public.lti_schools WHERE id<>public.lti_school()) THEN RAISE EXCEPTION 'Other school visible'; END IF;
 SELECT count(*) INTO c FROM public.lti_profiles;
 IF c<>current_setting('restore_test.expected_profiles')::bigint THEN RAISE EXCEPTION 'Teacher profile visibility mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.lti_profiles WHERE school_id IS DISTINCT FROM public.lti_school()) THEN RAISE EXCEPTION 'Other school profile visible'; END IF;
 SELECT count(*) INTO c FROM public.lti_records WHERE kind='papers' AND status='公開中';
 IF c<>534 THEN RAISE EXCEPTION 'Published paper count mismatch: %',c; END IF;
 SELECT count(*) INTO c FROM public.lti_records WHERE kind='papers' AND status='公開中' AND jsonb_typeof(data->'aiAnalysis')='object';
 IF c<>534 THEN RAISE EXCEPTION 'Saved analysis read mismatch: %',c; END IF;
 IF EXISTS(SELECT 1 FROM public.lti_records WHERE kind='papers' AND status='公開中' AND NOT public.lti_can_access_paper(id)) THEN RAISE EXCEPTION 'Accessible paper denied by RPC'; END IF;
 IF EXISTS(SELECT 1 FROM public.lti_records WHERE kind IN ('assignments','materials','submissions','feedback','paper_threads') AND school_id IS DISTINCT FROM public.lti_school()) THEN RAISE EXCEPTION 'Other school private record visible'; END IF;
 IF EXISTS(SELECT 1 FROM public.lti_records WHERE kind IN ('references','notes') AND owner_id<>auth.uid()) THEN RAISE EXCEPTION 'Other account notes visible'; END IF;
 IF EXISTS(SELECT 1 FROM public.lti_records WHERE kind='papers' AND status<>'公開中' AND school_id IS DISTINCT FROM public.lti_school()) THEN RAISE EXCEPTION 'Other school unpublished paper visible'; END IF;
END $verify$;
RESET ROLE;
ROLLBACK;
SELECT jsonb_build_object('status','PASS','actor','teacher','read_only',true,'published_papers',534,'saved_analysis_objects',534,'checks',12) AS policy_test;

-- 拒否ケース: 21項目
BEGIN READ ONLY;
DO $setup$
 DECLARE actor uuid;
 BEGIN
 SELECT id INTO actor FROM public.lti_profiles WHERE NOT active AND role IN ('student','teacher') ORDER BY id LIMIT 1; IF actor IS NULL THEN RAISE EXCEPTION 'Fixture missing: inactive_account'; END IF;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 END $setup$;
 SET LOCAL ROLE authenticated;
 DO $verify$
 DECLARE c bigint;
 BEGIN
 IF public.lti_role() IS NOT NULL THEN RAISE EXCEPTION 'Blocked fixture gained role: inactive_account'; END IF;
 IF EXISTS(SELECT 1 FROM public.lti_records) THEN RAISE EXCEPTION 'Blocked fixture read records: inactive_account'; END IF;
 IF EXISTS(SELECT 1 FROM public.lti_schools) THEN RAISE EXCEPTION 'Blocked fixture read school: inactive_account'; END IF;
 SELECT count(*) INTO c FROM public.lti_profiles;
 IF c<>1 THEN RAISE EXCEPTION 'Blocked fixture profile visibility: inactive_account'; END IF;
 END $verify$;
 RESET ROLE;
DO $setup$
 DECLARE actor uuid;
 BEGIN
 SELECT id INTO actor FROM public.lti_profiles WHERE active AND must_change_password AND role IN ('student','teacher') ORDER BY id LIMIT 1; IF actor IS NULL THEN RAISE EXCEPTION 'Fixture missing: initial_password_required'; END IF;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 END $setup$;
 SET LOCAL ROLE authenticated;
 DO $verify$
 DECLARE c bigint;
 BEGIN
 IF public.lti_role() IS NOT NULL THEN RAISE EXCEPTION 'Blocked fixture gained role: initial_password_required'; END IF;
 IF EXISTS(SELECT 1 FROM public.lti_records) THEN RAISE EXCEPTION 'Blocked fixture read records: initial_password_required'; END IF;
 IF EXISTS(SELECT 1 FROM public.lti_schools) THEN RAISE EXCEPTION 'Blocked fixture read school: initial_password_required'; END IF;
 SELECT count(*) INTO c FROM public.lti_profiles;
 IF c<>1 THEN RAISE EXCEPTION 'Blocked fixture profile visibility: initial_password_required'; END IF;
 END $verify$;
 RESET ROLE;
DO $setup$
 DECLARE actor uuid;
 BEGIN
 actor:='00000000-0000-4000-8000-0000000000ff'::uuid; IF EXISTS(SELECT 1 FROM public.lti_profiles WHERE id=actor) THEN RAISE EXCEPTION 'Unknown fixture exists'; END IF;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 END $setup$;
 SET LOCAL ROLE authenticated;
 DO $verify$
 DECLARE c bigint;
 BEGIN
 IF public.lti_role() IS NOT NULL THEN RAISE EXCEPTION 'Blocked fixture gained role: unknown_account'; END IF;
 IF EXISTS(SELECT 1 FROM public.lti_records) THEN RAISE EXCEPTION 'Blocked fixture read records: unknown_account'; END IF;
 IF EXISTS(SELECT 1 FROM public.lti_schools) THEN RAISE EXCEPTION 'Blocked fixture read school: unknown_account'; END IF;
 SELECT count(*) INTO c FROM public.lti_profiles;
 IF c<>0 THEN RAISE EXCEPTION 'Blocked fixture profile visibility: unknown_account'; END IF;
 END $verify$;
 RESET ROLE;
DO $setup$ BEGIN
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claim.role','anon',true);
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
 END $setup$;
 SET LOCAL ROLE anon;
 DO $verify$
 DECLARE table_name text;
 BEGIN
 FOREACH table_name IN ARRAY ARRAY['lti_ai_usage','lti_paper_bookmarks','lti_paper_citations','lti_paper_views','lti_profiles','lti_provision_batches','lti_records','lti_schools','lti_support_messages']
 LOOP
 BEGIN
 EXECUTE format('SELECT count(*) FROM public.%I',table_name);
 RAISE EXCEPTION 'Anonymous access unexpectedly allowed: %',table_name;
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 END LOOP;
 END $verify$;
 RESET ROLE;
 ROLLBACK;
 SELECT jsonb_build_object('status','PASS','read_only',true,'blocked_account_cases',ARRAY['inactive_account','initial_password_required','unknown_account'],'anonymous_tables_denied',9,'checks',21) AS negative_policy_test;
