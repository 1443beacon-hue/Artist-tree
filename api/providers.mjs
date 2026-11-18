import { readFile } from 'node:fs/promises';
import { createPrivateKey, sign } from 'node:crypto';
import { ApiError, createHttpClient, publicError } from './http.mjs';

export const PROVIDER_NAMES = { apple: 'Apple Music', spotify: 'Spotify', genius: 'Genius', musicbrainz: 'MusicBrainz' };
const apiRoots = { apple: 'https://api.music.apple.com/v1', spotify: 'https://api.spotify.com/v1', genius: 'https://api.genius.com', musicbrainz: 'https://musicbrainz.org/ws/2' };
const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value.slice(0, 1000) : '';
export const normalizeName = value => text(value).normalize('NFKC').trim().toLowerCase();

export function safeUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    url.protocol = 'https:';
    return url.href;
  } catch { return ''; }
}

export function validId(provider, id) {
  if (typeof id !== 'string') return false;
  if (provider === 'apple' || provider === 'genius') return /^\d{1,20}$/.test(id);
  if (provider === 'spotify') return /^[a-zA-Z0-9]{22}$/.test(id);
  if (provider === 'musicbrainz') return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
  return false;
}

export function identitiesFromLinks(links) {
  const ids = {};
  for (const value of Object.values(links || {})) {
    try {
      const url = new URL(value);
      const apple = url.hostname === 'music.apple.com' && url.pathname.match(/\/artist\/(?:[^/]+\/)?(?:id)?(\d+)\/?$/);
      const spotify = url.hostname === 'open.spotify.com' && url.pathname.match(/\/(?:intl-[a-z]+\/)?artist\/([a-zA-Z0-9]{22})\/?$/);
      if (apple) ids.apple = apple[1];
      if (spotify) ids.spotify = spotify[1];
    } catch { /* Ignore non-URL metadata. */ }
  }
  return ids;
}

function artist(provider, id, name, extra = {}) {
  if (!validId(provider, String(id)) || !text(name)) return null;
  const defaultUrl = provider === 'apple' ? `https://music.apple.com/us/artist/${id}`
    : provider === 'spotify' ? `https://open.spotify.com/artist/${id}`
      : provider === 'musicbrainz' ? `https://musicbrainz.org/artist/${id}` : '';
  const url = safeUrl(extra.url || defaultUrl);
  return {
    id: `${provider}:${id}`, name: text(name), providerIds: { [provider]: String(id), ...extra.providerIds },
    links: { [provider]: url, ...extra.links }, image: safeUrl(extra.image), imageSource: extra.image ? PROVIDER_NAMES[provider] : '',
    imageType: extra.imageType || 'Artist photo', tags: list(extra.tags).map(text).filter(Boolean).slice(0, 5),
    description: text(extra.description), url, origin: 'live'
  };
}

const appleArtist = raw => artist('apple', raw?.id, raw?.attributes?.name, {
  url: raw?.attributes?.url,
  image: raw?.attributes?.artwork?.url?.replace('{w}', '800').replace('{h}', '800'),
  tags: ['ARTIST', ...list(raw?.attributes?.genreNames).slice(0, 2)]
});
const spotifyArtist = raw => artist('spotify', raw?.id, raw?.name, {
  url: raw?.external_urls?.spotify, image: list(raw?.images)[0]?.url, tags: ['ARTIST', ...list(raw?.genres).slice(0, 2)]
});
const geniusArtist = raw => artist('genius', raw?.id, raw?.name, { url: raw?.url, image: raw?.image_url, tags: ['ARTIST'] });
const asProducer = person => ({ ...person, tags: [...new Set([...person.tags, 'PRODUCER'])] });
function requireArtist(person) {
  if (!person) throw new ApiError('not_found');
  return person;
}
function mbArtist(raw) {
  const links = {};
  list(raw?.relations).forEach(relation => {
    const url = safeUrl(relation.url?.resource);
    if (!url) return;
    const host = new URL(url).hostname;
    if (host === 'music.apple.com' && /\/artist\//.test(url)) links.apple = url;
    if (host === 'open.spotify.com' && /\/artist\//.test(url)) links.spotify = url;
    if (host === 'genius.com' && /\/artists\//.test(url)) links.genius = url;
  });
  return artist('musicbrainz', raw?.id, raw?.name, {
    links, providerIds: identitiesFromLinks(links), tags: ['ARTIST', raw?.country].filter(Boolean),
    description: raw?.disambiguation
  });
}

function relation(a, b, type, work, provider, url, detail = '') {
  if (!a || !b || a.id === b.id) return null;
  return { a: a.id, b: b.id, type, work: text(work), source: PROVIDER_NAMES[provider], provider,
    url: safeUrl(url), detail: text(detail), origin: 'live' };
}

export async function makeAppleToken(env, now = Date.now) {
  if (env.APPLE_MUSIC_DEVELOPER_TOKEN) return env.APPLE_MUSIC_DEVELOPER_TOKEN;
  if (!env.APPLE_MUSIC_TEAM_ID || !env.APPLE_MUSIC_KEY_ID || !env.APPLE_MUSIC_PRIVATE_KEY_PATH) throw new ApiError('missing_credentials');
  const key = createPrivateKey(await readFile(env.APPLE_MUSIC_PRIVATE_KEY_PATH, 'utf8'));
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new ApiError('authentication');
  const encode = data => Buffer.from(JSON.stringify(data)).toString('base64url');
  const issued = Math.floor(now() / 1000);
  const unsigned = `${encode({ alg: 'ES256', kid: env.APPLE_MUSIC_KEY_ID })}.${encode({ iss: env.APPLE_MUSIC_TEAM_ID, iat: issued, exp: issued + 3600 })}`;
  return `${unsigned}.${sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

export function createProviders({ env = process.env, http = createHttpClient(), now = Date.now } = {}) {
  const configured = {
    apple: Boolean(env.APPLE_MUSIC_DEVELOPER_TOKEN || (env.APPLE_MUSIC_TEAM_ID && env.APPLE_MUSIC_KEY_ID && env.APPLE_MUSIC_PRIVATE_KEY_PATH)),
    spotify: Boolean(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET),
    genius: Boolean(env.GENIUS_ACCESS_TOKEN), musicbrainz: true
  };
  const storefront = /^[a-z]{2}$/.test(env.APPLE_MUSIC_STOREFRONT || '') ? env.APPLE_MUSIC_STOREFRONT : 'us';
  const market = /^[A-Z]{2}$/.test(env.SPOTIFY_MARKET || '') ? env.SPOTIFY_MARKET : 'US';
  let appleToken, spotifyToken, spotifyPending;

  async function authorization(provider) {
    if (!configured[provider]) throw new ApiError('missing_credentials');
    if (provider === 'genius') return `Bearer ${env.GENIUS_ACCESS_TOKEN}`;
    if (provider === 'apple') {
      if (!appleToken || appleToken.until < now()) appleToken = { value: await makeAppleToken(env, now), until: now() + 3_000_000 };
      return `Bearer ${appleToken.value}`;
    }
    if (provider === 'spotify') {
      if (spotifyToken?.until > now()) return `Bearer ${spotifyToken.value}`;
      if (!spotifyPending) spotifyPending = http.request('spotify', 'https://accounts.spotify.com/api/token', {
        method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials'
      }).then(data => {
        if (!data.access_token) throw new ApiError('authentication');
        spotifyToken = { value: data.access_token, until: now() + Math.max(1, (Number(data.expires_in) || 3600) - 60) * 1000 };
        return `Bearer ${data.access_token}`;
      }).finally(() => { spotifyPending = null; });
      return spotifyPending;
    }
    return '';
  }

  async function get(provider, path, params = {}) {
    const url = new URL(`${apiRoots[provider]}${path}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    const headers = { Accept: 'application/json' };
    if (provider === 'musicbrainz') {
      url.searchParams.set('fmt', 'json');
      headers['User-Agent'] = env.MUSICBRAINZ_USER_AGENT || 'Artistree/0.2.0 (local non-commercial music discovery)';
    } else headers.Authorization = await authorization(provider);
    return http.request(provider, url.href, { headers });
  }

  async function partial(tasks) {
    const settled = await Promise.allSettled(tasks);
    return { values: settled.filter(item => item.status === 'fulfilled').map(item => item.value),
      warnings: settled.filter(item => item.status === 'rejected').map(item => publicError(item.reason)) };
  }

  const providers = {
    apple: {
      async search(q) {
        const data = await get('apple', `/catalog/${storefront}/search`, { term: q, types: 'artists', limit: 8 });
        return list(data.results?.artists?.data).map(appleArtist).filter(Boolean);
      },
      async artist(id) {
        const data = await get('apple', `/catalog/${storefront}/artists/${id}`);
        return requireArtist(appleArtist(data.data?.[0]));
      },
      async connections(id) {
        const root = `/catalog/${storefront}/artists/${id}`;
        const selected = await providers.apple.artist(id);
        const found = await partial([
          get('apple', `${root}/view/similar-artists`, { limit: 20 }).then(data => ({ kind: 'similar', data })),
          get('apple', `${root}/view/top-songs`, { limit: 8 }).then(data => ({ kind: 'songs', data }))
        ]);
        const nodes = [selected].filter(Boolean), edges = [];
        for (const result of found.values) {
          if (result.kind === 'similar') list(result.data.data).map(appleArtist).filter(Boolean).forEach(other => {
            nodes.push(other); edges.push(relation(selected, other, 'similar', 'Similar artists', 'apple', selected?.url, 'Apple Music similarity view; not a collaboration credit'));
          });
          else {
            const ids = list(result.data.data).map(song => song.id).slice(0, 8);
            if (!ids.length) continue;
            try {
              const songs = await get('apple', `/catalog/${storefront}/songs`, { ids: ids.join(','), include: 'artists' });
              list(songs.data).forEach(song => {
                const credited = list(song.relationships?.artists?.data).map(appleArtist).filter(Boolean);
                if (!credited.some(person => person.providerIds.apple === id)) return;
                credited.forEach(other => { nodes.push(other); edges.push(relation(selected, other, 'collaboration', song.attributes?.name, 'apple', song.attributes?.url, 'Credited performers on this recording')); });
              });
            } catch (error) { found.warnings.push(publicError(error)); }
          }
        }
        return { artists: nodes, edges: edges.filter(Boolean), warnings: found.warnings, coverage: 'Similar artists and up to 8 top-song credits.' };
      }
    },
    spotify: {
      async search(q) {
        const data = await get('spotify', '/search', { q, type: 'artist', limit: 8, market });
        return list(data.artists?.items).map(spotifyArtist).filter(Boolean);
      },
      async artist(id) { return requireArtist(spotifyArtist(await get('spotify', `/artists/${id}`))); },
      async connections(id, { onProgress } = {}) {
        const [selected, releases] = await Promise.all([
          providers.spotify.artist(id),
          get('spotify', `/artists/${id}/albums`, { include_groups: 'album,single,appears_on', market, limit: 3 })
        ]);
        const found = await partial(list(releases.items).slice(0, 3).map(album => get('spotify', `/albums/${album.id}/tracks`, { market, limit: 10 })));
        const nodes = [selected].filter(Boolean), edges = [];
        found.values.forEach(data => list(data.items).forEach(track => {
          if (!list(track.artists).some(person => person.id === id)) return;
          list(track.artists).map(spotifyArtist).filter(Boolean).forEach(other => {
            nodes.push(other); edges.push(relation(selected, other, 'collaboration', track.name, 'spotify', track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`, 'Credited track artists; producer credits are not exposed here'));
          });
        }));
        const coverage = 'Up to 3 releases, 10 tracks each. No Spotify recommendations or producer endpoint is used.';
        // Track credits are usable before optional collaborator portraits finish.
        onProgress?.({ artists: [...nodes], edges: edges.filter(Boolean), warnings: found.warnings, coverage });
        // Hydrate actual collaborator portraits, but never call restricted recommendations endpoints.
        const ids = [...new Set(nodes.filter(Boolean).map(node => node.providerIds.spotify).filter(other => other !== id))].slice(0, 8);
        const portraits = await partial(ids.map(other => providers.spotify.artist(other)));
        nodes.push(...portraits.values.filter(Boolean));
        return { artists: nodes, edges: edges.filter(Boolean), warnings: [...found.warnings, ...portraits.warnings], coverage };
      }
    },
    genius: {
      async search(q) {
        const data = await get('genius', '/search', { q });
        const candidates = list(data.response?.hits).flatMap(hit => [hit.result?.primary_artist, ...list(hit.result?.primary_artists), ...list(hit.result?.featured_artists)]);
        const unique = new Map(candidates.map(geniusArtist).filter(Boolean).map(node => [node.id, node]));
        return [...unique.values()].sort((a, b) => Number(normalizeName(b.name) === normalizeName(q)) - Number(normalizeName(a.name) === normalizeName(q))).slice(0, 8);
      },
      async artist(id) {
        const data = await get('genius', `/artists/${id}`, { text_format: 'plain' });
        return requireArtist(geniusArtist(data.response?.artist));
      },
      async connections(id, { onProgress, cursor = 1 } = {}) {
        if (!Number.isSafeInteger(cursor) || cursor < 1) throw new ApiError('invalid_request');
        const [selected, songs] = await Promise.all([
          providers.genius.artist(id),
          get('genius', `/artists/${id}/songs`, { sort: 'popularity', per_page: 8, page: cursor })
        ]);
        const nodes = [selected].filter(Boolean), edges = [];
        const coverage = 'Up to 8 songs per batch; continue through the artist’s song pages on demand. Only explicit performer/producer fields, no lyrics scraping.';
        const found = await partial(list(songs.response?.songs).slice(0, 8).map(song => get('genius', `/songs/${song.id}`, { text_format: 'plain' }).then(data => {
          const song = data.response?.song;
          if (!song) return;
          const performers = [...new Map([song.primary_artist, ...list(song.primary_artists), ...list(song.featured_artists)].map(geniusArtist).filter(Boolean).map(person => [person.id, person])).values()];
          const producers = list(song.producer_artists).map(geniusArtist).filter(Boolean).map(asProducer);
          if (performers.some(person => person.providerIds.genius === id)) {
            performers.forEach(other => { nodes.push(other); edges.push(relation(selected, other, 'collaboration', song.title, 'genius', song.url, 'Credited primary or featured artist')); });
            producers.forEach(other => { nodes.push(other); edges.push(relation(selected, other, 'production', song.title, 'genius', song.url, `${other.name} — producer`)); });
          } else if (producers.some(person => person.providerIds.genius === id)) {
            performers.forEach(other => { nodes.push(other); edges.push(relation(selected, other, 'production', song.title, 'genius', song.url, `${selected.name} — producer`)); });
            producers.forEach(other => { nodes.push(other); edges.push(relation(selected, other, 'production', song.title, 'genius', song.url, 'Co-production credit')); });
          }
          onProgress?.({ artists: [...nodes], edges: edges.filter(Boolean), warnings: [], coverage });
        })));
        const next = songs.response?.next_page;
        const nextCursor = Number.isSafeInteger(next) && next > cursor ? next : null;
        return { artists: nodes, edges: edges.filter(Boolean), warnings: found.warnings, coverage, nextCursor };
      }
    },
    musicbrainz: {
      async search(q) {
        const escaped = q.replace(/[+\-!(){}\[\]^"~*?:\\/|&]/g, ' ');
        const data = await get('musicbrainz', '/artist/', { query: `artist:"${escaped}"`, limit: 8 });
        return list(data.artists).map(mbArtist).filter(Boolean);
      },
      async artist(id) { return requireArtist(mbArtist(await get('musicbrainz', `/artist/${id}`, { inc: 'url-rels+artist-rels' }))); },
      async connections(id, { onProgress, cursor = 0 } = {}) {
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new ApiError('invalid_request');
        const raw = await get('musicbrainz', `/artist/${id}`, { inc: 'url-rels+artist-rels' });
        const selected = requireArtist(mbArtist(raw));
        const nodes = [selected].filter(Boolean), edges = [];
        list(raw.relations).filter(item => item.type === 'member of band' && item.artist).forEach(item => {
          const other = mbArtist(item.artist);
          if (other) { nodes.push(other); edges.push(relation(selected, other, 'membership', 'Band membership', 'musicbrainz', selected?.url, 'MusicBrainz band membership relationship')); }
        });
        const recordings = await get('musicbrainz', '/recording', { artist: id, limit: 5, offset: cursor, inc: 'artist-credits' });
        const coverage = 'Up to 5 credited recordings per batch and explicit band membership. Producer-only discographies may be incomplete.';
        const found = await partial(list(recordings.recordings).slice(0, 5).map(recording => get('musicbrainz', `/recording/${recording.id}`, { inc: 'artist-credits+artist-rels' }).then(recording => {
          const performers = list(recording['artist-credit']).map(credit => mbArtist(credit.artist)).filter(Boolean);
          const producers = list(recording.relations).filter(item => item.type === 'producer' && item.artist).map(item => mbArtist(item.artist)).filter(Boolean).map(asProducer);
          const url = `https://musicbrainz.org/recording/${recording.id}`;
          if (performers.some(person => person.providerIds.musicbrainz === id)) {
            performers.forEach(other => { nodes.push(other); edges.push(relation(selected, other, 'collaboration', recording.title, 'musicbrainz', url, 'Recording artist credit')); });
            producers.forEach(other => { nodes.push(other); edges.push(relation(selected, other, 'production', recording.title, 'musicbrainz', url, `${other.name} — producer`)); });
          }
          onProgress?.({ artists: [...nodes], edges: edges.filter(Boolean), warnings: [], coverage });
        })));
        const next = cursor + list(recordings.recordings).length;
        const nextCursor = next > cursor && next < Number(recordings['recording-count']) ? next : null;
        return { artists: nodes, edges: edges.filter(Boolean), warnings: found.warnings, coverage, nextCursor };
      },
      async matchExternal(target) {
        const candidates = (await this.search(target.name)).filter(candidate => normalizeName(candidate.name) === normalizeName(target.name)).slice(0, 2);
        for (const candidate of candidates) {
          const hydrated = await this.artist(candidate.providerIds.musicbrainz);
          const sameId = Object.entries(target.providerIds || {}).some(([provider, id]) => hydrated?.providerIds[provider] === id);
          const sameUrl = Object.entries(target.links || {}).some(([provider, url]) => url && hydrated?.links[provider]?.replace(/\/$/, '').toLowerCase() === url.replace(/\/$/, '').toLowerCase());
          if (sameId || sameUrl) return hydrated;
        }
        return null;
      }
    }
  };
  for (const [key, adapter] of Object.entries(providers)) {
    adapter.configured = configured[key];
    adapter.name = PROVIDER_NAMES[key];
    adapter.status = () => ({ id: key, name: adapter.name, configured: configured[key], ...http.status(key) });
  }
  return providers;
}
