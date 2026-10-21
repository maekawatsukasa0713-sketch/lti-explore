-- Read-only, aggregate-only migration comparison. No row contents or secrets
-- are returned. Run on the source and target at the final write-frozen snapshot.
-- This is NOT a database backup or proof of Storage object byte integrity.
-- MFA tables/settings are deliberately not read or changed here.
WITH application_rows AS (
  SELECT 'public.lti_ai_usage' AS relation, to_jsonb(t) AS payload FROM public.lti_ai_usage t
  UNION ALL SELECT 'public.lti_paper_bookmarks', to_jsonb(t) FROM public.lti_paper_bookmarks t
  UNION ALL SELECT 'public.lti_paper_citations', to_jsonb(t) FROM public.lti_paper_citations t
  UNION ALL SELECT 'public.lti_paper_views', to_jsonb(t) FROM public.lti_paper_views t
  UNION ALL SELECT 'public.lti_profiles', to_jsonb(t) FROM public.lti_profiles t
  UNION ALL SELECT 'public.lti_provision_batches', to_jsonb(t) FROM public.lti_provision_batches t
  UNION ALL SELECT 'public.lti_records', to_jsonb(t) FROM public.lti_records t
  UNION ALL SELECT 'public.lti_schools', to_jsonb(t) FROM public.lti_schools t
  UNION ALL SELECT 'public.lti_support_messages', to_jsonb(t) FROM public.lti_support_messages t
), expected_relations(relation) AS (
  VALUES ('public.lti_ai_usage'), ('public.lti_paper_bookmarks'),
    ('public.lti_paper_citations'), ('public.lti_paper_views'),
    ('public.lti_profiles'), ('public.lti_provision_batches'),
    ('public.lti_records'), ('public.lti_schools'), ('public.lti_support_messages')
), row_hashes AS (
  SELECT relation, encode(sha256(convert_to(payload::text, 'UTF8')), 'hex') AS hash
  FROM application_rows
), table_comparison AS (
  SELECT e.relation, count(r.hash) AS rows,
    encode(sha256(convert_to(coalesce(string_agg(r.hash, '' ORDER BY r.hash), ''), 'UTF8')), 'hex') AS sha256
  FROM expected_relations e LEFT JOIN row_hashes r USING (relation)
  GROUP BY e.relation
)
SELECT jsonb_build_object(
  'application_tables', (SELECT jsonb_agg(to_jsonb(t) ORDER BY relation) FROM table_comparison t),
  'auth_users', (SELECT jsonb_build_object('rows', count(*), 'ids_sha256',
    encode(sha256(convert_to(coalesce(string_agg(id::text, '' ORDER BY id), ''), 'UTF8')), 'hex')) FROM auth.users),
  'profile_auth_orphans', (SELECT count(*) FROM public.lti_profiles p LEFT JOIN auth.users u ON u.id = p.id WHERE u.id IS NULL),
  'storage', (SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY bucket_id), '[]'::jsonb) FROM (
    SELECT bucket_id, count(*) AS objects,
      sum(coalesce((metadata->>'size')::bigint, 0)) AS bytes,
      encode(sha256(convert_to(string_agg(jsonb_build_array(name, coalesce((metadata->>'size')::bigint, 0))::text, E'\n' ORDER BY name), 'UTF8')), 'hex') AS paths_sizes_sha256
    FROM storage.objects GROUP BY bucket_id
  ) b),
  'public_rls', (SELECT jsonb_agg(jsonb_build_object('table', tablename, 'enabled', rowsecurity) ORDER BY tablename)
    FROM pg_tables WHERE schemaname = 'public'),
  'policies', (SELECT count(*) FROM pg_policies WHERE schemaname IN ('public', 'storage'))
) AS migration_inventory;
