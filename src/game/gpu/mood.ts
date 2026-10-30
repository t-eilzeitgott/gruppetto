/**
 * Stimmungen für den WebGPU-Test: Tageszeit und Wetter (strahlender Mittag, goldene Stunde, Nacht, Morgen im
 * Dunst, Regen) als Sätze von Werten für Sonne, Himmel, Dunst und Farbfilter – dazu die Einstellungen, die der
 * Nutzer selbst verstellen kann (Schalter und Regler im Menü). Beides lässt sich weich überblenden.
 */
import * as THREE from 'three/webgpu';
import { tsl } from './nodes';

const { uniform } = tsl;

export type MoodId = 'mittag' | 'gold' | 'nacht' | 'morgen' | 'regen' | 'abend';
export const MOOD_IDS: MoodId[] = ['mittag', 'gold', 'nacht', 'morgen', 'regen', 'abend'];

/** Werte des Himmels (werden je Stimmung einmal in Würfeltexturen gebacken) */
export interface SkyParams { elev: number; azim: number; turbidity: number; rayleigh: number; mie: number; mieG: number; cover: number; density: number; cloudElev: number }

/** alles, was sich weich überblenden lässt (Zahlen) */
export interface Light {
  /** Lichtrichtung (Sonne oder Mond): Höhe, Azimut in Grad */
  elev: number; azim: number;
  sunI: number; sunR: number; sunG: number; sunB: number;
  env: number; hemi: number; exposure: number;
  fog: number; fogThin: number;
  /** Farbfilter */
  warm: number; sat: number; contrast: number; vignette: number; grain: number; split: number;
  sR: number; sG: number; sB: number; hR: number; hG: number; hB: number;
  bloom: number; bthr: number;
  /** Nacht (Sterne, Fenster), Regen (Streifen), nasse Straße, Sonnenglühen (0 aus, 1 Sonne, 2 Mond) */
  night: number; rain: number; wet: number; glow: number;
  /** Lichter an: Fenster, Laternen (0 … 1) */
  lights: number;
  /** Farbe des Himmelslichts (Faktoren auf das gemessene; Abend: kühler – Schatten blau, Sonne warm) */
  ambR: number; ambG: number; ambB: number;
}

export interface Mood { id: MoodId; name: string; sky: SkyParams; light: Light }

const grade = (warm: number, sat: number, contrast: number, vignette: number, grain: number, split: number, s: [number, number, number], h: [number, number, number]) =>
  ({ warm, sat, contrast, vignette, grain, split, sR: s[0], sG: s[1], sB: s[2], hR: h[0], hG: h[1], hB: h[2] });

export const MOODS: Record<MoodId, Mood> = {
  mittag: {
    id: 'mittag', name: 'Mittag', sky: { elev: 34, azim: 215, turbidity: 2.2, rayleigh: 1.2, mie: 0.004, mieG: 0.78, cover: 0.3, density: 0.5, cloudElev: 0.55 },
    light: {
      elev: 34, azim: 215, sunI: 3.4, sunR: 1, sunG: 0.95, sunB: 0.86, env: 0.17, hemi: 0, exposure: 0.5, fog: 0.5, fogThin: 1,
      ...grade(0.25, 1.08, 1.08, 0.3, 0.06, 0.35, [0.92, 0.96, 1.08], [1.08, 1.0, 0.9]),
      bloom: 0.06, bthr: 4, night: 0, rain: 0, wet: 0, glow: 1, lights: 0, ambR: 1, ambG: 1, ambB: 1,
    },
  },
  gold: {
    id: 'gold', name: 'Goldene Stunde', sky: { elev: 6, azim: 200, turbidity: 6, rayleigh: 2.8, mie: 0.012, mieG: 0.85, cover: 0.45, density: 0.55, cloudElev: 0.5 },
    light: {
      elev: 6, azim: 200, sunI: 4.2, sunR: 1, sunG: 0.58, sunB: 0.3, env: 0.3, hemi: 0.25, exposure: 0.8, fog: 0.9, fogThin: 1,
      ...grade(0.55, 1.12, 1.15, 0.45, 0.1, 0.6, [0.84, 0.9, 1.14], [1.12, 1.0, 0.84]),
      bloom: 0.12, bthr: 2.5, night: 0, rain: 0, wet: 0, glow: 1, lights: 0.3, ambR: 1, ambG: 1, ambB: 1,
    },
  },
  nacht: {
    id: 'nacht', name: 'Nacht', sky: { elev: -14, azim: 250, turbidity: 2, rayleigh: 1, mie: 0.003, mieG: 0.8, cover: 0.2, density: 0.4, cloudElev: 0.5 },
    light: {
      elev: 38, azim: 120, sunI: 0.35, sunR: 0.55, sunG: 0.66, sunB: 1.0, env: 0.2, hemi: 0.4, exposure: 1.3, fog: 0.4, fogThin: 1,
      ...grade(-0.35, 0.75, 1.12, 0.55, 0.18, 0.5, [0.85, 0.9, 1.2], [1, 1, 1]),
      bloom: 0.2, bthr: 1.2, night: 1, rain: 0, wet: 0, glow: 2, lights: 1, ambR: 1, ambG: 1, ambB: 1,
    },
  },
  morgen: {
    id: 'morgen', name: 'Morgen', sky: { elev: 5, azim: 110, turbidity: 5, rayleigh: 2.2, mie: 0.01, mieG: 0.82, cover: 0.35, density: 0.45, cloudElev: 0.5 },
    light: {
      elev: 5, azim: 110, sunI: 3.6, sunR: 1, sunG: 0.76, sunB: 0.5, env: 0.3, hemi: 0.3, exposure: 0.8, fog: 1.9, fogThin: 1.6,
      ...grade(0.3, 0.95, 1.05, 0.35, 0.1, 0.4, [0.9, 0.94, 1.1], [1.1, 1.0, 0.9]),
      bloom: 0.15, bthr: 2, night: 0, rain: 0, wet: 0, glow: 1, lights: 0, ambR: 1, ambG: 1, ambB: 1,
    },
  },
  regen: {
    id: 'regen', name: 'Regen', sky: { elev: 30, azim: 205, turbidity: 10, rayleigh: 0.6, mie: 0.02, mieG: 0.6, cover: 0.98, density: 0.9, cloudElev: 0.3 },
    light: {
      elev: 30, azim: 205, sunI: 0.45, sunR: 0.8, sunG: 0.85, sunB: 0.95, env: 0.26, hemi: 0.15, exposure: 0.4, fog: 1.7, fogThin: 1.2,
      ...grade(-0.3, 0.72, 1.1, 0.5, 0.15, 0.4, [0.88, 0.92, 1.08], [1, 1, 1]),
      bloom: 0.08, bthr: 3, night: 0, rain: 1, wet: 1, glow: 0, lights: 0.4, ambR: 1, ambG: 1, ambB: 1,
    },
  },
  // Sonnenuntergang (Abfahrt und Zeitfahren auf WebGPU): die Sonne knapp über den Graten, links voraus – Gipfel und
  // Hänge zur Sonne glühen, die Täler liegen im Schatten, in den Häusern und Laternen brennt Licht
  abend: {
    id: 'abend', name: 'Sonnenuntergang', sky: { elev: 3.5, azim: 245, turbidity: 7.5, rayleigh: 3.4, mie: 0.016, mieG: 0.87, cover: 0.42, density: 0.55, cloudElev: 0.46 },
    light: {
      elev: 3.5, azim: 245, sunI: 5.4, sunR: 1, sunG: 0.5, sunB: 0.24, env: 0.42, hemi: 0, exposure: 0.95, fog: 0.85, fogThin: 1,
      ...grade(0.4, 1.14, 1.12, 0.42, 0.08, 0.6, [0.82, 0.88, 1.18], [1.14, 0.98, 0.82]),
      bloom: 0.14, bthr: 2.2, night: 0, rain: 0, wet: 0, glow: 1, lights: 1, ambR: 0.72, ambG: 0.84, ambB: 1.2,
    },
  },
};

/** Einstellungen des Nutzers (Menü): Schalter und Regler, die über die Stimmung gelegt werden */
export interface Settings {
  mood: MoodId;
  /** Wetterwechsel: alle Stimmungen der Reihe nach */
  cycle: boolean;
  shadows: boolean;
  bloom: boolean;
  grade: boolean;
  vignette: boolean;
  grain: boolean;
  fog: boolean;
  rain: boolean;
  crowd: boolean;
  life: boolean;
  grass: boolean;
  cinema: boolean;
  /** Regler: Faktoren bzw. Verschiebungen auf die Werte der Stimmung */
  exposure: number;
  warm: number;
  sat: number;
  contrast: number;
  sun: number;
  env: number;
  fogK: number;
  bloomK: number;
  vignetteK: number;
  grainK: number;
  maxDpr: number;
  /** Feinabstimmung */
  splitK: number;
  bthrK: number;
  rainK: number;
  wetK: number;
  hemiK: number;
  sunElev: number;
  sunAzim: number;
  shadowRes: number;
  shadowRange: number;
  /** Kantenglättung (wirkt nach Neuladen) */
  msaa: number;
  /** Gegner im Bild (höchstens; die nächsten zur Kamera) */
  oppMax: number;
  /** Auflösung mindestens (die Automatik geht nicht darunter) */
  minDpr: number;
  /** dramatischer Himmel: gebackene Quellwolken mit Lichtkanten (kostet nur beim Backen) */
  drama: boolean;
  /** dezentes Sonnenuntergangs-Licht: warmer Schein um die tiefe Sonne in der Nachbearbeitung (fast kostenlos) */
  sunset: boolean;
  /** Bäume als Bilder bis so weit (m); dahinter nur das Kronendach im Boden */
  treeFar: number;
  /**
   * Bildrate höchstens (Bilder je Sekunde; 0: so viele, wie der Bildschirm zeigt) – weniger Wärme und Akku. Auf dem
   * iPhone kann es aber langsamer werden: mit Pausen zwischen den Bildern taktet die Grafik herunter
   */
  fpsMax: number;
}

export const DEFAULT_SETTINGS: Settings = {
  mood: 'mittag', cycle: false, shadows: true, bloom: true, grade: true, vignette: true, grain: true, fog: true, rain: true, crowd: true, life: true, grass: true, cinema: false,
  exposure: 1, warm: 0, sat: 1, contrast: 1, sun: 1, env: 1, fogK: 1, bloomK: 1, vignetteK: 1, grainK: 1, maxDpr: 2,
  splitK: 1, bthrK: 1, rainK: 1, wetK: 1, hemiK: 1, sunElev: 0, sunAzim: 0, shadowRes: 2048, shadowRange: 55, msaa: 4, oppMax: 12, minDpr: 0.85, drama: false, sunset: false, treeFar: 1850, fpsMax: 0,
};

/** Spiel (Abfahrt auf WebGPU): goldene Stunde, dramatischer Himmel, Sonnenuntergangs-Licht */
/**
 * Spiel (Abfahrt auf WebGPU): goldene Stunde, dramatischer Himmel, Sonnenuntergangs-Licht; Bild in doppelter
 * Auflösung, die Szene darin höchstens bis ×1,4 kleiner gerechnet; Leuchten aus (eigene Bildkette)
 */
export const RACE_DEFAULTS: Settings = { ...DEFAULT_SETTINGS, mood: 'abend', drama: true, sunset: true, bloom: false, shadows: false, cycle: false, oppMax: 10, treeFar: 1100, maxDpr: 2, minDpr: 1.4, fpsMax: 0 };
/** v2: neue Grafik (günstiges Licht, Auflösung der Szene) – alte Einstellungen gelten nicht mehr */
export const RACE_KEY = 'gruppetto.gpu.race2';
/** Zeitfahren (Abfahrt auf WebGPU): wie die Abfahrt – Sonnenuntergang, Lichter an */
export const TT_DEFAULTS: Settings = { ...RACE_DEFAULTS };
export const TT_KEY = 'gruppetto.gpu.tt';

const KEY = 'gruppetto.gpu.settings';

export function loadSettings(key = KEY, defaults: Settings = DEFAULT_SETTINGS): Settings {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...defaults };
    const s = JSON.parse(raw) as Partial<Settings>;
    const out = { ...defaults, ...s };
    if (!MOOD_IDS.includes(out.mood)) out.mood = defaults.mood;
    return out;
  } catch { return { ...defaults }; }
}

export function saveSettings(s: Settings, key = KEY) {
  try { localStorage.setItem(key, JSON.stringify(s)); } catch { /* egal */ }
}

/** Zielwerte aus Stimmung und Einstellungen */
export function resolve(mood: Mood, s: Settings): Light {
  const L = { ...mood.light };
  L.exposure *= s.exposure;
  L.sunI *= s.sun;
  L.env *= s.env;
  L.hemi *= s.env * s.hemiK;
  L.elev = Math.max(2, Math.min(89, L.elev + s.sunElev));
  L.azim += s.sunAzim;
  L.bthr *= s.bthrK;
  L.rain *= s.rainK;
  L.wet *= s.wetK;
  L.fog = s.fog ? L.fog * s.fogK : 0;
  if (s.grade) {
    L.warm = Math.max(-1, Math.min(1, L.warm + s.warm));
    L.sat *= s.sat;
    L.contrast *= s.contrast;
    L.split *= s.splitK;
  } else { L.warm = 0; L.sat = 1; L.contrast = 1; L.split = 0; }
  L.vignette = s.vignette ? L.vignette * s.vignetteK : 0;
  L.grain = s.grain ? L.grain * s.grainK : 0;
  L.bloom = s.bloom ? L.bloom * s.bloomK : 0;
  if (!s.rain) { L.rain = 0; }
  return L;
}

export const LIGHT_KEYS = Object.keys(MOODS.mittag.light) as (keyof Light)[];

/** Richtung aus Höhe und Azimut (Grad) */
export function dirOf(elev: number, azim: number): THREE.Vector3 {
  return new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elev), THREE.MathUtils.degToRad(azim));
}

/** Uniforms, die mehrere Materialien lesen (Nacht: Fenster leuchten; nasse Straße; Regen) */
export const MOOD_U = {
  night: uniform(0) as { value: number },
  /** Fenster und Laternen an (0 … 1) */
  lights: uniform(0) as { value: number },
  wet: uniform(0) as { value: number },
  rain: uniform(0) as { value: number },
};
