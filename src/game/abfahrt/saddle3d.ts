/**
 * Sättel: Sattelschale als Loft von der Nase zum Heck (Rennsattel, Ledersattel mit Kupfernieten,
 * Zeitfahrsattel, breiter Federsattel) und Schraubenfedern. Genutzt vom normalen Rad (bike3d.ts) und den
 * Sondermodellen (Hochrad, Postrad).
 */
import * as THREE from 'three';
import { rgb, type C3, type Mesher } from './gloss';
import { M4, X, Y, pipe, sweep } from './prim3d';
import { v3, type Ctx, type V } from './bikebase';

export type ShellKind = 'race' | 'leather' | 'tt' | 'spring';

/** Sattelschale; saddle = Mitte oben, k = Längenmaßstab (Hochrad: etwas kürzer) */
export function saddleShell(x: Ctx, saddle: V, kind: ShellKind, k = 1) {
  const { q, spec } = x;
  const { metal: Mt, satin: St, matte: Ma } = x.f;
  const leather = kind === 'leather' || kind === 'spring';
  const top = rgb(leather ? '#7b4521' : '#16171a');
  const edge = rgb(leather ? '#4b2812' : '#2a2b30');
  const accent = spec.paint.base === 'team' ? rgb(x.kit.side) : rgb(spec.paint.decal);
  // [Länge, halbe Breite, Höhe]
  const rows: [number, number, number][] = kind === 'spring'
    // breiter Tourensattel: kurze Nase, ausladendes Heck
    ? [[-0.14, 0.014, 0.006], [-0.11, 0.022, 0.008], [-0.065, 0.032, 0.007], [-0.01, 0.058, 0.003], [0.04, 0.088, -0.001], [0.08, 0.103, -0.002], [0.108, 0.1, 0.0], [0.122, 0.072, 0.0]]
    : leather
      ? [[-0.165, 0.012, 0.005], [-0.135, 0.019, 0.007], [-0.085, 0.026, 0.007], [-0.025, 0.045, 0.003], [0.035, 0.07, -0.001], [0.08, 0.082, -0.001], [0.112, 0.08, 0.001], [0.128, 0.058, 0.0]]
      : kind === 'tt'
        ? [[-0.125, 0.032, 0.0], [-0.09, 0.035, 0.003], [-0.03, 0.04, 0.003], [0.035, 0.055, 0.004], [0.085, 0.06, 0.008], [0.108, 0.048, 0.01]]
        : [[-0.15, 0.012, 0.0], [-0.12, 0.018, 0.002], [-0.07, 0.022, 0.003], [-0.01, 0.034, 0.002], [0.05, 0.06, 0.004], [0.09, 0.068, 0.008], [0.116, 0.062, 0.011], [0.13, 0.038, 0.012]];
  const thick = leather ? 0.03 : 0.022;
  const pts: V[] = rows.map(([dz, , dy]) => saddle.clone().add(v3(0, dy - thick / 2, dz * k)));
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
    const wide = kind === 'spring' ? 1.25 : 1;
    for (let j = 0; j < 5; j++) {
      const a = -0.95 + (j / 4) * 1.9;
      Mt.add(new THREE.SphereGeometry(0.0045, 6, 4), M4(saddle.x + Math.sin(a) * 0.074 * wide, saddle.y - 0.004, saddle.z + (0.102 + Math.cos(a) * 0.01) * k), rgb('#b87333'));
    }
  }
}

/** Schraubenfeder von a nach b: Radius r, Windungen, Drahtstärke */
export function coil(m: Mesher, a: V, b: V, r: number, turns: number, wire: number, col: C3, q: 0 | 1) {
  const t = b.clone().sub(a);
  const len = t.length();
  t.normalize();
  const s = (Math.abs(t.y) < 0.9 ? new THREE.Vector3().crossVectors(t, Y) : new THREE.Vector3().crossVectors(t, X)).normalize();
  const c = new THREE.Vector3().crossVectors(t, s).normalize();
  const K = Math.max(6, Math.round(turns * (q ? 14 : 5)));
  const pts: V[] = [];
  for (let i = 0; i <= K; i++) {
    const u = i / K;
    const an = u * turns * Math.PI * 2;
    pts.push(a.clone().addScaledVector(t, u * len).addScaledVector(s, Math.cos(an) * r).addScaledVector(c, Math.sin(an) * r));
  }
  pipe(m, pts, wire, q ? 6 : 4, col);
}
