/**
 * Räder: Freischalt-Stand aus den eigenen Ergebnissen aller drei Minispiele (geteilter Cache mit den
 * Bestenlisten der Spiele, also keine zusätzlichen Abfragen), gewähltes Rad (auf dem Gerät gespeichert)
 * und die neu freigeschalteten Räder, die in der Garage noch nicht angesehen wurden.
 */
import { useCallback, useMemo, useState } from 'react';
import { useApp } from '../app/context';
import { useQuery } from '../app/query';
import { source } from '../app/config';
import type { GameBest } from '../data/source';
import { BIKES, bikeProgress, bikeStats, markBikesSeen, seenBikes, selectBike, selectedBike, type BikeStats, type Progress } from '../game/bikes';

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
  markSeen: () => void;
}

export function useBikes(): Bikes {
  const { me } = useApp();
  const a = useQuery<GameBest[]>('game:abfahrt:season', () => source.gameLeaderboard('abfahrt'));
  const s = useQuery<GameBest[]>('game:sprint:season', () => source.gameLeaderboard('sprint'));
  const b = useQuery<GameBest[]>('game:berg:season', () => source.gameLeaderboard('berg'));
  const loaded = !!(a.data && s.data && b.data);
  const stats = useMemo(() => bikeStats({ abfahrt: a.data, sprint: s.data, berg: b.data }, me.id), [a.data, s.data, b.data, me.id]);
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
  return { loaded, stats, progress, current, select, unlocked, fresh, markSeen };
}
