/**
 * Sichtweite (Teil der Grafikstufe, gfxOpts.ts): wie weit die feine und mittlere Landschaft, Bäume und Strecke
 * reichen, wie viel Rechenzeit je Bild ins Nachladen gehen darf und wie dicht der Dunst ist. Der Renderer liest sie
 * in jedem Bild und stellt sich bei einer Änderung um (ohne Neuaufbau).
 */
import { gfxRange, onGfxSettings } from './gfxOpts';
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

/**
 * Stufe Minimal: Landschaft wie „Kurz“, Bäume enden näher (weniger durchsichtige Bilder übereinander), dichterer
 * Dunst verbirgt das Ende, feine Muster nur nah, weniger Bauzeit je Bild
 */
const LITE: ViewRange = { ...RANGES[0], label: 'Einfach', fade: 160, gone: 210, canNear: 130, canFull: 280, budget: 1.5, chunkBudget: 1.2, ahead: 400, fog: 1.3, detail: 0.5 };

let ver = 1;
let last = gfxRange();
onGfxSettings(() => { const r = gfxRange(); if (r !== last) { last = r; ver += 1; } });

/** wirksame Sichtweite (aus der Grafikstufe) */
export function viewRange(): ViewRange {
  const r = gfxRange();
  return r === 'lite' ? LITE : RANGES.find((x) => x.id === r) ?? RANGES[3];
}
/** zählt bei jeder Änderung hoch (der Renderer vergleicht) */
export function viewRangeVersion(): number { return ver; }
