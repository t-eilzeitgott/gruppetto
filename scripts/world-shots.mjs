// Prüfbilder aus dem Welt-Editor: stellt die Kamera jeder Notiz eines Exports nach und speichert ein Bild.
// So lässt sich jede markierte Stelle („Loch in der Wand bei 1.240 m“) ohne Handy wieder ansehen.
//
// Nutzung: node scripts/build.mjs && node scripts/world-shots.mjs <export.json> [--out=screenshots/welt] [--vp=390,844]
//          [--holes] (Löcher-Prüfmodus: Himmel unter dem Horizont magenta) [--frames=60] [--at=abfahrt:2026-10-28:1240]
// Der Export kommt aus Admin → Welt → Export (Datei) oder aus der Tabelle world_edits:
//   select data from world_edits where key = 'abfahrt:2026-10-28';
// --at: ohne Export eine Stelle der Strecke ansehen (Spiel:Tag:Streckenmeter), Kamera 9 m dahinter.
// Läuft im Demo-Modus (ohne Datenbank), die Änderungen des Exports werden vor dem Laden in den Browser gelegt.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = opt('out', 'screenshots/welt');
const [VW, VH] = opt('vp', '390,844').split(',').map(Number);
const HOLES = args.includes('--holes');
const FRAMES = Number(opt('frames', '60'));
const AT = opt('at', null);
if (!file && !AT) {
  console.error('Export-Datei angeben (JSON aus Admin → Welt → Export) oder --at=spiel:tag:meter');
  process.exit(1);
}
const edits = file ? JSON.parse(await readFile(file, 'utf8')) : null;

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const PORT = 4600 + Math.floor(Math.random() * 300);
const server = createServer(async (req, res) => {
  try {
    const path = (req.url ?? '/').split('?')[0];
    const f = join('dist', path.endsWith('/') ? `${path}index.html` : path);
    res.writeHead(200, { 'Content-Type': types[extname(f)] ?? 'application/octet-stream' });
    res.end(await readFile(f));
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(PORT);

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('Seitenfehler:', String(e)));
await page.addInitScript((e) => {
  localStorage.setItem('gruppetto.nointro', '1');
  localStorage.setItem('gruppetto.nowarm', '1');
  if (e) localStorage.setItem(`gruppetto.world.${e.key}`, JSON.stringify(e));
}, edits);
await page.goto(`http://localhost:${PORT}/?demo&shots#/admin/welt`);
await page.waitForFunction(() => !!window.__world, null, { timeout: 20000 });

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9äöü]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const open = async (game, day) => {
  await page.evaluate(([g, d]) => window.__world.open(g, d), [game, day]);
  await page.waitForTimeout(400);
  await page.waitForFunction(([g, d]) => window.__world?.edits().key === `${g}:${d}`, [game, day], { timeout: 20000 });
  await page.waitForTimeout(300);
  if (HOLES) await page.evaluate(() => window.__world.holes(true));
};
const shoot = async (name, cam) => {
  await page.evaluate((c) => window.__world.setCam(...c), cam);
  // das Bild kommt direkt von der Leinwand (ein Seiten-Screenshot braucht im Software-Rendering minutenlang)
  const url = await page.evaluate((n) => window.__world.snapshot(n), FRAMES);
  const path = join(OUT, `${name}.png`);
  await writeFile(path, Buffer.from(url.split(',')[1], 'base64'));
  console.log(path);
};

if (edits) {
  const [game, day] = edits.key.split(':');
  await open(game, day);
  const notes = edits.notes ?? [];
  if (!notes.length) console.log('Keine Notizen im Export – nur die Startansicht.');
  let i = 0;
  for (const n of notes) {
    i += 1;
    console.log(`Notiz ${i}: „${n.text}“ bei ${Math.round(n.track.z)} m`);
    await shoot(`${edits.key.replace(':', '-')}-${String(i).padStart(2, '0')}-${slug(n.text)}`, n.cam);
  }
  if (!notes.length) {
    const cam = await page.evaluate(() => { const c = window.__world.cam; return [c.x, c.y, c.z, c.x + Math.sin(c.yaw), c.y + Math.sin(c.pitch), c.z - Math.cos(c.yaw)]; });
    await shoot(`${edits.key.replace(':', '-')}-start`, cam);
  }
}
if (AT) {
  const [game, day, z] = AT.split(':');
  await open(game, day);
  const cam = await page.evaluate((zz) => {
    const w = { x: 0, y: 0, z: 0, th: 0 };
    const t = window.__world.track;
    t.world(Number(zz), 0, 0, w);
    const x = w.x - Math.sin(w.th) * 9, y = w.y + 4, zc = w.z + Math.cos(w.th) * 9;
    return [x, y, zc, x + Math.sin(w.th), y - 0.14, zc - Math.cos(w.th)];
  }, z);
  await shoot(`${game}-${day}-${z}m`, cam);
}
await browser.close();
server.close();
