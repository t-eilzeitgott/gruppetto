/**
 * Grashalme am Straßenrand (WebGPU-Test): Büschel aus einzelnen, gebogenen Halmen als Instanzen je
 * Straßenabschnitt – nur in der Nähe der Kamera, weich ausgeblendet (die Halme sinken in den Boden), mit Wind.
 * Instanzdaten in der Geometrie (inst.ts): ein Shaderprogramm für alle Stücke.
 */
import * as THREE from 'three/webgpu';
import { cheapMaterial } from './light';
import { tsl } from './nodes';
import { commit, disposeGroup, instGroup, instNodes, STRIDE, type InstGroup } from './inst';

const { cameraPosition, cos, float, mix, positionGeometry, sin, smoothstep, time, vec2, vec3, vertexColor } = tsl;

const rnd = (n: number) => {
  let x = Math.imul(n ^ 0x51ed27, 0x2c1b3c6d);
  x ^= x >>> 12;
  x = Math.imul(x, 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
};

/** ein Büschel: acht Halme, je drei Dreiecke (unten breit, Spitze), leicht gebogen */
function clump(): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  for (let b = 0; b < 8; b++) {
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

const SHOW = 34;

export class Grass {
  readonly group = new THREE.Group();
  private geo = clump();
  private mat: THREE.Material;
  private chunks: { g: InstGroup; cx: number; cz: number; n: number }[] = [];
  count = 0;

  constructor() {
    const I = instNodes();
    const m = cheapMaterial({ col: vertexColor().mul(I.color), nWorld: I.nWorld, params: { side: THREE.DoubleSide } });
    const h = positionGeometry.y;
    const w = I.world;
    // nur in der Nähe: zwischen 24 und 36 m sinken die Halme in den Boden
    const d = w.xz.sub(cameraPosition.xz).length();
    const fade = float(1).sub(smoothstep(15, 26, d));
    const ph = w.x.mul(0.37).add(w.z.mul(0.29));
    const gust = sin(time.mul(0.7).add(w.x.mul(0.05))).mul(0.5).add(0.5);
    const sway = vec2(sin(time.mul(2.3).add(ph)), cos(time.mul(1.9).add(ph.mul(1.3)))).mul(h.mul(h).mul(mix(0.25, 0.9, gust)));
    m.positionNode = w.add(vec3(sway.x, h.mul(fade.sub(1)), sway.y));
    m.name = 'grass';
    this.mat = m;
  }

  addChunk(tufts: Tuft[]) {
    if (!tufts.length) return;
    this.addTo(tufts);
  }

  /** Streaming: Stücke abbauen, deren Mitte nicht mehr gebraucht wird */
  prune(keep: (cx: number, cz: number) => boolean) {
    this.chunks = this.chunks.filter((ch) => {
      if (keep(ch.cx, ch.cz)) return true;
      disposeGroup(ch.g);
      this.count -= ch.n;
      return false;
    });
  }

  private addTo(tufts: Tuft[]) {
    const n = tufts.length;
    let cx = 0, cz = 0, cy = 0;
    for (const t of tufts) { cx += t.x; cz += t.z; cy += t.y; }
    cx /= n; cz /= n; cy /= n;
    const g = instGroup(this.geo, this.mat, n, new THREE.Sphere(new THREE.Vector3(cx, cy, cz), 60));
    tufts.forEach((t, k) => {
      g.data.set([t.x, t.y, t.z, t.rot, t.s, t.s * (0.8 + rnd(k) * 0.5), t.s, 0, t.r, t.g, t.b, 0], k * STRIDE);
    });
    commit(g, n);
    g.mesh.castShadow = false;
    g.mesh.receiveShadow = true;
    g.mesh.visible = false;
    this.group.add(g.mesh);
    this.chunks.push({ g, cx, cz, n });
    this.count += n;
  }

  update(cam: THREE.Vector3) {
    for (const ch of this.chunks) ch.g.mesh.visible = Math.hypot(ch.cx - cam.x, ch.cz - cam.z) < SHOW;
  }

  /** Vorwärmen: alle Stücke einmal zeichnen lassen (Daten hochladen) */
  warm() {
    for (const ch of this.chunks) ch.g.mesh.visible = true;
  }

  dispose() {
    for (const ch of this.chunks) disposeGroup(ch.g);
    this.geo.dispose();
    this.mat.dispose();
  }
}
