/**
 * Kleine 2D-Physik für „Akku leer!“ – nach dem Vorbild von Box2D (Erin Catto): Kreise und konvexe Polygone,
 * Kontakte mit Warmstart, Block-Löser für Zweipunkt-Kontakte (stabile Stapel), Positionskorrektur und Inseln,
 * die schlafen gehen. Ohne Speicherhunger im Takt: Kontakte werden wiederverwendet, keine Vektor-Objekte.
 *
 * Koordinaten: y zeigt nach oben, Einheiten etwa Meter, Winkel im Bogenmaß gegen den Uhrzeigersinn.
 */

export const LINEAR_SLOP = 0.005;
const POLY_RADIUS = 2 * LINEAR_SLOP;
const BAUMGARTE = 0.2;
const MAX_CORRECTION = 0.2;
/** Abprallen erst ab dieser Aufprallgeschwindigkeit (sonst zittern Stapel) */
const VELOCITY_THRESHOLD = 1;
const MAX_TRANSLATION = 2;
const MAX_ROTATION = 0.5 * Math.PI;
const SLEEP_LIN = 0.06;
const SLEEP_ANG = 0.08;
const TIME_TO_SLEEP = 0.45;
/** Aufprall-Meldung erst ab dieser Annäherungsgeschwindigkeit */
const IMPACT_SPEED = 1.2;

export interface BodyDef {
  x: number;
  y: number;
  angle?: number;
  /** Kreis mit diesem Radius */
  circle?: number;
  /** Rechteck: Breite, Höhe */
  box?: [number, number];
  /** konvexes Polygon, Ecken gegen den Uhrzeigersinn (wird auf den Schwerpunkt verschoben) */
  poly?: [number, number][];
  density?: number;
  friction?: number;
  restitution?: number;
  static?: boolean;
  linearDamping?: number;
  angularDamping?: number;
  /** gleiche Gruppe (≠ 0) kollidiert nicht miteinander */
  group?: number;
  /** schläft von Anfang an (Bauten stehen ruhig, bis etwas sie berührt) */
  asleep?: boolean;
  user?: unknown;
}

export class Body {
  readonly id: number;
  /** 0 Kreis, 1 Polygon */
  readonly kind: 0 | 1;
  /** Kreisradius bzw. Haut der Polygone */
  r: number;
  /** Ecken und Kantennormalen im Körper-Koordinatensystem */
  readonly lx: number[] = [];
  readonly ly: number[] = [];
  readonly lnx: number[] = [];
  readonly lny: number[] = [];
  /** dieselben in Weltkoordinaten (nach jedem Schritt aktualisiert) */
  readonly wx: number[] = [];
  readonly wy: number[] = [];
  readonly wnx: number[] = [];
  readonly wny: number[] = [];
  readonly n: number;

  x: number;
  y: number;
  a: number;
  c = 1;
  s = 0;
  vx = 0;
  vy = 0;
  w = 0;
  /** Stand vor dem letzten Schritt (zum Zwischenrechnen beim Zeichnen) */
  px: number;
  py: number;
  pa: number;

  m = 0;
  im = 0;
  I = 0;
  iI = 0;
  density: number;
  friction: number;
  restitution: number;
  ld: number;
  ad: number;
  group: number;
  /** Schwerkraft-Faktor */
  gs = 1;
  readonly isStatic: boolean;
  awake: boolean;
  sleepT = 0;
  removed = false;

  minX = 0;
  maxX = 0;
  minY = 0;
  maxY = 0;
  /** Index in der Körperliste (für die Inseln) */
  idx = 0;
  user: unknown;

  constructor(id: number, d: BodyDef) {
    this.id = id;
    this.x = d.x;
    this.y = d.y;
    this.a = d.angle ?? 0;
    this.px = this.x;
    this.py = this.y;
    this.pa = this.a;
    this.density = d.density ?? 1;
    this.friction = d.friction ?? 0.6;
    this.restitution = d.restitution ?? 0.1;
    this.ld = d.linearDamping ?? 0;
    this.ad = d.angularDamping ?? 0.05;
    this.group = d.group ?? 0;
    this.isStatic = !!d.static;
    this.awake = !this.isStatic && !d.asleep;
    this.user = d.user ?? null;
    if (d.circle !== undefined) {
      this.kind = 0;
      this.r = d.circle;
      this.n = 0;
    } else {
      this.kind = 1;
      this.r = POLY_RADIUS;
      let pts = d.poly;
      if (!pts) {
        const [w, h] = d.box ?? [1, 1];
        pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
      }
      this.n = pts.length;
      for (const [px, py] of pts) { this.lx.push(px); this.ly.push(py); this.wx.push(0); this.wy.push(0); }
      for (let i = 0; i < this.n; i++) {
        const j = (i + 1) % this.n;
        const ex = this.lx[j] - this.lx[i];
        const ey = this.ly[j] - this.ly[i];
        const len = Math.hypot(ex, ey) || 1;
        this.lnx.push(ey / len);
        this.lny.push(-ex / len);
        this.wnx.push(0);
        this.wny.push(0);
      }
    }
    this.setDensity(this.density);
    this.syncTransform();
  }

  /** Masse und Trägheit aus der Dichte (Polygone werden dabei auf ihren Schwerpunkt zentriert) */
  setDensity(density: number) {
    this.density = density;
    if (this.kind === 0) {
      this.m = density * Math.PI * this.r * this.r;
      this.I = 0.5 * this.m * this.r * this.r;
    } else {
      // Box2D: Fläche, Schwerpunkt und Trägheit über Dreiecke um einen Bezugspunkt
      let area = 0;
      let cx = 0;
      let cy = 0;
      let I = 0;
      const sx = this.lx[0];
      const sy = this.ly[0];
      for (let i = 0; i < this.n; i++) {
        const e1x = this.lx[i] - sx;
        const e1y = this.ly[i] - sy;
        const j = (i + 1) % this.n;
        const e2x = this.lx[j] - sx;
        const e2y = this.ly[j] - sy;
        const D = e1x * e2y - e1y * e2x;
        const tri = 0.5 * D;
        area += tri;
        cx += tri * (e1x + e2x) / 3;
        cy += tri * (e1y + e2y) / 3;
        const intx2 = e1x * e1x + e2x * e1x + e2x * e2x;
        const inty2 = e1y * e1y + e2y * e1y + e2y * e2y;
        I += (0.25 / 3) * D * (intx2 + inty2);
      }
      cx /= area;
      cy /= area;
      // auf den Schwerpunkt verschieben (Körperursprung = Schwerpunkt)
      const ox = cx + sx;
      const oy = cy + sy;
      if (Math.abs(ox) > 1e-9 || Math.abs(oy) > 1e-9) {
        for (let i = 0; i < this.n; i++) { this.lx[i] -= ox; this.ly[i] -= oy; }
        const c = Math.cos(this.a);
        const s = Math.sin(this.a);
        this.x += c * ox - s * oy;
        this.y += s * ox + c * oy;
        this.px = this.x;
        this.py = this.y;
      }
      this.m = density * area;
      // Trägheit um den Bezugspunkt → um den Schwerpunkt
      this.I = density * I - this.m * (cx * cx + cy * cy);
    }
    if (this.isStatic || this.m <= 0) {
      this.im = 0;
      this.iI = 0;
    } else {
      this.im = 1 / this.m;
      this.iI = this.I > 0 ? 1 / this.I : 0;
    }
  }

  /** Masse vervielfachen (z. B. Zeitfahrer im Sturzflug) */
  scaleMass(f: number) {
    this.setDensity(this.density * f);
  }

  syncTransform() {
    this.c = Math.cos(this.a);
    this.s = Math.sin(this.a);
    const c = this.c;
    const s = this.s;
    if (this.kind === 0) {
      this.minX = this.x - this.r;
      this.maxX = this.x + this.r;
      this.minY = this.y - this.r;
      this.maxY = this.y + this.r;
      return;
    }
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < this.n; i++) {
      const lx = this.lx[i];
      const ly = this.ly[i];
      const wx = this.x + c * lx - s * ly;
      const wy = this.y + s * lx + c * ly;
      this.wx[i] = wx;
      this.wy[i] = wy;
      this.wnx[i] = c * this.lnx[i] - s * this.lny[i];
      this.wny[i] = s * this.lnx[i] + c * this.lny[i];
      if (wx < x0) x0 = wx;
      if (wx > x1) x1 = wx;
      if (wy < y0) y0 = wy;
      if (wy > y1) y1 = wy;
    }
    const pad = POLY_RADIUS + 0.01;
    this.minX = x0 - pad;
    this.maxX = x1 + pad;
    this.minY = y0 - pad;
    this.maxY = y1 + pad;
  }

  /** Stoß im Weltpunkt (wx, wy) */
  applyImpulse(ix: number, iy: number, wx = this.x, wy = this.y) {
    if (this.isStatic) return;
    this.wake();
    this.vx += ix * this.im;
    this.vy += iy * this.im;
    this.w += this.iI * ((wx - this.x) * iy - (wy - this.y) * ix);
  }

  wake() {
    if (this.isStatic) return;
    this.awake = true;
    this.sleepT = 0;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }
}

/** Kontakt zweier Körper mit bis zu zwei Punkten (bleibt über Schritte erhalten – Warmstart) */
class Arbiter {
  a: Body;
  b: Body;
  key: number;
  /** 0 Kreise, 1 Kante von A, 2 Kante von B */
  type = 0;
  lnx = 0;
  lny = 0;
  lpx = 0;
  lpy = 0;
  count = 0;
  readonly plx = [0, 0];
  readonly ply = [0, 0];
  readonly pid = [0, 0];
  readonly ni = [0, 0];
  readonly ti = [0, 0];
  readonly rax = [0, 0];
  readonly ray = [0, 0];
  readonly rbx = [0, 0];
  readonly rby = [0, 0];
  readonly nm = [0, 0];
  readonly tm = [0, 0];
  readonly vb = [0, 0];
  nx = 0;
  ny = 0;
  friction = 0;
  restitution = 0;
  block = false;
  k11 = 0;
  k12 = 0;
  k22 = 0;
  i11 = 0;
  i12 = 0;
  i22 = 0;
  stamp = 0;
  /** schon gemeldet (Aufprall) in diesem Schritt */
  impact = 0;
  ix = 0;
  iy = 0;

  constructor(a: Body, b: Body, key: number) {
    this.a = a;
    this.b = b;
    this.key = key;
    this.friction = Math.sqrt(a.friction * b.friction);
    this.restitution = Math.max(a.restitution, b.restitution);
  }

  /** neue Kontaktpunkte übernehmen, alte Impulse über die Merkmal-Kennung weitergeben */
  update(m: Manifold) {
    let n0 = 0;
    let t0 = 0;
    let n1 = 0;
    let t1 = 0;
    for (let j = 0; j < this.count; j++) {
      if (m.count > 0 && this.pid[j] === m.id0) { n0 = this.ni[j]; t0 = this.ti[j]; }
      if (m.count > 1 && this.pid[j] === m.id1) { n1 = this.ni[j]; t1 = this.ti[j]; }
    }
    // anderer Kontakttyp: alte Impulse passen nicht
    if (m.type !== this.type) { n0 = 0; t0 = 0; n1 = 0; t1 = 0; }
    this.type = m.type;
    this.lnx = m.lnx;
    this.lny = m.lny;
    this.lpx = m.lpx;
    this.lpy = m.lpy;
    this.count = m.count;
    this.plx[0] = m.p0x; this.ply[0] = m.p0y; this.pid[0] = m.id0; this.ni[0] = n0; this.ti[0] = t0;
    this.plx[1] = m.p1x; this.ply[1] = m.p1y; this.pid[1] = m.id1; this.ni[1] = n1; this.ti[1] = t1;
  }
}

/** Ergebnis einer Kollisionsprüfung (wird wiederverwendet) */
class Manifold {
  type = 0;
  lnx = 0;
  lny = 0;
  lpx = 0;
  lpy = 0;
  count = 0;
  p0x = 0;
  p0y = 0;
  id0 = 0;
  p1x = 0;
  p1y = 0;
  id1 = 0;
}

// ------------------------------------------------------------------ Kollision

const FACE = 0;
const VERTEX = 1;
const cf = (ia: number, ib: number, ta: number, tb: number) => ia | (ib << 8) | (ta << 16) | (tb << 24);

/** Clip-Puffer (wiederverwendet) */
const clipIn = { x0: 0, y0: 0, id0: 0, x1: 0, y1: 0, id1: 0 };
const clip1 = { x0: 0, y0: 0, id0: 0, x1: 0, y1: 0, id1: 0, n: 0 };
const clip2 = { x0: 0, y0: 0, id0: 0, x1: 0, y1: 0, id1: 0, n: 0 };
type Clip = typeof clipIn;
type ClipOut = typeof clip1;

function idA(id: number) { return id & 0xff; }
function idB(id: number) { return (id >> 8) & 0xff; }
function tA(id: number) { return (id >> 16) & 0xff; }
function tB(id: number) { return (id >> 24) & 0xff; }

function clipSegment(out: ClipOut, vin: Clip, nx: number, ny: number, offset: number, vertexIndexA: number): number {
  let count = 0;
  const d0 = nx * vin.x0 + ny * vin.y0 - offset;
  const d1 = nx * vin.x1 + ny * vin.y1 - offset;
  if (d0 <= 0) { out.x0 = vin.x0; out.y0 = vin.y0; out.id0 = vin.id0; count++; }
  if (d1 <= 0) {
    if (count === 0) { out.x0 = vin.x1; out.y0 = vin.y1; out.id0 = vin.id1; } else { out.x1 = vin.x1; out.y1 = vin.y1; out.id1 = vin.id1; }
    count++;
  }
  if (d0 * d1 < 0) {
    const t = d0 / (d0 - d1);
    const x = vin.x0 + t * (vin.x1 - vin.x0);
    const y = vin.y0 + t * (vin.y1 - vin.y0);
    const id = cf(vertexIndexA, idB(vin.id0), VERTEX, FACE);
    if (count === 0) { out.x0 = x; out.y0 = y; out.id0 = id; } else { out.x1 = x; out.y1 = y; out.id1 = id; }
    count++;
  }
  out.n = count;
  return count;
}

/** größter Abstand entlang der Kantennormalen von p1 (Weltkoordinaten) */
function maxSeparation(p1: Body, p2: Body): { edge: number; sep: number } {
  let best = 0;
  let maxSep = -Infinity;
  for (let i = 0; i < p1.n; i++) {
    const nx = p1.wnx[i];
    const ny = p1.wny[i];
    const vx = p1.wx[i];
    const vy = p1.wy[i];
    let si = Infinity;
    for (let j = 0; j < p2.n; j++) {
      const d = nx * (p2.wx[j] - vx) + ny * (p2.wy[j] - vy);
      if (d < si) si = d;
    }
    if (si > maxSep) { maxSep = si; best = i; }
  }
  sepOut.edge = best;
  sepOut.sep = maxSep;
  return sepOut;
}
const sepOut = { edge: 0, sep: 0 };

function collidePolygons(A: Body, B: Body, m: Manifold) {
  m.count = 0;
  const total = A.r + B.r;
  const sa = maxSeparation(A, B);
  if (sa.sep > total) return;
  const edgeA = sa.edge;
  const sepA = sa.sep;
  const sb = maxSeparation(B, A);
  if (sb.sep > total) return;
  const edgeB = sb.edge;
  const sepB = sb.sep;

  let p1: Body;
  let p2: Body;
  let edge1: number;
  let flip: boolean;
  if (sepB > sepA + 0.1 * LINEAR_SLOP) {
    p1 = B; p2 = A; edge1 = edgeB; flip = true; m.type = 2;
  } else {
    p1 = A; p2 = B; edge1 = edgeA; flip = false; m.type = 1;
  }
  // Einfallskante von p2: Normale am stärksten gegen die Referenznormale
  const rnx = p1.wnx[edge1];
  const rny = p1.wny[edge1];
  let index = 0;
  let minDot = Infinity;
  for (let i = 0; i < p2.n; i++) {
    const d = rnx * p2.wnx[i] + rny * p2.wny[i];
    if (d < minDot) { minDot = d; index = i; }
  }
  const i1 = index;
  const i2 = i1 + 1 < p2.n ? i1 + 1 : 0;
  clipIn.x0 = p2.wx[i1]; clipIn.y0 = p2.wy[i1]; clipIn.id0 = cf(edge1, i1, FACE, VERTEX);
  clipIn.x1 = p2.wx[i2]; clipIn.y1 = p2.wy[i2]; clipIn.id1 = cf(edge1, i2, FACE, VERTEX);

  const iv1 = edge1;
  const iv2 = edge1 + 1 < p1.n ? edge1 + 1 : 0;
  const v11x = p1.wx[iv1];
  const v11y = p1.wy[iv1];
  const v12x = p1.wx[iv2];
  const v12y = p1.wy[iv2];
  let tx = v12x - v11x;
  let ty = v12y - v11y;
  const tl = Math.hypot(tx, ty) || 1;
  tx /= tl;
  ty /= tl;
  const nx = ty;
  const ny = -tx;
  const front = nx * v11x + ny * v11y;
  const side1 = -(tx * v11x + ty * v11y) + total;
  const side2 = tx * v12x + ty * v12y + total;

  if (clipSegment(clip1, clipIn, -tx, -ty, side1, iv1) < 2) return;
  if (clipSegment(clip2, clip1, tx, ty, side2, iv2) < 2) return;

  // lokale Normale und Kantenmitte im Bezugskörper
  const l1x = p1.lx[iv1];
  const l1y = p1.ly[iv1];
  const l2x = p1.lx[iv2];
  const l2y = p1.ly[iv2];
  m.lnx = p1.lnx[edge1];
  m.lny = p1.lny[edge1];
  m.lpx = 0.5 * (l1x + l2x);
  m.lpy = 0.5 * (l1y + l2y);

  let count = 0;
  for (let k = 0; k < 2; k++) {
    const x = k === 0 ? clip2.x0 : clip2.x1;
    const y = k === 0 ? clip2.y0 : clip2.y1;
    let id = k === 0 ? clip2.id0 : clip2.id1;
    const sep = nx * x + ny * y - front;
    if (sep <= total) {
      // Punkt im Koordinatensystem des Einfallskörpers
      const dx = x - p2.x;
      const dy = y - p2.y;
      const lx = p2.c * dx + p2.s * dy;
      const ly = -p2.s * dx + p2.c * dy;
      if (flip) id = cf(idB(id), idA(id), tB(id), tA(id));
      if (count === 0) { m.p0x = lx; m.p0y = ly; m.id0 = id; } else { m.p1x = lx; m.p1y = ly; m.id1 = id; }
      count++;
    }
  }
  m.count = count;
}

function collidePolyCircle(A: Body, B: Body, m: Manifold) {
  m.count = 0;
  // Kreismitte im System des Polygons
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const cx = A.c * dx + A.s * dy;
  const cy = -A.s * dx + A.c * dy;
  const radius = A.r + B.r;
  let normalIndex = 0;
  let separation = -Infinity;
  for (let i = 0; i < A.n; i++) {
    const s = A.lnx[i] * (cx - A.lx[i]) + A.lny[i] * (cy - A.ly[i]);
    if (s > radius) return;
    if (s > separation) { separation = s; normalIndex = i; }
  }
  const v1 = normalIndex;
  const v2 = v1 + 1 < A.n ? v1 + 1 : 0;
  const v1x = A.lx[v1];
  const v1y = A.ly[v1];
  const v2x = A.lx[v2];
  const v2y = A.ly[v2];
  m.type = 1;
  m.p0x = 0;
  m.p0y = 0;
  m.id0 = 0;
  if (separation < 1e-9) {
    m.count = 1;
    m.lnx = A.lnx[normalIndex];
    m.lny = A.lny[normalIndex];
    m.lpx = 0.5 * (v1x + v2x);
    m.lpy = 0.5 * (v1y + v2y);
    return;
  }
  const u1 = (cx - v1x) * (v2x - v1x) + (cy - v1y) * (v2y - v1y);
  const u2 = (cx - v2x) * (v1x - v2x) + (cy - v2y) * (v1y - v2y);
  if (u1 <= 0) {
    const ex = cx - v1x;
    const ey = cy - v1y;
    const d2 = ex * ex + ey * ey;
    if (d2 > radius * radius) return;
    const d = Math.sqrt(d2) || 1;
    m.count = 1;
    m.lnx = ex / d;
    m.lny = ey / d;
    m.lpx = v1x;
    m.lpy = v1y;
  } else if (u2 <= 0) {
    const ex = cx - v2x;
    const ey = cy - v2y;
    const d2 = ex * ex + ey * ey;
    if (d2 > radius * radius) return;
    const d = Math.sqrt(d2) || 1;
    m.count = 1;
    m.lnx = ex / d;
    m.lny = ey / d;
    m.lpx = v2x;
    m.lpy = v2y;
  } else {
    const fx = 0.5 * (v1x + v2x);
    const fy = 0.5 * (v1y + v2y);
    const s = (cx - fx) * A.lnx[v1] + (cy - fy) * A.lny[v1];
    if (s > radius) return;
    m.count = 1;
    m.lnx = A.lnx[v1];
    m.lny = A.lny[v1];
    m.lpx = fx;
    m.lpy = fy;
  }
}

function collideCircles(A: Body, B: Body, m: Manifold) {
  m.count = 0;
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const r = A.r + B.r;
  if (dx * dx + dy * dy > r * r) return;
  m.type = 0;
  m.count = 1;
  m.lpx = 0;
  m.lpy = 0;
  m.lnx = 0;
  m.lny = 0;
  m.p0x = 0;
  m.p0y = 0;
  m.id0 = 0;
}

function collide(A: Body, B: Body, m: Manifold) {
  if (A.kind === 1) {
    if (B.kind === 1) collidePolygons(A, B, m);
    else collidePolyCircle(A, B, m);
  } else collideCircles(A, B, m);
}

// ------------------------------------------------------------------ Welt

export type ImpactFn = (a: Body, b: Body, impulse: number, x: number, y: number, nx: number, ny: number) => void;

export class World {
  gx = 0;
  gy = -10;
  readonly bodies: Body[] = [];
  velocityIterations = 8;
  positionIterations = 3;
  blockSolve = true;
  /** Aufprall (für Schaden, Staub, Geräusche) – während des Schritts, also nur merken, nichts entfernen */
  onImpact: ImpactFn | null = null;

  private readonly arbiters = new Map<number, Arbiter>();
  private readonly active: Arbiter[] = [];
  private readonly sorted: Body[] = [];
  private readonly man = new Manifold();
  private nextId = 1;
  private stamp = 0;
  private parent: number[] = [];
  private islandAwake: number[] = [];
  private islandSleep: number[] = [];

  add(def: BodyDef): Body {
    const b = new Body(this.nextId++, def);
    b.idx = this.bodies.length;
    this.bodies.push(b);
    this.sorted.push(b);
    return b;
  }

  /** Körper entfernen – was auf ihm lag, wacht auf (sonst schwebt es) */
  remove(b: Body) {
    if (b.removed) return;
    b.removed = true;
    for (const [key, arb] of this.arbiters) {
      if (arb.a === b || arb.b === b) {
        (arb.a === b ? arb.b : arb.a).wake();
        this.arbiters.delete(key);
      }
    }
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
    const j = this.sorted.indexOf(b);
    if (j >= 0) this.sorted.splice(j, 1);
    for (let k = 0; k < this.bodies.length; k++) this.bodies[k].idx = k;
  }

  /** alle Körper weckt auf, die b berühren */
  wakeTouching(b: Body) {
    for (const arb of this.arbiters.values()) {
      if (arb.count === 0) continue;
      if (arb.a === b) arb.b.wake();
      else if (arb.b === b) arb.a.wake();
    }
  }

  /** Körper, die b gerade berühren */
  touching(b: Body, out: Body[] = []): Body[] {
    for (const arb of this.arbiters.values()) {
      if (arb.count === 0) continue;
      if (arb.a === b) out.push(arb.b);
      else if (arb.b === b) out.push(arb.a);
    }
    return out;
  }

  /** Körper, deren Hülle den Kreis berührt */
  queryCircle(x: number, y: number, r: number, out: Body[] = []): Body[] {
    for (const b of this.bodies) {
      if (b.maxX < x - r || b.minX > x + r || b.maxY < y - r || b.minY > y + r) continue;
      out.push(b);
    }
    return out;
  }

  get awakeCount(): number {
    let n = 0;
    for (const b of this.bodies) if (b.awake && !b.isStatic) n++;
    return n;
  }

  step(dt: number) {
    this.stamp++;
    const bodies = this.bodies;
    for (const b of bodies) { b.px = b.x; b.py = b.y; b.pa = b.a; }
    this.collide();
    this.islands();
    this.solve(dt);
    this.sleep(dt);
  }

  // ---------------------------------------------------------------- Breite und enge Phase

  private collide() {
    const list = this.sorted;
    // fast sortiert: Einfügesortierung nach linker Kante
    for (let i = 1; i < list.length; i++) {
      const b = list[i];
      let j = i - 1;
      while (j >= 0 && list[j].minX > b.minX) { list[j + 1] = list[j]; j--; }
      list[j + 1] = b;
    }
    const man = this.man;
    const stamp = this.stamp;
    for (let i = 0; i < list.length; i++) {
      const A = list[i];
      const aAct = !A.isStatic && A.awake;
      for (let j = i + 1; j < list.length; j++) {
        const B = list[j];
        if (B.minX > A.maxX) break;
        if (B.minY > A.maxY || B.maxY < A.minY) continue;
        const bAct = !B.isStatic && B.awake;
        if (!aAct && !bAct) continue;
        if (A.group !== 0 && A.group === B.group) continue;
        let a = A;
        let b = B;
        if ((a.kind === 0 && b.kind === 1) || (a.kind === b.kind && a.id > b.id)) { a = B; b = A; }
        const key = a.id < b.id ? a.id * 65536 + b.id : b.id * 65536 + a.id;
        collide(a, b, man);
        let arb = this.arbiters.get(key);
        if (man.count === 0) {
          if (arb) this.arbiters.delete(key);
          continue;
        }
        if (!arb) {
          arb = new Arbiter(a, b, key);
          this.arbiters.set(key, arb);
        }
        arb.update(man);
        arb.stamp = stamp;
        // schlafender Nachbar wacht auf
        if (!aAct && !A.isStatic) A.wake();
        if (!bAct && !B.isStatic) B.wake();
      }
    }
    // Kontakte, die nicht mehr bestehen (zwischen schlafenden Körpern bleiben sie)
    for (const [key, arb] of this.arbiters) {
      if (arb.stamp === stamp) continue;
      const act = (!arb.a.isStatic && arb.a.awake) || (!arb.b.isStatic && arb.b.awake);
      if (act) this.arbiters.delete(key);
    }
  }

  private find(i: number): number {
    const p = this.parent;
    while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; }
    return i;
  }

  /** Inseln aus sich berührenden Körpern: wacht einer, wachen alle */
  private islands() {
    const bodies = this.bodies;
    const n = bodies.length;
    const p = this.parent;
    p.length = n;
    for (let i = 0; i < n; i++) p[i] = i;
    for (const arb of this.arbiters.values()) {
      if (arb.count === 0 || arb.a.isStatic || arb.b.isStatic || arb.a.removed || arb.b.removed) continue;
      const ra = this.find(arb.a.idx);
      const rb = this.find(arb.b.idx);
      if (ra !== rb) p[ra] = rb;
    }
    const aw = this.islandAwake;
    aw.length = n;
    for (let i = 0; i < n; i++) aw[i] = 0;
    for (let i = 0; i < n; i++) if (bodies[i].awake && !bodies[i].isStatic) aw[this.find(i)] = 1;
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (!b.isStatic && !b.awake && aw[this.find(i)]) { b.awake = true; b.sleepT = 0; }
    }
  }

  private sleep(dt: number) {
    const bodies = this.bodies;
    const n = bodies.length;
    const ms = this.islandSleep;
    ms.length = n;
    for (let i = 0; i < n; i++) ms[i] = Infinity;
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (b.isStatic || !b.awake) continue;
      if (b.vx * b.vx + b.vy * b.vy > SLEEP_LIN * SLEEP_LIN || b.w * b.w > SLEEP_ANG * SLEEP_ANG) b.sleepT = 0;
      else b.sleepT += dt;
      const r = this.find(i);
      if (b.sleepT < ms[r]) ms[r] = b.sleepT;
    }
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (b.isStatic || !b.awake) continue;
      if (ms[this.find(i)] >= TIME_TO_SLEEP) {
        b.awake = false;
        b.vx = 0;
        b.vy = 0;
        b.w = 0;
      }
    }
  }

  // ---------------------------------------------------------------- Löser

  private solve(dt: number) {
    const bodies = this.bodies;
    for (const b of bodies) {
      if (b.isStatic || !b.awake) continue;
      b.vx += dt * this.gx * b.gs;
      b.vy += dt * this.gy * b.gs;
      if (b.ld > 0) { const f = 1 / (1 + dt * b.ld); b.vx *= f; b.vy *= f; }
      if (b.ad > 0) b.w *= 1 / (1 + dt * b.ad);
    }
    const active = this.active;
    active.length = 0;
    for (const arb of this.arbiters.values()) {
      if (arb.count === 0) continue;
      const a = arb.a;
      const b = arb.b;
      if ((a.isStatic || !a.awake) && (b.isStatic || !b.awake)) continue;
      active.push(arb);
    }
    for (const arb of active) this.prestep(arb);
    for (const arb of active) this.warmStart(arb);
    for (let it = 0; it < this.velocityIterations; it++) for (const arb of active) this.solveVelocity(arb);
    for (const b of bodies) {
      if (b.isStatic || !b.awake) continue;
      let vx = b.vx;
      let vy = b.vy;
      const tx = dt * vx;
      const ty = dt * vy;
      const t2 = tx * tx + ty * ty;
      if (t2 > MAX_TRANSLATION * MAX_TRANSLATION) {
        const f = MAX_TRANSLATION / Math.sqrt(t2);
        vx *= f;
        vy *= f;
        b.vx = vx;
        b.vy = vy;
      }
      const rot = dt * b.w;
      if (rot * rot > MAX_ROTATION * MAX_ROTATION) b.w *= MAX_ROTATION / Math.abs(rot);
      b.x += dt * b.vx;
      b.y += dt * b.vy;
      b.a += dt * b.w;
      b.c = Math.cos(b.a);
      b.s = Math.sin(b.a);
    }
    for (let it = 0; it < this.positionIterations; it++) {
      let minSep = 0;
      for (const arb of active) minSep = Math.min(minSep, this.solvePosition(arb));
      if (minSep >= -3 * LINEAR_SLOP) break;
    }
    for (const b of bodies) if (!b.isStatic && b.awake) b.syncTransform();
  }

  private prestep(arb: Arbiter) {
    const a = arb.a;
    const b = arb.b;
    let nx: number;
    let ny: number;
    // Weltpunkte der Kontakte
    let q0x = 0;
    let q0y = 0;
    let q1x = 0;
    let q1y = 0;
    if (arb.type === 0) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-9) { nx = dx / d; ny = dy / d; } else { nx = 1; ny = 0; }
      const cAx = a.x + a.r * nx;
      const cAy = a.y + a.r * ny;
      const cBx = b.x - b.r * nx;
      const cBy = b.y - b.r * ny;
      q0x = 0.5 * (cAx + cBx);
      q0y = 0.5 * (cAy + cBy);
    } else {
      const ref = arb.type === 1 ? a : b;
      const inc = arb.type === 1 ? b : a;
      nx = ref.c * arb.lnx - ref.s * arb.lny;
      ny = ref.s * arb.lnx + ref.c * arb.lny;
      const ppx = ref.x + ref.c * arb.lpx - ref.s * arb.lpy;
      const ppy = ref.y + ref.s * arb.lpx + ref.c * arb.lpy;
      const rr = ref.r;
      const ri = inc.r;
      for (let i = 0; i < arb.count; i++) {
        const cx = inc.x + inc.c * arb.plx[i] - inc.s * arb.ply[i];
        const cy = inc.y + inc.s * arb.plx[i] + inc.c * arb.ply[i];
        const k = rr - ((cx - ppx) * nx + (cy - ppy) * ny);
        const crx = cx + k * nx;
        const cry = cy + k * ny;
        const cix = cx - ri * nx;
        const ciy = cy - ri * ny;
        const mx = 0.5 * (crx + cix);
        const my = 0.5 * (cry + ciy);
        if (i === 0) { q0x = mx; q0y = my; } else { q1x = mx; q1y = my; }
      }
      if (arb.type === 2) { nx = -nx; ny = -ny; }
    }
    arb.nx = nx;
    arb.ny = ny;
    const tx = ny;
    const ty = -nx;
    const mA = a.im;
    const mB = b.im;
    const iA = a.iI;
    const iB = b.iI;
    let impact = 0;
    let ix = 0;
    let iy = 0;
    for (let i = 0; i < arb.count; i++) {
      const qx = i === 0 ? q0x : q1x;
      const qy = i === 0 ? q0y : q1y;
      const rax = qx - a.x;
      const ray = qy - a.y;
      const rbx = qx - b.x;
      const rby = qy - b.y;
      arb.rax[i] = rax;
      arb.ray[i] = ray;
      arb.rbx[i] = rbx;
      arb.rby[i] = rby;
      const rnA = rax * ny - ray * nx;
      const rnB = rbx * ny - rby * nx;
      const kN = mA + mB + iA * rnA * rnA + iB * rnB * rnB;
      arb.nm[i] = kN > 0 ? 1 / kN : 0;
      const rtA = rax * ty - ray * tx;
      const rtB = rbx * ty - rby * tx;
      const kT = mA + mB + iA * rtA * rtA + iB * rtB * rtB;
      arb.tm[i] = kT > 0 ? 1 / kT : 0;
      const dvx = b.vx - b.w * rby - a.vx + a.w * ray;
      const dvy = b.vy + b.w * rbx - a.vy - a.w * rax;
      const vRel = dvx * nx + dvy * ny;
      arb.vb[i] = vRel < -VELOCITY_THRESHOLD ? -arb.restitution * vRel : 0;
      if (-vRel > IMPACT_SPEED) {
        const imp = arb.nm[i] * -vRel;
        if (imp > impact) { impact = imp; ix = qx; iy = qy; }
      }
    }
    arb.block = false;
    if (arb.count === 2) {
      const rn1A = arb.rax[0] * ny - arb.ray[0] * nx;
      const rn1B = arb.rbx[0] * ny - arb.rby[0] * nx;
      const rn2A = arb.rax[1] * ny - arb.ray[1] * nx;
      const rn2B = arb.rbx[1] * ny - arb.rby[1] * nx;
      const k11 = mA + mB + iA * rn1A * rn1A + iB * rn1B * rn1B;
      const k22 = mA + mB + iA * rn2A * rn2A + iB * rn2B * rn2B;
      const k12 = mA + mB + iA * rn1A * rn2A + iB * rn1B * rn2B;
      const det = k11 * k22 - k12 * k12;
      if (this.blockSolve && k11 * k11 < 1000 * det) {
        arb.block = true;
        arb.k11 = k11;
        arb.k12 = k12;
        arb.k22 = k22;
        const id = 1 / det;
        arb.i11 = k22 * id;
        arb.i12 = -k12 * id;
        arb.i22 = k11 * id;
      }
    }
    if (impact > 0 && this.onImpact) this.onImpact(a, b, impact, ix, iy, nx, ny);
  }

  /** Impulse des letzten Schritts vorab anwenden – erst nachdem alle Kontakte vorbereitet sind */
  private warmStart(arb: Arbiter) {
    const a = arb.a;
    const b = arb.b;
    const nx = arb.nx;
    const ny = arb.ny;
    const tx = ny;
    const ty = -nx;
    for (let i = 0; i < arb.count; i++) {
      const Px = arb.ni[i] * nx + arb.ti[i] * tx;
      const Py = arb.ni[i] * ny + arb.ti[i] * ty;
      a.w -= a.iI * (arb.rax[i] * Py - arb.ray[i] * Px);
      a.vx -= a.im * Px;
      a.vy -= a.im * Py;
      b.w += b.iI * (arb.rbx[i] * Py - arb.rby[i] * Px);
      b.vx += b.im * Px;
      b.vy += b.im * Py;
    }
  }

  private solveVelocity(arb: Arbiter) {
    const a = arb.a;
    const b = arb.b;
    const mA = a.im;
    const mB = b.im;
    const iA = a.iI;
    const iB = b.iI;
    const nx = arb.nx;
    const ny = arb.ny;
    const tx = ny;
    const ty = -nx;
    const friction = arb.friction;
    // Reibung zuerst (Nicht-Durchdringen ist wichtiger)
    for (let i = 0; i < arb.count; i++) {
      const rax = arb.rax[i];
      const ray = arb.ray[i];
      const rbx = arb.rbx[i];
      const rby = arb.rby[i];
      const dvx = b.vx - b.w * rby - a.vx + a.w * ray;
      const dvy = b.vy + b.w * rbx - a.vy - a.w * rax;
      const vt = dvx * tx + dvy * ty;
      let lambda = arb.tm[i] * -vt;
      const maxF = friction * arb.ni[i];
      const old = arb.ti[i];
      let ni = old + lambda;
      if (ni < -maxF) ni = -maxF;
      else if (ni > maxF) ni = maxF;
      arb.ti[i] = ni;
      lambda = ni - old;
      const Px = lambda * tx;
      const Py = lambda * ty;
      a.vx -= mA * Px;
      a.vy -= mA * Py;
      a.w -= iA * (rax * Py - ray * Px);
      b.vx += mB * Px;
      b.vy += mB * Py;
      b.w += iB * (rbx * Py - rby * Px);
    }
    if (!arb.block) {
      for (let i = 0; i < arb.count; i++) {
        const rax = arb.rax[i];
        const ray = arb.ray[i];
        const rbx = arb.rbx[i];
        const rby = arb.rby[i];
        const dvx = b.vx - b.w * rby - a.vx + a.w * ray;
        const dvy = b.vy + b.w * rbx - a.vy - a.w * rax;
        const vn = dvx * nx + dvy * ny;
        let lambda = -arb.nm[i] * (vn - arb.vb[i]);
        const old = arb.ni[i];
        const nn = Math.max(old + lambda, 0);
        arb.ni[i] = nn;
        lambda = nn - old;
        const Px = lambda * nx;
        const Py = lambda * ny;
        a.vx -= mA * Px;
        a.vy -= mA * Py;
        a.w -= iA * (rax * Py - ray * Px);
        b.vx += mB * Px;
        b.vy += mB * Py;
        b.w += iB * (rbx * Py - rby * Px);
      }
      return;
    }
    // Block-Löser für zwei Punkte (Box2D, „total enumeration“)
    const r1ax = arb.rax[0];
    const r1ay = arb.ray[0];
    const r1bx = arb.rbx[0];
    const r1by = arb.rby[0];
    const r2ax = arb.rax[1];
    const r2ay = arb.ray[1];
    const r2bx = arb.rbx[1];
    const r2by = arb.rby[1];
    const ax = arb.ni[0];
    const ay = arb.ni[1];
    const dv1x = b.vx - b.w * r1by - a.vx + a.w * r1ay;
    const dv1y = b.vy + b.w * r1bx - a.vy - a.w * r1ax;
    const dv2x = b.vx - b.w * r2by - a.vx + a.w * r2ay;
    const dv2y = b.vy + b.w * r2bx - a.vy - a.w * r2ax;
    let vn1 = dv1x * nx + dv1y * ny;
    let vn2 = dv2x * nx + dv2y * ny;
    let bx = vn1 - arb.vb[0];
    let by = vn2 - arb.vb[1];
    bx -= arb.k11 * ax + arb.k12 * ay;
    by -= arb.k12 * ax + arb.k22 * ay;
    let xx: number;
    let xy: number;
    const apply = () => {
      const d1 = xx - ax;
      const d2 = xy - ay;
      const P1x = d1 * nx;
      const P1y = d1 * ny;
      const P2x = d2 * nx;
      const P2y = d2 * ny;
      a.vx -= mA * (P1x + P2x);
      a.vy -= mA * (P1y + P2y);
      a.w -= iA * (r1ax * P1y - r1ay * P1x + r2ax * P2y - r2ay * P2x);
      b.vx += mB * (P1x + P2x);
      b.vy += mB * (P1y + P2y);
      b.w += iB * (r1bx * P1y - r1by * P1x + r2bx * P2y - r2by * P2x);
      arb.ni[0] = xx;
      arb.ni[1] = xy;
    };
    // Fall 1: beide Punkte aktiv
    xx = -(arb.i11 * bx + arb.i12 * by);
    xy = -(arb.i12 * bx + arb.i22 * by);
    if (xx >= 0 && xy >= 0) { apply(); return; }
    // Fall 2: nur Punkt 1
    xx = -arb.nm[0] * bx;
    xy = 0;
    vn2 = arb.k12 * xx + by;
    if (xx >= 0 && vn2 >= 0) { apply(); return; }
    // Fall 3: nur Punkt 2
    xx = 0;
    xy = -arb.nm[1] * by;
    vn1 = arb.k12 * xy + bx;
    if (xy >= 0 && vn1 >= 0) { apply(); return; }
    // Fall 4: keiner
    xx = 0;
    xy = 0;
    vn1 = bx;
    vn2 = by;
    if (vn1 >= 0 && vn2 >= 0) apply();
  }

  /** Durchdringung abbauen (direkt an den Lagen), liefert den kleinsten Abstand */
  private solvePosition(arb: Arbiter): number {
    const a = arb.a;
    const b = arb.b;
    const mA = a.im;
    const mB = b.im;
    const iA = a.iI;
    const iB = b.iI;
    let minSep = 0;
    for (let i = 0; i < arb.count; i++) {
      let nx: number;
      let ny: number;
      let px: number;
      let py: number;
      let sep: number;
      if (arb.type === 0) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > 1e-9) { nx = dx / d; ny = dy / d; } else { nx = 1; ny = 0; }
        px = 0.5 * (a.x + b.x);
        py = 0.5 * (a.y + b.y);
        sep = dx * nx + dy * ny - a.r - b.r;
      } else {
        const ref = arb.type === 1 ? a : b;
        const inc = arb.type === 1 ? b : a;
        nx = ref.c * arb.lnx - ref.s * arb.lny;
        ny = ref.s * arb.lnx + ref.c * arb.lny;
        const ppx = ref.x + ref.c * arb.lpx - ref.s * arb.lpy;
        const ppy = ref.y + ref.s * arb.lpx + ref.c * arb.lpy;
        px = inc.x + inc.c * arb.plx[i] - inc.s * arb.ply[i];
        py = inc.y + inc.s * arb.plx[i] + inc.c * arb.ply[i];
        sep = (px - ppx) * nx + (py - ppy) * ny - a.r - b.r;
        if (arb.type === 2) { nx = -nx; ny = -ny; }
      }
      const rax = px - a.x;
      const ray = py - a.y;
      const rbx = px - b.x;
      const rby = py - b.y;
      if (sep < minSep) minSep = sep;
      const C = Math.max(-MAX_CORRECTION, Math.min(0, BAUMGARTE * (sep + LINEAR_SLOP)));
      const rnA = rax * ny - ray * nx;
      const rnB = rbx * ny - rby * nx;
      const K = mA + mB + iA * rnA * rnA + iB * rnB * rnB;
      const imp = K > 0 ? -C / K : 0;
      const Px = imp * nx;
      const Py = imp * ny;
      if (mA > 0 || iA > 0) {
        a.x -= mA * Px;
        a.y -= mA * Py;
        a.a -= iA * (rax * Py - ray * Px);
        a.c = Math.cos(a.a);
        a.s = Math.sin(a.a);
      }
      if (mB > 0 || iB > 0) {
        b.x += mB * Px;
        b.y += mB * Py;
        b.a += iB * (rbx * Py - rby * Px);
        b.c = Math.cos(b.a);
        b.s = Math.sin(b.a);
      }
    }
    return minSep;
  }
}
