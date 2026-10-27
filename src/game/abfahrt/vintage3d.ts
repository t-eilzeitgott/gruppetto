/**
 * Kleinteile der 50er-Jahre-Rennräder: zwei Alu-Flaschen mit Korken in Körben vorn am Lenker,
 * Ersatz-Schlauchreifen als Acht unter dem Sattel (mit Lederriemen), Flügelmuttern an den Achsen,
 * Stangenschaltung (zwei Stangen an der rechten Sitzstrebe mit Hebeln).
 */
import * as THREE from 'three';
import { rgb, type C3 } from './gloss';
import { M4, X, pathFrames, pipe, revolve, shape, strut, sweep } from './prim3d';
import { v3, type Ctx, type FrameOut, type V } from './bikebase';

/** zwei Flaschen vor dem Lenker, Körbe am Oberlenker neben dem Vorbau */
export function barBottles(x: Ctx, clamp: V) {
  const { q } = x;
  const alu = rgb('#c9ced4');
  const cork = rgb('#b98d5a');
  const axd = v3(0, 0.95, 0.3).normalize();
  for (const sx of [-1, 1]) {
    const c = clamp.clone().add(v3(sx * 0.072, -0.006, -0.068));
    const len = 0.17;
    const r = 0.032;
    const prof: [number, number, C3][] = [[0.0005, -len / 2, alu], [r * 0.85, -len / 2, alu], [r, -len / 2 + 0.01, alu], [r, len / 2 - 0.05, alu], [r * 0.9, len / 2 - 0.03, alu], [r * 0.5, len / 2 - 0.012, alu], [r * 0.42, len / 2, cork], [r * 0.46, len / 2 + 0.006, cork], [r * 0.4, len / 2 + 0.018, cork], [0.0005, len / 2 + 0.02, cork]];
    revolve(x.f.metal, prof, q ? 18 : 8, v3(), false, new THREE.Matrix4().compose(c, new THREE.Quaternion().setFromUnitVectors(X, axd), v3(1, 1, 1)));
    if (!q) continue;
    // Korb: zwei Drahtringe, Bügel unten, Schelle am Lenker
    const side = new THREE.Vector3().crossVectors(axd, X).normalize();
    for (const u of [-0.05, 0.03]) {
      const ring: V[] = [];
      for (let k = 0; k <= 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        ring.push(c.clone().addScaledVector(axd, u).addScaledVector(X, Math.cos(a) * (r + 0.002)).addScaledVector(side, Math.sin(a) * (r + 0.002)));
      }
      pipe(x.f.metal, ring, 0.0018, 4, x.silver, X, false);
    }
    const bot = c.clone().addScaledVector(axd, -len / 2 - 0.004);
    pipe(x.f.metal, [c.clone().addScaledVector(axd, -0.05).addScaledVector(side, r + 0.002), bot, c.clone().addScaledVector(axd, -0.05).addScaledVector(side, -r - 0.002)], 0.0018, 4, x.silver);
    strut(x.f.metal, c.clone().addScaledVector(axd, 0.02).add(v3(0, 0, 0.034)), clamp.clone().add(v3(sx * 0.072, 0, 0)), 0.01, 0.006, x.silver, X);
    x.f.metal.add(new THREE.CylinderGeometry(0.0155, 0.0155, 0.014, 12), M4(sx * 0.072 + clamp.x, clamp.y, clamp.z, 0, 0, Math.PI / 2), x.silver);
  }
}

/** Ersatz-Schlauchreifen als Acht gefaltet, mit Lederriemen unter dem Sattel; gibt den Platz fürs Rücklicht
 *  zurück (hinten am Reifen, an der Sattelstütze säße es im Bündel) */
export function spareTubular(x: Ctx, saddle: V): V {
  const { q } = x;
  const tan = rgb('#b78c58');
  const tread = rgb('#3a2f25');
  const c = saddle.clone().add(v3(0, -0.075, 0.05));
  for (let k = 0; k < 2; k++) {
    const pts: V[] = [];
    const K = q ? 36 : 10;
    for (let i = 0; i <= K; i++) {
      const a = (i / K) * Math.PI * 2;
      // flach gedrückte Schlaufe, die zweite leicht verdreht darunter
      pts.push(c.clone().add(v3(Math.cos(a) * 0.05 * (k ? 0.9 : 1), -k * 0.022 + Math.sin(a * 2) * 0.004, Math.sin(a) * 0.12 + (k ? 0.01 : 0))));
    }
    pipe(x.f.matte, pts, 0.0105, q ? 8 : 5, (i) => (i % 6 < 2 ? tread : tan), X, false);
  }
  // Riemen um beide Schlaufen und das Sattelgestell
  const strap = rgb('#4a2c18');
  const s0: V[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    s0.push(c.clone().add(v3(Math.cos(a) * 0.066, -0.012 + Math.sin(a) * 0.045, 0.0)));
  }
  sweep(x.f.matte, s0, pathFrames(s0, v3(0, 0, 1)), () => 0.018, () => 0.003, () => strap, shape('round', 6));
  if (q) x.f.metal.add(new THREE.BoxGeometry(0.014, 0.016, 0.022), M4(c.x + 0.066, c.y - 0.012, c.z), x.silver);
  // Halteriemen hinauf ans Gestell
  strut(x.f.matte, c.clone().add(v3(0, 0.03, 0)), saddle.clone().add(v3(0, -0.026, 0.05)), 0.016, 0.003, strap, X);
  return c.clone().add(v3(0, -0.011, 0.149));
}

/** Flügelmutter an einem Achsende (Seite sx) */
export function wingnut(x: Ctx, p: V, sx: number) {
  const Mt = x.f.metal;
  const c = p.clone().add(v3(sx * 0.068, 0, 0));
  Mt.add(new THREE.CylinderGeometry(0.0095, 0.0095, 0.01, 6), M4(c.x, c.y, c.z, 0, 0, Math.PI / 2), x.silver);
  if (!x.q) return;
  for (const s of [-1, 1]) {
    // zwei geschwungene Flügel nach oben und unten
    strut(Mt, c.clone().add(v3(sx * 0.003, s * 0.006, 0)), c.clone().add(v3(sx * 0.006, s * 0.026, 0.002)), 0.003, 0.016, x.silver, X, 0.003, 0.02);
  }
}

/** Stangenschaltung: zwei Stangen an der rechten Sitzstrebe, oben Hebel, unten die Gabel an der Kette */
export function rodShifter(x: Ctx, out: FrameOut, rear: V) {
  const Mt = x.f.metal;
  const top = out.ssTop.clone().add(v3(0.019, 0, 0.012));
  const dro = rear.clone().add(v3(0.064, 0.012, -0.004));
  const along2 = (t: number, off: number) => dro.clone().lerp(top, t).add(v3(off, 0, 0));
  for (const [t, off, lev] of [[0.62, 0.014, 1], [0.5, 0.024, -1]] as [number, number, number][]) {
    pipe(Mt, [along2(0.04, off), along2(t, off)], 0.0026, x.q ? 6 : 4, x.silver);
    const end = along2(t, off);
    // Hebel: kurz nach außen, dann nach vorn
    pipe(Mt, [end, end.clone().add(v3(0.012, 0.004, 0)), end.clone().add(v3(0.018, 0.01 * lev, -0.05))], 0.0028, x.q ? 6 : 4, x.silver);
    if (x.q) Mt.add(new THREE.SphereGeometry(0.0055, 8, 6), M4(end.x + 0.018, end.y + 0.01 * lev, end.z - 0.052), rgb('#1b1b1d'));
  }
  // Kettengabel unten am Ritzelpaket
  if (x.q) strut(Mt, along2(0.06, 0.014), rear.clone().add(v3(0.05, -0.03, -0.04)), 0.004, 0.012, x.silver);
}
