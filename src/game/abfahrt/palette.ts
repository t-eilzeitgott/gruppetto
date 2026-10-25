/** Farbwelten je Tal und Tageszeit */
import type { BiomeId, Ground } from './track';

export type RGB = [number, number, number];

export interface Palette {
  skyTop: RGB;
  skyHorizon: RGB;
  haze: RGB;           // Dunst/Nebel in der Ferne
  far: RGB;            // ferne Berge
  farSnow: RGB;
  mid: RGB;            // näherer Höhenzug
  valley: RGB;         // Talboden
  ground: Record<Ground, [RGB, RGB]>;
  rock: RGB;
  rockDark: RGB;
  verge: RGB;
  water: RGB;
}

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const G = (a: string, b: string): [RGB, RGB] => [hex(a), hex(b)];

const BASE_GROUND: Record<Ground, [RGB, RGB]> = {
  snow: G('#eef3f8', '#dfe7f0'),
  rock: G('#8b8780', '#7c786f'),
  meadow: G('#6fae3f', '#64a13a'),
  forest: G('#3f6b2e', '#38602a'),
  pavement: G('#b9b2a5', '#ada597'),
  field: G('#c9b25a', '#bea84f'),
  water: G('#3f86b8', '#3a7cab'),
  vines: G('#8a9a3c', '#7e8d35'),
  sunflower: G('#7ea23a', '#749634'),
};

function pal(over: Partial<Omit<Palette, "ground">> & { ground?: Partial<Record<Ground, [RGB, RGB]>> }): Palette {
  return {
    skyTop: hex('#3d8fe0'),
    skyHorizon: hex('#cfe6f7'),
    haze: hex('#c5dbea'),
    far: hex('#8fa8c4'),
    farSnow: hex('#f4f8fc'),
    mid: hex('#6f8f6a'),
    valley: hex('#7f9f6c'),
    rock: hex('#8b8780'),
    rockDark: hex('#5f5c56'),
    verge: hex('#8f8779'),
    water: hex('#3f86b8'),
    ...over,
    ground: { ...BASE_GROUND, ...(over.ground ?? {}) },
  };
}

export const BIOME_PALETTES: Record<BiomeId, Palette> = {
  pass: pal({
    skyTop: hex('#2f7fd6'), skyHorizon: hex('#d7ebfa'), haze: hex('#d3e4f1'),
    far: hex('#9fb3cb'), mid: hex('#8c9aa6'), valley: hex('#7f9a78'),
    rock: hex('#9a958c'), rockDark: hex('#6b665e'), verge: hex('#9a9284'),
    ground: { meadow: G('#8db35a', '#82a852'), rock: G('#9c978e', '#8f8a81') },
  }),
  alpine: pal({
    skyTop: hex('#3b8de0'), skyHorizon: hex('#d5ebf7'), haze: hex('#cfe2ee'),
    far: hex('#93abc6'), mid: hex('#5f8a58'), valley: hex('#79a05e'),
    ground: { meadow: G('#79b843', '#6fab3d') },
  }),
  forest: pal({
    skyTop: hex('#4a8fd2'), skyHorizon: hex('#d2e5ef'), haze: hex('#bfd3d9'),
    far: hex('#8aa2b5'), mid: hex('#3e6a3e'), valley: hex('#5d8650'),
    verge: hex('#7b725f'),
    ground: { forest: G('#3e6a2d', '#365f27'), meadow: G('#5f9a3a', '#568e34') },
  }),
  village: pal({
    skyTop: hex('#4593e0'), skyHorizon: hex('#dcecf6'), haze: hex('#d6e3ea'),
    far: hex('#98adc4'), mid: hex('#6b8f5e'), valley: hex('#86a46a'),
    ground: { meadow: G('#78ad48', '#6ea142'), pavement: G('#bdb5a6', '#b1a99a') },
  }),
  lake: pal({
    skyTop: hex('#3a96e6'), skyHorizon: hex('#d9eef9'), haze: hex('#cfe3ef'),
    far: hex('#8fb0cf'), mid: hex('#5d8a6a'), valley: hex('#4b8fbf'),
    water: hex('#2f7fb5'),
    ground: { meadow: G('#7fb04d', '#76a446'), water: G('#2f7fb5', '#2b77ab') },
  }),
  vineyard: pal({
    skyTop: hex('#4a95dc'), skyHorizon: hex('#efe8d6'), haze: hex('#e4dcc8'),
    far: hex('#a7b2bf'), mid: hex('#8a9a5a'), valley: hex('#a6a35d'),
    verge: hex('#b3a07c'),
    ground: { meadow: G('#93ad4c', '#88a245'), field: G('#d1b862', '#c6ad57') },
  }),
};

/** Tageszeit-Stützpunkte: 0 Mittag, 0.45 goldene Stunde, 0.7 Sonnenuntergang, 1 Nacht */
export interface Light {
  t: number;
  skyTop: RGB;
  skyHorizon: RGB;
  tint: RGB;          // Multiplikation über die ganze Szene
  hazeMix: RGB;       // Dunstfarbe wird dorthin gemischt
  hazeAmt: number;
  sun: RGB;
  sunY: number;       // Sonnenhöhe über dem Horizont (Anteil der Bildhöhe)
  lights: number;     // 0..1 Fenster, Laternen an
  stars: number;
}

export const LIGHTS: Light[] = [
  { t: 0, skyTop: hex('#3a8ee2'), skyHorizon: hex('#d6ebf8'), tint: hex('#ffffff'), hazeMix: hex('#d6e6f0'), hazeAmt: 0, sun: hex('#fff8e0'), sunY: 0.3, lights: 0, stars: 0 },
  { t: 0.45, skyTop: hex('#4f86c9'), skyHorizon: hex('#f6d9a8'), tint: hex('#fff1dc'), hazeMix: hex('#f2d6ae'), hazeAmt: 0.5, sun: hex('#ffd38a'), sunY: 0.14, lights: 0, stars: 0 },
  { t: 0.7, skyTop: hex('#3b4f8f'), skyHorizon: hex('#f59a6b'), tint: hex('#f6c9a8'), hazeMix: hex('#e9a07d'), hazeAmt: 0.75, sun: hex('#ff8a4c'), sunY: 0.03, lights: 0.55, stars: 0.1 },
  { t: 0.85, skyTop: hex('#1b2350'), skyHorizon: hex('#8a5a7a'), tint: hex('#8f8fb8'), hazeMix: hex('#5a4f78'), hazeAmt: 0.85, sun: hex('#ff7a50'), sunY: -0.05, lights: 0.9, stars: 0.6 },
  { t: 1, skyTop: hex('#0a1030'), skyHorizon: hex('#2b3360'), tint: hex('#6a74a8'), hazeMix: hex('#2a3058'), hazeAmt: 0.9, sun: hex('#ffffff'), sunY: -0.2, lights: 1, stars: 1 },
];

export const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function lightAt(t: number): Light {
  const x = Math.max(0, Math.min(1, t));
  let i = 0;
  while (i < LIGHTS.length - 2 && LIGHTS[i + 1].t < x) i++;
  const a = LIGHTS[i];
  const b = LIGHTS[i + 1];
  const k = Math.max(0, Math.min(1, (x - a.t) / (b.t - a.t)));
  const m = (p: RGB, q: RGB) => mixRGB(p, q, k);
  const n = (p: number, q: number) => p + (q - p) * k;
  return {
    t: x, skyTop: m(a.skyTop, b.skyTop), skyHorizon: m(a.skyHorizon, b.skyHorizon), tint: m(a.tint, b.tint),
    hazeMix: m(a.hazeMix, b.hazeMix), hazeAmt: n(a.hazeAmt, b.hazeAmt), sun: m(a.sun, b.sun), sunY: n(a.sunY, b.sunY),
    lights: n(a.lights, b.lights), stars: n(a.stars, b.stars),
  };
}

/** Farbstring-Cache, damit pro Frame keine tausend neuen Strings entstehen */
const cache = new Map<number, string>();
export function css(c: RGB, alpha = 1): string {
  const r = Math.max(0, Math.min(255, Math.round(c[0])));
  const g = Math.max(0, Math.min(255, Math.round(c[1])));
  const b = Math.max(0, Math.min(255, Math.round(c[2])));
  if (alpha < 1) return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
  const key = (r << 16) | (g << 8) | b;
  let s = cache.get(key);
  if (!s) {
    if (cache.size > 6000) cache.clear();
    s = `rgb(${r},${g},${b})`;
    cache.set(key, s);
  }
  return s;
}

export const shade = (c: RGB, f: number): RGB => [c[0] * f, c[1] * f, c[2] * f];
