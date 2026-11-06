/**
 * Stürze in den Rennfinals (Sprint, Berg, Zeitfahren) – wie in der Abfahrt: der Fahrer fliegt über den Lenker,
 * rutscht aus und bleibt liegen (wreck.ts; im Bild als Ragdoll, die Fernsehkamera zeigt den Sturz). Anders als in der
 * endlosen Abfahrt ist das Rennen danach nicht vorbei: nach ein paar Sekunden steigt man wieder auf und fährt weiter
 * (das Feld ist dann weg). Wer in einen Liegenden hineinfährt, stürzt auch.
 */
import { wreckSettled, wreckTravel, type Wreck } from './wreck';
import type { Particle } from './engine';

/** so lange liegt man mindestens (s) – und spätestens dann steigt man wieder auf */
export const DOWN_MIN = 3.4;
export const DOWN_MAX = 6;

export function makeWreck(v: number, side: number, seed: number, z: number, x: number): Wreck {
  return { t: 0, v0: v, side: side >= 0 ? 1 : -1, seed, z0: z, x0: x };
}

/** wo jemand liegt: Körper (z, x) und wie weit das Rad dahinter liegt */
export interface Down { z: number; x: number; back: number }

export function downOf(w: Wreck, z: number): Down {
  return { z, x: w.x0, back: Math.min(3, Math.max(0.8, wreckTravel(w).s * 0.3)) };
}

/** fährt jemand mit dem Vorderrad bei (z, x) in einen Liegenden (Körper oder Rad)? */
export function hitDown(z: number, x: number, ws: Down[]): Down | null {
  const front = z + 0.9;
  for (const w of ws) if (front > w.z - w.back - 0.9 && front < w.z + 0.35 && Math.abs(x - w.x) < 0.78) return w;
  return null;
}

/** Gestürzten ein Stück weiter: Ort und Tempo aus dem Rutschweg */
export function slideOn(o: { z: number; v: number; vx: number }, w: Wreck, dt: number) {
  w.t += dt;
  const tr = wreckTravel(w);
  o.z = w.z0 + tr.s;
  o.v = tr.v;
  o.vx = 0;
}

/** wieder aufsteigen? (liegt still und lange genug) */
export function canRise(w: Wreck): boolean {
  return (w.t > DOWN_MIN && wreckSettled(w)) || w.t > DOWN_MAX;
}

/**
 * Ausweichen: liegt jemand voraus in der eigenen Spur, zur freien Seite (innerhalb ±half) und Tempo raus.
 * Gibt die neue Wunschlage und das höchste Tempo zurück – oder null, wenn nichts im Weg liegt.
 */
export function dodge(z: number, x: number, ws: Down[], half: number, look = 32): { tx: number; vmax: number } | null {
  let best: Down | null = null;
  for (const w of ws) {
    const d = w.z - z;
    if (d < -0.5 || d > look || Math.abs(w.x - x) > 1.15) continue;
    if (!best || w.z < best.z) best = w;
  }
  if (!best) return null;
  const d = Math.max(0, best.z - z);
  const left = best.x - 1.35, right = best.x + 1.35;
  const okL = left > -half, okR = right < half;
  const tx = okL && okR ? (x <= best.x ? left : right) : okL ? left : okR ? right : x;
  // je näher, desto langsamer (wer nicht vorbeikommt, bremst bis fast zum Stand)
  return { tx, vmax: 2 + d * 0.55 };
}

/**
 * Sturz mit Wucht: Funken, wo Rad und Pedale über den Asphalt schrammen, Staub und ein paar Steinchen – vom Tempo
 * mitgerissen. k: Stärke (eigener Sturz 1, Gegner im Massensturz weniger)
 */
export function crashBurst(parts: Particle[], z: number, x: number, v: number, rng: () => number, k = 1) {
  const n = Math.round(14 * k);
  for (let i = 0; i < n; i++) {
    const life = 0.35 + rng() * 0.4;
    parts.push({
      kind: 'spark', z: z + rng() * 0.8, x: x + (rng() - 0.5) * 0.7, h: 0.1 + rng() * 0.3,
      vz: v * (0.45 + rng() * 0.45), vx: (rng() - 0.5) * 5, vh: 0.8 + rng() * 3.2, life, max: life,
      size: 0.04 + rng() * 0.035, color: rng() < 0.3 ? '#fff1c2' : '#ffb347', rot: 0,
    });
  }
  for (let i = 0; i < n; i++) {
    const life = 0.7 + rng() * 0.6;
    parts.push({
      kind: 'dust', z: z - 0.3 + rng() * 1.2, x: x + (rng() - 0.5) * 1.2, h: 0.05,
      vz: v * (0.2 + rng() * 0.4), vx: (rng() - 0.5) * 2.4, vh: 0.4 + rng() * 1.4, life, max: life,
      size: 0.18 + rng() * 0.3, color: '#b3a58a', rot: 0,
    });
  }
  for (let i = 0; i < Math.round(6 * k); i++) {
    const life = 0.6 + rng() * 0.4;
    parts.push({
      kind: 'gravel', z: z + rng() * 0.6, x: x + (rng() - 0.5) * 0.8, h: 0.05,
      vz: v * (0.3 + rng() * 0.4), vx: (rng() - 0.5) * 3, vh: 1 + rng() * 2.5, life, max: life,
      size: 0.05 + rng() * 0.05, color: '#8c8478', rot: rng() * 6,
    });
  }
}
