# Research screens and AI connection

The public library uses existing `papers` records with status `公開中`. Cards and field counts never seed example papers, views, or likes. The PDF/Word reader uses the authenticated user's existing Storage permissions.

`research-ai` is an authenticated Supabase Edge Function. It validates JWTs through Supabase Auth, checks that the profile is active, and limits `review` to teachers/admins. `verify_jwt=false` is intentional because authentication is performed inside the handler, including the profile check. It does not use the service-role key and does not change RLS or the database schema.

Configure `ANTHROPIC_API_KEY` in the Supabase project's Edge Function Secrets. Do not put this key in GitHub, frontend files, Vite variables, or chat. `ANTHROPIC_MODEL` is optional; the default is `claude-haiku-4-5-20251001`. The configured API account must support this model and have available usage. The authenticated `status` operation returns only a configuration boolean, never a credential.

Requests send the selected manuscript to Anthropic. DOCX is extracted to text in the browser; images and diagrams inside Word are not included. PDF is sent as a document block. Limits are 8 MB/file and 80,000 extracted characters. Password-protected PDFs, very long PDFs, unreadable scans, and provider errors return a visible error instead of fabricated results. If no file exists, the registered abstract can be analyzed and is clearly labeled as abstract-only.

Identical successful requests are cached by authenticated user and input hash for up to one hour in the current function instance. Explicit regeneration bypasses the cache. Results are not written to a shared database. Draft reviews stay in React memory until the teacher sends feedback through the existing workflow. The per-instance hourly throttle is best effort, not a global billing quota; configure provider-level usage limits for production.

Validation performed: production TypeScript/Vite build; SSR for published-only cards and three review panels; mocked function tests for missing auth, inactive accounts, student review denial, missing key, malformed input/output, and cached requests. A live model response and authenticated browser flow still need verification with the configured API account.
