/** zuletzt gesehener eigener Platz in einer Bestenliste und wer davor stand */
export interface Seen { rank: number; above: string[] }

/**
 * Überholt? Nur ein Rückfall von Platz 1 oder 2 zählt (seit dem zuletzt gesehenen Stand);
 * by: wer jetzt neu vor einem liegt
 */
export function overtaken(prev: Seen | null, cur: Seen | null): { from: number; to: number; by: string[] } | null {
  if (!prev || !cur || prev.rank > 2 || cur.rank <= prev.rank) return null;
  return { from: prev.rank, to: cur.rank, by: cur.above.filter((id) => !prev.above.includes(id)) };
}
