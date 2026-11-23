import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreditHold } from './touch-credit.js';

function fixture() {
  const timers = new Map(), calls = [];
  let serial = 0, clock = 0, canOpen = true;
  const node = { id: 'verified-node' };
  const gesture = createCreditHold({
    onHold(value) { calls.push(value); return canOpen; }, now: () => clock,
    schedule(fn, delay) { timers.set(++serial, { fn, delay }); return serial; }, cancel(id) { timers.delete(id); }
  });
  const event = (extra = {}) => ({ pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 100, clientY: 200, ...extra });
  const fire = () => { const [id, timer] = [...timers][0]; assert.equal(timer.delay, 400); timers.delete(id); timer.fn(); };
  return { gesture, node, event, fire, timers, calls, time: value => { clock = value; }, unavailable: () => { canOpen = false; } };
}
test('a short touch remains an ordinary node tap; holding opens only after 400ms', () => {
  const f = fixture(); f.gesture.down(f.event(), f.node);
  f.gesture.up(f.event()); assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
  assert.equal(f.gesture.consumeClick({ detail: 1 }, f.node), false);
  f.gesture.down(f.event(), f.node); f.fire(); assert.deepEqual(f.calls, [f.node]);
  assert.equal(f.gesture.consumeClick({ detail: 1 }, f.node), true);
  f.gesture.up(f.event()); assert.equal(f.gesture.consumeClick({ detail: 1 }, f.node), true);
  f.gesture.destroy();
});
test('drag threshold, scrolling cancellation, pointercancel and teardown cannot leave delayed cards', () => {
  for (const action of ['drag', 'cancel', 'pointercancel', 'reset', 'destroy']) {
    const f = fixture(); f.gesture.down(f.event(), f.node);
    if (action === 'drag') f.gesture.move(f.event({ clientX: 106 }));
    else if (action === 'pointercancel') f.gesture.up(f.event({ type: 'pointercancel' }));
    else f.gesture[action]();
    assert.equal(f.timers.size, 0, action); assert.equal(f.calls.length, 0, action);
  }
});
test('slight finger jitter is allowed, but a second touch cancels rather than blocking pinch gestures', () => {
  const f = fixture(); f.gesture.down(f.event(), f.node);
  f.gesture.move(f.event({ clientX: 103, clientY: 202 })); assert.equal(f.timers.size, 1);
  f.gesture.down(f.event({ pointerId: 2, isPrimary: false }), f.node);
  assert.equal(f.timers.size, 0);
  f.gesture.up(f.event({ pointerId: 2 })); assert.equal(f.calls.length, 0);
  f.gesture.up(f.event()); f.gesture.down(f.event(), f.node); f.fire();
  assert.equal(f.calls.length, 1); f.gesture.destroy();
});
test('ghost-click protection survives a long-held finger but never swallows a new tap or keyboard activation', () => {
  const f = fixture(); f.gesture.down(f.event(), f.node); f.fire();
  f.time(9000); assert.equal(f.gesture.consumeClick({ detail: 1 }, f.node), true);
  f.gesture.up(f.event());
  assert.equal(f.gesture.consumeClick({ detail: 0 }, f.node), false);
  assert.equal(f.gesture.consumeClick({ detail: 0, pointerType: 'touch' }, f.node), true);
  assert.equal(f.gesture.consumeClick({ detail: 1 }, {}), false);
  f.gesture.down(f.event(), f.node);
  assert.equal(f.gesture.consumeClick({ detail: 1 }, f.node), false, 'a fresh contact is a new intention');
  f.gesture.destroy();
});
test('mouse and pen do not become long presses; expired or failed sheet openings do not consume clicks', () => {
  const f = fixture();
  for (const pointerType of ['mouse', 'pen']) f.gesture.down(f.event({ pointerType }), f.node);
  assert.equal(f.timers.size, 0);
  f.gesture.down(f.event(), f.node); f.fire(); f.gesture.up(f.event()); f.time(801);
  assert.equal(f.gesture.consumeClick({ detail: 1 }, f.node), false);
  f.unavailable(); f.gesture.down(f.event(), f.node); f.fire();
  assert.equal(f.gesture.consumeClick({ detail: 1 }, f.node), false); f.gesture.destroy();
});
