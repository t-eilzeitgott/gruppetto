/**
 * Passbuch: jede Passhöhe, die man in den Minispielen überquert hat, bekommt einen Stempel – wie im
 * Brevet-Heft einer Radreise. Aus den eigenen Läufen (Spiel, Strecke, Tag) lässt sich die Strecke des
 * Tages genau nachbauen (gleicher Tages-Seed), also auch, welche Pässe ein Lauf erreicht hat:
 * in der Abfahrt alle Passhöhen bis zur gefahrenen Strecke, im Bergfinale der Schlussanstieg des Tages.
 */
import type { GameRun } from '../data/source';
import type { Stage } from '../lib/types';
import { MOUNTAIN_TOP, SEG, Track } from './abfahrt/track';
import { berlinDayKey } from './abfahrt/rng';
import { stageRef } from './abfahrt/stageRef';

export interface PassStamp {
  name: string;
  /** Höhe (m ü. NN) */
  alt: number;
  /** wie oft überquert */
  count: number;
  /** erster Tag (YYYY-MM-DD) */
  first: string;
  /** echter Schlussanstieg einer Etappe (Bergfinale) */
  real: boolean;
}

/** Pässe eines Abfahrt-Laufs: Passhöhen, deren Abschnitt innerhalb der gefahrenen Strecke beginnt */
function descentPasses(track: Track, meters: number): { name: string; alt: number }[] {
  const last = Math.max(0, Math.floor(meters / SEG));
  track.seg(last);
  // (Abfahrt mit Startort: der Ort auf der Passhöhe zählt als Pass – gleicher Name wie die Kehre danach, nur einmal)
  const out = new Map<string, { name: string; alt: number }>();
  for (const s of track.sections) {
    if (s.start > last || (s.biome !== 'pass' && s.role !== 'top')) continue;
    const key = s.name.toLowerCase();
    if (!out.has(key)) out.set(key, { name: s.name, alt: s.alt });
  }
  return [...out.values()];
}

export function passStamps(runs: GameRun[], tourName: string | null | undefined, stages: Stage[] | null | undefined): PassStamp[] {
  const by = new Map<string, PassStamp>();
  const tracks = new Map<string, Track>();
  const add = (name: string, alt: number, day: string, real: boolean) => {
    const key = name.toLowerCase();
    const e = by.get(key);
    if (e) { e.count += 1; if (day < e.first) e.first = day; e.real = e.real || real; }
    else by.set(key, { name, alt, count: 1, first: day, real });
  };
  for (const r of runs) {
    const day = berlinDayKey(new Date(r.created_at));
    if (r.game === 'abfahrt') {
      if (r.meters <= 0) continue;
      let t = tracks.get(`abfahrt:${day}`);
      if (!t) { t = new Track(day, [], 'descent'); tracks.set(`abfahrt:${day}`, t); }
      for (const p of descentPasses(t, r.meters)) add(p.name, p.alt, day, false);
    } else if (r.game === 'berg') {
      const ref = stageRef('mountain', tourName, stages, day);
      let t = tracks.get(`berg:${day}`);
      if (!t) { t = new Track(day, [], 'mountain', ref); tracks.set(`berg:${day}`, t); }
      t.seg(MOUNTAIN_TOP / SEG);
      const pass = t.sections.find((s) => s.biome === 'pass');
      if (pass) add(pass.name, pass.alt, day, !!ref?.climb && !ref.preview);
    }
  }
  return [...by.values()].sort((a, b) => b.alt - a.alt);
}

/** Summe der Höhenmeter aller Stempel (jeder Pass zählt mit seiner Höhe, so oft er überquert wurde) */
export function stampMeters(stamps: PassStamp[]): number {
  return stamps.reduce((a, s) => a + s.alt * s.count, 0);
}
