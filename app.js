import { createExplorer, layoutArtists, zoomAroundPoint, MIN_ZOOM, MAX_ZOOM } from './explorer-state.js';
import { SOURCE_NAMES, EXPANSION_LIMIT, fetchApiStatus, fetchStartingPoints, searchLiveArtists, fetchArtist, fetchConnectionPages, requestId, mergeLiveGraph } from './live-client.js';
import { sameArtist } from './artist-identity.js';
import { separateArtists, layoutNearbyArtists, bundleConnections } from './graph-layout.js';
import { createElasticGraph, graphDistances, pointerToGraph, cameraToCenter } from './graph-interaction.js';
import { createIntroNetwork } from './intro-network.js';
import { lookupFeedback, discoveryTargets, createDiscoveryFeedback } from './lookup-feedback.js';
import { createMapStore, validateSavedMap } from './saved-maps.js';
import { createSavedMapsUI } from './saved-maps-ui.js';
import { sharedTrackPreview, createCreditPreview } from './credit-preview.js';

const suggestions = ['Tohji', 'Bladee', 'Yung Lean', 'Lucy Bedroque', 'prettifun'];
const artists = Object.create(null);
const edges = [];
const seeds = [];
const viewParams = new URLSearchParams(window.location.search);
const spotifyId = viewParams.get('id') || '';
const spotifyView = viewParams.get('source') === 'spotify' && /^[a-zA-Z0-9]{22}$/.test(spotifyId);
if (spotifyView) {
  const id = `spotify:${spotifyId}`;
  artists[id] = { name: (viewParams.get('name') || 'Spotify artist').slice(0, 100), initials: 'S', x: 500, y: 300, size: 164, tags: ['ARTIST'], origin: 'pending',
    providerIds: { spotify: spotifyId }, url: `https://open.spotify.com/artist/${spotifyId}`, links: { spotify: `https://open.spotify.com/artist/${spotifyId}` }, description: 'Loading the selected Spotify artist…' };
  seeds.splice(0, seeds.length, id);
}
const explorer = createExplorer({ artists, edges, seeds, initialArtist: spotifyView ? seeds[0] : null });
const liveStates = new Map();
let apiStatus = [];
let activeLookup = null;
let profileLookup = null;
let lookupVersion = 0;
let layout = new Map();
let layoutPositions = new Map();
let selectedConnection = null;
let zoom = 1;
let pan = { x: 0, y: 0 };
const $ = selector => document.querySelector(selector);
const world = $('#graph-world');
const svgNS = 'http://www.w3.org/2000/svg';
const introNetwork = createIntroNetwork($('#intro-network'));
const matchedEdges = id => edges.filter(edge => edge.a === id || edge.b === id);
const opposite = (edge, id) => edge.a === id ? edge.b : edge.a;
const edgeElements = new Map();
const discoveryFeedback = createDiscoveryFeedback();
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let motionPaused = false;
let hoveredArtist = null;
const elastic = createElasticGraph();
let targetLayout = new Map();
let graphViewport = { width: 1000, height: 650 };
let motionFrame = null, lastMotionTime = null;
let cameraFrame = null, cameraTarget = null;
let cameraRevision = 0, focusIntent = null;
let nodeDrag = null, suppressedClick = null;
let drag = null;
let savedMapsUI, creditPreview, pathPreview = null, trailSignature = '';
const elasticEnabled = () => !spotifyView && !motionPaused && !motionQuery.matches && !document.hidden;

function syncMotion() {
  const enabled = !motionPaused && !motionQuery.matches;
  const paused = !enabled || document.hidden;
  document.documentElement.classList.toggle('motion-paused', paused);
  const svg = $('#connections');
  if (paused) svg.pauseAnimations?.();
  else svg.unpauseAnimations?.();
  const toggle = $('#motion-toggle');
  toggle.textContent = enabled ? 'Ⅱ' : '▶';
  toggle.setAttribute('aria-pressed', String(enabled));
  toggle.setAttribute('aria-label', enabled ? 'Pause graph animations' : 'Resume graph animations');
  toggle.disabled = motionQuery.matches;
  toggle.title = motionQuery.matches ? 'Reduced motion is enabled in your system settings' : toggle.getAttribute('aria-label');
  if (paused) { stopElasticMotion(); stopCameraAnimation(); }
  if (paused) discoveryFeedback.clear();
  if (document.hidden) creditPreview?.dismiss(true);
  introNetwork.setPaused(paused);
}

$('#motion-toggle').addEventListener('click', () => {
  motionPaused = !motionPaused;
  syncMotion();
});
motionQuery.addEventListener('change', syncMotion);
document.addEventListener('visibilitychange', syncMotion);

function highlightConnections(id) {
  hoveredArtist = id;
  world.classList.toggle('has-hover', Boolean(id));
  const neighbors = new Set(id ? matchedEdges(id).map(edge => opposite(edge, id)) : []);
  document.querySelectorAll('.node').forEach(node => {
    node.classList.toggle('is-neighbor', neighbors.has(node.dataset.artist));
  });
  edgeElements.forEach(({ link, edge }) => {
    link.classList.toggle('is-highlighted', edge.a === id || edge.b === id);
  });
  applyPathPreview();
}

function applyPathPreview() {
  const ids = new Set(pathPreview || []), pairs = new Set();
  for (let i = 1; i < (pathPreview?.length || 0); i++) pairs.add([pathPreview[i - 1], pathPreview[i]].sort().join('|'));
  world.classList.toggle('has-path-preview', ids.size > 0);
  for (const node of $('#nodes').children) node.classList.toggle('is-path-node', ids.has(node.dataset.artist));
  edgeElements.forEach(({ link }, key) => link.classList.toggle('is-path', pairs.has(key)));
}
function previewPath(path = null) { pathPreview = path; applyPathPreview(); }
function renderTrail() {
  const trail = explorer.trail, host = $('#exploration-trail');
  $('#exploration-path').hidden = trail.length === 0;
  const signature = JSON.stringify(trail.map(id => [id, artists[id]?.name]));
  if (signature !== trailSignature) {
    trailSignature = signature; host.replaceChildren(); pathPreview = null;
    trail.forEach((id, index) => {
      const item = document.createElement('li'), button = document.createElement('button');
      if (index) {
        const arrow = document.createElement('span'); arrow.className = 'path-arrow'; arrow.textContent = '→';
        arrow.setAttribute('aria-hidden', 'true'); item.append(arrow);
      }
      button.type = 'button'; button.dataset.trailId = id; button.dataset.trailIndex = String(index);
      button.textContent = artists[id].name;
      button.title = `Move to ${artists[id].name} without expanding`;
      button.setAttribute('aria-label', `Move to ${artists[id].name} without expanding`);
      if (index === trail.length - 1) button.setAttribute('aria-current', 'location');
      item.append(button); host.append(item);
    });
    host.scrollLeft = host.scrollWidth - host.clientWidth;
  }
  applyPathPreview();
}
function focusTrailArtist(id) {
  if (!explorer.visibleIds.has(id)) return;
  creditPreview?.dismiss(true);
  previewPath();
  if (explorer.selected !== id) { cancelLiveLookup(); profileLookup?.abort(); lookupVersion++; }
  selectedConnection = null; stopCameraAnimation();
  focusIntent = { id, revision: cameraRevision };
  explorer.focus(id); render();
  [...$('#nodes').children].find(node => node.dataset.artist === id)?.focus({ preventScroll: true });
  $('#graph-announcement').textContent = `Moved to ${artists[id].name}. No new connections were requested.`;
}
const pathHost = $('#exploration-path');
pathHost.addEventListener('click', event => {
  const button = event.target.closest('[data-trail-id]');
  if (button) focusTrailArtist(button.dataset.trailId);
});
pathHost.addEventListener('pointerenter', () => previewPath(explorer.trail));
for (const type of ['pointerover', 'focusin']) pathHost.addEventListener(type, event => {
  const button = event.target.closest('[data-trail-index]');
  if (button) previewPath(explorer.trail.slice(0, Number(button.dataset.trailIndex) + 1));
});
pathHost.addEventListener('pointerleave', () => {
  if (!pathHost.contains(document.activeElement)) previewPath();
});
pathHost.addEventListener('focusout', event => { if (!pathHost.contains(event.relatedTarget)) previewPath(); });

function snapshotMap() {
  return { graph: { artists: [...explorer.visibleIds].map(id => ({ ...artists[id], x: layout.get(id)?.x ?? artists[id].x, y: layout.get(id)?.y ?? artists[id].y })),
    edges: explorer.visibleEdges, explorer: explorer.snapshot() },
    camera: { zoom, pan: { ...pan }, width: graphViewport.width, height: graphViewport.height } };
}
function openSavedMap(value) {
  const map = validateSavedMap(value, spotifyView ? 'spotify' : 'main');
  if (!map) throw new Error('Invalid saved map');
  cancelLiveLookup(); profileLookup?.abort(); lookupVersion++;
  clearGraphInteraction(); previewPath(); selectedConnection = null; hoveredArtist = null;
  liveStates.clear();
  // Keep hidden startup identities (especially the Spotify URL root) available
  // for Start over, but replace the saved visible relationships exactly.
  for (const artist of map.graph.artists) artists[artist.id] = artist;
  edges.splice(0, edges.length, ...map.graph.edges);
  explorer.restore(map.graph.explorer);
  layoutPositions = new Map(map.graph.artists.map(artist => [artist.id, { x: artist.x, y: artist.y }]));
  render(); stopElasticMotion();
  zoom = map.camera.zoom;
  pan = { x: map.camera.pan.x * graphViewport.width / map.camera.width, y: map.camera.pan.y * graphViewport.height / map.camera.height };
  updateCamera();
  [...$('#nodes').children].find(node => node.dataset.artist === explorer.selected)?.focus({ preventScroll: true });
}

function portrait(artist, className, small = false) {
  const el = document.createElement(artist.image ? 'img' : 'span');
  el.className = className;
  if (artist.image) {
    el.src = small ? artist.image.replace('800x800bb', '160x160bb') : artist.image;
    el.alt = `${artist.name} — ${artist.imageType || 'artist photo'} (${artist.imageSource || 'source image'})`;
    if (artist.imageSource === 'Spotify') el.classList.add('spotify-image');
    el.decoding = 'async';
    el.referrerPolicy = 'no-referrer';
    el.addEventListener('error', () => {
      const fallback = document.createElement('span');
      fallback.className = `${className} initials`;
      fallback.textContent = artist.initials;
      fallback.setAttribute('aria-label', artist.name);
      el.replaceWith(fallback);
    }, { once: true });
  } else {
    el.textContent = artist.initials;
    el.classList.add('initials');
  }
  return el;
}

function renderLookupFeedback() {
  for (const node of $('#nodes').children) {
    const id = node.dataset.artist, state = liveStates.get(id) || {};
    const active = id === explorer.selected && state.version === lookupVersion && activeLookup && !activeLookup.signal.aborted;
    const feedback = lookupFeedback(id === explorer.selected && explorer.isExpanded(id) ? state : {}, { active: Boolean(active) });
    let ring = node.querySelector('.node-lookup-ring'), label = node.querySelector('.node-lookup-status');
    if (!ring) {
      ring = document.createElementNS(svgNS, 'svg');
      ring.setAttribute('class', 'node-lookup-ring'); ring.setAttribute('viewBox', '0 0 100 100');
      ring.setAttribute('aria-hidden', 'true'); ring.setAttribute('focusable', 'false');
      for (const className of ['lookup-track', 'lookup-arc']) {
        const circle = document.createElementNS(svgNS, 'circle');
        for (const [key, value] of Object.entries({ cx: 50, cy: 50, r: 47, pathLength: 100, class: className })) circle.setAttribute(key, String(value));
        ring.append(circle);
      }
      node.querySelector('.node-photo').append(ring);
      label = document.createElement('span'); label.className = 'node-lookup-status';
      label.setAttribute('aria-hidden', 'true'); node.append(label);
    }
    node.dataset.lookupPhase = feedback.phase;
    for (const phase of ['loading', 'background', 'error']) node.classList.toggle(`is-lookup-${phase}`, feedback.phase === phase);
    ring.style.display = feedback.phase === 'idle' ? 'none' : '';
    label.hidden = feedback.phase === 'idle'; label.textContent = feedback.label;
    node.setAttribute('aria-busy', String(feedback.busy));
    node.setAttribute('aria-label', `Explore ${artists[id].name}${feedback.label ? `. ${feedback.label}` : ''}`);
  }
}

function pulseDiscoveries(ids, anchorId) {
  const enabled = !motionPaused && !motionQuery.matches && !document.hidden;
  for (const { key, reverse } of discoveryTargets(bundleConnections(explorer.visibleEdges), ids, anchorId)) {
    discoveryFeedback.pulse(edgeElements.get(key)?.discovery, { reverse, enabled });
  }
}

function cancelLiveLookup(clearDiscovery = true) {
  activeLookup?.abort(); activeLookup = null;
  for (const [id, state] of liveStates) {
    if (state.loading || state.pending) liveStates.set(id, { ...state, loading: false, pending: false });
  }
  if (clearDiscovery) discoveryFeedback.clear();
  renderLookupFeedback();
}

function selectArtist(id) {
  if (!Object.hasOwn(artists, id)) return;
  creditPreview?.dismiss(true);
  previewPath();
  stopCameraAnimation();
  focusIntent = { id, revision: cameraRevision };
  if (explorer.selected === id && liveStates.get(id)?.loading) { centerSelectedArtist(); return; }
  const previouslyVisible = explorer.visibleIds;
  const limit = spotifyView ? Math.min(EXPANSION_LIMIT, Math.max(0, 20 - previouslyVisible.size)) : EXPANSION_LIMIT;
  selectedConnection = null;
  if (explorer.selected !== id) { cancelLiveLookup(); lookupVersion++; }
  const changed = explorer.select(id, { maxNew: limit });
  render();
  $('#graph-announcement').textContent = `${artists[id].name} selected. Connected people have been added; previously visible artists stay on the map. ${explorer.visibleIds.size} artists visible.`;
  const revealed = [...explorer.visibleIds].filter(key => !previouslyVisible.has(key));
  pulseDiscoveries(revealed, id);
  const added = revealed.length;
  const live = liveStates.get(id) || {};
  if (added < limit && !live.loading && (!live.loaded || live.hasMore || live.error)) {
    void loadLiveConnections(id, { offset: live.loaded ? live.nextOffset || 0 : 0, maxNew: limit - added, remember: !changed });
  }
}

function startWithArtist(id) {
  if (!Object.hasOwn(artists, id)) return;
  cancelLiveLookup(); profileLookup?.abort(); lookupVersion++;
  clearGraphInteraction();
  previewPath();
  selectedConnection = null; hoveredArtist = null; layoutPositions.clear();
  artists[id].x = 500; artists[id].y = 300; artists[id].size = 164;
  explorer.start(id);
  resetCamera(); render();
  $('#graph-announcement').textContent = `${artists[id].name} is your starting artist. Click the portrait to expand up to ${EXPANSION_LIMIT} connected people.`;
}

async function loadStartingProfile(id) {
  const controller = new AbortController(); profileLookup = controller;
  const version = lookupVersion;
  try {
    const result = await fetchArtist(requestId(artists[id]), controller.signal);
    if (version !== lookupVersion || explorer.selected !== id) return;
    const merged = mergeLiveGraph(artists, edges, { ...result, artists: [result.artist], edges: [] }, id);
    explorer.remapAliases(merged.aliases);
    render();
  } catch (error) {
    if (!controller.signal.aborted && explorer.selected === id) {
      liveStates.set(id, { ...liveStates.get(id), profileError: error.message }); renderPanel();
    }
  }
}

async function refreshApiStatus() {
  try {
    const result = await fetchApiStatus();
    apiStatus = result.providers;
    const configured = apiStatus.filter(source => source.configured).length;
    const verified = apiStatus.filter(source => source.lastSuccess).length;
    $('#api-status').textContent = `${configured}/4 SOURCES CONFIGURED · ${verified} RESPONDING`;
  } catch (error) { $('#api-status').textContent = error.message; }
}

async function loadLiveConnections(id, { offset = 0, maxNew = EXPANSION_LIMIT, remember = false } = {}) {
  const artist = artists[id];
  const apiId = requestId(artist);
  const previous = liveStates.get(id) || {};
  if (!apiId) {
    liveStates.set(id, { error: 'Select a source-backed search result to verify this artist’s identity.', needsSearch: true });
    if (explorer.selected === id) renderPanel();
    renderLookupFeedback();
    return;
  }
  cancelLiveLookup(false);
  const controller = new AbortController();
  activeLookup = controller;
  const version = ++lookupVersion;
  let currentId = id;
  let remaining = maxNew;
  let remembered = false;
  const isCurrent = () => version === lookupVersion && explorer.selected === currentId && !controller.signal.aborted;
  liveStates.set(id, { ...previous, loading: true, pending: false, error: '', version });
  renderPanel();
  renderLookupFeedback();
  $('#graph-announcement').textContent = `Looking up credits for ${artist.name}. Verified connections will appear as they arrive.`;
  try {
    const result = await fetchConnectionPages(apiId, artist.name, offset, controller.signal, page => {
      if (!isCurrent()) return false;
      const merged = mergeLiveGraph(artists, edges, page, currentId, { positions: layout });
      explorer.remapAliases(merged.aliases);
      if (focusIntent?.id === currentId) focusIntent.id = merged.artistId;
      if (merged.aliases.size) { discoveryFeedback.clear(); edgeElements.forEach(record => record.link.remove()); edgeElements.clear(); }
      const visible = explorer.visibleIds;
      let room = spotifyView ? Math.min(remaining, Math.max(0, 20 - visible.size)) : remaining;
      const revealed = merged.addedIds.filter(key => !visible.has(key) && room-- > 0);
      explorer.reveal(revealed, { remember: remember && !remembered });
      if (revealed.length) remembered = true;
      remaining -= revealed.length;
      if (merged.artistId !== currentId) liveStates.delete(currentId);
      currentId = merged.artistId;
      const success = page.edges.length > 0 || page.sources.some(source => source.status === 'ok' || source.status === 'partial');
      liveStates.set(currentId, { loaded: true, loading: remaining > 0, pending: Boolean(page.pending), version, hasMore: page.page.hasMore || Boolean(page.pending),
        nextOffset: page.page.nextOffset, sources: page.sources, identityWarnings: page.identityWarnings, note: page.note,
        error: success || page.pending ? '' : 'No verified live source was available. Check API status and source identity links, then retry.' });
      render();
      pulseDiscoveries(revealed, currentId);
      return remaining > 0;
    });
    if (!isCurrent()) return;
    const success = !liveStates.get(currentId).error;
    liveStates.set(currentId, { ...liveStates.get(currentId), loading: false, pending: false });
    render();
    $('#graph-announcement').textContent = success ? `Live lookup finished for ${artist.name}. ${result.page.total} connected artists in this sample.` : 'No verified live source was available for this artist. Open API status for setup details.';
    void refreshApiStatus();
  } catch (error) {
    if (!isCurrent()) return;
    liveStates.set(currentId, { ...liveStates.get(currentId), loading: false, pending: false, error: error.message });
    renderPanel();
    renderLookupFeedback();
    $('#graph-announcement').textContent = `Could not finish the lookup for ${artist.name}. ${error.message}`;
  } finally {
    const state = liveStates.get(currentId);
    if (state?.version === version && (state.loading || state.pending)) liveStates.set(currentId, { ...state, loading: false, pending: false });
    if (activeLookup === controller) activeLookup = null;
    renderLookupFeedback();
  }
}

function render() {
  const nodeHost = $('#nodes');
  // Keep existing DOM nodes so a click does not restart every floating animation.
  const existing = new Map([...nodeHost.children].map(node => [node.dataset.artist, node]));
  const { selected, visibleIds } = explorer;
  layout = layoutArtists(artists, visibleIds);
  let entering = 0;
  for (const id of visibleIds) {
    const artist = layout.get(id);
    let button = existing.get(id);
    if (!button) {
      button = document.createElement('button');
      button.className = 'node';
      button.dataset.artist = id;
      const index = Object.keys(artists).indexOf(id);
      const source = artists[selected];
      const fromX = explorer.canGoBack ? Math.max(-30, Math.min(30, (source.x - artist.x) / 8)) : 0;
      const fromY = explorer.canGoBack ? Math.max(-30, Math.min(30, (source.y - artist.y) / 8)) : 16;
      button.style.cssText = `left:${artist.x / 10}%;top:${artist.y / 6.5}%;--size:${artist.size}px;--enter-x:${fromX}px;--enter-y:${fromY}px;--enter-delay:${entering++ * 65}ms;--float-duration:${6.5 + index * .55}s;--float-delay:${-index * 1.2}s;--drift-x:${index % 2 ? -4 : 4}px;--drift-y:${index % 3 ? -5 : -7}px`;
      const orbit = document.createElement('span');
      orbit.className = 'node-orbit';
      const photo = document.createElement('span');
      photo.className = 'node-photo';
      photo.append(portrait(artist, ''));
      const shade = document.createElement('span');
      shade.className = 'node-shade'; shade.setAttribute('aria-hidden', 'true');
      photo.append(shade);
      button.dataset.image = artist.image || '';
      const name = document.createElement('span'); name.className = 'node-name'; name.textContent = artist.name;
      const role = document.createElement('span'); role.className = 'node-role';
      orbit.append(photo, name, role);
      button.append(orbit);
      button.addEventListener('click', event => {
        if (suppressedClick?.id === id && event.detail > 0 && performance.now() < suppressedClick.until) {
          event.preventDefault(); event.stopPropagation(); suppressedClick = null; return;
        }
        selectArtist(id);
        if (event.detail === 0) button.focus({ preventScroll: true });
      });
      button.addEventListener('pointerenter', event => {
        highlightConnections(id);
        if (event.pointerType !== 'touch') creditPreview?.enter(button, { point: { x: event.clientX, y: event.clientY } });
      });
      button.addEventListener('pointermove', event => creditPreview?.move(button, { x: event.clientX, y: event.clientY }));
      button.addEventListener('pointerleave', () => { highlightConnections(null); creditPreview?.leave(button); });
      button.addEventListener('focus', () => { highlightConnections(id); creditPreview?.enter(button, { mode: 'focus' }); });
      button.addEventListener('blur', () => { highlightConnections(null); creditPreview?.leave(button); });
      button.addEventListener('keydown', event => {
        if (!event.shiftKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        manualCameraIntent();
        const current = targetLayout.get(id);
        if (!current) return;
        const step = 24 / zoom;
        layoutPositions.set(id, { x: current.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0) / graphViewport.width * 1000,
          y: current.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) / graphViewport.height * 650 });
        updateGraphLayout(id);
        $('#graph-announcement').textContent = `${artist.name} moved. Use Shift and arrow keys to reposition, or Enter to explore.`;
      });
      nodeHost.append(button);
    }
    button.classList.toggle('selected', id === selected);
    button.setAttribute('aria-label', `Explore ${artist.name}`);
    button.setAttribute('aria-pressed', String(id === selected));
    const photo = button.querySelector('.node-photo');
    const shown = photo.querySelector('img, .initials');
    if (button.dataset.image !== (artist.image || '')) {
      shown?.remove();
      photo.prepend(portrait(artist, ''));
      button.dataset.image = artist.image || '';
    }
    button.querySelector('.node-name').textContent = artist.name;
    button.querySelector('.node-name').title = artist.name;
    if (id === selected) {
      if (!photo.querySelector('.node-badge')) {
        const badge = document.createElement('span');
        badge.className = 'node-badge';
        badge.textContent = '↗';
        photo.append(badge);
      }
    } else {
      photo.querySelector('.node-badge')?.remove();
    }
    button.querySelector('.node-role').textContent = id === selected ? 'YOU ARE HERE' : artist.tags.includes('PRODUCER') ? 'ARTIST / PRODUCER' : 'ARTIST';
    existing.delete(id);
  }
  existing.forEach(node => node.remove());
  updateGraphLayout();
  updateFocusDepth();
  highlightConnections(visibleIds.has(hoveredArtist) ? hoveredArtist : null);
  renderPanel();
  renderLookupFeedback();
  renderTrail();
  savedMapsUI?.refresh();
  creditPreview?.refresh();
  $('#node-count').textContent = `${String(visibleIds.size).padStart(2, '0')} artists`;
  $('#map-empty-state').hidden = visibleIds.size > 0;
  $('#map-description').textContent = !selected ? 'Search for an artist to begin.' : explorer.isExpanded(selected) ? 'Click artists to explore. Click lines for credits.' : 'One artist. Click their portrait to unfold the connections.';
  $('#back-button').disabled = !explorer.canGoBack;
  document.querySelectorAll('.seed-button').forEach(button => {
    const active = Boolean(selected && artists[selected].name.toLowerCase() === button.dataset.query?.toLowerCase());
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
}

function updateGraphLayout(positionAnchor = null) {
  const width = world.clientWidth || 1000, height = world.clientHeight || 650;
  graphViewport = { width, height };
  const previousIds = new Set(targetLayout.keys());
  const photoSizes = new Map(), captionWidths = new Map();
  if (typeof getComputedStyle === 'function') {
    document.querySelectorAll('.node').forEach(node => {
      const size = parseFloat(getComputedStyle(node).getPropertyValue('--size'));
      if (size) photoSizes.set(node.dataset.artist, size);
      const caption = Math.max(node.querySelector('.node-name').offsetWidth || 0, node.querySelector('.node-role').offsetWidth || 0);
      if (caption) captionWidths.set(node.dataset.artist, caption + 24);
    });
  }
  const preferred = layoutArtists(artists, explorer.visibleIds);
  const ordered = preferred.has(positionAnchor)
    ? new Map([[positionAnchor, preferred.get(positionAnchor)], ...[...preferred].filter(([id]) => id !== positionAnchor)])
    : preferred;
  const arrange = spotifyView ? separateArtists : layoutNearbyArtists;
  targetLayout = arrange(ordered, {
    width, height, previous: layoutPositions, compact: window.innerWidth <= 1100, photoSizes, captionWidths,
    edges: explorer.visibleEdges, anchorId: explorer.selected, pinnedId: positionAnchor || explorer.selected
  });
  layoutPositions = new Map([...targetLayout].map(([id, node]) => [id, { x: node.x, y: node.y }]));
  const entering = [...targetLayout.keys()].filter(id => !previousIds.has(id));
  const positions = new Map([...targetLayout].map(([id, node]) => [id, { x: node.x / 1000 * width, y: node.y / 650 * height }]));
  const origins = new Map(), colliders = new Map();
  const anchor = positions.get(explorer.selected);
  for (const [id, node] of targetLayout) {
    if (!spotifyView) colliders.set(id, (photoSizes.get(id) || node.size || 96) / 2 + 9);
    if (anchor && entering.includes(id) && id !== explorer.selected) {
      const point = positions.get(id);
      origins.set(id, { x: anchor.x + (point.x - anchor.x) * .78, y: anchor.y + (point.y - anchor.y) * .78 });
    }
  }
  elastic.setLayout(positions, explorer.visibleEdges, { animate: elasticEnabled(), entering, origins, colliders });
  drawMotionFrame();
  renderEdges();
  if (elasticEnabled()) startElasticMotion();
  centerSelectedArtist();
}

function updateFocusDepth() {
  const distances = graphDistances(explorer.visibleIds, explorer.visibleEdges, explorer.selected);
  document.querySelectorAll('#nodes .node').forEach(node => {
    const distance = distances.get(node.dataset.artist);
    node.dataset.distance = Number.isFinite(distance) ? String(distance) : 'unconnected';
    node.classList.toggle('is-distant', Boolean(explorer.selected && distance >= 2));
    node.classList.toggle('is-remote', Boolean(explorer.selected && distance > 2));
    node.title = `${artists[node.dataset.artist].name} · Click to center and explore · Drag to move · Shift + arrow keys to reposition`;
  });
  edgeElements.forEach(({ link, edge }) => {
    link.classList.toggle('is-distant', (distances.get(edge.a) ?? Infinity) >= 2 || (distances.get(edge.b) ?? Infinity) >= 2);
  });
}

function drawMotionFrame() {
  const positions = elastic.positions;
  layout = new Map([...targetLayout].map(([id, node]) => {
    const point = positions.get(id);
    if (!point) return [id, node];
    return [id, { ...node, x: point.x / graphViewport.width * 1000, y: point.y / graphViewport.height * 650,
      footprint: { ...node.footprint, x: point.x, y: point.y } }];
  }));
  document.querySelectorAll('#nodes .node').forEach(node => {
    const point = layout.get(node.dataset.artist);
    if (point) { node.style.left = `${point.x / 10}%`; node.style.top = `${point.y / 6.5}%`; }
  });
  edgeElements.forEach(record => {
    const a = layout.get(record.edge.a), b = layout.get(record.edge.b);
    if (!a || !b) return;
    const curve = `M ${a.x} ${a.y} Q ${(a.x+b.x)/2} ${(a.y+b.y)/2 - (record.index % 2 ? 20 : -15)} ${b.x} ${b.y}`;
    record.path.setAttribute('d', curve); record.hit.setAttribute('d', curve);
    record.trace.setAttribute('d', curve); record.travel.setAttribute('path', curve);
    record.discovery.setAttribute('d', curve);
  });
  creditPreview?.reposition();
}

function startElasticMotion() {
  if (motionFrame !== null || !elasticEnabled() || typeof requestAnimationFrame !== 'function') return;
  lastMotionTime = null;
  const frame = time => {
    motionFrame = null;
    if (!elasticEnabled()) { stopElasticMotion(); return; }
    const moving = elastic.step(lastMotionTime === null ? 16 : time - lastMotionTime);
    lastMotionTime = time;
    drawMotionFrame();
    if (moving) motionFrame = requestAnimationFrame(frame);
  };
  motionFrame = requestAnimationFrame(frame);
}

function stopElasticMotion() {
  if (motionFrame !== null) cancelAnimationFrame(motionFrame);
  motionFrame = null; lastMotionTime = null;
  elastic.settle();
  if (targetLayout.size) drawMotionFrame();
}

function clearGraphInteraction() {
  finishNodeDrag(true);
  stopElasticMotion(); stopCameraAnimation();
  elastic.clear(); targetLayout.clear();
  discoveryFeedback.clear();
  creditPreview?.dismiss(true);
  focusIntent = null; suppressedClick = null;
}

function showConnection(key) {
  selectedConnection = key;
  renderPanel();
  $('#graph-announcement').textContent = 'Connection selected. Song credits and source links are in the details panel.';
}

function renderEdges() {
  const svg = $('#connections');
  svg.setAttribute('preserveAspectRatio', 'none');
  const current = new Set();
  bundleConnections(explorer.visibleEdges).forEach((edge, index) => {
    const key = edge.key;
    current.add(key);
    let record = edgeElements.get(key);
    const active = edge.a === explorer.selected || edge.b === explorer.selected;
    const a = layout.get(edge.a), b = layout.get(edge.b);
    const curve = `M ${a.x} ${a.y} Q ${(a.x+b.x)/2} ${(a.y+b.y)/2 - (index % 2 ? 20 : -15)} ${b.x} ${b.y}`;
    const description = `${a.name} and ${b.name}: ${edge.types.join(', ')}. Open song credits in the details panel.`;
    if (record) {
      record.edge = edge;
      record.index = index;
      record.path.setAttribute('class', `edge ${edge.type} ${active ? 'active' : ''}`);
      record.path.setAttribute('d', curve);
      record.hit.setAttribute('d', curve);
      record.trace.setAttribute('d', curve);
      record.discovery.setAttribute('d', curve);
      record.travel.setAttribute('path', curve);
      record.link.classList.toggle('is-active', active);
      record.link.classList.toggle('is-selected', key === selectedConnection);
      record.link.setAttribute('aria-label', description);
      record.path.querySelector('title').textContent = `${a.name} ↔ ${b.name} · click for credits`;
      return;
    }
    const link = document.createElementNS(svgNS, 'a');
    link.setAttribute('class', `connection-link ${active ? 'is-active' : ''}`);
    link.setAttribute('href', '#'); link.setAttribute('role', 'button');
    link.setAttribute('aria-label', description);
    link.addEventListener('click', event => { event.preventDefault(); showConnection(key); });
    link.addEventListener('keydown', event => {
      if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); showConnection(key); }
    });
    const hit = document.createElementNS(svgNS, 'path');
    hit.setAttribute('d', curve); hit.setAttribute('class', 'connection-hit'); hit.setAttribute('aria-hidden', 'true'); link.append(hit);
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', curve);
    path.setAttribute('class', `edge ${edge.type} ${active ? 'active' : ''}`);
    const title = document.createElementNS(svgNS, 'title'); title.textContent = `${a.name} ↔ ${b.name} · click for credits`; path.append(title); link.append(path); svg.append(link);
    const trace = document.createElementNS(svgNS, 'path');
    trace.setAttribute('d', curve);
    trace.setAttribute('pathLength', '1');
    trace.setAttribute('class', 'connection-trace');
    trace.setAttribute('aria-hidden', 'true');
    link.append(trace);
    const discovery = document.createElementNS(svgNS, 'path');
    discovery.setAttribute('d', curve); discovery.setAttribute('pathLength', '1');
    discovery.setAttribute('class', 'connection-discovery'); discovery.setAttribute('aria-hidden', 'true');
    link.append(discovery);
    const flow = document.createElementNS(svgNS, 'g');
    flow.setAttribute('class', 'connection-flow');
    flow.setAttribute('aria-hidden', 'true');
    for (const [radius, opacity] of [[4.5, .14], [1.8, .9]]) {
      const dot = document.createElementNS(svgNS, 'circle');
      dot.setAttribute('r', radius);
      dot.setAttribute('opacity', opacity);
      flow.append(dot);
    }
    const travel = document.createElementNS(svgNS, 'animateMotion');
    travel.setAttribute('path', curve);
    travel.setAttribute('dur', `${5.5 + index * .65}s`);
    travel.setAttribute('begin', `${-index * .8}s`);
    travel.setAttribute('repeatCount', 'indefinite');
    flow.append(travel);
    link.append(flow);
    edgeElements.set(key, { link, path, hit, trace, discovery, travel, edge, index });
  });
  edgeElements.forEach((record, key) => {
    if (!current.has(key)) {
      discoveryFeedback.forget(record.discovery);
      record.link.remove();
      edgeElements.delete(key);
    }
  });
  syncMotion();
  applyPathPreview();
}

function renderPanel() {
  if (!explorer.selected) {
    $('#artist-panel').innerHTML = '<div class="panel-overline"><span>YOUR STARTING POINT</span><span aria-hidden="true">↗</span></div><h2 class="panel-name">It starts<br>with one artist.</h2><p class="panel-description">Search for someone you love. Select a result to place a single artist on the map, then click their portrait to follow the connections.</p><p class="live-lookup-status">Nothing expands automatically. You choose where to go next.</p>';
    return;
  }
  if (selectedConnection) {
    const connection = bundleConnections(explorer.visibleEdges).find(edge => edge.key === selectedConnection);
    if (connection) { renderConnectionPanel(connection); return; }
    selectedConnection = null;
  }
  const { selected, visibleIds } = explorer;
  const artist = artists[selected];
  const readyToExpand = !explorer.isExpanded(selected);
  const relations = readyToExpand ? [] : matchedEdges(selected);
  const panel = $('#artist-panel');
  panel.innerHTML = `<div class="panel-overline"><span>IN THE SPOTLIGHT</span><span aria-hidden="true">↗</span></div><h2 class="panel-name"></h2><div class="panel-tags"></div><p class="panel-description"></p><p class="panel-section-label"><span>CONNECTED THROUGH</span><span>${String(relations.length).padStart(2,'0')}</span></p>`;
  panel.insertBefore(portrait(artist, artist.image ? 'panel-portrait' : 'panel-portrait panel-initials'), panel.querySelector('h2'));
  panel.querySelector('h2').textContent = artist.name;
  artist.tags.forEach(tag => { const span = document.createElement('span'); span.textContent = tag; panel.querySelector('.panel-tags').append(span); });
  panel.querySelector('.panel-description').textContent = artist.description;
  const live = liveStates.get(selected) || {};
  const lookupStatus = document.createElement('p');
  lookupStatus.className = 'live-lookup-status';
  lookupStatus.setAttribute('role', 'status');
  lookupStatus.textContent = readyToExpand ? live.profileError || 'Click this artist’s portrait to reveal up to 4 collaborators. No credit lookup has started yet.' : live.loading ? 'Fetching live credits… Connections appear as soon as they are verified.' : live.error
    || (live.pending ? 'Connections ready · checking additional sources in the background. You can keep exploring.' : '')
    || (live.loaded ? live.sources?.some(source => source.status === 'ok' || source.status === 'partial')
      ? live.hasMore ? 'Click again to follow this artist’s connections. More song credits are checked when needed; already visible people are skipped.' : 'No more verified results in the available sources. Any connected artist can start a new branch.' : 'No verified live match yet. Some sources need keys or an explicit identity link.'
      : 'Click an artist to request source-backed connections.');
  panel.insertBefore(lookupStatus, panel.querySelector('.panel-section-label'));
  if (live.sources) {
    const sourceStatus = document.createElement('p'); sourceStatus.className = 'live-source-summary';
    sourceStatus.textContent = live.sources.map(source => `${SOURCE_NAMES[source.provider]}: ${source.status.replaceAll('_', ' ')}`).join(' · ');
    panel.insertBefore(sourceStatus, panel.querySelector('.panel-section-label'));
  }
  relations.forEach(edge => {
    const row = document.createElement('div'); row.className = 'relationship';
    row.innerHTML = `<span class="relation-icon" aria-hidden="true">${edge.type === 'production' ? '⌁' : '↗'}</span><div class="relation-copy"><strong></strong><p></p><a target="_blank" rel="noopener noreferrer"></a></div>`;
    row.querySelector('strong').textContent = edge.work;
    const roles = { production: 'Production credit', collaboration: 'Collaboration', similar: 'Similar sound — not a collaboration', membership: 'Band membership' };
    row.querySelector('p').textContent = `${artists[opposite(edge,selected)].name} · ${roles[edge.type] || edge.type}`;
    row.querySelector('a').href = edge.url; row.querySelector('a').textContent = `${edge.source}${edge.origin === 'live' ? '' : ' · reference'} ↗`;
    if (edge.type === 'production' && edge.detail) {
      const detail = document.createElement('p'); detail.textContent = edge.detail;
      row.querySelector('.relation-copy').insertBefore(detail, row.querySelector('a'));
    }
    if (edge.provider === 'spotify') row.querySelector('a').prepend(spotifyMark());
    for (const evidence of (edge.evidence || []).slice(1, 4)) {
      const credit = document.createElement('a'); credit.href = evidence.url; credit.target = '_blank'; credit.rel = 'noopener noreferrer';
      credit.textContent = `${evidence.work} · ${evidence.source} ↗`;
      row.querySelector('.relation-copy').append(credit);
    }
    const explore = document.createElement('button');
    explore.className = 'connection-artist';
    const neighborId = opposite(edge, selected);
    explore.textContent = `Explore ${artists[neighborId].name} →`;
    explore.addEventListener('click', () => selectArtist(neighborId));
    row.querySelector('.relation-copy').append(explore);
    panel.append(row);
  });
  if (!relations.length && !readyToExpand) {
    const empty = document.createElement('p');
    empty.className = 'panel-description';
    empty.textContent = live.loading ? 'Checking available source credits…' : 'No connections in the available credit sample. Missing data is not evidence that no collaborations exist.';
    panel.append(empty);
  }
  const expand = document.createElement('button'); expand.className = 'expand-button';
  expand.innerHTML = '<span>Load live connections</span><span aria-hidden="true">↗</span>';
  const hiddenKnown = live.loaded && relations.some(edge => !visibleIds.has(opposite(edge, selected)));
  const atSpotifyLimit = spotifyView && visibleIds.size >= 20;
  expand.firstElementChild.textContent = readyToExpand ? 'Explore connections' : live.loading ? 'Loading…' : live.needsSearch ? 'Search this artist' : hiddenKnown || live.hasMore ? 'Show 4 more' : live.loaded && !live.error ? 'Connections loaded' : live.error ? 'Retry live lookup' : 'Load live connections';
  if (atSpotifyLimit) expand.firstElementChild.textContent = '20-artist view limit';
  expand.disabled = Boolean(!readyToExpand && (live.loading || atSpotifyLimit || (live.loaded && !live.hasMore && !hiddenKnown && !live.error)));
  expand.addEventListener('click', () => {
    if (live.needsSearch) { input.value = artist.name; input.dispatchEvent(new Event('input')); input.focus(); }
    else selectArtist(selected);
  });
  panel.append(expand);
  for (const [provider, url] of Object.entries(artist.links || {})) {
    if (!url) continue;
    const source = document.createElement('a'); source.href = url; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.className = 'source-link'; source.textContent = `${SOURCE_NAMES[provider]} artist page ↗`;
    if (provider === 'spotify') source.prepend(spotifyMark());
    panel.append(source);
  }
  if (visibleIds.size >= 40 || atSpotifyLimit) {
    const note = document.createElement('p'); note.className = 'live-lookup-status'; note.textContent = atSpotifyLimit ? 'Spotify content sets show up to 20 artists. Search for a new artist to open another explorer, or use Back / Start over.' : 'Every artist is a new starting point. Keep following any branch; pan or fit the graph as it grows.'; panel.append(note);
  }
}

function renderConnectionPanel(connection) {
  const panel = $('#artist-panel');
  panel.innerHTML = '<div class="panel-overline"><span>CONNECTION DETAILS</span><span aria-hidden="true">↗</span></div><h2 class="connection-title"></h2><p class="panel-description">Song names stay here, not on the map. Source records may include alternate versions or duplicate releases; this is not a verified distinct-song total.</p><div class="connection-credit-list"></div>';
  panel.querySelector('h2').textContent = `${artists[connection.a].name} ↔ ${artists[connection.b].name}`;
  const host = panel.querySelector('.connection-credit-list');
  const roles = { collaboration: 'Shared recording credit', production: 'Production', similar: 'Similar sound — not a work credit', membership: 'Band membership — not a work credit' };
  for (const credit of connection.evidence) {
    const row = document.createElement('div'); row.className = 'connection-credit';
    const title = document.createElement('strong'); title.textContent = credit.work;
    const detail = document.createElement('p'); detail.textContent = `${roles[credit.type] || credit.type}${credit.detail ? ` · ${credit.detail}` : ''}`;
    const source = document.createElement('a'); source.href = credit.url; source.target = '_blank'; source.rel = 'noopener noreferrer';
    source.textContent = `${credit.source}${credit.origin === 'reference' ? ' · reference' : ''} ↗`;
    if (credit.provider === 'spotify') source.prepend(spotifyMark());
    row.append(title, detail, source); host.append(row);
  }
  const back = document.createElement('button'); back.className = 'expand-button'; back.textContent = '← Back to artist';
  back.addEventListener('click', () => { selectedConnection = null; renderPanel(); renderEdges(); }); panel.append(back);
  renderEdges();
}

function spotifyMark() {
  const mark = document.createElement('img'); mark.src = '/assets/spotify-logo.svg'; mark.className = 'spotify-mark'; mark.alt = 'Spotify';
  return mark;
}

let startingRefreshTimer = null;
function renderStartingPoints(result) {
  if (startingRefreshTimer !== null) { clearTimeout(startingRefreshTimer); startingRefreshTimer = null; }
  const host = $('#seed-artists'); host.replaceChildren(); host.removeAttribute('aria-busy');
  const ranked = result.chartAvailable && result.source?.kind === 'daily_artist_chart_snapshot';
  for (const raw of result.artists.slice(0, 5)) {
    const artist = { ...raw, initials: raw.name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() };
    const button = document.createElement('button'); button.className = 'seed-button'; button.dataset.query = artist.name;
    const photo = portrait(artist, 'seed-photo');
    if (artist.image) { photo.width = 36; photo.height = 36; photo.loading = 'eager'; photo.fetchPriority = 'low'; }
    if (ranked) {
      button.dataset.rank = String(raw.rank);
      button.title = `#${raw.rank} · Imported Genius daily artist chart · ${result.source.capturedAt}`;
      button.setAttribute('aria-label', `${artist.name}, Genius daily artist chart position ${raw.rank}`);
    }
    button.append(photo, document.createTextNode(artist.name));
    button.addEventListener('click', () => { input.value = artist.name; input.dispatchEvent(new Event('input')); input.focus(); });
    host.append(button);
  }
  const chartDate = ranked ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(result.source.capturedAt)) : '';
  $('#starting-status').textContent = ranked ? `Genius daily chart · ${chartDate} UTC · snapshot` : 'Suggested artists · Genius chart unavailable';
  $('#starting-status').title = result.note;
  $('#starting-source').title = ranked ? `Open Genius charts. Checked snapshot, not a live feed.${result.source.scope === 'recording_artists' ? ' Translation/editorial accounts excluded; original chart positions retained.' : ''}`
    : 'Open Genius charts. Suggestions are not search rankings.';
  if (ranked) {
    startingRefreshTimer = setTimeout(() => { startingRefreshTimer = null; void loadStartingPoints(); },
      Math.max(1, Date.parse(result.source.capturedAt) + 86_400_000 - Date.now()));
    startingRefreshTimer?.unref?.();
  }
}

async function loadStartingPoints() {
  if (spotifyView) { $('.starting-points').hidden = true; return; }
  const host = $('#seed-artists'); host.replaceChildren(); host.setAttribute('aria-busy', 'true');
  for (let i = 0; i < 5; i++) {
    const skeleton = document.createElement('span'); skeleton.className = 'seed-skeleton'; skeleton.setAttribute('aria-hidden', 'true');
    host.append(skeleton);
  }
  try { renderStartingPoints(await fetchStartingPoints()); }
  catch {
    renderStartingPoints({ artists: suggestions.map(name => ({ name })), chartAvailable: false,
      note: 'Starting artist portraits are unavailable. Showing suggested searches, not ranked artists.' });
  }
}

function updateCamera() {
  world.style.transform = `translate(${pan.x}px,${pan.y}px) scale(${zoom})`;
  $('#zoom-value').textContent = `${Math.round(zoom*100)}%`;
  $('#zoom-in').disabled = zoom >= MAX_ZOOM;
  $('#zoom-out').disabled = zoom <= MIN_ZOOM;
  creditPreview?.reposition();
}
function stopCameraAnimation() {
  if (cameraFrame !== null) cancelAnimationFrame(cameraFrame);
  cameraFrame = null; cameraTarget = null;
  world.classList.remove('camera-moving');
}
function manualCameraIntent() {
  creditPreview?.dismiss(true);
  cameraRevision++;
  focusIntent = null;
  stopCameraAnimation();
}
function animateCamera(target) {
  stopCameraAnimation();
  if (!elasticEnabled() || typeof requestAnimationFrame !== 'function') {
    zoom = target.zoom; pan = { ...target.pan }; updateCamera(); return;
  }
  cameraTarget = target;
  const from = { zoom, pan: { ...pan } };
  let began;
  world.classList.add('camera-moving');
  const frame = time => {
    if (began === undefined) began = time;
    const progress = Math.min(1, (time - began) / 420);
    const ease = 1 - (1 - progress) ** 3;
    zoom = from.zoom + (target.zoom - from.zoom) * ease;
    pan = { x: from.pan.x + (target.pan.x - from.pan.x) * ease, y: from.pan.y + (target.pan.y - from.pan.y) * ease };
    updateCamera();
    if (progress < 1) cameraFrame = requestAnimationFrame(frame);
    else { cameraFrame = null; cameraTarget = null; world.classList.remove('camera-moving'); creditPreview?.refresh(); }
  };
  cameraFrame = requestAnimationFrame(frame);
}
function centerSelectedArtist() {
  if (!focusIntent || focusIntent.id !== explorer.selected || focusIntent.revision !== cameraRevision) return;
  if (nodeDrag || drag || document.hidden) return;
  const point = targetLayout.get(explorer.selected)?.footprint;
  if (!point) return;
  const node = [...$('#nodes').children].find(element => element.dataset.artist === explorer.selected);
  const photo = node?.querySelector('.node-photo');
  // Center the resting portrait, not the taller button including its caption.
  // Ignore the decorative few-pixel float rather than chasing it every frame.
  const photoOffset = photo?.offsetHeight && node.offsetHeight ? (photo.offsetHeight - node.offsetHeight) / 2 : 0;
  const camera = cameraTarget || { zoom, pan };
  const target = cameraToCenter(camera, { x: point.x, y: point.y + photoOffset }, graphViewport);
  if (target !== camera) animateCamera(target);
}
function resetCamera() {
  stopCameraAnimation();
  zoom = 1;
  pan = { x: 0, y: 0 };
  updateCamera();
}
function zoomTo(value, point, smooth = false) {
  manualCameraIntent();
  const origin = { x: world.offsetWidth / 2, y: world.offsetHeight / 2 };
  const target = zoomAroundPoint({ zoom, pan }, value, point || origin, origin);
  if (smooth) animateCamera(target);
  else { ({ zoom, pan } = target); updateCamera(); }
}
$('#zoom-in').addEventListener('click', () => zoomTo(zoom + .15, undefined, true));
$('#zoom-out').addEventListener('click', () => zoomTo(zoom - .15, undefined, true));
$('#fit-view').addEventListener('click', () => {
  manualCameraIntent();
  if (!layout.size) { resetCamera(); return; }
  const boxes = [...layout.values()].map(node => node.footprint);
  const left = Math.min(...boxes.map(box => box.x - box.w / 2)), right = Math.max(...boxes.map(box => box.x + box.w / 2));
  const top = Math.min(...boxes.map(box => box.y - box.h / 2)), bottom = Math.max(...boxes.map(box => box.y + box.h / 2));
  const width = world.clientWidth || 1000, height = world.clientHeight || 650;
  const fitZoom = Math.max(MIN_ZOOM, Math.min(1, (width - 48) / (right - left), (height - 48) / (bottom - top)));
  animateCamera({ zoom: fitZoom, pan: { x: (width / 2 - (left + right) / 2) * fitZoom, y: (height / 2 - (top + bottom) / 2) * fitZoom } });
});
$('#reset-top').addEventListener('click', () => { cancelLiveLookup(); profileLookup?.abort(); lookupVersion++; clearGraphInteraction(); previewPath(); selectedConnection = null; layoutPositions.clear(); explorer.reset(); resetCamera(); render(); });
$('#back-button').addEventListener('click', () => {
  finishNodeDrag(true);
  manualCameraIntent();
  if (!explorer.back()) return;
  previewPath();
  selectedConnection = null;
  cancelLiveLookup(); lookupVersion++;
  resetCamera();
  render();
  if (!explorer.canGoBack) $('#reset-top').focus({ preventScroll: true });
  $('#graph-announcement').textContent = explorer.selected ? `Back to ${artists[explorer.selected].name}.` : 'Search for an artist to begin.';
});
let wheelEnd;
$('#map').addEventListener('wheel', event => {
  if (event.target.closest('.map-controls') || drag || nodeDrag) return;
  event.preventDefault();
  const bounds = $('#map').getBoundingClientRect();
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
  if (!delta) return;
  world.classList.add('gesturing');
  zoomTo(zoom * Math.exp(-Math.max(-180, Math.min(180, delta)) * .0015), {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top
  });
  clearTimeout(wheelEnd);
  wheelEnd = setTimeout(() => world.classList.remove('gesturing'), 140);
}, { passive: false });
$('#map').addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.isPrimary === false || drag || nodeDrag) return;
  const button = event.target.closest('#nodes .node');
  if (button) {
    manualCameraIntent();
    const id = button.dataset.artist;
    const pointer = graphPointer(event), point = elastic.position(id);
    if (!point) return;
    nodeDrag = { id, pointerId: event.pointerId, button, startX: event.clientX, startY: event.clientY,
      offsetX: point.x - pointer.x, offsetY: point.y - pointer.y, moved: false };
    return;
  }
  if (event.target.closest('button,a,.map-controls')) return;
  manualCameraIntent();
  drag = { pointerId: event.pointerId, x:event.clientX,y:event.clientY,px:pan.x,py:pan.y };
  $('#map').setPointerCapture(event.pointerId); world.classList.add('dragging');
});
$('#map').addEventListener('pointermove', event => {
  if (nodeDrag && event.pointerId === nodeDrag.pointerId) {
    const pointer = graphPointer(event);
    if (!nodeDrag.moved && Math.hypot(event.clientX - nodeDrag.startX, event.clientY - nodeDrag.startY) < 6) return;
    if (!nodeDrag.moved) {
      nodeDrag.moved = true;
      elastic.beginDrag(nodeDrag.id);
      nodeDrag.button.classList.add('is-grabbed');
      world.classList.add('node-dragging');
      $('#map').setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    elastic.moveDrag({ x: pointer.x + nodeDrag.offsetX, y: pointer.y + nodeDrag.offsetY }, { elastic: elasticEnabled() });
    drawMotionFrame();
    startElasticMotion();
    return;
  }
  if (!drag || drag.pointerId !== event.pointerId) return;
  pan = { x: drag.px + event.clientX - drag.x, y: drag.py + event.clientY - drag.y }; updateCamera();
});
function graphPointer(event) {
  const bounds = $('#map').getBoundingClientRect();
  return pointerToGraph({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }, { zoom, pan }, graphViewport);
}
function finishNodeDrag(cancelled = false) {
  if (!nodeDrag) return;
  const current = nodeDrag;
  nodeDrag = null;
  current.button.classList.remove('is-grabbed');
  world.classList.remove('node-dragging');
  const point = elastic.endDrag();
  if (current.moved) {
    suppressedClick = { id: current.id, until: performance.now() + 400 };
    if (point && !cancelled) {
      layoutPositions.set(current.id, { x: point.x / graphViewport.width * 1000, y: point.y / graphViewport.height * 650 });
      $('#graph-announcement').textContent = `${artists[current.id]?.name || 'Artist'} repositioned. Dragging does not load or expand credits.`;
    }
    updateGraphLayout(current.id);
  }
  if ($('#map').hasPointerCapture?.(current.pointerId)) $('#map').releasePointerCapture(current.pointerId);
}
function endDrag(event) {
  if (nodeDrag && event.pointerId === nodeDrag.pointerId) finishNodeDrag(event.type !== 'pointerup');
  if (drag?.pointerId === event.pointerId) { drag = null; world.classList.remove('dragging'); }
}
$('#map').addEventListener('pointerup', endDrag); $('#map').addEventListener('pointercancel', endDrag); $('#map').addEventListener('lostpointercapture', endDrag);
document.addEventListener('pointerup', endDrag); document.addEventListener('pointercancel', endDrag);
$('#map').addEventListener('click', event => {
  if (!suppressedClick || event.detail === 0) return;
  const button = event.target.closest('#nodes .node');
  if (performance.now() < suppressedClick.until && (!button || button.dataset.artist === suppressedClick.id)) {
    event.preventDefault(); event.stopImmediatePropagation(); suppressedClick = null;
  }
}, true);
$('#map').addEventListener('dragstart', event => event.preventDefault());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && nodeDrag?.moved) { event.preventDefault(); finishNodeDrag(true); }
});
window.addEventListener('blur', () => { finishNodeDrag(true); drag = null; world.classList.remove('dragging'); });
document.addEventListener('visibilitychange', () => { if (document.hidden) finishNodeDrag(true); });

const input = $('#artist-search');
let searchTimer, searchController, searchVersion = 0;
function closeSearch(){ clearTimeout(searchTimer); searchController?.abort(); searchVersion++; $('#search-results').hidden=true; input.setAttribute('aria-expanded','false'); }
function renderSearchResults(query, remote = [], message = '', spotifyResults = []) {
  const host = $('#search-results'); host.replaceChildren();
  host.hidden = false; input.setAttribute('aria-expanded', 'true');
  const matches = Object.entries(artists).filter(([, artist]) => artist.name.toLowerCase().includes(query.toLowerCase()));
  const candidates = [...matches.map(([id, artist]) => ({ id, artist, local: true }))];
  for (const artist of remote) {
    const existing = candidates.find(candidate => candidate.id === artist.id || sameArtist(candidate.artist, artist));
    if (existing) { existing.artist = artist; existing.local = false; }
    else candidates.push({ id: artist.id, artist, local: false });
  }
  candidates.slice(0, spotifyView ? 20 : 24).forEach(candidate => {
    const button = document.createElement('button'); button.type = 'button';
    const copy = document.createElement('span');
    const name = document.createElement('strong'); name.textContent = candidate.artist.name;
    const source = document.createElement('small');
    const nativeSource = (candidate.artist.apiId || candidate.artist.id || candidate.id).split(':')[0];
    source.textContent = candidate.artist.origin === 'reference' ? 'Curated reference' : SOURCE_NAMES[nativeSource] || 'Verified source';
    if (spotifyView) { source.textContent = ''; source.append(spotifyMark()); }
    copy.append(name, source); button.append(portrait(candidate.artist, '', true), copy);
    button.addEventListener('click', () => {
      let id = candidate.id;
      if (spotifyView && (!candidate.local || !explorer.visibleIds.has(id))) {
        const url = new URL(window.location.href); url.search = new URLSearchParams({ source: 'spotify', id: candidate.artist.providerIds.spotify, name: candidate.artist.name }).toString();
        window.open(url.href, '_blank', 'noopener,noreferrer');
        return;
      }
      if (!candidate.local) {
        const merged = mergeLiveGraph(artists, edges, { artists: [candidate.artist], edges: [], artist: candidate.artist }, explorer.selected);
        explorer.remapAliases(merged.aliases);
        if (merged.aliases.size) { edgeElements.forEach(record => record.link.remove()); edgeElements.clear(); }
        id = merged.artistId;
      }
      input.value = ''; closeSearch(); startWithArtist(id);
    });
    host.append(button);
  });
  if (!spotifyView && spotifyResults.length) {
    const shelf = document.createElement('section'); shelf.className = 'spotify-search-shelf'; shelf.setAttribute('aria-label', 'Spotify results');
    const heading = document.createElement('p'); heading.append(spotifyMark(), document.createTextNode('Open a Spotify-only explorer ↗')); shelf.append(heading);
    spotifyResults.slice(0, 8).forEach(artist => {
      const button = document.createElement('button'); button.type = 'button';
      button.append(portrait(artist, '', true), document.createTextNode(artist.name));
      button.addEventListener('click', () => {
        const url = new URL(window.location.href); url.search = new URLSearchParams({ source: 'spotify', id: artist.providerIds.spotify, name: artist.name }).toString();
        window.open(url.href, '_blank', 'noopener,noreferrer');
      });
      shelf.append(button);
    });
    host.append(shelf);
  }
  if (message || !candidates.length) {
    const note = document.createElement('p'); note.textContent = message || 'No source-backed artist results. Try another spelling or check API status.'; host.append(note);
  }
}
input.addEventListener('input', () => {
  clearTimeout(searchTimer); searchController?.abort();
  const version = ++searchVersion;
  const query = input.value.trim();
  if (!query) { closeSearch(); return; }
  renderSearchResults(query, [], query.length < 2 ? 'Type at least two characters for live search.' : 'Searching configured music sources…');
  if (query.length < 2) return;
  searchTimer = setTimeout(async () => {
    searchController = new AbortController();
    try {
      const result = await searchLiveArtists(query, searchController.signal, spotifyView ? 'spotify' : 'all');
      if (version !== searchVersion || input.value.trim() !== query) return;
      const failures = result.sources.filter(source => source.status === 'error');
      renderSearchResults(query, spotifyView ? result.spotifyArtists : result.artists, failures.length ? `${failures.map(source => SOURCE_NAMES[source.provider]).join(', ')} unavailable. Other results are still shown.` : 'Choose a source-backed result. Cross-source identities are verified before merging.', result.spotifyArtists);
      void refreshApiStatus();
    } catch (error) {
      if (version === searchVersion) renderSearchResults(query, [], error.message);
    }
  }, 320);
});
$('.search').addEventListener('submit',event=>{event.preventDefault();$('#search-results button')?.click();});
input.addEventListener('keydown',event=>{if(event.key==='Escape')closeSearch();if(event.key==='ArrowDown'){$('#search-results button')?.focus();event.preventDefault();}});
document.addEventListener('click', event=>{if(!event.target.closest('.search,.seed-button'))closeSearch();});
document.addEventListener('keydown',event=>{if(event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)&&!$('#info-dialog').open){event.preventDefault();input.focus();}});

const dialog=$('#info-dialog');
$('#about-button').addEventListener('click',()=>{
  $('#dialog-content').innerHTML='<p class="eyebrow">A DIFFERENT WAY TO DISCOVER</p><h2>Music is made<br>of connections.</h2><p>Search for one artist. Select a result to start a new map with just that person. Click the portrait to reveal up to four collaborators, then keep exploring at your own pace.</p><p>Live search and credit lookups use configured Apple Music, Spotify, Genius, and MusicBrainz sources. Profiles merge only through explicit service IDs or artist-page links, not display names. Similar sound is not evidence of a collaboration. Credits are a bounded sample, never a complete discography.</p>'; dialog.showModal();
});
$('#sources-button').addEventListener('click',event=>{
  event.preventDefault();
  $('#dialog-content').innerHTML='<p class="eyebrow">TRANSPARENCY, BY DESIGN</p><h2>Sources & API setup.</h2><p>Configured means a server credential is present, not that authentication has succeeded. Responding means this source has successfully returned data since this server started.</p><div id="provider-status-list"></div><p>Set credentials in the local .env file, following API_SETUP.md, then restart the server. Never paste private keys into chat. MusicBrainz public reads need no key.</p><p>Every API credit retains its source. Suggested searches do not preload artists or credits. Images belong to their respective rights holders; API access is not a blanket image licence. Verify display, cropping, attribution, and combination terms before sharing. Spotify images are shown uncropped with source links; lyrics are never scraped or displayed.</p>';
  const list = $('#provider-status-list');
  for (const source of apiStatus) {
    const card = document.createElement('div'); card.className = 'provider-status-card';
    const name = document.createElement('strong'); name.textContent = source.name;
    const state = document.createElement('p'); state.textContent = !source.configured ? 'Needs server credentials' : source.lastSuccess ? `Responded: ${new Date(source.lastSuccess).toLocaleTimeString()}` : 'Available to try · not verified yet';
    card.append(name, state);
    if (source.lastError) { const error = document.createElement('p'); error.textContent = source.lastError.message; card.append(error); }
    const lookup = liveStates.get(explorer.selected)?.sources?.find(item => item.provider === source.id);
    if (lookup) {
      const detail = document.createElement('p'); detail.textContent = `Last lookup: ${lookup.status.replaceAll('_', ' ')}. ${lookup.coverage || lookup.message || ''}`; card.append(detail);
      for (const warning of lookup.warnings || []) { const note = document.createElement('p'); note.textContent = warning.message; card.append(note); }
    }
    list.append(card);
  }
  if (!apiStatus.length) { const note = document.createElement('p'); note.textContent = 'API status is not available. Restart the local server.'; list.append(note); }
  dialog.showModal();
});
$('.dialog-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
creditPreview = createCreditPreview({
  host: $('#map'),
  getCredit: id => sharedTrackPreview({ id, route: explorer.routeTo(id), artists, edges, visibleIds: explorer.visibleIds, scope: spotifyView ? 'spotify' : 'main' }),
  blocked: () => Boolean(nodeDrag || drag || cameraFrame !== null || document.hidden || pathPreview
    || !$('#search-results').hidden || !$('#map-save-popover').hidden || $('#info-dialog').open),
  motionAllowed: () => !motionPaused && !motionQuery.matches
});
window.addEventListener('scroll', () => creditPreview.dismiss(true), { passive: true });
window.addEventListener('resize', () => creditPreview.refresh());
window.addEventListener('blur', () => creditPreview.dismiss(true));
document.addEventListener('keydown', event => { if (event.key === 'Escape') creditPreview.dismiss(); });
savedMapsUI = createSavedMapsUI({
  button: $('#save-map-button'), popover: $('#map-save-popover'),
  store: createMapStore({ getStorage: () => window.localStorage, scope: spotifyView ? 'spotify' : 'main' }),
  canSave: () => explorer.visibleIds.size > 0,
  defaultName: () => `${artists[explorer.trail[0]]?.name || 'My music'}’s connections`,
  snapshot: snapshotMap, openMap: openSavedMap,
  announce: message => { $('#graph-announcement').textContent = message; }
});
render();
let resizeFrame;
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(updateGraphLayout);
  }).observe(world);
}
input.setAttribute('aria-label', spotifyView ? 'Search Spotify artists' : 'Search live music sources');
if (spotifyView) {
  document.body.classList.add('spotify-view');
  $('#page-title').textContent = 'Follow the sound. On Spotify.';
  $('#map-context').textContent = 'SPOTIFY-ONLY EXPLORER';
  $('#map-description').textContent = 'Credited track artists from Spotify. Other sources stay in the main explorer.';
  const brand = document.createElement('a'); brand.href = artists[seeds[0]].url; brand.target = '_blank'; brand.rel = 'noopener noreferrer'; brand.className = 'spotify-view-brand'; brand.append(spotifyMark());
  document.querySelector('.intro-right').prepend(brand);
  void loadStartingProfile(seeds[0]);
}
void refreshApiStatus();
void loadStartingPoints();
