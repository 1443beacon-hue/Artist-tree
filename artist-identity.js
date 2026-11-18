const validProviderId = (provider, id) => typeof id === 'string' && (
  ['apple', 'genius'].includes(provider) ? /^\d{1,20}$/.test(id)
    : provider === 'spotify' ? /^[a-zA-Z0-9]{22}$/.test(id)
      : provider === 'musicbrainz' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)
);

export function providerIdsConflict(a, b) {
  return Object.entries(a.providerIds || {}).some(([provider, id]) => b.providerIds?.[provider] && b.providerIds[provider] !== id);
}

// These keys describe the provider's own artist page, never a display name,
// photograph URL, shared label, homepage, or recording credit.
export function artistIdentityKeys(artist) {
  const keys = new Set();
  const addId = (provider, id) => {
    if (validProviderId(provider, id) && (!artist.providerIds?.[provider] || artist.providerIds[provider] === id)) keys.add(`${provider}:${id}`);
  };
  Object.entries(artist.providerIds || {}).forEach(([provider, id]) => addId(provider, id));
  const native = String(artist.apiId || artist.id || '').split(':');
  if (native.length === 2) addId(native[0], native[1]);
  for (const value of [...Object.values(artist.links || {}), artist.url]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
      if (url.hostname === 'genius.com' && /^\/artists\/[^/]+\/?$/i.test(url.pathname)) {
        keys.add(`genius-url:${decodeURIComponent(url.pathname).normalize('NFKC').toLowerCase().replace(/\/$/, '')}`);
      }
      const apple = url.hostname === 'music.apple.com' && url.pathname.match(/\/artist\/(?:[^/]+\/)?(?:id)?(\d+)\/?$/);
      const spotify = url.hostname === 'open.spotify.com' && url.pathname.match(/\/(?:intl-[a-z]+\/)?artist\/([a-zA-Z0-9]{22})\/?$/);
      const mb = url.hostname === 'musicbrainz.org' && url.pathname.match(/\/artist\/([a-f0-9-]{36})\/?$/i);
      if (apple) addId('apple', apple[1]);
      if (spotify) addId('spotify', spotify[1]);
      if (mb) addId('musicbrainz', mb[1]);
    } catch { /* Malformed metadata is not an identity match. */ }
  }
  return keys;
}

export function sameArtist(a, b) {
  if (providerIdsConflict(a, b)) return false;
  const keys = artistIdentityKeys(a);
  return [...artistIdentityKeys(b)].some(key => keys.has(key));
}
