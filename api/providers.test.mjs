import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHttpClient, publicError } from './http.mjs';
import { createProviders, identitiesFromLinks, makeAppleToken, validId } from './providers.mjs';
import { createRegistry, createMusicService, parseArtistId } from './service.mjs';

const aId = '11111111-1111-4111-8111-111111111111';
const bId = '22222222-2222-4222-8222-222222222222';
const sId = '0123456789abcdefghijkl';
const sOther = 'abcdefghijkl0123456789';
const response = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
function fixture(routes, env = {}) {
  const calls = [];
  const http = createHttpClient({ mbInterval: 0, fetchImpl: async (url, options) => {
    calls.push({ url: new URL(url), options });
    const handler = routes[new URL(url).pathname];
    if (!handler) throw new Error(`Unexpected fixture request: ${new URL(url).pathname}`);
    return typeof handler === 'function' ? handler(new URL(url), options) : response(handler);
  } });
  return { providers: createProviders({ env, http }), calls };
}

test('missing credentials never cause anonymous calls to authenticated services', async () => {
  const { providers, calls } = fixture({});
  for (const key of ['apple', 'spotify', 'genius']) {
    assert.equal(providers[key].configured, false);
    await assert.rejects(providers[key].search('Bladee'), error => error.code === 'missing_credentials');
  }
  assert.equal(calls.length, 0);
  assert.equal(providers.musicbrainz.configured, true);
  assert.doesNotMatch(JSON.stringify(Object.values(providers).map(p => p.status())), /ACCESS_TOKEN|CLIENT_SECRET/);
});

test('Spotify uses cached client credentials and normalizes catalogue search', async () => {
  const { providers, calls } = fixture({
    '/api/token': (_, options) => { assert.equal(options.body, 'grant_type=client_credentials'); assert.match(options.headers.Authorization, /^Basic /); return response({ access_token: 'test-token', expires_in: 3600 }); },
    '/v1/search': (_, options) => { assert.equal(options.headers.Authorization, 'Bearer test-token'); return response({ artists: { items: [{ id: sId, name: 'Artist', images: [{ url: 'https://i.scdn.co/image/test' }], external_urls: { spotify: `https://open.spotify.com/artist/${sId}` } }] } }); }
  }, { SPOTIFY_CLIENT_ID: 'test-id', SPOTIFY_CLIENT_SECRET: 'test-secret' });
  const [first] = await providers.spotify.search('Artist');
  await providers.spotify.search('Other artist');
  assert.equal(first.providerIds.spotify, sId);
  assert.equal(first.imageSource, 'Spotify');
  assert.equal(calls.filter(call => call.url.pathname === '/api/token').length, 1);
  assert.ok(calls.every(call => !/related-artists|recommendations|audio-features/.test(call.url.pathname)));
});

test('Spotify derives collaborations only from a track credit, not album neighbors', async () => {
  const { providers } = fixture({
    '/api/token': { access_token: 'test-token', expires_in: 3600 },
    [`/v1/artists/${sId}`]: { id: sId, name: 'Root' },
    [`/v1/artists/${sOther}`]: { id: sOther, name: 'Guest' },
    [`/v1/artists/${sId}/albums`]: { items: [{ id: 'album' }] },
    '/v1/albums/album/tracks': { items: [
      { id: 'track1', name: 'Together', artists: [{ id: sId, name: 'Root' }, { id: sOther, name: 'Guest' }] },
      { id: 'track2', name: 'Unrelated', artists: [{ id: sOther, name: 'Guest' }] }
    ] }
  }, { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' });
  const result = await providers.spotify.connections(sId);
  assert.equal(result.edges.length, 1);
  assert.equal(result.edges[0].work, 'Together');
  assert.equal(result.edges[0].type, 'collaboration');
});

test('Genius credits distinguish performers, producers, and unrelated search results', async () => {
  const raw = id => ({ id, name: `Artist ${id}`, url: `https://genius.com/artists/artist-${id}` });
  const { providers, calls } = fixture({
    '/artists/1': { response: { artist: raw(1) } },
    '/artists/1/songs': { response: { songs: [{ id: 10 }, { id: 11 }] } },
    '/songs/10': { response: { song: { title: 'Shared', url: 'https://genius.com/shared-lyrics', primary_artist: raw(1), featured_artists: [raw(2)], producer_artists: [raw(3)] } } },
    '/songs/11': { response: { song: { title: 'Not a credit', primary_artist: raw(4), producer_artists: [raw(5)] } } }
  }, { GENIUS_ACCESS_TOKEN: 'private-test-token' });
  const result = await providers.genius.connections('1');
  assert.equal(result.edges.length, 2);
  assert.equal(result.edges.find(edge => edge.b === 'genius:3').type, 'production');
  assert.ok(result.artists.find(person => person.id === 'genius:3').tags.includes('PRODUCER'));
  assert.ok(calls.every(call => call.url.hostname === 'api.genius.com'));
  assert.ok(calls.every(call => call.options.headers.Authorization === 'Bearer private-test-token'));
});

test('Genius producer nodes can expand into their credited performers', async () => {
  const raw = id => ({ id, name: `Artist ${id}`, url: `https://genius.com/artists/artist-${id}` });
  const { providers } = fixture({
    '/artists/3': { response: { artist: raw(3) } },
    '/artists/3/songs': { response: { songs: [{ id: 10 }] } },
    '/songs/10': { response: { song: { title: 'Produced', primary_artist: raw(1), producer_artists: [raw(3)], url: 'https://genius.com/produced-lyrics' } } }
  }, { GENIUS_ACCESS_TOKEN: 'test' });
  const result = await providers.genius.connections('3');
  assert.equal(result.edges[0].b, 'genius:1');
  assert.equal(result.edges[0].type, 'production');
});

test('Apple similarity is explicitly separate from recording collaborations', async () => {
  const raw = (id, name) => ({ id, attributes: { name, url: `https://music.apple.com/us/artist/${id}` } });
  const { providers } = fixture({
    '/v1/catalog/us/artists/1': { data: [raw('1', 'Root')] },
    '/v1/catalog/us/artists/1/view/similar-artists': { data: [raw('2', 'Similar')] },
    '/v1/catalog/us/artists/1/view/top-songs': { data: [{ id: '10' }] },
    '/v1/catalog/us/songs': { data: [{ id: '10', attributes: { name: 'Shared', url: 'https://music.apple.com/us/song/10' }, relationships: { artists: { data: [raw('1', 'Root'), raw('3', 'Guest')] } } }] }
  }, { APPLE_MUSIC_DEVELOPER_TOKEN: 'test-developer-token' });
  const result = await providers.apple.connections('1');
  assert.equal(result.edges.find(edge => edge.b === 'apple:2').type, 'similar');
  assert.equal(result.edges.find(edge => edge.b === 'apple:3').type, 'collaboration');
});

test('Apple signing generates a valid ES256 developer JWT without returning the private key', async () => {
  const base = join(tmpdir(), 'opencode'); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'artistree-jwt-test-'));
  try {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const path = join(dir, 'test.p8'); await writeFile(path, privateKey.export({ format: 'pem', type: 'pkcs8' }));
    const token = await makeAppleToken({ APPLE_MUSIC_TEAM_ID: 'TEAM123456', APPLE_MUSIC_KEY_ID: 'KEY1234567', APPLE_MUSIC_PRIVATE_KEY_PATH: path }, () => 1_000_000);
    const [header, body, signature] = token.split('.');
    assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'ES256');
    assert.equal(JSON.parse(Buffer.from(body, 'base64url')).exp, 4600);
    assert.ok(verify('sha256', Buffer.from(`${header}.${body}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
  } finally { await rm(dir, { recursive: true }); }
});

test('MusicBrainz identity links are explicit, not name-only merges', async () => {
  const { providers } = fixture({
    '/ws/2/artist/': { artists: [{ id: aId, name: 'Same Name' }] },
    [`/ws/2/artist/${aId}`]: { id: aId, name: 'Same Name', relations: [{ url: { resource: 'https://music.apple.com/us/artist/other/999' } }] }
  });
  const match = await providers.musicbrainz.matchExternal({ name: 'Same Name', providerIds: { apple: '123' }, links: {} });
  assert.equal(match, null);
  assert.deepEqual(identitiesFromLinks({ apple: 'https://music.apple.com/artist/id123', spotify: `https://open.spotify.com/artist/${sId}` }), { apple: '123', spotify: sId });
});

test('MusicBrainz serializes concurrent reads at least one second apart and deduplicates identical reads', async () => {
  let time = 0; const starts = [];
  const client = createHttpClient({ now: () => time, sleep: async ms => { time += ms; }, fetchImpl: async () => { starts.push(time); return response({ ok: true }); } });
  await Promise.all([client.request('musicbrainz', 'https://musicbrainz.org/1'), client.request('musicbrainz', 'https://musicbrainz.org/2'), client.request('musicbrainz', 'https://musicbrainz.org/1')]);
  assert.deepEqual(starts, [0, 1100]);
});

test('upstream errors never reveal response bodies, tokens, or private headers', async () => {
  const http = createHttpClient({ fetchImpl: async () => response({ secret: 'DO-NOT-EXPOSE' }, 401) });
  await assert.rejects(http.request('genius', 'https://api.genius.com/search', { headers: { Authorization: 'secret' } }), error => {
    assert.equal(publicError(error).code, 'authentication');
    assert.doesNotMatch(JSON.stringify(http.status('genius')), /DO-NOT-EXPOSE|Authorization/); return true;
  });
});

test('an OAuth token alone does not mark Spotify catalogue access as verified', async () => {
  const { providers } = fixture({
    '/api/token': { access_token: 'test', expires_in: 3600 },
    '/v1/search': () => response({ error: 'restricted' }, 403)
  }, { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' });
  await assert.rejects(providers.spotify.search('Artist'));
  assert.equal(providers.spotify.status().lastSuccess, null);
  assert.equal(providers.spotify.status().lastError.code, 'forbidden');
});

test('registry merges verified IDs but keeps namesakes apart', () => {
  const registry = createRegistry();
  registry.register({ id: 'apple:1', name: 'Same', providerIds: { apple: '1' }, links: {} });
  registry.register({ id: `musicbrainz:${aId}`, name: 'Same', providerIds: { musicbrainz: aId }, links: {} });
  assert.notEqual(registry.resolve('apple:1'), registry.resolve(`musicbrainz:${aId}`));
  registry.register({ id: `musicbrainz:${aId}`, name: 'Same', providerIds: { musicbrainz: aId, apple: '1' }, links: {} });
  assert.equal(registry.resolve('apple:1'), registry.resolve(`musicbrainz:${aId}`));
});

test('service keeps Spotify in a separate result collection', async () => {
  const { providers } = fixture({
    '/api/token': { access_token: 'test', expires_in: 3600 },
    '/v1/search': { artists: { items: [{ id: sId, name: 'Artist' }] } },
    '/ws/2/artist/': { artists: [{ id: bId, name: 'Artist' }] }
  }, { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' });
  const result = await createMusicService(providers).search('Artist');
  assert.equal(result.spotifyArtists[0].id, `spotify:${sId}`);
  assert.ok(result.artists.every(artist => !artist.providerIds.spotify));
});

test('search returns Bladee once after verifying the cross-source Genius link', async () => {
  const { providers } = fixture({
    '/search': { response: { hits: [{ result: { primary_artist: { id: 83959, name: 'Bladee', url: 'https://genius.com/artists/Bladee', image_url: 'https://images.genius.com/bladee.jpg' } } }] } },
    '/ws/2/artist/': { artists: [{ id: aId, name: 'Bladee' }] },
    [`/ws/2/artist/${aId}`]: { id: aId, name: 'Bladee', relations: [{ url: { resource: 'https://genius.com/artists/Bladee' } }, { url: { resource: 'https://music.apple.com/us/artist/861359576' } }] }
  }, { GENIUS_ACCESS_TOKEN: 'test' });
  const result = await createMusicService(providers).search('Bladee');
  assert.equal(result.artists.length, 1);
  assert.equal(result.artists[0].providerIds.genius, '83959');
  assert.equal(result.artists[0].providerIds.musicbrainz, aId);
  assert.equal(result.artists[0].providerIds.apple, '861359576');
  assert.equal(result.artists[0].imageSource, 'Genius');
});

test('an unverified same-name search result remains a distinct person', async () => {
  const { providers } = fixture({
    '/search': { response: { hits: [{ result: { primary_artist: { id: 1, name: 'Same', url: 'https://genius.com/artists/First-person' } } }] } },
    '/ws/2/artist/': { artists: [{ id: aId, name: 'Same' }] },
    [`/ws/2/artist/${aId}`]: { id: aId, name: 'Same', relations: [{ url: { resource: 'https://genius.com/artists/Other-person' } }] }
  }, { GENIUS_ACCESS_TOKEN: 'test' });
  const result = await createMusicService(providers).search('Same');
  assert.equal(result.artists.length, 2);
});

test('basic artist information does not trigger credit or cross-source lookups', async () => {
  const { providers, calls } = fixture({ '/artists/1': { response: { artist: { id: 1, name: 'Artist', url: 'https://genius.com/artists/Artist' } } } }, { GENIUS_ACCESS_TOKEN: 'test' });
  const result = await createMusicService(providers).artist('genius:1');
  assert.equal(result.artist.name, 'Artist');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/artists/1');
});

test('invalid identifiers and URL-like IDs are rejected before outbound requests', () => {
  assert.throws(() => parseArtistId('https://attacker.example'), error => error.status === 400);
  assert.throws(() => parseArtistId('apple:123/../../secret'));
  assert.equal(validId('spotify', 'not-an-id'), false);
});

test('MusicBrainz can return live recording collaborators and producers with source evidence', async () => {
  const recordingId = '33333333-3333-4333-8333-333333333333';
  const producerId = '44444444-4444-4444-8444-444444444444';
  const { providers } = fixture({
    [`/ws/2/artist/${aId}`]: { id: aId, name: 'Root' },
    '/ws/2/recording': { recordings: [{ id: recordingId }] },
    [`/ws/2/recording/${recordingId}`]: { id: recordingId, title: 'Shared', 'artist-credit': [{ artist: { id: aId, name: 'Root' } }, { artist: { id: bId, name: 'Guest' } }], relations: [{ type: 'producer', artist: { id: producerId, name: 'Producer' } }] }
  });
  const result = await providers.musicbrainz.connections(aId);
  assert.equal(result.edges.length, 2);
  assert.ok(result.edges.every(edge => edge.url === `https://musicbrainz.org/recording/${recordingId}`));
  assert.equal(result.edges.find(edge => edge.b.endsWith(producerId)).type, 'production');
});

test('service pages unique neighbors, retains provenance, and reuses a bounded lookup', async () => {
  const root = { id: `musicbrainz:${aId}`, name: 'Root', providerIds: { musicbrainz: aId }, links: {}, origin: 'live' };
  const neighbors = Array.from({ length: 20 }, (_, i) => {
    const id = `${(i + 100).toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
    return { id: `musicbrainz:${id}`, name: `Neighbor ${i}`, providerIds: { musicbrainz: id }, links: {}, origin: 'live' };
  });
  let calls = 0;
  const adapters = Object.fromEntries(['apple', 'spotify', 'genius', 'musicbrainz'].map(key => [key, {
    configured: key === 'musicbrainz', status: () => ({ id: key }), artist: async () => root,
    connections: async () => { calls++; return { artists: [root, ...neighbors], edges: neighbors.map(node => ({ a: root.id, b: node.id, type: 'collaboration', work: 'Shared', provider: 'musicbrainz', source: 'MusicBrainz', url: 'https://musicbrainz.org/recording/example' })), warnings: [] }; }
  }]));
  const service = createMusicService(adapters);
  const first = await service.connections(root.id, { offset: 0, limit: 8 });
  const second = await service.connections(root.id, { offset: 8, limit: 8 });
  assert.equal(first.artists.length, 9);
  assert.equal(second.artists.length, 9);
  assert.equal(first.page.nextOffset, 8);
  assert.equal(second.page.nextOffset, 16);
  assert.equal(first.page.hasMore, true);
  assert.equal(calls, 1);
  assert.equal(first.edges[0].evidence[0].source, 'MusicBrainz');
});

test('Spotify-only connections never resolve or fetch other services', async () => {
  const { providers, calls } = fixture({
    '/api/token': { access_token: 'test', expires_in: 3600 },
    [`/v1/artists/${sId}`]: { id: sId, name: 'Root' },
    [`/v1/artists/${sId}/albums`]: { items: [] }
  }, { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' });
  const result = await createMusicService(providers).connections(`spotify:${sId}`);
  assert.deepEqual(result.sources.map(source => source.provider), ['spotify']);
  assert.deepEqual(Object.keys(result.artist.providerIds), ['spotify']);
  assert.ok(calls.every(call => ['api.spotify.com', 'accounts.spotify.com'].includes(call.url.hostname)));
});

test('Genius publishes a verified song before a slower song finishes', async () => {
  const slow = Promise.withResolvers(), first = Promise.withResolvers();
  const raw = id => ({ id, name: `Artist ${id}`, url: `https://genius.com/artists/Artist-${id}` });
  const song = id => ({ response: { song: { title: `Track ${id}`, primary_artist: raw(1), featured_artists: [raw(id)], url: `https://genius.com/track-${id}-lyrics` } } });
  const { providers } = fixture({
    '/artists/1': { response: { artist: raw(1) } },
    '/artists/1/songs': { response: { songs: [{ id: 10 }, { id: 11 }] } },
    '/songs/10': song(10),
    '/songs/11': () => slow.promise
  }, { GENIUS_ACCESS_TOKEN: 'test' });
  let finished = false;
  const lookup = providers.genius.connections('1', { onProgress: first.resolve }).then(result => { finished = true; return result; });
  const early = await first.promise;
  assert.equal(finished, false);
  assert.equal(early.edges[0].b, 'genius:10');
  slow.resolve(response(song(11)));
  const complete = await lookup;
  assert.equal(complete.edges.length, 2);
});

test('Spotify publishes track credits without waiting for collaborator portraits', async () => {
  const portrait = Promise.withResolvers(), first = Promise.withResolvers();
  const { providers } = fixture({
    '/api/token': { access_token: 'test', expires_in: 3600 },
    [`/v1/artists/${sId}`]: { id: sId, name: 'Root' },
    [`/v1/artists/${sId}/albums`]: { items: [{ id: 'album' }] },
    '/v1/albums/album/tracks': { items: [{ id: 'track', name: 'Shared', artists: [{ id: sId, name: 'Root' }, { id: sOther, name: 'Guest' }] }] },
    [`/v1/artists/${sOther}`]: () => portrait.promise
  }, { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' });
  let finished = false;
  const lookup = providers.spotify.connections(sId, { onProgress: first.resolve }).then(result => { finished = true; return result; });
  const early = await first.promise;
  assert.equal(finished, false);
  assert.equal(early.edges.length, 1);
  assert.equal(early.artists.find(person => person.id === `spotify:${sOther}`).image, '');
  portrait.resolve(response({ id: sOther, name: 'Guest', images: [{ url: 'https://i.scdn.co/image/guest' }] }));
  const complete = await lookup;
  assert.ok(complete.artists.some(person => person.id === `spotify:${sOther}` && person.image));
});

test('Genius continues through official song pages and rejects non-progressing or URL-like cursors', async () => {
  const raw = id => ({ id, name: `Artist ${id}`, url: `https://genius.com/artists/Artist-${id}` });
  const pages = [];
  const { providers } = fixture({
    '/artists/1': { response: { artist: raw(1) } },
    '/artists/1/songs': url => {
      const page = Number(url.searchParams.get('page'));
      pages.push(page);
      return response({ response: { songs: [{ id: page + 10 }], next_page: page === 1 ? 2 : page === 2 ? 2 : 'https://attacker.example/secret' } });
    },
    '/songs/11': { response: { song: { title: 'First', primary_artist: raw(1), featured_artists: [raw(2)] } } },
    '/songs/12': { response: { song: { title: 'Next', primary_artist: raw(1), featured_artists: [raw(3)] } } },
    '/songs/13': { response: { song: { title: 'Last', primary_artist: raw(1) } } }
  }, { GENIUS_ACCESS_TOKEN: 'test' });
  const first = await providers.genius.connections('1');
  const second = await providers.genius.connections('1', { cursor: first.nextCursor });
  const third = await providers.genius.connections('1', { cursor: 3 });
  assert.equal(first.nextCursor, 2);
  assert.equal(second.edges[0].b, 'genius:3');
  assert.equal(second.nextCursor, null);
  assert.equal(third.nextCursor, null);
  assert.deepEqual(pages, [1, 2, 3]);
});

test('MusicBrainz can browse the next credited-recording batch', async () => {
  const recording = '33333333-3333-4333-8333-333333333333';
  const offsets = [];
  const { providers } = fixture({
    [`/ws/2/artist/${aId}`]: { id: aId, name: 'Root' },
    '/ws/2/recording': url => { offsets.push(Number(url.searchParams.get('offset'))); return response({ 'recording-count': 2, recordings: [{ id: recording }] }); },
    [`/ws/2/recording/${recording}`]: { id: recording, title: 'Track', 'artist-credit': [{ artist: { id: aId, name: 'Root' } }, { artist: { id: bId, name: 'Guest' } }] }
  });
  const first = await providers.musicbrainz.connections(aId);
  const next = await providers.musicbrainz.connections(aId, { cursor: first.nextCursor });
  assert.equal(first.nextCursor, 1);
  assert.equal(next.nextCursor, null);
  assert.deepEqual(offsets, [0, 1]);
});
