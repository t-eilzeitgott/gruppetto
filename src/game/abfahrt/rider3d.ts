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
import type { WreckPose } from './wreck';
import type { Kit } from './rider';
import { alphaTex, lin, type RGBf } from './models3d';
import { BIKE_BB, bikeBuild, type BikeFit } from './bike3d';
import { FAR1, LambertFarMaterial, glossFarMat, glossMat } from './gloss';
import { headBuild, shoeBuild } from './gear3d';
import { appearify, setAp } from './appear';

/**
 * Haltung: Schräglage, Kurbelwinkel, geduckt, bremsen, Licht, Radumdrehung, Wiegetritt (0–1) und dessen Art:
 * sprint = 1 Sprint (Unterlenker, tief, Rad pendelt weit), 0 Wiegetritt am Berg (Griffe, aufrechter).
 * Die übrigen Werte sind Nebenbewegungen (riderAnim.ts liefert sie; ohne sie steht der Fahrer ruhig).
 */
export interface RiderPose {
  lean: number; pedal: number; tuck: number; brake: number; light: number; roll?: number; stand?: number; sprint?: number;
  /** Oberkörper arbeitet mit (0–1): Hüfte schwingt, Schultern und Kopf wippen im Takt der Kurbel */
  pump?: number;
  /** Rütteln (0–1): Pflaster, Schotter, Wind bei hohem Tempo */
  shake?: number;
  /** aus dem Sattel mit weichen Knien, Arme gebeugt (0–1): in der Luft, bei der Landung */
  absorb?: number;
  /** Atmen (0–1, weiche Welle): Schultern heben sich */
  breath?: number;
  /** Zeit (s) für das Rütteln */
  t?: number;
  /** Änderung der Schräglage (rad/s): der Oberkörper geht beim Einlenken voraus */
  leanRate?: number;
  /** Bremsbeginn (0–1): Oberkörper rutscht kurz nach vorn */
  lurch?: number;
  /** Blick in die Kurve (rad, + nach rechts) */
  look?: number;
  /** persönlicher Versatz fürs Rütteln */
  seed?: number;
}

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
/** abfedern (Sprung, Landung): knapp über dem Sattel, Knie weich, Gewicht über dem Tretlager */
const PELVIS_ABSORB = new THREE.Vector3(0, 0.72, 0.07);
const ZAXIS = new THREE.Vector3(0, 0, 1);
/** Knöchel relativ zur Pedalachse (Fußballen über dem Pedal) */
const ANKLE = new THREE.Vector3(0, 0.075, 0.105);
const XAXIS = new THREE.Vector3(1, 0, 0);

// ------------------------------------------------------------------ glatte Körper

/** indizierter Baukasten: Ringe zu Röhren verbinden, glatte Normalen */
export class MB {
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
export interface Ring { y: number; a: number; b: number; cz?: number; c: RGBf }

/** Röhre aus Ringen entlang +y, Enden geschlossen; u läuft rundherum (0 = rechts, 0,75 = hinten, 0,25 = vorn) */
export function loft(mb: MB, rings: Ring[], n: number, v0: number, v1: number) {
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
export function muscle(len: number, prof: [number, number, number, number, RGBf][], n = 14): THREE.BufferGeometry {
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
  // unten ein weißer Streifen (TORSO_PAD): dorthin zeigen Arme und Beine, die mit dem Rumpf in einem Netz
  // stecken und ihre Farbe je Ecke tragen
  cv.height = H + TORSO_PAD;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#ffffff';
  c.fillRect(0, H, W, TORSO_PAD);
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
  const m = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true });
  torsoCache.set(key, m);
  return m;
}
/** weißer Streifen unter der Trikottextur (Bildpunkte) */
const TORSO_PAD = 16;
/** Texturkoordinate (v) der Glieder: mitten im weißen Streifen */
const LIMB_V = TORSO_PAD / 2 / (128 + TORSO_PAD);

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
  const g = mb.build();
  // Textur hat unten den weißen Streifen der Glieder: den Rumpf in den Teil darüber legen
  const uv = g.getAttribute('uv');
  const k = 128 / (128 + TORSO_PAD);
  // unterster Ring und Deckel ein paar Texel über der Grenze: sonst mischt die Filterung den weißen Streifen
  // hinein (grauer Fleck hinten auf der Hose, aus tiefer Kamera sichtbar)
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - k + Math.max(uv.getY(i), 0.035) * k);
  return g;
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
export function bone(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(UP, tmpD.subVectors(b, a).normalize());
}
const tmpD = new THREE.Vector3();
const tmpQ = new THREE.Vector3();

/** Zweigelenk-Rechnung: Gelenk zwischen a und c bei festen Längen, gebeugt Richtung pole */
export function ik(a: THREE.Vector3, c: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, out: THREE.Vector3, end: THREE.Vector3) {
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
  // beidseitig in einem Durchgang (sonst zwei Zeichenaufrufe je Scheibe und jedes Mal ein Materialwechsel)
  blur = { mat: new LambertFarMaterial({ map: alphaTex(cv, [40, 40, 44]), transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true }), geos: new Map() };
  return blur;
}
function blurDiscGeo(r: number): THREE.BufferGeometry {
  const b = blurParts();
  const key = Math.round(r * 1000);
  let geo = b.geos.get(key);
  if (!geo) { geo = new THREE.CircleGeometry(r, 28).rotateY(Math.PI / 2); b.geos.set(key, geo); }
  return geo;
}

let shadowGeo: THREE.PlaneGeometry | null = null;
const SHADOW_GEO = () => (shadowGeo ??= new THREE.PlaneGeometry(1.1, 2.2));

interface Limbs { thigh: THREE.BufferGeometry; shin: THREE.BufferGeometry; upper: THREE.BufferGeometry; foreL: THREE.BufferGeometry; foreR: THREE.BufferGeometry }
export const elbowCap = (skin: RGBf) => { const mb = new MB(); mb.add(new THREE.SphereGeometry(0.042, 10, 8), new THREE.Matrix4(), skin); return mb.build(); };
export const kneeCap = (skin: RGBf) => { const mb = new MB(); mb.add(new THREE.SphereGeometry(0.05, 12, 8), new THREE.Matrix4().makeScale(1, 1, 1.08), skin); return mb.build(); };
const geoCache = new Map<string, unknown>();
export function cached<T>(key: string, make: () => T): T {
  let v = geoCache.get(key) as T | undefined;
  if (v === undefined) { v = make(); geoCache.set(key, v); }
  return v;
}

/** Arme und Beine (geteilt je Farbkombination) */
/** zwei Geometrien zu einer (gleiche Eigenschaften, Indizes versetzt) – spart einen Zeichenaufruf */
export function mergeGeo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
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

/**
 * Ein Fahrer besteht aus gut zwanzig bewegten Teilen (Rad, Räder, Kurbel, Glieder, Kopf …). Jedes als eigenes
 * Netz hieße gut zwanzig Zeichenaufrufe je Fahrer – im Feld des Sprints mehrere hundert je Bild, auf dem Handy
 * der teuerste Posten. Deshalb sind die Teile je Material zu einem Netz verschmolzen und hängen über
 * „Knochen“ (Skinning, ein Knochen je Teil) an den bewegten Gelenken: die Animation setzt wie bisher Lage und
 * Drehung der Gelenke, das Netz folgt im Vertex-Shader. Die Knochenmatrizen sind relativ zum Körper (nicht
 * Weltkoordinaten): so bleiben sie klein und genau, obwohl die Welt kilometerweit reicht.
 */
export class RelSkeleton extends THREE.Skeleton {
  private inv = new THREE.Matrix4();
  private rel = new THREE.Matrix4();
  constructor(bones: THREE.Bone[], private ref: THREE.Object3D) {
    super(bones, bones.map(() => new THREE.Matrix4()));
  }
  override update() {
    const inv = this.inv.copy(this.ref.matrixWorld).invert();
    for (let i = 0; i < this.bones.length; i++) {
      this.rel.multiplyMatrices(inv, this.bones[i].matrixWorld);
      this.rel.toArray(this.boneMatrices!, i * 16);
    }
    if (this.boneTexture) this.boneTexture.needsUpdate = true;
  }
}

const IDENTITY = new THREE.Matrix4();

/** Teile (je in eigenen Koordinaten) zu einer Geometrie mit Knochenindex je Ecke */
export function skinGeo(parts: { g: THREE.BufferGeometry; bone: number; pad?: boolean }[], pv = LIMB_V): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  let n = 0;
  let ni = 0;
  for (const { g: a } of parts) { n += a.getAttribute('position').count; ni += a.index ? a.index.count : a.getAttribute('position').count; }
  // Attribute, die alle Teile haben (Farbe und Glanz ergänzt, wo sie fehlen – das Material liest sie dann nicht)
  const names = new Set(Object.keys(parts[0].g.attributes));
  for (const { g: a } of parts) for (const k of names) if (!a.getAttribute(k) && k !== 'color' && k !== 'gloss' && k !== 'uv') names.delete(k);
  const out: Record<string, { arr: Float32Array; size: number }> = {};
  for (const k of names) {
    const size = parts[0].g.getAttribute(k).itemSize;
    out[k] = { arr: new Float32Array(n * size), size };
  }
  const si = new Float32Array(n * 4);
  const sw = new Float32Array(n * 4);
  const idx = n > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let ov = 0;
  let oi = 0;
  for (const { g: a, bone, pad } of parts) {
    const c = a.getAttribute('position').count;
    for (const k of names) {
      const A = a.getAttribute(k) as THREE.BufferAttribute | undefined;
      const o = out[k];
      // pad: Teil ohne Textur (Farbe je Ecke) – zeigt auf den weißen Streifen der Trikottextur
      if (A && A.itemSize === o.size && !(pad && k === 'uv')) o.arr.set(A.array as Float32Array, ov * o.size);
      else if (k === 'color') o.arr.fill(1, ov * 3, (ov + c) * 3);
      else if (k === 'gloss') o.arr.fill(0.3, ov, ov + c);
      else if (k === 'uv') for (let i = 0; i < c; i++) { o.arr[(ov + i) * 2] = 0.5; o.arr[(ov + i) * 2 + 1] = pv; }
    }
    for (let i = 0; i < c; i++) { si[(ov + i) * 4] = bone; sw[(ov + i) * 4] = 1; }
    if (a.index) for (let i = 0; i < a.index.count; i++) idx[oi + i] = a.index.getX(i) + ov;
    else for (let i = 0; i < c; i++) idx[oi + i] = ov + i;
    ov += c;
    oi += a.index ? a.index.count : c;
  }
  for (const k of names) g.setAttribute(k, new THREE.BufferAttribute(out[k].arr, out[k].size));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  // die Teile bewegen sich um höchstens gut einen Meter: eine feste Hülle statt je Bild neu
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 2.4);
  return g;
}

export class RiderModel {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private torso: THREE.Bone;
  private head: THREE.Bone;
  private thighs: THREE.Bone[] = [];
  private shins: THREE.Bone[] = [];
  private uppers: THREE.Bone[] = [];
  private fores: THREE.Bone[] = [];
  private shoes: THREE.Bone[] = [];
  private wheelF: THREE.Bone;
  private wheelR: THREE.Bone;
  /** Speichen und ihre Unschärfe-Scheiben (beide Räder je ein Netz) */
  private spokes: THREE.Object3D[] = [];
  private blurs: THREE.Object3D[] = [];
  private lastRoll = 0;
  private blurOn = false;
  /** weit weg: kleine Teile (Kurbel, Schriftzüge, Schuhe, Gelenkkappen, Speichen) nicht zeichnen */
  private far = false;
  private minor: THREE.Object3D[] = [];
  private crank: THREE.Bone;
  /** Rahmen (fester Knochen) – für den Sturz (Rad und Fahrer getrennt) */
  private frameBone!: THREE.Bone;
  /** Haltung im Moment des Sturzes (Lage, Drehung je Knochen); null = fährt */
  private wreckSnap: { b: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion }[] | null = null;
  readonly shadow: THREE.Mesh;
  readonly lamp: THREE.Mesh;
  kitKey = '';
  /** Anhänger (Wohnwagen): hängt in der Kupplung, folgt der gefahrenen Spur, neigt sich nicht mit */
  private trailer: THREE.Group | null = null;
  private trailerWheels: THREE.Bone[] = [];
  /** alle Netze (zum Umschalten der Materialien beim Durchsichtigwerden) */
  private meshes: THREE.Mesh[] = [];
  private skel: RelSkeleton;
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
    const gloss = glossMat();
    // kleine Teile: lösen sich in der Ferne gerastert auf (kein Aufploppen)
    const glossFar = glossFarMat();
    const bike = bikeBuild(kit.bike, kit, q);
    this.fit = bike.fit;
    // Gelenke (Knochen): ein Teil je Knochen, die Geometrien hängen als verschmolzene Netze daran
    const bones: THREE.Bone[] = [];
    const joint = (parent: THREE.Object3D) => { const b = new THREE.Bone(); parent.add(b); bones.push(b); return b; };
    const fixed = joint(this.body);
    this.frameBone = fixed;
    this.wheelF = joint(this.body);
    this.wheelF.position.copy(bike.fit.front);
    this.wheelR = joint(this.body);
    this.wheelR.position.copy(bike.fit.rear);
    this.crank = joint(this.body);
    // Hochrad: die Kurbel sitzt an der Vorderradnabe
    this.crank.position.copy(bike.fit.bb ?? BB);
    const bi = (b: THREE.Bone) => bones.indexOf(b);
    // Netze je Material: Glanz (Rahmen, Räder, Kopf, Anhänger), kleine Glanzteile (Kurbel, Schuhe), Glieder
    const glossParts: { g: THREE.BufferGeometry; bone: number }[] = [{ g: bike.frame, bone: bi(fixed) }, { g: bike.wheelF, bone: bi(this.wheelF) }, { g: bike.wheelR, bone: bi(this.wheelR) }];
    const farParts: { g: THREE.BufferGeometry; bone: number }[] = [{ g: bike.crank, bone: bi(this.crank) }];
    const spokeParts: { g: THREE.BufferGeometry; bone: number }[] = [];
    const blurParts2: { g: THREE.BufferGeometry; bone: number }[] = [];
    for (const [w, geo, r] of [[this.wheelF, bike.spokes.f, bike.spokes.rF], [this.wheelR, bike.spokes.r, bike.spokes.rR]] as const) {
      if (!geo) continue;
      spokeParts.push({ g: geo, bone: bi(w) });
      blurParts2.push({ g: blurDiscGeo(r), bone: bi(w) });
    }
    const decalParts: { g: THREE.BufferGeometry; bone: number; mat: THREE.Material }[] = [];
    if (bike.decal) {
      decalParts.push({ g: bike.decal.frame, bone: bi(fixed), mat: bike.decal.mat });
      if (bike.decal.rimF) decalParts.push({ g: bike.decal.rimF, bone: bi(this.wheelF), mat: bike.decal.rimMat });
      if (bike.decal.rimR) decalParts.push({ g: bike.decal.rimR, bone: bi(this.wheelR), mat: bike.decal.rimMat });
    }
    const g = limbGeos(kit);
    const shoe = shoeBuild(kit, bike.spec.pedals, q);
    const limbParts: { g: THREE.BufferGeometry; bone: number; pad: boolean }[] = [];
    for (let s = 0; s < 2; s++) {
      const t = joint(this.body);
      const c = joint(this.body);
      const u = joint(this.body);
      const f = joint(this.body);
      const sh = joint(this.body);
      this.thighs.push(t);
      this.shins.push(c);
      this.uppers.push(u);
      this.fores.push(f);
      this.shoes.push(sh);
      limbParts.push({ g: g.thigh, bone: bi(t), pad: true }, { g: g.shin, bone: bi(c), pad: true }, { g: g.upper, bone: bi(u), pad: true }, { g: s === 0 ? g.foreL : g.foreR, bone: bi(f), pad: true });
      farParts.push({ g: shoe, bone: bi(sh) });
    }
    this.torso = joint(this.body);
    // manche Räder bringen ihren eigenen Helm mit (Weltmeisterweiß, Gold)
    this.head = joint(this.body);
    glossParts.push({ g: headBuild(bike.spec.helmet ? { ...kit, helmet: bike.spec.helmet } : kit, bike.spec.head, q), bone: bi(this.head) });

    const lamp = lampParts();
    this.lamp = new THREE.Mesh(lamp.geo, lamp.mat);
    this.lamp.position.copy(bike.fit.lamp);
    this.body.add(this.lamp);
    // (in der Ferne kein eigener Zeichenaufruf für das Rücklicht: ein paar Zentimeter groß)
    this.minor.push(this.lamp);
    let plate: { g: THREE.BufferGeometry; bone: number; mat: THREE.Material } | null = null;
    if (bike.trailer) {
      const t = bike.trailer;
      const tr = new THREE.Group();
      tr.rotation.order = 'YXZ';
      const tb = joint(tr);
      glossParts.push({ g: t.body, bone: bi(tb) });
      for (const w of t.wheels) {
        const m = joint(tr);
        m.position.copy(w);
        this.trailerWheels.push(m);
        glossParts.push({ g: t.wheel, bone: bi(m) });
      }
      if (t.plate) plate = { g: t.plate.geo, bone: bi(tb), mat: t.plate.mat };
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
    // verschmolzene Netze (Geometrie je Aussehen geteilt, Skelett je Fahrer)
    const skel = new RelSkeleton(bones, this.body);
    this.skel = skel;
    const key = `${riderKitKey(kit)}|${q}`;
    const skinned = (name: string, parts: { g: THREE.BufferGeometry; bone: number }[], mat: THREE.Material, order = 0) => {
      const geo = cached(`skin:${name}:${key}`, () => skinGeo(parts));
      const m = new THREE.SkinnedMesh(geo, mat);
      m.bindMode = THREE.DetachedBindMode;
      m.bind(skel, IDENTITY);
      m.boundingSphere = geo.boundingSphere!.clone();
      m.renderOrder = order;
      this.body.add(m);
      this.meshes.push(m);
      return m;
    };
    skinned('gloss', glossParts, gloss);
    // Rumpf (Trikottextur) und Glieder (Farbe je Ecke) in einem Netz: die Glieder zeigen auf den weißen Streifen
    skinned('body', [{ g: cached('torso', () => torsoGeo()), bone: bi(this.torso) }, ...limbParts], torsoMat(kit));
    this.minor.push(skinned('far', farParts, glossFar));
    if (spokeParts.length) {
      this.spokes.push(skinned('spokes', spokeParts, glossFar));
      const bd = skinned('blur', blurParts2, blurParts().mat, 2);
      bd.visible = false;
      this.blurs.push(bd);
    }
    decalParts.forEach((d, i) => this.minor.push(skinned(`decal${i}`, [d], d.mat)));
    if (plate) skinned('plate', [plate], plate.mat);
    this.shadow = new THREE.Mesh(SHADOW_GEO(), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.55 }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.03;
    this.shadow.renderOrder = 1;
    this.group.add(this.shadow);
    this.kitKey = riderKitKey(kit);
  }

  /** Skelett (Knochentextur) freigeben; Geometrien und Materialien sind geteilt und bleiben */
  dispose() {
    this.skel.dispose();
  }

  /** In der Ferne zeigt ein 2D-Bild den Fahrer (riderSprites): Körper und Rad nicht zeichnen – der Schatten bleibt */
  setSprite(on: boolean) {
    this.body.visible = !on;
    if (this.trailer) this.trailer.visible = !on;
  }
  get isSprite() { return !this.body.visible; }

  /** weiches Aus-/Einblenden von Körper und Rad (appear.ts; der Schatten bleibt unberührt) */
  setBodyAp(code: number | undefined) {
    setAp(this.body, code);
    if (this.trailer) setAp(this.trailer, code);
  }

  /** Nur zum Zeichnen des Bildvorrats: Schatten, Lampe, Speichen und Schleier weglassen (die Felgen bleiben) */
  prepareBake() {
    this.shadow.visible = false;
    this.lamp.visible = false;
    for (const m of this.spokes) m.visible = false;
    for (const m of this.blurs) m.visible = false;
  }

  /** Detailstufe nach Abstand: weit weg die kleinen Teile weglassen (halb so viele Zeichenaufrufe).
   *  Sie sind dort schon unsichtbar (aufgelöst bis FAR1) – das Weglassen selbst sieht man nicht */
  get isFar() { return this.far; }
  static readonly FAR_HIDE = FAR1 + 1.5;

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
    for (const m of this.meshes) {
      if (Array.isArray(m.material)) continue;
      const src = m.material as THREE.Material;
      let c = cache.get(src);
      if (!c) { c = src.clone(); c.transparent = true; appearify(c); cache.set(src, c); list.push(c); }
      m.material = c;
    }
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
    // Nebenbewegungen (riderAnim.ts); ohne Angabe ruhig – so auch beim Zeichnen des Bildvorrats
    const pump = (p.pump ?? 0) * (1 - st);
    const shk = p.shake ?? 0;
    const ab = (p.absorb ?? 0) * (1 - st);
    const br = p.breath ?? 0;
    const lurch = p.lurch ?? 0;
    const lr = Math.max(-2.5, Math.min(2.5, p.leanRate ?? 0));
    const tt = p.t ?? 0;
    const sd = p.seed ?? 0;
    // Rütteln: drei unregelmäßige Wellen (Becken, Schultern, Kopf), je Fahrer versetzt; höchstens ~5 Hz, damit
    // es auch bei 30 Bildern je Sekunde noch als Zittern durchgeht
    const n1 = shk ? Math.sin(tt * 17.3 + sd) * 0.6 + Math.sin(tt * 29.1 + sd * 1.3 + 0.7) * 0.4 : 0;
    const n2 = shk ? Math.sin(tt * 14.7 + sd * 0.7 + 1.1) * 0.55 + Math.sin(tt * 25.3 + sd + 2.0) * 0.45 : 0;
    const n3 = shk ? Math.sin(tt * 19.9 + sd * 2.1 + 0.4) * 0.5 + Math.sin(tt * 31.7 + sd * 0.4 + 2.6) * 0.5 : 0;
    const fit = this.fit;
    // Kurbel: Winkel 0 = rechtes Pedal oben, vorwärts drehend (pedal = 0 → Kurbel waagrecht)
    const th = p.pedal + Math.PI / 2;
    this.crank.rotation.x = -th;
    // aus dem Sattel pendelt das Rad im Takt der Tritte unter dem Fahrer (beim Tritt rechts nach links) –
    // im Sprint weit, am Berg ruhiger. Der Oberkörper geht nur zum Teil mit: Arme ziehen abwechselnd am Lenker
    const alpha = st * (0.1 + 0.12 * kind) * Math.sin(th);
    this.body.rotation.z = -p.lean + alpha;
    const counter = -alpha * (0.62 + 0.18 * kind);
    // im Sitzen schwingt die Hüfte mit jedem Tritt (die Seite des gestreckten Beins sinkt), die Schultern gehen
    // zum Teil mit; in der Kurve bleibt der Oberkörper etwas aufrechter als das Rad und geht beim Einlenken voraus
    const hipRoll = pump * 0.07 * Math.cos(th);
    const bodyRoll = counter + hipRoll * 0.5 + p.lean * 0.12 - lr * 0.03 + shk * 0.012 * n2;
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
    // Sprung und Landung: aus dem Sattel, Knie und Arme weich
    if (ab > 0) pelvis.lerp(this.v3.copy(PELVIS_ABSORB).add(bb), ab);
    // im Sitzen bleibt das Becken ruhig auf dem Sattel (nur Stöße der Straße kommen leicht durch)
    pelvis.y += st * 0.016 * Math.cos(2 * th) + shk * 0.0015 * n1;
    pelvis.x += Math.sin(-counter) * pelvis.y * 0.85 - pump * 0.01 * Math.cos(th) + shk * 0.003 * n2;
    // Zeitfahrrad: auf den Polstern liegen, außer beim Bremsen und im Wiegetritt
    const aero = fit.aero ? Math.max(0, 1 - brake * 1.6) * (1 - st) : 0;
    // rechte Hand: Griff → Unterlenker (geduckt) bzw. Auflieger
    const hand = this.hand.copy(fit.hood).lerp(fit.drop, Math.max(tuck, spr));
    // Abstand Schulter–Hand: hebt sich kaum merklich beim Atmen, beim Abfedern beugen sich die Arme. Kein Wippen
    // im Tritttakt – der Abstand kippt den ganzen Rumpf, der Kopf würde sichtbar auf und ab hüpfen
    const reach = 0.55 - 0.08 * tuck + 0.02 * dance - 0.08 * spr + 0.015 * brake
      + br * 0.002 - ab * 0.035;
    // Hochrad: fester, aufrechter Oberkörper (Griffe tief neben der Hüfte)
    let beta = fit.trunk !== undefined
      ? fit.trunk - 0.16 * Math.max(tuck, spr)
      : trunkAngle(pelvis, hand, reach, hand.x - 0.172);
    if (fit.aero && aero > 0) {
      // Schulter über dem Ellbogen auf dem Polster, Hand vorn am Auflieger
      this.elbowPad.copy(fit.aero.pad).add(new THREE.Vector3(0, 0.028, -0.016));
      const ba = trunkAngle(pelvis, this.elbowPad, UPPER, 0.172 - this.elbowPad.x);
      beta += (ba - beta) * aero;
      hand.lerp(fit.aero.hand, aero);
    }
    // Bremsbeginn: der Oberkörper rutscht kurz nach vorn
    beta -= lurch * 0.08;
    // aufrechte Räder (Hollandlenker, Hochrad, Hochlenker) erlauben einen steileren Oberkörper
    beta = Math.max(0.12, Math.min(fit.upright ?? 0.95, beta));
    this.spine.set(0, Math.sin(beta), -Math.cos(beta));
    this.torso.position.copy(pelvis);
    this.torso.quaternion.setFromUnitVectors(UP, this.spine);
    // Oberkörper gegen das Pendeln des Rads drehen (um die Fahrtrichtung), dazu Hüftschwung und Kurvenhaltung;
    // die Schultern drehen beim Treten leicht mit
    this.torso.quaternion.premultiply(this.cq.setFromAxisAngle(ZAXIS, bodyRoll));
    if (pump > 0) this.torso.quaternion.premultiply(this.cq.setFromAxisAngle(UP, -pump * 0.025 * Math.sin(th)));
    this.sq.copy(this.torso.quaternion);

    // Kopf: über dem Halsansatz, Blick nach vorn auf die Straße (flacher Rücken → Kopf weiter in den Nacken);
    // er bleibt in der Kurve aufrechter als Rad und Rumpf und schaut in die Kurve
    const flat = Math.max(0, Math.min(1, (0.7 - beta) / 0.45));
    const neck = this.v1.set(0, SPINE + 0.07, 0.01).applyQuaternion(this.sq).add(pelvis);
    const headRoll = -counter * 0.4 + alpha * 0.25 - hipRoll * 0.3 + p.lean * 0.3 + shk * 0.008 * n1;
    const up = 0.11 - flat * 0.016 - spr * 0.045;
    this.head.position.set(neck.x - Math.sin(headRoll) * up, neck.y + Math.cos(headRoll) * up, neck.z - 0.05 - flat * 0.035 - ab * 0.02);
    // der Blick bleibt ruhig auf der Straße (wie bei echten Fahrern: der Kopf gleicht die Bewegung des Rumpfs aus)
    this.head.rotation.x = 0.08 + flat * 0.14 - brake * 0.05 + spr * 0.08 - lurch * 0.1 + shk * 0.006 * n3;
    this.head.rotation.y = -(p.look ?? 0);
    // Kopf bleibt beim Pendeln fast waagrecht, im Sprint wippt er leicht mit
    this.head.rotation.z = headRoll;

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
      // Hüftgelenke folgen dem Pendeln und dem Hüftschwung (die Seite des gestreckten Beins sinkt)
      const hip = this.v1.set(pelvis.x + sx * 0.088, pelvis.y - 0.012 - sx * Math.sin(counter) * 0.088 + sx * Math.sin(hipRoll) * 0.088, pelvis.z - 0.02);
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
    if (this.wreckSnap) {
      // Rad und Fahrer zurück an ihren Platz (die Fahrhaltung setzt Rahmen und Lampe nicht neu – ohne das läge das
      // Rad nach einem Neustart weiter neben der Straße und der Fahrer stünde ohne Rad da)
      for (const s of this.wreckSnap) { s.b.position.copy(s.p); s.b.quaternion.copy(s.q); }
      this.wreckSnap = null;
      this.body.rotation.set(0, 0, 0);
    }
  }

  // ------------------------------------------------------------ Ragdoll (ragdoll.ts)

  private rv = new THREE.Vector3();
  private rv2 = new THREE.Vector3();
  private rm = new THREE.Matrix4();
  private rq = new THREE.Quaternion();
  private rx = new THREE.Vector3();
  private ry = new THREE.Vector3();
  private rz = new THREE.Vector3();
  private rJ: THREE.Vector3[] = Array.from({ length: 15 }, () => new THREE.Vector3());

  /**
   * Gelenke der aktuellen Haltung in Weltkoordinaten (Reihenfolge wie ragdoll.ts J): Becken, Brust, Kopf, Schulter/
   * Ellbogen/Hand links und rechts, Hüfte/Knie/Knöchel links und rechts. Vorher die Weltmatrix aktualisieren.
   */
  ragdollJoints(out: Float32Array) {
    this.group.updateMatrixWorld(true);
    const P = this.torso.position;
    const put = (i: number, v: THREE.Vector3) => { const w = this.rv.copy(v).applyMatrix4(this.body.matrixWorld); out[i * 3] = w.x; out[i * 3 + 1] = w.y; out[i * 3 + 2] = w.z; };
    const end = (b: THREE.Object3D, len: number) => this.rv2.set(0, len, 0).applyQuaternion(b.quaternion).add(b.position);
    put(0, P);
    put(1, this.rv2.set(0, SPINE - 0.035, 0).applyQuaternion(this.torso.quaternion).add(P).clone());
    put(2, this.head.position);
    for (let s = 0; s < 2; s++) {
      const o = s === 0 ? 3 : 6;
      put(o, this.uppers[s].position);
      put(o + 1, this.fores[s].position);
      put(o + 2, end(this.fores[s], FORE).clone());
      const h = s === 0 ? 9 : 12;
      put(h, this.thighs[s].position);
      put(h + 1, this.shins[s].position);
      put(h + 2, end(this.shins[s], SHIN).clone());
    }
  }

  /** Körper aus den Ragdoll-Punkten (Welt) setzen – das Rad bleibt, wo crashPose es hingelegt hat */
  ragdollPose(p: Float32Array) {
    this.group.updateMatrixWorld(true);
    const inv = this.rm.copy(this.body.matrixWorld).invert();
    const J = this.rJ;
    for (let i = 0; i < 15; i++) J[i].set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]).applyMatrix4(inv);
    // Rumpf: aufwärts zum Brustbein, quer von Schulter zu Schulter
    const y = this.ry.subVectors(J[1], J[0]).normalize();
    const x = this.rx.subVectors(J[6], J[3]);
    x.addScaledVector(y, -x.dot(y)).normalize();
    const z = this.rz.crossVectors(x, y);
    this.rm.makeBasis(x, y, z);
    this.rq.setFromRotationMatrix(this.rm);
    this.torso.position.copy(J[0]);
    this.torso.quaternion.copy(this.rq);
    this.head.position.copy(J[2]);
    this.head.quaternion.copy(this.rq);
    for (let s = 0; s < 2; s++) {
      const o = s === 0 ? 3 : 6;
      bone(this.uppers[s], J[o], J[o + 1]);
      bone(this.fores[s], J[o + 1], J[o + 2]);
      const h = s === 0 ? 9 : 12;
      bone(this.thighs[s], J[h], J[h + 1]);
      bone(this.shins[s], J[h + 1], J[h + 2]);
      // Schuh am Knöchel, Spitze vom Schienbein weg nach vorn
      const sh = this.shoes[s];
      sh.quaternion.copy(this.shins[s].quaternion);
      sh.position.copy(J[h + 2]).sub(this.rv.copy(ANKLE).applyQuaternion(sh.quaternion));
    }
  }

  private wq = new THREE.Quaternion();
  private wq2 = new THREE.Quaternion();
  private we = new THREE.Euler(0, 0, 0, 'YZX');
  private wv = new THREE.Vector3();
  private wPiv = new THREE.Vector3();

  /**
   * Sturz wie im Feld (wreck.ts): Rad und Fahrer trennen sich. Ausgangspunkt ist die Fahrhaltung im Moment des
   * Aufpralls; das Rad dreht als Ganzes (Nicken um den Aufstandspunkt vorn, dann Kippen und Drehen), der Körper um
   * das Becken; die Arme gehen zum Abstützen nach vorn, die Beine ziehen sich an.
   */
  crashPose(c: WreckPose) {
    const body = this.body;
    if (!this.wreckSnap) {
      body.rotation.set(0, 0, 0);
      body.position.set(0, 0, 0);
      const list = [this.frameBone, this.wheelF, this.wheelR, this.crank, this.lamp, this.torso, this.head, ...this.thighs, ...this.shins, ...this.shoes, ...this.uppers, ...this.fores];
      this.wreckSnap = list.map((b) => ({ b, p: b.position.clone(), q: b.quaternion.clone() }));
    }
    const snap = this.wreckSnap;
    const at = (b: THREE.Object3D) => snap.find((x) => x.b === b)!;
    body.rotation.set(0, 0, 0);
    body.position.set(0, 0, 0);
    // ---- Rad: Nicken um den Aufstandspunkt des Vorderrads, dann Kippen/Drehen um den Boden unter dem Tretlager
    const fz = at(this.wheelF).p.z;
    const qp = this.wq2.setFromAxisAngle(XAXIS, c.bike.pitch);
    const qb = this.wq.setFromEuler(this.we.set(0, c.bike.yaw, c.bike.roll, 'YZX'));
    for (const b of [this.frameBone, this.wheelF, this.wheelR, this.crank, this.lamp]) {
      const s0 = at(b);
      const v = this.wv.copy(s0.p);
      v.z -= fz;
      v.applyQuaternion(qp);
      v.z += fz;
      v.applyQuaternion(qb);
      b.position.set(v.x + c.bike.x, v.y + c.bike.y, v.z + c.bike.z);
      b.quaternion.copy(qb).multiply(qp).multiply(s0.q);
    }
    // ---- Körper: Arme und Beine im Körper bewegen, dann alles um das Becken drehen
    const piv = this.wPiv.copy(at(this.torso).p);
    const qr = this.we.set(c.rider.pitch, c.rider.yaw, c.rider.roll, 'YZX');
    const QR = new THREE.Quaternion().setFromEuler(qr);
    const place = (b: THREE.Object3D, p: THREE.Vector3, q: THREE.Quaternion) => {
      const v = this.wv.copy(p).sub(piv).applyQuaternion(QR).add(piv);
      b.position.set(v.x + c.rider.x, v.y + c.rider.y, v.z + c.rider.z);
      b.quaternion.copy(QR).multiply(q);
    };
    place(this.torso, at(this.torso).p, at(this.torso).q);
    place(this.head, at(this.head).p, at(this.head).q);
    // Arme: um die Schulter nach vorn/oben (abstützen), leicht nach außen
    for (let s = 0; s < 2; s++) {
      const sx = s === 0 ? -1 : 1;
      const up = at(this.uppers[s]);
      const fo = at(this.fores[s]);
      const sh = up.p;
      const rot = new THREE.Quaternion().setFromAxisAngle(XAXIS, 1.25 * c.brace)
        .premultiply(new THREE.Quaternion().setFromAxisAngle(ZAXIS, -sx * 0.35 * c.brace));
      place(this.uppers[s], sh, new THREE.Quaternion().copy(rot).multiply(up.q));
      const el = new THREE.Vector3().copy(fo.p).sub(sh).applyQuaternion(rot).add(sh);
      place(this.fores[s], el, new THREE.Quaternion().copy(rot).multiply(fo.q));
    }
    // Beine: um die Hüfte angezogen (Knie zur Brust), Unterschenkel und Schuh folgen
    for (let s = 0; s < 2; s++) {
      const th = at(this.thighs[s]);
      const sn = at(this.shins[s]);
      const so = at(this.shoes[s]);
      const hip = th.p;
      const rot = new THREE.Quaternion().setFromAxisAngle(XAXIS, (s === 0 ? 0.55 : 0.25) * c.tuck);
      place(this.thighs[s], hip, new THREE.Quaternion().copy(rot).multiply(th.q));
      place(this.shins[s], new THREE.Vector3().copy(sn.p).sub(hip).applyQuaternion(rot).add(hip), new THREE.Quaternion().copy(rot).multiply(sn.q));
      place(this.shoes[s], new THREE.Vector3().copy(so.p).sub(hip).applyQuaternion(rot).add(hip), new THREE.Quaternion().copy(rot).multiply(so.q));
    }
  }
}
