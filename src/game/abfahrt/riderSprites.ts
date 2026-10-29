/**
 * Fahrer als 2D-Bilder für die Ferne (Impostors).
 *
 * Einmal (auf der Startkarte, in Häppchen) werden echte 3D-Fahrer in einen Bildvorrat gezeichnet: aus sieben
 * Blickwinkeln (hinten … Seite … vorn; die andere Seite ist gespiegelt), in acht Kurbelstellungen und drei
 * Haltungen (sitzend, geduckt, im Wiegetritt). Im Vorrat stehen keine festen Farben, sondern Anteile je Rolle
 * (Trikot, Absetzung, Helm, Hose, Haut, Schuhe, Rest in Grau) und die Normalen – eingefärbt und beleuchtet wird
 * erst beim Zeichnen, für jeden Fahrer in seinem Trikot und im Licht der Szene.
 *
 * Zwischen den Bildern wird überblendet (Blickwinkel, Kurbel, und alle drei Haltungen zugleich – ein Fahrer kann
 * halb geduckt sein und gerade aus dem Sattel gehen, ohne dass das Bild umschaltet): nichts springt. Acht
 * Kurbelstellungen liegen so dicht, dass die Beine sich bewegen statt ineinander zu verschwimmen. Ab gut 44 m
 * löst sich der 3D-Fahrer gerastert auf, während das Bild in genau den übrigen Bildpunkten erscheint
 * (appear.ts). Alle Bildfahrer zusammen kosten einen Zeichenaufruf statt rund zwanzig je Fahrer.
 *
 * Vorrat: eine Zeile je Blickwinkel und Haltung (7 × 3), in der Zeile die Kurbelstellungen – so bleibt er
 * schmal (512 px breit), egal wie viele Kurbelstellungen es sind.
 */
import * as THREE from 'three';
import type { Kit } from './rider';
import { RiderModel } from './rider3d';
import { DITHER_GLSL, apQ } from './appear';
import { ATMO } from './grade';
import type { TreeLightU } from './forest3d';
import { lin } from './models3d';

/** Blickwinkel 0°, 30°, … 180° (0 = von hinten) */
const NA = 7;
/** Kurbelstellungen je Umdrehung */
const NF = 8;
/** Haltungen: sitzend, geduckt, Wiegetritt */
const NP = 3;
/** Vorrat: Spalte = Kurbelstellung, Zeile = Blickwinkel · NP + Haltung */
const COLS = NF;
const ROWS = NA * NP;
/** Zellgröße im fertigen Vorrat (px); gezeichnet wird doppelt so fein und dann gemittelt */
const CPX = 64;
const SS = 2;
/** Blick leicht von oben (wie die Kamera auf die Fahrer vor ihr schaut) */
const ELEV = 0.12;
/** ab hier Bild statt 3D (Abstand zur Kamera, m): dazwischen weich überblendet – weit genug, dass man den Wechsel
 * im Fahren kaum sieht (die 64-px-Bilder sind erst ab ~45 m so klein wie die 3D-Fahrer) */
export const SPRITE_NEAR = 44;
export const SPRITE_FAR = 54;
/** höchstens so viele Bildfahrer */
const MAX = 64;
const STRIDE = 32;

const ROLE_KITS: Record<'F' | 'A' | 'B', Kit> = {
  F: { jersey: '#000000', side: '#000000', helmet: '#000000', shorts: '#000000', skin: '#000000', shoes: '#000000', number: '' },
  A: { jersey: '#ff0000', side: '#00ff00', helmet: '#0000ff', shorts: '#000000', skin: '#000000', shoes: '#000000', number: '' },
  B: { jersey: '#000000', side: '#000000', helmet: '#000000', shorts: '#ff0000', skin: '#00ff00', shoes: '#0000ff', number: '' },
};

/** Fahrer, den diese Bilder darstellen können (Teamrad in Trikotfarben) */
export function spriteable(kit: Kit): boolean {
  return !kit.bike;
}

// (die Fahrer sind Skinning-Netze – ihre Knochen gelten auch hier)
const NORMAL_BAKE = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  blending: THREE.NoBlending,
  vertexShader: /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
varying vec3 vN;
void main() {
  vec3 objectNormal = vec3(normal);
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  vN = normalize(normalMatrix * objectNormal);
  vec3 transformed = vec3(position);
  #include <skinning_vertex>
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}`,
  fragmentShader: /* glsl */ `
varying vec3 vN;
void main() {
  vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}`,
});

/** Vorrat zusammenfassen: 2×2 mitteln, Rollen = Farbbild minus Bild ohne Rollen */
const COMBINE = new THREE.ShaderMaterial({
  uniforms: { uN: { value: null }, uF: { value: null }, uA: { value: null }, uB: { value: null }, uOut: { value: 0 }, uRow: { value: 0 } },
  depthTest: false,
  depthWrite: false,
  blending: THREE.NoBlending,
  vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */ `
precision highp float;
uniform sampler2D uN;
uniform sampler2D uF;
uniform sampler2D uA;
uniform sampler2D uB;
uniform int uOut;
uniform int uRow;
vec4 avg(sampler2D t, ivec2 p) {
  return (texelFetch(t, p, 0) + texelFetch(t, p + ivec2(1, 0), 0) + texelFetch(t, p + ivec2(0, 1), 0) + texelFetch(t, p + ivec2(1, 1), 0)) * 0.25;
}
void main() {
  ivec2 p = (ivec2(gl_FragCoord.xy) - ivec2(0, uRow)) * 2;
  vec4 F = avg(uF, p);
  if (uOut == 0) { vec4 A = avg(uA, p); gl_FragColor = vec4(clamp(A.rgb - F.rgb, 0.0, 1.0), F.a); }
  else if (uOut == 1) { vec4 B = avg(uB, p); gl_FragColor = vec4(clamp(B.rgb - F.rgb, 0.0, 1.0), dot(F.rgb, vec3(0.2126, 0.7152, 0.0722))); }
  else gl_FragColor = vec4(avg(uN, p).rgb, 1.0);
}`,
});

interface Bake {
  models: Record<'F' | 'A' | 'B', RiderModel>;
  scenes: Record<'F' | 'A' | 'B', THREE.Scene>;
  /** Zeichenflächen für eine Zeile (doppelt fein): Normalen, ohne Rollen, Rollen A, Rollen B */
  src: THREE.WebGLRenderTarget[];
  cam: THREE.OrthographicCamera;
  mats: THREE.Material[];
  next: number;
  half: number;
  v0: number;
  quad: THREE.Scene;
  qcam: THREE.OrthographicCamera;
}

export class RiderSprites {
  /** fertig gezeichnet: Bilder können die Ferne übernehmen */
  ready = false;
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private data = new Float32Array(MAX * STRIDE);
  private buf: THREE.InstancedInterleavedBuffer;
  private mat: THREE.ShaderMaterial;
  private out: THREE.WebGLRenderTarget[] = [];
  private bake: Bake | null = null;
  private n = 0;
  private colors = new Map<string, Float32Array>();

  constructor(light: TreeLightU, msaa: boolean) {
    const q = new THREE.BufferGeometry();
    q.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    q.setIndex([0, 1, 2, 0, 2, 3]);
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(q.index);
    g.setAttribute('position', q.getAttribute('position'));
    this.buf = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    const names = ['iP', 'iA', 'iF', 'iC0', 'iC1', 'iC2', 'iC3', 'iC4'];
    names.forEach((nm, k) => g.setAttribute(nm, new THREE.InterleavedBufferAttribute(this.buf, 4, k * 4)));
    g.instanceCount = 0;
    this.geo = g;
    this.mat = spriteMaterial(light, msaa);
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }

  /**
   * Vorrat weiterzeichnen, bis die Zeit um ist (performance.now()-Grenze). Liefert true, sobald alles fertig ist.
   * Beim ersten Aufruf entstehen die drei Musterfahrer (Rollen-Trikots) und die Zeichenflächen.
   */
  bakeStep(gl: THREE.WebGLRenderer, deadline: number): boolean {
    if (this.ready) return true;
    const b = (this.bake ??= this.startBake());
    const prevRT = gl.getRenderTarget();
    const prevC = gl.getClearColor(new THREE.Color());
    const prevA = gl.getClearAlpha();
    const prevAuto = gl.autoClear;
    gl.setClearColor(0x000000, 0);
    gl.autoClear = false;
    const total = NA * NF * NP;
    while (b.next < total && (b.next === 0 || performance.now() < deadline)) {
      this.bakeCell(gl, b, b.next);
      b.next++;
      if (b.next % COLS === 0) this.combineRow(gl, b, b.next / COLS - 1);
    }
    let done = false;
    if (b.next >= total) {
      this.finish(gl, b);
      done = true;
    }
    gl.autoClear = prevAuto;
    gl.setClearColor(prevC, prevA);
    gl.setRenderTarget(prevRT);
    return done;
  }

  private startBake(): Bake {
    const shadow = new THREE.Texture();
    const models = { F: new RiderModel(ROLE_KITS.F, shadow), A: new RiderModel(ROLE_KITS.A, shadow), B: new RiderModel(ROLE_KITS.B, shadow) };
    // Farben ohne Licht: dieselben Farben/Texturen, aber unbeleuchtet (lineare Werte im Ziel)
    const basic = new Map<THREE.Material, THREE.Material>();
    const mats: THREE.Material[] = [];
    for (const m of Object.values(models)) {
      m.prepareBake();
      m.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || Array.isArray(mesh.material)) return;
        const src = mesh.material as THREE.MeshLambertMaterial;
        let bm = basic.get(src);
        if (!bm) {
          bm = new THREE.MeshBasicMaterial({ color: src.color ?? 0xffffff, map: src.map ?? null, vertexColors: src.vertexColors, side: THREE.DoubleSide, alphaTest: src.alphaTest });
          basic.set(src, bm);
          mats.push(bm);
        }
        mesh.material = bm;
        mesh.frustumCulled = false;
      });
    }
    const scenes = { F: new THREE.Scene(), A: new THREE.Scene(), B: new THREE.Scene() };
    for (const k of ['F', 'A', 'B'] as const) scenes[k].add(models[k].group);
    // Ausdehnung (alle Haltungen): Zelle quadratisch um den Fahrer, Boden knapp über dem Zellboden
    let half = 0.9;
    let top = 1.6;
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    for (let pi = 0; pi < NP; pi++) {
      for (let fi = 0; fi < NF; fi++) {
        this.posePose(models.F, fi, pi);
        models.F.group.updateMatrixWorld(true);
        box.makeEmpty();
        // nur Sichtbares (der Schatten ist ausgeblendet)
        models.F.group.traverseVisible((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const g = mesh.geometry;
          if (!g.boundingBox) g.computeBoundingBox();
          box.union(tmp.copy(g.boundingBox!).applyMatrix4(mesh.matrixWorld));
        });
        half = Math.max(half, -box.min.x, box.max.x, -box.min.z, box.max.z);
        top = Math.max(top, box.max.y);
      }
    }
    half = Math.max(half + 0.08, (top + 0.15) / 2);
    const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 50);
    // Mitte der Zelle in Fahrerhöhe; Boden (y = 0) liegt im Bild bei v0
    const cy = half - 0.12;
    cam.userData.cy = cy;
    const W = COLS * CPX * SS;
    const H = CPX * SS;
    const src = [0, 1, 2, 3].map(() => {
      const r = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      r.texture.colorSpace = THREE.NoColorSpace;
      r.scissorTest = true;
      return r;
    });
    // wo der Boden unter dem Fahrer im Bild liegt (für alle Blickwinkel gleich: Mitte über dem Ursprung)
    this.placeCam(cam, 0, cy);
    const o = new THREE.Vector3(0, 0, 0).project(cam);
    const v0 = (o.y + 1) / 2;
    // fertiger Vorrat (mit Mipmaps); jede fertige Zeile wird gleich hineingerechnet
    for (let k = 0; k < 3; k++) {
      const rt = new THREE.WebGLRenderTarget(COLS * CPX, ROWS * CPX, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
      rt.texture.colorSpace = THREE.NoColorSpace;
      rt.scissorTest = true;
      this.out.push(rt);
    }
    const quad = new THREE.Scene();
    const qm = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), COMBINE);
    qm.frustumCulled = false;
    quad.add(qm);
    const qcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    return { models, scenes, src, cam, mats, next: 0, half, v0, quad, qcam };
  }

  private placeCam(cam: THREE.OrthographicCamera, ai: number, cy: number) {
    const th = (ai * Math.PI) / (NA - 1);
    const D = 20;
    cam.position.set(Math.sin(th) * Math.cos(ELEV) * D, cy + Math.sin(ELEV) * D, Math.cos(th) * Math.cos(ELEV) * D);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, cy, 0);
    cam.updateMatrixWorld(true);
  }

  private posePose(m: RiderModel, fi: number, pi: number) {
    m.pose({ lean: 0, pedal: (fi * Math.PI * 2) / NF, tuck: pi === 1 ? 1 : 0, brake: 0, light: 0, stand: pi === 2 ? 1 : 0, sprint: pi === 2 ? 1 : 0 });
  }

  private bakeCell(gl: THREE.WebGLRenderer, b: Bake, c: number) {
    // Zelle: Zeile = Blickwinkel · NP + Haltung, Spalte = Kurbelstellung (die Zeichenfläche hält eine Zeile)
    const row = Math.floor(c / NF);
    const fi = c % NF;
    const ai = Math.floor(row / NP);
    const pi = row % NP;
    for (const k of ['F', 'A', 'B'] as const) this.posePose(b.models[k], fi, pi);
    this.placeCam(b.cam, ai, b.cam.userData.cy as number);
    const px = CPX * SS;
    const x = fi * px;
    const y = 0;
    const passes: [THREE.Scene, number, boolean][] = [[b.scenes.F, 0, true], [b.scenes.F, 1, false], [b.scenes.A, 2, false], [b.scenes.B, 3, false]];
    for (const [scene, ti, normal] of passes) {
      const rt = b.src[ti];
      rt.viewport.set(x, y, px, px);
      rt.scissor.set(x, y, px, px);
      gl.setRenderTarget(rt);
      gl.clear(true, true, false);
      scene.overrideMaterial = normal ? NORMAL_BAKE : null;
      gl.render(scene, b.cam);
      scene.overrideMaterial = null;
    }
  }

  /** fertige Zeile (ein Blickwinkel, eine Haltung) in den Vorrat rechnen: 2×2 mitteln, Rollen trennen */
  private combineRow(gl: THREE.WebGLRenderer, b: Bake, row: number) {
    const u = COMBINE.uniforms;
    u.uN.value = b.src[0].texture;
    u.uF.value = b.src[1].texture;
    u.uA.value = b.src[2].texture;
    u.uB.value = b.src[3].texture;
    u.uRow.value = row * CPX;
    for (let k = 0; k < 3; k++) {
      const rt = this.out[k];
      rt.viewport.set(0, row * CPX, COLS * CPX, CPX);
      rt.scissor.set(0, row * CPX, COLS * CPX, CPX);
      u.uOut.value = k;
      gl.setRenderTarget(rt);
      gl.render(b.quad, b.qcam);
    }
  }

  private finish(gl: THREE.WebGLRenderer, b: Bake) {
    void gl;
    (b.quad.children[0] as THREE.Mesh).geometry.dispose();
    for (const r of b.src) r.dispose();
    for (const m of b.mats) m.dispose();
    this.bake = null;
    const u = this.mat.uniforms;
    u.uT1.value = this.out[0].texture;
    u.uT2.value = this.out[1].texture;
    u.uT3.value = this.out[2].texture;
    // Zelle in Metern (Breite = Höhe) und Lage des Bodens im Bild
    u.uCell.value.set(b.half * 2, b.v0, 0, 0);
    this.ready = true;
  }

  /** neues Bild: Liste leeren */
  begin() { this.n = 0; }

  /**
   * Fahrer als Bild zeigen: Ort, Richtung (rotation.y des 3D-Fahrers), Haltung, Einblendung a (0 … 1: sichtbar
   * in genau den Bildpunkten, die der 3D-Fahrer mit apOut(a) freigibt)
   */
  add(x: number, y: number, z: number, ry: number, lean: number, pedal: number, tuck: number, stand: number, a: number, kit: Kit) {
    if (this.n >= MAX) return;
    const d = this.data;
    const o = this.n * STRIDE;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = ry;
    d[o + 4] = lean; d[o + 5] = pedal; d[o + 6] = tuck; d[o + 7] = stand;
    d[o + 8] = apQ(a); d[o + 9] = 0; d[o + 10] = 0; d[o + 11] = 0;
    d.set(this.colorsOf(kit), o + 12);
    this.n++;
  }

  /** Liste fertig: hochladen */
  end() {
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n) {
      this.buf.clearUpdateRanges();
      this.buf.addUpdateRange(0, this.n * STRIDE);
      this.buf.needsUpdate = true;
    }
  }

  private colorsOf(kit: Kit): Float32Array {
    const key = `${kit.jersey}|${kit.side}|${kit.helmet}|${kit.shorts}|${kit.skin}|${kit.shoes}`;
    let c = this.colors.get(key);
    if (!c) {
      const j = lin(kit.jersey), s = lin(kit.side), h = lin(kit.helmet), sh = lin(kit.shorts), sk = lin(kit.skin), so = lin(kit.shoes);
      c = new Float32Array([j[0], j[1], j[2], sk[0], s[0], s[1], s[2], sk[1], h[0], h[1], h[2], sk[2], sh[0], sh[1], sh[2], 0, so[0], so[1], so[2], 0]);
      this.colors.set(key, c);
    }
    return c;
  }

  dispose() {
    for (const r of this.out) r.dispose();
    this.out = [];
    this.geo.dispose();
    this.mat.dispose();
  }
}

function spriteMaterial(light: TreeLightU, msaa: boolean): THREE.ShaderMaterial {
  const PI = Math.PI.toFixed(6);
  const m = new THREE.ShaderMaterial({
    fog: true,
    defines: msaa ? { RS_A2C: '' } : {},
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uT1: { value: null }, uT2: { value: null }, uT3: { value: null }, uCell: { value: new THREE.Vector4(2, 0.1, 0, 0) },
      uSunDir: { value: new THREE.Vector3() }, uSunC: { value: new THREE.Color() }, uSkyC: { value: new THREE.Color() }, uGroundC: { value: new THREE.Color() },
      uFillDir: { value: new THREE.Vector3() }, uFillC: { value: new THREE.Color() },
    }]),
    vertexShader: /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 iP;  // Ort, Richtung (rotation.y)
attribute vec4 iA;  // Schräglage, Kurbel, geduckt, Wiegetritt
attribute vec4 iF;  // Einblendung
attribute vec4 iC0; // Trikot, Haut r
attribute vec4 iC1; // Absetzung, Haut g
attribute vec4 iC2; // Helm, Haut b
attribute vec4 iC3; // Hose
attribute vec4 iC4; // Schuhe
uniform vec4 uCell;
varying vec2 vUv;
varying vec4 vSel;  // Blickwinkel a0, a1, Kurbel f0, f1
varying vec4 vW;    // Gewichte: Blickwinkel, Kurbel, geduckt, Wiegetritt (sitzend = Rest)
varying float vFade;
varying vec3 vR;
varying vec3 vU;
varying vec3 vN;
varying vec3 vJ;
varying vec3 vS;
varying vec3 vH;
varying vec3 vSh;
varying vec3 vSk;
varying vec3 vSo;
void main() {
  vec3 P = iP.xyz;
  vec3 toC = cameraPosition - P;
  float d = max(length(toC.xz), 0.01);
  vec2 dC = toC.xz / d;
  // Blickwinkel im Fahrer: 0 = von hinten; die zweite Hälfte ist gespiegelt (Kurbel eine halbe Umdrehung weiter)
  float th = mod(atan(dC.x, dC.y) - iP.w, 2.0 * ${PI});
  float mir = th > ${PI} ? -1.0 : 1.0;
  float tl = th > ${PI} ? 2.0 * ${PI} - th : th;
  float af = tl / (${PI} / ${(NA - 1).toFixed(1)});
  float a0 = min(floor(af), ${(NA - 1).toFixed(1)});
  float a1 = min(a0 + 1.0, ${(NA - 1).toFixed(1)});
  float ped = iA.y + (mir < 0.0 ? ${PI} : 0.0);
  float pf = mod(ped / (2.0 * ${PI}) * ${NF.toFixed(1)}, ${NF.toFixed(1)});
  float f0 = floor(pf);
  float f1 = mod(f0 + 1.0, ${NF.toFixed(1)});
  float st = clamp(iA.w, 0.0, 1.0);
  float tk = clamp(iA.z, 0.0, 1.0);
  // alle drei Haltungen zugleich: aus dem Sattel löst den Rest ab, der sitzend/geduckt mischt
  vSel = vec4(a0, a1, f0, f1);
  vW = vec4(af - a0, pf - f0, tk * (1.0 - st), st);
  vFade = iF.x;
  // zur Kamera gedreht, von oben gesehen etwas zurückgekippt
  vec3 F = vec3(dC.x, 0.0, dC.y);
  vec3 R = vec3(dC.y, 0.0, -dC.x);
  float el = atan(cameraPosition.y - P.y - 0.9, d);
  float tlt = clamp(el - ${ELEV.toFixed(3)}, -0.1, 0.7) * 0.6;
  vec3 U = vec3(0.0, cos(tlt), 0.0) - F * sin(tlt);
  vec3 N = F * cos(tlt) + vec3(0.0, sin(tlt), 0.0);
  // Schräglage: von hinten/vorn als Drehung im Bild, von der Seite nicht sichtbar
  float roll = -iA.x * cos(tl);
  float W = uCell.x;
  vec2 c = vec2(position.x * W, (position.y - uCell.y) * W);
  float cr = cos(roll), sr = sin(roll);
  c = vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr);
  vec3 wp = P + R * c.x + U * c.y;
  vUv = vec2(0.5 + position.x * mir, position.y);
  vR = R * mir;
  vU = U;
  vN = N;
  vJ = iC0.rgb; vS = iC1.rgb; vH = iC2.rgb; vSh = iC3.rgb; vSo = iC4.rgb;
  vSk = vec3(iC0.w, iC1.w, iC2.w);
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uT1;
uniform sampler2D uT2;
uniform sampler2D uT3;
uniform vec3 uSunDir;
uniform vec3 uSunC;
uniform vec3 uSkyC;
uniform vec3 uGroundC;
uniform vec3 uFillDir;
uniform vec3 uFillC;
varying vec2 vUv;
varying vec4 vSel;
varying vec4 vW;
varying float vFade;
varying vec3 vR;
varying vec3 vU;
varying vec3 vN;
varying vec3 vJ;
varying vec3 vS;
varying vec3 vH;
varying vec3 vSh;
varying vec3 vSk;
varying vec3 vSo;
vec4 t1; vec4 t2; vec4 t3;
void acc(float a, float f, float p, float w) {
  vec2 uv = (vec2(f, a * ${NP.toFixed(1)} + p) + vUv) / vec2(${COLS.toFixed(1)}, ${ROWS.toFixed(1)});
  t1 += texture2D(uT1, uv) * w;
  t2 += texture2D(uT2, uv) * w;
  t3 += texture2D(uT3, uv) * w;
}
void main() {
  // Überblendung mit dem 3D-Fahrer: genau die Bildpunkte, die er freigibt
  float dth = ${DITHER_GLSL};
  if (dth >= vFade) discard;
  t1 = vec4(0.0); t2 = vec4(0.0); t3 = vec4(0.0);
  float wa = vW.x, wf = vW.y, wT = vW.z, wS = vW.w;
  float wN = 1.0 - wT - wS;
  for (int i = 0; i < 2; i++) {
    float a = i == 0 ? vSel.x : vSel.y;
    float ka = i == 0 ? 1.0 - wa : wa;
    if (ka <= 0.0) continue;
    if (wN > 0.0) { acc(a, vSel.z, 0.0, ka * (1.0 - wf) * wN); acc(a, vSel.w, 0.0, ka * wf * wN); }
    if (wT > 0.0) { acc(a, vSel.z, 1.0, ka * (1.0 - wf) * wT); acc(a, vSel.w, 1.0, ka * wf * wT); }
    if (wS > 0.0) { acc(a, vSel.z, 2.0, ka * (1.0 - wf) * wS); acc(a, vSel.w, 2.0, ka * wf * wS); }
  }
  float cov = t1.a;
  // Ränder scharf; dünne Teile (Felgen, Rohre) mit ihrer Deckung statt weggeschnitten
  float aS = max((cov - 0.5) / max(fwidth(cov), 1e-4) + 0.5, cov * 1.6 - 0.1);
  if (aS <= 0.02) discard;
  float ic = 1.0 / max(cov, 0.004);
  vec3 alb = (t1.r * vJ + t1.g * vS + t1.b * vH + t2.r * vSh + t2.g * vSk + t2.b * vSo + vec3(t2.a)) * ic;
  vec3 nn = t3.rgb * ic * 2.0 - 1.0;
  vec3 n = normalize(vR * nn.x + vU * nn.y + vN * nn.z);
  vec3 li = mix(uGroundC, uSkyC, 0.5 + 0.5 * n.y) + uSunC * max(dot(n, uSunDir), 0.0) + uFillC * max(dot(n, uFillDir), 0.0);
#ifdef RS_A2C
  gl_FragColor = vec4(alb * li, clamp(aS, 0.0, 1.0));
#else
  if (aS < 0.5) discard;
  gl_FragColor = vec4(alb * li, 1.0);
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  });
  m.alphaToCoverage = msaa;
  for (const k of ['uSunDir', 'uSunC', 'uSkyC', 'uGroundC', 'uFillDir', 'uFillC'] as const) m.uniforms[k] = light[k];
  Object.assign(m.uniforms, ATMO);
  return m;
}
