import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config';
// Capture recovery intent before the auth client consumes and removes the URL hash.
export const recoveryOnArrival = typeof window !== 'undefined' && (new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery' || new URLSearchParams(window.location.search).get('flow') === 'recovery');
if (recoveryOnArrival) { const url = new URL(window.location.href); url.searchParams.set('flow', 'recovery'); window.history.replaceState(null, '', url); }
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {auth: {persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
