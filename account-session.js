const providerIds = { google: 'google', kakao: 'kakao', naver: 'custom:naver' };
const changedMessage = 'Your account changed. Reopen saved maps and try again.';

export function accountRedirect(location) {
  const current = new URL(location.href), next = new URL('/', current.origin);
  if (current.searchParams.get('source') === 'spotify' && /^[A-Za-z0-9]{22}$/.test(current.searchParams.get('id') || '')) {
    for (const key of ['source', 'id', 'name']) if (current.searchParams.has(key)) next.searchParams.set(key, current.searchParams.get(key).slice(0, 100));
  }
  return next.href;
}

export function takeAuthCallback(location, history) {
  const url = new URL(location.href), code = url.searchParams.get('code');
  const fragment = new URLSearchParams(url.hash.slice(1));
  const fragmentAuth = ['access_token', 'refresh_token', 'error', 'error_code'].some(key => fragment.has(key));
  const failed = url.searchParams.has('error') || url.searchParams.has('error_code') || fragmentAuth;
  const returned = Boolean(code || failed);
  for (const key of ['code', 'error', 'error_code', 'error_description', 'sb_flow_id']) url.searchParams.delete(key);
  if (fragmentAuth) url.hash = '';
  if (url.href !== location.href) history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  return { code, failed, returned };
}

export function createAccount({ fetchImpl = fetch, location = window.location, history = window.history,
  clientFactory = async (...args) => (await import('./assets/supabase.js')).createClient(...args) } = {}) {
  let client = null, authOrigin = '', epoch = 0, revision = 0;
  let state = { ready: false, configured: false, user: null, providers: [], error: '' };
  const listeners = new Set();
  const publish = patch => {
    const previous = state.user?.id;
    state = { ...state, ...patch };
    if (previous !== state.user?.id) revision++;
    for (const listener of listeners) listener(state);
  };
  async function verify() {
    const ticket = ++epoch;
    try {
      const { data, error } = await client.auth.getUser();
      if (ticket !== epoch) return;
      publish({ user: error ? null : data.user, ready: true });
    } catch {
      if (ticket === epoch) publish({ user: null, ready: true, error: 'Could not verify your session. Please sign in again.' });
    }
  }
  return {
    state: () => state,
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    capture() {
      if (!state.ready || !state.user || !client) throw new Error('Sign in to use your account maps.');
      const id = state.user.id, version = revision;
      return { client, id, assertCurrent() {
        if (state.user?.id !== id || version !== revision) throw new Error(changedMessage);
      } };
    },
    async start() {
      // Strip credentials/errors before making any requests or displaying metadata.
      const callback = takeAuthCallback(location, history);
      try {
        const response = await fetchImpl('/api/auth/config', { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) throw new Error();
        const config = await response.json();
        if (!config.configured) {
          publish({ ready: true, error: callback.returned ? 'Sign-in could not be completed: account services are not connected yet.' : '' });
          return callback;
        }
        authOrigin = new URL(config.url).origin;
        client = await clientFactory(config.url, config.publishableKey, { auth: {
          flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true,
          storageKey: `artistree.auth.${new URL(config.url).hostname}`
        } });
        publish({ configured: true, providers: config.providers.filter(provider => Object.hasOwn(providerIds, provider)) });
        if (callback.failed) publish({ error: 'Sign-in was cancelled or declined. You can keep exploring.' });
        else if (callback.code) {
          const { error } = await client.auth.exchangeCodeForSession(callback.code);
          if (error) publish({ error: 'Sign-in could not be completed. Please try again in this browser.' });
        }
        await verify();
        client.auth.onAuthStateChange((_event, session) => {
          if (!session || session.user?.id !== state.user?.id) { ++epoch; publish({ user: null }); }
          // Never await Supabase calls inside its auth callback (it holds a lock).
          if (session) queueMicrotask(() => { void verify(); });
        });
      } catch {
        publish({ ready: true, configured: false, user: null, providers: [], error: 'Account services are unavailable. Browser saving still works.' });
      }
      return callback;
    },
    async signIn(provider) {
      if (!client || !state.ready || !state.providers.includes(provider)) throw new Error('This sign-in provider is not configured yet.');
      let result;
      try { result = await client.auth.signInWithOAuth({ provider: providerIds[provider],
        options: { redirectTo: accountRedirect(location), skipBrowserRedirect: true } }); }
      catch { throw new Error('Sign-in could not be started. Please try again.'); }
      const { data, error } = result;
      if (error || !data?.url) throw new Error('Sign-in could not be started. Please try again.');
      const target = new URL(data.url);
      // SDK responses must never turn this into an arbitrary redirect.
      if (target.origin !== authOrigin || target.pathname !== '/auth/v1/authorize') {
        throw new Error('Sign-in returned an unexpected destination.');
      }
      location.assign(target.href);
    },
    async signOut() {
      if (!client) return;
      let result;
      try { result = await client.auth.signOut({ scope: 'local' }); }
      catch { throw new Error('Sign-out failed. Please try again.'); }
      const { error } = result;
      if (error) throw new Error('Sign-out failed. Please try again.');
      ++epoch; publish({ user: null, error: '' });
    }
  };
}
