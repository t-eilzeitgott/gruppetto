/**
 * Spiellogik „Abfahrt“: Fahrphysik (Gefälle, Luftwiderstand, Windschatten, Fliehkraft, Grip,
 * Sprünge), Gegner, Hindernisse, Punkte mit Kombo-Multiplikator und Tagesaufgaben.
 * Ohne DOM – der Renderer liest den Zustand, die Seite bekommt Ereignisse.
 */
import { mulberry32, between, chance, pick, type Rng } from './rng';
import { EDGE, ROAD_HALF, SEG, Track, difficulty, type Obj, type Seg, type Side, type BiomeId } from './track';
import { SKINS, TEAM_KITS, type Kit } from './rider';
import type { Mission, MissionStat } from './missions';

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
}

export interface Opp {
  id: number; z: number; x: number; vx: number; v: number;
  tx: number; f: number; kit: Kit; pedal: number; lean: number; tuck: number; brake: number;
  passed: boolean; group: number; bump: number; attacker: boolean;
  /** Wiegetritt 0–1 */
  stand?: number;
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

/** Was die 3D-Darstellung von einem Rennen braucht (Abfahrt und Sprintfinale) */
export interface RaceView {
  track: Track;
  phase: Phase;
  phaseT: number;
  p: Player;
  opps: Opp[];
  popups: Popup[];
  parts: Particle[];
  friends: Friend[];
  shake: number;
  crashSpin: number;
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
  parts: Particle[] = [];
  popups: Popup[] = [];
  friends: Friend[];
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
    this.rng = mulberry32(this.track.seed ^ 0x5eed);
    this.reset();
  }

  reset() {
    this.track = new Track(this.opts.dayKey, this.opts.names);
    this.rng = mulberry32(this.track.seed ^ 0x5eed);
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
    const nx = clamp(this.steer.tx0 + (x - this.steer.sx) * k, -EDGE - 1.2, EDGE + 1.2);
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

  update(dtReal: number) {
    const dt = Math.min(0.05, dtReal) * this.timeScale;
    this.time += dt;
    this.phaseT += dtReal;
    if (this.keys.left) { this.tx = clamp(this.tx - 6 * dt, -EDGE - 1.2, EDGE + 1.2); this.steered += 6 * dt; }
    if (this.keys.right) { this.tx = clamp(this.tx + 6 * dt, -EDGE - 1.2, EDGE + 1.2); this.steered += 6 * dt; }

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

    if (this.phase === 'crash') {
      this.timeScale = this.phaseT < 0.9 ? 0.35 : Math.min(1, this.timeScale + dtReal * 2);
      if (this.phaseT > 1.8) this.finish();
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
    const ax = Math.abs(p.x);
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
    if (p.v < 13.5 || p.tuck < 0.5) p.pedal += (p.v / 2.1 + 2) * dt;
    else p.pedal += (0 - Math.sin(p.pedal) * 2) * dt;  // Kurbel waagrecht in der Abfahrt
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
    const ax = Math.abs(p.x);
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
      p.x = sign * limit;
      p.vx = -p.vx * 0.3 - sign * 1.1;
      this.tx = clamp(this.tx, -limit + 0.4, limit - 0.4);
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
      const dz = o.z - p.z;
      const dx = o.x - p.x;
      // überholt?
      if (!o.passed && dz < -0.6) {
        o.passed = true;
        this.stats.overtakes += 1;
        const close = Math.abs(dx) < 1.05;
        this.award('overtake', close ? 80 : 45, close ? 'Knapp vorbei!' : 'Überholt', close ? 'accent' : 'white');
        if (close) this.stats.near += 1;
        this.overtakeTimes.push(this.time);
        this.overtakeTimes = this.overtakeTimes.filter((t) => this.time - t < 4);
        if (this.overtakeTimes.length === 3) this.award('overtake', 150, 'Ganze Gruppe!', 'gold');
      } else if (o.passed && dz > 1.5) o.passed = false;
      if (Math.abs(dz) > 1.8 || Math.abs(dx) > 0.52 || p.air) continue;
      if (dz > 0.9) {
        // von hinten aufs Hinterrad
        const closing = p.v - o.v;
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

  private spawn(D: number) {
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

  private stepOpps(dt: number) {
    const live = this.phase === 'playing' || this.phase === 'crash';
    for (const o of this.opps) {
      const seg = this.track.segAt(o.z);
      if (!live) {
        o.pedal += dt * 0.3;
        continue;
      }
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
      // nicht auf den Vordermann auffahren
      for (const q of this.opps) {
        if (q === o) continue;
        const dz = q.z - o.z;
        if (dz > 0 && dz < 2.6 && Math.abs(q.x - o.x) < 0.7) target = Math.min(target, q.v);
      }
      const acc = clamp((target - o.v) * 0.9, -6.5, o.v < 13 ? 2.6 : 1.6);
      o.brake = acc < -1.5 ? 1 : 0;
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
      tx = clamp(tx, -ROAD_HALF + 0.45, ROAD_HALF - 0.45);
      o.vx += ((tx - o.x) * 3.2 - o.vx * 2.6) * dt;
      o.x = clamp(o.x + o.vx * dt, -ROAD_HALF + 0.3, ROAD_HALF - 0.3);
      const lean = Math.atan2(seg.curve * o.v * o.v, G) + o.vx * 0.06 + Math.sin(this.time * 14 + o.id) * o.bump * 0.15;
      o.lean += (clamp(lean, -0.7, 0.7) - o.lean) * Math.min(1, dt * 8);
      o.bump = Math.max(0, o.bump - dt);
      const pedalling = o.v < 13.5 || o.attacker || acc > 0.8;
      o.tuck += ((pedalling ? 0.2 : 1) - o.tuck) * Math.min(1, dt * 2);
      if (pedalling) o.pedal += (o.v / 2.1 + 2) * dt;
      else o.pedal -= Math.sin(o.pedal) * 2 * dt;
    }
    // Kühe laufen
    if (live) {
      const i0 = Math.floor(this.p.z / SEG);
      for (let i = i0; i < i0 + 45; i++) {
        const s = this.track.seg(i);
        if (s.objs) for (const ob of s.objs) if (ob.k === 'cow' && ob.vx) {
          ob.x += ob.vx * dt;
          if (Math.abs(ob.x) > EDGE + 2.5) ob.vx = 0;
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
    this.phase = 'crash';
    this.phaseT = 0;
    this.crashReason = reason;
    this.crashSpin = 0;
    this.shake = 1;
    for (let i = 0; i < 18; i++) this.dust(this.p.z, this.p.x + (this.rng() - 0.5), 'verge');
    try { navigator.vibrate?.(140); } catch { /* egal */ }
  }

  private stepCrash(dt: number) {
    const p = this.p;
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
    });
  }
}

export function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}
