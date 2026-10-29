/**
 * Strecke für „Abfahrt“: eine endlose Passabfahrt aus Segmenten (je 2 m).
 * Jede Abfahrt läuft durch mehrere Täler (Passhöhe, Almen, Bergwald, Dorf, See oder Weinberge)
 * und endet in einem Tunnel, hinter dem der nächste Pass beginnt. Alles ist aus dem Tages-Seed
 * erzeugt, damit am selben Tag alle dieselbe Strecke fahren.
 */
import { between, chance, hashStr, mulberry32, pick, shuffle, type Rng } from './rng';
import { STYLE, type Lang } from './facade';
import type { StageRef } from './stageRef';
import { finaleGrade, type FinaleSpec } from './finale';
import { LOOKS, pickWeighted, type Region } from './region';
import { applyEditsRange, bumpsOf, deriveForSection, emptyDerived, type Derived, type TerrainBump, type WorldEdits } from './worldEdits';

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
  /** Wand als gemauerte Stützmauer (vor Tunnelportalen) statt Fels */
  stone?: boolean;
}

export interface Building {
  start: number;
  len: number;          // Segmente
  depth: number;
  setback: number;      // Abstand der Fassade zur Straßenmitte (m)
  /** Baustil = Band im Fassadenatlas (siehe STYLE in facade.ts) */
  style: number;
  /** Obergeschosse über dem Erdgeschoss */
  floors: number;
  seed: number;
  /** Ladenschild (Index im Schilderatlas, −1 = keins) und Steckschild (Apothekenkreuz, Tabak; −1 = keins) */
  sign: number;
  badge: number;
  /** Laubengang: Pfeiler und Bögen vor dem Erdgeschoss (Palazzi an der Piazza) */
  arcade?: boolean;
  /** Kirche an der Piazza: hoher Campanile */
  tall?: boolean;
}

export type SpriteKind =
  | 'pine' | 'pineSnow' | 'larch' | 'tree' | 'treeRound' | 'cypress' | 'palm' | 'olive' | 'bush' | 'flowers'
  | 'rock' | 'boulder' | 'snowpole' | 'chalet' | 'barn' | 'rifugio' | 'farmhouse' | 'cow' | 'cowBW' | 'hay'
  | 'fence' | 'vinerow' | 'sunflowers' | 'crowd' | 'chevron' | 'lamp' | 'parasol' | 'boat' | 'logs'
  | 'tornante' | 'townSign' | 'passSign' | 'fountain' | 'flagpole' | 'campervan' | 'grassTuft' | 'stoneWall' | 'poplar' | 'apple';

export interface Sprite {
  k: SpriteKind;
  x: number;        // seitlich zur Straßenmitte (m)
  h: number;        // Höhe des Fußpunkts über Straßenniveau (m)
  s: number;        // Größenfaktor
  v: number;        // Variante
  f: boolean;       // gespiegelt
  text?: string;
  /** im Welt-Editor gesetzt (Kennung der Änderung) */
  eid?: string;
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
  /** … 'start': Startbogen des Zeitfahrens, 'split': Zwischenzeit-Station */
  kind: 'gpm' | 'sprint' | 'welcome' | 'arch' | 'flamme' | 'finish' | 'gate' | 'start' | 'split';
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
  /** Requisiten der Strecke selbst, bevor der Welt-Editor Änderungen anwendet (undefined = noch unberührt) */
  sprites0?: Sprite[] | null;
  objs: Obj[] | null;
  decals: Decal[] | null;
  banner: Banner | null;
  hairpin: number;
  lamp: boolean;
  crowd: boolean;
  crest: boolean;
  /** Viadukt: Tiefe des Grabens unter der Straße (m; 0 = keine Brücke) */
  bridge: number;
}

export interface Section {
  biome: BiomeId;
  start: number;
  end: number;
  name: string;
  alt: number;      // Höhe am Anfang (m ü. NN)
  descent: number;  // laufende Nummer der Abfahrt
  /** Stadt: Piazza (Segmente von … bis) – Häuser zurückgesetzt, Brunnen, Laubengänge, Campanile */
  piazza?: [number, number];
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
/** Straßenmalereien und Zielbeschriftung in der Sprache des Etappenorts */
const WRITINGS_BY: Record<Lang, string[]> = {
  it: ['FORZA', 'VAI VAI', 'ALLEZ', 'HOPP HOPP', 'DAJE', 'BRAVO', 'GRUPPETTO', 'VAMOS', 'ATTACCA', 'TUTTO GAS'],
  fr: ['ALLEZ', 'ALLEZ ALLEZ', 'VAS-Y', 'COURAGE', 'CHAPEAU', 'GRUPPETTO', 'HOPP HOPP', 'À BLOC', 'BRAVO', 'ON Y VA'],
  en: ['GO GO GO', 'COME ON', 'ALLEZ', 'ALLEZ ALLEZ', 'HOPP HOPP', 'GRUPPETTO', 'BRAVO', 'ATTACK', 'FULL GAS', 'YES'],
  es: ['VAMOS', 'ÁNIMO', 'VENGA', 'DALE', 'ALLEZ', 'GRUPPETTO', 'BRAVO', 'A TOPE', 'OLÉ', 'HOPP HOPP'],
};
const WORDS: Record<Lang, { finish: string; last: string; gpm: string }> = {
  it: { finish: 'Arrivo', last: 'Ultimo km', gpm: 'GPM' },
  fr: { finish: 'Arrivée', last: 'Flamme rouge', gpm: 'Sommet' },
  en: { finish: 'Finish', last: 'Flamme rouge', gpm: 'KOM' },
  es: { finish: 'Meta', last: 'Último km', gpm: 'Puerto' },
};

/** Art der Strecke: endlose Passabfahrt, Sprintfinale, Bergfinale (Schlussanstieg, Abfahrt, Ziel) oder Zeitfahren */
export type TrackKind = 'descent' | 'sprint' | 'mountain' | 'tt';
/** Sprintfinale: Ziellinie nach so vielen Metern (Start = 2,4 km vor dem Ziel) */
export const SPRINT_FINISH = 2400;
/** Bergfinale: Gipfel (Bergwertung) und Ziel im Tal (Meter ab Start) */
export const MOUNTAIN_TOP = 900;
export const MOUNTAIN_FINISH = 2000;
/** Abschnittslängen (Segmente): Wald und Almen bergauf bis zum Gipfel, Passhöhe und Almen bergab, Zielort */
const MOUNTAIN_SECS = [200, MOUNTAIN_TOP / SEG - 200, 170, 220];
/**
 * Zeitfahren: 3 km ab der Startrampe im Startort, welliges Tal, Côte (Kuppe bei TT_TOP), Abfahrt, Zielort;
 * Zwischenzeiten bei 1 und 2 km. Die Strecke hängt nur vom Tag ab (nie von Rundfahrt, Namen oder Gegend),
 * damit die Geister aller Mitspieler auf genau derselben Straße fahren.
 */
export const TT_FINISH = 3000;
export const TT_TOP = 1500;
export const TT_SPLITS = [1000, 2000];
/** Abschnittslängen (Segmente): Startort, Tal, Côte bis zur Kuppe, Abfahrt; der Zielort reicht bis 250 m hinter die Linie */
const TT_SECS = [120, 400, 230, 250];
/** Erfundene Côtes für das Zeitfahren, nach Landessprache (ohne echten Anstieg der Etappe) */
const TT_CLIMBS: Record<Lang, string[]> = {
  fr: ['Côte de Saint-Roch', 'Côte des Vignes', 'Côte du Moulin', 'Côte de la Croix', 'Côte du Château', 'Côte de Bellevue'],
  it: ['Salita del Castello', 'Salita di San Martino', 'Muro di Sant’Anna', 'Salita delle Vigne', 'Salita della Madonnina', 'Muro del Mulino'],
  es: ['Alto del Castillo', 'Alto de la Ermita', 'Alto de las Viñas', 'Alto del Molino', 'Alto de la Cruz', 'Repecho de San Juan'],
  en: ['Castle Hill', 'Mill Hill', 'Church Bank', 'Beacon Hill', 'Windmill Rise', 'Chapel Brow'],
};
const SPRINT_MARKS: { z: number; kind: Banner['kind']; text: string }[] = [
  { z: SPRINT_FINISH - 2000, kind: 'arch', text: '2 km' },
  { z: SPRINT_FINISH - 1000, kind: 'flamme', text: '' },
  { z: SPRINT_FINISH - 500, kind: 'arch', text: '500 m' },
];

/** Schwierigkeit 0 … 1 nach gefahrener Strecke */
export const difficulty = (z: number): number => Math.min(1, Math.max(0, z / 9000));

interface Piece { curve: number[]; grade?: number[]; hairpin?: boolean; crest?: boolean }

export class Track {
  readonly seed: number;
  readonly dayKey: string;
  readonly title: string;
  readonly sections: Section[] = [];
  private segs: Seg[] = [];
  /** Testfahrt (Admin): keine Hindernisse auf der Strecke (Steine, Kühe, Schlaglöcher, Hütchen, Pfützen) */
  private clear = false;
  static readonly HAZARDS = new Set(['rock', 'cow', 'pothole', 'cone', 'puddle']);
  /** Änderungen aus dem Welt-Editor (Admin): gesetzte und entfernte Requisiten – wirken beim Bau jedes Abschnitts */
  private edits_: WorldEdits | null = null;
  get edits(): WorldEdits | null { return this.edits_; }
  set edits(e: WorldEdits | null) {
    this.edits_ = e;
    this.bumps_ = null;
    applyEditsRange(this, e, this.first, this.length);
  }
  /** Änderungen „überall“ (verankert an markanten Stellen) – werden je Abschnitt in derived aufgelöst */
  private global_: WorldEdits | null = null;
  get global(): WorldEdits | null { return this.global_; }
  set global(g: WorldEdits | null) {
    this.global_ = g;
    this.derived = emptyDerived();
    for (const sec of this.sections) deriveForSection(this, g, Math.max(sec.start, this.first), Math.min(sec.end, this.length));
    this.bumps_ = null;
    applyEditsRange(this, this.edits_, this.first, this.length);
  }
  derived: Derived = emptyDerived();
  private bumps_: TerrainBump[] | null = null;
  /** Hügel und Mulden (Weltkoordinaten) für das Gelände */
  get bumps(): TerrainBump[] { return (this.bumps_ ??= bumpsOf(this.edits_, this.derived)); }
  /** Stand der geladenen Änderungen (worldStore): der Renderer erkennt daran einen Wechsel */
  editsVersion = -1;
  /** Änderungen erneut auf einen Bereich (Streckenmeter) anwenden, z. B. nach einer neuen Requisite */
  reapplyEdits(z0: number, z1: number) {
    applyEditsRange(this, this.edits_, Math.floor(z0 / SEG), Math.ceil(z1 / SEG) + 1);
  }

  /**
   * Nächste Stelle der (schon gebauten) Strecke zu einem Weltpunkt: Streckenmeter z, seitliche Lage x (rechts +)
   * und Abstand in der Draufsicht. Für den Welt-Editor (Kamera, Setzen von Requisiten).
   */
  nearest(wx: number, wz: number, from = this.first, to = this.length): { z: number; x: number; d: number } {
    let best = Infinity;
    let bi = Math.max(from, this.first);
    const end = Math.min(to, this.length);
    for (let i = Math.max(from, this.first); i < end; i++) {
      const s = this.segs[i - this.base];
      const dx = wx - s.wx;
      const dz = wz - s.wz;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; bi = i; }
    }
    const s = this.segs[bi - this.base] ?? this.segs[0];
    // entlang der Fahrtrichtung (0 = −z) projizieren, seitlich = rechts
    const fx = Math.sin(s.th);
    const fz = -Math.cos(s.th);
    const dx = wx - s.wx;
    const dz = wz - s.wz;
    const t = Math.max(-SEG, Math.min(SEG * 2, dx * fx + dz * fz));
    const x = dx * Math.cos(s.th) + dz * Math.sin(s.th);
    return { z: bi * SEG + t, x, d: Math.hypot(dx - fx * t, dz - fz * t) };
  }
  /** Hindernisse entfernen – auch aus schon gebauten Abschnitten (die Strecke selbst bleibt gleich) */
  dropHazards() {
    this.clear = true;
    for (const sg of this.segs) if (sg.objs) sg.objs = sg.objs.filter((o) => !Track.HAZARDS.has(o.k));
  }
  private base = 0;
  private rng: Rng;
  readonly names: string[];
  readonly kind: TrackKind;
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

  /** Zielort fürs Sprintfinale (z. B. der echte Zielort der Etappe) */
  private town: string;
  /** echte Vorlage (Etappe, Schlussanstieg) und Sprache für Schilder */
  readonly ref: StageRef | null;
  readonly lang: Lang;
  /** Bergfinale: Steigung nach dem echten Schlussanstieg (1 = 7,8 %) */
  private climbScale = 1;
  /** Sprintfinale: Bauplan der letzten Kilometer aus dem echten Streckentext (Kurven, Zielgerade, Steigung, Pflaster) */
  readonly finale: FinaleSpec | null;
  /** Gegend der Etappe: Bäume, Felder, Hausstile (Abfahrt immer Dolomiten) */
  readonly region: Region;

  constructor(dayKey: string, names: string[] = [], kind: TrackKind = 'descent', town: string | StageRef | null = '') {
    this.dayKey = dayKey;
    this.kind = kind;
    this.ref = typeof town === 'object' ? town : null;
    this.lang = this.ref?.lang ?? 'it';
    this.town = (typeof town === 'string' ? town : town?.town ?? '').trim().slice(0, 24);
    this.finale = kind === 'sprint' ? this.ref?.finale ?? null : null;
    this.region = kind === 'descent' ? 'dolomiten' : this.ref?.region ?? (kind === 'mountain' ? 'dolomiten' : 'po');
    if (kind === 'mountain' && this.ref?.climb?.grad) this.climbScale = Math.max(0.92, Math.min(1.1, this.ref.climb.grad / 7.8));
    this.seed = hashStr(`${kind === 'sprint' ? 'sprint' : kind === 'mountain' ? 'berg' : kind === 'tt' ? 'zeitfahren' : 'abfahrt'}:${dayKey}`);
    this.rng = mulberry32(this.seed);
    this.names = names.map((n) => n.trim().split(/\s+/)[0]?.toUpperCase()).filter((n): n is string => !!n && n.length <= 10);
    this.passOrder = shuffle(this.rng, PASSES);
    const real = kind === 'mountain' ? this.ref?.climb : null;
    if (real) this.passOrder.unshift([real.name.slice(0, 30), real.alt ?? Math.max(900, this.passOrder[0][1] - 600)]);
    this.planDescent();
    const first = this.plan[0];
    const end = this.plan.find((p, i) => i > 0 && (p.biome === 'village' || p.biome === 'lake' || p.biome === 'vineyard'));
    const pass = this.plan.find((p) => p.biome === 'pass');
    const ttEnd = kind === 'tt' ? this.plan[4] : null;
    this.title = kind === 'sprint' ? `Sprintfinale in ${end?.name ?? 'der Stadt'}`
      : kind === 'mountain' ? (Track.same(pass?.name ?? '', end?.name ?? '') ? pass!.name : `${pass?.name ?? 'Pass'} → ${end?.name ?? 'Tal'}`)
        : kind === 'tt' ? (Track.same(first.name, ttEnd?.name ?? '') ? `Zeitfahren in ${ttEnd?.name ?? first.name}` : `${first.name} → ${ttEnd?.name ?? 'Ziel'}`)
          : `${first.name} → ${end?.name ?? 'Tal'}`;
  }

  /**
   * Zeitfahren: Steigung an Streckenmeter z. Startrampe, flach durch den Startort, welliges Tal, Côte
   * (4,5 % → 8,5 % → flacher zur Kuppe), über die Kuppe in die Abfahrt (−6,5 %), auslaufend in den Zielort, flach ins Ziel.
   * wave: kleine Wellen (±2,5 %) – im Tal und an der Côte etwas, in den Orten kaum.
   */
  static ttGrade(z: number, wave = 0): number {
    const TWO_PI = Math.PI * 2;
    const smooth = (t: number) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };
    const valley = (zz: number) => 0.03 * Math.sin((TWO_PI * (zz - 240)) / 400) + 0.012 * Math.sin((TWO_PI * (zz - 240)) / 170 + 1);
    const climb = (zz: number) => 0.045 + 0.04 * Math.sin((Math.PI * (zz - 1040)) / 400);
    if (z < 14) return -0.09;
    if (z < 40) return -0.09 + 0.086 * ((z - 14) / 26);
    if (z < 240) return -0.004 + wave * 0.15;
    // Übergänge weich (kein Knick an den Abschnittsgrenzen)
    if (z < 280) return -0.004 + (valley(z) - -0.004) * smooth((z - 240) / 40) + wave * 0.3;
    if (z < 1040) return valley(z) + wave * 0.3;
    if (z < 1080) return valley(z) + (climb(z) - valley(z)) * smooth((z - 1040) / 40) + wave * 0.5;
    if (z < TT_TOP - 60) return climb(z) + wave * 0.5;
    if (z < TT_TOP) return climb(TT_TOP - 60) * ((TT_TOP - z) / 60);
    if (z < TT_TOP + 60) return -0.065 * ((z - TT_TOP) / 60);
    if (z < 1880) return -0.065 + wave;
    if (z < 2000) return -0.065 + 0.058 * ((z - 1880) / 120);
    return -0.004 + wave * 0.15;
  }

  /** gleicher Ort? (Bergankunft: „Grand Colombier“ als Pass und Ziel) */
  static same(a: string, b: string): boolean {
    const n = (x: string) => x.toLowerCase().replace(/[^a-zà-ÿ]/g, '');
    const x = n(a);
    const y = n(b);
    return !!x && !!y && (x.includes(y) || y.includes(x));
  }

  /** Name des Zielorts (Sprint- und Bergfinale, Zeitfahren) */
  get finishTown(): string {
    if (this.kind === 'tt') return this.places[4] ?? '';
    if (this.kind === 'mountain') return this.sections[4]?.name ?? this.plan.find((p) => p.biome === 'village')?.name ?? '';
    return this.sections[1]?.name ?? this.plan.find((p) => p.biome === 'village')?.name ?? '';
  }

  /** Ortsnamen der geplanten Abschnitte (Zeitfahren: Startort, Tal, Côte, Abfahrt, Zielort) */
  readonly places: string[] = [];
  /** Zeitfahren: Startort und Côte (Name des Anstiegs) */
  get startTown(): string { return this.places[0] ?? ''; }
  get climbName(): string { return this.places[2] ?? 'Côte'; }

  /** Bergfinale: Name und Höhe des Passes (Bergwertung) */
  get summit(): { name: string; alt: number } {
    const s = this.sections.find((x) => x.biome === 'pass') ?? this.plan.find((x) => x.biome === 'pass');
    return { name: s?.name ?? 'Passo', alt: s?.alt ?? 2000 };
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
    if (this.kind === 'mountain') {
      // Schlussanstieg durch Bergwald und Almen zur Passhöhe, Abfahrt über die Almen in den Zielort
      if (this.descentNo === 0) {
        const [pass, alt] = this.passOrder[0];
        const up = pick(r, VALLEYS);
        const down = pick(r, VALLEYS.filter((v) => v !== up));
        const village = pick(r, VILLAGES);
        this.plan.push({ biome: 'forest', name: pick(r, FORESTS), alt: Math.round((alt - 150) / 5) * 5, descent: 0 });
        this.plan.push({ biome: 'alpine', name: up, alt: Math.round((alt - 80) / 5) * 5, descent: 0 });
        this.plan.push({ biome: 'pass', name: pass, alt, descent: 0 });
        this.plan.push({ biome: 'alpine', name: down, alt: Math.round((alt - 60) / 5) * 5, descent: 0 });
        this.plan.push({ biome: 'village', name: this.town || village, alt: Math.round((alt - 150) / 5) * 5, descent: 0 });
      } else this.plan.push({ biome: 'village', name: this.sections[4]?.name ?? pick(r, VILLAGES), alt: 1200, descent: 0 });
      this.descentNo += 1;
      return;
    }
    if (this.kind === 'tt') {
      // Startort, welliges Tal (See oder Weinberge), Côte durch den Wald, Abfahrt durch die Weinberge, Zielort; danach Auslauf.
      // Die Zufallszahlen werden immer in derselben Reihenfolge verbraucht – echte Ortsnamen ersetzen nur den Text.
      if (this.descentNo === 0) {
        const from = (this.ref?.from ?? '').trim().slice(0, 24);
        const start = pick(r, VILLAGES);
        const lower: BiomeId = chance(r, 0.5) ? 'lake' : 'vineyard';
        const valley = lower === 'lake' ? pick(r, LAKES) : pick(r, HILLS);
        const climbIdx = Math.floor(r() * TT_CLIMBS.it.length);
        const climb = this.ref?.climb?.name?.slice(0, 30) || TT_CLIMBS[this.lang][climbIdx];
        const hills = pick(r, HILLS.filter((h) => h !== valley));
        const finish = pick(r, VILLAGES.filter((v) => v !== start));
        this.plan.push({ biome: 'village', name: from || start, alt: 250, descent: 0 });
        this.plan.push({ biome: lower, name: valley, alt: 245, descent: 0 });
        this.plan.push({ biome: 'forest', name: climb, alt: 240, descent: 0 });
        this.plan.push({ biome: 'vineyard', name: hills, alt: 275, descent: 0 });
        this.plan.push({ biome: 'village', name: this.town || finish, alt: 245, descent: 0 });
        this.places.push(...this.plan.map((p) => p.name));
      } else this.plan.push({ biome: 'village', name: this.places[4] ?? pick(r, VILLAGES), alt: 245, descent: 0 });
      this.descentNo += 1;
      return;
    }
    if (this.kind === 'sprint') {
      // flach durchs Tal (See oder Weinberge), dann in die Zielstadt; danach Auslauf
      if (this.descentNo === 0) {
        const lower: BiomeId = chance(r, 0.5) ? 'lake' : 'vineyard';
        this.plan.push({ biome: lower, name: lower === 'lake' ? pick(r, LAKES) : pick(r, HILLS), alt: 240, descent: 0 });
        const village = pick(r, VILLAGES);
        this.plan.push({ biome: 'village', name: this.town || village, alt: 220, descent: 0 });
      } else this.plan.push({ biome: 'village', name: this.sections[1]?.name ?? pick(r, VILLAGES), alt: 210, descent: 0 });
      this.descentNo += 1;
      return;
    }
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
    const sprint = this.kind === 'sprint';
    const mountain = this.kind === 'mountain';
    const tt = this.kind === 'tt';
    /** Rennen (Sprint, Berg, Zeitfahren): feste Längen, keine Hindernisse, keine Tunnel */
    const race = sprint || mountain || tt;
    const secIndex = this.sections.length;
    let n = Math.round(LENGTH[p.biome] * between(r, 0.9, 1.12));
    // Sprintfinale: 1,2 km Anfahrt, Zielstadt bis 250 m hinter die Linie, dann Auslauf
    if (sprint) n = secIndex === 0 ? 600 : secIndex === 1 ? SPRINT_FINISH / SEG - 600 + 125 : 300;
    // Bergfinale: Gipfel genau bei MOUNTAIN_TOP, Ziel 250 m vor dem Ende des Zielorts
    if (mountain) n = secIndex < 4 ? MOUNTAIN_SECS[secIndex] : secIndex === 4 ? MOUNTAIN_FINISH / SEG - MOUNTAIN_SECS.reduce((a, b) => a + b, 0) + 125 : 300;
    // Zeitfahren: Kuppe genau bei TT_TOP, Ziel 250 m vor dem Ende des Zielorts
    if (tt) n = secIndex < 4 ? TT_SECS[secIndex] : secIndex === 4 ? TT_FINISH / SEG - TT_SECS.reduce((a, b) => a + b, 0) + 125 : 300;
    const last = !race && this.plan.length === 0;   // letzter Abschnitt der Abfahrt → Tunnel zum nächsten Pass
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
    const base = sprint ? -0.006 : BASE_GRADE[p.biome] * (1 + 0.32 * D);
    const wav = sprint ? 0.25 : 1;
    const ph1 = r() * 6.28;
    const ph2 = r() * 6.28;
    for (let k = 0; k < n; k++) {
      if (grade[k] !== 0) continue;
      const wave = 0.016 * Math.sin((start + k) / 37 + ph1) + 0.009 * Math.sin((start + k) / 13 + ph2);
      if (tt) {
        grade[k] = Track.ttGrade((start + k) * SEG, wave);
        continue;
      }
      if (mountain) {
        // bergauf 7–10 % (oben am steilsten), über die Passhöhe, bergab, flache Zielgerade
        const z = (start + k) * SEG;
        let g: number;
        if (z < MOUNTAIN_TOP - 70) g = (0.072 + 0.012 * Math.min(1, z / MOUNTAIN_TOP) + wave * 0.9) * this.climbScale;
        else if (z < MOUNTAIN_TOP) g = 0.075 * ((MOUNTAIN_TOP - z) / 70) + 0.012;
        else if (z < MOUNTAIN_TOP + 50) g = 0.012 - 0.082 * ((z - MOUNTAIN_TOP) / 50);
        else if (z < MOUNTAIN_FINISH - 420) g = -0.072 + wave;
        else if (z < MOUNTAIN_FINISH - 120) g = -0.072 + 0.062 * ((z - (MOUNTAIN_FINISH - 420)) / 300);
        else g = -0.01;
        if (marks[k] === 1) g *= 0.6;
        grade[k] = z < MOUNTAIN_TOP ? Math.max(0.012, g) : Math.min(-0.004, g);
        continue;
      }
      let g = base + wave * wav;
      if (marks[k] === 1) g *= 0.55;
      if (sprint) {
        // echtes Finale: Zielgerade und letzter Kilometer mit der Steigung aus dem Streckentext
        const fg = this.finale ? finaleGrade(this.finale, SPRINT_FINISH - (start + k) * SEG) : null;
        grade[k] = fg !== null ? fg + wave * 0.15 : g;
        continue;
      }
      grade[k] = Math.min(-0.004, g);
    }
    if (sprint && this.finale) {
      // Übergänge glätten (kein Knick, wo die Steigung wechselt)
      const sm = grade.slice();
      for (let k = 0; k < n; k++) {
        let a = 0;
        let c = 0;
        for (let q = -8; q <= 8; q++) { const j = k + q; if (j >= 0 && j < n) { a += grade[j]; c++; } }
        sm[k] = a / c;
      }
      for (let k = 0; k < n; k++) grade[k] = sm[k];
    }

    // 2) Seiten, Beläge, Deko
    const tunnelLen = last ? Math.round(between(r, 70, 100)) : 0;
    const shortTunnel = !race && !last && (p.biome === 'pass' || p.biome === 'forest') && chance(r, 0.55)
      ? { at: Math.round(between(r, n * 0.35, n * 0.6)), len: Math.round(between(r, 30, 55)) } : null;
    const tunnels: [number, number][] = [];
    if (tunnelLen) tunnels.push([n - tunnelLen, n]);
    if (shortTunnel) tunnels.push([shortTunnel.at, shortTunnel.at + shortTunnel.len]);
    // Weiler unterwegs: ein gerades Stück mit Häusern zu beiden Seiten (am Schlussanstieg, in Almtälern,
    // im Sprintfinale auf der Anfahrt)
    const hamlet = this.hamletRange(p.biome, n, marks, curve, secIndex);
    // Viadukt über einen Graben: ein gerades Stück ohne Kehre, Tunnel, Weiler – der Graben läuft quer zur Straße
    const bridge = new Array<number>(n).fill(0);
    // eigener Zufallsstrom: die übrige Strecke (Hindernisse, Deko) bleibt dieselbe wie ohne Brücke
    const rb = mulberry32((this.seed * 7 + start * 131 + 17) >>> 0);
    // Sprint: auf der Anfahrt eine Flussbrücke in die Stadt (am Wasser fast immer); Zeitfahren: im Tal
    const wantBridge = sprint ? secIndex === 0 && chance(rb, this.finale?.waterfront ? 0.9 : 0.55)
      : tt ? secIndex === 1 && chance(rb, 0.75)
        : race ? false : chance(rb, 0.6);
    if (p.biome !== 'village' && wantBridge) {
      const BL = 16;      // Brücke (Segmente)
      const RL = 12;      // Rampen davor und danach (der Graben läuft aus)
      const clear = (k: number) => k >= 0 && k < n && marks[k] === 0 && Math.abs(curve[k]) < 0.012 && !tunnels.some(([a, b]) => k >= a - 40 && k < b + 40)
        && !(hamlet && k >= hamlet[0] - 20 && k < hamlet[1] + 20) && !(p.descent === 0 && p.biome === 'pass' && this.sections.length === 1 && k >= 50 && k < 210);
      let ok = false;
      let k0 = 0;
      for (let tries = 0; tries < 12 && !ok; tries++) {
        k0 = Math.round(between(rb, 60, Math.max(61, n - 60 - BL)));
        ok = true;
        for (let k = k0 - RL; k < k0 + BL + RL && ok; k++) if (!clear(k)) ok = false;
      }
      if (ok) {
        const D = between(rb, 7, 12);
        for (let k = k0 - RL; k < k0 + BL + RL; k++) {
          const t = k < k0 ? (k - (k0 - RL) + 1) / (RL + 1) : k >= k0 + BL ? (k0 + BL + RL - k) / (RL + 1) : 1;
          bridge[k] = D * t * t * (3 - 2 * t);
        }
      }
    }
    const buildings = p.biome === 'village' ? this.villageBuildings(start, n, 'town', curve, marks)
      : hamlet ? this.villageBuildings(start + hamlet[0], hamlet[1] - hamlet[0], 'hamlet', undefined, undefined, p.biome) : { L: [], R: [] };

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

    // Kehren: Innenseite als gemauerte Stützmauer (die Straße ist in den Hang gebaut) – ein Stück davor und
    // danach taucht sie aus dem Boden auf (hp: Seite der Mauer, hpW: ihre Höhe)
    const hp = new Array<number>(n).fill(0);
    const hpW = new Array<number>(n).fill(0);
    for (let k = 0; k < n; k++) {
      if (marks[k] !== 1 || (k > 0 && marks[k - 1] === 1)) continue;
      let b = k;
      while (b < n && marks[b] === 1) b++;
      const d = curve[Math.min(n - 1, k + 3)] > 0 ? 1 : -1;
      const a0 = Math.max(0, k - 12);
      const b0 = Math.min(n, b + 12);
      for (let q = a0; q < b0; q++) {
        const t = (q - a0) / Math.max(1, b0 - 1 - a0);
        const ends = Math.min(1, (q - a0 + 1) / 5, (b0 - q) / 5);
        hp[q] = d;
        hpW[q] = (1.3 + 1.1 * Math.sin(Math.PI * t) + 0.25 * Math.sin(q * 0.9)) * ends;
      }
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
      if (hamlet && k >= hamlet[0] - 6 && k < hamlet[1] + 6) {
        l = { ground: 'pavement', tilt: 0, barrier: 'none', wall: 0, drop: false };
        rr = l;
      }
      if (hairpinOutside !== 0) {
        const fix = (s: Side): Side => (s.drop && s.barrier === 'none' ? { ...s, barrier: 'rail' } : s);
        if (hairpinOutside < 0) l = fix(l); else rr = fix(rr);
      }
      if (bridge[k] > 0) {
        // auf der Brücke: Steinbrüstung, dahinter geht es hinunter in den Graben
        const deck: Side = { ground: 'meadow', tilt: 0.12, barrier: 'stone', wall: 0, drop: false };
        l = deck;
        rr = deck;
      }
      if (hp[k] !== 0 && hpW[k] > 0.3 && p.biome !== 'village' && !hamlet) {
        const g: Ground = p.biome === 'pass' ? 'rock' : p.biome === 'forest' ? 'forest' : 'meadow';
        const mauer: Side = { ground: g, tilt: 0.5, barrier: 'none', wall: hpW[k], drop: false, stone: true };
        if (hp[k] > 0) rr = mauer; else l = mauer;
      }

      const forced = sprint ? this.finaleSurface(start + k) : null;
      if (forced) {
        if (surface !== forced) surfaceRun = 0;
        surface = forced;
      } else if (surfaceRun <= 0) {
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
      // Anfahrt zum Tunnel: niedrige gemauerte Stützmauern, dahinter steigt der Hang steil zum Berg an
      const ahead = tunnels.find(([a]) => k < a && k >= a - 45);
      if (ahead) {
        const t = 1 - (ahead[0] - k) / 45;
        const g: Ground = p.biome === 'pass' ? 'rock' : p.biome === 'forest' ? 'forest' : 'meadow';
        const cut: Side = { ground: g, tilt: 0.55 + t * 0.35, barrier: 'none', wall: 0.9 + t * 1.5, drop: false, stone: true };
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
        bridge: bridge[k],
      };
      this.y += grade[k] * SEG;
      const thMid = this.th + curve[k] * SEG * 0.5;
      this.wx += Math.sin(thMid) * SEG;
      this.wz -= Math.cos(thMid) * SEG;
      this.th += curve[k] * SEG;
      this.segs.push(seg);
    }
    // Wände (Fels, Schnee, Mauern) laufen an ihren Enden aus statt mit einer senkrechten Stirnseite zu enden
    this.taperWalls(start, n);

    this.decorate(start, n, p.biome, D, secIndex, marks, curve);
    if (sprint) this.sprintDeco(start, n, secIndex);
    else if (mountain) this.mountainDeco(start, n);
    else if (tt) this.ttDeco(start, n, secIndex);
    else this.items(start, n, p.biome, D);
    if (this.global_) { deriveForSection(this, this.global_, start, start + n); this.bumps_ = null; }
    if (this.edits_ || this.global_) applyEditsRange(this, this.edits_, start, start + n);
  }

  /**
   * Zeitfahren: Startbogen mit Publikum, Zwischenzeit-Stationen bei 1 und 2 km, Côte-Schild auf der Kuppe,
   * Flamme Rouge am Ortseingang, Ziel mit dichtem Publikum. Eigener Zufall je Abschnitt – die Straße bleibt gleich.
   */
  private ttDeco(start: number, n: number, sec: number) {
    const r = mulberry32((this.seed ^ Math.imul(start + 11, 0x27d4eb2f)) >>> 0);
    const inSec = (i: number) => i >= start && i < start + n;
    const W = WORDS[this.lang];
    // die Station bei 2 km ist zugleich die Flamme Rouge (ein Kilometer bis ins Ziel)
    const marks: { z: number; kind: Banner['kind']; text: string; sub?: string }[] = [
      { z: 10, kind: 'start', text: 'Start', sub: this.places[0] ?? '' },
      ...TT_SPLITS.map((z, i) => ({ z, kind: 'split' as const, text: `Zwischenzeit ${i + 1}`, sub: TT_FINISH - z === 1000 ? W.last : `${z / 1000} km` })),
      { z: TT_TOP, kind: 'arch', text: this.climbName, sub: this.lang === 'fr' ? 'Sommet' : this.lang === 'it' ? 'Cima' : this.lang === 'es' ? 'Cima' : 'Summit' },
    ];
    for (const m of marks) {
      const i = Math.round(m.z / SEG);
      if (inSec(i)) this.seg(i).banner = { kind: m.kind, text: m.text, sub: m.sub };
    }
    const iF = TT_FINISH / SEG;
    if (inSec(iF)) {
      this.seg(iF).banner = { kind: 'finish', text: W.finish, sub: this.sections[sec].name };
      this.decal(iF, { k: 'zebra', x: 0, w: ROAD_HALF, len: 1 });
      this.decal(iF - 9, { k: 'text', x: 0, w: ROAD_HALF * 0.95, len: 6, text: W.finish.toUpperCase() });
    }
    // Startlinie unter dem Bogen und Zeitnahme-Streifen an den Stationen
    if (inSec(5)) this.decal(5, { k: 'zebra', x: 0, w: ROAD_HALF, len: 1 });
    for (const z of TT_SPLITS) { const i = z / SEG; if (inSec(i)) this.decal(i, { k: 'grid', x: 0, w: ROAD_HALF, len: 1 }); }
    for (let i = start; i < start + n; i++) {
      const s = this.seg(i);
      if (s.tunnel) continue;
      const z = i * SEG;
      const toFin = TT_FINISH - z;
      const atStart = z < 110;
      const atTop = Math.abs(z - TT_TOP) < 90;
      const atSplit = TT_SPLITS.some((sz) => Math.abs(z - sz) < 28);
      const finish = toFin > -120 && toFin < 420;
      if (!atStart && !atTop && !atSplit && !finish) continue;
      if (!s.crowd) this.crowdZone(s);
      const every = finish ? (toFin < 200 ? 1 : 2) : atStart ? (z < 40 ? 1 : 2) : 2;
      if (i % every === 0) {
        for (const sg of [-1, 1]) this.add(i, { k: 'crowd', x: sg * (EDGE + 0.3), h: 0, s: 1, v: Math.floor(r() * 4), f: chance(r, 0.5) });
      }
      if (i % 10 === 0) this.add(i, { k: 'flagpole', x: (chance(r, 0.5) ? -1 : 1) * (EDGE + 2.6), h: 0, s: 1, v: Math.floor(r() * 4), f: false });
    }
    // Namen der Mitspieler an der Côte auf der Straße
    for (let i = Math.max(start, 1040 / SEG + 20); i < Math.min(start + n, TT_TOP / SEG - 10); i += 41) {
      const useName = this.names.length > 0 && chance(r, 0.7);
      const w = useName ? `ALLEZ ${pick(r, this.names)}` : pick(r, WRITINGS_BY[this.lang]);
      this.decal(i, { k: 'text', x: 0, w: ROAD_HALF * 0.9, len: 6, text: w });
    }
  }

  /**
   * Bergfinale: Tifosi-Spalier auf dem letzten Stück zum Gipfel, Namen auf der Straße, 500-m-Bogen,
   * Flamme Rouge in der Abfahrt, Ziel im Tal mit dichtem Publikum
   */
  private mountainDeco(start: number, n: number) {
    const r = this.rng;
    const inSec = (i: number) => i >= start && i < start + n;
    const marks: { z: number; kind: Banner['kind']; text: string; sub?: string }[] = [
      { z: MOUNTAIN_TOP - 500, kind: 'arch', text: '500 m', sub: WORDS[this.lang].gpm },
      { z: MOUNTAIN_FINISH - 1000, kind: 'flamme', text: WORDS[this.lang].last },
    ];
    for (const m of marks) {
      const i = Math.round(m.z / SEG);
      if (inSec(i) && !this.seg(i).hairpin) this.seg(i).banner = { kind: m.kind, text: m.text, sub: m.sub };
    }
    const iTop = MOUNTAIN_TOP / SEG;
    const iF = MOUNTAIN_FINISH / SEG;
    if (inSec(iF)) {
      this.seg(iF).banner = { kind: 'finish', text: WORDS[this.lang].finish, sub: this.sections[this.seg(iF).sec].name };
      this.decal(iF, { k: 'zebra', x: 0, w: ROAD_HALF, len: 1 });
      this.decal(iF - 9, { k: 'text', x: 0, w: ROAD_HALF * 0.95, len: 6, text: WORDS[this.lang].finish.toUpperCase() });
    }
    for (let i = start; i < start + n; i++) {
      const s = this.seg(i);
      // Spalier zum Gipfel: die letzten 350 m immer dichter, Fahnen
      const toTop = (iTop - i) * SEG;
      const toFin = (iF - i) * SEG;
      const climb = toTop > 0 && toTop < 350;
      const finish = toFin > -120 && toFin < 400;
      if (!climb && !finish) continue;
      if (s.tunnel) continue;
      if (!s.crowd) this.crowdZone(s);
      const every = climb ? (toTop < 150 ? 1 : 2) : toFin < 200 ? 1 : 2;
      if (i % every === 0) {
        for (const sg of [-1, 1]) this.add(i, { k: 'crowd', x: sg * (EDGE + 0.3), h: 0, s: 1, v: Math.floor(r() * 4), f: chance(r, 0.5) });
      }
      if (i % 10 === 0) this.add(i, { k: 'flagpole', x: (chance(r, 0.5) ? -1 : 1) * (EDGE + 2.6), h: 0, s: 1, v: Math.floor(r() * 4), f: false });
      // Namen der Mitspieler auf der Straße zum Gipfel
      if (climb && i % 37 === 0 && !s.hairpin) {
        const useName = this.names.length > 0 && chance(r, 0.7);
        const w = useName ? `ALLEZ ${pick(r, this.names)}` : pick(r, WRITINGS_BY[this.lang]);
        this.decal(i, { k: 'text', x: 0, w: ROAD_HALF * 0.9, len: 6, text: w });
      }
    }
  }

  /** Sprintfinale: Kilometerbögen, Flamme Rouge, Ziel mit dichtem Publikum zu beiden Seiten */
  private sprintDeco(start: number, n: number, sec: number) {
    const r = this.rng;
    const inSec = (i: number) => i >= start && i < start + n;
    for (const m of SPRINT_MARKS) {
      const i = Math.round(m.z / SEG);
      if (inSec(i)) this.seg(i).banner = { kind: m.kind, text: m.text || WORDS[this.lang].last };
    }
    const iF = SPRINT_FINISH / SEG;
    if (inSec(iF)) {
      this.seg(iF).banner = { kind: 'finish', text: WORDS[this.lang].finish, sub: this.sections[sec].name };
      this.decal(iF, { k: 'zebra', x: 0, w: ROAD_HALF, len: 1 });
      this.decal(iF - 9, { k: 'text', x: 0, w: ROAD_HALF * 0.95, len: 6, text: WORDS[this.lang].finish.toUpperCase() });
    }
    // Publikum: die letzten 1,2 km immer dichter
    for (let i = Math.max(start, iF - 600); i < Math.min(start + n, iF + 60); i++) {
      const s = this.seg(i);
      if (!s.crowd) this.crowdZone(s);
      const toGo = (iF - i) * SEG;
      const every = toGo < 300 ? 1 : toGo < 700 ? 2 : 3;
      if (i % every === 0) {
        for (const sg of [-1, 1]) this.add(i, { k: 'crowd', x: sg * (EDGE + 0.3), h: 0, s: 1, v: Math.floor(r() * 4), f: chance(r, 0.5) });
      }
      if (i % 11 === 0) this.add(i, { k: 'flagpole', x: (chance(r, 0.5) ? -1 : 1) * (EDGE + 2.6), h: 0, s: 1, v: Math.floor(r() * 4), f: false });
    }
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
    // Sprintfinale: flach, ohne Kehren und Kuppen; in der Stadt ein paar enge Ecken (Position zählt!)
    const sprint = this.kind === 'sprint';
    if (sprint) {
      W[biome] = biome === 'village'
        ? [['straight', 0.42], ['curve', 0.33], ['tight', 0.25]]
        : [['straight', 0.35], ['curve', 0.35], ['sweep', 0.3]];
    }
    // Bergfinale: Serpentinen bergauf und bergab, keine Kuppen; im Zielort nur noch sanfte Kurven
    const mountain = this.kind === 'mountain';
    if (mountain) {
      W[biome] = biome === 'village' ? [['straight', 0.55], ['curve', 0.45]]
        : biome === 'pass' ? [['straight', 0.2], ['curve', 0.2], ['tight', 0.12], ['hairpin', 0.48]]
          : biome === 'forest' ? [['straight', 0.22], ['curve', 0.3], ['tight', 0.12], ['hairpin', 0.36]]
            : this.sections.length <= 2 ? [['straight', 0.2], ['curve', 0.28], ['tight', 0.12], ['hairpin', 0.4]]
              : [['straight', 0.2], ['curve', 0.24], ['tight', 0.14], ['sbend', 0.08], ['hairpin', 0.34]];
    }
    // Zeitfahren: keine Kehren, keine Kuppen – flüssige Kurven, in den Orten enge Ecken, in der Abfahrt zählt die Linie
    const tt = this.kind === 'tt';
    if (tt) {
      const sec = this.sections.length;
      W[biome] = sec === 1 ? [['straight', 0.4], ['curve', 0.35], ['tight', 0.25]]
        : sec === 2 ? [['straight', 0.3], ['curve', 0.4], ['sweep', 0.3]]
          : sec === 3 ? [['straight', 0.25], ['curve', 0.45], ['tight', 0.3]]
            : sec === 4 ? [['straight', 0.22], ['curve', 0.4], ['tight', 0.38]]
              : [['straight', 0.45], ['curve', 0.35], ['tight', 0.2]];
    }
    // Zielgerade: die letzten 600 m vor dem Ziel (und dahinter) schnurgerade; im Bergfinale 300 m, im Zeitfahren 250 m
    // echtes Finale: ab der letzten Kurve gerade, davor die Kurven des Streckentexts an ihrer Stelle
    const fin = sprint ? this.finale : null;
    const lastCorner = fin?.lastCorner ?? null;
    const straightFrom = sprint && lastCorner !== null ? Math.max(0, (SPRINT_FINISH - lastCorner) / SEG - start)
      : sprint && this.sections.length === 2 ? SPRINT_FINISH / SEG - 300 - start
        : mountain && this.sections.length === 5 ? MOUNTAIN_FINISH / SEG - 150 - start
          : tt && this.sections.length === 5 ? TT_FINISH / SEG - 125 - start : Infinity;
    /** geplante Kurven: Segment, an dem die Kurve endet, Richtung, Anzahl */
    const script = (fin?.corners ?? [])
      .map((c) => ({ end: (SPRINT_FINISH - c.at) / SEG - start, dir: c.dir, n: c.n }))
      .filter((c) => c.end > 30 && c.end <= n - 20);
    const cornerPieces = (c: { dir: 'L' | 'R' | null; n: number }): Piece[] => {
      const d = c.dir === 'L' ? -1 : c.dir === 'R' ? 1 : (chance(r, 0.5) ? 1 : -1);
      const pcs: Piece[] = [];
      for (let q = 0; q < c.n; q++) {
        if (q > 0) pcs.push(straight(8));
        pcs.push({ curve: ramp(d * (c.n > 1 ? 0.019 : 0.023), 6, c.n > 1 ? 10 : 14, 6) });
      }
      return pcs;
    };
    const pieceLen = (pcs: Piece[]) => pcs.reduce((a, pc) => a + pc.curve.length, 0);
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
    // Bergfinale: kurzer Anlauf, dann gleich Serpentinen; Zeitfahren: Startrampe und 80 m gerade durch den Ort
    const first = opening ? (mountain ? 26 : tt ? 40 : 70) : mountain ? 12 : 24;
    take(pickClear([[straight(first)], ...escapes(first)]));
    while (len < Math.min(n - 40, straightFrom)) {
      let room = Infinity;
      if (script.length) {
        // nächste geplante Kurve: so lange gerade, dass sie genau an ihrer Stelle endet
        const c = script[0];
        const pcs = cornerPieces(c);
        const from = c.end - pieceLen(pcs);
        room = from - len;
        if (room < 14) {
          script.shift();
          if (from < len) continue;
          const plan = [straight(from - len), ...pcs];
          take(drive(plan, false) < 0 ? pickClear([plan, mirror(plan), [straight(c.end - len)]]) : plan);
          continue;
        }
      }
      let kind = choose();
      // vor einer geplanten Kurve keine engen Ecken aus dem Zufall
      if (script.length && (kind === 'tight' || kind === 'sbend')) kind = 'curve';
      if (opening && len < (mountain ? 40 : tt ? 70 : 200) && (kind === 'hairpin' || kind === 'tight' || kind === 'crest')) kind = 'curve';
      // Kehre nur aus einem Schenkel heraus, der ungefähr in Sollrichtung liegt
      if (kind === 'hairpin' && Math.abs(wrap(head - this.goal)) > (mountain ? 0.75 : 0.55)) kind = 'curve';
      let pcs: Piece[];
      let hair: { goal: number } | null = null;
      switch (kind) {
        case 'curve': {
          dir = back();
          pcs = capLeg([{ curve: ramp(dir * between(r, 0.006, 0.013) * scale * (sprint ? 0.7 : 1), 10, Math.round(between(r, 14, 34)), 10) }]);
          break;
        }
        case 'sweep': {
          dir = back();
          pcs = [{ curve: ramp(dir * between(r, 0.003, 0.0065) * scale, 20, Math.round(between(r, 40, 80)), 20) }];
          break;
        }
        case 'tight': {
          dir = back();
          // Zeitfahren: in der Abfahrt richtig enge Ecken (mit 70 km/h geht es nur gebremst), sonst etwas weicher
          const ttDown = tt && this.sections.length === 4;
          pcs = capLeg([{ curve: ramp(dir * between(r, 0.016, 0.023) * scale * (sprint ? 0.75 : tt ? (ttDown ? 1.15 : 0.85) : 1), 6, Math.round(ttDown ? between(r, 12, 22) : between(r, 10, 18)), 6) }]);
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
      // nicht in die geplante Kurve hineinbauen
      if (pieceLen(pcs) > room) pcs = [straight(room)];
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
          ? { ground: 'rock', tilt: 0.5, barrier: 'none', wall: between(r, 3.5, 8), drop: false }
          : { ground: 'snow', tilt: 0.38, barrier: 'none', wall: 0, drop: false };
        case 'alpine': return chance(r, 0.22)
          ? { ground: 'rock', tilt: 0.3, barrier: 'none', wall: between(r, 1.6, 4), drop: false }
          : { ground: 'meadow', tilt: between(r, 0.18, 0.32), barrier: chance(r, 0.25) ? 'fence' : 'none', wall: 0, drop: false };
        case 'forest': return chance(r, 0.3)
          ? { ground: 'rock', tilt: 0.45, barrier: 'none', wall: between(r, 2.5, 6), drop: false }
          : { ground: 'forest', tilt: between(r, 0.2, 0.4), barrier: 'none', wall: 0, drop: false };
        case 'village': return { ground: 'pavement', tilt: 0, barrier: 'none', wall: 0, drop: false };
        case 'lake': return chance(r, 0.5)
          ? { ground: 'rock', tilt: 0.4, barrier: 'none', wall: between(r, 2.5, 5.5), drop: false }
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

  /** Sprintfinale: Pflaster laut Streckentext (ab der genannten Stelle bis kurz hinter das Ziel) */
  private finaleSurface(i: number): Surface | null {
    const f = this.finale;
    if (!f || f.cobblesFrom === null) return null;
    const toGo = SPRINT_FINISH - i * SEG;
    return toGo <= f.cobblesFrom && toGo > -80 ? 'cobble' : null;
  }

  private surface(biome: BiomeId, k: number, n: number): Surface {
    const r = this.rng;
    // Sprint: Pflaster in der Altstadt – mit echtem Streckentext nur dort, wo er es nennt (finaleSurface)
    if (this.kind === 'sprint') return biome === 'village' && !this.finale && k < n * 0.25 && chance(r, 0.5) ? 'cobble' : chance(r, 0.4) ? 'fresh' : 'asphalt';
    if (this.kind === 'mountain') return chance(r, 0.45) ? 'fresh' : 'asphalt';
    // Zeitfahren: glatter Belag – kein Pflaster, kein Schotter (die Zeiten sollen von der Fahrt abhängen)
    if (this.kind === 'tt') return chance(r, 0.4) ? 'fresh' : 'asphalt';
    switch (biome) {
      case 'village': return k > n * 0.25 && k < n * 0.8 && chance(r, 0.6) ? 'cobble' : 'asphalt';
      case 'vineyard': return chance(r, 0.35) ? 'gravel' : chance(r, 0.3) ? 'fresh' : 'asphalt';
      case 'lake': return chance(r, 0.35) ? 'fresh' : 'asphalt';
      default: return chance(r, 0.22) ? 'fresh' : 'asphalt';
    }
  }

  /**
   * Häuserzeilen: Stil, Geschosse, Läden mit Schildern je nach Landessprache und Ortsgröße.
   * Eigener Zufall je Abschnitt – die Strecke selbst bleibt davon unberührt.
   */
  private villageBuildings(start: number, n: number, mode: 'town' | 'hamlet', curve?: number[], marks?: number[], biome: BiomeId = 'village') {
    const r = mulberry32((this.seed ^ Math.imul(start + 17, 2654435761)) >>> 0);
    // Zielstadt im Sprint: Piazza auf einem geraden Stück in der ersten Hälfte (vor den Finalkurven)
    let piazza: [number, number] | null = null;
    if (mode === 'town' && this.kind !== 'descent' && curve && marks) {
      const PL = 38;
      const ok = (k: number) => k >= 0 && k < n && marks[k] === 0 && Math.abs(curve[k]) < 0.006;
      const k0s = Math.floor(between(r, 0.12, 0.3) * n);
      for (let k0 = k0s; k0 + PL < n * 0.6; k0 += 3) {
        let good = true;
        for (let k = k0 - 6; k < k0 + PL + 6 && good; k++) if (!ok(k)) good = false;
        if (good) { piazza = [start + k0, start + k0 + PL]; break; }
      }
      const sec = this.sections[this.sections.length - 1];
      if (piazza) sec.piazza = piazza;
    }
    const lang = this.lang;
    const S = STYLE;
    // Bergdörfer (Bergfinale, Dolomiten-Abfahrt, Weiler) mit Chalets und Bruchstein, Städte mit Bürgerhäusern
    const look = LOOKS[this.region];
    // Anteil Berghäuser: Abfahrt (Dolomiten) wie gehabt, Finale nach der Gegend
    const alpine = biome === 'vineyard' ? 0.1 : this.kind === 'descent' ? (mode === 'hamlet' ? 0.8 : 0.45) : mode === 'hamlet' ? Math.min(1, look.alpine + 0.3) : look.alpine;
    const byLang: number[] = lang === 'en' ? [S.backstein, S.backstein, S.backstein, S.backstein, S.creme, S.haussmann, S.fachwerk]
      : lang === 'fr' ? [S.ocker, S.lachs, S.creme, S.gelb, S.haussmann, S.haussmann, S.terrakotta, S.fachwerk, S.creme]
        : lang === 'es' ? [S.ocker, S.creme, S.creme, S.gelb, S.terrakotta, S.terrakotta, S.haussmann]
          : [S.ocker, S.lachs, S.creme, S.gelb, S.terrakotta, S.ocker, S.gelb];
    const townPool: number[] = this.kind === 'descent' ? byLang : look.town.map((k) => (S as Record<string, number>)[k]).filter((x): x is number => x !== undefined);
    const alpPool: number[] = lang === 'en' ? [S.bruchstein, S.backstein] : [S.chalet, S.chalet, S.bruchstein, S.chalet, S.creme];
    const big = this.kind === 'sprint' && mode === 'town';
    let churchAt = piazza ? piazza[0] - start + 12 : mode === 'town' ? Math.floor(between(r, 0.25, 0.6) * n) : chance(r, 0.5) ? Math.floor(n * 0.5) : -1;
    let hallAt = mode === 'town' && chance(r, big ? 1 : 0.6) ? Math.floor(between(r, 0.3, 0.8) * n) : -1;
    const shopRate = mode === 'hamlet' ? 0.12 : big ? 0.6 : 0.42;
    const make = (from: number, to: number, side: number): Building[] => {
      const out: Building[] = [];
      let i = from;
      while (i < to) {
        const inPiazza = !!piazza && i >= piazza[0] - 1 && i < piazza[1];
        let style = chance(r, alpine) ? pick(r, alpPool) : pick(r, townPool);
        if (inPiazza) style = pick(r, [S.haussmann, S.creme, S.ocker, S.gelb, S.haussmann]);
        let len = Math.round(between(r, 3, 6));
        let floors = style === S.chalet || style === S.bruchstein ? Math.round(between(r, 1, 2.2))
          : style === S.haussmann ? Math.round(between(r, 3, 4.4)) : Math.round(between(r, 2, 3.4));
        if (big && style !== S.chalet && style !== S.haussmann) floors += chance(r, 0.25) ? 1 : 0;
        if (mode === 'hamlet') floors = Math.min(floors, 2);
        let sign = -1;
        let badge = -1;
        // Kirche und Rathaus je einmal pro Ort (eine Seite)
        let tall = false;
        let arcade = false;
        if (side < 0 && churchAt >= 0 && i - start >= churchAt) { style = S.kirche; len = Math.round(between(r, 7, 9)); floors = 2; churchAt = -1; tall = inPiazza; }
        else if (inPiazza) { arcade = true; len = Math.round(between(r, 5, 8)); floors = Math.max(2, floors); }
        else if (side > 0 && hallAt >= 0 && i - start >= hallAt) {
          style = S.rathaus; len = Math.round(between(r, 6, 8)); floors = 2; hallAt = -1; sign = 7;
        } else if (style !== S.kirche && chance(r, shopRate)) {
          sign = chance(r, 0.12) ? 3 : pick(r, [0, 1, 2, 4, 5, 6]);
          if (sign === 3 && lang !== 'en') badge = 0;
          if (sign === 2) badge = lang === 'fr' ? 1 : lang === 'it' ? 2 : -1;
          if (sign === 1 && lang === 'en' && chance(r, 0.6)) badge = 3;
        }
        // kein Haus ragt von der Gasse in die Piazza hinein
        if (piazza && !inPiazza && i < piazza[0] && i + len > piazza[0] - 1) {
          len = piazza[0] - 1 - i;
          if (len < 2) { i = piazza[0] - 1; continue; }
        }
        // Piazza: Häuser weit zurück, dicht an dicht; sonst nah an der Gasse
        const setback = inPiazza ? EDGE + 8.5 : EDGE + (mode === 'hamlet' ? between(r, 2, 3.6) : between(r, 1.6, 2.6));
        if (inPiazza && i + len > piazza![1] + 1 && style !== S.kirche) len = Math.max(2, piazza![1] + 1 - i);
        out.push({
          start: i, len, floors, style, sign: inPiazza && style !== S.kirche ? -1 : sign, badge: inPiazza ? -1 : badge,
          depth: between(r, 8, 12),
          setback,
          seed: Math.floor(r() * 1e9),
          arcade: arcade || undefined,
          tall: tall || undefined,
        });
        i += len + (inPiazza ? 0 : chance(r, mode === 'hamlet' ? 0.55 : 0.3) ? Math.round(between(r, 1, mode === 'hamlet' ? 6 : 4)) : 0);
      }
      return out;
    };
    const m = mode === 'town' ? 30 : 4;
    const a = start + m;
    const b = start + n - m;
    return { L: make(a, b, -1), R: make(a + 2, b, 1) };
  }

  /** Abschnitt (k von … bis) für einen Weiler: gerade, ohne Kehren und Tunnel */
  private hamletRange(biome: BiomeId, n: number, marks: number[], curve: number[], sec: number): [number, number] | null {
    const r = mulberry32((this.seed ^ Math.imul(sec + 5, 40503)) >>> 0);
    let len = 0;
    let want = false;
    if (this.kind === 'mountain') { want = sec === 1; len = 40; }
    else if (this.kind === 'sprint') { want = sec === 0; len = 70; }
    else if (this.kind === 'tt') { want = sec === 1; len = 50; }
    // Abfahrt: Weiler auf den Almen und zwischen den Weinbergen
    else { want = (biome === 'alpine' && chance(r, 0.55)) || (biome === 'vineyard' && chance(r, 0.6)); len = biome === 'vineyard' ? 60 : 50; }
    if (!want || n < len + 60) return null;
    const ok = (k: number) => marks[k] === 0 && Math.abs(curve[k]) < (this.kind === 'mountain' ? 0.02 : 0.012);
    const startAt = Math.floor(between(r, 0.25, 0.5) * n);
    for (let k0 = startAt; k0 + len < n - 20; k0 += 3) {
      let good = true;
      for (let k = k0 - 8; k < k0 + len + 8 && good; k++) if (k < 0 || k >= n || !ok(k)) good = false;
      if (good) return [k0, k0 + len];
    }
    return null;
  }

  // ---------------------------------------------------------------- Deko

  private add(i: number, sp: Sprite) {
    const s = this.seg(i);
    (s.sprites ??= []).push(sp);
    // Welt-Editor: der Vorrat der Originale wächst mit (sonst fiele die Requisite beim nächsten Anwenden weg)
    if (s.sprites0 !== undefined) (s.sprites0 ??= []).push(sp);
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
  /** Wandhöhen an Anfang und Ende jeder Wand über ~7 Stücke ein- und ausblenden (keine Stirnseiten gegen den Himmel) */
  private taperWalls(start: number, n: number) {
    for (const which of ['L', 'R'] as const) {
      let k = 0;
      while (k < n) {
        const s0 = this.seg(start + k);
        if (!(s0[which].wall > 0) || s0.tunnel) { k++; continue; }
        let b = k;
        while (b < n && this.seg(start + b)[which].wall > 0 && !this.seg(start + b).tunnel) b++;
        const len = b - k;
        for (let q = k; q < b; q++) {
          const f = Math.min(1, (q - k + 1) / 7, (b - q) / 7);
          if (f >= 1) continue;
          const sg = this.seg(start + q);
          const side = sg[which];
          sg[which] = { ...side, wall: side.wall * (0.12 + 0.88 * f) };
        }
        void len;
        k = b;
      }
    }
  }

  static groundH(side: Side, dx: number): number {
    if (side.wall > 0) return dx < 0.6 ? 0 : side.wall + (dx - 0.6) * side.tilt;
    if (side.ground === 'water') return -1.4;
    return dx * side.tilt;
  }

  private decorate(start: number, n: number, biome: BiomeId, _D: number, sec: number, marks: number[], curve: number[]) {
    // Zeitfahren: eigener Zufall für die Deko – die Gegend (Palmen, Apfelreihen) darf die Straße der nächsten
    // Abschnitte nicht verändern, denn die Geister aller Mitspieler fahren auf genau dieser Strecke
    const r = this.kind === 'tt' ? mulberry32((this.seed ^ Math.imul(start + 3, 0x85ebca6b)) >>> 0) : this.rng;
    // Bäume der Gegend in den Tälern (Pappeln, Zypressen, Oliven, Palmen, Apfelbäume)
    const look = LOOKS[this.region];
    const vt = (): SpriteKind => pickWeighted(look.valley, r()) as SpriteKind;
    const S = (i: number) => this.seg(i);
    const sideOf = (s: Seg, sign: number) => (sign < 0 ? s.L : s.R);
    const put = (i: number, sign: number, k: SpriteKind, dx: number, opts: Partial<Sprite> = {}) => {
      const s = S(i);
      if (s.bridge > 0) return;
      const side = sideOf(s, sign);
      this.add(i, { k, x: sign * (EDGE + dx), h: Track.groundH(side, dx), s: opts.s ?? between(r, 0.85, 1.2), v: opts.v ?? Math.floor(r() * 4), f: opts.f ?? chance(r, 0.5), text: opts.text });
    };
    const name = this.sections[sec].name;

    // Passhöhe: Passschild, GPM-Banner, Zuschauer
    if (biome === 'pass') {
      // im Bergfinale steht das GPM-Banner genau auf der Passhöhe (Bergwertung)
      S(this.kind === 'mountain' ? start : start + 4).banner = { kind: 'gpm', text: name, sub: `${this.sections[sec].alt.toLocaleString('de-DE')} m` };
      put(start + 10, 1, 'passSign', 1.2, { s: 1, f: false, text: name });
      for (let i = start; i < start + 60; i++) {
        this.crowdZone(S(i));
        if (i % 2 === 0) { put(i, -1, 'crowd', 0.6, { s: 1 }); put(i, 1, 'crowd', 0.6, { s: 1 }); }
        if (i % 9 === 0) put(i, chance(r, 0.5) ? -1 : 1, 'flagpole', 2.4, { s: 1 });
      }
      for (let i = start + 14; i < start + 40; i += 7) put(i, -1, 'campervan', between(r, 6, 12), { s: 1 });
      put(start + 26, this.mountain, 'rifugio', between(r, 12, 18), { s: 1 });
    }
    if (biome === 'village' && this.kind !== 'descent') {
      // Zeitfahren: im Startort steht statt Ortsschild und Stadttor der Startbogen (ttDeco)
      const startTown = this.kind === 'tt' && sec === 0;
      if (!startTown) put(start + 18, 1, 'townSign', 0.9, { s: 1, f: false, text: name });
      // Zielstadt (Sprint- und Bergfinale): Stadttor am Ortseingang, Piazza mit Brunnen, Schirmen und Laternen
      {
        if (!startTown && Math.abs(curve[24]) < 0.01) S(start + 24).banner = { kind: 'gate', text: name };
        const pz = this.sections[sec].piazza;
        if (pz) {
          const mid = Math.round((pz[0] + pz[1]) / 2);
          put(mid, 1, 'fountain', 4.6, { s: 1.25, f: false });
          put(mid - 9, -1, 'fountain', 4.2, { s: 1, f: false });
          for (let i = pz[0] + 2; i < pz[1] - 1; i += 3) {
            const sign = chance(r, 0.5) ? -1 : 1;
            if (chance(r, 0.55)) put(i, sign, 'parasol', between(r, 1.6, 3.2), { s: 1 });
            if (i % 6 === 0) { put(i, -sign, 'lamp', 1.2, { s: 1, f: sign > 0 }); S(i).lamp = true; }
            if (chance(r, 0.3)) put(i, sign, pick(r, ['treeRound', 'cypress'] as SpriteKind[]), between(r, 5.5, 7), { s: between(r, 0.7, 0.95) });
          }
        }
      }
    } else if (biome === 'village') {
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
      const w = useName ? `ALLEZ ${pick(r, this.names)}` : pick(r, WRITINGS_BY[this.lang]);
      this.decal(at + 4, { k: 'text', x: 0, w: ROAD_HALF * 0.9, len: 6, text: w });
    }
    // Straßenmalerei auch sonst
    for (let i = start + 40; i < start + n - 20; i += Math.round(between(r, 90, 170))) {
      if (S(i).tunnel || S(i).hairpin || biome === 'village') continue;
      const useName = chance(r, 0.35) && this.names.length > 0;
      const w = useName ? pick(r, this.names) : pick(r, WRITINGS_BY[this.lang]);
      this.decal(i, { k: 'text', x: chance(r, 0.5) ? -ROAD_HALF / 2 : ROAD_HALF / 2, w: ROAD_HALF * 0.42, len: 5, text: w });
    }

    for (let k = 0; k < n; k++) {
      const i = start + k;
      const s = S(i);
      if (s.tunnel) {
        s.lamp = i % 6 === 0;
        continue;
      }
      // Kehre: oberhalb der Stützmauer Geröll, Büsche und Bäume (die Straße ist in den Hang geschnitten) –
      // mit eigenem Zufallsstrom, damit Hindernisse und übrige Deko unverändert bleiben
      if (marks[k] === 1) {
        const inner = curve[k] > 0 ? 1 : -1;
        if (k % 2 === 0) {
          const rh = mulberry32((this.seed * 3 + i * 97) >>> 0);
          const pool: SpriteKind[] = biome === 'pass' ? ['boulder', 'rock', 'rock', 'snowpole'] : biome === 'forest' ? ['pine', 'bush', 'boulder', 'pine'] : ['larch', 'bush', 'boulder', 'rock', 'larch'];
          const kind = pick(rh, pool);
          const tree = kind === 'larch' || kind === 'pine';
          put(i, inner, kind, tree ? between(rh, 3.5, 7) : between(rh, 1.2, 3.2), { s: tree ? between(rh, 0.8, 1.1) : between(rh, 0.6, 1.0), v: Math.floor(rh() * 4), f: rh() < 0.5 });
        }
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
            else if (near < 0.32) put(i, sign, 'grassTuft', between(r, 0.15, 1.4), { s: between(r, 0.7, 1.25) });
            else if (near < 0.13 && biome !== 'lake') put(i, sign, chance(r, 0.5) ? 'cow' : 'cowBW', between(r, 3, 14), { s: between(r, 0.9, 1.1) });
            else if (near < 0.16) put(i, sign, biome === 'lake' || biome === 'vineyard' || biome === 'village' ? vt() : pick(r, ['larch', 'pine', 'treeRound'] as SpriteKind[]), between(r, 3, 22));
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
            // Bäume, Schirme und Brunnen nur dort, wo auf ein paar Meter kein Haus steht (sonst ragen sie in die Fassade)
            if (!bld && ![-4, -2, 2, 4].some((d) => i + d >= start && i + d < start + n && (sign < 0 ? S(i + d).bL : S(i + d).bR))) {
              if (near < 0.25) put(i, sign, look.coast && chance(r, 0.6) ? 'palm' : this.kind === 'descent' ? pick(r, ['treeRound', 'tree', 'cypress'] as SpriteKind[]) : vt(), between(r, 2.5, 6), { s: between(r, 0.7, 1) });
              else if (near < 0.32) put(i, sign, 'parasol', between(r, 0.8, 2), { s: 1 });
              else if (near < 0.34) put(i, sign, 'fountain', 1.2, { s: 1 });
            }
            if (k % 12 === 0) { put(i, sign, 'lamp', 0.5, { s: 1, f: sign < 0 }); s.lamp = true; }
            break;
          case 'water':
            if (near < 0.03) put(i, sign, 'boat', between(r, 20, 90), { s: between(r, 0.8, 1.3) });
            // Küste: Palmen an der Promenade
            if (look.coast && near > 0.9 && k % 2 === 0) put(i, sign, 'palm', between(r, 0.8, 2.4), { s: between(r, 0.8, 1.1) });
            break;
          case 'vines':
            // Südtirol: Apfelplantagen statt Reben
            if (look.rows === 'apples') { if (k % 3 === 0) for (let j = 0; j < 4; j++) put(i, sign, 'apple', 1.8 + j * 3.0, { s: between(r, 0.75, 0.95), f: false }); }
            else if (k % 3 === 0) for (let j = 0; j < 4; j++) put(i, sign, 'vinerow', 1.4 + j * 2.6, { s: 1, f: false, v: 0 });
            if (near < 0.03) put(i, sign, vt(), between(r, 4, 20));
            if (near > 0.985) put(i, sign, 'farmhouse', between(r, 14, 26), { s: 1 });
            break;
          case 'sunflower':
            if (k % 2 === 0) put(i, sign, 'sunflowers', between(r, 0.6, 2.6), { s: between(r, 0.9, 1.1) });
            if (near < 0.03) put(i, sign, vt(), between(r, 8, 20));
            break;
          case 'field':
            if (near < 0.05) put(i, sign, 'hay', between(r, 3, 15));
            else if (near < 0.09) put(i, sign, vt(), between(r, 3, 20));
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
      if (s.surface === 'asphalt' && chance(r, 0.03)) this.decal(i, { k: 'patch', x: between(r, -1.6, 1.6), w: between(r, 0.3, 0.6), len: Math.round(between(r, 1, 3)) });
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
        if (place(i, rr() < 0.5 ? -1 : 1, 9)) next = i + 12 + Math.floor(rr() * 18);
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
      if (this.clear && Track.HAZARDS.has(o.k)) return;
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

