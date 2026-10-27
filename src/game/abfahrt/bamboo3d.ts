/**
 * Bambusrahmen: geflammte Halme mit Knoten (leicht verdickt, dunkler Ring), Verbindungen mit Hanf
 * gewickelt und mit Harz getränkt (dicke, leicht klumpige Wickel, die zum Rohr hin auslaufen).
 */
import { rgb, type C3, type Mesher } from './gloss';
import { shape, straightFrame, sweep, type Frame3 } from './prim3d';
import { hash3, mix, type V } from './bikebase';

const BAM = rgb('#c4924c');
const BAM_LT = rgb('#dcb676');
const SCORCH = rgb('#7a5226');
const NODE = rgb('#5b3a1b');

/** Bambusrohr von a nach b (Halbmesser r0 → r1), Knoten alle ~18 cm, geflammt */
export function bambooTube(m: Mesher, a: V, b: V, r0: number, r1: number, seed: number, q: 0 | 1): Frame3 {
  const t = b.clone().sub(a);
  const len = t.length();
  t.normalize();
  const f = straightFrame(t);
  const nodes: number[] = [];
  const gap = 0.16 + hash3(seed, 1, 2) * 0.05;
  for (let u = 0.06 + hash3(seed, 3, 4) * 0.08; u < len - 0.05; u += gap * (0.9 + 0.2 * hash3(seed, Math.round(u * 100), 5))) nodes.push(u);
  const steps = q ? Math.max(8, Math.round(len / 0.008)) : 3;
  const us: number[] = [];
  for (let i = 0; i <= steps; i++) us.push((i / steps) * len);
  if (q) for (const nd of nodes) us.push(nd - 0.007, nd - 0.0025, nd, nd + 0.0025, nd + 0.007);
  us.sort((x, y) => x - y);
  const uu = us.filter((u, i) => i === 0 || u - us[i - 1] > 1e-4);
  const pts = uu.map((u) => a.clone().addScaledVector(t, u));
  const nodeK = (u: number) => (q ? nodes.reduce((k, nd) => Math.max(k, 1 - Math.abs(u - nd) / 0.007), 0) : 0);
  const w = (i: number) => {
    const u = uu[i];
    return 2 * (r0 + (r1 - r0) * (u / len)) * (1 + 0.075 * Math.max(0, nodeK(u)));
  };
  const col = (i: number): C3 => {
    const u = uu[i];
    const k = Math.max(0, nodeK(u));
    // geflammt: weiche dunkle Flecken längs, dazwischen helle Fasern
    const fl = 0.5 + 0.5 * Math.sin(u * 23 + seed * 1.7) * Math.sin(u * 7.3 + seed);
    const base = mix(BAM_LT, BAM, 0.5 + 0.5 * Math.sin(u * 41 + seed * 3));
    const c = mix(base, SCORCH, Math.max(0, fl - 0.3) * 0.85);
    return k > 0 ? mix(c, NODE, k * 0.85) : c;
  };
  sweep(m, pts, pts.map(() => f), w, w, col, shape('round', q ? 16 : 6));
  return f;
}

/** Hanfwicklung um ein Rohrende: ab p entlang dir, Länge len, Rohr-Halbmesser r */
export function hempWrap(m: Mesher, p: V, dir: V, len: number, r: number, seed: number, q: 0 | 1) {
  const d = dir.clone().normalize();
  const f = straightFrame(d);
  const K = q ? 18 : 3;
  const pts: V[] = [];
  for (let i = 0; i <= K; i++) pts.push(p.clone().addScaledVector(d, (i / K) * len));
  const HEMP = rgb('#a2875a');
  const HEMP_DK = rgb('#7d653c');
  const RESIN = rgb('#694f2b');
  const w = (i: number) => {
    const u = i / K;
    // am Knoten dick, zum Rohr hin dünn auslaufend, leicht klumpig
    return 2 * r * (1.42 - 0.36 * u * u + (q ? 0.05 * (hash3(seed, i, 1) - 0.5) : 0));
  };
  const col = (i: number): C3 => mix(mix(HEMP, HEMP_DK, hash3(seed, i, 2)), RESIN, i % 3 === 0 ? 0.35 : 0.08);
  sweep(m, pts, pts.map(() => f), w, w, col, shape('round', q ? 14 : 6));
}
