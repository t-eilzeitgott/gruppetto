/**
 * Räder: Freischalt-Stand aus den eigenen Läufen aller Minispiele seit Eröffnung der Garage,
 * gewähltes Rad (auf dem Gerät gespeichert) und die neu freigeschalteten Räder, die in der Garage noch
 * nicht angesehen wurden. Nach jedem gespeicherten Lauf werden die Listen der Spiele neu geladen
 * (invalidate('game:…') trifft auch diese Abfragen).
 */
import { useCallback, useMemo, useState } from 'react';
import { useApp } from '../app/context';
import { useQuery } from '../app/query';
import { source } from '../app/config';
import type { GameBest } from '../data/source';
import { BIKES, GARAGE_START, bikeProgress, bikeStats, markBikesSeen, nextBike, seenBikes, selectBike, selectedBike, type BikeSpec, type BikeStats, type Progress } from '../game/bikes';

export interface Bikes {
  /** alle drei Bestenlisten geladen */
  loaded: boolean;
  stats: BikeStats;
  progress: Record<string, Progress>;
  /** Rad, das gefahren wird (gewählt und freigeschaltet, sonst das Teamrad) */
  current: string;
  select: (id: string) => void;
  unlocked: string[];
  /** freigeschaltet, aber noch nicht in der Garage angesehen */
  fresh: string[];
  /** das nächste Rad zum Erfahren */
  next: BikeSpec | null;
  markSeen: () => void;
}

export function useBikes(): Bikes {
  const { me } = useApp();
  const a = useQuery<GameBest[]>('game:abfahrt:garage', () => source.gameLeaderboard('abfahrt', GARAGE_START));
  const s = useQuery<GameBest[]>('game:sprint:garage', () => source.gameLeaderboard('sprint', GARAGE_START));
  const b = useQuery<GameBest[]>('game:berg:garage', () => source.gameLeaderboard('berg', GARAGE_START));
  const z = useQuery<GameBest[]>('game:zeitfahren:garage', () => source.gameLeaderboard('zeitfahren', GARAGE_START));
  const loaded = !!(a.data && s.data && b.data && z.data);
  const stats = useMemo(() => bikeStats({ abfahrt: a.data, sprint: s.data, berg: b.data, zeitfahren: z.data }, me.id), [a.data, s.data, b.data, z.data, me.id]);
  const progress = useMemo(() => bikeProgress(stats), [stats]);
  const [sel, setSel] = useState(selectedBike);
  const [seenTick, setSeenTick] = useState(0);
  const unlocked = useMemo(() => BIKES.filter((x) => progress[x.id]?.done).map((x) => x.id), [progress]);
  const fresh = useMemo(() => {
    if (!loaded) return [];
    const seen = seenBikes();
    return unlocked.filter((id) => !seen.has(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, unlocked, seenTick]);
  const select = useCallback((id: string) => { selectBike(id); setSel(id); }, []);
  const markSeen = useCallback(() => { markBikesSeen(unlocked); setSeenTick((t) => t + 1); }, [unlocked]);
  // solange die Listen laden, das gewählte Rad annehmen; danach nur, wenn es freigeschaltet ist
  const current = !loaded || progress[sel]?.done ? sel : 'allround';
  const next = useMemo(() => nextBike(progress), [progress]);
  return { loaded, stats, progress, current, select, unlocked, fresh, next, markSeen };
}
