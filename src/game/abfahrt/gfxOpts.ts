/**
 * Aufwendige Grafik zum Zuschalten im Pausenmenü – anfangs nur die Sonnenschatten an, der Rest kostet auf vielen
 * Geräten zu viel Bildrate. Das Gerät merkt sich die Wahl. Ohne three.js (die leichten Spiele laden das Menü auch).
 *
 *  - licht: Wetter und Licht der Spielwelten (Goldene Stunde, Wetterumschwung, Nebel am Pass) mit der
 *    Nachbearbeitung (Leuchten, Lichtstrahlen, Wolken, Farbfilter, Vignette, Korn) und dem leichten
 *    Kamerafilter über dem Bild (siehe weather.ts)
 *  - schatten: Sonnenschatten (ein zweiter Zeichendurchgang je Bild)
 *  - details: feine Landschafts-Shader – Relief im Licht, Baumkronen mit Licht und Schatten, Felsstruktur,
 *    Rinnen und Schichten, ziehende Wolkenschatten, Flecken im Straßenbelag (siehe render3d.ts)
 *  - pc: PC-Grafik für starke Rechner – alles oben an und darüber hinaus: feinere Berge am Horizont, Gras am
 *    Wegrand, schärfere Bäume, alle Fahrer in voller Detailstufe, große weiche Schatten, höhere Auflösung und
 *    Sichtweite (pcgfx.ts). Auf Rechnern mit eigener Grafikkarte von selbst an; gilt ab dem nächsten Start.
 *
 * Aus der Adresse: ?gfx=alle schaltet alles ein (außer PC), ?gfx=aus alles aus, ?gfx=pc alles samt PC-Grafik
 * (für Vergleiche; wird nicht gespeichert).
 */

export type GfxOpt = 'pc' | 'licht' | 'schatten' | 'details';

export const GFX_OPTS: { id: GfxOpt; label: string; hint: string }[] = [
  { id: 'pc', label: 'PC-Grafik', hint: 'Höchste Details für starke Rechner – ab dem nächsten Start' },
  { id: 'licht', label: 'Lichtfilter & Wetter', hint: 'Goldene Stunde, Nebel, Leuchten, Lichtstrahlen' },
  { id: 'schatten', label: 'Sonnenschatten', hint: 'Schatten von Fahrern, Bäumen und Häusern' },
  { id: 'details', label: 'Landschaftsdetails', hint: 'Relief, Baumkronen, Felsstruktur, Wolkenschatten' },
];

const KEY = (k: GfxOpt) => `gruppetto.gfx.${k}`;

function urlAll(): 'alle' | 'aus' | 'pc' | null {
  try {
    const m = /[?&]gfx=(alle|aus|pc)\b/.exec(window.location.search);
    return m ? (m[1] as 'alle' | 'aus' | 'pc') : null;
  } catch { return null; }
}

const fixed = urlAll();

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

/** anfangs an (solange auf dem Gerät nichts gewählt ist): die Sonnenschatten – und am Rechner die PC-Grafik */
const DEFAULT: Record<GfxOpt, boolean> = { pc: false, licht: false, schatten: true, details: false };

function load(k: GfxOpt): boolean {
  if (fixed !== null) return fixed === 'pc' || (fixed === 'alle' && k !== 'pc');
  try {
    const v = localStorage.getItem(KEY(k));
    if (v === null) return k === 'pc' ? looksLikePc() : DEFAULT[k];
    return v === '1';
  } catch { return DEFAULT[k]; }
}

const cur: Record<GfxOpt, boolean> = { pc: load('pc'), licht: load('licht'), schatten: load('schatten'), details: load('details') };
const subs = new Set<(k: GfxOpt, on: boolean) => void>();

/** Kamerafilter (CSS über dem Bild) gehört zum Lichtfilter */
function applyCss() {
  try { document.documentElement.classList.toggle('gfx-licht', gfxOn('licht')); } catch { /* kein DOM (Tests) */ }
}
applyCss();

/** an? (mit PC-Grafik ist alles andere auch an) */
export function gfxOn(k: GfxOpt): boolean {
  return cur[k] || (k !== 'pc' && cur.pc);
}

/** die eigene Wahl des Schalters (ohne die PC-Grafik, die alles andere mit einschaltet) */
export function gfxOwn(k: GfxOpt): boolean {
  return cur[k];
}

export function setGfx(k: GfxOpt, on: boolean) {
  if (cur[k] === on) return;
  const before = GFX_OPTS.map((o) => gfxOn(o.id));
  cur[k] = on;
  try { localStorage.setItem(KEY(k), on ? '1' : '0'); } catch { /* egal */ }
  applyCss();
  // gemeldet wird jede wirksame Änderung (die PC-Grafik schaltet die anderen mit)
  GFX_OPTS.forEach((o, i) => {
    const now = gfxOn(o.id);
    if (now === before[i]) return;
    for (const f of [...subs]) {
      try { f(o.id, now); } catch (e) { console.error(e); }
    }
  });
}

/** bei jeder Änderung benachrichtigen; gibt die Abmeldung zurück */
export function onGfxChange(f: (k: GfxOpt, on: boolean) => void): () => void {
  subs.add(f);
  return () => { subs.delete(f); };
}
