/**
 * Figuren von „Akku leer!“ – gezeichnet in Körper-Koordinaten: Ursprung = Mitte, Einheit = Meter, y nach unten,
 * Blick nach rechts (Rennradler) bzw. nach links (E-Biker). Alles Vektor, damit es in jeder Größe scharf bleibt.
 */
import type { EnemyType, RiderType } from './level';

export const INK = '#1b1d24';
const SKIN = '#f3c6a2';
const SKIN_SH = '#dda07e';
const WHITE = '#ffffff';
const TAU = Math.PI * 2;

export type RiderMood = 'idle' | 'aim' | 'fly' | 'dizzy' | 'rest' | 'cheer' | 'dash' | 'dive';

export interface RiderLook {
  mood: RiderMood;
  blink: boolean;
  /** Pedal-Phase im Flug, null = steht/sitzt */
  pedal: number | null;
  standing: boolean;
  glasses: boolean;
  /** Teamfarbe (Wasserträger) */
  team: string;
  /** Blickrichtung (Einheitsvektor, y nach oben) */
  lookX: number;
  lookY: number;
  t: number;
}

const JERSEY: Record<RiderType, string> = {
  sprinter: '#27a845',
  floh: '#ffffff',
  wasser: '#7ab8ff',
  zeit: '#1f2547',
  gelb: '#ffd23f',
};
const JERSEY_SH: Record<RiderType, string> = {
  sprinter: '#1c8436',
  floh: '#e3e1dc',
  wasser: '#5b93d1',
  zeit: '#151a35',
  gelb: '#e8b51c',
};

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.001, rx), Math.max(0.001, ry), rot, 0, TAU);
}

/** Schatten auf der Kugel: unten links etwas dunkler */
function shade(ctx: CanvasRenderingContext2D, r: number, color: string) {
  ctx.save();
  circle(ctx, 0, 0, r);
  ctx.clip();
  ctx.fillStyle = color;
  circle(ctx, -r * 0.42, r * 0.5, r * 1.05);
  ctx.fill();
  ctx.restore();
}

function eye(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, lx: number, ly: number, blink: boolean, pupil = 0.5) {
  if (blink) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = ry * 0.32;
    ctx.beginPath();
    ctx.moveTo(x - rx, y);
    ctx.quadraticCurveTo(x, y + ry * 0.45, x + rx, y);
    ctx.stroke();
    return;
  }
  ctx.fillStyle = WHITE;
  ellipse(ctx, x, y, rx, ry);
  ctx.fill();
  ctx.lineWidth = rx * 0.16;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = INK;
  const pr = Math.min(rx, ry) * pupil;
  circle(ctx, x + lx * (rx - pr) * 0.75, y - ly * (ry - pr) * 0.75, pr);
  ctx.fill();
  ctx.fillStyle = WHITE;
  circle(ctx, x + lx * (rx - pr) * 0.75 + pr * 0.35, y - ly * (ry - pr) * 0.75 - pr * 0.35, pr * 0.32);
  ctx.fill();
}

/** Spiralaugen nach dem Aufprall */
function dizzyEye(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = s * 0.22;
  ctx.fillStyle = WHITE;
  circle(ctx, x, y, s);
  ctx.fill();
  ctx.beginPath();
  for (let i = 0; i <= 18; i++) {
    const a = t * 9 + i * 0.7;
    const rr = (i / 18) * s * 0.8;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

function legs(ctx: CanvasRenderingContext2D, r: number, pedal: number | null, standing: boolean) {
  ctx.lineCap = 'round';
  const hipY = r * 0.62;
  const shoe = (x: number, y: number) => {
    ctx.fillStyle = WHITE;
    ellipse(ctx, x + r * 0.07, y, r * 0.17, r * 0.09);
    ctx.fill();
    ctx.lineWidth = r * 0.05;
    ctx.strokeStyle = INK;
    ctx.stroke();
  };
  if (pedal !== null) {
    const cx = r * 0.05;
    const cy = r * 1.2;
    const R = r * 0.38;
    for (const k of [0, Math.PI]) {
      const a = pedal + k;
      const fx = cx + Math.cos(a) * R;
      const fy = cy + Math.sin(a) * R;
      const hx = k === 0 ? r * 0.12 : -r * 0.12;
      ctx.strokeStyle = INK;
      ctx.lineWidth = r * 0.2;
      ctx.beginPath();
      ctx.moveTo(hx, hipY);
      // Knie leicht nach vorn
      ctx.quadraticCurveTo((hx + fx) / 2 + r * 0.22, (hipY + fy) / 2, fx, fy);
      ctx.stroke();
      shoe(fx, fy);
    }
    return;
  }
  const y1 = standing ? r * 1.2 : r * 1.05;
  for (const sx of [-0.22, 0.2]) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = r * 0.17;
    ctx.beginPath();
    ctx.moveTo(sx * r, hipY);
    ctx.lineTo(sx * r * 1.05, y1);
    ctx.stroke();
    shoe(sx * r * 1.05, y1);
  }
}

/** Helmkuppel (oben auf der Kugel) */
function helmet(ctx: CanvasRenderingContext2D, r: number, color: string, vents: string, stripe?: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.07, Math.PI * 1.06, Math.PI * 1.97);
  ctx.quadraticCurveTo(r * 0.55, -r * 0.18, r * 0.05, -r * 0.3);
  ctx.quadraticCurveTo(-r * 0.6, -r * 0.42, -r * 1.06, -r * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = r * 0.06;
  ctx.strokeStyle = INK;
  ctx.stroke();
  if (stripe) {
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = stripe;
    ctx.lineWidth = r * 0.16;
    ctx.beginPath();
    ctx.arc(0, r * 0.15, r * 1.02, Math.PI * 1.2, Math.PI * 1.85);
    ctx.stroke();
    ctx.restore();
  }
  ctx.strokeStyle = vents;
  ctx.lineWidth = r * 0.1;
  for (const a of [1.32, 1.5, 1.68]) {
    const c = Math.cos(a * Math.PI);
    const s = Math.sin(a * Math.PI);
    ctx.beginPath();
    ctx.moveTo(c * r * 0.62, s * r * 0.62);
    ctx.lineTo(c * r * 0.9, s * r * 0.9);
    ctx.stroke();
  }
}

/** Gesicht vorn rechts (Haut), auf der Kugel */
function facePatch(ctx: CanvasRenderingContext2D, r: number) {
  ctx.save();
  circle(ctx, 0, 0, r);
  ctx.clip();
  ctx.fillStyle = SKIN;
  ellipse(ctx, r * 0.4, r * 0.08, r * 0.74, r * 0.66);
  ctx.fill();
  ctx.fillStyle = SKIN_SH;
  ellipse(ctx, r * 0.18, r * 0.62, r * 0.5, r * 0.16);
  ctx.fill();
  ctx.restore();
}

function mouth(ctx: CanvasRenderingContext2D, r: number, mood: RiderMood, t: number) {
  const mx = r * 0.55;
  const my = r * 0.36;
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.fillStyle = '#7a2a2a';
  ctx.lineWidth = r * 0.07;
  switch (mood) {
    case 'fly':
    case 'dive': {
      // Aaaah!
      const s = 1 + Math.sin(t * 30) * 0.08;
      ellipse(ctx, mx, my, r * 0.13 * s, r * 0.17 * s);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ff7a7a';
      ellipse(ctx, mx, my + r * 0.08, r * 0.08, r * 0.05);
      ctx.fill();
      break;
    }
    case 'dash':
    case 'aim': {
      // zusammengebissene Zähne
      ctx.fillStyle = WHITE;
      ctx.beginPath();
      ctx.roundRect(mx - r * 0.2, my - r * 0.07, r * 0.4, r * 0.15, r * 0.05);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = r * 0.035;
      ctx.beginPath();
      ctx.moveTo(mx - r * 0.2, my + 0.0);
      ctx.lineTo(mx + r * 0.2, my);
      for (const dx of [-0.1, 0, 0.1]) { ctx.moveTo(mx + dx * r, my - r * 0.07); ctx.lineTo(mx + dx * r, my + r * 0.08); }
      ctx.stroke();
      break;
    }
    case 'cheer': {
      ctx.beginPath();
      ctx.moveTo(mx - r * 0.22, my - r * 0.05);
      ctx.quadraticCurveTo(mx, my + r * 0.35, mx + r * 0.24, my - r * 0.06);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'dizzy': {
      ctx.beginPath();
      for (let i = 0; i <= 8; i++) {
        const x = mx - r * 0.2 + (i / 8) * r * 0.4;
        const y = my + Math.sin(i * 1.6 + t * 6) * r * 0.05;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      break;
    }
    default: {
      ctx.beginPath();
      ctx.moveTo(mx - r * 0.18, my - r * 0.02);
      ctx.quadraticCurveTo(mx, my + r * 0.12, mx + r * 0.2, my - r * 0.05);
      ctx.stroke();
    }
  }
}

function brows(ctx: CanvasRenderingContext2D, r: number, mood: RiderMood, y: number) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = r * 0.08;
  ctx.lineCap = 'round';
  const angry = mood === 'aim' || mood === 'dash' || mood === 'dive';
  const up = mood === 'fly';
  ctx.beginPath();
  ctx.moveTo(r * 0.06, y - (up ? r * 0.1 : 0) - (angry ? r * 0.04 : 0));
  ctx.lineTo(r * 0.34, y + (angry ? r * 0.07 : 0) - (up ? r * 0.12 : 0));
  ctx.moveTo(r * 0.5, y + (angry ? r * 0.07 : 0) - (up ? r * 0.12 : 0));
  ctx.lineTo(r * 0.78, y - (up ? r * 0.1 : 0) - (angry ? r * 0.06 : 0));
  ctx.stroke();
}

function shades(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, h: number, frame: string) {
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.roundRect(x0, y - h / 2, x1 - x0, h, h * 0.45);
  ctx.fill();
  ctx.fillStyle = frame;
  ctx.fillRect(x0, y - h / 2, x1 - x0, h * 0.18);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = h * 0.16;
  ctx.beginPath();
  ctx.moveTo(x0 + (x1 - x0) * 0.55, y + h * 0.25);
  ctx.lineTo(x0 + (x1 - x0) * 0.68, y - h * 0.22);
  ctx.stroke();
}

/** Rennradler (Kugel, Blick nach rechts) */
export function drawRider(ctx: CanvasRenderingContext2D, type: RiderType, r: number, k: RiderLook) {
  const jersey = type === 'wasser' ? k.team : JERSEY[type];
  if (k.pedal !== null || k.standing) legs(ctx, r, k.pedal, k.standing);

  // Zeitfahrhelm: lange Spitze nach hinten (unter der Kugel gezeichnet)
  if (type === 'zeit') {
    ctx.fillStyle = '#e8ecf5';
    ctx.beginPath();
    ctx.moveTo(r * 0.3, -r * 1.05);
    ctx.quadraticCurveTo(-r * 1.2, -r * 1.05, -r * 1.75, -r * 0.05);
    ctx.quadraticCurveTo(-r * 0.9, -r * 0.2, -r * 0.4, -r * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = r * 0.06;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
  // Flaschen im Trikot (Wasserträger)
  if (type === 'wasser') {
    for (const [bx, by, ba] of [[-0.85, -0.25, -0.5], [-0.98, 0.15, -0.9]] as const) {
      ctx.save();
      ctx.translate(bx * r, by * r);
      ctx.rotate(ba);
      ctx.fillStyle = '#e9f6ff';
      ctx.beginPath();
      ctx.roundRect(-r * 0.15, -r * 0.33, r * 0.3, r * 0.62, r * 0.08);
      ctx.fill();
      ctx.lineWidth = r * 0.05;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.fillStyle = '#3aa8ff';
      ctx.fillRect(-r * 0.15, -r * 0.05, r * 0.3, r * 0.14);
      ctx.fillStyle = INK;
      ctx.fillRect(-r * 0.06, -r * 0.43, r * 0.12, r * 0.11);
      ctx.restore();
    }
  }

  // Körper
  ctx.fillStyle = jersey;
  circle(ctx, 0, 0, r);
  ctx.fill();
  shade(ctx, r, type === 'wasser' ? 'rgba(0,0,0,0.16)' : JERSEY_SH[type]);
  // Trikotmuster
  ctx.save();
  circle(ctx, 0, 0, r);
  ctx.clip();
  if (type === 'floh') {
    ctx.fillStyle = '#e5484d';
    for (const [dx, dy, s] of [[-0.55, 0.15, 0.17], [-0.15, 0.62, 0.15], [-0.62, -0.38, 0.13], [0.3, 0.72, 0.14], [-0.25, -0.05, 0.12], [-0.85, 0.55, 0.12]]) {
      circle(ctx, dx * r, dy * r, s * r);
      ctx.fill();
    }
  } else if (type === 'zeit') {
    // Regenbogenstreifen
    const cols = ['#3aa8ff', '#e5484d', '#1b1d24', '#ffd23f', '#2fb24c'];
    cols.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(-r * 1.1, r * (0.28 + i * 0.09), r * 2.2, r * 0.09);
    });
  } else if (type === 'sprinter') {
    ctx.fillStyle = WHITE;
    ctx.fillRect(-r * 1.1, r * 0.55, r * 2.2, r * 0.12);
  } else if (type === 'gelb') {
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(-r * 1.1, r * 0.62, r * 2.2, r * 0.08);
  } else if (type === 'wasser') {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(-r * 1.1, r * 0.5, r * 2.2, r * 0.1);
  }
  ctx.restore();
  facePatch(ctx, r);
  ctx.lineWidth = r * 0.085;
  ctx.strokeStyle = INK;
  circle(ctx, 0, 0, r);
  ctx.stroke();

  // Nase
  ctx.fillStyle = SKIN;
  ellipse(ctx, r * 0.93, r * 0.08, r * 0.16, r * 0.13);
  ctx.fill();
  ctx.lineWidth = r * 0.05;
  ctx.stroke();

  const dizzy = k.mood === 'dizzy';
  const eyeY = -r * 0.05;
  if (type === 'zeit') {
    // Visier statt Augen
    ctx.fillStyle = '#5b6bd6';
    ctx.beginPath();
    ctx.moveTo(r * 0.02, -r * 0.3);
    ctx.quadraticCurveTo(r * 1.05, -r * 0.42, r * 1.08, r * 0.05);
    ctx.quadraticCurveTo(r * 0.55, r * 0.12, r * 0.02, r * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = r * 0.05;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(r * 0.5, -r * 0.3);
    ctx.lineTo(r * 0.68, -r * 0.31);
    ctx.lineTo(r * 0.38, r * 0.04);
    ctx.lineTo(r * 0.24, r * 0.04);
    ctx.closePath();
    ctx.fill();
  } else if (dizzy) {
    dizzyEye(ctx, r * 0.17, eyeY, r * 0.2, k.t);
    dizzyEye(ctx, r * 0.6, eyeY, r * 0.2, k.t + 1);
  } else if (k.mood === 'cheer') {
    ctx.strokeStyle = INK;
    ctx.lineWidth = r * 0.08;
    for (const ex of [0.2, 0.6]) {
      ctx.beginPath();
      ctx.moveTo((ex - 0.12) * r, eyeY + r * 0.04);
      ctx.quadraticCurveTo(ex * r, eyeY - r * 0.14, (ex + 0.12) * r, eyeY + r * 0.04);
      ctx.stroke();
    }
  } else {
    const big = type === 'floh' ? 1.15 : 1;
    const wide = k.mood === 'fly' ? 1.12 : 1;
    eye(ctx, r * 0.17, eyeY, r * 0.19 * big * wide, r * 0.24 * big * wide, k.lookX, k.lookY, k.blink, 0.56);
    eye(ctx, r * 0.6, eyeY, r * 0.19 * big * wide, r * 0.24 * big * wide, k.lookX, k.lookY, k.blink, 0.56);
    if (type !== 'floh') brows(ctx, r, k.mood, eyeY - r * 0.27);
  }
  if (type === 'sprinter' && k.glasses && !dizzy) shades(ctx, r * 0.0, r * 0.82, eyeY, r * 0.26, '#27a845');

  // Kopfbedeckung
  if (type === 'floh') {
    // Radmütze mit hochgeklappter Krempe
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.04, Math.PI * 1.1, Math.PI * 1.88);
    ctx.quadraticCurveTo(r * 0.3, -r * 0.42, -r * 1.0, -r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#e5484d';
    for (const [dx, dy] of [[-0.6, -0.65], [-0.15, -0.88], [0.32, -0.8], [-0.35, -0.45], [0.1, -0.55]]) { circle(ctx, dx * r, dy * r, r * 0.11); ctx.fill(); }
    ctx.restore();
    ctx.lineWidth = r * 0.06;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = '#e5484d';
    ctx.beginPath();
    ctx.moveTo(r * 0.42, -r * 0.62);
    ctx.quadraticCurveTo(r * 0.95, -r * 0.95, r * 1.05, -r * 0.58);
    ctx.quadraticCurveTo(r * 0.8, -r * 0.55, r * 0.42, -r * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (type === 'zeit') {
    ctx.fillStyle = '#e8ecf5';
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.07, Math.PI * 1.08, Math.PI * 1.96);
    ctx.quadraticCurveTo(r * 0.5, -r * 0.32, -r * 0.2, -r * 0.34);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = r * 0.06;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = '#e5484d';
    ctx.fillRect(-r * 0.6, -r * 0.82, r * 0.9, r * 0.1);
  } else if (type === 'gelb') {
    helmet(ctx, r, '#ffd23f', 'rgba(0,0,0,0.35)', '#ffffff');
    shades(ctx, -r * 0.35, r * 0.45, -r * 0.88, r * 0.2, '#ffd23f');
  } else if (type === 'wasser') {
    helmet(ctx, r, WHITE, 'rgba(0,0,0,0.3)', k.team);
    shades(ctx, -r * 0.3, r * 0.48, -r * 0.88, r * 0.18, k.team);
  } else {
    helmet(ctx, r, WHITE, 'rgba(0,0,0,0.3)', '#27a845');
  }

  mouth(ctx, r, k.mood, k.t);
  if (type === 'wasser' && (k.mood === 'idle' || k.mood === 'aim')) {
    // Schweißtropfen
    ctx.fillStyle = '#8fd6ff';
    ctx.beginPath();
    ctx.moveTo(-r * 0.15, -r * 0.3);
    ctx.quadraticCurveTo(-r * 0.27, -r * 0.08, -r * 0.15, -r * 0.04);
    ctx.quadraticCurveTo(-r * 0.03, -r * 0.08, -r * 0.15, -r * 0.3);
    ctx.fill();
  }
  if (type === 'gelb') {
    // Champagnerflasche am Rücken
    ctx.save();
    ctx.translate(-r * 0.92, -r * 0.1);
    ctx.rotate(-0.55);
    ctx.fillStyle = '#1f5a36';
    ctx.beginPath();
    ctx.roundRect(-r * 0.14, -r * 0.2, r * 0.28, r * 0.55, r * 0.08);
    ctx.fill();
    ctx.fillStyle = '#e8c35a';
    ctx.fillRect(-r * 0.08, -r * 0.42, r * 0.16, r * 0.24);
    ctx.lineWidth = r * 0.04;
    ctx.strokeStyle = INK;
    ctx.strokeRect(-r * 0.14, -r * 0.2, r * 0.28, r * 0.55);
    ctx.restore();
  }
}

// ------------------------------------------------------------------ E-Biker

export type EnemyMood = 'idle' | 'scared' | 'hurt' | 'laugh' | 'cheer';

export interface EnemyLook {
  mood: EnemyMood;
  blink: boolean;
  lookX: number;
  lookY: number;
  /** 0..1 – Tasse am Mund */
  sip: number;
  /** Verletzung 0..1 */
  harm: number;
  t: number;
}

const JACKET: Record<EnemyType, string> = { opa: '#c6f432', tourer: '#ff8a3d', boss: '#e5484d' };
const JACKET_SH: Record<EnemyType, string> = { opa: '#9cc61f', tourer: '#e06a1f', boss: '#b8333a' };

/** E-Biker (runder Kopf mit Jackenkragen, Blick nach links zur Schleuder) */
export function drawEnemy(ctx: CanvasRenderingContext2D, type: EnemyType, r: number, k: EnemyLook) {
  const laugh = k.mood === 'laugh';
  // Kopf
  ctx.fillStyle = SKIN;
  circle(ctx, 0, 0, r);
  ctx.fill();
  ctx.save();
  circle(ctx, 0, 0, r);
  ctx.clip();
  ctx.fillStyle = SKIN_SH;
  circle(ctx, r * 0.55, r * 0.45, r * 0.9);
  ctx.globalAlpha = 0.45;
  ctx.fill();
  ctx.globalAlpha = 1;
  // Jackenkragen
  ctx.fillStyle = JACKET[type];
  ctx.beginPath();
  ctx.moveTo(-r * 1.1, r * 0.5);
  ctx.quadraticCurveTo(0, r * 0.82, r * 1.1, r * 0.42);
  ctx.lineTo(r * 1.1, r * 1.2);
  ctx.lineTo(-r * 1.1, r * 1.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = JACKET_SH[type];
  ctx.fillRect(r * 0.2, r * 0.55, r, r);
  // Reißverschluss / Reflexstreifen
  ctx.strokeStyle = type === 'boss' ? '#ffd23f' : 'rgba(255,255,255,0.8)';
  ctx.lineWidth = r * 0.07;
  ctx.beginPath();
  ctx.moveTo(-r * 0.15, r * 0.7);
  ctx.lineTo(-r * 0.12, r * 1.1);
  ctx.stroke();
  if (type === 'boss') {
    // Blitz auf der Brust
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.moveTo(r * 0.35, r * 0.6);
    ctx.lineTo(r * 0.18, r * 0.85);
    ctx.lineTo(r * 0.3, r * 0.85);
    ctx.lineTo(r * 0.2, r * 1.05);
    ctx.lineTo(r * 0.45, r * 0.75);
    ctx.lineTo(r * 0.33, r * 0.75);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.lineWidth = r * 0.085;
  ctx.strokeStyle = INK;
  circle(ctx, 0, 0, r);
  ctx.stroke();

  // Ohr (rechts, vom Spieler abgewandt)
  ctx.fillStyle = SKIN;
  ellipse(ctx, r * 0.78, r * 0.0, r * 0.14, r * 0.2);
  ctx.fill();
  ctx.lineWidth = r * 0.05;
  ctx.stroke();

  const shake = laugh ? Math.sin(k.t * 40) * r * 0.03 : 0;
  const eyeY = -r * 0.1 + shake;
  const ex1 = -r * 0.55;
  const ex2 = -r * 0.15;
  const lx = k.lookX;
  const ly = k.lookY;
  if (laugh || k.mood === 'cheer') {
    ctx.strokeStyle = INK;
    ctx.lineWidth = r * 0.08;
    for (const ex of [ex1, ex2]) {
      ctx.beginPath();
      ctx.moveTo(ex - r * 0.12, eyeY + r * 0.03);
      ctx.quadraticCurveTo(ex, eyeY - r * 0.12, ex + r * 0.12, eyeY + r * 0.03);
      ctx.stroke();
    }
  } else {
    const scared = k.mood === 'scared';
    const s = scared ? 1.22 : 1;
    eye(ctx, ex1, eyeY, r * 0.17 * s, r * 0.21 * s, lx, ly, k.blink || (k.mood === 'hurt' && k.harm > 0.5), scared ? 0.36 : 0.54);
    eye(ctx, ex2, eyeY, r * 0.17 * s, r * 0.21 * s, lx, ly, k.blink, scared ? 0.36 : 0.54);
    if (k.harm > 0.6) {
      // blaues Auge
      ctx.strokeStyle = 'rgba(110,60,160,0.65)';
      ctx.lineWidth = r * 0.07;
      circle(ctx, ex1, eyeY, r * 0.2);
      ctx.stroke();
    }
  }
  // Brille (Opa)
  if (type === 'opa') {
    ctx.strokeStyle = '#6b5a3a';
    ctx.lineWidth = r * 0.05;
    circle(ctx, ex1, eyeY, r * 0.2);
    ctx.stroke();
    circle(ctx, ex2, eyeY, r * 0.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex1 + r * 0.2, eyeY);
    ctx.lineTo(ex2 - r * 0.2, eyeY);
    ctx.moveTo(ex2 + r * 0.2, eyeY);
    ctx.lineTo(r * 0.7, eyeY - r * 0.05);
    ctx.stroke();
  }
  // Augenbrauen
  ctx.strokeStyle = type === 'opa' ? '#f4f1ea' : INK;
  ctx.lineWidth = type === 'opa' ? r * 0.13 : r * 0.08;
  ctx.lineCap = 'round';
  const smug = k.mood === 'idle';
  const worried = k.mood === 'scared' || k.mood === 'hurt';
  ctx.beginPath();
  const by = eyeY - r * 0.3;
  ctx.moveTo(ex1 - r * 0.16, by + (worried ? r * 0.06 : 0));
  ctx.lineTo(ex1 + r * 0.14, by - (worried ? r * 0.06 : 0) + (smug ? r * 0.04 : 0));
  ctx.moveTo(ex2 - r * 0.14, by - (worried ? r * 0.06 : 0) + (smug ? r * 0.02 : 0));
  ctx.lineTo(ex2 + r * 0.16, by + (worried ? r * 0.06 : 0) - (smug ? r * 0.04 : 0));
  ctx.stroke();

  // Nase (links)
  ctx.fillStyle = type === 'boss' ? '#f0a88a' : SKIN;
  ellipse(ctx, -r * 0.88, r * 0.12 + shake, r * 0.17, r * 0.14);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = r * 0.05;
  ctx.stroke();

  // Mund
  const mx = -r * 0.42;
  const my = r * 0.38 + shake;
  ctx.strokeStyle = INK;
  ctx.lineWidth = r * 0.07;
  if (laugh || k.mood === 'cheer') {
    ctx.fillStyle = '#7a2a2a';
    ctx.beginPath();
    ctx.moveTo(mx - r * 0.3, my - r * 0.08);
    ctx.quadraticCurveTo(mx, my + r * 0.38, mx + r * 0.28, my - r * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = WHITE;
    ctx.fillRect(mx - r * 0.2, my - r * 0.08, r * 0.38, r * 0.07);
  } else if (k.mood === 'scared') {
    ctx.fillStyle = '#7a2a2a';
    ellipse(ctx, mx, my + r * 0.04, r * 0.1, r * 0.13);
    ctx.fill();
    ctx.stroke();
  } else if (k.mood === 'hurt') {
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const x = mx - r * 0.2 + (i / 6) * r * 0.4;
      const y = my + (i % 2 ? r * 0.05 : -r * 0.03);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else {
    // selbstzufriedenes Grinsen
    ctx.beginPath();
    ctx.moveTo(mx - r * 0.24, my - r * 0.02);
    ctx.quadraticCurveTo(mx - r * 0.02, my + r * 0.16, mx + r * 0.22, my - r * 0.1);
    ctx.stroke();
    if (type === 'boss') {
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(mx - r * 0.06, my + r * 0.01, r * 0.09, r * 0.07);
    }
  }
  // Schnurrbart (Opa), Kinnbart (Tourer)
  if (type === 'opa') {
    ctx.fillStyle = '#f4f1ea';
    ctx.beginPath();
    ctx.moveTo(-r * 0.78, my - r * 0.12);
    ctx.quadraticCurveTo(-r * 0.62, my - r * 0.28, -r * 0.42, my - r * 0.16);
    ctx.quadraticCurveTo(-r * 0.22, my - r * 0.28, -r * 0.08, my - r * 0.1);
    ctx.quadraticCurveTo(-r * 0.3, my - r * 0.02, -r * 0.42, my - r * 0.09);
    ctx.quadraticCurveTo(-r * 0.6, my - r * 0.02, -r * 0.78, my - r * 0.12);
    ctx.fill();
    ctx.lineWidth = r * 0.03;
    ctx.stroke();
  } else if (type === 'tourer') {
    ctx.fillStyle = '#5a3d2b';
    ctx.beginPath();
    ctx.moveTo(mx - r * 0.1, my + r * 0.14);
    ctx.lineTo(mx + r * 0.08, my + r * 0.14);
    ctx.lineTo(mx - r * 0.02, my + r * 0.34);
    ctx.closePath();
    ctx.fill();
  }

  // Kaffeetasse
  if (k.sip > 0 && !laugh && k.mood !== 'scared') {
    const cy = r * 0.95 - k.sip * r * 0.55;
    const cx = -r * 0.85 + k.sip * r * 0.25;
    ctx.fillStyle = SKIN;
    circle(ctx, cx + r * 0.22, cy + r * 0.12, r * 0.13);
    ctx.fill();
    ctx.lineWidth = r * 0.04;
    ctx.stroke();
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.roundRect(cx - r * 0.18, cy - r * 0.16, r * 0.34, r * 0.34, r * 0.06);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#6b3b22';
    ctx.fillRect(cx - r * 0.14, cy - r * 0.13, r * 0.26, r * 0.07);
  }

  // Helm
  ctx.save();
  if (k.harm > 0.35) ctx.rotate(-0.18 * Math.min(1, k.harm));
  if (type === 'opa') {
    // Rückspiegel am Helm
    ctx.strokeStyle = '#3b3f4a';
    ctx.lineWidth = r * 0.06;
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, -r * 0.55);
    ctx.quadraticCurveTo(-r * 1.15, -r * 0.6, -r * 1.25, -r * 0.35);
    ctx.stroke();
    ctx.fillStyle = '#cfe6f2';
    ellipse(ctx, -r * 1.27, -r * 0.27, r * 0.12, r * 0.16, -0.3);
    ctx.fill();
    ctx.stroke();
  }
  const hc = type === 'opa' ? '#8fd0ff' : type === 'tourer' ? '#2c313b' : '#16171a';
  ctx.fillStyle = hc;
  ctx.beginPath();
  if (type === 'boss') {
    // Halbschale wie beim Moped
    ctx.arc(0, -r * 0.05, r * 1.04, Math.PI * 1.04, Math.PI * 1.96);
    ctx.closePath();
  } else {
    ctx.arc(0, 0, r * 1.06, Math.PI * 1.03, Math.PI * 1.94);
    ctx.quadraticCurveTo(r * 0.3, -r * 0.48, -r * 0.4, -r * 0.42);
    ctx.quadraticCurveTo(-r * 0.85, -r * 0.4, -r * 1.06, -r * 0.1);
  }
  ctx.fill();
  ctx.lineWidth = r * 0.06;
  ctx.strokeStyle = INK;
  ctx.stroke();
  if (type === 'opa') {
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = r * 0.08;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.82, Math.PI * 1.3, Math.PI * 1.6);
    ctx.stroke();
  } else if (type === 'tourer') {
    // Sonnenbrille oben auf dem Helm
    shades(ctx, -r * 0.6, r * 0.25, -r * 0.82, r * 0.2, '#ff8a3d');
  } else {
    ctx.fillStyle = '#e5484d';
    ctx.beginPath();
    ctx.moveTo(r * 0.05, -r * 0.98);
    ctx.lineTo(-r * 0.25, -r * 0.55);
    ctx.lineTo(-r * 0.05, -r * 0.58);
    ctx.lineTo(-r * 0.2, -r * 0.2);
    ctx.lineTo(r * 0.22, -r * 0.7);
    ctx.lineTo(r * 0.02, -r * 0.68);
    ctx.closePath();
    ctx.fill();
    // Schutzbrille an der Stirn
    ctx.fillStyle = '#5a4630';
    ctx.fillRect(-r * 1.0, -r * 0.42, r * 1.95, r * 0.12);
    ctx.fillStyle = '#9fd8ff';
    ctx.strokeStyle = INK;
    ctx.lineWidth = r * 0.05;
    for (const gx of [-0.62, -0.18]) {
      ellipse(ctx, gx * r, -r * 0.38, r * 0.17, r * 0.13);
      ctx.fill();
      ctx.stroke();
    }
  }
  if (k.harm > 0.35) {
    // Pflaster
    ctx.save();
    ctx.translate(r * 0.3, -r * 0.7);
    ctx.rotate(0.6);
    ctx.fillStyle = '#f2d2a9';
    ctx.fillRect(-r * 0.24, -r * 0.07, r * 0.48, r * 0.14);
    ctx.rotate(-1.2);
    ctx.fillRect(-r * 0.24, -r * 0.07, r * 0.48, r * 0.14);
    ctx.restore();
  }
  ctx.restore();
  if (k.mood === 'scared') {
    ctx.fillStyle = '#8fd6ff';
    ctx.beginPath();
    ctx.moveTo(r * 0.35, -r * 0.55);
    ctx.quadraticCurveTo(r * 0.2, -r * 0.25, r * 0.35, -r * 0.2);
    ctx.quadraticCurveTo(r * 0.5, -r * 0.25, r * 0.35, -r * 0.55);
    ctx.fill();
  }
}

/** Akkuanzeige über dem E-Biker (Breite w, Mitte im Ursprung) */
export function drawBattery(ctx: CanvasRenderingContext2D, w: number, level: number, flash: number, empty = false) {
  const h = w * 0.44;
  const x = -w / 2;
  const y = -h / 2;
  ctx.fillStyle = 'rgba(16,18,24,0.82)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h * 0.28);
  ctx.fill();
  ctx.fillRect(x + w, -h * 0.2, w * 0.08, h * 0.4);
  ctx.strokeStyle = flash > 0 ? '#ffffff' : 'rgba(255,255,255,0.9)';
  ctx.lineWidth = h * 0.12;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h * 0.28);
  ctx.stroke();
  const segs = 4;
  const lit = empty ? 0 : Math.ceil(level * segs - 0.05);
  const col = empty ? '#e5484d' : level > 0.6 ? '#5be37d' : level > 0.3 ? '#ffd23f' : '#ff5a4f';
  const gap = w * 0.05;
  const sw = (w - gap * (segs + 1)) / segs;
  for (let i = 0; i < segs; i++) {
    const on = i < lit;
    ctx.fillStyle = on ? col : 'rgba(255,255,255,0.12)';
    ctx.fillRect(x + gap + i * (sw + gap), y + gap * 1.2, sw, h - gap * 2.4);
  }
  if (empty) {
    ctx.fillStyle = '#e5484d';
    ctx.fillRect(x + gap, y + gap * 1.2, sw * 0.4, h - gap * 2.4);
  }
}
