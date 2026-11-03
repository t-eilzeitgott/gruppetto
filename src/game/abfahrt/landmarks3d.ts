/**
 * Dinge in der Landschaft zum Entdecken: Almhütten, Heustadel, Kapellen mit Glockenturm auf Kuppen,
 * Bauernhöfe im Tal und selten eine Burgruine. Sie stehen auf einem groben Raster (64 m) an festen Stellen
 * der Welt – gleiche Strecke, gleiche Hütten. Die Modelle sind schlicht (Eckpunktfarben), aber mit Dachüberstand,
 * Fenstern, Holzbalken, Kamin und Turmhelm, damit sie auch aus der Ferne als das erkennbar sind, was sie sind.
 */
import * as THREE from 'three';
import { GB, lin, type RGBf } from './models3d';

export type Landmark = 'hut' | 'barn' | 'chapel' | 'farm' | 'ruin' | 'sheep';

const M = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

/** Satteldach über einem Rechteck (Breite w quer, Länge l, Traufhöhe h0, First h1), mit Überstand o */
function roof(g: GB, w: number, l: number, h0: number, h1: number, o: number, col: RGBf, x = 0, z = 0) {
  const W = w / 2 + o;
  const L = l / 2 + o;
  const drop = (h1 - h0) * (o / (w / 2));
  const a = [x - W, h0 - drop, z - L], b = [x - W, h0 - drop, z + L], c = [x, h1, z + L], d = [x, h1, z - L];
  const e = [x + W, h0 - drop, z - L], f = [x + W, h0 - drop, z + L];
  g.quad(a, b, c, d, col);
  g.quad(f, e, d, c, [col[0] * 0.86, col[1] * 0.86, col[2] * 0.86]);
  // Giebel
  const gw = [0.9, 0.86, 0.8] as RGBf;
  void gw;
}

/** Giebeldreiecke (Wandfarbe) an beiden Enden */
function gables(g: GB, w: number, l: number, h0: number, h1: number, col: RGBf, x = 0, z = 0) {
  for (const s of [-1, 1]) g.tri([x - w / 2, h0, z + s * l / 2], [x + w / 2, h0, z + s * l / 2], [x, h1, z + s * l / 2], col);
}

/** Fenster als dunkle Flächen knapp vor der Wand (n Stück entlang der Längsseiten, Höhe y) */
function windows(g: GB, w: number, l: number, y: number, n: number, col: RGBf, frame?: RGBf) {
  for (const s of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const z = -l / 2 + (l * (i + 0.5)) / n;
      const x = s * (w / 2 + 0.02);
      if (frame) g.quad([x, y - 0.55, z - 0.42], [x, y - 0.55, z + 0.42], [x, y + 0.55, z + 0.42], [x, y + 0.55, z - 0.42], frame);
      const xx = s * (w / 2 + 0.04);
      g.quad([xx, y - 0.45, z - 0.32], [xx, y - 0.45, z + 0.32], [xx, y + 0.45, z + 0.32], [xx, y + 0.45, z - 0.32], col);
    }
  }
}

/**
 * Glockenturm der Kapelle (vorn über dem Eingang, Mitte z = 4,6, 2,4 m breit): Bruchsteinsockel, graue Eckquader im
 * Wechsel lang und kurz, Rundbogenfenster, Uhr über dem Eingang, Gesims unter der Glockenstube, Schallöffnungen mit
 * Rundbogen und Glocke auf allen vier Seiten, Traufgesims, achteckiger Spitzhelm mit Kugel und Kreuz.
 */
function chapelTower(g: GB, white: RGBf) {
  const zc = 4.6, hw = 1.2, top = 9.4;
  const grey = lin('#b7b0a2');
  const dark = lin('#26211d');
  const gold = lin('#c9a94a');
  /** Punkt auf Seite k (0: +z, 1: +x, 2: −z, 3: −x): s waagrecht, y hoch, d vor der Wand */
  const F = (k: number, s: number, y: number, d = 0): number[] => {
    const e = hw + d;
    return k === 0 ? [s, y, zc + e] : k === 1 ? [e, y, zc - s] : k === 2 ? [-s, y, zc - e] : [-e, y, zc + s];
  };
  const rect = (k: number, s0: number, s1: number, y0: number, y1: number, d: number, c: RGBf) => g.quad(F(k, s0, y0, d), F(k, s1, y0, d), F(k, s1, y1, d), F(k, s0, y1, d), c);
  const arch = (k: number, s: number, y0: number, ye: number, r: number, d: number, c: RGBf) => {
    rect(k, s - r, s + r, y0, ye, d, c);
    for (let i = 0; i < 5; i++) {
      const a0 = (Math.PI * i) / 5, a1 = (Math.PI * (i + 1)) / 5;
      g.tri(F(k, s, ye, d), F(k, s + Math.cos(a0) * r, ye + Math.sin(a0) * r, d), F(k, s + Math.cos(a1) * r, ye + Math.sin(a1) * r, d), c);
    }
  };
  /** Band rund um den Turm (Stirn und Oberseite), d vor der Wand */
  const band = (y0: number, y1: number, d: number, c: RGBf) => {
    for (let k = 0; k < 4; k++) {
      g.quad(F(k, -hw - d, y0, d), F(k, hw + d, y0, d), F(k, hw + d, y1, d), F(k, -hw - d, y1, d), c);
      g.quad(F(k, -hw - d, y1, d), F(k, hw + d, y1, d), F(k, hw, y1 + d * 0.4, 0), F(k, -hw, y1 + d * 0.4, 0), c);
      g.quad(F(k, -hw, y0 - d * 0.5, 0), F(k, hw, y0 - d * 0.5, 0), F(k, hw + d, y0, d), F(k, -hw - d, y0, d), [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8]);
    }
  };
  // Schaft und Sockel
  for (let k = 0; k < 4; k++) rect(k, -hw, hw, -0.3, top, 0, white);
  band(-0.3, 0.85, 0.08, grey);
  band(6.75, 6.95, 0.12, grey);
  band(top - 0.3, top, 0.2, grey);
  // Eckquader: je Lage abwechselnd lang auf der einen, kurz auf der anderen Seite
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < 11; i++) {
      const y0 = 1.0 + i * 0.52, y1 = y0 + 0.44;
      if (y1 > 6.7) break;
      // an jeder Ecke ist je Lage genau eine Seite lang (Seite k endet rechts dort, wo Seite k + 1 links beginnt)
      const long = (i + k) % 2 === 0;
      rect(k, hw - (long ? 0.55 : 0.32), hw + 0.03, y0, y1, 0.03, grey);
      rect(k, -hw - 0.03, -hw + (long ? 0.55 : 0.32), y0, y1, 0.03, grey);
    }
  }
  // Rundbogenfenster und Uhr
  for (let k = 1; k < 4; k++) {
    arch(k, 0, 2.5, 3.5, 0.32, 0.015, grey);
    arch(k, 0, 2.62, 3.5, 0.2, 0.03, dark);
  }
  {
    const yc = 5.55, rc = 0.52;
    rect(0, -rc - 0.16, rc + 0.16, yc - rc - 0.16, yc + rc + 0.16, 0.02, grey);
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * Math.PI * 2, a1 = ((i + 1) / 12) * Math.PI * 2;
      const P = (a: number, r: number, d: number) => F(0, Math.cos(a) * r, yc + Math.sin(a) * r, d);
      g.tri(F(0, 0, yc, 0.04), P(a0, rc, 0.04), P(a1, rc, 0.04), lin('#f4f0e6'));
      g.quad(P(a0, rc, 0.045), P(a1, rc, 0.045), P(a1, rc + 0.07, 0.045), P(a0, rc + 0.07, 0.045), dark);
    }
    const hand = (a: number, len: number, w: number) => {
      const c = Math.cos(a), sn = Math.sin(a);
      const Q = (r: number, ww: number) => F(0, c * r - sn * ww, yc + sn * r + c * ww, 0.055);
      g.quad(Q(-0.06, -w), Q(len, -w * 0.4), Q(len, w * 0.4), Q(-0.06, w), dark);
    };
    hand(Math.PI / 2 - (10.2 / 12) * Math.PI * 2, rc * 0.55, 0.045);
    hand(Math.PI / 2 - (10 / 60) * Math.PI * 2, rc * 0.85, 0.03);
  }
  // Glockenstube: Schallöffnungen mit Rundbogen, Glocke im Dunkel, Sohlbank
  for (let k = 0; k < 4; k++) {
    arch(k, 0, 7.25, 8.25, 0.52, 0.015, grey);
    arch(k, 0, 7.35, 8.25, 0.4, 0.03, dark);
    const bc = lin('#7a6330');
    const prof: [number, number][] = [[0.07, 8.22], [0.16, 8.16], [0.2, 7.98], [0.24, 7.78], [0.32, 7.64]];
    for (let i = 0; i + 1 < prof.length; i++) {
      const [w0, y0] = prof[i], [w1, y1] = prof[i + 1];
      g.quad(F(k, -w1, y1, 0.04), F(k, w1, y1, 0.04), F(k, w0, y0, 0.04), F(k, -w0, y0, 0.04), bc);
    }
    g.quad(F(k, -0.62, 7.12, 0.0), F(k, 0.62, 7.12, 0.0), F(k, 0.62, 7.12, 0.14), F(k, -0.62, 7.12, 0.14), grey);
    g.quad(F(k, -0.62, 7.0, 0.14), F(k, 0.62, 7.0, 0.14), F(k, 0.62, 7.12, 0.14), F(k, -0.62, 7.12, 0.14), grey);
  }
  // Spitzhelm: achteckig, Kanten parallel zu den Wänden, mit Traufe über dem Gesims
  const helm = lin('#4f585b');
  const hb = hw + 0.26;
  const R8 = hb / Math.cos(Math.PI / 8);
  const y0 = top + 0.06, tip = top + 5.2;
  const oct = (i: number) => {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    return [Math.cos(a) * R8, Math.sin(a) * R8];
  };
  for (let i = 0; i < 8; i++) {
    const [x0, z0] = oct(i), [x1, z1] = oct(i + 1);
    g.tri([x0, y0, zc + z0], [x1, y0, zc + z1], [0, tip, zc], [helm[0] * (0.92 + (i % 2) * 0.08), helm[1] * (0.92 + (i % 2) * 0.08), helm[2] * (0.92 + (i % 2) * 0.08)]);
    g.quad([x0, y0 - 0.12, zc + z0], [x1, y0 - 0.12, zc + z1], [x1, y0, zc + z1], [x0, y0, zc + z0], [helm[0] * 0.7, helm[1] * 0.7, helm[2] * 0.7]);
  }
  // Kugel und Kreuz
  g.add(new THREE.SphereGeometry(0.16, 6, 4), M(0, tip + 0.2, zc), gold);
  g.add(new THREE.BoxGeometry(0.07, 1.1, 0.07), M(0, tip + 0.75, zc), gold);
  g.add(new THREE.BoxGeometry(0.55, 0.07, 0.07), M(0, tip + 0.98, zc), gold);
}

export function landmarkGeometries(): Record<Landmark, THREE.BufferGeometry> {
  const glass = lin('#2a3038');
  // Almhütte: Steinsockel, Holz darüber, flaches Schindeldach mit Steinen, Kamin
  const hut = new GB();
  hut.add(new THREE.BoxGeometry(6, 2.2, 8), M(0, 0.6), lin('#a9a296'));
  hut.add(new THREE.BoxGeometry(6, 2.6, 8), M(0, 3.0), lin('#7a5234'));
  for (let i = 0; i < 5; i++) hut.add(new THREE.BoxGeometry(6.06, 0.08, 8.06), M(0, 1.9 + i * 0.55), lin('#5e3e26'));
  gables(hut, 6, 8, 4.3, 6.1, lin('#7a5234'));
  roof(hut, 6, 8, 4.3, 6.1, 0.9, lin('#6d6a66'));
  hut.add(new THREE.BoxGeometry(0.6, 1.6, 0.6), M(1.4, 6.0, 1.5), lin('#8d877c'));
  windows(hut, 6, 8, 3.1, 2, glass, lin('#f0ece2'));
  hut.add(new THREE.BoxGeometry(1.1, 1.9, 0.08), M(0, 1.0, 4.04), lin('#4a3020'));
  // Heustadel: dunkles Holz mit Lattenspalten, steiles Dach
  const barn = new GB();
  barn.add(new THREE.BoxGeometry(5, 4, 6), M(0, 1.8), lin('#5f4026'));
  for (let i = 0; i < 9; i++) barn.add(new THREE.BoxGeometry(5.04, 0.06, 6.04), M(0, 0.2 + i * 0.44), lin('#3b2716'));
  gables(barn, 5, 6, 3.8, 6.4, lin('#5a3c24'));
  roof(barn, 5, 6, 3.8, 6.4, 0.6, lin('#4d4844'));
  barn.add(new THREE.BoxGeometry(1.8, 2.2, 0.08), M(0, 1.1, 3.04), lin('#3a2614'));
  // Kapelle: weiße Wände, Apsis, steiles Dach, Glockenturm mit Spitzhelm und Schallöffnungen
  const chapel = new GB();
  const white = lin('#efe9dc');
  chapel.add(new THREE.BoxGeometry(5, 5, 8), M(0, 2.3), white);
  chapel.add(new THREE.CylinderGeometry(2.3, 2.3, 4.6, 10, 1, false, 0, Math.PI), M(0, 2.1, -4, 1, 1, 1, Math.PI / 2), white);
  gables(chapel, 5, 8, 4.8, 7.4, white);
  roof(chapel, 5, 8, 4.8, 7.4, 0.5, lin('#9a3b2a'));
  chapel.add(new THREE.ConeGeometry(2.5, 1.6, 10, 1, false, 0, Math.PI), M(0, 5.2, -4, 1, 1, 1, Math.PI / 2), lin('#9a3b2a'));
  chapelTower(chapel, white);
  chapel.add(new THREE.BoxGeometry(1.4, 2.6, 0.08), M(0, 1.3, 5.82), lin('#5a3a22'));
  windows(chapel, 5, 8, 3.0, 2, lin('#3e4a5a'));
  // Bauernhof: großes Wohnhaus (weiß unten, Holz oben mit Balkon), angebaute Scheune
  const farm = new GB();
  farm.add(new THREE.BoxGeometry(9, 3.4, 10), M(0, 1.5), lin('#ece4d2'));
  farm.add(new THREE.BoxGeometry(9, 3, 10), M(0, 4.7), lin('#8a5a34'));
  gables(farm, 9, 10, 6.2, 8.4, lin('#8a5a34'));
  roof(farm, 9, 10, 6.2, 8.4, 1.3, lin('#6a6560'));
  windows(farm, 9, 10, 1.9, 3, glass, lin('#2e5a3a'));
  windows(farm, 9, 10, 4.8, 3, glass, lin('#f0ece2'));
  for (const s of [-1, 1]) {
    farm.add(new THREE.BoxGeometry(0.9, 0.12, 10.4), M(s * 5.0, 3.6), lin('#5e3e26'));
    farm.add(new THREE.BoxGeometry(0.06, 0.9, 10.4), M(s * 5.42, 4.1), lin('#5e3e26'));
    for (let i = 0; i < 6; i++) farm.add(new THREE.BoxGeometry(0.2, 0.25, 0.35), M(s * 5.3, 4.65, -4 + i * 1.6), lin(i % 2 ? '#d63031' : '#e84393'));
  }
  farm.add(new THREE.BoxGeometry(8, 5.5, 9), M(0, 2.5, -9.5), lin('#6a4628'));
  gables(farm, 8, 9, 5.2, 7.6, lin('#6a4628'), 0, -9.5);
  roof(farm, 8, 9, 5.2, 7.6, 0.9, lin('#5a5550'), 0, -9.5);
  farm.add(new THREE.BoxGeometry(3, 3.2, 0.08), M(0, 1.6, -14.04), lin('#3a2614'));
  // Burgruine: runder Bergfried mit Zinnen und Fensterschlitzen, Mauerreste
  const ruin = new GB();
  const stone = lin('#a39a8a');
  ruin.add(new THREE.CylinderGeometry(3.2, 3.6, 15, 12), M(0, 7), stone);
  for (let i = 0; i < 12; i += 2) {
    const a = (i / 12) * Math.PI * 2;
    ruin.add(new THREE.BoxGeometry(1.3, 1.2, 0.9), M(Math.cos(a) * 3.0, 15.1, Math.sin(a) * 3.0, 1, 1, 1, -a + Math.PI / 2), stone);
  }
  for (const [y, a] of [[6, 0.3], [9.5, 2.2], [12, 4.1]] as const) ruin.add(new THREE.BoxGeometry(0.35, 1.3, 0.1), M(Math.cos(a) * 3.42, y, Math.sin(a) * 3.42, 1, 1, 1, -a + Math.PI / 2), lin('#2b2622'));
  ruin.add(new THREE.BoxGeometry(14, 5, 1.6), M(8, 2, 0, 1, 1, 1, 0.3), stone);
  ruin.add(new THREE.BoxGeometry(1.6, 3.4, 9), M(14, 1.2, 3.8, 1, 1, 1, 0.3), lin('#968d7e'));
  ruin.add(new THREE.BoxGeometry(5, 7, 1.6), M(-4.5, 3, 4.5, 1, 1, 1, -0.6), lin('#968d7e'));
  // Schaf: wolliger Körper, dunkler Kopf, vier Beine (grast mit gesenktem Kopf)
  const sheep = new GB();
  sheep.add(new THREE.IcosahedronGeometry(0.5, 1), M(0, 0.72, 0, 0.75, 0.68, 1.15), lin('#ece8de'));
  sheep.add(new THREE.SphereGeometry(0.17, 6, 5), M(0, 0.55, -0.62, 0.9, 1, 1.25), lin('#2b2622'));
  for (const [x, z] of [[-0.18, -0.32], [0.18, -0.32], [-0.18, 0.32], [0.18, 0.32]] as const) sheep.add(new THREE.BoxGeometry(0.08, 0.45, 0.08), M(x, 0.22, z), lin('#2b2622'));
  return { hut: hut.build(), barn: barn.build(), chapel: chapel.build(), farm: farm.build(), ruin: ruin.build(), sheep: sheep.build() };
}

/** Raster der möglichen Standorte (m) */
export const MARK_CELL = 64;
const hashC = (i: number, j: number, s: number) => {
  let h = Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(s, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Kandidat in Rasterzelle (i, j): Lage und Würfelwerte – oder null (die allermeisten Zellen bleiben leer) */
export function markCandidate(i: number, j: number, seed: number): { x: number; z: number; r1: number; r2: number } | null {
  if (hashC(i, j, seed) > 0.07) return null;
  return { x: (i + 0.25 + 0.5 * hashC(i + 7, j, seed)) * MARK_CELL, z: (j + 0.25 + 0.5 * hashC(i, j + 11, seed)) * MARK_CELL, r1: hashC(i + 3, j + 5, seed), r2: hashC(i + 13, j + 2, seed) };
}

/** Steht an (x, z) ein Kandidat (dann dort keine Bäume)? */
export function nearMark(x: number, z: number, seed: number, r = 22): boolean {
  const i = Math.floor(x / MARK_CELL);
  const j = Math.floor(z / MARK_CELL);
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const c = markCandidate(i + di, j + dj, seed);
      if (c && Math.hypot(c.x - x, c.z - z) < r) return true;
    }
  }
  return false;
}
