import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { createApplication } from './http-app.mjs';

try { loadEnvFile(fileURLToPath(new URL('.env', import.meta.url))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const server = createServer(createApplication());
server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`Artistree preview: http://localhost:${server.address().port}`));
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Preview port is already in use. Stop the previous preview or set PORT.' : 'Could not start the preview server.'); process.exitCode = 1; });
