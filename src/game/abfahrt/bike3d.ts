/**
 * Detailreiche Rennräder in 3D, gebaut aus den Angaben je Modell (bikes.ts): Rahmen mit runden oder
 * tropfenförmigen Rohren (ausgestellt an den Knoten, Muffen beim Stahl, Schweißnähte beim Alu),
 * gebogene oder gerade Gabel, Laufräder mit gekreuzt eingespeichten Naben, Hochprofil, Scheibe oder
 * Dreispeiche, Reifen mit heller Flanke, Kettenblätter mit Zähnen, Kette über Ritzel und Schaltröllchen,
 * Felgen- oder Scheibenbremsen, Lenker mit Griffen und Hebeln, Auflieger, Sattel, Flaschen und ein
 * erfundener Schriftzug auf Unterrohr und Felgen.
 *
 * Zwei Stufen: 1 = eigenes Rad und Garage (alles), 0 = Gegner (weniger Segmente, keine Kleinteile).
 * Jedes starre Teil (Rahmen, Vorderrad, Hinterrad, Kurbel) ist eine einzige Geometrie mit Glanz je Ecke –
 * so kostet ein Rad nicht mehr Zeichenaufrufe als das alte. Gebaut wird je Modell und Farbe nur einmal.
 */
import * as THREE from 'three';
import { bikeById, type BikeSpec } from '../bikes';
import type { Kit } from './rider';
import { Mesher, PAINT, PhongFarMaterial, merge, rgb, type C3 } from './gloss';
import { BIKE_BB, hash3, headAxis, mix, set4, v3, type Axis, type BikeFit, type Ctx, type FrameDims, type FrameOut, type Set4, type V } from './bikebase';
import { buildCargoBox } from './cargo3d';
import { CARAVAN, buildCaravan } from './trailer3d';
import { coil, saddleShell, type ShellKind } from './saddle3d';
import { buildOrdinary } from './ordinary3d';
import { buildPostKit } from './post3d';
import { CRUISER, buildCruiser, type CruiserOut } from './cruiser3d';
import { bambooTube, hempWrap } from './bamboo3d';
import { barBottles, rodShifter, spareTubular, wingnut } from './vintage3d';
import { alphaTex } from './models3d';
import { M4, X, Z, along, cross2, lerpArr, norm2, pathFrames, pipe, prism, revolve, shape, shapeAt, strut, sweep, toothed, tube, type Frame3, type Kind, type Warp } from './prim3d';

// ------------------------------------------------------------------ Maße

export { BIKE_BB } from './bikebase';
export type { BikeFit } from './bikebase';
const BB = BIKE_BB;

const SEAT_DIR = v3(0, 0.959, 0.284).normalize();

function dims(f: BikeSpec['frame']): FrameDims {
  const base: FrameDims = {
    rF: 0.335, htBot: 0.69, htTop: 0.84, seatLen: 0.53, seatDir: SEAT_DIR,
    tt: [0.034, 0.03, 0.03, 0.028], dt: [0.05, 0.046, 0.046, 0.042], st: [0.032, 0.036, 0.03, 0.032],
    ht: [0.05, 0.042], cs: [0.022, 0.012], ss: [0.016, 0.011], fork: [0.034, 0.018],
    kind: 'round', ssLow: 0, forkCurve: false, lugs: false, welds: false, flare: 1.22,
  };
  switch (f) {
    case 'steel': return { ...base, htTop: 0.83, seatLen: 0.565, tt: [0.0254, 0.0254, 0.0254, 0.0254], dt: [0.0286, 0.0286, 0.0286, 0.0286], st: [0.0286, 0.0286, 0.0286, 0.0286], ht: [0.032, 0.032], cs: [0.02, 0.011], ss: [0.015, 0.011], fork: [0.026, 0.013], forkCurve: true, lugs: true, flare: 1 };
    // Bambus: dicke Halme, Hanfwicklungen statt Muffen
    case 'bamboo': return { ...base, htTop: 0.84, seatLen: 0.55, tt: [0.036, 0.036, 0.034, 0.034], dt: [0.044, 0.044, 0.042, 0.042], st: [0.04, 0.04, 0.038, 0.038], ht: [0.044, 0.044], cs: [0.024, 0.019], ss: [0.02, 0.016], fork: [0.03, 0.016], flare: 1 };
    // Postrad: gemuffter Stahl, langes Steuerrohr, kräftige Gabel mit Vorbiegung
    case 'post': return { ...base, htBot: 0.67, htTop: 0.86, seatLen: 0.54, tt: [0.0286, 0.0286, 0.0286, 0.0286], dt: [0.0318, 0.0318, 0.0318, 0.0318], st: [0.0286, 0.0286, 0.0286, 0.0286], ht: [0.034, 0.034], cs: [0.021, 0.012], ss: [0.016, 0.012], fork: [0.03, 0.015], forkCurve: true, lugs: true, flare: 1 };
    case 'alu': return { ...base, htTop: 0.835, seatLen: 0.56, tt: [0.036, 0.036, 0.036, 0.036], dt: [0.048, 0.048, 0.048, 0.048], st: [0.034, 0.034, 0.034, 0.034], ht: [0.038, 0.038], cs: [0.024, 0.013], ss: [0.018, 0.013], fork: [0.028, 0.014], forkCurve: true, welds: true, flare: 1 };
    case 'ti': return { ...base, htTop: 0.835, seatLen: 0.54, tt: [0.033, 0.033, 0.033, 0.033], dt: [0.042, 0.042, 0.042, 0.042], st: [0.0316, 0.0316, 0.0316, 0.0316], ht: [0.044, 0.044], cs: [0.021, 0.012], ss: [0.016, 0.011], welds: true, flare: 1 };
    case 'climb': return { ...base, tt: [0.03, 0.027, 0.026, 0.024], dt: [0.044, 0.042, 0.04, 0.038], st: [0.03, 0.032, 0.028, 0.03], ht: [0.044, 0.038], cs: [0.019, 0.011], ss: [0.012, 0.009], fork: [0.03, 0.016], flare: 1.18 };
    case 'aero': return { ...base, htTop: 0.855, seatLen: 0.5, tt: [0.026, 0.044, 0.022, 0.034], dt: [0.034, 0.07, 0.032, 0.06], st: [0.028, 0.058, 0.026, 0.05], ht: [0.04, 0.034], cs: [0.022, 0.013], ss: [0.016, 0.012], fork: [0.022, 0.016], kind: 'aero', ssLow: 0.62, flare: 1.12 };
    // Crosser: dicke Alurohre, hohes Tretlager-Gefühl durch das waagrechte Oberrohr, gerade Gabel
    case 'cross': return { ...base, htTop: 0.845, seatLen: 0.55, tt: [0.036, 0.036, 0.036, 0.036], dt: [0.05, 0.05, 0.05, 0.05], st: [0.034, 0.034, 0.034, 0.034], ht: [0.042, 0.042], cs: [0.024, 0.013], ss: [0.017, 0.012], fork: [0.032, 0.017], welds: true, flare: 1 };
    // Gravel: schlanke Stahlrohre, stark abfallendes Oberrohr, langes Steuerrohr
    case 'gravel': return { ...base, htBot: 0.665, htTop: 0.86, seatLen: 0.48, tt: [0.0318, 0.0318, 0.0318, 0.0318], dt: [0.038, 0.038, 0.038, 0.038], st: [0.0286, 0.0286, 0.0286, 0.0286], ht: [0.044, 0.044], cs: [0.021, 0.012], ss: [0.0155, 0.011], fork: [0.03, 0.016], welds: true, flare: 1 };
    // Bahnrad: steiler Sitzwinkel, Profilrohre, Sitzstreben oben am Sitzrohr
    case 'track': return { ...base, htTop: 0.83, seatLen: 0.52, seatDir: v3(0, 0.97, 0.243).normalize(), tt: [0.026, 0.046, 0.022, 0.036], dt: [0.036, 0.072, 0.034, 0.062], st: [0.03, 0.06, 0.028, 0.052], ht: [0.04, 0.034], cs: [0.024, 0.016], ss: [0.016, 0.014], fork: [0.022, 0.017], kind: 'aero', flare: 1.12 };
    // Lastenrad: Hollandrad hinten, 20-Zoll-Vorderrad vorn (Rahmen eigen gebaut)
    case 'cargo': return { ...base, rF: 0.25, seatLen: 0.5, seatDir: v3(0, 0.94, 0.34).normalize(), st: [0.034, 0.034, 0.034, 0.034], ht: [0.046, 0.046], cs: [0.024, 0.013], ss: [0.017, 0.012], fork: [0.03, 0.017], welds: true, flare: 1 };
    case 'tt': return { ...base, rF: 0.305, htBot: 0.6, htTop: 0.72, seatLen: 0.52, seatDir: v3(0, 0.97, 0.243).normalize(), tt: [0.026, 0.04, 0.024, 0.036], dt: [0.032, 0.062, 0.03, 0.056], st: [0.028, 0.052, 0.026, 0.048], ht: [0.036, 0.03], cs: [0.022, 0.013], ss: [0.016, 0.012], fork: [0.022, 0.016], kind: 'aero', flare: 1.1 };
    default: return base;
  }
}

// ------------------------------------------------------------------ Bauteile

/** Schlammfarbe */
const MUD = '#7d6a55';
/** Schlamm: unten dick, nach oben in Spritzern auslaufend, um das Tretlager am meisten */
function mudAt(p: V): number {
  const low = Math.pow(Math.max(0, Math.min(1, (0.72 - p.y) / 0.3)), 0.75);
  const spray = hash3(Math.round(p.x * 90), Math.round(p.y * 90), Math.round(p.z * 90));
  const bb = Math.max(0, 1 - p.distanceTo(BB) / 0.24);
  // einzelne Spritzer auch weiter oben, fleckiger Rand statt glattem Verlauf
  const fleck = spray > 0.88 && p.y < 0.84 ? 0.6 : 0;
  const edge = Math.max(0, Math.min(1, (low + (spray - 0.5) * 0.7 - 0.2) * 2.4));
  return Math.min(0.95, Math.max(fleck, edge * 0.95 + bb * 0.4));
}

/** Schlamm je Ecke auf den Lack: Farbe zum Matschbraun, Glanz zu matt */
function applyMud(m: Mesher, c: C3) {
  const p = new THREE.Vector3();
  if (!m.gl) m.gl = new Array(m.count).fill(m.gloss);
  for (let i = 0; i < m.count; i++) {
    p.set(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]);
    const k = mudAt(p);
    if (k <= 0) continue;
    for (let j = 0; j < 3; j++) m.col[i * 3 + j] += (c[j] - m.col[i * 3 + j]) * k;
    m.gl[i] += (0.04 - m.gl[i]) * k;
  }
}

const finishGloss = (f: BikeSpec['paint']['finish']) => (f === 'satin' ? 0.3 : f === 'brushed' ? 0.72 : f === 'chrome' ? 0.93 : f === 'candy' ? 0.8 : PAINT);

function makeCtx(spec: BikeSpec, kit: Kit, q: 0 | 1): Ctx {
  const team = spec.paint.base === 'team';
  const base = rgb(team ? kit.jersey : spec.paint.base);
  const second = spec.paint.second ? rgb(spec.paint.second) : null;
  const fade = spec.paint.fade;
  const mud = spec.paint.mud ? mudAt : null;
  const mudC = rgb(MUD);
  const paint = (p: V): C3 => {
    if (!second) return base;
    // weicher Verlauf: längs (vorn → hinten) oder senkrecht (unten → oben)
    const t = fade === 'y' ? (p.y - 0.32) / 0.55 : (p.z + 0.42) / 0.8;
    const k = Math.max(0, Math.min(1, t));
    return mix(base, second, k * k * (3 - 2 * k));
  };
  return {
    q, spec, kit, f: set4(finishGloss(spec.paint.finish)), pc: paint,
    silver: rgb('#c3c8ce'), dark: rgb('#1b1c1f'), carbon: rgb('#202125'), rubber: rgb('#121214'), gold: rgb('#c99a3a'),
    n: q ? 16 : 6,
    rings: mud && q ? 7 : 3,
    mud, mudC,
  };
}

/** blanke (verchromte) Anbauteile statt schwarzer */
const classicParts = (s: BikeSpec) => s.frame === 'steel' || s.frame === 'alu' || s.frame === 'post' || s.frame === 'bonanza' || s.frame === 'lowrider';

function buildFrame(x: Ctx, D: FrameDims, front: V, rear: V): FrameOut {
  const { q, n, pc, spec, rings } = x;
  const { paint: P, metal: Mt, satin: St } = x.f;
  const ax = headAxis(front);
  const H0 = ax.at(D.htBot);
  const H1 = ax.at(D.htTop);
  const S = BB.clone().addScaledVector(D.seatDir, D.seatLen);
  const panel = spec.paint.panel ? rgb(spec.paint.panel) : null;
  const steel = spec.frame === 'steel';
  const bam = spec.frame === 'bamboo';
  const n2 = D.kind === 'aero' ? Math.max(n, 12) : n;
  const fl = q ? D.flare : 1;

  // Steuerrohr (beim Stahlrad im Paneel-Ton, beim Bambusrad aus Stahl)
  const htCol = (p: V) => (panel && steel ? panel : pc(p));
  if (bam) tube(St, H0.clone().addScaledVector(ax.u, -0.01), H1.clone().addScaledVector(ax.u, 0.01), { w0: D.ht[0], n, col: () => x.dark });
  else if (D.kind === 'aero') tube(P, H0.clone().addScaledVector(ax.u, -0.012), H1.clone().addScaledVector(ax.u, 0.012), { w0: D.ht[1], d0: D.ht[0] * 1.55, kind: 'aero', n: n2, rings, col: htCol });
  else tube(P, H0.clone().addScaledVector(ax.u, -0.01), H1.clone().addScaledVector(ax.u, 0.01), { w0: D.ht[0], w1: D.ht[1], n, rings, col: htCol });

  // Oberrohr, Unterrohr, Sitzrohr – an den Knoten ausgestellt wie geformtes Carbon
  const ttA = S.clone().addScaledVector(D.seatDir, -0.018);
  const ttB = H1.clone().addScaledVector(ax.u, -0.02);
  const dtA = BB.clone().add(v3(0, 0.008, -0.012));
  const dtB = H0.clone().addScaledVector(ax.u, 0.022);
  let dtFrame: Frame3;
  if (bam) {
    bambooTube(P, ttA, ttB, D.tt[0] / 2, D.tt[2] / 2, 1, q);
    dtFrame = bambooTube(P, dtA, dtB, D.dt[0] / 2, D.dt[2] / 2, 2, q);
    bambooTube(P, BB.clone(), S.clone().addScaledVector(D.seatDir, -0.05), D.st[0] / 2, D.st[2] / 2, 3, q);
    // Stahlhülse oben im Sitzrohr für die Sattelstütze
    tube(St, S.clone().addScaledVector(D.seatDir, -0.07), S, { w0: D.st[2] * 0.86, n, col: () => x.dark });
  } else {
    tube(P, ttA, ttB, { w0: D.tt[0], d0: D.tt[1], w1: D.tt[2], d1: D.tt[3], kind: D.kind, n: n2, rings, flare: fl > 1 ? [fl * 0.97, 0.12, fl, 0.14] : undefined, col: pc });
    dtFrame = tube(P, dtA, dtB, { w0: D.dt[0], d0: D.dt[1], w1: D.dt[2], d1: D.dt[3], kind: D.kind, n: n2, rings, flare: fl > 1 ? [fl * 1.06, 0.12, fl * 1.04, 0.13] : undefined, col: pc });
    tube(P, BB.clone(), S, { w0: D.st[0], d0: D.st[1], w1: D.st[2], d1: D.st[3], kind: D.kind, n: n2, rings, flare: fl > 1 ? [fl, 0.1, 1.04, 0.06] : undefined, col: pc });
  }
  if (panel && steel) {
    // Paneel oben am Sitzrohr, eingefasst von goldenen Linien
    const p0 = BB.clone().addScaledVector(D.seatDir, D.seatLen - 0.16);
    const p1 = BB.clone().addScaledVector(D.seatDir, D.seatLen - 0.075);
    tube(P, p0, p1, { w0: D.st[0] * 1.012, n, col: () => panel });
    if (q) for (const p of [p0, p1]) tube(P, p.clone().addScaledVector(D.seatDir, -0.0015), p.clone().addScaledVector(D.seatDir, 0.0015), { w0: D.st[0] * 1.03, n, col: () => x.gold });
  }
  if (spec.paint.stripes) {
    // Regenbogenstreifen um Ober- und Sitzrohr (von oben nach unten bzw. vorn nach hinten)
    const bands = spec.paint.stripes.map(rgb);
    const bw = 0.0105;
    const ring = (a: V, b: V, w: [number, number, number, number], kind: Kind, at: number) => {
      const len = a.distanceTo(b);
      const t0 = at - (bands.length * bw) / len / 2;
      bands.forEach((c, i) => {
        const u0 = t0 + (i * bw) / len;
        const u1 = u0 + bw / len;
        const um = (u0 + u1) / 2;
        const ww = (w[0] + (w[2] - w[0]) * um) * 1.018;
        const dd = (w[1] + (w[3] - w[1]) * um) * 1.018;
        tube(P, a.clone().lerp(b, u0), a.clone().lerp(b, u1), { w0: ww, d0: dd, kind, n: n2, col: () => c, caps: false });
      });
    };
    ring(ttB, ttA, [D.tt[2], D.tt[3], D.tt[0], D.tt[1]], D.kind, 0.5);
    ring(S, BB.clone(), [D.st[2], D.st[3], D.st[0], D.st[1]], D.kind, 0.2);
  }
  // Tretlagergehäuse
  if (bam) St.add(new THREE.CylinderGeometry(0.023, 0.023, 0.072, n2), M4(BB.x, BB.y, BB.z, 0, 0, Math.PI / 2), x.dark);
  else P.add(new THREE.CylinderGeometry(0.023, 0.023, 0.072, n2), M4(BB.x, BB.y, BB.z, 0, 0, Math.PI / 2), pc(BB));

  // Hinterbau: Kettenstreben, Sitzstreben (beim Aero tief angesetzt), Ausfallenden
  const ssTop = D.ssLow ? BB.clone().addScaledVector(D.seatDir, (D.ssLow - BB.y) / D.seatDir.y) : S.clone().addScaledVector(D.seatDir, -0.035);
  for (const sx of [-1, 1]) {
    const dro = rear.clone().add(v3(sx * 0.064, 0, -0.004));
    if (bam) {
      bambooTube(P, BB.clone().add(v3(sx * 0.03, -0.004, 0.036)), dro.clone().add(v3(0, 0, -0.03)), D.cs[0] / 2, D.cs[1] / 2, 5 + sx, q);
      bambooTube(P, ssTop.clone().add(v3(sx * 0.019, 0, 0.012)), dro.clone().add(v3(0, 0.03, -0.022)), D.ss[0] / 2, D.ss[1] / 2, 8 + sx, q);
      strut(St, dro.clone().add(v3(0, -0.014, -0.03)), dro.clone().add(v3(0, 0.032, 0.012)), 0.006, 0.034, x.dark);
      continue;
    }
    tube(P, BB.clone().add(v3(sx * 0.03, -0.004, 0.036)), dro, { w0: D.cs[0] * 0.8, d0: D.cs[0], w1: D.cs[1], n, rings, col: pc });
    tube(P, ssTop.clone().add(v3(sx * 0.019, 0, 0.012)), dro.clone().add(v3(0, 0.012, -0.004)), { w0: D.ss[0], w1: D.ss[1], n, rings, col: pc });
    // Ausfallende (Bahnrad: waagrecht nach hinten offen)
    if (spec.frame === 'track') strut(P, dro.clone().add(v3(0, 0.004, -0.03)), dro.clone().add(v3(0, -0.002, 0.026)), 0.006, 0.026, pc(dro));
    else strut(P, dro.clone().add(v3(0, -0.014, -0.016)), dro.clone().add(v3(0, 0.022, 0.012)), 0.006, 0.03, pc(dro));
  }
  if (!D.ssLow) {
    // Bremsbrücke
    const br = ssTop.clone().lerp(rear, 0.4);
    strut(P, br.clone().add(v3(-0.024, 0, 0)), br.clone().add(v3(0.024, 0, 0)), 0.008, 0.008, pc(br), Z);
  }

  const dtDir = dtB.clone().sub(dtA).normalize();
  const ttDir = ttB.clone().sub(ttA).normalize();
  if (bam) {
    // Hanfwicklungen an allen Knoten: Steuerrohr, Sitzknoten, Tretlager, Ausfallenden
    const Ma = x.f.matte;
    const sd = D.seatDir.clone();
    hempWrap(Ma, ttB, ttDir.clone().negate(), 0.085, D.tt[2] / 2, 11, q);
    hempWrap(Ma, dtB, dtDir.clone().negate(), 0.09, D.dt[2] / 2, 12, q);
    hempWrap(Ma, H1.clone().addScaledVector(ax.u, -0.004), ax.u.clone().negate(), 0.07, D.ht[0] / 2 * 0.95, 13, q);
    hempWrap(Ma, H0.clone().addScaledVector(ax.u, 0.004), ax.u, 0.06, D.ht[0] / 2 * 0.95, 14, q);
    hempWrap(Ma, ttA, ttDir, 0.08, D.tt[0] / 2, 15, q);
    hempWrap(Ma, S.clone().addScaledVector(sd, -0.05), sd.clone().negate(), 0.1, D.st[2] / 2, 16, q);
    hempWrap(Ma, dtA, dtDir, 0.09, D.dt[0] / 2, 17, q);
    hempWrap(Ma, BB.clone(), sd, 0.09, D.st[0] / 2, 18, q);
    x.f.matte.add(new THREE.SphereGeometry(1, q ? 16 : 6, q ? 12 : 4), M4(BB.x, BB.y + 0.006, BB.z + 0.004, 0, 0, 0, 0.032, 0.04, 0.05), rgb('#9c8155'));
    for (const sx of [-1, 1]) {
      const dro = rear.clone().add(v3(sx * 0.064, 0, -0.004));
      const csA = BB.clone().add(v3(sx * 0.03, -0.004, 0.036));
      const ssA = ssTop.clone().add(v3(sx * 0.019, 0, 0.012));
      hempWrap(Ma, csA, dro.clone().sub(csA), 0.075, D.cs[0] / 2, 20 + sx, q);
      hempWrap(Ma, ssA, dro.clone().sub(ssA), 0.07, D.ss[0] / 2, 22 + sx, q);
      const cE = dro.clone().add(v3(0, 0, -0.03));
      const sE = dro.clone().add(v3(0, 0.03, -0.022));
      hempWrap(Ma, cE, csA.clone().sub(cE), 0.06, D.cs[1] / 2, 24 + sx, q);
      hempWrap(Ma, sE, ssA.clone().sub(sE), 0.06, D.ss[1] / 2, 26 + sx, q);
    }
  } else if (D.lugs) {
    // Muffen, Steuersatz, Sattelmuffe: verchromt mit Goldrand (Rennrad) oder im Lack (Postrad)
    const lugM = steel ? Mt : P;
    const lugC = (p: V) => (steel ? x.silver : pc(p));
    const sleeve = (a: V, dir: V, r: number, len = 0.032) => {
      const b = a.clone().addScaledVector(dir, len);
      tube(lugM, a, b, { w0: r * 2.34, w1: r * 2.12, n, col: () => lugC(a) });
      if (q && steel) tube(P, b.clone().addScaledVector(dir, -0.002), b.clone().addScaledVector(dir, 0.002), { w0: r * 2.2, n, col: () => x.gold });
    };
    sleeve(ttB.clone().addScaledVector(ttDir, 0.006), ttDir.clone().negate(), D.tt[0] / 2);
    sleeve(ttA.clone().addScaledVector(ttDir, -0.004), ttDir, D.tt[0] / 2);
    sleeve(dtB.clone().addScaledVector(dtDir, 0.004), dtDir.clone().negate(), D.dt[0] / 2);
    sleeve(BB.clone().addScaledVector(dtDir, 0.024), dtDir, D.dt[0] / 2, 0.022);
    sleeve(BB.clone().addScaledVector(D.seatDir, 0.024), D.seatDir, D.st[0] / 2, 0.022);
    sleeve(S.clone().addScaledVector(D.seatDir, -0.07), D.seatDir, D.st[0] / 2, 0.07);
    tube(lugM, H0.clone().addScaledVector(ax.u, -0.032), H0.clone().addScaledVector(ax.u, 0.024), { w0: D.ht[0] * 1.22, n, col: () => lugC(H0) });
    tube(lugM, H1.clone().addScaledVector(ax.u, -0.03), H1.clone().addScaledVector(ax.u, 0.034), { w0: D.ht[0] * 1.22, n, col: () => lugC(H1) });
    // Steuersatz (verchromt)
    if (!steel) for (const [p, d] of [[H1, 1], [H0, -1]] as [V, number][]) tube(Mt, p.clone().addScaledVector(ax.u, d * 0.034), p.clone().addScaledVector(ax.u, d * 0.046), { w0: D.ht[0] * 1.14, n, col: () => x.silver });
    if (q && steel && spec.drive !== 'rod') {
      // Rahmenschalthebel am Unterrohr
      const sh = dtB.clone().addScaledVector(dtDir, -0.09);
      for (const sx of [-1, 1]) {
        const boss = sh.clone().add(v3(sx * (D.dt[0] / 2 + 0.004), 0, 0));
        Mt.add(new THREE.CylinderGeometry(0.009, 0.009, 0.008, 10), M4(boss.x, boss.y, boss.z, 0, 0, Math.PI / 2), x.silver);
        strut(Mt, boss.clone().add(v3(sx * 0.004, 0, 0)), boss.clone().add(v3(sx * 0.006, -0.012, 0.05)), 0.004, 0.009, x.silver, X, 0.004, 0.006);
      }
      // Bremszug hinten oben auf dem Oberrohr
      const up = v3(0, D.tt[0] / 2 + 0.003, 0);
      pipe(Mt, [ttB.clone().addScaledVector(ttDir, -0.04).add(up), ttA.clone().addScaledVector(ttDir, 0.05).add(up)], 0.0012, 4, x.silver, X, false);
    }
  } else if (D.welds) {
    // Alu/Titan: feine Schweißraupen an den Knoten
    const bead = (p: V, dir: V, r: number) => tube(P, p.clone().addScaledVector(dir, -0.003), p.clone().addScaledVector(dir, 0.003), { w0: r * 2.16, n, col: () => pc(p) });
    bead(ttB.clone().addScaledVector(ttDir, -0.002), ttDir, D.tt[0] / 2);
    bead(ttA.clone().addScaledVector(ttDir, 0.004), ttDir, D.tt[0] / 2);
    bead(dtB.clone().addScaledVector(dtDir, -0.022), dtDir, D.dt[0] / 2);
    bead(BB.clone().addScaledVector(dtDir, 0.03), dtDir, D.dt[0] / 2);
    bead(BB.clone().addScaledVector(D.seatDir, 0.026), D.seatDir, D.st[0] / 2);
    tube(St, H1.clone().addScaledVector(ax.u, 0.006), H1.clone().addScaledVector(ax.u, 0.02), { w0: D.ht[0] * 1.06, n, col: () => x.dark });
    tube(St, H0.clone().addScaledVector(ax.u, -0.024), H0.clone().addScaledVector(ax.u, -0.01), { w0: D.ht[0] * 1.06, n, col: () => x.dark });
  } else {
    // moderne Lagerschale oben (Aero: tropfenförmig)
    tube(St, H1.clone().addScaledVector(ax.u, 0.01), H1.clone().addScaledVector(ax.u, 0.024), { w0: D.ht[1], d0: D.kind === 'aero' ? D.ht[0] * 1.45 : D.ht[1], kind: D.kind === 'aero' ? 'aero' : 'round', n: n2, col: () => x.dark });
  }
  // Sattelklemme (Aero: im Rahmen versteckt)
  if (D.kind !== 'aero') {
    tube(steel ? Mt : St, S.clone().addScaledVector(D.seatDir, -0.012), S.clone().addScaledVector(D.seatDir, 0.012), { w0: D.st[2] * 1.16, n, col: () => (steel ? x.silver : x.dark) });
  }
  // Steuerkopf-Emblem
  if (q) {
    const mid = H0.clone().lerp(H1, 0.62);
    const off = (D.kind === 'aero' ? D.ht[0] * 0.78 : D.ht[0] / 2) + 0.0008;
    const badge = mid.clone().addScaledVector(ax.n, -off);
    Mt.add(new THREE.CylinderGeometry(0.0095, 0.0095, 0.0016, 14), along(badge, ax.n.clone().negate()), rgb(spec.paint.decal));
  }

  // Gabel
  const crown = H0.clone().addScaledVector(ax.u, -0.034);
  if (D.forkCurve) {
    // klassisch: Krone und gebogene Scheiden mit Vorbiegung (Stahl: Krone und Enden verchromt)
    (steel ? Mt : P).add(new THREE.BoxGeometry(0.1, 0.024, 0.04), along(crown, ax.u), steel ? x.silver : pc(crown));
    for (const sx of [-1, 1]) {
      const pts: V[] = [];
      const K = q ? 10 : 5;
      const end = front.clone().add(v3(sx * 0.05, 0.004, 0));
      const top = crown.clone().add(v3(sx * 0.045, -0.006, 0));
      const axisEnd = ax.at(front.y).add(v3(sx * 0.05, 0, 0));
      for (let i = 0; i <= K; i++) {
        const t = i / K;
        // der Lenkachse folgen, unten nach vorn zur Achse biegen
        pts.push(top.clone().lerp(axisEnd, t).lerp(top.clone().lerp(end, t), Math.pow(t, 2.4)));
      }
      const K1 = pts.length - 1;
      sweep(P, pts, pathFrames(pts, X), (i) => D.fork[0] * 0.66 - (D.fork[0] * 0.66 - D.fork[1] * 0.62) * (i / K1), (i) => D.fork[0] - (D.fork[0] - D.fork[1]) * (i / K1), (i) => pc(pts[i]), shape('round', n));
      if (steel && q) {
        const tip = pts.slice(-3);
        sweep(Mt, tip, pathFrames(tip, X), () => D.fork[1] * 0.72, () => D.fork[1] * 1.06, () => x.silver, shape('round', n));
      }
      strut(steel ? Mt : P, end.clone().add(v3(0, -0.012, 0.006)), end.clone().add(v3(0, 0.016, -0.004)), 0.005, 0.022, steel ? x.silver : pc(end));
    }
  } else {
    // gerade Carbongabel mit geformten Schultern (Aero: Profilscheiden); Titanrad: schwarze Gabel
    const blackFork = spec.frame === 'ti' || bam;
    const fc = (p: V) => (blackFork ? x.carbon : pc(p));
    const fm = blackFork ? x.f.satin : P;
    const aero = D.kind === 'aero';
    for (const sx of [-1, 1]) {
      const end = front.clone().add(v3(sx * 0.05, 0.006, 0));
      const ctrl = [crown.clone().add(v3(sx * 0.004, 0.026, 0)), crown.clone().add(v3(sx * 0.026, 0.004, 0)), crown.clone().add(v3(sx * 0.043, -0.03, 0)), crown.clone().add(v3(sx * 0.047, -0.07, 0)).lerp(end, 0.08), end];
      const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
      // mit Schlamm gleichmäßig unterteilt, damit der Dreck unten an den Scheiden sitzt
      const pts = x.mud && q ? curve.getSpacedPoints(20) : curve.getPoints(q ? 12 : 6);
      const K1 = pts.length - 1;
      const k = aero ? 0.62 : 1;
      const kd = aero ? 1.7 : 1;
      // oben breit (Schulter), unten schlank
      const wAt = (i: number) => { const t = i / K1; return (D.fork[0] + (D.fork[1] - D.fork[0]) * t) * k * (1 + 0.55 * Math.max(0, 1 - t * 4)); };
      const dAt = (i: number) => { const t = i / K1; return (D.fork[0] + (D.fork[1] - D.fork[0]) * t) * kd * (1 + 0.35 * Math.max(0, 1 - t * 4)); };
      sweep(fm, pts, pathFrames(pts, v3(-1, 0, 0)), wAt, dAt, (i) => fc(pts[i]), shape(D.kind, n2));
    }
  }
  const cableFront = crown.clone().addScaledVector(ax.n, -0.028).addScaledVector(ax.u, 0.03);
  const cableTT = ttB.clone().addScaledVector(ttDir, -0.04).add(v3(0, D.tt[0] / 2 + 0.003, 0));
  const cableDT = dtB.clone().addScaledVector(dtDir, -0.075).add(v3(D.dt[0] / 2 + 0.004, 0, 0));
  const cableTTEnd = ttA.clone().addScaledVector(ttDir, 0.05).add(v3(0, D.tt[0] / 2 + 0.003, 0));
  return { H0, H1, S, ax, crown, ssTop, dtA, dtB, dtFrame, dtW: [D.dt[0], D.dt[2]], dtD: [D.dt[1], D.dt[3]], cableFront, cableTT, cableDT, cableTTEnd };
}

/**
 * Lastenrad (Long John): Fahrerteil mit tiefem Durchstieg und geschwungenem Oberrohr, Lenkrohr hinter der
 * Kiste, langer Ladeträger mit Querstreben unter der Kiste, vorn Steuerrohr mit Gabel fürs 20-Zoll-Rad,
 * Lenkstange unter der Kiste, Doppelständer und Scheinwerfer.
 */
function buildCargoFrame(x: Ctx, D: FrameDims, front: V, rear: V): FrameOut {
  const { q, n, pc } = x;
  const { paint: P, metal: Mt } = x.f;
  // Lenkachse des Fahrers (72°), unten im Knoten mit Unterrohr und Ladeträger
  const ang = (72 * Math.PI) / 180;
  const u = v3(0, Math.sin(ang), Math.cos(ang));
  const p0 = v3(0, 0.62, -0.47);
  const ax: Axis = { u, n: v3(0, -u.z, u.y), at: (y: number) => p0.clone().addScaledVector(u, (y - p0.y) / u.y) };
  const H0 = ax.at(0.64);
  const H1 = ax.at(0.9);
  const J = ax.at(0.28);
  const S = BB.clone().addScaledVector(D.seatDir, D.seatLen);
  tube(P, H0.clone().addScaledVector(u, -0.01), H1.clone().addScaledVector(u, 0.01), { w0: D.ht[0], n, col: pc });
  for (const [p, d] of [[H1, 1], [H0, -1]] as [V, number][]) tube(Mt, p.clone().addScaledVector(u, d * 0.006), p.clone().addScaledVector(u, d * 0.02), { w0: D.ht[0] * 1.12, n, col: () => x.silver });
  tube(P, H0.clone(), J.clone(), { w0: 0.05, n, col: pc });
  // tiefes Unterrohr (Durchstieg) und geschwungenes Oberrohr
  const dtA = BB.clone().add(v3(0, 0.004, -0.018));
  const dtFrame = tube(P, dtA, J.clone(), { w0: 0.05, d0: 0.044, n, col: pc });
  const ttA = BB.clone().addScaledVector(D.seatDir, 0.33);
  const ttB = H1.clone().addScaledVector(u, -0.075);
  const ttPts = new THREE.CatmullRomCurve3([ttA, ttA.clone().lerp(ttB, 0.5).add(v3(0, -0.05, 0)), ttB], false, 'centripetal').getPoints(q ? 12 : 4);
  sweep(P, ttPts, pathFrames(ttPts, X), () => 0.032, () => 0.032, (i) => pc(ttPts[i]), shape('round', n));
  tube(P, BB.clone(), S, { w0: D.st[0], n, col: pc });
  P.add(new THREE.CylinderGeometry(0.024, 0.024, 0.074, n), M4(BB.x, BB.y, BB.z, 0, 0, Math.PI / 2), pc(BB));
  tube(Mt, S.clone().addScaledVector(D.seatDir, -0.012), S.clone().addScaledVector(D.seatDir, 0.012), { w0: D.st[0] * 1.16, n, col: () => x.silver });
  // Hinterbau mit Bremsbrücke
  const ssTop = S.clone().addScaledVector(D.seatDir, -0.035);
  for (const sx of [-1, 1]) {
    const dro = rear.clone().add(v3(sx * 0.064, 0, -0.004));
    tube(P, BB.clone().add(v3(sx * 0.03, -0.004, 0.036)), dro, { w0: D.cs[0] * 0.8, d0: D.cs[0], w1: D.cs[1], n, col: pc });
    tube(P, ssTop.clone().add(v3(sx * 0.019, 0, 0.012)), dro.clone().add(v3(0, 0.012, -0.004)), { w0: D.ss[0], w1: D.ss[1], n, col: pc });
    strut(P, dro.clone().add(v3(0, -0.014, -0.016)), dro.clone().add(v3(0, 0.022, 0.012)), 0.006, 0.03, pc(dro));
  }
  const br = ssTop.clone().lerp(rear, 0.4);
  strut(P, br.clone().add(v3(-0.024, 0, 0)), br.clone().add(v3(0.024, 0, 0)), 0.008, 0.008, pc(br), Z);

  // Ladeträger: vom Knoten tief unter der Kiste nach vorn, vorn hinauf zum Steuerrohr
  const fax = headAxis(front);
  const F0 = fax.at(0.56);
  const F1 = fax.at(0.71);
  const beam = new THREE.CatmullRomCurve3([J.clone(), v3(0, 0.232, -0.7), v3(0, 0.232, -1.15), v3(0, 0.33, -1.33), F0.clone().addScaledVector(fax.u, 0.03)], false, 'centripetal').getSpacedPoints(q ? 26 : 8);
  sweep(P, beam, pathFrames(beam, X), () => 0.054, () => 0.046, (i) => pc(beam[i]), shape('round', n));
  // Querstreben und Seitenholme, auf denen die Kiste steht
  for (const z of [-0.7, -0.95, -1.18]) strut(P, v3(-0.288, 0.255, z), v3(0.288, 0.255, z), 0.02, 0.016, pc(v3(0, 0.255, z)), Z);
  for (const sx of [-1, 1]) strut(P, v3(sx * 0.285, 0.256, -0.68), v3(sx * 0.285, 0.256, -1.2), 0.018, 0.018, pc(v3(0, 0.256, -0.9)), X);
  // vorderes Steuerrohr, Gabel
  tube(P, F0.clone().addScaledVector(fax.u, -0.01), F1, { w0: 0.044, n, col: pc });
  for (const [p, d] of [[F1, 1], [F0, -1]] as [V, number][]) tube(Mt, p.clone().addScaledVector(fax.u, d * 0.004), p.clone().addScaledVector(fax.u, d * 0.016), { w0: 0.05, n, col: () => x.silver });
  const crown = F0.clone().addScaledVector(fax.u, -0.03);
  P.add(new THREE.BoxGeometry(0.11, 0.026, 0.042), along(crown, fax.u), pc(crown));
  for (const sx of [-1, 1]) {
    const end = front.clone().add(v3(sx * 0.05, 0.006, 0));
    tube(P, crown.clone().add(v3(sx * 0.045, -0.008, 0)), end, { w0: 0.028, d0: 0.03, w1: 0.016, n, col: pc });
    strut(P, end.clone().add(v3(0, -0.012, 0.006)), end.clone().add(v3(0, 0.016, -0.004)), 0.005, 0.022, pc(end));
  }
  // Lenkstange unter der Kiste: Hebel am Lenkrohr → Hebel an der Gabel (links)
  const l0 = J.clone().add(v3(-0.085, 0.02, -0.02));
  const l1 = crown.clone().add(v3(-0.085, -0.02, 0.03));
  strut(Mt, J.clone().add(v3(-0.02, 0.02, 0)), l0, 0.012, 0.01, x.silver);
  strut(Mt, crown.clone().add(v3(-0.04, -0.02, 0)), l1, 0.012, 0.01, x.silver);
  pipe(Mt, [l0, v3(-0.085, 0.206, -0.7), v3(-0.085, 0.206, -1.16), l1], 0.0055, q ? 6 : 4, x.silver);
  if (q) for (const p of [l0, l1]) Mt.add(new THREE.SphereGeometry(0.011, 8, 6), M4(p.x, p.y, p.z), x.dark);
  // Doppelständer, hochgeklappt unter der Kiste
  const piv = v3(0, 0.205, -1.12);
  for (const sx of [-1, 1]) pipe(Mt, [piv.clone().add(v3(sx * 0.03, 0, 0)), v3(sx * 0.12, 0.19, -0.86)], 0.009, q ? 8 : 4, x.silver);
  pipe(Mt, [v3(-0.12, 0.19, -0.86), v3(0.12, 0.19, -0.86)], 0.008, q ? 8 : 4, x.silver);
  Mt.add(new THREE.CylinderGeometry(0.014, 0.014, 0.08, 10), M4(piv.x, piv.y, piv.z, 0, 0, Math.PI / 2), x.dark);
  // Scheinwerfer vorn am Steuerrohr
  const fwd = fax.n.clone().negate();
  const lamp = F1.clone().addScaledVector(fwd, 0.055).add(v3(0, -0.02, 0));
  strut(Mt, F1.clone().addScaledVector(fwd, 0.02), lamp, 0.01, 0.006, x.silver);
  Mt.add(new THREE.CylinderGeometry(0.034, 0.028, 0.05, q ? 16 : 8), along(lamp, fwd), x.silver);
  x.f.paint.add(new THREE.CylinderGeometry(0.03, 0.03, 0.004, q ? 16 : 8), along(lamp.clone().addScaledVector(fwd, 0.026), fwd), rgb('#fff6d6'));
  return {
    H0, H1, S, ax, crown, ssTop, dtA, dtB: J, dtFrame, dtW: [0.05, 0.05], dtD: [0.044, 0.044],
    cableFront: crown, cableTT: ttB, cableDT: dtA, cableTTEnd: ttA,
  };
}

/** Hollandlenker: hoher Vorbau, nach hinten geschwungen, Ledergriffe, Hebel davor, Klingel links */
function cityCockpit(x: Ctx, out: FrameOut, fit: BikeFit): V {
  const { H1, ax } = out;
  const { q, n, spec } = x;
  const { metal: Mt, satin: St, matte: Ma } = x.f;
  const steerTop = H1.clone().addScaledVector(ax.u, 0.085);
  tube(Mt, H1.clone().addScaledVector(ax.u, 0.015), steerTop, { w0: 0.026, n, col: () => x.silver });
  Mt.add(new THREE.SphereGeometry(0.016, n, 8), M4(steerTop.x, steerTop.y, steerTop.z), x.silver);
  const clamp = steerTop.clone().add(v3(0, 0.035, -0.075));
  tube(Mt, steerTop.clone(), clamp, { w0: 0.026, w1: 0.024, n, col: () => x.silver });
  Mt.add(new THREE.CylinderGeometry(0.019, 0.019, 0.05, n), M4(clamp.x, clamp.y, clamp.z, 0, 0, Math.PI / 2), x.silver);
  const grip = rgb(spec.tape);
  const smooth = (ctrl: V[], k: number) => new THREE.CatmullRomCurve3(ctrl, false, 'centripetal').getSpacedPoints(k);
  for (const sx of [-1, 1]) {
    const L = (dx: number, dy: number, dz: number) => clamp.clone().add(v3(sx * dx, dy, dz));
    const pts = smooth([L(0, 0, 0), L(0.09, 0.004, -0.002), L(0.17, 0.016, 0.026), L(0.235, 0.028, 0.08), L(0.272, 0.033, 0.13), L(0.302, 0.034, 0.18)], q ? 26 : 6);
    let k = pts.findIndex((p) => Math.abs(p.x - clamp.x) > 0.246);
    if (k < 1) k = pts.length - 2;
    pipe(Mt, pts.slice(0, k + 1), 0.011, n, x.silver);
    pipe(Ma, pts.slice(k), 0.0165, n, grip);
    // Hebel vor dem Griff
    const lev = pts.slice(k).map((p) => p.clone().add(v3(0, -0.01, -0.04)));
    if (lev.length > 1) {
      St.add(new THREE.BoxGeometry(0.03, 0.026, 0.034), M4(lev[0].x, lev[0].y + 0.01, lev[0].z + 0.018), x.dark);
      pipe(Mt, lev, 0.005, q ? 6 : 4, x.silver);
    }
    if (sx < 0 && q) {
      // Klingel
      const b = L(0.12, 0.024, 0.012);
      Mt.add(new THREE.SphereGeometry(0.026, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M4(b.x, b.y + 0.004, b.z), x.silver);
      Mt.add(new THREE.CylinderGeometry(0.004, 0.004, 0.012, 6), M4(b.x, b.y + 0.033, b.z), x.silver);
      strut(St, b.clone().add(v3(0.01, 0.006, 0.02)), b.clone().add(v3(0.03, 0.012, 0.035)), 0.008, 0.004, x.dark);
    }
    if (sx > 0) {
      fit.hood = L(0.287, 0.038, 0.155);
      fit.drop = L(0.282, 0.032, 0.142);
    }
  }
  return clamp;
}

/** flache Leiste mit gerundeten Kanten (Querschnitt der Holzschutzbleche) */
const SLAB: [number, number][] = Array.from({ length: 16 }, (_, j) => {
  const a = (j / 16) * Math.PI * 2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [Math.sign(c) * Math.abs(c) ** 0.2, Math.sign(s) * Math.abs(s) ** 0.2];
});

/** Schutzbleche mit Streben (Lastenrad in Rahmenfarbe, sonst Alu blank, Holz aus verleimten Leisten) */
function buildFenders(x: Ctx, front: V, rear: V, rOutF: number, rOutR: number) {
  const { q, spec } = x;
  const mode = spec.frame === 'cargo' ? 'paint' : spec.fenders === true || spec.fenders === undefined ? 'alu' : spec.fenders;
  const m = mode === 'paint' ? x.f.paint : mode === 'wood' ? x.f.satin : x.f.metal;
  const alu = rgb('#d3d7dc');
  const chrome = rgb('#e4e8ec');
  const white = rgb('#f3f2ee');
  const D2R = Math.PI / 180;
  // Holz: verleimte Lagen (hell/dunkel) längs; Lack: hinten ein weißes Ende (Lastenrad ohne)
  const woods = [rgb('#dcbc8c'), rgb('#6e4a2c'), rgb('#c9a26e'), rgb('#5a3a20')];
  const arc = (c: V, r: number, a0: number, a1: number, w: number, tip: boolean) => {
    const K = q ? 24 : 8;
    const pts: V[] = [];
    const ang: number[] = [];
    for (let k = 0; k <= K; k++) {
      const a = a0 + ((a1 - a0) * k) / K;
      pts.push(c.clone().add(v3(0, Math.sin(a) * r, Math.cos(a) * r)));
      ang.push(a);
    }
    // Querschnitt flach; s seitlich, c nach außen (s × c = −t bei steigendem Winkel)
    const fr = pts.map((p) => ({ s: X.clone(), c: p.clone().sub(c).setX(0).normalize() }));
    if (mode === 'wood') {
      // verleimte Leisten nebeneinander (Ahorn, Nuss als Streifen), Querschnitt um den Reifen gewölbt
      const bands: [number, number][] = q ? [[0.22, 0], [0.06, 1], [0.14, 0], [0.16, 1], [0.14, 0], [0.06, 1], [0.22, 0]] : [[1, 0]];
      const D = 0.007;
      let s0 = -0.5;
      bands.forEach(([bw, wi], j) => {
        const mid = (s0 + bw / 2) * w;
        s0 += bw;
        const drop = (4 * D * mid * mid) / (w * w);
        const slope = (8 * D * mid) / (w * w);
        const sp = pts.map((p, i) => p.clone().addScaledVector(fr[i].c, -drop).add(v3(mid, 0, 0)));
        const sf = fr.map((f) => ({ s: f.s.clone().addScaledVector(f.c, -slope).normalize(), c: f.c.clone().addScaledVector(f.s, slope).normalize() }));
        const grain = (i: number): C3 => mix(woods[wi], woods[wi + 2], 0.5 + 0.5 * Math.sin(ang[i] * 23 + j * 2.1));
        sweep(m, sp, sf, () => bw * w + 0.0006, () => 0.008, grain, q ? SLAB : shape('round', 4));
      });
    } else {
      const col = (i: number): C3 => (mode === 'paint' ? (tip && spec.frame !== 'cargo' && ang[i] < a0 + 24 * D2R ? white : x.pc(pts[i])) : mode === 'chrome' ? chrome : alu);
      sweep(m, pts, fr, () => w, () => 0.008, col, shape('round', q ? 10 : 6));
    }
    return (a: number, dx: number) => c.clone().add(v3(dx, Math.sin(a) * (r - 0.004), Math.cos(a) * (r - 0.004)));
  };
  const wide = (spec.tire?.w ?? 0.012) > 0.018 ? 1.15 : 1;
  const R = arc(rear, rOutR + 0.018, -18 * D2R, 140 * D2R, 0.054 * wide, true);
  const F = arc(front, rOutF + 0.012, 40 * D2R, 205 * D2R, 0.05 * wide, false);
  // Streben zu den Achsenden
  const stay = rgb('#c3c8ce');
  for (const sx of [-1, 1]) {
    for (const a of [8, 34]) pipe(x.f.metal, [R(a * D2R, sx * 0.024 * wide), rear.clone().add(v3(sx * 0.062, 0.004, 0.006))], 0.0022, 4, stay);
    pipe(x.f.metal, [F(172 * D2R, sx * 0.022 * wide), front.clone().add(v3(sx * 0.052, 0.004, -0.004))], 0.0022, 4, stay);
  }
  // Rückstrahler hinten auf dem Blech
  if (q) x.f.paint.add(new THREE.BoxGeometry(0.03, 0.04, 0.008), along(R(-6 * D2R, 0).add(v3(0, 0, 0.008)), v3(0, 1, 0)), rgb('#c8141b'));
  return { rearAt: R };
}

function buildSeat(x: Ctx, S: V, seatDir: V, saddle: V) {
  const { q, n, spec } = x;
  const { metal: Mt, satin: St } = x.f;
  const aero = spec.frame === 'aero' || spec.frame === 'tt';
  const classic = classicParts(spec);
  const sprung = spec.saddle === 'spring';
  // Sattelstütze in Verlängerung des Sitzrohrs (Federsattel: Klemme tiefer, darüber die Federn)
  const postTop = S.clone().addScaledVector(seatDir, (saddle.y - (sprung ? 0.078 : 0.036) - S.y) / seatDir.y);
  tube(classic ? Mt : St, S.clone().addScaledVector(seatDir, -0.05), postTop,
    { w0: aero ? 0.022 : 0.0272, d0: aero ? 0.042 : 0.0272, kind: aero ? 'aero' : 'round', n: aero ? Math.max(n, 12) : n, col: () => (classic ? x.silver : x.carbon) });
  (classic ? Mt : St).add(new THREE.CylinderGeometry(0.012, 0.012, sprung ? 0.11 : 0.05, q ? 12 : 6), M4(postTop.x, postTop.y + 0.004, postTop.z, 0, 0, Math.PI / 2), classic ? x.silver : x.dark);

  // Sattel als Loft von der Nase (vorn) zum Heck
  saddleShell(x, saddle, spec.saddle === 'leather' || spec.saddle === 'tt' || sprung ? spec.saddle as ShellKind : 'race');
  if (sprung) {
    // Federsattel: Doppeldraht-Gestell von der Nase zur Klemme, hinten zwei Schraubenfedern unter dem Heck
    for (const sx of [-1, 1]) {
      const nose = saddle.clone().add(v3(sx * 0.012, -0.02, -0.12));
      const clampP = postTop.clone().add(v3(sx * 0.05, 0.004, 0));
      const foot = saddle.clone().add(v3(sx * 0.05, -0.092, 0.075));
      pipe(Mt, [nose, nose.clone().lerp(clampP, 0.55).add(v3(0, -0.012, 0)), clampP, foot], 0.0036, 5, x.silver);
      coil(Mt, foot.clone().add(v3(0, 0.004, 0)), saddle.clone().add(v3(sx * 0.05, -0.03, 0.082)), 0.014, 7, 0.0022, x.silver, q);
      Mt.add(new THREE.CylinderGeometry(0.016, 0.016, 0.004, q ? 12 : 6), M4(foot.x, foot.y, foot.z), x.silver);
    }
    return;
  }
  // Sattelgestell
  for (const sx of [-1, 1]) {
    const a = saddle.clone().add(v3(sx * 0.012, -0.018, -0.12));
    const mid = postTop.clone().add(v3(sx * 0.02, 0.003, 0));
    const b = saddle.clone().add(v3(sx * 0.034, -0.02, 0.085));
    pipe(Mt, [a, a.clone().lerp(mid, 0.5).add(v3(0, -0.004, 0)), mid, b], 0.0034, 5, classic ? x.silver : x.dark);
  }
}

function buildCockpit(x: Ctx, out: FrameOut, fit: BikeFit): V {
  if (x.spec.bar === 'city') return cityCockpit(x, out, fit);
  const { H1, ax } = out;
  const { q, n, spec } = x;
  const { paint: P, metal: Mt, satin: St, matte: Ma } = x.f;
  const tape = rgb(spec.tape);
  const classic = spec.bar === 'classic';
  let clamp: V;
  if (classic) {
    // Schaftvorbau: senkrechter Schaft, waagrechter Ausleger, Klemme
    const quillTop = H1.clone().addScaledVector(ax.u, 0.08);
    tube(Mt, H1.clone().addScaledVector(ax.u, 0.03), quillTop, { w0: 0.022, n, col: () => x.silver });
    Mt.add(new THREE.SphereGeometry(0.0125, n, 8), M4(quillTop.x, quillTop.y, quillTop.z), x.silver);
    clamp = quillTop.clone().add(v3(0, -0.004, -0.1));
    tube(Mt, quillTop, clamp, { w0: 0.022, w1: 0.02, n, col: () => x.silver });
    Mt.add(new THREE.CylinderGeometry(0.0165, 0.0165, 0.042, n), M4(clamp.x, clamp.y, clamp.z, 0, 0, Math.PI / 2), x.silver);
  } else {
    const steerTop = H1.clone().addScaledVector(ax.u, spec.bar === 'tt' ? 0.036 : 0.046);
    const carbonStem = spec.bar === 'integrated' || spec.bar === 'tt';
    // Spacer und Lenkerschaft
    tube(carbonStem ? P : St, H1.clone().addScaledVector(ax.u, 0.022), steerTop, { w0: 0.034, d0: spec.bar === 'integrated' ? 0.048 : 0.034, kind: spec.bar === 'integrated' ? 'aero' : 'round', n, col: () => (spec.bar === 'integrated' ? x.pc(steerTop) : x.carbon) });
    clamp = steerTop.clone().add(v3(0, spec.bar === 'tt' ? -0.016 : -0.008, spec.bar === 'tt' ? -0.085 : -0.105));
    if (spec.bar === 'integrated') {
      tube(P, steerTop.clone().addScaledVector(ax.u, -0.004).add(v3(0, 0, 0.012)), clamp, { w0: 0.03, w1: 0.028, d0: 0.03, d1: 0.026, n, col: x.pc });
    } else {
      tube(St, steerTop.clone().add(v3(0, -0.004, 0.014)), clamp, { w0: 0.032, w1: 0.03, d0: 0.034, d1: 0.03, n, col: () => x.dark });
      St.add(new THREE.CylinderGeometry(0.0185, 0.0185, 0.05, n), M4(clamp.x, clamp.y, clamp.z, 0, 0, Math.PI / 2), x.dark);
    }
    // Abdeckkappe
    St.add(new THREE.CylinderGeometry(0.0172, 0.0172, 0.006, n), along(steerTop.clone().addScaledVector(ax.u, 0.003), ax.u), x.dark);
    // Radcomputer vorn am Lenker
    if (q && spec.bar !== 'tt' && spec.bar !== 'track') {
      const gp = clamp.clone().add(v3(0, 0.016, -0.06));
      strut(St, clamp.clone().add(v3(0, 0.004, -0.012)), gp.clone().add(v3(0, -0.006, 0.006)), 0.012, 0.008, x.dark);
      St.add(new THREE.BoxGeometry(0.048, 0.014, 0.074), M4(gp.x, gp.y, gp.z, 0.12), x.dark);
      Mt.add(new THREE.BoxGeometry(0.038, 0.002, 0.056), M4(gp.x, gp.y + 0.0071, gp.z + 0.002, 0.12), rgb('#2c3a44'));
    }
  }

  if (spec.bar === 'tt') {
    // Basislenker (Hörnchen) und Auflieger mit Armpolstern
    for (const sx of [-1, 1]) {
      const L = (dx: number, dy: number, dz: number) => clamp.clone().add(v3(sx * dx, dy, dz));
      pipe(Ma, [L(0, 0, 0), L(0.12, 0, 0), L(0.17, 0.002, -0.006), L(0.196, 0.008, -0.04), L(0.204, 0.02, -0.1), L(0.206, 0.03, -0.13)], 0.0125, n, tape);
      pipe(St, [L(0.206, 0.03, -0.13), L(0.206, 0.012, -0.15), L(0.204, -0.03, -0.14)], 0.005, 6, x.dark);
      const pad = L(0.085, 0.058, 0.075);
      strut(St, pad.clone().add(v3(0, -0.05, 0)), pad.clone().add(v3(0, -0.006, 0)), 0.014, 0.03, x.dark);
      St.add(new THREE.BoxGeometry(0.05, 0.012, 0.082), M4(pad.x, pad.y, pad.z), rgb('#2b2c31'));
      pipe(St, [L(0.07, 0.046, 0.04), L(0.058, 0.05, -0.08), L(0.048, 0.056, -0.2), L(0.044, 0.072, -0.25), L(0.044, 0.1, -0.272)], 0.011, n, x.dark);
    }
    fit.aero = { hand: clamp.clone().add(v3(0.046, 0.094, -0.232)), pad: clamp.clone().add(v3(0.085, 0.074, 0.075)) };
    fit.hood = clamp.clone().add(v3(0.205, 0.04, -0.12));
    fit.drop = fit.hood.clone();
    return clamp;
  }

  // Rennlenker: Oberlenker, Bogen nach vorn, Griffbereich, Unterlenker (als glatte Kurve)
  // Bahnlenker: tief und weit nach vorn, ohne Griffe; Gravel-Lenker: flach, unten nach außen gestellt
  const track = spec.bar === 'track';
  const flare = spec.bar === 'flare' ? 0.42 : 0;
  const reach = classic ? 0.1 : track ? 0.108 : flare ? 0.072 : 0.08;
  const drop = classic ? 0.142 : track ? 0.168 : flare ? 0.115 : 0.125;
  const half = classic ? 0.2 : track ? 0.19 : flare ? 0.212 : 0.205;
  const barM = spec.bar === 'modern' ? St : Mt;
  const steel = spec.frame === 'steel';
  const smoothPath = (ctrl: V[], k: number) => new THREE.CatmullRomCurve3(ctrl, false, 'centripetal').getSpacedPoints(k);
  for (const sx of [-1, 1]) {
    const L = (dx: number, dy: number, dz: number) => clamp.clone().add(v3(sx * (dx + (dy < 0 ? -dy * flare : 0)), dy, dz));
    const ctrl: V[] = [
      L(0.0, 0, 0), L(0.07, 0, 0), L(0.14, 0, -0.001), L(0.176, -0.001, -0.01), L(half - 0.006, -0.003, -0.032),
      L(half, -0.006, -reach * 0.6), L(half, -0.014, -reach * 0.92), L(half, -0.036, -reach * 1.08), L(half, -drop * 0.5, -reach * 1.06),
      L(half, -drop * 0.78, -reach * 0.86), L(half, -drop * 0.95, -reach * 0.5), L(half, -drop, -reach * 0.12), L(half, -drop - 0.002, 0.03), L(half, -drop - 0.003, 0.06),
    ];
    const pts = smoothPath(ctrl, q ? 46 : 9);
    // bis zum Bogen blank (oder Flügel), danach Lenkerband
    let k = pts.findIndex((p) => Math.abs(p.x - clamp.x) > (spec.bar === 'integrated' ? 0.17 : 0.15));
    if (k < 2) k = 2;
    if (spec.bar === 'integrated') {
      const wing = pts.slice(0, k + 1);
      sweep(P, wing, wing.map(() => ({ s: v3(0, 0, sx), c: v3(0, 1, 0) })), (i) => 0.046 - (i / Math.max(1, wing.length - 1)) * 0.018, () => 0.014, (i) => x.pc(wing[i]), shape('round', q ? 12 : 6));
    } else {
      pipe(barM, pts.slice(0, k + 1), classic ? 0.0128 : 0.0132, n, classic ? x.silver : x.dark);
    }
    pipe(Ma, pts.slice(k), classic ? 0.0133 : 0.0139, n, tape);
    if (track) {
      // Hände vorn im Bogen, beim Sprint ganz unten
      if (sx > 0) {
        fit.hood = L(half - 0.004, -0.05, -reach * 1.0);
        fit.drop = L(half - 0.004, -drop + 0.016, -reach * 0.42);
      }
      continue;
    }

    // Griffkörper: sitzt auf der Rampe, umschließt den Lenker und steigt vorn zum „Horn“ an
    const hoodC = steel ? rgb('#8d6c4b') : x.dark;
    const big = spec.frame === 'alu' ? 1.12 : 1;
    const hood = smoothPath(classic && steel
      ? [L(half, 0.004, -0.036), L(half, 0.01, -0.06), L(half, 0.016, -0.084), L(half, 0.021, -0.1), L(half, 0.02, -0.11)]
      : [L(half, 0.006, -0.03), L(half, 0.014, -0.052), L(half, 0.021, -0.076), L(half, 0.028 * big, -0.097), L(half, 0.032 * big, -0.108), L(half, 0.026 * big, -0.117)], q ? 10 : 3);
    const hn = hood.length - 1;
    const hw = (classic && steel ? 0.023 : 0.029) * big;
    const hh = (classic && steel ? 0.032 : 0.042) * big;
    sweep(Ma, hood, pathFrames(hood, X), (i) => hw * lerpArr([0.9, 1, 1.02, 0.95, 0.75, 0.42], i / hn), (i) => hh * lerpArr([0.78, 0.94, 1, 0.96, 0.7, 0.36], i / hn), () => hoodC, shape('round', q ? 12 : 5));
    // Bremshebel: vorn aus dem Griff, am Bogen entlang nach unten
    const blade = smoothPath([L(half, 0.008, -0.112), L(half, -0.03, -0.118), L(half, -0.075, -0.106), L(half, -drop * 0.84, -0.088)], q ? 9 : 2);
    if (steel) pipe(Mt, blade, 0.0046, q ? 6 : 4, x.silver);
    else sweep(St, blade, pathFrames(blade, X), () => 0.012, () => 0.008, () => x.dark, shape('round', q ? 8 : 4));
    if (sx > 0) {
      fit.hood = L(half - 0.004, 0.036, -0.074);
      fit.drop = L(half - 0.004, -drop + 0.016, -reach * 0.42);
    }

    // Züge
    if (q && classic) {
      const cream = rgb('#ece6d6');
      if (steel) {
        // aus dem Hebelkopf in weiten Bögen: rechts zur Vorderbremse, links zum Oberrohr
        const p0 = L(half, 0.026, -0.104);
        const ctl = sx > 0
          ? [p0, p0.clone().add(v3(-0.02, 0.06, 0.03)), L(0.07, 0.085, -0.03), out.cableFront.clone().add(v3(0.01, 0.12, -0.05)), out.cableFront.clone().add(v3(0, 0.035, -0.006)), out.cableFront]
          : [p0, p0.clone().add(v3(0.02, 0.065, 0.035)), L(0.08, 0.1, 0.06), out.cableTT.clone().add(v3(-0.01, 0.07, -0.07)), out.cableTT.clone().add(v3(0, 0.012, -0.012)), out.cableTT];
        pipe(Ma, smoothPath(ctl, 24), 0.0026, 5, cream);
      } else {
        // 90er: Schaltzüge als „Antennen“ seitlich aus den Griffen zum Unterrohr, Bremszüge unter dem Band
        const p0 = L(half - 0.014, 0.022, -0.068);
        const dt = out.cableDT.clone().setX(sx * Math.abs(out.cableDT.x));
        const ctl = [p0, L(half - 0.06, 0.03, -0.07), L(0.1, 0.0, -0.02), L(0.03, -0.07, 0.04), dt.clone().add(v3(0, 0.05, -0.03)), dt];
        pipe(Ma, smoothPath(ctl, 22), 0.0026, 5, x.dark);
        const b0 = L(0.045, -0.012, 0.004);
        const ctl2 = sx > 0
          ? [b0, L(0.04, -0.03, -0.04), out.cableFront.clone().add(v3(0.006, 0.08, -0.05)), out.cableFront.clone().add(v3(0, 0.03, -0.006)), out.cableFront]
          : [b0, L(0.04, -0.02, 0.05), out.cableTT.clone().add(v3(-0.008, 0.05, -0.06)), out.cableTT.clone().add(v3(0, 0.01, -0.012)), out.cableTT];
        pipe(Ma, smoothPath(ctl2, 18), 0.0026, 5, x.dark);
      }
    }
  }
  return clamp;
}

function buildDrive(x: Ctx, rear: V, seatDir: V): Set4 {
  const { q, spec } = x;
  const cr = set4(PAINT);
  const classic = classicParts(spec);
  const goldParts = spec.paint.metal === 'gold';
  const ringC = goldParts ? x.gold : classic ? x.silver : rgb('#2b2d32');
  const ringM = goldParts || classic ? cr.metal : cr.satin;
  const armC = classic ? x.silver : goldParts ? x.gold : x.carbon;
  const armM = classic || goldParts ? cr.metal : cr.paint;
  const o = v3(0, 0, 0);
  // Antrieb: zwei Blätter mit Umwerfer, ein Blatt (Zeitfahren, Gravel) oder starrer Gang (Bahn)
  const drive = spec.drive ?? (spec.frame === 'tt' ? 'single' : 'double');
  const hub = drive === 'hub';
  const guard = drive === 'guard';
  const rod = drive === 'rod';
  // starrer Gang und Nabe: ein Blatt, ein Ritzel, keine Schaltung; Stangenschaltung: Kette ohne Schaltwerk
  const fixed = drive === 'fixed' || hub || guard || rod;
  const double = drive === 'double';
  const cross = spec.frame === 'cross';
  // großes Blatt (Außenradius) und seine Zähne: Bahn 58, Straße 53, Cross 46, Gravel 40, Lastenrad 38
  const [ringR, teeth] = hub ? [0.083, 38] : guard ? [0.1, 44] : rod ? [0.104, 50] : fixed ? [0.118, 58] : cross ? [0.095, 46] : spec.frame === 'gravel' ? [0.085, 40] : [0.108, 53];
  const smallR = cross ? 0.075 : 0.08;
  // Kettenblätter (Zähne nur in der hohen Stufe) mit Spider; im Kettenkasten unsichtbar
  if (!hub) toothed(ringM, o, 0.056, ringR, ringR - 0.02, q ? teeth : 0, 0.004, ringC, 28);
  if (double) toothed(ringM, o, 0.048, smallR, smallR - 0.016, q ? (cross ? 36 : 39) : 0, 0.004, ringC, 24);
  const arms = classic ? 5 : 4;
  const armR = Math.min(0.092, ringR - 0.016);
  for (let k = 0; k < arms; k++) {
    const a = (k / arms) * Math.PI * 2 + 0.35;
    strut(armM, v3(0.06, 0, 0), v3(0.058, Math.sin(a) * armR, Math.cos(a) * armR), 0.006, 0.016, armC, X, 0.006, 0.011);
  }
  // Kurbelarme: rechts nach oben, links nach unten (Ruhelage), Pedalachsen
  for (const sx of [-1, 1]) {
    tube(armM, v3(sx * 0.074, 0, 0), v3(sx * 0.083, sx * 0.17, 0), { w0: 0.014, w1: 0.012, d0: 0.034, d1: 0.021, n: q ? 10 : 6, col: () => armC });
    cr.metal.add(new THREE.CylinderGeometry(0.0065, 0.0065, 0.05, 8), M4(sx * 0.105, sx * 0.17, 0, 0, 0, Math.PI / 2), x.silver);
    if (q) cr.satin.add(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 10), M4(sx * 0.08, 0, 0, 0, 0, Math.PI / 2), x.dark);
  }
  cr.metal.add(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8), M4(0, 0, 0, 0, 0, Math.PI / 2), x.silver);

  // Ritzel am Hinterrad (rund, steht): Kassette vom größten innen zum kleinsten außen, Bahn: ein Ritzel
  const Mt = x.f.metal;
  const gravel = spec.frame === 'gravel';
  const cogN = rod ? 4 : fixed ? 1 : spec.frame === 'steel' ? 6 : spec.frame === 'alu' ? 8 : spec.frame === 'tt' ? 7 : cross ? 10 : 12;
  const bigCog = gravel ? 0.07 : 0.056;
  const rc = hub ? 0.04 : guard ? 0.036 : rod ? 0.04 : fixed ? 0.031 : 0.032;
  const R = ringR - 0.002;
  if (hub) {
    // Kettenkasten: umschließt Blatt, Kette und Ritzel
    const ol: [number, number][] = [];
    const K = q ? 14 : 5;
    const rf = R + 0.024;
    const rr = rc + 0.03;
    for (let k = 0; k <= K; k++) { const a = Math.PI / 2 + (Math.PI * k) / K; ol.push([BB.z + Math.cos(a) * rf, BB.y + Math.sin(a) * rf]); }
    for (let k = 0; k <= K; k++) { const a = -Math.PI / 2 + (Math.PI * k) / K; ol.push([rear.z + Math.cos(a) * rr, rear.y + Math.sin(a) * rr]); }
    prism(x.f.satin, ol, 0.012, 0.005, rgb('#17181b'), x.f.satin, 0.052);
    return cr;
  }
  if (fixed && !rod) {
    toothed(Mt, rear, 0.054, rc + 0.003, 0.016, q ? 15 : 0, 0.003, x.silver, 24);
    if (q) toothed(x.f.satin, rear, 0.059, 0.022, 0.012, 0, 0.004, x.dark, 18);
  } else if (q) {
    for (let k = 0; k < cogN; k++) {
      const t = k / (cogN - 1);
      toothed(Mt, rear, 0.022 + 0.036 * t, bigCog - (bigCog - 0.025) * t, 0.014, 0, 0.0018, k % 2 ? rgb('#9aa1a8') : x.silver, 24);
    }
  } else {
    Mt.add(new THREE.CylinderGeometry(0.026, bigCog - 0.004, 0.036, 12), M4(rear.x + 0.04, rear.y, rear.z, 0, 0, -Math.PI / 2), x.silver);
  }
  // Kette: oben vom Blatt zum Ritzel, hinten um das Ritzel, (durch die Schaltröllchen,) unten zurück
  const cx = 0.054;
  const P2 = (cy: number, cz: number, r: number, a: number) => v3(cx, cy + Math.sin(a) * r, cz - Math.cos(a) * r);
  // Schaltröllchen; beim Gravel langer Käfig unter der großen Kassette
  const ju = gravel ? v3(cx, rear.y - 0.084, rear.z + 0.026) : v3(cx, rear.y - 0.062, rear.z + 0.012);
  const jl = gravel ? v3(cx, rear.y - 0.158, rear.z + 0.002) : v3(cx, rear.y - 0.12, rear.z - 0.006);
  const jr = 0.012;
  const chain: V[] = [];
  const st = q ? 12 : 3;
  for (let i = 0; i <= st; i++) chain.push(P2(BB.y, BB.z, R, Math.PI / 2 - (Math.PI * i) / st));
  if (!fixed) {
    chain.push(v3(cx, jl.y - jr, jl.z), v3(cx, jl.y - jr * 0.7, jl.z + jr * 0.7), v3(cx, jl.y, jl.z + jr));
    chain.push(v3(cx, ju.y - jr * 0.2, ju.z - jr), v3(cx, ju.y + jr * 0.7, ju.z - jr * 0.7));
  }
  for (let i = 0; i <= st; i++) chain.push(P2(rear.y, rear.z, rc, -Math.PI / 2 - (Math.PI * i) / st));
  chain.push(P2(BB.y, BB.z, R, Math.PI / 2));
  // gleichmäßig unterteilen (Kettenteilung ~12,7 mm), Glieder abwechselnd hell und dunkel
  const fine: V[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i];
    const b = chain[i + 1];
    const k = Math.max(1, Math.round(a.distanceTo(b) / (q ? 0.0127 : 0.12)));
    for (let j = 0; j < k; j++) fine.push(a.clone().lerp(b, j / k));
  }
  fine.push(chain[chain.length - 1]);
  const link = drive === 'fixed' ? [rgb('#c9a33c'), rgb('#e6d08a')] : [rgb('#3c3e43'), rgb('#9097a0')];
  pipe(Mt, fine, 0.0034, q ? 5 : 3, (i) => link[i % 2], X, false);
  if (fixed) return cr;
  // Schaltwerk: am Ausfallende, Parallelogramm, Käfig mit zwei Röllchen
  const shiny = spec.frame === 'steel' || spec.frame === 'alu';
  const rdC = shiny ? x.silver : x.dark;
  const rdM = shiny ? Mt : x.f.satin;
  const hanger = rear.clone().add(v3(0.068, -0.016, 0.006));
  const body = hanger.clone().add(v3(0.006, gravel ? -0.03 : -0.026, gravel ? 0.04 : 0.028));
  strut(rdM, hanger, body, 0.014, 0.022, rdC);
  strut(rdM, body, ju.clone().add(v3(0.02, 0.004, 0.006)), 0.012, 0.02, rdC);
  strut(rdM, ju.clone().add(v3(0.016, 0.014, 0.002)), jl.clone().add(v3(0.016, -0.014, -0.002)), 0.003, 0.03, rdC);
  for (const j of [ju, jl]) x.f.satin.add(new THREE.CylinderGeometry(jr, jr, 0.007, q ? 14 : 6), M4(j.x, j.y, j.z, 0, 0, Math.PI / 2), x.dark);
  // Umwerfer am Sitzrohr knapp über dem großen Blatt
  if (double) {
    const k = (ringR + 0.006) / 0.114;
    const band = BB.clone().addScaledVector(seatDir, 0.165 * k);
    tube(rdM, band.clone().addScaledVector(seatDir, -0.007), band.clone().addScaledVector(seatDir, 0.007), { w0: 0.038, n: x.n, col: () => rdC });
    const c0 = BB.clone().addScaledVector(seatDir, 0.118 * k).add(v3(0.064, 0, -0.012));
    const c1 = BB.clone().add(v3(0.064, 0.074 * k, 0.084 * k));
    strut(rdM, c0, c1, 0.003, 0.02, rdC);
    strut(rdM, band.clone().add(v3(0.018, -0.008, 0.01)), c0.clone().lerp(c1, 0.5).add(v3(0, 0.008, 0)), 0.008, 0.012, rdC);
  }
  return cr;
}

function buildBrakes(x: Ctx, out: FrameOut, front: V, rear: V, rF: number, rR: number, lowStays: boolean) {
  const { spec, q } = x;
  const { crown, ax, ssTop } = out;
  if (spec.brakes === 'none') return;
  if (spec.brakes === 'canti') {
    buildCanti(x, out, front, rear, rF, rR);
    return;
  }
  if (spec.brakes === 'disc') {
    // Bremssättel links (die Scheiben drehen mit den Laufrädern)
    const fc = front.clone().add(v3(-0.058, 0.03, 0.062));
    x.f.satin.add(new THREE.BoxGeometry(0.022, 0.05, 0.034), M4(fc.x, fc.y, fc.z, 0.5), x.dark);
    const rc = rear.clone().add(v3(-0.06, 0.022, -0.066));
    x.f.satin.add(new THREE.BoxGeometry(0.022, 0.03, 0.05), M4(rc.x, rc.y, rc.z, -0.3), x.dark);
    return;
  }
  // Seitenzugbremsen: Bügel um den Reifen zu den Felgenflanken
  const classic = classicParts(spec);
  const c = classic ? x.silver : x.dark;
  const m = classic ? x.f.metal : x.f.satin;
  const one = (pivot: V, axle: V, rRim: number) => {
    const dir = pivot.clone().sub(axle).normalize();
    const padR = rRim - 0.009;
    for (const sx of [-1, 1]) {
      const pad = axle.clone().addScaledVector(dir, padR).add(v3(sx * 0.0155, 0, 0));
      const arc = [pivot.clone(), pivot.clone().add(v3(sx * 0.026, -0.002, 0)).addScaledVector(dir, -0.006), pad.clone().add(v3(sx * 0.008, 0, 0)).addScaledVector(dir, 0.022), pad.clone().add(v3(sx * 0.005, 0, 0))];
      pipe(m, arc, 0.0045, q ? 6 : 4, c);
      x.f.matte.add(new THREE.BoxGeometry(0.007, 0.012, 0.04), along(pad, dir), x.dark);
    }
    m.add(new THREE.CylinderGeometry(0.008, 0.008, 0.032, 8), along(pivot, dir.clone().cross(X)), c);
  };
  one(crown.clone().addScaledVector(ax.n, -0.028).addScaledVector(ax.u, -0.004), front, rF);
  if (!lowStays) one(ssTop.clone().lerp(rear, 0.4).add(v3(0, -0.004, 0.012)), rear, rR);
}

/**
 * Cantilever (Crosser): Sockel an Gabel und Sitzstreben auf Felgenhöhe, weit ausgestellte Arme,
 * Querzug mit Joch über dem Reifen, Hauptzug vom Zughalter am Steuersatz bzw. über das Oberrohr.
 */
function buildCanti(x: Ctx, out: FrameOut, front: V, rear: V, rF: number, rR: number) {
  const { q } = x;
  const St = x.f.satin;
  const Mt = x.f.metal;
  const armC = rgb('#2a2c30');
  const cable = rgb('#d9dadc');
  const smooth = (ctrl: V[], k: number) => new THREE.CatmullRomCurve3(ctrl, false, 'centripetal').getSpacedPoints(k);
  /** axle: Achse, up: Richtung zur Strebe hinauf (yz), out: quer dazu vom Rahmen weg, legX: Strebe seitlich auf Sockelhöhe */
  const one = (axle: V, up: V, out2: V, legX: number, rRim: number): { yoke: V } => {
    const at = (r: number, o: number, sx: number, dx: number) => axle.clone().addScaledVector(up, r).addScaledVector(out2, o).add(v3(sx * dx, 0, 0));
    const tops: V[] = [];
    for (const sx of [-1, 1]) {
      const post = at(rRim + 0.004, 0, sx, legX);
      // Sockel quer aus der Strebe
      St.add(new THREE.CylinderGeometry(0.0045, 0.0045, 0.02, q ? 8 : 5), M4(post.x + sx * 0.006, post.y, post.z, 0, 0, Math.PI / 2), x.dark);
      // Arm schräg nach außen und oben
      const top = at(rRim + 0.03, 0.012, sx, legX + 0.036);
      strut(St, post.clone().add(v3(sx * 0.008, 0, 0)), top, 0.006, 0.013, armC, up, 0.005, 0.009);
      tops.push(top);
      // Bremsschuh nach innen an die Felgenflanke
      const pad = at(rRim - 0.008, 0, sx, 0.0155);
      strut(St, post.clone().add(v3(sx * 0.004, -0.0, 0)).addScaledVector(up, -0.004), pad.clone().add(v3(sx * 0.008, 0, 0)), 0.004, 0.008, armC, up);
      x.f.matte.add(new THREE.BoxGeometry(0.007, 0.012, 0.04), along(pad, up), x.dark);
    }
    // Querzug mit Joch
    const yoke = at(rRim + 0.064, 0.042, 1, 0);
    if (q) {
      pipe(Mt, [tops[0], yoke.clone().addScaledVector(up, -0.002), tops[1]], 0.0011, 4, cable);
      St.add(new THREE.BoxGeometry(0.012, 0.016, 0.006), along(yoke, up), x.dark);
    }
    return { yoke };
  };
  // vorn: entlang der Gabelscheide; quer dazu nach vorn
  const upF = out.crown.clone().sub(front).setX(0).normalize();
  const fwd = v3(0, upF.z, -upF.y);
  const f = one(front, upF, fwd, 0.049, rF);
  // hinten: entlang der Sitzstrebe; quer dazu nach hinten
  const toTop = out.ssTop.clone().sub(rear).setX(0);
  const upR = toTop.clone().normalize();
  const back = v3(0, -upR.z, upR.y);
  const fr = (rR + 0.004) / toTop.length();
  const r = one(rear, upR, back, 0.064 + (0.019 - 0.064) * fr, rR);
  if (!q) return;
  // Zughalter vorn am Steuersatz, Hauptzug hinunter zum Joch
  const hanger = out.H1.clone().addScaledVector(out.ax.u, 0.03).addScaledVector(out.ax.n, -0.034);
  strut(St, out.H1.clone().addScaledVector(out.ax.u, 0.03), hanger, 0.012, 0.004, x.dark, X);
  pipe(Mt, smooth([hanger, hanger.clone().lerp(f.yoke, 0.5).addScaledVector(fwd, 0.006), f.yoke], 10), 0.0012, 4, cable);
  // hinten: Zug oben auf dem Oberrohr, am Sattelrohr hinunter zum Joch
  const behind = out.S.clone().add(v3(0, -0.035, 0.04));
  const hangR = behind.clone().add(v3(0, -0.03, 0.012));
  pipe(Mt, [out.cableTT, out.cableTTEnd], 0.0013, 4, cable);
  pipe(x.f.matte, smooth([out.cableTTEnd, out.cableTTEnd.clone().add(v3(0, 0.012, 0.04)), behind, hangR], 14), 0.0025, 5, x.dark);
  pipe(Mt, smooth([hangR, hangR.clone().lerp(r.yoke, 0.5).addScaledVector(back, 0.004), r.yoke], 8), 0.0012, 4, cable);
  St.add(new THREE.BoxGeometry(0.012, 0.012, 0.02), M4(hangR.x, hangR.y, hangR.z), x.dark);
}

/**
 * Bikepacking: halbe Rahmentasche unter dem Oberrohr, Oberrohrtasche hinter dem Vorbau,
 * große Satteltasche und Lenkerrolle mit Riemen.
 */
function buildBags(x: Ctx, D: FrameDims, out: FrameOut, saddle: V, clamp: V, fit: BikeFit) {
  const { q } = x;
  const Ma = x.f.matte;
  const St = x.f.satin;
  const bag = rgb('#2d302c');
  const strap = rgb('#151617');
  const roll = rgb('#a8916a');
  const zy = (p: V): [number, number] => [p.z, p.y];
  // Rahmendreieck als Geraden (Punkt, Richtung) mit Abstand nach innen
  const ttA = out.S.clone().addScaledVector(D.seatDir, -0.018);
  const ttB = out.H1.clone().addScaledVector(out.ax.u, -0.02);
  const lines: { p: [number, number]; d: [number, number]; off: number }[] = [
    { p: zy(ttA), d: norm2([ttB.z - ttA.z, ttB.y - ttA.y]), off: D.tt[1] / 2 + 0.004 },
    { p: zy(out.H1), d: norm2([out.H0.z - out.H1.z, out.H0.y - out.H1.y]), off: D.ht[0] / 2 + 0.006 },
    { p: zy(out.dtB), d: norm2([out.dtA.z - out.dtB.z, out.dtA.y - out.dtB.y]), off: 0.104 },
    { p: zy(BB), d: norm2([out.S.z - BB.z, out.S.y - BB.y]), off: D.st[0] / 2 + 0.005 },
  ];
  // Mitte des Dreiecks: dorthin wird versetzt
  const mid: [number, number] = [(ttA.z + out.H0.z + BB.z) / 3, (ttA.y + out.H0.y + BB.y) / 3];
  const shifted = lines.map((l) => {
    let n: [number, number] = [-l.d[1], l.d[0]];
    if ((mid[0] - l.p[0]) * n[0] + (mid[1] - l.p[1]) * n[1] < 0) n = [-n[0], -n[1]];
    return { p: [l.p[0] + n[0] * l.off, l.p[1] + n[1] * l.off] as [number, number], d: l.d, n };
  });
  // halbe Tasche: höchstens 15 cm unter dem Oberrohr
  const tt = shifted[0];
  const bottom = { p: [tt.p[0] + tt.n[0] * 0.15, tt.p[1] + tt.n[1] * 0.15] as [number, number], d: tt.d, n: [-tt.n[0], -tt.n[1]] as [number, number] };
  // Umriss: Schnittpunkte der Geraden, dann an der Unterkante abschneiden
  let poly: [number, number][] = [];
  for (let i = 0; i < 4; i++) poly.push(cross2(shifted[i].p, shifted[i].d, shifted[(i + 1) % 4].p, shifted[(i + 1) % 4].d));
  const inside = (pt: [number, number]) => (pt[0] - bottom.p[0]) * bottom.n[0] + (pt[1] - bottom.p[1]) * bottom.n[1] >= 0;
  const clipped: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (inside(a)) clipped.push(a);
    if (inside(a) !== inside(b)) clipped.push(cross2(a, [b[0] - a[0], b[1] - a[1]], bottom.p, bottom.d));
  }
  poly = clipped;
  prism(Ma, poly, 0.026, 0.01, bag);
  if (q) {
    // Reißverschluss oben entlang
    const zt = poly.reduce((acc, p2) => (p2[1] > acc[1] ? p2 : acc), poly[0]);
    void zt;
    for (const sx of [-1, 1]) {
      const a = ttA.clone().lerp(ttB, 0.18).addScaledVector(v3(0, -1, 0), D.tt[1] / 2 + 0.02).setX(sx * 0.0262);
      const b = ttA.clone().lerp(ttB, 0.82).addScaledVector(v3(0, -1, 0), D.tt[1] / 2 + 0.02).setX(sx * 0.0262);
      pipe(St, [a, b], 0.0012, 4, rgb('#c56a2b'));
    }
    // Klettriemen ums Oberrohr
    for (const t of [0.25, 0.55, 0.85]) {
      const c = ttA.clone().lerp(ttB, t);
      tube(St, c.clone().addScaledVector(ttB.clone().sub(ttA).normalize(), -0.009), c.clone().addScaledVector(ttB.clone().sub(ttA).normalize(), 0.009), { w0: D.tt[0] + 0.005, n: 10, col: () => strap });
    }
  }
  // Oberrohrtasche hinter dem Vorbau
  const ttDir = ttB.clone().sub(ttA).normalize();
  const upN = v3(0, ttDir.z, -ttDir.y);
  if (upN.y < 0) upN.negate();
  const base0 = ttB.clone().addScaledVector(ttDir, -0.035).addScaledVector(upN, D.tt[1] / 2 + 0.002);
  const base1 = base0.clone().addScaledVector(ttDir, -0.15);
  const top1 = base1.clone().addScaledVector(upN, 0.05);
  const top0 = base0.clone().addScaledVector(upN, 0.062).addScaledVector(ttDir, -0.012);
  prism(Ma, [zy(base0), zy(top0), zy(top1), zy(base1)], 0.024, 0.008, bag);
  // Satteltasche: hängt an Gestell und Stütze, läuft nach hinten dick aus
  const sp = [v3(0, 0.872, saddle.z - 0.02), v3(0, 0.866, saddle.z + 0.06), v3(0, 0.872, saddle.z + 0.14), v3(0, 0.884, saddle.z + 0.21), v3(0, 0.898, saddle.z + 0.26), v3(0, 0.906, saddle.z + 0.285)];
  const half = [0.03, 0.05, 0.062, 0.064, 0.05, 0.026];
  const hgt = [0.034, 0.048, 0.056, 0.056, 0.044, 0.022];
  const strapAt = new Set(q ? [1, 3] : []);
  const pts: V[] = [];
  const wv: number[] = [];
  const hv: number[] = [];
  const cv: C3[] = [];
  const K = q ? 4 : 1;
  for (let i = 0; i < sp.length - 1; i++) {
    for (let k = 0; k < K; k++) {
      const t = k / K;
      pts.push(sp[i].clone().lerp(sp[i + 1], t));
      wv.push(half[i] + (half[i + 1] - half[i]) * t);
      hv.push(hgt[i] + (hgt[i + 1] - hgt[i]) * t);
      cv.push(strapAt.has(i) && k === 0 ? strap : bag);
    }
  }
  pts.push(sp[sp.length - 1]);
  wv.push(half[half.length - 1]);
  hv.push(hgt[hgt.length - 1]);
  cv.push(strap);
  sweep(Ma, pts, pathFrames(pts, v3(-1, 0, 0)), (i) => wv[i] * 2, (i) => hv[i] * 2, (i) => cv[i], shape('round', q ? 14 : 6));
  fit.lamp = sp[sp.length - 1].clone().add(v3(0, 0.002, 0.01));
  // Lenkerrolle vor dem Lenker, mit zwei Riemen
  const rc = clamp.clone().add(v3(0, -0.066, -0.056));
  const rr = 0.05;
  const L = 0.17;
  const prof: [number, number, C3][] = [[0.0005, -L - 0.012, roll], [rr * 0.55, -L - 0.01, roll], [rr * 0.85, -L, roll], [rr, -L + 0.03, roll]];
  if (q) for (const xs of [-0.09, 0.09]) prof.push([rr, xs - 0.012, roll], [rr * 1.04, xs - 0.011, strap], [rr * 1.04, xs + 0.011, strap], [rr, xs + 0.012, roll]);
  prof.push([rr, L - 0.03, roll], [rr * 0.85, L, roll], [rr * 0.55, L + 0.01, roll], [0.0005, L + 0.012, roll]);
  revolve(Ma, prof, q ? 20 : 8, rc, false);
}

function buildBottles(x: Ctx, out: FrameOut) {
  const { q, spec } = x;
  // Crosser und Bahnrad fahren ohne Flaschen
  if (spec.frame === 'cross' || spec.frame === 'track' || spec.frame === 'cargo' || spec.frame === 'post' || spec.frame === 'bonanza' || spec.frame === 'lowrider') return;
  if (spec.bits?.barBottles) return;
  const classic = spec.frame === 'steel';
  const bottleC = classic ? rgb('#c3c8ce') : rgb('#f1f2f4');
  const capC = classic ? rgb('#e8e1cf') : rgb('#18191c');
  const band = spec.paint.base === 'team' ? rgb(x.kit.side) : rgb(spec.paint.second ?? spec.paint.decal);
  const mk = (a: V, b: V, side: V, len: number) => {
    const axd = b.clone().sub(a).normalize();
    const c = a.clone().lerp(b, 0.5).addScaledVector(side, 0.06);
    const r = 0.034;
    const prof: [number, number, C3][] = [[0.0005, -len / 2, bottleC], [r * 0.82, -len / 2, bottleC], [r, -len / 2 + 0.012, bottleC], [r, len / 2 - 0.045, bottleC], [r * 0.94, len / 2 - 0.026, bottleC], [r * 0.62, len / 2 - 0.016, capC], [r * 0.46, len / 2, capC], [0.007, len / 2 + 0.012, capC], [0.0005, len / 2 + 0.014, capC]];
    revolve(classic ? x.f.metal : x.f.satin, prof, q ? 18 : 8, v3(0, 0, 0), false, new THREE.Matrix4().compose(c, new THREE.Quaternion().setFromUnitVectors(X, axd), v3(1, 1, 1)));
    if (q && !classic) x.f.paint.add(new THREE.CylinderGeometry(r * 1.012, r * 1.012, 0.06, 18, 1, true), along(c.clone().addScaledVector(axd, -0.025), axd), band);
    // Halter: zwei Seitenbügel am Flaschenbauch, unten ein Haken, zwei Füße zum Rohr
    const cageC = classic ? x.silver : x.dark;
    const at = (u: number, sx: number, out2 = 0) => c.clone().addScaledVector(axd, u).add(v3(sx * (r + 0.0016), 0, 0)).addScaledVector(side, -0.004 - out2);
    for (const sx of [-1, 1]) {
      pipe(x.f.metal, [at(-len / 2 + 0.012, sx), at(-len / 2 + 0.06, sx), at(len / 2 - 0.09, sx), at(len / 2 - 0.06, sx, 0.012)], 0.0021, 4, cageC);
    }
    const bot = c.clone().addScaledVector(axd, -len / 2 - 0.004);
    pipe(x.f.metal, [at(-len / 2 + 0.012, -1), bot.clone().add(v3(-r * 0.6, 0, 0)), bot.clone().add(v3(r * 0.6, 0, 0)), at(-len / 2 + 0.012, 1)], 0.0021, 4, cageC);
    for (const u of [-0.045, 0.045]) {
      const p1 = c.clone().addScaledVector(axd, u).addScaledVector(side, -r - 0.002);
      strut(x.f.metal, p1.clone().addScaledVector(side, -0.016), p1, 0.016, 0.006, cageC, X);
    }
  };
  const dtDir = out.dtB.clone().sub(out.dtA).normalize();
  const dtUp = new THREE.Vector3().crossVectors(X, dtDir).normalize();
  if (dtUp.y < 0) dtUp.negate();
  mk(out.dtA.clone().lerp(out.dtB, 0.26), out.dtA.clone().lerp(out.dtB, 0.66), dtUp, 0.21);
  if (spec.frame !== 'tt' && spec.frame !== 'steel' && !spec.bags) {
    const stDir = out.S.clone().sub(BB).normalize();
    const fwd = new THREE.Vector3().crossVectors(stDir, X).normalize();
    if (fwd.z > 0) fwd.negate();
    mk(BB.clone().addScaledVector(stDir, 0.2), BB.clone().addScaledVector(stDir, 0.44), fwd, 0.19);
  }
}

// ------------------------------------------------------------------ Laufräder

/** gekreuzt eingespeicht: Löcher je Flansch gleichmäßig, Speichen abwechselnd ziehend/schiebend */
function spokes(m: Mesher, N: number, cross: number, flL: number, flR: number, flangeR: number, rimR: number, col: C3, bladed: boolean) {
  const u = (Math.PI * 2) / N;
  for (const side of [-1, 1]) {
    const fx = side < 0 ? flL : flR;
    for (let j = 0; j < N / 2; j++) {
      const hub = 2 * j * u + (side > 0 ? u : 0);
      const rim = hub + (j % 2 ? -1 : 1) * cross * 2 * u;
      const a = v3(fx, Math.sin(hub) * flangeR * 0.88, Math.cos(hub) * flangeR * 0.88);
      const b = v3(side * 0.0025, Math.sin(rim) * rimR, Math.cos(rim) * rimR);
      if (bladed) strut(m, a, b, 0.0012, 0.0032, col, X);
      else strut(m, a, b, 0.0017, 0.0017, col, X);
    }
  }
}

interface WheelOut { geo: THREE.BufferGeometry; rimR: number; deep: number; width: number; spokes: THREE.BufferGeometry | null }

/** halber Reifenquerschnitt */
function tireR(spec: BikeSpec): number {
  if (spec.tire?.w) return spec.tire.w;
  const alu = spec.wheels === 'box36' || spec.wheels === 'box32';
  return alu ? (spec.id === 'pave' ? 0.0142 : 0.0115) : 0.0135;
}

/** Felgenradius, damit der Reifen (mit Stollen) genau den Boden berührt */
function rimFor(spec: BikeSpec, r: number): number {
  return r - tireR(spec) * 1.72 - (spec.tire?.knobs ?? 0) - 0.0005;
}

function buildWheel(x: Ctx, front: boolean, rRim: number, split = true): WheelOut {
  const { q, spec } = x;
  const W = set4(PAINT);
  const o = v3(0, 0, 0);
  const seg = q ? 64 : 18;
  const kind = spec.wheels;
  const tt = kind === 'tt';
  const alu = kind === 'box36' || kind === 'box32' || kind === 'spoke144';
  const four = kind === 'spoke4';
  const deep = kind === 'carbon45' ? 0.045 : kind === 'carbon30' ? 0.03 : kind === 'deep60' || tt || four ? 0.06 : 0.02;
  const width = alu ? (spec.tire?.w ? 0.024 : 0.021) : 0.027;
  const blackRim = spec.frame === 'alu' || spec.frame === 'cross' || spec.frame === 'gravel';
  const rimC = alu ? (blackRim ? rgb('#1d1e22') : x.silver) : x.carbon;
  const rimM = alu ? (blackRim ? W.satin : W.metal) : W.paint;
  const rIn = rRim - deep;
  const disc = tt && !front;
  let spokeGeo: THREE.BufferGeometry | null = null;
  if (!disc) {
    // Felge im Schnitt (auf der +x-Seite nach innen)
    const prof: [number, number, C3][] = alu
      ? [[rRim, width / 2, rimC], [rRim - 0.007, width / 2, rimC], [rIn + 0.004, width * 0.4, rimC], [rIn, 0, rimC], [rIn + 0.004, -width * 0.4, rimC], [rRim - 0.007, -width / 2, rimC], [rRim, -width / 2, rimC], [rRim - 0.004, 0, rimC]]
      : [[rRim, width * 0.42, rimC], [rRim - 0.008, width / 2, rimC], [rRim - deep * 0.55, width * 0.5, rimC], [rIn + 0.007, width * 0.34, rimC], [rIn, 0, rimC], [rIn + 0.007, -width * 0.34, rimC], [rRim - deep * 0.55, -width * 0.5, rimC], [rRim - 0.008, -width / 2, rimC], [rRim, -width * 0.42, rimC], [rRim - 0.004, 0, rimC]];
    revolve(rimM, prof, seg, o, true);
    if (alu && blackRim && q) {
      // blank gedrehte Bremsflanken
      revolve(W.metal, [[rRim - 0.001, width / 2 + 0.0004, x.silver], [rRim - 0.0075, width / 2 + 0.0004, x.silver]], seg, o, false);
      revolve(W.metal, [[rRim - 0.0075, -width / 2 - 0.0004, x.silver], [rRim - 0.001, -width / 2 - 0.0004, x.silver]], seg, o, false);
    }
  }
  // Reifen: runder Querschnitt; Lauffläche dunkel, Flanke hell beim „Tanwall“; Stollen und Schlamm je Segment
  const rt = tireR(spec);
  const knobs = q ? spec.tire?.knobs ?? 0 : 0;
  const tc = rRim + rt * 0.72;
  let wall = spec.tires === 'tan' ? rgb('#b98f5c') : rgb('#1c1d20');
  if (x.mud) wall = mix(wall, x.mudC, 0.72);
  const tp: [number, number, C3][] = [];
  const tn = q ? (knobs ? 20 : 14) : 5;
  const ang: number[] = [];
  for (let k = 0; k < tn; k++) {
    const a = (k / tn) * Math.PI * 2;
    ang.push(a);
    // Reflexstreifen: ein heller Ring auf der Flanke
    const reflex = spec.tire?.reflex && q && Math.abs(Math.cos(a) - 0.1) < 0.15;
    // Weißwand: heller Ring auf der Flanke, Wulst am Felgenrand dunkel
    const ca = Math.cos(a);
    const white = spec.tire?.white && ca <= 0.42 && ca > -0.6;
    tp.push([tc + ca * rt, Math.sin(a) * rt * 0.98, reflex ? rgb('#c9ccd0') : white ? rgb('#f2f0e8') : ca > 0.42 ? x.rubber : wall]);
  }
  let warp: Warp | undefined;
  const tseg = knobs ? 200 : seg;
  if (knobs || (x.mud && q)) {
    const coarse = knobs > 0.002;
    const mudC = x.mudC;
    warp = (j, k, [r, xx, c]) => {
      const a = ang[k];
      const ca = Math.cos(a);
      const sa = Math.abs(Math.sin(a));
      let h = 0;
      if (knobs && ca > 0.35) {
        const center = sa < 0.35;
        // Mitte und Schulter versetzt; Gravel: feine Mittelrippe, kräftigere Schulterstollen
        const on = coarse ? (center ? j % 4 < 2 : j % 4 >= 2) : center ? j % 2 === 0 : j % 4 === 1 || j % 4 === 2;
        if (on) h = center && !coarse ? knobs * 0.45 : knobs;
      }
      let col = c;
      if (x.mud) {
        const spray = hash3(j, k, 3);
        col = mix(c, mudC, ca > 0.42 ? 0.25 + 0.5 * spray : 0.55 + 0.35 * spray);
      }
      return [r + ca * h, xx + Math.sin(a) * h, col];
    };
  }
  revolve(W.matte, tp, tseg, o, true, undefined, warp);

  // Nabe
  const hubC = alu || spec.paint.metal === 'silver' ? x.silver : spec.paint.metal === 'gold' ? x.gold : rgb('#24262a');
  const flangeR = kind === 'spoke144' ? 0.04 : kind === 'box36' ? 0.03 : 0.023;
  const flL = -0.034;
  const flR = front ? 0.034 : 0.02;
  if (!disc) {
    const hub: [number, number, C3][] = [[0.008, -0.05, hubC], [0.012, -0.048, hubC], [0.012, flL - 0.003, hubC], [flangeR, flL - 0.002, hubC], [flangeR, flL + 0.002, hubC], [0.016, flL + 0.005, hubC], [0.014, 0, hubC], [0.016, flR - 0.005, hubC], [flangeR, flR - 0.002, hubC], [flangeR, flR + 0.002, hubC], [0.012, flR + 0.003, hubC], [0.012, 0.048, hubC], [0.008, 0.05, hubC]];
    revolve(alu || spec.paint.metal !== 'black' ? W.metal : W.satin, q ? hub : [hub[0], hub[3], hub[6], hub[9], hub[12]], q ? 18 : 6, o, false);
  }

  if (!front && (spec.drive === 'hub' || spec.drive === 'guard')) {
    // Nabenschaltung: dicker Nabenkörper
    revolve(W.metal, [[0.012, -0.03, x.silver], [0.036, -0.026, x.silver], [0.038, 0, x.silver], [0.036, 0.026, x.silver], [0.012, 0.03, x.silver]], q ? 18 : 8, o, false);
  }
  if (spec.frame === 'cargo') {
    // Rollenbremse links (gerippte Trommel)
    revolve(W.satin, [[0.014, -0.04, x.dark], [0.048, -0.042, x.dark], [0.05, -0.05, x.dark], [0.03, -0.056, x.dark], [0.014, -0.056, x.dark]], q ? 18 : 8, o, false);
  }
  if (disc) {
    // Scheibenrad: gewölbt, mit Farbring
    const dc = x.carbon;
    const ring = spec.paint.base === 'team' ? rgb(x.kit.side) : rgb(spec.paint.panel ?? spec.paint.second ?? spec.paint.decal);
    const dp: [number, number, C3][] = [[0.0005, -0.026, dc], [0.04, -0.025, dc], [0.12, -0.021, dc], [0.19, -0.0175, dc], [0.195, -0.0172, ring], [0.235, -0.0155, ring], [0.24, -0.0152, dc], [0.27, -0.013, dc], [rRim - 0.003, -width * 0.45, dc], [rRim, 0, dc], [rRim - 0.003, width * 0.45, dc], [0.27, 0.013, dc], [0.24, 0.0152, dc], [0.235, 0.0155, ring], [0.195, 0.0172, ring], [0.19, 0.0175, dc], [0.12, 0.021, dc], [0.04, 0.025, dc], [0.0005, 0.026, dc]];
    revolve(W.paint, dp, seg, o, false);
  } else if ((tt && front) || four) {
    // Drei- oder Vierspeichenrad: Profilspeichen aus Carbon mit Farbakzent
    const bc = x.carbon;
    revolve(W.paint, [[0.0005, -0.03, bc], [0.04, -0.03, bc], [0.04, 0.03, bc], [0.0005, 0.03, bc]], q ? 20 : 10, o, false);
    const acc = spec.paint.base === 'team' ? rgb(x.kit.side) : rgb(spec.paint.panel ?? (four ? spec.paint.second : undefined) ?? spec.paint.decal);
    const N = four ? 4 : 3;
    const sw = four ? [0.03, 0.017, 0.013] : [0.032, 0.019, 0.015];
    const sd = four ? [0.068, 0.048, 0.04] : [0.072, 0.05, 0.042];
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2 + (four ? 0.25 : 0.4);
      const dir = v3(0, Math.sin(a), Math.cos(a));
      const tan = v3(0, Math.cos(a), -Math.sin(a));
      const pts = [dir.clone().multiplyScalar(0.03), dir.clone().multiplyScalar(0.15), dir.clone().multiplyScalar(rIn + 0.006)];
      sweep(W.paint, pts, pts.map(() => ({ s: v3(-1, 0, 0), c: tan })), (i) => sw[i], (i) => sd[i], (i) => (i === 1 && q ? acc : bc), shape('aero', q ? 12 : 6));
    }
  } else {
    const N = q ? (kind === 'spoke144' ? 144 : kind === 'box36' ? 36 : kind === 'box32' ? 32 : front ? 20 : 24) : 8;
    const cross = alu ? 3 : front ? 0 : 2;
    // Speichen als eigenes Teil: im Tempo werden sie unscharf (statt zu flimmern)
    const S = split ? set4(PAINT) : W;
    spokes(S.metal, N, q ? cross : 0, flL, flR, flangeR, rIn + 0.003, alu ? x.silver : rgb('#1d1e21'), !alu);
    if (split) spokeGeo = merge([S.metal]);
  }
  // Bremsscheibe links (dreht mit)
  if (spec.brakes === 'disc') {
    toothed(W.metal, o, -0.052, front ? 0.08 : 0.07, front ? 0.062 : 0.054, 0, 0.0018, rgb('#b9bfc6'), q ? 44 : 14);
    for (let k = 0; k < (q ? 6 : 3); k++) {
      const a = (k / 6) * Math.PI * 2;
      const r = front ? 0.064 : 0.056;
      strut(W.satin, v3(-0.05, Math.sin(a) * 0.018, Math.cos(a) * 0.018), v3(-0.052, Math.sin(a + 0.28) * r, Math.cos(a + 0.28) * r), 0.003, 0.009, x.dark);
    }
  }
  return { geo: merge([W.paint, W.metal, W.satin, W.matte])!, rimR: rRim, deep, width, spokes: spokeGeo };
}

// ------------------------------------------------------------------ Schriftzüge (erfunden)

const decalCache = new Map<string, THREE.MeshPhongMaterial>();
function decalMat(spec: BikeSpec, color: string): THREE.MeshPhongMaterial {
  const key = `${spec.id}|${color}`;
  const hit = decalCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 64;
  const c = cv.getContext('2d')!;
  c.fillStyle = color;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const serif = spec.frame === 'steel' || spec.frame === 'post' || spec.frame === 'bamboo' || spec.frame === 'lowrider';
  const weight = spec.frame === 'steel' || spec.frame === 'lowrider' ? 'italic 700' : serif ? '700' : spec.frame === 'alu' || spec.frame === 'tt' ? '900' : 'italic 800';
  const font = (s: number) => `${weight} ${s}px ${serif ? 'Georgia, "Times New Roman", serif' : '"Helvetica Neue", Arial, sans-serif'}`;
  let size = 50;
  c.font = font(size);
  while (c.measureText(spec.wordmark).width > 480 && size > 18) { size -= 2; c.font = font(size); }
  c.fillText(spec.wordmark, 256, 35);
  // über die Bilddaten (ruhige Randfarbe statt Rauschen auf manchen Handys)
  const tex = alphaTex(cv);
  tex.anisotropy = 4;
  // löst sich in der Ferne auf (wie alle kleinen Teile des Fahrers)
  const m = new PhongFarMaterial({ map: tex, transparent: true, alphaTest: 0.3, shininess: 60, specular: new THREE.Color(0x2a2a2a), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  decalCache.set(key, m);
  return m;
}

/** Winkel im Querschnitt, bei dem die Tiefe (c·d/2) den Wert y erreicht (Seite rechts, Winkel −π/2…π/2) */
function angleForDepth(kind: Kind, d: number, y: number): number {
  let lo = -Math.PI / 2;
  let hi = Math.PI / 2;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if ((shapeAt(kind, m)[1] * d) / 2 < y) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

/** Schriftzug auf beiden Seiten des Unterrohrs, um das Rohr gelegt (gleichmäßig in der Höhe) */
function downTubeDecal(D: FrameDims, out: FrameOut): THREE.BufferGeometry {
  const a = out.dtA;
  const b = out.dtB;
  const len = a.distanceTo(b);
  const f = out.dtFrame;
  const wMin = Math.min(out.dtW[0], out.dtW[1]);
  const h = Math.min(0.034, wMin * 0.75);
  const L = Math.min(len * 0.6, h * 7.4);
  const t0 = 0.55 - L / len / 2;
  const t1 = 0.55 + L / len / 2;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const nu = 8;
  const nv = 5;
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= nu; i++) {
      const t = t0 + ((t1 - t0) * i) / nu;
      const p = a.clone().lerp(b, t);
      const w = out.dtW[0] + (out.dtW[1] - out.dtW[0]) * t;
      const d = out.dtD[0] + (out.dtD[1] - out.dtD[0]) * t;
      const yc = (shapeAt(D.kind, 0)[1] * d) / 2;
      for (let j = 0; j <= nv; j++) {
        // gleichmäßig in der Tiefe: rechts um Winkel 0, links gespiegelt um π; oben = +c (zum Oberrohr)
        const k = angleForDepth(D.kind, d, yc - h / 2 + (h * j) / nv);
        const [s, c] = shapeAt(D.kind, side > 0 ? k : Math.PI - k);
        const q = p.clone().addScaledVector(f.s, ((s * w) / 2) * 1.03).addScaledVector(f.c, ((c * d) / 2) * 1.03);
        pos.push(q.x, q.y, q.z);
        uv.push(side > 0 ? i / nu : 1 - i / nu, j / nv);
      }
    }
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const p0 = base + i * (nv + 1) + j;
        const p1 = p0 + nv + 1;
        if (side > 0) idx.push(p0, p1, p0 + 1, p0 + 1, p1, p1 + 1);
        else idx.push(p0, p0 + 1, p1, p0 + 1, p1 + 1, p1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Schriftzug zweimal je Felgenseite (dreht mit dem Rad) */
function rimDecal(w: WheelOut): THREE.BufferGeometry | null {
  if (w.deep < 0.029) return null;
  const r1 = w.rimR - 0.0085;
  const r0 = w.rimR - w.deep * 0.56;
  const h = r1 - r0;
  const rm = (r0 + r1) / 2;
  const span = (h * 7.2) / rm;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const nu = 16;
  for (const side of [1, -1]) {
    for (const ac of [Math.PI / 2, -Math.PI / 2]) {
      const base = pos.length / 3;
      for (let i = 0; i <= nu; i++) {
        const a = ac - span / 2 + (span * i) / nu;
        for (const [r, vv] of [[r0, 0], [r1, 1]] as [number, number][]) {
          pos.push(side * (w.width / 2 + 0.0007), Math.sin(a) * r, Math.cos(a) * r);
          uv.push(side > 0 ? i / nu : 1 - i / nu, vv);
        }
      }
      for (let i = 0; i < nu; i++) {
        const p0 = base + i * 2;
        if (side > 0) idx.push(p0, p0 + 2, p0 + 1, p0 + 1, p0 + 2, p0 + 3);
        else idx.push(p0, p0 + 1, p0 + 2, p0 + 1, p0 + 3, p0 + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** gut lesbare Schriftfarbe auf dem Teamlack */
function teamDecal(kit: Kit): string {
  const L = (hex: string) => { const [r, g, b] = rgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const lj = L(kit.jersey);
  if (Math.abs(lj - L(kit.side)) > 0.3) return kit.side;
  return lj > 0.45 ? '#16171a' : '#ffffff';
}

// ------------------------------------------------------------------ Zusammenbau

export interface BikeBuild {
  frame: THREE.BufferGeometry;
  wheelF: THREE.BufferGeometry;
  wheelR: THREE.BufferGeometry;
  /** Drahtspeichen je Rad (sonst null) und der Innenradius der Felge (für die Unschärfe-Scheibe) */
  spokes: { f: THREE.BufferGeometry | null; r: THREE.BufferGeometry | null; rF: number; rR: number };
  /** dreht um das Tretlager (Ursprung = Tretlager) */
  crank: THREE.BufferGeometry;
  /** nur in der hohen Stufe */
  decal: { frame: THREE.BufferGeometry; rimF: THREE.BufferGeometry | null; rimR: THREE.BufferGeometry | null; mat: THREE.Material; rimMat: THREE.Material } | null;
  fit: BikeFit;
  spec: BikeSpec;
  /** Anhänger: Kasten, ein Rad (zweimal gesetzt), Kennzeichen; Ursprung in der Kupplung */
  trailer: {
    body: THREE.BufferGeometry;
    wheel: THREE.BufferGeometry;
    plate: { geo: THREE.BufferGeometry; mat: THREE.Material } | null;
    /** Kupplung in Radkoordinaten */
    hitch: V;
    /** Radmitten (Anhängerkoordinaten) */
    wheels: V[];
    wheelR: number;
    /** Abstand Kupplung → Achse */
    axle: number;
    /** Achse seitlich zur Kupplung */
    axleX: number;
  } | null;
}

const buildCache = new Map<string, BikeBuild>();

/** Räder in voller Detailstufe aus dem Speicher werfen (außer keep) – nach der Garage */
export function releaseBikes(keep?: string) {
  for (const [k, b] of buildCache) {
    if (!k.endsWith('|1') || (keep && k.startsWith(`${keep}|`))) continue;
    for (const g of [b.frame, b.wheelF, b.wheelR, b.spokes.f, b.spokes.r, b.crank, b.decal?.frame, b.decal?.rimF, b.decal?.rimR, b.trailer?.body, b.trailer?.wheel, b.trailer?.plate?.geo]) g?.dispose();
    buildCache.delete(k);
  }
}

/** Rad bauen (je Modell, Farbe und Stufe nur einmal) */
export function bikeBuild(id: string | undefined, kit: Kit, q: 0 | 1): BikeBuild {
  const spec = bikeById(id);
  const team = spec.paint.base === 'team';
  const cargo = spec.frame === 'cargo';
  // Teamrad im Trikot lackiert; der Hund im Lastenrad trägt die Teammütze
  const key = `${spec.id}|${team || cargo ? `${kit.jersey}|${kit.side}` : ''}|${q}`;
  const hit = buildCache.get(key);
  if (hit) return hit;
  const x = makeCtx(spec, kit, q);
  if (spec.frame === 'ordinary') {
    // Hochrad: eigener Bau (keine Kette, Kurbel an der Vorderradnabe)
    const o = buildOrdinary(x);
    const ord: BikeBuild = { frame: merge([x.f.paint, x.f.metal, x.f.satin, x.f.matte])!, wheelF: o.wheelF, wheelR: o.wheelR, spokes: { f: null, r: null, rF: 0, rR: 0 }, crank: o.crank, decal: null, fit: o.fit, spec, trailer: null };
    buildCache.set(key, ord);
    return ord;
  }
  const D = dims(spec.frame);
  // Cruiser: kleine Laufräder, eigener Rahmen (Bonanzarad, Lowrider)
  const CG = spec.frame === 'bonanza' || spec.frame === 'lowrider' ? CRUISER[spec.frame] : null;
  const front = CG ? CG.F.clone() : cargo ? v3(0, D.rF, -1.56) : v3(0, D.rF, -0.56);
  const rear = CG ? CG.R.clone() : v3(0, 0.335, 0.43);
  const rFo = CG ? CG.rF : D.rF;
  const rRo = CG ? CG.rR : 0.335;
  const tt = spec.frame === 'tt';
  const saddle = tt ? v3(0, 0.95, 0.17) : v3(0, 0.957, 0.215);
  const fit: BikeFit = { front, rear, hood: v3(0.2, 0.92, -0.56), drop: v3(0.2, 0.8, -0.52), aero: null, pelvis: tt ? v3(0, 1.0, 0.13) : v3(0, 1.01, 0.2), lamp: v3(0, 0.86, 0.22) };
  let cro: CruiserOut | null = null;
  const out = cargo ? buildCargoFrame(x, D, front, rear) : CG ? (cro = buildCruiser(x, fit)).out : buildFrame(x, D, front, rear);
  if (cargo) fit.spinF = 0.335 / D.rF;
  if (CG) {
    fit.spinF = 0.335 / CG.rF;
    fit.spinR = 0.335 / CG.rR;
  } else {
    buildSeat(x, out.S, D.seatDir, saddle);
    fit.lamp = out.S.clone().addScaledVector(D.seatDir, (0.865 - out.S.y) / D.seatDir.y).add(v3(0, 0, 0.026));
  }
  const clamp = cro ? (cro as CruiserOut).clamp : buildCockpit(x, out, fit);
  // Hollandlenker: aufrecht sitzen
  if (spec.bar === 'city') fit.upright = 1.22;
  const crank = buildDrive(x, rear, D.seatDir);
  const wf = buildWheel(x, true, rimFor(spec, rFo));
  const wr = buildWheel(x, false, rimFor(spec, rRo));
  buildBrakes(x, out, front, rear, wf.rimR, wr.rimR, !!D.ssLow);
  if (q) buildBottles(x, out);
  if (spec.bits?.barBottles) barBottles(x, clamp);
  if (spec.bits?.spare) fit.lamp = spareTubular(x, saddle);
  if (spec.drive === 'rod') rodShifter(x, out, rear);
  if (spec.bags) buildBags(x, D, out, saddle, clamp, fit);
  if (spec.fenders) {
    const outer = (r: number) => r + tireR(spec) * 1.72;
    const fe = buildFenders(x, front, rear, outer(wf.rimR), outer(wr.rimR));
    // Lastenrad: Rücklicht hinten auf dem Schutzblech
    if (cargo) fit.lamp = fe.rearAt((32 * Math.PI) / 180, 0).add(v3(0, 0.026, 0.012));
  }
  if (spec.frame === 'post') buildPostKit(x, out, front, rear, fit);
  let boxDecal: THREE.BufferGeometry | null = null;
  if (cargo) boxDecal = buildCargoBox(x.f, q, rgb(kit.jersey), rgb(kit.side));
  // Achsen; Schnellspanner, beim Bahn- und Lastenrad Achsmuttern (stehen still)
  const nuts = spec.brakes === 'none';
  for (const p of [front, rear]) {
    x.f.metal.add(new THREE.CylinderGeometry(0.005, 0.005, 0.134, 6), M4(p.x, p.y, p.z, 0, 0, Math.PI / 2), x.silver);
    if (spec.bits?.wingnuts) {
      for (const sx of [-1, 1]) wingnut(x, p, sx);
    } else if (q && nuts) {
      for (const sx of [-1, 1]) x.f.metal.add(new THREE.CylinderGeometry(0.009, 0.009, 0.009, 6), M4(p.x + sx * 0.066, p.y, p.z, 0, 0, Math.PI / 2), x.silver);
    } else if (q) {
      const lever = spec.brakes === 'rim' ? x.silver : x.dark;
      x.f.metal.add(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 10), M4(p.x - 0.068, p.y, p.z, 0, 0, Math.PI / 2), lever);
      strut(x.f.metal, v3(-0.07, p.y, p.z), v3(-0.072, p.y + 0.014, p.z + 0.05), 0.004, 0.01, lever, X, 0.004, 0.007);
    }
  }
  // Anhänger: Wohnwagen mit eigenen Rädern; am Rad nur der Kupplungsarm an der Achse
  let trailer: BikeBuild['trailer'] = null;
  if (spec.trailer === 'caravan') {
    const C = CARAVAN;
    const cb = buildCaravan(q, x.pc(v3(0, 0.6, 0)));
    const tw = buildWheel(x, true, rimFor(spec, C.wheelR), false);
    const wy = C.wheelR - C.hitch.y;
    trailer = {
      body: cb.geo, wheel: tw.geo, plate: cb.plate, hitch: C.hitch.clone(),
      wheels: [v3(C.xc - C.wheelX, wy, C.axleZ), v3(C.xc + C.wheelX, wy, C.axleZ)],
      wheelR: C.wheelR, axle: C.axleZ, axleX: C.xc,
    };
    x.f.satin.add(new THREE.BoxGeometry(0.03, 0.03, 0.05), M4(C.hitch.x + 0.012, C.hitch.y, C.hitch.z), x.dark);
  }
  if (x.mud) applyMud(x.f.paint, x.mudC);
  const build: BikeBuild = {
    frame: merge([x.f.paint, x.f.metal, x.f.satin, x.f.matte])!,
    wheelF: wf.geo,
    wheelR: wr.geo,
    spokes: { f: wf.spokes, r: wr.spokes, rF: wf.rimR - wf.deep, rR: wr.rimR - wr.deep },
    crank: merge([crank.paint, crank.metal, crank.satin, crank.matte])!,
    decal: q ? {
      frame: boxDecal ?? (cro ? (cro as CruiserOut).decal : downTubeDecal(D, out)),
      rimF: tt ? null : rimDecal(wf),
      rimR: tt ? null : rimDecal(wr),
      mat: decalMat(spec, team ? teamDecal(kit) : spec.paint.decal),
      rimMat: decalMat(spec, spec.paint.metal === 'gold' ? '#d9b25a' : '#e9ecef'),
    } : null,
    fit,
    spec,
    trailer,
  };
  if (!q) boxDecal?.dispose();
  buildCache.set(key, build);
  return build;
}
