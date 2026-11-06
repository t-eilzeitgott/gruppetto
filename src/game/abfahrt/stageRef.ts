/**
 * Echte Vorlagen für Sprint- und Bergfinale und das Zeitfahren: Etappe, Zielort, Schlussanstieg (Name, Gipfelhöhe,
 * Länge, Steigung) und die Landessprache für Schilder und Straßenmalereien.
 * Quelle ist die gewählte Rundfahrt (heutige oder nächste passende Etappe); hat sie (noch) keine
 * Etappen, kommt täglich ein anderes Finale aus dem offiziellen Plan der Tour de France 2027.
 */
import type { Climb, Stage, StageKind } from '../../lib/types';
import { SEASON_2027 } from '../../data/season2027';
import type { Lang } from './facade';
import { parseFinale, type FinaleSpec } from './finale';
import { LOOKS, regionOf, type Region } from './region';
import { berlinDayKey, hashStr } from './rng';
import { forcedVenue, tourIdOf, venueOf, type Venue } from './venue';

export type FinaleKind = 'sprint' | 'mountain' | 'tt';

export interface StageRef {
  lang: Lang;
  /** Name der Rundfahrt, z. B. „Tour de France 2027“ */
  tour: string;
  stage: number;
  /** YYYY-MM-DD */
  date: string;
  from: string;
  /** echtes Etappenziel */
  to: string;
  /** Zielort im Spiel (ohne Klammerzusatz) */
  town: string;
  /** Bergfinale: letzter Anstieg der Etappe */
  climb: Climb | null;
  /** Ziel oben am Berg (das Spiel fährt trotzdem über die Bergwertung hinunter ins Ziel) */
  summitFinish: boolean;
  /** Vorschau aus einer anderen Rundfahrt, weil die gewählte noch keine passende Etappe hat */
  preview: boolean;
  /** Sprintfinale: Bauplan der letzten Kilometer aus dem Streckentext der Etappe */
  finale: FinaleSpec | null;
  /**
   * Landschaft nach der Gegend der Etappe (aus Rundfahrt und Orten). Sie und lang steuern auch Zufallsentscheidungen der
   * Strecke – das Ortsbild eines Schauplatzes (venue) ändert nur, wie es aussieht, nie die Straße.
   */
  region: Region;
  /** Schauplatz: Ortsbild der Etappe (Häuser, Laternen, Bäume, Schilder, Wahrzeichen) – null außerhalb von Giro und Tour 2027 */
  venue: Venue | null;
  /** Tag für die Jahreszeit (Vorschau eines Schauplatzes: das Etappendatum, sonst der Spieltag) */
  lookDay?: string;
}

const UK = /edinburgh|carlisle|keswick|liverpool|welshpool|cardiff|london|leeds|harrogate|york|sheffield|glasgow|manchester|cambridge|brighton|dundee|aberdeen/i;

export function langOf(tour: string, place: string): Lang {
  if (/giro/i.test(tour)) return 'it';
  if (/vuelta/i.test(tour)) return 'es';
  if (UK.test(place)) return 'en';
  return 'fr';
}

/** Testmodus: ?region=toskana erzwingt eine Gegend (für Sichtprüfungen) */
function forcedRegion(): Region | null {
  if (typeof window === 'undefined') return null;
  const m = /[?&]region=([a-z]+)/.exec(window.location.search);
  return m && m[1] in LOOKS ? (m[1] as Region) : null;
}

const fits = (kind: FinaleKind, k: StageKind) => (kind === 'sprint' ? k === 'flat' || k === 'hilly' : kind === 'tt' ? k === 'itt' : k === 'mountain');
const clean = (s: string) => s.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

function lastClimb(climbs: Climb[] | undefined): Climb | null {
  const list = (climbs ?? []).filter((c) => c.name);
  if (!list.length) return null;
  return [...list].sort((a, b) => a.km - b.km)[list.length - 1];
}

type StageLike = { number: number; date: string; from: string; to: string; km: number | null; climbs?: Climb[]; finale?: string | null; kind?: StageKind };

function make(kind: GameKind, tour: string, s: StageLike, preview: boolean, lookDay?: string): StageRef {
  const venue = venueOf(tourIdOf(tour), s.number);
  // Zeitfahren: der (letzte) Anstieg der Etappe gibt der Côte ihren Namen; ohne einen den Anstieg der Gegend
  const climb = kind === 'mountain' || kind === 'tt' ? lastClimb(s.climbs) ?? venue?.climb ?? null : null;
  const town = clean(s.to) || s.to;
  // eine Etappe anderer Art (Schauplatz des Tages): ihr Streckentext beschreibt kein Sprintfinale
  const sprintText = kind === 'sprint' && (!s.kind || fits('sprint', s.kind));
  return {
    lang: langOf(tour, `${s.from} ${s.to}`),
    tour,
    stage: s.number,
    date: s.date,
    from: clean(s.from),
    to: s.to,
    town,
    climb,
    summitFinish: !!climb && climb.km > 0 && s.km !== null && s.km - climb.km < 1.5,
    preview,
    finale: sprintText ? parseFinale(s.finale) : null,
    region: forcedRegion() ?? regionOf(tour, s.from, s.to, s.kind),
    venue,
    ...(lookDay ? { lookDay } : {}),
  };
}

/** Spielart einer Vorlage: die drei Finale und die Abfahrt (nur Ortsbild) */
type GameKind = FinaleKind | 'descent';

/** Etappe einer Rundfahrt aus dem Plan 2027 als Vorlage (Vorschau eines Schauplatzes) */
function seasonRef(kind: GameKind, tourId: Venue['tourId'], n: number): StageRef | null {
  const t = SEASON_2027.find((x) => x.id === tourId);
  const s = t?.stages.find((x) => x.n === n);
  if (!t || !s) return null;
  return make(kind, t.name, { number: s.n, date: s.date, from: s.from ?? '', to: s.to ?? '', km: s.km, climbs: s.climbs, finale: s.finale, kind: s.kind }, true, s.date);
}

/**
 * Etappe des Tages: am Renntag diese, am Ruhetag die vom Vortag (null außerhalb der Rundfahrt). An solchen Tagen
 * tragen alle Spiele das Ortsbild dieser Etappe.
 */
export function stageOfDay(stages: Stage[] | null | undefined, dayKey: string): Stage | null {
  const key = (iso: string) => berlinDayKey(new Date(iso));
  const list = (stages ?? []).filter((s) => s.starts_at).sort((a, b) => a.number - b.number);
  if (!list.length) return null;
  const first = key(list[0].starts_at);
  const last = key(list[list.length - 1].starts_at);
  if (dayKey < first || dayKey > last) return null;
  let best: Stage | null = null;
  for (const s of list) if (key(s.starts_at) <= dayKey) best = s;
  return best;
}

const fromStage = (st: Stage, key: (iso: string) => string): StageLike => ({
  number: st.number, date: key(st.starts_at), from: st.departure ?? '', to: st.arrival ?? '', km: st.distance_km, climbs: st.climbs, finale: st.info?.finale, kind: st.kind,
});

/**
 * Vorlage für die Abfahrt: nur das Ortsbild (Etappe des Tages oder Vorschau eines Schauplatzes); sonst null –
 * die Abfahrt bleibt dann in den Dolomiten.
 */
export function dayRef(tourName: string | null | undefined, stages: Stage[] | null | undefined, dayKey: string, usePreview = true): StageRef | null {
  const f = usePreview ? forcedVenue() : null;
  if (f) return seasonRef('descent', f.tourId, f.stage);
  const st = stageOfDay(stages, dayKey);
  if (!st || !tourName || !venueOf(tourIdOf(tourName), st.number)) return null;
  return make('descent', tourName, fromStage(st, (iso) => berlinDayKey(new Date(iso))), false);
}

/** Vorlage für das Finale des Tages (null: gar keine Etappendaten vorhanden) */
export function stageRef(kind: FinaleKind, tourName: string | null | undefined, stages: Stage[] | null | undefined, dayKey: string, usePreview = true): StageRef | null {
  const key = (iso: string) => berlinDayKey(new Date(iso));
  // Vorschau eines Schauplatzes (Admins): diese Etappe in allen Spielen (nicht beim Nachrechnen alter Fahrten)
  const f = usePreview ? forcedVenue() : null;
  if (f) return seasonRef(kind, f.tourId, f.stage);
  // Etappentag (auch Ruhetag) einer Rundfahrt mit Schauplätzen: alle Spiele zeigen die Etappe des Tages
  const today = stageOfDay(stages, dayKey);
  if (today && tourName && venueOf(tourIdOf(tourName), today.number)) return make(kind, tourName, fromStage(today, key), false);
  const list = (stages ?? [])
    .filter((s) => fits(kind, s.kind) && s.arrival && (kind !== 'mountain' || (s.climbs?.length ?? 0) > 0))
    .sort((a, b) => a.number - b.number);
  const st = list.find((s) => key(s.starts_at) >= dayKey);
  if (st && tourName) {
    return make(kind, tourName, fromStage(st, key), false);
  }
  // Vorschau: offizieller Plan der Tour de France 2027, jeden Tag ein anderes Finale
  const t = SEASON_2027.find((x) => x.stages.some((s) => fits(kind, s.kind) && s.to));
  if (!t) return null;
  const cand = t.stages.filter((s) => fits(kind, s.kind) && s.to && (kind !== 'mountain' || (s.climbs?.length ?? 0) > 0));
  if (!cand.length) return null;
  const upcoming = cand.filter((s) => s.date >= dayKey);
  const pool = upcoming.length ? upcoming : cand;
  const s = pool[hashStr(`${kind}:${dayKey}`) % pool.length];
  return make(kind, t.name, { number: s.n, date: s.date, from: s.from ?? '', to: s.to ?? '', km: s.km, climbs: s.climbs, finale: s.finale, kind: s.kind }, true);
}

const fmt1 = (x: number) => x.toLocaleString('de-DE', { maximumFractionDigits: 1 });

/** „Montée de Bisanne · 12,4 km mit 8,3 % · 1.723 m“ */
export function climbLine(c: Climb): string {
  const parts = [c.name];
  if (c.len && c.grad) parts.push(`${fmt1(c.len)} km mit ${fmt1(c.grad)} %`);
  if (c.alt) parts.push(`${c.alt.toLocaleString('de-DE')} m`);
  return parts.join(' · ');
}

/** „Tour de France 2027 · 9. Etappe“ */
export function stageLine(ref: StageRef): string {
  return `${ref.tour} · ${ref.stage}. Etappe`;
}

/** „Tour de France 2027“ → „Tour 2027“ */
export function shortTour(name: string): string {
  return name.replace(/^Tour de France/i, 'Tour').replace(/^Giro d'Italia/i, 'Giro').replace(/^La Vuelta/i, 'Vuelta');
}
