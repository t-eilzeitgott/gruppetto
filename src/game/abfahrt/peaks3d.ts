/**
 * Berge am Horizont: ein Ring aus Höhenfeld (4,6 bis 15 km), dessen Aussehen pro Bildpunkt entsteht –
 * Fels mit Rinnen und Schichten, Schneefelder, die in den Rinnen tiefer hinabreichen, Wald und Matten unten,
 * dazu Licht von Sonne und Himmel und Luftperspektive (je weiter und tiefer, desto mehr Dunst). So bleiben
 * Grate und Schneegrenzen scharf statt einer verwaschenen Eckpunktfarbe.
 */
import * as THREE from 'three';
import { BIOME_PALETTES, mixRGB, type RGB } from './palette';
import type { BiomeId } from './track';

export interface PeakLight {
  uSunDir: { value: THREE.Vector3 };
  uSunC: { value: THREE.Color };
  uSkyC: { value: THREE.Color };
  uGroundC: { value: THREE.Color };
  uFillDir: { value: THREE.Vector3 };
  uFillC: { value: THREE.Color };
  uHaze: { value: THREE.Color };
  uNoise: { value: THREE.Texture | null };
}

export function peakLight(): PeakLight {
  return {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunC: { value: new THREE.Color(1, 1, 1) },
    uSkyC: { value: new THREE.Color(0.4, 0.45, 0.5) }, uGroundC: { value: new THREE.Color(0.3, 0.3, 0.25) },
    uFillDir: { value: new THREE.Vector3(0, 1, 0) }, uFillC: { value: new THREE.Color(0, 0, 0) },
    uHaze: { value: new THREE.Color(0.8, 0.85, 0.9) }, uNoise: { value: null },
  };
}

const VERT = /* glsl */ `
attribute float aR;
attribute vec3 aN1;
varying vec3 vP;
varying vec3 vN;
varying float vR;
varying vec3 vN1;
void main() {
  vP = position;
  vN = normal;
  vR = aR;
  vN1 = aN1;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uSunDir; uniform vec3 uSunC; uniform vec3 uSkyC; uniform vec3 uGroundC;
uniform vec3 uFillDir; uniform vec3 uFillC; uniform vec3 uHaze; uniform sampler2D uNoise;
uniform vec3 uRock; uniform vec3 uRockD; uniform vec3 uForest; uniform vec3 uMeadow; uniform vec3 uSnowC; uniform vec3 uSnowS;
uniform float uAmp; uniform float uSnow; uniform float uTree; uniform float uOpacity;
uniform float uR0; uniform float uR1;
varying vec3 vP;
varying vec3 vN;
varying float vR;
varying vec3 vN1;
void main() {
  vec3 N = normalize(vN);
  float r = length(vP.xz);
  float h = vP.y;
  // großflächiges Rauschen je Ecke, mittleres pro Bildpunkt
  vec3 n1 = vN1;
  vec3 n2 = texture2D(uNoise, vP.xz / 820.0).rgb;
  // Rinnen den Hang hinunter – nur an steilen Flanken gelesen
  float wallW = 1.0 - smoothstep(0.55, 0.85, N.y);
  vec2 gA = vec2(vP.z / 520.0, h / 800.0);
  vec2 gB = vec2(vP.x / 520.0, h / 800.0);
  vec2 gAx = dFdx(gA);
  vec2 gAy = dFdy(gA);
  vec2 gBx = dFdx(gB);
  vec2 gBy = dFdy(gB);
  float gul = 0.5;
  if (wallW > 0.01) {
    float wxz = abs(N.x) / (abs(N.x) + abs(N.z) + 1e-4);
    gul = mix(0.5, mix(textureGrad(uNoise, gA, gAx, gAy).g, textureGrad(uNoise, gB, gBx, gBy).g, 1.0 - wxz), wallW);
  }
  float rel = (h + 120.0) / uAmp;
  float steep = 1.0 - smoothstep(0.5, 0.85, N.y);
  vec3 c = mix(uRock, uRockD, clamp(steep * 0.55 + (0.5 - gul) * 0.35 + (n2.r - 0.5) * 0.5, 0.0, 1.0));
  c *= 0.9 + 0.2 * n1.g;
  // Grate hell, Rinnen und Mulden dazwischen dunkel – gibt den Flanken Struktur, egal woher das Licht kommt
  float ao = 0.55 + 0.6 * smoothstep(0.05, 0.75, vR);
  // Wald und Matten unten, Grenze mit Rauschen
  float veg = 1.0 - smoothstep(uTree - 0.07, uTree + 0.05, rel + (n2.g - 0.5) * 0.14 + (n1.b - 0.5) * 0.1);
  vec3 vc = mix(uForest, uMeadow, smoothstep(0.72, 0.95, N.y) * 0.55 + (n2.b - 0.5) * 0.3);
  c = mix(c, vc, veg * (1.0 - steep * 0.55));
  // Schnee: oberhalb der Grenze auf allem, was nicht zu steil ist; in Rinnen tiefer hinab
  float sl = rel + (n2.b - 0.5) * 0.16 + (n1.r - 0.5) * 0.1 + (0.5 - gul) * 0.06;
  float sn = smoothstep(uSnow - 0.04, uSnow + 0.03, sl) * smoothstep(0.32, 0.56, N.y + (n2.r - 0.5) * 0.25 + (0.5 - gul) * 0.12);
  c = mix(c, mix(uSnowS, uSnowC, smoothstep(0.55, 0.95, N.y)), sn);
  c *= mix(ao, 1.0, sn * 0.5);
  // Licht: Himmel (Halbkugel), Sonne, Gegenlicht
  vec3 light = mix(uGroundC, uSkyC, 0.5 + 0.5 * N.y) + uSunC * max(dot(N, uSunDir), 0.0) + uFillC * max(dot(N, uFillDir), 0.0);
  vec3 col = c * light;
  // Luftperspektive: mit der Entfernung und zum Tal hin mehr Dunst, Gipfel bleiben klarer
  float far = smoothstep(uR0, uR1, r);
  float low = 1.0 - smoothstep(-80.0, uAmp * 0.45, h);
  float hz = clamp(0.1 + far * 0.55 + low * 0.2, 0.0, 0.9);
  col = mix(col, uHaze, hz);
  gl_FragColor = vec4(col, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const lin = (c: RGB) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);

/** Ring beginnt knapp hinter der gröbsten Landschaftsstufe (dazwischen sähe man sonst Löcher) */
export const PEAK_R0 = 3000;
export const PEAK_R1 = 15000;

/** Bergring für eine Landschaft (Größe und Charakter je Tal) */
export function buildPeaks(biome: BiomeId, L: PeakLight): THREE.Mesh {
  const pal = BIOME_PALETTES[biome];
  let seed = 7;
  for (const ch of biome) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const cfg: Record<BiomeId, { amp: number; snow: number; tree: number; sharp: number }> = {
    pass: { amp: 1750, snow: 0.3, tree: 0.15, sharp: 1.5 },
    alpine: { amp: 1650, snow: 0.34, tree: 0.27, sharp: 1.4 },
    forest: { amp: 1000, snow: 0.62, tree: 0.55, sharp: 1.15 },
    village: { amp: 1450, snow: 0.4, tree: 0.33, sharp: 1.3 },
    lake: { amp: 1350, snow: 0.42, tree: 0.35, sharp: 1.3 },
    vineyard: { amp: 450, snow: 2, tree: 0.9, sharp: 0.85 },
  };
  const c = cfg[biome];
  const hh = (x: number, y: number) => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = hh(xi, yi) + (hh(xi + 1, yi) - hh(xi, yi)) * u;
    const b = hh(xi, yi + 1) + (hh(xi + 1, yi + 1) - hh(xi, yi + 1)) * u;
    return a + (b - a) * v;
  };
  // Grate: 1 − |n|, geschärft; feinere Oktaven folgen den groben (Täler bleiben ruhig, Grate werden zackig)
  const ridged = (x: number, y: number) => {
    let sum = 0;
    let amp = 0.55;
    let f = 1;
    let w = 1;
    for (let o = 0; o < 6; o++) {
      let n = 1 - Math.abs(noise(x * f + o * 3.1, y * f - o * 1.7) * 2 - 1);
      n = Math.pow(n, 2.2);
      sum += n * amp * w;
      w = Math.min(1, n * 1.7);
      f *= 2.07;
      amp *= 0.5;
    }
    return sum;
  };
  const NA = 420;
  const NR = 34;
  const pos: number[] = [];
  const rid: number[] = [];
  const nz1: number[] = [];
  for (let i = 0; i < NR; i++) {
    const t = i / (NR - 1);
    const r = PEAK_R0 * Math.pow(PEAK_R1 / PEAK_R0, t);
    // Anstieg über gut 3 km (sonst steht vorn eine Wand), hinten etwas niedriger
    const e0 = Math.min(1, Math.max(0, (r - PEAK_R0) / 3300));
    const env = e0 * e0 * (3 - 2 * e0) * (1 - 0.3 * Math.max(0, (r - 9000) / (PEAK_R1 - 9000)));
    for (let j = 0; j <= NA; j++) {
      const a = (j / NA) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // verzerrte Lage: Massive und Täler laufen nicht im Raster
      const wx = x + 1100 * (noise(x / 5200 + 2.3, z / 5200 - 1.1) - 0.5);
      const wz = z + 1100 * (noise(x / 5200 - 4.7, z / 5200 + 3.9) - 0.5);
      const ridge = ridged(wx / 2600 + 11, wz / 2600 - 7);
      const massif = 0.5 + 0.5 * noise(x / 6500 + 3, z / 6500 + 5);
      const hgt = -420 + c.amp * 1.5 * env * massif * (0.1 + Math.pow(ridge, c.sharp) * 1.3);
      pos.push(x, hgt, z);
      rid.push(Math.min(1, ridge));
      nz1.push(noise(x / 3100 + 1.7, z / 3100 - 2.2), noise(x / 3100 - 5.1, z / 3100 + 0.4), noise(x / 3100 + 3.3, z / 3100 + 6.1));
    }
  }
  const idx: number[] = [];
  const W = NA + 1;
  for (let i = 0; i < NR - 1; i++) {
    for (let j = 0; j < NA; j++) {
      const a = i * W + j;
      const b = a + W;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aR', new THREE.Float32BufferAttribute(rid, 1));
  geo.setAttribute('aN1', new THREE.Float32BufferAttribute(nz1, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const own = {
    uRock: { value: lin(mixRGB(pal.far, [134, 130, 124], 0.6)) },
    uRockD: { value: lin(mixRGB(pal.far, [78, 76, 74], 0.62)) },
    uForest: { value: lin(mixRGB(pal.mid, [36, 64, 40], 0.55)) },
    uMeadow: { value: lin(mixRGB(pal.mid, pal.valley, 0.5)) },
    uSnowC: { value: lin([246, 249, 252]) },
    uSnowS: { value: lin([196, 210, 228]) },
    uAmp: { value: c.amp }, uSnow: { value: c.snow }, uTree: { value: c.tree }, uOpacity: { value: 1 },
    uR0: { value: PEAK_R0 }, uR1: { value: PEAK_R1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...L, ...own },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    fog: false,
    toneMapped: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  // nach der Landschaft zeichnen: verdeckte Bildpunkte fallen dann früh weg (die Berge sind meist nur ein Streifen)
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;
  return mesh;
}

export function setPeakOpacity(m: THREE.Mesh, a: number) {
  const mat = m.material as THREE.ShaderMaterial;
  mat.uniforms.uOpacity.value = a;
  // nur beim Überblenden durchsichtig (sonst undurchsichtig: billiger, verdeckte Teile entfallen)
  mat.transparent = a < 0.999;
  mat.depthWrite = !mat.transparent;
}
