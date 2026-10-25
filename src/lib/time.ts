import type { Stage, StageKind, Tour } from './types';

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

const pad = (n: number) => String(n).padStart(2, '0');

export function fmtDay(iso: string | Date): string {
  const d = new Date(iso);
  return `${WEEKDAYS[d.getDay()]}\u00a0${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
}

export function fmtTime(iso: string | Date): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** „12:15 Uhr“ mit geschütztem Leerzeichen */
export function fmtClock(iso: string | Date): string {
  return `${fmtTime(iso)}\u00a0Uhr`;
}

export function fmtDayTime(iso: string | Date): string {
  return `${fmtDay(iso)}, ${fmtTime(iso)}\u00a0Uhr`;
}

/** 'YYYY-MM-DD' → '8. Mai' */
const MONTHS = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
export function fmtDateShort(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d}. ${MONTHS[m - 1]}`;
}

export function fmtRange(start: string, end: string): string {
  const [, sm] = start.split('-').map(Number);
  const [, em, ed] = end.split('-').map(Number);
  const sd = Number(start.split('-')[2]);
  if (sm === em) return `${sd}.–${ed}. ${MONTHS[em - 1]}`;
  return `${fmtDateShort(start)} – ${fmtDateShort(end)}`;
}

/** Restzeit als kurzer Text: „2 Std 14 Min“, „3 Tage“, „12 Min“. */
export function fmtDuration(ms: number): string {
  if (ms <= 0) return '0 Min';
  const min = Math.floor(ms / 60000);
  const days = Math.floor(min / 1440);
  const hours = Math.floor((min % 1440) / 60);
  const mins = min % 60;
  // geschützte Leerzeichen: Zahl und Einheit bleiben zusammen
  if (days >= 2) return `${days}\u00a0Tage`;
  if (days === 1) return hours > 0 ? `1\u00a0Tag ${hours}\u00a0Std` : '1\u00a0Tag';
  if (hours > 0) return mins > 0 ? `${hours}\u00a0Std ${mins}\u00a0Min` : `${hours}\u00a0Std`;
  return `${Math.max(1, mins)}\u00a0Min`;
}

export const KIND_LABEL: Record<StageKind, string> = {
  flat: 'Flach',
  hilly: 'Hügelig',
  mountain: 'Berg',
  itt: 'Einzelzeitfahren',
  ttt: 'Teamzeitfahren',
};

export const KIND_SHORT: Record<StageKind, string> = {
  flat: 'Flach',
  hilly: 'Hügelig',
  mountain: 'Berg',
  itt: 'Zeitfahren',
  ttt: 'Teamzeitfahren',
};

export type StageState = 'open' | 'running' | 'done';

export function stageState(stage: Stage, now: number): StageState {
  if (stage.results_published) return 'done';
  return new Date(stage.starts_at).getTime() > now ? 'open' : 'running';
}

export function sortStages(stages: Stage[]): Stage[] {
  return [...stages].sort((a, b) => a.number - b.number);
}

/** Nächste noch tippbare Etappe. */
export function nextOpenStage(stages: Stage[], now: number): Stage | null {
  return sortStages(stages).find((s) => new Date(s.starts_at).getTime() > now) ?? null;
}

/** Gestartete, aber noch nicht ausgewertete Etappen. */
export function runningStages(stages: Stage[], now: number): Stage[] {
  return sortStages(stages).filter((s) => stageState(s, now) === 'running');
}

export function lastPublishedStage(stages: Stage[]): Stage | null {
  const done = sortStages(stages).filter((s) => s.results_published);
  return done[done.length - 1] ?? null;
}

/** Tippschluss der Bonustipps: Start Etappe 1, sonst erster Tag 12:00 Uhr. */
export function bonusDeadline(tour: Tour, stages: Stage[]): Date {
  const first = stages.find((s) => s.number === 1);
  if (first) return new Date(first.starts_at);
  return new Date(`${tour.start_date}T12:00:00`);
}

export type TourPhase = 'upcoming' | 'running' | 'finished';

export function tourPhase(tour: Tour, stages: Stage[], now: number): TourPhase {
  if (now < bonusDeadline(tour, stages).getTime()) return 'upcoming';
  const all = sortStages(stages);
  const last = all[all.length - 1];
  if (last && last.results_published) return 'finished';
  const endOfTour = new Date(`${tour.end_date}T23:59:59`).getTime();
  if (!last && now > endOfTour) return 'finished';
  return 'running';
}

/** Standard-Rundfahrt: laufende oder nächste, sonst die zuletzt beendete. */
export function defaultTour(tours: Tour[], now: number): Tour | null {
  const visible = tours.filter((t) => t.is_visible).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const today = new Date(now);
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  return visible.find((t) => t.end_date >= todayStr) ?? visible[visible.length - 1] ?? null;
}

/** Ganze Kalendertage zwischen zwei Daten (lokale Zeit). */
export function dayDiff(a: string | Date, b: string | Date): number {
  const da = new Date(a);
  const db = new Date(b);
  const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((ub - ua) / 86400000);
}

/** Datum + Uhrzeit im lokalen Format für <input type="datetime-local">. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function weekdayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

/** „172 km“ / „13,6 km“ mit geschütztem Leerzeichen */
export function fmtKm(km: number | null | undefined): string {
  if (km === null || km === undefined) return '';
  return `${String(km).replace('.', ',')} km`;
}
