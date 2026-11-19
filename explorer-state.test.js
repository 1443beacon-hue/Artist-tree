import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createExplorer, layoutArtists, zoomAroundPoint, MIN_ZOOM, MAX_ZOOM } from './explorer-state.js';

const ids = ['tohji', 'bladee', 'lean', 'lucy', 'pretti', 'palmistry', 'mechatok', 'che'];
const artists = Object.fromEntries(ids.map((id, index) => [id, { name: id, x: 100 + index * 50, y: 200, size: 100 }]));
const seeds = ids.slice(0, 5);
const edges = [
  { a: 'tohji', b: 'bladee', type: 'collaboration' },
  { a: 'bladee', b: 'lean', type: 'collaboration' },
  { a: 'lucy', b: 'pretti', type: 'collaboration' },
  { a: 'tohji', b: 'mechatok', type: 'production' },
  { a: 'tohji', b: 'palmistry', type: 'collaboration' },
  { a: 'bladee', b: 'palmistry', type: 'production' },
  { a: 'lean', b: 'palmistry', type: 'production' },
  { a: 'pretti', b: 'che', type: 'production' }
];
const create = () => createExplorer({ artists, edges, seeds, initialArtist: 'bladee' });
const sorted = values => [...values].sort();

test('overview starts with exactly the five seeds', () => {
  const explorer = create();
  assert.deepEqual([...explorer.visibleIds], seeds);
  assert.equal(explorer.canGoBack, false);
});

test('the trail follows real explored branches rather than inventing sibling connections', () => {
  const explorer = createExplorer({ artists, edges, seeds: [], initialArtist: null });
  explorer.start('bladee');
  explorer.select('bladee');
  assert.deepEqual(explorer.trail, ['bladee']);
  explorer.select('lean');
  assert.deepEqual(explorer.trail, ['bladee', 'lean']);
  explorer.select('tohji');
  assert.deepEqual(explorer.trail, ['bladee', 'tohji'], 'a sibling jump uses its actual discovery path');
  explorer.select('mechatok');
  assert.deepEqual(explorer.trail, ['bladee', 'tohji', 'mechatok']);
  const before = [...explorer.visibleIds];
  assert.equal(explorer.isExpanded('bladee'), true);
  explorer.focus('bladee');
  assert.deepEqual(explorer.trail, ['bladee']);
  assert.deepEqual([...explorer.visibleIds], before, 'breadcrumb navigation never reveals neighbors');
  explorer.back();
  assert.deepEqual(explorer.trail, ['bladee', 'tohji', 'mechatok']);
  assert.equal(explorer.selected, 'mechatok');
});

test('trail snapshots are independent and restore without claiming a running lookup', () => {
  const explorer = createExplorer({ artists, edges, seeds: [], initialArtist: null });
  explorer.start('bladee'); explorer.select('bladee'); explorer.select('lean');
  const snapshot = explorer.snapshot(), copy = explorer.trail;
  copy.push('not-an-artist');
  assert.deepEqual(explorer.trail, ['bladee', 'lean']);
  explorer.reset();
  assert.equal(explorer.trail.length, 0);
  assert.equal(explorer.restore(snapshot), true);
  assert.deepEqual(explorer.trail, ['bladee', 'lean']);
  assert.equal(explorer.canGoBack, false);
  assert.deepEqual([...explorer.visibleIds], snapshot.visible);
});

test('a hovered branch exposes a defensive copy of its real discovery route', () => {
  const explorer = createExplorer({ artists, edges, seeds: [], initialArtist: null });
  explorer.start('bladee'); explorer.select('bladee'); explorer.select('tohji');
  assert.deepEqual(explorer.routeTo('mechatok'), ['bladee', 'tohji', 'mechatok']);
  explorer.routeTo('mechatok').pop();
  assert.deepEqual(explorer.routeTo('mechatok'), ['bladee', 'tohji', 'mechatok']);
  explorer.back();
  assert.deepEqual(explorer.routeTo('mechatok'), [], 'removed branches cannot provide stale hover credits');
  assert.deepEqual(explorer.routeTo('bladee'), ['bladee']);
});

test('the application can start empty, then a search chooses exactly one artist without expanding', () => {
  const explorer = createExplorer({ artists, edges, seeds: [], initialArtist: null });
  assert.equal(explorer.selected, null);
  assert.equal(explorer.visibleIds.size, 0);
  explorer.start('bladee');
  assert.deepEqual([...explorer.visibleIds], ['bladee']);
  assert.equal(explorer.isExpanded('bladee'), false);
  assert.equal(explorer.visibleEdges.length, 0);
  assert.equal(explorer.canGoBack, false);
});

test('only clicking a starting node expands it, and Back restores the unexpanded root', () => {
  const explorer = createExplorer({ artists, edges, seeds: [], initialArtist: null });
  explorer.start('bladee');
  explorer.select('bladee', { maxNew: 4 });
  assert.equal(explorer.visibleIds.size, 4);
  assert.equal(explorer.isExpanded('bladee'), true);
  explorer.back();
  assert.deepEqual([...explorer.visibleIds], ['bladee']);
  assert.equal(explorer.isExpanded('bladee'), false);
  explorer.start('pretti');
  assert.deepEqual([...explorer.visibleIds], ['pretti']);
  explorer.reset();
  assert.equal(explorer.selected, null);
  assert.equal(explorer.visibleIds.size, 0);
});

test('an uncached first click records expansion intent before async credits arrive', () => {
  const data = { a: {}, b: {} };
  const explorer = createExplorer({ artists: data, edges: [], seeds: [], initialArtist: null });
  explorer.start('a');
  explorer.select('a', { maxNew: 4 });
  assert.equal(explorer.isExpanded('a'), true);
  assert.equal(explorer.canGoBack, true);
  explorer.reveal(['b']);
  explorer.back();
  assert.deepEqual([...explorer.visibleIds], ['a']);
  assert.equal(explorer.isExpanded('a'), false);
});

test('selection keeps every existing artist and adds both relationship types', () => {
  const explorer = create();
  explorer.select('tohji');
  assert.deepEqual(sorted(explorer.visibleIds), ['bladee', 'lean', 'lucy', 'mechatok', 'palmistry', 'pretti', 'tohji']);
  assert.equal(explorer.visibleEdges.length, 7);
  assert.ok(explorer.visibleEdges.some(edge => edge.type === 'collaboration'));
  assert.ok(explorer.visibleEdges.some(edge => edge.type === 'production'));
});

test('sequential exploration accumulates connections without losing previous branches', () => {
  const explorer = create();
  explorer.select('tohji');
  explorer.select('palmistry');
  assert.equal(explorer.visibleIds.size, 7);
  explorer.select('lean');
  assert.equal(explorer.visibleIds.size, 7);
  assert.equal(explorer.visibleIds.has('tohji'), true);
  assert.equal(explorer.visibleIds.has('lucy'), true);
  assert.equal(explorer.visibleIds.has('mechatok'), true);
});

test('searching a different branch adds its artists while retaining the previous branch', () => {
  const explorer = create();
  explorer.select('tohji');
  explorer.select('pretti');
  assert.deepEqual(sorted(explorer.visibleIds), sorted(ids));
  explorer.select('che');
  assert.deepEqual(sorted(explorer.visibleIds), sorted(ids));
});

test('visible edges include all known connections between visible artists', () => {
  const explorer = create();
  explorer.select('bladee');
  assert.equal(explorer.visibleIds.size, 6);
  assert.equal(explorer.visibleEdges.length, 6);
  assert.ok(explorer.visibleEdges.some(edge => edge.a === 'lucy' && edge.b === 'pretti'));
  assert.ok(explorer.visibleEdges.some(edge => edge.a === 'lean' && edge.b === 'palmistry'));
});

test('visible IDs cannot be mutated by callers', () => {
  const explorer = create();
  explorer.visibleIds.clear();
  assert.deepEqual([...explorer.visibleIds], seeds);
});

test('back restores selection and the previous expanded map, eventually returning to the seeds', () => {
  const explorer = create();
  explorer.select('tohji');
  const previousIds = sorted(explorer.visibleIds);
  explorer.select('pretti');
  assert.equal(explorer.visibleIds.size, 8);
  explorer.back();
  assert.equal(explorer.selected, 'tohji');
  assert.deepEqual(sorted(explorer.visibleIds), previousIds);
  explorer.back();
  assert.equal(explorer.selected, 'bladee');
  assert.deepEqual([...explorer.visibleIds], seeds);
  assert.equal(explorer.back(), false);
});

test('same-artist clicks and invalid IDs do not add fake history entries', () => {
  const explorer = create();
  assert.equal(explorer.select('missing'), false);
  assert.equal(explorer.canGoBack, false);
  explorer.select('tohji');
  assert.equal(explorer.select('tohji'), false);
  explorer.back();
  assert.equal(explorer.canGoBack, false);
});

test('reset clears expansion and history without changing the seed set', () => {
  const explorer = create();
  explorer.select('pretti');
  explorer.reset();
  assert.equal(explorer.selected, 'bladee');
  assert.equal(explorer.canGoBack, false);
  assert.deepEqual([...explorer.visibleIds], seeds);
});

test('selection and expansion preserve the original node positions and sizes', () => {
  const explorer = create();
  const original = layoutArtists(artists, explorer.visibleIds);
  explorer.select('tohji');
  const layout = layoutArtists(artists, explorer.visibleIds);
  assert.equal(layout.size, 7);
  for (const id of seeds) assert.deepEqual(layout.get(id), original.get(id));
  assert.deepEqual(layout.get('mechatok'), artists.mechatok);
  assert.equal(artists.tohji.x, 100, 'source coordinates are not mutated');
});

test('the relationship filter buttons and handlers are removed', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /data-filter|class="filters"/);
  assert.doesNotMatch(app, /setFilter|data-filter|explorer\.focused/);
  assert.match(app, /addEventListener\('wheel'/);
});

test('zoom preserves the world point under an off-center cursor after panning', () => {
  const camera = { zoom: 1.2, pan: { x: 60, y: -30 } };
  const point = { x: 170, y: 370 };
  const origin = { x: 400, y: 260 };
  const next = zoomAroundPoint(camera, 1.8, point, origin);
  for (const axis of ['x', 'y']) {
    const before = (point[axis] - origin[axis] - camera.pan[axis]) / camera.zoom;
    const after = (point[axis] - origin[axis] - next.pan[axis]) / next.zoom;
    assert.ok(Math.abs(before - after) < 1e-10);
  }
});

test('zoom stays between 50% and 250% and does not drift at the limits', () => {
  const point = { x: 100, y: 200 };
  const origin = { x: 400, y: 260 };
  const camera = { zoom: MAX_ZOOM, pan: { x: 30, y: 10 } };
  assert.deepEqual(zoomAroundPoint(camera, 100, point, origin), camera);
  assert.equal(zoomAroundPoint(camera, 0.01, point, origin).zoom, MIN_ZOOM);
});
