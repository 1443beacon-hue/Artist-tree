import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreditPreview } from './credit-preview.js';

// The controller only needs these DOM operations. Keep deterministic lifecycle
// coverage in npm test without adding a browser/runtime dependency.
function fixture({ interactive = false } = {}) {
  class Element {
    constructor() {
      this.children = []; this.attributes = new Map(); this.dataset = {}; this.style = {}; this.className = ''; this.listeners = {};
      this.classList = {
        contains: name => this.className.split(' ').includes(name),
        add: name => { if (!this.classList.contains(name)) this.className += ` ${name}`; },
        remove: name => { this.className = this.className.split(' ').filter(value => value !== name).join(' '); },
        toggle: (name, enabled) => enabled ? this.classList.add(name) : this.classList.remove(name)
      };
    }
    append(...nodes) { nodes.forEach(node => { node.parent = this; this.children.push(node); }); }
    replaceChildren(...nodes) { this.children.forEach(node => { node.parent = null; }); this.children = []; this.append(...nodes); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    hasAttribute(key) { return this.attributes.has(key); }
    removeAttribute(key) { this.attributes.delete(key); }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    focus() { doc.activeElement = this; }
    querySelectorAll(selector) {
      const all = this.children.flatMap(node => [node, ...node.querySelectorAll('*')]);
      if (selector === '*') return all;
      if (selector === '[title]') return all.filter(node => node.hasAttribute('title'));
      return all.filter(node => selector.split(', ').some(part => node.classList.contains(part.slice(1))));
    }
    getBoundingClientRect() { return { left: 300, right: 400, top: 240, bottom: 360, width: parseFloat(this.style.width) || 250, height: 180 }; }
  }
  const doc = { createElement: () => new Element(), body: new Element(), defaultView: { innerWidth: 900, innerHeight: 700 } };
  const host = new Element(); host.ownerDocument = doc; doc.body.append(host);
  host.getBoundingClientRect = () => ({ left: 0, right: 800, top: 0, bottom: 650 });
  const node = new Element(); node.className = 'node'; node.dataset.artist = 'b'; node.setAttribute('title', 'Explore B'); host.append(node);
  const name = new Element(); name.className = 'node-name'; name.setAttribute('title', 'Artist B'); node.append(name);
  doc.elementFromPoint = () => node;
  const changes = [], selections = [], timers = new Map(); let sequence = 0, blocked = false, motion = true;
  let credit = { parentId: 'a', artistId: 'b', title: '<Real track>', source: 'Genius', trackKey: 'genius:/real-track-lyrics',
    participants: [{ id: 'a', name: 'Artist A' }, { id: 'b', name: '<Artist B>' }, { id: 'c', name: 'Artist C' }],
    edgeKeys: ['a|b', 'a|c'] };
  const controller = createCreditPreview({ host, getCredit: () => credit,
    onChange: value => changes.push(value), onSelect: interactive ? value => selections.push(value) : null,
    blocked: () => blocked, motionAllowed: () => motion,
    schedule(fn, delay) { timers.set(++sequence, { fn, delay }); return sequence; }, cancel: id => timers.delete(id) });
  const card = doc.body.children.at(-1), child = name => card.children.find(node => node.classList.contains(name));
  const run = delay => {
    const task = [...timers].find(([, value]) => value.delay === delay);
    assert.ok(task, `expected ${delay}ms timer`); timers.delete(task[0]); task[1].fn();
  };
  return { host, node, name, doc, card, child, controller, timers, run, changes, selections,
    setCredit: value => { credit = value; }, setBlocked: value => { blocked = value; }, setMotion: value => { motion = value; } };
}

test('the group and safe participant list appear only after hover intent and clear at fade-out start', () => {
  const f = fixture();
  f.node.setAttribute('aria-describedby', 'node-help');
  f.controller.enter(f.node, { point: { x: 350, y: 300 } });
  assert.equal(f.card.hidden, true); assert.deepEqual(f.changes, []);
  f.run(120);
  assert.equal(f.card.hidden, false);
  assert.equal(f.child('credit-preview-title').textContent, '<Real track>');
  assert.equal(f.child('credit-preview-summary').textContent, '3 credited artists on this map');
  assert.deepEqual(f.child('credit-preview-artists').children.map(node => node.textContent), ['Artist A', '<Artist B>', 'Artist C']);
  assert.equal(f.changes.at(-1).participants.length, 3);
  assert.equal(f.node.getAttribute('aria-describedby'), 'node-help shared-credit-preview');
  assert.equal(f.node.hasAttribute('title'), false); assert.equal(f.name.hasAttribute('title'), false);
  f.controller.refresh(); assert.equal(f.changes.length, 1, 'unchanged renders never replay group callbacks');
  f.controller.leave(f.node);
  assert.equal(f.changes.at(-1), null);
  assert.equal(f.card.hidden, false, 'allow the visual exit transition');
  assert.equal(f.card.classList.contains('is-visible'), false);
  assert.equal(f.node.getAttribute('aria-describedby'), 'node-help');
  assert.equal(f.node.getAttribute('title'), 'Explore B'); assert.equal(f.name.getAttribute('title'), 'Artist B');
  f.run(160); assert.equal(f.card.hidden, true); assert.equal(f.timers.size, 0);
});

test('fast exits, blocked contexts, removed nodes and no-credit hovers cannot publish stale groups', () => {
  for (const mode of ['leave', 'blocked', 'removed', 'no-credit', 'off-target', 'no-space']) {
    const f = fixture(); f.controller.enter(f.node, { point: { x: 350, y: 300 } });
    if (mode === 'leave') f.controller.leave(f.node);
    if (mode === 'blocked') f.setBlocked(true);
    if (mode === 'removed') f.node.remove();
    if (mode === 'no-credit') f.setCredit(null);
    if (mode === 'off-target') f.doc.elementFromPoint = () => f.host;
    if (mode === 'no-space') f.doc.defaultView.innerHeight = 120;
    if (mode !== 'leave') f.run(120);
    assert.equal(f.card.hidden, true, mode); assert.deepEqual(f.changes, [], mode);
    f.controller.destroy(); assert.equal(f.timers.size, 0);
    assert.equal(f.node.getAttribute('title'), 'Explore B');
  }
});

test('late credit updates replace group membership and invalid evidence clears the active group', () => {
  const f = fixture(); f.controller.enter(f.node, { mode: 'focus' }); f.run(120);
  const next = { ...f.changes.at(-1), participants: f.changes.at(-1).participants.slice(0, 2), edgeKeys: ['a|b'] };
  f.setCredit(next); f.controller.refresh();
  assert.equal(f.child('credit-preview-artists').children.length, 2);
  assert.deepEqual(f.changes.at(-1).edgeKeys, ['a|b']);
  f.setCredit(null); f.controller.refresh();
  assert.equal(f.changes.at(-1), null);
  f.run(160); assert.equal(f.card.hidden, true);
  f.controller.destroy();
});

test('reduced motion has no delay or leftover timers; dismissal and context changes clear highlights', () => {
  for (const action of ['dismiss', 'blocked', 'removed', 'destroy']) {
    const f = fixture(); f.setMotion(false); f.controller.enter(f.node, { mode: 'focus' });
    assert.equal(f.card.hidden, false); assert.equal(f.timers.size, 0);
    if (action === 'dismiss') f.controller.dismiss();
    if (action === 'blocked') { f.setBlocked(true); f.controller.reposition(); }
    if (action === 'removed') { f.node.remove(); f.controller.reposition(); }
    if (action === 'destroy') f.controller.destroy();
    assert.equal(f.changes.at(-1), null, action);
    assert.equal(f.card.hidden, true, action); assert.equal(f.timers.size, 0);
    f.controller.destroy();
  }
});

test('dense groups keep the hovered artist in a bounded card and honestly count other map members', () => {
  const f = fixture(), people = Array.from({ length: 30 }, (_, index) => ({ id: String(index), name: `Artist ${index}` }));
  f.setCredit({ parentId: '0', artistId: '29', title: 'Real track', source: 'Genius', participants: people, edgeKeys: [] });
  f.controller.enter(f.node, { mode: 'focus' }); f.run(120);
  const rows = f.child('credit-preview-artists').children;
  assert.equal(rows.length, 7);
  assert.equal(rows[5].dataset.artistId, '29');
  assert.equal(rows[6].textContent, '+24 more on map');
  assert.equal(f.changes.at(-1).participants.length, 30, 'graph highlighting still includes every verified map participant');
  f.controller.destroy();
});

test('short viewports reduce name chips instead of clipping the overflow count or source', () => {
  const f = fixture(), list = f.child('credit-preview-artists');
  Object.defineProperty(list, 'scrollHeight', { get: () => list.children.length * 24 });
  Object.defineProperty(list, 'clientHeight', { get: () => 48 });
  f.controller.enter(f.node, { mode: 'focus' }); f.run(120);
  assert.equal(list.children.length, 2);
  assert.equal(list.children[0].dataset.artistId, 'b', 'the hovered person remains identifiable');
  assert.equal(list.children[1].textContent, '+2 more on map');
  assert.equal(f.changes.at(-1).participants.length, 3);
  f.controller.destroy();
});

test('rapid re-entry cancels an old fade timer so it cannot hide the next group', () => {
  const f = fixture(); f.controller.enter(f.node); f.run(120);
  f.controller.leave(f.node);
  f.controller.enter(f.node); f.run(120);
  assert.equal(f.timers.size, 0, 'the old 160ms exit is cancelled');
  assert.equal(f.card.hidden, false);
  assert.ok(f.changes.at(-1));
  f.controller.destroy();
  assert.equal(f.changes.at(-1), null); assert.equal(f.timers.size, 0);
});

test('interactive cards bridge the pointer gap and stay open over the card without requesting playback', () => {
  const f = fixture({ interactive: true }); f.controller.enter(f.node); f.run(120);
  assert.equal(f.card.getAttribute('role'), 'region', 'interactive content is not placed in a tooltip role');
  f.controller.leave(f.node, { bridge: true });
  assert.equal(f.card.hidden, false); assert.equal(f.selections.length, 0);
  f.card.listeners.pointerenter(); assert.equal(f.timers.size, 0);
  f.doc.elementFromPoint = () => f.child('credit-preview-play');
  f.controller.reposition(); assert.equal(f.card.hidden, false);
  f.card.listeners.pointerleave(); f.run(200);
  assert.equal(f.changes.at(-1), null); f.run(160);
  assert.equal(f.card.hidden, true); assert.equal(f.selections.length, 0);
  f.controller.destroy();
});

test('only explicit card activation opens the player, and context cancellation clears bridge timers', () => {
  const f = fixture({ interactive: true }); f.controller.enter(f.node); f.run(120);
  f.child('credit-preview-play').listeners.click();
  assert.equal(f.selections.length, 1); assert.equal(f.card.hidden, true);
  assert.equal(f.changes.at(-1), null); assert.equal(f.timers.size, 0);
  f.controller.enter(f.node); f.run(120); f.controller.leave(f.node, { bridge: true });
  f.controller.dismiss(true); assert.equal(f.timers.size, 0);
  f.node.remove();
  assert.equal(f.controller.activate(f.node), false, 'removed targets cannot replay stale selections');
  f.controller.destroy();
});
