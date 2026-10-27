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
import { CHROME, MATTE, Mesher, PAINT, SATIN, merge, rgb, type C3 } from './gloss';
import { M4, X, Z, along, lerpArr, pathFrames, pipe, revolve, shape, shapeAt, strut, sweep, toothed, tube, type Frame3, type Kind, type Warp } from './prim3d';

type V = THREE.Vector3;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const mix = (a: C3, b: C3, t: number): C3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ------------------------------------------------------------------ Maße

/** Woran sich der Fahrer orientiert */
export interface BikeFit {
  front: V;
  rear: V;
  /** rechte Hand: auf dem Griff, im Unterlenker */
  hood: V;
  drop: V;
  /** Zeitfahrhaltung: Hand am Aufliegerende, Ellbogen auf dem Polster */
  aero: { hand: V; pad: V } | null;
  /** Becken über dem Sattel */
  pelvis: V;
  /** Rücklicht an der Sattelstütze */
  lamp: V;
}

/** Tretlager (wie beim Fahrer) */
export const BIKE_BB = v3(0, 0.3, 0.02);
const BB = BIKE_BB;

interface FrameDims {
  rF: number; htBot: number; htTop: number; seatLen: number; seatDir: V;
  /** Rohre: [Breite Anfang, Tiefe Anfang, Breite Ende, Tiefe Ende] */
  tt: [number, number, number, number]; dt: [number, number, number, number]; st: [number, number, number, number];
  ht: [number, number]; cs: [number, number]; ss: [number, number]; fork: [number, number];
  kind: Kind; ssLow: number; forkCurve: boolean; lugs: boolean; welds: boolean; flare: number;
}

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
    case 'tt': return { ...base, rF: 0.305, htBot: 0.6, htTop: 0.72, seatLen: 0.52, seatDir: v3(0, 0.97, 0.243).normalize(), tt: [0.026, 0.04, 0.024, 0.036], dt: [0.032, 0.062, 0.03, 0.056], st: [0.028, 0.052, 0.026, 0.048], ht: [0.036, 0.03], cs: [0.022, 0.013], ss: [0.016, 0.012], fork: [0.022, 0.016], kind: 'aero', flare: 1.1 };
    default: return base;
  }
}

/** Lenkachse (73°, 45 mm Gabelversatz): Punkt auf der Achse in Höhe y */
function headAxis(front: V) {
  const ang = (73 * Math.PI) / 180;
  const u = v3(0, Math.sin(ang), Math.cos(ang));
  const n = v3(0, -u.z, u.y);
  const p = front.clone().addScaledVector(n, 0.045);
  return { u, n, at: (y: number) => p.clone().addScaledVector(u, (y - p.y) / u.y) };
}
type Axis = ReturnType<typeof headAxis>;

// ------------------------------------------------------------------ Bauteile

interface Set4 { paint: Mesher; metal: Mesher; satin: Mesher; matte: Mesher }

interface Ctx {
  q: 0 | 1;
  spec: BikeSpec;
  kit: Kit;
  /** Rahmen und alles, was steht */
  f: Set4;
  /** Lackfarbe an einem Punkt (Verläufe) */
  pc: (p: V) => C3;
  silver: C3; dark: C3; carbon: C3; rubber: C3; gold: C3;
  n: number;
  /** Ringe je geradem Rohr (mehr, wenn Schlamm auf dem Lack verläuft) */
  rings: number;
  /** Schlamm: Anteil an einem Punkt (0 sauber … 1 voll), sonst null */
  mud: ((p: V) => number) | null;
  mudC: C3;
}

/** Schlammfarbe */
const MUD = '#7d6a55';
/** feste Pseudo-Zufallszahl 0–1 für einen Punkt (Spritzer) */
const hash3 = (x: number, y: number, z: number) => {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
};
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

function set4(paintGloss: number): Set4 {
  return { paint: new Mesher(paintGloss), metal: new Mesher(CHROME), satin: new Mesher(SATIN), matte: new Mesher(MATTE) };
}

const finishGloss = (f: BikeSpec['paint']['finish']) => (f === 'satin' ? 0.3 : f === 'brushed' ? 0.72 : f === 'chrome' ? 0.93 : PAINT);

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

const classicParts = (s: BikeSpec) => s.frame === 'steel' || s.frame === 'alu';

interface FrameOut {
  H0: V; H1: V; S: V; ax: Axis; crown: V; ssTop: V; dtA: V; dtB: V; dtFrame: Frame3; dtW: [number, number]; dtD: [number, number];
  /** Zugwege: oben in die Vorderbremse, Anschlag vorn auf dem Oberrohr, Anschläge am Unterrohr (rechts) */
  cableFront: V; cableTT: V; cableDT: V;
  /** hinteres Ende des Zugs oben auf dem Oberrohr */
  cableTTEnd: V;
}

function buildFrame(x: Ctx, D: FrameDims, front: V, rear: V): FrameOut {
  const { q, n, pc, spec, rings } = x;
  const { paint: P, metal: Mt, satin: St } = x.f;
  const ax = headAxis(front);
  const H0 = ax.at(D.htBot);
  const H1 = ax.at(D.htTop);
  const S = BB.clone().addScaledVector(D.seatDir, D.seatLen);
  const panel = spec.paint.panel ? rgb(spec.paint.panel) : null;
  const steel = spec.frame === 'steel';
  const n2 = D.kind === 'aero' ? Math.max(n, 12) : n;
  const fl = q ? D.flare : 1;

  // Steuerrohr (beim Stahlrad im Paneel-Ton)
  const htCol = (p: V) => (panel && steel ? panel : pc(p));
  if (D.kind === 'aero') tube(P, H0.clone().addScaledVector(ax.u, -0.012), H1.clone().addScaledVector(ax.u, 0.012), { w0: D.ht[1], d0: D.ht[0] * 1.55, kind: 'aero', n: n2, rings, col: htCol });
  else tube(P, H0.clone().addScaledVector(ax.u, -0.01), H1.clone().addScaledVector(ax.u, 0.01), { w0: D.ht[0], w1: D.ht[1], n, rings, col: htCol });

  // Oberrohr, Unterrohr, Sitzrohr – an den Knoten ausgestellt wie geformtes Carbon
  const ttA = S.clone().addScaledVector(D.seatDir, -0.018);
  const ttB = H1.clone().addScaledVector(ax.u, -0.02);
  tube(P, ttA, ttB, { w0: D.tt[0], d0: D.tt[1], w1: D.tt[2], d1: D.tt[3], kind: D.kind, n: n2, rings, flare: fl > 1 ? [fl * 0.97, 0.12, fl, 0.14] : undefined, col: pc });
  const dtA = BB.clone().add(v3(0, 0.008, -0.012));
  const dtB = H0.clone().addScaledVector(ax.u, 0.022);
  const dtFrame = tube(P, dtA, dtB, { w0: D.dt[0], d0: D.dt[1], w1: D.dt[2], d1: D.dt[3], kind: D.kind, n: n2, rings, flare: fl > 1 ? [fl * 1.06, 0.12, fl * 1.04, 0.13] : undefined, col: pc });
  tube(P, BB.clone(), S, { w0: D.st[0], d0: D.st[1], w1: D.st[2], d1: D.st[3], kind: D.kind, n: n2, rings, flare: fl > 1 ? [fl, 0.1, 1.04, 0.06] : undefined, col: pc });
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
  P.add(new THREE.CylinderGeometry(0.023, 0.023, 0.072, n2), M4(BB.x, BB.y, BB.z, 0, 0, Math.PI / 2), pc(BB));

  // Hinterbau: Kettenstreben, Sitzstreben (beim Aero tief angesetzt), Ausfallenden
  const ssTop = D.ssLow ? BB.clone().addScaledVector(D.seatDir, (D.ssLow - BB.y) / D.seatDir.y) : S.clone().addScaledVector(D.seatDir, -0.035);
  for (const sx of [-1, 1]) {
    const dro = rear.clone().add(v3(sx * 0.064, 0, -0.004));
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
  if (D.lugs) {
    // Stahl: verchromte Muffen mit goldenem Rand, Steuersatz, Sattelmuffe
    const sleeve = (a: V, dir: V, r: number, len = 0.032) => {
      const b = a.clone().addScaledVector(dir, len);
      tube(Mt, a, b, { w0: r * 2.34, w1: r * 2.12, n, col: () => x.silver });
      if (q) tube(P, b.clone().addScaledVector(dir, -0.002), b.clone().addScaledVector(dir, 0.002), { w0: r * 2.2, n, col: () => x.gold });
    };
    sleeve(ttB.clone().addScaledVector(ttDir, 0.006), ttDir.clone().negate(), D.tt[0] / 2);
    sleeve(ttA.clone().addScaledVector(ttDir, -0.004), ttDir, D.tt[0] / 2);
    sleeve(dtB.clone().addScaledVector(dtDir, 0.004), dtDir.clone().negate(), D.dt[0] / 2);
    sleeve(BB.clone().addScaledVector(dtDir, 0.024), dtDir, D.dt[0] / 2, 0.022);
    sleeve(BB.clone().addScaledVector(D.seatDir, 0.024), D.seatDir, D.st[0] / 2, 0.022);
    sleeve(S.clone().addScaledVector(D.seatDir, -0.07), D.seatDir, D.st[0] / 2, 0.07);
    tube(Mt, H0.clone().addScaledVector(ax.u, -0.032), H0.clone().addScaledVector(ax.u, 0.024), { w0: D.ht[0] * 1.22, n, col: () => x.silver });
    tube(Mt, H1.clone().addScaledVector(ax.u, -0.03), H1.clone().addScaledVector(ax.u, 0.034), { w0: D.ht[0] * 1.22, n, col: () => x.silver });
    if (q) {
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
    const fc = (p: V) => (spec.frame === 'ti' ? x.carbon : pc(p));
    const fm = spec.frame === 'ti' ? x.f.satin : P;
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

function buildSeat(x: Ctx, S: V, seatDir: V, saddle: V) {
  const { q, n, spec } = x;
  const { metal: Mt, satin: St, matte: Ma } = x.f;
  const aero = spec.frame === 'aero' || spec.frame === 'tt';
  const classic = classicParts(spec);
  // Sattelstütze in Verlängerung des Sitzrohrs
  const postTop = S.clone().addScaledVector(seatDir, (saddle.y - 0.036 - S.y) / seatDir.y);
  tube(classic ? Mt : St, S.clone().addScaledVector(seatDir, -0.05), postTop,
    { w0: aero ? 0.022 : 0.0272, d0: aero ? 0.042 : 0.0272, kind: aero ? 'aero' : 'round', n: aero ? Math.max(n, 12) : n, col: () => (classic ? x.silver : x.carbon) });
  (classic ? Mt : St).add(new THREE.CylinderGeometry(0.012, 0.012, 0.05, q ? 12 : 6), M4(postTop.x, postTop.y + 0.004, postTop.z, 0, 0, Math.PI / 2), classic ? x.silver : x.dark);

  // Sattel als Loft von der Nase (vorn) zum Heck
  const leather = spec.saddle === 'leather';
  const ttSad = spec.saddle === 'tt';
  const top = rgb(leather ? '#7b4521' : '#16171a');
  const edge = rgb(leather ? '#4b2812' : '#2a2b30');
  const accent = spec.paint.base === 'team' ? rgb(x.kit.side) : rgb(spec.paint.decal);
  const rows: [number, number, number][] = leather
    ? [[-0.165, 0.012, 0.005], [-0.135, 0.019, 0.007], [-0.085, 0.026, 0.007], [-0.025, 0.045, 0.003], [0.035, 0.07, -0.001], [0.08, 0.082, -0.001], [0.112, 0.08, 0.001], [0.128, 0.058, 0.0]]
    : ttSad
      ? [[-0.125, 0.032, 0.0], [-0.09, 0.035, 0.003], [-0.03, 0.04, 0.003], [0.035, 0.055, 0.004], [0.085, 0.06, 0.008], [0.108, 0.048, 0.01]]
      : [[-0.15, 0.012, 0.0], [-0.12, 0.018, 0.002], [-0.07, 0.022, 0.003], [-0.01, 0.034, 0.002], [0.05, 0.06, 0.004], [0.09, 0.068, 0.008], [0.116, 0.062, 0.011], [0.13, 0.038, 0.012]];
  const thick = leather ? 0.03 : 0.022;
  const pts: V[] = rows.map(([dz, , dy]) => saddle.clone().add(v3(0, dy - thick / 2, dz)));
  const fr = pts.map(() => ({ s: v3(-1, 0, 0), c: v3(0, 1, 0) }));
  const sec: [number, number][] = [];
  const ns = q ? 18 : 6;
  for (let j = 0; j < ns; j++) {
    const a = (j / ns) * Math.PI * 2;
    const c = Math.sin(a);
    sec.push([Math.cos(a), c > 0 ? Math.pow(c, 0.8) : c * 0.45]);
  }
  sweep(leather ? St : Ma, pts, fr, (i) => rows[i][1] * 2, () => thick, (i) => (i === 0 || i === rows.length - 1 ? edge : !leather && q && i === rows.length - 2 ? accent : top), sec);
  if (q && leather) {
    // Kupfernieten am Heck
    for (let k = 0; k < 5; k++) {
      const a = -0.95 + (k / 4) * 1.9;
      Mt.add(new THREE.SphereGeometry(0.0045, 6, 4), M4(saddle.x + Math.sin(a) * 0.074, saddle.y - 0.004, saddle.z + 0.102 + Math.cos(a) * 0.01), rgb('#b87333'));
    }
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
  const fixed = drive === 'fixed';
  const double = drive === 'double';
  const cross = spec.frame === 'cross';
  // großes Blatt (Außenradius) und seine Zähne: Bahn 58, Straße 53, Cross 46, Gravel 40
  const [ringR, teeth] = fixed ? [0.118, 58] : cross ? [0.095, 46] : spec.frame === 'gravel' ? [0.085, 40] : [0.108, 53];
  const smallR = cross ? 0.075 : 0.08;
  // Kettenblätter (Zähne nur in der hohen Stufe) mit Spider
  toothed(ringM, o, 0.056, ringR, ringR - 0.02, q ? teeth : 0, 0.004, ringC, 28);
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
  const cogN = fixed ? 1 : spec.frame === 'steel' ? 6 : spec.frame === 'alu' ? 8 : spec.frame === 'tt' ? 7 : cross ? 10 : 12;
  const bigCog = gravel ? 0.07 : 0.056;
  const rc = fixed ? 0.031 : 0.032;
  if (fixed) {
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
  const R = ringR - 0.002;
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
  const link = fixed ? [rgb('#c9a33c'), rgb('#e6d08a')] : [rgb('#3c3e43'), rgb('#9097a0')];
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

/** konvexes Teil: Umriss in der Rahmenebene (z, y), seitlich von −w bis +w, Kanten gepolstert (Taschen) */
function prism(m: Mesher, outline: [number, number][], w: number, bevel: number, col: C3, flat: Mesher = m) {
  // Umriss gegen den Uhrzeigersinn, von rechts (+x) gesehen: u = −z, v = y
  let area = 0;
  for (let i = 0; i < outline.length; i++) {
    const [z0, y0] = outline[i];
    const [z1, y1] = outline[(i + 1) % outline.length];
    area += -z0 * y1 - -z1 * y0;
  }
  const ol = area < 0 ? [...outline].reverse() : outline;
  const N = ol.length;
  // nach innen versetzter Umriss (Gehrung)
  const inset = ol.map((p, i) => {
    const a = ol[(i + N - 1) % N];
    const b = ol[(i + 1) % N];
    const n1 = norm2([-(p[1] - a[1]), -(-p[0] - -a[0])]);
    const n2 = norm2([-(b[1] - p[1]), -(-b[0] - -p[0])]);
    // (u, v)-Normalen nach innen bei Gegenuhrzeigersinn: (−dv, du)
    const k = bevel / (1 + n1[0] * n2[0] + n1[1] * n2[1]);
    const du = (n1[0] + n2[0]) * k;
    const dv = (n1[1] + n2[1]) * k;
    return [p[0] - du, p[1] + dv] as [number, number];
  });
  let cz = 0;
  let cy = 0;
  for (const [z, y] of ol) { cz += z / N; cy += y / N; }
  const center = v3(0, cy, cz);
  const ringsDef: [number, [number, number][]][] = [[-w, inset], [-w + bevel, ol], [w - bevel, ol], [w, inset]];
  const rings = ringsDef.map(([xx, o]) => o.map(([z, y]) => m.v(xx, y, z, col)));
  const P = (i: number) => v3(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]);
  const tri = (mm: Mesher, a: number, b: number, c: number) => {
    const pa = v3(mm.pos[a * 3], mm.pos[a * 3 + 1], mm.pos[a * 3 + 2]);
    const pb = v3(mm.pos[b * 3], mm.pos[b * 3 + 1], mm.pos[b * 3 + 2]);
    const pc = v3(mm.pos[c * 3], mm.pos[c * 3 + 1], mm.pos[c * 3 + 2]);
    const nrm = pb.clone().sub(pa).cross(pc.clone().sub(pa));
    const mid = pa.add(pb).add(pc).multiplyScalar(1 / 3);
    if (nrm.dot(mid.sub(center)) < 0) mm.tri(a, c, b); else mm.tri(a, b, c);
  };
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < N; i++) {
      const a = rings[r][i];
      const b = rings[r][(i + 1) % N];
      const c = rings[r + 1][(i + 1) % N];
      const d = rings[r + 1][i];
      tri(m, a, b, c);
      tri(m, a, c, d);
    }
  }
  // flache Seiten mit eigenen Ecken
  for (const [xx] of [ringsDef[0], ringsDef[3]]) {
    const ids = inset.map(([z, y]) => flat.v(xx, y, z, col));
    const c0 = flat.v(xx, cy, cz, col);
    for (let i = 0; i < N; i++) tri(flat, c0, ids[i], ids[(i + 1) % N]);
  }
  void P;
}
const norm2 = (v: [number, number]): [number, number] => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

/** Schnitt zweier Geraden (Punkt + Richtung) in (z, y) */
function cross2(p: [number, number], d: [number, number], q: [number, number], e: [number, number]): [number, number] {
  const den = d[0] * e[1] - d[1] * e[0];
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
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
  if (spec.frame === 'cross' || spec.frame === 'track') return;
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

interface WheelOut { geo: THREE.BufferGeometry; rimR: number; deep: number; width: number }

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

function buildWheel(x: Ctx, front: boolean, rRim: number): WheelOut {
  const { q, spec } = x;
  const W = set4(PAINT);
  const o = v3(0, 0, 0);
  const seg = q ? 64 : 18;
  const kind = spec.wheels;
  const tt = kind === 'tt';
  const alu = kind === 'box36' || kind === 'box32';
  const four = kind === 'spoke4';
  const deep = kind === 'carbon45' ? 0.045 : kind === 'carbon30' ? 0.03 : kind === 'deep60' || tt || four ? 0.06 : 0.02;
  const width = alu ? (spec.tire?.w ? 0.024 : 0.021) : 0.027;
  const blackRim = spec.frame === 'alu' || spec.frame === 'cross' || spec.frame === 'gravel';
  const rimC = alu ? (blackRim ? rgb('#1d1e22') : x.silver) : x.carbon;
  const rimM = alu ? (blackRim ? W.satin : W.metal) : W.paint;
  const rIn = rRim - deep;
  const disc = tt && !front;
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
    tp.push([tc + Math.cos(a) * rt, Math.sin(a) * rt * 0.98, Math.cos(a) > 0.42 ? x.rubber : wall]);
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
  const flangeR = kind === 'box36' ? 0.03 : 0.023;
  const flL = -0.034;
  const flR = front ? 0.034 : 0.02;
  if (!disc) {
    const hub: [number, number, C3][] = [[0.008, -0.05, hubC], [0.012, -0.048, hubC], [0.012, flL - 0.003, hubC], [flangeR, flL - 0.002, hubC], [flangeR, flL + 0.002, hubC], [0.016, flL + 0.005, hubC], [0.014, 0, hubC], [0.016, flR - 0.005, hubC], [flangeR, flR - 0.002, hubC], [flangeR, flR + 0.002, hubC], [0.012, flR + 0.003, hubC], [0.012, 0.048, hubC], [0.008, 0.05, hubC]];
    revolve(alu || spec.paint.metal !== 'black' ? W.metal : W.satin, q ? hub : [hub[0], hub[3], hub[6], hub[9], hub[12]], q ? 18 : 6, o, false);
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
    const N = q ? (kind === 'box36' ? 36 : kind === 'box32' ? 32 : front ? 20 : 24) : 8;
    const cross = alu ? 3 : front ? 0 : 2;
    spokes(W.metal, N, q ? cross : 0, flL, flR, flangeR, rIn + 0.003, alu ? x.silver : rgb('#1d1e21'), !alu);
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
  return { geo: merge([W.paint, W.metal, W.satin, W.matte])!, rimR: rRim, deep, width };
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
  const serif = spec.frame === 'steel';
  const font = (s: number) => `${serif ? 'italic 700' : spec.frame === 'alu' || spec.frame === 'tt' ? '900' : 'italic 800'} ${s}px ${serif ? 'Georgia, "Times New Roman", serif' : '"Helvetica Neue", Arial, sans-serif'}`;
  let size = 50;
  c.font = font(size);
  while (c.measureText(spec.wordmark).width > 480 && size > 18) { size -= 2; c.font = font(size); }
  c.fillText(spec.wordmark, 256, 35);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.MeshPhongMaterial({ map: tex, transparent: true, alphaTest: 0.3, shininess: 60, specular: new THREE.Color(0x2a2a2a), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
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
  /** dreht um das Tretlager (Ursprung = Tretlager) */
  crank: THREE.BufferGeometry;
  /** nur in der hohen Stufe */
  decal: { frame: THREE.BufferGeometry; rimF: THREE.BufferGeometry | null; rimR: THREE.BufferGeometry | null; mat: THREE.Material; rimMat: THREE.Material } | null;
  fit: BikeFit;
  spec: BikeSpec;
}

const buildCache = new Map<string, BikeBuild>();

/** Räder in voller Detailstufe aus dem Speicher werfen (außer keep) – nach der Garage */
export function releaseBikes(keep?: string) {
  for (const [k, b] of buildCache) {
    if (!k.endsWith('|1') || (keep && k.startsWith(`${keep}|`))) continue;
    for (const g of [b.frame, b.wheelF, b.wheelR, b.crank, b.decal?.frame, b.decal?.rimF, b.decal?.rimR]) g?.dispose();
    buildCache.delete(k);
  }
}

/** Rad bauen (je Modell, Farbe und Stufe nur einmal) */
export function bikeBuild(id: string | undefined, kit: Kit, q: 0 | 1): BikeBuild {
  const spec = bikeById(id);
  const team = spec.paint.base === 'team';
  const key = `${spec.id}|${team ? `${kit.jersey}|${kit.side}` : ''}|${q}`;
  const hit = buildCache.get(key);
  if (hit) return hit;
  const x = makeCtx(spec, kit, q);
  const D = dims(spec.frame);
  const front = v3(0, D.rF, -0.56);
  const rear = v3(0, 0.335, 0.43);
  const tt = spec.frame === 'tt';
  const saddle = tt ? v3(0, 0.95, 0.17) : v3(0, 0.957, 0.215);
  const fit: BikeFit = { front, rear, hood: v3(0.2, 0.92, -0.56), drop: v3(0.2, 0.8, -0.52), aero: null, pelvis: tt ? v3(0, 1.0, 0.13) : v3(0, 1.01, 0.2), lamp: v3(0, 0.86, 0.22) };
  const out = buildFrame(x, D, front, rear);
  buildSeat(x, out.S, D.seatDir, saddle);
  fit.lamp = out.S.clone().addScaledVector(D.seatDir, (0.865 - out.S.y) / D.seatDir.y).add(v3(0, 0, 0.026));
  const clamp = buildCockpit(x, out, fit);
  const crank = buildDrive(x, rear, D.seatDir);
  const wf = buildWheel(x, true, rimFor(spec, D.rF));
  const wr = buildWheel(x, false, rimFor(spec, 0.335));
  buildBrakes(x, out, front, rear, wf.rimR, wr.rimR, !!D.ssLow);
  if (q) buildBottles(x, out);
  if (spec.bags) buildBags(x, D, out, saddle, clamp, fit);
  // Achsen und Schnellspanner (stehen still)
  for (const p of [front, rear]) {
    x.f.metal.add(new THREE.CylinderGeometry(0.005, 0.005, 0.134, 6), M4(p.x, p.y, p.z, 0, 0, Math.PI / 2), x.silver);
    if (q) {
      const lever = spec.brakes === 'rim' ? x.silver : x.dark;
      x.f.metal.add(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 10), M4(p.x - 0.068, p.y, p.z, 0, 0, Math.PI / 2), lever);
      strut(x.f.metal, v3(-0.07, p.y, p.z), v3(-0.072, p.y + 0.014, p.z + 0.05), 0.004, 0.01, lever, X, 0.004, 0.007);
    }
  }
  if (x.mud) applyMud(x.f.paint, x.mudC);
  const build: BikeBuild = {
    frame: merge([x.f.paint, x.f.metal, x.f.satin, x.f.matte])!,
    wheelF: wf.geo,
    wheelR: wr.geo,
    crank: merge([crank.paint, crank.metal, crank.satin, crank.matte])!,
    decal: q ? {
      frame: downTubeDecal(D, out),
      rimF: tt ? null : rimDecal(wf),
      rimR: tt ? null : rimDecal(wr),
      mat: decalMat(spec, team ? teamDecal(kit) : spec.paint.decal),
      rimMat: decalMat(spec, spec.paint.metal === 'gold' ? '#d9b25a' : '#e9ecef'),
    } : null,
    fit,
    spec,
  };
  buildCache.set(key, build);
  return build;
}
