/**
 * Häuser der Ortsdurchfahrten als Körper. Eine Häuserzeile aus der Strecke (Building) wird hier zu einzelnen,
 * schmalen Häusern mit eigener Höhe, Wandfarbe, Fensterart und Dachform; dazu Tiefe an der Fassade: Sockel,
 * Gurtband, Kranzgesims, Fensterbänke und Blumenkästen, Balkone mit Geländer (Eisen oder Holz mit Geranien),
 * Markisen über den Läden, Gauben, Kamine und Anbauten hinten.
 *
 * Koordinaten: at(quer, längs, Höhe) – quer vorzeichenbehaftet ab Straßenmitte (links negativ), längs ab dem
 * Anfang der Zeile, Höhe über dem Erdgeschossboden. Die Fassade eines Hauses liegt bei quer = sg · setback und
 * zeigt zur Straße (−sg).
 *
 * Alles landet in vier Sammlern je Abschnitt (Town): Fassaden mit dem Atlas, Ziegel, einfarbige Teile, Schilder.
 */
import { FAC_M, STYLE, STYLE_KIND, STYLE_PITCH, STYLE_ROOF, STYLE_TRIM, STYLE_WALL, TINTABLE, WALL_PAL, WALL_SETS, awningDetail, badgeUV, facU, facV, signUV, upperDetail, type FacPart, type Lang } from './facade';
import { GB, lin, type RGBf } from './models3d';
import type { Region } from './region';

export interface Town {
  facade: GB; tiles: GB; plain: GB; signs: GB; lanterns: number[]; bulbs: number[];
  /** kleine Teile nur für die Nähe (Balkone, Fensterbänke, Blumen, Sockel): eigenes Netz, das in der Ferne ausgeht */
  detail: GB;
  /** Grundrisse (x, z, Radius) gegen Überschneidungen */
  occ: number[];
}

export type RoofKind = 'gable' | 'front' | 'hip' | 'mansard' | 'flat';
export type At = (lat: number, along: number, h: number) => number[];

export interface HouseSpec {
  s0: number;
  s1: number;
  /** Fassade zur Straßenmitte (m, positiv) */
  setback: number;
  depth: number;
  /** −1 links, 1 rechts */
  sg: number;
  style: number;
  floors: number;
  seed: number;
  /** Wandfarbe (Index in WALL_PAL), −1: Farbe der Textur */
  tint: number;
  roof: RoofKind;
  roofCol: RGBf;
  /** so tief reicht der Sockel unter den Erdgeschossboden (m, negativ) */
  foot: number;
  /** Dachüberstand am Anfang/Ende (false: ein Nachbar schließt an) */
  ovA: boolean;
  ovB: boolean;
  /** Straßenhaus: Läden, Markisen, Balkone, Fensterbänke, Laterne */
  street: boolean;
  shop?: { sign: number; badge: number } | null;
  lantern?: boolean;
  annex?: boolean;
  /** Hinterhaus: Balkone und Bänke nur an der Vorderseite, keine Läden */
  back?: boolean;
}

export const hash = (n: number) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};
const shadeF = (c: RGBf, f: number): RGBf => [c[0] * f, c[1] * f, c[2] * f];
const mixF = (a: RGBf, b: RGBf, t: number): RGBf => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const IRON = lin('#26262a');
const WOOD = lin('#5a3a22');
const WOOD_D = lin('#3e2716');
const STONE = lin('#8f877a');
const GLASS = lin('#2a323c');
const FLOWERS = [lin('#d63a3a'), lin('#ef6a8a'), lin('#e8463c'), lin('#f2f0ea'), lin('#c53060')];
const LEAVES = lin('#3f6b2f');

// ------------------------------------------------------------------ Paletten und Wahl

/** Wandfarben einer Gegend (Indizes in WALL_PAL) */
export function wallSet(region: Region, lang: Lang): readonly number[] {
  switch (region) {
    case 'dolomiten': case 'suedtirol': case 'alpen': return WALL_SETS.alp;
    case 'toskana': return WALL_SETS.toskana;
    case 'po': return WALL_SETS.po;
    case 'riviera': return WALL_SETS.coast;
    case 'apennin': return WALL_SETS.it;
    case 'provence': case 'pyrenaeen': return WALL_SETS.fr;
    case 'nord': return lang === 'en' ? WALL_SETS.en : WALL_SETS.fr;
    case 'spanien': case 'andalusien': return WALL_SETS.es;
  }
  return lang === 'fr' ? WALL_SETS.fr : lang === 'es' ? WALL_SETS.es : lang === 'en' ? WALL_SETS.en : WALL_SETS.it;
}

const TILE_ROOFS = ['#a8492a', '#b5582f', '#9a4426', '#8f4a33', '#b86a3e', '#a65a3c', '#94503a'];
const SLATE_ROOFS = ['#566070', '#4f5560', '#5c6068', '#62666c'];

/** Dachfarbe eines Hauses: Ziegel in Abstufungen, Schiefer im Norden und bei Pariser Häusern, Holz bei Chalets */
export function roofColor(style: number, region: Region, lang: Lang, r: number): RGBf {
  const k = STYLE_KIND[style];
  const north = region === 'nord' || lang === 'en';
  let hex = STYLE_ROOF[style];
  if (k === 'town' || k === 'timber') hex = north && r < 0.5 ? SLATE_ROOFS[Math.floor(r * 8) % SLATE_ROOFS.length] : TILE_ROOFS[Math.floor(r * TILE_ROOFS.length)];
  else if (k === 'haus' || k === 'mairie') hex = SLATE_ROOFS[Math.floor(r * SLATE_ROOFS.length)];
  else if (k === 'stone') hex = r < 0.6 ? SLATE_ROOFS[Math.floor(r * 6) % SLATE_ROOFS.length] : '#6a5a4c';
  return shadeF(lin(hex), 0.9 + (hash(Math.floor(r * 1e6)) * 0.18));
}

/** Dachform passend zu Stil und Gegend; freistehend (beide Enden frei) auch Walmdach */
export function roofKind(style: number, region: Region, lang: Lang, free: boolean, r: number): RoofKind {
  const k = STYLE_KIND[style];
  const south = region === 'spanien' || region === 'andalusien' || region === 'riviera' || (lang === 'es' && region !== 'pyrenaeen');
  switch (k) {
    case 'haus': return r < 0.8 ? 'mansard' : 'gable';
    case 'timber': return r < 0.6 ? 'front' : 'gable';
    case 'chalet': return r < 0.7 ? 'front' : 'gable';
    case 'brick': return r < 0.3 ? 'front' : 'gable';
    case 'stone': return r < 0.35 ? 'front' : free && r > 0.85 ? 'hip' : 'gable';
    case 'town':
      if (south && r < 0.35) return 'flat';
      if (free && r > 0.72) return 'hip';
      return r < 0.12 ? 'front' : 'gable';
    default: return 'gable';
  }
}

// ------------------------------------------------------------------ Bauen

/** ein Haus (Einheit einer Zeile oder Hinterhaus) */
export function buildHouse(T: Town, at: At, h: HouseSpec, lang: Lang) {
  const st = h.style;
  const kind = STYLE_KIND[st];
  const n = h.floors;
  const GH = FAC_M.ground;
  const UH = FAC_M.upper;
  const H = GH + n * UH + FAC_M.cornice;
  const sg = h.sg;
  const s0 = h.s0;
  const s1 = h.s1;
  const L = s1 - s0;
  const D = h.depth;
  const l0 = sg * h.setback;
  const l1 = sg * (h.setback + D);
  const lo = Math.min(l0, l1);
  const hi = Math.max(l0, l1);
  const hs = (k: number) => hash(h.seed + k * 7919);
  const tinted = TINTABLE[st] && h.tint >= 0;
  const tOff = tinted ? h.tint : 0;
  const wallC = tinted ? lin(WALL_PAL[h.tint]) : lin(STYLE_WALL[st]);
  const trimC = kind === 'chalet' ? WOOD : lin(STYLE_TRIM[st]);
  const wTint = 0.9 + hs(31) * 0.14;
  const warm = (hs(37) - 0.5) * 0.1;
  const ageC = (y: number, k: number): RGBf => {
    let f = y < 0 ? 0.62 : y < 1.4 ? 0.78 + 0.22 * (y / 1.4) : 1;
    if (y > H - 0.9) f *= 0.86;
    f *= wTint * (0.95 + hash(h.seed * 13 + k * 7) * 0.08);
    return [f * (1 + warm), f, f * (1 - warm * 1.2)];
  };
  const P = T.plain;

  // ---- Wände: Streifen je Geschoss aus dem Atlas
  type WallFn = (k: number, upper: boolean) => number;
  interface Piece { k: number; t0: number; t1: number; A: [number, number]; e: [number, number]; nrm: [number, number] }
  const wall = (A: [number, number], B: [number, number], variant: WallFn, onPiece?: (p: Piece) => void) => {
    const Lw = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (Lw < 0.05) return;
    const e: [number, number] = [(B[0] - A[0]) / Lw, (B[1] - A[1]) / Lw];
    const nrm: [number, number] = [e[1], -e[0]];
    const np = Math.max(1, Math.ceil(Lw / 4 - 0.01));
    for (let k = 0; k < np; k++) {
      const t0 = k * 4;
      const t1 = Math.min(Lw, t0 + 4);
      const p0 = [A[0] + e[0] * t0, A[1] + e[1] * t0];
      const p1 = [A[0] + e[0] * t1, A[1] + e[1] * t1];
      const strip = (y0: number, y1: number, part: FacPart, v: number) => {
        const [vb, vt] = facV(st, part);
        const u0 = facU(v, 0) + tOff;
        const u1 = facU(v, t1 - t0) + tOff;
        const c0 = ageC(y0, k);
        const c1 = ageC(y1, k);
        T.facade.quadC(at(p0[0], p0[1], y0), at(p1[0], p1[1], y0), at(p1[0], p1[1], y1), at(p0[0], p0[1], y1), c0, c0, c1, c1, [[u0, vb], [u1, vb], [u1, vt], [u0, vt]]);
      };
      const vg = variant(k, false);
      const vu = variant(k, true);
      strip(h.foot, 0, 'base', vg);
      strip(0, GH, 'ground', vg);
      for (let f = 0; f < n; f++) strip(GH + f * UH, GH + (f + 1) * UH, 'upper', vu);
      strip(H - FAC_M.cornice, H, 'cornice', vu);
      onPiece?.({ k, t0, t1, A, e, nrm });
    }
  };
  /** Punkt vor einer Wand: t längs der Wand, w nach außen, y Höhe */
  const W = (p: Piece, t: number, w: number, y: number) => at(p.A[0] + p.e[0] * t + p.nrm[0] * w, p.A[1] + p.e[1] * t + p.nrm[1] * w, y);
  /**
   * Quader vor einer Wand (ohne Rückseite), nur die nötigen Flächen – Häuser haben Hunderte solcher Teile:
   * F vorn, T oben, B unten, E Stirnseiten
   */
  const F = 1, Tp = 2, Bt = 4, E = 8;
  const DT = T.detail;
  const box = (p: Piece, t0: number, t1: number, w0: number, w1: number, y0: number, y1: number, c: RGBf, faces = F | Tp | Bt | E, g: GB = DT) => {
    if (faces & F) g.quad(W(p, t0, w1, y0), W(p, t1, w1, y0), W(p, t1, w1, y1), W(p, t0, w1, y1), c);
    if (faces & Tp) g.quad(W(p, t0, w0, y1), W(p, t0, w1, y1), W(p, t1, w1, y1), W(p, t1, w0, y1), shadeF(c, 1.04));
    if (faces & Bt) g.quad(W(p, t0, w0, y0), W(p, t1, w0, y0), W(p, t1, w1, y0), W(p, t0, w1, y0), shadeF(c, 0.55));
    if (faces & E) {
      g.quad(W(p, t0, w0, y0), W(p, t0, w1, y0), W(p, t0, w1, y1), W(p, t0, w0, y1), shadeF(c, 0.85));
      g.quad(W(p, t1, w1, y0), W(p, t1, w0, y0), W(p, t1, w0, y1), W(p, t1, w1, y1), shadeF(c, 0.85));
    }
  };
  /** dünner Stab (Geländer): eine Fläche nach außen */
  const bar = (p: Piece, t: number, w: number, y0: number, y1: number, r: number, c: RGBf) => {
    DT.quad(W(p, t - r, w, y0), W(p, t + r, w, y0), W(p, t + r, w, y1), W(p, t - r, w, y1), c);
  };
  /** Stab quer zur Wand (Seite eines Balkons) */
  const barSide = (p: Piece, t: number, w0: number, w1: number, y0: number, y1: number, c: RGBf) => {
    DT.quad(W(p, t, w0, y0), W(p, t, w1, y0), W(p, t, w1, y1), W(p, t, w0, y1), c);
  };

  const town = kind === 'town' || kind === 'haus' || kind === 'mairie';
  const banded = town || kind === 'brick';

  // Varianten: Straßenseite mit Läden und Balkonen, Seiten und Rückseite schlicht
  const shopPiece = h.shop && L >= 3.99 ? (L >= 11.9 ? 1 : 0) : -1;
  const frontVar: WallFn = (k, upper) => {
    if (upper) return h.back ? (kind === 'chalet' ? 1 : 0) : hs(k + 40) < (kind === 'chalet' ? 1 : 0.42) ? 1 : 0;
    if (h.back) return 0;
    if (k === shopPiece) return 1;
    return hs(k) < (h.shop ? 0.25 : 0.16) ? 1 : 0;
  };
  const plainVar: WallFn = () => 0;

  const frontA: [number, number] = sg < 0 ? [l0, s0] : [l0, s1];
  const frontB: [number, number] = sg < 0 ? [l0, s1] : [l0, s0];
  const backA: [number, number] = sg < 0 ? [l1, s1] : [l1, s0];
  const backB: [number, number] = sg < 0 ? [l1, s0] : [l1, s1];
  const sideA0: [number, number] = [lo, s0];
  const sideB0: [number, number] = [hi, s0];
  const sideA1: [number, number] = [hi, s1];
  const sideB1: [number, number] = [lo, s1];
  // die Seite zur Straße: Ost/West-Wände folgen der Lage (links/rechts gespiegelt)
  const frontPieces: Piece[] = [];
  wall(frontA, frontB, frontVar, (p) => frontPieces.push(p));
  wall(sideA0, sideB0, plainVar);
  wall(sideA1, sideB1, plainVar);
  wall(backA, backB, plainVar);
  const perim: Piece[] = [];
  for (const [A, B] of [[frontA, frontB], [sideA0, sideB0], [sideA1, sideB1], [backA, backB]] as [[number, number], [number, number]][]) {
    const Lw = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const e: [number, number] = [(B[0] - A[0]) / Lw, (B[1] - A[1]) / Lw];
    perim.push({ k: 0, t0: 0, t1: Lw, A, e, nrm: [e[1], -e[0]] });
  }

  // ---- Sockel, Gurtband, Kranzgesims (umlaufend; die Wandfarbe läuft dahinter weiter)
  if (banded || kind === 'stone' || kind === 'timber') {
    const plinth = kind === 'brick' ? lin('#6e6a64') : kind === 'stone' ? shadeF(wallC, 0.7) : mixF(STONE, shadeF(wallC, 0.75), 0.35);
    for (const [i, p] of perim.entries()) {
      if (i === 3 && !h.street) continue;
      box(p, -0.06, p.t1 + 0.06, 0, 0.06, Math.max(h.foot, -1.5), 0.42, plinth, F | Tp);
    }
  }
  if (banded) {
    const band = shadeF(trimC, 0.96);
    for (const p of perim.slice(0, 3)) box(p, -0.07, p.t1 + 0.07, 0, 0.07, GH - 0.04, GH + 0.13, band, F | Tp | Bt);
    const cw = kind === 'brick' ? 0.16 : 0.3;
    for (const p of perim) {
      box(p, -cw, p.t1 + cw, 0, cw, H - 0.5, H - 0.12, shadeF(trimC, 0.98), F | Tp | Bt, P);
      box(p, -cw * 0.6, p.t1 + cw * 0.6, 0, cw * 0.6, H - 0.66, H - 0.5, shadeF(trimC, 0.9), F | Bt);
    }
  }

  // ---- Straßenseite: Fensterbänke, Blumenkästen, Balkone, Markisen, Ladenschild
  if (h.street) {
    for (const p of frontPieces) {
      const len = p.t1 - p.t0;
      const vu = frontVar(p.k, true);
      const vg = frontVar(p.k, false);
      const det = upperDetail(st, vu);
      for (let f = 0; f < n; f++) {
        const y = GH + f * UH;
        for (const s of det.sills) {
          if (s.x + s.w / 2 > len + 0.01) continue;
          const t = p.t0 + s.x;
          box(p, t - s.w / 2, t + s.w / 2, 0, 0.13, y + s.h - 0.07, y + s.h, shadeF(trimC, 0.95), F | Tp | Bt);
          if (s.flowers) {
            const a0 = t - s.w / 2 + 0.05;
            const a1 = t + s.w / 2 - 0.05;
            box(p, a0, a1, 0.02, 0.24, y + s.h, y + s.h + 0.16, lin('#6a4a30'), F | Tp);
            const am = (a0 + a1) / 2 + (hash(h.seed + f * 13 + p.k) - 0.5) * 0.2;
            const fc = FLOWERS[(f + p.k + Math.floor(hash(h.seed + f) * 5)) % FLOWERS.length];
            box(p, a0 + 0.02, am, 0.03, 0.27, y + s.h + 0.12, y + s.h + 0.3, fc, F | Tp | E);
            box(p, am, a1 - 0.02, 0.03, 0.26, y + s.h + 0.12, y + s.h + 0.25, hash(h.seed + f * 7 + p.k) < 0.5 ? LEAVES : fc, F | Tp | E);
          }
        }
        for (const b of det.balconies) {
          if (b.x1 > len + 0.01) continue;
          const t0 = p.t0 + b.x0;
          const t1 = p.t0 + b.x1;
          const y0 = y + b.h;
          if (b.wood) {
            // Chaletbalkon: tiefe Holzplatte, Bretter mit Lücken, Geranien im Kasten auf dem Handlauf
            const d = 1.05;
            box(p, t0, t1, 0, d, y0 - 0.2, y0, WOOD_D);
            box(p, t0, t1, d - 0.08, d, y0 + 0.88, y0 + 0.98, WOOD, F | Tp);
            // Bretter (breit, mit Lücken) vorn, an den Seiten je eine Bretterwand
            const nb = Math.max(2, Math.round((t1 - t0) / 0.34));
            for (let q = 0; q < nb; q++) {
              const a = t0 + ((t1 - t0) * (q + 0.5)) / nb;
              DT.quad(W(p, a - 0.13, d - 0.03, y0), W(p, a + 0.13, d - 0.03, y0), W(p, a + 0.13, d - 0.03, y0 + 0.88), W(p, a - 0.13, d - 0.03, y0 + 0.88), q % 2 ? WOOD : shadeF(WOOD, 0.88));
            }
            for (const t of [t0, t1]) barSide(p, t, 0.05, d, y0, y0 + 0.88, shadeF(WOOD, 0.92));
            // Geranien im Kasten auf dem Handlauf
            box(p, t0 + 0.1, t1 - 0.1, d - 0.22, d + 0.04, y0 + 0.98, y0 + 1.12, lin('#5a3c24'), F | Tp);
            const nf = Math.max(2, Math.round((t1 - t0) / 0.8));
            for (let q = 0; q < nf; q++) {
              const a0 = t0 + 0.1 + ((t1 - t0 - 0.2) * q) / nf;
              const a1 = a0 + (t1 - t0 - 0.2) / nf;
              const fc = q % 3 === 2 ? LEAVES : FLOWERS[(q + f) % 2];
              box(p, a0, a1, d - 0.24, d + 0.08, y0 + 1.1, y0 + 1.26 + hash(h.seed + q * 31 + f * 7) * 0.12, fc, F | Tp);
            }
          } else {
            // Eisenbalkon: Platte mit Profil, Stäbe, Handlauf
            const d = t1 - t0 > 2 ? 0.75 : 0.6;
            box(p, t0, t1, 0, d, y0 - 0.12, y0 + 0.08, shadeF(trimC, 0.9));
            const top = y0 + 0.98;
            box(p, t0, t1, d - 0.05, d, top - 0.05, top, IRON, F | Tp);
            DT.quad(W(p, t0, d - 0.02, y0 + 0.14), W(p, t1, d - 0.02, y0 + 0.14), W(p, t1, d - 0.02, y0 + 0.18), W(p, t0, d - 0.02, y0 + 0.18), IRON);
            const nb = Math.max(3, Math.round((t1 - t0) / 0.2));
            for (let q = 0; q <= nb; q++) bar(p, t0 + 0.02 + ((t1 - t0 - 0.04) * q) / nb, d - 0.025, y0 + 0.08, top, 0.014, IRON);
            for (const t of [t0 + 0.02, t1 - 0.02]) {
              DT.quad(W(p, t, 0, top - 0.05), W(p, t, d, top - 0.05), W(p, t, d, top), W(p, t, 0, top), IRON);
              barSide(p, t, d * 0.45 - 0.014, d * 0.45 + 0.014, y0 + 0.08, top, IRON);
            }
            // Blumen am Geländer (manchmal)
            if (hash(h.seed + p.k * 5 + f * 3) < 0.35) {
              const a0 = t0 + 0.12;
              const a1 = Math.min(t1 - 0.12, a0 + 0.7);
              box(p, a0, a1, d - 0.2, d - 0.04, y0 + 0.08, y0 + 0.36, lin('#9a5a3a'), F | Tp);
              box(p, a0, a1, d - 0.22, d - 0.02, y0 + 0.36, y0 + 0.55, FLOWERS[(p.k + f) % FLOWERS.length], F | Tp | E);
            }
          }
        }
      }
      // Markise über dem Laden: schräg nach vorn, mit den Streifen aus dem Atlas, Volant am Rand
      const aw = awningDetail(st, vg);
      if (aw && len >= aw.x1 - 0.01 && !h.back) {
        const t0 = p.t0 + aw.x0;
        const t1 = p.t0 + aw.x1;
        const top = aw.top + 0.04;
        const d = 1.35;
        const drop = 0.55;
        const ua = facU(vg, aw.x0) + tOff;
        const ub = facU(vg, aw.x1) + tOff;
        const c1: RGBf = [1, 1, 1];
        const c2: RGBf = [0.55, 0.55, 0.55];
        // oben (von vorn/oben) und unten (Unterseite, dunkler)
        T.facade.quadC(W(p, t0, d, top - drop), W(p, t1, d, top - drop), W(p, t1, 0.02, top), W(p, t0, 0.02, top), c1, c1, c1, c1, [[ua, aw.vb], [ub, aw.vb], [ub, aw.vt], [ua, aw.vt]]);
        T.facade.quadC(W(p, t1, d, top - drop), W(p, t0, d, top - drop), W(p, t0, 0.02, top), W(p, t1, 0.02, top), c2, c2, c2, c2, [[ub, aw.vb], [ua, aw.vb], [ua, aw.vt], [ub, aw.vt]]);
        // Volant (vorn hängend)
        const vm = aw.vb + (aw.vt - aw.vb) * 0.35;
        T.facade.quadC(W(p, t0, d, top - drop - 0.24), W(p, t1, d, top - drop - 0.24), W(p, t1, d, top - drop), W(p, t0, d, top - drop), c1, c1, c1, c1, [[ua, aw.vb], [ub, aw.vb], [ub, vm], [ua, vm]]);
        T.facade.quadC(W(p, t1, d - 0.01, top - drop - 0.24), W(p, t0, d - 0.01, top - drop - 0.24), W(p, t0, d - 0.01, top - drop), W(p, t1, d - 0.01, top - drop), c2, c2, c2, c2, [[ub, aw.vb], [ua, aw.vb], [ua, vm], [ub, vm]]);
        // Seitenarme
        for (const t of [t0 + 0.05, t1 - 0.05]) DT.quad(W(p, t, 0.02, top - 0.02), W(p, t, d, top - drop - 0.02), W(p, t, d, top - drop + 0.02), W(p, t, 0.02, top + 0.02), IRON);
      }
      // Ladenschild über dem Schaufenster (und Steckschild)
      if (h.shop && p.k === shopPiece && h.shop.sign >= 0 && len >= 3.99) {
        const [u0, v0, u1, v1] = signUV(lang, h.shop.sign);
        const sw = 0.05;
        T.signs.quad(W(p, p.t0 + 0.22, sw, GH - 0.37), W(p, p.t0 + 3.78, sw, GH - 0.37), W(p, p.t0 + 3.78, sw, GH - 0.01), W(p, p.t0 + 0.22, sw, GH - 0.01), [1, 1, 1], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
        if (h.shop.badge >= 0) {
          const [bu0, bv0, bu1, bv1] = badgeUV(h.shop.badge);
          const tb = p.t0 + 0.12;
          const y0 = GH + 0.35;
          const y1 = y0 + 0.65;
          T.signs.quad(W(p, tb - 0.01, 0.2, y0), W(p, tb - 0.01, 0.85, y0), W(p, tb - 0.01, 0.85, y1), W(p, tb - 0.01, 0.2, y1), [1, 1, 1], [[bu0, bv0], [bu1, bv0], [bu1, bv1], [bu0, bv1]]);
          T.signs.quad(W(p, tb + 0.01, 0.85, y0), W(p, tb + 0.01, 0.2, y0), W(p, tb + 0.01, 0.2, y1), W(p, tb + 0.01, 0.85, y1), [1, 1, 1], [[bu0, bv0], [bu1, bv0], [bu1, bv1], [bu0, bv1]]);
          DT.quad(W(p, tb, 0, y1 + 0.02), W(p, tb, 0.85, y1 + 0.02), W(p, tb, 0.85, y1 + 0.07), W(p, tb, 0, y1 + 0.07), IRON);
        }
      }
    }
    // Wandlaterne (abends ein warmer Lichtpunkt)
    if (h.lantern && frontPieces.length) {
      const p = frontPieces[0];
      const t = Math.min(p.t1 - 0.3, L >= 6 ? 4 : L / 2);
      const y = GH + 0.45;
      DT.quad(W(p, t - 0.03, 0.02, y + 0.26), W(p, t + 0.03, 0.02, y + 0.26), W(p, t + 0.03, 0.42, y + 0.26), W(p, t - 0.03, 0.42, y + 0.26), IRON);
      box(p, t - 0.09, t + 0.09, 0.33, 0.51, y - 0.02, y + 0.24, lin('#f2d9a0'));
      box(p, t - 0.12, t + 0.12, 0.3, 0.54, y + 0.24, y + 0.3, IRON);
      const c = W(p, t, 0.42, y + 0.12);
      T.lanterns.push(c[0], c[1], c[2]);
    }
  }

  // ---- Dach
  roof(T, at, h, H, wallC, trimC, hs);

  // ---- Anbau hinten: ein Geschoss mit Pultdach
  if (h.annex && L >= 5) {
    const ad = 3 + hs(51) * 1.6;
    const a0 = s0 + 0.5 + hs(53) * Math.max(0, L - 5.5);
    const a1 = Math.min(s1 - 0.4, a0 + 3.5 + hs(55) * 1.8);
    const q0 = l1;
    const q1 = l1 + sg * ad;
    const ha = GH;
    // Wände (Erdgeschoss-Streifen: Tür und Fenster), Ecken gegen den Uhrzeigersinn von außen
    const wallA = (A: [number, number], B: [number, number]) => {
      const Lw = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const np = Math.max(1, Math.ceil(Lw / 4 - 0.01));
      for (let k = 0; k < np; k++) {
        const t0 = k * 4;
        const t1 = Math.min(Lw, t0 + 4);
        const p0 = [A[0] + ((B[0] - A[0]) * t0) / Lw, A[1] + ((B[1] - A[1]) * t0) / Lw];
        const p1 = [A[0] + ((B[0] - A[0]) * t1) / Lw, A[1] + ((B[1] - A[1]) * t1) / Lw];
        for (const [y0, y1, part] of [[h.foot, 0, 'base'], [0, ha, 'ground']] as [number, number, FacPart][]) {
          const [vb, vt] = facV(st, part);
          const c0 = ageC(y0, k + 9);
          const c1 = ageC(y1, k + 9);
          T.facade.quadC(at(p0[0], p0[1], y0), at(p1[0], p1[1], y0), at(p1[0], p1[1], y1), at(p0[0], p0[1], y1), c0, c0, c1, c1, [[facU(0, 0) + tOff, vb], [facU(0, t1 - t0) + tOff, vb], [facU(0, t1 - t0) + tOff, vt], [facU(0, 0) + tOff, vt]]);
        }
      }
    };
    // drei freie Seiten (die vierte steckt im Haus)
    const la = Math.min(q0, q1);
    const lb = Math.max(q0, q1);
    if (q1 > q0) wallA([q1, a0], [q1, a1]); else wallA([q1, a1], [q1, a0]);
    wallA([la, a0], [lb, a0]);
    wallA([lb, a1], [la, a1]);
    // Pultdach: am Haus höher, nach hinten abfallend
    const yh = ha + 0.9;
    const yl = ha - 0.15;
    const ov = 0.35;
    const rc = shadeF(h.roofCol, 0.95);
    const qe = l1 + sg * (ad + ov);
    const sl = Math.hypot(ad + ov, yh - yl);
    T.tiles.quad(at(qe, a0 - ov, yl - 0.04), at(qe, a1 + ov, yl - 0.04), at(l1, a1 + ov, yh), at(l1, a0 - ov, yh), rc,
      [[(a0 - ov) / 2, 0], [(a1 + ov) / 2, 0], [(a1 + ov) / 2, sl / 2], [(a0 - ov) / 2, sl / 2]]);
    // Giebelzwickel über den Seitenwänden
    const gc = shadeF(wallC, 0.9);
    for (const al of [a0, a1]) P.tri(at(l1, al, ha), at(l1, al, yh), at(q1, al, yl + (yh - yl) * (ov / (ad + ov))), gc);
    P.quad(at(qe, a0 - ov, yl - 0.2), at(qe, a1 + ov, yl - 0.2), at(qe, a1 + ov, yl - 0.04), at(qe, a0 - ov, yl - 0.04), WOOD_D);
  }
}

/** Dach eines Hauses (Satteldach längs oder quer, Walm-, Mansard- oder Flachdach), Kamin, Gauben */
function roof(T: Town, at: At, h: HouseSpec, H: number, wallC: RGBf, trimC: RGBf, hs: (k: number) => number) {
  const st = h.style;
  const kind = STYLE_KIND[st];
  const sg = h.sg;
  const s0 = h.s0;
  const s1 = h.s1;
  const L = s1 - s0;
  const D = h.depth;
  const l0 = sg * h.setback;
  // Dachkoordinaten: q quer ab der Fassade (0) bis hinten (D), x längs
  const R = (q: number, x: number, y: number) => at(l0 + sg * q, x, y);
  const chalet = kind === 'chalet';
  const P = T.plain;
  const rc = h.roofCol;
  const board = lin(chalet ? '#3e2716' : kind === 'brick' || kind === 'haus' ? '#d9d4ca' : '#4a3628');
  const soffit = lin(chalet ? '#3a2414' : '#3e342c');
  const gableC = chalet ? lin('#7a4e2c') : kind === 'timber' ? shadeF(wallC, 0.97) : shadeF(wallC, 0.94);
  const ovEnd = chalet ? 0.9 : 0.3;
  const xa = s0 - (h.ovA ? ovEnd : 0);
  const xb = s1 + (h.ovB ? ovEnd : 0);
  const tile = (pts: number[][], uv: number[][], c: RGBf = rc) => {
    if (pts.length === 3) T.tiles.tri(pts[0], pts[1], pts[2], c, uv[0], uv[1], uv[2]);
    else T.tiles.quad(pts[0], pts[1], pts[2], pts[3], c, uv);
  };
  /** Höhe der Dachfläche über einem Punkt (für Kamin) */
  let roofAt: (q: number, x: number) => number = () => H;
  let ridgeY = H;

  const gableAlong = (pitch: number, ovE: number) => {
    // First längs der Straße
    const half = D / 2;
    const rh = H + pitch * half;
    const ee = H - pitch * ovE;
    ridgeY = rh;
    const sl = Math.hypot(half + ovE, rh - ee);
    for (const [qe, qr] of [[-ovE, half], [D + ovE, half]]) {
      tile([R(qe, xa, ee), R(qe, xb, ee), R(qr, xb, rh), R(qr, xa, rh)], [[xa / 2, 0], [xb / 2, 0], [xb / 2, sl / 2], [xa / 2, sl / 2]]);
    }
    const bh = chalet ? 0.3 : 0.18;
    for (const qe of [-ovE, D + ovE]) P.quad(R(qe, xa, ee - bh), R(qe, xb, ee - bh), R(qe, xb, ee), R(qe, xa, ee), board);
    for (const x of [xa, xb]) for (const qe of [-ovE, D + ovE]) P.quad(R(qe, x, ee - bh), R(half, x, rh - bh), R(half, x, rh), R(qe, x, ee), board);
    P.quad(R(half - 0.12, xa, rh + 0.02), R(half - 0.12, xb, rh + 0.02), R(half + 0.12, xb, rh + 0.02), R(half + 0.12, xa, rh + 0.02), shadeF(rc, 0.75));
    // Giebeldreiecke über den Seitenwänden
    for (const x of [s0, s1]) P.tri(R(0, x, H), R(half, x, rh), R(D, x, H), gableC);
    for (const q of [0, D]) P.quad(R(q, xa, H - 0.02), R(q < 1 ? -ovE : D + ovE, xa, ee - bh), R(q < 1 ? -ovE : D + ovE, xb, ee - bh), R(q, xb, H - 0.02), soffit);
    roofAt = (q, _x) => rh - pitch * Math.abs(q - half);
    // Gauben auf der Straßenseite (nur steile, hohe Dächer)
    if (pitch >= 0.55 && !h.back) {
      const q0 = 0.7;
      const base = H + pitch * q0;
      const top = base + 1.3;
      const rd = top + 0.42;
      if (rd < rh - 0.35) {
        for (let x = s0 + 1; x < s1 - 0.8; x += 2) {
          if (hs(70 + Math.round(x * 3)) < 0.45) continue;
          dormer(x, q0, base, top, rd, pitch);
        }
      }
    }
  };

  const dormer = (x: number, q0: number, base: number, top: number, rd: number, pitch: number) => {
    const w = 0.62;
    const qt = (top - H) / pitch;
    const qr = (rd - H) / pitch;
    const face = shadeF(chalet ? lin('#7a4e2c') : kind === 'haus' ? lin('#d9d2c4') : wallC, 0.97);
    P.quad(R(q0, x - w, base), R(q0, x + w, base), R(q0, x + w, top), R(q0, x - w, top), face);
    // Fenster
    P.quad(R(q0 - 0.03, x - 0.38, base + 0.25), R(q0 - 0.03, x + 0.38, base + 0.25), R(q0 - 0.03, x + 0.38, top - 0.18), R(q0 - 0.03, x - 0.38, top - 0.18), lin('#f0ece2'));
    P.quad(R(q0 - 0.04, x - 0.3, base + 0.32), R(q0 - 0.04, x + 0.3, base + 0.32), R(q0 - 0.04, x + 0.3, top - 0.25), R(q0 - 0.04, x - 0.3, top - 0.25), GLASS);
    // Seiten
    for (const sx of [x - w, x + w]) P.tri(R(q0, sx, base), R(q0, sx, top), R(qt, sx, top), shadeF(face, 0.85));
    // Satteldächlein
    const ov = 0.12;
    tile([R(q0 - 0.2, x - w - ov, top - 0.05), R(q0 - 0.2, x, rd), R(qr, x, rd), R(qt, x - w - ov, top - 0.05)], [[0, 0], [0.4, 0], [0.4, 0.6], [0, 0.6]], shadeF(rc, 0.95));
    tile([R(q0 - 0.2, x, rd), R(q0 - 0.2, x + w + ov, top - 0.05), R(qt, x + w + ov, top - 0.05), R(qr, x, rd)], [[0, 0], [0.4, 0], [0.4, 0.6], [0, 0.6]], shadeF(rc, 0.95));
    P.tri(R(q0 - 0.2, x - w - ov, top - 0.05), R(q0 - 0.2, x + w + ov, top - 0.05), R(q0 - 0.2, x, rd), board);
  };

  const pitch0 = STYLE_PITCH[st];
  switch (h.roof) {
    case 'gable': {
      gableAlong(pitch0, chalet ? 1.1 : 0.42);
      break;
    }
    case 'front': {
      // First quer zur Straße: Giebel zeigt zur Straße
      const pitch = chalet ? 0.55 : kind === 'timber' ? 0.95 : Math.max(0.6, pitch0);
      const ovE = chalet ? 1.0 : 0.35;
      const ovG = chalet ? 1.2 : 0.35;
      const xm = (s0 + s1) / 2;
      const half = L / 2;
      const rh = H + pitch * half;
      ridgeY = rh;
      const ee = H - pitch * ovE;
      const qa = -ovG;
      const qb = D + ovG;
      const sl = Math.hypot(half + ovE, rh - ee);
      tile([R(qb, s0 - ovE, ee), R(qa, s0 - ovE, ee), R(qa, xm, rh), R(qb, xm, rh)], [[0, 0], [(qb - qa) / 2, 0], [(qb - qa) / 2, sl / 2], [0, sl / 2]]);
      tile([R(qa, s1 + ovE, ee), R(qb, s1 + ovE, ee), R(qb, xm, rh), R(qa, xm, rh)], [[0, 0], [(qb - qa) / 2, 0], [(qb - qa) / 2, sl / 2], [0, sl / 2]]);
      const bh = chalet ? 0.32 : 0.18;
      for (const x of [s0 - ovE, s1 + ovE]) P.quad(R(qa, x, ee - bh), R(qb, x, ee - bh), R(qb, x, ee), R(qa, x, ee), board);
      for (const q of [qa, qb]) for (const x of [s0 - ovE, s1 + ovE]) P.quad(R(q, x, ee - bh), R(q, xm, rh - bh), R(q, xm, rh), R(q, x, ee), board);
      P.quad(R(qa, xm - 0.12, rh + 0.02), R(qb, xm - 0.12, rh + 0.02), R(qb, xm + 0.12, rh + 0.02), R(qa, xm + 0.12, rh + 0.02), shadeF(rc, 0.75));
      // Giebel vorn und hinten
      for (const q of [0, D]) P.tri(R(q, s0, H), R(q, xm, rh), R(q, s1, H), gableC);
      for (const x of [s0, s1]) P.quad(R(qa, x, H - 0.02), R(qa, x < xm ? s0 - ovE : s1 + ovE, ee - bh), R(qb, x < xm ? s0 - ovE : s1 + ovE, ee - bh), R(qb, x, H - 0.02), soffit);
      // Giebel zur Straße: Fenster, beim Chalet Bretter und Laube, beim Fachwerk Balken
      const gy = H + (rh - H) * 0.28;
      const gw = Math.min(0.55, half * 0.3);
      const fq = -0.03;
      if (chalet) {
        for (let k = 1; k < 8; k++) {
          const x = s0 + (L * k) / 8;
          const yTop = rh - pitch * Math.abs(x - xm);
          P.quad(R(fq, x - 0.02, H), R(fq, x + 0.02, H), R(fq, x + 0.02, yTop), R(fq, x - 0.02, yTop), WOOD_D);
        }
      }
      if (kind === 'timber') {
        const beam = trimC;
        P.quad(R(fq, s0, H + 0.02), R(fq, s1, H + 0.02), R(fq, s1, H + 0.2), R(fq, s0, H + 0.2), beam);
        P.quad(R(fq, xm - 0.08, H), R(fq, xm + 0.08, H), R(fq, xm + 0.08, rh - 0.1), R(fq, xm - 0.08, rh - 0.1), beam);
        for (const sx of [-1, 1]) P.quad(R(fq, xm + sx * half * 0.85, H + 0.2), R(fq, xm + sx * half * 0.85 + sx * 0.16, H + 0.2), R(fq, xm + sx * 0.16, H + (rh - H) * 0.62), R(fq, xm, H + (rh - H) * 0.62), beam);
      }
      if (rh - H > 1.6) {
        P.quad(R(fq - 0.01, xm - gw, gy), R(fq - 0.01, xm + gw, gy), R(fq - 0.01, xm + gw, gy + gw * 1.6), R(fq - 0.01, xm - gw, gy + gw * 1.6), chalet ? WOOD_D : lin('#f0ece2'));
        P.quad(R(fq - 0.02, xm - gw + 0.08, gy + 0.08), R(fq - 0.02, xm + gw - 0.08, gy + 0.08), R(fq - 0.02, xm + gw - 0.08, gy + gw * 1.6 - 0.08), R(fq - 0.02, xm - gw + 0.08, gy + gw * 1.6 - 0.08), GLASS);
      }
      roofAt = (_q, x) => rh - pitch * Math.abs(x - xm);
      break;
    }
    case 'hip': {
      const pitch = Math.min(0.45, pitch0);
      const ov = 0.45;
      const half = D / 2;
      const rh = H + pitch * half;
      ridgeY = rh;
      const ee = H - pitch * ov;
      const xr0 = L > D ? s0 + half : (s0 + s1) / 2;
      const xr1 = L > D ? s1 - half : (s0 + s1) / 2;
      const ya = rh;
      const qa = -ov;
      const qb = D + ov;
      const x0 = s0 - ov;
      const x1 = s1 + ov;
      const sl = Math.hypot(half + ov, rh - ee);
      tile([R(qa, x0, ee), R(qa, x1, ee), R(half, xr1, ya), R(half, xr0, ya)], [[x0 / 2, 0], [x1 / 2, 0], [xr1 / 2, sl / 2], [xr0 / 2, sl / 2]]);
      tile([R(qb, x1, ee), R(qb, x0, ee), R(half, xr0, ya), R(half, xr1, ya)], [[x1 / 2, 0], [x0 / 2, 0], [xr0 / 2, sl / 2], [xr1 / 2, sl / 2]]);
      tile([R(qb, x0, ee), R(qa, x0, ee), R(half, xr0, ya)], [[qb / 2, 0], [qa / 2, 0], [half / 2, sl / 2]]);
      tile([R(qa, x1, ee), R(qb, x1, ee), R(half, xr1, ya)], [[qa / 2, 0], [qb / 2, 0], [half / 2, sl / 2]]);
      const bh = 0.16;
      for (const [A, B] of [[[qa, x0], [qa, x1]], [[qa, x1], [qb, x1]], [[qb, x1], [qb, x0]], [[qb, x0], [qa, x0]]] as number[][][]) {
        P.quad(R(A[0], A[1], ee - bh), R(B[0], B[1], ee - bh), R(B[0], B[1], ee), R(A[0], A[1], ee), board);
      }
      for (const [q, x0b, x1b] of [[0, s0, s1], [D, s0, s1]]) P.quad(R(q, x0b, H - 0.02), R(q < 1 ? qa : qb, x0b - ov, ee - bh), R(q < 1 ? qa : qb, x1b + ov, ee - bh), R(q, x1b, H - 0.02), soffit);
      roofAt = (q, x) => Math.min(rh - pitch * Math.abs(q - half), rh - pitch * Math.max(0, Math.max(xr0 - x, x - xr1)));
      break;
    }
    case 'mansard': {
      // Pariser Dach: steile Brüstung mit Gauben, darüber flach geneigt
      const ov = 0.12;
      const inset = 0.85;
      const mh = 2.7;
      const slate = rc;
      const qa = -ov;
      const qb = D + ov;
      const x0 = s0 - (h.ovA ? ov : 0);
      const x1 = s1 + (h.ovB ? ov : 0);
      const y1 = H + mh;
      const qi0 = inset;
      const qi1 = D - inset;
      const xi0 = s0 + (h.ovA ? inset : 0);
      const xi1 = s1 - (h.ovB ? inset : 0);
      const sl = Math.hypot(inset + ov, mh);
      tile([R(qa, x0, H), R(qa, x1, H), R(qi0, xi1, y1), R(qi0, xi0, y1)], [[x0 / 2, 0], [x1 / 2, 0], [xi1 / 2, sl / 2], [xi0 / 2, sl / 2]], slate);
      tile([R(qb, x1, H), R(qb, x0, H), R(qi1, xi0, y1), R(qi1, xi1, y1)], [[x1 / 2, 0], [x0 / 2, 0], [xi0 / 2, sl / 2], [xi1 / 2, sl / 2]], slate);
      if (h.ovA) tile([R(qb, x0, H), R(qa, x0, H), R(qi0, xi0, y1), R(qi1, xi0, y1)], [[qb / 2, 0], [qa / 2, 0], [qi0 / 2, sl / 2], [qi1 / 2, sl / 2]], slate);
      else P.quad(R(0, s0, H), R(qi0, s0, y1), R(qi1, s0, y1), R(D, s0, H), shadeF(wallC, 0.92));
      if (h.ovB) tile([R(qa, x1, H), R(qb, x1, H), R(qi1, xi1, y1), R(qi0, xi1, y1)], [[qa / 2, 0], [qb / 2, 0], [qi1 / 2, sl / 2], [qi0 / 2, sl / 2]], slate);
      else P.quad(R(D, s1, H), R(qi1, s1, y1), R(qi0, s1, y1), R(0, s1, H), shadeF(wallC, 0.92));
      // oberer Teil: flaches Walmdach
      const half = (qi1 - qi0) / 2;
      const p2 = 0.28;
      const rh = y1 + p2 * half;
      ridgeY = rh;
      const xr0 = xi1 - xi0 > 2 * half ? xi0 + half : (xi0 + xi1) / 2;
      const xr1 = xi1 - xi0 > 2 * half ? xi1 - half : (xi0 + xi1) / 2;
      const qm = (qi0 + qi1) / 2;
      const top = shadeF(slate, 0.9);
      tile([R(qi0, xi0, y1), R(qi0, xi1, y1), R(qm, xr1, rh), R(qm, xr0, rh)], [[0, 0], [1, 0], [1, 1], [0, 1]], top);
      tile([R(qi1, xi1, y1), R(qi1, xi0, y1), R(qm, xr0, rh), R(qm, xr1, rh)], [[0, 0], [1, 0], [1, 1], [0, 1]], top);
      tile([R(qi1, xi0, y1), R(qi0, xi0, y1), R(qm, xr0, rh)], [[0, 0], [1, 0], [0.5, 1]], top);
      tile([R(qi0, xi1, y1), R(qi1, xi1, y1), R(qm, xr1, rh)], [[0, 0], [1, 0], [0.5, 1]], top);
      // Zinkkante oben
      P.quad(R(qi0 - 0.05, xi0, y1 - 0.06), R(qi0 - 0.05, xi1, y1 - 0.06), R(qi0 - 0.05, xi1, y1 + 0.06), R(qi0 - 0.05, xi0, y1 + 0.06), lin('#8a9098'));
      // Gauben in der steilen Brüstung (Fensterachsen)
      if (!h.back) {
        const steep = mh / (inset + ov);
        for (let x = s0 + 1; x < s1 - 0.8; x += 2) {
          const q0 = 0.05;
          const base = H + 0.15;
          const topY = base + 1.5;
          const w = 0.55;
          const qt = (topY - H) / steep - ov;
          const face = lin('#e2dccd');
          P.quad(R(q0, x - w, base), R(q0, x + w, base), R(q0, x + w, topY), R(q0, x - w, topY), face);
          P.quad(R(q0 - 0.03, x - 0.36, base + 0.18), R(q0 - 0.03, x + 0.36, base + 0.18), R(q0 - 0.03, x + 0.36, topY - 0.3), R(q0 - 0.03, x - 0.36, topY - 0.3), GLASS);
          for (const sx of [x - w, x + w]) P.quad(R(q0, sx, base), R(q0, sx, topY), R(qt, sx, topY), R(qt, sx, base), shadeF(face, 0.85));
          // Bogen-Verdachung
          P.quad(R(q0 - 0.08, x - w - 0.08, topY), R(q0 - 0.08, x + w + 0.08, topY), R(qt, x + w + 0.08, topY + 0.18), R(qt, x - w - 0.08, topY + 0.18), shadeF(face, 0.9));
        }
      }
      roofAt = (q, _x) => (q < qi0 || q > qi1 ? H + mh * 0.5 : rh - p2 * Math.abs(q - qm));
      break;
    }
    case 'flat': {
      // Dachterrasse mit Brüstung (Süden): Wand läuft hoch, Abdeckung, heller Belag, manchmal ein Aufbau
      const ph = 0.95;
      const top = H + ph;
      ridgeY = top;
      const wc = shadeF(wallC, 0.96);
      const cope = shadeF(trimC, 0.95);
      const corners: [number, number][] = [[0, s0], [0, s1], [D, s1], [D, s0]];
      for (let k = 0; k < 4; k++) {
        const [qa, xa2] = corners[k];
        const [qb, xb2] = corners[(k + 1) % 4];
        P.quad(R(qa, xa2, H - 0.05), R(qb, xb2, H - 0.05), R(qb, xb2, top), R(qa, xa2, top), wc);
        // Innenseite
        const inq = (q: number) => (q < 1 ? q + 0.25 : q - 0.25);
        const inx = (x: number) => (x < (s0 + s1) / 2 ? x + 0.25 : x - 0.25);
        P.quad(R(inq(qa), inx(xa2), H + 0.1), R(inq(qb), inx(xb2), H + 0.1), R(inq(qb), inx(xb2), top), R(inq(qa), inx(xa2), top), shadeF(wc, 0.85));
        P.quad(R(qa, xa2, top), R(qb, xb2, top), R(inq(qb), inx(xb2), top + 0.02), R(inq(qa), inx(xa2), top + 0.02), cope);
      }
      P.quad(R(0.25, s0 + 0.25, H + 0.1), R(0.25, s1 - 0.25, H + 0.1), R(D - 0.25, s1 - 0.25, H + 0.1), R(D - 0.25, s0 + 0.25, H + 0.1), lin('#b8a68c'));
      if (hs(61) < 0.55 && L > 4.5) {
        // Treppenhaus-Aufbau mit Tür
        const bx0 = s0 + 0.6 + hs(62) * (L - 3.4);
        const bx1 = bx0 + 2.2;
        const bq0 = D * 0.45;
        const bq1 = Math.min(D - 0.4, bq0 + 2.4);
        const by = H + 2.4;
        const bc = shadeF(wallC, 0.93);
        P.quad(R(bq0, bx0, H), R(bq0, bx1, H), R(bq0, bx1, by), R(bq0, bx0, by), bc);
        P.quad(R(bq1, bx1, H), R(bq1, bx0, H), R(bq1, bx0, by), R(bq1, bx1, by), bc);
        P.quad(R(bq0, bx0, H), R(bq1, bx0, H), R(bq1, bx0, by), R(bq0, bx0, by), shadeF(bc, 0.9));
        P.quad(R(bq1, bx1, H), R(bq0, bx1, H), R(bq0, bx1, by), R(bq1, bx1, by), shadeF(bc, 0.9));
        P.quad(R(bq0 - 0.1, bx0 - 0.1, by), R(bq0 - 0.1, bx1 + 0.1, by), R(bq1 + 0.1, bx1 + 0.1, by), R(bq1 + 0.1, bx0 - 0.1, by), cope);
        P.quad(R(bq0 - 0.02, bx0 + 0.6, H + 0.1), R(bq0 - 0.02, bx0 + 1.5, H + 0.1), R(bq0 - 0.02, bx0 + 1.5, H + 2.1), R(bq0 - 0.02, bx0 + 0.6, H + 2.1), lin('#5a3a24'));
      }
      roofAt = () => H + 0.1;
      break;
    }
  }

  // ---- Kamin
  if (h.roof !== 'flat' && hs(9) < 0.75) {
    const ca = s0 + L * (0.2 + hs(11) * 0.6);
    const cq = D * (0.55 + hs(13) * 0.2);
    const ry = roofAt(cq, ca);
    const cw = 0.3;
    const col = kind === 'brick' ? lin('#8a3e2e') : shadeF(wallC, 0.86);
    const top = Math.max(ry + 0.95, Math.min(ridgeY + 0.6, ry + 1.6));
    const C = (dq: number, dx: number, y: number) => R(cq + dq, ca + dx, y);
    const sides: [number, number, number, number][] = [[-cw, -cw, cw, -cw], [cw, -cw, cw, cw], [cw, cw, -cw, cw], [-cw, cw, -cw, -cw]];
    for (const [a0, b0, a1, b1] of sides) P.quad(C(a0, b0, ry - 0.6), C(a1, b1, ry - 0.6), C(a1, b1, top), C(a0, b0, top), col);
    const cap = lin('#3a3632');
    const cc = cw + 0.07;
    P.quad(C(-cc, -cc, top), C(cc, -cc, top), C(cc, cc, top), C(-cc, cc, top), cap);
    for (const [a0, b0, a1, b1] of sides) P.quad(C(a0 * 1.22, b0 * 1.22, top - 0.1), C(a1 * 1.22, b1 * 1.22, top - 0.1), C(a1 * 1.22, b1 * 1.22, top), C(a0 * 1.22, b0 * 1.22, top), cap);
  }
}

// ------------------------------------------------------------------ Zeile aufteilen

/** Stile, die in Zeilen als einzelne schmale Häuser stehen */
export function splittable(style: number): boolean {
  const k = STYLE_KIND[style];
  return k === 'town' || k === 'timber' || k === 'brick' || k === 'haus';
}

const TOWN_BANDS = [STYLE.ocker, STYLE.lachs, STYLE.creme, STYLE.gelb, STYLE.terrakotta];

/**
 * Häuser einer Zeile: Breiten in ganzen Fensterachsen (2 m), jedes mit eigener Höhe, Farbe, Fensterart und Dach,
 * leicht vor- und zurückspringend. Gibt [längs von, bis, Stil, Geschosse, Rücksprung, Farbe] je Haus.
 */
export function rowUnits(L: number, style: number, floors: number, seed: number, pal: readonly number[], prevTint = -1):
  { s0: number; s1: number; style: number; floors: number; dz: number; tint: number }[] {
  const out: { s0: number; s1: number; style: number; floors: number; dz: number; tint: number }[] = [];
  const kind = STYLE_KIND[style];
  const r = (k: number) => hash(seed * 31 + k * 977);
  const pickTint = (k: number, avoid: number) => {
    if (!TINTABLE[style] && kind !== 'town') return -1;
    let t = pal[Math.floor(r(k) * pal.length)];
    if (t === avoid) t = pal[(pal.indexOf(t) + 1 + Math.floor(r(k + 1) * (pal.length - 1))) % pal.length];
    return t;
  };
  if (!splittable(style) || L < 8.5) {
    out.push({ s0: 0, s1: L, style, floors, dz: 0, tint: pickTint(1, prevTint) });
    return out;
  }
  let s = 0;
  let k = 0;
  let lastTint = prevTint;
  let lastFloors = -1;
  while (L - s > 0.01) {
    const left = L - s;
    let w = [4, 6, 6, 8][Math.floor(r(k * 5 + 2) * 4)];
    if (left - w < 3.5) w = left;
    else if (w > left) w = left;
    const st = kind === 'town' && r(k * 5 + 3) < 0.6 ? TOWN_BANDS[Math.floor(r(k * 5 + 4) * TOWN_BANDS.length)] : style;
    let f = floors + (r(k * 5 + 5) < 0.28 ? -1 : r(k * 5 + 5) > 0.72 ? 1 : 0);
    if (f === lastFloors && r(k * 5 + 6) < 0.4) f += r(k * 5 + 7) < 0.5 ? -1 : 1;
    f = Math.max(kind === 'haus' ? 3 : 1, Math.min(kind === 'haus' ? 5 : 4, f));
    const tint = pickTint(k * 5 + 8, lastTint);
    out.push({ s0: s, s1: s + w, style: st, floors: f, dz: (r(k * 5 + 9) - 0.5) * 0.6, tint });
    lastTint = tint;
    lastFloors = f;
    s += w;
    k++;
  }
  return out;
}
