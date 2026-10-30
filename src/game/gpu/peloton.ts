/**
 * Fahrerfeld in der Ferne (WebGPU-Abfahrt): alle Gegner ohne eigenes Modell aus dem Vorrat als Instanzen eines
 * einfachen Fahrers mit Rad (~380 Dreiecke) in einem Zeichenaufruf. Beine treten im Shader (Hüfte fest, Fuß auf
 * dem Pedal, Knie nach vorn aus Ober- und Unterschenkellänge), Schräglage um die Fahrtrichtung, Gestürzte liegen.
 * Farben aus den Teamtrikots (Trikot, Ärmel, Helm, Hose, Schuhe, Rahmen) und dem Hautton je Fahrer.
 *
 * Lokal wie die Fahrermodelle: vorn = −z, Boden y = 0, Räder bei z = −0,56 und +0,43.
 */
import * as THREE from 'three/webgpu';
import { SKINS, TEAM_KITS, type Kit } from '../abfahrt/rider';
import { lit } from './light';
import { tsl, type N } from './nodes';
import { terrainSun } from './sunmap';

const { attribute, cameraPosition, cos, cross, dFdx, dFdy, dot, float, max, min, normalize, positionWorld, select, sin, sqrt, uniformArray, varying, vec3 } = tsl;

/** Farbplätze je Ecke */
const S = { jersey: 0, side: 1, helmet: 2, shorts: 3, shoes: 4, skin: 5, tire: 6, frame: 7, metal: 8, shadow: 9 } as const;
/** Knochen: 0 fest, 1 Oberschenkel links, 2 Unterschenkel links, 3/4 rechts */
const THIGH = 0.42, SHIN = 0.41;
const HIP: [number, number, number] = [0.09, 0.96, 0.2];

class G {
  p: number[] = [];
  b: number[] = [];
  s: number[] = [];
  idx: number[] = [];
  private v(x: number, y: number, z: number, slot: number, bone: [number, number, number, number] = [0, 0, 0, 0]) {
    this.p.push(x, y, z);
    this.b.push(...bone);
    this.s.push(slot);
    return this.p.length / 3 - 1;
  }
  /** Quader aus acht Ecken (Reihenfolge wie THREE.Box: x0y0z0, x1y0z0, x1y1z0, x0y1z0, dann z1) */
  hexa(c: [number, number, number][], slot: number) {
    const i = c.map((q) => this.v(q[0], q[1], q[2], slot));
    this.faces(i);
  }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, slot: number) {
    this.hexa([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], slot);
  }
  /** Stab von a nach b (Rohr des Rahmens, Arm), Dicke w */
  bar(a: [number, number, number], b: [number, number, number], w: number, slot: number) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = Math.hypot(d[0], d[1], d[2]) || 1;
    const ax = [d[0] / L, d[1] / L, d[2] / L];
    const ref = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let e1 = [ax[1] * ref[2] - ax[2] * ref[1], ax[2] * ref[0] - ax[0] * ref[2], ax[0] * ref[1] - ax[1] * ref[0]];
    const l1 = Math.hypot(e1[0], e1[1], e1[2]);
    e1 = e1.map((q) => q / l1);
    const e2 = [ax[1] * e1[2] - ax[2] * e1[1], ax[2] * e1[0] - ax[0] * e1[2], ax[0] * e1[1] - ax[1] * e1[0]];
    const P = (o: number[], s1: number, s2: number): [number, number, number] => [o[0] + (e1[0] * s1 + e2[0] * s2) * w, o[1] + (e1[1] * s1 + e2[1] * s2) * w, o[2] + (e1[2] * s1 + e2[2] * s2) * w];
    this.hexa([P(a, -1, -1), P(a, 1, -1), P(a, 1, 1), P(a, -1, 1), P(b, -1, -1), P(b, 1, -1), P(b, 1, 1), P(b, -1, 1)], slot);
  }
  /** Knochenstück (Bein): t0 … t1 entlang des Knochens, halbe Dicke w (quer) und h (davor/dahinter) */
  bone(kind: number, t0: number, t1: number, w: number, h: number, slot: number) {
    const i: number[] = [];
    for (const t of [t0, t1]) for (const [u, v] of [[-w, -h], [w, -h], [w, h], [-w, h]] as const) i.push(this.v(0, 0, 0, slot, [kind, t, u, v]));
    this.faces(i);
  }
  /** Scheibe (Rad) in der y-z-Ebene: Mitte, Radius, n Ecken, beidseitig */
  disc(c: [number, number, number], r: number, n: number, slot: number) {
    const m = this.v(c[0], c[1], c[2], slot);
    const ring: number[] = [];
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; ring.push(this.v(c[0], c[1] + Math.cos(a) * r, c[2] + Math.sin(a) * r, slot)); }
    for (let k = 0; k < n; k++) { const a = ring[k], b = ring[(k + 1) % n]; this.idx.push(m, a, b, m, b, a); }
  }
  /** flache Ellipse am Boden (Schatten) */
  blob(rx: number, rz: number, n: number) {
    const m = this.v(0, 0.03, 0, S.shadow);
    const ring: number[] = [];
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; ring.push(this.v(Math.cos(a) * rx, 0.03, Math.sin(a) * rz - 0.06, S.shadow)); }
    for (let k = 0; k < n; k++) this.idx.push(m, ring[(k + 1) % n], ring[k]);
  }
  /** Kugel grob (Kopf, Helm): Achteck-Ringe */
  ball(c: [number, number, number], r: number, sy: number, slot: number) {
    const rows = 4, n = 7;
    const top = this.v(c[0], c[1] + r * sy, c[2], slot);
    const bot = this.v(c[0], c[1] - r * sy, c[2], slot);
    const ring: number[][] = [];
    for (let j = 1; j < rows; j++) {
      const ph = (j / rows) * Math.PI;
      const row: number[] = [];
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; row.push(this.v(c[0] + Math.cos(a) * Math.sin(ph) * r, c[1] + Math.cos(ph) * r * sy, c[2] + Math.sin(a) * Math.sin(ph) * r, slot)); }
      ring.push(row);
    }
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      this.idx.push(top, ring[0][k1], ring[0][k]);
      for (let j = 0; j + 1 < ring.length; j++) this.idx.push(ring[j][k], ring[j][k1], ring[j + 1][k1], ring[j][k], ring[j + 1][k1], ring[j + 1][k]);
      this.idx.push(bot, ring[ring.length - 1][k], ring[ring.length - 1][k1]);
    }
  }
  private faces(i: number[]) {
    const q = (a: number, b: number, c: number, d: number) => this.idx.push(i[a], i[b], i[c], i[a], i[c], i[d]);
    q(0, 1, 2, 3); q(5, 4, 7, 6); q(4, 0, 3, 7); q(1, 5, 6, 2); q(3, 2, 6, 7); q(4, 5, 1, 0);
  }
}

function geometry(): THREE.BufferGeometry {
  const g = new G();
  // Schatten
  g.blob(0.42, 0.95, 10);
  // Räder (Reifen schwarz, Felge als kleinere Scheibe metallgrau davor)
  for (const z of [-0.56, 0.43]) {
    g.disc([0, 0.335, z], 0.335, 12, S.tire);
    g.disc([0.012, 0.335, z], 0.27, 10, S.metal);
    g.disc([-0.012, 0.335, z], 0.27, 10, S.metal);
  }
  // Rahmen: Unterrohr, Sitzrohr, Oberrohr, Hinterbau, Gabel, Vorbau, Lenker, Sattel
  const BB: [number, number, number] = [0, 0.3, 0.02];
  g.bar(BB, [0, 0.82, -0.44], 0.022, S.frame);
  g.bar(BB, [0, 0.9, 0.12], 0.02, S.frame);
  g.bar([0, 0.86, 0.1], [0, 0.84, -0.46], 0.018, S.frame);
  g.bar(BB, [0, 0.335, 0.43], 0.014, S.frame);
  g.bar([0, 0.86, 0.1], [0, 0.335, 0.43], 0.012, S.frame);
  g.bar([0, 0.84, -0.46], [0, 0.335, -0.56], 0.016, S.frame);
  g.bar([0, 0.88, -0.48], [0, 0.9, -0.58], 0.016, S.metal);
  g.box(-0.21, 0.89, -0.6, 0.21, 0.92, -0.56, S.metal);
  g.box(-0.04, 0.98, 0.05, 0.04, 1.02, 0.3, S.tire);
  // Körper in Abfahrtshaltung: Becken, Rücken fast waagrecht, Kopf vorn
  const pel: [number, number, number] = [0, 1.0, 0.2];
  const sh: [number, number, number] = [0, 1.22, -0.28];
  g.hexa([[-0.15, 0.93, 0.3], [0.15, 0.93, 0.3], [0.17, 1.1, 0.26], [-0.17, 1.1, 0.26], [-0.19, 1.13, -0.3], [0.19, 1.13, -0.3], [0.2, 1.31, -0.26], [-0.2, 1.31, -0.26]], S.jersey);
  // Seitenstreifen des Trikots (Akzent)
  g.hexa([[-0.152, 1.0, 0.25], [-0.12, 1.0, 0.25], [-0.12, 1.06, 0.25], [-0.152, 1.06, 0.25], [-0.195, 1.2, -0.28], [-0.16, 1.2, -0.28], [-0.16, 1.26, -0.28], [-0.195, 1.26, -0.28]], S.side);
  g.hexa([[0.12, 1.0, 0.25], [0.152, 1.0, 0.25], [0.152, 1.06, 0.25], [0.12, 1.06, 0.25], [0.16, 1.2, -0.28], [0.195, 1.2, -0.28], [0.195, 1.26, -0.28], [0.16, 1.26, -0.28]], S.side);
  // Hose am Becken
  g.box(-0.15, 0.9, 0.12, 0.15, 1.02, 0.32, S.shorts);
  // Kopf (Haut) und Helm
  g.ball([0, 1.33, -0.41], 0.1, 1.05, S.skin);
  g.ball([0, 1.37, -0.39], 0.125, 0.75, S.helmet);
  // Arme: Oberarm (Trikot), Unterarm (Haut) zu den Griffen
  for (const sx of [-1, 1]) {
    const s0: [number, number, number] = [sx * 0.18, 1.23, -0.27];
    const el: [number, number, number] = [sx * 0.2, 1.06, -0.43];
    const hd: [number, number, number] = [sx * 0.2, 0.93, -0.57];
    g.bar(s0, el, 0.045, S.side);
    g.bar(el, hd, 0.035, S.skin);
  }
  // Beine (im Shader): Oberschenkel in Hosenfarbe, Unterschenkel Haut, Schuh
  for (const [th, sn] of [[1, 2], [3, 4]]) {
    g.bone(th, -0.05, 1.0, 0.07, 0.075, S.shorts);
    g.bone(sn, 0.0, 0.86, 0.05, 0.055, S.skin);
    g.bone(sn, 0.86, 1.06, 0.045, 0.06, S.shoes);
  }
  void pel; void sh;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3));
  geo.setAttribute('aBone', new THREE.Float32BufferAttribute(g.b, 4));
  geo.setAttribute('aSlot', new THREE.Float32BufferAttribute(g.s, 1));
  geo.setIndex(g.idx);
  return geo;
}

const KITS = TEAM_KITS.length;
/** Farben je Kit: Trikot, Ärmel/Akzent, Helm, Hose, Schuhe, Rahmen */
const PER = 6;

export class Peloton {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private data: Float32Array;
  private buf: THREE.InstancedInterleavedBuffer;
  readonly cap: number;
  private n = 0;
  private kitIdx = new Map<string, number>();

  constructor(cap = 240) {
    this.cap = cap;
    const base = geometry();
    const geo = (this.geo = new THREE.InstancedBufferGeometry());
    for (const k of Object.keys(base.attributes)) geo.setAttribute(k, base.attributes[k]);
    geo.setIndex(base.index);
    this.data = new Float32Array(cap * 12);
    const buf = (this.buf = new THREE.InstancedInterleavedBuffer(this.data, 12, 1));
    buf.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iP', new THREE.InterleavedBufferAttribute(buf, 4, 0));
    geo.setAttribute('iS', new THREE.InterleavedBufferAttribute(buf, 4, 4));
    geo.setAttribute('iC', new THREE.InterleavedBufferAttribute(buf, 4, 8));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    TEAM_KITS.forEach((k, i) => this.kitIdx.set(k.jersey, i));
    this.mesh = new THREE.Mesh(geo, this.material());
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    this.mesh.name = 'peloton';
  }

  private material(): THREE.MeshBasicNodeMaterial {
    const cols: THREE.Color[] = [];
    for (const k of TEAM_KITS) {
      for (const h of [k.jersey, k.side, k.helmet, k.shorts, k.shoes, k.jersey]) cols.push(new THREE.Color(h));
    }
    const pal = uniformArray(cols, 'color');
    const skins = uniformArray(SKINS.map((h) => new THREE.Color(h)), 'color');
    const iP = attribute('iP', 'vec4');
    const iS = attribute('iS', 'vec4');
    const iC = attribute('iC', 'vec4');
    const bone = attribute('aBone', 'vec4');
    const slot = attribute('aSlot', 'float');
    const kind = bone.x;
    // Bein: links (1, 2) oder rechts (3, 4); Oberschenkel ungerade
    const right = kind.greaterThan(2.5);
    const sg = select(right, float(1), float(-1));
    const phi = iS.y.add(select(right, float(Math.PI), float(0)));
    const H = vec3(sg.mul(HIP[0]), HIP[1], HIP[2]);
    const F0 = vec3(sg.mul(0.128), cos(phi).mul(0.17).add(0.36), sin(phi).mul(-0.17).add(0.1));
    const d0 = F0.sub(H);
    const L = min(max(d0.length(), float(0.25)), float(THIGH + SHIN - 0.005));
    const dir = normalize(d0);
    const F = H.add(dir.mul(L));
    const a = L.mul(L).add(THIGH * THIGH - SHIN * SHIN).div(L.mul(2));
    const h = sqrt(max(float(THIGH * THIGH).sub(a.mul(a)), float(0)));
    const kn = normalize(vec3(0, dir.z.negate(), dir.y));
    const K = H.add(dir.mul(a)).add(kn.mul(h));
    const thigh = kind.lessThan(1.5).or(kind.greaterThan(2.5).and(kind.lessThan(3.5)));
    const A = select(thigh, H, K);
    const B = select(thigh, K, F);
    const ax = normalize(B.sub(A));
    const side = vec3(1, 0, 0);
    const perp = normalize(cross(ax, side));
    const legP = A.add(B.sub(A).mul(bone.y)).add(side.mul(bone.z)).add(perp.mul(bone.w));
    let local: N = select(kind.greaterThan(0.5), legP, attribute('position', 'vec3'));
    // Gestürzt (iC.x): liegt auf der Seite; Schatten dann weg
    const lean = iS.x;
    const cl = cos(lean), sl = sin(lean);
    local = vec3(local.x.mul(cl).add(local.y.mul(sl)), local.y.mul(cl).sub(local.x.mul(sl)), local.z);
    const shadowGone = slot.greaterThan(8.5).and(iC.x.greaterThan(0.5));
    local = select(shadowGone, vec3(0, -1, 0), local);
    const c = cos(iP.w), s = sin(iP.w);
    const world = vec3(local.x.mul(c).add(local.z.mul(s)), local.y, local.z.mul(c).sub(local.x.mul(s))).add(iP.xyz);
    const m = new THREE.MeshBasicNodeMaterial();
    m.positionNode = world;
    // Farbe aus Platz und Kit
    const k = iS.z.mul(PER);
    const sIdx = slot.toInt();
    const kitCol = pal.element(k.add(select(slot.lessThan(4.5), slot, float(5))).toInt());
    const col = select(sIdx.equal(5), skins.element(iS.w.toInt()),
      select(sIdx.equal(6), vec3(0.02, 0.02, 0.022),
        select(sIdx.equal(8), vec3(0.32, 0.33, 0.35),
          select(sIdx.equal(9), vec3(0.0, 0.0, 0.0), kitCol))));
    // Lichter der Ferne: Sonne aus der Geländelicht-Karte am Fahrer (je Ecke), Flächenrichtung aus den Ableitungen
    const vis = varying(terrainSun(iP.xz, true), 'vPelSun');
    const fn0 = normalize(cross(dFdx(positionWorld), dFdy(positionWorld)));
    const fn = fn0.mul(select(dot(fn0, cameraPosition.sub(positionWorld)).greaterThan(0), float(1), float(-1)));
    const shade = lit({ col, nWorld: fn, vis, wrap: 0.25 });
    m.colorNode = select(sIdx.equal(9), vec3(0.004, 0.004, 0.004), shade);
    m.name = 'peloton';
    return m;
  }

  /** Daten setzen: Liste der Fahrer (Weltlage, Richtung, Schräglage, Kurbel, Kit) */
  begin() { this.n = 0; }
  add(x: number, y: number, z: number, th: number, lean: number, pedal: number, kit: Kit, down: boolean) {
    if (this.n >= this.cap) return;
    const ki = this.kitIdx.get(kit.jersey) ?? 0;
    const si = Math.max(0, SKINS.indexOf(kit.skin));
    this.data.set([x, y, z, -th, lean, pedal, Math.min(KITS - 1, ki), si, down ? 1 : 0, 0, 0, 0], this.n * 12);
    this.n++;
  }
  commit() {
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    this.buf.needsUpdate = true;
  }
  /** Vorwärmen: einen Fahrer weit unten zeigen */
  warm(on: boolean) {
    if (on) { this.begin(); this.add(0, -500, 0, 0, 0, 0, { ...TEAM_KITS[0], skin: SKINS[0], number: '1' }, false); this.commit(); }
  }
  dispose() { this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
