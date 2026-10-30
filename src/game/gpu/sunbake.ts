/**
 * Vorberechnetes Sonnenlicht (Abfahrt auf WebGPU): die Sonne steht fest (Sonnenuntergang), also werden die Schatten
 * nicht mehr je Bild gerechnet, sondern beim Bau der Landschaft – je Ecke einer Kachel der Blick zur Sonne über
 * das Höhenfeld (Berge werfen Schatten auf Täler und Hänge, Grate auf Rinnen; weicher Rand nach dem Winkel, um den
 * das Gelände über der Sonne steht), dazu die Verschattung aus der Mulde (wie viel Himmel eine Stelle sieht).
 *
 * Das Höhenfeld kommt aus den fertigen Kacheln selbst (je Stufe die Höhen ihres Gitters); gesucht wird jeweils in
 * der feinsten vorhandenen Stufe. Fehlt dort etwas (noch nicht gebaut, außerhalb), zählt es nicht als Hindernis.
 */
import { LEVELS } from '../abfahrt/terrain3d';

const nk = (tx: number, tz: number) => (tx + 32768) * 65536 + (tz + 32768);

interface Grid { h: Float32Array; x0: number; z0: number; cell: number; V: number }

/** halbe Breite des weichen Schattenrands (Steigung, ≈ 1,1°) */
const SOFT = 0.02;
/** so weit wird zur Sonne gesucht (m) */
const MAXD = 7000;

export class SunBake {
  /** Richtung zur Sonne (waagrecht, Einheitslänge) und Steigung der Sonne über dem Horizont */
  private hx = 0;
  private hz = -1;
  private tanE = 0.05;
  private grids: Map<number, Grid>[] = [new Map(), new Map(), new Map()];
  /** höchster Punkt aller Kacheln (Abbruch: der Strahl ist über allem) */
  private maxH = -Infinity;
  /** zuletzt gefundenes Gitter je Stufe (aufeinanderfolgende Proben liegen meist in derselben Kachel) */
  private last: (Grid | null)[] = [null, null, null];
  private lastKey = [NaN, NaN, NaN];

  /** Sonne setzen: Richtung zur Sonne (x, y, z), normiert */
  setSun(x: number, y: number, z: number) {
    const l = Math.hypot(x, z) || 1;
    this.hx = x / l;
    this.hz = z / l;
    this.tanE = Math.max(0.005, y / l);
  }

  get sunTan(): number { return this.tanE; }

  /** Höhen einer fertigen Kachel übernehmen (V × V Ecken, Zeilen nach z) */
  addTile(lv: number, tx: number, tz: number, pos: ArrayLike<number>, y0?: ArrayLike<number> | null) {
    const L = LEVELS[lv];
    const V = L.n + 1;
    const h = new Float32Array(V * V);
    for (let k = 0; k < V * V; k++) {
      const y = y0 ? y0[k] : pos[k * 3 + 1];
      h[k] = y;
      if (y > this.maxH) this.maxH = y;
    }
    this.grids[lv].set(nk(tx, tz), { h, x0: tx * L.size, z0: tz * L.size, cell: L.size / L.n, V });
    this.lastKey[lv] = NaN;
  }

  removeTile(lv: number, tx: number, tz: number) {
    this.grids[lv].delete(nk(tx, tz));
    this.lastKey[lv] = NaN;
    this.last[lv] = null;
  }

  private grid(lv: number, x: number, z: number): Grid | null {
    const S = LEVELS[lv].size;
    const k = nk(Math.floor(x / S), Math.floor(z / S));
    if (k === this.lastKey[lv]) return this.last[lv];
    const g = this.grids[lv].get(k) ?? null;
    this.lastKey[lv] = k;
    this.last[lv] = g;
    return g;
  }

  /** Geländehöhe an (x, z) aus der feinsten vorhandenen Stufe (bilinear); NaN, wenn keine Kachel da ist */
  height(x: number, z: number, from = 0): number {
    for (let lv = from; lv < 3; lv++) {
      const g = this.grid(lv, x, z);
      if (!g) continue;
      const fx = (x - g.x0) / g.cell, fz = (z - g.z0) / g.cell;
      const i = Math.min(g.V - 2, Math.max(0, Math.floor(fx))), j = Math.min(g.V - 2, Math.max(0, Math.floor(fz)));
      const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fz - j));
      const k = j * g.V + i;
      const a = g.h[k], b = g.h[k + 1], c = g.h[k + g.V], d = g.h[k + g.V + 1];
      return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
    }
    return NaN;
  }

  /**
   * Sonnenlicht an einem Punkt (0 … 1): größte Steigung des Geländes in Richtung Sonne gegen die Steigung der
   * Sonne, weich über ±SOFT. step0: erster Schritt (m, etwa die Gitterweite der Stufe)
   */
  sunAt(x: number, y: number, z: number, step0 = 3, from = 0): number {
    const tanE = this.tanE;
    let maxT = -1;
    let d = step0;
    const top = this.maxH;
    while (d < MAXD) {
      // über allem Gelände: frei
      if (y + d * (tanE - SOFT) > top) break;
      const h = this.height(x + this.hx * d, z + this.hz * d, from);
      if (h === h) {
        const t = (h - y) / d;
        if (t > maxT) { maxT = t; if (maxT > tanE + SOFT) return 0; }
      }
      d += Math.max(step0 * 0.8, d * 0.11);
    }
    const s = (tanE + SOFT - maxT) / (2 * SOFT);
    return s <= 0 ? 0 : s >= 1 ? 1 : s * s * (3 - 2 * s);
  }

  /**
   * Himmel über einer Stelle (0 … 1): Mulden, Rinnen und Fuß von Wänden sehen weniger Himmel – aus den Höhen ringsum
   * in sechs Richtungen und drei Abständen
   */
  skyAt(x: number, y: number, z: number, r0: number, from = 0): number {
    let occ = 0;
    let n = 0;
    for (let a = 0; a < 6; a++) {
      const ang = (a / 6) * Math.PI * 2 + 0.3;
      const cx = Math.cos(ang), cz = Math.sin(ang);
      let best = 0;
      for (const r of [r0, r0 * 3, r0 * 9]) {
        const h = this.height(x + cx * r, z + cz * r, from);
        if (h !== h) continue;
        const t = (h - y) / r;
        if (t > best) best = t;
      }
      // Horizontwinkel → verdeckter Anteil des Himmels in dieser Richtung
      occ += best / Math.sqrt(1 + best * best);
      n++;
    }
    return n ? Math.max(0.25, 1 - (occ / n) * 0.85) : 1;
  }

  /**
   * Ecken einer Kachel backen (in Schritten): out je Ecke (Sonne, Himmel). pos: Lage aller Ecken (auch Schürzen),
   * can: Kronendach je Ecke (m; der Wald steht dort höher)
   */
  *bake(lv: number, pos: ArrayLike<number>, count: number, can: ArrayLike<number> | null, out: Float32Array, late: () => boolean): Generator<void, void, void> {
    const cell = LEVELS[lv].size / LEVELS[lv].n;
    // auf der feinsten Stufe beginnt die Suche dort (die gröberen sind dort abgesenkt), sonst in der eigenen
    const from = lv;
    for (let k = 0; k < count; k++) {
      if ((k & 31) === 31 && late()) yield;
      const x = pos[k * 3], z = pos[k * 3 + 2];
      const y = pos[k * 3 + 1] + 0.4 + (can ? can[k] * 0.85 : 0);
      out[k * 2] = this.sunAt(x, y, z, cell * 0.9, from);
      out[k * 2 + 1] = this.skyAt(x, pos[k * 3 + 1] + 0.3, z, cell * 1.6, from);
    }
  }

  /** Kacheln vergessen, die die Landschaft abgebaut hat (Schlüssel wie im Feld: Stufe und Lage) */
  keepOnly(alive: (lv: number, tx: number, tz: number) => boolean) {
    for (let lv = 0; lv < 3; lv++) {
      const S = LEVELS[lv].size;
      for (const [k, g] of this.grids[lv]) if (!alive(lv, Math.round(g.x0 / S), Math.round(g.z0 / S))) this.grids[lv].delete(k);
      this.lastKey[lv] = NaN;
      this.last[lv] = null;
    }
  }
}
