export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2.5;

export function clampZoom(value) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

// Keep the world coordinate under the pointer stationary as the camera zooms.
export function zoomAroundPoint(camera, targetZoom, point, origin) {
  const zoom = clampZoom(targetZoom);
  const ratio = zoom / camera.zoom;
  return {
    zoom,
    pan: {
      x: point.x - origin.x - (point.x - origin.x - camera.pan.x) * ratio,
      y: point.y - origin.y - (point.y - origin.y - camera.pan.y) * ratio
    }
  };
}

export function createExplorer({ artists, edges, seeds, initialArtist }) {
  let selected = initialArtist;
  let visible = new Set(seeds);
  let expanded = new Set();
  let trail = initialArtist ? [initialArtist] : [];
  let routes = new Map(seeds.map(id => [id, [id]]));
  const history = [];
  const connections = id => edges.filter(edge => edge.a === id || edge.b === id);
  const remember = () => history.push({ selected, visible: new Set(visible), expanded: new Set(expanded), trail: [...trail] });
  const connected = (a, b) => edges.some(edge => edge.a === a && edge.b === b || edge.b === a && edge.a === b);
  const visit = id => {
    const index = trail.indexOf(id);
    if (index >= 0) trail = trail.slice(0, index + 1);
    else if (selected && visible.has(selected) && connected(selected, id)) trail = [...trail, id];
    else {
      const saved = routes.get(id);
      trail = saved?.every((key, index) => visible.has(key) && (index === 0 || connected(saved[index - 1], key))) ? [...saved] : [id];
    }
    routes.set(id, [...trail]);
  };
  const recordRoute = id => routes.set(id, selected && connected(selected, id) ? [...trail, id] : [id]);

  return {
    get selected() { return selected; },
    get canGoBack() { return history.length > 0; },
    get trail() { return [...trail]; },
    routeTo(id) {
      const route = routes.get(id);
      return route?.every((key, index) => visible.has(key) && (index === 0 || connected(route[index - 1], key))) ? [...route] : [];
    },
    isExpanded: id => expanded.has(id),
    connections,
    start(id) {
      if (!Object.hasOwn(artists, id)) return false;
      selected = id;
      visible = new Set([id]);
      expanded = new Set();
      trail = [id]; routes = new Map([[id, [id]]]);
      history.length = 0;
      return true;
    },
    get visibleIds() {
      return new Set(visible);
    },
    get visibleEdges() {
      const ids = this.visibleIds;
      return edges.filter(edge => ids.has(edge.a) && ids.has(edge.b));
    },
    select(id, { maxNew = Infinity } = {}) {
      if (!Object.hasOwn(artists, id)) return false;
      const next = new Set(visible);
      next.add(id);
      let added = 0;
      connections(id).forEach(edge => {
        const neighbor = edge.a === id ? edge.b : edge.a;
        if (next.has(neighbor) || added >= maxNew) return;
        next.add(neighbor);
        added++;
      });
      if (selected === id && next.size === visible.size && expanded.has(id)) return false;
      remember();
      visit(id);
      selected = id;
      for (const other of next) if (!visible.has(other) && other !== id) recordRoute(other);
      visible = next;
      expanded.add(id);
      return true;
    },
    reveal(ids, { remember = false } = {}) {
      const next = new Set(visible);
      ids.filter(id => Object.hasOwn(artists, id)).forEach(id => next.add(id));
      if (next.size === visible.size) return;
      if (remember) history.push({ selected, visible: new Set(visible), expanded: new Set(expanded), trail: [...trail] });
      for (const id of next) if (!visible.has(id)) recordRoute(id);
      visible = next;
    },
    focus(id) {
      if (!visible.has(id) || !Object.hasOwn(artists, id)) return false;
      if (selected !== id) { remember(); visit(id); selected = id; }
      return true;
    },
    snapshot() {
      return { selected, visible: [...visible], expanded: [...expanded], trail: [...trail],
        routes: [...routes].filter(([id]) => visible.has(id)).map(([id, path]) => [id,
          path.every((key, index) => visible.has(key) && (index === 0 || connected(path[index - 1], key))) ? [...path] : [id]]) };
    },
    restore(state) {
      // File/storage validation is handled by the caller; never reveal an ID
      // absent from the loaded profiles, even with a malformed internal caller.
      const ids = state.visible.filter(id => Object.hasOwn(artists, id));
      if (!ids.length || !ids.includes(state.selected)) return false;
      visible = new Set(ids); selected = state.selected;
      expanded = new Set(state.expanded.filter(id => visible.has(id)));
      trail = state.trail.filter(id => visible.has(id));
      if (trail.at(-1) !== selected) trail = [selected];
      routes = new Map(state.routes.filter(([id, path]) => visible.has(id) && path.every(key => visible.has(key))));
      routes.set(selected, [...trail]); history.length = 0;
      return true;
    },
    remapAliases(aliases) {
      const resolve = id => { while (aliases.has(id)) id = aliases.get(id); return id; };
      selected = resolve(selected);
      visible = new Set([...visible].map(resolve));
      expanded = new Set([...expanded].map(resolve));
      const remapPath = path => {
        let next = [];
        for (const key of path) { const id = resolve(key), index = next.indexOf(id); next = index >= 0 ? next.slice(0, index + 1) : [...next, id]; }
        return next;
      };
      trail = remapPath(trail);
      routes = new Map([...routes].map(([id, path]) => [resolve(id), remapPath(path)]));
      history.forEach(entry => { entry.selected = resolve(entry.selected); entry.visible = new Set([...entry.visible].map(resolve)); entry.expanded = new Set([...entry.expanded].map(resolve)); entry.trail = remapPath(entry.trail); });
    },
    back() {
      const previous = history.pop();
      if (!previous) return false;
      ({ selected, visible, expanded, trail } = previous);
      return true;
    },
    reset() {
      selected = initialArtist;
      visible = new Set(seeds);
      expanded = new Set();
      trail = initialArtist ? [initialArtist] : [];
      routes = new Map(seeds.map(id => [id, [id]]));
      history.length = 0;
    }
  };
}

export function layoutArtists(artists, visibleIds) {
  return new Map([...visibleIds].map(id => [id, artists[id]]));
}
