// Automatischer UI-Check mit Playwright (lokal, nicht in CI):
//  - horizontales Überlaufen der Seite
//  - Elemente, deren Inhalt breiter ist als die Box (abgeschnittener/überstehender Text)
//  - Inhalte, die am Seitenende von Tab-Leiste oder Aktionsleiste verdeckt werden
// Nutzung: node scripts/build.mjs && node scripts/ui-check.mjs [--quick] [--shots] [--only=name] [--vp=390,430] [--theme=dark] [--jobs=2]
// Läuft parallel (eine Seite je Bildschirmgröße und Thema gleichzeitig, Standard: Anzahl CPU-Kerne).
// Das Spiel läuft ohne 3D (?nogl, mit --shots in winziger Auflösung ?lowgfx); den Spielablauf steuert der Check direkt.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { availableParallelism } from 'node:os';

const SHOTS = process.argv.includes('--shots');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
// --quick: kleinstes Handy, typisches Handy, Desktop – nur dunkel (etwa eine Minute)
const QUICK = process.argv.includes('--quick');
const VP = process.argv.find((a) => a.startsWith('--vp='))?.slice(5)?.split(',') ?? (QUICK ? ['320', '390', '1024'] : undefined);
const THEMES = process.argv.find((a) => a.startsWith('--theme='))?.slice(8)?.split(',') ?? (QUICK ? ['dark'] : ['dark', 'light']);
const JOBS = Number(process.argv.find((a) => a.startsWith('--jobs='))?.slice(7)) || Math.max(1, availableParallelism());
// Spiel ohne 3D prüfen (schnell); für Screenshots mit 3D in winziger Auflösung
const GFX = SHOTS ? 'lowgfx' : 'nogl';
const PORT = 4173 + Math.floor(Math.random() * 500);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  try {
    const path = (req.url ?? '/').split('?')[0];
    const file = join('dist', path.endsWith('/') ? `${path}index.html` : path);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(PORT);

const PAGES = [
  ['login', '?demo=login#/'],
  ['login-code', '?demo=login#/', async (p) => { await p.fill('#login-email', 'christoph@beispiel.de'); await p.click('button[type=submit]'); await p.waitForSelector('#login-code'); }],
  ['install-ios', '?demo=login&install=ios#/'],
  ['install-android', '?demo=login&install=android#/'],
  ['join', '?demo=join#/'],
  ['home', '?demo#/'],
  ['home-running', '?demo&demotime=2027-05-16T15:00#/'],
  ['home-upcoming', '?demo#/', null, { tour: 'tour-2027' }],
  ['home-finished', '?demo&demotime=2027-06-02T10:00#/'],
  ['stages', '?demo#/etappen'],
  ['stage-open', '?demo#/etappe/1009'],
  ['stage-running', '?demo&demotime=2027-05-16T15:00#/etappe/1009'],
  ['stage-done', '?demo#/etappe/1003'],
  ['tip', '?demo#/tipp/1009'],
  ['tip-search', '?demo#/tipp/1009', async (p) => { await p.fill('input[type=search]', 'van'); }],
  ['bonus', '?demo#/bonus'],
  ['bonus-all', '?demo#/bonus', async (p) => { await p.click('text=Alle Tipps'); }],
  ['bonus-open', '?demo#/bonus', null, { tour: 'tour-2027' }],
  ['board', '?demo#/rangliste'],
  ['board-season', '?demo#/rangliste', async (p) => { await p.click('.segmented >> text=Saison'); }],
  ['rider', '?demo#/fahrer/1'],
  ['riders-dir', '?demo#/fahrer'],
  ['riders-dir-open', '?demo#/fahrer', async (p) => { await p.click('.rider-dir__main >> nth=0'); }],
  ['climbs-dir', '?demo#/anstiege'],
  ['climbs-dir-open', '?demo#/anstiege', async (p) => { await p.click('.profile-points__btn >> nth=3'); }],
  ['tip-sheet', '?demo#/tipp/1009', async (p) => { await p.click('.rider-info >> nth=0'); }],
  ['stage-climb-open', '?demo#/etappe/1009', async (p) => { await p.click('.profile-points__btn >> nth=1'); }],
  ['rider-out', '?demo#/fahrer/64'],
  ['stage-profile', '?demo#/etappe/1004'],
  ['tip-profile', '?demo#/tipp/1009', async (p) => { await p.click('.profile-mini > summary'); }],
  ['game', `?demo&${GFX}#/spiel`],
  ['game-board', `?demo&${GFX}#/spiel`, async (p) => { await p.click('.abf-link'); }],
  ['game-hud', `?demo&${GFX}#/spiel`, async (p) => { await p.click('text=Losfahren'); await runGame(p, 4); }],
  ['game-over', `?demo&${GFX}#/spiel`, async (p) => {
    await p.click('text=Losfahren');
    // Countdown und Sturz direkt durchrechnen statt in Echtzeit abzuwarten
    await runGame(p, 4);
    await p.evaluate(() => window.__abfahrt.engine().crash('Muuuh – Kuh erwischt'));
    await runGame(p, 3);
    await p.waitForSelector('.abf-summary', { timeout: 20000 });
    await p.waitForTimeout(1700); // Punkte zählen hoch
  }],
  ['sprint', `?demo&${GFX}#/spiel/sprint`],
  ['sprint-board', `?demo&${GFX}#/spiel/sprint`, async (p) => { await p.click('.abf-link'); }],
  ['sprint-hud', `?demo&${GFX}#/spiel/sprint`, async (p) => { await p.click('text=Losfahren'); await runGame(p, 8); }],
  ['sprint-over', `?demo&${GFX}#/spiel/sprint`, async (p) => {
    await p.click('text=Losfahren');
    // ganzes Rennen durchrechnen, 230 m vor dem Ziel antreten
    await p.evaluate(() => {
      const g = window.__abfahrt.engine();
      for (let i = 0; i < 60 * 240 && g.phase !== 'over'; i++) { g.key('up', 2400 - g.p.z < 230); g.update(1 / 60); }
    });
    await p.waitForSelector('.abf-summary', { timeout: 20000 });
    await p.waitForTimeout(1700);
  }],
  ['garage', `?demo&${GFX}#/spiel/garage`],
  ['garage-locked', `?demo&${GFX}#/spiel/garage`, async (p) => { await p.click('.garage__item >> nth=6'); }],
  ['berg', `?demo&${GFX}#/spiel/berg`],
  ['berg-board', `?demo&${GFX}#/spiel/berg`, async (p) => { await p.click('.abf-link'); }],
  ['berg-hud', `?demo&${GFX}#/spiel/berg`, async (p) => { await p.click('text=Losfahren'); await runGame(p, 8); }],
  ['berg-over', `?demo&${GFX}#/spiel/berg`, async (p) => {
    await p.click('text=Losfahren');
    // ganzes Rennen durchrechnen, 250 m vor dem Gipfel angreifen
    await p.evaluate(() => {
      const g = window.__abfahrt.engine();
      for (let i = 0; i < 60 * 300 && g.phase !== 'over'; i++) { g.key('up', g.p.z > 650 && g.p.z < 900); g.update(1 / 60); }
    });
    await p.waitForSelector('.abf-summary', { timeout: 20000 });
    await p.waitForTimeout(1700);
  }],
  ['player', '?demo#/spieler/u-felix'],
  ['player-me', '?demo#/spieler/u-christoph'],
  ['profile', '?demo#/profil'],
  ['profile-edit', '?demo#/profil', async (p) => { await p.click('text=Bearbeiten'); }],
  ['admin', '?demo#/admin'],
  ['admin-tours', '?demo#/admin/rundfahrten'],
  ['admin-stages', '?demo#/admin/etappen'],
  ['admin-stage-edit', '?demo#/admin/etappen', async (p) => { await p.click('.admin-stage >> nth=8'); }],
  ['admin-generator', '?demo#/admin/etappen', null, { adminTour: 'tour-2027' }],
  ['admin-riders', '?demo#/admin/startliste'],
  ['admin-results', '?demo#/admin/ergebnis'],
  ['admin-bonus', '?demo#/admin/bonus'],
  ['admin-members', '?demo#/admin/mitglieder'],
  ['admin-sync', '?demo#/admin/automatik'],
  ['impressum', '?demo#/impressum'],
  ['notfound', '?demo#/gibtsnicht'],
];

/** Spiel um t Sekunden weiterrechnen (unabhängig von der Bildrate des Testbrowsers) */
async function runGame(p, t) {
  await p.evaluate((t) => { const g = window.__abfahrt.engine(); for (let i = 0; i < t * 60; i++) g.update(1 / 60); }, t);
  await p.waitForTimeout(250);
}

const VIEWPORTS = [
  ['320', { width: 320, height: 640 }, true],
  ['375', { width: 375, height: 667 }, true],
  ['390', { width: 390, height: 844 }, true],
  ['430', { width: 430, height: 932 }, true],
  ['768', { width: 768, height: 1024 }, true],
  ['1024', { width: 1024, height: 768 }, false],
  ['1440', { width: 1440, height: 900 }, false],
];

/** Prüfung im Browser: Überlauf, abgeschnittener Text, Ellipsen, Elemente außerhalb, Verdecktes am Seitenende */
const CHECK = () => {
  const issues = [];
  const vw = window.innerWidth;
  if (document.documentElement.scrollWidth > vw + 1) {
    issues.push(`Seite scrollt horizontal (${document.documentElement.scrollWidth}px > ${vw}px)`);
  }
  const skip = 'svg, svg *, path, input, select, textarea, option, .sr-only, .table-scroll *, script, style';
  for (const el of document.querySelectorAll('body *')) {
    if (el.matches(skip)) continue;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || el.clientWidth === 0) continue;
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const tag = `<${el.tagName.toLowerCase()} class="${el.className}">`;
    const scrolls = st.overflowX === 'auto' || st.overflowX === 'scroll';
    const clips = st.overflowX === 'hidden' || st.overflowX === 'clip';
    if (clips && el.scrollWidth > el.clientWidth + 1 && !el.matches('.progress')) {
      issues.push(`Abgeschnitten: ${tag} ${el.scrollWidth}>${el.clientWidth} „${txt}“`);
    }
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (ownText && !scrolls && el.scrollWidth > el.clientWidth + 1) {
      issues.push(`Text breiter als Box: ${tag} ${el.scrollWidth}>${el.clientWidth} „${txt}“`);
    }
    if (ownText && st.textOverflow === 'ellipsis') issues.push(`Ellipse: ${tag} „${txt}“`);
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > vw + 1 || r.left < -1) && !el.closest('.table-scroll, .games-scroller, .garage__list')) {
      issues.push(`Ragt aus dem Bildschirm: ${tag} ${Math.round(r.left)}–${Math.round(r.right)} „${txt.slice(0, 40)}“`);
    }
  }
  // Am Seitenende darf nichts unter fixen Leisten liegen
  window.scrollTo(0, document.documentElement.scrollHeight);
  const bars = [...document.querySelectorAll('.tabbar, .cta-bar')].filter((b) => getComputedStyle(b).display !== 'none');
  if (bars.length) {
    const top = Math.min(...bars.map((b) => b.getBoundingClientRect().top));
    const content = [...document.querySelectorAll('main *')].filter((e) => {
      const s = getComputedStyle(e);
      return s.display !== 'none' && e.getBoundingClientRect().height > 0 && !e.closest('.cta-bar');
    });
    const lowest = Math.max(...content.map((e) => e.getBoundingClientRect().bottom));
    if (lowest > top + 1) issues.push(`Inhalt am Ende verdeckt: ${Math.round(lowest)} > Leiste ${Math.round(top)}`);
  }
  window.scrollTo(0, 0);
  return issues;
};

const browser = await chromium.launch();
if (SHOTS) await mkdir('screenshots', { recursive: true });
let problems = 0;
const started = Date.now();

async function checkPage(context, theme, vpName, [name, url, action, storage]) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // Startzustand vor dem Laden setzen: eine Ladung statt laden, leeren, neu laden
  await page.addInitScript((s) => {
    if (sessionStorage.getItem('__ui')) return;
    sessionStorage.setItem('__ui', '1');
    localStorage.clear();
    // ohne App-Intro prüfen (es liegt sonst die ersten 1–2 s über allem)
    localStorage.setItem('gruppetto.nointro', '1');
    if (s?.tour) localStorage.setItem('gruppetto.tour', s.tour);
    if (s?.adminTour) localStorage.setItem('gruppetto.adminTour', s.adminTour);
  }, storage ?? null);
  await page.goto(`http://localhost:${PORT}/${url}`);
  await page.waitForFunction(() => document.querySelector('#root')?.children.length && !document.querySelector('.loading'), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(150);
  if (action) {
    await action(page);
    await page.waitForTimeout(250);
  }
  const result = await page.evaluate(CHECK);
  const all = [...result, ...errors.map((e) => `JS-Fehler: ${e}`)];
  let out = '';
  if (all.length) {
    problems += all.length;
    out += `\n✗ ${theme} ${vpName} ${name}\n`;
    for (const i of [...new Set(all)].slice(0, 12)) out += `   ${i}\n`;
  }
  if (SHOTS) {
    // Für Ganzseiten-Screenshots die fixen Leisten ans Seitenende setzen
    await page.addStyleTag({ content: '.tabbar,.cta-bar{position:static!important}.shell{display:flex;flex-direction:column}' });
    await page.screenshot({ path: `screenshots/${vpName}-${theme}-${name}.png`, fullPage: true });
  }
  await page.close();
  return out;
}

const combos = [];
for (const theme of THEMES) for (const [vpName, viewport, mobile] of VIEWPORTS) if (!VP || VP.includes(vpName)) combos.push({ theme, vpName, viewport, mobile });
const pages = PAGES.filter(([name]) => !ONLY || name.includes(ONLY));
const queue = combos.map((c) => ({ ...c }));

async function worker() {
  for (let c = queue.shift(); c; c = queue.shift()) {
    const context = await browser.newContext({
      viewport: c.viewport, colorScheme: c.theme, locale: 'de-DE', timezoneId: 'Europe/Berlin',
      isMobile: c.mobile, hasTouch: c.mobile, deviceScaleFactor: SHOTS ? 2 : 1,
    });
    let out = '';
    for (const p of pages) {
      try { out += await checkPage(context, c.theme, c.vpName, p); } catch (e) { problems++; out += `\n✗ ${c.theme} ${c.vpName} ${p[0]}\n   Check fehlgeschlagen: ${String(e).split('\n')[0]}\n`; }
    }
    if (out) process.stdout.write(out);
    await context.close();
  }
}
await Promise.all(Array.from({ length: Math.min(JOBS, combos.length) }, worker));
console.log(`\n${combos.length * pages.length} Prüfungen in ${Math.round((Date.now() - started) / 1000)} s`);

await browser.close();
server.close();
console.log(problems ? `\n${problems} Auffälligkeiten.` : '\nKeine Auffälligkeiten.');
process.exit(problems ? 1 : 0);
