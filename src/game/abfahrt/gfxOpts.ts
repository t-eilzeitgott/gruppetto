/**
 * Aufwendige Grafik zum Zuschalten im Pausenmenü – anfangs alles aus, denn auf vielen Geräten kostet sie zu viel
 * Bildrate. Das Gerät merkt sich die Wahl. Ohne three.js (die leichten Spiele laden das Menü auch).
 *
 *  - licht: Wetter und Licht der Spielwelten (Goldene Stunde, Wetterumschwung, Nebel am Pass) mit der
 *    Nachbearbeitung (Leuchten, Lichtstrahlen, Wolken, Farbfilter, Vignette, Korn) und dem leichten
 *    Kamerafilter über dem Bild (siehe weather.ts)
 *  - schatten: Sonnenschatten (ein zweiter Zeichendurchgang je Bild)
 *  - details: feine Landschafts-Shader – Relief im Licht, Baumkronen mit Licht und Schatten, Felsstruktur,
 *    Rinnen und Schichten, ziehende Wolkenschatten, Flecken im Straßenbelag (siehe render3d.ts)
 *
 * Aus der Adresse: ?gfx=alle schaltet alles ein, ?gfx=aus alles aus (für Vergleiche; wird nicht gespeichert).
 */

export type GfxOpt = 'licht' | 'schatten' | 'details';

export const GFX_OPTS: { id: GfxOpt; label: string; hint: string }[] = [
  { id: 'licht', label: 'Lichtfilter & Wetter', hint: 'Goldene Stunde, Nebel, Leuchten, Lichtstrahlen' },
  { id: 'schatten', label: 'Sonnenschatten', hint: 'Schatten von Fahrern, Bäumen und Häusern' },
  { id: 'details', label: 'Landschaftsdetails', hint: 'Relief, Baumkronen, Felsstruktur, Wolkenschatten' },
];

const KEY = (k: GfxOpt) => `gruppetto.gfx.${k}`;

function urlAll(): boolean | null {
  try {
    const m = /[?&]gfx=(alle|aus)\b/.exec(window.location.search);
    return m ? m[1] === 'alle' : null;
  } catch { return null; }
}

const fixed = urlAll();

function load(k: GfxOpt): boolean {
  if (fixed !== null) return fixed;
  try { return localStorage.getItem(KEY(k)) === '1'; } catch { return false; }
}

const cur: Record<GfxOpt, boolean> = { licht: load('licht'), schatten: load('schatten'), details: load('details') };
const subs = new Set<(k: GfxOpt, on: boolean) => void>();

/** Kamerafilter (CSS über dem Bild) gehört zum Lichtfilter */
function applyCss() {
  try { document.documentElement.classList.toggle('gfx-licht', cur.licht); } catch { /* kein DOM (Tests) */ }
}
applyCss();

export function gfxOn(k: GfxOpt): boolean {
  return cur[k];
}

export function setGfx(k: GfxOpt, on: boolean) {
  if (cur[k] === on) return;
  cur[k] = on;
  try { localStorage.setItem(KEY(k), on ? '1' : '0'); } catch { /* egal */ }
  applyCss();
  for (const f of [...subs]) {
    try { f(k, on); } catch (e) { console.error(e); }
  }
}

/** bei jeder Änderung benachrichtigen; gibt die Abmeldung zurück */
export function onGfxChange(f: (k: GfxOpt, on: boolean) => void): () => void {
  subs.add(f);
  return () => { subs.delete(f); };
}
