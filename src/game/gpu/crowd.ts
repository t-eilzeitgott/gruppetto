/**
 * Zuschauer im WebGPU-Test: dieselben Menschen wie im Spiel (crowd3d: Körper, Kleidung, Zubehör, Fahnen, Becher,
 * Teufelskostüm) an denselben Stellen (Zuschauerzonen hinter den Banden, Trauben in den Kehren, kleine Grüppchen am
 * Rand), mit denselben Bewegungen: klatschen, winken, jubeln und hüpfen, filmen, Fahne schwenken, anfeuern,
 * tanzen, La-Ola – und alle schauen dem Fahrer nach. Die Bewegung rechnet der Vertex-Shader (WGSL, übertragen aus
 * dem GLSL des Spiels); Kleidung aus einer Farbtabelle (Textur). Pappschilder wie im Spiel (Atlas der Banden).
 *
 * Alle Teile (Körper und alles Zubehör) liegen in einer Geometrie je Stufe; was jemand nicht trägt, faltet der
 * Shader weg. Stufen je Mensch nach Abstand (fein bis 16 m, einfach bis 45 m, Kasten-Menschen bis 320 m) – drei
 * Zeichenaufrufe für alle.
 */
import * as THREE from 'three/webgpu';
import { EDGE, SEG, type Seg, type Track } from '../abfahrt/track';
import { mulberry32 } from '../abfahrt/rng';
import { Act, CROWD_FLAGS, CROWD_NV, CROWD_PAL, KINDS, crowdGeometry, packPerson, randomPerson, STRIDE as PS, type Person, type Zone } from '../abfahrt/crowd3d';
import { adCell, SIGN_COUNT } from '../abfahrt/tex3d';
import { tsl, type N } from './nodes';
import { lit } from './light';
import { groundMap, lampLit, terrainSun } from './sunmap';

const { attribute, cameraPosition, cross, dFdx, dFdy, dot, float, floor, fract, int, ivec2, normalize, positionGeometry, positionWorld, select, sign, textureLoad, time, uniform, varying, vec3, wgslFn } = tsl;

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

function crowdMaterial(rider: N): THREE.MeshBasicNodeMaterial {
  // günstiges Licht (light.ts): Lambert eckig schattiert (Flächennormale aus den Ableitungen), vorberechnetes
  // Sonnenlicht (Berge, Bäume, Häuser), gemessenes Himmelslicht, Laternen
  const m = new THREE.MeshBasicNodeMaterial();
  const c = attribute('color', 'vec3');
  const i0 = attribute('aI0', 'vec4');
  const i1 = attribute('aI1', 'vec4');
  const i2 = attribute('aI2', 'vec4');
  const i3 = attribute('aI3', 'vec4');
  m.positionNode = place({ p: positionGeometry, c, i0, i1, i3, time, rider });
  // Farbe je Ecke (im Vertex-Shader): Fach → Farbe der Person
  const pal = paletteTexture();
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
  const vc = varying(col, 'vCrowdCol');
  const pw = positionWorld;
  const fn = normalize(cross(dFdx(pw), dFdy(pw)));
  const nW = fn.mul(sign(dot(fn, cameraPosition.sub(pw))));
  const g = groundMap(pw.xz);
  m.colorNode = lit({ col: vc, nWorld: nW, vis: terrainSun(pw.xz).mul(g.x), wrap: 0.25, ao: float(1.15), extra: lampLit(vc, g.w) });
  m.name = 'crowd';
  return m;
}

/** alle Teile (Körper und Zubehör) einer Stufe in einer Geometrie */
function mergedPerson(lod: 0 | 1): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], nor: number[] = [], idx: number[] = [];
  const dummy = new Float32Array(PS);
  // mittlere Stufe ohne seltenes Kleinzeug (Teufel, Rucksack, Zopf, Becher)
  const skip = lod === 1 ? new Set(['horns', 'trident', 'backpack', 'ponytail', 'cup', 'glasses', 'phone']) : new Set<string>();
  for (const k of KINDS) {
    if (skip.has(k)) continue;
    const g = crowdGeometry(k, lod, dummy, 1);
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

/**
 * Fernform (ab ~45 m): Kasten-Menschen mit denselben Teilnummern (Beine, Rumpf, Kopf, Arme) und der Fahne –
 * gut 120 Dreiecke statt 660. Farbfächer und Körperteile wie in crowd3d (S, P).
 */
function farPerson(): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const add = (g: THREE.BufferGeometry, slot: number, part: number) => {
    const o = pos.length / 3;
    const P = g.getAttribute('position');
    const C = g.getAttribute('color');
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      if (C) col.push(C.getX(i), C.getY(i), C.getZ(i)); else col.push(slot, part, 0);
    }
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + o);
  };
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, slot: number, part: number) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    add(g, slot, part);
  };
  for (const sg of [-1, 1]) box(sg * 0.1 - 0.065, 0, -0.07, sg * 0.1 + 0.065, 0.9, 0.07, 2, sg < 0 ? 14 : 16);
  box(-0.17, 0.86, -0.12, 0.17, 1.48, 0.12, 1, 0);
  box(-0.1, 1.5, -0.1, 0.1, 1.74, 0.11, 0, 5);
  box(-0.105, 1.66, -0.11, 0.105, 1.78, 0.08, 4, 5);
  for (const sg of [-1, 1]) box(sg * 0.25 - 0.05, 0.78, -0.05, sg * 0.25 + 0.05, 1.42, 0.05, 1, sg < 0 ? 1 : 3);
  const flag = crowdGeometry('flag', 1, new Float32Array(PS), 1);
  if (flag) add(flag, 0, 0);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}

/** Stufen: fein bis hier (m), einfach bis da, Kasten-Menschen bis dort */
// enger als früher (16/30/170): am Start stehen über hundert Menschen, die feine Stufe hat 1300 Dreiecke und wirft Schatten
const LOD_D = [11, 24, 150];

interface Group { geo: THREE.InstancedBufferGeometry; buf: THREE.InstancedInterleavedBuffer; data: Float32Array; mesh: THREE.Mesh }

/** Ground: Höhe des Straßenrands in Abstand dx vom Bankett (Querprofil) */
export type Ground = (s: Seg, sg: number, dx: number) => number;

export class Crowd {
  readonly group = new THREE.Group();
  readonly rider = uniform(new THREE.Vector3());
  private people: Person[] = [];
  private src = new Float32Array(0);
  private groups: Group[] = [];
  private mat: THREE.Material;
  private bases: THREE.BufferGeometry[];
  private at = new THREE.Vector3(1e9, 0, 0);
  /** Pappschilder (Quads im Atlas der Banden) */
  signs: { pos: number[]; uv: number[] } = { pos: [], uv: [] };

  constructor() {
    this.mat = crowdMaterial(this.rider);
    this.bases = [mergedPerson(0), mergedPerson(1), farPerson()];
  }

  get count() { return this.people.length; }

  /** Zuschauer aus den Requisiten der Strecke (wie im Spiel: render3d.crowdPeople) */
  build(track: Track, ground: Ground, lim: (i: number, sg: number) => number, i0: number, i1: number) {
    this.addRange(track, ground, lim, i0, i1 + 1);
  }

  /** Strecke (m) je Mensch – für das Abbauen hinter dem Fahrer */
  private atZ: number[] = [];
  private cap = 0;

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
      for (const sp of s.sprites ?? []) {
        if (sp.k !== 'crowd') continue;
        const sg = sp.x < 0 ? -1 : 1;
        const before = this.people.length;
        this.crowdPeople(track, ground, s, sg, lim(i, sg), sp.v ?? 0, Math.abs(sp.x) - EDGE);
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
    const people: Person[] = [];
    const atZ: number[] = [];
    this.people.forEach((p, k) => { if (keep(this.atZ[k])) { people.push(p); atZ.push(this.atZ[k]); } });
    if (people.length === n) return;
    this.people = people;
    this.atZ = atZ;
    this.signs = { pos: [], uv: [] };
    this.repack();
  }

  /** Daten aller Menschen neu packen; Gruppen wachsen bei Bedarf */
  private repack(from = 0) {
    const n = this.people.length;
    const old = this.src;
    this.src = new Float32Array(Math.max(1, n) * PS);
    // nur die neuen packen (beim Nachladen kommen Menschen hinten dazu; die alten Daten bleiben gleich)
    if (from > 0 && old.length >= from * PS) this.src.set(old.subarray(0, from * PS));
    else from = 0;
    for (let k = from; k < n; k++) packPerson(this.people[k], this.src, k);
    this.at.set(1e9, 0, 0);
    if (n <= this.cap && this.groups.length) return;
    for (const g of this.groups) { g.mesh.removeFromParent(); g.geo.dispose(); }
    this.groups = [];
    this.cap = Math.max(64, Math.ceil(n * 1.5));
    // nur Menschen nahe der Kamera stehen in den Gruppen: kein Wegschneiden als Ganzes
    const sphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    for (let lod = 0; lod < 3; lod++) {
      const base = this.bases[lod];
      const geo = new THREE.InstancedBufferGeometry();
      geo.setIndex(base.index);
      for (const k of ['position', 'color', 'normal']) geo.setAttribute(k, base.getAttribute(k));
      const data = new Float32Array(this.cap * PS);
      const buf = new THREE.InstancedInterleavedBuffer(data, PS, 1);
      buf.setUsage(THREE.DynamicDrawUsage);
      for (let k = 0; k < 4; k++) geo.setAttribute(`aI${k}`, new THREE.InterleavedBufferAttribute(buf, 4, k * 4));
      geo.instanceCount = 0;
      geo.boundingSphere = sphere;
      const mesh = new THREE.Mesh(geo, this.mat);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.castShadow = lod === 0;
      mesh.receiveShadow = true;
      mesh.visible = false;
      this.group.add(mesh);
      this.groups.push({ geo, buf, data, mesh });
    }
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
        const p = randomPerson(r, zone, { row: ri, kid });
        if (!s.crowd && p.act === Act.lean) p.act = Act.idle;
        if (group && r() < 0.2) p.act = Act.sign;
        if (ri === 0 && !kid && !group && r() < 0.05) p.act = Act.sign;
        if (p.act === Act.sign) { u += 0.4; if (u >= end) break; }
        if (p.act === Act.sign && p.hatType === 5) p.act = Act.devil;
        if (p.act === Act.sign) p.cup = false;
        if (ola && p.act !== Act.sign && p.act !== Act.flag && p.act !== Act.devil && r() < 0.85) {
          p.act = Act.ola;
          p.phase = ((s.i * SEG + u) * 0.03) / 37;
        }
        placeAt(p, u, dx);
        out.push(p);
        if (p.act === Act.sign) this.signBoard(p, r);
        if (ri > 0 && !kid && p.act !== Act.sign && p.act !== Act.devil && r() < 0.05) {
          p.act = Act.hold;
          p.cup = false;
          const c = randomPerson(r, zone, { row: ri, kid: true });
          c.act = Act.sit;
          c.height = 0.56 + r() * 0.06;
          c.yaw = p.yaw;
          c.x = p.x - Math.sin(p.yaw) * 0.1 * p.height;
          c.z = p.z - Math.cos(p.yaw) * 0.1 * p.height;
          c.y = p.y + 1.47 * p.height - 0.9 * c.height;
          out.push(c);
        }
        const wide = p.act === Act.flag ? 0.4 : p.act === Act.sign ? 0.75 : p.act === Act.wave ? 0.12 : 0;
        u += step[0] + wide + r() * step[1] + (!group && r() < 0.06 ? 0.5 + r() * 0.7 : 0);
      }
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

  /** Stufen je Mensch nach Abstand (neu, wenn die Kamera 3 m weiter ist) */
  update(cam: THREE.Vector3, rider: THREE.Vector3, force = false) {
    this.rider.value.copy(rider);
    if (!this.groups.length || (!force && this.at.distanceToSquared(cam) < 9)) return;
    this.at.copy(cam);
    const cnt = [0, 0, 0];
    const n = this.people.length;
    for (let k = 0; k < n; k++) {
      const p = this.people[k];
      const d = Math.hypot(p.x - cam.x, p.z - cam.z);
      if (d > LOD_D[2]) continue;
      const lod = d < LOD_D[0] ? 0 : d < LOD_D[1] ? 1 : 2;
      const g = this.groups[lod];
      g.data.set(this.src.subarray(k * PS, k * PS + PS), cnt[lod] * PS);
      cnt[lod]++;
    }
    this.groups.forEach((g, lod) => {
      g.geo.instanceCount = cnt[lod];
      g.mesh.visible = cnt[lod] > 0;
      g.buf.needsUpdate = true;
    });
  }

  /** Vorwärmen: beide Stufen einmal zeichnen */
  warm(on: boolean) {
    // noch keine Zuschauer: Gruppen trotzdem anlegen (Shader jetzt übersetzen, nicht beim ersten Fan)
    if (on && !this.groups.length) this.repack();
    for (const g of this.groups) {
      if (on) { g.geo.instanceCount = Math.max(1, g.geo.instanceCount); g.mesh.visible = true; }
    }
    if (!on) this.at.set(1e9, 0, 0);
  }

  dispose() {
    for (const g of this.groups) { g.mesh.removeFromParent(); g.geo.dispose(); }
    for (const b of this.bases) b.dispose();
    this.mat.dispose();
  }
}
