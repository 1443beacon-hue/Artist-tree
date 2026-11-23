export function createSavedMapsUI({ button, popover, store: browserStore, cloudStore, account,
  canSave, defaultName, snapshot, openMap, announce }) {
  const doc = popover.ownerDocument, $ = selector => popover.querySelector(selector);
  const form = $('#map-save-form'), input = $('#map-save-name'), status = $('#map-save-status');
  const formView = $('#map-save-view'), listView = $('#map-list-view'), list = $('#saved-map-list');
  let mode = 'browser', serial = 0, busy = false, userId = null;
  const currentStore = () => mode === 'account' ? cloudStore : browserStore;
  const destination = () => mode === 'account' ? 'your account' : 'this browser';
  let browserButton, cloudButton;
  if (account && cloudStore) {
    const choices = doc.createElement('div'); choices.className = 'map-storage-choices';
    browserButton = doc.createElement('button'); cloudButton = doc.createElement('button');
    for (const [control, label, value] of [[browserButton, 'This browser', 'browser'], [cloudButton, 'My account', 'account']]) {
      control.type = 'button'; control.textContent = label;
      control.addEventListener('click', () => { mode = value; showForm(); });
      choices.append(control);
    }
    formView.before(choices);
  }
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
    if (mode === 'account') { $('#show-saved-maps').textContent = 'My account maps →'; return; }
    try { $('#show-saved-maps').textContent = `Saved maps (${browserStore.list().length}) →`; }
    catch { $('#show-saved-maps').textContent = 'Saved maps →'; }
  };
  const refresh = () => {
    const available = canSave() && !busy;
    $('#map-save-submit').disabled = !available;
    input.disabled = !available;
    $('#map-save-context').textContent = canSave() ? 'Save the visible artists, credits, path, and view.' : 'Start with an artist to save a map.';
    if (cloudButton) {
      cloudButton.disabled = !account.state().user;
      cloudButton.title = account.state().user ? 'Private maps across your devices' : 'Sign in to save across devices';
      browserButton.setAttribute('aria-pressed', String(mode === 'browser'));
      cloudButton.setAttribute('aria-pressed', String(mode === 'account'));
    }
    const note = $('.map-storage-note');
    if (note) note.textContent = mode === 'account'
      ? 'Private to your account · available across devices. Credits are a dated snapshot.'
      : 'Only in this browser. Sign in and choose My account for cloud saving. Existing browser maps stay here.';
    position();
  };
  const close = (focus = false) => {
    ++serial; busy = false; list.replaceChildren();
    status.textContent = '';
    popover.hidden = true; button.setAttribute('aria-expanded', 'false');
    if (focus) button.focus({ preventScroll: true });
  };
  const showList = async () => {
    const ticket = ++serial, store = currentStore();
    busy = false;
    formView.hidden = true; listView.hidden = false; message('Loading maps…'); list.replaceChildren();
    $('#map-save-title').textContent = mode === 'account' ? 'My account maps' : 'Browser maps';
    refresh();
    try {
      const maps = await store.list();
      if (ticket !== serial) return;
      message('');
      if (!maps.length) { const empty = doc.createElement('li'); empty.textContent = 'No maps saved in this view yet.'; list.append(empty); }
      for (const map of maps) {
        const row = doc.createElement('li'), open = doc.createElement('button'), remove = doc.createElement('button');
        open.type = 'button'; open.className = 'saved-map-open';
        const title = doc.createElement('strong'), detail = doc.createElement('span');
        title.textContent = map.name;
        detail.textContent = `${map.artistCount ?? map.graph.artists.length} artists · ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(map.savedAt))}`;
        open.append(title, detail); open.setAttribute('aria-label', `Open saved map ${map.name}`);
        open.addEventListener('click', async () => {
          if (busy || ticket !== serial) return;
          busy = true; open.disabled = true; message('Opening map…');
          try {
            const value = store.get ? await store.get(map.id) : map;
            if (ticket !== serial) return;
            openMap(value); close(); announce(`Opened ${map.name}. Saved credits are a dated snapshot.`);
          } catch (error) { if (ticket === serial) message(error.message || 'This map could not be opened.'); }
          finally { if (ticket === serial) { busy = false; open.disabled = false; } }
        });
        remove.type = 'button'; remove.className = 'saved-map-delete'; remove.textContent = 'Delete';
        remove.setAttribute('aria-label', `Delete saved map ${map.name}`);
        remove.addEventListener('click', async () => {
          if (busy || ticket !== serial) return;
          if (remove.dataset.confirm !== 'true') {
            remove.dataset.confirm = 'true'; remove.textContent = 'Delete?'; remove.setAttribute('aria-label', `Confirm deleting saved map ${map.name}`); return;
          }
          busy = true; remove.disabled = true;
          try {
            await store.remove(map.id);
            if (ticket !== serial) return;
            await showList(); count(); announce(`Deleted saved map ${map.name}.`);
            if (!popover.hidden) (list.querySelector('.saved-map-open') || $('#back-to-save')).focus({ preventScroll: true });
          } catch (error) { if (ticket === serial) message(error.message); }
          finally { if (ticket === serial) { busy = false; remove.disabled = false; } }
        });
        row.append(open, remove);
        if (mode === 'browser' && account?.state().user && cloudStore) {
          const copy = doc.createElement('button'); copy.type = 'button'; copy.className = 'saved-map-import';
          copy.textContent = 'Copy to account'; copy.setAttribute('aria-label', `Copy ${map.name} to your account; keep the browser copy`);
          copy.addEventListener('click', async () => {
            if (busy || ticket !== serial) return;
            busy = true; copy.disabled = true;
            try {
              await cloudStore.import(map);
              if (ticket === serial) { message(`Copied “${map.name}” to your account. Browser copy kept.`); announce(`Copied ${map.name} to your account.`); }
            } catch (error) { if (ticket === serial) message(error.message); }
            finally { if (ticket === serial) { busy = false; copy.disabled = false; } }
          });
          row.append(copy);
        }
        list.append(row);
      }
    } catch (error) { if (ticket === serial) message(error.message); }
    position();
  };
  const showForm = () => {
    ++serial; busy = false; list.replaceChildren();
    formView.hidden = false; listView.hidden = true; message('');
    $('#map-save-title').textContent = 'Save this map';
    input.value = defaultName().slice(0, 80); refresh(); count();
  };
  button.addEventListener('click', () => {
    if (!popover.hidden) { close(); return; }
    showForm(); popover.hidden = false; button.setAttribute('aria-expanded', 'true'); position();
    if (!input.disabled) input.focus({ preventScroll: true }); else $('#show-saved-maps').focus({ preventScroll: true });
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!canSave() || busy) return;
    const ticket = serial, target = destination(), store = currentStore();
    busy = true; refresh(); message('Saving…');
    try {
      const map = await store.save({ ...snapshot(), name: input.value.trim() || defaultName() });
      if (ticket !== serial) return;
      count(); message(`Saved “${map.name}” in ${target}.`); announce(`Saved ${map.name} in ${target}.`);
    } catch (error) { if (ticket === serial) message(error.message); }
    finally { if (ticket === serial) { busy = false; refresh(); } }
  });
  $('#show-saved-maps').addEventListener('click', () => { void showList(); });
  $('#back-to-save').addEventListener('click', showForm);
  $('#close-map-save').addEventListener('click', () => close(true));
  doc.addEventListener('click', event => { if (!popover.hidden && !popover.contains(event.target) && !button.contains(event.target)) close(); });
  popover.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
  });
  doc.addEventListener('focusin', event => { if (!popover.hidden && !popover.contains(event.target) && !button.contains(event.target)) close(); });
  doc.defaultView?.addEventListener('resize', position);
  doc.defaultView?.addEventListener('scroll', position, { passive: true });
  account?.subscribe(state => {
    if (state.user?.id !== userId) {
      userId = state.user?.id; close();
      if (!userId) mode = 'browser';
    }
    refresh();
  });
  return { refresh, close };
}
