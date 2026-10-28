/**
 * Beim Start vorwärmen (während des Intros): Spiel-Code laden und die 3D-Welt des wahrscheinlichsten
 * Minispiels unsichtbar aufbauen (siehe game/abfahrt/pool.ts). Öffnet man es, steht die Welt sofort.
 */
import type { Profile, StageKind, Tour, TourData } from '../lib/types';
import { gameOrder } from '../game/games';
import { selectedBike } from '../game/bikes';
import { berlinDayKey } from '../game/abfahrt/rng';
import { BergPage, GamePage, SprintPage, ZeitfahrenPage, prefetchGames } from './pages';
import { introReady } from './intro';

export interface WarmArgs {
  me: Profile;
  tour: Tour | null;
  data: TourData | undefined;
  names: string[];
  day: string;
  bike: string;
  accent: string;
  dark: boolean;
}

let started = false;

export function startWarm(o: { me: Profile; tour: Tour | null; data: TourData | undefined; names: string[]; kind: StageKind | null }) {
  if (started) return;
  started = true;
  const css = getComputedStyle(document.documentElement);
  const a: WarmArgs = {
    me: o.me, tour: o.tour, data: o.data, names: o.names, day: berlinDayKey(), bike: selectedBike(),
    accent: css.getPropertyValue('--accent').trim() || '#ff5fa2', dark: document.documentElement.dataset.theme === 'dark',
  };
  const first = gameOrder(o.kind)[0]?.id ?? 'abfahrt';
  const run = first === 'zeitfahren'
    ? ZeitfahrenPage.preload().then(() => import('../pages/Zeitfahren')).then((m) => m.warmZeitfahren(a))
    : first === 'sprint'
      ? SprintPage.preload().then(() => import('../pages/Sprint')).then((m) => m.warmSprint(a))
      : first === 'berg'
        ? BergPage.preload().then(() => import('../pages/Berg')).then((m) => m.warmBerg(a))
        : GamePage.preload().then(() => import('../pages/Game')).then((m) => m.warmAbfahrt(a));
  run.catch(() => undefined).finally(() => {
    introReady('warm');
    prefetchGames();
  });
}
