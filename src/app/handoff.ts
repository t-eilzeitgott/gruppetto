/**
 * Übergang von der Startseite ins Spiel ohne Schnitt: Die Startseite bleibt als Abbild stehen, während das Spiel
 * darunter schon da ist, und blendet weich darüber aus; der Kopf der Spielkarte (Symbol, Name, Strecke) bleibt
 * dabei stehen und fliegt an seinen Platz im Startblatt, das im selben Takt aufsteigt. Kein Schwarz dazwischen.
 *
 * Technisch: Beim Tippen wird der Seiteninhalt (#root) samt Kopf kopiert und fest über alles gelegt (außerhalb von
 * #root – überlebt den Seitenwechsel), die Seite wechselt sofort. Meldet das Spiel sein Ziel (endHandoff), blendet
 * das Abbild aus, die Kopie des Kopfs fliegt zum Ziel, am Ende wird sie gegen den echten Kopf getauscht.
 */
import { handOver, navigate } from './router';

interface Pending {
  layer: HTMLElement;
  /** Abbild der Startseite */
  shot: HTMLElement | null;
  /** Kopie des Kopfs */
  clone: HTMLElement;
  from: DOMRect;
  path: string;
  timer: number;
}

let pending: Pending | null = null;

/** gleiche Bewegung für Flug und Blatt (weich ankommend) */
export const HANDOFF_MS = 460;
export const HANDOFF_EASE = 'cubic-bezier(0.22, 0.9, 0.24, 1)';

const calm = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function clear() {
  if (!pending) return;
  window.clearTimeout(pending.timer);
  pending.layer.remove();
  pending = null;
}

/** läuft gerade ein Übergang (das Spiel wartet auf sein Ziel)? */
export function handoffPending(): boolean {
  return !!pending;
}

/**
 * Von der Startseite aus: head = der Kopf der Spielkarte, path = Seite des Spiels. Abbild und Kopie stehen sofort,
 * dann wechselt die Seite (ohne eigenes Einblenden – das Abbild blendet aus, sobald das Spiel steht).
 */
export function beginHandoff(head: HTMLElement, path: string) {
  if (calm()) { navigate(path); return; }
  clear();
  const from = head.getBoundingClientRect();
  const root = document.getElementById('root');
  const layer = document.createElement('div');
  layer.className = 'handoff';
  layer.setAttribute('aria-hidden', 'true');
  // Abbild der Seite: der Kopf darin bleibt leer (die Kopie liegt darüber)
  let shot: HTMLElement | null = null;
  try {
    head.style.visibility = 'hidden';
    if (root) {
      // Rahmen in Bildschirmgröße (er blendet und schrumpft), darin die Seite um ihre Scrollweite versetzt – feste
      // Teile wie die Tableiste bleiben so, wo sie sind
      shot = document.createElement('div');
      shot.className = 'handoff__shot';
      const copy = root.cloneNode(true) as HTMLElement;
      copy.removeAttribute('id');
      copy.className = 'handoff__page';
      copy.style.cssText = `top:${-window.scrollY}px`;
      // keine doppelten Kennungen
      copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
      shot.append(copy);
      layer.append(shot);
    }
  } catch { shot = null; }
  head.style.visibility = '';
  const clone = head.cloneNode(true) as HTMLElement;
  clone.classList.add('handoff__item');
  clone.style.cssText += `;position:fixed;left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;margin:0;transform-origin:0 0;`;
  layer.append(clone);
  document.body.append(layer);
  // Sicherheitsnetz: meldet das Spiel kein Ziel (Fehler, kein 3D), verschwindet alles von selbst
  const timer = window.setTimeout(() => { if (pending?.clone === clone) fadeAway(); }, 2200);
  pending = { layer, shot, clone, from, path, timer };
  handOver();
  navigate(path);
}

function fadeAway() {
  const p = pending;
  if (!p) return;
  pending = null;
  window.clearTimeout(p.timer);
  try {
    p.layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease' }).finished.finally(() => p.layer.remove());
  } catch { p.layer.remove(); }
}

/** die Bewegung von HANDOFF_EASE als Funktion (weich ankommend, kein Überschwingen) */
function ease(k: number): number {
  const u = 1 - Math.max(0, Math.min(1, k));
  return 1 - u * u * u;
}

/**
 * Im Spiel, sobald das Startblatt steht (vor dem ersten Bild): head = der Kopf im Blatt (gleicher Aufbau wie auf der
 * Startseite), sheet = das Blatt. Das Abbild der Startseite blendet aus, die Kopie fliegt zum Kopf, das Blatt steigt
 * dabei auf – Bild für Bild von Hand, denn das Ziel wird jedes Bild neu gemessen: lädt noch etwas nach und das
 * Blatt wächst, zieht der Kopf mit. Ergibt false, wenn kein Übergang läuft – dann blendet das Blatt für sich ein.
 */
export function endHandoff(head: HTMLElement, sheet: HTMLElement): boolean {
  const p = pending;
  if (!p) return false;
  pending = null;
  window.clearTimeout(p.timer);
  head.style.visibility = 'hidden';
  const t0 = performance.now();
  const RISE = 36;
  const FADE = 360;
  let raf = 0;
  const done = () => {
    cancelAnimationFrame(raf);
    head.style.visibility = '';
    sheet.style.transform = '';
    sheet.style.opacity = '';
    p.layer.remove();
  };
  const tick = (now: number) => {
    const t = now - t0;
    const k = Math.min(1, t / HANDOFF_MS);
    const e = ease(k);
    // Abbild der Startseite weich weg, dabei ein wenig zurücktretend
    if (p.shot) {
      const f = ease(Math.min(1, t / FADE));
      p.shot.style.opacity = String(1 - f);
      p.shot.style.transform = `scale(${1 - 0.025 * f})`;
    }
    // Blatt steigt auf
    sheet.style.transform = `translateY(${(1 - e) * RISE}px)`;
    sheet.style.opacity = String(Math.min(1, e * 1.4));
    // Ziel ohne die Verschiebung des Blatts
    const r = head.getBoundingClientRect();
    const toX = r.left, toY = r.top - (1 - e) * RISE;
    const dx = (toX - p.from.left) * e, dy = (toY - p.from.top) * e;
    p.clone.style.transform = `translate(${dx}px, ${dy}px)`;
    if (k < 1) raf = requestAnimationFrame(tick);
    else done();
  };
  // erstes Bild sofort (noch vor dem Zeichnen): das Blatt steht unten, die Kopie an ihrem alten Platz
  tick(t0);
  if (!sheet.isConnected) done();
  return true;
}

/** Spiel ohne Übergang betreten (direkte Adresse, Zurück): nur das Blatt einblenden */
export function sheetIn(sheet: HTMLElement) {
  if (calm()) return;
  try {
    sheet.animate([{ transform: 'translateY(28px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: HANDOFF_EASE, fill: 'backwards' });
  } catch { /* ohne Animation */ }
}

/** Startblatt weg (Losfahren): gleitet nach unten, die Abdunklung dahinter geht mit, dann weiter */
export function sheetOut(sheet: HTMLElement, layer: HTMLElement | null): Promise<void> {
  if (calm()) return Promise.resolve();
  try {
    const a = sheet.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(60px)', opacity: 0 }], { duration: 260, easing: 'cubic-bezier(0.4, 0, 0.7, 0.2)', fill: 'forwards' });
    layer?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease', fill: 'forwards' });
    return a.finished.then(() => undefined, () => undefined);
  } catch { return Promise.resolve(); }
}

/** beim Verlassen der Startseite ohne Spiel (z. B. Zurück): aufräumen */
export function cancelHandoff() {
  clear();
}
