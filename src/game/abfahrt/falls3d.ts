/**
 * Wasserfälle: Lage und Gestalt (aus dem Gelände) und ihre Geometrie.
 *
 * Ein Wasserfall folgt dem steilsten Weg bergab (meist eine Rinne im Hang). Das Wasser läuft in einem felsigen
 * Bett, das dem Hang folgt (nasser dunkler Fels, Ufer mit Moos, zur Wiese hin auslaufend). Wo der Hang steil ist,
 * hält eine Felsstufe das Wasser kurz auf, dann stürzt es frei vor der nassen Wand hinab (Wurfparabel, nach unten
 * breiter, ein lockerer Schleier davor) und landet in Gischt; dazwischen schießt es weiß über den Fels. Unten ein
 * Becken mit Felsrand, aus dem ein Bach weiter talwärts fließt; oben kommt ein schmaler Bach den Hang herunter.
 *
 * Die Lage wird überall gleich berechnet (aus der feinen Geländehöhe, unabhängig von der Kachel): So weiß auch
 * die feinste Stufe, wo keine Bäume stehen dürfen. Gebaut wird auf der mittleren Stufe; Fels reicht tief in den
 * Boden und Wasserflächen liegen über der höheren der beiden Geländestufen – nichts schwebt, nichts versinkt.
 */
import * as THREE from 'three';

// ------------------------------------------------------------------ Lage

/** Felsstufe: das Wasser hält von s0 bis zur Kante s1 die Höhe und stürzt dann F Meter frei hinab */
export interface FallStep { s0: number; s1: number; F: number; v0: number }

export interface FallSpec {
  n: number;
  /**
   * Pfad: Lage, Bogenlänge (Draufsicht), Boden der feinen Stufe (hi: für das Wasser, nie bergauf; lo: tatsächlich),
   * Unterschied zur mittleren Stufe (d1: die Geometrie folgt im Shader dem Übergang dorthin), Hangneigung
   */
  x: Float32Array; z: Float32Array; s: Float32Array; hi: Float32Array; lo: Float32Array; d1: Float32Array; sl: Float32Array;
  /** Boden links und rechts des Laufs (SIDE Meter neben der Mitte) – das Bett schmiegt sich an den Hang */
  hl: Float32Array; hr: Float32Array;
  /** halbe Breite des Wassers je Pfadpunkt */
  hw: Float32Array;
  /** Index am Kopf des Falls (davor: Zulauf); Bogenlänge, wo der steile Teil endet */
  top: number; sEnd: number;
  steps: FallStep[];
  /** Becken am Fuß: Mitte (Bogenlänge), Spiegel, Halbmesser, Boden rundum (POOL_N Punkte außerhalb des Rands) –
   *  null, wenn der Pfad vorher endet (See, Straße) */
  pool: { s: number; y: number; r: number; ring: Float32Array } | null;
  /** Bach ab Bogenlänge (bis zum Pfadende) */
  creekS: number;
  seed: number;
  /** Landschaft (für die Felsfarbe) */
  b: number;
  box: [number, number, number, number];
  /** Baumfreiheit: je Pfadpunkt x, z, Halbmesser, Art (1 Fall/Becken, 0 Zulauf/Bach) */
  clr: Float32Array;
}

/** Geländeabfrage für die Lage: feine Höhe mit Zusatzwerten */
export interface FallProbe { h: number; water: number; floor: number; b: number; dRoad: number; skip: boolean; near: boolean }

/** feste Pseudo-Zufallszahl 0–1 */
export function fh(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const STEP_M = 3;
/** Abstand der seitlichen Bodenproben */
const SIDE = 3.5;
/** Bodenproben rund ums Becken */
const POOL_N = 12;
/** Wasserspiegel über dem (höheren) Boden */
const CLEAR = 0.3;
const sst = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
/** wie weit das Wasser nach F Metern freiem Fall vor der Kante ist */
const outOf = (v0: number, F: number) => 0.2 + v0 * Math.sqrt((2 * Math.max(0, F)) / 9.81);

/** Wert eines Pfad-Felds bei Bogenlänge s (linear) */
function lerpS(S: Float32Array, A: Float32Array, n: number, s: number): number {
  if (s <= S[0]) return A[0];
  if (s >= S[n - 1]) return A[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
  const t = (s - S[lo]) / Math.max(1e-4, S[hi] - S[lo]);
  return A[lo] + (A[hi] - A[lo]) * t;
}

/**
 * Lage eines Wasserfalls ab Kandidat (cx, cz) – oder null, wenn dort keiner hinpasst.
 * probe: feine Höhe (mit Abstand zur Straße); h1: Höhe der mittleren Stufe (bilinear auf ihrem Raster);
 * tile: Kachel der mittleren Stufe [x0, z0, x1, z1], in die der Fall samt Becken ganz passen muss.
 */
export function* planFall(cx: number, cz: number, seed: number, wid: number, probe: (x: number, z: number) => FallProbe,
  h1: (x: number, z: number) => number, tile: [number, number, number, number], snowAbove: (b: number) => number,
  late: () => boolean): Generator<void, FallSpec | null, void> {
  const p0 = probe(cx, cz);
  if (p0.skip || p0.near || p0.water > 0.05 || p0.dRoad < 90) return null;
  const above = p0.h - p0.floor;
  const b = p0.b;
  if (above < 30 || above > snowAbove(b)) return null;
  const hAt = (x: number, z: number) => probe(x, z).h;
  const g = [0, 0];
  /** Gefälle (vorwärts genommen: zwei Abfragen statt vier); h0: Höhe am Punkt */
  const grad = (x: number, z: number, h0: number) => {
    g[0] = (hAt(x + 2.5, z) - h0) / 2.5;
    g[1] = (hAt(x, z + 2.5) - h0) / 2.5;
    return Math.hypot(g[0], g[1]);
  };
  if (grad(cx, cz, p0.h) < 0.85) return null;
  if (late()) yield;

  // Zulauf: ein Stück bergauf (steilster Anstieg), solange es noch ansteigt
  const up: number[][] = [];
  {
    let x = cx, z = cz, dx = 0, dz = 0;
    for (let q = 0; q < 9; q++) {
      const sl = grad(x, z, hAt(x, z));
      if (sl < 0.12) break;
      const ux = g[0] / sl, uz = g[1] / sl;
      dx = q ? dx * 0.4 + ux * 0.6 : ux; dz = q ? dz * 0.4 + uz * 0.6 : uz;
      const l = Math.hypot(dx, dz) || 1;
      x += (dx / l) * STEP_M; z += (dz / l) * STEP_M;
      up.push([x, z]);
    }
  }
  // Fall und Bach: steilster Weg bergab mit etwas Trägheit (keine Zickzacks im Raster)
  const down: number[][] = [];
  let fallEnd = -1;
  {
    let x = cx, z = cz, dx = 0, dz = 0;
    let creekLen = 0;
    for (let q = 0; q < 110; q++) {
      const pr = probe(x, z);
      if (pr.water > 0.15 || pr.skip || pr.near) break;
      if (pr.dRoad < (fallEnd < 0 ? 60 : 36)) break;
      const sl = grad(x, z, pr.h);
      if ((q & 3) === 3 && late()) yield;
      down.push([x, z, sl]);
      if (fallEnd < 0 && q > 4 && sl < 0.32) fallEnd = down.length - 1;
      if (fallEnd >= 0) {
        creekLen += STEP_M;
        if (sl < 0.035 || creekLen > 96) break;
      }
      if (sl < 1e-4) break;
      const ux = -g[0] / sl, uz = -g[1] / sl;
      dx = q ? dx * 0.45 + ux * 0.55 : ux; dz = q ? dz * 0.45 + uz * 0.55 : uz;
      const l = Math.hypot(dx, dz) || 1;
      x += (dx / l) * STEP_M; z += (dz / l) * STEP_M;
    }
  }
  if (fallEnd < 0) fallEnd = down.length - 1;
  if (down.length < 8) return null;

  // ganzer Pfad: Zulauf (umgekehrt) + Fall + Bach
  const pts: number[][] = [];
  for (let q = up.length - 1; q >= 0; q--) pts.push([up[q][0], up[q][1]]);
  const top = pts.length;
  for (const d of down) pts.push([d[0], d[1]]);
  const n = pts.length;
  const X = new Float32Array(n), Z = new Float32Array(n), S = new Float32Array(n), HI = new Float32Array(n), LO = new Float32Array(n), D1 = new Float32Array(n), SL = new Float32Array(n);
  const HL = new Float32Array(n), HR = new Float32Array(n);
  for (let q = 0; q < n; q++) {
    X[q] = pts[q][0]; Z[q] = pts[q][1];
    if (q) S[q] = S[q - 1] + Math.hypot(X[q] - X[q - 1], Z[q] - Z[q - 1]);
  }
  for (let q = 0; q < n; q++) {
    const f = hAt(X[q], Z[q]);
    HI[q] = f; LO[q] = f;
    D1[q] = h1(X[q], Z[q]) - f;
    // seitlich (quer zur Laufrichtung)
    const qa = Math.max(0, q - 1), qb = Math.min(n - 1, q + 1);
    let fx = X[qb] - X[qa], fz = Z[qb] - Z[qa];
    const l = Math.hypot(fx, fz) || 1;
    fx /= l; fz /= l;
    HL[q] = hAt(X[q] + fz * SIDE, Z[q] - fx * SIDE);
    HR[q] = hAt(X[q] - fz * SIDE, Z[q] + fx * SIDE);
    if ((q & 3) === 3 && late()) yield;
  }
  for (let q = 0; q < n; q++) {
    const a = Math.max(0, q - 2), c = Math.min(n - 1, q + 2);
    SL[q] = (HI[a] - HI[c]) / Math.max(1, S[c] - S[a]);
  }
  const iEnd = top + fallEnd;
  const drop = HI[top] - HI[iEnd];
  if (drop < 30) return null;
  const sEnd = S[iEnd];
  const rnd = (k: number) => fh(cx * 7 + k * 131, cz * 3 + k * 71, seed);
  const hiS = (s: number) => lerpS(S, HI, n, s);
  const slS = (s: number) => lerpS(S, SL, n, s);

  // Breite: schwankt, am Steilen breiter (das Wasser fächert über den Fels), Zulauf schmal, Bach schmaler
  const base = wid / 2;
  const HW = new Float32Array(n);
  for (let q = 0; q < n; q++) {
    const w = 0.8 + 0.22 * Math.sin(S[q] / 9 + seed) + 0.12 * Math.sin(S[q] / 3.7 + seed * 2.3);
    let k = 1 + 0.45 * sst(0.8, 2, SL[q]);
    if (q < top) k = 0.4 + 0.45 * (q / Math.max(1, top));
    if (q > iEnd) k = 0.62;
    HW[q] = base * w * k;
  }

  // Felsstufen: im Steilen hoch und oft, im Mittelsteilen klein (Kaskaden), dazwischen schießt das Wasser über den Fels
  const steps: FallStep[] = [];
  {
    let s = S[top] + 1 + 2 * rnd(1);
    for (let k = 0; k < 60 && s < sEnd - 3; k++) {
      const m = slS(s + 1.5);
      let l = 0;
      if (m >= 0.95) l = 2.6 + 2.4 * rnd(k + 3);
      else if (m >= 0.55) l = 1.1 + 0.7 * rnd(k + 3);
      if (l > 0 && s + l + 1.5 <= sEnd) {
        const F = hiS(s) - hiS(s + l) - 0.04 * l;
        const v0 = 0.8 + 0.6 * rnd(k + 7);
        let gap = m >= 0.95 ? 1.2 + 4.5 * rnd(k + 5) : 2.5 + 5 * rnd(k + 5);
        if (F >= 0.9) {
          steps.push({ s0: s, s1: s + l, F, v0 });
          gap = Math.max(gap, outOf(v0, F) + 0.8);
        }
        s += l + gap;
      } else s += 1.5;
    }
  }
  const big = steps.filter((t) => t.F >= 2.5);
  if (big.reduce((t, x) => t + x.F, 0) < 10 || !steps.some((t) => t.F >= 3.2)) return null;

  // Becken am Fuß des steilen Teils
  const pr = Math.max(2.4, Math.min(5.5, 1.2 + HW[iEnd] * 1.4 + drop * 0.015));
  const sP = sEnd + pr * 0.6;
  let pool: FallSpec['pool'] = null;
  // Spiegel auf Höhe des Bodens in der Mitte: bergauf taucht das Becken unter den Hang (natürliches Ufer),
  // talwärts hält es ein niedriger Felsrand
  if (sP + pr + 2 <= S[n - 1]) {
    let qc = 0;
    while (qc < n - 2 && S[qc + 1] < sP) qc++;
    const t = (sP - S[qc]) / Math.max(1e-3, S[qc + 1] - S[qc]);
    const px = X[qc] + (X[qc + 1] - X[qc]) * t, pz = Z[qc] + (Z[qc + 1] - Z[qc]) * t;
    let fx = X[qc + 1] - X[qc], fz = Z[qc + 1] - Z[qc];
    const l = Math.hypot(fx, fz) || 1;
    fx /= l; fz /= l;
    const ring = new Float32Array(POOL_N);
    for (let i = 0; i < POOL_N; i++) {
      const th = (i / POOL_N) * Math.PI * 2;
      const rr2 = pr + 1.6;
      ring[i] = hAt(px + (fx * Math.cos(th) * 1.15 - fz * Math.sin(th)) * rr2, pz + (fz * Math.cos(th) * 1.15 + fx * Math.sin(th)) * rr2);
    }
    pool = { s: sP, y: hAt(px, pz) + 0.1, r: pr, ring };
    if (late()) yield;
  }
  const creekS = pool ? sP + pr : sEnd;

  // Kasten und Baumfreiheit (Bett mit Ufern, an Stufen so breit wie die Böschung)
  const clr = new Float32Array(n * 4);
  for (let q = 0; q < n; q++) {
    let kind = 1;
    let r = HW[q] + 3.2;
    const st = steps.find((t) => S[q] >= t.s0 - 1 && S[q] <= t.s1 + 2);
    if (st) r += 0.7 * st.F;
    if (pool && Math.abs(S[q] - pool.s) < pool.r + 3) r = Math.max(r, pool.r + 3.5);
    if (q > iEnd && (!pool || S[q] > pool.s + pool.r + 2)) { r = HW[q] + 1.6; kind = 0; }
    if (q < top) { r = HW[q] + 1.4; kind = 0; }
    clr[q * 4] = X[q]; clr[q * 4 + 1] = Z[q]; clr[q * 4 + 2] = r; clr[q * 4 + 3] = kind;
  }
  const inside = (q: number) => {
    const r = clr[q * 4 + 2] + 3;
    return X[q] - r > tile[0] && Z[q] - r > tile[1] && X[q] + r < tile[2] && Z[q] + r < tile[3];
  };
  // ganz in der Kachel der mittleren Stufe (sonst schnitte ihr Rand ihn ab): der Bach darf vorher enden
  let m = n;
  for (let q = 0; q < n; q++) if (!inside(q)) { m = q; break; }
  const need = pool ? Math.max(iEnd, S.findIndex((v) => v > pool.s + pool.r + 3)) : iEnd + 1;
  if (need < 0 || m <= need) return null;

  const sl = (A: Float32Array) => A.slice(0, m);
  let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
  for (let q = 0; q < m; q++) {
    // samt dem Saum, in dem das Gelände felsig und feucht ausläuft
    const r = clr[q * 4 + 2] + 34;
    bx0 = Math.min(bx0, X[q] - r); bz0 = Math.min(bz0, Z[q] - r); bx1 = Math.max(bx1, X[q] + r); bz1 = Math.max(bz1, Z[q] + r);
  }
  return {
    n: m, x: sl(X), z: sl(Z), s: sl(S), hi: sl(HI), lo: sl(LO), d1: sl(D1), sl: sl(SL), hl: sl(HL), hr: sl(HR), hw: sl(HW), top, sEnd, steps, pool, creekS,
    seed, b, box: [bx0, bz0, bx1, bz1], clr: clr.slice(0, m * 4),
  };
}

/**
 * Abstand von (x, z) zum Rand des freien Bereichs der Fälle (negativ: drinnen; Infinity: keiner nah) und die
 * Art dort (1 Fall/Becken, 0 Bach). Für Bäume, Kronendach und den Übergang im Gelände.
 */
const fdOut = { e: Infinity, k: 0 };
export function fallDist(list: FallSpec[], x: number, z: number, reach = 0): { e: number; k: number } {
  fdOut.e = Infinity;
  fdOut.k = 0;
  for (const f of list) {
    if (x < f.box[0] - reach || x > f.box[2] + reach || z < f.box[1] - reach || z > f.box[3] + reach) continue;
    const c = f.clr;
    for (let q = 0; q < f.n - 1; q++) {
      const ax = c[q * 4], az = c[q * 4 + 1], bx = c[q * 4 + 4], bz = c[q * 4 + 5];
      const vx = bx - ax, vz = bz - az;
      const l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
      const dx = x - ax - vx * t, dz = z - az - vz * t;
      const e = Math.sqrt(dx * dx + dz * dz) - (c[q * 4 + 2] + (c[q * 4 + 6] - c[q * 4 + 2]) * t);
      if (e < fdOut.e) { fdOut.e = e; fdOut.k = c[q * 4 + 3] + (c[q * 4 + 7] - c[q * 4 + 3]) * t; }
    }
  }
  return fdOut;
}

/** Liegt (x, z) im freien Bereich eines der Fälle (plus pad)? */
export function inFall(list: FallSpec[], x: number, z: number, pad = 0): boolean {
  return fallDist(list, x, z).e < pad;
}

// ------------------------------------------------------------------ Geometrie

export type RGBf = [number, number, number];
export interface FallColors { rock: RGBf; rockDark: RGBf; moss: RGBf; meadow: RGBf }

/** Felsen (für die Landmarken-Geometrie: Dreiecke ohne Index, Farbe, Höhenausgleich zur gröbsten Stufe) */
export interface RockOut { pos: number[]; col: number[]; dy: number[]; d1: number[] }

/** Höhenausgleich je Ecke: zur mittleren Stufe (d1) und von dort zur gröbsten (dy) – der Shader blendet sie über */
type Dy = [number, number];

export interface FallGeo { rock: RockOut; water: THREE.BufferGeometry; mist: THREE.BufferGeometry }

/** Sammler für alle Fälle einer Kachel */
export interface FallOut { rock: RockOut; W: WaterB; M: MistB; n: number }
export function fallOut(): FallOut { return { rock: { pos: [], col: [], dy: [], d1: [] }, W: new WaterB(), M: new MistB(), n: 0 }; }
export function fallGeo(o: FallOut): FallGeo | null {
  if (!o.n) return null;
  return { rock: o.rock, water: o.W.build(), mist: o.M.build() };
}

/** sattes Grün am Wasser (linear) */
const LUSH_C: RGBf = [0.035, 0.085, 0.03];
const mixc = (a: RGBf, b: RGBf, t: number): RGBf => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mulc = (a: RGBf, k: number): RGBf => [a[0] * k, a[1] * k, a[2] * k];

/** Wasser: Bänder mit Farbe, Deckkraft, Strömungskoordinate */
class WaterB {
  pos: number[] = []; col: number[] = []; al: number[] = []; uv: number[] = []; dy: number[] = []; idx: number[] = [];
  v(x: number, y: number, z: number, c: RGBf, a: number, u: number, w: number, d: Dy): number {
    this.pos.push(x, y, z); this.col.push(c[0], c[1], c[2]); this.al.push(a); this.uv.push(u, w); this.dy.push(d[0], d[1]);
    return this.pos.length / 3 - 1;
  }
  /** Raster rows × cols (Indizes ab first), Vierecke dazwischen */
  grid(first: number, rows: number, cols: number) {
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = first + r * cols + c;
        const b = a + cols;
        this.idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aAlpha', new THREE.Float32BufferAttribute(this.al, 1));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aDy', new THREE.Float32BufferAttribute(this.dy, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** Gischt: Bildtafeln (Mitte, Ecke, Phase/Größe/Steigen/Deckkraft) – drehen sich im Shader zur Kamera */
class MistB {
  pos: number[] = []; cor: number[] = []; prm: number[] = []; dy: number[] = []; uv: number[] = []; nrm: number[] = []; idx: number[] = [];
  puff(x: number, y: number, z: number, phase: number, size: number, rise: number, alpha: number, d: Dy) {
    const first = this.pos.length / 3;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      this.pos.push(x, y, z); this.cor.push(cx, cy); this.prm.push(phase, size, rise, alpha); this.dy.push(d[0], d[1]);
      this.uv.push((cx + 1) / 2, (cy + 1) / 2); this.nrm.push(0, 1, 0);
    }
    this.idx.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aCorner', new THREE.Float32BufferAttribute(this.cor, 2));
    g.setAttribute('aMist', new THREE.Float32BufferAttribute(this.prm, 4));
    g.setAttribute('aDy', new THREE.Float32BufferAttribute(this.dy, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    if (g.boundingSphere) g.boundingSphere.radius += 12;
    return g;
  }
}

/** Lage auf dem Pfad bei Bogenlänge s: Punkt, Richtungen, Boden, Neigung, Wasserbreite, Höhenausgleich */
interface At { x: number; z: number; fx: number; fz: number; rx: number; rz: number; hi: number; lo: number; sl: number; hw: number; dy: Dy }

/**
 * Geometrie eines Wasserfalls. dyAt: Höhenunterschied zur gröbsten Stufe an (x, z) (für deren Übergang).
 */
export function buildFall(sp: FallSpec, C: FallColors, dyAt: (x: number, z: number) => number, o: FallOut) {
  o.n++;
  const { rock, W, M } = o;
  const { n, x: X, z: Z, s: S } = sp;
  const dys = new Float32Array(n);
  for (let q = 0; q < n; q++) dys[q] = dyAt(X[q], Z[q]);
  const rr = (k: number, c = 0) => fh(sp.seed + k * 7919, c * 104729 + 17, 911);
  const L = (A: Float32Array, s: number) => lerpS(S, A, n, s);

  const at = (s: number): At => {
    let q = 0;
    while (q < n - 2 && S[q + 1] < s) q++;
    const t = Math.max(-2, Math.min(2, (s - S[q]) / Math.max(1e-3, S[q + 1] - S[q])));
    const qa = Math.max(0, q - 1), qb = Math.min(n - 1, q + 2);
    let fx = X[qb] - X[qa], fz = Z[qb] - Z[qa];
    const l = Math.hypot(fx, fz) || 1;
    fx /= l; fz /= l;
    return {
      x: X[q] + (X[q + 1] - X[q]) * t, z: Z[q] + (Z[q + 1] - Z[q]) * t, fx, fz, rx: -fz, rz: fx,
      hi: L(sp.hi, s), lo: L(sp.lo, s) - 0.3, sl: L(sp.sl, s), hw: L(sp.hw, s), dy: [L(sp.d1, s), L(dys, s)],
    };
  };
  /** Stufe, auf deren Absatz s liegt (oder null) */
  const stepAt = (s: number) => sp.steps.find((t) => s >= t.s0 && s <= t.s1) ?? null;
  /** Wasserspiegel: am Hang knapp über dem Boden, auf einem Absatz gehalten */
  const yW = (s: number) => {
    const t = stepAt(s);
    return t ? L(sp.hi, t.s0) + CLEAR - 0.04 * (s - t.s0) : L(sp.hi, s) + CLEAR;
  };

  // ---- Felsfarben: etwas wärmer und heller als das Felsgrau der Landschaft, nass deutlich dunkler
  const warm = (c: RGBf): RGBf => [c[0] * 0.92, c[1] * 0.9, c[2] * 0.86];
  const wet = mixc(mulc(C.rockDark, 0.4), [0.03, 0.045, 0.04], 0.3);
  const wet2 = mulc(C.rockDark, 0.6);
  const rockC = (k: number) => warm(mixc(C.rock, C.rockDark, 0.35 + 0.55 * k));
  const mossy = (b: RGBf, k: number) => mixc(b, C.moss, k);

  const tri = (a: number[], b: number[], c: number[], ca: RGBf, cb: RGBf, cc: RGBf, d: Dy) => {
    rock.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    rock.col.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
    rock.d1.push(d[0], d[0], d[0]);
    rock.dy.push(d[1], d[1], d[1]);
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], ca: RGBf, cb: RGBf, cc: RGBf, cd: RGBf, dy: Dy) => {
    tri(a, b, c, ca, cb, cc, dy);
    tri(a, c, d, ca, cc, cd, dy);
  };
  /** kantiger Brocken (Doppelpyramide, verzerrt), unten im Boden */
  const boulder = (x: number, y: number, z: number, r: number, k: number, base: RGBf, dy: Dy) => {
    const j = (i: number) => 0.7 + 0.6 * rr(k, i);
    const ang = rr(k, 9) * Math.PI * 2;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const P = (dx: number, dyy: number, dz: number) => [x + (dx * ca - dz * sa), y + dyy, z + (dx * sa + dz * ca)];
    const tp = P(0.15 * r * (rr(k, 1) - 0.5), r * 0.75 * j(2), 0);
    const bt = P(0, -r * 1.2, 0);
    const ring = [P(r * j(3), r * 0.05, r * 0.3 * (rr(k, 11) - 0.5)), P(r * 0.3 * (rr(k, 12) - 0.5), r * 0.1 * j(4), r * j(5)), P(-r * j(6), 0, 0), P(0, -r * 0.05, -r * j(7))];
    const bc = mixc(base, rockC(rr(k, 8)), 0.45);
    const hiC = mossy(bc, 0.25 * rr(k, 10));
    const loC = mulc(bc, 0.72);
    for (let i = 0; i < 4; i++) {
      tri(tp, ring[i], ring[(i + 1) % 4], hiC, loC, loC, dy);
      tri(bt, ring[(i + 1) % 4], ring[i], loC, loC, loC, dy);
    }
  };

  // ---- Felsbett vom Kopf bis ins Becken: schmiegt sich an den Hang (außen im Boden), an jeder Stufe eine Wand
  const sBed0 = S[sp.top] - 1.2;
  const sBed1 = sp.pool ? sp.pool.s - sp.pool.r * 0.2 : Math.min(S[n - 1], sp.sEnd + 2);
  const stations: { s: number; lv: number; face: number }[] = [];
  {
    const keys: { s: number; lv: number; face: number }[] = [];
    for (const t of sp.steps) {
      const yl = L(sp.hi, t.s0) + CLEAR - 0.04 * (t.s1 - t.s0);
      keys.push({ s: t.s0, lv: NaN, face: 0 }, { s: t.s1, lv: yl, face: 0 });
      // Wand: Mitte etwas zurückgesetzt, unten der nächste Abschnitt
      keys.push({ s: t.s1 + 0.12, lv: yl - t.F * 0.5, face: 1 }, { s: t.s1 + 0.3, lv: NaN, face: 2 });
    }
    let s = sBed0;
    for (const k of [...keys, { s: sBed1, lv: NaN, face: 0 }].sort((a, b) => a.s - b.s)) {
      if (k.s < sBed0 || k.s > sBed1) continue;
      while (k.s - s > 2.6) { s += Math.min(2.3, (k.s - s) / 2); stations.push({ s, lv: NaN, face: 0 }); }
      stations.push(k);
      s = k.s;
    }
  }
  const secs: { p: number[][]; c: RGBf[]; dy: Dy }[] = [];
  stations.forEach((st, i) => {
    const A = at(st.s);
    const yl = Number.isNaN(st.lv) ? yW(st.s) : st.lv;
    const jr = (c: number) => rr(3000 + i, c) - 0.5;
    // Breite unruhig (Felsnasen, Ausbuchtungen)
    const hw = A.hw * (0.9 + 0.25 * rr(3000 + i, 15));
    // Boden quer zum Lauf (aus den seitlichen Proben), außen leicht eingesenkt
    const hl = L(sp.hl, st.s), hr = L(sp.hr, st.s);
    const ground = (u: number) => A.lo + (u < 0 ? (hl - A.lo) * (-u / SIDE) : (hr - A.lo) * (u / SIDE));
    const lift = Math.max(0, yl - A.hi - CLEAR);
    // Ufer breiter, wo das Bett über dem Hang steht (Stufen): eine Böschung statt einer Mauer
    const bwL = 1.1 + 0.9 * rr(3000 + i, 1) + 0.7 * lift, bwR = 1.1 + 0.9 * rr(3000 + i, 2) + 0.7 * lift;
    const bankL = yl + 0.05 + 0.3 * rr(3000 + i, 3), bankR = yl + 0.05 + 0.3 * rr(3000 + i, 4);
    const midU = (bw: number) => hw + 0.45 + 0.5 * (bw - 0.45);
    const uy: [number, number][] = [
      [-hw - bwL - 0.8, ground(-hw - bwL - 0.8) - 0.7],
      [-hw - bwL, ground(-hw - bwL) - 0.12 + jr(5) * 0.1],
      [-midU(bwL), (bankL + ground(-midU(bwL))) / 2 + 0.15 + jr(6) * 0.3],
      [-hw - 0.45, bankL],
      [-hw + 0.3, yl - 0.25],
      [hw - 0.3, yl - 0.25],
      [hw + 0.45, bankR],
      [midU(bwR), (bankR + ground(midU(bwR))) / 2 + 0.15 + jr(7) * 0.3],
      [hw + bwR, ground(hw + bwR) - 0.12 + jr(8) * 0.1],
      [hw + bwR + 0.8, ground(hw + bwR + 0.8) - 0.7],
    ];
    // Wand: in der Mitte ausgewaschen (zurück), oben die Kante vorstehend
    const fw = st.face === 1 ? -0.35 + jr(10) * 0.3 : 0;
    const p = uy.map(([u, y], ci) => {
      const f = ci <= 1 || ci >= 8 ? 0 : fw;
      return [A.x + A.rx * u + A.fx * f, y, A.z + A.rz * u + A.fz * f];
    });
    const crest = mossy(rockC(0.2 + 0.4 * rr(3000 + i, 12)), 0.35 + 0.35 * rr(3000 + i, 13));
    // außen geht der Fels in Moos und Gras über
    const edge = mixc(mulc(C.rockDark, 0.6), LUSH_C, 0.45);
    const inner = st.face === 1 ? mixc(wet, [0.02, 0.05, 0.035], 0.4) : wet;
    secs.push({ p, c: [edge, edge, crest, wet2, inner, inner, wet2, crest, edge, edge], dy: A.dy });
  });
  for (let i = 0; i < secs.length - 1; i++) {
    const A = secs[i], B = secs[i + 1];
    for (let j = 0; j < 9; j++) quad(A.p[j], A.p[j + 1], B.p[j + 1], B.p[j], A.c[j], A.c[j + 1], B.c[j + 1], B.c[j], A.dy);
  }
  // Kopf: Rückseite zu
  if (secs.length) {
    const f = secs[0];
    const m = f.p.reduce((t, p) => [t[0] + p[0] / 10, t[1] + p[1] / 10, t[2] + p[2] / 10], [0, 0, 0]);
    for (let j = 0; j < 10; j++) tri(m, f.p[j], f.p[(j + 1) % 10], f.c[2], f.c[j], f.c[(j + 1) % 10], f.dy);
  }
  // Brocken auf den Ufern und unter den Stufen
  for (let s = sBed0 + 2, k = 0; s < sBed1 - 1; s += 2 + 3 * rr(4000 + k, 1), k++) {
    if (rr(4000 + k, 2) > 0.8) continue;
    const A = at(s);
    const side = rr(4000 + k, 3) < 0.5 ? -1 : 1;
    const u = side * (A.hw + 0.5 + 1.3 * rr(4000 + k, 4));
    boulder(A.x + A.rx * u, yW(s) + 0.05, A.z + A.rz * u, 0.35 + 0.65 * rr(4000 + k, 5), 4000 + k, mossy(C.rock, 0.2 * rr(4000 + k, 6)), A.dy);
  }
  sp.steps.forEach((t, k) => {
    if (t.F < 2.5) return;
    const A = at(t.s1 + outOf(t.v0, t.F) + 0.8);
    for (const side of [-1, 1]) {
      if (rr(5000 + k, side + 2) < 0.45) continue;
      const u = side * (A.hw + 0.8 + rr(5000 + k, side + 5));
      boulder(A.x + A.rx * u, yW(t.s1 + 1) + 0.1, A.z + A.rz * u, 0.6 + 0.06 * t.F + 0.5 * rr(5000 + k, side + 7), 5000 + k * 3 + side, wet2, A.dy);
    }
  });

  // ---- Wasser: ein Band vom Kopf bis ins Becken, an jeder Stufe frei fallend (Wurfparabel)
  const LAT = [-1.08, -0.78, 0, 0.78, 1.08];
  const LA = [0, 1, 1, 1, 0];
  interface Row { x: number; y: number; z: number; rx: number; rz: number; fx: number; fz: number; hw: number; c: RGBf; a: number; v: number; bulge: number; dy: Dy }
  const rows: Row[] = [];
  const foam: RGBf = [0.9, 0.94, 0.96];
  const blue: RGBf = [0.62, 0.77, 0.8];
  const glass: RGBf = [0.42, 0.6, 0.62];
  const white: RGBf = [0.96, 0.98, 1];
  const sW1 = sp.pool ? sp.pool.s - sp.pool.r * 0.5 : sBed1;
  let v = rr(1, 60) * 4;
  let s = S[sp.top] - 0.4;
  let ps = s;
  let landed = -1e9;
  const veils: { rows: Row[]; F: number }[] = [];
  for (let guard = 0; guard < 400 && s <= sW1; guard++) {
    const A = at(s);
    const t = stepAt(s);
    const y = yW(s);
    const steep = sst(0.35, 1.4, A.sl);
    const spd = t ? 2.6 : 1.8 + 6 * steep;
    v += (s - ps) / spd;
    ps = s;
    let c = mixc(blue, foam, 0.35 + 0.65 * steep);
    let a = 0.82 + 0.12 * steep;
    if (s - landed < 2.4) { c = mixc(white, c, (s - landed) / 2.4); a = 0.97; }
    if (t && t.s1 - s < 0.9) { c = mixc(glass, c, (t.s1 - s) / 0.9); a = 0.86; }
    rows.push({ x: A.x, y, z: A.z, rx: A.rx, rz: A.rz, fx: A.fx, fz: A.fz, hw: A.hw, c, a, v, bulge: 0, dy: A.dy });
    if (t && s >= t.s1 - 1e-3) {
      // über die Kante: frei fallend, nach unten breiter und schneller – bis auf den Wasserspiegel dort, wo es aufschlägt
      const yl = y;
      let Fe = t.F;
      for (let it = 0; it < 3; it++) Fe = Math.max(0.5, yl - (L(sp.hi, t.s1 + outOf(t.v0, Fe)) + CLEAR));
      const J = Math.max(3, Math.min(10, Math.round(3 + Fe / 1.4)));
      let pd = 0;
      const vr: Row[] = [rows[rows.length - 1]];
      for (let j = 1; j <= J; j++) {
        const d = Fe * Math.pow(j / J, 1.3);
        const sp2 = Math.min(13, 2.6 + Math.sqrt(2 * 9.81 * d) * 0.8);
        v += (d - pd) / sp2;
        pd = d;
        const out = outOf(t.v0, d);
        const B = at(t.s1 + out);
        const r: Row = {
          x: A.x + A.fx * out, y: yl - d, z: A.z + A.fz * out, rx: A.rx, rz: A.rz, fx: A.fx, fz: A.fz,
          hw: A.hw * (1 + 0.35 * (d / Fe)), c: d < 1.2 ? mixc(glass, white, d / 1.2) : white, a: 0.92, v, bulge: 0.1 + 0.1 * (d / Fe), dy: B.dy,
        };
        rows.push(r);
        vr.push(r);
      }
      if (Fe >= 2.8) veils.push({ rows: vr, F: Fe });
      landed = t.s1 + outOf(t.v0, Fe);
      // Gischt am Aufschlag
      const B = at(landed);
      const nP = Math.min(5, 1 + Math.floor(Fe / 2.5));
      for (let i = 0; i < nP; i++) {
        const k = Math.round(t.s1 * 10) + i;
        const u = (rr(k, 1) - 0.5) * B.hw * 1.6;
        const f2 = (rr(k, 2) - 0.3) * 1.2;
        M.puff(B.x + B.rx * u + B.fx * f2, yl - Fe + 0.3, B.z + B.rz * u + B.fz * f2, rr(k, 4), 1.4 + Fe * 0.38 * (0.7 + 0.6 * rr(k, 3)), 0.8 + Fe * 0.14, 0.55 + 0.2 * rr(k, 5), B.dy);
      }
      s = landed + 0.6;
      ps = landed;
      continue;
    }
    // nächste Zeile: an Kanten genau dort, sonst alle 2,4 m
    let nx = s + 2.4;
    const nextStep = sp.steps.find((u) => u.s0 > s + 0.05 || (u.s1 > s + 0.05 && u.s0 <= s));
    if (nextStep) {
      if (nextStep.s0 > s + 0.05 && nextStep.s0 < nx) nx = nextStep.s0;
      else if (nextStep.s0 <= s && nextStep.s1 < nx) nx = nextStep.s1;
    }
    if (s < sW1 && nx > sW1) nx = sW1;
    else if (s >= sW1) break;
    s = nx;
  }
  {
    const first = W.pos.length / 3;
    const u0 = rr(2, 70) * 5;
    for (const r of rows) {
      LAT.forEach((lf, ci) => {
        const u = lf * r.hw;
        const bul = r.bulge * r.hw * (1 - lf * lf);
        W.v(r.x + r.rx * u + r.fx * bul, r.y, r.z + r.rz * u + r.fz * bul, r.c, r.a * LA[ci], u0 + u / 3.4, r.v, r.dy);
      });
    }
    W.grid(first, rows.length, LAT.length);
  }
  // Schleier: lockere Gischt vor dem Strahl, breiter, durchscheinend, etwas schneller
  veils.forEach(({ rows: vr, F }, k) => {
    const first = W.pos.length / 3;
    const LAT2 = [-1.25, -0.7, 0, 0.7, 1.25];
    const LA2 = [0, 0.75, 1, 0.75, 0];
    let v2 = rr(k, 71) * 3;
    let pd = 0;
    const y0 = vr[0].y;
    vr.forEach((r, i) => {
      const d = y0 - r.y;
      v2 += (d - pd) / Math.min(16, 3 + Math.sqrt(2 * 9.81 * Math.max(0, d)) * 0.95);
      pd = d;
      const f = d / F;
      const off = 0.2 + 0.45 * f;
      const al = (i === 0 ? 0 : 0.4) * (0.6 + 0.4 * f);
      LAT2.forEach((lf, ci) => {
        const u = lf * r.hw * (1.05 + 0.25 * f);
        W.v(r.x + r.rx * u + r.fx * off, r.y - 0.08, r.z + r.rz * u + r.fz * off, [0.93, 0.95, 0.97], al * LA2[ci], 1.7 + u / 2.3, v2, r.dy);
      });
    });
    W.grid(first, vr.length, LAT2.length);
  });

  // ---- Becken
  if (sp.pool) {
    const P = at(sp.pool.s);
    const R = sp.pool.r;
    const y = sp.pool.y;
    const Mn = POOL_N;
    const ring = sp.pool.ring;
    const ell = (th: number, r: number, yy: number) => [P.x + (P.fx * Math.cos(th) * 1.15 + P.rx * Math.sin(th)) * r, yy, P.z + (P.fz * Math.cos(th) * 1.15 + P.rz * Math.sin(th)) * r];
    const inner: number[][] = [], crest: number[][] = [], outer: number[][] = [], surf: number[][] = [];
    const ci: RGBf[] = [], cc: RGBf[] = [], co: RGBf[] = [];
    for (let i = 0; i < Mn; i++) {
      const th = (i / Mn) * Math.PI * 2;
      // Auslauf talwärts (th = 0): Rand dort abgesenkt; bergauf (Zulauf) ebenso flach
      const notch = Math.cos(th) > 0.9;
      const r1 = R * (0.95 + 0.12 * rr(500 + i, 1));
      inner.push(ell(th, r1, y + 0.05));
      surf.push(ell(th, r1 + 0.2, y));
      // Rand: bergauf liegt er im Hang, talwärts hält ein niedriger, moosiger Felsriegel das Wasser
      crest.push(ell(th, r1 + 0.6 + 0.4 * rr(500 + i, 2), notch ? y + 0.02 : Math.max(y + 0.08 + 0.2 * rr(500 + i, 3), ring[i] - 0.3)));
      // außen auf dem Boden (gemessen), leicht eingesenkt
      // talwärts, wo der Rand höher über dem Boden steht, flacher auslaufen lassen (Böschung statt Mauer)
      const hgt = Math.max(0, y - ring[i]);
      const extra = 1.6 * hgt;
      outer.push(ell(th, R + 1.6 + extra, Math.min(ring[i], y) - 0.6 - (hgt / (R + 1.6)) * extra));
      ci.push(wet);
      cc.push(mossy(rockC(0.3 + 0.4 * rr(500 + i, 5)), 0.35 + 0.3 * rr(500 + i, 6)));
      co.push(mixc(C.meadow, LUSH_C, 0.4));
    }
    for (let i = 0; i < Mn; i++) {
      const j = (i + 1) % Mn;
      quad(inner[i], crest[i], crest[j], inner[j], ci[i], cc[i], cc[j], ci[j], P.dy);
      quad(crest[i], outer[i], outer[j], crest[j], cc[i], co[i], co[j], cc[j], P.dy);
    }
    // Grund dunkel (unter dem Wasser), darüber die Wasserfläche: grünlich, durchscheinend, spiegelt den Himmel etwas
    const deep: RGBf = [0.02, 0.05, 0.05];
    const mid = [P.x, y - 0.6, P.z];
    for (let i = 0; i < Mn; i++) tri(mid, inner[(i + 1) % Mn], inner[i], deep, wet, wet, P.dy);
    {
      const first = W.pos.length / 3;
      W.v(P.x, y + 0.02, P.z, [0.2, 0.34, 0.36], 0.8, 0, 0, P.dy);
      for (let i = 0; i <= Mn; i++) {
        const p = surf[i % Mn];
        W.v(p[0], y + 0.02, p[2], [0.3, 0.45, 0.46], 0.7, (i / Mn) * 4, 0.6, P.dy);
      }
      for (let i = 0; i < Mn; i++) W.idx.push(first, first + 1 + i, first + 2 + i);
    }
    // Brocken im und am Becken
    for (let i = 0; i < 7; i++) {
      if (rr(600 + i, 1) < 0.35) continue;
      const th = (i / 7) * Math.PI * 2 + rr(600 + i, 2) * 0.6;
      if (Math.cos(th) > 0.85) continue;
      const p = ell(th, R + 0.6 + 0.6 * rr(600 + i, 3), y);
      boulder(p[0], y + 0.15, p[2], 0.5 + 0.6 * rr(600 + i, 4), 600 + i, rockC(0.4), P.dy);
    }
    // Schaum: vom Zulauf her ausgebreitet, treibt langsam talwärts
    const hitS = sp.pool.s - R * 0.45;
    const hit = at(hitS);
    const RINGS = [0, 0.25, 0.5, 0.75, 1];
    const first = W.pos.length / 3;
    const NA = 16;
    for (const f of RINGS) {
      for (let i = 0; i <= NA; i++) {
        const th = (i / NA) * Math.PI * 2;
        const rad = f * R * 1.3;
        const lx = Math.cos(th) * rad, lz = Math.sin(th) * rad;
        const px = hit.x + hit.fx * lx + hit.rx * lz;
        const pz = hit.z + hit.fz * lx + hit.rz * lz;
        // nicht über den Beckenrand hinaus
        const dd = Math.hypot(((px - P.x) * P.fx + (pz - P.z) * P.fz) / 1.15, (px - P.x) * P.rx + (pz - P.z) * P.rz) / R;
        const al = 0.7 * Math.pow(1 - f, 1.2) * (1 - sst(0.82, 1, dd));
        W.v(px, y + 0.05, pz, [0.88, 0.93, 0.95], al, lz / 2.6, -lx / 2.2, P.dy);
      }
    }
    W.grid(first, RINGS.length, NA + 1);
    // leichter Dunst über dem Becken, wenn die letzte große Stufe nah ist
    const lastBig = [...sp.steps].reverse().find((t) => t.F >= 2.5);
    if (lastBig && sp.pool.s - lastBig.s1 < 18) {
      for (let i = 0; i < 3; i++) M.puff(hit.x + hit.rx * (rr(700 + i, 1) - 0.5) * 2, y + 0.4, hit.z + hit.rz * (rr(700 + i, 1) - 0.5) * 2, rr(700 + i, 3), 2 + lastBig.F * 0.2, 1.2, 0.3, hit.dy);
    }
  }

  // ---- Bäche: Zulauf oben, Abfluss unten (mit Steinen am Ufer)
  const creek = (s0: number, s1: number, fadeIn: number, fadeOut: number, startY: number | null, seedK: number) => {
    if (s1 - s0 < 2) return;
    const N = Math.max(2, Math.round((s1 - s0) / 2.4) + 1);
    const LATc = [-1.15, -0.7, 0, 0.7, 1.15];
    const LAc = [0, 1, 1, 1, 0];
    const first = W.pos.length / 3;
    let vv = rr(seedK, 1) * 3;
    let p2 = s0;
    for (let i = 0; i < N; i++) {
      const s2 = s0 + ((s1 - s0) * i) / (N - 1);
      const A = at(s2);
      const steep = sst(0.25, 0.7, A.sl);
      vv += (s2 - p2) / (1.6 + 4 * steep);
      p2 = s2;
      let y = A.hi + 0.18;
      // aus dem Becken über die Schwelle hinab
      if (startY !== null && s2 - s0 < 4) y = Math.max(y, startY + (y - startY) * sst(0, 4, s2 - s0));
      const al = (0.62 + 0.25 * steep) * sst(0, fadeIn, s2 - s0) * sst(0, fadeOut, s1 - s2);
      const c: RGBf = mixc([0.3, 0.45, 0.47], [0.84, 0.9, 0.92], steep);
      LATc.forEach((lf, ci) => W.v(A.x + A.rx * lf * A.hw, y, A.z + A.rz * lf * A.hw, c, al * LAc[ci], 3 + (lf * A.hw) / 3, vv, A.dy));
      if (i % 2 === 1 && rr(seedK + i, 2) < 0.7) {
        const side = rr(seedK + i, 3) < 0.5 ? -1 : 1;
        const u = side * (A.hw + 0.3 + 0.6 * rr(seedK + i, 4));
        boulder(A.x + A.rx * u, A.lo - 0.1, A.z + A.rz * u, 0.3 + 0.4 * rr(seedK + i, 5), seedK * 31 + i, C.rock, A.dy);
      }
    }
    W.grid(first, N, LATc.length);
  };
  creek(0, S[sp.top] - 0.3, 8, 0.6, null, 900);
  if (sp.pool) creek(sp.creekS - sp.pool.r * 0.3, S[n - 1], 0.5, 18, sp.pool.y, 950);
  else creek(sp.sEnd + 0.5, S[n - 1], 1, 18, null, 950);
}

// ------------------------------------------------------------------ Texturen

/** kachelbares Rauschen (Periode px × py Zellen) */
function pnoise(x: number, y: number, px: number, py: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const H = (i: number, j: number) => fh(((i % px) + px) % px, ((j % py) + py) % py, seed);
  const a = H(xi, yi), b = H(xi + 1, yi), c = H(xi, yi + 1), d = H(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * Wasser (kachelbar in beide Richtungen): längliche Schaumflocken und Strähnen (Deckkraft), Farbe weiß bis
 * graublau in den Falten. Gestreckt ergibt dasselbe Bild Strähnen im freien Fall, gestaucht Schaum.
 */
export function waterTexture(): THREE.DataTexture {
  const Wd = 128, Hd = 256;
  const data = new Uint8Array(Wd * Hd * 4);
  for (let y = 0; y < Hd; y++) {
    for (let x = 0; x < Wd; x++) {
      const u = x / Wd, v = y / Hd;
      // Strähnen: quer fein, längs grob
      const st = pnoise(u * 24, v * 5, 24, 5, 11) * 0.6 + pnoise(u * 48, v * 9, 48, 9, 12) * 0.4;
      // Flocken
      const fl = pnoise(u * 12, v * 18, 12, 18, 13) * 0.55 + pnoise(u * 32, v * 48, 32, 48, 14) * 0.45;
      const lumpy = pnoise(u * 6, v * 6, 6, 6, 15);
      let a = 0.66 + (st - 0.5) * 1.5 + (fl - 0.5) * 1.1 + (lumpy - 0.5) * 0.5;
      a = Math.max(0.12, Math.min(1, a));
      const sh = Math.max(0, Math.min(1, 0.55 + (fl - 0.5) * 1.6 + (st - 0.5) * 0.8));
      const i = (y * Wd + x) * 4;
      data[i] = Math.round(160 + 95 * sh);
      data[i + 1] = Math.round(178 + 72 * sh);
      data[i + 2] = Math.round(188 + 66 * sh);
      data[i + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(data, Wd, Hd, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Gischtwolke: weicher, leicht flockiger Ball (weiß, Deckkraft) */
export function mistTexture(): THREE.DataTexture {
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N * 2 - 1, dy = (y + 0.5) / N * 2 - 1;
      const r = Math.hypot(dx, dy);
      const n = pnoise(x / 8, y / 8, 8, 8, 21) * 0.6 + pnoise(x / 4, y / 4, 16, 16, 22) * 0.4;
      const a = Math.max(0, 1 - r) ** 1.6 * (0.55 + 0.6 * n);
      const i = (y * N + x) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
      data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
