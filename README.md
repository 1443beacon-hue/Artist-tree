# Artistree — personal music explorer

**Live:** https://artist-tree.vercel.app/ · [Deployment status](DEPLOYMENT.md). Google sign-in and account tree save/restore are live-tested in testing mode. Kakao/Naver and unrestricted Google access remain pending; guest exploration and browser saving are available.

A Node.js app for exploring music through people and source-linked credits. English UI, Helvetica-first typography, circular nodes, off-white / blue styling, optional graph animations, and optional account-based tree saving.

## Run locally

Requires **Node.js 22.12 or later** and `npm ci`. MusicBrainz public reads work without a key locally; Apple Music, Spotify, and Genius require your own credentials. The public Vercel configuration disables MusicBrainz until a shared rate-limit queue is available.

**[API_SETUP.md](API_SETUP.md)** explains how to obtain and configure each credential without putting secrets in chat or client code. Copy `.env.example` to `.env` without overwriting an existing file, then fill it locally. Restart after changing it.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. Set `PORT` to choose a different port. The server is loopback-only.

```sh
npm run check
npm test
```

## Try the prototype

- Begin with an empty map. Search for an artist (press `/` to focus search), then select a result to show just that person. Suggested names only trigger search.
- Five circular, source-resolution Genius portrait chips follow a manually checked **Artists / Today** chart snapshot, with its check date shown. Translation/editorial accounts are excluded; original chart positions are preserved. This is neither a live feed nor search-frequency data. After 24 hours, or if the snapshot/profiles are unavailable, the chips become explicitly unranked suggestions.
- The introductory copy is replaced with a randomly branching decorative network. It recycles leaves at 16 active dots instead of growing the DOM indefinitely, represents no artist credits, and follows the motion toggle, reduced-motion preferences, and background-tab pause.
- Hover or keyboard-focus an artist to enlarge the portrait.
- Hover a branch portrait (or keyboard-focus it) to see one **shared track** with the person who opened that branch. Everyone **already on the map** with verified credits for that same source recording is highlighted together; unrelated portraits/lines gently recede without changing the layout. Only existing lines carrying that recording's evidence are highlighted, never invented links between all participants.
- The unscaled **Shared Track** card shows the real title, credited map-participant count, name chips, and source. Names stay in a stable order; the hovered person's chip gets a subtle blue tint. Dense groups show up to six names and an honest “more on map” count while highlighting every verified member. This is not a claim to show a track's complete credits. Cards fade in/out and avoid nearby portraits where space allows.
- Track grouping uses source-specific recording IDs/URLs, not song titles, artist names, similarity, membership, or grouped “credited works” labels. Tracking parameters and equivalent regional/catalogue URLs are normalized, but different recordings, remixes, and providers remain separate without explicit identity evidence. Hovering makes no API calls or extra image requests. Pointer exit, drag/pan/zoom, breadcrumbs, and context changes clear the transient hover group. Reduced-motion settings are respected; touch taps retain click-to-explore, and full source links remain in the connection panel.
- The card's **Open preview** button opens a persistent shared-track panel with verified map participants, credit-source link, and one official embedded player. A 200ms pointer bridge lets you move from a portrait to the card without losing it; keyboard users can press **P** on a focused branch artist. Hover never starts audio or a preview lookup. The card closes at handoff, while the selected track group stays highlighted; another hover can temporarily preview another group. Breadcrumb previews temporarily take priority.
- Playback starts only through the official player's own controls; the card action does **not** promise automatic playback. Genius recordings use a YouTube video explicitly linked in the exact song's API metadata, with the official privacy-enhanced embed set to start at 0 and stop at 30 seconds. A source-supplied Apple Music song ID is the alternative; MusicBrainz can supply an explicit Apple song URL. Apple IDs are checked with an exact-ID catalogue lookup, never a name-based replacement. Spotify embeds remain exclusive to the Spotify-only explorer.
- Player availability is service/region/rights dependent. Apple/Spotify control their own preview length and sign-in behavior, and Apple sign-in can enable full tracks. Unavailable mappings show an honest fallback; network errors offer retry and source links. There is no audio extraction, proxy, download, autoplay, promotional-audio reuse, or saved playback state. Opening an official player contacts that third party only after selection. Switching tracks destroys the previous iframe; closing the panel, selecting an artist/line/breadcrumb, Back, reset, and map opening destroy it and cancel stale checks. Escape in the main document closes it; keys inside cross-origin players are controlled by that service.
- On the experimental `feat/elastic-explorer` branch, drag an artist portrait to reposition it: nearby connected nodes follow with damped springs and the connection paths move with them. Portraits can also collide with spatial neighbors even without a shared credit; collision motion never creates graph relationships. Dropping keeps the new position and locally clears overlaps; dragging does not select, expand, or make API requests. Press Escape to cancel a drag, or use **Shift + arrow keys** on a focused node to reposition it.
- New branches are placed close to the clicked artist using only the **currently visible** graph and measured CSS-pixel portrait/name footprints. Hidden cached profiles and stale coordinates from prior searches do not reserve space. Open space leaves existing nodes unchanged; dense local clusters yield gently rather than sending the entire new branch far away.
- New portraits unfold toward their targets; nearby nodes push, rebound, and pull through damped springs. A spatial grid limits collision checks to nearby portraits. Motion settles and stops (with a four-second safety deadline after an interaction), pauses in background tabs, and respects the motion toggle and system reduced motion. Spotify-only artwork keeps its non-elastic behavior.
- The selected artist and direct neighbors stay bright. Nodes two or more visible graph links away are shadowed (more deeply beyond two links), along with their connections; they remain clickable and recover contrast on hover/focus. Selecting another artist recomputes this focus neighborhood. Spotify artwork remains untinted and does not use elastic following.
- Clicking an artist centers their portrait in the graph viewport with a short camera pan, while keeping the current zoom unchanged. This also works for cached/exhausted nodes and while a lookup is pending. New branches do not fit or zoom the whole map away from that person. Manual pan, zoom, fit, or node dragging cancels pending centering, including late API updates; motion pause/reduced motion uses an immediate move instead of animation.
- A slim **YOUR PATH** breadcrumb row follows the actual explored branch. Hover or keyboard-focus a name to highlight the verified path to it. Clicking a breadcrumb only selects and centers that person: it never expands the graph or requests credits. Sibling jumps use their recorded discovery route instead of inventing a direct connection. Back restores both the view state and its path.
- The toolbar **Save** bookmark opens a small, non-modal popover (icon-only on mobile). Name the current map, or open **Saved maps**. Each save creates a separate local snapshot of visible artists, credit provenance, positions, path, and camera; opening it makes no credit API calls and starts a fresh Back history. It does not save authentication, pending requests, full upstream responses, or image bytes.
- **This browser** saves keep their original `localStorage` keys and exact-origin behavior. `localhost` and `127.0.0.1`, ports, and profiles have separate storage. Clearing site data deletes these bookmarks. Optional **My account** saving uses a dedicated Supabase project with owner-only RLS and explicit per-map copying from browser saves; login never uploads local maps automatically. Main and Spotify snapshots remain isolated, with 20 maps per owner/view and 500 visible artists per main snapshot (20 on Spotify). Delete requires an explicit second click and does not delete the open graph. See **[AUTH_SETUP.md](AUTH_SETUP.md)**: Google account saving/restoration is live-tested for the configured test account. The Kakao/Naver hooks exist, but their developer-app/provider setup and live tests are still pending.
- Nodes gently float on independent rhythms; hovering pauses that node and highlights its connections. Selection adds a soft ripple, and newly revealed nodes unfold without replaying the entire map.
- Small decorative particles travel along connections, with subtle motion on production lines. Use the pause button in the map’s upper-right corner to stop animations. System reduced-motion preferences are respected, and animations pause in background tabs.
- Select an artist to add their documented connections without hiding existing artists or globally rearranging the map. Only crowded local neighbors move to make room. Selection centers the clicked portrait by panning the camera, without changing the zoom or relocating the graph itself.
- Keep selecting connected people to grow the map. Use **Back** to restore the previous map, including the unexpanded root, or **Start over** to return to the empty search-first screen.
- There is no starting-artist distance or depth restriction in the main explorer. Each clicked person becomes the root of their own credit lookup, and new nodes unfold near that endpoint, even outside the original canvas.
- Genius and MusicBrainz continue through additional song/recording pages on demand instead of stopping after the first batch. Pages containing only already-visible people are skipped within the bounded per-click request budget. A real source exhaustion or error is not replaced with invented connections; Apple and Spotify coverage remains bounded as described in `API_SETUP.md`.
- Search live configured sources (press `/` to focus search). Credentials missing from one source do not disable the others.
- Selecting a search result never starts a credit lookup. Click its node or **Explore connections** to reveal up to four new people. Click the portrait again or **Show 4 more** to continue. Already visible artists are skipped across pages (up to eight page requests per gesture); extra fetched people remain cached for the next click. Known nodes are reused through verified provider IDs or explicit artist-page links, never name-only matching.
- Verified credits stream immediately instead of waiting for every source. Identity enrichment runs alongside known-source lookups; slower songs and optional Spotify portraits fill in afterward. Once four new people appear, keep exploring while additional sources finish. A shared two-minute lookup cache also serves subsequent pages and reconnects; background updates never add extra nodes beyond the gesture budget.
- A thin, indeterminate ring and **Looking up credits…** label identify the node currently being queried. After four people are ready, a quieter **Checking sources…** ring indicates remaining background enrichment without blocking exploration. There are no invented percentages or completion estimates.
- Newly revealed source-backed collaboration, production, and membership connections receive one short outward light pulse. Similarity suggestions, errors, history restoration, and repeated enrichment do not trigger discovery pulses. Previously verified cached connections may pulse when deliberately revealed again, without pretending to perform a new lookup. Pause/reduced motion preserves static lookup status but suppresses discovery motion; cancellation, Back, switching artists, and reset clean up pending indicators and pulses.
- Credits stream as they are verified: known-source requests run alongside slower cross-source identity checks, Genius songs and MusicBrainz recordings arrive incrementally, and Spotify track credits do not wait for every portrait. Once four new people appear, controls unlock while background updates enrich existing nodes/credits without revealing more. Back, a new selection, or Start over detaches stale updates; the bounded server lookup can finish warming its two-minute cache.
- Spotify search results open a **Spotify-only explorer**, separate from the combined Apple Music / Genius / MusicBrainz map. Spotify artwork is not cropped or animated.
- Collaboration and production relationships appear together; line styles and source credits distinguish them without filter buttons.
- A single line bundles each artist pair. No song names are printed over the graph: select a line to inspect its source credits in the scrollable side panel.
- Collision spacing reserves room for portraits, hover motion, and names in actual screen pixels. Distances are display choices, not measures of musical similarity or credit strength. Crowded maps can still grow beyond the viewport; pan freely or use **Fit graph to view**. Existing positions are kept whenever they do not collide.
- Scroll the mouse wheel or trackpad over the graph to zoom around the pointer (50–250%). Drag the background to pan; the zoom and fit controls remain available.
- Open individual source links or **API status & source credits** for provenance, credential availability, and successful-response status.

## Scope and rights

The starting portrait chips only trigger searches, not preloaded artist graphs. Tohji, Bladee, Yung Lean, Lucy Bedroque, and prettifun are the unranked fallback suggestions when a current chart snapshot is unavailable. Missing or failed calls never generate guessed credits. Equal-name results from different services can trigger a bounded identity check, but only verified external IDs or artist-page links authorize merging. Similarity, collaboration, production, and band membership are separate relationships. The app samples records with bounded requests; it does not promise complete discographies.

The proposed **three or more shared composition/production songs** threshold is **not active**. Current adapters sample only a few recordings and do not collect full composition credits. Source records, titles, remasters, album entries, and repeated versions cannot safely be treated as a verified distinct-song total. That filter needs stronger credit coverage and recording/work identity deduplication first.

Live images retain their source; absent images use initials. Spotify's unmodified official attribution logo is included under `assets/`. Before sharing, verify provider conditions for display, cropping, attribution, caching, non-commercial use, and combining sources. API access does not grant blanket image rights. Lyrics and audio are neither scraped nor hosted.

The stable pre-deployment player/presentation checkpoint is **`checkpoint-explorer-v5`** (`925ac08`), already pushed on `feat/track-preview-player`. Deployment/account work is isolated on `feat/vercel-streamlit-deploy`; the stable checkpoint and `main` are unchanged.

Secrets are server-only. Static files are explicitly allowlisted; `.env`, keys, server code, and API implementation files are not served. Calls have timeouts, short-lived bounded memory caches, sanitized errors, and a MusicBrainz-wide rate-limit queue.

## Local API

- `GET /api/status`: configured flags and actual response/error status, no credentials.
- `GET /api/starting-points`: five Genius profiles, original chart positions (or `null` for suggestions), dated snapshot provenance, and `live: false`. Hidden and not requested by the Spotify-only explorer.
- `GET /api/search?q=Tohji`: source-backed artists and a separate Spotify result collection.
- `GET /api/search?q=Tohji&scope=spotify`: Spotify-only search.
- `GET /api/artist?id=genius:ID`: basic artist information without credit or cross-source lookups.
- `GET /api/track-preview?provider=genius&url=ENCODED_RECORDING_URL&scope=main`: explicit-action-only, validated official player metadata or an unavailable result. Only exact Genius song-URL matches and explicit catalogue/media links qualify. Main/Spotify scopes cannot cross. It returns no media bytes or credentials; bounded metadata caching coalesces duplicate checks.
- `GET /api/connections?id=musicbrainz:MBID&offset=0&limit=4`: sampled relationships and per-source diagnostics.
- `page.canContinue` indicates more upstream song/recording pages, even when all currently cached neighbors have been served. Requesting the next offset at the cache boundary fetches another bounded batch and appends its verified credits.
- Add `&stream=1` for progressive NDJSON snapshots. `pending` identifies background work; page order is append-only as slower sources arrive. Disconnecting the stream detaches that view but allows the bounded shared lookup to finish caching.
- Add `&stream=1` to receive newline-delimited JSON snapshots as credits arrive. `pending: true` means enrichment is ongoing; the final snapshot has `pending: false`. Published neighbors keep their page order as later sources append results. Spotify uses a separate, source-isolated cache.

Artist IDs are `apple:ID`, `spotify:ID`, `genius:ID`, or `musicbrainz:UUID`. Spotify IDs use the dedicated source-only pipeline. `name` can supply context for matching a known external ID to a verified MusicBrainz link; it never authorizes a name-only merge.

## Files

- `index.html`: page structure and accessible controls.
- `styles.css`: responsive visual design, hover states, and reduced-motion support.
- `app.js`: search-first startup, animated graph, live lookup/search UI, and source panels.
- `intro-network.js`: bounded decorative growth and shared pause controls.
- `lookup-feedback.js`: honest lookup phases, credit-backed discovery eligibility, and bounded one-shot pulse cleanup.
- `credit-preview.js`: branch-parent shared-track selection, recording-identity-based participant/edge groups, safe provenance, responsive tooltip placement, and cancellable hover/focus transitions.
- `track-player.js`: allowlisted official embeds, persistent selected-track panel, stale-check cancellation, and destructive iframe teardown on switch/close.
- `saved-maps.js`: versioned, allowlisted local snapshots, source isolation, safe URL/identity validation, and quota-safe storage.
- `saved-maps-ui.js`: asynchronous browser/account popover, named snapshots, dated lists, explicit deletion and opt-in local-map copying.
- `account-session.js`, `account-ui.js`: optional Google/Kakao/Naver login, PKCE callback cleanup, verified-user UI, login drafts, safe redirects and full-site sign-in from embeds.
- `cloud-maps.js`: owner/view-scoped Supabase access using the existing snapshot whitelist and account-switch guards.
- `api/auth-config.mjs`, `api/naver-auth.mjs`: public-only configuration and a bounded, encrypted-state Naver OAuth adapter; no Supabase service-role key is used.
- `supabase/migrations/`: owner-protected, immutable saved trees and server-enforced limits. The dedicated project's applied version and Dashboard/CLI history caveat are recorded in `DEPLOYMENT.md`.
- `data/genius-artist-chart.json`: manually checked daily chart snapshot; see `API_SETUP.md` for replacement and expiry rules.
- `artist-identity.js`: shared verified provider-ID and artist-page URL matching.
- `live-client.js`: local API client, verified identity matching, and stable positioning for new nodes.
- `graph-layout.js`: compact visible-neighbor placement, local pressure relief, screen-pixel collision spacing, and per-pair connection bundling.
- `graph-interaction.js`: bounded local spring/collision motion, visible-hop distances, pointer-to-world coordinates, and zoom-preserving portrait centering.
- `graph-interaction.test.js`: dependency-free tests for dragging physics, settling, hop-based focus, zoom/pan coordinates, and camera centering.
- `explorer-state.js`: cumulative graph expansion, exploration history, stable node layout, and cursor-anchored zoom math.
- `explorer-state.test.js`: dependency-free tests for expansion, history, layout, and zoom.
- `server.mjs`: loopback HTTP API, request validation, environment loading, and static allowlist.
- `api/providers.mjs`: Apple Music JWT, Spotify Client Credentials, Genius, and MusicBrainz adapters.
- `api/http.mjs`: timeouts, request deduplication, memory cache, safe errors, and MusicBrainz queue.
- `api/service.mjs`: explicit identity resolution, source-separated Spotify results, credit provenance, and paging.
- `api/starting-points.mjs`: snapshot validation, verified profile hydration, expiry-limited caching, and honest fallback suggestions.
- `api/track-preview.mjs`: exact source recording-to-player resolution, source isolation, stale Apple-ID checks, and bounded metadata caching.
- `api/providers.test.mjs`: fixture-based authentication, adapter, rate-limit, matching, and secret-safety tests. These do not substitute for real authenticated verification.
- `api/service.test.mjs`: progressive delivery, shared cache, cancellation, partial failures, and Spotify isolation.
