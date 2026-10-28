/**
 * Seiten, die erst bei Bedarf geladen werden: die Spiele (mit 3D-Grafik) und die Garage. Die Startseite holt
 * sie im Leerlauf vorab (prefetchGames), damit der Wechsel ins Minispiel ohne Ladepause gelingt.
 */
import { lazyPage } from './lazy';

export const GamePage = lazyPage(() => import('../pages/Game').then((m) => m.GamePage));
export const SprintPage = lazyPage(() => import('../pages/Sprint').then((m) => m.SprintPage));
export const BergPage = lazyPage(() => import('../pages/Berg').then((m) => m.BergPage));
export const ZeitfahrenPage = lazyPage(() => import('../pages/Zeitfahren').then((m) => m.ZeitfahrenPage));
export const GaragePage = lazyPage(() => import('../pages/Garage').then((m) => m.GaragePage));
export const JourneyPage = lazyPage(() => import('../pages/Journey').then((m) => m.JourneyPage));
/** Prototyp „Akku leer!“ – vorerst nur im Admin-Bereich (2D, klein, wird nicht vorab geladen) */
export const AkkuPage = lazyPage(() => import('../pages/Akku').then((m) => m.AkkuPage));

/** Spiele, Garage und Europareise im Hintergrund laden (nacheinander, nur einmal) */
export function prefetchGames() {
  void ZeitfahrenPage.preload().then(() => GamePage.preload()).then(() => SprintPage.preload()).then(() => BergPage.preload()).then(() => GaragePage.preload()).then(() => JourneyPage.preload()).catch(() => undefined);
}
/** Welt-Editor (Admin): 3D-Welt der Minispiele bearbeiten – wird nicht vorab geladen */
export const WorldEditorPage = lazyPage(() => import('../pages/admin/AdminWorld').then((m) => m.WorldEditorPage));
/** WebGPU-Test (Admin): Passabfahrt mit dem WebGPU-Renderer – wird nicht vorab geladen */
export const GpuTestPage = lazyPage(() => import('../pages/admin/AdminGpu').then((m) => m.GpuTestPage));
