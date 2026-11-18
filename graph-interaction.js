export function graphDistances(ids, edges, root) {
  const distances = new Map([...ids].map(id => [id, Infinity]));
  if (!distances.has(root)) return distances;
  const neighbors = new Map([...ids].map(id => [id, new Set()]));
  for (const { a, b } of edges) {
    if (a === b || !neighbors.has(a) || !neighbors.has(b)) continue;
    neighbors.get(a).add(b); neighbors.get(b).add(a);
  }
  const queue = [root];
  distances.set(root, 0);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const other of neighbors.get(id)) {
      if (distances.get(other) !== Infinity) continue;
      distances.set(other, distances.get(id) + 1);
      queue.push(other);
    }
  }
  return distances;
}

// All interaction physics uses unscaled screen pixels; artist catalogue
// coordinates stay unchanged. Only a local neighborhood is activated.
export function createElasticGraph() {
  const nodes = new Map();
  let links = [], pinned = null, elapsed = 0;
  // Broad-phase grid: only nearby portraits can collide, not every graph pair.
  const collide = () => {
    const bodies = [...nodes.entries()].filter(([, node]) => node.radius > 0);
    const cellSize = Math.max(32, ...bodies.map(([, node]) => node.radius * 2));
    const cells = new Map();
    for (const [id, node] of bodies) {
      const col = Math.floor(node.x / cellSize), row = Math.floor(node.y / cellSize);
      for (let x = col - 1; x <= col + 1; x++) for (let y = row - 1; y <= row + 1; y++) {
        for (const [otherId, other] of cells.get(`${x},${y}`) || []) {
          if (!node.active && !other.active && id !== pinned && otherId !== pinned) continue;
          const dx = other.x - node.x, dy = other.y - node.y;
          const distance = Math.hypot(dx, dy), reach = node.radius + other.radius;
          if (distance >= reach) continue;
          const nx = distance > .001 ? dx / distance : 1, ny = distance > .001 ? dy / distance : 0;
          const wa = id === pinned ? 0 : 1, wb = otherId === pinned ? 0 : 1;
          const correction = (reach - distance) * .65 / (wa + wb);
          node.x -= nx * correction * wa; node.y -= ny * correction * wa;
          other.x += nx * correction * wb; other.y += ny * correction * wb;
          const approaching = (other.vx - node.vx) * nx + (other.vy - node.vy) * ny;
          if (approaching < 0) {
            const impulse = Math.min(300, -approaching * 1.32 / (wa + wb));
            node.vx -= nx * impulse * wa; node.vy -= ny * impulse * wa;
            other.vx += nx * impulse * wb; other.vy += ny * impulse * wb;
          }
          node.active = true; other.active = true;
        }
      }
      const key = `${col},${row}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push([id, node]);
    }
  };
  const activate = (seeds, depth = 2) => {
    let frontier = new Set(seeds);
    const visited = new Set(frontier);
    for (let hop = 0; hop <= depth; hop++) {
      for (const id of frontier) if (nodes.has(id)) nodes.get(id).active = true;
      const next = new Set();
      for (const { a, b } of links) {
        if (frontier.has(a) && !visited.has(b)) next.add(b);
        if (frontier.has(b) && !visited.has(a)) next.add(a);
      }
      next.forEach(id => visited.add(id));
      frontier = next;
    }
  };
  return {
    setLayout(positions, edges, { animate = true, entering = [], origins = new Map(), colliders = new Map() } = {}) {
      links = [...new Map(edges.filter(edge => edge.a !== edge.b && positions.has(edge.a) && positions.has(edge.b))
        .map(edge => [[edge.a, edge.b].sort().join('|'), edge])).values()];
      for (const id of nodes.keys()) if (!positions.has(id)) nodes.delete(id);
      if (pinned && !nodes.has(pinned)) pinned = null;
      for (const [id, point] of positions) {
        const previous = nodes.get(id);
        if (!previous) {
          const origin = animate && origins.get(id) || point;
          nodes.set(id, { x: origin.x, y: origin.y, tx: point.x, ty: point.y, vx: 0, vy: 0, active: false, radius: colliders.get(id) || 0 });
        }
        else {
          if (Math.hypot(previous.tx - point.x, previous.ty - point.y) > .1) { previous.active = true; elapsed = 0; }
          previous.tx = point.x; previous.ty = point.y;
          previous.radius = colliders.get(id) || 0;
        }
      }
      if (!animate) { this.settle(); return; }
      if (entering.length) {
        elapsed = 0;
        activate(entering, 1);
        for (const [id, node] of nodes) {
          if (entering.includes(id)) continue;
          for (const newId of entering) {
            const other = nodes.get(newId);
            if (!other) continue;
            const dx = node.tx - other.tx, dy = node.ty - other.ty;
            const distance = Math.hypot(dx, dy);
            if (distance >= 230) continue;
            node.active = true;
            const force = (1 - distance / 230) * 110;
            node.vx += (distance ? dx / distance : 1) * force;
            node.vy += (distance ? dy / distance : 0) * force;
          }
        }
      }
    },
    beginDrag(id) {
      if (!nodes.has(id)) return false;
      pinned = id;
      elapsed = 0;
      activate([id]);
      return true;
    },
    moveDrag(point, { elastic = true } = {}) {
      const node = nodes.get(pinned);
      if (!node) return;
      node.x = point.x; node.y = point.y; node.vx = 0; node.vy = 0;
      elapsed = 0;
      if (elastic) activate([pinned]);
    },
    endDrag() { const point = this.position(pinned); pinned = null; return point; },
    position(id) { const node = nodes.get(id); return node ? { x: node.x, y: node.y } : null; },
    get positions() { return new Map([...nodes].map(([id, node]) => [id, { x: node.x, y: node.y }])); },
    settle() {
      for (const [id, node] of nodes) {
        if (id === pinned) continue;
        node.x = node.tx; node.y = node.ty; node.vx = 0; node.vy = 0; node.active = false;
      }
    },
    step(milliseconds) {
      const seconds = Math.max(0, Math.min(64, milliseconds)) / 1000;
      elapsed += seconds;
      const count = Math.max(1, Math.ceil(seconds / (1 / 120)));
      const dt = seconds / count;
      for (let i = 0; i < count; i++) {
        const forces = new Map();
        for (const [id, node] of nodes) if (node.active && id !== pinned) {
          forces.set(id, { x: (node.tx - node.x) * 38 - node.vx * 9.5, y: (node.ty - node.y) * 38 - node.vy * 9.5 });
        }
        for (const { a, b } of links) {
          const left = nodes.get(a), right = nodes.get(b);
          const dx = ((right.x - right.tx) - (left.x - left.tx)) * 15;
          const dy = ((right.y - right.ty) - (left.y - left.ty)) * 15;
          if (forces.has(a)) { forces.get(a).x += dx; forces.get(a).y += dy; }
          if (forces.has(b)) { forces.get(b).x -= dx; forces.get(b).y -= dy; }
        }
        for (const [id, force] of forces) {
          const node = nodes.get(id);
          node.vx += force.x * dt; node.vy += force.y * dt;
          const speed = Math.hypot(node.vx, node.vy);
          if (speed > 650) { node.vx *= 650 / speed; node.vy *= 650 / speed; }
          node.x += node.vx * dt; node.y += node.vy * dt;
        }
        collide();
      }
      let moving = Boolean(pinned);
      for (const [id, node] of nodes) {
        if (!node.active || id === pinned) continue;
        if (Math.hypot(node.x - node.tx, node.y - node.ty) >= .15 || Math.hypot(node.vx, node.vy) >= .8) moving = true;
      }
      // A dense interaction must not turn into a permanent animation loop.
      if (!pinned && elapsed > 4) moving = false;
      if (!moving) this.settle();
      return moving;
    },
    clear() { nodes.clear(); links = []; pinned = null; elapsed = 0; }
  };
}

export function pointerToGraph(point, camera, viewport) {
  return {
    x: (point.x - viewport.width / 2 - camera.pan.x) / camera.zoom + viewport.width / 2,
    y: (point.y - viewport.height / 2 - camera.pan.y) / camera.zoom + viewport.height / 2
  };
}

// Move the camera, never the graph or its zoom, to focus a clicked portrait.
export function cameraToCenter(camera, point, viewport) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || viewport.width <= 0 || viewport.height <= 0) return camera;
  const pan = { x: (viewport.width / 2 - point.x) * camera.zoom, y: (viewport.height / 2 - point.y) * camera.zoom };
  if (Math.hypot(pan.x - camera.pan.x, pan.y - camera.pan.y) < .5) return camera;
  return { zoom: camera.zoom, pan };
}
