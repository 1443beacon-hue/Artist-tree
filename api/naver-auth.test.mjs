import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createNaverAdapter, naverConfiguration, NaverAuthError, readNaverTokenForm } from './naver-auth.mjs';

const env = { PUBLIC_APP_ORIGIN: 'https://artistree.example', SUPABASE_URL: 'https://artistree-test.supabase.co',
  NAVER_CLIENT_ID: 'naver-client-id', NAVER_CLIENT_SECRET: 'private-naver-secret',
  NAVER_ADAPTER_SECRET: 'test-adapter-secret-with-at-least-forty-three-characters' };
const verifier = 'p'.repeat(64), challenge = createHash('sha256').update(verifier).digest('base64url');
const authorization = () => new URLSearchParams({ response_type: 'code', client_id: env.NAVER_CLIENT_ID,
  redirect_uri: `${env.SUPABASE_URL}/auth/v1/callback`, state: 'supabase-random-flow-state', code_challenge: challenge, code_challenge_method: 'S256' });
function setup() {
  let time = 100_000;
  const calls = [];
  const adapter = createNaverAdapter({ env, now: () => time, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return Response.json(url.includes('/token') ? { access_token: 'raw-naver-token+/=', refresh_token: 'private-refresh-token', expires_in: '3600', token_type: 'bearer' }
      : { resultcode: '00', response: { id: 'stable-naver-subject', nickname: 'Music lover', email: 'unverified@example.test', mobile: 'private-phone' } });
  } });
  const navigation = new URL(adapter.authorize(authorization()));
  const state = navigation.searchParams.get('state');
  const callback = new URL(adapter.callback(new URLSearchParams({ state, code: 'single-use-naver-code' })));
  const form = () => new URLSearchParams({ grant_type: 'authorization_code', code: callback.searchParams.get('code'),
    redirect_uri: `${env.SUPABASE_URL}/auth/v1/callback`, code_verifier: verifier });
  const headers = { authorization: `Basic ${Buffer.from(`${env.NAVER_CLIENT_ID}:${env.NAVER_ADAPTER_SECRET}`).toString('base64')}` };
  return { adapter, calls, navigation, state, callback, form, headers, advance(ms) { time += ms; } };
}

test('Naver adapter completes the server-side protocol without issuing Supabase sessions or exposing raw provider tokens', async () => {
  const context = setup();
  assert.equal(context.navigation.origin, 'https://nid.naver.com');
  assert.equal(context.navigation.searchParams.get('redirect_uri'), `${env.PUBLIC_APP_ORIGIN}/api/auth/naver/callback`);
  assert.equal(context.callback.origin, env.SUPABASE_URL);
  assert.equal(context.callback.searchParams.get('state'), 'supabase-random-flow-state');
  assert.doesNotMatch(context.callback.href, /single-use-naver-code|private-naver-secret|private-refresh-token/);
  const token = await context.adapter.token(context.headers, context.form());
  assert.equal(token.expires_in, 300);
  assert.equal(Object.hasOwn(token, 'refresh_token'), false);
  assert.doesNotMatch(JSON.stringify(token), /raw-naver-token|private-refresh-token/);
  const upstream = new URLSearchParams(context.calls[0].options.body);
  assert.equal(upstream.get('state'), context.state, 'Naver receives exactly its original state');
  assert.equal(upstream.get('code'), 'single-use-naver-code');
  assert.equal(upstream.get('client_secret'), env.NAVER_CLIENT_SECRET);
  assert.equal(context.calls[0].url, 'https://nid.naver.com/oauth2.0/token');
  assert.equal(context.calls[0].options.method, 'POST');
  assert.equal(context.calls[0].options.redirect, 'error');
  const profile = await context.adapter.userinfo({ authorization: `Bearer ${token.access_token}` });
  assert.deepEqual(profile, { sub: 'stable-naver-subject', name: 'Music lover' });
  assert.equal(context.calls[1].url, 'https://openapi.naver.com/v1/nid/me');
  assert.equal(context.calls[1].options.headers.Authorization, 'Bearer raw-naver-token+/=');
});

test('authorization cannot override redirect destinations, downgrade PKCE or accept duplicate security parameters', () => {
  for (const [field, value] of [['redirect_uri', 'https://attacker.test/callback'], ['client_id', 'other-client'],
    ['response_type', 'token'], ['code_challenge_method', 'plain'], ['code_challenge', 'short'], ['state', '']]) {
    const params = authorization(); params.set(field, value);
    assert.throws(() => setup().adapter.authorize(params), NaverAuthError);
  }
  const params = authorization(); params.append('state', 'second');
  assert.throws(() => setup().adapter.authorize(params), NaverAuthError);
  assert.equal(naverConfiguration({ ...env, NAVER_ADAPTER_SECRET: 'short' }), null);
  assert.equal(naverConfiguration({ ...env, PUBLIC_APP_ORIGIN: 'http://artistree.example' }), null);
  assert.throws(() => createNaverAdapter().authorize(authorization()), error => error.status === 503);
});

test('callbacks require untampered, unexpired state and forward only generic cancellation errors', () => {
  const context = setup();
  assert.throws(() => context.adapter.callback(new URLSearchParams({ state: `${context.state}x`, code: 'x' })), NaverAuthError);
  assert.throws(() => context.adapter.callback(new URLSearchParams({ code: 'x' })), NaverAuthError);
  const declined = new URL(context.adapter.callback(new URLSearchParams({ state: context.state,
    error: 'private-diagnostic', error_description: 'private-token' })));
  assert.equal(declined.searchParams.get('error'), 'access_denied');
  assert.doesNotMatch(declined.href, /private-diagnostic|private-token/);
  context.advance(600_001);
  assert.throws(() => context.adapter.callback(new URLSearchParams({ state: context.state, code: 'x' })), NaverAuthError);
});

test('code exchange requires the adapter secret, exact callback and the Supabase PKCE verifier before contacting Naver', async () => {
  const context = setup();
  await assert.rejects(context.adapter.token({ authorization: 'Basic invalid' }, context.form()), NaverAuthError);
  const wrong = context.form(); wrong.set('code_verifier', 'x'.repeat(64));
  await assert.rejects(context.adapter.token(context.headers, wrong), NaverAuthError);
  const redirect = context.form(); redirect.set('redirect_uri', 'https://attacker.test');
  await assert.rejects(context.adapter.token(context.headers, redirect), NaverAuthError);
  const duplicate = context.form(); duplicate.append('code', 'second');
  await assert.rejects(context.adapter.token(context.headers, duplicate), NaverAuthError);
  const refresh = context.form(); refresh.set('grant_type', 'refresh_token');
  await assert.rejects(context.adapter.token(context.headers, refresh), NaverAuthError);
  assert.equal(context.calls.length, 0);
  const formCredentials = context.form(); formCredentials.set('client_id', env.NAVER_CLIENT_ID); formCredentials.set('client_secret', env.NAVER_ADAPTER_SECRET);
  await assert.rejects(context.adapter.token(context.headers, formCredentials), NaverAuthError);
  assert.ok((await context.adapter.token({}, formCredentials)).access_token);
  context.advance(120_001);
  await assert.rejects(context.adapter.token(context.headers, context.form()), NaverAuthError);
});

test('userinfo accepts only this adapter’s short-lived access envelope, never arbitrary Naver bearer tokens or code envelopes', async () => {
  const context = setup();
  await assert.rejects(context.adapter.userinfo({ authorization: 'Bearer raw-naver-token' }), error => error.status === 401);
  await assert.rejects(context.adapter.userinfo({ authorization: `Bearer ${context.callback.searchParams.get('code')}` }), error => error.status === 401);
  const token = await context.adapter.token(context.headers, context.form());
  context.advance(300_001);
  await assert.rejects(context.adapter.userinfo({ authorization: `Bearer ${token.access_token}` }), error => error.status === 401);
  assert.equal(context.calls.length, 1);
});

test('upstream errors, redirects, oversized bodies and malformed identities never leak provider diagnostics', async () => {
  const responses = [
    () => Response.json({ error: 'private-provider-diagnostic' }, { status: 401 }),
    () => Response.json({ error: 'private-provider-diagnostic' }),
    () => new Response('private-token'.repeat(4000)),
    () => new Response('{invalid-private-json'),
    () => { throw new Error('private-network-token'); }
  ];
  const context = setup();
  for (const response of responses) {
    const adapter = createNaverAdapter({ env, now: () => 100_000, fetchImpl: async () => response() });
    await assert.rejects(adapter.token(context.headers, context.form()), error =>
      error instanceof NaverAuthError && error.status === 502 && !/private/.test(error.message));
  }
  const token = await context.adapter.token(context.headers, context.form());
  const missing = createNaverAdapter({ env, now: () => 100_000, fetchImpl: async () => Response.json({ resultcode: '00', response: { name: 'No ID' } }) });
  await assert.rejects(missing.userinfo({ authorization: `Bearer ${token.access_token}` }), NaverAuthError);
});

test('token request forms are POST-only in the handler and have a bounded, explicit content type', async () => {
  const request = (body, headers = {}) => Object.assign(Readable.from([Buffer.from(body)]), { headers });
  await assert.rejects(readNaverTokenForm(request('x=1', { 'content-type': 'application/json' })), error => error.status === 415);
  await assert.rejects(readNaverTokenForm(request('x'.repeat(17000), { 'content-type': 'application/x-www-form-urlencoded' })), error => error.status === 413);
  const form = await readNaverTokenForm(request('code=a%2Bb&state=s', { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' }));
  assert.equal(form.get('code'), 'a+b');
});
