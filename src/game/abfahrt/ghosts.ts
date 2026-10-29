/**
 * Geister für Abfahrt, Sprint- und Bergfinale: der eigene Lauf und die der Runde als halbdurchsichtige Fahrer,
 * die genau nachfahren, was gefahren wurde (Rennzeit → Streckenmeter und seitliche Lage, wie im Zeitfahren).
 *
 * GhostRecorder schreibt die eigene Fahrspur mit (alle TRACE_DT Sekunden Rennzeit), GhostPack spielt die
 * gespeicherten Spuren ab. Die Geister haben keine Physik und stoßen mit niemandem zusammen – sie stehen nur
 * in der Darstellung (RaceView.ghosts), nicht im Feld der Engine.
 */
import type { Track } from './track';
import type { Opp, RiderTag } from './engine';
import { hashStr } from './rng';
import { SKINS, type Kit } from './rider';
import { pedalStep } from './motion';
import { TRACE_DT, ghostAt, ghostDayLabel, ghostName, ghostTimeAt, type GameGhostRow, type GhostRider } from '../tt';

/** Deckkraft: Geister von heute, ältere (andere Tage, andere Strecke) blasser */
const ALPHA = 0.42;
const ALPHA_OLD = 0.27;
const G = 9.81;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Höchstens so viele Geister in Abfahrt, Sprint und Berg (dort ist das Feld schon voll) */
export const GAME_GHOSTS = 6;

/** Reihenfolge: der eigene Geist, dann die von heute (meiste Punkte zuerst), dann die älteren */
export function pickGameGhosts(rows: GameGhostRow[], meId: string, day: string, colorOf: (id: string) => { name: string; color: string }, max = GAME_GHOSTS): GhostRider[] {
  const latest = new Map<string, GameGhostRow>();
  for (const r of rows) {
    if (r.day > day || r.trace.length < 6) continue;
    const prev = latest.get(r.user_id);
    if (!prev || r.day > prev.day || (r.day === prev.day && r.score > prev.score)) latest.set(r.user_id, r);
  }
  const list = [...latest.values()].sort((a, b) =>
    Number(b.user_id === meId) - Number(a.user_id === meId) || Number(a.day < day) - Number(b.day < day) || b.score - a.score);
  return list.slice(0, max).map((r) => {
    const me = r.user_id === meId;
    const who = colorOf(r.user_id);
    return {
      id: me ? 'me' : r.user_id, name: me ? 'Du' : who.name, color: who.color, bike: r.bike || 'allround',
      timeMs: 0, splits: [], trace: r.trace, me, old: r.day < day ? ghostDayLabel(r.day, day) : undefined,
    };
  });
}

/** Fahrspur des eigenen Laufs: alle TRACE_DT Sekunden Rennzeit Streckenmeter ×10, Lage in cm, Haltung */
export class GhostRecorder {
  trace: number[] = [];
  private t = 0;
  private acc = 0;
  /** Rennzeit des Laufs (s) – startet mit „Los“ */
  get time() { return this.t; }

  reset() { this.trace = []; this.t = 0; this.acc = 0; }

  /** einen Schritt Rennzeit mitschreiben; mode: 0 rollen, 1 drücken/sprinten, 2 erholen/bremsen */
  step(dt: number, z: number, x: number, v: number, mode = 0) {
    if (!this.trace.length) this.push(z, x, mode);
    this.t += dt;
    this.acc += dt;
    while (this.acc >= TRACE_DT) {
      this.acc -= TRACE_DT;
      // genau auf das Raster: um die überzählige Zeit zurückrechnen
      this.push(z - v * this.acc, x, mode);
    }
  }

  private push(z: number, x: number, mode: number) {
    // höchstens etwa 20 Minuten (Speichergrenze der Datenbank)
    if (this.trace.length >= 3 * 4800) return;
    this.trace.push(Math.round(Math.max(0, z) * 10), Math.round(x * 100), mode);
  }
}

/** Geist in der Darstellung: ein Gegner ohne Physik, der seiner Spur folgt */
export interface GhostOpp extends Opp {
  ghost: number;
  rider: GhostRider;
  /** Ende der Spur (s Rennzeit) */
  end: number;
}

export class GhostPack {
  opps: GhostOpp[] = [];
  private pos = { z: 0, x: 0, m: 0 };

  constructor(private track: Track, ghosts: GhostRider[], idBase = 3000) {
    const sorted = [...ghosts].filter((g) => g.trace.length >= 6).sort((a, b) => Number(!!a.old) - Number(!!b.old));
    sorted.forEach((g, i) => {
      ghostAt(g.trace, 0, this.pos);
      const skin = SKINS[hashStr(g.id) % SKINS.length];
      const kit: Kit = { jersey: g.color, side: '#ffffff', helmet: '#ffffff', shorts: '#16171a', skin, shoes: '#ffffff', number: String(i + 1), bike: g.bike };
      this.opps.push({
        id: idBase + i, z: this.pos.z, x: this.pos.x, vx: 0, v: 0, tx: this.pos.x, f: 1, kit,
        pedal: hashStr(g.id) % 6, lean: 0, tuck: 0.5, brake: 0, passed: false, group: -1, bump: 0, attacker: false, stand: 0,
        ghost: 0, rider: g, end: (Math.floor(g.trace.length / 3) - 1) * TRACE_DT,
      });
    });
  }

  get count() { return this.opps.length; }

  /**
   * Geister an die Stelle zur Rennzeit t setzen. visible: ab „Los“ einblenden; nach dem Ende ihrer Spur
   * (Sturz, Ziel) rollen sie kurz aus und verschwinden.
   */
  step(t: number, visible: boolean, dt: number, warp = 1) {
    for (const o of this.opps) {
      ghostAt(o.rider.trace, visible ? t : 0, this.pos);
      const z0 = o.z;
      o.z = this.pos.z;
      const nx = this.pos.x;
      o.vx = dt > 0 ? (nx - o.x) / dt : 0;
      o.x = nx;
      o.v = dt > 0 ? Math.max(0, (o.z - z0) / dt) : 0;
      const seg = this.track.segAt(o.z);
      const climbing = seg.grade > 0.025;
      const downhill = seg.grade < -0.03;
      const push = this.pos.m === 1;
      o.stand = (o.stand ?? 0) + ((push && (climbing || o.v < 16) ? 1 : 0) - (o.stand ?? 0)) * Math.min(1, dt * 6);
      const tuckT = downhill ? (push ? 1 : 0.6) : this.pos.m === 2 ? 0.25 : climbing ? 0.1 : 0.45;
      o.tuck += (tuckT - o.tuck) * Math.min(1, dt * 5);
      o.lean += (clamp(-o.vx * 0.12 + Math.atan2(seg.curve * o.v * o.v, G) * 0.8, -0.55, 0.55) - o.lean) * Math.min(1, dt * 6);
      pedalStep(o, downhill && !push && o.v > 12 ? 0 : Math.min(9.5, 3.2 + o.v * 0.95) / warp, dt);
      const gone = visible && t > o.end + 2.5;
      const want = visible && !gone ? (o.rider.old ? ALPHA_OLD : ALPHA) : 0;
      o.ghost += (want - o.ghost) * Math.min(1, dt * 2.5);
      if (o.ghost < 0.01) o.ghost = want > 0 ? 0.01 : 0;
    }
  }

  /** Namensschild für den nächsten sichtbaren Geist voraus (bis 40 m), mit Zeitabstand an der eigenen Stelle */
  tag(t: number, pz: number): RiderTag | null {
    let best: GhostOpp | null = null;
    for (const o of this.opps) {
      if (o.ghost < 0.1) continue;
      const dz = o.z - pz;
      if (dz > 1.5 && dz < 40 && (!best || dz < best.z - pz)) best = o;
    }
    if (!best) return null;
    const gap = t - ghostTimeAt(best.rider.trace, pz);
    return { id: best.id, text: ghostName(best.rider, true), sub: `${gap >= 0 ? '+' : '−'}${Math.abs(gap).toFixed(1).replace('.', ',')}″`, color: best.rider.color };
  }
}
