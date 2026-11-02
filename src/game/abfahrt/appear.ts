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
import { ATMO } from './grade';

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
 * Zwei Fassungen je Material: die gewöhnliche zeichnet ohne Raster, ein Zwilling mit Raster (discard) wird nur
 * gebraucht, solange ein Objekt ein- oder ausblendet (setAp tauscht dann seine Materialien). Ein Fragment-Shader,
 * der verwerfen kann, nimmt Apple-Grafikchips die Möglichkeit, verdeckte Bildpunkte gar nicht erst zu schattieren –
 * auch wenn er nie verwirft. Kostenanalyse in Moena (Version 252): 15 → 6,5 ms je Bild ohne Raster.
 */
const twinOf = new WeakMap<THREE.Material, THREE.Material>();
const baseOf = new WeakMap<THREE.Material, THREE.Material>();
const keyOf = new WeakMap<THREE.Material, string>();
/** Zwillinge in Gebrauch → zuletzt gezeichnet (Bildnummer); werden je Bild mit ihrem Original abgeglichen */
const live = new Map<THREE.Material, number>();
const synced = new WeakMap<THREE.Material, number>();
let frameNo = 0;
/** Kostenanalyse: Raster in allen Materialien (wie bis Version 252) */
let apAll = false;

/** das gewöhnliche Material (auch für einen Zwilling) */
export function apBase<T extends THREE.Material>(m: T): T {
  return (baseOf.get(m) as T | undefined) ?? m;
}

/** Zwilling, falls es schon einen gibt (Kostenanalyse: mit ausblenden) */
export function apTwinIfAny(m: THREE.Material): THREE.Material | undefined {
  return twinOf.get(m);
}

function sync(t: THREE.Material, m: THREE.Material) {
  try { t.copy(m); } catch { /* egal */ }
  if (synced.get(t) !== m.version) { synced.set(t, m.version); t.needsUpdate = true; }
}

const twinHook = function (this: THREE.Material, r: THREE.WebGLRenderer, s: THREE.Scene, c: THREE.Camera, g: THREE.BufferGeometry, object: THREE.Object3D) {
  live.set(this, frameNo);
  apHook(r, s, c, g, object);
};

/** Zwilling mit Raster (einmal angelegt, danach mit dem Original abgeglichen) */
function twin(m: THREE.Material): THREE.Material {
  let t = twinOf.get(m);
  if (!t) {
    t = m.clone();
    // (clone übernimmt keine Funktionen: Shaderbau und Schlüssel ausdrücklich)
    t.onBeforeCompile = m.onBeforeCompile;
    const k = keyOf.get(m) ?? '';
    t.customProgramCacheKey = () => `${k}|ap`;
    t.onBeforeRender = twinHook;
    baseOf.set(t, m);
    twinOf.set(m, t);
    done.add(t);
    const tt = t;
    m.addEventListener('dispose', () => { live.delete(tt); tt.dispose(); });
  }
  sync(t, m);
  live.set(t, frameNo);
  return t;
}

/** einmal je Bild (Renderer): Zwillinge in Gebrauch mit ihrem Original abgleichen (Farbe, Textur, Sichtbarkeit …) */
export function apFrame() {
  frameNo += 1;
  for (const [t, f] of live) {
    if (frameNo - f > 3) { live.delete(t); continue; }
    const b = baseOf.get(t);
    if (b) sync(t, b);
  }
}

/** blendet das Objekt (oder eine Gruppe darüber, wie apHook: bis 4 Stufen) gerade ein oder aus? */
function apActive(o: THREE.Object3D | null): boolean {
  for (let k = 0; k < 4 && o; k++, o = o.parent) if (o.userData.ap !== undefined) return true;
  return false;
}

const pick = (mm: THREE.Material, on: boolean) => {
  const b = apBase(mm);
  return on && done.has(b) ? twin(b) : b;
};

/** Materialien eines Teilbaums passend setzen: Zwilling, wo ein- oder ausgeblendet wird, sonst das gewöhnliche */
export function apRefresh(root: THREE.Object3D) {
  root.traverse((x) => {
    const mesh = x as THREE.Mesh;
    const ms = mesh.material;
    if (!ms) return;
    const on = apActive(x);
    if (Array.isArray(ms)) {
      let ch = false;
      const out = ms.map((mm) => { const w = pick(mm, on); if (w !== mm) ch = true; return w; });
      if (ch) mesh.material = out;
    } else {
      const w = pick(ms, on);
      if (w !== ms) mesh.material = w;
    }
  });
}

/**
 * Vorübersetzen (render3d warmUp): im Teilbaum kurz alle Zwillinge einsetzen – Aufruf der Rückgabe stellt wieder
 * her (null: keine Materialien mit Zwilling)
 */
export function apUseTwins(root: THREE.Object3D): (() => void) | null {
  const back: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
  root.traverse((x) => {
    const mesh = x as THREE.Mesh;
    const ms = mesh.material;
    if (!ms) return;
    const list = Array.isArray(ms) ? ms : [ms];
    if (!list.some((mm) => done.has(apBase(mm)) && !baseOf.has(mm))) return;
    back.push([mesh, ms]);
    mesh.material = Array.isArray(ms) ? ms.map((mm) => pick(mm, true)) : pick(ms, true);
  });
  if (!back.length) return null;
  return () => { for (const [mesh, ms] of back) mesh.material = ms; };
}

/** Kostenanalyse: Raster in allen Materialien (wie bis Version 252) – zum Vergleich auf dem Gerät */
export function setApAll(on: boolean, scene: THREE.Object3D) {
  if (on === apAll) return;
  apAll = on;
  scene.traverse((o) => {
    const ms = (o as THREE.Mesh).material;
    if (!ms) return;
    for (const m of Array.isArray(ms) ? ms : [ms]) if (done.has(m) && !baseOf.has(m)) m.needsUpdate = true;
  });
}

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
  keyOf.set(m, key);
  m.onBeforeCompile = function (this: THREE.Material, sh, r) {
    prev.call(this, sh, r);
    // Dunst mit Sonne (siehe grade.ts): jedes Material bekommt dieselben Uniforms
    Object.assign(sh.uniforms, ATMO);
    // Raster nur im Zwilling (oder in der Kostenanalyse überall)
    const raster = apAll || baseOf.has(this);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${AP_HEAD}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${AP_VERT}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${AP_HEAD}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${raster ? AP_FRAG : ''}`);
  };
  // (das gewöhnliche braucht keinen Haken: ohne Raster bleibt der Wert in der Matrix ungelesen)
  m.customProgramCacheKey = () => `${key}|ap${apAll ? '' : '0'}`;
  m.needsUpdate = true;
}

/** alle Materialien unter einem Objekt vorbereiten */
export function appearifyTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m) appearify(m);
  });
}

/** Wert setzen (undefined: wieder normal); beim Wechsel tauscht es die Materialien (Zwilling mit Raster) */
export function setAp(o: THREE.Object3D, code: number | undefined) {
  const was = o.userData.ap !== undefined;
  if (code === undefined) delete o.userData.ap;
  else o.userData.ap = code;
  if (was !== (code !== undefined)) apRefresh(o);
}
