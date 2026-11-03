/**
 * Wasser der Seen, Flüsse und Küsten: statt einer glatten blauen Fläche bewegte Wellen aus einer Normalentextur
 * (kachelbar, zwei Lagen in verschiedener Größe und Richtung, die langsam gegeneinander laufen). Die Wellen färben
 * nur, sie beleuchten nicht neu: Das Licht der Szene fällt auf die glatte Fläche (keine wolkigen Flecken), die
 * Wellen zeigen sich im gespiegelten Himmel nach Fresnel (flach über dem Wasser hell wie der Horizont, von oben
 * blickt man ins dunklere Wasser, durch das nah am Ufer der Grund schimmert), in einem leichten Relief (Flanken zur
 * Sonne heller) und im Sonnenglitzern – scharfe Funken statt eines breiten milchigen Glanzlichts.
 *
 * Billig gehalten: zwei Texturzugriffe je Bildpunkt, keine Spiegelung der Szene, kein zweiter Durchgang. In der
 * Ferne werden die Wellen flacher (die Mipmaps glätten ohnehin) – kein Flimmern am Horizont.
 */
import * as THREE from 'three';
import { mulberry32 } from './rng';

/**
 * Normalentextur der Wellen (S × S, kachelbar): Summe von Sinuswellen mit ganzzahligen Frequenzen – längere Dünung
 * aus einer Hauptrichtung (Wind), darüber kurze Kräuselwellen kreuz und quer. Ableitungen analytisch, je Welle
 * zerlegt in Zeilen- und Spaltenanteil (cos(a + b) = cos a cos b − sin a sin b): schnell genug für den App-Start.
 */
export function waterNormalCanvas(S = 256): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const c = cv.getContext('2d')!;
  const r = mulberry32(0x5ea);
  type Wave = { fx: number; fy: number; a: number; ph: number };
  const waves: Wave[] = [];
  const add = (n: number, fMin: number, fMax: number, spread: number, amp: number, pow: number) => {
    for (let k = 0; k < n; k++) {
      const f = fMin + (fMax - fMin) * Math.pow(r(), 1.4);
      const ang = 0.5 + (r() - 0.5) * spread;
      let fx = Math.round(Math.cos(ang) * f);
      const fy = Math.round(Math.sin(ang) * f);
      if (!fx && !fy) fx = 1;
      waves.push({ fx, fy, a: amp / Math.pow(Math.hypot(fx, fy), pow), ph: r() * Math.PI * 2 });
    }
  };
  // Dünung (aus einer Richtung), Wellen, Kräuseln (kreuz und quer)
  add(10, 1, 5, 1.2, 1, 1.1);
  add(16, 4, 14, 2.6, 0.75, 1.15);
  add(18, 12, 40, Math.PI * 2, 0.5, 1.2);
  const tau = (Math.PI * 2) / S;
  // je Welle: cos und sin über die Spalten (x) und die Zeilen (y, samt Phase)
  const cx = waves.map((w) => Float32Array.from({ length: S }, (_, x) => Math.cos(w.fx * x * tau)));
  const sx = waves.map((w) => Float32Array.from({ length: S }, (_, x) => Math.sin(w.fx * x * tau)));
  const cy = waves.map((w) => Float32Array.from({ length: S }, (_, y) => Math.cos(w.fy * y * tau + w.ph)));
  const sy = waves.map((w) => Float32Array.from({ length: S }, (_, y) => Math.sin(w.fy * y * tau + w.ph)));
  const dx = new Float32Array(S * S);
  const dy = new Float32Array(S * S);
  let max = 1e-6;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let gx = 0, gy = 0;
      for (let k = 0; k < waves.length; k++) {
        // h = a·sin(φ), ∂h/∂x = a·cos(φ)·fx·τ  mit cos(φ) = cos(fx x τ)·cos(fy y τ + ph) − sin(…)·sin(…)
        const cp = cx[k][x] * cy[k][y] - sx[k][x] * sy[k][y];
        const w = waves[k];
        gx += w.a * cp * w.fx;
        gy += w.a * cp * w.fy;
      }
      const i = y * S + x;
      dx[i] = gx;
      dy[i] = gy;
      max = Math.max(max, Math.abs(gx), Math.abs(gy));
    }
  }
  const img = c.createImageData(S, S);
  const d = img.data;
  // stärkste Neigung etwa 45°; die Stärke im Bild regelt der Shader
  const k = 1 / max;
  for (let i = 0; i < S * S; i++) {
    const nx = -dx[i] * k, ny = -dy[i] * k;
    const l = Math.hypot(nx, ny, 1);
    d[i * 4] = Math.round(((nx / l) * 0.5 + 0.5) * 255);
    d[i * 4 + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255);
    d[i * 4 + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
    d[i * 4 + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  return cv;
}

export interface WaterUniforms {
  uTime: { value: number };
  /** Stärke der Wellen (Neigung nah an der Kamera) und wie viel Himmel sich höchstens spiegelt */
  uWaveK: { value: number };
  uRefl: { value: number };
  uWaterN: { value: THREE.Texture };
  /** Himmel oben und am Horizont (dieselben Objekte wie im Himmelsshader – sie ändern sich mit der Tageszeit) */
  uSkyTop: { value: THREE.Color };
  uSkyHz: { value: THREE.Color };
  /** Richtung zur Sonne (Welt) und ihr Licht (Farbe × Stärke, linear) fürs Glitzern */
  uSunDir: { value: THREE.Vector3 };
  uSunC: { value: THREE.Color };
  /** was sich knapp über dem Horizont spiegelt: die Hänge am anderen Ufer, im Dunst (linear) */
  uLand: { value: THREE.Color };
}

const HEAD = `
varying vec3 vWaterW;
uniform float uTime;
uniform sampler2D uWaterN;
uniform vec3 uSkyTop;
uniform vec3 uSkyHz;
uniform vec3 uSunDir;
uniform vec3 uSunC;
uniform vec3 uLand;
uniform float uWaveK;
uniform float uRefl;
vec3 waterN;
vec3 waterS;
vec2 waterG;`;

/**
 * Wellen: zwei Lagen der Normalentextur in Weltkoordinaten (24 m und 8 m je Kachel, das krumme Verhältnis verbirgt
 * die Wiederholung), gegeneinander laufend; in der Ferne flacher. Die Flächennormale fürs Licht bleibt glatt.
 */
const NORMAL = `{
  vec2 wp = vWaterW.xz;
  float wt = uTime;
  vec2 n1 = texture2D(uWaterN, wp * 0.0413 + vec2(wt * 0.0108, wt * 0.0064)).xy * 2.0 - 1.0;
  vec2 n2 = texture2D(uWaterN, wp * 0.1187 + vec2(-wt * 0.0157, wt * 0.0119)).xy * 2.0 - 1.0;
  float wd = length(cameraPosition - vWaterW);
  float wk = uWaveK / (1.0 + wd * 0.006);
  waterG = (n1 + n2 * 0.7) * wk;
  waterN = normalize(vec3(waterG.x, 1.0, waterG.y));
  vec2 wsg = (n1 * 0.35 + n2 * 1.5) * wk;
  waterS = normalize(vec3(wsg.x, 1.0, wsg.y));
}`;

/**
 * Wasserkörper (tiefer und dunkler als die Grundfarbe, Wellenflanken zur Sonne heller), darüber nach Fresnel
 * (Schlick) das Gespiegelte – knapp über dem Horizont die Hänge am anderen Ufer, darüber der Himmel – und das
 * Sonnenglitzern: Funken auf den kleinen Wellen (eigene, kräuseligere Normale) und ein weicher Sonnenpfad auf der
 * glatten Fläche (hoch 32 als Multiplikationen). Flach über dem Wasser deckend, von oben etwas durchsichtiger.
 */
const MIX = `{
  vec3 wv = normalize(cameraPosition - vWaterW);
  float wf = 0.02 + 0.98 * pow(1.0 - clamp(dot(waterN, wv), 0.0, 1.0), 5.0);
  vec3 wr = reflect(-wv, waterN);
  wr.y = abs(wr.y);
  vec3 wsky = mix(uSkyHz, uSkyTop, smoothstep(0.04, 0.5, wr.y));
  wsky = mix(uLand, wsky, smoothstep(0.015, 0.09, wr.y));
  vec2 wsd = normalize(uSunDir.xz + vec2(1e-4));
  float wl = 1.0 + clamp(dot(waterG, wsd) * 2.0, -0.4, 0.4);
  outgoingLight = mix(outgoingLight * vec3(0.75, 0.72, 0.56) * wl, wsky, clamp(wf * uRefl, 0.0, uRefl));
  float ws = max(dot(reflect(-wv, waterS), uSunDir), 0.0);
  vec3 wr0 = vec3(-wv.x, wv.y, -wv.z);
  float wg0 = max(dot(wr0, uSunDir), 0.0);
  wg0 *= wg0; wg0 *= wg0; wg0 *= wg0; wg0 *= wg0; wg0 *= wg0;
  outgoingLight += uSunC * (pow(ws, 2200.0) * 6.0 + wg0 * 0.1);
  diffuseColor.a = mix(diffuseColor.a * 0.86, 1.0, wf);
}`;

/** Material für Wasser einrichten (hängt sich an vorhandene Anpassungen an, z. B. das Absenken der Landschaftsstufen) */
export function waterify(m: THREE.MeshPhongMaterial, U: WaterUniforms, tag: string) {
  const prev = m.onBeforeCompile;
  const key = m.customProgramCacheKey();
  m.onBeforeCompile = function (sh, r) {
    prev.call(this, sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWaterW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWaterW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${HEAD}`)
      .replace('#include <normal_fragment_maps>', NORMAL)
      .replace('#include <opaque_fragment>', `${MIX}\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => `${key}|water3-${tag}`;
  m.needsUpdate = true;
}
