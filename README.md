# Artistree — personal music explorer

A dependency-free Node.js app for exploring music through people and source-linked credits. English UI, Helvetica-first typography, circular nodes, off-white / blue styling, and optional graph animations.

## Run locally

Requires **Node.js 22.12 or later**. No package installation is required. MusicBrainz public reads work without a key; Apple Music, Spotify, and Genius require your own credentials.

**[API_SETUP.md](API_SETUP.md)** explains how to obtain and configure each credential without putting secrets in chat or client code. Copy `.env.example` to `.env` without overwriting an existing file, then fill it locally. Restart after changing it.

```sh
npm run dev
```

Open http://127.0.0.1:3000. Set `PORT` to choose a different port. The server is loopback-only.

```sh
npm run check
npm test
```

## Try the prototype

- Begin with an empty map. Search for an artist (press `/` to focus search), then select a result to show just that person. Suggested names only trigger search.
- Hover or keyboard-focus an artist to enlarge the portrait.
- Nodes gently float on independent rhythms; hovering pauses that node and highlights its connections. Selection adds a soft ripple, and newly revealed nodes unfold without replaying the entire map.
- Small decorative particles travel along connections, with subtle motion on production lines. Use the pause button in the map’s upper-right corner to stop animations. System reduced-motion preferences are respected, and animations pause in background tabs.
- Select an artist to add their documented connections without hiding existing artists or rearranging the original node positions. Selection preserves your current zoom and pan.
- Keep selecting connected people to grow the map. Use **Back** to restore the previous map, including the unexpanded root, or **Start over** to return to the empty search-first screen.
- There is no starting-artist distance or depth restriction in the main explorer. Each clicked person becomes the root of their own credit lookup, and new nodes unfold near that endpoint, even outside the original canvas.
- Genius and MusicBrainz continue through additional song/recording pages on demand instead of stopping after the first batch. Pages containing only already-visible people are skipped within the bounded per-click request budget. A real source exhaustion or error is not replaced with invented connections; Apple and Spotify coverage remains bounded as described in `API_SETUP.md`.
- Search live configured sources (press `/` to focus search). Credentials missing from one source do not disable the others.
- Selecting a search result never starts a credit lookup. Click its node or **Explore connections** to reveal up to four new people. Click the portrait again or **Show 4 more** to continue. Already visible artists are skipped across pages (up to eight page requests per gesture); extra fetched people remain cached for the next click. Known nodes are reused through verified provider IDs or explicit artist-page links, never name-only matching.
- Verified credits stream immediately instead of waiting for every source. Identity enrichment runs alongside known-source lookups; slower songs and optional Spotify portraits fill in afterward. Once four new people appear, keep exploring while additional sources finish. A shared two-minute lookup cache also serves subsequent pages and reconnects; background updates never add extra nodes beyond the gesture budget.
- Credits stream as they are verified: known-source requests run alongside slower cross-source identity checks, Genius songs and MusicBrainz recordings arrive incrementally, and Spotify track credits do not wait for every portrait. Once four new people appear, controls unlock while background updates enrich existing nodes/credits without revealing more. Back, a new selection, or Start over detaches stale updates; the bounded server lookup can finish warming its two-minute cache.
- Spotify search results open a **Spotify-only explorer**, separate from the combined Apple Music / Genius / MusicBrainz map. Spotify artwork is not cropped or animated.
- Collaboration and production relationships appear together; line styles and source credits distinguish them without filter buttons.
- A single line bundles each artist pair. No song names are printed over the graph: select a line to inspect its source credits in the scrollable side panel.
- Collision spacing reserves room for portraits, hover motion, and names in actual screen pixels. Crowded maps can grow beyond the viewport; pan freely or use **Fit graph to view**. Existing positions are kept whenever they do not collide.
- Scroll the mouse wheel or trackpad over the graph to zoom around the pointer (50–250%). Drag the background to pan; the zoom and fit controls remain available.
- Open individual source links or **API status & source credits** for provenance, credential availability, and successful-response status.

## Scope and rights

Tohji, Bladee, Yung Lean, Lucy Bedroque, and prettifun are suggested searches, not preloaded graph data. Missing or failed calls never generate guessed credits. Equal-name results from different services can trigger a bounded identity check, but only verified external IDs or artist-page links authorize merging. Similarity, collaboration, production, and band membership are separate relationships. The app samples records with bounded requests; it does not promise complete discographies.

The proposed **three or more shared composition/production songs** threshold is **not active**. Current adapters sample only a few recordings and do not collect full composition credits. Source records, titles, remasters, album entries, and repeated versions cannot safely be treated as a verified distinct-song total. That filter needs stronger credit coverage and recording/work identity deduplication first.

Live images retain their source; absent images use initials. Spotify's unmodified official attribution logo is included under `assets/`. Before sharing, verify provider conditions for display, cropping, attribution, caching, non-commercial use, and combining sources. API access does not grant blanket image rights. Lyrics and audio are neither scraped nor hosted.

Secrets are server-only. Static files are explicitly allowlisted; `.env`, keys, server code, and API implementation files are not served. Calls have timeouts, short-lived bounded memory caches, sanitized errors, and a MusicBrainz-wide rate-limit queue.

## Local API

- `GET /api/status`: configured flags and actual response/error status, no credentials.
- `GET /api/search?q=Tohji`: source-backed artists and a separate Spotify result collection.
- `GET /api/search?q=Tohji&scope=spotify`: Spotify-only search.
- `GET /api/artist?id=genius:ID`: basic artist information without credit or cross-source lookups.
- `GET /api/connections?id=musicbrainz:MBID&offset=0&limit=4`: sampled relationships and per-source diagnostics.
- `page.canContinue` indicates more upstream song/recording pages, even when all currently cached neighbors have been served. Requesting the next offset at the cache boundary fetches another bounded batch and appends its verified credits.
- Add `&stream=1` for progressive NDJSON snapshots. `pending` identifies background work; page order is append-only as slower sources arrive. Disconnecting the stream detaches that view but allows the bounded shared lookup to finish caching.
- Add `&stream=1` to receive newline-delimited JSON snapshots as credits arrive. `pending: true` means enrichment is ongoing; the final snapshot has `pending: false`. Published neighbors keep their page order as later sources append results. Spotify uses a separate, source-isolated cache.

Artist IDs are `apple:ID`, `spotify:ID`, `genius:ID`, or `musicbrainz:UUID`. Spotify IDs use the dedicated source-only pipeline. `name` can supply context for matching a known external ID to a verified MusicBrainz link; it never authorizes a name-only merge.

## Files

- `index.html`: page structure and accessible controls.
- `styles.css`: responsive visual design, hover states, and reduced-motion support.
- `app.js`: search-first startup, animated graph, live lookup/search UI, and source panels.
- `artist-identity.js`: shared verified provider-ID and artist-page URL matching.
- `live-client.js`: local API client, verified identity matching, and stable positioning for new nodes.
- `graph-layout.js`: screen-pixel collision spacing and per-pair connection bundling.
- `explorer-state.js`: cumulative graph expansion, exploration history, stable node layout, and cursor-anchored zoom math.
- `explorer-state.test.js`: dependency-free tests for expansion, history, layout, and zoom.
- `server.mjs`: loopback HTTP API, request validation, environment loading, and static allowlist.
- `api/providers.mjs`: Apple Music JWT, Spotify Client Credentials, Genius, and MusicBrainz adapters.
- `api/http.mjs`: timeouts, request deduplication, memory cache, safe errors, and MusicBrainz queue.
- `api/service.mjs`: explicit identity resolution, source-separated Spotify results, credit provenance, and paging.
- `api/providers.test.mjs`: fixture-based authentication, adapter, rate-limit, matching, and secret-safety tests. These do not substitute for real authenticated verification.
- `api/service.test.mjs`: progressive delivery, shared cache, cancellation, partial failures, and Spotify isolation.
