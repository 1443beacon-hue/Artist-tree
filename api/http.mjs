export class ApiError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const messages = {
  missing_credentials: 'Set the server environment variables for this source.',
  authentication: 'This source rejected its credentials. Check or renew the server token.',
  forbidden: 'This endpoint is not available to this application or account.',
  rate_limited: 'This source is rate limited. Please try again later.',
  not_found: 'This artist or resource was not found in this source.',
  network: 'This source could not be reached. Please try again.',
  upstream: 'This source returned an unexpected response.'
};

export function publicError(error) {
  const code = Object.hasOwn(messages, error?.code) ? error.code : 'upstream';
  return { code, message: messages[code] };
}

// One shared queue enforces MusicBrainz's <= 1 request/second rule, including
// simultaneous users. Only short-lived metadata is cached, never credentials.
export function createHttpClient({ fetchImpl = fetch, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), mbInterval = 1100 } = {}) {
  const cache = new Map();
  const inFlight = new Map();
  const stats = new Map();
  const cooldown = new Map();
  let mbQueue = Promise.resolve();
  let mbLastStart = -Infinity;
  let mbPending = 0;

  async function perform(provider, url, options) {
    if ((cooldown.get(provider) || 0) > now()) throw new ApiError('rate_limited', messages.rate_limited, 429);
    try {
      const response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(9000) });
      if (!response.ok) {
        const code = response.status === 401 ? 'authentication' : response.status === 403 ? 'forbidden'
          : response.status === 404 ? 'not_found' : response.status === 429 ? 'rate_limited' : 'upstream';
        if (response.status === 429) {
          const retry = Number(response.headers.get('retry-after'));
          cooldown.set(provider, now() + Math.max(15, Math.min(120, retry || 30)) * 1000);
        }
        throw new ApiError(code, messages[code], response.status);
      }
      const text = await response.text();
      if (text.length > 3_000_000) throw new ApiError('upstream', messages.upstream);
      let data;
      try { data = JSON.parse(text); } catch { throw new ApiError('upstream', messages.upstream); }
      if (new URL(url).hostname !== 'accounts.spotify.com') {
        stats.set(provider, { lastSuccess: new Date(now()).toISOString(), lastError: null });
      }
      return data;
    } catch (error) {
      const safe = error instanceof ApiError ? error : new ApiError('network', messages.network);
      stats.set(provider, { ...stats.get(provider), lastError: publicError(safe) });
      throw safe;
    }
  }

  async function request(provider, url, options = {}, ttl = 120_000) {
    const key = `${provider}:${url}`;
    const cacheable = !options.method || options.method === 'GET';
    const cached = cache.get(key);
    if (cacheable && cached?.until > now()) return cached.data;
    if (cacheable && inFlight.has(key)) return inFlight.get(key);
    const execute = () => perform(provider, url, options);
    let promise;
    if (provider === 'musicbrainz') {
      if (mbPending >= 20) throw new ApiError('rate_limited', messages.rate_limited, 429);
      mbPending++;
      promise = mbQueue.catch(() => {}).then(async () => {
        const delay = Math.max(0, mbLastStart + mbInterval - now());
        if (delay) await sleep(delay);
        mbLastStart = now();
        try { return await execute(); } finally { mbPending--; }
      });
      mbQueue = promise;
    } else promise = execute();
    if (cacheable) inFlight.set(key, promise);
    try {
      const data = await promise;
      if (cacheable) {
        if (cache.size >= 256) cache.delete(cache.keys().next().value);
        cache.set(key, { data, until: now() + ttl });
      }
      return data;
    } finally {
      if (cacheable) inFlight.delete(key);
    }
  }
  return { request, status: provider => ({ lastSuccess: null, lastError: null, ...stats.get(provider) }) };
}
