/**
 * Alpenhaus für den WebGPU-Test: ein Tiroler Bauernhaus, Stück für Stück gebaut – Bruchsteinsockel mit Terrasse,
 * gekalktes Erdgeschoss mit gemalten Fensterfaschen und Eckquadern, Obergeschoss aus Blockbohlen mit
 * vorstehenden Eckköpfen, Giebel aus senkrechten Brettern, flaches Satteldach mit Holzschindeln, weitem
 * Überstand, sichtbaren Pfetten, Sparren und Kopfbändern, verzierten Windbrettern und Firstzier. Rundum-Balkon
 * mit ausgesägten Brettbalustern und Geranien, Giebelbalkon, Sprossenfenster mit Vorhängen und Jalousieläden,
 * Haustür mit Füllungen und Vordach, Kamin, Rinnen und Fallrohre, Holzstoß, Bank und Tisch.
 *
 * Alles in fünf Materialien (Putz, Holz, Schindeln, Stein, Kleinteile), damit viele Häuser als Instanzen mit
 * wenigen Zeichenaufrufen auskommen. Zwei Stufen: nah (~40 000 Dreiecke), fern (~600).
 * Lokale Maße: Giebel vorn bei +z (zum Tal), Breite x = ±5 m, Tiefe z = ±6 m, Boden der Wohnung bei y = 0,7.
 */
import * as THREE from 'three/webgpu';
import type { Surface, SurfaceId } from './bake';
import { decodeAlbedo, tsl, type N } from './nodes';
import { instNodes } from './inst';

const { attribute, float, mix, normalize, positionGeometry, smoothstep, texture, transformNormalToView, uv, varying, vec3, vertexColor } = tsl;

type V3 = [number, number, number];
export type HMat = 'plaster' | 'wood' | 'roof' | 'stone' | 'detail';
export const HMATS: HMat[] = ['plaster', 'wood', 'roof', 'stone', 'detail'];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const rnd = (n: number) => {
  let x = Math.imul(n ^ 0x3c6ef372, 0x9e3779b1);
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca77);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
};

class Geo {
  p: number[] = [];
  n: number[] = [];
  uv: number[] = [];
  tu: number[] = [];
  tv: number[] = [];
  c: number[] = [];
  e: number[] = [];
}

/** Geometrie-Baukasten: Flächen mit Normale, Texturkoordinaten in Metern, Tangenten, Farbe, Material-Extras */
class Builder {
  private g: Record<HMat, Geo> = { plaster: new Geo(), wood: new Geo(), roof: new Geo(), stone: new Geo(), detail: new Geo() };
  mat: HMat = 'plaster';
  col: V3 = [1, 1, 1];
  rough = 0.8;
  metal = 0;
  /** 1: Farbe der Fensterläden (je Haus) */
  shut = 0;
  /** Holz: 0 Bretter, 1 Blockbohlen */
  kind = 0;
  /** Textur quer (senkrechte Bretter) */
  swap = false;

  set(o: Partial<Pick<Builder, 'mat' | 'col' | 'rough' | 'metal' | 'shut' | 'kind' | 'swap'>>): this {
    Object.assign(this, o);
    return this;
  }

  private vert(p: V3, n: V3, u: number, v: number, tu: V3, tv: V3, c: V3 = this.col) {
    const G = this.g[this.mat];
    G.p.push(p[0], p[1], p[2]);
    G.n.push(n[0], n[1], n[2]);
    G.uv.push(u, v);
    G.tu.push(tu[0], tu[1], tu[2]);
    G.tv.push(tv[0], tv[1], tv[2]);
    G.c.push(c[0], c[1], c[2]);
    G.e.push(this.rough, this.metal, this.shut, this.kind);
  }

  /** Texturkoordinaten aus der Lage (Meter), nach der Hauptrichtung der Normale; u nach rechts, v nach oben */
  private auto(p: V3, n: V3): { u: number; v: number; tu: V3; tv: V3 } {
    const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    let r: { u: number; v: number; tu: V3; tv: V3 };
    if (ax >= ay && ax >= az) r = n[0] > 0 ? { u: -p[2], v: p[1], tu: [0, 0, -1], tv: [0, 1, 0] } : { u: p[2], v: p[1], tu: [0, 0, 1], tv: [0, 1, 0] };
    else if (az >= ay) r = n[2] > 0 ? { u: p[0], v: p[1], tu: [1, 0, 0], tv: [0, 1, 0] } : { u: -p[0], v: p[1], tu: [-1, 0, 0], tv: [0, 1, 0] };
    else r = n[1] > 0 ? { u: p[0], v: -p[2], tu: [1, 0, 0], tv: [0, 0, -1] } : { u: p[0], v: p[2], tu: [1, 0, 0], tv: [0, 0, 1] };
    if (this.swap) r = { u: r.v, v: r.u, tu: r.tv, tv: r.tu };
    return r;
  }

  /** ebenes, konvexes Vieleck (gegen den Uhrzeigersinn von außen) */
  poly(pts: V3[], uvs?: [number, number][], tu?: V3, tv?: V3) {
    let n: V3 = [0, 1, 0];
    for (let k = 2; k < pts.length; k++) {
      const c = cross(sub(pts[1], pts[0]), sub(pts[k], pts[0]));
      if (Math.hypot(c[0], c[1], c[2]) > 1e-9) { n = norm(c); break; }
    }
    const at = (k: number) => {
      if (uvs) this.vert(pts[k], n, uvs[k][0], uvs[k][1], tu!, tv!);
      else { const a = this.auto(pts[k], n); this.vert(pts[k], n, a.u, a.v, a.tu, a.tv); }
    };
    for (let k = 1; k + 1 < pts.length; k++) { at(0); at(k); at(k + 1); }
  }

  /** Viereck, dessen Normale nach want zeigen soll (Reihenfolge wird nötigenfalls umgedreht) */
  quadF(a: V3, b: V3, c: V3, d: V3, want: V3) {
    const n = cross(sub(b, a), sub(c, a));
    if (dot(n, want) < 0) this.poly([a, d, c, b]); else this.poly([a, b, c, d]);
  }

  /** Körper aus acht Ecken (Reihenfolge wie bei box: x0y0z0, x1y0z0, x1y1z0, x0y1z0, dann dasselbe bei z1) */
  hexa(c: V3[]) {
    const m: V3 = [0, 0, 0];
    for (const p of c) { m[0] += p[0] / 8; m[1] += p[1] / 8; m[2] += p[2] / 8; }
    const face = (i: number[]) => {
      const q = i.map((k) => c[k]);
      const fc: V3 = [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2, (q[0][2] + q[2][2]) / 2];
      this.quadF(q[0], q[1], q[2], q[3], sub(fc, m));
    };
    face([0, 1, 2, 3]); face([4, 5, 6, 7]); face([0, 4, 7, 3]); face([1, 5, 6, 2]); face([0, 1, 5, 4]); face([3, 2, 6, 7]);
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    this.hexa([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]);
  }

  /** Rohr von a nach b (Fallrohr, Topf): Mantel mit seg Seiten, ohne Deckel */
  tube(a: V3, b: V3, r0: number, r1 = r0, seg = 8, cap = false) {
    const ax = norm(sub(b, a));
    const ref: V3 = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const e1 = norm(cross(ax, ref));
    const e2 = cross(ax, e1);
    const ring = (o: V3, r: number, k: number): V3 => {
      const t = (k / seg) * Math.PI * 2;
      return [o[0] + (e1[0] * Math.cos(t) + e2[0] * Math.sin(t)) * r, o[1] + (e1[1] * Math.cos(t) + e2[1] * Math.sin(t)) * r, o[2] + (e1[2] * Math.cos(t) + e2[2] * Math.sin(t)) * r];
    };
    for (let k = 0; k < seg; k++) {
      const p0 = ring(a, r0, k), p1 = ring(a, r0, k + 1), p2 = ring(b, r1, k + 1), p3 = ring(b, r1, k);
      const mid: V3 = [(p0[0] + p2[0]) / 2 - (a[0] + b[0]) / 2, (p0[1] + p2[1]) / 2 - (a[1] + b[1]) / 2, (p0[2] + p2[2]) / 2 - (a[2] + b[2]) / 2];
      this.quadF(p0, p1, p2, p3, mid);
    }
    if (cap) {
      const pts: V3[] = [];
      for (let k = 0; k < seg; k++) pts.push(ring(b, r1, k));
      const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
      this.poly(dot(n, ax) >= 0 ? pts : pts.reverse());
    }
  }

  /** runder Klumpen (Blüten, Blätter): Ikosaeder mit runden Normalen, etwas unregelmäßig */
  blob(c: V3, r: number, sy: number, col: V3, seed: number, fine = false) {
    const ico = fine ? BLOB1 : BLOB;
    const G = this.g[this.mat];
    for (let i = 0; i < ico.length; i += 3) {
      const d: V3 = [ico[i], ico[i + 1], ico[i + 2]];
      // unregelmäßig, aber gleiche Ecken gleich verschoben (keine Risse): Zufall aus der Richtung
      const j = 0.8 + rnd(seed * 31 + Math.round(d[0] * 50) * 7 + Math.round(d[1] * 50) * 131 + Math.round(d[2] * 50) * 1031) * 0.4;
      const p: V3 = [c[0] + d[0] * r * j, c[1] + d[1] * r * sy * j, c[2] + d[2] * r * j];
      G.p.push(...p);
      G.n.push(...norm([d[0], d[1] / sy, d[2]]));
      G.uv.push(0, 0);
      G.tu.push(1, 0, 0);
      G.tv.push(0, 1, 0);
      const k = 0.85 + rnd(seed * 7 + i) * 0.3;
      G.c.push(col[0] * k, col[1] * k, col[2] * k);
      G.e.push(this.rough, 0, 0, 0);
    }
  }

  build(): Record<HMat, THREE.BufferGeometry> {
    const out = {} as Record<HMat, THREE.BufferGeometry>;
    for (const m of HMATS) {
      const G = this.g[m];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(G.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(G.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2));
      g.setAttribute('aTU', new THREE.Float32BufferAttribute(G.tu, 3));
      g.setAttribute('aTV', new THREE.Float32BufferAttribute(G.tv, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(G.c, 3));
      g.setAttribute('aE', new THREE.Float32BufferAttribute(G.e, 4));
      g.computeBoundingSphere();
      out[m] = g;
    }
    return out;
  }
}

/** Dreiecke eines Ikosaeders (Einheitskugel), flach als Liste: grob (20) und fein (80 Dreiecke) */
const ico = (d: number): number[] => {
  const g = new THREE.IcosahedronGeometry(1, d);
  return Array.from((g.index ? g.toNonIndexed() : g).getAttribute('position').array as Float32Array);
};
const BLOB = ico(0);
const BLOB1 = ico(1);

// ——— Wandflächen ———

/** Hausseite: Ebene (Normale nach außen), Richtung „rechts“ von außen gesehen; Punkt aus (s, t, Tiefe nach innen) */
class Face {
  readonly R: V3;
  constructor(readonly N: V3, readonly plane: number) {
    this.R = cross([0, 1, 0], N);
  }
  p(s: number, t: number, d = 0): V3 {
    const N = this.N, R = this.R, o = this.plane - d;
    return [N[0] * o + R[0] * s, t, N[2] * o + R[2] * s];
  }
}

interface Hole { s0: number; s1: number; t0: number; t1: number }

/** Wand mit Öffnungen: Bänder zwischen den Kanten der Öffnungen; hw(t): halbe Breite (Giebel: schräg) */
function wall(b: Builder, F: Face, hw: (t: number) => number, t0: number, t1: number, holes: Hole[], knees: number[] = []) {
  const ts = [...new Set([t0, t1, ...knees, ...holes.flatMap((h) => [h.t0, h.t1])])].filter((t) => t >= t0 && t <= t1).sort((a, c) => a - c);
  for (let k = 0; k + 1 < ts.length; k++) {
    const ta = ts[k], tb = ts[k + 1];
    if (tb - ta < 1e-4) continue;
    const hs = holes.filter((h) => h.t0 < tb - 1e-4 && h.t1 > ta + 1e-4).sort((a, c) => a.s0 - c.s0);
    type Edge = number | 'L' | 'R';
    const cuts: [Edge, Edge][] = [];
    let prev: Edge = 'L';
    for (const h of hs) { cuts.push([prev, h.s0]); prev = h.s1; }
    cuts.push([prev, 'R']);
    const at = (e: Edge, t: number) => (e === 'L' ? -hw(t) : e === 'R' ? hw(t) : e);
    for (const [l, r] of cuts) {
      const a = at(l, ta), bb = at(r, ta), c = at(r, tb), d = at(l, tb);
      if (bb - a < 1e-4 && c - d < 1e-4) continue;
      b.quadF(F.p(a, ta), F.p(bb, ta), F.p(c, tb), F.p(d, tb), F.N);
    }
  }
}

/** Laibung einer Öffnung (Tiefe D) */
function reveal(b: Builder, F: Face, h: Hole, D: number) {
  const U: V3 = [0, 1, 0];
  const R = F.R;
  b.quadF(F.p(h.s0, h.t0), F.p(h.s1, h.t0), F.p(h.s1, h.t0, D), F.p(h.s0, h.t0, D), U);
  b.quadF(F.p(h.s0, h.t1), F.p(h.s1, h.t1), F.p(h.s1, h.t1, D), F.p(h.s0, h.t1, D), [0, -1, 0]);
  b.quadF(F.p(h.s0, h.t0), F.p(h.s0, h.t1), F.p(h.s0, h.t1, D), F.p(h.s0, h.t0, D), R);
  b.quadF(F.p(h.s1, h.t0), F.p(h.s1, h.t1), F.p(h.s1, h.t1, D), F.p(h.s1, h.t0, D), [-R[0], 0, -R[2]]);
}

/** Quader in Wandkoordinaten (d < 0: vor der Wand) */
function fbox(b: Builder, F: Face, s0: number, s1: number, t0: number, t1: number, d0: number, d1: number) {
  b.hexa([F.p(s0, t0, d0), F.p(s1, t0, d0), F.p(s1, t1, d0), F.p(s0, t1, d0), F.p(s0, t0, d1), F.p(s1, t0, d1), F.p(s1, t1, d1), F.p(s0, t1, d1)]);
}

// Farben (linear)
const WHITE_PAINT: V3 = [0.62, 0.61, 0.58];
const CURTAIN: V3 = [0.56, 0.55, 0.5];
const GLASS: V3 = [0.01, 0.012, 0.015];
const SILL: V3 = [0.36, 0.35, 0.32];
const FASCHE: V3 = [0.5, 0.42, 0.28];
const QUOIN: V3 = [0.42, 0.4, 0.36];
const DOOR: V3 = [0.12, 0.07, 0.035];
const IRON: V3 = [0.05, 0.05, 0.05];
const ZINC: V3 = [0.5, 0.51, 0.52];
const BOXWOOD: V3 = [0.75, 0.75, 0.75];
const LEAF: V3 = [0.035, 0.1, 0.025];
const REDS: V3[] = [[0.62, 0.02, 0.025], [0.7, 0.04, 0.05], [0.55, 0.015, 0.03], [0.75, 0.16, 0.28], [0.68, 0.06, 0.02]];

/** Blumenkasten mit Geranien: Kasten entlang a→b (Höhe y), außen nach out; hängende Ranken nach unten */
function flowerBox(b: Builder, a: V3, c: V3, out: V3, seed: number, hang = 0.45, fine = true) {
  const len = Math.hypot(c[0] - a[0], c[2] - a[2]);
  const dir: V3 = [(c[0] - a[0]) / len, 0, (c[2] - a[2]) / len];
  const p = (s: number, h: number, o: number): V3 => [a[0] + dir[0] * s + out[0] * o, a[1] + h, a[2] + dir[2] * s + out[2] * o];
  // Kasten (Holz)
  b.set({ mat: 'wood', kind: 0, swap: false, col: BOXWOOD });
  b.hexa([p(0, -0.22, 0), p(len, -0.22, 0), p(len, 0, 0), p(0, 0, 0), p(0, -0.22, 0.22), p(len, -0.22, 0.22), p(len, 0, 0.22), p(0, 0, 0.22)]);
  b.set({ mat: 'detail', rough: 0.7, metal: 0, shut: 0 });
  const n = Math.max(2, Math.round(len / (fine ? 0.19 : 0.26)));
  const leafCol = (k: number): V3 => { const v = 0.75 + rnd(seed * 3 + k) * 0.5; return [LEAF[0] * v, LEAF[1] * v * (0.9 + rnd(k) * 0.2), LEAF[2] * v]; };
  for (let k = 0; k < n; k++) {
    const s = (k + 0.5) * (len / n);
    const r1 = rnd(seed * 101 + k);
    const r2 = rnd(seed * 211 + k);
    const r3 = rnd(seed * 307 + k);
    // Blattwerk: flache, breite Büschel, versetzt
    b.blob(p(s + (r3 - 0.5) * 0.08, 0.05, 0.07 + r1 * 0.05), 0.12, 0.45, leafCol(k), seed * 13 + k);
    if (fine) b.blob(p(s + (r1 - 0.5) * 0.1, 0.08 + r2 * 0.03, 0.14 + r3 * 0.06), 0.09, 0.5, leafCol(k + 50), seed * 29 + k);
    // Blütendolde (fein), manchmal eine zweite kleinere daneben
    const red = REDS[Math.floor(r2 * REDS.length)];
    b.blob(p(s + (r1 - 0.5) * 0.06, 0.17 + r2 * 0.07, 0.07 + r2 * 0.1), (0.075 + r1 * 0.03) * (fine ? 1 : 1.2), 0.82, red, seed * 17 + k, fine);
    if (fine && r3 > 0.55) b.blob(p(s + 0.07, 0.12 + r1 * 0.05, 0.17), 0.05, 0.85, REDS[(Math.floor(r2 * REDS.length) + 1) % REDS.length], seed * 19 + k);
    // hängende Geranien vorn über den Kastenrand: Blätter, unten eine Blüte
    if (hang > 0 && r1 < (fine ? 0.55 : 0.35)) {
      const L = hang * (0.5 + r2 * 0.6);
      const m = fine ? 2 + (r3 > 0.5 ? 1 : 0) : 2;
      let x = s;
      for (let q = 0; q < m; q++) {
        const f = (q + 1) / m;
        x += (rnd(seed * 41 + k * 5 + q) - 0.5) * 0.07;
        const last = q === m - 1;
        b.blob(p(x, 0.0 - L * f, 0.24 + f * 0.04 + rnd(k + q) * 0.03), (last ? 0.06 : 0.075) * (1 - f * 0.25), last ? 0.9 : 0.75, last && r2 > 0.3 ? red : leafCol(k + q * 9), seed * 23 + k * 3 + q);
      }
    }
  }
}

interface WinOpt {
  /** feine Teile (Lamellen der Läden, feine Blüten) */
  fine?: boolean;
  /** Wandmaterial der Laibung */
  wallMat: HMat;
  wallKind?: number;
  D: number;
  shutters?: boolean;
  sill?: boolean;
  fasche?: boolean;
  flowers?: boolean;
  /** Balkontür: unten Holzfüllung, kein Sims */
  door?: boolean;
}

/** Fenster mit Laibung, Rahmen und Sprossen, Glas mit Vorhängen, Sims, Läden, gemalter Fasche, Blumenkasten */
function windowAt(b: Builder, F: Face, h: Hole, o: WinOpt, seed: number) {
  const w = h.s1 - h.s0;
  const hh = h.t1 - h.t0;
  b.set({ mat: o.wallMat, kind: o.wallKind ?? 0, swap: false, col: [1, 1, 1] });
  reveal(b, F, h, o.D);
  const dg = o.D - 0.07;
  // Scheiben (dunkel spiegelnd) und Vorhänge dahinter (als Teil der Scheibe gezeichnet)
  b.set({ mat: 'detail', shut: 0, metal: 0 });
  const tPanel = o.door ? h.t0 + hh * 0.42 : h.t0;
  if (o.door) {
    b.set({ col: DOOR, rough: 0.6 });
    b.quadF(F.p(h.s0, h.t0, dg), F.p(h.s1, h.t0, dg), F.p(h.s1, tPanel, dg), F.p(h.s0, tPanel, dg), F.N);
    b.set({ col: [0.16, 0.095, 0.05] });
    fbox(b, F, h.s0 + 0.1, h.s0 + w / 2 - 0.06, h.t0 + 0.1, tPanel - 0.08, dg - 0.03, dg);
    fbox(b, F, h.s0 + w / 2 + 0.06, h.s1 - 0.1, h.t0 + 0.1, tPanel - 0.08, dg - 0.03, dg);
  }
  const cw = w * 0.2;
  const tv = h.t1 - hh * 0.13;
  b.set({ col: CURTAIN, rough: 0.75 });
  b.quadF(F.p(h.s0, tPanel, dg), F.p(h.s0 + cw, tPanel, dg), F.p(h.s0 + cw, tv, dg), F.p(h.s0, tv, dg), F.N);
  b.quadF(F.p(h.s1 - cw, tPanel, dg), F.p(h.s1, tPanel, dg), F.p(h.s1, tv, dg), F.p(h.s1 - cw, tv, dg), F.N);
  b.quadF(F.p(h.s0, tv, dg), F.p(h.s1, tv, dg), F.p(h.s1, h.t1, dg), F.p(h.s0, h.t1, dg), F.N);
  b.set({ col: GLASS, rough: 0.04 });
  b.quadF(F.p(h.s0 + cw, tPanel, dg), F.p(h.s1 - cw, tPanel, dg), F.p(h.s1 - cw, tv, dg), F.p(h.s0 + cw, tv, dg), F.N);
  // Rahmen, Mittelpfosten, Kämpfer, Sprossen (weiß gestrichen); mittlere Stufe: nur die Vorderseiten
  const mid = o.fine === false;
  const bx = (s0: number, s1: number, t0: number, t1: number, d0: number, d1: number) => {
    if (mid) b.quadF(F.p(s0, t0, d0), F.p(s1, t0, d0), F.p(s1, t1, d0), F.p(s0, t1, d0), F.N);
    else fbox(b, F, s0, s1, t0, t1, d0, d1);
  };
  b.set({ col: WHITE_PAINT, rough: 0.45 });
  const fw = 0.07;
  bx(h.s0, h.s0 + fw, h.t0, h.t1, dg - 0.06, dg + 0.01);
  bx(h.s1 - fw, h.s1, h.t0, h.t1, dg - 0.06, dg + 0.01);
  bx(h.s0 + fw, h.s1 - fw, h.t1 - fw, h.t1, dg - 0.06, dg + 0.01);
  bx(h.s0 + fw, h.s1 - fw, h.t0, h.t0 + fw, dg - 0.06, dg + 0.01);
  const sm = (h.s0 + h.s1) / 2;
  bx(sm - 0.03, sm + 0.03, h.t0 + fw, h.t1 - fw, dg - 0.055, dg);
  const tk = o.door ? tPanel : h.t0 + hh * 0.66;
  bx(h.s0 + fw, h.s1 - fw, tk - 0.03, tk + 0.03, dg - 0.055, dg);
  if (!o.door && !mid) {
    const tb = h.t0 + hh * 0.33;
    fbox(b, F, h.s0 + fw, h.s1 - fw, tb - 0.014, tb + 0.014, dg - 0.04, dg);
  }
  // Sims
  if (o.sill !== false && !o.door) {
    b.set({ col: SILL, rough: 0.8 });
    fbox(b, F, h.s0 - 0.06, h.s1 + 0.06, h.t0 - 0.07, h.t0 + 0.005, -0.09, o.D * 0.6);
  }
  // gemalte Fasche mit „Ohren“ oben (nur auf Putz)
  if (o.fasche) {
    b.set({ col: FASCHE, rough: 0.85 });
    const fb = 0.12;
    const d0 = -0.012;
    bx(h.s0 - fb, h.s0, h.t0 - 0.07, h.t1 + fb, d0, 0);
    bx(h.s1, h.s1 + fb, h.t0 - 0.07, h.t1 + fb, d0, 0);
    bx(h.s0, h.s1, h.t1, h.t1 + fb, d0, 0);
    bx(h.s0 - fb - 0.1, h.s0 - fb, h.t1 + fb - 0.1, h.t1 + fb, d0, 0);
    bx(h.s1 + fb, h.s1 + fb + 0.1, h.t1 + fb - 0.1, h.t1 + fb, d0, 0);
    // Schürze unter dem Sims
    bx(h.s0 - 0.02, h.s1 + 0.02, h.t0 - 0.26, h.t0 - 0.07, d0, 0);
  }
  // Fensterläden (Jalousie), offen an der Wand
  if (o.shutters) {
    const lw = w / 2 + 0.03;
    for (const side of [-1, 1]) {
      const sa = side < 0 ? h.s0 - 0.04 - lw : h.s1 + 0.04;
      const sb = sa + lw;
      const ta = h.t0 - 0.03, tb = h.t1 + 0.03;
      b.set({ mat: 'detail', shut: 1, rough: 0.55, col: [1, 1, 1] });
      if (mid) {
        // mittlere Stufe: ein Brett je Laden
        fbox(b, F, sa, sb, ta, tb, -0.05, -0.016);
        b.set({ shut: 0 });
        continue;
      }
      // Rahmen
      fbox(b, F, sa, sa + 0.055, ta, tb, -0.055, -0.016);
      fbox(b, F, sb - 0.055, sb, ta, tb, -0.055, -0.016);
      fbox(b, F, sa + 0.055, sb - 0.055, ta, ta + 0.07, -0.055, -0.016);
      fbox(b, F, sa + 0.055, sb - 0.055, tb - 0.07, tb, -0.055, -0.016);
      const tm = (ta + tb) / 2;
      fbox(b, F, sa + 0.055, sb - 0.055, tm - 0.035, tm + 0.035, -0.055, -0.016);
      // Lamellen: schräg, unten außen
      for (const [pa, pb] of [[ta + 0.07, tm - 0.035], [tm + 0.035, tb - 0.07]]) {
        const n = Math.max(2, Math.floor((pb - pa) / 0.062));
        const step = (pb - pa) / n;
        for (let k = 0; k < n; k++) {
          const y0 = pa + k * step;
          b.quadF(F.p(sa + 0.055, y0, -0.05), F.p(sb - 0.055, y0, -0.05), F.p(sb - 0.055, y0 + step * 0.95, -0.022), F.p(sa + 0.055, y0 + step * 0.95, -0.022), [F.N[0], 0.6, F.N[2]]);
        }
      }
      // dunkler Grund zwischen den Lamellen
      b.set({ shut: 0, col: [0.02, 0.02, 0.02], rough: 0.9 });
      b.quadF(F.p(sa + 0.055, ta + 0.07, -0.018), F.p(sb - 0.055, ta + 0.07, -0.018), F.p(sb - 0.055, tb - 0.07, -0.018), F.p(sa + 0.055, tb - 0.07, -0.018), F.N);
      // Bänder (Scharniere) und Ladenhalter
      b.set({ col: IRON, rough: 0.5, metal: 0.6 });
      const hx = side < 0 ? sb - 0.2 : sa;
      fbox(b, F, hx, hx + 0.2, ta + 0.12, ta + 0.15, -0.06, -0.05);
      fbox(b, F, hx, hx + 0.2, tb - 0.15, tb - 0.12, -0.06, -0.05);
      b.set({ metal: 0 });
    }
  }
  if (o.flowers) flowerBox(b, F.p(h.s0 - 0.08, h.t0 - 0.09, -0.02), F.p(h.s1 + 0.08, h.t0 - 0.09, -0.02), F.N, seed, 0.3, o.fine !== false);
}

// ——— Maße ———
const UW = 5.02;
const UD = 6.02;
const TAN = Math.tan((26 * Math.PI) / 180);
const COS = Math.cos((26 * Math.PI) / 180);
const SIN = Math.sin((26 * Math.PI) / 180);
/** Unterkante Dach an der Wandlinie */
const S0 = 6.12;
const EAVE = UW + 1.15;
const RZ = 7.55;
const ROOF_T = 0.26;
/** Unterkante Dach bei |x| */
const ys = (x: number) => S0 + (UW - Math.abs(x)) * TAN;
const APEX = ys(0);

/** Öffnungen je Seite und Geschoss */
interface Open { s: number; w: number; t0: number; t1: number; door?: boolean }
const GF: Record<'pz' | 'nz' | 'px' | 'nx', Open[]> = {
  pz: [-3.3, 0, 3.3].map((s) => ({ s, w: 0.92, t0: 1.45, t1: 2.6 })),
  nz: [-2.6, 2.6].map((s) => ({ s, w: 0.9, t0: 1.45, t1: 2.55 })),
  px: [-4.2, 1.6, 4.2].map((s) => ({ s, w: 0.92, t0: 1.45, t1: 2.6 })),
  nx: [-4.1, -1.35, 1.35, 4.1].map((s) => ({ s, w: 0.92, t0: 1.45, t1: 2.6 })),
};
const UF: Record<'pz' | 'nz' | 'px' | 'nx', Open[]> = {
  pz: [{ s: -3.0, w: 0.95, t0: 4.1, t1: 5.3 }, { s: 0, w: 1.02, t0: 3.42, t1: 5.5, door: true }, { s: 3.0, w: 0.95, t0: 4.1, t1: 5.3 }],
  nz: [-2.6, 2.6].map((s) => ({ s, w: 0.9, t0: 4.15, t1: 5.25 })),
  px: [-4.2, -1.4, 1.4, 4.2].map((s) => ({ s, w: 0.95, t0: 4.1, t1: 5.3 })),
  nx: [-4.2, -1.4, 1.4, 4.2].map((s) => ({ s, w: 0.95, t0: 4.1, t1: 5.3 })),
};
const holeOf = (o: Open): Hole => ({ s0: o.s - o.w / 2, s1: o.s + o.w / 2, t0: o.t0, t1: o.t1 });

/** Haustür auf der rechten Seite (+x), Mitte bei z = 1,6 (s = −1,6) */
const DOOR_H: Hole = { s0: -2.13, s1: -1.07, t0: 0.72, t1: 2.88 };

const faces = { pz: new Face([0, 0, 1], 6), nz: new Face([0, 0, -1], 6), px: new Face([1, 0, 0], 5), nx: new Face([-1, 0, 0], 5) };
const ufaces = { pz: new Face([0, 0, 1], UD), nz: new Face([0, 0, -1], UD), px: new Face([1, 0, 0], UW), nx: new Face([-1, 0, 0], UW) };

/** Brettbaluster mit ausgesägtem Umriss: Mitte cx (entlang der Brüstung), Ebene bei pl (Dicke th) */
function baluster(b: Builder, along: 'x' | 'z', cx: number, pl: number, th: number, y0: number, y1: number, out: number, N = 10) {
  const hw = (t: number) => {
    const g = (c: number, w: number) => Math.exp(-(((t - c) / w) ** 2));
    return 0.074 - 0.028 * g(0.13, 0.05) - 0.046 * g(0.5, 0.09) - 0.028 * g(0.87, 0.05) + 0.008 * g(0.3, 0.06) + 0.008 * g(0.7, 0.06);
  };
  const P = (s: number, y: number, f: number): V3 => (along === 'x' ? [cx + s, y, pl + f * th / 2] : [pl + f * th / 2, y, cx + s]);
  const ow: V3 = along === 'x' ? [0, 0, out] : [out, 0, 0];
  const iw: V3 = [-ow[0], 0, -ow[2]];
  const sw: V3 = along === 'x' ? [1, 0, 0] : [0, 0, 1];
  for (let i = 0; i < N; i++) {
    const ta = i / N, tb = (i + 1) / N;
    const ya = y0 + (y1 - y0) * ta, yb = y0 + (y1 - y0) * tb;
    const a = hw(ta), c = hw(tb);
    b.quadF(P(-a, ya, out), P(a, ya, out), P(c, yb, out), P(-c, yb, out), ow);
    b.quadF(P(-a, ya, -out), P(a, ya, -out), P(c, yb, -out), P(-c, yb, -out), iw);
    b.quadF(P(a, ya, -1), P(a, ya, 1), P(c, yb, 1), P(c, yb, -1), sw);
    b.quadF(P(-a, ya, -1), P(-a, ya, 1), P(-c, yb, 1), P(-c, yb, -1), [-sw[0], 0, -sw[2]]);
  }
  const top = hw(1);
  b.quadF(P(-top, y1, -1), P(top, y1, -1), P(top, y1, 1), P(-top, y1, 1), [0, 1, 0]);
}

/** Balkon: Boden, Konsolen, Pfosten, Handlauf, ausgesägte Baluster, Blumenkästen; Front bei z = zf, seitlich bis x = ±hx */
function balcony(b: Builder, y: number, hx: number, z0: number, zf: number, H: number, seed: number, lod: number) {
  const fine = lod === 0;
  b.set({ mat: 'wood', kind: 0, swap: false, col: [0.95, 0.95, 0.95] });
  b.box(-hx, y - 0.13, z0, hx, y, zf);
  // Konsolen (vorstehende Balken mit schrägem Ende)
  b.set({ col: [0.8, 0.8, 0.8] });
  const nb = Math.max(2, Math.round((hx * 2) / 2.45) + 1);
  for (let k = 0; k < nb; k++) {
    const x = -hx + 0.25 + (k * (hx * 2 - 0.5)) / (nb - 1);
    b.hexa([[x - 0.09, y - 0.38, z0 - 0.1], [x + 0.09, y - 0.38, z0 - 0.1], [x + 0.09, y - 0.13, z0 - 0.1], [x - 0.09, y - 0.13, z0 - 0.1],
      [x - 0.09, y - 0.22, zf + 0.06], [x + 0.09, y - 0.22, zf + 0.06], [x + 0.09, y - 0.13, zf + 0.06], [x - 0.09, y - 0.13, zf + 0.06]]);
  }
  const zr = zf - 0.1;
  b.set({ col: [1, 1, 1] });
  // Pfosten
  const posts = [-hx + 0.06, hx - 0.06];
  if (hx > 3) posts.push(-hx / 3, hx / 3);
  for (const x of posts) b.box(x - 0.065, y, zr - 0.065, x + 0.065, y + H + 0.04, zr + 0.065);
  for (const x of [-hx + 0.06, hx - 0.06]) b.box(x - 0.06, y, z0 + 0.04, x + 0.06, y + H + 0.04, z0 + 0.16);
  // Handlauf und Fußleiste vorn und seitlich
  b.box(-hx, y + H - 0.08, zr - 0.09, hx, y + H + 0.04, zr + 0.09);
  b.box(-hx, y, zr - 0.045, hx, y + 0.09, zr + 0.045);
  for (const sd of [-1, 1]) {
    const xs = sd * (hx - 0.06);
    b.box(xs - 0.09, y + H - 0.08, z0, xs + 0.09, y + H + 0.04, zr);
    b.box(xs - 0.045, y, z0, xs + 0.045, y + 0.09, zr);
  }
  if (lod > 1) {
    b.box(-hx + 0.1, y + 0.09, zr - 0.02, hx - 0.1, y + H - 0.08, zr + 0.02);
  } else {
    // Baluster (Brettbaluster, senkrechte Maserung)
    b.set({ swap: true, col: [1.05, 1.05, 1.05] });
    const pitch = 0.19;
    const n = Math.floor((hx * 2 - 0.3) / pitch);
    const x0 = -((n - 1) * pitch) / 2;
    for (let k = 0; k < n; k++) {
      const x = x0 + k * pitch;
      if (posts.some((p) => Math.abs(p - x) < 0.12)) continue;
      baluster(b, 'x', x, zr, 0.035, y + 0.09, y + H - 0.08, 1, fine ? 10 : 5);
    }
    for (const sd of [-1, 1]) {
      const m = Math.floor((zr - z0 - 0.3) / pitch);
      for (let k = 0; k < m; k++) baluster(b, 'z', z0 + 0.25 + k * pitch, sd * (hx - 0.06), 0.035, y + 0.09, y + H - 0.08, sd, fine ? 10 : 5);
    }
    b.set({ swap: false });
  }
  // Blumenkästen außen am Handlauf
  if (lod > 1) {
    b.set({ mat: 'detail', col: REDS[0], rough: 0.7, shut: 0 });
    b.box(-hx + 0.1, y + H - 0.32, zf, hx - 0.1, y + H + 0.08, zf + 0.25);
    b.set({ col: LEAF });
    b.box(-hx + 0.1, y + H - 0.7, zf + 0.02, hx - 0.1, y + H - 0.32, zf + 0.2);
  } else {
    const segs: [number, number][] = [];
    const ps = [...posts].sort((a, c) => a - c);
    for (let k = 0; k + 1 < ps.length; k++) segs.push([ps[k] + 0.1, ps[k + 1] - 0.1]);
    segs.forEach(([a, c], k) => flowerBox(b, [a, y + H - 0.1, zr + 0.09], [c, y + H - 0.1, zr + 0.09], [0, 0, 1], seed + k * 7, 0.55, fine));
  }
}

/** Haus bauen (lod 0: nah, alle Teile; 1: mittel – gröbere Blüten, Läden ohne Lamellen; 2: Fernform) */
export function buildHouse(lod: 0 | 1 | 2): Record<HMat, THREE.BufferGeometry> {
  const b = new Builder();
  /** full: alle Bauteile (Stufe 0 und 1); fine: dazu feine Blüten und Lamellen (nur Stufe 0) */
  const full = lod < 2;
  const fine = lod === 0;
  // ——— Sockel aus Bruchstein mit Terrasse vorn, Holzlege links, Stufen rechts (reicht tief in den Hang) ———
  b.set({ mat: 'stone', col: [1, 1, 1] });
  b.box(-5.08, -5, -6.08, 5.08, 0.7, 6.08);
  b.box(-5.08, -5, 6.08, 5.08, 0.62, 8.7);
  b.box(-5.95, -5, -5.1, -5.08, 0.66, 2.7);
  b.box(5.08, -5, 0.95, 5.5, 0.45, 2.25);
  b.box(5.5, -5, 0.95, 5.92, 0.2, 2.25);

  // ——— Erdgeschoss: Putz ———
  if (full) {
    for (const k of ['pz', 'nz', 'px', 'nx'] as const) {
      const F = faces[k];
      const hw = k === 'pz' || k === 'nz' ? 5 : 6;
      const holes = GF[k].map(holeOf);
      if (k === 'px') holes.push(DOOR_H);
      b.set({ mat: 'plaster', col: [1, 1, 1], swap: false });
      wall(b, F, () => hw, 0.7, 3.2, holes);
      GF[k].forEach((o, i) => windowAt(b, F, holeOf(o), { fine, wallMat: 'plaster', D: 0.3, shutters: true, fasche: true, flowers: k === 'pz' || (k === 'px' && i !== 1) }, 100 + i * 13 + k.length));
      // Eckquader (gemalt, leicht erhaben)
      b.set({ mat: 'detail', col: QUOIN, rough: 0.85, shut: 0, metal: 0 });
      for (let j = 0; j < 7; j++) {
        const t0 = 0.76 + j * 0.35;
        const L = j % 2 ? 0.26 : 0.42;
        fbox(b, F, hw - L, hw + 0.012, t0, t0 + 0.31, -0.012, 0);
        fbox(b, F, -hw - 0.012, -hw + (j % 2 ? 0.42 : 0.26), t0, t0 + 0.31, -0.012, 0);
      }
    }
    // Haustür: Steingewände, Türblatt mit Füllungen, Griff, Vordach auf Konsolen
    const F = faces.px;
    b.set({ mat: 'plaster', col: [1, 1, 1] });
    reveal(b, F, DOOR_H, 0.3);
    b.set({ mat: 'detail', col: [0.4, 0.39, 0.36], rough: 0.85 });
    fbox(b, F, DOOR_H.s0 - 0.17, DOOR_H.s0, DOOR_H.t0, DOOR_H.t1 + 0.17, -0.04, 0);
    fbox(b, F, DOOR_H.s1, DOOR_H.s1 + 0.17, DOOR_H.t0, DOOR_H.t1 + 0.17, -0.04, 0);
    fbox(b, F, DOOR_H.s0, DOOR_H.s1, DOOR_H.t1, DOOR_H.t1 + 0.17, -0.04, 0);
    b.set({ col: DOOR, rough: 0.55 });
    fbox(b, F, DOOR_H.s0, DOOR_H.s1, DOOR_H.t0, DOOR_H.t1, 0.2, 0.27);
    b.set({ col: [0.17, 0.1, 0.055] });
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
      const s0 = DOOR_H.s0 + 0.12 + c * 0.44, t0 = DOOR_H.t0 + 0.15 + r * 0.66;
      fbox(b, F, s0, s0 + 0.36, t0, t0 + 0.52, 0.17, 0.2);
    }
    b.set({ col: [0.3, 0.27, 0.2], metal: 0.9, rough: 0.35 });
    fbox(b, F, DOOR_H.s1 - 0.16, DOOR_H.s1 - 0.12, 1.75, 1.95, 0.12, 0.2);
    b.set({ metal: 0 });
    // Vordach
    b.set({ mat: 'wood', kind: 0, col: [0.85, 0.85, 0.85] });
    for (const z of [0.85, 2.35]) b.hexa([[5.0, 2.55, z - 0.05], [5.0, 2.7, z - 0.05], [5.9, 3.06, z - 0.05], [5.9, 2.96, z - 0.05], [5.0, 2.55, z + 0.05], [5.0, 2.7, z + 0.05], [5.9, 3.06, z + 0.05], [5.9, 2.96, z + 0.05]]);
    b.hexa([[5.0, 3.32, 0.6], [6.05, 2.97, 0.6], [6.05, 3.06, 0.6], [5.0, 3.41, 0.6], [5.0, 3.32, 2.6], [6.05, 2.97, 2.6], [6.05, 3.06, 2.6], [5.0, 3.41, 2.6]]);
    b.set({ mat: 'roof', col: [1, 1, 1] });
    const L = Math.hypot(1.05, 0.35);
    b.poly([[5.0, 3.42, 2.6], [6.05, 3.07, 2.6], [6.05, 3.07, 0.6], [5.0, 3.42, 0.6]].map((p) => p as V3), [[2.6, 0], [2.6, L], [0.6, L], [0.6, 0]], [0, 0, -1], norm([1.05, -0.35, 0]));
  } else {
    b.set({ mat: 'plaster', col: [1, 1, 1] });
    b.box(-5, 0.7, -6, 5, 3.2, 6);
  }

  // ——— Gebälk zwischen den Geschossen ———
  b.set({ mat: 'wood', kind: 1, swap: false, col: [0.7, 0.7, 0.7] });
  b.box(-5.06, 3.2, -6.06, 5.06, 3.42, 6.06);

  // ——— Obergeschoss: Blockbohlen mit Eckköpfen ———
  if (full) {
    for (const k of ['pz', 'nz', 'px', 'nx'] as const) {
      const F = ufaces[k];
      const hw = k === 'pz' || k === 'nz' ? UW : UD;
      b.set({ mat: 'wood', kind: 1, col: [1, 1, 1], swap: false });
      wall(b, F, () => hw, 3.42, 5.9, UF[k].map(holeOf));
      UF[k].forEach((o, i) => windowAt(b, F, holeOf(o), { fine, wallMat: 'wood', wallKind: 1, D: 0.22, shutters: !o.door, door: o.door, flowers: k !== 'pz' && k !== 'nz' && i % 2 === 0 }, 300 + i * 17 + k.length));
    }
    b.set({ mat: 'wood', kind: 1, col: [0.92, 0.92, 0.92], swap: false });
    for (let c = 0; c < 12; c++) {
      const y0 = 3.42 + c * 0.207;
      const y1 = y0 + 0.2;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        if (c % 2 === 0) b.box(sx > 0 ? UW : -UW - 0.32, y0, sz > 0 ? UD - 0.2 : -UD, sx > 0 ? UW + 0.32 : -UW, y1, sz > 0 ? UD : -UD + 0.2);
        else b.box(sx > 0 ? UW - 0.2 : -UW, y0, sz > 0 ? UD : -UD - 0.32, sx > 0 ? UW : -UW + 0.2, y1, sz > 0 ? UD + 0.32 : -UD);
      }
    }
  } else {
    b.set({ mat: 'wood', kind: 1, col: [1, 1, 1] });
    b.box(-UW, 3.42, -UD, UW, 5.9, UD);
  }

  // ——— Giebel: senkrechte Bretter, Abschlussbrett ———
  const ghw = (t: number) => (t <= S0 ? UW : Math.max(0, (APEX - t) / TAN));
  const gfront: Hole[] = [{ s0: -0.45, s1: 0.45, t0: 6.15, t1: 7.95 }, { s0: -2.2, s1: -1.65, t0: 6.45, t1: 7.15 }, { s0: 1.65, s1: 2.2, t0: 6.45, t1: 7.15 }];
  const gback: Hole[] = [{ s0: -0.38, s1: 0.38, t0: 6.45, t1: 7.35 }];
  for (const [k, holes] of [['pz', gfront], ['nz', gback]] as const) {
    const F = ufaces[k];
    b.set({ mat: 'wood', kind: 0, swap: true, col: [1, 1, 1] });
    wall(b, F, ghw, 5.9, APEX, full ? holes : [], [S0]);
    b.set({ swap: false, col: [0.75, 0.75, 0.75] });
    fbox(b, F, -UW - 0.04, UW + 0.04, 5.86, 6.0, -0.06, 0.1);
    if (full) {
      holes.forEach((h, i) => windowAt(b, F, h, { fine, wallMat: 'wood', wallKind: 0, D: 0.15, shutters: i > 0 || k === 'nz', door: k === 'pz' && i === 0, sill: true }, 500 + i * 7 + k.length));
    } else {
      b.set({ mat: 'detail', col: GLASS, rough: 0.05, shut: 0 });
      for (const h of holes) b.quadF(F.p(h.s0, h.t0, -0.01), F.p(h.s1, h.t0, -0.01), F.p(h.s1, h.t1, -0.01), F.p(h.s0, h.t1, -0.01), F.N);
    }
  }

  // Fern: Fenster als Flächen mit Läden
  if (!full) {
    for (const [set, fs] of [[GF, faces], [UF, ufaces]] as const) {
      for (const k of ['pz', 'nz', 'px', 'nx'] as const) {
        const F = fs[k];
        for (const o of set[k]) {
          const h = holeOf(o);
          b.set({ mat: 'detail', col: GLASS, rough: 0.05, shut: 0 });
          b.quadF(F.p(h.s0, h.t0, -0.01), F.p(h.s1, h.t0, -0.01), F.p(h.s1, h.t1, -0.01), F.p(h.s0, h.t1, -0.01), F.N);
          if (o.door) continue;
          b.set({ shut: 1, col: [1, 1, 1], rough: 0.6 });
          const lw = o.w / 2 + 0.03;
          b.quadF(F.p(h.s0 - 0.04 - lw, h.t0, -0.02), F.p(h.s0 - 0.04, h.t0, -0.02), F.p(h.s0 - 0.04, h.t1, -0.02), F.p(h.s0 - 0.04 - lw, h.t1, -0.02), F.N);
          b.quadF(F.p(h.s1 + 0.04, h.t0, -0.02), F.p(h.s1 + 0.04 + lw, h.t0, -0.02), F.p(h.s1 + 0.04 + lw, h.t1, -0.02), F.p(h.s1 + 0.04, h.t1, -0.02), F.N);
        }
      }
    }
    b.set({ mat: 'detail', col: DOOR, rough: 0.6, shut: 0 });
    const F = faces.px;
    b.quadF(F.p(DOOR_H.s0, DOOR_H.t0, -0.01), F.p(DOOR_H.s1, DOOR_H.t0, -0.01), F.p(DOOR_H.s1, DOOR_H.t1, -0.01), F.p(DOOR_H.s0, DOOR_H.t1, -0.01), F.N);
  }

  // ——— Dach: Schindeln oben, Bretter unten, Stirnbretter; Pfetten, Kopfbänder, Sparren ———
  const yt = (x: number) => ys(x) + ROOF_T;
  for (const sx of [-1, 1]) {
    const X = (x: number) => sx * x;
    b.set({ mat: 'roof', col: [1, 1, 1], swap: false });
    const L = EAVE / COS;
    const dn = norm([sx * COS, -SIN, 0]);
    b.poly(sx > 0
      ? [[0, yt(0), RZ], [X(EAVE), yt(EAVE), RZ], [X(EAVE), yt(EAVE), -RZ], [0, yt(0), -RZ]]
      : [[0, yt(0), -RZ], [X(EAVE), yt(EAVE), -RZ], [X(EAVE), yt(EAVE), RZ], [0, yt(0), RZ]],
    sx > 0 ? [[RZ, 0], [RZ, L], [-RZ, L], [-RZ, 0]] : [[-RZ, 0], [-RZ, L], [RZ, L], [RZ, 0]], [0, 0, 1], dn);
    b.set({ mat: 'wood', kind: 0, col: [0.75, 0.75, 0.75] });
    b.quadF([0, ys(0), RZ], [X(EAVE), ys(EAVE), RZ], [X(EAVE), ys(EAVE), -RZ], [0, ys(0), -RZ], [sx * SIN, -COS, 0]);
    b.quadF([X(EAVE), ys(EAVE), RZ], [X(EAVE), yt(EAVE), RZ], [X(EAVE), yt(EAVE), -RZ], [X(EAVE), ys(EAVE), -RZ], [sx, 0, 0]);
    for (const sz of [-1, 1]) b.quadF([0, ys(0), sz * RZ], [X(EAVE), ys(EAVE), sz * RZ], [X(EAVE), yt(EAVE), sz * RZ], [0, yt(0), sz * RZ], [0, 0, sz]);
    // Firstabdeckung
    b.set({ col: [0.55, 0.55, 0.55] });
    b.hexa([[0, yt(0) - 0.02, -RZ - 0.02], [X(0.22), yt(0.22) + 0.01, -RZ - 0.02], [X(0.22), yt(0.22) + 0.05, -RZ - 0.02], [0, yt(0) + 0.05, -RZ - 0.02],
      [0, yt(0) - 0.02, RZ + 0.02], [X(0.22), yt(0.22) + 0.01, RZ + 0.02], [X(0.22), yt(0.22) + 0.05, RZ + 0.02], [0, yt(0) + 0.05, RZ + 0.02]]);
    if (full) {
      // Sparren unter dem Traufüberstand
      b.set({ kind: 1, col: [0.8, 0.8, 0.8] });
      for (let z = -RZ + 0.35; z <= RZ - 0.3; z += 0.85) {
        const x0 = UW - 0.05, x1 = EAVE - 0.03;
        b.hexa([[X(x0), ys(x0) - 0.15, z - 0.05], [X(x1), ys(x1) - 0.15, z - 0.05], [X(x1), ys(x1), z - 0.05], [X(x0), ys(x0), z - 0.05],
          [X(x0), ys(x0) - 0.15, z + 0.05], [X(x1), ys(x1) - 0.15, z + 0.05], [X(x1), ys(x1), z + 0.05], [X(x0), ys(x0), z + 0.05]]);
      }
      // Dachrinne und Fallrohre
      b.set({ mat: 'detail', col: ZINC, metal: 0.9, rough: 0.35, shut: 0 });
      b.box(sx > 0 ? EAVE - 0.03 : -EAVE - 0.13, ys(EAVE) - 0.15, -RZ, sx > 0 ? EAVE + 0.13 : -EAVE + 0.03, ys(EAVE) - 0.02, RZ);
      for (const sz of [-1, 1]) {
        const zp = sz * 5.65;
        const a: V3 = [X(EAVE + 0.05), ys(EAVE) - 0.12, zp];
        const m: V3 = [X(EAVE + 0.05), ys(EAVE) - 0.35, zp];
        const w: V3 = [X(UW + 0.09), 4.75, zp];
        const g: V3 = [X(UW + 0.09), 0.72, zp];
        b.tube(a, m, 0.05);
        b.tube(m, w, 0.05);
        b.tube(w, [X(UW + 0.09), 3.55, zp], 0.05);
        b.tube([X(5.09), 3.1, zp], g, 0.05);
        b.tube([X(UW + 0.09), 3.55, zp], [X(5.09), 3.1, zp], 0.05);
        // Rohrschellen
        b.set({ col: IRON, metal: 0.5 });
        for (const y of [1.2, 2.4, 4.2]) b.tube([X(5.0), y, zp], [X(5.16), y, zp], 0.015, 0.015, 4);
        b.set({ col: ZINC, metal: 0.9 });
      }
      b.set({ metal: 0 });
    }
  }
  // Stirnseiten: Pfetten mit Kopfbändern, verzierte Windbretter, Firstzier
  b.set({ mat: 'wood', kind: 1, col: [0.75, 0.75, 0.75], swap: false });
  const purl = full ? [0, -2.5, 2.5, -4.9, 4.9] : [0];
  for (const x of purl) {
    const top = ys(Math.abs(x) + 0.12) - 0.01;
    b.box(x - 0.12, top - 0.28, -RZ + 0.1, x + 0.12, top, RZ - 0.1);
    if (full && Math.abs(x) < 3) {
      for (const sz of [-1, 1]) {
        const zw = sz * UD;
        const zb = sz * (UD + 0.95);
        const yw = top - 1.15;
        const yb = top - 0.28;
        b.hexa([[x - 0.06, yw, zw], [x + 0.06, yw, zw], [x + 0.06, yw + 0.15, zw], [x - 0.06, yw + 0.15, zw],
          [x - 0.06, yb - 0.12, zb], [x + 0.06, yb - 0.12, zb], [x + 0.06, yb, zb], [x - 0.06, yb, zb]]);
      }
    }
  }
  if (full) {
    b.set({ kind: 0, swap: false, col: [0.9, 0.9, 0.9] });
    for (const sz of [-1, 1]) {
      const z0 = sz * (RZ + 0.005), z1 = sz * (RZ + 0.05);
      for (const sx of [-1, 1]) {
        const n = 26;
        for (let i = 0; i < n; i++) {
          const xa = (i / n) * (EAVE + 0.05), xb = ((i + 1) / n) * (EAVE + 0.05);
          const ta = yt(xa) + 0.02, tb = yt(xb) + 0.02;
          const sc = (x: number) => 0.34 - 0.09 * Math.abs(Math.sin((x / (EAVE + 0.05)) * Math.PI * 9));
          const ba = ta - sc(xa) - 0.2, bb = ta - (yt(xa) - yt(xb)) - sc(xb) - 0.2;
          const P = (x: number, y: number, z: number): V3 => [sx * x, y, z];
          b.hexa([P(xa, ba, z0), P(xb, bb, z0), P(xb, tb, z0), P(xa, ta, z0), P(xa, ba, z1), P(xb, bb, z1), P(xb, tb, z1), P(xa, ta, z1)]);
        }
      }
      // Firstzier: gekreuzte Bretter über dem Giebel
      const zc = sz * (RZ + 0.08);
      for (const sx of [-1, 1]) {
        const xa = sx * 1.25, xb = -sx * 0.55;
        const ya = yt(1.25) + 0.08, yb = ya + 1.8 * TAN;
        b.hexa([[xa, ya - 0.17, zc - 0.03], [xb, yb - 0.17, zc - 0.03], [xb, yb, zc - 0.03], [xa, ya, zc - 0.03],
          [xa, ya - 0.17, zc + 0.03], [xb, yb - 0.17, zc + 0.03], [xb, yb, zc + 0.03], [xa, ya, zc + 0.03]]);
      }
    }
  }

  // ——— Kamin ———
  b.set({ mat: 'plaster', col: [0.95, 0.95, 0.95], swap: false });
  b.box(1.25, 6.8, -3.0, 1.9, 9.75, -2.35);
  b.set({ mat: 'stone', col: [0.9, 0.9, 0.9] });
  b.box(1.15, 9.9, -3.1, 2.0, 9.98, -2.25);
  for (const [px, pz] of [[1.25, -3.0], [1.81, -3.0], [1.25, -2.44], [1.81, -2.44]]) b.box(px, 9.75, pz, px + 0.09, 9.9, pz + 0.09);
  b.set({ mat: 'detail', col: [0.01, 0.01, 0.01], rough: 0.95, shut: 0 });
  b.box(1.33, 9.74, -2.92, 1.82, 9.76, -2.43);

  // ——— Balkone ———
  balcony(b, 3.42, 5.42, UD, 7.35, 1.0, 700, lod);
  balcony(b, 6.15, 2.15, UD, 6.9, 0.85, 800, lod);

  if (full) {
    // ——— Holzstoß unter der Traufe (links): Scheite mit hellen Schnittflächen und dunkler Rinde ———
    b.set({ mat: 'wood', kind: 0, swap: false, col: [0.35, 0.35, 0.35] });
    b.box(-5.82, 0.66, -4.9, -5.06, 2.6, 2.5);
    b.set({ mat: 'detail', rough: 0.9, shut: 0 });
    let q = 0;
    for (let row = 0; row < 10; row++) {
      const y = 0.76 + row * 0.19;
      for (let z = -4.8 + (row % 2) * 0.1; z < 2.4; z += 0.2) {
        q++;
        const r = 0.085 + rnd(q) * 0.02;
        const x = -5.83 - rnd(q + 7) * 0.05;
        const cz = z + 0.1;
        const tone = 0.8 + rnd(q + 3) * 0.4;
        const hex = (rr: number, dx: number, col: V3) => {
          b.set({ col });
          const pts: V3[] = [];
          for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + rnd(q) * 0.5; pts.push([x - dx, y + Math.sin(a) * rr, cz + Math.cos(a) * rr]); }
          b.poly(pts);
        };
        hex(r, 0, [0.07, 0.05, 0.035]);
        hex(r * 0.8, 0.004, [0.42 * tone, 0.3 * tone, 0.17 * tone]);
      }
    }
    // ——— Bank und Tisch auf der Terrasse, Geranientöpfe ———
    b.set({ mat: 'wood', kind: 0, col: [0.85, 0.85, 0.85] });
    b.box(-4.3, 1.1, 6.12, -2.3, 1.16, 6.55);
    b.box(-4.3, 1.3, 6.1, -2.3, 1.42, 6.15);
    b.box(-4.3, 1.55, 6.1, -2.3, 1.66, 6.15);
    for (const x of [-4.2, -3.3, -2.4]) b.box(x - 0.04, 0.62, 6.15, x + 0.04, 1.1, 6.5);
    b.box(-3.9, 1.38, 6.95, -2.75, 1.43, 7.7);
    for (const x of [-3.75, -2.9]) b.box(x - 0.04, 0.62, 7.05, x + 0.04, 1.38, 7.6);
    b.box(-3.75, 0.85, 7.29, -2.9, 0.92, 7.36);
    b.set({ mat: 'detail', col: [0.42, 0.14, 0.06], rough: 0.8, shut: 0 });
    for (const x of [1.6, 2.7, 3.8]) {
      b.tube([x, 0.62, 8.35], [x, 0.94, 8.35], 0.15, 0.19, 8, true);
      b.set({ col: LEAF });
      b.blob([x, 1.05, 8.35], 0.2, 0.55, LEAF, Math.round(x * 10));
      for (let k = 0; k < 4; k++) b.blob([x + Math.cos(k * 1.7) * 0.11, 1.17 + rnd(k + x * 10) * 0.05, 8.35 + Math.sin(k * 1.7) * 0.11], 0.075, 0.85, REDS[k % REDS.length], Math.round(x * 31) + k);
      b.set({ col: [0.42, 0.14, 0.06] });
    }
  }
  return b.build();
}

/** Materialien der Häuser (Instanzen: iP Ort/Drehung, iS.w Putzfarbe 0 … 1, iC Farbe der Läden) */
export function houseMaterials(S: Record<SurfaceId, Surface>, fade: ((I: ReturnType<typeof instNodes>) => N) | null): Record<HMat, THREE.MeshStandardNodeMaterial> {
  const make = (name: string, shade: (I: ReturnType<typeof instNodes>) => { col: N; rough: N; ao?: N; xy?: N; metal?: N; k?: number }) => {
    const I = instNodes();
    const m = new THREE.MeshStandardNodeMaterial();
    m.positionNode = I.world;
    // weiche Überblendung zwischen den Stufen (Deckung über die Kantenglättung)
    if (fade) { m.opacityNode = fade(I); m.alphaToCoverage = true; }
    const o = shade(I);
    m.colorNode = o.col;
    m.roughnessNode = o.rough;
    m.metalnessNode = o.metal ?? float(0);
    if (o.ao) m.aoNode = o.ao;
    if (o.xy) {
      const T = varying(I.rot(attribute('aTU', 'vec3')), 'vHT');
      const B = varying(I.rot(attribute('aTV', 'vec3')), 'vHB');
      const k = o.k ?? 1;
      m.normalNode = transformNormalToView(normalize(normalize(I.nWorld).add(T.mul(o.xy.x.mul(k))).add(B.mul(o.xy.y.mul(k)))));
    } else m.normalNode = I.normal;
    m.name = name;
    return m;
  };
  const tex = (id: SurfaceId, size: number) => {
    const p = uv().div(size);
    const a = texture(S[id].albedo, p);
    const t = texture(S[id].nra, p);
    return { col: decodeAlbedo(a.rgb), rough: t.z, ao: t.w, xy: t.xy.mul(2).sub(1) };
  };
  return {
    plaster: make('house-plaster', (I) => {
      const t = tex('plaster', 2);
      // Putzfarbe je Haus (weiß bis warmes Cremeweiß), Spritzwasser und Schmutz unten
      const tint = mix(vec3(1, 1, 1), vec3(1.02, 0.95, 0.82), I.extra);
      const dirt = mix(float(0.66), float(1), smoothstep(0.7, 1.7, positionGeometry.y));
      return { col: t.col.mul(vertexColor()).mul(tint).mul(dirt), rough: t.rough, ao: t.ao, xy: t.xy };
    }),
    wood: make('house-wood', () => {
      const a = tex('logs', 2);
      const c = tex('boards', 2);
      const k = attribute('aE', 'vec4').w;
      return { col: mix(c.col, a.col, k).mul(vertexColor()), rough: mix(c.rough, a.rough, k), ao: mix(c.ao, a.ao, k), xy: mix(c.xy, a.xy, k) };
    }),
    roof: make('house-roof', () => {
      const t = tex('shingles', 2);
      return { col: t.col.mul(vertexColor()), rough: t.rough, ao: t.ao, xy: t.xy, k: 1.3 };
    }),
    stone: make('house-stone', () => {
      const t = tex('masonry', 2.5);
      return { col: t.col.mul(vertexColor()), rough: t.rough, ao: t.ao, xy: t.xy, k: 1.2 };
    }),
    detail: make('house-detail', (I) => {
      const e = attribute('aE', 'vec4');
      return { col: mix(vertexColor(), I.color, e.z), rough: e.x, metal: e.y };
    }),
  };
}
