// Entscheidet je Etappe, was aus den PCS-Daten übernommen wird. Reine Funktionen ohne Netz und
// Datenbank – dadurch vollständig testbar (plan.test.ts) und im Probelauf nachvollziehbar.
import type { BonusResult, Rider, StageResult, StageStanding } from '../../src/lib/types.ts';
import { parseDuration, type PcsRow, type PcsStage } from './pcs.ts';
import { makeRiderMatcher, makeTeamMatcher } from './match.ts';
import { berlinDate, berlinTime, berlinToDate, fmtWhen, hours, minutes } from './time.ts';

export type SyncMode = 'off' | 'draft' | 'auto';
export type LogLevel = 'info' | 'change' | 'warning' | 'error';
export type StandingCategory = StageStanding['category'];
export type BonusCategory = Exclude<BonusResult['category'], 'combative'>;

export interface SyncTour {
  id: string;
  name: string;
  year: number;
  start_date: string;
  end_date: string;
  sync_mode: SyncMode;
  pcs_slug: string | null;
  bonus_final: boolean;
}

export interface SyncStage {
  id: number;
  tour_id: string;
  number: number;
  starts_at: string;
  kind: string;
  distance_km: number | null;
  departure: string | null;
  arrival: string | null;
  results_published: boolean;
  /** pcs_path: abweichende PCS-Seite; publish_at: feste Uhrzeit (deutsche Zeit, „15:00“) statt der echten Zielankunft –
   *  für Testrunden mit vergangenen Rennen: Ergebnis ist schon endgültig, also auch ohne Stabilitätsprüfung */
  info?: { pcs_path?: string; publish_at?: string } | null;
}

export interface StageSyncRow {
  stage_id: number;
  paused: boolean;
  paused_reason: string | null;
  checked_at: string | null;
  candidate: Candidate | null;
  candidate_at: string | null;
  synced_at: string | null;
  status: string | null;
  source_url: string | null;
  last_error: string | null;
}

export interface Candidate {
  top: (number | null)[];
  out: number[];
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  details?: unknown;
}

type Ranked = { position: number; rider_id: number };

export interface SyncPayload {
  state: {
    checked_at: string;
    status: string;
    source_url?: string;
    candidate?: Candidate | null;
    candidate_at?: string | null;
    last_error?: string | null;
  };
  results?: Ranked[];
  standings?: Partial<Record<StandingCategory, Ranked[]>>;
  out?: number[];
  publish?: boolean;
  stage?: { distance_km?: number; departure?: string; arrival?: string };
  bonus?: Partial<Record<BonusCategory, { position: number; rider_id: number | null; team: string | null }[]>>;
  logs: LogEntry[];
}

export interface SyncOptions {
  /** So lange muss ein gelesenes Ergebnis unverändert bleiben, bevor es übernommen wird */
  stableMinutes: number;
  /** Warten auf Zielankunft und Stabilität überspringen (manueller Lauf „sofort“) */
  force: boolean;
  /** Anteil der Starter, die im Ergebnis stehen müssen (Schutz vor Zwischenständen) */
  completeness: number;
}

export const DEFAULT_OPTIONS: SyncOptions = { stableMinutes: 10, force: false, completeness: 0.8 };

export interface StagePlan {
  payload: SyncPayload;
  /** Was passiert (bzw. im Probelauf passieren würde) – für die Zusammenfassung */
  actions: string[];
  /** neue Fehler (nicht schon zuletzt gemeldet) – lassen den Workflow-Lauf rot werden */
  newErrors: number;
  /** ist die Etappe danach veröffentlicht? */
  published: boolean;
}

const OUT_STATUS = new Set(['DNF', 'DNS', 'OTL', 'DSQ', 'DNQ', 'NR', 'HD', 'AB']);
const SAME = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Postgres (jsonb) sortiert Objektschlüssel um – deshalb Feld für Feld vergleichen */
const sameCandidate = (a: Candidate | null | undefined, b: Candidate) =>
  !!a && Array.isArray(a.top) && Array.isArray(a.out) && SAME(a.top, b.top) && SAME(a.out, b.out);

class Collector {
  readonly logs: LogEntry[] = [];
  readonly actions: string[] = [];
  newErrors = 0;
  private readonly recent: Set<string>;
  constructor(recent: Set<string>) {
    this.recent = recent;
  }

  /** Warnungen und Fehler nur melden, wenn sie nicht schon kürzlich gemeldet wurden */
  log(level: LogLevel, message: string, details?: unknown): boolean {
    if ((level === 'warning' || level === 'error') && this.recent.has(message)) return false;
    this.logs.push(details === undefined ? { level, message } : { level, message, details });
    if (level === 'error') this.newErrors += 1;
    return true;
  }

  act(text: string) {
    this.actions.push(text);
  }
}

const riderLabel = (riders: Rider[], id: number | null) => riders.find((r) => r.id === id)?.name ?? '?';
const podium = (riders: Rider[], ids: (number | null)[]) =>
  ids.slice(0, 3).map((id, i) => `${i + 1}. ${riderLabel(riders, id)}`).join(', ');

function rankedRows(rows: PcsRow[]): PcsRow[] {
  return rows.filter((r) => r.rank !== null && !r.removed).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
}

export interface StartedStageInput {
  now: Date;
  tour: SyncTour;
  stage: SyncStage;
  riders: Rider[];
  /** gespeichertes Ergebnis dieser Etappe */
  results: StageResult[];
  /** gespeicherte Wertungsstände dieser Etappe */
  standings: StageStanding[];
  sync: StageSyncRow | null;
  pcs: PcsStage;
  url: string;
  /** zuletzt gemeldete Warnungen/Fehler dieser Etappe (nicht doppelt melden) */
  recent?: Set<string>;
  options?: Partial<SyncOptions>;
}

/** feste Übernahmezeit aus stage.info.publish_at („15:00“, deutsche Zeit) am Tag der Etappe, sonst null */
export function fixedPublishTime(stage: SyncStage, stageDate = berlinDate(new Date(stage.starts_at))): Date | null {
  const at = stage.info?.publish_at;
  if (typeof at !== 'string' || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(at.trim())) return null;
  return berlinToDate(stageDate, at.trim().padStart(5, '0'));
}

/** Etappe ist gestartet: Ergebnis, Wertungen und Ausstiege übernehmen, sobald sie fertig und stabil sind. */
export function planStartedStage(input: StartedStageInput): StagePlan {
  const { now, tour, stage, riders, pcs } = input;
  const opts = { ...DEFAULT_OPTIONS, ...input.options };
  const c = new Collector(input.recent ?? new Set());
  const n = stage.number;
  const state: SyncPayload['state'] = { checked_at: now.toISOString(), status: '', source_url: input.url, last_error: null };
  const done = (status: string, extra: Partial<SyncPayload> = {}, published = stage.results_published): StagePlan => {
    state.status = status;
    return { payload: { state, ...extra, logs: c.logs }, actions: c.actions, newErrors: c.newErrors, published };
  };

  if (input.sync?.paused) {
    c.act(`pausiert (${input.sync.paused_reason ?? 'von Hand'}) – nichts geändert`);
    return done('pausiert');
  }

  if (pcs.type === 'TTT') {
    c.log('warning', `Etappe ${n}: Mannschaftszeitfahren – das Ergebnis bitte von Hand eintragen.`);
    c.act('Mannschaftszeitfahren – Ergebnis von Hand');
    return done('Mannschaftszeitfahren – Ergebnis von Hand eintragen');
  }

  const classified = rankedRows(pcs.stage);
  if (!classified.length) {
    const start = new Date(stage.starts_at);
    if (now.getTime() - start.getTime() > hours(9) && !stage.results_published) {
      c.log('warning', `Etappe ${n}: Bei procyclingstats.com steht 9 Stunden nach dem Start noch kein Ergebnis.`);
    }
    c.act('noch kein Ergebnis bei PCS');
    return done('wartet auf das Ergebnis');
  }

  const match = makeRiderMatcher(riders);
  const top = classified.slice(0, 10).map((row) => ({ row, rider: match(row) }));
  const outRows = pcs.stage.filter((r) => OUT_STATUS.has(r.status) && !r.removed);
  const outMatched = outRows.map((row) => ({ row, rider: match(row) }));
  const outIds = [...new Set(outMatched.flatMap((o) => (o.rider ? [o.rider.id] : [])))].sort((a, b) => a - b);
  const candidate: Candidate = { top: top.map((t) => t.rider?.id ?? null), out: outIds };

  // Stabilität: dasselbe Ergebnis muss eine Weile unverändert bleiben
  const same = sameCandidate(input.sync?.candidate, candidate);
  const candidateAt = same && input.sync?.candidate_at ? new Date(input.sync.candidate_at) : now;
  state.candidate = candidate;
  state.candidate_at = candidateAt.toISOString();

  const unmatched = top.filter((t) => !t.rider);
  if (unmatched.length) {
    const names = unmatched.map((t) => `${t.row.name}${t.row.bib ? ` (Nr. ${t.row.bib})` : ''}`).join(', ');
    const msg = `Etappe ${n}: ${names} nicht in der Startliste gefunden – Ergebnis wird nicht übernommen. Bitte Startliste prüfen oder das Ergebnis von Hand eintragen.`;
    c.log('error', msg, { unmatched: unmatched.map((t) => ({ rank: t.row.rank, bib: t.row.bib, name: t.row.name, slug: t.row.slug })) });
    state.last_error = msg;
    c.act(`Fahrer fehlt in der Startliste: ${names}`);
    return done('Fahrer fehlt in der Startliste');
  }

  // Vollständigkeit: fast alle Starter müssen im Ergebnis stehen (schützt vor Zwischenständen)
  const active = riders.filter((r) => r.status === 'active').length;
  const alreadyOut = outIds.filter((id) => riders.find((r) => r.id === id)?.status === 'out').length;
  const expected = active + alreadyOut;
  const listed = classified.length + outRows.length;
  if (classified.length < Math.min(10, expected) || listed < opts.completeness * expected) {
    c.act(`Ergebnis unvollständig (${listed} von etwa ${expected} Fahrern)`);
    return done(`Ergebnis unvollständig (${listed} von ${expected})`);
  }

  // Frühestens zur Zielankunft: Start (laut PCS, sonst Tippschluss) + Siegerzeit.
  // PCS nennt die Ortszeit; außerhalb der deutschen Zeitzone liegt die Schätzung bis zu einer Stunde daneben –
  // Vollständigkeit und Stabilitätsprüfung schützen trotzdem.
  const stageDate = berlinDate(new Date(stage.starts_at));
  const start = pcs.startTime ? berlinToDate(stageDate, pcs.startTime) : new Date(stage.starts_at);
  const isTimeTrial = pcs.type === 'ITT' || stage.kind === 'itt';
  const winner = parseDuration(classified[0].time);
  const fixed = fixedPublishTime(stage, stageDate);
  const notBefore = fixed ?? (winner
    ? new Date(start.getTime() + Math.max(winner * 1000, isTimeTrial ? hours(3.5) : 0) + minutes(5))
    : new Date(new Date(stage.starts_at).getTime() + hours(isTimeTrial ? 4 : 2)));
  if (!opts.force && now < notBefore) {
    c.act(`Ergebnis gelesen – Übernahme ${fixed ? 'um' : 'ab etwa'} ${fmtWhen(notBefore, now)} (${fixed ? 'feste Uhrzeit' : 'Zielankunft'})`);
    return done(`wartet auf ${fixed ? 'die feste Uhrzeit' : 'die Zielankunft'} (${fmtWhen(notBefore, now)})`);
  }
  // feste Uhrzeit (vergangenes Rennen): Ergebnis ist endgültig, keine Stabilitätsprüfung nötig
  const stableAt = fixed ? now : new Date(candidateAt.getTime() + minutes(opts.stableMinutes));
  if (!opts.force && now < stableAt) {
    c.act(`Ergebnis gelesen – wird übernommen, wenn es bis ${fmtWhen(stableAt, now)} gleich bleibt`);
    return done(`Ergebnis gelesen, Prüfung bis ${fmtWhen(stableAt, now)}`);
  }

  // Ab hier: vollständig, stabil, nach der Zielankunft
  const results: Ranked[] = candidate.top.map((id, i) => ({ position: i + 1, rider_id: id as number }));
  const saved = [...input.results].sort((a, b) => a.position - b.position).map((r) => ({ position: r.position, rider_id: r.rider_id }));
  const resultsDiffer = !SAME(saved, results);

  const standings: Partial<Record<StandingCategory, Ranked[]>> = {};
  const sources: [StandingCategory, PcsRow[]][] = [['gc', pcs.gc], ['points', pcs.points], ['mountains', pcs.kom], ['youth', pcs.youth]];
  for (const [cat, rows] of sources) {
    const ranked = rankedRows(rows).slice(0, 10);
    if (!ranked.length) continue;
    standings[cat] = ranked.flatMap((row, i) => {
      const r = match(row);
      return r ? [{ position: i + 1, rider_id: r.id }] : [];
    });
  }
  const standingsDiffer = Object.entries(standings).some(([cat, rows]) => {
    const have = input.standings.filter((s) => s.category === cat).sort((a, b) => a.position - b.position)
      .map((s) => ({ position: s.position, rider_id: s.rider_id }));
    return !SAME(have, rows);
  });
  const newOuts = outIds.filter((id) => riders.find((r) => r.id === id)?.status === 'active');
  const outNames = newOuts.map((id) => riderLabel(riders, id)).join(', ');
  const unknownOuts = outMatched.filter((o) => !o.rider).map((o) => o.row.name);
  if (unknownOuts.length) c.log('warning', `Etappe ${n}: Ausgestiegen, aber nicht in der Startliste: ${unknownOuts.join(', ')}`);

  const extra: Partial<SyncPayload> = {};
  const writeAll = () => {
    extra.results = results;
    if (Object.keys(standings).length) extra.standings = standings;
    if (outIds.length) extra.out = outIds;
  };
  const reportOuts = () => {
    if (newOuts.length) {
      c.log('change', `Etappe ${n}: ausgestiegen – ${outNames}`, { riders: newOuts });
      c.act(`Ausstiege: ${outNames}`);
    }
  };

  if (tour.sync_mode === 'auto') {
    if (!stage.results_published || resultsDiffer) {
      writeAll();
      extra.publish = true;
      if (!stage.results_published) {
        c.log('change', `Etappe ${n}: Ergebnis veröffentlicht – ${podium(riders, candidate.top)}`, { results: candidate.top });
        c.act(`Ergebnis veröffentlicht: ${podium(riders, candidate.top)}`);
      } else {
        const before = saved.map((s) => s.rider_id);
        c.log('change', `Etappe ${n}: Ergebnis nachträglich geändert (laut PCS) – jetzt ${podium(riders, candidate.top)}`, { before, after: candidate.top });
        c.act(`Ergebnis geändert: vorher ${podium(riders, before)} → jetzt ${podium(riders, candidate.top)}`);
      }
      reportOuts();
      return done('veröffentlicht', extra, true);
    }
    if (standingsDiffer || newOuts.length) {
      if (standingsDiffer) {
        extra.standings = standings;
        c.act('Wertungsstände aktualisiert');
      }
      if (newOuts.length) extra.out = outIds;
      reportOuts();
      return done('veröffentlicht', extra, true);
    }
    c.act('unverändert');
    return done('veröffentlicht', {}, true);
  }

  // Vorschlagsmodus: eintragen, aber der Admin veröffentlicht
  if (!stage.results_published) {
    if (resultsDiffer || standingsDiffer || newOuts.length) {
      writeAll();
      if (resultsDiffer) {
        c.log('change', `Etappe ${n}: Ergebnis als Vorschlag eingetragen – ${podium(riders, candidate.top)}. Bitte prüfen und veröffentlichen.`, { results: candidate.top });
        c.act(`Vorschlag eingetragen: ${podium(riders, candidate.top)}`);
      }
      reportOuts();
    } else {
      c.act('Vorschlag unverändert – wartet auf Veröffentlichung');
    }
    return done('Vorschlag eingetragen – bitte veröffentlichen', extra, false);
  }
  if (resultsDiffer) {
    c.log('warning', `Etappe ${n}: procyclingstats.com meldet inzwischen ein anderes Ergebnis (${podium(riders, candidate.top)}) als veröffentlicht. Bitte prüfen.`);
    c.act(`PCS weicht vom veröffentlichten Ergebnis ab: ${podium(riders, candidate.top)}`);
  }
  if (standingsDiffer) {
    extra.standings = standings;
    c.act('Wertungsstände aktualisiert');
  }
  if (newOuts.length) extra.out = outIds;
  reportOuts();
  return done(resultsDiffer ? 'veröffentlicht – PCS weicht ab' : 'veröffentlicht', extra, true);
}

export interface UpcomingStageInput {
  now: Date;
  tour: SyncTour;
  stage: SyncStage;
  pcs: PcsStage;
  url: string;
  recent?: Set<string>;
}

/** Etappe steht noch bevor: Streckenänderungen übernehmen, Start- und Datumsabweichungen melden. */
export function planUpcomingStage(input: UpcomingStageInput): StagePlan {
  const { now, tour, stage, pcs } = input;
  const c = new Collector(input.recent ?? new Set());
  const n = stage.number;
  const change: NonNullable<SyncPayload['stage']> = {};

  if (pcs.distanceKm !== null) {
    if (stage.distance_km === null) {
      change.distance_km = pcs.distanceKm;
      c.log('info', `Etappe ${n}: Distanz ${pcs.distanceKm} km von PCS übernommen`);
    } else if (Math.abs(pcs.distanceKm - stage.distance_km) >= 2) {
      change.distance_km = pcs.distanceKm;
      c.log('change', `Etappe ${n}: Distanz laut PCS jetzt ${pcs.distanceKm} km (vorher ${stage.distance_km} km)`, { before: stage.distance_km, after: pcs.distanceKm });
    }
    if (change.distance_km !== undefined) c.act(`Distanz → ${pcs.distanceKm} km`);
  }
  if (!stage.departure && pcs.departure) change.departure = pcs.departure;
  if (!stage.arrival && pcs.arrival) change.arrival = pcs.arrival;
  if (change.departure || change.arrival) c.act(`Start/Ziel ergänzt: ${change.departure ?? stage.departure ?? '?'} → ${change.arrival ?? stage.arrival ?? '?'}`);

  // Datum und Startzeit nur vergleichen, wenn das PCS-Datum in den Zeitraum der Rundfahrt fällt
  // (bei einer Generalprobe mit einer früheren Austragung nicht)
  const starts = new Date(stage.starts_at);
  const shift = (date: string, days: number) => {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  if (pcs.date && pcs.date >= shift(tour.start_date, -7) && pcs.date <= shift(tour.end_date, 7)) {
    const dbDate = berlinDate(starts);
    const dbClock = berlinTime(starts);
    if (pcs.date !== dbDate) {
      c.log('warning', `Etappe ${n}: laut PCS am ${pcs.date}, in gruppetto am ${dbDate} – bitte Datum und Tippschluss prüfen.`);
      c.act(`Datum weicht ab: PCS ${pcs.date}, gruppetto ${dbDate}`);
    } else if (pcs.startTime && pcs.startTime < dbClock) {
      c.log('warning', `Etappe ${n}: Start laut PCS schon um ${pcs.startTime} Uhr, Tippschluss ist ${dbClock} Uhr – Tipps wären nach dem Start noch möglich. Tippschluss vorziehen?`);
      c.act(`Start ${pcs.startTime} vor dem Tippschluss ${dbClock}`);
    }
  }

  const payload: SyncPayload = {
    state: { checked_at: now.toISOString(), status: Object.keys(change).length ? 'Etappendaten aktualisiert' : 'Etappendaten geprüft', source_url: input.url },
    logs: c.logs,
  };
  if (Object.keys(change).length) payload.stage = change;
  if (!c.actions.length) c.act('keine Änderung');
  return { payload, actions: c.actions, newErrors: c.newErrors, published: stage.results_published };
}

export interface BonusInput {
  tour: SyncTour;
  stageNumber: number;
  riders: Rider[];
  current: BonusResult[];
  pcs: PcsStage;
  recent?: Set<string>;
}

/** Zwischenstand der Bonuswertungen (Platz 1–3) aus den Wertungen nach der Etappe. */
export function planBonus(input: BonusInput): { bonus: SyncPayload['bonus']; logs: LogEntry[]; actions: string[] } {
  const { tour, riders, pcs } = input;
  const c = new Collector(input.recent ?? new Set());
  if (tour.bonus_final) return { bonus: undefined, logs: [], actions: [] };
  const match = makeRiderMatcher(riders);
  const matchTeam = makeTeamMatcher(riders.map((r) => r.team));
  const excluded = new Set(riders.filter((r) => r.excluded_from_rest).map((r) => r.id));
  const bonus: NonNullable<SyncPayload['bonus']> = {};

  const riderTop3 = (cat: BonusCategory, rows: PcsRow[], filter?: (id: number) => boolean) => {
    const ranked = rankedRows(rows);
    if (!ranked.length) return;
    const ids: number[] = [];
    for (const row of ranked) {
      const r = match(row);
      if (!r) {
        if (!filter) {
          c.log('warning', `Bonuswertung ${cat}: ${row.name} nicht in der Startliste – Zwischenstand nicht aktualisiert.`);
          return;
        }
        continue;
      }
      if (filter && !filter(r.id)) continue;
      ids.push(r.id);
      if (ids.length === 3) break;
    }
    if (ids.length) bonus[cat] = ids.map((id, i) => ({ position: i + 1, rider_id: id, team: null }));
  };
  riderTop3('gc', pcs.gc);
  riderTop3('rest', pcs.gc, (id) => !excluded.has(id));
  riderTop3('points', pcs.points);
  riderTop3('mountains', pcs.kom);
  riderTop3('youth', pcs.youth);

  const teams = pcs.teams.filter((t) => t.rank !== null).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)).slice(0, 3);
  if (teams.length) {
    const names = teams.map((t) => matchTeam(t.team));
    if (names.every((x): x is string => !!x) && new Set(names).size === names.length) {
      bonus.team = names.map((team, i) => ({ position: i + 1, rider_id: null, team }));
    } else {
      c.log('warning', `Bonuswertung Team: ${teams.filter((_, i) => !names[i]).map((t) => t.team).join(', ')} nicht zugeordnet – Zwischenstand nicht aktualisiert.`);
    }
  }

  // Nur geänderte Wertungen schreiben
  for (const cat of Object.keys(bonus) as BonusCategory[]) {
    const have = input.current.filter((b) => b.category === cat).sort((a, b) => a.position - b.position)
      .map((b) => ({ position: b.position, rider_id: b.rider_id ?? null, team: b.team ?? null }));
    if (SAME(have, bonus[cat])) delete bonus[cat];
  }
  const changed = Object.keys(bonus);
  if (changed.length) c.act(`Bonus-Zwischenstand nach Etappe ${input.stageNumber}: ${changed.join(', ')}`);
  return { bonus: changed.length ? bonus : undefined, logs: c.logs, actions: c.actions };
}
