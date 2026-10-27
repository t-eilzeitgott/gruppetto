/**
 * Glanz für Räder und Helme: ein gemeinsames Phong-Material, dessen Glanz je Ecke im Modell steckt
 * (Attribut „gloss“: 0 matt · 0,5 Lack · 1 Chrom). Lack spiegelt nur am Rand (Fresnel), Metall
 * spiegelt überall und färbt die Spiegelung (Gold bleibt gold). Gespiegelt wird ein kleiner Himmel,
 * der abends mit dem Licht dunkler wird (setGlossEnv) – so glänzt nachts nichts unnatürlich.
 *
 * Dazu der Baukasten für indizierte Teile mit Vertexfarben, die zu einer Geometrie verschmolzen werden.
 */
import * as THREE from 'three';

export type C3 = [number, number, number];

const tmpC = new THREE.Color();
/** Hex-Farbe als lineares RGB */
export function rgb(hex: string): C3 {
  tmpC.set(hex);
  return [tmpC.r, tmpC.g, tmpC.b];
}

/** Glanzstufen */
export const MATTE = 0.03;
export const SATIN = 0.22;
export const PAINT = 0.5;
export const CHROME = 0.95;

/** indizierte Teil-Geometrie mit Vertexfarben und einem Glanzwert; Naht-Paare bekommen gemittelte Normalen */
export class Mesher {
  pos: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  /** eigener Glanz je Ecke (sonst gilt gloss) */
  gl: number[] | null = null;
  seams: [number, number][] = [];
  /** fest vorgegebene Normalen (z. B. exakt aus der Flächenformel) */
  fixed = new Map<number, [number, number, number]>();
  constructor(readonly gloss: number) {}
  get empty() { return this.idx.length === 0; }
  get count() { return this.pos.length / 3; }
  v(x: number, y: number, z: number, c: C3, g?: number): number {
    this.pos.push(x, y, z);
    this.col.push(c[0], c[1], c[2]);
    if (g !== undefined || this.gl) {
      if (!this.gl) this.gl = new Array(this.pos.length / 3 - 1).fill(this.gloss);
      this.gl.push(g ?? this.gloss);
    }
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number) { this.idx.push(a, b, c); }
  /** Viereck a-b-c-d gegen den Uhrzeigersinn von außen gesehen */
  quad(a: number, b: number, c: number, d: number) { this.idx.push(a, b, c, a, c, d); }
  /** fertige Three-Geometrie mit Transformation einfügen */
  add(g: THREE.BufferGeometry, m: THREE.Matrix4, c: C3, gl?: number) {
    const p = g.getAttribute('position');
    const base = this.count;
    const t = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      t.fromBufferAttribute(p, i).applyMatrix4(m);
      this.v(t.x, t.y, t.z, c, gl);
    }
    // gespiegelte Matrix (negative Skalierung): Drehsinn umkehren
    const flip = m.determinant() < 0;
    if (g.index) {
      for (let i = 0; i < g.index.count; i += 3) {
        const a = base + g.index.getX(i);
        const b = base + g.index.getX(i + 1);
        const cc = base + g.index.getX(i + 2);
        if (flip) this.idx.push(a, cc, b); else this.idx.push(a, b, cc);
      }
    } else {
      for (let i = 0; i < p.count; i += 3) {
        if (flip) this.idx.push(base + i, base + i + 2, base + i + 1); else this.idx.push(base + i, base + i + 1, base + i + 2);
      }
    }
    g.dispose();
  }
  /** glatte Normalen (flächengewichtet), Nähte gemittelt */
  normals(): Float32Array {
    const n = new Float32Array(this.pos.length);
    const P = this.pos;
    const I = this.idx;
    for (let i = 0; i < I.length; i += 3) {
      const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
    }
    for (const [i, j] of this.seams) {
      const a = i * 3, b = j * 3;
      const x = n[a] + n[b], y = n[a + 1] + n[b + 1], z = n[a + 2] + n[b + 2];
      n[a] = n[b] = x; n[a + 1] = n[b + 1] = y; n[a + 2] = n[b + 2] = z;
    }
    for (const [i, v] of this.fixed) { n[i * 3] = v[0]; n[i * 3 + 1] = v[1]; n[i * 3 + 2] = v[2]; }
    for (let k = 0; k < n.length; k += 3) {
      const l = Math.hypot(n[k], n[k + 1], n[k + 2]) || 1;
      n[k] /= l; n[k + 1] /= l; n[k + 2] /= l;
    }
    return n;
  }
}

/** mehrere Baukästen zu einer Geometrie (position, normal, color, gloss); leer → null */
export function merge(list: Mesher[]): THREE.BufferGeometry | null {
  const parts = list.filter((m) => !m.empty);
  if (!parts.length) return null;
  let nv = 0;
  let ni = 0;
  for (const m of parts) { nv += m.count; ni += m.idx.length; }
  const pos = new Float32Array(nv * 3);
  const nrm = new Float32Array(nv * 3);
  const col = new Float32Array(nv * 3);
  const gl = new Float32Array(nv);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let ov = 0;
  let oi = 0;
  for (const m of parts) {
    pos.set(m.pos, ov * 3);
    nrm.set(m.normals(), ov * 3);
    col.set(m.col, ov * 3);
    if (m.gl) gl.set(m.gl, ov); else gl.fill(m.gloss, ov, ov + m.count);
    for (let i = 0; i < m.idx.length; i++) idx[oi + i] = m.idx[i] + ov;
    ov += m.count;
    oi += m.idx.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('gloss', new THREE.BufferAttribute(gl, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------ Umgebung und Material

let env: THREE.Texture | null = null;
/** kleine Umgebung für Spiegelungen: Himmel, heller Horizont, dunkler Boden, ein paar helle Flecken */
function envMap(): THREE.Texture {
  if (env) return env;
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 128;
  const c = cv.getContext('2d')!;
  const g = c.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#7fb2e6');
  g.addColorStop(0.3, '#c4dcf2');
  g.addColorStop(0.47, '#f6f8fb');
  g.addColorStop(0.5, '#b9bcbf');
  g.addColorStop(0.54, '#5b5953');
  g.addColorStop(1, '#262523');
  c.fillStyle = g;
  c.fillRect(0, 0, 256, 128);
  // Wolken und Fenster: helle Flecken, die über den Lack wandern
  c.fillStyle = 'rgba(255,255,255,0.85)';
  for (const [x, y, w, h] of [[20, 18, 46, 10], [150, 26, 60, 8], [96, 40, 30, 6], [210, 12, 30, 7]]) c.fillRect(x, y, w, h);
  // Häuserkante am Horizont
  c.fillStyle = 'rgba(40,38,36,0.55)';
  for (let x = 0; x < 256; x += 16) c.fillRect(x, 56 - ((x * 7) % 9), 12, 9 + ((x * 7) % 9));
  const t = new THREE.CanvasTexture(cv);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  env = t;
  return t;
}

const envLevel = { value: 1 };
/** Helligkeit der Spiegelungen (1 = Tag, abends weniger) */
export function setGlossEnv(v: number) { envLevel.value = v; }

const ENV_CODE = `
  vec4 envColor = textureCube( envMap, envMapRotation * reflectVec );
  float ndv = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
  float fres = pow( 1.0 - ndv, 5.0 );
  float envAmt = mix( gDiel * ( 0.03 + 0.62 * fres ), 0.55 + 0.4 * fres, gMetal );
  vec3 envTint = mix( vec3( 1.0 ), min( diffuseColor.rgb * 1.35, vec3( 1.0 ) ), gMetal );
  outgoingLight = mix( outgoingLight, envColor.xyz * uEnv * envTint, envAmt );
#endif`;

/** Phong mit Glanz je Ecke (Attribut gloss); Klone behalten das Verhalten */
export class GlossMaterial extends THREE.MeshPhongMaterial {
  constructor() {
    super({ vertexColors: true, shininess: 64, specular: new THREE.Color(0.42, 0.42, 0.42), envMap: envMap(), reflectivity: 1, combine: THREE.MixOperation });
  }
  override onBeforeCompile(sh: THREE.WebGLProgramParametersWithUniforms) {
    sh.uniforms.uEnv = envLevel;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float gloss;\nvarying float vGloss;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGloss = gloss;');
    const chunk = THREE.ShaderChunk.envmap_fragment;
    const cut = chunk.indexOf('#ifdef ENVMAP_TYPE_CUBE');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGloss;\nuniform float uEnv;')
      .replace('#include <specularmap_fragment>', 'float gMetal = clamp( vGloss * 2.0 - 1.0, 0.0, 1.0 );\n\tfloat gDiel = clamp( vGloss * 2.0, 0.0, 1.0 );\n\tfloat specularStrength = gDiel * 0.8 + gMetal * 1.6;')
      .replace('#include <envmap_fragment>', cut > 0 ? chunk.slice(0, cut) + ENV_CODE : chunk);
  }
  override customProgramCacheKey() { return 'gloss-v1'; }
}

let shared: GlossMaterial | null = null;
/** das gemeinsame Material (alle Räder und Köpfe) */
export function glossMat(): GlossMaterial {
  return (shared ??= new GlossMaterial());
}

/**
 * Kleine Teile (Schuhe, Kurbel, Speichen, Schriftzüge) verschwinden in der Ferne nicht auf einmal, sondern
 * lösen sich zwischen FAR0 und FAR1 m Abstand (des Teils zur Kamera) gerastert auf. Dahinter werden sie
 * gar nicht mehr gezeichnet (RiderModel.setFar).
 */
export const FAR0 = 17;
export const FAR1 = 25;
export function farFade(sh: THREE.WebGLProgramParametersWithUniforms) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying float vFarK;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
\tvFarK = 1.0 - smoothstep( ${FAR0.toFixed(1)}, ${FAR1.toFixed(1)}, distance( modelMatrix[ 3 ].xyz, cameraPosition ) );`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vFarK;')
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
\tif ( fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) >= vFarK ) discard;`);
}

/** Glanz-Material der kleinen Teile (mit Auflösen in der Ferne) */
export class GlossFarMaterial extends GlossMaterial {
  override onBeforeCompile(sh: THREE.WebGLProgramParametersWithUniforms) {
    super.onBeforeCompile(sh);
    farFade(sh);
  }
  override customProgramCacheKey() { return 'gloss-far-v1'; }
}
let sharedFar: GlossFarMaterial | null = null;
export function glossFarMat(): GlossFarMaterial {
  return (sharedFar ??= new GlossFarMaterial());
}

/** Phong (Schriftzüge) mit Auflösen in der Ferne */
export class PhongFarMaterial extends THREE.MeshPhongMaterial {
  override onBeforeCompile(sh: THREE.WebGLProgramParametersWithUniforms) { farFade(sh); }
  override customProgramCacheKey() { return 'phong-far-v1'; }
}
/** Lambert (Speichen-Schleier) mit Auflösen in der Ferne */
export class LambertFarMaterial extends THREE.MeshLambertMaterial {
  override onBeforeCompile(sh: THREE.WebGLProgramParametersWithUniforms) { farFade(sh); }
  override customProgramCacheKey() { return 'lambert-far-v1'; }
}
