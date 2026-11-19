import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedTrackPreview, placeCreditPreview } from './credit-preview.js';

const artists = { a: { name: 'Artist A' }, b: { name: 'Artist B' }, c: { name: 'Artist C' } };
const credit = (a, b, overrides = {}) => ({ a, b, type: 'production', origin: 'live', provider: 'genius',
  work: 'Real track', url: 'https://genius.com/Artists-real-track-lyrics', ...overrides });
const preview = overrides => sharedTrackPreview({ id: 'b', route: ['a', 'b'], artists,
  visibleIds: new Set(['a', 'b', 'c']), edges: [credit('a', 'b')], ...overrides });

test('a branch preview uses its recorded parent, never an arbitrary current neighbor', () => {
  const result = preview({ edges: [credit('c', 'b', { work: 'Unrelated to A' }), credit('a', 'b')] });
  assert.equal(result.title, 'Real track');
  assert.equal(result.parentId, 'a');
  assert.equal(result.parentName, 'Artist A');
  assert.equal(result.artistName, 'Artist B');
  assert.equal(result.relation, 'Production credit');
  assert.equal(result.source, 'Genius');
  const next = preview({ id: 'c', route: ['a', 'b', 'c'], edges: [credit('a', 'c', { work: 'Root track' }), credit('b', 'c', { work: 'Branch track' })] });
  assert.equal(next.title, 'Branch track');
  assert.equal(next.parentId, 'b');
});

test('one real evidence title is shown instead of a grouped credited-works summary', () => {
  const result = preview({ edges: [credit('a', 'b', { work: '3 credited works', evidence: [
    { work: 'First verified recording', url: 'https://genius.com/Artists-first-recording-lyrics', provider: 'genius' },
    { work: 'Second verified recording', url: 'https://genius.com/Artists-second-recording-lyrics', provider: 'genius' }
  ] })] });
  assert.equal(result.title, 'First verified recording');
  assert.match(result.url, /first-recording/);
  assert.equal(preview({ edges: [credit('a', 'b', { work: '3 credited works' })] }), null);
});

test('no representative solo song, suggestion, membership, unverified relation, or artist-page URL is substituted', () => {
  for (const overrides of [
    { type: 'similar' }, { type: 'membership' }, { origin: 'reference' }, { work: '' },
    { url: 'https://genius.com/artists/Artist-b' }, { url: 'javascript:alert(1)' },
    { url: 'https://token@genius.com/Real-track-lyrics' }, { url: 'https://attacker.example/Real-track-lyrics' }
  ]) assert.equal(preview({ edges: [credit('a', 'b', overrides)] }), null);
  assert.equal(preview({ edges: [credit('a', 'c')] }), null);
  assert.equal(preview({ route: ['b'] }), null);
  assert.equal(preview({ visibleIds: new Set(['b']) }), null);
});

test('source-specific recording links preserve credit type and Spotify isolation', () => {
  assert.ok(preview({ edges: [credit('a', 'b', { provider: 'musicbrainz', url: 'https://musicbrainz.org/recording/cd689e77-dfdd-4f81-b50c-5e5a3f5e38a4' })] }));
  assert.ok(preview({ edges: [credit('a', 'b', { provider: 'apple', url: 'https://music.apple.com/us/album/track/123?i=456' })] }));
  assert.equal(preview({ edges: [credit('a', 'b', { provider: 'apple', url: 'https://music.apple.com/us/artist/artist/123' })] }), null);
  const spotify = credit('a', 'b', { type: 'collaboration', provider: 'spotify', url: 'https://open.spotify.com/track/2xvtxDNInKDV4AvGmjw6d1' });
  assert.equal(preview({ edges: [spotify] }), null);
  assert.equal(preview({ scope: 'spotify' }), null);
  assert.equal(preview({ scope: 'spotify', edges: [spotify] }).relation, 'Shared performance');
});

test('one song groups all visible verified performers and producers without inventing links between them', () => {
  const result = preview({ edges: [
    credit('a', 'b', { type: 'collaboration' }),
    credit('a', 'c'),
    credit('c', 'a'), // A reverse/duplicate relationship is still one line.
    credit('b', 'c', { url: 'https://genius.com/another-track-lyrics' })
  ] });
  assert.deepEqual(result.participants, [
    { id: 'a', name: 'Artist A' }, { id: 'b', name: 'Artist B' }, { id: 'c', name: 'Artist C' }
  ]);
  assert.deepEqual(result.edgeKeys, ['a|b', 'a|c']);
  assert.equal(result.relation, 'Shared performance');
});

test('four neighboring people credited on one song become one five-person group including the branch parent', () => {
  const people = { ...artists, d: { name: 'Artist D' }, e: { name: 'Artist E' } };
  const result = preview({ artists: people, visibleIds: new Set(Object.keys(people)),
    edges: ['b', 'c', 'd', 'e'].map((id, index) => credit('a', id, { type: index % 2 ? 'production' : 'collaboration' })) });
  assert.deepEqual(result.participants.map(person => person.id), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(result.edgeKeys, ['a|b', 'a|c', 'a|d', 'a|e']);
});

test('same-title songs, remixes, and different providers never become one group', () => {
  for (const different of [
    { url: 'https://genius.com/Another-real-track-lyrics' },
    { url: 'https://genius.com/Artists-real-track-remix-lyrics' },
    { provider: 'apple', url: 'https://music.apple.com/us/song/real-track/456' },
    { provider: 'musicbrainz', url: 'https://musicbrainz.org/recording/cd689e77-dfdd-4f81-b50c-5e5a3f5e38a4' }
  ]) {
    const result = preview({ edges: [credit('a', 'b'), credit('a', 'c', different)] });
    assert.deepEqual(result.participants.map(person => person.id), ['a', 'b']);
    assert.deepEqual(result.edgeKeys, ['a|b']);
  }
});

test('canonical source recording identities ignore tracking, fragments and regional/album slugs', () => {
  const cases = [
    ['genius', 'https://genius.com/Artists-real-track-lyrics?utm_source=map#credits',
      'https://www.genius.com/Artists-real-track-lyrics/'],
    ['musicbrainz', 'https://musicbrainz.org/recording/cd689e77-dfdd-4f81-b50c-5e5a3f5e38a4?x=1',
      'https://musicbrainz.org/recording/CD689E77-DFDD-4F81-B50C-5E5A3F5E38A4/'],
    ['apple', 'https://music.apple.com/us/album/album-title/123?i=456&ls=1',
      'https://music.apple.com/kr/song/localized-title/456'],
    ['spotify', 'https://open.spotify.com/track/2xvtxDNInKDV4AvGmjw6d1?si=abc',
      'https://open.spotify.com/intl-ko/track/2xvtxDNInKDV4AvGmjw6d1']
  ];
  for (const [provider, first, second] of cases) {
    const result = preview({ scope: provider === 'spotify' ? 'spotify' : 'main', edges: [
      credit('a', 'b', { provider, url: first }), credit('a', 'c', { provider, url: second, work: 'Localized title' })
    ] });
    assert.deepEqual(result.participants.map(person => person.id), ['a', 'b', 'c'], provider);
  }
});

test('only visible endpoints with valid recording evidence join a group', () => {
  for (const invalid of [
    { type: 'similar' }, { type: 'membership' }, { origin: 'reference' },
    { url: 'https://genius.com/artists/Artist-c' }, { work: '3 credited works' },
    { url: 'https://genius.com:444/Artists-real-track-lyrics' },
    { evidence: [{ work: 'Real track', url: 'https://genius.com/Artists-real-track-lyrics', origin: 'reference' }] },
    { evidence: [{ work: 'Real track', url: 'https://genius.com/Artists-real-track-lyrics', type: 'membership' }] }
  ]) assert.deepEqual(preview({ edges: [credit('a', 'b'), credit('a', 'c', invalid)] }).edgeKeys, ['a|b']);
  assert.deepEqual(preview({ visibleIds: new Set(['a', 'b']), edges: [credit('a', 'b'), credit('a', 'c')] }).edgeKeys, ['a|b']);
  assert.deepEqual(preview({ edges: [credit('a', 'b'), credit('c', 'hidden'), credit('c', 'missing')] }).edgeKeys, ['a|b']);
  assert.equal(preview({ edges: [credit('a', 'b', { provider: 'apple', url: 'https://music.apple.com/us/song/not-an-id' })] }), null);
});

test('grouped evidence is inspected per recording, not its summary label or another evidence URL', () => {
  const result = preview({ edges: [
    credit('a', 'b'),
    credit('a', 'c', { work: '2 credited works', evidence: [
      { work: 'Other recording', url: 'https://genius.com/Other-track-lyrics' },
      { work: 'Real track', url: 'https://genius.com/Artists-real-track-lyrics' }
    ] })
  ] });
  assert.deepEqual(result.edgeKeys, ['a|b', 'a|c']);
});

test('hovering siblings of the same track preserves member order and never mutates graph data', () => {
  const edges = [credit('a', 'b'), credit('a', 'c')], before = JSON.stringify(edges);
  const first = preview({ edges }), next = preview({ edges, id: 'c', route: ['a', 'c'] });
  assert.deepEqual(first.participants, next.participants);
  assert.deepEqual(first.edgeKeys, next.edgeKeys);
  assert.equal(first.trackKey, next.trackKey);
  first.participants.pop(); first.edgeKeys.pop();
  assert.equal(preview({ edges }).participants.length, 3);
  assert.equal(JSON.stringify(edges), before);
});

test('a participant can join by another verified pair on the same recording, without requiring a fake root edge', () => {
  const result = preview({ edges: [credit('a', 'b'), credit('b', 'c')] });
  assert.deepEqual(result.participants.map(person => person.id), ['a', 'b', 'c']);
  assert.deepEqual(result.edgeKeys, ['a|b', 'b|c']);
  assert.ok(!result.edgeKeys.includes('a|c'));
});

test('the card stays inside small viewports and moves away from the portrait and captions when space permits', () => {
  const bounds = { left: 10, right: 310, top: 10, bottom: 510 };
  for (const anchor of [
    { left: 100, right: 210, top: 200, bottom: 340 },
    { left: 0, right: 90, top: 0, bottom: 120 },
    { left: 230, right: 330, top: 400, bottom: 530 }
  ]) {
    const box = placeCreditPreview(anchor, { width: 250, height: 120 }, bounds);
    assert.ok(box.left >= bounds.left && box.right <= bounds.right);
    assert.ok(box.top >= bounds.top && box.bottom <= bounds.bottom);
    assert.ok(box.right <= anchor.left || box.left >= anchor.right || box.bottom <= anchor.top || box.top >= anchor.bottom);
  }
});

test('placement avoids a neighboring node instead of always opening in the same direction', () => {
  const anchor = { left: 250, right: 350, top: 200, bottom: 330 }, bounds = { left: 10, right: 590, top: 10, bottom: 590 };
  const obstacle = { left: 150, right: 450, top: 10, bottom: 185 };
  const clear = placeCreditPreview(anchor, { width: 250, height: 110 }, bounds);
  const crowded = placeCreditPreview(anchor, { width: 250, height: 110 }, bounds, [obstacle]);
  assert.equal(clear.side, 'above');
  assert.notEqual(crowded.side, 'above');
  assert.equal(placeCreditPreview(anchor, { width: 250, height: 110 }, { left: 1, right: 1, top: 0, bottom: 500 }), null);
});

test('a narrow map slides the card alongside a nearby portrait instead of covering it', () => {
  const anchor = { left: 397, right: 470, top: 280, bottom: 397 };
  const bounds = { left: 40, right: 562, top: 86, bottom: 596 };
  const neighbors = [
    { left: 220, right: 320, top: 260, bottom: 410 },
    { left: 255, right: 328, top: 477, bottom: 580 },
    { left: 275, right: 355, top: 90, bottom: 210 }
  ];
  const box = placeCreditPreview(anchor, { width: 220, height: 137 }, bounds, neighbors);
  for (const other of [anchor, ...neighbors]) assert.ok(box.right <= other.left || box.left >= other.right || box.bottom <= other.top || box.top >= other.bottom);
});
