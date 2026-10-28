/**
 * Geister für Abfahrt, Sprint- und Bergfinale – ohne 3D-Abhängigkeiten (Seiten, Datenquellen): die beste Fahrt
 * des Tages je Mitglied (nach Punkten) mit Fahrspur und Rad, gespeichert in game_ghosts. Das Zeitfahren hat seine
 * eigenen Geister nach Zeit (tt.ts, tt_ghosts).
 */
import type { Profile } from '../lib/types';
import type { GhostRider } from './tt';

export type GhostGame = 'abfahrt' | 'sprint' | 'berg';

/** Geist, wie er in der Datenbank liegt */
export interface GameGhostRow {
  user_id: string;
  game: GhostGame;
  day: string;
  score: number;
  meters: number;
  bike: string;
  trace: number[];
  created_at: string;
}

/** höchstens so viele Geister auf der Strecke */
export const MAX_SCORE_GHOSTS = 8;

/** Geister aus den gespeicherten Fahrten: Mitglieder in ihrer Avatarfarbe, der eigene Bestlauf als „Du“ */
export function scoreGhosts(rows: GameGhostRow[], members: Profile[], me: Profile, local: GameGhostRow | null): GhostRider[] {
  const list: GhostRider[] = [];
  const mine = [...rows.filter((r) => r.user_id === me.id), ...(local ? [local] : [])].sort((a, b) => b.score - a.score)[0] ?? null;
  for (const r of rows) {
    if (r.user_id === me.id || r.trace.length < 6) continue;
    const m = members.find((x) => x.id === r.user_id);
    list.push({ id: r.user_id, name: m?.display_name ?? 'Jemand', color: m?.avatar_color ?? '#888888', bike: r.bike || 'allround', timeMs: 0, splits: [], trace: r.trace, score: r.score });
  }
  if (mine && mine.trace.length >= 6) list.push({ id: 'me', name: 'Du', color: me.avatar_color, bike: mine.bike || 'allround', timeMs: 0, splits: [], trace: mine.trace, score: mine.score, me: true });
  return pickScoreGhosts(list);
}

/** Auswahl: die Tagesbesten, der eigene Bestlauf und die, deren Punkte den eigenen am nächsten liegen */
export function pickScoreGhosts(all: GhostRider[], max = MAX_SCORE_GHOSTS): GhostRider[] {
  const sorted = [...all].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const out: GhostRider[] = [];
  const add = (g: GhostRider | undefined) => { if (g && !out.includes(g) && out.length < max) out.push(g); };
  add(sorted[0]);
  const mine = sorted.find((g) => g.me);
  add(mine);
  const ref = mine?.score ?? sorted[0]?.score ?? 0;
  const rest = sorted.filter((g) => !out.includes(g)).sort((a, b) => Math.abs((a.score ?? 0) - ref) - Math.abs((b.score ?? 0) - ref));
  for (const g of rest) add(g);
  return out;
}
