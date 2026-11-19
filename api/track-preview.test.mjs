import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrackPreviewService } from './track-preview.mjs';
import { createProviders } from './providers.mjs';
import { createHttpClient } from './http.mjs';

const url = 'https://genius.com/Artist-real-track-lyrics';
function fixture(routes = {}, env = { GENIUS_ACCESS_TOKEN: 'private-test-token' }) {
  const calls = [];
  const http = createHttpClient({ mbInterval: 0, fetchImpl: async value => {
    const link = new URL(value); calls.push(link);
    const data = routes[link.pathname];
    if (!data) throw new Error(`Unexpected test endpoint ${link.pathname}`);
    return Response.json(typeof data === 'function' ? data(link) : data);
  } });
  return { calls, service: createTrackPreviewService(createProviders({ env, http }), { lookupApple: async () => true }) };
}

test('Genius resolves only its exact canonical song and an explicit Apple Music ID', async () => {
  const { calls, service } = fixture({
    '/search': { response: { hits: [
      { result: { id: 99, url: 'https://genius.com/Artist-different-track-lyrics', title: 'Real track' } },
      { result: { id: 12, url } }
    ] } },
    '/songs/12': { response: { song: { id: 12, url, apple_music_id: '1382792321' } } }
  });
  const result = await service.resolve('genius', url, 'main');
  assert.equal(result.embedUrl, 'https://embed.music.apple.com/us/song/1382792321?theme=light');
  assert.equal(result.openUrl, 'https://music.apple.com/us/song/1382792321');
  assert.equal(calls.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /private-test-token|Authorization|previewUrl/);
  await service.resolve('genius', `${url}?utm_source=test`, 'main');
  assert.equal(calls.length, 2, 'equivalent URLs share the bounded metadata cache');
});

test('same-name search hits, mismatched detail responses and missing catalogue links never play another song', async () => {
  const cases = [
    { search: [{ result: { id: 12, url: 'https://genius.com/Other-song-lyrics', title: 'Real track' } }] },
    { song: { id: 12, url: 'https://genius.com/Other-song-lyrics', apple_music_id: '456' } },
    { song: { id: 13, url, apple_music_id: '456' } },
    { song: { id: 12, url, apple_music_id: null } },
    { song: { id: 12, url, apple_music_id: 'https://attacker.example/id' } }
  ];
  for (const item of cases) {
    const { service } = fixture({
      '/search': { response: { hits: item.search || [{ result: { id: 12, url } }] } },
      '/songs/12': { response: { song: item.song } }
    });
    assert.equal((await service.resolve('genius', url, 'main')).status, 'unavailable');
  }
});

test('MusicBrainz uses an explicit recording URL relationship, not a title/ISRC search guess', async () => {
  const id = 'cd689e77-dfdd-4f81-b50c-5e5a3f5e38a4';
  const { service, calls } = fixture({
    [`/ws/2/recording/${id}`]: { id, relations: [{ url: { resource: 'https://music.apple.com/kr/album/release/123?i=456' } }] }
  }, {});
  assert.equal((await service.resolve('musicbrainz', `https://musicbrainz.org/recording/${id}`, 'main')).openUrl, 'https://music.apple.com/us/song/456');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get('inc'), 'url-rels');
});

test('unsupported and unsafe URLs are rejected before ANY outbound request', async () => {
  const { service, calls } = fixture({});
  for (const [provider, link, scope] of [
    ['genius', 'https://attacker.example/Artist-real-track-lyrics', 'main'],
    ['genius', 'https://token@genius.com/Artist-real-track-lyrics', 'main'],
    ['genius', 'http://genius.com/Artist-real-track-lyrics', 'main'],
    ['genius', 'https://genius.com/artists/artist', 'main'],
    ['apple', 'https://music.apple.com/us/artist/123', 'main'],
    ['spotify', 'https://open.spotify.com/track/2xvtxDNInKDV4AvGmjw6d1', 'main'],
    ['genius', url, 'spotify'],
    ['genius', url, 'invalid'],
    ['genius', null, 'main']
  ]) await assert.rejects(service.resolve(provider, link, scope), error => error.code === 'invalid_request');
  assert.equal(calls.length, 0);
});

test('direct Apple/Spotify embeds need no catalogue credentials and keep source isolation', async () => {
  const { service, calls } = fixture({}, {});
  assert.equal((await service.resolve('apple', 'https://music.apple.com/us/album/release/123?i=456', 'main')).embedUrl,
    'https://embed.music.apple.com/us/song/456?theme=light');
  const spotify = await service.resolve('spotify', 'https://open.spotify.com/intl-ko/track/2xvtxDNInKDV4AvGmjw6d1?si=123', 'spotify');
  assert.equal(spotify.embedUrl, 'https://open.spotify.com/embed/track/2xvtxDNInKDV4AvGmjw6d1');
  assert.equal(calls.length, 0);
});

test('concurrent metadata checks coalesce and failed checks stay retryable', async () => {
  let count = 0, release;
  const providers = { genius: { trackPlayerLinks: async () => { count++; return new Promise(resolve => { release = resolve; }); } } };
  const service = createTrackPreviewService(providers, { lookupApple: async () => true });
  const first = service.resolve('genius', url, 'main'), second = service.resolve('genius', url, 'main');
  assert.equal(count, 1); release({ appleMusicId: '456' });
  assert.deepEqual(await first, await second);
  let attempts = 0;
  const retry = createTrackPreviewService({ genius: { trackPlayerLinks: async () => { if (++attempts === 1) throw new Error('upstream'); return { appleMusicId: '456' }; } } }, { lookupApple: async () => true });
  await assert.rejects(retry.resolve('genius', url, 'main'));
  assert.equal((await retry.resolve('genius', url, 'main')).status, 'ready');
});

test('unavailable mappings expire and missing authenticated credentials never cause anonymous Genius calls', async () => {
  let time = 0, calls = 0;
  const service = createTrackPreviewService({ genius: { trackPlayerLinks: async () => { calls++; return null; } } }, { now: () => time });
  await service.resolve('genius', url, 'main'); await service.resolve('genius', url, 'main');
  assert.equal(calls, 1);
  time = 60_001; await service.resolve('genius', url, 'main'); assert.equal(calls, 2);
  const missing = fixture({}, {});
  await assert.rejects(missing.service.resolve('genius', url, 'main'), error => error.code === 'missing_credentials');
  assert.equal(missing.calls.length, 0);
});

test('source-linked YouTube videos use an official privacy-enhanced 30-second embed, never a title search', async () => {
  const { service, calls } = fixture({
    '/search': { response: { hits: [{ result: { id: 12, url } }] } },
    '/songs/12': { response: { song: { id: 12, url, apple_music_id: '123', media: [
      { provider: 'youtube', url: 'https://www.youtube.com.attacker.example/watch?v=abcdefghijk' },
      { provider: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk' }
    ] } } }
  });
  const result = await service.resolve('genius', url, 'main');
  assert.equal(result.provider, 'youtube');
  assert.equal(result.embedUrl, 'https://www.youtube-nocookie.com/embed/abcdefghijk?start=0&end=30&rel=0');
  assert.equal(calls.length, 2);
});

test('stale Apple IDs and unrelated lookup results do not leave a permanently empty embed', async () => {
  const calls = [];
  const service = createTrackPreviewService({}, { http: { request: async (provider, value) => {
    calls.push({ provider, url: new URL(value) });
    return { results: [{ kind: 'song', trackId: 999, trackName: 'Same title' }] };
  } } });
  const result = await service.resolve('apple', 'https://music.apple.com/us/song/123', 'main');
  assert.equal(result.status, 'unavailable');
  assert.equal(calls[0].provider, 'apple-preview');
  assert.equal(calls[0].url.hostname, 'itunes.apple.com');
  assert.equal(calls[0].url.searchParams.get('id'), '123');
});
