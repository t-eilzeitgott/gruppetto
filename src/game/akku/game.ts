/**
 * Spiellogik von „Akku leer!“: Schleudern, Spezialfähigkeiten, Schaden, Explosionen, Punkte, Ablauf.
 * Zeichnet nichts – der Renderer liest den Zustand. Die Physik läuft in festen Schritten (120 pro Sekunde),
 * das Bild dazwischen wird gemittelt (flüssig auch auf 120-Hz-Displays).
 */
import { World, type Body } from './physics';
import { LEVEL, type BlockDef, type EnemyType, type LevelDef, type Mat, type RiderType } from './level';
import { P, Particles } from './particles';

export const STEP = 1 / 120;
export const GRAVITY = 11;
/** Abschussgeschwindigkeit bei voller Spannung */
export const VMAX = 20.5;
/** größte Auslenkung des Fahrers aus der Ruhelage (m) */
export const MAX_PULL = 1.85;
/** so viele Bildschirmpixel Fingerweg ergeben volle Spannung */
export const PULL_PX = 118;
/** Schüsse ab dieser Spannung (darunter: zurück in die Schlaufe) */
const MIN_PULL = 0.28;
const INTRO_T = 2.7;
const GROUP_SHOT = 1;

export interface RiderInfo {
  name: string;
  /** Fähigkeit beim Tippen im Flug */
  ability: string;
  r: number;
  density: number;
}

export const RIDERS: Record<RiderType, RiderInfo> = {
  sprinter: { name: 'Sprinter', ability: 'Antritt', r: 0.58, density: 2.2 },
  floh: { name: 'Bergfloh', ability: 'Attacke', r: 0.5, density: 2.1 },
  wasser: { name: 'Wasserträger', ability: 'Flaschen', r: 0.58, density: 2.2 },
  zeit: { name: 'Zeitfahrer', ability: 'Aero', r: 0.58, density: 2.6 },
  gelb: { name: 'Gelbes Trikot', ability: 'Champus', r: 0.66, density: 2.4 },
};

interface MatInfo { density: number; friction: number; restitution: number; hp: number; score: number; ref: number }
export const MATS: Record<Mat, MatInfo> = {
  wood: { density: 0.6, friction: 0.7, restitution: 0.1, hp: 3.4, score: 500, ref: 0.7 },
  roof: { density: 0.55, friction: 0.7, restitution: 0.08, hp: 4.2, score: 700, ref: 1.6 },
  glass: { density: 0.45, friction: 0.35, restitution: 0.05, hp: 1.2, score: 300, ref: 0.6 },
  stone: { density: 2.2, friction: 0.85, restitution: 0.04, hp: 14, score: 1000, ref: 0.9 },
  akku: { density: 1.1, friction: 0.6, restitution: 0.04, hp: 1.9, score: 800, ref: 0.45 },
  cake: { density: 0.35, friction: 0.9, restitution: 0, hp: 0.8, score: 1500, ref: 0.22 },
};

interface EnemyInfo { r: number; hp: number; score: number; density: number }
export const ENEMIES: Record<EnemyType, EnemyInfo> = {
  opa: { r: 0.6, hp: 4.6, score: 5000, density: 1 },
  tourer: { r: 0.72, hp: 7, score: 5000, density: 1 },
  boss: { r: 0.95, hp: 17, score: 10000, density: 1.1 },
};

/** Stärken der Fahrer gegen Material (Faktor auf den Schaden) */
const VS: Record<RiderType, Partial<Record<Mat, number>>> = {
  sprinter: { wood: 2.3, roof: 2, glass: 1.3, stone: 0.8 },
  floh: { glass: 3.2, cake: 2, wood: 0.9, stone: 0.5 },
  wasser: { glass: 1.4 },
  zeit: { stone: 2.4, wood: 1.5, roof: 1.5 },
  gelb: { },
};

interface Base {
  id: number;
  body: Body;
  dead: boolean;
  /** Schaden in diesem Schritt (wird danach verrechnet) */
  pending: number;
  /** Aufblitzen nach Treffer (s) */
  flash: number;
  seed: number;
}

export interface Block extends Base {
  kind: 'block';
  mat: Mat;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  /** 0 heil, 1 angeknackst, 2 kurz vor dem Bruch */
  stage: number;
  deco: BlockDef['deco'];
}

export type Mood = 'idle' | 'scared' | 'hurt' | 'laugh' | 'cheer';

export interface Enemy extends Base {
  kind: 'enemy';
  type: EnemyType;
  r: number;
  hp: number;
  maxHp: number;
  mood: Mood;
  moodT: number;
  blink: number;
  lookX: number;
  lookY: number;
  /** angezeigter Akkustand (folgt hp/maxHp weich) */
  bat: number;
  wob: number;
  /** Schluck aus der Kaffeetasse */
  sip: number;
}

export interface Shot extends Base {
  kind: 'shot';
  type: RiderType;
  r: number;
  t0: number;
  /** erster Aufprall (Spielzeit) oder -1 */
  hitAt: number;
  used: boolean;
  resting: boolean;
  clone: boolean;
  dive: boolean;
  /** Sprinter-Antritt läuft (s) */
  dash: number;
  legs: number;
  squash: number;
  dizzy: number;
  glasses: boolean;
  blink: number;
  /** ruhig seit (s) */
  still: number;
}

export interface Bottle extends Base {
  kind: 'bottle';
  t0: number;
  owner: Shot;
  /** getroffen – platzt nach dem Physikschritt */
  pop: boolean;
}

export type Entity = Block | Enemy | Shot | Bottle;

/** wartender Fahrer neben der Schleuder (nur Bild, keine Physik) */
export interface Waiting {
  type: RiderType;
  x: number;
  y: number;
  /** Zielplatz */
  tx: number;
  ty: number;
  fx: number;
  fy: number;
  /** Hüpfer 0..1 (≥1 = steht) */
  hop: number;
  hopH: number;
  hopDur: number;
  bob: number;
  blink: number;
  cheer: number;
}

export interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  t: number;
  life: number;
  size: number;
  kind: 'score' | 'word' | 'battery' | 'small';
}

/** Gelbes Trikot nach dem Korkenknall: fliegt trudelnd davon (nur Bild) */
export interface Ghost { type: RiderType; x: number; y: number; vx: number; vy: number; rot: number; vr: number; t: number }

interface Boom { x: number; y: number; r: number; power: number; dmg: number; delay: number; kind: 'akku' | 'champ' | 'bottle' | 'stomp' }

export type Phase = 'intro' | 'aim' | 'fly' | 'won' | 'lost' | 'over';

export interface AkkuResult {
  won: boolean;
  score: number;
  stars: number;
  parts: { blocks: number; enemies: number; cake: number; bonus: number };
  ridersLeft: number;
  shots: number;
  enemiesLeft: number;
}

export interface GameEvents {
  score?: (score: number) => void;
  enemies?: (alive: number, total: number) => void;
  phase?: (p: Phase) => void;
  over?: (r: AkkuResult) => void;
  /** Kamera-Ruck, z. B. für Vibration (0..1) */
  bump?: (strength: number) => void;
}

/** fertig gesetzte Bauten je Level (Neustart ohne erneutes Setzen) */
const SETTLED = new Map<string, number[]>();

/** kleiner Zufall mit festem Startwert – die Physik bleibt wiederholbar */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const MAT_DEBRIS: Record<Mat, string[]> = {
  wood: ['#c98b4f', '#a86d38', '#e2aa6d'],
  roof: ['#b24d34', '#8f3a27', '#c98b4f'],
  glass: ['#d9f3ff', '#a9def5', '#ffffff'],
  stone: ['#b9b3a8', '#8f8a80', '#d6d0c4'],
  akku: ['#2c313b', '#4b5262', '#5be37d'],
  cake: ['#5a3220', '#fff4e4', '#d7263d'],
};

export class AkkuGame {
  readonly level: LevelDef;
  readonly world = new World();
  readonly particles = new Particles();
  readonly blocks: Block[] = [];
  readonly enemies: Enemy[] = [];
  readonly shots: Shot[] = [];
  readonly bottles: Bottle[] = [];
  readonly waiting: Waiting[] = [];
  readonly popups: Popup[] = [];
  readonly ghosts: Ghost[] = [];
  readonly rocks: Body[] = [];
  /** Rennradler in der Schlaufe */
  loaded: Waiting | null = null;
  phase: Phase = 'intro';
  /** Spielzeit (mit Zeitlupe) */
  t = 0;
  /** echte Zeit seit Start */
  rt = 0;
  phaseT = 0;
  score = 0;
  shotsFired = 0;
  /** Auslenkung aus der Ruhelage (m), solange gezogen wird */
  pull: { x: number; y: number } | null = null;
  /** Schlaufe schnalzt nach dem Abschuss (s) */
  snap = 0;
  snapX = 0;
  snapY = 0;
  /** Leuchtspur des laufenden und des letzten Schusses (x, y, Größe …) */
  trail: number[] = [];
  lastTrail: number[] = [];
  /** Kamera wackeln (0..1) */
  trauma = 0;
  timeScale = 1;
  /** Bildanteil zwischen zwei Physikschritten */
  alpha = 0;
  /** bisher erfolgreiche Abschüsse in dieser Sitzung (für den Hinweis mit der Hand) */
  launches = 0;
  readonly parts = { blocks: 0, enemies: 0, cake: 0, bonus: 0 };
  readonly totalEnemies: number;
  /** Namen der Runde (für die Straße) */
  names: string[];
  /** Akzentfarbe (Trikot des Wasserträgers) */
  team = '#7ab8ff';
  /** Finger-Hinweis zum Zurückziehen zeigen (nur in den ersten Spielen) */
  hints = true;

  private acc = 0;
  private slow = 0;
  private calmT = 0;
  private launchT = 0;
  private winAt = -1;
  private bonusIdx = 0;
  private bonusT = 0;
  private overT = 0;
  private nextId = 1;
  private booms: Boom[] = [];
  private pendingList: (Block | Enemy)[] = [];
  private readonly rand = rng(7);
  private readonly heights: Float32Array;
  private readonly hx0: number;
  private readonly events: GameEvents;
  private dragFrom: { x: number; y: number } | null = null;
  private trailT = 0;
  private settled = false;

  constructor(opts: { level?: LevelDef; events?: GameEvents; names?: string[]; team?: string; skipIntro?: boolean; hints?: boolean } = {}) {
    this.level = opts.level ?? LEVEL;
    if (opts.hints === false) this.hints = false;
    this.events = opts.events ?? {};
    this.names = opts.names ?? [];
    if (opts.team) this.team = opts.team;
    const w = this.world;
    w.gy = -GRAVITY;
    w.onImpact = (a, b, imp, x, y, nx, ny) => this.onImpact(a, b, imp, x, y, nx, ny);
    // Boden und Felsen
    this.rocks.push(w.add({ x: 10, y: -10, box: [200, 20], static: true, friction: 0.9, restitution: 0.05 }));
    for (const r of this.level.rocks) this.rocks.push(w.add({ x: 0, y: 0, poly: r, static: true, friction: 0.9, restitution: 0.05 }));
    for (const d of this.level.blocks) this.addBlock(d);
    for (const d of this.level.enemies) this.addEnemy(d.type, d.x, d.y);
    this.totalEnemies = this.enemies.length;
    // Höhe des Geländes für Partikel (alle 5 cm)
    this.hx0 = this.level.view.x0 - 10;
    const n = Math.ceil((this.level.view.x1 + 20 - this.hx0) / 0.05);
    this.heights = new Float32Array(n);
    for (let i = 0; i < n; i++) this.heights[i] = this.terrainAt(this.hx0 + i * 0.05);
    // wartende Fahrer
    this.level.riders.forEach((type, i) => {
      const x = this.slotX(i);
      const y = standY(type);
      this.waiting.push({ type, x, y, tx: x, ty: y, fx: x, fy: y, hop: 1, hopH: 0, hopDur: 0.4, bob: i * 1.7, blink: 1 + i * 0.7, cheer: 0 });
    });
    this.settle();
    if (opts.skipIntro) {
      this.phase = 'aim';
      this.loadNext(true);
    }
  }

  // ---------------------------------------------------------------- Aufbau

  private addBlock(d: BlockDef) {
    const m = MATS[d.mat];
    const body = d.poly
      ? this.world.add({ x: 0, y: 0, poly: d.poly, density: m.density, friction: m.friction, restitution: m.restitution })
      : this.world.add({ x: d.x, y: d.y, box: [d.w, d.h], density: m.density, friction: m.friction, restitution: m.restitution });
    const area = d.poly ? d.w * d.h * 0.5 : d.w * d.h;
    const hp = m.hp * Math.max(0.6, Math.min(1.7, Math.sqrt(area / m.ref)));
    const b: Block = {
      kind: 'block', id: this.nextId++, body, dead: false, pending: 0, flash: 0, seed: Math.floor(this.rand() * 1e9),
      mat: d.mat, w: d.w, h: d.h, hp, maxHp: hp, stage: 0, deco: d.deco,
    };
    body.user = b;
    this.blocks.push(b);
  }

  private addEnemy(type: EnemyType, x: number, y: number) {
    const info = ENEMIES[type];
    const body = this.world.add({ x, y, circle: info.r, density: info.density, friction: 0.8, restitution: 0.25, angularDamping: 2.5 });
    const e: Enemy = {
      kind: 'enemy', id: this.nextId++, body, dead: false, pending: 0, flash: 0, seed: Math.floor(this.rand() * 1e9),
      type, r: info.r, hp: info.hp, maxHp: info.hp, mood: 'idle', moodT: 0, blink: 1 + this.rand() * 3,
      lookX: -1, lookY: 0, bat: 1, wob: 0, sip: 2 + this.rand() * 4,
    };
    body.user = e;
    this.enemies.push(e);
  }

  /** Bauten zur Ruhe kommen lassen (vor dem ersten Bild, ohne Schaden) – beim zweiten Mal aus dem Zwischenspeicher */
  private settle() {
    const cached = SETTLED.get(this.level.name);
    const all = [...this.blocks, ...this.enemies];
    if (cached && cached.length === all.length * 3) {
      all.forEach((e, i) => {
        const b = e.body;
        b.x = cached[i * 3];
        b.y = cached[i * 3 + 1];
        b.a = cached[i * 3 + 2];
        b.px = b.x;
        b.py = b.y;
        b.pa = b.a;
        b.syncTransform();
      });
    }
    for (let i = 0; i < 360; i++) {
      this.world.step(STEP);
      if (i > 30 && this.world.awakeCount === 0) break;
    }
    if (!cached) {
      const snap: number[] = [];
      for (const e of all) snap.push(e.body.x, e.body.y, e.body.a);
      SETTLED.set(this.level.name, snap);
    }
    for (const b of this.blocks) { b.pending = 0; b.hp = b.maxHp; }
    for (const e of this.enemies) { e.pending = 0; e.hp = e.maxHp; }
    this.pendingList.length = 0;
    this.settled = true;
  }

  private slotX(i: number): number {
    return -1.3 - i * 0.98;
  }

  /** Höhe des Geländes (Boden und Felsen) an der Stelle x */
  terrainAt(x: number): number {
    let top = 0;
    for (const poly of this.level.rocks) {
      for (let i = 0; i < poly.length; i++) {
        const [ax, ay] = poly[i];
        const [bx, by] = poly[(i + 1) % poly.length];
        // obere Kanten: von rechts nach links (gegen den Uhrzeigersinn)
        if (bx >= ax) continue;
        if (x < bx || x > ax) continue;
        const t = (x - ax) / (bx - ax);
        const y = ay + t * (by - ay);
        if (y > top) top = y;
      }
    }
    return top;
  }

  floorAt = (x: number): number => {
    const i = Math.round((x - this.hx0) / 0.05);
    if (i < 0 || i >= this.heights.length) return 0;
    return this.heights[i];
  };

  get sling() { return this.level.sling; }
  get enemiesAlive(): number { return this.enemies.filter((e) => !e.dead).length; }
  get ridersLeft(): number { return this.waiting.length + (this.loaded ? 1 : 0); }

  /** Position des Fahrers in der Schlaufe (mit Auslenkung) */
  pouch(): { x: number; y: number } {
    const s = this.level.sling;
    if (this.pull) return { x: s.x + this.pull.x, y: s.y + this.pull.y };
    return { x: s.x, y: s.y };
  }

  // ---------------------------------------------------------------- Eingabe (Bildschirmpixel)

  pointerDown(sx: number, sy: number) {
    if (this.phase === 'intro') { this.skipIntro(); return; }
    if (this.phase === 'aim' && this.loaded && this.loaded.hop >= 1) {
      this.dragFrom = { x: sx, y: sy };
      this.pull = { x: 0, y: 0 };
      return;
    }
    if (this.phase === 'fly') this.useAbility();
  }

  pointerMove(sx: number, sy: number) {
    if (!this.dragFrom || !this.pull) return;
    let px = ((sx - this.dragFrom.x) / PULL_PX) * MAX_PULL;
    let py = (-(sy - this.dragFrom.y) / PULL_PX) * MAX_PULL;
    const len = Math.hypot(px, py);
    if (len > MAX_PULL) { px *= MAX_PULL / len; py *= MAX_PULL / len; }
    // nicht in den Boden ziehen
    const s = this.level.sling;
    if (s.y + py < 0.55) py = 0.55 - s.y;
    this.pull.x = px;
    this.pull.y = py;
  }

  pointerUp() {
    if (!this.dragFrom || !this.pull) return;
    const p = this.pull;
    this.dragFrom = null;
    if (Math.hypot(p.x, p.y) < MIN_PULL) {
      // zurückschnalzen ohne Schuss
      this.snap = 0.35;
      this.snapX = p.x;
      this.snapY = p.y;
      this.pull = null;
      return;
    }
    this.launch(p.x, p.y);
    this.pull = null;
  }

  /** Abschussgeschwindigkeit für eine Auslenkung */
  launchVelocity(px: number, py: number): { vx: number; vy: number } {
    const len = Math.hypot(px, py) || 1;
    const power = Math.min(1, len / MAX_PULL);
    const v = VMAX * power;
    return { vx: (-px / len) * v, vy: (-py / len) * v };
  }

  /** Abschuss mit Auslenkung (px, py) – auch für Tests */
  launch(px: number, py: number) {
    if (!this.loaded) return;
    const s = this.level.sling;
    const type = this.loaded.type;
    const info = RIDERS[type];
    const { vx, vy } = this.launchVelocity(px, py);
    const body = this.world.add({ x: s.x + px, y: s.y + py, circle: info.r, density: info.density, friction: 0.7, restitution: 0.32, angularDamping: 0.6, group: GROUP_SHOT });
    body.vx = vx;
    body.vy = vy;
    const shot: Shot = {
      kind: 'shot', id: this.nextId++, body, dead: false, pending: 0, flash: 0, seed: Math.floor(Math.random() * 1e9),
      type, r: info.r, t0: this.t, hitAt: -1, used: false, resting: false, clone: false, dive: false, dash: 0,
      legs: 0, squash: 0, dizzy: 0, glasses: true, blink: 2, still: 0,
    };
    body.user = shot;
    this.shots.push(shot);
    this.loaded = null;
    this.snap = 0.45;
    this.snapX = px;
    this.snapY = py;
    this.lastTrail = this.trail;
    this.trail = [];
    this.trailT = 0;
    this.shotsFired++;
    this.launches++;
    this.launchT = this.t;
    this.calmT = 0;
    this.setPhase('fly');
    // Staub an der Gabel
    for (let i = 0; i < 6; i++) {
      this.particles.spawn(P.Puff, s.x + px * 0.5, s.y + py * 0.5, (Math.random() - 0.5) * 2 - vx * 0.05, (Math.random() - 0.2) * 1.5, 0.45, 0.18 + Math.random() * 0.15, '#ffffff', 0, 3);
    }
  }

  /** Spezialfähigkeit des fliegenden Fahrers */
  useAbility() {
    const shot = this.shots.find((s) => !s.dead && !s.clone && !s.used && !s.resting);
    if (!shot) return;
    // nach dem Aufprall nur noch der Champagner
    if (shot.hitAt >= 0 && shot.type !== 'gelb') return;
    shot.used = true;
    const b = shot.body;
    const sp = Math.hypot(b.vx, b.vy) || 1;
    switch (shot.type) {
      case 'sprinter': {
        const v = Math.max(sp * 1.9, 25);
        b.vx = (b.vx / sp) * v;
        b.vy = (b.vy / sp) * v;
        b.gs = 0.35;
        shot.dash = 0.4;
        for (let i = 0; i < 10; i++) this.particles.spawn(P.Puff, b.x, b.y, -b.vx * 0.08 + (Math.random() - 0.5) * 2, -b.vy * 0.08 + (Math.random() - 0.5) * 2, 0.4, 0.2 + Math.random() * 0.2, '#ffffff', 0, 4);
        this.trauma = Math.min(1, this.trauma + 0.25);
        this.word(b.x, b.y + 1, 'Antritt!', '#2fb24c');
        break;
      }
      case 'floh': {
        const ang = Math.atan2(b.vy, b.vx);
        for (const da of [-0.2, 0.2]) {
          const a = ang + da;
          const c = this.world.add({ x: b.x + Math.cos(a + Math.PI / 2) * da * 2.2, y: b.y + Math.sin(a + Math.PI / 2) * da * 2.2, circle: shot.r, density: RIDERS.floh.density, friction: 0.7, restitution: 0.32, angularDamping: 0.6, group: GROUP_SHOT });
          c.vx = Math.cos(a) * sp * 1.04;
          c.vy = Math.sin(a) * sp * 1.04;
          const clone: Shot = { ...shot, id: this.nextId++, body: c, clone: true, used: true, legs: Math.random() * 6, blink: 1 + Math.random() };
          c.user = clone;
          this.shots.push(clone);
        }
        for (let i = 0; i < 12; i++) this.particles.spawn(P.Puff, b.x, b.y, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, 0.5, 0.2 + Math.random() * 0.2, '#ffffff', 0, 3);
        this.word(b.x, b.y + 1, 'Attacke!', '#e5484d');
        break;
      }
      case 'wasser': {
        for (let i = 0; i < 3; i++) {
          const bb = this.world.add({ x: b.x + (i - 1) * 0.32, y: b.y - 0.45, box: [0.24, 0.48], density: 1.6, friction: 0.5, restitution: 0.1, group: GROUP_SHOT, angle: (i - 1) * 0.4 });
          bb.vx = b.vx * 0.35 + (i - 1) * 1.4;
          bb.vy = Math.min(b.vy, 0) - 7;
          bb.w = (i - 1) * 4;
          const bottle: Bottle = { kind: 'bottle', id: this.nextId++, body: bb, dead: false, pending: 0, flash: 0, seed: i, t0: this.t, owner: shot, pop: false };
          bb.user = bottle;
          this.bottles.push(bottle);
        }
        b.vy = Math.max(b.vy, 0) + 8.5;
        b.vx *= 1.1;
        for (let i = 0; i < 8; i++) this.particles.spawn(P.Drop, b.x, b.y - 0.3, (Math.random() - 0.5) * 3, -Math.random() * 3, 0.6, 0.06 + Math.random() * 0.05, '#7fd0ff', 12);
        this.word(b.x, b.y + 1, 'Flaschen!', '#3aa8ff');
        break;
      }
      case 'zeit': {
        b.vx = b.vx * 0.22;
        b.vy = -Math.max(26, sp * 1.2);
        b.scaleMass(3);
        shot.dive = true;
        b.w = 0;
        this.trauma = Math.min(1, this.trauma + 0.2);
        this.word(b.x, b.y + 1, 'Aero!', '#c7d2ff');
        break;
      }
      case 'gelb': {
        this.champagne(shot);
        break;
      }
    }
  }

  private champagne(shot: Shot) {
    const b = shot.body;
    shot.used = true;
    this.booms.push({ x: b.x, y: b.y, r: 3.1, power: 15, dmg: 11, delay: 0, kind: 'champ' });
    this.ghosts.push({ type: 'gelb', x: b.x, y: b.y, vx: -3 - Math.random() * 2, vy: 9, rot: 0, vr: 9, t: 0 });
    shot.dead = true;
    this.world.remove(b);
    this.word(b.x, b.y + 1.4, 'Plopp!', '#ffd23f');
  }

  skipIntro() {
    if (this.phase !== 'intro') return;
    this.setPhase('aim');
    this.loadNext();
  }

  // ---------------------------------------------------------------- Ablauf

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
    this.events.phase?.(p);
  }

  /** nächsten Fahrer in die Schlaufe hüpfen lassen */
  private loadNext(instant = false) {
    // alte Fahrer verpuffen
    for (const s of this.shots) {
      if (s.dead) continue;
      this.poof(s.body.x, s.body.y, s.r, '#ffffff');
      s.dead = true;
      this.world.remove(s.body);
    }
    this.shots.length = 0;
    const next = this.waiting.shift();
    if (!next) { this.loaded = null; return; }
    const s = this.level.sling;
    next.fx = next.x;
    next.fy = next.y;
    next.tx = s.x;
    next.ty = s.y;
    next.hop = instant ? 1 : 0;
    next.hopH = 1.6;
    next.hopDur = 0.5;
    if (instant) { next.x = next.tx; next.y = next.ty; }
    this.loaded = next;
    this.waiting.forEach((w, i) => {
      w.fx = w.x;
      w.fy = w.y;
      w.tx = this.slotX(i);
      w.ty = standY(w.type);
      w.hop = instant ? 1 : -0.12 * (i + 1);
      w.hopH = 0.45;
      w.hopDur = 0.32;
      if (instant) w.x = w.tx;
    });
  }

  /** vor dem Start: nur Blinzeln und Wippen, keine Physik */
  idle(dtReal: number) {
    const dt = Math.min(0.05, Math.max(0, dtReal));
    this.rt += dt;
    this.animate(dt, dt);
  }

  update(dtReal: number) {
    const dt = Math.min(0.05, Math.max(0, dtReal));
    this.rt += dt;
    if (this.slow > 0) this.slow -= dt;
    const target = this.slow > 0 ? 0.28 : 1;
    this.timeScale += (target - this.timeScale) * Math.min(1, dt * (target < this.timeScale ? 14 : 3));
    const gdt = dt * this.timeScale;
    this.t += gdt;
    this.phaseT += gdt;
    this.acc += gdt;
    let steps = 0;
    while (this.acc >= STEP && steps < 6) {
      this.fixed();
      this.acc -= STEP;
      steps++;
    }
    if (steps >= 6) this.acc = 0;
    this.alpha = Math.min(1, this.acc / STEP);
    this.animate(gdt, dt);
    this.flow(gdt);
  }

  private fixed() {
    for (const s of this.shots) {
      if (s.dead) continue;
      if (s.dash > 0) {
        s.dash -= STEP;
        if (s.dash <= 0) s.body.gs = 1;
      }
    }
    this.world.step(STEP);
    this.applyDamage();
    this.processBooms(STEP);
    this.checkShots();
    // Ruhe im Bau?
    let maxV = 0;
    for (const b of this.world.bodies) {
      if (b.isStatic || !b.awake) continue;
      const u = b.user as Entity | null;
      if (u && u.kind === 'shot') continue;
      const v = b.vx * b.vx + b.vy * b.vy;
      if (v > maxV) maxV = v;
    }
    this.calmT = maxV < 0.7 * 0.7 && this.booms.length === 0 ? this.calmT + STEP : 0;
  }

  private checkShots() {
    const v = this.level.view;
    for (const s of this.shots) {
      if (s.dead) continue;
      const b = s.body;
      if (b.x > v.x1 + 12 || b.x < v.x0 - 12 || b.y < -6 || b.y > 60) {
        s.dead = true;
        this.world.remove(b);
        continue;
      }
      const sp = b.vx * b.vx + b.vy * b.vy;
      s.still = sp < 0.35 * 0.35 ? s.still + STEP : 0;
      if (!s.resting && s.hitAt >= 0 && s.still > 0.35) s.resting = true;
      // Gelbes Trikot: Korken knallt spätestens 1,6 s nach dem Aufprall
      if (s.type === 'gelb' && !s.used && s.hitAt >= 0 && this.t - s.hitAt > 1.6) this.champagne(s);
    }
    for (const bt of this.bottles) {
      if (bt.dead) continue;
      if (bt.pop || this.t - bt.t0 > 3 || bt.body.y < -4) this.burstBottle(bt);
    }
  }

  private flow(dt: number) {
    switch (this.phase) {
      case 'intro':
        if (this.phaseT > INTRO_T) {
          this.setPhase('aim');
          this.loadNext();
        }
        break;
      case 'fly': {
        const since = this.t - this.launchT;
        const live = this.shots.filter((s) => !s.dead);
        const shotsDone = live.every((s) => s.resting || (s.hitAt >= 0 && this.t - s.hitAt > 2.2)) && this.bottles.every((b) => b.dead);
        if (this.winAt < 0 && this.enemiesAlive === 0) {
          this.winAt = this.t + 1.1;
          this.slow = 0.75;
        }
        if (this.winAt >= 0) {
          if (this.t >= this.winAt && (this.calmT > 0.25 || this.t > this.winAt + 2)) this.startWin();
          break;
        }
        if (((shotsDone || since > 7) && this.calmT > 0.45 && since > 1.2) || since > 10) {
          if (this.waiting.length === 0) {
            this.setPhase('lost');
            for (const e of this.enemies) if (!e.dead) this.setMood(e, 'laugh', 99);
          } else {
            // E-Biker freuen sich über den Fehlschuss, wenn keiner erwischt wurde
            if (this.enemies.every((e) => e.dead || e.hp === e.maxHp)) for (const e of this.enemies) if (!e.dead) this.setMood(e, 'laugh', 1.6);
            this.setPhase('aim');
            this.loadNext();
          }
        }
        break;
      }
      case 'aim':
        // gewonnen, während der letzte Schuss noch nachwirkte
        if (this.enemiesAlive === 0) this.startWin();
        break;
      case 'won': {
        this.bonusT -= dt;
        const rest = [...(this.loaded ? [this.loaded] : []), ...this.waiting];
        if (this.bonusT <= 0 && this.bonusIdx < rest.length) {
          const w = rest[this.bonusIdx];
          this.bonusIdx++;
          this.bonusT = 0.42;
          w.cheer = 1;
          w.fx = w.x;
          w.fy = w.y;
          w.tx = w.x;
          w.ty = w.y;
          w.hop = 0;
          w.hopH = 1.4;
          w.hopDur = 0.5;
          this.addScore(10000, 'bonus');
          this.popup(w.x, w.y + 1.6, '+10.000', '#ffd23f', 0.95, 'score');
          for (let i = 0; i < 14; i++) this.particles.spawn(P.Confetti, w.x, w.y + 1, (Math.random() - 0.5) * 5, 4 + Math.random() * 5, 1.6, 0.11, CONFETTI[i % CONFETTI.length], 6, 1.5, Math.random() * 6, (Math.random() - 0.5) * 18);
        }
        if (this.bonusIdx >= rest.length && this.bonusT <= -0.6) this.finish(true);
        break;
      }
      case 'lost':
        if (this.phaseT > 1.8) this.finish(false);
        break;
      case 'over':
        this.overT += dt;
        break;
    }
  }

  private startWin() {
    if (this.phase === 'won' || this.phase === 'over') return;
    this.setPhase('won');
    this.bonusIdx = 0;
    // erst die Kamera auf das ganze Feld, dann der Bonus
    this.bonusT = 0.9;
    this.pull = null;
    this.dragFrom = null;
    // Fahrer in der Schlaufe springt zu den anderen zurück
    if (this.loaded) {
      this.waiting.unshift(this.loaded);
      this.loaded = null;
    }
    this.waiting.forEach((w, i) => { w.fx = w.x; w.fy = w.y; w.tx = this.slotX(i); w.ty = standY(w.type); w.hop = 0; w.hopH = 0.8; w.hopDur = 0.4; });
    for (let i = 0; i < 40; i++) {
      const x = this.level.view.x0 + Math.random() * (this.level.view.x1 - this.level.view.x0);
      this.particles.spawn(P.Confetti, x, this.level.view.y1 + 2 + Math.random() * 4, (Math.random() - 0.5) * 2, -Math.random() * 2, 4, 0.13, CONFETTI[i % CONFETTI.length], 2.2, 0.8, Math.random() * 6, (Math.random() - 0.5) * 12);
    }
  }

  private finish(won: boolean) {
    if (this.phase === 'over') return;
    const score = Math.round(this.score);
    const st = this.level.stars;
    const stars = !won ? 0 : score >= st[2] ? 3 : score >= st[1] ? 2 : 1;
    this.setPhase('over');
    this.events.over?.({
      won, score, stars, parts: { ...this.parts }, ridersLeft: this.ridersLeft, shots: this.shotsFired, enemiesLeft: this.enemiesAlive,
    });
  }

  // ---------------------------------------------------------------- Schaden

  private onImpact(a: Body, b: Body, imp: number, x: number, y: number, nx: number, ny: number) {
    const ea = a.user as Entity | null;
    const eb = b.user as Entity | null;
    if (!this.settled) return;
    // Staub und Splitter beim Aufprall
    if (imp > 2.2) this.impactFx(ea, eb, imp, x, y, nx, ny);
    if (ea) this.hit(ea, eb, b, imp, x, y);
    if (eb) this.hit(eb, ea, a, imp, x, y);
  }

  private hit(target: Entity, other: Entity | null, otherBody: Body, imp: number, x: number, y: number) {
    if (target.kind === 'shot') {
      if (target.hitAt < 0) {
        target.hitAt = this.t;
        target.squash = Math.min(1, imp / 10);
        if (target.dive) this.booms.push({ x: target.body.x, y: target.body.y, r: 1.7, power: 6, dmg: 3.2, delay: 0, kind: 'stomp' });
      } else if (imp > 3) target.squash = Math.min(1, imp / 12);
      if (imp > 6) target.dizzy = 2.5;
      if (imp > 9 && target.glasses && target.type !== 'floh') {
        target.glasses = false;
        this.particles.spawn(P.Chip, x, y + 0.3, (Math.random() - 0.5) * 4, 4 + Math.random() * 3, 2.2, 0.16, '#1b1d24', 18, 0, 0, (Math.random() - 0.5) * 20);
      }
      return;
    }
    if (target.kind === 'bottle') {
      // nicht mitten im Physikschritt entfernen – nach dem Schritt platzen lassen
      if (this.t - target.t0 > 0.06 && other?.kind !== 'shot') target.pop = true;
      return;
    }
    if (target.dead || this.phase === 'intro') return;
    let mult = 1;
    if (other?.kind === 'shot') {
      mult = target.kind === 'block' ? VS[other.type][target.mat] ?? 1 : 1.1;
      if (other.dive) mult *= 1.6;
      if (other.dash > 0) mult *= 1.3;
    } else if (!other && otherBody.isStatic) {
      mult = target.kind === 'enemy' ? 0.62 : 0.8;
    }
    let dmg = Math.max(0, imp - (target.kind === 'enemy' ? 0.5 : 0.9)) * mult;
    if (target.kind === 'enemy') dmg *= 1.6;
    if (dmg <= 0.05) return;
    if (target.pending === 0) this.pendingList.push(target);
    target.pending += dmg;
  }

  private applyDamage() {
    if (this.pendingList.length === 0) return;
    const list = this.pendingList;
    this.pendingList = [];
    for (const e of list) {
      const d = e.pending;
      e.pending = 0;
      if (e.dead || d <= 0) continue;
      e.hp -= d;
      e.flash = 0.18;
      if (this.phase !== 'intro') this.addScore(Math.round(d * 12) * 5, e.kind === 'enemy' ? 'enemies' : 'blocks');
      if (e.kind === 'enemy') {
        e.wob = Math.min(1.2, e.wob + 0.35 + d * 0.08);
        if (e.hp <= 0) this.killEnemy(e);
        else this.setMood(e, 'hurt', 1.1);
      } else {
        const f = e.hp / e.maxHp;
        e.stage = f > 0.66 ? 0 : f > 0.33 ? 1 : 2;
        if (e.hp <= 0) this.breakBlock(e);
        else if (e.mat === 'akku' && d > 0.3) this.sparks(e.body.x, e.body.y, 5);
      }
    }
  }

  private breakBlock(b: Block) {
    if (b.dead) return;
    b.dead = true;
    const body = b.body;
    this.world.remove(body);
    const m = MATS[b.mat];
    const cols = MAT_DEBRIS[b.mat];
    const area = b.mat === 'roof' ? b.w * b.h * 0.5 : b.w * b.h;
    const n = Math.min(26, 6 + Math.round(area * 9));
    for (let i = 0; i < n; i++) {
      // Punkt im Block
      const lx = (Math.random() - 0.5) * b.w * 0.9;
      const ly = (Math.random() - 0.5) * b.h * 0.9;
      const x = body.x + body.c * lx - body.s * ly;
      const y = body.y + body.s * lx + body.c * ly;
      const vx = body.vx * 0.4 + (Math.random() - 0.5) * 4;
      const vy = body.vy * 0.4 + Math.random() * 4.5;
      const col = cols[i % cols.length];
      if (b.mat === 'glass') this.particles.spawn(P.Shard, x, y, vx * 1.3, vy * 1.2, 1.1 + Math.random() * 0.6, 0.08 + Math.random() * 0.12, col, 16, 0, Math.random() * 6, (Math.random() - 0.5) * 22);
      else if (b.mat === 'cake') this.particles.spawn(P.Cream, x, y, vx * 1.2, vy * 1.1 + 1, 3, 0.07 + Math.random() * 0.09, col, 14);
      else this.particles.spawn(P.Chip, x, y, vx, vy, 1.4 + Math.random() * 0.8, 0.07 + Math.random() * 0.13, col, 16, 0, Math.random() * 6, (Math.random() - 0.5) * 16);
    }
    for (let i = 0; i < 3 + Math.round(area * 2); i++) {
      this.particles.spawn(P.Puff, body.x + (Math.random() - 0.5) * b.w * 0.6, body.y + (Math.random() - 0.5) * b.h * 0.6, (Math.random() - 0.5) * 1.2, Math.random() * 0.8, 0.7, 0.25 + Math.random() * 0.25, b.mat === 'stone' ? '#e7e1d6' : '#f3eee6', 0, 2.5);
    }
    if (b.mat === 'cake') {
      this.parts.cake += m.score;
      this.score += m.score;
      this.events.score?.(Math.round(this.score));
      this.popup(body.x, body.y + 0.6, 'Kuchen!', '#ff8fb1', 0.85, 'word');
      for (let i = 0; i < 3; i++) this.particles.spawn(P.Cream, body.x, body.y + 0.2, (Math.random() - 0.5) * 3, 5 + Math.random() * 3, 3, 0.11, '#d7263d', 14);
    } else {
      this.addScore(m.score, 'blocks');
      this.popup(body.x, body.y + 0.3, nfmt(m.score), '#ffffff', 0.4, 'small');
    }
    if (b.mat === 'akku') this.booms.push({ x: body.x, y: body.y, r: 2.25, power: 11, dmg: 6.5, delay: 0.07, kind: 'akku' });
    this.trauma = Math.min(1, this.trauma + (b.mat === 'stone' ? 0.12 : 0.05));
  }

  private killEnemy(e: Enemy) {
    if (e.dead) return;
    e.dead = true;
    const b = e.body;
    this.world.remove(b);
    this.poof(b.x, b.y, e.r, '#ffffff');
    const pts = ENEMIES[e.type].score;
    this.addScore(pts, 'enemies');
    this.popup(b.x, b.y + e.r + 0.5, nfmt(pts), '#ffd23f', e.type === 'boss' ? 1.1 : 0.85, 'score');
    this.popup(b.x, b.y, '', '#e5484d', 0.9, 'battery');
    this.trauma = Math.min(1, this.trauma + 0.18);
    this.events.enemies?.(this.enemiesAlive, this.totalEnemies);
    this.events.bump?.(0.5);
    // die anderen erschrecken
    for (const o of this.enemies) if (!o.dead && o.mood !== 'hurt') this.setMood(o, 'scared', 1.2);
  }

  private burstBottle(bt: Bottle) {
    if (bt.dead) return;
    bt.dead = true;
    const b = bt.body;
    this.world.remove(b);
    this.booms.push({ x: b.x, y: b.y, r: 1.45, power: 4.2, dmg: 3.2, delay: 0, kind: 'bottle' });
  }

  private processBooms(dt: number) {
    if (this.booms.length === 0) return;
    const now: Boom[] = [];
    this.booms = this.booms.filter((bm) => {
      bm.delay -= dt;
      if (bm.delay <= 0) { now.push(bm); return false; }
      return true;
    });
    for (const bm of now) this.explode(bm);
  }

  private explode(bm: Boom) {
    const { x, y, r, power, dmg } = bm;
    const hits = this.world.queryCircle(x, y, r + 1);
    for (const b of hits) {
      if (b.isStatic || b.removed) continue;
      const u = b.user as Entity | null;
      const dx = b.x - x;
      const dy = b.y - y;
      const d = Math.hypot(dx, dy) || 0.001;
      const ext = b.kind === 0 ? b.r : 0.35 * (b.maxX - b.minX + b.maxY - b.minY) * 0.5;
      const dd = Math.max(0, d - ext * 0.6);
      if (dd > r) continue;
      const f = 1 - dd / r;
      let ux = dx / d;
      let uy = dy / d + 0.35;
      const ul = Math.hypot(ux, uy) || 1;
      ux /= ul;
      uy /= ul;
      // Rennradler werden nur leicht mitgerissen (sonst wird die Explosion zur Kanone)
      const soft = u && (u.kind === 'shot' || u.kind === 'bottle') ? 0.3 : 1;
      const dv = Math.min(15, (power * f) / Math.sqrt(Math.max(0.15, b.m))) * soft;
      const jit = (this.rand() - 0.5) * 0.3;
      b.applyImpulse(ux * dv * b.m, uy * dv * b.m, b.x - ux * 0.15 + jit, b.y - uy * 0.15);
      if (!u || u.kind === 'shot' || u.kind === 'bottle') continue;
      if (u.dead || this.phase === 'intro') continue;
      let m = 1;
      if (u.kind === 'block') m = u.mat === 'stone' ? 0.45 : u.mat === 'glass' ? 2.2 : u.mat === 'akku' ? 1.6 : 1;
      else m = 1.25;
      const dd2 = dmg * f * m;
      if (dd2 <= 0.05) continue;
      if (u.pending === 0) this.pendingList.push(u);
      u.pending += dd2;
    }
    this.boomFx(bm);
  }

  // ---------------------------------------------------------------- Punkte und Effekte

  private addScore(n: number, part: keyof AkkuGame['parts']) {
    if (n <= 0) return;
    this.score += n;
    this.parts[part] += n;
    this.events.score?.(Math.round(this.score));
  }

  popup(x: number, y: number, text: string, color: string, size: number, kind: Popup['kind']) {
    this.popups.push({ x, y, text, color, t: 0, life: kind === 'battery' ? 1.5 : kind === 'small' ? 0.75 : 1.25, size, kind });
  }

  private word(x: number, y: number, text: string, color: string) {
    this.popup(x, y, text, color, 0.62, 'word');
  }

  private poof(x: number, y: number, r: number, color: string) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const s = 2 + Math.random() * 2;
      this.particles.spawn(P.Puff, x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, Math.cos(a) * s, Math.sin(a) * s + 0.4, 0.38 + Math.random() * 0.2, r * (0.26 + Math.random() * 0.18), color, 0, 4.5);
    }
  }

  private sparks(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 3 + Math.random() * 5;
      this.particles.spawn(P.Spark, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.25 + Math.random() * 0.2, 0.05, i % 2 ? '#fff3a3' : '#7ff0ff', 6, 2);
    }
  }

  private impactFx(ea: Entity | null, eb: Entity | null, imp: number, x: number, y: number, nx: number, ny: number) {
    const n = Math.min(5, Math.floor(imp / 2.5));
    for (let i = 0; i < n; i++) {
      this.particles.spawn(P.Puff, x, y, (Math.random() - 0.5) * 2 + ny * 0.5, Math.random() * 1.2, 0.5, 0.12 + Math.random() * 0.14, '#efe8dc', 0, 3);
    }
    if (imp > 5) this.trauma = Math.min(1, this.trauma + Math.min(0.12, imp * 0.008));
    const mat = (e: Entity | null) => (e && e.kind === 'block' ? e.mat : null);
    const m = mat(ea) ?? mat(eb);
    if (m && imp > 3.5) {
      const cols = MAT_DEBRIS[m];
      for (let i = 0; i < Math.min(4, n); i++) {
        this.particles.spawn(m === 'glass' ? P.Shard : P.Chip, x, y, (Math.random() - 0.5) * 3 - nx, Math.random() * 3, 0.9, 0.05 + Math.random() * 0.07, cols[i % cols.length], 16, 0, Math.random() * 6, (Math.random() - 0.5) * 20);
      }
    }
  }

  private boomFx(bm: Boom) {
    const { x, y, r, kind } = bm;
    if (kind === 'akku') {
      this.particles.spawn(P.Ring, x, y, 0, 0, 0.42, r, '#fff6c2');
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.random();
        this.particles.spawn(P.Bolt, x, y, Math.cos(a) * 9, Math.sin(a) * 9, 0.22 + Math.random() * 0.12, 0.7 + Math.random() * 0.5, i % 2 ? '#7ff0ff' : '#fff3a3', 0, 4, a);
      }
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 1 + Math.random() * 3;
        this.particles.spawn(P.Smoke, x + Math.cos(a) * 0.3, y + Math.sin(a) * 0.3, Math.cos(a) * s, Math.sin(a) * s + 1, 1.1 + Math.random() * 0.5, 0.35 + Math.random() * 0.35, i % 3 ? '#3a3f4a' : '#5b6170', -0.6, 2.2);
      }
      this.sparks(x, y, 18);
      this.popup(x, y + 0.9, 'Zzzapp!', '#7ff0ff', 0.7, 'word');
      this.trauma = Math.min(1, this.trauma + 0.42);
      this.events.bump?.(0.8);
    } else if (kind === 'champ') {
      this.particles.spawn(P.Ring, x, y, 0, 0, 0.5, r, '#fff1a8');
      for (let i = 0; i < 46; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 3 + Math.random() * 9;
        this.particles.spawn(P.Foam, x, y, Math.cos(a) * s, Math.sin(a) * s + 2, 0.8 + Math.random() * 0.7, 0.07 + Math.random() * 0.14, i % 4 ? '#fffbe8' : '#ffe27a', 7, 2.5);
      }
      for (let i = 0; i < 20; i++) this.particles.spawn(P.Confetti, x, y, (Math.random() - 0.5) * 10, Math.random() * 9, 1.8, 0.12, CONFETTI[i % CONFETTI.length], 7, 1.2, Math.random() * 6, (Math.random() - 0.5) * 20);
      this.trauma = Math.min(1, this.trauma + 0.55);
      this.events.bump?.(1);
    } else if (kind === 'bottle') {
      this.particles.spawn(P.Ring, x, y, 0, 0, 0.3, r, '#bfe9ff');
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI;
        const s = 2 + Math.random() * 5;
        this.particles.spawn(P.Drop, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.9, 0.05 + Math.random() * 0.06, i % 3 ? '#6cc6ff' : '#d9f3ff', 14);
      }
      this.trauma = Math.min(1, this.trauma + 0.12);
    } else {
      this.particles.spawn(P.Ring, x, y - 0.3, 0, 0, 0.35, r, '#ffffff');
      for (let i = 0; i < 14; i++) {
        const dir = i % 2 ? 1 : -1;
        this.particles.spawn(P.Puff, x + dir * Math.random() * 0.6, y - 0.4, dir * (2 + Math.random() * 3), Math.random() * 1.5, 0.6, 0.2 + Math.random() * 0.25, '#efe8dc', 0, 3);
      }
      this.trauma = Math.min(1, this.trauma + 0.35);
      this.events.bump?.(0.6);
    }
  }

  private setMood(e: Enemy, mood: Mood, t: number) {
    // Lachen und Jubeln nicht von Schreck überschreiben, Schmerz geht immer
    if ((e.mood === 'laugh' && e.moodT > 0 && mood === 'scared') || e.dead) return;
    e.mood = mood;
    e.moodT = t;
  }

  // ---------------------------------------------------------------- Animation (jedes Bild)

  private animate(gdt: number, dt: number) {
    this.snap = Math.max(0, this.snap - dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    this.particles.update(gdt, this.floorAt);
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.t += dt;
      if (p.t > p.life) this.popups.splice(i, 1);
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.t += gdt;
      g.vy -= 9 * gdt;
      g.x += g.vx * gdt;
      g.y += g.vy * gdt;
      g.rot += g.vr * gdt;
      if (Math.random() < 0.6) this.particles.spawn(P.Foam, g.x, g.y - 0.3, (Math.random() - 0.5) * 2, -2 - Math.random() * 2, 0.6, 0.06 + Math.random() * 0.08, '#fffbe8', 3, 1);
      if (g.t > 3 || g.y < -5) this.ghosts.splice(i, 1);
    }
    // Leuchtspur bis zum ersten Aufprall
    const main = this.shots.find((s) => !s.dead && !s.clone);
    if (main && main.hitAt < 0) {
      this.trailT -= gdt;
      if (this.trailT <= 0) {
        this.trailT = 0.045;
        this.trail.push(main.body.x, main.body.y, this.trail.length % 6 === 0 ? 1 : 0.6);
      }
    }
    // wartende Fahrer: Hüpfer und Wippen
    const all = this.loaded ? [this.loaded, ...this.waiting] : this.waiting;
    for (const w of all) {
      w.bob += dt;
      w.blink -= dt;
      if (w.blink < -0.12) w.blink = 2 + Math.random() * 3;
      w.cheer = Math.max(0, w.cheer - dt * 0.4);
      if (w.hop < 1) {
        w.hop += dt / w.hopDur;
        const t = Math.max(0, Math.min(1, w.hop));
        const e = t * t * (3 - 2 * t);
        w.x = w.fx + (w.tx - w.fx) * e;
        w.y = w.fy + (w.ty - w.fy) * t + Math.sin(t * Math.PI) * w.hopH;
        if (w.hop >= 1) { w.x = w.tx; w.y = w.ty; }
      } else if (w !== this.loaded && this.phase !== 'won') {
        // ab und zu ein kleiner Hüpfer vor Ungeduld
        if (Math.random() < dt * 0.12) { w.fx = w.x; w.fy = w.y; w.tx = w.x; w.ty = w.y; w.hop = 0; w.hopH = 0.35; w.hopDur = 0.3; }
      }
    }
    // Fahrer im Flug
    for (const s of this.shots) {
      if (s.dead) continue;
      s.legs += gdt * (s.hitAt < 0 ? 22 : s.resting ? 0 : 6);
      s.squash = Math.max(0, s.squash - dt * 3);
      s.dizzy = Math.max(0, s.dizzy - dt);
      s.blink -= dt;
      if (s.blink < -0.12) s.blink = 1.5 + Math.random() * 3;
      if (s.dash > 0 && Math.random() < 0.7) this.particles.spawn(P.Puff, s.body.x, s.body.y, -s.body.vx * 0.05, -s.body.vy * 0.05, 0.35, 0.16 + Math.random() * 0.12, '#ffffff', 0, 2);
      if (s.dive && s.hitAt < 0 && Math.random() < 0.8) this.particles.spawn(P.Puff, s.body.x + (Math.random() - 0.5) * 0.3, s.body.y + 0.5, 0, 1, 0.3, 0.12, '#dfe6ff', 0, 2);
    }
    // E-Biker: blinzeln, schauen, Stimmung, Akkuanzeige
    const flying = this.shots.find((s) => !s.dead && s.hitAt < 0);
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.blink -= dt;
      if (e.blink < -0.13) e.blink = 1.8 + Math.random() * 3.5;
      e.flash = Math.max(0, e.flash - dt);
      e.wob = Math.max(0, e.wob - dt * 1.8);
      e.sip -= dt;
      if (e.sip < -1.2) e.sip = 3 + Math.random() * 5;
      e.bat += (Math.max(0, e.hp / e.maxHp) - e.bat) * Math.min(1, dt * 6);
      if (e.moodT > 0) {
        e.moodT -= dt;
        if (e.moodT <= 0) e.mood = 'idle';
      }
      // Blick: zum fliegenden Rennradler, sonst zur Schleuder
      const b = e.body;
      let tx = this.level.sling.x - b.x;
      let ty = this.level.sling.y - b.y;
      if (flying) {
        tx = flying.body.x - b.x;
        ty = flying.body.y - b.y;
        const d = Math.hypot(tx, ty);
        const toward = (flying.body.vx * -tx + flying.body.vy * -ty) > 0;
        if (d < 4.5 && toward && e.mood === 'idle') this.setMood(e, 'scared', 0.6);
      }
      const tl = Math.hypot(tx, ty) || 1;
      e.lookX += (tx / tl - e.lookX) * Math.min(1, dt * 8);
      e.lookY += (ty / tl - e.lookY) * Math.min(1, dt * 8);
    }
    for (const b of this.blocks) if (b.flash > 0) b.flash = Math.max(0, b.flash - dt);
  }
}

/** wartende Fahrer etwas kleiner (stehen hinten) */
export const WAIT_SCALE = 0.86;

/** Mitte eines stehenden Fahrers (Kugel auf kurzen Beinen) */
export function standY(type: RiderType): number {
  return RIDERS[type].r * 1.22 * WAIT_SCALE;
}

export const CONFETTI = ['#ffd23f', '#2fb24c', '#e5484d', '#3aa8ff', '#ffffff', '#ff8fb1'];

export function nfmt(n: number): string {
  return Math.round(n).toLocaleString('de-DE');
}
