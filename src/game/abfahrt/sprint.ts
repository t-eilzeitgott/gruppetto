/**
 * Sprintfinale: die letzten 2,4 km einer flachen Etappe im Feld.
 *
 * Kern ist ein Kraftbalken: im Wind kostet Fahren Kraft, im Windschatten erholt man sich. Mit dem
 * Daumen wechselt man das Hinterrad, Daumen hoch heißt antreten (kostet viel Kraft), Daumen runter
 * Tempo rausnehmen. Die Sprinterteams bringen ihre Anfahrerzüge nach vorn, die Anfahrer fallen
 * nacheinander ab, die Sprinter treten zwischen 320 und 180 m an. Wer zu früh losfährt, wird
 * überholt; wer eingeklemmt ist, kommt nicht vorbei.
 */
import { EDGE, ROAD_HALF, SPRINT_FINISH, Track } from './track';
import { clamp, type Friend, type Opp, type Particle, type Phase, type Player, type Popup, standings, type Standing } from './engine';
import { between, chance, mulberry32, pick, type Rng } from './rng';
import { SKINS, TEAM_KITS, type Kit } from './rider';
import type { StageRef } from './stageRef';

export type RiderType = 'sprinter' | 'puncheur' | 'allround' | 'rouleur' | 'climber';

export const TYPE_STATS: Record<RiderType, { label: string; top: number; acc: number; end: number; bonus: number }> = {
  sprinter: { label: 'Sprinter', top: 19.9, acc: 3.3, end: 0.92, bonus: 1 },
  puncheur: { label: 'Puncheur', top: 19.3, acc: 3.9, end: 1, bonus: 1.15 },
  allround: { label: 'Allrounder', top: 19.0, acc: 3.2, end: 1.08, bonus: 1.2 },
  rouleur: { label: 'Rouleur', top: 18.7, acc: 2.7, end: 1.32, bonus: 1.3 },
  climber: { label: 'Kletterer', top: 18.3, acc: 3.0, end: 1.12, bonus: 1.45 },
};

/** Werte für die Anzeige (0–1) */
export function typeBars(t: RiderType): { top: number; acc: number; end: number } {
  const s = TYPE_STATS[t];
  return { top: (s.top - 17.8) / 2.3, acc: (s.acc - 2.3) / 1.8, end: (s.end - 0.75) / 0.65 };
}

export interface SprintRider { name: string; type: RiderType; number: string }

export interface SprintOptions {
  dayKey: string;
  names: string[];
  rider: SprintRider;
  /** echte Fahrernamen für die Gegner (aus der Startliste) */
  rivals: string[];
  kit: Kit;
  /** echter Zielort der Etappe (sonst einer aus der Liste) oder die ganze Etappenvorlage */
  town?: string | StageRef | null;
  /** echte Sprinterzüge (drei Anfahrer, Sprinter zuletzt) */
  trains?: { team: string; riders: string[] }[];
  /** eigener Anfahrer aus dem Team des gewählten Fahrers */
  mate?: string | null;
  onEvent?: (e: SprintEvent) => void;
  onOver?: (r: SprintResult) => void;
}

export type SprintEvent =
  | { type: 'count'; n: number }
  | { type: 'banner'; title: string; sub?: string; tone?: 'gold' | 'accent' | 'red' };

export interface SprintResult {
  place: number;
  riders: number;
  score: number;
  parts: { place: number; draft: number; gain: number; type: number };
  winner: string;
  gap: number;          // Sekunden hinter dem Sieger
  topKmh: number;
  launchAt: number;     // Restmeter beim Antreten (0 = gar nicht)
  podium: { name: string; me: boolean }[];
}

export interface SprintHud {
  place: number; riders: number; toGo: number; kmh: number; energy: number; draft: number;
  mode: 'sit' | 'go' | 'ease'; blocked: boolean; touch: { x: number; y: number } | null;
  ahead: string | null;
  /** TV-Tafel: Spitze, Zweiter, du */
  board: Standing[];
}

interface Racer extends Opp {
  name: string;
  /** Teamname (echte Züge) */
  teamName: string;
  team: number;          // −1 = ohne Zug, MATE = eigener Anfahrer
  order: number;         // Platz im Zug: 0 = erster Anfahrer … Sprinter zuletzt
  sprinter: boolean;
  e: number;
  top: number;
  acc: number;
  launch: number;        // Restdistanz, bei der er antritt
  peel: number;          // Anfahrer: Restdistanz, bei der er abfällt
  peeled: boolean;
  going: boolean;
  drift: number;         // langsames Vor und Zurück im Feld
  driftT: number;
  done: boolean;
  finT: number;
}

const LANES = [-2.1, -1.05, 0, 1.05, 2.1];
/** Team-Nummer des eigenen Anfahrers */
const MATE = 9;
const XMAX = ROAD_HALF - 0.45;
const SUB = 1 / 60;
const lastName = (n: string) => n.split(' ').slice(-1)[0] ?? n;
/** Tempo des Feldes nach Restdistanz (m/s) */
export function packSpeed(d: number): number {
  if (d < 0) return 11;
  if (d > 1400) return 14.6;
  if (d > 600) return 14.6 + ((1400 - d) / 800) * 1.6;
  return 16.2 + Math.min(1, (600 - d) / 350) * 0.7;
}
const PLACE_PTS = [1000, 760, 600, 480, 400, 340, 290, 250, 220, 200];

export class SprintRace {
  readonly opts: SprintOptions;
  track: Track;
  phase: Phase = 'ready';
  phaseT = 0;
  time = 0;
  p!: Player;
  opps: Racer[] = [];
  parts: Particle[] = [];
  popups: Popup[] = [];
  friends: Friend[] = [];
  shake = 0;
  crashSpin = 0;
  tx = 0;
  draft = 0;
  energy = 1;
  mode: 'sit' | 'go' | 'ease' = 'sit';
  private stats = TYPE_STATS.sprinter;
  private rng: Rng;
  private steer = { active: false, sx: 0, sy: 0, tx0: 0 };
  private keys = { left: false, right: false, down: false, up: false };
  private wantGo = false;
  private wantEase = false;
  private viewW = 390;
  private blocked = false;
  private blockedT = 0;
  private finT = -1;
  private draftTime = 0;
  private topV = 0;
  private launchAt = 0;
  private placeAt300 = 0;
  private flags = new Set<string>();
  private popSide: 1 | -1 = 1;
  private countShown = 4;

  constructor(opts: SprintOptions) {
    this.opts = opts;
    this.stats = TYPE_STATS[opts.rider.type];
    this.track = new Track(opts.dayKey, opts.names, 'sprint', opts.town);
    this.rng = mulberry32(this.track.seed ^ 0x51);
    this.reset();
  }

  reset() {
    this.track = new Track(this.opts.dayKey, this.opts.names, 'sprint', this.opts.town);
    this.rng = mulberry32(this.track.seed ^ 0x51);
    this.p = {
      z: 0, x: LANES[3], vx: 0, v: 0, y: 0, vy: 0, air: false, airT: 0,
      lean: 0, pedal: 0, tuck: 0.5, brake: 0, wobble: 0, slip: 0, grip: 1, slick: 0,
      kit: this.opts.kit,
    };
    this.tx = this.p.x;
    this.opps = [];
    this.parts = [];
    this.popups = [];
    this.phase = 'ready';
    this.phaseT = 0;
    this.time = 0;
    this.energy = 1;
    this.draft = 0;
    this.finT = -1;
    this.draftTime = 0;
    this.topV = 0;
    this.launchAt = 0;
    this.flags.clear();
    this.spawnField();
    this.placePlayer();
    this.p.y = this.track.heightAt(this.p.z);
  }

  /** Feld aufstellen: vier Sprinterzüge (drei Anfahrer + Sprinter), dazu einzelne Fahrer */
  private spawnField() {
    const r = this.rng;
    const rivals = [...this.opts.rivals];
    const nameOf = () => (rivals.length ? rivals.splice(Math.floor(r() * rivals.length), 1)[0] : `Fahrer ${Math.floor(between(r, 11, 199))}`);
    const kits = [...TEAM_KITS].sort(() => r() - 0.5);
    let id = 0;
    const trains = this.opts.trains ?? [];
    const taken = new Set(trains.flatMap((t) => t.riders));
    if (this.opts.mate) taken.add(this.opts.mate);
    for (let i = rivals.length - 1; i >= 0; i--) if (taken.has(rivals[i])) rivals.splice(i, 1);
    const make = (z: number, x: number, team: number, order: number, sprinter: boolean, kit: Omit<Kit, 'skin' | 'number'>, name?: string): Racer => ({
      id: id++, z, x, vx: 0, v: 0, tx: x, f: 0.7, kit: { ...kit, skin: pick(r, SKINS), number: String(Math.floor(between(r, 11, 199))) },
      pedal: r() * 6, lean: 0, tuck: 0.5, brake: 0, passed: false, group: team, bump: 0, attacker: false,
      name: name ?? nameOf(), teamName: team >= 0 && team < 4 ? trains[team]?.team ?? '' : '', team, order, sprinter, e: 1,
      top: sprinter ? between(r, 19.1, 20.3) : between(r, 17.6, 18.6),
      acc: sprinter ? between(r, 3.0, 3.8) : 2.6,
      launch: sprinter ? between(r, 180, 320) : between(r, 120, 220),
      peel: 0, peeled: false, going: false, drift: 0, driftT: r() * 3, done: false, finT: -1,
    });
    // Startaufstellung auf festen Plätzen (Reihen à 2,1 m, fünf Spuren) – niemand steht in einem anderen
    const slots: [number, number][] = [];
    for (let row = 0; row < 8; row++) for (let l = 0; l < LANES.length; l++) slots.push([row, l]);
    const takenSlots = new Set<string>();
    const zOf = (row: number) => 48 - row * 2.1;
    const takeSlot = (row: number, l: number) => { takenSlots.add(`${row}:${l}`); return [zOf(row) + (r() - 0.5) * 0.3, LANES[l] + (r() - 0.5) * 0.1] as const; };
    // Züge: je eine Spur, vier Fahrer hintereinander (Anfahrer vorn, Sprinter zuletzt)
    const trainLanes = [0, 4, 1, 3];
    for (let t = 0; t < 4; t++) {
      const kit = kits[t % kits.length];
      const row0 = Math.floor(r() * 4);
      for (let k = 0; k < 4; k++) {
        const [z, x] = takeSlot(row0 + k, trainLanes[t]);
        const o = make(z, x, t, k, k === 3, kit, trains[t]?.riders[k]);
        if (k < 3) o.peel = [between(r, 820, 1000), between(r, 480, 620), between(r, 250, 340)][k];
        this.opps.push(o);
      }
    }
    // übrige Fahrer auf freie Plätze (einige mit Sprintambitionen), einer bleibt für den Spieler
    const free = slots.filter(([row, l]) => !takenSlots.has(`${row}:${l}`) && row < 7);
    const me = free.splice(free.findIndex(([row, l]) => row >= 3 && l === 2) >= 0 ? free.findIndex(([row, l]) => row >= 3 && l === 2) : Math.floor(free.length / 2), 1)[0];
    this.startSlot = [zOf(me[0]), LANES[me[1]]];
    // eigener Anfahrer: im Trikot des Spielers direkt davor
    {
      const ahead = free.findIndex(([row, l]) => row === me[0] - 1 && l === me[1]);
      const [row, l] = ahead >= 0 ? free.splice(ahead, 1)[0] : [me[0] - 1, me[1]];
      const [z, x] = takeSlot(row, l);
      const k = this.opts.kit;
      const o = make(z, x, MATE, 0, false, { jersey: k.jersey, side: k.side, helmet: k.helmet, shorts: k.shorts, shoes: k.shoes }, this.opts.mate || 'Dein Anfahrer');
      o.peel = between(r, 190, 240);
      o.top = 18.4;
      this.opps.push(o);
    }
    for (let i = 0; i < 9 && free.length; i++) {
      const [row, l] = free.splice(Math.floor(r() * free.length), 1)[0];
      const [z, x] = takeSlot(row, l);
      const o = make(z, x, -1, 0, chance(r, 0.35), kits[(4 + i) % kits.length]);
      if (o.sprinter) o.top = between(r, 18.6, 19.6);
      this.opps.push(o);
    }
  }

  private startSlot: [number, number] = [20, 0];

  /** Startplatz des Spielers: ein freier Platz mitten im Feld */
  private placePlayer() {
    [this.p.z, this.p.x] = this.startSlot;
    this.tx = this.p.x;
  }

  get riders(): number { return this.opps.length + 1; }

  setViewport(w: number) { this.viewW = Math.max(240, w); }

  start() {
    if (this.phase !== 'ready' && this.phase !== 'over') return;
    if (this.phase === 'over') this.reset();
    this.phase = 'countdown';
    this.phaseT = 0;
    this.opts.onEvent?.({ type: 'count', n: 3 });
  }

  // ------------------------------------------------------------ Eingabe

  pointerDown(x: number, y: number) { this.steer = { active: true, sx: x, sy: y, tx0: this.tx }; }
  pointerMove(x: number, y: number) {
    if (!this.steer.active) return;
    const k = 6 / this.viewW;
    this.tx = clamp(this.steer.tx0 + (x - this.steer.sx) * k, -XMAX, XMAX);
    const dy = this.steer.sy - y;
    this.wantGo = this.wantGo ? dy > 16 : dy > 30;
    this.wantEase = this.wantEase ? dy < -16 : dy < -30;
    if (dy > 110) this.steer.sy = y + 110;
    if (dy < -110) this.steer.sy = y - 110;
  }
  pointerUp() { this.steer.active = false; this.wantGo = false; this.wantEase = false; }
  key(name: 'left' | 'right' | 'down' | 'up', down: boolean) { this.keys[name] = down; }

  // ------------------------------------------------------------ Schleife

  update(dtReal: number) {
    const dt = Math.min(0.05, dtReal);
    this.time += dt;
    this.phaseT += dt;
    if (this.keys.left) this.tx = clamp(this.tx - 3.5 * dt, -XMAX, XMAX);
    if (this.keys.right) this.tx = clamp(this.tx + 3.5 * dt, -XMAX, XMAX);
    if (this.phase === 'countdown') {
      const n = 3 - Math.floor(this.phaseT / 0.75);
      if (n !== this.countShown) { this.countShown = n; this.opts.onEvent?.({ type: 'count', n: Math.max(0, n) }); }
      if (this.phaseT >= 2.25) { this.phase = 'playing'; this.phaseT = 0; }
    }
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(SUB, left);
      if (this.phase === 'playing' || this.phase === 'countdown') {
        this.stepPlayer(h);
        this.stepRacers(h);
      }
      left -= h;
    }
    for (const q of this.parts) {
      q.life -= dt; q.z += q.vz * dt; q.x += q.vx * dt; q.h += q.vh * dt;
      q.vh -= 2.5 * dt; q.vx *= 0.98; q.rot += dt * 8;
    }
    this.parts = this.parts.filter((q) => q.life > 0);
    for (const pp of this.popups) pp.age += dtReal;
    this.popups = this.popups.filter((pp) => pp.age < pp.life);
    this.shake = Math.max(0, this.shake - dt * 3);
    if (this.phase === 'playing' && this.finT >= 0 && this.time - this.finT > 2.6) this.finish();
    this.track.trim(Math.floor(this.p.z / 2) - 200);
  }

  hud(): SprintHud {
    const ahead = this.wheelAhead(this.p.z, this.p.x, 10);
    return {
      place: this.place(),
      riders: this.riders,
      toGo: Math.max(0, Math.round(SPRINT_FINISH - this.p.z)),
      kmh: Math.round(this.p.v * 3.6),
      energy: this.energy,
      draft: this.draft,
      mode: this.mode,
      blocked: this.blocked,
      touch: this.steer.active ? { x: this.steer.sx, y: this.steer.sy } : null,
      ahead: ahead?.name ?? null,
      board: standings(this.opps, this.p, this.finT),
    };
  }

  /** aktueller Platz (nach dem Ziel: Platz beim Überqueren der Linie) */
  place(): number {
    if (this.finT >= 0) return 1 + this.opps.filter((o) => o.done && o.finT < this.finT).length;
    return 1 + this.opps.filter((o) => o.z > this.p.z).length;
  }

  // ------------------------------------------------------------ Spieler

  /** nächster Fahrer vor (z, x) in derselben Spur (bis dist m); self = fragender Gegner (der Spieler zählt dann mit) */
  private wheelAhead(z: number, x: number, dist: number, self?: Racer): { z: number; x: number; v: number; name?: string } | null {
    let best: { z: number; x: number; v: number; name?: string } | null = null;
    let bd = dist;
    for (const o of this.opps) {
      if (o === self) continue;
      const dz = o.z - z;
      if (dz <= 0.05 || dz >= bd || Math.abs(o.x - x) > 0.6) continue;
      bd = dz;
      best = o;
    }
    if (self) {
      const dz = this.p.z - z;
      if (dz > 0.05 && dz < bd && Math.abs(this.p.x - x) <= 0.6) best = this.p;
    }
    return best;
  }

  private draftFor(z: number, x: number, self?: Racer): number {
    let d = 0;
    const n = this.opps.length;
    for (let i = 0; i <= n; i++) {
      const o = i < n ? this.opps[i] : self ? this.p : null;
      if (!o || o === self) continue;
      const dz = o.z - z;
      if (dz < 0.9 || dz > 9) continue;
      const dx = Math.abs(o.x - x);
      if (dx > 0.85) continue;
      d = Math.max(d, Math.pow(1 - (dz - 0.9) / 8.1, 0.7) * (1 - dx / 0.85));
    }
    return d;
  }

  private stepPlayer(dt: number) {
    const p = this.p;
    const d = SPRINT_FINISH - p.z;
    const s = this.stats;
    const racing = this.phase === 'playing' && this.finT < 0;
    const V = this.phase === 'countdown' ? 9 : packSpeed(d);
    // Eingabe → Fahrweise
    const go = racing && (this.wantGo || this.keys.up);
    const ease = racing && !go && (this.wantEase || this.keys.down);
    this.mode = go ? 'go' : ease ? 'ease' : 'sit';
    const dr = this.draftFor(p.z, p.x);
    this.draft += (dr - this.draft) * Math.min(1, dt * 6);
    // Wunschtempo: am Hinterrad bleiben, sonst Tempo des Feldes
    const wheel = this.wheelAhead(p.z, p.x, 12);
    let vd = wheel ? clamp(wheel.v + (wheel.z - p.z - 1.7) * 0.9, wheel.v - 1.5, wheel.v + 1.5) : V;
    if (!wheel) vd = Math.max(vd, V);
    vd = Math.max(vd, V - 3);
    if (go) vd = s.top + 0.9 * this.draft;
    if (ease) vd = V - 2.2;
    if (!racing) vd = this.finT >= 0 ? 9 : V;
    if (this.energy <= 0.01 && racing) {
      vd = Math.min(vd, V - 1.4);
      if (!this.flags.has('platt')) { this.flags.add('platt'); this.pop('Platt!', 'red', 'Kraft ist alle', true); }
    }
    const acc = go ? s.acc : 2.2;
    p.v = clamp(p.v + clamp(vd - p.v, -2.6 * dt, acc * dt), 0, 24);
    // eingeklemmt: durch den Vordermann kommt man nicht durch
    this.blocked = false;
    const front = this.wheelAhead(p.z, p.x, 1.7);
    if (front && p.v > front.v - Math.max(0, 1.5 - (front.z - p.z)) * 2) {
      p.v = Math.max(0, front.v - Math.max(0, 1.5 - (front.z - p.z)) * 2);
      this.blocked = go;
    }
    this.blockedT = this.blocked ? this.blockedT + dt : 0;
    if (this.blockedT > 0.35 && !this.flags.has('box')) { this.flags.add('box'); this.pop('Eingeklemmt!', 'muted', 'Seitlich raus', false, true); }
    p.z += p.v * dt;
    p.y = this.track.heightAt(p.z);
    // Kraft: im Wind teuer, im Windschatten Erholung, Antreten kostet viel
    if (racing) {
      const cost = 0.018 * Math.pow(p.v / 16, 3) * (1 - 0.6 * this.draft) + (go ? 0.064 : 0);
      const regen = 0.0125 + (ease ? 0.01 : 0);
      this.energy = clamp(this.energy - ((cost - regen) * dt) / s.end, 0, 1);
      if (this.draft > 0.45) this.draftTime += dt;
      if (go && !this.launchAt && d < 900) this.launchAt = Math.round(d);
      this.topV = Math.max(this.topV, p.v);
    }
    // seitlich: zum Ziel des Daumens, aber nicht in einen Nebenmann hinein
    const want = clamp((this.tx - p.x) * 5, -2.4, 2.4);
    let nx = p.x + want * dt;
    for (const o of this.opps) {
      if (Math.abs(o.z - p.z) > 1.5) continue;
      const before = p.x - o.x;
      const after = nx - o.x;
      if (Math.abs(after) < 0.58 && Math.abs(after) < Math.abs(before)) {
        nx = p.x;
        if (!this.flags.has('bump') && racing) { this.flags.add('bump'); this.shake = 0.5; }
      }
    }
    p.vx = (nx - p.x) / dt;
    p.x = clamp(nx, -XMAX, XMAX);
    p.lean += (clamp(-p.vx * 0.12, -0.25, 0.25) - p.lean) * Math.min(1, dt * 8);
    p.pedal += p.v * dt * 0.62 * (go ? 1.15 : 1);
    p.tuck += ((go ? 0.15 : 0.6) - p.tuck) * Math.min(1, dt * 5);
    // Antritt im Wiegetritt
    p.stand = (p.stand ?? 0) + ((go ? 1 : 0) - (p.stand ?? 0)) * Math.min(1, dt * 6);
    // Ansagen
    if (racing) this.callouts(d);
    // Ziel
    if (this.finT < 0 && p.z >= SPRINT_FINISH) {
      this.finT = this.time - (p.z - SPRINT_FINISH) / Math.max(1, p.v);
      const pl = this.place();
      if (pl === 1) { this.pop('Sieg!', 'gold', 'Etappensieg', true); this.confetti(); }
      else this.pop(`${pl}. Platz`, pl <= 3 ? 'gold' : 'white', undefined, true);
    }
  }

  private windT = 0;
  private callouts(d: number) {
    const once = (key: string, f: () => void) => { if (!this.flags.has(key)) { this.flags.add(key); f(); } };
    this.windT = this.draft < 0.2 ? this.windT + SUB : 0;
    if (this.windT > 5 && d > 500) once('wind', () => this.opts.onEvent?.({ type: 'banner', title: 'Du fährst im Wind', sub: 'Such dir ein Hinterrad – das spart Kraft' }));
    if (d < 2000) once('2k', () => this.opts.onEvent?.({ type: 'banner', title: 'Noch 2 km', sub: this.opps.some((o) => o.team === MATE && !o.peeled) ? 'Bleib am Hinterrad deines Anfahrers' : 'Bleib im Windschatten' }));
    // Züge: wer bringt seinen Sprinter nach vorn, wann fällt der letzte Anfahrer?
    if (d < 1300 && d > 700 && !this.flags.has('train')) {
      const lead = this.opps.filter((o) => !o.done).sort((a, b) => b.z - a.z)[0];
      if (lead && lead.team >= 0 && lead.team < 4 && lead.teamName && Math.abs(lead.z - this.p.z) < 80) {
        this.flags.add('train');
        const spr = this.opps.find((o) => o.team === lead.team && o.sprinter);
        this.opts.onEvent?.({ type: 'banner', title: `Zug von ${lead.teamName}`, sub: spr ? `${lastName(spr.name)} sitzt hinten im Zug` : undefined });
      }
    }
    const w = this.wheelOf();
    if (w && w.sprinter && w.team >= 0 && w.team < 4 && d < 700 && d > 320) {
      const helpers = this.opps.filter((o) => o.team === w.team && !o.sprinter && !o.peeled);
      if (!helpers.length) once('lastman', () => this.opts.onEvent?.({ type: 'banner', title: `${lastName(w.name)} ist ohne Anfahrer`, sub: 'Am Hinterrad bleiben – er geht gleich!' }));
    }
    if (d < 1000) once('1k', () => this.opts.onEvent?.({ type: 'banner', title: 'Flamme Rouge', sub: 'Letzter Kilometer', tone: 'red' }));
    if (d < 300) {
      once('300', () => { this.placeAt300 = this.place(); });
      if (!this.launchAt) once('now', () => this.opts.onEvent?.({ type: 'banner', title: 'Jetzt antreten!', sub: 'Daumen hoch', tone: 'accent' }));
    }
  }

  // ------------------------------------------------------------ Gegner

  private stepRacers(dt: number) {
    const roll = this.phase === 'countdown';
    for (const o of this.opps) {
      const d = SPRINT_FINISH - o.z;
      const V = roll ? 9 : packSpeed(d);
      o.driftT -= dt;
      if (o.driftT <= 0) { o.driftT = between(this.rng, 2, 5); o.drift = between(this.rng, -0.35, 0.45); }
      const wheel = this.wheelAhead(o.z, o.x, 9, o);
      let vd = V + o.drift;
      // Feld bleibt zusammen: Lücken nach vorn werden zugefahren
      if (!roll && !this.anyAhead(o, 7)) vd += 0.9;
      if (wheel) {
        vd = Math.min(vd + 0.8, wheel.v + (wheel.z - o.z - 1.6) * 0.8);
        // hinter einem Langsamen (abgefallener Anfahrer, Platter) nicht hängen bleiben
        if (!o.peeled && wheel.v < V - 0.4 && wheel.z - o.z < 5) this.changeLane(o);
      }
      const inTrain = o.team >= 0 && o.team !== MATE && !o.peeled;
      if (o.team === MATE && !o.peeled && !roll && d > 0) {
        // eigener Anfahrer: bleibt vor dir; ab 1,3 km bringt er dich nach vorn und wartet, wenn du abreißt
        const gap = o.z - this.p.z;
        if (d > 1300) {
          // im Feld mitrollen wie alle anderen (vd aus dem Hinterrad oben); nur warten oder kurz aufschließen
          if (gap > 4) vd = Math.min(vd, V - 0.6);
          else if (gap < 0.9) vd = Math.max(vd, V + 0.4);
          if (Math.abs(this.p.x - o.x) > 0.3 && gap > 0.6) o.tx = this.p.x;
        } else {
          const front = this.opps.some((m) => m !== o && m.z > o.z && m.z - o.z < 25);
          vd = V + (front ? 1.0 : 0.45);
          if (gap > 5) vd = Math.min(vd, this.p.v + 0.3);
          if (wheel && wheel.z - o.z < 3) this.changeLane(o);
        }
        if (d < o.peel) {
          o.peeled = true;
          o.tx = o.x >= 0 ? XMAX : -XMAX;
          if (gap > -2 && gap < 12) this.opts.onEvent?.({ type: 'banner', title: `${lastName(o.name)} ist raus`, sub: 'Jetzt du – antreten!', tone: 'accent' });
        }
      }
      if (!roll && inTrain && d < 1350 && d > 0) {
        // Zug: vorn fährt der erste noch nicht abgefallene, die anderen bleiben dicht dran
        const mates = this.opps.filter((m) => m.team === o.team && !m.peeled).sort((a, b) => a.order - b.order);
        const lead = mates[0];
        if (lead === o && !o.sprinter) {
          const front = this.opps.some((m) => m.team !== o.team && m.z > o.z && m.z - o.z < 30) || this.p.z > o.z && this.p.z - o.z < 30;
          vd = V + (front ? 0.9 : 0.35);
          if (wheel && wheel.z - o.z < 3) this.changeLane(o);
        } else {
          const idx = mates.indexOf(o);
          const ahead = mates[idx - 1];
          if (ahead) { vd = clamp(ahead.v + (ahead.z - o.z - 1.5) * 1.1, ahead.v - 1.5, ahead.v + 1.5); o.tx = ahead.x; }
        }
        if (!o.sprinter && d < o.peel) {
          // abfallen: zur Seite raus und Tempo raus
          o.peeled = true;
          o.tx = o.x >= 0 ? XMAX : -XMAX;
        }
      }
      if (o.peeled) vd = Math.min(vd, V - 2.8);
      // Sprint
      if (!roll && o.sprinter && d < o.launch && d > -5) {
        if (!o.going) { o.going = true; o.e = 0.95; }
        const dr = this.draftFor(o.z, o.x, o);
        vd = o.top + 0.8 * dr - Math.max(0, 0.18 - o.e) * 18;
        o.e = Math.max(0, o.e - dt * 0.085);
        if (wheel && wheel.z - o.z < 3.2) this.changeLane(o);
      } else if (!roll && !o.sprinter && o.team !== MATE && d < 280 && d > 0) vd = Math.min(vd, V - 0.6);
      if (!roll && !o.peeled && d > 0) vd = Math.max(vd, V - 3);
      if (d < -4) vd = 9;
      o.v = clamp(o.v + clamp(vd - o.v, -2.6 * dt, (o.going ? o.acc : 2.2) * dt), 0, 23);
      // nicht auffahren: hinter dem Vordermann bleiben, zu dicht → etwas zurückfallen
      const front = this.wheelAhead(o.z, o.x, 1.7, o);
      if (front) o.v = Math.min(o.v, front.v - Math.max(0, 1.5 - (front.z - o.z)) * 2);
      const z0 = o.z;
      o.z += o.v * dt;
      if (!o.done && z0 < SPRINT_FINISH && o.z >= SPRINT_FINISH) { o.done = true; o.finT = this.time - (o.z - SPRINT_FINISH) / Math.max(1, o.v); }
      // seitlich, ohne in andere hinein
      const want = clamp((o.tx - o.x) * 2.5, -1.3, 1.3);
      let nx = o.x + want * dt;
      for (const m of this.opps) {
        if (m === o || Math.abs(m.z - o.z) > 1.5) continue;
        if (Math.abs(nx - m.x) < 0.58 && Math.abs(nx - m.x) < Math.abs(o.x - m.x)) nx = o.x;
      }
      if (Math.abs(this.p.z - o.z) < 1.5 && Math.abs(nx - this.p.x) < 0.58 && Math.abs(nx - this.p.x) < Math.abs(o.x - this.p.x)) nx = o.x;
      o.vx = (nx - o.x) / dt;
      o.x = clamp(nx, -XMAX, XMAX);
      o.lean += (clamp(-o.vx * 0.12, -0.25, 0.25) - o.lean) * Math.min(1, dt * 8);
      o.pedal += o.v * dt * 0.62;
      o.tuck += ((o.going ? 0.15 : 0.6) - o.tuck) * Math.min(1, dt * 5);
      o.stand = (o.stand ?? 0) + ((o.going && o.e > 0.2 ? 1 : 0) - (o.stand ?? 0)) * Math.min(1, dt * 6);
    }
  }

  /** Hinterrad des Spielers (bis 6 m, gleiche Spur) */
  private wheelOf(): Racer | null {
    let best: Racer | null = null;
    for (const o of this.opps) {
      const dz = o.z - this.p.z;
      if (dz > 0.3 && dz < 6 && Math.abs(o.x - this.p.x) < 0.6 && (!best || dz < best.z - this.p.z)) best = o;
    }
    return best;
  }

  /** fährt jemand (beliebige Spur) bis dist m vor o? */
  private anyAhead(o: Racer, dist: number): boolean {
    if (this.p.z > o.z && this.p.z - o.z < dist) return true;
    return this.opps.some((m) => m !== o && m.z > o.z && m.z - o.z < dist);
  }

  /** auf eine freie Nachbarspur ausweichen (Zug oder Sprinter will vorbei) */
  private changeLane(o: Racer) {
    for (const dx of o.x >= 0 ? [-1.05, 1.05] : [1.05, -1.05]) {
      const nx = o.x + dx;
      if (Math.abs(nx) > XMAX + 0.01) continue;
      const busy = this.opps.some((m) => m !== o && Math.abs(m.x - nx) < 0.6 && m.z - o.z > -2.2 && m.z - o.z < 5)
        || (Math.abs(this.p.x - nx) < 0.6 && this.p.z - o.z > -2.2 && this.p.z - o.z < 5);
      if (!busy) { o.tx = nx; return; }
    }
  }

  // ------------------------------------------------------------ Ende

  private finish() {
    this.phase = 'over';
    this.phaseT = 0;
    const place = this.place();
    const all = [...this.opps.filter((o) => o.done).map((o) => ({ name: o.name, t: o.finT, me: false })), { name: 'Du', t: this.finT, me: true }].sort((a, b) => a.t - b.t);
    const win = all[0];
    const placePts = place <= PLACE_PTS.length ? PLACE_PTS[place - 1] : Math.max(40, 180 - 6 * (place - 11));
    const draftPts = Math.min(160, Math.round(this.draftTime * 1.6));
    const gain = Math.max(0, (this.placeAt300 || place) - place) * 30;
    const base = placePts + draftPts + gain;
    const typePts = Math.round(base * (this.stats.bonus - 1));
    this.opts.onOver?.({
      place, riders: this.riders,
      score: base + typePts,
      parts: { place: placePts, draft: draftPts, gain, type: typePts },
      winner: win.me ? this.opts.rider.name : win.name,
      gap: Math.max(0, this.finT - win.t),
      topKmh: Math.round(this.topV * 3.6),
      launchAt: this.launchAt,
      podium: all.slice(0, 3).map((x) => ({ name: x.me ? this.opts.rider.name : x.name, me: x.me })),
    });
  }

  private confetti() {
    const cols = ['#ff5fa2', '#ffd23f', '#2f80ed', '#27ae60', '#ffffff'];
    for (let i = 0; i < 70; i++) {
      this.parts.push({ kind: 'confetti', z: this.p.z + 3 + Math.random() * 6, x: (Math.random() - 0.5) * 6, h: 2 + Math.random() * 2,
        vz: this.p.v * 0.6, vx: (Math.random() - 0.5) * 3, vh: 1 + Math.random() * 2, life: 2.5, max: 2.5, size: 0.12, color: cols[i % cols.length], rot: Math.random() * 6 });
    }
  }

  pop(text: string, tone: Popup['tone'], sub?: string, big = false, small = false) {
    if (this.popups.length > 4) this.popups.shift();
    const n = (sd: number) => this.popups.filter((q) => q.side === sd).length;
    let side: -1 | 1;
    if (n(-1) === n(1)) { this.popSide = this.popSide === 1 ? -1 : 1; side = this.popSide; } else side = n(-1) < n(1) ? -1 : 1;
    const used = new Set(this.popups.filter((q) => q.side === side).map((q) => q.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    this.popups.push({ text, sub, tone, side, slot, age: 0, life: big ? 2.2 : small ? 1.1 : 1.5, dx: 0.5, dy: 0.5, big });
  }
}

/** Rand der Fahrbahn, für Tests */
export const SPRINT_XMAX = XMAX;
void EDGE;
