/**
 * Prozedural gezeichnete Grafiken (Bäume, Häuser, Kühe, Zuschauer, Schilder …) und
 * Detail-Texturen für Straßenbeläge und Gelände. Alles entsteht beim Start auf Canvas,
 * es werden keine Bilddateien geladen.
 */
import { mulberry32, type Rng } from './rng';
import { fitFont } from './textfit';
import type { Ground, SpriteKind, Surface } from './track';

export interface SpriteImg {
  img: HTMLCanvasElement;
  w: number;   // Breite in m
  h: number;   // Höhe in m
}

type Ctx = CanvasRenderingContext2D;
type DrawFn = (c: Ctx, r: Rng, v: number, frame: number) => void;

interface Def { w: number; h: number; ppm: number; variants: number; frames?: number; draw: DrawFn }

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Zeichenfläche in Metern, Ursprung unten Mitte, y nach unten (Höhe = negative y) */
function render(def: Def, v: number, frame: number): HTMLCanvasElement {
  const W = def.w * def.ppm;
  const H = def.h * def.ppm;
  const cv = canvas(W, H);
  const c = cv.getContext('2d')!;
  c.translate(W / 2, H);
  c.scale(def.ppm, def.ppm);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  def.draw(c, mulberry32(1000 + v * 97), v, frame);
  return cv;
}

// ------------------------------------------------------------------ Helfer

function poly(c: Ctx, pts: number[], fill: string | CanvasGradient) {
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
}
function circle(c: Ctx, x: number, y: number, r: number, fill: string | CanvasGradient) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
}
function rrect(c: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string | CanvasGradient) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fillStyle = fill;
  c.fill();
}
function lin(c: Ctx, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  for (const [o, col] of stops) g.addColorStop(o, col);
  return g;
}
function rad(c: Ctx, x: number, y: number, r: number, stops: [number, string][]) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, col] of stops) g.addColorStop(o, col);
  return g;
}
const between = (r: Rng, a: number, b: number) => a + (b - a) * r();

// ------------------------------------------------------------------ Bäume

function pineShape(c: Ctx, r: Rng, h: number, w: number, dark: string, mid: string, light: string, snow: boolean) {
  // Stamm
  rrect(c, -0.16, -2.2, 0.32, 2.2, 0.05, '#4d3422');
  const tiers = 7 + Math.floor(r() * 3);
  const top = h;
  for (let t = 0; t < tiers; t++) {
    const k = t / tiers;
    const y0 = -1.1 - k * (top - 2.6);
    const half = (w / 2) * (1 - k * 0.86) + 0.2;
    const th = (top - 1.1) / tiers * 1.9;
    const tipY = y0 - th;
    const pts: number[] = [-half, y0 + 0.15];
    const n = 5;
    for (let j = 1; j < n; j++) {
      const x = -half + (2 * half * j) / n;
      pts.push(x, y0 - 0.12 + (j % 2 ? 0.25 : 0) + (r() - 0.5) * 0.1);
    }
    pts.push(half, y0 + 0.15);
    pts.push(half * 0.35, y0 - th * 0.55, 0, tipY, -half * 0.35, y0 - th * 0.55);
    poly(c, pts, lin(c, -half, 0, half, 0, [[0, light], [0.45, mid], [1, dark]]));
    // Schattenkante unter der Etage
    poly(c, [-half * 0.95, y0 + 0.1, half * 0.95, y0 + 0.1, half * 0.7, y0 - 0.12, -half * 0.7, y0 - 0.12], 'rgba(0,0,0,0.18)');
    if (snow) {
      poly(c, [-half * 0.7, y0 - th * 0.28, -half * 0.15, y0 - th * 0.62, 0, tipY + 0.05, half * 0.25, y0 - th * 0.55, half * 0.1, y0 - th * 0.4, -half * 0.3, y0 - th * 0.36], 'rgba(250,252,255,0.92)');
    }
  }
}

const PINE_COLS = [
  ['#1c3a20', '#2a5530', '#3f7442'],
  ['#1e3a2c', '#2d5745', '#477a5f'],
  ['#24401c', '#355f29', '#507f37'],
  ['#1a3320', '#28492d', '#3a6640'],
];

const tree: DrawFn = (c, r, v) => {
  rrect(c, -0.2, -3.2, 0.4, 3.2, 0.08, '#5b4030');
  poly(c, [-0.18, -2.4, -0.9, -3.6, -0.75, -3.75, -0.1, -2.9], '#5b4030');
  const greens = [['#3c6e2a', '#4f8a34', '#76b04c'], ['#46702b', '#5c8f36', '#86b856'], ['#3a6432', '#4e8040', '#6fa85a'], ['#527a2a', '#6a9636', '#92c050']][v % 4];
  const blobs = 7;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2;
    const x = Math.cos(a) * 1.4 + (r() - 0.5) * 0.5;
    const y = -5.4 + Math.sin(a) * 1.3 + (r() - 0.5) * 0.4;
    const rr = between(r, 1.2, 1.7);
    circle(c, x, y, rr, rad(c, x - rr * 0.4, y - rr * 0.4, rr * 1.4, [[0, greens[2]], [0.5, greens[1]], [1, greens[0]]]));
  }
  circle(c, 0, -5.6, 1.7, rad(c, -0.7, -6.3, 2.4, [[0, greens[2]], [0.55, greens[1]], [1, greens[0]]]));
};

const treeRound: DrawFn = (c, _r, v) => {
  rrect(c, -0.14, -2.6, 0.28, 2.6, 0.05, '#5b4030');
  const g = [['#3f7a2c', '#6aa944'], ['#4a7f30', '#7bb851'], ['#3b6d36', '#64a05a'], ['#567f2c', '#8cbf4f']][v % 4];
  circle(c, 0, -3.6, 1.45, rad(c, -0.6, -4.3, 2.2, [[0, g[1]], [1, g[0]]]));
  circle(c, 0, -3.6, 1.45, rad(c, 0.4, -3.0, 1.6, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.12)']]));
};

const cypress: DrawFn = (c, r) => {
  rrect(c, -0.1, -0.8, 0.2, 0.8, 0.04, '#4a3424');
  c.beginPath();
  c.moveTo(0, -9.6);
  c.bezierCurveTo(0.75, -7.5, 0.85, -3.2, 0.45, -0.6);
  c.lineTo(-0.45, -0.6);
  c.bezierCurveTo(-0.85, -3.2, -0.75, -7.5, 0, -9.6);
  c.fillStyle = lin(c, -0.8, 0, 0.8, 0, [[0, '#3c6634'], [0.5, '#2a4d27'], [1, '#1b341b']]);
  c.fill();
  c.strokeStyle = 'rgba(80,120,60,0.35)';
  c.lineWidth = 0.06;
  for (let i = 0; i < 26; i++) {
    const y = -0.9 - r() * 8;
    const x = (r() - 0.5) * 0.7 * (1 - Math.abs(y + 5) / 6);
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + 0.12, y - 0.35); c.stroke();
  }
};

const palm: DrawFn = (c, r, v) => {
  const lean = v % 2 ? 0.9 : -0.7;
  c.strokeStyle = '#7a5a3a';
  c.lineWidth = 0.32;
  c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(lean * 0.2, -3.5, lean, -6.6); c.stroke();
  c.strokeStyle = 'rgba(60,40,20,0.5)';
  c.lineWidth = 0.05;
  for (let i = 1; i < 12; i++) {
    const t = i / 12;
    const x = lean * t * t;
    const y = -6.6 * t;
    c.beginPath(); c.moveTo(x - 0.16, y); c.lineTo(x + 0.16, y - 0.05); c.stroke();
  }
  const cx = lean;
  const cy = -6.7;
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + (i - 4) * 0.38 + (r() - 0.5) * 0.1;
    const len = between(r, 2.2, 2.9);
    const ex = cx + Math.cos(a) * len * 1.2;
    const ey = cy + Math.sin(a) * len * 0.55 + len * 0.45;
    c.strokeStyle = i % 2 ? '#3f7a32' : '#4f8f3c';
    c.lineWidth = 0.22;
    c.beginPath(); c.moveTo(cx, cy); c.quadraticCurveTo(cx + Math.cos(a) * len * 0.7, cy + Math.sin(a) * len * 0.7, ex, ey); c.stroke();
    c.lineWidth = 0.06;
    for (let j = 1; j < 8; j++) {
      const t = j / 8;
      const px = cx + (ex - cx) * t;
      const py = cy + (ey - cy) * t - Math.sin(t * Math.PI) * 0.6;
      c.beginPath(); c.moveTo(px, py); c.lineTo(px + 0.25, py + 0.45); c.moveTo(px, py); c.lineTo(px - 0.25, py + 0.45); c.stroke();
    }
  }
  circle(c, cx, cy + 0.2, 0.25, '#6b4a2a');
};

const olive: DrawFn = (c, r) => {
  c.strokeStyle = '#6b5a48';
  c.lineWidth = 0.35;
  c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(-0.4, -0.8, 0.5, -1.4, 0.1, -2.3); c.stroke();
  c.lineWidth = 0.18;
  c.beginPath(); c.moveTo(0.1, -1.8); c.lineTo(-0.9, -2.6); c.moveTo(0.15, -2.1); c.lineTo(1, -2.7); c.stroke();
  for (let i = 0; i < 9; i++) {
    const x = (r() - 0.5) * 3;
    const y = -2.8 - r() * 1.4;
    const rr = between(r, 0.6, 1);
    circle(c, x, y, rr, rad(c, x - 0.3, y - 0.3, rr * 1.4, [[0, '#a4b289'], [0.6, '#7f8f63'], [1, '#62704c']]));
  }
};

const bush: DrawFn = (c, r, v) => {
  const g = [['#335f26', '#5b9440'], ['#3d6a2c', '#6aa34a'], ['#2f5426', '#53853a'], ['#476a2a', '#76a046']][v % 4];
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.32 + (r() - 0.5) * 0.15;
    const y = -0.5 - r() * 0.3;
    const rr = between(r, 0.38, 0.55);
    circle(c, x, y, rr, rad(c, x - 0.15, y - 0.2, rr * 1.4, [[0, g[1]], [1, g[0]]]));
  }
};

const flowers: DrawFn = (c, r, v) => {
  const col = ['#e63946', '#ffd23f', '#9b5de5', '#ffffff'][v % 4];
  for (let i = 0; i < 9; i++) {
    const x = (r() - 0.5) * 1.4;
    circle(c, x, -0.18 - r() * 0.15, 0.2, i % 2 ? '#5c9a38' : '#4f8c30');
  }
  for (let i = 0; i < 16; i++) circle(c, (r() - 0.5) * 1.4, -0.25 - r() * 0.3, 0.06, col);
};

const grassTuft: DrawFn = (c, r) => {
  c.lineWidth = 0.05;
  for (let i = 0; i < 18; i++) {
    const x = (r() - 0.5) * 0.9;
    c.strokeStyle = i % 3 ? '#5b9a36' : '#7cb64b';
    c.beginPath(); c.moveTo(x, 0); c.quadraticCurveTo(x + (r() - 0.5) * 0.3, -0.3, x + (r() - 0.5) * 0.5, -0.45 - r() * 0.35); c.stroke();
  }
};

// ------------------------------------------------------------------ Felsen

function rockShape(c: Ctx, r: Rng, w: number, h: number, base: string, light: string, dark: string, moss: boolean) {
  const pts: number[] = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (i / n) * Math.PI;
    pts.push(Math.cos(a) * w * between(r, 0.75, 1), Math.sin(a) * h * between(r, 0.7, 1));
  }
  poly(c, pts, lin(c, -w, -h, w, 0, [[0, light], [0.5, base], [1, dark]]));
  c.strokeStyle = 'rgba(0,0,0,0.18)';
  c.lineWidth = Math.max(0.03, w * 0.03);
  for (let i = 0; i < 4; i++) {
    c.beginPath();
    const x = (r() - 0.5) * w;
    c.moveTo(x, -h * between(r, 0.5, 0.9));
    c.lineTo(x + (r() - 0.5) * w * 0.5, -h * between(r, 0, 0.3));
    c.stroke();
  }
  if (moss) poly(c, [-w * 0.6, -h * 0.75, 0, -h * 0.98, w * 0.5, -h * 0.8, w * 0.2, -h * 0.68, -w * 0.3, -h * 0.64], 'rgba(90,130,60,0.65)');
}

// ------------------------------------------------------------------ Gebäude (Einzelhäuser abseits)

function windowRect(c: Ctx, x: number, y: number, w: number, h: number, shutter: string | null, lit: boolean) {
  if (shutter) {
    rrect(c, x - w * 0.55, y, w * 0.5, h, 0.03, shutter);
    rrect(c, x + w * 1.05, y, w * 0.5, h, 0.03, shutter);
  }
  rrect(c, x, y, w, h, 0.04, lit ? '#ffd27a' : '#2c3440');
  if (!lit) poly(c, [x, y, x + w * 0.5, y, x, y + h * 0.6], 'rgba(255,255,255,0.12)');
  c.fillStyle = 'rgba(255,255,255,0.65)';
  c.fillRect(x + w / 2 - 0.02, y, 0.04, h);
}

const chalet = (lit: boolean): DrawFn => (c, r, v) => {
  const W = 4.2;
  rrect(c, -W, -3, W * 2, 3, 0.05, lin(c, -W, 0, W, 0, [[0, '#f4efe4'], [1, '#d9d1c2']]));
  c.fillStyle = lin(c, -W, 0, W, 0, [[0, '#9b6a3c'], [1, '#6f4a28']]);
  c.fillRect(-W, -5.6, W * 2, 2.6);
  c.strokeStyle = 'rgba(40,25,10,0.35)';
  c.lineWidth = 0.05;
  for (let y = -5.5; y < -3; y += 0.3) { c.beginPath(); c.moveTo(-W, y); c.lineTo(W, y); c.stroke(); }
  poly(c, [-W - 0.9, -5.4, 0, -8, W + 0.9, -5.4, W + 0.9, -5.1, 0, -7.6, -W - 0.9, -5.1], v % 2 ? '#4a3426' : '#5a3f2c');
  poly(c, [-W + 0.1, -5.6, 0, -7.55, W - 0.1, -5.6], '#8a5a32');
  // Balkon mit Geranien
  c.fillStyle = '#5a3a20';
  c.fillRect(-W + 0.3, -3.6, W * 2 - 0.6, 0.12);
  for (let x = -W + 0.4; x < W - 0.3; x += 0.25) c.fillRect(x, -3.6, 0.06, 0.6);
  for (let i = 0; i < 30; i++) circle(c, -W + 0.5 + r() * (W * 2 - 1), -3.75 - r() * 0.15, 0.12, i % 3 ? '#e2364a' : '#ff6b81');
  const sh = v % 2 ? '#2f6a3a' : '#7a2d24';
  for (const x of [-2.8, -0.45, 1.9]) windowRect(c, x, -2.4, 0.9, 1.2, sh, lit);
  for (const x of [-1.6, 0.8]) windowRect(c, x, -5.2, 0.8, 1, sh, lit);
  rrect(c, -0.4, -1.8, 0.8, 1.8, 0.05, '#5a3a20');
};

const barn: DrawFn = (c, _r, v) => {
  const W = 2.8;
  c.fillStyle = lin(c, -W, 0, W, 0, [[0, '#7d5a3a'], [1, '#4f3624']]);
  c.fillRect(-W, -3.6, W * 2, 3.6);
  c.strokeStyle = 'rgba(20,10,0,0.35)';
  c.lineWidth = 0.05;
  for (let x = -W; x < W; x += 0.28) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, -3.6); c.stroke(); }
  poly(c, [-W - 0.7, -3.4, 0, -6, W + 0.7, -3.4, W + 0.7, -3.1, 0, -5.6, -W - 0.7, -3.1], v % 2 ? '#5d5650' : '#6b4e3a');
  poly(c, [-W, -3.6, 0, -5.55, W, -3.6], '#6a4a30');
  rrect(c, -0.8, -2.2, 1.6, 2.2, 0.05, '#3a2616');
  c.strokeStyle = 'rgba(160,120,80,0.6)';
  c.lineWidth = 0.08;
  c.beginPath(); c.moveTo(-0.8, -2.2); c.lineTo(0.8, 0); c.moveTo(0.8, -2.2); c.lineTo(-0.8, 0); c.stroke();
};

const rifugio = (lit: boolean): DrawFn => (c, r) => {
  const W = 4.8;
  rrect(c, -W, -3.4, W * 2, 3.4, 0.05, '#9a958a');
  for (let i = 0; i < 70; i++) {
    const x = -W + r() * W * 2;
    const y = -r() * 3.3;
    rrect(c, x - 0.25, y - 0.15, 0.5, 0.3, 0.08, i % 2 ? 'rgba(80,75,68,0.35)' : 'rgba(200,195,185,0.3)');
  }
  c.fillStyle = '#7b5232';
  c.fillRect(-W, -5.6, W * 2, 2.2);
  poly(c, [-W - 0.8, -5.4, 0, -7.4, W + 0.8, -5.4, W + 0.8, -5.1, 0, -7.0, -W - 0.8, -5.1], '#4b4540');
  poly(c, [-W, -5.6, 0, -6.95, W, -5.6], '#8a5a34');
  for (const x of [-3.5, -1.2, 1.6, 3.4]) windowRect(c, x - 0.4, -2.5, 0.8, 1.1, '#a0302a', lit);
  rrect(c, -1.7, -4.9, 3.4, 0.7, 0.08, '#f2ede0');
  c.fillStyle = '#3a2a1a';
  c.font = `700 0.5px ${FONT}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('RIFUGIO', 0, -4.53);
  // Fahne
  c.fillStyle = '#6b6b6b';
  c.fillRect(W - 0.2, -9.5, 0.08, 6);
  c.fillStyle = '#1f8a4c'; c.fillRect(W - 0.12, -9.5, 0.6, 1);
  c.fillStyle = '#f4f4f4'; c.fillRect(W + 0.48, -9.5, 0.6, 1);
  c.fillStyle = '#d23a3a'; c.fillRect(W + 1.08, -9.5, 0.6, 1);
};

const farmhouse = (lit: boolean): DrawFn => (c, r) => {
  const W = 5;
  rrect(c, -W, -5, W * 2, 5, 0.05, lin(c, -W, 0, W, 0, [[0, '#dcb27a'], [1, '#b98d56']]));
  for (let i = 0; i < 50; i++) rrect(c, -W + r() * W * 2, -r() * 4.9, 0.45, 0.22, 0.05, 'rgba(120,80,40,0.18)');
  poly(c, [-W - 0.4, -4.9, 0, -6.4, W + 0.4, -4.9, W + 0.4, -4.65, 0, -6.1, -W - 0.4, -4.65], '#b5532e');
  // Turm
  rrect(c, 1.5, -8.2, 2.2, 3.4, 0.05, '#cfa36c');
  poly(c, [1.2, -8.1, 2.6, -9.1, 4, -8.1], '#a8492a');
  windowRect(c, 2.3, -7.6, 0.6, 0.8, null, lit);
  for (const x of [-4, -2, 0.2]) windowRect(c, x, -3.9, 0.8, 1.1, '#3c6a3a', lit);
  for (const x of [-3, -1]) windowRect(c, x, -1.9, 0.8, 1.1, '#3c6a3a', lit);
  c.beginPath(); c.moveTo(1.2, 0); c.lineTo(1.2, -1.6); c.arc(2, -1.6, 0.8, Math.PI, 0); c.lineTo(2.8, 0); c.closePath();
  c.fillStyle = '#5a3a22'; c.fill();
};

// ------------------------------------------------------------------ Tiere

const cow = (bw: boolean): DrawFn => (c, r, v) => {
  const body = bw ? '#f3f1ec' : '#8a5a36';
  const dark = bw ? '#1e1e1e' : '#5e3b22';
  const grazing = v % 2 === 1;
  // Beine
  for (const x of [-0.75, -0.5, 0.5, 0.75]) rrect(c, x - 0.07, -0.75, 0.14, 0.75, 0.05, x < 0 ? body : dark);
  for (const x of [-0.75, -0.5, 0.5, 0.75]) rrect(c, x - 0.08, -0.12, 0.16, 0.12, 0.03, '#2b2420');
  // Körper
  rrect(c, -0.95, -1.42, 1.9, 0.82, 0.32, lin(c, 0, -1.42, 0, -0.6, [[0, body], [1, bw ? '#d9d5cc' : '#6f4629']]));
  if (bw) {
    for (let i = 0; i < 4; i++) {
      const x = -0.7 + r() * 1.3;
      const y = -1.3 + r() * 0.5;
      c.beginPath(); c.ellipse(x, y, between(r, 0.15, 0.3), between(r, 0.12, 0.22), r(), 0, Math.PI * 2); c.fillStyle = dark; c.fill();
    }
  }
  c.beginPath(); c.ellipse(0.25, -0.62, 0.16, 0.08, 0, 0, Math.PI * 2); c.fillStyle = '#e9b4a8'; c.fill();
  // Schwanz
  c.strokeStyle = dark; c.lineWidth = 0.05;
  c.beginPath(); c.moveTo(0.95, -1.3); c.quadraticCurveTo(1.1, -1, 1.02, -0.6); c.stroke();
  circle(c, 1.02, -0.58, 0.06, '#2b2420');
  // Kopf
  const hx = -1.18;
  const hy = grazing ? -0.55 : -1.35;
  rrect(c, hx - 0.25, hy - 0.22, 0.5, 0.45, 0.16, body);
  rrect(c, hx - 0.33, hy + 0.02, 0.32, 0.26, 0.1, bw ? '#e8c9c0' : '#c9a07e');
  circle(c, hx - 0.25, hy + 0.12, 0.03, '#3a2a20');
  c.strokeStyle = '#efe6d0'; c.lineWidth = 0.05;
  c.beginPath(); c.moveTo(hx - 0.05, hy - 0.2); c.quadraticCurveTo(hx + 0.05, hy - 0.42, hx - 0.12, hy - 0.45); c.stroke();
  poly(c, [hx + 0.1, hy - 0.15, hx + 0.35, hy - 0.22, hx + 0.12, hy - 0.02], dark);
  circle(c, hx - 0.06, hy - 0.08, 0.035, '#111');
  // Glocke
  c.strokeStyle = '#6b4a2a'; c.lineWidth = 0.06;
  c.beginPath(); c.moveTo(hx + 0.2, hy + 0.15); c.lineTo(hx + 0.35, hy + 0.35); c.stroke();
  poly(c, [hx + 0.28, hy + 0.32, hx + 0.46, hy + 0.32, hx + 0.5, hy + 0.55, hx + 0.24, hy + 0.55], '#d9a520');
};

const hay: DrawFn = (c) => {
  rrect(c, -0.85, -1.3, 1.7, 1.3, 0.3, lin(c, -0.8, 0, 0.8, 0, [[0, '#e7c66b'], [1, '#b8953e']]));
  c.strokeStyle = 'rgba(120,90,30,0.4)';
  c.lineWidth = 0.04;
  c.beginPath();
  for (let a = 0; a < 18; a += 0.4) {
    const rr = a * 0.035;
    c.lineTo(-0.05 + Math.cos(a) * rr, -0.65 + Math.sin(a) * rr);
  }
  c.stroke();
};

// ------------------------------------------------------------------ Menschen

const SHIRTS = ['#e63980', '#2f80ed', '#f2c94c', '#27ae60', '#ffffff', '#eb5757', '#9b51e0', '#f2994a', '#111111', '#56ccf2', '#ff8fb8', '#219653'];
const SKIN = ['#f1c7a5', '#e0ac85', '#c68b62', '#8d5a3b', '#f6d5bd'];
const FLAGS: string[][] = [['#1f8a4c', '#f4f4f4', '#d23a3a'], ['#ff5fa2'], ['#ffd23f'], ['#2f80ed', '#ffffff'], ['#111111', '#ffd23f', '#d23a3a'], ['#d23a3a', '#ffffff']];

function person(c: Ctx, r: Rng, x: number, scale: number, frame: number, flag: string[] | null) {
  const h = 1.7 * scale;
  const shirt = SHIRTS[Math.floor(r() * SHIRTS.length)];
  const skin = SKIN[Math.floor(r() * SKIN.length)];
  const pants = ['#2b3a55', '#3a3a3a', '#7a6a55', '#1e2a44', '#e0dccf'][Math.floor(r() * 5)];
  const up = frame === 1 ? r() < 0.75 : r() < 0.2;
  // Beine
  rrect(c, x - 0.17 * scale, -h * 0.48, 0.15 * scale, h * 0.48, 0.05, pants);
  rrect(c, x + 0.02 * scale, -h * 0.48, 0.15 * scale, h * 0.48, 0.05, pants);
  // Oberkörper
  rrect(c, x - 0.22 * scale, -h * 0.82, 0.44 * scale, h * 0.38, 0.1 * scale, shirt);
  // Arme
  c.strokeStyle = skin;
  c.lineWidth = 0.09 * scale;
  if (up) {
    c.beginPath(); c.moveTo(x - 0.2 * scale, -h * 0.78); c.lineTo(x - 0.34 * scale, -h * 1.02); c.stroke();
    c.beginPath(); c.moveTo(x + 0.2 * scale, -h * 0.78); c.lineTo(x + 0.36 * scale, -h * 1.04); c.stroke();
  } else {
    c.beginPath(); c.moveTo(x - 0.21 * scale, -h * 0.78); c.lineTo(x - 0.3 * scale, -h * 0.55); c.stroke();
    c.beginPath(); c.moveTo(x + 0.21 * scale, -h * 0.78); c.lineTo(x + 0.3 * scale, -h * 0.56); c.stroke();
  }
  // Kopf
  circle(c, x, -h * 0.9, 0.12 * scale, skin);
  const hat = r();
  if (hat < 0.3) {
    poly(c, [x - 0.13 * scale, -h * 0.93, x + 0.13 * scale, -h * 0.93, x + 0.11 * scale, -h * 1.0, x - 0.11 * scale, -h * 1.0], ['#ff5fa2', '#ffffff', '#222', '#2f80ed'][Math.floor(r() * 4)]);
  } else {
    c.beginPath(); c.arc(x, -h * 0.91, 0.125 * scale, Math.PI * 1.05, Math.PI * 1.95); c.fillStyle = ['#3a2a1a', '#1a1a1a', '#8a6a3a', '#c9a060', '#777'][Math.floor(r() * 5)]; c.fill();
  }
  if (flag) {
    const fx = x + 0.36 * scale;
    const top = -h * 1.55;
    c.strokeStyle = '#555';
    c.lineWidth = 0.04;
    c.beginPath(); c.moveTo(fx, -h * 0.98); c.lineTo(fx, top); c.stroke();
    const wv = frame === 1 ? 0.12 : -0.08;
    const fw = 0.9 * scale;
    const fh = 0.55 * scale;
    const n = flag.length;
    for (let i = 0; i < n; i++) {
      const x0 = fx + (fw * i) / n;
      const x1 = fx + (fw * (i + 1)) / n;
      const y0 = top + Math.sin(i * 1.4) * wv;
      const y1 = top + Math.sin((i + 1) * 1.4) * wv;
      poly(c, [x0, y0, x1, y1, x1, y1 + fh, x0, y0 + fh], flag[i]);
    }
  }
}

const crowd: DrawFn = (c, r, _v, frame) => {
  const n = 6;
  const people: number[] = [];
  for (let i = 0; i < n; i++) people.push(-1.7 + (3.4 * i) / (n - 1) + (r() - 0.5) * 0.3);
  // hintere Reihe zuerst
  const order = people.map((x, i) => ({ x, s: between(r, 0.92, 1.1) * (i % 2 ? 0.96 : 1), flag: r() < 0.3 ? FLAGS[Math.floor(r() * FLAGS.length)] : null }));
  for (const p of order) person(c, mulberry32(Math.floor(p.x * 1000 + 7)), p.x, p.s, frame, p.flag);
};

// ------------------------------------------------------------------ Straßenmöbel

const snowpole: DrawFn = (c) => {
  for (let i = 0; i < 6; i++) rrect(c, -0.05, -2 + i * 0.33, 0.1, 0.34, 0.02, i % 2 ? '#ffffff' : '#e03131');
};

const chevron: DrawFn = (c, _r, v) => {
  rrect(c, -0.04, -1.1, 0.08, 1.1, 0.02, '#8a8f96');
  if (v === 9) {
    poly(c, [0, -1.95, 0.55, -1.05, -0.55, -1.05], '#d62a2a');
    poly(c, [0, -1.8, 0.42, -1.12, -0.42, -1.12], '#ffffff');
    c.beginPath(); c.moveTo(-0.3, -1.2); c.quadraticCurveTo(0, -1.55, 0.3, -1.2); c.lineTo(-0.3, -1.2); c.fillStyle = '#111'; c.fill();
    return;
  }
  rrect(c, -0.45, -1.7, 0.9, 0.65, 0.04, '#d62a2a');
  c.strokeStyle = '#ffffff';
  c.lineWidth = 0.1;
  for (const dx of [-0.2, 0.12]) {
    c.beginPath(); c.moveTo(dx - 0.08, -1.58); c.lineTo(dx + 0.12, -1.375); c.lineTo(dx - 0.08, -1.17); c.stroke();
  }
};

const lamp: DrawFn = (c) => {
  rrect(c, -0.07, -4.8, 0.14, 4.8, 0.04, '#2d3238');
  rrect(c, -0.14, -0.6, 0.28, 0.6, 0.05, '#2d3238');
  c.strokeStyle = '#2d3238';
  c.lineWidth = 0.08;
  c.beginPath(); c.moveTo(0, -4.7); c.quadraticCurveTo(0.1, -5.15, 0.55, -5.05); c.stroke();
  poly(c, [0.35, -5.05, 0.75, -5.05, 0.68, -4.8, 0.42, -4.8], '#2d3238');
  poly(c, [0.42, -4.8, 0.68, -4.8, 0.62, -4.62, 0.48, -4.62], '#fff2c4');
};

const parasol: DrawFn = (c, _r, v) => {
  const col = ['#c0392b', '#2e7d4f', '#1f5fbf', '#b8860b'][v % 4];
  rrect(c, -0.03, -2.3, 0.06, 2.3, 0.02, '#888');
  for (let i = 0; i < 6; i++) {
    const a0 = -1.3 + (i * 2.6) / 6;
    const a1 = -1.3 + ((i + 1) * 2.6) / 6;
    poly(c, [0, -2.55, a0, -1.95, a1, -1.95], i % 2 ? '#ffffff' : col);
  }
  rrect(c, -0.45, -0.75, 0.9, 0.06, 0.02, '#ddd');
  rrect(c, -0.04, -0.75, 0.08, 0.75, 0.02, '#999');
  for (const x of [-0.85, 0.65]) { rrect(c, x, -0.5, 0.22, 0.05, 0.02, '#8a6a4a'); rrect(c, x + (x < 0 ? 0 : 0.18), -0.95, 0.04, 0.95, 0.01, '#8a6a4a'); }
};

const boat: DrawFn = (c, _r, v) => {
  poly(c, [-1.8, -0.5, 1.8, -0.5, 1.3, 0, -1.3, 0], '#f4f4f4');
  c.fillStyle = ['#1f5fbf', '#c0392b', '#2e7d4f', '#222'][v % 4];
  c.fillRect(-1.6, -0.35, 3.2, 0.08);
  rrect(c, -0.03, -4.4, 0.06, 3.9, 0.02, '#ccc');
  poly(c, [0.06, -4.3, 1.5, -0.7, 0.06, -0.7], lin(c, 0, -4, 1.5, -0.7, [[0, '#ffffff'], [1, '#e2e2e2']]));
  poly(c, [-0.06, -3.6, -1.1, -0.7, -0.06, -0.7], '#f0f0f0');
};

const logs: DrawFn = (c, r) => {
  for (let row = 0; row < 3; row++) {
    const n = 5 - row;
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.48;
      const y = -0.24 - row * 0.42;
      circle(c, x, y, 0.23, '#b98c5a');
      c.strokeStyle = 'rgba(110,70,30,0.6)';
      c.lineWidth = 0.025;
      c.beginPath(); c.arc(x, y, 0.13 + r() * 0.03, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(x, y, 0.06, 0, Math.PI * 2); c.stroke();
    }
  }
};

const fountain: DrawFn = (c) => {
  rrect(c, -0.95, -0.6, 1.9, 0.6, 0.12, '#b8b0a2');
  rrect(c, -0.85, -0.6, 1.7, 0.12, 0.05, '#7fb6d6');
  rrect(c, -0.12, -1.35, 0.24, 0.8, 0.05, '#a8a092');
  circle(c, 0, -1.4, 0.2, '#b8b0a2');
  c.strokeStyle = 'rgba(160,210,240,0.9)';
  c.lineWidth = 0.05;
  c.beginPath(); c.moveTo(0, -1.55); c.quadraticCurveTo(0.4, -1.9, 0.65, -0.65); c.moveTo(0, -1.55); c.quadraticCurveTo(-0.4, -1.9, -0.65, -0.65); c.stroke();
};

const flagpole: DrawFn = (c, _r, v, frame) => {
  rrect(c, -0.04, -7, 0.08, 7, 0.02, '#c9ccd1');
  const cols = [['#ff5fa2'], ['#1f8a4c', '#f4f4f4', '#d23a3a'], ['#ffd23f'], ['#2f80ed']][v % 4];
  const wv = frame ? 0.18 : -0.12;
  const n = 6;
  for (let i = 0; i < n; i++) {
    const x0 = 0.04 + (1.4 * i) / n;
    const x1 = 0.04 + (1.4 * (i + 1)) / n;
    const y0 = -6.9 + Math.sin(i * 0.9 + (frame ? 1 : 0)) * wv;
    const y1 = -6.9 + Math.sin((i + 1) * 0.9 + (frame ? 1 : 0)) * wv;
    poly(c, [x0, y0, x1, y1, x1, y1 + 0.9, x0, y0 + 0.9], cols[Math.floor((i / n) * cols.length)]);
  }
};

const campervan: DrawFn = (c, _r, v) => {
  rrect(c, -2.4, -2.6, 4.8, 2.2, 0.3, '#f2f2ef');
  rrect(c, -2.4, -1.15, 4.8, 0.25, 0.05, ['#2f80ed', '#e63980', '#27ae60', '#f2994a'][v % 4]);
  rrect(c, 1.3, -2.25, 0.9, 0.7, 0.1, '#3a4a5a');
  rrect(c, -1.8, -2.1, 1, 0.55, 0.08, '#3a4a5a');
  rrect(c, -0.4, -2.1, 1, 0.55, 0.08, '#3a4a5a');
  circle(c, -1.5, -0.38, 0.38, '#222'); circle(c, 1.5, -0.38, 0.38, '#222');
  circle(c, -1.5, -0.38, 0.16, '#aaa'); circle(c, 1.5, -0.38, 0.16, '#aaa');
  rrect(c, -2.1, -3.0, 0.05, 0.6, 0.01, '#777');
  poly(c, [-2.05, -3.0, -1.3, -2.9, -2.05, -2.7], '#ff5fa2');
};

const fencePost: DrawFn = (c) => {
  rrect(c, -0.07, -1.15, 0.14, 1.15, 0.03, '#7a5634');
  poly(c, [-0.07, -1.15, 0, -1.25, 0.07, -1.15], '#6a4a2c');
};

const vinerow: DrawFn = (c, r) => {
  rrect(c, -0.03, -1.6, 0.06, 1.6, 0.01, '#6b5240');
  for (let i = 0; i < 14; i++) {
    const x = (r() - 0.5) * 1.0;
    const y = -0.7 - r() * 0.8;
    circle(c, x, y, between(r, 0.18, 0.3), i % 3 ? '#5f8a2c' : '#77a33a');
  }
  for (let i = 0; i < 4; i++) {
    const x = (r() - 0.5) * 0.8;
    for (let j = 0; j < 5; j++) circle(c, x + (j % 2) * 0.05, -0.75 + j * 0.05, 0.04, '#4b2a5a');
  }
};

const sunflowers: DrawFn = (c, r) => {
  for (let i = 0; i < 6; i++) {
    const x = -1 + (i * 2) / 5 + (r() - 0.5) * 0.2;
    const h = between(r, 1.3, 1.8);
    c.strokeStyle = '#4f7f2a'; c.lineWidth = 0.05;
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, -h); c.stroke();
    poly(c, [x, -h * 0.5, x - 0.3, -h * 0.58, x - 0.1, -h * 0.46], '#5c8f30');
    poly(c, [x, -h * 0.7, x + 0.3, -h * 0.76, x + 0.1, -h * 0.64], '#5c8f30');
    for (let p = 0; p < 12; p++) {
      const a = (p / 12) * Math.PI * 2;
      c.beginPath(); c.ellipse(x + Math.cos(a) * 0.17, -h + Math.sin(a) * 0.17, 0.09, 0.04, a, 0, Math.PI * 2); c.fillStyle = '#f6c21c'; c.fill();
    }
    circle(c, x, -h, 0.12, '#5a3a1a');
  }
};

// ------------------------------------------------------------------ Katalog

const DEFS: Record<string, Def> = {
  pine: { w: 5.4, h: 12.5, ppm: 22, variants: 4, draw: (c, r, v) => { const col = PINE_COLS[v % 4]; pineShape(c, r, 12, 5, col[0], col[1], col[2], false); } },
  pineSnow: { w: 5.4, h: 12.5, ppm: 22, variants: 2, draw: (c, r, v) => { const col = PINE_COLS[v % 4]; pineShape(c, r, 12, 5, col[0], col[1], col[2], true); } },
  larch: { w: 4.4, h: 11.5, ppm: 22, variants: 2, draw: (c, r) => pineShape(c, r, 11, 4, '#4b6b24', '#6f9134', '#9cbb4c', false) },
  tree: { w: 6.6, h: 7.6, ppm: 30, variants: 4, draw: tree },
  treeRound: { w: 3.2, h: 5.2, ppm: 40, variants: 4, draw: treeRound },
  cypress: { w: 1.8, h: 9.8, ppm: 26, variants: 2, draw: cypress },
  palm: { w: 6.6, h: 8.6, ppm: 28, variants: 2, draw: palm },
  olive: { w: 3.6, h: 4.4, ppm: 40, variants: 2, draw: olive },
  bush: { w: 1.9, h: 1.2, ppm: 70, variants: 4, draw: bush },
  flowers: { w: 1.6, h: 0.65, ppm: 80, variants: 4, draw: flowers },
  grassTuft: { w: 1, h: 0.85, ppm: 80, variants: 2, draw: grassTuft },
  rock: { w: 1.6, h: 1.1, ppm: 70, variants: 3, draw: (c, r) => rockShape(c, r, 0.75, 1.0, '#8e8a82', '#b4b0a7', '#5f5b55', false) },
  boulder: { w: 3.6, h: 2.6, ppm: 40, variants: 3, draw: (c, r) => rockShape(c, r, 1.7, 2.4, '#8a867c', '#aeaaa0', '#5a564f', true) },
  snowpole: { w: 0.2, h: 2.05, ppm: 70, variants: 1, draw: snowpole },
  chalet: { w: 10.6, h: 8.2, ppm: 20, variants: 2, draw: chalet(false) },
  chaletLit: { w: 10.6, h: 8.2, ppm: 20, variants: 2, draw: chalet(true) },
  barn: { w: 7.2, h: 6.2, ppm: 22, variants: 2, draw: barn },
  rifugio: { w: 12, h: 9.8, ppm: 18, variants: 1, draw: rifugio(false) },
  rifugioLit: { w: 12, h: 9.8, ppm: 18, variants: 1, draw: rifugio(true) },
  farmhouse: { w: 11, h: 9.4, ppm: 18, variants: 1, draw: farmhouse(false) },
  farmhouseLit: { w: 11, h: 9.4, ppm: 18, variants: 1, draw: farmhouse(true) },
  cow: { w: 2.8, h: 1.85, ppm: 70, variants: 2, draw: cow(false) },
  cowBW: { w: 2.8, h: 1.85, ppm: 70, variants: 2, draw: cow(true) },
  hay: { w: 1.8, h: 1.35, ppm: 60, variants: 1, draw: hay },
  fence: { w: 0.3, h: 1.3, ppm: 60, variants: 1, draw: fencePost },
  vinerow: { w: 1.3, h: 1.65, ppm: 60, variants: 1, draw: vinerow },
  sunflowers: { w: 2.6, h: 2.0, ppm: 55, variants: 2, draw: sunflowers },
  crowd: { w: 4.6, h: 2.9, ppm: 56, variants: 4, frames: 2, draw: crowd },
  chevron: { w: 1.2, h: 2.0, ppm: 70, variants: 1, draw: chevron },
  dosso: { w: 1.2, h: 2.0, ppm: 70, variants: 1, draw: (c, r) => chevron(c, r, 9, 0) },
  lamp: { w: 1.6, h: 5.3, ppm: 40, variants: 1, draw: lamp },
  parasol: { w: 2.8, h: 2.6, ppm: 50, variants: 4, draw: parasol },
  boat: { w: 3.8, h: 4.5, ppm: 30, variants: 4, draw: boat },
  logs: { w: 2.6, h: 1.4, ppm: 60, variants: 1, draw: logs },
  fountain: { w: 2.2, h: 2.0, ppm: 60, variants: 1, draw: fountain },
  flagpole: { w: 3.2, h: 7.1, ppm: 30, variants: 4, frames: 2, draw: flagpole },
  campervan: { w: 5, h: 3.1, ppm: 40, variants: 4, draw: campervan },
};

const LIT_VARIANT: Partial<Record<string, string>> = { chalet: 'chaletLit', rifugio: 'rifugioLit', farmhouse: 'farmhouseLit' };

export class SpriteBank {
  private cache = new Map<string, SpriteImg>();
  private text = new Map<string, SpriteImg>();

  get(kind: SpriteKind | 'dosso', v: number, frame = 0, lit = false): SpriteImg | null {
    const name = lit && LIT_VARIANT[kind] ? LIT_VARIANT[kind]! : kind;
    const def = DEFS[name];
    if (!def) return null;
    const vv = v % def.variants;
    const ff = def.frames ? frame % def.frames : 0;
    const key = `${name}:${vv}:${ff}`;
    let s = this.cache.get(key);
    if (!s) {
      s = { img: render(def, vv, ff), w: def.w, h: def.h };
      this.cache.set(key, s);
    }
    return s;
  }

  /** alle Varianten vorab zeichnen, damit es beim Fahren nicht ruckelt */
  warm() {
    for (const [name, def] of Object.entries(DEFS)) {
      for (let v = 0; v < def.variants; v++) for (let f = 0; f < (def.frames ?? 1); f++) {
        const key = `${name}:${v}:${f}`;
        if (!this.cache.has(key)) this.cache.set(key, { img: render(def, v, f), w: def.w, h: def.h });
      }
    }
  }

  /** Schilder mit Text: Kehre, Ortsschild, Passschild */
  label(kind: 'tornante' | 'townSign' | 'passSign', text: string, sub = ''): SpriteImg {
    const key = `${kind}:${text}:${sub}`;
    let s = this.text.get(key);
    if (s) return s;
    const ppm = 90;
    let w = 1.2;
    let h = 2.3;
    if (kind === 'townSign') { w = 2.6; h = 2.1; }
    if (kind === 'passSign') { w = 3.0; h = 2.7; }
    const def: Def = {
      w, h, ppm, variants: 1, draw: (c) => {
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        if (kind === 'tornante') {
          rrect(c, -0.04, -1.3, 0.08, 1.3, 0.02, '#8a8f96');
          rrect(c, -0.52, -2.25, 1.04, 1.02, 0.08, '#ffffff');
          c.strokeStyle = '#1a1a1a'; c.lineWidth = 0.05;
          c.beginPath(); c.roundRect(-0.46, -2.19, 0.92, 0.9, 0.06); c.stroke();
          c.fillStyle = '#1a1a1a';
          c.font = `700 0.15px ${FONT}`;
          c.fillText('TORNANTE', 0, -2.04);
          c.font = `800 0.52px ${FONT}`;
          c.fillText(text, 0, -1.68);
          if (sub) { c.font = `600 0.12px ${FONT}`; c.fillText(sub, 0, -1.39); }
        } else if (kind === 'townSign') {
          rrect(c, -1.1, -1.0, 0.07, 1.0, 0.02, '#8a8f96');
          rrect(c, 1.03, -1.0, 0.07, 1.0, 0.02, '#8a8f96');
          rrect(c, -1.25, -2.0, 2.5, 1.05, 0.06, '#ffffff');
          c.strokeStyle = '#1a1a1a'; c.lineWidth = 0.05;
          c.beginPath(); c.roundRect(-1.18, -1.93, 2.36, 0.91, 0.04); c.stroke();
          c.fillStyle = '#1a1a1a';
          fitFont(c, text.toUpperCase(), 2.1, 0.42, 0.02, 0.18, (fs) => `800 ${fs}px ${FONT}`);
          c.fillText(text.toUpperCase(), 0, -1.48);
        } else {
          rrect(c, -0.06, -1.3, 0.12, 1.3, 0.02, '#6b6f75');
          rrect(c, -1.45, -2.65, 2.9, 1.4, 0.1, '#6b3f22');
          c.strokeStyle = '#f4efe4'; c.lineWidth = 0.05;
          c.beginPath(); c.roundRect(-1.36, -2.56, 2.72, 1.22, 0.07); c.stroke();
          c.fillStyle = '#f4efe4';
          fitFont(c, text, 2.5, 0.36, 0.02, 0.16, (fs) => `800 ${fs}px ${FONT}`);
          c.fillText(text, 0, -2.12);
          c.font = `600 0.26px ${FONT}`;
          c.fillText(sub, 0, -1.66);
        }
      },
    };
    s = { img: render(def, 0, 0), w, h };
    if (this.text.size > 80) this.text.clear();
    this.text.set(key, s);
    return s;
  }
}

// ------------------------------------------------------------------ Texturen (Detail über der Grundfarbe)

export interface Tex { levels: HTMLCanvasElement[]; ppm: number }

function noiseTex(size: number, fn: (c: Ctx, img: ImageData, r: Rng) => void, seed: number): HTMLCanvasElement {
  const cv = canvas(size, size);
  const c = cv.getContext('2d')!;
  const img = c.createImageData(size, size);
  fn(c, img, mulberry32(seed));
  return cv;
}

function grain(img: ImageData, r: Rng, amount: number, alpha: number) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (r() - 0.5) * 2;
    const a = Math.abs(v) * amount;
    const light = v > 0;
    d[i] = d[i + 1] = d[i + 2] = light ? 255 : 0;
    d[i + 3] = Math.min(255, a * alpha);
  }
}

export function makeTextures(): { surface: Record<Surface, Tex>; ground: Partial<Record<Ground, Tex>>; verge: Tex } {
  const S = 256;
  const asphalt = noiseTex(S, (c, img, r) => {
    grain(img, r, 1, 30);
    c.putImageData(img, 0, 0);
    for (let i = 0; i < 260; i++) {
      c.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.14)';
      c.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
    }
    c.strokeStyle = 'rgba(0,0,0,0.22)';
    c.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      let x = r() * S;
      let y = r() * S;
      c.moveTo(x, y);
      for (let j = 0; j < 8; j++) { x += (r() - 0.5) * 30; y += r() * 18; c.lineTo(x, y); }
      c.stroke();
    }
  }, 11);
  const fresh = noiseTex(S, (c, img, r) => { grain(img, r, 0.7, 40); c.putImageData(img, 0, 0); }, 12);
  const cobble = noiseTex(S, (c, _img, r) => {
    const rows = 22;
    const rh = S / rows;
    for (let row = 0; row < rows; row++) {
      const off = (row % 2) * rh * 0.6;
      for (let x = -rh + off; x < S + rh; x += rh * 1.15) {
        const w = rh * between(r, 0.9, 1.15);
        const h = rh * between(r, 0.82, 0.95);
        c.fillStyle = `rgba(0,0,0,${between(r, 0.0, 0.18).toFixed(2)})`;
        c.beginPath(); c.roundRect(x, row * rh + 1, w, h, rh * 0.32); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.16)';
        c.beginPath(); c.roundRect(x + 1.5, row * rh + 2, w * 0.6, h * 0.35, rh * 0.2); c.fill();
      }
      c.fillStyle = 'rgba(0,0,0,0.38)';
      c.fillRect(0, row * rh, S, 1.2);
    }
  }, 13);
  const gravel = noiseTex(S, (c, img, r) => {
    grain(img, r, 1, 45);
    c.putImageData(img, 0, 0);
    for (let i = 0; i < 900; i++) {
      c.fillStyle = r() < 0.55 ? 'rgba(90,70,40,0.35)' : 'rgba(255,250,235,0.45)';
      const s = 1 + r() * 3;
      c.beginPath(); c.ellipse(r() * S, r() * S, s, s * 0.7, r() * 3, 0, Math.PI * 2); c.fill();
    }
    // Fahrspuren
    c.fillStyle = 'rgba(80,60,30,0.14)';
    c.fillRect(S * 0.22, 0, S * 0.12, S);
    c.fillRect(S * 0.66, 0, S * 0.12, S);
  }, 14);
  const grass = (seed: number, flowersCol: string[], blade: number) => noiseTex(S, (c, img, r) => {
    grain(img, r, 1, 38);
    c.putImageData(img, 0, 0);
    c.lineWidth = 1;
    for (let i = 0; i < 1400; i++) {
      const x = r() * S;
      const y = r() * S;
      c.strokeStyle = r() < 0.5 ? `rgba(0,40,0,${0.18 * blade})` : `rgba(230,255,190,${0.16 * blade})`;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 3, y - 3 - r() * 4); c.stroke();
    }
    for (let i = 0; i < 140 && flowersCol.length; i++) {
      c.fillStyle = flowersCol[Math.floor(r() * flowersCol.length)];
      c.fillRect(r() * S, r() * S, 2, 2);
    }
  }, seed);
  const meadow = grass(21, ['rgba(255,255,255,0.8)', 'rgba(255,214,60,0.85)', 'rgba(190,120,255,0.7)', 'rgba(255,90,90,0.7)'], 1);
  const forest = noiseTex(S, (c, img, r) => {
    grain(img, r, 1, 60);
    c.putImageData(img, 0, 0);
    for (let i = 0; i < 70; i++) {
      c.fillStyle = r() < 0.5 ? 'rgba(90,60,30,0.25)' : 'rgba(120,170,70,0.22)';
      c.beginPath(); c.ellipse(r() * S, r() * S, 6 + r() * 14, 3 + r() * 7, 0, 0, Math.PI * 2); c.fill();
    }
    c.strokeStyle = 'rgba(70,45,20,0.35)';
    for (let i = 0; i < 500; i++) { const x = r() * S; const y = r() * S; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 6, y + (r() - 0.5) * 3); c.stroke(); }
  }, 22);
  const snow = noiseTex(S, (c, img, r) => {
    grain(img, r, 0.6, 30);
    c.putImageData(img, 0, 0);
    c.strokeStyle = 'rgba(120,150,190,0.18)';
    c.lineWidth = 2;
    for (let i = 0; i < 40; i++) { const y = r() * S; c.beginPath(); c.moveTo(r() * S, y); c.quadraticCurveTo(r() * S, y + (r() - 0.5) * 20, r() * S, y + (r() - 0.5) * 12); c.stroke(); }
  }, 23);
  const rockT = noiseTex(S, (c, img, r) => {
    grain(img, r, 1, 70);
    c.putImageData(img, 0, 0);
    for (let i = 0; i < 160; i++) {
      c.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.14)';
      const x = r() * S; const y = r() * S; const s = 3 + r() * 12;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + s, y + s * 0.3); c.lineTo(x + s * 0.4, y + s); c.closePath(); c.fill();
    }
  }, 24);
  const pavement = noiseTex(S, (c, img, r) => {
    grain(img, r, 0.8, 30);
    c.putImageData(img, 0, 0);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    const n = 6;
    for (let i = 0; i <= n; i++) c.fillRect(0, (i * S) / n, S, 1.5);
    for (let row = 0; row < n; row++) for (let i = 0; i < 4; i++) c.fillRect(((i + (row % 2) * 0.5) * S) / 4, (row * S) / n, 1.5, S / n);
  }, 25);
  const field = noiseTex(S, (c, img, r) => {
    grain(img, r, 1, 40);
    c.putImageData(img, 0, 0);
    c.strokeStyle = 'rgba(120,90,20,0.25)';
    c.lineWidth = 1;
    for (let x = 0; x < S; x += 6) { c.beginPath(); c.moveTo(x + r() * 2, 0); c.lineTo(x + r() * 2, S); c.stroke(); }
  }, 26);
  const vines = noiseTex(S, (c, img, r) => {
    grain(img, r, 1, 40);
    c.putImageData(img, 0, 0);
    for (let x = 0; x < S; x += 32) {
      c.fillStyle = 'rgba(110,70,40,0.35)';
      c.fillRect(x, 0, 12, S);
    }
  }, 27);
  const water = noiseTex(S, (c, _img, r) => {
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.lineWidth = 1.5;
    for (let i = 0; i < 90; i++) { const y = r() * S; const x = r() * S; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 8, y - 2, x + 16 + r() * 10, y); c.stroke(); }
    c.strokeStyle = 'rgba(0,30,60,0.18)';
    for (let i = 0; i < 60; i++) { const y = r() * S; const x = r() * S; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 8, y + 2, x + 18, y); c.stroke(); }
  }, 28);
  const vergeT = noiseTex(S, (c, img, r) => {
    grain(img, r, 1, 60);
    c.putImageData(img, 0, 0);
    for (let i = 0; i < 500; i++) { c.fillStyle = r() < 0.5 ? 'rgba(60,45,25,0.4)' : 'rgba(255,245,225,0.35)'; c.fillRect(r() * S, r() * S, 2, 2); }
  }, 29);

  // Mip-Stufen gegen Flimmern in der Ferne
  const T = (img: HTMLCanvasElement, metres: number): Tex => {
    const levels = [img];
    let cur = img;
    while (cur.width > 16) {
      const nx = canvas(cur.width / 2, cur.height / 2);
      const c = nx.getContext('2d')!;
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.drawImage(cur, 0, 0, nx.width, nx.height);
      levels.push(nx);
      cur = nx;
    }
    return { levels, ppm: S / metres };
  };
  return {
    surface: { asphalt: T(asphalt, 2.6), fresh: T(fresh, 2.6), cobble: T(cobble, 3.2), gravel: T(gravel, 4) },
    ground: {
      meadow: T(meadow, 7), forest: T(forest, 8), snow: T(snow, 10), rock: T(rockT, 6), pavement: T(pavement, 4),
      field: T(field, 6), vines: T(vines, 8), sunflower: T(meadow, 7), water: T(water, 14),
    },
    verge: T(vergeT, 4),
  };
}

// ------------------------------------------------------------------ Kleinkram

export function glow(color: string, size = 64): HTMLCanvasElement {
  const cv = canvas(size, size);
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  return cv;
}

export function cloud(seed: number): HTMLCanvasElement {
  const W = 360;
  const H = 140;
  const cv = canvas(W, H);
  const c = cv.getContext('2d')!;
  const r = mulberry32(seed);
  for (let i = 0; i < 16; i++) {
    const x = 50 + r() * (W - 100);
    const y = 60 + (r() - 0.3) * 40;
    const rr = 26 + r() * 40;
    const g = c.createRadialGradient(x, y - rr * 0.3, 0, x, y, rr);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.6, 'rgba(250,252,255,0.7)');
    g.addColorStop(1, 'rgba(240,245,250,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, rr, 0, Math.PI * 2); c.fill();
  }
  c.globalCompositeOperation = 'source-atop';
  c.fillStyle = 'rgba(120,140,170,0.18)';
  c.fillRect(0, H * 0.62, W, H);
  return cv;
}

/** Text als Straßenmalerei (weiß, leicht verwittert), lang gezogen für die Perspektive */
/** Verwitterung (abgeplatzte Farbe) einmal malen; jede Schrift nimmt einen anderen Ausschnitt */
let weatherCv: HTMLCanvasElement | null = null;
/** Vorlage schon beim Start malen (nicht erst bei der ersten Schrift auf der Straße) */
export function warmRoadText() { weather(); }
function weather(): HTMLCanvasElement {
  if (weatherCv) return weatherCv;
  const W = 1024;
  const H = 512;
  const cv = canvas(W, H);
  const c = cv.getContext('2d')!;
  const r = mulberry32(4711);
  // wie vorher je Schrift: 1600 Tupfer auf 512 × 512 (hier halb so hoch gestaucht, siehe roadText) – direkt in die
  // Pixel geschrieben (6400 einzelne Pfade zu zeichnen dauerte spürbar)
  const img = c.createImageData(W, H);
  const px = img.data;
  for (let i = 0; i < 6400; i++) {
    const a = Math.round((0.15 + r() * 0.45) * 255);
    const cx = r() * W;
    const cy = r() * H;
    const rx = 0.6 + r() * 1.6;
    const ry = (0.6 + r() * 1.6) / 2;
    for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(H - 1, Math.ceil(cy + ry)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(W - 1, Math.ceil(cx + rx)); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy > 1) continue;
        const o = (y * W + x) * 4 + 3;
        // übereinander: wie mehrfaches Abtragen
        px[o] = 255 - Math.round(((255 - px[o]) * (255 - a)) / 255);
      }
    }
  }
  c.putImageData(img, 0, 0);
  weatherCv = cv;
  return cv;
}

export function roadText(text: string): HTMLCanvasElement {
  // halb so hoch wie breit, die Schrift nur 1,1-fach gestreckt: dasselbe Bild auf der Straße, ein Viertel der Arbeit
  const W = 512;
  const H = 256;
  const cv = canvas(W, H);
  const c = cv.getContext('2d')!;
  c.fillStyle = 'rgba(255,255,255,0.92)';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  fitFont(c, text, W * 0.94, 150, 6, 40, (fs) => `900 ${fs}px ${FONT}`);
  c.save();
  c.translate(W / 2, H / 2);
  c.scale(1, 1.1);
  c.fillText(text, 0, 0);
  c.restore();
  // verwittern: ein Ausschnitt der gemeinsamen Vorlage (je Schrift ein anderer)
  c.globalCompositeOperation = 'destination-out';
  const h = hashText(text);
  c.drawImage(weather(), -(h % 512), -((h >>> 9) % 256));
  return cv;
}

export function roadArrow(dir: 'L' | 'R'): HTMLCanvasElement {
  const cv = canvas(128, 256);
  const c = cv.getContext('2d')!;
  c.fillStyle = 'rgba(255,255,255,0.9)';
  c.translate(64, 128);
  if (dir === 'L') c.scale(-1, 1);
  c.beginPath();
  c.moveTo(-14, 120); c.lineTo(14, 120); c.lineTo(14, -10); c.quadraticCurveTo(14, -50, 34, -60); c.lineTo(34, -30); c.lineTo(62, -82); c.lineTo(20, -118);
  c.lineTo(26, -86); c.quadraticCurveTo(-14, -70, -14, -10); c.closePath();
  c.fill();
  return cv;
}

function hashText(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
