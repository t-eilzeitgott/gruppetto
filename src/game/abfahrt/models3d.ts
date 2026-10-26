/** Low-Poly-Modelle (Bäume, Felsen, Requisiten) und der 3D-Radfahrer */
import * as THREE from 'three';
import type { Kit } from './rider';

export type RGBf = [number, number, number];

const tmpColor = new THREE.Color();
/** sRGB-Hex → lineare Farbe für Vertexfarben */
export function lin(hex: string | number): RGBf {
  tmpColor.set(hex as THREE.ColorRepresentation);
  return [tmpColor.r, tmpColor.g, tmpColor.b];
}
export function lin255(r: number, g: number, b: number): RGBf {
  tmpColor.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  return [tmpColor.r, tmpColor.g, tmpColor.b];
}

/** Baukasten für nicht-indizierte Geometrie mit Vertexfarben und optional UVs */
export class GB {
  p: number[] = [];
  c: number[] = [];
  u: number[] = [];
  uv = false;
  get empty() { return this.p.length === 0; }
  vert(x: number, y: number, z: number, col: RGBf, s = 0, t = 0) {
    this.p.push(x, y, z);
    this.c.push(col[0], col[1], col[2]);
    this.u.push(s, t);
  }
  tri(a: number[], b: number[], c: number[], col: RGBf, ua?: number[], ub?: number[], uc?: number[]) {
    this.vert(a[0], a[1], a[2], col, ua?.[0], ua?.[1]);
    this.vert(b[0], b[1], b[2], col, ub?.[0], ub?.[1]);
    this.vert(c[0], c[1], c[2], col, uc?.[0], uc?.[1]);
  }
  /** Viereck a-b-c-d (gegen den Uhrzeigersinn von vorn gesehen) */
  quad(a: number[], b: number[], c: number[], d: number[], col: RGBf, uvs?: number[][]) {
    this.tri(a, b, c, col, uvs?.[0], uvs?.[1], uvs?.[2]);
    this.tri(a, c, d, col, uvs?.[0], uvs?.[2], uvs?.[3]);
  }
  /** fertige Three-Geometrie mit Transformation und Farbe einfügen */
  add(g: THREE.BufferGeometry, m: THREE.Matrix4, col: RGBf) {
    const src = g.index ? g.toNonIndexed() : g;
    const pos = src.getAttribute('position');
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      this.vert(v.x, v.y, v.z, col);
    }
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

const M = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) => {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  return m;
};

const TRUNK = lin('#5a3d27');

/** gezackter Kegel: Randpunkte unregelmäßig, leicht hängende Spitzen – wirkt wie Nadelzweige */
function jagCone(r: number, h: number, seg: number, seed: number, droop = 0.18): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, seg, 1, false);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (v.y < 0 && Math.hypot(v.x, v.z) > 0.01) {
      const a = Math.atan2(v.z, v.x);
      const k = 0.78 + 0.34 * Math.abs(Math.sin(a * 2.5 + seed * 1.7)) + 0.12 * Math.sin(a * 7 + seed);
      v.x *= k;
      v.z *= k;
      v.y -= droop * h * (0.6 + 0.4 * Math.sin(a * 3 + seed));
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }
  return g;
}

function pine(tiers: number, h: number, w: number, dark: string, light: string, snow: boolean): THREE.BufferGeometry {
  const b = new GB();
  b.add(new THREE.CylinderGeometry(0.1, 0.22, 2.4, 6), M(0, 1.2), TRUNK);
  const c0 = lin(dark);
  const c1 = lin(light);
  for (let t = 0; t < tiers; t++) {
    const k = t / (tiers - 1);
    const r = w * (1 - k * 0.8) * (0.92 + 0.12 * Math.sin(t * 2.1));
    const th = ((h - 1.6) / tiers) * 1.75;
    const y = 1.6 + k * (h - 1.6 - th * 0.6) + th / 2;
    const col: RGBf = [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    b.add(jagCone(r, th, 8, t * 3.1), M(0, y, 0, 1, 1, 1, t * 0.9), col);
    if (snow && t % 2 === 0) b.add(jagCone(r * 0.6, th * 0.42, 8, t * 3.1 + 1), M(0, y + th * 0.3, 0, 1, 1, 1, t * 0.9), lin('#f2f6fb'));
  }
  return b.build();
}

/** Laubbaum: mehrere unregelmäßige Blätterkugeln, innen dunkler */
function blobTree(crowns: [number, number, number, number][], trunkH: number, greens: string[]): THREE.BufferGeometry {
  const b = new GB();
  b.add(new THREE.CylinderGeometry(0.13, 0.26, trunkH, 6), M(0, trunkH / 2), TRUNK);
  b.add(new THREE.CylinderGeometry(0.06, 0.1, 1.6, 5), M(0.5, trunkH + 0.2, 0, 1, 1, 1, 0, 0, -0.7), TRUNK);
  crowns.forEach(([x, y, z, r], i) => {
    const g = new THREE.IcosahedronGeometry(r, 1);
    const pos = g.getAttribute('position');
    const v = new THREE.Vector3();
    for (let q = 0; q < pos.count; q++) {
      v.fromBufferAttribute(pos, q);
      const k = 0.86 + 0.2 * Math.abs(Math.sin(v.x * 3.1 + v.y * 2.3 + i) * Math.cos(v.z * 2.7 - i));
      pos.setXYZ(q, v.x * k, v.y * k * 0.88, v.z * k);
    }
    b.add(g, M(x, y, z, 1, 1, 1, i * 1.3), lin(greens[i % greens.length]));
  });
  return b.build();
}

/** einfache Fassungen der Bäume für weiter entfernte Landschaftskacheln (gleiche Umrisse, weniger Dreiecke) */
export function treeGeometriesLow(): Partial<Record<Prop3D, THREE.BufferGeometry>> {
  const lowPine = (h: number, w: number, dark: string, light: string, snow: boolean) => {
    const b = new GB();
    b.add(new THREE.CylinderGeometry(0.12, 0.22, 2.4, 4), M(0, 1.2), TRUNK);
    const c0 = lin(dark);
    const c1 = lin(light);
    for (let t = 0; t < 3; t++) {
      const k = t / 2;
      const th = ((h - 1.6) / 3) * 1.6;
      const y = 1.6 + k * (h - 1.6 - th * 0.6) + th / 2;
      const col: RGBf = [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
      b.add(jagCone(w * (1 - k * 0.75), th, 6, t * 3.1), M(0, y, 0, 1, 1, 1, t * 0.9), col);
      if (snow && t === 0) b.add(jagCone(w * 0.6, th * 0.42, 6, 1), M(0, y + th * 0.3), lin('#f2f6fb'));
    }
    return b.build();
  };
  const lowBlob = (crowns: [number, number, number, number][], trunkH: number, greens: string[]) => {
    const b = new GB();
    b.add(new THREE.CylinderGeometry(0.13, 0.26, trunkH, 4), M(0, trunkH / 2), TRUNK);
    crowns.forEach(([x, y, z, r], i) => b.add(new THREE.IcosahedronGeometry(r, 0), M(x, y, z, 1, 0.88, 1, i * 1.3), lin(greens[i % greens.length])));
    return b.build();
  };
  const cypress = new GB();
  cypress.add(new THREE.IcosahedronGeometry(1, 0), M(0, 4.6, 0, 0.72, 4.3, 0.72), lin('#2b4d27'));
  return {
    pine: lowPine(11, 2.6, '#1b4026', '#3a6f3a', false),
    pineSnow: lowPine(11, 2.6, '#1f4430', '#3d6b45', true),
    larch: lowPine(10.5, 2.1, '#557f2c', '#8fb54c', false),
    tree: lowBlob([[0, 5.3, 0, 2.5], [1.2, 4.5, 0.5, 1.8], [-1.1, 4.7, -0.5, 1.9]], 3.6, ['#4c8532', '#5f9a3d', '#3f752b']),
    treeRound: lowBlob([[0, 3.8, 0, 1.8]], 2.6, ['#5a983a']),
    cypress: cypress.build(),
  };
}

export type Prop3D = 'pine' | 'pineSnow' | 'larch' | 'tree' | 'treeRound' | 'cypress' | 'olive' | 'bush' | 'rock' | 'boulder'
  | 'snowpole' | 'hay' | 'vinerow' | 'fence' | 'lamp' | 'logs' | 'palm';

export function propGeometries(): Record<Prop3D, THREE.BufferGeometry> {
  const snowpole = new GB();
  for (let i = 0; i < 6; i++) snowpole.add(new THREE.CylinderGeometry(0.04, 0.04, 0.34, 6), M(0, 0.17 + i * 0.34), lin(i % 2 ? '#ffffff' : '#e03131'));
  const hay = new GB();
  hay.add(new THREE.CylinderGeometry(0.65, 0.65, 1.2, 12), M(0, 0.65, 0, 1, 1, 1, 0, 0, Math.PI / 2), lin('#d9b45a'));
  const vine = new GB();
  vine.add(new THREE.BoxGeometry(0.45, 1.2, 1.9), M(0, 0.8), lin('#5f8a2c'));
  vine.add(new THREE.BoxGeometry(0.5, 0.25, 1.95), M(0, 1.45), lin('#78a33a'));
  vine.add(new THREE.BoxGeometry(0.06, 1.7, 0.06), M(0, 0.85, 0.95), lin('#6b5240'));
  const fence = new GB();
  fence.add(new THREE.BoxGeometry(0.12, 1.15, 0.12), M(0, 0.575), lin('#7a5634'));
  const lamp = new GB();
  lamp.add(new THREE.CylinderGeometry(0.06, 0.09, 4.8, 6), M(0, 2.4), lin('#2d3238'));
  lamp.add(new THREE.BoxGeometry(0.08, 0.08, 0.7), M(0, 4.75, -0.32), lin('#2d3238'));
  lamp.add(new THREE.CylinderGeometry(0.12, 0.2, 0.3, 6), M(0, 4.6, -0.62), lin('#2d3238'));
  lamp.add(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 6), M(0, 4.44, -0.62), lin('#fff2c4'));
  const logs = new GB();
  for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - row; i++) {
    logs.add(new THREE.CylinderGeometry(0.22, 0.22, 2.4, 8), M((i - (3 - row) / 2) * 0.46, 0.22 + row * 0.4, 0, 1, 1, 1, Math.PI / 2, Math.PI / 2), lin(i % 2 ? '#a5784c' : '#b98c5a'));
  }
  const palm = new GB();
  for (let i = 0; i < 8; i++) palm.add(new THREE.CylinderGeometry(0.15, 0.18, 0.9, 6), M(i * 0.06, 0.45 + i * 0.85, 0, 1, 1, 1, 0, 0, -0.05), lin(i % 2 ? '#7a5a3a' : '#8a6a46'));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    palm.add(new THREE.BoxGeometry(2.6, 0.06, 0.55), M(0.5 + Math.cos(a) * 1.3, 7.1, Math.sin(a) * 1.3, 1, 1, 1, -a, 0, -0.35), lin(i % 2 ? '#3f7a32' : '#4f8f3c'));
  }
  const rock = new GB();
  rock.add(new THREE.DodecahedronGeometry(0.65, 0), M(0, 0.32, 0, 1, 0.7, 0.85), lin('#8e8a82'));
  const boulder = new GB();
  boulder.add(new THREE.DodecahedronGeometry(1.5, 0), M(0, 0.9, 0, 1, 0.75, 0.9, 0.4), lin('#8a867c'));
  boulder.add(new THREE.DodecahedronGeometry(0.9, 0), M(0.6, 1.7, 0.2, 1, 0.45, 0.8, 1.2), lin('#6f8a52'));
  const olive = new GB();
  olive.add(new THREE.CylinderGeometry(0.16, 0.3, 2.2, 6), M(0, 1.1, 0, 1, 1, 1, 0, 0.15, 0.1), lin('#6b5a48'));
  olive.add(new THREE.IcosahedronGeometry(1.3, 0), M(-0.4, 2.8, 0, 1, 0.65, 1), lin('#8f9c72'));
  olive.add(new THREE.IcosahedronGeometry(1.1, 0), M(0.6, 3.1, 0.3, 1, 0.65, 1), lin('#7c8b60'));
  const cypress = new GB();
  cypress.add(new THREE.CylinderGeometry(0.1, 0.14, 0.8, 5), M(0, 0.4), TRUNK);
  cypress.add(new THREE.IcosahedronGeometry(1, 1), M(0, 4.6, 0, 0.72, 4.3, 0.72), lin('#2b4d27'));
  const bush = new GB();
  bush.add(new THREE.IcosahedronGeometry(0.75, 0), M(0, 0.45, 0, 1.2, 0.75, 1), lin('#456f2e'));
  bush.add(new THREE.IcosahedronGeometry(0.55, 0), M(0.5, 0.55, 0.2, 1, 0.8, 1), lin('#5b8a3c'));
  return {
    pine: pine(6, 11, 2.6, '#1b4026', '#3a6f3a', false),
    pineSnow: pine(6, 11, 2.6, '#1f4430', '#3d6b45', true),
    larch: pine(6, 10.5, 2.1, '#557f2c', '#8fb54c', false),
    tree: blobTree([[0, 5.3, 0, 2.2], [1.3, 4.5, 0.6, 1.6], [-1.2, 4.7, -0.5, 1.7], [0.2, 6.4, -0.3, 1.4]], 3.6, ['#4c8532', '#5f9a3d', '#3f752b', '#6aa646']),
    treeRound: blobTree([[0, 3.7, 0, 1.6], [0.6, 4.4, 0.3, 1.0]], 2.6, ['#5a983a', '#6aa846']),
    cypress: cypress.build(),
    olive: olive.build(),
    bush: bush.build(),
    rock: rock.build(),
    boulder: boulder.build(),
    snowpole: snowpole.build(),
    hay: hay.build(),
    vinerow: vine.build(),
    fence: fence.build(),
    lamp: lamp.build(),
    logs: logs.build(),
    palm: palm.build(),
  };
}

// ------------------------------------------------------------------ Radfahrer

const matCache = new Map<string, THREE.MeshLambertMaterial>();
function mat(hex: string, emissive = false): THREE.MeshLambertMaterial {
  const key = `${hex}:${emissive}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
    if (emissive) { m.emissive = new THREE.Color(hex); m.emissiveIntensity = 0.8; }
    matCache.set(key, m);
  }
  return m;
}

const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 7);
UNIT_CYL.translate(0, 0.5, 0);
// Gliedmaßen und Rumpf als Kapseln (weichere Form)
const UNIT_CAP = new THREE.CapsuleGeometry(1, 1.2, 4, 10);
UNIT_CAP.translate(0, 1.6, 0);
UNIT_CAP.scale(1, 1 / 3.2, 1);
const UP = new THREE.Vector3(0, 1, 0);
const tv = new THREE.Vector3();
const tq = new THREE.Quaternion();

/** Zylinder-Mesh zwischen zwei Punkten ausrichten */
function setLimb(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, r: number) {
  tv.subVectors(b, a);
  const len = tv.length();
  m.position.copy(a);
  tq.setFromUnitVectors(UP, tv.normalize());
  m.quaternion.copy(tq);
  m.scale.set(r, len, r);
}

export interface RiderPose { lean: number; pedal: number; tuck: number; brake: number; light: number; roll?: number }

/** Trikot als Textur: Seitenteile, Kragen, Saum und Startnummer auf dem Rücken (u = 0,25 ist hinten) */
const jerseyCache = new Map<string, THREE.MeshLambertMaterial>();
function jerseyMat(kit: Kit): THREE.MeshLambertMaterial {
  const key = `${kit.jersey}|${kit.side}|${kit.number}`;
  const hit = jerseyCache.get(key);
  if (hit) return hit;
  const W = 256;
  const H = 128;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  c.fillStyle = kit.jersey;
  c.fillRect(0, 0, W, H);
  // Seitenteile (links und rechts) mit feinem Streifen
  c.fillStyle = kit.side;
  for (const u of [0, 0.5, 1]) {
    c.fillRect(u * W - 16, 0, 32, H);
    c.fillStyle = kit.jersey;
    c.fillRect(u * W - 3, 0, 6, H);
    c.fillStyle = kit.side;
  }
  // Saum unten, Kragen oben
  c.fillStyle = 'rgba(0,0,0,0.28)';
  c.fillRect(0, H - 12, W, 12);
  c.fillStyle = kit.side;
  c.fillRect(0, 0, W, 9);
  // Rückentaschen als dunklere Naht
  c.fillStyle = 'rgba(0,0,0,0.18)';
  c.fillRect(0, H - 40, W, 3);
  // Startnummer hinten
  for (const x of [W * 0.25]) {
    c.fillStyle = '#ffffff';
    c.fillRect(x - 26, 44, 52, 36);
    c.fillStyle = '#111111';
    c.font = '900 26px -apple-system, "SF Pro Display", Roboto, Arial, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(kit.number, x, 63);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  const m = new THREE.MeshLambertMaterial({ map: tex });
  jerseyCache.set(key, m);
  return m;
}

/** Glied mit Farbverlauf: unten dicker, oben schlanker; optional farbiger Abschluss (Socken, Handschuhe) */
function limbGeo(main: RGBf, end: RGBf | null, endFrom: number, taper: number, fist = 0): THREE.BufferGeometry {
  const g = new GB();
  const rAt = (t: number) => 1 - (1 - taper) * t;
  const part = (t0: number, t1: number, col: RGBf) => {
    const c = new THREE.CylinderGeometry(rAt(t1), rAt(t0), t1 - t0, 8, 1, true);
    c.translate(0, (t0 + t1) / 2, 0);
    g.add(c, M(), col);
  };
  if (end && endFrom < 1) { part(0, endFrom, main); part(endFrom, 1, end); } else part(0, 1, main);
  // Kappe unten (Gelenk) und oben
  g.add(new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M(0, 0, 0, 1, 0.12, 1), main);
  if (fist && end) g.add(new THREE.SphereGeometry(1, 7, 5), M(0, 1, 0, fist, fist * 0.16, fist), end);
  else g.add(new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), M(0, 1, 0, taper, 0.1, taper), end ?? main);
  return g.build();
}

export class RiderModel {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private torso: THREE.Mesh;
  private head: THREE.Group;
  private neck: THREE.Mesh;
  private limbs: THREE.Mesh[] = [];
  private shoes: THREE.Mesh[] = [];
  private wheelF: THREE.Mesh;
  private wheelR: THREE.Mesh;
  private crank: THREE.Group;
  readonly shadow: THREE.Mesh;
  readonly lamp: THREE.Mesh;
  kitKey = '';

  constructor(kit: Kit, shadowTex: THREE.Texture) {
    this.group.rotation.order = 'YXZ';
    this.group.add(this.body);
    const vmat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const smooth = new THREE.MeshLambertMaterial({ vertexColors: true });
    // --- Rahmen, Gabel, Lenker, Sattel, Antrieb (ein Mesh)
    const frame = new GB();
    const tube = (a: number[], b: number[], r: number, col: RGBf, rx = r, seg = 6) => {
      const va = new THREE.Vector3(...a);
      const vb = new THREE.Vector3(...b);
      const d = vb.clone().sub(va);
      const geo = new THREE.CylinderGeometry(1, 1, 1, seg);
      geo.translate(0, 0.5, 0);
      const m = new THREE.Matrix4().compose(va, new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize()), new THREE.Vector3(rx, d.length(), r));
      frame.add(geo, m, col);
    };
    const fc = lin(kit.jersey);
    const accent = lin(kit.side);
    const dark = lin('#18191c');
    const carbon = lin('#2a2c31');
    const alu = lin('#a9afb6');
    const BB = [0, 0.3, 0.02];
    const HT = [0, 0.82, -0.4];
    // Hauptrahmen (aero: etwas abgeflacht)
    tube(BB, [0, 0.86, 0.2], 0.024, fc, 0.016);            // Sitzrohr
    tube([0, 0.8, 0.19], HT, 0.019, fc, 0.015);            // Oberrohr
    tube(BB, [0, 0.76, -0.41], 0.028, fc, 0.019);          // Unterrohr
    tube(BB, [0, 0.335, 0.49], 0.015, fc);                 // Kettenstreben
    tube([0, 0.8, 0.19], [0, 0.335, 0.49], 0.013, fc);     // Sitzstreben
    tube([0, 0.7, -0.38], [0, 0.88, -0.44], 0.027, fc, 0.022); // Steuerrohr
    tube([0, 0.71, -0.385], [0, 0.335, -0.52], 0.017, fc, 0.012); // Gabel
    // Akzentstreifen auf dem Unterrohr
    tube([0, 0.47, -0.12], [0, 0.6, -0.25], 0.0295, accent, 0.0205);
    // Sattelstütze und Sattel (nach hinten breiter)
    tube([0, 0.84, 0.2], [0, 0.93, 0.235], 0.012, carbon);
    const saddle = new THREE.CylinderGeometry(0.03, 0.075, 0.27, 7, 1);
    frame.add(saddle, M(0, 0.945, 0.22, 1, 1, 0.22, 0, -(Math.PI / 2 - 0.05)), dark);
    // Vorbau und Rennlenker mit Unterlenker
    tube([0, 0.88, -0.44], [0, 0.9, -0.55], 0.014, carbon);
    tube([-0.2, 0.9, -0.56], [0.2, 0.9, -0.56], 0.012, dark, 0.012, 6);
    for (const sx of [-1, 1]) {
      const x = sx * 0.2;
      tube([x, 0.9, -0.56], [x, 0.9, -0.66], 0.012, dark);         // nach vorn
      tube([x, 0.9, -0.66], [x, 0.8, -0.67], 0.012, dark);         // Bogen runter
      tube([x, 0.8, -0.67], [x, 0.76, -0.6], 0.012, dark);         // Unterlenker zurück
      tube([x, 0.9, -0.62], [x, 0.96, -0.64], 0.017, dark, 0.014); // Bremsgriff (Hood)
    }
    // Flaschenhalter mit Bidon
    tube([0, 0.43, -0.06], [0, 0.61, -0.24], 0.034, lin('#e8eef5'));
    tube([0, 0.61, -0.24], [0, 0.635, -0.265], 0.016, dark);
    // Antrieb: Kassette, Schaltwerk, Kette
    frame.add(new THREE.CylinderGeometry(0.06, 0.06, 0.035, 12), M(0.045, 0.335, 0.49, 1, 1, 1, 0, 0, Math.PI / 2), alu);
    frame.add(new THREE.BoxGeometry(0.02, 0.09, 0.05), M(0.06, 0.26, 0.5), dark);
    tube([0.05, 0.395, 0.49], [0.05, 0.385, 0.02], 0.005, alu, 0.005, 4);
    tube([0.05, 0.215, 0.5], [0.05, 0.21, 0.02], 0.005, alu, 0.005, 4);
    this.body.add(new THREE.Mesh(frame.build(), vmat));
    // --- Laufräder: Hochprofilfelge, Reifen, Speichen (drehen sich)
    const wheel = () => {
      const w = new GB();
      w.add(new THREE.TorusGeometry(0.325, 0.017, 6, 28), M(0, 0, 0, 1, 1, 1, Math.PI / 2), dark);                 // Reifen
      w.add(new THREE.CylinderGeometry(0.31, 0.31, 0.022, 28, 1, true), M(0, 0, 0, 1, 1, 1, 0, 0, Math.PI / 2), carbon); // Felgenflanke außen
      w.add(new THREE.CylinderGeometry(0.255, 0.255, 0.016, 28, 1, true), M(0, 0, 0, 1, 1, 1, 0, 0, Math.PI / 2), carbon);
      w.add(new THREE.RingGeometry(0.255, 0.31, 28, 1), M(0.0112, 0, 0, 1, 1, 1, Math.PI / 2), carbon);
      w.add(new THREE.RingGeometry(0.255, 0.31, 28, 1), M(-0.0112, 0, 0, 1, 1, 1, -Math.PI / 2), carbon);
      // Felgen-Schriftzug in Akzentfarbe (zwei Bögen)
      for (const a0 of [0.4, 0.4 + Math.PI]) w.add(new THREE.RingGeometry(0.272, 0.292, 8, 1, a0, 1.1), M(0.0118, 0, 0, 1, 1, 1, Math.PI / 2), accent);
      for (const a0 of [0.4, 0.4 + Math.PI]) w.add(new THREE.RingGeometry(0.272, 0.292, 8, 1, a0, 1.1), M(-0.0118, 0, 0, 1, 1, 1, -Math.PI / 2), accent);
      // Speichen und Nabe
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const sx = k % 2 ? 0.012 : -0.012;
        const spoke = new THREE.CylinderGeometry(0.0022, 0.0022, 0.24, 3);
        spoke.translate(0, 0.135, 0);
        const m = new THREE.Matrix4().makeRotationX(a);
        m.premultiply(new THREE.Matrix4().makeTranslation(sx * 0.4, 0, 0));
        w.add(spoke, m, alu);
      }
      w.add(new THREE.CylinderGeometry(0.022, 0.022, 0.07, 8), M(0, 0, 0, 1, 1, 1, 0, 0, Math.PI / 2), alu);
      return new THREE.Mesh(w.build(), smooth);
    };
    this.wheelF = wheel();
    this.wheelF.position.set(0, 0.335, -0.52);
    this.wheelR = wheel();
    this.wheelR.position.set(0, 0.335, 0.49);
    this.body.add(this.wheelF, this.wheelR);
    // --- Kurbel mit Kettenblatt und Pedalen (dreht sich mit dem Tritt)
    const cr = new GB();
    cr.add(new THREE.CylinderGeometry(0.105, 0.105, 0.012, 22), M(0.05, 0, 0, 1, 1, 1, 0, 0, Math.PI / 2), carbon);
    cr.add(new THREE.TorusGeometry(0.105, 0.006, 3, 22), M(0.05, 0, 0, 1, 1, 1, Math.PI / 2), alu);
    for (const sx of [-1, 1]) {
      const arm = new THREE.BoxGeometry(0.018, 0.03, 0.17);
      arm.translate(0, 0, -0.085 * sx);
      cr.add(arm, M(sx * 0.085), dark);
      cr.add(new THREE.BoxGeometry(0.08, 0.016, 0.06), M(sx * 0.125, 0, -0.17 * sx), dark);
    }
    this.crank = new THREE.Group();
    this.crank.add(new THREE.Mesh(cr.build(), vmat));
    this.crank.position.set(BB[0], BB[1], BB[2]);
    this.body.add(this.crank);
    // --- Fahrer: Trikot mit Textur
    this.torso = new THREE.Mesh(UNIT_CAP, jerseyMat(kit));
    this.body.add(this.torso);
    const skin = lin(kit.skin);
    this.neck = new THREE.Mesh(UNIT_CYL, mat(kit.skin));
    this.body.add(this.neck);
    // Kopf: Helm mit Lüftungsschlitzen, Brille, Ohren
    const head = new GB();
    head.add(new THREE.IcosahedronGeometry(0.095, 2), M(0, -0.02, 0, 1, 1.05, 1.08), skin);
    for (const sx of [-1, 1]) head.add(new THREE.SphereGeometry(0.022, 5, 4), M(sx * 0.094, -0.03, 0.01, 0.5, 1, 1), skin);
    const helmet = lin(kit.helmet);
    head.add(new THREE.SphereGeometry(0.128, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), M(0, 0.005, 0.03, 1, 0.86, 1.3), helmet);
    for (const sx of [-0.055, 0, 0.055]) head.add(new THREE.BoxGeometry(0.018, 0.012, 0.2), M(sx, 0.1, 0.03, 1, 1, 1, 0, -0.1), dark);
    head.add(new THREE.CylinderGeometry(0.129, 0.129, 0.02, 14, 1, true), M(0, 0.0, 0.025, 1, 1, 1.32), lin(kit.side));
    // Sonnenbrille als Bügel vorn und seitlich
    head.add(new THREE.CylinderGeometry(0.1, 0.1, 0.032, 12, 1, true, Math.PI * 0.62, Math.PI * 0.76), M(0, -0.015, 0, 1, 1, 1.08), lin('#0f1012'));
    this.head = new THREE.Group();
    this.head.add(new THREE.Mesh(head.build(), smooth));
    this.body.add(this.head);
    // Beine und Arme mit Farbverlauf (Socken, Handschuhe)
    const shorts = lin(kit.shorts);
    const jersey = lin(kit.jersey);
    const sock = lin('#f4f4f2');
    const glove = lin('#202124');
    const thigh = limbGeo(shorts, null, 1, 0.78);
    const calf = limbGeo(skin, sock, 0.8, 0.6);
    const upperArm = limbGeo(jersey, skin, 0.55, 0.82);
    const foreArm = limbGeo(skin, glove, 0.8, 0.75, 1.25);
    for (const g of [thigh, calf, thigh, calf, upperArm, foreArm, upperArm, foreArm]) {
      const l = new THREE.Mesh(g, smooth);
      this.limbs.push(l);
      this.body.add(l);
    }
    // Schuhe: spitz zulaufend, mit Sohle
    const shoe = new GB();
    shoe.add(new THREE.BoxGeometry(0.09, 0.06, 0.22), M(0, 0.01, 0), lin(kit.shoes));
    shoe.add(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 6, 1, false, 0, Math.PI), M(0, 0.01, -0.11, 1, 1, 0.8, 0, Math.PI / 2, 0), lin(kit.shoes));
    shoe.add(new THREE.BoxGeometry(0.092, 0.016, 0.25), M(0, -0.025, -0.01), dark);
    const shoeGeo = shoe.build();
    for (let i = 0; i < 2; i++) {
      const s = new THREE.Mesh(shoeGeo, vmat);
      this.shoes.push(s);
      this.body.add(s);
    }
    this.lamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.02), mat('#ff2a2a', true));
    this.lamp.position.set(0, 0.86, 0.24);
    this.body.add(this.lamp);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.3 }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.03;
    this.shadow.renderOrder = 1;
    this.group.add(this.shadow);
    this.kitKey = kit.jersey + kit.helmet;
    // alle Teile von Fahrer und Rad werfen Sonnenschatten (außer dem weichen Bodenschatten)
    this.body.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
  }

  private hip = new THREE.Vector3();
  private sh = new THREE.Vector3();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private k = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private perp = new THREE.Vector3();

  pose(p: RiderPose) {
    const tuck = Math.max(0, Math.min(1, p.tuck - p.brake * 0.6));
    this.body.rotation.z = -p.lean;
    if (p.roll !== undefined) { this.wheelF.rotation.x = -p.roll; this.wheelR.rotation.x = -p.roll; }
    this.crank.rotation.x = p.pedal;
    // Oberkörper: Hüfte am Sattel, Schultern vorn; geduckt flach über dem Oberrohr
    this.hip.set(0, 0.99, 0.2);
    this.sh.set(0, 1.4 - tuck * 0.27, -0.12 - tuck * 0.18);
    setLimb(this.torso, this.hip, this.sh, 0.16);
    this.torso.scale.x = 0.185;
    this.torso.scale.z = 0.125;
    // Hals und Kopf: Blick nach vorn
    const hy = this.sh.y + 0.12 - tuck * 0.05;
    const hz = this.sh.z - 0.1 - tuck * 0.05;
    this.a.set(0, this.sh.y - 0.02, this.sh.z + 0.02);
    this.b.set(0, hy - 0.04, hz + 0.02);
    setLimb(this.neck, this.a, this.b, 0.045);
    this.head.position.set(0, hy, hz);
    this.head.rotation.x = -0.25 - tuck * 0.35;
    // Beine: Kurbel 17 cm, Knie per Zweigelenk-Rechnung
    const L1 = 0.46;
    const L2 = 0.46;
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      const ang = p.pedal + (s === 0 ? 0 : Math.PI);
      this.a.set(side * 0.1, this.hip.y - 0.03, this.hip.z);
      this.b.set(side * 0.125, 0.3 + Math.sin(ang) * 0.17, 0.02 - Math.cos(ang) * 0.17);
      const d = Math.min(L1 + L2 - 0.01, this.a.distanceTo(this.b));
      this.dir.subVectors(this.b, this.a).normalize();
      const foot = this.b.copy(this.a).addScaledVector(this.dir, d);
      const h = Math.sqrt(Math.max(0, L1 * L1 - (d / 2) * (d / 2)));
      // Knie zeigt nach vorn-oben
      this.perp.set(0, -this.dir.z, this.dir.y).normalize();
      if (this.perp.z > 0) this.perp.negate();
      this.k.copy(this.a).addScaledVector(this.dir, d / 2).addScaledVector(this.perp, h);
      this.k.x = side * 0.135;
      setLimb(this.limbs[s * 2], this.a, this.k, 0.072);
      setLimb(this.limbs[s * 2 + 1], this.k, foot, 0.055);
      this.shoes[s].position.set(foot.x, foot.y - 0.03, foot.z - 0.03);
      this.shoes[s].rotation.x = -0.15 + Math.sin(ang) * 0.12;
    }
    // Arme: auf den Griffen, geduckt Ellbogen weiter gebeugt
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      this.a.set(side * 0.175, this.sh.y - 0.03, this.sh.z + 0.03);
      this.b.set(side * 0.2, 0.93 - tuck * 0.02, -0.6 - tuck * 0.02);
      this.k.set(side * (0.24 + tuck * 0.04), (this.a.y + this.b.y) / 2 - 0.04 - tuck * 0.04, (this.a.z + this.b.z) / 2 + 0.07);
      setLimb(this.limbs[4 + s * 2], this.a, this.k, 0.052);
      setLimb(this.limbs[5 + s * 2], this.k, this.b, 0.042);
    }
    (this.lamp.material as THREE.MeshLambertMaterial).emissiveIntensity = 0.4 + p.light * 1.6;
  }

  /** Sturz: Rad und Fahrer kippen und überschlagen sich */
  crash(t: number, spin: number) {
    this.body.rotation.z = Math.min(1.45, t * 3);
    this.body.rotation.x = spin * 0.6;
    this.body.position.y = Math.max(0, Math.sin(Math.min(1, t / 0.7) * Math.PI) * 0.7);
  }

  resetCrash() {
    this.body.rotation.x = 0;
    this.body.position.y = 0;
  }
}
