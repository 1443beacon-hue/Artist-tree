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
  const history = [];
  const connections = id => edges.filter(edge => edge.a === id || edge.b === id);

  return {
    get selected() { return selected; },
    get canGoBack() { return history.length > 0; },
    isExpanded: id => expanded.has(id),
    connections,
    start(id) {
      if (!Object.hasOwn(artists, id)) return false;
      selected = id;
      visible = new Set([id]);
      expanded = new Set();
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
      history.push({ selected, visible: new Set(visible), expanded: new Set(expanded) });
      selected = id;
      visible = next;
      expanded.add(id);
      return true;
    },
    reveal(ids, { remember = false } = {}) {
      const next = new Set(visible);
      ids.filter(id => Object.hasOwn(artists, id)).forEach(id => next.add(id));
      if (next.size === visible.size) return;
      if (remember) history.push({ selected, visible: new Set(visible), expanded: new Set(expanded) });
      visible = next;
    },
    remapAliases(aliases) {
      const resolve = id => { while (aliases.has(id)) id = aliases.get(id); return id; };
      selected = resolve(selected);
      visible = new Set([...visible].map(resolve));
      expanded = new Set([...expanded].map(resolve));
      history.forEach(entry => { entry.selected = resolve(entry.selected); entry.visible = new Set([...entry.visible].map(resolve)); entry.expanded = new Set([...entry.expanded].map(resolve)); });
    },
    back() {
      const previous = history.pop();
      if (!previous) return false;
      ({ selected, visible, expanded } = previous);
      return true;
    },
    reset() {
      selected = initialArtist;
      visible = new Set(seeds);
      expanded = new Set();
      history.length = 0;
    }
  };
}

export function layoutArtists(artists, visibleIds) {
  return new Map([...visibleIds].map(id => [id, artists[id]]));
}
