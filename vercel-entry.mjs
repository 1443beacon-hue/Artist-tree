import { waitUntil } from '@vercel/functions';
import { createApplication } from './http-app.mjs';

// Environment variables stay server-side. Never load/upload the local .env.
const env = { ...process.env, VERCEL: '1' };
export default createApplication({ env, publicDeployment: true, retain: waitUntil });
