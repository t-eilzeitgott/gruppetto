/**
 * Zuschauer als echte 3D-Menschen.
 *
 * Alle Zuschauer eines Streckenabschnitts teilen sich eine Geometrie und werden als Instanzen
 * gezeichnet. Bewegung (Klatschen, Winken, Jubeln, Filmen, Fahnen schwenken, Laufen), Blick zum
 * Fahrer, Größe, Statur und Kleidung kommen pro Instanz aus Attributen und werden im Vertex-Shader
 * berechnet – so bleiben auch hunderte Menschen flüssig.
 */
import * as THREE from 'three';
import { lin, type RGBf } from './models3d';

// ------------------------------------------------------------------ Farben

const hexes = (list: string[]) => list.map((h) => lin(h));

/** Farbtabelle für den Shader; die Bereiche unten zeigen hinein */
const PAL_SRC = {
  skin: ['#f6d7bd', '#eac3a2', '#d8a77f', '#bf8a62', '#9a6544', '#6e4630'],
  top: ['#1f2a44', '#26272b', '#f3f3f1', '#8d929a', '#c0392b', '#e8478f', '#ff8fc0', '#f1c40f', '#2e86de', '#2f9e5a',
    '#e67e22', '#6c4fd8', '#169c88', '#d8c8aa', '#5f6f35', '#7d1f2a', '#55aee8', '#ffffff', '#ff5fa2', '#0b5394'],
  bottom: ['#2c3e50', '#3d5a80', '#1c1c1e', '#6b6e73', '#bfae80', '#4b3a2a', '#e9e6df', '#2d3b2a'],
  hair: ['#17120f', '#3b2a1e', '#6a4a2c', '#a8763e', '#d9c08a', '#8f8f8f', '#e3e1dc', '#7a2e14'],
};
const PAL: RGBf[] = [];
const RANGE: Record<keyof typeof PAL_SRC, [number, number]> = { skin: [0, 0], top: [0, 0], bottom: [0, 0], hair: [0, 0] };
for (const k of Object.keys(PAL_SRC) as (keyof typeof PAL_SRC)[]) {
  RANGE[k] = [PAL.length, PAL_SRC[k].length];
  PAL.push(...hexes(PAL_SRC[k]));
}
const PINK = RANGE.top[0] + 5;
const PINK2 = RANGE.top[0] + 18;
const WHITE = RANGE.top[0] + 17;

/** Fahnen: drei Streifen; die ersten senkrecht (vom Mast aus), dann waagrecht (von oben) */
const FLAGS_V: string[][] = [
  ['#009246', '#f4f5f0', '#ce2b37'], // Italien
  ['#009246', '#f4f5f0', '#ce2b37'],
  ['#0055a4', '#f4f5f0', '#ef4135'], // Frankreich
  ['#1b1b1b', '#fdda24', '#ef3340'], // Belgien
  ['#169b62', '#f4f5f0', '#ff883e'], // Irland
  ['#f36fa8', '#f36fa8', '#f36fa8'], // Rosa (Giro)
  ['#002b7f', '#fcd116', '#ce1126'], // Rumänien
];
const FLAGS_H: string[][] = [
  ['#1b1b1b', '#dd0000', '#ffce00'], // Deutschland
  ['#ae1c28', '#f4f5f0', '#21468b'], // Niederlande
  ['#fcd116', '#003893', '#ce1126'], // Kolumbien
  ['#aa151b', '#f1bf00', '#aa151b'], // Spanien
  ['#fdb913', '#006a44', '#c1272d'], // Litauen
  ['#ed2939', '#f4f5f0', '#ed2939'], // Österreich
  ['#ed2939', '#f4f5f0', '#00a1de'], // Luxemburg
  ['#f4f5f0', '#00966e', '#d62612'], // Bulgarien
];
const NV = FLAGS_V.length;
const FLAG_COLS: RGBf[] = [...FLAGS_V, ...FLAGS_H].flatMap((f) => hexes(f));
const NFLAGS = NV + FLAGS_H.length;

// ------------------------------------------------------------------ Geometrie

/** Farbfächer (welche Farbe ein Teil bekommt) */
const S = { skin: 0, top: 1, bottom: 2, shoes: 3, hair: 4, hat: 5, accent: 6, lowerLeg: 7, forearm: 8, dark: 9, pole: 10, flag: 11 } as const;
/** Körperteile (wie sie sich bewegen) */
const P = {
  body: 0, armAU: 1, armAF: 2, armBU: 3, armBF: 4, head: 5, cap: 6, sunhat: 7, beanie: 8, longHair: 9, glasses: 10,
  phone: 11, pole: 12, flag: 13, legAU: 14, legAL: 15, legBU: 16, legBL: 17,
} as const;

/** Baukasten für indizierte Geometrie; doppelte Eckpunkte einer Grundform werden zusammengelegt */
class IB {
  p: number[] = [];
  c: number[] = [];
  idx: number[] = [];
  get empty() { return this.idx.length === 0; }
  add(g: THREE.BufferGeometry, m: THREE.Matrix4, slot: number, part: number, extra = 0, flip = false) {
    const pos = g.getAttribute('position');
    const v = new THREE.Vector3();
    const seen = new Map<string, number>();
    const remap: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      const key = `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;
      let k = seen.get(key);
      if (k === undefined) {
        k = this.p.length / 3;
        this.p.push(v.x, v.y, v.z);
        this.c.push(slot, part, extra);
        seen.set(key, k);
      }
      remap.push(k);
    }
    const ix = g.index ? Array.from(g.index.array) : [...Array(pos.count).keys()];
    for (let i = 0; i < ix.length; i += 3) {
      const t0 = remap[ix[i]];
      const t1 = remap[ix[i + 1]];
      const t2 = remap[ix[i + 2]];
      if (t0 === t1 || t1 === t2 || t0 === t2) continue;
      if (flip) this.idx.push(t0, t2, t1); else this.idx.push(t0, t1, t2);
    }
    g.dispose();
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

const M = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

/** Körper für alle, Zubehör nur für die, die es tragen */
export const KINDS = ['body', 'cap', 'sunhat', 'beanie', 'longHair', 'glasses', 'phone', 'flag'] as const;
export type Kind = typeof KINDS[number];

/** Ein Mensch (oder sein Zubehör), 1,75 m, Blick nach +z. lod 1 = vereinfacht für die Ferne */
function personGeometry(kind: Kind, lod: 0 | 1): THREE.BufferGeometry | null {
  const b = new IB();
  const n = lod ? 5 : 7;
  const cyl = (r0: number, r1: number, h: number, seg = n, open = true) => new THREE.CylinderGeometry(r0, r1, h, seg, 1, open);
  const ball = (w: number, h: number) => new THREE.SphereGeometry(1, w, h);
  const cap = (w: number, h: number, part = 0.5) => new THREE.SphereGeometry(1, w, h, 0, Math.PI * 2, 0, Math.PI * part);
  const lathe = (pts: [number, number][], seg: number) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

  if (kind === 'body') {
    // Beine mit Schuhen
    for (const sg of [-1, 1]) {
      const U = sg < 0 ? P.legAU : P.legBU;
      const L = sg < 0 ? P.legAL : P.legBL;
      b.add(cyl(0.086, 0.066, 0.44), M(sg * 0.1, 0.68, 0), S.bottom, U);
      b.add(cyl(0.064, 0.05, 0.44), M(sg * 0.1, 0.27, 0), S.lowerLeg, L);
      if (!lod) b.add(new THREE.BoxGeometry(0.1, 0.08, 0.25), M(sg * 0.1, 0.04, 0.045), S.shoes, L);
    }
    // Becken, Oberkörper mit Brustband, Hals
    const ts = lod ? 6 : 9;
    b.add(new THREE.CylinderGeometry(0.16, 0.176, 0.22, ts, 1, false), M(0, 0.92, 0, 1, 1, 0.68), S.bottom, P.body);
    b.add(lathe([[0.172, 0.99], [0.185, 1.12]], ts), M(0, 0, 0, 1, 1, 0.7), S.top, P.body);
    b.add(lathe([[0.185, 1.12], [0.194, 1.2]], ts), M(0, 0, 0, 1, 1, 0.7), S.accent, P.body);
    b.add(lathe([[0.194, 1.2], [0.206, 1.32], [0.214, 1.4], [0.15, 1.475], [0.05, 1.5]], ts), M(0, 0, 0, 1, 1, 0.68), S.top, P.body);
    b.add(cyl(0.048, 0.055, 0.1, 6), M(0, 1.52, 0), S.skin, P.body);
    // Kopf, Nase, Haare
    b.add(lod ? ball(6, 4) : ball(8, 6), M(0, 1.635, 0.005, 0.096, 0.115, 0.104), S.skin, P.head);
    if (!lod) b.add(new THREE.ConeGeometry(0.019, 0.04, 4), M(0, 1.622, 0.112, 1, 1, 1, Math.PI / 2), S.skin, P.head);
    b.add(lod ? cap(6, 3) : cap(8, 4), M(0, 1.648, -0.01, 0.104, 0.12, 0.112, -0.38), S.hair, P.head);
    if (!lod) for (const sg of [-1, 1]) b.add(new THREE.BoxGeometry(0.02, 0.014, 0.012), M(sg * 0.036, 1.652, 0.098), S.dark, P.head);
    // Arme: an der Schulter hängend
    for (const sg of [-1, 1]) {
      const U = sg < 0 ? P.armAU : P.armBU;
      const F = sg < 0 ? P.armAF : P.armBF;
      if (!lod) b.add(ball(6, 4), M(sg * 0.228, 1.39, 0, 0.072, 0.072, 0.072), S.top, U);
      b.add(cyl(0.062, 0.052, 0.31, n - 1), M(sg * 0.25, 1.255, 0), S.top, U);
      b.add(cyl(0.05, 0.04, 0.27, n - 1), M(sg * 0.25, 0.975, 0), S.forearm, F);
      b.add(lod ? new THREE.BoxGeometry(0.07, 0.1, 0.06) : ball(6, 4), lod ? M(sg * 0.25, 0.815) : M(sg * 0.25, 0.81, 0.008, 0.044, 0.058, 0.04), S.skin, F);
    }
  }
  if (kind === 'longHair') b.add(new THREE.BoxGeometry(0.2, 0.27, 0.06), M(0, 1.5, -0.088), S.hair, P.longHair);
  // Kopfbedeckungen: Kappe, Sonnenhut, Mütze
  if (kind === 'cap') {
    b.add(cap(lod ? 6 : 8, 3), M(0, 1.668, -0.005, 0.11, 0.075, 0.12, -0.15), S.hat, P.cap);
    b.add(new THREE.BoxGeometry(0.17, 0.016, 0.13), M(0, 1.675, 0.145, 1, 1, 1, 0.18), S.hat, P.cap);
  }
  if (kind === 'sunhat') {
    b.add(cyl(0.21, 0.21, 0.012, lod ? 7 : 10, false), M(0, 1.7, 0), S.hat, P.sunhat);
    b.add(cyl(0.1, 0.112, 0.11, lod ? 6 : 8, false), M(0, 1.755, 0), S.hat, P.sunhat);
    if (!lod) b.add(cyl(0.114, 0.114, 0.026, 8), M(0, 1.715, 0), S.accent, P.sunhat);
  }
  if (kind === 'beanie') {
    b.add(cap(lod ? 6 : 8, lod ? 3 : 4), M(0, 1.655, -0.006, 0.11, 0.135, 0.118, -0.1), S.hat, P.beanie);
    b.add(ball(5, 3), M(0, 1.795, -0.012, 0.038, 0.038, 0.038), S.accent, P.beanie);
  }
  if (kind === 'glasses' && !lod) b.add(new THREE.BoxGeometry(0.17, 0.034, 0.02), M(0, 1.648, 0.108), S.dark, P.glasses);
  // Handy (rechte Hand) – zeigt nach vorn, sobald der Arm gehoben ist
  if (kind === 'phone' && !lod) b.add(new THREE.BoxGeometry(0.072, 0.012, 0.14), M(0.25, 0.785, 0.035), S.dark, P.phone);
  // Fahne am Stock (rechte Hand)
  if (kind === 'flag') {
    b.add(cyl(0.013, 0.013, 1.42, 4), M(0.252, 0.27, 0), S.pole, P.pole);
    const FW = 0.84;
    const FH = 0.56;
    const top = -0.42;
    for (let col = 0; col < 3; col++) {
      for (let row = 0; row < 3; row++) {
        const w = FW / 3;
        const h = FH / 3;
        const pg = new THREE.PlaneGeometry(w, h, lod ? 1 : 2, 1);
        const m = M(0.24 - w * (col + 0.5), top + h * (row + 0.5), 0);
        b.add(pg.clone(), m, S.flag, P.flag, col + 3 * row);
        b.add(pg, m, S.flag, P.flag, col + 3 * row, true);
      }
    }
  }
  if (b.empty) return null;
  const g = b.build();
  // Detailstufe der Grundform (der Shader blendet je Person zwischen den Stufen über)
  g.setAttribute('aLod', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(lod), 1));
  return g;
}

// ------------------------------------------------------------------ Shader

const VERT_HEAD = /* glsl */ `
attribute vec4 aI0; // Position xyz, Grundrichtung
attribute vec4 aI1; // Größe, Breite, Aktion, Phase
attribute vec4 aI2; // Farben: Haut, Oberteil, Hose, Haare
attribute vec4 aI3; // Farben: Hut, Hutform, Akzent, Fahne + 16*Merkmale
attribute float aLod; // Detailstufe der Grundform
varying float vXa;    // sichtbar, wo die Rasterschwelle in [vXa, vXb) liegt
varying float vXb;
uniform float uTime;
uniform vec3 uRider;
uniform vec3 uPal[${PAL.length}];
uniform vec3 uFlag[${FLAG_COLS.length}];
vec3 rX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
vec3 rY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c); }
vec3 rZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z); }
float bit(float v, float b) { return mod(floor(v / b), 2.0); }
const float TAU = 6.28318;

// Armhaltung je Arm: x = seitlich heben, y = nach vorn heben, z = Ellbogen beugen, w = zur Mitte schwenken
void armPose(float act, float t, float e, out vec4 A, out vec4 B, out vec4 legs, out vec3 body) {
  vec4 idleA = vec4(0.08 + 0.03 * sin(t * 0.9), 0.1 + 0.06 * sin(t * 0.7 + 1.0), 0.3, 0.05);
  vec4 idleB = vec4(0.08 + 0.03 * sin(t * 0.8 + 2.0), 0.1 + 0.06 * sin(t * 0.6), 0.3, 0.05);
  // feste Takte: die Nähe zum Fahrer ändert nur die Stärke, nie das Tempo
  // (ein Takt, der von der Entfernung abhängt, rast beim Näherkommen)
  float c = 0.5 + 0.5 * sin(t * TAU * 2.0);
  vec4 clap = vec4(0.0, 0.95 + 0.85 * e, 1.35 - 0.6 * e, 0.14 + 0.3 * c);
  legs = vec4(0.0);
  body = vec3(0.0); // Hüpfen, Vorlage, Kopfnicken
  A = idleA; B = idleB;
  float ex = smoothstep(0.15, 0.75, e);
  if (act < 0.5) {            // ruhig – klatscht, wenn der Fahrer vorbeikommt
    A = mix(idleA, clap, ex * 0.9); B = mix(idleB, clap, ex * 0.9);
  } else if (act < 1.5) {     // klatschen
    A = clap; B = clap;
  } else if (act < 2.5) {     // winken
    float w = sin(t * TAU * 1.3);
    B = vec4(2.35 + 0.42 * w, 0.2, 0.35 + 0.25 * w, 0.0);
    A = mix(idleA, clap, ex * 0.5);
  } else if (act < 3.5) {     // jubeln, mit Hüpfen
    float f = 1.45;
    float pump = 0.5 + 0.5 * sin(t * TAU * f);
    float up = 0.8 + 1.95 * smoothstep(0.0, 0.6, e);
    A = vec4(up + 0.12 * pump, 0.25, 0.12 + 0.45 * pump * (0.3 + 0.7 * e), 0.0);
    B = vec4(up + 0.12 * (1.0 - pump), 0.25, 0.12 + 0.45 * (1.0 - pump) * (0.3 + 0.7 * e), 0.0);
    body.x = max(0.0, sin(t * TAU * f)) * 0.15 * ex;
  } else if (act < 4.5) {     // filmt mit dem Handy
    B = vec4(0.0, 1.42 + 0.03 * sin(t * 1.3), 0.42, 0.28);
    A = vec4(0.0, 1.2, 1.05, 0.45);
  } else if (act < 5.5) {     // Fahne schwenken (Takte passen in 2 Zeiteinheiten: Schleife ohne Sprung)
    B = vec4(2.62 + (0.2 + 0.12 * e) * sin(t * TAU * 0.5), 0.1, 0.12, 0.0);
    float pump = 0.5 + 0.5 * sin(t * TAU * 1.5);
    A = mix(idleA, vec4(2.4, 0.2, 0.35 + 0.8 * pump, 0.0), ex);
  } else if (act < 6.5) {     // anfeuern: zeigen und rufen
    vec4 pt = vec4(0.1, 1.7 + 0.16 * sin(t * TAU * 1.0), 0.12, 0.1);
    B = mix(idleB, pt, 0.35 + 0.65 * ex);
    A = mix(idleA, vec4(0.0, 1.45, 2.35, 1.1), 0.35 + 0.65 * ex);
    body.z = 0.1 * ex * sin(t * TAU * 1.0);
  } else if (act > 14.5 && act < 15.5) {   // springt mit beiden Armen in der Luft
    float hop = max(0.0, sin(t * TAU * 1.25));
    float land = max(0.0, -sin(t * TAU * 1.25));
    vec4 up = vec4(2.45 + 0.3 * hop, 0.35, 0.2 + 0.5 * land, 0.0);
    A = up; B = up;
    body.x = hop * 0.32;
    legs = vec4(0.25 * land, 0.15 + 0.9 * land, 0.25 * land, 0.15 + 0.9 * land);
  } else if (act > 15.5 && act < 16.5) {   // La-Ola: Arme hoch, wenn die Welle vorbeikommt
    float w = fract(t / 1.2);
    float k = smoothstep(0.0, 0.12, w) * (1.0 - smoothstep(0.24, 0.42, w));
    vec4 up = vec4(2.8, 0.15, 0.12, 0.0);
    A = mix(idleA, up, k); B = mix(idleB, up, k);
    body.x = k * 0.14;
    legs = vec4(0.0, 0.35 * (1.0 - k) * smoothstep(0.5, 0.95, w), 0.0, 0.35 * (1.0 - k) * smoothstep(0.5, 0.95, w));
  } else if (act > 16.5) {   // tanzt: Hüften schwingen, Arme über dem Kopf im Takt
    float s1 = sin(t * TAU * 1.0);
    A = vec4(2.2 + 0.35 * s1, 0.3, 0.5 + 0.3 * s1, 0.1);
    B = vec4(2.2 - 0.35 * s1, 0.3, 0.5 - 0.3 * s1, 0.1);
    body.x = abs(s1) * 0.06;
    body.z = 0.08 * s1;
    legs = vec4(0.12 * s1, 0.2 + 0.2 * max(0.0, s1), -0.12 * s1, 0.2 + 0.2 * max(0.0, -s1));
  } else if (act < 7.5) {     // hält ein Kind auf den Schultern
    A = vec4(0.0, 0.55, 1.75, 0.2); B = A;
  } else if (act < 9.5 || act > 12.5) {     // läuft (8/9) oder joggt (13/14) neben dem Fahrer her
    float jog = act > 12.5 ? 1.0 : 0.0;
    float r = t * TAU * (jog > 0.5 ? 1.55 : 2.35);
    float s = sin(r) * (jog > 0.5 ? 0.75 : 1.0);
    A = vec4(0.12, 0.75 * s, 1.5, 0.15);
    float fl = abs(act - 9.0) < 0.1 || abs(act - 14.0) < 0.1 ? 1.0 : 0.0;
    B = fl < 0.5 ? vec4(0.12, -0.75 * s, 1.5, 0.15) : vec4(2.6 + 0.12 * s, 0.1, 0.12, 0.0);
    legs = vec4(-0.7 * s, 0.25 + 1.0 * max(0.0, cos(r)), 0.7 * s, 0.25 + 1.0 * max(0.0, -cos(r)));
    body.x = abs(s) * 0.06;
    body.y = 0.2;
  } else if (act < 10.5) {    // Kind sitzt auf den Schultern
    float pump = 0.5 + 0.5 * sin(t * TAU * 1.4);
    A = vec4(0.6 + 2.0 * ex, 0.3, 0.4 + 0.7 * pump, 0.0);
    B = vec4(0.6 + 2.0 * ex, 0.3, 0.4 + 0.7 * (1.0 - pump), 0.0);
    legs = vec4(1.35, 1.45, 1.35, 1.45);
  } else if (act > 11.5 && act < 12.5) {    // hält ein Pappschild hoch
    A = vec4(0.12, 2.5, 0.42, 0.42); B = A;
  } else {                    // lehnt an der Absperrung
    vec4 lean = vec4(0.0, 0.62, 0.55, 0.12);
    A = mix(lean, clap, ex); B = mix(lean, clap, ex);
    body.y = 0.1 * (1.0 - ex);
  }
}
`;

const VERT_BEGIN = /* glsl */ `
#ifndef CROWD_BAKE
  {
    // Detailstufen je Person: fein bis ~14 m, einfach bis ~30 m, dahinter Bilder. Übergänge mit einem Raster
    // je Bildpunkt: die Stufen teilen sich die Bildpunkte (nichts wird halb durchsichtig, nichts springt)
    float dCam = distance(aI0.xz, cameraPosition.xz);
    float f0 = 1.0 - smoothstep(16.0, 22.0, dCam);
    float g0 = 1.0 - smoothstep(46.0, 54.0, dCam);
  #ifdef CROWD_ALWAYS
    // Läufer: immer fein; tauchen sie weit voraus auf, blenden sie weich ein
    vXa = 0.0; vXb = 1.0 - smoothstep(106.0, 124.0, dCam);
  #else
    if (aLod < 0.5) { vXa = 0.0; vXb = f0; } else { vXa = f0; vXb = g0; }
  #endif
    if (vXb <= vXa) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  }
#endif
  vec3 transformed = vec3(position);
  float part = color.g;
  float act = aI1.z;
  float ph = aI1.w;
  // gemächlich: echte Zuschauer bewegen sich langsamer, als man denkt (Hüpfen und Jubeln halb so schnell)
#ifdef CROWD_BAKE
  // Vorrat an Bildern (2D-Zuschauer): Zeitpunkt direkt, feste Begeisterung, Blick geradeaus
  float t = ph;
#else
  float t = uTime * 0.31 * (0.9 + 0.25 * fract(ph * 7.0)) + ph * 37.0;
  // La-Ola: alle im gleichen Takt, die Phase kommt vom Ort (die Welle läuft die Straße entlang)
  if (act > 15.5 && act < 16.5) t = uTime * 0.31 + ph * 37.0;
#endif
  vec2 toR = uRider.xz - aI0.xz;
  float dist = length(toR);
#ifdef CROWD_BAKE
  float e = aI2.x; // beim Vorrat: Begeisterung je Bild (statt Hautfarbe)
#else
  float e = 1.0 - smoothstep(5.0, 48.0, dist);
#endif
  float feat = floor(aI3.w / 16.0);
  vec4 A; vec4 B; vec4 legs; vec3 body;
  armPose(act, t, e, A, B, legs, body);

  // nicht benötigte Teile verschwinden
  bool hide = false;
  if (part > 5.5 && part < 6.5) hide = abs(aI3.y - 1.0) > 0.1;
  else if (part > 6.5 && part < 7.5) hide = abs(aI3.y - 2.0) > 0.1;
  else if (part > 7.5 && part < 8.5) hide = abs(aI3.y - 3.0) > 0.1;
  else if (part > 8.5 && part < 9.5) hide = bit(feat, 4.0) < 0.5;
  else if (part > 9.5 && part < 10.5) hide = bit(feat, 8.0) < 0.5;
  else if (part > 10.5 && part < 11.5) hide = abs(act - 4.0) > 0.1;
  else if (part > 11.5 && part < 13.5) hide = abs(act - 5.0) > 0.1 && abs(act - 9.0) > 0.1 && abs(act - 14.0) > 0.1;

  // Fahne flattert
  if (part > 12.5 && part < 13.5) {
    float d = abs(transformed.x - 0.252);
    transformed.z += sin(d * 7.0 - t * 14.0 + transformed.y * 2.0) * 0.09 * d * 1.4;
    transformed.y += sin(d * 5.0 - t * 10.0) * 0.03 * d;
  }

  // Arme
  bool armA = part > 0.5 && part < 2.5;
  bool armB = (part > 2.5 && part < 4.5) || (part > 10.5 && part < 13.5);
  if (armA || armB) {
    float sg = armA ? -1.0 : 1.0;
    vec4 P = armA ? A : B;
    vec3 Sh = vec3(sg * 0.228, 1.39, 0.0);
    vec3 El = vec3(sg * 0.25, 1.105, 0.0);
    bool fore = (part > 1.5 && part < 2.5) || part > 3.5;
    vec3 q = transformed;
    if (fore) q = El + rX(q - El, -P.z);
    transformed = Sh + rZ(rY(rX(q - Sh, -P.y), -sg * P.w), sg * P.x);
  }
  // Beine
  if (part > 13.5) {
    float sg = part < 15.5 ? -1.0 : 1.0;
    float swing = part < 15.5 ? legs.x : legs.z;
    float knee = part < 15.5 ? legs.y : legs.w;
    vec3 Hp = vec3(sg * 0.1, 0.9, 0.0);
    vec3 Kn = vec3(sg * 0.1, 0.46, 0.0);
    vec3 q = transformed;
    bool lower = part > 14.5 && part < 15.5 || part > 16.5;
    if (lower) q = Kn + rX(q - Kn, knee);
    float spread = act > 9.5 && act < 10.5 ? sg * 0.55 : 0.0;
    transformed = Hp + rZ(rX(q - Hp, -swing), spread);
  }
  // Kopf dreht sich zum Fahrer
  float base = aI0.w;
  float target = atan(toR.x, toR.y);
  float delta = target - base;
  delta = mod(delta + 3.14159, 6.28318) - 3.14159;
  float att = (act > 7.5 && act < 9.5) || act > 11.5 ? 0.0 : 1.0 - smoothstep(30.0, 150.0, dist);
#ifdef CROWD_BAKE
  att = 0.0;
#endif
  float bodyTurn = clamp(delta, -1.05, 1.05) * 0.65 * att;
  float headTurn = clamp(delta - bodyTurn, -0.85, 0.85) * att + (1.0 - att) * 0.4 * sin(t * 0.33 + ph * 20.0);
#ifdef CROWD_BAKE
  headTurn = 0.0;
#endif
  bool head = part > 4.5 && part < 10.5;
  if (head) {
    vec3 Nk = vec3(0.0, 1.5, 0.0);
    float kid = 1.0 - smoothstep(0.68, 0.88, aI1.x);
    vec3 q = (transformed - Nk) * (1.0 + 0.28 * kid);
    transformed = Nk + rY(rX(q, body.z - 0.06 * e), headTurn);
  }
  if (hide) transformed = vec3(0.0);
  // ganzer Körper: Vorlage, Hüpfen, Statur, Richtung, Ort
  transformed = rX(transformed, body.y);
  transformed.y += body.x;
  transformed *= vec3(aI1.x * aI1.y, aI1.x, aI1.x * aI1.y);
  transformed = rY(transformed, base + bodyTurn) + aI0.xyz;
`;

const VERT_COLOR = /* glsl */ `
  {
    float slot = color.r;
    float feat = floor(aI3.w / 16.0);
    float flagI = mod(aI3.w, 16.0);
    vec3 skin = uPal[int(aI2.x + 0.5)];
    vec3 top = uPal[int(aI2.y + 0.5)];
    vec3 bottom = uPal[int(aI2.z + 0.5)];
    vec3 col = skin;
    if (slot > 0.5 && slot < 1.5) col = top;
    else if (slot < 2.5 && slot > 1.5) col = bottom;
    else if (slot < 3.5 && slot > 2.5) col = fract(aI1.w * 17.0) > 0.45 ? vec3(0.82) : vec3(0.035);
    else if (slot < 4.5 && slot > 3.5) col = uPal[int(aI2.w + 0.5)];
    else if (slot < 5.5 && slot > 4.5) col = uPal[int(aI3.x + 0.5)];
    else if (slot < 6.5 && slot > 5.5) col = bit(feat, 16.0) > 0.5 ? uPal[int(aI3.z + 0.5)] : top;
    else if (slot < 7.5 && slot > 6.5) col = bit(feat, 1.0) > 0.5 ? skin : bottom;
    else if (slot < 8.5 && slot > 7.5) col = bit(feat, 2.0) > 0.5 ? top : skin;
    else if (slot < 9.5 && slot > 8.5) col = vec3(0.012);
    else if (slot < 10.5 && slot > 9.5) col = vec3(0.32, 0.22, 0.12);
    else if (slot > 10.5) {
      float x = mod(color.b, 3.0);
      float y = floor(color.b / 3.0 + 0.01);
      float stripe = flagI < ${NV}.0 - 0.5 ? x : y;
      col = uFlag[int(flagI * 3.0 + stripe + 0.5)];
    }
    vColor = vColor * 0.0 + 1.0; // vec3 oder vec4, je nach three-Version
    vColor.rgb = col;
  }
`;

export interface CrowdUniforms { uTime: { value: number }; uRider: { value: THREE.Vector3 } }

/** always: ohne Detailstufen (Läufer neben dem Fahrer – immer fein, immer sichtbar) */
export function crowdMaterial(u: CrowdUniforms, always = false): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const pal = new Float32Array(PAL.flat());
  const flags = new Float32Array(FLAG_COLS.flat());
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = u.uTime;
    sh.uniforms.uRider = u.uRider;
    sh.uniforms.uPal = { value: pal };
    sh.uniforms.uFlag = { value: flags };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${always ? '#define CROWD_ALWAYS\n' : ''}${VERT_HEAD}`)
      .replace('#include <color_vertex>', VERT_COLOR)
      .replace('#include <begin_vertex>', VERT_BEGIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vXa;\nvarying float vXb;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        { float dth = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); if (dth < vXa || dth >= vXb) discard; }`);
  };
  m.customProgramCacheKey = () => (always ? 'crowd-2a' : 'crowd-2');
  return m;
}

/** Für die 2D-Zuschauer (crowdSprites): Farbtabellen und Shaderteile */
export const CROWD_PAL = PAL;
export const CROWD_FLAGS = FLAG_COLS;
export const CROWD_NV = NV;
export const CROWD_VERT = { head: VERT_HEAD, begin: VERT_BEGIN };

// ------------------------------------------------------------------ Instanzen

/** Was ein einzelner Zuschauer tut */
export const Act = { idle: 0, clap: 1, wave: 2, cheer: 3, film: 4, flag: 5, shout: 6, hold: 7, run: 8, runFlag: 9, sit: 10, lean: 11, sign: 12, jog: 13, jogFlag: 14, jump: 15, ola: 16, dance: 17 } as const;

export interface Person {
  x: number; y: number; z: number; yaw: number;
  height: number; width: number; act: number; phase: number;
  skin: number; top: number; bottom: number; hair: number;
  hat: number; hatType: number; accent: number; flag: number;
  shorts: boolean; sleeves: boolean; longHair: boolean; glasses: boolean; stripe: boolean;
}

export const STRIDE = 16;
export function packPerson(p: Person, out: Float32Array, i: number) {
  const o = i * STRIDE;
  out[o] = p.x; out[o + 1] = p.y; out[o + 2] = p.z; out[o + 3] = p.yaw;
  out[o + 4] = p.height; out[o + 5] = p.width; out[o + 6] = p.act; out[o + 7] = p.phase;
  out[o + 8] = p.skin; out[o + 9] = p.top; out[o + 10] = p.bottom; out[o + 11] = p.hair;
  const feat = (p.shorts ? 1 : 0) + (p.sleeves ? 2 : 0) + (p.longHair ? 4 : 0) + (p.glasses ? 8 : 0) + (p.stripe ? 16 : 0);
  out[o + 12] = p.hat; out[o + 13] = p.hatType; out[o + 14] = p.accent; out[o + 15] = p.flag + 16 * feat;
}

/** Braucht dieser Zuschauer dieses Zubehör? (Läufer bekommen alles, der Shader blendet aus) */
export function needs(p: Person, k: Kind): boolean {
  switch (k) {
    case 'body': return true;
    case 'cap': return p.hatType === 1;
    case 'sunhat': return p.hatType === 2;
    case 'beanie': return p.hatType === 3;
    case 'longHair': return p.longHair;
    case 'glasses': return p.glasses;
    case 'phone': return p.act === Act.film;
    case 'flag': return p.act === Act.flag || p.act === Act.runFlag || p.act === Act.jogFlag;
  }
}

const BASE = new Map<string, THREE.BufferGeometry | null>();
const base = (k: Kind, lod: 0 | 1) => {
  const key = `${k}:${lod}`;
  if (!BASE.has(key)) BASE.set(key, personGeometry(k, lod));
  return BASE.get(key)!;
};

/**
 * Instanz-Geometrie. Die Grundform teilen sich alle Abschnitte; nur die Zuschauerdaten sind eigen.
 * Freigeben deshalb nur mit disposeCrowdGeometry.
 */
export function crowdGeometry(kind: Kind, lod: 0 | 1, data: Float32Array | THREE.InstancedInterleavedBuffer, count: number): THREE.InstancedBufferGeometry | null {
  const src = base(kind, lod);
  if (!src) return null;
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(src.index);
  for (const name of ['position', 'color', 'normal', 'aLod']) g.setAttribute(name, src.getAttribute(name));
  const buf = data instanceof THREE.InstancedInterleavedBuffer ? data : new THREE.InstancedInterleavedBuffer(data, STRIDE, 1);
  for (let k = 0; k < 4; k++) g.setAttribute(`aI${k}`, new THREE.InterleavedBufferAttribute(buf, 4, k * 4));
  g.instanceCount = count;
  return g;
}

/** gibt nur die Zuschauerdaten frei – die geteilte Grundform bleibt auf der Grafikkarte */
export function disposeCrowdGeometry(g: THREE.BufferGeometry) {
  g.setIndex(null);
  for (const name of ['position', 'color', 'normal', 'aLod']) g.deleteAttribute(name);
  g.dispose();
}

// ------------------------------------------------------------------ Auswahl

export type Zone = 'pass' | 'village' | 'tifosi';
type Rnd = () => number;
const pickW = <T,>(r: Rnd, items: [T, number][]): T => {
  let s = 0;
  for (const [, w] of items) s += w;
  let x = r() * s;
  for (const [v, w] of items) { x -= w; if (x <= 0) return v; }
  return items[items.length - 1][0];
};
const inRange = (r: Rnd, k: keyof typeof RANGE) => RANGE[k][0] + Math.floor(r() * RANGE[k][1]);

/** Ein zufälliger, glaubwürdiger Zuschauer (ohne Ort) */
export function randomPerson(r: Rnd, zone: Zone, opts: { row: number; kid?: boolean; runner?: boolean }): Person {
  const cold = zone === 'pass';
  const kid = !!opts.kid;
  const skin = inRange(r, 'skin');
  let hair = inRange(r, 'hair');
  const older = !kid && r() < 0.2;
  if (older) hair = RANGE.hair[0] + 5 + Math.floor(r() * 2);
  // Oberteile: viel Rosa beim Giro, dazu Alltagsfarben
  let top = r() < 0.16 ? (r() < 0.6 ? PINK : PINK2) : inRange(r, 'top');
  const sleeves = cold ? r() < 0.8 : r() < 0.28;
  const shorts = kid ? r() < 0.6 : cold ? r() < 0.08 : r() < 0.45;
  const hatType = pickW(r, cold ? [[0, 48], [1, 26], [3, 26]] : [[0, 62], [1, 26], [2, 12]]);
  let act: number;
  if (opts.runner) act = r() < 0.45 ? Act.runFlag : Act.run;
  else if (kid) act = pickW(r, [[Act.cheer, 4], [Act.wave, 3], [Act.clap, 3]]);
  else if (opts.row === 0) act = pickW(r, [[Act.lean, 24], [Act.clap, 18], [Act.film, 12], [Act.wave, 10], [Act.cheer, 10], [Act.shout, 8], [Act.flag, 3], [Act.jump, 4], [Act.idle, 7]]);
  else if (r() < 0.07) act = Act.sign;
  else act = pickW(r, [[Act.cheer, 16], [Act.flag, cold ? 9 : 6], [Act.clap, 15], [Act.wave, 12], [Act.film, 8], [Act.shout, 7], [Act.jump, 8], [Act.dance, cold ? 2 : 6], [Act.idle, 12]]);
  if (opts.runner && r() < 0.35) top = skin; // ohne Hemd
  const flag = r() < 0.32 ? Math.floor(r() * 2) : Math.floor(r() * NFLAGS);
  return {
    x: 0, y: 0, z: 0, yaw: 0,
    height: kid ? 0.56 + r() * 0.16 : 0.93 + r() * 0.17,
    width: kid ? 0.82 + r() * 0.12 : 0.9 + r() * 0.28,
    act, phase: r(),
    skin, top, bottom: inRange(r, 'bottom'), hair,
    hat: r() < 0.3 ? (r() < 0.5 ? PINK : WHITE) : inRange(r, 'top'), hatType,
    accent: r() < 0.4 ? WHITE : inRange(r, 'top'), flag,
    shorts, sleeves, longHair: !older && r() < (kid ? 0.4 : 0.34), glasses: !kid && r() < (cold ? 0.22 : 0.3), stripe: r() < 0.3,
  };
}

