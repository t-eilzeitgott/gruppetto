/**
 * Geister für Abfahrt, Sprint- und Bergfinale: die beste Fahrt des Tages je Mitglied fährt halbdurchsichtig mit.
 *
 * Wie im Zeitfahren (siehe tt.ts): Die Fahrspur ist alle TRACE_DT Sekunden Rennzeit Streckenmeter ×10, seitliche
 * Lage in cm und Haltung (0 rollen, 1 drücken, 2 bremsen/erholen). Die Rennzeit zählt ab „Los“ in der Spielzeit des
 * Spiels (mit dessen Zeitraffer) – so fährt der Geist auf jedem Gerät genau dort, wo er damals war.
 *
 * Geister sind keine Gegner: Sie stehen in einer eigenen Liste (RaceView.ghosts), kein Windschatten, kein Rempeln,
 * keine Plätze. Ein Namensschild zeigt den nächsten Geist voraus.
 */
import type { Opp, Player, RiderTag } from './engine';
import { hashStr } from './rng';
import { SKINS, type Kit } from './rider';
import { pedalStep } from './motion';
import type { Track } from './track';
import { TRACE_DT, firstName, ghostAt, type GhostRider } from '../tt';

const G = 9.81;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Deckkraft der Geister */
const ALPHA = 0.42;
/** längste Spur (Stützpunkte): 30 Minuten Rennzeit */
const MAX_SAMPLES = 7200;
/** Ids der Geister im Renderer (getrennt von den Gegnern) */
const ID_BASE = 7000;

interface GhostOpp extends Opp {
  ghost: number;
  rider: GhostRider;
  m: number;
  /** Rennzeit am Ende der Spur (s) */
  end: number;
}

export class GhostField {
  /** halbdurchsichtige Fahrer für den Renderer */
  readonly list: GhostOpp[] = [];
  /** Namensschild des nächsten Geistes voraus (oder null) */
  tag: RiderTag | null = null;
  /** Rennzeit seit „Los“ (s) */
  private t = 0;
  private acc = 0;
  private trace: number[] = [];
  private pos = { z: 0, x: 0, m: 0 };

  constructor(riders: GhostRider[], private label: (g: GhostRider) => string = defaultLabel) {
    riders.forEach((g, i) => {
      if (g.trace.length < 6) return;
      ghostAt(g.trace, 0, this.pos);
      const skin = SKINS[hashStr(g.id) % SKINS.length];
      const kit: Kit = { jersey: g.color, side: '#ffffff', helmet: '#ffffff', shorts: '#16171a', skin, shoes: '#ffffff', number: String(i + 1), bike: g.bike };
      this.list.push({
        id: ID_BASE + i, z: this.pos.z, x: this.pos.x, vx: 0, v: 0, tx: this.pos.x, f: 1, kit,
        pedal: hashStr(g.id) % 6, lean: 0, tuck: 0.6, brake: 0, passed: false, group: -1, bump: 0, attacker: false, stand: 0,
        ghost: 0, rider: g, m: 0, end: (Math.floor(g.trace.length / 3) - 1) * TRACE_DT,
      });
    });
  }

  /** neue Fahrt: Spur leeren, Geister zurück an den Start */
  reset() {
    this.t = 0;
    this.acc = 0;
    this.trace = [];
    this.tag = null;
    for (const o of this.list) {
      ghostAt(o.rider.trace, 0, this.pos);
      o.z = this.pos.z; o.x = this.pos.x; o.v = 0; o.vx = 0; o.ghost = 0;
    }
  }

  /**
   * ein Schritt (dt: Spielzeit dieses Bildes, s). playing: das Rennen läuft (die eigene Spur wird aufgezeichnet,
   * die Geister fahren); me: eigene Lage und Haltung; done: eigene Fahrt ist vorbei (Ziel oder Sturz).
   */
  step(dt: number, playing: boolean, me: { z: number; x: number; mode: number }, track: Track, done = false) {
    if (playing) {
      this.t += dt;
      if (!done) {
        this.acc += dt;
        while (this.acc >= TRACE_DT) {
          this.acc -= TRACE_DT;
          if (this.trace.length < MAX_SAMPLES * 3) this.trace.push(Math.round(Math.max(0, me.z) * 10), Math.round(me.x * 100), me.mode);
        }
      }
    }
    let tagged: GhostOpp | null = null;
    for (const o of this.list) {
      ghostAt(o.rider.trace, playing ? this.t : 0, this.pos);
      const z0 = o.z;
      o.z = this.pos.z;
      const nx = this.pos.x;
      o.vx = dt > 0 ? (nx - o.x) / dt : 0;
      o.x = nx;
      o.v = dt > 0 ? Math.max(0, (o.z - z0) / dt) : 0;
      o.m = this.pos.m;
      const seg = track.segAt(o.z);
      const climbing = seg.grade > 0.025;
      const downhill = seg.grade < -0.03;
      // Haltung aus der Spur: drücken bergauf im Wiegetritt, bergab geduckt
      const standT = o.m === 1 && (climbing || o.v < 16) ? 1 : 0;
      o.stand = (o.stand ?? 0) + (standT - (o.stand ?? 0)) * Math.min(1, dt * 6);
      const tuckT = downhill ? (o.m === 2 ? 0.3 : 1) : o.m === 2 ? 0.3 : climbing ? 0.15 * (o.stand ?? 0) : 0.6;
      o.tuck += (tuckT - o.tuck) * Math.min(1, dt * 5);
      o.brake += ((o.m === 2 && downhill ? 0.8 : 0) - o.brake) * Math.min(1, dt * 8);
      o.lean += (clamp(-o.vx * 0.12 + Math.atan2(seg.curve * o.v * o.v, G) * 0.8, -0.55, 0.55) - o.lean) * Math.min(1, dt * 6);
      pedalStep(o, downhill && o.m !== 1 && o.v > 12 ? 0 : Math.min(9.5, 3.2 + o.v * 0.95), dt);
      // sichtbar ab „Los“; nach dem Ende ihrer Fahrt (Ziel oder Sturz) blenden sie aus
      const over = this.t > o.end + 1.2;
      const want = playing && !over ? ALPHA : 0;
      o.ghost += (want - o.ghost) * Math.min(1, dt * 2.5);
      if (o.ghost < 0.01) o.ghost = want > 0 ? 0.01 : 0;
      const dz = o.z - me.z;
      if (playing && !done && !over && dz > 1.5 && dz < 45 && (!tagged || dz < tagged.z - me.z)) tagged = o;
    }
    this.tag = tagged ? { id: tagged.id, text: this.label(tagged.rider), color: tagged.rider.color } : null;
  }

  /** aufgezeichnete eigene Fahrspur */
  get recorded(): number[] { return this.trace.slice(); }
}

/** Haltung für die Spur: 1 drücken (Wiegetritt), 2 bremsen, sonst 0 */
export function ghostMode(p: Player): number {
  return p.brake > 0.3 ? 2 : (p.stand ?? 0) > 0.5 || p.tuck > 0.85 ? 1 : 0;
}

function defaultLabel(g: GhostRider): string {
  return g.me ? 'Dein Bestlauf' : firstName(g.name);
}

/** Namensschild an die Schilder des Spiels hängen (ohne doppelte Ids) */
export function withGhostTag(tags: RiderTag[] | undefined, f: GhostField | null): RiderTag[] {
  const base = tags ?? [];
  if (!f?.tag) return base;
  return [...base.filter((t) => t.id !== f.tag!.id), f.tag];
}
