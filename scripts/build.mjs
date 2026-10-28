// Baut die App nach dist/ (esbuild, ohne weitere Werkzeuge).
// Umgebungsvariablen: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY (oder VITE_SUPABASE_ANON_KEY), BUILD_ID
// Mit --serve wird dist/ danach unter http://localhost:5173 ausgeliefert.
import * as esbuild from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const serve = process.argv.includes('--serve');
const outdir = 'dist';

const url = process.env.VITE_SUPABASE_URL ?? '';
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const buildId = process.env.BUILD_ID ?? new Date().toISOString().slice(0, 16).replace('T', ' ');

await rm(outdir, { recursive: true, force: true });
await mkdir(`${outdir}/assets`, { recursive: true });

const result = await esbuild.build({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  minify: !serve,
  sourcemap: serve,
  format: 'esm',
  target: ['es2020', 'safari15', 'chrome100', 'firefox100'],
  outdir: `${outdir}/assets`,
  entryNames: 'app-[hash]',
  chunkNames: 'chunk-[hash]',
  splitting: true,
  jsx: 'automatic',
  alias: { three: './vendor/three/three.module.js' },
  legalComments: 'none',
  metafile: true,
  logLevel: 'info',
  define: {
    __SUPABASE_URL__: JSON.stringify(url),
    __SUPABASE_KEY__: JSON.stringify(key),
    __BUILD_ID__: JSON.stringify(buildId),
    'process.env.NODE_ENV': JSON.stringify(serve ? 'development' : 'production'),
  },
});

const outputs = Object.keys(result.metafile.outputs);
// das Hauptskript: der Eintrag zu src/main.tsx (auch Chunks für import() tragen einen entryPoint – nicht der erste beste)
const js = outputs.find((f) => f.endsWith('.js') && /(^|\/)main\.tsx$/.test(result.metafile.outputs[f].entryPoint ?? ''))
  ?? outputs.find((f) => /\/app-[^/]+\.js$/.test(f));
const css = outputs.find((f) => f.endsWith('.css') && f.includes('app-'));
const rel = (p) => p.replace(`${outdir}/`, '');

// Startansicht: dieselben Platzhalter wie in der App, statisch in index.html (sichtbar, bevor das Skript läuft)
await esbuild.build({
  entryPoints: ['scripts/boot.tsx'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: `${outdir}/.boot.mjs`,
  packages: 'external',
  jsx: 'automatic',
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"', __SUPABASE_URL__: JSON.stringify(url), __SUPABASE_KEY__: JSON.stringify(key), __BUILD_ID__: JSON.stringify(buildId) },
});
const { bootHtml } = await import(`../${outdir}/.boot.mjs?${Date.now()}`);
const boot = bootHtml(!url);
await rm(`${outdir}/.boot.mjs`, { force: true });

let html = await readFile('index.html', 'utf8');
html = html
  .replace('<!--CSS-->', css ? `<link rel="stylesheet" href="${rel(css)}">` : '')
  .replace('<!--JS-->', `<script type="module" src="${rel(js)}"></script>`)
  .replace('<!--BOOT-->', boot)
  // dezente Versionsnummer im Intro: „v56“ (Lauf-Nummer im Deploy), lokal Datum und Uhrzeit
  .replace('<!--VERSION-->', /^\d+$/.test(buildId) ? `v${buildId}` : buildId)
  .replace('/*LIVE*/false', url ? 'true' : 'false');
await writeFile(`${outdir}/index.html`, html);
await cp('public', outdir, { recursive: true });

console.log(`\nBuild fertig (${url ? 'mit Supabase' : 'Demo-Modus, keine Supabase-Variablen'}) → ${outdir}/`);

if (serve) {
  const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.map': 'application/json',
  };
  createServer(async (req, res) => {
    try {
      const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
      const file = join(outdir, path.endsWith('/') ? `${path}index.html` : path);
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  }).listen(5173, () => console.log('→ http://localhost:5173/'));
}
