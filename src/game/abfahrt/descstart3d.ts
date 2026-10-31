/**
 * Abfahrt: der Startort auf der Passhöhe – die Piazza, auf der das Rennen beginnt.
 *
 * Hinter dem Start schließt der Torre civica die Straße ab (Bossenwerk, Portal, Balkon mit Fahnen, Wappen, Uhr mit
 * Zeigern nach der echten Uhrzeit, Glockenstube, Schwalbenschwanzzinnen), links und rechts Palazzi, dahinter eine
 * zweite Reihe Dächer. Der Platz ist mit Porphyr im Pfauenschwanzmuster gepflastert, Travertinbänder als Raster.
 * Rechts (im Bild des Krans): Brunnen mit Wasser, Café mit Schirmen, Gästen und Kellner, die Bühne des Sprechers,
 * Vespas und Rennräder; links Marktstände, Zeitungskiosk und Bank. Am Start Starter, Kommissäre, Fotografen,
 * Kameramann und Polizei, die Startlinie mit Schrift auf der Straße und Tauben, die beim Start auffliegen.
 * Rosa Fahnen an den Laubengängen, Laternen und Lichterketten (abends).
 *
 * Feste Teile liegen in einer Gruppe in Startkoordinaten: x nach rechts, y nach oben, f = Streckenmeter ab dem
 * Anfang der Strecke (lokal −z; hinter dem Anfang geradeaus weiter). Menschen und Tauben stehen in Weltkoordinaten.
 */
import * as THREE from 'three';
import { EDGE, ROAD_HALF, SEG, type Track } from './track';
import { GB, lin, type RGBf } from './models3d';
import { MB } from './rider3d';
import { Human, lookFor, propGeometries, type Act, type Look } from './human3d';
import { buildHouse, roofColor, roofKind, rowUnits, wallSet, type At, type Town } from './house3d';
import { STYLE, type Lang } from './facade';
import { mulberry32 } from './rng';
import { bike } from './ttstart3d';
import type { RaceView } from './engine';

export interface DescentStartDeps {
  track: Track;
  /** Eckpunktfarben, flach schattiert */
  props: THREE.Material;
  /** Eckpunktfarben, glatt schattiert (Rundes: Tische, Stühle, Vespas, Mast) */
  gear: THREE.Material;
  /** Häuser (house3d): Fassaden-Atlas, einfarbige Teile, Ziegel, Ladenschilder */
  facade: THREE.Material;
  roof: THREE.Material;
  tiles: THREE.Material;
  sign: THREE.Material;
  /** Lichtpunkte am Abend (Wandlaternen, Glühbirnen der Lichterketten) */
  lantern: THREE.Material;
  bulb: THREE.Material;
  /** runder Schatten (Alpha), Lichtpunkt (Blitze, Laternen) */
  shadow: THREE.Texture;
  glow: THREE.Texture;
  aniso: number;
  accent: string;
  /** Abendlicht 0–1 (Zifferblatt, Laternen) */
  night: () => number;
  /** PC-Grafik: alle Menschen in voller Detailstufe */
  pc?: boolean;
}

type V = number[];
type N3 = [number, number, number];
/** Startkoordinaten (x, y, f) → lokal (f nach vorn = −z) */
const P = (x: number, y: number, f: number): V => [x, y, -f];
const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** Lage in Startkoordinaten; yaw: Blickrichtung eines Modells mit Vorderseite −z (0 = nach vorn, + = nach rechts) */
const M4 = (x: number, y: number, f: number, yaw = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(V3(x, y, -f), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, -yaw, rz, 'YXZ')), V3(sx, sy, sz));
const WHITE: RGBf = [1, 1, 1];
const shade = (c: RGBf, k: number): RGBf => [c[0] * k, c[1] * k, c[2] * k];
const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", "Palatino Linotype", serif';

/** Dreieck mit Vorderseite in Richtung n (Startkoordinaten) – die Reihenfolge wird passend gedreht */
function triN(gb: GB, a: V, b: V, c: V, n: N3, col: RGBf, ua?: number[], ub?: number[], uc?: number[]) {
  const ux = c[0] - b[0], uy = c[1] - b[1], uz = c[2] - b[2];
  const vx = a[0] - b[0], vy = a[1] - b[1], vz = a[2] - b[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (nx * n[0] + ny * n[1] - nz * n[2] < 0) gb.tri(a, c, b, col, ua, uc, ub);
  else gb.tri(a, b, c, col, ua, ub, uc);
}
function quadN(gb: GB, a: V, b: V, c: V, d: V, n: N3, col: RGBf, uvs?: number[][]) {
  triN(gb, a, b, c, n, col, uvs?.[0], uvs?.[1], uvs?.[2]);
  triN(gb, a, c, d, n, col, uvs?.[0], uvs?.[2], uvs?.[3]);
}
/** Kiste (Mitte x, y, f; Maße quer, hoch, längs) */
function box(gb: GB | MB, x: number, y: number, f: number, w: number, h: number, l: number, col: RGBf, yaw = 0, rx = 0) {
  gb.add(new THREE.BoxGeometry(w, h, l), M4(x, y, f, yaw, rx), col);
}
/** Zylinder zwischen zwei Punkten (Startkoordinaten) */
function rodS(mb: MB | GB, a: V, b: V, r: number, col: RGBf, n = 8) {
  const A = V3(a[0], a[1], -a[2]), B = V3(b[0], b[1], -b[2]);
  const d = B.clone().sub(A);
  const len = d.length();
  if (len < 1e-4) return;
  const m = new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize()), V3(1, 1, 1));
  mb.add(new THREE.CylinderGeometry(r, r, len, n, 1, false), m, col);
}
const canvas = (w: number, h: number) => {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return { cv, c: cv.getContext('2d')! };
};

interface Walk {
  /** Wegpunkte (x, f), geschlossen; an stops wartet der Mensch wait Sekunden (Kellner am Tisch) */
  pts: [number, number][];
  v: number;
  s: number;
  seg: number;
  wait: number;
  stops: Set<number>;
  pause: number;
  act: Act;
}

interface Person {
  h: Human;
  x: number;
  f: number;
  y: number;
  yaw: number;
  /** schaut zum Fahrer (am Start und im Countdown) */
  watch: boolean;
  /** dreht sich mit dem ganzen Körper nach dem Fahrer (Fotografen, Kamera) */
  follow?: boolean;
  walk?: Walk;
  /** Bildzähler (Ferne: seltener bewegen) */
  tick: number;
  role?: 'starter' | 'speaker';
  base: Act;
  /** klatscht beim Start */
  cheer: boolean;
  /** Gegenüber am Tisch (schaut ihn an), −1: niemand */
  partner: number;
  /** Kopf (Welt), für den Blick des Gegenübers */
  head: THREE.Vector3;
}

interface Pigeon {
  x: number; y: number; f: number; yaw: number;
  /** 0 am Boden (pickt, trippelt), 1 fliegt */
  state: 0 | 1;
  vx: number; vy: number; vf: number;
  flap: number;
  peck: number;
  delay: number;
  t: number;
}

export class DescentStart3D {
  readonly root = new THREE.Group();
  private local = new THREE.Group();
  /** Startlinie (sichtbar, bis die Kamera darüber ist) */
  private lineG = new THREE.Group();
  private dis: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private people: Person[] = [];
  private pigeons: Pigeon[] = [];
  private pigBody: THREE.InstancedMesh | null = null;
  private pigWing: THREE.InstancedMesh[] = [];
  private flags: { geo: THREE.BufferGeometry; base: Float32Array; w: number; ph: number }[] = [];
  private hands: { h: THREE.Object3D; m: THREE.Object3D } | null = null;
  private dialMat: THREE.MeshLambertMaterial | null = null;
  private water: THREE.Texture[] = [];
  private flashes: { s: THREE.Sprite; t: number; next: number; who: number }[] = [];
  private riderHead = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private m4 = new THREE.Matrix4();
  private mW = new THREE.Matrix4();
  private mOff = new THREE.Matrix4();
  private mRot = new THREE.Matrix4();
  private eW = new THREE.Euler(0, 0, 0, 'YXZ');
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private s3 = new THREE.Vector3(1, 1, 1);
  private lastPhase = '';
  private goT = -1;
  private time = 0;
  private clockMin = -1;
  private readonly W0 = { x: 0, y: 0, z: 0, th: 0 };
  readonly track: Track;
  private readonly d: DescentStartDeps;
  private readonly y0: number;
  /** Startplatz des Fahrers (Streckenmeter) */
  readonly z0: number;
  private readonly pz0: number;
  private readonly pz1: number;
  /** Kirche auf der linken Seite der Piazza (von, bis) */
  private church: [number, number] = [0, 0];
  private readonly lang: string;

  constructor(d: DescentStartDeps) {
    this.d = d;
    const t = d.track;
    this.track = t;
    this.lang = t.lang;
    t.world(0, 0, 0, this.W0);
    this.y0 = this.W0.y;
    this.z0 = t.startZ + 6;
    this.local.position.set(this.W0.x, this.W0.y, this.W0.z);
    this.local.rotation.y = -this.W0.th;
    this.root.add(this.local);
    this.lineG.position.copy(this.local.position);
    this.lineG.rotation.copy(this.local.rotation);
    this.root.add(this.lineG);
    this.root.name = 'descentStart';
    const pz = t.sections[0]?.piazza ?? [6, 36];
    this.pz0 = pz[0] * SEG;
    this.pz1 = pz[1] * SEG;
    for (let i = pz[0]; i < pz[1]; i++) {
      const b = t.seg(i).bL;
      if (b && b.style === STYLE.kirche) this.church = [i * SEG, (i + b.len) * SEG];
    }

    const props = new GB();
    const smooth = new MB();
    const bands = new GB();
    this.floor(bands);
    this.tower(props);
    this.backdrop();
    this.fountain(props, smooth);
    this.cafe(props, smooth);
    this.stage(props, smooth);
    this.scooters(props, smooth);
    this.market(props, smooth);
    this.kiosk(props, smooth);
    this.lamps(props, smooth);
    this.banners();
    this.startLine();
    this.staff();
    this.locals();
    this.makePigeons();

    const mesh = (g: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = this.local) => {
      this.dis.push(g);
      const m = new THREE.Mesh(g, mat);
      parent.add(m);
      return m;
    };
    if (!props.empty) mesh(props.build(), d.props);
    if (smooth.pos.length) mesh(smooth.build(), d.gear);
    if (!bands.empty) {
      const bm = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      this.dis.push(bm);
      mesh(bands.build(), bm);
    }
    // Schatten unter den Menschen
    const flat = new GB();
    flat.uv = true;
    for (const p of this.people) {
      if (p.walk) continue;
      const s = p.h.act === 'sit' || p.h.act === 'drink' || p.h.act === 'read' ? 1.0 : 0.8;
      flat.quad(P(p.x - s / 2, p.y + 0.02, p.f - s / 2), P(p.x + s / 2, p.y + 0.02, p.f - s / 2), P(p.x + s / 2, p.y + 0.02, p.f + s / 2), P(p.x - s / 2, p.y + 0.02, p.f + s / 2), WHITE, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    const sm = new THREE.MeshBasicMaterial({ map: d.shadow, transparent: true, depthWrite: false, opacity: 0.45, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -4 });
    this.dis.push(sm);
    if (!flat.empty) mesh(flat.build(), sm, this.lineG);
    for (let i = 0; i < this.people.length; i++) this.place(i);
  }

  // ------------------------------------------------------------------ Grundlagen

  /** Fahrbahnhöhe an Streckenmeter f über dem Anfang (hinter dem Anfang: geradeaus weiter) */
  private road(f: number): number {
    return this.track.heightAt(f) - this.y0;
  }

  /** Boden: Platz und Gehsteig 0,15 über der Fahrbahn, hinter dem Anfang der Strecke gleich hoch wie sie */
  private gy(x: number, f: number): number {
    if (f < 0) return this.road(f) + 0.02;
    return this.road(f) + (Math.abs(x) > EDGE ? 0.15 : 0);
  }

  private world(x: number, y: number, f: number, out: THREE.Vector3): THREE.Vector3 {
    const th = this.W0.th;
    return out.set(this.W0.x + Math.cos(th) * x + Math.sin(th) * f, this.y0 + y, this.W0.z + Math.sin(th) * x - Math.cos(th) * f);
  }

  private tex(cv: HTMLCanvasElement, repeat = false, aniso = this.d.aniso): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    this.dis.push(t);
    return t;
  }

  private mat(p: THREE.MeshLambertMaterialParameters): THREE.MeshLambertMaterial {
    const m = new THREE.MeshLambertMaterial(p);
    this.dis.push(m);
    return m;
  }

  // ------------------------------------------------------------------ Pflaster

  /**
   * Porphyr im Pfauenschwanzmuster über den ganzen Platz (vom Bankett bis unter die Laubengänge und hinter dem
   * Anfang der Strecke über die Breite), Travertinbänder als Raster, Bordstein am Ende des Gehsteigs.
   */
  private floor(bands: GB) {
    const gb = new GB();
    gb.uv = true;
    const T = 3.2;
    const uv = (x: number, f: number) => [x / T, f / T];
    const up: N3 = [0, 1, 0];
    const FE = this.pz1 + 2;
    for (const sg of [-1, 1]) {
      const xa = sg * (EDGE + 0.02), xb = sg * 30;
      for (let f = 0; f < FE; f += 4) {
        const f1 = Math.min(FE, f + 4);
        const ya = this.road(f) + 0.15, yb = this.road(f1) + 0.15;
        quadN(gb, P(xa, ya, f), P(xb, ya, f), P(xb, yb, f1), P(xa, yb, f1), up, WHITE, [uv(xa, f), uv(xb, f), uv(xb, f1), uv(xa, f1)]);
      }
    }
    for (let f = -64; f < 0; f += 4) {
      const f1 = f + 4;
      const ya = this.road(f) + 0.02, yb = this.road(f1) + 0.02;
      quadN(gb, P(-46, ya, f), P(46, ya, f), P(46, yb, f1), P(-46, yb, f1), up, WHITE, [uv(-46, f), uv(46, f), uv(46, f1), uv(-46, f1)]);
    }
    const ft = this.tex(floorTex(), true, Math.max(this.d.aniso, 8));
    const fm = this.mat({ map: ft, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    fm.name = 'piazzaFloor';
    const g = gb.build();
    this.dis.push(g);
    this.local.add(new THREE.Mesh(g, fm));

    // Bordstein am Ende des Gehsteigs (zum tieferen Platz hinter dem Anfang der Strecke)
    const curb = lin('#cfc8ba');
    for (const sg of [-1, 1]) {
      const xa = sg * EDGE, xb = sg * 30;
      quadN(bands, P(xa, 0.02, -0.001), P(xb, 0.02, -0.001), P(xb, 0.151, -0.001), P(xa, 0.151, -0.001), [0, 0, -1], curb);
      quadN(bands, P(xa, 0.151, 0), P(xb, 0.151, 0), P(xb, 0.151, -0.18), P(xa, 0.151, -0.18), up, shade(curb, 1.05));
    }
    // Travertinbänder: quer über den Platz, längs am Bordstein und an der Pfeilerlinie, hinter dem Anfang ein Rahmen
    const trav = lin('#e4dccb');
    const band = (x0: number, x1: number, f0: number, f1: number, k: number) => {
      const y0 = this.gy((x0 + x1) / 2, (f0 + f1) / 2) + 0.004;
      quadN(bands, P(x0, y0, f0), P(x1, y0, f0), P(x1, y0, f1), P(x0, y0, f1), up, shade(trav, k));
    };
    const pil = EDGE + 8.5 - 3.0;
    for (const sg of [-1, 1]) {
      const a = sg * (EDGE + 0.35), b = sg * (pil - 0.2);
      for (let f = this.pz0; f <= this.pz1 + 0.1; f += 12) band(Math.min(a, b), Math.max(a, b), f - 0.16, f + 0.16, 0.97 + ((f / 12) % 2) * 0.04);
      band(Math.min(sg * (EDGE + 0.3), sg * (EDGE + 0.56)), Math.max(sg * (EDGE + 0.3), sg * (EDGE + 0.56)), 0.2, FE, 1);
      band(Math.min(sg * (pil - 0.35), sg * (pil - 0.1)), Math.max(sg * (pil - 0.35), sg * (pil - 0.1)), this.pz0, this.pz1, 1);
    }
    band(-44, 44, -0.6, -0.3, 1);
    band(-44, 44, -4.75, -4.45, 0.97);
    band(-0.14, 0.14, -4.45, -0.6, 0.97);
  }

  // ------------------------------------------------------------------ Torre civica

  /**
   * Turm über der Straße hinter dem Start: Bossenwerk mit Portal (Nische mit Holztor), Balkon (Arengario) mit zwei
   * Fahnen, Inschrift, Wappen, Uhr (Zeiger nach der Uhrzeit, abends beleuchtet), Glockenstube, Kranzgesims auf
   * Konsolen, Schwalbenschwanzzinnen und ein flaches Zeltdach mit Wetterfahne.
   */
  private tower(props: GB) {
    const TW = 4.6, F0 = -5, F1 = -14.2, H2 = 25.4, H1 = 21;
    const base = this.road(F0) + 0.02;
    const gb = new GB();
    gb.uv = true;
    const uF = (x: number) => 0.5 * (TW - x) / (2 * TW);
    const v = (y: number) => y / H2;
    const front = (x0: number, x1: number, y0: number, y1: number, f = F0) => {
      quadN(gb, P(x1, base + y0, f), P(x0, base + y0, f), P(x0, base + y1, f), P(x1, base + y1, f), [0, 0, 1], WHITE,
        [[uF(x1), v(y0)], [uF(x0), v(y0)], [uF(x0), v(y1)], [uF(x1), v(y1)]]);
    };
    const AW = 1.8, AS = 3.4, AT = AS + AW;
    front(-TW, -AW, 0, H2);
    front(AW, TW, 0, H2);
    front(-AW, AW, AT, H2);
    // Zwickel über dem Rundbogen; Nische mit dem Tor (gleiche Texturstelle wie die Öffnung)
    const N = 12;
    const arc = (k: number) => [Math.cos(Math.PI * k / N) * AW, AS + Math.sin(Math.PI * k / N) * AW];
    for (let k = 0; k < N; k++) {
      const [xa, ya] = arc(k), [xb, yb] = arc(k + 1);
      const cx = k < N / 2 ? AW : -AW;
      triN(gb, P(cx, base + AT, F0), P(xa, base + ya, F0), P(xb, base + yb, F0), [0, 0, 1], WHITE, [uF(cx), v(AT)], [uF(xa), v(ya)], [uF(xb), v(yb)]);
      triN(gb, P(0, base + AS, F0 - 0.7), P(xa, base + ya, F0 - 0.7), P(xb, base + yb, F0 - 0.7), [0, 0, 1], WHITE, [uF(0), v(AS)], [uF(xa), v(ya)], [uF(xb), v(yb)]);
    }
    front(-AW, AW, 0, AS, F0 - 0.7);
    // Seiten und Rückseite (Bossen, Schlitzfenster, Glockenstube)
    const uS = (k: number) => 0.5 + 0.5 * k;
    const sideQ = (sg: number) => {
      const x = sg * TW;
      // von +x gesehen liegt vorn rechts im Bild, von −x gesehen hinten
      const fa = sg > 0 ? F1 : F0, fb = sg > 0 ? F0 : F1;
      quadN(gb, P(x, base, fa), P(x, base, fb), P(x, base + H2, fb), P(x, base + H2, fa), [sg, 0, 0], WHITE, [[uS(0), 0], [uS(1), 0], [uS(1), 1], [uS(0), 1]]);
    };
    sideQ(1);
    sideQ(-1);
    quadN(gb, P(-TW, base, F1), P(TW, base, F1), P(TW, base + H2, F1), P(-TW, base + H2, F1), [0, 0, -1], WHITE, [[uS(0), 0], [uS(1), 0], [uS(1), 1], [uS(0), 1]]);
    const tt = this.tex(towerTex(this.lang, this.track.sections[0]?.name ?? ''), false, Math.max(this.d.aniso, 4));
    const g = gb.build();
    this.dis.push(g);
    this.local.add(new THREE.Mesh(g, this.mat({ map: tt })));

    // Nische: Leibungen und Bogenlaibung (Stein im Schatten)
    const sh = lin('#8f877a');
    for (const sg of [-1, 1]) quadN(props, P(sg * AW, base, F0), P(sg * AW, base, F0 - 0.7), P(sg * AW, base + AS, F0 - 0.7), P(sg * AW, base + AS, F0), [-sg, 0, 0], sh);
    for (let k = 0; k < N; k++) {
      const [xa, ya] = arc(k), [xb, yb] = arc(k + 1);
      quadN(props, P(xa, base + ya, F0), P(xb, base + yb, F0), P(xb, base + yb, F0 - 0.7), P(xa, base + ya, F0 - 0.7), [-(xa + xb) / 2, -((ya + yb) / 2 - AS), 0], shade(sh, 0.85));
    }
    // Gesimse: über dem Bossenwerk, Kranzgesims auf Konsolen, oben ein Band; Zinnen und Zeltdach
    const stone = lin('#d9d0bd');
    const ring = (y: number, h: number, out: number, col: RGBf) => {
      box(props, 0, base + y + h / 2, F0 + out / 2 - 0.01, 2 * TW + 2 * out, h, out, col);
      box(props, 0, base + y + h / 2, F1 - out / 2 + 0.01, 2 * TW + 2 * out, h, out, col);
      for (const sg of [-1, 1]) box(props, sg * (TW + out / 2 - 0.01), base + y + h / 2, (F0 + F1) / 2, out, h, F0 - F1 + 2 * out, col);
    };
    ring(6.0, 0.32, 0.14, stone);
    ring(H1, 0.5, 0.42, stone);
    ring(H2 - 0.05, 0.3, 0.2, shade(stone, 0.95));
    // Konsolen unter dem Kranzgesims
    for (let x = -TW + 0.35; x <= TW - 0.3; x += 0.82) {
      box(props, x, base + H1 - 0.3, F0 + 0.17, 0.24, 0.6, 0.34, shade(stone, 0.9));
      box(props, x, base + H1 - 0.3, F1 - 0.17, 0.24, 0.6, 0.34, shade(stone, 0.9));
    }
    for (let f = F1 + 0.4; f <= F0 - 0.3; f += 0.82) for (const sg of [-1, 1]) box(props, sg * (TW + 0.17), base + H1 - 0.3, f, 0.34, 0.6, 0.24, shade(stone, 0.9));
    // Brüstung mit Schwalbenschwanzzinnen
    const zb = base + H2 + 0.25;
    const mer = lin('#d2c8b3');
    const merlon = (x: number, f: number, yaw: number) => {
      box(props, x, zb + 0.3, f, 0.62, 0.6, 0.42, mer, yaw);
      const dx = Math.cos(yaw), df = -Math.sin(yaw);
      for (const s of [-1, 1]) box(props, x + dx * s * 0.2, zb + 0.82, f + df * s * 0.2, 0.22, 0.46, 0.42, mer, yaw);
    };
    for (let x = -TW + 0.3; x <= TW - 0.29; x += (2 * TW - 0.6) / 7) { merlon(x, F0 - 0.1, 0); merlon(x, F1 + 0.1, 0); }
    for (let f = F1 + 1.0; f <= F0 - 0.9; f += (F0 - F1 - 1.9) / 6) for (const sg of [-1, 1]) merlon(sg * (TW - 0.1), f, Math.PI / 2);
    box(props, 0, zb - 0.02, (F0 + F1) / 2, 2 * TW - 0.2, 0.1, F0 - F1 - 0.2, shade(stone, 0.7));
    // Zeltdach (Ziegel), Wetterfahne
    const roofC = lin('#9a4a2c');
    const apex = P(0, zb + 2.6, (F0 + F1) / 2);
    const c = [P(-TW + 0.7, zb, F0 - 0.7), P(TW - 0.7, zb, F0 - 0.7), P(TW - 0.7, zb, F1 + 0.7), P(-TW + 0.7, zb, F1 + 0.7)];
    const nrm: N3[] = [[0, 0.6, 1], [1, 0.6, 0], [0, 0.6, -1], [-1, 0.6, 0]];
    for (let k = 0; k < 4; k++) triN(props, c[k], c[(k + 1) % 4], apex, nrm[k], shade(roofC, 0.92 + (k % 2) * 0.1));
    box(props, 0, zb + 3.4, (F0 + F1) / 2, 0.05, 1.6, 0.05, lin('#2a2826'));
    box(props, 0.22, zb + 3.95, (F0 + F1) / 2, 0.42, 0.22, 0.02, lin('#2a2826'));

    // Balkon über dem Portal (Arengario) mit Geländer und zwei Fahnen
    const by = base + 6.32;
    box(props, 0, by - 0.1, F0 + 0.55, 3.6, 0.2, 1.1, stone);
    for (let k = 0; k < 4; k++) box(props, -1.4 + k * 0.93, by - 0.45, F0 + 0.55, 0.22, 0.5, 0.9, shade(stone, 0.9));
    const iron = lin('#2a2a2e');
    box(props, 0, by + 0.95, F0 + 1.07, 3.6, 0.05, 0.05, iron);
    for (const sg of [-1, 1]) box(props, sg * 1.78, by + 0.95, F0 + 0.55, 0.05, 0.05, 1.05, iron);
    for (let x = -1.7; x <= 1.71; x += 0.17) box(props, x, by + 0.47, F0 + 1.07, 0.02, 0.95, 0.02, iron);
    const flagCols: Record<string, string[]> = {
      it: ['#1d8a4a', '#f4f2ec', '#cf2b37'], fr: ['#1f3f8f', '#f4f2ec', '#d8303a'], es: ['#c8102e', '#ffc400', '#c8102e'], en: ['#c8102e', '#f4f2ec', '#c8102e'],
    };
    const tri = flagCols[this.lang] ?? flagCols.it;
    this.flag(props, -1.62, by, F0 + 1.0, 3.6, tri, true);
    this.flag(props, 1.62, by, F0 + 1.0, 3.6, ['#f4f2ec', '#c8243a', '#f4f2ec'], false);

    // Uhr: Zifferblatt (eigene Textur, abends beleuchtet) und Zeiger
    const clock = new THREE.Group();
    clock.position.set(0, base + 14.9, -(F0 + 0.04));
    clock.rotation.y = Math.PI;
    const dialT = this.tex(dialTex(), false, 4);
    const dm = this.mat({ map: dialT, emissiveMap: dialT, emissive: new THREE.Color(1, 0.86, 0.62), emissiveIntensity: 0 });
    this.dialMat = dm;
    const dg = new THREE.CircleGeometry(1.42, 48);
    this.dis.push(dg);
    clock.add(new THREE.Mesh(dg, dm));
    const handMat = this.mat({ color: 0x1a1816 });
    const hand = (len: number, w: number) => {
      const g2 = new THREE.BoxGeometry(w, len, 0.04);
      g2.translate(0, len / 2 - 0.16, 0.05);
      this.dis.push(g2);
      const m = new THREE.Mesh(g2, handMat);
      clock.add(m);
      return m;
    };
    const hh = hand(0.82, 0.13);
    const mh = hand(1.18, 0.08);
    const cap = new THREE.CylinderGeometry(0.1, 0.1, 0.06, 12);
    cap.rotateX(Math.PI / 2);
    cap.translate(0, 0, 0.09);
    this.dis.push(cap);
    clock.add(new THREE.Mesh(cap, handMat));
    this.hands = { h: hh, m: mh };
    this.local.add(clock);
  }

  /** Fahne an einem Mast auf dem Balkon (Streifen senkrecht: tri; wellt sich in update) */
  private flag(props: GB, x: number, y: number, f: number, h: number, cols: string[], left: boolean) {
    box(props, x, y + h / 2, f, 0.06, h, 0.06, lin('#d8d4cc'));
    box(props, x, y + h + 0.05, f, 0.12, 0.12, 0.12, lin('#c9a24a'));
    const W = 1.9, H = 1.25;
    const pg = new THREE.PlaneGeometry(W, H, 12, 4);
    pg.translate((left ? -1 : 1) * W / 2, 0, 0);
    const col: number[] = [];
    const pos = pg.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const u = Math.abs(pos.getX(i)) / W;
      const c = lin(cols[Math.min(2, Math.floor(u * 3))]);
      col.push(c[0], c[1], c[2]);
    }
    pg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.dis.push(pg);
    const fm = this.mat({ vertexColors: true, side: THREE.DoubleSide });
    const m = new THREE.Mesh(pg, fm);
    m.position.set(x, y + h - H / 2 - 0.05, -f);
    this.local.add(m);
    this.flags.push({ geo: pg, base: new Float32Array(pos.array as Float32Array), w: left ? -W : W, ph: x });
  }

  /** Palazzi neben dem Turm, Häuser bis an den Rand des Platzes, dahinter eine zweite Reihe Dächer */
  private backdrop() {
    const t = this.track;
    const T: Town = { facade: new GB(), tiles: new GB(), plain: new GB(), signs: new GB(), lanterns: [], bulbs: [], detail: new GB(), occ: [] };
    T.facade.uv = true;
    T.tiles.uv = true;
    T.signs.uv = true;
    const base = this.road(-5) + 0.02;
    // längs = x (nach rechts), quer = −f: Fassaden bei quer = setback zeigen zum Platz (nach vorn)
    const at: At = (lat, along, h) => P(along, base + h, -lat);
    const lang = t.lang as Lang;
    const pal = wallSet(t.region, lang);
    const r = mulberry32((t.seed ^ 0x70c1) >>> 0);
    const row = (a0: number, a1: number, setback: number, depth: number, style: number, floors: number, seed: number, shops: boolean, back = false, ovA = true, ovB = true) => {
      const L = a1 - a0;
      const units = rowUnits(L, style, floors, seed, pal);
      units.forEach((u, i) => {
        const s = seed + (i + 1) * 7717;
        const st = u.style;
        buildHouse(T, at, {
          s0: a0 + u.s0, s1: a0 + u.s1, setback: setback + u.dz, depth: depth * (0.9 + r() * 0.2), sg: 1, style: st, floors: u.floors, seed: s, tint: u.tint,
          roof: roofKind(st, t.region, lang, false, r()), roofCol: roofColor(st, t.region, lang, r()),
          foot: -1.5, ovA: i === 0 && ovA, ovB: i === units.length - 1 && ovB, street: true, back,
          shop: shops && !back && u.s1 - u.s0 >= 3.99 && r() < 0.7 ? { sign: [0, 1, 2, 4, 5, 6][Math.floor(r() * 6)], badge: -1 } : null,
          lantern: !back && r() < 0.6,
        }, lang);
      });
    };
    // neben dem Turm: Palazzi (Fassaden fluchten mit dem Turm), außen niedrigere Häuser
    row(-23, -4.6, 5, 11, STYLE.ocker, 3, 1101, true, false, true, false);
    row(4.6, 23, 5, 11, STYLE.gelb, 3, 2203, true, false, false, true);
    row(-44, -23, 6.2, 9.5, STYLE.creme, 2, 3307, true);
    row(23, 44, 6.2, 9.5, STYLE.lachs, 2, 4409, true);
    // zweite Reihe (über die Dächer der ersten zu sehen)
    row(-34, -12, 19.5, 9, STYLE.terrakotta, 3, 5501, false, true);
    row(-10, 10, 23.5, 10, STYLE.creme, 4, 6607, false, true);
    row(12, 34, 19.5, 9, STYLE.ocker, 3, 7703, false, true);
    const add = (gb: GB, mat: THREE.Material) => {
      if (gb.empty) return;
      const g = gb.build();
      this.dis.push(g);
      this.local.add(new THREE.Mesh(g, mat));
    };
    add(T.facade, this.d.facade);
    add(T.plain, this.d.roof);
    add(T.tiles, this.d.tiles);
    add(T.detail, this.d.roof);
    add(T.signs, this.d.sign);
    if (T.lanterns.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(T.lanterns, 3));
      this.dis.push(g);
      this.local.add(new THREE.Points(g, this.d.lantern));
    }
  }

  // ------------------------------------------------------------------ Brunnen

  /** Achteckiges Becken mit Wasser, Säule mit Schale, aus vier Röhren fällt Wasser (Textur läuft) */
  private fountain(props: GB, smooth: MB) {
    const cx = 6.75, cf = this.pz0 + 2.6;
    const y = this.gy(cx, cf);
    const stone = lin('#d8cfbd');
    const R = 2.0;
    // Becken: Außenwand, Rand (Achteck)
    for (let k = 0; k < 8; k++) {
      const a0 = (k / 8) * Math.PI * 2 + Math.PI / 8, a1 = ((k + 1) / 8) * Math.PI * 2 + Math.PI / 8;
      const p = (a: number, r: number, h: number) => P(cx + Math.cos(a) * r, y + h, cf + Math.sin(a) * r);
      const am = (a0 + a1) / 2;
      const n: N3 = [Math.cos(am), 0, Math.sin(am)];
      quadN(props, p(a0, R, 0), p(a1, R, 0), p(a1, R, 0.62), p(a0, R, 0.62), n, shade(stone, 0.9 + (k % 2) * 0.06));
      quadN(props, p(a0, R + 0.06, 0.62), p(a1, R + 0.06, 0.62), p(a1, R - 0.3, 0.7), p(a0, R - 0.3, 0.7), [n[0], 2, n[2]], shade(stone, 1.04));
      quadN(props, p(a0, R + 0.06, 0.62), p(a1, R + 0.06, 0.62), p(a1, R + 0.06, 0.54), p(a0, R + 0.06, 0.54), n, shade(stone, 0.95));
      quadN(props, p(a0, R - 0.3, 0.7), p(a1, R - 0.3, 0.7), p(a1, R - 0.3, 0.4), p(a0, R - 0.3, 0.4), [-n[0], 0, -n[2]], shade(stone, 0.75));
    }
    // Säule, Schale, Knauf
    smooth.add(new THREE.CylinderGeometry(0.32, 0.42, 1.6, 16), M4(cx, y + 0.8, cf), stone);
    smooth.add(new THREE.CylinderGeometry(0.85, 0.3, 0.3, 24), M4(cx, y + 1.75, cf), shade(stone, 0.97));
    smooth.add(new THREE.CylinderGeometry(0.16, 0.22, 0.7, 12), M4(cx, y + 2.2, cf), stone);
    smooth.add(new THREE.SphereGeometry(0.24, 14, 10), M4(cx, y + 2.65, cf), shade(stone, 1.03));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      rodS(smooth, P(cx + Math.cos(a) * 0.3, y + 1.25, cf + Math.sin(a) * 0.3), P(cx + Math.cos(a) * 0.62, y + 1.22, cf + Math.sin(a) * 0.62), 0.03, lin('#8a6a3a'), 6);
    }
    // Wasser: Fläche im Becken, Schale, fallende Strahlen
    const wt = this.tex(waterTex(), true, 2);
    this.water.push(wt);
    const wm = this.mat({ map: wt, color: 0xa9cbd8, transparent: true, opacity: 0.86, emissive: new THREE.Color(0x1d3a48), depthWrite: false });
    const wgb = new GB();
    wgb.uv = true;
    const disc = (r0: number, n: number, yy: number, rot: number) => {
      for (let k = 0; k < n; k++) {
        const a0 = rot + (k / n) * Math.PI * 2, a1 = rot + ((k + 1) / n) * Math.PI * 2;
        const pa = [cx + Math.cos(a0) * r0, yy, cf + Math.sin(a0) * r0], pb = [cx + Math.cos(a1) * r0, yy, cf + Math.sin(a1) * r0];
        triN(wgb, P(cx, yy, cf), P(pa[0], yy, pa[2]), P(pb[0], yy, pb[2]), [0, 1, 0], WHITE, [cx / 2, cf / 2], [pa[0] / 2, pa[2] / 2], [pb[0] / 2, pb[2] / 2]);
      }
    };
    disc(R - 0.3, 8, y + 0.58, Math.PI / 8);
    disc(0.8, 20, y + 1.86, 0);
    const wg = wgb.build();
    this.dis.push(wg);
    this.local.add(new THREE.Mesh(wg, wm));
    const jt = this.tex(waterTex(true), true, 2);
    this.water.push(jt);
    const jm = this.mat({ map: jt, color: 0xeaf6fa, transparent: true, opacity: 1, emissive: new THREE.Color(0x24404c), depthWrite: false, side: THREE.DoubleSide });
    const jets = new GB();
    jets.uv = true;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      const dx = Math.cos(a), df = Math.sin(a);
      const pts: V[] = [];
      for (let i = 0; i <= 6; i++) {
        const u = i / 6;
        const rr = 0.64 + u * 0.55;
        pts.push(P(cx + dx * rr, y + 1.22 - u * u * 0.66, cf + df * rr));
      }
      for (let i = 0; i < 6; i++) {
        const w = 0.035 + i * 0.006;
        const a0 = pts[i], a1 = pts[i + 1];
        const ox = -df * w, oz = -dx * w;
        jets.quad([a0[0] + ox, a0[1], a0[2] + oz], [a0[0] - ox, a0[1], a0[2] - oz], [a1[0] - ox, a1[1], a1[2] - oz], [a1[0] + ox, a1[1], a1[2] + oz], WHITE,
          [[0, i / 6], [1, i / 6], [1, (i + 1) / 6], [0, (i + 1) / 6]]);
      }
    }
    // Überlauf der Schale: ein Wasservorhang rundherum
    for (let k = 0; k < 20; k++) {
      const a0 = (k / 20) * Math.PI * 2, a1 = ((k + 1) / 20) * Math.PI * 2;
      const p = (a: number, r: number, h: number) => P(cx + Math.cos(a) * r, y + h, cf + Math.sin(a) * r);
      jets.quad(p(a0, 0.86, 1.86), p(a1, 0.86, 1.86), p(a1, 0.95, 1.3), p(a0, 0.95, 1.3), WHITE, [[k / 5, 0], [(k + 1) / 5, 0], [(k + 1) / 5, 1], [k / 5, 1]]);
    }
    const jg = jets.build();
    this.dis.push(jg);
    this.local.add(new THREE.Mesh(jg, jm));
  }

  // ------------------------------------------------------------------ Café

  /** Café vor dem Laubengang rechts: drei Schirme mit Schrift, sechs Marmortische, Bistrostühle, Kübel, Tafel */
  private cafe(props: GB, smooth: MB) {
    const iron = lin('#2b2a2c');
    const marble = lin('#ece8e0');
    const rattan = lin('#a8834f');
    const weave = lin('#6e5232');
    const r = mulberry32((this.track.seed ^ 0xcafe) >>> 0);
    const tables = this.cafeTables();
    for (const [x, f] of tables) {
      const y = this.gy(x, f);
      smooth.add(new THREE.CylinderGeometry(0.33, 0.33, 0.03, 24), M4(x, y + 0.745, f), marble);
      smooth.add(new THREE.CylinderGeometry(0.335, 0.335, 0.012, 24), M4(x, y + 0.725, f), shade(marble, 0.8));
      smooth.add(new THREE.CylinderGeometry(0.03, 0.04, 0.7, 8), M4(x, y + 0.37, f), iron);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        rodS(smooth, P(x, y + 0.08, f), P(x + Math.cos(a) * 0.26, y + 0.02, f + Math.sin(a) * 0.26), 0.018, iron, 5);
      }
      // auf dem Tisch: Tassen, Gläser, Zuckerdose, Aschenbecher (nicht alle)
      if (r() < 0.8) smooth.add(new THREE.CylinderGeometry(0.035, 0.028, 0.06, 10), M4(x + 0.12, y + 0.79, f - 0.06), WHITE);
      if (r() < 0.6) smooth.add(new THREE.CylinderGeometry(0.036, 0.024, 0.07, 10), M4(x - 0.1, y + 0.83, f + 0.08), lin('#f0701f'));
      if (r() < 0.5) smooth.add(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8), M4(x, y + 0.79, f), lin('#cdbf9a'));
    }
    // Stühle (Lage und Blick zum Tisch kommen aus cafeSeats; leere Stühle dazu)
    for (const s of this.cafeSeats()) this.chair(smooth, s.x, s.f, s.yaw, rattan, weave, iron);
    // Schirme
    const pt = this.tex(parasolTex(this.cafeName()), false, 4);
    const pm = this.mat({ map: pt, side: THREE.DoubleSide });
    const pg = new GB();
    pg.uv = true;
    const bulbs: number[] = [];
    for (const [x, f] of this.parasols()) {
      const y = this.gy(x, f);
      const S = 1.55, ye = y + 2.28, ya = y + 2.86;
      const cs = [[-S, -S], [S, -S], [S, S], [-S, S]];
      const apex = P(x, ya, f);
      for (let k = 0; k < 4; k++) {
        const [ax, af] = cs[k], [bx, bf] = cs[(k + 1) % 4];
        pg.tri(apex, P(x + ax, ye, f + af), P(x + bx, ye, f + bf), WHITE, [0.5, 1], [0, 0.5], [1, 0.5]);
        // Volant mit Schrift
        pg.quad(P(x + ax, ye, f + af), P(x + bx, ye, f + bf), P(x + bx, ye - 0.26, f + bf), P(x + ax, ye - 0.26, f + af), WHITE, [[0, 0.5], [1, 0.5], [1, 0.375], [0, 0.375]]);
        for (let i = 1; i < 8; i++) {
          const u = i / 8;
          bulbs.push(x + ax + (bx - ax) * u, ye - 0.3, -(f + af + (bf - af) * u));
        }
        rodS(smooth, P(x, ya - 0.08, f), P(x + ax * 0.97, ye - 0.04, f + af * 0.97), 0.012, lin('#d8d2c4'), 4);
      }
      smooth.add(new THREE.CylinderGeometry(0.03, 0.03, 2.9, 8), M4(x, y + 1.45, f), lin('#d8d2c4'));
      box(props, x, y + 0.08, f, 0.5, 0.16, 0.5, lin('#9a948a'));
    }
    const g = pg.build();
    this.dis.push(g);
    this.local.add(new THREE.Mesh(g, pm));
    if (bulbs.length) {
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(bulbs, 3));
      this.dis.push(bg);
      this.local.add(new THREE.Points(bg, this.d.bulb));
    }
    // Pflanzkübel mit Buchs und Geranien als Grenze des Cafés, Tafel mit der Karte
    const f0 = this.pz0 + 7.4, f1 = this.pz0 + 30.6;
    for (const f of [f0, f1]) for (const x of [5.0, 6.6, 8.2]) this.planter(props, smooth, x, f, r);
    const mt = this.tex(menuTex(this.lang), false, 4);
    const mm = this.mat({ map: mt });
    const mg = new GB();
    mg.uv = true;
    const bx = 4.7, bf = this.pz0 + 19.2, by = this.gy(bx, bf);
    // Aufsteller: vordere Tafel zur Straße (−x), hintere zum Café (+x), oben aneinander
    const fa = bf - 0.28, fb = bf + 0.28, yt = by + 0.95;
    quadN(mg, P(bx - 0.26, by + 0.02, fa), P(bx - 0.26, by + 0.02, fb), P(bx, yt, fb), P(bx, yt, fa), [-1, 0.25, 0], WHITE, [[1, 0], [0, 0], [0, 1], [1, 1]]);
    quadN(mg, P(bx + 0.26, by + 0.02, fa), P(bx + 0.26, by + 0.02, fb), P(bx, yt, fb), P(bx, yt, fa), [1, 0.25, 0], WHITE, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    const mgg = mg.build();
    this.dis.push(mgg);
    this.local.add(new THREE.Mesh(mgg, mm));
  }

  private cafeName(): string {
    return this.lang === 'fr' ? 'Café de la Place' : this.lang === 'es' ? 'Café Central' : this.lang === 'en' ? 'Café Central' : 'Caffè Centrale';
  }

  /** Tische des Cafés (x, f) */
  private cafeTables(): [number, number][] {
    const f = this.pz0 + 9.6;
    return [[5.85, f], [8.15, f + 3.6], [5.85, f + 7.2], [8.15, f + 10.8], [5.85, f + 14.4], [8.15, f + 18.0]];
  }

  private parasols(): [number, number][] {
    const f = this.pz0 + 11.4;
    return [[7.0, f], [7.0, f + 7.2], [7.0, f + 14.4]];
  }

  /** Stühle: Lage, Blick zum Tisch, wer sitzt (Index in den Gästen oder −1) */
  private cafeSeats(): { x: number; f: number; yaw: number; t: number; a: number }[] {
    const out: { x: number; f: number; yaw: number; t: number; a: number }[] = [];
    const angs = [[-0.3, 2.6], [1.5, -1.9], [0.4, 3.0, -1.6], [2.2, -0.9], [-0.5, 2.5], [1.2, -2.0, 3.1]];
    this.cafeTables().forEach(([x, f], t) => {
      for (const a of angs[t]) {
        const sx = x + Math.sin(a) * 0.62, sf = f + Math.cos(a) * 0.62;
        out.push({ x: sx, f: sf, yaw: Math.atan2(x - sx, f - sf), t, a });
      }
    });
    return out;
  }

  /** Bistrostuhl (Rattan mit Eisenbeinen), Blick yaw */
  private chair(mb: MB, x: number, f: number, yaw: number, rattan: RGBf, weave: RGBf, iron: RGBf) {
    const y = this.gy(x, f);
    const m = M4(x, y, f, yaw);
    const put = (g: THREE.BufferGeometry, px: number, py: number, pz: number, col: RGBf, rx = 0) =>
      mb.add(g, new THREE.Matrix4().compose(V3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), V3(1, 1, 1)).premultiply(m), col);
    put(new THREE.BoxGeometry(0.42, 0.045, 0.4), 0, 0.455, 0.02, weave);
    put(new THREE.BoxGeometry(0.44, 0.03, 0.42), 0, 0.43, 0.02, rattan);
    for (const sx of [-0.18, 0.18]) for (const sz of [-0.16, 0.19]) put(new THREE.CylinderGeometry(0.014, 0.014, 0.43, 6), sx, 0.215, sz, iron);
    // Lehne: gebogener Rahmen und Geflecht
    put(new THREE.BoxGeometry(0.4, 0.3, 0.03), 0, 0.68, 0.22, weave, -0.12);
    for (const sx of [-0.2, 0.2]) put(new THREE.CylinderGeometry(0.016, 0.016, 0.42, 6), sx, 0.66, 0.22, rattan, -0.12);
    put(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 6).rotateZ(Math.PI / 2), 0, 0.86, 0.245, rattan);
  }

  private planter(props: GB, smooth: MB, x: number, f: number, r: () => number) {
    const y = this.gy(x, f);
    box(props, x, y + 0.27, f, 0.62, 0.54, 0.62, lin('#b4643c'));
    box(props, x, y + 0.55, f, 0.68, 0.05, 0.68, lin('#c4744a'));
    const green = lin('#3d6b33');
    for (let k = 0; k < 5; k++) {
      const a = r() * Math.PI * 2, d = r() * 0.16;
      smooth.add(new THREE.IcosahedronGeometry(0.2 + r() * 0.08, 1), M4(x + Math.cos(a) * d, y + 0.72 + r() * 0.15, f + Math.sin(a) * d), shade(green, 0.85 + r() * 0.3));
    }
    const fl = [lin('#d6303c'), lin('#ef5a7a'), lin('#f2f0ea')][Math.floor(r() * 3)];
    for (let k = 0; k < 7; k++) {
      const a = r() * Math.PI * 2, d = 0.12 + r() * 0.16;
      smooth.add(new THREE.IcosahedronGeometry(0.045, 0), M4(x + Math.cos(a) * d, y + 0.82 + r() * 0.2, f + Math.sin(a) * d), fl);
    }
  }

  // ------------------------------------------------------------------ Bühne des Sprechers

  private stage(props: GB, smooth: MB) {
    const x0 = 6.1, x1 = 8.7, f0 = this.z0 - 18.5, f1 = this.z0 - 14.5;
    const y = this.gy(7, (f0 + f1) / 2);
    const H = 0.95;
    box(props, (x0 + x1) / 2, y + H - 0.04, (f0 + f1) / 2, x1 - x0, 0.08, f1 - f0, lin('#3a3a3e'));
    // Verkleidung mit Werbung (vorn zur Straße), Seiten schwarz
    const st = this.tex(stageTex(this.lang, this.d.accent), false, 4);
    const sm = this.mat({ map: st });
    const sg = new GB();
    sg.uv = true;
    quadN(sg, P(x0, y, f0), P(x0, y, f1), P(x0, y + H - 0.08, f1), P(x0, y + H - 0.08, f0), [-1, 0, 0], WHITE, [[1, 0], [0, 0], [0, 0.42], [1, 0.42]]);
    // Rückwand mit Schrift (über der Bühne, zur Straße)
    const bx = x1 - 0.15;
    quadN(sg, P(bx, y + H, f0), P(bx, y + H, f1), P(bx, y + H + 2.1, f1), P(bx, y + H + 2.1, f0), [-1, 0, 0], WHITE, [[1, 0.45], [0, 0.45], [0, 1], [1, 1]]);
    const g = sg.build();
    this.dis.push(g);
    this.local.add(new THREE.Mesh(g, sm));
    const black = lin('#1d1d20');
    for (const f of [f0, f1]) box(props, (x0 + x1) / 2, y + (H - 0.08) / 2, f, x1 - x0, H - 0.08, 0.04, black);
    box(props, x1, y + (H - 0.08) / 2, (f0 + f1) / 2, 0.04, H - 0.08, f1 - f0, black);
    // Traverse der Rückwand, Lautsprecher auf Stativen, Pult
    const truss = lin('#b9bec5');
    for (const f of [f0 + 0.1, f1 - 0.1]) rodS(smooth, P(bx + 0.06, y + H, f), P(bx + 0.06, y + H + 2.3, f), 0.04, truss, 6);
    rodS(smooth, P(bx + 0.06, y + H + 2.3, f0 + 0.1), P(bx + 0.06, y + H + 2.3, f1 - 0.1), 0.04, truss, 6);
    for (const f of [f0 - 0.5, f1 + 0.5]) {
      const yy = this.gy(x0 + 0.5, f);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        rodS(smooth, P(x0 + 0.5, yy + 1.1, f), P(x0 + 0.5 + Math.cos(a) * 0.45, yy, f + Math.sin(a) * 0.45), 0.015, black, 5);
      }
      rodS(smooth, P(x0 + 0.5, yy + 1.1, f), P(x0 + 0.5, yy + 1.9, f), 0.02, black, 6);
      box(props, x0 + 0.5, yy + 2.25, f, 0.42, 0.62, 0.36, black, Math.PI / 2 + 0.25 * Math.sign(f - (f0 + f1) / 2));
    }
    box(props, x0 + 0.85, y + H + 0.55, (f0 + f1) / 2 + 0.9, 0.4, 1.1, 0.5, lin('#2a2a2e'));
    // Treppe hinten
    for (let k = 0; k < 4; k++) box(props, x1 + 0.2 + k * 0.28, y + (H - k * 0.24) / 2, f1 - 0.6, 0.3, H - k * 0.24, 0.9, lin('#4a4a4e'));
  }

  // ------------------------------------------------------------------ Vespas, Räder

  private scooters(props: GB, smooth: MB) {
    const cols = [lin('#98cdb9'), lin('#c8322b'), lin('#ece2c6')];
    const f0 = this.z0 - 11.5;
    cols.forEach((c, k) => this.vespa(smooth, 7.0 + (k % 2) * 0.3, f0 + k * 1.15, -2.2 + k * 0.08, c));
    // Rennräder am Geländer (Fans sind mit dem Rad gekommen)
    const rx = 8.95, rf = f0 + 4.4;
    const ry = this.gy(rx, rf);
    const iron = lin('#2b2a2c');
    box(props, rx + 0.12, ry + 0.82, rf + 1.6, 0.05, 0.05, 3.4, iron);
    for (const df of [0, 3.2]) box(props, rx + 0.12, ry + 0.41, rf + df, 0.05, 0.82, 0.05, iron);
    const gb = new GB();
    const frames = [lin('#e0559a'), lin('#1f6fb2'), lin('#f2f2ee'), lin('#151517')];
    for (let k = 0; k < 4; k++) bike(gb, M4(rx - 0.05, ry, rf + 0.35 + k * 0.78, -Math.PI / 2 + 0.2 * ((k % 2) * 2 - 1)), frames[k]);
    const g = gb.build();
    this.dis.push(g);
    this.local.add(new THREE.Mesh(g, this.d.props));
  }

  /** Vespa (Blick yaw): bauchiges Heck, Trittbrett, Beinschild, Lenker mit Scheinwerfer, kleine Räder */
  private vespa(mb: MB, x: number, f: number, yaw: number, col: RGBf) {
    const y = this.gy(x, f);
    const m = M4(x, y, f, yaw);
    const put = (g: THREE.BufferGeometry, px: number, py: number, pz: number, c: RGBf, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
      mb.add(g, new THREE.Matrix4().compose(V3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V3(sx, sy, sz)).premultiply(m), c);
    const sph = new THREE.SphereGeometry(1, 16, 10);
    const black = lin('#141416'), chrome = lin('#d6dadf'), seat = lin('#4a3424');
    put(sph, 0, 0.46, 0.38, col, 0.3, 0.26, 0.5);
    put(sph, 0, 0.74, 0.33, seat, 0.15, 0.065, 0.4);
    put(new THREE.BoxGeometry(0.3, 0.05, 0.62), 0, 0.21, -0.12, black);
    put(new THREE.BoxGeometry(0.42, 0.62, 0.05), 0, 0.52, -0.43, col, 1, 1, 1, -0.2);
    put(new THREE.CylinderGeometry(0.035, 0.04, 0.5, 8), 0, 0.88, -0.52, col, 1, 1, 1, -0.22);
    put(new THREE.CylinderGeometry(0.022, 0.022, 0.62, 8), 0, 1.1, -0.57, chrome, 1, 1, 1, 0, 0, Math.PI / 2);
    put(new THREE.BoxGeometry(0.2, 0.12, 0.12), 0, 1.11, -0.58, col);
    put(sph, 0, 1.12, -0.66, chrome, 0.065, 0.065, 0.04);
    put(sph, 0, 0.32, -0.62, col, 0.13, 0.15, 0.24);
    for (const z of [-0.62, 0.56]) {
      put(new THREE.TorusGeometry(0.155, 0.055, 8, 18), 0, 0.2, z, black, 1, 1, 1, 0, Math.PI / 2, 0);
      put(new THREE.CylinderGeometry(0.1, 0.1, 0.07, 12), 0, 0.2, z, chrome, 1, 1, 1, 0, 0, Math.PI / 2);
    }
    for (const s of [-1, 1]) put(sph, s * 0.29, 1.22, -0.55, chrome, 0.035, 0.05, 0.02);
    put(new THREE.BoxGeometry(0.06, 0.05, 0.03), 0, 0.62, 0.86, lin('#c0241b'));
    // Ständer
    put(new THREE.BoxGeometry(0.28, 0.02, 0.04), 0, 0.03, 0.18, black);
  }

  // ------------------------------------------------------------------ Markt, Kiosk, Bänke (links)

  private market(props: GB, smooth: MB) {
    const r = mulberry32((this.track.seed ^ 0x3a7c) >>> 0);
    const at = this.tex(awningTex(), true, 4);
    const am = this.mat({ map: at, side: THREE.DoubleSide });
    const aw = new GB();
    aw.uv = true;
    const wood = lin('#8a6440');
    const produce = [[lin('#f08a1c'), lin('#f3a53a')], [lin('#d9302a'), lin('#a8221d')], [lin('#f2d43a'), lin('#e8c62e')], [lin('#6aa83a'), lin('#4d8a2a')], [lin('#6a2f6e'), lin('#4a1f50')], [lin('#e8e0c8'), lin('#c9b98a')]];
    for (let k = 0; k < 3; k++) {
      const f = this.pz0 + 2.2 + k * 3.6, x = -6.9;
      const y = this.gy(x, f);
      // Tisch mit Kisten
      box(props, x + 0.25, y + 0.42, f, 1.0, 0.84, 2.8, shade(wood, 0.8));
      for (let c = 0; c < 6; c++) {
        const cx = x + 0.0 + (c % 2) * 0.5, cf = f - 1.0 + Math.floor(c / 2) * 1.0;
        box(props, cx, y + 0.92, cf, 0.46, 0.16, 0.8, wood, 0, -0.18);
        const pc = produce[Math.floor(r() * produce.length)];
        for (let q = 0; q < 10; q++) {
          smooth.add(new THREE.IcosahedronGeometry(0.05 + r() * 0.015, 0), M4(cx - 0.17 + r() * 0.34, y + 1.0 + r() * 0.05, cf - 0.32 + r() * 0.64), pc[Math.floor(r() * 2)]);
        }
      }
      // Pfosten, Markise (schräg zum Platz), Volant
      const iron = lin('#3a3a3e');
      for (const df of [-1.45, 1.45]) {
        box(props, x + 0.95, y + 1.05, f + df, 0.05, 2.1, 0.05, iron);
        box(props, x - 0.55, y + 1.22, f + df, 0.05, 2.44, 0.05, iron);
      }
      // Markise: hinten (Verkäufer) höher, vorn zum Platz tiefer; Volant an der Vorderkante. v: Band des Stands
      const yA = y + 2.1, yB = y + 2.5;
      const v0 = 1 - (k + 1) / 3 + 0.01, v1 = 1 - k / 3 - 0.01;
      quadN(aw, P(x + 1.0, yA, f - 1.55), P(x + 1.0, yA, f + 1.55), P(x - 0.8, yB, f + 1.55), P(x - 0.8, yB, f - 1.55), [0.3, 1, 0], WHITE, [[0, v0], [3.1, v0], [3.1, v1], [0, v1]]);
      quadN(aw, P(x + 1.0, yA, f - 1.55), P(x + 1.0, yA, f + 1.55), P(x + 1.0, yA - 0.28, f + 1.55), P(x + 1.0, yA - 0.28, f - 1.55), [1, 0, 0], WHITE, [[0, v1], [3.1, v1], [3.1, v0], [0, v0]]);
      // Waage und Preisschilder
      box(props, x - 0.1, y + 0.9, f + 1.15, 0.22, 0.14, 0.2, lin('#d8d8d4'));
      for (let c = 0; c < 3; c++) box(props, x - 0.27, y + 1.03, f - 1.0 + c, 0.01, 0.07, 0.11, WHITE, 0, 0);
    }
    const g = aw.build();
    this.dis.push(g);
    this.local.add(new THREE.Mesh(g, am));
  }

  private kiosk(props: GB, smooth: MB) {
    const x = -7.3, f = this.z0 - 3.5;
    const y = this.gy(x, f);
    const green = lin('#20503a');
    box(props, x, y + 1.25, f, 1.8, 2.5, 2.4, green);
    box(props, x + 0.1, y + 2.6, f, 2.3, 0.14, 2.9, shade(green, 0.85));
    box(props, x, y + 2.95, f, 1.7, 0.6, 2.2, shade(green, 1.1));
    // Front mit Zeitschriften (Textur), Schild darüber, Ständer davor
    const kt = this.tex(kioskTex(this.lang), false, 4);
    const km = this.mat({ map: kt });
    const kg = new GB();
    kg.uv = true;
    const xf = x + 0.91;
    quadN(kg, P(xf, y + 0.2, f - 1.1), P(xf, y + 0.2, f + 1.1), P(xf, y + 2.3, f + 1.1), P(xf, y + 2.3, f - 1.1), [1, 0, 0], WHITE, [[0, 0], [1, 0], [1, 0.72], [0, 0.72]]);
    quadN(kg, P(x + 0.86, y + 2.68, f - 1.1), P(x + 0.86, y + 2.68, f + 1.1), P(x + 0.86, y + 3.22, f + 1.1), P(x + 0.86, y + 3.22, f - 1.1), [1, 0, 0], WHITE, [[0, 0.75], [1, 0.75], [1, 1], [0, 1]]);
    const g = kg.build();
    this.dis.push(g);
    this.local.add(new THREE.Mesh(g, km));
    // Bank mit zwei Alten daneben (Menschen in locals)
    const bx = -6.2, bf = this.z0 - 8.2;
    const by = this.gy(bx, bf);
    const woodB = lin('#7a5230'), ir = lin('#26262a');
    for (let k = 0; k < 4; k++) box(props, bx + 0.05 - k * 0.11, by + 0.45, bf, 0.09, 0.035, 1.8, woodB);
    for (let k = 0; k < 3; k++) box(props, bx - 0.36, by + 0.62 + k * 0.12, bf, 0.035, 0.09, 1.8, woodB, 0, 0);
    for (const df of [-0.8, 0.8]) {
      box(props, bx - 0.12, by + 0.22, bf + df, 0.5, 0.44, 0.05, ir);
      box(props, bx - 0.36, by + 0.55, bf + df, 0.05, 0.6, 0.05, ir);
    }
    void smooth;
  }

  // ------------------------------------------------------------------ Laternen

  /** gusseiserne Kandelaber mit zwei Leuchten (abends ein warmer Schein) */
  private lamps(props: GB, smooth: MB) {
    const iron = lin('#25262a');
    const spots: [number, number][] = [];
    for (const sg of [-1, 1]) for (const f of [this.pz0 + 1.0, this.pz0 + 16, this.pz0 + 31]) spots.push([sg * (EDGE + 0.85), f]);
    spots.push([-3.6, -3.0], [3.6, -3.0], [-12, -3.2], [12, -3.2]);
    const glow: number[] = [];
    for (const [x, f] of spots) {
      const y = this.gy(x, f);
      smooth.add(new THREE.CylinderGeometry(0.16, 0.22, 0.5, 10), M4(x, y + 0.25, f), iron);
      smooth.add(new THREE.CylinderGeometry(0.06, 0.09, 3.6, 10), M4(x, y + 2.2, f), iron);
      smooth.add(new THREE.SphereGeometry(0.1, 10, 8), M4(x, y + 4.0, f), iron);
      for (const s of [-1, 1]) {
        const lx = x + s * 0.55;
        rodS(smooth, P(x, y + 3.75, f), P(lx, y + 3.95, f), 0.025, iron, 5);
        smooth.add(new THREE.CylinderGeometry(0.15, 0.09, 0.34, 6), M4(lx, y + 3.86, f), lin('#f2dcaa'));
        smooth.add(new THREE.ConeGeometry(0.2, 0.18, 6), M4(lx, y + 4.12, f), iron);
        glow.push(lx, y + 3.86, -f);
      }
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(glow, 3));
    this.dis.push(gg);
    this.local.add(new THREE.Points(gg, this.d.lantern));
    void props;
  }

  // ------------------------------------------------------------------ Fahnen, Startlinie

  /** rosa Fahnen über den Brüstungen der Laubengänge (zur Straße), nicht vor der Kirche */
  private banners() {
    const bt = this.tex(bannerTex(this.d.accent), false, 4);
    const bm = this.mat({ map: bt, side: THREE.DoubleSide });
    const gb = new GB();
    gb.uv = true;
    const xb = EDGE + 8.5 - 3.0 - 0.18;
    for (const sg of [-1, 1]) {
      for (let f = this.pz0 + 3.5; f < this.pz1 - 2; f += 7.2) {
        if (sg < 0 && f > this.church[0] - 2 && f < this.church[1] + 2) continue;
        const y = this.gy(sg * xb, f);
        const x = sg * xb;
        const w = 0.55;
        const pts = [P(x, y + 2.2, f - w), P(x, y + 2.2, f + w), P(x, y + 4.55, f + w), P(x, y + 4.55, f - w)];
        quadN(gb, pts[0], pts[1], pts[2], pts[3], [-sg, 0, 0], WHITE, sg > 0 ? [[1, 0], [0, 0], [0, 1], [1, 1]] : [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
    }
    const g = gb.build();
    this.dis.push(g);
    this.local.add(new THREE.Mesh(g, bm));
  }

  /** Startlinie und Schrift auf der Fahrbahn (von hinten lesbar) */
  private startLine() {
    const lt = this.tex(lineTex(this.track.lang === 'fr' ? 'DÉPART' : this.track.lang === 'es' ? 'SALIDA' : this.track.lang === 'en' ? 'START' : 'PARTENZA', this.d.accent), false, Math.max(8, this.d.aniso));
    const lm = this.mat({ map: lt, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const gb = new GB();
    gb.uv = true;
    const f0 = this.z0 + 0.75, f1 = f0 + 7.5;
    const xh = ROAD_HALF - 0.12;
    const n = 6;
    for (let k = 0; k < n; k++) {
      const fa = f0 + (f1 - f0) * (k / n), fb = f0 + (f1 - f0) * ((k + 1) / n);
      const ya = this.road(fa) + 0.012, yb = this.road(fb) + 0.012;
      quadN(gb, P(-xh, ya, fa), P(xh, ya, fa), P(xh, yb, fb), P(-xh, yb, fb), [0, 1, 0], WHITE, [[0, k / n], [1, k / n], [1, (k + 1) / n], [0, (k + 1) / n]]);
    }
    const g = gb.build();
    this.dis.push(g);
    this.lineG.add(new THREE.Mesh(g, lm));
  }

  // ------------------------------------------------------------------ Menschen

  private add(look: Look, act: Act, x: number, f: number, look2: [number, number], opts: { y?: number; watch?: boolean; follow?: boolean; lod?: 'near' | 'mid' | 'far'; seed?: number; cheer?: boolean; seated?: boolean } = {}) {
    // Detailstufe: nah am Fahrer (Kran, Startkamera) voll, auf der Piazza einfacher
    const dr = Math.hypot(x - 0.9, f - this.z0);
    const lod = this.d.pc ? 'near' : opts.lod ?? (dr < 8 ? 'near' : dr < 20 ? 'mid' : 'far');
    const h = new Human(look, opts.seed ?? (x * 13.7 + f * 3.1), lod === 'near' ? 1 : 0, lod === 'far');
    h.act = act;
    h.seated = !!opts.seated;
    const y = opts.y ?? this.gy(x, f);
    const yaw = Math.atan2(look2[0] - x, look2[1] - f);
    this.people.push({
      h, x, f, y, yaw, watch: opts.watch ?? true, follow: opts.follow, tick: this.people.length, base: act,
      cheer: opts.cheer ?? false, partner: -1, head: new THREE.Vector3(),
    });
    this.root.add(h.group);
    return this.people.length - 1;
  }

  private carry(i: number, geo: THREE.BufferGeometry, mode: 'hands' | 'right' | 'shoulder') {
    this.people[i].h.carry(new THREE.Mesh(geo, this.d.gear), mode);
  }

  /** Personal am Start: Starter, Kommissäre, Fotografen, Kameramann, Polizei, Sprecher auf der Bühne */
  private staff() {
    const r = mulberry32((this.track.seed ^ 0x5eed) >>> 0);
    const z = this.z0;
    const pg = propGeometries();
    const rider: [number, number] = [0.9, z];
    const starter = this.add(lookFor(r, 'official'), 'stand', -2.35, z + 1.1, rider);
    this.people[starter].role = 'starter';
    this.carry(this.add(lookFor(r, 'official'), 'hands', 2.55, z - 0.6, rider), pg.watch, 'hands');
    this.add(lookFor(r, 'official'), 'talk', 3.05, z - 2.1, [2.4, z + 0.6], { cheer: true });
    const ph = [
      this.add(lookFor(r, 'photographer'), 'kneel', -2.2, z + 4.6, rider, { follow: true }),
      this.add(lookFor(r, 'photographer'), 'photo', 2.3, z + 5.4, rider, { follow: true }),
      this.add(lookFor(r, 'photographer'), 'photo', -2.6, z + 6.8, rider, { follow: true }),
    ];
    ph.forEach((i, k) => this.carry(i, k === 2 ? pg.tele : pg.camera, 'hands'));
    this.carry(this.add(lookFor(r, 'tv'), 'tv', 2.45, z + 2.6, rider, { follow: true }), pg.tvcam, 'shoulder');
    this.add(lookFor(r, 'police'), 'back', -3.55, z - 6.5, [0, z - 6]);
    this.add(lookFor(r, 'police'), 'back', 3.55, z + 9.5, [0, z + 9]);
    // Sprecher auf der Bühne (Mikrofon), schaut zum Fahrer
    const sx = 6.6, sf = this.z0 - 16.5;
    const sp = this.add({ ...lookFor(r, 'official'), accent: this.d.accent, print: 'SPEAKER', badge: true }, 'speak', sx, sf, [0, sf], { y: this.gy(sx, sf) + 0.95, lod: 'mid' });
    this.people[sp].role = 'speaker';
    this.carry(sp, pg.mic, 'right');
    // Blitze der Fotografen
    const fmat = new THREE.SpriteMaterial({ map: this.d.glow, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.dis.push(fmat);
    for (const i of ph) {
      const s = new THREE.Sprite(fmat);
      s.scale.setScalar(0.9);
      s.visible = false;
      this.root.add(s);
      this.flashes.push({ s, t: 0, next: 0.5 + r() * 3, who: i });
    }
  }

  /** Leute im Ort: Gäste und Kellner im Café, Marktleute, zwei Alte auf der Bank, Spaziergänger */
  private locals() {
    const r = mulberry32((this.track.seed ^ 0x10ca1) >>> 0);
    const pg = propGeometries();
    const loc = () => lookFor(r, 'local');
    // Gäste: je Stuhl, nicht alle besetzt
    const seats = this.cafeSeats();
    const plan: (Act | null)[] = ['drink', 'talk', 'read', null, 'talk', 'drink', null, null, null, 'talk', 'drink', null, 'drink', null, null];
    const atTable = new Map<number, number[]>();
    seats.forEach((s, k) => {
      const act = plan[k] ?? null;
      if (!act) return;
      const [tx, tf] = this.cafeTables()[s.t];
      const i = this.add(loc(), act, s.x, s.f, [tx, tf], { watch: false, lod: 'far', seated: true, cheer: act !== 'read' });
      if (act === 'drink') this.carry(i, r() < 0.5 ? pg.cup : pg.glass, 'right');
      if (act === 'read') this.carry(i, pg.paper, 'hands');
      const l = atTable.get(s.t) ?? [];
      l.push(i);
      atTable.set(s.t, l);
    });
    for (const l of atTable.values()) if (l.length > 1) for (let k = 0; k < l.length; k++) this.people[l[k]].partner = l[(k + 1) % l.length];
    // Kellner: aus dem Laubengang zu den Tischen und zurück, mit Tablett
    const waiter: Look = {
      female: false, skin: '#e3b896', hair: '#2e2018', long: false, bun: false, hat: 'none', hatCol: '#000000', glasses: false,
      clothes: 'waiter', top: '#17171a', accent: '#f6f6f2', pants: '#141416', shoes: '#111113', sleeves: true, height: 1.0,
    };
    const tb = this.cafeTables();
    const wf = this.pz0 + 13;
    const w = this.add(waiter, 'walk', 10.6, wf, [0, wf], { watch: false, lod: 'far' });
    this.people[w].h.tray = true;
    this.carry(w, pg.tray, 'right');
    this.people[w].walk = {
      pts: [[10.6, wf], [9.6, wf + 1.6], [7.0, tb[1][1] - 0.9], [6.9, tb[2][1] - 0.9], [7.0, tb[4][1] - 1.0], [9.7, tb[5][1] - 1.2], [10.6, tb[5][1] + 1.5], [11.0, wf + 8]],
      v: 1.15, s: 0, seg: 0, wait: 3.2, stops: new Set([3, 4, 7]), pause: 0, act: 'walk',
    };
    // Marktleute hinter den Ständen, Kunden davor
    for (let k = 0; k < 3; k++) {
      const f = this.pz0 + 2.2 + k * 3.6;
      const vend: Look = { ...loc(), clothes: 'apron', accent: ['#2f6a3a', '#1f3f73', '#7a2a2a'][k], sleeves: r() < 0.6 };
      const v = this.add(vend, k === 1 ? 'talk' : 'hands', -7.75, f + (r() - 0.5), [-5, f], { watch: false, cheer: true, lod: 'far' });
      if (k !== 1) this.people[v].partner = this.add(loc(), k === 0 ? 'talk' : 'hips', -5.55, f + (r() - 0.5) * 1.2, [-7, f], { watch: false, cheer: true, lod: 'far' });
    }
    // Bank: zwei Alte (sitzen, reden, schauen zum Start)
    const bx = -6.2, bf = this.z0 - 8.2;
    for (const df of [-0.45, 0.45]) {
      const old: Look = { ...loc(), female: false, long: false, bun: false, hair: r() < 0.5 ? '#d8d6d0' : '#8c8c8c', glasses: true, clothes: r() < 0.5 ? 'knit' : 'check', pants: '#4b4a46' };
      this.add(old, df < 0 ? 'talk' : 'sit', bx - 0.12, bf + df, [bx + 2, bf], { y: this.gy(bx, bf) - 0.04, seated: true, cheer: true, lod: 'far' });
    }
    // Spaziergänger: unter dem rechten Laubengang, links über den Platz
    const walkers: { pts: [number, number][]; v: number }[] = [
      { pts: [[10.9, this.pz0 + 2], [10.9, this.pz1 - 4]], v: 1.05 },
      { pts: [[-5.4, this.pz0 + 14], [-8.6, this.church[0] - 1], [-8.4, this.z0 - 12], [-5.6, this.z0 - 14]], v: 0.95 },
      { pts: [[11.2, this.pz1 - 8], [11.2, this.pz0 + 6]], v: 1.2 },
      { pts: [[-9.2, -2.2], [9.2, -2.2]], v: 1.0 },
    ];
    walkers.forEach((wk, k) => {
      const [x, f] = wk.pts[0];
      const i = this.add(loc(), 'walk', x, f, wk.pts[1], { watch: false, lod: 'far', seed: 40 + k * 17 });
      this.people[i].walk = { pts: wk.pts, v: wk.v, s: 0, seg: 0, wait: 2 + k, stops: new Set(wk.pts.length === 2 ? [0, 1] : [2]), pause: k * 1.7, act: 'walk' };
    });
  }

  /** Mensch an seinen Ort, Blick in seine Richtung (yaw: Startkoordinaten, 0 = nach vorn) */
  private place(i: number) {
    const p = this.people[i];
    this.world(p.x, p.y, p.f, p.h.group.position);
    p.h.group.rotation.y = -this.W0.th - p.yaw;
  }

  // ------------------------------------------------------------------ Tauben

  /** Tauben auf dem Platz und auf der Straße vor dem Start: picken und trippeln, fliegen beim Start auf */
  private makePigeons() {
    const r = mulberry32((this.track.seed ^ 0xb1d5) >>> 0);
    const n = 26;
    for (let k = 0; k < n; k++) {
      let x: number, f: number;
      if (k < 9) { x = (r() - 0.5) * 4.6; f = this.z0 + 9 + r() * 12; }
      else if (k < 17) { x = 6.4 + r() * 2.2; f = this.z0 - 4 + r() * 10; }
      else { x = -(5.5 + r() * 3.5); f = this.z0 + 0.5 + r() * 7.5; }
      this.pigeons.push({ x, y: this.gy(x, f), f, yaw: r() * Math.PI * 2, state: 0, vx: 0, vy: 0, vf: 0, flap: r() * 10, peck: r() * 5, delay: 0, t: r() * 10 });
    }
    const body = new MB();
    const grey = lin('#7d8594'), dark = lin('#565e6c'), neck = lin('#4e6e5e'), beak = lin('#d9c9a4'), leg = lin('#c46a6a'), white = lin('#c9ced6');
    const sph = new THREE.SphereGeometry(1, 10, 8);
    const T = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0) => new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), V3(sx, sy, sz));
    body.add(sph, T(0, 0.13, 0.01, 0.075, 0.07, 0.15, 0.15), grey);
    body.add(sph, T(0, 0.15, 0.03, 0.06, 0.05, 0.1, 0.1), white);
    body.add(sph, T(0, 0.205, -0.1, 0.05, 0.06, 0.055, -0.4), neck);
    body.add(sph, T(0, 0.255, -0.13, 0.038, 0.038, 0.042), dark);
    body.add(new THREE.ConeGeometry(0.009, 0.035, 6).rotateX(-Math.PI / 2), T(0, 0.25, -0.18, 1, 1, 1), beak);
    body.add(new THREE.BoxGeometry(0.08, 0.012, 0.13), T(0, 0.12, 0.17, 1, 1, 1, -0.25), dark);
    for (const s of [-1, 1]) body.add(new THREE.CylinderGeometry(0.005, 0.005, 0.07, 4), T(s * 0.025, 0.035, 0.01, 1, 1, 1), leg);
    const bg = body.build();
    // Flügel: flach, an der Schulter (Ursprung) nach außen (+x), Spitze nach hinten
    const wing = (sg: number) => {
      const g = new THREE.BufferGeometry();
      const w = [0, 0, -0.04, sg * 0.1, 0, -0.06, sg * 0.3, 0, 0.06, sg * 0.18, 0, 0.12, 0, 0, 0.08];
      const idx = sg > 0 ? [0, 1, 4, 1, 2, 3, 1, 3, 4] : [0, 4, 1, 1, 3, 2, 1, 4, 3];
      g.setAttribute('position', new THREE.Float32BufferAttribute(w, 3));
      const c: number[] = [];
      for (let i = 0; i < 5; i++) { const cc = i === 2 || i === 3 ? dark : grey; c.push(cc[0], cc[1], cc[2]); }
      g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const wm = this.mat({ vertexColors: true, side: THREE.DoubleSide });
    this.pigBody = new THREE.InstancedMesh(bg, this.d.gear, n);
    this.pigWing = [new THREE.InstancedMesh(wing(-1), wm, n), new THREE.InstancedMesh(wing(1), wm, n)];
    this.dis.push(bg, this.pigWing[0].geometry, this.pigWing[1].geometry);
    for (const m of [this.pigBody, ...this.pigWing]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      this.root.add(m);
    }
  }

  private updatePigeons(dt: number, p: { x: number; z: number; v: number }, go: boolean) {
    if (!this.pigBody) return;
    const th = this.W0.th;
    const pos = this.tmp;
    let k = 0;
    for (const b of this.pigeons) {
      b.t += dt;
      if (b.state === 0) {
        // Aufschrecken: beim Start die Tauben nahe am Fahrer (gestaffelt), sonst wenn er nahe kommt
        const dist = Math.hypot(b.x - p.x, b.f - p.z);
        if (b.delay <= 0 && ((go && dist < 16) || dist < 4.5 + p.v * 0.35)) b.delay = dist < 6 ? 0.02 + Math.random() * 0.12 : 0.1 + Math.random() * 0.9;
        if (b.delay > 0) {
          b.delay -= dt;
          if (b.delay <= 0) {
            b.state = 1;
            const away = Math.atan2(b.x - p.x, b.f - p.z) + (Math.random() - 0.5) * 1.2;
            const sp = 3.5 + Math.random() * 3;
            b.vx = Math.sin(away) * sp;
            b.vf = Math.cos(away) * sp + 2;
            b.vy = 2.6 + Math.random() * 1.8;
            b.yaw = Math.atan2(b.vx, b.vf);
          }
        }
        // Picken, ab und zu ein paar Schritte
        b.peck -= dt;
        if (b.peck < -0.5) {
          b.peck = 0.5 + Math.random() * 2.5;
          b.yaw += (Math.random() - 0.5) * 1.6;
        }
        if (b.peck > 0 && b.peck < 0.4) {
          b.x += Math.sin(b.yaw) * dt * 0.35;
          b.f += Math.cos(b.yaw) * dt * 0.35;
        }
      } else {
        // Flug: kräftig steigen, beschleunigen, sanft kurven; über den Dächern verschwinden
        b.vy = Math.max(0.6, b.vy - dt * 0.35);
        const sp = Math.hypot(b.vx, b.vf);
        const want = Math.min(11, sp + dt * 2.5);
        const turn = Math.sin(b.t * 0.7 + b.flap) * 0.4 * dt;
        const a = Math.atan2(b.vx, b.vf) + turn;
        b.vx = Math.sin(a) * want;
        b.vf = Math.cos(a) * want;
        b.x += b.vx * dt;
        b.f += b.vf * dt;
        b.y = Math.max(this.gy(b.x, b.f), b.y + b.vy * dt);
        b.yaw = a;
      }
      const flying = b.state === 1 && b.y < 40;
      const gone = b.state === 1 && b.y >= 40;
      this.world(b.x, b.y, b.f, pos);
      const pitch = b.state === 0 ? (b.peck > 0.4 && b.peck < 0.9 ? 0.5 * Math.sin((b.peck - 0.4) * Math.PI * 6) ** 2 : 0) : -0.25;
      this.e.set(pitch, -th - b.yaw, 0, 'YXZ');
      this.q.setFromEuler(this.e);
      const sc = gone ? 0 : 1;
      this.s3.set(sc, sc, sc);
      this.m4.compose(pos, this.q, this.s3);
      this.pigBody.setMatrixAt(k, this.m4);
      // Flügel: am Boden angelegt, im Flug schlagend
      b.flap += dt * (flying ? 15 : 0);
      for (let s = 0; s < 2; s++) {
        const sg = s ? 1 : -1;
        const folded = !flying;
        const beat = folded ? 0 : Math.sin(b.flap) * 1.0 + 0.25;
        const sweep = folded ? 1.25 : 0.15;
        const m = this.mW.copy(this.m4);
        this.mOff.makeTranslation(sg * 0.045, 0.165, -0.02);
        this.eW.set(0, sg * sweep, sg * (folded ? -0.15 : beat), 'YXZ');
        this.mRot.makeRotationFromEuler(this.eW);
        m.multiply(this.mOff).multiply(this.mRot);
        this.pigWing[s].setMatrixAt(k, m);
      }
      k++;
    }
    this.pigBody.instanceMatrix.needsUpdate = true;
    for (const w of this.pigWing) w.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ Laufzeit

  /** je Bild: Menschen, Tauben, Uhr, Wasser, Fahnen, Blitze, Abendlicht */
  update(g: RaceView, dt: number, cam: THREE.Camera) {
    const p = g.p;
    const phase = g.phase as string;
    const near = p.z < 300 || phase === 'ready' || phase === 'countdown';
    this.root.visible = near;
    if (!near) return;
    this.time += dt;
    if (phase !== this.lastPhase) {
      if (phase === 'playing' && (this.lastPhase === 'countdown' || this.lastPhase === '')) this.goT = 0;
      if (phase === 'ready' || phase === 'countdown') this.goT = -1;
      this.lastPhase = phase;
    }
    const waiting = phase === 'ready' || phase === 'countdown';
    if (this.goT >= 0) this.goT += dt;
    const go = this.goT >= 0 && this.goT < 8;
    this.world(p.x, 1.55, p.z, this.riderHead);
    const camPos = cam.position;
    const tmp = this.tmp;
    // Kamera in Startkoordinaten (Streckenmeter): beim Losfahren liegt alles hinter ihr – nicht mehr zeichnen
    const th = this.W0.th;
    const camF = (camPos.x - this.W0.x) * Math.sin(th) - (camPos.z - this.W0.z) * Math.cos(th);
    const away = phase === 'playing' && camF > this.z0 + 2;
    this.local.visible = !away;
    this.lineG.visible = !(phase === 'playing' && camF > this.z0 + 9);
    for (let i = 0; i < this.people.length; i++) {
      const s = this.people[i];
      const h = s.h;
      // Ferne: unsichtbar bzw. seltener bewegt
      this.world(s.x, s.y + 1, s.f, tmp);
      const dist = tmp.distanceTo(camPos);
      const pc = !!this.d.pc;
      const vis = dist < (pc ? 140 : 85) && !(phase === 'playing' && s.f < camF - 3);
      h.group.visible = vis;
      if (!vis) continue;
      s.tick++;
      // (PC-Grafik: alle in jedem Bild bewegt)
      const every = pc ? 1 : dist > 70 ? 4 : dist > 40 ? 2 : 1;
      if (s.walk) this.walk(s, dt, i);
      if (s.tick % every !== 0 && !s.walk) continue;
      const sdt = dt * (s.walk ? 1 : every);
      if (s.role === 'starter') h.act = phase === 'countdown' ? 'starter' : this.goT >= 0 && this.goT < 3 ? 'clap' : 'stand';
      // Blick: Personal und Neugierige zum Fahrer, sobald es losgeht alle in der Nähe; sonst zum Gegenüber
      const close = Math.abs(p.z - s.f) < 45;
      const busy = s.base === 'read' || s.base === 'kneel' || s.base === 'photo' || s.base === 'tv';
      if (close && !busy && (s.watch || phase === 'countdown' || go) && !s.walk) h.lookAt = this.riderHead;
      else if (s.partner >= 0) h.lookAt = this.people[s.partner].head;
      else h.lookAt = null;
      // beim Start: klatschen (auch im Sitzen), danach wieder wie vorher
      if (!s.walk && !s.role) h.act = s.cheer && this.goT > 0.25 && this.goT < 4.5 ? 'clap' : s.base;
      if (s.follow) {
        const want = Math.atan2(p.x - s.x, p.z + 0.5 - s.f);
        let d = want - s.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        s.yaw += Math.max(-1.2, Math.min(1.2, d)) * Math.min(1, sdt * 4);
        this.place(i);
      }
      h.update(sdt);
      s.head.copy(h.group.position);
      s.head.y += h.seated ? 1.18 : 1.6;
    }
    // Uhr (echte Uhrzeit), Zifferblatt und Laternen am Abend
    const night = this.d.night();
    if (this.dialMat) this.dialMat.emissiveIntensity = 0.15 + night * 0.85;
    const now = new Date();
    const min = now.getHours() * 60 + now.getMinutes();
    if (this.hands && min !== this.clockMin) {
      this.clockMin = min;
      this.hands.m.rotation.z = -((min % 60) / 60) * Math.PI * 2;
      this.hands.h.rotation.z = -(((min / 60) % 12) / 12) * Math.PI * 2;
    }
    // Wasser läuft
    for (let k = 0; k < this.water.length; k++) {
      const w = this.water[k];
      if (k === 0) { w.offset.x = this.time * 0.03; w.offset.y = this.time * 0.02; } else w.offset.y = -this.time * 1.4;
    }
    // Fahnen wehen
    for (const fl of this.flags) {
      const a = fl.geo.getAttribute('position') as THREE.BufferAttribute;
      const b = fl.base;
      for (let i = 0; i < a.count; i++) {
        const x = b[i * 3], y = b[i * 3 + 1];
        const u = Math.abs(x / fl.w);
        a.setXYZ(i, x * (1 - 0.04 * u), y - u * u * 0.06 + Math.sin(this.time * 3.1 + x * 4 + fl.ph) * 0.02 * u, Math.sin(this.time * 4.2 - x * 5.5 + fl.ph) * 0.11 * u);
      }
      a.needsUpdate = true;
      fl.geo.computeVertexNormals();
    }
    this.updatePigeons(dt, { x: p.x, z: p.z, v: p.v }, go);
    // Blitze: beim Warten ab und zu, eine Salve bei „Los“, Serien, wenn der Fahrer vorbeikommt
    for (const fl of this.flashes) {
      const ph = this.people[fl.who];
      if (fl.t > 0) { fl.t -= dt; if (fl.t <= 0) fl.s.visible = false; }
      fl.next -= dt;
      const gap = ph.f - p.z;
      if (phase === 'playing' && this.goT >= 0 && this.goT < 0.5 && fl.next > 0.6) fl.next = Math.random() * 0.4;
      if (fl.next <= 0) {
        const closeBy = phase === 'playing' && gap > -3 && gap < 11;
        fl.next = closeBy ? 0.25 + Math.random() * 0.3 : waiting ? 1.6 + Math.random() * 4 : 3 + Math.random() * 5;
        if (phase === 'playing' && gap < -3) fl.next = 1e9;
        fl.t = 0.07;
        fl.s.visible = ph.h.group.visible;
        fl.s.scale.setScalar(0.7 + Math.random() * 0.4);
        ph.h.props.getWorldPosition(fl.s.position);
        fl.s.position.y += 0.14;
      }
    }
  }

  /** Gehende: am Weg entlang, an Haltepunkten kurz stehen bleiben (Kellner am Tisch) */
  private walk(s: Person, dt: number, i: number) {
    const w = s.walk!;
    const h = s.h;
    if (w.pause > 0) {
      w.pause -= dt;
      h.act = s.h.tray ? 'talk' : 'stand';
      h.speed = 0;
      if (w.pause <= 0) h.act = 'walk';
      return;
    }
    const n = w.pts.length;
    const closed = n > 2;
    const a = w.pts[w.seg];
    const bi = closed ? (w.seg + 1) % n : (w.seg === 0 ? 1 : 0);
    const b = w.pts[bi];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    w.s += w.v * dt;
    if (w.s >= L) {
      w.s = 0;
      w.seg = bi;
      if (w.stops.has(bi)) w.pause = w.wait * (0.7 + Math.random() * 0.6);
    }
    const k = Math.min(1, w.s / L);
    s.x = a[0] + (b[0] - a[0]) * k;
    s.f = a[1] + (b[1] - a[1]) * k;
    s.y = this.gy(s.x, s.f);
    const want = Math.atan2(b[0] - a[0], b[1] - a[1]);
    let d = want - s.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    s.yaw += d * Math.min(1, dt * 5);
    h.act = 'walk';
    h.speed = w.v;
    this.place(i);
  }

  dispose() {
    this.root.removeFromParent();
    for (const x of this.dis) x.dispose();
    this.dis = [];
    for (const s of this.people) s.h.dispose();
    this.people = [];
    this.pigBody?.dispose();
    for (const w of this.pigWing) w.dispose();
  }
}

// ------------------------------------------------------------------ Texturen

/**
 * Porphyrpflaster im Pfauenschwanzmuster (Sampietrini in Fächern, die untere Reihe überdeckt die obere wie Schuppen):
 * 3,2 m je Kachel, nahtlos. Steine grau-violett bis rötlich mit Kantenlicht, dunkle Sandfugen, etwas Abnutzung.
 */
function floorTex(): HTMLCanvasElement {
  const S = 1024, M = 3.2, px = S / M;
  const { cv, c } = canvas(S, S);
  const r = mulberry32(911);
  c.fillStyle = '#433d38';
  c.fillRect(0, 0, S, S);
  const W = 1.6, R = W / Math.SQRT2, rowH = W / 2, ST = 0.092, gap = 0.011;
  const rows = Math.round(M / rowH);
  for (let j = -1; j <= rows + 1; j++) {
    const cy = j * rowH;
    const off = j & 1 ? W / 2 : 0;
    for (let i = -1; i <= Math.ceil(M / W) + 1; i++) {
      const cx = i * W + off;
      const nk = Math.floor(R / ST);
      for (let k = nk; k >= 1; k--) {
        const r0 = (k - 1) * ST + gap / 2, r1 = k * ST - gap / 2;
        const rm = (r0 + r1) / 2;
        const n = Math.max(2, Math.round((Math.PI * rm) / ST));
        const da = Math.PI / n;
        const ga = gap / 2 / Math.max(0.03, rm);
        for (let q = 0; q < n; q++) {
          const a0 = Math.PI + q * da + ga, a1 = Math.PI + (q + 1) * da - ga;
          const h = 8 + r() * 22, s = 6 + r() * 16, l = 31 + r() * 15 + (r() < 0.06 ? 8 : 0);
          c.fillStyle = `hsl(${h},${s}%,${l}%)`;
          c.beginPath();
          const X = (a: number, rr: number) => (cx + Math.cos(a) * rr) * px;
          const Y = (a: number, rr: number) => (cy + Math.sin(a) * rr) * px;
          // Stein mit leicht gerundeten Ecken (Bogen außen und innen)
          c.moveTo(X(a0, r0), Y(a0, r0));
          c.arc(cx * px, cy * px, r1 * px, a0, a1);
          c.arc(cx * px, cy * px, r0 * px, a1, a0, true);
          c.closePath();
          c.fill();
          // Kantenlicht oben, Schatten unten
          c.strokeStyle = `rgba(255,240,225,${0.1 + r() * 0.08})`;
          c.lineWidth = 1.4;
          c.beginPath();
          c.arc(cx * px, cy * px, r1 * px - 1, a0 + 0.02, a1 - 0.02);
          c.stroke();
          c.strokeStyle = 'rgba(0,0,0,0.22)';
          c.beginPath();
          c.arc(cx * px, cy * px, r0 * px + 1, a0 + 0.02, a1 - 0.02);
          c.stroke();
        }
      }
    }
  }
  // Abnutzung: helle und dunkle Wolken (nahtlos: um die Ränder gespiegelt), feines Korn
  for (let k = 0; k < 40; k++) {
    const x = r() * S, y = r() * S, rad = 40 + r() * 140;
    const dark = r() < 0.5;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const g = c.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      g.addColorStop(0, dark ? 'rgba(0,0,0,0.07)' : 'rgba(255,245,230,0.06)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
  const img = c.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 14;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  c.putImageData(img, 0, 0);
  return cv;
}

/**
 * Turm (1024 × 1024): links die Vorderseite (Bossenwerk, Portal mit Holztor, Inschrift, Wappen, Zwillingsfenster,
 * Platz für die Uhr, Glockenstube), rechts die Seiten (Mauerwerk, Schlitzfenster, Glockenstube).
 */
function towerTex(lang: string, name: string): HTMLCanvasElement {
  const S = 1024;
  const { cv, c } = canvas(S, S);
  const r = mulberry32(4242);
  const H = 25.4;
  // Vorderseite: x von +4,6 (links im Bild) bis −4,6; Seite: Breite 9,2 m
  const region = (u0: number, front: boolean) => {
    const X = (m: number) => u0 + (m / 9.2) * 512;   // m: von links im Bild
    const Y = (y: number) => S - (y / H) * S;
    // Mauerwerk: Kalkstein in unregelmäßigen Lagen
    c.fillStyle = '#d6cbb3';
    c.fillRect(u0, 0, 512, S);
    let y = 6.0;
    while (y < 21) {
      const hgt = 0.32 + r() * 0.22;
      let x = 0;
      while (x < 9.2) {
        const w = 0.55 + r() * 0.9;
        const l = 70 + r() * 14;
        c.fillStyle = `hsl(${36 + r() * 10},${18 + r() * 12}%,${l}%)`;
        c.fillRect(X(x) + 1, Y(y + hgt) + 1, X(x + w) - X(x) - 2, Y(y) - Y(y + hgt) - 2);
        x += w;
      }
      y += hgt;
    }
    // Bossenwerk unten (große Quader mit Fasen)
    y = 0;
    let row = 0;
    while (y < 6.0) {
      const hgt = 0.6;
      let x = row % 2 ? -0.6 : 0;
      while (x < 9.2) {
        const w = 1.2;
        const x0 = X(Math.max(0, x)), x1 = X(Math.min(9.2, x + w));
        const y0 = Y(y + hgt), y1 = Y(y);
        c.fillStyle = `hsl(${38 + r() * 8},${12 + r() * 8}%,${72 + r() * 8}%)`;
        c.fillRect(x0 + 2, y0 + 2, x1 - x0 - 4, y1 - y0 - 4);
        c.fillStyle = 'rgba(255,255,255,0.18)';
        c.fillRect(x0 + 2, y0 + 2, x1 - x0 - 4, 3);
        c.fillStyle = 'rgba(0,0,0,0.2)';
        c.fillRect(x0 + 2, y1 - 5, x1 - x0 - 4, 3);
        x += w;
      }
      y += hgt;
      row++;
    }
    // Alter: Regenspuren und Flecken
    for (let k = 0; k < 26; k++) {
      const x = u0 + r() * 512, yy = r() * S * 0.8;
      const g = c.createLinearGradient(x, yy, x, yy + 120 + r() * 200);
      g.addColorStop(0, 'rgba(60,50,40,0.12)');
      g.addColorStop(1, 'rgba(60,50,40,0)');
      c.fillStyle = g;
      c.fillRect(x - 3 - r() * 6, yy, 6 + r() * 12, 320);
    }
    // Glockenstube: zwei Rundbögen mit Säule, Glocken im Dunkel
    const bell = (cxm: number, w: number) => {
      const x0 = X(cxm - w / 2), x1 = X(cxm + w / 2), yt = Y(24.6), yb = Y(21.6);
      const rad = (x1 - x0) / 2;
      c.fillStyle = '#1b1714';
      c.beginPath();
      c.moveTo(x0, yb);
      c.lineTo(x0, yt + rad);
      c.arc((x0 + x1) / 2, yt + rad, rad, Math.PI, 0);
      c.lineTo(x1, yb);
      c.closePath();
      c.fill();
      c.strokeStyle = '#efe6d2';
      c.lineWidth = 5;
      c.stroke();
      // Glocke
      const bx = (x0 + x1) / 2, by = yt + rad + 6;
      c.fillStyle = '#7a5a2a';
      c.beginPath();
      c.moveTo(bx - rad * 0.32, by + rad * 0.2);
      c.quadraticCurveTo(bx - rad * 0.35, by - rad * 0.4, bx, by - rad * 0.45);
      c.quadraticCurveTo(bx + rad * 0.35, by - rad * 0.4, bx + rad * 0.32, by + rad * 0.2);
      c.lineTo(bx + rad * 0.5, by + rad * 0.55);
      c.lineTo(bx - rad * 0.5, by + rad * 0.55);
      c.closePath();
      c.fill();
      c.fillStyle = 'rgba(255,220,150,0.35)';
      c.fillRect(bx - rad * 0.25, by - rad * 0.3, rad * 0.12, rad * 0.6);
    };
    bell(2.6, 2.4);
    bell(6.6, 2.4);
    c.fillStyle = '#e6dcc6';
    c.fillRect(X(4.45), Y(24.4), X(4.75) - X(4.45), Y(21.6) - Y(24.4));
    // Zwillingsfenster (Bifora) bzw. Schlitzfenster
    const win = (cxm: number, ym: number, w: number, h: number) => {
      const x0 = X(cxm - w / 2), x1 = X(cxm + w / 2), yt = Y(ym + h), yb = Y(ym);
      const rad = (x1 - x0) / 2;
      c.fillStyle = '#2a2420';
      c.beginPath();
      c.moveTo(x0, yb);
      c.lineTo(x0, yt + rad);
      c.arc((x0 + x1) / 2, yt + rad, rad, Math.PI, 0);
      c.lineTo(x1, yb);
      c.closePath();
      c.fill();
      c.strokeStyle = '#ece2cc';
      c.lineWidth = 4;
      c.stroke();
      c.fillStyle = 'rgba(120,150,170,0.25)';
      c.fillRect(x0 + 4, yt + rad, (x1 - x0) / 2 - 6, yb - yt - rad - 4);
    };
    if (front) {
      win(3.95, 8.6, 0.55, 1.5); win(5.25, 8.6, 0.55, 1.5);
      c.fillStyle = '#e6dcc6';
      c.fillRect(X(4.5), Y(10.1), X(4.7) - X(4.5), Y(8.6) - Y(10.1));
      win(3.95, 17.7, 0.55, 1.6); win(5.25, 17.7, 0.55, 1.6);
      c.fillRect(X(4.5), Y(19.3), X(4.7) - X(4.5), Y(17.7) - Y(19.3));
      // Inschrift über dem Balkon (zwischen Gesims und Fenstern)
      const word = lang === 'fr' ? 'HÔTEL DE VILLE' : lang === 'es' ? 'AYUNTAMIENTO' : lang === 'en' ? 'TOWN HALL' : 'PALAZZO COMUNALE';
      c.fillStyle = '#cfc4ab';
      c.fillRect(X(1.4), Y(7.95), X(7.8) - X(1.4), Y(7.0) - Y(7.95));
      c.strokeStyle = '#a89a7e';
      c.lineWidth = 3;
      c.strokeRect(X(1.4), Y(7.95), X(7.8) - X(1.4), Y(7.0) - Y(7.95));
      c.fillStyle = '#4a3e30';
      c.font = `700 30px ${SERIF}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(word, X(4.6), Y(7.5), X(7.6) - X(1.6));
      // Wappen unter der Uhr
      const wx = X(4.6), wy = Y(12.6);
      c.fillStyle = '#b8a27a';
      c.beginPath();
      c.moveTo(wx - 34, wy - 40); c.lineTo(wx + 34, wy - 40); c.lineTo(wx + 34, wy + 6);
      c.quadraticCurveTo(wx + 30, wy + 34, wx, wy + 46);
      c.quadraticCurveTo(wx - 30, wy + 34, wx - 34, wy + 6);
      c.closePath();
      c.fill();
      c.fillStyle = '#b0242c';
      c.beginPath();
      c.moveTo(wx - 27, wy - 33); c.lineTo(wx + 27, wy - 33); c.lineTo(wx + 27, wy + 4);
      c.quadraticCurveTo(wx + 24, wy + 28, wx, wy + 38);
      c.quadraticCurveTo(wx - 24, wy + 28, wx - 27, wy + 4);
      c.closePath();
      c.fill();
      c.fillStyle = '#f2ede2';
      c.fillRect(wx - 5, wy - 30, 10, 62);
      c.fillRect(wx - 24, wy - 6, 48, 10);
      // Krone über dem Wappen
      c.fillStyle = '#c9a24a';
      for (let k = -2; k <= 2; k++) c.fillRect(wx + k * 12 - 4, wy - 56 + Math.abs(k) * 2, 8, 14);
      c.fillRect(wx - 30, wy - 46, 60, 6);
      // Rahmen der Uhr (Steinring) – das Zifferblatt ist ein eigenes Netz
      c.fillStyle = '#c9bea6';
      c.beginPath();
      c.arc(X(4.6), Y(14.9), (1.62 / 9.2) * 512, 0, Math.PI * 2);
      c.fill();
      // Portal: Bogensteine um die Öffnung, darin das Holztor
      const ax = X(4.6), aw = (1.8 / 9.2) * 512, ay = Y(3.4);
      c.fillStyle = '#e2d8c2';
      c.beginPath();
      c.arc(ax, ay, aw + 34, Math.PI, 0);
      c.lineTo(ax + aw + 34, Y(0));
      c.lineTo(ax - aw - 34, Y(0));
      c.closePath();
      c.fill();
      for (let k = 0; k <= 12; k++) {
        const a = Math.PI + (k / 12) * Math.PI;
        c.strokeStyle = 'rgba(80,70,55,0.5)';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(ax + Math.cos(a) * aw, ay + Math.sin(a) * aw);
        c.lineTo(ax + Math.cos(a) * (aw + 34), ay + Math.sin(a) * (aw + 34));
        c.stroke();
      }
      c.fillStyle = '#d8ccb2';
      c.fillRect(ax - 12, ay - aw - 40, 24, 40);
      // Tor: zwei Flügel, Bretter, Beschläge, Nägel
      c.fillStyle = '#5a3a22';
      c.beginPath();
      c.arc(ax, ay, aw, Math.PI, 0);
      c.lineTo(ax + aw, Y(0));
      c.lineTo(ax - aw, Y(0));
      c.closePath();
      c.fill();
      c.save();
      c.clip();
      for (let k = -8; k <= 8; k++) {
        c.fillStyle = k % 2 ? 'rgba(0,0,0,0.12)' : 'rgba(255,220,180,0.06)';
        c.fillRect(ax + k * (aw / 8), ay - aw, aw / 8, Y(0) - ay + aw);
      }
      c.fillStyle = '#2a1c12';
      c.fillRect(ax - 2, ay - aw, 4, Y(0) - ay + aw);
      for (const yy of [0.8, 2.0, 3.2]) {
        c.fillStyle = '#2b2b2e';
        c.fillRect(ax - aw, Y(yy) - 5, aw * 2, 10);
        c.fillStyle = '#8a8a8e';
        for (let k = -7; k <= 7; k++) { c.beginPath(); c.arc(ax + k * aw / 7.5, Y(yy), 2.6, 0, Math.PI * 2); c.fill(); }
      }
      c.fillStyle = '#c9a24a';
      for (const s of [-1, 1]) { c.beginPath(); c.arc(ax + s * 18, Y(1.6), 7, 0, Math.PI * 2); c.fill(); }
      c.restore();
      void name;
    } else {
      for (const yy of [8.5, 13.5, 18.0]) {
        c.fillStyle = '#2a2420';
        c.fillRect(X(4.45), Y(yy + 1.1), X(4.75) - X(4.45), Y(yy) - Y(yy + 1.1));
        c.strokeStyle = '#ece2cc';
        c.lineWidth = 3;
        c.strokeRect(X(4.45), Y(yy + 1.1), X(4.75) - X(4.45), Y(yy) - Y(yy + 1.1));
      }
    }
  };
  region(0, true);
  region(512, false);
  return cv;
}

/** Zifferblatt: cremefarben mit römischen Ziffern, Minutenkranz, vergoldeter Ring */
function dialTex(): HTMLCanvasElement {
  const S = 256;
  const { cv, c } = canvas(S, S);
  const m = S / 2;
  c.fillStyle = '#c9a24a';
  c.beginPath(); c.arc(m, m, m, 0, Math.PI * 2); c.fill();
  const g = c.createRadialGradient(m, m - 20, 10, m, m, m - 8);
  g.addColorStop(0, '#fbf6e8');
  g.addColorStop(1, '#ece2c6');
  c.fillStyle = g;
  c.beginPath(); c.arc(m, m, m - 9, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#2a2420';
  c.lineWidth = 2;
  c.beginPath(); c.arc(m, m, m - 22, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.arc(m, m, m - 46, 0, Math.PI * 2); c.stroke();
  for (let k = 0; k < 60; k++) {
    const a = (k / 60) * Math.PI * 2;
    const r0 = m - 22, r1 = k % 5 ? m - 28 : m - 34;
    c.lineWidth = k % 5 ? 1.5 : 3;
    c.beginPath();
    c.moveTo(m + Math.sin(a) * r0, m - Math.cos(a) * r0);
    c.lineTo(m + Math.sin(a) * r1, m - Math.cos(a) * r1);
    c.stroke();
  }
  const ROM = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  c.fillStyle = '#1e1a16';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    c.save();
    c.translate(m + Math.sin(a) * (m - 62), m - Math.cos(a) * (m - 62));
    c.rotate(a);
    c.font = `700 ${ROM[k].length > 3 ? 17 : 21}px ${SERIF}`;
    c.fillText(ROM[k], 0, 0);
    c.restore();
  }
  // Sonne in der Mitte
  c.fillStyle = 'rgba(201,162,74,0.55)';
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    c.beginPath();
    c.moveTo(m + Math.sin(a) * 12, m - Math.cos(a) * 12);
    c.lineTo(m + Math.sin(a + 0.12) * 30, m - Math.cos(a + 0.12) * 30);
    c.lineTo(m + Math.sin(a - 0.12) * 30, m - Math.cos(a - 0.12) * 30);
    c.fill();
  }
  return cv;
}

/** Café-Schirm (512 × 512): oben Stoff mit Nähten und Falten, darunter der Volant mit dem Namen */
function parasolTex(name: string): HTMLCanvasElement {
  const { cv, c } = canvas(512, 512);
  // Stoff (v 0,5–1 → Canvas 0–256): Dreieck mit Spitze oben in der Mitte
  const g = c.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#f4ecd8');
  g.addColorStop(1, '#e8dcc0');
  c.fillStyle = g;
  c.fillRect(0, 0, 512, 256);
  c.strokeStyle = 'rgba(120,100,70,0.25)';
  c.lineWidth = 2;
  for (let k = 1; k < 4; k++) { c.beginPath(); c.moveTo(256, 0); c.lineTo(k * 128, 256); c.stroke(); }
  c.fillStyle = 'rgba(0,0,0,0.05)';
  for (let k = 0; k < 12; k++) c.fillRect(0, 20 + k * 20, 512, 6);
  c.fillStyle = '#7a2230';
  c.fillRect(0, 244, 512, 12);
  // Volant (v 0,375–0,5 → Canvas 256–320): Bordeaux mit cremefarbener Schrift, Wellenkante
  c.fillStyle = '#7a2230';
  c.fillRect(0, 256, 512, 64);
  c.fillStyle = '#f4ecd8';
  c.font = `italic 700 34px ${SERIF}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(name, 256, 286, 470);
  c.fillStyle = '#5a1822';
  for (let x = 0; x < 512; x += 32) { c.beginPath(); c.arc(x + 16, 320, 16, Math.PI, 0); c.fill(); }
  c.fillStyle = 'rgba(244,236,216,0.7)';
  c.fillRect(0, 258, 512, 3);
  return cv;
}

/** Marktmarkisen (128 × 96): drei Bänder – rot, grün, blau mit weißen Streifen, unten je eine Bogenkante */
function awningTex(): HTMLCanvasElement {
  const { cv, c } = canvas(128, 96);
  const cols = ['#c9372c', '#2a7046', '#2c5a96'];
  for (let b = 0; b < 3; b++) {
    for (let k = 0; k < 8; k++) {
      c.fillStyle = k % 2 ? '#f7f3ea' : cols[b];
      c.fillRect(k * 16, b * 32, 16, 32);
    }
    c.fillStyle = 'rgba(0,0,0,0.08)';
    c.fillRect(0, b * 32 + 28, 128, 4);
    c.fillStyle = 'rgba(255,255,255,0.1)';
    c.fillRect(0, b * 32, 128, 3);
  }
  return cv;
}

/** Rosa Fahne (128 × 256): Logo, Linien, Schriftzug senkrecht */
function bannerTex(accent: string): HTMLCanvasElement {
  const { cv, c } = canvas(128, 256);
  c.fillStyle = accent;
  c.fillRect(0, 0, 128, 256);
  const g = c.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.12)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(0,0,0,0.12)');
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 256);
  c.fillStyle = '#ffffff';
  c.fillRect(10, 8, 108, 4);
  c.fillRect(10, 244, 108, 4);
  c.save();
  c.translate(64, 128);
  c.rotate(-Math.PI / 2);
  c.font = `800 40px "Arial Rounded MT Bold", "SF Pro Rounded", ui-rounded, ${SANS}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('gruppetto', 0, -6, 220);
  c.font = `700 14px ${SANS}`;
  c.fillText('LA CORSA ROSA', 0, 28, 200);
  c.restore();
  // Fransen unten
  c.fillStyle = '#f7e2ea';
  for (let x = 6; x < 128; x += 10) c.fillRect(x, 248, 3, 8);
  return cv;
}

/** Startlinie mit Schrift (1024 × 1024, von hinten lesbar: in Fahrtrichtung lang gezogen) */
function lineTex(word: string, accent: string): HTMLCanvasElement {
  const { cv, c } = canvas(512, 1024);
  c.clearRect(0, 0, 512, 1024);
  // v 0 = Startlinie (Canvas unten), v 1 = 7,5 m weiter vorn (Canvas oben)
  const Y = (m: number) => 1024 - (m / 7.5) * 1024;
  c.fillStyle = 'rgba(248,246,240,0.95)';
  c.fillRect(0, Y(0.16), 512, Y(0) - Y(0.16));
  // Schachbrett-Saum hinter der Linie
  for (let k = 0; k < 32; k++) {
    c.fillStyle = k % 2 ? 'rgba(20,20,22,0.85)' : 'rgba(248,246,240,0.9)';
    c.fillRect(k * 16, Y(0.32), 16, Y(0.16) - Y(0.32));
  }
  const word2 = (t: string, m: number, size: number, style: string, col: string, maxW: number) => {
    c.save();
    c.translate(256, Y(m));
    c.scale(1, 3.2);
    c.font = `${style} ${size}px ${SANS}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = col;
    c.fillText(t, 0, 0, maxW);
    c.restore();
  };
  word2(word, 2.2, 92, 'italic 900', 'rgba(248,246,240,0.92)', 470);
  word2('gruppetto', 4.9, 64, '800', accent, 360);
  // Abrieb (Reifen, Wetter)
  const r = mulberry32(5);
  c.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 2600; k++) {
    c.fillStyle = `rgba(0,0,0,${0.15 + r() * 0.4})`;
    c.fillRect(r() * 512, r() * 1024, 1 + r() * 3, 1 + r() * 4);
  }
  c.globalCompositeOperation = 'source-over';
  return cv;
}

/** Zeitungskiosk: Front mit Zeitschriften (unten), Schild (oben) */
function kioskTex(lang: string): HTMLCanvasElement {
  const { cv, c } = canvas(512, 512);
  const r = mulberry32(77);
  // Front (v 0–0,72 → Canvas 143–512)
  c.fillStyle = '#20503a';
  c.fillRect(0, 143, 512, 369);
  const cols = ['#f1b3c4', '#e8463c', '#2f6fb2', '#f2d43a', '#f6f6f2', '#2a2b2f', '#3d7a52', '#d97a2a', '#8a4fa0'];
  for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 7; k++) {
      const x = 12 + k * 70 + (row % 2) * 6, y = 160 + row * 86;
      const col = cols[Math.floor(r() * cols.length)];
      c.fillStyle = col;
      c.fillRect(x, y, 58, 76);
      c.fillStyle = col === '#f6f6f2' || col === '#f2d43a' || col === '#f1b3c4' ? '#2a2020' : '#ffffff';
      c.fillRect(x + 4, y + 6, 50, 9);
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fillRect(x + 6, y + 22, 30 + r() * 16, 28);
      c.fillRect(x + 6, y + 56, 46, 3);
      c.fillRect(x + 6, y + 62, 36, 3);
    }
  }
  // die rosa Sportzeitung groß
  c.fillStyle = '#f1b3c4';
  c.fillRect(150, 440, 210, 66);
  c.fillStyle = '#2a1a20';
  c.font = `900 22px ${SERIF}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('LA GAZZETTA', 255, 458, 196);
  c.font = `700 13px ${SANS}`;
  c.fillText('Oggi si parte dal passo!', 255, 486, 196);
  // Schild (v 0,75–1 → Canvas 0–128)
  c.fillStyle = '#163a2a';
  c.fillRect(0, 0, 512, 128);
  c.fillStyle = '#f2e6c4';
  c.font = `700 64px ${SERIF}`;
  c.fillText(lang === 'fr' ? 'PRESSE' : lang === 'es' ? 'KIOSCO' : lang === 'en' ? 'NEWS' : 'EDICOLA', 256, 66, 470);
  c.strokeStyle = '#c9a24a';
  c.lineWidth = 4;
  c.strokeRect(8, 8, 496, 112);
  return cv;
}

/** Bühne (512 × 512): unten die Verkleidung (v 0–0,42), oben die Rückwand (v 0,45–1) */
function stageTex(lang: string, accent: string): HTMLCanvasElement {
  const { cv, c } = canvas(512, 512);
  const word = lang === 'fr' ? 'DÉPART' : lang === 'es' ? 'SALIDA' : lang === 'en' ? 'START' : 'PARTENZA';
  c.fillStyle = accent;
  c.fillRect(0, 0, 512, 512);
  // Rückwand
  c.fillStyle = 'rgba(0,0,0,0.12)';
  for (let k = 0; k < 9; k++) c.fillRect(k * 64 - 20, 0, 18, 282);
  c.fillStyle = '#ffffff';
  c.font = `800 92px "Arial Rounded MT Bold", "SF Pro Rounded", ui-rounded, ${SANS}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('gruppetto', 256, 110, 480);
  c.font = `italic 900 54px ${SANS}`;
  c.fillText(word, 256, 200, 470);
  c.fillRect(40, 240, 432, 6);
  // Verkleidung
  c.fillStyle = '#1d1d20';
  c.fillRect(0, 297, 512, 215);
  c.fillStyle = accent;
  c.fillRect(0, 300, 512, 18);
  c.fillStyle = '#ffffff';
  c.font = `800 64px "Arial Rounded MT Bold", "SF Pro Rounded", ui-rounded, ${SANS}`;
  c.fillText('gruppetto', 256, 400, 470);
  c.font = `700 22px ${SANS}`;
  c.fillText('LIVE · RADIO CORSA', 256, 460, 470);
  return cv;
}

/** Tafel des Cafés (Kreide) */
function menuTex(lang: string): HTMLCanvasElement {
  const { cv, c } = canvas(256, 256);
  c.fillStyle = '#6a4a2c';
  c.fillRect(0, 0, 256, 256);
  c.fillStyle = '#1f2421';
  c.fillRect(12, 12, 232, 232);
  c.fillStyle = 'rgba(255,255,255,0.05)';
  for (let k = 0; k < 30; k++) c.fillRect(12 + Math.random() * 220, 12 + Math.random() * 220, 40, 2);
  c.fillStyle = '#f4f0e6';
  c.textAlign = 'center';
  c.font = `italic 700 30px ${SERIF}`;
  const items = lang === 'fr' ? ['Café', 'Croissant', 'Pastis', 'Crêpes'] : lang === 'es' ? ['Café', 'Churros', 'Vermut', 'Tostada'] : lang === 'en' ? ['Coffee', 'Cake', 'Spritz', 'Panini'] : ['Caffè', 'Cornetto', 'Spritz', 'Tramezzini'];
  c.fillText(lang === 'it' || !['fr', 'es', 'en'].includes(lang) ? 'Oggi' : lang === 'fr' ? 'Menu' : lang === 'es' ? 'Hoy' : 'Today', 128, 48);
  c.font = `600 22px ${SERIF}`;
  items.forEach((t, k) => {
    c.textAlign = 'left';
    c.fillText(t, 30, 96 + k * 38);
    c.textAlign = 'right';
    c.fillText(`${(1.2 + k * 1.3).toFixed(1).replace('.', ',')} €`, 228, 96 + k * 38);
  });
  c.strokeStyle = '#e0559a';
  c.lineWidth = 3;
  c.beginPath(); c.moveTo(40, 62); c.lineTo(216, 62); c.stroke();
  return cv;
}

/** Wasser: Kräuselung (Becken) bzw. fallende Strähnen (Strahlen, Überlauf) */
function waterTex(fall = false): HTMLCanvasElement {
  const { cv, c } = canvas(128, 128);
  const r = mulberry32(fall ? 3 : 9);
  if (fall) {
    // durchsichtig mit hellen Strähnen und Tropfen (das Material nimmt die Deckkraft aus der Textur)
    c.clearRect(0, 0, 128, 128);
    c.fillStyle = 'rgba(190,222,236,0.18)';
    c.fillRect(0, 0, 128, 128);
    for (let k = 0; k < 34; k++) {
      const x = r() * 128;
      c.fillStyle = `rgba(245,252,255,${0.25 + r() * 0.55})`;
      c.fillRect(x, 0, 1 + r() * 2.5, 128);
    }
    for (let k = 0; k < 70; k++) {
      c.fillStyle = `rgba(255,255,255,${0.5 + r() * 0.4})`;
      c.fillRect(r() * 128, r() * 128, 1.5, 5 + r() * 12);
    }
    return cv;
  }
  c.fillStyle = '#7fa9bb';
  c.fillRect(0, 0, 128, 128);
  {
    for (let k = 0; k < 70; k++) {
      const x = r() * 128, y = r() * 128, rad = 4 + r() * 14;
      c.strokeStyle = `rgba(255,255,255,${0.12 + r() * 0.25})`;
      c.lineWidth = 1.2;
      for (const ox of [-128, 0, 128]) for (const oy of [-128, 0, 128]) {
        c.beginPath();
        c.ellipse(x + ox, y + oy, rad, rad * 0.6, 0, 0, Math.PI * 2);
        c.stroke();
      }
    }
  }
  return cv;
}
