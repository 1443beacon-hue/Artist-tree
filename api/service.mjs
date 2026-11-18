import { ApiError, publicError } from './http.mjs';
import { safeUrl, validId } from './providers.mjs';
import { sameArtist, providerIdsConflict } from '../artist-identity.js';

export function parseArtistId(value) {
  const [provider, id, extra] = String(value || '').split(':');
  if (extra || !validId(provider, id)) throw new ApiError('invalid_request', 'Choose a valid artist identifier.', 400);
  return { provider, id };
}

export function createRegistry() {
  const records = new Map(), aliases = new Map();
  function resolve(id) {
    const seen = new Set();
    while (aliases.has(id) && !seen.has(id)) { seen.add(id); id = aliases.get(id); }
    return id;
  }
  function register(incoming) {
    if (!incoming?.id || !incoming.name) return null;
    const ids = Object.fromEntries(Object.entries(incoming.providerIds || {}).filter(([provider, id]) => validId(provider, id)));
    const known = [];
    const combined = { providerIds: { ...ids } };
    for (const [id, record] of records) {
      if (providerIdsConflict(combined, record)) continue;
      if (id === resolve(incoming.id) || sameArtist(incoming, record)) {
        known.push(id);
        Object.assign(combined.providerIds, record.providerIds);
      }
    }
    const canonical = known[0] || incoming.id;
    const existing = records.get(canonical) || {};
    const others = known.slice(1).map(id => records.get(id));
    let merged = { ...existing, ...incoming, id: canonical, providerIds: {}, links: {} };
    const priorities = { 'Apple Music': 0, Genius: 1, Spotify: 2 };
    for (const record of [existing, ...others, incoming]) {
      if (!record) continue;
      Object.assign(merged.providerIds, record.providerIds);
      Object.entries(record.links || {}).forEach(([key, url]) => { if (safeUrl(url)) merged.links[key] = safeUrl(url); });
    }
    const image = [existing, ...others, incoming].filter(record => record?.image).sort((a, b) => (priorities[a.imageSource] ?? 9) - (priorities[b.imageSource] ?? 9))[0];
    if (image) for (const field of ['image', 'imageSource', 'imageType']) merged[field] = image[field];
    if (!incoming.description) merged.description = existing.description || '';
    merged.tags = [...new Set([...(existing.tags || []), ...(incoming.tags || [])])].slice(0, 6);
    merged.url = merged.links.apple || merged.links.spotify || merged.links.genius || merged.links.musicbrainz || '';
    for (const id of known.slice(1)) { aliases.set(id, canonical); records.delete(id); }
    for (const [provider, id] of Object.entries(merged.providerIds)) {
      const key = `${provider}:${id}`;
      if (key !== canonical) aliases.set(key, canonical);
    }
    records.set(canonical, merged);
    return merged;
  }
  return { register, resolve, get: id => records.get(resolve(id)) };
}

function sameUrl(a, b) {
  return a && b && a.replace(/\/$/, '').toLowerCase() === b.replace(/\/$/, '').toLowerCase();
}

export function createMusicService(providers, { now = Date.now } = {}) {
  const registry = createRegistry();
  const jobs = new Map();
  const status = () => Object.values(providers).map(provider => provider.status());

  async function search(query, { scope = 'all' } = {}) {
    const sources = [], results = [], spotifyArtists = [];
    await Promise.all(Object.entries(providers).map(async ([key, provider]) => {
      if (scope === 'spotify' && key !== 'spotify') return;
      if (!provider.configured) { sources.push({ provider: key, status: 'not_configured' }); return; }
      try {
        const found = await provider.search(query);
        if (key === 'spotify') spotifyArtists.push(...found);
        else found.forEach(artist => { const value = registry.register(artist); if (value) results.push(value); });
        sources.push({ provider: key, status: 'ok', count: found.length });
      } catch (error) { sources.push({ provider: key, status: 'error', ...publicError(error) }); }
    }));
    // Hydrate only likely cross-source duplicates (at most two), then merge
    // through their explicit service links. Equal names only trigger a check.
    const collisions = results.filter(candidate => candidate.providerIds.musicbrainz
      && results.some(other => other.id !== candidate.id && other.name.normalize('NFKC').toLowerCase() === candidate.name.normalize('NFKC').toLowerCase()
        && !other.providerIds.musicbrainz)).slice(0, 2);
    await Promise.all(collisions.map(async candidate => {
      try { registry.register(await providers.musicbrainz.artist(candidate.providerIds.musicbrainz)); }
      catch (error) { sources.push({ provider: 'musicbrainz', status: 'identity_check_unavailable', ...publicError(error) }); }
    }));
    const order = { apple: 0, spotify: 1, genius: 2, musicbrainz: 3 };
    const unique = [...new Set(results.map(artist => registry.resolve(artist.id)))].map(id => registry.get(id));
    unique.sort((a, b) => Number(b.name.toLowerCase() === query.toLowerCase()) - Number(a.name.toLowerCase() === query.toLowerCase())
      || Math.min(...Object.keys(a.providerIds).map(key => order[key])) - Math.min(...Object.keys(b.providerIds).map(key => order[key])));
    return { artists: unique, spotifyArtists, sources, note: 'Spotify results open in a dedicated Spotify-only explorer. Other results merge only through verified identity links.' };
  }

  async function collectSource(job, key, cursor) {
    const identities = job.identities;
    const providerId = identities.get(job.root).providerIds[key];
    const previous = job.outputs.get(key);
    const accept = result => {
      result.artists.forEach(artist => identities.register(artist));
      const artists = [...new Map([...(previous?.artists || []), ...result.artists].map(artist => [artist.id, artist])).values()];
      const edges = [...new Map([...(previous?.edges || []), ...result.edges].map(edge => [
        JSON.stringify([edge.a, edge.b, edge.type, edge.url, edge.work]), edge
      ])).values()];
      job.outputs.set(key, { ...result, artists, edges });
      publish(job);
    };
    job.sources.set(key, { provider: key, status: 'loading' });
    try {
      const result = await providers[key].connections(providerId, { cursor, onProgress: accept });
      if (Number.isSafeInteger(result.nextCursor) && result.nextCursor > (cursor ?? -1)) job.cursors.set(key, result.nextCursor);
      else job.cursors.delete(key);
      job.sources.set(key, { provider: key, status: result.warnings?.length ? 'partial' : 'ok', coverage: result.coverage, warnings: result.warnings || [] });
      accept(result);
    } catch (error) {
      // A failed next page is retryable; do not discard previous real credits.
      job.sources.set(key, { provider: key, status: 'error', ...publicError(error) });
      publish(job);
    }
  }

  async function collect(job, id, name) {
    const native = parseArtistId(id);
    const identities = job.identities;
    let root = identities.get(id);
    if (!root && providers[native.provider].configured) {
      try {
        const hydrated = await providers[native.provider].artist(native.id);
        if (hydrated) root = identities.register(hydrated);
      } catch (error) {
        if (!root && !name) throw error;
      }
    }
    if (!root) {
      if (!name) throw new ApiError('missing_credentials');
      const url = native.provider === 'apple' ? `https://music.apple.com/us/artist/${native.id}`
        : native.provider === 'spotify' ? `https://open.spotify.com/artist/${native.id}`
          : native.provider === 'musicbrainz' ? `https://musicbrainz.org/artist/${native.id}` : '';
      root = identities.register({ id, name, providerIds: { [native.provider]: native.id }, links: { [native.provider]: url }, origin: 'reference', tags: ['ARTIST'] });
    }
    job.root = root.id;
    const tasks = new Map();
    const launchSources = () => {
      root = identities.get(job.root);
      for (const [key, provider] of Object.entries(providers)) {
        if (!provider.configured || (job.spotify ? key !== 'spotify' : key === 'spotify') || tasks.has(key)) continue;
        const providerId = root.providerIds[key];
        if (!providerId) continue;
        const task = collectSource(job, key);
        tasks.set(key, task);
      }
      publish(job);
    };
    // Known IDs can return credits immediately; identity enrichment must not
    // stand between an authenticated source and the first visible connections.
    launchSources();
    if (!job.spotify && !root.providerIds.musicbrainz) {
      try {
        const verified = await providers.musicbrainz.matchExternal(root);
        if (verified) root = identities.register(verified);
      } catch (error) { job.identityWarnings.push({ provider: 'musicbrainz', ...publicError(error) }); }
    }
    // Genius uses a slug in website URLs but a numeric API ID. Resolve it through
    // a search only when an explicit MusicBrainz URL confirms the identity.
    root = identities.get(job.root);
    if (!job.spotify && providers.genius.configured && !root.providerIds.genius && root.links.genius) {
      try {
        const matches = await providers.genius.search(root.name);
        const verified = matches.find(candidate => sameUrl(candidate.links.genius, root.links.genius));
        if (verified) root = identities.register({ ...verified, providerIds: { ...root.providerIds, ...verified.providerIds } });
      } catch (error) { job.identityWarnings.push({ provider: 'genius', ...publicError(error) }); }
    }
    launchSources();
    await Promise.all(tasks.values());
  }

  function publish(job) {
    if (!job.root) return;
    const identities = job.identities;
    const root = identities.get(job.root);
    const grouped = new Map();
    for (const edge of [...job.outputs.values()].flatMap(result => result.edges)) {
      const a = identities.resolve(edge.a), b = identities.resolve(edge.b);
      if (a === b || (a !== root.id && b !== root.id) || !identities.get(a) || !identities.get(b)) continue;
      const key = `${[a, b].sort().join('|')}|${edge.type}`;
      if (!grouped.has(key)) grouped.set(key, { ...edge, a, b, works: [], evidence: [] });
      const group = grouped.get(key);
      if (!group.evidence.some(item => item.url === edge.url && item.provider === edge.provider && item.work === edge.work)) {
        group.evidence.push({ provider: edge.provider, source: edge.source, work: edge.work, url: edge.url, detail: edge.detail });
      }
      if (!group.works.includes(edge.work)) group.works.push(edge.work);
    }
    const ranked = new Map();
    const priority = { production: 3, collaboration: 3, membership: 2, similar: 1 };
    for (const edge of grouped.values()) {
      const neighbor = edge.a === root.id ? edge.b : edge.a;
      ranked.set(neighbor, Math.max(ranked.get(neighbor) || 0, priority[edge.type] || 0));
      edge.work = edge.works.length > 1 ? `${edge.works.length} credited works` : edge.works[0];
      edge.label = edge.type === 'similar' ? 'Similar sound' : edge.work;
    }
    // Keep already published page positions stable when slower sources arrive.
    const neighbors = [...new Set(job.neighbors.map(identities.resolve))].filter(id => id !== root.id && ranked.has(id));
    for (const [id] of [...ranked].sort((a, b) => b[1] - a[1])) if (!neighbors.includes(id)) neighbors.push(id);
    job.neighbors = neighbors;
    const sources = Object.entries(providers).filter(([key]) => !job.spotify || key === 'spotify').map(([key, provider]) => {
      if (!provider.configured) return { provider: key, status: 'not_configured' };
      if (!job.spotify && key === 'spotify') return { provider: key, status: 'separate_view', message: 'Use the dedicated Spotify explorer to view Spotify credits.' };
      return job.sources.get(key) || { provider: key, status: job.pending ? 'checking_identity' : 'not_linked' };
    });
    job.data = { root: root.id, neighbors, edges: [...grouped.values()], sources, identityWarnings: job.identityWarnings };
    for (const listener of job.listeners) listener();
  }

  function connectionJob(id, name) {
    const native = parseArtistId(id);
    const spotify = native.provider === 'spotify';
    const key = spotify ? id : registry.resolve(id);
    let job = jobs.get(key) || [...jobs.values()].find(value => !spotify && !value.spotify && value.root && registry.resolve(value.root) === key);
    if (job && (job.pending || job.until > now())) return job;
    if (jobs.size >= 128) {
      const oldest = [...jobs].find(([, value]) => !value.pending);
      if (!oldest) throw new ApiError('rate_limited');
      jobs.delete(oldest[0]);
    }
    job = { spotify, identities: spotify ? createRegistry() : registry, root: null, outputs: new Map(), sources: new Map(), cursors: new Map(), neighbors: [],
      identityWarnings: [], listeners: new Set(), pending: true, until: 0 };
    jobs.set(key, job);
    job.promise = collect(job, id, name).catch(error => {
      job.error = error;
      jobs.delete(key);
    }).finally(() => {
      job.pending = false;
      job.until = now() + 120_000;
      publish(job);
    });
    return job;
  }

  function continueJob(job, offset) {
    if (job.pending || offset < job.neighbors.length || !job.cursors.size) return;
    job.pending = true;
    const pages = [...job.cursors];
    job.promise = Promise.all(pages.map(([key, cursor]) => collectSource(job, key, cursor))).finally(() => {
      job.pending = false;
      job.until = now() + 120_000;
      publish(job);
    });
    publish(job);
  }

  function connectionPage(job, { offset = 0, limit = 4 } = {}) {
    const data = job.data;
    const identities = job.identities;
    const root = identities.resolve(data.root);
    const knownNeighbors = [...new Set(data.neighbors.map(identities.resolve))].filter(id => id !== root && identities.get(id));
    const neighbors = knownNeighbors.slice(offset, offset + limit);
    const allowed = new Set([root, ...neighbors]);
    return {
      artist: identities.get(root), artists: [...allowed].map(id => identities.get(id)),
      edges: data.edges.map(edge => ({ ...edge, a: identities.resolve(edge.a), b: identities.resolve(edge.b) })).filter(edge => edge.a !== edge.b && allowed.has(edge.a) && allowed.has(edge.b)),
      sources: data.sources, identityWarnings: data.identityWarnings,
      pending: job.pending,
      page: { offset, limit, total: knownNeighbors.length, nextOffset: offset + neighbors.length,
        hasMore: offset + neighbors.length < knownNeighbors.length || job.cursors.size > 0,
        canContinue: job.cursors.size > 0 },
      note: job.spotify ? 'Spotify-only view. Sampled credited track artists, not a complete discography or recommendation list.'
        : 'A bounded sample of available credits, not a complete discography. Similarity is not evidence of collaboration.'
    };
  }

  async function connections(id, options = {}) {
    const job = connectionJob(id, options.name || '');
    continueJob(job, options.offset || 0);
    await job.promise;
    if (job.error) throw job.error;
    return connectionPage(job, options);
  }

  async function streamConnections(id, options, emit, signal) {
    const job = connectionJob(id, options.name || '');
    continueJob(job, options.offset || 0);
    const update = () => { if (job.data && !job.error && !signal?.aborted) emit(connectionPage(job, options)); };
    job.listeners.add(update);
    let abort;
    try {
      update();
      await Promise.race([job.promise, new Promise(resolve => {
        abort = resolve;
        if (signal?.aborted) resolve();
        else signal?.addEventListener('abort', abort, { once: true });
      })]);
      if (job.error && !signal?.aborted) throw job.error;
    } finally {
      job.listeners.delete(update);
      signal?.removeEventListener('abort', abort);
    }
  }
  async function artist(id) {
    const native = parseArtistId(id);
    const profile = await providers[native.provider].artist(native.id);
    return { artist: native.provider === 'spotify' ? profile : registry.register(profile) };
  }
  return { status, search, artist, connections, streamConnections };
}
