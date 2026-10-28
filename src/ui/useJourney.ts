/**
 * Europareise: eigene Kilometer und die der ganzen Runde aus den Bestenlisten aller Minispiele
 * (dieselben Abfragen wie die Radgarage – nichts wird doppelt geladen).
 */
import { useMemo } from 'react';
import { useApp } from '../app/context';
import { useQuery } from '../app/query';
import { source } from '../app/config';
import type { GameBest } from '../data/source';
import { GARAGE_START } from '../game/bikes';
import { journeyAt, type JourneyPos } from '../game/journey';

export interface Journey {
  loaded: boolean;
  me: JourneyPos;
  group: JourneyPos;
  /** Meter je Spieler (nur wer schon gefahren ist), absteigend */
  riders: { userId: string; meters: number; runs: number }[];
}

export function useJourney(): Journey {
  const { me } = useApp();
  const a = useQuery<GameBest[]>('game:abfahrt:garage', () => source.gameLeaderboard('abfahrt', GARAGE_START));
  const s = useQuery<GameBest[]>('game:sprint:garage', () => source.gameLeaderboard('sprint', GARAGE_START));
  const b = useQuery<GameBest[]>('game:berg:garage', () => source.gameLeaderboard('berg', GARAGE_START));
  const z = useQuery<GameBest[]>('game:zeitfahren:garage', () => source.gameLeaderboard('zeitfahren', GARAGE_START));
  const loaded = !!(a.data && s.data && b.data && z.data);
  return useMemo(() => {
    const per = new Map<string, { meters: number; runs: number }>();
    for (const rows of [a.data, s.data, b.data, z.data]) {
      for (const r of rows ?? []) {
        const e = per.get(r.user_id) ?? { meters: 0, runs: 0 };
        e.meters += r.total_m;
        e.runs += r.runs;
        per.set(r.user_id, e);
      }
    }
    const riders = [...per.entries()].map(([userId, e]) => ({ userId, ...e })).filter((r) => r.meters > 0).sort((x, y) => y.meters - x.meters);
    const mine = per.get(me.id)?.meters ?? 0;
    const all = riders.reduce((acc, r) => acc + r.meters, 0);
    return { loaded, me: journeyAt(mine), group: journeyAt(all), riders };
  }, [a.data, s.data, b.data, z.data, me.id, loaded]);
}
