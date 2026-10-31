/**
 * Teamwagen der Abfahrt (Spiellogik): an breiten Stellen der Straße (track.carZones) kommt der Wagen des eigenen
 * Teams von hinten, fährt rechts neben dich und der Sportliche Leiter reicht eine Flasche aus dem Fahrerfenster.
 * Wer sich rechts heranschiebt und sie an der ausgestreckten Hand greift, wird ein Stück mitgezogen – die
 * „klebrige Flasche“: +5 km/h. Danach (oder wenn du sie verpasst) lässt sich der Wagen zurückfallen.
 *
 * Längs gilt die Streckenkoordinate z (vorwärts), quer x (rechts +), wie überall in der Spiellogik.
 */
import { ROAD_HALF, type Track } from './track';

/** Maße des Wagens (m): Länge, halbe Breite */
export const CAR_LEN = 4.86;
export const CAR_HALF = 0.93;
/** Hand mit der Flasche, bezogen auf die Wagenmitte: links neben dem Fahrerfenster, etwas vor der Mitte */
export const HAND_DX = -(CAR_HALF + 0.36);
export const HAND_DZ = 0.18;
/** Schub der klebrigen Flasche (m/s) */
export const BOOST = 5 / 3.6;

export type CarPhase = 'come' | 'offer' | 'go';

export interface TeamCar {
  z: number;
  x: number;
  v: number;
  phase: CarPhase;
  /** Zeit in der Phase (s) */
  t: number;
  /** Arm zum Fenster hinaus: 0 = am Lenkrad, 1 = ganz draußen */
  reach: number;
  /** Flasche gegriffen */
  got: boolean;
  /** die breite Stelle, zu der der Wagen gehört (m) */
  zone: [number, number];
  /** gefahrene Strecke (Raddrehung in der Darstellung) */
  dist: number;
  /** Mitziehen nach dem Griff (s, läuft herunter) */
  tow: number;
}

/** Spur des Wagens: rechts auf der verbreiterten Straße (Wagenmitte) */
export function carLane(track: Track, z: number): number {
  return ROAD_HALF + track.extraAt(z) - CAR_HALF - 0.32;
}

/** neuer Wagen gut hinter dem Fahrer, schneller als er */
export function spawnCar(track: Track, zone: [number, number], p: { z: number; v: number }): TeamCar {
  const z = p.z - 26;
  return { z, x: carLane(track, z), v: Math.max(9, p.v + 6), phase: 'come', t: 0, reach: 0, got: false, zone, dist: 0, tow: 0 };
}

/** Lage der Hand (Flasche) in Streckenkoordinaten */
export function handOf(c: TeamCar): { z: number; x: number } {
  return { z: c.z + HAND_DZ, x: c.x + HAND_DX * (0.55 + 0.45 * c.reach) };
}

/**
 * Ein Schritt. p: Fahrer (z, x, v). Gibt zurück, was passiert ist: 'got' (Flasche gegriffen), 'missed' (Angebot
 * vorbei), 'gone' (Wagen weg, entfernen) oder null.
 */
export function stepCar(c: TeamCar, track: Track, p: { z: number; x: number; v: number }, dt: number): 'got' | 'missed' | 'gone' | null {
  c.t += dt;
  let out: 'got' | 'missed' | 'gone' | null = null;
  const h = handOf(c);
  if (c.phase === 'come') {
    // heranfahren, bis die Hand knapp vor dem Fahrer ist – dann ins Tempo des Fahrers
    const gap = p.z + 0.7 - h.z;
    c.v = gap > 6 ? Math.max(9, p.v + 6) : p.v + Math.max(-1, Math.min(6, gap * 1.1));
    // fährt der Fahrer in der Spur des Wagens: dahinter bleiben, bis er Platz macht (nie von hinten anfahren)
    if (p.x > c.x - CAR_HALF - 0.3 && p.z - (c.z + CAR_LEN / 2) < 4 && p.z > c.z) c.v = Math.min(c.v, p.v - 1);
    if (gap < 0.6) { c.phase = 'offer'; c.t = 0; }
    // Stelle schon fast zu Ende: lieber gar nicht erst anbieten
    if (c.z > c.zone[1] - 110) { c.phase = 'go'; c.t = 0; out = 'missed'; }
  } else if (c.phase === 'offer') {
    // die Hand bleibt knapp vor dem Fahrer (er fährt an sie heran)
    const gap = p.z + 0.6 - h.z;
    c.v = Math.max(4, p.v + Math.max(-2.5, Math.min(2.5, gap * 1.4)));
    c.reach = Math.min(1, c.reach + dt * 2.2);
    if (c.reach > 0.7 && Math.abs(p.x - h.x) < 0.42 && Math.abs(p.z - h.z) < 0.95) {
      c.got = true;
      c.tow = 0.7;
      c.phase = 'go';
      c.t = 0;
      out = 'got';
    } else if (c.t > 7.5 || c.z > c.zone[1] - 70) {
      c.phase = 'go';
      c.t = 0;
      out = 'missed';
    }
  } else {
    // zurückfallen lassen: erst noch kurz mitziehen (klebrige Flasche), dann langsamer als der Fahrer
    c.tow = Math.max(0, c.tow - dt);
    c.v = c.tow > 0 ? p.v : Math.max(3, p.v - 4.5);
    c.reach = Math.max(0, c.reach - dt * (c.tow > 0 ? 0.4 : 1.8));
    if (c.z < p.z - 34) out = 'gone';
  }
  c.z += c.v * dt;
  c.dist += c.v * dt;
  // Spur: der Straße folgen (wird sie wieder schmaler, rückt der Wagen nach links – dann ist er hinter dem Fahrer)
  const lane = carLane(track, c.z);
  c.x += (lane - c.x) * Math.min(1, dt * 2);
  return out;
}

/** Stößt ein Fahrer (z, x) seitlich an den Wagen? Dann Lage links neben dem Wagen, sonst null */
export function carBlock(c: TeamCar, z: number, x: number): number | null {
  if (Math.abs(z - c.z) > CAR_LEN / 2 + 0.25) return null;
  const edge = c.x - CAR_HALF - 0.3;
  return x > edge ? edge : null;
}
