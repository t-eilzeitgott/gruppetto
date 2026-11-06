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
import { TRACE_DT, firstName, ghostAt, ghostDayLabel, ghostName, ghostTimeAt, type GameGhostRow, type GhostRider } from '../tt';
import { liveAdvance, liveAt, liveDone, liveEnd, liveSamples, rtAt, type LiveFeed } from '../live';
import { crossOffset, type PhotoRider } from '../photo';

/** Deckkraft: Geister von heute, ältere (andere Tage, andere Strecke) blasser */
const ALPHA = 0.42;
const ALPHA_OLD = 0.27;
/** Live-Geister (fahren gerade) etwas deutlicher */
const ALPHA_LIVE = 0.55;
/** Echtzeit-Gegner im Lobby-Rennen: wie ein Fahrer im Feld */
const ALPHA_SOLID = 1;
/** Mitspieler aus der eigenen Lobby (ohne Echtzeit): fast voll sichtbar */
const ALPHA_MATE = 0.88;
const G = 9.81;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Höchstens so viele Geister in Abfahrt, Sprint und Berg (dort ist das Feld schon voll) */
export const GAME_GHOSTS = 6;

/** Reihenfolge: der eigene Geist, dann die von heute (meiste Punkte zuerst), dann die älteren */
export function pickGameGhosts(rows: GameGhostRow[], meId: string, day: string, colorOf: (id: string) => { name: string; color: string }, max = GAME_GHOSTS, rivalId: string | null = null): GhostRider[] {
  const latest = new Map<string, GameGhostRow>();
  for (const r of rows) {
    if (r.day > day || r.trace.length < 6) continue;
    const prev = latest.get(r.user_id);
    if (!prev || r.day > prev.day || (r.day === prev.day && r.score > prev.score)) latest.set(r.user_id, r);
  }
  // eigener Lauf zuerst, dann der Rivale (fährt immer mit), dann heutige vor älteren, bessere vor schwächeren
  const list = [...latest.values()].sort((a, b) =>
    Number(b.user_id === meId) - Number(a.user_id === meId) || Number(b.user_id === rivalId) - Number(a.user_id === rivalId)
    || Number(a.day < day) - Number(b.day < day) || b.score - a.score);
  return list.slice(0, max).map((r) => {
    const me = r.user_id === meId;
    const who = colorOf(r.user_id);
    return {
      id: me ? 'me' : r.user_id, name: me ? 'Du' : who.name, color: who.color, bike: r.bike || 'allround',
      timeMs: 0, splits: [], trace: r.trace, me, old: r.day < day ? ghostDayLabel(r.day, day) : undefined,
      ...(rivalId && r.user_id === rivalId ? { rival: true } : {}),
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
  /** Echtzeit-Gegner (Lobby-Rennen): steht genau dort, wo der Mitspieler jetzt ist – man kann ihn berühren */
  solid?: boolean;
}

/** Geist für einen, der gerade fährt (live.ts) */
export function liveRider(f: LiveFeed): GhostRider {
  return { id: `live:${f.userId}`, name: f.name, color: f.color, bike: f.bike || 'allround', timeMs: 0, splits: [], trace: f.trace, live: f };
}

/** Trikot eines Geists: Mitspieler fahren als Teamkollegen im gruppetto-Trikot in ihrer Avatarfarbe */
export function ghostKit(g: GhostRider, number: string): Kit {
  const skin = SKINS[hashStr(g.id) % SKINS.length];
  return { jersey: g.color, side: '#1f2a44', helmet: '#1f2a44', shorts: '#1f2a44', skin, shoes: '#ffffff', number, bike: g.bike, team: 'gruppetto' };
}

export class GhostPack {
  opps: GhostOpp[] = [];
  private pos = { z: 0, x: 0, m: 0 };
  private liveId: number;

  constructor(private track: Track, ghosts: GhostRider[], idBase = 3000) {
    this.liveId = idBase + 500;
    const sorted = [...ghosts].filter((g) => g.trace.length >= 6).sort((a, b) => Number(!!a.old) - Number(!!b.old));
    sorted.forEach((g, i) => {
      ghostAt(g.trace, 0, this.pos);
      const kit = ghostKit(g, String(i + 1));
      this.opps.push({
        id: idBase + i, z: this.pos.z, x: this.pos.x, vx: 0, v: 0, tx: this.pos.x, f: 1, kit,
        pedal: hashStr(g.id) % 6, lean: 0, tuck: 0.5, brake: 0, passed: false, group: -1, bump: 0, attacker: false, stand: 0,
        ghost: 0, rider: g, end: (Math.floor(g.trace.length / 3) - 1) * TRACE_DT,
      });
    });
  }

  get count() { return this.opps.length; }

  /**
   * Live-Geister abgleichen (live.ts): wer neu fährt, kommt dazu (unsichtbar, bis seine Uhr läuft); ein neuer Lauf
   * desselben Mitglieds ersetzt die Spur; wer nicht mehr gemeldet wird, rollt aus und verschwindet
   */
  syncLive(feeds: LiveFeed[]) {
    for (const f of feeds) {
      const o = this.opps.find((x) => x.rider.live?.userId === f.userId);
      if (!o) {
        const rider = liveRider(f);
        this.opps.push({
          id: this.liveId++, z: 0, x: 0, vx: 0, v: 0, tx: 0, f: 1, kit: ghostKit(rider, 'L'),
          pedal: hashStr(rider.id) % 6, lean: 0, tuck: 0.5, brake: 0, passed: false, group: -1, bump: 0, attacker: false, stand: 0,
          ghost: 0, rider, end: 0,
        });
      } else if (o.rider.live !== f) {
        o.rider = liveRider(f);
        o.ghost = 0;
      }
    }
    for (const o of this.opps) {
      const f = o.rider.live;
      if (f && !feeds.includes(f)) f.gone = true;
    }
  }

  /**
   * Fotofinish (photo.ts): Geister und Live-Mitspieler, die gerade zu sehen sind – Zielzeit relativ zur eigenen,
   * aus ihrer Lage im Moment des eigenen Zieldurchgangs
   */
  photo(finishZ: number, myZ: number, myV: number): PhotoRider[] {
    return this.opps.filter((o) => o.ghost > 0.05).map((o) => ({
      id: o.rider.id, name: ghostName(o.rider, true), color: o.rider.color, t: crossOffset(finishZ, o.z, o.v, myZ, myV),
      ...(o.rider.live ? { live: true } : { ghost: true }),
    }));
  }

  /** das Spiel rechnet Berührungen mit Mitspielern (Sprint): nur dann werden sie zu echten Gegnern */
  solidOn = false;

  /** Echtzeit-Gegner (Mitspieler im selben Lobby-Rennen, gerade sichtbar): mit ihnen stößt man zusammen */
  solids(): GhostOpp[] {
    this.solidList.length = 0;
    for (const o of this.opps) if (o.solid && o.ghost > 0.3) this.solidList.push(o);
    return this.solidList;
  }
  private solidList: GhostOpp[] = [];

  /** wer gerade Windschatten gibt (Live-Geist, liveDraft) */
  draftBy: string | null = null;

  /**
   * Windschatten hinter Live-Geistern: wer gerade wirklich fährt (live.ts), nimmt einem den Wind wie ein Fahrer im
   * Feld – gespeicherte Geister nicht (die sind nur ein Echo). far: so weit reicht er nach hinten (m), width: so
   * breit (m); Formel wie im Feld der jeweiligen Engine
   */
  liveDraft(z: number, x: number, far: number, width: number): number {
    let d = 0;
    this.draftBy = null;
    for (const o of this.opps) {
      if (!o.rider.live || o.ghost < 0.1) continue;
      const dz = o.z - z;
      if (dz < 0.9 || dz > far) continue;
      const dx = Math.abs(o.x - x);
      if (dx > width) continue;
      const k = Math.pow(1 - (dz - 0.9) / (far - 0.9), 0.7) * (1 - dx / width);
      if (k > d) { d = k; this.draftBy = firstName(o.rider.name); }
    }
    return d;
  }

  /** Live-Geister, die fertig ausgeblendet sind, aus der Liste nehmen (die Darstellung gibt ihr Modell zurück) */
  private dropLive() {
    for (let i = this.opps.length - 1; i >= 0; i--) {
      const f = this.opps[i].rider.live;
      if (f && f.gone && this.opps[i].ghost === 0 && liveDone(f)) this.opps.splice(i, 1);
    }
  }

  /**
   * Geister an die Stelle zur Rennzeit t setzen. visible: ab „Los“ einblenden; nach dem Ende ihrer Spur
   * (Sturz, Ziel) rollen sie kurz aus und verschwinden.
   */
  step(t: number, visible: boolean, dt: number, warp = 1) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    for (const o of this.opps) {
      const f = o.rider.live;
      const z0 = o.z;
      let nx: number;
      let rt = false;
      if (f) {
        // Live: eigene Uhr (wo der andere jetzt ist); kleine Sprünge, wenn eine Meldung die Fortschreibung
        // berichtigt, weich ausgleichen
        const lt = liveAdvance(f, dt, now);
        // Echtzeit (Lobby-Rennen): frische Meldungen schlagen die Spur – dichter dran, schneller nachgeführt
        rt = rtAt(f, now, this.pos);
        if (!rt) liveAt(f, Math.max(0, lt), this.pos);
        const jump = Math.abs(this.pos.z - o.z) > 12 || o.ghost === 0;
        const k = jump ? 1 : Math.min(1, dt * (rt ? 16 : 6));
        let x0 = o.x;
        if (rt && !jump && f.rt) {
          // Echtzeit: erst mit dem gemeldeten Tempo weiterfahren, dann nur den Rest ausgleichen – so hängt die
          // Darstellung nicht um die Glättung hinterher (bei 60 km/h wäre das ein ganzes Rad)
          o.z += f.rt.v * dt;
          x0 += Math.max(-0.2, Math.min(0.2, f.rt.vx * dt));
        }
        o.z += (this.pos.z - o.z) * k;
        nx = x0 + (this.pos.x - x0) * k;
        o.end = liveEnd(f);
      } else {
        ghostAt(o.rider.trace, visible ? t : 0, this.pos);
        o.z = this.pos.z;
        nx = this.pos.x;
      }
      o.vx = dt > 0 ? (nx - o.x) / dt : 0;
      o.x = nx;
      o.v = dt > 0 ? Math.max(0, (o.z - z0) / dt) : 0;
      if (rt && f?.rt) {
        // gemeldetes Tempo statt des aus der Glättung abgeleiteten (ruhiger, wichtig für Berührungen)
        o.v = f.rt.v;
        o.vx = f.rt.vx;
      }
      o.solid = this.solidOn && rt && !!f?.solid && !!f.racing && !f.gone && !f.down;
      const seg = this.track.segAt(o.z);
      const climbing = seg.grade > 0.025;
      const downhill = seg.grade < -0.03;
      const push = this.pos.m === 1;
      o.stand = (o.stand ?? 0) + ((push && (climbing || o.v < 16) ? 1 : 0) - (o.stand ?? 0)) * Math.min(1, dt * 6);
      const tuckT = downhill ? (push ? 1 : 0.6) : this.pos.m === 2 ? 0.25 : climbing ? 0.1 : 0.45;
      o.tuck += (tuckT - o.tuck) * Math.min(1, dt * 5);
      o.lean += (clamp(-o.vx * 0.12 + Math.atan2(seg.curve * o.v * o.v, G) * 0.8, -0.55, 0.55) - o.lean) * Math.min(1, dt * 6);
      pedalStep(o, downhill && !push && o.v > 12 ? 0 : Math.min(9.5, 3.2 + o.v * 0.95) / warp, dt);
      const gone = f ? !rt && (liveDone(f) || f.shown <= 0 || liveSamples(f) < 1) : visible && t > o.end + 2.5;
      const want = visible && !gone ? (o.solid ? ALPHA_SOLID : f?.mate ? ALPHA_MATE : f ? ALPHA_LIVE : o.rider.rival ? ALPHA_LIVE : o.rider.old ? ALPHA_OLD : ALPHA) : 0;
      // aus der eigenen Lobby: hervorheben (Namensschild mit rotem Punkt – render3d.ts)
      if (f && (f.mate || o.solid) && want > 0) {
        if (!o.mark || o.mark.color !== o.rider.color) o.mark = { name: firstName(o.rider.name), color: o.rider.color };
      } else if (o.mark) o.mark = undefined;
      o.ghost += (want - o.ghost) * Math.min(1, dt * 2.5);
      if (o.ghost < 0.01) o.ghost = want > 0 ? 0.01 : 0;
    }
    this.dropLive();
  }

  /** Namensschild für den nächsten sichtbaren Geist voraus (bis 40 m), mit Zeitabstand an der eigenen Stelle */
  tag(t: number, pz: number): RiderTag | null {
    let best: GhostOpp | null = null;
    let rival: GhostOpp | null = null;
    for (const o of this.opps) {
      if (o.ghost < 0.1) continue;
      const dz = o.z - pz;
      if (dz > 1.5 && dz < 40 && (!best || dz < best.z - pz)) best = o;
      // der Rivale hat sein Schild auch etwas weiter vorn und neben einem
      if (o.rider.rival && dz > -6 && dz < 70) rival = o;
    }
    if (rival) best = rival;
    if (!best) return null;
    if (best.rider.live) return { id: best.id, text: ghostName(best.rider, true), sub: 'live', color: best.rider.color };
    const gap = t - ghostTimeAt(best.rider.trace, pz);
    const g = `${gap >= 0 ? '+' : '−'}${Math.abs(gap).toFixed(1).replace('.', ',')}″`;
    return { id: best.id, text: ghostName(best.rider, true), sub: best.rider.rival ? `Rivale · ${g}` : g, color: best.rider.color };
  }

  /** letzte Seite des Rivalen (vor oder hinter einem) und wann zuletzt angesagt */
  private rivalSide = 0;
  private rivalSaid = -99;

  /**
   * Rivale überholt oder wieder vorn? (je Bild; t: Rennzeit) – 'passed', wenn man an ihm vorbei ist, 'lost', wenn er
   * wieder vorn ist; höchstens alle 5 s eine Ansage
   */
  rivalEvent(t: number, pz: number): { kind: 'passed' | 'lost'; name: string } | null {
    const o = this.opps.find((x) => x.rider.rival);
    if (!o || o.ghost < 0.1) { this.rivalSide = 0; return null; }
    const dz = o.z - pz;
    const side = dz > 1 ? 1 : dz < -1 ? -1 : this.rivalSide;
    const was = this.rivalSide;
    this.rivalSide = side;
    if (!was || side === was || t - this.rivalSaid < 5) return null;
    this.rivalSaid = t;
    return { kind: side < 0 ? 'passed' : 'lost', name: firstName(o.rider.name) };
  }
}
