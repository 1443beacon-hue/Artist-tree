# Artistree deployment status

Updated: 2026-11-24.

## Live service

- Public URL: https://artist-tree.vercel.app/
- Vercel project: `industial-strength/artist-tree` (existing Hobby project).
- Deployed source: `f4e68a8`, from `feat/mobile-credit-preview` (includes the previously verified account implementation).
- Verified preview: `https://artist-tree-7lc3ylawu-industial-strength.vercel.app` (authenticated Vercel CLI checks; preview protection retained).
- Mobile-enabled production deployment: https://vercel.com/industial-strength/artist-tree/8Brj9tyyxDQsgvocUvB7cKESSSUe
- Previous Google-enabled production deployment: https://vercel.com/industial-strength/artist-tree/8a5YfhFjuqKLgu9sUpc3vy3MFy6D
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

## Google sign-in and cloud-save verification

- Dedicated Google Cloud project created: `artistree-515615` (display name `Artistree`). Existing OAuth clients in `My First Project` were left unchanged. No billing-link or paid-API activation action was performed.
- The owner completed the policy/branding setup. Web client `Artistree Web` is registered with JavaScript origin `https://artist-tree.vercel.app` and callback `https://vtttqbfdwhmmzlhiissu.supabase.co/auth/v1/callback`.
- The active client credential was transferred to Supabase provider settings, not source code or local environment files. The initially generated credential was disabled after rotation. Nonce checks remain enabled; email is required.
- Google is enabled in Supabase and `ARTISTREE_AUTH_PROVIDERS=google` is configured for Vercel preview/production. The deployed page exposes Google as available and keeps Kakao/Naver disabled.
- Audience remains **external/testing**, with the owner's Google account added as a test user. The app has not been published for unrestricted Google-account access.
- Verified: public auth settings show Google enabled; Supabase authorizes with the expected Google client/callback and only `email profile` scopes; the live site's button reaches the owner's Google account-permission screen.
- The owner completed Google account approval. The live page verified the session and enabled My account storage.
- Live test snapshot: `Artistree verification 2026-11-23T15:36:58.975Z` (UTC timestamp). Saved five Genius-backed artists, four edges, and a 115% zoom view to the account. Existing browser-map storage remained byte-for-byte unchanged.
- A separate, newly opened tab started with zero artists, verified the existing sign-in, fetched the account list and snapshot from Supabase (two successful Data API GETs), and restored the same five artist IDs, four edges and 115% zoom. Restoration made zero `/api/connections` requests.
- The test snapshot was left in the owner's account for inspection. This verifies fresh-page session persistence and actual cloud save/read/restore, not a second physical device or a second user's isolation behavior.

## Mobile shared-track controls

- Work branch: `feat/mobile-credit-preview`; rollback code tag: `checkpoint-mobile-credit-base` (`3f4919b`).
- Adds a 400ms touch hold, selected-branch **♫ Track info** action, persistent nonmodal bottom information sheet, local portrait callout protection, and a truthful missing-credit state. Existing click-to-expand, desktop cards, recording identity, saved snapshots, and explicit playback rules remain unchanged.
- Local verification: **191 tests passed**, `npm run check`, and `npm run build:vercel` passed. Chromium at 375×760 used real Genius-backed Bladee/Loesoe credits: holding opened “Hotel Breakfast” with Bladee as the recorded parent, release/click was suppressed with the graph unchanged at five artists, short tap expanded, the selected-node button opened the same credit, and Close/outside dismissal worked. No player existed before explicit Open preview; the resulting source-linked YouTube URL had no autoplay parameter.
- The held root showed “No shared track yet” with no preview action. The sheet also fit a 320×400 layout without horizontal overflow. Desktop focus still opened the ordinary non-touch card. Gesture cancellation/multitouch and existing saving/security behavior are covered by automated tests.
- These are Chromium layout/synthetic-pointer checks, **not physical iPhone Safari or Android Chrome certification**. Native image callouts and OS gestures still need checks on those devices.
- Deployed and verified on the canonical production address: at 375×660, a live Bladee branch opened “I’m Goofy” with recorded parent `genius:83959`; releasing/ghost-click left the five-node graph unchanged, created no players, and left browser-save bytes unchanged. Browser console had no errors. Public frontend/new module returned 200, private files returned 404, and auth config still exposed only Google as enabled. Preview checks also verified live search and the new module.

## Still pending

- Google production audience/branding review before opening login to all users.
- Kakao developer-app credentials/consent/callback configuration.
- Naver app credentials and the custom OAuth provider/adapter configuration.
- Live second-account negative-access tests and a physically separate-device test; fresh-tab account restore is already verified.
- Spotify-only OAuth return-context verification.
- Streamlit wrapper and Community Cloud deployment.

Only Google is currently enabled, in testing mode. Google sign-in and authenticated cloud save/restore are live-tested for the configured owner account; this does not certify Kakao/Naver, unrestricted Google access, or every multi-user security scenario. See [AUTH_SETUP.md](AUTH_SETUP.md).

## Rollback

The stable code checkpoint remains `checkpoint-explorer-v5` (`925ac08`); the preconfiguration implementation is `checkpoint-auth-preconfiguration` (`6d814c7`). The pushed `checkpoint-mobile-credit-base` (`3f4919b`) preserves the verified Google/account version before mobile changes. Vercel retains previous deployments. Restoring a deployment does not roll back the database or migrate browser saves; never delete user trees as a deployment rollback step.
