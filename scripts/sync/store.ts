// Zugriff auf die Datenbank für den Sync: lesen über PostgREST, schreiben nur über
// die Funktion sync_apply_stage (eine Transaktion je Etappe). Braucht den Secret Key.
import type { BonusResult, Rider, StageResult, StageStanding } from '../../src/lib/types.ts';
import type { LogEntry, StageSyncRow, SyncPayload, SyncStage, SyncTour } from './plan.ts';

export interface RecentLog {
  stage_id: number | null;
  level: string;
  message: string;
  at: string;
}

export interface TourState {
  stages: SyncStage[];
  riders: Rider[];
  results: StageResult[];
  standings: StageStanding[];
  bonus: BonusResult[];
  sync: StageSyncRow[];
  recentLogs: RecentLog[];
}

export interface ApplyResult {
  applied: string[];
  skipped: string[];
  paused: boolean;
}

export interface SyncStore {
  listTours(filter: { tourId?: string }): Promise<SyncTour[]>;
  loadTourState(tour: SyncTour, since: Date): Promise<TourState>;
  applyStage(stageId: number, payload: SyncPayload): Promise<ApplyResult>;
  logTour(tourId: string, entry: LogEntry): Promise<void>;
}

export class SupabaseStore implements SyncStore {
  private readonly url: string;
  private readonly key: string;

  constructor(url: string, key: string) {
    this.url = url.replace(/\/+$/, '');
    this.key = key;
  }

  private async req<T>(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<T> {
    const headers: Record<string, string> = { apikey: this.key, 'Content-Type': 'application/json' };
    // Alte JWT-Schlüssel (service_role) brauchen zusätzlich den Bearer-Header, neue sb_secret_-Schlüssel nicht
    if (this.key.startsWith('eyJ')) headers.Authorization = `Bearer ${this.key}`;
    if (init.prefer) headers.Prefer = init.prefer;
    const res = await fetch(`${this.url}/rest/v1/${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json() as { message?: string; hint?: string };
        detail = [body.message, body.hint].filter(Boolean).join(' – ');
      } catch {
        /* kein JSON */
      }
      if (res.status === 404 && /stage_sync|sync_apply_stage|sync_mode|sync_log/.test(detail + path)) {
        detail += ' – Ist supabase/schema.sql in der aktuellen Version eingespielt?';
      }
      if (res.status === 401 || res.status === 403) detail += ' – Stimmt SUPABASE_SECRET_KEY?';
      throw new Error(`Supabase ${init.method ?? 'GET'} ${path.split('?')[0]}: HTTP ${res.status} ${detail}`.trim());
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async listTours(filter: { tourId?: string }): Promise<SyncTour[]> {
    const where = filter.tourId ? `id=eq.${encodeURIComponent(filter.tourId)}` : 'sync_mode=neq.off';
    return this.req<SyncTour[]>(`tours?select=id,name,year,start_date,end_date,sync_mode,pcs_slug,bonus_final&${where}&order=start_date.asc`);
  }

  async loadTourState(tour: SyncTour, since: Date): Promise<TourState> {
    const t = encodeURIComponent(tour.id);
    const [stages, riders, bonus, recentLogs] = await Promise.all([
      this.req<SyncStage[]>(`stages?tour_id=eq.${t}&select=id,tour_id,number,starts_at,kind,distance_km,departure,arrival,results_published,info&order=number.asc`),
      this.req<Rider[]>(`riders?tour_id=eq.${t}&select=*`),
      this.req<BonusResult[]>(`bonus_results?tour_id=eq.${t}&select=tour_id,category,position,rider_id,team`),
      this.req<RecentLog[]>(`sync_log?tour_id=eq.${t}&at=gte.${encodeURIComponent(since.toISOString())}&level=in.(warning,error)&select=stage_id,level,message,at`),
    ]);
    let results: StageResult[] = [];
    let standings: StageStanding[] = [];
    let sync: StageSyncRow[] = [];
    if (stages.length) {
      const ids = stages.map((s) => s.id).join(',');
      [results, standings, sync] = await Promise.all([
        this.req<StageResult[]>(`stage_results?stage_id=in.(${ids})&select=*`),
        this.req<StageStanding[]>(`stage_standings?stage_id=in.(${ids})&select=*`),
        this.req<StageSyncRow[]>(`stage_sync?stage_id=in.(${ids})&select=*`),
      ]);
    }
    return {
      stages: stages.map((s) => ({ ...s, distance_km: s.distance_km === null ? null : Number(s.distance_km) })),
      riders,
      results,
      standings,
      bonus,
      sync,
      recentLogs,
    };
  }

  applyStage(stageId: number, payload: SyncPayload): Promise<ApplyResult> {
    return this.req<ApplyResult>('rpc/sync_apply_stage', { method: 'POST', body: { p_stage: stageId, p: payload } });
  }

  async logTour(tourId: string, entry: LogEntry): Promise<void> {
    await this.req('sync_log', {
      method: 'POST',
      body: { tour_id: tourId, level: entry.level, message: entry.message, details: entry.details ?? null },
      prefer: 'return=minimal',
    });
  }
}
