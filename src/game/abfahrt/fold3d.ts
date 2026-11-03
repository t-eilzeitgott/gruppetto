/**
 * Faltrad: kurzes Steuerrohr über dem 16-Zoll-Vorderrad, dickes Hauptrohr mit Faltgelenk (Block, Hebel) zum
 * Sitzrohr, lange Sattelstütze, Hinterbau als Dreieck mit Federblock am Sitzrohr, hoher Lenkerschaft mit
 * Scharnier und Schnellspanner, flacher Lenker mit Schaumgriffen, Klingel und Hebeln, Gepäckblock vorn am
 * Steuerrohr, hinten ein Träger mit kleinen Rollen. Koordinaten wie beim normalen Rad (vorn = −z).
 */
import * as THREE from 'three';
import { rgb } from './gloss';
import { M4, X, Z, along, pipe, strut, tube } from './prim3d';
import { BIKE_BB, headAxis, v3, type BikeFit, type Ctx, type FrameDims, type FrameOut, type V } from './bikebase';

const BB = BIKE_BB;

/** Lage der Laufräder (Außenradius, Achsen) */
export const FOLD = { rF: 0.205, rR: 0.205, F: v3(0, 0.205, -0.6), R: v3(0, 0.205, 0.43) };

export function buildFold(x: Ctx, D: FrameDims, front: V, rear: V, fit: BikeFit): { out: FrameOut; clamp: V } {
  const { q, n, pc } = x;
  const { paint: P, metal: Mt, satin: St, matte: Ma } = x.f;
  const ax = headAxis(front, 72, 0.04);
  const H0 = ax.at(0.36);
  const H1 = ax.at(0.5);
  // Steuerrohr mit Lagerschalen
  tube(P, H0.clone().addScaledVector(ax.u, -0.012), H1.clone().addScaledVector(ax.u, 0.012), { w0: 0.048, n, col: pc });
  for (const [p, d] of [[H1, 1], [H0, -1]] as [V, number][]) tube(Mt, p.clone().addScaledVector(ax.u, d * 0.012), p.clone().addScaledVector(ax.u, d * 0.024), { w0: 0.052, n, col: () => x.silver });
  // Sitzrohr, oben Klemme mit Schnellspanner
  const S = BB.clone().addScaledVector(D.seatDir, D.seatLen);
  tube(P, BB.clone(), S, { w0: 0.04, n, col: pc });
  tube(Mt, S.clone().addScaledVector(D.seatDir, -0.016), S.clone().addScaledVector(D.seatDir, 0.01), { w0: 0.05, n, col: () => x.silver });
  strut(Mt, S.clone().add(v3(0.028, -0.004, 0)), S.clone().add(v3(0.034, -0.03, -0.05)), 0.006, 0.014, x.silver, X, 0.006, 0.01);
  P.add(new THREE.CylinderGeometry(0.024, 0.024, 0.074, n), M4(BB.x, BB.y, BB.z, 0, 0, Math.PI / 2), pc(BB));
  // Hauptrohr mit Faltgelenk
  const mA = BB.clone().addScaledVector(D.seatDir, 0.19);
  const mB = H0.clone().lerp(H1, 0.42);
  const dtFrame = tube(P, mA, mB, { w0: 0.05, d0: 0.058, w1: 0.05, d1: 0.058, n: Math.max(n, 12), col: pc });
  const md = mB.clone().sub(mA).normalize();
  const hj = mA.clone().lerp(mB, 0.5);
  St.add(new THREE.BoxGeometry(0.066, 0.05, 0.074), along(hj, md), x.dark);
  if (q) {
    // Klemmplatte mit Hebel rechts
    Mt.add(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 14), M4(hj.x + 0.037, hj.y, hj.z, 0, 0, Math.PI / 2), x.silver);
    strut(Mt, hj.clone().add(v3(0.042, 0, 0)), hj.clone().add(v3(0.046, -0.035, 0.045)), 0.006, 0.014, x.silver, X, 0.006, 0.011);
  }
  // Hinterbau: Kettenstreben, Sitzstreben zum Federblock hinter dem Sitzrohr
  const blockP = BB.clone().addScaledVector(D.seatDir, 0.15).add(v3(0, 0, 0.06));
  for (const sx of [-1, 1]) {
    const dro = rear.clone().add(v3(sx * 0.064, 0, -0.004));
    tube(P, BB.clone().add(v3(sx * 0.03, -0.004, 0.036)), dro, { w0: 0.019, d0: 0.024, w1: 0.013, n, col: pc });
    tube(P, blockP.clone().add(v3(sx * 0.024, 0, 0.022)), dro.clone().add(v3(0, 0.012, -0.004)), { w0: 0.017, w1: 0.013, n, col: pc });
    strut(P, dro.clone().add(v3(0, -0.014, -0.016)), dro.clone().add(v3(0, 0.022, 0.012)), 0.006, 0.03, pc(dro));
  }
  // Federblock (Gummi) zwischen Hinterbau und Sitzrohr
  St.add(new THREE.CylinderGeometry(0.022, 0.022, 0.05, q ? 14 : 6), along(blockP.clone().add(v3(0, 0, -0.012)), v3(0, 0.2, 1)), rgb('#202124'));
  strut(P, blockP.clone().add(v3(-0.03, 0, 0.02)), blockP.clone().add(v3(0.03, 0, 0.02)), 0.014, 0.014, pc(blockP), Z);
  // Gabel: gerade Scheiden, Krone
  const crown = H0.clone().addScaledVector(ax.u, -0.036);
  P.add(new THREE.BoxGeometry(0.1, 0.024, 0.04), along(crown, ax.u), pc(crown));
  for (const sx of [-1, 1]) {
    const end = front.clone().add(v3(sx * 0.05, 0.004, 0));
    tube(P, crown.clone().add(v3(sx * 0.043, -0.008, 0)), end, { w0: 0.026, w1: 0.016, n, col: pc });
    strut(P, end.clone().add(v3(0, -0.012, 0.006)), end.clone().add(v3(0, 0.016, -0.004)), 0.005, 0.022, pc(end));
  }
  // Lenkerschaft mit Scharnier, oben Vorbau mit Klemme
  const postTop = ax.at(0.96);
  tube(P, H1.clone().addScaledVector(ax.u, 0.024), postTop, { w0: 0.034, n, col: pc });
  const hinge = ax.at(0.64);
  St.add(new THREE.BoxGeometry(0.05, 0.05, 0.05), along(hinge, ax.u), x.dark);
  if (q) strut(Mt, hinge.clone().add(v3(0.028, 0, 0)), hinge.clone().add(v3(0.032, -0.04, 0.02)), 0.006, 0.012, x.silver);
  const clamp = postTop.clone().addScaledVector(ax.u, 0.016);
  Mt.add(new THREE.CylinderGeometry(0.019, 0.019, 0.06, n), M4(clamp.x, clamp.y, clamp.z, 0, 0, Math.PI / 2), x.silver);
  // flacher Lenker, leicht nach hinten gekröpft, Schaumgriffe, Hebel, Klingel
  const grip = rgb(x.spec.tape);
  for (const sx of [-1, 1]) {
    const L = (dx: number, dy: number, dz: number) => clamp.clone().add(v3(sx * dx, dy, dz));
    const pts = new THREE.CatmullRomCurve3([L(0, 0, 0), L(0.1, 0.002, 0.004), L(0.17, 0.008, 0.02), L(0.22, 0.012, 0.04), L(0.28, 0.014, 0.064)], false, 'centripetal').getSpacedPoints(q ? 18 : 5);
    const k = Math.max(1, pts.findIndex((p) => Math.abs(p.x - clamp.x) > 0.19));
    pipe(Mt, pts.slice(0, k + 1), 0.011, n, x.silver);
    pipe(Ma, pts.slice(k), 0.0165, n, grip);
    St.add(new THREE.BoxGeometry(0.03, 0.026, 0.03), M4(pts[k].x - sx * 0.01, pts[k].y + 0.004, pts[k].z - 0.012), x.dark);
    pipe(Mt, [pts[k].clone().add(v3(0, -0.006, -0.03)), pts[pts.length - 1].clone().add(v3(-sx * 0.01, -0.012, -0.044))], 0.004, q ? 6 : 4, x.silver);
    if (sx > 0) {
      fit.hood = L(0.262, 0.03, 0.058);
      fit.drop = L(0.258, 0.02, 0.05);
    } else if (q) {
      const b = L(0.13, 0.022, 0.0);
      Mt.add(new THREE.SphereGeometry(0.024, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M4(b.x, b.y + 0.004, b.z), x.silver);
    }
  }
  // Gepäckblock vorn am Steuerrohr
  const blk = H0.clone().lerp(H1, 0.55).addScaledVector(ax.n, -0.04);
  St.add(new THREE.BoxGeometry(0.07, 0.056, 0.03), along(blk, ax.u), x.dark);
  // Träger hinten mit vier kleinen Rollen
  const ry = 0.45;
  const rz0 = 0.16;
  const rz1 = 0.6;
  const rw = 0.07;
  const rack = rgb('#2a2b2e');
  const frame = [v3(-rw, ry, rz0), v3(-rw, ry, rz1), v3(rw, ry, rz1), v3(rw, ry, rz0)];
  pipe(St, [...frame, frame[0].clone()], 0.0065, q ? 8 : 5, rack, X, false);
  for (const z of [0.3, 0.45]) strut(St, v3(-rw, ry, z), v3(rw, ry, z), 0.012, 0.006, rack, Z);
  for (const sx of [-1, 1]) {
    pipe(St, [v3(sx * rw, ry - 0.004, rz0 + 0.02), blockP.clone().add(v3(sx * 0.028, 0.0, 0.03))], 0.006, q ? 6 : 4, rack);
    pipe(St, [v3(sx * rw, ry - 0.004, 0.42), rear.clone().add(v3(sx * 0.07, 0.004, 0.0))], 0.006, q ? 6 : 4, rack);
    for (const z of [rz0 + 0.02, rz1 - 0.02]) {
      const c = v3(sx * (rw + 0.012), ry - 0.006, z);
      St.add(new THREE.CylinderGeometry(0.022, 0.022, 0.014, q ? 14 : 6), M4(c.x, c.y, c.z, 0, 0, Math.PI / 2), rgb('#151517'));
      if (q) Mt.add(new THREE.CylinderGeometry(0.009, 0.009, 0.016, 10), M4(c.x, c.y, c.z, 0, 0, Math.PI / 2), x.silver);
    }
  }
  const out: FrameOut = {
    H0, H1, S, ax, crown, ssTop: blockP, dtA: mA, dtB: mB, dtFrame, dtW: [0.05, 0.05], dtD: [0.058, 0.058],
    cableFront: crown, cableTT: H1, cableDT: mB, cableTTEnd: S,
  };
  return { out, clamp };
}
