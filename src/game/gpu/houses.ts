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
import { buildBarn, buildChurch } from './buildings';
import { commit, disposeGroup, instGroup, STRIDE, type InstGroup } from './inst';
import type { Trees } from './trees';
import { tsl, viewTest } from './nodes';

const { attribute, cameraPosition, float, select, smoothstep, varying } = tsl;

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
const B0: [number, number] = [20, 4];
const B1: [number, number] = [115, 14];
const MARGIN = 7;
/** große Bauten (Kirche): Stufenwechsel so viel weiter weg */
const BIG = 1.6;

/** Bauart: Wohnhaus, Stadel, Kirche */
export const KIND = { house: 0, barn: 1, church: 2 } as const;
const KINDS = 3;

export interface Spot {
  x: number; y: number; z: number; rot: number; tone: number; shut: number; /** Strecke (m), für das Abbauen */ at: number;
  kind?: number; sx?: number; sy?: number; sz?: number;
}

/** was die Platzsuche braucht */
export interface HouseCtx {
  track: Track;
  terrain: Terrain;
  trees: Trees;
  /** Abstand zur Straße (alle Stellen der Strecke, auch andere Kehren) */
  roadDist: (x: number, z: number) => number;
  /** Grundrisse der Ortshäuser (x, z, Radius): dort kein Hof */
  occ?: number[];
}

export class Houses {
  readonly group = new THREE.Group();
  private mats: Record<HMat, THREE.Material>;
  /** Geometrie je Bauart und Stufe */
  private geos: Record<HMat, THREE.BufferGeometry>[][];
  /** Gruppen je Bauart, Stufe, Material */
  private groups: InstGroup[][][] = [];
  spots: Spot[] = [];
  private cap = 0;
  private at = new THREE.Vector3(1e9, 0, 0);

  constructor(S: Record<SurfaceId, Surface>, _msaa: boolean) {
    // Stufe je Gruppe in iC.w (0 nah, 1 mittel, 2 fern); Abstand im Shader
    // Raster-Überblendung (nodes.ditherVis): die Stufen teilen sich die Bildpunkte, nie dieselben – kein Flackern
    this.mats = houseMaterials(S, (I) => {
      // iC.w: Stufe, + 4 bei großen Bauten (Kirche: Stufenwechsel 1,6-mal so weit weg)
      const raw = attribute('iC', 'vec4').w;
      const big = raw.greaterThan(3.5);
      const code = select(big, raw.sub(4), raw);
      const d = varying(I.at.xz.sub(cameraPosition.xz).length().div(select(big, float(BIG), float(1))), 'vHouseD');
      const a = smoothstep(B0[0] - B0[1], B0[0] + B0[1], d);
      const b = smoothstep(B1[0] - B1[1], B1[0] + B1[1], d);
      const one = float(1);
      const lo = select(code.lessThan(0.5), float(0), select(code.lessThan(1.5), one.sub(a), one.sub(b)));
      const hi = select(code.lessThan(0.5), one.sub(a), select(code.lessThan(1.5), one.sub(b), float(2)));
      return [lo, hi];
    });
    this.geos = [
      [buildHouse(0), buildHouse(1), buildHouse(2)],
      [buildBarn(0), buildBarn(1), buildBarn(2)],
      [buildChurch(0), buildChurch(1), buildChurch(2)],
    ];
  }

  get count() { return this.spots.length; }

  /** Schatten der Häuser für die Bodenkarte (sunmap.ts) */
  splats(x0: number, z0: number, x1: number, z1: number, shadow: (x: number, z: number, h: number, r: number, kind: number) => void) {
    for (const s of this.spots) {
      if (s.x < x0 || s.x > x1 || s.z < z0 || s.z > z1) continue;
      const k = s.kind ?? 0;
      const sc = Math.max(s.sx ?? 1, s.sz ?? 1);
      if (k === KIND.church) {
        // Langhaus und Turm (hinten rechts, lokal x ≈ 7, z ≈ −6)
        shadow(s.x, s.z, 12, 8.5, 1);
        const c = Math.cos(s.rot), sn = Math.sin(s.rot);
        shadow(s.x + 7.2 * c - 6.5 * sn, s.z - 7.2 * sn - 6.5 * c, 30, 3.2, 1);
      } else shadow(s.x, s.z, (k === KIND.barn ? 8.5 : 9.5) * (s.sy ?? 1), 5.5 * sc, 1);
    }
  }
  /** Plätze (für Tiere und Pflanzen ringsum) */
  get positions(): { x: number; z: number }[] { return this.spots.map((s) => ({ x: s.x, z: s.z })); }

  /** Dreiecke eines Hauses je Stufe (Prüfhilfe) */
  get tris(): number[] {
    return this.geos.map((k) => k.map((g) => HMATS.reduce((n, m) => n + g[m].getAttribute('position').count / 3, 0))).flat();
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
    const it = this.addRange({ track, terrain, trees, roadDist }, z0, z1 + 1, max);
    while (!it.next().done) { /* weiter */ }
  }

  /**
   * Streaming: Häuser für den Bereich z0 … z1 (halboffen). Auf Almen wie oben; in Dörfern (Gegend „village“)
   * dicht an der Straße, beidseitig gleich hinter dem Korridor, Giebel zur Straße.
   */
  *addRange(c: HouseCtx, z0: number, z1: number, max = Infinity, late: () => boolean = () => false): Generator<void, void, void> {
    const { track, terrain, trees, roadDist } = c;
    const w = { x: 0, y: 0, z: 0, th: 0 };
    let placed = 0;
    const tryAt = (x: number, z: number, seed: number, minGap: number, minRoad: number, toward: { x: number; z: number } | null, at: number): Spot | null => {
      if (roadDist(x, z) < minRoad) return null;
      for (const s of this.spots) if ((s.x - x) ** 2 + (s.z - z) ** 2 < minGap * minGap) return null;
      const occ = c.occ;
      if (occ) for (let o = 0; o < occ.length; o += 3) if (Math.hypot(occ[o] - x, occ[o + 1] - z) < occ[o + 2] + 14) return null;
      if (trees.countNear(x, z, 14) > 3) return null;
      const h = (px: number, pz: number) => terrain.groundAt(px, pz);
      const gx = (h(x + 7, z) - h(x - 7, z)) / 14;
      const gz = (h(x, z + 7) - h(x, z - 7)) / 14;
      const g = Math.hypot(gx, gz);
      if (g > 0.42) return null;
      let rot: number;
      if (toward) rot = Math.atan2(toward.x - x, toward.z - z);
      else if (g > 0.04) rot = Math.atan2(-gx, -gz);
      else {
        // flach: Giebel zur Straße (nächster Punkt quer zur Strecke)
        track.world(at, 0, 0, w);
        rot = Math.atan2(w.x - x, w.z - z);
      }
      rot += (hash(seed, 3) - 0.5) * (toward ? 0.12 : 0.35);
      const cs = Math.cos(rot), sn = Math.sin(rot);
      let hi = -Infinity, lo = Infinity;
      for (const [lx, lz] of FOOT) {
        const y = h(x + cs * lx + sn * lz, z - sn * lx + cs * lz);
        hi = Math.max(hi, y);
        lo = Math.min(lo, y);
      }
      if (hi - lo > 4.4) return null;
      return { x, y: hi - 0.35, z, rot, tone: hash(seed, 5), shut: Math.floor(hash(seed, 7) * SHUTTERS.length), at };
    };
    const lats = [27, 34, 44, 58, 75, 96, 122, 150, 185];
    for (let z = Math.ceil(z0 / 24) * 24; z < z1 && placed < max; z += 24) {
      if (late()) yield;
      const s = track.segAt(z);
      if (s.tunnel) continue;
      const village = track.sections[s.sec].biome === 'village';
      for (const side of [-1, 1]) {
        if (late()) yield;
        // Ortsdurchfahrt mit Häuserzeilen (town.ts): dort keine Höfe gleich am Korridor
        if (village && (s.bL || s.bR)) continue;
        if (village) {
          // Dorf: Häuserzeile gleich hinter dem Korridor (dort beginnt die Landschaft)
          const lim = terrain.lim(s.i)[side < 0 ? 0 : 1];
          const seed = Math.round(z) * 53 + (side > 0 ? 5 : 0);
          if (hash(seed, 1) > 0.8) continue;
          track.world(z, side * (lim + 8 + hash(seed, 2) * 6), 0, w);
          const toward = track.world(z, 0, 0, { x: 0, y: 0, z: 0, th: 0 });
          const sp = tryAt(w.x, w.z, seed, 17, 13, toward, z);
          if (!sp) continue;
          this.spots.push(sp);
          placed++;
          trees.clear(sp.x, sp.z, 12.5);
          continue;
        }
        for (let li = 0; li < lats.length; li++) {
          if (li % 3 === 2 && late()) yield;
          const seed = Math.round(z) * 31 + li * 7 + (side > 0 ? 3 : 0);
          if (hash(seed, 1) > 0.75) continue;
          track.world(z, side * lats[li], 0, w);
          const sp = tryAt(w.x, w.z, seed, 70, 25, null, z);
          if (!sp) continue;
          this.spots.push(sp);
          placed++;
          trees.clear(sp.x, sp.z, 12.5);
          // Weiler: ein, zwei Nachbarn hangparallel daneben
          const n = hash(seed, 11) < 0.45 ? 1 + (hash(seed, 13) < 0.4 ? 1 : 0) : 0;
          for (let q = 0; q < n && placed < max; q++) {
            const dir = (q % 2 ? -1 : 1) * (24 + hash(seed, 17 + q) * 8);
            const nx = sp.x + Math.cos(sp.rot) * dir + Math.sin(sp.rot) * (hash(seed, 19 + q) - 0.5) * 8;
            const nz = sp.z - Math.sin(sp.rot) * dir + Math.cos(sp.rot) * (hash(seed, 19 + q) - 0.5) * 8;
            const nb = tryAt(nx, nz, seed + 1000 * (q + 1), 20, 25, null, z);
            if (!nb) continue;
            this.spots.push(nb);
            placed++;
            trees.clear(nb.x, nb.z, 12.5);
          }
          break;
        }
      }
    }
    this.refit();
  }

  /** nach dem Hinzufügen von außen (Dörfer): Gruppen groß genug, Stufen neu verteilen */
  refit() {
    const n = [0, 0, 0];
    for (const s of this.spots) n[s.kind ?? 0]++;
    const cap = this.groups[0]?.[0]?.[0] ? this.groups.map((k) => k[0][0].data.length / STRIDE) : [0, 0, 0];
    if (n.some((c, k) => c > cap[k])) this.buildGroups();
    this.at.set(1e9, 0, 0);
  }

  /** Streaming: Häuser hinter dem Fahrer abbauen (Strecke vor z0 und nach z1 bleibt) */
  prune(keep: (at: number) => boolean) {
    const n = this.spots.length;
    this.spots = this.spots.filter((s) => keep(s.at));
    if (this.spots.length !== n) this.at.set(1e9, 0, 0);
  }

  private buildGroups(force = false) {
    const n = this.spots.length;
    if (!n && !force) return;
    for (const k of this.groups) for (const l of k) for (const g of l) disposeGroup(g);
    this.groups = [];
    this.cap = Math.max(16, Math.ceil(n * 1.5));
    const cnt = [0, 0, 0];
    for (const s of this.spots) cnt[s.kind ?? 0]++;
    const capK = [this.cap, Math.max(8, Math.ceil(cnt[1] * 1.5)), Math.max(4, Math.ceil(cnt[2] * 1.5))];
    // die Gruppen enthalten alle Häuser der gebauten Strecke: kein Wegschneiden als Ganzes
    const sphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    for (let kind = 0; kind < KINDS; kind++) {
      const lv: InstGroup[][] = [[], [], []];
      // Kirchen und Stadel sind selten: kleinere Gruppen
      const cap = capK[kind];
      for (let lod = 0; lod < 3; lod++) {
        for (const m of HMATS) {
          const g = instGroup(this.geos[kind][lod][m], this.mats[m], cap, sphere);
          g.mesh.frustumCulled = false;
          this.group.add(g.mesh);
          lv[lod].push(g);
        }
      }
      this.groups.push(lv);
    }
  }

  /** Stufen nach Abstand verteilen (neu, wenn die Kamera 6 m weiter ist) */
  private dirAt = new THREE.Vector2(0, 0);
  /**
   * dir: Blickrichtung der Kamera – Häuser weit hinter der Kamera fallen weg (neu verteilt, wenn sich die Kamera
   * um mehr als ~10° dreht)
   */
  update(cam: THREE.Vector3, force = false, dir?: THREE.Vector3, camera?: THREE.PerspectiveCamera) {
    let dx = 0, dz = 0;
    if (dir) { const l = Math.hypot(dir.x, dir.z) || 1; dx = dir.x / l; dz = dir.z / l; }
    const turned = !!dir && dx * this.dirAt.x + dz * this.dirAt.y < 0.985;
    if (!this.spots.length || (!force && !turned && this.at.distanceToSquared(cam) < 36)) return;
    this.at.copy(cam);
    this.dirAt.set(dx, dz);
    const view = camera ? viewTest(camera, 1.35) : null;
    const cnt = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const put = (lod: number, s: Spot) => {
      // während addRange noch baut (es gibt zwischendurch ab), kann es mehr Häuser als Platz geben – die neuen,
      // fernen kommen dann erst mit den größeren Gruppen am Ende dazu
      const k = s.kind ?? 0;
      const gs = this.groups[k][lod];
      const i = cnt[k][lod];
      if (i * STRIDE >= gs[0].data.length) return;
      cnt[k][lod] = i + 1;
      const sh = SHUTTERS[s.shut];
      const big = s.kind === KIND.church ? 4 : 0;
      for (const g of gs) g.data.set([s.x, s.y, s.z, s.rot, s.sx ?? 1, s.sy ?? 1, s.sz ?? 1, s.tone, sh[0], sh[1], sh[2], lod + big], i * STRIDE);
    };
    for (const s of this.spots) {
      const d = Math.hypot(s.x - cam.x, s.z - cam.z);
      // weit hinter der Kamera: nicht zeichnen
      if (dir && d > 45 && (s.x - cam.x) * dx + (s.z - cam.z) * dz < -0.3 * d) continue;
      // neben dem Bildausschnitt (mit Rand fürs Drehen bis zum nächsten Mal): nicht zeichnen
      if (view && !view(s.x, s.y + 6, s.z, s.kind === KIND.church ? 24 : 13)) continue;
      // Kirchen (groß, hoch) erst später in die gröbere Stufe
      const f = s.kind === KIND.church ? BIG : 1;
      // im Überblendband in beide Stufen
      if (d < (B0[0] + B0[1]) * f + MARGIN) put(0, s);
      if (d > (B0[0] - B0[1]) * f - MARGIN && d < (B1[0] + B1[1]) * f + MARGIN) put(1, s);
      if (d > (B1[0] - B1[1]) * f - MARGIN) put(2, s);
    }
    for (let k = 0; k < KINDS; k++) for (let lod = 0; lod < 3; lod++) for (const g of this.groups[k][lod]) commit(g, cnt[k][lod]);
  }

  /** Vorwärmen: beide Stufen einmal zeichnen lassen */
  warm(on: boolean) {
    // noch keine Häuser (Start ohne Dorf): Gruppen trotzdem anlegen, damit ihre Shader jetzt übersetzt werden
    if (on && !this.groups[0]?.length) this.buildGroups(true);
    for (const k of this.groups) for (const l of k) for (const g of l) {
      if (on) { g.geo.instanceCount = Math.max(1, g.geo.instanceCount); g.mesh.visible = true; }
    }
    if (!on) this.at.set(1e9, 0, 0);
  }

  dispose() {
    for (const k of this.groups) for (const l of k) for (const g of l) disposeGroup(g);
    for (const k of this.geos) for (const geo of k) for (const m of HMATS) geo[m].dispose();
    for (const m of HMATS) this.mats[m].dispose();
  }
}
