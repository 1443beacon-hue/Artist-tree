# Artistree deployment status

Updated: 2026-11-24.

## Live service

- Public URL: https://artist-tree.vercel.app/
- Vercel project: `industial-strength/artist-tree` (existing Hobby project).
- Deployed source: `0fcb8c6`, from `feat/vercel-streamlit-deploy` (runtime implementation checkpoint `6d814c7`).
- Verified preview: `https://artist-tree-bbmuwr8ad-industial-strength.vercel.app`.
- Production promotion: https://vercel.com/industial-strength/artist-tree/FGkTBHVmiHMLZYSD8wxJwAAsujuH
- Google-enabled production deployment: https://vercel.com/industial-strength/artist-tree/8a5YfhFjuqKLgu9sUpc3vy3MFy6D
- `main` and its Git integration were not changed. A future push to `main` can deploy that branch's older implementation; merge/review deployment work before doing so.

Verified on Vercel: frontend/API return 200, live Bladee search, progressive Genius expansion revealing four new people, disabled MusicBrainz, and 404 responses for environment files, private server modules, package metadata, and presentation files.

Genius/Spotify credentials are Vercel Secret environment variables. Supabase URL/publishable key and the canonical app origin are public configuration. No service-role key is used. Preview and production configurations were registered separately from the ignored local environment files.

MusicBrainz remains disabled because the deployment has no distributed rate-limit queue. Application caches and request quotas are per instance, not a global abuse-control system.

## Dedicated Supabase project

- Dashboard: https://supabase.com/dashboard/project/vtttqbfdwhmmzlhiissu
- API URL: https://vtttqbfdwhmmzlhiissu.supabase.co
- Applied `supabase/migrations/20261123133854_artistree_saved_trees.sql` through this project's Dashboard SQL editor in a transaction, after confirming its public/private application schemas had no tables.
- Verified remotely: table exists, RLS and FORCE RLS enabled, three ownership policies, no anonymous SELECT grant, no authenticated UPDATE grant. An actual unauthenticated Data API read returns 401 / `42501`.
- Advisor Center showed no warning/error items; its all-severity view showed an unused-index informational item for the new, empty table. The index was retained.
- Auth Site URL and explicit redirect allowlist: `https://artist-tree.vercel.app/`, saved and read back from project configuration.
- Existing unrelated project `vetuthuiokrjvchzrymf` was not modified. The pre-existing Supabase MCP connection may still point there: verify the project before any MCP database action.

**Migration history:** Dashboard SQL execution does not register a CLI migration-history entry. Before a future CLI `db push`, reconcile/mark version `20261123133854` as applied using the supported CLI migration-repair workflow, after linking and verifying this exact project. Do not blindly rerun the CREATE statements or write migration history manually.

## Google setup completed; user sign-in approval pending

- Dedicated Google Cloud project created: `artistree-515615` (display name `Artistree`). Existing OAuth clients in `My First Project` were left unchanged. No billing-link or paid-API activation action was performed.
- The owner completed the policy/branding setup. Web client `Artistree Web` is registered with JavaScript origin `https://artist-tree.vercel.app` and callback `https://vtttqbfdwhmmzlhiissu.supabase.co/auth/v1/callback`.
- The active client credential was transferred to Supabase provider settings, not source code or local environment files. The initially generated credential was disabled after rotation. Nonce checks remain enabled; email is required.
- Google is enabled in Supabase and `ARTISTREE_AUTH_PROVIDERS=google` is configured for Vercel preview/production. The deployed page exposes Google as available and keeps Kakao/Naver disabled.
- Audience remains **external/testing**, with the owner's Google account added as a test user. The app has not been published for unrestricted Google-account access.
- Verified: public auth settings show Google enabled; Supabase authorizes with the expected Google client/callback and only `email profile` scopes; the live site's button reaches the owner's Google account-permission screen.
- **Not yet verified:** the owner must approve the account-permission screen to complete the first sign-in. Session creation and authenticated cloud tree saving are not claimed as successful yet.

## Still pending

- Completion of the owner's Google sign-in and authenticated cloud-save tests.
- Google production audience/branding review before opening login to all users.
- Kakao developer-app credentials/consent/callback configuration.
- Naver app credentials and the custom OAuth provider/adapter configuration.
- Authenticated A/B account isolation and cross-device tree-saving tests.
- Spotify-only OAuth return-context verification.
- Streamlit wrapper and Community Cloud deployment.

Only Google is currently enabled, in testing mode. Successful deployment, redirect and database checks are **not** proof of completed social login or authenticated cloud saving. See [AUTH_SETUP.md](AUTH_SETUP.md).

## Rollback

The stable code checkpoint remains `checkpoint-explorer-v5` (`925ac08`); the preconfiguration implementation is `checkpoint-auth-preconfiguration` (`6d814c7`). Vercel retains previous deployments. Restoring a deployment does not roll back the database or migrate browser saves; never delete user trees as a deployment rollback step.
