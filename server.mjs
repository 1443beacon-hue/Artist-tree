import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { loadEnvFile } from 'node:process';
import { createProviders } from './api/providers.mjs';
import { createMusicService } from './api/service.mjs';
import { ApiError, publicError } from './api/http.mjs';
import { createStartingPointsService } from './api/starting-points.mjs';
import { createTrackPreviewService } from './api/track-preview.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
try { loadEnvFile(resolve(root, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const publicFiles = new Set(['/index.html', '/styles.css', '/app.js', '/explorer-state.js', '/live-client.js', '/artist-identity.js', '/graph-layout.js', '/graph-interaction.js', '/intro-network.js', '/lookup-feedback.js', '/saved-maps.js', '/saved-maps-ui.js', '/credit-preview.js', '/track-player.js', '/assets/spotify-logo.svg']);
const providers = createProviders();
const service = createMusicService(providers);
const trackPreviews = createTrackPreviewService(providers, { storefront: process.env.APPLE_MUSIC_STOREFRONT });
const startingPoints = createStartingPointsService(providers.genius, { loadSnapshot: async () => {
  const path = process.env.GENIUS_ARTIST_CHART_FILE?.trim() || 'data/genius-artist-chart.json';
  const data = await readFile(resolve(root, path), 'utf8');
  if (data.length > 16_384) throw new Error('Chart snapshot is too large.');
  return JSON.parse(data);
} });
const clients = new Map();
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (!['GET', 'HEAD'].includes(req.method)) { json(res, 405, { error: 'Only GET requests are supported.' }); return; }
    const host = new URL(`http://${req.headers.host}`).hostname;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) { json(res, 403, { error: 'Local requests only.' }); return; }
    if (pathname.startsWith('/api/')) {
      if (req.headers.origin && ![`http://${req.headers.host}`, `https://${req.headers.host}`].includes(req.headers.origin)) {
        json(res, 403, { error: 'Cross-origin API requests are not permitted.' }); return;
      }
      const client = req.socket.remoteAddress;
      let quota = clients.get(client);
      if (!quota || quota.until < Date.now()) { quota = { count: 0, until: Date.now() + 60_000 }; clients.set(client, quota); }
      if (++quota.count > 60) { json(res, 429, { error: 'Too many local requests. Please wait a minute.' }); return; }
      if (pathname === '/api/status') { json(res, 200, { providers: service.status() }); return; }
      if (pathname === '/api/starting-points') { json(res, 200, await startingPoints()); return; }
      if (pathname === '/api/track-preview') {
        json(res, 200, await trackPreviews.resolve(url.searchParams.get('provider'), url.searchParams.get('url'), url.searchParams.get('scope') || 'main')); return;
      }
      if (pathname === '/api/search') {
        const query = (url.searchParams.get('q') || '').trim();
        if (query.length < 2 || query.length > 100) { json(res, 400, { error: 'Search must contain 2–100 characters.' }); return; }
        const scope = url.searchParams.get('scope') || 'all';
        if (!['all', 'spotify'].includes(scope)) { json(res, 400, { error: 'Invalid search scope.' }); return; }
        json(res, 200, await service.search(query, { scope })); return;
      }
      if (pathname === '/api/artist') {
        json(res, 200, await service.artist(url.searchParams.get('id'))); return;
      }
      if (pathname === '/api/connections') {
        const offset = Number(url.searchParams.get('offset') || 0);
        const limit = Number(url.searchParams.get('limit') || 4);
        const name = (url.searchParams.get('name') || '').trim().slice(0, 100);
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 8) {
          json(res, 400, { error: 'Invalid page. A request may add at most 8 artists.' }); return;
        }
        const options = { name, offset, limit };
        if (url.searchParams.get('stream') === '1') {
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no' });
          const controller = new AbortController();
          const closed = () => controller.abort();
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
    const publicPath = pathname === '/' ? '/index.html' : pathname;
    if (!publicFiles.has(publicPath)) { res.writeHead(404).end('Not found'); return; }
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep) || !['.html', '.css', '.js', '.svg'].includes(extname(file))) {
      res.writeHead(404).end('Not found');
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': `${types[extname(file)]}; charset=utf-8`, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    if (req.url?.startsWith('/api/')) {
      const detail = error instanceof ApiError && error.code === 'invalid_request' ? { code: error.code, message: error.message } : publicError(error);
      json(res, error instanceof ApiError ? (['missing_credentials'].includes(error.code) ? 503 : error.status || 502) : 500, { error: detail.message, code: detail.code });
      return;
    }
    if (!res.headersSent) res.writeHead(404);
    res.end('Not found');
  }
});
server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`Artistree preview: http://localhost:${server.address().port}`));
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Preview port is already in use. Stop the previous preview or set PORT.' : 'Could not start the preview server.'); process.exitCode = 1; });
