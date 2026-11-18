import test from 'node:test';
import assert from 'node:assert/strict';
import { separateArtists, bundleConnections } from './graph-layout.js';

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
