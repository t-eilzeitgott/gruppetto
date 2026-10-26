/**
 * Strecke für „Abfahrt“: eine endlose Passabfahrt aus Segmenten (je 2 m).
 * Jede Abfahrt läuft durch mehrere Täler (Passhöhe, Almen, Bergwald, Dorf, See oder Weinberge)
 * und endet in einem Tunnel, hinter dem der nächste Pass beginnt. Alles ist aus dem Tages-Seed
 * erzeugt, damit am selben Tag alle dieselbe Strecke fahren.
 */
import { between, chance, hashStr, mulberry32, pick, shuffle, type Rng } from './rng';

export const SEG = 2;            // Segmentlänge in m
export const ROAD_HALF = 2.8;    // halbe Fahrbahnbreite in m
export const VERGE = 1.0;        // Bankett neben der Randlinie
export const EDGE = ROAD_HALF + VERGE;

export type BiomeId = 'pass' | 'alpine' | 'forest' | 'village' | 'lake' | 'vineyard';
export type Ground = 'snow' | 'rock' | 'meadow' | 'forest' | 'pavement' | 'field' | 'water' | 'vines' | 'sunflower';
export type Surface = 'asphalt' | 'fresh' | 'cobble' | 'gravel';
export type Barrier = 'none' | 'rail' | 'stone' | 'fence' | 'crowd';

export interface Side {
  ground: Ground;
  /** Querneigung des Geländes neben dem Bankett: + steigt an, − fällt ab */
  tilt: number;
  barrier: Barrier;
  /** Höhe einer Felswand direkt am Bankett (m), 0 = keine */
  wall: number;
  /** Abgrund: ohne Begrenzung führt das Abkommen zum Sturz */
  drop: boolean;
}

export interface Building {
  start: number;
  len: number;          // Segmente
  height: number;
  depth: number;
  setback: number;      // Abstand der Fassade zur Straßenmitte (m)
  color: number;
  roof: number;
  shutter: number;
  style: 0 | 1 | 2;     // 0 italienisch, 1 Chalet, 2 Kirche
  floors: number;
  seed: number;
}

export type SpriteKind =
  | 'pine' | 'pineSnow' | 'larch' | 'tree' | 'treeRound' | 'cypress' | 'palm' | 'olive' | 'bush' | 'flowers'
  | 'rock' | 'boulder' | 'snowpole' | 'chalet' | 'barn' | 'rifugio' | 'farmhouse' | 'cow' | 'cowBW' | 'hay'
  | 'fence' | 'vinerow' | 'sunflowers' | 'crowd' | 'chevron' | 'lamp' | 'parasol' | 'boat' | 'logs'
  | 'tornante' | 'townSign' | 'passSign' | 'fountain' | 'flagpole' | 'campervan' | 'grassTuft' | 'stoneWall';

export interface Sprite {
  k: SpriteKind;
  x: number;        // seitlich zur Straßenmitte (m)
  h: number;        // Höhe des Fußpunkts über Straßenniveau (m)
  s: number;        // Größenfaktor
  v: number;        // Variante
  f: boolean;       // gespiegelt
  text?: string;
}

export type ObjKind = 'bidon' | 'gold' | 'pothole' | 'rock' | 'cow' | 'cone' | 'puddle';
export interface Obj {
  k: ObjKind;
  z: number;
  x: number;
  r: number;        // Radius für die Kollision (m)
  done?: boolean;
  near?: boolean;
  vx?: number;      // Kuh: Querbewegung, sobald man näher kommt
  ph?: number;
}

export interface Decal {
  k: 'text' | 'patch' | 'manhole' | 'grid' | 'zebra' | 'arrow';
  x: number;
  w: number;
  len: number;      // Segmente
  text?: string;
}

export interface Banner {
  kind: 'gpm' | 'sprint' | 'welcome' | 'arch';
  text: string;
  sub?: string;
}

export interface Seg {
  i: number;
  /** Weltlage am Segmentanfang: Position (x, z) und Fahrtrichtung th (rad, 0 = −z) */
  wx: number;
  wz: number;
  th: number;
  y: number;
  grade: number;
  curve: number;
  sec: number;
  surface: Surface;
  L: Side;
  R: Side;
  bL: Building | null;
  bR: Building | null;
  tunnel: boolean;
  portal: 0 | 1 | 2;
  sprites: Sprite[] | null;
  objs: Obj[] | null;
  decals: Decal[] | null;
  banner: Banner | null;
  hairpin: number;
  lamp: boolean;
  crowd: boolean;
  crest: boolean;
}

export interface Section {
  biome: BiomeId;
  start: number;
  end: number;
  name: string;
  alt: number;      // Höhe am Anfang (m ü. NN)
  descent: number;  // laufende Nummer der Abfahrt
}

const PASSES: [string, number][] = [
  ['Passo Giau', 2236], ['Passo Pordoi', 2239], ['Passo Fedaia', 2057], ['Passo di Gavia', 2621], ['Passo dello Stelvio', 2758],
  ['Colle delle Finestre', 2178], ['Passo San Pellegrino', 1918], ['Passo Rolle', 1984], ['Passo Valparola', 2192], ['Passo Sella', 2244],
  ['Passo Gardena', 2121], ['Passo Manghen', 2047], ['Passo del Mortirolo', 1852], ['Colle Fauniera', 2481], ["Colle dell'Agnello", 2744],
  ['Passo Falzarego', 2105], ['Passo del Tonale', 1883], ['Passo Campolongo', 1875], ['Passo Duran', 1601], ['Passo Croce Domini', 1892],
];
const VALLEYS = ['Val di Fassa', 'Val Badia', 'Alta Badia', 'Val Gardena', 'Val di Sole', 'Valle Camonica', 'Val Venosta', 'Val Zoldana', 'Val di Fiemme', 'Valle Maira', 'Val Cordevole', 'Valle Stura', 'Val Pusteria', 'Val di Zoldo'];
const FORESTS = ['Foresta di Paneveggio', 'Bosco del Cansiglio', 'Foresta di Somadida', 'Bosco di Larici', 'Foresta di Tarvisio', 'Bosco della Val Visdende', 'Foresta del Cadore', 'Bosco di Abeti'];
const VILLAGES = ['Canazei', 'Arabba', 'Cortina', 'Bormio', 'Livigno', 'Ponte di Legno', 'Corvara', 'Moena', 'Alleghe', 'Caprile', 'Selva', 'Ortisei', 'Predazzo', 'Agordo', 'Aprica', 'Edolo', 'Sappada', 'Vigo di Fassa', 'Cogne', 'Limone Piemonte'];
const LAKES = ['Lago di Garda', "Lago d'Iseo", 'Lago di Como', 'Lago Maggiore', 'Lago di Molveno', 'Lago di Caldonazzo', 'Lago di Alleghe', 'Lago di Santa Croce', "Lago d'Orta"];
const HILLS = ['Valdobbiadene', 'Franciacorta', 'Langhe', 'Chianti', 'Valpolicella', 'Montalcino', 'Roero', 'Monferrato', 'Colli Euganei', 'Collio'];

const BASE_GRADE: Record<BiomeId, number> = { pass: -0.085, alpine: -0.08, forest: -0.075, village: -0.04, lake: -0.03, vineyard: -0.045 };

// Abstand zu älteren Straßenstücken (Draufsicht): die Strecke darf nie über oder unter sich selbst
// hindurchführen, und je höher zwei Stücke übereinander lägen, desto weiter müssen sie auseinander
const OCC_CS = 64;      // Rasterweite (m)
const OCC_GAP = 80;     // so viele Segmente zurück zählt ein Stück als „älter“ (160 m)
const OCC_MIN = 34;
const OCC_MAX = 170;
const occNeed = (dy: number) => Math.max(OCC_MIN, Math.min(OCC_MAX, 0.95 * Math.abs(dy)));
const occKey = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);
const LENGTH: Record<BiomeId, number> = { pass: 330, alpine: 430, forest: 420, village: 270, lake: 420, vineyard: 420 };
const WRITINGS = ['FORZA', 'VAI VAI', 'ALLEZ', 'HOPP HOPP', 'DAJE', 'BRAVO', 'GRUPPETTO', 'VAMOS', 'ATTACCA', 'TUTTO GAS'];

/** Schwierigkeit 0 … 1 nach gefahrener Strecke */
export const difficulty = (z: number): number => Math.min(1, Math.max(0, z / 9000));

interface Piece { curve: number[]; grade?: number[]; hairpin?: boolean; crest?: boolean }

export class Track {
  readonly seed: number;
  readonly dayKey: string;
  readonly title: string;
  readonly sections: Section[] = [];
  private segs: Seg[] = [];
  private base = 0;
  private rng: Rng;
  readonly names: string[];
  private plan: { biome: BiomeId; name: string; alt: number; descent: number }[] = [];
  private passOrder: [string, number][];
  private descentNo = 0;
  private y = 0;
  private wx = 0;
  private wz = 0;
  private th = 0;
  private hairpinNo = 0;
  private mountain = 1;
  private goal = 0;       // Sollrichtung des aktuellen Kehren-Schenkels
  /** Gesamtrichtung: Kehren versetzen die Straße dorthin, offene Abschnitte fahren dorthin – nie zurück */
  private readonly prog = -Math.PI / 2;
  /** bisher verlegte Straße (alle 4 m: x, z, y, Segment) in einem groben Raster */
  private occ = new Map<number, number[]>();

  constructor(dayKey: string, names: string[] = []) {
    this.dayKey = dayKey;
    this.seed = hashStr(`abfahrt:${dayKey}`);
    this.rng = mulberry32(this.seed);
    this.names = names.map((n) => n.trim().split(/\s+/)[0]?.toUpperCase()).filter((n): n is string => !!n && n.length <= 10);
    this.passOrder = shuffle(this.rng, PASSES);
    this.planDescent();
    const first = this.plan[0];
    const end = this.plan.find((p, i) => i > 0 && (p.biome === 'village' || p.biome === 'lake' || p.biome === 'vineyard'));
    this.title = `${first.name} → ${end?.name ?? 'Tal'}`;
  }

  get length(): number { return this.base + this.segs.length; }
  /** ältestes noch vorhandenes Segment */
  get first(): number { return this.base; }

  /** Segment mit absolutem Index i (erzeugt bei Bedarf) */
  seg(i: number): Seg {
    while (i >= this.base + this.segs.length) this.buildSection();
    const s = this.segs[i - this.base];
    return s ?? this.segs[0];
  }

  segAt(z: number): Seg { return this.seg(Math.max(0, Math.floor(z / SEG))); }

  heightAt(z: number): number {
    const i = Math.max(0, Math.floor(z / SEG));
    const s = this.seg(i);
    return s.y + s.grade * (z - i * SEG);
  }

  sectionOf(seg: Seg): Section { return this.sections[seg.sec]; }

  /** Weltposition eines Punktes: Strecke z, seitlich x (rechts +), Höhe h über der Straße */
  world(z: number, x: number, h: number, out: { x: number; y: number; z: number; th: number }) {
    const i = Math.max(0, Math.floor(z / SEG));
    const s = this.seg(i);
    const t = z - i * SEG;
    const th = s.th + s.curve * t;
    const thm = s.th + s.curve * t * 0.5;
    out.x = s.wx + Math.sin(thm) * t + Math.cos(th) * x;
    out.z = s.wz - Math.cos(thm) * t + Math.sin(th) * x;
    out.y = s.y + s.grade * t + h;
    out.th = th;
    return out;
  }

  /** alte Segmente verwerfen, damit der Speicher nicht wächst */
  trim(before: number) {
    const drop = Math.min(this.segs.length - 1, before - this.base);
    if (drop > 600) {
      this.segs.splice(0, drop);
      this.base += drop;
    }
  }

  private planDescent() {
    const r = this.rng;
    const [pass, alt] = this.passOrder[this.descentNo % this.passOrder.length];
    const d = this.descentNo;
    const valley = pick(r, VALLEYS);
    const lower: BiomeId = chance(r, 0.5) ? 'lake' : 'vineyard';
    const seq: { biome: BiomeId; name: string }[] = [
      { biome: 'pass', name: pass },
      { biome: 'alpine', name: valley },
      { biome: 'forest', name: pick(r, FORESTS) },
      { biome: 'village', name: pick(r, VILLAGES) },
      { biome: lower, name: lower === 'lake' ? pick(r, LAKES) : pick(r, HILLS) },
    ];
    if (chance(r, 0.5)) seq.splice(3, 0, { biome: 'alpine', name: pick(r, VALLEYS.filter((v) => v !== valley)) });
    // Höhenangaben im Spielmaßstab: eine Abfahrt führt vom Pass bis ins Tal
    let a = alt;
    for (const s of seq) {
      if (s.biome === 'lake' || s.biome === 'vineyard') a = Math.min(a - 250, between(r, 190, 680));
      this.plan.push({ ...s, alt: Math.round(a / 5) * 5, descent: d });
      a -= between(r, 240, 400);
    }
    this.descentNo += 1;
  }

  private buildSection() {
    if (this.plan.length === 0) this.planDescent();
    const p = this.plan.shift()!;
    const r = this.rng;
    const start = this.base + this.segs.length;
    const D = difficulty(start * SEG);
    const n = Math.round(LENGTH[p.biome] * between(r, 0.9, 1.12));
    const last = this.plan.length === 0;   // letzter Abschnitt der Abfahrt → Tunnel zum nächsten Pass
    const secIndex = this.sections.length;
    this.sections.push({ biome: p.biome, start, end: start + n, name: p.name, alt: p.alt, descent: p.descent });

    // 1) Linienführung
    const curve = new Array<number>(n).fill(0);
    const grade = new Array<number>(n).fill(0);
    const marks = new Array<number>(n).fill(0); // 1 Kehre, 2 Kuppe
    const pieces = this.pieces(p.biome, n, D, start);
    let at = 0;
    for (const pc of pieces) {
      for (let k = 0; k < pc.curve.length && at + k < n; k++) {
        curve[at + k] = pc.curve[k];
        if (pc.grade) grade[at + k] = pc.grade[k];
        if (pc.hairpin) marks[at + k] = 1;
        if (pc.crest && pc.grade && pc.grade[k] < -0.1) marks[at + k] = 2;
      }
      at += pc.curve.length;
      if (at >= n) break;
    }
    const base = BASE_GRADE[p.biome] * (1 + 0.32 * D);
    const ph1 = r() * 6.28;
    const ph2 = r() * 6.28;
    for (let k = 0; k < n; k++) {
      if (grade[k] !== 0) continue;
      let g = base + 0.016 * Math.sin((start + k) / 37 + ph1) + 0.009 * Math.sin((start + k) / 13 + ph2);
      if (marks[k] === 1) g *= 0.55;
      grade[k] = Math.min(-0.004, g);
    }

    // 2) Seiten, Beläge, Deko
    const tunnelLen = last ? Math.round(between(r, 70, 100)) : 0;
    const shortTunnel = !last && (p.biome === 'pass' || p.biome === 'forest') && chance(r, 0.55)
      ? { at: Math.round(between(r, n * 0.35, n * 0.6)), len: Math.round(between(r, 30, 55)) } : null;
    const tunnels: [number, number][] = [];
    if (tunnelLen) tunnels.push([n - tunnelLen, n]);
    if (shortTunnel) tunnels.push([shortTunnel.at, shortTunnel.at + shortTunnel.len]);
    const buildings = p.biome === 'village' ? this.villageBuildings(start, n) : { L: [], R: [] };

    let sideRun = 0;
    let L: Side = { ground: 'meadow', tilt: 0, barrier: 'none', wall: 0, drop: false };
    let R: Side = L;
    let surface: Surface = 'asphalt';
    let surfaceRun = 0;
    let hairpinOutside = 0;

    // Bergseite: vor einer Rechtskehre links, danach rechts (Serpentinen am selben Hang)
    const mtn = new Array<number>(n).fill(this.mountain);
    {
      let last = 0;
      let cur = this.mountain;
      for (let k = 0; k < n; k++) {
        if (marks[k] === 1 && (k === 0 || marks[k - 1] !== 1)) {
          const d = curve[k + 3] > 0 ? 1 : -1;
          for (let q = last; q < k; q++) mtn[q] = -d;
          let b = k;
          while (b < n && marks[b] === 1) { mtn[b] = d; b++; }
          last = b;
          cur = d;
          k = b - 1;
        }
      }
      for (let q = last; q < n; q++) mtn[q] = cur;
      this.mountain = cur;
    }

    for (let k = 0; k < n; k++) {
      const i = start + k;
      const inTunnel = tunnels.some(([a, b]) => k >= a && k < b);
      const portal: 0 | 1 | 2 = tunnels.some(([a]) => k === a) ? 1 : tunnels.some(([, b]) => k === b - 1) ? 2 : 0;

      if (marks[k] === 1 && (k === 0 || marks[k - 1] !== 1)) {
        hairpinOutside = curve[k] > 0 ? -1 : 1;
        this.hairpinNo += 1;
      }
      if (marks[k] !== 1 && k > 0 && marks[k - 1] === 1) hairpinOutside = 0;

      if (sideRun <= 0 || (k > 0 && mtn[k] !== mtn[k - 1])) {
        const keep = this.mountain;
        this.mountain = mtn[k];
        [L, R] = this.sides(p.biome, D);
        this.mountain = keep;
        sideRun = Math.round(between(r, 24, 70));
      }
      sideRun -= 1;
      // Außenseite einer Kehre: immer gesichert
      let l = L;
      let rr = R;
      if (hairpinOutside !== 0) {
        const fix = (s: Side): Side => (s.drop && s.barrier === 'none' ? { ...s, barrier: 'rail' } : s);
        if (hairpinOutside < 0) l = fix(l); else rr = fix(rr);
      }

      if (surfaceRun <= 0) {
        surface = this.surface(p.biome, k, n);
        surfaceRun = Math.round(between(r, 30, 110));
      }
      surfaceRun -= 1;

      // Nach der ersten Passhöhe: bergseitig Schneewände (wie am Gavia im Mai), talseitig eine
      // Steinmauer mit freiem Blick hinunter ins Tal und auf die Berge gegenüber
      if (p.descent === 0 && p.biome === 'pass' && this.sections.length === 1 && k >= 66 && k < 190) {
        const wall = 2.0 + 0.9 * Math.sin(k * 0.11) + 0.4 * Math.sin(k * 0.37);
        const snowWall: Side = { ground: 'snow', tilt: 0.3, barrier: 'none', wall: wall + 0.3 * Math.sin(k * 0.21), drop: false };
        const balcony: Side = { ground: 'snow', tilt: -0.9, barrier: 'stone', wall: 0, drop: true };
        if (mtn[k] > 0) { l = balcony; rr = snowWall; } else { l = snowWall; rr = balcony; }
      }
      // Einschnitt vor einem Tunnel: das Gelände steigt zu beiden Seiten an
      const ahead = tunnels.find(([a]) => k < a && k >= a - 45);
      if (ahead) {
        const t = 1 - (ahead[0] - k) / 45;
        const g: Ground = p.biome === 'pass' ? 'rock' : p.biome === 'forest' ? 'forest' : 'meadow';
        const cut: Side = { ground: g, tilt: 0.45, barrier: 'none', wall: 1.2 + t * 7.5, drop: false };
        l = cut;
        rr = cut;
      }
      const seg: Seg = {
        i, wx: this.wx, wz: this.wz, th: this.th, y: this.y, grade: grade[k], curve: curve[k], sec: secIndex,
        surface: inTunnel ? 'asphalt' : surface,
        L: l, R: rr,
        bL: buildings.L.find((b) => i >= b.start && i < b.start + b.len) ?? null,
        bR: buildings.R.find((b) => i >= b.start && i < b.start + b.len) ?? null,
        tunnel: inTunnel, portal,
        sprites: null, objs: null, decals: null, banner: null,
        hairpin: marks[k] === 1 ? this.hairpinNo : 0,
        lamp: false, crowd: false, crest: marks[k] === 2,
      };
      this.y += grade[k] * SEG;
      const thMid = this.th + curve[k] * SEG * 0.5;
      this.wx += Math.sin(thMid) * SEG;
      this.wz -= Math.cos(thMid) * SEG;
      this.th += curve[k] * SEG;
      this.segs.push(seg);
    }

    this.decorate(start, n, p.biome, D, secIndex, marks, curve);
    this.items(start, n, p.biome, D);
  }

  // ---------------------------------------------------------------- Linienführung

  private occAdd(x: number, z: number, y: number, i: number) {
    const key = occKey(Math.floor(x / OCC_CS), Math.floor(z / OCC_CS));
    let l = this.occ.get(key);
    if (!l) { l = []; this.occ.set(key, l); }
    l.push(x, z, y, i);
  }

  /** Spielraum eines neuen Straßenpunkts zu älteren Stücken (negativ: zu nah oder zu steil darüber/darunter) */
  private occClear(x: number, z: number, y: number, i: number): number {
    let best = Infinity;
    const cx = Math.floor(x / OCC_CS);
    const cz = Math.floor(z / OCC_CS);
    const R = Math.ceil(OCC_MAX / OCC_CS);
    for (let a = -R; a <= R; a++) {
      for (let b = -R; b <= R; b++) {
        const l = this.occ.get(occKey(cx + a, cz + b));
        if (!l) continue;
        for (let q = 0; q < l.length; q += 4) {
          if (i - l[q + 3] < OCC_GAP) continue;
          const d = Math.hypot(x - l[q], z - l[q + 1]) - occNeed(y - l[q + 2]);
          if (d < best) best = d;
        }
      }
    }
    return best;
  }

  private pieces(biome: BiomeId, n: number, D: number, start: number): Piece[] {
    const r = this.rng;
    const out: Piece[] = [];
    const ramp = (k: number, enter: number, hold: number, exit: number) => {
      const a: number[] = [];
      for (let j = 0; j < enter; j++) a.push(k * (0.5 - 0.5 * Math.cos(Math.PI * (j + 0.5) / enter)));
      for (let j = 0; j < hold; j++) a.push(k);
      for (let j = 0; j < exit; j++) a.push(k * (0.5 + 0.5 * Math.cos(Math.PI * (j + 0.5) / exit)));
      return a;
    };
    const straight = (len: number): Piece => ({ curve: new Array(len).fill(0) });
    const scale = 0.85 + 0.35 * D;
    let dir = chance(r, 0.5) ? 1 : -1;
    let head = this.th;
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const W: Record<BiomeId, [string, number][]> = {
      pass: [['straight', 0.22], ['curve', 0.2], ['tight', 0.14], ['hairpin', 0.34], ['crest', 0.1]],
      alpine: [['straight', 0.2], ['curve', 0.28], ['tight', 0.14], ['hairpin', 0.22], ['crest', 0.16]],
      forest: [['straight', 0.12], ['curve', 0.28], ['sbend', 0.26], ['tight', 0.22], ['crest', 0.12]],
      village: [['straight', 0.42], ['curve', 0.26], ['tight', 0.26], ['crest', 0.06]],
      lake: [['straight', 0.22], ['sweep', 0.44], ['curve', 0.22], ['crest', 0.12]],
      vineyard: [['straight', 0.22], ['curve', 0.26], ['sbend', 0.22], ['crest', 0.3]],
    };
    const choose = () => {
      let x = r();
      for (const [k, w] of W[biome]) { x -= w; if (x <= 0) return k; }
      return 'straight';
    };
    // Serpentinen pendeln um die Schenkelrichtung, offene Abschnitte halten die Gesamtrichtung –
    // Kurven führen jeweils dorthin zurück (keine Schleifen, saubere Serpentinen)
    const serp = W[biome].some(([k]) => k === 'hairpin');
    const back = () => {
      const d = wrap(head - (serp ? this.goal : this.prog));
      if (Math.abs(d) < 0.12) return chance(r, 0.5) ? 1 : -1;
      return d > 0 ? -1 : 1;
    };

    // Probefahrt: Lage der neuen Stücke vorausrechnen und den Abstand zu älteren Stücken prüfen
    const g0 = BASE_GRADE[biome] * (1 + 0.32 * D);
    const sim = { x: this.wx, z: this.wz, th: this.th, y: this.y, i: start };
    let len = 0;
    const drive = (pcs: Piece[], commit: boolean): number => {
      let { x, z, th, y, i } = sim;
      let worst = Infinity;
      for (const pc of pcs) {
        for (let k = 0; k < pc.curve.length; k++) {
          if ((i & 1) === 0) {
            if (!commit) worst = Math.min(worst, this.occClear(x, z, y, i));
            else if (i < start + n) this.occAdd(x, z, y, i);
          }
          const c = pc.curve[k];
          const thMid = th + c * SEG * 0.5;
          x += Math.sin(thMid) * SEG;
          z -= Math.cos(thMid) * SEG;
          th += c * SEG;
          y += (pc.grade ? pc.grade[k] : pc.hairpin ? g0 * 0.55 : g0) * SEG;
          i++;
        }
      }
      if (commit) { sim.x = x; sim.z = z; sim.th = th; sim.y = y; sim.i = i; }
      return worst;
    };
    const take = (pcs: Piece[]) => {
      drive(pcs, true);
      for (const pc of pcs) {
        out.push(pc);
        len += pc.curve.length;
        for (const c of pc.curve) head += c * SEG;
      }
    };
    const mirror = (pcs: Piece[]): Piece[] => pcs.map((pc) => ({ ...pc, curve: pc.curve.map((c) => -c) }));
    /** Ausweichstücke, falls ein geplantes Stück einer älteren Stelle zu nahe käme (mindestens min Segmente lang) */
    const escapes = (min = 0): Piece[][] => {
      const pad = (pc: Piece): Piece[] => (pc.curve.length < min ? [pc, straight(min - pc.curve.length)] : [pc]);
      return [ramp(0.011 * scale, 10, 24, 10), ramp(-0.011 * scale, 10, 24, 10), ramp(0.02, 6, 14, 6), ramp(-0.02, 6, 14, 6), new Array(16).fill(0)]
        .map((curve) => pad({ curve }));
    };
    /** erstes Stück mit genug Abstand – sonst das mit dem meisten */
    const pickClear = (cands: Piece[][]): Piece[] => {
      let best = cands[0];
      let bestV = -Infinity;
      for (const c of cands) {
        const v = drive(c, false);
        if (v >= 0) return c;
        if (v > bestV) { bestV = v; best = c; }
      }
      return best;
    };

    // Serpentinen: Schenkel in der Richtung (Sollrichtung oder Gegenrichtung), die der Straße näher liegt
    if (serp && Math.abs(wrap(head - this.goal)) > Math.PI / 2) this.goal = wrap(this.goal + Math.PI);
    // Schenkel bleiben nah an der Sollrichtung – sonst laufen sie nach der Kehre in den vorigen hinein
    const LEG = 0.4;
    const capLeg = (pcs: Piece[]): Piece[] => {
      if (!serp) return pcs;
      const pc = pcs[0];
      const sum = pc.curve.reduce((a, c) => a + c, 0) * SEG;
      const d = wrap(head - this.goal);
      if (Math.abs(d + sum) <= LEG) return pcs;
      if (Math.abs(d - sum) <= LEG) return [{ ...pc, curve: pc.curve.map((c) => -c) }];
      const peak = pc.curve.reduce((a, c) => Math.max(a, Math.abs(c)), 0);
      let f = sum !== 0 ? (-d + Math.sign(sum) * LEG * 0.5) / sum : 0;
      if (peak * Math.abs(f) > 0.024) f = (Math.sign(f) * 0.024) / peak;
      return [{ ...pc, curve: pc.curve.map((c) => c * f) }];
    };

    // erste Passhöhe des Tages: langes Gipfelstück, dann sanfte Kurven zwischen Schneewänden
    const opening = this.sections.length === 1;
    const first = opening ? 70 : 24;
    take(pickClear([[straight(first)], ...escapes(first)]));
    while (len < n - 40) {
      let kind = choose();
      if (opening && len < 200 && (kind === 'hairpin' || kind === 'tight' || kind === 'crest')) kind = 'curve';
      // Kehre nur aus einem Schenkel heraus, der ungefähr in Sollrichtung liegt
      if (kind === 'hairpin' && Math.abs(wrap(head - this.goal)) > 0.55) kind = 'curve';
      let pcs: Piece[];
      let hair: { goal: number } | null = null;
      switch (kind) {
        case 'curve': {
          dir = back();
          pcs = capLeg([{ curve: ramp(dir * between(r, 0.006, 0.013) * scale, 10, Math.round(between(r, 14, 34)), 10) }]);
          break;
        }
        case 'sweep': {
          dir = back();
          pcs = [{ curve: ramp(dir * between(r, 0.003, 0.0065) * scale, 20, Math.round(between(r, 40, 80)), 20) }];
          break;
        }
        case 'tight': {
          dir = back();
          pcs = capLeg([{ curve: ramp(dir * between(r, 0.016, 0.023) * scale, 6, Math.round(between(r, 10, 18)), 6) }]);
          break;
        }
        case 'sbend': {
          dir = -dir;
          const k = between(r, 0.009, 0.016) * scale;
          pcs = [{ curve: [...ramp(dir * k, 8, Math.round(between(r, 8, 16)), 8), ...ramp(-dir * k, 8, Math.round(between(r, 8, 16)), 8)] }];
          break;
        }
        case 'hairpin': {
          // immer zur Gesamtrichtung hin wenden: die Serpentinen wandern so stetig weiter
          const hd = Math.sign(wrap(this.prog - this.goal)) || 1;
          const approach = straight(Math.round(between(r, 38, 50)));
          const k = between(r, 0.04, 0.046);
          // genau eine halbe Drehung, korrigiert um die aktuelle Abweichung
          const turn = Math.max(Math.PI - 0.3, Math.min(Math.PI + 0.15, Math.PI - hd * wrap(head - this.goal) * 0.8));
          const hold = Math.max(10, Math.round(turn / (k * SEG) - 5));
          pcs = [approach, { curve: ramp(hd * k, 5, hold, 5), hairpin: true }];
          hair = { goal: wrap(this.goal + hd * Math.PI) };
          break;
        }
        case 'crest': {
          const flat = Math.round(between(r, 10, 16));
          const drop = Math.round(between(r, 4, 6));
          const after = 14;
          const g: number[] = [];
          for (let j = 0; j < flat; j++) g.push(-0.006);
          const steep = -between(r, 0.15, 0.2) * (0.9 + 0.3 * D);
          for (let j = 0; j < drop; j++) g.push(steep);
          for (let j = 0; j < after; j++) g.push(steep * (1 - (j + 1) / (after + 1)) - 0.03 * ((j + 1) / (after + 1)));
          pcs = [{ curve: new Array(g.length).fill(0), grade: g, crest: true }];
          break;
        }
        default:
          pcs = [straight(Math.round(between(r, 18, 55)))];
      }
      if (!hair && kind !== 'straight' && chance(r, 0.5)) pcs.push(straight(Math.round(between(r, 8, 22))));
      let chosen = pcs;
      if (drive(pcs, false) < 0) {
        // zu nah an einem älteren Stück: gespiegelt, gekürzt oder ein Ausweichstück
        const alts: Piece[][] = hair ? [] : [mirror(pcs)];
        if (!hair && pcs.length > 1) alts.push([pcs[0]], mirror([pcs[0]]));
        chosen = pickClear([pcs, ...alts, ...escapes()]);
      }
      take(chosen);
      if (hair && chosen === pcs) this.goal = hair.goal;
    }
    const rest = Math.max(0, n - len);
    if (rest > 0) take(pickClear([[straight(rest)], ...escapes(rest)]));
    return out;
  }

  // ---------------------------------------------------------------- Seiten

  private sides(biome: BiomeId, D: number): [Side, Side] {
    const r = this.rng;
    const up = (): Side => {
      switch (biome) {
        case 'pass': return chance(r, 0.6)
          ? { ground: 'rock', tilt: 0.5, barrier: 'none', wall: between(r, 5, 13), drop: false }
          : { ground: 'snow', tilt: 0.38, barrier: 'none', wall: 0, drop: false };
        case 'alpine': return chance(r, 0.22)
          ? { ground: 'rock', tilt: 0.3, barrier: 'none', wall: between(r, 1.6, 4), drop: false }
          : { ground: 'meadow', tilt: between(r, 0.18, 0.32), barrier: chance(r, 0.25) ? 'fence' : 'none', wall: 0, drop: false };
        case 'forest': return chance(r, 0.3)
          ? { ground: 'rock', tilt: 0.45, barrier: 'none', wall: between(r, 3, 9), drop: false }
          : { ground: 'forest', tilt: between(r, 0.2, 0.4), barrier: 'none', wall: 0, drop: false };
        case 'village': return { ground: 'pavement', tilt: 0, barrier: 'none', wall: 0, drop: false };
        case 'lake': return chance(r, 0.5)
          ? { ground: 'rock', tilt: 0.4, barrier: 'none', wall: between(r, 3, 8), drop: false }
          : { ground: 'meadow', tilt: 0.15, barrier: chance(r, 0.4) ? 'stone' : 'none', wall: 0, drop: false };
        case 'vineyard': return { ground: pick(r, ['vines', 'vines', 'sunflower', 'meadow', 'field'] as Ground[]), tilt: between(r, 0.05, 0.18), barrier: chance(r, 0.2) ? 'stone' : 'none', wall: 0, drop: false };
      }
    };
    const down = (): Side => {
      switch (biome) {
        case 'pass': {
          const x = r();
          return { ground: chance(r, 0.5) ? 'snow' : 'rock', tilt: -0.9, barrier: x < 0.62 ? 'rail' : x < 0.8 ? 'stone' : 'none', wall: 0, drop: true };
        }
        case 'alpine': return chance(r, 0.45)
          ? { ground: 'meadow', tilt: -0.85, barrier: chance(r, 0.85) ? 'rail' : 'none', wall: 0, drop: true }
          : { ground: 'meadow', tilt: -between(r, 0.15, 0.3), barrier: chance(r, 0.3) ? 'fence' : 'none', wall: 0, drop: false };
        case 'forest': return chance(r, 0.4)
          ? { ground: 'forest', tilt: -0.8, barrier: 'rail', wall: 0, drop: true }
          : { ground: 'forest', tilt: -between(r, 0.15, 0.35), barrier: 'none', wall: 0, drop: false };
        case 'village': return { ground: 'pavement', tilt: 0, barrier: 'none', wall: 0, drop: false };
        case 'lake': return { ground: 'water', tilt: 0, barrier: chance(r, 0.6) ? 'rail' : 'stone', wall: 0, drop: true };
        case 'vineyard': return { ground: pick(r, ['vines', 'meadow', 'field', 'sunflower'] as Ground[]), tilt: -between(r, 0.05, 0.2), barrier: 'none', wall: 0, drop: false };
      }
    };
    // auf hoher Schwierigkeit öfter ungesicherte Abgründe
    const d = down();
    if (d.drop && d.barrier !== 'none' && biome !== 'lake' && chance(r, 0.12 * D)) d.barrier = 'none';
    const u = up();
    return this.mountain > 0 ? [d, u] : [u, d];
  }

  private surface(biome: BiomeId, k: number, n: number): Surface {
    const r = this.rng;
    switch (biome) {
      case 'village': return k > n * 0.25 && k < n * 0.8 && chance(r, 0.6) ? 'cobble' : 'asphalt';
      case 'vineyard': return chance(r, 0.35) ? 'gravel' : chance(r, 0.3) ? 'fresh' : 'asphalt';
      case 'lake': return chance(r, 0.35) ? 'fresh' : 'asphalt';
      default: return chance(r, 0.22) ? 'fresh' : 'asphalt';
    }
  }

  private villageBuildings(start: number, n: number) {
    const r = this.rng;
    const make = (from: number, to: number): Building[] => {
      const out: Building[] = [];
      let i = from;
      while (i < to) {
        const len = Math.round(between(r, 3, 6));
        const church = chance(r, 0.05);
        out.push({
          start: i, len: church ? 5 : len,
          height: church ? 14 : between(r, 6.5, 11),
          depth: between(r, 7, 11),
          setback: EDGE + between(r, 1.6, 2.6),
          color: Math.floor(r() * 7), roof: Math.floor(r() * 3), shutter: Math.floor(r() * 4),
          style: church ? 2 : chance(r, 0.3) ? 1 : 0,
          floors: church ? 1 : Math.round(between(r, 2, 3.4)),
          seed: Math.floor(r() * 1e9),
        });
        i += (church ? 5 : len) + (chance(r, 0.35) ? Math.round(between(r, 1, 4)) : 0);
      }
      return out;
    };
    const a = start + 30;
    const b = start + n - 30;
    return { L: make(a, b), R: make(a + 2, b) };
  }

  // ---------------------------------------------------------------- Deko

  private add(i: number, sp: Sprite) {
    const s = this.seg(i);
    (s.sprites ??= []).push(sp);
  }

  private decal(i: number, d: Decal) {
    const s = this.seg(i);
    (s.decals ??= []).push(d);
  }

  /** Zuschauerbereich: ebenes Gelände neben der Absperrung, damit alle auf Straßenhöhe stehen */
  private crowdZone(s: Seg) {
    s.crowd = true;
    const flat = (side: Side): Side => (side.ground === 'pavement' ? side : {
      ground: side.ground === 'rock' || side.ground === 'forest' ? 'meadow' : side.ground === 'water' ? 'meadow' : side.ground,
      tilt: 0.1, barrier: 'none', wall: 0, drop: false,
    });
    s.L = flat(s.L);
    s.R = flat(s.R);
  }

  /** Höhe des Geländes auf der Seite in Abstand dx vom Bankett */
  static groundH(side: Side, dx: number): number {
    if (side.wall > 0) return dx < 0.6 ? 0 : side.wall + (dx - 0.6) * side.tilt;
    if (side.ground === 'water') return -1.4;
    return dx * side.tilt;
  }

  private decorate(start: number, n: number, biome: BiomeId, _D: number, sec: number, marks: number[], curve: number[]) {
    const r = this.rng;
    const S = (i: number) => this.seg(i);
    const sideOf = (s: Seg, sign: number) => (sign < 0 ? s.L : s.R);
    const put = (i: number, sign: number, k: SpriteKind, dx: number, opts: Partial<Sprite> = {}) => {
      const s = S(i);
      const side = sideOf(s, sign);
      this.add(i, { k, x: sign * (EDGE + dx), h: Track.groundH(side, dx), s: opts.s ?? between(r, 0.85, 1.2), v: opts.v ?? Math.floor(r() * 4), f: opts.f ?? chance(r, 0.5), text: opts.text });
    };
    const name = this.sections[sec].name;

    // Passhöhe: Passschild, GPM-Banner, Zuschauer
    if (biome === 'pass') {
      S(start + 4).banner = { kind: 'gpm', text: name, sub: `${this.sections[sec].alt.toLocaleString('de-DE')} m` };
      put(start + 10, 1, 'passSign', 1.2, { s: 1, f: false, text: name });
      for (let i = start; i < start + 60; i++) {
        this.crowdZone(S(i));
        if (i % 2 === 0) { put(i, -1, 'crowd', 0.6, { s: 1 }); put(i, 1, 'crowd', 0.6, { s: 1 }); }
        if (i % 9 === 0) put(i, chance(r, 0.5) ? -1 : 1, 'flagpole', 2.4, { s: 1 });
      }
      for (let i = start + 14; i < start + 40; i += 7) put(i, -1, 'campervan', between(r, 6, 12), { s: 1 });
      put(start + 26, this.mountain, 'rifugio', between(r, 12, 18), { s: 1 });
    }
    if (biome === 'village') {
      put(start + 18, 1, 'townSign', 0.9, { s: 1, f: false, text: name });
      S(start + 28).banner = { kind: 'welcome', text: name };
      const mid = start + Math.round(n * 0.55);
      S(mid).banner = { kind: 'sprint', text: 'Traguardo volante', sub: name };
      for (let i = mid - 40; i < mid + 30; i++) {
        this.crowdZone(S(i));
        if (i % 2 === 0) { put(i, -1, 'crowd', 0.2, { s: 1 }); put(i, 1, 'crowd', 0.2, { s: 1 }); }
      }
      this.decal(mid - 2, { k: 'zebra', x: 0, w: ROAD_HALF, len: 2 });
    }

    // Tifosi-Nester unterwegs
    if (biome === 'alpine' || biome === 'forest' || biome === 'vineyard') {
      const at = start + Math.round(between(r, n * 0.3, n * 0.7));
      for (let i = at; i < at + 26; i++) {
        this.crowdZone(S(i));
        if (i % 2 === 0) put(i, chance(r, 0.5) ? -1 : 1, 'crowd', 0.4, { s: 1 });
      }
      // Zufallszahlen immer gleich verbrauchen – sonst hinge die ganze Strecke davon ab, ob die Namen schon geladen sind
      const useName = chance(r, 0.6) && this.names.length > 0;
      const w = useName ? `ALLEZ ${pick(r, this.names)}` : pick(r, WRITINGS);
      this.decal(at + 4, { k: 'text', x: 0, w: ROAD_HALF * 0.9, len: 6, text: w });
    }
    // Straßenmalerei auch sonst
    for (let i = start + 40; i < start + n - 20; i += Math.round(between(r, 90, 170))) {
      if (S(i).tunnel || S(i).hairpin || biome === 'village') continue;
      const useName = chance(r, 0.35) && this.names.length > 0;
      const w = useName ? pick(r, this.names) : pick(r, WRITINGS);
      this.decal(i, { k: 'text', x: chance(r, 0.5) ? -ROAD_HALF / 2 : ROAD_HALF / 2, w: ROAD_HALF * 0.42, len: 5, text: w });
    }

    for (let k = 0; k < n; k++) {
      const i = start + k;
      const s = S(i);
      if (s.tunnel) {
        s.lamp = i % 6 === 0;
        continue;
      }
      // Kehre: Schild vorher, Pfeile außen
      if (marks[k] === 1 && marks[k - 1] !== 1) {
        const outside = curve[k] > 0 ? -1 : 1;
        put(i - 28, outside > 0 ? 1 : -1, 'tornante', 0.6, { s: 1, f: false, text: String(s.hairpin) });
        this.decal(i - 16, { k: 'arrow', x: curve[k] > 0 ? ROAD_HALF / 2 : -ROAD_HALF / 2, w: 0.9, len: 3, text: curve[k] > 0 ? 'R' : 'L' });
      }
      if (Math.abs(curve[k]) > 0.012 && k % 4 === 0) {
        const outside = curve[k] > 0 ? -1 : 1;
        const side = sideOf(s, outside);
        if (side.wall === 0 && side.ground !== 'water') put(i, outside, 'chevron', 0.35, { s: 1, f: curve[k] < 0 });
      }
      if (s.crest && marks[k - 1] !== 2 && k > 0) {
        // Kuppe ankündigen
        put(i - 12, 1, 'chevron', 0.4, { s: 1, v: 9, f: false });
      }

      for (const sign of [-1, 1]) {
        const side = sideOf(s, sign);
        const bld = sign < 0 ? s.bL : s.bR;
        const near = r();
        if (side.drop && side.ground !== 'water' && near > 0.9) {
          put(i, sign, side.ground === 'snow' ? 'pineSnow' : chance(r, 0.7) ? 'pine' : 'larch', between(r, 3, 14), { s: between(r, 0.9, 1.3) });
        }
        switch (side.ground) {
          case 'snow':
            if (side.drop) { if (k % 5 === 0 && side.barrier === 'none') put(i, sign, 'snowpole', 0.2, { s: 1 }); }
            else {
              if (near < 0.05) put(i, sign, chance(r, 0.6) ? 'rock' : 'boulder', between(r, 1.5, 10));
              if (near > 0.94) put(i, sign, 'pineSnow', between(r, 4, 16));
            }
            break;
          case 'rock':
            if (side.wall > 0) {
              if (near < 0.18) put(i, sign, chance(r, 0.6) ? 'pine' : 'larch', between(r, 1.5, 9), { s: between(r, 0.7, 1.1) });
              if (near > 0.97) put(i, sign, 'rock', 0.1, { s: between(r, 0.4, 0.7) });
            } else if (!side.drop && near < 0.06) put(i, sign, 'boulder', between(r, 1.5, 8));
            break;
          case 'meadow': {
            if (side.drop) { if (near < 0.04) put(i, sign, 'pine', between(r, 6, 20), { s: between(r, 0.8, 1.2) }); break; }
            if (side.barrier === 'fence' && k % 2 === 0) put(i, sign, 'fence', 0.15, { s: 1, f: false });
            if (near < 0.07) put(i, sign, 'flowers', between(r, 0.3, 4), { s: between(r, 0.7, 1.2) });
            else if (near < 0.1) put(i, sign, 'grassTuft', between(r, 0.2, 2));
            else if (near < 0.13 && biome !== 'lake') put(i, sign, chance(r, 0.5) ? 'cow' : 'cowBW', between(r, 3, 14), { s: between(r, 0.9, 1.1) });
            else if (near < 0.16) put(i, sign, biome === 'lake' ? pick(r, ['cypress', 'palm', 'olive'] as SpriteKind[]) : pick(r, ['larch', 'pine', 'treeRound'] as SpriteKind[]), between(r, 3, 22));
            else if (near < 0.175 && biome === 'alpine') put(i, sign, chance(r, 0.5) ? 'chalet' : 'barn', between(r, 10, 22), { s: between(r, 0.9, 1.1) });
            else if (near < 0.19 && biome === 'alpine') put(i, sign, 'hay', between(r, 3, 12));
            break;
          }
          case 'forest':
            if (side.drop) { if (near < 0.35) put(i, sign, chance(r, 0.7) ? 'pine' : 'larch', between(r, 2, 12), { s: between(r, 0.9, 1.3) }); break; }
            if (near < 0.42) put(i, sign, chance(r, 0.7) ? 'pine' : 'larch', between(r, 1.2, 12), { s: between(r, 0.8, 1.3) });
            if (near > 0.92) put(i, sign, chance(r, 0.5) ? 'bush' : 'rock', between(r, 0.4, 2), { s: between(r, 0.6, 1) });
            if (near > 0.985) put(i, sign, 'logs', between(r, 1.5, 3), { s: 1 });
            break;
          case 'pavement':
            if (!bld) {
              if (near < 0.25) put(i, sign, pick(r, ['treeRound', 'tree', 'cypress'] as SpriteKind[]), between(r, 2.5, 6), { s: between(r, 0.7, 1) });
              else if (near < 0.32) put(i, sign, 'parasol', between(r, 0.8, 2), { s: 1 });
              else if (near < 0.34) put(i, sign, 'fountain', 1.2, { s: 1 });
            }
            if (k % 12 === 0) { put(i, sign, 'lamp', 0.5, { s: 1, f: sign < 0 }); s.lamp = true; }
            break;
          case 'water':
            if (near < 0.03) put(i, sign, 'boat', between(r, 20, 90), { s: between(r, 0.8, 1.3) });
            break;
          case 'vines':
            if (k % 3 === 0) for (let j = 0; j < 4; j++) put(i, sign, 'vinerow', 1.4 + j * 2.6, { s: 1, f: false, v: 0 });
            if (near < 0.03) put(i, sign, 'cypress', between(r, 4, 20));
            if (near > 0.985) put(i, sign, 'farmhouse', between(r, 14, 26), { s: 1 });
            break;
          case 'sunflower':
            if (k % 2 === 0) put(i, sign, 'sunflowers', between(r, 0.6, 2.6), { s: between(r, 0.9, 1.1) });
            if (near < 0.03) put(i, sign, 'cypress', between(r, 8, 20));
            break;
          case 'field':
            if (near < 0.05) put(i, sign, 'hay', between(r, 3, 15));
            else if (near < 0.09) put(i, sign, pick(r, ['cypress', 'olive', 'treeRound'] as SpriteKind[]), between(r, 3, 20));
            else if (near > 0.99) put(i, sign, 'farmhouse', between(r, 14, 26), { s: 1 });
            break;
        }
        // Hänge bergauf: vereinzelte Bäume und Felsen weiter oben
        if (side.tilt > 0.2 && !side.drop && r() < (side.ground === 'forest' ? 0.3 : 0.09)) {
          const dx = between(r, 12, 70);
          const kind: SpriteKind = side.ground === 'snow' ? pick(r, ['boulder', 'pineSnow', 'rock'] as SpriteKind[])
            : side.ground === 'forest' ? pick(r, ['pine', 'pine', 'larch'] as SpriteKind[])
              : pick(r, ['pine', 'larch', 'boulder', 'pine'] as SpriteKind[]);
          put(i, sign, kind, dx, { s: between(r, 0.9, 1.4) });
        }
        // Zypressen-Allee in den Weinbergen
        if (biome === 'vineyard' && Math.floor(i / 120) % 3 === 0 && k % 5 === 0 && side.ground !== 'vines') put(i, sign, 'cypress', 0.8, { s: between(r, 0.9, 1.1) });
      }

      // Belag-Details
      if (s.surface === 'asphalt' && chance(r, 0.012)) this.decal(i, { k: 'patch', x: between(r, -1.6, 1.6), w: between(r, 0.35, 0.9), len: Math.round(between(r, 1, 3)) });
      if (biome === 'village' && chance(r, 0.02)) this.decal(i, { k: 'manhole', x: between(r, -1.5, 1.5), w: 0.35, len: 1 });
      if (biome === 'alpine' && k > 40 && chance(r, 0.003)) this.decal(i, { k: 'grid', x: 0, w: ROAD_HALF, len: 2 });
    }
    this.roadsideFans(start, n, biome, marks, curve);
  }

  /**
   * Zuschauer am Straßenrand außerhalb der großen Fanzonen: kleine Grüppchen alle 60–120 m und
   * eine Traube in jeder Kehre (innen). Eigener Zufall, damit die Strecke selbst gleich bleibt.
   */
  private roadsideFans(start: number, n: number, biome: BiomeId, marks: number[], curve: number[]) {
    if (biome === 'village') return;
    const rr = mulberry32((this.seed ^ Math.imul(start + 1, 0x9e3779b1)) >>> 0);
    const ok = (s: Seg, side: Side) => !s.tunnel && !s.crowd && !side.drop && side.wall === 0 && side.ground !== 'water'
      && side.ground !== 'pavement' && Math.abs(side.tilt) < 0.45 && !(side === s.L ? s.bL : s.bR);
    const place = (i: number, sg: number, v: number) => {
      const s = this.seg(i);
      const side = sg < 0 ? s.L : s.R;
      if (!ok(s, side)) return false;
      const dx = v === 8 ? 0.4 : 0.35 + rr() * 0.5;
      this.add(i, { k: 'crowd', x: sg * (EDGE + dx), h: Track.groundH(side, dx), s: 1, v, f: false });
      return true;
    };
    let next = start + 12 + Math.floor(rr() * 25);
    for (let k = 1; k < n - 2; k++) {
      const i = start + k;
      if (marks[k] === 1 && marks[k - 1] !== 1) {
        // Kehre: Zuschauer auf der Innenseite über die ganze Kurve
        const inside = curve[k] > 0 ? 1 : -1;
        for (let j = 0; k + j < n && marks[k + j] === 1; j += 2) place(i + j, inside, 8);
        continue;
      }
      if (i >= next && marks[k] !== 1) {
        if (place(i, rr() < 0.5 ? -1 : 1, 9)) next = i + 20 + Math.floor(rr() * 22);
        else next = i + 3;
      }
    }
  }

  // ---------------------------------------------------------------- Flaschen und Hindernisse

  private items(start: number, n: number, biome: BiomeId, D: number) {
    const r = this.rng;
    const addObj = (o: Obj) => {
      const s = this.segAt(o.z);
      if (s.tunnel && o.k === 'cow') return;
      (s.objs ??= []).push(o);
    };
    const free = (i: number) => {
      const s = this.seg(i);
      return !s.hairpin && !s.crowd && !(s.decals?.some((d) => d.k === 'text'));
    };
    // Flaschenreihen
    for (let i = start + 30; i < start + n - 20; i += Math.round(between(r, 45, 80))) {
      const pattern = r();
      const x0 = between(r, -ROAD_HALF + 0.6, ROAD_HALF - 0.6);
      const count = Math.round(between(r, 4, 7));
      for (let j = 0; j < count; j++) {
        const x = pattern < 0.4 ? x0 : pattern < 0.75 ? x0 + Math.sin(j * 0.9) * 1.2 : x0 + (j - count / 2) * 0.45;
        addObj({ k: 'bidon', z: (i + j * 2.5) * SEG, x: Math.max(-ROAD_HALF + 0.4, Math.min(ROAD_HALF - 0.4, x)), r: 0.45, ph: r() * 6 });
      }
    }
    // goldene Flasche: selten, an kniffligen Stellen
    if (chance(r, 0.6)) {
      for (let k = 30; k < n - 30; k++) {
        const s = this.seg(start + k);
        if (s.hairpin && !this.seg(start + k - 1).hairpin) {
          addObj({ k: 'gold', z: (start + k + 12) * SEG, x: s.curve > 0 ? ROAD_HALF - 0.5 : -ROAD_HALF + 0.5, r: 0.5, ph: 0 });
          break;
        }
      }
    }
    // Hindernisse
    const per100 = 0.45 + 1.6 * D;
    const count = Math.round((n * SEG / 100) * per100);
    for (let c = 0; c < count; c++) {
      const i = start + Math.round(between(r, 40, n - 25));
      if (!free(i)) continue;
      const s = this.seg(i);
      const z = i * SEG + r() * SEG;
      const x = between(r, -ROAD_HALF + 0.5, ROAD_HALF - 0.5);
      const roll = r();
      if (s.tunnel) { addObj({ k: 'puddle', z, x, r: 0.8 }); continue; }
      switch (biome) {
        case 'pass':
          addObj(roll < 0.55 ? { k: 'rock', z, x, r: 0.42 } : roll < 0.85 ? { k: 'pothole', z, x, r: 0.45 } : { k: 'puddle', z, x, r: 0.9 });
          break;
        case 'alpine':
          if (roll < 0.38) addObj({ k: 'cow', z, x: chance(r, 0.5) ? -EDGE - 1.5 : EDGE + 1.5, r: 0.85, vx: 0, ph: r() * 6 });
          else addObj(roll < 0.7 ? { k: 'pothole', z, x, r: 0.45 } : { k: 'rock', z, x, r: 0.4 });
          break;
        case 'forest':
          addObj(roll < 0.4 ? { k: 'rock', z, x, r: 0.4 } : roll < 0.75 ? { k: 'puddle', z, x, r: 0.9 } : { k: 'pothole', z, x, r: 0.45 });
          break;
        case 'village': {
          // Baustelle: Hütchenreihe auf einer Spur
          const lane = chance(r, 0.5) ? -1 : 1;
          for (let j = 0; j < 5; j++) addObj({ k: 'cone', z: z + j * 3, x: lane * (ROAD_HALF * 0.55 + (j === 0 || j === 4 ? 0.4 : 0)), r: 0.3 });
          break;
        }
        case 'lake':
          addObj(roll < 0.5 ? { k: 'puddle', z, x, r: 0.9 } : { k: 'pothole', z, x, r: 0.45 });
          break;
        case 'vineyard':
          addObj(roll < 0.5 ? { k: 'pothole', z, x, r: 0.45 } : roll < 0.75 ? { k: 'rock', z, x, r: 0.38 } : { k: 'cone', z, x, r: 0.3 });
          break;
      }
    }
  }
}

