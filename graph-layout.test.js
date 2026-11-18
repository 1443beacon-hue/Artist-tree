import test from 'node:test';
import assert from 'node:assert/strict';
import { separateArtists, layoutNearbyArtists, bundleConnections } from './graph-layout.js';

function assertNoOverlap(layout) {
  const nodes = [...layout.values()];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i].footprint, b = nodes[j].footprint;
    assert.ok(Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2,
      `overlap: ${nodes[i].name} / ${nodes[j].name}`);
  }
}

test('crowded portraits and long captions are separated at desktop and narrow widths', () => {
  const artists = new Map(Array.from({ length: 40 }, (_, index) => [String(index), {
    name: index % 3 ? `Artist ${index}` : `An unusually long artist name ${index}`, x: 500, y: 300, size: index % 2 ? 96 : 135
  }]));
  for (const width of [335, 590, 1044]) {
    const result = separateArtists(artists, { width, height: 520, compact: width < 700 });
    assert.equal(result.size, 40);
    assertNoOverlap(result);
  }
});

test('already clear positions stay stable while a newly added artist finds free space', () => {
  const first = new Map([
    ['a', { name: 'A', x: 150, y: 200, size: 96 }],
    ['b', { name: 'B', x: 700, y: 450, size: 96 }]
  ]);
  const initial = separateArtists(first);
  const expanded = new Map([...first, ['c', { name: 'C', x: 150, y: 200, size: 96 }]]);
  const result = separateArtists(expanded, { previous: initial });
  for (const id of ['a', 'b']) {
    assert.equal(result.get(id).x, initial.get(id).x);
    assert.equal(result.get(id).y, initial.get(id).y);
  }
  assertNoOverlap(result);
  assert.equal(first.get('a').x, 150, 'catalogue coordinates are not mutated');
});

test('responsive photo sizes and captions are included in collision footprints', () => {
  const artists = new Map([['a', { name: 'A', x: 100, y: 100, size: 73 }]]);
  const result = separateArtists(artists, { photoSizes: new Map([['a', 164]]) });
  assert.ok(result.get('a').footprint.w > 164);
  assert.ok(result.get('a').footprint.h > 164 + 50);
});

test('newly visible branches ignore stale catalogue coordinates and stay close in CSS pixels', () => {
  for (const width of [350, 590, 1044, 1800]) {
    const root = { name: 'Root', x: 500, y: 300, size: 164 };
    const initial = separateArtists(new Map([['root', root]]), { width, height: 520 });
    const artists = new Map([['root', root], ...Array.from({ length: 4 }, (_, i) => [String(i), {
      name: `Guest ${i}`, x: 9000 + i * 500, y: -9000, size: 96
    }])]);
    const edges = [...artists.keys()].slice(1).map(id => ({ a: 'root', b: id }));
    const result = layoutNearbyArtists(artists, { width, height: 520, previous: initial, edges, anchorId: 'root' });
    assertNoOverlap(result);
    assert.equal(result.get('root').x, root.x);
    assert.equal(result.get('root').y, root.y);
    for (const [id, node] of result) {
      if (id === 'root') continue;
      assert.ok(Math.hypot(node.footprint.x - initial.get('root').footprint.x, node.footprint.y - initial.get('root').footprint.y) < 340,
        `branch ${id} is too far at width ${width}`);
    }
  }
});

test('open space preserves existing nodes; crowded local space pushes neighbors but not distant nodes', () => {
  const root = { name: 'Root', x: 500, y: 300, size: 96 };
  const far = { name: 'Far', x: 2400, y: 1900, size: 96 };
  const ring = Array.from({ length: 8 }, (_, i) => {
    const angle = i * Math.PI / 4;
    return [`n${i}`, { name: `Neighbor ${i}`, x: 500 + Math.cos(angle) * 210, y: 300 + Math.sin(angle) * 250, size: 96 }];
  });
  const artists = new Map([['root', root], ['far', far], ...ring]);
  let previous = separateArtists(artists);
  const stable = layoutNearbyArtists(artists, { previous, anchorId: 'root' });
  for (const [id, node] of stable) assert.ok(Math.hypot(node.x - previous.get(id).x, node.y - previous.get(id).y) < .001);
  previous = stable;
  for (let i = 0; i < 4; i++) artists.set(`new${i}`, { name: `New ${i}`, x: 9999, y: 9999, size: 96 });
  const result = layoutNearbyArtists(artists, { previous, anchorId: 'root', edges: [0, 1, 2, 3].map(i => ({ a: 'root', b: `new${i}` })) });
  assertNoOverlap(result);
  assert.equal(result.get('far').x, far.x);
  assert.equal(result.get('far').y, far.y);
  assert.equal(result.get('root').x, root.x);
  assert.ok(ring.some(([id]) => Math.hypot(result.get(id).x - previous.get(id).x, result.get(id).y - previous.get(id).y) > 1));
});

test('dense layouts remain bounded, non-overlapping, and stable on unchanged streamed updates', () => {
  const artists = new Map([['root', { name: 'Root', x: 500, y: 300, size: 135 }]]);
  let previous = new Map(), edges = [];
  for (let group = 0; group < 10; group++) {
    for (let i = 0; i < 4; i++) {
      const id = `g${group}-${i}`;
      artists.set(id, { name: `Artist ${id}`, x: 500, y: 300, size: 96 });
      edges.push({ a: 'root', b: id });
    }
    previous = layoutNearbyArtists(artists, { previous, edges, anchorId: 'root', width: 590, height: 520 });
    assertNoOverlap(previous);
    assert.ok([...previous.values()].every(node => Number.isFinite(node.x) && Math.abs(node.x) < 10_000));
  }
  const repeated = layoutNearbyArtists(artists, { previous, edges, anchorId: 'root', width: 590, height: 520 });
  for (const [id, node] of repeated) assert.ok(Math.hypot(node.x - previous.get(id).x, node.y - previous.get(id).y) < .001);
});

test('branches follow their visible endpoint outside the canvas, not the original root', () => {
  const artists = new Map([
    ['root', { name: 'Original root', x: 500, y: 300, size: 164 }],
    ['endpoint', { name: 'Endpoint', x: 2300, y: -1200, size: 96 }]
  ]);
  const previous = separateArtists(artists, { width: 590, height: 520 });
  artists.set('new', { name: 'New guest', x: 500, y: 300, size: 96 });
  const result = layoutNearbyArtists(artists, { previous, width: 590, height: 520, anchorId: 'endpoint',
    edges: [{ a: 'root', b: 'endpoint' }, { a: 'endpoint', b: 'new' }] });
  assertNoOverlap(result);
  const a = result.get('endpoint').footprint, b = result.get('new').footprint;
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 280);
  assert.equal(result.get('root').x, artists.get('root').x);
  assert.equal(result.get('endpoint').x, artists.get('endpoint').x);
});

test('one line per artist pair bundles collaboration, production, and multiple credits', () => {
  const evidence = { source: 'Genius', provider: 'genius', url: 'https://genius.com/song-lyrics', work: 'Song', origin: 'live' };
  const result = bundleConnections([
    { a: 'a', b: 'b', type: 'collaboration', ...evidence },
    { a: 'b', b: 'a', type: 'production', ...evidence },
    { a: 'a', b: 'b', type: 'production', ...evidence },
    { a: 'a', b: 'c', type: 'membership', work: 'Band membership' }
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].type, 'mixed');
  assert.deepEqual(result[0].types, ['collaboration', 'production']);
  assert.equal(result[0].evidence.length, 2, 'duplicate source evidence is not printed twice');
  assert.equal(result[0].evidence[0].work, 'Song');
});

test('source records from different releases are retained, not claimed to be separate songs', () => {
  const result = bundleConnections([
    { a: 'a', b: 'b', type: 'production', evidence: [{ work: 'Song', url: 'https://genius.com/song', source: 'Genius' }] },
    { a: 'a', b: 'b', type: 'production', evidence: [{ work: 'Song (Remastered)', url: 'https://musicbrainz.org/recording/other', source: 'MusicBrainz' }] }
  ]);
  assert.equal(result[0].evidence.length, 2);
  assert.equal(result[0].distinctSongCount, undefined);
});
