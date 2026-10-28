/**
 * Tunnel: Röhre mit Hufeisen-Gewölbe statt Kasten. Unten Rinne und Gehwegkante mit Rückstrahlern, darüber
 * helle Wandpaneele mit dunklem Sockel, oben Spritzbeton; Leuchtenreihen links und rechts im Gewölbe,
 * Strahlventilatoren, Kabeltrasse, SOS-Nischen und Notausgangsschilder.
 *
 * Das Licht entsteht pro Bildpunkt: Jede Fläche kennt ihre Lage in der Röhre (seitlich, Höhe, Strecke,
 * Abstand zum Portal). Daraus ergeben sich Lichtinseln unter den Leuchten (Wände hell, wo die Leuchte nah
 * ist), und an den Portalen fällt Tageslicht weit hinein und wird nach innen schwächer.
 *
 * Portale sind gemauerte Bögen: Bruchsteinfassade mit Bogensteinen und Schlussstein, Eckquadern,
 * Kämpfersteinen, Gesims und einer Marmortafel mit Namen und Länge.
 */
import * as THREE from 'three';
import { FArr, GB, lin, type RGBf } from './models3d';
import { TSIGN } from './tex3d';

/** Wandfläche (seitlich ab Mitte), Kämpfer (Beginn des Gewölbes), Scheitel */
export const T_WALL = 3.45;
export const T_SPRING = 3.2;
export const T_TOP = 6.15;
const KERB = 3.12;
const KERB_H = 0.17;
/** Leuchten: alle 12 m, links und rechts im Gewölbe */
export const LAMP_EVERY = 12;
export const LAMP_X = 1.9;
export const LAMP_H = 5.45;
/** Portalfassade: halbe Breite, Höhe, Vorsprung vor der Felswand */
export const FAC_W = 7.6;
export const FAC_H = 9.6;
const FAC_D = 1.1;
export const FAC_B = -0.9;

export interface TRow { x: number; y: number; z: number; rx: number; rz: number; th: number }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pfn = (r: any, x: number, h: number) => number[];

/** Punkt im Gewölbe (t = 0 Kämpfer rechts … π/2 Scheitel … π Kämpfer links) */
export function vault(t: number, grow = 0): [number, number] {
  return [(T_WALL + grow) * Math.cos(t), T_SPRING + (T_TOP - T_SPRING + grow) * Math.sin(t)];
}

// ------------------------------------------------------------------ Baukasten mit Lage in der Röhre

interface Corner { p: number[]; u: number; v: number; lat: number; h: number; z: number; dp: number }

/**
 * wie GB, dazu je Ecke die Lage in der Röhre (aT = seitlich, Höhe, Strecke ab base, Abstand zum Portal), die
 * Flächennormale in denselben Koordinaten (aN) und die Art (aK). Die Strecke zählt ab base (ein Vielfaches des
 * Leuchtenabstands nahe am Abschnitt): kleine Zahlen bleiben auf Handy-Grafikchips genau – große flimmern.
 */
export class TB {
  p = new FArr();
  c = new FArr();
  u = new FArr();
  t = new FArr();
  n = new FArr();
  k = new FArr(64);
  base = 0;
  get empty() { return this.p.length === 0; }
  private v(q: Corner, col: RGBf, k: number, nx: number, ny: number, nz: number) {
    this.p.push3(q.p[0], q.p[1], q.p[2]);
    this.c.push3(col[0], col[1], col[2]);
    this.u.push2(q.u, q.v);
    this.t.push4(q.lat, q.h, q.z - this.base, q.dp);
    this.n.push3(nx, ny, nz);
    this.k.push1(k);
  }
  private tri(a: Corner, b: Corner, c: Corner, col: RGBf, k: number) {
    // Normale aus der Lage in der Röhre (Seite ist egal: das Licht nimmt den Betrag)
    const ux = b.lat - a.lat, uy = b.h - a.h, uz = b.z - a.z;
    const vx = c.lat - a.lat, vy = c.h - a.h, vz = c.z - a.z;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    this.v(a, col, k, nx, ny, nz); this.v(b, col, k, nx, ny, nz); this.v(c, col, k, nx, ny, nz);
  }
  /** k: 0 schlicht, 1 mit Textur (Bruchteile mischen), 2 leuchtend (ohne Licht) */
  quad(a: Corner, b: Corner, c: Corner, d: Corner, col: RGBf, k: number) {
    this.tri(a, b, c, col, k);
    this.tri(a, c, d, col, k);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p.take(), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.c.take(), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.u.take(), 2));
    g.setAttribute('aT', new THREE.BufferAttribute(this.t.take(), 4));
    g.setAttribute('aN', new THREE.BufferAttribute(this.n.take(), 3));
    g.setAttribute('aK', new THREE.BufferAttribute(this.k.take(), 1));
    g.computeBoundingSphere();
    return g;
  }
}

// ------------------------------------------------------------------ Material

export interface TunnelUniforms {
  uLamp: { value: THREE.Color };
  uDay: { value: THREE.Color };
  uAmb: { value: number };
}

export function tunnelUniforms(): TunnelUniforms {
  return { uLamp: { value: new THREE.Color(1, 0.9, 0.75) }, uDay: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: 0.12 } };
}

const LIGHT_GLSL = /* glsl */ `
uniform vec3 uLamp;
uniform vec3 uDay;
uniform float uAmb;
varying vec4 vT;
varying vec3 vTN;
varying float vK;
vec3 tunnelLight() {
  if (vK > 1.5) return vec3(1.0);
  // Lage und Flächennormale in der Röhre (seitlich, Höhe, Strecke)
  vec3 P = vT.xyz;
  vec3 N = vTN;
  float n = floor(P.z / ${LAMP_EVERY.toFixed(1)} + 0.5) * ${LAMP_EVERY.toFixed(1)};
  float s = 0.0;
  for (int i = -1; i <= 1; i++) {
    float lz = n + float(i) * ${LAMP_EVERY.toFixed(1)};
    for (int j = 0; j < 2; j++) {
      float lx = j == 0 ? -${LAMP_X.toFixed(2)} : ${LAMP_X.toFixed(2)};
      vec3 d = vec3(lx, ${LAMP_H.toFixed(2)}, lz) - P;
      float d2 = dot(d, d) + 0.6;
      vec3 l = d * inversesqrt(d2);
      // Leuchten strahlen vor allem nach unten und zur Seite
      float cone = 0.22 + 0.78 * clamp(l.y, 0.0, 1.0);
      s += abs(dot(N, l)) * cone / d2;
    }
  }
  // Tageslicht fällt an den Portalen hinein, unten (Straße, Sockel) etwas weiter als oben im Gewölbe
  float dp = max(vT.w, 0.0);
  float day = exp(-dp / (8.0 + 3.0 * clamp(1.0 - P.y / 6.0, 0.0, 1.0)));
  return vec3(uAmb) + uLamp * s + uDay * day;
}`;

/** unbeleuchtetes Grundmaterial, dazu das Röhrenlicht (Leuchten, Tageslicht) pro Bildpunkt */
export function tunnelMaterial(map: THREE.Texture | null, U: TunnelUniforms, key: string, offset = false): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, map, side: THREE.DoubleSide });
  if (offset) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aT;\nattribute vec3 aN;\nattribute float aK;\nvarying vec4 vT;\nvarying vec3 vTN;\nvarying float vK;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvT = aT;\nvTN = aN;\nvK = aK;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + LIGHT_GLSL)
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          diffuseColor.rgb *= mix( vec3( 1.0 ), sampledDiffuseColor.rgb, clamp( vK, 0.0, 1.0 ) );
        #endif`)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= tunnelLight();');
  };
  m.customProgramCacheKey = () => `tunnel-${key}`;
  return m;
}

// ------------------------------------------------------------------ Röhre

const C = {
  gutter: lin('#55575b'),
  kerbFace: lin('#d4d0c6'),
  kerbTop: lin('#9a978f'),
  plinth: lin('#2e3034'),
  panel: lin('#e6e3dc'),
  band: lin('#34363a'),
  shot: lin('#66676a'),
  shotTop: lin('#56575b'),
  white: lin('#e9e9e4'),
  housing: lin('#5c5f64'),
  fan: lin('#8f9297'),
  fanDark: lin('#2a2c30'),
  tray: lin('#3c3e42'),
  door: lin('#d06a2b'),
  doorFrame: lin('#bfc3c7'),
};
const LAMP_LIGHT: RGBf = [2.6, 2.35, 1.9];
const AMBER: RGBf = [1.6, 0.75, 0.16];

export interface RingInfo {
  /** Strecke (m) an a und b, Abstand zum nächsten Portal (m) an a und b */
  za: number; zb: number; dpa: number; dpb: number;
  lamp: boolean;
  /** Länge der Röhre (m): lange Röhren bekommen Ventilatoren */
  len: number;
}

/**
 * Ein Stück Röhre zwischen zwei Querschnitten a und b: Wände und Gewölbe (wall), Fahrbahn (road), Markierungen
 * (marks), Schilder (signs, GB mit UV im Schilderatlas). glows: Lichtpunkte (Halos) der Leuchten.
 */
export function tunnelRing(wall: TB, road: TB, marks: TB, signs: GB, a: TRow, b: TRow, P: Pfn, info: RingInfo) {
  const { za, zb, dpa, dpb } = info;
  const cA = (lat: number, h: number, u: number, v: number): Corner => ({ p: P(a, lat, h), u, v, lat, h, z: za, dp: dpa });
  const cB = (lat: number, h: number, u: number, v: number): Corner => ({ p: P(b, lat, h), u, v, lat, h, z: zb, dp: dpb });
  // Fahrbahn
  const tl = 5;
  // Textur ab einem ganzzahligen Versatz (kleine Werte, sonst ungenau auf dem Handy)
  const vo = Math.floor(road.base / tl);
  road.quad(cA(-2.8, 0, -2.8 / tl, za / tl - vo), cA(2.8, 0, 2.8 / tl, za / tl - vo), cB(2.8, 0, 2.8 / tl, zb / tl - vo), cB(-2.8, 0, -2.8 / tl, zb / tl - vo), [1, 1, 1], 1);
  // Markierungen: Randlinien, Mittellinie gestrichelt
  const H = 0.012;
  const strip = (x0: number, x1: number) => marks.quad(cA(x0, H, 0, 0), cA(x1, H, 0, 0), cB(x1, H, 0, 0), cB(x0, H, 0, 0), C.white, 0);
  strip(-2.72, -2.6);
  strip(2.6, 2.72);
  if ((Math.round(za / 2) & 3) < 2) strip(-0.06, 0.06);

  // Querschnitt (rechte Seite, außen nach oben): [seitlich, Höhe, Farbe, Textur]
  const prof: [number, number, RGBf, number][] = [
    [2.8, 0, C.gutter, 1], [KERB, 0, C.kerbFace, 0.6], [KERB, KERB_H, C.kerbTop, 1], [T_WALL, KERB_H, C.plinth, 0.8],
    [T_WALL, 0.42, C.panel, 0.3], [T_WALL, 2.55, C.band, 0], [T_WALL, 2.66, C.shot, 0.65],
  ];
  const ARC = 9;
  for (let q = 0; q <= ARC; q++) {
    const [x, h] = vault((q / ARC) * (Math.PI / 2));
    const k = q / ARC;
    const col: RGBf = [C.shot[0] + (C.shotTop[0] - C.shot[0]) * k, C.shot[1] + (C.shotTop[1] - C.shot[1]) * k, C.shot[2] + (C.shotTop[2] - C.shot[2]) * k];
    prof.push([x, h, col, 0.65]);
  }
  // Bogenlänge für die Textur
  const sArc: number[] = [0];
  for (let q = 1; q < prof.length; q++) sArc.push(sArc[q - 1] + Math.hypot(prof[q][0] - prof[q - 1][0], prof[q][1] - prof[q - 1][1]));
  const TS = 3.2;
  for (const sg of [-1, 1]) {
    for (let q = 0; q < prof.length - 1; q++) {
      const [x0, h0, col, k] = prof[q];
      const [x1, h1] = prof[q + 1];
      const u0 = sArc[q] / TS;
      const u1 = sArc[q + 1] / TS;
      const wo = Math.floor(wall.base / TS);
      wall.quad(cA(sg * x0, h0, u0, za / TS - wo), cA(sg * x1, h1, u1, za / TS - wo), cB(sg * x1, h1, u1, zb / TS - wo), cB(sg * x0, h0, u0, zb / TS - wo), col, k);
    }
  }

  // Bauteile, die an einem Querschnitt sitzen: Box entlang der Strecke (Länge len ab a) – Seiten schlicht, Unterseite wählbar
  const fx = Math.sin(a.th);
  const fz = -Math.cos(a.th);
  const at = (lat: number, h: number, dz: number): Corner => {
    const q = P(a, lat, h);
    return { p: [q[0] + fx * dz, q[1], q[2] + fz * dz], u: 0, v: 0, lat, h, z: za + dz, dp: dpa };
  };
  const box = (l0: number, l1: number, h0: number, h1: number, d0: number, d1: number, col: RGBf, k: number, under?: RGBf, ku = 2) => {
    const A = at(l0, h0, d0), B = at(l1, h0, d0), Cc = at(l1, h1, d0), D = at(l0, h1, d0);
    const E = at(l0, h0, d1), F = at(l1, h0, d1), G = at(l1, h1, d1), Hh = at(l0, h1, d1);
    wall.quad(A, B, Cc, D, col, k);
    wall.quad(F, E, Hh, G, col, k);
    wall.quad(E, A, D, Hh, col, k);
    wall.quad(B, F, G, Cc, col, k);
    wall.quad(D, Cc, G, Hh, col, k);
    wall.quad(E, F, B, A, under ?? col, under ? ku : k);
  };

  // Kabeltrasse oben an beiden Wänden (durchgehend)
  for (const sg of [-1, 1]) {
    const l0 = sg * (T_WALL - 0.16);
    const l1 = sg * (T_WALL - 0.01);
    wall.quad(cA(l0, 2.9, 0, 0), cA(l1, 2.9, 0, 0), cB(l1, 2.9, 0, 0), cB(l0, 2.9, 0, 0), C.tray, 0);
    wall.quad(cA(l0, 2.9, 0, 0), cA(l0, 2.98, 0, 0), cB(l0, 2.98, 0, 0), cB(l0, 2.9, 0, 0), shade(C.tray, 1.25), 0);
  }

  const zi = Math.round(za);
  // Leuchten: Gehäuse im Gewölbe, leuchtende Unterseite
  if (info.lamp) {
    for (const sg of [-1, 1]) {
      const lx = sg * LAMP_X;
      box(lx - 0.13, lx + 0.13, LAMP_H, LAMP_H + 0.12, -0.75, 0.75, C.housing, 0, LAMP_LIGHT);
      // Halter zum Gewölbe
      box(lx - 0.03, lx + 0.03, LAMP_H + 0.13, LAMP_H + 0.42, -0.04, 0.04, C.housing, 0);
      // (keine Lichtpunkte mehr: die Unterseite leuchtet selbst, Halos flimmerten auf dem Handy)
    }
  }
  // Rückstrahler an den Gehwegkanten (bernsteinfarben), versetzt zu den Leuchten
  if (zi % 12 === 6) {
    for (const sg of [-1, 1]) {
      const l = sg * (KERB - 0.004);
      wall.quad(at(l, 0.06, -0.05), at(l, 0.06, 0.05), at(l, 0.13, 0.05), at(l, 0.13, -0.05), AMBER, 2);
    }
  }
  // Strahlventilatoren paarweise unter dem Scheitel (nur in langen Röhren, nicht direkt am Portal)
  if (info.len > 120 && zi % 96 === 48 && dpa > 24) {
    for (const sg of [-1, 1]) fan(wall, at, sg * 1.2, 5.05);
  }
  // SOS-Nische rechts mit Tür und Schild, Notausgang links
  if (zi % 72 === 36 && dpa > 14) {
    const l = T_WALL - 0.01;
    box(l - 0.02, l, 0.17, 2.25, -0.65, 0.65, C.doorFrame, 0);
    box(l - 0.03, l - 0.01, 0.25, 2.15, -0.55, 0.55, C.door, 0.2);
    sign(signs, at, l - 0.05, 2.75, 0, 0.42, TSIGN.sos, 1);
    // Feuerlöscher-Schild daneben
    sign(signs, at, l - 0.05, 2.75, 1.0, 0.3, TSIGN.fire, 1);
  }
  if (zi % 72 === 0 && dpa > 14 && info.len > 90) {
    sign(signs, at, -(T_WALL - 0.05), 2.95, 0, 0.36, TSIGN.exit, -1);
  }
}

function shade(c: RGBf, f: number): RGBf { return [c[0] * f, c[1] * f, c[2] * f]; }

/** Strahlventilator: Röhre mit dunklen Öffnungen, an zwei Bügeln aufgehängt */
function fan(wall: TB, at: (lat: number, h: number, dz: number) => Corner, lat: number, h: number) {
  const R = 0.42;
  const L = 1.4;
  const N = 10;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2;
    const a1 = ((i + 1) / N) * Math.PI * 2;
    const p = (a: number, d: number) => at(lat + Math.cos(a) * R, h + Math.sin(a) * R, d);
    const f = 0.85 + 0.25 * Math.max(0, Math.sin((a0 + a1) / 2));
    wall.quad(p(a0, -L), p(a1, -L), p(a1, L), p(a0, L), shade(C.fan, f), 0);
    // Ringe an den Enden, innen dunkel
    for (const e of [-L, L]) {
      const q = (a: number, r: number) => at(lat + Math.cos(a) * r, h + Math.sin(a) * r, e);
      wall.quad(q(a0, R), q(a1, R), q(a1, R * 0.8), q(a0, R * 0.8), shade(C.fan, 0.75), 0);
      wall.quad(q(a0, R * 0.8), q(a1, R * 0.8), q(a1, 0.05), q(a0, 0.05), C.fanDark, 0);
    }
  }
  for (const d of [-0.9, 0.9]) {
    const A = at(lat - 0.03, h + R, d), B = at(lat + 0.03, h + R, d), Cc = at(lat + 0.03, T_TOP - 0.05, d), D = at(lat - 0.03, T_TOP - 0.05, d);
    wall.quad(A, B, Cc, D, C.fanDark, 0);
  }
}

/** Schild an der Wand (Atlaszelle cell), Vorderseite zur Röhre; side = +1 rechte, −1 linke Wand */
function sign(gb: GB, at: (lat: number, h: number, dz: number) => Corner, lat: number, h: number, dz: number, s: number, cell: number, side: 1 | -1) {
  const u0 = cell / 4 + 0.004;
  const u1 = (cell + 1) / 4 - 0.004;
  const A = at(lat, h - s / 2, dz - (s / 2) * side).p;
  const B = at(lat, h - s / 2, dz + (s / 2) * side).p;
  const Cc = at(lat, h + s / 2, dz + (s / 2) * side).p;
  const D = at(lat, h + s / 2, dz - (s / 2) * side).p;
  gb.quad(A, B, Cc, D, [1, 1, 1], [[u0, 0.02], [u1, 0.02], [u1, 0.98], [u0, 0.98]]);
}

// ------------------------------------------------------------------ Portal

const STONE: RGBf = lin('#d8d0c0');
const STONE2: RGBf = lin('#cbc2b0');
const KEY: RGBf = lin('#e6dfd0');
const FAC: RGBf = lin('#bdb3a1');

/**
 * Gemauertes Portal an Querschnitt a. dir = 1: Einfahrt (Fassade zeigt zur Anfahrt), −1: Ausfahrt.
 * mas: Bruchstein (UV in Metern/1,8), plaque: Rechteck für die Inschrift (eigene Textur, vom Aufrufer).
 * Die Fassade steht FAC_D vor der Felswand; dazwischen der kurze gemauerte Bogen bis zum Beginn der Röhre.
 */
export function portalFacade(mas: GB, trim: GB, a: TRow, P: Pfn, dir: 1 | -1): { plaque: number[][] } {
  const fx = Math.sin(a.th);
  const fz = -Math.cos(a.th);
  const at = (l: number, h: number, d: number) => { const q = P(a, l, h); return [q[0] - fx * d * dir, q[1], q[2] - fz * d * dir]; };
  const TX = 1.8;
  const uvF = (l: number, h: number) => [l * dir / TX, h / TX];
  const quadF = (p: [number, number, number][], col: RGBf, uv?: number[][]) => {
    const q = p.map(([l, h, d]) => at(l, h, d));
    mas.quad(q[0], q[1], q[2], q[3], col, uv ?? p.map(([l, h, d]) => [(l + d) * dir / TX, h / TX]));
  };
  /** behauene Werksteine (Bogen, Ecken, Gesims): glatt, ohne Mauertextur */
  const quadT = (p: [number, number, number][], col: RGBf) => {
    const q = p.map(([l, h, d]) => at(l, h, d));
    trim.quad(q[0], q[1], q[2], q[3], col);
  };
  const RI = 0;          // innen: Gewölbe
  const RO = 0.75;       // Breite des Bogenkranzes
  const Ein = (t: number) => vault(t, RI);
  const Eout = (t: number) => vault(t, RO);
  const DF = FAC_D;

  // 1) Fassade: Rechteck ohne Bogen und Laibung
  const contour: THREE.Vector2[] = [];
  contour.push(new THREE.Vector2(-FAC_W, FAC_B), new THREE.Vector2(-(T_WALL + RO), FAC_B), new THREE.Vector2(-(T_WALL + RO), T_SPRING));
  const NA = 18;
  for (let i = 1; i < NA; i++) { const [x, h] = Eout(Math.PI - (i / NA) * Math.PI); contour.push(new THREE.Vector2(x, h)); }
  contour.push(new THREE.Vector2(T_WALL + RO, T_SPRING), new THREE.Vector2(T_WALL + RO, FAC_B), new THREE.Vector2(FAC_W, FAC_B));
  contour.push(new THREE.Vector2(FAC_W, FAC_H), new THREE.Vector2(-FAC_W, FAC_H));
  if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
    const A = contour[i], B = contour[j], Cc = contour[k];
    mas.tri(at(A.x, A.y, DF), at(B.x, B.y, DF), at(Cc.x, Cc.y, DF), FAC, uvF(A.x, A.y), uvF(B.x, B.y), uvF(Cc.x, Cc.y));
  }
  // Seiten und Oberseite der Fassade (bis in die Felswand)
  for (const sg of [-1, 1]) quadF([[sg * FAC_W, FAC_B, DF], [sg * FAC_W, FAC_B, -0.4], [sg * FAC_W, FAC_H, -0.4], [sg * FAC_W, FAC_H, DF]], shade(FAC, 0.92));

  // 2) Bogensteine (ungerade Anzahl, Schlussstein in der Mitte etwas größer und weiter vorn)
  const NV = 13;
  // Mörtelgrund hinter dem Bogenkranz und über der Laibung: durch die Stoßfugen zwischen den Steinen sah man
  // sonst ins Leere (Löcher am Portal) – jetzt auf dunklen Mörtel
  {
    const MORTAR = shade(FAC, 0.5);
    const NB = NV * 2;
    for (let j = 0; j < NB; j++) {
      const t0 = Math.PI - (j / NB) * Math.PI;
      const t1 = Math.PI - ((j + 1) / NB) * Math.PI;
      const [ix0, ih0] = vault(t0, -0.03);
      const [ix1, ih1] = vault(t1, -0.03);
      const [ox0, oh0] = vault(t0, RO + 0.5);
      const [ox1, oh1] = vault(t1, RO + 0.5);
      quadT([[ix0, ih0, DF - 0.03], [ix1, ih1, DF - 0.03], [ox1, oh1, DF - 0.03], [ox0, oh0, DF - 0.03]], MORTAR);
      const [sx0, sh0] = vault(t0, 0.03);
      const [sx1, sh1] = vault(t1, 0.03);
      quadT([[sx1, sh1, DF + 0.2], [sx0, sh0, DF + 0.2], [sx0, sh0, 0], [sx1, sh1, 0]], MORTAR);
    }
  }
  for (let j = 0; j < NV; j++) {
    const t0 = Math.PI - (j / NV) * Math.PI;
    const t1 = Math.PI - ((j + 1) / NV) * Math.PI;
    const key = j === (NV - 1) / 2;
    const front = DF + (key ? 0.2 : 0.1);
    const grow = key ? 0.45 : 0;
    const col = key ? KEY : j % 2 ? STONE : STONE2;
    const gap = 0.012;
    const ta = t0 - gap;
    const tb = t1 + gap;
    const [ix0, ih0] = Ein(ta);
    const [ix1, ih1] = Ein(tb);
    const [ox0, oh0] = vault(ta, RO + grow);
    const [ox1, oh1] = vault(tb, RO + grow);
    // Vorderseite
    quadT([[ix0, ih0, front], [ix1, ih1, front], [ox1, oh1, front], [ox0, oh0, front]], col);
    // Rücken (Extrados) und Stoßfugen-Flächen bis zur Fassade
    quadT([[ox0, oh0, front], [ox1, oh1, front], [ox1, oh1, DF - 0.02], [ox0, oh0, DF - 0.02]], shade(col, 0.9));
    quadT([[ix0, ih0, front], [ox0, oh0, front], [ox0, oh0, DF - 0.02], [ix0, ih0, DF - 0.02]], shade(col, 0.82));
    quadT([[ox1, oh1, front], [ix1, ih1, front], [ix1, ih1, DF - 0.02], [ox1, oh1, DF - 0.02]], shade(col, 0.82));
    // Laibung (Unterseite des Bogens) bis zur Röhre
    quadT([[ix1, ih1, front], [ix0, ih0, front], [ix0, ih0, 0], [ix1, ih1, 0]], shade(col, 0.7));
  }
  // 3) Laibung unten und Eckquader (abwechselnd lang und kurz)
  for (const sg of [-1, 1]) {
    // Gehwegkante und Wand der Laibung
    quadT([[sg * T_WALL, KERB_H, DF + 0.08], [sg * T_WALL, T_SPRING, DF + 0.08], [sg * T_WALL, T_SPRING, 0], [sg * T_WALL, KERB_H, 0]], shade(STONE2, 0.72));
    quadT([[sg * KERB, KERB_H, DF + 0.08], [sg * T_WALL, KERB_H, DF + 0.08], [sg * T_WALL, KERB_H, 0], [sg * KERB, KERB_H, 0]], lin('#9a978f'));
    quadT([[sg * KERB, 0, DF + 0.08], [sg * KERB, KERB_H, DF + 0.08], [sg * KERB, KERB_H, 0], [sg * KERB, 0, 0]], lin('#d4d0c6'));
    let h = FAC_B;
    let n = 0;
    while (h < T_SPRING - 0.05) {
      const hh = Math.min(T_SPRING, h + (n % 2 ? 0.46 : 0.58));
      const outer = T_WALL + (n % 2 ? RO : RO + 0.35);
      const col = n % 2 ? STONE : STONE2;
      const fr = DF + 0.08;
      const l0 = sg * (T_WALL - 0.005);
      const l1 = sg * outer;
      quadT([[l0, h + 0.012, fr], [l1, h + 0.012, fr], [l1, hh - 0.012, fr], [l0, hh - 0.012, fr]], col);
      quadT([[l1, h + 0.012, fr], [l1, h + 0.012, DF - 0.02], [l1, hh - 0.012, DF - 0.02], [l1, hh - 0.012, fr]], shade(col, 0.85));
      quadT([[l0, hh - 0.012, fr], [l1, hh - 0.012, fr], [l1, hh - 0.012, DF - 0.02], [l0, hh - 0.012, DF - 0.02]], shade(col, 1.05));
      h = hh;
      n++;
    }
    // Kämpferstein
    const l0 = sg * (T_WALL - 0.12);
    const l1 = sg * (T_WALL + RO + 0.45);
    const fr = DF + 0.16;
    quadT([[l0, T_SPRING - 0.2, fr], [l1, T_SPRING - 0.2, fr], [l1, T_SPRING + 0.06, fr], [l0, T_SPRING + 0.06, fr]], KEY);
    quadT([[l0, T_SPRING + 0.06, fr], [l1, T_SPRING + 0.06, fr], [l1, T_SPRING + 0.06, 0], [l0, T_SPRING + 0.06, 0]], shade(KEY, 1.05));
    quadT([[l0, T_SPRING - 0.2, 0], [l1, T_SPRING - 0.2, 0], [l1, T_SPRING - 0.2, fr], [l0, T_SPRING - 0.2, fr]], shade(KEY, 0.7));
    quadT([[l1, T_SPRING - 0.2, fr], [l1, T_SPRING - 0.2, DF - 0.02], [l1, T_SPRING + 0.06, DF - 0.02], [l1, T_SPRING + 0.06, fr]], shade(KEY, 0.85));
  }
  // 4) Gesims oben: Band mit Unterseite, darüber eine schräge Abdeckung bis in den Fels
  {
    const h0 = FAC_H - 0.62;
    const h1 = FAC_H - 0.28;
    const fr = DF + 0.32;
    const L = FAC_W + 0.25;
    quadT([[-L, h0, fr], [L, h0, fr], [L, h1, fr], [-L, h1, fr]], KEY);
    quadT([[-L, h0, DF], [L, h0, DF], [L, h0, fr], [-L, h0, fr]], shade(KEY, 0.62));
    quadT([[-L, h1, fr], [L, h1, fr], [L, FAC_H, DF + 0.05], [-L, FAC_H, DF + 0.05]], shade(KEY, 1.08));
    quadT([[-L, FAC_H, DF + 0.05], [L, FAC_H, DF + 0.05], [L, FAC_H + 0.12, -0.6], [-L, FAC_H + 0.12, -0.6]], shade(STONE2, 0.95));
    for (const sg of [-1, 1]) quadT([[sg * L, h0, DF], [sg * L, h0, fr], [sg * L, h1, fr], [sg * L, FAC_H, DF]], shade(KEY, 0.8));
    // Gurtband unter der Tafel
    const b0 = 7.28;
    const b1 = 7.4;
    quadT([[-FAC_W, b0, DF + 0.08], [FAC_W, b0, DF + 0.08], [FAC_W, b1, DF + 0.08], [-FAC_W, b1, DF + 0.08]], STONE);
    quadT([[-FAC_W, b1, DF + 0.08], [FAC_W, b1, DF + 0.08], [FAC_W, b1, DF], [-FAC_W, b1, DF]], shade(STONE, 1.06));
  }
  // Tafel: über dem Schlussstein (Ecken für den Aufrufer)
  const pl = [at(-2.35, 7.6, DF + 0.03), at(2.35, 7.6, DF + 0.03), at(2.35, 8.72, DF + 0.03), at(-2.35, 8.72, DF + 0.03)];
  // Rahmen der Tafel
  quadT([[-2.5, 7.48, DF + 0.02], [2.5, 7.48, DF + 0.02], [2.5, 8.84, DF + 0.02], [-2.5, 8.84, DF + 0.02]], shade(KEY, 0.92));
  return { plaque: dir > 0 ? pl : [pl[1], pl[0], pl[3], pl[2]] };
}

/** Name eines Tunnels (je Sprache), fest aus der Lage */
const NAMES: Record<string, string[]> = {
  it: ['GALLERIA SAN ROCCO', 'GALLERIA DEL PASSO', 'GALLERIA MONTE CROCE', 'GALLERIA DEI LARICI', 'GALLERIA SANTA LUCIA', 'GALLERIA DEL DIAVOLO', 'GALLERIA VAL FREDDA', 'GALLERIA DELLE AQUILE', 'GALLERIA SAN MARTINO', 'GALLERIA ROCCIA NERA', 'GALLERIA DEI CAMOSCI', 'GALLERIA DEL SOLE'],
  fr: ['TUNNEL DU COL', 'TUNNEL DES AIGLES', 'TUNNEL SAINT-ROCH', 'TUNNEL DE LA CROIX', 'TUNNEL DES MÉLÈZES', 'TUNNEL DU DIABLE', 'TUNNEL DE ROCHENOIRE', 'TUNNEL DES CHAMOIS'],
  es: ['TÚNEL DEL PUERTO', 'TÚNEL DE LAS ÁGUILAS', 'TÚNEL SAN ROQUE', 'TÚNEL DE LA CRUZ', 'TÚNEL DEL DIABLO', 'TÚNEL PEÑA NEGRA', 'TÚNEL DE LOS PINOS'],
  en: ['GALLERIA SAN ROCCO', 'GALLERIA DEL PASSO', 'GALLERIA MONTE CROCE', 'GALLERIA DEI LARICI', 'GALLERIA DELLE AQUILE', 'GALLERIA ROCCIA NERA'],
};
export function tunnelName(lang: string, seed: number): string {
  const list = NAMES[lang] ?? NAMES.it;
  return list[Math.abs(seed) % list.length];
}
