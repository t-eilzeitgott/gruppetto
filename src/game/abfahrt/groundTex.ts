/**
 * Böden der Straßen und Orte: Pflasterarten, Gehwege, Bordsteine, Rinnen, Gullideckel, Bankett und Asphalt –
 * prozedural und nahtlos kachelbar. Organisch statt Raster: jeder Stein mit eigener Farbe und Form, Abrieb an den
 * Kanten, Sand und Schmutz in den Fugen, großflächige Flecken (Öl, Nässe, Staub), hier und da ein gesprungener
 * oder abgesackter Stein.
 *
 * Zu jeder Farbtextur auf Wunsch eine Höhenkarte (hell = hoch): Fugen tief, Steine gewölbt – damit fällt das Licht
 * auf Kanten und Buckel (Relief, ab Stufe 7). Ohne Höhenkarte steckt die Wölbung als Licht und Schatten in der Farbe.
 */
import { mulberry32, type Rng } from './rng';

export interface GroundTex {
  color: HTMLCanvasElement;
  height: HTMLCanvasElement | null;
  /** Größe einer Kachel in Metern (längs u, quer v – bei Bordstein und Rinne: längs, quer übers Profil) */
  size: number;
}

type C2 = CanvasRenderingContext2D;
type RGB = [number, number, number];
interface Painter {
  c: C2; h: C2 | null; W: number; H: number; r: Rng; color: HTMLCanvasElement; height: HTMLCanvasElement | null;
  /** feine Punkte, gesammelt und erst in finish() direkt in die Bildpunkte gemischt (je Punkt kein Zeichenaufruf):
   *  x, y, Größe, r, g, b, Deckkraft; hd: Punkte in der Höhenkarte (x, y, Größe, Höhe) */
  dots: number[];
  hd: number[];
}

/**
 * Zwischenspeicher der gemalten Texturen: dieselbe Gegend beim nächsten Start (neue Fahrt, anderes Spiel) ohne
 * neues Malen. Höchstens 14 Stück (je ~1 MB), die ältesten fliegen raus.
 */
const memo = new Map<string, unknown>();
export function groundCached<T>(key: string, f: () => T): T {
  const hit = memo.get(key);
  if (hit !== undefined) { memo.delete(key); memo.set(key, hit); return hit as T; }
  const v = f();
  memo.set(key, v);
  while (memo.size > 14) memo.delete(memo.keys().next().value as string);
  return v;
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function painter(W: number, H: number, bump: boolean, seed: number, bg: RGB, hbg = 0): Painter {
  const color = canvas(W, H);
  const c = color.getContext('2d')!;
  c.fillStyle = css(bg);
  c.fillRect(0, 0, W, H);
  let height: HTMLCanvasElement | null = null;
  let h: C2 | null = null;
  if (bump) {
    height = canvas(W, H);
    h = height.getContext('2d')!;
    h.fillStyle = grey(hbg);
    h.fillRect(0, 0, W, H);
  }
  return { c, h, W, H, r: mulberry32(seed), color, height, dots: [], hd: [] };
}

/** Punkt vormerken (Farbe 0–255, Deckkraft 0–1) */
function dot(p: Painter, x: number, y: number, s: number, c: RGB | number[], a: number) {
  p.dots.push(x, y, s, c[0], c[1], c[2], a);
}

/** gesammelte Punkte in die Bildpunkte mischen (nahtlos: über den Rand hinaus auf der Gegenseite) */
function applyDots(d: Uint8ClampedArray, W: number, H: number, list: number[], stride: number) {
  for (let i = 0; i < list.length; i += stride) {
    const x0 = Math.floor(list[i]), y0 = Math.floor(list[i + 1]);
    const n = Math.max(1, Math.round(list[i + 2]));
    const a = stride === 7 ? list[i + 6] : 1;
    const r = list[i + 3], g = stride === 7 ? list[i + 4] : r, b = stride === 7 ? list[i + 5] : r;
    for (let yy = 0; yy < n; yy++) {
      const y = (((y0 + yy) % H) + H) % H;
      for (let xx = 0; xx < n; xx++) {
        const x = (((x0 + xx) % W) + W) % W;
        const k = (y * W + x) * 4;
        d[k] += (r - d[k]) * a;
        d[k + 1] += (g - d[k + 1]) * a;
        d[k + 2] += (b - d[k + 2]) * a;
      }
    }
  }
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const css = (c: RGB, k = 1, a = 1) => (a >= 1 ? `rgb(${clamp255(c[0] * k)},${clamp255(c[1] * k)},${clamp255(c[2] * k)})` : `rgba(${clamp255(c[0] * k)},${clamp255(c[1] * k)},${clamp255(c[2] * k)},${a.toFixed(3)})`);
const grey = (v: number, a = 1) => (a >= 1 ? `rgb(${clamp255(v)},${clamp255(v)},${clamp255(v)})` : `rgba(${clamp255(v)},${clamp255(v)},${clamp255(v)},${a.toFixed(3)})`);
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const pickC = <T>(r: Rng, l: readonly T[]): T => l[Math.floor(r() * l.length) % l.length];

/** an den Rändern zusätzlich auf der Gegenseite zeichnen (nahtlos) */
function wrap(p: Painter, x: number, y: number, m: number, draw: (x: number, y: number) => void) {
  const xs = x < m ? [0, p.W] : x > p.W - m ? [0, -p.W] : [0];
  const ys = y < m ? [0, p.H] : y > p.H - m ? [0, -p.H] : [0];
  for (const dx of xs) for (const dy of ys) draw(x + dx, y + dy);
}

/**
 * Periodisches Wertrauschen (fbm) über die ganze Textur, 0 … 1: Flecken, die nahtlos weiterlaufen. cells: Zellen
 * auf der Breite (die Höhe im selben Verhältnis), oct: Oktaven
 */
function tileNoise(W: number, H: number, cells: number, oct: number, seed: number): Float32Array {
  const out = new Float32Array(W * H);
  let amp = 1;
  let sum = 0;
  for (let o = 0; o < oct; o++) {
    const cx = cells << o;
    const cy = Math.max(1, Math.round((cells * H) / W)) << o;
    const r = mulberry32(seed + o * 7919);
    const g = new Float32Array(cx * cy);
    for (let i = 0; i < g.length; i++) g[i] = r();
    for (let y = 0; y < H; y++) {
      const fy = (y / H) * cy;
      const y0 = Math.floor(fy);
      let ty = fy - y0;
      ty = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % cy) * cx;
      const r1 = ((y0 + 1) % cy) * cx;
      for (let x = 0; x < W; x++) {
        const fx = (x / W) * cx;
        const x0 = Math.floor(fx);
        let tx = fx - x0;
        tx = tx * tx * (3 - 2 * tx);
        const x1 = (x0 + 1) % cx;
        const a = g[r0 + x0] + (g[r0 + x1] - g[r0 + x0]) * tx;
        const b = g[r1 + x0] + (g[r1 + x1] - g[r1 + x0]) * tx;
        out[y * W + x] += (a + (b - a) * ty) * amp;
      }
    }
    sum += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= sum;
  return out;
}

/**
 * Zum Schluss: großflächige Flecken (heller/dunkler, etwas wärmer/kälter) und feines Korn über alles – so wirkt
 * keine Fläche frisch gedruckt
 */
function finish(p: Painter, o: { blot?: number; warm?: number; grain?: number; cells?: number; seed?: number } = {}) {
  const { W, H } = p;
  const img = p.c.getImageData(0, 0, W, H);
  const d = img.data;
  applyDots(d, W, H, p.dots, 7);
  p.dots = [];
  if (p.h && p.hd.length) {
    const hi = p.h.getImageData(0, 0, W, H);
    applyDots(hi.data, W, H, p.hd, 4);
    p.h.putImageData(hi, 0, 0);
    p.hd = [];
  }
  const blot = o.blot ?? 0.22;
  const warm = o.warm ?? 0.06;
  const gr = o.grain ?? 14;
  const n1 = blot > 0 ? tileNoise(W, H, o.cells ?? 3, 3, (o.seed ?? 1) * 31 + 5) : null;
  const n2 = warm > 0 ? tileNoise(W, H, (o.cells ?? 3) + 2, 2, (o.seed ?? 1) * 37 + 11) : null;
  const r = p.r;
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const k = n1 ? 1 + (n1[j] - 0.5) * 2 * blot : 1;
    const w = n2 ? (n2[j] - 0.5) * 2 * warm : 0;
    const g = (r() - 0.5) * gr;
    d[i] = clamp255(d[i] * k * (1 + w) + g);
    d[i + 1] = clamp255(d[i + 1] * k + g);
    d[i + 2] = clamp255(d[i + 2] * k * (1 - w) + g);
  }
  p.c.putImageData(img, 0, 0);
}

/** Feine Punkte (Granitkörner, Sand, Splitt): n Stück, Farben 'rgba(r,g,b,a)' */
function speckle(p: Painter, n: number, cols: string[], s0 = 0.8, s1 = 2) {
  const { r, W, H } = p;
  const pc = cols.map((c) => { const m = /rgba?\(([^)]+)\)/.exec(c); const v = m ? m[1].split(',').map(Number) : [0, 0, 0, 1]; return [v[0], v[1], v[2], v[3] ?? 1]; });
  for (let i = 0; i < n; i++) {
    const c = pc[Math.floor(r() * pc.length)];
    dot(p, r() * W, r() * H, s0 + r() * (s1 - s0), c, c[3]);
  }
}

/** Umriss eines Steins: Vieleck mit gerundeten Ecken */
function stonePath(c: C2, pts: [number, number][], rad: number) {
  c.beginPath();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % n];
    const [cx, cy] = pts[(i + 2) % n];
    if (i === 0) c.moveTo((ax + bx) / 2, (ay + by) / 2);
    c.arcTo(bx, by, (bx + cx) / 2, (by + cy) / 2, rad);
  }
  c.closePath();
}

/** unregelmäßiges Rechteck um (cx, cy): Breite w, Höhe h, gedreht um rot, Ecken verrückt um jit */
function quadPts(r: Rng, cx: number, cy: number, w: number, h: number, rot: number, jit: number): [number, number][] {
  const co = Math.cos(rot), si = Math.sin(rot);
  const base: [number, number][] = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  return base.map(([x, y]) => {
    const xx = x + (r() - 0.5) * jit * 2;
    const yy = y + (r() - 0.5) * jit * 2;
    return [cx + xx * co - yy * si, cy + xx * si + yy * co] as [number, number];
  });
}

interface StoneOpts {
  rad: number;
  /** Wölbung im Licht (0 flach … 1 stark), Höhe (0–255) in der Mitte und am Rand */
  dome?: number;
  hTop?: number;
  hEdge?: number;
  /** Flecken je Stein, Kantenschatten */
  blots?: number;
  edge?: number;
  /** Rillen (Steinmetz) quer über den Stein: Winkel, Abstand */
  grooves?: [number, number];
  /** eigene Saat: Kopien an den Rändern der Kachel sehen genau gleich aus */
  seed?: number;
}

/** einen Stein zeichnen: Farbe mit Wölbung, Flecken und Kante; Höhe als Kuppe */
function stone(p: Painter, pts: [number, number][], col: RGB, o: StoneOpts) {
  const { c, h } = p;
  const r = o.seed !== undefined ? mulberry32(o.seed) : p.r;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const w = x1 - x0, hh = y1 - y0;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  c.save();
  stonePath(c, pts, o.rad);
  c.fillStyle = css(col);
  c.fill();
  c.clip();
  const dome = o.dome ?? 0.6;
  if (dome > 0) {
    // Licht von oben links, Schatten unten rechts; die Mitte poliert
    const lg = c.createLinearGradient(x0, y0, x1, y1);
    lg.addColorStop(0, `rgba(255,250,240,${(0.2 * dome).toFixed(3)})`);
    lg.addColorStop(0.45, 'rgba(255,255,255,0)');
    lg.addColorStop(1, `rgba(0,0,0,${(0.28 * dome).toFixed(3)})`);
    c.fillStyle = lg;
    c.fillRect(x0 - 2, y0 - 2, w + 4, hh + 4);
  }
  for (let k = 0; k < (o.blots ?? 3); k++) {
    c.fillStyle = r() < 0.55 ? `rgba(0,0,0,${(0.05 + r() * 0.08).toFixed(3)})` : `rgba(255,248,235,${(0.04 + r() * 0.07).toFixed(3)})`;
    c.beginPath();
    c.ellipse(x0 + r() * w, y0 + r() * hh, 1.5 + r() * w * 0.3, 1 + r() * hh * 0.25, r() * 3, 0, Math.PI * 2);
    c.fill();
  }
  if (o.grooves) {
    const [ang, gap] = o.grooves;
    c.strokeStyle = 'rgba(0,0,0,0.13)';
    c.lineWidth = 1;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const R = Math.hypot(w, hh);
    for (let t = -R; t < R; t += gap * (0.8 + r() * 0.4)) {
      c.beginPath();
      c.moveTo(cx - dx * R - dy * t, cy - dy * R + dx * t);
      c.lineTo(cx + dx * R - dy * t, cy + dy * R + dx * t);
      c.stroke();
    }
  }
  c.restore();
  if ((o.edge ?? 0.25) > 0) {
    // abgeriebene Kante: dunkler Saum
    stonePath(c, pts, o.rad);
    c.strokeStyle = `rgba(0,0,0,${(o.edge ?? 0.25).toFixed(3)})`;
    c.lineWidth = 1.4;
    c.stroke();
  }
  if (h) {
    stonePath(h, pts, o.rad);
    const R = Math.max(w, hh) * 0.62;
    const rg = h.createRadialGradient(cx + (r() - 0.5) * w * 0.2, cy + (r() - 0.5) * hh * 0.2, R * 0.15, cx, cy, R);
    const top = (o.hTop ?? 225) - r() * 30;
    rg.addColorStop(0, grey(top));
    rg.addColorStop(0.7, grey(top - 30));
    rg.addColorStop(1, grey(o.hEdge ?? 110));
    h.fillStyle = rg;
    h.fill();
  }
}

// ------------------------------------------------------------------ Pflaster

/** Farben der Steine je Gestein */
const STONE: Record<string, RGB[]> = {
  granite: [[128, 127, 125], [142, 138, 131], [116, 115, 116], [150, 140, 128], [106, 106, 110], [134, 131, 127], [158, 150, 138]],
  graniteBlue: [[112, 114, 120], [126, 124, 122], [100, 102, 108], [136, 130, 120], [92, 92, 96], [118, 116, 114], [146, 138, 126]],
  basalt: [[76, 77, 80], [88, 88, 90], [70, 71, 75], [96, 95, 94], [82, 80, 80], [102, 100, 98]],
  porphyry: [[134, 100, 88], [120, 94, 92], [108, 98, 98], [142, 112, 94], [98, 86, 84], [126, 108, 106], [150, 122, 104]],
  light: [[182, 176, 166], [168, 164, 158], [190, 182, 168], [174, 166, 152], [160, 158, 154], [196, 188, 174]],
  sandstone: [[150, 140, 124], [138, 132, 122], [124, 120, 114], [160, 148, 128], [132, 124, 110], [146, 142, 136]],
  serena: [[146, 150, 152], [134, 140, 144], [156, 158, 156], [126, 130, 134], [162, 160, 152]],
  pebble: [[214, 208, 196], [176, 172, 166], [196, 176, 142], [150, 148, 146], [128, 130, 136], [206, 196, 176], [170, 150, 120]],
};

export type CobbleKind = 'pave' | 'setts' | 'sampietrini' | 'porfido' | 'adoquin' | 'ciottoli' | 'lastricato';

/**
 * Pflaster der Fahrbahn
 * - pave: Pavé aus dem Norden – große, grob behauene Granitsteine in welligen Reihen, breite sandige Fugen, Matsch
 * - setts: Großpflaster in geraden Reihen (Alpen, Pyrenäen, Po-Ebene), Granit mit Körnern
 * - sampietrini: kleine Basaltwürfel in Bögen (Rom, Küste)
 * - porfido: Porphyr in Bögen, rot, violett und grau (Trentino, Südtirol)
 * - adoquin: rechteckige helle Granitblöcke im Verband (Spanien)
 * - ciottoli: hochkant gesetzte Flusskiesel (Calade der Provence, Empedrado Andalusiens, Kiesel der Po-Städte)
 * - lastricato: große Steinplatten mit Steinmetzrillen (Florenz, Neapel)
 */
export function cobbleTex(kind: CobbleKind, bump: boolean): GroundTex {
  switch (kind) {
    case 'pave': return rowsCobble(bump, { seed: 51, size: 2.4, rows: [32, 46], wMul: [1.0, 1.7], gap: 5, jit: 4.5, wave: 4, tilt: 0.09, rad: 9, tones: STONE.graniteBlue, joint: [86, 78, 64], dirt: 0.55, sink: 0.07, dome: 0.85 });
    case 'setts': return rowsCobble(bump, { seed: 52, size: 2.0, rows: [27, 31], wMul: [1.0, 1.45], gap: 3, jit: 2, wave: 1, tilt: 0.03, rad: 5, tones: STONE.granite, joint: [110, 102, 90], dirt: 0.25, sink: 0.03, dome: 0.65 });
    case 'adoquin': return rowsCobble(bump, { seed: 53, size: 2.0, rows: [26, 26], wMul: [2.0, 2.3], gap: 2.4, jit: 0.8, wave: 0, tilt: 0.01, rad: 3, tones: STONE.light, joint: [96, 92, 86], dirt: 0.15, sink: 0.02, dome: 0.35, bond: true });
    case 'sampietrini': return arcCobble(bump, { seed: 54, size: 2.0, s: 31, R: 230, tones: STONE.basalt, joint: [58, 54, 48], polish: 0.3 });
    case 'porfido': return arcCobble(bump, { seed: 55, size: 1.8, s: 25, R: 200, tones: STONE.porphyry, joint: [92, 82, 72], polish: 0.12 });
    case 'ciottoli': return pebbleCobble(bump);
    case 'lastricato': return flagCobble(bump, { seed: 57, size: 3.0, tones: STONE.sandstone, joint: [70, 64, 56], grooves: true });
  }
}

interface RowOpts {
  seed: number; size: number; rows: [number, number]; wMul: [number, number]; gap: number; jit: number; wave: number; tilt: number;
  rad: number; tones: RGB[]; joint: RGB; dirt: number; sink: number; dome: number; bond?: boolean;
}

/** Pflaster in Reihen (Pavé, Großpflaster, Blöcke im Verband) */
function rowsCobble(bump: boolean, o: RowOpts): GroundTex {
  const S = 512;
  const p = painter(S, S, bump, o.seed, o.joint, 18);
  const { c, r } = p;
  // Sand und Erde in den Fugen
  speckle(p, 3800, [css(o.joint, 1.45, 0.4), css(o.joint, 0.6, 0.35), 'rgba(170,150,110,0.3)'], 1, 2.4);
  // Reihenhöhen, die genau aufgehen (nahtlos)
  const rows: number[] = [];
  let sum = 0;
  while (sum < S) { const hh = o.rows[0] + r() * (o.rows[1] - o.rows[0]); rows.push(hh); sum += hh; }
  const k = S / sum;
  let y = 0;
  rows.forEach((rh0, ri) => {
    const rh = rh0 * k;
    let x = o.bond ? (ri % 2) * rh * (o.wMul[0] + o.wMul[1]) * 0.25 : -r() * rh;
    const xEnd = x + S;
    // Breiten der Reihe so, dass sie genau aufgehen
    const ws: number[] = [];
    let sw = 0;
    while (sw < S) { const w = rh * (o.wMul[0] + r() * (o.wMul[1] - o.wMul[0])); ws.push(w); sw += w; }
    const kw = S / sw;
    for (const w0 of ws) {
      const w = w0 * kw;
      const t = pickC(r, o.tones);
      let v = 0.84 + r() * 0.3;
      // manche Steine schmutziger oder abgesackt (dunkler, tiefer)
      const sunk = r() < o.sink;
      if (sunk) v *= 0.82;
      const col = mix(t, [74, 66, 54], r() * o.dirt * 0.35);
      const cx = x + w / 2;
      const cy = y + rh / 2 + (r() - 0.5) * o.wave;
      const pts = quadPts(r, 0, 0, w - o.gap, rh - o.gap, (r() - 0.5) * o.tilt * 2, o.jit);
      const so: StoneOpts = { rad: o.rad * (0.7 + r() * 0.6), dome: o.dome, hTop: sunk ? 175 : 228, hEdge: sunk ? 70 : 105, blots: 3, seed: Math.floor(r() * 1e9) };
      const draw = (dx: number, dy: number) => stone(p, pts.map(([a, b]) => [a + cx + dx, b + cy + dy] as [number, number]), [col[0] * v, col[1] * v, col[2] * v], so);
      draw(0, 0);
      if (cx + w > S) draw(-S, 0);
      if (cx - w < 0) draw(S, 0);
      if (cy + rh > S - 2) draw(0, -S);
      if (cy - rh < 2) draw(0, S);
      x += w;
      if (x >= xEnd) break;
    }
    y += rh;
  });
  // Matsch und Moos in Fugen und an Rändern (großflächig)
  if (o.dirt > 0.3) {
    for (let i = 0; i < 26; i++) {
      const x = r() * S, yy = r() * S, rr = 18 + r() * 50;
      wrap(p, x, yy, rr, (a, b) => {
        const g = c.createRadialGradient(a, b, 0, a, b, rr);
        g.addColorStop(0, `rgba(70,62,46,${(0.12 + r() * 0.12).toFixed(3)})`);
        g.addColorStop(1, 'rgba(70,62,46,0)');
        c.fillStyle = g;
        c.fillRect(a - rr, b - rr, rr * 2, rr * 2);
      });
    }
  }
  speckle(p, 2600, ['rgba(255,255,255,0.18)', 'rgba(0,0,0,0.2)', 'rgba(220,180,160,0.14)'], 0.8, 1.6);
  finish(p, { blot: 0.16, warm: 0.05, grain: 12, seed: o.seed });
  return { color: p.color, height: p.height, size: o.size };
}

interface ArcOpts { seed: number; size: number; s: number; R: number; tones: RGB[]; joint: RGB; polish: number }

/**
 * Segmentbogenpflaster: Reihen kleiner Würfel auf Kreisbögen (zwei Bögen auf der Breite der Kachel); die Bögen
 * stoßen in einem flachen V aneinander. Nahtlos, weil sich das Muster nach einer Steinhöhe wiederholt.
 */
function arcCobble(bump: boolean, o: ArcOpts): GroundTex {
  const S = 512;
  const p = painter(S, S, bump, o.seed, o.joint, 15);
  const { r } = p;
  speckle(p, 3000, [css(o.joint, 1.5, 0.4), css(o.joint, 0.6, 0.3)], 1, 2);
  const A = S / 2;
  const bands = Math.round(S / o.s);
  const s = S / bands;
  for (let b = 0; b < bands; b++) {
    for (let j = 0; j < 2; j++) {
      const cx = j * A + A / 2;
      const yb = b * s;
      // Steine längs des Bogens: Bogenlänge in Schritten einer Steinbreite
      const half = A / 2;
      const th0 = Math.asin(Math.min(0.999, half / o.R));
      const L = 2 * th0 * o.R;
      const n = Math.max(3, Math.round(L / s));
      for (let q = 0; q < n; q++) {
        const th = -th0 + ((q + 0.5) / n) * 2 * th0;
        const x = cx + Math.sin(th) * o.R;
        const y = yb + o.R - Math.cos(th) * o.R;
        const w = (L / n) * (0.86 + r() * 0.12);
        const hgt = s * (0.84 + r() * 0.1);
        const t = pickC(r, o.tones);
        const v = 0.85 + r() * 0.3;
        const pts = quadPts(r, 0, 0, w - 2.2, hgt - 2.2, th + (r() - 0.5) * 0.12, 1.6);
        const col: RGB = [t[0] * v, t[1] * v, t[2] * v];
        const so: StoneOpts = { rad: 3.5 + r() * 2, dome: 0.55, blots: 2, edge: 0.3, seed: Math.floor(r() * 1e9) };
        wrap(p, x, y, s * 1.5, (ax, ay) => stone(p, pts.map(([a, bb]) => [a + ax, bb + ay] as [number, number]), col, so));
      }
    }
  }
  // polierte Fahrspuren (Basalt glänzt, wo die Reifen rollen)
  if (o.polish > 0) {
    const { c } = p;
    for (const xc of [S * 0.27, S * 0.73]) {
      const g = c.createLinearGradient(xc - 70, 0, xc + 70, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, `rgba(255,255,255,${o.polish * 0.25})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(xc - 70, 0, 140, S);
    }
  }
  speckle(p, 2200, ['rgba(255,255,255,0.14)', 'rgba(0,0,0,0.2)'], 0.8, 1.5);
  finish(p, { blot: 0.18, warm: 0.05, grain: 12, seed: o.seed });
  return { color: p.color, height: p.height, size: o.size };
}

/** Flusskiesel hochkant in Reihen, schräg wie Fischgrät, Erde und Mörtel dazwischen */
function pebbleCobble(bump: boolean): GroundTex {
  const S = 512;
  const p = painter(S, S, bump, 56, [150, 132, 104], 30);
  const { c, r } = p;
  speckle(p, 4000, ['rgba(110,92,66,0.4)', 'rgba(200,184,150,0.35)'], 1, 2.2);
  const rowH = 16;
  const rows = Math.round(S / rowH);
  const rh = S / rows;
  for (let ri = 0; ri < rows; ri++) {
    const ang = (ri % 2 ? 1 : -1) * (0.5 + r() * 0.15);
    let x = -r() * 20;
    while (x < S) {
      const len = 20 + r() * 14;
      const wid = 9 + r() * 6;
      const step = wid * 1.12 / Math.cos(ang) * 0.95;
      const cx = x + step / 2;
      const cy = ri * rh + rh / 2 + (r() - 0.5) * 3;
      const t = pickC(r, STONE.pebble);
      const v = 0.86 + r() * 0.24;
      const col: RGB = [t[0] * v, t[1] * v, t[2] * v];
      const rot = Math.PI / 2 + ang + (r() - 0.5) * 0.25;
      const hTop = 240 - r() * 30;
      const draw = (a: number, b: number) => {
        c.save();
        c.translate(a, b);
        c.rotate(rot);
        c.beginPath();
        c.ellipse(0, 0, len / 2, wid / 2, 0, 0, Math.PI * 2);
        c.fillStyle = css(col);
        c.fill();
        const g = c.createLinearGradient(-len / 2, -wid / 2, len / 2, wid / 2);
        g.addColorStop(0, 'rgba(255,252,240,0.25)');
        g.addColorStop(0.5, 'rgba(255,255,255,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.3)');
        c.fillStyle = g;
        c.fill();
        c.strokeStyle = 'rgba(40,30,20,0.3)';
        c.lineWidth = 1.2;
        c.stroke();
        c.restore();
        if (p.h) {
          p.h.save();
          p.h.translate(a, b);
          p.h.rotate(rot);
          const hg = p.h.createRadialGradient(0, 0, 1, 0, 0, len / 2);
          hg.addColorStop(0, grey(hTop));
          hg.addColorStop(1, grey(90));
          p.h.fillStyle = hg;
          p.h.beginPath();
          p.h.ellipse(0, 0, len / 2, wid / 2, 0, 0, Math.PI * 2);
          p.h.fill();
          p.h.restore();
        }
      };
      wrap(p, cx, cy, 24, draw);
      x += step;
    }
  }
  finish(p, { blot: 0.2, warm: 0.07, grain: 12, seed: 56 });
  return { color: p.color, height: p.height, size: 1.6 };
}

interface FlagOpts { seed: number; size: number; tones: RGB[]; joint: RGB; grooves?: boolean; rows?: [number, number]; lens?: [number, number]; gap?: number; crack?: number; hTop?: number }

/** große Platten in Reihen verschiedener Breite (Lastricato, Gehwegplatten aus Naturstein) */
function flagCobble(bump: boolean, o: FlagOpts): GroundTex {
  const S = 512;
  const p = painter(S, S, bump, o.seed, o.joint, 40);
  const { c, r } = p;
  const rowsR = o.rows ?? [70, 120];
  const lens = o.lens ?? [90, 190];
  const gap = o.gap ?? 3.5;
  const rows: number[] = [];
  let sum = 0;
  while (sum < S) { const hh = rowsR[0] + r() * (rowsR[1] - rowsR[0]); rows.push(hh); sum += hh; }
  const k = S / sum;
  let y = 0;
  for (const rh0 of rows) {
    const rh = rh0 * k;
    const ws: number[] = [];
    let sw = 0;
    while (sw < S) { const w = lens[0] + r() * (lens[1] - lens[0]); ws.push(w); sw += w; }
    const kw = S / sw;
    let x = r() * 60;
    for (const w0 of ws) {
      const w = w0 * kw;
      const t = pickC(r, o.tones);
      const v = 0.88 + r() * 0.2;
      const col: RGB = [t[0] * v, t[1] * v, t[2] * v];
      const cx = x + w / 2, cy = y + rh / 2;
      const pts = quadPts(r, 0, 0, w - gap, rh - gap, (r() - 0.5) * 0.01, 1.2);
      const gr: [number, number] | undefined = o.grooves ? [r() < 0.5 ? 0.78 : -0.78, 5 + r() * 2] : undefined;
      const so: StoneOpts = { rad: 3, dome: 0.18, hTop: o.hTop ?? 205, hEdge: 150, blots: 5, edge: 0.32, grooves: gr, seed: Math.floor(r() * 1e9) };
      const draw = (dx: number, dy: number) => stone(p, pts.map(([a, b]) => [a + cx + dx, b + cy + dy] as [number, number]), col, so);
      draw(0, 0);
      if (cx + w / 2 > S) draw(-S, 0);
      if (cx - w / 2 < 0) draw(S, 0);
      if (cy + rh / 2 > S - 1) draw(0, -S);
      x += w;
    }
    y += rh;
  }
  // Risse in einzelnen Platten
  c.strokeStyle = 'rgba(30,26,22,0.45)';
  c.lineWidth = 1.1;
  for (let i = 0; i < (o.crack ?? 10); i++) {
    let x = r() * S, yy = r() * S;
    c.beginPath();
    c.moveTo(x, yy);
    for (let j = 0; j < 5; j++) { x += (r() - 0.5) * 30; yy += (r() - 0.5) * 30; c.lineTo(x, yy); }
    c.stroke();
  }
  speckle(p, 2400, ['rgba(255,255,255,0.12)', 'rgba(0,0,0,0.14)'], 0.8, 1.6);
  finish(p, { blot: 0.2, warm: 0.06, grain: 10, seed: o.seed });
  return { color: p.color, height: p.height, size: o.size };
}

// ------------------------------------------------------------------ Gehwege

export type WalkKind = 'lastre' | 'slabs' | 'brick' | 'mosaic' | 'panot' | 'enrobe' | 'opus';

/**
 * Gehwege
 * - lastre: Natursteinplatten in Reihen (Pietra serena, Granit; Italien)
 * - slabs: Betonplatten 40 × 40 mit Kantenabplatzern, Kaugummiflecken und Moos in den Fugen (Norden)
 * - brick: Klinker im Fischgrätverband (Belgien, Niederlande, England)
 * - mosaic: Mosaikpflaster aus kleinen Granitwürfeln in Bögen
 * - panot: Gehwegfliesen 20 × 20 mit vier Kreisen (Spanien)
 * - enrobe: Asphalt mit hellem Splitt (französischer Trottoir)
 * - opus: unregelmäßige Porphyrplatten (Polygonalplatten; Trentino)
 */
export function walkTex(kind: WalkKind, bump: boolean): GroundTex {
  switch (kind) {
    case 'lastre': return flagCobble(bump, { seed: 61, size: 2.4, tones: STONE.serena, joint: [96, 96, 94], rows: [80, 110], lens: [110, 210], gap: 2.6, crack: 6, hTop: 200 });
    case 'slabs': return slabWalk(bump);
    case 'brick': return brickWalk(bump);
    case 'mosaic': return arcCobble(bump, { seed: 64, size: 1.4, s: 22, R: 160, tones: STONE.granite, joint: [120, 112, 100], polish: 0 });
    case 'panot': return panotWalk(bump);
    case 'enrobe': return enrobeWalk(bump);
    case 'opus': return opusWalk(bump);
  }
}

function slabWalk(bump: boolean): GroundTex {
  const S = 512;
  const p = painter(S, S, bump, 62, [118, 116, 110], 70);
  const { c, r } = p;
  const n = 5;
  const q = S / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = 0.9 + r() * 0.16;
      const base: RGB = mix([170, 168, 162], [160, 156, 146], r());
      const col: RGB = [base[0] * v, base[1] * v, base[2] * v];
      const pts = quadPts(r, i * q + q / 2, j * q + q / 2, q - 3, q - 3, (r() - 0.5) * 0.008, 0.6);
      stone(p, pts, col, { rad: 2, dome: 0.12, hTop: 200 + (r() - 0.5) * 30, hEdge: 175, blots: 6, edge: 0.3 });
      // Kantenabplatzer
      for (let k = 0; k < 2; k++) {
        if (r() < 0.5) continue;
        const [ex, ey] = pts[Math.floor(r() * 4)];
        c.fillStyle = 'rgba(80,78,72,0.6)';
        c.beginPath();
        c.ellipse(ex + (r() - 0.5) * 6, ey + (r() - 0.5) * 6, 3 + r() * 5, 2 + r() * 4, r() * 3, 0, Math.PI * 2);
        c.fill();
      }
      // gesprungene Platte
      if (r() < 0.22) {
        c.strokeStyle = 'rgba(50,48,44,0.55)';
        c.lineWidth = 1.2;
        c.beginPath();
        let x = i * q + r() * q, y = j * q;
        c.moveTo(x, y);
        for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 22; y += q / 5; c.lineTo(x, y); }
        c.stroke();
      }
    }
  }
  // Kaugummi, Flecken
  for (let i = 0; i < 70; i++) {
    c.fillStyle = r() < 0.7 ? 'rgba(60,58,56,0.35)' : 'rgba(230,226,216,0.4)';
    c.beginPath();
    c.arc(r() * S, r() * S, 1.5 + r() * 2.5, 0, Math.PI * 2);
    c.fill();
  }
  // Moos und Schmutz in den Fugen
  c.strokeStyle = 'rgba(70,86,46,0.32)';
  c.lineWidth = 2.4;
  for (let i = 0; i <= n; i++) {
    for (let k = 0; k < 3; k++) {
      const y0 = r() * S, l = 20 + r() * 60;
      c.beginPath(); c.moveTo(i * q, y0); c.lineTo(i * q, y0 + l); c.stroke();
      c.beginPath(); c.moveTo(y0, i * q); c.lineTo(y0 + l, i * q); c.stroke();
    }
  }
  finish(p, { blot: 0.2, warm: 0.04, grain: 14, seed: 62 });
  return { color: p.color, height: p.height, size: 2.0 };
}

function brickWalk(bump: boolean): GroundTex {
  const S = 512;
  const p = painter(S, S, bump, 63, [120, 116, 108], 40);
  const { r } = p;
  const tones: RGB[] = [[150, 72, 54], [136, 64, 50], [160, 86, 64], [122, 60, 48], [168, 98, 74], [110, 62, 54], [144, 80, 66]];
  // Fischgrät (achsparallel, Steine 2 : 1): je ein waagrechter und ein senkrechter Stein als Paar, die Paare im
  // Gitter a·(1, 1) + b·(2, −2) Einheiten – nach 16 Einheiten wiederholt sich das Muster in beide Richtungen
  const u = S / 16;
  const brick = (x: number, y: number, w: number, hh: number) => {
    const t = pickC(r, tones);
    const v = 0.85 + r() * 0.28;
    const col: RGB = [t[0] * v, t[1] * v, t[2] * v];
    const cx = (x + w / 2) * u, cy = (y + hh / 2) * u;
    if (cx < -2 * u || cx > S + 2 * u || cy < -2 * u || cy > S + 2 * u) return;
    const pts = quadPts(r, 0, 0, w * u - 3, hh * u - 3, 0, 0.8);
    const so: StoneOpts = { rad: 2.5, dome: 0.3, hTop: 215, hEdge: 150, blots: 2, edge: 0.28, seed: Math.floor(r() * 1e9) };
    wrap(p, cx, cy, 2 * u, (a, b) => stone(p, pts.map(([pa, pb]) => [pa + a, pb + b] as [number, number]), col, so));
  };
  for (let a = -4; a < 24; a++) {
    for (let b = -6; b < 6; b++) {
      const x = a + 2 * b, y = a - 2 * b;
      if (x < -2 || x > 16 || y < -2 || y > 16) continue;
      brick(x, y, 2, 1);
      brick(x, y + 1, 1, 2);
    }
  }
  speckle(p, 2400, ['rgba(255,240,220,0.12)', 'rgba(0,0,0,0.16)'], 0.8, 1.5);
  finish(p, { blot: 0.2, warm: 0.04, grain: 12, seed: 63 });
  return { color: p.color, height: p.height, size: 1.6 };
}

function panotWalk(bump: boolean): GroundTex {
  const S = 512;
  const p = painter(S, S, bump, 65, [128, 124, 116], 60);
  const { c, h, r } = p;
  const n = 8;
  const q = S / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = 0.9 + r() * 0.14;
      const col: RGB = [182 * v, 176 * v, 164 * v];
      const pts = quadPts(r, i * q + q / 2, j * q + q / 2, q - 2.5, q - 2.5, 0, 0.4);
      stone(p, pts, col, { rad: 1.5, dome: 0.1, hTop: 190, hEdge: 170, blots: 2, edge: 0.25 });
      // vier Kreise (Relief): heller Rand oben links, dunkler unten rechts
      for (let a = 0; a < 2; a++) {
        for (let b = 0; b < 2; b++) {
          const cx = i * q + q * (0.27 + a * 0.46), cy = j * q + q * (0.27 + b * 0.46), rr = q * 0.17;
          c.lineWidth = 2;
          c.strokeStyle = 'rgba(255,255,250,0.35)';
          c.beginPath(); c.arc(cx - 0.7, cy - 0.7, rr, Math.PI * 0.9, Math.PI * 1.9); c.stroke();
          c.strokeStyle = 'rgba(0,0,0,0.25)';
          c.beginPath(); c.arc(cx + 0.7, cy + 0.7, rr, -Math.PI * 0.1, Math.PI * 0.9); c.stroke();
          c.fillStyle = 'rgba(0,0,0,0.05)';
          c.beginPath(); c.arc(cx, cy, rr - 1, 0, Math.PI * 2); c.fill();
          if (h) { h.strokeStyle = grey(235); h.lineWidth = 3; h.beginPath(); h.arc(cx, cy, rr, 0, Math.PI * 2); h.stroke(); }
        }
      }
    }
  }
  for (let i = 0; i < 50; i++) { c.fillStyle = 'rgba(60,58,56,0.3)'; c.beginPath(); c.arc(r() * S, r() * S, 1.5 + r() * 2, 0, Math.PI * 2); c.fill(); }
  finish(p, { blot: 0.18, warm: 0.04, grain: 12, seed: 65 });
  return { color: p.color, height: p.height, size: 1.6 };
}

function enrobeWalk(bump: boolean): GroundTex {
  const S = 512;
  const p = painter(S, S, bump, 66, [82, 82, 84], 120);
  const { c, h, r } = p;
  for (let i = 0; i < 9000; i++) {
    const x = r() * S, y = r() * S, s = 1 + r() * 2.6;
    const v = r();
    if (v < 0.5) dot(p, x, y, s, [200, 194, 182], 0.25 + r() * 0.35);
    else if (v < 0.8) dot(p, x, y, s, [40, 40, 42], 0.4);
    else dot(p, x, y, s, [150, 130, 110], 0.35);
    if (h && v < 0.5) p.hd.push(x, y, s, 170 + r() * 60);
  }
  // Flicken und Aufgrabungen (dunkler, eckig)
  for (let i = 0; i < 4; i++) {
    const x = r() * S, y = r() * S, w = 60 + r() * 140, hh = 40 + r() * 90;
    wrap(p, x, y, 200, (a, b) => { c.fillStyle = 'rgba(30,30,32,0.28)'; c.fillRect(a, b, w, hh); c.strokeStyle = 'rgba(20,20,22,0.45)'; c.lineWidth = 2; c.strokeRect(a, b, w, hh); });
  }
  finish(p, { blot: 0.25, warm: 0.03, grain: 16, seed: 66 });
  return { color: p.color, height: p.height, size: 2.0 };
}

/**
 * Polygonalplatten: Zellen eines periodischen Voronoi-Musters (je Bildpunkt die nächsten zwei Saatpunkte), Fuge wo
 * beide gleich nah sind. Je Platte eigene Farbe, leicht gewölbt.
 */
function opusWalk(bump: boolean): GroundTex {
  const S = 512;
  const p = painter(S, S, bump, 67, [90, 80, 72], 40);
  const r = p.r;
  const G = 7;
  const cell = S / G;
  const pts: [number, number][] = [];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) pts.push([(i + 0.2 + r() * 0.6) * cell, (j + 0.2 + r() * 0.6) * cell]);
  const cols: RGB[] = pts.map(() => { const t = pickC(r, STONE.porphyry); const v = 0.85 + r() * 0.3; return [t[0] * v, t[1] * v, t[2] * v]; });
  const img = p.c.getImageData(0, 0, S, S);
  const d = img.data;
  const hImg = p.h ? p.h.getImageData(0, 0, S, S) : null;
  const hd = hImg?.data;
  for (let y = 0; y < S; y++) {
    const cj = Math.floor(y / cell);
    for (let x = 0; x < S; x++) {
      const ci = Math.floor(x / cell);
      let q1 = 1e18, q2 = 1e18, best = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = (ci + di + G) % G, jj = (cj + dj + G) % G;
          const pp = pts[jj * G + ii];
          const qx = pp[0] + (ci + di - ii) * cell - x, qy = pp[1] + (cj + dj - jj) * cell - y;
          const dd = qx * qx + qy * qy;
          if (dd < q1) { q2 = q1; q1 = dd; best = jj * G + ii; } else if (dd < q2) q2 = dd;
        }
      }
      const d1 = Math.sqrt(q1);
      const e = Math.sqrt(q2) - d1;
      const k = (y * S + x) * 4;
      if (e < 2.2) continue;
      const c = cols[best];
      const shade = Math.min(1, (e - 2.2) / 5);
      const dome = 1 - Math.min(1, d1 / (cell * 0.75)) * 0.12;
      d[k] = clamp255(c[0] * (0.78 + 0.22 * shade) * dome);
      d[k + 1] = clamp255(c[1] * (0.78 + 0.22 * shade) * dome);
      d[k + 2] = clamp255(c[2] * (0.78 + 0.22 * shade) * dome);
      if (hd) { const v = 120 + 110 * shade * (1 - d1 / (cell * 1.4)); hd[k] = hd[k + 1] = hd[k + 2] = clamp255(v); }
    }
  }
  p.c.putImageData(img, 0, 0);
  if (p.h && hImg) p.h.putImageData(hImg, 0, 0);
  speckle(p, 2600, ['rgba(255,255,255,0.12)', 'rgba(0,0,0,0.18)'], 0.8, 1.6);
  finish(p, { blot: 0.18, warm: 0.05, grain: 12, seed: 67 });
  return { color: p.color, height: p.height, size: 2.2 };
}

// ------------------------------------------------------------------ Bordstein und Rinne

export type CurbKind = 'granite' | 'travertine' | 'bluestone' | 'concrete' | 'limestone' | 'porphyry';

/** Querprofil des Bordsteins (m): Ansicht bis CURB_FACE, Fase, Oberseite bis CURB_TOP; v der Textur 0 … 1 darüber */
export const CURB_FACE = 0.125;
export const CURB_CHAMFER = 0.02;
export const CURB_TOP = 0.17;
export const CURB_V = (CURB_FACE + CURB_CHAMFER * 1.41 + CURB_TOP);

const CURB_COL: Record<CurbKind, { base: RGB; spread: number; speck: string[]; pores?: boolean }> = {
  granite: { base: [152, 151, 150], spread: 0.12, speck: ['rgba(255,255,255,0.35)', 'rgba(20,20,22,0.4)', 'rgba(210,170,160,0.25)'] },
  travertine: { base: [208, 198, 176], spread: 0.08, speck: ['rgba(120,100,70,0.25)', 'rgba(255,250,235,0.3)'], pores: true },
  bluestone: { base: [94, 100, 108], spread: 0.1, speck: ['rgba(230,232,236,0.35)', 'rgba(20,24,30,0.3)'] },
  concrete: { base: [178, 176, 170], spread: 0.07, speck: ['rgba(90,88,84,0.3)', 'rgba(240,238,232,0.25)'] },
  limestone: { base: [198, 188, 166], spread: 0.08, speck: ['rgba(130,110,80,0.22)', 'rgba(250,244,228,0.3)'] },
  porphyry: { base: [130, 104, 96], spread: 0.12, speck: ['rgba(200,170,160,0.3)', 'rgba(40,30,30,0.3)'] },
};

/**
 * Bordstein: 8 m Länge, Steine von 0,7–1,6 m mit Fugen, jeder in eigenem Ton; quer das Profil (unten die Ansicht
 * mit Spritzwasser-Schmutz und schwarzen Reifenspuren, dann die hell abgeriebene Fase, oben die Oberseite)
 */
export function curbTex(kind: CurbKind, bump: boolean): GroundTex {
  const W = 1024, H = 128;
  const spec = CURB_COL[kind];
  const p = painter(W, H, bump, 71 + kind.length, spec.base, 200);
  const { c, h, r } = p;
  const vFace = Math.round((CURB_FACE / CURB_V) * H);
  const vCh = Math.round(((CURB_FACE + CURB_CHAMFER * 1.41) / CURB_V) * H);
  let x = 0;
  while (x < W) {
    let w = (0.7 + r() * 0.9) * 128;
    if (x + w > W - 50) w = W - x;
    const v = 1 - spec.spread + r() * spec.spread * 2;
    c.fillStyle = css(spec.base, v);
    c.fillRect(x, 0, w, H);
    // Oberseite: abgerieben (glatter, etwas heller), Fase: hell
    c.fillStyle = 'rgba(255,255,250,0.08)';
    c.fillRect(x, vCh, w, H - vCh);
    c.fillStyle = 'rgba(255,255,250,0.2)';
    c.fillRect(x, vFace, w, vCh - vFace);
    // Ansicht unten: Spritzwasser, Schmutz
    const g = c.createLinearGradient(0, 0, 0, vFace);
    g.addColorStop(0, `rgba(60,52,40,${(0.35 + r() * 0.2).toFixed(3)})`);
    g.addColorStop(0.6, 'rgba(60,52,40,0.05)');
    g.addColorStop(1, 'rgba(60,52,40,0)');
    c.fillStyle = g;
    c.fillRect(x, 0, w, vFace);
    // Reifenspuren an der Ansicht
    if (r() < 0.45) {
      c.fillStyle = `rgba(20,20,22,${(0.25 + r() * 0.3).toFixed(3)})`;
      const yy = vFace * (0.35 + r() * 0.4);
      c.fillRect(x + r() * w * 0.5, yy, w * (0.2 + r() * 0.5), 2 + r() * 4);
    }
    // abgeplatzte Ecke an der Fase
    if (r() < 0.35) {
      c.fillStyle = 'rgba(70,66,60,0.55)';
      c.beginPath();
      c.ellipse(x + r() * w, vFace + 2, 5 + r() * 10, 3 + r() * 4, 0, 0, Math.PI * 2);
      c.fill();
    }
    if (spec.pores) {
      for (let k = 0; k < 40; k++) {
        c.fillStyle = 'rgba(110,92,64,0.45)';
        c.beginPath();
        c.ellipse(x + r() * w, r() * H, 1.5 + r() * 4, 0.6 + r() * 1, 0, 0, Math.PI * 2);
        c.fill();
      }
    }
    // Fuge
    c.fillStyle = 'rgba(40,36,32,0.75)';
    c.fillRect(x, 0, 2.5, H);
    if (h) {
      h.fillStyle = grey(30);
      h.fillRect(x, 0, 3, H);
      const hg = h.createLinearGradient(0, vFace, 0, vCh);
      hg.addColorStop(0, grey(160));
      hg.addColorStop(1, grey(230));
      h.fillStyle = hg;
      h.fillRect(x + 3, vFace, w - 3, vCh - vFace);
    }
    x += w;
  }
  speckle(p, 5000, spec.speck, 0.7, 1.8);
  finish(p, { blot: 0.12, warm: 0.03, grain: 10, cells: 6, seed: 71 });
  return { color: p.color, height: p.height, size: 8 };
}

export type GutterKind = 'setts' | 'porphyry' | 'concrete' | 'pebbles';

/** Rinne vor dem Bordstein: 2 m längs, 0,45 m quer (u längs, v quer: 0 an der Fahrbahn, 1 am Bordstein) */
export const GUTTER_W = 0.45;

export function gutterTex(kind: GutterKind, bump: boolean): GroundTex {
  const W = 512, H = 128;
  const p = painter(W, H, bump, 81 + kind.length, kind === 'concrete' ? [166, 164, 158] : [96, 90, 80], 30);
  const { c, h, r } = p;
  if (kind === 'concrete') {
    for (let x = 0; x < W; x += 256) {
      const v = 0.92 + r() * 0.14;
      c.fillStyle = css([170, 168, 162], v);
      c.fillRect(x + 2, 0, 252, H);
      c.fillStyle = 'rgba(50,48,44,0.6)';
      c.fillRect(x, 0, 2.5, H);
      if (h) { h.fillStyle = grey(200); h.fillRect(x + 3, 0, 250, H); }
    }
  } else {
    const tones = kind === 'porphyry' ? STONE.porphyry : kind === 'pebbles' ? STONE.pebble : STONE.granite;
    const rowsN = kind === 'pebbles' ? 5 : 3;
    const rh = H / rowsN;
    for (let ri = 0; ri < rowsN; ri++) {
      let x = -r() * rh;
      while (x < W) {
        const w = rh * (kind === 'pebbles' ? 0.7 + r() * 0.5 : 1.0 + r() * 0.5);
        const t = pickC(r, tones);
        const v = 0.85 + r() * 0.28;
        const col: RGB = [t[0] * v, t[1] * v, t[2] * v];
        const pts = quadPts(r, 0, 0, w - 3, rh - 3, (r() - 0.5) * 0.08, 1.8);
        const cx = x + w / 2, cy = ri * rh + rh / 2;
        const so: StoneOpts = { rad: kind === 'pebbles' ? 9 : 5, dome: 0.6, blots: 2, seed: Math.floor(r() * 1e9) };
        const draw = (dx: number) => stone(p, pts.map(([a, b]) => [a + cx + dx, b + cy] as [number, number]), col, so);
        draw(0);
        if (cx + w > W) draw(-W);
        if (cx - w < 0) draw(W);
        x += w;
      }
    }
  }
  // Wasserlauf: Mitte dunkler (Nässe, Schlamm, Laub)
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(40,36,30,0)');
  g.addColorStop(0.55, 'rgba(40,36,30,0.28)');
  g.addColorStop(0.85, 'rgba(40,36,30,0.12)');
  g.addColorStop(1, 'rgba(40,36,30,0.2)');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  for (let i = 0; i < 26; i++) {
    c.fillStyle = r() < 0.5 ? 'rgba(130,96,50,0.45)' : 'rgba(90,100,50,0.35)';
    c.beginPath();
    c.ellipse(r() * W, H * (0.45 + r() * 0.45), 2 + r() * 4, 1 + r() * 2, r() * 3, 0, Math.PI * 2);
    c.fill();
  }
  finish(p, { blot: 0.16, warm: 0.04, grain: 12, cells: 4, seed: 81 });
  return { color: p.color, height: p.height, size: 2 };
}

// ------------------------------------------------------------------ Gullideckel, Abläufe

export type CoverLang = 'it' | 'fr' | 'es' | 'en';
/** Zellen im Atlas (4 × 2, je 128 px = 1 m): 0–3 runde Deckel, 4 quadratisch, 5 Ablaufgitter, 6 Schieberkappe, 7 Kabelschacht */
export const COVER_CELLS = 8;
/** Radius des runden Deckels und des Rahmens in der Zelle (m, Zelle 1 m) */
export const COVER_R = 0.31;
export const COVER_FRAME = 0.36;
export const COVER_PATCH = 0.5;

const COVER_WORDS: Record<CoverLang, [string, string, string]> = {
  it: ['FOGNATURA', 'ACQUA', 'COMUNE'],
  fr: ['ASSAINISSEMENT', 'EAU', 'VILLE'],
  es: ['SANEAMIENTO', 'AGUA', 'AYUNTAMIENTO'],
  en: ['SEWER', 'WATER', 'COUNCIL'],
};

/**
 * Atlas der Schachtdeckel in der Sprache der Gegend: Kanal mit Ringen und Rippen, Kanal mit Rautenmuster,
 * Wasser mit Waben, Strahlenmuster; quadratischer Deckel mit Riffelblech, Straßenablauf mit Schlitzen,
 * kleine Schieberkappe, Kabelschacht. Rund: außen ein Ring aus dunklem, frisch geflicktem Asphalt (die Scheibe
 * im Spiel reicht bis COVER_PATCH), Rahmen aus Stahl.
 */
export function coverAtlas(lang: CoverLang): HTMLCanvasElement {
  const C = 128;
  const cv = canvas(C * 4, C * 2);
  const c = cv.getContext('2d')!;
  const r = mulberry32(91 + lang.charCodeAt(0));
  const words = COVER_WORDS[lang];
  const iron = (v = 1) => css([62, 62, 64], v);
  const sans = 'bold 9px -apple-system, "SF Pro Text", "Segoe UI", Roboto, Arial, sans-serif';
  const ringText = (cx: number, cy: number, rad: number, text: string, top: boolean) => {
    c.save();
    c.font = sans;
    c.fillStyle = 'rgba(150,148,142,0.85)';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const n = text.length;
    const span = Math.min(Math.PI * 0.9, n * 0.13);
    for (let i = 0; i < n; i++) {
      const a = (top ? -Math.PI / 2 : Math.PI / 2) + (top ? 1 : -1) * (-span / 2 + (i + 0.5) * (span / n));
      c.save();
      c.translate(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
      c.rotate(a + (top ? Math.PI / 2 : -Math.PI / 2));
      c.fillText(text[i], 0, 0);
      c.restore();
    }
    c.restore();
  };
  const round = (i: number, inner: (cx: number, cy: number, R: number) => void) => {
    const cx = (i % 4) * C + C / 2, cy = Math.floor(i / 4) * C + C / 2;
    // Flicken im Asphalt rundum
    c.fillStyle = css([50, 50, 52], 0.95 + r() * 0.1);
    c.fillRect(cx - C / 2, cy - C / 2, C, C);
    for (let k = 0; k < 500; k++) { c.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.15)'; c.fillRect(cx - C / 2 + r() * C, cy - C / 2 + r() * C, 1.5, 1.5); }
    const R = COVER_R * C, F = COVER_FRAME * C;
    // Rahmen: Stahl, außen eine Bitumenfuge
    c.fillStyle = 'rgba(20,20,22,0.9)';
    c.beginPath(); c.arc(cx, cy, F + 1.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = iron(1.25);
    c.beginPath(); c.arc(cx, cy, F, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(10,10,12,0.9)';
    c.beginPath(); c.arc(cx, cy, R + 1, 0, Math.PI * 2); c.fill();
    // Deckel
    c.save();
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.clip();
    c.fillStyle = iron(1);
    c.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    inner(cx, cy, R);
    // Rost und blanke Stellen (Reifen)
    for (let k = 0; k < 14; k++) {
      c.fillStyle = r() < 0.5 ? `rgba(130,74,40,${(0.12 + r() * 0.15).toFixed(3)})` : 'rgba(200,200,196,0.12)';
      c.beginPath(); c.ellipse(cx + (r() - 0.5) * R * 1.6, cy + (r() - 0.5) * R * 1.6, 3 + r() * 8, 2 + r() * 5, r() * 3, 0, Math.PI * 2); c.fill();
    }
    const g = c.createRadialGradient(cx - R * 0.3, cy - R * 0.3, 2, cx, cy, R);
    g.addColorStop(0, 'rgba(255,255,255,0.1)');
    g.addColorStop(1, 'rgba(0,0,0,0.2)');
    c.fillStyle = g;
    c.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    c.restore();
  };
  // 0: Kanal – Ringe, Rippen, Schrift oben und unten
  round(0, (cx, cy, R) => {
    c.strokeStyle = iron(1.45);
    c.lineWidth = 2;
    for (const k of [0.92, 0.55, 0.28]) { c.beginPath(); c.arc(cx, cy, R * k, 0, Math.PI * 2); c.stroke(); }
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      if (Math.abs(Math.sin(t)) > 0.75) continue;
      c.beginPath(); c.moveTo(cx + Math.cos(t) * R * 0.3, cy + Math.sin(t) * R * 0.3); c.lineTo(cx + Math.cos(t) * R * 0.53, cy + Math.sin(t) * R * 0.53); c.stroke();
    }
    ringText(cx, cy, R * 0.74, words[0], true);
    ringText(cx, cy, R * 0.74, words[2], false);
  });
  // 1: Kanal – Rauten (Gussmuster gegen Rutschen)
  round(1, (cx, cy, R) => {
    c.fillStyle = iron(1.4);
    const s = 7;
    for (let y = -R; y < R; y += s) for (let x = -R; x < R; x += s) {
      const ox = (Math.round(y / s) % 2) * s / 2;
      c.save(); c.translate(cx + x + ox, cy + y); c.rotate(Math.PI / 4); c.fillRect(-1.6, -1.6, 3.2, 3.2); c.restore();
    }
    c.fillStyle = iron(1.05);
    c.fillRect(cx - R * 0.62, cy - 6, R * 1.24, 12);
    c.font = sans;
    c.fillStyle = 'rgba(150,148,142,0.9)';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(words[0].slice(0, 10), cx, cy + 0.5);
  });
  // 2: Wasser – Waben
  round(2, (cx, cy, R) => {
    c.strokeStyle = iron(1.45);
    c.lineWidth = 1.4;
    const s = 6.5;
    for (let y = -R; y < R; y += s * 1.5) for (let x = -R; x < R; x += s * 1.73) {
      const ox = (Math.round(y / (s * 1.5)) % 2) * s * 0.866;
      c.beginPath();
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + Math.PI / 6; const px = cx + x + ox + Math.cos(a) * s * 0.85, py = cy + y + Math.sin(a) * s * 0.85; if (k) c.lineTo(px, py); else c.moveTo(px, py); }
      c.closePath(); c.stroke();
    }
    c.fillStyle = iron(1.05);
    c.beginPath(); c.arc(cx, cy, R * 0.36, 0, Math.PI * 2); c.fill();
    c.font = sans;
    c.fillStyle = 'rgba(150,148,142,0.9)';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(words[1], cx, cy + 0.5);
  });
  // 3: Strahlen
  round(3, (cx, cy, R) => {
    c.strokeStyle = iron(1.45);
    c.lineWidth = 2.2;
    for (let a = 0; a < 24; a++) {
      const t = (a / 24) * Math.PI * 2;
      c.beginPath(); c.moveTo(cx + Math.cos(t) * R * 0.22, cy + Math.sin(t) * R * 0.22); c.lineTo(cx + Math.cos(t) * R * 0.95, cy + Math.sin(t) * R * 0.95); c.stroke();
    }
    c.fillStyle = iron(1.2);
    c.beginPath(); c.arc(cx, cy, R * 0.2, 0, Math.PI * 2); c.fill();
  });
  // 4: quadratischer Deckel mit Riffelblech
  {
    const x0 = 0, y0 = C;
    c.fillStyle = css([140, 138, 132]);
    c.fillRect(x0, y0, C, C);
    c.fillStyle = 'rgba(20,20,22,0.85)';
    c.fillRect(x0 + 13, y0 + 13, C - 26, C - 26);
    c.fillStyle = iron(1.2);
    c.fillRect(x0 + 16, y0 + 16, C - 32, C - 32);
    c.strokeStyle = iron(1.55);
    c.lineWidth = 2;
    for (let y = 22; y < C - 22; y += 9) for (let x = 22; x < C - 22; x += 9) {
      const k = ((x + y) / 9) % 2 === 0;
      c.beginPath();
      if (k) { c.moveTo(x0 + x - 3, y0 + y - 3); c.lineTo(x0 + x + 3, y0 + y + 3); } else { c.moveTo(x0 + x - 3, y0 + y + 3); c.lineTo(x0 + x + 3, y0 + y - 3); }
      c.stroke();
    }
  }
  // 5: Straßenablauf (Gitter mit Schlitzen, längs der Rinne)
  {
    const x0 = C, y0 = C;
    c.fillStyle = css([150, 148, 142]);
    c.fillRect(x0, y0, C, C);
    c.fillStyle = iron(1.1);
    c.fillRect(x0 + 6, y0 + 22, C - 12, C - 44);
    c.fillStyle = 'rgba(8,8,10,0.95)';
    for (let x = 14; x < C - 14; x += 9) c.fillRect(x0 + x, y0 + 30, 4.5, C - 60);
    c.fillStyle = 'rgba(120,90,50,0.35)';
    c.fillRect(x0 + 6, y0 + C - 34, C - 12, 10);
  }
  // 6: Schieberkappe (klein, rund, auf Asphalt)
  round(6, (cx, cy, R) => {
    c.fillStyle = css([62, 62, 64], 1.3);
    c.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    c.font = sans;
    c.fillStyle = 'rgba(150,148,142,0.9)';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(words[1], cx, cy + 0.5);
  });
  // 7: Kabelschacht (rechteckig, Profil)
  {
    const x0 = C * 3, y0 = C;
    c.fillStyle = css([136, 134, 128]);
    c.fillRect(x0, y0, C, C);
    c.fillStyle = 'rgba(20,20,22,0.85)';
    c.fillRect(x0 + 10, y0 + 28, C - 20, C - 56);
    c.fillStyle = iron(1.2);
    c.fillRect(x0 + 13, y0 + 31, C - 26, C - 62);
    c.fillStyle = iron(1.5);
    for (let x = 18; x < C - 18; x += 8) c.fillRect(x0 + x, y0 + 36, 3, C - 72);
  }
  return cv;
}

// ------------------------------------------------------------------ Bankett und Asphalt

export type VergeKind = 'gravel' | 'soil';

/**
 * Bankett: nicht ein Grau, sondern Splitt, Erde, Grasbüschel, Laub und Reifenspuren – fleckig verteilt (dry:
 * heller Kies, sonst Erde mit Gras); 3 m je Kachel
 */
export function vergeTex(kind: VergeKind, bump: boolean): GroundTex {
  const S = 512;
  const dry = kind === 'gravel';
  const p = painter(S, S, bump, dry ? 101 : 102, dry ? [170, 156, 128] : [118, 104, 82], 110);
  const { c, h, r } = p;
  const zone = tileNoise(S, S, 4, 3, dry ? 7 : 9);
  // Grundfläche in Zonen: Kies, Erde, Gras
  const img = c.getImageData(0, 0, S, S);
  const d = img.data;
  // (Kies und Erde im Ton näher beieinander als früher: die Kachel wiederholt sich alle 3 m, und helle Kiesflecken
  // neben dunkler Erde lagen von der Fahrbahn aus gesehen als gleichmäßige Querstreifen im Bankett – wie Schwellen)
  const soil: RGB = dry ? [158, 138, 109] : [112, 99, 79];
  const grav: RGB = dry ? [176, 162, 137] : [133, 125, 111];
  const grass: RGB = dry ? [132, 130, 82] : [96, 112, 64];
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const z = zone[j];
    const g = r();
    let col = z < 0.42 ? grav : z < 0.6 ? mix(grav, soil, (z - 0.42) / 0.18) : soil;
    const gr = Math.max(0, (z - (dry ? 0.66 : 0.56)) * 4);
    if (gr > 0 && g < gr) col = mix(col, grass, 0.55);
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2];
  }
  c.putImageData(img, 0, 0);
  // Steinchen, Splitt
  for (let i = 0; i < 7000; i++) {
    const x = r() * S, y = r() * S, s = 1 + r() * 3.2;
    const v = r();
    if (v < 0.45) dot(p, x, y, s, [235, 228, 210], 0.35 + r() * 0.3);
    else if (v < 0.8) dot(p, x, y, s, [70, 62, 50], 0.45);
    else dot(p, x, y, s, [150, 140, 128], 0.6);
    if (h) p.hd.push(x, y, s, 140 + s * 25);
  }
  // Grasbüschel und Laub
  for (let i = 0; i < (dry ? 140 : 320); i++) {
    const x = r() * S, y = r() * S;
    if (zone[(Math.floor(y) % S) * S + (Math.floor(x) % S)] < 0.45) continue;
    c.strokeStyle = dry ? `rgba(150,140,80,${(0.5 + r() * 0.3).toFixed(3)})` : `rgba(${70 + Math.floor(r() * 40)},${100 + Math.floor(r() * 40)},50,0.7)`;
    c.lineWidth = 1.2;
    for (let k = 0; k < 6; k++) { c.beginPath(); c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 9, y + (r() - 0.5) * 9); c.stroke(); }
  }
  for (let i = 0; i < 60; i++) {
    c.fillStyle = r() < 0.5 ? 'rgba(150,100,50,0.5)' : 'rgba(120,80,40,0.45)';
    c.beginPath(); c.ellipse(r() * S, r() * S, 2.5 + r() * 3, 1.2 + r() * 1.5, r() * 3, 0, Math.PI * 2); c.fill();
  }
  // Reifenspur längs (ein Auto ist mal ausgewichen)
  c.fillStyle = 'rgba(60,52,40,0.12)';
  c.fillRect(S * 0.3, 0, 26, S);
  finish(p, { blot: 0.18, warm: 0.06, grain: 16, seed: dry ? 101 : 102 });
  return { color: p.color, height: p.height, size: 3 };
}

export type AsphaltTone = 'cool' | 'warm' | 'light' | 'dark';

const ASPHALT: Record<AsphaltTone, { old: RGB; fresh: RGB; stone: string }> = {
  cool: { old: [98, 101, 107], fresh: [70, 72, 78], stone: '230,232,236' },
  warm: { old: [110, 106, 101], fresh: [76, 74, 73], stone: '238,228,212' },
  light: { old: [126, 122, 114], fresh: [84, 82, 79], stone: '244,236,220' },
  dark: { old: [86, 88, 92], fresh: [62, 64, 68], stone: '214,216,220' },
};

/**
 * Asphalt: Bitumen mit Splitt (helle Körner, im alten Belag freigefahren), großflächig fleckig (Öl, Nässe,
 * ausgebleicht), im alten Belag feine Netzrisse. Ton je Gegend (Süden heller und wärmer, Norden kühler). 5 m.
 */
export function asphaltTex(fresh: boolean, tone: AsphaltTone, bump: boolean): GroundTex {
  const S = 512;
  const t = ASPHALT[tone];
  const p = painter(S, S, bump, (fresh ? 41 : 42) + tone.length * 3, fresh ? t.fresh : t.old, 128);
  const { c, h, r } = p;
  const n = fresh ? 7000 : 11000;
  const stone3 = t.stone.split(',').map(Number);
  for (let i = 0; i < n; i++) {
    const x = r() * S, y = r() * S, s = 0.7 + r() * (fresh ? 1.8 : 2.4);
    const v = r();
    if (v < (fresh ? 0.35 : 0.55)) dot(p, x, y, s, stone3, (fresh ? 0.08 : 0.12) + r() * 0.14);
    else dot(p, x, y, s, [0, 0, 0], 0.08 + r() * 0.12);
    if (h && v < 0.5) p.hd.push(x, y, s, 150 + r() * 60);
  }
  if (!fresh) {
    // Netzrisse in Inseln
    c.strokeStyle = 'rgba(18,18,20,0.32)';
    c.lineWidth = 1;
    for (let k = 0; k < 5; k++) {
      const cx = r() * S, cy = r() * S;
      for (let i = 0; i < 14; i++) {
        let x = cx + (r() - 0.5) * 70, y = cy + (r() - 0.5) * 70;
        c.beginPath(); c.moveTo(x, y);
        for (let j = 0; j < 3; j++) { x += (r() - 0.5) * 22; y += (r() - 0.5) * 22; c.lineTo(x, y); }
        c.stroke();
      }
    }
    // Ölflecken
    for (let i = 0; i < 10; i++) {
      const x = r() * S, y = r() * S, rr = 6 + r() * 16;
      wrap(p, x, y, rr, (a, b) => { const g = c.createRadialGradient(a, b, 0, a, b, rr); g.addColorStop(0, 'rgba(20,20,24,0.22)'); g.addColorStop(1, 'rgba(20,20,24,0)'); c.fillStyle = g; c.fillRect(a - rr, b - rr, rr * 2, rr * 2); });
    }
  }
  finish(p, { blot: fresh ? 0.16 : 0.26, warm: 0.04, grain: fresh ? 14 : 20, cells: 2, seed: fresh ? 41 : 42 });
  return { color: p.color, height: p.height, size: 5 };
}

/** feines Korn für die Nähe (0,7 m): Splitt im Bitumen, wird um 1 gemittelt in die Farbe multipliziert */
export function grainTex(): HTMLCanvasElement {
  const S = 256;
  const p = painter(S, S, false, 111, [128, 128, 128]);
  const { c, r } = p;
  for (let i = 0; i < 2600; i++) {
    const x = r() * S, y = r() * S, s = 1.2 + r() * 3.5;
    const v = r();
    c.fillStyle = v < 0.5 ? `rgba(255,255,255,${(0.2 + r() * 0.3).toFixed(3)})` : `rgba(0,0,0,${(0.2 + r() * 0.3).toFixed(3)})`;
    wrap(p, x, y, 6, (a, b) => { c.beginPath(); c.ellipse(a, b, s, s * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2); c.fill(); });
  }
  finish(p, { blot: 0, warm: 0, grain: 22 });
  return p.color;
}
