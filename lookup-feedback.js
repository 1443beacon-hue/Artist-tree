// An indeterminate status, never an invented percentage or completion estimate.
export function lookupFeedback(state = {}, { active = false } = {}) {
  if (active && state.loading) return { phase: 'loading', label: 'Looking up credits…', busy: true };
  if (active && state.pending) return { phase: 'background', label: 'Checking sources…', busy: true };
  if (state.error) return { phase: 'error', label: 'Couldn’t load · retry', busy: false };
  return { phase: 'idle', label: '', busy: false };
}

// Only newly revealed, source-backed credits may produce a discovery effect.
// Similarity, placeholder profiles, rerenders, and history restoration do not.
export function discoveryTargets(bundles, revealedIds, anchorId) {
  const revealed = new Set(revealedIds), found = new Map();
  for (const edge of bundles) {
    const other = edge.a === anchorId ? edge.b : edge.b === anchorId ? edge.a : null;
    if (!other || !revealed.has(other)) continue;
    const verified = edge.relationships?.some(relation => relation.origin === 'live'
      && ['collaboration', 'production', 'membership'].includes(relation.type)
      && ['apple', 'genius', 'musicbrainz', 'spotify'].includes(relation.provider)
      && [relation, ...(relation.evidence || [])].some(credit => /^https?:\/\//.test(credit.url || '')));
    if (verified) found.set(edge.key, { key: edge.key, reverse: edge.a !== anchorId });
  }
  return [...found.values()];
}

// One short CSS pulse per accepted connection. No permanent RAF loop, queued
// replay after pause, or retained DOM references after an edge is removed.
export function createDiscoveryFeedback({ schedule = setTimeout, cancel = clearTimeout } = {}) {
  const active = new Map();
  const forget = path => {
    if (!path) return;
    if (active.has(path)) cancel(active.get(path));
    active.delete(path);
    path.classList.remove('is-discovering');
  };
  return {
    pulse(path, { reverse = false, enabled = true } = {}) {
      if (!path || !enabled || active.has(path)) return false;
      path.setAttribute('data-reverse', String(reverse));
      path.classList.add('is-discovering');
      const timer = schedule(() => forget(path), 1100);
      active.set(path, timer);
      timer?.unref?.();
      return true;
    },
    forget,
    clear() { for (const path of active.keys()) forget(path); }
  };
}
