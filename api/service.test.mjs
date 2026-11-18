import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusicService } from './service.mjs';
import { fetchConnectionPages, mergeLiveGraph } from '../live-client.js';
import { createExplorer } from '../explorer-state.js';

const mbid = '11111111-1111-4111-8111-111111111111';
const profile = (provider, id, name = id) => ({ id: `${provider}:${id}`, name, providerIds: { [provider]: id }, links: {}, tags: ['ARTIST'], origin: 'live' });
const root = profile('genius', '1', 'Root');
const guests = Array.from({ length: 8 }, (_, i) => profile('genius', String(i + 2)));
const payload = (artist, people, provider = 'genius') => ({ artists: [artist, ...people],
  edges: people.map(person => ({ a: artist.id, b: person.id, type: 'collaboration', work: 'Track', url: 'https://genius.com/track-lyrics', provider, source: provider })), warnings: [] });
function adapters(overrides = {}) {
  return Object.fromEntries(['apple', 'spotify', 'genius', 'musicbrainz'].map(key => [key, {
    configured: key === 'genius' || key === 'musicbrainz', status: () => ({ id: key }),
    artist: async () => root, matchExternal: async () => null,
    connections: async () => payload(root, guests),
    ...overrides[key]
  }]));
}

test('verified credits stream before slow identity matching or the rest of the source completes', async () => {
  const identity = Promise.withResolvers(), source = Promise.withResolvers(), first = Promise.withResolvers();
  const mbRoot = { ...profile('musicbrainz', mbid), providerIds: { musicbrainz: mbid, genius: '1' } };
  const mbGuest = profile('musicbrainz', '22222222-2222-4222-8222-222222222222');
  const service = createMusicService(adapters({
    genius: { connections: async (_, { onProgress }) => { onProgress(payload(root, guests.slice(0, 4))); await source.promise; return payload(root, guests); } },
    musicbrainz: { matchExternal: () => identity.promise, connections: async () => payload(mbRoot, [mbGuest], 'musicbrainz') }
  }));
  const updates = [];
  const stream = service.streamConnections(root.id, { limit: 4 }, update => {
    updates.push(update);
    if (update.artists.length === 5) first.resolve(update);
  });
  const ready = await first.promise;
  assert.equal(ready.pending, true);
  assert.equal(ready.sources.find(item => item.provider === 'genius').status, 'loading');
  assert.deepEqual(ready.artists.slice(1).map(person => person.id), guests.slice(0, 4).map(person => person.id));
  source.resolve();
  identity.resolve(mbRoot);
  await stream;
  const final = updates.at(-1);
  assert.equal(final.pending, false);
  assert.equal(final.page.total, 9);
  assert.deepEqual(final.artists.slice(1).map(person => person.id), ready.artists.slice(1).map(person => person.id), 'enrichment does not reshuffle published pages');
  const rest = await service.connections(root.id, { offset: 4, limit: 8 });
  assert.equal(rest.artists.length, 6);
  assert.ok(rest.artists.some(person => person.id === mbGuest.id));
});

test('disconnecting a stream detaches it without cancelling shared cache warming', async () => {
  const finish = Promise.withResolvers(), first = Promise.withResolvers();
  let calls = 0;
  const service = createMusicService(adapters({
    genius: { connections: async (_, { onProgress }) => { calls++; onProgress(payload(root, guests.slice(0, 4))); await finish.promise; return payload(root, guests); } }
  }));
  const controller = new AbortController();
  let updates = 0;
  const stream = service.streamConnections(root.id, {}, update => {
    updates++;
    if (update.edges.length) first.resolve();
  }, controller.signal);
  await first.promise;
  controller.abort();
  await stream;
  const detachedCount = updates;
  const shared = service.connections(root.id);
  finish.resolve();
  const result = await shared;
  assert.equal(calls, 1);
  assert.equal(updates, detachedCount);
  assert.equal(result.pending, false);
  assert.equal(result.page.total, 8);
  await service.connections(root.id, { offset: 4 });
  assert.equal(calls, 1, 'paging reuses the completed lookup');
});

test('slow-source failures retain earlier verified edges and sanitized diagnostics', async () => {
  const service = createMusicService(adapters({
    musicbrainz: { matchExternal: async () => { throw new Error('private-upstream-detail'); } }
  }));
  const updates = [];
  await service.streamConnections(root.id, {}, update => updates.push(update));
  assert.equal(updates.at(-1).pending, false);
  assert.equal(updates.at(-1).edges.length, 4);
  assert.equal(updates.at(-1).identityWarnings[0].code, 'upstream');
  assert.doesNotMatch(JSON.stringify(updates), /private-upstream-detail/);
});

test('Spotify progress and paging reuse a source-isolated job', async () => {
  const artist = profile('spotify', '0123456789abcdefghijkl');
  const guest = profile('spotify', 'abcdefghijkl0123456789');
  let calls = 0;
  const fail = async () => { throw new Error('Other providers must not be called'); };
  const service = createMusicService(adapters({
    spotify: { configured: true, artist: async () => artist, connections: async (_, { onProgress }) => {
      calls++;
      const result = payload(artist, [guest], 'spotify');
      onProgress(result);
      return result;
    } },
    genius: { connections: fail, artist: fail },
    musicbrainz: { connections: fail, matchExternal: fail }
  }));
  const updates = [];
  await service.streamConnections(artist.id, {}, update => updates.push(update));
  await service.connections(artist.id);
  assert.equal(calls, 1);
  assert.ok(updates.every(update => update.sources.every(source => source.provider === 'spotify')));
  assert.ok(updates.at(-1).artists.every(person => Object.keys(person.providerIds).every(key => key === 'spotify')));
});

test('consuming an artist’s first batch fetches more songs instead of ending the branch', async () => {
  const calls = [];
  const service = createMusicService(adapters({
    genius: { connections: async (_, { cursor }) => {
      calls.push(cursor ?? 1);
      const batch = (cursor ?? 1) === 1 ? guests.slice(0, 4) : guests.slice(4);
      return { ...payload(root, batch), nextCursor: cursor === 2 ? null : 2 };
    } }
  }));
  const first = await service.connections(root.id);
  assert.equal(first.page.total, 4);
  assert.equal(first.page.hasMore, true);
  assert.equal(first.page.canContinue, true);
  assert.deepEqual(calls, [1], 'later song pages are not fetched speculatively');
  const next = await service.connections(root.id, { offset: 4 });
  assert.deepEqual(next.artists.slice(1).map(person => person.id), guests.slice(4).map(person => person.id));
  assert.equal(next.page.total, 8);
  assert.equal(next.page.hasMore, false);
  assert.deepEqual(calls, [1, 2]);
  const old = await service.connections(root.id);
  assert.deepEqual(old.artists.slice(1).map(person => person.id), first.artists.slice(1).map(person => person.id));
  assert.equal(old.edges.length, 4, 'previous credits remain available');
});

test('overlapping song batches are skipped until genuinely new people are found', async () => {
  const calls = [];
  const service = createMusicService(adapters({
    genius: { connections: async (_, { cursor = 1 }) => {
      calls.push(cursor);
      return { ...payload(root, cursor < 3 ? guests.slice(0, 4) : guests.slice(4)), nextCursor: cursor < 3 ? cursor + 1 : null };
    } }
  }));
  const first = await service.connections(root.id);
  const artists = {}, edges = [];
  mergeLiveGraph(artists, edges, first, root.id);
  const explorer = createExplorer({ artists, edges, seeds: Object.keys(artists), initialArtist: root.id });
  const original = globalThis.fetch;
  let remaining = 4;
  try {
    globalThis.fetch = async value => {
      const url = new URL(value, 'http://localhost');
      return Response.json(await service.connections(url.searchParams.get('id'), { offset: Number(url.searchParams.get('offset')), limit: 4 }));
    };
    await fetchConnectionPages(root.id, root.name, 0, undefined, page => {
      const merged = mergeLiveGraph(artists, edges, page, root.id);
      const visible = explorer.visibleIds;
      const unseen = merged.addedIds.filter(id => !visible.has(id)).slice(0, remaining);
      explorer.reveal(unseen);
      remaining -= unseen.length;
      return remaining > 0;
    });
    assert.equal(explorer.visibleIds.size, 9);
    assert.deepEqual(calls, [1, 2, 3]);
    assert.equal(edges.length, 8);
  } finally { globalThis.fetch = original; }
});

test('every end node is its own lookup root, regardless of distance from the starting artist', async () => {
  const calls = [];
  const people = [root, ...guests];
  const service = createMusicService(adapters({
    genius: { artist: async id => people.find(person => person.providerIds.genius === id), connections: async id => {
      calls.push(id);
      const index = people.findIndex(person => person.providerIds.genius === id);
      return payload(people[index], [people[index + 1]]);
    } }
  }));
  for (let index = 0; index < 7; index++) {
    const page = await service.connections(people[index].id);
    assert.equal(page.artist.id, people[index].id);
    assert.equal(page.edges[0].a, people[index].id);
    assert.equal(page.edges[0].b, people[index + 1].id);
  }
  assert.equal(calls.length, 7);
});

test('simultaneous continuation requests share one page fetch and keep streaming', async () => {
  const finish = Promise.withResolvers(), first = Promise.withResolvers();
  let calls = 0;
  const service = createMusicService(adapters({
    genius: { connections: async (_, { cursor = 1, onProgress }) => {
      calls++;
      if (cursor === 1) return { ...payload(root, guests.slice(0, 4)), nextCursor: 2 };
      onProgress(payload(root, guests.slice(4)));
      await finish.promise;
      return { ...payload(root, guests.slice(4)), nextCursor: null };
    } }
  }));
  await service.connections(root.id);
  const stream = service.streamConnections(root.id, { offset: 4 }, update => { if (update.edges.length) first.resolve(update); });
  const shared = service.connections(root.id, { offset: 4 });
  const early = await first.promise;
  assert.equal(early.pending, true);
  assert.equal(early.artists.length, 5);
  finish.resolve();
  await Promise.all([stream, shared]);
  assert.equal(calls, 2);
});

test('a failed next song page remains retryable without deleting earlier credits', async () => {
  let fail = true;
  const service = createMusicService(adapters({
    genius: { connections: async (_, { cursor = 1 }) => {
      if (cursor === 1) return { ...payload(root, guests.slice(0, 4)), nextCursor: 2 };
      if (fail) { fail = false; throw new Error('private-details'); }
      return { ...payload(root, guests.slice(4)), nextCursor: null };
    } }
  }));
  await service.connections(root.id);
  const failed = await service.connections(root.id, { offset: 4 });
  assert.equal(failed.page.canContinue, true);
  assert.doesNotMatch(JSON.stringify(failed), /private-details/);
  const old = await service.connections(root.id);
  assert.equal(old.edges.length, 4);
  const retried = await service.connections(root.id, { offset: 4 });
  assert.equal(retried.edges.length, 4);
  assert.equal(retried.page.canContinue, false);
});
