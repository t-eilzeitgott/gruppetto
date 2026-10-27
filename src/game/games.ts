import type { StageKind } from '../lib/types';
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


/** Reihenfolge der Spiele: das Finale zur Etappe des Tages zuerst (flach/wellig → Sprint, sonst Berg), dann das andere, dann die Abfahrt */
export function gameOrder(kind: StageKind | null): GameInfo[] {
  const rank: Record<string, number> = kind === 'flat' || kind === 'hilly' ? { sprint: 0, berg: 1, abfahrt: 2 } : { berg: 0, sprint: 1, abfahrt: 2 };
  return [...GAMES].sort((a, b) => (rank[a.id] ?? 9) - (rank[b.id] ?? 9));
}
