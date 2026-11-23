import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const AUTHORIZE = 'https://nid.naver.com/oauth2.0/authorize';
const TOKEN = 'https://nid.naver.com/oauth2.0/token';
const PROFILE = 'https://openapi.naver.com/v1/nid/me';
const ROOT = '/api/auth/naver';
export class NaverAuthError extends Error {
  constructor(status = 400, code = 'invalid_request') {
    super('Naver sign-in could not be completed. Please start again.');
    this.status = status; this.code = code;
  }
}
const fail = (status, code) => { throw new NaverAuthError(status, code); };
const plain = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u0020\u007f]/.test(value);
const equal = (a, b) => typeof a === 'string' && typeof b === 'string'
  && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function naverConfiguration(env) {
  try {
    const origin = new URL(env.PUBLIC_APP_ORIGIN), project = new URL(env.SUPABASE_URL);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.port
      || origin.pathname !== '/' || origin.search || origin.hash
      || project.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(project.hostname)
      || project.port || project.username || project.password || project.pathname !== '/' || project.search || project.hash
      || !plain(env.NAVER_CLIENT_ID, 200) || !plain(env.NAVER_CLIENT_SECRET, 300)
      || !/^[A-Za-z0-9_-]{43,128}$/.test(env.NAVER_ADAPTER_SECRET || '')) return null;
    return { origin: origin.origin, callback: `${origin.origin}${ROOT}/callback`, supabaseCallback: `${project.origin}/auth/v1/callback`,
      clientId: env.NAVER_CLIENT_ID, clientSecret: env.NAVER_CLIENT_SECRET, adapterSecret: env.NAVER_ADAPTER_SECRET };
  } catch { return null; }
}

// Stateless envelopes work across Vercel instances. No OAuth codes, state,
// provider tokens, or profile responses are cached, logged, or stored in trees.
// Supabase remains the session issuer; this adapter never mints a Supabase JWT.
export function createNaverAdapter({ env = {}, fetchImpl = fetch, now = Date.now } = {}) {
  const config = naverConfiguration(env);
  const key = config && createHash('sha256').update(`artistree.naver.v1:${config.adapterSecret}`).digest();
  const requireConfig = () => { if (!config) fail(503, 'provider_not_configured'); };
  function seal(type, data, ttl) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`${type}:${config.origin}:${config.supabaseCallback}`));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ ...data, exp: now() + ttl }), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
  }
  function open(type, value) {
    if (!plain(value, 12000) || !/^[A-Za-z0-9_-]+$/.test(value)) fail(400, 'invalid_grant');
    try {
      const bytes = Buffer.from(value, 'base64url');
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAAD(Buffer.from(`${type}:${config.origin}:${config.supabaseCallback}`));
      cipher.setAuthTag(bytes.subarray(12, 28));
      const data = JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8'));
      if (!Number.isSafeInteger(data.exp) || data.exp <= now() || data.exp > now() + 600_000) fail(400, 'invalid_grant');
      return data;
    } catch { fail(400, 'invalid_grant'); }
  }
  function single(params, name) {
    if (params.getAll(name).length !== 1) fail(400, 'invalid_request');
    return params.get(name);
  }
  async function upstream(url, options) {
    try {
      const response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10_000) });
      if (!response.ok || !response.body) fail(502, 'provider_unavailable');
      const reader = response.body.getReader(), chunks = []; let length = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          length += value.byteLength;
          if (length > 32_768) { await reader.cancel(); fail(502, 'provider_unavailable'); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { fail(502, 'provider_unavailable'); }
  }
  function authenticate(headers, params) {
    let id, secret;
    const authorization = headers.authorization;
    if (authorization) {
      if (!/^Basic [A-Za-z0-9+/]+={0,2}$/.test(authorization) || params.has('client_id') || params.has('client_secret')) fail(401, 'invalid_client');
      const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8'), split = decoded.indexOf(':');
      if (split < 1) fail(401, 'invalid_client');
      try { id = decodeURIComponent(decoded.slice(0, split)); secret = decodeURIComponent(decoded.slice(split + 1)); }
      catch { fail(401, 'invalid_client'); }
    } else {
      id = single(params, 'client_id'); secret = single(params, 'client_secret');
    }
    if (!equal(id, config.clientId) || !equal(secret, config.adapterSecret)) fail(401, 'invalid_client');
  }
  return {
    configured: Boolean(config),
    authorize(params) {
      requireConfig();
      if (!equal(single(params, 'client_id'), config.clientId)
        || single(params, 'redirect_uri') !== config.supabaseCallback
        || single(params, 'response_type') !== 'code'
        || single(params, 'code_challenge_method') !== 'S256') fail(400, 'invalid_request');
      const state = single(params, 'state'), challenge = single(params, 'code_challenge');
      if (!plain(state, 2048) || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) fail(400, 'invalid_request');
      const next = new URL(AUTHORIZE);
      next.search = new URLSearchParams({ response_type: 'code', client_id: config.clientId, redirect_uri: config.callback,
        state: seal('state', { state, challenge }, 600_000) }).toString();
      return next.href;
    },
    callback(params) {
      requireConfig();
      const envelope = single(params, 'state'), state = open('state', envelope);
      const next = new URL(config.supabaseCallback); next.searchParams.set('state', state.state);
      if (params.has('error')) {
        next.searchParams.set('error', 'access_denied');
        next.searchParams.set('error_description', 'Naver sign-in was declined.');
      } else {
        const code = single(params, 'code');
        if (!plain(code, 2048)) fail(400, 'invalid_request');
        next.searchParams.set('code', seal('code', { code, state: envelope }, 120_000));
      }
      return next.href;
    },
    async token(headers, params) {
      requireConfig(); authenticate(headers, params);
      if (single(params, 'grant_type') !== 'authorization_code'
        || single(params, 'redirect_uri') !== config.supabaseCallback) fail(400, 'invalid_request');
      const code = open('code', single(params, 'code')), state = open('state', code.state);
      const verifier = single(params, 'code_verifier');
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)
        || !equal(createHash('sha256').update(verifier).digest('base64url'), state.challenge)) fail(400, 'invalid_grant');
      const result = await upstream(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId,
          client_secret: config.clientSecret, code: code.code, state: code.state, redirect_uri: config.callback }).toString() });
      const lifetime = Math.min(300, Number(result.expires_in));
      if (result.error || !plain(result.access_token, 8192) || String(result.token_type).toLowerCase() !== 'bearer'
        || !Number.isFinite(lifetime) || lifetime < 1) fail(502, 'provider_unavailable');
      // The raw Naver token never leaves this server. Supabase receives a
      // short-lived opaque token usable only at this adapter's userinfo route.
      return { access_token: seal('access', { token: result.access_token }, Math.floor(lifetime) * 1000),
        token_type: 'Bearer', expires_in: Math.floor(lifetime) };
    },
    async userinfo(headers) {
      requireConfig();
      const match = /^Bearer ([A-Za-z0-9_-]{1,12000})$/i.exec(headers.authorization || '');
      if (!match) fail(401, 'invalid_token');
      let access;
      try { access = open('access', match[1]); } catch { fail(401, 'invalid_token'); }
      const profile = await upstream(PROFILE, { headers: { Authorization: `Bearer ${access.token}` } });
      const id = profile.response?.id;
      if (profile.resultcode !== '00' || !plain(id, 256)) fail(502, 'provider_unavailable');
      const name = profile.response.nickname || profile.response.name;
      // Never manufacture email verification or merge accounts using names.
      return { sub: id, ...(typeof name === 'string' ? { name: name.slice(0, 120).replace(/[\u0000-\u001f\u007f]/g, '') } : {}) };
    }
  };
}

export async function readNaverTokenForm(req) {
  if (!/^application\/x-www-form-urlencoded(?:;|$)/i.test(req.headers['content-type'] || '')) fail(415, 'invalid_request');
  if (Number(req.headers['content-length']) > 16_384) fail(413, 'invalid_request');
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 16_384) fail(413, 'invalid_request');
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}
