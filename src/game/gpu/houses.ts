/**
 * Häuser in der Welt (WebGPU-Test): dasselbe Alpenhaus (house.ts) oft entlang der Strecke – auf Wiesen nahe der
 * Straße und am Talhang, mit dem Giebel talwärts, ab und zu zwei, drei beieinander wie ein Weiler. Jedes Haus mit
 * eigener Putzfarbe und Ladenfarbe. Alle Häuser zusammen: fünf Zeichenaufrufe je Stufe (Instanzen).
 */
import * as THREE from 'three/webgpu';
import type { Terrain } from '../abfahrt/terrain3d';
import type { Track } from '../abfahrt/track';
import type { Surface, SurfaceId } from './bake';
import { buildHouse, houseMaterials, HMATS, type HMat } from './house';
import { commit, disposeGroup, instGroup, STRIDE, type InstGroup } from './inst';
import type { Trees } from './trees';
import { tsl } from './nodes';

const { attribute, cameraPosition, float, select, smoothstep } = tsl;

const hash = (a: number, b: number) => {
  let x = Math.imul(a ^ 0x2f6b9d1, 0x9e3779b1) ^ Math.imul(b ^ 0x5bd1e995, 0x85ebca77);
  x ^= x >>> 15;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
};

/** Ladenfarben: Tannengrün, Ochsenblut, Taubenblau, Holz natur */
const SHUTTERS: [number, number, number][] = [[0.025, 0.1, 0.04], [0.2, 0.028, 0.022], [0.05, 0.085, 0.12], [0.11, 0.065, 0.032]];

/** Grundriss mit Terrasse und Holzlege (lokal): Ecken für die Hangprüfung */
const FOOT: [number, number][] = [[-5.95, -6.1], [5.95, -6.1], [5.95, 8.7], [-5.95, 8.7], [0, 1.3]];

/** Stufenwechsel (Mitte, halbe Breite des Überblendbands, m): voll → mittel, mittel → fern */
const B0: [number, number] = [42, 7];
const B1: [number, number] = [115, 14];
const MARGIN = 7;

interface Spot { x: number; y: number; z: number; rot: number; tone: number; shut: number }

export class Houses {
  readonly group = new THREE.Group();
  private mats: Record<HMat, THREE.MeshStandardNodeMaterial>;
  private geos: Record<HMat, THREE.BufferGeometry>[];
  private groups: InstGroup[][] = [[], [], []];
  private spots: Spot[] = [];
  private at = new THREE.Vector3(1e9, 0, 0);

  constructor(S: Record<SurfaceId, Surface>, msaa: boolean) {
    // Stufe je Gruppe in iC.w (0 nah, 1 mittel, 2 fern); Abstand im Shader
    this.mats = houseMaterials(S, msaa ? (I) => {
      const d = I.at.xz.sub(cameraPosition.xz).length();
      const a = smoothstep(B0[0] - B0[1], B0[0] + B0[1], d);
      const b = smoothstep(B1[0] - B1[1], B1[0] + B1[1], d);
      const code = attribute('iC', 'vec4').w;
      return select(code.lessThan(0.5), float(1).sub(a), select(code.lessThan(1.5), a.mul(float(1).sub(b)), b));
    } : null);
    this.geos = [buildHouse(0), buildHouse(1), buildHouse(2)];
  }

  get count() { return this.spots.length; }
  /** Plätze (für Tiere und Pflanzen ringsum) */
  get positions(): { x: number; z: number }[] { return this.spots.map((s) => ({ x: s.x, z: s.z })); }

  /** Dreiecke eines Hauses je Stufe (Prüfhilfe) */
  get tris(): number[] {
    return this.geos.map((g) => HMATS.reduce((n, m) => n + g[m].getAttribute('position').count / 3, 0));
  }

  /**
   * Plätze suchen: alle 24 m entlang der Strecke, beidseitig in 26–185 m Abstand; flach genug (der Bruchsteinsockel
   * gleicht bis 4,4 m aus), kein Wald, weit genug von der Straße (auch von anderen Kehren) und von anderen Häusern.
   */
  place(track: Track, terrain: Terrain, trees: Trees, z0: number, z1: number, max = 36) {
    const w = { x: 0, y: 0, z: 0, th: 0 };
    const route: { x: number; z: number }[] = [];
    for (let z = z0 - 60; z <= z1 + 60; z += 8) { track.world(z, 0, 0, w); route.push({ x: w.x, z: w.z }); }
    const roadDist = (x: number, z: number) => {
      let d = Infinity;
      for (const p of route) d = Math.min(d, (p.x - x) ** 2 + (p.z - z) ** 2);
      return Math.sqrt(d);
    };
    const tryAt = (x: number, z: number, seed: number, minGap: number): Spot | null => {
      if (roadDist(x, z) < 25) return null;
      for (const s of this.spots) if ((s.x - x) ** 2 + (s.z - z) ** 2 < minGap * minGap) return null;
      if (trees.countNear(x, z, 14) > 3) return null;
      const h = (px: number, pz: number) => terrain.groundAt(px, pz);
      const gx = (h(x + 7, z) - h(x - 7, z)) / 14;
      const gz = (h(x, z + 7) - h(x, z - 7)) / 14;
      const g = Math.hypot(gx, gz);
      if (g > 0.42) return null;
      let rot: number;
      if (g > 0.04) rot = Math.atan2(-gx, -gz);
      else {
        // flach: Giebel zur Straße
        let best = route[0];
        let bd = Infinity;
        for (const p of route) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = p; } }
        rot = Math.atan2(best.x - x, best.z - z);
      }
      rot += (hash(seed, 3) - 0.5) * 0.35;
      const c = Math.cos(rot), s = Math.sin(rot);
      let hi = -Infinity, lo = Infinity;
      for (const [lx, lz] of FOOT) {
        const y = h(x + c * lx + s * lz, z - s * lx + c * lz);
        hi = Math.max(hi, y);
        lo = Math.min(lo, y);
      }
      if (hi - lo > 4.4) return null;
      return { x, y: hi - 0.35, z, rot, tone: hash(seed, 5), shut: Math.floor(hash(seed, 7) * SHUTTERS.length) };
    };
    const lats = [27, 34, 44, 58, 75, 96, 122, 150, 185];
    for (let z = z0; z <= z1 && this.spots.length < max; z += 24) {
      for (const side of [-1, 1]) {
        for (let li = 0; li < lats.length; li++) {
          const seed = Math.round(z) * 31 + li * 7 + (side > 0 ? 3 : 0);
          if (hash(seed, 1) > 0.75) continue;
          track.world(z, side * lats[li], 0, w);
          const sp = tryAt(w.x, w.z, seed, 70);
          if (!sp) continue;
          this.spots.push(sp);
          trees.clear(sp.x, sp.z, 12.5);
          // Weiler: ein, zwei Nachbarn hangparallel daneben
          const n = hash(seed, 11) < 0.45 ? 1 + (hash(seed, 13) < 0.4 ? 1 : 0) : 0;
          for (let q = 0; q < n && this.spots.length < max; q++) {
            const dir = (q % 2 ? -1 : 1) * (24 + hash(seed, 17 + q) * 8);
            const nx = sp.x + Math.cos(sp.rot) * dir + Math.sin(sp.rot) * (hash(seed, 19 + q) - 0.5) * 8;
            const nz = sp.z - Math.sin(sp.rot) * dir + Math.cos(sp.rot) * (hash(seed, 19 + q) - 0.5) * 8;
            const nb = tryAt(nx, nz, seed + 1000 * (q + 1), 20);
            if (!nb) continue;
            this.spots.push(nb);
            trees.clear(nb.x, nb.z, 12.5);
          }
          break;
        }
      }
    }
    this.buildGroups();
  }

  private buildGroups() {
    const n = this.spots.length;
    if (!n) return;
    let cx = 0, cy = 0, cz = 0;
    for (const s of this.spots) { cx += s.x / n; cy += s.y / n; cz += s.z / n; }
    let r = 0;
    for (const s of this.spots) r = Math.max(r, Math.hypot(s.x - cx, s.y - cy, s.z - cz));
    const sphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), r + 25);
    for (let lod = 0; lod < 3; lod++) {
      for (const m of HMATS) {
        const g = instGroup(this.geos[lod][m], this.mats[m], n, sphere);
        g.mesh.castShadow = true;
        g.mesh.receiveShadow = true;
        this.group.add(g.mesh);
        this.groups[lod].push(g);
      }
    }
  }

  /** Stufen nach Abstand verteilen (neu, wenn die Kamera 6 m weiter ist) */
  update(cam: THREE.Vector3, force = false) {
    if (!this.spots.length || (!force && this.at.distanceToSquared(cam) < 36)) return;
    this.at.copy(cam);
    const cnt = [0, 0, 0];
    const put = (lod: number, s: Spot) => {
      const i = cnt[lod]++;
      const sh = SHUTTERS[s.shut];
      for (const g of this.groups[lod]) g.data.set([s.x, s.y, s.z, s.rot, 1, 1, 1, s.tone, sh[0], sh[1], sh[2], lod], i * STRIDE);
    };
    for (const s of this.spots) {
      const d = Math.hypot(s.x - cam.x, s.z - cam.z);
      // im Überblendband in beide Stufen
      if (d < B0[0] + B0[1] + MARGIN) put(0, s);
      if (d > B0[0] - B0[1] - MARGIN && d < B1[0] + B1[1] + MARGIN) put(1, s);
      if (d > B1[0] - B1[1] - MARGIN) put(2, s);
    }
    for (let lod = 0; lod < 3; lod++) for (const g of this.groups[lod]) commit(g, cnt[lod]);
  }

  /** Vorwärmen: beide Stufen einmal zeichnen lassen */
  warm(on: boolean) {
    for (const l of this.groups) for (const g of l) {
      if (on) { g.geo.instanceCount = Math.max(1, g.geo.instanceCount); g.mesh.visible = true; }
    }
    if (!on) this.at.set(1e9, 0, 0);
  }

  dispose() {
    for (const l of this.groups) for (const g of l) disposeGroup(g);
    for (const geo of this.geos) for (const m of HMATS) geo[m].dispose();
    for (const m of HMATS) this.mats[m].dispose();
  }
}
