/**
 * Cruiser der 70er:
 *  · Bonanzarad: geschwungener Rahmen, Federgabel mit Faltenbälgen, Hochlenker mit Querstrebe und
 *    Quasten an den Griffen, Bananensattel mit Silberstreifen, Rückenlehne mit Fuchsschwanz,
 *    Schaltknüppel auf dem Oberrohr, Kettenschutz mit Schriftzug, Felgenbremse vorn, Seitenständer.
 *  · Lowrider: langer, tiefer Rahmen in Candy-Lack, Springergabel mit Federn, gedrehte Chromstreben
 *    (Gabel, Zierstreben, Rückenlehne, Spiegelarme), Lenkrad aus Kettengliedern, Samtsattel mit
 *    Knöpfen, Ersatzrad hinter der Rückenlehne, runde Spiegel.
 * Alles steht mit dem Rahmen; Koordinaten wie beim normalen Rad (vorn = −z).
 */
import * as THREE from 'three';
import { rgb, type C3, type Mesher } from './gloss';
import { M4, X, Y, along, pathFrames, pipe, prism, revolve, shape, straightFrame, strut, sweep, tube, type Frame3 } from './prim3d';
import { BIKE_BB, hash3, headAxis, mix, v3, type BikeFit, type Ctx, type FrameOut, type V } from './bikebase';
import { coil } from './saddle3d';

const BB = BIKE_BB;

/** Lage der Laufräder (Außenradius, Achsen) */
export const CRUISER = {
  bonanza: { rF: 0.205, rR: 0.255, F: v3(0, 0.205, -0.62), R: v3(0, 0.255, 0.42) },
  lowrider: { rF: 0.255, rR: 0.255, F: v3(0, 0.255, -0.86), R: v3(0, 0.255, 0.42) },
};

export interface CruiserOut { out: FrameOut; clamp: V; decal: THREE.BufferGeometry }

const smooth = (ctrl: V[], k: number) => new THREE.CatmullRomCurve3(ctrl, false, 'centripetal').getSpacedPoints(Math.max(2, k));
const lenOf = (pts: V[]) => pts.reduce((s, p, i) => (i ? s + p.distanceTo(pts[i - 1]) : 0), 0);

/** Rahmen entlang einer Kurve mit Tiefe nach oben (Sättel); s × c = −t */
function upFrames(pts: V[]): Frame3[] {
  return pts.map((_, i) => {
    const t = pts[Math.min(pts.length - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize();
    const c = Y.clone().addScaledVector(t, -Y.dot(t)).normalize();
    return { s: new THREE.Vector3().crossVectors(t, c).normalize(), c };
  });
}

/** gedrehte Chromstange: vierflügeliger Querschnitt, der sich längs dreht (eine Umdrehung je 34 mm) */
function twisted(m: Mesher, ctrl: V[], r: number, col: C3, q: 0 | 1) {
  const pts = smooth(ctrl, Math.round(lenOf(ctrl) / (q ? 0.005 : 0.04)) + 1);
  const fr = pathFrames(pts, X);
  const n = q ? 16 : 6;
  const sec: [number, number][] = [];
  for (let j = 0; j < n; j++) {
    const a = (j / n) * Math.PI * 2;
    const k = q ? 0.8 + 0.2 * Math.cos(4 * a) : 1;
    sec.push([Math.cos(a) * k, Math.sin(a) * k]);
  }
  let acc = 0;
  const rate = (Math.PI * 2) / 0.034;
  const frames = fr.map((f, i) => {
    if (i) acc += pts[i].distanceTo(pts[i - 1]);
    const a = q ? acc * rate : 0;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    return { s: f.s.clone().multiplyScalar(ca).addScaledVector(f.c, sa), c: f.c.clone().multiplyScalar(ca).addScaledVector(f.s, -sa) };
  });
  sweep(m, pts, frames, () => r * 2, () => r * 2, () => col, sec);
}

/** flacher Schriftzug auf einer Fläche, die nach +x zeigt (Text läuft von hinten nach vorn) */
function flatDecal(c: V, dir: V, len: number, h: number): THREE.BufferGeometry {
  const d = dir.clone().normalize();
  const up = new THREE.Vector3().crossVectors(X, d).normalize();
  if (up.y < 0) up.negate();
  // Text liest von hinten (+z) nach vorn (−z), von rechts (+x) gesehen
  const back = d.z > 0 ? d.clone().negate() : d.clone();
  const p0 = c.clone().addScaledVector(back, -len / 2).addScaledVector(up, -h / 2);
  const p1 = c.clone().addScaledVector(back, len / 2).addScaledVector(up, -h / 2);
  const p2 = c.clone().addScaledVector(back, len / 2).addScaledVector(up, h / 2);
  const p3 = c.clone().addScaledVector(back, -len / 2).addScaledVector(up, h / 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([p0, p1, p2, p3].flatMap((p) => [p.x, p.y, p.z]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

export function buildCruiser(x: Ctx, fit: BikeFit): CruiserOut {
  const low = x.spec.frame === 'lowrider';
  const G = low ? CRUISER.lowrider : CRUISER.bonanza;
  const { q, n, pc } = x;
  const { paint: P, metal: Mt, satin: St, matte: Ma } = x.f;
  const chrome = rgb('#e8ebee');
  const F = G.F.clone();
  const R = G.R.clone();
  const ax = low ? headAxis(F, 58, 0.1) : headAxis(F, 68, 0.04);
  const H0 = ax.at(low ? 0.64 : 0.6);
  const H1 = ax.at(low ? 0.78 : 0.76);
  const TW = low ? 0.03 : 0.032;

  // ---- Steuerrohr, Steuersatz
  tube(P, H0.clone().addScaledVector(ax.u, -0.012), H1.clone().addScaledVector(ax.u, 0.012), { w0: 0.041, n, col: pc });
  for (const [p, d] of [[H1, 1], [H0, -1]] as [V, number][]) tube(Mt, p.clone().addScaledVector(ax.u, d * 0.012), p.clone().addScaledVector(ax.u, d * 0.026), { w0: 0.047, n, col: () => chrome });

  // ---- Sitzrohr, Tretlager, Unterrohr (geschwungen), Oberrohr, Streben
  const S = low ? v3(0, 0.6, -0.025) : v3(0, 0.665, -0.004);
  const seatDir = S.clone().sub(BB).normalize();
  tube(P, BB.clone(), S, { w0: TW, n, rings: 3, col: pc });
  P.add(new THREE.CylinderGeometry(0.025, 0.025, 0.074, n), M4(BB.x, BB.y, BB.z, 0, 0, Math.PI / 2), pc(BB));
  const dtA = BB.clone().add(v3(0, 0.012, -0.02));
  const dtB = H0.clone().addScaledVector(ax.u, 0.03);
  const dtMid = low ? v3(0, 0.33, -0.33) : dtA.clone().lerp(dtB, 0.5).add(v3(0, -0.05, 0.012));
  const dt = smooth([dtB, dtMid, dtA], q ? 26 : 6);
  sweep(P, dt, pathFrames(dt, X), () => TW + 0.004, () => TW + 0.004, (i) => pc(dt[i]), shape('round', n));
  const J = BB.clone().addScaledVector(seatDir, BB.distanceTo(S) * (low ? 0.86 : 0.82));
  const ttCtrl = low
    ? [H1.clone().addScaledVector(ax.u, -0.02), v3(0, 0.765, -0.27), v3(0, 0.665, -0.085), J.clone().add(v3(0, 0.004, -0.014))]
    : [H1.clone().addScaledVector(ax.u, -0.02), H1.clone().add(v3(0, -0.014, 0.14)), v3(0, 0.712, -0.14), J.clone().add(v3(0, 0.006, -0.014))];
  const tt = smooth(ttCtrl, q ? 30 : 8);
  sweep(P, tt, pathFrames(tt, X), () => TW, () => TW, (i) => pc(tt[i]), shape('round', n));
  for (const sx of [-1, 1]) {
    // Streben vom Sitzrohr zum Hinterrad (Lowrider: weit geschwungen), Kettenstreben, Ausfallenden
    const st = low
      ? smooth([J.clone().add(v3(sx * 0.014, 0, 0.01)), v3(sx * 0.034, 0.51, 0.15), v3(sx * 0.054, 0.36, 0.33), R.clone().add(v3(sx * 0.06, 0.012, -0.004))], q ? 22 : 6)
      : [J.clone().add(v3(sx * 0.014, 0.01, 0.012)), R.clone().add(v3(sx * 0.058, 0.012, -0.004))];
    sweep(P, st, pathFrames(st, X), () => 0.018, () => 0.018, (i) => pc(st[i]), shape('round', n));
    const dro = R.clone().add(v3(sx * 0.06, 0, -0.004));
    tube(P, BB.clone().add(v3(sx * 0.03, -0.004, 0.036)), dro, { w0: 0.018, d0: 0.022, w1: 0.014, n, rings: 3, col: pc });
    strut(P, dro.clone().add(v3(0, -0.014, -0.016)), dro.clone().add(v3(0, 0.02, 0.012)), 0.006, 0.03, pc(dro));
  }
  strut(P, J.clone().lerp(R, 0.38).add(v3(-0.03, 0.01, 0)), J.clone().lerp(R, 0.38).add(v3(0.03, 0.01, 0)), 0.01, 0.01, pc(J));
  // Sattelklemme
  tube(Mt, S.clone().addScaledVector(seatDir, -0.012), S.clone().addScaledVector(seatDir, 0.012), { w0: TW * 1.2, n, col: () => chrome });

  // ---- Gabel
  const crown = ax.at(low ? 0.615 : 0.585);
  if (!low) {
    // Federgabel: verchromte Standrohre, schwarze Faltenbälge, Gleitrohre unten
    Mt.add(new THREE.BoxGeometry(0.11, 0.024, 0.046), along(crown, ax.u), chrome);
    for (const sx of [-1, 1]) {
      const top = crown.clone().add(v3(sx * 0.046, -0.008, 0));
      const bot = F.clone().add(v3(sx * 0.049, 0.014, 0));
      const L = top.distanceTo(bot);
      const d = bot.clone().sub(top).normalize();
      const at = (t: number) => top.clone().addScaledVector(d, L * t);
      tube(Mt, top, at(0.34), { w0: 0.024, n, col: () => chrome });
      const K = q ? 11 : 3;
      for (let k = 0; k < K; k++) {
        const a = 0.32 + (0.3 * k) / K;
        const b = a + 0.3 / K;
        const m = (a + b) / 2;
        tube(St, at(a), at(m), { w0: 0.027, w1: 0.037, n, col: () => rgb('#151516') });
        tube(St, at(m), at(b), { w0: 0.037, w1: 0.027, n, col: () => rgb('#151516') });
      }
      tube(Mt, at(0.6), bot, { w0: 0.031, w1: 0.025, n, col: () => chrome });
      strut(Mt, bot.clone().add(v3(0, -0.026, 0.006)), bot.clone().add(v3(0, 0.006, -0.004)), 0.006, 0.024, chrome);
    }
    // Felgenbremse vorn (Seitenzug, verchromt)
    const rimR = G.rF - 0.022 * 1.72 - 0.0005;
    const piv = crown.clone().addScaledVector(ax.n, -0.03).addScaledVector(ax.u, -0.006);
    const dir = piv.clone().sub(F).normalize();
    for (const sx of [-1, 1]) {
      const pad = F.clone().addScaledVector(dir, rimR - 0.008).add(v3(sx * 0.0175, 0, 0));
      pipe(Mt, [piv, piv.clone().add(v3(sx * 0.03, -0.003, 0)).addScaledVector(dir, -0.006), pad.clone().add(v3(sx * 0.009, 0, 0)).addScaledVector(dir, 0.024), pad.clone().add(v3(sx * 0.006, 0, 0))], 0.0045, q ? 6 : 4, chrome);
      Ma.add(new THREE.BoxGeometry(0.007, 0.012, 0.038), along(pad, dir), x.dark);
    }
    Mt.add(new THREE.CylinderGeometry(0.008, 0.008, 0.032, 8), along(piv, dir.clone().cross(X)), chrome);
  } else {
    // Springergabel: hintere Scheiden fest an der Krone, vordere Scheiden mit Federn, Schwingen an der Achse
    Mt.add(new THREE.BoxGeometry(0.13, 0.026, 0.05), along(crown, ax.u), chrome);
    const fwd = ax.n.clone().negate();
    const stTop = H1.clone().addScaledVector(ax.u, 0.05);
    const pivY = 0.3;
    for (const sx of [-1, 1]) {
      const rTop = crown.clone().add(v3(sx * 0.055, -0.01, 0));
      const rBot = ax.at(pivY).add(v3(sx * 0.057, 0, 0));
      twisted(Mt, [rTop, rBot], 0.0105, chrome, q);
      // Schwinge: von der hinteren Scheide über die Achse nach vorn
      const fBot = F.clone().add(v3(sx * 0.057, 0.012, 0)).addScaledVector(fwd, 0.045);
      strut(Mt, rBot.clone().add(v3(0, 0.006, 0)), fBot, 0.008, 0.03, chrome, X);
      Mt.add(new THREE.CylinderGeometry(0.012, 0.012, 0.022, 10), M4(rBot.x, rBot.y, rBot.z, 0, 0, Math.PI / 2), chrome);
      Mt.add(new THREE.CylinderGeometry(0.011, 0.011, 0.022, 10), M4(fBot.x, fBot.y, fBot.z, 0, 0, Math.PI / 2), chrome);
      // vordere Scheide parallel zur Lenkachse hinauf
      const fTop = fBot.clone().addScaledVector(ax.u, (stTop.y + 0.01 - fBot.y) / ax.u.y);
      twisted(Mt, [fBot, fTop], 0.0105, chrome, q);
      // Feder um die vordere Scheide, oben eine Brücke zum Schaft
      const s0 = fBot.clone().addScaledVector(ax.u, (0.62 - fBot.y) / ax.u.y);
      const s1 = fBot.clone().addScaledVector(ax.u, (0.76 - fBot.y) / ax.u.y);
      coil(Mt, s0, s1, 0.019, 8, 0.0035, chrome, q);
      Mt.add(new THREE.CylinderGeometry(0.022, 0.022, 0.012, q ? 14 : 6), along(s0, ax.u), chrome);
      Mt.add(new THREE.CylinderGeometry(0.022, 0.022, 0.012, q ? 14 : 6), along(s1, ax.u), chrome);
      if (sx > 0) {
        const bridgeL = fTop.clone().setX(-0.057);
        strut(Mt, bridgeL, fTop, 0.02, 0.016, chrome, ax.u);
        strut(Mt, stTop.clone().add(v3(0, 0.0, 0)), fTop.clone().setX(0), 0.02, 0.016, chrome, X);
      }
    }
  }

  // ---- Sattelstütze und Bananensattel
  const seat: [number, number][] = low
    ? [[-0.07, 0.742], [0.0, 0.749], [0.08, 0.752], [0.18, 0.754], [0.28, 0.762], [0.37, 0.784], [0.44, 0.822], [0.48, 0.856], [0.5, 0.886]]
    : [[-0.06, 0.806], [0.0, 0.812], [0.08, 0.816], [0.18, 0.818], [0.28, 0.826], [0.36, 0.846], [0.43, 0.878], [0.47, 0.91], [0.49, 0.94]];
  const seatW = [0.064, 0.104, 0.13, 0.136, 0.136, 0.13, 0.118, 0.098, 0.066];
  const thick = 0.058;
  const sp = smooth(seat.map(([z, y]) => v3(0, y, z)), q ? 40 : 8);
  const wAt = (i: number) => {
    const t = (i / (sp.length - 1)) * (seatW.length - 1);
    const k = Math.min(seatW.length - 2, Math.floor(t));
    return seatW[k] + (seatW[k + 1] - seatW[k]) * (t - k);
  };
  const sec: [number, number][] = [];
  const ns = q ? 20 : 8;
  for (let j = 0; j < ns; j++) {
    const a = (j / ns) * Math.PI * 2;
    const c = Math.cos(a);
    const s2 = Math.sin(a);
    sec.push([Math.sign(c) * Math.pow(Math.abs(c), 0.55), Math.sign(s2) * Math.pow(Math.abs(s2), s2 > 0 ? 0.55 : 0.8)]);
  }
  const seatCol = low ? rgb('#7a0f1e') : rgb('#18181a');
  const sf = upFrames(sp);
  sweep(St, sp, sf, wAt, () => thick, () => seatCol, sec);
  const piping = low ? rgb('#d4a72c') : rgb('#f2f0ea');
  if (q) {
    for (const sx of [-1, 1]) pipe(St, sp.map((p, i) => p.clone().addScaledVector(sf[i].s, sx * wAt(i) * 0.5 * 0.985).addScaledVector(sf[i].c, 0.006)), 0.0028, 5, piping, X, false);
    if (!low) {
      // Silberstreifen in der Mitte
      sweep(Mt, sp.map((p, i) => p.clone().addScaledVector(sf[i].c, thick / 2 + 0.0006)), sf, (i) => Math.min(0.04, wAt(i) * 0.36), () => 0.0016, () => rgb('#c7cbd2'), shape('round', 8));
    } else {
      // Samt mit Knöpfen im Rautenmuster
      for (let i = 2; i < sp.length - 3; i += 3) {
        const row = Math.round(i / 3) % 2;
        for (const off of row ? [-0.032, 0.032] : [0]) {
          const p = sp[i].clone().addScaledVector(sf[i].c, thick / 2 - 0.002).addScaledVector(sf[i].s, off);
          St.add(new THREE.SphereGeometry(0.0055, 8, 6), M4(p.x, p.y, p.z), rgb('#d4a72c'));
        }
      }
    }
  }
  const nose = sp[Math.round(sp.length * 0.1)];
  const postTop = S.clone().addScaledVector(seatDir, (nose.y - thick / 2 - 0.012 - S.y) / seatDir.y);
  tube(Mt, S.clone().addScaledVector(seatDir, -0.05), postTop, { w0: 0.0254, n, col: () => chrome });
  strut(Mt, postTop.clone().add(v3(0, 0.004, -0.04)), postTop.clone().add(v3(0, 0.004, 0.09)), 0.04, 0.008, chrome, X);

  // ---- Rückenlehne: vom linken Achsende hinauf, oben ein Bogen, rechts wieder hinunter
  const top = low ? 1.33 : 1.19;
  const zt = low ? 0.62 : 0.585;
  const side = (sx: number) => [R.clone().add(v3(sx * 0.068, 0.008, 0.004)), v3(sx * 0.064, 0.6, 0.44), v3(sx * 0.058, 0.84, 0.476), v3(sx * 0.064, top - 0.17, zt - 0.05), v3(sx * 0.066, top - 0.06, zt - 0.012)];
  const loop = [...side(-1), v3(-0.044, top - 0.006, zt), v3(0, top + 0.008, zt + 0.004), v3(0.044, top - 0.006, zt), ...side(1).reverse()];
  if (low) {
    twisted(Mt, loop, 0.0085, chrome, q);
    // innere Zierstange
    twisted(Mt, [v3(0, 0.87, 0.49), v3(0, top - 0.12, zt - 0.03), v3(0, top - 0.004, zt)], 0.0065, chrome, q);
  } else {
    pipe(Mt, smooth(loop, q ? 60 : 14), 0.0075, n, chrome);
    // Fuchsschwanz an der Lehne: buschig, rotbraun mit weißer Spitze, hängt nach hinten
    const ft = smooth([v3(0, top + 0.004, zt + 0.012), v3(0.004, top - 0.03, zt + 0.06), v3(0.012, top - 0.1, zt + 0.11), v3(0.02, top - 0.19, zt + 0.135), v3(0.026, top - 0.27, zt + 0.14)], q ? 36 : 6);
    const NF = ft.length - 1;
    const fox = rgb('#c4571d');
    const foxDk = rgb('#8e3a12');
    const tip = rgb('#f3efe6');
    sweep(Ma, ft, pathFrames(ft, X), (i) => {
      const t = i / NF;
      const r = (0.016 + 0.024 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.7)) * (1 - Math.pow(t, 5)) + 0.002;
      return r * 2 * (q ? 0.9 + 0.2 * hash3(i, 2, 5) : 1);
    }, (i) => {
      const t = i / NF;
      return (2 * (0.016 + 0.024 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.7)) * (1 - Math.pow(t, 5)) + 0.004) * (q ? 0.9 + 0.2 * hash3(i, 7, 3) : 1);
    }, (i) => {
      const t = i / NF;
      return t > 0.74 ? mix(tip, fox, Math.max(0, (0.8 - t) * 8)) : mix(fox, foxDk, hash3(i, 1, 1) * 0.5);
    }, shape('round', q ? 12 : 6));
    Mt.add(new THREE.CylinderGeometry(0.008, 0.008, 0.024, 10), M4(0, top + 0.004, zt + 0.004, Math.PI / 2), chrome);
  }
  // Halter unter dem Sattelheck
  strut(Mt, v3(-0.06, 0.845 - (low ? 0.06 : 0), 0.47), v3(0.06, 0.845 - (low ? 0.06 : 0), 0.47), 0.012, 0.008, chrome, X);
  fit.lamp = v3(0, top - 0.1, zt + 0.012);

  // ---- Lenker
  const stemTop = ax.at(low ? 0.83 : 0.835);
  tube(Mt, H1.clone().addScaledVector(ax.u, 0.026), stemTop, { w0: 0.024, n, col: () => chrome });
  let clamp: V;
  let hand: V;
  if (!low) {
    // Hochlenker mit Querstrebe, weiße Griffe mit Quasten
    clamp = stemTop.clone().add(v3(0, 0.024, -0.042));
    tube(Mt, stemTop, clamp, { w0: 0.022, n, col: () => chrome });
    Mt.add(new THREE.CylinderGeometry(0.017, 0.017, 0.05, n), M4(clamp.x, clamp.y, clamp.z, 0, 0, Math.PI / 2), chrome);
    hand = v3();
    const grip = rgb('#f3f1ea');
    const tassel = [rgb('#f3f1ea'), rgb('#d7262e'), rgb('#2b56c4')];
    for (const sx of [-1, 1]) {
      const L = (dx: number, dy: number, dz: number) => clamp.clone().add(v3(sx * dx, dy, dz));
      const bar = smooth([L(0, 0, 0), L(0.07, 0, 0), L(0.115, 0.012, 0.002), L(0.136, 0.064, 0.006), L(0.148, 0.22, 0.02), L(0.155, 0.285, 0.04), L(0.172, 0.318, 0.066), L(0.2, 0.33, 0.095)], q ? 34 : 8);
      pipe(Mt, bar, 0.011, n, chrome);
      const g0 = bar[bar.length - 1];
      const gd = v3(sx * 0.36, -0.04, 0.93).normalize();
      const prof: [number, number, C3][] = [[0.004, -0.004, grip]];
      const KR = q ? 12 : 2;
      for (let k = 0; k <= KR; k++) prof.push([k % 2 ? 0.0158 : 0.0168, (k / KR) * 0.11, grip]);
      prof.push([0.012, 0.114, grip], [0.003, 0.116, grip]);
      revolve(St, prof, q ? 14 : 6, v3(), false, new THREE.Matrix4().compose(g0, new THREE.Quaternion().setFromUnitVectors(X, gd), v3(1, 1, 1)));
      if (sx > 0) hand = g0.clone().addScaledVector(gd, 0.058);
      if (q) {
        // Quasten aus dem Griffende
        const E = g0.clone().addScaledVector(gd, 0.116);
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2;
          const spread = v3(Math.cos(a) * 0.012, Math.sin(a) * 0.01, 0);
          const p0 = E.clone().add(spread.clone().multiplyScalar(0.6));
          const p1 = E.clone().add(spread).addScaledVector(gd, 0.05).add(v3(0, -0.05, 0));
          const p2 = E.clone().add(spread.clone().multiplyScalar(1.6)).addScaledVector(gd, 0.075).add(v3(sx * 0.006 * Math.cos(a), -0.13 - 0.02 * hash3(k, sx, 1), 0));
          const rib = smooth([p0, p1, p2], 8);
          sweep(Ma, rib, pathFrames(rib, X), () => 0.007, () => 0.0012, () => tassel[k % 3], shape('round', 4));
        }
      }
    }
    // Querstrebe zwischen den Holmen
    pipe(Mt, [clamp.clone().add(v3(-0.142, 0.15, 0.014)), clamp.clone().add(v3(0.142, 0.15, 0.014))], 0.0085, n, chrome);
  } else {
    // Lenkrad aus Kettengliedern auf hohem Schwanenhals, darüber zwei runde Spiegel
    const neck = smooth([stemTop, stemTop.clone().add(v3(0, 0.1, 0.0)), stemTop.clone().add(v3(0, 0.17, 0.05)), stemTop.clone().add(v3(0, 0.2, 0.1))], q ? 16 : 5);
    twisted(Mt, neck, 0.0125, chrome, q);
    const W = neck[neck.length - 1].clone().add(v3(0, 0.012, 0.012));
    clamp = W.clone();
    const nW = v3(0, 0.5, 0.866).normalize();
    const upW = Y.clone().addScaledVector(nW, -Y.dot(nW)).normalize();
    const rW = 0.155;
    const ring = (phi: number) => W.clone().addScaledVector(X, Math.sin(phi) * rW).addScaledVector(upW, Math.cos(phi) * rW);
    const NL = q ? 30 : 0;
    if (NL) {
      for (let k = 0; k < NL; k++) {
        const phi = (k / NL) * Math.PI * 2;
        const c = ring(phi);
        const tng = ring(phi + 0.01).sub(ring(phi - 0.01)).normalize();
        const rad = c.clone().sub(W).normalize();
        const yA = k % 2 ? nW.clone() : rad;
        const zA = new THREE.Vector3().crossVectors(tng, yA).normalize();
        const m = new THREE.Matrix4().makeBasis(tng, yA, zA).multiply(new THREE.Matrix4().makeScale(1.45, 1, 1));
        m.setPosition(c);
        Mt.add(new THREE.TorusGeometry(0.0118, 0.0034, 6, 12), m, chrome);
      }
    } else {
      const lo: V[] = [];
      for (let k = 0; k <= 12; k++) lo.push(ring((k / 12) * Math.PI * 2));
      pipe(Mt, lo, 0.009, 5, chrome);
    }
    // Nabe und drei gedrehte Speichen
    Mt.add(new THREE.CylinderGeometry(0.03, 0.03, 0.014, q ? 18 : 8), along(W, nW), chrome);
    for (const phi of [Math.PI, Math.PI / 3, -Math.PI / 3]) twisted(Mt, [W, ring(phi).lerp(W, 0.06)], 0.0065, chrome, q);
    hand = ring(0.98).addScaledVector(nW, 0.004);
    for (const sx of [-1, 1]) {
      const m0 = W.clone().add(v3(sx * 0.03, 0.01, 0.01));
      const m1 = W.clone().add(v3(sx * 0.2, 0.2, 0.03));
      twisted(Mt, [m0, m0.clone().lerp(m1, 0.5).add(v3(0, 0.03, 0)), m1], 0.0045, chrome, q);
      const mn = v3(sx * 0.15, 0.12, 1).normalize();
      Mt.add(new THREE.CylinderGeometry(0.036, 0.036, 0.012, q ? 22 : 8), along(m1.clone().addScaledVector(mn, 0.008), mn), chrome);
      P.add(new THREE.CylinderGeometry(0.031, 0.031, 0.0125, q ? 22 : 8), along(m1.clone().addScaledVector(mn, 0.0085), mn), rgb('#9fb7c9'));
    }
  }

  // ---- Kettenschutz rechts mit Schriftzug
  const gx = 0.074;
  const guard: [number, number][] = [[BB.z - 0.07, BB.y + 0.058], [BB.z - 0.04, BB.y + 0.106], [BB.z + 0.03, BB.y + 0.124], [R.z - 0.06, R.y + 0.062], [R.z - 0.026, R.y + 0.044], [R.z - 0.036, R.y + 0.024], [BB.z + 0.05, BB.y + 0.08], [BB.z - 0.02, BB.y + 0.066]];
  prism(Mt, guard, 0.0028, 0.0018, chrome, Mt, gx);
  pipe(Mt, [v3(gx - 0.002, BB.y + 0.07, BB.z + 0.12), v3(0.03, BB.y + 0.05, BB.z + 0.13)], 0.003, 4, chrome);
  pipe(Mt, [v3(gx - 0.002, R.y + 0.05, R.z - 0.1), v3(0.048, R.y + 0.035, R.z - 0.11)], 0.003, 4, chrome);
  const gA = v3(gx + 0.0034, BB.y + 0.098, BB.z + 0.06);
  const gB = v3(gx + 0.0034, R.y + 0.062, R.z - 0.09);
  const decal = flatDecal(gA.clone().lerp(gB, 0.5).add(v3(0, -0.006, 0)), gB.clone().sub(gA), Math.min(0.24, gA.distanceTo(gB) * 0.82), 0.03);

  // ---- Schaltknüppel auf dem Oberrohr (Bonanza) bzw. Zierstreben (Lowrider)
  if (!low) {
    const pt = tt.reduce((b, p) => (Math.abs(p.z + 0.11) < Math.abs(b.z + 0.11) ? p : b), tt[0]);
    const base = pt.clone().add(v3(0, TW / 2 + 0.008, 0));
    Mt.add(new THREE.BoxGeometry(0.03, 0.02, 0.1), M4(base.x, base.y, base.z, -0.22), chrome);
    if (q) {
      St.add(new THREE.BoxGeometry(0.014, 0.004, 0.034), M4(base.x, base.y + 0.0105, base.z + 0.02, -0.22), x.dark);
      for (const k of [0, 1, 2]) St.add(new THREE.BoxGeometry(0.008, 0.0045, 0.0018), M4(base.x, base.y + 0.011, base.z + 0.01 + k * 0.01, -0.22), rgb('#f3f1ea'));
    }
    const lev = smooth([base.clone().add(v3(0, 0.008, -0.018)), base.clone().add(v3(0, 0.08, -0.002)), base.clone().add(v3(0, 0.15, 0.03))], q ? 10 : 3);
    pipe(Mt, lev, 0.0042, q ? 8 : 5, chrome);
    const kn = lev[lev.length - 1];
    P.add(new THREE.SphereGeometry(0.018, q ? 16 : 8, q ? 12 : 6), M4(kn.x, kn.y + 0.012, kn.z), rgb('#141416'));
    // Seitenständer links, hochgeklappt
    pipe(Mt, [BB.clone().add(v3(-0.045, -0.03, 0.05)), v3(-0.066, 0.25, 0.32), v3(-0.074, 0.245, 0.36)], 0.0065, q ? 8 : 4, chrome);
  } else {
    // Zierstrebe unter dem Oberrohr, zwei Streben zum Hinterrad
    twisted(Mt, [H0.clone().lerp(H1, 0.5).addScaledVector(ax.n, 0.03), v3(0, 0.64, -0.24), J.clone().addScaledVector(seatDir, -0.12).add(v3(0, 0, -0.02))], 0.0085, chrome, q);
    for (const sx of [-1, 1]) twisted(Mt, [S.clone().add(v3(sx * 0.02, -0.02, 0.012)), v3(sx * 0.05, 0.48, 0.28), R.clone().add(v3(sx * 0.066, 0.04, -0.03))], 0.0065, chrome, q);
    // Ersatzrad hinter der Rückenlehne (Weißwand, Chromkappe)
    const sc = v3(0, 0.6, 0.76);
    const rs = 0.19;
    const tw = 0.03;
    const wall = rgb('#f2f0e8');
    const blk = rgb('#141416');
    const tp: [number, number, C3][] = [];
    const tn = q ? 16 : 6;
    for (let k = 0; k < tn; k++) {
      const a = (k / tn) * Math.PI * 2;
      const ca = Math.cos(a);
      tp.push([rs - tw + ca * tw, Math.sin(a) * tw * 0.85, ca > 0.4 ? blk : Math.abs(ca) < 0.35 ? wall : blk]);
    }
    revolve(Ma, tp, q ? 40 : 12, sc, true);
    // Radkappen auf beiden Seiten (außen von −x nach +x durchlaufen)
    const capR = rs - 2 * tw + 0.004;
    revolve(Mt, [[0.0005, -0.035, chrome], [0.05, -0.034, chrome], [0.12, -0.024, chrome], [capR, -0.018, chrome], [capR, 0.0, chrome]], q ? 36 : 10, sc, false);
    revolve(Mt, [[capR, 0.0, chrome], [capR, 0.018, chrome], [0.12, 0.024, chrome], [0.05, 0.034, chrome], [0.0005, 0.035, chrome]], q ? 36 : 10, sc, false);
    for (const sx of [-1, 1]) pipe(Mt, [R.clone().add(v3(sx * 0.07, 0.01, 0.01)), sc.clone().add(v3(sx * 0.03, -0.06, -0.01))], 0.006, q ? 6 : 4, chrome);
    pipe(Mt, [v3(0, 0.88, 0.5), sc.clone().add(v3(0, 0.0, -0.035))], 0.0075, q ? 6 : 4, chrome);
    pipe(Mt, [BB.clone().add(v3(-0.045, -0.03, 0.05)), v3(-0.066, 0.25, 0.32), v3(-0.074, 0.245, 0.36)], 0.0065, q ? 8 : 4, chrome);
  }

  // ---- Sitzposition: Becken auf dem Sattel, Hand am Griff; aufrecht
  const sIdx = Math.round((sp.length - 1) * (low ? 0.43 : 0.45));
  const pelvis = sp[sIdx].clone().add(v3(0, thick / 2 + 0.045, -0.005));
  fit.pelvis = pelvis;
  fit.hood = hand;
  fit.drop = hand.clone().add(v3(0, -0.02, 0.02));
  fit.upright = low ? 1.5 : 1.42;

  const out: FrameOut = {
    H0, H1, S, ax, crown, ssTop: J.clone(), dtA, dtB, dtFrame: straightFrame(dtB.clone().sub(dtA).normalize()), dtW: [TW, TW], dtD: [TW, TW],
    cableFront: crown, cableTT: H1, cableDT: dtB, cableTTEnd: J,
  };
  return { out, clamp, decal };
}
