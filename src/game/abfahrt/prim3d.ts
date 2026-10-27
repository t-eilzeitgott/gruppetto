/**
 * Grundformen für Rad- und Fahrermodelle: Röhren mit beliebigem Querschnitt entlang von Punkten,
 * gerade (auch tropfenförmige) Rohre mit ausgestellten Enden, Drehkörper, gezahnte Ringe.
 * Alle Flächen zeigen nach außen (für einseitige Materialien).
 */
import * as THREE from 'three';
import type { Mesher, C3 } from './gloss';

type V = THREE.Vector3;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const X = v3(1, 0, 0);
export const Y = v3(0, 1, 0);
export const Z = v3(0, 0, 1);

// ------------------------------------------------------------------ Querschnitte

export type Kind = 'round' | 'aero';

/** Punkt des Querschnitts (Breite ±1 entlang s, Tiefe ±1 entlang c; +c = Abrisskante hinten) */
export function shapeAt(kind: Kind, a: number): [number, number] {
  let s = Math.cos(a);
  let c = Math.sin(a);
  if (kind === 'aero') {
    // Tropfen mit abgeschnittenem Heck (Kammtail)
    if (c > 0) { const k = c; c *= 1.9; s *= 1 - 0.38 * k * k; }
    c = Math.min(c, 1.55);
    c = (c + 1) / 1.275 - 1;
  }
  return [s, c];
}

const shapeCache = new Map<string, [number, number][]>();
export function shape(kind: Kind, n: number): [number, number][] {
  const key = `${kind}${n}`;
  let out = shapeCache.get(key);
  if (!out) {
    out = [];
    for (let j = 0; j < n; j++) out.push(shapeAt(kind, (j / n) * Math.PI * 2));
    shapeCache.set(key, out);
  }
  return out;
}

// ------------------------------------------------------------------ Grundformen (Außenseite immer nach außen)

/** Querrichtungen eines Rohrs: s seitlich, c Tiefe; es gilt s × c = −t */
export interface Frame3 { s: V; c: V }

/** gerades Rohr: Tiefe zeigt nach hinten (Fahrtwind); fast waagrechte Rohre: Tiefe nach unten */
export function straightFrame(t: V): Frame3 {
  let c = Z.clone().addScaledVector(t, -Z.dot(t));
  if (c.length() < 0.35) c = Y.clone().addScaledVector(t, -Y.dot(t)).negate();
  c.normalize();
  return { s: new THREE.Vector3().crossVectors(t, c).normalize(), c };
}

/** Rahmen entlang einer Kurve (Paralleltransport), erste Seitenrichtung ref */
export function pathFrames(pts: V[], ref = X): Frame3[] {
  const out: Frame3[] = [];
  let s = ref.clone();
  const t = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    t.subVectors(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    s.addScaledVector(t, -s.dot(t));
    if (s.length() < 1e-4) s = Math.abs(t.y) < 0.9 ? new THREE.Vector3().crossVectors(Y, t) : new THREE.Vector3().crossVectors(X, t);
    s.normalize();
    out.push({ s: s.clone(), c: new THREE.Vector3().crossVectors(s, t).normalize() });
  }
  return out;
}

/** Röhre durch pts mit Querschnitt sh, Breite/Tiefe/Farbe je Ring; Enden zu */
export function sweep(m: Mesher, pts: V[], frames: Frame3[], w: (i: number) => number, d: (i: number) => number,
  col: (i: number) => C3, sh: [number, number][], caps = true) {
  const n = sh.length;
  const first = m.count;
  const W = n + 1;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const f = frames[i];
    const wi = w(i) / 2;
    const di = d(i) / 2;
    const c = col(i);
    const start = m.count;
    for (let j = 0; j <= n; j++) {
      const [s, cc] = sh[j % n];
      m.v(p.x + f.s.x * s * wi + f.c.x * cc * di, p.y + f.s.y * s * wi + f.c.y * cc * di, p.z + f.s.z * s * wi + f.c.z * cc * di, c);
    }
    m.seams.push([start, start + n]);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = first + i * W + j;
      const b = a + W;
      m.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  if (!caps) return;
  for (const [i, end] of [[0, false], [pts.length - 1, true]] as [number, boolean][]) {
    const p = pts[i];
    const ctr = m.v(p.x, p.y, p.z, col(i));
    const r0 = first + i * W;
    for (let j = 0; j < n; j++) {
      if (end) m.idx.push(ctr, r0 + j + 1, r0 + j);
      else m.idx.push(ctr, r0 + j, r0 + j + 1);
    }
  }
}

export interface TubeOpt {
  /** Breite (seitlich) und Tiefe an Anfang und Ende */
  w0: number; w1?: number; d0?: number; d1?: number;
  kind?: Kind;
  n: number;
  /** ausgestellte Enden wie an Rahmenknoten: [Faktor Anfang, Länge, Faktor Ende, Länge] */
  flare?: [number, number, number, number];
  rings?: number;
  col: (p: V, t: number) => C3;
  caps?: boolean;
}

export const smooth2 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x);
/** Wert aus einer Stützstellenreihe bei t (0–1), linear */
export const lerpArr = (a: number[], t: number) => {
  const f = Math.max(0, Math.min(1, t)) * (a.length - 1);
  const i = Math.min(a.length - 2, Math.floor(f));
  return a[i] + (a[i + 1] - a[i]) * (f - i);
};

/** gerades Rohr von a nach b (verjüngt, rund oder Aero, auf Wunsch an den Enden ausgestellt) */
export function tube(m: Mesher, a: V, b: V, o: TubeOpt): Frame3 {
  const t = b.clone().sub(a).normalize();
  const f = straightFrame(t);
  let ts: number[];
  if (o.flare) {
    const [, ls, , le] = o.flare;
    ts = [0, ls * 0.3, ls * 0.65, ls, 0.5, 1 - le, 1 - le * 0.65, 1 - le * 0.3, 1].filter((x, i, arr) => i === 0 || x > arr[i - 1] + 1e-4);
  } else {
    const k = Math.max(2, o.rings ?? 2);
    ts = Array.from({ length: k }, (_, i) => i / (k - 1));
  }
  const w1 = o.w1 ?? o.w0;
  const d0 = o.d0 ?? o.w0;
  const d1 = o.d1 ?? d0 * (w1 / o.w0);
  const fl = (u: number) => {
    if (!o.flare) return 1;
    const [fs, ls, fe, le] = o.flare;
    return 1 + (fs - 1) * smooth2(1 - u / ls) + (fe - 1) * smooth2(1 - (1 - u) / le);
  };
  const pts = ts.map((u) => a.clone().lerp(b, u));
  sweep(m, pts, pts.map(() => f), (i) => (o.w0 + (w1 - o.w0) * ts[i]) * fl(ts[i]), (i) => (d0 + (d1 - d0) * ts[i]) * fl(ts[i]),
    (i) => o.col(pts[i], ts[i]), shape(o.kind ?? 'round', o.n), o.caps ?? true);
  return f;
}

/** runde Leitung entlang von Punkten */
export function pipe(m: Mesher, pts: V[], r: number, n: number, col: C3 | ((i: number) => C3), ref?: V, caps = true) {
  sweep(m, pts, pathFrames(pts, ref), () => r * 2, () => r * 2, (i) => (typeof col === 'function' ? col(i) : col), shape('round', n), caps);
}

/** Quader von a nach b, Querschnitt w (Richtung side) × d */
export function strut(m: Mesher, a: V, b: V, w: number, d: number, col: C3, side = X, w1 = w, d1 = d) {
  const t = b.clone().sub(a).normalize();
  const s = side.clone().addScaledVector(t, -side.dot(t));
  if (s.length() < 1e-4) s.copy(Math.abs(t.y) < 0.9 ? new THREE.Vector3().crossVectors(Y, t) : X);
  s.normalize();
  const c = new THREE.Vector3().crossVectors(s, t).normalize();
  sweep(m, [a, b], [{ s, c }, { s, c }], (i) => (i ? w1 : w), (i) => (i ? d1 : d), () => col, [[1, 1], [-1, 1], [-1, -1], [1, -1]]);
}

/** Profilpunkt je Segment verändern (Stollen, Schmutz): bekommt Segment j, Profilpunkt k und den Punkt */
export type Warp = (j: number, k: number, p: [number, number, C3]) => [number, number, C3];

/**
 * Drehkörper um die x-Achse. Profil [Radius, x, Farbe], so laufend, dass die +x-Seite nach innen
 * (kleinerer Radius) durchlaufen wird – dann zeigen alle Flächen nach außen. Optional verschoben/gedreht
 * und je Segment verformt (warp; das letzte Segment schließt an das erste an).
 */
export function revolve(m: Mesher, prof: [number, number, C3][], seg: number, center: V, closed = true, mtx?: THREE.Matrix4, warp?: Warp) {
  const first = m.count;
  const P = prof.length;
  const t = new THREE.Vector3();
  for (let j = 0; j <= seg; j++) {
    const a = (j / seg) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let k = 0; k < P; k++) {
      const [r, x, c] = warp ? warp(j % seg, k, prof[k]) : prof[k];
      t.set(center.x + x, center.y + r * sa, center.z + r * ca);
      if (mtx) t.applyMatrix4(mtx);
      m.v(t.x, t.y, t.z, c);
    }
  }
  for (let j = 0; j < seg; j++) {
    for (let k = 0; k < (closed ? P : P - 1); k++) {
      const k2 = (k + 1) % P;
      const a = first + j * P + k;
      const b = first + j * P + k2;
      const c2 = first + (j + 1) * P + k2;
      const d = first + (j + 1) * P + k;
      m.idx.push(a, b, c2, a, c2, d);
    }
  }
  for (let k = 0; k < P; k++) m.seams.push([first + k, first + seg * P + k]);
}

/** flacher Ring um die x-Achse (Kettenblatt, Ritzel, Bremsscheibe); teeth > 0 → Zähne */
export function toothed(m: Mesher, center: V, x: number, rOut: number, rIn: number, teeth: number, thick: number, col: C3, seg = 32) {
  const pts: [number, number][] = [];
  if (teeth > 0) {
    const h = Math.min(0.0045, rOut * 0.08);
    for (let t = 0; t < teeth; t++) {
      const a0 = (t / teeth) * Math.PI * 2;
      const da = (Math.PI * 2) / teeth;
      pts.push([a0, rOut - h], [a0 + da * 0.3, rOut], [a0 + da * 0.55, rOut], [a0 + da * 0.85, rOut - h]);
    }
  } else {
    for (let i = 0; i < seg; i++) pts.push([(i / seg) * Math.PI * 2, rOut]);
  }
  const N = pts.length;
  const base = m.count;
  for (const side of [-1, 1]) {
    for (const [a, r] of pts) {
      m.v(center.x + x + (side * thick) / 2, center.y + Math.sin(a) * r, center.z + Math.cos(a) * r, col);
      m.v(center.x + x + (side * thick) / 2, center.y + Math.sin(a) * rIn, center.z + Math.cos(a) * rIn, col);
    }
  }
  const at = (side: number, i: number, inner: number) => base + side * N * 2 + (i % N) * 2 + inner;
  for (let i = 0; i < N; i++) {
    m.quad(at(1, i, 0), at(1, i, 1), at(1, i + 1, 1), at(1, i + 1, 0));
    m.quad(at(0, i, 1), at(0, i, 0), at(0, i + 1, 0), at(0, i + 1, 1));
    m.quad(at(0, i, 0), at(1, i, 0), at(1, i + 1, 0), at(0, i + 1, 0));
    m.quad(at(1, i, 1), at(0, i, 1), at(0, i + 1, 1), at(1, i + 1, 1));
  }
}

// ------------------------------------------------------------------ Prismen (Taschen, Kisten, Wohnwagen)

export const norm2 = (v: [number, number]): [number, number] => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

/** Schnitt zweier Geraden (Punkt + Richtung) in der Ebene */
export function cross2(p: [number, number], d: [number, number], q: [number, number], e: [number, number]): [number, number] {
  const den = d[0] * e[1] - d[1] * e[0];
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

/** Umriss (z, y) gegen den Uhrzeigersinn von rechts (+x) gesehen (u = −z, v = y) */
export function ccwZY(outline: [number, number][]): [number, number][] {
  let area = 0;
  for (let i = 0; i < outline.length; i++) {
    const [z0, y0] = outline[i];
    const [z1, y1] = outline[(i + 1) % outline.length];
    area += -z0 * y1 - -z1 * y0;
  }
  return area < 0 ? [...outline].reverse() : outline;
}

/** Umriss (gegen den Uhrzeigersinn, siehe ccwZY) um d nach innen versetzt (Gehrung) */
export function insetZY(ol: [number, number][], d: number): [number, number][] {
  const N = ol.length;
  return ol.map((p, i) => {
    const a = ol[(i + N - 1) % N];
    const b = ol[(i + 1) % N];
    // in (u, v) = (−z, y): Normale nach innen bei Gegenuhrzeigersinn ist (−dv, du)
    const n1 = norm2([-(p[1] - a[1]), -p[0] + a[0]]);
    const n2 = norm2([-(b[1] - p[1]), -b[0] + p[0]]);
    const k = d / Math.max(0.2, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
    const du = (n1[0] + n2[0]) * k;
    const dv = (n1[1] + n2[1]) * k;
    return [p[0] - du, p[1] + dv] as [number, number];
  });
}

/**
 * konvexes Teil: Umriss in der Ebene (z, y), seitlich von xc − w bis xc + w, Kanten gepolstert
 * (Taschen, Kettenkasten, Wohnwagen). Farbe fest oder je Umrisspunkt; Seitenflächen flach.
 */
export function prism(m: Mesher, outline: [number, number][], w: number, bevel: number, col: C3 | ((i: number) => C3), flat: Mesher = m, xc = 0) {
  const ol = ccwZY(outline);
  const rev = ol !== outline;
  const N = ol.length;
  const cAt = (i: number): C3 => (typeof col === 'function' ? col(rev ? N - 1 - i : i) : col);
  const inset = insetZY(ol, bevel);
  let cz = 0;
  let cy = 0;
  for (const [z, y] of ol) { cz += z / N; cy += y / N; }
  const center = v3(xc, cy, cz);
  const ringsDef: [number, [number, number][]][] = [[-w, inset], [-w + bevel, ol], [w - bevel, ol], [w, inset]];
  const rings = ringsDef.map(([xx, o]) => o.map(([z, y], i) => m.v(xc + xx, y, z, cAt(i))));
  const tri = (mm: Mesher, a: number, b: number, c: number) => {
    const pa = v3(mm.pos[a * 3], mm.pos[a * 3 + 1], mm.pos[a * 3 + 2]);
    const pb = v3(mm.pos[b * 3], mm.pos[b * 3 + 1], mm.pos[b * 3 + 2]);
    const pc = v3(mm.pos[c * 3], mm.pos[c * 3 + 1], mm.pos[c * 3 + 2]);
    const nrm = pb.clone().sub(pa).cross(pc.clone().sub(pa));
    const mid = pa.add(pb).add(pc).multiplyScalar(1 / 3);
    if (nrm.dot(mid.sub(center)) < 0) mm.tri(a, c, b); else mm.tri(a, b, c);
  };
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < N; i++) {
      const a = rings[r][i];
      const b = rings[r][(i + 1) % N];
      const c = rings[r + 1][(i + 1) % N];
      const d = rings[r + 1][i];
      tri(m, a, b, c);
      tri(m, a, c, d);
    }
  }
  // flache Seiten mit eigenen Ecken, einfarbig (Nähte laufen nur über die Haut)
  const base = typeof col === 'function' ? col(0) : col;
  for (const xx of [-w, w]) {
    const ids = inset.map(([z, y]) => flat.v(xc + xx, y, z, base));
    const c0 = flat.v(xc + xx, cy, cz, base);
    for (let i = 0; i < N; i++) tri(flat, c0, ids[i], ids[(i + 1) % N]);
  }
}

export const M4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(
  v3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), v3(sx, sy, sz));
/** Three-Grundkörper (Achse y) so drehen, dass seine Achse entlang dir liegt */
export const along = (p: V, dir: V, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromUnitVectors(Y, dir.clone().normalize()), v3(sx, sy, sz));

