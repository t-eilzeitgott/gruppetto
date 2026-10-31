/**
 * Grafik der 3D-Spiele: eine Stufe von 1 (Minimal, für langsame Geräte) bis 10 (PC) – und davon ganz getrennt die
 * Auflösung (Pixeldichte, fest; keine automatische Regelung). Beides im Pausenmenü und im Profil als Schieberegler,
 * das Gerät merkt sich die Wahl. Ohne three.js (die leichten Spiele laden das Menü auch).
 *
 * Was die Stufen schalten (die Bausteine lesen weiter einzelne Schalter, gfxOn):
 *  - Sichtweite: Einfach (Minimal) · Kurz · Normal · Weit · Max · Ultra · Extrem (viewRange.ts)
 *  - lite (Stufe 1–2): schlichte Fahrer (eigener in einfacher Detailstufe, weniger 3D-Modelle), ruhiger Himmel ohne
 *    Wolkentürme und Vögel, ohne Weichzeichner unter Namensschildern, notfalls gleichmäßige 30 Bilder je Sekunde
 *  - Kantenglättung (ab Stufe 3; gilt ab dem nächsten Spielstart, sie gehört zur Bühne)
 *  - schatten (ab 6): Sonnenschatten (ein zweiter Zeichendurchgang je Bild)
 *  - details (ab 7): feine Landschafts-Shader – Relief im Licht, Baumkronen mit Licht und Schatten, Felsstruktur,
 *    Rinnen und Schichten, ziehende Wolkenschatten, Flecken im Straßenbelag (siehe render3d.ts)
 *  - licht (ab 8): Wetter und Licht der Spielwelten (Goldene Stunde, Wetterumschwung, Nebel am Pass) mit der
 *    Nachbearbeitung (Leuchten, Lichtstrahlen, Wolken, Farbfilter, Vignette, Korn) und dem leichten Kamerafilter
 *  - pc (10): PC-Grafik – feinere Berge am Horizont, Gras am Wegrand, schärfere Bäume, alle Fahrer in voller
 *    Detailstufe, große weiche Schatten (pcgfx.ts); gilt ab dem nächsten Spielstart
 *
 * Aus der Adresse (zum Prüfen, wird nicht gespeichert): ?stufe=1…10, ?gfx=einfach|aus|alle|pc (1, 5, 9, 10),
 * ?aufl=1.5 (Pixeldichte).
 */

export type GfxOpt = 'pc' | 'lite' | 'licht' | 'schatten' | 'details';
/** Sichtweite einer Stufe (viewRange.ts; lite = die eigene, kürzeste der Stufe 1) */
export type GfxRange = 'lite' | 'eco' | 'normal' | 'far' | 'max' | 'ultra' | 'extreme';

export interface GfxLevel {
  name: string;
  range: GfxRange;
  lite: boolean;
  aa: boolean;
  schatten: boolean;
  details: boolean;
  licht: boolean;
  pc: boolean;
}

const L = (name: string, range: GfxRange, o: Partial<GfxLevel> = {}): GfxLevel =>
  ({ name, range, lite: false, aa: true, schatten: false, details: false, licht: false, pc: false, ...o });

/** Stufe 1 … 10 (Index 0 … 9) */
export const GFX_LEVELS: GfxLevel[] = [
  L('Minimal', 'lite', { lite: true, aa: false }),
  L('Sehr niedrig', 'eco', { lite: true, aa: false }),
  L('Niedrig', 'eco'),
  L('Mittel', 'normal'),
  L('Gut', 'far'),
  L('Standard', 'max', { schatten: true }),
  L('Hoch', 'max', { schatten: true, details: true }),
  L('Sehr hoch', 'max', { schatten: true, details: true, licht: true }),
  L('Ultra', 'ultra', { schatten: true, details: true, licht: true }),
  L('PC', 'extreme', { schatten: true, details: true, licht: true, pc: true }),
];
export const GFX_MIN = 1;
export const GFX_MAX = GFX_LEVELS.length;

const RANGE_LABEL: Record<GfxRange, string> = { lite: 'kürzeste Sicht', eco: 'kurze Sicht', normal: 'normale Sicht', far: 'weite Sicht', max: 'sehr weite Sicht', ultra: 'Sicht ultra', extreme: 'Sicht extrem' };

/** in Worten, was die Stufe zeigt (für den Schieberegler) */
export function gfxLevelText(n: number): string {
  const l = GFX_LEVELS[clampLevel(n) - 1];
  const parts = [RANGE_LABEL[l.range]];
  if (l.lite) parts.push('schlichte Fahrer und Himmel');
  if (!l.aa) parts.push('ohne Kantenglättung');
  if (l.schatten) parts.push('Sonnenschatten');
  if (l.details) parts.push('Landschaftsdetails');
  if (l.licht) parts.push('Licht & Wetter');
  if (l.pc) parts.push('feinste Details');
  return parts.join(' · ');
}

/** für Messberichte: „Stufe 6 (Standard): sehr weite Sicht · Sonnenschatten“ */
export function gfxDescribe(): string {
  return `Stufe ${level} (${GFX_LEVELS[level - 1].name}): ${gfxLevelText(level)}`;
}

const K_LEVEL = 'gruppetto.gfx.stufe';
const K_RES = 'gruppetto.gfx.aufl';

const clampLevel = (n: number) => Math.max(GFX_MIN, Math.min(GFX_MAX, Math.round(n) || 6));

function lsGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function lsSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* egal */ }
}
function search(): string {
  try { return window.location.search; } catch { return ''; }
}

/**
 * Sieht das Gerät nach einem Rechner mit eigener Grafik aus? Kein Telefon oder Tablet (auch kein iPad, das sich als
 * Mac meldet), feiner Zeiger (Maus), großer Bildschirm – und keine schwache oder Software-Grafik.
 */
export function looksLikePc(): boolean {
  try {
    const ua = navigator.userAgent;
    if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return false;
    if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return false;
    if (!window.matchMedia('(pointer: fine)').matches) return false;
    if (Math.max(window.screen.width, window.screen.height) < 1280) return false;
    const gpu = gpuName();
    // Software-Grafik oder schwache eingebaute Grafik (Intel bis auf Arc, alte Radeon-Vega-Kerne): lieber ohne
    if (/swiftshader|llvmpipe|software|microsoft basic/i.test(gpu)) return false;
    if (/intel/i.test(gpu) && !/arc/i.test(gpu)) return false;
    return true;
  } catch { return false; }
}

/** Name der Grafik (leer, wenn der Browser ihn nicht verrät) */
function gpuName(): string {
  try {
    const cv = document.createElement('canvas');
    const gl = (cv.getContext('webgl2') ?? cv.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'software';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch { return ''; }
}

/** Stufe aus den früheren Einzelschaltern (einmalig, solange keine Stufe gespeichert ist) */
function migrateLevel(): number {
  const old = (k: string) => lsGet(`gruppetto.gfx.${k}`);
  let n: number;
  if (old('lite') === '1') n = 1;
  else if (old('pc') === '1' || (old('pc') === null && looksLikePc())) n = 10;
  else if (old('licht') === '1') n = 8;
  else if (old('details') === '1') n = 7;
  else if (old('schatten') === '0') n = 5;
  else n = 6;
  // früher eigens gewählte Sichtweite
  const r = lsGet('gruppetto.range');
  if (n > 1 && r === 'eco') n = Math.min(n, 3);
  else if (n > 1 && r === 'normal') n = Math.min(n, 4);
  else if (n > 1 && r === 'far') n = Math.min(n, 5);
  else if (r === 'ultra' || r === 'extreme') n = Math.max(n, 9);
  return n;
}

function loadLevel(): { n: number; fixed: boolean } {
  const s = search();
  const st = /[?&]stufe=(\d+)/.exec(s);
  if (st) return { n: clampLevel(Number(st[1])), fixed: true };
  const g = /[?&]gfx=(alle|aus|pc|einfach)\b/.exec(s)?.[1];
  if (g) return { n: g === 'einfach' ? 1 : g === 'aus' ? 5 : g === 'alle' ? 9 : 10, fixed: true };
  const v = Number(lsGet(K_LEVEL));
  if (v >= GFX_MIN && v <= GFX_MAX) return { n: Math.round(v), fixed: false };
  const n = migrateLevel();
  lsSet(K_LEVEL, String(n));
  return { n, fixed: false };
}

// ------------------------------------------------------------------ Auflösung

/** Pixeldichte des Bildschirms (Bildpunkte je Punkt) */
export function deviceDensity(): number {
  try { return window.devicePixelRatio || 1; } catch { return 1; }
}

/** wählbare Pixeldichten: 0,5 … höchstens die des Bildschirms (am Rechner bis 2, feiner als die Pixel), Schritte 0,25 */
export function resSteps(): number[] {
  const dev = deviceDensity();
  const max = Math.min(3, Math.max(dev, 2));
  const out: number[] = [];
  for (let d = 0.5; d <= max + 1e-6; d += 0.25) out.push(Math.round(d * 100) / 100);
  if (Math.abs(out[out.length - 1] - max) > 0.01) out.push(Math.round(max * 100) / 100);
  return out;
}

const snapRes = (d: number) => resSteps().reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a));

/** Vorgabe: am Telefon 1,5-fach (früher 1,4 mit Regelung), mit einfacher Grafik doppelt, am Rechner bis zu doppelt */
function defaultRes(n: number): number {
  const dev = deviceDensity();
  if (lsGet('gruppetto.gfx.lite') === '1') return snapRes(Math.min(2, dev));
  if (n >= 10) {
    let px = 2e6;
    try { px = window.innerWidth * window.innerHeight; } catch { /* egal */ }
    return snapRes(Math.min(2, Math.max(1.25, dev), Math.sqrt(4.5e6 / Math.max(1, px))));
  }
  return snapRes(Math.min(1.5, dev));
}

function loadRes(n: number): { d: number; fixed: boolean } {
  const m = /[?&]aufl=([\d.]+)/.exec(search());
  if (m) return { d: Math.max(0.25, Math.min(4, Number(m[1]) || 1)), fixed: true };
  const v = Number(lsGet(K_RES));
  if (v >= 0.25 && v <= 4) return { d: v, fixed: false };
  const d = defaultRes(n);
  lsSet(K_RES, String(d));
  return { d, fixed: false };
}

// ------------------------------------------------------------------ Zustand

const lv = loadLevel();
let level = lv.n;
const rs = loadRes(level);
let res = rs.d;
const subs = new Set<(k: GfxOpt, on: boolean) => void>();
const anySubs = new Set<() => void>();

const cur = () => GFX_LEVELS[level - 1];

/** Kamerafilter (CSS über dem Bild) gehört zum Lichtfilter; einfache Stufen: ohne Weichzeichner über dem Bild */
function applyCss() {
  try {
    document.documentElement.classList.toggle('gfx-licht', gfxOn('licht'));
    document.documentElement.classList.toggle('gfx-lite', gfxOn('lite'));
  } catch { /* kein DOM (Tests) */ }
}
applyCss();

/** Schalter der aktuellen Stufe */
export function gfxOn(k: GfxOpt): boolean {
  return cur()[k];
}
/** Kantenglättung (für die nächste Bühne) */
export function gfxAA(): boolean { return cur().aa; }
/** Sichtweite der Stufe */
export function gfxRange(): GfxRange { return cur().range; }
/** Stufe 1 … 10 */
export function gfxLevel(): number { return level; }
/** Pixeldichte (Bildpunkte je Punkt) */
export function gfxRes(): number { return res; }
/** mindestens so viele Bilder je Sekunde im festen Takt (frameClock.ts): einfache Stufen notfalls gleichmäßig 30 */
export function gfxMinFps(): number { return cur().lite ? 30 : 60; }

const OPTS: GfxOpt[] = ['pc', 'lite', 'licht', 'schatten', 'details'];

function notify(before: boolean[]) {
  applyCss();
  OPTS.forEach((k, i) => {
    const now = gfxOn(k);
    if (now === before[i]) return;
    for (const f of [...subs]) {
      try { f(k, now); } catch (e) { console.error(e); }
    }
  });
  for (const f of [...anySubs]) {
    try { f(); } catch (e) { console.error(e); }
  }
}

export function setGfxLevel(n: number) {
  const v = clampLevel(n);
  if (v === level) return;
  const before = OPTS.map((k) => gfxOn(k));
  level = v;
  if (!lv.fixed) lsSet(K_LEVEL, String(v));
  notify(before);
}

export function setGfxRes(d: number) {
  const v = Math.round(Math.max(0.25, Math.min(4, d)) * 100) / 100;
  if (v === res) return;
  res = v;
  if (!rs.fixed) lsSet(K_RES, String(v));
  notify(OPTS.map((k) => gfxOn(k)));
}

/** bei jeder wirksamen Änderung eines Schalters benachrichtigen; gibt die Abmeldung zurück */
export function onGfxChange(f: (k: GfxOpt, on: boolean) => void): () => void {
  subs.add(f);
  return () => { subs.delete(f); };
}

/** bei jeder Änderung von Stufe oder Auflösung benachrichtigen; gibt die Abmeldung zurück */
export function onGfxSettings(f: () => void): () => void {
  anySubs.add(f);
  return () => { anySubs.delete(f); };
}
