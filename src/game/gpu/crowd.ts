/**
 * Zuschauer im WebGPU-Test: dieselben Menschen wie im Spiel (crowd3d: Körper, Kleidung, Zubehör, Fahnen,
 * Teufelskostüm) an denselben Stellen (Zuschauerzonen hinter den Banden, Trauben in den Kehren, Reihen am Rand und
 * an den Hängen), mit denselben Bewegungen: klatschen, winken, jubeln und hüpfen, filmen, Fahne schwenken,
 * anfeuern, tanzen, La-Ola – und alle schauen dem Fahrer nach.
 *
 * Zwei Darstellungen, und jeder Mensch wechselt höchstens einmal, solange man ihn sieht:
 * - Bild (2D): aus den 3D-Menschen beim Laden gebacken – je Vorlage drei Blickwinkel (vorn, schräg, Seite;
 *   gespiegelt für die andere Seite) und zwei Bewegungsbilder. Das Bild zeigt den Menschen so, wie die Kamera ihn
 *   gerade sieht (er dreht sich wie das Modell zum Fahrer), Mip-Stufen machen ihn in der Ferne weich kleiner.
 * - 3D-Modell: nur nah – hinein, wenn der Fahrer oder die Kamera näher als R_IN kommt, zurück erst weiter als
 *   R_OUT (dann ist er längst hinter der Kamera). Der Wechsel blendet in FADE Sekunden über (Raster), danach steht
 *   genau eine Darstellung da – kein Hin und Her je nach Kameraabstand.
 * Jeder Mensch draußen ist eine Vorlage (Kleidung und Haltung), im Bild wie im Modell dieselbe.
 */
import * as THREE from 'three/webgpu';
import { EDGE, SEG, type Seg, type Track } from '../abfahrt/track';
import { mulberry32 } from '../abfahrt/rng';
import { Act, CROWD_FLAGS, CROWD_NV, CROWD_PAL, KINDS, crowdGeometry, packPerson, randomPerson, STRIDE as PS, type Person, type Zone } from '../abfahrt/crowd3d';
import { adCell, SIGN_COUNT } from '../abfahrt/tex3d';
import { bayer4, tsl, useDither, type N } from './nodes';
import { lit } from './light';
import { groundMap, lampLit, terrainSun } from './sunmap';

const { abs, atan, attribute, cameraPosition, clamp, cos, cross, dFdx, dFdy, dot, float, floor, fract, int, interleavedGradientNoise, ivec2, max, min, mod, normalize, positionGeometry, positionWorld, screenCoordinate, select, sign, sin, smoothstep, texture, textureLoad, time, uniform, uniformArray, varying, vec2, vec3, vec4, wgslFn } = tsl;

const hash = (n: number) => {
  let x = Math.imul(n ^ 0x6a09e667, 0x9e3779b1);
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca77);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
};

// ——— Bewegung (WGSL; entspricht armPose und VERT_BEGIN in crowd3d) ———

const rX = wgslFn(`fn gpRX(p: vec3<f32>, a: f32) -> vec3<f32> { let c = cos(a); let s = sin(a); return vec3<f32>(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }`);
const rY = wgslFn(`fn gpRY(p: vec3<f32>, a: f32) -> vec3<f32> { let c = cos(a); let s = sin(a); return vec3<f32>(p.x * c + p.z * s, p.y, -p.x * s + p.z * c); }`);
const rZ = wgslFn(`fn gpRZ(p: vec3<f32>, a: f32) -> vec3<f32> { let c = cos(a); let s = sin(a); return vec3<f32>(p.x * c - p.y * s, p.x * s + p.y * c, p.z); }`);
const md = wgslFn(`fn gpMod(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }`);
const bit = wgslFn(`fn gpBit(v: f32, b: f32) -> f32 { return gpMod(floor(v / b), 2.0); }`, [md]);

/** Armhaltung (Spalten: Arm links, Arm rechts, Beine, Körper) – x heben, y vor, z Ellbogen, w zur Mitte */
const pose = wgslFn(`fn gpPose(act: f32, t: f32, e: f32) -> mat4x4<f32> {
  let TAU = 6.28318;
  let idleA = vec4<f32>(0.08 + 0.03 * sin(t * 0.9), 0.1 + 0.06 * sin(t * 0.7 + 1.0), 0.3, 0.05);
  let idleB = vec4<f32>(0.08 + 0.03 * sin(t * 0.8 + 2.0), 0.1 + 0.06 * sin(t * 0.6), 0.3, 0.05);
  let c = 0.5 + 0.5 * sin(t * TAU * 2.0);
  let clap = vec4<f32>(0.0, 0.95 + 0.85 * e, 1.35 - 0.6 * e, 0.14 + 0.3 * c);
  var legs = vec4<f32>(0.0);
  var body = vec3<f32>(0.0);
  var A = idleA;
  var B = idleB;
  let ex = smoothstep(0.15, 0.75, e);
  if (act < 0.5) {
    A = mix(idleA, clap, ex * 0.9); B = mix(idleB, clap, ex * 0.9);
  } else if (act < 1.5) {
    A = clap; B = clap;
  } else if (act < 2.5) {
    let w = sin(t * TAU * 1.3);
    B = vec4<f32>(2.35 + 0.42 * w, 0.2, 0.35 + 0.25 * w, 0.0);
    A = mix(idleA, clap, ex * 0.5);
  } else if (act < 3.5) {
    let f = 1.45;
    let pump = 0.5 + 0.5 * sin(t * TAU * f);
    let up = 0.8 + 1.95 * smoothstep(0.0, 0.6, e);
    A = vec4<f32>(up + 0.12 * pump, 0.25, 0.12 + 0.45 * pump * (0.3 + 0.7 * e), 0.0);
    B = vec4<f32>(up + 0.12 * (1.0 - pump), 0.25, 0.12 + 0.45 * (1.0 - pump) * (0.3 + 0.7 * e), 0.0);
    body.x = max(0.0, sin(t * TAU * f)) * 0.15 * ex;
  } else if (act < 4.5) {
    B = vec4<f32>(0.0, 1.42 + 0.03 * sin(t * 1.3), 0.42, 0.28);
    A = vec4<f32>(0.0, 1.2, 1.05, 0.45);
  } else if (act < 5.5) {
    B = vec4<f32>(2.62 + (0.2 + 0.12 * e) * sin(t * TAU * 0.5), 0.1, 0.12, 0.0);
    let pump = 0.5 + 0.5 * sin(t * TAU * 1.5);
    A = mix(idleA, vec4<f32>(2.4, 0.2, 0.35 + 0.8 * pump, 0.0), ex);
  } else if (act < 6.5) {
    let pt = vec4<f32>(0.1, 1.7 + 0.16 * sin(t * TAU * 1.0), 0.12, 0.1);
    B = mix(idleB, pt, 0.35 + 0.65 * ex);
    A = mix(idleA, vec4<f32>(0.0, 1.45, 2.35, 1.1), 0.35 + 0.65 * ex);
    body.z = 0.1 * ex * sin(t * TAU * 1.0);
  } else if (act > 17.5) {
    let pump = max(0.0, sin(t * TAU * 1.2));
    B = vec4<f32>(0.18, 0.25 + 0.55 * pump * (0.4 + 0.6 * e), 1.5 - 0.35 * pump, 0.05);
    A = mix(vec4<f32>(0.35, 0.2, 1.9, 0.6), vec4<f32>(2.3 + 0.25 * pump, 0.3, 0.5, 0.0), ex);
    body.x = pump * 0.12 * ex;
    body.z = 0.06 * sin(t * TAU * 0.6);
    legs = vec4<f32>(0.0, 0.25 * pump * ex, 0.0, 0.25 * pump * ex);
  } else if (act > 14.5 && act < 15.5) {
    let hop = max(0.0, sin(t * TAU * 1.25));
    let land = max(0.0, -sin(t * TAU * 1.25));
    let up = vec4<f32>(2.45 + 0.3 * hop, 0.35, 0.2 + 0.5 * land, 0.0);
    A = up; B = up;
    body.x = hop * 0.32;
    legs = vec4<f32>(0.25 * land, 0.15 + 0.9 * land, 0.25 * land, 0.15 + 0.9 * land);
  } else if (act > 15.5 && act < 16.5) {
    let w = fract(t / 1.2);
    let k = smoothstep(0.0, 0.12, w) * (1.0 - smoothstep(0.24, 0.42, w));
    let up = vec4<f32>(2.8, 0.15, 0.12, 0.0);
    A = mix(idleA, up, k); B = mix(idleB, up, k);
    body.x = k * 0.14;
    let kn = 0.35 * (1.0 - k) * smoothstep(0.5, 0.95, w);
    legs = vec4<f32>(0.0, kn, 0.0, kn);
  } else if (act > 16.5) {
    let s1 = sin(t * TAU * 1.0);
    A = vec4<f32>(2.2 + 0.35 * s1, 0.3, 0.5 + 0.3 * s1, 0.1);
    B = vec4<f32>(2.2 - 0.35 * s1, 0.3, 0.5 - 0.3 * s1, 0.1);
    body.x = abs(s1) * 0.06;
    body.z = 0.08 * s1;
    legs = vec4<f32>(0.12 * s1, 0.2 + 0.2 * max(0.0, s1), -0.12 * s1, 0.2 + 0.2 * max(0.0, -s1));
  } else if (act < 7.5) {
    A = vec4<f32>(0.0, 0.55, 1.75, 0.2); B = A;
  } else if (act < 9.5 || act > 12.5) {
    var jog = 0.0;
    if (act > 12.5) { jog = 1.0; }
    let r = t * TAU * mix(2.35, 1.55, jog);
    let s = sin(r) * mix(1.0, 0.75, jog);
    A = vec4<f32>(0.12, 0.75 * s, 1.5, 0.15);
    if (abs(act - 9.0) < 0.1 || abs(act - 14.0) < 0.1) { B = vec4<f32>(2.6 + 0.12 * s, 0.1, 0.12, 0.0); }
    else { B = vec4<f32>(0.12, -0.75 * s, 1.5, 0.15); }
    legs = vec4<f32>(-0.7 * s, 0.25 + 1.0 * max(0.0, cos(r)), 0.7 * s, 0.25 + 1.0 * max(0.0, -cos(r)));
    body.x = abs(s) * 0.06;
    body.y = 0.2;
  } else if (act < 10.5) {
    let pump = 0.5 + 0.5 * sin(t * TAU * 1.4);
    A = vec4<f32>(0.6 + 2.0 * ex, 0.3, 0.4 + 0.7 * pump, 0.0);
    B = vec4<f32>(0.6 + 2.0 * ex, 0.3, 0.4 + 0.7 * (1.0 - pump), 0.0);
    legs = vec4<f32>(1.35, 1.45, 1.35, 1.45);
  } else if (act > 11.5 && act < 12.5) {
    A = vec4<f32>(0.12, 2.5, 0.42, 0.42); B = A;
  } else {
    let lean = vec4<f32>(0.0, 0.62, 0.55, 0.12);
    A = mix(lean, clap, ex); B = mix(lean, clap, ex);
    body.y = 0.1 * (1.0 - ex);
  }
  return mat4x4<f32>(A, B, legs, vec4<f32>(body, 0.0));
}`);

/** Ecke eines Zuschauers in Weltkoordinaten (c = Farbfach, Körperteil, Extra) */
const place = wgslFn(`fn gpCrowd(p: vec3<f32>, c: vec3<f32>, i0: vec4<f32>, i1: vec4<f32>, i3: vec4<f32>, time: f32, rider: vec3<f32>) -> vec3<f32> {
  var tr = p;
  let part = c.y;
  let act = i1.z;
  let ph = i1.w;
  var t = time * 0.31 * (0.9 + 0.25 * fract(ph * 7.0)) + ph * 37.0;
  if (act > 15.5 && act < 16.5) { t = time * 0.31 + ph * 37.0; }
  let toR = rider.xz - i0.xz;
  let dist = length(toR);
  let e = 1.0 - smoothstep(5.0, 48.0, dist);
  let feat = floor(i3.w / 32.0);
  let P = gpPose(act, t, e);
  var A = P[0];
  let B = P[1];
  let legs = P[2];
  let body = P[3].xyz;
  if (gpBit(feat, 256.0) > 0.5 && (act < 2.5 || abs(act - 6.0) < 0.1 || abs(act - 11.0) < 0.1)) {
    A = vec4<f32>(0.06, 0.32 + 0.04 * sin(t * 0.7), 1.3, 0.22);
  }
  var hide = false;
  if (part > 5.5 && part < 6.5) { hide = abs(i3.y - 1.0) > 0.1; }
  else if (part > 6.5 && part < 7.5) { hide = abs(i3.y - 2.0) > 0.1; }
  else if (part > 7.5 && part < 8.5) { hide = abs(i3.y - 3.0) > 0.1; }
  else if (part > 8.5 && part < 9.5) { hide = gpBit(feat, 4.0) < 0.5; }
  else if (part > 9.5 && part < 10.5) { hide = gpBit(feat, 8.0) < 0.5; }
  else if (part > 10.5 && part < 11.5) { hide = abs(act - 4.0) > 0.1; }
  else if (part > 11.5 && part < 13.5) { hide = abs(act - 5.0) > 0.1 && abs(act - 9.0) > 0.1 && abs(act - 14.0) > 0.1; }
  else if (part > 17.5 && part < 18.5) { hide = abs(i3.y - 4.0) > 0.1; }
  else if (part > 18.5 && part < 19.5) { hide = abs(i3.y - 5.0) > 0.1; }
  else if (part > 19.5 && part < 20.5) { hide = gpBit(feat, 32.0) < 0.5; }
  else if (part > 20.5 && part < 21.5) { hide = gpBit(feat, 64.0) < 0.5; }
  else if (part > 21.5 && part < 22.5) { hide = abs(i3.y - 5.0) > 0.1; }
  else if (part > 22.5 && part < 23.5) { hide = gpBit(feat, 128.0) < 0.5; }
  else if (part > 23.5) { hide = gpBit(feat, 256.0) < 0.5; }
  if (part > 12.5 && part < 13.5) {
    let d = abs(tr.x - 0.252);
    tr.z += sin(d * 7.0 - t * 14.0 + tr.y * 2.0) * 0.09 * d * 1.4;
    tr.y += sin(d * 5.0 - t * 10.0) * 0.03 * d;
  }
  let armA = (part > 0.5 && part < 2.5) || part > 23.5;
  let armB = (part > 2.5 && part < 4.5) || (part > 10.5 && part < 13.5) || (part > 21.5 && part < 22.5);
  if (armA || armB) {
    let sg = select(1.0, -1.0, armA);
    let Q = select(B, A, armA);
    let Sh = vec3<f32>(sg * 0.228, 1.39, 0.0);
    let El = vec3<f32>(sg * 0.25, 1.105, 0.0);
    let fore = (part > 1.5 && part < 2.5) || part > 3.5;
    var q = tr;
    if (fore) { q = El + gpRX(q - El, -Q.z); }
    tr = Sh + gpRZ(gpRY(gpRX(q - Sh, -Q.y), -sg * Q.w), sg * Q.x);
  }
  if (part > 13.5 && part < 17.5) {
    let left = part < 15.5;
    let sg = select(1.0, -1.0, left);
    let swing = select(legs.z, legs.x, left);
    let knee = select(legs.w, legs.y, left);
    let Hp = vec3<f32>(sg * 0.1, 0.9, 0.0);
    let Kn = vec3<f32>(sg * 0.1, 0.46, 0.0);
    var q = tr;
    let lower = (part > 14.5 && part < 15.5) || part > 16.5;
    if (lower) { q = Kn + gpRX(q - Kn, knee); }
    let spread = select(0.0, sg * 0.55, act > 9.5 && act < 10.5);
    tr = Hp + gpRZ(gpRX(q - Hp, -swing), spread);
  }
  let base = i0.w;
  let tgt = atan2(toR.x, toR.y);
  let delta = gpMod(tgt - base + 3.14159, 6.28318) - 3.14159;
  var att = 1.0 - smoothstep(30.0, 150.0, dist);
  if ((act > 7.5 && act < 9.5) || (act > 11.5 && act < 17.5)) { att = 0.0; }
  let bodyTurn = clamp(delta, -1.05, 1.05) * 0.65 * att;
  let headTurn = clamp(delta - bodyTurn, -0.85, 0.85) * att + (1.0 - att) * 0.4 * sin(t * 0.33 + ph * 20.0);
  let head = (part > 4.5 && part < 10.5) || (part > 17.5 && part < 20.5) || (part > 22.5 && part < 23.5);
  if (head) {
    let Nk = vec3<f32>(0.0, 1.5, 0.0);
    let kid = 1.0 - smoothstep(0.68, 0.88, i1.x);
    let q = (tr - Nk) * (1.0 + 0.28 * kid);
    tr = Nk + gpRY(gpRX(q, body.z - 0.06 * e), headTurn);
  }
  if (hide) { tr = vec3<f32>(0.0); }
  tr = gpRX(tr, body.y);
  tr.y += body.x;
  tr = tr * vec3<f32>(i1.x * i1.y, i1.x, i1.x * i1.y);
  return gpRY(tr, base + bodyTurn) + i0.xyz;
}`, [rX, rY, rZ, md, bit, pose]);

// ——— Farbtabelle: Kleidung, Haut, Haare (Zeile 0), Fahnenstreifen (Zeile 1) ———

function paletteTexture(): THREE.DataTexture {
  const W = Math.max(CROWD_PAL.length, CROWD_FLAGS.length);
  const data = new Float32Array(W * 2 * 4);
  CROWD_PAL.forEach((c, i) => data.set([c[0], c[1], c[2], 1], i * 4));
  CROWD_FLAGS.forEach((c, i) => data.set([c[0], c[1], c[2], 1], (W + i) * 4));
  const t = new THREE.DataTexture(data, W, 2, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** Farbe je Ecke (Fach → Farbe der Person) – für die Menschen und für das Backen der Bilder */
function crowdColor(c: N, i1: N, i2: N, i3: N, pal: THREE.DataTexture): N {
  const W = pal.image.width;
  const P = (i: N, row = 0): N => textureLoad(pal, ivec2(int(i.add(0.5).clamp(0, W - 1)), int(row))).rgb;
  const slot = c.x.round();
  const feat = floor(i3.w.div(32));
  const flagI = i3.w.sub(floor(i3.w.div(32)).mul(32));
  const bitOf = (v: N, b: number): N => floor(v.div(b)).sub(floor(v.div(b * 2)).mul(2));
  const skin = P(i2.x), top = P(i2.y), bottom = P(i2.z);
  const fx = c.z.sub(floor(c.z.div(3)).mul(3));
  const fy = floor(c.z.div(3).add(0.01));
  const stripe = select(flagI.lessThan(CROWD_NV - 0.5), fx, fy);
  const S = (k: number) => slot.equal(k);
  let col: N = skin;
  col = select(S(1), top, col);
  col = select(S(2), bottom, col);
  col = select(S(3), select(fract(i1.w.mul(17)).greaterThan(0.45), vec3(0.82, 0.82, 0.82), vec3(0.035, 0.035, 0.035)), col);
  col = select(S(4), P(i2.w), col);
  col = select(S(5), P(i3.x), col);
  col = select(S(6), select(bitOf(feat, 16).greaterThan(0.5), P(i3.z), top), col);
  col = select(S(7), select(bitOf(feat, 1).greaterThan(0.5), skin, bottom), col);
  col = select(S(8), select(bitOf(feat, 2).greaterThan(0.5), top, skin), col);
  col = select(S(9), vec3(0.012, 0.012, 0.012), col);
  col = select(S(10), vec3(0.32, 0.22, 0.12), col);
  col = select(S(11), P(flagI.mul(3).add(stripe), 1), col);
  col = select(S(12), P(i3.z), col);
  col = select(S(13), select(fract(i1.w.mul(23)).greaterThan(0.5), vec3(0.86, 0.22, 0.03), vec3(0.72, 0.42, 0.06)), col);
  return col;
}

/** 3D-Modell ab hier (m, zum Fahrer oder zur Kamera, je nachdem was näher ist), zurück zum Bild erst über R_OUT */
export const R_IN = 7;
const R_OUT = 18;
/** Überblenden beim Wechsel (s) */
const FADE = 0.4;
/** Bilder (2D) bis hier (m), am Ende weich ausgeblendet */
const FAR: [number, number] = [620, 720];

let PAL: THREE.DataTexture | null = null;
const palette = () => (PAL ??= paletteTexture());

/**
 * Anteil der 3D-Darstellung (0 … 1) eines Menschen: f.x Beginn des Wechsels (s), f.y +1 zum Modell hin, −1 zum
 * Bild zurück. Modell und Bild teilen sich die Bildpunkte im Bayer-Raster (Modell [0, k), Bild [k, 1)).
 */
const share3d = (f: N, clock: N): N => {
  const u = clamp(clock.sub(f.x).div(FADE), 0, 1);
  return select(f.y.greaterThan(0), u, float(1).sub(u));
};

/**
 * 3D-Menschen: günstiges Licht (light.ts), eckig schattiert (Flächennormale aus den Ableitungen), vorberechnetes
 * Sonnenlicht, Himmelslicht, Laternen. Nur nah, eine Stufe (fein).
 */
function crowdMaterial(rider: N, clock: N, fade: boolean): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  const c = attribute('color', 'vec3');
  const i0 = attribute('aI0', 'vec4');
  const i1 = attribute('aI1', 'vec4');
  const i2 = attribute('aI2', 'vec4');
  const i3 = attribute('aI3', 'vec4');
  const i4 = attribute('aI4', 'vec4');
  m.positionNode = place({ p: positionGeometry, c, i0, i1, i3, time, rider });
  const vc = varying(crowdColor(c, i1, i2, i3, palette()), 'vCrowdCol');
  const pw = positionWorld;
  const fn = normalize(cross(dFdx(pw), dFdy(pw)));
  const nW = fn.mul(sign(dot(fn, cameraPosition.sub(pw))));
  const g = groundMap(pw.xz);
  m.colorNode = lit({ col: vc, nWorld: nW, vis: terrainSun(pw.xz).mul(g.x), wrap: 0.25, ao: float(1.15), extra: lampLit(vc, g.w) });
  // nur beim Wechsel ausstanzen (Raster) – ganz deckend lässt Apples Grafik verdeckte Bildpunkte weg
  if (fade) useDither(m, float(0), varying(share3d(i4, clock), 'vCrowd3'));
  m.name = 'crowd';
  return m;
}

// ——— Bilder (2D) der Zuschauer: aus den 3D-Menschen gebacken ———

/** Blickwinkel der Bilder (Grad zwischen Blickrichtung des Menschen und Richtung zur Kamera); negative gespiegelt */
const ANG = [0, 45, 90];
const NA = ANG.length;
/** Zelle 2,1 × 3,4 m (Platz für hochgehaltene Fahnen), 136 × 220 Bildpunkte */
const CELL_W = 2.1, CELL_H = 3.4, CELL_PX = 136;
const CELL_PY = Math.round((CELL_PX * CELL_H) / CELL_W);
/** Füße so weit über der Zellenunterkante (m) */
const FOOT = 0.06;

/** Vorlagen je Haltung (Anzahl; kid: Kinder) – jede Person draußen ist eine davon */
const SPEC: [number, number, boolean?][] = [
  [Act.clap, 5], [Act.cheer, 5], [Act.wave, 5], [Act.idle, 4], [Act.film, 3], [Act.shout, 4], [Act.jump, 4], [Act.flag, 6],
  [Act.lean, 4], [Act.dance, 2], [Act.sign, 2], [Act.devil, 2], [Act.ola, 2], [Act.cheer, 1, true], [Act.wave, 1, true],
];
export const VARIANTS = SPEC.reduce((s, [, n]) => s + n, 0);
const CELLS = VARIANTS * NA * 2;
const A_COLS = 20;
const A_ROWS = Math.ceil(CELLS / A_COLS);

/** Takt der Bewegung (Zyklen je Bewegungssekunde des Shaders) – die beiden Bilder liegen einen halben Takt auseinander */
const ACT_F: Record<number, number> = {
  [Act.clap]: 2, [Act.wave]: 1.3, [Act.cheer]: 1.45, [Act.flag]: 1.2, [Act.shout]: 1, [Act.jump]: 1.25, [Act.dance]: 1,
  [Act.devil]: 1.2, [Act.idle]: 0.2, [Act.film]: 0.3, [Act.lean]: 2, [Act.sign]: 0.2,
};
/** Zeit beim Backen (Shader-Sekunden) */
const T_BAKE = 12.3;
/** dreht sich zum Fahrer (wie gpCrowd: nicht beim Laufen, Schild, Hüpfen, La-Ola) */
const turns = (act: number) => !((act > 7.5 && act < 9.5) || (act > 11.5 && act < 17.5));

interface Variant { p: Person; ph: [number, number]; kid: boolean }

/** Vorlagen: so sehen die Zuschauer aus (Kleidung, Haltung) – je Haltung ein paar verschiedene */
function makeVariants(): Variant[] {
  const r = mulberry32(0x5eed42);
  const out: Variant[] = [];
  const zones: Zone[] = ['tifosi', 'pass', 'village'];
  for (const [act, n, kid] of SPEC) {
    for (let k = 0; k < n; k++) {
      let p: Person | null = null;
      for (let tries = 0; tries < 20000 && !p; tries++) {
        const q = randomPerson(r, zones[(out.length + tries) % 3], { row: act === Act.lean ? 0 : 1 + (tries % 2), kid: !!kid });
        if (act === Act.ola) { if (q.act !== Act.sign && q.act !== Act.flag && q.act !== Act.devil && q.hatType !== 5) { q.act = Act.ola; p = q; } }
        else if (q.act === act && (act === Act.devil || q.hatType !== 5)) p = q;
      }
      if (!p) { p = randomPerson(r, 'tifosi', { row: 1 }); p.act = act; }
      p.cup = false;
      if (kid) p.height = 0.62;
      // zwei Bewegungsbilder einen halben Takt auseinander (La-Ola: Arme unten, Arme oben)
      const ph0 = ((out.length * 0.137) % 1) * 0.1;
      let ph: [number, number];
      if (act === Act.ola) {
        const at = (w: number) => (1.2 * (4 + w) - T_BAKE * 0.31) / 37;
        ph = [at(0.7), at(0.18)];
      } else {
        const half = 0.5 / (ACT_F[act] ?? 1);
        ph = [ph0, ph0 + half / (37 + T_BAKE * 0.31 * 0.25 * 7)];
      }
      out.push({ p, ph, kid: !!kid });
    }
  }
  return out;
}

/**
 * Bild-Zuschauer: Viereck zur Kamera gedreht (nur um die Senkrechte), so schmal wie der Mensch (Umriss der
 * Vorlage). Blickwinkel wie beim Modell: Blickrichtung (mit der Drehung zum Fahrer) gegen die Richtung zur Kamera –
 * das passende Bild, zwischen zwei Winkeln und zwischen den zwei Bewegungsbildern kurz im Raster überblendet.
 */
function impostorMaterial(atlas: THREE.Texture, flipV: boolean, bounds: THREE.Vector4[], rider: N, clock: N): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  const iA = attribute('iA', 'vec4');
  const iB = attribute('iB', 'vec4');
  const iC = attribute('iC', 'vec4');
  const q = positionGeometry;
  const P = iA.xyz;
  const sc = iA.w;
  const vI = iB.x;
  const B = uniformArray(bounds, 'vec4').element(int(vI.add(0.5)));
  // Blickrichtung wie gpCrowd: zum Fahrer gedreht, je näher er ist
  const toR = rider.xz.sub(P.xz);
  const distR = toR.length();
  const TAU = Math.PI * 2;
  const wrapA = (a: N): N => mod(a.add(Math.PI), TAU).sub(Math.PI);
  const delta = wrapA(atan(toR.x, toR.y).sub(iB.w));
  const att = float(1).sub(smoothstep(30, 150, distR)).mul(iC.z);
  const yaw = iB.w.add(clamp(delta, -1.05, 1.05).mul(0.65).mul(att));
  const toC = cameraPosition.xz.sub(P.xz);
  const phi = wrapA(atan(toC.x, toC.y).sub(yaw));
  // Winkelstufe: 0°, 45°, 90° (darüber die Seite); Überblenden ±5° um die Mitte zwischen zwei Stufen
  const s = clamp(abs(phi).div(Math.PI / 4), 0, 2);
  const a0 = floor(min(s, float(1.999)));
  const mA = smoothstep(0.38, 0.62, s.sub(a0));
  const mirror = select(phi.lessThan(0), float(-1), float(1));
  // Bewegungsbild: Daumenkino im Takt der Haltung (kurz überblendet); La-Ola (iB.z < 0): Arme oben, wenn die Welle da ist
  const ft = fract(time.mul(iB.z).add(iB.y));
  const flip = smoothstep(0.45, 0.5, ft).mul(float(1).sub(smoothstep(0.95, 1, ft)));
  const w = fract(time.mul(0.31).add(iB.y.mul(37)).div(1.2));
  const ola = smoothstep(0, 0.12, w).mul(float(1).sub(smoothstep(0.24, 0.42, w)));
  const mF = select(iB.z.lessThan(0), ola, flip);
  // Viereck: symmetrisch (Spiegeln tauscht nur die Seiten im Bild), so breit und hoch wie der Umriss
  const toC3 = normalize(vec3(toC.x, 0, toC.y));
  const right = vec3(toC3.z, 0, toC3.x.negate());
  const xc = q.x.mul(B.x);
  const yc = q.y.mul(B.y);
  m.positionNode = P.add(right.mul(xc.mul(CELL_W).mul(sc))).add(vec3(0, yc.mul(CELL_H).sub(FOOT).mul(sc), 0));
  const vXY = varying(vec2(xc, yc), 'vImpXY');
  const vSel = varying(vec4(vI, a0, mA, mirror), 'vImpSel');
  const g = groundMap(P.xz, true);
  const vL = varying(vec4(mF, share3d(iC, clock), terrainSun(P.xz, true).mul(g.x), g.w), 'vImpL');
  const vD = varying(toC.length(), 'vImpD');
  // je Bildpunkt: Winkelstufe und Bewegungsbild (eigene Rauschmuster, damit sich die Überblendungen nicht decken)
  const sc0 = screenCoordinate.xy;
  const tA = interleavedGradientNoise(sc0);
  const tF = interleavedGradientNoise(sc0.add(vec2(17, 31)));
  // ganze Zahlen aus den Zwischenwerten (die kommen interpoliert minimal daneben an – sonst springt die Spalte)
  const a = floor(vSel.y.add(0.5)).add(select(tA.lessThan(vSel.z), float(1), float(0)));
  const f = select(tF.lessThan(vL.x), float(1), float(0));
  const cell = floor(vSel.x.add(0.5)).mul(NA).add(a).mul(2).add(f);
  const row = floor(cell.add(0.5).div(A_COLS));
  const col = cell.sub(row.mul(A_COLS));
  const uIn = vXY.x.mul(vSel.w).add(0.5);
  const u = col.add(uIn).div(A_COLS);
  const vTop = row.add(float(1).sub(vXY.y)).div(A_ROWS);
  const v = flipV ? vTop : float(1).sub(vTop);
  // Mip-Stufe aus den stetigen Koordinaten (der Zellwechsel im Raster würde sonst die kleinste Stufe erzwingen)
  const gx = vec2(dFdx(uIn).div(A_COLS), dFdx(vXY.y).div(A_ROWS));
  const gy = vec2(dFdy(uIn).div(A_COLS), dFdy(vXY.y).div(A_ROWS));
  const tx = texture(atlas, vec2(u, v)).grad(gx, gy);
  // Farbe liegt als Wurzel und vormultipliziert im Atlas (Mip-Stufen ohne dunkle Ränder)
  const alb = tx.rgb.div(max(tx.a, float(0.02)));
  const albedo = alb.mul(alb);
  const n = normalize(toC3.add(vec3(0, 0.55, 0)));
  m.colorNode = lit({ col: albedo, nWorld: n, vis: vL.z, wrap: 0.35, ao: float(1.05), extra: lampLit(albedo, vL.w) });
  // Deckung: Rand (Alpha), Wechsel zum Modell (Bayer wie beim Modell: Bild belegt [k, 1)), fern ausblenden
  const far = float(1).sub(smoothstep(FAR[0], FAR[1], vD));
  const t = bayer4();
  const show = t.greaterThanEqual(vL.y).and(t.lessThan(far)).and(tx.a.greaterThan(0.42));
  m.opacityNode = select(show, float(1), float(0));
  m.alphaTestNode = float(0.5);
  m.name = 'crowd-2d';
  return m;
}

/** alle Teile (Körper und alles Zubehör) in einer Geometrie (fein) */
function mergedPerson(): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], nor: number[] = [], idx: number[] = [];
  const dummy = new Float32Array(PS);
  for (const k of KINDS) {
    const g = crowdGeometry(k, 0, dummy, 1);
    if (!g) continue;
    const o = pos.length / 3;
    const P = g.getAttribute('position'), C = g.getAttribute('color'), Nn = g.getAttribute('normal');
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      col.push(C.getX(i), C.getY(i), C.getZ(i));
      nor.push(Nn.getX(i), Nn.getY(i), Nn.getZ(i));
    }
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + o);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

/** Zuschauer je Seite und 2 m Straße höchstens (dichte Stellen) – außerhalb der Zuschauerzonen der Strecke */
const FILL_MAX = 3.2;
/** Floats je Mensch: Modell (Daten wie crowd3d + Wechsel), Bild */
const PS3 = PS + 4;
const PSI = 12;

interface Buf { geo: THREE.InstancedBufferGeometry; buf: THREE.InstancedInterleavedBuffer; data: Float32Array; mesh: THREE.Mesh; cap: number }

/** Mensch mit Vorlage (vi: Index der Vorlage; vs: Maßstab zur Vorlage) und Darstellung (s3: 1 Modell, t3: Wechsel seit) */
type PV = Person & { vi: number; vs: number; s3: number; t3: number };

/** Ground: Höhe des Straßenrands in Abstand dx vom Bankett (Querprofil) */
export type Ground = (s: Seg, sg: number, dx: number) => number;

export class Crowd {
  readonly group = new THREE.Group();
  readonly rider = uniform(new THREE.Vector3());
  /** Uhr der Wechsel (s, wie performance.now) */
  private clock = uniform(0);
  private people: PV[] = [];
  private src = new Float32Array(0);
  private mat3: THREE.MeshBasicNodeMaterial;
  private mat3s: THREE.MeshBasicNodeMaterial;
  private base3: THREE.BufferGeometry;
  /** Modelle beim Wechsel (Raster) und ganz deckend */
  private model: Buf | null = null;
  private solid: Buf | null = null;
  /** Vorlagen (Kleidung, Haltung) – ihre Bilder liegen im Atlas */
  private variants = makeVariants();
  private byAct = new Map<number, number[]>();
  private kids: number[] = [];
  /** Bild-Zuschauer: ein Netz (Viereck je Mensch) */
  private imp: Buf | null = null;

  private at = new THREE.Vector3(1e9, 0, 0);
  private atR = new THREE.Vector3(1e9, 0, 0);
  /** Prüfhilfe: alle als Bild ('2d') oder alle als Modell ('3d') */
  debugMode: 'auto' | '2d' | '3d' = 'auto';
  /** Pappschilder (Quads im Atlas der Banden) */
  signs: { pos: number[]; uv: number[] } = { pos: [], uv: [] };

  constructor() {
    this.mat3 = crowdMaterial(this.rider, this.clock, true);
    this.mat3s = crowdMaterial(this.rider, this.clock, false);
    this.base3 = mergedPerson();
    this.variants.forEach((V, i) => {
      if (V.kid) { this.kids.push(i); return; }
      const l = this.byAct.get(V.p.act) ?? [];
      l.push(i);
      this.byAct.set(V.p.act, l);
    });
  }

  /**
   * Bilder der Vorlagen backen (einmal beim Laden): jede Vorlage in drei Blickwinkeln und zwei Bewegungen als
   * 3D-Mensch, orthografisch in einen Atlas gezeichnet. Farbe ohne Licht (nur Formschatten) als Wurzel – das Licht
   * der Welt kommt im Bild-Material dazu. Danach je Vorlage der Umriss (für schmale Vierecke).
   */
  async bake(renderer: THREE.WebGPURenderer) {
    const W = A_COLS * CELL_PX, H = A_ROWS * CELL_PY;
    const rt = new THREE.RenderTarget(W, H, { type: THREE.UnsignedByteType, depthBuffer: true });
    rt.texture.colorSpace = THREE.NoColorSpace;
    const data = new Float32Array(CELLS * PS);
    const cw = CELL_W, ch = CELL_H;
    for (let v = 0; v < VARIANTS; v++) {
      for (let a = 0; a < NA; a++) {
        for (let f = 0; f < 2; f++) {
          const c = (v * NA + a) * 2 + f;
          const p = { ...this.variants[v].p };
          p.x = ((c % A_COLS) + 0.5) * cw;
          p.y = -(Math.floor(c / A_COLS) + 1) * ch + FOOT;
          p.z = 0;
          // Kamera schaut von +z: Blickwinkel phi = −Drehung
          p.yaw = -(ANG[a] * Math.PI) / 180;
          p.phase = this.variants[v].ph[f];
          packPerson(p, data, c);
        }
      }
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(this.base3.index);
    for (const k of ['position', 'color', 'normal']) geo.setAttribute(k, this.base3.getAttribute(k));
    const buf = new THREE.InstancedInterleavedBuffer(data, PS, 1);
    for (let k = 0; k < 4; k++) geo.setAttribute(`aI${k}`, new THREE.InterleavedBufferAttribute(buf, 4, k * 4));
    geo.instanceCount = CELLS;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const m = new THREE.MeshBasicNodeMaterial();
    const c = attribute('color', 'vec3');
    const i0 = attribute('aI0', 'vec4'), i1 = attribute('aI1', 'vec4'), i2 = attribute('aI2', 'vec4'), i3 = attribute('aI3', 'vec4');
    // Fahrer 18 m geradeaus vor jedem: aufgeregt, aber ohne Drehung (die rechnet das Bild-Material selbst)
    const rider = vec3(i0.x.add(sin(i0.w).mul(18)), 0, i0.z.add(cos(i0.w).mul(18)));
    m.positionNode = place({ p: positionGeometry, c, i0, i1, i3, time: float(T_BAKE), rider });
    const col = crowdColor(c, i1, i2, i3, palette());
    const pw = positionWorld;
    const fn = normalize(cross(dFdx(pw), dFdy(pw)));
    const nW = fn.mul(sign(dot(fn, vec3(0, 0, 1))));
    const shade = max(dot(nW, normalize(vec3(-0.45, 0.55, 0.7))), float(0)).mul(0.5).add(0.62);
    m.colorNode = col.mul(shade).max(0).sqrt();
    m.fog = false;
    m.name = 'crowd-bake';
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(mesh);
    const cam = new THREE.OrthographicCamera(0, A_COLS * cw, 0, -A_ROWS * ch, 0.1, 50);
    cam.position.set(0, 0, 20);
    cam.updateMatrixWorld();
    const prevRT = renderer.getRenderTarget();
    const prevC = renderer.getClearColor(new THREE.Color());
    const prevA = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(prevC, prevA);
    geo.dispose();
    m.dispose();
    // zurücklesen und als gewöhnliche Textur hochladen: so entstehen die Mip-Stufen sicher (fern bleibt der Mensch
    // sichtbar). Zeilenfolge prüfen: oben in jeder Zelle ist Luft, unten stehen die Füße
    const raw = (await renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H)) as Uint8Array;
    rt.dispose();
    // WebGPU liefert Zeilen auf 256 Bytes aufgefüllt (die letzte ohne Füllung)
    const stride = raw.length === W * H * 4 ? W * 4 : Math.ceil((W * 4) / 256) * 256;
    const px = stride === W * 4 ? new Uint8Array(raw) : new Uint8Array(W * H * 4);
    if (stride !== W * 4) for (let y = 0; y < H; y++) px.set(raw.subarray(y * stride, y * stride + W * 4), y * W * 4);
    const rowA = (y: number) => { let n = 0; for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > 0) n++; return n; };
    let first = 0, last = 0;
    for (let y = 0; y < 6; y++) { first += rowA(y); last += rowA(H - 1 - y); }
    this.flipV = first <= last;
    // Umriss je Vorlage über alle ihre Zellen: halbe Breite (symmetrisch) und Höhe, in Zellmaßen
    const bounds: THREE.Vector4[] = [];
    for (let v = 0; v < VARIANTS; v++) {
      let hw = 0.05, top = 0.3;
      for (let k = 0; k < NA * 2; k++) {
        const cI = v * NA * 2 + k;
        const x0 = (cI % A_COLS) * CELL_PX, r = Math.floor(cI / A_COLS);
        for (let yy = 0; yy < CELL_PY; yy++) {
          // yy: 0 oben in der Zelle
          const y = this.flipV ? r * CELL_PY + yy : H - 1 - (r * CELL_PY + yy);
          const o = y * W * 4;
          for (let xx = 0; xx < CELL_PX; xx++) {
            if (px[o + (x0 + xx) * 4 + 3] < 40) continue;
            hw = Math.max(hw, Math.abs((xx + 0.5) / CELL_PX - 0.5));
            top = Math.max(top, 1 - yy / CELL_PY);
          }
        }
      }
      bounds.push(new THREE.Vector4(Math.min(0.5, hw + 3 / CELL_PX), Math.min(1, top + 3 / CELL_PY), 0, 0));
    }
    this.bounds = bounds;
    const tex = new THREE.DataTexture(px, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = THREE.NoColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    this.atlasTex = tex;
    this.buildImpostors(2048);
  }
  private atlasTex: THREE.DataTexture | null = null;
  private bounds: THREE.Vector4[] = [];
  private impMat: THREE.MeshBasicNodeMaterial | null = null;
  /** Atlas-Zeilen von oben (WebGPU) oder von unten (WebGL) gelesen */
  flipV = true;

  /** Netz der Bild-Zuschauer (wächst bei Bedarf) */
  private buildImpostors(cap: number) {
    if (!this.atlasTex) return;
    if (this.imp) { this.imp.mesh.removeFromParent(); this.imp.geo.dispose(); }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.impMat ??= impostorMaterial(this.atlasTex, this.flipV, this.bounds, this.rider, this.clock);
    this.imp = this.buffer(geo, this.impMat, PSI, cap, ['iA', 'iB', 'iC']);
  }

  /** Instanzpuffer mit Attributen je vier Floats */
  private buffer(geo: THREE.InstancedBufferGeometry, mat: THREE.Material, stride: number, cap: number, names: string[]): Buf {
    const data = new Float32Array(cap * stride);
    const buf = new THREE.InstancedInterleavedBuffer(data, stride, 1);
    buf.setUsage(THREE.DynamicDrawUsage);
    names.forEach((nm, k) => geo.setAttribute(nm, new THREE.InterleavedBufferAttribute(buf, 4, k * 4)));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    this.group.add(mesh);
    this.at.set(1e9, 0, 0);
    return { geo, buf, data, mesh, cap };
  }

  /** 3D-Netze (wachsen bei Bedarf) */
  private buildModel(cap: number) {
    for (const b of [this.model, this.solid]) if (b) { b.mesh.removeFromParent(); b.geo.dispose(); }
    const make = (mat: THREE.Material) => {
      const geo = new THREE.InstancedBufferGeometry();
      geo.setIndex(this.base3.index);
      for (const k of ['position', 'color', 'normal']) geo.setAttribute(k, this.base3.getAttribute(k));
      return this.buffer(geo, mat, PS3, cap, ['aI0', 'aI1', 'aI2', 'aI3', 'aI4']);
    };
    this.model = make(this.mat3);
    this.solid = make(this.mat3s);
  }

  get count() { return this.people.length; }

  /** Zuschauer aus den Requisiten der Strecke (wie im Spiel: render3d.crowdPeople) */
  build(track: Track, ground: Ground, lim: (i: number, sg: number) => number, i0: number, i1: number) {
    this.addRange(track, ground, lim, i0, i1 + 1);
  }

  /** Strecke (m) je Mensch – für das Abbauen hinter dem Fahrer */
  private atZ: number[] = [];

  /**
   * Streaming: Zuschauer der Segmente i0 … i1 (halboffen) dazunehmen. Liefert die Pappschilder dieses Bereichs
   * (Quads im Atlas der Banden) – die bekommen je Bereich ein eigenes Netz.
   */
  addRange(track: Track, ground: Ground, lim: (i: number, sg: number) => number, i0: number, i1: number): { pos: number[]; uv: number[] } {
    const signs0 = this.signs;
    this.signs = { pos: [], uv: [] };
    const n0 = this.people.length;
    for (let i = i0; i < i1; i++) {
      const s = track.seg(i);
      let zoneL = false, zoneR = false;
      for (const sp of s.sprites ?? []) {
        if (sp.k !== 'crowd') continue;
        const sg = sp.x < 0 ? -1 : 1;
        if (sg < 0) zoneL = true; else zoneR = true;
        const before = this.people.length;
        this.crowdPeople(track, ground, s, sg, lim(i, sg), sp.v ?? 0, Math.abs(sp.x) - EDGE);
        for (let k = before; k < this.people.length; k++) this.atZ.push(i * SEG);
      }
      // überall sonst: Zuschauer am Rand und in Reihen am Hang (wie bei einer großen Rundfahrt)
      for (const sg of [-1, 1]) {
        if ((sg < 0 ? zoneL : zoneR) || s.crowd) continue;
        const before = this.people.length;
        this.fill(track, ground, s, sg, lim(i, sg));
        for (let k = before; k < this.people.length; k++) this.atZ.push(i * SEG);
      }
    }
    const mine = this.signs;
    this.signs = { pos: signs0.pos.concat(mine.pos), uv: signs0.uv.concat(mine.uv) };
    if (this.people.length !== n0) this.repack(n0);
    return mine;
  }

  /** Streaming: Zuschauer abbauen (keep: Strecke in m) */
  prune(keep: (at: number) => boolean) {
    const n = this.people.length;
    const people: PV[] = [];
    const atZ: number[] = [];
    this.people.forEach((p, k) => { if (keep(this.atZ[k])) { people.push(p); atZ.push(this.atZ[k]); } });
    if (people.length === n) return;
    this.people = people;
    this.atZ = atZ;
    this.signs = { pos: [], uv: [] };
    this.repack();
  }

  /** Daten aller Menschen neu packen (nur die neuen, die alten bleiben gleich) */
  private repack(from = 0) {
    const n = this.people.length;
    const old = this.src;
    this.src = new Float32Array(Math.max(1, n) * PS);
    if (from > 0 && old.length >= from * PS) this.src.set(old.subarray(0, from * PS));
    else from = 0;
    for (let k = from; k < n; k++) packPerson(this.people[k], this.src, k);
    this.at.set(1e9, 0, 0);
    if (!this.model) this.buildModel(768);
  }

  /** Vorlage zur Haltung wählen und übernehmen (Kleidung, Haltung) – so passen Modell und Bild zusammen */
  private adopt(p: Person, r: () => number): PV {
    let act = p.act;
    if (act === Act.hold || act === Act.sit) act = Act.idle;
    else if (act === Act.run || act === Act.jog) act = Act.cheer;
    else if (act === Act.runFlag || act === Act.jogFlag) act = Act.flag;
    const kid = p.height < 0.8;
    const list = kid ? this.kids : (this.byAct.get(act) ?? this.byAct.get(Act.cheer)!);
    const vi = list[Math.floor(r() * list.length)];
    const V = this.variants[vi].p;
    p.skin = V.skin; p.top = V.top; p.bottom = V.bottom; p.hair = V.hair; p.hat = V.hat; p.hatType = V.hatType;
    p.accent = V.accent; p.flag = V.flag; p.shorts = V.shorts; p.sleeves = V.sleeves; p.longHair = V.longHair;
    p.glasses = V.glasses; p.stripe = V.stripe; p.beard = V.beard; p.backpack = V.backpack; p.ponytail = V.ponytail; p.cup = false;
    p.width = V.width;
    p.act = V.act;
    const q = p as PV;
    q.vi = vi;
    q.vs = p.height / V.height;
    q.s3 = 0;
    q.t3 = -1e6;
    return q;
  }

  private crowdPeople(t: Track, ground: Ground, s: Seg, sg: number, lim: number, v: number, dx0: number) {
    const biome = t.sections[s.sec].biome;
    const zone: Zone = biome === 'pass' ? 'pass' : biome === 'village' ? 'village' : 'tifosi';
    const r = mulberry32(s.i * 7919 + (sg > 0 ? 104729 : 0));
    const group = v === 9;
    const rows = group ? (r() < 0.55 ? [dx0, dx0 + 0.78] : [dx0])
      : v === 8 ? [0.45, 1.2, 1.95] : zone === 'village' ? [0.32, 1.02, 1.7] : [0.38, 1.1, 1.82, 2.55];
    const ola = zone === 'tifosi' && s.crowd && !group && hash(Math.floor(s.i / 30) * 31 + 7) < 0.3;
    const w = { x: 0, y: 0, z: 0, th: 0 };
    const out = this.people;
    // breitere Straße: die Zuschauer stehen entsprechend weiter draußen
    const ex = t.extra(s.i);
    const placeAt = (p: Person, u: number, dx: number) => {
      const gh = ground(s, sg, dx);
      t.world(s.i * SEG + u, sg * (EDGE + ex + dx), gh, w);
      p.x = w.x; p.y = w.y; p.z = w.z;
      const rx = -sg * Math.cos(w.th);
      const rz = -sg * Math.sin(w.th);
      const bx = -Math.sin(w.th);
      const bz = Math.cos(w.th);
      const sign = p.act === Act.sign;
      const k = sign ? 0.85 + r() * 0.3 : 0.25 + r() * 0.45;
      const j = (r() - 0.5) * (sign ? 0.16 : 0.5);
      p.yaw = Math.atan2(rx + bx * k, rz + bz * k) + j;
    };
    for (let ri = 0; ri < rows.length; ri++) {
      if (zone === 'tifosi' && ri === 3 && r() < 0.35) continue;
      let u = group ? r() * 1.2 : 0.3 + r() * 0.2;
      const step = group ? [0.6, 0.45] : ri === 0 ? [0.66, 0.2] : ri === 1 ? [0.72, 0.26] : ri === 2 ? [0.8, 0.32] : [0.86, 0.38];
      const end = group ? 1.8 + r() * 3.4 : 3.7;
      while (u < end) {
        let dx = rows[ri] + (r() - 0.5) * (ri ? 0.2 : 0.06);
        if (EDGE + ex + dx > lim - 0.45) break;
        const kid = ri === 0 && r() < 0.1;
        if (kid) dx -= 0.06;
        const p0 = randomPerson(r, zone, { row: ri, kid });
        if (!s.crowd && p0.act === Act.lean) p0.act = Act.idle;
        if (group && r() < 0.2) p0.act = Act.sign;
        if (ri === 0 && !kid && !group && r() < 0.05) p0.act = Act.sign;
        if (p0.act === Act.sign && p0.hatType === 5) p0.act = Act.devil;
        if (ola && p0.act !== Act.sign && p0.act !== Act.flag && p0.act !== Act.devil && !kid && r() < 0.85) {
          p0.act = Act.ola;
          p0.phase = ((s.i * SEG + u) * 0.03) / 37;
        }
        const p = this.adopt(p0, r);
        if (p.act === Act.sign) { u += 0.4; if (u >= end) break; }
        placeAt(p, u, dx);
        out.push(p);
        if (p.act === Act.sign) this.signBoard(p, r);
        const wide = p.act === Act.flag ? 0.4 : p.act === Act.sign ? 0.75 : p.act === Act.wave ? 0.12 : 0;
        u += step[0] + wide + r() * step[1] + (!group && r() < 0.06 ? 0.5 + r() * 0.7 : 0);
      }
    }
  }

  /**
   * Zuschauer außerhalb der Zuschauerzonen der Strecke: dichte und lockere Abschnitte im Wechsel (Wellen von einigen
   * hundert Metern), in Kehren und Orten voll. Erste Reihe am Bankett, dahinter weitere Reihen, an Hängen bergauf
   * in Rängen bis an den Rand des Korridors.
   */
  private fill(t: Track, ground: Ground, s: Seg, sg: number, lim: number) {
    if (s.tunnel || s.bridge > 0) return;
    const side = sg < 0 ? s.L : s.R;
    const z = s.i * SEG;
    const nz = (x: number, k: number) => { const a = Math.floor(x), f = x - a, u = f * f * (3 - 2 * f); return hash(a * 131 + k) * (1 - u) + hash((a + 1) * 131 + k) * u; };
    let dens = (0.35 + 0.65 * nz(z / 260, sg > 0 ? 7 : 3)) * (0.6 + 0.4 * nz(z / 70, sg > 0 ? 11 : 13));
    let near = false;
    for (let d = -30; d <= 30 && !near; d += 6) if (t.seg(Math.max(t.first, s.i + d)).hairpin > 0) near = true;
    if (near) dens = Math.max(dens, 0.95);
    if (s.bL || s.bR) dens = Math.max(dens, 0.7);
    const n = Math.floor(dens * FILL_MAX + hash(s.i * 977 + (sg > 0 ? 5 : 0)));
    if (n <= 0) return;
    const biome = t.sections[s.sec].biome;
    const zone: Zone = biome === 'pass' ? 'pass' : biome === 'village' ? 'village' : 'tifosi';
    const r = mulberry32(s.i * 6151 + (sg > 0 ? 337 : 0) + 99);
    const ex = t.extra(s.i);
    // wie weit hinaus: am Hang bergauf in Rängen, sonst ein paar Reihen; Abgrund, Felswand: nur vorn
    const room = Math.max(0, lim - EDGE - ex - 0.6);
    const reach = side.drop || side.wall > 0 ? Math.min(room, 0.9) : side.tilt > 0.12 ? Math.min(room, 9) : Math.min(room, 3.2);
    if (reach < 0.3) return;
    const w = { x: 0, y: 0, z: 0, th: 0 };
    const calm = [Act.clap, Act.cheer, Act.wave, Act.idle];
    for (let k = 0; k < n; k++) {
      // vorn dichter, weiter hinten lockerer
      const dx = 0.35 + Math.pow(r(), 1.6) * (reach - 0.35);
      const u = r() * SEG;
      const p0 = randomPerson(r, zone, { row: dx < 0.9 ? 0 : 1 + Math.min(2, Math.floor(dx / 2)) });
      // ohne Bande kein Anlehnen, Schilder und Teufel nur in den Zuschauerzonen
      if (p0.act === Act.lean || p0.act === Act.sign || p0.act === Act.devil) p0.act = calm[Math.floor(r() * calm.length)];
      const p = this.adopt(p0, r);
      const gh = ground(s, sg, dx);
      t.world(z + u, sg * (EDGE + ex + dx), gh, w);
      p.x = w.x; p.y = w.y; p.z = w.z;
      const rx = -sg * Math.cos(w.th), rz = -sg * Math.sin(w.th);
      const bx = -Math.sin(w.th), bz = Math.cos(w.th);
      const kk = 0.25 + r() * 0.45;
      p.yaw = Math.atan2(rx + bx * kk, rz + bz * kk) + (r() - 0.5) * 0.5;
      this.people.push(p);
    }
  }

  /** großes Pappschild über dem Kopf, den Ankommenden zugedreht (wie im Spiel) */
  private signBoard(p: Person, r: () => number) {
    const h = p.height;
    const w = 0.78 + r() * 0.1;
    const tall = w * 0.5;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const cx = p.x + fx * 0.36 * h, cz = p.z + fz * 0.36 * h;
    const y0 = p.y + 1.8 * h, y1 = y0 + tall * 2;
    const tilt = 0.08 * h;
    const pt = (sx: number, y: number, back: number) => [cx + rx * sx - fx * back, y, cz + rz * sx - fz * back];
    const [u0, v0, u1, v1] = adCell(Math.floor(r() * SIGN_COUNT), true);
    const q = [pt(-w, y0, 0), pt(w, y0, 0), pt(w, y1, tilt), pt(-w, y1, tilt)];
    const uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    // eine Fläche; das Material zeigt hinten Pappe
    for (const k of [0, 1, 2, 0, 2, 3]) { this.signs.pos.push(...q[k]); this.signs.uv.push(...uv[k]); }
  }

  private dirAt = new THREE.Vector2(0, 0);
  private vp = new THREE.Matrix4();
  /**
   * Darstellung je Mensch (neu, wenn Kamera oder Fahrer 2 m weiter sind oder die Kamera sich um ~10° dreht):
   * Modell nah am Fahrer oder an der Kamera, sonst Bild – mit Spielraum, damit niemand hin und her wechselt.
   * Was außerhalb des Bildausschnitts liegt (mit Rand), wird nicht gezeichnet.
   */
  update(cam: THREE.Vector3, rider: THREE.Vector3, force = false, dir?: THREE.Vector3, camera?: THREE.Camera) {
    this.rider.value.copy(rider);
    const now = performance.now() / 1000;
    this.clock.value = now;
    let dx = 0, dz = 0;
    if (dir) { const l = Math.hypot(dir.x, dir.z) || 1; dx = dir.x / l; dz = dir.z / l; }
    const turned = !!dir && dx * this.dirAt.x + dz * this.dirAt.y < 0.985;
    const moved = this.at.distanceToSquared(cam) >= 4 || this.atR.distanceToSquared(rider) >= 4;
    if (!this.model || (!force && !turned && !moved)) return;
    // Sprung der Kamera (Schnitt, Start): sofort umstellen, ohne Überblenden
    const cut = this.at.distanceToSquared(cam) > 400;
    this.at.copy(cam);
    this.atR.copy(rider);
    this.dirAt.set(dx, dz);
    let e: ArrayLike<number> | null = null;
    if (camera) {
      camera.updateMatrixWorld();
      this.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      e = this.vp.elements;
    }
    const n = this.people.length;
    if (this.imp && n > this.imp.cap) this.buildImpostors(Math.ceil(n * 1.4));
    const M = this.model;
    const MS = this.solid!;
    const I = this.imp;
    let n3 = 0, ns = 0, ni = 0, grow = false;
    for (let k = 0; k < n; k++) {
      const p = this.people[k];
      const ox = p.x - cam.x, oz = p.z - cam.z;
      const dC = Math.hypot(ox, oz);
      const dR = Math.hypot(p.x - rider.x, p.z - rider.z);
      const near = this.debugMode === 'auto' ? Math.min(dC, dR) : this.debugMode === '3d' ? 0 : 1e9;
      if (p.s3 === 0 && near < R_IN) { p.s3 = 1; p.t3 = cut ? now - FADE : now; }
      else if (p.s3 === 1 && near > R_OUT) { p.s3 = 0; p.t3 = cut ? now - FADE : now; }
      if (dC > FAR[1]) continue;
      // außerhalb des Bildausschnitts (Rand für Drehen und Fahren bis zum nächsten Mal): weglassen
      if (e) {
        const y = p.y + 0.9;
        const cw = e[3] * p.x + e[7] * y + e[11] * p.z + e[15];
        if (cw < 1) { if (dC > 4) continue; } else {
          const cx = e[0] * p.x + e[4] * y + e[8] * p.z + e[12];
          const cy = e[1] * p.x + e[5] * y + e[9] * p.z + e[13];
          if (Math.abs(cx) > 2 * cw + 4 || Math.abs(cy) > 1.5 * cw + 4) continue;
        }
      } else if (dir && dC > 14 && ox * dx + oz * dz < -0.3 * dC) continue;
      const fading = now - p.t3 < FADE;
      const dirK = p.s3 ? 1 : -1;
      if (p.s3 === 1 || fading) {
        // ganz da: deckendes Netz; beim Wechsel: Raster-Netz
        const B = fading ? M : MS;
        const i = fading ? n3 : ns;
        if (i < B.cap) {
          const o = i * PS3;
          B.data.set(this.src.subarray(k * PS, k * PS + PS), o);
          B.data[o + PS] = p.t3; B.data[o + PS + 1] = dirK; B.data[o + PS + 2] = 0; B.data[o + PS + 3] = 0;
          if (fading) n3++; else ns++;
        } else grow = true;
      }
      if (I && (p.s3 === 0 || fading)) {
        const o = ni * PSI;
        const D = I.data;
        D[o] = p.x; D[o + 1] = p.y; D[o + 2] = p.z; D[o + 3] = p.vs;
        // Takt wie gpCrowd (Bewegungszeit läuft mit 0,31 × eigenem Faktor), zwei Bilder je Takt; La-Ola: eigene Welle
        const fr7 = (p.phase * 7) % 1;
        const rate = p.act === Act.ola ? -1 : (ACT_F[p.act] ?? 1) * 0.31 * (0.9 + 0.25 * fr7);
        D[o + 4] = p.vi; D[o + 5] = p.phase; D[o + 6] = rate; D[o + 7] = p.yaw;
        D[o + 8] = p.t3; D[o + 9] = dirK; D[o + 10] = turns(p.act) ? 1 : 0; D[o + 11] = 0;
        ni++;
      }
    }
    // mehr Modelle als Platz: beim nächsten Mal mit größerem Netz
    if (grow) { this.buildModel(M.cap * 2); return; }
    M.geo.instanceCount = n3;
    M.mesh.visible = n3 > 0;
    M.buf.needsUpdate = true;
    MS.geo.instanceCount = ns;
    MS.mesh.visible = ns > 0;
    MS.buf.needsUpdate = true;
    if (I) {
      I.geo.instanceCount = ni;
      I.mesh.visible = ni > 0;
      I.buf.needsUpdate = true;
    }
  }

  /** Vorwärmen: beide Darstellungen einmal zeichnen */
  warm(on: boolean) {
    // noch keine Zuschauer: Netze trotzdem anlegen (Shader jetzt übersetzen, nicht beim ersten Fan)
    if (on && !this.model) this.buildModel(768);
    for (const b of [this.model, this.solid, this.imp]) {
      if (!b) continue;
      if (on) { b.geo.instanceCount = Math.max(1, b.geo.instanceCount); b.mesh.visible = true; }
    }
    if (!on) this.at.set(1e9, 0, 0);
  }

  dispose() {
    for (const b of [this.model, this.solid, this.imp]) if (b) { b.mesh.removeFromParent(); b.geo.dispose(); }
    this.base3.dispose();
    this.mat3.dispose();
    this.mat3s.dispose();
    this.impMat?.dispose();
    this.atlasTex?.dispose();
  }
}
