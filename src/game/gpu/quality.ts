/**
 * Qualitätsstufen der Abfahrt (WebGPU): Schonend, Mittel, Hoch. Eine Stufe setzt zweierlei:
 * - Einstellungen, die man auch einzeln ändern kann (Bildrate, Auflösung, Pflanzen, Gras, Gegner, Bäume fern …)
 * - Reichweiten und Schattierung der Welt (QUALITY): wie weit Bäume, Zuschauer und Fahrer als volles Modell stehen,
 *   wie weit Zuschauer als Bilder, wann Häuser gröber werden, wie fein die Landschaft gerechnet wird. Diese Werte
 *   lesen die Bausteine beim Aufbau – ein Wechsel wirkt nach dem Neuladen.
 *
 * „Schonend“: so wenig Arbeit je Bild wie möglich (auf dem iPhone wurde es sonst nach Sekunden warm und drosselte).
 */
import type { Settings } from './mood';

export type QualityLevel = 'schonend' | 'mittel' | 'hoch';
export const QUALITY_LEVELS: QualityLevel[] = ['schonend', 'mittel', 'hoch'];

export interface WorldQuality {
  /** Bäume als 3D-Modell bis hier (m, Mitte des Überblendbands), dahinter Bilder */
  treeNear: number;
  /** Zuschauer in der Nähe als 3D-Modell (sonst überall Bilder) */
  crowd3d: boolean;
  /** Zuschauer als Bilder bis hier (m), am Ende weich ausgeblendet */
  crowdFar: number;
  /** Häuser: Stufenwechsel (voll → mittel → fern) so viel weiter bzw. näher */
  houseK: number;
  /** Gegner als volles Modell bis hier (m zur Kamera), dahinter das einfache Fahrerfeld */
  riderNear: number;
  /** Fahrerfeld (einfache Fahrer) bis so weit voraus (m) */
  pelAhead: number;
  /** Landschaft einfach: nah ohne Korn, Trittpfade, Blüten und Erdflecken; mittlere Stufe überall ohne Normalenkarten */
  landSimple: boolean;
}

export const QUALITY_PRESETS: Record<QualityLevel, { settings: Partial<Settings>; world: WorldQuality }> = {
  schonend: {
    settings: { fpsMax: 60, maxDpr: 1.25, minDpr: 1, msaa: 4, crowd: true, life: false, grass: false, sunset: false, oppMax: 6, treeFar: 500 },
    world: { treeNear: 24, crowd3d: false, crowdFar: 260, houseK: 0.6, riderNear: 12, pelAhead: 450, landSimple: true },
  },
  mittel: {
    settings: { fpsMax: 60, maxDpr: 2, minDpr: 1.3, msaa: 4, crowd: true, life: true, grass: true, sunset: true, oppMax: 10, treeFar: 1100 },
    world: { treeNear: 40, crowd3d: true, crowdFar: 470, houseK: 1, riderNear: 28, pelAhead: 950, landSimple: false },
  },
  hoch: {
    settings: { fpsMax: 0, maxDpr: 3, minDpr: 1.6, msaa: 4, crowd: true, life: true, grass: true, sunset: true, oppMax: 14, treeFar: 1850 },
    world: { treeNear: 52, crowd3d: true, crowdFar: 720, houseK: 1.25, riderNear: 34, pelAhead: 950, landSimple: false },
  },
};

/** gilt für die Welt, die gerade gebaut wird (vor dem Aufbau setzen) */
export const QUALITY: WorldQuality = { ...QUALITY_PRESETS.mittel.world };

export function setQuality(level: QualityLevel | undefined) {
  Object.assign(QUALITY, QUALITY_PRESETS[level && level in QUALITY_PRESETS ? level : 'mittel'].world);
}
