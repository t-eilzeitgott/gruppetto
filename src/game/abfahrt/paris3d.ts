/**
 * Paris (Schauplatz der 21. Etappe der Tour 2027, venue.ts): Wahrzeichen und Straßenmöbel.
 *
 * Wahrzeichen in die Netze des Abschnitts (Town): der Arc de Triomphe über der Straße hinter dem Ziel (die Fahrer
 * rollen unter dem großen Bogen hindurch), der Eiffelturm in der Ferne über den Dächern und Sacré-Cœur auf der
 * Kuppe des Bergfinales (Butte Montmartre). Maße nach den echten Bauten.
 *
 * Straßenmöbel als Requisiten (Instanzen): Kandelaber-Laterne, Litfaßsäule (Colonne Morris), Zeitungskiosk,
 * Wallace-Brunnen und der Obelisk der Place de la Concorde.
 */
import * as THREE from 'three';
import { GB, lin, M, type RGBf } from './models3d';
import type { At, Town } from './house3d';

const sh = (c: RGBf, f: number): RGBf => [c[0] * f, c[1] * f, c[2] * f];
const PI = Math.PI;

// ------------------------------------------------------------------ Grundformen in Ortskoordinaten (quer, längs, Höhe)

/** Quader (quer l0…l1, längs a0…a1, Höhe h0…h1) */
export function box(gb: GB, at: At, l0: number, l1: number, a0: number, a1: number, h0: number, h1: number, col: RGBf, top = true, bottom = false) {
  gb.quad(at(l0, a0, h0), at(l1, a0, h0), at(l1, a0, h1), at(l0, a0, h1), col);
  gb.quad(at(l1, a1, h0), at(l0, a1, h0), at(l0, a1, h1), at(l1, a1, h1), sh(col, 0.92));
  gb.quad(at(l0, a1, h0), at(l0, a0, h0), at(l0, a0, h1), at(l0, a1, h1), sh(col, 0.86));
  gb.quad(at(l1, a0, h0), at(l1, a1, h0), at(l1, a1, h1), at(l1, a0, h1), sh(col, 0.86));
  if (top) gb.quad(at(l0, a0, h1), at(l1, a0, h1), at(l1, a1, h1), at(l0, a1, h1), sh(col, 1.05));
  if (bottom) gb.quad(at(l0, a1, h0), at(l1, a1, h0), at(l1, a0, h0), at(l0, a0, h0), sh(col, 0.7));
}

/** Kegelstumpf/Zylinder um (cl, ca) – Mantel, wahlweise Deckel */
export function cyl(gb: GB, at: At, cl: number, ca: number, r0: number, r1: number, h0: number, h1: number, n: number, col: RGBf | ((k: number) => RGBf), cap = true) {
  for (let k = 0; k < n; k++) {
    const t0 = (k / n) * 2 * PI, t1 = ((k + 1) / n) * 2 * PI;
    const c = typeof col === 'function' ? col(k) : col;
    gb.quad(at(cl + Math.cos(t0) * r0, ca + Math.sin(t0) * r0, h0), at(cl + Math.cos(t1) * r0, ca + Math.sin(t1) * r0, h0),
      at(cl + Math.cos(t1) * r1, ca + Math.sin(t1) * r1, h1), at(cl + Math.cos(t0) * r1, ca + Math.sin(t0) * r1, h1), c);
    if (cap && r1 > 0.01) gb.tri(at(cl, ca, h1), at(cl + Math.cos(t1) * r1, ca + Math.sin(t1) * r1, h1), at(cl + Math.cos(t0) * r1, ca + Math.sin(t0) * r1, h1), sh(c, 1.05));
  }
}

/** Kuppel (Halbkugel, in der Höhe gestreckt) über dem Kreis (cl, ca, r) auf Höhe h0 */
export function dome(gb: GB, at: At, cl: number, ca: number, r: number, h0: number, hs: number, n: number, m: number, col: RGBf, ribs?: RGBf) {
  for (let j = 0; j < m; j++) {
    const p0 = (j / m) * (PI / 2), p1 = ((j + 1) / m) * (PI / 2);
    const r0 = Math.cos(p0) * r, r1 = Math.cos(p1) * r;
    const y0 = h0 + Math.sin(p0) * r * hs, y1 = h0 + Math.sin(p1) * r * hs;
    for (let k = 0; k < n; k++) {
      const t0 = (k / n) * 2 * PI, t1 = ((k + 1) / n) * 2 * PI;
      const c = ribs && k % 2 === 0 ? ribs : sh(col, 0.9 + 0.12 * Math.sin(p0 + 0.3));
      gb.quad(at(cl + Math.cos(t0) * r0, ca + Math.sin(t0) * r0, y0), at(cl + Math.cos(t1) * r0, ca + Math.sin(t1) * r0, y0),
        at(cl + Math.cos(t1) * r1, ca + Math.sin(t1) * r1, y1), at(cl + Math.cos(t0) * r1, ca + Math.sin(t0) * r1, y1), c);
    }
  }
}

// ------------------------------------------------------------------ Arc de Triomphe

/** Maße (m): 45 breit, 22 tief, 50 hoch; großer Bogen 14,62 × 29,19, kleine Bögen quer 8,44 × 18,68 */
export const ARC = { W: 22.5, D: 11, H: 50, mw: 7.31, mTop: 29.19, sw: 4.22, sTop: 18.68 } as const;

/**
 * Arc de Triomphe über der Straße (Bogen längs der Fahrtrichtung): vier Pfeiler mit den quer laufenden kleinen
 * Bögen, Tonnengewölbe, Reliefgruppen an den Stirnseiten, Fries, Kranzgesims, Attika mit Schilden.
 * at(quer, längs, h): Mitte des Bogens auf der Straße.
 */
export function arcDeTriomphe(T: Town, at: At) {
  const { W, D, H, mw, mTop, sw, sTop } = ARC;
  const stone = T.stone ?? T.plain;
  const plain = T.plain;
  const C = lin('#d6cbb2');
  const shade = sh(C, 0.82);
  const relief = lin('#b8aa8d');
  const vault = sh(C, 0.66);
  const U = 1.9;
  const uvq = (s0: number, s1: number, h0: number, h1: number) => [[s0 / U, h0 / U], [s1 / U, h0 / U], [s1 / U, h1 / U], [s0 / U, h1 / U]];
  // Wandstück mit Fugen auf einer Ebene: Fläche entlang (quer oder längs) bei festem Wert
  const wallA = (a: number, l0: number, l1: number, h0: number, h1: number, c = C) =>
    stone.quad(at(l0, a, h0), at(l1, a, h0), at(l1, a, h1), at(l0, a, h1), c, uvq(l0, l1, h0, h1));
  const wallL = (l: number, a0: number, a1: number, h0: number, h1: number, c = C) =>
    stone.quad(at(l, a0, h0), at(l, a1, h0), at(l, a1, h1), at(l, a0, h1), c, uvq(a0, a1, h0, h1));
  const mSpring = mTop - mw;
  const sSpring = sTop - sw;
  const B = 31;   // Oberkante der Pfeilerzone
  const N = 12;

  for (const sx of [-1, 1]) {
    const li = sx * mw, lo = sx * W;
    const L0 = Math.min(li, lo), L1 = Math.max(li, lo);
    // Stirnseiten (längs ±D): volle Pfeilerfläche
    for (const sa of [-1, 1]) wallA(sa * D, L0, L1, 0, B);
    // Außen- und Innenseite (quer): links und rechts des kleinen Bogens, darüber Wand, Zwickel
    for (const l of [li, lo]) {
      wallL(l, -D, -sw, 0, B);
      wallL(l, sw, D, 0, B);
      wallL(l, -sw, sw, sTop, B);
      for (let k = 0; k < N; k++) {
        const t0 = (PI * k) / N, t1 = (PI * (k + 1)) / N;
        stone.quad(at(l, -Math.cos(t0) * sw, sSpring + Math.sin(t0) * sw), at(l, -Math.cos(t1) * sw, sSpring + Math.sin(t1) * sw),
          at(l, -Math.cos(t1) * sw, sTop), at(l, -Math.cos(t0) * sw, sTop), C, uvq(-Math.cos(t0) * sw, -Math.cos(t1) * sw, sTop - 1, sTop));
      }
    }
    // Durchgang des kleinen Bogens: Wände und Gewölbe
    for (const sa of [-1, 1]) wallA(sa * sw, L0, L1, 0, sSpring, sh(C, 0.74));
    for (let k = 0; k < N; k++) {
      const t0 = (PI * k) / N, t1 = (PI * (k + 1)) / N;
      plain.quad(at(L0, -Math.cos(t0) * sw, sSpring + Math.sin(t0) * sw), at(L1, -Math.cos(t0) * sw, sSpring + Math.sin(t0) * sw),
        at(L1, -Math.cos(t1) * sw, sSpring + Math.sin(t1) * sw), at(L0, -Math.cos(t1) * sw, sSpring + Math.sin(t1) * sw), vault);
    }
    // Sockel
    box(plain, at, L0 - 0.4, L1 + 0.4, -D - 0.4, -sw, 0, 1.4, shade, true);
    box(plain, at, L0 - 0.4, L1 + 0.4, sw, D + 0.4, 0, 1.4, shade, true);
    // Reliefgruppen an den Stirnseiten (Le Départ de 1792 …) und Reliefs darüber
    for (const sa of [-1, 1]) {
      const a = sa * (D + 0.55);
      const c0 = sx * 10.2, c1 = sx * 20.6;
      box(plain, at, Math.min(c0, c1), Math.max(c0, c1), Math.min(a, sa * D), Math.max(a, sa * D), 5.5, 16.5, relief, true);
      // Sockel der Gruppe
      box(plain, at, Math.min(c0, c1) - 0.3, Math.max(c0, c1) + 0.3, Math.min(sa * (D + 0.8), sa * D), Math.max(sa * (D + 0.8), sa * D), 1.4, 5.5, shade, true);
      const r0 = sx * 9.2, r1 = sx * 21.2;
      box(plain, at, Math.min(r0, r1), Math.max(r0, r1), Math.min(sa * (D + 0.25), sa * D), Math.max(sa * (D + 0.25), sa * D), 21, 27, sh(relief, 1.04), true);
    }
    // Lisenen an den Ecken
    for (const sa of [-1, 1]) for (const l of [lo, li]) {
      const e = sx * 1.6 * (l === lo ? -1 : 1);
      box(plain, at, Math.min(l, l + e), Math.max(l, l + e), Math.min(sa * D, sa * (D + 0.3)), Math.max(sa * D, sa * (D + 0.3)), 1.4, B, sh(C, 1.03), false);
    }
  }
  // großer Bogen: Zwickel und Wand über dem Scheitel an beiden Stirnseiten, Tonnengewölbe
  for (const sa of [-1, 1]) {
    const a = sa * D;
    wallA(a, -mw, mw, mTop, B);
    for (let k = 0; k < N; k++) {
      const t0 = (PI * k) / N, t1 = (PI * (k + 1)) / N;
      stone.quad(at(-Math.cos(t0) * mw, a, mSpring + Math.sin(t0) * mw), at(-Math.cos(t1) * mw, a, mSpring + Math.sin(t1) * mw),
        at(-Math.cos(t1) * mw, a, mTop), at(-Math.cos(t0) * mw, a, mTop), C, uvq(-Math.cos(t0) * mw, -Math.cos(t1) * mw, mTop - 1, mTop));
    }
    // Archivolte (heller Bogenrand)
    for (let k = 0; k < N; k++) {
      const t0 = (PI * k) / N, t1 = (PI * (k + 1)) / N;
      const r0 = mw, r1 = mw + 0.9;
      plain.quad(at(-Math.cos(t0) * r0, a + sa * 0.08, mSpring + Math.sin(t0) * r0), at(-Math.cos(t0) * r1, a + sa * 0.08, mSpring + Math.sin(t0) * r1),
        at(-Math.cos(t1) * r1, a + sa * 0.08, mSpring + Math.sin(t1) * r1), at(-Math.cos(t1) * r0, a + sa * 0.08, mSpring + Math.sin(t1) * r0), sh(C, 1.06));
    }
  }
  for (let k = 0; k < N; k++) {
    const t0 = (PI * k) / N, t1 = (PI * (k + 1)) / N;
    // Kassetten: abwechselnd hell und dunkel
    for (let q = 0; q < 6; q++) {
      const a0 = -D + (q * 2 * D) / 6, a1 = -D + ((q + 1) * 2 * D) / 6;
      plain.quad(at(-Math.cos(t0) * mw, a0, mSpring + Math.sin(t0) * mw), at(-Math.cos(t1) * mw, a0, mSpring + Math.sin(t1) * mw),
        at(-Math.cos(t1) * mw, a1, mSpring + Math.sin(t1) * mw), at(-Math.cos(t0) * mw, a1, mSpring + Math.sin(t0) * mw), (k + q) % 2 ? vault : sh(vault, 1.12));
    }
  }
  // Oberbau: Fries (leicht zurück), Kranzgesims, Attika mit Schilden, Abschlussgesims
  const band = (h0: number, h1: number, o: number, c: RGBf, textured = false) => {
    const gb = textured ? stone : plain;
    const l = W + o, a = D + o;
    const uv = textured ? (s0: number, s1: number) => uvq(s0, s1, h0, h1) : () => undefined;
    gb.quad(at(-l, -a, h0), at(l, -a, h0), at(l, -a, h1), at(-l, -a, h1), c, uv(-l, l));
    gb.quad(at(l, a, h0), at(-l, a, h0), at(-l, a, h1), at(l, a, h1), c, uv(-l, l));
    gb.quad(at(-l, a, h0), at(-l, -a, h0), at(-l, -a, h1), at(-l, a, h1), sh(c, 0.92), uv(-a, a));
    gb.quad(at(l, -a, h0), at(l, a, h0), at(l, a, h1), at(l, -a, h1), sh(c, 0.92), uv(-a, a));
    if (o > 0) {
      // Unterseite der Auskragung
      plain.quad(at(-l, -a, h0), at(-l, a, h0), at(l, a, h0), at(l, -a, h0), sh(c, 0.6));
    }
  };
  band(B, 33, 0, C, true);
  band(33, 36, -0.15, relief);                // großer Fries (Relief)
  band(36, 36.6, 0.5, sh(C, 1.05));
  band(36.6, 38, 0.9, sh(C, 1.08));          // Kranzgesims
  band(38, 47.6, 0, C, true);                 // Attika
  band(47.6, 48.4, 0.35, sh(C, 1.04));
  band(48.4, H, 0.15, C);
  plain.quad(at(-W - 0.15, -D - 0.15, H), at(W + 0.15, -D - 0.15, H), at(W + 0.15, D + 0.15, H), at(-W - 0.15, D + 0.15, H), sh(C, 0.95));
  // Schilde der Attika (30 rund um den Bau)
  for (const sa of [-1, 1]) for (let k = 0; k < 10; k++) {
    const l = -W + 2.6 + (k * (2 * W - 5.2)) / 9;
    const a = sa * (D + 0.12);
    plain.quad(at(l - 0.75, a, 41.2), at(l + 0.75, a, 41.2), at(l + 0.75, a, 43.4), at(l - 0.75, a, 43.4), shade);
    plain.tri(at(l - 0.75, a, 41.2), at(l + 0.75, a, 41.2), at(l, a, 40.4), shade);
  }
  for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) {
    const a = -D + 2.2 + (k * (2 * D - 4.4)) / 4;
    const l = sx * (W + 0.12);
    plain.quad(at(l, a - 0.75, 41.2), at(l, a + 0.75, 41.2), at(l, a + 0.75, 43.4), at(l, a - 0.75, 43.4), shade);
  }
}

// ------------------------------------------------------------------ Eiffelturm

/**
 * Eiffelturm (330 m) für die Ferne: vier geschwungene Beine aus Fachwerk, die Bögen zwischen ihnen, die drei
 * Plattformen, der schlanke Schaft und die Spitze mit Antenne. In „Eiffelturmbraun“; die Beine sind offen (je
 * vier Gurte mit Diagonalen), damit der Turm auch von Weitem als Gitter erkennbar bleibt.
 * at(quer, längs, h): Mitte des Fußes.
 */
export function eiffelTower(gb: GB, at: At) {
  const C = lin('#7a6650');
  const D = sh(C, 0.78);
  const L = sh(C, 1.12);
  // Halbe Breite des Turms in der Höhe h (Außenkante der Beine) und halbe Breite eines Beins
  const half = (h: number) => (h < 57 ? 62.5 - 33 * Math.pow(h / 57, 0.8) : h < 116 ? 29.5 - 9 * ((h - 57) / 59) : h < 276 ? 20.5 - 12 * Math.pow((h - 116) / 160, 0.75) : 8.5 - 5 * ((h - 276) / 24));
  const legW = (h: number) => (h < 116 ? 12.5 - 6 * (h / 116) : 0);
  // Gurt (Kante) als schmaler Kasten zwischen zwei Punkten
  const girder = (p0: number[], p1: number[], w: number, c: RGBf) => {
    const dx = p1[0] - p0[0], dz = p1[2] - p0[2];
    const l = Math.hypot(dx, dz) || 1;
    const ox = (-dz / l) * w, oz = (dx / l) * w;
    gb.quad([p0[0] - ox, p0[1], p0[2] - oz], [p0[0] + ox, p0[1], p0[2] + oz], [p1[0] + ox, p1[1], p1[2] + oz], [p1[0] - ox, p1[1], p1[2] - oz], c);
    gb.quad([p0[0] - w * 0.7, p0[1], p0[2] + w * 0.7], [p0[0] + w * 0.7, p0[1], p0[2] - w * 0.7], [p1[0] + w * 0.7, p1[1], p1[2] - w * 0.7], [p1[0] - w * 0.7, p1[1], p1[2] + w * 0.7], sh(c, 0.85));
  };
  const LV = [0, 9, 19, 30, 42, 57, 70, 84, 99, 116];
  // ---- vier Beine (bis zur zweiten Etage)
  for (const sx of [-1, 1]) for (const sa of [-1, 1]) {
    const corner = (h: number, u: number, v: number) => {
      const o = half(h), w = legW(h);
      // u, v ∈ {0, 1}: innen/außen je Richtung
      return at(sx * (o - (1 - u) * w), sa * (o - (1 - v) * w), h);
    };
    for (let q = 0; q < LV.length - 1; q++) {
      const h0 = LV[q], h1 = LV[q + 1];
      const pts0 = [corner(h0, 0, 0), corner(h0, 1, 0), corner(h0, 1, 1), corner(h0, 0, 1)];
      const pts1 = [corner(h1, 0, 0), corner(h1, 1, 0), corner(h1, 1, 1), corner(h1, 0, 1)];
      const gw = 1.6 - 0.6 * (h0 / 116);
      for (let k = 0; k < 4; k++) girder(pts0[k], pts1[k], gw, C);
      // dichter Kern des Beins (von Weitem wirkt das Fachwerk als dunkle, massive Stütze)
      const inset = (p: number[], q: number[]) => [p[0] + (q[0] - p[0]) * 0.2, p[1], p[2] + (q[2] - p[2]) * 0.2];
      const mid0 = [(pts0[0][0] + pts0[2][0]) / 2, 0, (pts0[0][2] + pts0[2][2]) / 2];
      const mid1 = [(pts1[0][0] + pts1[2][0]) / 2, 0, (pts1[0][2] + pts1[2][2]) / 2];
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4;
        gb.quad(inset(pts0[k], mid0), inset(pts0[k2], mid0), inset(pts1[k2], mid1), inset(pts1[k], mid1), q % 2 ? sh(D, 0.82) : sh(D, 0.7));
      }
      // Diagonalen auf den vier Seiten des Beins
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4;
        girder(pts0[k], pts1[k2], gw * 0.55, D);
        girder(pts0[k2], pts1[k], gw * 0.55, D);
      }
    }
  }
  // ---- Bögen zwischen den Beinen (unter der ersten Etage)
  for (let side = 0; side < 4; side++) {
    const P = (s: number, h: number) => {
      const o = half(h) - legW(h) * 0.5;
      return side === 0 ? at(s, -o, h) : side === 1 ? at(s, o, h) : side === 2 ? at(-o, s, h) : at(o, s, h);
    };
    const n = 16;
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const span = 37;
      const s0 = -span + 2 * span * t0, s1 = -span + 2 * span * t1;
      const h0 = 39 + Math.sin(PI * t0) * 12, h1 = 39 + Math.sin(PI * t1) * 12;
      const a = P(s0, h0), b = P(s1, h1), a2 = P(s0, h0 - 1.6), b2 = P(s1, h1 - 1.6);
      gb.quad(a2, b2, b, a, L);
    }
  }
  // ---- Plattformen
  const deck = (h0: number, h1: number, o: number, c: RGBf) => {
    box(gb, at, -o, o, -o, o, h0, h1, c, true, true);
  };
  deck(57, 64, half(57) + 1.2, L);
  deck(115.7, 120, half(116) + 0.8, L);
  // Geländer-Andeutung über der ersten Etage
  deck(64, 66, half(64) - 0.3, sh(D, 0.9));
  // ---- Schaft (von der zweiten Etage bis zur Spitze): vier Gurte, Diagonalen
  const SV = [120, 140, 162, 186, 212, 240, 262, 276];
  for (let q = 0; q < SV.length - 1; q++) {
    const h0 = SV[q], h1 = SV[q + 1];
    const c0 = [at(-half(h0), -half(h0), h0), at(half(h0), -half(h0), h0), at(half(h0), half(h0), h0), at(-half(h0), half(h0), h0)];
    const c1 = [at(-half(h1), -half(h1), h1), at(half(h1), -half(h1), h1), at(half(h1), half(h1), h1), at(-half(h1), half(h1), h1)];
    for (let k = 0; k < 4; k++) {
      girder(c0[k], c1[k], 1.1, C);
      const k2 = (k + 1) % 4;
      girder(c0[k], c1[k2], 0.5, D);
      girder(c0[k2], c1[k], 0.5, D);
    }
    // Kern (in der Ferne als dunkler Schaft)
    box(gb, at, -half(h1) * 0.55, half(h1) * 0.55, -half(h1) * 0.55, half(h1) * 0.55, h0, h1, sh(D, 0.85), false);
  }
  // ---- Spitze: dritte Etage, Kuppel, Antenne
  deck(276, 281, 9, L);
  box(gb, at, -5.5, 5.5, -5.5, 5.5, 281, 291, C, true);
  cyl(gb, at, 0, 0, 4.2, 1.6, 291, 300, 8, D);
  cyl(gb, at, 0, 0, 0.9, 0.5, 300, 312, 6, D);
  cyl(gb, at, 0, 0, 0.45, 0.15, 312, 330, 6, lin('#c9c4ba'));
}

// ------------------------------------------------------------------ Sacré-Cœur

/**
 * Basilika Sacré-Cœur auf der Butte Montmartre: weißer Travertin, Vorhalle mit drei Bögen und zwei kleinen
 * Kuppeltürmen, Langhaus, die große Kuppel auf hohem Tambour mit Säulengang und Laterne, vier kleine Kuppeln um
 * sie herum, hinten der quadratische Glockenturm. Front zeigt nach −längs (zur Straße hin drehen über at).
 * at(quer, längs, h): Mitte der Front am Boden.
 */
export function sacreCoeur(T: Town, at: At) {
  const plain = T.plain;
  const stone = T.stone ?? plain;
  const W = lin('#efece3');
  const G = sh(W, 0.84);
  const Dk = lin('#2b2a28');
  const U = 1.6;
  const wall = (gb: GB, a: number[], b: number[], c: number[], d: number[], col: RGBf, s0: number, s1: number, h0: number, h1: number) =>
    gb.quad(a, b, c, d, col, [[s0 / U, h0 / U], [s1 / U, h0 / U], [s1 / U, h1 / U], [s0 / U, h1 / U]]);
  const sbox = (l0: number, l1: number, a0: number, a1: number, h0: number, h1: number, col: RGBf) => {
    wall(stone, at(l0, a0, h0), at(l1, a0, h0), at(l1, a0, h1), at(l0, a0, h1), col, l0, l1, h0, h1);
    wall(stone, at(l1, a1, h0), at(l0, a1, h0), at(l0, a1, h1), at(l1, a1, h1), sh(col, 0.92), l0, l1, h0, h1);
    wall(stone, at(l0, a1, h0), at(l0, a0, h0), at(l0, a0, h1), at(l0, a1, h1), sh(col, 0.88), a0, a1, h0, h1);
    wall(stone, at(l1, a0, h0), at(l1, a1, h0), at(l1, a1, h1), at(l1, a0, h1), sh(col, 0.88), a0, a1, h0, h1);
    plain.quad(at(l0, a0, h1), at(l1, a0, h1), at(l1, a1, h1), at(l0, a1, h1), sh(col, 1.02));
  };
  // Terrasse und Freitreppe
  box(plain, at, -24, 24, -10, 0, -3, 0, sh(W, 0.9), true);
  for (let k = 0; k < 6; k++) box(plain, at, -14, 14, -10 - (k + 1) * 0.9, -10 - k * 0.9, -3, -3 + (6 - k) * 0.5, sh(W, 0.86), true);
  // Langhaus und Querhaus
  sbox(-17, 17, 8, 62, 0, 24, W);
  sbox(-26, 26, 22, 44, 0, 22, W);
  // Vorhalle mit drei Bögen
  sbox(-15, 15, 0, 8, 0, 17, W);
  for (let k = -1; k <= 1; k++) {
    const c = k * 9;
    plain.quad(at(c - 3, -0.05, 0), at(c + 3, -0.05, 0), at(c + 3, -0.05, 10), at(c - 3, -0.05, 10), Dk);
    for (let q = 0; q < 6; q++) {
      const t0 = (PI * q) / 6, t1 = (PI * (q + 1)) / 6;
      plain.tri(at(c, -0.05, 10), at(c + Math.cos(t0) * 3, -0.05, 10 + Math.sin(t0) * 3), at(c + Math.cos(t1) * 3, -0.05, 10 + Math.sin(t1) * 3), Dk);
    }
  }
  // Giebel über der Vorhalle
  plain.tri(at(-15, -0.1, 17), at(15, -0.1, 17), at(0, -0.1, 22), sh(W, 1.04));
  // zwei kleine Kuppeltürme an der Front
  for (const sx of [-1, 1]) {
    cyl(plain, at, sx * 13, 4, 3.4, 3.4, 17, 25, 12, W, false);
    dome(plain, at, sx * 13, 4, 3.6, 25, 1.25, 12, 5, W);
    cyl(plain, at, sx * 13, 4, 0.5, 0.2, 29.5, 32, 6, G);
  }
  // große Kuppel: Unterbau, Tambour mit Säulen, eiförmige Kuppel, Laterne
  const cA = 33;
  sbox(-13, 13, cA - 13, cA + 13, 22, 30, W);
  cyl(plain, at, 0, cA, 11, 11, 30, 44, 24, (k) => (k % 2 ? W : sh(W, 0.93)), false);
  for (let k = 0; k < 24; k++) {
    const t = (k / 24) * 2 * PI;
    cyl(plain, at, Math.cos(t) * 11.4, cA + Math.sin(t) * 11.4, 0.45, 0.45, 32, 42, 6, sh(W, 1.04), false);
  }
  cyl(plain, at, 0, cA, 11.8, 11.2, 44, 46, 24, sh(W, 1.05), false);
  dome(plain, at, 0, cA, 11.2, 46, 1.85, 24, 9, W, sh(W, 0.9));
  cyl(plain, at, 0, cA, 2.6, 2.6, 66.5, 73, 12, W, false);
  dome(plain, at, 0, cA, 2.8, 73, 1.6, 12, 4, W);
  cyl(plain, at, 0, cA, 0.4, 0.15, 77.5, 83, 6, G);
  // vier kleine Kuppeln um die große
  for (const sx of [-1, 1]) for (const sa of [-1, 1]) {
    const l = sx * 15, a = cA + sa * 14;
    cyl(plain, at, l, a, 3.6, 3.6, 22, 32, 12, W, false);
    dome(plain, at, l, a, 3.8, 32, 1.4, 12, 5, W);
    cyl(plain, at, l, a, 0.5, 0.2, 37, 39.5, 6, G);
  }
  // Chor mit Apsis
  cyl(plain, at, 0, 62, 15, 15, 0, 22, 16, W, true);
  // Glockenturm hinten
  sbox(-6, 6, 70, 82, 0, 56, W);
  cyl(plain, at, 0, 76, 5.4, 5.4, 56, 64, 16, W, false);
  dome(plain, at, 0, 76, 5.6, 64, 1.5, 16, 5, W);
  cyl(plain, at, 0, 76, 0.6, 0.2, 72, 84, 6, G);
  // dunkle Fenster des Tambours und der Front
  for (let k = 0; k < 12; k++) {
    const t = ((k + 0.5) / 12) * 2 * PI;
    const p = (h: number, d: number) => at(Math.cos(t) * 11.05 + Math.cos(t + PI / 2) * d, cA + Math.sin(t) * 11.05 + Math.sin(t + PI / 2) * d, h);
    plain.quad(p(34, -1), p(34, 1), p(40, 1), p(40, -1), Dk);
  }
}

// ------------------------------------------------------------------ Straßenmöbel (Requisiten)

const GREEN = lin('#1f3a2e');
const GREEN_L = lin('#2c4f3f');
const GOLD = lin('#c8a44a');

/** Geometrien der Pariser Requisiten (Fuß bei y = 0, Straße in −z) */
export function parisProps(): Record<'lampParis' | 'morris' | 'kiosk' | 'wallace' | 'obelisk', THREE.BufferGeometry> {
  // Kandelaber: Fuß mit Wulst, kannelierter Mast, Laterne mit Glas und Dach
  const lamp = new GB();
  lamp.add(new THREE.CylinderGeometry(0.26, 0.34, 0.9, 8), M(0, 0.45), GREEN);
  lamp.add(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 8), M(0, 0.95), GREEN_L);
  lamp.add(new THREE.CylinderGeometry(0.075, 0.11, 3.0, 8), M(0, 2.5), GREEN);
  lamp.add(new THREE.CylinderGeometry(0.13, 0.1, 0.25, 8), M(0, 4.05), GREEN_L);
  lamp.add(new THREE.CylinderGeometry(0.28, 0.16, 0.62, 6), M(0, 4.5), lin('#fff1c8'));
  lamp.add(new THREE.CylinderGeometry(0.06, 0.34, 0.2, 6), M(0, 4.9), GREEN);
  lamp.add(new THREE.ConeGeometry(0.12, 0.3, 6), M(0, 5.12), GREEN);
  // Litfaßsäule (Colonne Morris): Sockel, Plakate rundum, Gesims, Kuppel mit Krone
  const morris = new GB();
  morris.add(new THREE.CylinderGeometry(0.7, 0.74, 0.45, 16), M(0, 0.22), GREEN);
  const POST = ['#e8d6a0', '#c0392b', '#2c5aa0', '#f2efe6', '#e67e22', '#1d1d1f', '#8e44ad', '#f1c40f'];
  for (let k = 0; k < 8; k++) {
    const g = new THREE.CylinderGeometry(0.62, 0.62, 2.3, 2, 1, true, (k / 8) * PI * 2, PI / 4);
    morris.add(g, M(0, 1.6), lin(POST[k]));
  }
  morris.add(new THREE.CylinderGeometry(0.76, 0.64, 0.25, 16), M(0, 2.85), GREEN);
  morris.add(new THREE.SphereGeometry(0.66, 12, 6, 0, PI * 2, 0, PI / 2), M(0, 2.95, 0, 1, 0.8, 1), GREEN_L);
  morris.add(new THREE.CylinderGeometry(0.12, 0.2, 0.35, 8), M(0, 3.62), GREEN);
  morris.add(new THREE.SphereGeometry(0.12, 8, 4), M(0, 3.86), GREEN_L);
  // Kiosk: Kasten mit Auslage, geschwungenes Dach mit Zier
  const kiosk = new GB();
  kiosk.add(new THREE.BoxGeometry(1.9, 2.2, 1.4), M(0, 1.1), GREEN);
  kiosk.add(new THREE.BoxGeometry(1.7, 1.2, 0.04), M(0, 1.3, -0.72), lin('#e9dcc0'));
  for (let k = 0; k < 6; k++) kiosk.add(new THREE.BoxGeometry(0.22, 0.3, 0.03), M(-0.65 + k * 0.26, 1.35 + (k % 2) * 0.32, -0.75), lin(POST[k + 1]));
  kiosk.add(new THREE.BoxGeometry(2.2, 0.16, 1.7), M(0, 2.28), GREEN_L);
  kiosk.add(new THREE.CylinderGeometry(0.3, 1.25, 0.6, 6), M(0, 2.66, 0, 1, 1, 0.75), GREEN);
  kiosk.add(new THREE.SphereGeometry(0.18, 8, 6), M(0, 3.05), GOLD);
  // Wallace-Brunnen: Sockel, vier Karyatiden (als Säulchen), Kuppel mit Schuppen und Spitze
  const wal = new GB();
  wal.add(new THREE.CylinderGeometry(0.5, 0.6, 0.65, 8), M(0, 0.32), GREEN);
  for (let k = 0; k < 4; k++) {
    const t = (k / 4) * PI * 2 + PI / 4;
    wal.add(new THREE.CylinderGeometry(0.07, 0.09, 1.2, 6), M(Math.cos(t) * 0.28, 1.25, Math.sin(t) * 0.28), GREEN_L);
  }
  wal.add(new THREE.CylinderGeometry(0.42, 0.42, 0.14, 8), M(0, 1.92), GREEN);
  wal.add(new THREE.SphereGeometry(0.42, 10, 5, 0, PI * 2, 0, PI / 2), M(0, 1.98, 0, 1, 1.05, 1), GREEN_L);
  wal.add(new THREE.ConeGeometry(0.07, 0.3, 6), M(0, 2.55), GREEN);
  // Obelisk von Luxor (Place de la Concorde): Sockel aus grauem Granit, Schaft aus rosa Granit, goldene Spitze
  const ob = new GB();
  ob.add(new THREE.BoxGeometry(4.2, 0.8, 4.2), M(0, 0.4), lin('#8d8b86'));
  ob.add(new THREE.BoxGeometry(3.1, 6.6, 3.1), M(0, 4.1), lin('#9c9a94'));
  ob.add(new THREE.BoxGeometry(3.5, 0.6, 3.5), M(0, 7.7), lin('#8d8b86'));
  ob.add(new THREE.CylinderGeometry(1.2, 1.75, 21.6, 4, 1), M(0, 18.8, 0, 1, 1, 1, PI / 4), lin('#c39b85'));
  ob.add(new THREE.ConeGeometry(1.2, 2.2, 4), M(0, 30.7, 0, 1, 1, 1, PI / 4), GOLD);
  return { lampParis: lamp.build(), morris: morris.build(), kiosk: kiosk.build(), wallace: wal.build(), obelisk: ob.build() };
}
