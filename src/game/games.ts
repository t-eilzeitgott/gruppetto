import type { GameId } from '../data/source';

/** Alle Minispiele – ein neues Spiel braucht hier einen Eintrag (plus Symbol in GameBadge) */
export interface GameInfo {
  id: GameId;
  name: string;
  path: string;
  blurb: string;
  /** als neu hervorheben (Leuchten der Karte und „Neu“ am Titel) */
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

/** als neu hervorgehoben (Leuchten und „Neu“) – bleibt dauerhaft an */
export function isNewGame(g: GameInfo): boolean {
  return !!g.newUntilPlayed;
}
