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
/**
 * Zeichenblöcke: je 2 × 2 Kacheln einer Stufe liegen in einem Netz (feinste Stufe 256 m, mittlere 1 km, grobe 4 km)
 * – gut ein Viertel der Zeichenaufrufe (auf dem iPhone kostet jeder ~15 µs CPU). Die Kacheln selbst bleiben als
 * Daten (Absenken, Waldboden, Abbau); ändert sich eine, wird ihr Block neu zusammengelegt.
 */
const BLOCK = 2;
/** Zahlenschlüssel einer Kachel */
const nk = (tx: number, tz: number) => (tx + 32768) * 65536 + (tz + 32768);
interface Block { key: string; lv: number; tiles: Set<Tile>; mesh: THREE.Mesh | null }
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
  /** fertige Kacheln je Stufe (Zahlenschlüssel: das Absenken fragt das je Ecke viermal ab) */
  private doneSets: Set<number>[] = [new Set(), new Set(), new Set()];
  private tiles: Tile[] = [];
  private gen: { tile: Tile; it: Generator<void, import('../abfahrt/terrain3d').TileData, void> } | null = null;
  done = 0;
  total = 0;
  /** Prüfmodus: Absenkung abschwächen (?drop=0.1) */
  dropK = 1;
  private blocks = new Map<string, Block>();
  private dirty = new Set<Block>();
  private byGeo = new Map<THREE.BufferGeometry, Tile>();

  constructor(private terrain: Terrain, route: RouteSample[], private mats: THREE.Material[], private ev: FieldEvents = {}) {
    this.extend(route);
  }

  /**
   * Strecke verlängern (Streaming): Kacheln um die neuen Streckenpunkte dazunehmen. Gröbere Stufen schließen die
   * feineren ein (sonst bliebe dort ein Loch).
   */
  extend(route: RouteSample[]) {
    const added: Set<string>[] = [new Set(), new Set(), new Set()];
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
            if (dx * dx + dz * dz <= R * R) { this.sets[lv].add(key); added[lv].add(key); }
          }
        }
      }
    }
    for (let lv = 1; lv < 3; lv++) {
      const f = LEVELS[lv].size / LEVELS[lv - 1].size;
      for (const k of added[lv - 1]) {
        const [x, z] = k.split(',').map(Number);
        const key = `${Math.floor(x / f)},${Math.floor(z / f)}`;
        if (!this.sets[lv].has(key)) { this.sets[lv].add(key); added[lv].add(key); }
      }
    }
    for (let lv = 0; lv < 3; lv++) {
      const S = LEVELS[lv].size;
      for (const key of added[lv]) {
        const [tx, tz] = key.split(',').map(Number);
        this.tiles.push({ lv, tx, tz, key, cx: (tx + 0.5) * S, cz: (tz + 0.5) * S, state: 'todo', mesh: null, y0: null });
        this.total++;
      }
    }
  }

  /** Fehlt im Umkreis r um einen der Punkte noch eine Kachel der Stufe lv? (Rechteck-Abstand) */
  pending(pts: RouteSample[], r: number, lv = 0): boolean {
    const S = LEVELS[lv].size;
    for (const t of this.tiles) {
      if (t.lv !== lv || t.state === 'done') continue;
      for (const p of pts) {
        const dx = Math.max(t.tx * S - p.x, 0, p.x - (t.tx + 1) * S);
        const dz = Math.max(t.tz * S - p.z, 0, p.z - (t.tz + 1) * S);
        if (dx * dx + dz * dz <= r * r) return true;
      }
    }
    return false;
  }

  /** fertige Kacheln der Stufe lv, die das Rechteck berühren */
  tilesIn(lv: number, x0: number, z0: number, x1: number, z1: number): THREE.BufferGeometry[] {
    const S = LEVELS[lv].size;
    const out: THREE.BufferGeometry[] = [];
    for (const t of this.tiles) {
      if (t.lv !== lv || !t.mesh) continue;
      if ((t.tx + 1) * S < x0 || t.tx * S > x1 || (t.tz + 1) * S < z0 || t.tz * S > z1) continue;
      out.push(t.mesh.geometry);
    }
    return out;
  }

  /**
   * Kacheln abbauen, die keiner der Punkte mehr braucht (Streaming: weit hinter dem Fahrer). Darüberliegende
   * gröbere Kacheln heben sich dort wieder (sonst ein Loch). Liefert die Schlüssel der entfernten feinsten Kacheln.
   */
  prune(keepPts: RouteSample[]): string[] {
    const it = this.pruneSteps(keepPts);
    for (;;) { const r = it.next(); if (r.done) return r.value; }
  }

  /** wie prune, in Schritten: gröbere Kacheln einzeln wieder anheben (jede nur einmal) */
  *pruneSteps(keepPts: RouteSample[]): Generator<void, string[], void> {
    const keep: Set<string>[] = [new Set(), new Set(), new Set()];
    for (let lv = 0; lv < 3; lv++) {
      const S = LEVELS[lv].size;
      const R = RADIUS[lv] + S;
      for (const p of keepPts) {
        for (let tx = Math.floor((p.x - R) / S); tx <= Math.floor((p.x + R) / S); tx++) {
          for (let tz = Math.floor((p.z - R) / S); tz <= Math.floor((p.z + R) / S); tz++) keep[lv].add(`${tx},${tz}`);
        }
      }
    }
    const gone: Tile[] = [];
    const dropped0: string[] = [];
    this.tiles = this.tiles.filter((t) => {
      if (keep[t.lv].has(t.key)) return true;
      if (this.gen?.tile === t) this.gen = null;
      gone.push(t);
      return false;
    });
    for (const t of gone) {
      this.sets[t.lv].delete(t.key);
      if (t.state === 'done') { this.doneSets[t.lv].delete(nk(t.tx, t.tz)); this.done--; }
      this.total--;
      if (t.mesh) { this.byGeo.delete(t.mesh.geometry); t.mesh.geometry.dispose(); t.mesh = null; }
      const b = this.blockOf(t);
      b.tiles.delete(t);
      this.dirty.add(b);
      if (t.lv === 0) dropped0.push(t.key);
    }
    // gröbere Kacheln über entfernten feineren wieder anheben (jede einmal, je Schritt eine)
    const lift = new Set<Tile>();
    for (const t of gone) {
      if (t.lv >= 2) continue;
      const S = LEVELS[t.lv].size;
      const C = LEVELS[t.lv + 1].size;
      for (const c of this.tiles) {
        if (c.lv !== t.lv + 1 || c.state !== 'done') continue;
        if (c.tx * C > (t.tx + 1) * S || (c.tx + 1) * C < t.tx * S || c.tz * C > (t.tz + 1) * S || (c.tz + 1) * C < t.tz * S) continue;
        lift.add(c);
      }
    }
    for (const c of lift) {
      yield;
      if (c.mesh) this.lower(c);
    }
    return dropped0;
  }

  get tileCount(): number { return this.tiles.length; }

  /** liegt (x, z) mindestens m tief im fertigen Gebiet der Stufe lv? */
  private inside(lv: number, x: number, z: number, m: number): boolean {
    const S = LEVELS[lv].size;
    const s = this.doneSets[lv];
    const x0 = Math.floor((x - m) / S), x1 = Math.floor((x + m) / S), z0 = Math.floor((z - m) / S), z1 = Math.floor((z + m) / S);
    return s.has(nk(x0, z0)) && s.has(nk(x1, z0)) && s.has(nk(x0, z1)) && s.has(nk(x1, z1));
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

  /**
   * Kacheln bis zur Zeit until bauen (performance.now()), die nächsten am Punkt (x, z) zuerst; only: nur diese
   * Stufe (Streaming: die feine Stufe für einen Abschnitt vorziehen)
   */
  build(x: number, z: number, until: number, near = Infinity, only = -1): boolean {
    let built = false;
    while (performance.now() < until) {
      if (!this.gen) {
        let best: Tile | null = null;
        let bd = Infinity;
        for (const t of this.tiles) {
          if (t.state !== 'todo' || (only >= 0 && t.lv !== only)) continue;
          const d = only >= 0 ? Math.hypot(t.cx - x, t.cz - z) : Field.weight(t, x, z);
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
    this.dirty.add(this.blockOf(t));
  }

  private finish(t: Tile, d: import('../abfahrt/terrain3d').TileData) {
    t.state = 'done';
    this.done++;
    this.doneSets[t.lv].add(nk(t.tx, t.tz));
    const geo = d.geo as unknown as THREE.BufferGeometry;
    d.water?.dispose();
    const mesh = new THREE.Mesh(geo, this.mats[t.lv]);
    // Schatten nur empfangen: der Schattenausschnitt ist klein (110 m) – Hänge würfen sonst Schatten mit harter Kante
    mesh.receiveShadow = t.lv === 0;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    t.mesh = mesh;
    this.byGeo.set(geo, t);
    const b = this.blockOf(t);
    b.tiles.add(t);
    this.dirty.add(b);
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

  private blockOf(t: Tile): Block {
    const key = `${t.lv}:${Math.floor(t.tx / BLOCK)},${Math.floor(t.tz / BLOCK)}`;
    let b = this.blocks.get(key);
    if (!b) { b = { key, lv: t.lv, tiles: new Set(), mesh: null }; this.blocks.set(key, b); }
    return b;
  }

  /** Geometrie einer Kachel wurde verändert (z. B. Waldboden): ihr Block muss neu zusammengelegt werden */
  changed(geo: THREE.BufferGeometry) {
    const t = this.byGeo.get(geo);
    if (t) this.dirty.add(this.blockOf(t));
  }

  get dirtyCount(): number { return this.dirty.size; }

  /**
   * geänderte Blöcke neu zusammenlegen (sichtbare Kacheln; ganz verdeckte gröbere fallen weg), bis zur Zeit until.
   * Feine Stufen zuerst: ist die Zeit um, liegt höchstens für ein Bild eine noch nicht abgesenkte gröbere Kachel
   * über der neuen feinen – nie ein Loch, weil eine gröbere schon abgesenkt wäre und die feine fehlte.
   */
  flush(until = Infinity) {
    const order = [...this.dirty].sort((a, b) => a.lv - b.lv);
    let n = 0;
    for (const b of order) {
      if (n++ > 0 && performance.now() > until) break;
      this.dirty.delete(b);
      const geos: THREE.BufferGeometry[] = [];
      for (const t of b.tiles) if (t.mesh?.visible) geos.push(t.mesh.geometry);
      if (!geos.length) {
        if (b.mesh) { b.mesh.removeFromParent(); b.mesh.geometry.dispose(); b.mesh = null; }
        if (!b.tiles.size) this.blocks.delete(b.key);
        continue;
      }
      const geo = mergeGeos(geos);
      if (b.mesh) {
        b.mesh.geometry.dispose();
        b.mesh.geometry = geo;
      } else {
        const mesh = new THREE.Mesh(geo, this.mats[b.lv]);
        // Schatten nur empfangen: der Schattenausschnitt ist klein (110 m) – Hänge würfen sonst Schatten mit harter Kante
        mesh.receiveShadow = b.lv === 0;
        mesh.castShadow = false;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.userData.lv = b.lv;
        this.group.add(mesh);
        b.mesh = mesh;
      }
    }
  }

  /** (früher: am Ende zusammenlegen) – die Blöcke entstehen jetzt laufend */
  merge() { this.flush(); }

  /** Geometrien einer Stufe (die Kacheln; nach Änderungen changed() und flush()) */
  geometries(lv: number): THREE.BufferGeometry[] {
    const out: THREE.BufferGeometry[] = [];
    for (const t of this.tiles) if (t.lv === lv && t.mesh) out.push(t.mesh.geometry);
    return out;
  }

  /** Zeichenaufrufe der Landschaft (Blöcke mit Netz) */
  get blockCount(): number { let n = 0; for (const b of this.blocks.values()) if (b.mesh) n++; return n; }

  dispose() {
    for (const t of this.tiles) t.mesh?.geometry.dispose();
    for (const b of this.blocks.values()) b.mesh?.geometry.dispose();
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
