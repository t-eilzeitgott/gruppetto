/**
 * Weiches Ein- und Ausblenden einzelner Objekte – auch wenn sie ihr Material mit vielen anderen teilen.
 *
 * Je Objekt ein Wert (userData.ap, siehe apIn/apOut; auch an einer Gruppe darüber). Kurz vor dem Zeichnen
 * schreibt ein Haken des Materials ihn in die Modell-Ansicht-Matrix: Element 15 ist dort sonst immer genau 1.
 * Ein etwas größerer Wert skaliert die Ansicht nur um die Kamera (um weniger als ein Zehntausendstel) – auf dem
 * Schirm verschiebt sich nichts. Der Shader liest den Wert aus und lässt ein Raster je Bildpunkt stehen.
 *
 * Zwei Stufen, die sich ablösen, teilen sich so die Bildpunkte (apIn und apOut mit demselben a ergänzen sich
 * genau): keine Halbtransparenz, keine Sortierung, kein Loch – und nichts springt.
 */
import * as THREE from 'three';

/** Kodierung im Matrixelement: 1 + EPS · Code (Code 0 = normal) */
const EPS = 4e-5;
/**
 * Fortschritt in 64 Stufen: Ein- und Ausblendendes (auch über eine Uniform, z. B. die gröbere Landschaftsstufe)
 * vergleichen so mit genau derselben Schwelle – sonst bliebe zwischen zwei knapp verschiedenen Schwellen hier und
 * da ein Bildpunkt leer
 */
const Q = 64;
export const apQ = (a: number) => Math.round(Math.max(0, Math.min(1, a)) * Q) / Q;

/** einblenden: sichtbar, wo das Raster unter a liegt (a = 1: ganz da) */
export const apIn = (a: number) => 2 - apQ(a);
/** ausblenden, Gegenstück zu apIn mit demselben a: sichtbar, wo das Raster mindestens a ist (a = 1: ganz weg) */
export const apOut = (a: number) => 2.5 + apQ(a);

/** Raster je Bildpunkt (gleichmäßig verteilte Schwellen in [0, 1)) */
export const DITHER_GLSL = 'fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))';

export const AP_HEAD = 'varying float vApC;';
/** im Vertex-Shader (braucht modelViewMatrix) */
export const AP_VERT = `vApC = (modelViewMatrix[3][3] - 1.0) * ${(1 / EPS).toFixed(1)};`;
/** im Fragment-Shader, früh */
export const AP_FRAG = `if (vApC > 0.5) {
  float apD = ${DITHER_GLSL};
  float apA = floor((vApC < 2.25 ? 2.0 - vApC : vApC - 2.5) * ${Q}.0 + 0.5) / ${Q}.0;
  if (vApC < 2.25 ? apD >= apA : apD < apA) discard;
}`;

/** Haken für Material.onBeforeRender: Wert des Objekts (oder einer Gruppe darüber) in die Matrix schreiben */
export function apHook(_r: THREE.WebGLRenderer, _s: THREE.Scene, _c: THREE.Camera, _g: THREE.BufferGeometry, object: THREE.Object3D) {
  let o: THREE.Object3D | null = object;
  for (let k = 0; k < 4 && o; k++, o = o.parent) {
    const c = o.userData.ap as number | undefined;
    if (c !== undefined) {
      object.modelViewMatrix.elements[15] = 1 + EPS * c;
      return;
    }
  }
}

const done = new WeakSet<THREE.Material>();

/**
 * Material für weiches Ein-/Ausblenden vorbereiten (einmalig; am besten vor dem ersten Zeichnen – sonst wird
 * es einmal neu übersetzt). Eigene Shader (ShaderMaterial) bauen AP_* selbst ein und setzen nur apHook.
 */
export function appearify(m: THREE.Material | THREE.Material[]) {
  if (Array.isArray(m)) { for (const x of m) appearify(x); return; }
  if (done.has(m) || (m as THREE.ShaderMaterial).isShaderMaterial) return;
  done.add(m);
  const prev = m.onBeforeCompile;
  const key = m.customProgramCacheKey();
  m.onBeforeCompile = function (sh, r) {
    prev.call(this, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${AP_HEAD}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${AP_VERT}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${AP_HEAD}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${AP_FRAG}`);
  };
  m.customProgramCacheKey = () => `${key}|ap`;
  m.onBeforeRender = apHook;
  m.needsUpdate = true;
}

/** alle Materialien unter einem Objekt vorbereiten */
export function appearifyTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m) appearify(m);
  });
}

/** Wert setzen (undefined: wieder normal) */
export function setAp(o: THREE.Object3D, code: number | undefined) {
  if (code === undefined) delete o.userData.ap;
  else o.userData.ap = code;
}
