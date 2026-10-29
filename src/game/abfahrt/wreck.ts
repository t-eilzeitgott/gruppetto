/**
 * Sturz im Feld (WebGPU-Abfahrt): wie Fahrer und Rad nach einem Aufprall auseinanderfliegen, rutschen und liegen
 * bleiben. Reine Funktion der Zeit seit dem Sturz – Spiellogik (Ort des Fahrers) und Darstellung (Haltung) lesen
 * dieselben Werte, so passt das Bild immer zur Lage auf der Straße.
 *
 * Ablauf: Das Vorderrad steht schlagartig, der Fahrer fliegt über den Lenker (Kopf voraus, die Arme gehen zum
 * Abstützen nach vorn), schlägt nach gut einer halben Sekunde auf, überschlägt sich seitlich und rutscht auf
 * Schulter und Hüfte aus, bis er liegen bleibt. Das Rad hebt hinten ab, kippt auf die Seite, dreht sich und
 * schlittert – es bremst stärker als der Körper und bleibt hinter dem Fahrer liegen.
 *
 * Koordinaten wie das Fahrermodell: vorn = −z, oben = +y, rechts = +x. Drehfolge: erst Nicken (um x), dann Rollen
 * (um die Fahrtrichtung z), dann Gieren (um y). Der Fahrer ist der Bezugspunkt (die Engine
 * schiebt seinen Ort mit wreckTravel weiter); das Rad liegt relativ dazu.
 */

/** ein Sturz: Zeit seit dem Aufprall (s), Tempo davor (m/s), Seite (−1 links, 1 rechts), Zufall je Fahrer */
export interface Wreck {
  t: number;
  v0: number;
  side: number;
  seed: number;
  /** Strecke (m) und Lage (m) beim Aufprall */
  z0: number;
  x0: number;
}

export interface Part { x: number; y: number; z: number; pitch: number; yaw: number; roll: number }

export interface WreckPose {
  /** Körper: dreht um das Becken, verschoben um x/y/z (relativ zur Fahrhaltung) */
  rider: Part;
  /** Rad: dreht um den Bodenpunkt unter dem Tretlager */
  bike: Part;
  /** Arme nach vorn (abstützen, 0–1) */
  brace: number;
  /** Beine angezogen (0–1) */
  tuck: number;
}

/** Flug über den Lenker (s) */
const FLIGHT = 0.5;
/** Bremsen beim Rutschen auf Asphalt (m/s²): Körper, Rad */
const SLIDE = 5.2;
const BIKE_SLIDE = 8.5;

const sat = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x: number) => { const u = sat(x); return u * u * (3 - 2 * u); };

/** Weg des Körpers seit dem Aufprall (m) und sein Tempo (m/s) */
export function wreckTravel(w: Pick<Wreck, 't' | 'v0'>): { s: number; v: number } {
  const v1 = w.v0 * 0.9;
  if (w.t <= FLIGHT) return { s: v1 * w.t, v: v1 };
  const tt = w.t - FLIGHT;
  const stop = v1 / SLIDE;
  const u = Math.min(tt, stop);
  return { s: v1 * FLIGHT + v1 * u - 0.5 * SLIDE * u * u, v: Math.max(0, v1 - SLIDE * tt) };
}

/** Weg des Rads (m) */
function bikeTravel(t: number, v0: number): number {
  const v1 = v0 * 0.55;
  const u = Math.min(t, v1 / BIKE_SLIDE);
  return v1 * u - 0.5 * BIKE_SLIDE * u * u;
}

/** liegt still (für Kamera und Ende des Sturzes) */
export function wreckSettled(w: Pick<Wreck, 't' | 'v0'>): boolean {
  return wreckTravel(w).v <= 0 && w.t > FLIGHT + 0.6;
}

export function wreckPose(w: Wreck): WreckPose {
  const t = w.t;
  const sd = w.side >= 0 ? 1 : -1;
  // Heftigkeit: langsame Stürze sind kleiner (weniger Flug, weniger Überschlag)
  const hard = sat((w.v0 - 4) / 14);
  const r1 = fract(w.seed * 7.13);
  const r2 = fract(w.seed * 3.71 + 0.3);
  const flight = FLIGHT * (0.7 + 0.3 * hard);

  // ---- Körper
  const rid: Part = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
  // über den Lenker: Kopf voraus nach vorn unten
  const over = ease(t / (flight * 0.8));
  rid.pitch = -(0.5 + 1.1 * hard) * over;
  // Flughöhe (Becken), danach auf dem Boden: das Becken liegt gut 15 cm hoch (statt knapp 1 m im Sattel)
  const hop = t < flight ? Math.sin((Math.PI * t) / flight) * (0.18 + 0.42 * hard) : 0;
  const down = ease((t - flight * 0.75) / 0.25);
  rid.y = hop - 0.78 * down;
  // nach dem Aufprall: seitlich über die Schulter abrollen (ein ganzer Überschlag bei hohem Tempo), dann auf der
  // Seite ausrutschen – am Ende liegt er auf der Seite, leicht eingerollt
  const tumble = ease((t - flight) / (0.55 + 0.5 * hard));
  const turns = hard > 0.45 ? 1 : 0;
  rid.roll = sd * ((1.25 + 0.25 * r1) * down + Math.PI * 2 * turns * tumble);
  // aus dem Kopfsprung wird ein Liegen (Körper waagrecht): zurück auf etwa −90°
  rid.pitch += (-(Math.PI / 2) * (0.92 + 0.12 * r2) - rid.pitch) * ease((t - flight) / 0.45);
  rid.yaw = sd * (0.25 + 0.5 * r2) * ease((t - flight) / 1.4);
  rid.x = sd * (0.15 + 0.35 * r1) * ease(t / 1.2);
  // Abstützen in der Luft, danach Arme und Beine schlaff, leicht eingerollt
  const brace = sat(t / 0.18) * (1 - 0.7 * ease((t - flight - 0.3) / 0.6));
  const tuck = 0.35 + 0.4 * ease((t - flight) / 0.8);

  // ---- Rad
  const bk: Part = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
  // hinten hoch (Vorderrad blockiert), dann flach auf die Seite
  const kick = t < 0.45 ? Math.sin((Math.PI * t) / 0.45) : 0;
  bk.pitch = -(0.35 + 0.55 * hard) * kick;
  bk.y = 0.25 * hard * kick + 0.05 * ease(t / 0.4);
  bk.roll = -sd * 1.5 * ease((t - 0.08) / 0.4);
  bk.yaw = -sd * (0.6 + 1.6 * hard * r2) * ease(t / 1.6);
  // das Rad bleibt zurück: Abstand Körper – Rad entlang der Straße (+z = hinter dem Fahrer)
  bk.z = Math.max(0, wreckTravel(w).s - bikeTravel(t, w.v0)) + 0.4 * ease(t / 0.4);
  bk.x = -sd * (0.3 + 0.5 * r1) * ease(t / 0.8);
  return { rider: rid, bike: bk, brace, tuck };
}

function fract(x: number) { return x - Math.floor(x); }
