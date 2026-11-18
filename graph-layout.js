// Layout is solved in unscaled CSS pixels, not catalogue coordinates. This
// reserves room for names, floating motion, and hover growth at every zoom.
export function separateArtists(artists, { width = 1000, height = 650, previous = new Map(), compact = false, photoSizes = new Map(), captionWidths = new Map() } = {}) {
  const result = new Map(), placed = [];
  const overlaps = box => placed.some(other => Math.abs(box.x - other.x) < (box.w + other.w) / 2
    && Math.abs(box.y - other.y) < (box.h + other.h) / 2);
  for (const [id, artist] of artists) {
    const preferred = previous.get(id) || artist;
    const size = photoSizes.get(id) || (compact ? Math.max(95, Math.min(135, artist.size || 96)) : artist.size || 96);
    const w = Math.max(size * 1.16 + 24, captionWidths.get(id) || Math.min(180, [...artist.name].length * 7 + 32));
    const h = size * 1.16 + 76;
    const cx = preferred.x / 1000 * width, cy = preferred.y / 650 * height;
    let box = { x: cx, y: cy, w, h };
    if (overlaps(box)) {
      // Prefer the smallest nudge that clears existing portraits AND captions.
      // Guaranteed outer candidates avoid a shared fallback/stacking point.
      const candidates = [];
      for (const other of placed) {
        const left = other.x - (other.w + w) / 2 - 8, right = other.x + (other.w + w) / 2 + 8;
        const top = other.y - (other.h + h) / 2 - 8, bottom = other.y + (other.h + h) / 2 + 8;
        for (const x of [left, right]) for (const y of [cy, top, bottom]) candidates.push({ x, y, w, h });
        for (const y of [top, bottom]) candidates.push({ x: cx, y, w, h });
      }
      candidates.push(
        { x: Math.min(...placed.map(other => other.x - other.w / 2)) - w / 2 - 8, y: cy, w, h },
        { x: Math.max(...placed.map(other => other.x + other.w / 2)) + w / 2 + 8, y: cy, w, h },
        { x: cx, y: Math.min(...placed.map(other => other.y - other.h / 2)) - h / 2 - 8, w, h },
        { x: cx, y: Math.max(...placed.map(other => other.y + other.h / 2)) + h / 2 + 8, w, h }
      );
      candidates.sort((a, b) => (a.x - cx) ** 2 + (a.y - cy) ** 2 - (b.x - cx) ** 2 - (b.y - cy) ** 2);
      box = candidates.find(candidate => !overlaps(candidate));
    }
    placed.push(box);
    result.set(id, { ...artist, x: box.x / width * 1000, y: box.y / height * 650, footprint: box });
  }
  return result;
}

// New branches are placed in real CSS pixels around a visible endpoint, never
// around cached catalogue positions. Only actual contact displaces old nodes;
// no global force layout or speculative room for hidden/future artists.
export function layoutNearbyArtists(artists, { width = 1000, height = 650, previous = new Map(),
  compact = false, photoSizes = new Map(), captionWidths = new Map(), edges = [], anchorId = null, pinnedId = anchorId } = {}) {
  const boxes = new Map(), fresh = new Set([...artists.keys()].filter(id => !previous.has(id)));
  for (const [id, artist] of artists) {
    const point = previous.get(id) || artist;
    const size = photoSizes.get(id) || (compact ? Math.max(95, Math.min(135, artist.size || 96)) : artist.size || 96);
    boxes.set(id, { x: point.x / 1000 * width, y: point.y / 650 * height,
      w: Math.max(size * 1.16 + 24, captionWidths.get(id) || Math.min(180, [...artist.name].length * 7 + 32)),
      h: size * 1.16 + 76 });
  }
  const placed = new Set([...boxes.keys()].filter(id => previous.has(id)));
  // Keep the selected root fixed even on first paint.
  if (boxes.has(anchorId)) { placed.add(anchorId); fresh.delete(anchorId); }
  let ordinal = 0;
  for (const id of fresh) {
    const box = boxes.get(id);
    const neighbors = edges.filter(edge => edge.a === id || edge.b === id).map(edge => edge.a === id ? edge.b : edge.a);
    const parentId = neighbors.includes(anchorId) && placed.has(anchorId) ? anchorId
      : neighbors.find(key => placed.has(key)) || (placed.has(anchorId) ? anchorId : null);
    const parent = boxes.get(parentId);
    if (parent) {
      const candidates = [];
      for (const ring of [1, 1.18]) for (let i = 0; i < 32; i++) {
        const angle = ordinal * 2.399963 + i * Math.PI / 16;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const radius = Math.min(((parent.w + box.w) / 2 + 10) / Math.max(.001, Math.abs(cos)),
          ((parent.h + box.h) / 2 + 10) / Math.max(.001, Math.abs(sin))) * ring;
        const candidate = { ...box, x: parent.x + cos * radius, y: parent.y + sin * radius };
        let pressure = 0;
        for (const key of placed) {
          const other = boxes.get(key);
          const ox = (other.w + box.w) / 2 + 6 - Math.abs(candidate.x - other.x);
          const oy = (other.h + box.h) / 2 + 6 - Math.abs(candidate.y - other.y);
          if (ox > 0 && oy > 0) pressure += Math.min(ox, oy);
        }
        candidates.push({ ...candidate, score: radius + pressure * 3 + i * .015 });
      }
      candidates.sort((a, b) => a.score - b.score);
      box.x = candidates[0].x; box.y = candidates[0].y;
    }
    placed.add(id); ordinal++;
  }
  const entries = [...boxes];
  // Resolve nearby contact symmetrically, allowing a short chain of pushes in
  // dense clusters. Stable distant nodes are never pulled into a global reflow.
  for (let pass = 0; pass < 48; pass++) {
    let touching = false;
    for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
      const [aId, a] = entries[i], [bId, b] = entries[j];
      if (Math.abs(a.x - b.x) >= (a.w + b.w) / 2 - .000001
        || Math.abs(a.y - b.y) >= (a.h + b.h) / 2 - .000001) continue;
      const ox = (a.w + b.w) / 2 + 6 - Math.abs(a.x - b.x);
      const oy = (a.h + b.h) / 2 + 6 - Math.abs(a.y - b.y);
      if (ox <= 0 || oy <= 0) continue;
      touching = true;
      const wa = aId === pinnedId ? 0 : fresh.has(aId) ? 1 : .45;
      const wb = bId === pinnedId ? 0 : fresh.has(bId) ? 1 : .45;
      const axis = ox < oy ? 'x' : 'y', delta = ((axis === 'x' ? ox : oy) + .1) * (a[axis] > b[axis] ? 1 : -1);
      a[axis] += delta * wa / (wa + wb);
      b[axis] -= delta * wb / (wa + wb);
    }
    if (!touching) break;
  }
  // A bounded deterministic safety pass handles exceptionally dense clusters.
  // Usually it changes nothing; it never lets portraits/labels stack forever.
  const normalized = new Map(entries.map(([id, box]) => [id, { ...artists.get(id), x: box.x / width * 1000, y: box.y / height * 650 }]));
  const ordered = normalized.has(pinnedId)
    ? new Map([[pinnedId, normalized.get(pinnedId)], ...[...normalized].filter(([id]) => id !== pinnedId)]) : normalized;
  return separateArtists(ordered, { width, height, compact, photoSizes, captionWidths });
}

export function bundleConnections(edges) {
  const bundles = new Map();
  for (const edge of edges) {
    if (edge.a === edge.b) continue;
    const key = [edge.a, edge.b].sort().join('|');
    if (!bundles.has(key)) bundles.set(key, { key, a: edge.a, b: edge.b, relationships: [], evidence: [], types: [] });
    const bundle = bundles.get(key);
    bundle.relationships.push(edge);
    if (!bundle.types.includes(edge.type)) bundle.types.push(edge.type);
    const evidence = edge.evidence?.length ? edge.evidence : [{ provider: edge.provider, source: edge.source, work: edge.work, url: edge.url, detail: edge.detail, origin: edge.origin }];
    for (const credit of evidence) {
      if (!bundle.evidence.some(other => other.url === credit.url && other.work === credit.work && other.type === edge.type)) {
        bundle.evidence.push({ ...credit, type: edge.type, origin: credit.origin || edge.origin });
      }
    }
    bundle.type = bundle.types.length === 1 ? bundle.types[0] : 'mixed';
  }
  return [...bundles.values()];
}
