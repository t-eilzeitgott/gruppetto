/**
 * Bausteine der Start-Animationen: was eine Variante vom Intro bekommt (Elemente, Maße, Uhr) und die gewohnte
 * Bewegung „g. rollt das Wort aus" zum Wiederverwenden.
 *
 * Zeit: Animationen über A() gehören zur Sequenz – sie laufen mit der Uhr des Intros (pausiert, wenn der Browser
 * beim App-Start keine Bilder zeichnet, und am Ende beschleunigt, sobald die App bereit ist). F() ist Schmuck, der
 * frei nebenher läuft (Schneefall, Flackern …) und das Ende nicht aufhält.
 */
import type { IntroPick } from './schedule';

export interface Geo {
  /** Schriftgröße der Wortmarke (px) */
  fs: number;
  /** Breite des „g", verdeckter Rest des Worts, halbe Verschiebung (zentriertes „g.") */
  gW: number;
  hidden: number;
  shift: number;
  /** Tinte des Punkts relativ zum Kasten .intro__dot: Mitte, Radius, Grundlinie */
  pc: { x: number; y: number; r: number; base: number };
  /** Bildschirmlage am Ende der Sequenz: Punktmitte und Grundlinie, Kasten des Worts */
  dot: { x: number; y: number; base: number };
  word: { left: number; right: number; top: number; bottom: number };
  vw: number;
  vh: number;
}

export interface Ctx {
  el: HTMLElement;
  mark: HTMLElement;
  word: HTMLElement;
  roll: HTMLElement;
  cover: HTMLElement;
  dot: HTMLElement;
  dotin: HTMLElement;
  ping: HTMLElement;
  bg: HTMLElement;
  /** Ebene hinter bzw. vor der Wortmarke (über den ganzen Schirm) */
  back: HTMLElement;
  front: HTMLElement;
  calm: boolean;
  dark: boolean;
  geo: Geo;
  pick: IntroPick;
  A(n: Element, k: Keyframe[], o: KeyframeEffectOptions): Animation;
  F(n: Element, k: Keyframe[], o: KeyframeEffectOptions): Animation;
  /** bei Zeit ms der Sequenz */
  at(ms: number, f: () => void): void;
  css(s: string): void;
}

export interface Hooks {
  /** wann der Punkt aufgesetzt hat (ms) – dann startet idle bzw. der Ring */
  land?: number;
  /** Ring um den Punkt beim Warten (Standard: ja) */
  ping?: boolean;
  /** Warten, bis die App bereit ist (statt Ring) */
  idle?(): void;
  /** die Wortmarke fliegt an ihren Platz (dur ms): Schmuck zurück zum Punkt */
  leave?(dur: number): void;
}

export type Variant = (c: Ctx) => Hooks | void;

export const ROLL = 'cubic-bezier(.6,0,.3,1)';
export const OUT = 'cubic-bezier(.2,.9,.3,1.12)';

/** Element mit Klasse, Stil, Inhalt */
export function h(tag: string, cls = '', style = '', html = ''): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (style) e.style.cssText = style;
  if (html) e.innerHTML = html;
  return e;
}

/**
 * Element am Punkt (im Kasten .intro__dot, rollt und hüpft mit): Breite w, Höhe hh; Anker ax/ay (Anteil des
 * Elements) liegt auf der Punktmitte bzw. der Grundlinie, verschoben um dx/dy
 */
export function onDot(c: Ctx, node: HTMLElement, w: number, hh: number, o: { ax?: number; ay?: number; dx?: number; dy?: number; mid?: boolean } = {}) {
  const { pc } = c.geo;
  const ax = o.ax ?? 0.5, ay = o.ay ?? 1;
  const y = o.mid ? pc.y : pc.base;
  node.style.position = 'absolute';
  node.style.left = `${pc.x - w * ax + (o.dx ?? 0)}px`;
  node.style.top = `${y - hh * ay + (o.dy ?? 0)}px`;
  node.style.width = `${w}px`;
  node.style.height = `${hh}px`;
  c.dot.appendChild(node);
  return node;
}

/** Element auf dem Schirm (Ebene back/front) mit Mitte bei (x, y) */
export function at(layer: HTMLElement, node: HTMLElement, x: number, y: number, w: number, hh: number) {
  node.style.position = 'absolute';
  node.style.left = `${x - w / 2}px`;
  node.style.top = `${y - hh / 2}px`;
  node.style.width = `${w}px`;
  node.style.height = `${hh}px`;
  layer.appendChild(node);
  return node;
}

/** den Punkt („.") unsichtbar machen – die Wortmarke misst ihn weiter; beim Abflug blendet er wieder ein */
export function hideDot(c: Ctx) {
  c.dotin.style.opacity = '0';
}
export function showDot(c: Ctx, dur: number, delay = 0) {
  c.dotin.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, delay, easing: 'ease', fill: 'forwards' });
}

export interface RollOpts {
  /** Wort mit clip-path aufdecken statt mit der Abdeckung in Hintergrundfarbe (für Hintergründe mit Bild) */
  clip?: boolean;
  /** Höhe der Hüpfer (1 = gewohnt, 0 = keine) */
  hop?: number;
  /** was beim Aufsetzen gestaucht wird (Standard: der Punkt) */
  squash?: Element | null;
  /** was sich beim Rollen dreht (Umdrehungen) */
  spin?: Element | null;
  turns?: number;
  /** Dauer des Rollens (ms, gewohnt 650) */
  dur?: number;
}

/** die gewohnte Bewegung: „g." erscheint mittig, der Punkt rollt das Wort aus und setzt auf */
export function rollOut(c: Ctx, o: RollOpts = {}): { land: number } {
  const { shift, hidden } = c.geo;
  const dur = o.dur ?? 650;
  const end = 300 + dur;
  if (c.calm) return { land: 0 };
  c.A(c.mark, [
    { offset: 0, opacity: 0, transform: `translateX(${shift}px) scale(.84)`, easing: OUT },
    { offset: 0.3, opacity: 1, transform: `translateX(${shift}px) scale(1)`, easing: ROLL },
    { offset: 1, opacity: 1, transform: 'translateX(0) scale(1)' },
  ], { duration: end, fill: 'both' });
  c.A(c.roll, [{ transform: `translateX(${-hidden}px)` }, { transform: 'translateX(0)' }], { duration: dur, delay: 300, easing: ROLL, fill: 'both' });
  if (o.clip) {
    c.cover.style.display = 'none';
    c.A(c.word, [{ clipPath: `inset(-40% ${hidden}px -50% -30%)` }, { clipPath: 'inset(-40% 0px -50% -30%)' }], { duration: dur, delay: 300, easing: ROLL, fill: 'both' });
  } else {
    c.A(c.cover, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, delay: end, fill: 'both' });
  }
  const k = o.hop ?? 1;
  if (k > 0) {
    c.A(c.dot, [
      { transform: 'translateY(0)' }, { transform: `translateY(${-0.13 * k}em)` }, { transform: 'translateY(0)' },
      { transform: `translateY(${-0.08 * k}em)` }, { transform: 'translateY(0)' }, { transform: `translateY(${-0.035 * k}em)` }, { transform: 'translateY(0)' },
    ], { duration: dur, delay: 300, easing: 'ease-in-out', fill: 'both' });
  }
  if (o.spin) {
    c.A(o.spin, [{ transform: `rotate(${-360 * (o.turns ?? 2)}deg)` }, { transform: 'rotate(0deg)' }], { duration: dur, delay: 300, easing: ROLL, fill: 'both' });
  }
  const sq = o.squash === undefined ? c.dotin : o.squash;
  if (sq) {
    c.A(sq, [
      { transform: 'scale(1)' }, { transform: 'scale(1.32,.72)' }, { transform: 'scale(.9,1.14)' }, { transform: 'scale(1)' },
    ], { duration: 420, delay: end - 20, easing: 'ease-out', fill: 'both' });
  }
  return { land: end };
}

/** Zufall (für Teilchen) */
export const rnd = (a: number, b: number) => a + Math.random() * (b - a);
