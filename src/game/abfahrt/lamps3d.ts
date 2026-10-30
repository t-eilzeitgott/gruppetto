/**
 * Laternen am Abend (wie in der WebGPU-Abfahrt, gpu/lamps.ts und sunmap.ts): je Lampe ein kleines Bild zur Kamera
 * gedreht – heller Kern, weicher warmer Hof, addiert aufs Bild, fern etwas größer (bleibt als Lichtpunkt sichtbar),
 * mit der Entfernung schwächer. Alle Lampen eines Abschnitts in einem Zeichenaufruf (Instanzen), ein Material für
 * alle.
 *
 * Dazu der Lichtkegel auf dem Boden: Straße, Bankett, Hänge und Landschaft lesen die nächsten Lampen (Uniform-Feld,
 * je Bild neu gewählt) und bekommen darunter einen runden, zur Mitte hellen, warmen Lichtfleck. Ohne Lampe in der
 * Nähe bricht die Schleife sofort ab – das kostet dann nichts.
 */
import * as THREE from 'three';

/** so viele Lampen werfen gleichzeitig Licht auf den Boden (die nächsten zur Kamera) */
export const LAMP_N = 12;
/** Radius des Lichtflecks (m) */
const POOL_R = 8;

/** gemeinsame Uniforms: Halos (Helligkeit) und Lichtkegel (Lampen: x, y, z des Kopfs, Stärke) */
export const LAMP_U = {
  uLampK: { value: 0 },
  uLampP: { value: Array.from({ length: LAMP_N }, () => new THREE.Vector4()) },
  uLampCol: { value: new THREE.Color(1.0, 0.56, 0.24) },
};

/** GLSL: Licht der nächsten Lampen an einem Weltpunkt (Kopf 2,5 … 7 m über dem Punkt) */
export const LAMP_GLSL = /* glsl */ `
uniform vec4 uLampP[${LAMP_N}];
uniform vec3 uLampCol;
vec3 lampPool(vec3 P) {
  float s = 0.0;
  for (int i = 0; i < ${LAMP_N}; i++) {
    vec4 L = uLampP[i];
    if (L.w <= 0.0) break;
    vec2 d = P.xz - L.xz;
    float r2 = dot(d, d);
    if (r2 > ${(POOL_R * POOL_R).toFixed(1)}) continue;
    float r = sqrt(r2) / ${POOL_R.toFixed(1)};
    float dy = L.y - P.y;
    float a = pow(1.0 - smoothstep(0.0, 1.0, r), 1.6) * smoothstep(0.6, 2.4, dy) * (1.0 - smoothstep(6.5, 9.5, dy));
    s += a * L.w;
  }
  return uLampCol * s;
}`;

/** hinter #include <lights_fragment_end>: Lichtfleck auf die Grundfarbe (wie ein zusätzliches Licht) */
export const lampFrag = (pos: string) => `#include <lights_fragment_end>\n  reflectedLight.indirectDiffuse += diffuseColor.rgb * lampPool(${pos}) * 3.5;`;

let MAT: THREE.ShaderMaterial | null = null;

/** Material der Halos (eines für alle) */
export function haloMaterial(): THREE.ShaderMaterial {
  if (MAT) return MAT;
  MAT = new THREE.ShaderMaterial({
    uniforms: { uLampK: LAMP_U.uLampK },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 iP;
      uniform float uLampK;
      varying vec2 vQ;
      varying float vK;
      void main() {
        vec3 c = iP;
        vec3 toC = cameraPosition - c;
        float d = length(toC);
        vec3 f = toC / max(d, 1e-3);
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), f));
        vec3 up = cross(f, right);
        // fern etwas größer (bleibt als Lichtpunkt sichtbar), nah klein – höchstens 2,4-fach (viele große Höfe
        // übereinander, Blick die Dorfstraße entlang, kosteten die Grafik viel)
        float size = 1.6 * (1.0 + min(d, 120.0) * 0.012);
        vec3 p = c + right * (position.x * size) + up * (position.y * size) + f * 0.3;
        vQ = position.xy * 2.0;
        // mit der Entfernung schwächer (der Hof soll fern kein Fleck werden)
        vK = uLampK / (d * 0.012 + 1.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vQ;
      varying float vK;
      void main() {
        float r = length(vQ);
        float core = exp(-r * r * 60.0) * 5.0;
        float halo = exp(-r * 5.5) * 0.55;
        gl_FragColor = vec4(vec3(1.0, 0.62, 0.3) * (core + halo) * vK, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  MAT.name = 'lamp-halos';
  return MAT;
}

/** Halos aller Lampen eines Abschnitts (x, y, z je Lampe) als ein Netz */
export function lampHalos(pts: number[]): THREE.Mesh | null {
  const n = Math.floor(pts.length / 3);
  if (!n) return null;
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('iP', new THREE.InstancedBufferAttribute(new Float32Array(pts.slice(0, n * 3)), 3));
  g.instanceCount = n;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 5);
  const m = new THREE.Mesh(g, haloMaterial());
  m.renderOrder = 5;
  m.userData.noShadow = true;
  m.name = 'lamps';
  return m;
}

/** Vorwärmen: ein Netz mit einer Lampe weit unten */
export function warmLamps(): THREE.Mesh { return lampHalos([0, -500, 0])!; }

const cand: { x: number; y: number; z: number; d: number }[] = [];

/**
 * Lichtkegel: die nächsten Lampen zur Kamera ins Uniform-Feld (je Bild). lists: Lampen der Abschnitte in der Nähe
 * (x, y, z je Lampe), k: Stärke (Lichter an 0 … 1). Wer gerade aus der Auswahl fällt, ist schon ausgeblendet
 * (Abstand zur ersten nicht mehr gewählten Lampe) – nichts springt.
 */
export function pickLamps(lists: ArrayLike<number>[], cam: THREE.Vector3, k: number) {
  cand.length = 0;
  if (k > 0.001) {
    for (const l of lists) {
      for (let i = 0; i + 2 < l.length; i += 3) {
        const x = l[i], y = l[i + 1], z = l[i + 2];
        const d = Math.hypot(x - cam.x, z - cam.z);
        if (d < 140) cand.push({ x, y, z, d });
      }
    }
    cand.sort((a, b) => a.d - b.d);
  }
  const out = LAMP_U.uLampP.value;
  const dCut = cand.length > LAMP_N ? cand[LAMP_N].d : 140;
  let n = 0;
  for (let i = 0; i < Math.min(LAMP_N, cand.length); i++) {
    const c = cand[i];
    const w = k * Math.min(1, (dCut - c.d) / 15) * (1 - smooth(90, 135, c.d));
    if (w <= 0.001) continue;
    out[n++].set(c.x, c.y, c.z, w);
  }
  for (let i = n; i < LAMP_N; i++) out[i].set(0, -1e5, 0, 0);
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
