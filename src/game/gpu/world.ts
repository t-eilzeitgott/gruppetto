/**
 * Endlose Welt für die WebGPU-Abfahrt: dieselben Bausteine wie der Test (Landschaft, Straße, Bäume, Waldrand,
 * Häuser, Pflanzen und Tiere, Zuschauer, Tunnel), aber gestreamt – in Abschnitten von 256 m voraus
 * gebaut und hinter dem Fahrer wieder abgebaut.
 *
 * Jeder Abschnitt ist ein Generator in kleinen Schritten: zwischen den Schritten prüft der Bau die Zeitgrenze
 * des Bilds (late) und gibt ab. So kostet das Nachladen je Bild nur das eingestellte Budget (~1,5 ms) statt
 * eines Rucklers. Reihenfolge je Abschnitt: feine Landschaft ringsum (mit ihren Bäumen) → Waldrand (Messen,
 * Aufforsten, Waldboden) → Straße und Rand → Tunnel → Zuschauer → Häuser → Pflanzen und Tiere.
 *
 * Der Startbereich bleibt immer stehen (ein neuer Lauf beginnt ohne Ladezeit).
 */
import * as THREE from 'three/webgpu';
import { SEG, type Track } from '../abfahrt/track';
import type { Terrain } from '../abfahrt/terrain3d';
import { Corridor, type CorridorMats } from './corridor';
import { Crowd } from './crowd';
import { Field, type RouteSample } from './field';
import { ForestEdge } from './forest';
import { Houses } from './houses';
import { Villages } from './village';
import { Life } from './life';
import { Trees } from './trees';
import { warmLamps } from './lamps';
import { Tunnels } from './tunnel';
import { Arches } from './arches';
import { Towns } from './town';
import { tsl } from './nodes';
import { cheapMaterial } from './light';

const { frontFacing, normalWorldGeometry, select, texture, uv, vec3 } = tsl;

/** Abschnitt: 128 Segmente = 256 m */
export const PIECE = 128;
const PIECE_M = PIECE * SEG;
/** so weit voraus wird gebaut (m) */
export const AHEAD = 1350;
/** so weit hinter dem Fahrer bleibt die Welt stehen (m; in Kehren sieht man zurück) */
const BEHIND = 520;
/** Startbereich, der immer stehen bleibt (m) */
const KEEP_START = 1536;

interface Piece {
  k: number;
  group: THREE.Group;
  done: boolean;
}

export interface WorldParts {
  renderer: THREE.WebGPURenderer;
  track: Track;
  terrain: Terrain;
  msaa: boolean;
  low: boolean;
  /** Bodenmaterialien je Landschaftsstufe */
  terrainMats: THREE.Material[];
  corridorMats: CorridorMats;
  /** Atlas der Banden (Pappschilder der Zuschauer) */
  adsMap: THREE.Texture | null;
  surfaces: ConstructorParameters<typeof Houses>[0];
  crowd: boolean;
  /** Akzentfarbe (Start-, Ziel- und GPM-Bögen) */
  accent?: string;
}

export class World {
  readonly group = new THREE.Group();
  readonly field: Field;
  readonly trees: Trees;
  readonly corridor: Corridor;
  readonly crowd: Crowd | null;
  readonly houses: Houses;
  readonly life: Life;
  readonly forest: ForestEdge;
  readonly tunnels: Tunnels;
  readonly arches: Arches;
  readonly towns: Towns;
  readonly villages: Villages;
  private track: Track;
  private terrain: Terrain;
  private pieces = new Map<number, Piece>();
  private job: { k: number; it: Generator<void, void, void> } | null = null;
  private until = Infinity;
  private winEnd = 0;
  private signMat: THREE.Material | null = null;
  private w = { x: 0, y: 0, z: 0, th: 0 };
  /** Prüfhilfe: Bauzeit je Bild (ms, geglättet), gebaute Abschnitte */
  stats = { built: 0, dropped: 0, ms: 0, maxMs: 0, front: 0 };
  /** Prüfhilfe: längster einzelner Bauschritt je Teil (ms) – zeigt, was ruckeln kann */
  stepMax: Record<string, number> = {};
  private lbl = '';
  private noteStep(lbl: string, ms: number) { if (ms > (this.stepMax[lbl] ?? 0)) this.stepMax[lbl] = Math.round(ms * 10) / 10; }
  private lastPrune = -1e9;

  constructor(private p: WorldParts) {
    this.track = p.track;
    this.terrain = p.terrain;
    this.trees = new Trees(p.renderer, p.msaa, p.low);
    this.field = new Field(p.terrain, [], p.terrainMats, { onTrees: (_k, list, cx, cz) => this.trees.addTile(list, cx, cz) });
    this.corridor = new Corridor(p.track, p.terrain, p.corridorMats);
    this.crowd = p.crowd ? new Crowd() : null;
    this.houses = new Houses(p.surfaces, p.msaa);
    this.life = new Life(p.msaa);
    this.forest = new ForestEdge(p.track, p.terrain, 0, 0);
    this.tunnels = new Tunnels(p.track, p.corridorMats.sides, p.surfaces);
    this.arches = new Arches(p.track, p.accent ?? '#ff5fa2');
    this.towns = new Towns({
      track: p.track, terrain: p.terrain,
      ground: (s, sg, dx) => this.corridor.groundAt(s, sg, dx),
      trees: (list) => this.trees.addSpots(list),
      plate: (g, i, x, h, text, sub, w, posts) => this.arches.plate(g, i, x, h, text, sub, w, posts),
    });
    this.villages = new Villages({
      track: p.track, terrain: p.terrain, houses: this.houses, trees: this.trees,
      roadDist: (x, z) => this.roadDistAll(x, z),
      ground: (s, sg, dx) => this.corridor.groundAt(s, sg, dx),
      plate: (g, i, x, h, text, sub, w, posts) => this.arches.plate(g, i, x, h, text, sub, w, posts),
      mat: this.towns.mats.plain,
    });
    // Dörfer früh kennen: das Gelände dort wird flacher, bevor die ersten Kacheln entstehen
    this.villages.ahead(6000);
    if (p.adsMap) {
      const m = cheapMaterial({ col: select(frontFacing, texture(p.adsMap, uv()).rgb, vec3(0.3, 0.2, 0.11)), nWorld: normalWorldGeometry, params: { side: THREE.DoubleSide } });
      m.name = 'signs';
      this.signMat = m;
    }
    this.group.add(this.field.group, this.trees.group, this.houses.group, this.life.group);
    if (this.crowd) this.group.add(this.crowd.group);
  }

  private late = () => performance.now() > this.until;

  /** Mittellinie der Strecke alle 4 m in Zellen zu 32 m (bis rEnd gefüllt) – Abstand zu jeder Stelle der Straße */
  private rGrid = new Map<number, number[]>();
  private rEnd = 0;
  private roadIndex(zEnd: number) {
    const t = this.track;
    const end = Math.min(zEnd, (t.length - 2) * SEG);
    for (let z = this.rEnd; z <= end; z += 4) {
      t.world(z, 0, 0, this.w);
      const k = (Math.floor(this.w.x / 32) + 32768) * 65536 + (Math.floor(this.w.z / 32) + 32768);
      let l = this.rGrid.get(k);
      if (!l) { l = []; this.rGrid.set(k, l); }
      l.push(this.w.x, this.w.z);
    }
    this.rEnd = Math.max(this.rEnd, end + 4);
  }
  /** Abstand zur nächsten Stelle der Straße (alle Schenkel); fern: groß */
  roadDistAll(x: number, z: number): number {
    const cx = Math.floor(x / 32), cz = Math.floor(z / 32);
    let bd = Infinity;
    for (let j = -2; j <= 2; j++) {
      for (let i = -2; i <= 2; i++) {
        const l = this.rGrid.get((cx + i + 32768) * 65536 + (cz + j + 32768));
        if (!l) continue;
        for (let q = 0; q < l.length; q += 2) { const d = (l[q] - x) ** 2 + (l[q + 1] - z) ** 2; if (d < bd) bd = d; }
      }
    }
    return bd === Infinity ? 1e9 : Math.sqrt(bd);
  }

  /** alle Dinge, die Schatten auf den Boden werfen oder ihn beleuchten (Bodenkarte, sunmap.ts) */
  readonly splats = (x0: number, z0: number, x1: number, z1: number, shadow: (x: number, z: number, h: number, r: number, kind: number) => void, light: (x: number, z: number, r: number, k: number) => void) => {
    this.trees.splats(x0, z0, x1, z1, shadow);
    this.houses.splats(x0, z0, x1, z1, shadow);
    this.towns.splats(x0, z0, x1, z1, shadow, light);
    this.villages.splats(x0, z0, x1, z1, light);
  };

  /** Streckenpunkte eines Bereichs (alle 8 m) */
  private route(z0: number, z1: number): RouteSample[] {
    const out: RouteSample[] = [];
    for (let z = Math.max(0, z0); z <= z1; z += 8) {
      this.track.world(z, 0, 0, this.w);
      out.push({ x: this.w.x, z: this.w.z });
    }
    return out;
  }

  /** Rechteck um einen Bereich der Strecke (mit Rand) */
  private bbox(z0: number, z1: number, m: number): [number, number, number, number] {
    let x0 = Infinity, zz0 = Infinity, x1 = -Infinity, zz1 = -Infinity;
    for (let z = Math.max(0, z0); z <= z1; z += 16) {
      this.track.world(z, 0, 0, this.w);
      x0 = Math.min(x0, this.w.x); x1 = Math.max(x1, this.w.x); zz0 = Math.min(zz0, this.w.z); zz1 = Math.max(zz1, this.w.z);
    }
    return [x0 - m, zz0 - m, x1 + m, zz1 + m];
  }

  /** ein Abschnitt in Schritten */
  private *pieceSteps(k: number): Generator<void, void, void> {
    const z0 = k * PIECE_M;
    const z1 = z0 + PIECE_M;
    const i0 = k * PIECE;
    const i1 = i0 + PIECE;
    const piece: Piece = { k, group: new THREE.Group(), done: false };
    this.pieces.set(k, piece);
    // Probenfenster der Landschaft weit genug voraus (in großen Schritten: das Umstellen kostet)
    this.lbl = 'fenster';
    if (z1 + 1500 > this.winEnd) {
      this.winEnd = z1 + 4000;
      this.terrain.window(0, this.winEnd);
      yield;
    }
    // Landschaftskacheln um diesen Abschnitt, Streckenpunkte für den Waldrand
    this.lbl = 'kacheln';
    const pts = this.route(z0, z1);
    this.field.extend(pts);
    this.forest.extend(z1 + 320);
    yield;
    // die feine Stufe ringsum muss stehen (ihre Bäume braucht der Waldrand)
    const mid = pts[pts.length >> 1];
    while (this.field.pending(pts, 240, 0)) {
      this.field.build(mid.x, mid.z, this.until, Infinity, 0);
      if (this.late()) yield;
    }
    yield;
    // Waldrand: messen, aufforsten, Waldboden bis an die Straße
    this.lbl = 'wald';
    const [bx0, bz0, bx1, bz1] = this.bbox(z0 - 60, z1 + 60, 90);
    const near = [...this.trees.spotsIn(bx0, bz0, bx1, bz1)];
    yield;
    yield* this.forest.measureSteps(z0, z1, near, this.late);
    yield;
    const fill = yield* this.forest.fillSteps(z0, z1 - 1, near, this.late);
    this.trees.addSpots(fill);
    yield;
    this.lbl = 'waldboden';
    for (const geo of this.field.tilesIn(0, bx0, bz0, bx1, bz1)) { yield* this.forest.boostSteps(geo, 'aMat', this.late); this.field.changed(geo); if (this.late()) yield; }
    // Straße und Rand
    this.lbl = 'strasse';
    const road = yield* this.corridor.buildRange(i0, i1);
    yield;
    this.lbl = 'strasse:wald';
    for (const o of road.children) { const m = o as THREE.Mesh; if (m.isMesh && m.geometry.getAttribute('aW')) yield* this.forest.boostSteps(m.geometry, 'aW', this.late); }
    piece.group.add(road);
    yield;
    // Tunnel
    this.lbl = 'tunnel';
    const tun = yield* this.tunnels.buildRange(i0, i1);
    if (tun) piece.group.add(tun);
    // vor den Portalen keine Bäume (die Fassade steht frei)
    const pt = this.tunnels.portals;
    for (let q = 0; q < pt.length; q += 2) { this.trees.block(pt[q], pt[q + 1], 13); this.trees.clear(pt[q], pt[q + 1], 13); }
    // Torbögen (Start, Zwischenzeiten, Gipfel, Ziel)
    this.lbl = 'boegen';
    this.arches.addRange(piece.group, i0, i1);
    // Ortsdurchfahrten: Häuserzeilen, Gassen, Gehsteig
    this.lbl = 'ort';
    const town = yield* this.towns.buildRange(k, i0, i1, this.late);
    if (town) piece.group.add(town);
    // Zuschauer und ihre Schilder
    this.lbl = 'zuschauer';
    if (this.crowd) {
      const signs = this.crowd.addRange(this.track, (s, sg, dx) => this.corridor.edgeHeight(s, sg, dx), (i, sg) => this.terrain.lim(i)[sg < 0 ? 0 : 1], i0, i1);
      if (signs.pos.length && this.signMat) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(signs.pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(signs.uv, 2));
        g.computeVertexNormals();
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, this.signMat);
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = true;
        piece.group.add(mesh);
      }
      yield;
    }
    // Häuser (Abstand zur Straße über alle Stellen der Strecke – auch über die, die erst später gebaut werden: nach
    // einer Kehre liegt der nächste Schenkel oft gleich daneben, früher stand dort dann ein Haus auf der Fahrbahn)
    this.roadIndex(z1 + 1600);
    // Dörfer: Häuserzeilen, Kirche, Dorfplatz, Laternen
    this.lbl = 'dorf';
    const village = yield* this.villages.buildRange(k, z0, z1, this.late);
    if (village) piece.group.add(village);
    const roadDist = (x: number, z: number) => this.roadDistAll(x, z);
    this.lbl = 'haeuser';
    yield* this.houses.addRange({ track: this.track, terrain: this.terrain, trees: this.trees, roadDist, occ: [...this.towns.occ, ...this.villages.occ] }, z0, z1, 6, this.late);
    // Pflanzen und Tiere
    const [lx0, lz0, lx1, lz1] = this.bbox(z0 - 40, z1 + 40, 230);
    const trees = this.trees;
    this.lbl = 'leben';
    yield* this.life.addRange({
      track: this.track, terrain: this.terrain, forest: this.forest,
      trees: { countNear: (x, z, r) => trees.countNear(x, z, r), allSpots: () => trees.spotsIn(lx0, lz0, lx1, lz1) },
      houses: [...this.houses.positions, ...this.towns.centers()], farms: this.houses.positions, z0, z1, msaa: this.p.msaa,
    }, this.late);
    piece.group.updateMatrixWorld(true);
    this.group.add(piece.group);
    piece.done = true;
    this.stats.built++;
  }

  /** wie weit ist die Welt fertig gebaut (m)? */
  get builtTo(): number {
    let k = 0;
    while (this.pieces.get(k)?.done) k++;
    return k * PIECE_M;
  }

  /** fertig gebaut ab dem Abschnitt des Fahrers bis (m) */
  builtFrom(pz: number): number {
    let k = Math.max(0, Math.floor((pz - 64) / PIECE_M));
    while (this.pieces.get(k)?.done) k++;
    return k * PIECE_M;
  }

  /** fertig bis zum Fahrer + ahead? */
  readyAt(pz: number, ahead: number): boolean {
    for (let k = Math.max(0, Math.floor((pz - 64) / PIECE_M)); k <= Math.floor((pz + ahead) / PIECE_M); k++) if (!this.pieces.get(k)?.done) return false;
    return true;
  }

  /**
   * je Bild: bauen bis zur Zeit until (performance.now()). Zuerst der nächste fehlende Abschnitt voraus, danach
   * die gröberen Landschaftsstufen; hinten abbauen (alle 128 m Fahrt).
   */
  step(pz: number, until: number) {
    const t0 = performance.now();
    this.until = until;
    try {
      // geänderte Landschaftsblöcke zuerst zusammenlegen (die Kacheln dazu sind schon fertig)
      if (this.field.dirtyCount) {
        const ts = performance.now();
        this.field.flush(until);
        this.noteStep('bloecke', performance.now() - ts);
      }
      while (performance.now() < until) {
        // Abbau hinten zuerst (in Schritten), dann der nächste Abschnitt voraus
        if (this.pruneJob) {
          const ts = performance.now();
          const r = this.pruneJob.next();
          this.noteStep(`abbau:${this.pruneLbl}`, performance.now() - ts);
          if (r.done) this.pruneJob = null;
          continue;
        }
        if (!this.job) {
          const k = this.nextPiece(pz);
          if (k < 0) break;
          this.job = { k, it: this.pieceSteps(k) };
        }
        const ts = performance.now();
        const r = this.job.it.next();
        this.noteStep(this.lbl === 'leben' ? `leben:${this.life.phase}` : this.lbl === 'strasse' ? `strasse:${this.corridor.phase}` : this.lbl === 'ort' ? `ort:${this.towns.phase}` : this.lbl, performance.now() - ts);
        if (r.done) this.job = null;
      }
      // Fernsicht (mittlere und grobe Landschaft) in der übrigen Zeit
      if (performance.now() < until) {
        const ts = performance.now();
        this.track.world(pz + 300, 0, 0, this.w);
        this.field.build(this.w.x, this.w.z, until, 2500);
        this.noteStep('fern', performance.now() - ts);
      }
    } finally {
      this.until = Infinity;
    }
    if (Math.abs(pz - this.lastPrune) > 128 && !this.pruneJob) { this.lastPrune = pz; this.pruneJob = this.pruneSteps(pz); }
    const ms = performance.now() - t0;
    this.stats.ms += (ms - this.stats.ms) * 0.05;
    this.stats.maxMs = Math.max(this.stats.maxMs * 0.995, ms);
    this.stats.front = this.builtFrom(pz);
  }

  /** nächster fehlender Abschnitt zwischen Fahrer und Fahrer + AHEAD (−1: alles da) */
  private nextPiece(pz: number): number {
    const a = Math.max(0, Math.floor((pz - 64) / PIECE_M));
    const b = Math.floor((pz + AHEAD) / PIECE_M);
    for (let k = a; k <= b; k++) if (!this.pieces.has(k)) return k;
    return -1;
  }

  /** alles bis z am Stück bauen (Ladeschirm) */
  buildUpTo(pz: number, z: number, until = Infinity) {
    this.until = until;
    try {
      for (let k = 0; k * PIECE_M < z; k++) {
        if (this.pieces.get(k)?.done) continue;
        if (this.job && this.job.k !== k) continue;
        if (!this.job) this.job = { k, it: this.pieceSteps(k) };
        for (;;) {
          const r = this.job.it.next();
          if (r.done) { this.job = null; break; }
          if (this.late()) return false;
        }
      }
      this.track.world(pz + 300, 0, 0, this.w);
      while (this.field.hasWork(this.w.x, this.w.z, 2500)) {
        this.field.build(this.w.x, this.w.z, until, 2500);
        if (this.late()) return false;
      }
      this.field.flush();
      return true;
    } finally {
      this.until = Infinity;
    }
  }

  /** Bauzustand für den Ladebalken (0 … 1) */
  progressTo(z: number): number {
    let n = 0, d = 0;
    for (let k = 0; k * PIECE_M < z; k++) { n++; if (this.pieces.get(k)?.done) d++; }
    return n ? d / n : 1;
  }

  private pruneJob: Generator<void, void, void> | null = null;
  private pruneLbl = '';

  /** hinten (und weit voraus nach einem Neustart) abbauen; der Startbereich bleibt */
  prune(pz: number) {
    const it = this.pruneSteps(pz);
    while (!it.next().done) { /* am Stück */ }
  }

  /** Abbau in Schritten (je Baustein einer) */
  private *pruneSteps(pz: number): Generator<void, void, void> {
    this.pruneLbl = 'stuecke';
    const lo = pz - BEHIND;
    const hi = pz + AHEAD + PIECE_M;
    const keepZ = (z: number) => z < KEEP_START || (z > lo - PIECE_M && z < hi + PIECE_M);
    let dropped = false;
    for (const [k, pc] of this.pieces) {
      const z0 = k * PIECE_M, z1 = z0 + PIECE_M;
      if (z0 < KEEP_START || (z1 > lo && z0 < hi)) continue;
      if (this.job?.k === k) this.job = null;
      pc.group.removeFromParent();
      pc.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      this.towns.drop(k);
      this.villages.drop(k);
      this.pieces.delete(k);
      this.stats.dropped++;
      dropped = true;
    }
    if (!dropped) return;
    yield;
    this.pruneLbl = 'feld';
    // Punkte, deren Umgebung bleiben soll: Startbereich und das Fenster um den Fahrer
    const keepPts: RouteSample[] = [];
    for (const k of this.pieces.keys()) keepPts.push(...this.route(k * PIECE_M, (k + 1) * PIECE_M).filter((_, i) => i % 4 === 0));
    yield* this.field.pruneSteps(keepPts);
    const near = (cx: number, cz: number, r: number) => {
      for (const q of keepPts) if ((q.x - cx) ** 2 + (q.z - cz) ** 2 < r * r) return true;
      return false;
    };
    yield;
    this.pruneLbl = 'baeume';
    this.trees.prune((cx, cz) => near(cx, cz, 420));
    yield;
    this.pruneLbl = 'leben';
    this.life.prune((cx, cz, cell) => near(cx, cz, 420 + cell * 0.71));
    yield;
    this.pruneLbl = 'haeuser';
    this.houses.prune(keepZ);
    this.crowd?.prune(keepZ);
  }

  /** je Bild: Stufen nach Abstand (Bäume, Häuser, Pflanzen, Zuschauer, Gras) */
  update(cam: THREE.Vector3, rider: THREE.Vector3, force = false) {
    this.trees.update(cam, force);
    this.houses.update(cam, force);
    this.life.update(cam, force);
    this.crowd?.update(cam, rider, force);
    this.towns.update(cam);
  }

  /**
   * Vorwärmen, was erst später auf der Strecke vorkommt: Straßenrand jeder Landschaft (Dorf, See, Weinberge …),
   * ein Tunnel mit Portalen, Schilder der Zuschauer. Einmal gebaut (weit voraus, nur für das Übersetzen der
   * Shader gezeigt), danach mit dispose() wieder weg – unterwegs entsteht so kein neuer Shader.
   */
  warmKit(): { group: THREE.Group; dispose(): void } {
    const group = new THREE.Group();
    const t = this.track;
    const run = <T>(it: Generator<void, T, void>): T => { for (;;) { const r = it.next(); if (r.done) return r.value; } };
    const SCAN = 6000;
    if (SCAN * SEG + 400 > this.winEnd) { this.winEnd = SCAN * SEG + 1500; this.terrain.window(0, this.winEnd); }
    const seen = new Set<string>();
    let tunnelAt = -1;
    for (let i = 40; i < SCAN && (seen.size < 6 || tunnelAt < 0); i += 6) {
      const s = t.seg(i);
      const b = t.sections[s.sec]?.biome ?? 'alpine';
      if (s.tunnel) { if (tunnelAt < 0) tunnelAt = i; continue; }
      // je Landschaft ein Stück, dazu eines mit Zuschauern und eines mit Brücke
      const key = s.bridge > 0 ? 'bridge' : s.crowd ? `${b}+crowd` : b;
      if (seen.has(key) && seen.has(b)) continue;
      seen.add(key); seen.add(b);
      group.add(run(this.corridor.buildRange(i, i + 24)));
    }
    if (tunnelAt >= 0) {
      let a = tunnelAt;
      while (a > 0 && t.seg(a - 1).tunnel) a--;
      const tun = run(this.tunnels.buildRange(Math.max(0, a - 2), a + 30));
      if (tun) group.add(tun);
    }
    group.add(this.arches.warm());
    group.add(this.tunnels.warm());
    group.add(this.towns.warm());
    group.add(warmLamps());
    this.arches.plate(group, 2, 0, 0, 'GRUPPETTO', '');
    if (this.signMat) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, this.signMat);
      mesh.castShadow = true;
      group.add(mesh);
    }
    group.updateMatrixWorld(true);
    return {
      group,
      dispose: () => {
        group.removeFromParent();
        group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      },
    };
  }

  /** Vorwärmen: alles einmal zeichnen lassen */
  warm(on: boolean) {
    this.trees.warm(on);
    this.houses.warm(on);
    this.life.warm(on);
    this.crowd?.warm(on);
  }

  dispose() {
    for (const pc of this.pieces.values()) pc.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    this.field.dispose();
    this.trees.dispose();
    this.houses.dispose();
    this.life.dispose();
    this.crowd?.dispose();
    this.tunnels.dispose();
    this.arches.dispose();
    this.towns.dispose();
    this.signMat?.dispose();
  }
}
