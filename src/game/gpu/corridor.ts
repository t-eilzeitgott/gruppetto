/**
 * Straße und Nahbereich für den WebGPU-Test: Fahrbahn, Markierungen, Bankett, Querprofil bis zum Rand des
 * Korridors (dahinter beginnt die Landschaft), Leitplanken, Mauern, Zäune, Banden, Leitpfosten.
 *
 * Das Querprofil ist dasselbe wie im Spiel (render3d: rawProfile) – Höhen und Abstände gleich, damit die
 * Landschaft am Korridorrand anschließt. Statt Farben trägt jede Ecke Gewichte für die Oberflächen
 * (Wiese, Waldboden, Fels, Schnee, Kies, Beton) und die Farbe der Gegend.
 */
import * as THREE from 'three/webgpu';
import { EDGE, ROAD_HALF, SEG, type Seg, type Side, type Track } from '../abfahrt/track';
import type { Terrain } from '../abfahrt/terrain3d';
import { BIOME_PALETTES } from '../abfahrt/palette';
import { lin255 } from '../abfahrt/models3d';
import { adCell, AD_COUNT } from '../abfahrt/tex3d';
import type { Tuft } from './grass';

/** Abschnitt = so viele Segmente (64 m) */
export const CHUNK = 32;

const hash = (n: number) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};
const wallSetback = (w: number, snow: boolean) => (snow ? 0.55 : 0.4) + w * 0.3;

interface Row { x: number; y: number; z: number; rx: number; rz: number; th: number; seg: Seg }

/** Oberfläche eines Profilpunkts */
type Surf = 'grass' | 'forest' | 'rock' | 'snow' | 'gravel' | 'concrete' | 'stone';

/** Gewichte (Wald, Fels, Schnee, Kies) und (Beton) je Oberfläche */
const W: Record<Surf, [number, number, number, number, number]> = {
  grass: [0, 0, 0, 0, 0],
  // Waldboden am Straßenrand: eher Wiese im Schatten (die Bäume stehen erst hinter dem Korridor)
  forest: [0.35, 0, 0, 0, 0],
  rock: [0, 1, 0, 0, 0],
  snow: [0, 0, 1, 0, 0],
  gravel: [0, 0, 0, 1, 0],
  concrete: [0, 0, 0, 0, 1],
  stone: [0, 1, 0, 0, 0],
};

const groundSurf = (g: Side['ground']): Surf =>
  g === 'forest' ? 'forest' : g === 'rock' ? 'rock' : g === 'snow' ? 'snow' : g === 'pavement' ? 'concrete' : g === 'water' ? 'gravel' : 'grass';

interface Profile { o: number[]; h: number[]; s: Surf[] }

export interface CorridorMats {
  road: THREE.Material; marks: THREE.Material; sides: THREE.Material; metal: THREE.Material; wood: THREE.Material;
  paint: THREE.Material; ads: THREE.Material | null;
}

/** Gitter-Baukasten: Ecken mit Normalen aus den Flächen (geteilte Ecken = weiche Übergänge) */
class Grid {
  pos: number[] = [];
  col: number[] = [];
  w: number[] = [];
  c: number[] = [];
  uv: number[] = [];
  t: number[] = [];
  idx: number[] = [];
  vert(p: number[], col?: number[], w?: number[], c?: number[], uv?: number[], t?: number[]) {
    this.pos.push(p[0], p[1], p[2]);
    if (col) this.col.push(col[0], col[1], col[2]);
    if (w) this.w.push(w[0], w[1], w[2], w[3]);
    if (c) this.c.push(c[0], c[1], c[2], c[3]);
    if (uv) this.uv.push(uv[0], uv[1]);
    if (t) this.t.push(t[0], t[1], t[2], t[3]);
    return this.pos.length / 3 - 1;
  }
  quad(a: number, b: number, c: number, d: number) { this.idx.push(a, b, c, a, c, d); }
  build(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.w.length) g.setAttribute('aW', new THREE.Float32BufferAttribute(this.w, 4));
    if (this.c.length) g.setAttribute('aC', new THREE.Float32BufferAttribute(this.c, 4));
    if (this.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.t.length) g.setAttribute('aT', new THREE.Float32BufferAttribute(this.t, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** einfache Kisten mit Eckpunktfarbe (Pfosten, Planken, Latten) */
export class Boxes {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  /** Bodengewichte (für Mauern im Material des Straßenrands): Fels mit Steinfarbe */
  stone = false;
  /** Viereck mit Normale aus der Fläche */
  quad(a: number[], b: number[], c: number[], d: number[], col: number[], uv?: number[][]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const tri = [a, b, c, a, c, d];
    const tuv = uv ? [uv[0], uv[1], uv[2], uv[0], uv[2], uv[3]] : null;
    tri.forEach((p, k) => {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(col[0], col[1], col[2]);
      if (tuv) this.uv.push(tuv[k][0], tuv[k][1]); else this.uv.push(0, 0);
    });
  }
  build(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.stone) {
      // Fels-Gewicht, Steinfarbe aus der Eckpunktfarbe
      const n = this.pos.length / 3;
      const w = new Float32Array(n * 4);
      const c = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        w[i * 4 + 1] = 1;
        c[i * 4 + 1] = this.col[i * 3]; c[i * 4 + 2] = this.col[i * 3 + 1]; c[i * 4 + 3] = this.col[i * 3 + 2];
      }
      g.setAttribute('aW', new THREE.BufferAttribute(w, 4));
      g.setAttribute('aC', new THREE.BufferAttribute(c, 4));
    }
    g.computeBoundingSphere();
    return g;
  }
}

interface Builders { road: Grid; marks: Boxes; sides: Grid; metal: Boxes; wood: Boxes; paint: Boxes; ads: Boxes; stone: Boxes }

export class Corridor {
  readonly group = new THREE.Group();
  private rowCache = new Map<number, Row>();
  private w = { x: 0, y: 0, z: 0, th: 0 };

  /** fertige Grasbüschel eines Abschnitts (Grashalme am Rand) */
  onTufts: ((t: Tuft[]) => void) | null = null;
  /** Prüfhilfe: woran buildRange gerade arbeitet */
  phase = '';

  constructor(private track: Track, private terrain: Terrain, private mats: CorridorMats) {}

  private row(i: number): Row {
    let r = this.rowCache.get(i);
    if (!r) {
      const s = this.track.seg(i);
      const w = this.track.world(i * SEG, 0, 0, this.w);
      r = { x: w.x, y: w.y, z: w.z, rx: Math.cos(w.th), rz: Math.sin(w.th), th: w.th, seg: s };
      this.rowCache.set(i, r);
    }
    return r;
  }

  private P(r: Row, x: number, h: number): number[] { return [r.x + r.rx * x, r.y + h, r.z + r.rz * x]; }

  /** Höhe des Straßenrands (über der Fahrbahn) in Abstand dx von der Bankettkante – dort stehen die Zuschauer */
  edgeHeight(s: Seg, sg: number, dx: number): number {
    const side = sg < 0 ? s.L : s.R;
    const pr = this.profile(side, s, sg, this.terrain.lim(s.i)[sg < 0 ? 0 : 1]);
    const o = pr.o;
    for (let k = 0; k < o.length - 1; k++) {
      if (dx <= o[k + 1]) return pr.h[k] + (pr.h[k + 1] - pr.h[k]) * Math.max(0, Math.min(1, (dx - o[k]) / Math.max(1e-6, o[k + 1] - o[k])));
    }
    return pr.h[pr.h.length - 1];
  }

  /** wie edgeHeight, aber null jenseits des Profils (dort steht das Gelände) – für Häuser und Gehsteig-Dinge */
  groundAt(s: Seg, sg: number, dx: number): number | null {
    const side = sg < 0 ? s.L : s.R;
    const pr = this.profile(side, s, sg, this.terrain.lim(s.i)[sg < 0 ? 0 : 1]);
    if (dx > pr.o[pr.o.length - 1] + 0.5) return null;
    return this.edgeHeight(s, sg, dx);
  }

  /** Querprofil wie im Spiel (Höhen, Abstände ab Bankettkante), am Korridorrand abgeschnitten */
  private profile(side: Side, s: Seg, sg: number, lim: number): Profile {
    const pr = this.rawProfile(side, s, sg);
    const maxO = Math.max(1.5, lim - EDGE);
    for (let k = 1; k < pr.o.length; k++) {
      if (pr.o[k] <= maxO) continue;
      const t = (maxO - pr.o[k - 1]) / Math.max(1e-6, pr.o[k] - pr.o[k - 1]);
      const h = pr.h[k - 1] + (pr.h[k] - pr.h[k - 1]) * Math.max(0, Math.min(1, t));
      for (let q = k; q < pr.o.length; q++) { pr.o[q] = maxO; pr.h[q] = h; }
      break;
    }
    return pr;
  }

  private rawProfile(side: Side, s: Seg, sg: number): Profile {
    const n = (k: number) => {
      const f = s.i / 9;
      const i0 = Math.floor(f);
      let tt = f - i0;
      tt = tt * tt * (3 - 2 * tt);
      const h0 = hash(i0 * 7919 + k * 131 + (sg > 0 ? 17 : 0));
      const h1 = hash((i0 + 1) * 7919 + k * 131 + (sg > 0 ? 17 : 0));
      return h0 + (h1 - h0) * tt - 0.5;
    };
    const g = groundSurf(side.ground);
    if (side.ground === 'water') {
      const lr = Math.min(-1.3, this.terrain.lakeOf(s.sec) - s.y);
      const m = Math.max(lr + 0.3, -1.2);
      const k = Math.max(1, -lr / 5);
      const h5 = (m + lr - 0.8) / 2;
      return {
        o: [0, 0.2, 0.4, 1.2, 2, 2 + 2 * k, 2 + 4 * k, 8 + 4 * k, 16 + 4 * k],
        h: [0, -0.22, -0.45, (-0.45 + m) / 2, m, h5, lr - 0.8, lr - 2.6, lr - 4.5],
        s: ['gravel', 'gravel', 'gravel', 'gravel', 'rock', 'rock', 'gravel', 'gravel', 'gravel'],
      };
    }
    if (side.wall > 0 && side.stone) {
      const Wh = side.wall;
      const top = groundSurf(side.ground === 'rock' ? 'meadow' : side.ground);
      const o = [0, 0.025, 0.05, 0.07, 0.075, 0.48, 2.2, 9, 30];
      const h = [0, Wh * 0.4, Wh * 0.75, Wh, Wh + 0.13, Wh + 0.13, 0, 0, 0];
      for (let k = 6; k < 9; k++) h[k] = Wh + 0.13 + side.tilt * (o[k] - 0.48) + (k === 6 ? n(1) * 0.3 : 0);
      return { o, h, s: ['stone', 'stone', 'stone', 'stone', 'concrete', 'concrete', top, top, top] };
    }
    if (side.wall > 0) {
      const Wh = side.wall;
      const snow = side.ground === 'snow';
      const top = groundSurf(side.ground === 'rock' ? 'meadow' : side.ground);
      const j = (k: number, amp: number) => n(k + 60) * amp;
      const d = wallSetback(Wh, snow);
      const o = [0, d * 0.22 + j(1, 0.2 + d * 0.1), d * 0.5 + j(2, 0.25 + d * 0.12), d * 0.78 + j(3, 0.2 + d * 0.1), d, d + 1.4, d + 6, d + 15, d + 29];
      for (let k = 1; k < 4; k++) o[k] = Math.max(o[k - 1] + 0.01, Math.min(d - 0.01 * (4 - k), o[k]));
      const crest = Wh + 0.5;
      const h = [0, Wh * (0.3 + j(4, 0.06)), Wh * (0.58 + j(5, 0.06)), Wh * (0.82 + j(6, 0.05)), Wh,
        crest, crest + side.tilt * 4.6 + n(1) * 0.4, crest + side.tilt * 13.6, crest + side.tilt * 27.6];
      // die Wand selbst ist Fels (Schnee hält sich nur oben auf der Kante)
      const lip: Surf = snow ? 'snow' : 'rock';
      return { o, h, s: ['rock', 'rock', 'rock', 'rock', lip, top, top, top, top] };
    }
    if (side.drop) {
      const k = Math.max(0.6, -side.tilt);
      return {
        o: [0, 0.3, 0.6, 0.9, 1.9, 3, 7, 12, 18],
        h: [0, -0.17 * k, -0.33 * k, -0.5 * k, -1.7 * k, -3 * k, -8 * k + n(1) * 0.5, -16 * k, -26 * k],
        s: [g, g, g, g, g, g, 'rock', 'rock', 'rock'],
      };
    }
    if (side.ground === 'pavement') {
      return {
        o: [0, 0.01, 0.02, 1.2, 3.5, 8, 18, 26, 34],
        h: [0, 0.07, 0.13, 0.13, 0.13, 0.4, 1.5, 2.2, 3],
        s: ['concrete', 'concrete', 'concrete', 'concrete', 'grass', 'grass', 'grass', 'grass', 'grass'],
      };
    }
    const tl = side.tilt;
    if (tl > 0.08 && !side.drop && side.ground !== 'snow') {
      // Bergseite: Betonrinne am Bankett, dahinter der Hang
      const o = [0, 0.2, 0.42, 0.62, 1.5, 5, 11, 20, 34];
      const h = [0, -0.11, -0.1, 0.04, tl * 1.4, tl * 5, tl * 11, tl * 20, tl * 34];
      h[5] += n(1) * 0.25;
      h[6] += n(2) * 0.35;
      return { o, h, s: ['concrete', 'concrete', 'concrete', g, g, g, g, g, g] };
    }
    const o = [0, 0.375, 0.75, 1.125, 1.5, 5, 11, 20, 34];
    const h = o.map((x) => tl * x);
    h[5] += n(1) * 0.25;
    h[6] += n(2) * 0.35;
    return { o, h, s: [g, g, g, g, g, g, g, g, g] };
  }

  /** Farbe der Gegend (Wiese) und des Felses an einem Segment, wie im Spiel */
  private tints(s: Seg, side: Side, k: number, sg: number): { grass: number[]; rock: number[] } {
    const pal = BIOME_PALETTES[this.track.sections[s.sec].biome];
    const g = side.ground === 'rock' || side.ground === 'water' || side.ground === 'pavement' ? 'meadow' : side.ground;
    const base = pal.ground[g][0];
    const v = 0.92 + (hash(s.i * 31 + k * 7 + (sg > 0 ? 3 : 0)) - 0.5) * 0.12;
    const c = lin255(base[0], base[1], base[2]);
    const r = lin255(pal.rock[0], pal.rock[1], pal.rock[2]);
    return { grass: [c[0] * v, c[1] * v, c[2] * v], rock: [r[0], r[1], r[2]] };
  }

  /**
   * alle Abschnitte zwischen den Segmenten i0 und i1 bauen – je Gruppe von acht Abschnitten (512 m) ein Netz je
   * Material: wenige Zeichenaufrufe (die Kosten je Aufruf zählen bei 120 Bildern/s), trotzdem grob ausgesondert
   */
  build(i0: number, i1: number) {
    const GROUP = CHUNK * 8;
    for (let g0 = i0; g0 < i1; g0 += GROUP) {
      const it = this.buildRange(g0, Math.min(i1, g0 + GROUP));
      let r = it.next();
      while (!r.done) r = it.next();
      this.group.add(r.value);
    }
  }

  /**
   * Streaming: einen Bereich als eigene Gruppe bauen (ein Netz je Material), in Schritten je Abschnitt (64 m) –
   * zwischen den Schritten gibt der Bau die Kontrolle ab. Tunnelsegmente bleiben aus (die baut tunnel.ts).
   */
  *buildRange(i0: number, i1: number): Generator<void, THREE.Group, void> {
    const B: Builders = { road: new Grid(), marks: new Boxes(), sides: new Grid(), metal: new Boxes(), wood: new Boxes(), paint: new Boxes(), ads: new Boxes(), stone: new Boxes() };
    B.stone.stone = true;
    for (let c0 = i0; c0 < i1; c0 += CHUNK) {
      yield* this.chunk(c0, Math.min(i1, c0 + CHUNK), B);
      yield;
    }
    const out = new THREE.Group();
    const add = (g: THREE.BufferGeometry | null, m: THREE.Material | null, cast: boolean, order = 0) => {
      if (!g || !m) return;
      const mesh = new THREE.Mesh(g, m);
      mesh.receiveShadow = true;
      mesh.castShadow = cast;
      mesh.renderOrder = order;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      out.add(mesh);
    };
    this.phase = 'netz:fahrbahn';
    add(B.road.build(), this.mats.road, false);
    add(B.marks.build(), this.mats.marks, false, 1);
    yield;
    this.phase = 'netz:rand';
    add(B.sides.build(), this.mats.sides, false);
    yield;
    this.phase = 'netz:rest';
    add(B.metal.build(), this.mats.metal, true);
    add(B.wood.build(), this.mats.wood, true);
    add(B.paint.build(), this.mats.paint, true);
    add(B.ads.build(), this.mats.ads, true);
    add(B.stone.build(), this.mats.sides, true);
    // die Zeilen dieses Bereichs braucht später niemand mehr
    for (let i = i0; i <= i1; i++) this.rowCache.delete(i);
    return out;
  }

  private *chunk(a0: number, a1: number, B: Builders): Generator<void, void, void> {
    // Tunnelsegmente auslassen: den Abschnitt an ihnen in Stücke teilen (die Röhre baut tunnel.ts)
    let i = a0;
    while (i < a1) {
      while (i < a1 && this.track.seg(i).tunnel) i++;
      if (i >= a1) break;
      let j = i;
      while (j < a1 && !this.track.seg(j).tunnel) j++;
      if (j > i) yield* this.span(i, j, B);
      i = j;
    }
  }

  /** ein Stück Straße ohne Tunnel – in Schritten (Fahrbahn, Ränder, Begrenzungen, Gras) */
  private *span(a0: number, a1: number, B: Builders): Generator<void, void, void> {
    const { road, marks, sides, metal, wood, paint, ads, stone } = B;
    this.phase = 'fahrbahn';
    const rows: Row[] = [];
    for (let i = a0; i <= a1; i++) rows.push(this.row(i));
    // --- Fahrbahn: drei Spalten (für die Normalen), u quer 0 … 1, v längs (5,6-m-Kachel)
    const RW = 2 * ROAD_HALF;
    const rIdx: number[][] = [];
    for (const r of rows) {
      const fx = Math.sin(r.th), fz = -Math.cos(r.th);
      const t = [r.rx, r.rz, fx, fz];
      const v = (r.seg.i * SEG) / RW;
      rIdx.push([-ROAD_HALF, 0, ROAD_HALF].map((x) => road.vert(this.P(r, x, 0), undefined, undefined, undefined, [(x + ROAD_HALF) / RW, v], t)));
    }
    for (let k = 0; k < rows.length - 1; k++) {
      for (let c = 0; c < 2; c++) road.quad(rIdx[k][c], rIdx[k][c + 1], rIdx[k + 1][c + 1], rIdx[k + 1][c]);
    }
    // --- Markierungen: Randlinien, Mittellinie (in Kurven doppelt durchgezogen)
    const H = 0.014;
    const white = [0.82, 0.82, 0.8];
    for (let k = 0; k < rows.length - 1; k++) {
      const a = rows[k];
      const b = rows[k + 1];
      const s = a.seg;
      const strip = (x0: number, x1: number) => {
        const u = (x: number) => (x + ROAD_HALF) / RW;
        marks.quad(this.P(a, x0, H), this.P(a, x1, H), this.P(b, x1, H), this.P(b, x0, H), white,
          [[u(x0), (s.i * SEG) / RW], [u(x1), (s.i * SEG) / RW], [u(x1), ((s.i + 1) * SEG) / RW], [u(x0), ((s.i + 1) * SEG) / RW]]);
      };
      strip(-ROAD_HALF + 0.08, -ROAD_HALF + 0.2);
      strip(ROAD_HALF - 0.2, ROAD_HALF - 0.08);
      if (Math.abs(s.curve) > 0.015 || s.hairpin) { strip(-0.17, -0.06); strip(0.06, 0.17); }
      else if ((s.i & 3) < 2) strip(-0.06, 0.06);
    }
    yield;
    // --- Ränder: Bankett (Kies), Querprofil, Schürze
    for (const sg of [-1, 1]) {
      this.phase = 'rand';
      const cols: number[][] = [];
      for (const r of rows) {
        const s = r.seg;
        const side = sg < 0 ? s.L : s.R;
        const lim = this.terrain.lim(s.i)[sg < 0 ? 0 : 1];
        const pr = this.profile(side, s, sg, lim);
        const ids: number[] = [];
        const tn = this.tints(s, side, 0, sg);
        const c = [0, tn.rock[0], tn.rock[1], tn.rock[2]];
        const add = (x: number, h: number, surf: Surf, k: number) => {
          const ww = W[surf];
          const tint = this.tints(s, side, k, sg).grass;
          const cc = surf === 'stone' ? [ww[4], 0.36, 0.34, 0.31] : [ww[4], c[1], c[2], c[3]];
          ids.push(sides.vert(this.P(r, sg * x, h), tint, [ww[0], ww[1], ww[2], ww[3]], cc));
        };
        add(ROAD_HALF, 0, 'gravel', 0);
        add(EDGE, -0.04, 'gravel', 0);
        for (let k = 0; k < pr.o.length; k++) add(EDGE + pr.o[k], pr.h[k] - 0.04, pr.s[k], k);
        const last = pr.o.length - 1;
        add(EDGE + pr.o[last], pr.h[last] - 3.2, pr.s[last], last);
        cols.push(ids);
      }
      for (let k = 0; k < rows.length - 1; k++) {
        const A = cols[k];
        const B = cols[k + 1];
        for (let q = 0; q < A.length - 1; q++) {
          // Flächen nach oben (rechts laufen die Spalten nach +x, links nach −x)
          if (sg > 0) sides.quad(A[q], A[q + 1], B[q + 1], B[q]);
          else sides.quad(A[q], B[q], B[q + 1], A[q + 1]);
        }
      }
      yield;
    }
    yield;
    this.phase = 'begrenzung';
    // --- Begrenzungen
    for (let k = 0; k < rows.length - 1; k++) this.barriers(rows[k], rows[k + 1], metal, wood, paint, ads, stone);
    yield;
    this.phase = 'gras';
    // --- Grasbüschel auf den Wiesenstücken des Profils (nicht auf Fels, Schnee, Kies, Beton)
    if (this.onTufts) this.onTufts(this.tufts(rows));
  }

  private tufts(rows: Row[]): Tuft[] {
    const out: Tuft[] = [];
    let seed = rows[0].seg.i * 977;
    const r = () => {
      seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) | 0;
      return ((seed ^ (seed >>> 13)) >>> 0) / 4294967296;
    };
    for (let k = 0; k < rows.length - 1; k++) {
      const a = rows[k];
      const b = rows[k + 1];
      const s = a.seg;
      if (s.crowd || s.tunnel || s.bridge > 0) continue;
      for (const sg of [-1, 1]) {
        const side = sg < 0 ? s.L : s.R;
        const lim = this.terrain.lim(s.i)[sg < 0 ? 0 : 1];
        const pr = this.profile(side, s, sg, lim);
        const tint = this.tints(s, side, 2, sg).grass;
        const maxO = Math.min(pr.o[pr.o.length - 1], 5);
        // Dichte: ~4,5 Büschel je m² (am Bankett dichter)
        const n = Math.round(maxO * SEG * 3.2);
        for (let q = 0; q < n; q++) {
          const o = 0.25 + Math.pow(r(), 1.3) * (maxO - 0.25);
          let j = 0;
          while (j < pr.o.length - 2 && pr.o[j + 1] < o) j++;
          const sa = pr.s[j];
          const sb = pr.s[j + 1];
          if ((sa !== 'grass' && sa !== 'forest') || (sb !== 'grass' && sb !== 'forest')) continue;
          if (sa === 'forest' && r() < 0.6) continue;
          const t = Math.max(0, Math.min(1, (o - pr.o[j]) / Math.max(1e-6, pr.o[j + 1] - pr.o[j])));
          const h = pr.h[j] + (pr.h[j + 1] - pr.h[j]) * t - 0.05;
          const u = r();
          const row: Row = { ...a, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u, rx: a.rx + (b.rx - a.rx) * u, rz: a.rz + (b.rz - a.rz) * u };
          const p = this.P(row, sg * (EDGE + o), h);
          const v = 0.8 + r() * 0.4;
          out.push({ x: p[0], y: p[1], z: p[2], rot: r() * Math.PI * 2, s: 0.75 + r() * 0.6, r: tint[0] * v, g: tint[1] * v, b: tint[2] * v * 0.9 });
        }
      }
    }
    return out;
  }

  /** Kiste quer zur Straße an Stelle (row, x), Höhe h0 … h1, Breite bx (quer), bz (längs) */
  private box(B: Boxes, r: Row, x: number, h0: number, h1: number, bx: number, bz: number, col: number[]) {
    const fx = Math.sin(r.th), fz = -Math.cos(r.th);
    const c = this.P(r, x, 0);
    const p = (dx: number, dz: number, h: number) => [c[0] + r.rx * dx + fx * dz, r.y + h, c[2] + r.rz * dx + fz * dz];
    const X = bx / 2, Z = bz / 2;
    const q = (a: number[], b: number[], cc: number[], d: number[]) => B.quad(a, b, cc, d, col);
    // vier Seiten und Deckel
    q(p(-X, -Z, h0), p(X, -Z, h0), p(X, -Z, h1), p(-X, -Z, h1));
    q(p(X, Z, h0), p(-X, Z, h0), p(-X, Z, h1), p(X, Z, h1));
    q(p(X, -Z, h0), p(X, Z, h0), p(X, Z, h1), p(X, -Z, h1));
    q(p(-X, Z, h0), p(-X, -Z, h0), p(-X, -Z, h1), p(-X, Z, h1));
    q(p(-X, -Z, h1), p(X, -Z, h1), p(X, Z, h1), p(-X, Z, h1));
  }

  private barriers(a: Row, b: Row, metal: Boxes, wood: Boxes, paint: Boxes, ads: Boxes, stone: Boxes) {
    const s = a.seg;
    const wall = (B: Boxes, x: number, h0: number, h1: number, col: number[], sg: number, uv?: number[][]) => {
      // zur Straße zeigende Seite, dazu die Rückseite
      const A0 = this.P(a, x, h0), B0 = this.P(b, x, h0), A1 = this.P(a, x, h1), B1 = this.P(b, x, h1);
      if (sg > 0) { B.quad(B0, A0, A1, B1, col, uv); B.quad(A0, B0, B1, A1, col, uv); } else { B.quad(A0, B0, B1, A1, col, uv); B.quad(B0, A0, A1, B1, col, uv); }
    };
    for (const sg of [-1, 1]) {
      const side = sg < 0 ? s.L : s.R;
      if (s.crowd) {
        // Bande: bedruckt zur Straße (Atlas der Werbebanden), Pfosten
        if (this.mats.ads) {
          const cell = Math.floor(hash(s.i * 2 + (sg > 0 ? 1 : 0)) * AD_COUNT);
          const [u0, v0, u1, v1] = adCell(cell, false);
          const x = sg * (EDGE - 0.07);
          const A0 = this.P(a, x, 0.17), B0 = this.P(b, x, 0.17), A1 = this.P(a, x, 0.93), B1 = this.P(b, x, 0.93);
          if (sg > 0) ads.quad(B0, A0, A1, B1, [1, 1, 1], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
          else ads.quad(A0, B0, B1, A1, [1, 1, 1], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
        }
        if ((s.i & 1) === 0) this.box(metal, a, sg * (EDGE - 0.03), 0, 1.05, 0.05, 0.05, [0.5, 0.52, 0.55]);
        wall(metal, sg * (EDGE - 0.04), 0.95, 1.05, [0.75, 0.77, 0.8], sg);
        continue;
      }
      if (side.wall > 0) continue;
      if (side.barrier === 'none' && side.ground !== 'water' && side.ground !== 'pavement' && (s.i + (sg > 0 ? 0 : 12)) % 25 === 0) {
        // Leitpfosten: weiß mit schwarzem Band und Rückstrahler
        const x = sg * (EDGE + 0.1);
        this.box(paint, a, x, 0, 1.0, 0.1, 0.12, [0.85, 0.85, 0.83]);
        this.box(paint, a, x, 0.58, 0.7, 0.112, 0.132, [0.02, 0.02, 0.02]);
        this.box(paint, a, x, 0.82, 0.92, 0.115, 0.05, [0.9, 0.35, 0.03]);
      }
      if (side.barrier === 'rail') {
        // Leitplanke (verzinkt): drei Bänder zur Straße und zurück, Pfosten alle 2 m
        const x = sg * (EDGE - 0.12);
        wall(metal, x, 0.46, 0.56, [0.55, 0.57, 0.6], sg);
        wall(metal, x - sg * 0.035, 0.56, 0.68, [0.7, 0.72, 0.75], sg);
        wall(metal, x, 0.68, 0.74, [0.6, 0.62, 0.65], sg);
        if ((s.i & 1) === 0) this.box(metal, a, sg * (EDGE - 0.02), -0.2, 0.72, 0.08, 0.06, [0.42, 0.44, 0.47]);
      } else if (side.barrier === 'stone') {
        // niedrige Natursteinmauer
        const v = 0.85 + hash(s.i * 3 + sg) * 0.2;
        const st = [0.36 * v, 0.34 * v, 0.31 * v];
        const ht = s.bridge > 0 ? 0.95 : 0.62;
        wall(stone, sg * (EDGE - 0.08), -0.1, ht, st, sg);
        wall(stone, sg * (EDGE + 0.32), -0.1, ht, st, -sg);
        const A = this.P(a, sg * (EDGE - 0.08), ht), B = this.P(b, sg * (EDGE - 0.08), ht), C = this.P(b, sg * (EDGE + 0.32), ht), D = this.P(a, sg * (EDGE + 0.32), ht);
        if (sg > 0) stone.quad(A, D, C, B, [0.45 * v, 0.43 * v, 0.4 * v]); else stone.quad(D, A, B, C, [0.45 * v, 0.43 * v, 0.4 * v]);
      } else if (side.barrier === 'fence') {
        const brown = [0.16, 0.1, 0.055];
        wall(wood, sg * (EDGE + 0.15), 0.55, 0.63, brown, sg);
        wall(wood, sg * (EDGE + 0.15), 0.92, 1.0, brown, sg);
        if (s.i % 2 === 0) this.box(wood, a, sg * (EDGE + 0.15), -0.1, 1.08, 0.1, 0.1, [0.13, 0.085, 0.05]);
      }
    }
  }

  dispose() {
    this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
  }
}
