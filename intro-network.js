export function createGrowingNetwork({ random = Math.random, width = 360, height = 112, limit = 16 } = {}) {
  const nodes = new Map([[0, { id: 0, x: width / 2, y: height / 2, parent: null }]]);
  let sequence = 0;
  const degree = id => [...nodes.values()].filter(node => node.parent === id).length + (id === 0 ? 0 : 1);
  return {
    get nodes() { return [...nodes.values()].map(node => ({ ...node })); },
    get edges() { return [...nodes.values()].filter(node => node.parent !== null).map(node => ({ a: node.parent, b: node.id })); },
    advance() {
      if (nodes.size >= limit) {
        const leaf = [...nodes.values()].find(node => node.id !== 0 && ![...nodes.values()].some(other => other.parent === node.id));
        if (leaf) nodes.delete(leaf.id);
      }
      const parents = [...nodes.values()].filter(node => degree(node.id) < 4);
      for (let attempt = 0; attempt < 80; attempt++) {
        const parent = parents[Math.floor(random() * parents.length)];
        const angle = random() * Math.PI * 2, radius = 32 + random() * 43;
        const x = parent.x + Math.cos(angle) * radius, y = parent.y + Math.sin(angle) * radius;
        if (x < 15 || x > width - 15 || y < 15 || y > height - 15) continue;
        if ([...nodes.values()].some(node => Math.hypot(node.x - x, node.y - y) < 22)) continue;
        const node = { id: ++sequence, x, y, parent: parent.id };
        nodes.set(node.id, node);
        return node;
      }
      return null;
    }
  };
}

// Decorative only: these dots have no artist identities or inferred credits.
// Keep the tree small and recycle old leaves rather than growing an unbounded
// DOM. Growth, floating and paths all respect the shared motion controls.
export function createIntroNetwork(svg, { random = Math.random, schedule = setTimeout, cancel = clearTimeout } = {}) {
  const model = createGrowingNetwork({ random });
  const ns = 'http://www.w3.org/2000/svg', doc = svg.ownerDocument;
  let timer = null, paused = true, destroyed = false;
  const make = (tag, attributes) => {
    const element = doc.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  };
  const render = () => {
    svg.querySelectorAll('.intro-retiring').forEach(element => element.remove());
    const nodes = new Map(model.nodes.map(node => [node.id, node]));
    const edges = model.edges;
    svg.querySelectorAll('[data-intro-node]').forEach(element => {
      if (!nodes.has(Number(element.dataset.introNode))) element.classList.add('intro-retiring');
    });
    svg.querySelectorAll('[data-intro-edge]').forEach(element => {
      if (!edges.some(edge => edge.b === Number(element.dataset.introEdge))) element.classList.add('intro-retiring');
    });
    for (const edge of edges) {
      if (svg.querySelector(`[data-intro-edge="${edge.b}"]`)) continue;
      const a = nodes.get(edge.a), b = nodes.get(edge.b);
      const path = make('path', { d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, class: 'intro-edge', 'data-intro-edge': edge.b, pathLength: 1 });
      svg.prepend(path);
    }
    for (const node of nodes.values()) {
      if (svg.querySelector(`[data-intro-node="${node.id}"]`)) continue;
      const group = make('g', { transform: `translate(${node.x} ${node.y})`, class: 'intro-dot', 'data-intro-node': node.id });
      if (node.id === 0) group.append(make('circle', { r: 10, class: 'intro-halo' }));
      group.append(make('circle', { r: node.id === 0 ? 4.5 : 2.4 + random() * 1.8, class: node.id % 3 === 0 ? 'intro-point accent' : 'intro-point' }));
      svg.append(group);
    }
  };
  const queue = () => {
    if (paused || destroyed || timer !== null) return;
    timer = schedule(() => {
      timer = null;
      if (paused || destroyed) return;
      model.advance(); render(); queue();
    }, 850 + random() * 400);
    timer?.unref?.();
  };
  for (let i = 0; i < 6; i++) model.advance();
  render();
  svg.classList.add('is-paused');
  return {
    setPaused(value) {
      paused = Boolean(value);
      svg.classList.toggle('is-paused', paused);
      if (paused && timer !== null) { cancel(timer); timer = null; }
      if (!paused) queue();
    },
    destroy() {
      destroyed = true;
      if (timer !== null) cancel(timer);
      timer = null; svg.replaceChildren();
    }
  };
}
