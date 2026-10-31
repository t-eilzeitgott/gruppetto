/**
 * Teamwagen (Darstellung): ein Kombi in den Teamfarben, wie man ihn aus jeder Rundfahrt kennt – gewölbte Karosserie
 * aus Querschnitten, getönte Scheiben mit Spiegelungen, Dach und Säulen, Radläufe, Felgen mit Doppelspeichen und
 * Bremsscheiben, Scheinwerfer, Rückleuchten, Kühlergrill, Spiegel, Türgriffe, Antenne, Dachträger mit drei
 * Teamrädern (dieselben Räder wie unter den Fahrern) und Teamaufschrift. Am Steuer der Sportliche Leiter: das
 * Fenster ist offen, er reicht die Flasche mit der linken Hand hinaus und schaut zu dir.
 *
 * Drei Detailstufen mit gerastertem Übergang (appear.ts, kein Aufploppen): nah alles (ab etwa 30 m ohne Fahrer und
 * offenes Fenster, einfachere Räder auf dem Dach), in der Ferne ein schlichter Körper.
 *
 * Wagen-Koordinaten: x rechts, y hoch, vorwärts −z (wie die Fahrer). f im Bau = vorwärts (+), also z = −f.
 */
import * as THREE from 'three';
import { apIn, apOut, appearifyTree, setAp } from './appear';
import { bikeBuild } from './bike3d';
import { CHROME, MATTE, Mesher, PAINT, SATIN, glossFarMat, glossMat, merge, rgb, type C3 } from './gloss';
import { Human, lookFor } from './human3d';
import { GB, lin } from './models3d';
import type { Kit } from './rider';
import { mulberry32 } from './rng';
import { HAND_DX, HAND_DZ, type TeamCar } from './teamcar';
import { bike as simpleBike } from './ttstart3d';

// ------------------------------------------------------------------ Form (Seitenriss, Grundriss)

const NOSE = 2.37;
const TAIL = -2.49;
const AXF = 1.42;
const AXR = -1.42;
const WR = 0.34;
const ARCH = 0.43;
const BELT = 0.93;
const WS = 1.12;      // Fuß der Frontscheibe
const ROOF_F = 0.12;  // obere Kante der Frontscheibe
const ROOF_R = -2.24; // obere Kante der Heckscheibe
const RW = -2.47;     // Fuß der Heckscheibe
const TRACK = 0.8;    // halbe Spurweite (Radmitte)

const sat = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Unterkante: Schweller, über den Rädern der Radlauf, vorn und hinten die Schürzen */
function bottomY(f: number): number {
  let y = f > 1.95 ? 0.27 + (f - 1.95) * 0.3 : f < -2.15 ? 0.3 + (-2.15 - f) * 0.45 : 0.3;
  for (const ax of [AXF, AXR]) {
    const d = Math.abs(f - ax);
    if (d < ARCH) y = Math.max(y, 0.34 + Math.sqrt(ARCH * ARCH - d * d) * 0.98);
  }
  return y;
}

/** Oberkante des Unterbaus: vorn die Motorhaube (fällt zur Nase), hinten die Heckklappe */
function topY(f: number): number {
  if (f > WS) { const t = (f - WS) / (NOSE - WS); return BELT - 0.05 * t - 0.14 * t * t * t; }
  if (f < -2.3) return BELT - (-2.3 - f) * 0.5;
  return BELT + (WS - f) * 0.004;
}

/** halbe Breite im Grundriss (vorn und hinten abgerundet) */
function halfW(f: number): number {
  const a = f > 1.8 ? Math.sqrt(sat(1 - ((f - 1.8) / (NOSE - 1.8 + 0.08)) ** 2)) : 1;
  const b = f < -2.0 ? Math.sqrt(sat(1 - ((-2.0 - f) / (-2.0 - TAIL + 0.06)) ** 2)) : 1;
  return 0.93 * (0.8 + 0.2 * Math.min(a, b));
}

/** Dachlinie: Frontscheibe, Dach, Heckscheibe */
function roofY(f: number): number {
  if (f >= WS) return BELT;
  if (f >= ROOF_F) { const t = (WS - f) / (WS - ROOF_F); return BELT + 0.57 * Math.pow(t, 0.75); }
  if (f >= ROOF_R) return 1.5 + 0.012 * Math.sin(((f - ROOF_R) / (ROOF_F - ROOF_R)) * Math.PI);
  if (f >= RW) { const t = (f - RW) / (ROOF_R - RW); return BELT + 0.06 + 0.51 * Math.pow(t, 0.5); }
  return BELT;
}

/** Querschnitt des Unterbaus (rechte Hälfte, von unten Mitte nach oben Mitte) */
function lowerHalf(f: number): [number, number][] {
  const w = halfW(f), yb = bottomY(f), yt = topY(f);
  const h = yt - yb;
  return [
    [0, yb], [w - 0.12, yb], [w - 0.035, yb + 0.025], [w - 0.005, yb + Math.min(0.1, h * 0.25)],
    [w + 0.008, yb + h * 0.48], [w - 0.004, yt - Math.min(0.08, h * 0.2)], [w - 0.045, yt - 0.012], [w - 0.16, yt + 0.006], [0, yt + 0.022],
  ];
}

/** Querschnitt der Kabine (rechte Hälfte): Gürtellinie bis Dach, nach oben eingezogen */
function cabinHalf(f: number): [number, number][] {
  const wb = (halfW(f) - 0.07) * (1 - 0.05 * sat((-1.9 - f) / 0.55));
  const yr = roofY(f);
  const h = Math.max(0.001, yr - BELT);
  const wt = wb - 0.15 * Math.min(1, h / 0.5);
  return [[wb, BELT - 0.01], [wb - 0.07 * Math.min(1, h / 0.5), BELT + h * 0.55], [wt + 0.045, yr - Math.min(0.045, h * 0.2)], [wt - 0.05, yr], [0, yr + 0.012]];
}

/** feiner Querschnitt: jede Kante n-fach (geradlinig) geteilt */
function refine(pts: [number, number][], n: number): [number, number][] {
  if (n <= 1) return pts;
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** ganzer Ring (rechts hinauf, links hinunter) aus der rechten Hälfte; Punkte auf der Mitte (x = 0) nur einmal */
function ring(half: [number, number][]): [number, number][] {
  const from = half[0][0] === 0 ? 1 : 0;
  const left = half.slice(from, -1).reverse().map(([x, y]) => [-x, y] as [number, number]);
  return [...half, ...left];
}

/**
 * Hülle aus Ringen entlang f (Ringe gleicher Länge, geschlossen); vorn und hinten zu. Der Drehsinn wird an der
 * ersten Fläche geprüft (Normale nach außen). skip: Viereck (Station k, Ringpunkt j) weglassen (offenes Fenster).
 */
function loft(m: Mesher, fs: number[], rings: [number, number][][], col: (f: number, x: number, y: number) => C3, gl: (f: number, x: number, y: number) => number, caps: boolean, skip?: (k: number, j: number) => boolean) {
  const n = rings[0].length;
  const idx: number[][] = [];
  for (let k = 0; k < fs.length; k++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      const [x, y] = rings[k][j];
      row.push(m.v(x, y, -fs[k], col(fs[k], x, y), gl(fs[k], x, y)));
    }
    idx.push(row);
  }
  // Drehsinn: an einer mittleren Station die Fläche am weitesten rechts – ihre Normale soll von der Mitte des
  // Rings weg zeigen (an den Enden sind die Ringe oft winzig, dort wäre die Prüfung unsicher)
  const P = (i: number) => [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]];
  const km = Math.floor((fs.length - 1) / 2);
  let jx = 0;
  for (let j = 0; j < n; j++) if (rings[km][j][0] > rings[km][jx][0]) jx = j;
  if (jx >= n - 1) jx = n - 2;
  const a = P(idx[km][jx]), b = P(idx[km][jx + 1]), c = P(idx[km + 1][jx + 1]);
  const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
  const flip = nx < 0;
  for (let k = 0; k < fs.length - 1; k++) {
    for (let j = 0; j < n; j++) {
      if (skip?.(k, j)) continue;
      const j1 = (j + 1) % n;
      const q = [idx[k][j], idx[k][j1], idx[k + 1][j1], idx[k + 1][j]];
      if (flip) m.quad(q[3], q[2], q[1], q[0]); else m.quad(q[0], q[1], q[2], q[3]);
    }
  }
  if (!caps) return;
  // Deckel: Fächer um die Mitte des Rings
  for (const [k, front] of [[fs.length - 1, true], [0, false]] as [number, boolean][]) {
    let cx = 0, cy = 0;
    for (const [x, y] of rings[k]) { cx += x; cy += y; }
    const c0 = m.v(cx / n, cy / n, -fs[k], col(fs[k], 0, cy / n), gl(fs[k], 0, cy / n));
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      // Ring: rechts hinauf, links hinunter – von vorn gesehen im Uhrzeigersinn, von hinten dagegen
      if (front) m.tri(c0, idx[k][j1], idx[k][j]); else m.tri(c0, idx[k][j], idx[k][j1]);
    }
  }
}

/** Stationen entlang f: dichter an Nase, Heck, Radläufen und Scheiben */
function stations(n: number, from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // an den Enden dichter (Kosinus-Verteilung)
    out.push(from + (to - from) * (0.5 - 0.5 * Math.cos(t * Math.PI)));
  }
  return out;
}

// ------------------------------------------------------------------ Teile

/** Rad: Reifen (gerundet), Felge mit Doppelspeichen, Nabe, Bremsscheibe, Bremssattel; Achse entlang x */
function wheelGeo(detail: number, caliper: C3): THREE.BufferGeometry {
  const tire = new Mesher(MATTE);
  const rim = new Mesher(CHROME);
  const disc = new Mesher(SATIN);
  const black = rgb('#16171a');
  const side = rgb('#26272b');
  const seg = detail > 1 ? 40 : detail > 0 ? 22 : 12;
  // Reifen: Querschnitt (Breite x, Radius r), um die Achse gedreht
  const prof: [number, number][] = [[-0.1, 0.25], [-0.112, 0.29], [-0.108, 0.322], [-0.085, 0.338], [0, 0.341], [0.085, 0.338], [0.108, 0.322], [0.112, 0.29], [0.1, 0.25]];
  const rows: number[][] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    rows.push(prof.map(([x, r], k) => tire.v(x, r * ca, r * sa, k === 0 || k === prof.length - 1 ? side : black)));
  }
  for (let i = 0; i < seg; i++) for (let k = 0; k < prof.length - 1; k++) tire.quad(rows[i][k], rows[i][k + 1], rows[i + 1][k + 1], rows[i + 1][k]);
  // Felge: Ring (Felgenhorn) außen, Speichen zur Nabe
  const silver = rgb('#c8ccd2');
  const dark = rgb('#4a4d53');
  const rimR0 = 0.245, rimR1 = 0.21;
  const ringPts = (r: number, x: number, c: C3) => { const out: number[] = []; for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; out.push(rim.v(x, r * Math.cos(a), r * Math.sin(a), c)); } return out; };
  const o0 = ringPts(rimR0, 0.105, silver), o1 = ringPts(rimR1, 0.1, silver), o2 = ringPts(rimR1, 0.04, dark);
  for (let i = 0; i < seg; i++) {
    rim.quad(o0[i], o1[i], o1[i + 1], o0[i + 1]);
    rim.quad(o1[i], o2[i], o2[i + 1], o1[i + 1]);
  }
  // Doppelspeichen (fünf Paare) als flache Keile
  const spokes = detail > 0 ? 5 : 0;
  for (let s = 0; s < spokes; s++) {
    for (const d of [-0.11, 0.11]) {
      const a = (s / spokes) * Math.PI * 2 + d;
      const m = new THREE.Matrix4().makeRotationX(a).multiply(new THREE.Matrix4().makeTranslation(0.085, 0.135, 0));
      rim.add(new THREE.BoxGeometry(0.03, 0.17, 0.028), m, silver);
    }
  }
  // Nabe mit Kappe
  rim.add(new THREE.CylinderGeometry(0.055, 0.06, 0.05, detail > 0 ? 16 : 8), new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(0.085, 0, 0), silver);
  rim.add(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 10), new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(0.112, 0, 0), dark);
  if (detail > 0) {
    // Bremsscheibe und Sattel hinter der Felge
    disc.add(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 28), new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(0.02, 0, 0), rgb('#7d8087'));
    disc.add(new THREE.BoxGeometry(0.05, 0.09, 0.12), new THREE.Matrix4().setPosition(0.04, 0.12, 0.06), caliper);
  }
  return merge([tire, rim, disc])!;
}

/** Teamaufschrift für die Flanken: Farbbogen, Schriftzug, Nummer, Türfugen (transparent, wird auf den Lack gelegt) */
function liveryTex(kit: Kit): THREE.CanvasTexture {
  const W = 1024, H = 192;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  c.clearRect(0, 0, W, H);
  // Bogen in der zweiten Teamfarbe von hinten unten nach vorn oben (u: 0 = hinten, 1 = vorn)
  c.fillStyle = kit.side;
  c.beginPath();
  c.moveTo(0, H * 0.95);
  c.bezierCurveTo(W * 0.35, H * 0.98, W * 0.55, H * 0.35, W, H * 0.2);
  c.lineTo(W, H * 0.42);
  c.bezierCurveTo(W * 0.6, H * 0.55, W * 0.4, H * 1.05, 0, H * 1.1);
  c.closePath();
  c.fill();
  // Schriftzug auf den Türen
  c.font = `900 ${Math.round(H * 0.36)}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineWidth = 6;
  c.strokeStyle = 'rgba(0,0,0,0.25)';
  c.strokeText('gruppetto', W * 0.5, H * 0.42);
  c.fillStyle = '#ffffff';
  c.fillText('gruppetto', W * 0.5, H * 0.42);
  c.font = `700 ${Math.round(H * 0.11)}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  c.fillText('PRO CYCLING TEAM', W * 0.5, H * 0.68);
  // Nummer im Kreis auf dem hinteren Kotflügel
  c.fillStyle = '#ffffff';
  c.beginPath(); c.arc(W * 0.13, H * 0.42, H * 0.17, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#141416';
  c.font = `900 ${Math.round(H * 0.2)}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  c.fillText('1', W * 0.13, H * 0.43);
  // Türfugen und Griffmulden (dunkle Linien)
  c.strokeStyle = 'rgba(10,10,12,0.55)';
  c.lineWidth = 2.5;
  for (const u of [0.735, 0.47, 0.235]) { c.beginPath(); c.moveTo(W * u, H * 0.02); c.lineTo(W * u - 6, H * 0.98); c.stroke(); }
  c.fillStyle = 'rgba(10,10,12,0.35)';
  for (const u of [0.69, 0.43]) c.fillRect(W * u - 18, H * 0.1, 36, 7);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export interface TeamCarDeps {
  /** Eckpunktfarben, flach (einfache Räder auf dem Dach der mittleren Stufe) */
  props: THREE.Material;
  shadowTex: THREE.Texture;
  /** Lichtpunkt: zeigt die angebotene Flasche (pulsiert) */
  glow: THREE.Texture;
}

/** Abstände der Detailstufen (m): nah → mittel, mittel → fern; Breite des Übergangs */
const LOD_D: [number, number] = [30, 80];
const LOD_W = 5;

export class TeamCar3D {
  readonly group = new THREE.Group();
  private lods: THREE.Group[] = [];
  private wheels: THREE.Object3D[][] = [];
  private driver: Human;
  private bottle: THREE.Group;
  private mark: THREE.Sprite;
  private time = 0;
  private dis: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private readonly kitKey: string;
  private tmp = new THREE.Vector3();

  constructor(kit: Kit, d: TeamCarDeps) {
    this.kitKey = `${kit.jersey}|${kit.side}`;
    this.group.rotation.order = 'YXZ';
    const paint = rgb(kit.jersey);
    const accent = rgb(kit.side);
    for (let lv = 0; lv < 3; lv++) {
      const g = new THREE.Group();
      this.lods.push(g);
      this.group.add(g);
      this.wheels.push([]);
      this.buildBody(g, lv, paint, kit);
      this.buildWheels(g, lv, accent);
      if (lv < 2) this.buildRack(g, lv, kit, d);
    }
    // Schatten unter dem Wagen (weich)
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 5.2), new THREE.MeshBasicMaterial({ map: d.shadowTex, transparent: true, depthWrite: false, opacity: 0.6 }));
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = 0.025;
    sh.renderOrder = 1;
    sh.userData.noShadow = true;
    this.group.add(sh);
    this.dis.push(sh.geometry, sh.material as THREE.Material);
    // Sportlicher Leiter am Steuer (nur nah): Teamjacke, Kappe; das Fenster ist offen
    const look = { ...lookFor(mulberry32(41), 'mechanic', kit), sleeves: true, print: 'DS' };
    this.driver = new Human(look, 12.3, 1);
    this.driver.seated = true;
    this.driver.act = 'drive';
    this.driver.group.position.set(-0.38, 0.1, 0.02);
    this.lods[0].add(this.driver.group);
    // Flasche: Teamfarbe mit weißem Deckel
    this.bottle = new THREE.Group();
    const bm = new Mesher(PAINT);
    bm.add(new THREE.CylinderGeometry(0.036, 0.036, 0.17, 16), new THREE.Matrix4().setPosition(0, 0.02, 0), paint);
    bm.add(new THREE.CylinderGeometry(0.03, 0.036, 0.03, 16), new THREE.Matrix4().setPosition(0, 0.12, 0), rgb('#f4f4f2'));
    bm.add(new THREE.CylinderGeometry(0.01, 0.014, 0.03, 8), new THREE.Matrix4().setPosition(0, 0.15, 0), rgb('#141416'));
    const bg = merge([bm])!;
    this.dis.push(bg);
    this.bottle.add(new THREE.Mesh(bg, glossMat()));
    // Leuchtpunkt um die angebotene Flasche (pulsiert, solange sie zu haben ist)
    const sm = new THREE.SpriteMaterial({ map: d.glow, color: 0xfff1b8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.mark = new THREE.Sprite(sm);
    this.mark.scale.setScalar(0.34);
    this.mark.position.y = 0.05;
    this.mark.userData.noShadow = true;
    this.bottle.add(this.mark);
    this.dis.push(sm);
    this.driver.carry(this.bottle, 'left');
    appearifyTree(this.group);
  }

  /** gehört der Wagen zu diesen Teamfarben? */
  fits(kit: Kit): boolean { return this.kitKey === `${kit.jersey}|${kit.side}`; }

  // ------------------------------------------------------------------ Bau

  private buildBody(g: THREE.Group, lv: number, paint: C3, kit: Kit) {
    const body = new Mesher(PAINT);
    const glass = new Mesher(0.62);
    const trim = new Mesher(SATIN);
    const chrome = new Mesher(CHROME);
    const matte = new Mesher(MATTE);
    const glassC = rgb('#141a22');
    const blackC = rgb('#17181b');
    const plasticC = rgb('#2a2b2e');
    if (lv === 2) {
      // fern: schlichter Körper (Unterbau und Kabine je ein Prisma), Räder kommen dazu
      const box = (f0: number, f1: number, y0: number, y1: number, w: number, c: C3, m: Mesher) =>
        m.add(new THREE.BoxGeometry(w * 2, y1 - y0, f1 - f0), new THREE.Matrix4().setPosition(0, (y0 + y1) / 2, -(f0 + f1) / 2), c);
      box(TAIL + 0.05, NOSE - 0.05, 0.32, BELT, 0.92, paint, body);
      box(RW + 0.1, WS - 0.25, BELT, 1.45, 0.8, glassC, glass);
      box(RW + 0.15, WS - 0.3, 1.44, 1.48, 0.7, paint, body);
      const geo = merge([body, glass])!;
      this.dis.push(geo);
      g.add(new THREE.Mesh(geo, glossMat()));
      return;
    }
    const nS = lv === 0 ? 44 : 20;
    const rf = lv === 0 ? 2 : 1;
    // Unterbau: Lack, unten Kunststoff (Schweller, Schürzen)
    const fs = stations(nS, TAIL, NOSE);
    const rings = fs.map((f) => ring(refine(lowerHalf(f), rf)));
    loft(body, fs, rings, (f, _x, y) => (y < bottomY(f) + 0.07 && Math.abs(f) < 2.6 ? plasticC : paint), (f, _x, y) => (y < bottomY(f) + 0.07 ? SATIN : PAINT), true);
    // Kabine: getönte Scheiben ringsum (Dach und Säulen kommen darüber); nah das Fahrerfenster offen
    const cf = stations(lv === 0 ? 34 : 14, RW, WS);
    const crings = cf.map((f) => ring(refine(cabinHalf(f), rf)));
    const nC = crings[0].length;
    const openWin = lv === 0
      ? (k: number, j: number) => {
        const f = (cf[k] + cf[k + 1]) / 2;
        const [x, y] = crings[k][j];
        return f > -0.12 && f < 0.82 && x < 0 && y > BELT + 0.02 && y < roofY(f) - 0.07 && j > nC / 2;
      }
      : undefined;
    loft(glass, cf, crings, () => glassC, () => 0.62, false, openWin);
    // Innenraum (nur nah, durchs offene Fenster zu sehen): dunkle Wände nach innen, Sitze, Lenkrad
    if (lv === 0) {
      const inner = new Mesher(MATTE);
      // Rückbank und Kopfstützen (durchs offene Fenster zu sehen)
      inner.add(new THREE.BoxGeometry(1.4, 0.45, 0.15), new THREE.Matrix4().setPosition(0, 0.92, 1.25), rgb('#232428'));
      inner.add(new THREE.BoxGeometry(0.5, 0.55, 0.12), new THREE.Matrix4().setPosition(-0.38, 0.95, 0.45), rgb('#26272b'));
      inner.add(new THREE.BoxGeometry(0.5, 0.55, 0.12), new THREE.Matrix4().setPosition(0.38, 0.95, 0.45), rgb('#26272b'));
      inner.add(new THREE.TorusGeometry(0.17, 0.018, 8, 24), new THREE.Matrix4().makeRotationX(-0.45).setPosition(-0.38, 1.0, -0.42), rgb('#121214'));
      inner.add(new THREE.BoxGeometry(1.5, 0.12, 0.45), new THREE.Matrix4().setPosition(0, 0.98, -0.75), rgb('#18191c'));
      const ig = merge([inner])!;
      this.dis.push(ig);
      g.add(new THREE.Mesh(ig, glossMat()));
    }
    // Dach (Lack) und Säulen (schwarz glänzend), Fensterrahmen (Chrom) – leicht über der Scheibe
    const roofHalf = (f: number, out: number) => cabinHalf(f).slice(2).map(([x, y]) => [x + out * 0.6, y + out] as [number, number]);
    const rfS = stations(lv === 0 ? 16 : 8, ROOF_R + 0.06, ROOF_F - 0.05);
    const roofRings = rfS.map((f) => { const h = roofHalf(f, 0.004); return [...h, ...h.slice(0, -1).reverse().map(([x, y]) => [-x, y] as [number, number])]; });
    loftOpen(body, rfS, roofRings, () => paint, () => PAINT);
    // Säulen: A (an der Frontscheibe), B, C, D – schmale Bänder über die Kabinenflanke
    const pillar = (f0: number, f1: number) => {
      for (const sg of [-1, 1]) {
        const steps = 6;
        for (let k = 0; k < steps; k++) {
          const ya = BELT + (k / steps) * 0.6, yb = BELT + ((k + 1) / steps) * 0.6;
          const pts = [[f0, ya], [f1, ya], [f1, yb], [f0, yb]].map(([f, y]) => {
            const yr = roofY(f);
            const yy = Math.min(y, yr);
            const h = cabinHalf(f);
            // Breite der Kabinenflanke auf dieser Höhe
            const t = sat((yy - BELT) / Math.max(0.01, yr - BELT));
            const x = h[0][0] + (h[3][0] - h[0][0]) * t + 0.006;
            return trim.v(sg * x, yy, -f, blackC);
          });
          if (sg > 0) trim.quad(pts[0], pts[1], pts[2], pts[3]); else trim.quad(pts[0], pts[3], pts[2], pts[1]);
        }
      }
    };
    pillar(-0.2, -0.08);
    pillar(-1.28, -1.12);
    pillar(-2.3, -2.12);
    // Fensterrahmen: Chromleiste auf der Gürtellinie
    for (const sg of [-1, 1]) {
      const fl = stations(lv === 0 ? 18 : 8, RW + 0.08, WS - 0.05);
      let prev: [number, number] | null = null;
      for (const f of fl) {
        const x = cabinHalf(f)[0][0] + 0.012;
        const a = chrome.v(sg * x, BELT + 0.005, -f, rgb('#d9dde2'));
        const b = chrome.v(sg * x, BELT + 0.028, -f, rgb('#d9dde2'));
        if (prev) { if (sg > 0) chrome.quad(prev[0], a, b, prev[1]); else chrome.quad(prev[0], prev[1], b, a); }
        prev = [a, b];
      }
    }
    // Front: Kühlergrill (dunkel mit Chromrahmen), Scheinwerfer, Nebelleuchten, Kennzeichen
    const nose = (y: number) => {
      // Lage der Frontfläche bei Höhe y (Nase leicht geneigt)
      const top = topY(NOSE - 0.02);
      return NOSE - 0.015 - Math.max(0, y - 0.45) * 0.18 - Math.max(0, top - y < 0.05 ? 0.05 : 0);
    };
    const put = (m: Mesher, geo: THREE.BufferGeometry, x: number, y: number, f: number, c: C3, rx = 0, ry = 0, rz = 0) =>
      m.add(geo, new THREE.Matrix4().compose(new THREE.Vector3(x, y, -f), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)), c);
    put(trim, new THREE.BoxGeometry(0.78, 0.17, 0.04), 0, 0.5, nose(0.5) + 0.005, rgb('#101114'));
    put(chrome, new THREE.BoxGeometry(0.82, 0.02, 0.045), 0, 0.59, nose(0.59) + 0.006, rgb('#d9dde2'));
    put(chrome, new THREE.BoxGeometry(0.82, 0.02, 0.045), 0, 0.41, nose(0.41) + 0.006, rgb('#d9dde2'));
    if (lv === 0) for (let i = 0; i < 5; i++) put(chrome, new THREE.BoxGeometry(0.74, 0.008, 0.03), 0, 0.44 + i * 0.03, nose(0.44) + 0.012, rgb('#9da2a8'));
    for (const sg of [-1, 1]) {
      // Scheinwerfer: flach, nach außen gezogen, Tagfahrlicht als heller Streifen
      put(chrome, new THREE.BoxGeometry(0.42, 0.1, 0.12), sg * 0.58, 0.7, NOSE - 0.1, rgb('#e9edf2'), 0, sg * 0.28, 0);
      put(matte, new THREE.BoxGeometry(0.36, 0.018, 0.125), sg * 0.58, 0.665, NOSE - 0.098, rgb('#fffbea'), 0, sg * 0.28, 0);
      put(matte, new THREE.BoxGeometry(0.12, 0.05, 0.03), sg * 0.62, 0.36, nose(0.36) - 0.02, rgb('#fdf6dc'));
      // Rückleuchten: rote Bänder um die Heckkante
      put(chrome, new THREE.BoxGeometry(0.34, 0.1, 0.04), sg * 0.55, 0.84, TAIL - 0.004, rgb('#b3121a'));
      put(matte, new THREE.BoxGeometry(0.03, 0.09, 0.3), sg * (halfW(TAIL + 0.2) + 0.006), 0.84, TAIL + 0.18, rgb('#c3161e'));
      put(matte, new THREE.BoxGeometry(0.3, 0.02, 0.042), sg * 0.55, 0.81, TAIL - 0.005, rgb('#ff4a3a'));
      // Spiegel: Fuß und Gehäuse in Lackfarbe
      put(body, new THREE.BoxGeometry(0.08, 0.035, 0.05), sg * (halfW(0.75) + 0.03), 1.0, 0.76, paint);
      body.add(new THREE.CapsuleGeometry(0.05, 0.12, lv === 0 ? 4 : 2, lv === 0 ? 12 : 6), new THREE.Matrix4().compose(new THREE.Vector3(sg * (halfW(0.75) + 0.13), 1.03, -0.74), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), new THREE.Vector3(1, 1, 0.85)), paint);
      if (lv === 0) put(chrome, new THREE.BoxGeometry(0.15, 0.085, 0.01), sg * (halfW(0.75) + 0.12), 1.03, 0.69, rgb('#cfd6de'));
      // Türgriffe
      if (lv === 0) for (const f of [0.38, -0.72]) put(chrome, new THREE.BoxGeometry(0.03, 0.025, 0.16), sg * (halfW(f) + 0.008), 0.86, f, rgb('#d9dde2'));
      // Radlaufverbreiterung (dunkel): Bogen über jedem Rad
      for (const ax of [AXF, AXR]) {
        const seg = lv === 0 ? 14 : 7;
        let pa: number[] | null = null;
        for (let i = 0; i <= seg; i++) {
          const a = Math.PI * (i / seg);
          const f = ax + Math.cos(a) * (ARCH + 0.02);
          const y = 0.34 + Math.sin(a) * (ARCH + 0.02);
          const w = halfW(f) + 0.012;
          const o = matte.v(sg * w, y, -f, plasticC);
          const q = matte.v(sg * (w + 0.015), y + 0.05, -f, plasticC);
          // (schmales Band: beide Seiten, egal wie es zur Kamera steht)
          if (pa) { matte.quad(pa[0], pa[1], q, o); matte.quad(pa[0], o, q, pa[1]); }
          pa = [o, q];
        }
      }
    }
    // Kennzeichen vorn und hinten
    put(matte, new THREE.BoxGeometry(0.52, 0.11, 0.015), 0, 0.33, nose(0.33) + 0.01, rgb('#f4f4f0'));
    put(matte, new THREE.BoxGeometry(0.52, 0.11, 0.015), 0, 0.6, TAIL + 0.005, rgb('#f4f4f0'));
    // Antenne (Haifischflosse) und Dachreling
    put(trim, new THREE.BoxGeometry(0.06, 0.07, 0.2), 0, 1.5, -1.95, blackC);
    for (const sg of [-1, 1]) {
      const fl = stations(10, ROOF_R + 0.1, ROOF_F - 0.1);
      for (let i = 0; i < fl.length - 1; i++) {
        const fa = fl[i], fb = fl[i + 1];
        const xa = cabinHalf(fa)[3][0] - 0.02, xb = cabinHalf(fb)[3][0] - 0.02;
        const ya = roofY(fa) + 0.045, yb = roofY(fb) + 0.045;
        const len = Math.hypot(fb - fa, yb - ya, xb - xa);
        put(trim, new THREE.BoxGeometry(0.03, 0.025, len), sg * (xa + xb) / 2, (ya + yb) / 2, (fa + fb) / 2, rgb('#1d1e21'));
      }
    }
    const geo = merge([body, glass, trim, chrome, matte])!;
    this.dis.push(geo);
    g.add(new THREE.Mesh(geo, glossMat()));
    // Teamaufschrift auf beiden Flanken und der Motorhaube
    const tex = liveryTex(kit);
    const lm = new THREE.MeshPhongMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, shininess: 60, specular: new THREE.Color(0.25, 0.25, 0.25) });
    this.dis.push(tex, lm);
    const decal = this.sideDecal(lv === 0 ? 40 : 16);
    this.dis.push(decal);
    const dm = new THREE.Mesh(decal, lm);
    dm.renderOrder = 2;
    dm.userData.noShadow = true;
    g.add(dm);
  }

  /** Fläche der Flankenaufschrift: folgt der Wölbung der Seite (Hinterrad bis Vorderrad), 3 mm über dem Lack */
  private sideDecal(n: number): THREE.BufferGeometry {
    const pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = [];
    const f0 = -2.25, f1 = 1.85;
    const rows = 6;
    for (const sg of [-1, 1]) {
      const base = pos.length / 3;
      for (let i = 0; i <= n; i++) {
        const f = f0 + ((f1 - f0) * i) / n;
        const yb = Math.max(bottomY(f) + 0.06, 0.38), yt = topY(f) - 0.03;
        const half = lowerHalf(f);
        for (let k = 0; k <= rows; k++) {
          const y = yb + ((yt - yb) * k) / rows;
          // Breite des Querschnitts auf Höhe y (zwischen den Profilpunkten)
          let x = half[3][0];
          for (let q = 2; q < 6; q++) {
            const [xa, ya] = half[q], [xb, yb2] = half[q + 1];
            if (y >= ya && y <= yb2) { x = xa + ((xb - xa) * (y - ya)) / Math.max(1e-4, yb2 - ya); break; }
          }
          pos.push(sg * (x + 0.003), y, -f);
          nor.push(sg, 0, 0);
          // u: 0 hinten … 1 vorn; links gespiegelt gelesen wäre die Schrift verkehrt – also links von vorn nach hinten
          const u = (f - f0) / (f1 - f0);
          uv.push(sg > 0 ? u : 1 - u, (y - 0.38) / 0.56);
        }
      }
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < rows; k++) {
          const a = base + i * (rows + 1) + k, b = a + rows + 1;
          // rechts: Normale +x, links −x (von außen gegen den Uhrzeigersinn)
          if (sg > 0) idx.push(a, b, b + 1, a, b + 1, a + 1); else idx.push(a, a + 1, b + 1, a, b + 1, b);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  private buildWheels(g: THREE.Group, lv: number, caliper: C3) {
    const geo = wheelGeo(lv === 0 ? 2 : lv === 1 ? 1 : 0, caliper);
    this.dis.push(geo);
    for (const f of [AXF, AXR]) {
      for (const sg of [-1, 1]) {
        const w = new THREE.Group();
        w.position.set(sg * TRACK, WR, -f);
        const m = new THREE.Mesh(geo, glossMat());
        // Felge nach außen: links gespiegelt
        if (sg < 0) m.rotation.y = Math.PI;
        w.add(m);
        g.add(w);
        this.wheels[lv].push(w);
      }
    }
  }

  /** Dachträger mit drei Teamrädern (nah: dieselben Räder wie unter den Fahrern, mittel: einfache) */
  private buildRack(g: THREE.Group, lv: number, kit: Kit, d: TeamCarDeps) {
    const rack = new Mesher(SATIN);
    const y = 1.56;
    for (const f of [-0.35, -1.65]) rack.add(new THREE.BoxGeometry(1.42, 0.035, 0.06), new THREE.Matrix4().setPosition(0, y, -f), rgb('#1d1e21'));
    const xs = [-0.48, 0, 0.48];
    for (const x of xs) rack.add(new THREE.BoxGeometry(0.06, 0.04, 1.75), new THREE.Matrix4().setPosition(x, y + 0.03, 1.0), rgb('#2a2b2f'));
    const rg = merge([rack])!;
    this.dis.push(rg);
    g.add(new THREE.Mesh(rg, glossMat()));
    if (lv === 0) {
      const b = bikeBuild(undefined, kit, 0);
      xs.forEach((x, i) => {
        const bg = new THREE.Group();
        bg.position.set(x, y + 0.05, -(-1.0));
        bg.rotation.y = i === 1 ? Math.PI : 0;
        bg.add(new THREE.Mesh(b.frame, glossMat()));
        const wf = new THREE.Mesh(b.wheelF, glossMat()); wf.position.copy(b.fit.front); bg.add(wf);
        const wr = new THREE.Mesh(b.wheelR, glossMat()); wr.position.copy(b.fit.rear); bg.add(wr);
        if (b.spokes.f) { const s = new THREE.Mesh(b.spokes.f, glossFarMat()); s.position.copy(b.fit.front); bg.add(s); }
        if (b.spokes.r) { const s = new THREE.Mesh(b.spokes.r, glossFarMat()); s.position.copy(b.fit.rear); bg.add(s); }
        const ck = new THREE.Mesh(b.crank, glossFarMat()); ck.position.copy(b.fit.bb ?? new THREE.Vector3(0, 0.3, 0.02)); bg.add(ck);
        g.add(bg);
      });
    } else {
      const gb = new GB();
      xs.forEach((x, i) => simpleBike(gb, new THREE.Matrix4().compose(new THREE.Vector3(x, y + 0.05, 1.0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, i === 1 ? Math.PI : 0, 0)), new THREE.Vector3(1, 1, 1)), lin(kit.jersey)));
      const sg = gb.build();
      this.dis.push(sg);
      g.add(new THREE.Mesh(sg, d.props));
    }
  }

  // ------------------------------------------------------------------ Laufzeit

  /**
   * Wagen an seinen Ort: world liefert die Weltlage (Streckenkoordinaten z, x); cam für die Detailstufe, look:
   * wohin der Fahrer schaut (Kopf des Spielers)
   */
  update(c: TeamCar, world: (z: number, x: number) => { x: number; y: number; z: number; th: number }, cam: THREE.Vector3, look: THREE.Vector3, dt: number) {
    const w = world(c.z, c.x);
    this.group.position.set(w.x, w.y, w.z);
    this.group.rotation.y = -w.th;
    // Detailstufe nach dem Abstand, gerastert überblendet
    const dc = this.group.position.distanceTo(cam);
    const a0 = sat((dc - LOD_D[0]) / LOD_W);
    const a1 = sat((dc - LOD_D[1]) / LOD_W);
    this.show(0, a0 >= 1 ? -1 : a0 > 0 ? apOut(a0) : 0);
    this.show(1, a0 <= 0 || a1 >= 1 ? -1 : a0 < 1 ? apIn(a0) : a1 > 0 ? apOut(a1) : 0);
    this.show(2, a1 >= 1 ? 0 : a1 > 0 ? apIn(a1) : -1);
    // Räder drehen
    const spin = -c.dist / WR;
    for (const list of this.wheels) for (const wh of list) wh.rotation.x = spin;
    // Fahrer: reicht die Flasche hinaus (Ziel in Weltkoordinaten), schaut zum Spieler
    if (this.lods[0].visible) {
      this.group.updateMatrixWorld();
      const hand = this.tmp.set(HAND_DX * 0.98, 1.06, -HAND_DZ).applyMatrix4(this.group.matrixWorld);
      this.driver.holdAt.copy(hand);
      this.driver.reach = c.reach;
      this.driver.lookAt = look;
      this.driver.update(dt);
    }
    this.bottle.visible = !c.got;
    this.time += dt;
    const on = c.phase === 'offer' && !c.got ? Math.min(1, c.reach * 1.4) : 0;
    const sm = this.mark.material;
    sm.opacity = on * (0.45 + 0.35 * Math.sin(this.time * 7));
    this.mark.visible = sm.opacity > 0.01;
  }

  /** Stufe zeigen: −1 = aus, 0 = ganz, sonst Rastercode (apIn/apOut) */
  private show(lv: number, code: number) {
    const g = this.lods[lv];
    g.visible = code !== -1;
    setAp(g, code > 0 ? code : undefined);
  }

  dispose() {
    this.group.removeFromParent();
    this.driver.dispose();
    for (const x of this.dis) x.dispose();
    this.dis = [];
  }
}

/** offene Fläche aus Ringen (nicht geschlossen, ohne Deckel), Drehsinn nach oben/außen */
function loftOpen(m: Mesher, fs: number[], rings: [number, number][][], col: (f: number) => C3, gl: (f: number) => number) {
  const n = rings[0].length;
  const idx = fs.map((f, k) => rings[k].map(([x, y]) => m.v(x, y, -f, col(f), gl(f))));
  // Normale der Mitte soll nach oben zeigen
  const P = (i: number) => [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]];
  const j = Math.floor(n / 2) - 1;
  const a = P(idx[0][j]), b = P(idx[0][j + 1]), c = P(idx[1][j + 1]);
  const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  const flip = ny < 0;
  for (let k = 0; k < fs.length - 1; k++) {
    for (let q = 0; q < n - 1; q++) {
      const v = [idx[k][q], idx[k][q + 1], idx[k + 1][q + 1], idx[k + 1][q]];
      if (flip) m.quad(v[3], v[2], v[1], v[0]); else m.quad(v[0], v[1], v[2], v[3]);
    }
  }
}
