/**
 * Untertitel eines Spiels für heute (Rundfahrt, Etappe, Strecke, Länge, Gegend) – auf der Startseite und im
 * Startblatt des Spiels derselbe Text, damit der Kopf der Spielkarte beim Wechsel ins Spiel nahtlos übergeht.
 */
import type { GameId } from '../data/source';
import type { Stage } from '../lib/types';
import { Track } from './abfahrt/track';
import { dayRef, stageRef, type StageRef } from './abfahrt/stageRef';

export function gameSub(id: GameId, day: string, tourName: string | null | undefined, stages: Stage[] | null | undefined): string {
  if (id === 'abfahrt') return new Track(day, [], 'descent', dayRef(tourName, stages, day)).title;
  const kind = id === 'sprint' ? 'sprint' : id === 'berg' ? 'mountain' : 'tt';
  const ref = stageRef(kind, tourName, stages, day);
  return gameSubFor(id, day, ref);
}

/** mit schon bekannter Etappenvorlage (die Spiele haben sie) */
export function gameSubFor(id: GameId, day: string, ref: StageRef | null): string {
  // kurz: Etappe und Ziel (Rundfahrt, Länge und Gegend stehen anderswo)
  const pre = ref ? `${ref.stage}. Etappe, ` : '';
  if (id === 'sprint') return `${pre}${new Track(day, [], 'sprint', ref).title.replace('Sprintfinale in ', 'Ziel in ')}`;
  if (id === 'berg') return `${pre}${new Track(day, [], 'mountain', ref).title}`;
  if (id === 'zeitfahren') {
    const t = new Track(day, [], 'tt', ref).title;
    const town = t.startsWith('Zeitfahren in ') ? t.slice('Zeitfahren in '.length) : null;
    if (town) return ref ? `${ref.stage}. Etappe in ${town}` : town;
    return `${pre}${t}`;
  }
  return new Track(day).title;
}
