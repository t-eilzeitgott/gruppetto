/**
 * Bergwald bis an die Straße (WebGPU-Test). Im Spiel bleibt neben der Fahrbahn ein Wiesenstreifen von ~18 m frei
 * (dort stehen keine Bäume der Landschaft) – im Wald wirkt die Straße dann wie eine Schneise. Hier wird, wo
 * links oder rechts dichter Wald steht, der Streifen aufgeforstet: junge Bäume am Waldrand, dahinter
 * ausgewachsene, dazu Waldboden statt Wiese (Gewichte der Boden-Ecken von Landschaft und Straßenrand).
 */
import * as THREE from 'three/webgpu';
import type { Terrain, TreeSpot } from '../abfahrt/terrain3d';
import type { Track } from '../abfahrt/track';

const hash = (a: number, b: number) => {
  let x = Math.imul(a ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul(b ^ 0x61c88647, 0x9e3779b1);
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca77);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
};
const sstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Punkt der Strecke (alle 8 m): Ort, Richtung nach rechts, Waldstärke links/rechts (0 … 1) */
interface Sample { x: number; z: number; rx: number; rz: number; left: number; right: number }

const STEP = 8;
const CELL = 32;

export class ForestEdge {
  private s: Sample[] = [];
  private grid = new Map<string, number[]>();

  constructor(track: Track, private terrain: Terrain, z0: number, z1: number) {
    const w = { x: 0, y: 0, z: 0, th: 0 };
    for (let z = z0; z <= z1; z += STEP) {
      track.world(z, 0, 0, w);
      const k = this.s.length;
      this.s.push({ x: w.x, z: w.z, rx: Math.cos(w.th), rz: Math.sin(w.th), left: 0, right: 0 });
      const key = `${Math.floor(w.x / CELL)},${Math.floor(w.z / CELL)}`;
      const l = this.grid.get(key);
      if (l) l.push(k); else this.grid.set(key, [k]);
    }
  }

  /** nächster Streckenpunkt (nur bis ~40 m): Index, Abstand quer (+ rechts), Abstand insgesamt */
  near(x: number, z: number): { k: number; lat: number; d: number } | null {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let best = -1;
    let bd = Infinity;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const l = this.grid.get(`${cx + i},${cz + j}`);
        if (!l) continue;
        for (const k of l) {
          const p = this.s[k];
          const d = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d < bd) { bd = d; best = k; }
        }
      }
    }
    if (best < 0) return null;
    const p = this.s[best];
    return { k: best, lat: (x - p.x) * p.rx + (z - p.z) * p.rz, d: Math.sqrt(bd) };
  }

  /** Waldstärke je Seite aus den Bäumen der Landschaft (20–70 m neben der Straße), entlang der Strecke geglättet */
  measure(spots: Iterable<TreeSpot>) {
    const cnt = this.s.map(() => [0, 0]);
    for (const t of spots) {
      const n = this.near(t.x, t.z);
      if (!n) continue;
      const a = Math.abs(n.lat);
      if (a < 18 || a > 70) continue;
      cnt[n.k][n.lat > 0 ? 1 : 0]++;
    }
    // dichtester Wald der Landschaft: 6-m-Raster zu 92 % → ~52 Bäume auf 8 m × 52 m Band … geglättet über ±40 m
    const R = 5;
    for (let k = 0; k < this.s.length; k++) {
      for (let side = 0; side < 2; side++) {
        let sum = 0;
        let n = 0;
        for (let j = -R; j <= R; j++) {
          const q = k + j;
          if (q < 0 || q >= this.s.length) continue;
          sum += cnt[q][side];
          n++;
        }
        const dens = sum / n / ((STEP * 52) / 40);
        const v = sstep(0.3, 0.7, dens);
        if (side) this.s[k].right = v; else this.s[k].left = v;
      }
    }
  }

  /** Prüfhilfe: wie viel der Strecke hat links/rechts Wald (Anteil der Punkte mit Stärke > 0,5) */
  get coverage(): [number, number] {
    const n = this.s.length || 1;
    return [this.s.filter((p) => p.left > 0.5).length / n, this.s.filter((p) => p.right > 0.5).length / n];
  }

  /** Waldstärke an einem Punkt neben der Straße (0 auf der Fahrbahn und am Bankett) */
  strength(x: number, z: number): number {
    const n = this.near(x, z);
    if (!n) return 0;
    const p = this.s[n.k];
    const a = Math.abs(n.lat);
    return (n.lat > 0 ? p.right : p.left) * sstep(6.2, 9.5, a);
  }

  /** junge und alte Bäume im Streifen 8–18 m neben der Straße, wo dahinter Wald steht */
  fill(existing: Iterable<TreeSpot>): TreeSpot[] {
    const occ = new Map<string, { x: number; z: number }[]>();
    const put = (x: number, z: number) => {
      const key = `${Math.floor(x / 8)},${Math.floor(z / 8)}`;
      const l = occ.get(key);
      if (l) l.push({ x, z }); else occ.set(key, [{ x, z }]);
    };
    const free = (x: number, z: number, r: number) => {
      const cx = Math.floor(x / 8);
      const cz = Math.floor(z / 8);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        for (const p of occ.get(`${cx + i},${cz + j}`) ?? []) if ((p.x - x) ** 2 + (p.z - z) ** 2 < r * r) return false;
      }
      return true;
    };
    const kinds: string[] = [];
    for (const t of existing) { put(t.x, t.z); if (kinds.length < 400) kinds.push(t.kind); }
    const conifers = kinds.filter((k) => k === 'pine' || k === 'larch' || k === 'pineSnow');
    const pool = conifers.length ? conifers : ['pine'];
    const out: TreeSpot[] = [];
    const rows = [8.6, 12.2, 15.6, 18.8];
    for (let k = 0; k < this.s.length; k++) {
      const p = this.s[k];
      for (let side = -1; side <= 1; side += 2) {
        const f = side > 0 ? p.right : p.left;
        if (f < 0.25) continue;
        for (let r = 0; r < rows.length; r++) {
          for (let a = 0; a < 2; a++) {
            const h1 = hash(k * 8 + r * 2 + a, side + 7);
            const h2 = hash(k * 8 + r * 2 + a + 101, side + 13);
            const h3 = hash(k * 8 + r * 2 + a + 211, side + 29);
            const edge = r === 0;
            if (h3 > f * (edge ? 0.75 : 0.95)) continue;
            const lat = side * (rows[r] + (h1 - 0.5) * 2.6);
            const along = (a - 0.5) * STEP * 0.5 + (h2 - 0.5) * 2.2;
            const x = p.x + p.rx * lat - p.rz * along;
            const z = p.z + p.rz * lat + p.rx * along;
            // nicht zu nah an der Straße (auch an anderen Stellen der Strecke, z. B. in Kehren)
            const nn = this.near(x, z);
            if (!nn || Math.abs(nn.lat) < 7.6 || (nn.k !== k && nn.d < 7.6)) continue;
            if (!free(x, z, edge ? 3.2 : 3.8)) continue;
            const y = this.terrain.groundAt(x, z);
            // zu steil (Felswand, Einschnitt): kein Baum
            const gx = this.terrain.groundAt(x + 1.5, z) - y;
            const gz = this.terrain.groundAt(x, z + 1.5) - y;
            if (Math.hypot(gx, gz) / 1.5 > 1.05) continue;
            put(x, z);
            const kind = pool[Math.floor(hash(k, r * 3 + a) * pool.length)];
            // am Rand jünger und kleiner (Waldmantel), dahinter ausgewachsen
            const s = edge ? 0.5 + h1 * 0.35 : r === 1 ? 0.7 + h2 * 0.45 : 0.85 + h2 * 0.55;
            out.push({ kind, x, y: y - 0.4, z, s, rot: h3 * Math.PI * 2 * 7, tint: 0.84 + h1 * 0.3 });
          }
        }
      }
    }
    return out;
  }

  /** Bodengewichte nachziehen: Wald (Komponente 0 von attr) bis an den Straßenrand, wo der Streifen aufgeforstet ist */
  boost(geo: THREE.BufferGeometry, attr: string) {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
    const a = geo.getAttribute(attr) as THREE.BufferAttribute | undefined;
    if (!pos || !a || a.itemSize < 1) return;
    const arr = a.array as Float32Array;
    let touched = false;
    for (let i = 0; i < pos.count; i++) {
      const f = this.strength(pos.getX(i), pos.getZ(i));
      if (f <= 0.01) continue;
      const o = i * a.itemSize;
      if (arr[o] < f) { arr[o] = f; touched = true; }
    }
    if (touched) a.needsUpdate = true;
  }
}
