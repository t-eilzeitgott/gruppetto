/**
 * Geister für Abfahrt, Sprint- und Bergfinale: je Mitglied der letzte gespeicherte Lauf (heute der beste,
 * sonst der des letzten Spieltags – dann als älterer Geist mit Tag), dazu der eigene. Nach einem Lauf wird
 * er als Geist hinterlegt (die Datenbank behält je Tag den mit den meisten Punkten).
 */
import { useMemo, useState } from 'react';
import { useApp } from '../app/context';
import { useMembers } from '../app/hooks';
import { invalidate, useQuery } from '../app/query';
import { source } from '../app/config';
import { berlinDayKey } from '../game/abfahrt/rng';
import { pickGameGhosts } from '../game/abfahrt/ghosts';
import type { GameGhostRow } from '../game/tt';

type Game = GameGhostRow['game'];

export function useGameGhosts(game: Game) {
  const { me } = useApp();
  const members = useMembers();
  const day = berlinDayKey();
  const q = useQuery<GameGhostRow[]>(`ghosts:${game}`, () => source.gameGhosts(game));
  // der gerade gefahrene Lauf: sofort beim nächsten Start dabei, auch bevor die Liste neu geladen ist
  const [local, setLocal] = useState<GameGhostRow | null>(null);
  const ghosts = useMemo(() => {
    const rows = [...(q.data ?? []), ...(local ? [local] : [])];
    return pickGameGhosts(rows, me.id, day, (id) => {
      if (id === me.id) return { name: 'Du', color: me.avatar_color };
      const m = members.data?.find((x) => x.id === id);
      return { name: m?.display_name ?? 'Jemand', color: m?.avatar_color ?? '#888888' };
    });
  }, [q.data, local, me.id, me.avatar_color, members.data, day]);

  /** eigenen Lauf als Geist hinterlegen (nur echte Läufe mit Spur) */
  const save = (run: { score: number; meters: number; trace: number[]; bike: string }) => {
    if (run.trace.length < 6 || run.score <= 0) return;
    const row: GameGhostRow = { user_id: me.id, game, day, score: run.score, meters: run.meters, bike: run.bike, trace: run.trace, created_at: new Date().toISOString() };
    setLocal((prev) => (prev && prev.day === day && prev.score >= row.score ? prev : row));
    source.saveGameGhost({ game, day, score: run.score, meters: run.meters, bike: run.bike, trace: run.trace })
      .then(() => invalidate(`ghosts:${game}`))
      .catch(() => undefined);
  };

  return { ghosts, save };
}
