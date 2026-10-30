/**
 * Bäume für den WebGPU-Test: dieselbe Vielfalt wie im WebGL-Spiel (forest3d, 19 Varianten: Fichten, verschneite
 * Fichten, Lärchen, Laubbäume, runde Bäume, Zypressen, Oliven, Palmen, Pappeln, Apfelbäume) als Instanzen.
 *
 * Zwei Stufen je Baum: bis gut 50 m das Modell (deckende Geometrie mit Ecken-Farben, keine Zweigkarten mit
 * Deckungsmaske – die flimmern), dahinter ein Bild des fein modellierten Baums (alle Varianten beim Start in einen
 * Bildvorrat gebacken: Farbe und Normale, damit das Licht gleich bleibt). Der Wechsel läuft über ein Bayer-Raster
 * (nodes.ditherVis): jede Stufe zeichnet nur ihren Anteil der Bildpunkte, nie dieselben wie die andere – kein
 * Z-Kampf, kein Flackern.
 *
 * Zeichenaufrufe: die Modelle je Variante eine Gruppe um die Kamera (neu verteilt alle 6 m Fahrt), die Bilder je
 * Zelle von 256 m eine Gruppe für alle Varianten (Variante in iS.w).
 */
import * as THREE from 'three/webgpu';
import type { TreeSpot } from '../abfahrt/terrain3d';
import { TREE_VARIANT_KINDS, treeModel, treeTint, treeVariant } from '../abfahrt/forest3d';
import { ditherVis, tsl, useDither, type N } from './nodes';
import { commit, disposeGroup, instGroup, instNodes, STRIDE, type InstGroup } from './inst';
import { lit, SUN } from './light';
import { terrainSun } from './sunmap';

const { attribute, cameraPosition, clamp, cos, dot, float, fwidth, int, max, normalize, positionGeometry, positionWorld, pow, sin, smoothstep, sqrt, step, texture, time, uniform, uniformArray, uv, varying, vec2, vec3, vec4, vertexColor, normalGeometry } = tsl;

/** Zufall aus einer Zahl (fest je Baum) */
const rnd = (n: number) => {
  let x = Math.imul(n ^ 0x2c1b3c6d, 0x297a2d39);
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca77);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
};
const fr = (x: number) => x - Math.floor(x);

const NV = TREE_VARIANT_KINDS.length;
const CONIFER = new Set(['pine', 'pineSnow', 'larch']);

/** Stufenwechsel Modell → Bild: Mitte und halbe Breite des Überblendbands (m) */
const B0: [number, number] = [40, 8];
/** ganz fern: Bilder blenden aus */
const FAR: [number, number] = [1550, 1850];
/** Spielraum: die Verteilung wird erst nach 6 m Kamerafahrt erneuert */
const MARGIN = 7;
const N0 = B0[0] + B0[1] + MARGIN;
const M0 = B0[0] - B0[1] - MARGIN;
/**
 * bis hier steht ein Baum sicher ganz als Modell (bis zur nächsten Verteilung): ohne Raster-Material. Ausstanzen
 * (discard) schaltet auf Apples Grafik das Weglassen verdeckter Bildpunkte ab – im dichten Wald zahlt sich das aus
 */
const S0 = M0;

const CELL = 256;

/** Bildvorrat: 8 × 3 Zellen (Breite : Höhe = 1 : 2) */
const COLS = 8;
const ROWS = 3;

interface Cell {
  cx: number; cz: number; cy: number;
  spots: TreeSpot[];
  dirty: boolean;
  /** 0 je Baum verteilt (nah), 1 alle als Bild (in der Ferne ausgedünnt), 2 weg; null: neu bestimmen */
  far: 0 | 1 | 2 | null;
  /** Kamera bei der letzten Verteilung (fern: die Dichte hängt am Abstand) */
  at: THREE.Vector3;
  n: number;
  /** je Baum STRIDE Floats: Ort, Drehung, Größe, Variante (iS.w), Farbe */
  src: Float32Array;
  xz: Float32Array;
  vi: Uint8Array;
  imp: InstGroup | null;
}

/** eine Instanz kopieren (ohne Hilfsobjekte: subarray legte je Baum ein Objekt an – Speicherbereinigung) */
function copy1(src: Float32Array, k: number, dst: Float32Array, n: number) {
  const a = k * STRIDE, b = n * STRIDE;
  for (let q = 0; q < STRIDE; q++) dst[b + q] = src[a + q];
}

/** Deckung aus der Textur, an den Kanten scharf (Bildpunkt-genau), mal Sichtbarkeit */
function coverage(a: N, vis: N, cut: number): N {
  const fw = max(fwidth(a), float(1e-4));
  return clamp(a.sub(cut).div(fw).add(0.5), 0, 1).mul(vis);
}

/**
 * weiche Kronennormale: Flächennormale mit der Richtung weg vom Stamm gemischt – die Krone wird rund beleuchtet
 * wie ein echter Baum statt in harten Facetten (gleich im Bildvorrat und an den Modellen)
 */
function softNormal(): N {
  const p = positionGeometry;
  return normalize(normalGeometry.add(normalize(vec3(p.x, 0.6, p.z)).mul(1.2)));
}

interface Atlas { albedo: THREE.Texture; normal: THREE.Texture; rts: THREE.RenderTarget[]; cells: THREE.Vector4[] }

/**
 * Bildvorrat backen: jede Variante fein modelliert von der Seite (Farbe als Wurzel – genauer in dunklen Grüns –
 * und Normale) in ihre Zelle zweier großer Zielbilder. Zelle: Breite W, Höhe 2 W ab y0 (Modellmaße), damit die
 * Bildpunkte quadratisch bleiben.
 */
function bakeAtlas(renderer: THREE.WebGPURenderer, cw: number): Atlas {
  const ch = cw * 2;
  const make = (w: number, h: number) => new THREE.RenderTarget(w, h, {
    type: THREE.UnsignedByteType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
  });
  const nw = cw / 2;
  const rtA = make(cw * COLS, ch * ROWS);
  const rtN = make(nw * COLS, nw * 2 * ROWS);
  const mA = new THREE.MeshBasicNodeMaterial();
  mA.colorNode = vec4(sqrt(max(vertexColor().xyz, vec3(0))), 1);
  const mN = new THREE.MeshBasicNodeMaterial();
  mN.colorNode = vec4(softNormal().mul(0.5).add(0.5), 1);
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -60, 60);
  cam.position.set(0, 0, 30);
  const gl = !(renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend;
  const prevRT = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAuto = renderer.autoClear;
  const cells: THREE.Vector4[] = [];
  for (let i = 0; i < NV; i++) {
    const g = treeModel(i, true);
    const pos = g.getAttribute('position');
    let rad = 0.3, top = 1;
    for (let q = 0; q < pos.count; q++) {
      rad = Math.max(rad, Math.hypot(pos.getX(q), pos.getZ(q)));
      top = Math.max(top, pos.getY(q));
    }
    const W = Math.max(2 * rad * 1.04, (top * 1.03) / 2);
    const H = W * 2;
    const y0 = -0.012 * H;
    cam.left = -W / 2; cam.right = W / 2; cam.bottom = y0; cam.top = y0 + H;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    cells.push(new THREE.Vector4(W, H, y0, 0));
    const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(g, mA);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const col = i % COLS, row = Math.floor(i / COLS);
    for (const [rt, m, w, h, clear] of [[rtA, mA, cw, ch, 0x000000], [rtN, mN, nw, nw * 2, 0x808080]] as [THREE.RenderTarget, THREE.Material, number, number, number][]) {
      mesh.material = m;
      // Zelle oben links gezählt; WebGL zählt die Bildzeilen von unten
      const yTop = row * h;
      rt.viewport.set(col * w, gl ? rt.height - h - yTop : yTop, w, h);
      renderer.setRenderTarget(rt);
      renderer.setClearColor(clear, 0);
      renderer.autoClear = i === 0;
      renderer.render(scene, cam);
    }
    scene.remove(mesh);
    g.dispose();
  }
  renderer.autoClear = prevAuto;
  rtA.viewport.set(0, 0, rtA.width, rtA.height);
  rtN.viewport.set(0, 0, rtN.width, rtN.height);
  renderer.setRenderTarget(prevRT);
  renderer.setClearColor(prevClear, prevAlpha);
  mA.dispose();
  mN.dispose();
  return { albedo: rtA.texture, normal: rtN.texture, rts: [rtA, rtN], cells };
}

/** Grundform für die Instanzen: nur Lage, Normale, Farbe (alle Varianten gleich aufgebaut – ein Programm) */
function baseGeo(i: number): THREE.BufferGeometry {
  const g = treeModel(i, false);
  const b = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'color']) b.setAttribute(k, g.getAttribute(k));
  if (g.index) b.setIndex(g.index);
  b.computeBoundingSphere();
  return b;
}

/** Fläche für das Fernbild: unten in der Mitte verankert, Einheitsgröße (Maße je Variante im Shader) */
function unitQuad(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeBoundingSphere();
  return g;
}

export class Trees {
  readonly group = new THREE.Group();
  /** Grundformen je Variante */
  private geos: THREE.BufferGeometry[];
  private quad = unitQuad();
  private mat: THREE.MeshBasicNodeMaterial;
  private impMat: THREE.MeshBasicNodeMaterial;
  private atlas: Atlas;
  private cells = new Map<string, Cell>();
  /** Modelle um die Kamera: je Variante eine Gruppe im Überblendband (Raster) und eine ganz deckende */
  private near: (InstGroup | null)[] = new Array(NV).fill(null);
  private nearN: number[] = new Array(NV).fill(0);
  private solid: (InstGroup | null)[] = new Array(NV).fill(null);
  private solidN: number[] = new Array(NV).fill(0);
  private matSolid: THREE.MeshBasicNodeMaterial;
  private nearAt = new THREE.Vector3(1e9, 0, 0);
  private nearDirty = true;
  private nearSphere = new THREE.Sphere(new THREE.Vector3(), N0 + 40);
  readonly sunDir = uniform(new THREE.Vector3(0, 1, 0));
  /**
   * Sichtweite der Bilder-Bäume (m) und ab wo nur noch jeder zweite steht (größer): tausende winzige Flächen
   * kosten die Grafikkarte viel, unabhängig von der Auflösung – dahinter färbt der Boden den Wald
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

  /** msaa: Kantenglättung an (dann Bildränder über „alpha to coverage“, sonst harter Schnitt) */
  constructor(renderer: THREE.WebGPURenderer, private msaa: boolean, low = false) {
    this.atlas = bakeAtlas(renderer, low ? 96 : 160);
    this.geos = Array.from({ length: NV }, (_, i) => baseGeo(i));
    this.mat = this.model(true);
    this.matSolid = this.model(false);
    this.impMat = this.impostorMaterial();
  }

  /** Abstand des Baums zur Kamera (je Baum gleich, im Vertex-Shader) */
  private dist(at: N, name: string): N { return varying(at.xz.sub(cameraPosition.xz).length(), name); }

  /** Modell (nah): deckend, Farbe aus den Ecken mal Baumfarbe, Wind, etwas Durchscheinen im Gegenlicht; dither: im Überblendband */
  private model(dither: boolean): THREE.MeshBasicNodeMaterial {
    const m = new THREE.MeshBasicNodeMaterial();
    const I = instNodes();
    // Wind: jeder Baum mit eigener Phase (aus dem Ort), oben mehr als unten
    const y = positionGeometry.y;
    const sway = clamp(y.mul(1 / 12), 0, 1.4).pow(2);
    const ph = I.at.x.mul(0.071).add(I.at.z.mul(0.053));
    const t = time;
    const off = vec3(sin(t.mul(1.25).add(ph)).add(sin(t.mul(2.9).add(ph.mul(1.7)).add(y.mul(0.4))).mul(0.3)), 0, cos(t.mul(1.05).add(ph.mul(1.3))).mul(0.7)).mul(sway.mul(0.16));
    m.positionNode = I.world.add(off);
    const nW = normalize(varying(I.rot(softNormal()), 'vTreeN'));
    const col: N = vertexColor().xyz.mul(I.color);
    m.colorNode = this.foliageLight(col, nW, varying(terrainSun(I.at.xz, true), 'vTreeSun'), clamp(y.mul(1 / 9), 0, 1));
    if (dither) {
      const d = this.dist(I.at, 'vTreeD');
      useDither(m, float(0), float(1).sub(smoothstep(B0[0] - B0[1], B0[0] + B0[1], d)));
    }
    m.name = 'trees-near';
    return m;
  }

  /**
   * Licht des Laubs: weich um die Krone herum (wrap), Sonne nur, wo das vorberechnete Sonnenlicht hinkommt, viel
   * Himmelslicht (Laub streut es nach innen – sonst stehen die Bäume im Schatten fast schwarz da), unten und innen
   * etwas dunkler, gegen die tiefe Sonne leuchten die Ränder warm durch
   */
  private foliageLight(col: N, nW: N, vis: N, up: N): N {
    const view = normalize(positionWorld.sub(cameraPosition));
    const back = pow(max(float(0), dot(view, this.sunDir)), 4).mul(0.55).mul(vis);
    const ao = up.mul(0.42).add(0.7);
    return lit({ col: col.mul(1.12), nWorld: nW, ao: ao.mul(1.3), vis, wrap: 0.55, extra: col.mul(SUN.col).mul(back) });
  }

  /** Bild für die Ferne: Fläche zur Kamera gedreht (um die Hochachse), Normale aus dem Bild mitgedreht */
  private impostorMaterial(): THREE.MeshBasicNodeMaterial {
    const m = new THREE.MeshBasicNodeMaterial();
    const iP = attribute('iP', 'vec4');
    const iS = attribute('iS', 'vec4');
    const iC = attribute('iC', 'vec4');
    const cellU = uniformArray(this.atlas.cells, 'vec4');
    const vi = int(iS.w.add(0.5));
    const cell = cellU.element(vi);
    const toCam = vec2(cameraPosition.x.sub(iP.x), cameraPosition.z.sub(iP.z));
    const dir2 = toCam.div(max(toCam.length(), float(1e-3)));
    const dir = vec3(dir2.x, 0, dir2.y);
    const right = vec3(dir2.y, 0, dir2.x.negate());
    const p = positionGeometry;
    m.positionNode = iP.xyz.add(right.mul(p.x.mul(cell.x).mul(iS.x))).add(vec3(0, p.y.mul(cell.y).add(cell.z).mul(iS.y), 0));
    // Zelle im Vorrat (oben links gezählt; Zielbilder beginnen oben)
    const col = vi.mod(COLS).toFloat();
    const row = vi.div(COLS).toFloat();
    const auv = varying(vec2(col.add(uv().x).div(COLS), row.add(float(1).sub(uv().y)).div(ROWS)), 'vImpUV');
    const a = texture(this.atlas.albedo, auv);
    const nb = texture(this.atlas.normal, auv).xyz.mul(2).sub(1);
    const R = varying(right, 'vImpR');
    const D = varying(dir, 'vImpD');
    const nW = normalize(R.mul(nb.x).add(vec3(0, 1, 0).mul(nb.y)).add(D.mul(nb.z)));
    m.colorNode = this.foliageLight(a.rgb.mul(a.rgb).mul(iC.xyz), nW, varying(terrainSun(iP.xz, true), 'vImpSun'), uv().y.mul(1.3).clamp(0, 1));
    const d = this.dist(iP.xyz, 'vImpDist');
    const b = smoothstep(B0[0] - B0[1], B0[0] + B0[1], d);
    const out = smoothstep(this.farU.sub(300), this.farU, d);
    const vis = ditherVis(float(1).sub(b), float(1).sub(out));
    if (this.msaa) { m.opacityNode = coverage(a.a, vis, 0.3); m.alphaToCoverage = true; } else { m.opacityNode = step(0.35, a.a).mul(vis); m.alphaTestNode = float(0.5); }
    m.name = 'trees-far';
    return m;
  }

  /** Sperrflächen (Dörfer): dort kommen auch mit späteren Kacheln keine Bäume hin – je Zelle (x, z, r) */
  private blocks = new Map<string, number[]>();
  block(x: number, z: number, r: number) {
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) {
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        const k = `${i},${j}`;
        let l = this.blocks.get(k);
        if (!l) { l = []; this.blocks.set(k, l); }
        l.push(x, z, r);
      }
    }
  }
  private blocked(x: number, z: number): boolean {
    const l = this.blocks.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (!l) return false;
    for (let i = 0; i < l.length; i += 3) if ((l[i] - x) ** 2 + (l[i + 1] - z) ** 2 < l[i + 2] * l[i + 2]) return true;
    return false;
  }

  /** Bäume einer Landschaftskachel übernehmen (gebaut wird beim nächsten update) */
  addTile(trees: TreeSpot[], cx: number, cz: number) {
    if (this.blocks.size) trees = trees.filter((t) => !this.blocked(t.x, t.z));
    if (!trees.length) return;
    const key = `${Math.floor(cx / CELL)},${Math.floor(cz / CELL)}`;
    let c = this.cells.get(key);
    if (!c) {
      c = { cx: (Math.floor(cx / CELL) + 0.5) * CELL, cz: (Math.floor(cz / CELL) + 0.5) * CELL, cy: 0, spots: [], dirty: true, far: null, at: new THREE.Vector3(1e9, 0, 0), n: 0, src: new Float32Array(0), xz: new Float32Array(0), vi: new Uint8Array(0), imp: null };
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
      if (c.imp) disposeGroup(c.imp);
      this.count -= c.spots.length;
      this.cells.delete(k);
      this.nearDirty = true;
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

  /** Schatten der Bäume für die Bodenkarte (sunmap.ts): Fuß, Höhe, Kronenradius je Baum im Rechteck */
  splats(x0: number, z0: number, x1: number, z1: number, shadow: (x: number, z: number, h: number, r: number, kind: number) => void) {
    for (const c of this.cells.values()) {
      if (c.cx + CELL / 2 < x0 || c.cx - CELL / 2 > x1 || c.cz + CELL / 2 < z0 || c.cz - CELL / 2 > z1) continue;
      for (const t of c.spots) {
        if (t.x < x0 || t.x > x1 || t.z < z0 || t.z > z1) continue;
        const con = CONIFER.has(t.kind);
        shadow(t.x, t.z, t.s * (con ? 15.5 : 10), t.s * (con ? 2.0 : 2.9), 0);
      }
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
    if (c.imp) disposeGroup(c.imp);
    c.imp = null;
    c.dirty = false;
    c.far = null;
    const n = c.spots.length;
    c.n = n;
    c.src = new Float32Array(n * STRIDE);
    c.xz = new Float32Array(n * 2);
    c.vi = new Uint8Array(n);
    let sy = 0;
    c.spots.forEach((t, k) => {
      sy += t.y;
      const seed = Math.round(t.x * 13 + t.z * 7);
      const r = Math.abs(t.rot);
      const v = treeVariant(t.kind, fr(r * 13.17));
      // ausgewachsener Bergwald: die Kronen schließen sich
      const s = t.s * (CONIFER.has(t.kind) ? 1.25 : 1.1);
      // jeder Baum etwas anders: heller/dunkler, olivgelb oder bläulich (wie im Spiel), leicht unterschiedlich schlank
      const [tr, tg, tb] = treeTint(t.tint, fr(r * 7.3), fr(r * 11.9));
      c.src.set([
        t.x, t.y + 0.1, t.z, t.rot,
        s * (0.92 + rnd(seed + 1) * 0.16), s * (0.94 + rnd(seed + 2) * 0.12), s * (0.92 + rnd(seed + 3) * 0.16), v,
        tr, tg, tb, 0,
      ], k * STRIDE);
      c.xz[k * 2] = t.x;
      c.xz[k * 2 + 1] = t.z;
      c.vi[k] = v;
    });
    c.cy = n ? sy / n : 0;
    if (!n) return;
    const sphere = new THREE.Sphere(new THREE.Vector3(c.cx, c.cy + 8, c.cz), CELL * 0.75);
    const g = instGroup(this.quad, this.impMat, n, sphere);
    g.mesh.castShadow = false;
    g.mesh.receiveShadow = false;
    this.group.add(g.mesh);
    c.imp = g;
  }

  /** Abstand der Kamera zur Zelle (0 innen) */
  private cellDist(c: Cell, cam: THREE.Vector3): number {
    const dx = Math.max(0, Math.abs(cam.x - c.cx) - CELL / 2);
    const dz = Math.max(0, Math.abs(cam.z - c.cz) - CELL / 2);
    return Math.hypot(dx, dz);
  }

  /** Anteil der Bilder-Bäume, die in Abstand d stehen bleiben (1 … 1/3) */
  private density(d: number): number {
    if (d <= this.thinFrom) return 1;
    if (d <= this.thinFrom2) return 1 - 0.5 * ((d - this.thinFrom) / (this.thinFrom2 - this.thinFrom));
    return Math.max(0.33, 0.5 - (d - this.thinFrom2) / 1500);
  }

  /**
   * Baum k der Zelle als Bild an Stelle n (in der Ferne ausgedünnt: fest je Baum gewürfelt, die übrigen etwas
   * größer); Ergebnis: neue Anzahl
   */
  private putFar(c: Cell, k: number, d: number, dst: Float32Array, n: number): number {
    const dens = this.density(d);
    if (dens < 1 && rnd(Math.round(c.xz[k * 2] * 13 + c.xz[k * 2 + 1] * 7) + 77) > dens) return n;
    copy1(c.src, k, dst, n);
    if (dens < 1) {
      const grow = 1 + (1 - dens) * 0.6;
      const o = n * STRIDE;
      dst[o + 4] *= grow; dst[o + 5] *= grow; dst[o + 6] *= grow;
    }
    return n + 1;
  }

  /** ferne Zelle: alle als Bild, nach Abstand ausgedünnt */
  private partitionFar(c: Cell, cam: THREE.Vector3) {
    c.far = 1;
    c.at.copy(cam);
    const g = c.imp!;
    let m = 0;
    for (let k = 0; k < c.n; k++) m = this.putFar(c, k, Math.hypot(c.xz[k * 2] - cam.x, c.xz[k * 2 + 1] - cam.z), g.data, m);
    commit(g, m);
  }

  /** Gruppe einer Variante mit Platz für need Bäume (solid: ganz deckend, sonst im Überblendband) */
  private grow(v: number, need: number, solid = false): InstGroup {
    const list = solid ? this.solid : this.near;
    const old = list[v];
    const cap = Math.max(32, Math.ceil(need * 1.5));
    const g = instGroup(this.geos[v], solid ? this.matSolid : this.mat, cap, this.nearSphere);
    // Schatten nur von den Modellen (der Schattenausschnitt reicht ohnehin nur ~55 m weit)
    g.mesh.castShadow = true;
    g.mesh.receiveShadow = true;
    if (old) { g.data.set(old.data.subarray(0, Math.min(old.data.length, g.data.length))); disposeGroup(old); }
    this.group.add(g.mesh);
    list[v] = g;
    return g;
  }

  /** Bäume der nahen Zellen nach Abstand verteilen: Modell oder Bild, im Überblendband beides */
  private refreshNear(cam: THREE.Vector3, cells: Cell[]) {
    this.nearAt.copy(cam);
    this.nearDirty = false;
    this.nearSphere.center.copy(cam);
    const N = this.nearN;
    N.fill(0);
    const S = this.solidN;
    S.fill(0);
    const n0 = N0 * N0, m0 = M0 * M0, s0 = S0 * S0;
    for (const c of cells) {
      c.far = 0;
      c.at.copy(cam);
      const g = c.imp!;
      const D = g.data;
      let ni = 0;
      for (let k = 0; k < c.n; k++) {
        const dx = c.xz[k * 2] - cam.x, dz = c.xz[k * 2 + 1] - cam.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < s0) {
          const v = c.vi[k];
          let q = this.solid[v];
          const n = S[v];
          if (!q || (n + 1) * STRIDE > q.data.length) q = this.grow(v, n + 1, true);
          copy1(c.src, k, q.data, n);
          S[v] = n + 1;
        } else if (d2 < n0) {
          const v = c.vi[k];
          let q = this.near[v];
          const n = N[v];
          if (!q || (n + 1) * STRIDE > q.data.length) q = this.grow(v, n + 1);
          copy1(c.src, k, q.data, n);
          N[v] = n + 1;
        }
        if (d2 > m0) ni = this.putFar(c, k, Math.sqrt(d2), D, ni);
      }
      commit(g, ni);
    }
    for (let v = 0; v < NV; v++) {
      const g = this.near[v];
      if (g) commit(g, N[v]);
      const h = this.solid[v];
      if (h) commit(h, S[v]);
    }
  }

  /** neue Bäume einbauen und Stufen nachführen (je Bild höchstens eine neue Zelle; all: alles sofort) */
  update(cam: THREE.Vector3, all = false) {
    for (const c of this.cells.values()) {
      if (c.dirty) { this.rebuild(c); this.nearDirty = true; if (!all) break; }
    }
    const near: Cell[] = [];
    let budget = all ? 1e9 : 1;
    for (const c of this.cells.values()) {
      if (c.dirty || !c.imp) continue;
      const d = this.cellDist(c, cam);
      if (d > this.far + MARGIN) {
        if (c.far !== 2) { c.far = 2; c.imp.mesh.visible = false; }
        continue;
      }
      if (d > N0) {
        // fern: neu verteilen, wenn die Zelle eben erst fern wurde – sonst erst nach 60 m Kamerafahrt (die Dichte
        // hängt am Abstand; je Bild höchstens eine Zelle, außer sie war ganz weg)
        const fresh = c.far !== 1;
        if (fresh || (d + CELL > this.thinFrom && c.at.distanceToSquared(cam) > 3600 && budget-- > 0)) this.partitionFar(c, cam);
        continue;
      }
      if (c.far !== 0) this.nearDirty = true;
      near.push(c);
    }
    if (this.nearDirty || this.nearAt.distanceToSquared(cam) > 36) this.refreshNear(cam, near);
  }

  /** Prüfhilfe: sichtbare Bäume je Stufe (Modell, Bild) */
  lodStats(): number[] {
    const n = [0, 0];
    for (const g of [...this.near, ...this.solid]) if (g?.mesh.visible) n[0] += g.geo.instanceCount;
    for (const c of this.cells.values()) if (c.imp?.mesh.visible) n[1] += c.imp.geo.instanceCount;
    return n;
  }

  /** Vorwärmen: je Variante eine Gruppe mit einem Baum (Varianten, die erst später vorkommen) */
  private warmGroups: InstGroup[] = [];

  /** Vorwärmen: jede Gruppe einmal zeichnen lassen (Daten hochladen); danach neu verteilen */
  warm(on: boolean) {
    if (on && !this.warmGroups.length) {
      const sphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow: boolean, v: number) => {
        const g = instGroup(geo, mat, 1, sphere);
        g.mesh.castShadow = shadow;
        g.mesh.receiveShadow = shadow;
        g.data.set([0, -500, 0, 0, 1, 1, 1, v, 1, 1, 1, 0], 0);
        commit(g, 1);
        this.group.add(g.mesh);
        this.warmGroups.push(g);
      };
      for (let v = 0; v < NV; v++) { add(this.geos[v], this.mat, true, v); add(this.geos[v], this.matSolid, true, v); }
      add(this.quad, this.impMat, false, 0);
    } else if (!on && this.warmGroups.length) {
      for (const g of this.warmGroups) disposeGroup(g);
      this.warmGroups = [];
    }
    if (on) {
      for (const c of this.cells.values()) if (c.imp) { c.imp.geo.instanceCount = Math.max(1, c.imp.geo.instanceCount); c.imp.mesh.visible = true; }
      for (const g of [...this.near, ...this.solid]) if (g) { g.geo.instanceCount = Math.max(1, g.geo.instanceCount); g.mesh.visible = true; }
    } else {
      for (const c of this.cells.values()) c.far = null;
      this.nearDirty = true;
    }
  }

  dispose() {
    for (const c of this.cells.values()) if (c.imp) disposeGroup(c.imp);
    for (const g of [...this.near, ...this.solid]) if (g) disposeGroup(g);
    for (const g of this.warmGroups) disposeGroup(g);
    for (const g of this.geos) g.dispose();
    this.quad.dispose();
    this.mat.dispose();
    this.matSolid.dispose();
    this.impMat.dispose();
    for (const rt of this.atlas.rts) rt.dispose();
  }
}
