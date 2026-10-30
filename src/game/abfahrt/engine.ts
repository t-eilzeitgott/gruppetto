/**
 * Spiellogik „Abfahrt“: Fahrphysik (Gefälle, Luftwiderstand, Windschatten, Fliehkraft, Grip,
 * Sprünge), Gegner, Hindernisse, Punkte mit Kombo-Multiplikator und Tagesaufgaben.
 * Ohne DOM – der Renderer liest den Zustand, die Seite bekommt Ereignisse.
 */
import { mulberry32, between, chance, pick, type Rng } from './rng';
import { EDGE, ROAD_HALF, SEG, Track, difficulty, type Obj, type Seg, type Side, type BiomeId } from './track';
import { SKINS, TEAM_KITS, type Kit } from './rider';
import type { Mission, MissionStat } from './missions';
import { cadenceFor, pedalStep, smooth } from './motion';
import { GhostPack, GhostRecorder } from './ghosts';
import { wreckSettled, wreckTravel, type Wreck } from './wreck';
import type { GhostRider } from '../tt';

export const G = 9.81;
const CD = 0.00105;          // Luftwiderstand in Abfahrtshaltung (1/m)
const RR = 0.05;             // Rollwiderstand (m/s²)
const VMAX = 40;             // ~144 km/h
const SUB = 1 / 120;

export type Phase = 'ready' | 'countdown' | 'playing' | 'crash' | 'over';
export type ScoreCat = 'dist' | 'bidons' | 'draft' | 'overtake' | 'near' | 'air' | 'curves' | 'bonus' | 'missions' | 'friends';
export const SCORE_LABEL: Record<ScoreCat, string> = {
  dist: 'Strecke', bidons: 'Trinkflaschen', draft: 'Windschatten', overtake: 'Überholt', near: 'Knapp vorbei',
  air: 'Sprünge', curves: 'Kurven und Kehren', bonus: 'Täler und Sprints', missions: 'Aufgaben', friends: 'Freunde geschlagen',
};

export interface Player {
  z: number; x: number; vx: number; v: number;
  y: number; vy: number; air: boolean; airT: number;
  lean: number; pedal: number; tuck: number; brake: number;
  wobble: number; slip: number; grip: number; slick: number;
  kit: Kit;
  /** Wiegetritt 0–1 (Antritt, Sprint, Attacke am Berg) */
  stand?: number;
  /** Drehzahl der Kurbel (rad/s), siehe motion.ts */
  cad?: number;
}

export interface Opp {
  id: number; z: number; x: number; vx: number; v: number;
  tx: number; f: number; kit: Kit; pedal: number; lean: number; tuck: number; brake: number;
  passed: boolean; group: number; bump: number; attacker: boolean;
  /** Wiegetritt 0–1 */
  stand?: number;
  /** Drehzahl der Kurbel (rad/s), siehe motion.ts */
  cad?: number;
  /** Geist (Zeitfahren): halbdurchsichtig mit dieser Deckkraft (0 = unsichtbar) */
  ghost?: number;
  /** gestürzt (Massensturz, WebGPU-Abfahrt): liegt und rutscht nach wreck.ts */
  wreck?: Wreck;
  /** sieht den Sturz voraus und reagiert ab dieser Spielzeit (s) – vorher fährt er ahnungslos weiter */
  sees?: number;
}

export interface Particle {
  kind: 'dust' | 'spark' | 'splash' | 'confetti' | 'cone' | 'gravel' | 'snow' | 'wind';
  z: number; x: number; h: number; vz: number; vx: number; vh: number;
  life: number; max: number; size: number; color: string; rot: number;
}

export interface Popup {
  text: string; sub?: string; tone: 'accent' | 'gold' | 'white' | 'muted' | 'red' | 'blue';
  age: number; life: number; dx: number; dy: number; big: boolean;
  /** Punkte getrennt vom Text („+20“), Seite links/rechts vom Fahrer, Platz in der Spalte */
  pts?: string; side: -1 | 1; slot: number;
}

export interface Friend { userId: string; name: string; color: string; meters: number; passed?: boolean }

/** Eintrag der TV-Tafel: Platz, Name, Abstand zur Spitze (s) */
export interface Standing { pos: number; name: string; gap: number; me: boolean }

interface Entrant { z: number; v: number; name?: string; done?: boolean; finT?: number }

/** TV-Tafel wie in der Übertragung: Spitze, Zweiter und der Spieler (ohne Doppelte), Abstände zur Spitze in Sekunden */
export function standings(opps: Entrant[], me: { z: number; v: number }, meFinT: number): Standing[] {
  const all = [...opps.map((o) => ({ z: o.z, v: o.v, name: o.name ?? '', done: !!o.done, finT: o.finT ?? -1, me: false })),
    { z: me.z, v: me.v, name: 'Du', done: meFinT >= 0, finT: meFinT, me: true }];
  all.sort((a, b) => (a.done && b.done ? a.finT - b.finT : a.done ? -1 : b.done ? 1 : b.z - a.z));
  const L = all[0];
  const gapOf = (x: typeof L) => (x === L ? 0 : x.done && L.done ? x.finT - L.finT : Math.max(0, (L.z - x.z) / Math.max(4, x.v)));
  const out: Standing[] = [];
  const add = (i: number) => { const x = all[i]; if (x && !out.some((o) => o.pos === i + 1)) out.push({ pos: i + 1, name: x.name, gap: gapOf(x), me: x.me }); };
  add(0);
  add(1);
  add(all.findIndex((x) => x.me));
  return out;
}

/** Was die 3D-Darstellung von einem Rennen braucht (Abfahrt und Sprintfinale) */
/** Namensschild über einem Fahrer im Bild (wie die Fahrerkennung in der Übertragung); sub: Zusatz (Zeitabstand), color: Farbpunkt */
export interface RiderTag { id: number; text: string; mate?: boolean; sub?: string; color?: string }

export interface RaceView {
  /** Namensschilder (z. B. das Hinterrad, an dem du gerade fährst) */
  tags?: RiderTag[];
  track: Track;
  phase: Phase;
  phaseT: number;
  p: Player;
  opps: Opp[];
  /** Geister (Abfahrt, Sprint, Berg): halbdurchsichtige Fahrer ohne Physik, nur in der Darstellung */
  ghosts?: Opp[];
  popups: Popup[];
  parts: Particle[];
  friends: Friend[];
  shake: number;
  crashSpin: number;
  /** Massensturz: eigener Sturz (wreck.ts), sonst null */
  wreck?: Wreck | null;
  /** Ort des ersten Aufpralls im Massensturz (Kamera) */
  pileAt?: { z: number; x: number } | null;
  /** Zeitlupe beim Sturz: Spielzeit je echter Sekunde */
  timeScale?: number;
}

export interface HudState {
  score: number; mult: number; multLeft: number; kmh: number; meters: number; draft: number;
  next: { name: string; color: string; dist: number } | null; brake: number; air: boolean;
  /** Daumenhaltung: ducken (hoch) und bremsen (runter), für Anzeige und Tutorial */
  tuck: number; wantTuck: boolean; wantBrake: number; steered: number;
  touch: { x: number; y: number } | null; curveIn: number;
}

export type GameEvent =
  | { type: 'count'; n: number }
  | { type: 'section'; name: string; biome: BiomeId; alt: number; first: boolean }
  | { type: 'mission'; id: string; text: string }
  | { type: 'friend'; name: string; color: string }
  | { type: 'record' }
  | { type: 'tip'; text: string };

export interface RunResult {
  score: number; meters: number; topKmh: number; reason: string;
  parts: Record<ScoreCat, number>;
  stats: Record<MissionStat, number>;
  missionsDone: string[];
  friendsBeaten: string[];
  sectionName: string;
  /** eigene Fahrspur (Geist) – Rennzeit → Streckenmeter, Lage, Haltung */
  trace: number[];
}

export interface GameOptions {
  dayKey: string;
  names: string[];
  friends: Friend[];
  kit: Kit;
  best: number;
  missions: Mission[];
  missionsDone: Set<string>;
  tutorial: boolean;
  /** Testfahrt (Admin): Zeitraffer (2 oder 3), keine Hindernisse, kein Sturz – zählt nicht in den Tabellen */
  cruise?: number;
  /** Geister: eigener Lauf und die der Runde (heute oder der letzte) */
  ghosts?: GhostRider[];
  /**
   * WebGPU-Abfahrt: keine Hindernisse auf der Straße; dafür Massenstürze – wer zu schnell auf ein Hinterrad fährt,
   * reißt sich und den Vordermann um, und wer dahinter zu spät reagiert, fällt drüber
   */
  pileups?: boolean;
  /**
   * WebGPU-Abfahrt: Fahrerfeld – so viele Fahrer stehen am Start mit dir (du startest hinten) und so viele sind
   * unterwegs ungefähr um dich herum (neue Gruppen kommen weit voraus dazu, Abgehängte fallen weg)
   */
  field?: number;
  onEvent?: (e: GameEvent) => void;
  onOver?: (r: RunResult) => void;
}

const HAZARD = new Set(['rock', 'cow', 'pothole', 'cone']);

const emptyParts = (): Record<ScoreCat, number> => ({ dist: 0, bidons: 0, draft: 0, overtake: 0, near: 0, air: 0, curves: 0, bonus: 0, missions: 0, friends: 0 });
const emptyStats = (): Record<MissionStat, number> => ({ overtakes: 0, draftTime: 0, bidons: 0, topKmh: 0, near: 0, airTime: 0, km: 0, hairpins: 0, combo: 1, cleanKm: 0 });

export class Abfahrt {
  readonly opts: GameOptions;
  track: Track;
  phase: Phase = 'ready';
  time = 0;
  phaseT = 0;
  p!: Player;
  opps: Opp[] = [];
  /** Geister in der Darstellung (siehe ghosts.ts) */
  ghosts: Opp[] = [];
  tags: RiderTag[] = [];
  parts: Particle[] = [];
  popups: Popup[] = [];
  friends: Friend[];
  private pack!: GhostPack;
  private rec = new GhostRecorder();
  private ghostT = 0;
  /** eigener Sturz im Massensturz (wreck.ts); null = kein solcher Sturz */
  wreck: Wreck | null = null;
  /** Gestürzte im aktuellen Massensturz (mit dir) */
  pileCount = 0;
  /** Ort des ersten Aufpralls (Kamera) */
  pileAt: { z: number; x: number } | null = null;
  score = emptyParts();
  stats = emptyStats();
  chain = 0;
  mult = 1;
  multT = 0;
  draft = 0;
  shake = 0;
  heading = 0;              // aufsummierte Richtungsänderung (für den Hintergrund)
  crashReason = '';
  crashSpin = 0;
  timeScale = 1;
  sectionIdx = -1;
  missionsDone: Set<string>;
  private rng: Rng;
  private oppId = 0;
  private nextSpawn = 160;
  private overtakePop = -9;
  private curve = { active: false, sign: 0, hairpin: false, minV: 99, clean: true, maxK: 0 };
  private lastBarrier = 0;
  private lastBarrierZ = 0;
  private draftHeld = 0;
  private draftPopup = 0;
  private edgeT = 0;
  private edgeCool = 0;
  private offT = 0;
  private recordShown = false;
  private overtakeTimes: number[] = [];
  private tipsShown = new Set<string>();
  private steer = { active: false, sx: 0, sy: 0, tx0: 0 };
  private keys = { left: false, right: false, down: false, up: false };
  /** Spieler will sich ducken (Daumen hoch) bzw. bremsen (Daumen runter, 0–1) */
  private wantTuck = false;
  private wantBrake = 0;
  /** wie weit insgesamt gelenkt wurde (für das Tutorial) */
  private steered = 0;
  tx = 0;
  private txs = 0;
  private viewW = 390;

  constructor(opts: GameOptions) {
    this.opts = opts;
    this.friends = opts.friends.map((f) => ({ ...f, passed: false })).sort((a, b) => a.meters - b.meters);
    this.missionsDone = new Set(opts.missionsDone);
    this.track = new Track(opts.dayKey, opts.names);
    if (opts.cruise) { this.track.dropHazards(); this.dbg.speed = opts.cruise; }
    else if (opts.pileups) this.track.dropHazards();
    this.rng = mulberry32(this.track.seed ^ 0x5eed);
    this.reset();
  }

  reset() {
    this.track = new Track(this.opts.dayKey, this.opts.names);
    if (this.opts.cruise || this.opts.pileups) this.track.dropHazards();
    // WebGPU-Abfahrt (Massenstürze): Straße mal breiter, mal enger
    this.track.widthVar = !!this.opts.pileups;
    this.rng = mulberry32(this.track.seed ^ 0x5eed);
    this.wreck = null;
    this.pileCount = 0;
    this.pileAt = null;
    this.p = {
      z: 6, x: 0.9, vx: 0, v: 0, y: 0, vy: 0, air: false, airT: 0,
      lean: 0, pedal: 0, tuck: 0, brake: 0, wobble: 0, slip: 0, grip: 1, slick: 0,
      kit: this.opts.kit,
    };
    this.p.y = this.track.heightAt(this.p.z);
    this.tx = this.p.x;
    this.txs = this.p.x;
    this.opps = [];
    this.parts = [];
    this.popups = [];
    this.score = emptyParts();
    this.stats = emptyStats();
    this.chain = 0; this.mult = 1; this.multT = 0;
    this.draft = 0; this.shake = 0; this.heading = 0;
    this.phase = 'ready'; this.phaseT = 0; this.time = 0; this.timeScale = 1;
    this.nextSpawn = 120;
    this.sectionIdx = -1;
    this.recordShown = false;
    this.lastBarrierZ = 0;
    this.friends.forEach((f) => { f.passed = false; });
    this.pack = new GhostPack(this.track, this.opts.cruise ? [] : this.opts.ghosts ?? []);
    this.ghosts = this.pack.opps;
    this.rec.reset();
    this.ghostT = 0;
    this.tags = [];
    // ein paar Fahrer stehen mit am Start
    this.spawnStartGroup();
  }

  get total(): number {
    let s = 0;
    for (const k in this.score) s += this.score[k as ScoreCat];
    return Math.round(s);
  }

  setViewport(w: number) { this.viewW = Math.max(240, w); }

  start() {
    if (this.phase !== 'ready' && this.phase !== 'over') return;
    if (this.phase === 'over') this.reset();
    this.phase = 'countdown';
    this.phaseT = 0;
    this.opts.onEvent?.({ type: 'count', n: 3 });
  }

  // ------------------------------------------------------------ Eingabe

  pointerDown(x: number, y: number) {
    this.steer = { active: true, sx: x, sy: y, tx0: this.tx };
  }
  pointerMove(x: number, y: number) {
    if (!this.steer.active) return;
    // seitlich lenken: eine Bildschirmbreite ≈ von Rand zu Rand
    const k = 7.5 / this.viewW;
    const ew = EDGE + this.track.extraAt(this.p.z);
    const nx = clamp(this.steer.tx0 + (x - this.steer.sx) * k, -ew - 1.2, ew + 1.2);
    this.steered += Math.abs(nx - this.tx);
    this.tx = nx;
    // hoch schieben = ducken, runter ziehen = bremsen (mit etwas Spiel, damit Lenken nicht auslöst)
    const dy = this.steer.sy - y;
    this.wantTuck = this.wantTuck ? dy > 16 : dy > 30;
    this.wantBrake = clamp((-dy - 24) / 46, 0, 1);
    // Daumen weit weggerutscht: Ankerpunkt mitziehen, damit man nicht „festhängt“
    if (dy > 110) this.steer.sy = y + 110;
    if (dy < -110) this.steer.sy = y - 110;
  }
  pointerUp() {
    this.steer.active = false;
    this.wantTuck = false;
    this.wantBrake = 0;
  }
  key(name: 'left' | 'right' | 'down' | 'up', down: boolean) {
    this.keys[name] = down;
  }

  // ------------------------------------------------------------ Hauptschleife

  /** Testfahrt: Zeitraffer (1–5), Stehenbleiben, Vor- und Zurückschieben (−1/0/1) – vom Prüfpult aus gesetzt */
  dbg = { speed: 1, freeze: false, move: 0 };

  update(dtReal: number) {
    if (this.opts.cruise && this.phase === 'playing') {
      // Prüfpult: steht oder wird geschoben – die Welt läuft weiter, der Fahrer rollt nicht
      if (this.dbg.move !== 0) {
        this.p.z = Math.max((this.track.first + 2) * SEG, this.p.z + this.dbg.move * 22 * dtReal);
        this.p.y = this.track.heightAt(this.p.z);
        this.p.v = 0;
      }
      if (this.dbg.freeze || this.dbg.move !== 0) { this.time += dtReal; this.stepFx(0.0001, dtReal); return; }
    }
    // Testfahrt: Zeitraffer (die Welt läuft schneller, die Fahrphysik bleibt gleich)
    const dt = Math.min(0.05, dtReal) * this.timeScale * (this.phase === 'playing' && this.opts.cruise ? this.dbg.speed : 1);
    this.time += dt;
    this.phaseT += dtReal;
    {
      const ew = EDGE + this.track.extraAt(this.p.z);
      if (this.keys.left) { this.tx = clamp(this.tx - 6 * dt, -ew - 1.2, ew + 1.2); this.steered += 6 * dt; }
      if (this.keys.right) { this.tx = clamp(this.tx + 6 * dt, -ew - 1.2, ew + 1.2); this.steered += 6 * dt; }
    }

    if (this.phase === 'countdown') {
      const n = 3 - Math.floor(this.phaseT / 0.75);
      if (n !== this.countShown) {
        this.countShown = n;
        this.opts.onEvent?.({ type: 'count', n: Math.max(0, n) });
      }
      if (this.phaseT >= 2.25) {
        this.phase = 'playing';
        this.phaseT = 0;
        this.p.v = 5;
        for (const o of this.opps) o.v = 5;
      }
    }

    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(SUB, left);
      if (this.phase === 'playing') this.stepPlayer(h);
      else if (this.phase === 'crash') this.stepCrash(h);
      this.stepOpps(h);
      left -= h;
    }
    this.stepFx(dt, dtReal);
    this.stepGhosts(dt);

    if (this.phase === 'crash') {
      if (this.wreck) {
        // Massensturz: kurz Zeitlupe, dann in Echtzeit zusehen, wie das Feld drüberfällt – Ende, wenn alles liegt
        this.timeScale = this.phaseT < 1.1 ? 0.4 : Math.min(1, this.timeScale + dtReal * 1.5);
        const moving = this.opps.some((o) => o.wreck && !wreckSettled(o.wreck));
        if ((this.phaseT > 3.2 && !moving && wreckSettled(this.wreck)) || this.phaseT > 6.5) this.finish();
      } else {
        this.timeScale = this.phaseT < 0.9 ? 0.35 : Math.min(1, this.timeScale + dtReal * 2);
        if (this.phaseT > 1.8) this.finish();
      }
    }
    this.track.trim(Math.floor(this.p.z / SEG) - 200);
  }

  private countShown = 4;

  hud(): HudState {
    const next = this.friends.find((f) => !f.passed && f.meters > this.p.z);
    return {
      score: this.total,
      mult: this.mult,
      multLeft: this.mult > 1 ? clamp(this.multT / 3.5, 0, 1) : 0,
      kmh: Math.round(this.p.v * 3.6),
      meters: Math.floor(this.p.z),
      draft: this.draft,
      next: next ? { name: next.name, color: next.color, dist: Math.max(0, Math.round(next.meters - this.p.z)) } : null,
      brake: this.p.brake,
      air: this.p.air,
      tuck: this.p.tuck,
      wantTuck: this.wantTuck || this.keys.up,
      wantBrake: Math.max(this.wantBrake, this.keys.down ? 1 : 0),
      steered: this.steered,
      touch: this.steer.active ? { x: this.steer.sx, y: this.steer.sy } : null,
      curveIn: this.curveAhead(),
    };
  }

  /** Abstand bis zur nächsten engen Kurve/Kehre (für das Tutorial), sonst 999 */
  private curveAhead(): number {
    for (let d = 0; d < 160; d += 4) {
      const s = this.track.segAt(this.p.z + d);
      if (s.hairpin || Math.abs(s.curve) > 0.03) return d;
    }
    return 999;
  }

  // ------------------------------------------------------------ Spieler

  private sideAt(seg: Seg, x: number): Side { return x < 0 ? seg.L : seg.R; }

  private stepPlayer(dt: number) {
    const p = this.p;
    const z0 = p.z;
    const seg = this.track.segAt(p.z);
    const D = difficulty(p.z);
    const k = seg.curve;
    // Straßenbreite hier (breitere und engere Stellen): seitlich gemessen ab der Normalbreite
    const ax = Math.abs(p.x) - this.track.extraAt(p.z);
    const side = this.sideAt(seg, p.x);

    // --- Grip
    let mu = seg.surface === 'gravel' ? 0.62 : seg.surface === 'cobble' ? 0.85 : seg.surface === 'fresh' ? 1.05 : 1;
    let extra = 0;
    if (ax > ROAD_HALF) { mu *= 0.72; extra += 1.4; }
    if (ax > EDGE) { mu *= 0.6; extra += 3.6; }
    if (p.slick > 0) mu *= 0.42;
    if (seg.tunnel) mu *= 0.95;
    p.grip = mu;

    // --- Längsdynamik
    let draft = 0;
    for (const o of this.opps) {
      const dz = o.z - p.z;
      if (dz < 0.9 || dz > 13) continue;
      const dx = Math.abs(o.x - p.x);
      if (dx > 0.9) continue;
      draft = Math.max(draft, Math.pow(1 - (dz - 0.9) / 12.1, 0.7) * (1 - dx / 0.9));
    }
    this.draft += (draft - this.draft) * Math.min(1, dt * 6);
    const steering = Math.abs(this.tx - p.x);
    // Bremsassistent: vor Kurven automatisch auf ein fahrbares Tempo bremsen
    let vSafe = 99;
    for (let d = 0; d <= 48; d += 4) {
      const kk = Math.abs(this.track.segAt(p.z + d).curve);
      if (kk > 0.002) vSafe = Math.min(vSafe, Math.sqrt((0.92 * mu * G) / kk) + d * 0.12);
    }
    const assist = clamp((p.v - vSafe) / 2.5, 0, 1);
    const manual = Math.max(this.wantBrake, this.keys.down ? 1 : 0);
    const wantBrake = p.air ? 0 : Math.max(assist, manual);
    p.brake += (wantBrake - p.brake) * Math.min(1, dt * 8);
    // Ducken nur auf Wunsch (Daumen hoch); beim Bremsen richtet man sich auf
    const tuckOn = (this.wantTuck || this.keys.up) && p.brake < 0.3 && !p.air;
    p.tuck += ((tuckOn ? 1 : 0) - p.tuck) * Math.min(1, dt * 4);
    void steering;
    const cd = CD * (1 + 0.45 * (1 - p.tuck)) * (1 - 0.42 * this.draft) * (1 + p.brake * 0.4);
    const aG = -G * seg.grade;
    let a = aG - RR - extra - cd * p.v * p.v;
    if (p.v < 13 && !p.air) a += 1.8 * (1 - p.v / 13) + 0.5;  // antreten
    if (!p.air) a -= p.brake * 7.5 * Math.min(1, mu);
    p.v = clamp(p.v + a * dt, 0, VMAX);
    p.z += p.v * dt;

    // --- Querdynamik mit Fliehkraft und Grip-Grenze
    const ac = k * p.v * p.v;
    // Daumen geglättet, damit kleine Zitterbewegungen nicht durchschlagen
    this.txs += (this.tx - this.txs) * Math.min(1, dt * 12);
    const kp = 46;
    const kd = 13.5;
    // geduckt lenkt man etwas träger
    const steerMax = 7 - 1.6 * p.tuck;
    let want = clamp(kp * (this.txs - p.x) - kd * p.vx, -steerMax, steerMax);
    let arel: number;
    if (p.air) {
      arel = -ac;
      want = 0;
    } else {
      const lim = mu * G;
      arel = clamp(want, -lim - ac, lim - ac);
      const over = Math.abs(want + ac) - lim;
      p.slip += ((over > 0 ? Math.min(1, over / 4) : 0) - p.slip) * Math.min(1, dt * 8);
    }
    if (p.wobble > 0) arel += Math.sin(this.time * 11) * p.wobble * 0.8;
    p.vx += arel * dt;
    p.x += p.vx * dt;
    // Schräglage vor allem aus der Kurve, Spurwechsel nur angedeutet – kein Hin-und-her-Wackeln
    const targetLean = p.air ? p.lean * 0.98 : Math.atan2(ac + arel * 0.4, G) * 0.85;
    p.lean += (clamp(targetLean, -0.62, 0.62) + Math.sin(this.time * 9) * p.wobble * 0.02 - p.lean) * Math.min(1, dt * 3.5);
    this.heading += k * p.v * dt;

    // --- Höhe, Kuppen und Sprünge
    const iNew = Math.floor(p.z / SEG);
    const iOld = Math.floor(z0 / SEG);
    const roadY = this.track.heightAt(p.z);
    if (!p.air) {
      if (iNew !== iOld) {
        const prev = this.track.seg(iOld);
        const cur = this.track.seg(iNew);
        if ((cur.grade - prev.grade) * p.v * p.v / SEG < -G * 1.05 && p.v > 9) {
          p.air = true;
          p.airT = 0;
          p.vy = prev.grade * p.v;
        }
      }
      if (!p.air) { p.y = roadY; p.vy = seg.grade * p.v; }
    }
    if (p.air) {
      p.airT += dt;
      p.vy -= G * dt;
      p.y += p.vy * dt;
      if (p.y <= roadY) this.land(roadY);
    }

    // --- Pedal und Kosmetik
    // treten bei niedrigem Tempo oder aufrecht; geduckt, bremsend und in der Luft rollen lassen – stufenlos,
    // die Kurbel selbst hat Schwung (motion.ts) und pendelt beim Rollen in die Waagrechte
    const drive = Math.max(smooth(16.5, 12.5, p.v), 1 - smooth(0.35, 0.65, p.tuck)) * (1 - p.brake) * (p.air ? 0 : 1);
    pedalStep(p, drive * cadenceFor(p.v), dt);
    p.wobble = Math.max(0, p.wobble - dt * 2);
    p.slick = Math.max(0, p.slick - dt);
    this.shake = Math.max(0, this.shake - dt * 3);
    if (ax > ROAD_HALF && !p.air && p.v > 6 && chance(this.rng, dt * 30)) this.dust(p.z, p.x, ax > EDGE ? side.ground : 'verge');
    if (seg.surface === 'cobble' && !p.air) this.shake = Math.max(this.shake, 0.12);
    if (seg.surface === 'gravel' && !p.air && chance(this.rng, dt * 14)) this.dust(p.z, p.x + (this.rng() - 0.5) * 0.3, 'gravel');
    if (p.slip > 0.4 && chance(this.rng, dt * 20)) this.dust(p.z, p.x, 'verge');

    // --- Ränder
    this.edges(seg, dt);
    if (this.phase !== 'playing') return;

    // --- Objekte
    for (let i = iOld - 1; i <= iNew + 1; i++) {
      const s = this.track.seg(Math.max(0, i));
      if (s.objs) for (const o of s.objs) this.touch(o, z0);
    }

    // --- Gegner
    this.oppContacts();

    // --- Strecke, Punkte, Statistik
    const dDist = p.z - z0;
    this.score.dist += dDist;
    this.stats.km = p.z / 1000;
    this.stats.topKmh = Math.max(this.stats.topKmh, p.v * 3.6);
    this.stats.cleanKm = Math.max(this.stats.cleanKm, (p.z - this.lastBarrierZ) / 1000);
    if (this.draft > 0.35) {
      this.draftHeld += dt;
      this.stats.draftTime += dt;
      this.score.draft += 14 * dt * this.mult;
      this.multT = Math.max(this.multT, 1.2);
      if (this.draftHeld > 0.5 && this.draftPopup <= 0) {
        this.pop('Windschatten', 'blue', '+Tempo');
        this.draftPopup = 6;
        this.bumpChain();
      }
    } else this.draftHeld = 0;
    this.draftPopup -= dt;
    if (this.multT > 0) {
      this.multT -= dt;
      if (this.multT <= 0) { this.chain = 0; this.mult = 1; }
    }

    this.curves(seg, dt);
    this.progress(seg, z0);
    this.spawn(D);
    this.checkMissions();
    if (!this.recordShown && this.opts.best > 0 && this.total > this.opts.best) {
      this.recordShown = true;
      this.pop('Neue Bestleistung!', 'gold', undefined, true);
      this.confetti();
      this.opts.onEvent?.({ type: 'record' });
    }
  }

  private land(roadY: number) {
    const p = this.p;
    const t = p.airT;
    const impact = Math.abs(p.vy - this.track.segAt(p.z).grade * p.v);
    p.air = false;
    p.y = roadY;
    this.shake = Math.max(this.shake, Math.min(0.8, impact * 0.12));
    if (Math.abs(p.lean) > 0.45 && impact > 3) p.wobble = Math.max(p.wobble, 0.8);
    this.stats.airTime += t;
    if (t > 0.22) {
      const pts = Math.round(t * 120);
      this.award('air', pts, t > 0.75 ? 'Flieger!' : 'Sprung', 'accent', `${t.toFixed(1).replace('.', ',')} s`);
    }
    for (let i = 0; i < 6; i++) this.dust(p.z, p.x + (this.rng() - 0.5) * 0.6, 'verge');
  }

  private edges(seg: Seg, dt: number) {
    const p = this.p;
    const sign = p.x < 0 ? -1 : 1;
    // gemessen ab der Normalbreite (die Straße ist hier um ex breiter oder schmaler)
    const ex = this.track.extraAt(p.z);
    const ax = Math.abs(p.x) - ex;
    const side = this.sideAt(seg, p.x);
    let limit = Infinity;
    let kind: 'rail' | 'stone' | 'wall' | 'tunnel' | 'kerb' | 'crowd' | 'fence' | null = null;
    if (seg.tunnel) { limit = EDGE - 0.35; kind = 'tunnel'; }
    else if (seg.crowd) { limit = EDGE - 0.1; kind = 'crowd'; }
    else if (side.wall > 0) { limit = EDGE; kind = 'wall'; }
    else if (side.barrier !== 'none') { limit = EDGE - 0.12; kind = side.barrier; }
    else if (side.ground === 'pavement') { limit = EDGE + 0.1; kind = 'kerb'; }

    // knapp an der Leitplanke entlang
    this.edgeCool -= dt;
    if (kind && ax > limit - 0.35 && ax <= limit && p.v > 15) {
      this.edgeT += dt;
      if (this.edgeT > 0.7 && this.edgeCool <= 0) {
        this.award('near', 25, 'Zentimeterarbeit', 'accent');
        this.edgeCool = 3;
        this.edgeT = 0;
      }
    } else this.edgeT = 0;

    if (ax > limit && kind) {
      const hard = Math.abs(p.vx) > 7.5 && p.v > 18 && kind !== 'kerb';
      if (hard) { this.crash(kind === 'wall' || kind === 'tunnel' ? 'Gegen die Felswand' : 'Über die Leitplanke'); return; }
      p.x = sign * (limit + ex);
      p.vx = -p.vx * 0.3 - sign * 1.1;
      this.tx = clamp(this.tx, -limit - ex + 0.4, limit + ex - 0.4);
      const loss = kind === 'wall' || kind === 'tunnel' ? 0.82 : kind === 'stone' ? 0.84 : kind === 'kerb' ? 0.9 : 0.87;
      p.v *= loss;
      p.wobble = Math.max(p.wobble, 0.55);
      this.shake = Math.max(this.shake, 0.55);
      this.mistake();
      this.curve.clean = false;
      this.lastBarrierZ = p.z;
      if (this.time - this.lastBarrier > 1.2) {
        const label = { rail: 'Leitplanke!', stone: 'Mäuerchen!', wall: 'Felswand!', tunnel: 'Tunnelwand!', kerb: 'Bordstein!', crowd: 'Absperrung!', fence: 'Zaun!' }[kind];
        this.pop(label, 'red');
      }
      this.lastBarrier = this.time;
      if (kind === 'rail' || kind === 'tunnel' || kind === 'crowd') for (let i = 0; i < 10; i++) this.spark(p.z, p.x);
      else for (let i = 0; i < 6; i++) this.dust(p.z, p.x, 'verge');
      return;
    }
    if (!kind) {
      if (side.drop && ax > EDGE + 0.3) { this.crash('In den Abgrund'); return; }
      if (ax > EDGE + 2.3) {
        const why: Record<string, string> = { meadow: 'In der Wiese gelandet', forest: 'Im Wald verschwunden', snow: 'Im Schnee stecken geblieben', field: 'Ab ins Feld', vines: 'In den Weinreben', sunflower: 'In den Sonnenblumen', rock: 'In den Felsen' };
        this.crash(why[side.ground] ?? 'Von der Straße abgekommen');
        return;
      }
      if (ax > EDGE) {
        this.offT += dt;
        p.wobble = Math.max(p.wobble, 0.3);
        if (this.offT > 0.35) { this.mistake(); this.curve.clean = false; }
      } else this.offT = 0;
    }
  }

  private touch(o: Obj, z0: number) {
    const p = this.p;
    if (o.done) return;
    // Kuh läuft los, wenn man kommt
    if (o.k === 'cow' && o.vx === 0 && o.z - p.z < 75 && o.z > p.z) {
      o.vx = o.x < 0 ? between(this.rng, 0.8, 1.3) : -between(this.rng, 0.8, 1.3);
    }
    if (!(o.z > z0 - 0.5 && o.z <= p.z + 0.5)) return;
    const crossed = o.z > z0 && o.z <= p.z;
    const dx = Math.abs(o.x - p.x);
    const hit = dx < o.r + 0.24;
    if (o.k === 'bidon' || o.k === 'gold') {
      if (dx < o.r + 0.35 && Math.abs(o.z - p.z) < 1.2) {
        o.done = true;
        if (o.k === 'gold') {
          this.award('bidons', 250, 'Goldene Flasche!', 'gold');
          this.confetti();
        } else {
          this.stats.bidons += 1;
          this.award('bidons', 20, '+Flasche', 'blue', undefined, false, true);
        }
      }
      return;
    }
    if (!crossed) return;
    o.done = true;
    if (hit) {
      if (p.air && o.k !== 'cow') { this.award('air', 40, 'Drübergesprungen!', 'accent'); return; }
      switch (o.k) {
        case 'pothole':
          if (p.v > 18.5) this.crash('Schlagloch erwischt');
          else { p.v *= 0.82; p.wobble = 1; this.shake = 0.7; this.mistake(); this.pop('Schlagloch!', 'red'); }
          return;
        case 'rock': this.crash('Steinschlag auf der Straße'); return;
        case 'cow': this.crash('Muuuh – Kuh erwischt'); return;
        case 'cone':
          p.v *= 0.9; p.wobble = 0.6; this.mistake(); this.pop('Hütchen!', 'red');
          this.parts.push({ kind: 'cone', z: o.z, x: o.x, h: 0.3, vz: p.v * 0.6, vx: (o.x - p.x) * 6 + (this.rng() - 0.5) * 3, vh: 4 + this.rng() * 2, life: 1.4, max: 1.4, size: 0.5, color: '#ff7a1a', rot: 0 });
          return;
        case 'puddle':
          p.slick = 0.75; p.wobble = Math.max(p.wobble, 0.35); this.pop('Rutschig!', 'blue');
          for (let i = 0; i < 12; i++) this.splash(p.z, p.x);
          return;
      }
    } else if (HAZARD.has(o.k) && dx < o.r + 0.24 + 0.6) {
      this.stats.near += 1;
      const labels: Record<string, string> = { rock: 'Haarscharf!', cow: 'Kuh-Slalom!', pothole: 'Knapp!', cone: 'Knapp!' };
      this.award('near', o.k === 'cow' ? 80 : 30, labels[o.k], 'accent');
    }
  }

  private oppContacts() {
    const p = this.p;
    for (const o of this.opps) {
      if (o.wreck) continue;
      const dz = o.z - p.z;
      const dx = o.x - p.x;
      // überholt?
      if (!o.passed && dz < -0.6) {
        o.passed = true;
        this.stats.overtakes += 1;
        const close = Math.abs(dx) < 1.05;
        // im Fahrerfeld überholt man oft: Hinweis nur ab und zu (Punkte immer)
        const quiet = !!this.opts.field && !close && this.time - this.overtakePop < 1.2;
        if (!quiet) this.overtakePop = this.time;
        this.award('overtake', close ? 80 : 45, close ? 'Knapp vorbei!' : 'Überholt', close ? 'accent' : 'white', undefined, false, quiet);
        if (close) this.stats.near += 1;
        this.overtakeTimes.push(this.time);
        this.overtakeTimes = this.overtakeTimes.filter((t) => this.time - t < 4);
        if (this.overtakeTimes.length === 3) this.award('overtake', 150, 'Ganze Gruppe!', 'gold');
      } else if (o.passed && dz > 1.5) o.passed = false;
      if (Math.abs(dz) > 1.8 || Math.abs(dx) > 0.52 || p.air) continue;
      if (dz > 0.9) {
        // von hinten aufs Hinterrad
        const closing = p.v - o.v;
        if (this.opts.pileups && !o.wreck && closing > 3.4 && this.phaseT > 2) { this.pileup(o, closing); return; }
        if (o.wreck) continue;
        if (closing > 8 && this.phaseT > 4) { this.crash('Auffahrunfall im Feld'); return; }
        p.v = Math.min(p.v, o.v - 0.4);
        p.z = Math.min(p.z, o.z - 1.75);
        p.wobble = Math.max(p.wobble, 0.5);
        o.bump = 0.6;
        if (this.time - this.lastBarrier > 1) this.pop('Hinterrad!', 'red');
        this.lastBarrier = this.time;
        this.mistake();
      } else if (Math.abs(dz) <= 0.9) {
        // Schulter an Schulter: Rempler
        const s = dx > 0 ? -1 : 1;
        p.vx = s * 2.4;
        o.vx = -s * 2.4;
        o.bump = 0.8;
        p.wobble = Math.max(p.wobble, 0.45);
        if (this.time - this.lastBarrier > 1) this.award('near', 20, 'Rempler!', 'accent');
        this.lastBarrier = this.time;
      }
    }
  }

  private curves(seg: Seg, _dt: number) {
    const p = this.p;
    const c = this.curve;
    const k = Math.abs(seg.curve);
    if (!c.active && k > 0.009) {
      Object.assign(c, { active: true, sign: Math.sign(seg.curve), hairpin: seg.hairpin > 0, minV: p.v, clean: true, maxK: k });
      if (seg.hairpin > 0 && this.opts.tutorial && !this.tipsShown.has('brake') && p.v > 12) {
        this.tipsShown.add('brake');
        this.opts.onEvent?.({ type: 'tip', text: 'Kehre! Daumen runter = bremsen' });
      }
    }
    if (c.active) {
      c.minV = Math.min(c.minV, p.v);
      c.maxK = Math.max(c.maxK, k);
      if (seg.hairpin > 0) c.hairpin = true;
      if (k < 0.004) {
        c.active = false;
        if (!c.clean) return;
        if (c.hairpin) {
          this.stats.hairpins += 1;
          this.award('curves', Math.round(60 + Math.max(0, c.minV * 3.6 - 30) * 2), 'Kehre gemeistert', 'accent');
        } else {
          const ratio = c.minV / Math.sqrt((p.grip * G) / c.maxK);
          if (ratio > 0.88) this.award('curves', 45, 'Am Limit!', 'accent');
          else if (c.maxK > 0.012) this.award('curves', 15, 'Saubere Kurve', 'white');
        }
      }
    }
  }

  private progress(seg: Seg, z0: number) {
    const p = this.p;
    if (seg.sec !== this.sectionIdx) {
      const first = this.sectionIdx < 0;
      this.sectionIdx = seg.sec;
      const s = this.track.sections[seg.sec];
      this.opts.onEvent?.({ type: 'section', name: s.name, biome: s.biome, alt: s.alt, first });
      if (!first) this.award('bonus', 100, 'Neues Tal', 'white');
    }
    if (seg.banner?.kind === 'sprint' && Math.floor(z0 / SEG) !== seg.i) {
      this.award('bonus', p.v > 16.7 ? 200 : 150, 'Zwischensprint!', 'gold');
      this.confetti();
    }
    for (const f of this.friends) {
      if (!f.passed && p.z >= f.meters) {
        f.passed = true;
        this.award('friends', 100, `${f.name} geschlagen!`, 'gold');
        this.confetti();
        this.opts.onEvent?.({ type: 'friend', name: f.name, color: f.color });
      }
    }
  }

  private checkMissions() {
    for (const m of this.opts.missions) {
      if (this.missionsDone.has(m.id)) continue;
      if (this.stats[m.stat] >= m.target) {
        this.missionsDone.add(m.id);
        this.award('missions', 300, 'Aufgabe erfüllt!', 'gold', m.text, true);
        this.confetti();
        this.opts.onEvent?.({ type: 'mission', id: m.id, text: m.text });
      }
    }
  }

  // ------------------------------------------------------------ Gegner

  private spawnStartGroup() {
    if (this.opts.field) { this.spawnField(this.opts.field); return; }
    const r = this.rng;
    for (let i = 0; i < 3; i++) {
      const kit = this.kit(r);
      this.opps.push({
        id: this.oppId++, z: 14 + i * 7 + r() * 3, x: (i % 2 ? -1.1 : 1.2), vx: 0, v: 0, tx: i % 2 ? -1.1 : 1.2,
        f: between(r, 0.62, 0.72), kit, pedal: r() * 6, lean: 0, tuck: 0, brake: 0, passed: false, group: -1, bump: 0, attacker: false,
      });
    }
  }

  private kit(r: Rng): Kit {
    const k = pick(r, TEAM_KITS);
    return { ...k, skin: pick(r, SKINS), number: String(Math.floor(between(r, 11, 199))) };
  }

  /** Start im Feld: eine kleine Gruppe um dich herum (ein paar vor, ein paar neben dir) */
  private spawnField(n: number) {
    void n;
    const r = this.rng;
    const spots: [number, number][] = [[10, -1.2], [10.4, 1.3], [12.6, 0], [15, -0.9], [15.3, 1.0], [6.4, -1.5], [3.2, 0.4], [3.6, 1.6]];
    for (const [z, x] of spots) {
      this.opps.push({
        id: this.oppId++, z: z + r() * 0.5, x, vx: 0, v: 0, tx: x, f: between(r, 0.74, 0.98), kit: this.kit(r), pedal: r() * 6,
        lean: 0, tuck: 0, brake: 0, passed: z < 6, group: -2, bump: 0, attacker: false,
      });
    }
    this.nextSpawn = 60;
  }

  /**
   * Fahrerfeld unterwegs: laufend neue Gruppen vor dir (Gruppetto, Verfolger, Ausreißer – meist langsamer, man
   * fährt auf sie auf und muss durch), so dass immer mehrere Gruppen im Bild sind; ab und zu Schnelle von hinten.
   * n: so viele Fahrer höchstens voraus (bis 700 m)
   */
  private spawnMass(n: number) {
    const p = this.p;
    if (p.z < this.nextSpawn) return;
    const r = this.rng;
    this.nextSpawn = p.z + between(r, 35, 70);
    this.opps = this.opps.filter((o) => o.z > p.z - 160 && o.z < p.z + 1100);
    const ahead = this.opps.filter((o) => o.z > p.z && o.z < p.z + 700).length;
    if (ahead < n) {
      // im Bild, aber noch nicht nah: 230–420 m voraus
      const z0 = p.z + between(r, 170, 380);
      const m = Math.round(between(r, 3, 12));
      const group = this.oppId;
      // meist langsamer als du (aufholen, durchfahren), manchmal fast gleich schnell
      const f = chance(r, 0.7) ? between(r, 0.6, 0.78) : between(r, 0.8, 0.9);
      const abreast = chance(r, 0.4);
      for (let i = 0; i < m; i++) {
        const z = z0 - i * (abreast ? between(r, 0.9, 1.6) : between(r, 1.8, 3.0));
        const half = ROAD_HALF + this.track.extraAt(z) - 0.5;
        const x = clamp(abreast ? (i % 2 ? -0.8 : 0.8) + (r() - 0.5) * 0.6 : (r() - 0.5) * 2 * half, -half, half);
        this.opps.push({
          id: this.oppId++, z, x, vx: 0, v: p.v * 0.75, tx: x, f: f * between(r, 0.97, 1.03), kit: this.kit(r), pedal: r() * 6,
          lean: 0, tuck: 1, brake: 0, passed: false, group, bump: 0, attacker: false,
        });
      }
    }
    // Schnelle von hinten (selten): an dir vorbei
    if (chance(r, 0.18) && this.opps.filter((o) => o.attacker).length < 3) {
      const lane = chance(r, 0.5) ? -1 : 1;
      this.opps.push({
        id: this.oppId++, z: p.z - 45, x: lane * 1.4, vx: 0, v: p.v + 2, tx: lane * 1.4, f: between(r, 1.06, 1.12), kit: this.kit(r),
        pedal: 0, lean: 0, tuck: 0.6, brake: 0, passed: true, group: this.oppId, bump: 0, attacker: true,
      });
    }
  }

  private spawn(D: number) {
    if (this.opts.field) { this.spawnMass(this.opts.field); return; }
    const p = this.p;
    if (p.z < this.nextSpawn) return;
    const r = this.rng;
    this.nextSpawn = p.z + between(r, 110, 210) * (1 - 0.3 * D);
    const kind = r();
    const group = this.oppId;
    const zBase = p.z + between(r, 170, 230);
    const lane = chance(r, 0.5) ? -1 : 1;
    // langsames Gruppetto oder zähe Gruppe, an die man sich ranarbeiten muss
    const f = chance(r, 0.55) ? between(r, 0.58, 0.7) : between(r, 0.72, 0.84);
    const add = (dz: number, x: number, ff: number, attacker = false) => {
      this.opps.push({
        id: this.oppId++, z: zBase + dz, x, vx: 0, v: p.v * 0.85, tx: x, f: ff, kit: this.kit(r), pedal: r() * 6,
        lean: 0, tuck: 1, brake: 0, passed: false, group, bump: 0, attacker,
      });
    };
    if (kind < 0.36) add(0, lane * between(r, 0.5, 1.6), f);
    else if (kind < 0.58) { add(0, lane * 1.1, f); add(-2.3, lane * 1.1 + 0.15, f); }
    else if (kind < 0.88) {
      const n = Math.round(between(r, 3, 6));
      const abreast = chance(r, 0.35);
      for (let i = 0; i < n; i++) add(-i * (abreast ? 1.2 : 2.3), abreast ? (i % 2 ? -0.7 : 0.7) : lane * 1.05 + (r() - 0.5) * 0.2, f);
    } else {
      // Angreifer von hinten
      this.opps.push({
        id: this.oppId++, z: p.z - 26, x: -lane * 1.2, vx: 0, v: p.v + 2, tx: -lane * 1.2, f: between(r, 1.08, 1.14), kit: this.kit(r),
        pedal: 0, lean: 0, tuck: 0.6, brake: 0, passed: true, group, bump: 0, attacker: true,
      });
    }
    // Abgehängte weg
    this.opps = this.opps.filter((o) => o.z > p.z - 60 && o.z < p.z + 520);
  }

  private subN = 0;
  private stepOpps(dt0: number) {
    const live = this.phase === 'playing' || this.phase === 'crash';
    // nach Lage sortiert (fast schon sortiert: Einfügen kostet kaum etwas) – Nachbarn sind dann die nächsten im Feld
    const os = this.opps;
    for (let i = 1; i < os.length; i++) {
      const a = os[i];
      let j = i - 1;
      while (j >= 0 && os[j].z > a.z) { os[j + 1] = os[j]; j--; }
      os[j + 1] = a;
    }
    this.subN++;
    const pz = this.p.z;
    for (let oi = 0; oi < os.length; oi++) {
      const o = os[oi];
      // weit weg (Feld voraus, Abgehängte): nur jeden dritten Schritt rechnen (dann dreifach), dazwischen rollen
      let dt = dt0;
      if (live && !o.wreck && Math.abs(o.z - pz) > 240) {
        if ((this.subN + o.id) % 3 !== 0) { o.z += o.v * dt0; pedalStep(o, o.cad ?? 0, dt0); continue; }
        dt = dt0 * 3;
        o.z -= o.v * dt0 * 2;
      }
      const seg = this.track.segAt(o.z);
      if (o.wreck) {
        const w = o.wreck;
        w.t += dt;
        const tr = wreckTravel(w);
        o.z = w.z0 + tr.s;
        o.v = tr.v;
        o.vx = 0;
        continue;
      }
      if (!live) {
        o.pedal += dt * 0.3;
        continue;
      }
      // halbe Fahrbahnbreite hier (Straße mal breiter, mal enger)
      const half = ROAD_HALF + this.track.extraAt(o.z);
      // Wunschtempo: Gefälle, Kurven voraus
      const aG = -G * seg.grade;
      const vEq = Math.sqrt(Math.max(0.6, aG - RR) / (CD * 1.12)) * o.f;
      let vC = 40;
      for (let d = 0; d <= 36; d += 4) {
        const s = this.track.segAt(o.z + d);
        const k = Math.abs(s.curve);
        if (k > 0.002) vC = Math.min(vC, Math.sqrt((0.82 * G) / k) + d * 0.18);
      }
      let target = Math.min(vEq, vC, VMAX - 2);
      // Vordermann: langsamer und in der Spur → überholen, wo Platz ist; geht das (noch) nicht, dahinter bleiben
      let pass: number | null = null;
      for (let qi = oi + 1; qi < os.length; qi++) {
        const q = os[qi];
        const dz = q.z - o.z;
        if (dz > 10) break;
        if (q.wreck) continue;
        const dx = q.x - o.x;
        if (dz <= 0 || Math.abs(dx) > 0.85) continue;
        if (o.v > q.v + 0.2 || dz < 3) {
          const left = q.x - 0.95, right = q.x + 0.95;
          const okL = left > -half + 0.45, okR = right < half - 0.45;
          // die Seite, auf der er schon halb ist, sonst die freie
          const want = okL && okR ? (dx > 0 ? left : right) : okL ? left : okR ? right : null;
          if (want !== null && (pass === null || Math.abs(want - o.x) < Math.abs(pass - o.x))) pass = want;
        }
        // noch nicht seitlich vorbei: Abstand halten (≥ 1,9 m Rad an Rad)
        if (Math.abs(dx) < 0.7 && dz < 4) target = Math.min(target, q.v + Math.max(-2, (dz - 1.9) * 1.2));
      }
      // Sturz voraus: erst nach der Schrecksekunde bremsen (voll) und an der Seite vorbei, wo Platz ist
      let dodge: number | null = null;
      if (this.pileAt) {
        if (o.sees === undefined && this.pileAt.z - o.z < 60 && this.pileAt.z > o.z - 2) o.sees = this.time + 0.35 + this.rng() * 0.55;
        if (o.sees !== undefined && this.time >= o.sees) {
          let near = Infinity;
          let wx = 0;
          for (const w of this.wrecks()) { const d = w.z - o.z; if (d > -1 && d < near) { near = d; wx = w.x; } }
          if (near < 45) {
            target = 0;
            o.brake = 1;
            dodge = wx > 0 ? -half + 0.6 : half - 0.6;
          }
        }
      }
      const hardBrake = dodge !== null;
      const acc = clamp((target - o.v) * 0.9, hardBrake ? -7.5 : -6.5, o.v < 13 ? 2.6 : 1.6);
      // Bremshaltung weich (vorher ein Schalter: der Oberkörper sprang hoch und wieder runter)
      o.brake += ((acc < -1.5 ? 1 : 0) - o.brake) * Math.min(1, dt0 * 6);
      o.v = Math.max(0, o.v + acc * dt);
      o.z += o.v * dt;

      // Spur: Hindernissen und dem Spieler ausweichen
      let tx = o.tx;
      for (let d = 4; d < 28; d += SEG) {
        const s = this.track.segAt(o.z + d);
        if (s.objs) for (const ob of s.objs) {
          if (!ob.done && HAZARD.has(ob.k) && Math.abs(ob.x - tx) < 1.0) tx = ob.x > 0 ? ob.x - 1.4 : ob.x + 1.4;
        }
      }
      const p = this.p;
      if (Math.abs(p.z - o.z) < 2.4 && Math.abs(p.x - o.x) < 0.95) tx = o.x + (o.x > p.x ? 0.6 : -0.6);
      if (pass !== null) tx = pass;
      if (dodge !== null) tx = dodge;
      tx = clamp(tx, -half + 0.45, half - 0.45);
      o.vx += ((tx - o.x) * 3.2 - o.vx * 2.6) * dt;
      o.x = clamp(o.x + o.vx * dt, -half + 0.3, half - 0.3);
      const lean = Math.atan2(seg.curve * o.v * o.v, G) + o.vx * 0.06 + Math.sin(this.time * 14 + o.id) * o.bump * 0.15;
      o.lean += (clamp(lean, -0.7, 0.7) - o.lean) * Math.min(1, dt * 8);
      o.bump = Math.max(0, o.bump - dt);
      // treten: langsam, als Angreifer oder beim Beschleunigen – stufenlos statt An/Aus, dazu der Schwung der Kurbel
      const drive = Math.max(smooth(16.5, 12.5, o.v), o.attacker ? 1 : 0, smooth(0.3, 1.2, acc)) * (1 - o.brake);
      o.tuck += ((1 - 0.8 * drive) - o.tuck) * Math.min(1, dt0 * 2);
      pedalStep(o, drive * cadenceFor(o.v), dt0);
    }
    if (live) this.separateOpps();
    if (this.pileAt) this.wreckHits();
    // Kühe laufen
    if (live) {
      const i0 = Math.floor(this.p.z / SEG);
      for (let i = i0; i < i0 + 45; i++) {
        const s = this.track.seg(i);
        if (s.objs) for (const ob of s.objs) if (ob.k === 'cow' && ob.vx) {
          ob.x += ob.vx * dt0;
          if (Math.abs(ob.x) > EDGE + 2.5) ob.vx = 0;
        }
      }
    }
  }

  /**
   * Fahrer sind fest: zwei Räder belegen nie denselben Platz. Überlappen sie, schieben sie sich seitlich auseinander
   * (Schulter an Schulter), und wer hinten ist, bleibt hinter dem Hinterrad des anderen
   */
  private separateOpps() {
    const os = this.opps;
    for (let i = 0; i < os.length; i++) {
      const a = os[i];
      if (a.wreck) continue;
      for (let j = i + 1; j < os.length; j++) {
        const b = os[j];
        // sortiert (stepOpps): weiter vorn kommt keiner mehr in Reichweite
        if (b.z - a.z >= 1.85) break;
        if (b.wreck) continue;
        const dz = b.z - a.z, dx = b.x - a.x;
        const az = Math.abs(dz), ax = Math.abs(dx);
        if (az >= 1.85 || ax >= 0.62) continue;
        const front = dz >= 0 ? b : a, back = dz >= 0 ? a : b;
        // seitlich nebeneinander (mehr als halb vorbei) → auseinanderdrücken; sonst der Hintere zurück
        if (az < 1.1 || ax > 0.35) {
          const sd = dx === 0 ? (a.id < b.id ? 1 : -1) : Math.sign(dx);
          const push = (0.62 - ax) / 2;
          const half = ROAD_HALF + this.track.extraAt(a.z);
          a.x = clamp(a.x - sd * push, -half + 0.3, half - 0.3);
          b.x = clamp(b.x + sd * push, -half + 0.3, half - 0.3);
          a.vx -= sd * 0.3; b.vx += sd * 0.3;
          if (az < 1.1 && Math.abs(b.x - a.x) < 0.5) { back.z = front.z - 1.1; back.v = Math.min(back.v, front.v); }
        } else {
          back.z = front.z - 1.85;
          back.v = Math.min(back.v, front.v);
        }
      }
    }
  }

  // ------------------------------------------------------------ Punkte und Effekte

  private bumpChain() {
    this.chain += 1;
    this.mult = Math.min(9, 1 + Math.floor(this.chain / 4));
    this.multT = 3.5;
    this.stats.combo = Math.max(this.stats.combo, this.mult);
  }

  private mistake() {
    if (this.mult >= 2) this.pop(`Kombo ×${this.mult} weg`, 'muted');
    this.chain = 0;
    this.mult = 1;
    this.multT = 0;
  }

  award(cat: ScoreCat, base: number, label: string, tone: Popup['tone'], sub?: string, big = false, quiet = false) {
    const m = cat === 'missions' || cat === 'friends' || cat === 'bonus' ? 1 : this.mult;
    const pts = Math.round(base * m);
    this.score[cat] += pts;
    if (cat !== 'missions' && cat !== 'friends' && cat !== 'bonus') this.bumpChain();
    this.pop(quiet ? '' : label, tone, sub, big, quiet, `+${pts}`);
  }

  private popSide: -1 | 1 = 1;

  /** Hinweis links oder rechts neben dem Fahrer; abwechselnd, ohne sich zu überdecken */
  pop(text: string, tone: Popup['tone'], sub?: string, big = false, small = false, pts?: string) {
    if (this.popups.length > 5) this.popups.shift();
    const n = (sd: number) => this.popups.filter((p) => p.side === sd).length;
    let side: -1 | 1;
    if (n(-1) === n(1)) { this.popSide = this.popSide === 1 ? -1 : 1; side = this.popSide; } else side = n(-1) < n(1) ? -1 : 1;
    const used = new Set(this.popups.filter((p) => p.side === side).map((p) => p.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const j = (k: number) => { const x = Math.sin((this.time + k) * 91.7 + this.popups.length * 12.9) * 43758.5; return x - Math.floor(x); };
    this.popups.push({ text, sub, tone, pts, side, slot, age: 0, life: big ? 2.2 : small ? 1 : 1.5, dx: j(1), dy: j(2), big });
  }

  private dust(z: number, x: number, ground: string) {
    const col = ground === 'snow' ? '#f4f7fb' : ground === 'meadow' || ground === 'forest' || ground === 'vines' || ground === 'sunflower' ? '#7a9a4a' : ground === 'gravel' ? '#cdb58a' : '#b3a58a';
    this.parts.push({
      kind: ground === 'snow' ? 'snow' : ground === 'gravel' ? 'gravel' : 'dust', z: z - 0.4, x, h: 0.05,
      vz: this.p.v * between(this.rng, 0.4, 0.75), vx: (this.rng() - 0.5) * 2, vh: between(this.rng, 0.4, 1.6),
      life: 0.7, max: 0.7, size: between(this.rng, 0.12, 0.3), color: col, rot: 0,
    });
  }

  private spark(z: number, x: number) {
    this.parts.push({ kind: 'spark', z, x, h: 0.5, vz: this.p.v * 0.6, vx: (this.rng() - 0.5) * 6, vh: between(this.rng, 1, 4), life: 0.4, max: 0.4, size: 0.05, color: '#ffd36b', rot: 0 });
  }

  private splash(z: number, x: number) {
    this.parts.push({ kind: 'splash', z, x: x + (this.rng() - 0.5) * 0.5, h: 0.05, vz: this.p.v * 0.7, vx: (this.rng() - 0.5) * 4, vh: between(this.rng, 1, 3), life: 0.6, max: 0.6, size: 0.06, color: '#d8ecff', rot: 0 });
  }

  private confetti() {
    const cols = ['#ff5fa2', '#ffd23f', '#3d8bfd', '#3ddc84', '#ffffff', '#ff7a1a'];
    for (let i = 0; i < 26; i++) {
      this.parts.push({
        kind: 'confetti', z: this.p.z + 3 + this.rng() * 4, x: this.p.x + (this.rng() - 0.5) * 3, h: 1.6 + this.rng(),
        vz: this.p.v * 0.95, vx: (this.rng() - 0.5) * 3, vh: between(this.rng, 1, 3.5), life: 1.4, max: 1.4, size: 0.07,
        color: cols[i % cols.length], rot: this.rng() * 6,
      });
    }
  }

  private stepFx(dt: number, dtReal: number) {
    for (const q of this.parts) {
      q.life -= dt;
      q.z += q.vz * dt;
      q.x += q.vx * dt;
      q.h += q.vh * dt;
      if (q.kind === 'confetti') { q.vh -= 2.5 * dt; q.vx *= 0.98; q.rot += dt * 8; }
      else if (q.kind === 'cone') { q.vh -= G * dt; q.rot += dt * 9; if (q.h < 0.2) { q.h = 0.2; q.vh *= -0.4; q.vz *= 0.6; } }
      else if (q.kind === 'spark' || q.kind === 'splash' || q.kind === 'gravel') q.vh -= G * dt;
      else { q.vh *= 0.96; q.vz *= 0.97; }
    }
    this.parts = this.parts.filter((q) => q.life > 0);
    if (this.parts.length > 260) this.parts.splice(0, this.parts.length - 260);
    for (const pp of this.popups) pp.age += dtReal;
    this.popups = this.popups.filter((pp) => pp.age < pp.life);
  }

  // ------------------------------------------------------------ Sturz und Ende

  crash(reason: string) {
    if (this.phase !== 'playing') return;
    // Testfahrt: kein Sturz – zurück auf die Straße
    if (this.opts.cruise) {
      const ew = EDGE + this.track.extraAt(this.p.z);
      this.p.x = clamp(this.p.x, -ew + 0.6, ew - 0.6);
      this.tx = clamp(this.tx, -ew + 0.6, ew - 0.6);
      this.p.vx = 0;
      return;
    }
    this.phase = 'crash';
    this.phaseT = 0;
    this.crashReason = reason;
    this.crashSpin = 0;
    this.shake = 1;
    for (let i = 0; i < 18; i++) this.dust(this.p.z, this.p.x + (this.rng() - 0.5), 'verge');
    try { navigator.vibrate?.(140); } catch { /* egal */ }
  }

  // ------------------------------------------------------------ Massensturz (WebGPU-Abfahrt)

  /** zu schnell aufs Hinterrad: du und der Vordermann geht zu Boden – der Anfang eines Massensturzes */
  private pileup(o: Opp, closing: number) {
    // Testfahrt: kein Sturz (sonst bliebe der Sturz ohne Sturzphase stehen)
    if (this.opts.cruise) return;
    const p = this.p;
    const side = o.x >= p.x ? -1 : 1;
    this.pileAt = { z: o.z, x: (o.x + p.x) / 2 };
    this.wreckOpp(o, o.v + closing * 0.35, -side);
    this.wreck = { t: 0, v0: p.v, side, seed: this.rng() * 100, z0: p.z, x0: p.x };
    this.pileCount += 1;
    this.crash('Massensturz – zu schnell aufs Hinterrad');
  }

  private wreckOpp(o: Opp, v: number, side: number) {
    o.wreck = { t: 0, v0: v, side, seed: o.id * 1.37 + this.rng(), z0: o.z, x0: o.x };
    o.brake = 0;
    o.bump = 0;
    this.pileCount += 1;
    if (!this.pileAt) this.pileAt = { z: o.z, x: o.x };
    if (this.pileCount >= 3 && this.phase === 'crash') this.pop(`Massensturz! ${this.pileCount} Fahrer`, 'red', undefined, true);
    for (let i = 0; i < 6; i++) this.dust(o.z, o.x + (this.rng() - 0.5), 'verge');
    this.shake = Math.max(this.shake, 0.5);
  }

  /** wer gerade am Boden liegt: Ort des Körpers und wie weit das Rad dahinter liegt */
  private wrecks(): { z: number; x: number; back: number }[] {
    const out: { z: number; x: number; back: number }[] = [];
    const add = (w: Wreck, z: number) => { const back = Math.min(3, Math.max(0.8, wreckTravel(w).s * 0.3)); out.push({ z, x: w.x0, back }); };
    if (this.wreck) add(this.wreck, this.p.z);
    for (const o of this.opps) if (o.wreck) add(o.wreck, o.z);
    return out;
  }

  /** wer in Körper oder Rad am Boden fährt, stürzt drüber (Vorderrad zwischen Rad und Körper, seitlich überlappend) */
  private wreckHits() {
    const ws = this.wrecks();
    if (!ws.length) return;
    const hits = (z: number, x: number) => {
      const front = z + 0.9;
      for (const w of ws) if (front > w.z - w.back - 0.9 && front < w.z + 0.35 && Math.abs(x - w.x) < 0.78) return w;
      return null;
    };
    for (const o of this.opps) {
      if (o.wreck || o.v < 1.5) continue;
      const w = hits(o.z, o.x);
      if (w) this.wreckOpp(o, o.v, o.x >= w.x ? 1 : -1);
    }
    const p = this.p;
    if (this.phase === 'playing' && !this.wreck) {
      const w = hits(p.z, p.x);
      if (w) {
        this.wreck = { t: 0, v0: p.v, side: p.x >= w.x ? 1 : -1, seed: this.rng() * 100, z0: p.z, x0: p.x };
        this.pileCount += 1;
        this.crash('In den Massensturz gefahren');
      }
    }
  }

  /** eigene Spur mitschreiben, Geister nachfahren lassen, Namensschild für den nächsten voraus */
  private stepGhosts(dt: number) {
    const p = this.p;
    if (this.phase === 'playing') this.rec.step(dt, p.z, p.x, p.v, this.wantTuck ? 1 : this.wantBrake > 0.3 ? 2 : 0);
    const live = this.phase === 'playing' || this.phase === 'crash' || this.phase === 'over';
    if (live) this.ghostT += dt;
    if (!this.pack.count) return;
    this.pack.step(this.ghostT, live, dt);
    const tag = this.phase === 'playing' ? this.pack.tag(this.ghostT, p.z) : null;
    this.tags = tag ? [tag] : [];
  }

  private stepCrash(dt: number) {
    const p = this.p;
    if (this.wreck) {
      const w = this.wreck;
      w.t += dt;
      const tr = wreckTravel(w);
      p.z = w.z0 + tr.s;
      p.v = tr.v;
      p.vx = 0;
      p.y = this.track.heightAt(p.z);
      this.wreckHits();
      return;
    }
    p.v = Math.max(0, p.v - 14 * dt);
    p.z += p.v * dt;
    p.x += p.vx * dt * 0.5;
    // Überschlag, der ausläuft und seitlich liegen bleibt
    const rate = (6 + p.v * 0.25) * Math.max(0, 1 - this.phaseT / 1.1);
    this.crashSpin += dt * rate;
    if (rate === 0) this.crashSpin += (Math.round(this.crashSpin / Math.PI) * Math.PI + Math.PI / 2 - this.crashSpin) * Math.min(1, dt * 4);
    p.y = this.track.heightAt(p.z);
  }

  private finish() {
    if (this.phase === 'over') return;
    this.phase = 'over';
    const done = this.opts.missions.filter((m) => this.missionsDone.has(m.id) && !this.opts.missionsDone.has(m.id)).map((m) => m.id);
    this.opts.onOver?.({
      score: this.total,
      meters: Math.floor(this.p.z),
      topKmh: Math.round(this.stats.topKmh),
      reason: this.crashReason,
      parts: { ...this.score, dist: Math.round(this.score.dist), draft: Math.round(this.score.draft) },
      stats: { ...this.stats },
      missionsDone: done,
      friendsBeaten: this.friends.filter((f) => f.passed).map((f) => f.name),
      sectionName: this.track.sections[Math.max(0, this.sectionIdx)]?.name ?? '',
      trace: this.rec.trace.slice(),
    });
  }
}

export function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}
