/**
 * 3D-Radfahrer: Rennrad (bike3d.ts) und Fahrer mit menschlichen Proportionen.
 *
 * Rumpf, Arme und Beine sind glatte, geformte Körper (Rumpf mit Brust, Taille und rundem Rücken,
 * Waden und Oberschenkel mit Muskelform, Handschuhe mit Daumen). Kopf, Helm, Brille und Schuhe kommen
 * aus gear3d.ts. Die Beine hängen per Zweigelenk-Rechnung (Hüfte–Knie–Knöchel) an den Pedalen, der Fuß
 * kippt beim Treten leicht. Sitzposition und Griffe kommen vom jeweiligen Rad: Becken über dem Sattel,
 * Hände auf den Griffen oder im Unterlenker; der Oberkörper neigt sich genau so weit, dass die Arme
 * passen. Auf dem Zeitfahrrad liegen die Unterarme auf den Polstern, die Hände vorn am Auflieger.
 */
import * as THREE from 'three';
import type { Kit } from './rider';
import { alphaTex, lin, type RGBf } from './models3d';
import { BIKE_BB, bikeBuild, type BikeFit } from './bike3d';
import { glossMat } from './gloss';
import { headBuild, shoeBuild } from './gear3d';

/**
 * Haltung: Schräglage, Kurbelwinkel, geduckt, bremsen, Licht, Radumdrehung, Wiegetritt (0–1) und dessen Art:
 * sprint = 1 Sprint (Unterlenker, tief, Rad pendelt weit), 0 Wiegetritt am Berg (Griffe, aufrechter)
 */
export interface RiderPose { lean: number; pedal: number; tuck: number; brake: number; light: number; roll?: number; stand?: number; sprint?: number }

const M = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) => {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  return m;
};

// ------------------------------------------------------------------ Maße (Meter, Rad: vorn = −z)

const BB = BIKE_BB;                            // Tretlager
const CRANK = 0.17;
const Q = 0.128;                               // Pedalabstand zur Mitte
const THIGH = 0.42;
const SHIN = 0.41;
const UPPER = 0.3;
const FORE = 0.3;
const SPINE = 0.52;                            // Hüfte bis Schulterlinie
/** im Wiegetritt: Becken aus dem Sattel nach vorn über das Tretlager; im Sprint tiefer und etwas weiter hinten
 *  (relativ zum Kurbeldrehpunkt – beim Hochrad die Vorderradnabe) */
const PELVIS_UP = new THREE.Vector3(0, 0.76, 0.04);
const PELVIS_SPRINT = new THREE.Vector3(0, 0.75, 0.03);
const ZAXIS = new THREE.Vector3(0, 0, 1);
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


/**
 * Gliedmaße mit Muskelform: je Querschnitt Breite a, Tiefe b und Versatz cz (nach −z = hinten liegen Wade und
 * Trizeps, nach +z vorn Schienbein und Bizeps – für die üblichen Haltungen), Enden halbrund
 */
function muscle(len: number, prof: [number, number, number, number, RGBf][], n = 14): THREE.BufferGeometry {
  const rings: Ring[] = [];
  const [, a0, b0, z0, c0] = prof[0];
  for (let k = 4; k >= 1; k--) {
    const an = (k / 4) * (Math.PI / 2);
    rings.push({ y: -Math.sin(an) * Math.min(a0, b0) * 0.9, a: Math.cos(an) * a0 + 0.002, b: Math.cos(an) * b0 + 0.002, cz: z0, c: c0 });
  }
  for (const [t, a, b, cz, c] of prof) rings.push({ y: t * len, a, b, cz, c });
  const [, a1, b1, z1, c1] = prof[prof.length - 1];
  for (let k = 1; k <= 4; k++) {
    const an = (k / 4) * (Math.PI / 2);
    rings.push({ y: len + Math.sin(an) * Math.min(a1, b1) * 0.9, a: Math.cos(an) * a1 + 0.002, b: Math.cos(an) * b1 + 0.002, cz: z1, c: c1 });
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

/** Unterarm mit Handschuh: Hand flach und breit, Finger leicht eingerollt, Daumen innen (sx = Seite) */
function foreGeo(skin: RGBf, glove: RGBf, sx: number): THREE.BufferGeometry {
  const rings: Ring[] = [];
  const rs = 0.037;
  for (let k = 4; k >= 1; k--) {
    const a = (k / 4) * (Math.PI / 2);
    rings.push({ y: -Math.sin(a) * rs * 0.9, a: Math.cos(a) * rs + 0.002, b: Math.cos(a) * rs + 0.002, c: skin });
  }
  const L = FORE;
  const prof: [number, number, number, number, RGBf][] = [
    [0, 0.039, 0.039, 0, skin], [0.16, 0.044, 0.042, 0, skin], [0.4, 0.039, 0.036, 0, skin], [0.62, 0.032, 0.03, 0, skin], [0.78, 0.027, 0.025, 0, skin],
    [0.785, 0.029, 0.027, 0, glove], [0.81, 0.031, 0.026, 0, glove], [0.86, 0.04, 0.025, -0.001, glove], [0.92, 0.043, 0.024, -0.004, glove],
    [0.965, 0.041, 0.021, -0.009, glove], [1, 0.036, 0.017, -0.014, glove],
  ];
  for (const [t, a, b, cz, c] of prof) rings.push({ y: t * L, a, b, cz, c });
  for (let k = 1; k <= 3; k++) {
    const an = (k / 3) * (Math.PI / 2);
    rings.push({ y: L + Math.sin(an) * 0.014, a: Math.cos(an) * 0.036 + 0.002, b: Math.cos(an) * 0.017 + 0.001, cz: -0.014 - Math.sin(an) * 0.004, c: glove });
  }
  const mb = new MB();
  loft(mb, rings, 14, 0, 1);
  // Daumen auf der Innenseite, um den Griff gelegt
  mb.add(new THREE.SphereGeometry(1, 10, 6), M(-sx * 0.036, L * 0.9, -0.012, 0.014, 0.034, 0.013, 0, 0.5, sx * 0.35), glove);
  return mb.build();
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

/** Schlüssel eines Trikots (alles, was das Aussehen bestimmt) */
export function riderKitKey(kit: Kit): string {
  return `${kit.jersey}|${kit.side}|${kit.helmet}|${kit.shorts}|${kit.skin}|${kit.shoes}|${kit.number}|${kit.bike ?? ''}`;
}

let smoothMat: THREE.MeshLambertMaterial | null = null;
const baseMat = () => (smoothMat ??= new THREE.MeshLambertMaterial({ vertexColors: true }));

let lamp: { geo: THREE.BufferGeometry; mat: THREE.MeshLambertMaterial } | null = null;
function lampParts() {
  return (lamp ??= {
    geo: new THREE.BoxGeometry(0.05, 0.04, 0.02),
    mat: new THREE.MeshLambertMaterial({ color: '#ff2a2a', emissive: new THREE.Color('#ff2a2a'), emissiveIntensity: 0.8 }),
  });
}

/**
 * Drehende Speichen: im Tempo verschwimmen sie zu einem feinen Schleier (wie auf jedem Foto). Statt die dünnen
 * Speichen flimmern zu lassen, zeigt das Rad dann eine halbdurchsichtige Scheibe mit Schlieren.
 */
let blur: { mat: THREE.MeshLambertMaterial; geos: Map<number, THREE.BufferGeometry> } | null = null;
function blurParts() {
  if (blur) return blur;
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(S / 2, S / 2, S * 0.06, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(40,40,44,0.5)');
  g.addColorStop(0.12, 'rgba(40,40,44,0.16)');
  g.addColorStop(0.85, 'rgba(40,40,44,0.2)');
  g.addColorStop(1, 'rgba(40,40,44,0.3)');
  c.fillStyle = g;
  c.beginPath(); c.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(70,72,78,0.12)';
  c.lineWidth = 1;
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    c.beginPath(); c.moveTo(S / 2, S / 2); c.lineTo(S / 2 + Math.cos(a) * S / 2, S / 2 + Math.sin(a) * S / 2); c.stroke();
  }
  blur = { mat: new THREE.MeshLambertMaterial({ map: alphaTex(cv, [40, 40, 44]), transparent: true, depthWrite: false, side: THREE.DoubleSide }), geos: new Map() };
  return blur;
}
function blurDisc(r: number): THREE.Mesh {
  const b = blurParts();
  const key = Math.round(r * 1000);
  let geo = b.geos.get(key);
  if (!geo) { geo = new THREE.CircleGeometry(r, 28).rotateY(Math.PI / 2); b.geos.set(key, geo); }
  const m = new THREE.Mesh(geo, b.mat);
  m.renderOrder = 2;
  m.visible = false;
  return m;
}

let shadowGeo: THREE.PlaneGeometry | null = null;
const SHADOW_GEO = () => (shadowGeo ??= new THREE.PlaneGeometry(1.1, 2.2));

interface Limbs { thigh: THREE.BufferGeometry; shin: THREE.BufferGeometry; upper: THREE.BufferGeometry; foreL: THREE.BufferGeometry; foreR: THREE.BufferGeometry }
const elbowCap = (skin: RGBf) => { const mb = new MB(); mb.add(new THREE.SphereGeometry(0.042, 10, 8), new THREE.Matrix4(), skin); return mb.build(); };
const kneeCap = (skin: RGBf) => { const mb = new MB(); mb.add(new THREE.SphereGeometry(0.05, 12, 8), new THREE.Matrix4().makeScale(1, 1, 1.08), skin); return mb.build(); };
const geoCache = new Map<string, unknown>();
function cached<T>(key: string, make: () => T): T {
  let v = geoCache.get(key) as T | undefined;
  if (v === undefined) { v = make(); geoCache.set(key, v); }
  return v;
}

/** Arme und Beine (geteilt je Farbkombination) */
/** zwei Geometrien zu einer (gleiche Eigenschaften, Indizes versetzt) – spart einen Zeichenaufruf */
function mergeGeo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const na = a.getAttribute('position').count;
  const nb = b.getAttribute('position').count;
  for (const name of Object.keys(a.attributes)) {
    const A = a.getAttribute(name) as THREE.BufferAttribute;
    const B = b.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!B || B.itemSize !== A.itemSize) continue;
    const arr = new Float32Array((na + nb) * A.itemSize);
    arr.set(A.array as Float32Array, 0);
    arr.set(B.array as Float32Array, na * A.itemSize);
    g.setAttribute(name, new THREE.BufferAttribute(arr, A.itemSize));
  }
  const ia = a.index ? Array.from(a.index.array) : [...Array(na).keys()];
  const ib = b.index ? Array.from(b.index.array, (i) => i + na) : [...Array(nb).keys()].map((i) => i + na);
  g.setIndex([...ia, ...ib]);
  g.computeBoundingSphere();
  return g;
}

function limbGeos(kit: Kit): Limbs {
  return cached(`limbs|${kit.skin}|${kit.shorts}|${kit.jersey}|${kit.side}`, () => {
    const skin = lin(kit.skin);
    const shorts = lin(kit.shorts);
    const jersey = lin(kit.jersey);
    const side = lin(kit.side);
    const sock = lin('#f4f4f2');
    const glove = lin('#1f2023');
    // Oberschenkel: Hose bis kurz übers Knie mit Beinabschluss; Wade mit Muskel, Socke; Ärmel mit Bündchen
    // Oberschenkel: kräftiger Quadrizeps vorn, Hose bis übers Knie; Wade mit ausgeprägtem Muskel hinten,
    // schmale Achillessehne; Oberarm mit Schulterkappe (Deltamuskel) im Ärmel, Bizeps und Trizeps
    return {
      thigh: muscle(THIGH, [[0, 0.084, 0.086, 0, shorts], [0.18, 0.083, 0.088, 0.006, shorts], [0.45, 0.074, 0.08, 0.008, shorts], [0.66, 0.062, 0.066, 0.006, shorts],
        [0.72, 0.059, 0.062, 0.004, shorts], [0.725, 0.06, 0.063, 0.004, side], [0.745, 0.058, 0.061, 0.004, side], [0.75, 0.056, 0.058, 0.003, skin], [0.88, 0.05, 0.053, 0.004, skin], [1, 0.047, 0.05, 0.004, skin]]),
      shin: mergeGeo(muscle(SHIN, [[0, 0.047, 0.049, 0, skin], [0.1, 0.05, 0.056, -0.006, skin], [0.26, 0.054, 0.066, -0.014, skin], [0.4, 0.05, 0.058, -0.01, skin], [0.56, 0.041, 0.044, -0.003, skin],
        [0.68, 0.034, 0.034, 0, skin], [0.685, 0.035, 0.035, 0, sock], [0.92, 0.031, 0.033, 0.002, sock], [1, 0.033, 0.036, 0.004, sock]]), kneeCap(skin)),
      upper: muscle(UPPER, [[0, 0.062, 0.06, 0, jersey], [0.12, 0.064, 0.062, 0, jersey], [0.3, 0.054, 0.056, 0, jersey], [0.46, 0.05, 0.053, 0, jersey], [0.465, 0.05, 0.053, 0, side],
        [0.52, 0.049, 0.052, 0, side], [0.525, 0.047, 0.05, 0, skin], [0.68, 0.046, 0.05, 0.004, skin], [0.86, 0.04, 0.042, 0.002, skin], [1, 0.039, 0.039, 0, skin]]),
      // Gelenke: runde Kappen am Anfang von Unterarm und Wade (eine Geometrie, ein Zeichenaufruf weniger)
      foreL: mergeGeo(foreGeo(skin, glove, -1), elbowCap(skin)),
      foreR: mergeGeo(foreGeo(skin, glove, 1), elbowCap(skin)),
    };
  });
}

/** Neigung des Oberkörpers, bei der die Schulter den Abstand len zur Hand (bzw. zum Ellbogen) hat */
function trunkAngle(pelvis: THREE.Vector3, target: THREE.Vector3, len: number, dx: number): number {
  const r = SPINE - 0.035;
  const Dy = pelvis.y - target.y;
  const Dz = pelvis.z - target.z;
  const Rr = Math.hypot(Dy, Dz);
  const K = (len * len - dx * dx - Rr * Rr - r * r) / (2 * r);
  return Math.atan2(Dz, Dy) + Math.asin(Math.max(-1, Math.min(1, K / Rr)));
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
  /** Speichen und ihre Unschärfe-Scheiben (vorn, hinten) */
  private spokes: THREE.Mesh[] = [];
  private blurs: THREE.Mesh[] = [];
  private lastRoll = 0;
  private blurOn = false;
  /** weit weg: kleine Teile (Kurbel, Schriftzüge, Schuhe, Gelenkkappen, Speichen) nicht zeichnen */
  private far = false;
  private minor: THREE.Object3D[] = [];
  private crank: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  readonly lamp: THREE.Mesh;
  kitKey = '';
  /** Anhänger (Wohnwagen): hängt in der Kupplung, folgt der gefahrenen Spur, neigt sich nicht mit */
  private trailer: THREE.Group | null = null;
  private trailerWheels: THREE.Mesh[] = [];
  private hitch = new THREE.Vector3();
  private trailerSpin = 1;
  private trailerAxle = 0;
  private trailerOff = 0;
  /** gefahrene Spur (Weltkoordinaten x, y, z; neueste zuletzt) */
  private track: number[] = [];

  /** Maße des Rads (Sattel, Griffe, Auflieger) */
  private fit: BikeFit;

  /** q = 1: eigenes Rad in voller Detailstufe (Schriftzüge, Kette, Zähne …), 0: Gegner */
  constructor(kit: Kit, shadowTex: THREE.Texture, q: 0 | 1 = 0) {
    this.group.rotation.order = 'YXZ';
    this.group.add(this.body);
    // Geometrien und Materialien werden je Aussehen nur einmal gebaut und von allen Fahrern geteilt –
    // ein neuer Fahrer im Bild kostet so kaum Rechenzeit (sonst ruckelt es, wenn Fahrer auftauchen)
    const smooth = baseMat();
    const gloss = glossMat();
    const bike = bikeBuild(kit.bike, kit, q);
    this.fit = bike.fit;
    const frame = new THREE.Mesh(bike.frame, gloss);
    this.wheelF = new THREE.Mesh(bike.wheelF, gloss);
    this.wheelF.position.copy(bike.fit.front);
    this.wheelR = new THREE.Mesh(bike.wheelR, gloss);
    this.wheelR.position.copy(bike.fit.rear);
    this.crank = new THREE.Mesh(bike.crank, gloss);
    // Hochrad: die Kurbel sitzt an der Vorderradnabe
    this.crank.position.copy(bike.fit.bb ?? BB);
    this.body.add(frame, this.wheelF, this.wheelR, this.crank);
    for (const [w, geo, r] of [[this.wheelF, bike.spokes.f, bike.spokes.rF], [this.wheelR, bike.spokes.r, bike.spokes.rR]] as const) {
      if (!geo) continue;
      const sp = new THREE.Mesh(geo, gloss);
      const bd = blurDisc(r);
      w.add(sp, bd);
      this.spokes.push(sp);
      this.blurs.push(bd);
    }
    if (bike.decal) {
      const d = new THREE.Mesh(bike.decal.frame, bike.decal.mat);
      this.body.add(d);
      this.minor.push(d);
      if (bike.decal.rimF) { const m = new THREE.Mesh(bike.decal.rimF, bike.decal.rimMat); this.wheelF.add(m); this.minor.push(m); }
      if (bike.decal.rimR) { const m = new THREE.Mesh(bike.decal.rimR, bike.decal.rimMat); this.wheelR.add(m); this.minor.push(m); }
    }
    this.minor.push(this.crank);
    const g = limbGeos(kit);
    const shoe = shoeBuild(kit, bike.spec.pedals, q);
    for (let s = 0; s < 2; s++) {
      const t = new THREE.Mesh(g.thigh, smooth);
      const c = new THREE.Mesh(g.shin, smooth);
      const u = new THREE.Mesh(g.upper, smooth);
      const f = new THREE.Mesh(s === 0 ? g.foreL : g.foreR, smooth);
      const sh = new THREE.Mesh(shoe, gloss);
      this.thighs.push(t);
      this.shins.push(c);
      this.uppers.push(u);
      this.fores.push(f);
      this.shoes.push(sh);
      this.body.add(t, c, u, f, sh);
      this.minor.push(sh);
    }
    this.torso = new THREE.Mesh(cached('torso', () => torsoGeo()), torsoMat(kit));
    // manche Räder bringen ihren eigenen Helm mit (Weltmeisterweiß, Gold)
    this.head = new THREE.Mesh(headBuild(bike.spec.helmet ? { ...kit, helmet: bike.spec.helmet } : kit, bike.spec.head, q), gloss);
    this.body.add(this.torso, this.head);

    const lamp = lampParts();
    this.lamp = new THREE.Mesh(lamp.geo, lamp.mat);
    this.lamp.position.copy(bike.fit.lamp);
    this.body.add(this.lamp);
    if (bike.trailer) {
      const t = bike.trailer;
      const tr = new THREE.Group();
      tr.rotation.order = 'YXZ';
      tr.add(new THREE.Mesh(t.body, gloss));
      for (const w of t.wheels) {
        const m = new THREE.Mesh(t.wheel, gloss);
        m.position.copy(w);
        tr.add(m);
        this.trailerWheels.push(m);
      }
      if (t.plate) tr.add(new THREE.Mesh(t.plate.geo, t.plate.mat));
      const sh = new THREE.Mesh(SHADOW_GEO(), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.5 }));
      sh.rotation.x = -Math.PI / 2;
      sh.scale.set(0.95, 0.85, 1);
      sh.position.set(t.axleX, 0.03 - t.hitch.y, t.axle - 0.12);
      sh.renderOrder = 1;
      tr.add(sh);
      this.hitch.copy(t.hitch);
      this.trailerSpin = 0.335 / t.wheelR;
      this.trailerAxle = t.axle;
      this.trailerOff = Math.atan2(t.axleX, t.axle);
      tr.position.copy(t.hitch);
      this.trailer = tr;
      this.group.add(tr);
    }
    this.shadow = new THREE.Mesh(SHADOW_GEO(), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.55 }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.03;
    this.shadow.renderOrder = 1;
    this.group.add(this.shadow);
    this.kitKey = riderKitKey(kit);
  }

  /** Detailstufe nach Abstand: weit weg die kleinen Teile weglassen (halb so viele Zeichenaufrufe) */
  get isFar() { return this.far; }

  setFar(far: boolean) {
    if (far === this.far) return;
    this.far = far;
    for (const o of this.minor) o.visible = !far;
    for (const m of this.spokes) m.visible = !far && !this.blurOn;
    for (const m of this.blurs) m.visible = !far && this.blurOn;
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
  private pelvis = new THREE.Vector3();

  private hand = new THREE.Vector3();
  private elbowPad = new THREE.Vector3();

  private cq = new THREE.Quaternion();

  pose(p: RiderPose) {
    const st = Math.max(0, Math.min(1, p.stand ?? 0));
    const kind = Math.max(0, Math.min(1, p.sprint ?? 0));
    const spr = st * kind;
    const dance = st - spr;
    const tuck = Math.max(0, Math.min(1, p.tuck - p.brake * 0.6)) * (1 - st);
    const brake = Math.max(0, Math.min(1, p.brake));
    const fit = this.fit;
    // Kurbel: Winkel 0 = rechtes Pedal oben, vorwärts drehend (pedal = 0 → Kurbel waagrecht)
    const th = p.pedal + Math.PI / 2;
    this.crank.rotation.x = -th;
    // aus dem Sattel pendelt das Rad im Takt der Tritte unter dem Fahrer (beim Tritt rechts nach links) –
    // im Sprint weit, am Berg ruhiger. Der Oberkörper geht nur zum Teil mit: Arme ziehen abwechselnd am Lenker
    const alpha = st * (0.1 + 0.12 * kind) * Math.sin(th);
    this.body.rotation.z = -p.lean + alpha;
    const counter = -alpha * (0.62 + 0.18 * kind);
    if (p.roll !== undefined) {
      // schnell gedreht (mehr als ~0,25 rad je Bild): Speichen verschwimmen
      const dr = Math.abs(p.roll - this.lastRoll);
      this.lastRoll = p.roll;
      const on = this.blurOn ? dr > 0.16 : dr > 0.26;
      if (on !== this.blurOn && dr < 3) {
        this.blurOn = on;
        for (const m of this.spokes) m.visible = !on && !this.far;
        for (const m of this.blurs) m.visible = on && !this.far;
      }
      this.wheelF.rotation.x = -p.roll * (this.fit.spinF ?? 1);
      this.wheelR.rotation.x = -p.roll * (this.fit.spinR ?? 1);
      for (const w of this.trailerWheels) w.rotation.x = -p.roll * this.trailerSpin;
    }
    if (this.trailer) this.followTrailer();

    // Becken über dem Sattel, im Wiegetritt nach vorn über das Tretlager (Hochrad: über der Nabe); es hebt und
    // senkt sich mit jedem Tritt und bleibt über der Mitte, während das Rad pendelt
    const bb = fit.bb ?? BB;
    const pelvis = this.pelvis.copy(fit.pelvis).lerp(this.v3.copy(PELVIS_UP).lerp(PELVIS_SPRINT, kind).add(bb), st);
    pelvis.y += st * 0.016 * Math.cos(2 * th);
    pelvis.x += Math.sin(-counter) * pelvis.y * 0.85;
    // Zeitfahrrad: auf den Polstern liegen, außer beim Bremsen und im Wiegetritt
    const aero = fit.aero ? Math.max(0, 1 - brake * 1.6) * (1 - st) : 0;
    // rechte Hand: Griff → Unterlenker (geduckt) bzw. Auflieger
    const hand = this.hand.copy(fit.hood).lerp(fit.drop, Math.max(tuck, spr));
    // Hochrad: fester, aufrechter Oberkörper (Griffe tief neben der Hüfte)
    let beta = fit.trunk !== undefined
      ? fit.trunk - 0.16 * Math.max(tuck, spr)
      : trunkAngle(pelvis, hand, 0.55 - 0.08 * tuck + 0.02 * dance - 0.08 * spr + 0.015 * brake, hand.x - 0.172);
    if (fit.aero && aero > 0) {
      // Schulter über dem Ellbogen auf dem Polster, Hand vorn am Auflieger
      this.elbowPad.copy(fit.aero.pad).add(new THREE.Vector3(0, 0.028, -0.016));
      const ba = trunkAngle(pelvis, this.elbowPad, UPPER, 0.172 - this.elbowPad.x);
      beta += (ba - beta) * aero;
      hand.lerp(fit.aero.hand, aero);
    }
    // aufrechte Räder (Hollandlenker, Hochrad, Hochlenker) erlauben einen steileren Oberkörper
    beta = Math.max(0.12, Math.min(fit.upright ?? 0.95, beta));
    this.spine.set(0, Math.sin(beta), -Math.cos(beta));
    this.torso.position.copy(pelvis);
    this.torso.quaternion.setFromUnitVectors(UP, this.spine);
    // Oberkörper gegen das Pendeln des Rads drehen (um die Fahrtrichtung)
    this.torso.quaternion.premultiply(this.cq.setFromAxisAngle(ZAXIS, counter));
    this.sq.copy(this.torso.quaternion);

    // Kopf: über dem Halsansatz, Blick nach vorn auf die Straße (flacher Rücken → Kopf weiter in den Nacken)
    const flat = Math.max(0, Math.min(1, (0.7 - beta) / 0.45));
    const neck = this.v1.set(0, SPINE + 0.07, 0.01).applyQuaternion(this.sq).add(pelvis);
    this.head.position.set(neck.x, neck.y + 0.11 - flat * 0.016 - spr * 0.045, neck.z - 0.05 - flat * 0.035);
    this.head.rotation.x = 0.08 + flat * 0.14 - brake * 0.05 + spr * 0.08;
    // Kopf bleibt beim Pendeln fast waagrecht, im Sprint wippt er leicht mit
    this.head.rotation.z = -counter * 0.4 + alpha * 0.25;

    // Beine: Hüfte → Knöchel über dem Pedal, Knie nach vorn
    const crank = fit.crank ?? CRANK;
    const qx = fit.pedalX ?? Q;
    for (let s = 0; s < 2; s++) {
      const sx = s === 0 ? -1 : 1;
      const a = s === 0 ? th + Math.PI : th;
      const ped = this.v2.set(sx * qx, bb.y + Math.cos(a) * crank, bb.z - Math.sin(a) * crank);
      const pitch = -0.2 + 0.16 * Math.sin(a);
      const shoe = this.shoes[s];
      shoe.position.copy(ped);
      shoe.rotation.x = pitch;
      const ankle = this.v3.copy(ANKLE).applyAxisAngle(XAXIS, pitch).add(ped);
      ankle.x -= sx * 0.008;
      const hip = this.v1.set(pelvis.x + sx * 0.088, pelvis.y - 0.012 - sx * Math.sin(counter) * 0.088, pelvis.z - 0.02);
      this.pole.set(sx * 0.12, 0.25, -1);
      const knee = this.v4;
      ik(hip, ankle, THIGH, SHIN, this.pole, knee, ankle);
      bone(this.thighs[s], hip, knee);
      bone(this.shins[s], knee, ankle);
    }

    // Arme: Schulter → Hand; Ellbogen leicht nach außen, auf dem Zeitfahrrad nach unten auf die Polster
    for (let s = 0; s < 2; s++) {
      const sx = s === 0 ? -1 : 1;
      const shoulder = this.v1.set(sx * 0.172, SPINE - 0.035, 0.0).applyQuaternion(this.sq).add(pelvis);
      const h = this.v2.set(sx * hand.x, hand.y, hand.z);
      // im Sprint die Ellbogen weit nach außen
      this.pole.set(sx * (0.7 + 0.6 * spr) * (1 - aero) + sx * 0.05 * aero, -0.35 - 0.65 * aero - 0.2 * spr, 0.45 - 0.25 * aero);
      const elbow = this.v4;
      ik(shoulder, h, UPPER, FORE, this.pole, elbow, h);
      bone(this.uppers[s], shoulder, elbow);
      bone(this.fores[s], elbow, h);
    }
    (this.lamp.material as THREE.MeshLambertMaterial).emissiveIntensity = 0.4 + p.light * 1.6;
  }

  private tv = new THREE.Vector3();
  /**
   * Anhänger nachziehen: Die Achse läuft auf der Spur, die die Kupplung vorher gefahren ist (wie ein echter
   * Anhänger in der Kurve); Kupplung neigt sich mit dem Rad, der Wohnwagen bleibt aufrecht. Neigung aus der
   * Höhe der Spur (bergauf, bergab). Springt der Fahrer (Neustart), beginnt die Spur neu.
   */
  private followTrailer() {
    const tr = this.trailer!;
    const g = this.group.position;
    const ry = this.group.rotation.y;
    const T = this.track;
    const n = T.length;
    if (n) {
      const d = Math.hypot(g.x - T[n - 3], g.z - T[n - 1]);
      if (d > 4) T.length = 0;
      else if (d > 0.04) T.push(g.x, g.y, g.z);
    }
    if (!T.length) T.push(g.x, g.y, g.z);
    // Punkt auf der Spur: Kupplung hinter dem Tretlager plus Deichsel bis zur Achse
    let rem = this.hitch.z + this.trailerAxle;
    let px = g.x, py = g.y, pz = g.z;
    let ax = 0, ay = 0, az = 0;
    let found = false;
    let cut = 0;
    for (let i = T.length - 3; i >= 0; i -= 3) {
      const qx = T[i], qy = T[i + 1], qz = T[i + 2];
      const seg = Math.hypot(qx - px, qz - pz);
      if (seg >= rem && seg > 1e-6) {
        const t = rem / seg;
        ax = px + (qx - px) * t; ay = py + (qy - py) * t; az = pz + (qz - pz) * t;
        found = true;
        cut = i;
        break;
      }
      rem -= seg;
      px = qx; py = qy; pz = qz;
    }
    if (!found) {
      // noch keine Spur: gerade nach hinten
      ax = px + Math.sin(ry) * rem; ay = py; az = pz + Math.cos(ry) * rem;
    } else if (cut > 30) T.splice(0, cut - 30);
    // Kupplung in der Welt (ohne Schräglage) und Richtung zur Achse, in Fahrerkoordinaten
    const c = Math.cos(ry), s = Math.sin(ry);
    const hx = g.x + this.hitch.x * c + this.hitch.z * s;
    const hz = g.z - this.hitch.x * s + this.hitch.z * c;
    const dx = ax - hx, dz = az - hz;
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    let yaw = Math.atan2(lx, lz) - this.trailerOff;
    yaw = Math.max(-1.2, Math.min(1.2, yaw));
    const pitch = -Math.asin(Math.max(-0.25, Math.min(0.25, (ay - g.y) / Math.max(0.5, this.trailerAxle))));
    // Kupplung folgt der Schräglage des Rads
    tr.position.copy(this.tv.copy(this.hitch).applyEuler(this.body.rotation));
    tr.rotation.set(pitch, yaw, 0);
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
