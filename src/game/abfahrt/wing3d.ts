/**
 * Monocoque der 90er („Flügel“): kein Sitzrohr, sondern ein einziges hohes Profil vom Steuerrohr über das Hinterrad,
 * ein breites Blatt hinunter zum Tretlager, Profil-Kettenstreben, zwei Blätter vom Flügelende zu den Ausfallenden,
 * Einarmgabel links, Neonstreifen oben auf dem Flügel. Die Sattelstütze steckt oben im Flügel.
 */
import * as THREE from 'three';
import { rgb } from './gloss';
import { X, along, pathFrames, pipe, shape, straightFrame, strut, sweep, tube } from './prim3d';
import { BIKE_BB, headAxis, v3, type Ctx, type FrameOut, type V } from './bikebase';

const BB = BIKE_BB;

export function buildWing(x: Ctx, front: V, rear: V): FrameOut {
  const { q, n, pc } = x;
  const { paint: P, satin: St } = x.f;
  const n2 = Math.max(n, 12);
  const accent = rgb(x.spec.paint.panel ?? x.spec.paint.decal);
  const ax = headAxis(front);
  const H0 = ax.at(0.69);
  const H1 = ax.at(0.83);
  // Steuerrohr als Profil
  tube(P, H0.clone().addScaledVector(ax.u, -0.014), H1.clone().addScaledVector(ax.u, 0.014), { w0: 0.038, d0: 0.075, kind: 'aero', n: n2, col: pc });
  // Flügel: vom Steuerrohr waagrecht nach hinten, über dem Hinterrad hinunter
  const P0 = H1.clone().addScaledVector(ax.u, -0.03).add(v3(0, 0, 0.02));
  const P1 = v3(0, 0.79, -0.14);
  const P2 = v3(0, 0.775, 0.12);
  const P3 = v3(0, 0.6, 0.33);
  const wingPts = new THREE.CatmullRomCurve3([P0, P1, P2, P3], false, 'centripetal').getSpacedPoints(q ? 24 : 8);
  const K = wingPts.length - 1;
  const wW = (i: number) => 0.036 - (i / K) * 0.008;
  const wD = (i: number) => 0.12 - Math.max(0, i / K - 0.6) * 0.12;
  sweep(P, wingPts, pathFrames(wingPts, X), wW, wD, (i) => pc(wingPts[i]), shape('aero', n2));
  // Neonstreifen oben entlang des Flügels
  if (q) {
    const fr = pathFrames(wingPts, X);
    const top = wingPts.map((p, i) => {
      const c = fr[i].c.clone();
      if (c.y < 0) c.negate();
      return p.clone().addScaledVector(c, wD(i) / 2 - 0.004);
    }).slice(1, Math.round(K * 0.85));
    pipe(P, top, 0.0045, 6, accent, X, false);
  }
  // Blatt hinunter zum Tretlager
  const bTop = P1.clone().lerp(P2, 0.62);
  tube(P, BB.clone().add(v3(0, 0.01, 0)), bTop, { w0: 0.032, d0: 0.075, w1: 0.03, d1: 0.1, kind: 'aero', n: n2, col: pc });
  P.add(new THREE.CylinderGeometry(0.024, 0.024, 0.074, n2), new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(BB), pc(BB));
  // Kettenstreben und Blätter vom Flügelende zu den Ausfallenden
  for (const sx of [-1, 1]) {
    const dro = rear.clone().add(v3(sx * 0.064, 0, -0.004));
    tube(P, BB.clone().add(v3(sx * 0.03, -0.004, 0.04)), dro, { w0: 0.016, d0: 0.03, w1: 0.012, d1: 0.016, kind: 'aero', n: n2, col: pc });
    tube(P, P3.clone().add(v3(sx * 0.012, 0, -0.01)), dro.clone().add(v3(0, 0.012, -0.004)), { w0: 0.014, d0: 0.05, w1: 0.012, d1: 0.02, kind: 'aero', n: n2, col: pc });
    strut(P, dro.clone().add(v3(0, -0.014, -0.016)), dro.clone().add(v3(0, 0.022, 0.012)), 0.006, 0.03, pc(dro));
  }
  // Einarmgabel links: breites Blatt von der Krone zur Achse, Krone, Lagerschale oben
  const crown = H0.clone().addScaledVector(ax.u, -0.034);
  const end = front.clone().add(v3(-0.05, 0.006, 0));
  const blade = [crown.clone().add(v3(-0.004, 0.02, 0)), crown.clone().add(v3(-0.03, -0.01, 0)), crown.clone().add(v3(-0.05, -0.06, 0)).lerp(end, 0.12), end];
  const bp = new THREE.CatmullRomCurve3(blade, false, 'centripetal').getPoints(q ? 14 : 6);
  const BK = bp.length - 1;
  sweep(P, bp, pathFrames(bp, v3(-1, 0, 0)), (i) => 0.024 - (i / BK) * 0.008, (i) => 0.09 - (i / BK) * 0.05, (i) => (q && i > 1 && i < BK - 1 ? accent : pc(bp[i])), shape('aero', n2));
  St.add(new THREE.CylinderGeometry(0.02, 0.02, 0.012, n2), along(H1.clone().addScaledVector(ax.u, 0.02), ax.u), x.dark);
  // Achsstummel rechts frei (Einarmgabel): nur die Achse, außen eine Kappe
  St.add(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 12), new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(front.clone().add(v3(-0.058, 0, 0))), x.dark);
  // Sattelstütze steckt oben im Flügel
  const S = v3(0, 0.84, 0.115);
  const dtDir = P0.clone().sub(P1).normalize();
  return {
    H0, H1, S, ax, crown, ssTop: P2, dtA: P1, dtB: P0, dtFrame: straightFrame(dtDir), dtW: [0.034, 0.034], dtD: [0.118, 0.118],
    cableFront: crown, cableTT: H1, cableDT: P1, cableTTEnd: P2,
  };
}
