/**
 * Hochrad (um 1884): 49-Zoll-Vorderrad mit 64 Radialspeichen und Vollgummireifen, kleines Stützrad hinten,
 * Rückgrat in einem Bogen am Vorderrad entlang, Pedale direkt an der Vorderradnabe (keine Kette),
 * Schnurrbartlenker mit Birnengriffen aus Palisander, Löffelbremse auf dem Reifen, Ledersattel auf der
 * Blattfeder, Werkzeugtasche, Aufstiegstritt, Nabenlaterne aus Messing, Glocke und Steuerkopfschild.
 * Schwarz emailliert mit feinen Goldlinien, Blankteile vernickelt.
 *
 * Koordinaten wie beim normalen Rad (vorn = −z). Die Kurbel dreht um die Vorderradnabe.
 */
import * as THREE from 'three';
import { PAINT, merge, rgb, type C3 } from './gloss';
import { M4, X, Z, along, pathFrames, pipe, prism, revolve, shape, strut, sweep, tube } from './prim3d';
import { set4, v3, type BikeFit, type Ctx, type V } from './bikebase';
import { saddleShell } from './saddle3d';

/** Außenradius vorn/hinten, Achsen */
export const ORD = { RF: 0.62, RR: 0.215, F: v3(0, 0.62, -0.1), R: v3(0, 0.215, 0.7) };
const DEG = Math.PI / 180;

export interface OrdinaryOut { wheelF: THREE.BufferGeometry; wheelR: THREE.BufferGeometry; crank: THREE.BufferGeometry; fit: BikeFit }

/** Laufrad mit Vollgummireifen und radialen Speichen; Ursprung = Achse */
function wheel(x: Ctx, R: number, N: number, flX: number, flR: number, hubEnd: number): THREE.BufferGeometry {
  const { q } = x;
  const W = set4(PAINT);
  const o = v3();
  const seg = q ? 80 : 18;
  // Vollgummi: halber Querschnitt; Felge als Halbmond, in dem der Reifen sitzt
  const rt = R > 0.4 ? 0.0125 : 0.0105;
  const tc = R - rt;
  const rb = tc - rt * 0.55;
  const w = rt * 2.3;
  const rIn = rb - 0.013;
  const black = x.pc(o);
  const gold = rgb('#d6ae4f');
  revolve(W.paint, [[rb, w / 2, black], [rb - 0.006, w / 2, black], [rIn + 0.003, w * 0.32, black], [rIn, 0, black], [rIn + 0.003, -w * 0.32, black], [rb - 0.006, -w / 2, black], [rb, -w / 2, black], [rb - 0.003, 0, black]], seg, o, true);
  if (q) {
    // Goldlinie auf beiden Felgenflanken
    revolve(W.metal, [[rb - 0.0032, w / 2 + 0.0004, gold], [rb - 0.0052, w / 2 + 0.0004, gold]], seg, o, false);
    revolve(W.metal, [[rb - 0.0052, -w / 2 - 0.0004, gold], [rb - 0.0032, -w / 2 - 0.0004, gold]], seg, o, false);
  }
  const rub = rgb('#2d2c2a');
  const tp: [number, number, C3][] = [];
  const tn = q ? 14 : 6;
  for (let k = 0; k < tn; k++) {
    const a = (k / tn) * Math.PI * 2;
    tp.push([tc + Math.cos(a) * rt, Math.sin(a) * rt, rub]);
  }
  revolve(W.matte, tp, seg, o, true);
  // Nabe: Trommel mit großen Flanschen und Lagerkappen
  const ni = x.silver;
  const hub: [number, number, C3][] = [[0.01, -hubEnd, ni], [0.016, -hubEnd + 0.004, ni], [0.016, -flX - 0.008, ni], [0.022, -flX - 0.004, ni], [flR, -flX - 0.002, ni], [flR, -flX + 0.002, ni], [0.024, -flX + 0.006, ni], [0.02, 0, ni], [0.024, flX - 0.006, ni], [flR, flX - 0.002, ni], [flR, flX + 0.002, ni], [0.022, flX + 0.004, ni], [0.016, flX + 0.008, ni], [0.016, hubEnd - 0.004, ni], [0.01, hubEnd, ni]];
  revolve(W.metal, q ? hub : [hub[0], hub[4], hub[7], hub[9], hub[14]], q ? 28 : 8, o, false);
  // Speichen: radial, abwechselnd vom linken und rechten Flansch, Nippel an der Felge
  const n = q ? N : Math.max(12, Math.round(N / 4));
  const sw = q ? 0.0019 : 0.0032;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const side = k % 2 ? 1 : -1;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    strut(W.metal, v3(side * flX, sa * flR * 0.86, ca * flR * 0.86), v3(side * 0.0015, sa * (rIn + 0.002), ca * (rIn + 0.002)), sw, sw, ni, X);
    if (q) W.metal.add(new THREE.CylinderGeometry(0.0026, 0.0026, 0.01, 6), along(v3(side * 0.0008, sa * (rIn + 0.004), ca * (rIn + 0.004)), v3(0, sa, ca)), ni);
  }
  return merge([W.paint, W.metal, W.satin, W.matte])!;
}

export function buildOrdinary(x: Ctx): OrdinaryOut {
  const { q, n } = x;
  const { paint: P, metal: Mt, satin: St, matte: Ma } = x.f;
  const F = ORD.F.clone();
  const R = ORD.R.clone();
  const black = x.pc(F);
  const gold = rgb('#d6ae4f');
  const ni = x.silver;
  const brass = rgb('#c79b3e');
  const smooth = (ctrl: V[], k: number) => new THREE.CatmullRomCurve3(ctrl, false, 'centripetal').getSpacedPoints(k);
  // Lenkachse 82°, durch die Vorderradachse; back = quer dazu nach hinten
  const u = v3(0, Math.sin(82 * DEG), Math.cos(82 * DEG));
  const back = v3(0, -u.z, u.y);
  const at = (y: number) => F.clone().addScaledVector(u, (y - F.y) / u.y);

  // ---- Gabel: Krone über dem Reifen, ovale Scheiden zu den Lagergehäusen an der Nabe
  const crown = at(1.284);
  P.add(new THREE.BoxGeometry(0.13, 0.026, 0.042), along(crown, u), black);
  for (const sx of [-1, 1]) {
    const top = crown.clone().add(v3(sx * 0.054, -0.006, 0));
    const bot = F.clone().add(v3(sx * 0.084, 0.022, 0));
    tube(P, bot, top, { w0: 0.018, d0: 0.026, w1: 0.022, d1: 0.032, n, rings: 3, col: () => black });
    Mt.add(new THREE.CylinderGeometry(0.024, 0.024, 0.026, q ? 16 : 8), M4(sx * 0.084, F.y, F.z, 0, 0, Math.PI / 2), ni);
    if (q) {
      // Ölkännchen auf dem Lager, Goldlinie vorn auf der Scheide
      Mt.add(new THREE.CylinderGeometry(0.0035, 0.0055, 0.016, 8), M4(sx * 0.084, F.y + 0.031, F.z), ni);
      pipe(Mt, [bot.clone().addScaledVector(back, -0.0136), top.clone().addScaledVector(back, -0.0166)], 0.0011, 4, gold, X, false);
    }
  }

  // ---- Steuerkopf: Schaft (vernickelt), darum der Kopf des Rückgrats mit Lagerkappen, Messingschild
  tube(Mt, at(1.29), at(1.408), { w0: 0.03, n, col: () => ni });
  tube(P, at(1.305).addScaledVector(back, 0.004), at(1.375).addScaledVector(back, 0.004), { w0: 0.05, n, col: () => black });
  for (const y of [1.3, 1.381]) tube(Mt, at(y - 0.005), at(y + 0.005), { w0: 0.057, n, col: () => ni });
  if (q) {
    const badge = at(1.34).addScaledVector(back, -0.0262);
    Mt.add(new THREE.CylinderGeometry(1, 1, 0.003, 20), along(badge, back.clone().negate(), 0.013, 1, 0.019), brass);
    Mt.add(new THREE.CylinderGeometry(1, 1, 0.0034, 16), along(badge, back.clone().negate(), 0.008, 1, 0.012), rgb('#7a1d1d'));
  }

  // ---- Rückgrat: vom Kopf in einem Bogen am Vorderrad entlang, dünner werdend, mit Goldlinien
  const Rb = ORD.RF + 0.058;
  const circ = (deg: number) => F.clone().add(v3(0, Rb * Math.cos(deg * DEG), Rb * Math.sin(deg * DEG)));
  const B0 = at(1.34).addScaledVector(back, 0.03);
  const spine = smooth([B0, B0.clone().lerp(circ(24), 0.5).add(v3(0, 0.014, 0)), circ(24), circ(40), circ(56), circ(72), circ(88), circ(101)], q ? 64 : 14);
  const K1 = spine.length - 1;
  const rAt = (i: number) => 0.0215 - 0.0095 * (i / K1);
  sweep(P, spine, pathFrames(spine, X), (i) => rAt(i) * 2, (i) => rAt(i) * 2, () => black, shape('round', q ? 14 : 6));
  if (q) for (const sx of [-1, 1]) pipe(Mt, spine.map((p, i) => p.clone().add(v3(sx * rAt(i) * 0.97, rAt(i) * 0.24, 0))), 0.001, 4, gold, X, false);
  /** Oberseite des Rückgrats (vom Rad weg) an der Länge z */
  const spineTop = (z: number, gap: number) => {
    let i = 1;
    while (i < K1 && spine[i].z < z) i++;
    const a = spine[i - 1];
    const b = spine[i];
    const t = Math.max(0, Math.min(1, (z - a.z) / ((b.z - a.z) || 1)));
    const p = a.clone().lerp(b, t);
    const out = p.clone().sub(F).setX(0).normalize();
    return p.addScaledVector(out, rAt(i) + gap);
  };

  // ---- Hinterbau: Gabelkopf am Ende des Rückgrats, zwei Scheiden zum kleinen Rad
  const E = spine[K1];
  P.add(new THREE.SphereGeometry(0.016, q ? 12 : 6, q ? 8 : 4), M4(E.x, E.y, E.z), black);
  for (const sx of [-1, 1]) {
    tube(P, E.clone().add(v3(sx * 0.012, 0, 0)), R.clone().add(v3(sx * 0.042, 0.012, -0.004)), { w0: 0.013, w1: 0.009, n, rings: 3, col: () => black });
    Mt.add(new THREE.CylinderGeometry(0.012, 0.012, 0.014, q ? 12 : 6), M4(sx * 0.042, R.y, R.z, 0, 0, Math.PI / 2), ni);
  }
  // Achsen (stehen still)
  Mt.add(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 6), M4(F.x, F.y, F.z, 0, 0, Math.PI / 2), ni);
  Mt.add(new THREE.CylinderGeometry(0.005, 0.005, 0.1, 6), M4(R.x, R.y, R.z, 0, 0, Math.PI / 2), ni);

  // ---- Aufstiegstritt links am Rückgrat, über dem kleinen Rad
  const sA = circ(93);
  const sOut = sA.clone().add(v3(-0.072, 0, 0.004));
  strut(P, sA.clone().add(v3(-0.01, 0, 0)), sOut, 0.014, 0.016, black, Z);
  Mt.add(new THREE.CylinderGeometry(0.021, 0.021, 0.034, q ? 16 : 8), M4(sOut.x - 0.014, sOut.y, sOut.z, 0, 0, Math.PI / 2), ni);
  if (q) for (const k of [-0.011, -0.004, 0.003, 0.01]) Ma.add(new THREE.CylinderGeometry(0.0216, 0.0216, 0.0025, 16), M4(sOut.x - 0.014 + k, sOut.y, sOut.z, 0, 0, Math.PI / 2), rgb('#3a3a3a'));

  // ---- Blattfeder auf dem Rückgrat, hinten eingerollt; darauf der Ledersattel
  const sp: V[] = [];
  const KS = q ? 16 : 5;
  for (let k = 0; k <= KS; k++) {
    const z = 0.05 + (0.215 * k) / KS;
    // vorn auf dem Rohr, zum Sattel hin etwas Luft (federt)
    sp.push(spineTop(z, 0.004 + 0.016 * Math.min(1, k / KS / 0.6)));
  }
  const last = sp[sp.length - 1];
  const curl = [last.clone().add(v3(0, -0.004, 0.014)), last.clone().add(v3(0, -0.016, 0.016)), last.clone().add(v3(0, -0.021, 0.004))];
  const spring = [...sp, ...curl];
  sweep(Mt, spring, pathFrames(spring, X), () => 0.03, () => 0.006, () => rgb('#3a3b3e'), shape('round', q ? 10 : 6));
  const seatBase = spineTop(0.185, 0.02);
  const saddle = v3(0, seatBase.y + 0.003 + 0.022, 0.185);
  saddleShell(x, saddle, 'leather', 0.86);
  // Klemmen zwischen Feder und Sattel
  for (const z of [0.07, 0.25]) {
    const p = spineTop(z, 0.004 + 0.016 * Math.min(1, (z - 0.05) / 0.215 / 0.6));
    St.add(new THREE.BoxGeometry(0.034, 0.012, 0.014), M4(p.x, p.y + 0.008, p.z), x.dark);
  }
  // Werkzeugtasche hinter dem Sattel
  const bagC = rgb('#5b3a22');
  const sy = saddle.y;
  prism(Ma, [[0.28, sy - 0.03], [0.352, sy - 0.034], [0.356, sy - 0.084], [0.286, sy - 0.09]], 0.046, 0.01, bagC);
  if (q) {
    prism(Ma, [[0.278, sy - 0.026], [0.356, sy - 0.03], [0.358, sy - 0.05], [0.278, sy - 0.046]], 0.048, 0.006, rgb('#4a2e1a'));
    St.add(new THREE.BoxGeometry(0.014, 0.012, 0.004), M4(0, sy - 0.05, 0.36), brass);
  }

  // ---- Schnurrbartlenker oben durch den Schaft, Birnengriffe aus Palisander, Glocke, Löffelbremse
  const Hc = at(1.405);
  let hand = v3();
  for (const sx of [-1, 1]) {
    const L = (dx: number, dy: number, dz: number) => Hc.clone().add(v3(sx * dx, dy, dz));
    const pts = smooth([L(0, 0, 0), L(0.09, 0.002, -0.004), L(0.17, -0.004, 0.0), L(0.235, -0.024, 0.028), L(0.272, -0.06, 0.07), L(0.288, -0.09, 0.098)], q ? 26 : 6);
    pipe(Mt, pts, 0.0105, n, ni);
    const g0 = pts[pts.length - 1];
    const gd = v3(sx * 0.119, -0.596, 0.794).normalize();
    const wood = rgb('#5c2e1b');
    const prof: [number, number, C3][] = [[0.004, -0.006, ni], [0.0125, -0.004, ni], [0.0125, 0.006, ni], [0.013, 0.008, wood], [0.016, 0.024, wood], [0.02, 0.054, wood], [0.0215, 0.074, wood], [0.019, 0.092, wood], [0.012, 0.104, wood], [0.002, 0.109, wood]];
    revolve(St, prof, q ? 18 : 8, v3(), false, new THREE.Matrix4().compose(g0, new THREE.Quaternion().setFromUnitVectors(X, gd), v3(1, 1, 1)));
    if (sx > 0) hand = g0.clone().addScaledVector(gd, 0.055);
    if (sx < 0 && q) {
      // Glocke aus Messing auf dem linken Holm
      const b = L(0.075, 0.022, -0.004);
      Mt.add(new THREE.SphereGeometry(0.024, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), M4(b.x, b.y, b.z), brass);
      Mt.add(new THREE.CylinderGeometry(0.004, 0.004, 0.012, 6), M4(b.x, b.y + 0.028, b.z), brass);
      strut(Mt, L(0.075, 0.0, -0.004), b.clone().add(v3(0, -0.002, 0)), 0.006, 0.008, ni);
    }
  }
  // Löffelbremse: Hebel unter dem rechten Holm, Stange vorn am Kopf hinunter zum Hebelarm, Löffel auf dem Reifen
  const lev = [Hc.clone().add(v3(0.035, -0.017, -0.012)), Hc.clone().add(v3(0.14, -0.022, -0.012)), Hc.clone().add(v3(0.215, -0.036, 0.014))];
  pipe(Mt, lev, 0.0042, q ? 6 : 4, ni);
  const pivot = crown.clone().addScaledVector(back, -0.03).add(v3(0, 0.01, 0));
  const spoonA = 20 * DEG;
  const S = F.clone().add(v3(0, (ORD.RF + 0.007) * Math.cos(spoonA), -(ORD.RF + 0.007) * Math.sin(spoonA)));
  strut(Mt, pivot, S.clone().add(v3(0, 0.006, 0.01)), 0.012, 0.005, ni, X);
  const armMid = pivot.clone().lerp(S, 0.42);
  pipe(Mt, smooth([lev[0], lev[0].clone().add(v3(0, -0.03, -0.03)), armMid.clone().add(v3(0.0, 0.03, 0.01)), armMid], q ? 10 : 4), 0.0028, q ? 6 : 4, ni);
  const spoon: V[] = [];
  const sFr: { s: V; c: V }[] = [];
  for (let k = 0; k <= (q ? 8 : 3); k++) {
    const a = (12 + (16 * k) / (q ? 8 : 3)) * DEG;
    const rad = v3(0, Math.cos(a), -Math.sin(a));
    spoon.push(F.clone().addScaledVector(rad, ORD.RF + 0.006));
    sFr.push({ s: X.clone(), c: rad });
  }
  sweep(St, spoon, sFr, () => 0.03, () => 0.006, () => x.dark, shape('round', q ? 10 : 6));
  sweep(Mt, spoon.map((p, i) => p.clone().addScaledVector(sFr[i].c, 0.004)), sFr, () => 0.032, () => 0.004, () => ni, shape('round', q ? 10 : 6));

  // ---- Nabenlaterne: hängt an der Achse zwischen den Speichen, bleibt aufrecht
  const Lc = F.clone().add(v3(0, -0.142, 0));
  for (const sx of [-1, 1]) strut(Mt, F.clone().add(v3(sx * 0.012, -0.014, 0)), Lc.clone().add(v3(sx * 0.014, 0.05, 0)), 0.003, 0.009, brass, X);
  Mt.add(new THREE.BoxGeometry(0.04, 0.07, 0.056), M4(Lc.x, Lc.y, Lc.z), brass);
  Mt.add(new THREE.CylinderGeometry(0.008, 0.032, 0.024, 4), M4(Lc.x, Lc.y + 0.047, Lc.z, 0, Math.PI / 4), brass);
  Mt.add(new THREE.CylinderGeometry(0.007, 0.007, 0.014, q ? 10 : 6), M4(Lc.x, Lc.y + 0.064, Lc.z), brass);
  const lensP = Lc.clone().add(v3(0, 0.004, -0.03));
  Mt.add(new THREE.CylinderGeometry(0.0225, 0.0225, 0.007, q ? 18 : 8), along(lensP, v3(0, 0, -1)), brass);
  P.add(new THREE.CylinderGeometry(0.018, 0.018, 0.0075, q ? 18 : 8), along(lensP.clone().add(v3(0, 0, -0.0005)), v3(0, 0, -1)), rgb('#fff1c2'));
  if (q) {
    // Seitengläser rot und grün, Griffbügel oben
    P.add(new THREE.SphereGeometry(0.007, 10, 8), M4(Lc.x - 0.021, Lc.y + 0.006, Lc.z), rgb('#c4161c'));
    P.add(new THREE.SphereGeometry(0.007, 10, 8), M4(Lc.x + 0.021, Lc.y + 0.006, Lc.z), rgb('#1f8a3a'));
    const h0 = Lc.clone().add(v3(0, 0.072, 0));
    pipe(Mt, [h0.clone().add(v3(0, 0, -0.014)), h0.clone().add(v3(0, 0.012, -0.008)), h0.clone().add(v3(0, 0.012, 0.008)), h0.clone().add(v3(0, 0, 0.014))], 0.0016, 5, brass);
  }

  // ---- Kurbeln an der Vorderradnabe: Arm mit Langloch (verstellbarer Hub), Pedalachse
  const cr = set4(PAINT);
  const CR = 0.13;
  for (const sx of [-1, 1]) {
    const a0 = v3(sx * 0.103, -sx * 0.014, 0);
    const a1 = v3(sx * 0.106, sx * (CR + 0.012), 0);
    tube(cr.metal, a0, a1, { w0: 0.009, d0: 0.026, w1: 0.008, d1: 0.02, n: q ? 10 : 6, col: () => ni });
    if (q) strut(cr.satin, v3(sx * 0.1078, sx * 0.03, 0), v3(sx * 0.1094, sx * (CR - 0.016), 0), 0.0012, 0.006, x.dark, X);
    cr.metal.add(new THREE.CylinderGeometry(0.017, 0.017, 0.014, q ? 14 : 8), M4(sx * 0.1, 0, 0, 0, 0, Math.PI / 2), ni);
    cr.metal.add(new THREE.CylinderGeometry(0.0065, 0.0065, 0.03, 8), M4(sx * 0.122, sx * CR, 0, 0, 0, Math.PI / 2), ni);
  }

  // ---- Rückstrahler am Hinterbau (dort sitzt im Spiel das rote Licht)
  const lamp = E.clone().add(v3(0, 0.03, 0.028));
  const pelvis = saddle.clone().add(v3(0, 0.053, -0.016));
  const fit: BikeFit = {
    front: F, rear: R, hood: hand, drop: hand.clone().add(v3(0, -0.012, -0.008)), aero: null, pelvis, lamp,
    spinF: 0.335 / ORD.RF, spinR: 0.335 / ORD.RR, bb: F.clone(), crank: CR, pedalX: 0.168, upright: 1.55, trunk: 1.46,
  };
  return {
    wheelF: wheel(x, ORD.RF, 64, 0.058, 0.075, 0.072),
    wheelR: wheel(x, ORD.RR, 20, 0.026, 0.028, 0.038),
    crank: merge([cr.paint, cr.metal, cr.satin, cr.matte])!,
    fit,
  };
}
