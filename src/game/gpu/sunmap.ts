/**
 * Vorberechnete Schatten und Lichter um den Fahrer (Abfahrt auf WebGPU, feste Abendsonne) – zwei Karten von oben,
 * die nur ab und zu neu gezeichnet werden (der Fahrer ist weit genug gefahren, neue Abschnitte sind da), nie je Bild:
 *
 * - Geländelicht (3,2 km, 2048²): das gebackene Sonnenlicht der Landschaftskacheln (sunbake.ts) von oben – alles,
 *   was auf dem Gelände steht (Bäume, Häuser, Fahrer, Zuschauer, Straße), liest hier, ob die Berge es beschatten.
 * - Bodenkarte (1 km, 1024²): Schatten der Bäume, Häuser und Gebäude auf dem Boden (weiche Flecken in Richtung
 *   der Sonne, je Objekt ein Fleck), im Alphakanal das Licht der Laternen (warme Lichtkegel auf Straße und Platz).
 *
 * Gelesen wird mit der Weltlage (x, z) – ein Texturzugriff je Bildpunkt, außerhalb der Karten volles Licht.
 */
import * as THREE from 'three/webgpu';
import { tsl, type N } from './nodes';
import { commit, instGroup, STRIDE, type InstGroup } from './inst';

const { abs, attribute, float, positionGeometry, select, smoothstep, texture, uniform, vec2, vec3, vec4 } = tsl;

/** Ausschnitt der Geländelicht-Karte (m) und Auflösung */
const T_SIZE = 3200;
const T_RES = 2048;
/** Bodenkarte */
const O_SIZE = 1024;
const O_RES = 1024;

function placeholder(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1);
  t.needsUpdate = true;
  return t;
}

/** Knoten, die die Materialien lesen (die Texturen werden nach dem ersten Zeichnen eingesetzt) */
export const SUNMAP = {
  terrain: texture(placeholder()) as N,
  tOrigin: uniform(new THREE.Vector2(-1e7, -1e7)) as N,
  obj: texture(placeholder()) as N,
  oOrigin: uniform(new THREE.Vector2(-1e7, -1e7)) as N,
  /** Farbe des Laternenlichts (linear, × Stärke) */
  lampCol: uniform(new THREE.Color(1.0, 0.56, 0.24)) as N,
  /** 1: Laternen an */
  lamps: uniform(0) as N,
};

const inside = (p: N): N => p.x.greaterThan(0.001).and(p.x.lessThan(0.999)).and(p.y.greaterThan(0.001)).and(p.y.lessThan(0.999));

/** Sonnenlicht des Geländes an der Weltlage xz (0 Schatten der Berge … 1 Sonne); vertex: im Vertex-Shader lesen */
export function terrainSun(xz: N, vertex = false): N {
  const p = xz.sub(SUNMAP.tOrigin).div(T_SIZE);
  const t = vertex ? SUNMAP.terrain.sample(p).level(0) : SUNMAP.terrain.sample(p);
  return select(inside(p), t.x, float(1));
}

/** Bodenkarte an der Weltlage: x = Schatten der Dinge (1 frei), w = Laternenlicht; vertex: im Vertex-Shader lesen */
export function groundMap(xz: N, vertex = false): N {
  const p = xz.sub(SUNMAP.oOrigin).div(O_SIZE);
  const t = vertex ? SUNMAP.obj.sample(p).level(0) : SUNMAP.obj.sample(p);
  return select(inside(p), t, vec4(1, 1, 1, 0));
}

/**
 * Licht für Dinge auf dem Boden (Blumen, Sträucher, Tiere): Sonnenlicht der Berge mal Schatten der Bäume und
 * Häuser an ihrem Fuß, je Ecke gelesen (eine Instanz liegt ganz im Licht oder ganz im Schatten)
 */
export function footSun(at: N, name: string): { vis: N; lamp: N } {
  const g = groundMap(at.xz, true);
  const v = tsl.varying(vec2(terrainSun(at.xz, true).mul(g.x), g.w), name);
  return { vis: v.x, lamp: v.y };
}

/** Fleck auf der Bodenkarte (Weltlage, Richtung entlang des Schattens, Länge, Breite, Abstand vom Fuß, Art, Dunkelheit) */
export interface Splat { x: number; z: number; len: number; wid: number; off: number; kind: number; dark: number }
/** Art der Flecken */
export const SPLAT = { tree: 0, box: 1, light: 2, contact: 3 } as const;

/** Lieferant: alle Dinge im Rechteck melden (Schatten: über shadow, Licht: über light) */
export type SplatSource = (x0: number, z0: number, x1: number, z1: number, shadow: (x: number, z: number, h: number, r: number, kind: number) => void, light: (x: number, z: number, r: number, k: number) => void) => void;

/** je Bild höchstens ein Viertel einer Karte zeichnen (vier Bilder je Karte, dann tauschen): keine Ruckler */
const SLICES = 4;

export class SunMaps {
  /** je Karte zwei Ziele: eines wird gelesen, ins andere wird stückweise gezeichnet */
  private tRTs: THREE.RenderTarget[];
  private oRTs: THREE.RenderTarget[];
  private tFront = 0;
  private oFront = 0;
  private tJob: { c: THREE.Vector2; k: number } | null = null;
  private oJob: { c: THREE.Vector2; k: number } | null = null;
  private tCam: THREE.OrthographicCamera;
  private oCam: THREE.OrthographicCamera;
  private tScene = new THREE.Scene();
  private oScene = new THREE.Scene();
  private override: THREE.MeshBasicNodeMaterial;
  private sMat: THREE.MeshBasicNodeMaterial;
  private lMat: THREE.MeshBasicNodeMaterial;
  private quad: THREE.BufferGeometry;
  private sGroup: InstGroup;
  private lGroup: InstGroup;
  private tCenter = new THREE.Vector2(NaN, NaN);
  private oCenter = new THREE.Vector2(NaN, NaN);
  private tDirty = true;
  private oDirty = true;
  private lastT = -1e9;
  private lastO = -1e9;
  /** Richtung des Schattens auf dem Boden (von der Sonne weg, waagrecht) und Steigung der Sonne */
  private sx = 0;
  private sz = 1;
  private tanE = 0.05;
  readonly sources: SplatSource[] = [];
  /** Prüfhilfe: wie oft gezeichnet */
  renders = { terrain: 0, ground: 0 };

  constructor(private renderer: THREE.WebGPURenderer, private field: () => THREE.Object3D | null) {
    const rt = (res: number, depth: boolean) => new THREE.RenderTarget(res, res, {
      type: THREE.UnsignedByteType, depthBuffer: depth, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    this.tRTs = [rt(T_RES, true), rt(T_RES, true)];
    this.oRTs = [rt(O_RES, false), rt(O_RES, false)];
    const cam = (size: number) => {
      const c = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 1, 30000);
      c.up.set(0, 0, -1);
      return c;
    };
    this.tCam = cam(T_SIZE);
    this.oCam = cam(O_SIZE);
    // Gelände von oben: nur das gebackene Sonnenlicht (aSun.x)
    const ov = new THREE.MeshBasicNodeMaterial();
    const s = attribute('aSun', 'vec2').x;
    ov.colorNode = vec3(s, s, s);
    ov.fog = false;
    this.override = ov;
    this.tScene.overrideMaterial = ov;
    // Flecken: Einheitsfläche (u längs 0 … 1, v quer −½ … ½)
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.5, 1, 0, -0.5, 1, 0, 0.5, 0, 0, 0.5], 3));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    this.quad = g;
    this.sMat = this.splatMaterial(false);
    this.lMat = this.splatMaterial(true);
    const sphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.sGroup = instGroup(g, this.sMat, 4096, sphere);
    this.lGroup = instGroup(g, this.lMat, 512, sphere);
    this.oScene.add(this.sGroup.mesh, this.lGroup.mesh);
  }

  /** Sonne setzen (Richtung zur Sonne) */
  setSun(d: THREE.Vector3) {
    const l = Math.hypot(d.x, d.z) || 1;
    this.sx = -d.x / l;
    this.sz = -d.z / l;
    this.tanE = Math.max(0.01, d.y / l);
    this.tDirty = this.oDirty = true;
  }

  /** Landschaft hat neue Kacheln (Geländelicht neu zeichnen, sobald es passt) */
  terrainChanged() { this.tDirty = true; }
  /** neue Dinge auf dem Boden (Abschnitt gebaut oder abgebaut) */
  groundChanged() { this.oDirty = true; }

  /**
   * Flecken-Material: Schatten (Minimum über alle, die Farbe trägt den Schatten, Alpha bleibt) oder Licht (Summe im
   * Alpha, die Farbe bleibt)
   */
  private splatMaterial(light: boolean): THREE.MeshBasicNodeMaterial {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
    m.blending = THREE.CustomBlending;
    if (light) {
      m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.ZeroFactor; m.blendDst = THREE.OneFactor;
      m.blendEquationAlpha = THREE.AddEquation; m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneFactor;
    } else {
      m.blendEquation = THREE.MinEquation; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor;
      m.blendEquationAlpha = THREE.AddEquation; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
    }
    m.fog = false;
    const iP = attribute('iP', 'vec4');
    const iS = attribute('iS', 'vec4');
    const iC = attribute('iC', 'vec4');
    // iP: Fuß (x, z) und Richtung (cos, sin) des Schattens; iS: Länge, Breite, Abstand vom Fuß, Art; iC.x: Dunkelheit
    const dir = vec2(iP.z, iP.w);
    const perp = vec2(dir.y.negate(), dir.x);
    const p = positionGeometry;
    const along = iS.z.add(p.x.mul(iS.x));
    const xz = vec2(iP.x, iP.y).add(dir.mul(along)).add(perp.mul(p.z.mul(iS.y)));
    m.positionNode = vec3(xz.x, 0, xz.y);
    const u = tsl.varying(p.x, 'vSu');
    const v = tsl.varying(p.z.mul(2), 'vSv');
    const kind = tsl.varying(iS.w, 'vSk');
    const dark = tsl.varying(iC.x, 'vSd');
    if (light) {
      // Lichtkegel einer Laterne: rund, zur Mitte hell
      const r = vec2(u.sub(0.5).mul(2), v).length();
      const a = float(1).sub(smoothstep(0.0, 1.0, r)).pow(1.6).mul(dark);
      m.colorNode = vec3(0, 0, 0);
      m.opacityNode = a;
    } else {
      // Baum: weiche Ellipse (Krone), längs auslaufend; Kasten: weiches Rechteck; Fuß: runder Kontaktschatten
      const ell = float(1).sub(smoothstep(0.55, 1.0, vec2(u.sub(0.5).mul(2), v).length())).mul(float(1).sub(u.mul(0.55)));
      const box = smoothstep(0.0, 0.06, u).mul(float(1).sub(smoothstep(0.75, 1.0, u)).mul(0.6).add(0.4).mul(smoothstep(1.0, 0.82, u))).mul(float(1).sub(smoothstep(0.78, 1.0, abs(v))));
      const con = float(1).sub(smoothstep(0.15, 1.0, vec2(u.sub(0.5).mul(2), v).length()));
      const a = select(kind.lessThan(0.5), ell, select(kind.lessThan(1.5), box, con));
      const sh = float(1).sub(a.mul(dark));
      m.colorNode = vec3(sh, sh, sh);
      m.opacityNode = float(1);
    }
    return m;
  }

  /** Flecken aller Lieferanten im Ausschnitt um (cx, cz) einsammeln */
  private collect(cx: number, cz: number) {
    const x0 = cx - O_SIZE / 2 - 40, x1 = cx + O_SIZE / 2 + 40, z0 = cz - O_SIZE / 2 - 40, z1 = cz + O_SIZE / 2 + 40;
    let ns = 0, nl = 0;
    const sx = this.sx, sz = this.sz;
    const tanE = this.tanE;
    const grow = (g: InstGroup, need: number, light: boolean): InstGroup => {
      if (need * STRIDE <= g.data.length) return g;
      const ng = instGroup(this.quad, light ? this.lMat : this.sMat, Math.ceil(need * 1.5), g.geo.boundingSphere!);
      ng.data.set(g.data);
      g.mesh.removeFromParent();
      g.geo.dispose();
      this.oScene.add(ng.mesh);
      if (light) this.lGroup = ng; else this.sGroup = ng;
      return ng;
    };
    const put = (D: Float32Array, n: number, x: number, z: number, dx: number, dz: number, len: number, wid: number, off: number, kind: number, dark: number) => {
      const o = n * STRIDE;
      D[o] = x; D[o + 1] = z; D[o + 2] = dx; D[o + 3] = dz;
      D[o + 4] = len; D[o + 5] = wid; D[o + 6] = off; D[o + 7] = kind;
      D[o + 8] = dark; D[o + 9] = 0; D[o + 10] = 0; D[o + 11] = 0;
    };
    // Schattenlänge: bei tiefer Sonne sehr lang – begrenzt und weich auslaufend (Streulicht am Abend)
    const shadow = (x: number, z: number, h: number, r: number, kind: number) => {
      if (x < x0 || x > x1 || z < z0 || z > z1) return;
      let g = this.sGroup;
      if (kind === SPLAT.tree) {
        // Bäume nur im inneren Teil (dort sieht man ihre Schatten; spart Flecken), ohne eigenen Fußschatten
        if (Math.abs(x - cx) > 330 || Math.abs(z - cz) > 330) return;
        // Krone: vom Stamm weg in Richtung des Schattens, so lang wie die Sonne es hergibt (begrenzt)
        const len = Math.min((h * 0.75 + r) / tanE, 34);
        g = grow(g, ns + 1, false);
        put(g.data, ns++, x, z, sx, sz, len, r * 2.2, 0, SPLAT.tree, 0.42);
      } else {
        // Kasten (Haus): Grundfläche r (halbe Breite), Schatten so lang wie die Höhe es hergibt
        const len = Math.min(h / tanE, 40) + r;
        const R = r * 1.3;
        g = grow(g, ns + 2, false);
        put(g.data, ns++, x - sx * r * 0.7, z - sz * r * 0.7, sx, sz, len, r * 2, 0, SPLAT.box, 0.5);
        put(g.data, ns++, x - R, z, 1, 0, R * 2, R * 2, 0, SPLAT.contact, 0.3);
      }
    };
    const light = (x: number, z: number, r: number, k: number) => {
      if (x < x0 || x > x1 || z < z0 || z > z1) return;
      const g = grow(this.lGroup, nl + 1, true);
      put(g.data, nl++, x - r, z, 1, 0, r * 2, r * 2, 0, SPLAT.light, k);
    };
    for (const src of this.sources) src(x0, z0, x1, z1, shadow, light);
    commit(this.sGroup, ns);
    commit(this.lGroup, nl);
  }

  /**
   * je Bild: Karten neu zeichnen, wenn nötig (Mittelpunkt focus – ein Punkt etwas vor dem Fahrer): je Bild nur ein
   * Viertel einer Karte, nach vier Bildern wird getauscht. Geländelicht nach 700 m Fahrt oder neuen Kacheln (höchstens
   * alle 5 s), Bodenkarte nach 250 m oder neuen Abschnitten (höchstens alle 1,5 s); force: alles sofort (Laden)
   */
  update(focus: THREE.Vector3, now: number, force = false) {
    const snap = (g: number) => new THREE.Vector2(Math.round(focus.x / g) * g, Math.round(focus.z / g) * g);
    if (force) {
      this.tJob = { c: snap(50), k: 0 };
      while (this.tJob) this.terrainSlice();
      this.oJob = { c: snap(25), k: 0 };
      while (this.oJob) this.groundSlice();
      return;
    }
    if (!this.tJob) {
      const far = !(Math.hypot(focus.x - this.tCenter.x, focus.z - this.tCenter.y) < T_SIZE * 0.22);
      if (far || (this.tDirty && now - this.lastT > 5000)) { this.tJob = { c: far ? snap(50) : this.tCenter.clone(), k: 0 }; this.tDirty = false; }
    }
    if (!this.oJob) {
      const far = !(Math.hypot(focus.x - this.oCenter.x, focus.z - this.oCenter.y) < O_SIZE * 0.24);
      if (far || (this.oDirty && now - this.lastO > 1500)) { this.oJob = { c: far ? snap(25) : this.oCenter.clone(), k: 0 }; this.oDirty = false; }
    }
    // je Bild ein Stück (abwechselnd, das Geländelicht zuerst)
    if (this.tJob) this.terrainSlice();
    else if (this.oJob) this.groundSlice();
  }

  /** ein Viertel einer Karte von oben zeichnen (Kamera und Bildausschnitt auf das Viertel) */
  private slice(rt: THREE.RenderTarget, cam: THREE.OrthographicCamera, size: number, c: THREE.Vector2, k: number, scene: THREE.Scene, clear: [number, number], camY: number) {
    const half = size / 2;
    const qx = k % 2, qz = Math.floor(k / 2);
    // Bild oben = −z (Kamera-„oben“ ist −z): Viertel qz = 0 liegt oben
    cam.left = -half + qx * half;
    cam.right = cam.left + half;
    cam.top = half - qz * half;
    cam.bottom = cam.top - half;
    cam.position.set(c.x, camY, c.y);
    cam.lookAt(c.x, 0, c.y);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const res = rt.width / 2;
    const gl = !(this.renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend;
    rt.viewport.set(qx * res, gl ? rt.height - res - qz * res : qz * res, res, res);
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const prevC = r.getClearColor(new THREE.Color());
    const prevA = r.getClearAlpha();
    const prevAuto = r.autoClear;
    r.setRenderTarget(rt);
    r.setClearColor(clear[0], clear[1]);
    // das erste Viertel leert das ganze Ziel (es wird gerade nicht gelesen), die übrigen zeichnen dazu
    r.autoClear = k === 0;
    r.render(scene, cam);
    r.autoClear = prevAuto;
    r.setRenderTarget(prev);
    r.setClearColor(prevC, prevA);
  }

  private terrainSlice() {
    const job = this.tJob!;
    const f = this.field();
    if (!f) { this.tJob = null; return; }
    const back = this.tRTs[1 - this.tFront];
    const parent = f.parent;
    this.tScene.add(f);
    this.slice(back, this.tCam, T_SIZE, job.c, job.k, this.tScene, [0xffffff, 1], 12000);
    parent?.add(f);
    job.k++;
    if (job.k < SLICES) return;
    this.tFront = 1 - this.tFront;
    this.tCenter.copy(job.c);
    SUNMAP.terrain.value = back.texture;
    (SUNMAP.tOrigin.value as THREE.Vector2).set(job.c.x - T_SIZE / 2, job.c.y - T_SIZE / 2);
    this.tJob = null;
    this.lastT = performance.now();
    this.renders.terrain++;
  }

  private groundSlice() {
    const job = this.oJob!;
    if (job.k === 0) this.collect(job.c.x, job.c.y);
    const back = this.oRTs[1 - this.oFront];
    this.slice(back, this.oCam, O_SIZE, job.c, job.k, this.oScene, [0xffffff, 0], 500);
    job.k++;
    if (job.k < SLICES) return;
    this.oFront = 1 - this.oFront;
    this.oCenter.copy(job.c);
    SUNMAP.obj.value = back.texture;
    (SUNMAP.oOrigin.value as THREE.Vector2).set(job.c.x - O_SIZE / 2, job.c.y - O_SIZE / 2);
    this.oJob = null;
    this.lastO = performance.now();
    this.renders.ground++;
  }

  /** Vorwärmen: beide Karten einmal zeichnen (Shader übersetzen) */
  warm(focus: THREE.Vector3) { this.update(focus, performance.now(), true); }

  dispose() {
    for (const t of [...this.tRTs, ...this.oRTs]) t.dispose();
    this.override.dispose();
    this.sMat.dispose();
    this.lMat.dispose();
    this.quad.dispose();
    this.sGroup.geo.dispose();
    this.lGroup.geo.dispose();
  }
}

/** Mischhilfe: Farbe mit Laternenlicht (Bodenkarte w) – für Böden und Straße */
export function lampLit(col: N, light: N): N {
  return col.mul(vec3(SUNMAP.lampCol).mul(light.mul(SUNMAP.lamps).mul(2.2)));
}
