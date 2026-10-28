/**
 * Sichtweite (im Pausenmenü einstellbar, das Gerät merkt sie sich): wie weit die feine und mittlere Landschaft,
 * Bäume und Strecke reichen, wie viel Rechenzeit je Bild ins Nachladen gehen darf und wie dicht der Dunst ist.
 * Der Renderer liest die Stufe in jedem Bild und stellt sich bei einer Änderung um (ohne Neuaufbau).
 */
export type RangeId = 'eco' | 'normal' | 'far' | 'max';

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
}

export const RANGES: ViewRange[] = [
  { id: 'eco', label: 'Kurz', rings: [2, 2, 1], morph: [[150, 206], [600, 760]], fade: 230, gone: 290, canNear: 170, canFull: 380, budget: 2, chunkBudget: 1.4, ahead: 440, fog: 1.15 },
  { id: 'normal', label: 'Normal', rings: [3, 2, 1], morph: [[210, 290], [600, 760]], fade: 320, gone: 400, canNear: 240, canFull: 520, budget: 3, chunkBudget: 2, ahead: 520, fog: 1 },
  { id: 'far', label: 'Weit', rings: [4, 3, 1], morph: [[300, 412], [1200, 1520]], fade: 400, gone: 500, canNear: 300, canFull: 640, budget: 4.5, chunkBudget: 2.6, ahead: 640, fog: 0.85 },
  { id: 'max', label: 'Max', rings: [6, 4, 2], morph: [[490, 670], [1650, 2050]], fade: 620, gone: 760, canNear: 480, canFull: 980, budget: 8, chunkBudget: 4, ahead: 900, fog: 0.55 },
];

const KEY = 'gruppetto.range';
let cur: ViewRange = (() => {
  try { return RANGES.find((r) => r.id === localStorage.getItem(KEY)) ?? RANGES[2]; } catch { return RANGES[2]; }
})();
let ver = 1;

export function viewRange(): ViewRange { return cur; }
/** zählt bei jeder Änderung hoch (der Renderer vergleicht) */
export function viewRangeVersion(): number { return ver; }
export function setViewRange(id: RangeId) {
  const r = RANGES.find((x) => x.id === id);
  if (!r || r === cur) return;
  cur = r;
  ver += 1;
  try { localStorage.setItem(KEY, id); } catch { /* egal */ }
}
