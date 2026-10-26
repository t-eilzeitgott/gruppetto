// Hilfen für die Tests: Startliste aus einer PCS-Seite und eine Datenbank im Speicher,
// die sync_apply_stage nachbildet (die echte Funktion testet supabase/tests/sync_test.sql).
import { readFileSync } from 'node:fs';
import type { BonusResult, Rider } from '../../src/lib/types.ts';
import { parseStagePage, type PcsStage } from './pcs.ts';
import type { LogEntry, StageSyncRow, SyncPayload, SyncStage, SyncTour } from './plan.ts';
import type { ApplyResult, SyncStore, TourState } from './store.ts';

export const fixtureHtml = (name: string) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf8');
export const fixture = (name: string): PcsStage => parseStagePage(fixtureHtml(name));

/** Alle Fahrer, die auf der Seite vorkommen, als Startliste (IDs ab 1, Reihenfolge des Auftretens). */
export function ridersFrom(st: PcsStage, tourId = 't'): Rider[] {
  const seen = new Map<string, Rider>();
  for (const row of [...st.stage, ...st.gc, ...st.points, ...st.kom, ...st.youth]) {
    const key = row.slug ?? row.name;
    if (seen.has(key)) continue;
    seen.set(key, {
      id: seen.size + 1, tour_id: tourId, bib: row.bib, name: row.name, team: row.team ?? 'Unbekannt',
      tip_limit: null, excluded_from_rest: false, status: 'active',
    });
  }
  return [...seen.values()];
}

export const tour = (patch: Partial<SyncTour> = {}): SyncTour => ({
  id: 't', name: 'Testtour', year: 2018, start_date: '2018-07-07', end_date: '2018-07-29',
  sync_mode: 'auto', pcs_slug: 'tour-de-france/2018', bonus_final: false, ...patch,
});

export const stage = (patch: Partial<SyncStage> = {}): SyncStage => ({
  id: 19, tour_id: 't', number: 19, starts_at: '2018-07-27T10:00:00Z', kind: 'mountain',
  distance_km: 200.5, departure: 'Lourdes', arrival: 'Laruns', results_published: false, info: {}, ...patch,
});

/** wie jsonb in Postgres: Schlüssel nach Länge, dann alphabetisch sortiert */
function jsonb<T>(value: T): T {
  if (Array.isArray(value)) return value.map(jsonb) as T;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(keys.map((k) => [k, jsonb((value as Record<string, unknown>)[k])])) as T;
  }
  return value;
}

export interface MemoryDb extends TourState {
  tour: SyncTour;
  logs: (LogEntry & { stage_id: number | null; at: string })[];
  applied: { stageId: number; payload: SyncPayload }[];
}

export class MemoryStore implements SyncStore {
  readonly db: MemoryDb;
  constructor(db: MemoryDb) {
    this.db = db;
  }

  async listTours(filter: { tourId?: string }): Promise<SyncTour[]> {
    const t = this.db.tour;
    if (filter.tourId) return filter.tourId === t.id ? [t] : [];
    return t.sync_mode === 'off' ? [] : [t];
  }

  async loadTourState(_tour: SyncTour, since: Date): Promise<TourState> {
    const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
    return {
      ...clone({ stages: this.db.stages, riders: this.db.riders, results: this.db.results, standings: this.db.standings, bonus: this.db.bonus, sync: this.db.sync }),
      recentLogs: this.db.logs.filter((l) => new Date(l.at) >= since && (l.level === 'warning' || l.level === 'error'))
        .map((l) => ({ stage_id: l.stage_id, level: l.level, message: l.message, at: l.at })),
    };
  }

  async applyStage(stageId: number, p: SyncPayload): Promise<ApplyResult> {
    const db = this.db;
    this.db.applied.push({ stageId, payload: JSON.parse(JSON.stringify(p)) });
    let sync = db.sync.find((s) => s.stage_id === stageId);
    if (!sync) {
      sync = { stage_id: stageId, paused: false, paused_reason: null, checked_at: null, candidate: null, candidate_at: null, synced_at: null, status: null, source_url: null, last_error: null } as StageSyncRow;
      db.sync.push(sync);
    }
    const st = db.stages.find((s) => s.id === stageId)!;
    const applied: string[] = [];
    const skipped: string[] = [];
    if (p.results || p.standings || p.out || p.publish) {
      if (sync.paused) skipped.push('results');
      else {
        if (p.results) {
          db.results = db.results.filter((r) => r.stage_id !== stageId).concat(p.results.map((r) => ({ stage_id: stageId, ...r })));
          applied.push('results');
        }
        if (p.standings) {
          for (const [cat, rows] of Object.entries(p.standings)) {
            db.standings = db.standings.filter((s) => !(s.stage_id === stageId && s.category === cat))
              .concat(rows!.map((r) => ({ stage_id: stageId, category: cat as never, ...r })));
          }
          applied.push('standings');
        }
        if (p.out) {
          for (const r of db.riders) if (p.out.includes(r.id)) r.status = 'out';
          applied.push('out');
        }
        if (p.publish) {
          if (new Date(st.starts_at) > new Date()) throw new Error('stage_not_started');
          st.results_published = true;
          applied.push('publish');
        }
      }
    }
    if (p.stage) {
      Object.assign(st, Object.fromEntries(Object.entries(p.stage).filter(([, v]) => v !== undefined)));
      applied.push('stage');
    }
    if (p.bonus) {
      if (db.tour.bonus_final) skipped.push('bonus');
      else {
        for (const [cat, rows] of Object.entries(p.bonus)) {
          db.bonus = db.bonus.filter((b) => b.category !== cat)
            .concat(rows!.map((r) => ({ tour_id: db.tour.id, category: cat as BonusResult['category'], ...r })));
        }
        applied.push('bonus');
      }
    }
    Object.assign(sync, {
      checked_at: p.state.checked_at,
      ...(p.state.candidate !== undefined ? { candidate: jsonb(p.state.candidate) } : {}),
      ...(p.state.candidate_at !== undefined ? { candidate_at: p.state.candidate_at } : {}),
      ...(applied.includes('results') || applied.includes('publish') ? { synced_at: p.state.checked_at } : {}),
      status: sync.paused ? 'pausiert' : p.state.status,
      ...(p.state.last_error !== undefined ? { last_error: p.state.last_error } : {}),
    });
    for (const l of p.logs) db.logs.push({ ...l, stage_id: stageId, at: p.state.checked_at });
    return { applied, skipped, paused: sync.paused };
  }

  async logTour(_tourId: string, entry: LogEntry): Promise<void> {
    this.db.logs.push({ ...entry, stage_id: null, at: new Date().toISOString() });
  }
}

export function memoryDb(t: SyncTour, stages: SyncStage[], riders: Rider[]): MemoryDb {
  return { tour: t, stages, riders, results: [], standings: [], bonus: [], sync: [], recentLogs: [], logs: [], applied: [] };
}
