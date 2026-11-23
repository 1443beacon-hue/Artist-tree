import { validateSavedMap } from './saved-maps.js';
import { accountRedirect } from './account-session.js';

const draftKey = scope => `artistree.login-draft.v1.${scope}`;
export function preserveLoginDraft(storage, value, scope) {
  if (!value) { storage.removeItem(draftKey(scope)); return; }
  const map = validateSavedMap({ ...value, version: 1, scope, id: 'login-draft', name: 'Unsaved exploration',
    savedAt: new Date().toISOString() }, scope);
  const raw = JSON.stringify(map);
  if (!map || raw.length > 2_000_000) throw new Error('Save this map in your browser before signing in.');
  try { storage.setItem(draftKey(scope), raw); }
  catch { throw new Error('Could not keep your exploration during sign-in. Save it in this browser first.'); }
}
export function readLoginDraft(storage, scope) {
  try {
    const raw = storage.getItem(draftKey(scope));
    if (!raw || raw.length > 2_000_000) return null;
    const map = validateSavedMap(JSON.parse(raw), scope);
    if (!map || Math.abs(Date.now() - Date.parse(map.savedAt)) > 86_400_000) return null;
    return map;
  } catch { return null; }
}

export function createAccountUI({ account, button, dialog, scope, snapshot, openMap, announce,
  view = window }) {
  const $ = selector => dialog.querySelector(selector);
  let pending = false;
  const embedded = view.self !== view.top;
  const message = text => { $('#account-status').textContent = text; };
  const fullSite = $('#account-full-site');
  fullSite.href = accountRedirect(view.location); fullSite.hidden = !embedded;
  function render(state) {
    button.textContent = state.user ? 'My account' : 'Sign in';
    $('#account-identity').textContent = state.user
      ? `Signed in as ${state.user.user_metadata?.full_name || state.user.user_metadata?.name || state.user.email || 'music explorer'}`
      : 'Keep exploring freely. Sign in to save private maps across your devices.';
    for (const control of dialog.querySelectorAll('[data-auth-provider]')) {
      const enabled = state.ready && !state.user && state.providers.includes(control.dataset.authProvider);
      control.disabled = !enabled || pending || embedded;
      control.title = enabled ? '' : 'Provider setup pending';
      control.hidden = Boolean(state.user);
    }
    $('#account-sign-out').hidden = !state.user;
    $('#account-sign-out').disabled = pending;
    $('#account-setup-note').textContent = embedded ? 'For sign-in and account saving, open the full site in a new tab.'
      : !state.ready ? 'Checking account services…'
        : !state.configured ? 'Social sign-in is not connected yet. Your browser saves remain available.'
          : state.user ? 'Choose Save → My account to save a tree. Browser maps are copied only when you choose Copy to account.'
            : 'Only configured providers are available. Browser saves are never uploaded automatically.';
  }
  account.subscribe(render);
  button.addEventListener('click', () => { message(account.state().error); dialog.showModal(); });
  $('#close-account').addEventListener('click', () => dialog.close());
  for (const control of dialog.querySelectorAll('[data-auth-provider]')) {
    control.addEventListener('click', async () => {
      if (pending || embedded) return;
      pending = true; render(account.state()); message('Opening secure sign-in…');
      try {
        preserveLoginDraft(view.sessionStorage, snapshot(), scope);
        await account.signIn(control.dataset.authProvider);
      } catch (error) { message(error.message); pending = false; render(account.state()); }
    });
  }
  $('#account-sign-out').addEventListener('click', async () => {
    pending = true; render(account.state());
    try { await account.signOut(); message('Signed out on this browser. Your browser maps are unchanged.'); announce('Signed out.'); }
    catch (error) { message(error.message); }
    finally { pending = false; render(account.state()); }
  });
  return {
    async start() {
      const callback = await account.start();
      if (callback.returned) {
        const draft = readLoginDraft(view.sessionStorage, scope);
        if (draft) {
          try { openMap(draft); view.sessionStorage.removeItem(draftKey(scope)); announce('Your exploration was restored. Save it explicitly when ready.'); }
          catch { /* Keep the draft if the view cannot restore it. */ }
        }
        message(account.state().error || (account.state().user
          ? 'Signed in. Choose Save → My account to save your tree.'
          : 'Sign-in was not completed. Your browser maps are unchanged.'));
        dialog.showModal();
      }
    }
  };
}
