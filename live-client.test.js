import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLiveGraph, requestId, fetchApiStatus, searchLiveArtists, fetchConnections, fetchConnectionPages } from './live-client.js';
import { createExplorer } from './explorer-state.js';

const profile = (id, name, providerIds) => ({ id, name, providerIds, links: {}, origin: 'live', tags: ['ARTIST'] });

test('live profiles reuse verified seed IDs, preserve positions, and keep source provenance', () => {
  const artists = { seed: { name: 'Root', x: 100, y: 200, size: 120, providerIds: { apple: '1' }, image: 'https://example.com/ref.jpg', imageSource: 'Apple Music' } };
  const edges = [];
  const root = profile('apple:1', 'Root', { apple: '1' });
  const guest = profile('genius:2', 'Guest', { genius: '2' });
  const payload = { artist: root, artists: [root, guest], edges: [{ a: root.id, b: guest.id, type: 'production', work: 'Track', source: 'Genius', url: 'https://genius.com/track-lyrics' }] };
  const result = mergeLiveGraph(artists, edges, payload, 'seed');
  assert.equal(result.artistId, 'seed');
  assert.equal(artists.seed.x, 100);
  assert.equal(artists.seed.y, 200);
  assert.equal(artists.seed.image, 'https://example.com/ref.jpg');
  assert.equal(requestId(artists.seed), 'apple:1');
  assert.equal(edges[0].a, 'seed');
  assert.equal(edges[0].origin, 'live');
  assert.equal(edges[0].source, 'Genius');
  assert.ok(Number.isFinite(artists['genius:2'].x));
});

test('same-name live artists are not merged without a shared provider ID', () => {
  const artists = { seed: { name: 'Same', x: 100, y: 200, providerIds: { apple: '1' } } };
  const newcomer = profile('genius:2', 'Same', { genius: '2' });
  mergeLiveGraph(artists, [], { artist: newcomer, artists: [newcomer] }, 'seed');
  assert.equal(Object.keys(artists).length, 2);
});

test('linked Bladee profiles become one node and self-connections disappear', () => {
  const mbid = 'cd689e77-dfdd-4f81-b50c-5e5a3f5e38a4';
  const genius = { ...profile('genius:83959', 'Bladee', { genius: '83959' }), x: 500, y: 300, links: { genius: 'https://genius.com/artists/Bladee' } };
  const mb = { ...profile(`musicbrainz:${mbid}`, 'Bladee', { musicbrainz: mbid }), x: 700, y: 300 };
  const artists = { [genius.id]: genius, [mb.id]: mb };
  const edges = [{ a: genius.id, b: mb.id, type: 'collaboration' }];
  const linked = { ...mb, links: { genius: 'https://genius.com/artists/Bladee' } };
  const result = mergeLiveGraph(artists, edges, { artist: linked, artists: [linked], edges: [] }, genius.id);
  assert.equal(Object.keys(artists).length, 1);
  assert.equal(result.artistId, genius.id);
  assert.equal(artists[genius.id].providerIds.musicbrainz, mbid);
  assert.equal(artists[genius.id].providerIds.genius, '83959');
  assert.equal(edges.length, 0);
});

test('new pages update the same relationship instead of creating duplicate lines', () => {
  const a = profile('apple:1', 'A', { apple: '1' });
  const b = profile('genius:2', 'B', { genius: '2' });
  const artists = {}, edges = [];
  const edge = { a: a.id, b: b.id, type: 'collaboration', source: 'Genius', work: 'First' };
  mergeLiveGraph(artists, edges, { artist: a, artists: [a, b], edges: [edge] }, 'missing');
  mergeLiveGraph(artists, edges, { artist: a, artists: [a, b], edges: [{ ...edge, work: '2 credited works' }] }, a.id);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].work, '2 credited works');
});

test('verified aliases can update explorer selection/history after merging duplicate source results', () => {
  const artists = {
    seed: { ...profile('seed', 'A', { apple: '1' }), x: 100, y: 200 },
    duplicate: { ...profile('duplicate', 'A', { genius: '2' }), x: 300, y: 200 }
  };
  const explorer = createExplorer({ artists, edges: [], seeds: ['seed'], initialArtist: 'seed' });
  explorer.select('duplicate');
  const raw = profile('apple:1', 'A', { apple: '1', genius: '2' });
  const result = mergeLiveGraph(artists, [], { artist: raw, artists: [raw] }, 'seed');
  explorer.remapAliases(result.aliases);
  assert.equal(explorer.selected, 'seed');
  assert.deepEqual([...explorer.visibleIds], ['seed']);
  assert.equal(artists.duplicate, undefined);
  explorer.back();
  assert.equal(explorer.selected, 'seed');
});

test('API client reports old servers and does not embed any provider credentials', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    await assert.rejects(fetchApiStatus(), /Restart the local server/);
    globalThis.fetch = async (url, options) => {
      assert.match(url, /scope=spotify/);
      assert.deepEqual(options.headers, { Accept: 'application/json' });
      return Response.json({ artists: [], spotifyArtists: [] });
    };
    await searchLiveArtists('Artist', undefined, 'spotify');
  } finally { globalThis.fetch = original; }
});

test('paged reveal can be undone without discarding existing seeds', () => {
  const artists = { a: {}, b: {}, c: {}, d: {} };
  const explorer = createExplorer({ artists, edges: [{ a: 'a', b: 'b' }, { a: 'a', b: 'c' }, { a: 'a', b: 'd' }], seeds: ['a'], initialArtist: 'a' });
  explorer.select('a', { maxNew: 1 });
  assert.deepEqual([...explorer.visibleIds], ['a', 'b']);
  explorer.reveal(['c', 'd'], { remember: true });
  assert.equal(explorer.visibleIds.size, 4);
  explorer.back();
  assert.deepEqual([...explorer.visibleIds], ['a', 'b']);
});

test('the browser requests at most four neighbors per expansion', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async url => {
      assert.equal(new URL(url, 'http://localhost').searchParams.get('limit'), '4');
      return Response.json({});
    };
    await fetchConnections('genius:1', 'Artist', 0);
  } finally { globalThis.fetch = original; }
});

test('expansion skips visible collaborators and fills a four-person budget across pages', async () => {
  const original = globalThis.fetch;
  const offsets = [];
  const people = Array.from({ length: 12 }, (_, i) => profile(`genius:${i + 1}`, `Person ${i + 1}`, { genius: String(i + 1) }));
  const root = profile('genius:130', 'Drake', { genius: '130' });
  const artists = Object.fromEntries([root, ...people.slice(0, 6)].map(person => [person.id, { ...person, x: 500, y: 300 }]));
  const edges = [];
  const explorer = createExplorer({ artists, edges, seeds: Object.keys(artists), initialArtist: root.id });
  let remaining = 4;
  let remembered = false;
  try {
    globalThis.fetch = async value => {
      const url = new URL(value, 'http://localhost');
      const offset = Number(url.searchParams.get('offset'));
      offsets.push(offset);
      const neighbors = people.slice(offset, offset + 4);
      return Response.json({ artist: root, artists: [root, ...neighbors], edges: neighbors.map(person => ({ a: root.id, b: person.id, type: 'collaboration' })),
        page: { nextOffset: offset + 4, hasMore: offset + 4 < people.length } });
    };
    const result = await fetchConnectionPages(root.id, root.name, 0, undefined, page => {
      const merged = mergeLiveGraph(artists, edges, page, root.id);
      const visible = explorer.visibleIds;
      const unseen = merged.addedIds.filter(id => !visible.has(id)).slice(0, remaining);
      explorer.reveal(unseen, { remember: !remembered });
      if (unseen.length) remembered = true;
      remaining -= unseen.length;
      return remaining > 0;
    });
    assert.deepEqual(offsets, [0, 4, 8]);
    assert.equal(explorer.visibleIds.size, 11);
    assert.equal(result.page.nextOffset, 12);
    assert.equal(remaining, 0);
    assert.equal(Object.keys(artists).length, 13, 'unrevealed fetched artists remain cached for the next click');
    explorer.back();
    assert.equal(explorer.visibleIds.size, 7, 'one Back undoes the whole multi-page gesture');
    assert.equal(explorer.canGoBack, false);
  } finally { globalThis.fetch = original; }
});

test('connection paging stops when enough new artists are accepted', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ page: { nextOffset: 4, hasMore: true } });
    };
    await fetchConnectionPages('genius:1', 'Artist', 0, undefined, () => false);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('exhausted, stalled, and excessively overlapping pages cannot loop forever', async () => {
  const original = globalThis.fetch;
  try {
    for (const mode of ['exhausted', 'stalled', 'overlapping']) {
      let calls = 0;
      globalThis.fetch = async value => {
        calls++;
        const offset = Number(new URL(value, 'http://localhost').searchParams.get('offset'));
        return Response.json({ page: { nextOffset: mode === 'stalled' ? offset : offset + 4, hasMore: mode !== 'exhausted' } });
      };
      await fetchConnectionPages('genius:1', 'Artist', 0, undefined, () => true);
      assert.equal(calls, mode === 'overlapping' ? 8 : 1, mode);
    }
  } finally { globalThis.fetch = original; }
});

test('cancelled expansions do not accept a page or continue fetching', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  let accepted = 0;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      controller.abort();
      return Response.json({ page: { nextOffset: 4, hasMore: true } });
    };
    await assert.rejects(fetchConnectionPages('genius:1', 'Artist', 0, controller.signal, () => { accepted++; return true; }), { name: 'AbortError' });
    assert.equal(calls, 1);
    assert.equal(accepted, 0);
  } finally { globalThis.fetch = original; }
});

test('progressive credit updates are delivered before the response finishes, including split UTF-8 chunks', async () => {
  const original = globalThis.fetch;
  let streamController;
  const encoder = new TextEncoder();
  const early = { artist: { name: 'Rogét' }, pending: true, page: { nextOffset: 4, hasMore: false } };
  const final = { ...early, pending: false };
  const seen = [];
  const first = Promise.withResolvers();
  try {
    globalThis.fetch = async url => {
      assert.equal(new URL(url, 'http://localhost').searchParams.get('stream'), '1');
      return new Response(new ReadableStream({ start(controller) { streamController = controller; } }), { headers: { 'content-type': 'application/x-ndjson' } });
    };
    const request = fetchConnectionPages('genius:1', 'Artist', 0, undefined, update => { seen.push(update); first.resolve(); return false; });
    await Promise.resolve();
    const bytes = encoder.encode(JSON.stringify(early) + '\n');
    const split = bytes.indexOf(0xc3) + 1;
    streamController.enqueue(bytes.slice(0, split));
    streamController.enqueue(bytes.slice(split));
    await first.promise;
    assert.equal(seen.length, 1);
    assert.equal(seen[0].artist.name, 'Rogét');
    assert.equal(seen[0].pending, true);
    streamController.enqueue(encoder.encode(JSON.stringify(final) + '\n'));
    streamController.close();
    const result = await request;
    assert.equal(seen.length, 2);
    assert.equal(result.pending, false);
  } finally { globalThis.fetch = original; }
});

test('an error after an early stream update preserves the update and rejects safely', async () => {
  const original = globalThis.fetch;
  const seen = [];
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ page: { nextOffset: 4, hasMore: false }, pending: true }) + '\n'
      + JSON.stringify({ error: 'This source could not be reached.' }) + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
    await assert.rejects(fetchConnectionPages('genius:1', 'Artist', 0, undefined, update => { seen.push(update); return false; }), /could not be reached/);
    assert.equal(seen.length, 1);
  } finally { globalThis.fetch = original; }
});

test('overlapping streamed pages advance without waiting for background enrichment', async () => {
  const original = globalThis.fetch;
  const offsets = [];
  let cancelled = false;
  try {
    globalThis.fetch = async value => {
      const offset = Number(new URL(value, 'http://localhost').searchParams.get('offset'));
      offsets.push(offset);
      if (offset === 0) return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ pending: true, page: { nextOffset: 4, hasMore: true } }) + '\n')); },
        cancel() { cancelled = true; }
      }), { headers: { 'content-type': 'application/x-ndjson' } });
      return Response.json({ pending: false, page: { nextOffset: 8, hasMore: false } });
    };
    await fetchConnectionPages('genius:1', 'Artist', 0, undefined, update => update.page.nextOffset === 4);
    assert.deepEqual(offsets, [0, 4]);
    assert.equal(cancelled, true);
  } finally { globalThis.fetch = original; }
});

test('a distant end node places its new branch nearby, outside the original canvas bounds', () => {
  const root = { ...profile('genius:1', 'Root', { genius: '1' }), x: 500, y: 300 };
  const guest = profile('genius:2', 'Guest', { genius: '2' });
  const artists = { [root.id]: root };
  const position = { x: 2400, y: -800 };
  mergeLiveGraph(artists, [], { artist: root, artists: [root, guest], edges: [] }, root.id, { positions: new Map([[root.id, position]]) });
  assert.ok(Math.hypot(artists[guest.id].x - position.x, artists[guest.id].y - position.y) < 300);
  assert.equal(artists[root.id].x, 500, 'existing stored positions are not rewritten');
  assert.equal(artists[root.id].y, 300);
});

test('hidden profiles from old searches never push a newly fetched person farther away', () => {
  const root = { ...profile('genius:1', 'Root', { genius: '1' }), x: 500, y: 300 };
  const guest = profile('genius:2', 'Guest', { genius: '2' });
  const payload = { artist: root, artists: [root, guest], edges: [] };
  const positions = new Map([[root.id, { x: 500, y: 300 }]]);
  const clean = { [root.id]: { ...root } }, cached = { [root.id]: { ...root } };
  for (let i = 0; i < 200; i++) cached[`hidden${i}`] = { name: `Hidden ${i}`, x: 500 + Math.cos(i) * (150 + i * 5), y: 300 + Math.sin(i) * (150 + i * 5) };
  mergeLiveGraph(clean, [], payload, root.id, { positions });
  mergeLiveGraph(cached, [], payload, root.id, { positions });
  assert.equal(clean[guest.id].x, cached[guest.id].x);
  assert.equal(clean[guest.id].y, cached[guest.id].y);
});
