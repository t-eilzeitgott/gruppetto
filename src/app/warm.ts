/**
 * Beim Start vorwärmen (während des Intros): Spiel-Code laden und die 3D-Welt des wahrscheinlichsten
 * Minispiels unsichtbar aufbauen (siehe game/abfahrt/pool.ts). Öffnet man es, steht die Welt sofort.
 *
 * Danach folgt der Vorrat der Spielwahl auf der Startseite (warmGame): wählt man ein anderes Spiel, wird die
 * Bühne dafür umgebaut – die Shader bleiben, nur die Welt entsteht neu – und das Spiel öffnet ohne Wartezeit.
 */
import type { Profile, StageKind, Tour, TourData } from '../lib/types';
import type { GameId } from '../data/source';
import { gameOrder } from '../game/games';
import { selectedBike } from '../game/bikes';
import { berlinDayKey } from '../game/abfahrt/rng';
import { stageInUse, warmGameId } from '../game/abfahrt/pool';
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
let args: WarmArgs | null = null;
/** laufende Vorwärmungen nacheinander */
let chain: Promise<void> = Promise.resolve();
let timer = 0;
/** was zuletzt angefordert wurde */
let wanted: GameId | null = null;

function makeArgs(o: { me: Profile; tour: Tour | null; data: TourData | undefined; names: string[] }): WarmArgs {
  const css = getComputedStyle(document.documentElement);
  return {
    me: o.me, tour: o.tour, data: o.data, names: o.names, day: berlinDayKey(), bike: selectedBike(),
    accent: css.getPropertyValue('--accent').trim() || '#ff5fa2', dark: document.documentElement.dataset.theme === 'dark',
  };
}

function run(id: GameId, a: WarmArgs, reuse: boolean): Promise<void> {
  return id === 'zeitfahren'
    ? ZeitfahrenPage.preload().then(() => import('../pages/Zeitfahren')).then((m) => m.warmZeitfahren(a, reuse))
    : id === 'sprint'
      ? SprintPage.preload().then(() => import('../pages/Sprint')).then((m) => m.warmSprint(a, reuse))
      : id === 'berg'
        ? BergPage.preload().then(() => import('../pages/Berg')).then((m) => m.warmBerg(a, reuse))
        : GamePage.preload().then(() => import('../pages/Game')).then((m) => m.warmAbfahrt(a, reuse));
}

export function startWarm(o: { me: Profile; tour: Tour | null; data: TourData | undefined; names: string[]; kind: StageKind | null }) {
  if (started) return;
  started = true;
  const a = (args = makeArgs(o));
  const first = wanted ?? gameOrder(o.kind)[0]?.id ?? 'abfahrt';
  chain = run(first, a, false).catch(() => undefined).finally(() => {
    introReady('warm');
    prefetchGames();
  });
}

/**
 * Die Spielwahl auf der Startseite hat gewechselt: die Bühne im Vorrat für dieses Spiel umbauen (kurz gewartet,
 * damit schnelles Durchblättern nicht jedes Mal baut). Während ein Spiel offen ist, passiert nichts.
 */
export function warmGame(id: GameId) {
  wanted = id;
  if (!args) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    const a = args;
    if (!a || stageInUse() || warmGameId() === id) return;
    chain = chain.then(() => (warmGameId() === id || stageInUse() || wanted !== id ? undefined : run(id, { ...a, bike: selectedBike() }, true))).catch(() => undefined);
  }, 450);
}
