/**
 * Bild eines Emblems als SVG – gebaut wie ein echtes Abzeichen: Metallkörper mit facettierter Fase, die von oben
 * links beleuchtet wird (jede Facette bekommt ihre Helligkeit aus ihrer Neigung zum Licht), darin ein vertieftes
 * Emaille-Feld mit Glasglanz und ein erhabenes Metallzeichen mit Schatten und Lichtkante.
 * Formen: Medaille mit Band und Riffelrand, Sechseck-Pin, Wappen, Rosette aus gefaltetem Band, Ordensstern mit
 * geschliffenen Strahlen und Trikot aus Stoff. Keine Bilddateien: scharf in jeder Größe, hell wie dunkel.
 */
import { useId, type ReactNode } from 'react';
import type { Look, Tone } from '../lib/emblems';
import type { TourTheme } from '../lib/types';
import { PATHS } from './Icon';
import { cx } from './kit';

type V = [number, number];

// ------------------------------------------------------------------ Farben und Licht

function rgbOf(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const A = rgbOf(a);
  const B = rgbOf(b);
  const c = A.map((x, i) => Math.round(x + (B[i] - x) * t));
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}
/** Farbe an Stelle t (0 dunkel … 1 hell) einer Reihe von Stützfarben */
function ramp(stops: string[], t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mix(stops[i], stops[i + 1], x - i);
}

// Licht von oben links, etwas von vorn
const LIGHT = (() => { const l = Math.hypot(-0.55, -0.85, 1); return [-0.55 / l, -0.85 / l, 1 / l]; })();
function lit(nx: number, ny: number, nz: number): number {
  const l = Math.hypot(nx, ny, nz) || 1;
  const d = (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / l;
  return Math.max(0, d);
}
/** Helligkeit → Stelle im Metallverlauf: Schatten nie ganz schwarz, Licht nie ganz weiß */
const shade = (b: number, lo = 0.12, hi = 0.9) => lo + (hi - lo) * Math.min(1, Math.pow(b, 1.5) * 1.06);

type MetalName = 'gold' | 'silver' | 'bronze';
const METAL: Record<MetalName, string[]> = {
  gold: ['#3a2302', '#6b450a', '#a1721b', '#cf9f37', '#eac25a', '#f7da86', '#fff1c4'],
  silver: ['#222830', '#4a535f', '#7b8695', '#aab4c1', '#d2d9e2', '#eef2f6', '#ffffff'],
  bronze: ['#2e1405', '#5a2c10', '#8a4f25', '#b87643', '#dc9d66', '#f3c79c', '#fff1e2'],
};

type EnamelName = 'slate' | 'azure' | 'violet' | 'ember' | 'opal';
const ENAMEL: Record<EnamelName, string[]> = {
  slate: ['#0f151e', '#1c2735', '#2d3c50', '#465a74', '#6f86a3', '#a9bbd2'],
  azure: ['#041a40', '#0a3478', '#1557bb', '#2f80ec', '#6eb0ff', '#bfe0ff'],
  violet: ['#170638', '#2e0f6e', '#4b20ad', '#7140e0', '#a07bff', '#d9c8ff'],
  ember: ['#2c0601', '#621104', '#a3220b', '#da4325', '#ff7d5a', '#ffc2ae'],
  opal: ['#6c5bd6', '#8fb6ff', '#b9f0ff', '#fff2c2', '#ffd3f1', '#ffffff'],
};

interface Jersey { base: string[]; trim: string; trimEdge: string }
interface Style { metal: MetalName; enamel?: EnamelName; jersey?: Jersey }
const JERSEYS: Record<'rosa' | 'jaune' | 'rojo' | 'leader', Jersey> = {
  rosa: { base: ['#7a1440', '#c12a6c', '#ee5b9b', '#ff8fbe', '#ffd0e5'], trim: '#ffffff', trimEdge: '#b02362' },
  jaune: { base: ['#6e4f00', '#c79500', '#f3c414', '#ffdf4a', '#fff2a8'], trim: '#1b2340', trimEdge: '#0c1226' },
  rojo: { base: ['#5a0905', '#a8170f', '#e1352a', '#ff6152', '#ffb3a8'], trim: '#ffd23f', trimEdge: '#b38a00' },
  leader: { base: ['#0b2a5c', '#1b4f9e', '#3678d8', '#62a0ff', '#bcd9ff'], trim: '#ffffff', trimEdge: '#1b4f9e' },
};
const STYLE: Record<Tone, Style> = {
  gold: { metal: 'gold' },
  silver: { metal: 'silver' },
  bronze: { metal: 'bronze' },
  steel: { metal: 'silver', enamel: 'slate' },
  azure: { metal: 'silver', enamel: 'azure' },
  violet: { metal: 'gold', enamel: 'violet' },
  prism: { metal: 'gold', enamel: 'opal' },
  ember: { metal: 'bronze', enamel: 'ember' },
  rosa: { metal: 'silver', jersey: JERSEYS.rosa },
  jaune: { metal: 'silver', jersey: JERSEYS.jaune },
  rojo: { metal: 'silver', jersey: JERSEYS.rojo },
  leader: { metal: 'silver', jersey: JERSEYS.leader },
};

/** Farben fürs Drumherum (Leuchten und Funken bei der Verleihung) */
export const TONES: Record<Tone, { hi: string; mid: string; lo: string; glow: string }> = {
  gold: { hi: '#fff4bf', mid: '#f1c54a', lo: '#b5781c', glow: 'rgba(255,196,64,0.55)' },
  silver: { hi: '#ffffff', mid: '#d3d9e2', lo: '#8994a4', glow: 'rgba(214,226,245,0.5)' },
  bronze: { hi: '#ffd7b0', mid: '#d48a50', lo: '#934f22', glow: 'rgba(228,140,78,0.5)' },
  steel: { hi: '#e6eef8', mid: '#8fa3bd', lo: '#465a74', glow: 'rgba(150,175,210,0.45)' },
  azure: { hi: '#d9f1ff', mid: '#5cb5ff', lo: '#1e6ccc', glow: 'rgba(80,170,255,0.55)' },
  violet: { hi: '#f3e1ff', mid: '#b780f3', lo: '#7638c0', glow: 'rgba(182,120,255,0.55)' },
  prism: { hi: '#ffffff', mid: '#ffd3f1', lo: '#8fb6ff', glow: 'rgba(255,214,250,0.6)' },
  ember: { hi: '#ffd6ca', mid: '#ff6d4d', lo: '#c12e17', glow: 'rgba(255,100,70,0.5)' },
  rosa: { hi: '#ffe3f0', mid: '#ff7db5', lo: '#de2f7c', glow: 'rgba(255,110,170,0.55)' },
  jaune: { hi: '#fff7c6', mid: '#ffd93d', lo: '#dca300', glow: 'rgba(255,214,50,0.55)' },
  rojo: { hi: '#ffd5cf', mid: '#ff5a4f', lo: '#c4221a', glow: 'rgba(255,90,80,0.55)' },
  leader: { hi: '#dbeeff', mid: '#4f9dff', lo: '#1d5dbc', glow: 'rgba(80,157,255,0.55)' },
};

/** Bänder der Medaillen in den Farben der Rundfahrt: Grund, Streifen */
const RIBBON: Record<TourTheme, { base: string[]; stripe: string; edge: string }> = {
  giro: { base: ['#8c1846', '#d93a7c', '#ff76b0', '#ffb3d3'], stripe: '#ffffff', edge: '#ffffff' },
  tour: { base: ['#7a5a00', '#d9a800', '#ffd534', '#fff0a0'], stripe: '#1b2340', edge: '#1b2340' },
  vuelta: { base: ['#6e0d07', '#c1251b', '#ff5144', '#ffa198'], stripe: '#ffd23f', edge: '#ffd23f' },
  neutral: { base: ['#0f2f66', '#2459b0', '#4f8cf0', '#a9cbff'], stripe: '#ffffff', edge: '#ffffff' },
};

// ------------------------------------------------------------------ Geometrie

const f = (p: V) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`;
const poly = (pts: V[]) => `M${pts.map(f).join('L')}Z`;
const polar = (c: V, r: number, deg: number): V => [c[0] + r * Math.cos((deg * Math.PI) / 180), c[1] + r * Math.sin((deg * Math.PI) / 180)];
const circlePts = (c: V, r: number, n = 72): V[] => Array.from({ length: n }, (_, i) => polar(c, r, -90 + (360 * i) / n));
const hexPts = (c: V, r: number): V[] => Array.from({ length: 6 }, (_, i) => polar(c, r, -90 + 60 * i));
const scaleTo = (pts: V[], c: V, s: number): V[] => pts.map(([x, y]) => [c[0] + (x - c[0]) * s, c[1] + (y - c[1]) * s]);
const lerp = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function quadPts(a: V, c: V, b: V, n: number): V[] {
  return Array.from({ length: n }, (_, i) => { const t = i / n; return [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]] as V; });
}
function cubicPts(a: V, c1: V, c2: V, b: V, n: number): V[] {
  return Array.from({ length: n }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return [u ** 3 * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * b[0], u ** 3 * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * b[1]] as V;
  });
}
const linePts = (a: V, b: V, n: number): V[] => Array.from({ length: n }, (_, i) => lerp(a, b, i / n));
const SHIELD_C: V = [60, 60];
const SHIELD_PTS: V[] = [
  ...quadPts([13, 20], [60, 2], [107, 20], 22),
  ...linePts([107, 20], [107, 56], 8),
  ...cubicPts([107, 56], [107, 87], [87, 106], [60, 117], 22),
  ...cubicPts([60, 117], [33, 106], [13, 87], [13, 56], 22),
  ...linePts([13, 56], [13, 20], 8),
];

/**
 * Fase zwischen zwei Umrissen: jede Facette bekommt ihre Helligkeit aus ihrer Neigung zum Licht.
 * `out`: fällt nach außen ab (Außenkante); `in`: fällt nach innen ab (Rand ins vertiefte Feld).
 */
function bevel(outer: V[], inner: V[], c: V, stops: string[], slope: 'out' | 'in', k: string, tilt = 0.8): ReactNode[] {
  const n = outer.length;
  const out: ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const a = outer[i];
    const b = outer[(i + 1) % n];
    let nx = b[1] - a[1];
    let ny = -(b[0] - a[0]);
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    if (nx * ((a[0] + b[0]) / 2 - c[0]) + ny * ((a[1] + b[1]) / 2 - c[1]) < 0) { nx = -nx; ny = -ny; }
    const s = slope === 'out' ? 1 : -1;
    const col = ramp(stops, shade(lit(nx * s * tilt, ny * s * tilt, 1 - tilt * 0.45)));
    out.push(<path key={`${k}${i}`} d={poly([a, b, inner[(i + 1) % n], inner[i]])} fill={col} stroke={col} strokeWidth="0.45" strokeLinejoin="round" />);
  }
  return out;
}

/** Ordensstern: Strahlen mit zwei geschliffenen Facetten je Strahl */
function starRays(c: V, n: number, rTip: number, rBase: number, half: number, offset: number, stops: string[], k: string): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const a = offset - 90 + (360 * i) / n;
    const tip = polar(c, rTip, a);
    const axis = polar(c, rBase * 0.35, a);
    const ux = Math.cos((a * Math.PI) / 180);
    const uy = Math.sin((a * Math.PI) / 180);
    for (const side of [-1, 1]) {
      const base = polar(c, rBase, a + side * half);
      // Facette neigt sich zur Seite (quer zum Strahl) und etwas zur Spitze hin
      const px = -uy * side;
      const py = ux * side;
      const col = ramp(stops, shade(lit(px * 0.85 + ux * 0.25, py * 0.85 + uy * 0.25, 0.55), 0.16, 0.8));
      out.push(<path key={`${k}${i}${side}`} d={poly([axis, tip, base])} fill={col} stroke={col} strokeWidth="0.4" strokeLinejoin="round" />);
    }
  }
  return out;
}

/** Rosette: gefaltetes Band rundherum, jede Falte zum Licht hin oder davon weg geneigt */
function pleats(c: V, r0: number, r1: number, n: number, stops: string[], k: string): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (360 * i) / n - 90;
    const a1 = (360 * (i + 1)) / n - 90;
    const am = (a0 + a1) / 2;
    const side = i % 2 ? 1 : -1;
    const tx = -Math.sin((am * Math.PI) / 180) * side;
    const ty = Math.cos((am * Math.PI) / 180) * side;
    const rx = Math.cos((am * Math.PI) / 180);
    const ry = Math.sin((am * Math.PI) / 180);
    const col = ramp(stops, shade(lit(tx * 0.5 + rx * 0.25, ty * 0.5 + ry * 0.25, 0.8), 0.3, 0.78));
    const pts: V[] = [polar(c, r0, a0), polar(c, r1, a0 + 1), polar(c, r1 + 2.6, am), polar(c, r1, a1 - 1), polar(c, r0, a1)];
    out.push(<path key={`${k}${i}`} d={poly(pts)} fill={col} stroke={col} strokeWidth="0.4" strokeLinejoin="round" />);
  }
  return out;
}

// ------------------------------------------------------------------ Zeichen

const GLYPHS: Record<string, string> = {
  bike: PATHS.bike,
  star: PATHS.star,
  refresh: PATHS.refresh,
  flag: PATHS.flag,
  mountain: PATHS.mountain,
  zap: PATHS.zap,
  podium: PATHS.podium,
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM12 11.2a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z',
  crosshair: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5M12 11.5v1',
  dice: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01',
  sparkle: 'M11 2.5l1.9 5.6L18.5 10l-5.6 1.9L11 17.5l-1.9-5.6L3.5 10l5.6-1.9zM18.5 15l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z',
  diamond: 'M7 4h10l4 5-9 11L3 9zM3 9h18M10 4 8.5 9 12 20M14 4l1.5 5L12 20',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z',
  hourglass: 'M6 3h12M6 21h12M7.5 3c0 5 4.5 6 4.5 9s-4.5 4-4.5 9M16.5 3c0 5-4.5 6-4.5 9s4.5 4 4.5 9M10 18.5h4',
  sunrise: 'M3 17h18M6.5 17a5.5 5.5 0 0 1 11 0M12 4v4M4.9 9.4l1.6 1.6M19.1 9.4l-1.6 1.6M8 21h8',
  moon: 'M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10zM17 4.5v3M15.5 6h3',
  chevronsUp: 'm6 12 6-6 6 6M6 19l6-6 6 6',
  camera: 'M4 8h3.2l1.8-3h6l1.8 3H20v11H4zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  trendUp: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  lantern: 'M9 4.5h6M12 2v2.5M8 7h8M8.6 7 8 17.5h8L15.4 7M7 20h10M9.5 17.5V20M14.5 17.5V20M12 9.5c1.4 1.4 1.8 2.6 1.8 3.5a1.8 1.8 0 0 1-3.6 0c0-.9.4-2.1 1.8-3.5z',
  calendarCheck: 'M5 5h14v15H5zM5 9.5h14M9 3v4M15 3v4M9 14.5l2 2 4-4',
  stopwatch: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 2M10 2h4M12 2v3M18.5 6.5 20 5',
  orb: 'M12 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM7 21h10M8.5 16.5 7.5 21M15.5 16.5l1 4.5M8.8 8.2A3.6 3.6 0 0 1 12 6.4',
  cup: 'M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10h1.8a2.5 2.5 0 0 1 0 5H16M8.5 2.5c-.7 1 .7 1.8 0 3M11.5 2.5c-.7 1 .7 1.8 0 3',
  ticket: 'M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4zM14.5 7v2M14.5 11v2M14.5 15v2',
  crown: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5zM5 19h14M12 14.5h.01',
};

const SERIF = 'ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif';

/**
 * Zeichen: auf Emaille erhaben aus Metall (dunkle Kontur, Schlagschatten, Metallstrich, Lichtkante),
 * auf Metall eingraviert (dunkle Rille, unten rechts fängt die Kante das Licht).
 */
function Glyph({ glyph, c, size, metal, id, onMetal }: { glyph: string; c: V; size: number; metal: string[]; id: (s: string) => string; onMetal?: boolean }) {
  const path = GLYPHS[glyph];
  if (path) {
    const s = size / 24;
    const sw = 2.1;
    const off = (x: number, y: number) => `translate(${(x / s).toFixed(3)} ${(y / s).toFixed(3)})`;
    return (
      <g transform={`translate(${(c[0] - size / 2).toFixed(2)} ${(c[1] - size / 2).toFixed(2)}) scale(${s.toFixed(4)})`} fill="none" strokeLinecap="round" strokeLinejoin="round">
        {onMetal ? (
          <>
            <path d={path} stroke={ramp(metal, 1)} strokeOpacity="0.85" strokeWidth={sw} transform={off(0.55, 0.75)} />
            <path d={path} stroke={ramp(metal, 0.2)} strokeWidth={sw} />
          </>
        ) : (
          <>
            <path d={path} stroke="#000" strokeOpacity="0.45" strokeWidth={sw + 0.6} transform={off(0.9, 1.3)} />
            <path d={path} stroke={ramp(metal, 0.12)} strokeOpacity="0.9" strokeWidth={sw + 0.9} />
            <path d={path} stroke={`url(#${id('gl')})`} strokeWidth={sw} />
            <path d={path} stroke="#fff" strokeOpacity="0.6" strokeWidth={sw * 0.26} transform={off(-0.3, -0.4)} />
          </>
        )}
      </g>
    );
  }
  if (!glyph) return null;
  const fs = (glyph.length >= 3 ? 0.5 : glyph.length === 2 ? 0.68 : 0.92) * size;
  return (
    <g fontWeight="700" textAnchor="middle" fontSize={fs.toFixed(1)} style={{ fontFamily: SERIF, letterSpacing: '-0.03em' }}>
      {onMetal ? (
        <>
          <text x={c[0] + 0.6} y={c[1] + 0.85} dominantBaseline="central" fill={ramp(metal, 1)} fillOpacity="0.9">{glyph}</text>
          <text x={c[0]} y={c[1]} dominantBaseline="central" fill={ramp(metal, 0.22)}>{glyph}</text>
        </>
      ) : (
        <>
          <text x={c[0] + 0.9} y={c[1] + 1.3} dominantBaseline="central" fill="#000" fillOpacity="0.45">{glyph}</text>
          <text x={c[0]} y={c[1]} dominantBaseline="central" fill={`url(#${id('tx')})`} stroke={ramp(metal, 0.12)} strokeWidth="1.1" paintOrder="stroke">{glyph}</text>
        </>
      )}
    </g>
  );
}

/** vertieftes Emaille-Feld: Verlauf, Innenschatten oben links, Glasglanz */
function Field({ d, enamel, id, c, opal }: { d: string; enamel: string[]; id: (s: string) => string; c: V; opal?: boolean }) {
  return (
    <g>
      <path d={d} fill={`url(#${id('en')})`} />
      <g clipPath={`url(#${id('fc')})`}>
        {opal ? (
          <g fill="#fff">
            {[[c[0] - 12, c[1] - 9, 2.4], [c[0] + 13, c[1] + 7, 1.8], [c[0] + 6, c[1] - 15, 1.4], [c[0] - 14, c[1] + 12, 1.2]].map(([x, y, r], i) => (
              <path key={i} className="emb-twinkle" style={{ animationDelay: `${i * 0.7}s` }} d={`M${x} ${y - r * 2.2}Q${x} ${y} ${x + r * 2.2} ${y}Q${x} ${y} ${x} ${y + r * 2.2}Q${x} ${y} ${x - r * 2.2} ${y}Q${x} ${y} ${x} ${y - r * 2.2}Z`} />
            ))}
          </g>
        ) : null}
        {/* Innenschatten: der Rand wirft oben links einen Schatten ins Feld */}
        <path d={d} fill="none" stroke="#000" strokeOpacity={opal ? 0.18 : 0.42} strokeWidth="7" transform="translate(2.2 3)" />
        <path d={d} fill="none" stroke={ramp(enamel, 1)} strokeOpacity="0.35" strokeWidth="2.4" transform="translate(-1.2 -1.6)" />
        {/* Glas */}
        <ellipse cx={c[0] - 9} cy={c[1] - 22} rx="46" ry="26" fill={`url(#${id('gs')})`} transform={`rotate(-18 ${c[0]} ${c[1]})`} />
      </g>
    </g>
  );
}

function Defs({ id, st, ribbonTheme }: { id: (s: string) => string; st: Style; ribbonTheme?: TourTheme }) {
  const m = METAL[st.metal];
  const en = st.enamel ? ENAMEL[st.enamel] : null;
  const rb = ribbonTheme ? RIBBON[ribbonTheme] : null;
  return (
    <defs>
      {/* Zeichen aus Metall: oben hell, unten dunkler */}
      <linearGradient id={id('gl')} x1="0" y1="0" x2="0" y2="24" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor={ramp(m, 0.98)} />
        <stop offset="0.45" stopColor={ramp(m, 0.78)} />
        <stop offset="1" stopColor={ramp(m, 0.5)} />
      </linearGradient>
      <linearGradient id={id('tx')} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={ramp(m, 1)} />
        <stop offset="0.5" stopColor={ramp(m, 0.78)} />
        <stop offset="0.52" stopColor={ramp(m, 0.62)} />
        <stop offset="1" stopColor={ramp(m, 0.45)} />
      </linearGradient>
      {/* Metallfläche (Medaille, Münze) */}
      <radialGradient id={id('mf')} cx="0.36" cy="0.3" r="0.85">
        <stop offset="0" stopColor={ramp(m, 0.92)} />
        <stop offset="0.55" stopColor={ramp(m, 0.7)} />
        <stop offset="1" stopColor={ramp(m, 0.5)} />
      </radialGradient>
      {en ? (
        st.enamel === 'opal' ? (
          <linearGradient id={id('en')} x1="0.1" y1="0" x2="0.9" y2="1">
            <stop offset="0" stopColor="#ffe0f6" />
            <stop offset="0.25" stopColor="#cdeeff" />
            <stop offset="0.5" stopColor="#fff2c2" />
            <stop offset="0.75" stopColor="#e2d4ff" />
            <stop offset="1" stopColor="#b9f5ea" />
          </linearGradient>
        ) : (
          <radialGradient id={id('en')} cx="0.38" cy="0.32" r="0.9">
            <stop offset="0" stopColor={ramp(en, 0.72)} />
            <stop offset="0.6" stopColor={ramp(en, 0.5)} />
            <stop offset="1" stopColor={ramp(en, 0.28)} />
          </radialGradient>
        )
      ) : null}
      <linearGradient id={id('gs')} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity="0.42" />
        <stop offset="0.7" stopColor="#fff" stopOpacity="0.06" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <radialGradient id={id('sh')} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#000" stopOpacity="0.42" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </radialGradient>
      <linearGradient id={id('shine')} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#fff" stopOpacity="0" />
        <stop offset="0.5" stopColor="#fff" stopOpacity="0.55" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      {rb ? (
        <linearGradient id={id('rb')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={rb.base[0]} />
          <stop offset="0.18" stopColor={rb.base[1]} />
          <stop offset="0.5" stopColor={rb.base[2]} />
          <stop offset="0.72" stopColor={rb.base[3]} />
          <stop offset="1" stopColor={rb.base[1]} />
        </linearGradient>
      ) : null}
    </defs>
  );
}

// ------------------------------------------------------------------ Formen

interface Built { body: ReactNode; field?: string; fieldC: V; glyphSize: number; onMetal?: boolean; silhouette: string; shadowY: number }

function buildMedal(st: Style, id: (s: string) => string, theme: TourTheme): Built {
  const m = METAL[st.metal];
  const rb = RIBBON[theme];
  const c: V = [60, 78];
  // Band: zwei Bahnen, die sich hinter der Öse kreuzen, mit Streifen und Faltenschatten
  const strap = (top0: V, top1: V, bot0: V, bot1: V, k: string, front: boolean) => {
    const stripe = (u0: number, u1: number, color: string, op = 1) => (
      <path d={poly([lerp(top0, top1, u0), lerp(top0, top1, u1), lerp(bot0, bot1, u1), lerp(bot0, bot1, u0)])} fill={color} opacity={op} />
    );
    return (
      <g key={k}>
        {front ? <path d={poly([top0, top1, bot1, bot0])} fill="#000" opacity="0.28" transform="translate(1.6 1.4)" /> : null}
        <path d={poly([top0, top1, bot1, bot0])} fill={`url(#${id('rb')})`} />
        {stripe(0.06, 0.13, rb.edge, 0.95)}
        {stripe(0.87, 0.94, rb.edge, 0.95)}
        {stripe(0.44, 0.56, rb.stripe, 0.9)}
        {/* Stoff: zum Ende hin dunkler */}
        <path d={poly([lerp(top0, bot0, 0.55), lerp(top1, bot1, 0.55), bot1, bot0])} fill="#000" opacity={front ? 0.16 : 0.3} />
      </g>
    );
  };
  const ring: V = [60, 38];
  const outer = circlePts(c, 39.5);
  const mid = circlePts(c, 35.5);
  const inner = circlePts(c, 32);
  // Perlrand: erhabene Punkte rund um die Zahl (klassische Medaille)
  const pearls: ReactNode[] = [];
  for (let k = 0; k < 40; k++) {
    const [x, y] = polar(c, 27.2, -90 + k * 9);
    pearls.push(
      <g key={k}>
        <circle cx={(x + 0.35).toFixed(2)} cy={(y + 0.5).toFixed(2)} r="1.05" fill={ramp(m, 0.08)} opacity="0.45" />
        <circle cx={x.toFixed(2)} cy={y.toFixed(2)} r="0.95" fill={ramp(m, 0.78)} />
        <circle cx={(x - 0.3).toFixed(2)} cy={(y - 0.35).toFixed(2)} r="0.4" fill={ramp(m, 1)} />
      </g>,
    );
  }
  const body = (
    <g>
      {strap([24, -2], [49, -2], [55, 42], [66, 39], 'l', false)}
      {strap([71, -2], [96, -2], [54, 39], [65, 42], 'r', true)}
      {/* Öse */}
      <circle cx={ring[0]} cy={ring[1]} r="5" fill="none" stroke={ramp(m, 0.15)} strokeWidth="3.4" transform="translate(0.6 0.8)" opacity="0.5" />
      <circle cx={ring[0]} cy={ring[1]} r="5" fill="none" stroke={ramp(m, 0.62)} strokeWidth="2.8" />
      <path d={`M${ring[0] - 4.2} ${ring[1] - 2.6}A5 5 0 0 1 ${ring[0] + 2.4} ${ring[1] - 4.4}`} fill="none" stroke={ramp(m, 1)} strokeWidth="1" strokeLinecap="round" />
      {/* Scheibe */}
      <circle cx={c[0] + 1.2} cy={c[1] + 1.8} r="40" fill="#000" opacity="0.3" />
      {bevel(outer, mid, c, m, 'out', 'o', 0.85)}
      {/* Riffelrand */}
      <circle cx={c[0]} cy={c[1]} r="37.5" fill="none" stroke={ramp(m, 0.1)} strokeOpacity="0.32" strokeWidth="3.2" strokeDasharray="0.55 1.1" />
      {bevel(mid, inner, c, m, 'in', 'i', 0.75)}
      <circle cx={c[0]} cy={c[1]} r="32.1" fill={`url(#${id('mf')})`} />
      {pearls}
    </g>
  );
  return { body, fieldC: [60, 78.5], glyphSize: 33, onMetal: true, silhouette: poly(outer), shadowY: 117.5 };
}

function buildHex(st: Style): Built {
  const m = METAL[st.metal];
  const c: V = [60, 60];
  const o = hexPts(c, 54);
  const b1 = hexPts(c, 47.5);
  const b2 = hexPts(c, 43.5);
  return {
    body: (
      <g>
        <path d={poly(o)} fill="#000" opacity="0.3" transform="translate(1.2 1.8)" />
        {bevel(o, b1, c, m, 'out', 'o', 0.9)}
        {bevel(b1, b2, c, m, 'in', 'i', 0.8)}
      </g>
    ),
    field: poly(b2), fieldC: c, glyphSize: 46, silhouette: poly(o), shadowY: 112,
  };
}

function buildShield(st: Style): Built {
  const m = METAL[st.metal];
  const o = SHIELD_PTS;
  const b1 = scaleTo(o, SHIELD_C, 0.885);
  const b2 = scaleTo(o, SHIELD_C, 0.82);
  return {
    body: (
      <g>
        <path d={poly(o)} fill="#000" opacity="0.3" transform="translate(1.2 1.8)" />
        {bevel(o, b1, SHIELD_C, m, 'out', 'o', 0.85)}
        {bevel(b1, b2, SHIELD_C, m, 'in', 'i', 0.78)}
      </g>
    ),
    field: poly(b2), fieldC: [60, 57], glyphSize: 44, silhouette: poly(o), shadowY: 117,
  };
}

function buildRosette(st: Style): Built {
  const m = METAL[st.metal];
  const en = ENAMEL[st.enamel ?? 'slate'];
  const c: V = [60, 60];
  const coin = circlePts(c, 35);
  const c1 = circlePts(c, 31);
  const c2 = circlePts(c, 28);
  return {
    body: (
      <g>
        <circle cx={c[0] + 1.2} cy={c[1] + 1.8} r="55" fill="#000" opacity="0.25" />
        {pleats(c, 30, 52, 36, en, 'p')}
        <circle cx={c[0] + 0.8} cy={c[1] + 1.4} r="35.5" fill="#000" opacity="0.35" />
        {bevel(coin, c1, c, m, 'out', 'o', 0.85)}
        {bevel(c1, c2, c, m, 'in', 'i', 0.75)}
      </g>
    ),
    field: poly(c2), fieldC: c, glyphSize: 34, onMetal: !st.enamel || st.enamel === 'slate', silhouette: poly(circlePts(c, 54.5, 36)), shadowY: 113,
  };
}

function buildStar(st: Style): Built {
  const m = METAL[st.metal];
  const c: V = [60, 60];
  const med = circlePts(c, 32);
  const m1 = circlePts(c, 28);
  const m2 = circlePts(c, 25);
  // Umriss der Strahlen (für Schatten und Glanz): je Strahl ein Viereck, alle im selben Drehsinn
  const rays = (n: number, rTip: number, rBase: number, half: number, offset: number) => Array.from({ length: n }, (_, i) => {
    const a = offset - 90 + (360 * i) / n;
    return poly([polar(c, rBase, a - half), polar(c, rTip, a), polar(c, rBase, a + half), polar(c, rBase * 0.35, a)]);
  }).join('');
  const outline = rays(8, 47, 26, 17, 22.5) + rays(8, 57.5, 27, 14, 0) + poly(med);
  return {
    body: (
      <g>
        <path d={outline} fill="#000" opacity="0.3" transform="translate(1.2 1.8)" />
        {starRays(c, 8, 47, 26, 17, 22.5, m, 's')}
        {starRays(c, 8, 57.5, 27, 14, 0, m, 'l')}
        <circle cx={c[0] + 0.8} cy={c[1] + 1.4} r="32.6" fill="#000" opacity="0.4" />
        {bevel(med, m1, c, m, 'out', 'o', 0.85)}
        {bevel(m1, m2, c, m, 'in', 'i', 0.75)}
      </g>
    ),
    field: poly(m2), fieldC: c, glyphSize: 30, silhouette: outline, shadowY: 112,
  };
}

const JERSEY_BODY = 'M44 15.5 52.5 11.5Q60 16.8 67.5 11.5L76 15.5 98.5 29Q102 31.3 100.4 34.9L93.6 49Q92 52.2 88.8 50.6L84.2 48.2 85 103.5Q85 108 80.6 108H39.4Q35 108 35 103.5L35.8 48.2 31.2 50.6Q28 52.2 26.4 49L19.6 34.9Q18 31.3 21.5 29Z';

function buildJersey(st: Style, id: (s: string) => string, number: string): Built {
  const j = st.jersey!;
  const g = (s: string) => id(`j${s}`);
  const body = (
    <g>
      <defs>
        <linearGradient id={g('b')} x1="30" y1="0" x2="90" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={j.base[1]} />
          <stop offset="0.22" stopColor={j.base[2]} />
          <stop offset="0.42" stopColor={j.base[3]} />
          <stop offset="0.62" stopColor={j.base[2]} />
          <stop offset="1" stopColor={j.base[1]} />
        </linearGradient>
        <linearGradient id={g('v')} x1="0" y1="10" x2="0" y2="108" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.28" />
        </linearGradient>
        <clipPath id={g('c')}><path d={JERSEY_BODY} /></clipPath>
        <pattern id={g('w')} width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <rect width="2.4" height="1.1" fill="#fff" opacity="0.07" />
        </pattern>
      </defs>
      <path d={JERSEY_BODY} fill="#000" opacity="0.3" transform="translate(1.4 2)" />
      <path d={JERSEY_BODY} fill={`url(#${g('b')})`} />
      <g clipPath={`url(#${g('c')})`}>
        {/* Ärmel etwas dunkler, Bündchen in Kontrastfarbe */}
        <path d="M21.5 29 44 15.5 35.8 48.2 31.2 50.6Q28 52.2 26.4 49L19.6 34.9Q18 31.3 21.5 29Z" fill="#000" opacity="0.14" />
        <path d="M98.5 29 76 15.5 84.2 48.2 88.8 50.6Q92 52.2 93.6 49L100.4 34.9Q102 31.3 98.5 29Z" fill="#000" opacity="0.2" />
        <path d="M17 36.5 31.5 54.5 36 50 24 33Z" fill={j.trim} />
        <path d="M103 36.5 88.5 54.5 84 50 96 33Z" fill={j.trim} />
        <path d="M18.6 39.5 32.8 54 34.2 52.6 20.2 37.4Z" fill={j.trimEdge} opacity="0.7" />
        <path d="M101.4 39.5 87.2 54 85.8 52.6 99.8 37.4Z" fill={j.trimEdge} opacity="0.7" />
        {/* Seitenteile */}
        <path d="M35.8 48 41 52 40 108H30Z" fill="#000" opacity="0.12" />
        <path d="M84.2 48 79 52 80 108H90Z" fill="#000" opacity="0.18" />
        {/* Falten */}
        <path d="M44 70Q52 74 49 92" fill="none" stroke="#000" strokeOpacity="0.1" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M71 64Q66 78 72 96" fill="none" stroke="#000" strokeOpacity="0.1" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M46 68Q53 72 51 88" fill="none" stroke="#fff" strokeOpacity="0.16" strokeWidth="1.2" strokeLinecap="round" />
        {/* Saum */}
        <path d="M30 101H90V110H30Z" fill={j.trim} />
        <path d="M30 101H90V102.4H30Z" fill={j.trimEdge} opacity="0.6" />
        <path d={JERSEY_BODY} fill={`url(#${g('w')})`} />
        <path d={JERSEY_BODY} fill={`url(#${g('v')})`} />
      </g>
      {/* Kragen und Reißverschluss */}
      <path d="M52.5 11.5Q60 16.8 67.5 11.5L69.6 12.6Q60 21 50.4 12.6Z" fill={j.trim} />
      <path d="M50.4 12.6Q60 21 69.6 12.6" fill="none" stroke={j.trimEdge} strokeOpacity="0.7" strokeWidth="0.8" />
      <path d="M60 16.5V62" stroke="#000" strokeOpacity="0.28" strokeWidth="1.1" />
      <path d="M60.6 16.5V62" stroke="#fff" strokeOpacity="0.3" strokeWidth="0.5" />
      <rect x="58.4" y="18" width="3.2" height="5.2" rx="1" fill={ramp(METAL.silver, 0.8)} stroke={ramp(METAL.silver, 0.3)} strokeWidth="0.4" />
      <path d={JERSEY_BODY} fill="none" stroke={j.base[0]} strokeOpacity="0.6" strokeWidth="0.8" />
      {number ? (
        <g>
          <circle cx="60" cy="66" r="15" fill="#000" opacity="0.18" transform="translate(0.8 1.2)" />
          <circle cx="60" cy="66" r="15" fill="#fff" />
          <circle cx="60" cy="66" r="13" fill="none" stroke={j.base[1]} strokeWidth="1.2" />
          <text x="60" y="66.5" dominantBaseline="central" textAnchor="middle" fontWeight="800" fontSize="19" fill={j.base[0]} style={{ fontFamily: SERIF }}>{number}</text>
        </g>
      ) : null}
    </g>
  );
  return { body, fieldC: [60, 66], glyphSize: 0, silhouette: JERSEY_BODY, shadowY: 112 };
}

// ------------------------------------------------------------------ Bild

export function EmblemArt({ look, size = 64, shine = true, className, title }: { look: Look; size?: number; shine?: boolean; className?: string; title?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const id = (s: string) => `e${uid}${s}`;
  const st = STYLE[look.tone];
  const metal = METAL[st.metal];
  const b: Built =
    look.shape === 'medal' ? buildMedal(st, id, look.ribbon ?? 'neutral')
      : look.shape === 'hex' ? buildHex(st)
        : look.shape === 'shield' ? buildShield(st)
          : look.shape === 'round' ? buildRosette(st)
            : look.shape === 'star' ? buildStar(st)
              : buildJersey(st, id, look.glyph);
  const enamel = st.enamel ? ENAMEL[st.enamel] : null;
  const fieldOnMetal = b.onMetal || !enamel;

  return (
    <svg
      className={cx('emb-art', `emb-art--${look.tone}`, className)}
      width={size} height={size} viewBox="0 0 120 120" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}
    >
      <Defs id={id} st={st} ribbonTheme={look.shape === 'medal' ? look.ribbon ?? 'neutral' : undefined} />
      {b.field ? <defs><clipPath id={id('fc')}><path d={b.field} /></clipPath></defs> : null}
      <defs><clipPath id={id('clip')}><path d={b.silhouette} /></clipPath></defs>

      {/* Schatten auf dem Untergrund */}
      <ellipse cx="60" cy={b.shadowY} rx="34" ry="4.2" fill={`url(#${id('sh')})`} />
      {b.body}
      <path d={b.silhouette} fill="none" stroke="#000" strokeOpacity="0.22" strokeWidth="0.8" />
      {b.field ? (
        fieldOnMetal
          ? <path d={b.field} fill={`url(#${id('mf')})`} />
          : <Field d={b.field} enamel={enamel!} id={id} c={b.fieldC} opal={st.enamel === 'opal'} />
      ) : null}
      {look.shape !== 'jersey' ? <Glyph glyph={look.glyph} c={b.fieldC} size={b.glyphSize} metal={metal} id={id} onMetal={fieldOnMetal} /> : null}

      {shine ? (
        <g clipPath={`url(#${id('clip')})`} style={{ mixBlendMode: 'soft-light' }}>
          <rect className="emb-art__shine" x="-46" y="-20" width="34" height="160" fill={`url(#${id('shine')})`} transform="skewX(-18)" />
        </g>
      ) : null}
    </svg>
  );
}
