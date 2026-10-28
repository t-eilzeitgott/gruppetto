/**
 * Grashalme am Straßenrand (WebGPU-Test): Büschel aus einzelnen, gebogenen Halmen als Instanzen je
 * Straßenabschnitt – nur in der Nähe der Kamera, weich ausgeblendet (die Halme sinken in den Boden), mit Wind.
 */
import * as THREE from 'three/webgpu';
import { tsl } from './nodes';

const { cameraPosition, cos, float, mix, positionGeometry, positionLocal, sin, smoothstep, time, vec2, vec3, vertexColor } = tsl;

const rnd = (n: number) => {
  let x = Math.imul(n ^ 0x51ed27, 0x2c1b3c6d);
  x ^= x >>> 12;
  x = Math.imul(x, 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
};

/** ein Büschel: zwölf Halme, je drei Dreiecke (unten breit, Spitze), leicht gebogen */
function clump(): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  for (let b = 0; b < 12; b++) {
    const a = rnd(b * 3 + 1) * Math.PI * 2;
    const r = 0.02 + rnd(b * 5 + 2) * 0.15;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    const h = 0.1 + rnd(b * 7 + 3) * 0.22;
    const w = 0.013 + rnd(b * 11 + 4) * 0.011;
    const lean = 0.12 + rnd(b * 13 + 5) * 0.3;
    const dir = a + (rnd(b * 17 + 6) - 0.5) * 1.2;
    const dx = Math.cos(dir), dz = Math.sin(dir);
    // quer zum Halm
    const px = -dz, pz = dx;
    const pt = (t: number, side: number) => {
      const bend = lean * t * t * h;
      const ww = w * (1 - t * 0.85) * side;
      return [ox + dx * bend + px * ww, t * h, oz + dz * bend + pz * ww];
    };
    const p0 = pt(0, -1), p1 = pt(0, 1), p2 = pt(0.55, -1), p3 = pt(0.55, 1), p4 = pt(1, 0);
    const n = [dx * 0.3, 0.9, dz * 0.3];
    // Faktoren auf die Farbe der Gegend (Instanzfarbe): unten dunkel, Spitzen hell und etwas gelber
    const c = (t: number) => [0.4 + t * 0.95, 0.42 + t * 0.85, 0.35 + t * 0.6].map((v) => v * (0.85 + rnd(b * 19) * 0.3));
    const tri = (A: number[], B: number[], C: number[], ta: number, tb: number, tc: number) => {
      for (const [p, t] of [[A, ta], [B, tb], [C, tc]] as [number[], number][]) { pos.push(...p); nor.push(...n); col.push(...c(t)); }
    };
    tri(p0, p1, p3, 0, 0, 0.55);
    tri(p0, p3, p2, 0, 0.55, 0.55);
    tri(p2, p3, p4, 0.55, 0.55, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Stelle eines Büschels: Ort, Drehung, Größe, Farbe der Gegend */
export interface Tuft { x: number; y: number; z: number; rot: number; s: number; r: number; g: number; b: number }

const SHOW = 48;

export class Grass {
  readonly group = new THREE.Group();
  private geo = clump();
  private mat: THREE.MeshStandardNodeMaterial;
  private chunks: { mesh: THREE.InstancedMesh; cx: number; cz: number }[] = [];
  count = 0;

  constructor() {
    const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
    const h = positionGeometry.y;
    // nur in der Nähe: zwischen 24 und 36 m sinken die Halme in den Boden
    const d = positionLocal.xz.sub(cameraPosition.xz).length();
    const fade = float(1).sub(smoothstep(24, 36, d));
    const ph = positionLocal.x.mul(0.37).add(positionLocal.z.mul(0.29));
    const gust = sin(time.mul(0.7).add(positionLocal.x.mul(0.05))).mul(0.5).add(0.5);
    const sway = vec2(sin(time.mul(2.3).add(ph)), cos(time.mul(1.9).add(ph.mul(1.3)))).mul(h.mul(h).mul(mix(0.25, 0.9, gust)));
    m.positionNode = positionLocal.add(vec3(sway.x, h.mul(fade.sub(1)), sway.y));
    m.colorNode = vertexColor();
    m.roughnessNode = float(0.55);
    m.metalnessNode = float(0);
    this.mat = m;
  }

  addChunk(tufts: Tuft[]) {
    if (!tufts.length) return;
    const n = tufts.length;
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, n);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const c = new THREE.Color();
    let cx = 0, cz = 0, cy = 0;
    tufts.forEach((t, k) => {
      q.setFromAxisAngle(v.set(0, 1, 0), t.rot);
      m4.compose(v.set(t.x, t.y, t.z), q, sc.set(t.s, t.s * (0.8 + rnd(k) * 0.5), t.s));
      mesh.setMatrixAt(k, m4);
      mesh.setColorAt(k, c.setRGB(t.r, t.g, t.b));
      cx += t.x; cz += t.z; cy += t.y;
    });
    cx /= n; cz /= n; cy /= n;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), 60);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    this.chunks.push({ mesh, cx, cz });
    this.count += n;
  }

  update(cam: THREE.Vector3) {
    for (const ch of this.chunks) ch.mesh.visible = Math.hypot(ch.cx - cam.x, ch.cz - cam.z) < SHOW;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    for (const ch of this.chunks) ch.mesh.dispose();
  }
}
