// Public client configuration; access is enforced by Auth and database RLS.
// Safety rule: only known production hostnames talk to the production Supabase project.
// Every Vercel preview / staging branch and localhost uses the isolated staging project.
const PROD_HOSTS = new Set([
  'lti-explore-six.vercel.app',
  'lti-explore-lab-to-impact.vercel.app',
  'lti-explore-git-main-lab-to-impact.vercel.app',
  'lti-explore.vercel.app',
]);

const browserHost = typeof window !== 'undefined' ? window.location.hostname : '';
const explicitEnv = (import.meta as any).env?.VITE_LTI_ENV as string | undefined;
export const APP_ENV: 'production' | 'staging' =
  explicitEnv === 'production' || (explicitEnv !== 'staging' && PROD_HOSTS.has(browserHost))
    ? 'production'
    : 'staging';

export const IS_PRODUCTION = APP_ENV === 'production';

const PROD_SUPABASE_URL = 'https://ozmulwqzybhiekmolvyk.supabase.co';
const PROD_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_BigCuOz8nCUfNGtu8vPpHA_jbRyk67X';

const STAGING_SUPABASE_URL = 'https://bvjjnzhhxieyxkeorurb.supabase.co';
// Staging currently exposes the legacy anon key; this is a browser-safe public key, not a service-role secret.
const STAGING_SUPABASE_PUBLISHABLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2ampuemhoeGlleXhrZW9ydXJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2NTUyMTUsImV4cCI6MjEwNjIzMTIxNX0.M6dcPT01fvT597fWQPUrVOPdp_BhAp7LdL01oDjjmEI';

export const SUPABASE_URL = IS_PRODUCTION ? PROD_SUPABASE_URL : STAGING_SUPABASE_URL;
export const SUPABASE_PUBLISHABLE_KEY = IS_PRODUCTION ? PROD_SUPABASE_PUBLISHABLE_KEY : STAGING_SUPABASE_PUBLISHABLE_KEY;

export const APP_URL =
  typeof window !== 'undefined'
    ? `${window.location.origin}/`
    : 'https://lti-explore-six.vercel.app/';
