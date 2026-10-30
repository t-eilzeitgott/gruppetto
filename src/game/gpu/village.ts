/**
 * Dörfer an der Strecke (WebGPU): statt einzelner Höfe ein ganzes Dorf – Häuserzeile beidseitig an der Straße
 * (Giebel zur Straße, verschieden groß, ab und zu ein Gasthof), dahinter eine zweite Reihe mit Stadeln, in der
 * Mitte die Kirche mit Zwiebelturm und davor der Dorfplatz mit Holzbrunnen, Maibaum, Linden und Bänken. Laternen
 * entlang der Dorfstraße (leuchten abends, Lichtkegel auf dem Boden), Kreuzzäune vor den Gärten, Wegkreuz und
 * Ortsschild am Eingang. Ein Dorf gleich nach dem Start, danach etwa alle zwei bis drei Kilometer, wo die Straße
 * gerade genug ist (keine Kehre, kein Tunnel, keine Ortsdurchfahrt).
 *
 * Planen (Gelände abfragen) in Schritten beim ersten Abschnitt, der das Dorf berührt; gebaut wird je Abschnitt
 * nur sein Teil (Häuser als Instanzen in Houses, Kleinteile als ein Netz je Abschnitt).
 */
import * as THREE from 'three/webgpu';
import { EDGE, SEG, type Seg, type Track } from '../abfahrt/track';
import type { Terrain, TreeSpot } from '../abfahrt/terrain3d';
import { GB, lin, type RGBf } from '../abfahrt/models3d';
import { buildGeo } from './town';
import { lampHalos } from './lamps';
import { KIND, type Houses, type Spot } from './houses';
import type { Trees } from './trees';

const hash = (a: number, b: number) => {
  let x = Math.imul(a ^ 0x27d4eb2d, 0x9e3779b1) ^ Math.imul(b ^ 0x165667b1, 0x85ebca77);
  x ^= x >>> 15;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
};

const NAMES: Record<string, string[]> = {
  it: ['San Martino', 'Santa Maria', 'Pian del Re', 'Villanova', 'Colle Alto', "Sant'Anna", 'Pradello', 'Fontanella', 'San Rocco', 'Valdora', 'Prato Lungo', 'San Leonardo'],
  fr: ['Saint-Martin', 'Le Villard', 'Les Granges', 'La Chapelle', 'Saint-Roch', 'Le Planay', 'Les Chalets', 'Sainte-Anne', 'Le Bourget', 'Les Prés'],
  es: ['San Martín', 'Villanueva', 'Santa María', 'Casas del Puerto', 'La Ermita', 'Prado Alto', 'San Roque', 'Fuentefría'],
  en: ['St. Martin', 'Oberdorf', 'Unterau', 'Kirchbichl', 'Hinterberg', 'Mühlbach', 'Sankt Anna', 'Wiesing', 'Lärchwald', 'Brunnhof'],
};

/** Grundrisse (lokal, Giebel vorn bei +z) für die Hangprüfung */
const FOOT_HOUSE: [number, number][] = [[-5.95, -6.1], [5.95, -6.1], [5.95, 8.7], [-5.95, 8.7]];
const FOOT_BARN: [number, number][] = [[-5.3, -7.1], [5.3, -7.1], [5.3, 7.1], [-5.3, 7.1]];
const FOOT_CHURCH: [number, number][] = [[-5.4, -12], [9.6, -12], [9.6, 11.5], [-5.4, 11.5], [-12.4, -9], [-12.4, 7]];

/** Straßenrand im Dorf */
const VILLAGE_SIDE = { ground: 'meadow' as const, tilt: 0.06, barrier: 'none' as const, wall: 0, drop: false };

type PropKind = 'lamp' | 'fence' | 'fountain' | 'maypole' | 'bench' | 'cross' | 'woodpile';
interface Prop { k: PropKind; at: number; x: number; y: number; z: number; rot: number; pts?: number[]; seed: number }
interface Village {
  za: number; zb: number; seed: number; name: string;
  houses: Spot[]; props: Prop[]; trees: TreeSpot[];
  planned: boolean; signAt: number;
  /** Hülle (x0, z0, x1, z1) */
  box: [number, number, number, number];
  /** Grundrisse (x, z, Radius) */
  occ: number[];
}

export interface VillageCtx {
  track: Track;
  terrain: Terrain;
  houses: Houses;
  trees: Trees;
  /** Abstand zur Straße (alle Schenkel) */
  roadDist: (x: number, z: number) => number;
  /** Höhe des Straßenrands (über der Fahrbahn) in Abstand dx hinter der Bankettkante */
  ground: (s: Seg, sg: number, dx: number) => number | null;
  plate: (group: THREE.Group, i: number, x: number, h: number, text: string, sub: string, w?: number, posts?: boolean) => void;
  mat: THREE.Material;
}

export class Villages {
  private list: Village[] = [];
  private scanZ = 0;
  private started = false;
  private w = { x: 0, y: 0, z: 0, th: 0 };
  /** Lampen je Abschnitt (für die Bodenkarte) */
  private lights = new Map<number, number[]>();
  private nameNo = 0;

  constructor(private c: VillageCtx) {}

  /** Grundrisse aller geplanten Dörfer (x, z, Radius): dort keine einzelnen Höfe */
  get occ(): number[] { const o: number[] = []; for (const v of this.list) o.push(...v.occ); return o; }

  /** liegt (x, z) in einem Dorf (Hülle mit Rand)? */
  inside(x: number, z: number, m = 0): boolean {
    for (const v of this.list) if (x > v.box[0] - m && x < v.box[2] + m && z > v.box[1] - m && z < v.box[3] + m) return true;
    return false;
  }

  /** Abschnitt der Strecke frei für ein Dorf? */
  private freeAt(z: number): boolean {
    const t = this.c.track;
    const s = t.segAt(z);
    if (s.tunnel || s.bridge > 0 || s.hairpin > 0 || s.bL || s.bR || s.banner) return false;
    if (t.sections[s.sec]?.biome === 'village') return false;
    return true;
  }

  /** Dörfer bis zEnd suchen (gleich nach dem Start eines, dann alle 2–3 km eine freie, gerade Strecke) */
  private sites(zEnd: number) {
    const t = this.c.track;
    const L = (t.length - 2) * SEG - 300;
    if (!this.started) {
      this.started = true;
      // Startdorf: nicht, wo die Strecke schon in einem Ort beginnt (Zeitfahren)
      let ok = true;
      for (let z = 20; z < 320; z += 8) { const s = t.segAt(z); if (s.bL || s.bR || t.sections[s.sec]?.biome === 'village') ok = false; }
      if (ok) this.add(34, 330);
      this.scanZ = 1700;
    }
    while (this.scanZ < Math.min(zEnd, L)) {
      const z0 = this.scanZ;
      const len = 230 + Math.floor(hash(Math.round(z0), 3) * 80);
      let ok = true;
      for (let z = z0 - 40; z < z0 + len + 40 && ok; z += 8) if (!this.freeAt(z)) ok = false;
      // Straße nicht zu kurvig (Häuserzeile)
      if (ok) {
        let turn = 0;
        for (let z = z0; z < z0 + len; z += 8) turn += Math.abs(t.segAt(z).curve);
        if (turn / (len / 8) > 0.02) ok = false;
      }
      if (!ok) { this.scanZ += 24; continue; }
      this.add(z0, z0 + len);
      this.scanZ = z0 + len + 1900 + hash(Math.round(z0), 9) * 1300;
    }
  }

  private add(za: number, zb: number) {
    const t = this.c.track;
    const names = NAMES[t.lang] ?? NAMES.en;
    const seed = (Math.round(za) * 2654435761) >>> 0;
    const name = names[(Math.floor(hash(t.seed, 1) * names.length) + this.nameNo++) % names.length];
    this.list.push({ za, zb, seed, name, houses: [], props: [], trees: [], planned: false, signAt: za + 4, box: [0, 0, 0, 0], occ: [] });
    // Gelände beiderseits flacher (Terrassen statt Steilhang); an den Enden weich auslaufend
    const pts: number[] = [];
    const w = this.w;
    for (let at = za - 50; at <= zb + 50; at += 8) {
      t.world(at, 0, 0, w);
      const e = Math.min(1, Math.max(0, (at - (za - 50)) / 70), Math.max(0, (zb + 50 - at) / 70));
      pts.push(w.x, w.y - 0.6, w.z, e * e * (3 - 2 * e));
    }
    this.c.terrain.addFlat(pts, 100, 0.9);
    // Dorfstraße: Wiese bis ans Bankett, keine Mauern und Abgründe, schmaler Korridor (Häuser gleich dahinter)
    const i0 = Math.floor((za - 30) / SEG), i1 = Math.ceil((zb + 30) / SEG);
    this.sides(t, i0, i1);
    this.c.terrain.capLim(i0, i1, EDGE + 4.5);
    this.ranges.push([i0, i1]);
  }

  private ranges: [number, number][] = [];
  private patched = new WeakMap<Track, number>();
  private sides(t: Track, i0: number, i1: number) {
    for (let i = Math.max(t.first, i0); i <= i1; i++) {
      const s = t.seg(i);
      s.L = { ...VILLAGE_SIDE };
      s.R = { ...VILLAGE_SIDE };
    }
  }

  /** dieselben Seiten in einer anderen Kopie der Strecke (die Fahrphysik hat ihre eigene) */
  patch(t: Track) {
    const n = this.patched.get(t) ?? 0;
    for (let k = n; k < this.ranges.length; k++) this.sides(t, this.ranges[k][0], this.ranges[k][1]);
    this.patched.set(t, this.ranges.length);
  }

  /** Dörfer vorausplanen (das Gelände muss es wissen, bevor dort Kacheln entstehen) */
  ahead(zEnd: number) { this.sites(zEnd); }

  /** Höhe und Lage eines Grundrisses prüfen: null, wenn der Hang zu steil ist (Sockel gleicht maxD aus) */
  private fit(x: number, z: number, rot: number, foot: [number, number][], maxD: number): number | null {
    const g = this.c.terrain;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    let hi = -Infinity, lo = Infinity;
    for (const [lx, lz] of foot) {
      const y = g.groundAt(x + cs * lx + sn * lz, z - sn * lx + cs * lz);
      hi = Math.max(hi, y);
      lo = Math.min(lo, y);
    }
    return hi - lo > maxD ? null : hi - 0.3;
  }

  /** Dorf planen (Gelände abfragen; in Schritten) */
  private *plan(v: Village, late: () => boolean): Generator<void, void, void> {
    const { track: t, terrain, roadDist } = this.c;
    const w = this.w;
    const R = (k: number) => hash(v.seed, k);
    const latOf = (z: number, side: number) => Math.max(terrain.lim(t.segAt(z).i)[side < 0 ? 0 : 1], EDGE + 1.5);
    const facing = (x: number, z: number, at: number) => { t.world(at, 0, 0, w); return Math.atan2(w.x - x, w.z - z); };
    const taken: number[] = [];
    const free = (x: number, z: number, r: number) => {
      for (let k = 0; k < taken.length; k += 3) if ((taken[k] - x) ** 2 + (taken[k + 1] - z) ** 2 < (taken[k + 2] + r) ** 2) return false;
      return true;
    };
    const put = (sp: Spot, r: number) => { v.houses.push(sp); taken.push(sp.x, sp.z, r); v.occ.push(sp.x, sp.z, r); };
    const mid = (v.za + v.zb) / 2;
    // ——— Kirche mit Dorfplatz: auf der Seite, wo sie Platz hat ———
    let churchSide = 0, churchAt = mid;
    for (const side of R(2) < 0.5 ? [1, -1] : [-1, 1]) {
      for (const dz of [0, -18, 18, -34, 34]) {
        if (late()) yield;
        const at = mid + dz;
        const lat = latOf(at, side) + 25;
        t.world(at, side * lat, 0, w);
        const x = w.x, z = w.z;
        if (roadDist(x, z) < lat - 3) continue;
        const rot = facing(x, z, at) + (R(5) - 0.5) * 0.1;
        const y = this.fit(x, z, rot, FOOT_CHURCH, 8);
        if (y === null) continue;
        put({ x, y, z, rot, tone: 0.05, shut: 0, at, kind: KIND.church }, 15);
        churchSide = side; churchAt = at;
        // Platz vor der Kirche: Brunnen, Maibaum, Linden, Bänke
        const sq = (dl: number, dq: number) => { t.world(at + dl, side * (latOf(at + dl, side) + dq), 0, w); return { x: w.x, z: w.z }; };
        const pf = sq(6, 6.5);
        v.props.push({ k: 'fountain', at, x: pf.x, y: terrain.groundAt(pf.x, pf.z), z: pf.z, rot: rot + Math.PI / 2, seed: v.seed + 11 });
        const pm = sq(-8, 7.5);
        v.props.push({ k: 'maypole', at, x: pm.x, y: terrain.groundAt(pm.x, pm.z), z: pm.z, rot, seed: v.seed + 13 });
        for (const [dl, dq] of [[13, 11], [-13, 11.5]]) {
          const p = sq(dl, dq);
          v.trees.push({ kind: 'tree', x: p.x, y: terrain.groundAt(p.x, p.z), z: p.z, s: 1.25 + R(20 + dl) * 0.2, rot: R(21 + dl) * 6.28, tint: 1 });
          taken.push(p.x, p.z, 4);
        }
        for (const dl of [9.5, -4]) { const p = sq(dl, 4.2); v.props.push({ k: 'bench', at, x: p.x, y: terrain.groundAt(p.x, p.z), z: p.z, rot, seed: v.seed + 17 + dl }); }
        taken.push(pf.x, pf.z, 4, pm.x, pm.z, 2);
        break;
      }
      if (churchSide) break;
    }
    // ——— Häuserzeilen beidseitig an der Straße, dahinter zweite und dritte Reihe ———
    for (const side of [-1, 1]) {
      let at = v.za + R(30 + side) * 8;
      let n = 0;
      while (at < v.zb) {
        if (late()) yield;
        n++;
        const k = v.seed + n * 31 + (side > 0 ? 7 : 0);
        const step = 18 + hash(k, 1) * 7;
        if (side === churchSide && Math.abs(at - churchAt) < 24) { at += step; continue; }
        const s = t.segAt(at);
        if (s.tunnel || s.hairpin > 0) { at += step; continue; }
        // Gasthof (größer) oder Wohnhaus in verschiedener Größe
        const inn = hash(k, 2) < 0.16;
        const sx = inn ? 1.2 : 0.9 + hash(k, 3) * 0.22, sz = inn ? 1.25 : 0.9 + hash(k, 4) * 0.25, sy = inn ? 1.12 : 0.94 + hash(k, 5) * 0.14;
        let lat = latOf(at, side) + 9.6 * sz + 1.2 + hash(k, 6) * 3;
        let x = 0, z = 0, y: number | null = null, rot = 0;
        // nah an der Straße, sonst etwas weiter weg (Hang)
        if (hash(k, 7) < 0.9) for (const dl of [0, 5, 10]) {
          t.world(at, side * (lat + dl), 0, w);
          x = w.x; z = w.z;
          if (roadDist(x, z) < lat + dl - 2.5 || !free(x, z, 9)) continue;
          rot = facing(x, z, at) + (hash(k, 8) - 0.5) * 0.14;
          const foot = FOOT_HOUSE.map(([a, b]) => [a * sx, b * sz] as [number, number]);
          y = this.fit(x, z, rot, foot, 4.2);
          if (y !== null) { lat += dl; break; }
        }
        {
          if (y !== null) {
            put({ x, y, z, rot, tone: inn ? 0.1 : hash(k, 9), shut: Math.floor(hash(k, 10) * 4), at, kind: KIND.house, sx, sy, sz }, 9.5 * Math.max(sx, sz));
            // Kreuzzaun vor dem Garten (nicht vor Zuschauern), Tor in der Mitte
            const fl = lat - 9.2 * sz - 1.6;
            if (fl > latOf(at, side) + 0.9 && !t.segAt(at).crowd) {
              const pts: number[] = [];
              for (let dl = -7.5 * sx; dl <= 7.5 * sx + 0.01; dl += 2.5 * sx) {
                t.world(at + dl, side * fl, 0, w);
                pts.push(w.x, terrain.groundAt(w.x, w.z), w.z);
              }
              v.props.push({ k: 'fence', at, x: 0, y: 0, z: 0, rot: 0, pts, seed: k });
            }
          }
        }
        // zweite Reihe (Haus oder Stadel), versetzt
        if (hash(k, 11) < 0.6) {
          const barn = hash(k, 12) < 0.4;
          const lat2 = lat + 22 + hash(k, 13) * 6;
          const at2 = at + (hash(k, 14) - 0.5) * 12;
          t.world(at2, side * lat2, 0, w);
          x = w.x; z = w.z;
          if (roadDist(x, z) > lat2 - 4 && free(x, z, 10)) {
            const rot = facing(x, z, at2) + (barn ? (hash(k, 15) < 0.5 ? Math.PI / 2 : -Math.PI / 2) : 0) + (hash(k, 16) - 0.5) * 0.4;
            const y = this.fit(x, z, rot, barn ? FOOT_BARN : FOOT_HOUSE, 4.2);
            if (y !== null) put({ x, y, z, rot, tone: hash(k, 17), shut: Math.floor(hash(k, 18) * 4), at: at2, kind: barn ? KIND.barn : KIND.house, sx: 0.92 + hash(k, 19) * 0.16, sy: 0.95 + hash(k, 20) * 0.1, sz: 0.92 + hash(k, 21) * 0.16 }, 10);
          }
        }
        // dritte Reihe: vereinzelt Stadel am Hang
        if (hash(k, 22) < 0.22) {
          const lat3 = lat + 48 + hash(k, 23) * 12;
          t.world(at, side * lat3, 0, w);
          x = w.x; z = w.z;
          if (roadDist(x, z) > lat3 - 5 && free(x, z, 10)) {
            const rot = facing(x, z, at) + Math.PI / 2 + (hash(k, 24) - 0.5) * 0.5;
            const y = this.fit(x, z, rot, FOOT_BARN, 4.2);
            if (y !== null) put({ x, y, z, rot, tone: 0.5, shut: 0, at, kind: KIND.barn, sx: 1, sy: 1, sz: 1 }, 10);
          }
        }
        at += step;
      }
    }
    // ——— Laternen entlang der Dorfstraße (abwechselnd links und rechts) ———
    let q = 0;
    for (let at = v.za + 8; at < v.zb - 4; at += 13, q++) {
      const side = q % 2 ? 1 : -1;
      const s = t.segAt(at);
      if (s.tunnel || s.crowd) continue;
      const h = this.c.ground(s, side, 0.75);
      if (h === null) continue;
      t.world(at, side * (EDGE + 0.75), 0, w);
      const lx = w.x, ly = w.y + h, lz = w.z;
      v.props.push({ k: 'lamp', at, x: lx, y: ly, z: lz, rot: facing(lx, lz, at), seed: v.seed + q });
    }
    // ——— Wegkreuz am Ortseingang, Holzstöße an Stadeln ———
    {
      const at = v.za - 6;
      const side = R(40) < 0.5 ? 1 : -1;
      const lat = latOf(at, side) + 2.2;
      t.world(at, side * lat, 0, w);
      const x = w.x, z = w.z;
      if (roadDist(x, z) > lat - 1) v.props.push({ k: 'cross', at, x, y: terrain.groundAt(x, z), z, rot: facing(x, z, at), seed: v.seed + 3 });
    }
    for (const h of v.houses) {
      if (h.kind !== KIND.barn || hash(Math.round(h.x * 10), 5) > 0.6) continue;
      const cs = Math.cos(h.rot), sn = Math.sin(h.rot);
      const lx = 6.4, lz = 1;
      const x = h.x + cs * lx + sn * lz, z = h.z - sn * lx + cs * lz;
      v.props.push({ k: 'woodpile', at: h.at, x, y: terrain.groundAt(x, z), z, rot: h.rot, seed: Math.round(h.x * 7) });
    }
    // Hülle
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const h of v.houses) { x0 = Math.min(x0, h.x - 15); x1 = Math.max(x1, h.x + 15); z0 = Math.min(z0, h.z - 15); z1 = Math.max(z1, h.z + 15); }
    for (let at = v.za; at <= v.zb; at += 20) { t.world(at, 0, 0, w); x0 = Math.min(x0, w.x - 30); x1 = Math.max(x1, w.x + 30); z0 = Math.min(z0, w.z - 30); z1 = Math.max(z1, w.z + 30); }
    v.box = [x0, z0, x1, z1];
    // Bäume weg, wo Häuser stehen – auch solche, die erst mit späteren Kacheln kommen
    for (const h of v.houses) {
      const r = h.kind === KIND.church ? 17 : 12;
      this.c.trees.block(h.x, h.z, r);
      this.c.trees.clear(h.x, h.z, r);
    }
    for (const p of v.props) if (p.k !== 'fence') { this.c.trees.block(p.x, p.z, 3); this.c.trees.clear(p.x, p.z, 3); }
    v.planned = true;
  }

  /**
   * Teil der Dörfer in z0 … z1 bauen: Häuser zu den Instanzen, Kleinteile als Netz (zurückgegeben), Bäume
   * des Platzes, Ortsschild.
   */
  *buildRange(k: number, z0: number, z1: number, late: () => boolean): Generator<void, THREE.Group | null, void> {
    this.sites(z1 + 3200);
    let out: THREE.Group | null = null;
    const G = new GB();
    const lights: number[] = [];
    let added = false;
    for (const v of this.list) {
      if (v.zb + 60 < z0 || v.za - 60 >= z1) continue;
      if (!v.planned) yield* this.plan(v, late);
      for (const h of v.houses) if (h.at >= z0 && h.at < z1) { this.c.houses.spots.push(h); added = true; }
      const treeAt = v.houses.find((h) => h.kind === KIND.church)?.at ?? v.za;
      if (v.trees.length && treeAt >= z0 && treeAt < z1) this.c.trees.addSpots(v.trees);
      for (const p of v.props) if (p.at >= z0 && p.at < z1) this.prop(G, p, lights);
      if (v.signAt >= z0 && v.signAt < z1) {
        out ??= new THREE.Group();
        this.c.plate(out, Math.floor(v.signAt / SEG), EDGE + 1.7, 0.1, v.name.toUpperCase(), '', 2.1);
      }
      if (late()) yield;
    }
    if (added) this.c.houses.refit();
    if (!G.empty) {
      const geo = yield* buildGeo(G);
      const mesh = new THREE.Mesh(geo, this.c.mat);
      mesh.matrixAutoUpdate = false;
      mesh.name = 'village';
      out ??= new THREE.Group();
      out.add(mesh);
    }
    if (lights.length) {
      const halos = lampHalos(lights);
      if (halos) { out ??= new THREE.Group(); out.add(halos); }
      this.lights.set(k, lights);
    }
    return out;
  }

  /** Abschnitt k abgebaut */
  drop(k: number) { this.lights.delete(k); }

  /** Lichtkegel der Laternen für die Bodenkarte */
  splats(x0: number, z0: number, x1: number, z1: number, light: (x: number, z: number, r: number, k: number) => void) {
    for (const l of this.lights.values()) for (let i = 0; i < l.length; i += 3) if (l[i] >= x0 && l[i] <= x1 && l[i + 2] >= z0 && l[i + 2] <= z1) light(l[i], l[i + 2], 7, 0.9);
  }

  // ——— Kleinteile ———

  private prop(G: GB, p: Prop, lights: number[]) {
    const cs = Math.cos(p.rot), sn = Math.sin(p.rot);
    const P = (lx: number, ly: number, lz: number) => [p.x + lx * cs + lz * sn, p.y + ly, p.z - lx * sn + lz * cs];
    const r = (k: number) => hash(p.seed, k);
    const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: RGBf) => {
      G.quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), col);
      G.quad(P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), col);
      G.quad(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), col);
      G.quad(P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), col);
      G.quad(P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0), col);
    };
    const cyl = (cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, n: number, col: RGBf, cap = true) => {
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
        G.quad(P(cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0), P(cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0), P(cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1), P(cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1), col);
        if (cap && r1 > 0.001) G.tri(P(cx, y1, cz), P(cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1), P(cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1), col);
      }
    };
    const wood = (k: number): RGBf => { const f = 0.8 + r(k) * 0.35; const c = lin('#6b5137'); return [c[0] * f, c[1] * f, c[2] * f]; };
    const iron = lin('#25282c');
    switch (p.k) {
      case 'lamp': {
        // Mast mit Sockel, geschwungener Ausleger zur Straße, Laterne mit warmem Glas (lokal +z: zur Straße)
        cyl(0, 0, 0.17, 0.13, -0.2, 0.5, 8, iron);
        cyl(0, 0, 0.065, 0.05, 0.5, 4.5, 6, iron, false);
        box(-0.03, 0.03, 4.35, 4.42, 0, 0.8, iron);
        box(-0.025, 0.025, 4.0, 4.38, 0.05, 0.1, iron);
        cyl(0, 0.8, 0.06, 0.2, 3.85, 4.2, 6, lin('#f7e2a8'), false);
        cyl(0, 0.8, 0.22, 0.04, 4.2, 4.42, 6, iron);
        lights.push(...P(0, 4.0, 0.8));
        if (r(1) < 0.5) cyl(0, 0, 0.3, 0.2, 2.6, 2.9, 8, lin(['#d63a3a', '#ef6a8a', '#e8463c'][Math.floor(r(2) * 3)]));
        break;
      }
      case 'fence': {
        // Kreuzzaun: Pfostenpaare, dazwischen gekreuzte Latten, Tor in der Mitte offen
        const q = p.pts!;
        const n = q.length / 3;
        const mid = Math.floor((n - 1) / 2);
        const at = (i: number) => [q[i * 3], q[i * 3 + 1], q[i * 3 + 2]];
        const post = (a: number[], h: number, col: RGBf) => {
          for (const o of [-0.07, 0.07]) {
            const X = a[0] + o, Z = a[2];
            G.quad([X - 0.04, a[1] - 0.3, Z - 0.04], [X + 0.04, a[1] - 0.3, Z - 0.04], [X + 0.04, a[1] + h, Z - 0.04], [X - 0.04, a[1] + h, Z - 0.04], col);
            G.quad([X - 0.04, a[1] - 0.3, Z + 0.04], [X + 0.04, a[1] - 0.3, Z + 0.04], [X + 0.04, a[1] + h, Z + 0.04], [X - 0.04, a[1] + h, Z + 0.04], col);
            G.quad([X - 0.04, a[1] - 0.3, Z - 0.04], [X - 0.04, a[1] - 0.3, Z + 0.04], [X - 0.04, a[1] + h, Z + 0.04], [X - 0.04, a[1] + h, Z - 0.04], col);
            G.quad([X + 0.04, a[1] - 0.3, Z - 0.04], [X + 0.04, a[1] - 0.3, Z + 0.04], [X + 0.04, a[1] + h, Z + 0.04], [X + 0.04, a[1] + h, Z - 0.04], col);
          }
        };
        const slat = (a: number[], b: number[], ya: number, yb: number, col: RGBf) => {
          const dx = b[0] - a[0], dz = b[2] - a[2];
          const L = Math.hypot(dx, dz) || 1;
          const nx = -dz / L * 0.02, nz = dx / L * 0.02;
          G.quad([a[0] - nx, a[1] + ya - 0.05, a[2] - nz], [b[0] - nx, b[1] + yb - 0.05, b[2] - nz], [b[0] - nx, b[1] + yb + 0.05, b[2] - nz], [a[0] - nx, a[1] + ya + 0.05, a[2] - nz], col);
          G.quad([a[0] + nx, a[1] + ya - 0.05, a[2] + nz], [b[0] + nx, b[1] + yb - 0.05, b[2] + nz], [b[0] + nx, b[1] + yb + 0.05, b[2] + nz], [a[0] + nx, a[1] + ya + 0.05, a[2] + nz], col);
          G.quad([a[0] - nx, a[1] + ya + 0.05, a[2] - nz], [b[0] - nx, b[1] + yb + 0.05, b[2] - nz], [b[0] + nx, b[1] + yb + 0.05, b[2] + nz], [a[0] + nx, a[1] + ya + 0.05, a[2] + nz], col);
        };
        for (let i = 0; i < n; i++) post(at(i), 1.15, wood(i));
        for (let i = 0; i + 1 < n; i++) {
          if (i === mid) continue;
          const a = at(i), b = at(i + 1);
          const col = wood(i + 10);
          slat(a, b, 0.15, 1.0, col);
          slat(a, b, 1.0, 0.15, col);
          slat(a, b, 1.05, 1.05, wood(i + 20));
        }
        break;
      }
      case 'fountain': {
        // Holzbrunnen: ausgehöhlter Stamm als Trog, Brunnenstock mit Rohr, Wasser
        const tr = wood(1);
        box(-1.6, 1.6, 0, 0.75, -0.45, -0.3, tr);
        box(-1.6, 1.6, 0, 0.75, 0.3, 0.45, tr);
        box(-1.6, -1.45, 0, 0.75, -0.3, 0.3, tr);
        box(1.45, 1.6, 0, 0.75, -0.3, 0.3, tr);
        box(-1.45, 1.45, 0, 0.12, -0.3, 0.3, tr);
        box(-1.45, 1.45, 0.55, 0.58, -0.3, 0.3, lin('#3c6878'));
        box(-1.95, -1.65, 0, 1.6, -0.15, 0.15, wood(2));
        box(-1.75, -1.3, 1.25, 1.3, -0.025, 0.025, lin('#7a7a76'));
        // Wasserstrahl (hell)
        box(-1.33, -1.27, 0.6, 1.26, -0.02, 0.02, lin('#bcd6dc'));
        // Blumen am Stock
        cyl(-1.8, 0, 0.18, 0.22, 1.6, 1.85, 6, lin('#d63a3a'));
        break;
      }
      case 'maypole': {
        // Maibaum: geschälter Stamm, Kranz, grüner Wipfel, Zunftschilder
        const st = lin('#c9b48a');
        cyl(0, 0, 0.22, 0.1, 0, 24, 8, st, false);
        cyl(0, 0, 0.1, 0.0, 24, 24.2, 6, st, false);
        // Wipfel
        const gr = lin('#2f5a24');
        for (let k = 0; k < 3; k++) cyl(0, 0, 0.9 - k * 0.25, 0.05, 21.5 + k * 1.0, 23.4 + k * 0.9, 7, gr, false);
        // Kranz mit Bändern
        const wr = lin('#3d6b2c');
        for (let k = 0; k < 12; k++) {
          const a0 = (k / 12) * Math.PI * 2, a1 = ((k + 1) / 12) * Math.PI * 2;
          const R0 = 1.1;
          G.quad(P(Math.cos(a0) * R0, 19, Math.sin(a0) * R0), P(Math.cos(a1) * R0, 19, Math.sin(a1) * R0), P(Math.cos(a1) * R0, 19.35, Math.sin(a1) * R0), P(Math.cos(a0) * R0, 19.35, Math.sin(a0) * R0), wr);
          if (k % 3 === 0) G.quad(P(Math.cos(a0) * R0, 19, Math.sin(a0) * R0), P(Math.cos(a0) * R0 + 0.06, 19, Math.sin(a0) * R0), P(Math.cos(a0) * R0 * 0.95 + 0.06, 16.8, Math.sin(a0) * R0 * 0.95), P(Math.cos(a0) * R0 * 0.95, 16.8, Math.sin(a0) * R0 * 0.95), [lin('#d6202a'), lin('#f4f4f4'), lin('#1f3c9c')][(k / 3) % 3]);
        }
        // Zunftschilder (Bretter mit Farbe) an Querstangen
        const cols = [lin('#e8d9b0'), lin('#c84c3a'), lin('#2f5d8a'), lin('#e3b84a')];
        for (let k = 0; k < 4; k++) {
          const y = 6 + k * 3.2;
          const side = k % 2 ? 1 : -1;
          box(Math.min(0, side * 1.3), Math.max(0, side * 1.3), y, y + 0.08, -0.04, 0.04, st);
          box(side * 1.3 - 0.35, side * 1.3 + 0.35, y - 0.9, y - 0.05, -0.03, 0.03, cols[k]);
        }
        break;
      }
      case 'bench': {
        const c = wood(3);
        box(-1, 1, 0.42, 0.47, -0.22, 0.22, c);
        box(-1, 1, 0.47, 0.92, -0.26, -0.21, c);
        for (const x of [-0.85, 0.85]) box(x - 0.05, x + 0.05, 0, 0.42, -0.2, 0.2, iron);
        break;
      }
      case 'cross': {
        // Wegkreuz (Marterl): Balken, Korpus, kleines Satteldach, Blumen davor
        const c = wood(4);
        box(-0.08, 0.08, 0, 3.3, -0.08, 0.08, c);
        box(-0.75, 0.75, 2.35, 2.5, -0.08, 0.08, c);
        box(-0.07, 0.07, 1.55, 2.3, 0.08, 0.16, lin('#d8c9a8'));
        box(-0.55, 0.55, 2.38, 2.46, 0.08, 0.15, lin('#d8c9a8'));
        const rf = lin('#4a3a2a');
        G.quad(P(-0.95, 3.0, -0.45), P(0, 3.55, -0.45), P(0, 3.55, 0.45), P(-0.95, 3.0, 0.45), rf);
        G.quad(P(0.95, 3.0, -0.45), P(0, 3.55, -0.45), P(0, 3.55, 0.45), P(0.95, 3.0, 0.45), rf);
        cyl(0, 0.6, 0.25, 0.3, 0, 0.3, 6, lin('#8a8a86'));
        cyl(0, 0.6, 0.28, 0.1, 0.3, 0.6, 6, lin('#d63a3a'));
        break;
      }
      case 'woodpile': {
        const c = wood(5);
        box(-0.5, 0.5, 0, 1.6, -3, 3, c);
        box(-0.6, 0.6, 1.6, 1.75, -3.2, 3.2, lin('#4a3f36'));
        // Stirnseiten heller (Schnittflächen)
        const end = lin('#a8875a');
        G.quad(P(0.51, 0.05, -2.9), P(0.51, 0.05, 2.9), P(0.51, 1.55, 2.9), P(0.51, 1.55, -2.9), end);
        break;
      }
    }
  }
}
