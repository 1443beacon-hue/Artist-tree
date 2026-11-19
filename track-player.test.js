import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrackPlayer, validateTrackPlayer } from './track-player.js';

const ready = id => ({ status: 'ready', provider: 'apple', embedUrl: `https://embed.music.apple.com/us/song/${id}?theme=light`, openUrl: `https://music.apple.com/us/song/${id}` });
const credit = id => ({ trackKey: `genius:track-${id}`, title: `<Track ${id}>`, url: `https://genius.com/Track-${id}-lyrics`, source: 'Genius',
  participants: [{ id: 'a', name: 'Artist A' }, { id: 'b', name: '<Artist B>' }], edgeKeys: ['a|b'] });
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(resolve) {
  class Element {
    constructor() { this.children = []; this.attrs = {}; this.listeners = {}; this.className = ''; }
    append(...nodes) { nodes.forEach(node => { node.parent = this; this.children.push(node); }); }
    replaceChildren(...nodes) { this.children.forEach(node => { node.parent = null; }); this.children = []; this.append(...nodes); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
    setAttribute(name, value) { this.attrs[name] = value; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    focus() { this.focused = true; }
  }
  const host = new Element(); host.ownerDocument = { createElement: () => new Element() };
  const calls = [], events = [];
  const player = createTrackPlayer({ host, resolve: (...args) => { calls.push(args); return resolve(...args); },
    onClose: () => events.push('closed'), onExplore: id => events.push(id) });
  const find = name => player.element.children.find(node => node.className === name);
  return { host, player, find, calls, events };
}

test('player response validation rejects cross-source, arbitrary iframe URLs and mismatched store links', () => {
  assert.ok(validateTrackPlayer(ready(123)));
  assert.equal(validateTrackPlayer(ready(123), 'spotify'), null);
  for (const update of [
    { embedUrl: 'https://attacker.example/us/song/123?theme=light' },
    { embedUrl: 'https://token@embed.music.apple.com/us/song/123?theme=light' },
    { embedUrl: 'https://embed.music.apple.com/us/song/123?autoplay=true' },
    { openUrl: 'https://music.apple.com/us/song/999' },
    { openUrl: 'javascript:alert(1)' }
  ]) assert.equal(validateTrackPlayer({ ...ready(123), ...update }), null);
  assert.equal(validateTrackPlayer({ status: 'unavailable' }).status, 'unavailable');
  assert.ok(validateTrackPlayer({ status: 'ready', provider: 'spotify', embedUrl: 'https://open.spotify.com/embed/track/2xvtxDNInKDV4AvGmjw6d1', openUrl: 'https://open.spotify.com/track/2xvtxDNInKDV4AvGmjw6d1' }, 'spotify'));
  const video = { status: 'ready', provider: 'youtube', embedUrl: 'https://www.youtube-nocookie.com/embed/abcdefghijk?start=0&end=30&rel=0', openUrl: 'https://www.youtube.com/watch?v=abcdefghijk' };
  assert.ok(validateTrackPlayer(video));
  assert.equal(validateTrackPlayer(video, 'spotify'), null);
  assert.equal(validateTrackPlayer({ ...video, openUrl: 'https://www.youtube.com/watch?v=lmnopqrstuv' }), null);
  assert.equal(validateTrackPlayer({ ...video, embedUrl: video.embedUrl.replace('end=30', 'end=300') }), null);
});

test('only an explicit selection loads a player; streamed rerenders preserve its browsing context', async () => {
  const f = fixture(async () => ready(123));
  assert.equal(f.calls.length, 0); assert.equal(f.host.children.length, 0);
  f.player.show(credit(1), { focus: true }); await flush();
  assert.equal(f.calls.length, 1);
  const frame = f.find('track-player').children[0];
  assert.equal(frame.src, ready(123).embedUrl);
  assert.doesNotMatch(frame.src, /autoplay/);
  assert.equal(f.find('track-panel-title').textContent, '<Track 1>');
  assert.equal(f.find('track-panel-title').focused, true);
  f.player.show({ ...credit(1), participants: [...credit(1).participants, { id: 'c', name: 'Artist C' }] });
  assert.equal(f.find('track-player').children[0], frame, 'do not restart or hide active playback on render');
  assert.equal(f.find('track-panel-artists').children.length, 3);
  assert.equal(f.calls.length, 1);
  f.player.clear(); assert.equal(f.find('track-player').children.length, 0); assert.equal(f.host.children.length, 0);
});

test('switching songs removes the old iframe immediately and late results cannot revive it', async () => {
  const resolvers = [], f = fixture(() => new Promise(resolve => resolvers.push(resolve)));
  f.player.show(credit(1)); f.player.show(credit(2));
  assert.equal(f.calls[0][1].aborted, true);
  resolvers[1](ready(222)); await flush();
  const frame = f.find('track-player').children[0];
  resolvers[0](ready(111)); await flush();
  assert.equal(f.find('track-player').children[0], frame);
  assert.equal(frame.src, ready(222).embedUrl);
  f.player.show(credit(3)); assert.equal(f.find('track-player').children.length, 0);
  f.player.clear(); resolvers[2](ready(333)); await flush();
  assert.equal(f.find('track-player').children.length, 0);
  assert.equal(f.host.children.length, 0);
});

test('unavailable/error states never substitute audio and offer an explicit retry or credit-source link', async () => {
  let attempt = 0;
  const f = fixture(async () => { if (++attempt === 1) throw new Error('PRIVATE UPSTREAM BODY'); return { status: 'unavailable' }; });
  f.player.show(credit(1)); await flush();
  assert.equal(f.find('track-player').children.length, 0);
  assert.equal(f.find('track-player-retry').hidden, false);
  assert.doesNotMatch(f.find('track-player-status').textContent, /PRIVATE/);
  f.find('track-player-retry').listeners.click(); await flush();
  assert.equal(f.find('track-player-retry').hidden, true);
  assert.match(f.find('track-player-status').textContent, /No verified/);
  assert.equal(f.find('track-panel-source').href, credit(1).url);
  f.player.clear();
});

test('closing and participant navigation are explicit, and old iframe errors cannot affect a new selection', async () => {
  const f = fixture(async value => ready(value.trackKey.endsWith('1') ? 111 : 222));
  f.player.show(credit(1)); await flush();
  const old = f.find('track-player').children[0];
  f.player.show(credit(2)); await flush(); old.listeners.error();
  assert.equal(f.find('track-player').children.length, 1);
  f.find('track-panel-artists').children[1].children[0].listeners.click();
  assert.deepEqual(f.events, ['b']);
  f.player.element.children[0].children[1].listeners.click();
  assert.deepEqual(f.events, ['b', 'closed']);
  assert.equal(f.find('track-player').children.length, 0);
});
