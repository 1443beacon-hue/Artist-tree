import test from 'node:test';
import assert from 'node:assert/strict';
import { graphDistances, createElasticGraph, pointerToGraph, cameraToCenter } from './graph-interaction.js';

const links = [{ a: 'a', b: 'b' }, { a: 'b', b: 'c' }, { a: 'c', b: 'd' }];
const points = () => new Map(['a', 'b', 'c', 'd', 'isolated'].map((id, i) => [id, { x: i * 180, y: 200 }]));

test('focus distances follow visible graph links, not pixel distance or exploration history', () => {
  const ids = new Set(['a', 'b', 'c', 'd', 'isolated']);
  const distances = graphDistances(ids, [...links, { a: 'a', b: 'a' }, { a: 'a', b: 'hidden' }, links[0]], 'a');
  assert.deepEqual([...distances.values()], [0, 1, 2, 3, Infinity]);
  const next = graphDistances(ids, links, 'c');
  assert.deepEqual([...next.values()], [2, 1, 0, 1, Infinity]);
  const shortcut = graphDistances(ids, [...links, { a: 'a', b: 'd' }], 'a');
  assert.equal(shortcut.get('d'), 1);
  assert.ok([...graphDistances(ids, links, null).values()].every(value => value === Infinity));
});

test('drag coordinates invert pan and zoom around the graph origin', () => {
  const viewport = { width: 800, height: 500 };
  const camera = { zoom: 1.7, pan: { x: -120, y: 64 } };
  const original = { x: 630, y: 110 };
  const screen = { x: 400 + (original.x - 400) * camera.zoom + camera.pan.x, y: 250 + (original.y - 250) * camera.zoom + camera.pan.y };
  const result = pointerToGraph(screen, camera, viewport);
  assert.ok(Math.abs(result.x - original.x) < .0001);
  assert.ok(Math.abs(result.y - original.y) < .0001);
});

test('pulling a node moves nearby connected nodes, but not distant or unconnected nodes', () => {
  const motion = createElasticGraph();
  motion.setLayout(points(), links);
  motion.beginDrag('a');
  motion.moveDrag({ x: 120, y: 220 });
  for (let i = 0; i < 60; i++) motion.step(1000 / 60);
  assert.deepEqual(motion.position('a'), { x: 120, y: 220 });
  assert.ok(motion.position('b').x > 190);
  assert.ok(motion.position('c').x > 360);
  assert.deepEqual(motion.position('d'), { x: 540, y: 200 });
  assert.deepEqual(motion.position('isolated'), { x: 720, y: 200 });
});

test('released springs settle and stop requesting frames; a dropped node can stay in its new place', () => {
  const motion = createElasticGraph(), positions = points();
  motion.setLayout(positions, links);
  motion.beginDrag('a');
  motion.moveDrag({ x: 100, y: 100 });
  for (let i = 0; i < 40; i++) motion.step(1000 / 60);
  const dropped = motion.endDrag();
  positions.set('a', dropped);
  motion.setLayout(positions, links);
  let moving = true;
  for (let i = 0; i < 500 && moving; i++) moving = motion.step(1000 / 60);
  assert.equal(moving, false);
  assert.deepEqual(motion.position('a'), dropped);
  for (const [id, point] of positions) assert.deepEqual(motion.position(id), point);
});

test('expanding a branch nudges nearby nodes without reflowing the whole map', () => {
  const motion = createElasticGraph();
  const positions = new Map([['a', { x: 0, y: 0 }], ['far', { x: 1000, y: 0 }]]);
  motion.setLayout(positions, []);
  positions.set('new', { x: 150, y: 0 });
  motion.setLayout(positions, [{ a: 'a', b: 'new' }], { entering: ['new'] });
  motion.step(1000 / 60);
  assert.ok(motion.position('a').x < 0);
  assert.deepEqual(motion.position('far'), { x: 1000, y: 0 });
  motion.settle();
  assert.deepEqual(motion.position('a'), { x: 0, y: 0 });
});

test('paused/reduced motion snaps to targets; removing a dragged node releases it safely', () => {
  const motion = createElasticGraph(), positions = points();
  motion.setLayout(positions, links);
  motion.beginDrag('a');
  motion.moveDrag({ x: 50, y: 60 });
  motion.endDrag();
  motion.setLayout(positions, links, { animate: false });
  assert.deepEqual(motion.position('a'), positions.get('a'));
  assert.equal(motion.step(16), false);
  motion.beginDrag('b');
  positions.delete('b');
  motion.setLayout(positions, links);
  assert.equal(motion.position('b'), null);
  assert.equal(motion.beginDrag('missing'), false);
  motion.clear();
  assert.equal(motion.positions.size, 0);
});

test('spring integration is stable across refresh rates and long background-frame gaps', () => {
  const simulate = (count, delta) => {
    const motion = createElasticGraph();
    motion.setLayout(points(), links);
    motion.beginDrag('a');
    motion.moveDrag({ x: 90, y: 240 });
    for (let i = 0; i < count; i++) motion.step(delta);
    return motion.position('b');
  };
  const sixty = simulate(60, 1000 / 60), fast = simulate(120, 1000 / 120);
  assert.ok(Math.hypot(sixty.x - fast.x, sixty.y - fast.y) < .1);
  const longGap = simulate(20, 10000);
  assert.ok(Number.isFinite(longGap.x) && longGap.x < 400);
});

test('portrait collisions push even unconnected neighbors, never the pointer-held node or distant nodes', () => {
  const motion = createElasticGraph();
  const positions = new Map([['held', { x: 0, y: 100 }], ['neighbor', { x: 180, y: 100 }], ['far', { x: 2000, y: 100 }]]);
  const colliders = new Map([...positions.keys()].map(id => [id, 60]));
  motion.setLayout(positions, [], { colliders });
  motion.beginDrag('held');
  motion.moveDrag({ x: 150, y: 100 });
  for (let i = 0; i < 30; i++) motion.step(1000 / 60);
  assert.deepEqual(motion.position('held'), { x: 150, y: 100 });
  assert.ok(motion.position('neighbor').x > 240, 'contact pushes a nearby non-credit neighbor');
  assert.deepEqual(motion.position('far'), positions.get('far'));
  motion.endDrag();
  positions.set('held', { x: 150, y: 100 });
  positions.set('neighbor', { x: 280, y: 100 });
  motion.setLayout(positions, [], { colliders });
  let moving = true;
  for (let i = 0; i < 300 && moving; i++) moving = motion.step(1000 / 60);
  assert.equal(moving, false);
  for (const [id, point] of positions) assert.deepEqual(motion.position(id), point);
});

test('new portraits unfold from a nearby origin and reduced motion skips both travel and collisions', () => {
  const motion = createElasticGraph();
  const positions = new Map([['root', { x: 0, y: 0 }], ['new', { x: 220, y: 0 }]]);
  const origins = new Map([['new', { x: 155, y: 0 }]]);
  const colliders = new Map([['root', 90], ['new', 60]]);
  motion.setLayout(positions, [{ a: 'root', b: 'new' }], { entering: ['new'], origins, colliders });
  assert.equal(motion.position('new').x, 155);
  motion.step(16);
  assert.ok(motion.position('new').x > 155);
  motion.setLayout(positions, [], { animate: false, origins, colliders });
  assert.deepEqual(motion.position('new'), positions.get('new'));
  assert.deepEqual(motion.position('root'), positions.get('root'));
  assert.equal(motion.step(16), false);
});

test('a dense burst has finite collision motion and a bounded idle deadline', () => {
  const motion = createElasticGraph(), positions = new Map(), origins = new Map(), colliders = new Map();
  for (let i = 0; i < 80; i++) {
    const id = String(i);
    positions.set(id, { x: i % 10 * 145, y: Math.floor(i / 10) * 155 });
    origins.set(id, { x: 350 + i % 10 * 25, y: 300 + Math.floor(i / 10) * 25 });
    colliders.set(id, 56);
  }
  motion.setLayout(positions, [], { origins, colliders, entering: [...positions.keys()] });
  let moving = true;
  for (let i = 0; i < 280 && moving; i++) {
    moving = motion.step(i === 30 ? 10_000 : 1000 / 60);
    for (const point of motion.positions.values()) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) < 10_000);
  }
  assert.equal(moving, false);
  for (const [id, point] of positions) assert.deepEqual(motion.position(id), point);
});

test('camera centers an off-center selected portrait even when it already fits', () => {
  const viewport = { width: 800, height: 500 }, point = { x: 630, y: 110 };
  const result = cameraToCenter({ zoom: 1, pan: { x: 70, y: -40 } }, point, viewport);
  assert.deepEqual(result, { zoom: 1, pan: { x: -230, y: 140 } });
  assert.deepEqual(pointerToGraph({ x: 400, y: 250 }, result, viewport), point);
  assert.equal(cameraToCenter(result, point, viewport), result, 'unchanged streamed updates do not restart the animation');
});

test('centering preserves every zoom level and works outside the original canvas', () => {
  for (const zoom of [.5, .85, 1, 1.75, 2.5]) for (const width of [350, 800, 1600]) {
    const viewport = { width, height: 520 }, point = { x: 2400, y: -1800 };
    const result = cameraToCenter({ zoom, pan: { x: -120, y: 200 } }, point, viewport);
    assert.equal(result.zoom, zoom);
    const centered = pointerToGraph({ x: width / 2, y: 260 }, result, viewport);
    assert.ok(Math.hypot(centered.x - point.x, centered.y - point.y) < .00001);
  }
});

test('an already centered, missing, or invalid target does not move the camera', () => {
  const camera = { zoom: 1.2, pan: { x: 0, y: 0 } }, viewport = { width: 800, height: 500 };
  assert.equal(cameraToCenter(camera, { x: 400, y: 250 }, viewport), camera);
  for (const point of [null, { x: NaN, y: 1 }, { x: 1, y: Infinity }]) assert.equal(cameraToCenter(camera, point, viewport), camera);
  assert.equal(cameraToCenter(camera, { x: 5, y: 10 }, { width: 0, height: 500 }), camera);
});
