/**
 * Bäume als detailreiche Bilder (Impostors) – nah wie fern, ohne Wechsel der Darstellung.
 *
 * Beim Start wird jede Baumart einmal sehr fein modelliert (zigtausend Dreiecke: hängende Äste mit
 * feinen Trieben, Blätterwolken aus vielen Ballen) und in einen Bildvorrat gezeichnet – Farbe und
 * Normale je Bildpunkt, in hoher Auflösung (auch nah noch scharf). In der Welt steht je Baum ein Bild,
 * das sich zur Kamera dreht; das Licht wird mit den gespeicherten Normalen wie bei einer echten Fläche
 * gerechnet (Sonne, Himmel, Tageszeit). Ein Baum kostet so vier Dreiecke.
 *
 * In der Ferne lösen sich die Bäume weich auf (Raster-Überblendung), während das Kronendach der
 * Landschaft ansteigt – kein Aufploppen, kein Schrumpfen.
 */
import * as THREE from 'three';
import { AP_FRAG, AP_HEAD, AP_VERT, apHook } from './appear';
import { ATMO } from './grade';
import { GB, M, bakedTexture, lin, mixC, mulC, softNormals } from './models3d';
import { mulberry32 } from './rng';

export type TreeKind = 'pine' | 'pineSnow' | 'larch' | 'tree' | 'treeRound' | 'cypress' | 'olive' | 'palm' | 'poplar' | 'apple';
export const TREE_KINDS = new Set<string>(['pine', 'pineSnow', 'larch', 'tree', 'treeRound', 'cypress', 'olive', 'palm', 'poplar', 'apple']);


// ------------------------------------------------------------------ Modelle

type Rnd = () => number;

/** Nadelbaum: viele Etagen hängender Äste (Grat in der Mitte, Flanken fallen ab), fein: zackige Triebe */
function conifer(o: { h: number; w: number; tiers: number; br: number; dark: string; light: string; seed: number; snow?: boolean; droop?: number; sparse?: number; hd: boolean }): THREE.BufferGeometry {
  const b = new GB();
  const r: Rnd = mulberry32(o.seed * 7919 + 13);
  const dark = lin(o.dark);
  const light = lin(o.light);
  const snowC = lin('#eef3f8');
  const trunkC = lin('#4e3524');
  b.addFn(new THREE.CylinderGeometry(0.08, 0.24, o.h * 0.64, o.hd ? 8 : 5, 1, true), M(0, o.h * 0.32), (p) => mulC(trunkC, 0.7 + 0.4 * Math.min(1, p.y / 3)));
  const base = o.h * 0.07;
  const droop = (o.droop ?? 0.28) * (o.hd ? 1 : 1.25);
  // dunkler Kern: verdeckt die Lücken zwischen den Etagen (sonst sieht man durch den Baum hindurch)
  const core = o.sparse ? mixC(dark, light, 0.25) : dark;
  b.addFn(new THREE.ConeGeometry(o.w * (o.sparse ? 0.5 : 0.6), o.h * 0.9, o.hd ? 10 : 6, 1, true), M(0, base + o.h * 0.45), (p) => mulC(core, (o.sparse ? 0.62 : 0.42) + 0.2 * Math.max(0, p.y / o.h)));
  const th = (o.h - base) / o.tiers;
  for (let t = 0; t < o.tiers; t++) {
    const k = t / (o.tiers - 1);
    const y = base + k * (o.h - base - th * 0.6);
    const R = o.w * Math.pow(1 - k, 0.92) * (0.86 + r() * 0.28) + 0.2;
    const n = Math.max(5, Math.round(o.br * (1 - k * 0.5)));
    const rot = r() * Math.PI * 2;
    const shade = 0.76 + 0.34 * k;
    for (let i = 0; i < n; i++) {
      const a = rot + ((i + (r() - 0.5) * 0.45) / n) * Math.PI * 2;
      if (o.sparse && r() < o.sparse * 0.45) continue;
      const len = R * (0.72 + r() * 0.42) * (o.sparse && r() < o.sparse ? 0.62 : 1);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const px = -sa;
      const pz = ca;
      const dl = droop * (0.65 + r() * 0.5);
      const half = len * (0.34 + r() * 0.12) + 0.1;
      const mx = ca * len * 0.5;
      const mz = sa * len * 0.5;
      const my = y + th * 0.12 - dl * len * 0.35;
      const B = [ca * 0.12, y + th * 0.45, sa * 0.12];
      const T = [ca * len, y - dl * len, sa * len];
      // Flanken hängen tiefer, der Grat steht höher: von der Seite gesehen hat jeder Ast Fülle
      const L = [mx + px * half, my - 0.14 - dl * half * 0.6, mz + pz * half];
      const Rr = [mx - px * half, my - 0.14 - dl * half * 0.6, mz - pz * half];
      const Mr = [mx, my + 0.18 + len * 0.1, mz];
      const inner = mulC(dark, 0.6 * shade);
      const tip = mulC(mixC(dark, light, 0.55 + r() * 0.45), shade);
      const mid = mulC(mixC(dark, light, 0.26 + r() * 0.16), shade);
      const snowy = o.snow && t < o.tiers - 1;
      const top = snowy ? mixC(tip, snowC, 0.82) : tip;
      const midT = snowy ? mixC(mid, snowC, 0.7) : mid;
      const side = mulC(mid, 0.8);
      // Oberseite: Grat in der Mitte, Flanken fallen ab
      b.triC(B, L, Mr, inner, side, midT);
      b.triC(Mr, L, T, midT, side, top);
      b.triC(B, Mr, Rr, inner, midT, side);
      b.triC(Mr, T, Rr, midT, top, side);
      // Unterseite im Schatten
      const und = mulC(dark, 0.4);
      b.triC(B, T, L, und, mulC(tip, 0.5), und);
      b.triC(B, Rr, T, und, und, mulC(tip, 0.5));
      {
        // feine Triebe an den Flanken: zackige Ränder wie echte Zweige (nahe 3D-Bäume: die Hälfte, nur oben)
        const nt = o.hd ? 4 : 2;
        for (let q = 0; q < nt; q++) {
          const f = (o.hd ? 0.3 + q * 0.17 : 0.42 + q * 0.26) + (r() - 0.5) * 0.06;
          const sg = q % 2 ? 1 : -1;
          const cx = ca * len * f;
          const cz = sa * len * f;
          const cy = y + th * 0.08 - dl * len * f * 0.8;
          const wq = half * (1 - f * 0.55);
          const P0 = [cx + px * sg * wq * 0.55, cy - 0.04, cz + pz * sg * wq * 0.55];
          const P1 = [cx + px * sg * wq * 1.3 + ca * len * 0.1, cy - 0.16 - dl * 0.3, cz + pz * sg * wq * 1.3 + sa * len * 0.1];
          const P2 = [cx + ca * len * 0.16, cy - 0.06 - dl * len * 0.08, cz + sa * len * 0.16];
          const tc0 = mulC(mixC(dark, light, 0.6 + r() * 0.4), shade);
          const tc = snowy && r() < 0.45 ? mixC(tc0, snowC, 0.65) : tc0;
          if (sg > 0) { b.triC(P0, P1, P2, mid, tc, mid); if (o.hd) b.triC(P0, P2, P1, und, und, mulC(tc0, 0.55)); }
          else { b.triC(P0, P2, P1, mid, mid, tc); if (o.hd) b.triC(P0, P1, P2, und, mulC(tc0, 0.55), und); }
        }
      }
    }
  }
  b.addFn(new THREE.ConeGeometry(0.18, 1.3, 5), M(0, o.h + 0.15), () => mixC(dark, light, 0.62));
  return softNormals(b.build(), o.h * 0.42, 0.45, 0.35);
}

/** Laubbaum: Stamm mit Ästen, Krone aus vielen Blätterballen (außen und oben hell, innen dunkel) */
function broadleaf(o: { cw: number; ch: number; trunkH: number; n: number; dark: string; light: string; seed: number; hd: boolean; blob?: number }): THREE.BufferGeometry {
  const b = new GB();
  const r: Rnd = mulberry32(o.seed * 6007 + 5);
  const trunk = lin('#5a4030');
  const D = lin(o.dark);
  const Lc = lin(o.light);
  b.addFn(new THREE.CylinderGeometry(0.13, 0.3, o.trunkH + 0.9, o.hd ? 8 : 5), M(0, (o.trunkH + 0.9) / 2), (p) => mulC(trunk, 0.75 + 0.3 * Math.min(1, p.y / o.trunkH)));
  const nb = o.hd ? 6 : 3;
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2 + r() * 0.6;
    const len = o.cw * (0.32 + r() * 0.14);
    b.add(new THREE.CylinderGeometry(0.05, 0.11, len, 5), M(Math.cos(a) * len * 0.4, o.trunkH + 0.5 + r() * 0.5, Math.sin(a) * len * 0.4, 1, 1, 1, 0, Math.sin(a) * 0.85, -Math.cos(a) * 0.85), trunk);
  }
  const rx = o.cw / 2;
  const ry = o.ch / 2;
  const cy = o.trunkH + ry * 0.92;
  // Kern füllt Lücken zwischen den Ballen (Schattengrün, nicht schwarz)
  b.addFn(new THREE.IcosahedronGeometry(1, 1), M(0, cy, 0, rx * 0.62, ry * 0.6, rx * 0.62), () => mulC(mixC(D, Lc, 0.25), 0.72));
  const v = new THREE.Vector3();
  for (let i = 0; i < o.n; i++) {
    const u = Math.min(0.95, r() * 1.7 - 0.6);
    const ph = r() * Math.PI * 2;
    const rr = 0.58 + 0.42 * Math.sqrt(r());
    const sq = Math.sqrt(1 - u * u);
    const x = Math.cos(ph) * sq * rx * rr;
    const z = Math.sin(ph) * sq * rx * rr;
    const y = cy + u * ry * rr * 0.92;
    const size = (o.blob ?? 1) * (0.55 + r() * 0.45) * (o.hd ? 0.46 : 0.95) * Math.min(rx, ry) * 0.62;
    const g = new THREE.IcosahedronGeometry(size, 1);
    const pos = g.getAttribute('position');
    for (let q = 0; q < pos.count; q++) {
      v.fromBufferAttribute(pos, q);
      const kk = 0.84 + 0.26 * Math.abs(Math.sin(v.x * 3.1 / size + v.y * 2.3 / size + i) * Math.cos(v.z * 2.7 / size - i));
      pos.setXYZ(q, v.x * kk, v.y * kk * 0.85, v.z * kk);
    }
    const jit = (r() - 0.5) * 0.16;
    b.addFn(g, M(x, y, z, 1, 1, 1, r() * 3), (p, n) => {
      const hgt = Math.max(0, Math.min(1, (p.y - (cy - ry)) / (2 * ry)));
      const out = Math.max(0, (p.x * n.x + p.z * n.z) / Math.max(0.3, Math.hypot(p.x, p.z)));
      const lit = 0.5 + 0.5 * n.y;
      const t = Math.max(0, Math.min(1, hgt * 0.5 + lit * 0.42 + out * 0.22 + jit));
      return mulC(mixC(D, Lc, t), 0.72 + 0.32 * hgt);
    });
  }
  return softNormals(b.build(), cy, 0.8, 0.25);
}

/** Zypresse: schlanke Säule aus übereinanderliegenden Ballen, spitz zulaufend */
function cypress(hd: boolean, seed: number, o: { H?: number; w?: number; dark?: string; light?: string; trunk?: number } = {}): THREE.BufferGeometry {
  const b = new GB();
  const r: Rnd = mulberry32(seed * 31 + 7);
  const D = lin(o.dark ?? '#2f4231');
  const Lc = lin(o.light ?? '#627a58');
  const trunk = o.trunk ?? 1.2;
  b.add(new THREE.CylinderGeometry(0.1, 0.15 + trunk * 0.05, trunk, 5), M(0, trunk / 2), lin('#5a3d27'));
  const n = hd ? 16 : 7;
  const H = o.H ?? 8.6;
  const W = o.w ?? 0.95;
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const y = trunk - 0.3 + k * (H - trunk - 0.2);
    const rad = W * Math.pow(1 - k, 0.7) * (0.9 + r() * 0.2) + 0.18;
    const a = r() * Math.PI * 2;
    const off = hd ? 0.12 : 0.06;
    b.addFn(new THREE.IcosahedronGeometry(1, 1), M(Math.cos(a) * off, y, Math.sin(a) * off, rad, (H / n) * 1.25, rad, r() * 3), (_p, nn) => {
      const lit = 0.5 + 0.5 * nn.y;
      return mulC(mixC(D, Lc, 0.25 + lit * 0.4 + k * 0.25 + (r() - 0.5) * 0.12), 0.78 + 0.3 * k);
    });
  }
  return softNormals(b.build(), H * 0.5, 0.3, 0.3);
}

/** Olivenbaum: knorriger, geteilter Stamm, flache silbergrüne Wolken */
function olive(hd: boolean, seed: number): THREE.BufferGeometry {
  const b = new GB();
  const r: Rnd = mulberry32(seed * 131 + 3);
  const trunk = lin('#6b5a48');
  for (let i = 0; i < 2; i++) {
    const s = i ? -1 : 1;
    b.addFn(new THREE.CylinderGeometry(0.12, 0.26, 2.3, hd ? 7 : 5), M(s * 0.25, 1.1, 0, 1, 1, 1, 0, 0, s * 0.28), (p) => mulC(trunk, 0.75 + 0.15 * p.y));
  }
  const D = lin('#5d6b45');
  const Lc = lin('#a9b48a');
  const n = hd ? 22 : 7;
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const rr = Math.sqrt(r()) * 1.6;
    const y = 2.5 + r() * 1.3;
    const sz = (hd ? 0.55 : 0.95) * (0.7 + r() * 0.5);
    b.addFn(new THREE.IcosahedronGeometry(sz, 1), M(Math.cos(a) * rr, y, Math.sin(a) * rr, 1.2, 0.62, 1.2, r() * 3), (p, nn) => mixC(D, Lc, Math.min(1, 0.3 + 0.45 * (0.5 + 0.5 * nn.y) + (p.y - 2.5) * 0.15)));
  }
  return softNormals(b.build(), 2.9, 0.8, 0.3);
}

/** Palme: leicht gebogener, geringelter Stamm, hängende Wedel aus Fiedern */
function palm(hd: boolean, seed: number): THREE.BufferGeometry {
  const b = new GB();
  const r: Rnd = mulberry32(seed * 17 + 1);
  const seg = 9;
  let x = 0;
  for (let i = 0; i < seg; i++) {
    x += 0.07;
    b.add(new THREE.CylinderGeometry(0.15, 0.19, 0.86, hd ? 7 : 5), M(x, 0.43 + i * 0.82), lin(i % 2 ? '#7a5a3a' : '#8c6c48'));
  }
  const top = [x, 0.43 + seg * 0.82 - 0.2, 0];
  const nf = hd ? 11 : 7;
  const leaves = hd ? 12 : 5;
  for (let f = 0; f < nf; f++) {
    const a = (f / nf) * Math.PI * 2 + r() * 0.3;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const L = 2.6 + r() * 0.6;
    const col = lin(f % 2 ? '#5a8050' : '#6c925a');
    // Wedel: Mittelrippe hängt im Bogen nach unten, Fiedern links und rechts
    const pt = (t: number) => [top[0] + ca * L * t, top[1] + 0.5 * t - 1.6 * t * t, top[2] + sa * L * t];
    for (let q = 0; q < leaves; q++) {
      const t0 = 0.12 + (q / leaves) * 0.82;
      const t1 = t0 + 0.82 / leaves;
      const A = pt(t0);
      const B = pt(t1);
      const wl = 0.55 * (1 - t0 * 0.7);
      for (const sg of [-1, 1]) {
        const C = [A[0] - sa * wl * sg + ca * 0.25, A[1] - 0.35, A[2] + ca * wl * sg + sa * 0.25];
        const cc = mulC(col, 0.85 + r() * 0.3);
        if (sg > 0) { b.triC(A, C, B, cc, mulC(cc, 1.1), cc); b.triC(A, B, C, mulC(cc, 0.6), mulC(cc, 0.6), mulC(cc, 0.6)); }
        else { b.triC(A, B, C, cc, cc, mulC(cc, 1.1)); b.triC(A, C, B, mulC(cc, 0.6), mulC(cc, 0.6), mulC(cc, 0.6)); }
      }
    }
  }
  return b.build();
}

interface Variant { kind: TreeKind; make: (hd: boolean) => THREE.BufferGeometry }

const VARIANTS: Variant[] = [
  { kind: 'pine', make: (hd) => conifer({ h: 12.5, w: 2.9, tiers: hd ? 19 : 15, br: hd ? 15 : 8, dark: '#2b3f30', light: '#667f5b', seed: 3, hd }) },
  { kind: 'pine', make: (hd) => conifer({ h: 14, w: 2.55, tiers: hd ? 20 : 16, br: hd ? 14 : 8, dark: '#2e4432', light: '#728a62', seed: 11, hd, droop: 0.34 }) },
  { kind: 'pine', make: (hd) => conifer({ h: 10.5, w: 3.1, tiers: hd ? 17 : 14, br: hd ? 15 : 8, dark: '#283c2e', light: '#5e7a58', seed: 23, hd, droop: 0.22 }) },
  { kind: 'pineSnow', make: (hd) => conifer({ h: 11.8, w: 2.8, tiers: hd ? 18 : 14, br: hd ? 15 : 8, dark: '#2d4236', light: '#6a8468', seed: 5, snow: true, hd }) },
  { kind: 'pineSnow', make: (hd) => conifer({ h: 13.5, w: 2.5, tiers: hd ? 19 : 15, br: hd ? 14 : 8, dark: '#2f4538', light: '#73896c', seed: 29, snow: true, hd, droop: 0.32 }) },
  { kind: 'larch', make: (hd) => conifer({ h: 11.5, w: 2.4, tiers: hd ? 15 : 12, br: hd ? 11 : 8, dark: '#6b7a45', light: '#b4b878', seed: 7, droop: 0.38, sparse: 0.28, hd }) },
  { kind: 'larch', make: (hd) => conifer({ h: 13, w: 2.2, tiers: hd ? 16 : 13, br: hd ? 10 : 7, dark: '#727f49', light: '#bec07f', seed: 41, droop: 0.42, sparse: 0.32, hd }) },
  { kind: 'tree', make: (hd) => broadleaf({ cw: 5.6, ch: 5.2, trunkH: 3.4, n: hd ? 84 : 12, dark: '#44583a', light: '#91a265', seed: 2, hd }) },
  { kind: 'tree', make: (hd) => broadleaf({ cw: 4.8, ch: 6.2, trunkH: 3.8, n: hd ? 88 : 12, dark: '#405439', light: '#879a5f', seed: 19, hd }) },
  { kind: 'tree', make: (hd) => broadleaf({ cw: 6.4, ch: 4.6, trunkH: 3.0, n: hd ? 84 : 12, dark: '#4a5e3c', light: '#9cab6c', seed: 37, hd, blob: 1.1 }) },
  { kind: 'treeRound', make: (hd) => broadleaf({ cw: 3.8, ch: 3.5, trunkH: 2.2, n: hd ? 60 : 9, dark: '#4e6440', light: '#a0b070', seed: 8, hd }) },
  { kind: 'treeRound', make: (hd) => broadleaf({ cw: 3.3, ch: 3.9, trunkH: 2.5, n: hd ? 60 : 9, dark: '#495f3d', light: '#95a768', seed: 47, hd }) },
  { kind: 'cypress', make: (hd) => cypress(hd, 4) },
  { kind: 'olive', make: (hd) => olive(hd, 6) },
  { kind: 'olive', make: (hd) => olive(hd, 13) },
  { kind: 'palm', make: (hd) => palm(hd, 9) },
  // Pappeln (Po-Ebene): hoch, schlank, hellgrün, mit freiem Stamm
  { kind: 'poplar', make: (hd) => cypress(hd, 21, { H: 14, w: 1.25, dark: '#586a42', light: '#a7b474', trunk: 2.4 }) },
  { kind: 'poplar', make: (hd) => cypress(hd, 33, { H: 12.5, w: 1.1, dark: '#5e7046', light: '#b0bb7c', trunk: 2.0 }) },
  // Apfelbaum (Südtirol): klein, rund, kurzer Stamm
  { kind: 'apple', make: (hd) => broadleaf({ cw: 3.0, ch: 2.6, trunkH: 1.1, n: hd ? 48 : 8, dark: '#52663f', light: '#9eb06c', seed: 53, hd }) },
];

/**
 * Farbvarianz je Baum: Helligkeit, dazu wärmer (gelblich-olive) oder kühler (bläulich) und etwas Sättigung –
 * nebeneinander stehende Bäume derselben Art sehen so verschieden aus. r1, r2 in 0 … 1 (fest je Baum), tint =
 * Helligkeit; gleiche Formel für Bilder in der Ferne und 3D-Bäume in der Nähe.
 */
export function treeTint(tint: number, r1: number, r2: number): [number, number, number] {
  const hv = r1 * 2 - 1;
  const olive = Math.max(0, r2 * 2 - 1.2);
  // Olive: rot rauf, blau runter; kühl: blau rauf, rot runter; die Sättigung über die Breite der Spreizung
  const r = tint * (1 + 0.16 * hv + 0.22 * olive);
  const g = tint * (0.97 + 0.06 * Math.abs(hv) - 0.04 * olive);
  const b = tint * (1 - 0.2 * hv - 0.28 * olive);
  return [r, g, b];
}

/** Arten der Varianten (Index wie VARIANTS) – für die WebGPU-Welt */
export const TREE_VARIANT_KINDS: TreeKind[] = VARIANTS.map((v) => v.kind);

/** Modell einer Variante: fein (hd, für den Bildvorrat) oder wie die nahen 3D-Bäume im Spiel */
export function treeModel(i: number, hd: boolean): THREE.BufferGeometry {
  return VARIANTS[i].make(hd);
}

/** Varianten je Art (Index in VARIANTS) */
const BY_KIND = new Map<string, number[]>();
VARIANTS.forEach((v, i) => { const l = BY_KIND.get(v.kind) ?? []; l.push(i); BY_KIND.set(v.kind, l); });

/** Variante für einen Baum (fest für denselben Ort) */
export function treeVariant(kind: string, h: number): number {
  const l = BY_KIND.get(kind) ?? BY_KIND.get('pine')!;
  return l[Math.min(l.length - 1, Math.floor(h * l.length))];
}

// ------------------------------------------------------------------ Bildvorrat

const COLS = 8;
const ROWS = 3;
/** Farbe je Zelle (Pixel); die Normalen in halber Auflösung (Licht ändert sich weich) */
const CPX = 384;
const RPX = 768;
const NPX = 192;
const NRPX = 384;

interface Cell {
  u0: number; v0: number; du: number; dv: number;
  /** Zelle in Metern (Breite, Höhe) und wie weit sie unter den Fuß reicht */
  w: number; h: number; base: number;
  /** halbe Breite des Umrisses (Anteil der Zellbreite) unten, bei 45 % und oben */
  hw: [number, number, number];
}

export interface TreeAtlas { albedo: THREE.Texture; normal: THREE.Texture; cells: Cell[]; dispose: () => void }

const BAKE_VERT = /* glsl */ `
varying vec3 vCol;
varying vec3 vN;
void main() {
  vCol = color;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/**
 * Vorrat zeichnen: fein modellierte Bäume von der Seite, Farbe (Wurzel – genauer in dunklen Grüns) und Normale
 * in zwei Bildern. Jede Zelle wird einzeln mit Kantenglättung gezeichnet (kleines Ziel, wenig Speicher) und in
 * den großen Vorrat kopiert. Die Ränder sind mit der Abdeckung vormultipliziert.
 */
export function bakeTreeAtlas(gl: THREE.WebGLRenderer): TreeAtlas {
  const AW = COLS * CPX;
  const AH = ROWS * RPX;
  const NW = COLS * NPX;
  const NH = ROWS * NRPX;
  const albedoPx = new Uint8Array(AW * AH * 4);
  const normalPx = new Uint8Array(NW * NH * 4);
  const cells: Cell[] = [];
  const mkMat = (pass: number) => new THREE.ShaderMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    blending: THREE.NoBlending,
    vertexShader: BAKE_VERT,
    fragmentShader: pass === 0
      ? 'varying vec3 vCol; varying vec3 vN; void main() { gl_FragColor = vec4(sqrt(max(vCol, 0.0)), 1.0); }'
      : 'varying vec3 vCol; varying vec3 vN; void main() { vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0); gl_FragColor = vec4(n * 0.5 + 0.5, 1.0); }',
  });
  const mats = [mkMat(0), mkMat(1)];
  const rt = (w: number, h: number) => {
    const r = new THREE.WebGLRenderTarget(w, h, { samples: 4, type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true, generateMipmaps: false });
    r.texture.colorSpace = THREE.NoColorSpace;
    return r;
  };
  const rtA = rt(CPX, RPX);
  const rtN = rt(NPX, NRPX);
  const bufA = new Uint8Array(CPX * RPX * 4);
  const bufN = new Uint8Array(NPX * NRPX * 4);
  // Zelle: 1 × 2 Einheiten, Fuß 0,05 über dem Zellboden
  const cam = new THREE.OrthographicCamera(-0.5, 0.5, 1.95, -0.05, 0.1, 100);
  cam.position.set(0, 0, 40);
  const scene = new THREE.Scene();
  const prevRT = gl.getRenderTarget();
  const prevC = gl.getClearColor(new THREE.Color());
  const prevA = gl.getClearAlpha();
  gl.setClearColor(0x000000, 0);
  const copy = (src: Uint8Array, w: number, h: number, dst: Uint8Array, dw: number, x0: number, y0: number) => {
    for (let y = 0; y < h; y++) dst.set(src.subarray(y * w * 4, (y + 1) * w * 4), ((y0 + y) * dw + x0) * 4);
  };
  VARIANTS.forEach((v, i) => {
    const g = v.make(true);
    const pos = g.getAttribute('position');
    let rad = 0.3;
    let top = 1;
    for (let q = 0; q < pos.count; q++) {
      rad = Math.max(rad, Math.hypot(pos.getX(q), pos.getZ(q)));
      top = Math.max(top, pos.getY(q));
    }
    const k = Math.min(0.94 / (2 * rad), 1.9 / (top + 0.1));
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const m = new THREE.Mesh(g, mats[0]);
    m.scale.setScalar(k);
    m.frustumCulled = false;
    scene.add(m);
    for (let pass = 0; pass < 2; pass++) {
      m.material = mats[pass];
      const target = pass ? rtN : rtA;
      gl.setRenderTarget(target);
      gl.clear(true, true, false);
      gl.render(scene, cam);
      if (pass) { gl.readRenderTargetPixels(rtN, 0, 0, NPX, NRPX, bufN); copy(bufN, NPX, NRPX, normalPx, NW, col * NPX, row * NRPX); }
      else { gl.readRenderTargetPixels(rtA, 0, 0, CPX, RPX, bufA); copy(bufA, CPX, RPX, albedoPx, AW, col * CPX, row * RPX); }
    }
    scene.remove(m);
    // Umriss (von vorn gesehen) für ein knappes Sechseck statt eines großen Vierecks: unten bis 45 % gerade,
    // darüber eine Gerade zur Spitze, die alle Ecken überdeckt (Nadelbäume: spitz, Laubbäume: fast rechteckig)
    const yAt = (y: number) => (0.05 + y * k) / 2;
    let low = 0.04;
    let up = 0.04;
    for (let q = 0; q < pos.count; q++) {
      const xx = Math.abs(pos.getX(q)) * k + 0.012;
      if (yAt(pos.getY(q)) <= 0.45) low = Math.max(low, xx); else up = Math.max(up, xx);
    }
    const mid = Math.max(low, up);
    let topW = 0.02;
    for (let q = 0; q < pos.count; q++) {
      const t = (yAt(pos.getY(q)) - 0.45) / 0.55;
      if (t <= 0.02) continue;
      const xx = Math.abs(pos.getX(q)) * k + 0.012;
      topW = Math.max(topW, (xx - mid * (1 - t)) / t);
    }
    const hw: [number, number, number] = [Math.min(0.5, low), Math.min(0.5, mid), Math.min(0.5, mid, topW)];
    cells.push({ u0: col / COLS, v0: row / ROWS, du: 1 / COLS, dv: 1 / ROWS, w: 1 / k, h: 2 / k, base: 0.05 / k, hw });
    g.dispose();
  });
  gl.setRenderTarget(prevRT);
  gl.setClearColor(prevC, prevA);
  rtA.dispose();
  rtN.dispose();
  for (const m of mats) m.dispose();
  const albedo = bakedTexture(albedoPx, AW, AH);
  const normal = bakedTexture(normalPx, NW, NH);
  return { albedo, normal, cells, dispose: () => { albedo.dispose(); normal.dispose(); } };
}

// ------------------------------------------------------------------ Bilder in der Welt

/**
 * Baumdaten einer Kachel oder eines Abschnitts: je Baum x, y, z, Größe, Drehung, Farbe (r, g, b), Variante und
 * der Höhenunterschied zur gröberen Landschaftsstufe (der Baum folgt dem Gelände beim Übergang)
 */
export const TREC = 10;

export interface TreeSource {
  /** Grundriss [x0, z0, x1, z1] */
  box: [number, number, number, number];
  rec: Float32Array;
  n: number;
  /** sichtbar (beim Aufbau sind unfertige Kacheln noch verborgen) */
  on: boolean;
}

const BB_STRIDE = 20;

let SHAPE: THREE.BufferGeometry | null = null;
/** Sechseck: Ecke = (Seite ±1, Höhe 0/0,45/1, welche Breite) */
const shape = () => {
  if (!SHAPE) {
    SHAPE = new THREE.BufferGeometry();
    SHAPE.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 0.45, 1, 1, 1, 2, -1, 1, 2, -1, 0.45, 1], 3));
    SHAPE.setIndex([0, 1, 2, 0, 2, 5, 5, 2, 3, 5, 3, 4]);
  }
  return SHAPE;
};

/** Alle Bäume einer Kachel/eines Abschnitts als Bilder (ein Zeichenaufruf) */
export function treeBillboards(src: TreeSource, atlas: TreeAtlas): THREE.InstancedBufferGeometry {
  const data = new Float32Array(Math.max(1, src.n) * BB_STRIDE);
  for (let i = 0; i < src.n; i++) {
    const r = src.rec;
    const o = i * TREC;
    const c = atlas.cells[r[o + 8]];
    const d = i * BB_STRIDE;
    data[d] = r[o]; data[d + 1] = r[o + 1]; data[d + 2] = r[o + 2]; data[d + 3] = r[o + 3];
    data[d + 4] = c.u0; data[d + 5] = c.v0; data[d + 6] = c.du; data[d + 7] = c.dv;
    // Spiegeln: jeder zweite Baum (nach Drehung) – mehr Vielfalt aus denselben Bildern
    data[d + 8] = c.w; data[d + 9] = c.h; data[d + 10] = c.base; data[d + 11] = Math.sin(r[o + 4] * 3.7) < 0 ? -1 : 1;
    data[d + 12] = r[o + 5]; data[d + 13] = r[o + 6]; data[d + 14] = r[o + 7]; data[d + 15] = r[o + 9];
    data[d + 16] = c.hw[0]; data[d + 17] = c.hw[1]; data[d + 18] = c.hw[2]; data[d + 19] = 0;
  }
  const q = shape();
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(q.index);
  g.setAttribute('position', q.getAttribute('position'));
  const buf = new THREE.InstancedInterleavedBuffer(data, BB_STRIDE, 1);
  for (let k = 0; k < 5; k++) g.setAttribute(`aT${k}`, new THREE.InterleavedBufferAttribute(buf, 4, k * 4));
  g.instanceCount = src.n;
  const [x0, z0, x1, z1] = src.box;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < src.n; i++) { const y = src.rec[i * TREC + 1]; y0 = Math.min(y0, y); y1 = Math.max(y1, y + 20); }
  if (!src.n) { y0 = 0; y1 = 1; }
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 12);
  return g;
}

export function disposeBillboards(g: THREE.BufferGeometry) {
  g.setIndex(null);
  g.deleteAttribute('position');
  g.dispose();
}

export interface TreeLightU {
  uSunDir: { value: THREE.Vector3 }; uSunC: { value: THREE.Color }; uSkyC: { value: THREE.Color }; uGroundC: { value: THREE.Color };
  uFillDir: { value: THREE.Vector3 }; uFillC: { value: THREE.Color };
}

/**
 * Bildbäume: drehen sich um die eigene Achse zur Kamera, von oben gesehen kippen sie etwas zurück;
 * Licht aus den gespeicherten Normalen (wie Lambert), Wind wiegt die Spitze. Zwischen fade[0] und fade[1]
 * werden sie weich durchsichtig, danach nicht mehr gezeichnet.
 * msaa: Durchsichtigkeit über die Kantenglättung (4 Stufen je Bildpunkt, dazwischen gerastert – wirkt wie echtes
 * Überblenden); ohne Kantenglättung ein Raster je Bildpunkt.
 */
export function billboardMaterial(atlas: TreeAtlas, light: TreeLightU, time: { value: number }, fade: { value: THREE.Vector2 }, msaa = true, morph?: { value: THREE.Vector4 }): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    fog: true,
    defines: msaa ? { BB_A2C: '' } : {},
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uA: { value: null }, uN: { value: null }, uTime: { value: 0 }, uMorph: { value: new THREE.Vector4(0, 0, 1e9, 2e9) },
      uSunDir: { value: new THREE.Vector3() }, uSunC: { value: new THREE.Color() }, uSkyC: { value: new THREE.Color() }, uGroundC: { value: new THREE.Color() },
      uFillDir: { value: new THREE.Vector3() }, uFillC: { value: new THREE.Color() },
    }]),
    vertexShader: /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aT0; // Ort, Größe
attribute vec4 aT1; // Zelle im Vorrat (u0, v0, du, dv)
attribute vec4 aT2; // Zelle in Metern (Breite, Höhe, unter dem Fuß), Spiegeln
attribute vec4 aT3; // Farbe
attribute vec4 aT4; // Umriss: halbe Breiten
uniform float uTime;
uniform vec4 uMorph;
uniform vec2 uFade;
varying vec2 vUv;
varying vec3 vTint;
varying vec3 vR;
varying vec3 vU;
varying vec3 vF;
varying float vFade;
${AP_HEAD}
void main() {
  ${AP_VERT}
  vec3 P = aT0.xyz;
  // Übergang der Landschaft zur gröberen Stufe: der Baum bleibt auf dem Boden
  P.y += aT3.w * smoothstep(uMorph.z, uMorph.w, max(abs(P.x - uMorph.x), abs(P.z - uMorph.y)));
  vec2 toC = cameraPosition.xz - P.xz;
  float d = max(length(toC), 0.01);
  vFade = 1.0 - smoothstep(uFade.x, uFade.y, d);
  float s = aT0.w;
  if (vFade <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 dC = toC / d;
  vec3 F = vec3(dC.x, 0.0, dC.y);
  vec3 R = vec3(dC.y, 0.0, -dC.x);
  float hv = aT2.y * s;
  // von oben gesehen etwas zurückkippen (sonst wirkt der Baum gestaucht)
  float el = atan(cameraPosition.y - P.y - hv * 0.4, d);
  float tl = clamp(el, -0.1, 0.75) * 0.55;
  vec3 U = vec3(0.0, cos(tl), 0.0) - F * sin(tl);
  vec3 N = F * cos(tl) + vec3(0.0, sin(tl), 0.0);
  float hw = position.z < 0.5 ? aT4.x : position.z < 1.5 ? aT4.y : aT4.z;
  float xc = position.x * hw;
  float yl = position.y * hv - aT2.z * s;
  // Wind: oben mehr (wie bei den 3D-Bäumen)
  float ph = uTime * 1.1 + P.x * 0.11 + P.z * 0.07;
  float sw = max(0.0, yl / max(s, 0.01) - 2.0);
  float g = (sin(ph) * 0.6 + sin(ph * 2.3 + 1.7) * 0.4) * sw * sw * 0.0016 * s;
  vec3 wp = P + R * (xc * aT2.x * s + g) + U * yl;
  float mir = aT2.w;
  vUv = aT1.xy + vec2(0.5 + xc * mir, position.y) * aT1.zw;
  vTint = aT3.rgb;
  vR = R * mir;
  vU = U;
  vF = N;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uA;
uniform sampler2D uN;
uniform vec3 uSunDir;
uniform vec3 uSunC;
uniform vec3 uSkyC;
uniform vec3 uGroundC;
uniform vec3 uFillDir;
uniform vec3 uFillC;
varying vec2 vUv;
varying vec3 vTint;
varying vec3 vR;
varying vec3 vU;
varying vec3 vF;
varying float vFade;
${AP_HEAD}
void main() {
  ${AP_FRAG}
  // weiches Auflösen in der Ferne (Schwellen gleichmäßig über die Bildpunkte verteilt)
  float dth = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
#ifdef BB_A2C
  float fq = min(floor(vFade * 4.0 + dth) * 0.25, 1.0);
  if (fq <= 0.0) discard;
#else
  if (dth >= vFade) discard;
  float fq = 1.0;
#endif
  vec4 a = texture2D(uA, vUv);
  float cov = a.a;
  // Ränder scharf (auch in kleinen Mipmap-Stufen), weich über die Kantenglättung
  float aS = (cov - 0.5) / max(fwidth(cov), 1e-4) + 0.5;
  if (aS <= 0.0) discard;
  float ic = 1.0 / max(cov, 0.004);
  vec3 alb = a.rgb * ic;
  alb *= alb;
  vec3 nn = texture2D(uN, vUv).rgb * ic * 2.0 - 1.0;
  vec3 n = normalize(vR * nn.x + vU * nn.y + vF * nn.z);
  vec3 li = mix(uGroundC, uSkyC, 0.5 + 0.5 * n.y) + uSunC * max(dot(n, uSunDir), 0.0) + uFillC * max(dot(n, uFillDir), 0.0);
  gl_FragColor = vec4(alb * vTint * li, clamp(aS, 0.0, 1.0) * fq);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  });
  m.alphaToCoverage = true;
  // Kachel- und Abschnittswechsel: weich ein- und ausblenden (Wert je Objekt)
  m.onBeforeRender = apHook;
  // geteilte Werte: Vorrat, Zeit, Licht der Szene
  m.uniforms.uA.value = atlas.albedo;
  m.uniforms.uN.value = atlas.normal;
  m.uniforms.uTime = time;
  if (morph) m.uniforms.uMorph = morph;
  m.uniforms.uFade = fade;
  for (const k of ['uSunDir', 'uSunC', 'uSkyC', 'uGroundC', 'uFillDir', 'uFillC'] as const) m.uniforms[k] = light[k];
  Object.assign(m.uniforms, ATMO);
  return m;
}
