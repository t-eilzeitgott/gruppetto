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
  /** clip: Kante des Aufdeckens so weit rechts vom Anfang des Punkts (px) – unter die Mitte eines größeren Punkts */
  edge?: number;
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
    const e = o.edge ?? 0;
    c.A(c.word, [{ clipPath: `inset(-40% ${hidden - e}px -50% -30%)` }, { clipPath: `inset(-40% ${-e}px -50% -30%)` }], { duration: dur, delay: 300, easing: ROLL, fill: 'both' });
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

/** Kubische Bézier-Kurve (wie CSS cubic-bezier): Fortschritt zu Zeitanteil und umgekehrt (für Kurven ohne Überschwingen) */
export function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const tOf = (x: number) => {
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  const y = (x: number) => sy(tOf(Math.max(0, Math.min(1, x))));
  return {
    css: `cubic-bezier(${x1},${y1},${x2},${y2})`,
    y,
    /** Zeitanteil, bei dem der Fortschritt p erreicht ist */
    inv(p: number) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (y(m) < p) lo = m; else hi = m; }
      return (lo + hi) / 2;
    },
  };
}

export interface Letter {
  /** äußere Hülle (Fahrt), innere (Hüpfen, Strecken) */
  el: HTMLElement;
  inner: HTMLElement;
  /** Mitte und Breite am Ende (Bildschirm) */
  x: number;
  w: number;
}

/** Wort in einzelne Buchstaben zerlegen (je zwei Hüllen, inline-block) und ihre Lage am Ende messen */
export function letters(c: Ctx): Letter[] {
  const text = c.word.textContent ?? '';
  c.word.textContent = '';
  const out: Letter[] = [];
  for (const ch of text) {
    const el = h('span', 'ix-l', 'display:inline-block');
    const inner = h('span', '', 'display:inline-block');
    inner.textContent = ch;
    el.appendChild(inner);
    c.word.appendChild(el);
    out.push({ el, inner, x: 0, w: 0 });
  }
  for (const l of out) {
    const r = l.el.getBoundingClientRect();
    l.x = r.left + r.width / 2;
    l.w = r.width;
  }
  // ohne Unterschneidung zwischen den Buchstaben ändert sich die Breite minimal: Punkt und Wort neu messen
  const dr = c.dot.getBoundingClientRect();
  const wr = c.word.getBoundingClientRect();
  const { pc } = c.geo;
  c.geo.dot = { x: dr.left + pc.x, y: dr.top + pc.y, base: dr.top + pc.base };
  c.geo.word = { left: wr.left, right: wr.right, top: wr.top, bottom: wr.bottom };
  return out;
}

