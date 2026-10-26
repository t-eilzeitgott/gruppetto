/**
 * Bergfinale: Schlussanstieg in der Favoritengruppe, Bergwertung auf der Passhöhe, Abfahrt ins Tal
 * und ein kurzer Zielsprint.
 *
 * Bergauf zählt die Kraft. Jeder Fahrer hat eine Dauerleistung (W/kg) und einen Vorrat für alles
 * darüber – das ist der Kraftbalken. Wer über seiner Dauerleistung fährt (Tempo der Gruppe zu hoch,
 * Attacke, Lücke zufahren), leert den Vorrat; darunter füllt er sich langsam wieder. Ist er leer, geht
 * nur noch knapp unter der Dauerleistung – man wird abgehängt. Die Favoriten greifen an, Helfer
 * machen das Tempo und fallen ab, schwächere Fahrer gehen hinten raus.
 *
 * Bergab zählt die Linie: Daumen hoch = ducken (schneller, aber ohne Bremshilfe). Vor Kehren
 * loslassen – dann bremst die Hilfe auf ein fahrbares Tempo –, sonst rutscht man nach außen.
 *
 * Fahrphysik je Kilogramm: Vortrieb = Leistung / Tempo, dagegen Hangabtrieb, Rollwiderstand und
 * Luftwiderstand (im Windschatten weniger, geduckt viel weniger). Bergauf läuft die Zeit 1,5-mal
 * schneller (sonst dauerte der Anstieg über zwei Minuten); Tempo und Zeitabstände bleiben echt.
 */
import { MOUNTAIN_FINISH, MOUNTAIN_TOP, ROAD_HALF, SEG, Track } from './track';
import { clamp, type Friend, type Opp, type Particle, type Phase, type Player, type Popup, standings, type Standing } from './engine';
import { between, chance, mulberry32, pick, type Rng } from './rng';
import { SKINS, TEAM_KITS, type Kit } from './rider';
import type { RiderType, SprintRider } from './sprint';
import type { StageRef } from './stageRef';

/** Fahrertypen im Bergfinale: Dauerleistung (W/kg), Antritt (W/kg darüber), Abfahrtskönnen, Punktebonus */
export const BERG_STATS: Record<RiderType, { label: string; cp: number; kick: number; desc: number; bonus: number }> = {
  climber: { label: 'Kletterer', cp: 6.45, kick: 3.4, desc: 0.96, bonus: 1 },
  allround: { label: 'Allrounder', cp: 6.3, kick: 3.4, desc: 0.975, bonus: 1.1 },
  puncheur: { label: 'Puncheur', cp: 6.18, kick: 4.1, desc: 0.97, bonus: 1.15 },
  rouleur: { label: 'Rouleur', cp: 6.02, kick: 2.9, desc: 1.0, bonus: 1.3 },
  sprinter: { label: 'Sprinter', cp: 5.78, kick: 4.4, desc: 0.97, bonus: 1.5 },
};

/** Werte für die Anzeige (0–1) */
export function bergBars(t: RiderType): { climb: number; kick: number; desc: number } {
  const s = BERG_STATS[t];
  return { climb: (s.cp - 5.5) / 1.0, kick: (s.kick - 2.5) / 2.1, desc: (s.desc - 0.9) / 0.11 };
}

export interface BergOptions {
  dayKey: string;
  names: string[];
  rider: SprintRider;
  /** echte Fahrernamen für die Gegner (die besten Kletterer zuerst) */
  rivals: string[];
  kit: Kit;
  /** echter Zielort der Etappe (sonst einer aus der Liste) oder die ganze Etappenvorlage */
  town?: string | StageRef | null;
  /** Edelhelfer aus dem eigenen Team */
  mate?: string | null;
  onEvent?: (e: BergEvent) => void;
  onOver?: (r: BergResult) => void;
}

export type BergEvent =
  | { type: 'count'; n: number }
  | { type: 'banner'; title: string; sub?: string; tone?: 'gold' | 'accent' | 'red' };

export interface BergResult {
  place: number;
  riders: number;
  score: number;
  parts: { place: number; gpm: number; gap: number; type: number };
  winner: string;
  /** Sekunden hinter dem Sieger (als Sieger: Vorsprung auf den Zweiten) */
  gap: number;
  topKmh: number;
  /** Platz in der Bergwertung (Reihenfolge auf der Passhöhe) */
  gpmPlace: number;
  slides: number;
  podium: { name: string; me: boolean }[];
}

export type BergStage = 'climb' | 'descent' | 'final';

export interface BergHud {
  place: number; riders: number;
  /** Meter bis zum Gipfel (≤ 0 danach) und bis ins Ziel */
  toTop: number; toGo: number;
  kmh: number; energy: number; draft: number;
  /** Steigung in Prozent (negativ = bergab) */
  grade: number;
  stage: BergStage;
  mode: 'sit' | 'go' | 'ease';
  touch: { x: number; y: number } | null;
  /** Abstand zur Spitze (s); vorne: Vorsprung auf den Nächsten (negativ) */
  lead: { name: string; gap: number } | null;
  ahead: string | null;
  /** TV-Tafel: Spitze, Zweiter, du */
  board: Standing[];
  /** Edelhelfer am Berg: Name und ob er gerade vor dir das Tempo macht (null = nicht mehr dabei) */
  mate: { name: string; front: boolean } | null;
}

type Role = 'helper' | 'fav' | 'weak' | 'mate';

interface Racer extends Opp {
  name: string;
  role: Role;
  cp: number;
  kick: number;
  desc: number;
  /** Kraftvorrat 0–1 */
  w: number;
  /** greift so viele Meter vor dem Gipfel an (0 = nie) */
  attackAt: number;
  /** laufende Attacke: Sekunden übrig */
  attackT: number;
  /** hat schon angegriffen */
  attacked?: boolean;
  /** Edelhelfer: fährt vor dir (true) oder an deinem Hinterrad (false); Sekunden seit dem letzten Tausch */
  mateLead?: boolean;
  swapT?: number;
  /** nach der Attacke hart weiterfahren, bis der Vorrat unter diese Marke fällt */
  hold: number;
  /** jagt einer Attacke hinterher (Sekunden übrig) */
  chaseT: number;
  /** Helfer: fällt bei diesem Meter ab */
  peel: number;
  peeled: boolean;
  /** Zielsprint ab so vielen Metern vor dem Ziel */
  launch: number;
  /** Abfahrt: Anteil des fahrbaren Kurventempos */
  nerve: number;
  stand: number;
  drift: number;
  driftT: number;
  topT: number;
  done: boolean;
  finT: number;
}

const lastName = (n: string) => n.split(' ').slice(-1)[0] ?? n;
const G = 9.81;
const CRR = 0.004;
const CDA = 0.0028;      // Luftwiderstand je kg in Sitzhaltung (Leistung = CDA · v³)
const WJ = 160;          // Kraftvorrat in J/kg
const SUB = 1 / 60;
const WARP = 1.5;        // Zeitraffer bergauf
const PUSH_COST = 1.9;   // Spieler: Kraftverbrauch über der Dauerleistung bergauf
const GRIP_G = 0.8;      // Haftgrenze in Kurven (in g)
const ASSIST_G = 0.72;   // bis hierhin bremst die Hilfe vor Kurven
const XMAX = ROAD_HALF - 0.45;
const PLACE_PTS = [1000, 760, 600, 480, 400, 340, 290, 250, 220, 200];
const GPM_PTS = [250, 150, 80];

/** Fahrwiderstand je kg (N/kg) */
const resist = (v: number, grade: number, aero: number) => G * (grade + CRR) + aero * v * v;
/** Leistung, um von v auf vd zu kommen (W/kg) */
const powerTo = (vd: number, v: number, grade: number, aero: number) =>
  Math.max(1, vd) * resist(Math.max(1, vd), grade, aero) + (vd - v) * 2.4 * Math.max(v, 2.5);
/** Tempo im Gleichgewicht bei Leistung P (für die Anzeige von Tempoabsichten) */
function speedAt(P: number, grade: number, aero: number): number {
  let v = 6;
  for (let i = 0; i < 12; i++) v = Math.max(1, P / Math.max(0.3, resist(v, grade, aero)));
  return v;
}

export class BergRace {
  readonly opts: BergOptions;
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
  slides = 0;
  private txs = 0;
  private stats = BERG_STATS.climber;
  private rng: Rng;
  private steer = { active: false, sx: 0, sy: 0, tx0: 0 };
  private keys = { left: false, right: false, down: false, up: false };
  private wantGo = false;
  private wantEase = false;
  private viewW = 390;
  private finT = -1;
  private topT = -1;
  private topV = 0;
  private flags = new Set<string>();
  private popSide: 1 | -1 = 1;
  private countShown = 4;
  private warp = WARP;
  private lastAttack = -99;
  private limitCues = 0;
  /** Ansage des Edelhelfers kurz nach dem Start */
  private mateIntro = 0;
  private lastCue = -99;
  private attacks = 0;
  private emptyT = 0;
  private slideCool = 0;
  private stand = 0;

  constructor(opts: BergOptions) {
    this.opts = opts;
    this.stats = BERG_STATS[opts.rider.type];
    this.track = new Track(opts.dayKey, opts.names, 'mountain', opts.town);
    this.rng = mulberry32(this.track.seed ^ 0xb3);
    this.reset();
  }

  /** Tempo der Gruppe am Fuß des Anstiegs (die Helfer fahren 6 W/kg) – so rollt alles gleichmäßig los */
  private v0 = 6.2;

  reset() {
    this.track = new Track(this.opts.dayKey, this.opts.names, 'mountain', this.opts.town);
    this.rng = mulberry32(this.track.seed ^ 0xb3);
    this.v0 = speedAt(6.0, this.track.segAt(40).grade, CDA);
    this.p = {
      z: 0, x: 0.55, vx: 0, v: this.v0, y: 0, vy: 0, air: false, airT: 0,
      lean: 0, pedal: 0, tuck: 0, brake: 0, wobble: 0, slip: 0, grip: 1, slick: 0,
      kit: this.opts.kit,
    };
    this.opps = [];
    this.parts = [];
    this.popups = [];
    this.phase = 'ready';
    this.phaseT = 0;
    this.time = 0;
    this.energy = 1;
    this.draft = 0;
    this.finT = -1;
    this.topT = -1;
    this.topV = 0;
    this.slides = 0;
    this.attacks = 0;
    this.lastAttack = -99;
    this.limitCues = 0;
    this.lastCue = -99;
    this.mateIntro = 0;
    this.emptyT = 0;
    this.stand = 0;
    this.flags.clear();
    this.spawnField();
    this.tx = this.p.x;
    this.txs = this.p.x;
    this.p.y = this.track.heightAt(this.p.z);
  }

  /** Favoritengruppe am Fuß des Schlussanstiegs: drei Helfer vorn, dahinter Favoriten und zwei, die bald abreißen */
  private spawnField() {
    const r = this.rng;
    const rivals = [...this.opts.rivals];
    // die Namen kommen nach Bergergebnissen sortiert: die ersten sind die stärksten Kletterer
    const nameAt = (i: number) => (rivals[i] ?? `Fahrer ${Math.floor(between(r, 11, 199))}`);
    const kits = [...TEAM_KITS].sort(() => r() - 0.5);
    const roles: Role[] = ['helper', 'helper', 'helper', 'fav', 'fav', 'fav', 'fav', 'fav', 'fav', 'fav', 'fav', 'weak', 'weak'];
    // Startaufstellung: zu zweit nebeneinander, Helfer vorn; der Spieler mittendrin
    const rows: [number, number][] = [];
    for (let i = 0; i < roles.length + 2; i++) rows.push([46 - Math.floor(i / 2) * 2.3, i % 2 ? -0.55 : 0.55]);
    const meSlot = 8;
    const mateSlot = meSlot - 2;
    let favNo = 0;
    let id = 0;
    let slot = 0;
    for (let i = 0; i < roles.length; i++) {
      while (slot === meSlot || slot === mateSlot) slot++;
      const role = roles[i];
      const [z, x] = rows[slot++];
      const fav = role === 'fav';
      const name = fav ? nameAt(favNo++) : nameAt(8 + i);
      const kit = role === 'helper' ? kits[0] : kits[(1 + i) % kits.length];
      // stärkere Kletterer stehen weiter oben in der Namensliste
      const cp = role === 'helper' ? between(r, 5.95, 6.05) : role === 'weak' ? between(r, 5.7, 5.85) : 6.24 - (favNo - 1) * 0.045 + between(r, -0.05, 0.05);
      this.opps.push({
        id: id++, z: z + (r() - 0.5) * 0.3, x, vx: 0, v: this.v0, tx: x, f: 0.7,
        kit: { ...kit, skin: pick(r, SKINS), number: String(Math.floor(between(r, 11, 199))) },
        pedal: r() * 6, lean: 0, tuck: 0, brake: 0, passed: false, group: role === 'helper' ? 0 : -1, bump: 0, attacker: false,
        name, role, cp, kick: role === 'helper' ? 2.4 : between(r, 2.8, 3.8), desc: between(r, 0.92, 0.99), w: 1,
        attackAt: 0, attackT: 0, hold: 0, chaseT: 0,
        peel: role === 'helper' ? [240, 430, 600][i] + between(r, -25, 25) : 0, peeled: false,
        launch: between(r, 150, 260), nerve: between(r, 0.9, 0.98), stand: 0,
        drift: 0, driftT: r() * 3, topT: -1, done: false, finT: -1,
      });
    }
    this.p.z = rows[meSlot][0];
    this.p.x = rows[meSlot][1];
    // Edelhelfer im eigenen Trikot direkt vor dem Spieler: macht bergauf das Tempo und wartet auf dich
    {
      const k = this.opts.kit;
      const [z, x] = rows[mateSlot];
      this.opps.push({
        id: id++, z, x, vx: 0, v: this.v0, tx: x, f: 0.7,
        kit: { ...k, number: String(Math.floor(between(r, 11, 199))) },
        pedal: r() * 6, lean: 0, tuck: 0, brake: 0, passed: false, group: -1, bump: 0, attacker: false,
        name: this.opts.mate || 'Dein Helfer', role: 'mate', cp: 6.1, kick: 2.4, desc: 0.95, w: 1,
        attackAt: 0, attackT: 0, hold: 0, chaseT: 0,
        peel: MOUNTAIN_TOP - between(r, 300, 380), peeled: false,
        launch: 0, nerve: 0.94, stand: 0,
        drift: 0, driftT: r() * 3, topT: -1, done: false, finT: -1,
      });
    }
    // Angriffe: vier Favoriten haben einen Plan (Meter vor dem Gipfel)
    const favs = this.opps.filter((o) => o.role === 'fav');
    const plan = [between(r, 700, 780), between(r, 560, 640), between(r, 430, 500), between(r, 300, 360), between(r, 190, 240), between(r, 90, 140)];
    const order = [...favs].sort(() => r() - 0.5);
    plan.forEach((at, k) => { if (order[k]) order[k].attackAt = at; });
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

  /** Abschnitt nach Position */
  static stageAt(z: number): BergStage {
    if (z < MOUNTAIN_TOP) return 'climb';
    return MOUNTAIN_FINISH - z > 320 ? 'descent' : 'final';
  }

  update(dtReal: number) {
    const dr = Math.min(0.05, dtReal);
    // Zeitraffer bergauf, über die Passhöhe weich auf Echtzeit
    this.warp = 1 + (WARP - 1) * clamp(1 - (this.p.z - MOUNTAIN_TOP) / 40, 0, 1);
    const dt = dr * this.warp;
    this.time += dt;
    this.phaseT += dr;
    if (this.keys.left) this.tx = clamp(this.tx - 3.5 * dr, -XMAX, XMAX);
    if (this.keys.right) this.tx = clamp(this.tx + 3.5 * dr, -XMAX, XMAX);
    if (this.phase === 'countdown') {
      const n = 3 - Math.floor(this.phaseT / 0.75);
      if (n !== this.countShown) { this.countShown = n; this.opts.onEvent?.({ type: 'count', n: Math.max(0, n) }); }
      if (this.phaseT >= 2.25) {
        this.phase = 'playing';
        this.phaseT = 0;
        const real = this.track.ref?.climb;
        const mate = this.opps.find((o) => o.role === 'mate');
        this.opts.onEvent?.({
          type: 'banner',
          title: real ? real.name : 'Schlussanstieg',
          sub: real?.grad ? `Die letzten ${MOUNTAIN_TOP} m · Ø ${real.grad.toLocaleString('de-DE')} %` : `${MOUNTAIN_TOP} m bis zum Gipfel`,
        });
        if (mate && this.opts.mate) this.mateIntro = 4;
      }
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
      q.life -= dr; q.z += q.vz * dr; q.x += q.vx * dr; q.h += q.vh * dr;
      q.vh -= 2.5 * dr; q.vx *= 0.98; q.rot += dr * 8;
    }
    this.parts = this.parts.filter((q) => q.life > 0);
    for (const pp of this.popups) pp.age += dr;
    this.popups = this.popups.filter((pp) => pp.age < pp.life);
    this.shake = Math.max(0, this.shake - dr * 3);
    if (this.phase === 'playing' && this.finT >= 0 && this.time - this.finT > 2.6) this.finish();
    this.track.trim(Math.floor(this.p.z / SEG) - 200);
  }

  hud(): BergHud {
    const ahead = this.wheelAhead(this.p.z, this.p.x, 12);
    const seg = this.track.segAt(this.p.z);
    return {
      place: this.place(),
      riders: this.riders,
      toTop: Math.round(MOUNTAIN_TOP - this.p.z),
      toGo: Math.max(0, Math.round(MOUNTAIN_FINISH - this.p.z)),
      kmh: Math.round(this.p.v * 3.6),
      energy: this.energy,
      draft: this.draft,
      grade: Math.round(seg.grade * 1000) / 10,
      stage: BergRace.stageAt(this.p.z),
      mode: this.mode,
      touch: this.steer.active ? { x: this.steer.sx, y: this.steer.sy } : null,
      lead: this.lead(),
      ahead: ahead?.name ?? null,
      board: standings(this.opps, this.p, this.finT),
      mate: this.mateInfo(),
    };
  }

  private letMateBy(): boolean {
    const m = this.opps.find((o) => o.role === 'mate' && !o.peeled);
    if (!m || m.mateLead === false || (m.swapT ?? 0) <= 0) return false;
    const gap = m.z - this.p.z;
    return gap > -8 && gap < 1.7;
  }

  private mateInfo(): BergHud['mate'] {
    const m = this.opps.find((o) => o.role === 'mate');
    if (!m || m.peeled || BergRace.stageAt(this.p.z) !== 'climb' || this.phase !== 'playing') return null;
    return { name: m.name, front: m.mateLead !== false };
  }

  /** Führung mit dem Helfer tauschen: er lässt dich vorbei (du machst das Tempo) oder geht wieder nach vorn */
  swapMate() {
    const m = this.opps.find((o) => o.role === 'mate' && !o.peeled);
    if (!m || this.phase !== 'playing' || BergRace.stageAt(this.p.z) !== 'climb') return;
    m.mateLead = m.mateLead === false;
    m.swapT = 6;
  }

  /** Abstand zur Spitze in Sekunden (vorn: Vorsprung auf den Zweiten als negative Zahl) */
  private lead(): { name: string; gap: number } | null {
    if (this.finT >= 0) return null;
    let first: Racer | null = null;
    for (const o of this.opps) if (!o.done && (!first || o.z > first.z)) first = o;
    if (!first) return null;
    if (this.p.z >= first.z) return { name: 'Du', gap: -(this.p.z - first.z) / Math.max(4, first.v) };
    return { name: first.name, gap: (first.z - this.p.z) / Math.max(4, this.p.v) };
  }

  /** aktueller Platz (nach dem Ziel: Platz beim Überqueren der Linie) */
  place(): number {
    if (this.finT >= 0) return 1 + this.opps.filter((o) => o.done && o.finT < this.finT).length;
    return 1 + this.opps.filter((o) => o.z > this.p.z).length;
  }

  // ------------------------------------------------------------ gemeinsame Helfer

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
    const s = this.stats;
    const seg = this.track.segAt(p.z);
    const grade = seg.grade;
    const stage = BergRace.stageAt(p.z);
    const racing = this.phase === 'playing' && this.finT < 0;
    const go = racing && (this.wantGo || this.keys.up);
    const ease = racing && !go && (this.wantEase || this.keys.down);
    this.mode = go ? 'go' : ease ? 'ease' : 'sit';
    const dr = this.draftFor(p.z, p.x);
    this.draft += (dr - this.draft) * Math.min(1, dt * 6);
    const wheel = this.wheelAhead(p.z, p.x, 12);
    const empty = this.energy <= 0.001;
    let P = 0;
    let B = 0;
    let posture = 1;
    let standTarget = 0;
    if (!racing) {
      // Countdown (rollend am Berg) und Auslauf nach dem Ziel
      const vd = this.finT >= 0 ? 8 : this.v0;
      P = clamp(powerTo(vd, p.v, grade, CDA), 0, 9);
      if (p.v > vd + 1) B = 2;
    } else if (stage === 'descent') {
      // geduckt schneller, aber ohne Bremshilfe; sonst bremst die Hilfe vor Kurven aufs fahrbare Tempo
      // Bremshilfe mit etwas Reserve zur Haftgrenze (0,8 g)
      const vSafe = this.safeSpeed(p.z, ASSIST_G * G * s.desc);
      // geduckt: viel weniger Luftwiderstand und aus den Kurven heraus voll antreten – schnell auf Tempo
      posture = go ? 0.5 : 0.88;
      if (go) P = p.v < 19 ? s.cp + s.kick * 0.9 : 0;
      else if (p.v < 11) P = s.cp * 0.75;
      if (ease) B = 6.5;
      else if (!go) B = clamp((p.v - vSafe * 0.97) * 2.5, 0, 6.5);
      if (B > 0.5) posture = 1.1;
    } else {
      // bergauf und Zielsprint: am Hinterrad bleiben (bis etwas über der Dauerleistung), antreten, Tempo raus
      const final = stage === 'final';
      if (go) { P = s.cp + s.kick * (final ? 1.8 : 1); standTarget = 1; posture = 1.08; }
      else if (ease) P = s.cp - 0.9;
      else if (wheel && wheel.z - p.z < 9) {
        const vd = clamp(wheel.v + (wheel.z - p.z - 1.8) * 0.8, wheel.v - 1.2, wheel.v + 1.2);
        P = Math.min(powerTo(vd, p.v, grade, CDA * (1 - 0.35 * this.draft)), s.cp + 0.7);
        // hinter einem, der nicht mehr mitkommt (abgefallener Helfer, Abgehängter): von selbst vorbei
        if (!this.steer.active && wheel.z - p.z < 6 && this.losing(wheel, speedAt(s.cp * 0.98, grade, CDA))) this.passWheel();
      } else P = final ? s.cp * 0.92 : s.cp * 0.98;
      if (empty) P = Math.min(P, s.cp * 0.92);
      // Helfer soll wieder nach vorn: kurz Tempo raus, damit er vor dich kommt
      if (!go && !final && this.letMateBy()) P = Math.min(P, s.cp * 0.86);
      P = Math.max(0, P);
    }
    this.stand += (standTarget - this.stand) * Math.min(1, dt * 6);
    const aero = CDA * posture * (1 - 0.35 * this.draft);
    const a = P / Math.max(p.v, 2.5) - resist(p.v, grade, aero) - B;
    p.v = clamp(p.v + a * dt, 0, 30);
    // nicht auffahren: hinter dem Vordermann bleiben
    const front = this.wheelAhead(p.z, p.x, 1.7);
    if (front && p.v > front.v - Math.max(0, 1.5 - (front.z - p.z)) * 2) p.v = Math.max(0, front.v - Math.max(0, 1.5 - (front.z - p.z)) * 2);
    const z0 = p.z;
    p.z += p.v * dt;
    p.y = this.track.heightAt(p.z);
    // Kraft: über der Dauerleistung leert sich der Vorrat, darunter füllt er sich wieder
    if (racing) {
      // bergauf kostet alles über der Dauerleistung den Spieler deutlich mehr (Kraft einteilen!), Erholung ist langsam
      const push = stage === 'climb' ? PUSH_COST : 1;
      // bergab kostet Ducken (und das Antreten aus den Kehren) keine Kraft – dort erholt man sich
      const Pe = stage === 'descent' ? Math.min(P, s.cp * 0.6) : P;
      if (Pe > s.cp) this.energy -= ((Pe - s.cp) * push / WJ) * dt;
      else this.energy += ((s.cp - Pe) / WJ) * (stage === 'climb' ? 0.35 : 0.55) * dt;
      this.energy = clamp(this.energy, 0, 1);
      this.emptyT = this.energy <= 0.001 ? this.emptyT + dt : 0;
      if (this.emptyT > 0.2 && !this.flags.has('empty')) {
        this.flags.add('empty');
        this.pop('Am Limit!', 'red', 'Kraft ist alle', true);
        this.opts.onEvent?.({ type: 'banner', title: 'Am Limit', sub: 'Daumen runter zum Erholen', tone: 'red' });
      }
      if (this.energy > 0.3) this.flags.delete('empty');
      this.topV = Math.max(this.topV, p.v);
    }
    this.lateral(dt, stage === 'descent' && racing);
    // Pedale: Trittfrequenz in Echtzeit (der Zeitraffer soll nicht hektisch wirken); bergab rollen
    if (stage === 'descent' && P === 0) p.pedal += (0 - Math.sin(p.pedal) * 2) * dt;
    else p.pedal += (Math.min(9.5, 3.2 + p.v * 0.95) * dt) / this.warp;
    p.tuck += ((stage === 'descent' ? (posture < 0.7 ? 1 : 0.45) : stand(this.stand)) - p.tuck) * Math.min(1, dt * 5);
    p.brake += (clamp(B / 6.5, 0, 1) - p.brake) * Math.min(1, dt * 8);
    p.stand = this.stand;
    if (racing) this.callouts(z0, stage);
    // Gipfel und Ziel
    if (this.topT < 0 && z0 < MOUNTAIN_TOP && p.z >= MOUNTAIN_TOP) this.summit();
    if (this.finT < 0 && p.z >= MOUNTAIN_FINISH) {
      this.finT = this.time - (p.z - MOUNTAIN_FINISH) / Math.max(1, p.v);
      const pl = this.place();
      if (pl === 1) { this.pop('Sieg!', 'gold', 'Etappensieg', true); this.confetti(); }
      else this.pop(`${pl}. Platz`, pl <= 3 ? 'gold' : 'white', undefined, true);
    }
  }

  /** Spieler: auf eine freie Nachbarspur, um einen Langsamen zu überholen */
  private passWheel() {
    const p = this.p;
    for (const dx of p.x >= 0 ? [-0.95, 0.95] : [0.95, -0.95]) {
      const nx = p.x + dx;
      if (Math.abs(nx) > XMAX + 0.01) continue;
      const busy = this.opps.some((m) => Math.abs(m.x - nx) < 0.6 && m.z - p.z > -2.2 && m.z - p.z < 5);
      if (!busy) { this.tx = nx; return; }
    }
  }

  /** seitlich: bergauf direkt zum Daumen, bergab mit Fliehkraft und Haftgrenze */
  private lateral(dt: number, physical: boolean) {
    const p = this.p;
    const seg = this.track.segAt(p.z);
    this.txs += (this.tx - this.txs) * Math.min(1, dt * 12);
    let nx: number;
    if (physical) {
      const grip = GRIP_G * G * this.stats.desc;
      const ac = seg.curve * p.v * p.v;
      const want = clamp(46 * (this.txs - p.x) - 13.5 * p.vx, -7, 7);
      const arel = clamp(want, -grip - ac, grip - ac);
      p.vx += arel * dt;
      nx = p.x + p.vx * dt;
      p.lean += (clamp(Math.atan2(ac + arel * 0.4, G) * 0.85, -0.6, 0.6) - p.lean) * Math.min(1, dt * 3.5);
    } else {
      const want = clamp((this.txs - p.x) * 5, -2.4, 2.4);
      nx = p.x + want * dt;
      p.vx = want;
      p.lean += (clamp(-want * 0.12 + Math.atan2(seg.curve * p.v * p.v, G) * 0.8, -0.4, 0.4) - p.lean) * Math.min(1, dt * 6);
    }
    // nicht in einen Nebenmann hinein
    for (const o of this.opps) {
      if (Math.abs(o.z - p.z) > 1.5) continue;
      if (Math.abs(nx - o.x) < 0.58 && Math.abs(nx - o.x) < Math.abs(p.x - o.x)) { nx = p.x; p.vx *= -0.3; }
    }
    // rausgerutscht: über den Rand hinaus → Tempo weg, zurück auf die Straße
    this.slideCool -= dt;
    if (Math.abs(nx) > ROAD_HALF + 0.3) {
      const sg = Math.sign(nx);
      nx = sg * (ROAD_HALF - 0.5);
      p.vx = 0;
      this.tx = nx;
      this.txs = nx;
      if (this.slideCool <= 0) {
        this.slideCool = 2;
        this.slides += 1;
        p.v = Math.min(p.v, 5);
        p.wobble = 1;
        this.shake = 0.8;
        this.pop('Abgerutscht!', 'red', 'Vor der Kehre loslassen', true);
        for (let i = 0; i < 10; i++) this.dust(p.z, nx);
      }
    } else if (!physical) nx = clamp(nx, -XMAX, XMAX);
    p.x = nx;
    p.wobble = Math.max(0, p.wobble - dt * 1.5);
  }

  private summit() {
    this.topT = this.time;
    const before = this.opps.filter((o) => o.topT >= 0).length;
    const gpm = before + 1;
    if (gpm === 1) {
      this.pop('Bergwertung!', 'gold', `${this.track.summit.name} · +${GPM_PTS[0]}`, true);
      this.opts.onEvent?.({ type: 'banner', title: `Gipfel: ${this.track.summit.name}`, sub: 'Du holst die Bergwertung!', tone: 'gold' });
    } else {
      const first = this.opps.filter((o) => o.topT >= 0).sort((a, b) => a.topT - b.topT)[0];
      this.opts.onEvent?.({ type: 'banner', title: `Gipfel: ${this.track.summit.name}`, sub: `Bergwertung: ${first?.name ?? '–'} · du als ${gpm}.`, tone: gpm <= 3 ? 'gold' : undefined });
    }
  }

  private callouts(z0: number, stage: BergStage) {
    const p = this.p;
    const once = (key: string, f: () => void) => { if (!this.flags.has(key)) { this.flags.add(key); f(); } };
    const toTop = MOUNTAIN_TOP - p.z;
    if (this.mateIntro > 0) {
      this.mateIntro -= SUB;
      if (this.mateIntro <= 0) {
        const mate = this.opps.find((o) => o.role === 'mate' && !o.peeled);
        if (mate) this.opts.onEvent?.({ type: 'banner', title: `${lastName(mate.name)} macht das Tempo`, sub: 'Bleib an seinem Hinterrad und spar Kraft' });
      }
    }
    // Taktik: ein Favorit vor dir ist am Ende seiner Kraft – Moment zum Kontern
    if (stage === 'climb' && this.limitCues < 2 && this.time - this.lastCue > 6) {
      for (const o of this.opps) {
        // hat angegriffen, ist jetzt deutlich leerer als du und kommt zurück (oder ist ganz leer)
        const dz = o.z - this.p.z;
        const spent = o.w < 0.06 || (o.attacked && o.attackT <= 0 && o.w < this.energy - 0.22 && o.v < this.p.v - 0.15);
        if (o.role !== 'fav' || !spent || o.done) continue;
        if (dz < 1.5 || dz > 45 || this.flags.has(`limit:${o.id}`)) continue;
        this.flags.add(`limit:${o.id}`);
        this.limitCues += 1;
        this.lastCue = this.time;
        this.opts.onEvent?.({ type: 'banner', title: `${lastName(o.name)} ist am Limit`, sub: this.energy > 0.3 ? 'Jetzt kontern – Daumen hoch!' : 'Bleib dran, er wird langsamer', tone: 'accent' });
        break;
      }
    }
    if (toTop < 300 && toTop > 0) once('300', () => this.opts.onEvent?.({ type: 'banner', title: 'Noch 300 m bis zum Gipfel', sub: 'Bergwertung: Punkte für die ersten drei' }));
    if (stage === 'descent') once('down', () => this.opts.onEvent?.({ type: 'banner', title: 'Abfahrt!', sub: 'Daumen hoch = ducken · vor Kehren loslassen', tone: 'accent' }));
    const toGo = MOUNTAIN_FINISH - p.z;
    if (toGo < 1000) once('1k', () => this.opts.onEvent?.({ type: 'banner', title: 'Flamme Rouge', sub: 'Letzter Kilometer', tone: 'red' }));
    if (stage === 'final') once('final', () => this.opts.onEvent?.({ type: 'banner', title: 'Zielsprint', sub: 'Daumen hoch – alles raus!', tone: 'accent' }));
    void z0;
  }

  // ------------------------------------------------------------ Gegner

  private stepRacers(dt: number) {
    const roll = this.phase === 'countdown';
    for (const o of this.opps) {
      const seg = this.track.segAt(o.z);
      const grade = seg.grade;
      const stage = BergRace.stageAt(o.z);
      const toTop = MOUNTAIN_TOP - o.z;
      const toGo = MOUNTAIN_FINISH - o.z;
      const empty = o.w <= 0.001;
      o.driftT -= dt;
      if (o.driftT <= 0) { o.driftT = between(this.rng, 2, 5); o.drift = between(this.rng, -0.12, 0.12); }
      const dr = this.draftFor(o.z, o.x, o);
      const wheel = this.wheelAhead(o.z, o.x, 10, o);
      let P = 0;
      let B = 0;
      let posture = 1;
      let standTarget = 0;
      if (roll || o.done) {
        const vd = o.done ? 8 : this.v0;
        P = clamp(powerTo(vd, o.v, grade, CDA), 0, 9);
        if (o.v > vd + 1) B = 2;
      } else if (stage === 'climb') {
        const own = o.cp * 1.0 + o.drift;
        if (o.role === 'mate' && !o.peeled) {
          const gap = o.z - this.p.z;
          if (o.z >= o.peel || empty) {
            o.peeled = true;
            o.tx = o.x >= 0 ? XMAX : -XMAX;
            if (gap > -3 && gap < 15) this.opts.onEvent?.({ type: 'banner', title: `${lastName(o.name)} ist fertig`, sub: 'Danke, Helfer – ab jetzt fährst du selbst' });
          } else {
            o.swapT = Math.max(0, (o.swapT ?? 0) - dt);
            // fährst du (angreifend) an ihm vorbei, übernimmst du die Führung – er hängt sich an dein Hinterrad
            if (o.mateLead !== false && gap < -1 && this.mode === 'go' && (o.swapT ?? 0) <= 0) o.mateLead = false;
            if (o.mateLead !== false) {
              // gleichmäßig hohes Tempo vor dir; reißt du ab, wartet er; ist er hinter dir, kommt er an dir vorbei nach vorn
              let pace = 6.1 + 0.35 * clamp(o.z / MOUNTAIN_TOP, 0, 1);
              if (gap > 4) pace = Math.min(pace, powerTo(this.p.v + 0.15, o.v, grade, CDA));
              else if (gap < 0.8) {
                // an dir vorbei nach vorn: neben dich (freiere Seite), dann wieder vor dich
                pace = o.cp + 1.2;
                if (Math.abs(this.p.x - o.x) < 0.65) {
                  const busy = (x: number) => this.opps.filter((m) => m !== o && Math.abs(m.x - x) < 0.6 && m.z - o.z > -2 && m.z - o.z < 5).length;
                  const sides = [this.p.x + 0.72, this.p.x - 0.72].filter((x) => Math.abs(x) <= XMAX).sort((a, b) => busy(a) - busy(b));
                  if (sides.length) o.tx = sides[0];
                }
              }
              P = clamp(pace, 0, o.cp + 1.4);
              if (Math.abs(this.p.x - o.x) > 0.3 && gap > 1.2) o.tx = this.p.x;
            } else if (gap > -1.6) {
              // dich vorbeilassen: zur Seite und kurz Tempo raus
              P = o.cp * 0.72;
              if (Math.abs(this.p.x - o.x) < 0.6) this.changeLane(o);
            } else {
              // an deinem Hinterrad: du bestimmst das Tempo
              P = this.follow(o, this.p, grade, dr, o.cp + 1.0);
              if (gap > -6) o.tx = this.p.x;
            }
          }
        } else if (o.role === 'helper' && !o.peeled) {
          if (o.z >= o.peel || empty) {
            o.peeled = true;
            o.tx = o.x >= 0 ? XMAX : -XMAX;
          }
          // Helfer vorn machen das Tempo (steigt zum Gipfel hin), die anderen bleiben am Hinterrad
          const pace = 6.15 + 0.4 * clamp(o.z / MOUNTAIN_TOP, 0, 1);
          if (wheel && wheel.z - o.z < 9) P = this.follow(o, wheel, grade, dr, o.cp + 0.5);
          else P = pace;
        } else if (o.peeled) {
          P = o.cp * 0.8;
        } else {
          // Angriff nach Plan, wenn noch Kraft da ist
          if (o.attackAt > 0 && toTop < o.attackAt && toTop > 40) {
            const ok = o.w > 0.35 && this.time - this.lastAttack > 5;
            if (ok) this.attack(o);
            else if (toTop < o.attackAt - 120) o.attackAt = 0;
          }
          if (o.attackT > 0) {
            o.attackT -= dt;
            P = o.cp + o.kick;
            standTarget = 1;
            posture = 1.08;
          } else if (o.hold > 0 && o.w > o.hold) {
            P = o.cp + 0.5;
          } else {
            if (o.hold > 0) o.hold = 0;
            const cap = o.chaseT > 0 ? o.cp + o.kick * 0.9 : o.cp + 0.8;
            if (o.chaseT > 0) o.chaseT -= dt;
            if (wheel && wheel.z - o.z < 9) {
              P = this.follow(o, wheel, grade, dr, cap);
              // hinter einem, der nicht mehr mitkommt (abgefallen, leer, Lücke nach vorn): vorbei –
              // sonst bleibt man brav in der Reihe (kein Gewusel)
              if (wheel.z - o.z < 5 && this.losing(wheel, speedAt(own, grade, CDA))) { this.changeLane(o); P = Math.max(P, own); }
            } else {
              // allein: eigenes Tempo – oder, wenn eine Attacke läuft, hinterher
              const target = this.ahead(o, 70);
              P = o.chaseT > 0 && target ? o.cp + o.kick * 0.6 : own;
            }
            if (o.chaseT > 0) standTarget = 0.6;
          }
        }
        if (empty) P = Math.min(P, o.cp * 0.92);
      } else if (stage === 'descent') {
        const vSafe = this.safeSpeed(o.z, ASSIST_G * G * o.desc) * o.nerve;
        const straightAhead = vSafe > 25;
        posture = straightAhead ? 0.64 : 0.88;
        if (o.v < 11) P = o.cp * 0.75;
        B = clamp((o.v - vSafe) * 2.5, 0, 6.5);
        if (wheel && wheel.z - o.z < 5 && wheel.v < o.v) {
          // dicht dran und schneller: vorbei, sonst mitrollen
          this.changeLane(o);
        }
        if (B > 0.5) posture = 1.1;
      } else {
        // Zielsprint
        if (toGo < o.launch && toGo > -5 && o.w > 0.05) { P = o.cp + o.kick * 1.6; standTarget = 1; posture = 1.08; }
        else if (wheel && wheel.z - o.z < 9) P = this.follow(o, wheel, grade, dr, o.cp + 0.8);
        else P = o.cp * 0.95;
        if (empty) P = Math.min(P, o.cp * 0.92);
        if (wheel && wheel.z - o.z < 3.2 && toGo < o.launch) this.changeLane(o);
      }
      o.stand += (standTarget - o.stand) * Math.min(1, dt * 6);
      const aero = CDA * posture * (1 - 0.35 * dr);
      const a = P / Math.max(o.v, 2.5) - resist(o.v, grade, aero) - B;
      o.v = clamp(o.v + a * dt, 0, 30);
      // Kraft
      if (!roll && !o.done) {
        if (P > o.cp) o.w -= ((P - o.cp) / WJ) * dt;
        else o.w += ((o.cp - P) / WJ) * 0.55 * dt;
        o.w = clamp(o.w, 0, 1);
      }
      // nicht auffahren
      const front = this.wheelAhead(o.z, o.x, 1.7, o);
      if (front) o.v = Math.min(o.v, front.v - Math.max(0, 1.5 - (front.z - o.z)) * 2);
      o.v = Math.max(0, o.v);
      const z0 = o.z;
      o.z += o.v * dt;
      if (o.topT < 0 && z0 < MOUNTAIN_TOP && o.z >= MOUNTAIN_TOP) {
        o.topT = this.time;
        if (this.topT < 0 && !this.flags.has('gpm')) {
          this.flags.add('gpm');
          this.pop(`${o.name.split(' ').pop()} holt die Bergwertung`, 'muted', undefined, false, true);
        }
      }
      if (!o.done && z0 < MOUNTAIN_FINISH && o.z >= MOUNTAIN_FINISH) { o.done = true; o.finT = this.time - (o.z - MOUNTAIN_FINISH) / Math.max(1, o.v); }
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
      o.lean += (clamp(-o.vx * 0.12 + Math.atan2(seg.curve * o.v * o.v, G) * 0.8, -0.55, 0.55) - o.lean) * Math.min(1, dt * 6);
      if (stage === 'descent' && P === 0) o.pedal += (0 - Math.sin(o.pedal) * 2) * dt;
      else o.pedal += (Math.min(9.5, 3.2 + o.v * 0.95) * dt) / this.warp;
      o.tuck += ((stage === 'descent' ? (posture < 0.7 ? 1 : 0.45) : stand(o.stand)) - o.tuck) * Math.min(1, dt * 5);
      o.brake += (clamp(B / 6.5, 0, 1) - o.brake) * Math.min(1, dt * 8);
    }
  }

  /** reißt dieser Fahrer gerade ab? (abgefallener Helfer, Kraft leer, Lücke nach vorn und zu langsam) */
  private losing(w: { z: number; x: number; v: number }, vOwn: number): boolean {
    if (w === this.p) return this.p.v < vOwn - 0.6;
    const r = w as Racer;
    if (r.peeled || r.w < 0.04) return true;
    const front = this.wheelAhead(r.z, r.x, 30, r);
    return (!front || front.z - r.z > 3.5) && r.v < vOwn - 0.35;
  }

  /** Leistung, um am Hinterrad zu bleiben – höchstens cap */
  private follow(o: Racer, wheel: { z: number; v: number }, grade: number, dr: number, cap: number): number {
    const vd = clamp(wheel.v + (wheel.z - o.z - 1.8) * 0.8, wheel.v - 1.2, wheel.v + 1.2);
    return clamp(powerTo(vd, o.v, grade, CDA * (1 - 0.35 * dr)), 0, cap);
  }

  /** nächster Fahrer (beliebige Spur) bis dist m vor o, auch der Spieler */
  private ahead(o: Racer, dist: number): boolean {
    if (this.p.z > o.z && this.p.z - o.z < dist) return true;
    return this.opps.some((m) => m !== o && m.z > o.z && m.z - o.z < dist);
  }

  /** Attacke: raus aus der Reihe, Vollgas; wer dicht dahinter ist, entscheidet, ob er mitgeht */
  private attack(o: Racer) {
    o.attackAt = 0;
    o.attacked = true;
    o.attackT = between(this.rng, 8, 12);
    o.hold = between(this.rng, 0.1, 0.2);
    this.lastAttack = this.time;
    this.attacks += 1;
    this.changeLane(o);
    for (const m of this.opps) {
      if (m === o || m.role === 'helper' || m.role === 'mate' || m.peeled) continue;
      const near = o.z - m.z;
      if (near < -4 || near > 35) continue;
      const p = clamp(0.5 + (m.cp - 6.1) * 1.4 + (m.w - 0.5) * 0.7, 0.15, 0.95);
      if (chance(this.rng, p)) m.chaseT = between(this.rng, 9, 14);
    }
    const near = Math.abs(o.z - this.p.z) < 60;
    if (near && this.attacks <= 3) {
      this.opts.onEvent?.({ type: 'banner', title: `Attacke: ${o.name}!`, sub: this.attacks === 1 ? 'Daumen hoch zum Mitgehen' : undefined, tone: 'red' });
    }
  }

  /** auf eine freie Nachbarspur ausweichen */
  private changeLane(o: Racer) {
    for (const dx of o.x >= 0 ? [-0.95, 0.95] : [0.95, -0.95]) {
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
    const second = all[1];
    const gpmPlace = this.topT >= 0 ? 1 + this.opps.filter((o) => o.topT >= 0 && o.topT < this.topT).length : this.riders;
    const placePts = place <= PLACE_PTS.length ? PLACE_PTS[place - 1] : Math.max(60, 180 - 10 * (place - 11));
    const gpmPts = gpmPlace <= GPM_PTS.length ? GPM_PTS[gpmPlace - 1] : 0;
    // Vorsprung als Sieger: je Sekunde Punkte (der Zweite ist evtl. noch nicht im Ziel → Abstand schätzen)
    let lead = 0;
    if (place === 1) {
      if (second && !second.me) lead = second.t - this.finT;
      else {
        const next = this.opps.filter((o) => !o.done).sort((a, b) => b.z - a.z)[0];
        lead = next ? (this.finT >= 0 ? (MOUNTAIN_FINISH - next.z) / Math.max(4, next.v) + (this.time - this.finT) : 0) : 0;
      }
    }
    const gapPts = place === 1 ? Math.min(300, Math.round(Math.max(0, lead) * 25)) : 0;
    const base = placePts + gpmPts + gapPts;
    const typePts = Math.round(base * (this.stats.bonus - 1));
    this.opts.onOver?.({
      place, riders: this.riders,
      score: base + typePts,
      parts: { place: placePts, gpm: gpmPts, gap: gapPts, type: typePts },
      winner: win.me ? this.opts.rider.name : win.name,
      gap: place === 1 ? -Math.max(0, lead) : Math.max(0, this.finT - win.t),
      topKmh: Math.round(this.topV * 3.6),
      gpmPlace,
      slides: this.slides,
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
    this.popups.push({ text, sub, tone, side, slot, age: 0, life: big ? 2.2 : small ? 1.1 : 1.5, dx: 0.5, dy: 0.5, big });
  }
}

/** Haltung bergauf: im Wiegetritt etwas flacher (für das Fahrermodell) */
function stand(s: number): number { return 0.15 * s; }

