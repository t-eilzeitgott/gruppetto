/**
 * Landschaft für den WebGPU-Test: die Kacheln des Spiels (terrain3d – dieselben Berge, Täler, Wälder), aber als
 * feste Gebiete je Detailstufe um die ganze Teststrecke statt mitwandernder Ringe:
 *   Stufe 0 (4-m-Raster) bis ~230 m neben der Strecke, Stufe 1 (16 m) bis 1,6 km, Stufe 2 (64 m) bis 6,5 km.
 * Wo eine feinere Stufe schon fertig liegt, sinkt die gröbere ab (je Ecke auf der CPU – kein Flimmern zwischen
 * den Stufen, und solange die feinere noch fehlt, bleibt die gröbere sichtbar: keine Löcher beim Aufbau); ganz
 * verdeckte gröbere Kacheln werden ausgeblendet. Gebaut wird in Häppchen mit Zeitbudget, die gröberen Stufen und
 * die Kacheln nahe am Fahrer zuerst.
 */
import * as THREE from 'three/webgpu';
import { LEVELS, type Terrain, type TreeSpot } from '../abfahrt/terrain3d';

export interface RouteSample { x: number; z: number }

interface Tile {
  lv: number; tx: number; tz: number; key: string;
  cx: number; cz: number;
  state: 'todo' | 'done';
  mesh: THREE.Mesh | null;
  /** Höhen der Ecken ohne Absenkung (gröbere Stufen) */
  y0: Float32Array | null;
}

const RADIUS = [230, 1600, 6500];
/** so tief sinkt eine gröbere Stufe unter einer feineren ab */
const DROP = [0, 70, 300];

export interface FieldEvents {
  /** fertige Kachel der feinsten Stufe: ihre Bäume */
  onTrees?: (key: string, trees: TreeSpot[], cx: number, cz: number) => void;
}

export class Field {
  readonly group = new THREE.Group();
  private sets: Set<string>[] = [new Set(), new Set(), new Set()];
  /** fertige Kacheln je Stufe */
  private doneSets: Set<string>[] = [new Set(), new Set(), new Set()];
  private tiles: Tile[] = [];
  private gen: { tile: Tile; it: Generator<void, import('../abfahrt/terrain3d').TileData, void> } | null = null;
  done = 0;
  total = 0;
  /** Prüfmodus: Absenkung abschwächen (?drop=0.1) */
  dropK = 1;

  constructor(private terrain: Terrain, route: RouteSample[], private mats: THREE.Material[], private ev: FieldEvents = {}) {
    for (let lv = 0; lv < 3; lv++) {
      const S = LEVELS[lv].size;
      const R = RADIUS[lv];
      for (const p of route) {
        for (let tx = Math.floor((p.x - R) / S); tx <= Math.floor((p.x + R) / S); tx++) {
          for (let tz = Math.floor((p.z - R) / S); tz <= Math.floor((p.z + R) / S); tz++) {
            const key = `${tx},${tz}`;
            if (this.sets[lv].has(key)) continue;
            // Abstand Punkt–Kachel
            const dx = Math.max(tx * S - p.x, 0, p.x - (tx + 1) * S);
            const dz = Math.max(tz * S - p.z, 0, p.z - (tz + 1) * S);
            if (dx * dx + dz * dz <= R * R) this.sets[lv].add(key);
          }
        }
      }
    }
    // gröbere Stufen schließen die feineren ein (sonst bliebe dort ein Loch)
    for (let lv = 1; lv < 3; lv++) {
      const f = LEVELS[lv].size / LEVELS[lv - 1].size;
      for (const k of this.sets[lv - 1]) {
        const [x, z] = k.split(',').map(Number);
        this.sets[lv].add(`${Math.floor(x / f)},${Math.floor(z / f)}`);
      }
    }
    for (let lv = 0; lv < 3; lv++) {
      const S = LEVELS[lv].size;
      for (const key of this.sets[lv]) {
        const [tx, tz] = key.split(',').map(Number);
        this.tiles.push({ lv, tx, tz, key, cx: (tx + 0.5) * S, cz: (tz + 0.5) * S, state: 'todo', mesh: null, y0: null });
      }
    }
    this.total = this.tiles.filter((t) => t.state === 'todo').length;
  }

  /** liegt (x, z) mindestens m tief im fertigen Gebiet der Stufe lv? */
  private inside(lv: number, x: number, z: number, m: number): boolean {
    const S = LEVELS[lv].size;
    const s = this.doneSets[lv];
    return s.has(`${Math.floor((x - m) / S)},${Math.floor((z - m) / S)}`) && s.has(`${Math.floor((x + m) / S)},${Math.floor((z - m) / S)}`)
      && s.has(`${Math.floor((x - m) / S)},${Math.floor((z + m) / S)}`) && s.has(`${Math.floor((x + m) / S)},${Math.floor((z + m) / S)}`);
  }

  get progress(): number { return this.total ? this.done / this.total : 1; }

  /** gewichtete Distanz: feine Kacheln zählen nah, grobe wie weiter weg – die Fernsicht kommt zuerst */
  private static weight(t: Tile, x: number, z: number) {
    return Math.hypot(t.cx - x, t.cz - z) * (t.lv === 0 ? 1 : t.lv === 1 ? 0.5 : 0.1);
  }

  /** Gibt es um (x, z) noch etwas zu bauen? */
  hasWork(x: number, z: number, near: number): boolean {
    if (this.gen) return true;
    for (const t of this.tiles) if (t.state === 'todo' && Field.weight(t, x, z) <= near) return true;
    return false;
  }

  /** wie viele Kacheln liegen um (x, z) (fertig oder nicht)? */
  countNear(x: number, z: number, near: number): number {
    let n = 0;
    for (const t of this.tiles) if (Field.weight(t, x, z) <= near) n++;
    return n;
  }

  /** Kacheln bis zur Zeit until bauen (performance.now()), die nächsten am Punkt (x, z) zuerst */
  build(x: number, z: number, until: number, near = Infinity): boolean {
    let built = false;
    while (performance.now() < until) {
      if (!this.gen) {
        let best: Tile | null = null;
        let bd = Infinity;
        for (const t of this.tiles) {
          if (t.state !== 'todo') continue;
          const d = Field.weight(t, x, z);
          if (d < bd) { bd = d; best = t; }
        }
        if (!best || bd > near) break;
        this.gen = { tile: best, it: this.terrain.tileSteps(best.lv, best.tx, best.tz, false) };
      }
      this.terrain.deadline = until;
      const r = this.gen.it.next();
      this.terrain.deadline = Infinity;
      if (!r.done) continue;
      const t = this.gen.tile;
      this.gen = null;
      this.finish(t, r.value);
      built = true;
    }
    return built;
  }

  /** gröbere Kachel unter der fertigen feineren Stufe absenken (nur Ecken tief drinnen); ganz verdeckt: ausblenden */
  private lower(t: Tile) {
    if (!t.mesh || !t.y0) return;
    const geo = t.mesh.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    const cell = LEVELS[t.lv].size / LEVELS[t.lv].n;
    let up = 0;
    for (let i = 0; i < pos.count; i++) {
      const low = this.inside(t.lv - 1, a[i * 3], a[i * 3 + 2], cell * 1.01);
      a[i * 3 + 1] = t.y0[i] - (low ? DROP[t.lv] * this.dropK : 0);
      if (!low) up++;
    }
    pos.needsUpdate = true;
    geo.computeBoundingSphere();
    t.mesh.visible = up > 0;
  }

  private finish(t: Tile, d: import('../abfahrt/terrain3d').TileData) {
    t.state = 'done';
    this.done++;
    this.doneSets[t.lv].add(t.key);
    const geo = d.geo as unknown as THREE.BufferGeometry;
    d.water?.dispose();
    const mesh = new THREE.Mesh(geo, this.mats[t.lv]);
    // Schatten nur empfangen: der Schattenausschnitt ist klein (110 m) – Hänge würfen sonst Schatten mit harter Kante
    mesh.receiveShadow = t.lv === 0;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    t.mesh = mesh;
    this.group.add(mesh);
    if (t.lv > 0) {
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      t.y0 = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) t.y0[i] = pos.getY(i);
      this.lower(t);
    }
    // die gröbere Kachel darüber sinkt jetzt hier ab
    if (t.lv < 2) {
      const S = LEVELS[t.lv].size;
      const C = LEVELS[t.lv + 1].size;
      const m = LEVELS[t.lv + 1].size / LEVELS[t.lv + 1].n * 1.01;
      for (const c of this.tiles) {
        if (c.lv !== t.lv + 1 || c.state !== 'done') continue;
        if (c.tx * C > (t.tx + 1) * S + m || (c.tx + 1) * C < t.tx * S - m || c.tz * C > (t.tz + 1) * S + m || (c.tz + 1) * C < t.tz * S - m) continue;
        this.lower(c);
      }
    }
    if (t.lv === 0 && d.trees.length) this.ev.onTrees?.(t.key, d.trees, t.cx, t.cz);
  }

  /**
   * Wenn alles gebaut ist: Kacheln zu größeren Stücken zusammenlegen (feinste Stufe 4 × 4 = 512 m, mittlere
   * 2 × 2 = 1 km) – viel weniger Zeichenaufrufe; ganz verdeckte gröbere Kacheln fallen weg.
   */
  merge() {
    if (this.progress < 1) return;
    for (const t of this.tiles) {
      if (t.mesh && !t.mesh.visible) { this.group.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh = null; t.y0 = null; }
    }
    for (const [lv, B] of [[0, 4], [1, 2]] as const) {
      const groups = new Map<string, Tile[]>();
      for (const t of this.tiles) {
        if (t.lv !== lv || !t.mesh) continue;
        const k = `${Math.floor(t.tx / B)},${Math.floor(t.tz / B)}`;
        const g = groups.get(k);
        if (g) g.push(t); else groups.set(k, [t]);
      }
      for (const list of groups.values()) {
        if (list.length < 2) continue;
        const mesh = new THREE.Mesh(mergeGeos(list.map((t) => t.mesh!.geometry)), this.mats[lv]);
        mesh.receiveShadow = lv === 0;
        mesh.castShadow = false;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.userData.lv = lv;
        this.group.add(mesh);
        this.merged.push(mesh);
        for (const t of list) { this.group.remove(t.mesh!); t.mesh!.geometry.dispose(); t.mesh = null; t.y0 = null; }
      }
    }
  }
  private merged: THREE.Mesh[] = [];

  /** Geometrien einer Stufe (zusammengelegte und einzelne Kacheln) */
  geometries(lv: number): THREE.BufferGeometry[] {
    const out: THREE.BufferGeometry[] = [];
    for (const m of this.merged) if (m.userData.lv === lv) out.push(m.geometry);
    for (const t of this.tiles) if (t.lv === lv && t.mesh) out.push(t.mesh.geometry);
    return out;
  }

  dispose() {
    for (const t of this.tiles) t.mesh?.geometry.dispose();
    for (const m of this.merged) m.geometry.dispose();
  }
}

/** Attribute, die die Bodenmaterialien lesen (der Rest der Kachel bleibt beim Zusammenlegen weg) */
const KEEP = ['position', 'normal', 'color', 'aMat', 'aRock', 'aNz'];

/** Kachelgeometrien hintereinanderhängen (gleiche Attribute, mit Index) */
function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let nv = 0;
  let ni = 0;
  for (const g of geos) {
    const n = g.getAttribute('position').count;
    nv += n;
    ni += g.index ? g.index.count : n;
  }
  const out = new THREE.BufferGeometry();
  for (const k of KEEP) {
    const a0 = geos[0].getAttribute(k) as THREE.BufferAttribute | undefined;
    if (!a0) continue;
    const arr = new Float32Array(nv * a0.itemSize);
    let o = 0;
    for (const g of geos) {
      const a = g.getAttribute(k) as THREE.BufferAttribute;
      const len = a.count * a.itemSize;
      arr.set((a.array as Float32Array).subarray(0, len), o);
      o += len;
    }
    out.setAttribute(k, new THREE.BufferAttribute(arr, a0.itemSize));
  }
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let io = 0;
  let vo = 0;
  for (const g of geos) {
    const n = g.getAttribute('position').count;
    if (g.index) {
      const ia = g.index.array;
      for (let i = 0; i < g.index.count; i++) idx[io++] = ia[i] + vo;
    } else {
      for (let i = 0; i < n; i++) idx[io++] = i + vo;
    }
    vo += n;
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
