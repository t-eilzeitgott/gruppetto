/**
 * Zeitfahren: der Startbereich.
 *
 * Startpodest mit Teppich (das liegt im Startbild unten im Bild), Rampe mit Teppich, Startlinie, Zeitmessmatte und
 * Banden, Startuhr mit Countdown und Lampen, der Kommissär hält den Sattel bis „Los“, der Starter hebt die Hand,
 * ein Zeitnehmer mit Stoppuhr, Fotografen (stehend und kniend, mit Blitz), ein Kameramann, das TV-Motorrad, der
 * Teamwagen in den Farben des Fahrers mit Ersatzrädern auf dem Dach (hinter der Absperrung), ein Mechaniker, ein
 * Polizist und ein Lautsprechermast.
 *
 * Feste Teile liegen in einer Gruppe in Startkoordinaten: x nach rechts, y nach oben, Streckenmeter f nach vorn
 * (lokal −z). Die Menschen am Start sind voll detailliert und bewegt (human3d.ts) und stehen in Weltkoordinaten.
 */
import * as THREE from 'three';
import { EDGE, SEG, type Track } from './track';
import { GB, lin, type RGBf } from './models3d';
import { Human, lookFor, propGeometries, type Act, type Role } from './human3d';
import { adCell, AD_COUNT } from './tex3d';
import { mulberry32 } from './rng';
import type { RaceView } from './engine';
import type { Kit } from './rider';

/** Höhe des Podests über dem Platz dahinter (m) – so tief liegt das Gelände hinter dem Start */
export const TT_PODIUM = 1.25;
/** Podest: hinterer Rand und halbe Breite; Teppich auf der Rampe: Ende und halbe Breite */
const DECK_BACK = -7.5;
const DECK_HALF = 3.0;
const RAMP_END = 9.6;
const RAMP_HALF = 2.75;
/** Banden der Rampe (Mitte der Platte, |x|) */
const BOARD_X = 2.86;
/** Startlinie: knapp vor dem Vorderrad */
const LINE_F = 1.0;
/** Teppich-Textur: von hier (f) bis RAMP_END; dahinter (unter der Kamera) läuft der letzte Rand weiter */
const CV_F0 = -3.6;
/** Teamwagen hinter der linken Absperrung (Streckenmeter): dort stehen keine Zuschauer */
const CAR_F = 17.6;
const CAR_X = -4.95;

/** Zuschauer hinter der Absperrung weglassen? (Lücke für den Teamwagen; Stück i, Seite sg) */
export function ttCrowdGap(track: Track, i: number, sg: number): boolean {
  const k = i - Math.round(track.rampZ / SEG);
  return track.kind !== 'descent' && sg < 0 && k >= 6 && k <= 10;
}

export interface TtStartDeps {
  track: Track;
  /** Eckpunktfarben, flach schattiert */
  props: THREE.Material;
  /** Banden-Atlas (adCell) */
  ads: THREE.Material;
  /** Dinge in der Hand der Menschen (Kamera, Stoppuhr): Eckpunktfarben, glatt */
  gear: THREE.Material;
  /** runder Schatten (Alpha) */
  shadow: THREE.Texture;
  /** Lichtpunkt (Blitz der Fotografen) */
  glow: THREE.Texture;
  accent: string;
  aniso: number;
  /** Höhe des Bodens neben der Straße über der Fahrbahn: Streckenmeter f, Seite sg, Abstand dx ab dem Bankett */
  side: (f: number, sg: number, dx: number) => number;
  /** PC-Grafik: alle Menschen in voller Detailstufe */
  pc?: boolean;
  /** Streckenmeter des Starts (Fahrer auf der Rampe), Standard 0 */
  f0?: number;
  /**
   * Podest bündig im Platz (Abfahrt: die Piazza liegt auf Höhe des Podests, nur die Rampe führt hinunter auf die
   * Straße) – ohne Verkleidung, Treppe, Teamwagen und Mechaniker
   */
  flush?: boolean;
  /** Countdown des Spiels: von welcher Zahl, Sekunden je Zahl (Zeitfahren 5 / 0,6) */
  count?: [number, number];
}

type V = number[];
/** Startkoordinaten (x, y, f) → lokal (f nach vorn = −z) */
const P = (x: number, y: number, f: number): V => [x, y, -f];
const M4 = (x: number, y: number, f: number, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, -f), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));

/** Zylinder zwischen zwei lokalen Punkten (three-Koordinaten) */
function rod(gb: GB, a: THREE.Vector3, b: THREE.Vector3, r: number, col: RGBf, n = 6) {
  const d = b.clone().sub(a);
  const len = d.length();
  if (len < 1e-4) return;
  const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), new THREE.Vector3(1, 1, 1));
  gb.add(new THREE.CylinderGeometry(r, r, len, n, 1, false), m, col);
}

/** Rennrad (stehend, Blick −z, Ursprung am Boden unter dem Tretlager) in die Matrix m */
export function bike(gb: GB, m: THREE.Matrix4, frame: RGBf) {
  const black = lin('#16171a');
  const grey = lin('#8d939b');
  const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(m);
  for (const z of [-0.56, 0.43]) {
    const tm = new THREE.Matrix4().compose(new THREE.Vector3(0, 0.335, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), new THREE.Vector3(1, 1, 1)).premultiply(m);
    gb.add(new THREE.TorusGeometry(0.315, 0.02, 5, 22), tm, black);
    gb.add(new THREE.TorusGeometry(0.29, 0.012, 4, 22), tm, grey);
    gb.add(new THREE.CylinderGeometry(0.025, 0.025, 0.1, 6), new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(0, 0.335, z).premultiply(m), grey);
  }
  const bb = at(0, 0.3, 0.02), seat = at(0, 0.84, 0.17), head = at(0, 0.8, -0.45), headLo = at(0, 0.65, -0.5);
  const rear = at(0, 0.335, 0.43), front = at(0, 0.335, -0.56);
  rod(gb, bb, seat, 0.017, frame);
  rod(gb, seat, head, 0.016, frame);
  rod(gb, bb, headLo, 0.02, frame);
  rod(gb, headLo, head, 0.022, frame);
  rod(gb, bb, rear, 0.012, frame);
  rod(gb, seat, rear, 0.011, frame);
  rod(gb, headLo, front, 0.014, black);
  rod(gb, seat, at(0, 0.95, 0.2), 0.012, black);
  gb.add(new THREE.BoxGeometry(0.08, 0.035, 0.26), new THREE.Matrix4().setPosition(0, 0.965, 0.21).premultiply(m), black);
  gb.add(new THREE.BoxGeometry(0.4, 0.03, 0.03), new THREE.Matrix4().setPosition(0, 0.86, -0.52).premultiply(m), black);
  rod(gb, at(0, 0.8, -0.45), at(0, 0.86, -0.52), 0.014, black);
}

/** Leuchtschrift der Startuhr */
interface ClockState { big: string; col: string; lamps: number; lampCol: string; small: string }

export class TtStart3D {
  /** alles (Startgruppe und Menschen) – in die Szene hängen */
  readonly root = new THREE.Group();
  private local = new THREE.Group();
  private dis: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  /** Menschen am Start: Ort (Startkoordinaten), Blick zum Fahrer, ob sie ihm mit dem Körper folgen (Kameras) */
  private staff: { h: Human; role: Role; x: number; f: number; y: number; act: Act; track: boolean; yaw: number }[] = [];
  private holder = 0;
  private starter = 1;
  private mech = -1;
  private flashes: { s: THREE.Sprite; t: number; next: number; who: number }[] = [];
  private riderHead = new THREE.Vector3();
  private clockCv: HTMLCanvasElement;
  private clockTex: THREE.CanvasTexture;
  private clockKey = '';
  private car: THREE.Mesh | null = null;
  private carKit = '';
  private lastPhase = '';
  private goT = -1;
  private holdX = NaN;
  private readonly W0: { x: number; y: number; z: number; th: number } = { x: 0, y: 0, z: 0, th: 0 };
  private readonly track: Track;
  private readonly d: TtStartDeps;
  private readonly y0: number;
  /** Streckenmeter des Starts: alles hier rechnet in Metern ab dort */
  private readonly f0: number;

  constructor(d: TtStartDeps) {
    this.d = d;
    const t = d.track;
    this.track = t;
    this.f0 = d.f0 ?? 0;
    t.world(this.f0, 0, 0, this.W0);
    this.y0 = this.W0.y;
    this.local.position.set(this.W0.x, this.W0.y, this.W0.z);
    this.local.rotation.y = -this.W0.th;
    this.root.add(this.local);
    this.root.name = 'ttStart';

    const props = new GB();
    const ads = new GB();
    ads.uv = true;
    const carpet = new GB();
    carpet.uv = true;
    const flat = new GB();
    if (!d.flush) this.podium(props, ads);
    this.ramp(props, ads, carpet);
    this.clockStand(props);
    this.speakers(props);
    this.moto(props);

    // Menschen: Rollen, Handlungen, Orte (x, f); das Gesicht zu einem Punkt (x, f)
    const r = mulberry32((t.seed ^ 0x51a7) >>> 0);
    const pg = propGeometries();
    const add = (role: Role, act: Act, x: number, f: number, look: [number, number], y = 0, track = false) => {
      // nah an der Startkamera (hinter dem Fahrer): Kopf in voller Detailstufe, weiter weg einfacher
      const q: 0 | 1 = d.pc || Math.hypot(x, f + 6.7) < 10 ? 1 : 0;
      const h = new Human(lookFor(r, role), r() * 100, q);
      h.act = act;
      const yaw = Math.atan2(look[0] - x, look[1] - f);
      this.staff.push({ h, role, x, f, y, act, track, yaw });
      this.root.add(h.group);
      return this.staff.length - 1;
    };
    const carry = (i: number, geo: THREE.BufferGeometry, mode: 'hands' | 'right' | 'shoulder') => this.staff[i].h.carry(new THREE.Mesh(geo, d.gear), mode);
    // Kommissär am Sattel, Starter (hebt die Hand), Zeitnehmer mit Stoppuhr
    this.holder = add('official', 'hold', -0.24, -0.62, [0.3, -0.2]);
    this.starter = add('official', 'stand', -1.32, 0.55, [0.3, 0.2], this.road(0.55));
    carry(add('official', 'hands', 2.08, -0.85, [0.3, 0.4]), pg.watch, 'hands');
    // Fotografen am Fuß der Rampe (zwischen Bande und Absperrung), Kameramann oben rechts – folgen dem Fahrer
    const ph = [
      add('photographer', 'kneel', -3.28, 7.4, [0.2, 0.5], this.road(7.4), true),
      add('photographer', 'photo', -3.4, 11.2, [0.4, 1.0], this.road(11.2), true),
      add('photographer', 'kneel', 3.28, 8.3, [0.2, 0.5], this.road(8.3), true),
      add('photographer', 'photo', 3.4, 12.2, [0.0, 1.0], this.road(12.2), true),
    ];
    ph.forEach((i, k) => carry(i, k === 3 ? pg.tele : pg.camera, 'hands'));
    carry(add('tv', 'tv', 3.3, 4.4, [0.3, 0.0], this.road(4.4), true), pg.tvcam, 'shoulder');
    add('police', 'back', -3.3, 13.9, [0.5, 16], this.road(13.9));
    if (!d.flush) this.mech = add('mechanic', 'cross', -4.35, 20.9, [0, 22], this.road(20.9) + this.side(20.9, -1, 4.35 - EDGE));
    for (const s of this.staff) this.blob(flat, s.x, s.f, s.y, s.act === 'kneel' ? 1.0 : 0.85);
    if (!d.flush) this.blob(flat, CAR_X, CAR_F, this.road(CAR_F) + this.side(CAR_F, -1, -CAR_X - EDGE), 2.6, 5.4);
    for (let i = 0; i < this.staff.length; i++) this.place(i);

    // Netze
    const mesh = (gb: GB, mat: THREE.Material, noShadow = false) => {
      if (gb.empty) return null;
      const g = gb.build();
      this.dis.push(g);
      const m = new THREE.Mesh(g, mat);
      m.userData.noShadow = noShadow;
      this.local.add(m);
      return m;
    };
    mesh(props, d.props);
    mesh(ads, d.ads, true);
    // Schrift auf dem Podest: im Zeitfahren „Cronometro“, sonst „Partenza“ in der Landessprache
    const lang = t.lang;
    const label = t.kind === 'tt' ? 'CRONOMETRO' : lang === 'fr' ? 'DÉPART' : lang === 'es' ? 'SALIDA' : lang === 'en' ? 'START' : 'PARTENZA';
    const ct = new THREE.CanvasTexture(carpetTex(d.accent, label));
    ct.colorSpace = THREE.SRGBColorSpace;
    ct.anisotropy = d.aniso;
    ct.wrapS = ct.wrapT = THREE.ClampToEdgeWrapping;
    const cm = new THREE.MeshLambertMaterial({ map: ct, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    cm.name = 'ttCarpet';
    this.dis.push(ct, cm);
    mesh(carpet, cm, true);
    const sm = new THREE.MeshBasicMaterial({ map: d.shadow, transparent: true, depthWrite: false, opacity: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    this.dis.push(sm);
    flat.uv = true;
    // (die Schatten sind schon mit UV gebaut – siehe blob)
    mesh(flat, sm, true);

    // Startuhr: Leuchtanzeige (eigene Textur, nur neu gemalt, wenn sich etwas ändert)
    this.clockCv = document.createElement('canvas');
    this.clockCv.width = 256;
    this.clockCv.height = 176;
    this.clockTex = new THREE.CanvasTexture(this.clockCv);
    this.clockTex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.MeshBasicMaterial({ map: this.clockTex, toneMapped: false });
    const fg = new THREE.PlaneGeometry(0.8, 0.55);
    this.dis.push(this.clockTex, face, fg);
    const fm = new THREE.Mesh(fg, face);
    const cf = this.clockFrame();
    fm.position.set(cf.x, cf.y, -cf.f);
    fm.rotation.y = cf.yaw;
    fm.translateZ(0.074);
    this.local.add(fm);
    this.paintClock({ big: '--:--', col: '#ffb02e', lamps: 0, lampCol: '#ff2a1f', small: 'CRONO' });

    // Blitze der Fotografen (folgen ihrer Kamera)
    const fmat = new THREE.SpriteMaterial({ map: d.glow, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.dis.push(fmat);
    for (const i of ph) {
      const sp = new THREE.Sprite(fmat);
      sp.scale.setScalar(0.9);
      sp.visible = false;
      this.root.add(sp);
      this.flashes.push({ s: sp, t: 0, next: 0.5 + r() * 3, who: i });
    }
  }

  // ------------------------------------------------------------------ Bauteile

  /** Fahrbahnhöhe an Streckenmeter f über dem Start (hinter dem Start: Podest, 0) */
  private road(f: number): number {
    return f <= 0 ? 0 : this.track.heightAt(this.f0 + f) - this.y0;
  }

  /** Boden neben der Straße (Startkoordinaten f) */
  private side(f: number, sg: number, dx: number): number {
    return this.d.side(this.f0 + f, sg, dx);
  }

  /** Kiste in Startkoordinaten (Mitte x, y, f; Maße quer, hoch, längs) */
  private box(gb: GB, x: number, y: number, f: number, w: number, h: number, l: number, col: RGBf, ry = 0, rx = 0) {
    gb.add(new THREE.BoxGeometry(w, h, l), M4(x, y, f, ry, rx), col);
  }

  /** Leiste entlang der Rampe (folgt der Fahrbahn), oben auf Höhe yo über der Fahrbahn */
  private slope(gb: GB, x: number, f0: number, f1: number, yo: number, w: number, h: number, col: RGBf) {
    const y0 = this.road(f0) + yo, y1 = this.road(f1) + yo;
    const len = Math.hypot(f1 - f0, y1 - y0);
    gb.add(new THREE.BoxGeometry(w, h, len), M4(x, (y0 + y1) / 2 - h / 2, (f0 + f1) / 2, 0, -Math.atan2(y0 - y1, f1 - f0)), col);
  }

  /** Startpodest: Kasten mit Stoffverkleidung und Werbung, Geländer, Treppe nach hinten */
  private podium(props: GB, ads: GB) {
    const cloth = lin('#23252b');
    const trim = lin('#f4f4f2');
    const rail = lin('#b9bec5');
    const depth = 3.2; // so tief reicht die Verkleidung (das Gelände davor liegt tiefer)
    const len = -DECK_BACK;
    // Seiten und Rückwand
    for (const sg of [-1, 1]) this.box(props, sg * (DECK_HALF - 0.02), -depth / 2, DECK_BACK / 2, 0.04, depth, len, cloth);
    this.box(props, 0, -depth / 2, DECK_BACK + 0.02, DECK_HALF * 2, depth, 0.04, cloth);
    // weiße Kante oben
    for (const sg of [-1, 1]) this.box(props, sg * (DECK_HALF - 0.02), -0.03, DECK_BACK / 2, 0.07, 0.06, len, trim);
    this.box(props, 0, -0.03, DECK_BACK + 0.02, DECK_HALF * 2 + 0.04, 0.06, 0.07, trim);
    // Werbung an den Seiten (außen) und hinten
    let k = 3;
    for (const sg of [-1, 1]) {
      for (let f0 = DECK_BACK + 0.2; f0 < -0.4; f0 += 2.4) {
        const f1 = Math.min(-0.2, f0 + 2.2);
        const [u0, v0, u1, v1] = adCell(k++ % AD_COUNT, false);
        const x = sg * (DECK_HALF + 0.005);
        const a0 = P(x, -0.95, f0), b0 = P(x, -0.95, f1), b1 = P(x, -0.15, f1), a1 = P(x, -0.15, f0);
        // von außen lesbar: rechts läuft die Schrift nach hinten, links nach vorn
        if (sg > 0) ads.quad(b0, a0, a1, b1, [1, 1, 1], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
        else ads.quad(a0, b0, b1, a1, [1, 1, 1], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      }
    }
    // Geländer an den Seiten und hinten (vorn ist offen: dort geht es auf die Rampe)
    for (const sg of [-1, 1]) {
      for (let f = DECK_BACK + 0.1; f <= -0.6; f += 1.7) this.box(props, sg * (DECK_HALF - 0.08), 0.5, f, 0.045, 1.0, 0.045, rail);
      this.box(props, sg * (DECK_HALF - 0.08), 1.0, (DECK_BACK + 0.1 - 0.6) / 2, 0.05, 0.05, -DECK_BACK - 0.5, rail);
      this.box(props, sg * (DECK_HALF - 0.08), 0.55, (DECK_BACK + 0.1 - 0.6) / 2, 0.03, 0.03, -DECK_BACK - 0.5, rail);
    }
    this.box(props, 0.9, 1.0, DECK_BACK + 0.1, DECK_HALF * 2 - 2.2, 0.05, 0.05, rail);
    // Treppe hinten links hinunter auf den Platz
    const steps = 5;
    for (let s = 1; s <= steps; s++) {
      const top = -s * (TT_PODIUM / steps);
      const f = DECK_BACK - 0.4 * s + 0.2;
      this.box(props, -1.75, (top - TT_PODIUM - 0.4) / 2, f, 1.3, top + TT_PODIUM + 0.4, 0.4, s % 2 ? lin('#3a3d44') : lin('#33363c'));
      this.box(props, -1.75, top - 0.01, f + 0.18, 1.3, 0.025, 0.05, trim);
    }
    for (const x of [-2.42, -1.08]) {
      const a = new THREE.Vector3(x, 0.95, -DECK_BACK);
      const b = new THREE.Vector3(x, 0.95 - TT_PODIUM, -(DECK_BACK - 0.4 * steps));
      rod(props, a, b, 0.025, rail);
      rod(props, new THREE.Vector3(x, 0, -DECK_BACK), a, 0.025, rail);
    }
  }

  /** Rampe: Teppich auf Podest und Rampe, Startlinie, Zeitmessmatte, Banden mit Werbung */
  private ramp(props: GB, ads: GB, carpet: GB) {
    // Teppich: eine Bahn vom hinteren Podestrand bis zum Fuß der Rampe (auf dem Podest eben, dann mit der Straße)
    const fs = [DECK_BACK, CV_F0, -1.5, 0];
    for (let f = 1; f < RAMP_END; f += 1) fs.push(f);
    fs.push(RAMP_END);
    const lift = 0.015;
    const u = (x: number) => (x + DECK_HALF) / (2 * DECK_HALF);
    const v = (f: number) => (f - CV_F0) / (RAMP_END - CV_F0);
    for (let k = 0; k + 1 < fs.length; k++) {
      const f0 = fs[k], f1 = fs[k + 1];
      const h0 = f0 < 0 ? DECK_HALF : RAMP_HALF, h1 = f1 <= 0 ? DECK_HALF : RAMP_HALF;
      const y0 = this.road(f0) + lift, y1 = this.road(f1) + lift;
      carpet.quad(P(-h0, y0, f0), P(h0, y0, f0), P(h1, y1, f1), P(-h1, y1, f1), [1, 1, 1],
        [[u(-h0), v(f0)], [u(h0), v(f0)], [u(h1), v(f1)], [u(-h1), v(f1)]]);
    }
    // Stufe vom Podest (DECK_HALF) auf die schmalere Rampe: Stirnseiten der Podestecken
    const cloth = lin('#23252b');
    for (const sg of [-1, 1]) this.box(props, sg * (DECK_HALF + RAMP_HALF) / 2, -0.4, 0.02, DECK_HALF - RAMP_HALF, 0.8, 0.04, cloth);
    // schwarze Gummikante am Fuß der Rampe
    this.slope(props, 0, RAMP_END - 0.02, RAMP_END + 0.32, lift + 0.004, RAMP_HALF * 2, 0.02, lin('#18191b'));
    // Zeitmessmatte quer vor der Startlinie, mit gelben Kanten; Kabel zur Uhr
    this.slope(props, 0, LINE_F + 0.06, LINE_F + 0.38, lift + 0.022, RAMP_HALF * 2 - 0.1, 0.022, lin('#141416'));
    for (const df of [0.07, 0.37]) this.slope(props, 0, LINE_F + df - 0.012, LINE_F + df + 0.012, lift + 0.026, RAMP_HALF * 2 - 0.12, 0.006, lin('#f2c230'));
    this.slope(props, RAMP_HALF - 0.05, LINE_F + 0.2, LINE_F + 0.3, lift + 0.012, 0.25, 0.012, lin('#141416'));
    this.box(props, 2.6, this.road(LINE_F + 0.25) + 0.15, LINE_F + 0.25, 0.14, 0.28, 0.2, lin('#2b2e33'));
    // Banden links und rechts: Platten mit Werbung innen und außen, weiße Kappe, Füße
    let k = 11;
    for (const sg of [-1, 1]) {
      for (let f0 = 0; f0 < RAMP_END - 0.01; f0 += 1.6) {
        const f1 = f0 + 1.6;
        const b0 = this.road(f0) + 0.03, b1 = this.road(f1) + 0.03;
        for (const side of [-1, 1]) {
          const x = sg * (BOARD_X + side * 0.025);
          const [u0, v0, u1, v1] = adCell(k++ % AD_COUNT, false);
          const A0 = P(x, b0, f0), B0 = P(x, b1, f1), B1 = P(x, b1 + 0.6, f1), A1 = P(x, b0 + 0.6, f0);
          // lesbar von dort, wohin die Fläche zeigt (innen zur Rampe, außen zum Publikum)
          const toRight = sg * side > 0;
          if (toRight) ads.quad(A0, B0, B1, A1, [1, 1, 1], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
          else ads.quad(B0, A0, A1, B1, [1, 1, 1], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
        }
        this.slope(props, sg * BOARD_X, f0, f1, 0.66, 0.08, 0.05, lin('#f4f4f2'));
        this.slope(props, sg * BOARD_X, f0, f1, 0.04, 0.07, 0.04, lin('#2b2d33'));
        this.box(props, sg * (BOARD_X + 0.12), this.road(f0) + 0.03, f0 + 0.05, 0.28, 0.06, 0.12, lin('#2b2d33'));
      }
      // Stirnseite am Fuß der Rampe
      this.box(props, sg * BOARD_X, this.road(RAMP_END) + 0.33, RAMP_END + 0.03, 0.08, 0.6, 0.06, lin('#f4f4f2'));
      // kleine Wimpel auf den Endpfosten
      const fp = RAMP_END + 0.03;
      const y = this.road(fp);
      this.box(props, sg * BOARD_X, y + 1.0, fp, 0.04, 1.3, 0.04, lin('#d0d4d8'));
      const flag = lin(sg < 0 ? this.d.accent : '#f4f4f2');
      props.tri(P(sg * BOARD_X, y + 1.62, fp), P(sg * BOARD_X, y + 1.3, fp), P(sg * BOARD_X - sg * 0.02, y + 1.46, fp + 0.55), flag);
      props.tri(P(sg * BOARD_X, y + 1.3, fp), P(sg * BOARD_X, y + 1.62, fp), P(sg * BOARD_X - sg * 0.02, y + 1.46, fp + 0.55), flag);
    }
  }

  /** Lage der Anzeige der Startuhr (Mitte, Drehung) */
  private clockFrame() {
    const f = 1.25;
    return { x: 2.02, f, y: this.road(f) + 2.36, yaw: -0.3 };
  }

  /** Startuhr: Mast neben der rechten Bande, Ausleger, Kasten mit Anzeige (zum Fahrer gedreht), kleiner Lautsprecher */
  private clockStand(props: GB) {
    const c = this.clockFrame();
    const dark = lin('#1d1f23');
    const metal = lin('#9aa1a9');
    const px = 3.02, pf = c.f;
    const y = this.road(pf);
    this.box(props, px, y + 0.03, pf, 0.42, 0.06, 0.42, dark);
    props.add(new THREE.CylinderGeometry(0.045, 0.055, 2.9, 8), M4(px, y + 1.45, pf), metal);
    this.box(props, (px + c.x) / 2 - 0.05, y + 2.86, pf, px - c.x + 0.2, 0.07, 0.07, metal);
    for (const dx of [-0.28, 0.28]) {
      const hx = c.x + dx * Math.cos(c.yaw);
      this.box(props, hx, y + 2.74, pf + dx * Math.sin(c.yaw), 0.025, 0.2, 0.025, metal);
    }
    // Kasten (die Anzeige liegt vorn darauf)
    this.box(props, c.x, c.y, c.f, 0.92, 0.66, 0.14, dark, c.yaw);
    // Schild „CRONO“ darüber und Lautsprecher (piept die letzten Sekunden)
    this.box(props, c.x, c.y + 0.4, c.f, 0.92, 0.12, 0.12, lin(this.d.accent), c.yaw);
    props.add(new THREE.CylinderGeometry(0.07, 0.1, 0.16, 10), M4(c.x + 0.52, c.y - 0.12, c.f, c.yaw, Math.PI / 2), dark);
  }

  /** Lautsprechermast links an der Rampe */
  private speakers(props: GB) {
    const x = -3.32, f = 5.2;
    const y = this.road(f);
    const grey = lin('#c9cdd2');
    props.add(new THREE.CylinderGeometry(0.04, 0.05, 3.6, 8), M4(x, y + 1.8, f), lin('#8d939b'));
    this.box(props, x, y + 0.03, f, 0.5, 0.06, 0.5, lin('#2b2d33'));
    for (const [ry, rz] of [[0.35, -0.25], [-2.6, -0.2]]) {
      // Trichter: offener Kegel, Öffnung zur Straße
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x + 0.08, y + 3.45, -f), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, Math.PI / 2 + rz, 'YXZ')), new THREE.Vector3(1, 1, 1));
      props.add(new THREE.CylinderGeometry(0.2, 0.06, 0.42, 10, 1, true), m, grey);
      props.add(new THREE.CylinderGeometry(0.075, 0.075, 0.16, 8), m.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.27, 0)), lin('#5a5f66'));
    }
  }

  /** TV-Motorrad, abgestellt am rechten Rand hinter der Rampe (wartet auf den Fahrer) */
  private moto(props: GB) {
    const x = 3.28, f = 15.6;
    const y = this.road(f);
    const base = M4(x, y, f, 0, 0, -0.1);
    const put = (g: THREE.BufferGeometry, m: THREE.Matrix4, col: RGBf) => props.add(g, m.premultiply(base), col);
    const T = (px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
    const white = lin('#f2f3f5'), navy = lin('#1f2a44'), black = lin('#141416'), metal = lin('#9aa1a9');
    const acc = lin(this.d.accent);
    for (const z of [-0.74, 0.72]) {
      put(new THREE.CylinderGeometry(0.31, 0.31, 0.13, 18), T(0, 0.31, -z, 0, 0, Math.PI / 2), black);
      put(new THREE.CylinderGeometry(0.17, 0.17, 0.14, 12), T(0, 0.31, -z, 0, 0, Math.PI / 2), metal);
    }
    // Gabel, Rahmen, Motor, Tank, Verkleidung, Scheibe, Sitz, Topcase mit „TV“-Streifen, Antenne
    for (const sx of [-0.09, 0.09]) put(new THREE.CylinderGeometry(0.025, 0.025, 0.75, 6), T(sx, 0.62, 0.62, 0.42), metal);
    put(new THREE.BoxGeometry(0.3, 0.36, 0.72), T(0, 0.5, 0), lin('#3a3d44'));
    put(new THREE.BoxGeometry(0.36, 0.2, 0.46), T(0, 0.82, 0.18), white);
    put(new THREE.BoxGeometry(0.52, 0.46, 0.3), T(0, 0.86, 0.58, 0.25), white);
    put(new THREE.BoxGeometry(0.53, 0.08, 0.31), T(0, 0.74, 0.58, 0.25), navy);
    put(new THREE.BoxGeometry(0.42, 0.34, 0.02), T(0, 1.22, 0.7, -0.45), lin('#a9c9de'));
    put(new THREE.BoxGeometry(0.3, 0.1, 0.72), T(0, 0.86, -0.22), black);
    put(new THREE.BoxGeometry(0.46, 0.36, 0.42), T(0, 1.08, -0.58), white);
    put(new THREE.BoxGeometry(0.47, 0.09, 0.43), T(0, 1.02, -0.58), acc);
    put(new THREE.BoxGeometry(0.76, 0.035, 0.035), T(0, 1.06, 0.45), black);
    for (const sx of [-0.36, 0.36]) put(new THREE.BoxGeometry(0.1, 0.06, 0.02), T(sx, 1.2, 0.48), black);
    put(new THREE.CylinderGeometry(0.008, 0.012, 1.5, 4), T(-0.18, 1.95, -0.72), black);
    put(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 8), T(0.2, 0.4, -0.55, Math.PI / 2 - 0.15), metal);
    put(new THREE.CylinderGeometry(0.015, 0.015, 0.35, 4), T(0.22, 0.16, 0.05, 0, 0, -0.5), metal);
  }

  /** runder Schatten unter einer Person (oder dem Wagen) */
  private blob(flat: GB, x: number, f: number, y: number, size: number, len = size) {
    flat.uv = true;
    const yy = y + 0.03;
    flat.quad(P(x - size / 2, yy, f - len / 2), P(x + size / 2, yy, f - len / 2), P(x + size / 2, yy, f + len / 2), P(x - size / 2, yy, f + len / 2), [1, 1, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }

  // ------------------------------------------------------------------ Teamwagen

  /** Teamwagen in den Farben des Fahrers (Kombi mit Dachträger und zwei Ersatzrädern) */
  private buildCar(kit: Kit) {
    const gb = new GB();
    const paint = lin(kit.jersey);
    const side = lin(kit.side);
    const glass = lin('#26303a');
    const black = lin('#141416');
    const metal = lin('#b9bec5');
    const y = this.road(CAR_F) + this.side(CAR_F, -1, -CAR_X - EDGE);
    const base = M4(CAR_X, y, CAR_F);
    const put = (g: THREE.BufferGeometry, x: number, yy: number, z: number, col: RGBf, rx = 0, ry = 0, rz = 0) =>
      gb.add(g, new THREE.Matrix4().compose(new THREE.Vector3(x, yy, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)).premultiply(base), col);
    // Seitenriss (z: vorn −2,3 … hinten +2,3), quer gezogen: Unterbau und Fahrgastraum (je konvex)
    const prism = (pts: [number, number][], hw: number, col: RGBf, sideCol: RGBf) => {
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const [z0, y0] = pts[i], [z1, y1] = pts[(i + 1) % n];
        const q = [[-hw, y0, z0], [hw, y0, z0], [hw, y1, z1], [-hw, y1, z1]].map((p) => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(base).toArray());
        gb.quad(q[0], q[3], q[2], q[1], col);
      }
      for (const sg of [-1, 1]) {
        const c = pts.map(([z, yy]) => new THREE.Vector3(sg * hw, yy, z).applyMatrix4(base).toArray());
        for (let i = 1; i + 1 < n; i++) {
          if (sg > 0) gb.tri(c[0], c[i], c[i + 1], sideCol); else gb.tri(c[0], c[i + 1], c[i], sideCol);
        }
      }
    };
    // Umriss im Uhrzeigersinn von rechts gesehen (z nach hinten, y hoch)
    prism([[-2.3, 0.36], [-2.33, 0.6], [-2.2, 0.82], [-1.1, 0.95], [2.2, 0.98], [2.3, 0.86], [2.3, 0.36]], 0.9, paint, paint);
    prism([[-1.05, 0.95], [-0.25, 1.45], [1.95, 1.47], [2.22, 0.98]], 0.82, glass, glass);
    // Dach, Säulen, Zierstreifen in der zweiten Trikotfarbe
    put(new THREE.BoxGeometry(1.62, 0.05, 2.12), 0, 1.47, 0.85, paint);
    for (const z of [0.55, 1.9]) for (const sg of [-1, 1]) put(new THREE.BoxGeometry(0.06, 0.5, 0.08), sg * 0.8, 1.2, z, paint);
    for (const sg of [-1, 1]) put(new THREE.BoxGeometry(0.02, 0.12, 4.4), sg * 0.905, 0.72, 0, side);
    put(new THREE.BoxGeometry(1.4, 0.02, 0.6), 0, 0.96, -1.6, side);
    // Räder mit Felgen
    for (const z of [-1.45, 1.5]) for (const sg of [-1, 1]) {
      put(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 16), sg * 0.8, 0.33, z, black, 0, 0, Math.PI / 2);
      put(new THREE.CylinderGeometry(0.2, 0.2, 0.25, 10), sg * 0.8, 0.33, z, metal, 0, 0, Math.PI / 2);
    }
    // Lichter, Kennzeichen, Spiegel, Antenne
    for (const sg of [-1, 1]) {
      put(new THREE.BoxGeometry(0.3, 0.1, 0.04), sg * 0.6, 0.72, -2.31, lin('#f6f2e4'));
      put(new THREE.BoxGeometry(0.22, 0.14, 0.04), sg * 0.7, 0.78, 2.31, lin('#c0241b'));
      put(new THREE.BoxGeometry(0.16, 0.1, 0.06), sg * 0.98, 1.08, -0.95, paint);
    }
    put(new THREE.BoxGeometry(0.5, 0.12, 0.02), 0, 0.5, -2.34, lin('#f4f4f2'));
    put(new THREE.BoxGeometry(0.5, 0.12, 0.02), 0, 0.55, 2.31, lin('#f4f4f2'));
    put(new THREE.CylinderGeometry(0.006, 0.01, 0.6, 4), 0.3, 1.78, 1.6, black);
    // Dachträger mit zwei Ersatzrädern (eins nach vorn, eins nach hinten), Rahmen in Trikotfarbe
    for (const z of [0.15, 1.55]) put(new THREE.BoxGeometry(1.5, 0.04, 0.05), 0, 1.53, z, black);
    for (const sg of [-1, 1]) put(new THREE.BoxGeometry(0.04, 0.05, 1.6), sg * 0.42, 1.55, 0.85, black);
    for (const [x, ry] of [[-0.42, 0], [0.42, Math.PI]] as [number, number][]) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 1.56, 0.85), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1)).premultiply(base);
      bike(gb, m, paint);
    }
    const g = gb.build();
    // der Mechaniker trägt die Teamfarben
    if (this.mech >= 0) {
      const m = this.staff[this.mech];
      m.h.dispose();
      m.h.group.removeFromParent();
      m.h = new Human(lookFor(mulberry32(7), 'mechanic', kit), 3);
      m.h.act = m.act;
      this.root.add(m.h.group);
      this.place(this.mech);
    }
    if (this.car) { this.local.remove(this.car); this.car.geometry.dispose(); }
    this.car = new THREE.Mesh(g, this.d.props);
    this.local.add(this.car);
  }

  // ------------------------------------------------------------------ Laufzeit

  /** Startkoordinaten → Welt (die Strecke ist am Start gerade; hinter dem Start geradeaus zurück) */
  private world(x: number, y: number, f: number, out: THREE.Vector3): THREE.Vector3 {
    const th = this.W0.th;
    return out.set(this.W0.x + Math.cos(th) * x + Math.sin(th) * f, this.y0 + y, this.W0.z + Math.sin(th) * x - Math.cos(th) * f);
  }

  /** Mensch an seinen Ort, Blick in seine Richtung (yaw: in Startkoordinaten, 0 = nach vorn) */
  private place(i: number) {
    const s = this.staff[i];
    this.world(s.x, s.y, s.f, s.h.group.position);
    // Gesicht des Menschen ist −z; Startrichtung (sin th, −cos th) entspricht Drehung −th
    s.h.group.rotation.y = -this.W0.th - s.yaw;
  }

  private paintClock(st: ClockState) {
    const key = `${st.big}|${st.col}|${st.lamps}|${st.lampCol}|${st.small}`;
    if (key === this.clockKey) return;
    this.clockKey = key;
    const c = this.clockCv.getContext('2d')!;
    const W = this.clockCv.width, H = this.clockCv.height;
    c.fillStyle = '#060607';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#16171b';
    c.fillRect(4, 4, W - 8, H - 8);
    // Kopfzeile
    c.fillStyle = this.d.accent;
    c.fillRect(4, 4, W - 8, 26);
    c.fillStyle = '#ffffff';
    c.font = '800 17px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(`gruppetto · ${st.small}`, W / 2, 18);
    // große Ziffern (Leuchtziffern mit Schein)
    c.font = `900 ${st.big.length > 5 ? 62 : st.big.length > 3 ? 82 : 100}px "SF Mono", Menlo, Consolas, "Courier New", monospace`;
    c.shadowColor = st.col;
    c.shadowBlur = 14;
    c.fillStyle = st.col;
    c.fillText(st.big, W / 2, 92);
    c.shadowBlur = 0;
    // fünf Lampen
    for (let i = 0; i < 5; i++) {
      const x = W / 2 + (i - 2) * 38;
      const on = i < st.lamps;
      c.beginPath();
      c.arc(x, 152, 12, 0, Math.PI * 2);
      c.fillStyle = on ? st.lampCol : '#2a1414';
      if (on) { c.shadowColor = st.lampCol; c.shadowBlur = 12; }
      c.fill();
      c.shadowBlur = 0;
    }
    this.clockTex.needsUpdate = true;
  }

  /** je Bild: Halter, Starter, Uhr, Blitze; Teamwagen in den Farben des Fahrers */
  update(g: RaceView, dt: number) {
    const p = g.p;
    // Lage des Fahrers ab dem Start
    const pz = p.z - this.f0;
    const phase = g.phase as string;
    const near = pz < 260 || phase === 'ready' || phase === 'countdown';
    this.root.visible = near;
    if (!near) return;
    // Teamwagen (erst, wenn das Trikot feststeht)
    const kk = `${p.kit.jersey}|${p.kit.side}`;
    if (kk !== this.carKit && !this.d.flush) { this.carKit = kk; this.buildCar(p.kit); }
    if (phase !== this.lastPhase) {
      if (phase === 'playing' && (this.lastPhase === 'countdown' || this.lastPhase === '')) this.goT = 0;
      if (phase === 'ready' || phase === 'countdown') this.goT = -1;
      this.lastPhase = phase;
    }
    const waiting = phase === 'ready' || phase === 'countdown';
    if (this.goT >= 0) this.goT += dt;
    // Halter steht links hinter dem Rad, die Hände am Sattel (folgt der Startposition des Fahrers)
    if (waiting && Math.abs(p.x - this.holdX) > 0.01) {
      this.holdX = p.x;
      const h = this.staff[this.holder];
      h.x = p.x - 0.52;
      h.f = -0.62;
      h.yaw = Math.atan2(0.52, 0.4);
      this.place(this.holder);
    }
    // Fahrer (Kopf) – dorthin schauen alle; Sattel – dort greift der Halter
    this.world(p.x, 1.55, pz, this.riderHead);
    const hold = this.staff[this.holder].h;
    this.world(p.x, 0.97, -0.21, hold.holdAt);
    // „Los“: der Halter lässt los und klatscht dem Fahrer hinterher, der Starter senkt die Hand
    const released = !waiting && (this.goT < 0 || this.goT > 0.12);
    hold.act = !released ? 'hold' : this.goT >= 0 && this.goT < 2.8 ? 'clap' : 'hands';
    this.staff[this.starter].h.act = phase === 'countdown' ? 'starter' : 'stand';
    // alle schauen zum Fahrer; Fotografen und Kameramann schwenken mit dem ganzen Körper mit
    for (let i = 0; i < this.staff.length; i++) {
      const s = this.staff[i];
      s.h.lookAt = i === this.holder && !released ? null : this.riderHead;
      if (s.track) {
        const want = Math.atan2(p.x - s.x, pz + 0.5 - s.f);
        let d = want - s.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        // nicht ganz herum (sie stehen am Rand und schauen die Straße entlang)
        s.yaw += Math.max(-1, Math.min(1, d)) * Math.min(1, dt * 4);
        this.place(i);
      }
      s.h.update(dt);
    }
    // Startuhr
    if (pz < 80) {
      let st: ClockState;
      if (phase === 'countdown') {
        const [from, step] = this.d.count ?? [5, 0.6];
        const n = Math.max(1, from - Math.floor(g.phaseT / step));
        st = { big: String(n), col: '#ff3b2f', lamps: Math.round((5 * (from - n + 1)) / from), lampCol: '#ff2a1f', small: 'START' };
      } else if (phase === 'playing' && this.goT >= 0 && this.goT < 1.6) {
        st = { big: 'GO', col: '#39e46b', lamps: 5, lampCol: '#2fe05a', small: 'START' };
      } else if (phase === 'playing') {
        const t = (g as RaceView & { time?: number }).time ?? g.phaseT;
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        st = { big: `${m}:${String(s).padStart(2, '0')}`, col: '#ffb02e', lamps: 0, lampCol: '#ff2a1f', small: 'CRONO' };
      } else {
        const d = new Date();
        st = { big: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, col: '#ffb02e', lamps: 0, lampCol: '#ff2a1f', small: 'CRONO' };
      }
      this.paintClock(st);
    }
    // Blitze: ab und zu beim Warten, eine Salve bei „Los“, Serienbilder, wenn der Fahrer vorbeikommt
    for (const fl of this.flashes) {
      const ph = this.staff[fl.who];
      if (fl.t > 0) { fl.t -= dt; if (fl.t <= 0) fl.s.visible = false; }
      fl.next -= dt;
      const gap = ph.f - pz;
      let want = false;
      if (phase === 'playing' && this.goT >= 0 && this.goT < 0.5 && fl.next > 0.6) fl.next = Math.random() * 0.4;
      if (fl.next <= 0) {
        want = true;
        const close = phase === 'playing' && gap > -3 && gap < 11;
        fl.next = close ? 0.25 + Math.random() * 0.3 : waiting ? 1.6 + Math.random() * 4 : 3 + Math.random() * 5;
        if (phase === 'playing' && gap < -3) fl.next = 1e9;
      }
      if (want) {
        fl.t = 0.07;
        fl.s.visible = true;
        fl.s.scale.setScalar(0.7 + Math.random() * 0.4);
        // über der Kamera (Aufsteckblitz)
        ph.h.props.getWorldPosition(fl.s.position);
        fl.s.position.y += 0.14;
      }
    }
  }

  dispose() {
    this.root.removeFromParent();
    for (const x of this.dis) x.dispose();
    this.dis = [];
    for (const s of this.staff) s.h.dispose();
    this.staff = [];
    if (this.car) { this.car.geometry.dispose(); this.car = null; }
  }
}

// ------------------------------------------------------------------ Teppich

/**
 * Teppich von Podest und Rampe (512 × 2048, von f = CV_F0 bis RAMP_END): Akzentfarbe mit Webstruktur, weiße Ränder,
 * Startlinie, „START“ lang gezogen (aus der Kamera hinter dem Fahrer lesbar), Pfeile die Rampe hinunter, das
 * Logo auf dem Podest hinter dem Fahrer und der Rahmen des Startplatzes.
 */
function carpetTex(accent: string, label = 'CRONOMETRO'): HTMLCanvasElement {
  const W = 512, H = 2048;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  const X = (x: number) => ((x + DECK_HALF) / (2 * DECK_HALF)) * W;
  const Y = (f: number) => ((RAMP_END - f) / (RAMP_END - CV_F0)) * H;
  const pxX = W / (2 * DECK_HALF);
  const pxF = H / (RAMP_END - CV_F0);
  const r = mulberry32(71);
  c.fillStyle = accent;
  c.fillRect(0, 0, W, H);
  // etwas tiefer als die Akzentfarbe (Teppich schluckt Licht)
  c.fillStyle = 'rgba(20,0,10,0.16)';
  c.fillRect(0, 0, W, H);
  // Webstruktur: feine Querrillen und Fasern
  c.globalAlpha = 0.05;
  for (let y = 0; y < H; y += 3) { c.fillStyle = (y / 3) % 2 ? '#000' : '#fff'; c.fillRect(0, y, W, 1); }
  c.globalAlpha = 0.07;
  for (let i = 0; i < 6000; i++) { c.fillStyle = r() < 0.5 ? '#000' : '#fff'; c.fillRect(r() * W, r() * H, 1, 1 + r() * 3); }
  c.globalAlpha = 1;
  // abgewetzte Spur, wo alle losrollen (etwas rechts der Mitte), mit Reifenspuren
  const gw = c.createLinearGradient(X(-0.7), 0, X(1.3), 0);
  gw.addColorStop(0, 'rgba(0,0,0,0)');
  gw.addColorStop(0.5, 'rgba(0,0,0,0.09)');
  gw.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = gw;
  c.fillRect(X(-0.7), 0, X(1.3) - X(-0.7), Y(0));
  c.globalAlpha = 0.12;
  c.strokeStyle = '#000';
  for (let i = 0; i < 9; i++) {
    const x0 = X(0.1 + (r() - 0.5) * 0.9);
    c.lineWidth = 1 + r() * 2;
    c.beginPath();
    c.moveTo(x0, Y(LINE_F));
    c.bezierCurveTo(x0 + (r() - 0.5) * 12, Y(4), x0 + (r() - 0.5) * 18, Y(7), x0 + (r() - 0.5) * 20, 0);
    c.stroke();
  }
  c.globalAlpha = 1;
  // weiße Ränder: Rampe (schmaler) und Podest
  c.fillStyle = '#f7f5f2';
  for (const sg of [-1, 1]) {
    c.fillRect(X(sg * (RAMP_HALF - 0.16)) - 3, 0, 6, Y(0));
    c.fillRect(X(sg * (DECK_HALF - 0.14)) - 3, Y(0), 6, H - Y(0));
  }
  // Startlinie (vor dem Vorderrad), dahinter der Rahmen des Startplatzes
  c.fillRect(X(-RAMP_HALF + 0.05), Y(LINE_F) - 0.06 * pxF, X(RAMP_HALF - 0.05) - X(-RAMP_HALF + 0.05), 0.12 * pxF);
  c.strokeStyle = 'rgba(247,245,242,0.85)';
  c.lineWidth = 4;
  c.setLineDash([14, 10]);
  c.strokeRect(X(-0.55), Y(LINE_F - 0.12), X(1.15) - X(-0.55), Y(-1.6) - Y(LINE_F - 0.12));
  c.setLineDash([]);
  // Schrift: aus der Kamera schräg von hinten gesehen – darum in Fahrtrichtung lang gezogen
  const stretch = 2.6 * (pxF / pxX);
  // style: Schnitt und Stärke (vor der Größe – so verlangt es die Schriftangabe), family: Schriftfamilien
  const word = (text: string, x: number, f: number, size: number, style: string, family: string, alpha = 1, maxW = W) => {
    c.save();
    c.translate(X(x), Y(f));
    c.scale(1, stretch);
    c.globalAlpha = alpha;
    c.font = `${style} ${size}px ${family}`;
    let s = size;
    while (c.measureText(text).width > maxW && s > 10) { s -= 2; c.font = `${style} ${s}px ${family}`; }
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#f7f5f2';
    c.fillText(text, 0, 0);
    c.restore();
  };
  const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
  word('START', 0, 3.5, 104, 'italic 900', SANS, 0.95, X(2.25) - X(-2.25));
  // Pfeile die Rampe hinunter
  c.fillStyle = 'rgba(247,245,242,0.55)';
  for (const f of [6.0, 7.2, 8.4]) {
    const t = 0.24;
    c.beginPath();
    c.moveTo(X(-1.1), Y(f - 0.55));
    c.lineTo(X(0), Y(f + 0.25));
    c.lineTo(X(1.1), Y(f - 0.55));
    c.lineTo(X(1.1), Y(f - 0.55 + t));
    c.lineTo(X(0), Y(f + 0.25 + t));
    c.lineTo(X(-1.1), Y(f - 0.55 + t));
    c.closePath();
    c.fill();
  }
  // Logo auf dem Podest hinter dem Fahrer
  word('gruppetto', 0, -2.25, 58, '800', '"Arial Rounded MT Bold", "SF Pro Rounded", ui-rounded, ' + SANS, 0.85, X(1.45) - X(-1.45));
  word(label, 0, -3.35, 22, '700', SANS, 0.6, X(1.1) - X(-1.1));
  return cv;
}
