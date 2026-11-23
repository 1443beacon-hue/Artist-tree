// Gesture recognition is independent of DOM, graph state and network access.
export function createCreditHold({ onHold, delay = 400, distance = 6, now = () => performance.now(),
  schedule = setTimeout, cancel = clearTimeout }) {
  const pointers = new Set();
  let pending = null, timer = null, guard = null;
  const stop = () => { if (timer !== null) cancel(timer); timer = null; pending = null; };
  return {
    down(event, node = null) {
      if (event.pointerType !== 'touch') return;
      if (!pointers.size) guard = null; // A new deliberate tap is not a ghost click.
      pointers.add(event.pointerId); stop();
      if (pointers.size !== 1 || event.isPrimary === false || !node) return;
      pending = { node, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      const current = pending;
      timer = schedule(() => {
        timer = null;
        if (pending !== current || pointers.size !== 1) return;
        pending = null;
        // Install before the callback: opening the sheet may cancel graph dragging.
        guard = { node: current.node, pointerId: current.pointerId, until: Infinity };
        if (onHold(current.node) === false) guard = null;
      }, delay);
    },
    move(event) {
      if (pending?.pointerId === event.pointerId
        && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) >= distance) stop();
    },
    up(event) {
      pointers.delete(event.pointerId);
      if (pending?.pointerId === event.pointerId) stop();
      if (guard?.pointerId === event.pointerId) guard.until = now() + 800;
    },
    consumeClick(event, node) {
      if (!guard || guard.node !== node || now() >= guard.until) return false;
      // Do not swallow keyboard/screen-reader activation after a touch gesture.
      return event.pointerType === 'touch' || event.detail > 0 || event.sourceCapabilities?.firesTouchEvents === true;
    },
    cancel() { stop(); },
    reset() {
      stop(); pointers.clear();
      if (guard) guard.until = now() + 800;
    },
    destroy() { stop(); pointers.clear(); guard = null; }
  };
}

// One unscaled action for the selected node; never nest a button inside a node.
export function createTouchCredits({ host, preview, selectedNode, beforeOpen = () => {}, announce = () => {} }) {
  const doc = host.ownerDocument, view = doc.defaultView;
  const coarse = view.matchMedia('(any-pointer: coarse)');
  const action = doc.createElement('button');
  action.type = 'button'; action.className = 'node-track-info'; action.hidden = true;
  action.textContent = '♫ Track info';
  action.setAttribute('aria-haspopup', 'dialog'); action.setAttribute('aria-controls', 'shared-credit-preview');
  host.append(action);
  let touchUntil = 0;
  const touchInput = () => coarse.matches || performance.now() < touchUntil;
  const open = (node, trigger = node) => {
    if (!node || !host.contains(node)) return false;
    beforeOpen();
    const opened = preview.open(node, { trigger });
    if (opened) announce('Shared track information opened. Close it or choose Open preview. Audio does not start automatically.');
    refresh();
    return opened;
  };
  const hold = createCreditHold({ onHold: node => open(node) });
  function refresh() {
    host.classList.toggle('touch-credit-input', touchInput());
    const node = selectedNode();
    if ((!touchInput() && view.innerWidth > 760) || !node || !host.contains(node) || !preview.canPreview(node)) { action.hidden = true; return; }
    const map = host.getBoundingClientRect(), box = node.getBoundingClientRect();
    if (map.bottom < 0 || map.top >= view.innerHeight || box.right < map.left || box.left > map.right
      || box.bottom < map.top || box.top > map.bottom) { action.hidden = true; return; }
    action.hidden = false;
    action.setAttribute('aria-label', `Shared track information for ${node.querySelector('.node-name')?.textContent || 'this artist'}`);
    action.setAttribute('aria-expanded', String(preview.isOpenFor(node)));
    const width = action.offsetWidth || 100, height = action.offsetHeight || 32, pad = 10;
    const bottom = Math.max(box.bottom, ...[...node.querySelectorAll('.node-name, .node-role')].map(e => e.getBoundingClientRect().bottom));
    const top = bottom + height + 10 < map.bottom - 65 ? bottom + 7 : box.top - height - 10;
    if (top < map.top + pad || top + height > map.bottom - 60) { action.hidden = true; return; }
    action.style.left = `${Math.max(pad, Math.min(map.width - width - pad, (box.left + box.right - width) / 2 - map.left))}px`;
    action.style.top = `${top - map.top}px`;
  }
  action.addEventListener('click', () => {
    const node = selectedNode();
    if (preview.isOpenFor(node)) { preview.dismiss(true); refresh(); }
    else open(node, action);
  });
  const down = event => {
    const node = event.target.closest?.('#nodes .node');
    if (!preview.contains(event.target) && !action.contains(event.target)) preview.dismiss(true);
    if (event.pointerType === 'touch') { touchUntil = performance.now() + 1500; refresh(); }
    hold.down(event, node && host.contains(node) ? node : null);
  };
  const move = event => hold.move(event);
  const up = event => { hold.up(event); refresh(); };
  const click = event => {
    const node = event.target.closest?.('#nodes .node');
    if (node && hold.consumeClick(event, node)) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  const scroll = event => {
    hold.cancel();
    if (!preview.contains(event.target)) preview.dismiss(true);
    refresh();
  };
  const wheel = () => { hold.cancel(); preview.dismiss(true); };
  const lostCapture = () => hold.cancel();
  const reset = () => { hold.reset(); preview.dismiss(true); refresh(); };
  const visibility = () => { if (doc.hidden) reset(); };
  const context = event => {
    if (event.target.closest?.('#nodes .node')) event.preventDefault();
  };
  doc.addEventListener('pointerdown', down, true);
  doc.addEventListener('pointermove', move, true);
  doc.addEventListener('pointerup', up, true);
  doc.addEventListener('pointercancel', up, true);
  doc.addEventListener('lostpointercapture', lostCapture, true);
  doc.addEventListener('click', click, true);
  doc.addEventListener('scroll', scroll, { capture: true, passive: true });
  host.addEventListener('wheel', wheel, { capture: true, passive: true });
  host.addEventListener('contextmenu', context);
  doc.addEventListener('visibilitychange', visibility);
  view.addEventListener('blur', reset);
  view.addEventListener('resize', refresh);
  coarse.addEventListener?.('change', refresh);
  refresh();
  return {
    refresh, touchInput, cancel: () => hold.cancel(),
    destroy() {
      hold.destroy(); action.remove();
      doc.removeEventListener('pointerdown', down, true); doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true); doc.removeEventListener('pointercancel', up, true);
      doc.removeEventListener('lostpointercapture', lostCapture, true);
      doc.removeEventListener('click', click, true); doc.removeEventListener('scroll', scroll, true);
      host.removeEventListener('wheel', wheel, true); host.removeEventListener('contextmenu', context);
      doc.removeEventListener('visibilitychange', visibility); view.removeEventListener('blur', reset);
      view.removeEventListener('resize', refresh); coarse.removeEventListener?.('change', refresh);
    }
  };
}
