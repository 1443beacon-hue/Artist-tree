import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccount, accountRedirect, takeAuthCallback } from './account-session.js';
import { publicAuthConfig } from './api/auth-config.mjs';
import { preserveLoginDraft, readLoginDraft } from './account-ui.js';

const config = { configured: true, url: 'https://artistree-test.supabase.co',
  publishableKey: 'sb_publishable_public-test-key', providers: ['google', 'kakao', 'naver'] };
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup({ code = '', disabled = false, failed = false } = {}) {
  let callback, verifiedUser = null, assigned;
  const calls = [], location = { href: `https://artistree.example/?${code ? 'code=private-code&' : ''}${failed ? 'error=declined&error_description=private-diagnostic' : ''}`,
    assign: url => { assigned = url; } };
  const history = { replaceState: (_state, _title, path) => calls.push(['history', path]) };
  const client = {
    supabaseUrl: config.url,
    auth: {
      async getUser() { return { data: { user: verifiedUser }, error: null }; },
      async exchangeCodeForSession(value) { calls.push(['exchange', value]); return { error: null }; },
      onAuthStateChange(value) { callback = value; },
      async signInWithOAuth(value) { calls.push(['oauth', value]); return { data: { url: `${config.url}/auth/v1/authorize?provider=${value.provider}` } }; },
      async signOut(value) { calls.push(['signout', value]); return { error: null }; }
    }
  };
  const account = createAccount({ location, history, fetchImpl: async () => {
    calls.push(['fetch']); return { ok: true, json: async () => disabled ? { configured: false } : config };
  }, clientFactory: async (...args) => { calls.push(['client', args]); return client; } });
  return { account, calls, client, get assigned() { return assigned; },
    async session(id) { verifiedUser = id ? { id, email: `${id}@example.test` } : null; callback('event', id ? { user: { id } } : null); await flush(); } };
}

test('auth configuration exposes only a dedicated public URL/key and explicitly enabled providers', () => {
  const env = { SUPABASE_URL: config.url, SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
    ARTISTREE_AUTH_PROVIDERS: 'google,kakao,naver,spotify', SUPABASE_SERVICE_ROLE_KEY: 'server-secret',
    GOOGLE_CLIENT_SECRET: 'oauth-secret' };
  const result = publicAuthConfig(env);
  assert.deepEqual(result.providers, ['google', 'kakao']);
  assert.doesNotMatch(JSON.stringify(result), /server-secret|oauth-secret|spotify/);
  assert.deepEqual(publicAuthConfig({ ...env, ARTISTREE_NAVER_ADAPTER_VERIFIED: 'true' }).providers, ['google', 'kakao']);
  assert.deepEqual(publicAuthConfig({ ...env, ARTISTREE_NAVER_ADAPTER_VERIFIED: 'true',
    PUBLIC_APP_ORIGIN: 'https://artistree.example', NAVER_CLIENT_ID: 'naver-client-id', NAVER_CLIENT_SECRET: 'private-naver-secret',
    NAVER_ADAPTER_SECRET: 'test-adapter-secret-with-at-least-forty-three-characters' }).providers, ['google', 'kakao', 'naver']);
  for (const key of ['sb_secret_private-key', 'eyJservice-role-key', '', 'service_role']) {
    assert.equal(publicAuthConfig({ ...env, SUPABASE_PUBLISHABLE_KEY: key }).configured, false);
  }
  for (const url of ['http://artistree-test.supabase.co', 'https://supabase.co.attacker.test', `${config.url}/private`,
    `https://secret@artistree-test.supabase.co`, `${config.url}?token=x`]) {
    assert.equal(publicAuthConfig({ ...env, SUPABASE_URL: url }).configured, false);
  }
});

test('OAuth returns use a fixed same-origin root, preserve only a valid Spotify context and strip credentials', () => {
  assert.equal(accountRedirect({ href: 'https://artistree.example/?next=https://evil.test&code=private#access_token=private' }), 'https://artistree.example/');
  const result = new URL(accountRedirect({ href: 'https://artistree.example/?source=spotify&id=2xvtxDNInKDV4AvGmjw6d1&name=Artist&redirect_to=https://evil.test' }));
  assert.equal(result.searchParams.get('source'), 'spotify');
  assert.equal(result.searchParams.has('redirect_to'), false);
  let clean;
  const callback = takeAuthCallback({ href: 'https://artistree.example/?code=private&error_description=private&source=spotify#refresh_token=secret' },
    { replaceState: (_state, _title, path) => { clean = path; } });
  assert.equal(callback.code, 'private');
  assert.equal(clean, '/?source=spotify');
});

test('unconfigured auth does not instantiate an SDK or block guest/browser exploration', async () => {
  const { account, calls } = setup({ disabled: true });
  await account.start();
  assert.equal(account.state().ready, true);
  assert.equal(account.state().user, null);
  assert.equal(calls.some(call => call[0] === 'client'), false);
  await assert.rejects(account.signIn('google'), /not configured/);
  assert.throws(() => account.capture(), /Sign in/);
});

test('PKCE callback is exchanged once, scrubbed before requests and only server-verified users enable cloud operations', async () => {
  const context = setup({ code: 'present' });
  await context.account.start();
  assert.equal(context.calls[0][0], 'history');
  assert.equal(context.calls.filter(call => call[0] === 'exchange').length, 1);
  const options = context.calls.find(call => call[0] === 'client')[1][2].auth;
  assert.equal(options.flowType, 'pkce');
  assert.equal(options.detectSessionInUrl, false);
  assert.throws(() => context.account.capture(), /Sign in/);
  await context.session('alice');
  const captured = context.account.capture();
  assert.equal(captured.id, 'alice');
  await context.session('bob');
  assert.throws(captured.assertCurrent, /account changed/);
  await context.account.signOut();
  assert.equal(context.account.state().user, null);
  assert.deepEqual(context.calls.find(call => call[0] === 'signout')[1], { scope: 'local' });
});

test('three provider hooks use supported IDs, reject arbitrary redirects and never display raw provider errors', async () => {
  const context = setup();
  await context.account.start();
  await context.account.signIn('naver');
  assert.equal(context.calls.find(call => call[0] === 'oauth')[1].provider, 'custom:naver');
  assert.ok(context.assigned.startsWith(config.url));
  await assert.rejects(context.account.signIn('github'), /not configured/);
  context.client.auth.signInWithOAuth = async () => ({ data: { url: 'https://attacker.test' } });
  await assert.rejects(context.account.signIn('google'), /unexpected destination/);
  context.client.auth.signInWithOAuth = async () => ({ error: { message: 'private-provider-secret' } });
  await assert.rejects(context.account.signIn('google'), error => !error.message.includes('private-provider-secret'));
  const declined = setup({ failed: true });
  await declined.account.start();
  assert.match(declined.account.state().error, /cancelled or declined/);
  assert.doesNotMatch(declined.account.state().error, /private-diagnostic/);
});

test('redirect drafts whitelist graph snapshots, preserve scope and refuse damaged/expired drafts', () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const value = { graph: { artists: [{ id: 'genius:1', name: 'Artist', x: 1, y: 2, accessToken: 'private-secret' }], edges: [],
    explorer: { selected: 'genius:1', visible: ['genius:1'], expanded: [], trail: ['genius:1'], routes: [['genius:1', ['genius:1']]] } },
  camera: { zoom: 1, pan: { x: 0, y: 0 }, width: 1000, height: 650 } };
  preserveLoginDraft(storage, value, 'main');
  assert.equal(readLoginDraft(storage, 'main').graph.artists[0].id, 'genius:1');
  assert.equal(readLoginDraft(storage, 'spotify'), null);
  assert.doesNotMatch([...values.values()][0], /private-secret|accessToken/);
  const draft = JSON.parse([...values.values()][0]); draft.savedAt = '2000-01-01T00:00:00Z';
  storage.setItem('artistree.login-draft.v1.main', JSON.stringify(draft));
  assert.equal(readLoginDraft(storage, 'main'), null);
  storage.setItem('artistree.login-draft.v1.main', '{damaged');
  assert.equal(readLoginDraft(storage, 'main'), null);
  assert.throws(() => preserveLoginDraft({ setItem() { throw new Error('Quota'); } }, value, 'main'), /Could not keep/);
});
