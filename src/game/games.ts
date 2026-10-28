import type { StageKind } from '../lib/types';
import type { GameId } from '../data/source';
import { fmtTime, ttMs } from './tt';

/** Alle Minispiele – ein neues Spiel braucht hier einen Eintrag (plus Symbol in GameBadge) */
export interface GameInfo {
  id: GameId;
  name: string;
  path: string;
  blurb: string;
  /** Punkte (größer ist besser) oder eine Zeit (in game_scores als 1.000.000 − ms abgelegt, siehe tt.ts) */
  scoring: 'points' | 'time';
  /** als neu hervorheben („Neu“ am Titel, Leuchten der Karte) und auf der Startseite zuerst zeigen, bis man es gespielt hat */
  newUntilPlayed?: string;
}

export const GAMES: GameInfo[] = [
  { id: 'zeitfahren', name: 'Zeitfahren', path: '/spiel/zeitfahren', blurb: 'Allein gegen die Uhr – mit den Geistern der Runde', scoring: 'time', newUntilPlayed: 'gruppetto.zeitfahren.runs' },
  { id: 'abfahrt', name: 'Abfahrt', path: '/spiel', blurb: 'Passabfahrt mit Gegnern', scoring: 'points' },
  { id: 'sprint', name: 'Sprintfinale', path: '/spiel/sprint', blurb: 'Die letzten 2,4 km im Feld', scoring: 'points' },
  { id: 'berg', name: 'Bergfinale', path: '/spiel/berg', blurb: 'Schlussanstieg und Abfahrt', scoring: 'points' },
];

export function gameInfo(id: GameId): GameInfo {
  return GAMES.find((g) => g.id === id) ?? GAMES[0];
}

/** Bestwert eines Spiels als Text: Punkte, im Zeitfahren die Zeit */
export function fmtBest(game: GameInfo | GameId, best: number): string {
  const g = typeof game === 'string' ? gameInfo(game) : game;
  return g.scoring === 'time' ? fmtTime(ttMs(best)) : Math.round(best).toLocaleString('de-DE');
}

/**
 * Reihenfolge der Spiele: das neue Zeitfahren zuerst, dann das Finale zur Etappe des Tages (flach/wellig → Sprint,
 * sonst Berg), dann das andere, dann die Abfahrt
 */
export function gameOrder(kind: StageKind | null): GameInfo[] {
  const rank: Record<string, number> = kind === 'flat' || kind === 'hilly' ? { zeitfahren: 0, sprint: 1, berg: 2, abfahrt: 3 } : { zeitfahren: 0, berg: 1, sprint: 2, abfahrt: 3 };
  return [...GAMES].sort((a, b) => (rank[a.id] ?? 9) - (rank[b.id] ?? 9));
}

/**
 * Reihenfolge auf der Startseite: ein neues Spiel, das man noch nicht gespielt hat, ganz vorn; danach das Spiel,
 * das man selbst am häufigsten gespielt hat. Bei Gleichstand (auch ganz ohne Läufe) bleibt die Reihenfolge von gameOrder.
 */
export function gameOrderByPlays(kind: StageKind | null, runs: Partial<Record<GameId, number>> | null): GameInfo[] {
  const base = gameOrder(kind);
  if (!runs) return base;
  const fresh = (g: GameInfo) => (g.newUntilPlayed && (runs[g.id] ?? 0) === 0 ? 1 : 0);
  return base
    .map((g, i) => ({ g, i, n: runs[g.id] ?? 0, f: fresh(g) }))
    .sort((a, b) => b.f - a.f || b.n - a.n || a.i - b.i)
    .map((x) => x.g);
}

/** Spiel, das als neu gilt und noch nicht gespielt wurde (eigene Läufe aus der Saison-Bestenliste) */
export function isNewGame(g: GameInfo, runs: Partial<Record<GameId, number>> | null): boolean {
  return !!g.newUntilPlayed && !!runs && (runs[g.id] ?? 0) === 0;
}
