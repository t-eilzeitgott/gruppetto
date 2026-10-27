/**
 * Das Level von „Akku leer!“: Kaffeepause am Col du Watt. Unten die Ladestation, in der Mitte der Berggasthof
 * „Rückenwind“ mit zwei Stockwerken und Kuchenbuffet, oben am Gipfel der Motor-Doper hinter Stein und Glas.
 *
 * Koordinaten in Metern, y nach oben, Boden bei y = 0, die Schleuder steht bei x = 0.
 * Alles liegt exakt aufeinander (Unterkante = Oberkante darunter), damit die Bauten ruhig stehen.
 */

export type Mat = 'wood' | 'glass' | 'stone' | 'akku' | 'cake' | 'roof';
export type EnemyType = 'opa' | 'tourer' | 'boss';
export type RiderType = 'sprinter' | 'floh' | 'wasser' | 'zeit' | 'gelb';

export interface BlockDef {
  mat: Mat;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Dreieck/Polygon in Weltkoordinaten (statt Rechteck) */
  poly?: [number, number][];
  /** Schmuck, der mit dem Körper mitfährt */
  deco?: 'sign' | 'flag' | 'chimney' | 'menu';
}

export interface EnemyDef { type: EnemyType; x: number; y: number }

export interface LevelDef {
  name: string;
  /** feste Felsen (konvexe Polygone, gegen den Uhrzeigersinn) */
  rocks: [number, number][][];
  blocks: BlockDef[];
  enemies: EnemyDef[];
  riders: RiderType[];
  /** Ruhelage in der Schleuder */
  sling: { x: number; y: number };
  /** sichtbarer Bereich (Kamera) */
  view: { x0: number; x1: number; y0: number; y1: number };
  /** Punkte für 1, 2, 3 Sterne */
  stars: [number, number, number];
}

const box = (mat: Mat, x: number, bottom: number, w: number, h: number, deco?: BlockDef['deco']): BlockDef =>
  ({ mat, x, y: bottom + h / 2, w, h, deco });
/** Planke von links nach rechts auf Höhe bottom */
const span = (mat: Mat, left: number, right: number, bottom: number, h: number, deco?: BlockDef['deco']): BlockDef =>
  ({ mat, x: (left + right) / 2, y: bottom + h / 2, w: right - left, h, deco });
const tri = (mat: Mat, pts: [number, number][], deco?: BlockDef['deco']): BlockDef => {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { mat, x: 0, y: 0, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), poly: pts, deco };
};

/** Maße der Bauteile */
const POST = 0.36;
const GLASS = 0.32;
const PILLAR = 0.46;
const PLANK = 0.34;

function build(): LevelDef {
  const blocks: BlockDef[] = [];
  const enemies: EnemyDef[] = [];

  // ---------------------------------------------------------------- 1) Ladestation (Fels auf 1,0 m)
  const t1 = 1.0;
  blocks.push(box('akku', 4.5, t1, 0.75, 0.75));
  blocks.push(box('akku', 4.5, t1 + 0.75, 0.75, 0.75));
  const p1 = 5.22;
  const p2 = 6.86;
  const postH = 1.9;
  blocks.push(box('wood', p1, t1, POST, postH));
  blocks.push(box('wood', p2, t1, POST, postH));
  blocks.push(span('wood', p1 - POST / 2 - 0.05, p2 + POST / 2 + 0.05, t1 + postH, PLANK, 'sign'));
  enemies.push({ type: 'opa', x: (p1 + p2) / 2, y: t1 + 0.6 });

  // ---------------------------------------------------------------- 2) Berggasthof „Rückenwind“ (Fels auf 4,0 m)
  const g0 = 4.0;
  const eg = 2.0;
  const xL = 8.0;
  const xM = 10.35;
  const xR = 12.7;
  // Erdgeschoss: Glasfront links, zwei Steinpfeiler
  blocks.push(box('glass', xL, g0, GLASS, eg));
  blocks.push(box('stone', xM, g0, PILLAR, eg));
  blocks.push(box('stone', xR, g0, PILLAR, eg));
  enemies.push({ type: 'tourer', x: (xL + GLASS / 2 + xM - PILLAR / 2) / 2, y: g0 + 0.72 });
  // rechts: Kiste mit Kuchen, daneben ein Akku
  blocks.push(box('wood', 11.0, g0, 0.7, 0.7));
  blocks.push(box('cake', 11.0, g0 + 0.7, 0.62, 0.38));
  blocks.push(box('akku', 12.03, g0, 0.6, 0.6));
  // Decke über dem Erdgeschoss
  const c1 = g0 + eg;
  blocks.push(span('wood', xL - GLASS / 2, xM, c1, PLANK));
  blocks.push(span('wood', xM, xR + PILLAR / 2, c1, PLANK));
  // Obergeschoss: Holz links und rechts, Glas in der Mitte
  const o0 = c1 + PLANK;
  const og = 1.8;
  blocks.push(box('wood', xL, o0, POST, og));
  blocks.push(box('glass', xM, o0, GLASS, og, 'menu'));
  blocks.push(box('wood', xR + 0.03, o0, POST, og));
  enemies.push({ type: 'opa', x: (xL + POST / 2 + xM - GLASS / 2) / 2, y: o0 + 0.6 });
  blocks.push(box('akku', 10.88, o0, 0.6, 0.6));
  blocks.push(box('cake', 10.88, o0 + 0.6, 0.55, 0.34));
  enemies.push({ type: 'opa', x: 11.92, y: o0 + 0.6 });
  // Decke und Dach
  const c2 = o0 + og;
  blocks.push(span('wood', xL - POST / 2, xM, c2, PLANK));
  blocks.push(span('wood', xM, xR + 0.03 + POST / 2, c2, PLANK));
  const r0 = c2 + PLANK;
  const ridge = r0 + 1.45;
  blocks.push(tri('roof', [[xL - POST / 2 - 0.05, r0], [xM, r0], [xM, ridge]], 'flag'));
  blocks.push(tri('roof', [[xM, r0], [xR + 0.03 + POST / 2 + 0.05, r0], [xM, ridge]], 'chimney'));

  // ---------------------------------------------------------------- 3) Gipfel (Fels auf 9,0 m)
  const s0 = 9.0;
  const wallH = 2.1;
  blocks.push(box('stone', 13.92, s0, 0.5, wallH));
  enemies.push({ type: 'boss', x: 15.17, y: s0 + 0.95 });
  blocks.push(box('glass', 16.3, s0, 0.3, wallH));
  blocks.push(span('stone', 13.92 - 0.25, 16.3 + 0.15, s0 + wallH, 0.36));
  blocks.push(box('akku', 14.32, s0 + wallH + 0.36, 0.6, 0.6));
  blocks.push(box('akku', 15.88, s0 + wallH + 0.36, 0.6, 0.6));
  blocks.push(box('akku', 17.02, s0, 0.7, 0.7));

  return {
    name: 'Col du Watt',
    rocks: [
      [[3.3, 0], [7.15, 0], [7.15, 1.0], [3.9, 1.0]],
      [[7.15, 0], [13.05, 0], [13.05, 4.0], [7.75, 4.0], [7.15, 1.0]],
      [[13.05, 0], [17.6, 0], [17.6, 9.0], [13.62, 9.0], [13.05, 4.0]],
      [[17.6, 0], [40, 0], [40, 13.5], [17.6, 9.0]],
    ],
    blocks,
    enemies,
    riders: ['sprinter', 'floh', 'wasser', 'zeit', 'gelb'],
    sling: { x: 0, y: 2.35 },
    view: { x0: -4.85, x1: 17.75, y0: -1.2, y1: 12.6 },
    stars: [30000, 50000, 70000],
  };
}

export const LEVEL: LevelDef = build();
