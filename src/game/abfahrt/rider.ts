/** Radfahrer von hinten, als Vektorgrafik – mit Tretbewegung, Schräglage und Abfahrtshaltung. */

type Ctx = CanvasRenderingContext2D;

export interface Kit {
  jersey: string;
  side: string;
  helmet: string;
  shorts: string;
  skin: string;
  shoes: string;
  number: string;
  /** Rad (bikes.ts); ohne Angabe das Teamrad in Trikotfarben */
  bike?: string;
}

export const TEAM_KITS: Omit<Kit, 'skin' | 'number'>[] = [
  { jersey: '#1f6feb', side: '#ffffff', helmet: '#ffffff', shorts: '#0d1b3a', shoes: '#ffffff' },
  { jersey: '#e11d48', side: '#111111', helmet: '#111111', shorts: '#111111', shoes: '#111111' },
  { jersey: '#16a34a', side: '#fde047', helmet: '#fde047', shorts: '#14301f', shoes: '#ffffff' },
  { jersey: '#f97316', side: '#1e293b', helmet: '#1e293b', shorts: '#1e293b', shoes: '#ffffff' },
  { jersey: '#0ea5e9', side: '#0f172a', helmet: '#ffffff', shorts: '#0f172a', shoes: '#0f172a' },
  { jersey: '#facc15', side: '#111827', helmet: '#111827', shorts: '#111827', shoes: '#facc15' },
  { jersey: '#7c3aed', side: '#f5f5f5', helmet: '#f5f5f5', shorts: '#2e1065', shoes: '#ffffff' },
  { jersey: '#111827', side: '#ef4444', helmet: '#ef4444', shorts: '#111827', shoes: '#111111' },
  { jersey: '#14b8a6', side: '#ffffff', helmet: '#0f766e', shorts: '#0f3d3a', shoes: '#ffffff' },
  { jersey: '#f5f5f4', side: '#2563eb', helmet: '#2563eb', shorts: '#1e3a8a', shoes: '#ffffff' },
  { jersey: '#9f1239', side: '#fbbf24', helmet: '#fbbf24', shorts: '#4c0519', shoes: '#111111' },
  { jersey: '#65a30d', side: '#1c1917', helmet: '#1c1917', shorts: '#1c1917', shoes: '#ffffff' },
];

export const SKINS = ['#f1c7a5', '#e8b48f', '#d49a72', '#a8714c', '#7a4e33'];

export interface Pose {
  lean: number;     // rad, + nach rechts
  pedal: number;    // Kurbelwinkel
  tuck: number;     // 0 aufrecht … 1 Abfahrtshaltung
  brake: number;    // 0 … 1 (Oberkörper hoch)
  light: number;    // Rücklicht 0 … 1
}

function seg(c: Ctx, x0: number, y0: number, x1: number, y1: number, w: number, col: string) {
  c.strokeStyle = col;
  c.lineWidth = w;
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.stroke();
}

/**
 * Zeichnet den Fahrer mit Fußpunkt (Hinterrad-Aufstand) bei (x, y) in px, s = px pro Meter.
 */
export function drawRider(c: Ctx, x: number, y: number, s: number, kit: Kit, p: Pose, shadowAlpha = 0.28) {
  if (s < 2) return;
  // Schatten auf der Straße
  c.save();
  c.translate(x + Math.sin(p.lean) * s * 0.25, y);
  c.scale(s, s * 0.22);
  c.beginPath();
  c.arc(0, 0, 0.42, 0, Math.PI * 2);
  c.fillStyle = `rgba(0,0,0,${shadowAlpha})`;
  c.fill();
  c.restore();

  c.save();
  c.translate(x, y);
  c.rotate(p.lean);
  c.scale(s, s);
  c.lineCap = 'round';
  c.lineJoin = 'round';

  const tuck = Math.max(0, Math.min(1, p.tuck - p.brake * 0.6));
  const shY = -1.42 + tuck * 0.26;      // Schulterhöhe
  const hipY = -0.96 + tuck * 0.02;
  const handY = -1.02 + tuck * 0.06;

  // Hinterrad
  c.fillStyle = '#18191b';
  c.beginPath();
  c.roundRect(-0.038, -0.7, 0.076, 0.7, 0.035);
  c.fill();
  c.fillStyle = '#5b5f66';
  c.fillRect(-0.012, -0.66, 0.024, 0.62);
  // Schaltwerk und Kassette
  c.fillStyle = '#a3a8ae';
  c.fillRect(0.038, -0.4, 0.05, 0.12);
  c.fillStyle = '#2b2d31';
  c.fillRect(0.05, -0.29, 0.03, 0.09);
  // Hinterbau
  seg(c, -0.055, -0.34, -0.02, -0.84, 0.028, '#2a2c30');
  seg(c, 0.055, -0.34, 0.02, -0.84, 0.028, '#2a2c30');

  // Beine
  const crank = 0.17;
  const bb = -0.28;
  const legs = [p.pedal, p.pedal + Math.PI];
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const a = legs[i];
    const fy = bb - Math.cos(a) * crank;
    const fx = side * 0.13;
    const hx = side * 0.09;
    const ky = hipY + (fy - hipY) * 0.46 - 0.05 * (1 - Math.cos(a)) * 0.5;
    const kx = side * (0.13 + 0.03 * Math.max(0, -Math.cos(a)));
    // hinteres Bein (das gerade oben ist) etwas dunkler
    const back = Math.cos(a) > 0;
    seg(c, hx, hipY, kx, ky, 0.14, kit.shorts);
    seg(c, kx, ky, fx, fy - 0.05, 0.1, back ? shadeHex(kit.skin, 0.88) : kit.skin);
    seg(c, fx, fy - 0.08, fx, fy - 0.02, 0.085, '#f4f4f4');
    c.fillStyle = kit.shoes;
    c.beginPath();
    c.roundRect(fx - 0.05, fy - 0.035, 0.1, 0.07, 0.03);
    c.fill();
  }

  // Sattel und Rücklicht
  c.fillStyle = '#16171a';
  c.beginPath();
  c.ellipse(0, -0.9, 0.075, 0.03, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = p.light > 0 ? '#ff3b3b' : '#7a1d1d';
  c.fillRect(-0.025, -0.79, 0.05, 0.035);

  // Hose
  c.fillStyle = kit.shorts;
  c.beginPath();
  c.roundRect(-0.17, hipY - 0.06, 0.34, 0.15, 0.07);
  c.fill();

  // Oberkörper (Rücken)
  const wW = 0.15;
  const sW = 0.22 + tuck * 0.02;
  c.beginPath();
  c.moveTo(-wW, hipY);
  c.bezierCurveTo(-wW - 0.03, hipY - 0.15, -sW - 0.02, shY + 0.1, -sW + 0.03, shY);
  c.quadraticCurveTo(0, shY - 0.06 - tuck * 0.03, sW - 0.03, shY);
  c.bezierCurveTo(sW + 0.02, shY + 0.1, wW + 0.03, hipY - 0.15, wW, hipY);
  c.closePath();
  const g = c.createLinearGradient(-sW, 0, sW, 0);
  g.addColorStop(0, kit.jersey);
  g.addColorStop(0.75, kit.jersey);
  g.addColorStop(1, shadeHex(kit.jersey, 0.78));
  c.fillStyle = g;
  c.fill();
  // Seitenteile
  c.save();
  c.clip();
  c.fillStyle = kit.side;
  c.fillRect(-sW - 0.1, shY - 0.1, 0.09, 1);
  c.fillRect(sW + 0.01, shY - 0.1, 0.09, 1);
  c.fillRect(-sW, shY + (hipY - shY) * 0.38, sW * 2, 0.045);
  // Rückentaschen
  c.strokeStyle = 'rgba(0,0,0,0.22)';
  c.lineWidth = 0.012;
  c.beginPath();
  c.moveTo(-0.12, hipY - 0.12); c.lineTo(0.12, hipY - 0.12);
  c.moveTo(-0.04, hipY - 0.12); c.lineTo(-0.04, hipY - 0.01);
  c.moveTo(0.04, hipY - 0.12); c.lineTo(0.04, hipY - 0.01);
  c.stroke();
  c.restore();
  // Startnummer
  if (s > 14) {
    const ny = shY + (hipY - shY) * 0.52;
    c.fillStyle = '#fbfbf8';
    c.fillRect(-0.085, ny, 0.17, 0.11);
    c.fillStyle = '#111';
    c.font = '800 0.085px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(kit.number, 0, ny + 0.058);
  }

  // Arme
  for (const side of [-1, 1]) {
    const sx = side * (sW - 0.03);
    const ex = side * (0.3 + tuck * 0.04);
    const ey = shY + (handY - shY) * 0.5 + 0.02;
    const hx = side * 0.21;
    seg(c, sx, shY + 0.03, ex, ey, 0.1, kit.jersey);
    seg(c, ex, ey, hx, handY, 0.075, kit.skin);
    c.fillStyle = '#222';
    c.beginPath();
    c.arc(hx, handY, 0.04, 0, Math.PI * 2);
    c.fill();
  }

  // Kopf mit Helm
  const hy = shY - 0.11 + tuck * 0.05;
  c.fillStyle = kit.skin;
  c.fillRect(-0.04, hy + 0.02, 0.08, 0.08);
  c.fillStyle = kit.helmet;
  c.beginPath();
  c.ellipse(0, hy, 0.125, 0.105 - tuck * 0.015, 0, Math.PI, 0);
  c.lineTo(0.12, hy + 0.035);
  c.quadraticCurveTo(0, hy + 0.07, -0.12, hy + 0.035);
  c.closePath();
  c.fill();
  c.fillStyle = 'rgba(0,0,0,0.45)';
  for (const vx of [-0.06, 0, 0.06]) {
    c.beginPath();
    c.ellipse(vx, hy - 0.04, 0.016, 0.04, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = 'rgba(255,255,255,0.35)';
  c.beginPath();
  c.ellipse(-0.05, hy - 0.07, 0.04, 0.02, -0.3, 0, Math.PI * 2);
  c.fill();

  c.restore();
}

const hexCache = new Map<string, string>();
export function shadeHex(hex: string, f: number): string {
  const key = `${hex}:${f}`;
  let out = hexCache.get(key);
  if (out) return out;
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  out = `rgb(${r},${g},${b})`;
  hexCache.set(key, out);
  return out;
}

/** Sturz: Fahrer und Rad getrennt – das Rad rutscht weg, der Fahrer überschlägt sich und bleibt liegen */
export function drawCrash(c: Ctx, x: number, y: number, s: number, kit: Kit, t: number, spin: number) {
  const fly = Math.min(1, t / 0.7);
  const lift = Math.sin(fly * Math.PI) * 0.8;
  // Rad
  c.save();
  c.translate(x + s * (0.5 + Math.min(1, t) * 1.3), y - s * 0.36);
  c.rotate(1.2 + Math.min(1.2, t) * 1.6);
  c.scale(s, s);
  c.strokeStyle = '#1b1c1f';
  c.lineWidth = 0.05;
  c.beginPath(); c.arc(0, 0, 0.33, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.arc(0.95, 0, 0.33, 0, Math.PI * 2); c.stroke();
  c.strokeStyle = kit.jersey;
  c.lineWidth = 0.045;
  c.beginPath(); c.moveTo(0, 0); c.lineTo(0.42, -0.45); c.lineTo(0.95, 0); c.lineTo(0.36, 0); c.closePath(); c.stroke();
  c.restore();
  // Fahrer, um die Körpermitte gedreht, bleibt über der Straße
  const cx = x - s * Math.min(1, t) * 0.5;
  const cy = y - s * (0.55 + lift);
  c.save();
  c.translate(cx, cy);
  c.rotate(spin);
  drawRider(c, 0, 0.75 * s, s, kit, { lean: 0, pedal: 1.2, tuck: 0.3, brake: 0, light: 0 }, 0);
  c.restore();
  c.save();
  c.translate(cx, y);
  c.scale(s, s * 0.2);
  c.beginPath();
  c.arc(0, 0, 0.6, 0, Math.PI * 2);
  c.fillStyle = 'rgba(0,0,0,0.22)';
  c.fill();
  c.restore();
}
