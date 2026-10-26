/**
 * Landschaft rund um die Strecke: ein durchgehendes Höhenfeld in drei Detailstufen.
 *
 * Die Straße selbst und ihr Nahbereich (Bankett, Felswände, Abgründe, Absperrungen) baut der
 * Renderer als „Korridor“. Alles dahinter kommt von hier: Hänge, die bergauf zu Graten und Gipfeln
 * steigen, bergab zum Talboden fallen, Seen auf fester Höhe, Berg über jedem Tunnel. Die Höhe an
 * jedem Punkt ergibt sich aus allen Straßenstücken in der Nähe (gewichtetes Mittel ihrer
 * Querprofile) – dadurch gibt es zwischen Serpentinen, in Kehren und an Abschnittsgrenzen keine
 * Lücken mehr. In Straßennähe bleibt das Höhenfeld unter dem Korridor, damit nichts durchsticht.
 */
import * as THREE from 'three';
import { EDGE, SEG, type BiomeId, type Seg, type Side, type Track } from './track';
import { BIOME_PALETTES, mixRGB, type RGB } from './palette';
import { lin255, type RGBf } from './models3d';

// ------------------------------------------------------------------ Rauschen

let NOISE_SEED = 1;
function h2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(NOISE_SEED, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = h2(xi, yi);
  const b = h2(xi + 1, yi);
  const c = h2(xi, yi + 1);
  const d = h2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, oct = 4): number {
  let s = 0;
  let a = 0.5;
  let f = 1;
  let norm = 0;
  for (let o = 0; o < oct; o++) {
    s += vnoise(x * f + o * 17.3, y * f - o * 9.1) * a;
    norm += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / norm;
}
/** Grate: 1 − |n|, geschärft; feinere Oktaven folgen den groben */
function ridged(x: number, y: number): number {
  let sum = 0;
  let amp = 0.55;
  let f = 1;
  let w = 1;
  for (let o = 0; o < 5; o++) {
    let n = 1 - Math.abs(vnoise(x * f + o * 7.7, y * f - o * 3.3) * 2 - 1);
    n *= n;
    sum += n * amp * w;
    w = Math.min(1, n * 1.8);
    f *= 2.07;
    amp *= 0.5;
  }
  return Math.min(1, sum / 0.95);
}
const smin = (a: number, b: number, k: number) => { const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k)); return b + (a - b) * h - k * h * (1 - h); };
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);
const sstep = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ Straßenproben

const K_UP = 0, K_DOWN = 1, K_FLAT = 2, K_WALL = 3, K_DROP = 4, K_WATER = 5, K_TUNNEL = 6;
const BIOMES: BiomeId[] = ['pass', 'alpine', 'forest', 'village', 'lake', 'vineyard'];
/** Hangneigung weiter weg: bergauf / bergab */
const S_UP = [0.62, 0.55, 0.45, 0.36, 0.45, 0.2];
const S_DOWN = [0.72, 0.6, 0.5, 0.32, 0.5, 0.26];
/** Proben alle 8 m (4 Segmente) */
const STEP = 4;
/** Einflussradius einer Probe */
const R_INF = 620;
const R_INF2 = R_INF * R_INF;
/** Maximale Breite des Korridors (Nahbereich) ab Straßenmitte */
export const LIM_MAX = EDGE + 12;
/** Bis hierhin (ab Straßenmitte) bleibt das Höhenfeld sicher unter der Straße – je nach Gitterweite */
const clampR = (cell: number) => EDGE + cell * 1.45 + 1;

const kindOf = (s: Side, tunnel: boolean): number => {
  if (tunnel) return K_TUNNEL;
  if (s.ground === 'water') return K_WATER;
  if (s.wall > 0) return K_WALL;
  if (s.drop) return K_DROP;
  if (s.tilt > 0.03) return K_UP;
  if (s.tilt < -0.03) return K_DOWN;
  return K_FLAT;
};

/** Querprofil eines Straßenstücks: Höhe relativ zur Straße im Abstand e ab Bankettkante */
function profile(kind: number, tilt: number, wall: number, e: number, b: number, floorRel: number, ridgeRel: number, lakeRel: number, lakeW: number, depth: number): number {
  switch (kind) {
    case K_UP: {
      const lin = tilt * Math.min(e, 30) + Math.max(0, e - 30) * S_UP[b];
      return smin(lin, ridgeRel, 60);
    }
    case K_WALL: {
      const lin = (e < 0.6 ? wall * (e / 0.6) : wall + 0.4 * Math.min(1, (e - 0.6) / 1.2) + tilt * Math.max(0, e - 1.8)) + Math.max(0, e - 30) * S_UP[b];
      return smin(lin, Math.max(ridgeRel, wall + 24), 60);
    }
    case K_TUNNEL: {
      // Berg über dem Tunnel: am Portal gut 10 m, nach innen steil ansteigend (Felsrücken statt Erdwall).
      // Bergseitig steigt er weiter an, talseitig fällt er zum Tal hin ab (sonst stünde dort eine Wand)
      const top = 10 + Math.min(depth * 0.62, 44);
      if (tilt < -0.03) return smax(top - Math.max(0, e - 4) * 0.8, floorRel, 20);
      return smin(top + 0.5 * e, Math.max(ridgeRel, 60), 40);
    }
    case K_FLAT: {
      const lin = 0.13 + Math.min(e, 40) * 0.07 + Math.max(0, e - 40) * S_UP[b];
      return smin(lin, ridgeRel, 60);
    }
    case K_WATER: {
      if (e < 6) return lakeRel * sstep(0, 6, e);
      if (e < lakeW) return lakeRel;
      return smin(lakeRel + (e - lakeW) * 0.42, ridgeRel, 60);
    }
    case K_DROP: {
      const k = Math.max(0.6, -tilt);
      let near: number;
      if (e < 0.9) near = -0.5 * k * (e / 0.9);
      else if (e < 3) near = -k * (0.5 + 2.5 * (e - 0.9) / 2.1);
      else if (e < 7) near = -k * (3 + 5 * (e - 3) / 4);
      else if (e < 12) near = -k * (8 + 8 * (e - 7) / 5);
      else if (e < 18) near = -k * (16 + 10 * (e - 12) / 6);
      else near = -k * (26 + (e - 18) * 0.9);
      const eF = 18 + Math.max(0, (-26 * k - floorRel) / (0.9 * k));
      const v = smax(near, floorRel, 18);
      return smin(v + Math.max(0, e - eF - 420) * 0.42, ridgeRel, 60);
    }
    default: { // K_DOWN
      const t30 = tilt * 30;
      const lin = tilt * Math.min(e, 30) - Math.max(0, e - 30) * S_DOWN[b];
      const eF = 30 + Math.max(0, (t30 - floorRel) / S_DOWN[b]);
      const v = smax(lin, floorRel, 22);
      return smin(v + Math.max(0, e - eF - 420) * 0.42, ridgeRel, 60);
    }
  }
}

export interface TerrainLevel { size: number; n: number; ring: number; skirt: number }
export const LEVELS: TerrainLevel[] = [
  { size: 128, n: 32, ring: 2, skirt: 22 },
  { size: 512, n: 32, ring: 2, skirt: 60 },
  { size: 2048, n: 32, ring: 2, skirt: 160 },
];

/** Baum auf dem Höhenfeld */
export interface TreeSpot { kind: string; x: number; y: number; z: number; s: number; rot: number; tint: number }

export interface TileData {
  geo: THREE.BufferGeometry;
  water: THREE.BufferGeometry | null;
  trees: TreeSpot[];
  minY: number;
  maxY: number;
}

/** Proben-Speicher (Spalten statt Objekte, damit die Schleifen schnell bleiben) */
class Samples {
  n = 0;
  k0 = 0;   // erster Probenindex (Segment / STEP)
  x = new Float64Array(0);
  z = new Float64Array(0);
  y = new Float32Array(0);
  rx = new Float32Array(0);
  rz = new Float32Array(0);
  b = new Uint8Array(0);
  floor = new Float32Array(0);
  lake = new Float32Array(0);
  lakeW = new Float32Array(0);
  kL = new Uint8Array(0);
  kR = new Uint8Array(0);
  tL = new Float32Array(0);
  tR = new Float32Array(0);
  wL = new Float32Array(0);
  wR = new Float32Array(0);
  dep = new Float32Array(0);   // Tunnel: Abstand zum nächsten Portal (m)
  alloc(n: number) {
    this.n = n;
    this.x = new Float64Array(n); this.z = new Float64Array(n); this.y = new Float32Array(n);
    this.rx = new Float32Array(n); this.rz = new Float32Array(n); this.b = new Uint8Array(n);
    this.floor = new Float32Array(n); this.lake = new Float32Array(n); this.lakeW = new Float32Array(n);
    this.kL = new Uint8Array(n); this.kR = new Uint8Array(n);
    this.tL = new Float32Array(n); this.tR = new Float32Array(n);
    this.wL = new Float32Array(n); this.wR = new Float32Array(n);
    this.dep = new Float32Array(n);
  }
}

/** Straßensegmente eines Gebiets, nach Zellen sortiert (schnelle Umkreissuche) */
interface SegGrid { buf: Float64Array; n: number; x0: number; z0: number; cs: number; nx: number; nz: number; start: Int32Array; order: Int32Array }
export interface Region { cand: number[]; sg: SegGrid }

/** Ergebnis der Höhenberechnung an einem Punkt */
interface HPoint { h: number; water: number; lakeY: number; floor: number; b: number; dRoad: number; skip: boolean; near: boolean; ridge: number }

export class Terrain {
  readonly track: Track;
  private s = new Samples();
  private zFrom = 0;
  private zTo = -1;
  private floorCache = new Map<number, number>();
  private lakeCache = new Map<number, number>();
  private limCache = new Map<number, [number, number]>();
  private rawLimCache = new Map<number, [number, number]>();
  /** Fensterwechsel zählen: Kacheln kennen so den Stand, mit dem sie gebaut wurden */
  version = 0;
  /** Gebiete, deren Höhen sich beim letzten Fensterwechsel geändert haben (x0, z0, x1, z1) */
  private dirty: number[][] = [];

  constructor(track: Track) {
    this.track = track;
    NOISE_SEED = (track.seed % 100000) + 7;
  }

  // ---------------------------------------------------------------- Korridorbreite

  /** Wie weit darf der Korridor seitlich reichen (ab Straßenmitte)? Global, unabhängig vom Abschnitt */
  lim(i: number): [number, number] {
    const hit = this.limCache.get(i);
    if (hit) return hit;
    let l = Infinity;
    let r = Infinity;
    for (let d = -4; d <= 4; d++) {
      const [rl, rr] = this.rawLim(i + d);
      l = Math.min(l, rl + Math.abs(d) * 1.5);
      r = Math.min(r, rr + Math.abs(d) * 1.5);
    }
    const out: [number, number] = [l, r];
    this.limCache.set(i, out);
    if (this.limCache.size > 20000) this.limCache.clear();
    return out;
  }

  private rawLim(i: number): [number, number] {
    const t = this.track;
    i = Math.max(t.first, i);
    const hit = this.rawLimCache.get(i);
    if (hit) return hit;
    let l = LIM_MAX;
    let rr = LIM_MAX;
    let kmax = 0;
    let ksum = 0;
    for (let d = -16; d <= 16; d += 2) {
      const c = t.seg(Math.max(t.first, i + d)).curve;
      ksum += c;
      kmax = Math.max(kmax, Math.abs(c));
    }
    if (kmax > 0.003) {
      const inner = Math.max(EDGE + 2, 0.7 / kmax);
      if (ksum > 0) rr = Math.min(rr, inner); else l = Math.min(l, inner);
    }
    const s = t.seg(i);
    const rx = Math.cos(s.th);
    const rz = Math.sin(s.th);
    for (let j = Math.max(t.first, i - 450); j < i + 450; j += 3) {
      if (Math.abs(j - i) < 50) continue;
      const sj = t.seg(j);
      const dx = sj.wx - s.wx;
      const dz = sj.wz - s.wz;
      const d2 = dx * dx + dz * dz;
      if (d2 > 60 * 60) continue;
      const d = Math.sqrt(d2);
      const cap = Math.max(EDGE + 2, d * 0.5 - 2);
      if (dx * rx + dz * rz > 0) rr = Math.min(rr, cap); else l = Math.min(l, cap);
    }
    const out: [number, number] = [l, rr];
    this.rawLimCache.set(i, out);
    if (this.rawLimCache.size > 20000) this.rawLimCache.clear();
    return out;
  }

  // ---------------------------------------------------------------- Talboden und Seen

  /** Talboden einer Abfahrt: Straßenhöhe am Beginn des tiefsten Tals (See/Weinberge) minus etwas */
  floorOf(descent: number): number {
    const hit = this.floorCache.get(descent);
    if (hit !== undefined) return hit;
    const t = this.track;
    let guard = 0;
    for (;;) {
      const sec = t.sections.find((x) => x.descent === descent && (x.biome === 'lake' || x.biome === 'vineyard'));
      if (sec) {
        const y = t.seg(sec.start).y - 14;
        this.floorCache.set(descent, y);
        return y;
      }
      if (t.sections.length && t.sections[t.sections.length - 1].descent > descent) {
        // keine Talsohle gefunden (sollte nicht vorkommen): tiefste Straße der Abfahrt
        const secs = t.sections.filter((x) => x.descent === descent);
        const last = secs[secs.length - 1];
        const y = t.seg(Math.max(t.first, last.end - 1)).y - 14;
        this.floorCache.set(descent, y);
        return y;
      }
      t.seg(t.length + 10);
      if (++guard > 40) return 0;
    }
  }

  /** Seespiegel: etwas unter der tiefsten Straße am See */
  lakeOf(secIndex: number): number {
    const hit = this.lakeCache.get(secIndex);
    if (hit !== undefined) return hit;
    const sec = this.track.sections[secIndex];
    const last = this.track.seg(sec.end - 1);
    const y = last.y + last.grade * SEG - 1.6;
    this.lakeCache.set(secIndex, y);
    return y;
  }

  // ---------------------------------------------------------------- Probenfenster

  /** Proben für [z0, z1] bereithalten (Meter entlang der Strecke) */
  window(z0: number, z1: number) {
    const t = this.track;
    const k0 = Math.max(Math.ceil(t.first / STEP), Math.floor(z0 / SEG / STEP));
    const k1 = Math.floor(z1 / SEG / STEP);
    if (k0 * STEP * SEG >= this.zFrom && k1 * STEP * SEG <= this.zTo && this.s.n) return false;
    // etwas Vorrat, damit nicht ständig neu aufgebaut wird
    const kk0 = Math.max(Math.ceil(t.first / STEP), k0 - 40);
    const kk1 = k1 + 120;
    const n = kk1 - kk0 + 1;
    const S = this.s;
    // Wo kommen Proben hinzu, wo fallen welche weg? Dort stimmen schon gebaute Kacheln nicht mehr
    if (S.n) {
      const oFrom = S.k0;
      const oTo = S.k0 + S.n - 1;
      const box = (a: number, b: number) => {
        if (b < a) return;
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let k = a; k <= b; k += 2) {
          const sg = t.seg(Math.max(t.first, k * STEP));
          x0 = Math.min(x0, sg.wx); z0 = Math.min(z0, sg.wz); x1 = Math.max(x1, sg.wx); z1 = Math.max(z1, sg.wz);
        }
        this.dirty.push([x0 - R_INF, z0 - R_INF, x1 + R_INF, z1 + R_INF]);
      };
      box(Math.min(oFrom, kk0), Math.max(oFrom, kk0) - 1);
      box(Math.min(oTo, kk1) + 1, Math.max(oTo, kk1));
    }
    S.alloc(n);
    S.k0 = kk0;
    for (let q = 0; q < n; q++) {
      const i = (kk0 + q) * STEP;
      const s = t.seg(i);
      const sec = t.sections[s.sec];
      S.x[q] = s.wx;
      S.z[q] = s.wz;
      S.y[q] = s.y;
      S.rx[q] = Math.cos(s.th);
      S.rz[q] = Math.sin(s.th);
      S.b[q] = BIOMES.indexOf(sec.biome);
      S.floor[q] = this.floorOf(sec.descent);
      S.lake[q] = sec.biome === 'lake' ? this.lakeOf(s.sec) : S.floor[q];
      S.lakeW[q] = 210 + 150 * h2(s.sec, 77);
      S.kL[q] = kindOf(s.L, s.tunnel);
      S.kR[q] = kindOf(s.R, s.tunnel);
      S.tL[q] = s.L.tilt;
      S.tR[q] = s.R.tilt;
      S.wL[q] = s.L.wall;
      S.wR[q] = s.R.wall;
      let dep = 0;
      if (s.tunnel) {
        let d = 1;
        while (d < 150 && t.seg(Math.max(t.first, i - d)).tunnel && t.seg(i + d).tunnel) d++;
        dep = d * SEG;
      }
      S.dep[q] = dep;
    }
    this.zFrom = kk0 * STEP * SEG;
    this.zTo = kk1 * STEP * SEG;
    this.version++;
    return true;
  }

  /** geänderte Gebiete seit der letzten Abfrage (für den Neubau betroffener Kacheln) */
  takeDirty(): number[][] {
    const d = this.dirty;
    this.dirty = [];
    return d;
  }

  /** Proben-Indizes im Umkreis r um (cx, cz) */
  private near(cx: number, cz: number, r: number, out: number[]) {
    out.length = 0;
    const S = this.s;
    const r2 = r * r;
    for (let q = 0; q < S.n; q++) {
      const dx = S.x[q] - cx;
      const dz = S.z[q] - cz;
      if (dx * dx + dz * dz < r2) out.push(q);
    }
  }

  // ---------------------------------------------------------------- Höhe

  private hp: HPoint = { h: 0, water: 0, lakeY: 0, floor: 0, b: 0, dRoad: 1e9, skip: false, near: false, ridge: 0 };

  /**
   * Großform an (x, z): gewichtetes Mittel der Querprofile aller Straßenstücke im Umkreis
   * (ohne Kleinformen und ohne Klemmen) – glatt, darf darum auch gröber gerechnet und interpoliert werden.
   */
  private base(x: number, z: number, cand: number[]): HPoint {
    const S = this.s;
    const o = this.hp;
    o.skip = false;
    o.near = false;
    if (S.n === 0) { o.h = 0; o.water = 0; o.lakeY = -1e4; o.floor = -300; o.b = 0; o.dRoad = 1e9; o.ridge = 400; return o; }
    // Gipfel und Grate über dem Talboden: hoch genug, dass über jedem Pass noch Berge aufragen
    const ridgeH = 380 + 520 * ridged(x / 1300, z / 1300) + 140 * fbm(x / 2600, z / 2600, 2) + 80 * (ridged(x / 430 + 3.1, z / 430 - 1.7) - 0.45);
    let sw = 0;
    let sh = 0;
    let swat = 0;
    let slake = 0;
    let sfloor = 0;
    let best = 0;
    let bestB = 0;
    let dmin2 = 1e18;
    for (let c = 0; c < cand.length; c++) {
      const q = cand[c];
      const dx = x - S.x[q];
      const dz = z - S.z[q];
      const d2 = dx * dx + dz * dz;
      if (d2 > R_INF2) continue;
      if (d2 < dmin2) dmin2 = d2;
      const t = 1 - d2 / R_INF2;
      const w = (t * t) / ((d2 + 64) * (d2 + 64));
      const lat = dx * S.rx[q] + dz * S.rz[q];
      const right = lat > 0;
      const kind = right ? S.kR[q] : S.kL[q];
      const tilt = right ? S.tR[q] : S.tL[q];
      const wall = right ? S.wR[q] : S.wL[q];
      const e = Math.max(0, Math.abs(lat) - EDGE);
      const y = S.y[q];
      const fl = S.floor[q];
      const lk = S.lake[q];
      let p = profile(kind, tilt, wall, e, S.b[q], fl - y, fl + ridgeH - y, lk - y, S.lakeW[q], S.dep[q]);
      // weiter draußen gehen alle Querprofile in dieselbe freie Berglandschaft über – sonst stünde am Rand
      // des Einflussbereichs eine Wand (Talseiten steigen so zu Bergen auf der Gegenseite an)
      const kf = kind === K_WATER ? sstep(S.lakeW[q] + 15, R_INF - 20, e) : sstep(260, R_INF - 20, e);
      if (kf > 0) p += (fl + ridgeH * 0.9 - y - p) * kf;
      sw += w;
      sh += w * (y + p);
      // Seefläche: vom Ufer weg einblenden, am fernen Ende weich auslaufen lassen
      if (kind === K_WATER) swat += w * sstep(4, 14, e) * sstep(S.lakeW[q], S.lakeW[q] - 70, e);
      slake += w * lk;
      sfloor += w * fl;
      if (w > best) { best = w; bestB = S.b[q]; }
    }
    if (sw === 0) {
      // weit weg von allem: Berge über dem nächsten Talboden
      let q0 = 0;
      let dm = 1e18;
      for (let q = 0; q < S.n; q += 8) {
        const dx = x - S.x[q];
        const dz = z - S.z[q];
        const d2 = dx * dx + dz * dz;
        if (d2 < dm) { dm = d2; q0 = q; }
      }
      o.h = S.floor[q0] + ridgeH * 0.9;
      o.water = 0;
      o.lakeY = S.lake[q0];
      o.floor = S.floor[q0];
      o.b = S.b[q0];
      o.dRoad = Math.sqrt(dm);
    } else {
      // Rand des Einflussbereichs weich in die freie Berglandschaft übergehen lassen
      const wFar = 1 / (R_INF2 * R_INF2) * 0.02;
      const fl = sfloor / sw;
      o.h = (sh + wFar * (fl + ridgeH * 0.9)) / (sw + wFar);
      o.water = swat / sw;
      o.lakeY = slake / sw;
      o.floor = fl;
      o.b = bestB;
      o.dRoad = Math.sqrt(dmin2);
    }
    o.ridge = ridgeH;
    return o;
  }

  /** Kleinformen und Klemmen in Straßennähe auf eine Großform anwenden */
  private finish(x: number, z: number, o: HPoint, sg: SegGrid | null, cell: number): HPoint {
    o.skip = false;
    o.near = false;
    const dr = o.dRoad;
    // Kleinere Formen: Kuppen, Rinnen – in Straßennähe zurückhaltend
    const wb = sstep(0.3, 0.72, o.water);
    if (wb < 1) {
      const a1 = Math.min(16, 0.4 + dr * 0.045);
      const a2 = Math.min(4, 0.25 + dr * 0.012);
      o.h += ((fbm(x / 70, z / 70, 3) - 0.5) * 2 * a1 + (vnoise(x / 19, z / 19) - 0.5) * 2 * a2) * (1 - wb);
    }
    // Seegrund, zum Ufer hin weich ansteigend (keine senkrechten Wände rund um den See)
    if (wb > 0) o.h += (o.lakeY - 6 - Math.min(20, dr * 0.05) - o.h) * wb;
    if (!sg || sg.n === 0) return o;
    const CR = clampR(cell);
    if (dr > CR + 30) return o;
    const R = CR + 22;
    const segs = sg.buf;
    let minUnder = Infinity;
    let maxOver = -Infinity;
    let nd2 = 1e18;
    let nLat = 0;
    let nLimL = LIM_MAX;
    let nLimR = LIM_MAX;
    let inside = false;
    let raise = -Infinity;
    const ci = Math.floor((x - sg.x0) / sg.cs);
    const cj = Math.floor((z - sg.z0) / sg.cs);
    for (let jj = cj - 1; jj <= cj + 1; jj++) {
      if (jj < 0 || jj >= sg.nz) continue;
      for (let ii = ci - 1; ii <= ci + 1; ii++) {
        if (ii < 0 || ii >= sg.nx) continue;
        const cidx = jj * sg.nx + ii;
        for (let q = sg.start[cidx]; q < sg.start[cidx + 1]; q++) {
          const b = sg.order[q] * 9;
          const dx = x - segs[b];
          const dz = z - segs[b + 1];
          const d2 = dx * dx + dz * dz;
          if (d2 > R * R) continue;
          // Tunnelportal: direkt an der Felswand fehlt das Gelände (die Wand deckt die Fuge),
          // dahinter liegt Berg über der Röhre – dort gilt keine Klemme unter die Straße
          const portal = segs[b + 6];
          const pr = 18 + cell;
          if (portal > 0 && d2 < pr * pr) {
            const lon = dx * segs[b + 4] - dz * segs[b + 3] - (portal === 2 ? SEG : 0);
            const inward = portal === 1 ? lon : -lon;
            if (Math.abs(inward) < cell * 0.75 + 1) o.skip = true;
            else if (inward > 0) { inside = true; raise = Math.max(raise, segs[b + 2] + 9.5); }
          }
          if (d2 < CR * CR) {
            const tun = segs[b + 5];
            if (tun === 1) maxOver = Math.max(maxOver, segs[b + 2] + 8.5);
            else if (tun === 0) minUnder = Math.min(minUnder, segs[b + 2] - 1.1);
          }
          if (d2 < nd2 && segs[b + 5] === 0) {
            nd2 = d2;
            nLat = dx * segs[b + 3] + dz * segs[b + 4];
            nLimL = segs[b + 7];
            nLimR = segs[b + 8];
          }
        }
      }
    }
    if (inside) { minUnder = Infinity; maxOver = Math.max(maxOver, raise); }
    // unter der Straße und über dem Tunnel zugleich: nur an Portalen möglich – dort aussparen
    if (minUnder < Infinity && maxOver > -Infinity) o.skip = true;
    if (minUnder < Infinity) { o.h = Math.min(o.h, minUnder); o.near = true; }
    if (maxOver > -Infinity) { o.h = Math.max(o.h, maxOver); o.near = true; }
    if (nd2 < 1e17) {
      // unter dem Korridor bleiben (sonst flimmern zwei Flächen übereinander)
      const lim = nLat < 0 ? nLimL : nLimR;
      const a = Math.abs(nLat);
      const k = sstep(lim + 2.5, lim - 1, a);
      if (k > 0) { o.h -= 1.4 * k; o.near = true; }
    }
    return o;
  }

  private heightAt(x: number, z: number, cand: number[], sg: SegGrid | null, cell = 4): HPoint {
    return this.finish(x, z, this.base(x, z, cand), sg, cell);
  }

  /** Höhe für Requisiten außerhalb des Korridors (gleiche Rechnung wie die Kacheln) */
  groundAt(x: number, z: number): number {
    return this.heightIn(this.region(x - 1, z - 1, x + 1, z + 1), x, z);
  }

  /** Rechenbereich vorbereiten (für viele Abfragen in einem Gebiet, z. B. ein Streckenabschnitt) */
  region(x0: number, z0: number, x1: number, z1: number): Region {
    const cand: number[] = [];
    this.near((x0 + x1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) / 2 + R_INF + 10, cand);
    return { cand, sg: this.segsNear(x0, z0, x1, z1, clampR(4) + 24) };
  }

  /** Höhe des Geländes an (x, z) wie auf der feinsten Kachel */
  heightIn(r: Region, x: number, z: number): number {
    return this.heightAt(x, z, r.cand, r.sg, 4).h;
  }

  /** Segmente in einem Rechteck (+ Rand) als flache Zahlenliste */
  private segsNear(x0: number, z0: number, x1: number, z1: number, m = 40): SegGrid {
    const S = this.s;
    const t = this.track;
    const list: number[] = [];
    for (let q = 0; q < S.n; q++) {
      const sx = S.x[q];
      const sz = S.z[q];
      if (sx < x0 - m || sx > x1 + m || sz < z0 - m || sz > z1 + m) continue;
      const i0 = (S.k0 + q) * STEP;
      for (let j = 0; j < STEP; j++) {
        const i = i0 + j;
        if (i < t.first) continue;
        const s: Seg = t.seg(i);
        const [lL, lR] = s.tunnel ? [0, 0] : this.lim(i);
        // 1 = Tunnel (Berg darüber), 2 = Tunnelende nahe am Portal (keine Klemme), 0 = offene Straße
        let tun = 0;
        if (s.tunnel) {
          let deep = true;
          for (let d = -3; d <= 3 && deep; d++) if (!t.seg(Math.max(t.first, i + d)).tunnel) deep = false;
          tun = deep ? 1 : 2;
        }
        list.push(s.wx, s.wz, Math.min(s.y, s.y + s.grade * SEG), Math.cos(s.th), Math.sin(s.th), tun, s.portal, lL, lR);
      }
    }
    // nach Zellen sortieren (Zellgröße = Suchradius, dann reichen die 3×3 Nachbarzellen)
    const buf = Float64Array.from(list);
    const n = list.length / 9;
    const cs = m;
    const gx0 = x0 - m;
    const gz0 = z0 - m;
    const nx = Math.max(1, Math.ceil((x1 - x0 + 2 * m) / cs) + 1);
    const nz = Math.max(1, Math.ceil((z1 - z0 + 2 * m) / cs) + 1);
    const cellOf = new Int32Array(n);
    const count = new Int32Array(nx * nz + 1);
    for (let k = 0; k < n; k++) {
      const ii = Math.min(nx - 1, Math.max(0, Math.floor((buf[k * 9] - gx0) / cs)));
      const jj = Math.min(nz - 1, Math.max(0, Math.floor((buf[k * 9 + 1] - gz0) / cs)));
      cellOf[k] = jj * nx + ii;
      count[cellOf[k] + 1]++;
    }
    for (let c = 0; c < nx * nz; c++) count[c + 1] += count[c];
    const start = count.slice();
    const fill = count.slice();
    const order = new Int32Array(n);
    for (let k = 0; k < n; k++) order[fill[cellOf[k]]++] = k;
    return { buf, n, x0: gx0, z0: gz0, cs, nx, nz, start, order };
  }

  // ---------------------------------------------------------------- Kachel

  /**
   * Kachel (Stufe lv, Index tx/tz) bauen: Gitter mit Rand für saubere Normalen, Farben nach Höhe,
   * Steilheit, Wald und Schnee, Seen als eigene Wasserfläche, Schürzen an den Rändern gegen Ritzen.
   */
  buildTile(lv: number, tx: number, tz: number): TileData {
    const it = this.tileSteps(lv, tx, tz);
    for (;;) { const r = it.next(); if (r.done) return r.value; }
  }

  /** Wie buildTile, aber in Häppchen: liefert zwischendurch die Kontrolle zurück (kein Ruckeln) */
  *tileSteps(lv: number, tx: number, tz: number): Generator<void, TileData, void> {
    const L = LEVELS[lv];
    const N = L.n;
    const cell = L.size / N;
    const x0 = tx * L.size;
    const z0 = tz * L.size;
    const cx = x0 + L.size / 2;
    const cz = z0 + L.size / 2;
    const cand: number[] = [];
    this.near(cx, cz, L.size * 0.75 + R_INF, cand);
    const sgr = lv < 2 ? this.segsNear(x0, z0, x0 + L.size, z0 + L.size, clampR(cell) + 24) : null;
    const G = N + 3; // mit Rand
    const H = new Float32Array(G * G);
    const W = new Float32Array(G * G);
    const LY = new Float32Array(G * G);
    const FL = new Float32Array(G * G);
    const BI = new Uint8Array(G * G);
    const DR = new Float32Array(G * G);
    const SK = new Uint8Array(G * G);
    const NR = new Uint8Array(G * G);
    const RG = new Float32Array(G * G);
    // Großform: auf der feinsten Stufe nur jeden zweiten Punkt rechnen und dazwischen interpolieren.
    // Die Stützpunkte liegen auf Vielfachen von 8 m – genau dort, wo die nächstgröbere Stufe ihre Punkte
    // hat; so stimmen die Höhen an der Grenze zwischen den Stufen überein.
    const step = lv === 0 ? 2 : 1;
    const off = step; // Stützpunkt 0 liegt bei x0 − step·cell
    const GC = Math.floor((G - 1 + off - 1) / step) + 2;
    const cH = new Float32Array(GC * GC);
    const cW = new Float32Array(GC * GC);
    const cLY = new Float32Array(GC * GC);
    const cFL = new Float32Array(GC * GC);
    const cB = new Uint8Array(GC * GC);
    const cDR = new Float32Array(GC * GC);
    const cRG = new Float32Array(GC * GC);
    for (let j = 0; j < GC; j++) {
      for (let i = 0; i < GC; i++) {
        const p = this.base(x0 + (i * step - off) * cell, z0 + (j * step - off) * cell, cand);
        const k = j * GC + i;
        cH[k] = p.h; cW[k] = p.water; cLY[k] = p.lakeY; cFL[k] = p.floor; cB[k] = p.b; cDR[k] = p.dRoad; cRG[k] = p.ridge;
      }
      if (j % 3 === 2) yield;
    }
    const hp = this.hp;
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const x = x0 + (i - 1) * cell;
        const z = z0 + (j - 1) * cell;
        const fi = (i - 1 + off) / step;
        const fj = (j - 1 + off) / step;
        const ii = Math.min(GC - 2, Math.floor(fi));
        const jj = Math.min(GC - 2, Math.floor(fj));
        const u = fi - ii;
        const v = fj - jj;
        const k00 = jj * GC + ii;
        const lerp4 = (A: Float32Array) => A[k00] * (1 - u) * (1 - v) + A[k00 + 1] * u * (1 - v) + A[k00 + GC] * (1 - u) * v + A[k00 + GC + 1] * u * v;
        hp.h = lerp4(cH); hp.water = lerp4(cW); hp.lakeY = lerp4(cLY); hp.floor = lerp4(cFL);
        hp.dRoad = lerp4(cDR); hp.ridge = lerp4(cRG);
        hp.b = cB[(jj + (v > 0.5 ? 1 : 0)) * GC + ii + (u > 0.5 ? 1 : 0)];
        const p = this.finish(x, z, hp, sgr, cell);
        const k = j * G + i;
        H[k] = p.h;
        W[k] = p.water;
        LY[k] = p.lakeY;
        FL[k] = p.floor;
        BI[k] = p.b;
        DR[k] = p.dRoad;
        SK[k] = p.skip ? 1 : 0;
        NR[k] = p.near ? 1 : 0;
        RG[k] = p.ridge;
      }
      if (j % 6 === 5) yield;
    }
    // Normalen aus dem Gitter (Rand macht sie über Kachelgrenzen hinweg gleich)
    const V = N + 1;
    const pos = new Float32Array((V * V + 4 * V * 2) * 3);
    const nor = new Float32Array(pos.length);
    const col = new Float32Array(pos.length);
    const uvs = new Float32Array((pos.length / 3) * 2);
    let minY = Infinity;
    let maxY = -Infinity;
    const pal = (b: number) => BIOME_PALETTES[BIOMES[b]];
    const tmp: RGBf = [0, 0, 0];
    const mix = (a: RGBf, b: RGBf, t: number, out: RGBf) => { out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t; return out; };
    const cols = this.colorsFor(lv);
    for (let j = 0; j < V; j++) {
      for (let i = 0; i < V; i++) {
        const k = (j + 1) * G + (i + 1);
        const x = x0 + i * cell;
        const z = z0 + j * cell;
        const y = H[k];
        const hx = (H[k + 1] - H[k - 1]) / (2 * cell);
        const hz = (H[k + G] - H[k - G]) / (2 * cell);
        let nx = -hx;
        let ny = 1;
        let nz = -hz;
        const nl = Math.hypot(nx, ny, nz);
        nx /= nl; ny /= nl; nz /= nl;
        const v = j * V + i;
        pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
        nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz;
        // Höhe mit einrechnen: an steilen Hängen keine langgezogenen Streifen
        uvs[v * 2] = (x + y * 0.7) / 9; uvs[v * 2 + 1] = (z - y * 0.7) / 9;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        // Farbe
        const b = BI[k];
        const C = cols[b];
        const above = y - FL[k];
        const steep = 1 - sstep(0.5, 0.76, ny);
        const n1 = fbm(x / 230, z / 230, 3);
        const n2 = vnoise(x / 31, z / 31);
        const wet = W[k];
        let c: RGBf;
        if (wet > 0.5 && y < LY[k] - 0.5) {
          c = mix(C.sand, C.lakeBed, sstep(0, 6, LY[k] - y), tmp);
        } else {
          // Wiese oder Feld im Tal, Wald am Hang, Fels oben und an steilen Stellen
          const field = C.fieldy * sstep(55, 12, above) * (n1 > 0.5 ? 1 : 0.4);
          c = mix(C.meadow, C.meadow2, n2, tmp);
          if (field > 0) c = mix(c, (Math.floor(x / 37 + n1 * 4) + Math.floor(z / 29)) % 3 === 0 ? C.field : C.field2, field * 0.85, c);
          const forest = sstep(C.forestThr, C.forestThr + 0.08, n1 + (n2 - 0.5) * 0.12) * sstep(C.treeLine + 25, C.treeLine - 15, above) * (1 - steep);
          if (forest > 0) c = mix(c, mix(C.forest, C.forest2, n2, [0, 0, 0]), forest, c);
          const rocky = Math.max(steep, sstep(C.rockLine - 20, C.rockLine + 60, above + (n1 - 0.5) * 40) * 0.85);
          if (rocky > 0) c = mix(c, mix(C.rock, C.rockDark, n2 * 0.8 + steep * 0.3, [0, 0, 0]), rocky, c);
          const snow = sstep(C.snowLine - 25, C.snowLine + 15, above + (n2 - 0.5) * 50 + (n1 - 0.5) * 60) * sstep(0.5, 0.74, ny);
          if (snow > 0) c = mix(c, C.snow, snow, c);
        }
        const shadeV = 0.94 + (n2 - 0.5) * 0.1;
        col[v * 3] = c[0] * shadeV; col[v * 3 + 1] = c[1] * shadeV; col[v * 3 + 2] = c[2] * shadeV;
        void pal;
      }
    }
    // Dreiecke (ohne die ausgesparten Stellen an Tunnelportalen)
    const idx: number[] = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * V + i;
        const b = a + 1;
        const c = a + V;
        const d = c + 1;
        const ka = (j + 1) * G + (i + 1);
        if (SK[ka] || SK[ka + 1] || SK[ka + G] || SK[ka + G + 1]) continue;
        // Diagonale entlang der kleineren Höhendifferenz (weniger Knicke)
        if (Math.abs(H[ka] - H[ka + G + 1]) < Math.abs(H[ka + 1] - H[ka + G])) idx.push(a, c, d, a, d, b);
        else idx.push(a, c, b, b, c, d);
      }
    }
    // Schürzen an allen vier Rändern: verdecken Ritzen zu Nachbarn und zur gröberen Stufe
    let vn = V * V;
    const skirt = (vIdx: number) => {
      pos[vn * 3] = pos[vIdx * 3]; pos[vn * 3 + 1] = pos[vIdx * 3 + 1] - L.skirt; pos[vn * 3 + 2] = pos[vIdx * 3 + 2];
      nor[vn * 3] = nor[vIdx * 3]; nor[vn * 3 + 1] = nor[vIdx * 3 + 1]; nor[vn * 3 + 2] = nor[vIdx * 3 + 2];
      col[vn * 3] = col[vIdx * 3] * 0.8; col[vn * 3 + 1] = col[vIdx * 3 + 1] * 0.8; col[vn * 3 + 2] = col[vIdx * 3 + 2] * 0.8;
      uvs[vn * 2] = uvs[vIdx * 2]; uvs[vn * 2 + 1] = uvs[vIdx * 2 + 1] + 0.5;
      return vn++;
    };
    const edge = (list: number[]) => {
      const low = list.map(skirt);
      for (let q = 0; q < list.length - 1; q++) {
        const a = list[q];
        const b = list[q + 1];
        const ka = this.gridK(a, V, G);
        const kb = this.gridK(b, V, G);
        if (SK[ka] || SK[kb]) continue;
        // beide Seiten, damit die Schürze aus jeder Richtung deckt
        idx.push(a, low[q], b, b, low[q], low[q + 1]);
        idx.push(a, b, low[q], b, low[q + 1], low[q]);
      }
    };
    const rowS: number[] = [];
    const rowN: number[] = [];
    const colW: number[] = [];
    const colE: number[] = [];
    for (let q = 0; q < V; q++) { rowS.push(q); rowN.push(N * V + q); colW.push(q * V); colE.push(q * V + N); }
    edge(rowS); edge(rowN); edge(colW); edge(colE);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, vn * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, vn * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, vn * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs.subarray(0, vn * 2), 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();

    // Seen: eigene Wasserfläche auf fester Höhe
    let water: THREE.BufferGeometry | null = null;
    {
      const wp: number[] = [];
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const ka = (j + 1) * G + (i + 1);
          const ks = [ka, ka + 1, ka + G, ka + G + 1];
          let wet = 0;
          for (const k of ks) wet += W[k] > 0.35 ? 1 : 0;
          if (wet < 1) continue;
          const ly = (LY[ka] + LY[ka + 1] + LY[ka + G] + LY[ka + G + 1]) / 4;
          const xa = x0 + i * cell;
          const za = z0 + j * cell;
          // eine Zelle Rand mitnehmen, damit das Ufer ins Wasser taucht
          wp.push(xa, ly, za, xa, ly, za + cell, xa + cell, ly, za + cell, xa, ly, za, xa + cell, ly, za + cell, xa + cell, ly, za);
        }
      }
      if (wp.length) {
        water = new THREE.BufferGeometry();
        water.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
        water.computeVertexNormals();
        water.computeBoundingSphere();
      }
    }

    // Bäume (nur feinste Stufe): Wald nach Rauschmaske, vereinzelte Bäume auf Wiesen
    const trees: TreeSpot[] = [];
    if (lv === 0) {
      const step = 7;
      const M = Math.floor(L.size / step);
      for (let j = 0; j < M; j++) {
        for (let i = 0; i < M; i++) {
          const r1 = h2(tx * 1000 + i, tz * 1000 + j);
          const r2 = h2(tx * 1000 + i + 500, tz * 1000 + j + 300);
          const x = x0 + (i + 0.15 + r1 * 0.7) * step;
          const z = z0 + (j + 0.15 + r2 * 0.7) * step;
          // nächster Gitterpunkt
          const gi = Math.round((x - x0) / cell) + 1;
          const gj = Math.round((z - z0) / cell) + 1;
          const k = gj * G + gi;
          if (SK[k] || NR[k] || W[k] > 0.2 || DR[k] < LIM_MAX + 3) continue;
          const b = BI[k];
          const C = cols[b];
          // Höhe genau wie im Gitter (bilinear), damit nichts schwebt
          const fx = (x - x0) / cell + 1;
          const fz = (z - z0) / cell + 1;
          const ix = Math.min(G - 2, Math.floor(fx));
          const iz = Math.min(G - 2, Math.floor(fz));
          const ux = fx - ix;
          const uz = fz - iz;
          const k0 = iz * G + ix;
          const y = H[k0] * (1 - ux) * (1 - uz) + H[k0 + 1] * ux * (1 - uz) + H[k0 + G] * (1 - ux) * uz + H[k0 + G + 1] * ux * uz;
          const hx = (H[k + 1] - H[k - 1]) / (2 * cell);
          const hz = (H[k + G] - H[k - G]) / (2 * cell);
          const ny = 1 / Math.hypot(hx, 1, hz);
          if (ny < 0.72) continue;
          const above = y - FL[k];
          if (above > C.treeLine + 18) continue;
          const n1 = fbm(x / 230, z / 230, 3);
          const n2 = vnoise(x / 31, z / 31);
          const forest = sstep(C.forestThr, C.forestThr + 0.08, n1 + (n2 - 0.5) * 0.12);
          const p = forest > 0.5 ? 0.85 : C.meadowTrees;
          if (h2(tx * 3000 + i * 7, tz * 3000 + j * 13) > p) continue;
          const kind = pickTree(b, above, h2(i * 31 + tx, j * 17 + tz), forest > 0.5);
          trees.push({ kind, x, y: y - 0.35, z, s: 0.75 + h2(i + tx * 77, j + tz * 91) * 0.65, rot: r1 * Math.PI * 2, tint: 0.82 + r2 * 0.32 });
        }
      }
    }
    return { geo, water, trees, minY, maxY };
  }

  private gridK(v: number, V: number, G: number): number {
    const j = Math.floor(v / V);
    const i = v - j * V;
    return (j + 1) * G + (i + 1);
  }

  private colorCache = new Map<number, ColorSet[]>();
  private colorsFor(lv: number): ColorSet[] {
    const hit = this.colorCache.get(lv);
    if (hit) return hit;
    const out = BIOMES.map((b) => colorSet(b));
    this.colorCache.set(lv, out);
    return out;
  }
}

interface ColorSet {
  meadow: RGBf; meadow2: RGBf; forest: RGBf; forest2: RGBf; rock: RGBf; rockDark: RGBf; snow: RGBf;
  field: RGBf; field2: RGBf; sand: RGBf; lakeBed: RGBf;
  fieldy: number; forestThr: number; treeLine: number; rockLine: number; snowLine: number; meadowTrees: number;
}

function colorSet(b: BiomeId): ColorSet {
  const p = BIOME_PALETTES[b];
  const L = (c: RGB) => lin255(c[0], c[1], c[2]);
  const mid = p.ground.meadow[0];
  const base = {
    meadow: L(mid),
    meadow2: L(mixRGB(mid, [150, 170, 70], 0.25)),
    forest: L([46, 82, 44]),
    forest2: L([58, 96, 50]),
    rock: L(mixRGB(p.rock, [178, 176, 170], 0.45)),
    rockDark: L(mixRGB(p.rockDark, [132, 130, 126], 0.4)),
    snow: L([240, 245, 250]),
    field: L([196, 176, 92]),
    field2: L([142, 168, 72]),
    sand: L([196, 186, 160]),
    lakeBed: L(mixRGB(p.water, [40, 90, 110], 0.4)),
  };
  switch (b) {
    // Höhen in Metern über dem Talboden (eine Abfahrt beginnt gut 250 m darüber)
    case 'pass': return { ...base, meadow: L([136, 168, 82]), meadow2: L([122, 154, 76]), fieldy: 0, forestThr: 0.5, treeLine: 195, rockLine: 245, snowLine: 330, meadowTrees: 0.02 };
    case 'alpine': return { ...base, fieldy: 0.25, forestThr: 0.48, treeLine: 195, rockLine: 250, snowLine: 335, meadowTrees: 0.03 };
    case 'forest': return { ...base, fieldy: 0.15, forestThr: 0.38, treeLine: 200, rockLine: 255, snowLine: 340, meadowTrees: 0.05 };
    case 'village': return { ...base, fieldy: 1, forestThr: 0.48, treeLine: 195, rockLine: 255, snowLine: 340, meadowTrees: 0.04 };
    case 'lake': return { ...base, fieldy: 0.6, forestThr: 0.48, treeLine: 200, rockLine: 260, snowLine: 345, meadowTrees: 0.04 };
    case 'vineyard': return { ...base, meadow: L([150, 170, 80]), field: L([200, 184, 98]), field2: L([128, 150, 62]), fieldy: 1, forestThr: 0.58, treeLine: 300, rockLine: 420, snowLine: 9999, meadowTrees: 0.05 };
  }
}

function pickTree(b: number, above: number, r: number, forest: boolean): string {
  switch (BIOMES[b]) {
    case 'pass': return above > 170 ? (r < 0.5 ? 'larch' : 'pine') : r < 0.7 ? 'pine' : 'larch';
    case 'alpine': return above > 160 ? (r < 0.5 ? 'larch' : 'pine') : r < 0.62 ? 'pine' : r < 0.9 ? 'larch' : 'tree';
    case 'forest': return r < 0.68 ? 'pine' : r < 0.9 ? 'larch' : 'tree';
    case 'village': return forest ? (r < 0.6 ? 'pine' : 'tree') : r < 0.5 ? 'treeRound' : 'tree';
    case 'lake': return forest ? (r < 0.5 ? 'pine' : 'tree') : r < 0.4 ? 'tree' : r < 0.7 ? 'cypress' : 'treeRound';
    default: return forest ? (r < 0.5 ? 'treeRound' : 'tree') : r < 0.45 ? 'cypress' : r < 0.75 ? 'olive' : 'treeRound';
  }
}
