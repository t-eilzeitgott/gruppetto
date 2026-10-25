/** Tagesaufgaben: jeden Tag drei neue, für alle gleich. Zählen jeweils innerhalb eines Laufs. */
import { hashStr, mulberry32, shuffle } from './rng';

export type MissionStat = 'overtakes' | 'draftTime' | 'bidons' | 'topKmh' | 'near' | 'airTime' | 'km' | 'hairpins' | 'combo' | 'cleanKm';

export interface Mission { id: string; stat: MissionStat; target: number; text: string }

const POOL: { stat: MissionStat; steps: number[]; text: (n: number) => string }[] = [
  { stat: 'overtakes', steps: [8, 14, 22], text: (n) => `Überhole ${n} Fahrer` },
  { stat: 'draftTime', steps: [10, 20, 35], text: (n) => `${n} s im Windschatten` },
  { stat: 'bidons', steps: [10, 18, 30], text: (n) => `Sammle ${n} Trinkflaschen` },
  { stat: 'topKmh', steps: [85, 95, 105], text: (n) => `Erreiche ${n} km/h` },
  { stat: 'near', steps: [4, 8, 12], text: (n) => `${n}× knapp vorbei` },
  { stat: 'airTime', steps: [1.5, 3, 5], text: (n) => `${String(n).replace('.', ',')} s Flugzeit` },
  { stat: 'km', steps: [2, 3.5, 5], text: (n) => `Fahre ${String(n).replace('.', ',')} km` },
  { stat: 'hairpins', steps: [2, 4, 7], text: (n) => `${n} Kehren sauber fahren` },
  { stat: 'combo', steps: [3, 5, 7], text: (n) => `Kombo ×${n} erreichen` },
  { stat: 'cleanKm', steps: [1, 2, 3], text: (n) => `${n} km ohne Leitplanke` },
];

export function dailyMissions(dayKey: string): Mission[] {
  const r = mulberry32(hashStr(`missions:${dayKey}`));
  const picks = shuffle(r, POOL).slice(0, 3);
  // eine leichte, eine mittlere, eine schwere
  return picks.map((p, i) => {
    const target = p.steps[i];
    return { id: `${dayKey}:${p.stat}`, stat: p.stat, target, text: p.text(target) };
  });
}

export function missionProgress(m: Mission, stats: Record<MissionStat, number>): number {
  return Math.max(0, Math.min(1, (stats[m.stat] ?? 0) / m.target));
}
