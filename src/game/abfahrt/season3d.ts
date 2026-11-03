/**
 * Was je Jahreszeit in der Luft treibt (season.ts): Herbstlaub, das sich dreht und taumelt, leiser Schneefall,
 * Blütenblätter im Frühling. Eine Wolke aus Punkten in einem Kasten um die Kamera – die Punkte stehen in der Welt
 * (man fährt durch sie hindurch) und kommen hinter dem Kasten wieder herein. Alles im Shader aus der Zeit: keine
 * Arbeit je Bild außer ein paar Werten.
 */
import * as THREE from 'three';
import type { SeasonLook } from './season';

/** Kasten um die Kamera (m) */
const BOX = new THREE.Vector3(34, 15, 34);

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uBox;
uniform vec3 uCam;
uniform float uMode;   // 1 Laub, 2 Schnee, 3 Blüten
uniform float uScale;
varying vec3 vCol;
varying float vAng;
varying float vA;
void main() {
  float t = uTime;
  float w = aSeed.w;
  // fallen, im Wind treiben, pendeln
  float fall = uMode < 1.5 ? 0.9 + w * 0.7 : uMode < 2.5 ? 0.55 + w * 0.5 : 0.35 + w * 0.3;
  float sway = uMode < 1.5 ? 0.9 : uMode < 2.5 ? 0.35 : 0.7;
  vec3 p = aSeed.xyz * uBox + vec3(sin(t * (0.6 + w) + w * 40.0) * sway + t * 0.6, -t * fall, cos(t * (0.5 + w * 0.8) + w * 23.0) * sway * 0.6 + t * 0.25);
  p = mod(p - uCam, uBox) - uBox * 0.5 + uCam;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = uMode < 1.5 ? 0.16 + w * 0.08 : uMode < 2.5 ? 0.045 + w * 0.04 : 0.07 + w * 0.03;
  gl_PointSize = clamp(size * uScale / max(0.5, -mv.z), 0.0, 48.0);
  // zum Rand des Kastens und ganz nah weich aus (kein Aufblitzen beim Wiedereintritt, nichts klebt an der Linse)
  vec3 q = abs(p - uCam) / (uBox * 0.5);
  vA = (1.0 - smoothstep(0.75, 1.0, max(q.x, max(q.y, q.z)))) * smoothstep(0.6, 2.2, -mv.z);
  // Laub: Goldgelb bis Rostrot und Braun; Blüten: weiß bis rosa
  vec3 c1 = mix(vec3(0.95, 0.62, 0.12), vec3(0.8, 0.24, 0.07), fract(w * 7.3));
  c1 = mix(c1, vec3(0.5, 0.3, 0.12), step(0.78, fract(w * 3.1)));
  vCol = uMode < 1.5 ? c1 : uMode < 2.5 ? vec3(0.95, 0.97, 1.0) : mix(vec3(1.0, 0.86, 0.9), vec3(0.98, 0.97, 0.95), fract(w * 5.7));
  vAng = w * 6.283 + t * (uMode < 1.5 ? 2.0 + w * 3.0 : 1.2) * (fract(w * 11.0) < 0.5 ? -1.0 : 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uMode;
uniform vec3 uLight;
varying vec3 vCol;
varying float vAng;
varying float vA;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a;
  if (uMode > 1.5 && uMode < 2.5) {
    // Schneeflocke: weicher Punkt
    a = 1.0 - smoothstep(0.18, 0.5, length(q));
  } else {
    // Blatt: gedrehte Ellipse, die sich beim Taumeln verkürzt (Kippen um die Längsachse)
    float c = cos(vAng), s = sin(vAng);
    vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    float flip = 0.35 + 0.65 * abs(sin(vAng * 1.7));
    float e = (r.x * r.x) / 0.16 + (r.y * r.y) / (0.045 * flip * flip + 0.004);
    a = 1.0 - smoothstep(0.7, 1.0, e);
  }
  a *= vA;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vCol * uLight, a);
  #include <colorspace_fragment>
}`;

export class SeasonAir {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private n: number;

  constructor(n: number) {
    this.n = n;
    const seeds = new Float32Array(n * 4);
    let s = 0x2545f491;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < n * 4; i++) seeds[i] = rnd();
    const g = new THREE.BufferGeometry();
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    // (Ort kommt aus dem Shader – three.js braucht trotzdem eine Lage)
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uBox: { value: BOX.clone() }, uCam: { value: new THREE.Vector3() }, uMode: { value: 1 },
        uScale: { value: 400 }, uLight: { value: new THREE.Color(1, 1, 1) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    this.points.visible = false;
  }

  /**
   * je Bild: Jahreszeit, Kamera, Zeit; light = Helligkeit der Szene (Himmels- plus Sonnenlicht), heightPx = Höhe
   * der Zeichenfläche in Bildpunkten; k = Anteil (einfache Grafik: weniger)
   */
  update(s: SeasonLook, cam: THREE.PerspectiveCamera, time: number, light: THREE.Color, heightPx: number, k: number) {
    const on = !!s.air && s.airK > 0 && k > 0;
    this.points.visible = on;
    if (!on) return;
    const u = this.material.uniforms;
    u.uMode.value = s.air === 'leaves' ? 1 : s.air === 'snow' ? 2 : 3;
    // Laub einzeln (weniger), Schnee dicht
    const share = s.air === 'snow' ? 1 : s.air === 'leaves' ? 0.32 : 0.4;
    this.points.geometry.setDrawRange(0, Math.floor(this.n * share * s.airK * k));
    u.uTime.value = time;
    (u.uCam.value as THREE.Vector3).copy(cam.position);
    u.uScale.value = heightPx / (2 * Math.tan((cam.fov * Math.PI) / 360));
    (u.uLight.value as THREE.Color).copy(light);
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

// ------------------------------------------------------------------ Rauch aus Kaminen

const SMOKE_VERT = /* glsl */ `
attribute float aPh;
uniform float uTime;
uniform float uScale;
varying float vA;
varying float vT;
void main() {
  // je Kamin einige Wölkchen nacheinander: steigen auf, werden größer, treiben im Wind ab, verblassen
  float t = fract(uTime / 7.0 + aPh);
  vec3 p = position + vec3(t * t * 2.6 + sin(aPh * 40.0 + uTime * 0.5) * 0.25 * t, t * 4.8, t * t * 1.2);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp((0.5 + t * 2.4) * uScale / max(1.0, -mv.z), 0.0, 96.0);
  vA = smoothstep(0.0, 0.12, t) * (1.0 - t) * (1.0 - smoothstep(180.0, 320.0, -mv.z));
  vT = fract(aPh * 9.7);
}`;

const SMOKE_FRAG = /* glsl */ `
uniform vec3 uLight;
uniform float uOn;
varying float vA;
varying float vT;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float d = length(q);
  // weicher Ballen, leicht unregelmäßig
  float a = (1.0 - smoothstep(0.15, 0.5, d)) * (0.85 + 0.15 * sin(atan(q.y, q.x) * 5.0 + vT * 6.0));
  a *= vA * uOn * 0.32;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(vec3(0.78, 0.77, 0.76), vec3(0.92, 0.92, 0.94), vT) * uLight * 1.15, a);
  #include <colorspace_fragment>
}`;

/** Material für den Rauch (ein Shader für alle Orte) */
export function smokeMaterial(time: { value: number }): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: time, uScale: { value: 400 }, uLight: { value: new THREE.Color(1, 1, 1) }, uOn: { value: 0 } },
    vertexShader: SMOKE_VERT,
    fragmentShader: SMOKE_FRAG,
    transparent: true,
    depthWrite: false,
  });
  return m;
}

/** Rauch für die Kaminköpfe eines Orts (x, y, z je Kamin): fünf Wölkchen je Kamin, zeitversetzt */
export function smokePoints(tops: number[], mat: THREE.ShaderMaterial): THREE.Points {
  const n = Math.floor(tops.length / 3);
  const pos = new Float32Array(n * 5 * 3);
  const ph = new Float32Array(n * 5);
  for (let i = 0; i < n; i++) {
    const seed = Math.abs(Math.sin(tops[i * 3] * 12.9898 + tops[i * 3 + 2] * 78.233)) % 1;
    for (let k = 0; k < 5; k++) {
      const j = i * 5 + k;
      pos[j * 3] = tops[i * 3]; pos[j * 3 + 1] = tops[i * 3 + 1]; pos[j * 3 + 2] = tops[i * 3 + 2];
      ph[j] = (seed + k / 5) % 1;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
  const p = new THREE.Points(g, mat);
  p.renderOrder = 6;
  // (die Wölkchen steigen über die Hülle der Kaminköpfe hinaus)
  p.frustumCulled = false;
  return p;
}

// ------------------------------------------------------------------ Schnee auf Dächern

/** wie viel Schnee auf den Dächern liegt (Winter, je Gegend; Renderer3D.setSeason) */
export const ROOF_SNOW = { value: 0 };

/** Dachmaterial: was nach oben schaut, liegt im Winter unter Schnee (Lambert, nach der Normalen) */
export function roofSnowHook(sh: THREE.WebGLProgramParametersWithUniforms) {
  sh.uniforms.uRoofSnow = ROOF_SNOW;
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uRoofSnow;')
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      if (uRoofSnow > 0.0) {
        float upS = dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.95), uRoofSnow * smoothstep(0.3, 0.62, upS));
      }`);
}
