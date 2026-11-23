import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

await build({
  stdin: { contents: "export { createClient } from '@supabase/supabase-js';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, platform: 'browser', format: 'esm', target: ['es2022'], minify: true,
  outfile: fileURLToPath(new URL('../assets/supabase.js', import.meta.url)),
  legalComments: 'eof', sourcemap: false
});
