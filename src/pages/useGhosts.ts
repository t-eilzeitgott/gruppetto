import { useMemo, useRef, useState } from 'react';
import { invalidate, useQuery } from '../app/query';
import { source } from '../app/config';
import type { Profile } from '../lib/types';
import { scoreGhosts, type GameGhostRow, type GhostGame } from '../game/ghosts';
import type { GhostRider } from '../game/tt';

/**
 * Geister der Runde für Abfahrt, Sprint- und Bergfinale: lädt die besten Fahrten des Tages, wählt aus und speichert
 * die eigene Fahrt (nur mit mehr Punkten als die gespeicherte). Die Liste steht in einer Ref – das Spiel liest sie
 * beim Start, ohne dass die Seite neu zeichnen muss.
 */
export function useGameGhosts(game: GhostGame, day: string, me: Profile, members: Profile[] | undefined) {
  const key = `ghosts:${game}:${day}`;
  const q = useQuery<GameGhostRow[]>(key, () => source.gameGhosts(game, day));
  const [local, setLocal] = useState<GameGhostRow | null>(null);
  const list = useMemo(() => scoreGhosts(q.data ?? [], members ?? [], me, local), [q.data, members, me, local]);
  const ref = useRef<GhostRider[]>(list);
  ref.current = list;

  const save = (score: number, meters: number, bike: string, trace: number[]) => {
    if (score <= 0 || trace.length < 6) return;
    const row: GameGhostRow = { user_id: me.id, game, day, score: Math.round(score), meters: Math.round(meters), bike, trace, created_at: new Date().toISOString() };
    // sofort als eigener Bestlauf mitfahren (auch wenn das Speichern scheitert)
    setLocal((prev) => (!prev || prev.score < row.score ? row : prev));
    source.saveGameGhost({ game, day, score: row.score, meters: row.meters, bike, trace }).then(() => invalidate(key)).catch(() => undefined);
  };

  return { ghosts: ref, list, save };
}
