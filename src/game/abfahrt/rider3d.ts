/**
 * 3D-Radfahrer: Rennrad und Fahrer mit menschlichen Proportionen.
 *
 * Rumpf, Arme und Beine sind glatte, geformte Körper (Rumpf mit Brust, Taille und rundem Rücken,
 * Waden und Oberschenkel mit Muskelform). Die Beine hängen per Zweigelenk-Rechnung (Hüfte–Knie–
 * Knöchel) an den Pedalen: Schuh und Pedal sitzen immer genau auf der Kurbel, der Fuß kippt beim
 * Treten leicht (Ferse vorn tiefer, hinten Spitze nach unten). Die Hände liegen auf den Bremsgriffen,
 * geduckt in der Unterlenker-Haltung.
 */
import * as THREE from 'three';
import type { Kit } from './rider';
import { GB, lin, type RGBf } from './models3d';

export interface RiderPose { lean: number; pedal: number; tuck: number; brake: number; light: number; roll?: number }

const M = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) => {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  return m;
};

// ------------------------------------------------------------------ Maße (Meter, Rad: vorn = −z)

const BB = new THREE.Vector3(0, 0.3, 0.02);   // Tretlager
const CRANK = 0.17;
const Q = 0.128;                               // Pedalabstand zur Mitte
const THIGH = 0.42;
const SHIN = 0.41;
const UPPER = 0.3;
const FORE = 0.3;
const SPINE = 0.52;                            // Hüfte bis Schulterlinie
const PELVIS = new THREE.Vector3(0, 1.01, 0.2);
/** Knöchel relativ zur Pedalachse (Fußballen über dem Pedal) */
const ANKLE = new THREE.Vector3(0, 0.075, 0.105);
const XAXIS = new THREE.Vector3(1, 0, 0);

// ------------------------------------------------------------------ glatte Körper

/** indizierter Baukasten: Ringe zu Röhren verbinden, glatte Normalen */
class MB {
  pos: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  /** Nahtpaare (gleiche Lage, verschiedene UV) – Normalen werden gemittelt */
  seams: [number, number][] = [];
  v(x: number, y: number, z: number, c: RGBf, u = 0, w = 0): number {
    this.pos.push(x, y, z);
    this.col.push(c[0], c[1], c[2]);
    this.uv.push(u, w);
    return this.pos.length / 3 - 1;
  }
  add(g: THREE.BufferGeometry, m: THREE.Matrix4, c: RGBf) {
    const pos = g.getAttribute('position');
    const base = this.pos.length / 3;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      this.v(v.x, v.y, v.z, c);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < pos.count; i++) this.idx.push(base + i);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const [i, j] of this.seams) {
      a.fromBufferAttribute(n, i);
      b.fromBufferAttribute(n, j);
      a.add(b).normalize();
      n.setXYZ(i, a.x, a.y, a.z);
      n.setXYZ(j, a.x, a.y, a.z);
    }
    g.computeBoundingSphere();
    return g;
  }
}

/** Querschnitt eines Körpers: Höhe y, Halbachsen a (seitlich) und b (Tiefe), Mittelpunkt-Versatz cz, Farbe */
interface Ring { y: number; a: number; b: number; cz?: number; c: RGBf }

/** Röhre aus Ringen entlang +y, Enden geschlossen; u läuft rundherum (0 = rechts, 0,75 = hinten, 0,25 = vorn) */
function loft(mb: MB, rings: Ring[], n: number, v0: number, v1: number) {
  const first = mb.pos.length / 3;
  const span = rings[rings.length - 1].y - rings[0].y || 1;
  for (const r of rings) {
    const vv = v0 + ((r.y - rings[0].y) / span) * (v1 - v0);
    const start = mb.pos.length / 3;
    for (let j = 0; j <= n; j++) {
      const ph = (j / n) * Math.PI * 2;
      mb.v(Math.cos(ph) * r.a, r.y, Math.sin(ph) * r.b + (r.cz ?? 0), r.c, 1 - j / n, vv);
    }
    mb.seams.push([start, start + n]);
  }
  const W = n + 1;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = first + i * W + j;
      const b = a + W;
      mb.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  // Deckel unten und oben
  const r0 = rings[0];
  const r1 = rings[rings.length - 1];
  const c0 = mb.v(0, r0.y, r0.cz ?? 0, r0.c, 0.5, v0);
  const c1 = mb.v(0, r1.y, r1.cz ?? 0, r1.c, 0.5, v1);
  const last = first + (rings.length - 1) * W;
  for (let j = 0; j < n; j++) {
    mb.idx.push(c0, first + j, first + j + 1);
    mb.idx.push(c1, last + j + 1, last + j);
  }
}

/** runde Gliedmaße aus einem Profil [y (0–1 der Länge), Radius, Farbe]; Enden als Halbkugeln */
function limb(len: number, prof: [number, number, RGBf][], n = 12): THREE.BufferGeometry {
  const rings: Ring[] = [];
  const [, rs, cs] = prof[0];
  for (let k = 4; k >= 1; k--) {
    const a = (k / 4) * (Math.PI / 2);
    rings.push({ y: -Math.sin(a) * rs * 0.9, a: Math.cos(a) * rs + 0.002, b: Math.cos(a) * rs + 0.002, c: cs });
  }
  for (const [t, r, c] of prof) rings.push({ y: t * len, a: r, b: r, c });
  const [, re, ce] = prof[prof.length - 1];
  for (let k = 1; k <= 4; k++) {
    const a = (k / 4) * (Math.PI / 2);
    rings.push({ y: len + Math.sin(a) * re * 0.9, a: Math.cos(a) * re + 0.002, b: Math.cos(a) * re + 0.002, c: ce });
  }
  const mb = new MB();
  loft(mb, rings, n, 0, 1);
  return mb.build();
}

/** Trikot und Hose als Textur des Rumpfs (u rundherum, 0,75 = Rücken mit Startnummer, 0,25 = Brust) */
const torsoCache = new Map<string, THREE.MeshLambertMaterial>();
const TORSO_Y0 = -0.13;
const TORSO_Y1 = 0.62;
function torsoMat(kit: Kit): THREE.MeshLambertMaterial {
  const key = `${kit.jersey}|${kit.side}|${kit.shorts}|${kit.number}`;
  const hit = torsoCache.get(key);
  if (hit) return hit;
  const W = 256;
  const H = 128;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  const vy = (y: number) => H * (1 - (y - TORSO_Y0) / (TORSO_Y1 - TORSO_Y0));
  c.fillStyle = kit.jersey;
  c.fillRect(0, 0, W, H);
  // Seitenteile mit feiner Kante
  for (const u of [0, 0.5, 1]) {
    c.fillStyle = kit.side;
    c.fillRect(u * W - 15, 0, 30, H);
    c.fillStyle = 'rgba(0,0,0,0.18)';
    c.fillRect(u * W - 16, 0, 2, H);
    c.fillRect(u * W + 14, 0, 2, H);
  }
  // Brustband vorn
  c.fillStyle = kit.side;
  c.globalAlpha = 0.85;
  c.fillRect(W * 0.12, vy(0.42), W * 0.26, vy(0.36) - vy(0.42));
  c.globalAlpha = 1;
  // Kragen, Reißverschluss vorn
  c.fillStyle = kit.side;
  c.fillRect(0, 0, W, vy(0.575));
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.fillRect(W * 0.25 - 1, 0, 2, vy(0.05));
  // Rückentaschen über dem Saum
  c.fillStyle = 'rgba(0,0,0,0.2)';
  c.fillRect(W * 0.63, vy(0.13), W * 0.24, 2);
  for (const u of [0.63, 0.71, 0.79, 0.87]) c.fillRect(u * W - 1, vy(0.13), 2, vy(0.035) - vy(0.13));
  // Hose mit Beinabschluss
  c.fillStyle = kit.shorts;
  c.fillRect(0, vy(0.03), W, H - vy(0.03));
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.fillRect(0, vy(0.03) - 3, W, 3);
  // Startnummer hinten
  const x = W * 0.75;
  const top = vy(0.43);
  const bot = vy(0.22);
  c.fillStyle = '#ffffff';
  c.fillRect(x - 25, top, 50, bot - top);
  c.fillStyle = '#111111';
  c.font = '900 24px -apple-system, "SF Pro Display", Roboto, Arial, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(kit.number, x, (top + bot) / 2 + 1);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  const m = new THREE.MeshLambertMaterial({ map: tex });
  torsoCache.set(key, m);
  return m;
}

/** Rumpf mit Gesäß, Taille, Brust, rundem Rücken und Schultern; y = Wirbelsäule (0 = Hüfte) */
function torsoGeo(): THREE.BufferGeometry {
  const w: RGBf = [1, 1, 1];
  const back = (y: number) => 0.028 * Math.sin(Math.PI * Math.max(0, Math.min(1, (y - 0.05) / 0.5)));
  const rows: [number, number, number][] = [
    [-0.13, 0.06, 0.05], [-0.115, 0.115, 0.085], [-0.08, 0.15, 0.112], [-0.03, 0.163, 0.122], [0.03, 0.163, 0.118],
    [0.12, 0.152, 0.108], [0.22, 0.158, 0.114], [0.33, 0.172, 0.124], [0.43, 0.188, 0.12], [0.5, 0.198, 0.108],
    [0.545, 0.19, 0.095], [0.575, 0.15, 0.08], [0.6, 0.095, 0.065], [0.62, 0.06, 0.055],
  ];
  const rings: Ring[] = rows.map(([y, a, b]) => ({ y, a, b, cz: back(y) + (y < 0 ? 0.012 : 0), c: w }));
  const mb = new MB();
  loft(mb, rings, 20, 0, 1);
  return mb.build();
}

/** Kopf mit Helm, Brille, Ohren und Hals; Mittelpunkt des Kopfes im Ursprung, Gesicht nach −z */
function headGeo(kit: Kit): THREE.BufferGeometry {
  const skin = lin(kit.skin);
  const helmet = lin(kit.helmet);
  const accent = lin(kit.side);
  const dark = lin('#16171a');
  const lens = lin('#1d2530');
  const mb = new MB();
  // Hals schräg nach hinten unten in den Rumpf
  const neck = new THREE.CylinderGeometry(0.046, 0.052, 1, 10, 1, true);
  neck.translate(0, 0.5, 0);
  const a = new THREE.Vector3(0, -0.035, 0.025);
  const b = new THREE.Vector3(0, -0.15, 0.06);
  const d = b.clone().sub(a);
  mb.add(neck, new THREE.Matrix4().compose(a, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()), new THREE.Vector3(1, d.length(), 1)), skin);
  mb.add(new THREE.SphereGeometry(0.095, 14, 10), M(0, 0, 0.005, 0.86, 1, 1.04), skin);           // Schädel
  mb.add(new THREE.SphereGeometry(0.068, 12, 8), M(0, -0.058, -0.035, 0.82, 0.82, 0.9), skin);     // Kiefer, Kinn
  const nose = new THREE.ConeGeometry(0.014, 0.034, 6);
  mb.add(nose, M(0, -0.03, -0.096, 1, 1, 1, 0, -Math.PI / 2 + 0.25), skin);
  for (const sx of [-1, 1]) mb.add(new THREE.SphereGeometry(0.022, 8, 6), M(sx * 0.082, -0.022, 0.012, 0.42, 1, 0.75), skin);
  // Brille: Rundglas vorn, Bügel zu den Ohren
  mb.add(new THREE.CylinderGeometry(0.093, 0.093, 0.036, 18, 1, true, Math.PI - 1.15, 2.3), M(0, -0.008, -0.004, 0.97, 1, 1.06), lens);
  for (const sx of [-1, 1]) mb.add(new THREE.BoxGeometry(0.006, 0.008, 0.075), M(sx * 0.083, -0.003, 0.03), dark);
  // Helm: lange, flache Schale mit Lüftungskanälen, Rand in Teamfarbe
  mb.add(new THREE.SphereGeometry(0.122, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.57), M(0, 0.01, 0.02, 0.93, 0.88, 1.18), helmet);
  mb.add(new THREE.SphereGeometry(0.06, 10, 6), M(0, 0.035, 0.115, 1.0, 0.62, 1.1), helmet);
  mb.add(new THREE.CylinderGeometry(0.117, 0.117, 0.014, 18, 1, true), M(0, -0.012, 0.02, 0.93, 1, 1.18), accent);
  // Kinnriemen
  for (const sx of [-1, 1]) mb.add(new THREE.BoxGeometry(0.005, 0.075, 0.008), M(sx * 0.072, -0.055, -0.005, 1, 1, 1, 0, -0.2, sx * 0.12), dark);
  return mb.build();
}

/** Radschuh mit Pedal; Ursprung = Pedalachse, Spitze nach −z */
function shoeGeo(kit: Kit): THREE.BufferGeometry {
  const shoe = lin(kit.shoes);
  const dark = lin('#18191c');
  const mb = new MB();
  mb.add(new THREE.BoxGeometry(0.078, 0.016, 0.085), M(0, -0.004, 0), dark);                          // Pedal
  mb.add(new THREE.BoxGeometry(0.082, 0.014, 0.25), M(0, 0.014, 0.035), dark);                        // Sohle
  mb.add(new THREE.SphereGeometry(1, 14, 8), M(0, 0.05, 0.035, 0.043, 0.042, 0.13), shoe);            // Schaft
  mb.add(new THREE.SphereGeometry(1, 10, 6), M(0, 0.062, 0.125, 0.042, 0.05, 0.05), shoe);            // Ferse
  mb.add(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 10), M(0, 0.088, 0.045, 1, 1, 1, 0, 0.35), dark); // Drehverschluss
  return mb.build();
}

// ------------------------------------------------------------------ Rad

function bikeGeos(kit: Kit) {
  const frame = new GB();
  const tube = (a: number[], b: number[], r: number, col: RGBf, rx = r, seg = 6) => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const d = vb.clone().sub(va);
    const geo = new THREE.CylinderGeometry(1, 1, 1, seg);
    geo.translate(0, 0.5, 0);
    const m = new THREE.Matrix4().compose(va, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()), new THREE.Vector3(rx, d.length(), r));
    frame.add(geo, m, col);
  };
  const fc = lin(kit.jersey);
  const accent = lin(kit.side);
  const dark = lin('#18191c');
  const carbon = lin('#2a2c31');
  const alu = lin('#a9afb6');
  const bb = [BB.x, BB.y, BB.z];
  const HT = [0, 0.82, -0.4];
  tube(bb, [0, 0.86, 0.2], 0.024, fc, 0.016);              // Sitzrohr
  tube([0, 0.8, 0.19], HT, 0.019, fc, 0.015);              // Oberrohr
  tube(bb, [0, 0.76, -0.41], 0.028, fc, 0.019);            // Unterrohr
  tube(bb, [0, 0.335, 0.49], 0.015, fc);                   // Kettenstreben
  tube([0, 0.8, 0.19], [0, 0.335, 0.49], 0.013, fc);       // Sitzstreben
  tube([0, 0.7, -0.38], [0, 0.88, -0.44], 0.027, fc, 0.022); // Steuerrohr
  tube([0, 0.71, -0.385], [0, 0.335, -0.52], 0.017, fc, 0.012); // Gabel
  tube([0, 0.47, -0.12], [0, 0.6, -0.25], 0.0295, accent, 0.0205);
  tube([0, 0.84, 0.2], [0, 0.93, 0.235], 0.012, carbon);   // Sattelstütze
  frame.add(new THREE.CylinderGeometry(0.03, 0.075, 0.27, 7, 1), M(0, 0.945, 0.22, 1, 1, 0.22, 0, -(Math.PI / 2 - 0.05)), dark); // Sattel
  tube([0, 0.88, -0.44], [0, 0.9, -0.55], 0.014, carbon);  // Vorbau
  tube([-0.2, 0.9, -0.56], [0.2, 0.9, -0.56], 0.012, dark, 0.012, 6);
  for (const sx of [-1, 1]) {
    const x = sx * 0.2;
    tube([x, 0.9, -0.56], [x, 0.9, -0.66], 0.012, dark);
    tube([x, 0.9, -0.66], [x, 0.8, -0.67], 0.012, dark);
    tube([x, 0.8, -0.67], [x, 0.76, -0.6], 0.012, dark);
    tube([x, 0.9, -0.62], [x, 0.96, -0.64], 0.017, dark, 0.014); // Bremsgriff
  }
  tube([0, 0.43, -0.06], [0, 0.61, -0.24], 0.034, lin('#e8eef5')); // Flasche
  tube([0, 0.61, -0.24], [0, 0.635, -0.265], 0.016, dark);
  frame.add(new THREE.CylinderGeometry(0.06, 0.06, 0.035, 12), M(0.045, 0.335, 0.49, 1, 1, 1, 0, 0, Math.PI / 2), alu); // Kassette
  frame.add(new THREE.BoxGeometry(0.02, 0.09, 0.05), M(0.06, 0.26, 0.5), dark);
  tube([0.05, 0.395, 0.49], [0.05, 0.385, 0.02], 0.005, alu, 0.005, 4);
  tube([0.05, 0.215, 0.5], [0.05, 0.21, 0.02], 0.005, alu, 0.005, 4);

  const wheel = new GB();
  wheel.add(new THREE.TorusGeometry(0.325, 0.017, 6, 28), M(0, 0, 0, 1, 1, 1, Math.PI / 2), dark);
  wheel.add(new THREE.CylinderGeometry(0.31, 0.31, 0.022, 28, 1, true), M(0, 0, 0, 1, 1, 1, 0, 0, Math.PI / 2), carbon);
  wheel.add(new THREE.CylinderGeometry(0.255, 0.255, 0.016, 28, 1, true), M(0, 0, 0, 1, 1, 1, 0, 0, Math.PI / 2), carbon);
  wheel.add(new THREE.RingGeometry(0.255, 0.31, 28, 1), M(0.0112, 0, 0, 1, 1, 1, Math.PI / 2), carbon);
  wheel.add(new THREE.RingGeometry(0.255, 0.31, 28, 1), M(-0.0112, 0, 0, 1, 1, 1, -Math.PI / 2), carbon);
  for (const a0 of [0.4, 0.4 + Math.PI]) wheel.add(new THREE.RingGeometry(0.272, 0.292, 8, 1, a0, 1.1), M(0.0118, 0, 0, 1, 1, 1, Math.PI / 2), accent);
  for (const a0 of [0.4, 0.4 + Math.PI]) wheel.add(new THREE.RingGeometry(0.272, 0.292, 8, 1, a0, 1.1), M(-0.0118, 0, 0, 1, 1, 1, -Math.PI / 2), accent);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const sx = k % 2 ? 0.012 : -0.012;
    const spoke = new THREE.CylinderGeometry(0.0022, 0.0022, 0.24, 3);
    spoke.translate(0, 0.135, 0);
    const m = new THREE.Matrix4().makeRotationX(a);
    m.premultiply(new THREE.Matrix4().makeTranslation(sx * 0.4, 0, 0));
    wheel.add(spoke, m, alu);
  }
  wheel.add(new THREE.CylinderGeometry(0.022, 0.022, 0.07, 8), M(0, 0, 0, 1, 1, 1, 0, 0, Math.PI / 2), alu);

  // Kurbel: Kettenblatt rechts, Arme rechts nach oben, links nach unten (Ruhelage); dreht um x
  const crank = new GB();
  crank.add(new THREE.CylinderGeometry(0.105, 0.105, 0.012, 22), M(0.05, 0, 0, 1, 1, 1, 0, 0, Math.PI / 2), carbon);
  crank.add(new THREE.TorusGeometry(0.105, 0.006, 3, 22), M(0.05, 0, 0, 1, 1, 1, Math.PI / 2), alu);
  for (const sx of [-1, 1]) {
    crank.add(new THREE.BoxGeometry(0.016, CRANK + 0.03, 0.026), M(sx * 0.085, (sx * CRANK) / 2, 0), dark);
    crank.add(new THREE.CylinderGeometry(0.007, 0.007, 0.05, 6), M(sx * 0.105, sx * CRANK, 0, 1, 1, 1, 0, 0, Math.PI / 2), alu); // Pedalachse
  }
  crank.add(new THREE.CylinderGeometry(0.014, 0.014, 0.19, 8), M(0, 0, 0, 1, 1, 1, 0, 0, Math.PI / 2), alu); // Innenlager
  return { frame: frame.build(), wheel: wheel.build(), crank: crank.build() };
}

// ------------------------------------------------------------------ Fahrer

const UP = new THREE.Vector3(0, 1, 0);

/** Knochen-Mesh von a nach b ausrichten (Länge ist fest im Mesh) */
function bone(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(UP, tmpD.subVectors(b, a).normalize());
}
const tmpD = new THREE.Vector3();
const tmpQ = new THREE.Vector3();

/** Zweigelenk-Rechnung: Gelenk zwischen a und c bei festen Längen, gebeugt Richtung pole */
function ik(a: THREE.Vector3, c: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, out: THREE.Vector3, end: THREE.Vector3) {
  tmpD.subVectors(c, a);
  const dist = tmpD.length();
  const d = Math.max(Math.abs(l1 - l2) + 0.01, Math.min(l1 + l2 - 0.002, dist));
  tmpD.multiplyScalar(1 / Math.max(1e-6, dist));
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  tmpQ.copy(pole).addScaledVector(tmpD, -pole.dot(tmpD)).normalize();
  out.copy(a).addScaledVector(tmpD, x).addScaledVector(tmpQ, h);
  end.copy(a).addScaledVector(tmpD, d);
}

export class RiderModel {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private torso: THREE.Mesh;
  private head: THREE.Mesh;
  private thighs: THREE.Mesh[] = [];
  private shins: THREE.Mesh[] = [];
  private uppers: THREE.Mesh[] = [];
  private fores: THREE.Mesh[] = [];
  private shoes: THREE.Mesh[] = [];
  private wheelF: THREE.Mesh;
  private wheelR: THREE.Mesh;
  private crank: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  readonly lamp: THREE.Mesh;
  kitKey = '';

  constructor(kit: Kit, shadowTex: THREE.Texture) {
    this.group.rotation.order = 'YXZ';
    this.group.add(this.body);
    const flat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const smooth = new THREE.MeshLambertMaterial({ vertexColors: true });
    const bike = bikeGeos(kit);
    this.body.add(new THREE.Mesh(bike.frame, flat));
    this.wheelF = new THREE.Mesh(bike.wheel, smooth);
    this.wheelF.position.set(0, 0.335, -0.52);
    this.wheelR = new THREE.Mesh(bike.wheel, smooth);
    this.wheelR.position.set(0, 0.335, 0.49);
    this.crank = new THREE.Mesh(bike.crank, flat);
    this.crank.position.copy(BB);
    this.body.add(this.wheelF, this.wheelR, this.crank);

    const skin = lin(kit.skin);
    const shorts = lin(kit.shorts);
    const jersey = lin(kit.jersey);
    const side = lin(kit.side);
    const sock = lin('#f4f4f2');
    const glove = lin('#1f2023');
    // Oberschenkel: Hose bis kurz übers Knie; Wade mit Muskel, Socke; Arme mit Ärmel und Handschuh
    const thigh = limb(THIGH, [[0, 0.083, shorts], [0.2, 0.082, shorts], [0.55, 0.068, shorts], [0.74, 0.058, shorts], [0.745, 0.057, skin], [0.9, 0.05, skin], [1, 0.048, skin]]);
    const shin = limb(SHIN, [[0, 0.047, skin], [0.14, 0.05, skin], [0.3, 0.056, skin], [0.5, 0.046, skin], [0.68, 0.035, skin], [0.685, 0.036, sock], [0.92, 0.031, sock], [1, 0.033, sock]]);
    const upper = limb(UPPER, [[0, 0.056, jersey], [0.3, 0.05, jersey], [0.46, 0.046, jersey], [0.465, 0.046, side], [0.52, 0.045, side], [0.525, 0.044, skin], [0.8, 0.04, skin], [1, 0.037, skin]]);
    const shoeG = shoeGeo(kit);
    const fore = limb(FORE, [[0, 0.037, skin], [0.22, 0.041, skin], [0.6, 0.033, skin], [0.8, 0.028, skin], [0.805, 0.029, glove], [0.9, 0.037, glove], [1, 0.035, glove]]);
    for (let s = 0; s < 2; s++) {
      const t = new THREE.Mesh(thigh, smooth);
      const c = new THREE.Mesh(shin, smooth);
      const u = new THREE.Mesh(upper, smooth);
      const f = new THREE.Mesh(fore, smooth);
      const sh = new THREE.Mesh(shoeG, smooth);
      this.thighs.push(t);
      this.shins.push(c);
      this.uppers.push(u);
      this.fores.push(f);
      this.shoes.push(sh);
      this.body.add(t, c, u, f, sh);
    }
    this.torso = new THREE.Mesh(torsoGeo(), torsoMat(kit));
    this.head = new THREE.Mesh(headGeo(kit), smooth);
    this.body.add(this.torso, this.head);

    this.lamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.02), new THREE.MeshLambertMaterial({ color: '#ff2a2a', emissive: new THREE.Color('#ff2a2a'), emissiveIntensity: 0.8 }));
    this.lamp.position.set(0, 0.86, 0.24);
    this.body.add(this.lamp);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.55 }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.03;
    this.shadow.renderOrder = 1;
    this.group.add(this.shadow);
    this.kitKey = kit.jersey + kit.helmet;
  }

  private fadeMats: THREE.Material[] | null = null;
  private alpha = 1;

  /** Für Durchsichtigkeit vorbereiten (eigene Materialien); danach ändert fade() nur die Deckkraft */
  prepareFade() {
    if (this.fadeMats) return;
    const list: THREE.Material[] = [];
    const cache = new Map<THREE.Material, THREE.Material>();
    this.body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      const src = m.material as THREE.Material;
      let c = cache.get(src);
      if (!c) { c = src.clone(); c.transparent = true; cache.set(src, c); list.push(c); }
      m.material = c;
    });
    this.fadeMats = list;
  }

  /** Deckkraft weich auf das Ziel bringen (Fahrer zwischen Kamera und Spieler werden durchsichtig) */
  fade(target: number, dt: number) {
    if (!this.fadeMats) return;
    const a = Math.abs(target - this.alpha) < 0.01 ? target : this.alpha + (target - this.alpha) * Math.min(1, dt * 9);
    if (a === this.alpha) return;
    this.alpha = a;
    // Tiefe weiter schreiben: der durchsichtige Fahrer bleibt ein ruhiger „Geist“ ohne innere Überlagerungen
    for (const m of this.fadeMats) m.opacity = a;
  }

  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private v4 = new THREE.Vector3();
  private pole = new THREE.Vector3();
  private spine = new THREE.Vector3();
  private sq = new THREE.Quaternion();

  pose(p: RiderPose) {
    const tuck = Math.max(0, Math.min(1, p.tuck - p.brake * 0.6));
    const brake = Math.max(0, Math.min(1, p.brake));
    this.body.rotation.z = -p.lean;
    if (p.roll !== undefined) { this.wheelF.rotation.x = -p.roll; this.wheelR.rotation.x = -p.roll; }
    // Kurbel: Winkel 0 = rechtes Pedal oben, vorwärts drehend (pedal = 0 → Kurbel waagrecht)
    const th = p.pedal + Math.PI / 2;
    this.crank.rotation.x = -th;

    // Rumpf: auf den Griffen etwa 40° geneigt, geduckt flach, beim Bremsen aufrechter
    const beta = ((40 - 22 * tuck + 14 * brake) * Math.PI) / 180;
    this.spine.set(0, Math.sin(beta), -Math.cos(beta));
    this.torso.position.copy(PELVIS);
    this.torso.quaternion.setFromUnitVectors(UP, this.spine);
    this.sq.copy(this.torso.quaternion);

    // Kopf: über dem Halsansatz, Blick nach vorn auf die Straße
    const neck = this.v1.set(0, SPINE + 0.07, 0.01).applyQuaternion(this.sq).add(PELVIS);
    this.head.position.set(0, neck.y + 0.11 - tuck * 0.012, neck.z - 0.05 - tuck * 0.03);
    this.head.rotation.x = 0.08 + tuck * 0.12 - brake * 0.05;

    // Beine: Hüfte → Knöchel über dem Pedal, Knie nach vorn
    for (let s = 0; s < 2; s++) {
      const sx = s === 0 ? -1 : 1;
      const a = s === 0 ? th + Math.PI : th;
      const ped = this.v2.set(sx * Q, BB.y + Math.cos(a) * CRANK, BB.z - Math.sin(a) * CRANK);
      const pitch = -0.2 + 0.16 * Math.sin(a);
      const shoe = this.shoes[s];
      shoe.position.copy(ped);
      shoe.rotation.x = pitch;
      const ankle = this.v3.copy(ANKLE).applyAxisAngle(XAXIS, pitch).add(ped);
      ankle.x -= sx * 0.008;
      const hip = this.v1.set(sx * 0.088, PELVIS.y - 0.012, PELVIS.z - 0.02);
      this.pole.set(sx * 0.12, 0.25, -1);
      const knee = this.v4;
      ik(hip, ankle, THIGH, SHIN, this.pole, knee, ankle);
      bone(this.thighs[s], hip, knee);
      bone(this.shins[s], knee, ankle);
    }

    // Arme: Schulter → Hand am Bremsgriff (geduckt im Unterlenker), Ellbogen leicht nach außen
    for (let s = 0; s < 2; s++) {
      const sx = s === 0 ? -1 : 1;
      const shoulder = this.v1.set(sx * 0.172, SPINE - 0.035, 0.0).applyQuaternion(this.sq).add(PELVIS);
      const hand = this.v2.set(sx * (0.2 - tuck * 0.01), 0.955 - tuck * 0.13, -0.635 + tuck * 0.02);
      this.pole.set(sx * 0.7, -0.35, 0.45);
      const elbow = this.v4;
      ik(shoulder, hand, UPPER, FORE, this.pole, elbow, hand);
      bone(this.uppers[s], shoulder, elbow);
      bone(this.fores[s], elbow, hand);
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
