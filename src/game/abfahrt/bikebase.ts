/**
 * Gemeinsame Grundlagen der Radmodelle (bike3d.ts und die Sondermodelle wie Hochrad, Cruiser, Postrad):
 * Maße, an denen sich der Fahrer orientiert, Tretlager, Lenkachse, Baukasten-Satz und Bau-Kontext.
 */
import * as THREE from 'three';
import type { BikeSpec } from '../bikes';
import type { Kit } from './rider';
import { CHROME, MATTE, Mesher, SATIN, type C3 } from './gloss';
import type { Frame3, Kind } from './prim3d';

export type V = THREE.Vector3;
export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const mix = (a: C3, b: C3, t: number): C3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Woran sich der Fahrer orientiert */
export interface BikeFit {
  front: V;
  rear: V;
  /** rechte Hand: auf dem Griff, im Unterlenker */
  hood: V;
  drop: V;
  /** Zeitfahrhaltung: Hand am Aufliegerende, Ellbogen auf dem Polster */
  aero: { hand: V; pad: V } | null;
  /** Becken über dem Sattel */
  pelvis: V;
  /** Rücklicht an der Sattelstütze */
  lamp: V;
  /** kleineres Vorderrad dreht schneller (Verhältnis der Radien) */
  spinF?: number;
  /** Hinterrad kleiner/größer als 28 Zoll: Drehzahl im Verhältnis */
  spinR?: number;
  /** Drehpunkt der Kurbel, wenn nicht das Tretlager (Hochrad: Vorderradnabe) */
  bb?: V;
  /** Kurbellänge (sonst 170 mm) */
  crank?: number;
  /** Pedalmitte seitlich (sonst 128 mm) */
  pedalX?: number;
  /** aufrechte Räder: größter Winkel des Oberkörpers über der Waagrechten (sonst 0,95) */
  upright?: number;
  /** fester Winkel des Oberkörpers (Hochrad: Griffe tief neben der Hüfte, Oberkörper aufrecht) */
  trunk?: number;
}

/** Tretlager (wie beim Fahrer) */
export const BIKE_BB = v3(0, 0.3, 0.02);

export interface FrameDims {
  rF: number; htBot: number; htTop: number; seatLen: number; seatDir: V;
  /** Rohre: [Breite Anfang, Tiefe Anfang, Breite Ende, Tiefe Ende] */
  tt: [number, number, number, number]; dt: [number, number, number, number]; st: [number, number, number, number];
  ht: [number, number]; cs: [number, number]; ss: [number, number]; fork: [number, number];
  kind: Kind; ssLow: number; forkCurve: boolean; lugs: boolean; welds: boolean; flare: number;
  /** Hinterrad (Außenradius), sonst 0,335 */
  rR?: number;
}

/** Lenkachse (73°, 45 mm Gabelversatz): Punkt auf der Achse in Höhe y */
export function headAxis(front: V, deg = 73, offset = 0.045) {
  const ang = (deg * Math.PI) / 180;
  const u = v3(0, Math.sin(ang), Math.cos(ang));
  const n = v3(0, -u.z, u.y);
  const p = front.clone().addScaledVector(n, offset);
  return { u, n, at: (y: number) => p.clone().addScaledVector(u, (y - p.y) / u.y) };
}
export type Axis = ReturnType<typeof headAxis>;

export interface Set4 { paint: Mesher; metal: Mesher; satin: Mesher; matte: Mesher }

export function set4(paintGloss: number): Set4 {
  return { paint: new Mesher(paintGloss), metal: new Mesher(CHROME), satin: new Mesher(SATIN), matte: new Mesher(MATTE) };
}

export interface Ctx {
  q: 0 | 1;
  spec: BikeSpec;
  kit: Kit;
  /** Rahmen und alles, was steht */
  f: Set4;
  /** Lackfarbe an einem Punkt (Verläufe) */
  pc: (p: V) => C3;
  silver: C3; dark: C3; carbon: C3; rubber: C3; gold: C3;
  n: number;
  /** Ringe je geradem Rohr (mehr, wenn Schlamm auf dem Lack verläuft) */
  rings: number;
  /** Schlamm: Anteil an einem Punkt (0 sauber … 1 voll), sonst null */
  mud: ((p: V) => number) | null;
  mudC: C3;
}

export interface FrameOut {
  H0: V; H1: V; S: V; ax: Axis; crown: V; ssTop: V; dtA: V; dtB: V; dtFrame: Frame3; dtW: [number, number]; dtD: [number, number];
  /** Zugwege: oben in die Vorderbremse, Anschlag vorn auf dem Oberrohr, Anschläge am Unterrohr (rechts) */
  cableFront: V; cableTT: V; cableDT: V;
  /** hinteres Ende des Zugs oben auf dem Oberrohr */
  cableTTEnd: V;
}

/** feste Pseudo-Zufallszahl 0–1 für einen Punkt */
export const hash3 = (x: number, y: number, z: number) => {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
};
