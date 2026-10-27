/**
 * Leben am Himmel: kreisende Adler, Gleitschirme über dem Tal, ab und zu ein Heißluftballon und in den
 * Rennfinals der Fernsehhubschrauber über dem Feld. Alles sind wenige kleine Modelle; sie hängen an Punkten
 * entlang der Strecke vor dem Fahrer und werden neu verteilt, sobald sie hinter ihm liegen.
 */
import * as THREE from 'three';
import { GB, lin, type RGBf } from './models3d';
import type { BiomeId, Track } from './track';

const M = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

/** dünner Stab von a nach b */
function rod(g: GB, a: THREE.Vector3, b: THREE.Vector3, r: number, col: RGBf) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()), new THREE.Vector3(1, 1, 1));
  g.add(new THREE.CylinderGeometry(r, r, d.length(), 3), m, col);
}

const rnd = (n: number) => { let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };

/** Adler: Rumpf, zwei Flügel (eigene Teile zum Schlagen), gespreizte Schwanzfedern */
function eagle(): { body: THREE.BufferGeometry; wing: THREE.BufferGeometry } {
  const b = new GB();
  const brown = lin('#4a3524');
  b.add(new THREE.SphereGeometry(0.16, 8, 6), M(0, 0, 0, 1, 0.8, 2.6), brown);
  b.add(new THREE.SphereGeometry(0.1, 8, 6), M(0, 0.05, -0.42), lin('#e9e2d0'));
  b.add(new THREE.ConeGeometry(0.035, 0.1, 5), M(0, 0.03, -0.53, 1, 1, 1, 0, -Math.PI / 2), lin('#e0b030'));
  b.add(new THREE.ConeGeometry(0.2, 0.42, 5), M(0, 0, 0.55, 1.6, 0.25, 1, 0, Math.PI / 2), lin('#3c2a1c'));
  // Flügel nach rechts (+x), links gespiegelt; gefingerte Handschwingen
  const w = new GB();
  const wc: RGBf = lin('#5a4230');
  const tip: RGBf = lin('#2c1f15');
  const P = (x: number, z: number) => [x, 0.02 * x, z];
  w.quad(P(0.05, -0.18), P(0.05, 0.2), P(0.75, 0.24), P(0.8, -0.2), wc);
  w.quad(P(0.8, -0.2), P(0.75, 0.24), P(1.05, 0.2), P(1.1, -0.12), wc);
  for (let f = 0; f < 4; f++) {
    const z0 = -0.12 + f * 0.08;
    w.quad(P(1.1, z0), P(1.08, z0 + 0.06), P(1.3 - f * 0.03, z0 + 0.07), P(1.32 - f * 0.03, z0 + 0.02), tip);
  }
  return { body: b.build(), wing: w.build() };
}

/** Gleitschirm: gewölbte Kappe aus Zellen in zwei Farben, Leinen angedeutet, Pilot im Gurtzeug */
function paraglider(a: string, c: string): THREE.BufferGeometry {
  const g = new GB();
  const A = lin(a);
  const B = lin(c);
  const N = 14;
  const span = 5.2;
  const chord = 1.6;
  for (let i = 0; i < N; i++) {
    const t0 = i / N;
    const t1 = (i + 1) / N;
    const arc = (t: number) => { const ang = (t - 0.5) * 2.3; return [Math.sin(ang) * span, Math.cos(ang) * span * 0.62 - span * 0.62 + 6.4]; };
    const [x0, y0] = arc(t0);
    const [x1, y1] = arc(t1);
    const ch = (t: number) => chord * (1 - Math.pow(Math.abs(t - 0.5) * 2, 3) * 0.45);
    const col = i % 3 === 1 ? B : A;
    const f0 = -ch(t0) / 2, r0 = ch(t0) / 2, f1 = -ch(t1) / 2, r1 = ch(t1) / 2;
    g.quad([x0, y0, f0], [x1, y1, f1], [x1, y1 + 0.03, r1], [x0, y0 + 0.03, r0], col);
    g.quad([x0, y0 - 0.22, f0 + 0.1], [x1, y1 - 0.22, f1 + 0.1], [x1, y1, f1], [x0, y0, f0], [col[0] * 0.7, col[1] * 0.7, col[2] * 0.7]);
  }
  // Leinen zum Piloten
  const line = lin('#d9d9d9');
  for (const x of [-3.2, -1.5, 1.5, 3.2]) rod(g, new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(x, 6.1 - Math.abs(x) * 0.25, 0), 0.012, line);
  g.add(new THREE.CapsuleGeometry(0.22, 0.55, 3, 6), M(0, 0.1, 0.1, 1, 1, 1, 0, 1.1), lin('#2a3140'));
  g.add(new THREE.SphereGeometry(0.15, 6, 5), M(0, 0.55, -0.15), lin('#e8c84a'));
  return g.build();
}

/** Heißluftballon: Hülle in Bahnen, Korb an Seilen */
function balloon(cols: string[]): THREE.BufferGeometry {
  const g = new GB();
  const N = 16;
  const rings: [number, number][] = [[0.9, 0], [3.2, 1.6], [6.6, 4.8], [8.3, 8.6], [8.4, 11.6], [7.6, 14.2], [5.4, 16.4], [2.4, 17.6], [0.2, 17.9]];
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2;
    const a1 = ((i + 1) / N) * Math.PI * 2;
    const col = lin(cols[i % cols.length]);
    for (let k = 0; k < rings.length - 1; k++) {
      const [r0, h0] = rings[k];
      const [r1, h1] = rings[k + 1];
      const p = (r: number, h: number, a: number) => [Math.cos(a) * r, h + 4, Math.sin(a) * r];
      g.quad(p(r0, h0, a0), p(r0, h0, a1), p(r1, h1, a1), p(r1, h1, a0), col);
    }
  }
  g.add(new THREE.BoxGeometry(1.2, 1.0, 1.2), M(0, 0.5, 0), lin('#8a6a42'));
  for (const [x, z] of [[-0.55, -0.55], [0.55, -0.55], [0.55, 0.55], [-0.55, 0.55]]) rod(g, new THREE.Vector3(x, 1, z), new THREE.Vector3(x * 1.4, 4.1, z * 1.4), 0.025, lin('#5a4a38'));
  return g.build();
}

/** Fernsehhubschrauber: Rumpf, Heckausleger, Kufen, Kamera unten; Rotor als eigenes Teil */
function helicopter(): { body: THREE.BufferGeometry; rotor: THREE.BufferGeometry } {
  const b = new GB();
  const red = lin('#c8102e');
  const dark = lin('#22262c');
  b.add(new THREE.SphereGeometry(1, 12, 9), M(0, 0, 0, 1.1, 1.05, 2.0), red);
  b.add(new THREE.SphereGeometry(0.98, 12, 9, 0, Math.PI * 2, 0, 1.2), M(0, 0.05, -0.85, 1.0, 0.95, 1.2, 0, -0.5), lin('#8fb6d6'));
  b.add(new THREE.CylinderGeometry(0.18, 0.32, 4.6, 8), M(0, 0.3, 3.2, 1, 1, 1, 0, Math.PI / 2), red);
  b.add(new THREE.BoxGeometry(0.08, 1.1, 0.7), M(0, 0.85, 5.3), red);
  b.add(new THREE.BoxGeometry(1.6, 0.06, 0.4), M(0, 0.35, 4.9), red);
  for (const sx of [-0.85, 0.85]) {
    b.add(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6), M(sx, -1.25, 0, 1, 1, 1, 0, Math.PI / 2), dark);
    b.add(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 5), M(sx * 0.85, -0.95, -0.7, 1, 1, 1, 0, 0, sx * 0.3), dark);
    b.add(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 5), M(sx * 0.85, -0.95, 0.7, 1, 1, 1, 0, 0, sx * 0.3), dark);
  }
  b.add(new THREE.SphereGeometry(0.28, 8, 6), M(0, -1.0, -1.3), lin('#e8e8e8'));
  b.add(new THREE.CylinderGeometry(0.1, 0.12, 0.5, 6), M(0, 1.1, 0), dark);
  const r = new GB();
  for (let i = 0; i < 4; i++) r.add(new THREE.BoxGeometry(0.22, 0.04, 5.6), M(0, 0, 0, 1, 1, 1, (i * Math.PI) / 2 + Math.PI / 4), dark);
  return { body: b.build(), rotor: r.build() };
}

interface Flyer {
  obj: THREE.Object3D;
  kind: 'eagle' | 'glider' | 'balloon';
  ax: number; ay: number; az: number;   // Anker (Welt)
  r: number; ph: number; w: number; z: number;
  wings?: THREE.Object3D[];
}

const KIND_OK: Record<BiomeId, { glider: number; balloon: number }> = {
  pass: { glider: 2, balloon: 0 }, alpine: { glider: 3, balloon: 0 }, forest: { glider: 1, balloon: 0 },
  village: { glider: 2, balloon: 1 }, lake: { glider: 3, balloon: 1 }, vineyard: { glider: 0, balloon: 1 },
};

export class SkyLife {
  readonly group = new THREE.Group();
  private flyers: Flyer[] = [];
  private heli: THREE.Group | null = null;
  private rotor: THREE.Mesh | null = null;
  private heliPos = new THREE.Vector3();
  private heliInit = false;
  private mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  private rotorMat = new THREE.MeshBasicMaterial({ color: 0x1a1d22, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
  private seed = 1;
  private w = { x: 0, y: 0, z: 0, th: 0 };
  private geos: THREE.BufferGeometry[] = [];

  constructor() {
    const e = eagle();
    this.geos.push(e.body, e.wing);
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(e.body, this.mat);
      const wr = new THREE.Mesh(e.wing, this.mat);
      const wl = new THREE.Mesh(e.wing, this.mat);
      wl.scale.x = -1;
      g.add(body, wr, wl);
      g.scale.setScalar(1.4);
      this.flyers.push({ obj: g, kind: 'eagle', ax: 0, ay: 0, az: 1e9, r: 0, ph: 0, w: 0, z: -1e9, wings: [wr, wl] });
      this.group.add(g);
    }
    const gl = [['#ff5f2e', '#ffd23f'], ['#2f80ed', '#f4f4f4'], ['#27ae60', '#ff5fa2'], ['#9b51e0', '#ffd23f']];
    for (let i = 0; i < 3; i++) {
      const geo = paraglider(gl[i][0], gl[i][1]);
      this.geos.push(geo);
      const m = new THREE.Mesh(geo, this.mat);
      this.flyers.push({ obj: m, kind: 'glider', ax: 0, ay: 0, az: 1e9, r: 0, ph: 0, w: 0, z: -1e9 });
      this.group.add(m);
    }
    const bgeo = balloon(['#e74c3c', '#ffd23f', '#2f80ed', '#ffffff']);
    this.geos.push(bgeo);
    const bm = new THREE.Mesh(bgeo, this.mat);
    this.flyers.push({ obj: bm, kind: 'balloon', ax: 0, ay: 0, az: 1e9, r: 0, ph: 0, w: 0, z: -1e9 });
    this.group.add(bm);
    for (const f of this.flyers) f.obj.visible = false;
  }

  reset() {
    for (const f of this.flyers) { f.z = -1e9; f.obj.visible = false; }
    this.heliInit = false;
  }

  private place(f: Flyer, t: Track, pz: number, i: number) {
    const s = rnd(this.seed++ * 31 + i);
    const ahead = f.kind === 'eagle' ? 160 + s * 320 : f.kind === 'glider' ? 380 + s * 700 : 900 + s * 900;
    const side = (rnd(this.seed * 7 + i) < 0.5 ? -1 : 1) * (f.kind === 'eagle' ? 40 + s * 160 : 150 + rnd(this.seed * 3) * 450);
    t.world(pz + ahead, side, 0, this.w);
    f.z = pz + ahead;
    f.ax = this.w.x;
    f.az = this.w.z;
    const up = f.kind === 'eagle' ? 45 + s * 90 : f.kind === 'glider' ? 140 + s * 260 : 260 + s * 300;
    f.ay = this.w.y + up;
    f.r = f.kind === 'eagle' ? 25 + s * 40 : f.kind === 'glider' ? 60 + s * 120 : 0;
    f.ph = s * Math.PI * 2;
    f.w = (f.kind === 'eagle' ? 0.22 : 0.07) * (rnd(this.seed * 5 + i) < 0.5 ? -1 : 1) * (0.8 + s * 0.4);
  }

  /**
   * Jedes Bild: Flieger bewegen, hinter dem Fahrer liegende neu vor ihm verteilen. biome bestimmt, was fliegt
   * (keine Gleitschirme im Weinbau, Ballone nur in offenen Tälern). leader: Spitze des Feldes in den Finals.
   */
  update(t: Track, pz: number, time: number, dt: number, biome: BiomeId, night: number, leader: THREE.Vector3 | null, cam: THREE.Vector3) {
    const ok = KIND_OK[biome];
    let gliders = 0;
    // nachts kein Betrieb am Himmel (nur die Adler suchen noch ihren Horst)
    const day = night < 0.55;
    this.flyers.forEach((f, i) => {
      const allowed = f.kind === 'eagle' ? true : f.kind === 'glider' ? day && gliders++ < ok.glider : day && ok.balloon > 0 && rnd(Math.floor(pz / 3000) + 17) < 0.6;
      if (!allowed) { f.obj.visible = false; return; }
      if (f.z < pz - 150 || f.z > pz + 2600) this.place(f, t, pz, i);
      f.obj.visible = true;
      const o = f.obj;
      if (f.kind === 'balloon') {
        // treibt langsam, steigt und sinkt sanft
        o.position.set(f.ax + Math.sin(time * 0.02 + f.ph) * 40, f.ay + Math.sin(time * 0.05 + f.ph) * 12, f.az + Math.cos(time * 0.017 + f.ph) * 40);
        o.rotation.y = time * 0.03;
        return;
      }
      const a = f.ph + time * f.w;
      const x = f.ax + Math.cos(a) * f.r;
      const z = f.az + Math.sin(a) * f.r;
      const y = f.ay + Math.sin(time * 0.3 + f.ph) * (f.kind === 'eagle' ? 3 : 8);
      o.position.set(x, y, z);
      // Flugrichtung: Tangente des Kreises, in die Kurve geneigt
      const dir = Math.sign(f.w);
      o.rotation.order = 'YXZ';
      o.rotation.y = -a + (dir > 0 ? Math.PI : 0);
      o.rotation.z = dir * (f.kind === 'eagle' ? 0.35 : 0.22);
      if (f.wings) {
        // meist segeln, ab und zu ein paar Flügelschläge
        const flap = Math.max(0, Math.sin(time * 0.4 + f.ph * 3)) > 0.93 ? Math.sin(time * 9) * 0.5 : 0.08;
        f.wings[0].rotation.z = flap;
        f.wings[1].rotation.z = -flap;
      }
    });
    // Fernsehhubschrauber: begleitet das Feld schräg vor und über der Spitze
    if (leader) {
      if (!this.heli) {
        const h = helicopter();
        this.geos.push(h.body, h.rotor);
        this.heli = new THREE.Group();
        this.heli.add(new THREE.Mesh(h.body, this.mat));
        this.rotor = new THREE.Mesh(h.rotor, this.rotorMat);
        this.rotor.position.y = 1.35;
        this.heli.add(this.rotor);
        this.heli.scale.setScalar(1.15);
        this.group.add(this.heli);
      }
      const want = new THREE.Vector3(leader.x + 22, leader.y + 38 + Math.sin(time * 0.4) * 2, leader.z);
      // seitlich vor dem Feld (in Fahrtrichtung: Kamera → Spitze)
      const fx = leader.x - cam.x;
      const fz = leader.z - cam.z;
      const l = Math.hypot(fx, fz) || 1;
      want.x = leader.x + (fx / l) * 45 + (-fz / l) * 28;
      want.z = leader.z + (fz / l) * 45 + (fx / l) * 28;
      if (!this.heliInit) { this.heliPos.copy(want); this.heliInit = true; }
      this.heliPos.lerp(want, Math.min(1, dt * 0.8));
      this.heli.position.copy(this.heliPos);
      // schaut zum Feld, leicht nach vorn geneigt
      this.heli.rotation.order = 'YXZ';
      this.heli.rotation.y = Math.atan2(-(leader.x - this.heliPos.x), -(leader.z - this.heliPos.z)) + Math.PI;
      this.heli.rotation.x = -0.08;
      this.heli.visible = true;
      if (this.rotor) this.rotor.rotation.y = time * 28;
    } else if (this.heli) this.heli.visible = false;
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    this.mat.dispose();
    this.rotorMat.dispose();
  }
}
