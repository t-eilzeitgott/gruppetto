/**
 * Berge am Horizont: ein Ring aus Höhenfeld (4,6 bis 15 km), dessen Aussehen pro Bildpunkt entsteht –
 * Fels mit Rinnen und Schichten, Schneefelder, die in den Rinnen tiefer hinabreichen, Wald und Matten unten,
 * dazu Licht von Sonne und Himmel und Luftperspektive (je weiter und tiefer, desto mehr Dunst). So bleiben
 * Grate und Schneegrenzen scharf statt einer verwaschenen Eckpunktfarbe.
 *
 * PC-Grafik: gut zwanzigmal so fein (1800 × 150 Punkte), mehr Oktaven an den Graten, dazu feine Felsstruktur je
 * Bildpunkt (Normale aus dem Rauschen gestört), Schnee mit durchscheinendem Licht und Schlagschatten der Berge
 * aufeinander (je Punkt der Sonne entgegen abgetastet; wandert die Sonne, wird nachgerechnet und weich überblendet).
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
  /** Dunst zur Sonne hin in ihrer Farbe (dasselbe wie ATMO.fogSunCol in grade.ts) */
  uGlow: { value: THREE.Color };
  uNoise: { value: THREE.Texture | null };
}

export function peakLight(): PeakLight {
  return {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunC: { value: new THREE.Color(1, 1, 1) },
    uSkyC: { value: new THREE.Color(0.4, 0.45, 0.5) }, uGroundC: { value: new THREE.Color(0.3, 0.3, 0.25) },
    uFillDir: { value: new THREE.Vector3(0, 1, 0) }, uFillC: { value: new THREE.Color(0, 0, 0) },
    uHaze: { value: new THREE.Color(0.8, 0.85, 0.9) }, uGlow: { value: new THREE.Color(0, 0, 0) }, uNoise: { value: null },
  };
}

const VERT = /* glsl */ `
attribute float aR;
attribute vec3 aN1;
varying vec3 vP;
varying vec3 vN;
varying float vR;
varying vec3 vN1;
#ifdef PEAK_PC
attribute float aSun0;
attribute float aSun1;
uniform float uSunMix;
varying float vSun;
#endif
void main() {
  vP = position;
  vN = normal;
  vR = aR;
  vN1 = aN1;
  #ifdef PEAK_PC
    vSun = mix(aSun0, aSun1, uSunMix);
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uSunDir; uniform vec3 uSunC; uniform vec3 uSkyC; uniform vec3 uGroundC;
uniform vec3 uFillDir; uniform vec3 uFillC; uniform vec3 uHaze; uniform vec3 uGlow; uniform sampler2D uNoise;
uniform vec3 uRock; uniform vec3 uRockD; uniform vec3 uForest; uniform vec3 uMeadow; uniform vec3 uSnowC; uniform vec3 uSnowS;
uniform float uAmp; uniform float uSnow; uniform float uTree; uniform float uOpacity;
uniform float uR0; uniform float uR1;
varying vec3 vP;
varying vec3 vN;
varying float vR;
varying vec3 vN1;
#ifdef PEAK_PC
varying float vSun;
/* Steigung des Rauschens (Kanal g) je Kachel bei q / s (zwei Nachbarn; in der Ferne glätten die Mipmaps) */
vec2 bumpAt(vec2 q, float s) {
  vec2 u = q / s;
  float e = 1.0 / 256.0;
  float h0 = texture2D(uNoise, u).g;
  return vec2(texture2D(uNoise, u + vec2(e, 0.0)).g - h0, texture2D(uNoise, u + vec2(0.0, e)).g - h0) / e;
}
#endif
void main() {
  vec3 N = normalize(vN);
  float r = length(vP.xz);
  float h = vP.y;
  #ifdef PEAK_PC
    // feine Felsstruktur je Bildpunkt: die Normale folgt einem Relief aus zwei Maßstäben (Rippen, Blöcke) – in der
    // Wand auf die Wandfläche projiziert, auf flachen Hängen von oben; je weiter weg, desto ruhiger
    {
      float fade = 1.0 - smoothstep(9000.0, 15000.0, r);
      vec2 tw0 = vec2(-N.z, N.x) / max(1e-3, length(N.xz));
      float wall = 1.0 - smoothstep(0.45, 0.8, N.y);
      vec2 qW = vec2(dot(vP.xz, tw0), h);
      vec2 bW = bumpAt(qW, 210.0) * 0.022 + bumpAt(qW * vec2(1.0, 1.6), 58.0) * 0.014;
      vec2 bF = bumpAt(vP.xz, 260.0) * 0.02 + bumpAt(vP.xz, 70.0) * 0.012;
      // Wand: Steigung entlang der Wand (waagrecht) und nach oben; Hang: in x und z
      vec3 gW = vec3(tw0.x, 0.0, tw0.y) * bW.x + vec3(0.0, bW.y, 0.0);
      vec3 gF = vec3(bF.x, 0.0, bF.y);
      vec3 g = mix(gF, gW, wall) * fade;
      N = normalize(N - (g - N * dot(g, N)));
    }
  #endif
  // großflächiges Rauschen je Ecke, mittleres pro Bildpunkt
  vec3 n1 = vN1;
  vec3 n2 = texture2D(uNoise, vP.xz / 820.0).rgb;
  // Rinnen den Hang hinunter – nur an steilen Flanken gelesen
  float wallW = 1.0 - smoothstep(0.55, 0.85, N.y);
  // Rinnen entlang der Wand (eine Projektion: waagrecht in Wandrichtung, senkrecht nach Höhe), Schichten quer dazu
  vec2 tw = vec2(-N.z, N.x) / max(1e-3, length(N.xz));
  vec2 gA = vec2(dot(vP.xz, tw) / 520.0, h / 800.0);
  vec2 gAx = dFdx(gA);
  vec2 gAy = dFdy(gA);
  vec2 sA = vec2((vP.x + vP.z) / 2000.0, h / 90.0);
  vec2 sAx = dFdx(sA);
  vec2 sAy = dFdy(sA);
  float gul = 0.5;
  float strat = 0.5;
  if (wallW > 0.01) {
    gul = mix(0.5, textureGrad(uNoise, gA, gAx, gAy).g, wallW);
    strat = mix(0.5, textureGrad(uNoise, sA, sAx, sAy).r, wallW);
  }
  float rel = (h + 120.0) / uAmp;
  float steep = 1.0 - smoothstep(0.5, 0.85, N.y);
  vec3 c = mix(uRock, uRockD, clamp(steep * 0.55 + (0.5 - gul) * 0.35 + (n2.r - 0.5) * 0.5, 0.0, 1.0));
  c *= 0.86 + 0.24 * strat;
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
  #ifdef PEAK_PC
    // Schlagschatten der Berge aufeinander (je Punkt vorab), Schnee lässt Licht etwas um die Kante (weicher
    // Übergang ins Schattenblau), Mulden bekommen weniger Himmel
    float nl = dot(N, uSunDir);
    float sunL = mix(max(nl, 0.0), clamp((nl + 0.25) / 1.25, 0.0, 1.0), sn * 0.6) * vSun;
    float sky = (0.5 + 0.5 * N.y) * (0.72 + 0.28 * smoothstep(0.1, 0.8, vR));
    vec3 light = mix(uGroundC, uSkyC, sky) + uSunC * sunL + uFillC * max(dot(N, uFillDir), 0.0) * (0.6 + 0.4 * vSun);
    // im Schatten liegender Schnee bläulich (Himmelslicht), in der Sonne ein Hauch wärmer
    c = mix(c, c * vec3(0.9, 0.96, 1.08), sn * (1.0 - vSun) * 0.6);
  #else
    vec3 light = mix(uGroundC, uSkyC, 0.5 + 0.5 * N.y) + uSunC * max(dot(N, uSunDir), 0.0) + uFillC * max(dot(N, uFillDir), 0.0);
  #endif
  vec3 col = c * light;
  // Luftperspektive: mit der Entfernung und zum Tal hin mehr Dunst, Gipfel bleiben klarer
  float far = smoothstep(uR0, uR1, r);
  float low = 1.0 - smoothstep(-80.0, uAmp * 0.45, h);
  float hz = clamp(0.1 + far * 0.55 + low * 0.2, 0.0, 0.9);
  // Dunst zur Sonne hin in ihrer Farbe (wie der Nebel der Landschaft, grade.ts)
  col = mix(col, uHaze + uGlow * pow(max(dot(normalize(vP), uSunDir), 0.0), 5.0), hz);
  gl_FragColor = vec4(col, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const lin = (c: RGB) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);

export const PEAK_R0 = 4600;
export const PEAK_R1 = 15000;

/** Bergring für eine Landschaft (Größe und Charakter je Tal); pc: die feine Fassung der PC-Grafik */
export function buildPeaks(biome: BiomeId, L: PeakLight, pc = false): THREE.Mesh {
  const it = buildPeaksSteps(biome, L, pc);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** Gitter des Rings (Punkte je Ring, Ringe) */
const GRID = { lo: { NA: 420, NR: 34, oct: 6 }, pc: { NA: 1800, NR: 150, oct: 7 } };

/** ist das die feine Fassung (PC-Grafik)? */
export function isPcPeaks(m: THREE.Mesh): boolean {
  return !!m.userData.pc;
}

/** wie buildPeaks, in Schritten (ein Ring je Schritt): beim Landschaftswechsel kein langes Bild */
export function* buildPeaksSteps(biome: BiomeId, L: PeakLight, pc = false): Generator<void, THREE.Mesh, void> {
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
  const G = pc ? GRID.pc : GRID.lo;
  const ridged = (x: number, y: number) => {
    let sum = 0;
    let amp = 0.55;
    let f = 1;
    let w = 1;
    for (let o = 0; o < G.oct; o++) {
      let n = 1 - Math.abs(noise(x * f + o * 3.1, y * f - o * 1.7) * 2 - 1);
      n = Math.pow(n, 2.2);
      sum += n * amp * w;
      w = Math.min(1, n * 1.7);
      f *= 2.07;
      amp *= 0.5;
    }
    return sum;
  };
  const { NA, NR } = G;
  const W = NA + 1;
  const pos = new Float32Array(NR * W * 3);
  const rid = new Float32Array(NR * W);
  const nz1 = new Float32Array(NR * W * 3);
  let v = 0;
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
      pos[v * 3] = x; pos[v * 3 + 1] = hgt; pos[v * 3 + 2] = z;
      rid[v] = Math.min(1, ridge);
      nz1[v * 3] = noise(x / 3100 + 1.7, z / 3100 - 2.2);
      nz1[v * 3 + 1] = noise(x / 3100 - 5.1, z / 3100 + 0.4);
      nz1[v * 3 + 2] = noise(x / 3100 + 3.3, z / 3100 + 6.1);
      v++;
    }
    yield;
  }
  const idx = NR * W > 65535 ? new Uint32Array((NR - 1) * NA * 6) : new Uint16Array((NR - 1) * NA * 6);
  let k = 0;
  for (let i = 0; i < NR - 1; i++) {
    for (let j = 0; j < NA; j++) {
      const a = i * W + j;
      const b = a + W;
      idx[k++] = a; idx[k++] = a + 1; idx[k++] = b; idx[k++] = a + 1; idx[k++] = b + 1; idx[k++] = b;
    }
    if (pc && (i & 15) === 15) yield;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aR', new THREE.BufferAttribute(rid, 1));
  geo.setAttribute('aN1', new THREE.BufferAttribute(nz1, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  yield;
  // Normalen aus den Nachbarn im Gitter (Ring × Winkel) – wie gemittelte Flächennormalen, aber in Schritten
  const nor = new Float32Array(NR * W * 3);
  const P = (ii: number, jj: number, q: number) => pos[(ii * W + jj) * 3 + q];
  for (let i = 0; i < NR; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(NR - 1, i + 1);
    for (let j = 0; j <= NA; j++) {
      const jm = j === 0 ? NA - 1 : j - 1;
      const jp = j === NA ? 1 : j + 1;
      const ax = P(i, jp, 0) - P(i, jm, 0), ay = P(i, jp, 1) - P(i, jm, 1), az = P(i, jp, 2) - P(i, jm, 2);
      const bx = P(i1, j, 0) - P(i0, j, 0), by = P(i1, j, 1) - P(i0, j, 1), bz = P(i1, j, 2) - P(i0, j, 2);
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.hypot(nx, ny, nz) || 1;
      const o = (i * W + j) * 3;
      nor[o] = nx / l; nor[o + 1] = ny / l; nor[o + 2] = nz / l;
    }
    if ((i & 7) === 7) yield;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  yield;
  if (pc) {
    // Schlagschatten der Berge aufeinander für den jetzigen Sonnenstand (beide Puffer gleich: nichts zu überblenden)
    const sun = new Float32Array(NR * W).fill(1);
    yield* sunSteps(pos, NA, NR, L.uSunDir.value, sun);
    geo.setAttribute('aSun0', new THREE.BufferAttribute(sun, 1));
    geo.setAttribute('aSun1', new THREE.BufferAttribute(sun.slice(), 1));
  }
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
  if (pc) Object.assign(own, { uSunMix: { value: 0 } });
  const mat = peakMaterial(L, own, true, pc);
  const mesh = new THREE.Mesh(geo, mat);
  // nach der Landschaft zeichnen: verdeckte Bildpunkte fallen dann früh weg (die Berge sind meist nur ein Streifen)
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;
  mesh.userData.pc = pc;
  mesh.userData.grid = { NA, NR };
  mesh.userData.sunAt = L.uSunDir.value.clone();
  return mesh;
}

function peakMaterial(L: PeakLight, own: Record<string, THREE.IUniform>, transparent: boolean, pc = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...L, ...own },
    defines: pc ? { PEAK_PC: '' } : {},
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent,
    fog: false,
    toneMapped: true,
  });
}

/**
 * Sonnenlicht je Punkt des Rings (0 = im Schatten eines anderen Bergs, 1 = frei): von jedem Punkt der Sonne entgegen
 * über das Höhenfeld tasten (Schritte wachsen mit dem Abstand, bis 9 km). Gerechnet wird auf jedem zweiten Ring
 * und jedem dritten Punkt, dazwischen weich verteilt; ein Ring je Schritt (kein langes Bild).
 */
function* sunSteps(pos: Float32Array, NA: number, NR: number, sd: THREE.Vector3, out: Float32Array): Generator<void, void, void> {
  const W = NA + 1;
  const hz = Math.hypot(sd.x, sd.z);
  // Sonne unter dem Horizont: alles im Schatten (Nacht – das Sonnenlicht ist dann ohnehin aus)
  if (sd.y <= 0.002 || hz < 1e-4) { out.fill(sd.y > 0.002 ? 1 : 0); return; }
  const dx = sd.x / hz, dz = sd.z / hz;
  const slope = sd.y / hz;
  const lnR = Math.log(PEAK_R1 / PEAK_R0);
  const height = (x: number, z: number): number => {
    const r = Math.hypot(x, z);
    if (r < PEAK_R0 || r > PEAK_R1) return -1e9;
    const fi = (Math.log(r / PEAK_R0) / lnR) * (NR - 1);
    let a = Math.atan2(z, x);
    if (a < 0) a += Math.PI * 2;
    const fj = (a / (Math.PI * 2)) * NA;
    const i0 = Math.min(NR - 2, Math.floor(fi)), j0 = Math.min(NA - 1, Math.floor(fj));
    const u = fi - i0, v = fj - j0;
    const H = (i: number, j: number) => pos[(i * W + j) * 3 + 1];
    const a0 = H(i0, j0) + (H(i0, j0 + 1) - H(i0, j0)) * v;
    const a1 = H(i0 + 1, j0) + (H(i0 + 1, j0 + 1) - H(i0 + 1, j0)) * v;
    return a0 + (a1 - a0) * u;
  };
  const SI = 2;
  const SJ = 3;
  const ci = Math.ceil((NR - 1) / SI) + 1;
  const cj = Math.ceil(NA / SJ) + 1;
  const coarse = new Float32Array(ci * cj);
  for (let a = 0; a < ci; a++) {
    const i = Math.min(NR - 1, a * SI);
    for (let b = 0; b < cj; b++) {
      const j = Math.min(NA, b * SJ);
      const o = (i * W + j) * 3;
      const x0 = pos[o], y0 = pos[o + 1] + 6, z0 = pos[o + 2];
      // weicher Schatten: wie knapp der Strahl über die Grate geht (Halbschatten statt harter Kante)
      let vis = 1;
      let t = 60;
      while (t < 9000) {
        const hh = height(x0 + dx * t, z0 + dz * t);
        const ray = y0 + slope * t;
        const k = (ray - hh) / (t * 0.022);
        if (k < vis) { vis = k; if (vis <= 0) { vis = 0; break; } }
        t += 30 + t * 0.06;
      }
      coarse[a * cj + b] = vis;
      if ((b & 255) === 255) yield;
    }
    yield;
  }
  // auf alle Punkte verteilen (zwischen den gerechneten weich)
  for (let i = 0; i < NR; i++) {
    const fa = i / SI;
    const a0 = Math.min(ci - 2, Math.floor(fa));
    const ua = Math.min(1, fa - a0);
    for (let j = 0; j <= NA; j++) {
      const fb = j / SJ;
      const b0 = Math.min(cj - 2, Math.floor(fb));
      const ub = Math.min(1, fb - b0);
      const c00 = coarse[a0 * cj + b0], c01 = coarse[a0 * cj + b0 + 1];
      const c10 = coarse[(a0 + 1) * cj + b0], c11 = coarse[(a0 + 1) * cj + b0 + 1];
      const v0 = c00 + (c01 - c00) * ub;
      const v1 = c10 + (c11 - c10) * ub;
      const v = v0 + (v1 - v0) * ua;
      out[i * W + j] = v * v * (3 - 2 * v);
    }
    if ((i & 7) === 7) yield;
  }
}

/**
 * Sonne gewandert: Schatten der feinen Berge neu rechnen (in Schritten) und dann weich überblenden – das alte Licht
 * bleibt im einen Puffer, das neue kommt in den anderen. Gibt false zurück, wenn es nichts zu tun gibt.
 */
export function* peakSunUpdate(m: THREE.Mesh, sd: THREE.Vector3): Generator<void, boolean, void> {
  if (!m.userData.pc) return false;
  const geo = m.geometry;
  const { NA, NR } = m.userData.grid as { NA: number; NR: number };
  const pos = geo.getAttribute('position').array as Float32Array;
  const mat = m.material as THREE.ShaderMaterial;
  // der gerade sichtbare Stand wird zum alten (aSun0), der neue kommt nach aSun1
  const a0 = geo.getAttribute('aSun0') as THREE.BufferAttribute;
  const a1 = geo.getAttribute('aSun1') as THREE.BufferAttribute;
  const next = new Float32Array(a0.count);
  yield* sunSteps(pos, NA, NR, sd.clone(), next);
  // (erst jetzt lesen: eine frühere Überblendung kann während des Rechnens weitergelaufen sein)
  const mix = mat.uniforms.uSunMix.value as number;
  const cur = a0.array as Float32Array;
  const was = a1.array as Float32Array;
  for (let k = 0; k < cur.length; k++) cur[k] = cur[k] + (was[k] - cur[k]) * mix;
  (a1.array as Float32Array).set(next);
  a0.needsUpdate = true;
  a1.needsUpdate = true;
  mat.uniforms.uSunMix.value = 0;
  m.userData.sunAt = sd.clone();
  return true;
}

/**
 * Stellvertreter beider Spielarten (beim Überblenden durchsichtig, sonst nicht) – bleiben die ganze Zeit bestehen:
 * Sonst gibt three.js die Programme frei, sobald der alte Berg beim Landschaftswechsel verschwindet, und der neue
 * müsste sie mitten im Rennen neu übersetzen (spürbares Stocken).
 */
export function peakKeepers(L: PeakLight, pc = false): THREE.ShaderMaterial[] {
  const own = {
    uRock: { value: [0, 0, 0] }, uRockD: { value: [0, 0, 0] }, uForest: { value: [0, 0, 0] }, uMeadow: { value: [0, 0, 0] },
    uSnowC: { value: [0, 0, 0] }, uSnowS: { value: [0, 0, 0] }, uAmp: { value: 1 }, uSnow: { value: 0 }, uTree: { value: 0 }, uOpacity: { value: 1 },
    uR0: { value: PEAK_R0 }, uR1: { value: PEAK_R1 }, uSunMix: { value: 0 },
  };
  const out: THREE.ShaderMaterial[] = [];
  // (PC-Grafik: die feine Fassung zusätzlich – erst die einfache Fassung steht, dann kommt die feine)
  for (const fine of pc ? [false, true] : [false]) {
    const t = peakMaterial(L, own, true, fine);
    const o = peakMaterial(L, own, false, fine);
    o.depthWrite = true;
    out.push(t, o);
  }
  return out;
}

export function setPeakOpacity(m: THREE.Mesh, a: number) {
  const mat = m.material as THREE.ShaderMaterial;
  mat.uniforms.uOpacity.value = a;
  // nur beim Überblenden durchsichtig (sonst undurchsichtig: billiger, verdeckte Teile entfallen)
  mat.transparent = a < 0.999;
  mat.depthWrite = !mat.transparent;
}
