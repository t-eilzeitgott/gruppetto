/**
 * Bäume für den WebGPU-Test: Fichte, Lärche und Laubbaum aus Zweigkarten mit gebackenen Nadel- und
 * Blatttexturen (treeart.ts), als Instanzen je Zelle von 256 m. Drei Stufen je Baum – nah viele Äste, mittel
 * wenige große, fern ein gebackenes Bild des nahen Baums – mit weicher Überblendung über breite Bänder (je Baum
 * aus dem Abstand im Shader; beide Stufen zeichnen ihn, solange er im Band ist). Nichts springt, nichts
 * schrumpft weg: ferne Wälder bleiben als Bilder bis fast 2 km stehen und blenden erst dann aus.
 *
 * Normalen zeigen von der Krone weg (weiches Licht wie bei echten Bäumen), leichte Abschattung innen und unten,
 * Wind im Vertex-Shader, etwas Durchscheinen im Gegenlicht.
 */
import * as THREE from 'three/webgpu';
import type { TreeSpot } from '../abfahrt/terrain3d';
import { decodeAlbedo, tsl, type N } from './nodes';
import { commit, disposeGroup, instGroup, instNodes, STRIDE, type InstGroup } from './inst';
import { ARCHS, bakeFoliage, bakeImpostor, coverage, impostorQuad, treeGeometries, type Arch, type Impostor } from './treeart';

const { attribute, cameraPosition, cos, dot, float, max, normalize, positionGeometry, positionWorld, pow, sin, smoothstep, texture, time, transformNormalToView, uniform, uv, varying, vec2, vec3, vertexColor } = tsl;

/** Zufall aus einer Zahl (fest je Baum) */
const rnd = (n: number) => {
  let x = Math.imul(n ^ 0x2c1b3c6d, 0x297a2d39);
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca77);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
};

const archOf = (kind: string): Arch => (kind === 'larch' ? 'larch' : kind === 'pine' || kind === 'pineSnow' ? 'pine' : 'broad');

/** Stufenwechsel: Mitte und halbe Breite des Überblendbands (m) – nah → mittel, mittel → Bild */
const B0: [number, number] = [45, 8];
const B1: [number, number] = [115, 18];
/** ganz fern: Bilder blenden aus */
const FAR: [number, number] = [1550, 1850];
/** Spielraum: die Verteilung je Zelle wird erst nach 6 m Kamerafahrt erneuert */
const MARGIN = 7;

const CELL = 256;

interface Group {
  n: number;
  /** je Baum STRIDE Floats (Ort, Drehung, Größe, Farbe) */
  src: Float32Array;
  xz: Float32Array;
  /** Gruppen je Stufe: nah, mittel, Bild */
  lods: InstGroup[];
}
interface Cell {
  cx: number; cz: number; cy: number;
  spots: TreeSpot[];
  dirty: boolean;
  /** 0 je Baum verteilt, 1 alle als Bild (in der Ferne ausgedünnt), 2 weg; null: neu bestimmen */
  far: 0 | 1 | 2 | null;
  at: THREE.Vector3;
  groups: Group[];
}

export class Trees {
  readonly group = new THREE.Group();
  private geo = treeGeometries();
  private quads: Record<Arch, THREE.BufferGeometry>;
  private mats: THREE.MeshLambertNodeMaterial[] = [];
  private impMats: Record<Arch, THREE.MeshLambertNodeMaterial>;
  private imps: Record<Arch, Impostor>;
  private atlas: THREE.Texture;
  private cells = new Map<string, Cell>();
  readonly sunDir = uniform(new THREE.Vector3(0, 1, 0));
  /**
   * Sichtweite der Bilder-Bäume (m) und ab wo nur noch jeder zweite steht (größer): tausende winzige Flächen mit
   * Deckungsmaske kosten die Grafikkarte viel, unabhängig von der Auflösung – dahinter färbt der Boden den Wald
   */
  readonly farU = uniform(FAR[1]);
  private far = FAR[1];
  thinFrom = 170;
  /**
   * bis hier auf jeden zweiten ausgedünnt, dahinter bis jeden dritten – je Baum nach Abstand gewürfelt (keine
   * Kanten an Zellgrenzen); das Kronendach im Boden trägt dort die Masse des Walds, die Spitzen ragen heraus
   */
  thinFrom2 = 520;
  setFar(m: number) { this.far = m; this.farU.value = m; for (const c of this.cells.values()) c.far = null; }
  count = 0;

  /** msaa: Kantenglättung an (dann Deckung über „alpha to coverage“, sonst harter Schnitt) */
  constructor(renderer: THREE.WebGPURenderer, private msaa: boolean, low = false) {
    this.atlas = bakeFoliage(renderer, low ? 512 : 1024);
    this.imps = {} as Record<Arch, Impostor>;
    this.quads = {} as Record<Arch, THREE.BufferGeometry>;
    this.impMats = {} as Record<Arch, THREE.MeshLambertNodeMaterial>;
    for (const a of ARCHS) {
      const im = bakeImpostor(renderer, this.geo[a][0], this.atlas, low ? 256 : 512);
      this.imps[a] = im;
      this.quads[a] = impostorQuad(im.w, im.h);
      this.impMats[a] = this.impostorMaterial(im);
    }
    // nah: blendet bei B0 aus; mittel: blendet bei B0 ein und bei B1 aus
    this.mats = [this.foliage(null, B0, 'trees-near'), this.foliage(B0, B1, 'trees-mid')];
  }

  private fade(I: { at: N }, fin: [number, number] | null, fout: [number, number] | null): N {
    const d = varying(I.at.xz.sub(cameraPosition.xz).length(), 'vTreeD');
    let f: N = float(1);
    if (fin) f = f.mul(smoothstep(fin[0] - fin[1], fin[0] + fin[1], d));
    if (fout) f = f.mul(float(1).sub(smoothstep(fout[0] - fout[1], fout[0] + fout[1], d)));
    return f;
  }

  /** Zweigkarten: Atlas, Deckung mit Überblendung, Wind, weiches Kronenlicht */
  private foliage(fin: [number, number] | null, fout: [number, number] | null, name: string): THREE.MeshLambertNodeMaterial {
    const m = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
    const I = instNodes();
    const sway = attribute('aSway', 'float');
    // Wind: jeder Baum mit eigener Phase (aus dem Ort), Zweigspitzen mehr als innen
    const ph = I.at.x.mul(0.071).add(I.at.z.mul(0.053));
    const t = time;
    const off = vec3(sin(t.mul(1.25).add(ph)).add(sin(t.mul(2.9).add(ph.mul(1.7)).add(positionGeometry.y)).mul(0.35)), sin(t.mul(2.1).add(ph.mul(2.3)).add(positionGeometry.x)).mul(0.25), cos(t.mul(1.05).add(ph.mul(1.3))).mul(0.7)).mul(sway.mul(0.12));
    m.positionNode = I.world.add(off);
    m.normalNode = I.normal;
    const tx = texture(this.atlas, uv());
    const col: N = decodeAlbedo(tx.rgb).mul(vertexColor().xyz).mul(I.color);
    m.colorNode = col;
    const f = this.fade(I, fin, fout);
    if (this.msaa) { m.opacityNode = coverage(tx.a, f); m.alphaToCoverage = true; } else { m.opacityNode = tx.a.mul(f); m.alphaTest = 0.5; }
    m.maskShadowNode = tx.a.greaterThan(0.45);
    // Gegenlicht: Zweige leuchten etwas durch, wenn man gegen die Sonne schaut
    const view = normalize(positionWorld.sub(cameraPosition));
    m.emissiveNode = col.mul(pow(max(float(0), dot(view, this.sunDir)), 5).mul(sway.min(1).mul(1.2).add(0.2)));
    m.name = name;
    return m;
  }

  /** Bild für die Ferne: Fläche zur Kamera gedreht (um die Hochachse), Normale aus dem Bild mitgedreht */
  private impostorMaterial(im: Impostor): THREE.MeshLambertNodeMaterial {
    const m = new THREE.MeshLambertNodeMaterial();
    const iP = attribute('iP', 'vec4');
    const iS = attribute('iS', 'vec4');
    const iC = attribute('iC', 'vec4');
    const toCam = vec2(cameraPosition.x.sub(iP.x), cameraPosition.z.sub(iP.z));
    const dir2 = toCam.div(max(toCam.length(), float(1e-3)));
    const dir = vec3(dir2.x, 0, dir2.y);
    const right = vec3(dir2.y, 0, dir2.x.negate());
    const p = positionGeometry;
    m.positionNode = iP.xyz.add(right.mul(p.x.mul(iS.x))).add(vec3(0, p.y.mul(iS.y), 0));
    // WebGPU: Zielbilder beginnen oben (die Fläche zählt v von unten)
    const iuv = this.msaa ? vec2(uv().x, float(1).sub(uv().y)) : uv();
    const a = texture(im.albedo, iuv);
    const nb = texture(im.normal, iuv).xyz.mul(2).sub(1);
    const R = varying(right, 'vImpR');
    const D = varying(dir, 'vImpD');
    m.normalNode = transformNormalToView(normalize(R.mul(nb.x).add(vec3(0, 1, 0).mul(nb.y)).add(D.mul(nb.z))));
    m.colorNode = a.rgb.mul(a.rgb).mul(iC.xyz);
    const d = varying(iP.xz.sub(cameraPosition.xz).length(), 'vImpDist');
    const f = smoothstep(B1[0] - B1[1], B1[0] + B1[1], d).mul(float(1).sub(smoothstep(this.farU.sub(300), this.farU, d)));
    if (this.msaa) { m.opacityNode = coverage(a.a, f, 0.3); m.alphaToCoverage = true; } else { m.opacityNode = a.a.mul(f); m.alphaTest = 0.35; }
    m.name = 'trees-far';
    return m;
  }

  /** Bäume einer Landschaftskachel übernehmen (gebaut wird beim nächsten update) */
  addTile(trees: TreeSpot[], cx: number, cz: number) {
    const key = `${Math.floor(cx / CELL)},${Math.floor(cz / CELL)}`;
    let c = this.cells.get(key);
    if (!c) {
      c = { cx: (Math.floor(cx / CELL) + 0.5) * CELL, cz: (Math.floor(cz / CELL) + 0.5) * CELL, cy: 0, spots: [], dirty: true, far: null, at: new THREE.Vector3(1e9, 0, 0), groups: [] };
      this.cells.set(key, c);
    }
    for (const t of trees) c.spots.push(t);
    c.dirty = true;
    this.count += trees.length;
  }

  /** alle Baumstellen (vor dem Einbauen) */
  *allSpots(): Generator<TreeSpot> {
    for (const c of this.cells.values()) yield* c.spots;
  }

  /** Baumstellen in einem Rechteck (Streaming: nur die Gegend eines Abschnitts) */
  *spotsIn(x0: number, z0: number, x1: number, z1: number): Generator<TreeSpot> {
    for (const c of this.cells.values()) {
      if (c.cx + CELL / 2 < x0 || c.cx - CELL / 2 > x1 || c.cz + CELL / 2 < z0 || c.cz - CELL / 2 > z1) continue;
      for (const t of c.spots) if (t.x >= x0 && t.x <= x1 && t.z >= z0 && t.z <= z1) yield t;
    }
  }

  /** Zellen abbauen, die nicht mehr gebraucht werden (Streaming: weit hinter dem Fahrer) */
  prune(keep: (cx: number, cz: number) => boolean) {
    for (const [k, c] of this.cells) {
      if (keep(c.cx, c.cz)) continue;
      for (const g of c.groups) for (const l of g.lods) disposeGroup(l);
      this.count -= c.spots.length;
      this.cells.delete(k);
    }
  }

  /** neu einzubauende Zellen (Streaming: Arbeit, die update noch erledigt) */
  get dirtyCells(): number { let n = 0; for (const c of this.cells.values()) if (c.dirty) n++; return n; }

  /** einzelne Bäume dazu (jeder in seine Zelle) */
  addSpots(list: TreeSpot[]) {
    for (const t of list) this.addTile([t], t.x, t.z);
  }

  /** Bäume im Umkreis entfernen (Platz für ein Haus) */
  clear(x: number, z: number, r: number) {
    for (const c of this.cells.values()) {
      if (Math.abs(c.cx - x) > CELL / 2 + r || Math.abs(c.cz - z) > CELL / 2 + r) continue;
      const n = c.spots.length;
      c.spots = c.spots.filter((t) => (t.x - x) ** 2 + (t.z - z) ** 2 > r * r);
      if (c.spots.length !== n) { c.dirty = true; this.count -= n - c.spots.length; }
    }
  }

  /** Bäume in der Nähe zählen */
  countNear(x: number, z: number, r: number): number {
    let n = 0;
    for (const c of this.cells.values()) {
      if (Math.abs(c.cx - x) > CELL / 2 + r || Math.abs(c.cz - z) > CELL / 2 + r) continue;
      for (const t of c.spots) if ((t.x - x) ** 2 + (t.z - z) ** 2 <= r * r) n++;
    }
    return n;
  }

  private rebuild(c: Cell) {
    for (const g of c.groups) for (const l of g.lods) disposeGroup(l);
    c.groups = [];
    c.dirty = false;
    c.far = null;
    c.at.set(1e9, 0, 0);
    const by: Record<Arch, TreeSpot[]> = { pine: [], larch: [], broad: [] };
    let sy = 0;
    for (const t of c.spots) { by[archOf(t.kind)].push(t); sy += t.y; }
    c.cy = c.spots.length ? sy / c.spots.length : 0;
    const sphere = new THREE.Sphere(new THREE.Vector3(c.cx, c.cy + 8, c.cz), CELL * 0.75);
    for (const a of ARCHS) {
      const list = by[a];
      if (!list.length) continue;
      const n = list.length;
      const src = new Float32Array(n * STRIDE);
      const xz = new Float32Array(n * 2);
      list.forEach((t, k) => {
        const seed = Math.round(t.x * 13 + t.z * 7);
        // größer als im Spiel: ausgewachsener Bergwald (14–25 m), die Kronen schließen sich
        const s = t.s * (a === 'broad' ? 1.15 : 1.4);
        const tint = t.tint;
        // leicht unterschiedlich schlank und gefärbt (keine Klone), aber ruhig
        src.set([
          t.x, t.y + 0.15, t.z, t.rot,
          s * (0.92 + rnd(seed + 1) * 0.16), s * (0.94 + rnd(seed + 2) * 0.12), s * (0.92 + rnd(seed + 3) * 0.16), 0,
          tint * (0.95 + rnd(seed) * 0.1), tint * (0.97 + rnd(seed + 9) * 0.06), tint * (0.94 + rnd(seed + 4) * 0.08), 0,
        ], k * STRIDE);
        xz[k * 2] = t.x;
        xz[k * 2 + 1] = t.z;
      });
      const lods: InstGroup[] = [];
      for (let lv = 0; lv < 3; lv++) {
        const g = lv < 2 ? instGroup(this.geo[a][lv], this.mats[lv], n, sphere) : instGroup(this.quads[a], this.impMats[a], n, sphere);
        // Schatten nur von den nahen Bäumen (der Schattenausschnitt reicht ohnehin nur ~55 m weit)
        g.mesh.castShadow = lv === 0;
        g.mesh.receiveShadow = lv < 2;
        this.group.add(g.mesh);
        lods.push(g);
      }
      c.groups.push({ n, src, xz, lods });
    }
  }

  /** Bäume einer Zelle nach Abstand auf die Stufen verteilen; im Überblendband in beide (all: alle als Bild) */
  /** Anteil der Bilder-Bäume, die in Abstand d stehen bleiben (1 … 1/3) */
  private density(d: number): number {
    if (d <= this.thinFrom) return 1;
    if (d <= this.thinFrom2) return 1 - 0.5 * ((d - this.thinFrom) / (this.thinFrom2 - this.thinFrom));
    return Math.max(0.33, 0.5 - (d - this.thinFrom2) / 1500);
  }

  private partition(c: Cell, cam: THREE.Vector3, farOnly: boolean) {
    c.far = farOnly ? 1 : 0;
    c.at.copy(cam);
    const n0 = B0[0] + B0[1] + MARGIN;
    const m0 = B0[0] - B0[1] - MARGIN;
    const n1 = B1[0] + B1[1] + MARGIN;
    const m1 = B1[0] - B1[1] - MARGIN;
    for (const g of c.groups) {
      const cnt = [0, 0, 0];
      const put = (lv: number, k: number) => { g.lods[lv].data.set(g.src.subarray(k * STRIDE, k * STRIDE + STRIDE), cnt[lv] * STRIDE); cnt[lv]++; };
      // als Bild; in der Ferne ausgedünnt (fest je Baum gewürfelt), die übrigen etwas größer
      const putFar = (k: number, d: number) => {
        const dens = this.density(d);
        if (dens >= 1) { put(2, k); return; }
        if (rnd(Math.round(g.xz[k * 2] * 13 + g.xz[k * 2 + 1] * 7) + 77) > dens) return;
        put(2, k);
        const grow = 1 + (1 - dens) * 0.6;
        const o = (cnt[2] - 1) * STRIDE;
        const D = g.lods[2].data;
        D[o + 4] *= grow; D[o + 5] *= grow; D[o + 6] *= grow;
      };
      for (let k = 0; k < g.n; k++) {
        const d = Math.hypot(g.xz[k * 2] - cam.x, g.xz[k * 2 + 1] - cam.z);
        if (farOnly) { putFar(k, d); continue; }
        if (d < n0) put(0, k);
        if (d > m0 && d < n1) put(1, k);
        if (d > m1) putFar(k, d);
      }
      g.lods.forEach((l, lv) => commit(l, cnt[lv]));
    }
  }

  /** neue Bäume einbauen und Stufen nachführen (je Bild höchstens eine nahe Zelle; all: alles sofort) */
  update(cam: THREE.Vector3, all = false) {
    for (const c of this.cells.values()) {
      if (c.dirty) { this.rebuild(c); if (!all) break; }
    }
    let budget = all ? 1e9 : 1;
    for (const c of this.cells.values()) {
      if (c.dirty || !c.groups.length) continue;
      const dx = Math.max(0, Math.abs(cam.x - c.cx) - CELL / 2);
      const dz = Math.max(0, Math.abs(cam.z - c.cz) - CELL / 2);
      const d = Math.hypot(dx, dz);
      if (d > this.far + MARGIN) {
        if (c.far !== 2) { c.far = 2; for (const g of c.groups) for (const l of g.lods) l.mesh.visible = false; }
        continue;
      }
      if (d > B1[0] + B1[1] + MARGIN) {
        // fern: neu verteilen, wenn die Zelle eben erst fern wurde – sonst erst nach 60 m Kamerafahrt (die Dichte
        // hängt am Abstand; je Bild höchstens eine Zelle, außer sie war ganz weg)
        const fresh = c.far !== 1;
        const fresh2 = d + CELL > this.thinFrom && c.at.distanceToSquared(cam) > 3600;
        if (fresh || fresh2) {
          if (!fresh && budget <= 0) continue;
          if (!fresh) budget--;
          this.partition(c, cam, true);
        }
        continue;
      }
      // nah: neu verteilen, wenn die Kamera 6 m weiter ist (je Bild höchstens eine Zelle)
      if (c.far !== 0 || c.at.distanceToSquared(cam) > 36) {
        if (budget <= 0) continue;
        budget--;
        this.partition(c, cam, false);
      }
    }
  }

  /** Prüfhilfe: sichtbare Bäume je Stufe */
  lodStats(): number[] {
    const n = [0, 0, 0];
    for (const c of this.cells.values()) for (const g of c.groups) g.lods.forEach((l, lv) => { if (l.mesh.visible) n[lv] += l.geo.instanceCount; });
    return n;
  }

  /** Vorwärmen: je Baumart und Stufe eine Gruppe mit einem Baum (Arten, die erst später vorkommen: Laubbäume im Tal) */
  private warmGroups: InstGroup[] = [];

  /** Vorwärmen: jede Gruppe einmal zeichnen lassen (Daten hochladen); danach neu verteilen */
  warm(on: boolean) {
    if (on && !this.warmGroups.length) {
      const sphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
      for (const a of ARCHS) {
        for (let lv = 0; lv < 3; lv++) {
          const g = lv < 2 ? instGroup(this.geo[a][lv], this.mats[lv], 1, sphere) : instGroup(this.quads[a], this.impMats[a], 1, sphere);
          g.mesh.castShadow = lv === 0;
          g.mesh.receiveShadow = lv < 2;
          g.data.set([0, -500, 0, 0, 1, 1, 1, 0, 1, 1, 1, 0], 0);
          commit(g, 1);
          this.group.add(g.mesh);
          this.warmGroups.push(g);
        }
      }
    } else if (!on && this.warmGroups.length) {
      for (const g of this.warmGroups) disposeGroup(g);
      this.warmGroups = [];
    }
    for (const c of this.cells.values()) {
      for (const g of c.groups) {
        for (const l of g.lods) {
          if (on) { l.geo.instanceCount = Math.max(1, l.geo.instanceCount); l.mesh.visible = true; }
        }
      }
      if (!on) c.far = null;
    }
  }

  dispose() {
    for (const c of this.cells.values()) for (const g of c.groups) for (const l of g.lods) disposeGroup(l);
    for (const a of ARCHS) {
      for (const g of this.geo[a]) g.dispose();
      this.quads[a].dispose();
      this.impMats[a].dispose();
      this.imps[a].albedo.dispose();
      this.imps[a].normal.dispose();
    }
    for (const m of this.mats) m.dispose();
    this.atlas.dispose();
  }
}
