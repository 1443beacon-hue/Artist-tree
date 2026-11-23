import { mkdir, readdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_FILES } from '../public-files.mjs';
import { FRAME_POLICY } from '../http-app.mjs';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, '.vercel/output'), marker = resolve(output, '.artistree-generated');
let contents = [];
try { contents = await readdir(output); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (contents.length) {
  let owned = false;
  try { owned = (await readFile(marker, 'utf8')).startsWith('Artistree'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!owned) throw new Error('Refusing to overwrite an unrecognized build output. Move .vercel/output aside first.');
  await rm(output, { recursive: true });
}
const staticRoot = resolve(output, 'static'), func = resolve(output, 'functions/artistree.func');
await mkdir(staticRoot, { recursive: true }); await mkdir(func, { recursive: true });
await writeFile(marker, 'Artistree generated deployment output. Safe to rebuild.\n');
const copy = async (file, dest) => { await mkdir(dirname(dest), { recursive: true }); await cp(resolve(root, file), dest); };
for (const file of PUBLIC_FILES) await copy(file, resolve(staticRoot, file));
// Server imports and data are private function files, never static routes.
for (const file of ['vercel-entry.mjs', 'http-app.mjs', 'public-files.mjs', 'artist-identity.js', 'credit-preview.js', 'package.json',
  'data/genius-artist-chart.json']) await copy(file, resolve(func, file));
for (const file of await readdir(resolve(root, 'api'))) {
  if (file.endsWith('.mjs') && !file.endsWith('.test.mjs')) await copy(`api/${file}`, resolve(func, 'api', file));
}
// Bundle the function, not all of node_modules (which includes local test tools).
await build({
  entryPoints: [resolve(root, 'vercel-entry.mjs')], outfile: resolve(func, 'vercel-entry.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: ['node24'],
  external: ['ws', '@aws-sdk/credential-provider-web-identity'],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" }
});
await writeFile(resolve(func, '.vc-config.json'), JSON.stringify({
  runtime: 'nodejs24.x', handler: 'vercel-entry.mjs', launcherType: 'Nodejs',
  maxDuration: 60, regions: ['icn1'], supportsResponseStreaming: true, shouldAddHelpers: false
}, null, 2));
await writeFile(resolve(staticRoot, '404.html'), '<!doctype html><html lang="en"><title>Not found</title><body><h1>Not found</h1><a href="/">Back to Artistree</a></body></html>');
await writeFile(resolve(output, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    { src: '/(.*)', headers: { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin',
      'Content-Security-Policy': FRAME_POLICY }, continue: true },
    { src: '/api(?:/.*)?', dest: '/artistree' },
    { handle: 'filesystem' },
    { src: '/.*', dest: '/404.html', status: 404 }
  ]
}, null, 2));
await writeFile(marker, 'Artistree generated deployment output. Safe to rebuild.\n');
console.log(`Built ${PUBLIC_FILES.length} public files and one private, streaming API function.`);
