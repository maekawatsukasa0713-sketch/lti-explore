-- Read-only, aggregate-only Auth migration comparison.
-- Run unchanged on both projects at the same final write-frozen snapshot,
-- BEFORE any target sign-in: sign-in can update or rehash Auth records.
-- Compare every row count and SHA256 value, not password-format counts alone.
-- Individual UUIDs, emails, login IDs, password hashes and identity contents
-- are hashed inside SQL and are NEVER returned by this statement.
-- MFA tables, factors, challenges, settings and encryption keys are NOT read.
-- This is not an Auth backup, an MFA migration check, or a successful-login test.
-- Timestamps are normalized to UTC before hashing, independent of session TimeZone.
WITH comparison_rows AS (
  SELECT 'auth.user_passwords' AS relation,
    jsonb_build_array(u.id, u.encrypted_password) AS payload
  FROM auth.users u
  UNION ALL
  SELECT 'auth.user_login_state', jsonb_build_array(
    u.id, u.instance_id, u.aud, u.role, u.email, u.email_confirmed_at AT TIME ZONE 'UTC',
    u.phone, u.phone_confirmed_at AT TIME ZONE 'UTC', u.banned_until AT TIME ZONE 'UTC',
    u.deleted_at AT TIME ZONE 'UTC',
    u.is_sso_user, u.is_anonymous, u.raw_app_meta_data, u.raw_user_meta_data
  )
  FROM auth.users u
  UNION ALL
  SELECT 'auth.identities', to_jsonb(i) || jsonb_build_object(
    'created_at', i.created_at AT TIME ZONE 'UTC',
    'updated_at', i.updated_at AT TIME ZONE 'UTC',
    'last_sign_in_at', i.last_sign_in_at AT TIME ZONE 'UTC'
  ) FROM auth.identities i
  UNION ALL
  SELECT 'public.profile_login_links', jsonb_build_array(
    p.id, p.school_id, p.login_id, u.email, p.role, p.active, p.deleted_at AT TIME ZONE 'UTC',
    p.must_change_password, p.initial_password_expires_at AT TIME ZONE 'UTC',
    p.session_valid_after AT TIME ZONE 'UTC'
  )
  FROM public.lti_profiles p LEFT JOIN auth.users u ON u.id = p.id
), expected_relations(relation) AS (
  VALUES ('auth.user_passwords'), ('auth.user_login_state'),
    ('auth.identities'), ('public.profile_login_links')
), row_hashes AS (
  SELECT relation,
    encode(sha256(convert_to(payload::text, 'UTF8')), 'hex') AS hash
  FROM comparison_rows
), comparisons AS (
  SELECT e.relation, count(r.hash) AS rows,
    encode(sha256(convert_to(
      coalesce(string_agg(r.hash, '' ORDER BY r.hash), ''), 'UTF8'
    )), 'hex') AS sha256
  FROM expected_relations e LEFT JOIN row_hashes r USING (relation)
  GROUP BY e.relation
), password_formats AS (
  SELECT count(*) AS users,
    count(*) FILTER (WHERE encrypted_password ~
      '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$') AS bcrypt_users,
    count(*) FILTER (WHERE encrypted_password IS NULL OR encrypted_password = '') AS without_password,
    count(*) FILTER (WHERE encrypted_password IS NOT NULL AND encrypted_password <> ''
      AND encrypted_password !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$') AS other_password_format
  FROM auth.users
), school_login_checks AS (
  -- Issued school/login IDs are ASCII. Use bytea for the NUL separator because
  -- PostgreSQL text cannot contain NUL; this matches schoolLoginEmail in accounts.tsx.
  SELECT p.id, p.school_id, p.login_id, u.id AS auth_id, u.email,
    encode(sha256(
      convert_to(lower(btrim(p.school_id)), 'UTF8') || decode('00', 'hex') ||
      convert_to(lower(btrim(p.login_id)), 'UTF8')
    ), 'hex') || '@accounts.lti.invalid' AS expected_email
  FROM public.lti_profiles p LEFT JOIN auth.users u ON u.id = p.id
  WHERE p.role IN ('student', 'teacher')
)
SELECT jsonb_build_object(
  'version', 1,
  'comparisons', (SELECT jsonb_agg(to_jsonb(c) ORDER BY relation) FROM comparisons c),
  'password_formats', (SELECT to_jsonb(f) FROM password_formats f),
  'integrity', jsonb_build_object(
    'profile_auth_orphans', (SELECT count(*) FROM public.lti_profiles p
      LEFT JOIN auth.users u ON u.id = p.id WHERE u.id IS NULL),
    'auth_profile_orphans', (SELECT count(*) FROM auth.users u
      LEFT JOIN public.lti_profiles p ON p.id = u.id WHERE p.id IS NULL),
    'identity_auth_orphans', (SELECT count(*) FROM auth.identities i
      LEFT JOIN auth.users u ON u.id = i.user_id WHERE u.id IS NULL),
    'profile_school_orphans', (SELECT count(*) FROM public.lti_profiles p
      LEFT JOIN public.lti_schools s ON s.id = p.school_id
      WHERE p.school_id IS NOT NULL AND s.id IS NULL),
    'school_accounts_without_login_ids', (SELECT count(*) FROM school_login_checks
      WHERE school_id IS NULL OR btrim(school_id) = '' OR login_id IS NULL OR btrim(login_id) = ''),
    'school_login_email_mismatches', (SELECT count(*) FROM school_login_checks
      WHERE school_id IS NOT NULL AND btrim(school_id) <> ''
        AND login_id IS NOT NULL AND btrim(login_id) <> ''
        AND (auth_id IS NULL OR email IS DISTINCT FROM expected_email))
  )
) AS migration_auth_inventory;
