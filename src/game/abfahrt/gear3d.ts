/**
 * Ausrüstung des Fahrers in 3D: Kopf mit Gesicht (Nase, Lippen, Kinn, Wangenknochen), Ohren und
 * Haaren, darauf je nach Rad
 *  · ein belüfteter Straßenhelm: Schale mit echten Lüftungsschlitzen (dunkle Kanäle mit Wänden),
 *    dicker Rand, Heck in Teamfarbe, Verstellrad hinten, Y-Riemen unter den Ohren, Kinnschnalle,
 *  · ein Zeitfahrhelm der späten 80er: lange Tropfenschale, die die Ohren bedeckt,
 *  · eine Stoffmütze der 70er mit Streifen und hochgeklapptem Schirm,
 * dazu eine verspiegelte Rundum-Brille. Außerdem Radschuhe (Sohle, Fersenkappe, Drehverschlüsse)
 * mit Klickpedal oder klassischem Pedal mit Haken und Lederriemen.
 *
 * Alles glänzt über das gemeinsame Glanzmaterial (gloss.ts); Stufe 0 für Gegner, 1 für das eigene Rad.
 * Kopf: Mittelpunkt im Ursprung, Gesicht nach −z. Schuh: Ursprung in der Pedalachse, Spitze nach −z.
 */
import * as THREE from 'three';
import type { BikeSpec } from '../bikes';
import type { Kit } from './rider';
import { Mesher, merge, rgb, type C3 } from './gloss';
import { M4, X, Z, along, pathFrames, pipe, revolve, shape, strut, sweep, type Warp } from './prim3d';

type V = THREE.Vector3;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const mix = (a: C3, b: C3, t: number): C3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a: C3, f: number): C3 => [a[0] * f, a[1] * f, a[2] * f];
const g1 = (x: number, s: number) => Math.exp(-(x * x) / (s * s));
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// ------------------------------------------------------------------ Kopfform

/** Querschnitte des Kopfes von oben nach unten: Höhe, halbe Breite, Tiefe vorn/hinten, Eckigkeit, Versatz */
const RINGS: [number, number, number, number, number, number][] = [
  [0.104, 0.012, 0.014, 0.014, 2.0, 0.008],
  [0.1, 0.038, 0.046, 0.052, 2.1, 0.008],
  [0.09, 0.056, 0.068, 0.076, 2.2, 0.006],
  [0.074, 0.068, 0.084, 0.09, 2.3, 0.004],
  [0.054, 0.075, 0.093, 0.098, 2.4, 0.003],
  [0.032, 0.078, 0.097, 0.101, 2.5, 0.002],
  [0.012, 0.078, 0.097, 0.101, 2.6, 0.002],
  [-0.008, 0.076, 0.094, 0.099, 2.6, 0.002],
  [-0.028, 0.074, 0.092, 0.094, 2.5, 0.0],
  [-0.048, 0.071, 0.091, 0.086, 2.4, -0.004],
  [-0.066, 0.066, 0.088, 0.074, 2.3, -0.007],
  [-0.082, 0.063, 0.084, 0.06, 2.3, -0.009],
  [-0.098, 0.057, 0.077, 0.047, 2.3, -0.012],
  [-0.112, 0.047, 0.068, 0.036, 2.2, -0.015],
  [-0.123, 0.033, 0.053, 0.026, 2.2, -0.016],
  [-0.13, 0.014, 0.032, 0.016, 2.0, -0.016],
];

function ringAt(y: number) {
  let i = 0;
  while (i < RINGS.length - 2 && RINGS[i + 1][0] > y) i++;
  const r0 = RINGS[i];
  const r1 = RINGS[i + 1];
  const t = clamp01((r0[0] - y) / (r0[0] - r1[0]));
  const l = (k: number) => r0[k] + (r1[k] - r0[k]) * t;
  return { a: l(1), f: l(2), b: l(3), p: l(4), cz: l(5) };
}

/** Nase: [Höhe, Vorsprung, Breite] */
const NOSE: [number, number, number][] = [[-0.001, 0, 0.1], [-0.01, 0.006, 0.1], [-0.025, 0.012, 0.11], [-0.04, 0.019, 0.13], [-0.048, 0.022, 0.16], [-0.055, 0.013, 0.22], [-0.062, 0, 0.25]];

/** Gesichtszüge als Abstand zur Grundform (φ = 0 vorn, + rechts) */
function features(y: number, phi: number): number {
  const ap = Math.abs(phi);
  let r = 0;
  if (y < NOSE[0][0] && y > NOSE[NOSE.length - 1][0]) {
    let k = 0;
    while (NOSE[k + 1][0] > y) k++;
    const t = (NOSE[k][0] - y) / (NOSE[k][0] - NOSE[k + 1][0]);
    const amt = NOSE[k][1] + (NOSE[k + 1][1] - NOSE[k][1]) * t;
    const wid = NOSE[k][2] + (NOSE[k + 1][2] - NOSE[k][2]) * t;
    r += amt * g1(phi, wid);
  }
  r += 0.003 * g1(y - 0.01, 0.007) * g1(ap - 0.35, 0.3);          // Brauenbogen
  r -= 0.006 * g1(y + 0.008, 0.011) * g1(ap - 0.36, 0.16);        // Augenhöhlen
  r += 0.005 * g1(y + 0.03, 0.014) * g1(ap - 0.72, 0.25);         // Wangenknochen
  r += 0.003 * g1(y + 0.07, 0.006) * g1(phi, 0.32);               // Oberlippe
  r -= 0.0025 * g1(y + 0.079, 0.0028) * g1(phi, 0.3);             // Mundlinie
  r += 0.003 * g1(y + 0.086, 0.005) * g1(phi, 0.28);              // Unterlippe
  r += 0.007 * g1(y + 0.106, 0.009) * g1(phi, 0.3);               // Kinn
  r += 0.004 * g1(y + 0.092, 0.012) * g1(ap - 1.25, 0.25);        // Kieferwinkel
  r -= 0.003 * g1(y - 0.03, 0.015) * g1(ap - 1.05, 0.25);         // Schläfen
  return r;
}

/** Punkt auf der Kopfoberfläche (ohne/mit Gesichtszügen), um off nach außen versetzt */
export function headPoint(y: number, phi: number, off = 0, feat = true): V {
  const { a, f, b, p, cz } = ringAt(y);
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  const d = c > 0 ? f : b;
  const R = 1 / Math.pow(Math.pow(Math.abs(s) / a, p) + Math.pow(Math.abs(c) / d, p), 1 / p) + (feat ? features(y, phi) : 0) + off;
  return v3(R * s, y, cz - R * c);
}

/** Abstand vom Punkt C entlang d bis zur Kopfoberfläche (ohne Gesichtszüge) */
function headDist(C: V, d: V): number {
  let lo = 0.005;
  let hi = 0.2;
  const p = new THREE.Vector3();
  for (let i = 0; i < 26; i++) {
    const t = (lo + hi) / 2;
    p.copy(C).addScaledVector(d, t);
    let inside = false;
    if (p.y < 0.104 && p.y > -0.13) {
      const { cz } = ringAt(p.y);
      const phi = Math.atan2(p.x, -(p.z - cz));
      const s = headPoint(p.y, phi, 0, false);
      inside = Math.hypot(p.x, p.z - cz) < Math.hypot(s.x, s.z - cz);
    }
    if (inside) lo = t; else hi = t;
  }
  return (lo + hi) / 2;
}

/** Haaransatz (Höhe) je Winkel |φ|: Stirn, Koteletten, über dem Ohr, Nacken */
const HAIRLINE: [number, number][] = [[0, 0.058], [0.7, 0.048], [1.05, 0.028], [1.25, -0.01], [1.38, -0.03], [1.46, 0.012], [1.72, 0.016], [1.95, -0.012], [2.4, -0.05], [Math.PI, -0.068]];
function hairY(phi: number): number {
  const ap = Math.abs(phi);
  let k = 0;
  while (k < HAIRLINE.length - 2 && HAIRLINE[k + 1][0] < ap) k++;
  const [a0, y0] = HAIRLINE[k];
  const [a1, y1] = HAIRLINE[k + 1];
  return y0 + (y1 - y0) * clamp01((ap - a0) / (a1 - a0));
}

const HAIR = ['#2b1d14', '#3d2817', '#1a1714', '#5a3a22', '#8a6a3c', '#b08a50'];
function hairColor(kit: Kit): C3 {
  let h = 0;
  for (const ch of kit.number + kit.skin) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [r, g, b] = rgb(kit.skin);
  const dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.32;
  return rgb(dark ? HAIR[h % 3] : HAIR[h % HAIR.length]);
}

/** Haut, Haare, Hals und (bei der Mütze) Augen; o: eigene Haarfarbe, lange Haare (Haaransatz hinten bis in den Nacken) */
function buildHead(m: Mesher, hairM: Mesher, kit: Kit, q: 0 | 1, eyes: boolean, hairTop: number, o: { hair?: C3; long?: boolean; upright?: boolean } = {}) {
  const skin = rgb(kit.skin);
  const lip = mix(skin, rgb('#a4545a'), 0.38);
  const hair = o.hair ?? hairColor(kit);
  const hairEdge = (phi: number) => (o.long ? Math.min(hairY(phi), -0.13 * clamp01((Math.abs(phi) - 0.95) / 0.55) + hairY(phi) * (1 - clamp01((Math.abs(phi) - 0.95) / 0.55))) : hairY(phi));
  const ys = q
    ? [0.104, 0.1, 0.094, 0.086, 0.076, 0.064, 0.05, 0.036, 0.024, 0.014, 0.006, -0.002, -0.009, -0.016, -0.023, -0.03, -0.037, -0.043, -0.048, -0.053, -0.058, -0.063, -0.068, -0.072, -0.076, -0.08, -0.084, -0.089, -0.095, -0.101, -0.107, -0.113, -0.119, -0.125, -0.13]
    : [0.104, 0.09, 0.06, 0.025, -0.008, -0.04, -0.07, -0.098, -0.13];
  const N = q ? 40 : 12;
  const ex = q ? 1.35 : 1.2;
  // Winkel: vorn dicht (Gesicht), hinten weiter
  const phis: number[] = [];
  for (let j = 0; j <= N; j++) {
    const u = (j / N) * 2 - 1;
    phis.push(Math.PI * Math.sign(u) * Math.pow(Math.abs(u), ex));
  }
  const W = N + 1;
  const firstS = m.count;
  for (const y of ys) {
    const start = m.count;
    for (const phi of phis) {
      const p = headPoint(y, phi, 0, true);
      const lipK = g1(y + 0.078, 0.009) * g1(phi, 0.28);
      m.v(p.x, p.y, p.z, lipK > 0.05 ? mix(skin, lip, clamp01(lipK * 1.4)) : skin);
    }
    m.seams.push([start, start + N]);
  }
  for (let i = 0; i < ys.length - 1; i++) {
    for (let j = 0; j < N; j++) {
      const a = firstS + i * W + j;
      m.idx.push(a, a + 1, a + W, a + 1, a + W + 1, a + W);
    }
  }
  // Haare: von oben (bzw. unter dem Helm) bis zum Haaransatz, leicht unregelmäßige Kante, 2,8 mm über der Haut
  const NH = q ? 9 : 2;
  const fh = hairM.count;
  for (let i = 0; i <= NH; i++) {
    const u = i / NH;
    const start = hairM.count;
    phis.forEach((phi, j) => {
      const edge = hairEdge(phi) + (i === NH ? 0.0025 * Math.sin(j * 2.7) : 0);
      const y = hairTop + (edge - hairTop) * u;
      // Abstand zur Haut entlang der Kopfnormalen (oben auf dem Scheitel sonst zu dicht an der Haut)
      const p = headPoint(y, phi, 0, false);
      p.addScaledVector(p.clone().sub(v3(0, p.y * 0.4, 0)).normalize(), 0.0028 - 0.001 * u * u);
      hairM.v(p.x, p.y, p.z, i === NH ? mix(hair, skin, 0.25) : hair);
    });
    hairM.seams.push([start, start + N]);
  }
  for (let i = 0; i < NH; i++) {
    for (let j = 0; j < N; j++) {
      const a = fh + i * W + j;
      hairM.idx.push(a, a + 1, a + W, a + 1, a + W + 1, a + W);
    }
  }
  if (hairTop >= 0.1) {
    const hc = hairM.v(0, 0.108, 0.004, hair);
    for (let j = 0; j < N; j++) hairM.idx.push(hc, fh + j + 1, fh + j);
  }
  // Deckel oben (im Haar) und unten
  const top = headPoint(ys[0], 0, 0, true);
  const ct = m.v(0, top.y + 0.0005, top.z + 0.002, skin);
  const cb = m.v(0, ys[ys.length - 1] - 0.0005, -0.016, skin);
  const last = (ys.length - 1) * W;
  for (let j = 0; j < N; j++) {
    m.idx.push(ct, firstS + j + 1, firstS + j);
    m.idx.push(cb, firstS + last + j, firstS + last + j + 1);
  }
  // Ohren: flache, nach hinten geneigte Muscheln
  const ear = mix(skin, rgb('#c77b6b'), 0.18);
  for (const sx of [-1, 1]) {
    const c = headPoint(-0.017, sx * 1.56, 0.004, false);
    m.add(new THREE.SphereGeometry(1, q ? 12 : 5, q ? 8 : 3), M4(c.x, c.y, c.z + 0.008, -0.22, sx * 0.28, 0, 0.0105, 0.031, 0.018), ear);
    if (q) m.add(new THREE.SphereGeometry(1, 8, 6), M4(c.x + sx * 0.006, c.y + 0.002, c.z + 0.006, -0.22, sx * 0.28, 0, 0.004, 0.017, 0.009), mul(ear, 0.7));
  }
  // Hals: beim Fahrer schräg nach hinten unten in den Rumpf, beim Stehen (upright) fast senkrecht
  const neck: V[] = o.upright
    ? [v3(0, -0.055, 0.016), v3(0, -0.1, 0.02), v3(0, -0.145, 0.022), v3(0, -0.19, 0.022)]
    : [v3(0, -0.055, 0.018), v3(0, -0.1, 0.035), v3(0, -0.145, 0.055), v3(0, -0.19, 0.075)];
  const fr = neck.map(() => ({ s: v3(-1, 0, 0), c: v3(0, 0, 1) }));
  // Rahmen für Linie nach unten: s × c = −t → (−x) × z = y … die Linie läuft nach unten (−y), also passt es
  sweep(m, neck, fr, (i) => [0.098, 0.102, 0.108, 0.116][i], (i) => [0.09, 0.094, 0.1, 0.104][i], () => skin, shape('round', q ? 16 : 6));
  // Augen (nur ohne Brille sichtbar)
  if (eyes) {
    const white = rgb('#f1ece4');
    const iris = rgb('#3b2a1e');
    for (const sx of [-1, 1]) {
      const e = headPoint(-0.008, sx * 0.36, -0.0075, false);
      m.add(new THREE.SphereGeometry(0.0085, 10, 8), M4(e.x, e.y, e.z, 0, 0, 0, 1, 0.62, 1), white);
      const ir = e.clone().add(v3(sx * 0.0004, 0.0004, -0.0078));
      m.add(new THREE.SphereGeometry(0.0046, 8, 6), M4(ir.x, ir.y, ir.z, 0, 0, 0, 1, 1, 0.45), iris);
      const b0 = headPoint(0.011, sx * 0.18, 0.0015, true);
      const b1 = headPoint(0.013, sx * 0.55, 0.0015, true);
      strut(hairM, b0, b1, 0.007, 0.003, hair, v3(0, 1, 0), 0.005, 0.0025);
    }
  }
}

// ------------------------------------------------------------------ Schalen (Helm, Mütze)

interface ShellOpt {
  /** Mittelpunkt und Halbachsen (seitlich, oben, vorn, hinten) */
  C: V; A: number; B: number; Cf: number; Cb: number;
  /** Rand vorn und hinten als Winkel um die Querachse, je Seitenwinkel α */
  psiF: (al: number) => number;
  psiB: (al: number) => number;
  /** zusätzlicher Radius je Richtung (Wölbung hinten) */
  extra?: (d: V) => number;
  /** eigene Form statt Ellipsoid (Richtung → Radius) */
  radius?: (d: V) => number;
  /** Lüftungsschlitze: [seitlich von, bis (−1…1), vorn→hinten von, bis (0…1)] */
  vents: [number, number, number, number][];
  /** Farbe der Schale an einer Stelle (seitlich λ, längs v) */
  col: (lam: number, v: number) => C3;
  /** zusätzliche Linien für scharfe Farbgrenzen */
  lamLines?: number[];
  vLines?: number[];
  stepA: number;
  stepV: number;
  /** Dicke am Rand, Tiefe der Schlitze */
  thick: number;
  depth: number;
  inner: C3;
  wall: C3;
  /** Wände in den Schlitzen (nur in der Nähe nötig) */
  walls?: boolean;
}

/**
 * Schale über dem Kopf, aufgespannt um die Querachse (Pole links und rechts über den Ohren):
 * Linien gleicher Seitenlage laufen von vorn nach hinten – darin liegen die Lüftungsschlitze.
 */
function shell(m: Mesher, dark: Mesher, o: ShellOpt) {
  const a0 = 0.05;
  const uniq = (arr: number[]) => arr.sort((x, y) => x - y).filter((x, i, a) => i === 0 || x - a[i - 1] > 1e-4);
  const alL: number[] = [];
  for (let al = a0; al < Math.PI - a0; al += o.stepA) alL.push(al);
  alL.push(Math.PI - a0);
  for (const [l0, l1] of o.vents) alL.push(Math.acos(l1), Math.acos(l0));
  for (const l of o.lamLines ?? []) alL.push(Math.acos(l));
  const als = uniq(alL.filter((x) => x >= a0 && x <= Math.PI - a0));
  const vL: number[] = [];
  for (let v = 0; v < 1; v += o.stepV) vL.push(v);
  vL.push(1);
  for (const [, , v0, v1] of o.vents) vL.push(v0, v1);
  for (const v of o.vLines ?? []) vL.push(v);
  const vs = uniq(vL.filter((x) => x >= 0 && x <= 1));
  const I = als.length;
  const J = vs.length;
  const dir = (al: number, v: number) => {
    const psi = o.psiF(al) + (o.psiB(al) - o.psiF(al)) * v;
    return v3(Math.cos(al), Math.sin(al) * Math.cos(psi), Math.sin(al) * Math.sin(psi));
  };
  const rad = (d: V) => {
    if (o.radius) return o.radius(d);
    const cz = d.z < 0 ? o.Cf : o.Cb;
    return 1 / Math.sqrt((d.x / o.A) ** 2 + (d.y / o.B) ** 2 + (d.z / cz) ** 2) + (o.extra ? o.extra(d) : 0);
  };
  const P: V[] = [];
  const F: V[] = [];
  const L: V[] = [];
  for (let i = 0; i < I; i++) {
    for (let j = 0; j < J; j++) {
      const d = dir(als[i], vs[j]);
      const r = rad(d);
      P.push(o.C.clone().addScaledVector(d, r));
      F.push(o.C.clone().addScaledVector(d, r - (o.walls === false ? 0.0025 : o.depth)));
      L.push(o.C.clone().addScaledVector(d, r - o.thick));
    }
  }
  const at = (i: number, j: number) => i * J + j;
  const vent = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= I - 1 || j >= J - 1) return false;
    const lam = Math.cos((als[i] + als[i + 1]) / 2);
    const v = (vs[j] + vs[j + 1]) / 2;
    return o.vents.some(([l0, l1, v0, v1]) => lam > l0 && lam < l1 && v > v0 && v < v1);
  };
  // Außenhaut (Ecken geteilt), Farbe je Ecke, Normalen exakt aus der Fläche (keine Streifen an dünnen Zellen)
  const base = m.count;
  const pAt = (al: number, v: number) => { const d = dir(al, v); return o.C.clone().addScaledVector(d, rad(d)); };
  const e = 1e-3;
  for (let i = 0; i < I; i++) {
    for (let j = 0; j < J; j++) {
      const p = P[at(i, j)];
      const k = m.v(p.x, p.y, p.z, o.col(Math.cos(als[i]), vs[j]));
      const da = pAt(als[i] + e, vs[j]).sub(pAt(als[i] - e, vs[j]));
      const dv = pAt(als[i], vs[j] + e).sub(pAt(als[i], vs[j] - e));
      const nn = new THREE.Vector3().crossVectors(da, dv).normalize();
      m.fixed.set(k, [nn.x, nn.y, nn.z]);
    }
  }
  for (let i = 0; i < I - 1; i++) {
    for (let j = 0; j < J - 1; j++) {
      if (vent(i, j)) continue;
      m.quad(base + at(i, j), base + at(i + 1, j), base + at(i + 1, j + 1), base + at(i, j + 1));
    }
  }
  // Pole: kleine Fächer schließen die Seiten
  for (const [i, sgn] of [[0, 1], [I - 1, -1]] as [number, number][]) {
    const pole = o.C.clone().add(v3(sgn * rad(v3(sgn, 0, 0)), 0, 0));
    const pc = m.v(pole.x, pole.y, pole.z, o.col(sgn, 0.5));
    for (let j = 0; j < J - 1; j++) {
      if (sgn > 0) m.tri(pc, base + at(i, j), base + at(i, j + 1));
      else m.tri(pc, base + at(i, j + 1), base + at(i, j));
    }
  }
  // Schlitze: Boden und Wände (eigene Ecken, dunkel)
  const quad4 = (a: V, b: V, c: V, d: V, col: C3) => {
    const s = dark.count;
    for (const p of [a, b, c, d]) dark.v(p.x, p.y, p.z, col);
    dark.quad(s, s + 1, s + 2, s + 3);
  };
  for (let i = 0; i < I - 1; i++) {
    for (let j = 0; j < J - 1; j++) {
      if (!vent(i, j)) continue;
      quad4(F[at(i, j)], F[at(i + 1, j)], F[at(i + 1, j + 1)], F[at(i, j + 1)], o.inner);
      if (o.walls === false) continue;
      if (!vent(i - 1, j)) quad4(P[at(i, j)], F[at(i, j)], F[at(i, j + 1)], P[at(i, j + 1)], o.wall);
      if (!vent(i + 1, j)) quad4(P[at(i + 1, j + 1)], F[at(i + 1, j + 1)], F[at(i + 1, j)], P[at(i + 1, j)], o.wall);
      if (!vent(i, j - 1)) quad4(P[at(i, j)], P[at(i + 1, j)], F[at(i + 1, j)], F[at(i, j)], o.wall);
      if (!vent(i, j + 1)) quad4(F[at(i, j + 1)], F[at(i + 1, j + 1)], P[at(i + 1, j + 1)], P[at(i, j + 1)], o.wall);
    }
  }
  // dicker Rand vorn und hinten (Unterseite der Schale)
  for (let i = 0; i < I - 1; i++) {
    quad4(L[at(i, 0)], L[at(i + 1, 0)], P[at(i + 1, 0)], P[at(i, 0)], o.inner);
    quad4(P[at(i, J - 1)], P[at(i + 1, J - 1)], L[at(i + 1, J - 1)], L[at(i, J - 1)], o.inner);
  }
  return { P, at, J, I, als, vs };
}

/** flaches Band entlang von Punkten, Außenseite in Richtung der Normalen */
function ribbon(m: Mesher, pts: V[], nrm: V[], width: number, col: C3) {
  const s = m.count;
  const t = new THREE.Vector3();
  const w = new THREE.Vector3();
  for (let k = 0; k < pts.length; k++) {
    t.subVectors(pts[Math.min(pts.length - 1, k + 1)], pts[Math.max(0, k - 1)]).normalize();
    w.crossVectors(nrm[k], t).normalize().multiplyScalar(width / 2);
    m.v(pts[k].x - w.x, pts[k].y - w.y, pts[k].z - w.z, col);
    m.v(pts[k].x + w.x, pts[k].y + w.y, pts[k].z + w.z, col);
  }
  for (let k = 0; k < pts.length - 1; k++) {
    const a = s + k * 2;
    m.quad(a, a + 2, a + 3, a + 1);
  }
}

/** Band über die Kopfhaut: Wegpunkte (Höhe, Winkel), Abstand zur Haut */
function skinRibbon(m: Mesher, way: [number, number][], off: number, width: number, col: C3, steps: number) {
  const curve = new THREE.CatmullRomCurve3(way.map(([y, phi]) => v3(phi, y, 0)), false, 'centripetal');
  const pts: V[] = [];
  const nrm: V[] = [];
  for (const p of curve.getSpacedPoints(steps)) {
    const q = headPoint(p.y, p.x, off, true);
    pts.push(q);
    nrm.push(q.clone().sub(v3(0, q.y * 0.4, 0)).normalize());
  }
  ribbon(m, pts, nrm, width, col);
}

/** auffällige Farbe? (sonst grau/schwarz/weiß) */
function colorful(hex: string): boolean {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return hsl.s > 0.35 && hsl.l > 0.18 && hsl.l < 0.82;
}

type Head = BikeSpec['head'];

/** verspiegelte Rundum-Brille mit Bügeln über den Ohren */
function buildGlasses(lens: Mesher, frame: Mesher, kit: Kit, q: 0 | 1, wide: boolean, tintHex?: string) {
  const tint = rgb(tintHex ?? (colorful(kit.side) ? kit.side : colorful(kit.jersey) ? kit.jersey : '#3d6bff'));
  const NP = q ? 22 : 6;
  const NY = q ? 4 : 1;
  const span = wide ? 1.12 : 1.04;
  const yTop = (phi: number) => 0.019 - 0.007 * (phi / span) ** 2;
  const yBot = (phi: number) => -0.03 + 0.014 * (phi / span) ** 4 + 0.02 * g1(phi, 0.16);
  const off = (phi: number) => 0.0155 - 0.0045 * (phi / span) ** 2;
  const s = lens.count;
  for (let i = 0; i <= NP; i++) {
    const phi = -span + (2 * span * i) / NP;
    for (let j = 0; j <= NY; j++) {
      const y = yBot(phi) + ((yTop(phi) - yBot(phi)) * j) / NY;
      const p = headPoint(y, phi, off(phi), false);
      // leichte Wölbung nach vorn in der Mitte der Höhe
      lens.v(p.x, p.y, p.z - 0.0025 * Math.sin((j / NY) * Math.PI) * Math.cos(phi), mix(tint, mul(tint, 0.55), j / NY));
    }
  }
  for (let i = 0; i < NP; i++) {
    for (let j = 0; j < NY; j++) {
      const a = s + i * (NY + 1) + j;
      const b = a + NY + 1;
      lens.quad(a, a + 1, b + 1, b);
    }
  }
  // Rahmen oben am Glas
  const fc = rgb('#17181b');
  const fs = frame.count;
  for (let i = 0; i <= NP; i++) {
    const phi = -span + (2 * span * i) / NP;
    for (const [dy, d] of [[-0.0015, 0.0012], [0.0045, 0.0005]]) {
      const p = headPoint(yTop(phi) + dy, phi, off(phi) + d, false);
      frame.v(p.x, p.y, p.z, fc);
    }
  }
  for (let i = 0; i < NP; i++) {
    const a = fs + i * 2;
    frame.quad(a, a + 1, a + 3, a + 2);
  }
  // Bügel: von den Glasenden über die Ohren nach hinten
  for (const sx of [-1, 1]) {
    const pts: V[] = [];
    const K = q ? 10 : 2;
    for (let k = 0; k <= K; k++) {
      const t = k / K;
      const phi = sx * (span - 0.02 + (1.98 - span) * t);
      const y = 0.01 - 0.01 * t - 0.012 * Math.max(0, t - 0.75) * 4;
      pts.push(headPoint(y, phi, 0.0095 - 0.003 * t, false));
    }
    const s2 = frame.count;
    for (const p of pts) {
      frame.v(p.x, p.y - 0.0035, p.z, fc);
      frame.v(p.x, p.y + 0.0045, p.z, fc);
    }
    for (let k = 0; k < pts.length - 1; k++) {
      const a = s2 + k * 2;
      if (sx > 0) frame.quad(a, a + 1, a + 3, a + 2);
      else frame.quad(a, a + 2, a + 3, a + 1);
    }
  }
}

function roadHelmet(m: Mesher, dark: Mesher, straps: Mesher, kit: Kit, q: 0 | 1) {
  const base = rgb(kit.helmet);
  const acc = rgb(kit.jersey !== kit.helmet ? kit.jersey : kit.side);
  const side: [number, number, number, number][] = q
    ? [[0.15, 0.29, 0.07, 0.42], [0.15, 0.29, 0.5, 0.78], [0.39, 0.53, 0.13, 0.36], [0.39, 0.53, 0.44, 0.7], [0.63, 0.73, 0.24, 0.5]]
    : [[0.15, 0.29, 0.08, 0.4], [0.15, 0.29, 0.5, 0.74], [0.39, 0.53, 0.18, 0.62]];
  const vents: [number, number, number, number][] = [[-0.07, 0.07, 0.06, 0.2], ...(q ? [[-0.06, 0.06, 0.66, 0.8] as [number, number, number, number]] : [])];
  for (const [l0, l1, v0, v1] of side) vents.push([l0, l1, v0, v1], [-l1, -l0, v0, v1]);
  shell(m, dark, {
    C: v3(0, 0.026, 0.006), A: 0.1, B: 0.103, Cf: 0.122, Cb: 0.14,
    psiF: (al) => -1.5 - 0.12 * (1 - Math.sin(al)),
    psiB: (al) => 2.04 + 0.16 * Math.sin(al),
    extra: (d) => 0.007 * g1(d.z - 0.75, 0.25) * clamp01(d.y * 3 + 0.5),
    vents,
    col: (_lam, v) => (v > 0.906 ? acc : base),
    vLines: [0.905, 0.907],
    stepA: q ? 0.08 : 0.26,
    stepV: q ? 0.04 : 0.16,
    walls: !!q,
    thick: 0.016,
    depth: 0.012,
    inner: rgb('#2b2d31'),
    wall: mix(base, rgb('#3a3c40'), 0.55),
  });
  // Verstellsystem: Band um den Hinterkopf, Drehrad hinten
  const strap = rgb('#18191c');
  const TAU = Math.PI * 2;
  skinRibbon(straps, [[0.008, 1.9], [-0.016, 2.3], [-0.036, 2.75], [-0.042, Math.PI], [-0.036, TAU - 2.75], [-0.016, TAU - 2.3], [0.008, TAU - 1.9]], 0.004, 0.012, strap, q ? 18 : 6);
  const dp = headPoint(-0.042, Math.PI, 0.011, true);
  const dn = dp.clone().sub(v3(0, -0.02, 0)).normalize();
  straps.add(new THREE.CylinderGeometry(0.0135, 0.0135, 0.011, q ? 18 : 6), along(dp, dn), strap);
  if (q) straps.add(new THREE.CylinderGeometry(0.009, 0.009, 0.004, 12), along(dp.clone().addScaledVector(dn, 0.006), dn), acc);
  helmetStraps(straps, q);
}

/** Y-Riemen unter den Ohren, Verteiler, Kinnriemen mit Schnalle */
function helmetStraps(dark: Mesher, q: 0 | 1) {
  const strap = rgb('#1b1c1f');
  const st = q ? 10 : 2;
  for (const sx of [-1, 1]) {
    skinRibbon(dark, [[0.026, sx * 1.16], [0.0, sx * 1.22], [-0.03, sx * 1.33], [-0.052, sx * 1.46]], 0.002, 0.0105, strap, st);
    skinRibbon(dark, [[0.02, sx * 1.95], [-0.01, sx * 1.86], [-0.035, sx * 1.66], [-0.052, sx * 1.46]], 0.002, 0.0105, strap, st);
    skinRibbon(dark, [[-0.052, sx * 1.46], [-0.075, sx * 1.27], [-0.098, sx * 1.02], [-0.115, sx * 0.62], [-0.126, sx * 0.26], [-0.129, 0]], 0.0025, 0.012, strap, q ? st + 2 : 3);
    const dv = headPoint(-0.052, sx * 1.46, 0.0045, true);
    dark.add(new THREE.BoxGeometry(0.006, 0.016, 0.014), M4(dv.x, dv.y, dv.z, 0, sx * 0.1), rgb('#2a2b30'));
  }
  const bk = headPoint(-0.128, 0, 0.005, true);
  dark.add(new THREE.BoxGeometry(0.03, 0.007, 0.016), M4(bk.x, bk.y - 0.002, bk.z + 0.004), rgb('#2a2b30'));
}

function aeroHelmet(m: Mesher, dark: Mesher, straps: Mesher, kit: Kit, q: 0 | 1) {
  const base = rgb(kit.helmet);
  const acc = rgb(kit.side === kit.helmet ? kit.jersey : kit.side);
  // Längsachse des Tropfens leicht nach hinten unten geneigt
  const tilt = -0.3;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  shell(m, dark, {
    C: v3(0, -0.006, 0.012), A: 0.099, B: 0.13, Cf: 0.122, Cb: 0.25,
    psiF: (al) => -1.24 - 0.2 * (1 - Math.sin(al)),
    psiB: (al) => 2.15 + 0.08 * Math.sin(al),
    radius: (d) => {
      // in Achsrichtung drehen: y' = y·cos − z·sin, z' = y·sin + z·cos
      const y = d.y * ct - d.z * st;
      const z = d.y * st + d.z * ct;
      const back = z > 0;
      // Exponent stetig ändern (sonst entsteht eine Kante): vorn rund, hinten spitzer
      const k = clamp01((z + 0.1) / 0.5);
      const p = 2.1 - 0.35 * k * k * (3 - 2 * k);
      const C = back ? 0.255 : 0.122;
      // Heck nach hinten schmaler (Tropfen)
      const A = 0.1 * (back ? 1 - 0.1 * z : 1);
      const B = 0.134 * (back ? 1 - 0.16 * z : 1);
      return 1 / Math.pow(Math.pow(Math.abs(d.x) / A, p) + Math.pow(Math.abs(y) / B, p) + Math.pow(Math.abs(z) / C, p), 1 / p);
    },
    vents: [],
    col: (lam) => (Math.abs(lam) < 0.06 ? acc : base),
    lamLines: [-0.061, -0.059, 0.059, 0.061],
    stepA: q ? 0.07 : 0.24,
    stepV: q ? 0.03 : 0.12,
    thick: 0.012,
    depth: 0.01,
    inner: rgb('#141518'),
    wall: rgb('#26272b'),
  });
  helmetStraps(straps, q);
}

/** Stoffmütze der 70er: eng auf dem Kopf, Streifen von vorn nach hinten, Schirm hochgeklappt */
function cap(m: Mesher, dark: Mesher, kit: Kit, q: 0 | 1) {
  const white = rgb('#f2f0ea');
  const c1 = rgb(kit.jersey);
  const c2 = rgb(kit.side);
  const B = [0.075, 0.12, 0.2, 0.245, 0.33];
  const stripe = (lam: number): C3 => {
    const a = Math.abs(lam);
    return a < B[0] ? c1 : a < B[1] ? white : a < B[2] ? c2 : a < B[3] ? white : a < B[4] ? c1 : white;
  };
  const lines: number[] = [];
  for (const b of B) for (const sg of [-1, 1]) lines.push(sg * (b - 0.0015), sg * (b + 0.0015));
  const C = v3(0, 0.01, 0.004);
  const res = shell(m, dark, {
    C, A: 0, B: 0, Cf: 0, Cb: 0,
    radius: (d) => headDist(C, d) + 0.0062,
    psiF: (al) => -1.3 - 0.14 * (1 - Math.sin(al)),
    psiB: (al) => 1.98 + 0.05 * Math.sin(al),
    vents: [],
    col: (lam) => stripe(lam),
    lamLines: lines,
    stepA: q ? 0.07 : 0.24,
    stepV: q ? 0.06 : 0.2,
    thick: 0.004,
    depth: 0.004,
    inner: mul(white, 0.82),
    wall: white,
  });
  // Schirm vorn, hochgeklappt: von vorn sieht man die Unterseite
  const upper = rgb(kit.side);
  const under = rgb(kit.jersey);
  const { P, at, als } = res;
  const sel: number[] = [];
  for (let i = 0; i < als.length; i++) if (Math.abs(als[i] - Math.PI / 2) < 0.62) sel.push(i);
  const sb = m.count;
  for (const i of sel) {
    const rim = P[at(i, 0)];
    const out = v3(rim.x, 0, rim.z - C.z).normalize();
    const kk = (als[i] - Math.PI / 2) / 0.62;
    const len = 0.046 * (1 - 0.6 * kk * kk);
    const tip = rim.clone().addScaledVector(out, len * Math.cos(1.12)).add(v3(0, len * Math.sin(1.12), 0));
    for (const [p, c] of [[rim, under], [tip, under], [rim, upper], [tip, upper]] as [V, C3][]) m.v(p.x, p.y, p.z, c);
  }
  for (let n = 0; n < sel.length - 1; n++) {
    const a = sb + n * 4;
    const b = a + 4;
    m.quad(a, b, b + 1, a + 1);
    m.quad(a + 2, a + 3, b + 3, b + 2);
  }
}


// ------------------------------------------------------------------ Hüte und Mützen (Drehkörper um die Hochachse)

/** Drehkörper um die Hochachse: Profil [Radius (1 = Ellipse ax/az), Höhe, Farbe], außen von unten nach oben */
function upRevolve(m: Mesher, prof: [number, number, C3][], seg: number, ax: number, az: number, cz: number, closed: boolean, tilt = 0, warp?: Warp) {
  // revolve dreht um x: x → Höhe (y), danach Ellipse und Neigung nach vorn
  const mtx = new THREE.Matrix4().makeTranslation(0, 0, cz)
    .multiply(new THREE.Matrix4().makeRotationX(-tilt))
    .multiply(new THREE.Matrix4().makeScale(ax, 1, az))
    .multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
  revolve(m, prof, seg, v3(0, 0, 0), closed, mtx, warp);
}

/**
 * Melone: runde, feste Krone aus Filz mit Ripsband und Schleife links, schmale Krempe, die an den Seiten
 * nach oben rollt. Dazu ein Schnurrbart mit gezwirbelten Spitzen.
 */
function bowler(m: Mesher, band: Mesher, hairM: Mesher, kit: Kit, q: 0 | 1) {
  const felt = rgb('#1c1a19');
  const rib = rgb('#0d0d0e');
  const seg = q ? 40 : 12;
  const AX = 0.087;
  const AZ = 0.106;
  const CZ = 0.004;
  // Krone (Radius relativ zur Hutband-Ellipse)
  const crown: [number, number, C3][] = [[1.0, 0.032, felt], [1.0, 0.066, felt], [0.995, 0.098, felt], [0.96, 0.124, felt], [0.88, 0.146, felt], [0.74, 0.163, felt], [0.52, 0.175, felt], [0.26, 0.181, felt], [0.001, 0.183, felt]];
  upRevolve(m, q ? crown : [crown[0], crown[2], crown[4], crown[6], crown[8]], seg, AX, AZ, CZ, false);
  // Ripsband um den Kronenfuß
  upRevolve(band, [[1.012, 0.031, rib], [1.016, 0.034, rib], [1.016, 0.058, rib], [1.008, 0.061, rib]], seg, AX, AZ, CZ, false);
  if (q) {
    // Schleife auf der linken Seite
    const b = v3(-AX * 1.03, 0.046, CZ + 0.012);
    band.add(new THREE.SphereGeometry(1, 10, 6), new THREE.Matrix4().compose(b, new THREE.Quaternion(), v3(0.004, 0.009, 0.007)), rib);
    for (const dz of [-0.012, 0.012]) band.add(new THREE.SphereGeometry(1, 8, 6), new THREE.Matrix4().compose(b.clone().add(v3(0.001, 0, dz)), new THREE.Quaternion(), v3(0.003, 0.008, 0.01)), rib);
  }
  // Krempe: schmal, an den Seiten hochgerollt, vorn und hinten leicht gesenkt; Rand eingerollt
  const r0 = 1.0;
  const r1 = 1.52;
  const t = 0.004;
  const brim: [number, number, C3][] = [[r1, 0.028, felt], [r1 - 0.02, 0.03 + t, felt], [r0, 0.03 + t * 0.6, felt], [r0 - 0.004, 0.028, felt], [r0, 0.0255, felt], [r1 - 0.02, 0.0265, felt]];
  const warp: Warp = (j, _k, [r, x, c]) => {
    const a = (j / seg) * Math.PI * 2;
    const side = Math.sin(a) ** 2;
    const out = Math.max(0, (r - r0) / (r1 - r0));
    // seitlich hochgerollt (stärker außen), vorn/hinten leicht gesenkt
    return [r, x + 0.026 * side * out * out - 0.006 * (1 - side) * out, c];
  };
  upRevolve(m, brim, seg, AX, AZ, CZ, true, 0, warp);

  // Schnurrbart: zwei Bögen unter der Nase, außen gezwirbelt nach oben
  const hair = hairColor(kit);
  const dark = mix(hair, rgb('#000000'), 0.25);
  for (const sx of [-1, 1]) {
    const way: [number, number][] = [[-0.0665, -0.05], [-0.0675, 0.12], [-0.0705, 0.32], [-0.0695, 0.5], [-0.062, 0.63], [-0.053, 0.67], [-0.047, 0.63]];
    const pts = new THREE.CatmullRomCurve3(way.map(([y, ph]) => headPoint(y, sx * ph, 0.006 - 0.002 * Math.max(0, ph - 0.5) * 3, true)), false, 'centripetal').getPoints(q ? 16 : 5);
    const n = pts.length - 1;
    sweep(hairM, pts, pathFrames(pts, v3(0, 1, 0)), (i) => 0.013 * Math.max(0.12, 1 - Math.pow(i / n, 1.4)), (i) => 0.0085 * Math.max(0.15, 1 - Math.pow(i / n, 1.3)), (i) => mix(hair, dark, i / n), shape('round', q ? 8 : 5));
  }
}

/** Dienstmütze: Band mit Biese, ausladender Deckel, schwarz glänzender Schirm, goldene Kordel und Abzeichen */
function peaked(m: Mesher, visor: Mesher, trim: Mesher, q: 0 | 1) {
  const navy = rgb('#1f2a43');
  const band = rgb('#18213a');
  const pipe2 = rgb('#e8b923');
  const seg = q ? 40 : 12;
  const AX = 0.086;
  const AZ = 0.104;
  const CZ = 0.004;
  const tilt = 0.1;
  // Band und Deckel als ein Profil (außen von unten nach oben)
  const prof: [number, number, C3][] = [[1.0, 0.026, band], [1.005, 0.07, band], [1.012, 0.074, pipe2], [1.04, 0.079, navy], [1.17, 0.1, navy], [1.27, 0.114, navy], [1.29, 0.12, navy], [1.24, 0.127, navy], [0.9, 0.131, navy], [0.4, 0.133, navy], [0.001, 0.133, navy]];
  upRevolve(m, q ? prof : [prof[0], prof[1], prof[4], prof[6], prof[8], prof[10]], seg, AX, AZ, CZ, false, tilt);
  // Schirm vorn: abwärts geneigt, oben und unten Fläche, Rand
  const K = q ? 14 : 5;
  const top: V[] = [];
  const bot: V[] = [];
  for (let k = 0; k <= K; k++) {
    const ph = -1.05 + (2.1 * k) / K;
    const inner = v3(Math.sin(ph) * AX * 1.01, 0.028, CZ - Math.cos(ph) * AZ * 1.01);
    const out = v3(Math.sin(ph), 0, -Math.cos(ph)).normalize();
    const len = 0.058 * Math.cos(ph * 0.9) ** 0.7;
    const tip = inner.clone().addScaledVector(out, len).add(v3(0, -len * 0.42, 0));
    top.push(inner, tip);
    bot.push(inner.clone().add(v3(0, -0.003, 0)), tip.clone().add(v3(0, -0.003, 0)));
  }
  const black = rgb('#0b0b0c');
  const sT = visor.count;
  for (const p of top) visor.v(p.x, p.y, p.z, black);
  const sB = visor.count;
  for (const p of bot) visor.v(p.x, p.y, p.z, black);
  for (let k = 0; k < K; k++) {
    const a = k * 2;
    visor.quad(sT + a, sT + a + 1, sT + a + 3, sT + a + 2);
    visor.quad(sB + a, sB + a + 2, sB + a + 3, sB + a + 1);
    // Außenkante
    visor.quad(sT + a + 1, sB + a + 1, sB + a + 3, sT + a + 3);
  }
  if (!q) return;
  // Kordel über dem Schirm mit zwei Knöpfen, Abzeichen vorn am Deckel
  const gold = rgb('#d4a72c');
  const cord: V[] = [];
  for (let k = 0; k <= 16; k++) {
    const ph = -1.0 + (2.0 * k) / 16;
    cord.push(v3(Math.sin(ph) * AX * 1.035, 0.04 + 0.006 * Math.cos(ph * 1.5), CZ - Math.cos(ph) * AZ * 1.035));
  }
  pipe(trim, cord, 0.0018, 6, gold);
  for (const ph of [-1.02, 1.02]) trim.add(new THREE.SphereGeometry(0.0042, 10, 8), new THREE.Matrix4().makeTranslation(Math.sin(ph) * AX * 1.04, 0.04, CZ - Math.cos(ph) * AZ * 1.04), gold);
  const badge = v3(0, 0.094, CZ - AZ * 1.13);
  trim.add(new THREE.CylinderGeometry(0.011, 0.011, 0.003, 16), along(badge, v3(0, 0.28, -1)), gold);
  trim.add(new THREE.CylinderGeometry(0.006, 0.006, 0.0036, 12), along(badge.clone().add(v3(0, 0, -0.0006)), v3(0, 0.28, -1)), rgb('#b5352c'));
}

/**
 * Ring um den Kopf, der seiner Form folgt: Zeilen [Höhe, Abstand zur Haut, Farbe] von unten nach oben.
 * Flächen zeigen nach außen (Drehsinn wird an der ersten Fläche geprüft).
 */
function headWrap(m: Mesher, rows: [number, number, C3][], n: number) {
  const first = m.count;
  const W = n + 1;
  for (const [y, off, c] of rows) {
    const start = m.count;
    for (let j = 0; j <= n; j++) {
      const p = headPoint(y, (j / n) * Math.PI * 2 - Math.PI, off, false);
      m.v(p.x, p.y, p.z, c);
    }
    m.seams.push([start, start + n]);
  }
  // Drehsinn: Normale der ersten Fläche soll vom Kopf weg zeigen
  const P = (i: number) => v3(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]);
  const a0 = P(first), b0 = P(first + 1), c0 = P(first + W);
  const nrm = b0.clone().sub(a0).cross(c0.clone().sub(a0));
  const out = nrm.dot(a0.clone().setY(0)) > 0;
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = first + i * W + j;
      if (out) m.idx.push(a, a + 1, a + W, a + 1, a + W + 1, a + W);
      else m.idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
    }
  }
}

/** Frottee-Stirnband (70er), zweifarbig gestreift, liegt auf den Haaren */
function headband(m: Mesher, kit: Kit, q: 0 | 1) {
  const c1 = rgb(kit.jersey);
  const c2 = rgb('#f4f2ec');
  headWrap(m, [[0.01, 0.003, c2], [0.014, 0.0075, c2], [0.022, 0.009, c2], [0.0225, 0.009, c1], [0.044, 0.009, c1], [0.0445, 0.009, c2], [0.053, 0.0085, c2], [0.058, 0.004, c2]], q ? 40 : 12);
}

/** Bandana: eng anliegendes Tuch über dem Kopf, weißer Saum, Knoten mit zwei Zipfeln im Nacken */
function bandana(m: Mesher, dark: Mesher, q: 0 | 1) {
  const red = rgb('#a3191c');
  const hem = rgb('#f2ede4');
  const C = v3(0, 0.01, 0.004);
  shell(m, dark, {
    C, A: 0, B: 0, Cf: 0, Cb: 0,
    radius: (d) => headDist(C, d) + 0.0045,
    psiF: (al) => -1.22 - 0.12 * (1 - Math.sin(al)),
    psiB: (al) => 2.12 + 0.05 * Math.sin(al),
    vents: [],
    col: (_l, v) => (v < 0.035 ? hem : red),
    vLines: [0.034, 0.036],
    stepA: q ? 0.07 : 0.24,
    stepV: q ? 0.05 : 0.2,
    thick: 0.003,
    depth: 0.003,
    inner: mul(red, 0.6),
    wall: red,
  });
  // Knoten hinten, zwei Zipfel nach unten
  const k = headPoint(-0.03, Math.PI, 0.008, false);
  m.add(new THREE.SphereGeometry(1, q ? 12 : 6, q ? 8 : 4), new THREE.Matrix4().compose(k, new THREE.Quaternion(), v3(0.016, 0.012, 0.012)), red);
  for (const sx of [-1, 1]) {
    const tail = [k.clone(), k.clone().add(v3(sx * 0.016, -0.03, 0.012)), k.clone().add(v3(sx * 0.024, -0.062, 0.016))];
    sweep(m, tail, pathFrames(tail, v3(0, 0, 1)), (i) => [0.02, 0.024, 0.012][i], () => 0.004, () => red, shape('round', q ? 8 : 4));
  }
}

/** Rennbrille der 50er auf der Mütze: zwei runde Gläser in Messingfassung, Lederband um den Kopf */
function capGoggles(m: Mesher, strap: Mesher, q: 0 | 1) {
  const brass = rgb('#b48a3c');
  const glass = rgb('#3b4a3a');
  const leather = rgb('#5b3a22');
  for (const sx of [-1, 1]) {
    const c = headPoint(0.07, sx * 0.34, 0.0062 + 0.011, false);
    const nrm = c.clone().sub(v3(0, 0.07, 0.004)).setY(0.25).normalize();
    m.add(new THREE.CylinderGeometry(0.0205, 0.0205, 0.016, q ? 18 : 8), along(c, nrm), brass, 0.9);
    m.add(new THREE.CylinderGeometry(0.0165, 0.0165, 0.0168, q ? 18 : 8), along(c.clone().addScaledVector(nrm, 0.0004), nrm), glass, 0.95);
  }
  // Steg über der Nase
  const b0 = headPoint(0.072, -0.14, 0.017, false);
  const b1 = headPoint(0.072, 0.14, 0.017, false);
  pipe(m, [b0, headPoint(0.076, 0, 0.019, false), b1], 0.0025, 6, brass);
  // Lederband um den Kopf
  skinRibbon(strap, [[0.074, 0.55], [0.07, 1.2], [0.062, 1.9], [0.058, 2.6], [0.056, Math.PI], [0.058, Math.PI * 2 - 2.6], [0.062, Math.PI * 2 - 1.9], [0.07, Math.PI * 2 - 1.2], [0.074, Math.PI * 2 - 0.55]], 0.0062 + 0.0035, 0.014, leather, q ? 20 : 6);
}

// ------------------------------------------------------------------ Zusammenbau Kopf

const headCache = new Map<string, THREE.BufferGeometry>();

/** Kopf mit Kopfbedeckung (Helm, Zeitfahrhelm, Mütze) und Brille – je Aussehen nur einmal gebaut */
export function headBuild(kit: Kit, head: Head, q: 0 | 1): THREE.BufferGeometry {
  const key = `${kit.skin}|${kit.helmet}|${kit.side}|${kit.jersey}|${kit.number}|${head}|${q}`;
  const hit = headCache.get(key);
  if (hit) return hit;
  const skin = new Mesher(0.07);
  const hair = new Mesher(0.12);
  const cloth = head !== 'helmet' && head !== 'aero';
  const shellM = new Mesher(cloth ? 0.04 : 0.48);
  const dark = new Mesher(0.0);
  const straps = new Mesher(0.08);
  const lens = new Mesher(1.0);
  const frame = new Mesher(0.4);
  // Helme und Bandana mit Sonnenbrille, sonst sieht man die Augen
  const glasses = head === 'helmet' || head === 'aero' || head === 'bandana';
  buildHead(skin, hair, kit, q, !glasses, cloth ? 0.1 : 0.05);
  if (head === 'helmet') roadHelmet(shellM, dark, straps, kit, q);
  else if (head === 'aero') aeroHelmet(shellM, dark, straps, kit, q);
  else if (head === 'bowler') bowler(shellM, straps, hair, kit, q);
  else if (head === 'peaked') peaked(shellM, frame, straps, q);
  else if (head === 'band') headband(straps, kit, q);
  else if (head === 'bandana') bandana(shellM, dark, q);
  else {
    cap(shellM, dark, kit, q);
    if (head === 'capgoggles') capGoggles(frame, straps, q);
  }
  if (glasses) buildGlasses(lens, frame, kit, q, head === 'aero', head === 'bandana' ? '#141414' : undefined);
  const g = merge([skin, hair, shellM, dark, straps, lens, frame])!;
  headCache.set(key, g);
  return g;
}

// ------------------------------------------------------------------ Köpfe der Leute am Rand (Personal, Stadt)

export interface PersonHeadOpts {
  skin: string;
  hair: string;
  /** lange Haare (bis auf die Schultern) */
  long: boolean;
  /** Dutt hinten oben */
  bun: boolean;
  /** Kopfbedeckung: keine, Schirmmütze (Polizei, Jury), Baseballkappe */
  hat: 'none' | 'peaked' | 'baseball';
  hatCol: string;
  /** dunkle Sonnenbrille */
  glasses: boolean;
}

/** Baseballkappe: runde Krone aus sechs Bahnen mit Knopf, gebogener Schirm nach vorn */
function baseball(m: Mesher, visor: Mesher, col: string, q: 0 | 1) {
  const c = rgb(col);
  const seam = mul(c, 0.82);
  const seg = q ? 36 : 12;
  const AX = 0.084, AZ = 0.1, CZ = 0.006;
  const prof: [number, number, C3][] = [[1.04, 0.02, c], [1.05, 0.045, c], [1.0, 0.075, c], [0.88, 0.1, c], [0.68, 0.118, c], [0.4, 0.128, c], [0.001, 0.131, c]];
  upRevolve(m, q ? prof : [prof[0], prof[2], prof[4], prof[6]], seg, AX, AZ, CZ, false, 0.12);
  if (q) {
    // Nähte der Bahnen (dunkler) und Knopf oben
    for (let k = 0; k < 6; k++) {
      const ph = (k / 6) * Math.PI * 2 + Math.PI / 6;
      const pts: V[] = [];
      for (let t = 0; t <= 6; t++) {
        const u = t / 6;
        const r = 1.03 * (1 - u * u) + 0.02;
        pts.push(v3(Math.sin(ph) * AX * r, 0.03 + u * 0.1, CZ - Math.cos(ph) * AZ * r).applyAxisAngle(X, -0.12));
      }
      pipe(visor, pts, 0.0012, 4, seam);
    }
    visor.add(new THREE.SphereGeometry(0.008, 10, 6), new THREE.Matrix4().makeTranslation(0, 0.132, CZ - 0.016), c);
  }
  // Schirm: nach vorn, quer gebogen, leicht abwärts
  const K = q ? 14 : 5;
  const top: V[] = [];
  const bot: V[] = [];
  for (let k = 0; k <= K; k++) {
    const ph = -1.1 + (2.2 * k) / K;
    const inner = v3(Math.sin(ph) * AX * 1.03, 0.026, CZ - Math.cos(ph) * AZ * 1.03);
    const out = v3(Math.sin(ph) * 0.6, 0, -1).normalize();
    const len = 0.075 * Math.cos(ph * 0.75) ** 0.6;
    const tip = inner.clone().addScaledVector(out, len).add(v3(0, -len * 0.18 - 0.008 * Math.cos(ph) ** 2, 0));
    top.push(inner, tip);
    bot.push(inner.clone().add(v3(0, -0.004, 0)), tip.clone().add(v3(0, -0.004, 0)));
  }
  const under = mul(c, 0.55);
  const sT = visor.count;
  for (const p of top) visor.v(p.x, p.y, p.z, c);
  const sB = visor.count;
  for (const p of bot) visor.v(p.x, p.y, p.z, under);
  for (let k = 0; k < K; k++) {
    const a = k * 2;
    visor.quad(sT + a, sT + a + 1, sT + a + 3, sT + a + 2);
    visor.quad(sB + a, sB + a + 2, sB + a + 3, sB + a + 1);
    visor.quad(sT + a + 1, sB + a + 1, sB + a + 3, sT + a + 3);
  }
}

const personCache = new Map<string, THREE.BufferGeometry>();
/** Kopf eines Menschen am Rand: Gesicht, Augen, Brauen, Ohren, Hals, Haare (kurz, lang, Dutt), Mütze, Brille */
export function personHeadBuild(o: PersonHeadOpts, q: 0 | 1): THREE.BufferGeometry {
  const key = `${o.skin}|${o.hair}|${o.long}|${o.bun}|${o.hat}|${o.hatCol}|${o.glasses}|${q}`;
  const hit = personCache.get(key);
  if (hit) return hit;
  const skin = new Mesher(0.08);
  const hair = new Mesher(0.16);
  const hat = new Mesher(0.06);
  const visor = new Mesher(0.1);
  const trim = new Mesher(0.5);
  const lens = new Mesher(1.0);
  const frame = new Mesher(0.4);
  const kit = { skin: o.skin, number: '0', jersey: '#000000', side: '#000000', helmet: '#000000', shorts: '#000000', shoes: '#000000' } as Kit;
  const hc = rgb(o.hair);
  buildHead(skin, hair, kit, q, !o.glasses, o.hat === 'none' ? 0.104 : 0.06, { hair: hc, long: o.long, upright: true });
  if (o.long) {
    // offenes Haar hinten bis auf die Schultern: weich fallender Vorhang, unten etwas schmaler und dünner
    const n = q ? 16 : 6;
    const rows: [number, number, number, number][] = [[-0.02, 0.078, 0.06, 0.03], [-0.08, 0.074, 0.058, 0.04], [-0.14, 0.07, 0.052, 0.05], [-0.2, 0.066, 0.04, 0.058], [-0.25, 0.058, 0.026, 0.062]];
    const st = hair.count;
    for (const [y, a, b, cz] of rows) {
      for (let j = 0; j <= n; j++) {
        const ph = -Math.PI / 2 + (j / n) * Math.PI;
        hair.v(Math.sin(ph) * a, y, cz + Math.cos(ph) * b, mul(hc, 0.92 + 0.08 * Math.cos(j * 1.9)));
      }
    }
    const W = n + 1;
    for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < n; j++) { const a = st + i * W + j; hair.quad(a, a + 1, a + W + 1, a + W); }
  }
  if (o.bun) hair.add(new THREE.SphereGeometry(0.038, q ? 14 : 6, q ? 10 : 4), new THREE.Matrix4().makeTranslation(0, 0.07, 0.085), hc);
  if (o.hat === 'peaked') peaked(hat, visor, trim, q);
  else if (o.hat === 'baseball') baseball(hat, visor, o.hatCol, q);
  if (o.glasses) buildGlasses(lens, frame, kit, q, false, '#18191c');
  const g = merge([skin, hair, hat, visor, trim, lens, frame])!;
  personCache.set(key, g);
  return g;
}

// ------------------------------------------------------------------ Schuhe und Pedale

/** Pedal (Ursprung = Mitte des Pedals auf der Achse); Haken und Riemen beim klassischen Pedal */
function addPedal(metal: Mesher, satin: Mesher, matte: Mesher, kind: BikeSpec['pedals'], q: 0 | 1, shoe: boolean) {
  if (kind === 'block') {
    // Gummiklotzpedal: Käfig aus zwei Blechen, zwei geriffelte Gummiblöcke, Rückstrahler vorn und hinten
    const sil = rgb('#c3c8ce');
    const rub = rgb('#1d1d20');
    metal.add(new THREE.CylinderGeometry(0.0085, 0.0085, 0.104, 8), M4(0, -0.003, 0, 0, 0, Math.PI / 2), sil);
    for (const x of [-0.05, 0.05]) strut(metal, v3(x, -0.004, -0.042), v3(x, -0.004, 0.042), 0.004, 0.024, sil, X);
    for (const z of [-0.025, 0.025]) {
      satin.add(new THREE.BoxGeometry(0.092, 0.02, 0.026), M4(0, -0.003, z), rub);
      if (q) for (const k of [-1, 0, 1]) matte.add(new THREE.BoxGeometry(0.094, 0.0035, 0.0042), M4(0, 0.0075, z + k * 0.0075), rgb('#0b0b0c'));
    }
    if (q) for (const z of [-0.0445, 0.0445]) satin.add(new THREE.BoxGeometry(0.052, 0.012, 0.004), M4(0, -0.004, z), rgb('#ff8a12'));
    return;
  }
  if (kind === 'clipless') {
    satin.add(new THREE.BoxGeometry(0.068, 0.012, 0.07), M4(0, -0.003, -0.002), rgb('#1c1d21'));
    if (q) metal.add(new THREE.BoxGeometry(0.05, 0.003, 0.05), M4(0, 0.0045, -0.006), rgb('#b9bfc6'));
    metal.add(new THREE.CylinderGeometry(0.0085, 0.0085, 0.076, 8), M4(0, -0.003, 0, 0, 0, Math.PI / 2), rgb('#9aa1a8'));
    return;
  }
  // Rennpedal mit Käfig, Haken und Lederriemen
  const sil = rgb('#c3c8ce');
  for (const z of [-0.034, 0.034]) strut(metal, v3(-0.04, -0.002, z), v3(0.04, -0.002, z), 0.004, 0.012, sil, v3(0, 0, 1));
  for (const x of [-0.04, 0.04]) strut(metal, v3(x, -0.004, -0.036), v3(x, -0.004, 0.036), 0.004, 0.01, sil, X);
  metal.add(new THREE.CylinderGeometry(0.009, 0.009, 0.07, 8), M4(0, -0.002, 0, 0, 0, Math.PI / 2), sil);
  if (q || shoe) {
    const hk: V[] = [v3(0, 0.0, -0.036), v3(0, 0.0, -0.07), v3(0, 0.018, -0.1), v3(0, 0.045, -0.104), v3(0, 0.064, -0.088), v3(0, 0.07, -0.07)];
    const curve = new THREE.CatmullRomCurve3(hk, false, 'centripetal').getPoints(q ? 12 : 5);
    sweep(metal, curve, pathFrames(curve, X), () => 0.016, () => 0.0035, () => sil, shape('round', 6));
    // Riemen über den Rist
    const band: V[] = [];
    for (let k = 0; k <= 10; k++) {
      const a = (k / 10) * Math.PI;
      band.push(v3(-Math.cos(a) * 0.05, -0.004 + Math.sin(a) * 0.082, -0.045));
    }
    sweep(matte, band, pathFrames(band, Z), () => 0.016, () => 0.003, () => rgb('#5a3418'), shape('round', 6));
    if (q) metal.add(new THREE.BoxGeometry(0.004, 0.014, 0.012), M4(0.052, 0.03, -0.045), sil);
  }
}

const shoeCache = new Map<string, THREE.BufferGeometry>();

/** Radschuh mit Pedal; Ursprung = Pedalachse */
export function shoeBuild(kit: Kit, pedals: BikeSpec['pedals'], q: 0 | 1): THREE.BufferGeometry {
  const key = `${kit.shoes}|${kit.side}|${pedals}|${q}`;
  const hit = shoeCache.get(key);
  if (hit) return hit;
  const retro = pedals === 'toeclip' || pedals === 'block';
  const upper = new Mesher(retro ? 0.32 : 0.36);
  const metal = new Mesher(0.95);
  const satin = new Mesher(0.22);
  const matte = new Mesher(0.05);
  const col = retro ? rgb('#141416') : rgb(kit.shoes);
  const heel = retro ? rgb('#141416') : mix(col, rgb(kit.side), 0.65);
  const lift = 0.009;
  // Querschnitte von der Spitze zur Ferse: [z, halbe Breite, Oberkante, Unterkante]
  const rows: [number, number, number, number][] = retro
    ? [[-0.108, 0.01, 0.028, 0.012], [-0.1, 0.024, 0.036, 0.008], [-0.085, 0.034, 0.042, 0.006], [-0.06, 0.04, 0.048, 0.005], [-0.03, 0.043, 0.054, 0.005], [0, 0.043, 0.06, 0.005], [0.03, 0.04, 0.068, 0.005], [0.06, 0.036, 0.08, 0.006], [0.09, 0.034, 0.088, 0.007], [0.115, 0.034, 0.088, 0.009], [0.135, 0.031, 0.08, 0.012], [0.148, 0.022, 0.068, 0.016], [0.154, 0.01, 0.054, 0.02]]
    : [[-0.108, 0.01, 0.03, 0.012], [-0.1, 0.024, 0.04, 0.008], [-0.085, 0.034, 0.046, 0.006], [-0.06, 0.041, 0.052, 0.005], [-0.03, 0.045, 0.058, 0.005], [0, 0.045, 0.064, 0.005], [0.03, 0.042, 0.074, 0.005], [0.06, 0.037, 0.088, 0.006], [0.09, 0.034, 0.098, 0.007], [0.115, 0.034, 0.098, 0.009], [0.135, 0.031, 0.09, 0.012], [0.148, 0.022, 0.076, 0.016], [0.154, 0.01, 0.06, 0.02]];
  const pts = rows.map(([z, , t, b]) => v3(0, (t + b) / 2 + lift, z));
  // Querschnitt: oben rund, unten flach
  const n = q ? 14 : 8;
  const sec: [number, number][] = [];
  for (let j = 0; j < n; j++) {
    const a = (j / n) * Math.PI * 2;
    const s = Math.sin(a);
    sec.push([Math.cos(a) * (s < 0 ? 1.04 : 1), s < 0 ? -Math.pow(-s, 0.35) : s]);
  }
  const fr = pts.map(() => ({ s: v3(-1, 0, 0), c: v3(0, 1, 0) }));
  // s × c = (−x) × y = −z = −t? Die Linie läuft nach +z (Spitze → Ferse): passt
  sweep(upper, pts, fr, (i) => rows[i][1] * 2, (i) => rows[i][2] - rows[i][3], (i) => (rows[i][0] > 0.105 ? heel : col), sec);
  // Sohle
  const soleC = retro ? rgb('#2a1c12') : rgb('#1b1c1f');
  const sp = rows.map(([z, , , b]) => v3(0, b + lift - 0.004, z));
  const flat: [number, number][] = [];
  for (let j = 0; j < 8; j++) { const a = (j / 8) * Math.PI * 2; flat.push([Math.cos(a), Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 0.3)]); }
  sweep(satin, sp, sp.map(() => ({ s: v3(-1, 0, 0), c: v3(0, 1, 0) })), (i) => rows[i][1] * 2 + 0.004, () => 0.008, () => soleC, flat);
  // Drehverschlüsse (modern) oder Schnürung (klassisch)
  if (q && !retro) {
    for (const [z, y] of [[-0.005, 0.066], [0.045, 0.085]]) satin.add(new THREE.CylinderGeometry(0.009, 0.009, 0.007, 12), M4(0.014, y + lift, z, 0.35, 0, -0.35), rgb('#1b1c1f'));
  }
  if (q && retro) pipe(matte, [v3(0, 0.052 + lift, -0.06), v3(0, 0.058 + lift, -0.03), v3(0, 0.064 + lift, 0.0), v3(0, 0.072 + lift, 0.03)], 0.0035, 5, rgb('#d8d2c4'));
  addPedal(metal, satin, matte, pedals, q, true);
  const g = merge([upper, metal, satin, matte])!;
  shoeCache.set(key, g);
  return g;
}

const pedalCache = new Map<string, THREE.BufferGeometry>();
/** Pedal allein (Garage) */
export function pedalBuild(kind: BikeSpec['pedals']): THREE.BufferGeometry {
  const hit = pedalCache.get(kind);
  if (hit) return hit;
  const metal = new Mesher(0.95);
  const satin = new Mesher(0.22);
  const matte = new Mesher(0.05);
  addPedal(metal, satin, matte, kind, 1, false);
  const g = merge([metal, satin, matte])!;
  pedalCache.set(kind, g);
  return g;
}

