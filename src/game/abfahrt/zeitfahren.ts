/**
 * Zeitfahren: 3 km allein gegen die Uhr – von der Startrampe im Startort durchs wellige Tal, über eine Côte,
 * die Abfahrt hinunter und über die Zielgerade. Mit auf der Strecke: die Geister der Runde – die beste Fahrt des
 * Tages je Mitglied als halbdurchsichtiger Fahrer auf seinem Rad, dazu der eigene Bestlauf. Sie fahren exakt
 * nach, was gefahren wurde; überholen, dranbleiben und abhängen zählt wie in der Übertragung mit Zeitabständen
 * an jeder Stelle der Strecke („virtueller Abstand“) und an den Zwischenzeit-Stationen.
 *
 * Fahrphysik je Kilogramm wie im Bergfinale: eine Dauerleistung (W/kg) und ein Kraftvorrat für alles darüber.
 * Daumen neutral = Zeitfahrhaltung auf dem Auflieger an der Dauerleistung (bergab: Bremshilfe vor Kurven).
 * Daumen hoch = Druck machen (über der Dauerleistung, leert den Vorrat; bergauf im Wiegetritt) – bergab stattdessen
 * ducken ohne Bremshilfe. Daumen runter = erholen (unter der Dauerleistung, füllt den Vorrat; bergab bremsen).
 * Die Linie zählt: innen durch die Kurve ist der Weg kürzer, zu schnell in die Kurve rutscht man nach außen.
 * Alle fahren dieselbe Physik – kein Fahrertyp, kein Bonus: nur die Uhr. Zeitraffer 1,45 (bergab 1,15):
 * Tempo und Zeiten bleiben echt, ein Lauf dauert knapp drei Minuten.
 */
import { ROAD_HALF, SEG, TT_FINISH, TT_SPLITS, TT_TOP, Track } from './track';
import { clamp, type Friend, type Opp, type Particle, type Phase, type Player, type Popup, type RiderTag, type Standing } from './engine';
import { between, hashStr, mulberry32, type Rng } from './rng';
import { SKINS, type Kit } from './rider';
import { pedalStep } from './motion';
import type { StageRef } from './stageRef';
import { TRACE_DT, firstName, ghostAt, ghostName, ghostTimeAt, type GhostRider } from '../tt';

export interface TtOptions {
  dayKey: string;
  names: string[];
  /** eigener Name (für Podium und Schilder) */
  rider: string;
  kit: Kit;
  /** echte Vorlage (Zeitfahr-Etappe) – nur für Namen, Sprache und Gegend; die Straße hängt nur vom Tag ab */
  town?: StageRef | null;
  ghosts: GhostRider[];
  /** eigene Bestzeit des Tages (ms), falls schon gefahren */
  myBest: number | null;
  /** Tempomacher-Simulation: Stärke (Dauerleistung ×) und Linienwahl (0 … 1), eigener Zufall */
  bot?: { strength: number; line: number; seed: number };
  onEvent?: (e: TtEvent) => void;
  onOver?: (r: TtResult) => void;
}

export type TtEvent =
  | { type: 'count'; n: number }
  | { type: 'banner'; title: string; sub?: string; tone?: 'gold' | 'accent' | 'red' }
  | { type: 'split'; index: number; timeMs: number; gapMs: number | null; place: number; riders: number; bestName: string | null };

export interface TtSector {
  /** eigene Zeit im Sektor (ms) */
  me: number;
  /** schnellster Geist in diesem Sektor (ms) und sein Name */
  best: number | null;
  bestName: string | null;
  /** Zeit des Tagesbesten in diesem Sektor (ms) */
  leader: number | null;
}

export interface TtResult {
  timeMs: number;
  splits: number[];
  /** Platz unter allen Geistern des Tages (nach Endzeit) */
  place: number;
  riders: number;
  /** Abstand zur besten Geisterzeit (ms, negativ = schneller als alle) */
  gapMs: number | null;
  leader: { name: string; timeMs: number } | null;
  /** schneller als der eigene Bestlauf (oder erster Lauf) */
  pb: boolean;
  dayBest: boolean;
  avgKmh: number;
  topKmh: number;
  slides: number;
  /** Kraftvorrat im Ziel (0 … 1) – was noch drin gewesen wäre */
  reserve: number;
  sectors: TtSector[];
  /** aufgezeichnete Fahrspur (für den eigenen Geist) */
  trace: number[];
  podium: { name: string; me: boolean; timeMs: number }[];
  /** Geister, die man unterwegs überholt hat (Namen) */
  passed: string[];
}

export interface TtHud {
  /** Rennzeit (s) */
  time: number;
  toGo: number;
  kmh: number;
  energy: number;
  grade: number;
  mode: 'sit' | 'go' | 'ease';
  touch: { x: number; y: number } | null;
  /** virtueller Platz an dieser Stelle (Zeit aller Geister an dieser Stelle) */
  place: number;
  riders: number;
  /** TV-Tafel: Spitze, Zweiter, du – virtuell an dieser Stelle */
  board: Standing[];
  /** in der Abfahrt */
  down: boolean;
  /** Geister für die Streckenleiste: Streckenmeter und Farbe */
  ghosts: { id: string; z: number; color: string }[];
  /** Abstand zur Tagesbestzeit an dieser Stelle (s, + = dahinter), null ohne Geister */
  gapBest: number | null;
  bestName: string | null;
}

/** Geist auf der Strecke: ein Gegner ohne Physik, der seiner Spur folgt */
interface GhostOpp extends Opp {
  ghost: number;
  rider: GhostRider;
  /** Haltung aus der Spur (0 sitzen, 1 drücken, 2 erholen) */
  m: number;
  /** eigener Rang (Startnummer): 1 = Tagesbestzeit */
  rank: number;
  passedBy: boolean;
  passedMe: boolean;
}

const G = 9.81;
const CRR = 0.004;
const CDA = 0.0028;      // Luftwiderstand je kg in Sitzhaltung (Leistung = CDA · v³)
const CP = 6.1;          // Dauerleistung (W/kg)
const KICK = 3.2;        // darüber beim Drücken (W/kg)
const WJ = 190;          // Kraftvorrat (J/kg)
const SUB = 1 / 60;
const WARP = 1.45;       // Zeitraffer; in der Abfahrt
const WARP_DOWN = 1.15;
const GRIP_G = 0.72;     // Haftgrenze in Kurven (g)
const ASSIST_G = 0.66;   // bis hierhin bremst die Hilfe vor Kurven
const XMAX = ROAD_HALF - 0.45;
/** Deckkraft der Geister */
const GHOST_ALPHA = 0.46;
/** Haltung: Auflieger, Druck auf dem Auflieger, Wiegetritt, bergab auf dem Oberlenker, geduckt, bremsend */
const AERO = 0.76;
const PUSH = 0.82;
const STAND = 1.08;
const HOODS = 0.9;
const TUCK = 0.5;
const BRAKING = 1.1;

/** Fahrwiderstand je kg (N/kg) */
const resist = (v: number, grade: number, aero: number) => G * (grade + CRR) + aero * v * v;
/** Leistung, um von v auf vd zu kommen (W/kg) */
const powerTo = (vd: number, v: number, grade: number, aero: number) =>
  Math.max(1, vd) * resist(Math.max(1, vd), grade, aero) + (vd - v) * 2.4 * Math.max(v, 2.5);

/** Abschnitt einer Strecke (Streckenmeter): Startort, Tal, Côte, Abfahrt, Zielort */
export function ttSectionAt(z: number): 'start' | 'valley' | 'climb' | 'descent' | 'finish' {
  if (z < 240) return 'start';
  if (z < 1040) return 'valley';
  if (z < TT_TOP) return 'climb';
  if (z < 2000) return 'descent';
  return 'finish';
}

export class TimeTrial {
  readonly opts: TtOptions;
  track: Track;
  phase: Phase = 'ready';
  phaseT = 0;
  /** Rennzeit (s) – läuft ab „Los“ */
  time = 0;
  p!: Player;
  opps: GhostOpp[] = [];
  parts: Particle[] = [];
  popups: Popup[] = [];
  friends: Friend[] = [];
  shake = 0;
  crashSpin = 0;
  tags: RiderTag[] = [];
  tx = 0;
  draft = 0;
  energy = 1;
  mode: 'sit' | 'go' | 'ease' = 'sit';
  slides = 0;
  private txs = 0;
  private rng: Rng;
  private steer = { active: false, sx: 0, sy: 0, tx0: 0 };
  private keys = { left: false, right: false, down: false, up: false };
  private wantGo = false;
  private wantEase = false;
  private viewW = 390;
  private finT = -1;
  private topV = 0;
  private flags = new Set<string>();
  private popSide: 1 | -1 = 1;
  private countShown = 6;
  private warp = WARP;
  private down = 0;
  private stand = 0;
  private emptyT = 0;
  private slideCool = 0;
  private splitT: number[] = [];
  private trace: number[] = [];
  private traceT = 0;
  private ghostPos = { z: 0, x: 0, m: 0 };
  private passedNames: string[] = [];
  private cp = CP;
  private botTx = 0;

  constructor(opts: TtOptions) {
    this.opts = opts;
    this.track = new Track(opts.dayKey, opts.names, 'tt', opts.town ?? null);
    this.rng = mulberry32(this.track.seed ^ 0x77);
    this.cp = CP * (opts.bot?.strength ?? 1);
    this.reset();
  }

  reset() {
    this.track = new Track(this.opts.dayKey, this.opts.names, 'tt', this.opts.town ?? null);
    this.rng = mulberry32(this.track.seed ^ 0x77);
    const bot = this.opts.bot ? mulberry32(this.opts.bot.seed) : null;
    this.p = {
      z: 0, x: bot ? between(bot, -0.6, 0.6) : 0.3, vx: 0, v: 0, y: 0, vy: 0, air: false, airT: 0,
      lean: 0, pedal: 0, tuck: 0.6, brake: 0, wobble: 0, slip: 0, grip: 1, slick: 0,
      kit: this.opts.kit,
    };
    this.p.y = this.track.heightAt(this.p.z);
    this.tx = this.p.x;
    this.txs = this.p.x;
    this.botTx = this.p.x;
    this.opps = [];
    this.parts = [];
    this.popups = [];
    this.tags = [];
    this.phase = 'ready';
    this.phaseT = 0;
    this.time = 0;
    this.energy = 1;
    this.draft = 0;
    this.finT = -1;
    this.topV = 0;
    this.slides = 0;
    this.stand = 0;
    this.down = 0;
    this.warp = WARP;
    this.emptyT = 0;
    this.slideCool = 0;
    this.splitT = [];
    this.trace = [];
    this.traceT = 0;
    this.passedNames = [];
    this.countShown = 6;
    this.flags.clear();
    this.spawnGhosts();
  }

  /** Geister aufstellen: Startnummer nach Tageszeit, Trikot in der Avatarfarbe, ihr Rad */
  private spawnGhosts() {
    const sorted = [...this.opts.ghosts].sort((a, b) => a.timeMs - b.timeMs);
    sorted.forEach((g, i) => {
      if (g.trace.length < 6) return;
      ghostAt(g.trace, 0, this.ghostPos);
      const skin = SKINS[hashStr(g.id) % SKINS.length];
      const kit: Kit = g.bot
        ? { jersey: '#8d939b', side: '#2a2d33', helmet: '#2a2d33', shorts: '#2a2d33', skin, shoes: '#2a2d33', number: 'T', bike: g.bike }
        : { jersey: g.color, side: '#ffffff', helmet: '#ffffff', shorts: '#16171a', skin, shoes: '#ffffff', number: String(i + 1), bike: g.bike };
      this.opps.push({
        id: 1000 + i, z: this.ghostPos.z, x: this.ghostPos.x, vx: 0, v: 0, tx: this.ghostPos.x, f: 1, kit,
        pedal: hashStr(g.id) % 6, lean: 0, tuck: 0.6, brake: 0, passed: false, group: -1, bump: 0, attacker: false, stand: 0,
        ghost: 0, rider: g, m: 0, rank: i + 1, passedBy: false, passedMe: false,
      });
    });
  }

  get riders(): number { return this.ranked.length + 1; }
  /** Geister von heute – nur sie zählen für Platz, Zwischenzeiten und Tagesbestzeit (ältere fuhren eine andere Strecke) */
  private get ranked(): GhostOpp[] { return this.opps.filter((o) => !o.rider.old); }

  setViewport(w: number) { this.viewW = Math.max(240, w); }

  start() {
    if (this.phase !== 'ready' && this.phase !== 'over') return;
    if (this.phase === 'over') this.reset();
    this.phase = 'countdown';
    this.phaseT = 0;
    this.countShown = 5;
    this.opts.onEvent?.({ type: 'count', n: 5 });
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
    const dr = Math.min(0.05, dtReal);
    // Zeitraffer: in der Abfahrt langsamer (Kurven bei 70 km/h brauchen echte Reaktionszeit), weich überblendet
    const seg = this.track.segAt(this.p.z);
    const wantDown = seg.grade < -0.025 && this.p.z > TT_TOP - 30 && this.p.z < 2000 + 40 ? 1 : 0;
    this.down += (wantDown - this.down) * Math.min(1, dr * 2.2);
    const dt = dr * (WARP + (WARP_DOWN - WARP) * this.down);
    this.warp = dt / Math.max(1e-6, dr);
    this.phaseT += dr;
    if (this.keys.left) this.tx = clamp(this.tx - 3.5 * dr, -XMAX, XMAX);
    if (this.keys.right) this.tx = clamp(this.tx + 3.5 * dr, -XMAX, XMAX);
    if (this.phase === 'countdown') {
      // Starter zählt die Hand herunter: 5 … 1, dann Los
      const n = 5 - Math.floor(this.phaseT / 0.6);
      if (n !== this.countShown) { this.countShown = n; this.opts.onEvent?.({ type: 'count', n: Math.max(0, n) }); }
      if (this.phaseT >= 3.0) {
        this.phase = 'playing';
        this.phaseT = 0;
        this.time = 0;
        this.sample();
        const ref = this.track.ref;
        this.opts.onEvent?.({ type: 'banner', title: this.track.title, sub: `${(TT_FINISH / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1 })} km gegen die Uhr${ref && !ref.preview ? ` · ${ref.tour}` : ''}` });
      }
    }
    if (this.phase === 'playing') this.time += dt;
    if (this.opts.bot && this.phase === 'playing') this.botStep();
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(SUB, left);
      if (this.phase === 'playing' || this.phase === 'countdown') this.stepPlayer(h);
      left -= h;
    }
    this.stepGhosts(dt, dr);
    for (const q of this.parts) {
      q.life -= dr; q.z += q.vz * dr; q.x += q.vx * dr; q.h += q.vh * dr;
      q.vh -= 2.5 * dr; q.vx *= 0.98; q.rot += dr * 8;
    }
    this.parts = this.parts.filter((q) => q.life > 0);
    for (const pp of this.popups) pp.age += dr;
    this.popups = this.popups.filter((pp) => pp.age < pp.life);
    this.shake = Math.max(0, this.shake - dr * 3);
    if (this.phase === 'playing' && this.finT >= 0 && this.time - this.finT > 2.4) this.finish();
    this.track.trim(Math.floor(this.p.z / SEG) - 200);
  }

  /** Stützpunkt der eigenen Spur (alle TRACE_DT Sekunden Rennzeit); z: Lage genau zum Rasterzeitpunkt */
  private sample(z = this.p.z) {
    this.trace.push(Math.round(Math.max(0, z) * 10), Math.round(this.p.x * 100), this.mode === 'go' ? 1 : this.mode === 'ease' ? 2 : 0);
  }

  hud(): TtHud {
    const seg = this.track.segAt(this.p.z);
    const board = this.standings();
    const ranked = this.ranked;
    const best = ranked.length ? ranked.reduce((a, o) => (o.rider.timeMs < a.rider.timeMs ? o : a)) : null;
    return {
      time: this.finT >= 0 ? this.finT : this.time,
      toGo: Math.max(0, Math.round(TT_FINISH - this.p.z)),
      kmh: Math.round(this.p.v * 3.6),
      energy: this.energy,
      grade: Math.round(seg.grade * 1000) / 10,
      mode: this.mode,
      touch: this.steer.active ? { x: this.steer.sx, y: this.steer.sy } : null,
      place: board.find((b) => b.me)?.pos ?? 1,
      riders: this.riders,
      board,
      down: this.down > 0.5,
      ghosts: this.opps.map((o) => ({ id: o.rider.id, z: o.z, color: o.rider.bot ? '#9aa0a8' : o.rider.color })),
      gapBest: best ? this.gapTo(best) : null,
      bestName: best ? (best.rider.me ? 'Bestzeit' : firstName(best.rider.name)) : null,
    };
  }

  /** eigener Rückstand auf den Geist an der eigenen Stelle (s, + = dahinter; nach dem Ziel: Endzeiten) */
  private gapTo(o: GhostOpp): number {
    if (this.finT >= 0) return this.finT - o.rider.timeMs / 1000;
    return this.time - ghostTimeAt(o.rider.trace, this.p.z);
  }

  /** TV-Tafel: wer wäre hier vorn? Zeit jedes Geistes an der eigenen Stelle gegen die eigene Rennzeit */
  private standings(): Standing[] {
    const me = this.finT >= 0 ? this.finT : this.time;
    const all = [
      ...this.ranked.map((o) => ({ name: o.rider.bot ? 'Tempo' : o.rider.me ? 'Bestzeit' : firstName(o.rider.name), t: this.finT >= 0 ? o.rider.timeMs / 1000 : ghostTimeAt(o.rider.trace, this.p.z), me: false })),
      { name: 'Du', t: me, me: true },
    ].sort((a, b) => a.t - b.t);
    const out: Standing[] = [];
    const add = (i: number) => { const x = all[i]; if (x && !out.some((s) => s.pos === i + 1)) out.push({ pos: i + 1, name: x.name, gap: Math.max(0, x.t - all[0].t), me: x.me }); };
    add(0);
    add(1);
    add(all.findIndex((x) => x.me));
    return out;
  }

  /** aktueller virtueller Platz */
  place(): number { return this.standings().find((b) => b.me)?.pos ?? 1; }

  /** fahrbares Kurventempo auf den nächsten Metern (Haftgrenze grip in m/s²) */
  private safeSpeed(z: number, grip: number, look = 52): number {
    let vs = 40;
    for (let d = 0; d <= look; d += 4) {
      const k = Math.abs(this.track.segAt(z + d).curve);
      if (k > 0.002) vs = Math.min(vs, Math.sqrt(grip / k) + d * 0.11);
    }
    return vs;
  }

  // ------------------------------------------------------------ Spieler

  private stepPlayer(dt: number) {
    const p = this.p;
    const seg = this.track.segAt(p.z);
    const grade = seg.grade;
    const racing = this.phase === 'playing' && this.finT < 0;
    const go = racing && (this.wantGo || this.keys.up);
    const ease = racing && !go && (this.wantEase || this.keys.down);
    this.mode = go ? 'go' : ease ? 'ease' : 'sit';
    const descent = this.down > 0.5;
    const empty = this.energy <= 0.001;
    let P = 0;
    let B = 0;
    let posture = AERO;
    let standTarget = 0;
    if (this.phase === 'countdown') {
      // auf der Rampe, der Starter hält das Rad
      p.v = 0;
      p.vx = 0;
      p.tuck += (0.35 - p.tuck) * Math.min(1, dt * 5);
      p.brake += (0 - p.brake) * Math.min(1, dt * 8);
      p.stand = 0;
      return;
    }
    if (!racing) {
      // Auslauf nach dem Ziel
      P = clamp(powerTo(7, p.v, grade, CDA), 0, 6);
      posture = HOODS;
      if (p.v > 8) B = 2.5;
    } else if (descent) {
      // bergab: geduckt schneller, aber ohne Bremshilfe; sonst bremst die Hilfe vor Kurven aufs fahrbare Tempo
      const vSafe = this.safeSpeed(p.z, ASSIST_G * G);
      posture = go ? TUCK : HOODS;
      if (go) P = p.v < 19 ? this.cp + KICK * 0.8 : 0;
      else if (p.v < 12) P = this.cp * 0.8;
      // Bremsen hält nicht an: unter 5 m/s rollt es weiter
      if (ease) B = p.v > 5 ? 6.5 : 0;
      else if (!go) B = clamp((p.v - vSafe * 0.97) * 2.5, 0, 6.5);
      if (B > 0.5) posture = BRAKING;
    } else {
      // flach und bergauf: Dauerleistung auf dem Auflieger, Drücken (bergauf im Wiegetritt), Erholen
      const climbing = grade > 0.025;
      if (go) { P = this.cp + KICK; posture = climbing ? STAND : PUSH; standTarget = climbing ? 1 : 0; }
      else if (ease) { P = this.cp * 0.68; posture = climbing ? HOODS : AERO; }
      else { P = this.cp; posture = climbing ? HOODS : AERO; }
      if (empty) P = Math.min(P, this.cp * 0.88);
      // Startrampe: erst mal auf Tempo kommen (die ersten Meter sind geschenkt)
      if (p.z < 40) P = Math.max(P, this.cp + KICK * 0.6);
    }
    this.stand += (standTarget - this.stand) * Math.min(1, dt * 6);
    const a = P / Math.max(p.v, 2.5) - resist(p.v, grade, CDA * posture) - B;
    p.v = clamp(p.v + a * dt, 0, 30);
    const z0 = p.z;
    // Linie: innen ist der Weg kürzer (Kurvenradius minus seitliche Lage), außen länger
    const line = clamp(1 - seg.curve * p.x, 0.9, 1.1);
    p.z += (p.v * dt) / line;
    p.y = this.track.heightAt(p.z);
    // Kraft: über der Dauerleistung leert sich der Vorrat, darunter füllt er sich (bergab erholt man sich)
    if (racing) {
      const Pe = descent ? Math.min(P, this.cp * 0.6) : P;
      if (Pe > this.cp) this.energy -= ((Pe - this.cp) / WJ) * dt;
      else this.energy += ((this.cp - Pe) / WJ) * (descent ? 0.6 : ease ? 0.5 : 0.35) * dt;
      this.energy = clamp(this.energy, 0, 1);
      this.emptyT = this.energy <= 0.001 ? this.emptyT + dt : 0;
      if (this.emptyT > 0.2 && !this.flags.has('empty')) {
        this.flags.add('empty');
        this.pop('Am Limit!', 'red', 'Vorrat leer', true);
        this.opts.onEvent?.({ type: 'banner', title: 'Am Limit', sub: 'Daumen runter – kurz erholen', tone: 'red' });
      }
      if (this.energy > 0.3) this.flags.delete('empty');
      this.topV = Math.max(this.topV, p.v);
    }
    this.lateral(dt, racing);
    // Pedale in Echtzeit (der Zeitraffer soll nicht hektisch wirken); bergab ohne Tritt rollen – mit Schwung (motion.ts)
    pedalStep(p, descent && P === 0 ? 0 : Math.min(9.5, 3.2 + p.v * 0.95) / this.warp, dt);
    const tuckTarget = descent ? (posture <= TUCK ? 1 : B > 0.5 ? 0.3 : 0.5) : posture === AERO ? 0.72 : posture === PUSH ? 0.62 : posture === HOODS ? 0.35 : 0.15 * this.stand;
    p.tuck += (tuckTarget - p.tuck) * Math.min(1, dt * 5);
    p.brake += (clamp(B / 6.5, 0, 1) - p.brake) * Math.min(1, dt * 8);
    p.stand = this.stand;
    if (racing) {
      this.traceT += dt;
      while (this.traceT >= TRACE_DT) { this.traceT -= TRACE_DT; this.sample(p.z - p.v * this.traceT); }
      this.callouts(z0);
      // Zwischenzeiten
      for (let i = 0; i < TT_SPLITS.length; i++) {
        const sz = TT_SPLITS[i];
        if (z0 < sz && p.z >= sz && this.splitT.length === i) {
          const t = this.time - (p.z - sz) / Math.max(1, p.v);
          this.splitT.push(t);
          this.split(i, t);
        }
      }
      // Ziel
      if (p.z >= TT_FINISH) {
        this.finT = this.time - (p.z - TT_FINISH) / Math.max(1, p.v);
        const pl = this.place();
        if (pl === 1 && this.ranked.some((o) => !o.rider.me)) { this.pop('Tagesbestzeit!', 'gold', undefined, true); this.confetti(); }
        else if (this.opts.myBest !== null && this.finT * 1000 < this.opts.myBest) { this.pop('Bestzeit!', 'gold', 'persönlich', true); this.confetti(); }
        else this.pop(`${pl}. Platz`, pl <= 3 ? 'gold' : 'white', undefined, true);
      }
    } else if (this.finT >= 0 && this.phase === 'playing') {
      // nach der Linie noch ein paar Stützpunkte zum Ausrollen
      this.traceT += dt;
      while (this.traceT >= TRACE_DT) { this.traceT -= TRACE_DT; if (this.trace.length < 6000) this.sample(p.z - p.v * this.traceT); }
    }
  }

  /** seitlich: Lenken mit Fliehkraft und Haftgrenze; zu schnell in der Kurve rutscht man nach außen */
  private lateral(dt: number, racing: boolean) {
    const p = this.p;
    const seg = this.track.segAt(p.z);
    this.txs += (this.tx - this.txs) * Math.min(1, dt * 12);
    const grip = GRIP_G * G;
    const ac = seg.curve * p.v * p.v;
    const want = clamp(46 * (this.txs - p.x) - 13.5 * p.vx, -7, 7);
    const arel = clamp(want, -grip - ac, grip - ac);
    p.vx += arel * dt;
    let nx = p.x + p.vx * dt;
    p.lean += (clamp(Math.atan2(ac + arel * 0.4, G) * 0.85, -0.6, 0.6) - p.lean) * Math.min(1, dt * 3.5);
    // rausgerutscht: über den Rand hinaus → Tempo weg, zurück auf die Straße
    this.slideCool -= dt;
    if (Math.abs(nx) > ROAD_HALF + 0.15) {
      const sg = Math.sign(nx);
      nx = sg * (ROAD_HALF - 0.5);
      p.vx = 0;
      this.tx = nx;
      this.txs = nx;
      if (this.slideCool <= 0 && racing) {
        this.slideCool = 2;
        this.slides += 1;
        p.v = Math.min(p.v, 6);
        p.wobble = 1;
        this.shake = 0.8;
        this.pop('Abgerutscht!', 'red', 'Zu schnell in die Kurve', true);
        for (let i = 0; i < 10; i++) this.dust(p.z, nx);
      }
    } else if (!racing) nx = clamp(nx, -XMAX, XMAX);
    p.x = nx;
    p.wobble = Math.max(0, p.wobble - dt * 1.5);
  }

  /** Tempomacher: am Berg und auf den letzten 400 m drücken, sonst Dauerleistung; die Innenseite der Kurven suchen */
  private botStep() {
    const b = this.opts.bot!;
    const p = this.p;
    const seg = this.track.segAt(p.z);
    const toGo = TT_FINISH - p.z;
    const climbing = seg.grade > 0.03;
    let go = climbing && this.energy > 0.2;
    if (toGo < 400 && this.energy > 0.03) go = true;
    if (this.down > 0.5) go = this.energy > 0.5 && this.safeSpeed(p.z, ASSIST_G * G, 70) > 24;
    this.keys.up = go;
    this.keys.down = false;
    let k = 0;
    for (const d of [12, 24, 36, 48]) k += this.track.segAt(p.z + d).curve;
    const want = clamp(Math.sign(k) * Math.min(1, Math.abs(k) / 0.03) * (XMAX - 0.2), -XMAX, XMAX) * b.line;
    this.botTx += (want - this.botTx) * 0.08;
    this.tx = this.botTx;
  }

  private split(i: number, t: number) {
    const sz = TT_SPLITS[i];
    const ranked = this.ranked;
    const times = ranked.map((o) => ghostTimeAt(o.rider.trace, sz));
    let bi = -1;
    for (let k = 0; k < times.length; k++) if (bi < 0 || times[k] < times[bi]) bi = k;
    const best = bi >= 0 ? times[bi] : null;
    const bestRider = bi >= 0 ? ranked[bi].rider : null;
    const gapMs = best !== null ? Math.round((t - best) * 1000) : null;
    const place = 1 + times.filter((x) => x < t).length;
    const bestName = bestRider ? (bestRider.bot ? 'Tempomacher' : bestRider.me ? 'dein Bestlauf' : firstName(bestRider.name)) : null;
    this.opts.onEvent?.({ type: 'split', index: i, timeMs: Math.round(t * 1000), gapMs, place, riders: this.riders, bestName });
    this.pop(`Zwischenzeit ${i + 1}`, gapMs !== null && gapMs <= 0 ? 'gold' : 'white', gapMs === null ? undefined : `${gapMs <= 0 ? '−' : '+'}${(Math.abs(gapMs) / 1000).toFixed(1).replace('.', ',')} s`, true);
  }

  private callouts(z0: number) {
    const p = this.p;
    const once = (key: string, f: () => void) => { if (!this.flags.has(key)) { this.flags.add(key); f(); } };
    const at = (z: number) => z0 < z && p.z >= z;
    const ref = this.track.ref;
    const real = ref?.climb;
    if (at(1000)) once('cote', () => this.opts.onEvent?.({ type: 'banner', title: `Gleich: ${this.track.climbName}`, sub: real?.grad && real.len ? `${real.len.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km mit ${real.grad.toLocaleString('de-DE', { maximumFractionDigits: 1 })} % – hier zählt der Vorrat` : '460 m mit bis zu 8,5 % – hier zählt der Vorrat' }));
    if (at(TT_TOP)) once('top', () => this.opts.onEvent?.({ type: 'banner', title: 'Kuppe – Abfahrt!', sub: 'Daumen hoch = ducken · vor engen Kurven loslassen', tone: 'accent' }));
    if (at(2000)) once('1k', () => this.opts.onEvent?.({ type: 'banner', title: 'Letzter Kilometer', sub: this.energy > 0.25 ? 'Alles raus – der Vorrat zählt nicht mehr' : 'Durchhalten bis zur Linie', tone: 'red' }));
    if (at(TT_FINISH - 250)) once('final', () => this.opts.onEvent?.({ type: 'banner', title: 'Zielgerade', sub: 'Daumen hoch und halten', tone: 'accent' }));
    // Geister: überholen und überholt werden
    for (const o of this.opps) {
      if (o.ghost <= 0) continue;
      const dz = o.z - p.z;
      if (!o.passedBy && dz < -0.8 && Math.abs(o.x - p.x) < 2.5 && o.v < p.v + 6) {
        o.passedBy = true;
        o.passedMe = false;
        if (!o.rider.me && !o.rider.old) this.passedNames.push(o.rider.name);
        this.pop(o.rider.me ? (o.rider.old ? `${ghostName(o.rider)} überholt` : 'Schneller als dein Bestlauf') : `${ghostName(o.rider)} überholt`, o.rider.me && !o.rider.old ? 'gold' : 'accent', undefined, false, true);
      } else if (o.passedBy && dz > 2.5) {
        o.passedBy = false;
      }
      if (!o.passedMe && dz > 0.8 && dz < 6 && o.v > p.v + 0.4 && !o.passedBy && this.time > 4) {
        if (this.flags.has(`pm:${o.id}`)) continue;
        this.flags.add(`pm:${o.id}`);
        o.passedMe = true;
        this.pop(`${ghostName(o.rider, true)} zieht vorbei`, 'muted', undefined, false, true);
      }
      if (o.passedMe && dz < -1) o.passedMe = false;
    }
  }

  // ------------------------------------------------------------ Geister

  private stepGhosts(dt: number, dr: number) {
    const playing = this.phase === 'playing';
    const p = this.p;
    let tagged: GhostOpp | null = null;
    for (const o of this.opps) {
      ghostAt(o.rider.trace, playing ? this.time : 0, this.ghostPos);
      const z0 = o.z;
      o.z = this.ghostPos.z;
      const nx = this.ghostPos.x;
      o.vx = dt > 0 ? (nx - o.x) / dt : 0;
      o.x = nx;
      o.v = dt > 0 ? Math.max(0, (o.z - z0) / dt) : 0;
      o.m = this.ghostPos.m;
      const seg = this.track.segAt(o.z);
      const climbing = seg.grade > 0.025;
      const downhill = seg.grade < -0.03;
      // Haltung aus der Spur: drücken bergauf im Wiegetritt, bergab geduckt, sonst auf dem Auflieger
      const standT = o.m === 1 && climbing ? 1 : 0;
      o.stand = (o.stand ?? 0) + (standT - (o.stand ?? 0)) * Math.min(1, dt * 6);
      const tuckT = downhill ? (o.m === 1 ? 1 : 0.5) : o.m === 2 ? 0.3 : climbing ? 0.15 * (o.stand ?? 0) : 0.7;
      o.tuck += (tuckT - o.tuck) * Math.min(1, dt * 5);
      o.lean += (clamp(-o.vx * 0.12 + Math.atan2(seg.curve * o.v * o.v, G) * 0.8, -0.55, 0.55) - o.lean) * Math.min(1, dt * 6);
      pedalStep(o, downhill && o.m !== 1 && o.v > 12 ? 0 : Math.min(9.5, 3.2 + o.v * 0.95) / this.warp, dt);
      // sichtbar ab „Los“: in den ersten Metern einblenden
      // ältere Geister (andere Tage) etwas blasser
      const want = playing ? GHOST_ALPHA * (o.rider.old ? 0.65 : 1) : 0;
      o.ghost += (want - o.ghost) * Math.min(1, dr * 2.5);
      if (o.ghost < 0.01) o.ghost = want > 0 ? 0.01 : 0;
      // Namensschild: der nächste Geist voraus (bis 45 m)
      const dz = o.z - p.z;
      if (playing && this.finT < 0 && dz > 1.5 && dz < 45 && (!tagged || dz < tagged.z - p.z)) tagged = o;
    }
    if (tagged) {
      const gap = this.gapTo(tagged);
      const name = ghostName(tagged.rider, true);
      this.tags = [{ id: tagged.id, text: name, sub: `${gap >= 0 ? '+' : '−'}${Math.abs(gap).toFixed(1).replace('.', ',')}″`, color: tagged.rider.bot ? '#9aa0a8' : tagged.rider.color }];
    } else this.tags = [];
  }

  // ------------------------------------------------------------ Ende

  private finish() {
    this.phase = 'over';
    this.phaseT = 0;
    const timeMs = Math.round(this.finT * 1000);
    const splits = this.splitT.map((t) => Math.round(t * 1000));
    const others = this.ranked.filter((o) => !o.rider.me);
    const times = others.map((o) => o.rider.timeMs);
    const bestO = others.length ? others.reduce((a, o) => (o.rider.timeMs < a.rider.timeMs ? o : a)) : null;
    const place = 1 + times.filter((t) => t < timeMs).length;
    const pb = this.opts.myBest === null || timeMs < this.opts.myBest;
    const dayBest = bestO === null || timeMs < bestO.rider.timeMs;
    // Sektoren: Start → ZZ1 → ZZ2 → Ziel, je Sektor der schnellste Geist
    const marks = [0, ...splits, timeMs];
    const sectors: TtSector[] = [];
    for (let i = 0; i < marks.length - 1; i++) {
      const me = marks[i + 1] - marks[i];
      let best: number | null = null;
      let bestName: string | null = null;
      let leader: number | null = null;
      for (const o of this.ranked) {
        const s = o.rider.splits;
        const m0 = i === 0 ? 0 : s[i - 1];
        const m1 = i === marks.length - 2 ? o.rider.timeMs : s[i];
        if (m0 === undefined || m1 === undefined) continue;
        const t = m1 - m0;
        if (best === null || t < best) { best = t; bestName = o.rider.bot ? 'Tempomacher' : o.rider.me ? 'Dein Bestlauf' : firstName(o.rider.name); }
        if (o === bestO) leader = t;
      }
      sectors.push({ me, best, bestName, leader });
    }
    const all = [...others.map((o) => ({ name: o.rider.bot ? 'Tempomacher' : o.rider.name, me: false, timeMs: o.rider.timeMs })), { name: this.opts.rider, me: true, timeMs }].sort((a, b) => a.timeMs - b.timeMs);
    this.opts.onOver?.({
      timeMs, splits, place, riders: others.length + 1,
      gapMs: bestO ? timeMs - bestO.rider.timeMs : null,
      leader: bestO ? { name: bestO.rider.bot ? 'Tempomacher' : bestO.rider.name, timeMs: bestO.rider.timeMs } : null,
      pb, dayBest: dayBest && others.length > 0,
      avgKmh: Math.round((TT_FINISH / (timeMs / 1000)) * 3.6 * 10) / 10,
      topKmh: Math.round(this.topV * 3.6),
      slides: this.slides,
      reserve: this.energy,
      sectors,
      trace: this.trace.slice(),
      podium: all.slice(0, 3),
      passed: this.passedNames.slice(),
    });
  }

  private confetti() {
    const cols = ['#ff5fa2', '#ffd23f', '#2f80ed', '#27ae60', '#ffffff'];
    for (let i = 0; i < 70; i++) {
      this.parts.push({ kind: 'confetti', z: this.p.z + 3 + Math.random() * 6, x: (Math.random() - 0.5) * 6, h: 2 + Math.random() * 2,
        vz: this.p.v * 0.6, vx: (Math.random() - 0.5) * 3, vh: 1 + Math.random() * 2, life: 2.5, max: 2.5, size: 0.12, color: cols[i % cols.length], rot: Math.random() * 6 });
    }
  }

  private dust(z: number, x: number) {
    this.parts.push({ kind: 'dust', z, x: x + (this.rng() - 0.5) * 0.4, h: 0.1, vz: this.p.v * 0.3, vx: (this.rng() - 0.5) * 2, vh: 0.6 + this.rng(), life: 0.9, max: 0.9, size: 0.35, color: '#b9ab92', rot: 0 });
  }

  pop(text: string, tone: Popup['tone'], sub?: string, big = false, small = false) {
    if (this.popups.length > 4) this.popups.shift();
    const n = (sd: number) => this.popups.filter((q) => q.side === sd).length;
    let side: -1 | 1;
    if (n(-1) === n(1)) { this.popSide = this.popSide === 1 ? -1 : 1; side = this.popSide; } else side = n(-1) < n(1) ? -1 : 1;
    const used = new Set(this.popups.filter((q) => q.side === side).map((q) => q.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    this.popups.push({ text, sub, tone, side, slot, age: 0, life: big ? 2.2 : small ? 1.2 : 1.5, dx: 0.5, dy: 0.5, big });
  }
}

/**
 * Tempomacher: eine Fahrt ohne Spieler durchrechnen – als Geist, wenn noch kaum jemand gefahren ist, und für die
 * Demo. Dieselbe Strecke, dieselbe Physik; Stärke und Linienwahl machen den Unterschied.
 */
export function simulateGhost(dayKey: string, bot: { strength: number; line: number; seed: number }, town: StageRef | null = null): { timeMs: number; splits: number[]; trace: number[] } {
  const box: { r: { timeMs: number; splits: number[]; trace: number[] } | null } = { r: null };
  const eng = new TimeTrial({
    dayKey, names: [], rider: 'Tempomacher',
    kit: { jersey: '#8d939b', side: '#2a2d33', helmet: '#2a2d33', shorts: '#2a2d33', skin: SKINS[0], shoes: '#2a2d33', number: 'T' },
    town, ghosts: [], myBest: null, bot,
    onOver: (r) => { box.r = { timeMs: r.timeMs, splits: r.splits, trace: r.trace }; },
  });
  eng.start();
  for (let i = 0; i < 30 * 600 && eng.phase !== 'over'; i++) eng.update(1 / 30);
  return box.r ?? { timeMs: 0, splits: [], trace: [] };
}

/** Rückstand auf den Sektor-Besten als Text („+1,2 s“ / „−0,4 s“) */
export function sectorGap(s: TtSector): string | null {
  if (s.best === null) return null;
  const d = s.me - s.best;
  return `${d <= 0 ? '−' : '+'}${(Math.abs(d) / 1000).toFixed(1).replace('.', ',')} s`;
}
