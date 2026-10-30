/**
 * Weitere Bauten der Dörfer (Geometrie, für WebGL und WebGPU): Dorfkirche mit Zwiebelturm und Stadel (Scheune). Gleicher Baukasten und
 * gleiche fünf Materialien wie das Alpenhaus (alphouse.ts) – so stehen sie als Instanzen in denselben Gruppen-Arten
 * und kosten je Stufe fünf Zeichenaufrufe.
 *
 * Kirche (lokal): Eingang mit Vorhalle vorn (+z), Langhaus x = ±5,2, z = −8 … +8, Chor als halbes Achteck hinten,
 * Turm hinten rechts (x 5 … 9,4), Zwiebelhaube mit Laterne und Kreuz (~31 m). Boden der Kirche bei y = 0,5.
 * Stadel: Bruchsteinsockel mit Stall, darüber Bretterwand mit Luftschlitzen, großes Tor, weites Schindeldach.
 */
import * as THREE from 'three';
import { Builder, cross, DOOR, Face, fbox, FASCHE, GLASS, IRON, norm, QUOIN, reveal, rnd, sub, wall, type HMat, type Hole, type V3 } from './alphouse';

const dotV = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** ebene Fläche mit Texturkoordinaten in Metern: u entlang uDir (z. B. First), v quer dazu in der Fläche */
function plane(b: Builder, pts: V3[], uDir: V3, want?: V3) {
  let n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
  if (want && dotV(n, want) < 0) { pts = [...pts].reverse(); n = [-n[0], -n[1], -n[2]]; }
  const tu = norm(uDir);
  const tv = norm(cross(n, tu));
  b.poly(pts, pts.map((p) => [dotV(p, tu), dotV(p, tv)] as [number, number]), tu, tv);
}

/** Drehkörper um die senkrechte Achse (cx, cz): Profil [y, r] von unten nach oben, seg Seiten */
function lathe(b: Builder, cx: number, cz: number, prof: [number, number][], seg: number) {
  for (let i = 0; i + 1 < prof.length; i++) {
    const [y0, r0] = prof[i], [y1, r1] = prof[i + 1];
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      const P = (a: number, r: number, y: number): V3 => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
      const am = (a0 + a1) / 2;
      const out: V3 = [Math.cos(am) * (y1 - y0), r0 - r1, Math.sin(am) * (y1 - y0)];
      if (r1 < 1e-4) b.quadF(P(a0, r0, y0), P(a1, r0, y0), P(a1, 0, y1), P(a0, 0, y1), out);
      else b.quadF(P(a0, r0, y0), P(a1, r0, y0), P(a1, r1, y1), P(a0, r1, y1), out);
    }
  }
}

/** Kreisscheibe in einer Wand (Uhr, Rundfenster): Mitte (s, t), Radius r, d vor der Wand (negativ) */
function disc(b: Builder, F: Face, s: number, t: number, r: number, d: number, n = 14, r0 = 0) {
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
    if (r0 > 0) b.quadF(F.p(s + Math.cos(a0) * r0, t + Math.sin(a0) * r0, d), F.p(s + Math.cos(a1) * r0, t + Math.sin(a1) * r0, d), F.p(s + Math.cos(a1) * r, t + Math.sin(a1) * r, d), F.p(s + Math.cos(a0) * r, t + Math.sin(a0) * r, d), F.N);
    else b.quadF(F.p(s, t, d), F.p(s, t, d), F.p(s + Math.cos(a1) * r, t + Math.sin(a1) * r, d), F.p(s + Math.cos(a0) * r, t + Math.sin(a0) * r, d), F.N);
  }
}

/** Halbkreis (Bogen) über (s, t): Fläche (r0 = 0) oder Band r0 … r1 */
function arch(b: Builder, F: Face, s: number, t: number, r1: number, d: number, r0 = 0, n = 8) {
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI, a1 = ((k + 1) / n) * Math.PI;
    const p = (a: number, r: number) => F.p(s + Math.cos(a) * r, t + Math.sin(a) * r, d);
    if (r0 > 0) b.quadF(p(a0, r0), p(a1, r0), p(a1, r1), p(a0, r1), F.N);
    else b.quadF(F.p(s, t, d), F.p(s, t, d), p(a1, r1), p(a0, r1), F.N);
  }
}

/** Kirchenfenster: hohe Öffnung mit Rundbogen, Bleiglas (leuchtet abends), gemalte Umrahmung */
function churchWindow(b: Builder, F: Face, s: number, w: number, t0: number, ts: number, full: boolean, wallMat: HMat = 'plaster') {
  const h: Hole = { s0: s - w / 2, s1: s + w / 2, t0, t1: ts };
  b.set({ mat: wallMat, col: [1, 1, 1], swap: false });
  if (full) reveal(b, F, h, 0.45);
  b.set({ mat: 'detail', col: GLASS, rough: 0.04, shut: 0, metal: 0 });
  const d = full ? 0.4 : -0.01;
  b.quadF(F.p(h.s0, t0, d), F.p(h.s1, t0, d), F.p(h.s1, ts, d), F.p(h.s0, ts, d), F.N);
  // Bogen: Glas vor der Wand (die Wand darüber bleibt geschlossen)
  arch(b, F, s, ts, w / 2, -0.008, 0, full ? 8 : 4);
  if (!full) return;
  // Bleiruten
  b.set({ col: IRON, rough: 0.5 });
  fbox(b, F, s - 0.025, s + 0.025, t0, ts, d - 0.02, d);
  for (let k = 1; k < 4; k++) { const t = t0 + ((ts - t0) * k) / 4; fbox(b, F, h.s0, h.s1, t - 0.02, t + 0.02, d - 0.02, d); }
  // gemalte Umrahmung (Ocker) und Sohlbank
  b.set({ col: FASCHE, rough: 0.85 });
  const fb = 0.16;
  fbox(b, F, h.s0 - fb, h.s0, t0 - 0.1, ts, -0.012, 0);
  fbox(b, F, h.s1, h.s1 + fb, t0 - 0.1, ts, -0.012, 0);
  arch(b, F, s, ts, w / 2 + fb, -0.012, w / 2, 8);
  b.set({ col: [0.36, 0.35, 0.32], rough: 0.8 });
  fbox(b, F, h.s0 - 0.08, h.s1 + 0.08, t0 - 0.1, t0, -0.1, 0.3);
}

// ——— Kirche ———
const CW = 5.2;       // halbe Breite des Langhauses
const CZ0 = -8, CZ1 = 8;
const CH = 8.6;       // Traufe
const CP = 1.0;       // Dachneigung (45°)
const CAPEX = CH + CW * CP;
const TX0 = CW - 0.2, TX1 = CW + 4.2, TZ0 = CZ0 - 0.6, TZ1 = CZ0 + 3.8;
const TH = 21;        // Turm bis zum Gesims

export function buildChurch(lod: 0 | 1 | 2): Record<HMat, THREE.BufferGeometry> {
  const b = new Builder();
  const full = lod < 2;
  const fine = lod === 0;
  // Sockel (reicht tief in den Hang)
  b.set({ mat: 'stone', col: [0.95, 0.95, 0.95] });
  b.box(-CW - 0.15, -9, CZ0 - 0.15, CW + 0.15, 0.5, CZ1 + 0.15);
  b.box(TX0, -9, TZ0 - 0.15, TX1 + 0.15, 0.5, TZ1);
  // Stufen vor dem Portal
  for (let k = 0; k < 3; k++) b.box(-1.9 - k * 0.3, -4, CZ1 + 1.8 + k * 0.4, 1.9 + k * 0.3, 0.5 - k * 0.17 - 0.17, CZ1 + 2.2 + k * 0.4);
  b.box(-2.2, -4, CZ1, 2.2, 0.5, CZ1 + 1.8);
  // ——— Langhaus ———
  const fL = new Face([1, 0, 0], CW), fR = new Face([-1, 0, 0], CW);
  const fF = new Face([0, 0, 1], CZ1), fB = new Face([0, 0, -1], -CZ0);
  const winZ = [-4.6, -0.6, 3.4];
  // Fenster der Langseiten: s läuft bei +x nach −z, bei −x nach +z
  const sideHoles = (sgn: number): Hole[] => winZ.filter((z) => !(sgn > 0 && z < TZ1 + 0.8)).map((z) => ({ s0: -sgn * z - 0.65, s1: -sgn * z + 0.65, t0: 3.1, t1: 6.3 }));
  b.set({ mat: 'plaster', col: [1, 1, 1], swap: false });
  wall(b, fL, () => (CZ1 - CZ0) / 2, 0.5, CH, full ? sideHoles(1) : []);
  wall(b, fR, () => (CZ1 - CZ0) / 2, 0.5, CH, full ? sideHoles(-1) : []);
  const portal: Hole = { s0: -1.05, s1: 1.05, t0: 0.5, t1: 3.5 };
  const gableHW = (t: number) => (t <= CH ? CW : Math.max(0, (CAPEX - t) / CP));
  wall(b, fF, gableHW, 0.5, CAPEX, full ? [portal] : [], [CH]);
  wall(b, fB, gableHW, 0.5, CAPEX, [], [CH]);
  for (const [F, sgn] of [[fL, 1], [fR, -1]] as const) {
    for (const z of winZ) { if (sgn > 0 && z < TZ1 + 0.8) continue; churchWindow(b, F, -sgn * z, 1.3, 3.1, 6.3, full); }
  }
  // Ecklisenen und Traufgesims (gemalt, leicht erhaben)
  if (full) {
    b.set({ mat: 'detail', col: QUOIN, rough: 0.85, shut: 0 });
    for (const F of [fL, fR]) {
      fbox(b, F, -8.05, -7.6, 0.5, CH, -0.03, 0);
      fbox(b, F, 7.6, 8.05, 0.5, CH, -0.03, 0);
      fbox(b, F, -8.05, 8.05, CH - 0.45, CH, -0.08, 0);
    }
    for (const F of [fF, fB]) { fbox(b, F, -CW - 0.03, -CW + 0.45, 0.5, CH, -0.03, 0); fbox(b, F, CW - 0.45, CW + 0.03, 0.5, CH, -0.03, 0); }
  }
  // ——— Portal: Steingewände mit Rundbogen, Tür, Vordach; darüber Rundfenster und Nische ———
  if (full) {
    b.set({ mat: 'plaster', col: [1, 1, 1] });
    reveal(b, fF, portal, 0.55);
    b.set({ mat: 'detail', col: DOOR, rough: 0.55, shut: 0 });
    fbox(b, fF, portal.s0, portal.s1, portal.t0, portal.t1, 0.45, 0.52);
    // Türflügel mit Rauten (Beschlag)
    b.set({ col: [0.16, 0.095, 0.05] });
    for (let r = 0; r < 4; r++) for (const c of [-1, 1]) { const s0 = c < 0 ? portal.s0 + 0.12 : 0.06; fbox(b, fF, s0, s0 + 0.86, portal.t0 + 0.15 + r * 0.72, portal.t0 + 0.75 + r * 0.72, 0.42, 0.45); }
    b.set({ col: [0.3, 0.27, 0.2], metal: 0.9, rough: 0.35 });
    for (const c of [-0.18, 0.12]) fbox(b, fF, c, c + 0.06, 1.7, 2.0, 0.38, 0.45);
    b.set({ metal: 0 });
    // Bogenfeld über der Tür (Wandmalerei: dunkelblau mit Goldrand)
    b.set({ col: [0.06, 0.1, 0.22], rough: 0.85 });
    arch(b, fF, 0, portal.t1, 1.05, -0.01, 0, 10);
    b.set({ col: [0.55, 0.42, 0.12], rough: 0.5 });
    arch(b, fF, 0, portal.t1, 1.38, -0.04, 1.05, 10);
    fbox(b, fF, portal.s0 - 0.33, portal.s0, portal.t0, portal.t1, -0.04, 0);
    fbox(b, fF, portal.s1, portal.s1 + 0.33, portal.t0, portal.t1, -0.04, 0);
    // Vordach auf zwei Säulen
    b.set({ mat: 'wood', kind: 1, col: [0.8, 0.8, 0.8] });
    for (const x of [-1.9, 1.9]) b.box(x - 0.13, 0.5, CZ1 + 1.6, x + 0.13, 4.2, CZ1 + 1.86);
    b.box(-2.1, 4.2, CZ1 + 0.1, 2.1, 4.45, CZ1 + 1.95);
    b.set({ mat: 'roof', col: [0.62, 0.6, 0.58] });
    for (const sx of [-1, 1]) plane(b, [[0, 5.55, CZ1], [sx * 2.5, 4.4, CZ1], [sx * 2.5, 4.4, CZ1 + 2.2], [0, 5.55, CZ1 + 2.2]], [0, 0, 1], [sx, 1, 0]);
    b.set({ mat: 'plaster', col: [1, 1, 1] });
    for (const sx of [-1, 1]) b.poly(sx > 0 ? [[0, 4.45, CZ1 + 1.9], [2.1, 4.45, CZ1 + 1.9], [0, 5.4, CZ1 + 1.9]] : [[-2.1, 4.45, CZ1 + 1.9], [0, 4.45, CZ1 + 1.9], [0, 5.4, CZ1 + 1.9]]);
    // Rundfenster (Rosette) im Giebel
    b.set({ mat: 'detail', col: GLASS, rough: 0.04 });
    disc(b, fF, 0, 7.6, 0.85, -0.01, fine ? 16 : 10);
    b.set({ col: [0.36, 0.35, 0.32], rough: 0.8 });
    disc(b, fF, 0, 7.6, 1.05, -0.03, fine ? 16 : 10, 0.85);
    if (fine) { b.set({ col: IRON }); for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI; fbox(b, fF, -0.85 * Math.abs(Math.cos(a)) - 0.02, 0.85 * Math.abs(Math.cos(a)) + 0.02, 7.6 - 0.02, 7.6 + 0.02, -0.03, -0.01); } }
    // kleine Fenster im Giebel
    b.set({ col: GLASS, rough: 0.04 });
    for (const s of [-2.4, 2.4]) arch(b, fF, s, 9.1, 0.32, -0.01, 0, 6), b.quadF(fF.p(s - 0.32, 8.4, -0.01), fF.p(s + 0.32, 8.4, -0.01), fF.p(s + 0.32, 9.1, -0.01), fF.p(s - 0.32, 9.1, -0.01), fF.N);
  } else {
    b.set({ mat: 'detail', col: DOOR, rough: 0.6, shut: 0 });
    b.quadF(fF.p(portal.s0, portal.t0, -0.01), fF.p(portal.s1, portal.t0, -0.01), fF.p(portal.s1, portal.t1, -0.01), fF.p(portal.s0, portal.t1, -0.01), fF.N);
    b.set({ col: GLASS, rough: 0.04 });
    disc(b, fF, 0, 7.6, 0.85, -0.01, 8);
  }
  // ——— Chor: halbes Achteck hinten ———
  const AR = 4.4, AZ = CZ0, AH = CH - 0.8;
  const apex: V3[] = [];
  for (let k = 0; k <= 4; k++) { const a = Math.PI + (k / 4) * Math.PI; apex.push([Math.cos(a) * AR, 0, AZ + Math.sin(a) * AR * 0.85]); }
  for (let k = 0; k < 4; k++) {
    const p0 = apex[k], p1 = apex[k + 1];
    const out: V3 = [(p0[0] + p1[0]) / 2, 0, (p0[2] + p1[2]) / 2 - AZ];
    b.set({ mat: 'plaster', col: [1, 1, 1] });
    b.quadF([p0[0], 0.5, p0[2]], [p1[0], 0.5, p1[2]], [p1[0], AH, p1[2]], [p0[0], AH, p0[2]], out);
    b.set({ mat: 'stone', col: [0.95, 0.95, 0.95] });
    b.quadF([p0[0] * 1.03, -9, p0[2] + (p0[2] - AZ) * 0.03], [p1[0] * 1.03, -9, p1[2] + (p1[2] - AZ) * 0.03], [p1[0] * 1.03, 0.5, p1[2] + (p1[2] - AZ) * 0.03], [p0[0] * 1.03, 0.5, p0[2] + (p0[2] - AZ) * 0.03], out);
    // schmales Fenster je Seite (die mittleren zwei)
    if (k === 1 || k === 2) {
      const m: V3 = [(p0[0] + p1[0]) / 2, 0, (p0[2] + p1[2]) / 2];
      const o = norm(out);
      const t = norm([p1[0] - p0[0], 0, p1[2] - p0[2]]);
      b.set({ mat: 'detail', col: GLASS, rough: 0.04, shut: 0 });
      const P = (s: number, y: number): V3 => [m[0] + t[0] * s + o[0] * 0.01, y, m[2] + t[2] * s + o[2] * 0.01];
      b.quadF(P(-0.4, 3.2), P(0.4, 3.2), P(0.4, 5.9), P(-0.4, 5.9), o);
      for (let q = 0; q < 6; q++) { const a0 = (q / 6) * Math.PI, a1 = ((q + 1) / 6) * Math.PI; b.quadF(P(0, 5.9), P(0, 5.9), P(Math.cos(a1) * 0.4, 5.9 + Math.sin(a1) * 0.4), P(Math.cos(a0) * 0.4, 5.9 + Math.sin(a0) * 0.4), o); }
    }
    // Chordach: Dreiecke zur Spitze
    b.set({ mat: 'roof', col: [0.62, 0.6, 0.58] });
    const top: V3 = [0, AH + 3.3, AZ];
    const e0: V3 = [p0[0] * 1.12, AH - 0.1, AZ + (p0[2] - AZ) * 1.12], e1: V3 = [p1[0] * 1.12, AH - 0.1, AZ + (p1[2] - AZ) * 1.12];
    plane(b, [e0, e1, top], sub(e1, e0), [out[0], 1, out[2]]);
  }
  // ——— Dach des Langhauses (45°), Überstand 0,6 m an der Traufe, 0,4 m am Giebel ———
  const EV = CW + 0.6;
  const yAt = (x: number) => CH + (CW - Math.abs(x)) * CP;
  for (const sx of [-1, 1]) {
    b.set({ mat: 'roof', col: [0.62, 0.6, 0.58] });
    const RT = 0.3;
    plane(b, [[0, yAt(0) + RT, CZ0 - 0.4], [sx * EV, yAt(EV) + RT, CZ0 - 0.4], [sx * EV, yAt(EV) + RT, CZ1 + 0.4], [0, yAt(0) + RT, CZ1 + 0.4]], [0, 0, 1], [sx, 1, 0]);
    b.set({ mat: 'wood', kind: 0, col: [0.7, 0.7, 0.7] });
    b.quadF([0, yAt(0), CZ0 - 0.4], [sx * EV, yAt(EV), CZ0 - 0.4], [sx * EV, yAt(EV), CZ1 + 0.4], [0, yAt(0), CZ1 + 0.4], [sx, -1, 0]);
    b.quadF([sx * EV, yAt(EV), CZ0 - 0.4], [sx * EV, yAt(EV) + RT, CZ0 - 0.4], [sx * EV, yAt(EV) + RT, CZ1 + 0.4], [sx * EV, yAt(EV), CZ1 + 0.4], [sx, 0, 0]);
    for (const z of [CZ0 - 0.4, CZ1 + 0.4]) b.quadF([0, yAt(0), z], [sx * EV, yAt(EV), z], [sx * EV, yAt(EV) + RT, z], [0, yAt(0) + RT, z], [0, 0, z > 0 ? 1 : -1]);
  }
  b.set({ mat: 'detail', col: [0.3, 0.3, 0.3], rough: 0.4, metal: 0.8, shut: 0 });
  b.box(-0.12, CAPEX + 0.25, CZ0 - 0.45, 0.12, CAPEX + 0.42, CZ1 + 0.45);
  b.set({ metal: 0 });
  // Dachreiter-Kreuz am Giebel
  b.set({ col: IRON, rough: 0.5 });
  b.box(-0.05, CAPEX + 0.3, CZ1 + 0.3, 0.05, CAPEX + 1.9, CZ1 + 0.4);
  b.box(-0.45, CAPEX + 1.25, CZ1 + 0.3, 0.45, CAPEX + 1.35, CZ1 + 0.4);
  // ——— Turm ———
  const tcx = (TX0 + TX1) / 2, tcz = (TZ0 + TZ1) / 2, tw = (TX1 - TX0) / 2;
  const tF = [new Face([1, 0, 0], TX1), new Face([-1, 0, 0], -TX0), new Face([0, 0, 1], TZ1), new Face([0, 0, -1], -TZ0)];
  // Wandkoordinate s der Turmmitte je Seite (Face.p: N·(Ebene) + R·s)
  const sc = [-tcz, tcz, tcx, -tcx];
  b.set({ mat: 'plaster', col: [1, 1, 1], swap: false });
  tF.forEach((F, i) => {
    const holes: Hole[] = full ? [{ s0: -0.75, s1: 0.75, t0: 15.8, t1: 18.6 }] : [];
    // innen am Langhaus beginnt der Turm erst über dem Dach
    const y0 = i === 1 ? yAt(TX0) - 0.4 : 0.5;
    wallAt(b, F, sc[i], () => tw, y0, TH, holes);
  });
  // Turmöffnungen der Glockenstube (dunkel, mit Bogen und Schallläden), Uhr, Schlitzfenster, Eckquader
  tF.forEach((F, i) => {
    const s = sc[i];
    b.set({ mat: 'detail', col: [0.015, 0.012, 0.01], rough: 0.95, shut: 0 });
    if (full) {
      b.set({ mat: 'plaster', col: [1, 1, 1] });
      reveal(b, F, { s0: s - 0.75, s1: s + 0.75, t0: 15.8, t1: 18.6 }, 0.6);
      b.set({ mat: 'detail', col: [0.015, 0.012, 0.01], rough: 0.95 });
      b.quadF(F.p(s - 0.75, 15.8, 0.58), F.p(s + 0.75, 15.8, 0.58), F.p(s + 0.75, 18.6, 0.58), F.p(s - 0.75, 18.6, 0.58), F.N);
      arch(b, F, s, 18.6, 0.75, -0.008, 0, 8);
      // Schallläden
      b.set({ mat: 'wood', kind: 0, col: [0.55, 0.55, 0.55] });
      for (let k = 0; k < 6; k++) { const t = 16.0 + k * 0.42; b.quadF(F.p(s - 0.72, t, 0.35), F.p(s + 0.72, t, 0.35), F.p(s + 0.72, t + 0.3, 0.2), F.p(s - 0.72, t + 0.3, 0.2), [F.N[0], 0.7, F.N[2]]); }
      b.set({ mat: 'detail', col: FASCHE, rough: 0.85 });
      arch(b, F, s, 18.6, 0.95, -0.012, 0.75, 8);
      fbox(b, F, s - 0.95, s - 0.75, 15.7, 18.6, -0.012, 0);
      fbox(b, F, s + 0.75, s + 0.95, 15.7, 18.6, -0.012, 0);
    } else {
      b.quadF(F.p(s - 0.75, 15.8, -0.01), F.p(s + 0.75, 15.8, -0.01), F.p(s + 0.75, 19.3, -0.01), F.p(s - 0.75, 19.3, -0.01), F.N);
    }
    // Uhr: weißes Blatt, dunkler Ring, Ziffern als Striche, Zeiger
    b.set({ mat: 'detail', col: [0.8, 0.79, 0.74], rough: 0.6 });
    disc(b, F, s, 13.4, 1.05, -0.03, full ? 18 : 8);
    if (full) {
      b.set({ col: [0.08, 0.08, 0.08], rough: 0.5 });
      disc(b, F, s, 13.4, 1.22, -0.035, 18, 1.05);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const cx = s + Math.cos(a) * 0.86, cy = 13.4 + Math.sin(a) * 0.86;
        fbox(b, F, cx - 0.04, cx + 0.04, cy - 0.04, cy + 0.04, -0.05, -0.03);
      }
      b.set({ col: [0.55, 0.42, 0.12], rough: 0.35, metal: 0.7 });
      // 10 nach 7 (Abendläuten)
      const hand = (a: number, L: number, w: number) => {
        const c = Math.cos(a), sn = Math.sin(a);
        const px = -sn, py = c;
        b.quadF(F.p(s + px * w, 13.4 + py * w, -0.06), F.p(s - px * w, 13.4 - py * w, -0.06), F.p(s + c * L - px * w * 0.3, 13.4 + sn * L - py * w * 0.3, -0.06), F.p(s + c * L + px * w * 0.3, 13.4 + sn * L + py * w * 0.3, -0.06), F.N);
      };
      hand(Math.PI / 2 - (7.17 / 12) * Math.PI * 2, 0.55, 0.06);
      hand(Math.PI / 2 - (10 / 60) * Math.PI * 2, 0.85, 0.045);
      b.set({ metal: 0 });
      // Schlitzfenster unten
      b.set({ col: GLASS, rough: 0.04 });
      if (i !== 1) for (const t of [4.5, 9.0]) b.quadF(F.p(s - 0.18, t, -0.01), F.p(s + 0.18, t, -0.01), F.p(s + 0.18, t + 0.9, -0.01), F.p(s - 0.18, t + 0.9, -0.01), F.N);
      // Eckquader und Gesimse
      b.set({ col: QUOIN, rough: 0.85 });
      for (let j = 0; j < 30; j++) {
        const t0 = 0.6 + j * 0.68;
        if (t0 + 0.6 > TH) break;
        const L = j % 2 ? 0.35 : 0.6;
        fbox(b, F, s + tw - L, s + tw + 0.02, t0, t0 + 0.6, -0.03, 0);
        fbox(b, F, s - tw - 0.02, s - tw + (j % 2 ? 0.6 : 0.35), t0, t0 + 0.6, -0.03, 0);
      }
    }
    b.set({ mat: 'stone', col: [0.95, 0.95, 0.95] });
    fbox(b, F, s - tw - 0.18, s + tw + 0.18, TH - 0.1, TH + 0.35, -0.18, 0);
    fbox(b, F, s - tw - 0.08, s + tw + 0.08, 15.2, 15.45, -0.1, 0);
  });
  // ——— Zwiebelhaube: Achteck-Tambour, Zwiebel, Laterne, Spitze, Kreuz ———
  b.set({ mat: 'roof', col: [0.7, 0.62, 0.55] });
  const seg = lod === 0 ? 16 : lod === 1 ? 10 : 6;
  const R0 = tw + 0.15;
  const prof: [number, number][] = lod < 2
    ? [[TH + 0.35, R0], [TH + 1.0, R0 * 0.92], [TH + 1.6, R0 * 0.62], [TH + 2.0, R0 * 0.5], [TH + 2.5, R0 * 0.62], [TH + 3.3, R0 * 0.7], [TH + 4.1, R0 * 0.6], [TH + 4.8, R0 * 0.36], [TH + 5.3, R0 * 0.16], [TH + 5.6, 0.32]]
    : [[TH + 0.35, R0], [TH + 2.0, R0 * 0.5], [TH + 3.3, R0 * 0.7], [TH + 5.3, 0.25]];
  lathe(b, tcx, tcz, prof, seg);
  // Laterne (offen: dunkle Säulen) und zweite kleine Zwiebel
  b.set({ mat: 'detail', col: [0.18, 0.16, 0.14], rough: 0.7, shut: 0 });
  lathe(b, tcx, tcz, [[TH + 5.6, 0.36], [TH + 6.6, 0.36]], lod < 2 ? 8 : 4);
  b.set({ mat: 'roof', col: [0.7, 0.62, 0.55] });
  lathe(b, tcx, tcz, lod < 2 ? [[TH + 6.6, 0.6], [TH + 6.9, 0.7], [TH + 7.4, 0.52], [TH + 7.9, 0.2], [TH + 8.6, 0.06], [TH + 8.7, 0]] : [[TH + 6.6, 0.6], [TH + 7.4, 0.5], [TH + 8.7, 0]], seg);
  // goldene Kugel und Kreuz
  b.set({ mat: 'detail', col: [0.62, 0.46, 0.13], rough: 0.3, metal: 0.8, shut: 0 });
  if (full) b.blob([tcx, TH + 8.85, tcz], 0.22, 1, [0.62, 0.46, 0.13], 7);
  b.box(tcx - 0.06, TH + 8.8, tcz - 0.06, tcx + 0.06, TH + 10.6, tcz + 0.06);
  b.box(tcx - 0.55, TH + 9.85, tcz - 0.05, tcx + 0.55, TH + 9.97, tcz + 0.05);
  b.set({ metal: 0 });
  if (full) {
    // Friedhofsmauer-Stück und Kreuze neben der Kirche (links), ein Baum fehlt bewusst (kommt als Baum dazu)
    b.set({ mat: 'stone', col: [0.9, 0.9, 0.9] });
    b.box(-CW - 7.2, -4, CZ0 - 1, -CW - 6.7, 1.3, CZ1 - 1);
    b.box(-CW - 7.2, -4, CZ0 - 1.5, -CW - 0.3, 1.3, CZ0 - 1);
    b.set({ mat: 'detail', col: [0.09, 0.08, 0.07], rough: 0.6, shut: 0 });
    for (let k = 0; k < 8; k++) {
      const x = -CW - 1.8 - (k % 2) * 2.6, z = CZ0 + 1.2 + Math.floor(k / 2) * 3.4;
      b.box(x - 0.04, 0.3, z - 0.04, x + 0.04, 1.35, z + 0.04);
      b.box(x - 0.3, 1.0, z - 0.035, x + 0.3, 1.08, z + 0.035);
      // Grablicht (leuchtet: Glas)
      if (fine) { b.set({ col: [0.5, 0.06, 0.04], rough: 0.04 }); b.box(x - 0.06, 0.3, z + 0.15, x + 0.06, 0.45, z + 0.27); b.set({ col: [0.09, 0.08, 0.07], rough: 0.6 }); }
    }
  }
  return b.build();
}

/** Wand um die Mitte s0 (Turm: jede Seite hat ihre eigene Mitte) */
function wallAt(b: Builder, F: Face, s0: number, hw: (t: number) => number, t0: number, t1: number, holes: Hole[]) {
  const G = { N: F.N, R: F.R, plane: F.plane, p: (s: number, t: number, d = 0) => F.p(s + s0, t, d) } as unknown as Face;
  wall(b, G, hw, t0, t1, holes);
}

// ——— Stadel ———
const BW = 5.2, BD = 7, BH0 = 2.9, BH1 = 6.4, BT = Math.tan((30 * Math.PI) / 180);
const BAPEX = BH1 + BW * BT;

export function buildBarn(lod: 0 | 1 | 2): Record<HMat, THREE.BufferGeometry> {
  const b = new Builder();
  const full = lod < 2;
  // Stall: Bruchstein mit Tür und kleinen Fenstern
  b.set({ mat: 'stone', col: [1, 1, 1] });
  b.box(-BW, -5, -BD, BW, BH0, BD);
  const fz = new Face([0, 0, 1], BD), bz = new Face([0, 0, -1], BD), fx = new Face([1, 0, 0], BW), nx = new Face([-1, 0, 0], BW);
  b.set({ mat: 'detail', col: [0.02, 0.018, 0.015], rough: 0.9, shut: 0 });
  for (const s of [-3.5, 3.5]) b.quadF(fx.p(s - 0.35, 1.3, -0.01), fx.p(s + 0.35, 1.3, -0.01), fx.p(s + 0.35, 1.85, -0.01), fx.p(s - 0.35, 1.85, -0.01), fx.N);
  b.set({ col: DOOR, rough: 0.6 });
  b.quadF(fz.p(-2.2, 0.1, -0.02), fz.p(-0.9, 0.1, -0.02), fz.p(-0.9, 2.2, -0.02), fz.p(-2.2, 2.2, -0.02), fz.N);
  // Holzaufbau: senkrechte Bretter, dunkle Luftschlitze; Tor auf der Bergseite (−x)
  b.set({ mat: 'wood', kind: 0, swap: true, col: [0.82, 0.8, 0.78] });
  const gable = (t: number) => (t <= BH1 ? BW : Math.max(0, (BAPEX - t) / BT));
  wall(b, fz, gable, BH0, BAPEX, [], [BH1]);
  wall(b, bz, gable, BH0, BAPEX, [], [BH1]);
  wall(b, fx, () => BD, BH0, BH1, []);
  wall(b, nx, () => BD, BH0, BH1, []);
  b.set({ swap: false });
  if (full) {
    b.set({ mat: 'detail', col: [0.012, 0.01, 0.008], rough: 0.95, shut: 0 });
    for (const F of [fz, bz]) for (let k = -4; k <= 4; k++) {
      const s = k * 1.05;
      const top = Math.min(BH1 + (BW - Math.abs(s)) * BT - 0.5, BAPEX - 0.8);
      b.quadF(F.p(s - 0.045, BH0 + 0.5, -0.005), F.p(s + 0.045, BH0 + 0.5, -0.005), F.p(s + 0.045, top, -0.005), F.p(s - 0.045, top, -0.005), F.N);
    }
    for (const F of [fx]) for (let k = -6; k <= 6; k++) { const s = k * 1.05; b.quadF(F.p(s - 0.04, BH0 + 0.6, -0.005), F.p(s + 0.04, BH0 + 0.6, -0.005), F.p(s + 0.04, BH1 - 0.4, -0.005), F.p(s - 0.04, BH1 - 0.4, -0.005), F.N); }
    // großes Tor (zwei Flügel mit Querriegeln) und Rampe davor
    b.set({ mat: 'wood', kind: 0, swap: true, col: [0.55, 0.5, 0.46] });
    fbox(b, nx, -2.0, 2.0, BH0 + 0.1, BH1 - 0.2, -0.08, 0);
    b.set({ swap: false, col: [0.45, 0.42, 0.4] });
    for (const t of [BH0 + 0.6, BH1 - 0.8]) fbox(b, nx, -1.95, 1.95, t, t + 0.18, -0.14, -0.08);
    fbox(b, nx, -0.04, 0.04, BH0 + 0.1, BH1 - 0.2, -0.14, -0.08);
    b.set({ mat: 'stone', col: [0.9, 0.9, 0.9] });
    b.hexa([[-BW - 4.5, -3, -2.2], [-BW, -3, -2.2], [-BW, BH0 + 0.05, -2.2], [-BW - 4.5, -0.6, -2.2], [-BW - 4.5, -3, 2.2], [-BW, -3, 2.2], [-BW, BH0 + 0.05, 2.2], [-BW - 4.5, -0.6, 2.2]]);
    // Balkon-Söller mit Heu (Gelb) vorn
    b.set({ mat: 'detail', col: [0.45, 0.36, 0.12], rough: 0.95 });
    b.box(-3.4, BH1 + 0.15, BD - 0.3, 3.4, BH1 + 1.0, BD + 0.15);
  }
  // Dach: Schindeln (verwittert grau), weiter Überstand
  const EV = BW + 1.1, RZ = BD + 1.2;
  const yAt = (x: number) => BH1 + (BW - Math.abs(x)) * BT;
  for (const sx of [-1, 1]) {
    b.set({ mat: 'roof', col: [0.72, 0.7, 0.68] });
    plane(b, [[0, yAt(0) + 0.24, -RZ], [sx * EV, yAt(EV) + 0.24, -RZ], [sx * EV, yAt(EV) + 0.24, RZ], [0, yAt(0) + 0.24, RZ]], [0, 0, 1], [sx, 1, 0]);
    b.set({ mat: 'wood', kind: 0, col: [0.6, 0.6, 0.6] });
    b.quadF([0, yAt(0), -RZ], [sx * EV, yAt(EV), -RZ], [sx * EV, yAt(EV), RZ], [0, yAt(0), RZ], [sx, -1, 0]);
    b.quadF([sx * EV, yAt(EV), -RZ], [sx * EV, yAt(EV) + 0.24, -RZ], [sx * EV, yAt(EV) + 0.24, RZ], [sx * EV, yAt(EV), RZ], [sx, 0, 0]);
    for (const z of [-RZ, RZ]) b.quadF([0, yAt(0), z], [sx * EV, yAt(EV), z], [sx * EV, yAt(EV) + 0.24, z], [0, yAt(0) + 0.24, z], [0, 0, z > 0 ? 1 : -1]);
    if (full) {
      // Schneefangstangen und Steine auf dem Dach (Legschindeln)
      b.set({ mat: 'stone', col: [0.75, 0.75, 0.75] });
      for (let k = 0; k < 7; k++) {
        const x = sx * (1.0 + rnd(k * 7 + (sx > 0 ? 1 : 0)) * (EV - 2.0)), z = -RZ + 1.5 + rnd(k * 13 + 5) * (RZ * 2 - 3);
        b.blob([x, yAt(Math.abs(x)) + 0.38, z], 0.24, 0.55, [0.5, 0.49, 0.47], k * 31 + (sx > 0 ? 3 : 0));
      }
    }
  }
  b.set({ mat: 'wood', kind: 1, col: [0.5, 0.5, 0.5] });
  b.box(-0.14, yAt(0) + 0.1, -RZ - 0.05, 0.14, yAt(0) + 0.38, RZ + 0.05);
  return b.build();
}

/** Hilfe für Typen */
export type { HMat };
void QUOIN;
