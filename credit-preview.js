const SOURCES = { genius: 'Genius', musicbrainz: 'MusicBrainz', apple: 'Apple Music', spotify: 'Spotify' };

export function recordingUrl(value, provider) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const valid = provider === 'genius' ? ['genius.com', 'www.genius.com'].includes(url.hostname) && /-lyrics\/?$/.test(url.pathname)
      : provider === 'musicbrainz' ? url.hostname === 'musicbrainz.org' && /^\/recording\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/?$/i.test(url.pathname)
        : provider === 'spotify' ? url.hostname === 'open.spotify.com' && /^\/(?:intl-[a-z]+\/)?track\/[a-zA-Z0-9]{22}\/?$/.test(url.pathname)
          : provider === 'apple' && url.hostname === 'music.apple.com' && (/\/song\/(?:[^/]+\/)?\d+\/?$/.test(url.pathname) || /\/album\//.test(url.pathname) && /^\d+$/.test(url.searchParams.get('i') || ''));
    return valid ? url.href : null;
  } catch { return null; }
}

// Recording IDs/URLs, never titles, establish a shared track. Tracking params,
// regional Spotify paths and Apple album/song slugs do not change its identity.
export function recordingKey(value, provider) {
  const url = new URL(value);
  if (provider === 'apple') return `${provider}:${url.pathname.includes('/song/') ? url.pathname.split('/').filter(Boolean).at(-1) : url.searchParams.get('i')}`;
  if (provider === 'musicbrainz') return `${provider}:${url.pathname.split('/').filter(Boolean).at(-1).toLowerCase()}`;
  if (provider === 'spotify') return `${provider}:${url.pathname.split('/').filter(Boolean).at(-1)}`;
  return `${provider}:${url.pathname.replace(/\/$/, '').toLowerCase()}`;
}

function* trackCredits(edge, scope) {
  if (edge.a === edge.b || edge.origin !== 'live' || !['collaboration', 'production'].includes(edge.type)) return;
  for (const credit of edge.evidence?.length ? edge.evidence : [edge]) {
    const provider = credit.provider || edge.provider;
    if (!SOURCES[provider] || (scope === 'spotify' ? provider !== 'spotify' : provider === 'spotify')
      || (credit.origin || edge.origin) !== 'live' || credit.type && credit.type !== edge.type) continue;
    const title = typeof credit.work === 'string' ? credit.work.trim() : '';
    const url = recordingUrl(credit.url, provider);
    if (!title || !url || /^\d+\s+credited\s+(?:works|songs|recordings)$/i.test(title)) continue;
    yield { title, url, provider, trackKey: recordingKey(url, provider) };
  }
}

export function recordingGroup({ trackKey, parentId, artists, edges, visibleIds, scope = 'main' }) {
  const members = new Set(), pairs = new Set();
  for (const edge of edges) {
    if (!visibleIds.has(edge.a) || !visibleIds.has(edge.b) || !artists[edge.a] || !artists[edge.b]) continue;
    for (const credit of trackCredits(edge, scope)) {
      if (credit.trackKey !== trackKey) continue;
      members.add(edge.a); members.add(edge.b);
      pairs.add([edge.a, edge.b].sort().join('|'));
      break;
    }
  }
  const ordered = [...visibleIds].filter(id => members.has(id));
  if (members.has(parentId)) { ordered.splice(ordered.indexOf(parentId), 1); ordered.unshift(parentId); }
  return { participants: ordered.map(id => ({ id, name: artists[id].name })), edgeKeys: [...pairs] };
}

// The source is the hovered person's recorded branch parent, not an arbitrary
// selected neighbor or a name match. Never substitute a solo/popular song.
export function sharedTrackPreview({ id, route, artists, edges, visibleIds, scope = 'main' }) {
  const parent = route?.at(-2);
  if (!parent || route.at(-1) !== id || parent === id || !visibleIds.has(id) || !visibleIds.has(parent)
    || !artists[id] || !artists[parent]) return null;
  let selected;
  const visible = edges.filter(edge => visibleIds.has(edge.a) && visibleIds.has(edge.b) && artists[edge.a] && artists[edge.b]);
  for (const edge of visible) {
    if (!(edge.a === parent && edge.b === id || edge.b === parent && edge.a === id)) continue;
    const credit = trackCredits(edge, scope).next().value;
    if (!credit) continue;
    selected = { ...credit, type: edge.type };
    break;
  }
  if (!selected) return null;
  return { parentId: parent, artistId: id, parentName: artists[parent].name, artistName: artists[id].name,
    ...selected, source: SOURCES[selected.provider],
    relation: selected.type === 'production' ? 'Production credit' : 'Shared performance',
    ...recordingGroup({ trackKey: selected.trackKey, parentId: parent, artists, edges: visible, visibleIds, scope }) };
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

// One unscaled card for the map. Hover is network-free; its optional action
// opens a separate, persistent official player only after an explicit gesture.
export function createCreditPreview({ host, getCredit, onChange = () => {}, onSelect = null, blocked = () => false, motionAllowed = () => true,
  schedule = setTimeout, cancel = clearTimeout }) {
  const doc = host.ownerDocument, view = doc.defaultView;
  const element = doc.createElement('div');
  element.id = 'shared-credit-preview'; element.className = 'credit-preview'; element.hidden = true;
  element.setAttribute('role', onSelect ? 'region' : 'tooltip'); element.setAttribute('aria-hidden', 'true');
  if (onSelect) element.setAttribute('aria-label', 'Shared track preview');
  const eyebrow = doc.createElement('span'), title = doc.createElement('strong'), summary = doc.createElement('p'),
    participants = doc.createElement('ul'), meta = doc.createElement('span');
  eyebrow.className = 'credit-preview-eyebrow'; eyebrow.textContent = '♫  SHARED TRACK';
  title.className = 'credit-preview-title'; summary.className = 'credit-preview-summary';
  participants.className = 'credit-preview-artists'; participants.setAttribute('aria-label', 'Credited artists on this map');
  meta.className = 'credit-preview-meta';
  element.append(eyebrow, title, summary, participants, meta); doc.body.append(element);
  const play = doc.createElement('button');
  play.className = 'credit-preview-play'; play.type = 'button'; play.textContent = '▶  Open preview';
  play.hidden = !onSelect;
  play.title = 'Open the official player. Shortcut: P while the artist is focused.';
  element.append(play);
  const close = doc.createElement('button');
  close.type = 'button'; close.className = 'credit-preview-close'; close.textContent = '×'; close.hidden = true;
  close.setAttribute('aria-label', 'Close track information'); element.append(close);
  let active = null, showTimer = null, hideTimer = null, exitTimer = null, signature = '', published = '', obstacles = [];
  let displayedPeople = [], displayedArtist = '', fitSignature = '';
  const renderParticipants = limit => {
    participants.replaceChildren();
    if (!displayedPeople.length) return;
    const shown = displayedPeople.slice(0, limit);
    if (!shown.some(person => person.id === displayedArtist)) shown[shown.length - 1] = displayedPeople.find(person => person.id === displayedArtist);
    for (const person of shown.filter(Boolean)) {
      const item = doc.createElement('li'); item.textContent = person.name;
      item.className = 'credit-preview-artist'; item.dataset.artistId = person.id;
      item.classList.toggle('is-hovered', person.id === displayedArtist);
      participants.append(item);
    }
    if (displayedPeople.length > shown.length) {
      const more = doc.createElement('li'); more.className = 'credit-preview-more';
      more.textContent = `+${displayedPeople.length - shown.length} more on map`; participants.append(more);
    }
  };
  const publish = credit => {
    const key = credit ? JSON.stringify(credit) : '';
    if (key !== published) { published = key; onChange(credit); }
  };
  const stopTimer = kind => {
    if (kind === 'show' && showTimer !== null) { cancel(showTimer); showTimer = null; }
    if (kind === 'hide' && hideTimer !== null) { cancel(hideTimer); hideTimer = null; }
    if (kind === 'exit' && exitTimer !== null) { cancel(exitTimer); exitTimer = null; }
  };
  const describe = (node, add) => {
    if (!node) return;
    const ids = (node.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== element.id);
    if (add) ids.push(element.id);
    if (ids.length) node.setAttribute('aria-describedby', ids.join(' '));
    else node.removeAttribute('aria-describedby');
  };
  const conceal = (immediate = false) => {
    stopTimer('show'); stopTimer('hide'); stopTimer('exit'); describe(active?.node, false);
    active?.titles?.forEach((value, node) => node.setAttribute('title', value));
    active?.titles?.clear();
    element.classList.remove('is-visible'); element.setAttribute('aria-hidden', 'true'); signature = '';
    publish(null);
    if (immediate || !motionAllowed()) element.hidden = true;
    else if (!element.hidden) {
      hideTimer = schedule(() => { hideTimer = null; element.hidden = true; }, 160);
      hideTimer?.unref?.();
    }
  };
  const dismiss = (immediate = false) => { conceal(immediate); active = null; };
  const activate = node => {
    if (!onSelect || !host.contains(node) || blocked()) return false;
    const credit = getCredit(node.dataset.artist);
    if (!credit) { dismiss(true); return false; }
    dismiss(true); onSelect(credit); return true;
  };
  const closeAndFocus = () => {
    const target = active?.trigger || active?.node;
    dismiss(true); target?.focus?.({ preventScroll: true });
    dismiss(true); // Restoring node focus must not reopen its desktop tooltip.
  };
  close.addEventListener('click', closeAndFocus);
  const queueExit = () => {
    stopTimer('exit');
    if (!active) return;
    active.travel = true;
    exitTimer = schedule(() => {
      exitTimer = null;
      if (!active) return;
      active.travel = false;
      if (!active.overCard && !element.contains(doc.activeElement)) dismiss();
    }, 200);
    exitTimer?.unref?.();
  };
  if (onSelect) {
    play.addEventListener('click', () => { if (active) activate(active.node); });
    element.addEventListener('pointerenter', () => {
      if (active) { stopTimer('exit'); active.overCard = true; active.travel = false; }
    });
    element.addEventListener('pointerleave', () => {
      if (active?.mode === 'touch') return;
      if (active) { active.overCard = false; queueExit(); }
    });
    element.addEventListener('focusin', () => stopTimer('exit'));
    element.addEventListener('focusout', event => {
      if (active?.mode === 'touch') return;
      if (!element.contains(event.relatedTarget)) queueExit();
    });
    element.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault?.(); event.stopPropagation?.(); closeAndFocus(); }
    });
  }
  const stillOver = () => {
    if (!active || !host.contains(active.node)) return false;
    if (active.overCard || active.travel || element.contains(doc.activeElement)) return true;
    if (active.mode !== 'pointer' || !active.point || typeof doc.elementFromPoint !== 'function') return true;
    return active.node.contains(doc.elementFromPoint(active.point.x, active.point.y));
  };
  const reposition = () => {
    if (element.hidden || !active) return;
    if (blocked() || !stillOver()) { dismiss(true); return; }
    if (active.mode === 'touch') {
      const viewport = view.visualViewport;
      const width = viewport?.width || view.innerWidth, height = viewport?.height || view.innerHeight;
      if (width < 180 || height < 170) { conceal(true); return; }
      element.style.width = `${Math.min(440, width - 24)}px`;
      element.style.maxHeight = `${Math.min(360, height - 24)}px`;
      renderParticipants(Math.min(6, displayedPeople.length));
      const measured = element.getBoundingClientRect();
      element.style.left = `${(viewport?.offsetLeft || 0) + (width - Math.min(440, width - 24)) / 2}px`;
      element.style.top = `${(viewport?.offsetTop || 0) + height - Math.min(measured.height, height - 24) - 12}px`;
      element.dataset.placement = 'sheet';
      return;
    }
    if (typeof active.node.getBoundingClientRect !== 'function') return;
    const map = host.getBoundingClientRect(), pad = 10;
    const bounds = { left: Math.max(pad, map.left + pad), top: Math.max(pad, map.top + pad),
      right: Math.min(view.innerWidth - pad, map.right - pad), bottom: Math.min(view.innerHeight - pad, map.bottom - 50) };
    if (bounds.right - bounds.left < 150 || bounds.bottom - bounds.top < 155) { conceal(true); return; }
    const width = Math.min(view.innerWidth <= 760 ? 220 : 250, bounds.right - bounds.left);
    element.style.width = `${width}px`;
    element.style.maxHeight = `${bounds.bottom - bounds.top}px`;
    const fitKey = `${signature}|${width}|${bounds.bottom - bounds.top}`;
    if (fitKey !== fitSignature) {
      // Long names and short windows must not silently clip the final names or
      // the overflow count. Fit on content/viewport changes, never every frame.
      let limit = Math.min(6, displayedPeople.length);
      renderParticipants(limit);
      while (limit > 1 && participants.scrollHeight > participants.clientHeight + 1) renderParticipants(--limit);
      if (participants.scrollHeight > participants.clientHeight + 1) { conceal(true); return; }
      fitSignature = fitKey;
    }
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
    if (!credit && active.mode !== 'touch') { conceal(); return; }
    stopTimer('hide');
    const key = credit ? JSON.stringify(credit) : `unavailable:${active.node.dataset.artist}`;
    if (signature !== key) {
      title.textContent = credit?.title || 'No shared track yet';
      displayedPeople = credit ? credit.participants || [{ id: credit.parentId, name: credit.parentName }, { id: credit.artistId, name: credit.artistName }] : [];
      displayedArtist = credit?.artistId || active.node.dataset.artist;
      summary.textContent = credit ? `${displayedPeople.length} credited artists on this map`
        : 'No verified shared recording with this artist’s branch parent is available. Tap a portrait to explore connections.';
      // Keep a dense map's tooltip bounded; every verified member is still
      // highlighted in the graph, even when its name does not fit the card.
      fitSignature = '';
      meta.textContent = credit ? `${credit.source} · Track credits` : 'Only source-backed recording credits are shown.';
      play.hidden = !credit || !onSelect;
      play.setAttribute('aria-label', credit ? `Open official preview for ${credit.title}` : 'No official preview available');
      element.dataset.parentId = credit?.parentId || ''; element.dataset.artistId = displayedArtist;
      element.dataset.trackKey = credit?.trackKey || '';
      signature = key;
    }
    element.hidden = false;
    element.setAttribute('aria-hidden', 'false'); describe(active.node, true);
    active.titles ||= new Map();
    for (const node of [active.node, ...active.node.querySelectorAll('[title]')]) {
      if (node.hasAttribute('title')) { active.titles.set(node, node.getAttribute('title')); node.removeAttribute('title'); }
    }
    obstacles = [...host.querySelectorAll('.node')].filter(node => node !== active.node && typeof node.getBoundingClientRect === 'function')
      .map(node => node.getBoundingClientRect());
    reposition();
    if (!element.hidden) { element.classList.add('is-visible'); publish(credit); }
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
      if (active?.mode === 'touch') return;
      element.classList.remove('is-touch'); close.hidden = true;
      element.setAttribute('role', onSelect ? 'region' : 'tooltip');
      conceal(true); active = { node, mode, point }; refresh();
    },
    open(node, { trigger = node } = {}) {
      if (!node || !host.contains(node) || blocked()) return false;
      conceal(true); active = { node, mode: 'touch', trigger };
      element.classList.add('is-touch'); close.hidden = false;
      element.setAttribute('role', 'dialog');
      element.setAttribute('aria-label', 'Shared track information');
      show();
      if (!element.hidden) close.focus?.({ preventScroll: true });
      return !element.hidden;
    },
    canPreview(node) { return Boolean(node && host.contains(node) && getCredit(node.dataset.artist)); },
    isOpenFor(node) { return Boolean(node && active?.node === node && active.mode === 'touch'
      && !element.hidden && element.classList.contains('is-visible')); },
    contains(node) { return element.contains(node); },
    move(node, point) { if (active?.node === node && active.mode === 'pointer') active.point = point; },
    leave(node, { bridge = false } = {}) {
      if (active?.node !== node) return;
      if (active.mode === 'touch') return;
      if (onSelect && (bridge || element.contains(doc.activeElement))) queueExit();
      else dismiss();
    },
    activate,
    dismiss,
    refresh,
    reposition,
    destroy() { dismiss(true); element.remove(); }
  };
}
