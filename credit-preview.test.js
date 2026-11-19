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
