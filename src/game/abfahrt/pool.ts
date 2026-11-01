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
import { gfxOn, setStageAA } from './gfxOpts';

export interface Stage {
  renderer: Renderer3D; canvas: HTMLCanvasElement; overlay: HTMLCanvasElement; weather: WeatherFx | null;
  /** welches Spiel zuletzt auf dieser Bühne stand (vorgewärmt oder gespielt) */
  game: string | null;
  /** zeigt kein Bild mehr (Wächter, siehe watchStage) – nicht wieder verwenden */
  broken?: boolean;
}

let spare: Stage | null = null;
let inUse = 0;
/** vom Wächter neu gebaute Bühnen (höchstens zwei je App-Start – falls ein Gerät den Bildpunkt nie lesen lässt) */
let rescues = 0;
let holder: HTMLDivElement | null = null;

function makeStage(): Stage {
  const canvas = document.createElement('canvas');
  canvas.className = 'abf__canvas';
  const overlay = document.createElement('canvas');
  overlay.className = 'abf__overlay';
  overlay.setAttribute('aria-hidden', 'true');
  const renderer = new Renderer3D(canvas, overlay);
  setStageAA(renderer.aa);
  // Wetter (Schatten, Licht, Nachbearbeitung) vor dem ersten Bild anhängen – so übersetzt das Vorwärmen gleich die richtigen Shader
  return { renderer, canvas, overlay, weather: attachWeather(renderer), game: null };
}

/**
 * passt die Bühne zur Grafikstufe? Nur die PC-Grafik entsteht mit dem Renderer – nach einem Wechsel darüber hinweg
 * baut das nächste Spiel eine neue Bühne. Die Kantenglättung zählt nicht (sie bleibt bis zum nächsten App-Start,
 * siehe gfxOpts.stageAA)
 */
const fits = (s: Stage) => !s.broken && !s.renderer.lost && s.renderer.pc === gfxOn('pc');

function drop(s: Stage) {
  s.weather?.dispose();
  s.renderer.dispose();
}

/** liegt eine vorgewärmte Bühne bereit? */
export function hasWarmStage(): boolean {
  return !!spare && fits(spare);
}

/** für welches Spiel die Bühne im Vorrat steht (null: keine oder leer) */
export function warmGameId(): string | null {
  return spare && fits(spare) ? spare.game : null;
}

/** ist ein Spiel offen (dann wird nicht vorgewärmt)? */
export function stageInUse(): boolean {
  return inUse > 0;
}

/** Bühne für ein Spiel: die vorgewärmte oder eine neue (wirft, wenn kein WebGL) */
export function acquireStage(game: string): Stage {
  const s = spare;
  spare = null;
  if (s && fits(s)) {
    inUse += 1;
    s.game = game;
    // jetzt sieht jemand zu: das Vorbauen der Welt tritt hinter ein flüssiges Bild zurück
    s.renderer.idleK = 0.3;
    s.renderer.active = true;
    return s;
  }
  if (s) drop(s);
  const fresh = makeStage();
  fresh.game = game;
  fresh.renderer.idleK = 0.3;
  fresh.renderer.active = true;
  inUse += 1;
  return fresh;
}

/** Spiel verlassen: Leinwand aushängen und für das nächste Mal behalten */
export function releaseStage(s: Stage) {
  inUse = Math.max(0, inUse - 1);
  s.renderer.active = false;
  s.canvas.remove();
  s.overlay.remove();
  if (spare || s.broken || s.renderer.lost) drop(s);
  else spare = s;
}

/**
 * Wächter für die Bühne eines laufenden Spiels – direkt nach jedem Zeichnen aufrufen. Prüft am Anfang (nach 1, 3 und
 * 6 Sekunden) und danach alle 20 Sekunden: hängt die Leinwand noch im Spiel und ist sie eingeblendet (sonst wieder
 * einhängen)? Kommt das Bild an? Bleibt es zweimal hintereinander leer, obwohl gezeichnet wird (ein still
 * gestorbener Grafikkontext – auf dem iPhone sah man dann nur noch Schwarz), meldet er true: neue Bühne bauen.
 */
export function watchStage(s: Stage, host: HTMLElement): () => boolean {
  const t0 = performance.now();
  const at = [1000, 3000, 6000];
  let next = 0;
  let blanks = 0;
  return () => {
    const t = performance.now() - t0;
    const due = next < at.length ? at[next] : at[at.length - 1] + (next - at.length + 1) * 20000;
    if (t < due) return false;
    next += 1;
    if (s.canvas.parentElement !== host) host.append(s.canvas, s.overlay);
    if (!s.canvas.classList.contains('is-drawn')) s.canvas.classList.add('is-drawn');
    if (document.visibilityState !== 'visible') return false;
    blanks = s.renderer.blank() ? blanks + 1 : 0;
    if (blanks < 2 || rescues >= 2) return false;
    rescues += 1;
    console.warn('Bühne zeigt kein Bild – neu gebaut');
    s.broken = true;
    return true;
  };
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
  if (inUse > 0 || off || (spare && !reuse && fits(spare))) return Promise.resolve();
  // die Bühne im Vorrat passt nicht mehr (PC-Grafik umgeschaltet, Kontext verloren): erst freigeben, dem Browser
  // einen Moment zum Aufräumen lassen, dann eine neue anlegen (sofort hintereinander blieb das Bild manchmal schwarz)
  if (spare && !fits(spare)) {
    drop(spare);
    spare = null;
    return new Promise<void>((r) => window.setTimeout(r, 350)).then(() => prewarm(make, theme, game, reuse, frames));
  }
  let s: Stage;
  // Umbau: die Bühne bleibt im Vorrat (ein Spiel darf sie jederzeit nehmen – dann hört der Umbau einfach auf)
  let held = false;
  if (spare && fits(spare)) {
    s = spare;
    held = true;
  } else {
    try {
      s = makeStage();
    } catch {
      return Promise.resolve();
    }
  }
  s.game = game;
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
