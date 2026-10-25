/** Kleine, deterministische Zufallshelfer – gleiche Tagesstrecke für alle. */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a über einen String */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const pick = <T>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];
export const between = (r: Rng, a: number, b: number): number => a + (b - a) * r();
export const chance = (r: Rng, p: number): boolean => r() < p;

export function shuffle<T>(r: Rng, list: readonly T[]): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const berlinFmt = typeof Intl !== 'undefined'
  ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
  : null;

/** Kalendertag in Berlin als 'YYYY-MM-DD' */
export function berlinDayKey(d: Date = new Date()): string {
  if (!berlinFmt) return d.toISOString().slice(0, 10);
  return berlinFmt.format(d);
}

function berlinOffsetMs(t: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(t / 1000) * 1000;
}

/** Mitternacht (Berlin) des aktuellen Tages */
export function berlinDayStart(d: Date = new Date()): Date {
  const guess = Date.parse(`${berlinDayKey(d)}T00:00:00Z`);
  return new Date(guess - berlinOffsetMs(guess));
}
