import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapStore, validateSavedMap } from './saved-maps.js';

const profile = id => ({ id: `genius:${id}`, name: `Artist ${id}`, providerIds: { genius: String(id) },
  x: id * 100, y: 300, size: 96, origin: 'live', image: 'https://images.genius.com/photo.jpg', imageSource: 'Genius', tags: ['ARTIST'] });
const fixture = () => ({
  version: 1, id: 'test-map', name: 'My map', savedAt: '2026-11-18T12:00:00Z', scope: 'main',
  graph: { artists: [profile(1), profile(2)], edges: [{ a: 'genius:1', b: 'genius:2', type: 'production', work: 'Actual track',
    provider: 'genius', source: 'Genius', url: 'https://genius.com/track-lyrics', origin: 'live',
    evidence: [{ work: 'Actual track', provider: 'genius', source: 'Genius', url: 'https://genius.com/track-lyrics', origin: 'live' }] }],
  explorer: { selected: 'genius:2', visible: ['genius:1', 'genius:2'], expanded: ['genius:1'], trail: ['genius:1', 'genius:2'],
    routes: [['genius:1', ['genius:1']], ['genius:2', ['genius:1', 'genius:2']]] } },
  camera: { zoom: 1.3, pan: { x: -120, y: 84 }, width: 1000, height: 650 }
});
function storage() {
  const entries = new Map();
  return { entries, getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
}
const setup = (target = storage(), scope = 'main') => {
  let serial = 0;
  return { target, store: createMapStore({ getStorage: () => target, scope, makeId: () => `map-${++serial}`, now: () => '2026-11-18T12:00:00Z' }) };
};

test('saved maps round-trip graph geometry, path, camera, identities, and credit provenance', () => {
  const { store } = setup();
  const original = fixture(), saved = store.save(original);
  const [loaded] = store.list();
  assert.equal(loaded.id, saved.id);
  assert.deepEqual(loaded.camera, original.camera);
  assert.deepEqual(loaded.graph.explorer, original.graph.explorer);
  assert.equal(loaded.graph.edges[0].evidence[0].url, original.graph.edges[0].evidence[0].url);
  assert.deepEqual(loaded.graph.artists.map(artist => [artist.id, artist.x, artist.y]), original.graph.artists.map(artist => [artist.id, artist.x, artist.y]));
  loaded.graph.explorer.trail.pop();
  assert.equal(store.list()[0].graph.explorer.trail.length, 2);
});

test('snapshot serialization whitelists display data, excluding secrets and active lookup state', () => {
  const { store, target } = setup(), value = fixture();
  value.graph.artists[0].accessToken = 'private-token';
  value.graph.artists[0].rawResponse = { authorization: 'private-token' };
  value.graph.edges[0].debug = 'private-token';
  value.graph.explorer.activeLookup = 'private-token';
  value.camera.apiKey = 'private-token';
  store.save(value);
  const raw = [...target.entries.values()].join('');
  assert.doesNotMatch(raw, /private-token|accessToken|authorization|rawResponse|activeLookup|apiKey/);
});

test('invalid identities, unsafe URLs, invisible edge ends, and invented path links cannot load', () => {
  const corruptions = [
    value => { value.id = undefined; },
    value => { value.version = 99; },
    value => { value.graph.artists[0].id = '__proto__'; },
    value => { value.graph.artists[0].id = 'SPOTIFY:2xvtxDNInKDV4AvGmjw6d1'; },
    value => { value.graph.artists[0].image = 'javascript:alert(1)'; },
    value => { value.graph.artists[0].links = { genius: 'https://secret@example.com/' }; },
    value => { value.graph.artists[0].x = Infinity; },
    value => { value.graph.edges[0].b = 'genius:999'; },
    value => { value.graph.edges.length = 0; },
    value => { value.graph.explorer.trail = ['genius:2', 'genius:1']; },
    value => { value.graph.explorer.visible.push('genius:1'); },
    value => { value.graph.artists.push(profile(1)); },
    value => { value.camera.zoom = 4; }
  ];
  for (const corrupt of corruptions) { const value = fixture(); corrupt(value); assert.equal(validateSavedMap(value, 'main'), null); }
});

test('main and Spotify saved maps are isolated, including nested evidence and API IDs', () => {
  const target = storage(), { store } = setup(target);
  store.save(fixture());
  assert.equal(setup(target, 'spotify').store.list().length, 0);
  assert.equal(validateSavedMap(fixture(), 'spotify'), null);
  for (const corrupt of [
    value => { value.graph.artists[0].imageSource = 'Spotify'; },
    value => { value.graph.artists[0].apiId = 'spotify:2xvtxDNInKDV4AvGmjw6d1'; },
    value => { value.graph.edges[0].evidence[0].provider = 'spotify'; }
  ]) { const value = fixture(); corrupt(value); assert.equal(validateSavedMap(value, 'main'), null); }
  const spotify = fixture(), id = 'spotify:2xvtxDNInKDV4AvGmjw6d1';
  spotify.scope = 'spotify'; spotify.graph.artists = [{ ...profile(1), id, apiId: id, providerIds: { spotify: id.split(':')[1] }, imageSource: 'Spotify' }];
  spotify.graph.edges = [];
  spotify.graph.explorer = { selected: id, visible: [id], expanded: [], trail: [id], routes: [[id, [id]]] };
  assert.ok(validateSavedMap(spotify, 'spotify'));
});

test('damaged or blocked storage is reported without overwriting existing user data', () => {
  const { store, target } = setup();
  target.entries.set('artistree.saved-maps.v1.main', '{damaged existing data');
  assert.throws(() => store.save(fixture()), /Nothing was changed/);
  assert.equal(target.getItem('artistree.saved-maps.v1.main'), '{damaged existing data');
  const blocked = createMapStore({ getStorage() { throw new Error('Private browser diagnostic'); } });
  assert.throws(() => blocked.list(), /Browser storage may be blocked/);
});

test('quota failures, capacity limits, and deletion preserve other maps', () => {
  const { store, target } = setup();
  const first = store.save(fixture());
  const before = target.getItem('artistree.saved-maps.v1.main');
  const setter = target.setItem;
  target.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.throws(() => store.save(fixture()), /full or blocked/);
  assert.equal(target.getItem('artistree.saved-maps.v1.main'), before);
  target.setItem = setter;
  for (let i = 0; i < 19; i++) store.save(fixture());
  assert.throws(() => store.save(fixture()), /up to 20/);
  store.remove(first.id);
  assert.equal(store.list().length, 19);
  assert.equal(store.list().some(map => map.id === first.id), false);
});
