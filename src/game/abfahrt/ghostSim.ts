/**
 * Geister ohne Bild durchrechnen (Demo-Runde, Tests): eine ganze Fahrt mit einfachem Autopiloten, ohne Renderer.
 * Liefert Punkte, Strecke und Fahrspur wie eine echte Fahrt.
 */
import { Abfahrt, type RunResult } from './engine';
import { SprintRace, type RiderType, type SprintResult } from './sprint';
import { BergRace, type BergResult } from './berg';
import { SPRINT_FINISH } from './track';
import { dailyMissions } from './missions';
import { mulberry32 } from './rng';
import type { Kit } from './rider';
import type { GhostGame } from '../ghosts';

const KIT: Kit = { jersey: '#888888', side: '#ffffff', helmet: '#ffffff', shorts: '#16171a', skin: '#f0c4a0', shoes: '#ffffff', number: '1' };

export interface SimGhost { score: number; meters: number; trace: number[] }

/** eine Fahrt: skill 0 … 1 (Linienwahl, Mut), seed für die Eigenheiten */
export function simulateRun(game: GhostGame, day: string, skill: number, seed: number): SimGhost {
  const r = mulberry32(seed);
  if (game === 'abfahrt') {
    let over: RunResult | null = null;
    const g = new Abfahrt({ dayKey: day, names: [], friends: [], kit: KIT, best: 0, missions: dailyMissions(day), missionsDone: new Set(), tutorial: false, onOver: (x) => { over = x; } });
    g.start();
    const care = 0.6 + skill * 0.8;
    for (let t = 0; t < 150 && !over; t += 1 / 30) {
      // Spur mit dem meisten Platz (wie der Autopilot im Test), weniger gute Fahrer schauen kürzer voraus
      const p = g.p;
      let best = 0;
      let bestScore = -Infinity;
      for (const lx of [-2.2, -1.1, 0, 1.1, 2.2]) {
        let s = -Math.abs(lx - p.x) * 0.15 + (r() - 0.5) * (1 - skill) * 0.6;
        for (const o of g.opps) if (o.z > p.z - 1 && o.z - p.z < 10) s -= Math.max(0, 1.3 - Math.abs(o.x - lx)) * 4;
        for (let d = 0; d < 40 * care; d += 2) {
          for (const o of g.track.segAt(p.z + d).objs ?? []) {
            if (o.done || o.z <= p.z) continue;
            const good = o.k === 'bidon' || o.k === 'gold';
            const dz = o.z - p.z;
            s += (good ? 1 : -6) * Math.max(0, (good ? 1.0 : 1.7) - Math.abs(o.x - lx)) * (1 - dz / 45);
            if (!good && dz < 20 && o.x > Math.min(p.x, lx) - 0.9 && o.x < Math.max(p.x, lx) + 0.9) s -= 8 * (1 - dz / 20);
          }
        }
        if (s > bestScore) { bestScore = s; best = lx; }
      }
      g.tx = best;
      g.key('up', r() < 0.55 + skill * 0.4);
      g.update(1 / 30);
    }
    const res = over as RunResult | null;
    return res ? { score: res.score, meters: res.meters, trace: res.trace } : { score: g.total, meters: Math.floor(g.p.z), trace: g.ghostField?.recorded ?? [] };
  }
  const types: RiderType[] = ['sprinter', 'puncheur', 'allround', 'rouleur', 'climber'];
  const type = types[Math.floor(r() * types.length)];
  if (game === 'sprint') {
    let over: SprintResult | null = null;
    const g = new SprintRace({ dayKey: day, names: [], rider: { name: 'Geist', type, number: '1' }, rivals: [], kit: KIT, onOver: (x) => { over = x; } });
    g.start();
    const launch = 140 + (1 - skill) * 220 + r() * 60;
    const lane = (r() - 0.5) * 2.4;
    for (let t = 0; t < 320 && !over; t += 1 / 30) {
      g.tx = lane;
      g.key('up', SPRINT_FINISH - g.p.z < launch);
      g.update(1 / 30);
    }
    const res = over as SprintResult | null;
    return res ? { score: res.score, meters: SPRINT_FINISH, trace: res.trace } : { score: 0, meters: 0, trace: [] };
  }
  let over: BergResult | null = null;
  const g = new BergRace({ dayKey: day, names: [], rider: { name: 'Geist', type, number: '1' }, rivals: [], kit: KIT, onOver: (x) => { over = x; } });
  g.start();
  const attackAt = 0.3 + r() * 0.5;
  for (let t = 0; t < 400 && !over; t += 1 / 30) {
    const k = g.p.z / 900;
    g.key('up', k > attackAt && k < attackAt + 0.12 + skill * 0.2);
    g.update(1 / 30);
  }
  const res = over as BergResult | null;
  return res ? { score: res.score, meters: Math.floor(g.p.z), trace: res.trace } : { score: 0, meters: 0, trace: [] };
}
