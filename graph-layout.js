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
