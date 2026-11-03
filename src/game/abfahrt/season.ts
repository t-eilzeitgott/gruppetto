/**
 * Jahreszeiten in den Spielwelten – nur fürs Auge, die Strecken bleiben gleich. Nach dem Kalender (meteorologisch:
 * Frühling März–Mai, Sommer Juni–August, Herbst September–November, Winter Dezember–Februar), mit weichen
 * Übergängen innerhalb der Jahreszeit:
 *  - Herbst: das Laub färbt sich von Anfang September bis Mitte Oktober, im November werden die Bäume kahler; die
 *    Wiesen werden strohig, Laub liegt am Straßenrand, Blätter wehen; warmes, tiefes Licht, Dunst, früh brennen
 *    die Fenster
 *  - Winter: kahle Laubbäume, Schnee auf Nadelbäumen, Wiesen und Wäldern (in den Alpen bis ins Tal, im Süden nur
 *    oben), es schneit leise; kühles Licht, Lichter in den Häusern
 *  - Frühling: frisches helles Grün, Blüten an Obstbäumen, viele Wiesenblumen, Blütenblätter in der Luft
 *  - Sommer: wie bisher
 * Zum Ansehen: ?saison=herbst|winter|fruehling|sommer oder als Admin im Startblatt „Jahreszeit ansehen“
 */
import type { Region } from './region';

export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';

/** alles, was die Welt je Jahreszeit anders zeigt (0 … 1) */
export interface SeasonLook {
  id: SeasonId;
  /** Laubfärbung (gelb, orange, rot) */
  autumn: number;
  /** Laubbäume kahl */
  bare: number;
  /** Schnee auf Bäumen */
  treeSnow: number;
  /** Blüten an Laubbäumen, frisches Grün */
  blossom: number;
  /** Wiesen strohig, Wälder bunt */
  dry: number;
  /** Schnee auf Wiesen und im Wald (dazu der Schnee der Höhenlage) */
  snow: number;
  /** frisches Frühlingsgrün */
  fresh: number;
  /** Wiesenblumen (1 = wie bisher) */
  flowers: number;
  /** Laub am Boden */
  litter: number;
  /** was in der Luft treibt */
  air: 'leaves' | 'snow' | 'petals' | null;
  /** wie dicht (0 … 1) */
  airK: number;
  /** Tageszeit später (Herbst und Winter dunkeln früher) */
  todShift: number;
  /** Licht: wärmer (> 0) oder kühler (< 0) */
  warm: number;
  /** mehr Dunst */
  haze: number;
  /** Lichter in Fenstern und Laternen mindestens so hell (gemütlich) */
  lamps: number;
}

const NAMES: Record<string, SeasonId> = { fruehling: 'spring', frühling: 'spring', sommer: 'summer', herbst: 'autumn', winter: 'winter', spring: 'spring', summer: 'summer', autumn: 'autumn' };

/** Jahreszeit zum Ansehen (Admins, Startblatt; localStorage) */
export const SEASON_KEY = 'gruppetto.saison';

/** ?saison=… oder die gespeicherte Wahl (nur im Browser) */
function override(): SeasonId | null {
  try {
    const m = /[?&]saison=([a-zäöü]+)/i.exec(window.location.search);
    const v = m ? m[1] : localStorage.getItem(SEASON_KEY);
    return v ? NAMES[v.toLowerCase()] ?? null : null;
  } catch {
    return null;
  }
}

const smooth = (a: number, b: number, x: number) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

/** Tag im Jahr (1 … 366) aus einem Tagesschlüssel (JJJJ-MM-TT) */
function dayOfYear(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  const t = Date.UTC(y || 2027, (m || 1) - 1, d || 1);
  return Math.floor((t - Date.UTC(y || 2027, 0, 1)) / 864e5) + 1;
}

/** Jahreszeit eines Tages */
export function seasonOf(dayKey: string): SeasonId {
  const o = override();
  if (o) return o;
  const m = Number(dayKey.slice(5, 7)) || 7;
  return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter';
}

/** Gegenden mit schneereichem Winter (bis ins Tal) und solche, wo es nur oben schneit */
const SNOWY: Partial<Record<Region, number>> = { dolomiten: 1, suedtirol: 0.85, alpen: 1, pyrenaeen: 0.75, nord: 0.45, po: 0.4, apennin: 0.4, toskana: 0.22, provence: 0.18, riviera: 0.1, spanien: 0.2, andalusien: 0.08 };

/**
 * Aussehen für einen Tag und eine Gegend. Mit ?saison=… die volle Ausprägung (Mitte der Jahreszeit), sonst nach
 * dem Datum: Herbstfarben steigen im September, stehen im Oktober, im November fällt das Laub.
 */
export function seasonLook(dayKey: string, region: Region): SeasonLook {
  const id = seasonOf(dayKey);
  const forced = override() !== null;
  const doy = dayOfYear(dayKey);
  const snowy = SNOWY[region] ?? 0.5;
  const base: SeasonLook = {
    id, autumn: 0, bare: 0, treeSnow: 0, blossom: 0, dry: 0, snow: 0, fresh: 0, flowers: 1, litter: 0,
    air: null, airK: 0, todShift: 0, warm: 0, haze: 0, lamps: 0,
  };
  if (id === 'autumn') {
    // 1. Sep ≈ 244, 15. Okt ≈ 288, 30. Nov ≈ 334
    const color = forced ? 1 : smooth(236, 285, doy);
    const fall = forced ? 0.35 : smooth(296, 334, doy) * 0.75;
    return {
      ...base, autumn: color, bare: fall, dry: 0.25 + 0.35 * color, flowers: 0.25 * (1 - color), litter: 0.3 + 0.7 * color,
      air: 'leaves', airK: 0.35 + 0.65 * color, todShift: 0.04 + 0.03 * color, warm: 0.6, haze: 0.35, lamps: 0.22 + 0.15 * color,
    };
  }
  if (id === 'winter') {
    return {
      ...base, autumn: 0.15, bare: 1, treeSnow: 0.3 + 0.7 * snowy, dry: 0.75, snow: snowy, flowers: 0, litter: 0.15,
      air: 'snow', airK: 0.25 + 0.75 * snowy, todShift: 0.04, warm: -0.6, haze: 0.25, lamps: 0.45,
    };
  }
  if (id === 'spring') {
    // Blüte im April, im Mai schon mehr Grün als Blüte
    const bloom = forced ? 1 : smooth(70, 100, doy) * (1 - smooth(130, 150, doy) * 0.7);
    return {
      ...base, blossom: bloom, fresh: 1, flowers: 1.45, air: bloom > 0.3 ? 'petals' : null, airK: bloom * 0.6,
      todShift: -0.02, warm: 0.1, haze: -0.15,
    };
  }
  return base;
}

/** Baumklassen für die Färbung (Bildbäume, forest3d.ts) */
export const TREE_CLASS: Record<string, number> = {
  pine: 0, pineSnow: 0, cypress: 0, olive: 0, palm: 0,
  tree: 1, treeRound: 1, poplar: 1,
  larch: 2,
  apple: 3,
};
