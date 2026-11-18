export function createSavedMapsUI({ button, popover, store, canSave, defaultName, snapshot, openMap, announce }) {
  const doc = popover.ownerDocument, $ = selector => popover.querySelector(selector);
  const form = $('#map-save-form'), input = $('#map-save-name'), status = $('#map-save-status');
  const formView = $('#map-save-view'), listView = $('#map-list-view'), list = $('#saved-map-list');
  function position() {
    if (popover.hidden || typeof button.getBoundingClientRect !== 'function') return;
    const view = doc.defaultView, width = Math.min(310, view.innerWidth - 32), height = view.innerHeight;
    if (!width || !height) return;
    popover.style.width = `${width}px`; popover.style.maxHeight = `${Math.max(120, height - 24)}px`;
    const anchor = button.getBoundingClientRect(), wanted = Math.min(popover.scrollHeight + 2, height - 24, 480);
    const below = height - anchor.bottom - 12, above = anchor.top - 12;
    const top = below >= wanted || below >= above ? anchor.bottom + 10 : Math.max(12, anchor.top - wanted - 10);
    popover.style.left = `${Math.max(16, Math.min(view.innerWidth - width - 16, anchor.right - width))}px`;
    popover.style.top = `${Math.max(12, top)}px`;
    popover.style.maxHeight = `${Math.max(100, Math.min(480, height - Math.max(12, top) - 12))}px`;
  }
  const message = value => { status.textContent = value; position(); };
  const count = () => {
    try { $('#show-saved-maps').textContent = `Saved maps (${store.list().length}) →`; }
    catch { $('#show-saved-maps').textContent = 'Saved maps →'; }
  };
  const refresh = () => {
    const available = canSave();
    $('#map-save-submit').disabled = !available;
    input.disabled = !available;
    $('#map-save-context').textContent = available ? 'Save the visible artists, credits, path, and view.' : 'Start with an artist to save a map.';
    position();
  };
  const close = (focus = false) => {
    popover.hidden = true; button.setAttribute('aria-expanded', 'false');
    if (focus) button.focus({ preventScroll: true });
  };
  const showList = () => {
    formView.hidden = true; listView.hidden = false; message(''); list.replaceChildren();
    $('#map-save-title').textContent = 'Saved maps';
    try {
      const maps = store.list();
      if (!maps.length) { const empty = doc.createElement('p'); empty.textContent = 'No maps saved in this view yet.'; list.append(empty); }
      for (const map of maps) {
        const row = doc.createElement('li'), open = doc.createElement('button'), remove = doc.createElement('button');
        open.type = 'button'; open.className = 'saved-map-open';
        const title = doc.createElement('strong'), detail = doc.createElement('span');
        title.textContent = map.name;
        detail.textContent = `${map.graph.artists.length} artists · ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(map.savedAt))}`;
        open.append(title, detail);
        open.setAttribute('aria-label', `Open saved map ${map.name}`);
        open.addEventListener('click', () => {
          try { openMap(map); close(); announce(`Opened ${map.name}. Saved credits are a dated snapshot.`); }
          catch { message('This map could not be opened. The current view was not replaced.'); }
        });
        remove.type = 'button'; remove.className = 'saved-map-delete'; remove.textContent = 'Delete';
        remove.setAttribute('aria-label', `Delete saved map ${map.name}`);
        remove.addEventListener('click', () => {
          if (remove.dataset.confirm !== 'true') {
            remove.dataset.confirm = 'true'; remove.textContent = 'Delete?'; remove.setAttribute('aria-label', `Confirm deleting saved map ${map.name}`); return;
          }
          try {
            store.remove(map.id); showList(); count(); announce(`Deleted saved map ${map.name}.`);
            (list.querySelector('.saved-map-open') || $('#back-to-save')).focus({ preventScroll: true });
          }
          catch (error) { message(error.message); }
        });
        row.append(open, remove); list.append(row);
      }
    } catch (error) { message(error.message); }
    position();
  };
  const showForm = () => {
    formView.hidden = false; listView.hidden = true; message('');
    $('#map-save-title').textContent = 'Save this map';
    input.value = defaultName().slice(0, 80); refresh(); count();
  };
  button.addEventListener('click', () => {
    if (!popover.hidden) { close(); return; }
    showForm(); popover.hidden = false; button.setAttribute('aria-expanded', 'true'); position();
    if (!input.disabled) input.focus({ preventScroll: true });
    else $('#show-saved-maps').focus({ preventScroll: true });
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!canSave()) return;
    try {
      const map = store.save({ ...snapshot(), name: input.value.trim() || defaultName() });
      count(); message(`Saved “${map.name}” in this browser.`); announce(`Saved ${map.name} in this browser.`);
    } catch (error) { message(error.message); }
  });
  $('#show-saved-maps').addEventListener('click', showList);
  $('#back-to-save').addEventListener('click', showForm);
  $('#close-map-save').addEventListener('click', () => close(true));
  doc.addEventListener('click', event => { if (!popover.hidden && !popover.contains(event.target) && !button.contains(event.target)) close(); });
  popover.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    // This is a non-modal popover: Tab may leave it, and focus closes it.
  });
  doc.addEventListener('focusin', event => { if (!popover.hidden && !popover.contains(event.target) && !button.contains(event.target)) close(); });
  doc.defaultView?.addEventListener('resize', position);
  doc.defaultView?.addEventListener('scroll', position, { passive: true });
  return { refresh, close };
}
