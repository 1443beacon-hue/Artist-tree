const SOURCES = { genius: 'Genius', musicbrainz: 'MusicBrainz', apple: 'Apple Music', spotify: 'Spotify' };

function recordingUrl(value, provider) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const valid = provider === 'genius' ? ['genius.com', 'www.genius.com'].includes(url.hostname) && /-lyrics\/?$/.test(url.pathname)
      : provider === 'musicbrainz' ? url.hostname === 'musicbrainz.org' && /^\/recording\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/?$/i.test(url.pathname)
        : provider === 'spotify' ? url.hostname === 'open.spotify.com' && /^\/(?:intl-[a-z]+\/)?track\/[a-zA-Z0-9]{22}\/?$/.test(url.pathname)
          : provider === 'apple' && url.hostname === 'music.apple.com' && (/\/song\//.test(url.pathname) || /\/album\//.test(url.pathname) && /^\d+$/.test(url.searchParams.get('i') || ''));
    return valid ? url.href : null;
  } catch { return null; }
}

// The source is the hovered person's recorded branch parent, not an arbitrary
// selected neighbor or a name match. Never substitute a solo/popular song.
export function sharedTrackPreview({ id, route, artists, edges, visibleIds, scope = 'main' }) {
  const parent = route?.at(-2);
  if (!parent || route.at(-1) !== id || parent === id || !visibleIds.has(id) || !visibleIds.has(parent)
    || !artists[id] || !artists[parent]) return null;
  for (const edge of edges) {
    if (!(edge.a === parent && edge.b === id || edge.b === parent && edge.a === id)
      || !['collaboration', 'production'].includes(edge.type) || edge.origin !== 'live') continue;
    for (const credit of edge.evidence?.length ? edge.evidence : [edge]) {
      const provider = credit.provider || edge.provider;
      if (!SOURCES[provider] || (scope === 'spotify' ? provider !== 'spotify' : provider === 'spotify')
        || (credit.origin || edge.origin) !== 'live') continue;
      const title = typeof credit.work === 'string' ? credit.work.trim() : '';
      const url = recordingUrl(credit.url, provider);
      if (!title || !url || /^\d+\s+credited\s+(?:works|songs|recordings)$/i.test(title)) continue;
      return { parentId: parent, artistId: id, parentName: artists[parent].name, artistName: artists[id].name,
        title, url, provider, source: SOURCES[provider], type: edge.type,
        relation: edge.type === 'production' ? 'Production credit' : 'Shared performance' };
    }
  }
  return null;
}

const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
export function placeCreditPreview(anchor, size, bounds, obstacles = []) {
  if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) return null;
  const width = Math.min(size.width, bounds.right - bounds.left), height = Math.min(size.height, bounds.bottom - bounds.top);
  const x = (anchor.left + anchor.right - width) / 2, y = (anchor.top + anchor.bottom - height) / 2, gap = 14;
  const candidates = [
    { left: x, top: anchor.top - height - gap, side: 'above' },
    { left: x, top: anchor.bottom + gap, side: 'below' },
    { left: anchor.right + gap, top: y, side: 'right' },
    { left: anchor.left - width - gap, top: y, side: 'left' }
  ];
  // Slide along the same side to avoid a neighboring portrait rather than
  // covering it or moving the card to a distant corner of the page.
  const nearby = [...obstacles].sort((a, b) => Math.hypot((a.left + a.right - anchor.left - anchor.right) / 2, (a.top + a.bottom - anchor.top - anchor.bottom) / 2)
    - Math.hypot((b.left + b.right - anchor.left - anchor.right) / 2, (b.top + b.bottom - anchor.top - anchor.bottom) / 2)).slice(0, 8);
  for (const candidate of candidates.slice(0, 2)) {
    for (const left of [bounds.left, bounds.right - width]) candidates.push({ ...candidate, left });
    for (const other of nearby) {
      for (const left of [other.right + gap, other.left - width - gap]) {
        if (left >= bounds.left && left + width <= bounds.right) candidates.push({ ...candidate, left });
      }
    }
  }
  const placed = candidates.map((candidate, index) => {
    const left = Math.max(bounds.left, Math.min(bounds.right - width, candidate.left));
    const top = Math.max(bounds.top, Math.min(bounds.bottom - height, candidate.top));
    const box = { left, top, right: left + width, bottom: top + height };
    return { ...box, side: candidate.side, score: area(box, anchor) * 100
      + obstacles.reduce((sum, obstacle) => sum + area(box, obstacle), 0)
      + Math.hypot(left - candidate.left, top - candidate.top) * 4
      + Math.hypot(left + width / 2 - (anchor.left + anchor.right) / 2, top + height / 2 - (anchor.top + anchor.bottom) / 2) * .5 + index * .05 };
  });
  placed.sort((a, b) => a.score - b.score);
  return placed[0];
}

// One unscaled tooltip for the entire map; no network calls, image downloads,
// permanent animation loop, or extra interactive targets over the graph.
export function createCreditPreview({ host, getCredit, blocked = () => false, motionAllowed = () => true,
  schedule = setTimeout, cancel = clearTimeout }) {
  const doc = host.ownerDocument, view = doc.defaultView;
  const element = doc.createElement('div');
  element.id = 'shared-credit-preview'; element.className = 'credit-preview'; element.hidden = true;
  element.setAttribute('role', 'tooltip'); element.setAttribute('aria-hidden', 'true');
  const eyebrow = doc.createElement('span'), title = doc.createElement('strong'), pair = doc.createElement('p'), meta = doc.createElement('span');
  eyebrow.className = 'credit-preview-eyebrow'; eyebrow.textContent = '♫  SHARED CREDIT';
  title.className = 'credit-preview-title'; pair.className = 'credit-preview-pair'; meta.className = 'credit-preview-meta';
  element.append(eyebrow, title, pair, meta); doc.body.append(element);
  let active = null, showTimer = null, hideTimer = null, signature = '', obstacles = [];
  const stopTimer = kind => {
    if (kind === 'show' && showTimer !== null) { cancel(showTimer); showTimer = null; }
    if (kind === 'hide' && hideTimer !== null) { cancel(hideTimer); hideTimer = null; }
  };
  const describe = (node, add) => {
    if (!node) return;
    const ids = (node.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== element.id);
    if (add) ids.push(element.id);
    if (ids.length) node.setAttribute('aria-describedby', ids.join(' '));
    else node.removeAttribute('aria-describedby');
  };
  const conceal = (immediate = false) => {
    stopTimer('show'); stopTimer('hide'); describe(active?.node, false);
    if (active?.titleSuppressed) { active.node.setAttribute('title', active.nativeTitle); active.titleSuppressed = false; }
    element.classList.remove('is-visible'); element.setAttribute('aria-hidden', 'true'); signature = '';
    if (immediate || !motionAllowed()) element.hidden = true;
    else if (!element.hidden) {
      hideTimer = schedule(() => { hideTimer = null; element.hidden = true; }, 160);
      hideTimer?.unref?.();
    }
  };
  const dismiss = (immediate = false) => { conceal(immediate); active = null; };
  const stillOver = () => {
    if (!active || !host.contains(active.node)) return false;
    if (active.mode !== 'pointer' || !active.point || typeof doc.elementFromPoint !== 'function') return true;
    return active.node.contains(doc.elementFromPoint(active.point.x, active.point.y));
  };
  const reposition = () => {
    if (element.hidden || !active) return;
    if (blocked() || !stillOver()) { dismiss(true); return; }
    if (typeof active.node.getBoundingClientRect !== 'function') return;
    const map = host.getBoundingClientRect(), pad = 10;
    const bounds = { left: Math.max(pad, map.left + pad), top: Math.max(pad, map.top + pad),
      right: Math.min(view.innerWidth - pad, map.right - pad), bottom: Math.min(view.innerHeight - pad, map.bottom - 50) };
    if (bounds.right - bounds.left < 150 || bounds.bottom - bounds.top < 70) { conceal(true); return; }
    element.style.width = `${Math.min(view.innerWidth <= 760 ? 220 : 250, bounds.right - bounds.left)}px`;
    element.style.maxHeight = `${bounds.bottom - bounds.top}px`;
    const measured = element.getBoundingClientRect(), parts = [active.node, ...active.node.querySelectorAll('.node-photo, .node-name, .node-role')].map(node => node.getBoundingClientRect());
    const anchor = { left: Math.min(...parts.map(box => box.left)), top: Math.min(...parts.map(box => box.top)),
      right: Math.max(...parts.map(box => box.right)), bottom: Math.max(...parts.map(box => box.bottom)) };
    const box = placeCreditPreview(anchor, { width: measured.width, height: measured.height }, bounds, obstacles);
    if (!box) { conceal(true); return; }
    element.style.left = `${box.left}px`; element.style.top = `${box.top}px`;
    element.dataset.placement = box.side;
  };
  const show = () => {
    showTimer = null;
    if (!active || !stillOver()) { dismiss(true); return; }
    if (blocked()) { conceal(true); return; }
    const credit = getCredit(active.node.dataset.artist);
    if (!credit) { conceal(); return; }
    stopTimer('hide');
    const key = JSON.stringify(credit);
    if (signature !== key) {
      title.textContent = credit.title; pair.textContent = `${credit.parentName} × ${credit.artistName}`;
      meta.textContent = `${credit.relation} · ${credit.source}`;
      element.dataset.parentId = credit.parentId; element.dataset.artistId = credit.artistId;
      signature = key;
    }
    element.hidden = false;
    element.setAttribute('aria-hidden', 'false'); describe(active.node, true);
    if (active.node.hasAttribute('title')) { active.nativeTitle = active.node.getAttribute('title'); active.node.removeAttribute('title'); active.titleSuppressed = true; }
    obstacles = [...host.querySelectorAll('.node')].filter(node => node !== active.node && typeof node.getBoundingClientRect === 'function')
      .map(node => node.getBoundingClientRect());
    reposition();
    if (!element.hidden) element.classList.add('is-visible');
  };
  const refresh = () => {
    if (!active) return;
    if (!element.hidden && element.classList.contains('is-visible')) { show(); return; }
    if (showTimer !== null) return;
    if (!motionAllowed()) { show(); return; }
    showTimer = schedule(show, 120); showTimer?.unref?.();
  };
  return {
    enter(node, { mode = 'pointer', point = null } = {}) {
      conceal(true); active = { node, mode, point }; refresh();
    },
    move(node, point) { if (active?.node === node && active.mode === 'pointer') active.point = point; },
    leave(node) { if (active?.node === node) dismiss(); },
    dismiss,
    refresh,
    reposition,
    destroy() { dismiss(true); element.remove(); }
  };
}
