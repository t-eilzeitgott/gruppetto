/**
 * Frankreich (Schauplätze der Tour 2027, venue.ts): Wahrzeichen der Etappenorte und Requisiten der Gegend.
 *
 * Wahrzeichen in die Netze des Abschnitts (Town), in der Ferne über dem Zielort (render3d.ts, planMarks): Leuchtturm
 * von Gatteville, Mont-Saint-Michel, Schloss Chambord, Schloss Angers, Kathedrale Sainte-Cécile in Albi, Basilika
 * Saint-Sernin in Toulouse, Kathedrale von Mende, Schloss Pau, Aquädukt Saint-Clément in Montpellier. Dazu auf der
 * Kuppe des Bergfinales der Géant du Tourmalet. Maße nach den echten Bauten, Formen vereinfacht.
 *
 * Requisiten (Instanzen, Front −z zur Straße): bretonischer Kalvarienberg, Menhir, baskische Pelota-Wand (Fronton),
 * Elefantenbrunnen von Chambéry, Dampfhammer von Le Creusot.
 *
 * Koordinaten der Wahrzeichen: at(quer, längs, Höhe) um den Mittelpunkt des Baus.
 */
import * as THREE from 'three';
import { GB, lin, M, type RGBf } from './models3d';
import type { At, Town } from './house3d';
import { box, cyl, dome } from './paris3d';

const sh = (c: RGBf, f: number): RGBf => [c[0] * f, c[1] * f, c[2] * f];
const mix = (a: RGBf, b: RGBf, t: number): RGBf => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const PI = Math.PI;
/** fester Zufall je Bau (gleich für alle) */
const rnd = (n: number) => {
  let x = Math.imul(n ^ 0x2c1b3c6d, 0x297a2d39);
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
};

const SLATE = lin('#4b4f56');
const DARK = lin('#23252a');
const GOLD = lin('#cfa648');
const U = 1.9;

// ------------------------------------------------------------------ Bausteine

/** senkrechte Wand zwischen zwei Punkten im Grundriss (mit Fugen, wenn es Mauerwerk gibt) */
function wall(T: Town, at: At, l0: number, a0: number, l1: number, a1: number, h0: number, h1: number, col: RGBf) {
  const gb = T.stone ?? T.plain;
  const len = Math.hypot(l1 - l0, a1 - a0);
  gb.quad(at(l0, a0, h0), at(l1, a1, h0), at(l1, a1, h1), at(l0, a0, h1), col, [[0, h0 / U], [len / U, h0 / U], [len / U, h1 / U], [0, h1 / U]]);
}

/** Quader aus Mauerwerk (vier Wände, Deckel einfarbig) */
function stoneBox(T: Town, at: At, l0: number, l1: number, a0: number, a1: number, h0: number, h1: number, col: RGBf, top = true) {
  wall(T, at, l0, a0, l1, a0, h0, h1, col);
  wall(T, at, l1, a0, l1, a1, h0, h1, sh(col, 0.9));
  wall(T, at, l1, a1, l0, a1, h0, h1, sh(col, 0.95));
  wall(T, at, l0, a1, l0, a0, h0, h1, sh(col, 0.88));
  if (top) T.plain.quad(at(l0, a0, h1), at(l1, a0, h1), at(l1, a1, h1), at(l0, a1, h1), sh(col, 1.04));
}

/** Satteldach über dem Rechteck, First längs (along) oder quer */
function gable(gb: GB, at: At, l0: number, l1: number, a0: number, a1: number, h: number, rise: number, col: RGBf, alongRidge = true, ov = 0.4) {
  if (alongRidge) {
    const lm = (l0 + l1) / 2;
    gb.quad(at(l0 - ov, a0 - ov, h), at(l0 - ov, a1 + ov, h), at(lm, a1 + ov, h + rise), at(lm, a0 - ov, h + rise), col);
    gb.quad(at(l1 + ov, a1 + ov, h), at(l1 + ov, a0 - ov, h), at(lm, a0 - ov, h + rise), at(lm, a1 + ov, h + rise), sh(col, 0.9));
    gb.tri(at(l0, a0, h), at(l1, a0, h), at(lm, a0, h + rise), sh(col, 0.8));
    gb.tri(at(l1, a1, h), at(l0, a1, h), at(lm, a1, h + rise), sh(col, 0.8));
  } else {
    const am = (a0 + a1) / 2;
    gb.quad(at(l1 + ov, a0 - ov, h), at(l0 - ov, a0 - ov, h), at(l0 - ov, am, h + rise), at(l1 + ov, am, h + rise), col);
    gb.quad(at(l0 - ov, a1 + ov, h), at(l1 + ov, a1 + ov, h), at(l1 + ov, am, h + rise), at(l0 - ov, am, h + rise), sh(col, 0.9));
    gb.tri(at(l0, a0, h), at(l0, a1, h), at(l0, am, h + rise), sh(col, 0.8));
    gb.tri(at(l1, a1, h), at(l1, a0, h), at(l1, am, h + rise), sh(col, 0.8));
  }
}

/** Walmdach (Pyramide, wenn quadratisch) */
function hip(gb: GB, at: At, l0: number, l1: number, a0: number, a1: number, h: number, rise: number, col: RGBf, ov = 0.4) {
  const lm = (l0 + l1) / 2, am = (a0 + a1) / 2;
  const dl = (l1 - l0) / 2, da = (a1 - a0) / 2;
  const r = Math.min(dl, da);
  const R0 = [lm - (dl - r), am - (da - r)], R1 = [lm + (dl - r), am + (da - r)];
  const L0 = l0 - ov, L1 = l1 + ov, A0 = a0 - ov, A1 = a1 + ov;
  gb.quad(at(L0, A0, h), at(L1, A0, h), at(R1[0], R0[1], h + rise), at(R0[0], R0[1], h + rise), col);
  gb.quad(at(L1, A1, h), at(L0, A1, h), at(R0[0], R1[1], h + rise), at(R1[0], R1[1], h + rise), sh(col, 0.92));
  gb.quad(at(L0, A1, h), at(L0, A0, h), at(R0[0], R0[1], h + rise), at(R0[0], R1[1], h + rise), sh(col, 0.85));
  gb.quad(at(L1, A0, h), at(L1, A1, h), at(R1[0], R1[1], h + rise), at(R1[0], R0[1], h + rise), sh(col, 0.88));
}

/** Fensterreihe auf einer Wand zwischen zwei Punkten (dunkle Rechtecke etwas vor der Wand, Seite out ±1) */
function windows(gb: GB, at: At, l0: number, a0: number, l1: number, a1: number, h0: number, h1: number, step: number, w: number, out: number, col = DARK, frame?: RGBf) {
  const len = Math.hypot(l1 - l0, a1 - a0);
  const ul = (l1 - l0) / len, ua = (a1 - a0) / len;
  // Normale rechts der Laufrichtung, mit out nach außen
  const nl = ua * out * 0.06, na = -ul * out * 0.06;
  const n = Math.max(1, Math.floor(len / step));
  const pad = (len - n * step) / 2 + step / 2;
  for (let k = 0; k < n; k++) {
    const s = pad + k * step;
    const p = (d: number, h: number, f = 1) => at(l0 + ul * (s + d) + nl * f, a0 + ua * (s + d) + na * f, h);
    if (frame) gb.quad(p(-w / 2 - 0.25, h0 - 0.25, 0.6), p(w / 2 + 0.25, h0 - 0.25, 0.6), p(w / 2 + 0.25, h1 + 0.25, 0.6), p(-w / 2 - 0.25, h1 + 0.25, 0.6), frame);
    gb.quad(p(-w / 2, h0), p(w / 2, h0), p(w / 2, h1), p(-w / 2, h1), col);
  }
}

/** Fensterreihen auf allen vier Seiten eines Quaders */
function boxWindows(gb: GB, at: At, l0: number, l1: number, a0: number, a1: number, rows: [number, number][], step: number, w: number, col = DARK, frame?: RGBf) {
  for (const [h0, h1] of rows) {
    windows(gb, at, l0, a0, l1, a0, h0, h1, step, w, -1, col, frame);
    windows(gb, at, l1, a0, l1, a1, h0, h1, step, w, -1, col, frame);
    windows(gb, at, l1, a1, l0, a1, h0, h1, step, w, -1, col, frame);
    windows(gb, at, l0, a1, l0, a0, h0, h1, step, w, -1, col, frame);
  }
}

/** Rundturm mit Mauerwerk (Mantel in n Stücken, Fugen) */
function roundTower(T: Town, at: At, cl: number, ca: number, r: number, h0: number, h1: number, col: RGBf | ((h: number) => RGBf), n = 14, band = 0) {
  const gb = T.stone ?? T.plain;
  const C = 2 * PI * r;
  const bands = band > 0 ? Math.ceil((h1 - h0) / band) : 1;
  for (let b = 0; b < bands; b++) {
    const y0 = h0 + ((h1 - h0) * b) / bands, y1 = h0 + ((h1 - h0) * (b + 1)) / bands;
    const c = typeof col === 'function' ? col((y0 + y1) / 2) : col;
    for (let k = 0; k < n; k++) {
      const t0 = (k / n) * 2 * PI, t1 = ((k + 1) / n) * 2 * PI;
      const s0 = (C * k) / n / U, s1 = (C * (k + 1)) / n / U;
      gb.quad(at(cl + Math.cos(t0) * r, ca + Math.sin(t0) * r, y0), at(cl + Math.cos(t1) * r, ca + Math.sin(t1) * r, y0),
        at(cl + Math.cos(t1) * r, ca + Math.sin(t1) * r, y1), at(cl + Math.cos(t0) * r, ca + Math.sin(t0) * r, y1),
        sh(c, 0.88 + 0.14 * Math.abs(Math.cos((t0 + t1) / 2 - 0.6))), [[s0, y0 / U], [s1, y0 / U], [s1, y1 / U], [s0, y1 / U]]);
    }
  }
}

/** Kegeldach (spitz) über einem Kreis */
const cone = (gb: GB, at: At, cl: number, ca: number, r: number, h0: number, h1: number, n: number, col: RGBf) => cyl(gb, at, cl, ca, r, 0, h0, h1, n, (k) => sh(col, 0.9 + 0.12 * Math.abs(Math.cos(((k + 0.5) / n) * 2 * PI - 0.6))), false);

/** Achteckhelm (Spitze) über einem Quadrat der halben Seite hw */
function spire(gb: GB, at: At, cl: number, ca: number, hw: number, h0: number, h1: number, col: RGBf) {
  const R = hw / Math.cos(PI / 8);
  for (let k = 0; k < 8; k++) {
    const t0 = PI / 8 + (k * PI) / 4, t1 = t0 + PI / 4;
    gb.tri(at(cl + Math.cos(t0) * R, ca + Math.sin(t0) * R, h0), at(cl + Math.cos(t1) * R, ca + Math.sin(t1) * R, h0), at(cl, ca, h1), sh(col, 0.88 + (k % 2) * 0.1));
  }
}

/** Zinnen auf einer Mauerkrone zwischen zwei Punkten */
function crenels(gb: GB, at: At, l0: number, a0: number, l1: number, a1: number, h: number, col: RGBf, w = 1.1, hh = 1.1, t = 0.6) {
  const len = Math.hypot(l1 - l0, a1 - a0);
  const ul = (l1 - l0) / len, ua = (a1 - a0) / len;
  const nl = ua * t, na = -ul * t;
  const n = Math.floor(len / (2 * w));
  for (let k = 0; k < n; k++) {
    const s = k * 2 * w + w / 2;
    const P = (d: number, o: number, y: number) => at(l0 + ul * (s + d) + nl * o, a0 + ua * (s + d) + na * o, y);
    gb.quad(P(0, -0.5, h), P(w, -0.5, h), P(w, -0.5, h + hh), P(0, -0.5, h + hh), col);
    gb.quad(P(w, 0.5, h), P(0, 0.5, h), P(0, 0.5, h + hh), P(w, 0.5, h + hh), sh(col, 0.9));
    gb.quad(P(0, -0.5, h + hh), P(w, -0.5, h + hh), P(w, 0.5, h + hh), P(0, 0.5, h + hh), sh(col, 1.05));
  }
}

// ------------------------------------------------------------------ Leuchtturm von Gatteville (75 m, Granit)

export function gatteville(T: Town, at: At) {
  const G = lin('#8f8c86');
  // Schaft: Granit, leicht verjüngt, schmale Fensterschlitze in einer Reihe
  for (let k = 0; k < 6; k++) {
    const h0 = k * 11, h1 = (k + 1) * 11;
    const r0 = 5.4 - (k / 6) * 1.6, r1 = 5.4 - ((k + 1) / 6) * 1.6;
    cyl(T.stone ?? T.plain, at, 0, 0, r0, r1, h0, h1, 16, (q) => sh(G, 0.9 + 0.12 * Math.abs(Math.cos(((q + 0.5) / 16) * 2 * PI - 0.6))), false);
    T.plain.quad(at(-0.35, -r0 - 0.02, h0 + 4), at(0.35, -r0 - 0.02, h0 + 4), at(0.35, -r1 - 0.02, h0 + 6.5), at(-0.35, -r1 - 0.02, h0 + 6.5), DARK);
  }
  // Kranz, Galerie mit Geländer, Laterne (Glas), Kupferkuppel
  cyl(T.plain, at, 0, 0, 3.8, 4.9, 65, 66.4, 16, sh(G, 1.05));
  cyl(T.plain, at, 0, 0, 4.9, 4.9, 66.4, 67.6, 20, lin('#2f3236'), false);
  cyl(T.plain, at, 0, 0, 2.7, 2.7, 66.4, 67.4, 12, sh(G, 0.95));
  cyl(T.plain, at, 0, 0, 2.5, 2.5, 67.4, 71.2, 12, lin('#3a4a52'));
  cyl(T.plain, at, 0, 0, 2.6, 2.6, 71.2, 71.6, 12, lin('#2f3236'));
  dome(T.plain, at, 0, 0, 2.6, 71.6, 1.0, 12, 4, lin('#4f7d6b'));
  cyl(T.plain, at, 0, 0, 0.18, 0.05, 74.1, 75.5, 6, lin('#2f3236'));
  // Wärterhäuser am Fuß: Granit, Schiefer
  for (const sg of [-1, 1]) {
    stoneBox(T, at, sg * 6, sg * 20, -4, 4, 0, 5.5, lin('#a29e95'));
    gable(T.plain, at, Math.min(sg * 6, sg * 20), Math.max(sg * 6, sg * 20), -4, 4, 5.5, 3.2, SLATE, false);
    windows(T.plain, at, sg * 6, -4, sg * 20, -4, 1.4, 3.2, 3.2, 1.1, -sg, DARK, lin('#e8e4dc'));
  }
  // alter Turm (heute Semaphor) daneben, weiß gekalkt
  roundTower(T, at, -26, 10, 3.2, 0, 26, lin('#e8e4dc'), 12);
  cyl(T.plain, at, -26, 10, 3.6, 3.6, 26, 27, 12, lin('#c9c4ba'));
}

// ------------------------------------------------------------------ Mont-Saint-Michel

export function montStMichel(T: Town, at: At) {
  const ROCK = lin('#7d776b');
  const ROCK2 = lin('#6c695f');
  const W = lin('#aca596');
  // Felsen: unregelmäßiger Kegel in Ringen
  const rings: [number, number][] = [[0, 150], [10, 130], [24, 100], [40, 74], [56, 50], [70, 34], [80, 22]];
  const n = 18;
  const rr = (j: number, k: number) => rings[j][1] * (0.82 + 0.3 * rnd(j * 31 + k * 7));
  for (let j = 0; j < rings.length - 1; j++) {
    for (let k = 0; k < n; k++) {
      const t0 = (k / n) * 2 * PI, t1 = ((k + 1) / n) * 2 * PI;
      const a0 = rr(j, k), a1 = rr(j, (k + 1) % n), b0 = rr(j + 1, k), b1 = rr(j + 1, (k + 1) % n);
      const c = mix(ROCK, ROCK2, rnd(j * 13 + k)) as RGBf;
      T.plain.quad(at(Math.cos(t0) * a0, Math.sin(t0) * a0, rings[j][0]), at(Math.cos(t1) * a1, Math.sin(t1) * a1, rings[j][0]),
        at(Math.cos(t1) * b1, Math.sin(t1) * b1, rings[j + 1][0]), at(Math.cos(t0) * b0, Math.sin(t0) * b0, rings[j + 1][0]), sh(c, 0.85 + 0.2 * Math.abs(Math.cos(t0 - 0.6))));
    }
  }
  const top = rings[rings.length - 1][0];
  // Wehrmauer mit Rundtürmen unten an der Straßenseite (−längs)
  const R = 128;
  for (let k = 0; k < 9; k++) {
    const t0 = PI * 1.15 + (k / 9) * PI * 0.7, t1 = PI * 1.15 + ((k + 1) / 9) * PI * 0.7;
    wall(T, at, Math.cos(t0) * R, Math.sin(t0) * R, Math.cos(t1) * R, Math.sin(t1) * R, 0, 13, W);
    crenels(T.plain, at, Math.cos(t0) * R, Math.sin(t0) * R, Math.cos(t1) * R, Math.sin(t1) * R, 13, W, 1.2, 1.2, 1.2);
    if (k % 3 === 0) { roundTower(T, at, Math.cos(t0) * R, Math.sin(t0) * R, 5, 0, 17, W, 12); cone(T.plain, at, Math.cos(t0) * R, Math.sin(t0) * R, 5.6, 17, 24, 12, SLATE); }
  }
  // Häuser des Dorfs am Hang (Granit, Schiefer)
  for (let k = 0; k < 26; k++) {
    const t = PI * 1.2 + rnd(k * 3) * PI * 0.6;
    const j = 1 + Math.floor(rnd(k * 5) * 3);
    const rad = rings[j][1] * 0.86;
    const cl = Math.cos(t) * rad, ca = Math.sin(t) * rad;
    const hh = rings[j][0];
    const w = 4 + rnd(k) * 3;
    stoneBox(T, at, cl - w / 2, cl + w / 2, ca - 3, ca + 3, hh - 4, hh + 6 + rnd(k * 9) * 4, mix(W, lin('#cfc6b4'), rnd(k * 11)) as RGBf);
    hip(T.plain, at, cl - w / 2, cl + w / 2, ca - 3, ca + 3, hh + 6 + rnd(k * 9) * 4, 3, SLATE, 0.3);
  }
  // Abtei: die Merveille (hohe Mauern), Kirche mit Querhaus und neugotischem Turm mit Helm und goldenem Erzengel
  stoneBox(T, at, -24, 16, 6, 30, top - 30, top + 22, W);
  windows(T.plain, at, -24, 6, 16, 6, top + 8, top + 18, 4, 1.4, -1);
  stoneBox(T, at, -30, -6, -20, 6, top - 12, top + 14, sh(W, 0.95));
  gable(T.plain, at, -24, 16, 6, 30, top + 22, 5, SLATE, false);
  // Kirche: Schiff längs (quer der Straße), Chor
  stoneBox(T, at, -7, 7, -24, 26, top + 6, top + 30, W);
  gable(T.plain, at, -7, 7, -24, 26, top + 30, 8, SLATE);
  stoneBox(T, at, -16, 16, 4, 14, top + 6, top + 28, sh(W, 0.97));
  gable(T.plain, at, -16, 16, 4, 14, top + 28, 7, SLATE, false);
  windows(T.plain, at, -7, -24, -7, 26, top + 16, top + 25, 6, 2, 1);
  // Vierungsturm
  stoneBox(T, at, -4.8, 4.8, 4.2, 13.8, top + 30, top + 52, sh(W, 1.02));
  for (const [l0, a0, l1, a1] of [[-4.8, 4.2, 4.8, 4.2], [4.8, 4.2, 4.8, 13.8], [4.8, 13.8, -4.8, 13.8], [-4.8, 13.8, -4.8, 4.2]]) windows(T.plain, at, l0, a0, l1, a1, top + 40, top + 49, 3.2, 1.1, -1);
  for (const [su, sv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) cyl(T.plain, at, su * 4.4, 9 + sv * 4.4, 0.45, 0.05, top + 52, top + 58, 4, sh(W, 1.05), false);
  spire(T.plain, at, 0, 9, 4, top + 52, top + 72, SLATE);
  cyl(T.plain, at, 0, 9, 0.12, 0.12, top + 72, top + 74, 4, GOLD, false);
  // der Erzengel Michael (vergoldet): Körper, Flügel, Schwert
  box(T.plain, at, -0.3, 0.3, 8.7, 9.3, top + 74, top + 76.4, GOLD);
  T.plain.tri(at(0, 9, top + 75.8), at(-1.1, 9.2, top + 77.4), at(-0.2, 9.1, top + 76.6), GOLD);
  T.plain.tri(at(0, 9, top + 75.8), at(1.1, 9.2, top + 77.4), at(0.2, 9.1, top + 76.6), GOLD);
  box(T.plain, at, 0.25, 0.35, 8.9, 9.1, top + 76, top + 78.4, GOLD);
}

// ------------------------------------------------------------------ Schloss Chambord

export function chambord(T: Town, at: At) {
  const TUF = lin('#ebe3cf');
  const TUF2 = sh(TUF, 0.94);
  const WIN = lin('#2b2e33');
  const H = 21;
  // Donjon 44 × 44 m mit vier Rundtürmen
  stoneBox(T, at, -22, 22, -22, 22, 0, H, TUF);
  boxWindows(T.plain, at, -18, 18, -22.06, 22.06, [[2.5, 6], [9.5, 13], [16.5, 20]], 6, 1.8, WIN, lin('#f4efe2'));
  for (let h = 7; h < H; h += 7) for (const [l0, a0, l1, a1] of [[-22, -22.1, 22, -22.1], [22.1, -22, 22.1, 22], [22, 22.1, -22, 22.1], [-22.1, 22, -22.1, -22]]) T.plain.quad(at(l0, a0, h - 0.4), at(l1, a1, h - 0.4), at(l1, a1, h), at(l0, a0, h), lin('#f6f1e6'));
  const towers: [number, number][] = [[-22, -22], [22, -22], [-22, 22], [22, 22]];
  for (const [cl, ca] of towers) {
    roundTower(T, at, cl, ca, 9.5, 0, H, TUF, 18);
    for (const h of [2.5, 9.5, 16.5]) for (let k = 0; k < 6; k++) {
      const t = (k / 6) * 2 * PI + 0.3;
      const p = (d: number, y: number) => at(cl + Math.cos(t + d) * 9.56, ca + Math.sin(t + d) * 9.56, y);
      T.plain.quad(p(-0.1, h), p(0.1, h), p(0.1, h + 3.5), p(-0.1, h + 3.5), WIN);
    }
    // Glockenhaube mit Laterne
    cyl(T.plain, at, cl, ca, 9.9, 9.9, H, H + 0.8, 18, lin('#f6f1e6'));
    cyl(T.plain, at, cl, ca, 9.5, 5.5, H + 0.8, H + 8, 18, SLATE, false);
    cyl(T.plain, at, cl, ca, 5.5, 1.6, H + 8, H + 12.5, 18, sh(SLATE, 1.05), false);
    cyl(T.plain, at, cl, ca, 1.6, 1.6, H + 12.5, H + 15.5, 8, TUF2);
    cone(T.plain, at, cl, ca, 1.9, H + 15.5, H + 19, 8, SLATE);
    // Kamine und Gauben auf der Haube
    for (let k = 0; k < 4; k++) {
      const t = (k / 4) * 2 * PI + 0.7;
      const ql = cl + Math.cos(t) * 6.5, qa = ca + Math.sin(t) * 6.5;
      box(T.plain, at, ql - 0.7, ql + 0.7, qa - 0.7, qa + 0.7, H + 3, H + 13 + (k % 2) * 2, TUF2);
      box(T.plain, at, ql - 0.9, ql + 0.9, qa - 0.9, qa + 0.9, H + 13 + (k % 2) * 2, H + 13.6 + (k % 2) * 2, TUF);
    }
  }
  // Dachterrasse: Wald aus Kaminen, Gauben und Türmchen
  T.plain.quad(at(-22, -22, H + 0.2), at(22, -22, H + 0.2), at(22, 22, H + 0.2), at(-22, 22, H + 0.2), lin('#cfc6b2'));
  for (const [l0, l1, a0, a1] of [[-14, -4, -14, 14], [4, 14, -14, 14]]) { hip(T.plain, at, l0, l1, a0, a1, H, 9, SLATE, 0.2); }
  for (let k = 0; k < 22; k++) {
    const l = -16 + rnd(k * 7 + 1) * 32, a = -16 + rnd(k * 7 + 2) * 32;
    if (Math.abs(l) < 5 && Math.abs(a) < 5) continue;
    const hh = H + 9 + rnd(k * 7 + 3) * 9;
    box(T.plain, at, l - 0.6, l + 0.6, a - 0.6, a + 0.6, H, hh, TUF2);
    box(T.plain, at, l - 0.85, l + 0.85, a - 0.85, a + 0.85, hh, hh + 0.5, TUF);
    if (k % 4 === 0) cone(T.plain, at, l, a, 0.9, hh + 0.5, hh + 3, 6, SLATE);
  }
  // Laterne über der Doppelwendeltreppe
  cyl(T.plain, at, 0, 0, 4.6, 4.6, H, H + 14, 12, TUF);
  for (let k = 0; k < 12; k += 2) { const t = (k / 12) * 2 * PI; T.plain.quad(at(Math.cos(t) * 4.65, Math.sin(t) * 4.65, H + 4), at(Math.cos(t + 0.3) * 4.65, Math.sin(t + 0.3) * 4.65, H + 4), at(Math.cos(t + 0.3) * 4.65, Math.sin(t + 0.3) * 4.65, H + 11), at(Math.cos(t) * 4.65, Math.sin(t) * 4.65, H + 11), WIN); }
  dome(T.plain, at, 0, 0, 4.8, H + 14, 0.7, 12, 4, SLATE);
  cyl(T.plain, at, 0, 0, 2.2, 2.2, H + 17, H + 25, 10, TUF2);
  dome(T.plain, at, 0, 0, 2.4, H + 25, 0.9, 10, 3, SLATE);
  cyl(T.plain, at, 0, 0, 1.0, 0.8, H + 27, H + 31, 8, TUF);
  cone(T.plain, at, 0, 0, 0.9, H + 31, H + 34, 8, SLATE);
  // Lilie oben
  box(T.plain, at, -0.15, 0.15, -0.15, 0.15, H + 34, H + 35.6, GOLD);
  box(T.plain, at, -0.6, 0.6, -0.12, 0.12, H + 35, H + 35.3, GOLD);
  // Flügel links und rechts, an den Enden Rundtürme
  for (const sg of [-1, 1]) {
    const l0 = sg > 0 ? 22 : -78, l1 = sg > 0 ? 78 : -22;
    stoneBox(T, at, l0, l1, -8, 8, 0, 13, TUF);
    windows(T.plain, at, l0, -8.06, l1, -8.06, 2.5, 6, 5.5, 1.6, -1, WIN);
    windows(T.plain, at, l0, -8.06, l1, -8.06, 8, 11.5, 5.5, 1.6, -1, WIN);
    gable(T.plain, at, l0, l1, -8, 8, 13, 7, SLATE, false);
    const cl = sg * 78;
    roundTower(T, at, cl, 0, 8.5, 0, 16, TUF, 16);
    cyl(T.plain, at, cl, 0, 8.8, 4.5, 16, 22, 16, SLATE, false);
    cone(T.plain, at, cl, 0, 4.5, 22, 27, 16, SLATE);
  }
  // Rasen vor dem Schloss
  T.plain.quad(at(-80, -26, 0.15), at(80, -26, 0.15), at(80, -40, 0.15), at(-80, -40, 0.15), lin('#7aa04e'));
}

// ------------------------------------------------------------------ Schloss Angers (17 Rundtürme, Schiefer und Tuff in Bändern)

export function angersCastle(T: Town, at: At) {
  const SCHIST = lin('#45413e');
  const TUF = lin('#ddd5c2');
  const band = (h: number) => (Math.floor(h / 1.4) % 3 === 2 ? TUF : SCHIST);
  // Grundriss (Fünfeck), Türme an den Ecken und dazwischen
  const P: [number, number][] = [[-70, -50], [70, -50], [86, 14], [22, 62], [-66, 46]];
  const H = 26, HT = 31;
  const pts: [number, number][] = [];
  for (let k = 0; k < P.length; k++) {
    const [l0, a0] = P[k], [l1, a1] = P[(k + 1) % P.length];
    const len = Math.hypot(l1 - l0, a1 - a0);
    const m = Math.max(1, Math.round(len / 34));
    for (let q = 0; q < m; q++) pts.push([l0 + ((l1 - l0) * q) / m, a0 + ((a1 - a0) * q) / m]);
  }
  for (let k = 0; k < pts.length; k++) {
    const [l0, a0] = pts[k], [l1, a1] = pts[(k + 1) % pts.length];
    for (let h = 0; h < H; h += 1.4) wall(T, at, l0, a0, l1, a1, h, Math.min(H, h + 1.4), sh(band(h + 0.7), 0.95));
    crenels(T.plain, at, l0, a0, l1, a1, H, SCHIST, 1.2, 1.0, 1.4);
  }
  for (const [l, a] of pts) {
    roundTower(T, at, l, a, 7.5, 0, HT, (h) => band(h), 14, 1.4);
    cyl(T.plain, at, l, a, 7.9, 7.9, HT, HT + 1.2, 14, sh(SCHIST, 1.1));
    T.plain.quad(at(l - 6, a - 6, HT + 0.8), at(l + 6, a - 6, HT + 0.8), at(l + 6, a + 6, HT + 0.8), at(l - 6, a + 6, HT + 0.8), lin('#6c8a4a'));
  }
  // innen: Logis und Kapelle unter Schiefer
  stoneBox(T, at, -10, 30, 10, 26, 0, 16, TUF);
  gable(T.plain, at, -10, 30, 10, 26, 16, 9, SLATE, false);
  windows(T.plain, at, -10, 10, 30, 10, 6, 10, 5, 1.6, -1);
  stoneBox(T, at, -40, -18, -10, 4, 0, 18, sh(TUF, 0.97));
  gable(T.plain, at, -40, -18, -10, 4, 18, 11, SLATE, false);
}

// ------------------------------------------------------------------ Kathedrale Sainte-Cécile, Albi (Backstein)

export function albiCathedral(T: Town, at: At) {
  const B = lin('#b5643f');
  const B2 = lin('#a85836');
  const brick = (k: number) => (k % 3 === 0 ? B2 : B);
  const L = 100, W = 15, H = 40;
  // Schiff: glatte Wände, außen die halbrunden Strebetürme
  stoneBox(T, at, -W, W, 0, L, 0, H, B, false);
  T.plain.quad(at(-W, 0, H), at(W, 0, H), at(W, L, H), at(-W, L, H), lin('#7d4a33'));
  gable(T.plain, at, -W + 1, W - 1, 0, L, H, 4, lin('#8a4a32'));
  for (let a = 8; a < L - 4; a += 8.5) for (const sg of [-1, 1]) {
    roundTower(T, at, sg * W, a, 2.6, 0, H + 1.2, brick(Math.round(a)), 10);
    cyl(T.plain, at, sg * W, a, 2.7, 2.7, H + 1.2, H + 1.6, 10, sh(B, 1.1));
    // hohe schmale Fenster zwischen den Streben
    T.plain.quad(at(sg * (W + 0.05), a + 2.4, 22), at(sg * (W + 0.05), a + 6.1, 22), at(sg * (W + 0.05), a + 6.1, 36), at(sg * (W + 0.05), a + 2.4, 36), DARK);
  }
  // Chor rund
  for (let k = 0; k < 8; k++) {
    const t0 = (k / 8) * PI, t1 = ((k + 1) / 8) * PI;
    wall(T, at, Math.cos(t0) * W, L + Math.sin(t0) * W, Math.cos(t1) * W, L + Math.sin(t1) * W, 0, H, B);
    roundTower(T, at, Math.cos(t0) * W, L + Math.sin(t0) * W, 2.6, 0, H + 1.2, B, 10);
  }
  // Westturm (78 m): in Stufen, mit runden Ecktürmchen
  const stages: [number, number, number, number][] = [[13, 0, 44, 3.4], [10.5, 44, 56, 2.8], [8.5, 56, 66, 2.3], [6.5, 66, 76, 1.9]];
  const ca = -11;
  for (const [hw, h0, h1, tr] of stages) {
    stoneBox(T, at, -hw, hw, ca - hw, ca + hw, h0, h1, B);
    for (const [su, sv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      roundTower(T, at, su * hw, ca + sv * hw, tr, h0, h1 + 1.2, B2, 10);
    }
    for (const [l0, a0, l1, a1] of [[-hw, ca - hw, hw, ca - hw], [hw, ca - hw, hw, ca + hw], [hw, ca + hw, -hw, ca + hw], [-hw, ca + hw, -hw, ca - hw]]) windows(T.plain, at, l0, a0, l1, a1, h1 - 7, h1 - 2, hw, 1.2, -1);
  }
  T.plain.quad(at(-6.5, ca - 6.5, 76), at(6.5, ca - 6.5, 76), at(6.5, ca + 6.5, 76), at(-6.5, ca + 6.5, 76), sh(B, 0.85));
  crenels(T.plain, at, -6.5, ca - 6.5, 6.5, ca - 6.5, 76, B2, 0.9, 1.0, 0.6);
  crenels(T.plain, at, 6.5, ca + 6.5, -6.5, ca + 6.5, 76, B2, 0.9, 1.0, 0.6);
  // Portal-Baldachin (weißer Stein) an der Südseite
  box(T.plain, at, -W - 6, -W, 40, 58, 0, 14, lin('#e6dcc6'));
  for (let k = 0; k < 4; k++) cone(T.plain, at, -W - 6 + 0.6, 41 + k * 5.4, 0.6, 14, 19, 6, lin('#e6dcc6'));
}

// ------------------------------------------------------------------ Basilika Saint-Sernin, Toulouse

export function saintSernin(T: Town, at: At) {
  const B = lin('#c57a58');
  const ST = lin('#ddd0b6');
  const ROOF = lin('#a5583a');
  // Langhaus mit Seitenschiffen, Querhaus, Chor mit Kapellenkranz
  stoneBox(T, at, -16, 16, 0, 100, 0, 14, B);
  stoneBox(T, at, -7, 7, 0, 100, 14, 22, B);
  gable(T.plain, at, -7, 7, 0, 100, 22, 5, ROOF);
  for (const sg of [-1, 1]) T.plain.quad(at(sg * 16.4, 0, 14), at(sg * 16.4, 100, 14), at(sg * 7, 100, 17.5), at(sg * 7, 0, 17.5), ROOF);
  for (const sg of [-1, 1]) windows(T.plain, at, sg * 16, 2, sg * 16, 98, 6, 11, 6, 1.4, sg);
  stoneBox(T, at, -34, 34, 54, 72, 0, 22, B);
  gable(T.plain, at, -34, 34, 54, 72, 22, 5, ROOF, false);
  for (let k = 0; k < 9; k++) {
    const t0 = (k / 9) * PI, t1 = ((k + 1) / 9) * PI;
    wall(T, at, Math.cos(t0) * 12, 100 + Math.sin(t0) * 12, Math.cos(t1) * 12, 100 + Math.sin(t1) * 12, 0, 18, B);
    T.plain.tri(at(0, 100, 23), at(Math.cos(t0) * 12.6, 100 + Math.sin(t0) * 12.6, 18), at(Math.cos(t1) * 12.6, 100 + Math.sin(t1) * 12.6, 18), ROOF);
  }
  for (let k = 0; k < 5; k++) {
    const t = ((k + 0.5) / 5) * PI;
    const cl = Math.cos(t) * 15.5, ca = 100 + Math.sin(t) * 15.5;
    roundTower(T, at, cl, ca, 3.6, 0, 9, B, 10);
    cone(T.plain, at, cl, ca, 4, 9, 11.5, 10, ROOF);
  }
  // Vierungsturm: achteckig, fünf Geschosse mit Doppelbögen (unten Stein, oben Backstein), Helm
  const ca = 63;
  const tiers: [number, number, number][] = [[7.6, 22, 28.5], [7.0, 28.5, 34.5], [6.3, 34.5, 40.5], [5.6, 40.5, 46], [4.9, 46, 51]];
  tiers.forEach(([r, h0, h1], ti) => {
    const R = r / Math.cos(PI / 8);
    for (let k = 0; k < 8; k++) {
      const t0 = PI / 8 + (k * PI) / 4, t1 = t0 + PI / 4;
      const A = [Math.cos(t0) * R, ca + Math.sin(t0) * R], Bq = [Math.cos(t1) * R, ca + Math.sin(t1) * R];
      wall(T, at, A[0], A[1], Bq[0], Bq[1], h0, h1, ti < 2 ? ST : B);
      // zwei Bogenöffnungen je Seite (bei Saint-Sernin spitze Mitra-Bögen in den oberen Geschossen)
      for (const f of [0.3, 0.7]) {
        const ml = A[0] + (Bq[0] - A[0]) * f, ma = A[1] + (Bq[1] - A[1]) * f;
        const nl = Math.cos((t0 + t1) / 2) * 0.08, na = Math.sin((t0 + t1) / 2) * 0.08;
        const dl = (Bq[0] - A[0]) * 0.11, da = (Bq[1] - A[1]) * 0.11;
        const y0 = h0 + 1.2, y1 = h1 - 1.6;
        T.plain.quad(at(ml - dl + nl, ma - da + na, y0), at(ml + dl + nl, ma + da + na, y0), at(ml + dl + nl, ma + da + na, y1), at(ml - dl + nl, ma - da + na, y1), DARK);
        T.plain.tri(at(ml - dl + nl, ma - da + na, y1), at(ml + dl + nl, ma + da + na, y1), at(ml + nl, ma + na, y1 + (ti < 2 ? 0.7 : 1.1)), DARK);
      }
    }
    cyl(T.plain, at, 0, ca, R + 0.3, R + 0.3, h1 - 0.35, h1, 8, ST);
  });
  spire(T.plain, at, 0, ca, 4.6, 51, 64.8, sh(B, 0.92));
  cyl(T.plain, at, 0, ca, 0.1, 0.1, 64.8, 66.5, 4, GOLD, false);
  box(T.plain, at, -0.6, 0.6, ca - 0.06, ca + 0.06, 65.7, 65.85, GOLD);
}

// ------------------------------------------------------------------ Kathedrale von Mende (zwei ungleiche Türme)

export function mendeCathedral(T: Town, at: At) {
  const S = lin('#a49c8f');
  stoneBox(T, at, -15, 15, 0, 70, 0, 14, S);
  stoneBox(T, at, -8, 8, 0, 70, 14, 27, S);
  gable(T.plain, at, -8, 8, 0, 70, 27, 9, SLATE);
  for (const sg of [-1, 1]) T.plain.quad(at(sg * 15.4, 0, 14), at(sg * 15.4, 70, 14), at(sg * 8, 70, 18), at(sg * 8, 0, 18), SLATE);
  for (const sg of [-1, 1]) windows(T.plain, at, sg * 8, 2, sg * 8, 68, 18, 25, 7, 2.2, sg);
  for (let k = 0; k < 8; k++) {
    const t0 = (k / 8) * PI, t1 = ((k + 1) / 8) * PI;
    wall(T, at, Math.cos(t0) * 15, 70 + Math.sin(t0) * 15, Math.cos(t1) * 15, 70 + Math.sin(t1) * 15, 0, 22, S);
  }
  // zwei Westtürme: links der große (84 m) mit reichem Helm, rechts der kleine (65 m)
  for (const [cl, hw, h1, top] of [[-9, 6.2, 50, 84], [9, 5.6, 42, 65]] as [number, number, number, number][]) {
    stoneBox(T, at, cl - hw, cl + hw, -12, -12 + 2 * hw, 0, h1, S);
    for (const [l0, a0, l1, a1] of [[cl - hw, -12, cl + hw, -12], [cl + hw, -12, cl + hw, -12 + 2 * hw], [cl - hw, -12 + 2 * hw, cl - hw, -12]]) windows(T.plain, at, l0, a0, l1, a1, h1 - 12, h1 - 3, hw, 1.4, -1);
    const ca = -12 + hw;
    // Fialen an den Ecken
    for (const [su, sv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) cyl(T.plain, at, cl + su * (hw - 0.6), ca + sv * (hw - 0.6), 0.7, 0.05, h1, h1 + (top - h1) * 0.32, 4, sh(S, 1.05), false);
    spire(T.plain, at, cl, ca, hw * 0.82, h1, top, sh(S, 0.95));
    // Krabben: kleine Stufen am Helm
    for (let q = 1; q < 6; q++) { const y = h1 + ((top - h1) * q) / 6; const w = hw * 0.82 * (1 - q / 6); cyl(T.plain, at, cl, ca, w + 0.25, w + 0.15, y - 0.3, y, 8, sh(S, 1.08), false); }
    if (top > 70) { cyl(T.plain, at, cl, ca, hw * 0.9, hw * 0.9, h1, h1 + 6, 8, sh(S, 1.02)); }
  }
}

// ------------------------------------------------------------------ Schloss Pau

export function chateauPau(T: Town, at: At) {
  const S = lin('#cdbfa6');
  const BR = lin('#a65d42');
  // Hauptbau (L-Form) unter steilen Schieferdächern mit Gauben
  stoneBox(T, at, -30, 20, -8, 8, 0, 18, S);
  gable(T.plain, at, -30, 20, -8, 8, 18, 11, SLATE, false);
  windows(T.plain, at, -30, -8.05, 20, -8.05, 4, 8, 5, 1.6, -1, DARK, lin('#ece4d2'));
  windows(T.plain, at, -30, -8.05, 20, -8.05, 11, 15, 5, 1.6, -1, DARK, lin('#ece4d2'));
  for (let l = -26; l < 18; l += 7) { box(T.plain, at, l - 1, l + 1, -6.6, -4.6, 19, 22.5, S); gable(T.plain, at, l - 1.1, l + 1.1, -6.6, -4.6, 22.5, 1.6, SLATE, false, 0.15); }
  stoneBox(T, at, 20, 34, -8, 30, 0, 16, S);
  gable(T.plain, at, 20, 34, -8, 30, 16, 9, SLATE);
  // Tour Gaston Fébus: Backstein, 33 m, Pechnasen, flach
  stoneBox(T, at, -46, -32, -6, 8, 0, 31, BR);
  for (const [l0, a0, l1, a1] of [[-46.4, -6.4, -31.6, -6.4], [-31.6, -6.4, -31.6, 8.4], [-31.6, 8.4, -46.4, 8.4], [-46.4, 8.4, -46.4, -6.4]]) {
    wall(T, at, l0, a0, l1, a1, 31, 33.5, sh(BR, 1.05));
    crenels(T.plain, at, l0, a0, l1, a1, 33.5, sh(BR, 1.05), 1.0, 1.0, 0.6);
  }
  windows(T.plain, at, -46, -6.05, -32, -6.05, 12, 15, 4.6, 0.8, -1);
  // Rundtürme mit Kegeldächern
  for (const [cl, ca] of [[20, -8], [34, 30]] as [number, number][]) {
    roundTower(T, at, cl, ca, 4.6, 0, 22, S, 12);
    cone(T.plain, at, cl, ca, 5.2, 22, 33, 12, SLATE);
  }
}

// ------------------------------------------------------------------ Aquädukt Saint-Clément und Château d'eau (Montpellier)

/** Aquädukt längs (along 0 … len), Wasserturm am Anfang; Pfeiler reichen tief ins Gelände */
export function peyrouAqueduct(T: Town, at: At, len: number) {
  const S = lin('#dccfb4');
  const S2 = sh(S, 0.9);
  // unten große Bögen (Spannweite 6,5 m, 8,5 m Raster), oben kleine (2,9 m, 4,25 m Raster)
  for (let a = 0; a <= len; a += 8.5) {
    stoneBox(T, at, -2.2, 2.2, a - 1, a + 1, -30, 12, S);
    if (a + 8.5 <= len) {
      // Bogen: Zwickel über der Öffnung
      for (let k = 0; k < 6; k++) {
        const t0 = (k / 6) * PI, t1 = ((k + 1) / 6) * PI;
        const ac = a + 4.25;
        for (const sg of [-1, 1]) T.plain.quad(at(sg * 2.2, ac - Math.cos(t0) * 3.25, 8.75 + Math.sin(t0) * 3.25), at(sg * 2.2, ac - Math.cos(t1) * 3.25, 8.75 + Math.sin(t1) * 3.25), at(sg * 2.2, ac - Math.cos(t1) * 3.25, 12), at(sg * 2.2, ac - Math.cos(t0) * 3.25, 12), S);
        T.plain.quad(at(-2.2, ac - Math.cos(t0) * 3.25, 8.75 + Math.sin(t0) * 3.25), at(2.2, ac - Math.cos(t0) * 3.25, 8.75 + Math.sin(t0) * 3.25), at(2.2, ac - Math.cos(t1) * 3.25, 8.75 + Math.sin(t1) * 3.25), at(-2.2, ac - Math.cos(t1) * 3.25, 8.75 + Math.sin(t1) * 3.25), S2);
      }
    }
  }
  box(T.plain, at, -2.5, 2.5, 0, len, 12, 12.6, sh(S, 1.05));
  for (let a = 0; a <= len; a += 4.25) {
    box(T.plain, at, -1.4, 1.4, a - 0.6, a + 0.6, 12.6, 18, S);
    if (a + 4.25 <= len) for (let k = 0; k < 4; k++) {
      const t0 = (k / 4) * PI, t1 = ((k + 1) / 4) * PI;
      const ac = a + 2.125;
      for (const sg of [-1, 1]) T.plain.quad(at(sg * 1.4, ac - Math.cos(t0) * 1.525, 16.5 + Math.sin(t0) * 1.525), at(sg * 1.4, ac - Math.cos(t1) * 1.525, 16.5 + Math.sin(t1) * 1.525), at(sg * 1.4, ac - Math.cos(t1) * 1.525, 18), at(sg * 1.4, ac - Math.cos(t0) * 1.525, 18), S);
    }
  }
  box(T.plain, at, -1.6, 1.6, 0, len, 18, 20, sh(S, 1.03));
  // Château d'eau: Sechseck mit Säulen und Kuppel auf einem Sockel
  box(T.plain, at, -12, 12, -26, -2, -30, 4, S2);
  T.plain.quad(at(-12, -26, 4), at(12, -26, 4), at(12, -2, 4), at(-12, -2, 4), lin('#cfc4ab'));
  for (let k = 0; k < 6; k++) {
    const t = (k / 6) * 2 * PI;
    cyl(T.plain, at, Math.cos(t) * 7, -14 + Math.sin(t) * 7, 0.55, 0.5, 4, 13, 8, S);
  }
  cyl(T.plain, at, 0, -14, 4.5, 4.5, 4, 13, 6, S2);
  cyl(T.plain, at, 0, -14, 8.2, 8.2, 13, 14.5, 6, sh(S, 1.05));
  dome(T.plain, at, 0, -14, 7.2, 14.5, 0.55, 12, 4, sh(S, 0.95));
}

// ------------------------------------------------------------------ Géant du Tourmalet (Kuppe des Bergfinales)

export function geant(T: Town, at: At) {
  const ST = lin('#8a857c');
  const MET = lin('#3c3f43');
  box(T.plain, at, -1.8, 1.8, -2.4, 2.4, 0, 2.4, ST);
  box(T.plain, at, -2.1, 2.1, -2.7, 2.7, 2.4, 2.7, sh(ST, 1.08));
  // Fahrer im Wiegetritt, etwa doppelt so groß wie echt (Stahl, dunkel)
  const y = 2.7;
  const wheel = (a: number) => {
    for (let k = 0; k < 14; k++) {
      const t0 = (k / 14) * 2 * PI, t1 = ((k + 1) / 14) * 2 * PI;
      const R = 1.3, r = 1.12;
      for (const sg of [-0.06, 0.06]) T.plain.quad(at(sg, a + Math.cos(t0) * R, y + 1.3 + Math.sin(t0) * R), at(sg, a + Math.cos(t1) * R, y + 1.3 + Math.sin(t1) * R), at(sg, a + Math.cos(t1) * r, y + 1.3 + Math.sin(t1) * r), at(sg, a + Math.cos(t0) * r, y + 1.3 + Math.sin(t0) * r), MET);
    }
  };
  wheel(-2.0);
  wheel(2.0);
  const bar = (p: number[], q: number[], w: number, c = MET) => {
    T.plain.quad(at(-w, p[0], y + p[1]), at(w, p[0], y + p[1]), at(w, q[0], y + q[1]), at(-w, q[0], y + q[1]), c);
    T.plain.quad(at(0, p[0] - w, y + p[1]), at(0, p[0] + w, y + p[1]), at(0, q[0] + w, y + q[1]), at(0, q[0] - w, y + q[1]), sh(c, 0.85));
  };
  bar([-2.0, 1.3], [-0.2, 1.4], 0.08);
  bar([-0.2, 1.4], [0.2, 2.9], 0.08);
  bar([0.2, 2.9], [1.7, 3.0], 0.08);
  bar([1.7, 3.0], [2.0, 1.3], 0.08);
  bar([-2.0, 1.3], [0.2, 2.9], 0.07);
  // Körper: Beine, Rumpf weit nach vorn, Arme, Kopf
  bar([-0.1, 1.4], [0.1, 3.6], 0.22);
  bar([0.1, 3.6], [1.3, 4.7], 0.32);
  bar([1.3, 4.6], [1.85, 3.3], 0.13);
  box(T.plain, at, -0.24, 0.24, 1.35, 1.85, y + 4.6, y + 5.15, MET);
}

// ------------------------------------------------------------------ Requisiten (Instanzen; Front −z zur Straße)

export type FranceProp = 'calvaire' | 'menhir' | 'fronton' | 'elephants' | 'marteau';

export function franceProps(): Record<FranceProp, THREE.BufferGeometry> {
  const GR = lin('#8e8b83');
  const GR2 = lin('#77746c');
  // Kalvarienberg (Bretagne): Sockel mit Stufen, Schaft mit Kreuz und Figuren, zwei Schächerkreuze
  const cal = new GB();
  cal.add(new THREE.BoxGeometry(4.6, 0.5, 4.6), M(0, 0.25), GR2);
  cal.add(new THREE.BoxGeometry(3.6, 1.6, 3.6), M(0, 1.3), GR);
  cal.add(new THREE.BoxGeometry(3.9, 0.22, 3.9), M(0, 2.2), lin('#9a978f'));
  cal.add(new THREE.CylinderGeometry(0.22, 0.28, 5.6, 8), M(0, 5.0), GR);
  cal.add(new THREE.BoxGeometry(2.2, 0.32, 0.32), M(0, 6.9), GR);
  cal.add(new THREE.BoxGeometry(0.34, 1.2, 0.3), M(0, 6.7, -0.25), GR2);
  for (const sx of [-1, 1]) {
    cal.add(new THREE.CylinderGeometry(0.16, 0.2, 3.6, 8), M(sx * 1.2, 4.0), GR);
    cal.add(new THREE.BoxGeometry(1.2, 0.22, 0.22), M(sx * 1.2, 5.3), GR);
    cal.add(new THREE.BoxGeometry(0.28, 0.9, 0.26), M(sx * 1.2, 5.1, -0.2), GR2);
  }
  for (let k = 0; k < 6; k++) cal.add(new THREE.BoxGeometry(0.42, 1.05, 0.36), M(-1.3 + k * 0.52, 2.85, -1.3 + (k % 2) * 0.25), k % 2 ? GR2 : GR);
  // Menhir: unregelmäßig behauener Stein, oben schmaler
  const men = new GB();
  const mg = new THREE.CylinderGeometry(0.42, 0.75, 4.2, 6, 3);
  const mp = mg.getAttribute('position');
  for (let k = 0; k < mp.count; k++) {
    // Buckel je Lage (gleiche Ecken bekommen denselben Wert, keine Risse an der Naht)
    const q = Math.round(Math.atan2(mp.getZ(k), mp.getX(k)) * 6) * 31 + Math.round(mp.getY(k) * 3) * 7;
    mp.setXYZ(k, mp.getX(k) * (0.85 + rnd(q) * 0.3), mp.getY(k), mp.getZ(k) * (0.85 + rnd(q + 500) * 0.3));
  }
  men.addFn(mg, M(0, 2.0, 0, 1, 1, 0.65), (p) => mix(lin('#8c8a84'), lin('#6f7a5c'), Math.max(0, Math.min(1, 0.7 - p.y * 0.18 + Math.sin(p.x * 7 + p.z * 5) * 0.2))) as RGBf);
  // Fronton (Baskenland): Spielwand mit geschwungener Krone, roter Strich, Spielfeld davor
  const fr = new GB();
  const WH = lin('#efe9dc');
  fr.add(new THREE.BoxGeometry(16, 9, 1.0), M(0, 4.5, 26), WH);
  const crown = new THREE.Shape();
  crown.moveTo(-8, 0);
  crown.lineTo(-8, 0.2);
  crown.quadraticCurveTo(-6.5, 2.8, 0, 3.2);
  crown.quadraticCurveTo(6.5, 2.8, 8, 0.2);
  crown.lineTo(8, 0);
  crown.closePath();
  const cg = new THREE.ExtrudeGeometry(crown, { depth: 1.0, bevelEnabled: false, curveSegments: 6 });
  fr.add(cg, M(0, 9, 25.5), WH);
  fr.add(new THREE.BoxGeometry(16.04, 0.22, 1.04), M(0, 0.85, 26), lin('#b0302a'));
  fr.add(new THREE.BoxGeometry(16.6, 0.3, 1.3), M(0, 9.05, 26), lin('#b0302a'));
  fr.add(new THREE.BoxGeometry(16, 0.06, 24), M(0, 0.03, 13.5), lin('#c8c0b0'));
  for (let k = 0; k < 5; k++) fr.add(new THREE.BoxGeometry(0.08, 0.07, 24), M(-7.9 + (k % 2) * 15.8, 0.04, 13.5), lin('#f2efe8'));
  fr.add(new THREE.BoxGeometry(0.16, 0.08, 24), M(0, 0.05, 13.5), lin('#2f6a3a'));
  for (const sx of [-1, 1]) for (let s = 0; s < 3; s++) fr.add(new THREE.BoxGeometry(1.4, 0.45 * (s + 1), 22), M(sx * (8.8 + s * 1.4), 0.225 * (s + 1), 13.5), lin('#bdb5a5'));
  // Elefantenbrunnen (Chambéry): Becken, Sockel mit vier Elefanten (Vorderteile), Säule, Statue
  const el = new GB();
  const BR = lin('#5b5a55');
  const STN = lin('#b9b1a1');
  el.add(new THREE.CylinderGeometry(5.2, 5.4, 0.7, 20), M(0, 0.35), STN);
  el.add(new THREE.CylinderGeometry(4.9, 4.9, 0.12, 20), M(0, 0.6), lin('#4f6f74'));
  el.add(new THREE.BoxGeometry(4.0, 3.6, 4.0), M(0, 2.4), STN);
  for (let k = 0; k < 4; k++) {
    const t = (k / 4) * PI * 2 + PI / 4;
    const ex = Math.cos(t) * 2.7, ez = Math.sin(t) * 2.7;
    const m = (dx: number, dy: number, dz: number, sx: number, sy: number, sz: number) => M(ex + Math.cos(t) * dz - Math.sin(t) * dx, dy, ez + Math.sin(t) * dz + Math.cos(t) * dx, sx, sy, sz, -t + PI / 2);
    el.add(new THREE.SphereGeometry(1, 10, 8), m(0, 2.0, 0, 0.9, 1.0, 1.3), BR);
    el.add(new THREE.SphereGeometry(0.7, 10, 8), m(0, 2.6, 1.0, 1, 1, 1), BR);
    el.add(new THREE.CylinderGeometry(0.22, 0.12, 1.6, 6), m(0, 1.9, 1.55, 1, 1, 1), BR);
    for (const sx of [-0.45, 0.45]) el.add(new THREE.CylinderGeometry(0.28, 0.3, 1.4, 6), m(sx, 0.95, 0.5, 1, 1, 1), BR);
    el.add(new THREE.SphereGeometry(0.55, 8, 6), m(0.75, 2.7, 0.8, 0.2, 1, 1), BR);
    el.add(new THREE.SphereGeometry(0.55, 8, 6), m(-0.75, 2.7, 0.8, 0.2, 1, 1), BR);
  }
  el.add(new THREE.BoxGeometry(4.3, 0.4, 4.3), M(0, 4.4), STN);
  el.add(new THREE.CylinderGeometry(0.7, 0.8, 11, 12), M(0, 10.1), STN);
  el.add(new THREE.BoxGeometry(1.8, 0.6, 1.8), M(0, 15.9), STN);
  el.add(new THREE.CylinderGeometry(0.35, 0.45, 2.4, 8), M(0, 17.4), BR);
  el.add(new THREE.SphereGeometry(0.3, 8, 6), M(0, 18.85), BR);
  // Dampfhammer (Le Creusot, 1876): zwei schräge Ständer, Querhaupt, Zylinder, Bär, Amboss
  const mh = new GB();
  const IR = lin('#2b2d30');
  const RUST = lin('#5a3b2a');
  mh.add(new THREE.BoxGeometry(9, 1.6, 6), M(0, 0.8), lin('#7d7a72'));
  for (const sx of [-1, 1]) {
    mh.add(new THREE.BoxGeometry(1.0, 15, 1.6), M(sx * 2.6, 9.0, 0, 1, 1, 1, 0, 0, sx * 0.14), IR);
    mh.add(new THREE.BoxGeometry(1.6, 1.6, 2.2), M(sx * 3.6, 1.8), IR);
  }
  mh.add(new THREE.BoxGeometry(5.0, 1.6, 2.0), M(0, 16.6), IR);
  mh.add(new THREE.CylinderGeometry(1.1, 1.1, 4.2, 12), M(0, 19.5), RUST);
  mh.add(new THREE.CylinderGeometry(1.25, 1.25, 0.3, 12), M(0, 21.7), IR);
  mh.add(new THREE.CylinderGeometry(0.22, 0.22, 6, 8), M(0, 13), lin('#8d8f92'));
  mh.add(new THREE.BoxGeometry(2.4, 2.6, 2.4), M(0, 8.8), RUST);
  mh.add(new THREE.BoxGeometry(3.4, 1.6, 2.8), M(0, 2.4), IR);
  return { calvaire: cal.build(), menhir: men.build(), fronton: fr.build(), elephants: el.build(), marteau: mh.build() };
}
