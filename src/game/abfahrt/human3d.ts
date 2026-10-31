/**
 * Menschen in voller Detailstufe – Personal am Start und Leute in der Stadt (die Zuschauer an der Strecke bleiben
 * Bilder). Körper wie bei den Fahrern: geformte Glieder mit Muskeln, Rumpf mit gemalter Kleidung (Polo mit Kragen
 * und Knopfleiste, Jury-Jacke mit Reißverschluss, Fotowesten mit Taschen, Uniform mit Abzeichen und Gürtel,
 * T-Shirt mit Aufdruck, Hemd mit Karo, Strickpulli), Akkreditierung am Band, Hose mit Gürtel. Kopf mit Gesicht,
 * Augen, Brauen, Ohren, Haaren (kurz, lang, Dutt), Mütze und Brille (gear3d.personHeadBuild), Hände mit Daumen,
 * Schuhe mit Sohle.
 *
 * Bewegung über Gelenke (Skinning wie beim Fahrer): eine Haltung besteht aus Becken, Neigung und Drehung des
 * Rumpfs, Blick und Zielen für Hände und Füße; die Glieder folgen per Zweigelenk-Rechnung. Darüber liegen
 * Handlungen (stehen mit Atmen, Gewicht verlagern und Umschauen, Rad am Sattel halten, fotografieren, filmen,
 * Startzeichen, klatschen, jubeln, winken, gehen, sitzen und trinken) – Wechsel werden weich übergeblendet.
 */
import * as THREE from 'three';
import { MB, RelSkeleton, bone, cached, elbowCap, ik, kneeCap, loft, mergeGeo, muscle, skinGeo, type Ring } from './rider3d';
import { personHeadBuild } from './gear3d';
import { glossMat } from './gloss';
import { lin, type RGBf } from './models3d';

// ------------------------------------------------------------------ Maße (Körper: vorn = −z, Ursprung am Boden)

const THIGH = 0.43;
const SHIN = 0.42;
const UPPER = 0.3;
const FORE = 0.3;
const SPINE = 0.52;
/** Becken im Stand (Beine fast gestreckt) */
const PELVIS_Y = 0.93;
/** Knöchel über dem Boden */
const ANKLE_Y = 0.085;
const UP = new THREE.Vector3(0, 1, 0);

export type Clothes = 'polo' | 'jacket' | 'vest' | 'police' | 'tee' | 'check' | 'knit' | 'blouse' | 'waiter' | 'apron';

/** Aussehen eines Menschen */
export interface Look {
  female: boolean;
  skin: string;
  hair: string;
  long: boolean;
  bun: boolean;
  hat: 'none' | 'peaked' | 'baseball';
  hatCol: string;
  glasses: boolean;
  clothes: Clothes;
  top: string;
  accent: string;
  pants: string;
  shoes: string;
  /** lange Ärmel */
  sleeves: boolean;
  /** Aufdruck (Rücken bzw. Brust) */
  print?: string;
  /** Akkreditierung am Band */
  badge?: boolean;
  /** Größe (1 = 1,78 m) */
  height: number;
}

// ------------------------------------------------------------------ Geometrie

const TORSO_Y0 = -0.13;
const TORSO_Y1 = 0.62;
const TEX_W = 256;
const TEX_H = 128;
const PAD = 16;
/** Texturkoordinate (v) der Glieder: im weißen Streifen unter der Kleidung */
const LIMB_V = PAD / 2 / (TEX_H + PAD);

/** Rumpf: Gesäß, Taille, Brust (bei Frauen schmalere Schultern, breitere Hüfte, Brust), runder Rücken */
function torsoGeo(female: boolean, far = false): THREE.BufferGeometry {
  return cached(`human-torso|${female}|${far}`, () => {
    const w: RGBf = [1, 1, 1];
    const back = (y: number) => 0.024 * Math.sin(Math.PI * Math.max(0, Math.min(1, (y - 0.05) / 0.5)));
    const rows: [number, number, number][] = female
      ? [[-0.13, 0.07, 0.05], [-0.115, 0.13, 0.09], [-0.08, 0.165, 0.118], [-0.03, 0.172, 0.124], [0.03, 0.158, 0.112],
        [0.12, 0.138, 0.098], [0.22, 0.142, 0.104], [0.3, 0.155, 0.128], [0.36, 0.162, 0.13], [0.43, 0.168, 0.11], [0.5, 0.176, 0.1],
        [0.545, 0.17, 0.09], [0.575, 0.135, 0.075], [0.6, 0.085, 0.06], [0.62, 0.055, 0.05]]
      : [[-0.13, 0.065, 0.05], [-0.115, 0.118, 0.087], [-0.08, 0.152, 0.112], [-0.03, 0.162, 0.12], [0.03, 0.16, 0.116],
        [0.12, 0.155, 0.11], [0.22, 0.162, 0.116], [0.33, 0.176, 0.124], [0.43, 0.19, 0.12], [0.5, 0.2, 0.108],
        [0.545, 0.192, 0.095], [0.575, 0.152, 0.08], [0.6, 0.095, 0.065], [0.62, 0.06, 0.055]];
    // Brust (Frau): nach vorn gewölbt – der Mittelpunkt wandert dort etwas nach vorn
    const bust = (y: number) => (female ? -0.02 * Math.exp(-(((y - 0.33) / 0.055) ** 2)) : 0);
    const rings: Ring[] = rows.map(([y, a, b]) => ({ y, a, b, cz: back(y) + bust(y) + (y < 0 ? 0.012 : 0), c: w }));
    const mb = new MB();
    loft(mb, far ? (rings.filter((_, i) => i % 2 === 0 || i === rings.length - 1)) : rings, far ? 12 : 22, 0, 1);
    const g = mb.build();
    const uv = g.getAttribute('uv');
    const k = TEX_H / (TEX_H + PAD);
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - k + Math.max(uv.getY(i), 0.035) * k);
    return g;
  });
}

/** Unterarm mit Hand: Ärmel bis cuff (Anteil der Länge, 0 = kurz), Hand mit Daumen (sx = Seite) */
function foreGeo(skin: RGBf, sleeve: RGBf, cuff: number, sx: number, far = false): THREE.BufferGeometry {
  const rings: Ring[] = [];
  const c0 = cuff > 0 ? sleeve : skin;
  const rs = 0.04;
  for (let k = 4; k >= 1; k--) {
    const a = (k / 4) * (Math.PI / 2);
    rings.push({ y: -Math.sin(a) * rs * 0.9, a: Math.cos(a) * rs + 0.002, b: Math.cos(a) * rs + 0.002, c: c0 });
  }
  const L = FORE;
  const col = (t: number) => (t < cuff ? sleeve : skin);
  const sl = cuff > 0 ? 0.006 : 0;
  const prof: [number, number, number, number][] = [
    [0, 0.042 + sl, 0.042 + sl, 0], [0.16, 0.046 + sl, 0.044 + sl, 0], [0.4, 0.04 + sl, 0.037 + sl, 0], [0.62, 0.033 + sl * 0.8, 0.031 + sl * 0.8, 0],
    [0.74, 0.029, 0.027, 0], [0.785, 0.028, 0.026, 0], [0.81, 0.031, 0.025, 0], [0.86, 0.04, 0.024, -0.001], [0.92, 0.042, 0.022, -0.004],
    [0.965, 0.039, 0.019, -0.008], [1, 0.033, 0.015, -0.012],
  ];
  for (const [t, a, b, cz] of prof) {
    rings.push({ y: t * L, a, b, cz, c: col(t) });
    // Bündchen: kurzer Absatz am Ende des Ärmels
    if (cuff > 0 && Math.abs(t - 0.62) < 1e-6) rings.push({ y: 0.7 * L, a: 0.034, b: 0.032, c: sleeve }, { y: 0.705 * L, a: 0.029, b: 0.027, c: skin });
  }
  for (let k = 1; k <= 3; k++) {
    const an = (k / 3) * (Math.PI / 2);
    rings.push({ y: L + Math.sin(an) * 0.013, a: Math.cos(an) * 0.033 + 0.002, b: Math.cos(an) * 0.015 + 0.001, cz: -0.012 - Math.sin(an) * 0.003, c: skin });
  }
  // Ringe der Höhe nach (das Bündchen kam mittendrin dazu)
  rings.sort((p, q) => p.y - q.y);
  const mb = new MB();
  loft(mb, rings, far ? 7 : 14, 0, 1);
  // Daumen innen, Finger als leichte Rillen (zwei dunklere Streifen täten es nicht: Farbe je Ecke)
  mb.add(new THREE.SphereGeometry(1, far ? 5 : 10, far ? 3 : 6), new THREE.Matrix4().compose(new THREE.Vector3(-sx * 0.034, L * 0.89, -0.014), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 0, sx * 0.35)), new THREE.Vector3(0.014, 0.034, 0.013)), skin);
  return mb.build();
}

/** Straßenschuh: Sohle, Oberteil, Zunge; Ursprung im Knöchel, Spitze nach −z */
function shoeGeo(col: RGBf, sole: RGBf, far = false): THREE.BufferGeometry {
  return cached(`human-shoe|${col.join(',')}|${sole.join(',')}|${far}`, () => {
    const mb = new MB();
    // Längsschnitt: [z, halbe Breite, Höhe Oberkante, Farbe]
    const prof: [number, number, number][] = [[0.075, 0.034, -0.02], [0.06, 0.042, 0.0], [0.02, 0.046, 0.012], [-0.03, 0.048, 0.0], [-0.08, 0.05, -0.022], [-0.13, 0.048, -0.04], [-0.17, 0.04, -0.05], [-0.195, 0.026, -0.056]];
    const n = far ? 6 : 12;
    const st = mb.pos.length / 3;
    for (const [z, a, top] of prof) {
      for (let j = 0; j <= n; j++) {
        const ph = (j / n) * Math.PI * 2;
        const s = Math.sin(ph), c = Math.cos(ph);
        // unten flach (Sohle), oben gerundet
        const yb = -0.083;
        const y = c < 0 ? yb + (top - yb) * 0 : yb + (top - yb) * Math.pow(c, 0.6);
        const low = c < 0.12;
        mb.v(s * a, low ? yb : y, z, low ? sole : col, 0.5, 0.5);
      }
    }
    const W = n + 1;
    for (let i = 0; i < prof.length - 1; i++) for (let j = 0; j < n; j++) { const a = st + i * W + j; mb.idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1); }
    // Kappen vorn und hinten
    for (const [i, flip] of [[0, true], [prof.length - 1, false]] as [number, boolean][]) {
      const c = mb.v(0, -0.06, prof[i][0], col, 0.5, 0.5);
      for (let j = 0; j < n; j++) { const a = st + i * W + j; if (flip) mb.idx.push(c, a + 1, a); else mb.idx.push(c, a, a + 1); }
    }
    // Knöchel (Socke/Hosenbein endet darüber)
    mb.add(new THREE.SphereGeometry(0.036, far ? 5 : 10, far ? 3 : 6), new THREE.Matrix4().makeScale(1, 1.1, 1.05), col);
    return mb.build();
  });
}

/** Glieder je Farbkombination */
function limbs(l: Look, far = false) {
  return cached(`human-limbs|${l.skin}|${l.top}|${l.pants}|${l.sleeves}|${l.clothes}|${l.accent}|${far}`, () => {
    const n = far ? 7 : 14;
    const skin = lin(l.skin);
    const pants = lin(l.pants);
    // Weste (Fotograf, Kellner): Ärmel in der Farbe des Hemds darunter
    const top = lin(l.clothes === 'vest' || l.clothes === 'waiter' ? l.accent : l.top);
    const ps = (t: number, a: number, b: number, cz: number): [number, number, number, number, RGBf] => [t, a, b, cz, pants];
    const thigh = muscle(THIGH, [ps(0, 0.088, 0.09, 0), ps(0.2, 0.085, 0.09, 0.006), ps(0.45, 0.076, 0.08, 0.006), ps(0.7, 0.064, 0.066, 0.004), ps(1, 0.056, 0.058, 0.002)], n);
    // Hosenbein bis auf den Schuh, unten etwas weiter
    const shin = mergeGeo(muscle(SHIN, [ps(0, 0.056, 0.058, 0), ps(0.25, 0.058, 0.064, -0.006), ps(0.5, 0.052, 0.056, -0.004), ps(0.8, 0.048, 0.048, 0), ps(1, 0.05, 0.05, 0.002)], n), kneeCap(pants));
    // Oberarm: Ärmel (kurz bis zur Mitte, mit Saum), dann Haut
    const short = !l.sleeves;
    const upper = muscle(UPPER, short
      ? [[0, 0.064, 0.062, 0, top], [0.12, 0.066, 0.064, 0, top], [0.35, 0.058, 0.06, 0, top], [0.45, 0.056, 0.058, 0, top], [0.455, 0.05, 0.052, 0, skin], [0.68, 0.047, 0.05, 0.004, skin], [1, 0.04, 0.04, 0, skin]]
      : [[0, 0.066, 0.064, 0, top], [0.12, 0.068, 0.066, 0, top], [0.4, 0.06, 0.062, 0, top], [0.7, 0.054, 0.056, 0.004, top], [1, 0.048, 0.048, 0, top]], n);
    return {
      thigh, shin, upper,
      foreL: mergeGeo(foreGeo(skin, top, short ? 0 : 0.7, -1, far), elbowCap(short ? skin : top)),
      foreR: mergeGeo(foreGeo(skin, top, short ? 0 : 0.7, 1, far), elbowCap(short ? skin : top)),
    };
  });
}

// ------------------------------------------------------------------ Kleidung (Textur des Rumpfs)

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';

/** Kleidung auf den Rumpf malen: u rundherum (0,25 Brust, 0,75 Rücken), v von der Hüfte zum Hals */
function clothesTex(l: Look): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = TEX_W;
  cv.height = TEX_H + PAD;
  const c = cv.getContext('2d')!;
  const W = TEX_W, H = TEX_H;
  c.fillStyle = '#ffffff';
  c.fillRect(0, H, W, PAD);
  const vy = (y: number) => H * (1 - (y - TORSO_Y0) / (TORSO_Y1 - TORSO_Y0));
  const U = (u: number) => u * W;
  const front = 0.25, backU = 0.75;
  const top = l.top;
  // Grundfarbe mit weichen Falten (Licht von oben, unter der Brust und über dem Gürtel etwas dunkler)
  c.fillStyle = top;
  c.fillRect(0, 0, W, H);
  const shade = c.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, 'rgba(255,255,255,0.07)');
  shade.addColorStop(0.45, 'rgba(0,0,0,0.0)');
  shade.addColorStop(0.8, 'rgba(0,0,0,0.1)');
  c.fillStyle = shade;
  c.fillRect(0, 0, W, H);
  // Falten: schräge, weiche Streifen
  c.globalAlpha = 0.07;
  for (let i = 0; i < 14; i++) {
    const x = (i / 14) * W + 6 * Math.sin(i * 2.3);
    const g = c.createLinearGradient(x - 6, 0, x + 6, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, i % 2 ? 'rgba(0,0,0,1)' : 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - 6, vy(0.45), 12, vy(0.02) - vy(0.45));
  }
  c.globalAlpha = 1;
  // Seitennähte
  c.fillStyle = 'rgba(0,0,0,0.16)';
  for (const u of [0, 0.5, 1]) c.fillRect(U(u) - 1, 0, 2, vy(0.0));
  const text = (s: string, u: number, y: number, size: number, col: string, weight = '800', maxW = 70) => {
    c.save();
    c.font = `${weight} ${size}px ${SANS}`;
    let fs = size;
    while (c.measureText(s).width > maxW && fs > 6) { fs -= 1; c.font = `${weight} ${fs}px ${SANS}`; }
    c.fillStyle = col;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(s, U(u), vy(y));
    c.restore();
  };
  const dark = 'rgba(0,0,0,0.35)';
  switch (l.clothes) {
    case 'polo': {
      // Kragen mit Spitzen, Knopfleiste mit zwei Knöpfen, kleines Logo links auf der Brust
      c.fillStyle = l.accent;
      c.fillRect(0, vy(0.62), W, vy(0.565) - vy(0.62));
      c.beginPath();
      c.moveTo(U(front - 0.07), vy(0.58)); c.lineTo(U(front), vy(0.5)); c.lineTo(U(front + 0.07), vy(0.58)); c.closePath();
      c.fill();
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fillRect(U(front) - 4, vy(0.565), 1, vy(0.44) - vy(0.565));
      c.fillRect(U(front) + 3, vy(0.565), 1, vy(0.44) - vy(0.565));
      c.fillStyle = '#f2f2ee';
      for (const y of [0.53, 0.47]) { c.beginPath(); c.arc(U(front), vy(y), 1.6, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = l.accent;
      c.fillRect(U(front + 0.07), vy(0.45), 12, 5);
      if (l.print) text(l.print, backU, 0.4, 14, l.accent, '900');
      break;
    }
    case 'jacket': {
      // Stehkragen, Reißverschluss, Brusttaschen mit Patten, Querstreifen, Aufdruck hinten
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fillRect(0, vy(0.62), W, vy(0.575) - vy(0.62));
      c.fillStyle = l.accent;
      c.fillRect(0, vy(0.36), W, vy(0.32) - vy(0.36));
      c.fillStyle = '#c9cdd2';
      c.fillRect(U(front) - 1, vy(0.62), 2, vy(-0.02) - vy(0.62));
      c.fillStyle = 'rgba(0,0,0,0.3)';
      for (const du of [-0.09, 0.09]) {
        c.fillRect(U(front + du) - 11, vy(0.47), 22, 2);
        c.fillRect(U(front + du) - 11, vy(0.47), 1, vy(0.39) - vy(0.47));
        c.fillRect(U(front + du) + 10, vy(0.47), 1, vy(0.39) - vy(0.47));
      }
      // Bund unten
      c.fillStyle = 'rgba(0,0,0,0.22)';
      c.fillRect(0, vy(0.04), W, vy(-0.0) - vy(0.04));
      if (l.print) text(l.print, backU, 0.45, 15, '#ffffff', '900');
      break;
    }
    case 'vest': {
      // Hemd an den Schultern, darüber die Weste mit vielen Taschen; hinten ein Leibchen „PHOTO“ mit Nummer
      c.fillStyle = l.accent;
      c.fillRect(0, 0, W, vy(0.5));
      c.fillStyle = top;
      c.fillRect(0, vy(0.5), W, H - vy(0.5));
      c.fillRect(U(0.08), 0, U(0.34), vy(0.5));
      c.fillRect(U(0.58), 0, U(0.34), vy(0.5));
      c.fillStyle = 'rgba(0,0,0,0.28)';
      c.fillRect(U(front) - 1, vy(0.5), 2, vy(0.0) - vy(0.5));
      for (const du of [-0.11, -0.05, 0.05, 0.11]) {
        for (const y of [0.4, 0.2]) {
          c.fillRect(U(front + du) - 8, vy(y), 16, 1.5);
          c.strokeStyle = 'rgba(0,0,0,0.25)';
          c.strokeRect(U(front + du) - 8, vy(y), 16, vy(y - 0.08) - vy(y));
        }
      }
      // Leibchen hinten
      c.fillStyle = '#f07b1d';
      c.fillRect(U(backU - 0.12), vy(0.5), U(0.24), vy(0.1) - vy(0.5));
      text('PHOTO', backU, 0.4, 13, '#ffffff', '900', 54);
      text(l.print ?? '7', backU, 0.24, 18, '#141414', '900', 40);
      break;
    }
    case 'waiter': {
      // Kellner: weißes Hemd, schwarze Weste mit Knöpfen, Fliege
      c.fillStyle = l.accent;
      c.fillRect(0, 0, W, H);
      c.fillStyle = top;
      c.fillRect(0, vy(0.52), W, H - vy(0.52));
      c.fillRect(U(0.09), vy(0.6), U(0.32), vy(0.52) - vy(0.6));
      c.fillRect(U(0.59), vy(0.6), U(0.32), vy(0.52) - vy(0.6));
      // V-Ausschnitt der Weste vorn (Hemd sichtbar)
      c.fillStyle = l.accent;
      c.beginPath();
      c.moveTo(U(front - 0.06), vy(0.62)); c.lineTo(U(front), vy(0.34)); c.lineTo(U(front + 0.06), vy(0.62)); c.closePath();
      c.fill();
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fillRect(U(front) - 0.5, vy(0.6), 1, vy(0.34) - vy(0.6));
      c.fillStyle = '#c9b88a';
      for (const y of [0.3, 0.22, 0.14]) { c.beginPath(); c.arc(U(front), vy(y), 1.5, 0, Math.PI * 2); c.fill(); }
      // Fliege
      c.fillStyle = '#111113';
      c.beginPath();
      c.moveTo(U(front) - 7, vy(0.6) - 3); c.lineTo(U(front), vy(0.6)); c.lineTo(U(front) - 7, vy(0.6) + 3); c.closePath();
      c.moveTo(U(front) + 7, vy(0.6) - 3); c.lineTo(U(front), vy(0.6)); c.lineTo(U(front) + 7, vy(0.6) + 3); c.closePath();
      c.fill();
      // Rücken der Weste: glänzendes Futter mit Riegel
      c.fillStyle = 'rgba(255,255,255,0.08)';
      c.fillRect(U(backU - 0.15), vy(0.5), U(0.3), vy(0.05) - vy(0.5));
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(U(backU - 0.06), vy(0.16), U(0.12), 2);
      break;
    }
    case 'apron': {
      // Hemd mit Latzschürze (Marktstand): Bänder um den Hals, Latz vorn, Bund um die Hüfte, Tasche
      c.fillStyle = l.accent;
      c.fillRect(U(front - 0.12), vy(0.5), U(0.24), vy(-0.02) - vy(0.5));
      c.fillRect(0, vy(0.08), W, vy(0.03) - vy(0.08));
      c.strokeStyle = l.accent;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(U(front - 0.11), vy(0.5)); c.lineTo(U(front - 0.06), vy(0.63));
      c.moveTo(U(front + 0.11), vy(0.5)); c.lineTo(U(front + 0.06), vy(0.63));
      c.stroke();
      c.strokeStyle = 'rgba(0,0,0,0.25)';
      c.strokeRect(U(front - 0.07), vy(0.3), U(0.14), vy(0.18) - vy(0.3));
      if (l.print) text(l.print, front, 0.4, 11, 'rgba(0,0,0,0.55)', '800', 50);
      break;
    }
    case 'police': {
      // Diensthemd mit Schulterklappen, Brusttaschen, Abzeichen; weißer Gürtel; Aufdruck hinten
      c.fillStyle = 'rgba(0,0,0,0.2)';
      for (const du of [-0.09, 0.09]) c.fillRect(U(front + du) - 10, vy(0.46), 20, vy(0.38) - vy(0.46));
      c.fillStyle = '#d4a72c';
      c.beginPath(); c.arc(U(front - 0.09), vy(0.5), 4, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.8)';
      c.fillRect(U(front + 0.06), vy(0.52), 14, 3);
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(0, vy(0.6), W, 3);
      c.fillStyle = '#f2f2ee';
      c.fillRect(0, vy(0.03), W, vy(-0.015) - vy(0.03));
      c.fillStyle = '#d4a72c';
      c.fillRect(U(front) - 4, vy(0.025), 8, vy(-0.01) - vy(0.025));
      text(l.print ?? 'POLIZIA', backU, 0.42, 14, '#f2f2ee', '900');
      break;
    }
    case 'tee': {
      // Rundhals, Aufdruck vorn und hinten
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.beginPath();
      c.ellipse(U(front), vy(0.6), 18, 7, 0, 0, Math.PI * 2);
      c.fill();
      if (l.print) { text(l.print, front, 0.4, 13, l.accent, '900', 46); text(l.print, backU, 0.44, 16, l.accent, '900'); }
      break;
    }
    case 'check': {
      // Karohemd: Streifen in beide Richtungen, Kragen, Knopfleiste
      c.globalAlpha = 0.28;
      c.fillStyle = l.accent;
      for (let x = 0; x < W; x += 12) c.fillRect(x, 0, 5, vy(0.0));
      for (let y = 0; y < vy(0.0); y += 12) c.fillRect(0, y, W, 5);
      c.globalAlpha = 1;
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(U(front) - 1, vy(0.6), 2, vy(0.0) - vy(0.6));
      c.fillStyle = '#f2f2ee';
      for (const y of [0.52, 0.42, 0.32, 0.22, 0.12]) { c.beginPath(); c.arc(U(front) + 3, vy(y), 1.4, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = top;
      c.fillRect(0, vy(0.62), W, vy(0.58) - vy(0.62));
      break;
    }
    case 'knit': {
      // Strickpulli: Rippen am Kragen und Bund, Zopfmuster vorn
      c.fillStyle = 'rgba(0,0,0,0.12)';
      for (let x = 0; x < W; x += 4) c.fillRect(x, vy(0.62), 2, vy(0.57) - vy(0.62));
      for (let x = 0; x < W; x += 4) c.fillRect(x, vy(0.06), 2, vy(0.0) - vy(0.06));
      c.strokeStyle = 'rgba(255,255,255,0.18)';
      c.lineWidth = 2;
      for (const du of [-0.05, 0, 0.05]) {
        c.beginPath();
        for (let y = 0.5; y > 0.08; y -= 0.02) c.lineTo(U(front + du) + 3 * Math.sin(y * 60), vy(y));
        c.stroke();
      }
      break;
    }
    case 'blouse': {
      // Bluse: runder Ausschnitt, feine Knopfleiste, leichter Glanz
      c.fillStyle = 'rgba(0,0,0,0.2)';
      c.beginPath();
      c.ellipse(U(front), vy(0.6), 14, 10, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.12)';
      c.fillRect(U(front - 0.12), vy(0.5), U(0.06), vy(0.2) - vy(0.5));
      break;
    }
  }
  // Akkreditierung: Band um den Hals, Karte auf der Brust
  if (l.badge) {
    c.strokeStyle = l.clothes === 'jacket' ? '#e0559a' : '#1f6fb2';
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(U(front - 0.07), vy(0.6));
    c.lineTo(U(front - 0.01), vy(0.34));
    c.lineTo(U(front + 0.05), vy(0.6));
    c.stroke();
    c.fillStyle = '#f4f4f2';
    c.fillRect(U(front - 0.01) - 7, vy(0.34), 14, vy(0.24) - vy(0.34));
    c.fillStyle = '#e0559a';
    c.fillRect(U(front - 0.01) - 7, vy(0.34), 14, 3);
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillRect(U(front - 0.01) - 5, vy(0.29), 10, 1);
    c.fillRect(U(front - 0.01) - 5, vy(0.27), 7, 1);
  }
  // Hose: Bund mit Gürtel und Schnalle, Taschen, Gesäßtaschen
  const py = vy(0.0);
  c.fillStyle = l.pants;
  c.fillRect(0, py, W, H - py);
  if (l.clothes !== 'police') {
    c.fillStyle = '#2a2016';
    c.fillRect(0, py, W, 5);
    c.fillStyle = '#b9a66a';
    c.fillRect(U(front) - 4, py, 8, 5);
  }
  c.strokeStyle = dark;
  c.lineWidth = 1;
  for (const du of [-0.1, 0.1]) {
    c.beginPath(); c.moveTo(U(front + du), py + 6); c.quadraticCurveTo(U(front + du * 1.3), py + 14, U(front + du * 1.6), py + 9); c.stroke();
    c.strokeRect(U(backU + du * 0.7) - 9, py + 9, 18, 14);
  }
  c.beginPath(); c.moveTo(U(front), py + 5); c.lineTo(U(front), H); c.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// ------------------------------------------------------------------ Haltung

/** Haltung: Becken (Körperkoordinaten), Rumpf (vorbeugen, drehen, kippen), Blick, Ziele für Hände und Füße */
export interface Pose {
  pelvis: THREE.Vector3;
  lean: number;
  twist: number;
  roll: number;
  headYaw: number;
  headPitch: number;
  hands: [THREE.Vector3, THREE.Vector3];
  /** Ellbogen zeigen in diese Richtung (Körperkoordinaten) */
  elbows: [THREE.Vector3, THREE.Vector3];
  feet: [THREE.Vector3, THREE.Vector3];
  footPitch: [number, number];
  footYaw: [number, number];
  knees: [THREE.Vector3, THREE.Vector3];
}

const newPose = (): Pose => ({
  pelvis: new THREE.Vector3(0, PELVIS_Y, 0), lean: 0, twist: 0, roll: 0, headYaw: 0, headPitch: 0,
  hands: [new THREE.Vector3(-0.22, 0.86, 0), new THREE.Vector3(0.22, 0.86, 0)],
  elbows: [new THREE.Vector3(-0.4, -0.2, 0.6), new THREE.Vector3(0.4, -0.2, 0.6)],
  feet: [new THREE.Vector3(-0.11, ANKLE_Y, 0), new THREE.Vector3(0.11, ANKLE_Y, 0)],
  footPitch: [0, 0], footYaw: [-0.12, 0.12],
  knees: [new THREE.Vector3(-0.1, 0, -1), new THREE.Vector3(0.1, 0, -1)],
});

function blendPose(cur: Pose, tgt: Pose, k: number, kFeet = k) {
  cur.pelvis.lerp(tgt.pelvis, k);
  cur.lean += (tgt.lean - cur.lean) * k;
  cur.twist += (tgt.twist - cur.twist) * k;
  cur.roll += (tgt.roll - cur.roll) * k;
  cur.headYaw += (tgt.headYaw - cur.headYaw) * k;
  cur.headPitch += (tgt.headPitch - cur.headPitch) * k;
  for (let s = 0; s < 2; s++) {
    cur.hands[s].lerp(tgt.hands[s], k);
    cur.elbows[s].lerp(tgt.elbows[s], k).normalize();
    cur.feet[s].lerp(tgt.feet[s], kFeet);
    cur.knees[s].lerp(tgt.knees[s], kFeet).normalize();
    cur.footPitch[s] += (tgt.footPitch[s] - cur.footPitch[s]) * kFeet;
    cur.footYaw[s] += (tgt.footYaw[s] - cur.footYaw[s]) * kFeet;
  }
}

/** Was ein Mensch gerade tut */
export type Act = 'stand' | 'hands' | 'back' | 'cross' | 'hips' | 'hold' | 'photo' | 'kneel' | 'tv' | 'starter' | 'clap' | 'cheer' | 'wave' | 'walk' | 'sit' | 'drink' | 'watch' | 'point' | 'talk' | 'read' | 'speak';

/** Halter am Rad (Personal am Start): Hände um diesen Weltpunkt */
const tmpV = new THREE.Vector3();
const tmpW = new THREE.Vector3();

// ------------------------------------------------------------------ Mensch

export class Human {
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  readonly look: Look;
  /** was er tut, worauf er schaut (Welt), woran er greift (Welt, nur hold) */
  act: Act = 'stand';
  lookAt: THREE.Vector3 | null = null;
  holdAt = new THREE.Vector3();
  /** Gehen: Tempo (m/s) – das Weiterbewegen der Gruppe übernimmt der Aufrufer */
  speed = 0;
  /** Kellner: trägt ein Tablett in der Rechten (Hand bleibt auf Schulterhöhe, auch im Gehen) */
  tray = false;
  /** sitzt (Stuhl, Bank): Beine und Becken wie beim Sitzen, die Arme tun, was die Handlung sagt (reden, klatschen) */
  seated = false;
  private torso: THREE.Bone;
  private head: THREE.Bone;
  private thighs: THREE.Bone[] = [];
  private shins: THREE.Bone[] = [];
  private uppers: THREE.Bone[] = [];
  private fores: THREE.Bone[] = [];
  private shoes: THREE.Bone[] = [];
  private skel: RelSkeleton;
  private meshes: THREE.Mesh[] = [];
  private tex: THREE.CanvasTexture;
  private mat: THREE.MeshLambertMaterial;
  private cur = newPose();
  private tgt = newPose();
  private t: number;
  private seed: number;
  private phase = 0;
  private first = true;
  /** Dinge in der Hand bzw. auf der Schulter (Kamera, Becher …): folgen den Händen */
  readonly props = new THREE.Group();
  private propMode: 'none' | 'hands' | 'right' | 'shoulder' = 'none';
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private v4 = new THREE.Vector3();
  private sq = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private spine = new THREE.Vector3();
  private inv = new THREE.Matrix4();

  /** q: Kopf in voller (1) oder einfacher Detailstufe (0, für Leute weiter weg); far: auch Rumpf, Glieder und Schuhe einfacher */
  constructor(look: Look, seed = Math.random() * 100, q: 0 | 1 = 1, far = false) {
    this.look = look;
    this.seed = seed;
    this.t = seed * 3.7;
    this.group.rotation.order = 'YXZ';
    this.group.add(this.body);
    this.body.scale.setScalar(look.height);
    const bones: THREE.Bone[] = [];
    const joint = () => { const b = new THREE.Bone(); this.body.add(b); bones.push(b); return b; };
    const bi = (b: THREE.Bone) => bones.indexOf(b);
    const g = limbs(look, far);
    const sole = lin(look.shoes === '#f4f4f2' || look.shoes === '#ffffff' ? '#d8d8d4' : '#f0eee8');
    const shoe = shoeGeo(lin(look.shoes), look.clothes === 'police' ? lin('#141414') : sole, far);
    const limbParts: { g: THREE.BufferGeometry; bone: number; pad: boolean }[] = [];
    const glossParts: { g: THREE.BufferGeometry; bone: number }[] = [];
    for (let s = 0; s < 2; s++) {
      const t = joint(), c = joint(), u = joint(), f = joint(), sh = joint();
      this.thighs.push(t); this.shins.push(c); this.uppers.push(u); this.fores.push(f); this.shoes.push(sh);
      limbParts.push({ g: g.thigh, bone: bi(t), pad: true }, { g: g.shin, bone: bi(c), pad: true }, { g: g.upper, bone: bi(u), pad: true }, { g: s === 0 ? g.foreL : g.foreR, bone: bi(f), pad: true });
      glossParts.push({ g: shoe, bone: bi(sh) });
    }
    this.torso = joint();
    this.head = joint();
    glossParts.unshift({ g: personHeadBuild({ skin: look.skin, hair: look.hair, long: look.long, bun: look.bun, hat: look.hat, hatCol: look.hatCol, glasses: look.glasses }, q), bone: bi(this.head) });
    this.skel = new RelSkeleton(bones, this.body);
    const key = `${q}|${far}|${look.female}|${look.skin}|${look.hair}|${look.long}|${look.bun}|${look.hat}|${look.hatCol}|${look.glasses}|${look.top}|${look.pants}|${look.shoes}|${look.sleeves}|${look.clothes}|${look.accent}`;
    const skinned = (name: string, parts: { g: THREE.BufferGeometry; bone: number; pad?: boolean }[], mat: THREE.Material) => {
      const geo = cached(`human-skin:${name}:${key}`, () => skinGeo(parts, LIMB_V));
      const m = new THREE.SkinnedMesh(geo, mat);
      m.bindMode = THREE.DetachedBindMode;
      m.bind(this.skel, new THREE.Matrix4());
      m.boundingSphere = geo.boundingSphere!.clone();
      this.body.add(m);
      this.meshes.push(m);
      return m;
    };
    skinned('gloss', glossParts, glossMat());
    this.tex = clothesTex(look);
    this.mat = new THREE.MeshLambertMaterial({ map: this.tex, vertexColors: true });
    skinned('body', [{ g: torsoGeo(look.female, far), bone: bi(this.torso) }, ...limbParts], this.mat);
    this.body.add(this.props);
    this.props.visible = false;
  }

  /** Ding in die Hände (zwischen beide), in die rechte Hand oder auf die rechte Schulter geben */
  carry(obj: THREE.Object3D, mode: 'hands' | 'right' | 'shoulder') {
    this.props.add(obj);
    this.propMode = mode;
    this.props.visible = true;
  }

  /** Blickrichtung (Körper dreht sich mit, wenn es weit zur Seite geht) und Weltpunkt → Körperkoordinaten */
  private toBody(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    this.group.updateMatrixWorld();
    this.inv.copy(this.body.matrixWorld).invert();
    return out.copy(p).applyMatrix4(this.inv);
  }

  /** Zielhaltung je Handlung (Körperkoordinaten, vorn −z) */
  private target(dt: number) {
    const P = this.tgt;
    const t = this.t;
    const sd = this.seed;
    const breath = Math.sin(t * 1.55 + sd);
    // Gewicht verlagern: langsam von einem Bein aufs andere
    const shift = Math.sin(t * 0.33 + sd * 1.7) * 0.85 + Math.sin(t * 0.81 + sd) * 0.15;
    P.pelvis.set(shift * 0.028, PELVIS_Y - 0.012 * Math.abs(shift), 0);
    P.lean = 0.03 + breath * 0.006;
    P.twist = 0;
    P.roll = -shift * 0.03;
    P.feet[0].set(-0.11, ANKLE_Y, 0.01);
    P.feet[1].set(0.12, ANKLE_Y, -0.03);
    P.footPitch[0] = 0; P.footPitch[1] = 0;
    P.footYaw[0] = -0.14; P.footYaw[1] = 0.16;
    P.knees[0].set(-0.1, 0, -1); P.knees[1].set(0.1, 0, -1);
    // Arme hängen locker, pendeln kaum merklich
    const sway = Math.sin(t * 0.7 + sd) * 0.012;
    P.hands[0].set(-0.215, 0.885 + breath * 0.003, -0.02 + sway);
    P.hands[1].set(0.215, 0.885 + breath * 0.003, -0.02 - sway);
    P.elbows[0].set(-0.35, -0.2, 0.9); P.elbows[1].set(0.35, -0.2, 0.9);
    const sy = PELVIS_Y + SPINE;
    switch (this.act) {
      case 'hands':
        // Hände vorn zusammen (Stoppuhr, gefaltet)
        P.hands[0].set(-0.04, 0.99, -0.2); P.hands[1].set(0.04, 1.0, -0.21);
        P.elbows[0].set(-1, -0.6, 0.3); P.elbows[1].set(1, -0.6, 0.3);
        break;
      case 'back':
        P.hands[0].set(-0.06, 0.92, 0.17); P.hands[1].set(0.06, 0.94, 0.17);
        P.elbows[0].set(-1, -0.3, 0.4); P.elbows[1].set(1, -0.3, 0.4);
        break;
      case 'cross':
        P.hands[0].set(0.12, 1.2, -0.17); P.hands[1].set(-0.12, 1.22, -0.15);
        P.elbows[0].set(-1, -0.7, -0.3); P.elbows[1].set(1, -0.7, -0.3);
        break;
      case 'hips':
        P.hands[0].set(-0.2, 1.0, -0.02); P.hands[1].set(0.2, 1.0, -0.02);
        P.elbows[0].set(-1, 0.1, 0.5); P.elbows[1].set(1, 0.1, 0.5);
        break;
      case 'watch': {
        // Blick auf die Uhr am linken Handgelenk
        P.hands[0].set(0.02, 1.2, -0.25); P.elbows[0].set(-1, -0.6, 0);
        P.hands[1].set(0.06, 1.15, -0.24); P.elbows[1].set(1, -0.6, 0.2);
        P.headPitch = -0.5;
        break;
      }
      case 'hold': {
        // vorgebeugt, die Hände am Sattel; ein Fuß vor, Knie weich
        const h = this.toBody(this.holdAt, this.v1);
        P.lean = 0.38 + breath * 0.008;
        P.pelvis.set(0.0, PELVIS_Y - 0.035, 0.06);
        P.feet[0].set(-0.13, ANKLE_Y, 0.12); P.feet[1].set(0.12, ANKLE_Y, -0.16);
        P.hands[0].set(h.x - 0.05, h.y + 0.02, h.z + 0.02);
        P.hands[1].set(h.x + 0.05, h.y + 0.02, h.z - 0.01);
        P.elbows[0].set(-1, -0.4, 0.4); P.elbows[1].set(1, -0.4, 0.4);
        break;
      }
      case 'photo':
      case 'kneel': {
        const kneel = this.act === 'kneel';
        if (kneel) {
          P.pelvis.set(0.02, 0.56, 0.12);
          P.feet[0].set(-0.12, 0.06, 0.46); P.footPitch[0] = 1.25; P.knees[0].set(0, -1, -0.25);
          P.feet[1].set(0.13, ANKLE_Y, -0.36); P.knees[1].set(0.15, 0.6, -1);
          P.lean = 0.12;
        } else {
          P.lean = 0.06;
          P.feet[0].set(-0.14, ANKLE_Y, 0.06); P.feet[1].set(0.14, ANKLE_Y, -0.1);
        }
        // Kamera vor dem Gesicht: rechte Hand am Griff, linke unter dem Objektiv; ab und zu ein Schwenk
        const pan = Math.sin(t * 0.4 + sd) * 0.05;
        const y = (kneel ? 0.56 : PELVIS_Y) + SPINE + 0.13;
        P.hands[1].set(0.07 + pan, y - 0.035, -0.19);
        P.hands[0].set(-0.04 + pan, y - 0.06, -0.26);
        P.elbows[0].set(-0.8, -0.8, 0.1); P.elbows[1].set(0.9, -0.7, 0.3);
        P.headPitch = -0.05;
        break;
      }
      case 'tv': {
        // Schulterkamera: rechte Hand am Griff vorn, linke am Objektiv
        P.lean = 0.04;
        P.feet[0].set(-0.16, ANKLE_Y, 0.08); P.feet[1].set(0.14, ANKLE_Y, -0.12);
        P.hands[1].set(0.17, sy - 0.06, -0.24);
        P.hands[0].set(0.02, sy - 0.08, -0.4);
        P.elbows[0].set(-0.6, -0.8, 0.2); P.elbows[1].set(1, -0.5, 0.3);
        break;
      }
      case 'starter': {
        // rechte Hand hoch (zählt herunter), Blick zum Fahrer
        P.hands[1].set(0.24, sy + 0.5, -0.06);
        P.elbows[1].set(1, 0.2, 0.2);
        break;
      }
      case 'clap': {
        const k = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 2.1);
        P.hands[0].set(-0.03 - 0.12 * k, sy - 0.2, -0.27); P.hands[1].set(0.03 + 0.12 * k, sy - 0.2, -0.27);
        P.elbows[0].set(-1, -0.6, 0.2); P.elbows[1].set(1, -0.6, 0.2);
        break;
      }
      case 'cheer': {
        const k = Math.max(0, Math.sin(t * Math.PI * 2 * 1.3));
        P.hands[0].set(-0.26, sy + 0.42 + 0.06 * k, -0.06); P.hands[1].set(0.26, sy + 0.42 + 0.06 * (1 - k), -0.06);
        P.elbows[0].set(-1, 0.2, 0); P.elbows[1].set(1, 0.2, 0);
        P.pelvis.y += 0.02 * k;
        break;
      }
      case 'wave': {
        const k = Math.sin(t * Math.PI * 2 * 1.4);
        P.hands[1].set(0.3 + 0.08 * k, sy + 0.35, -0.05);
        P.elbows[1].set(1, -0.2, 0.2);
        break;
      }
      case 'point': {
        P.hands[1].set(0.25, sy + 0.05, -0.5);
        P.elbows[1].set(1, -0.4, 0.2);
        break;
      }
      case 'talk': {
        // im Gespräch: eine Hand erklärt
        const k = Math.sin(t * 2.3 + sd);
        P.hands[1].set(0.16 + 0.04 * k, 1.12 + 0.05 * Math.sin(t * 3.1 + sd), -0.24);
        P.elbows[1].set(1, -0.7, 0.3);
        P.headYaw += 0.1 * Math.sin(t * 0.9 + sd);
        break;
      }
      case 'walk': {
        // Gangzyklus: Standbein schiebt nach hinten, Schwungbein hebt und schwingt vor; Becken wippt, Arme pendeln
        const v = Math.max(0.3, this.speed);
        const T = 1.12 * Math.min(1.25, Math.max(0.8, 1.3 / v)) ** 0.35;
        this.phase = (this.phase + dt / T) % 1;
        const half = (v * T * 0.6) / 2;
        for (let s = 0; s < 2; s++) {
          const ph = (this.phase + (s ? 0.5 : 0)) % 1;
          const sx = s ? 1 : -1;
          if (ph < 0.6) {
            const u = ph / 0.6;
            P.feet[s].set(sx * 0.1, ANKLE_Y, -half + 2 * half * u);
            P.footPitch[s] = u < 0.1 ? -0.25 * (1 - u / 0.1) : u > 0.75 ? 0.5 * ((u - 0.75) / 0.25) : 0;
          } else {
            const u = (ph - 0.6) / 0.4;
            const e = u * u * (3 - 2 * u);
            P.feet[s].set(sx * 0.1, ANKLE_Y + 0.09 * Math.sin(Math.PI * u), half - 2 * half * e);
            P.footPitch[s] = 0.5 * (1 - u) - 0.25 * u;
          }
          P.footYaw[s] = sx * 0.06;
          // Arme pendeln gegen die Beine
          const sw = Math.sin((this.phase + (s ? 0 : 0.5)) * Math.PI * 2);
          P.hands[s].set(sx * 0.215, 0.89 + 0.02 * Math.abs(sw), -0.02 - 0.17 * sw);
          P.elbows[s].set(sx * 0.3, -0.2, 1);
        }
        const bob = Math.cos(this.phase * Math.PI * 4);
        P.pelvis.set(0.018 * Math.sin(this.phase * Math.PI * 2), PELVIS_Y - 0.03 + 0.016 * bob, 0);
        P.lean = 0.06;
        P.twist = 0.07 * Math.sin(this.phase * Math.PI * 2);
        P.roll = 0;
        break;
      }
      case 'read': {
        // sitzt und liest Zeitung: Blatt vor der Brust, Blick hinunter; ab und zu umblättern
        P.pelvis.set(0, 0.5, 0.06);
        P.lean = 0.03;
        P.roll = 0;
        P.feet[0].set(-0.13, ANKLE_Y, -0.38); P.feet[1].set(0.14, ANKLE_Y, -0.44);
        P.knees[0].set(-0.1, 0.6, -1); P.knees[1].set(0.1, 0.6, -1);
        const c = (t * 0.06 + sd) % 1;
        const turn = c < 0.06 ? Math.sin((c / 0.06) * Math.PI) : 0;
        P.hands[0].set(-0.17, 0.98, -0.3);
        P.hands[1].set(0.17 - 0.12 * turn, 0.98 + 0.06 * turn, -0.3 + 0.04 * turn);
        P.elbows[0].set(-1, -0.6, 0.2); P.elbows[1].set(1, -0.6, 0.2);
        P.headPitch = -0.38;
        break;
      }
      case 'speak': {
        // Sprecher: Mikrofon in der Rechten vor dem Mund, die Linke erklärt
        const k = Math.sin(t * 1.9 + sd);
        P.hands[1].set(0.07, sy - 0.02, -0.17);
        P.elbows[1].set(1, -0.5, 0.2);
        P.hands[0].set(-0.21 - 0.06 * k, 1.12 + 0.09 * Math.sin(t * 2.7 + sd), -0.3);
        P.elbows[0].set(-1, -0.5, 0.3);
        P.lean = 0.05;
        break;
      }
      case 'sit':
      case 'drink': {
        // sitzt auf einem Stuhl (Sitz 0,46 m), Füße vorn auf dem Boden; trinken: Tasse ab und zu zum Mund
        P.pelvis.set(0, 0.5, 0.06);
        P.lean = -0.04;
        P.roll = 0;
        P.feet[0].set(-0.13, ANKLE_Y, -0.38); P.feet[1].set(0.14, ANKLE_Y, -0.44);
        P.knees[0].set(-0.1, 0.6, -1); P.knees[1].set(0.1, 0.6, -1);
        P.hands[0].set(-0.14, 0.76, -0.36); P.hands[1].set(0.15, 0.76, -0.38);
        P.elbows[0].set(-1, -0.5, 0.3); P.elbows[1].set(1, -0.5, 0.3);
        if (this.act === 'drink') {
          const c = (t * 0.17 + sd) % 1;
          const lift = c < 0.18 ? Math.sin((c / 0.18) * Math.PI) : 0;
          P.hands[1].set(0.12 - 0.08 * lift, 0.78 + 0.42 * lift, -0.36 + 0.14 * lift);
          P.headPitch = 0.15 * lift;
        }
        break;
      }
    }
    // sitzend reden, klatschen, schauen: Becken und Beine vom Sitzen, Hände entsprechend tiefer
    if (this.seated && this.act !== 'sit' && this.act !== 'drink' && this.act !== 'read') {
      const drop = 0.5 - P.pelvis.y;
      P.pelvis.set(0, 0.5, 0.06);
      P.lean = -0.02;
      P.roll = 0;
      P.twist *= 0.5;
      P.feet[0].set(-0.13, ANKLE_Y, -0.38); P.feet[1].set(0.14, ANKLE_Y, -0.44);
      P.footPitch[0] = 0; P.footPitch[1] = 0;
      P.knees[0].set(-0.1, 0.6, -1); P.knees[1].set(0.1, 0.6, -1);
      for (const h of P.hands) { h.y += drop * 0.9; h.z -= 0.08; }
    }
    // Tablett: rechte Hand vorn auf Schulterhöhe, Ellbogen angewinkelt (auch im Gehen)
    if (this.tray && this.act !== 'sit' && this.act !== 'drink' && this.act !== 'read') {
      P.hands[1].set(0.25, 1.1, -0.2);
      P.elbows[1].set(1, -0.7, 0.15);
    }
    // Blick (Kopf und etwas der Rumpf drehen mit)
    if (this.lookAt && this.act !== 'photo' && this.act !== 'kneel' && this.act !== 'tv') {
      const l = this.toBody(this.lookAt, this.v2);
      const headY = P.pelvis.y + SPINE + 0.18;
      const yaw = Math.atan2(l.x, -l.z);
      const pitch = Math.atan2(l.y - headY, Math.hypot(l.x, l.z));
      const extra = Math.max(0, Math.abs(yaw) - 0.75) * Math.sign(yaw);
      P.twist += Math.max(-0.4, Math.min(0.4, extra * 0.5));
      P.headYaw = Math.max(-1.15, Math.min(1.15, yaw - P.twist * 0.8));
      P.headPitch += Math.max(-0.5, Math.min(0.4, pitch));
    } else {
      // ab und zu umschauen
      P.headYaw = Math.sin(t * 0.21 + sd * 3) * 0.35 * Math.max(0, Math.sin(t * 0.09 + sd));
    }
  }

  /** je Bild: Handlung fortschreiben, Haltung weich nachführen, Glieder stellen */
  update(dt: number) {
    this.t += dt;
    this.target(dt);
    if (this.first) { this.first = false; blendPose(this.cur, this.tgt, 1); }
    else {
      const k = 1 - Math.exp(-dt * 5.5);
      const kf = this.act === 'walk' ? 1 - Math.exp(-dt * 40) : k;
      blendPose(this.cur, this.tgt, k, kf);
    }
    this.apply(this.cur);
  }

  /** Haltung auf die Gelenke */
  private apply(P: Pose) {
    const pelvis = P.pelvis;
    // Rumpf: vorgebeugt, gedreht, gekippt
    this.spine.set(0, Math.cos(P.lean), -Math.sin(P.lean));
    this.torso.position.copy(pelvis);
    this.torso.quaternion.setFromUnitVectors(UP, this.spine);
    this.torso.quaternion.premultiply(this.q2.setFromAxisAngle(UP, -P.twist));
    this.torso.quaternion.premultiply(this.q2.setFromAxisAngle(new THREE.Vector3(0, 0, 1), P.roll));
    this.sq.copy(this.torso.quaternion);
    // Kopf über dem Hals
    const neck = this.v1.set(0, SPINE + 0.07, 0.01).applyQuaternion(this.sq).add(pelvis);
    this.head.position.set(neck.x, neck.y + 0.105, neck.z - 0.02);
    this.head.rotation.set(P.headPitch - P.lean * 0.6, -(P.headYaw + P.twist), -P.roll * 0.4, 'YXZ');
    // Beine
    for (let s = 0; s < 2; s++) {
      const sx = s ? 1 : -1;
      const hip = this.v1.set(pelvis.x + sx * 0.09, pelvis.y - 0.012, pelvis.z + 0.01);
      hip.y -= sx * Math.sin(P.roll) * 0.09;
      const ankle = this.v2.copy(P.feet[s]);
      const knee = this.v3;
      ik(hip, ankle, THIGH, SHIN, P.knees[s], knee, ankle);
      bone(this.thighs[s], hip, knee);
      bone(this.shins[s], knee, ankle);
      const sh = this.shoes[s];
      sh.position.copy(ankle);
      sh.rotation.set(P.footPitch[s], -P.footYaw[s], 0, 'YXZ');
    }
    // Arme: Schulter → Hand (Hand liegt am Ende des Unterarms)
    for (let s = 0; s < 2; s++) {
      const sx = s ? 1 : -1;
      const shoulder = this.v1.set(sx * 0.172, SPINE - 0.035, 0).applyQuaternion(this.sq).add(pelvis);
      const hand = this.v2.copy(P.hands[s]);
      const elbow = this.v3;
      ik(shoulder, hand, UPPER, FORE, P.elbows[s], elbow, hand);
      bone(this.uppers[s], shoulder, elbow);
      bone(this.fores[s], elbow, hand);
      // Hand drehen: Handrücken nach außen, Handfläche zur Körpermitte, Daumen nach vorn (die Handfläche ist
      // die −z-Seite der Hand; also +z nach außen und etwas nach vorn)
      const f = this.fores[s];
      const ax = tmpV.subVectors(hand, elbow).normalize();
      const want = tmpW.set(sx, 0, -0.2);
      want.addScaledVector(ax, -ax.dot(want)).normalize();
      const cur = this.v4.set(0, 0, 1).applyQuaternion(f.quaternion);
      cur.addScaledVector(ax, -ax.dot(cur)).normalize();
      const ang = Math.atan2(this.v1.crossVectors(cur, want).dot(ax), cur.dot(want));
      f.quaternion.premultiply(this.q2.setFromAxisAngle(ax, ang));
    }
    // Dinge in der Hand / auf der Schulter
    if (this.propMode !== 'none') {
      const pr = this.props;
      if (this.propMode === 'shoulder') {
        pr.position.set(0.17, SPINE + 0.02, -0.04).applyQuaternion(this.sq).add(pelvis);
        pr.quaternion.copy(this.sq);
      } else {
        const a = this.propMode === 'hands' ? this.v1.copy(P.hands[0]).add(P.hands[1]).multiplyScalar(0.5) : this.v1.copy(P.hands[1]);
        pr.position.copy(a);
        pr.rotation.set(0, -P.twist, 0);
      }
    }
  }

  dispose() {
    this.skel.dispose();
    this.tex.dispose();
    this.mat.dispose();
  }
}

// ------------------------------------------------------------------ Aussehen nach Rolle

type Rnd = () => number;
const pick = <T,>(r: Rnd, l: T[]): T => l[Math.floor(r() * l.length)];
const SKINS = ['#f3d2b8', '#eac0a0', '#dcae8a', '#c99572', '#a87452', '#7d5236'];
const HAIRS = ['#1c1410', '#2e2018', '#4a3020', '#6b4a2c', '#9a7448', '#c9a86a', '#8c8c8c', '#d8d6d0', '#7a3018'];

export type Role = 'official' | 'photographer' | 'tv' | 'police' | 'mechanic' | 'local';

/** glaubwürdiges Aussehen je Rolle (Mechaniker in Teamfarben: kit) */
export function lookFor(r: Rnd, role: Role, kit?: { jersey: string; side: string }): Look {
  const female = role === 'local' ? r() < 0.5 : r() < 0.22;
  const skin = pick(r, SKINS);
  const old = r() < 0.18;
  const hair = old ? pick(r, ['#8c8c8c', '#d8d6d0', '#b5b2ab']) : pick(r, HAIRS.slice(0, 6));
  const base: Look = {
    female, skin, hair, long: female && r() < 0.6, bun: false, hat: 'none', hatCol: '#1f2a44', glasses: r() < 0.25,
    clothes: 'polo', top: '#1f2a44', accent: '#f2f2ee', pants: '#2b2d33', shoes: '#1d1d1f', sleeves: r() < 0.5,
    height: (female ? 0.94 : 1.0) + (r() - 0.5) * 0.08,
  };
  base.bun = female && !base.long && r() < 0.5;
  switch (role) {
    case 'official':
      return { ...base, clothes: 'jacket', top: pick(r, ['#1f2a44', '#22314f', '#2a2f3a']), accent: pick(r, ['#e0559a', '#f2f2ee']), pants: pick(r, ['#2b2d33', '#3a3d44', '#1f2a44']), sleeves: true, print: 'GIURIA', badge: true, hat: r() < 0.25 ? 'baseball' : 'none', hatCol: '#1f2a44', shoes: '#1d1d1f' };
    case 'photographer':
      return { ...base, clothes: 'vest', top: pick(r, ['#f2f2ee', '#2a2b2f', '#5e6e86', '#c9a273']), accent: pick(r, ['#2a2b2f', '#5a5236', '#cbbd9f']), pants: pick(r, ['#3d5a80', '#2b2d33', '#8a7a5a', '#4a4f57']), hat: r() < 0.6 ? 'baseball' : 'none', hatCol: pick(r, ['#141416', '#f2f2ee', '#5a5236', '#1f2a44']), badge: true, print: String(1 + Math.floor(r() * 99)), shoes: pick(r, ['#3a3d44', '#6b4a2c', '#1d1d1f']) };
    case 'tv':
      return { ...base, clothes: 'tee', top: '#141416', accent: '#e0559a', pants: '#2b2d33', print: 'RAI TV', hat: r() < 0.7 ? 'baseball' : 'none', hatCol: '#141416', badge: true, sleeves: false };
    case 'police':
      return { ...base, female: false, long: false, bun: false, clothes: 'police', top: '#1e2a46', accent: '#f2f2ee', pants: '#1a2238', hat: 'peaked', glasses: r() < 0.4, sleeves: false, shoes: '#111113' };
    case 'mechanic':
      return { ...base, clothes: 'tee', top: kit?.jersey ?? '#e0559a', accent: kit?.side ?? '#ffffff', pants: '#22252b', print: 'TEAM', hat: 'baseball', hatCol: kit?.jersey ?? '#e0559a', sleeves: false, shoes: '#2b2d33' };
    case 'local': {
      const clothes = pick<Clothes>(r, female ? ['blouse', 'knit', 'tee', 'check'] : ['check', 'polo', 'knit', 'tee', 'polo']);
      const top = pick(r, ['#f2f0ea', '#2f5f8a', '#b8462e', '#3d7a52', '#e6d9c0', '#8a6d9e', '#2a2b2f', '#d7b56d', '#7fa9c9', '#c78f6b']);
      return { ...base, clothes, top, accent: pick(r, ['#f2f2ee', '#1f2a44', '#b8462e', '#2a2b2f']), pants: pick(r, ['#3d5a80', '#2c3e50', '#e9e6df', '#bfae80', '#4b3a2a', '#2b2d33']), shoes: pick(r, ['#6b4a2c', '#1d1d1f', '#f4f4f2', '#8a6a4a']), print: clothes === 'tee' ? pick(r, ['FORZA', 'GIRO', '♥', 'CIAO']) : undefined };
    }
  }
}

// ------------------------------------------------------------------ Dinge in der Hand

let propGeo: Record<string, THREE.BufferGeometry> | null = null;
/** Kamera mit Objektiv (Zoom oder Tele), Schulterkamera, Stoppuhr, Kaffeetasse – je eine Geometrie (Farbe je Ecke) */
export function propGeometries(): Record<string, THREE.BufferGeometry> {
  if (propGeo) return propGeo;
  const mk = (fn: (mb: MB) => void) => { const mb = new MB(); fn(mb); return mb.build(); };
  const black = lin('#141416'), grey = lin('#3a3d44'), white = lin('#dcdcd4'), red = lin('#e0241b'), steel = lin('#c9cdd2');
  const M = (x: number, y: number, z: number, rx = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), new THREE.Vector3(1, 1, 1));
  propGeo = {
    // Kamera: Gehäuse hinter den Händen, Objektiv nach vorn (−z), Aufsteckblitz
    camera: mk((mb) => {
      mb.add(new THREE.BoxGeometry(0.15, 0.1, 0.08), M(0, 0.0, 0.04), black);
      mb.add(new THREE.BoxGeometry(0.05, 0.05, 0.05), M(0.0, 0.07, 0.04), black);
      mb.add(new THREE.CylinderGeometry(0.04, 0.042, 0.12, 14), M(0, 0, -0.06, Math.PI / 2), black);
      mb.add(new THREE.CylinderGeometry(0.044, 0.044, 0.03, 14), M(0, 0, -0.09, Math.PI / 2), grey);
      mb.add(new THREE.BoxGeometry(0.06, 0.05, 0.06), M(0, 0.12, 0.04), black);
    }),
    tele: mk((mb) => {
      mb.add(new THREE.BoxGeometry(0.15, 0.1, 0.08), M(0, 0.0, 0.04), black);
      mb.add(new THREE.CylinderGeometry(0.055, 0.05, 0.34, 16), M(0, -0.005, -0.17, Math.PI / 2), white);
      mb.add(new THREE.CylinderGeometry(0.066, 0.066, 0.09, 16), M(0, -0.005, -0.37, Math.PI / 2), black);
      mb.add(new THREE.CylinderGeometry(0.058, 0.058, 0.03, 16), M(0, -0.005, -0.06, Math.PI / 2), red);
    }),
    // Schulterkamera: Körper auf der Schulter, Objektiv vorn, Sucher links, Griff oben, rotes Licht
    tvcam: mk((mb) => {
      mb.add(new THREE.BoxGeometry(0.15, 0.22, 0.46), M(0, 0.06, -0.06), grey);
      mb.add(new THREE.CylinderGeometry(0.06, 0.068, 0.2, 14), M(0, 0.04, -0.38, Math.PI / 2), black);
      mb.add(new THREE.BoxGeometry(0.06, 0.06, 0.14), M(-0.11, 0.14, -0.16), black);
      mb.add(new THREE.BoxGeometry(0.03, 0.05, 0.24), M(0, 0.21, -0.06), black);
      mb.add(new THREE.BoxGeometry(0.03, 0.02, 0.02), M(0.03, 0.18, -0.29), red);
      mb.add(new THREE.BoxGeometry(0.12, 0.08, 0.1), M(0, 0.04, 0.22), black);
    }),
    watch: mk((mb) => {
      mb.add(new THREE.CylinderGeometry(0.03, 0.03, 0.016, 16), M(0, 0.0, -0.03, Math.PI / 2), steel);
      mb.add(new THREE.CylinderGeometry(0.024, 0.024, 0.018, 16), M(0, 0.0, -0.032, Math.PI / 2), lin('#f6f6f2'));
    }),
    // Zeitung (aufgeschlagen, zwischen beiden Händen): rosa Sportzeitung mit Schlagzeilen auf der Außenseite
    paper: mk((mb) => {
      const pink = lin('#f1b3c4'), ink = lin('#3a2a30'), pic = lin('#7d6a70');
      const T = (x: number, y: number, z: number, rx: number) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), new THREE.Vector3(1, 1, 1));
      const tilt = -0.3;
      const at = (x: number, y: number, dz: number) => T(x, 0.13 + y * Math.cos(tilt), -0.04 + y * Math.sin(-tilt) * -1 + dz, tilt);
      for (const sx of [-1, 1]) mb.add(new THREE.BoxGeometry(0.25, 0.36, 0.003), at(sx * 0.127, 0, 0), pink);
      mb.add(new THREE.BoxGeometry(0.36, 0.035, 0.002), at(0.04, 0.13, -0.003), ink);
      mb.add(new THREE.BoxGeometry(0.2, 0.02, 0.002), at(-0.1, 0.08, -0.003), ink);
      mb.add(new THREE.BoxGeometry(0.12, 0.09, 0.002), at(0.12, 0.03, -0.003), pic);
      for (const y of [-0.04, -0.07, -0.1, -0.13]) mb.add(new THREE.BoxGeometry(0.2, 0.008, 0.002), at(-0.11, y, -0.003), lin('#8a7178'));
    }),
    // Tablett des Kellners (auf der flachen Hand): zwei Tassen und ein Glas Spritz
    tray: mk((mb) => {
      mb.add(new THREE.CylinderGeometry(0.17, 0.165, 0.012, 20), M(0.0, 0.035, -0.02), steel);
      mb.add(new THREE.CylinderGeometry(0.028, 0.022, 0.05, 12), M(-0.06, 0.066, -0.06), lin('#f6f6f2'));
      mb.add(new THREE.CylinderGeometry(0.028, 0.022, 0.05, 12), M(0.05, 0.066, 0.03), lin('#f6f6f2'));
      mb.add(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 6), M(0.06, 0.07, -0.07), lin('#e8eef0'));
      mb.add(new THREE.CylinderGeometry(0.036, 0.022, 0.065, 12), M(0.06, 0.13, -0.07), lin('#f0701f'));
    }),
    // Mikrofon des Sprechers (in der Rechten, Kopf vor dem Mund)
    mic: mk((mb) => {
      const d = new THREE.Vector3(-0.02, 0.11, 0.045).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      mb.add(new THREE.CylinderGeometry(0.016, 0.012, 0.14, 10), new THREE.Matrix4().compose(d.clone().multiplyScalar(0.05), q, new THREE.Vector3(1, 1, 1)), black);
      mb.add(new THREE.SphereGeometry(0.026, 10, 8), new THREE.Matrix4().compose(d.clone().multiplyScalar(0.13), q, new THREE.Vector3(1, 1, 1)), grey);
    }),
    // Glas Spritz (orange, mit Stiel)
    glass: mk((mb) => {
      mb.add(new THREE.CylinderGeometry(0.03, 0.03, 0.004, 10), M(0, -0.02, -0.04), lin('#e8eef0'));
      mb.add(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 6), M(0, 0.01, -0.04), lin('#e8eef0'));
      mb.add(new THREE.CylinderGeometry(0.036, 0.022, 0.07, 12), M(0, 0.075, -0.04), lin('#f0701f'));
    }),
    cup: mk((mb) => {
      mb.add(new THREE.CylinderGeometry(0.035, 0.028, 0.07, 14), M(0, 0.02, -0.05), lin('#f6f6f2'));
      mb.add(new THREE.TorusGeometry(0.018, 0.005, 6, 10), M(0.04, 0.02, -0.05), lin('#f6f6f2'));
      mb.add(new THREE.CylinderGeometry(0.03, 0.03, 0.005, 14), M(0, 0.052, -0.05), lin('#3b2414'));
    }),
  };
  return propGeo;
}
