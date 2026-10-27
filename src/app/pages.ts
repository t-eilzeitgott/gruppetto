/**
 * Seiten, die erst bei Bedarf geladen werden: die Spiele (mit 3D-Grafik) und die Garage. Die Startseite holt
 * sie im Leerlauf vorab (prefetchGames), damit der Wechsel ins Minispiel ohne Ladepause gelingt.
 */
import { lazyPage } from './lazy';

export const GamePage = lazyPage(() => import('../pages/Game').then((m) => m.GamePage));
export const SprintPage = lazyPage(() => import('../pages/Sprint').then((m) => m.SprintPage));
export const BergPage = lazyPage(() => import('../pages/Berg').then((m) => m.BergPage));
export const GaragePage = lazyPage(() => import('../pages/Garage').then((m) => m.GaragePage));

/** Spiele und Garage im Hintergrund laden (nacheinander, nur einmal) */
export function prefetchGames() {
  void GamePage.preload().then(() => SprintPage.preload()).then(() => BergPage.preload()).then(() => GaragePage.preload()).catch(() => undefined);
}
