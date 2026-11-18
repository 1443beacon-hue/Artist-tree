export const SOURCE_NAMES = { apple: 'Apple Music', spotify: 'Spotify', genius: 'Genius', musicbrainz: 'MusicBrainz' };
import { sameArtist, providerIdsConflict } from './artist-identity.js';
export const EXPANSION_LIMIT = 4;

async function get(path, signal) {
  const response = await fetch(path, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000), headers: { Accept: 'application/json' } });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Restart the local server to enable the API routes.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The music sources could not be reached.');
  return data;
}

export const fetchApiStatus = () => get('/api/status');
export const fetchStartingPoints = () => get('/api/starting-points');
export const searchLiveArtists = (query, signal, scope = 'all') => get(`/api/search?${new URLSearchParams({ q: query, scope })}`, signal);
export const fetchArtist = (id, signal) => get(`/api/artist?${new URLSearchParams({ id })}`, signal);
export async function fetchConnections(id, name, offset, signal, onUpdate) {
  const params = new URLSearchParams({ id, name, offset, limit: EXPANSION_LIMIT });
  if (!onUpdate) return get(`/api/connections?${params}`, signal);
  params.set('stream', '1');
  const response = await fetch(`/api/connections?${params}`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000),
    headers: { Accept: 'application/x-ndjson, application/json' }
  });
  if (response.headers.get('content-type')?.includes('application/json')) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The music sources could not be reached.');
    signal?.throwIfAborted();
    onUpdate(data);
    return data;
  }
  if (!response.ok || !response.headers.get('content-type')?.includes('application/x-ndjson')) throw new Error('Restart the local server to enable progressive credit loading.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', latest, advance = false;
  const accept = line => {
    if (!line.trim()) return;
    signal?.throwIfAborted();
    const data = JSON.parse(line);
    if (data.error) throw new Error(data.error);
    latest = data;
    const needsMore = onUpdate(data);
    // If this page contains only existing people, move to the next cached page
    // now instead of waiting for unrelated identity/portrait enrichment.
    advance = needsMore && data.page.hasMore && Number.isInteger(data.page.nextOffset) && data.page.nextOffset > Number(offset);
  };
  try {
    read: for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 3_000_000) throw new Error('The credit response was too large.');
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        accept(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (advance) { await reader.cancel(); break read; }
      }
      if (done) { accept(buffer); break; }
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  if (!latest) throw new Error('The credit stream ended without a result.');
  return latest;
}

// Overlapping collaborators can fill a page without revealing anyone new.
// Let the caller merge/check each page, with bounded work and forward progress.
export async function fetchConnectionPages(id, name, offset, signal, onPage) {
  let result;
  for (let page = 0; page < 8; page++) {
    signal?.throwIfAborted();
    let continueLoading = false;
    result = await fetchConnections(id, name, offset, signal, update => {
      continueLoading = onPage(update);
      return continueLoading;
    });
    signal?.throwIfAborted();
    const next = result.page.nextOffset;
    if (!continueLoading || !result.page.hasMore || !Number.isSafeInteger(next) || next < offset || (next === offset && !result.page.canContinue)) break;
    offset = next;
  }
  return result;
}

export function requestId(artist) {
  if (artist.apiId) return artist.apiId;
  for (const provider of ['apple', 'spotify', 'genius', 'musicbrainz']) {
    if (artist.providerIds?.[provider]) return `${provider}:${artist.providerIds[provider]}`;
  }
  return null;
}

// Only a provisional direction: actual placement uses the visible graph and
// measured CSS-pixel footprints. Cached/hidden profiles must not occupy space.
function positionFor(anchor, index) {
  const angle = index * 2.399963;
  return { x: anchor.x + Math.cos(angle) * 155, y: anchor.y + Math.sin(angle) * 120 };
}

// Names alone never merge people. Only provider IDs verified by the backend do.
export function mergeLiveGraph(artists, edges, payload, anchorId, { positions = new Map() } = {}) {
  const mapping = new Map(), aliases = new Map();
  const anchor = positions.get(anchorId) || artists[anchorId] || { x: 500, y: 300 };
  const incoming = payload.artists || [];
  for (const [index, raw] of incoming.entries()) {
    const combined = { providerIds: { ...raw.providerIds } };
    const matches = Object.entries(artists).filter(([id, known]) => {
      if (providerIdsConflict(combined, known)) return false;
      if (id !== raw.id && !sameArtist(raw, known)) return false;
      Object.assign(combined.providerIds, known.providerIds);
      return true;
    });
    const id = matches[0]?.[0] || raw.id;
    matches.slice(1).forEach(([duplicate]) => aliases.set(duplicate, id));
    const previous = artists[id];
    const position = previous || positionFor(anchor, index);
    artists[id] = {
      ...previous, ...raw, id, apiId: raw.id,
      initials: raw.name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase(),
      x: position.x, y: position.y, size: previous?.size || 96,
      providerIds: { ...Object.assign({}, ...matches.map(([, profile]) => profile.providerIds)), ...raw.providerIds },
      links: { ...Object.assign({}, ...matches.map(([, profile]) => profile.links)), ...raw.links },
      image: raw.image || previous?.image || '', imageSource: raw.image ? raw.imageSource : previous?.imageSource,
      imageType: raw.image ? raw.imageType : previous?.imageType,
      description: raw.description || (raw.origin === 'live' ? 'Explore source-backed recordings, collaborators, and related artists.' : previous?.description || ''),
      tags: raw.tags?.length ? raw.tags : previous?.tags || ['ARTIST']
    };
    mapping.set(raw.id, id);
  }
  const resolve = id => {
    id = mapping.get(id) || id;
    while (aliases.has(id)) id = aliases.get(id);
    return id;
  };
  for (const edge of edges) { edge.a = resolve(edge.a); edge.b = resolve(edge.b); }
  for (const raw of payload.edges || []) {
    const a = resolve(raw.a), b = resolve(raw.b);
    if (a === b || !artists[a] || !artists[b]) continue;
    let existing = edges.find(edge => edge.type === raw.type && ((edge.a === a && edge.b === b) || (edge.a === b && edge.b === a)));
    const value = { ...raw, a, b, origin: 'live', lx: (artists[a].x + artists[b].x) / 2, ly: (artists[a].y + artists[b].y) / 2 - 15 };
    if (existing) Object.assign(existing, value);
    else edges.push(value);
  }
  aliases.forEach((id, duplicate) => { delete artists[duplicate]; });
  const unique = new Map();
  for (const edge of edges) {
    if (edge.a === edge.b || !artists[edge.a] || !artists[edge.b]) continue;
    const key = `${[edge.a, edge.b].sort().join('|')}|${edge.type}`;
    if (!unique.has(key)) unique.set(key, edge);
    else {
      const previous = unique.get(key);
      previous.evidence = [...(previous.evidence || []), ...(edge.evidence || [])].filter((credit, index, all) => all.findIndex(other => other.url === credit.url && other.work === credit.work && other.provider === credit.provider) === index);
      previous.works = [...new Set([...(previous.works || []), ...(edge.works || [])])];
    }
  }
  edges.splice(0, edges.length, ...unique.values());
  return { aliases, artistId: resolve(payload.artist?.id || anchorId), addedIds: [...new Set(incoming.map(raw => resolve(raw.id)))] };
}
