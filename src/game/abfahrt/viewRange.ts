/**
 * Sichtweite (im Pausenmenü einstellbar, das Gerät merkt sie sich): wie weit die feine und mittlere Landschaft,
 * Bäume und Strecke reichen, wie viel Rechenzeit je Bild ins Nachladen gehen darf und wie dicht der Dunst ist.
 * Der Renderer liest die Stufe in jedem Bild und stellt sich bei einer Änderung um (ohne Neuaufbau).
 */
import { gfxOn } from './gfxOpts';
export type RangeId = 'eco' | 'normal' | 'far' | 'max' | 'ultra' | 'extreme';

export interface ViewRange {
  id: RangeId;
  label: string;
  /** Kachelringe je Landschaftsstufe (fein, mittel, grob) */
  rings: [number, number, number];
  /** Übergang zur gröberen Stufe [Beginn, Ende] (m) je Stufe außer der gröbsten */
  morph: [[number, number], [number, number]];
  /** Bäume: weich ausblenden zwischen fade und gone (m); Kronendach hebt sich zwischen canNear und canFull */
  fade: number; gone: number; canNear: number; canFull: number;
  /** höchstens so viel Bauzeit je Bild (ms): Landschaft, Strecke */
  budget: number; chunkBudget: number;
  /** Strecke so weit voraus bauen (m) */
  ahead: number;
  /** Dunst (Faktor auf die Dichte) */
  fog: number;
  /** Faktor auf die Reichweite feiner Muster im Shader (Felstextur, Schichtung, Rinnen) */
  detail: number;
}

export const RANGES: ViewRange[] = [
  { id: 'eco', label: 'Kurz', rings: [2, 2, 1], morph: [[150, 206], [600, 760]], fade: 230, gone: 290, canNear: 170, canFull: 380, budget: 2, chunkBudget: 1.4, ahead: 440, fog: 1.15, detail: 0.7 },
  { id: 'normal', label: 'Normal', rings: [3, 2, 1], morph: [[210, 290], [600, 760]], fade: 320, gone: 400, canNear: 240, canFull: 520, budget: 3, chunkBudget: 2, ahead: 520, fog: 1, detail: 0.85 },
  { id: 'far', label: 'Weit', rings: [4, 3, 1], morph: [[300, 412], [1200, 1520]], fade: 400, gone: 500, canNear: 300, canFull: 640, budget: 4.5, chunkBudget: 2.6, ahead: 640, fog: 0.85, detail: 1 },
  { id: 'max', label: 'Max', rings: [6, 4, 2], morph: [[490, 670], [1650, 2050]], fade: 620, gone: 760, canNear: 480, canFull: 980, budget: 8, chunkBudget: 4, ahead: 900, fog: 0.55, detail: 1.6 },
  // (Übergangsende je Stufe höchstens Ringe·Kachel − Kachel/2: 7·128−64 = 832, 8·128−64 = 960)
  { id: 'ultra', label: 'Ultra', rings: [7, 5, 2], morph: [[620, 820], [2050, 2540]], fade: 800, gone: 960, canNear: 620, canFull: 1250, budget: 10, chunkBudget: 5, ahead: 1100, fog: 0.45, detail: 2.1 },
  { id: 'extreme', label: 'Extrem', rings: [8, 6, 2], morph: [[740, 950], [2450, 3040]], fade: 1000, gone: 1200, canNear: 780, canFull: 1550, budget: 12, chunkBudget: 6, ahead: 1300, fog: 0.35, detail: 2.7 },
];

const KEY = 'gruppetto.range';
const KEY_DROP = 'gruppetto.rangeDrop';
/** ohne eigene Wahl: „Max“ – mit PC-Grafik „Extrem“ (die Auflösungsregelung kürzt bei Bedarf) */
const fallback = () => (gfxOn('pc') ? RANGES[5] : RANGES[3]);
let cur: ViewRange = (() => {
  try { return RANGES.find((r) => r.id === localStorage.getItem(KEY)) ?? fallback(); } catch { return fallback(); }
})();
/** automatisch um so viele Stufen kürzer als gewählt (Auflösungsregelung, siehe quality.ts) */
let drop = (() => {
  try { return Math.max(0, Math.min(RANGES.length - 1, Number(localStorage.getItem(KEY_DROP)) || 0)); } catch { return 0; }
})();
let ver = 1;

/** wirksame Sichtweite: die gewählte, bei knapper Leistung automatisch kürzer */
export function viewRange(): ViewRange { return RANGES[Math.max(0, RANGES.indexOf(cur) - drop)]; }
/** die im Pausenmenü gewählte Sichtweite */
export function userRange(): ViewRange { return cur; }
/** zählt bei jeder Änderung hoch (der Renderer vergleicht) */
export function viewRangeVersion(): number { return ver; }
export function setViewRange(id: RangeId) {
  const r = RANGES.find((x) => x.id === id);
  if (!r || r === cur) return;
  cur = r;
  // neue Wahl: automatische Kürzung von vorn
  drop = 0;
  ver += 1;
  try { localStorage.setItem(KEY, id); localStorage.setItem(KEY_DROP, '0'); } catch { /* egal */ }
}
export function rangeDrop(): number { return drop; }
/** um wie viele Stufen die Sichtweite automatisch kürzer ist (bis zur kürzesten); das Gerät merkt es sich */
export function setRangeDrop(n: number) {
  const d = Math.max(0, Math.min(RANGES.indexOf(cur), Math.round(n)));
  if (d === drop) return;
  drop = d;
  ver += 1;
  try { localStorage.setItem(KEY_DROP, String(d)); } catch { /* egal */ }
}
/** kann die Sichtweite noch kürzer werden? */
export function canDropRange(): boolean { return RANGES.indexOf(cur) - drop > 0; }
