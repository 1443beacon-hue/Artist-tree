import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupFeedback, discoveryTargets, createDiscoveryFeedback } from './lookup-feedback.js';
import { bundleConnections } from './graph-layout.js';

test('foreground and background lookups have honest, distinct indeterminate statuses', () => {
  assert.deepEqual(lookupFeedback({ loading: true }, { active: true }), { phase: 'loading', label: 'Looking up credits…', busy: true });
  assert.deepEqual(lookupFeedback({ loading: false, pending: true }, { active: true }), { phase: 'background', label: 'Checking sources…', busy: true });
  assert.equal(lookupFeedback({ loading: false, pending: false }, { active: true }).phase, 'idle');
  assert.equal(lookupFeedback({ loaded: true }).phase, 'idle', 'cached data is not an active request');
});

test('cancelled/stale requests cannot leave a spinner, and errors never become a success state', () => {
  assert.equal(lookupFeedback({ loading: true, pending: true }, { active: false }).busy, false);
  const failed = lookupFeedback({ loading: false, pending: false, error: 'Source unavailable' });
  assert.equal(failed.phase, 'error');
  assert.equal(failed.busy, false);
  assert.match(failed.label, /retry/);
  assert.equal(lookupFeedback({ loading: true, error: 'Prior error' }, { active: true }).phase, 'loading');
});

const credit = (a, b, overrides = {}) => ({ a, b, type: 'production', provider: 'genius', origin: 'live', url: 'https://genius.com/track-lyrics', ...overrides });

test('discovery pulses require an accepted new visible person and source-backed credit', () => {
  const bundles = bundleConnections([
    credit('root', 'new'),
    credit('root', 'already-visible'),
    credit('root', 'suggestion', { type: 'similar' }),
    credit('root', 'unverified', { origin: 'reference' }),
    credit('root', 'no-evidence', { url: '' }),
    credit('root', 'no-provider', { provider: '' }),
    credit('elsewhere', 'other')
  ]);
  assert.deepEqual(discoveryTargets(bundles, ['new', 'suggestion', 'unverified', 'no-evidence', 'no-provider', 'other'], 'root'), [
    { key: ['root', 'new'].sort().join('|'), reverse: false }
  ]);
  assert.deepEqual(discoveryTargets(bundles, [], 'root'), [], 'later enrichment does not replay discovery');
});

test('pulse direction runs outward from the clicked artist and duplicate evidence stays one pulse', () => {
  const bundles = bundleConnections([
    credit('new', 'root'),
    credit('root', 'new', { type: 'collaboration' })
  ]);
  assert.deepEqual(discoveryTargets([...bundles, ...bundles], ['new'], 'root'), [{ key: 'new|root', reverse: true }]);
});

test('discovery timers are bounded and removed on completion, cancellation, and edge removal', () => {
  let sequence = 0;
  const tasks = new Map(), classes = new Set(), attributes = new Map();
  const path = { classList: { add: name => classes.add(name), remove: name => classes.delete(name) }, setAttribute: (key, value) => attributes.set(key, value) };
  const feedback = createDiscoveryFeedback({ schedule(fn) { tasks.set(++sequence, fn); return sequence; }, cancel(id) { tasks.delete(id); } });
  assert.equal(feedback.pulse(path, { enabled: false }), false);
  assert.equal(tasks.size, 0, 'paused or reduced-motion discovery is not queued');
  assert.equal(feedback.pulse(path, { reverse: true }), true);
  assert.equal(attributes.get('data-reverse'), 'true');
  assert.equal(feedback.pulse(path), false, 'an in-flight pulse cannot be repeatedly restarted by enrichment');
  assert.equal(tasks.size, 1);
  const task = tasks.values().next().value;
  task();
  assert.equal(tasks.size, 0);
  assert.equal(classes.has('is-discovering'), false);
  feedback.pulse(path);
  feedback.forget(path);
  assert.equal(tasks.size, 0);
  assert.equal(classes.has('is-discovering'), false);
  feedback.pulse(path);
  feedback.clear();
  assert.equal(tasks.size, 0);
  assert.equal(classes.has('is-discovering'), false);
});
