/**
 * Echte Vorlagen für Sprint- und Bergfinale: Etappe, Zielort, Schlussanstieg (Name, Gipfelhöhe,
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

export type FinaleKind = 'sprint' | 'mountain';

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
  /** Landschaft nach der Gegend der Etappe */
  region: Region;
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

const fits = (kind: FinaleKind, k: StageKind) => (kind === 'sprint' ? k === 'flat' || k === 'hilly' : k === 'mountain');
const clean = (s: string) => s.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

function lastClimb(climbs: Climb[] | undefined): Climb | null {
  const list = (climbs ?? []).filter((c) => c.name);
  if (!list.length) return null;
  return [...list].sort((a, b) => a.km - b.km)[list.length - 1];
}

function make(kind: FinaleKind, tour: string, s: { number: number; date: string; from: string; to: string; km: number | null; climbs?: Climb[]; finale?: string | null; kind?: StageKind }, preview: boolean): StageRef {
  const climb = kind === 'mountain' ? lastClimb(s.climbs) : null;
  const town = clean(s.to) || s.to;
  return {
    lang: langOf(tour, `${s.from} ${s.to}`),
    tour,
    stage: s.number,
    date: s.date,
    from: clean(s.from),
    to: s.to,
    town,
    climb,
    summitFinish: !!climb && s.km !== null && s.km - climb.km < 1.5,
    preview,
    finale: kind === 'sprint' ? parseFinale(s.finale) : null,
    region: forcedRegion() ?? regionOf(tour, s.from, s.to, s.kind),
  };
}

/** Vorlage für das Finale des Tages (null: gar keine Etappendaten vorhanden) */
export function stageRef(kind: FinaleKind, tourName: string | null | undefined, stages: Stage[] | null | undefined, dayKey: string): StageRef | null {
  const key = (iso: string) => berlinDayKey(new Date(iso));
  const list = (stages ?? [])
    .filter((s) => fits(kind, s.kind) && s.arrival && (kind === 'sprint' || (s.climbs?.length ?? 0) > 0))
    .sort((a, b) => a.number - b.number);
  const st = list.find((s) => key(s.starts_at) >= dayKey);
  if (st && tourName) {
    return make(kind, tourName, { number: st.number, date: key(st.starts_at), from: st.departure ?? '', to: st.arrival ?? '', km: st.distance_km, climbs: st.climbs, finale: st.info?.finale, kind: st.kind }, false);
  }
  // Vorschau: offizieller Plan der Tour de France 2027, jeden Tag ein anderes Finale
  const t = SEASON_2027.find((x) => x.stages.some((s) => fits(kind, s.kind) && s.to));
  if (!t) return null;
  const cand = t.stages.filter((s) => fits(kind, s.kind) && s.to && (kind === 'sprint' || (s.climbs?.length ?? 0) > 0));
  if (!cand.length) return null;
  const upcoming = cand.filter((s) => s.date >= dayKey);
  const pool = upcoming.length ? upcoming : cand;
  const s = pool[hashStr(`${kind}:${dayKey}`) % pool.length];
  return make(kind, t.name, { number: s.n, date: s.date, from: s.from ?? '', to: s.to ?? '', km: s.km, climbs: s.climbs, kind: s.kind }, true);
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
