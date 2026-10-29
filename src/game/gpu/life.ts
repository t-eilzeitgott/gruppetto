/**
 * Mehr Leben im WebGPU-Test: Blumenwiesen (Margeriten, Hahnenfuß, Enzian, Glockenblumen, Klee), Sträucher
 * (Latschen und blühende Alpenrosen), Farne im Wald, Kühe und Schafe auf den Almen, Alpendohlen und ein
 * Steinadler am Himmel. Alles als Instanzen (inst.ts: ein Shaderprogramm je Art), Bewegung im Vertex-Shader:
 * Blumen und Farne im Wind, Kühe und Schafe grasen (Kopf hebt und senkt sich, Schwanz schlägt), Vögel kreisen.
 *
 * Keine harten Stufenwechsel: Pflanzen und Tiere wachsen in der Ferne weich aus dem Boden bzw. schrumpfen weg;
 * Sträucher haben zwei Stufen mit Überblendung.
 */
import * as THREE from 'three/webgpu';
import type { Terrain, TreeSpot } from '../abfahrt/terrain3d';
import type { Track } from '../abfahrt/track';
import { commit, disposeGroup, instGroup, instNodes, STRIDE, type InstGroup } from './inst';
import { tsl, useDither, type N } from './nodes';
import type { ForestEdge } from './forest';

const { atan, attribute, cameraPosition, cos, float, min, mix, normalize, positionGeometry, select, sin, smoothstep, time, transformNormalToView, varying, vec2, vec3, vertexColor } = tsl;

type V3 = [number, number, number];
const hash = (a: number, b = 0) => {
  let x = Math.imul(a ^ 0x7feb352d, 0x846ca68b) ^ Math.imul(b ^ 0x2c1b3c6d, 0x297a2d39);
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca77);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
};
const nrm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ——— Geometrie-Baukasten: Lage, Normale, Farbe, Extra (Teil, Biegsamkeit) ———

class GB {
  p: number[] = [];
  n: number[] = [];
  c: number[] = [];
  e: number[] = [];
  tri(a: V3, b: V3, c: V3, col: V3 | V3[], ex: [number, number] | [number, number][], nor?: V3 | V3[]) {
    const pts = [a, b, c];
    const fn = nrm(((u: V3, v: V3): V3 => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]])([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
    pts.forEach((q, i) => {
      this.p.push(...q);
      const nn = nor ? (Array.isArray(nor[0]) ? (nor as V3[])[i] : (nor as V3)) : fn;
      this.n.push(...nn);
      const cc = Array.isArray(col[0]) ? (col as V3[])[i] : (col as V3);
      this.c.push(...cc);
      const ee = Array.isArray(ex[0]) ? (ex as [number, number][])[i] : (ex as [number, number]);
      this.e.push(...ee);
    });
  }
  quad(a: V3, b: V3, c: V3, d: V3, col: V3, ex: [number, number], nor?: V3) { this.tri(a, b, c, col, ex, nor); this.tri(a, c, d, col, ex, nor); }
  /** Quader (Teil part) */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: V3, part: number) {
    const P = (x: number, y: number, z: number): V3 => [x, y, z];
    const f = (a: V3, b: V3, c: V3, d: V3) => this.quad(a, b, c, d, col, [part, 0]);
    f(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1));
    f(P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0));
    f(P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1));
    f(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0));
    f(P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0));
    f(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1));
  }
  /** runder Klumpen aus einem Ikosaeder, runde Normalen; col je Dreieck */
  blob(c: V3, r: V3, detail: number, col: (n: V3, k: number) => V3, part: number, seed: number) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const pa = (g.index ? g.toNonIndexed() : g).getAttribute('position');
    for (let i = 0; i < pa.count; i += 3) {
      const tri: V3[] = [];
      const ns: V3[] = [];
      for (let k = 0; k < 3; k++) {
        const d: V3 = [pa.getX(i + k), pa.getY(i + k), pa.getZ(i + k)];
        const j = 0.85 + hash(seed, Math.round(d[0] * 40) * 7 + Math.round(d[1] * 40) * 131 + Math.round(d[2] * 40) * 1031) * 0.3;
        tri.push([c[0] + d[0] * r[0] * j, c[1] + d[1] * r[1] * j, c[2] + d[2] * r[2] * j]);
        ns.push(nrm([d[0] / r[0], d[1] / r[1], d[2] / r[2]]));
      }
      const mid = nrm([ns[0][0] + ns[1][0] + ns[2][0], ns[0][1] + ns[1][1] + ns[2][1], ns[0][2] + ns[1][2] + ns[2][2]]);
      this.tri(tri[0], tri[1], tri[2], col(mid, i / 3), [part, 0], ns);
    }
    g.dispose();
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aE', new THREE.Float32BufferAttribute(this.e, 2));
    g.computeBoundingSphere();
    return g;
  }
}

// ——— Formen ———

/** Blumenbüschel: sieben Stängel mit Blütenstern (Farbe der Instanz), drei Blätter; aE = (0 grün / 0,5 Mitte / 1 Blüte, Höhe) */
function flowerClump(): THREE.BufferGeometry {
  const b = new GB();
  const green: V3 = [0.05, 0.11, 0.025];
  for (let k = 0; k < 7; k++) {
    const a = hash(k, 1) * Math.PI * 2;
    const r = 0.05 + hash(k, 2) * 0.28;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    const h = 0.16 + hash(k, 3) * 0.26;
    const lean = (hash(k, 4) - 0.5) * 0.12;
    const tx = ox + lean, tz = oz + lean * 0.5;
    const top: V3 = [tx, h, tz];
    b.tri([ox - 0.008, 0, oz], [ox + 0.008, 0, oz], top, green, [[0, 0], [0, 0], [0, 1]], [0, 1, 0]);
    // Blütenstern, etwas zur Sonne gekippt
    const R = 0.035 + hash(k, 5) * 0.025;
    const up: V3 = nrm([hash(k, 6) - 0.5, 2.2, hash(k, 7) - 0.5]);
    const ex: V3 = nrm([up[1], -up[0], 0]);
    const ez: V3 = nrm([up[1] * ex[2] - up[2] * ex[1], up[2] * ex[0] - up[0] * ex[2], up[0] * ex[1] - up[1] * ex[0]]);
    const c: V3 = [tx + up[0] * 0.01, h + 0.01, tz + up[2] * 0.01];
    const rim = (i: number): V3 => { const t = (i / 5) * Math.PI * 2 + hash(k, 8) * 3; return [c[0] + (ex[0] * Math.cos(t) + ez[0] * Math.sin(t)) * R, c[1] + (ex[1] * Math.cos(t) + ez[1] * Math.sin(t)) * R, c[2] + (ex[2] * Math.cos(t) + ez[2] * Math.sin(t)) * R]; };
    for (let i = 0; i < 5; i++) b.tri(c, rim(i + 1), rim(i), [green, green, green], [[0.5, 1], [1, 1], [1, 1]], up);
  }
  for (let k = 0; k < 3; k++) {
    const a = hash(k, 11) * Math.PI * 2;
    const ox = Math.cos(a) * 0.12, oz = Math.sin(a) * 0.12;
    const L = 0.15 + hash(k, 12) * 0.1;
    b.tri([ox - 0.025, 0, oz], [ox + 0.025, 0, oz], [ox + Math.cos(a) * L, 0.1 + hash(k, 13) * 0.08, oz + Math.sin(a) * L], green, [[0, 0], [0, 0], [0, 0.7]], [0, 1, 0]);
  }
  return b.build();
}

/** Strauch: Latsche (dunkel) oder Alpenrose (mit rosa Blüten); detail 1 nah, 0 fern */
function shrub(detail: number, rose: boolean): THREE.BufferGeometry {
  const b = new GB();
  const n = rose ? 4 : 5;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + hash(k, rose ? 3 : 4);
    const rr = k === 0 ? 0 : 0.35 + hash(k, 5) * 0.25;
    const c: V3 = [Math.cos(a) * rr, (rose ? 0.38 : 0.45) + hash(k, 6) * 0.2, Math.sin(a) * rr];
    const R: V3 = rose ? [0.55, 0.42, 0.55] : [0.7, 0.5, 0.7];
    b.blob(c, R, detail, (nn, t) => {
      const shade = 0.55 + 0.45 * Math.max(0, nn[1]);
      if (rose && nn[1] > 0.1 && hash(t, k * 13 + 7) > 0.62) return [0.55 * shade, 0.08 * shade, 0.18 * shade];
      const v = 0.85 + hash(t, k) * 0.3;
      return rose ? [0.035 * shade * v, 0.07 * shade * v, 0.025 * shade * v] : [0.022 * shade * v, 0.05 * shade * v, 0.02 * shade * v];
    }, 0, k * 17 + (rose ? 1 : 2));
  }
  return b.build();
}

/** Farn: sieben gebogene Wedel mit gefiederten Rändern; aE.y = Biegsamkeit */
function fern(): THREE.BufferGeometry {
  const b = new GB();
  for (let f = 0; f < 7; f++) {
    const a = (f / 7) * Math.PI * 2 + hash(f, 1) * 0.6;
    const L = 0.65 + hash(f, 2) * 0.35;
    const dx = Math.cos(a), dz = Math.sin(a);
    const sx = -dz, sz = dx;
    const S = 6;
    const pt = (t: number): V3 => [dx * L * t, L * (0.9 * t - 0.85 * t * t) + 0.02, dz * L * t];
    for (let i = 0; i < S; i++) {
      const t0 = i / S, t1 = (i + 1) / S;
      const w = (t: number, j: number) => 0.13 * Math.sin(Math.PI * Math.min(1, t * 1.1)) * (j % 2 ? 0.75 : 1);
      const p0 = pt(t0), p1 = pt(t1);
      const g0: V3 = [0.05 + t0 * 0.03, 0.12 + t0 * 0.05, 0.03];
      const g1: V3 = [0.05 + t1 * 0.03, 0.12 + t1 * 0.05, 0.03];
      const L0: V3 = [p0[0] - sx * w(t0, i), p0[1], p0[2] - sz * w(t0, i)];
      const R0: V3 = [p0[0] + sx * w(t0, i), p0[1], p0[2] + sz * w(t0, i)];
      const L1: V3 = [p1[0] - sx * w(t1, i + 1), p1[1], p1[2] - sz * w(t1, i + 1)];
      const R1: V3 = [p1[0] + sx * w(t1, i + 1), p1[1], p1[2] + sz * w(t1, i + 1)];
      b.tri(L0, R0, R1, [g0, g0, g1], [[0, t0], [0, t0], [0, t1]], [0, 1, 0]);
      b.tri(L0, R1, L1, [g0, g1, g1], [[0, t0], [0, t1], [0, t1]], [0, 1, 0]);
    }
  }
  return b.build();
}

/** Kuh (Braunvieh): Körper, Beine, Kopf mit Hörnern und Ohren, Euter, Schwanz, Glocke; aE.x = Teil (0 Körper, 1 Kopf, 2 Schwanz), Fell = 1 in aE.y */
function cow(): THREE.BufferGeometry {
  const b = new GB();
  const coat: V3 = [1, 1, 1];
  const dark: V3 = [0.03, 0.025, 0.02];
  const light: V3 = [0.42, 0.38, 0.32];
  const horn: V3 = [0.5, 0.45, 0.35];
  const pink: V3 = [0.35, 0.18, 0.15];
  const mark = (g: GB, from: number, v: number) => { for (let i = from; i < g.e.length; i += 2) g.e[i + 1] = v; };
  let s = b.e.length;
  b.blob([0, 1.08, -0.05], [0.42, 0.36, 0.95], 1, (n) => [1, 1, 1].map((x) => x * (0.75 + 0.25 * Math.max(0, n[1]))) as V3, 0, 3);
  b.blob([0, 1.2, 0.62], [0.34, 0.32, 0.36], 0, () => coat, 0, 4);
  mark(b, s, 1);
  for (const [x, z] of [[-0.24, 0.55], [0.24, 0.55], [-0.24, -0.6], [0.24, -0.6]]) {
    s = b.e.length;
    b.box(x - 0.07, 0.12, z - 0.07, x + 0.07, 0.9, z + 0.07, coat, 0);
    mark(b, s, 1);
    b.box(x - 0.075, 0, z - 0.075, x + 0.075, 0.12, z + 0.075, dark, 0);
  }
  b.blob([0, 0.66, -0.42], [0.17, 0.12, 0.2], 0, () => pink, 0, 5);
  // Kopf (Teil 1): Gelenk am Hals bei (0, 1.25, 0.85)
  s = b.e.length;
  b.box(-0.15, 1.0, 0.85, 0.15, 1.34, 1.32, coat, 1);
  mark(b, s, 1);
  b.box(-0.13, 0.94, 1.3, 0.13, 1.16, 1.48, light, 1);
  b.box(-0.1, 1.0, 1.46, 0.1, 1.12, 1.5, dark, 1);
  for (const sg of [-1, 1]) {
    b.box(sg * 0.15, 1.24, 0.95, sg * 0.29, 1.3, 1.05, coat, 1);
    b.box(sg * 0.12, 1.33, 0.98, sg * 0.24, 1.38, 1.03, horn, 1);
    b.box(sg * 0.22, 1.36, 0.98, sg * 0.27, 1.45, 1.03, horn, 1);
  }
  // Glocke am Riemen
  b.box(-0.17, 0.92, 0.8, 0.17, 0.97, 0.86, dark, 0);
  b.blob([0, 0.8, 0.92], [0.08, 0.1, 0.07], 0, () => [0.45, 0.32, 0.1], 0, 6);
  // Schwanz (Teil 2): Gelenk bei (0, 1.32, -1.0)
  s = b.e.length;
  b.box(-0.025, 0.55, -1.03, 0.025, 1.32, -0.98, coat, 2);
  mark(b, s, 1);
  b.box(-0.05, 0.42, -1.06, 0.05, 0.58, -0.96, dark, 2);
  // Färbung des Fells kommt aus der Instanz (aE.y = 1); die Zahl im Kopf/Schwanz bleibt (aE.x)
  return b.build();
}

/** Schaf: wollig, schwarzer Kopf und Beine; Teile wie bei der Kuh */
function sheepGeo(): THREE.BufferGeometry {
  const b = new GB();
  const black: V3 = [0.03, 0.028, 0.026];
  const s0 = b.e.length;
  b.blob([0, 0.62, 0], [0.33, 0.3, 0.52], 1, (n) => [1, 1, 1].map((x) => x * (0.8 + 0.2 * Math.max(0, n[1]))) as V3, 0, 9);
  for (let i = s0; i < b.e.length; i += 2) b.e[i + 1] = 1;
  for (const [x, z] of [[-0.15, 0.32], [0.15, 0.32], [-0.15, -0.3], [0.15, -0.3]]) b.box(x - 0.04, 0, z - 0.04, x + 0.04, 0.4, z + 0.04, black, 0);
  b.box(-0.09, 0.55, 0.48, 0.09, 0.78, 0.78, black, 1);
  for (const sg of [-1, 1]) b.box(sg * 0.09, 0.72, 0.52, sg * 0.18, 0.76, 0.6, black, 1);
  return b.build();
}

/** Vogel (Alpendohle, Adler): Rumpf und zwei Flügel, Flügel aE.x = 1 (Schlag), Spitze aE.y */
function bird(): THREE.BufferGeometry {
  const b = new GB();
  const c: V3 = [1, 1, 1];
  const beak: V3 = [0.8, 0.6, 0.05];
  b.tri([0, 0, 0.32], [-0.05, 0, 0], [0.05, 0, 0], c, [0, 0], [0, 1, 0]);
  b.tri([-0.05, 0, 0], [0, 0, -0.3], [0.05, 0, 0], c, [0, 0], [0, 1, 0]);
  b.tri([0, 0.0, 0.32], [0, 0, 0.38], [0.012, 0, 0.32], beak, [0, 0], [0, 1, 0]);
  for (const sg of [-1, 1]) {
    b.tri([sg * 0.04, 0, 0.1], [sg * 0.04, 0, -0.08], [sg * 0.3, 0, 0.0], c, [[1, 0], [1, 0], [1, 0.5]], [0, 1, 0]);
    b.tri([sg * 0.3, 0, 0.0], [sg * 0.04, 0, -0.08], [sg * 0.55, 0, -0.1], c, [[1, 0.5], [1, 0], [1, 1]], [0, 1, 0]);
  }
  return b.build();
}

// ——— Verteilen mit Abstand ———

interface Lod { geo: THREE.BufferGeometry; mat: THREE.Material; to: number; shadow: boolean }

/**
 * eine Art: Instanzen in Zellen, je Stufe eine Gruppe; Stufe je Instanz in iS.w (für die Überblendung im Shader).
 * Streaming: Instanzen kommen bereichsweise dazu, Zellen hinter dem Fahrer fallen weg; die Gruppen wachsen mit.
 */
class Scatter {
  private src: number[] = [];
  private xz: number[] = [];
  private cells = new Map<string, number[]>();
  private groups: InstGroup[] = [];
  private cap = 0;
  private parent: THREE.Group | null = null;
  private at = new THREE.Vector3(1e9, 0, 0);
  /** aus dem Speicher gefallene Instanzen (werden beim nächsten Aufräumen entfernt) */
  private dead = 0;
  constructor(private lods: Lod[], private cell = 48, private band = 0, _cull = true) {}
  get count() { return this.xz.length / 2 - this.dead; }
  add(x: number, y: number, z: number, rot: number, s: V3, col: V3, w = 0) {
    const k = this.xz.length / 2;
    this.src.push(x, y, z, rot, s[0], s[1], s[2], 0, col[0], col[1], col[2], w);
    this.xz.push(x, z);
    const key = `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
    const l = this.cells.get(key);
    if (l) l.push(k); else this.cells.set(key, [k]);
    this.at.set(1e9, 0, 0);
  }
  /** Gruppen anlegen (einmal); Kapazität wächst bei Bedarf in update */
  finish(parent: THREE.Group, cap = 64) {
    this.parent = parent;
    this.grow(Math.max(cap, this.xz.length / 2));
  }
  private grow(cap: number) {
    for (const g of this.groups) disposeGroup(g);
    this.groups = [];
    this.cap = cap;
    const sphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    for (const l of this.lods) {
      const g = instGroup(l.geo, l.mat, cap, sphere);
      g.mesh.castShadow = l.shadow;
      g.mesh.receiveShadow = true;
      // die Gruppen enthalten nur Instanzen um die Kamera – Wegschneiden der ganzen Gruppe bringt nichts
      g.mesh.frustumCulled = false;
      this.parent?.add(g.mesh);
      this.groups.push(g);
    }
    this.at.set(1e9, 0, 0);
  }
  /** Zellen abbauen (Streaming), Speicher gelegentlich zusammenschieben */
  prune(keep: (cx: number, cz: number, cell: number) => boolean) {
    let gone = 0;
    for (const [key, l] of this.cells) {
      const [i, j] = key.split(',').map(Number);
      if (keep((i + 0.5) * this.cell, (j + 0.5) * this.cell, this.cell)) continue;
      gone += l.length;
      this.cells.delete(key);
    }
    if (!gone) return;
    this.dead += gone;
    this.at.set(1e9, 0, 0);
    if (this.dead < 2000 || this.dead < this.xz.length / 4) return;
    const src: number[] = [];
    const xz: number[] = [];
    for (const l of this.cells.values()) {
      for (let q = 0; q < l.length; q++) {
        const k = l[q];
        l[q] = xz.length / 2;
        for (let t = 0; t < STRIDE; t++) src.push(this.src[k * STRIDE + t]);
        xz.push(this.xz[k * 2], this.xz[k * 2 + 1]);
      }
    }
    this.src = src;
    this.xz = xz;
    this.dead = 0;
  }
  update(cam: THREE.Vector3, force = false) {
    if (!this.groups.length || (!force && this.at.distanceToSquared(cam) < 16)) return;
    this.at.copy(cam);
    const maxD = this.lods[this.lods.length - 1].to;
    const R = Math.ceil(maxD / this.cell) + 1;
    const ccx = Math.floor(cam.x / this.cell), ccz = Math.floor(cam.z / this.cell);
    const M = 5;
    for (let pass = 0; pass < 2; pass++) {
      const cnt = this.lods.map(() => 0);
      let over = false;
      for (let j = -R; j <= R; j++) {
        for (let i = -R; i <= R; i++) {
          const l = this.cells.get(`${ccx + i},${ccz + j}`);
          if (!l) continue;
          for (const k of l) {
            const d = Math.hypot(this.xz[k * 2] - cam.x, this.xz[k * 2 + 1] - cam.z);
            if (d > maxD + M) continue;
            let from = 0;
            for (let q = 0; q < this.lods.length; q++) {
              const to = this.lods[q].to;
              const lo = q === 0 ? -1 : from - this.band - M;
              const hi = q === this.lods.length - 1 ? to + M : to + this.band + M;
              if (d > lo && d < hi) {
                if (cnt[q] < this.cap) {
                  const g = this.groups[q];
                  const o = cnt[q] * STRIDE;
                  for (let t = 0; t < STRIDE; t++) g.data[o + t] = this.src[k * STRIDE + t];
                  g.data[o + 7] = q;
                } else over = true;
                cnt[q]++;
              }
              from = to;
            }
          }
        }
      }
      if (over && pass === 0) { this.grow(Math.ceil(Math.max(...cnt) * 1.4)); continue; }
      this.groups.forEach((g, q) => commit(g, Math.min(cnt[q], this.cap)));
      break;
    }
  }
  warm(on: boolean) {
    for (const g of this.groups) if (on) { g.geo.instanceCount = Math.max(1, g.geo.instanceCount); g.mesh.visible = true; }
    if (!on) this.at.set(1e9, 0, 0);
  }
  dispose() { for (const g of this.groups) disposeGroup(g); }
}

/** Herdentiere (Kuh, Schaf): grasen, Kopf hebt sich ab und zu, Schwanz schlägt (Teile in aE.x, Fellfarbe aus der Instanz) */
export function herdMaterial(name: string, headPivot: V3, tailPivot: V3, graze: number, fade: [number, number] = [260, 330]): THREE.MeshLambertNodeMaterial {
  const m = new THREE.MeshLambertNodeMaterial();
  const e = attribute('aE', 'vec2');
  const part = e.x;
  const ph = attribute('iC', 'vec4').w;
  // grasen: meist Kopf unten, ab und zu hoch (schaut sich um); Schwanz schlägt ab und zu
  const look = smoothstep(0.55, 0.85, sin(time.mul(0.23).add(ph.mul(40))).mul(0.5).add(0.5));
  const chew = sin(time.mul(3.1).add(ph.mul(17))).mul(0.04);
  const headA = mix(float(graze), float(-0.1), look).add(chew);
  const turn = sin(time.mul(0.31).add(ph.mul(23))).mul(0.35).mul(look);
  const tailA = sin(time.mul(2.2).add(ph.mul(9))).mul(smoothstep(0.4, 0.9, sin(time.mul(0.5).add(ph.mul(13))))).mul(0.5);
  const p = positionGeometry;
  const rotX = (q: N, a: N): N => vec3(q.x, q.y.mul(cos(a)).sub(q.z.mul(sin(a))), q.y.mul(sin(a)).add(q.z.mul(cos(a))));
  const rotY = (q: N, a: N): N => vec3(q.x.mul(cos(a)).add(q.z.mul(sin(a))), q.y, q.z.mul(cos(a)).sub(q.x.mul(sin(a))));
  const rotZ = (q: N, a: N): N => vec3(q.x.mul(cos(a)).sub(q.y.mul(sin(a))), q.x.mul(sin(a)).add(q.y.mul(cos(a))), q.z);
  const hp = vec3(...headPivot), tp = vec3(...tailPivot);
  const head = rotY(rotX(p.sub(hp), headA), turn).add(hp);
  const tail = rotZ(p.sub(tp), tailA).add(tp);
  const local = select(part.lessThan(0.5), p, select(part.lessThan(1.5), head, tail));
  const I = instNodes(fade, local);
  m.positionNode = I.world;
  m.normalNode = I.normal;
  m.colorNode = mix(vertexColor().xyz, vertexColor().xyz.mul(I.color), e.y);
  m.name = name;
  return m;
    }

/** Kuh (für Herden und für Kühe auf der Straße) */
export const cowGeometry = (): THREE.BufferGeometry => cow();

// ——— Materialien ———

/** Wind: oben/außen mehr als unten (w: Biegsamkeit 0 … 1) */
function wind(at: N, w: N, k: number): N {
  const ph = at.x.mul(0.37).add(at.z.mul(0.29));
  const gust = sin(time.mul(0.7).add(at.x.mul(0.05))).mul(0.5).add(0.5);
  return vec3(sin(time.mul(2.3).add(ph)), 0, cos(time.mul(1.9).add(ph.mul(1.3)))).mul(w.mul(w).mul(mix(0.3, 1, gust)).mul(k));
}

/**
 * Überblendung zwischen Stufen (Stufe in iS.w, Grenzen to[]) als Raster-Anteil [lo, hi) (nodes.ditherVis): die
 * Stufen teilen sich die Bildpunkte, nie dieselben – kein Flackern. out: zusätzlich ausblenden (0 … 1)
 */
function lodBand(d: N, to: number[], band: number, out: N): [N, N] {
  const q = attribute('iS', 'vec4').w;
  const one = float(1);
  const a = (k: number): N => smoothstep(to[k] - band, to[k] + band, d);
  const lo = (k: number): N => (k === 0 ? float(0) : one.sub(a(k - 1)));
  const hi = (k: number): N => (k === to.length - 1 ? one.sub(out) : one.sub(a(k)).min(one.sub(out)));
  let L: N = lo(to.length - 1), H: N = hi(to.length - 1);
  for (let k = to.length - 2; k >= 0; k--) { L = select(q.lessThan(k + 0.5), lo(k), L); H = select(q.lessThan(k + 0.5), hi(k), H); }
  return [L, H];
}

export interface LifeCtx {
  track: Track;
  terrain: Terrain;
  forest: ForestEdge;
  trees: { countNear(x: number, z: number, r: number): number; allSpots(): Iterable<TreeSpot> };
  /** alle Häuser (Abstand halten) */
  houses: { x: number; z: number }[];
  /** Höfe (Kühe davor) – ohne die Häuser der Orte */
  farms?: { x: number; z: number }[];
  z0: number;
  z1: number;
  msaa: boolean;
}

export class Life {
  readonly group = new THREE.Group();
  private kinds: Record<string, Scatter> = {};
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];

  constructor(_msaa = true) {
    const [shrubs, roses] = this.shrubKinds();
    const [cows, sheep] = this.herdKinds();
    this.kinds = { flowers: this.flowerKind(), shrubs, roses, ferns: this.fernKind(), cows, sheep, birds: this.birdKind() };
    for (const k of Object.values(this.kinds)) k.finish(this.group);
  }

  /** Anzahl je Art (Prüfhilfe) */
  get counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.kinds)) out[k] = v.count;
    return out;
  }

  /** alles für den Bereich c.z0 … c.z1 am Stück (feste Teststrecke) */
  build(c: LifeCtx) {
    const it = this.addRange(c);
    while (!it.next().done) { /* weiter */ }
  }

  /**
   * Streaming: Pflanzen und Tiere für den Bereich c.z0 … c.z1 (halboffen) verteilen; gibt die Kontrolle ab,
   * sobald late() meldet, dass die Zeit dieses Bilds um ist. c.trees.allSpots: die Bäume der Gegend.
   */
  /** Prüfhilfe: woran addRange gerade arbeitet */
  phase = '';

  *addRange(c: LifeCtx, late: () => boolean = () => false): Generator<void, void, void> {
    this.phase = 'raster';
    // Bäume in einem feinen Raster (viele Abfragen „steht hier ein Baum?“)
    // Zahlenschlüssel (Zeichenketten je Baum erzeugten viel Müll – Speicherbereinigung mitten in der Fahrt)
    const gk = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);
    const grid = new Map<number, number[]>();
    let n = 0;
    for (const t of c.trees.allSpots()) {
      const k = gk(Math.floor(t.x / 8), Math.floor(t.z / 8));
      const l = grid.get(k);
      if (l) l.push(t.x, t.z); else grid.set(k, [t.x, t.z]);
      if (++n % 4000 === 0 && late()) yield;
    }
    const near = (x: number, z: number, r: number) => {
      let cnt = 0;
      const R = Math.ceil(r / 8);
      const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
      for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
        const l = grid.get(gk(cx + i, cz + j));
        if (!l) continue;
        for (let q = 0; q < l.length; q += 2) if ((l[q] - x) ** 2 + (l[q + 1] - z) ** 2 <= r * r) cnt++;
      }
      return cnt;
    };
    c = { ...c, trees: { countNear: near, allSpots: () => c.trees.allSpots() } };
    this.phase = 'blumen';
    yield* this.placeFlowers(c, late);
    this.phase = 'straeucher';
    yield* this.placeShrubs(c, late);
    this.phase = 'farne';
    yield* this.placeFerns(c, late);
    this.phase = 'herden';
    yield* this.placeHerds(c, late);
    this.phase = 'voegel';
    this.placeBirds(c);
  }

  /** Streaming: Zellen hinter dem Fahrer abbauen */
  prune(keep: (cx: number, cz: number, cell: number) => boolean) { for (const k of Object.values(this.kinds)) k.prune(keep); }

  private mat<T extends THREE.Material>(m: T): T { this.mats.push(m); return m; }
  private geo(g: THREE.BufferGeometry) { this.geos.push(g); return g; }

  /** Boden: Höhe (Bereich je Zelle) und Neigung */
  private ground(c: LifeCtx) {
    // Rechenbereiche je 32-m-Feld behalten: die Verteilung springt zwischen beiden Straßenseiten hin und her –
    // mit nur einem gemerkten Feld wurde der Bereich (teuer: alle Straßenproben) fast bei jeder Abfrage neu gebaut
    const regs = new Map<number, ReturnType<Terrain['region']>>();
    return (x: number, z: number) => {
      const i = Math.floor(x / 32), j = Math.floor(z / 32);
      const k = (i + 32768) * 65536 + (j + 32768);
      let reg = regs.get(k);
      if (!reg) {
        if (regs.size > 48) regs.clear();
        reg = c.terrain.region(i * 32 - 2, j * 32 - 2, i * 32 + 34, j * 32 + 34);
        regs.set(k, reg);
      }
      return c.terrain.heightIn(reg, x, z);
    };
  }

  /** Abstand zur Strecke (alle Kehren) */
  private roadNear(c: LifeCtx) {
    return (x: number, z: number) => { const n = c.forest.near(x, z); return n ? n.d : 1e9; };
  }

  // ——— Arten (Materialien, einmal) ———

  private flowerKind(): Scatter {
    const geo = this.geo(flowerClump());
    const m = this.mat(new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide }));
    const I = instNodes([42, 62]);
    const e = attribute('aE', 'vec2');
    m.positionNode = I.world.add(wind(I.at, e.y, 0.06));
    m.normalNode = I.normal;
    const petal = e.x;
    // Blütenmitte: bei hellen Blüten gelb (Margerite), sonst dunkler in der Farbe der Blüte
    const white = smoothstep(0.55, 0.7, min(I.color.x, I.color.z));
    const center = mix(I.color.mul(0.5), vec3(0.75, 0.52, 0.04), white);
    const bloom = mix(center, I.color, smoothstep(0.62, 0.8, petal));
    m.colorNode = mix(vertexColor().xyz, bloom, smoothstep(0.25, 0.5, petal));
    m.name = 'flowers';
    return new Scatter([{ geo, mat: m, to: 62, shadow: false }], 32);
  }

  private shrubKinds(): [Scatter, Scatter] {
    const mk = (rose: boolean): Scatter => {
      const geos = [this.geo(shrub(1, rose)), this.geo(shrub(0, rose))];
      const to = [70, 260];
      const band = 10;
      const lods: Lod[] = geos.map((geo, q) => {
        const m = this.mat(new THREE.MeshLambertNodeMaterial());
        const I = instNodes();
        m.positionNode = I.world.add(wind(I.at, positionGeometry.y.mul(0.8), 0.04));
        m.normalNode = I.normal;
        m.colorNode = vertexColor().xyz.mul(I.color);
        const d = varying(I.at.xz.sub(cameraPosition.xz).length(), 'vShrubD');
        const [lo, hi] = lodBand(d, to, band, smoothstep(230, 260, d));
        useDither(m, lo, hi);
        m.name = rose ? 'roses' : 'shrubs';
        return { geo, mat: m, to: to[q], shadow: q === 0 };
      });
      return new Scatter(lods, 64, band);
    };
    return [mk(false), mk(true)];
  }

  private fernKind(): Scatter {
    const geo = this.geo(fern());
    const m = this.mat(new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide }));
    const I = instNodes([34, 48]);
    const e = attribute('aE', 'vec2');
    m.positionNode = I.world.add(wind(I.at, e.y, 0.08));
    m.normalNode = I.normal;
    m.colorNode = vertexColor().xyz.mul(I.color);
    m.name = 'ferns';
    return new Scatter([{ geo, mat: m, to: 48, shadow: false }], 32);
  }

  private herdKinds(): [Scatter, Scatter] {
    const herdMat = (name: string, headPivot: V3, tailPivot: V3, graze: number) => this.mat(herdMaterial(name, headPivot, tailPivot, graze));
    return [new Scatter([{ geo: this.geo(cow()), mat: herdMat('cows', [0, 1.3, 0.72], [0, 1.32, -1.0], 1.0), to: 330, shadow: true }], 96),
      new Scatter([{ geo: this.geo(sheepGeo()), mat: herdMat('sheep', [0, 0.7, 0.48], [0, 0.7, -0.5], 0.9), to: 330, shadow: true }], 96)];
  }

  private birdKind(): Scatter {
    const geo = this.geo(bird());
    const m = this.mat(new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide }));
    const iP = attribute('iP', 'vec4');
    const iS = attribute('iS', 'vec4');
    const iC = attribute('iC', 'vec4');
    const e = attribute('aE', 'vec2');
    // iP: Kreismitte, Phase; iS: Radius, Winkelgeschwindigkeit, Größe; iC: Farbe, Schlagstil
    const ang = iP.w.add(time.mul(iS.y));
    const dirS = select(iS.y.lessThan(0), float(-1), float(1));
    const bob = sin(time.mul(0.6).add(iP.w.mul(3))).mul(iS.x.mul(0.08));
    const pos = iP.xyz.add(vec3(cos(ang).mul(iS.x), bob, sin(ang).mul(iS.x)));
    const fwd = vec2(sin(ang).negate(), cos(ang)).mul(dirS);
    const yaw = atan(fwd.x, fwd.y);
    // Flügelschlag mit Gleitphasen (Adler: fast nur gleiten)
    const glide = smoothstep(-0.3, 0.5, sin(time.mul(0.45).add(iP.w.mul(5))));
    const flap = sin(time.mul(mix(9, 3, iC.w)).add(iP.w.mul(7))).mul(mix(0.55, 0.12, iC.w)).mul(float(1).sub(glide.mul(0.85)));
    const p = positionGeometry.mul(iS.z);
    const lift = vec3(0, e.y.mul(flap).mul(iS.z).mul(0.6).add(e.y.mul(iS.z).mul(0.05)), 0);
    const bank = dirS.mul(-0.3);
    const q0 = p.add(lift.mul(e.x));
    const qb = vec3(q0.x.mul(cos(bank)).sub(q0.y.mul(sin(bank))), q0.x.mul(sin(bank)).add(q0.y.mul(cos(bank))), q0.z);
    const qr = vec3(qb.x.mul(cos(yaw)).add(qb.z.mul(sin(yaw))), qb.y, qb.z.mul(cos(yaw)).sub(qb.x.mul(sin(yaw))));
    m.positionNode = pos.add(qr);
    m.normalNode = transformNormalToView(normalize(vec3(0, 1, 0)));
    m.colorNode = iC.xyz;
    m.name = 'birds';
    return new Scatter([{ geo, mat: m, to: 5000, shadow: false }], 4000, 0, false);
  }

  // ——— Verteilen (je Bereich) ———

  // Blumenwiesen nahe der Straße
  private *placeFlowers(c: LifeCtx, late: () => boolean): Generator<void, void, void> {
    const S = this.kinds.flowers;
    const h = this.ground(c);
    const road = this.roadNear(c);
    // Arten: Margerite, Hahnenfuß, Enzian, Glockenblume, Klee, Lichtnelke
    const SPECIES: V3[] = [[0.78, 0.78, 0.72], [0.8, 0.55, 0.02], [0.03, 0.08, 0.55], [0.25, 0.12, 0.55], [0.62, 0.22, 0.38], [0.75, 0.12, 0.2]];
    const w = { x: 0, y: 0, z: 0, th: 0 };
    let n = 0;
    for (let z = Math.ceil(c.z0 / 6) * 6; z < c.z1; z += 6) {
      for (const sg of [-1, 1]) {
        if (late()) yield;
        for (let lat = 5.5; lat < 60; lat += 2.4 + lat * 0.03) {
          const seed = Math.round(z * 7) * 131 + Math.round(lat * 10) + (sg > 0 ? 7 : 0);
          // Flecken: großflächig dichter und dünner, je Fleck zwei Arten
          const patch = hash(Math.floor(z / 40) * 13 + (sg > 0 ? 5 : 0), Math.floor(lat / 18));
          if (hash(seed, 1) > 0.35 + patch * 0.6) continue;
          c.track.world(z + (hash(seed, 2) - 0.5) * 5, sg * (lat + (hash(seed, 3) - 0.5) * 3), 0, w);
          const x = w.x, zz = w.z;
          if (road(x, zz) < 5.2) continue;
          if (c.forest.strength(x, zz) > 0.25) continue;
          if (c.houses.some((p) => (p.x - x) ** 2 + (p.z - zz) ** 2 < 120)) continue;
          if (c.trees.countNear(x, zz, 2.2) > 0) continue;
          const y = h(x, zz);
          const g = Math.hypot(h(x + 1, zz) - y, h(x, zz + 1) - y);
          if (g > 0.75) continue;
          const sp = SPECIES[Math.floor((hash(seed, 4) < 0.6 ? patch : hash(seed, 5)) * SPECIES.length) % SPECIES.length];
          const s = 0.8 + hash(seed, 6) * 0.6;
          const v = 0.85 + hash(seed, 7) * 0.3;
          S.add(x, y - 0.03, zz, hash(seed, 8) * 6.28, [s, s * (0.8 + hash(seed, 9) * 0.4), s], [sp[0] * v, sp[1] * v, sp[2] * v]);
          n++;
        }
      }
    }
  }

  // Sträucher: Latschen und Alpenrosen auf Wiesen, am Waldrand dichter
  private *placeShrubs(c: LifeCtx, late: () => boolean): Generator<void, void, void> {
    const A = this.kinds.shrubs, B = this.kinds.roses;
    const h = this.ground(c);
    const road = this.roadNear(c);
    const w = { x: 0, y: 0, z: 0, th: 0 };
    for (let z = Math.ceil(c.z0 / 9) * 9; z < c.z1; z += 9) {
      if (late()) yield;
      for (const sg of [-1, 1]) {
        for (let lat = 8; lat < 200; lat += 7 + lat * 0.08) {
          const seed = Math.round(z) * 977 + Math.round(lat) * 7 + (sg > 0 ? 3 : 0);
          c.track.world(z + (hash(seed, 1) - 0.5) * 8, sg * (lat + (hash(seed, 2) - 0.5) * 6), 0, w);
          const x = w.x, zz = w.z;
          const edge = c.trees.countNear(x, zz, 14);
          const near = c.trees.countNear(x, zz, 3);
          // am Waldrand dicht, auf freier Wiese vereinzelt, im Wald nicht
          const p = near > 0 ? 0 : edge > 8 ? 0.05 : edge > 0 ? 0.45 : 0.06;
          if (hash(seed, 3) > p) continue;
          if (road(x, zz) < 7) continue;
          if (c.houses.some((q) => (q.x - x) ** 2 + (q.z - zz) ** 2 < 180)) continue;
          const y = h(x, zz);
          if (Math.hypot(h(x + 1.5, zz) - y, h(x, zz + 1.5) - y) / 1.5 > 0.8) continue;
          const rose = hash(seed, 4) < 0.45;
          const s = (rose ? 0.8 : 1.0) + hash(seed, 5) * 0.8;
          const v = 0.85 + hash(seed, 6) * 0.3;
          (rose ? B : A).add(x, y - 0.12, zz, hash(seed, 7) * 6.28, [s, s * (0.8 + hash(seed, 8) * 0.4), s], [v, v * (0.95 + hash(seed, 9) * 0.1), v]);
        }
      }
    }
  }

  // Farne im Wald nahe der Straße
  private *placeFerns(c: LifeCtx, late: () => boolean): Generator<void, void, void> {
    const S = this.kinds.ferns;
    const h = this.ground(c);
    const road = this.roadNear(c);
    const w = { x: 0, y: 0, z: 0, th: 0 };
    for (let z = Math.ceil(c.z0 / 2.6) * 2.6; z < c.z1; z += 2.6) {
      if (late()) yield;
      for (const sg of [-1, 1]) {
        for (let lat = 7; lat < 40; lat += 2.4) {
          const seed = Math.round(z * 10) * 389 + Math.round(lat * 10) + (sg > 0 ? 11 : 0);
          c.track.world(z + (hash(seed, 1) - 0.5) * 2.2, sg * (lat + (hash(seed, 2) - 0.5) * 2), 0, w);
          const x = w.x, zz = w.z;
          const forest = c.forest.strength(x, zz) > 0.5 || c.trees.countNear(x, zz, 7) >= 2;
          if (!forest || hash(seed, 3) > 0.55) continue;
          if (road(x, zz) < 6.5) continue;
          if (c.trees.countNear(x, zz, 0.9) > 0) continue;
          const y = h(x, zz);
          const s = 0.7 + hash(seed, 4) * 0.7;
          const v = 0.8 + hash(seed, 5) * 0.4;
          S.add(x, y - 0.02, zz, hash(seed, 6) * 6.28, [s, s, s], [v, v * (0.95 + hash(seed, 7) * 0.15), v * 0.9]);
        }
      }
    }
  }

  // Kühe bei den Höfen und auf den Almwiesen, Schafherden weiter oben
  private herded = new Set<number>();
  private *placeHerds(c: LifeCtx, late: () => boolean): Generator<void, void, void> {
    const cows = this.kinds.cows, sheep = this.kinds.sheep;
    const h = this.ground(c);
    const road = this.roadNear(c);
    const COATS: V3[] = [[0.2, 0.14, 0.1], [0.26, 0.19, 0.13], [0.14, 0.095, 0.065], [0.32, 0.25, 0.17], [0.09, 0.065, 0.05]];
    const okAt = (x: number, z: number, minRoad: number) => {
      if (road(x, z) < minRoad) return null;
      if (c.forest.strength(x, z) > 0.15) return null;
      if (c.trees.countNear(x, z, 4) > 0) return null;
      if (c.houses.some((q) => (q.x - x) ** 2 + (q.z - z) ** 2 < 150)) return null;
      const y = h(x, z);
      if (Math.hypot(h(x + 2, z) - y, h(x, z + 2) - y) / 2 > 0.45) return null;
      return y;
    };
    const herd = (cx: number, cz: number, n: number, seed: number, isSheep: boolean) => {
      const dir = hash(seed, 1) * 6.28;
      let placed = 0;
      for (let k = 0; k < n * 3 && placed < n; k++) {
        const a = hash(seed, 10 + k) * 6.28;
        const r = Math.sqrt(hash(seed, 40 + k)) * (isSheep ? 11 : 16);
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        const y = okAt(x, z, isSheep ? 15 : 14);
        if (y === null) continue;
        const rot = dir + (hash(seed, 70 + k) - 0.5) * 2.4;
        if (isSheep) {
          const v = 0.55 + hash(seed, 90 + k) * 0.15;
          const s = 0.9 + hash(seed, 95 + k) * 0.25;
          sheep.add(x, y - 0.05, z, rot, [s, s, s], [v, v * 0.97, v * 0.9], hash(seed, 99 + k));
        } else {
          const coat = COATS[Math.floor(hash(seed, 80 + k) * COATS.length)];
          const s = 0.92 + hash(seed, 85 + k) * 0.16;
          cows.add(x, y - 0.06, z, rot, [s, s, s], coat, hash(seed, 99 + k));
        }
        placed++;
      }
    };
    // Kühe bei jedem zweiten Hof (auf der Talseite vor dem Haus) und auf freien Almen – je Hof nur einmal (die
    // Liste enthält alle Höfe der gebauten Strecke, nicht nur die dieses Abschnitts)
    for (const p of c.farms ?? c.houses) {
      // je Hof fest (aus dem Ort), nicht aus der Reihenfolge
      const i = Math.round(p.x * 3 + p.z * 7);
      if (this.herded.has(i)) continue;
      this.herded.add(i);
      if (hash(i, 3) > 0.6) continue;
      const a = hash(i, 4) * 6.28;
      herd(p.x + Math.cos(a) * 34, p.z + Math.sin(a) * 34, 4 + Math.floor(hash(i, 5) * 5), 1000 + i, false);
      if (late()) yield;
    }
    const w = { x: 0, y: 0, z: 0, th: 0 };
    for (let z = Math.ceil((c.z0 - 60) / 170) * 170 + 60; z < c.z1; z += 170) {
      const k = Math.round(z / 170);
      if (late()) yield;
      const sg = hash(k, 6) < 0.5 ? -1 : 1;
      c.track.world(z, sg * (45 + hash(k, 7) * 110), 0, w);
      if (hash(k, 8) < 0.55) herd(w.x, w.z, 5 + Math.floor(hash(k, 9) * 5), 2000 + k, false);
      else herd(w.x, w.z, 8 + Math.floor(hash(k, 10) * 8), 3000 + k, true);
    }
  }

  // Alpendohlen in Schwärmen über den Hängen, ab und zu ein Steinadler hoch oben
  private placeBirds(c: LifeCtx) {
    const S = this.kinds.birds;
    const w = { x: 0, y: 0, z: 0, th: 0 };
    const h = this.ground(c);
    for (let z = Math.ceil((c.z0 - 150) / 420) * 420 + 150; z < c.z1; z += 420) {
      const k = Math.round(z / 420);
      const sg = hash(k, 1) < 0.5 ? -1 : 1;
      c.track.world(z, sg * (60 + hash(k, 2) * 160), 0, w);
      const y = h(w.x, w.z) + 35 + hash(k, 3) * 50;
      const n = 6 + Math.floor(hash(k, 4) * 6);
      for (let b = 0; b < n; b++) {
        const r = 18 + hash(k * 31 + b, 5) * 30;
        const sp = (0.25 + hash(k * 31 + b, 6) * 0.2) * (hash(k, 7) < 0.5 ? -1 : 1);
        // ins Datenfeld: iP = Mitte + Phase, iS = Radius, Geschwindigkeit, Größe, iC = Farbe, Stil
        S.add(w.x + (hash(k * 31 + b, 8) - 0.5) * 20, y + (hash(k * 31 + b, 9) - 0.5) * 14, w.z + (hash(k * 31 + b, 10) - 0.5) * 20, hash(k * 31 + b, 11) * 6.28,
          [r, sp, 0.9 + hash(k * 31 + b, 12) * 0.25], [0.012, 0.012, 0.014], 0);
      }
    }
    // Steinadler: etwa alle 3 km einer
    for (let z = Math.ceil((c.z0 - 1300) / 3000) * 3000 + 1300; z < c.z1; z += 3000) {
      c.track.world(z, 120, 0, w);
      S.add(w.x, h(w.x, w.z) + 140, w.z, 0, [140, 0.06, 3.2], [0.06, 0.04, 0.025], 1);
    }
  }

  update(cam: THREE.Vector3, force = false) { for (const s of Object.values(this.kinds)) s.update(cam, force); }
  warm(on: boolean) { for (const s of Object.values(this.kinds)) s.warm(on); }
  dispose() {
    for (const s of Object.values(this.kinds)) s.dispose();
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
  }
}
