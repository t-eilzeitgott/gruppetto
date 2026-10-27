/**
 * Eine 3D-Bühne (Leinwand + Renderer) für alle Minispiele, die zwischen den Besuchen erhalten bleibt:
 * Beim App-Start wird sie unsichtbar vorgewärmt (Shader übersetzt, Landschaft des wahrscheinlichsten Spiels
 * gebaut). Öffnet man ein Spiel, wird die fertige Leinwand nur eingehängt – die Welt ist sofort da statt
 * kurz schwarz. Beim Verlassen wandert sie zurück in den Vorrat (ein verlorener Kontext wird verworfen).
 */
import { Renderer3D } from './render3d';
import type { RaceView } from './engine';

export interface Stage { renderer: Renderer3D; canvas: HTMLCanvasElement; overlay: HTMLCanvasElement }

let spare: Stage | null = null;
let inUse = 0;
let holder: HTMLDivElement | null = null;

function makeStage(): Stage {
  const canvas = document.createElement('canvas');
  canvas.className = 'abf__canvas';
  const overlay = document.createElement('canvas');
  overlay.className = 'abf__overlay';
  overlay.setAttribute('aria-hidden', 'true');
  return { renderer: new Renderer3D(canvas, overlay), canvas, overlay };
}

/** liegt eine vorgewärmte Bühne bereit? */
export function hasWarmStage(): boolean {
  return !!spare && !spare.renderer.lost;
}

/** Bühne für ein Spiel: die vorgewärmte oder eine neue (wirft, wenn kein WebGL) */
export function acquireStage(): Stage {
  const s = spare;
  spare = null;
  if (s && !s.renderer.lost) {
    inUse += 1;
    return s;
  }
  s?.renderer.dispose();
  const fresh = makeStage();
  inUse += 1;
  return fresh;
}

/** Spiel verlassen: Leinwand aushängen und für das nächste Mal behalten */
export function releaseStage(s: Stage) {
  inUse = Math.max(0, inUse - 1);
  s.canvas.remove();
  s.overlay.remove();
  if (spare || s.renderer.lost) s.renderer.dispose();
  else spare = s;
}

interface WarmEngine extends RaceView { update(dt: number): void; setViewport(w: number): void }

/**
 * Unsichtbar vorwärmen: Bühne anlegen, ein paar Bilder des Spiels zeichnen (übersetzt alle Shader, baut die
 * Landschaft rund um den Start), dann in den Vorrat legen. Bricht ab, wenn inzwischen ein Spiel offen ist.
 */
export function prewarm(make: () => WarmEngine, theme: { accent: string; dark: boolean }, frames = 8): Promise<void> {
  // Testmodus ohne 3D (?nogl): nichts vorwärmen
  let off = /[?&]nogl\b/.test(window.location.search);
  // automatische Oberflächenprüfung: ohne Grafikchip würde das Vorwärmen die Seiten lange blockieren
  try { off = off || localStorage.getItem('gruppetto.nowarm') === '1'; } catch { /* egal */ }
  if (spare || inUse > 0 || off) return Promise.resolve();
  let s: Stage;
  try {
    s = makeStage();
  } catch {
    return Promise.resolve();
  }
  // in echter Größe, aber unsichtbar (sonst misst die Leinwand 0 × 0)
  holder ??= Object.assign(document.createElement('div'), { className: 'stage-holder' });
  if (!holder.isConnected) document.body.append(holder);
  holder.append(s.canvas, s.overlay);
  s.renderer.setTheme(theme.accent, theme.dark);
  s.renderer.resize();
  let eng: WarmEngine;
  try {
    eng = make();
    eng.setViewport(window.innerWidth);
  } catch {
    s.canvas.remove();
    s.overlay.remove();
    s.renderer.dispose();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let n = 0;
    const step = () => {
      if (inUse > 0 || spare || s.renderer.lost) {
        // inzwischen hat ein Spiel eine eigene Bühne – diese nicht mehr nötig
        s.canvas.remove();
        s.overlay.remove();
        s.renderer.dispose();
        resolve();
        return;
      }
      try {
        eng.update(1 / 60);
        s.renderer.draw(eng, 1 / 60);
      } catch {
        n = frames;
      }
      n += 1;
      if (n === 1) s.canvas.classList.add('is-drawn');
      if (n < frames) {
        requestAnimationFrame(step);
        return;
      }
      s.canvas.remove();
      s.overlay.remove();
      spare = s;
      resolve();
    };
    requestAnimationFrame(step);
  });
}
