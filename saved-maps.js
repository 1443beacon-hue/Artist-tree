const providers = ['apple', 'genius', 'musicbrainz', 'spotify'];
const types = ['collaboration', 'production', 'membership', 'similar'];
const ID = /^(?:(?:apple|genius):\d+|spotify:[A-Za-z0-9]{22}|musicbrainz:[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})$/;
const MAX_MAPS = 20, MAX_TEXT = 2_000_000;
const text = (value, limit = 2000) => typeof value === 'string' ? value.slice(0, limit).replace(/[\u0000-\u001f]/g, '') : '';
const finite = (value, limit = 1_000_000) => Number.isFinite(value) && Math.abs(value) <= limit;
function url(value) {
  if (!value) return '';
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || value.length > 4096) throw new Error('Invalid URL');
  return parsed.href;
}
function evidence(raw, provider) {
  const source = raw.provider || provider;
  if (!providers.includes(source)) throw new Error('Invalid source');
  return { provider: source, source: text(raw.source, 80), type: types.includes(raw.type) ? raw.type : undefined,
    work: text(raw.work, 1000), detail: text(raw.detail), url: url(raw.url), origin: raw.origin === 'live' ? 'live' : 'reference' };
}

// A strict, visible-only snapshot whitelist: no tokens, raw API responses,
// loading controllers, pending requests, or image bytes are persisted.
export function validateSavedMap(value, scope) {
  try {
    if (!value || value.version !== 1 || value.scope !== scope || !['main', 'spotify'].includes(scope)
      || typeof value.id !== 'string' || !/^[\w-]{1,80}$/.test(value.id) || !text(value.name, 80).trim() || !Number.isFinite(Date.parse(value.savedAt))) return null;
    const graph = value.graph;
    if (!Array.isArray(graph?.artists) || !graph.artists.length || graph.artists.length > (scope === 'spotify' ? 20 : 500)
      || !Array.isArray(graph.edges) || graph.edges.length > 2000) return null;
    const artists = graph.artists.map(raw => {
      if (!ID.test(raw.id) || !text(raw.name, 200).trim() || !finite(raw.x) || !finite(raw.y)
        || (scope === 'spotify' ? !raw.id.startsWith('spotify:') : raw.id.startsWith('spotify:') || raw.imageSource === 'Spotify')) throw new Error('Invalid artist');
      const providerIds = {};
      for (const provider of providers) if (raw.providerIds?.[provider]) {
        if (!ID.test(`${provider}:${raw.providerIds[provider]}`)) throw new Error('Invalid identity');
        providerIds[provider] = String(raw.providerIds[provider]);
      }
      const links = {};
      for (const provider of providers) if (raw.links?.[provider]) links[provider] = url(raw.links[provider]);
      const apiId = ID.test(raw.apiId) ? raw.apiId : raw.id;
      if (scope === 'spotify' ? !apiId.startsWith('spotify:') : apiId.startsWith('spotify:')) throw new Error('Mixed source');
      return { id: raw.id, apiId, name: text(raw.name, 200),
        initials: text(raw.initials, 8), providerIds, links, url: url(raw.url), image: url(raw.image),
        imageSource: text(raw.imageSource, 80), imageType: text(raw.imageType, 100),
        description: text(raw.description), tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 12).map(tag => text(tag, 80)) : ['ARTIST'],
        origin: ['live', 'reference', 'pending'].includes(raw.origin) ? raw.origin : 'reference',
        x: raw.x, y: raw.y, size: finite(raw.size, 240) && raw.size >= 48 ? raw.size : 96 };
    });
    const ids = new Set(artists.map(artist => artist.id));
    if (ids.size !== artists.length) return null;
    const edges = graph.edges.map(raw => {
      if (!ids.has(raw.a) || !ids.has(raw.b) || raw.a === raw.b || !types.includes(raw.type)
        || (scope === 'spotify' ? raw.provider !== 'spotify' : raw.provider === 'spotify')) throw new Error('Invalid edge');
      return { ...evidence(raw), a: raw.a, b: raw.b, type: raw.type,
        works: Array.isArray(raw.works) ? raw.works.slice(0, 50).map(work => text(work, 1000)) : [],
        evidence: Array.isArray(raw.evidence) ? raw.evidence.slice(0, 50).map(item => {
          const itemProvider = item.provider || raw.provider;
          if (scope === 'spotify' ? itemProvider !== 'spotify' : itemProvider === 'spotify') throw new Error('Mixed source');
          return evidence(item, raw.provider);
        }) : [] };
    });
    const state = graph.explorer;
    const pathValid = path => Array.isArray(path) && path.length > 0 && path.length <= ids.size
      && new Set(path).size === path.length && path.every((id, index) => ids.has(id) && (index === 0
        || edges.some(edge => edge.a === path[index - 1] && edge.b === id || edge.b === path[index - 1] && edge.a === id)));
    if (!state || !ids.has(state.selected) || !Array.isArray(state.visible) || state.visible.length !== ids.size || new Set(state.visible).size !== ids.size
      || !state.visible.every(id => ids.has(id)) || !Array.isArray(state.expanded) || !state.expanded.every(id => ids.has(id))
      || !pathValid(state.trail) || state.trail.at(-1) !== state.selected || !Array.isArray(state.routes)
      || state.routes.length > ids.size || !state.routes.every(([id, path]) => ids.has(id) && pathValid(path) && path.at(-1) === id)) return null;
    const camera = value.camera;
    if (!camera || !Number.isFinite(camera.zoom) || camera.zoom < .5 || camera.zoom > 2.5
      || !finite(camera.pan?.x, 10_000_000) || !finite(camera.pan?.y, 10_000_000)
      || !finite(camera.width, 10000) || camera.width <= 0 || !finite(camera.height, 10000) || camera.height <= 0) return null;
    return { version: 1, id: value.id, name: text(value.name, 80).trim(), savedAt: new Date(value.savedAt).toISOString(), scope,
      graph: { artists, edges, explorer: { selected: state.selected, visible: [...state.visible], expanded: [...new Set(state.expanded)],
        trail: [...state.trail], routes: state.routes.map(([id, path]) => [id, [...path]]) } },
      camera: { zoom: camera.zoom, pan: { x: camera.pan.x, y: camera.pan.y }, width: camera.width, height: camera.height } };
  } catch { return null; }
}

export function createMapStore({ getStorage, scope = 'main', now = () => new Date().toISOString(), makeId = () => crypto.randomUUID() }) {
  const key = `artistree.saved-maps.v1.${scope}`;
  const read = () => {
    try {
      const raw = getStorage().getItem(key);
      if (raw === null) return [];
      if (raw.length > MAX_TEXT) throw new Error();
      const values = JSON.parse(raw);
      if (!Array.isArray(values) || values.length > MAX_MAPS) throw new Error();
      const maps = values.map(value => validateSavedMap(value, scope));
      if (maps.some(value => !value) || new Set(maps.map(map => map.id)).size !== maps.length) throw new Error();
      return maps;
    } catch { throw new Error('Saved maps could not be read. Browser storage may be blocked or the saved data is damaged. Nothing was changed.'); }
  };
  const write = maps => {
    const data = JSON.stringify(maps);
    if (data.length > MAX_TEXT) throw new Error('These maps are too large for local storage. Delete a saved map before trying again.');
    try { getStorage().setItem(key, data); }
    catch { throw new Error('Could not save changes. Browser storage may be full or blocked. Existing saved maps were not replaced.'); }
  };
  return {
    list: read,
    save({ name, graph, camera }) {
      const maps = read();
      if (maps.length >= MAX_MAPS) throw new Error('You can save up to 20 maps in this view. Delete one before saving another.');
      const map = validateSavedMap({ version: 1, id: makeId(), name, savedAt: now(), scope, graph, camera }, scope);
      if (!map) throw new Error('This map could not be saved safely. Try again after the current layout settles.');
      write([map, ...maps]);
      return map;
    },
    remove(id) {
      const maps = read(), next = maps.filter(map => map.id !== id);
      if (next.length !== maps.length) write(next);
      return next;
    }
  };
}
