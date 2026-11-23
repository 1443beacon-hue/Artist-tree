import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudMapStore } from './cloud-maps.js';

const fixture = () => ({ version: 1, id: 'map-original', scope: 'main', name: 'My map', savedAt: '2026-11-23T12:00:00Z',
  graph: { artists: [{ id: 'genius:1', name: 'Artist', x: 100, y: 200, accessToken: 'private-secret' }], edges: [],
    explorer: { selected: 'genius:1', visible: ['genius:1'], expanded: [], trail: ['genius:1'], routes: [['genius:1', ['genius:1']]] } },
  camera: { zoom: 1, pan: { x: 0, y: 0 }, width: 1000, height: 650 } });
function setup() {
  let id = 'alice', version = 0, responder = async () => ({ data: [], error: null });
  const requests = [];
  const account = { capture() {
    if (!id) throw new Error('Sign in');
    const owner = id, previous = version;
    const client = { from(table) {
      const request = { table, filters: [] }; requests.push(request);
      const query = {
        select(value) { request.select = value; return query; },
        eq(key, value) { request.filters.push([key, value]); return query; },
        order(...value) { request.order = value; return query; },
        limit(value) { request.limit = value; return query; },
        single() { request.single = true; return query; },
        insert(value) { request.insert = value; return query; },
        upsert(value, options) { request.insert = value; request.upsert = options; return query; },
        delete() { request.delete = true; return query; },
        then(resolve, reject) { return responder(request).then(resolve, reject); }
      };
      return query;
    } };
    return { client, id: owner, assertCurrent() { if (owner !== id || previous !== version) throw new Error('Your account changed.'); } };
  } };
  return { account, requests, store: createCloudMapStore({ account, makeId: () => 'new-map', now: () => '2026-11-23T12:00:00Z' }),
    switchUser(value) { id = value; version++; },
    respond(value) { responder = value; } };
}

test('cloud queries are owner/view-scoped and lists do not download every graph', async () => {
  const context = setup();
  await context.store.list();
  assert.equal(context.requests[0].table, 'artistree_saved_trees');
  assert.deepEqual(context.requests[0].filters, [['owner_id', 'alice'], ['scope', 'main']]);
  assert.equal(context.requests[0].select.includes('snapshot'), false);
  context.respond(async () => ({ data: { snapshot: fixture() } }));
  assert.equal((await context.store.get('map-original')).graph.artists[0].id, 'genius:1');
  assert.deepEqual(context.requests[1].filters.at(-1), ['id', 'map-original']);
  context.respond(async () => ({ data: [{ id: 'map-original' }] }));
  await context.store.remove('map-original');
  assert.equal(context.requests[2].delete, true);
  assert.deepEqual(context.requests[2].filters, [['owner_id', 'alice'], ['scope', 'main'], ['id', 'map-original']]);
});

test('cloud saving uses the same strict snapshot whitelist and explicit idempotent imports never alter browser copies', async () => {
  const context = setup(), value = fixture();
  context.respond(async () => ({ data: [{ id: 'saved' }] }));
  assert.equal((await context.store.save(value)).id, 'new-map');
  assert.equal(context.requests[0].insert.owner_id, 'alice');
  assert.doesNotMatch(JSON.stringify(context.requests[0]), /private-secret|accessToken/);
  await context.store.import(value);
  assert.equal(context.requests[1].insert.id, 'map-original');
  assert.deepEqual(context.requests[1].upsert, { onConflict: 'owner_id,scope,id', ignoreDuplicates: true });
  assert.equal(value.graph.artists[0].accessToken, 'private-secret', 'caller object is not mutated');
  context.respond(async () => ({ data: [] }));
  await assert.rejects(context.store.import(value), /already in your account/);
});

test('late list/open/save/delete responses cannot cross account switches, even signing back into the same account', async () => {
  for (const action of ['list', 'get', 'save', 'remove']) {
    const context = setup();
    let finish;
    context.respond(() => new Promise(resolve => { finish = resolve; }));
    const request = context.store[action](action === 'save' ? fixture() : 'map-original');
    await new Promise(resolve => setImmediate(resolve));
    context.switchUser(null); context.switchUser('alice');
    finish({ data: action === 'get' ? { snapshot: fixture() } : [{ id: 'map-original' }] });
    await assert.rejects(request, /account changed/);
  }
});

test('invalid scope/payloads and network failures cannot silently fall back to browser storage', async () => {
  const context = setup();
  assert.throws(() => createCloudMapStore({ account: context.account, scope: 'other' }), /Invalid/);
  assert.throws(() => context.store.save({ ...fixture(), graph: {} }), /invalid or too large/);
  context.respond(async () => ({ data: { snapshot: { ...fixture(), scope: 'spotify' } } }));
  await assert.rejects(context.store.get('map-original'), /invalid/);
  context.respond(async () => ({ error: { message: 'private-backend-diagnostic', code: '42501' } }));
  await assert.rejects(context.store.list(), error => !error.message.includes('private-backend-diagnostic') && error.message.includes('No browser saves'));
  context.respond(async () => { throw new Error('private-fetch-diagnostic'); });
  await assert.rejects(context.store.remove('map-original'), /No browser saves/);
  context.respond(async () => ({ error: { code: 'P0001' } }));
  await assert.rejects(context.store.save(fixture()), /up to 20/);
});
