import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { createProviders } from './api/providers.mjs';
import { createMusicService } from './api/service.mjs';
import { ApiError, publicError } from './api/http.mjs';
import { createStartingPointsService } from './api/starting-points.mjs';
import { createTrackPreviewService } from './api/track-preview.mjs';
import { PUBLIC_FILES } from './public-files.mjs';
import { publicAuthConfig } from './api/auth-config.mjs';
import { createNaverAdapter, NaverAuthError, readNaverTokenForm } from './api/naver-auth.mjs';

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
export const FRAME_POLICY = "frame-ancestors 'self' https://*.streamlit.app https://share.streamlit.io; object-src 'none'; base-uri 'self'";
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

function publicHosts(env) {
  const hosts = new Set();
  for (const value of [env.PUBLIC_APP_ORIGIN, env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (!value) continue;
    try {
      const url = new URL(value.startsWith('https://') ? value : `https://${value}`);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port) hosts.add(url.host);
    } catch { /* A malformed deployment hostname never authorizes traffic. */ }
  }
  return hosts;
}

export function createApplication({ env = process.env, publicDeployment = false, retain,
  root = fileURLToPath(new URL('.', import.meta.url)), providers = createProviders({ env }) } = {}) {
  const service = createMusicService(providers, { retain });
  const naver = createNaverAdapter({ env });
  const previews = createTrackPreviewService(providers, { storefront: env.APPLE_MUSIC_STOREFRONT });
  const startingPoints = createStartingPointsService(providers.genius, { loadSnapshot: async () => {
    const data = await readFile(resolve(root, env.GENIUS_ARTIST_CHART_FILE?.trim() || 'data/genius-artist-chart.json'), 'utf8');
    if (data.length > 16_384) throw new Error('Chart snapshot is too large.');
    return JSON.parse(data);
  } });
  const files = new Set(PUBLIC_FILES.map(file => `/${file}`));
  const hosts = publicHosts(env), clients = new Map();
  function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'Vercel-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(body));
  }
  return async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin');
    if (publicDeployment) res.setHeader('Content-Security-Policy', FRAME_POLICY);
    try {
      if (typeof req.headers.host !== 'string' || /[\\/@\s]/.test(req.headers.host)) {
        json(res, 400, { error: 'Invalid host.' }); return;
      }
      const host = new URL(`http://${req.headers.host}`);
      if (publicDeployment ? !hosts.has(host.host) : !localHosts.has(host.hostname)) {
        json(res, 403, { error: 'This host is not configured for this application.' }); return;
      }
      const url = new URL(req.url, 'http://localhost');
      let path;
      try { path = decodeURIComponent(url.pathname); }
      catch { json(res, 400, { error: 'Invalid URL encoding.' }); return; }
      if (!['GET', 'HEAD'].includes(req.method) && !(req.method === 'POST' && path === '/api/auth/naver/token')) {
        json(res, 405, { error: 'This method is not supported.' }); return;
      }
      if (path.startsWith('/api/')) {
        const origins = publicDeployment ? [`https://${host.host}`] : [`http://${host.host}`, `https://${host.host}`];
        if (req.headers.origin && !origins.includes(req.headers.origin)) {
          json(res, 403, { error: 'Cross-origin API requests are not permitted.' }); return;
        }
        // A bounded, per-instance abuse guard, not a distributed rate limiter.
        const client = publicDeployment
          ? String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim()
          : req.socket.remoteAddress;
        const now = Date.now();
        let quota = clients.get(client);
        if (!quota || quota.until <= now) {
          for (const [key, value] of clients) if (value.until <= now) clients.delete(key);
          if (clients.size >= 4096 && !clients.has(client)) { json(res, 429, { error: 'Please try again later.' }); return; }
          quota = { count: 0, until: now + 60_000 }; clients.set(client, quota);
        }
        if (++quota.count > 60) { json(res, 429, { error: 'Too many requests. Please wait a minute.' }); return; }
        if (path.startsWith('/api/auth/naver/')) {
          try {
            if (req.method === 'GET' && ['/api/auth/naver/authorize', '/api/auth/naver/callback'].includes(path)) {
              const location = path.endsWith('/authorize') ? naver.authorize(url.searchParams) : naver.callback(url.searchParams);
              res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end(); return;
            }
            if (path === '/api/auth/naver/token' && req.method === 'POST') {
              json(res, 200, await naver.token(req.headers, await readNaverTokenForm(req))); return;
            }
            if (path === '/api/auth/naver/userinfo' && req.method === 'GET') {
              json(res, 200, await naver.userinfo(req.headers)); return;
            }
            json(res, 405, { error: 'invalid_request' }); return;
          } catch (error) {
            json(res, error instanceof NaverAuthError ? error.status : 502,
              { error: error instanceof NaverAuthError ? error.code : 'provider_unavailable' }); return;
          }
        }
        if (path === '/api/auth/config') { json(res, 200, publicAuthConfig(env)); return; }
        if (path === '/api/status') { json(res, 200, { providers: service.status(), deployment: publicDeployment ? 'public-demo' : 'local',
          note: publicDeployment ? 'MusicBrainz is disabled here until a shared rate-limit queue is available. Server caches are instance-local.' : '' }); return; }
        if (path === '/api/starting-points') { json(res, 200, await startingPoints()); return; }
        if (path === '/api/track-preview') {
          json(res, 200, await previews.resolve(url.searchParams.get('provider'), url.searchParams.get('url'), url.searchParams.get('scope') || 'main')); return;
        }
        if (path === '/api/search') {
          const query = (url.searchParams.get('q') || '').trim();
          const scope = url.searchParams.get('scope') || 'all';
          if (query.length < 2 || query.length > 100 || !['all', 'spotify'].includes(scope)) {
            json(res, 400, { error: 'Search must contain 2–100 characters and a valid scope.' }); return;
          }
          json(res, 200, await service.search(query, { scope })); return;
        }
        if (path === '/api/artist') { json(res, 200, await service.artist(url.searchParams.get('id'))); return; }
        if (path === '/api/connections') {
          const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 4);
          if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 8) {
            json(res, 400, { error: 'Invalid page. A request may add at most 8 artists.' }); return;
          }
          const options = { name: (url.searchParams.get('name') || '').trim().slice(0, 100), offset, limit };
          if (url.searchParams.get('stream') === '1') {
            res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store',
              'Vercel-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no' });
            const controller = new AbortController(), closed = () => controller.abort();
            res.on('close', closed);
            try {
              await service.streamConnections(url.searchParams.get('id'), options, update => {
                if (!res.destroyed) res.write(`${JSON.stringify(update)}\n`);
              }, controller.signal);
            } catch (error) {
              if (!res.destroyed) { const safe = publicError(error); res.write(`${JSON.stringify({ error: safe.message, code: safe.code })}\n`); }
            } finally { res.off('close', closed); res.end(); }
            return;
          }
          json(res, 200, await service.connections(url.searchParams.get('id'), options)); return;
        }
        json(res, 404, { error: 'API route not found.' }); return;
      }
      const pathName = path === '/' ? '/index.html' : path;
      if (!files.has(pathName)) { res.writeHead(404).end('Not found'); return; }
      const data = await readFile(resolve(root, `.${pathName}`));
      res.writeHead(200, { 'Content-Type': `${types[extname(pathName)]}; charset=utf-8`, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (req.url?.startsWith('/api/')) {
        const detail = error instanceof ApiError && error.code === 'invalid_request' ? { code: error.code, message: error.message } : publicError(error);
        json(res, error instanceof ApiError ? (error.code === 'missing_credentials' ? 503 : error.status || 502) : 500,
          { error: detail.message, code: detail.code }); return;
      }
      res.writeHead(404).end('Not found');
    }
  };
}
