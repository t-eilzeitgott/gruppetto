/**
 * Eine 3D-Bühne (Leinwand + Renderer) für alle Minispiele, die zwischen den Besuchen erhalten bleibt:
 * Beim App-Start wird sie unsichtbar vorgewärmt (Shader übersetzt, Landschaft des wahrscheinlichsten Spiels
 * gebaut). Öffnet man ein Spiel, wird die fertige Leinwand nur eingehängt – die Welt ist sofort da statt
 * kurz schwarz. Beim Verlassen wandert sie zurück in den Vorrat (ein verlorener Kontext wird verworfen).
 */
import { Renderer3D } from './render3d';
import { attachWeather, type WeatherFx } from './weather';
import type { RaceView } from './engine';
import { uiBusy } from '../uiBusy';
import { setGfxScope } from './viewRange';

export interface Stage {
  renderer: Renderer3D; canvas: HTMLCanvasElement; overlay: HTMLCanvasElement; weather: WeatherFx | null;
  /** welches Spiel zuletzt auf dieser Bühne stand (vorgewärmt oder gespielt) */
  game: string | null;
}

let spare: Stage | null = null;
let inUse = 0;
let holder: HTMLDivElement | null = null;

function makeStage(): Stage {
  const canvas = document.createElement('canvas');
  canvas.className = 'abf__canvas';
  const overlay = document.createElement('canvas');
  overlay.className = 'abf__overlay';
  overlay.setAttribute('aria-hidden', 'true');
  const renderer = new Renderer3D(canvas, overlay);
  // Wetter (Schatten, Licht, Nachbearbeitung) vor dem ersten Bild anhängen – so übersetzt das Vorwärmen gleich die richtigen Shader
  return { renderer, canvas, overlay, weather: attachWeather(renderer), game: null };
}

function drop(s: Stage) {
  s.weather?.dispose();
  s.renderer.dispose();
}

/** liegt eine vorgewärmte Bühne bereit? */
export function hasWarmStage(): boolean {
  return !!spare && !spare.renderer.lost;
}

/** für welches Spiel die Bühne im Vorrat steht (null: keine oder leer) */
export function warmGameId(): string | null {
  return spare && !spare.renderer.lost ? spare.game : null;
}

/** ist ein Spiel offen (dann wird nicht vorgewärmt)? */
export function stageInUse(): boolean {
  return inUse > 0;
}

/** Bühne für ein Spiel: die vorgewärmte oder eine neue (wirft, wenn kein WebGL) */
export function acquireStage(game: string): Stage {
  // Auflösung und Sichtweite merkt sich das Gerät je Spiel
  setGfxScope(game);
  const s = spare;
  spare = null;
  if (s && !s.renderer.lost) {
    inUse += 1;
    s.game = game;
    // jetzt sieht jemand zu: das Vorbauen der Welt tritt hinter ein flüssiges Bild zurück
    s.renderer.idleK = 0.3;
    return s;
  }
  if (s) drop(s);
  const fresh = makeStage();
  fresh.game = game;
  fresh.renderer.idleK = 0.3;
  inUse += 1;
  return fresh;
}

/** Spiel verlassen: Leinwand aushängen und für das nächste Mal behalten */
export function releaseStage(s: Stage) {
  inUse = Math.max(0, inUse - 1);
  s.canvas.remove();
  s.overlay.remove();
  if (spare || s.renderer.lost) drop(s);
  else spare = s;
}

interface WarmEngine extends RaceView { update(dt: number): void; setViewport(w: number): void }

/**
 * Unsichtbar vorwärmen: Bühne anlegen, ein paar Bilder des Spiels zeichnen (übersetzt alle Shader, baut die
 * Landschaft rund um den Start), dann in den Vorrat legen. Bricht ab, wenn inzwischen ein Spiel offen ist.
 * game: Kennung des Spiels; reuse: eine Bühne im Vorrat für dieses Spiel umbauen (die Shader bleiben – nur die
 * Welt entsteht neu), sonst nur vorwärmen, wenn der Vorrat leer ist.
 */
export function prewarm(make: () => WarmEngine, theme: { accent: string; dark: boolean }, game: string, reuse = false, frames = reuse ? 30 : 8): Promise<void> {
  // Testmodus ohne 3D (?nogl): nichts vorwärmen
  let off = /[?&]nogl\b/.test(window.location.search);
  // automatische Oberflächenprüfung: ohne Grafikchip würde das Vorwärmen die Seiten lange blockieren
  try { off = off || localStorage.getItem('gruppetto.nowarm') === '1'; } catch { /* egal */ }
  if (inUse > 0 || off || (spare && !reuse)) return Promise.resolve();
  let s: Stage;
  // Umbau: die Bühne bleibt im Vorrat (ein Spiel darf sie jederzeit nehmen – dann hört der Umbau einfach auf)
  let held = false;
  if (spare && !spare.renderer.lost) {
    s = spare;
    held = true;
  } else {
    if (spare) { drop(spare); spare = null; }
    try {
      s = makeStage();
    } catch {
      return Promise.resolve();
    }
  }
  s.game = game;
  setGfxScope(game);
  // erstes Vorwärmen (unter dem Intro): mit allem, was geht; Umbau, während jemand die Startseite bedient: in
  // kleinen Portionen über mehr Bilder, damit die Seite flüssig bleibt
  s.renderer.idleK = reuse ? 0.35 : 1;
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
    if (held) spare = null;
    drop(s);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let n = 0;
    const step = () => {
      if (held && spare !== s) {
        // ein Spiel hat die Bühne mitten im Umbau genommen (die Leinwand hängt schon dort) – fertig
        resolve();
        return;
      }
      // während jemand wischt oder die Oberfläche sich bewegt: dieses Bild auslassen
      if (uiBusy()) {
        requestAnimationFrame(step);
        return;
      }
      if (s.renderer.lost || (!held && (inUse > 0 || spare))) {
        // inzwischen hat ein Spiel eine eigene Bühne – diese nicht mehr nötig
        s.canvas.remove();
        s.overlay.remove();
        if (held) spare = null;
        drop(s);
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
