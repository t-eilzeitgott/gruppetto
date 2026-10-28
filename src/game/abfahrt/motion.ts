/**
 * Bewegung mit Schwung – gemeinsame Helfer für die Spiellogiken (Abfahrt, Sprint, Berg) und die Darstellung.
 *
 * Bisher sprang die Kurbel zwischen „dreht mit voller Trittfrequenz“ und „steht waagrecht“ hin und her, sobald
 * ein Schwellwert kippte (Tempo, Haltung, Bremsen). Hier hat sie eine Drehzahl mit Trägheit: beim Antreten kommt
 * sie in einer knappen halben Sekunde auf Touren, beim Rollenlassen laufen die Beine aus und pendeln gedämpft in
 * die waagrechte Stellung (rechts oder links vorn – was gerade näher liegt).
 *
 * Dazu eine kritisch gedämpfte Feder für Haltungen: anders als die bisherige Glättung (sofortiger Ruck, dann
 * langsames Auslaufen) setzt sie weich an und kommt weich an – wie ein Mensch, der sich duckt oder aufrichtet.
 */

export interface Pedaller {
  /** Kurbelwinkel (rad) */
  pedal: number;
  /** Drehzahl der Kurbel (rad/s), fehlt vor dem ersten Schritt */
  cad?: number;
}

const TWO_PI = Math.PI * 2;
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** weiche Stufe: 0 bei a, 1 bei b (a darf größer als b sein) */
export function smooth(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/**
 * Kurbel einen Schritt weiterdrehen. want = Wunschdrehzahl (rad/s), 0 = rollen lassen.
 * Antreten zügig, Auslaufen gemächlich; ohne Antrieb pendelt die Kurbel in die Waagrechte.
 */
export function pedalStep(o: Pedaller, want: number, dt: number) {
  let w = o.cad ?? 0;
  // zügig auf Touren (Antritt), sanft auslaufen
  w += (want - w) * Math.min(1, dt * (want > w ? 3.6 : 2.4));
  const drive = clamp01(want / 2.5);
  if (drive < 1) {
    // ohne Antrieb und fast ausgelaufen: gedämpftes Pendeln zur waagrechten Kurbel (stabil bei 0 und π;
    // meist nach gut einer Sekunde ruhig)
    const slow = 1 - clamp01(Math.abs(w) / 4);
    w += (-Math.sin(2 * o.pedal) * 20 - w * 9) * (1 - drive) * slow * dt;
  }
  o.cad = w;
  let a = o.pedal + w * dt;
  if (a >= TWO_PI) a -= TWO_PI;
  else if (a < 0) a += TWO_PI;
  o.pedal = a;
}

/** gleichmäßige Trittfrequenz bei Tempo v (rad/s): ~75/min bei 13 m/s, gedeckelt bei ~105/min */
export const cadenceFor = (v: number) => Math.min(11, v / 2.1 + 2);

/** Zustand einer kritisch gedämpften Feder */
export interface Spring { x: number; v: number }

export const spring = (x = 0): Spring => ({ x, v: 0 });

/**
 * Feder einen Schritt zum Ziel bringen (exakte Lösung, stabil für jedes dt). w = Kreisfrequenz (1/s):
 * nach etwa 4/w ist das Ziel praktisch erreicht, ohne Überschwingen.
 */
export function springStep(s: Spring, target: number, w: number, dt: number): number {
  const e = Math.exp(-w * dt);
  const c = s.x - target;
  const k = (s.v + w * c) * dt;
  s.x = (c + k) * e + target;
  s.v = (s.v - k * w) * e;
  return s.x;
}

/** Feder ohne Übergang auf einen Wert setzen (erster Schritt, Neustart) */
export function springSet(s: Spring, x: number) {
  s.x = x;
  s.v = 0;
}
