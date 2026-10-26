/** Low-Poly-Modelle (Bäume, Felsen, Requisiten) und der 3D-Radfahrer */
import * as THREE from 'three';

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
