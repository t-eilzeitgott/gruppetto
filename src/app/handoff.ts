/**
 * Übergang von der Startseite ins Spiel ohne Schnitt: Der Kopf der Spielkarte (Symbol, Name, Strecke) bleibt beim
 * Seitenwechsel stehen und fliegt an seinen Platz im Startbild des Spiels, während die Startseite dahinter weich
 * ausblendet und die 3D-Welt mit dem Startblatt hereinkommt.
 *
 * Technisch: Eine Kopie des Kopfs liegt fest über allem (außerhalb von #root – sie überlebt den Seitenwechsel).
 * Das Spiel meldet mit endHandoff sein Ziel; die Kopie fliegt dorthin, das Blatt steigt im selben Takt, am Ende
 * wird die Kopie gegen den echten Kopf getauscht.
 */
import { navigate } from './router';

interface Pending { clone: HTMLElement; layer: HTMLElement; from: DOMRect; path: string; t: number; timer: number }

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
 * Von der Startseite aus: head = der Kopf der Spielkarte, path = Seite des Spiels. Die Kopie steht sofort, die
 * Startseite blendet aus, dann wechselt die Seite.
 */
export function beginHandoff(head: HTMLElement, path: string) {
  if (calm()) { navigate(path); return; }
  clear();
  const from = head.getBoundingClientRect();
  const clone = head.cloneNode(true) as HTMLElement;
  clone.classList.add('handoff__item');
  clone.style.cssText += `;position:fixed;left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;margin:0;transform-origin:0 0;`;
  const layer = document.createElement('div');
  layer.className = 'handoff';
  layer.setAttribute('aria-hidden', 'true');
  layer.append(clone);
  document.body.append(layer);
  head.style.visibility = 'hidden';
  // Sicherheitsnetz: meldet das Spiel kein Ziel (Fehler, kein 3D), verschwindet die Kopie von selbst
  const timer = window.setTimeout(() => { if (pending?.clone === clone) fadeAway(); }, 1800);
  pending = { clone, layer, from, path, t: performance.now(), timer };
  // Startseite weich weg (die Kopie bleibt), dann die Seite wechseln – die Ausblendung endet mit dem Wechsel,
  // sonst bliebe die neue Seite unsichtbar
  const root = document.getElementById('root');
  let out: Animation | null = null;
  try {
    out = root?.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.985)' }], { duration: 150, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'forwards' }) ?? null;
  } catch { /* ohne Animation */ }
  window.setTimeout(() => {
    out?.cancel();
    head.style.visibility = '';
    navigate(path);
  }, 140);
}

function fadeAway() {
  const p = pending;
  if (!p) return;
  pending = null;
  window.clearTimeout(p.timer);
  try {
    p.clone.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease' }).finished.finally(() => p.layer.remove());
  } catch { p.layer.remove(); }
}

/** die Bewegung von HANDOFF_EASE als Funktion (weich ankommend, kein Überschwingen) */
function ease(k: number): number {
  const u = 1 - Math.max(0, Math.min(1, k));
  return 1 - u * u * u;
}

/**
 * Im Spiel, sobald das Startblatt steht (vor dem ersten Bild): head = der Kopf im Blatt (gleicher Aufbau wie auf der
 * Startseite), sheet = das Blatt. Die Kopie fliegt zum Kopf, das Blatt steigt dabei auf – beides von Hand Bild für
 * Bild, denn das Ziel wird jedes Bild neu gemessen: lädt noch etwas nach und das Blatt wächst, zieht der Kopf mit.
 * Ergibt false, wenn kein Übergang läuft – dann blendet das Blatt für sich ein.
 */
export function endHandoff(head: HTMLElement, sheet: HTMLElement): boolean {
  const p = pending;
  if (!p) return false;
  pending = null;
  window.clearTimeout(p.timer);
  head.style.visibility = 'hidden';
  const t0 = performance.now();
  const RISE = 36;
  let raf = 0;
  const done = () => {
    cancelAnimationFrame(raf);
    head.style.visibility = '';
    sheet.style.transform = '';
    sheet.style.opacity = '';
    p.layer.remove();
  };
  const tick = (now: number) => {
    const k = Math.min(1, (now - t0) / HANDOFF_MS);
    const e = ease(k);
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

/** Startblatt weg (Losfahren): gleitet nach unten, dann weiter */
export function sheetOut(sheet: HTMLElement): Promise<void> {
  if (calm()) return Promise.resolve();
  try {
    const a = sheet.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(60px)', opacity: 0 }], { duration: 260, easing: 'cubic-bezier(0.4, 0, 0.7, 0.2)', fill: 'forwards' });
    return a.finished.then(() => undefined, () => undefined);
  } catch { return Promise.resolve(); }
}

/** beim Verlassen der Startseite ohne Spiel (z. B. Zurück): aufräumen */
export function cancelHandoff() {
  clear();
}
