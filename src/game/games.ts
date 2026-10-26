import type { GameId } from '../data/source';

/** Alle Minispiele – ein neues Spiel braucht hier einen Eintrag (plus Symbol in GameBadge) */
export interface GameInfo {
  id: GameId;
  name: string;
  path: string;
  blurb: string;
  /** „Neu“-Hinweis, bis man es einmal gespielt hat (Schlüssel im Browser-Speicher mit der Zahl der Läufe) */
  newUntilPlayed?: string;
}

export const GAMES: GameInfo[] = [
  { id: 'abfahrt', name: 'Abfahrt', path: '/spiel', blurb: 'Passabfahrt mit Gegnern' },
  { id: 'sprint', name: 'Sprintfinale', path: '/spiel/sprint', blurb: 'Die letzten 2,4 km im Feld', newUntilPlayed: 'gruppetto.sprint.runs' },
  { id: 'berg', name: 'Bergfinale', path: '/spiel/berg', blurb: 'Schlussanstieg und Abfahrt', newUntilPlayed: 'gruppetto.berg.runs' },
];

export function gameInfo(id: GameId): GameInfo {
  return GAMES.find((g) => g.id === id) ?? GAMES[0];
}

/** Spiel noch nie gespielt und als neu markiert? */
export function isNewGame(g: GameInfo): boolean {
  if (!g.newUntilPlayed) return false;
  try { return !(Number(localStorage.getItem(g.newUntilPlayed)) > 0); } catch { return true; }
}
