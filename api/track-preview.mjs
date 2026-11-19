import { ApiError, createHttpClient } from './http.mjs';
import { recordingUrl, recordingKey } from '../credit-preview.js';

const appleId = value => {
  const valid = recordingUrl(value, 'apple');
  if (!valid) return null;
  return recordingKey(valid, 'apple').slice('apple:'.length);
};

export function createTrackPreviewService(providers, { storefront = 'us', now = Date.now, http = createHttpClient(), lookupApple } = {}) {
  const country = /^[a-z]{2}$/.test(storefront) ? storefront : 'us';
  const cache = new Map(), pending = new Map();
  const exists = lookupApple || (async id => {
    // Only verify the exact catalogue ID. No name search, preview extraction,
    // asset caching or use of promotional audio from the iTunes API.
    const url = `https://itunes.apple.com/lookup?${new URLSearchParams({ id, entity: 'song', country })}`;
    const data = await http.request('apple-preview', url);
    return Array.isArray(data.results) && data.results.some(track => track.kind === 'song' && String(track.trackId) === id);
  });
  async function resolve(provider, url, scope) {
    if (!['main', 'spotify'].includes(scope) || (scope === 'spotify' ? provider !== 'spotify' : provider === 'spotify')
      || typeof url !== 'string' || url.length > 2000 || !recordingUrl(url, provider)) {
      throw new ApiError('invalid_request', 'A source-isolated, valid recording URL is required.', 400);
    }
    const key = recordingKey(url, provider);
    if (cache.get(key)?.until > now()) return cache.get(key).value;
    if (pending.has(key)) return pending.get(key);
    const request = (async () => {
      let id = null;
      if (provider === 'apple') id = appleId(url);
      if (provider === 'spotify') {
        id = key.slice('spotify:'.length);
        return { status: 'ready', provider: 'spotify', source: 'Spotify',
          embedUrl: `https://open.spotify.com/embed/track/${id}`,
          openUrl: `https://open.spotify.com/track/${id}` };
      }
      // Exact, source-supplied links/IDs only. Never select a search result
      // merely because its title or artist name looks similar.
      if (provider === 'genius') {
        const links = await providers.genius.trackPlayerLinks(url);
        if (/^[a-zA-Z0-9_-]{11}$/.test(links?.youtubeId || '')) {
          return { status: 'ready', provider: 'youtube', source: 'YouTube',
            embedUrl: `https://www.youtube-nocookie.com/embed/${links.youtubeId}?start=0&end=30&rel=0`,
            openUrl: `https://www.youtube.com/watch?v=${links.youtubeId}` };
        }
        id = links?.appleMusicId;
      }
      if (provider === 'musicbrainz') id = appleId(await providers.musicbrainz.appleSongUrl(url) || '');
      if (!/^\d{1,20}$/.test(id || '')) return { status: 'unavailable', reason: 'no_verified_player' };
      if (!await exists(id)) return { status: 'unavailable', reason: 'catalogue_unavailable' };
      return { status: 'ready', provider: 'apple', source: 'Apple Music',
        embedUrl: `https://embed.music.apple.com/${country}/song/${id}?theme=light`,
        openUrl: `https://music.apple.com/${country}/song/${id}` };
    })();
    pending.set(key, request);
    try {
      const value = await request;
      if (cache.size >= 128) cache.delete(cache.keys().next().value);
      cache.set(key, { value, until: now() + (value.status === 'ready' ? 300_000 : 60_000) });
      return value;
    } finally { pending.delete(key); }
  }
  return { resolve };
}
