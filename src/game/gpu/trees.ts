/**
 * Bäume für den WebGPU-Test: echte 3D-Bäume als Instanzen je Landschaftskachel, in drei Detailstufen nach
 * Abstand. Fichte (Ast-Etagen aus sternförmigen Zweigen), Lärche (lichter, heller), Laubbaum (Kronenballen).
 * Normalen zeigen von der Stammachse weg (weiches Licht wie bei echten Kronen), Wind im Vertex-Shader,
 * etwas Durchscheinen im Gegenlicht.
 */
import * as THREE from 'three/webgpu';
import type { TreeSpot } from '../abfahrt/terrain3d';
import { tsl, type N } from './nodes';

const { attribute, cameraPosition, cos, dot, float, max, normalize, positionGeometry, positionLocal, positionWorld, pow, sin, time, uniform, vec3, vertexColor } = tsl;

type Arch = 'pine' | 'larch' | 'broad';
const ARCHS: Arch[] = ['pine', 'larch', 'broad'];

/** Zufall aus einer Zahl (fest je Baum) */
const rnd = (n: number) => {
  let x = Math.imul(n ^ 0x2c1b3c6d, 0x297a2d39);
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca77);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
};

class Mesher {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  sway: number[] = [];
  v(p: number[], n: number[], c: number[], s: number) {
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0] / l, n[1] / l, n[2] / l);
    this.col.push(c[0], c[1], c[2]);
    this.sway.push(s);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Stamm: Kegelstumpf mit flachen Seiten */
function trunk(M: Mesher, h: number, r0: number, r1: number, seg: number, col: number[]) {
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2;
    const a1 = ((k + 1) / seg) * Math.PI * 2;
    const p = (a: number, y: number, r: number) => [Math.cos(a) * r, y, Math.sin(a) * r];
    const n0 = [Math.cos(a0), 0.15, Math.sin(a0)];
    const n1 = [Math.cos(a1), 0.15, Math.sin(a1)];
    const c0 = col.map((c) => c * 0.75);
    M.v(p(a0, 0, r0), n0, c0, 0); M.v(p(a1, h, r1), n1, col, 0.25); M.v(p(a1, 0, r0), n1, c0, 0);
    M.v(p(a0, 0, r0), n0, c0, 0); M.v(p(a0, h, r1), n0, col, 0.25); M.v(p(a1, h, r1), n1, col, 0.25);
  }
}

/** Nadelbaum: Etagen sternförmiger, hängender Zweige */
function conifer(h: number, tiers: number, branches: number, opt: { inner: number[]; tip: number[]; droop: number; width: number; sparse: number; seed: number }): THREE.BufferGeometry {
  const M = new Mesher();
  if (tiers > 2) trunk(M, h * 0.9, h * 0.017, h * 0.004, tiers > 6 ? 7 : 5, [0.075, 0.055, 0.042]);
  const y0 = h * 0.16;
  const yTop = h;
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers;
    const y = y0 + (yTop - y0) * Math.pow(f, 0.92);
    const R = (opt.width * h * Math.pow(1 - f, 0.95) + h * 0.03) * (0.9 + rnd(opt.seed + t * 13) * 0.2);
    const B = Math.max(3, Math.round(branches * (1 - f * 0.45)));
    const off = rnd(opt.seed + t * 7) * Math.PI * 2;
    const lift = (yTop - y0) / tiers * 1.05;
    const light = 0.75 + f * 0.45;
    for (let b = 0; b < B; b++) {
      if (rnd(opt.seed + t * 31 + b) < opt.sparse) continue;
      const a = off + (b / B) * Math.PI * 2 + (rnd(opt.seed + b * 5 + t) - 0.5) * 0.4;
      const w = (Math.PI / B) * 0.95;
      const Rb = R * (0.8 + rnd(opt.seed + b * 11 + t * 3) * 0.35);
      const dr = opt.droop * Rb;
      const c = [0, y + lift * 0.55, 0];
      const tip = [Math.cos(a) * Rb, y - dr, Math.sin(a) * Rb];
      const s1 = [Math.cos(a - w) * Rb * 0.62, y - dr * 0.35 + lift * 0.12, Math.sin(a - w) * Rb * 0.62];
      const s2 = [Math.cos(a + w) * Rb * 0.62, y - dr * 0.35 + lift * 0.12, Math.sin(a + w) * Rb * 0.62];
      const u = [0, y - lift * 0.25, 0];
      // Normalen: von der Achse weg und etwas nach oben (weiches Kronenlicht)
      const nrm = (p: number[]) => [p[0], (p[1] - y) * 0.6 + Math.hypot(p[0], p[2]) * 0.55 + 0.15, p[2]];
      const sw = (p: number[]) => Math.pow(p[1] / h, 1.6) + Math.hypot(p[0], p[2]) / h * 0.4;
      const ic = opt.inner.map((v) => v * light);
      const tc = opt.tip.map((v) => v * light * (0.85 + rnd(opt.seed + b * 3 + t * 17) * 0.3));
      const sc = opt.tip.map((v, k) => (v * 0.6 + opt.inner[k] * 0.4) * light);
      // oben
      M.v(c, nrm(c), ic, sw(c)); M.v(tip, nrm(tip), tc, sw(tip)); M.v(s1, nrm(s1), sc, sw(s1));
      M.v(c, nrm(c), ic, sw(c)); M.v(s2, nrm(s2), sc, sw(s2)); M.v(tip, nrm(tip), tc, sw(tip));
      // unten (dunkler)
      const uc = ic.map((v) => v * 0.55);
      const dn = (p: number[]) => [p[0], -0.3, p[2]];
      M.v(u, dn(u), uc, sw(u)); M.v(s1, dn(s1), uc, sw(s1)); M.v(tip, dn(tip), tc.map((v) => v * 0.7), sw(tip));
      M.v(u, dn(u), uc, sw(u)); M.v(tip, dn(tip), tc.map((v) => v * 0.7), sw(tip)); M.v(s2, dn(s2), uc, sw(s2));
    }
  }
  return M.build();
}

/** ganz grob (Ferne): zwei gestapelte Kegel, ohne Stamm – 24 Dreiecke */
function cones(h: number, w: number, inner: number[], tip: number[]): THREE.BufferGeometry {
  const M = new Mesher();
  const seg = 6;
  for (const [y0, y1, r] of [[0.12, 0.62, w], [0.45, 1, w * 0.62]] as [number, number, number][]) {
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2;
      const a1 = ((k + 1) / seg) * Math.PI * 2;
      const b0 = [Math.cos(a0) * r * h, y0 * h, Math.sin(a0) * r * h];
      const b1 = [Math.cos(a1) * r * h, y0 * h, Math.sin(a1) * r * h];
      const t = [0, y1 * h, 0];
      M.v(b0, [b0[0], r * h * 0.8, b0[2]], tip, y0); M.v(t, [0, 1, 0], inner.map((v) => v * 1.4), 1); M.v(b1, [b1[0], r * h * 0.8, b1[2]], tip, y0);
      const c = [0, y0 * h, 0];
      M.v(b0, [0, -1, 0], inner, y0); M.v(b1, [0, -1, 0], inner, y0); M.v(c, [0, -1, 0], inner, y0);
    }
  }
  return M.build();
}

/** Laubbaum: Stamm und unregelmäßige Kronenballen */
function broadleaf(h: number, blobs: number, detail: number, seed: number): THREE.BufferGeometry {
  const M = new Mesher();
  trunk(M, h * 0.55, h * 0.035, h * 0.022, detail > 0 ? 7 : 5, [0.09, 0.075, 0.06]);
  const ico = new THREE.IcosahedronGeometry(1, detail);
  const ip = ico.getAttribute('position');
  for (let b = 0; b < blobs; b++) {
    const a = rnd(seed + b * 3) * Math.PI * 2;
    const rr = b === 0 ? 0 : h * (0.12 + rnd(seed + b * 5) * 0.1);
    const cx = Math.cos(a) * rr;
    const cz = Math.sin(a) * rr;
    const cy = h * (0.62 + (b === 0 ? 0.08 : rnd(seed + b * 7) * 0.18));
    const R = h * (b === 0 ? 0.26 : 0.17 + rnd(seed + b * 9) * 0.07);
    for (let i = 0; i < ip.count; i++) {
      const x = ip.getX(i), y = ip.getY(i), z = ip.getZ(i);
      const j = 0.82 + rnd(seed + b * 101 + Math.round((x * 7 + y * 13 + z * 17) * 10)) * 0.3;
      const p = [cx + x * R * j, cy + y * R * j * 0.85, cz + z * R * j];
      // Normale: von der Kronenmitte weg (weiche, runde Krone)
      const n = [p[0], (p[1] - h * 0.62) * 0.9 + R * 0.3, p[2]];
      const shade = 0.55 + 0.45 * (y * 0.5 + 0.5);
      const c = [0.045 * shade, 0.075 * shade, 0.022 * shade].map((v) => v * (0.85 + rnd(seed + b) * 0.3));
      M.v(p, n, c, Math.pow(p[1] / h, 1.5));
    }
  }
  ico.dispose();
  return M.build();
}

/** Geometrien je Art und Stufe (Höhe 1 = ~12 m bei Maßstab 1) */
function geometries(): Record<Arch, THREE.BufferGeometry[]> {
  const pine = { inner: [0.012, 0.024, 0.014], tip: [0.04, 0.072, 0.035], droop: 0.32, width: 0.2, sparse: 0.05 };
  const larch = { inner: [0.03, 0.045, 0.018], tip: [0.09, 0.13, 0.045], droop: 0.38, width: 0.18, sparse: 0.22 };
  return {
    pine: [conifer(12, 13, 10, { ...pine, seed: 3 }), conifer(12, 6, 7, { ...pine, seed: 3 }), cones(12, 0.21, pine.inner.map((v) => v * 0.8), pine.tip.map((v) => v * 0.7))],
    larch: [conifer(13, 12, 9, { ...larch, seed: 9 }), conifer(13, 6, 6, { ...larch, sparse: 0.1, seed: 9 }), cones(13, 0.19, larch.inner.map((v) => v * 0.8), larch.tip.map((v) => v * 0.7))],
    broad: [broadleaf(11, 7, 1, 5), broadleaf(11, 4, 0, 5), broadleaf(11, 1, 0, 5)],
  };
}

const archOf = (kind: string): Arch => (kind === 'larch' ? 'larch' : kind === 'pine' || kind === 'pineSnow' ? 'pine' : 'broad');

/** Grenzen der Detailstufen je Baum (m) */
const LOD_D = [90, 250];

/**
 * Bäume werden in Zellen von 256 m gesammelt (vier Landschaftskacheln) – wenige Zeichenaufrufe. Die Detailstufe
 * gilt je Baum: in Zellen nahe der Kamera werden die Bäume nach Abstand auf die drei Stufen verteilt (neu, wenn
 * die Kamera ein Stück weiter ist), ferne Zellen zeigen alle in der groben Stufe.
 */
const CELL = 256;

interface Group {
  n: number;
  mats: Float32Array;
  cols: Float32Array;
  xz: Float32Array;
  meshes: THREE.InstancedMesh[];
}
interface Cell {
  cx: number; cz: number; cy: number;
  spots: TreeSpot[];
  dirty: boolean;
  far: boolean | null;
  at: THREE.Vector3;
  groups: Group[];
}

export class Trees {
  readonly group = new THREE.Group();
  private geo = geometries();
  private mat: THREE.MeshStandardNodeMaterial;
  private cells = new Map<string, Cell>();
  readonly sunDir = uniform(new THREE.Vector3(0, 1, 0));
  count = 0;

  constructor() {
    const m = new THREE.MeshStandardNodeMaterial();
    const sway = attribute('aSway', 'float');
    // Wind: jeder Baum mit eigener Phase (aus dem Ort), oben mehr als unten
    const ph = positionLocal.x.mul(0.071).add(positionLocal.z.mul(0.053));
    const t = time;
    const amp = sway.mul(sway).mul(0.16);
    const off = vec3(sin(t.mul(1.25).add(ph)).add(sin(t.mul(2.9).add(ph.mul(1.7))).mul(0.3)), 0, cos(t.mul(1.05).add(ph.mul(1.3))).mul(0.7)).mul(amp);
    m.positionNode = positionLocal.add(off.mul(max(float(0.3), positionGeometry.y.div(12))));
    const col: N = vertexColor();
    m.colorNode = col;
    m.roughnessNode = float(0.86);
    m.metalnessNode = float(0);
    // Gegenlicht: Kronen leuchten am Rand etwas durch, wenn man gegen die Sonne schaut
    const view = normalize(positionWorld.sub(cameraPosition));
    const back = pow(max(float(0), dot(view, this.sunDir)), 6);
    m.emissiveNode = col.mul(back.mul(sway.min(1)).mul(2.2));
    this.mat = m;
  }

  /** Bäume einer Landschaftskachel übernehmen (gebaut wird beim nächsten update) */
  addTile(trees: TreeSpot[], cx: number, cz: number) {
    const key = `${Math.floor(cx / CELL)},${Math.floor(cz / CELL)}`;
    let c = this.cells.get(key);
    if (!c) {
      c = { cx: (Math.floor(cx / CELL) + 0.5) * CELL, cz: (Math.floor(cz / CELL) + 0.5) * CELL, cy: 0, spots: [], dirty: true, far: null, at: new THREE.Vector3(1e9, 0, 0), groups: [] };
      this.cells.set(key, c);
    }
    for (const t of trees) c.spots.push(t);
    c.dirty = true;
    this.count += trees.length;
  }

  private rebuild(c: Cell) {
    for (const g of c.groups) for (const m of g.meshes) { this.group.remove(m); m.dispose(); }
    c.groups = [];
    c.dirty = false;
    c.far = null;
    c.at.set(1e9, 0, 0);
    const by: Record<Arch, TreeSpot[]> = { pine: [], larch: [], broad: [] };
    let sy = 0;
    for (const t of c.spots) { by[archOf(t.kind)].push(t); sy += t.y; }
    c.cy = c.spots.length ? sy / c.spots.length : 0;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();
    const sphere = new THREE.Sphere(new THREE.Vector3(c.cx, c.cy + 6, c.cz), CELL * 0.75);
    for (const a of ARCHS) {
      const list = by[a];
      if (!list.length) continue;
      const n = list.length;
      const mats = new Float32Array(n * 16);
      const cols = new Float32Array(n * 3);
      const xz = new Float32Array(n * 2);
      list.forEach((t, k) => {
        const seed = Math.round(t.x * 13 + t.z * 7);
        q.setFromAxisAngle(v.set(0, 1, 0), t.rot);
        const s = t.s * (a === 'broad' ? 0.9 : 1);
        // leicht unterschiedlich schlank (keine Klone)
        sc.set(s * (0.9 + rnd(seed + 1) * 0.2), s * (0.92 + rnd(seed + 2) * 0.16), s * (0.9 + rnd(seed + 3) * 0.2));
        m4.compose(v.set(t.x, t.y + 0.25, t.z), q, sc);
        m4.toArray(mats, k * 16);
        const tint = t.tint;
        col.setRGB(tint * (0.92 + rnd(seed) * 0.16), tint * (0.95 + rnd(seed + 9) * 0.1), tint * (0.9 + rnd(seed + 4) * 0.12));
        col.toArray(cols, k * 3);
        xz[k * 2] = t.x;
        xz[k * 2 + 1] = t.z;
      });
      const meshes: THREE.InstancedMesh[] = [];
      for (let lv = 0; lv < 3; lv++) {
        const mesh = new THREE.InstancedMesh(this.geo[a][lv], this.mat, n);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        mesh.boundingSphere = sphere;
        // Schatten nur von den nahen Bäumen (der Schattenausschnitt reicht ohnehin nur ~55 m weit)
        mesh.castShadow = lv === 0;
        mesh.receiveShadow = lv === 0;
        mesh.visible = false;
        mesh.count = 0;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        meshes.push(mesh);
      }
      c.groups.push({ n, mats, cols, xz, meshes });
    }
  }

  /** Bäume einer Zelle nach Abstand auf die Stufen verteilen (far: alle grob) */
  private partition(c: Cell, cam: THREE.Vector3, far: boolean) {
    c.far = far;
    c.at.copy(cam);
    const d0 = LOD_D[0] * LOD_D[0];
    const d1 = LOD_D[1] * LOD_D[1];
    for (const g of c.groups) {
      const cnt = [0, 0, 0];
      const M = g.meshes.map((m) => m.instanceMatrix.array as Float32Array);
      const C = g.meshes.map((m) => m.instanceColor!.array as Float32Array);
      for (let k = 0; k < g.n; k++) {
        let lv = 2;
        if (!far) {
          const dx = g.xz[k * 2] - cam.x;
          const dz = g.xz[k * 2 + 1] - cam.z;
          const dd = dx * dx + dz * dz;
          lv = dd < d0 ? 0 : dd < d1 ? 1 : 2;
        }
        const i = cnt[lv]++;
        M[lv].set(g.mats.subarray(k * 16, k * 16 + 16), i * 16);
        C[lv].set(g.cols.subarray(k * 3, k * 3 + 3), i * 3);
      }
      g.meshes.forEach((m, lv) => {
        m.count = cnt[lv];
        m.visible = cnt[lv] > 0;
        m.instanceMatrix.needsUpdate = true;
        m.instanceColor!.needsUpdate = true;
      });
    }
  }

  /** neue Bäume einbauen (eine Zelle je Bild) und Detailstufen nachführen (eine nahe Zelle je Bild) */
  update(cam: THREE.Vector3, all = false) {
    for (const c of this.cells.values()) {
      if (c.dirty) { this.rebuild(c); if (!all) break; }
    }
    let budget = all ? 1e9 : 1;
    for (const c of this.cells.values()) {
      if (c.dirty || !c.groups.length) continue;
      const dx = Math.max(0, Math.abs(cam.x - c.cx) - CELL / 2);
      const dz = Math.max(0, Math.abs(cam.z - c.cz) - CELL / 2);
      const far = Math.hypot(dx, dz) > LOD_D[1] + 20;
      if (far) {
        if (c.far !== true) this.partition(c, cam, true);
        continue;
      }
      // nah: neu verteilen, wenn die Kamera 12 m weiter ist (je Bild höchstens eine Zelle)
      if (c.far !== false || c.at.distanceToSquared(cam) > 144) {
        if (budget <= 0) continue;
        budget--;
        this.partition(c, cam, false);
      }
    }
  }

  dispose() {
    for (const c of this.cells.values()) for (const g of c.groups) for (const m of g.meshes) m.dispose();
    for (const a of ARCHS) for (const g of this.geo[a]) g.dispose();
    this.mat.dispose();
  }
}
