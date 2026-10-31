/**
 * Untertitel eines Spiels für heute (Rundfahrt, Etappe, Strecke, Länge, Gegend) – auf der Startseite und im
 * Startblatt des Spiels derselbe Text, damit der Kopf der Spielkarte beim Wechsel ins Spiel nahtlos übergeht.
 */
import type { GameId } from '../data/source';
import type { Stage } from '../lib/types';
import { TT_FINISH, Track } from './abfahrt/track';
import { LOOKS } from './abfahrt/region';
import { shortTour, stageRef, type StageRef } from './abfahrt/stageRef';

export function gameSub(id: GameId, day: string, tourName: string | null | undefined, stages: Stage[] | null | undefined): string {
  if (id === 'abfahrt') return new Track(day).title;
  const kind = id === 'sprint' ? 'sprint' : id === 'berg' ? 'mountain' : 'tt';
  const ref = stageRef(kind, tourName, stages, day);
  return gameSubFor(id, day, ref);
}

/** mit schon bekannter Etappenvorlage (die Spiele haben sie) */
export function gameSubFor(id: GameId, day: string, ref: StageRef | null): string {
  const pre = ref ? `${shortTour(ref.tour)} · ${ref.stage}. Etappe · ` : '';
  const look = ref ? ` · ${LOOKS[ref.region].label}` : '';
  if (id === 'sprint') return `${pre}${new Track(day, [], 'sprint', ref).title.replace('Sprintfinale in ', 'Ziel in ')} · 2,4 km${look}`;
  if (id === 'berg') return `${pre}${new Track(day, [], 'mountain', ref).title}${look}`;
  if (id === 'zeitfahren') {
    const km = (TT_FINISH / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1 });
    return `${pre}${new Track(day, [], 'tt', ref).title} · ${km} km${look}`;
  }
  return new Track(day).title;
}
