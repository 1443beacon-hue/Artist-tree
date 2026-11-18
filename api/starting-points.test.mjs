import test from 'node:test';
import assert from 'node:assert/strict';
import { createStartingPointsService, DEFAULT_STARTING_ARTISTS, validateChartSnapshot } from './starting-points.mjs';

const now = Date.parse('2026-11-18T12:00:00Z');
const artistIds = ['5', '4', '3', '2', '1'];
const snapshot = () => ({ period: 'day', capturedAt: new Date(now).toISOString(), artistIds: [...artistIds] });
const profile = id => ({ id: `genius:${id}`, name: `Artist ${id}`, providerIds: { genius: id }, image: `https://images.genius.com/${id}.1000x1000x1.jpg`, imageSource: 'Genius' });
const genius = overrides => ({ configured: true, artist: async id => profile(id), ...overrides });

test('a current imported daily chart keeps its five-artist order and source-resolution portraits', async () => {
  const service = createStartingPointsService(genius(), { now: () => now, loadSnapshot: async () => snapshot() });
  const result = await service();
  assert.equal(result.chartAvailable, true);
  assert.deepEqual(result.artists.map(artist => artist.providerIds.genius), artistIds);
  assert.deepEqual(result.artists.map(artist => artist.rank), [1, 2, 3, 4, 5]);
  assert.equal(result.artists[0].image, profile('5').image);
  assert.equal(result.source.kind, 'daily_artist_chart_snapshot');
  assert.equal(result.source.live, false, 'a manually imported chart must not claim to be live');
  assert.match(result.note, /not search frequency/);
});

test('without a verified chart, the five original suggestions have photos but never ranks', async () => {
  const result = await createStartingPointsService(genius(), { now: () => now })();
  assert.equal(result.chartAvailable, false);
  assert.equal(result.source.kind, 'suggestions');
  assert.deepEqual(result.artists.map(artist => artist.providerIds.genius), DEFAULT_STARTING_ARTISTS.map(artist => artist.id));
  assert.ok(result.artists.every(artist => artist.image && artist.rank === null));
  assert.equal(result.source.capturedAt, null);
  assert.match(result.note, /not ranked artists/);
});

test('stale, future, malformed, duplicate, and unsafe chart identifiers are rejected', () => {
  for (const value of [
    null, {}, { ...snapshot(), period: 'search' }, { ...snapshot(), artistIds: ['1'] },
    { ...snapshot(), artistIds: ['1', '1', '2', '3', '4'] },
    { ...snapshot(), artistIds: ['1', '2', '3', '4', 'https://attacker.example'] },
    { ...snapshot(), artistIds: [1, 2, 3, 4, 5] },
    { ...snapshot(), capturedAt: new Date(now - 86_400_001).toISOString() },
    { ...snapshot(), capturedAt: new Date(now + 300_001).toISOString() },
    ...[null, [], [1, 2, 2, 4, 5], [1, 2, 3, 4, -5], [1, 2, 3, 4, 5.5]].map(positions => ({ ...snapshot(), positions })),
    { ...snapshot(), scope: 'search_rankings' }
  ]) assert.equal(validateChartSnapshot(value, now), null);
  assert.ok(validateChartSnapshot(snapshot(), now));
});

test('recording-artist snapshots retain original positions instead of renumbering filtered accounts', async () => {
  const result = await createStartingPointsService(genius(), { now: () => now,
    loadSnapshot: async () => ({ ...snapshot(), positions: [3, 4, 6, 7, 8], scope: 'recording_artists' }) })();
  assert.deepEqual(result.artists.map(artist => artist.rank), [3, 4, 6, 7, 8]);
  assert.equal(result.source.scope, 'recording_artists');
  assert.match(result.note, /Translation\/editorial accounts excluded/);
});

test('cached chart data expires at the snapshot deadline, not ten minutes later', async () => {
  let time = now + 86_400_000 - 1000;
  const service = createStartingPointsService(genius(), { now: () => time, loadSnapshot: async () => snapshot() });
  assert.equal((await service()).chartAvailable, true);
  time += 1000;
  const result = await service();
  assert.equal(result.chartAvailable, false);
  assert.ok(result.artists.every(artist => artist.rank === null));
});

test('a snapshot that expires while profiles load cannot be published as current', async () => {
  let time = now + 86_400_000 - 1000;
  const service = createStartingPointsService(genius({ artist: async id => { time += 500; return profile(id); } }),
    { now: () => time, loadSnapshot: async () => snapshot() });
  assert.equal((await service()).chartAvailable, false);
});

test('a chart with a missing portrait falls back to explicitly unranked suggestions', async () => {
  const result = await createStartingPointsService(genius({ artist: async id => ({ ...profile(id), image: id === '5' ? '' : profile(id).image }) }),
    { now: () => now, loadSnapshot: async () => snapshot() })();
  assert.equal(result.chartAvailable, false);
  assert.ok(result.artists.every(artist => artist.rank === null));
});

test('concurrent startup requests and refreshes reuse one bounded profile lookup', async () => {
  let calls = 0;
  const service = createStartingPointsService(genius({ artist: async id => { calls++; return profile(id); } }), { now: () => now });
  const [first, second] = await Promise.all([service(), service()]);
  assert.deepEqual(first, second);
  await service();
  assert.equal(calls, 5);
});

test('a cached chart expires at its snapshot deadline, not ten minutes after the request', async () => {
  let clock = now, loads = 0;
  const value = { ...snapshot(), positions: [3, 4, 6, 7, 8], scope: 'recording_artists', capturedAt: new Date(now - 86_400_000 + 1_000).toISOString() };
  const service = createStartingPointsService(genius(), { now: () => clock, loadSnapshot: async () => { loads++; return value; } });
  const result = await service();
  assert.deepEqual(result.artists.map(artist => artist.rank), [3, 4, 6, 7, 8]);
  assert.equal(result.source.scope, 'recording_artists');
  assert.match(result.note, /original chart positions retained/);
  clock += 999;
  assert.equal((await service()).chartAvailable, true);
  assert.equal(loads, 1);
  clock++;
  assert.equal((await service()).chartAvailable, false);
  assert.equal(loads, 2);
});

test('a snapshot that expires during hydration and a chart without portraits fall back honestly', async () => {
  let clock = now;
  const value = { ...snapshot(), capturedAt: new Date(now - 86_400_000 + 1).toISOString() };
  const result = await createStartingPointsService(genius({ artist: async id => { clock += 5; return profile(id); } }),
    { now: () => clock, loadSnapshot: async () => value })();
  assert.equal(result.chartAvailable, false);
  const noPhoto = await createStartingPointsService(genius({ artist: async id => ({ ...profile(id), image: artistIds.includes(id) ? '' : profile(id).image }) }),
    { now: () => now, loadSnapshot: async () => snapshot() })();
  assert.equal(noPhoto.chartAvailable, false);
  assert.ok(noPhoto.artists.every(artist => artist.image && artist.rank === null));
});

test('missing credentials do not cause anonymous calls or fake ranking data', async () => {
  let calls = 0;
  const result = await createStartingPointsService(genius({ configured: false, artist: async () => { calls++; throw new Error('Must not call'); } }))();
  assert.equal(calls, 0);
  assert.equal(result.artists.length, 5);
  assert.equal(result.chartAvailable, false);
  assert.ok(result.artists.every(artist => !artist.image && artist.rank === null));
});

test('bad snapshot contents and mismatched profile IDs never become chart results or leak private data', async () => {
  const fromBadFile = await createStartingPointsService(genius(), { loadSnapshot: async () => { throw new Error('/private/secret-path private-token'); } })();
  assert.equal(fromBadFile.chartAvailable, false);
  assert.doesNotMatch(JSON.stringify(fromBadFile), /secret-path|private-token/);
  const mismatch = await createStartingPointsService(genius({ artist: async id => artistIds.includes(id) ? profile('999') : profile(id) }), { now: () => now, loadSnapshot: async () => snapshot() })();
  assert.equal(mismatch.chartAvailable, false);
  assert.ok(mismatch.artists.every(artist => !artistIds.includes(artist.providerIds.genius)));
});
