import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGrowingNetwork } from './intro-network.js';

const seeded = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

test('the decorative tree grows forever without unbounded nodes, detached branches, or out-of-bounds dots', () => {
  const model = createGrowingNetwork({ random: seeded(123) });
  for (let step = 0; step < 1500; step++) {
    model.advance();
    const nodes = model.nodes, edges = model.edges, ids = new Set(nodes.map(node => node.id));
    assert.ok(nodes.length <= 16);
    assert.equal(ids.size, nodes.length);
    assert.equal(edges.length, nodes.length - 1);
    assert.ok(ids.has(0));
    assert.ok(nodes.every(node => node.x >= 15 && node.x <= 345 && node.y >= 15 && node.y <= 97));
    for (const edge of edges) assert.ok(ids.has(edge.a) && ids.has(edge.b));
    for (const node of nodes) {
      let current = node, hops = 0;
      while (current.parent !== null) {
        current = nodes.find(other => other.id === current.parent);
        assert.ok(current && ++hops <= nodes.length);
      }
    }
  }
  assert.ok(model.nodes.some(node => node.id > 100));
});

test('seeded growth is reproducible and exposed geometry cannot mutate internal state', () => {
  const first = createGrowingNetwork({ random: seeded(17) });
  const second = createGrowingNetwork({ random: seeded(17) });
  for (let i = 0; i < 50; i++) { first.advance(); second.advance(); }
  assert.deepEqual(first.nodes, second.nodes);
  first.nodes[0].x = -999;
  assert.equal(first.nodes[0].x, 180);
});

test('intro copy is replaced by an accessible decorative SVG, not an automatic artist graph', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /Good music never exists alone|Meet the artists, collaborators, and producers/);
  assert.match(html, /class="intro-network-wrap" aria-hidden="true"/);
  assert.match(html, /id="intro-network"/);
  assert.match(html, /id="artist-search"/);
});
