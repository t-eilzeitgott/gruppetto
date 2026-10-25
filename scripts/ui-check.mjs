// Automatischer UI-Check mit Playwright (lokal, nicht in CI):
//  - horizontales Überlaufen der Seite
//  - Elemente, deren Inhalt breiter ist als die Box (abgeschnittener/überstehender Text)
//  - Inhalte, die am Seitenende von Tab-Leiste oder Aktionsleiste verdeckt werden
// Nutzung: node scripts/build.mjs && node scripts/ui-check.mjs [--shots]
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

const SHOTS = process.argv.includes('--shots');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const VP = process.argv.find((a) => a.startsWith('--vp='))?.slice(5)?.split(',');
const THEMES = process.argv.find((a) => a.startsWith('--theme='))?.slice(8)?.split(',') ?? ['dark', 'light'];
const PORT = 4173;

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
  ['game', '?demo#/spiel'],
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
  ['impressum', '?demo#/impressum'],
  ['notfound', '?demo#/gibtsnicht'],
];

const VIEWPORTS = [
  ['320', { width: 320, height: 640 }, true],
  ['375', { width: 375, height: 667 }, true],
  ['390', { width: 390, height: 844 }, true],
  ['430', { width: 430, height: 932 }, true],
  ['768', { width: 768, height: 1024 }, true],
  ['1024', { width: 1024, height: 768 }, false],
  ['1440', { width: 1440, height: 900 }, false],
];

const browser = await chromium.launch();
if (SHOTS) await mkdir('screenshots', { recursive: true });
let problems = 0;

for (const theme of THEMES) {
  for (const [vpName, viewport, mobile] of VIEWPORTS) {
    if (VP && !VP.includes(vpName)) continue;
    const context = await browser.newContext({
      viewport, colorScheme: theme, locale: 'de-DE', timezoneId: 'Europe/Berlin',
      isMobile: mobile, hasTouch: mobile, deviceScaleFactor: SHOTS ? 2 : 1,
    });
    for (const [name, url, action, storage] of PAGES) {
      if (ONLY && !name.includes(ONLY)) continue;
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(`http://localhost:${PORT}/${url}`);
      await page.evaluate((s) => {
        localStorage.clear();
        if (s?.tour) localStorage.setItem('gruppetto.tour', s.tour);
        if (s?.adminTour) localStorage.setItem('gruppetto.adminTour', s.adminTour);
      }, storage ?? null);
      await page.reload();
      await page.waitForTimeout(700);
      await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 5000 }).catch(() => {});
      if (action) {
        await action(page);
        await page.waitForTimeout(500);
      }
      const result = await page.evaluate(() => {
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
          if (r.width > 0 && (r.right > vw + 1 || r.left < -1) && !el.closest('.table-scroll')) {
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
      });
      const all = [...result, ...errors.map((e) => `JS-Fehler: ${e}`)];
      if (all.length) {
        problems += all.length;
        console.log(`\n✗ ${theme} ${vpName} ${name}`);
        for (const i of [...new Set(all)].slice(0, 12)) console.log(`   ${i}`);
      }
      if (SHOTS) {
        // Für Ganzseiten-Screenshots die fixen Leisten ans Seitenende setzen
        await page.addStyleTag({ content: '.tabbar,.cta-bar{position:static!important}.shell{display:flex;flex-direction:column}' });
        await page.screenshot({ path: `screenshots/${vpName}-${theme}-${name}.png`, fullPage: true });
      }
      await page.close();
    }
    await context.close();
  }
}

await browser.close();
server.close();
console.log(problems ? `\n${problems} Auffälligkeiten.` : '\nKeine Auffälligkeiten.');
process.exit(problems ? 1 : 0);
