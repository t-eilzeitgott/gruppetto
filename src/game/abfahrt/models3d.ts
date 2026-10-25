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

function pine(tiers: number, h: number, w: number, greens: string[], snow: boolean): THREE.BufferGeometry {
  const b = new GB();
  b.add(new THREE.CylinderGeometry(0.12, 0.2, 2.2, 6), M(0, 1.1), TRUNK);
  for (let t = 0; t < tiers; t++) {
    const k = t / tiers;
    const r = w * (1 - k * 0.78);
    const th = (h - 1.4) / tiers * 1.9;
    const y = 1.4 + k * (h - 1.4 - th * 0.55) + th / 2;
    b.add(new THREE.ConeGeometry(r, th, 7), M(0, y, 0, 1, 1, 1, t * 0.7), lin(greens[t % greens.length]));
    if (snow) b.add(new THREE.ConeGeometry(r * 0.62, th * 0.5, 7), M(0, y + th * 0.27, 0, 1, 1, 1, t * 0.7), lin('#f4f7fb'));
  }
  return b.build();
}

function blobTree(crowns: [number, number, number, number][], trunkH: number, greens: string[]): THREE.BufferGeometry {
  const b = new GB();
  b.add(new THREE.CylinderGeometry(0.14, 0.24, trunkH, 6), M(0, trunkH / 2), TRUNK);
  crowns.forEach(([x, y, z, r], i) => b.add(new THREE.IcosahedronGeometry(r, 1), M(x, y, z, 1, 0.85, 1, i), lin(greens[i % greens.length])));
  return b.build();
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
    pine: pine(4, 10.5, 2.5, ['#1f4a2a', '#2a5a30', '#24502c', '#2f6234'], false),
    pineSnow: pine(4, 10.5, 2.5, ['#244a32', '#2d5a3a'], true),
    larch: pine(5, 10, 2.0, ['#5d8a30', '#6f9a3a', '#7aa544'], false),
    tree: blobTree([[0, 5.2, 0, 2.1], [1.2, 4.4, 0.5, 1.5], [-1.1, 4.6, -0.4, 1.6]], 3.6, ['#4f8a34', '#5e9a3c', '#447a2e']),
    treeRound: blobTree([[0, 3.6, 0, 1.5]], 2.6, ['#5c9a3c']),
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

export interface RiderPose { lean: number; pedal: number; tuck: number; brake: number; light: number }

export class RiderModel {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private torso: THREE.Mesh;
  private head: THREE.Group;
  private limbs: THREE.Mesh[] = [];
  private shoes: THREE.Mesh[] = [];
  private wheels: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  readonly lamp: THREE.Mesh;
  kitKey = '';

  constructor(kit: Kit, shadowTex: THREE.Texture) {
    this.group.rotation.order = 'YXZ';
    this.group.add(this.body);
    // Rad: Rahmen, Lenker, Sattel (zusammengefasst)
    const frame = new GB();
    const tube = (a: number[], b: number[], r: number, col: RGBf) => {
      const va = new THREE.Vector3(...a);
      const vb = new THREE.Vector3(...b);
      const d = vb.clone().sub(va);
      const m = new THREE.Matrix4().compose(va, new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize()), new THREE.Vector3(r, d.length(), r));
      frame.add(UNIT_CYL, m, col);
    };
    const fc = lin(kit.jersey);
    const dark = lin('#1b1c1f');
    const BB = [0, 0.3, 0.02];
    tube(BB, [0, 0.86, 0.22], 0.022, fc);
    tube([0, 0.8, 0.2], [0, 0.82, -0.4], 0.02, fc);
    tube(BB, [0, 0.74, -0.42], 0.025, fc);
    tube(BB, [0, 0.34, 0.5], 0.016, dark);
    tube([0, 0.82, 0.2], [0, 0.34, 0.5], 0.014, fc);
    tube([0, 0.86, -0.41], [0, 0.34, -0.52], 0.018, dark);
    tube([-0.21, 0.92, -0.46], [0.21, 0.92, -0.46], 0.014, dark);
    tube([0, 0.82, -0.4], [0, 0.93, -0.44], 0.02, dark);
    frame.add(new THREE.BoxGeometry(0.12, 0.04, 0.26), M(0, 0.9, 0.24), dark);
    const frameMesh = new THREE.Mesh(frame.build(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.body.add(frameMesh);
    // Laufräder
    const wb = new GB();
    for (const z of [0.5, -0.52]) {
      wb.add(new THREE.TorusGeometry(0.33, 0.024, 5, 18), M(0, 0.34, z, 1, 1, 1, Math.PI / 2), dark);
      wb.add(new THREE.TorusGeometry(0.3, 0.01, 4, 18), M(0, 0.34, z, 1, 1, 1, Math.PI / 2), lin('#9aa0a6'));
      wb.add(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 8), M(0, 0.34, z, 1, 1, 1, 0, 0, Math.PI / 2), lin('#9aa0a6'));
    }
    this.wheels = new THREE.Mesh(wb.build(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.body.add(this.wheels);
    // Fahrer
    this.torso = new THREE.Mesh(UNIT_CAP, mat(kit.jersey));
    this.body.add(this.torso);
    const head = new GB();
    head.add(new THREE.IcosahedronGeometry(0.1, 1), M(0, 0, 0), lin(kit.skin));
    head.add(new THREE.SphereGeometry(0.135, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M(0, 0.01, 0.02, 1, 0.85, 1.2), lin(kit.helmet));
    head.add(new THREE.BoxGeometry(0.16, 0.035, 0.05), M(0, -0.01, -0.11), lin('#111111'));
    this.head = new THREE.Group();
    this.head.add(new THREE.Mesh(head.build(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
    this.body.add(this.head);
    const limbMats = [mat(kit.shorts), mat(kit.skin), mat(kit.shorts), mat(kit.skin), mat(kit.jersey), mat(kit.skin), mat(kit.jersey), mat(kit.skin)];
    for (const m of limbMats) {
      const l = new THREE.Mesh(UNIT_CYL, m);
      this.limbs.push(l);
      this.body.add(l);
    }
    for (let i = 0; i < 2; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.24), mat(kit.shoes));
      this.shoes.push(s);
      this.body.add(s);
    }
    this.lamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.02), mat('#ff2a2a', true));
    this.lamp.position.set(0, 0.78, 0.29);
    this.body.add(this.lamp);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.55 }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.03;
    this.shadow.renderOrder = 1;
    this.group.add(this.shadow);
    this.kitKey = kit.jersey + kit.helmet;
  }

  private hip = new THREE.Vector3();
  private sh = new THREE.Vector3();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private k = new THREE.Vector3();

  pose(p: RiderPose) {
    const tuck = Math.max(0, Math.min(1, p.tuck - p.brake * 0.6));
    this.body.rotation.z = -p.lean;
    // Oberkörper: Hüfte am Sattel, Schultern vorn
    this.hip.set(0, 0.97, 0.18);
    this.sh.set(0, 1.4 - tuck * 0.24, -0.1 - tuck * 0.2);
    setLimb(this.torso, this.hip, this.sh, 0.16);
    this.torso.scale.x = 0.19;
    this.torso.scale.z = 0.13;
    this.head.position.set(0, this.sh.y + 0.13 - tuck * 0.04, this.sh.z - 0.08 - tuck * 0.06);
    this.head.rotation.x = -0.2 - tuck * 0.3;
    // Beine: Kurbel 17 cm, Knie per Zweigelenk-Rechnung
    const L1 = 0.46;
    const L2 = 0.46;
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      const ang = p.pedal + (s === 0 ? 0 : Math.PI);
      this.a.set(side * 0.1, this.hip.y - 0.02, this.hip.z);
      this.b.set(side * 0.13, 0.3 + Math.sin(ang) * 0.17, 0.02 - Math.cos(ang) * 0.17);
      const d = Math.min(L1 + L2 - 0.01, this.a.distanceTo(this.b));
      const dir = this.b.clone().sub(this.a).normalize();
      const foot = this.a.clone().addScaledVector(dir, d);
      const h = Math.sqrt(Math.max(0, L1 * L1 - (d / 2) * (d / 2)));
      // Knie zeigt nach vorn-oben
      const perp = new THREE.Vector3(0, -dir.z, dir.y).normalize();
      if (perp.z > 0) perp.negate();
      this.k.copy(this.a).addScaledVector(dir, d / 2).addScaledVector(perp, h);
      this.k.x = side * 0.14;
      setLimb(this.limbs[s * 2], this.a, this.k, 0.068);
      setLimb(this.limbs[s * 2 + 1], this.k, foot, 0.048);
      this.shoes[s].position.set(foot.x, foot.y - 0.02, foot.z - 0.03);
    }
    // Arme
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      this.a.set(side * 0.18, this.sh.y - 0.02, this.sh.z + 0.02);
      this.b.set(side * 0.2, 0.93, -0.45);
      this.k.set(side * (0.27 + tuck * 0.05), (this.a.y + this.b.y) / 2 - 0.02, (this.a.z + this.b.z) / 2 + 0.06);
      setLimb(this.limbs[4 + s * 2], this.a, this.k, 0.05);
      setLimb(this.limbs[5 + s * 2], this.k, this.b, 0.04);
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
