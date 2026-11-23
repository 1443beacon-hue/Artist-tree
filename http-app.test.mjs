import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createApplication } from './http-app.mjs';

test('public handlers expose only public auth config and allowlisted files, enforcing host and origin boundaries', async () => {
  const env = { PUBLIC_APP_ORIGIN: 'https://artistree.example', VERCEL: '1',
    SUPABASE_URL: 'https://artistree-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public-test-key',
    ARTISTREE_AUTH_PROVIDERS: 'google', GOOGLE_CLIENT_SECRET: 'private-oauth-secret', SUPABASE_SERVICE_ROLE_KEY: 'private-role-secret' };
  const server = createServer(createApplication({ env, publicDeployment: true }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  // Node fetch manages Host itself; raw HTTP lets this test exercise host checks.
  const get = (path, headers = {}) => new Promise((resolve, reject) => {
    const req = request(`${root}${path}`, { headers: { Host: 'artistree.example', ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on('error', reject); req.end();
  });
  try {
    const response = await get('/api/auth/config');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const data = await response.text();
    assert.match(data, /google/); assert.doesNotMatch(data, /private-oauth|private-role/);
    assert.equal((await get('/')).status, 200);
    assert.equal((await get('/account-session.js')).status, 200);
    for (const path of ['/.env', '/api/auth-config.mjs', '/http-app.mjs', '/package.json', '/supabase/migrations/test.sql', '/presentation/README.md']) {
      assert.equal((await get(path)).status, 404);
    }
    assert.equal((await get('/api/auth/config', { Origin: 'https://attacker.example' })).status, 403);
    assert.equal((await get('/api/auth/config', { Host: 'attacker.example' })).status, 403);
    assert.equal((await get('/api/auth/naver/token')).status, 405);
    assert.equal((await get('/api/auth/naver/authorize')).status, 503);
    const status = await (await get('/api/status')).json();
    assert.equal(status.providers.find(provider => provider.id === 'musicbrainz').configured, false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
