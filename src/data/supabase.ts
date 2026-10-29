import type { ProfilePoint, StageProfileData } from '../lib/gpx';
import type { GameGhostRow, TtGhostRow } from '../game/tt';
import type {
  AdminUser, BonusCategory, BonusResult, BonusTip, PointScale, Profile, Rider, Stage, StageResult, StageStanding, StageTip,
  Tour, TourData, StageSyncInfo, SyncLogEntry, SyncMode, SyncStatus,
} from '../lib/types';
import {
  ApiError, type BonusResultInput, type DataSource, type RiderInput, type RiderPatch, type SessionUser,
  type StageInput, type TourInput, type GameId, type GameBest, type GameRun,
} from './source';

interface StoredSession {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Sekunden seit 1970
  user: SessionUser;
}

const STORAGE_KEY = 'gruppetto.session';

function readStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function writeStored(s: StoredSession | null) {
  try {
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* privater Modus: Sitzung bleibt nur im Speicher */
  }
}

interface AuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  user: { id: string; email?: string };
}

/** Schlanker Supabase-Client über die REST-Schnittstellen (Auth + PostgREST), ohne Zusatzpakete. */
export class SupabaseSource implements DataSource {
  readonly mode = 'live' as const;
  private session: StoredSession | null = readStored();
  private refreshing: Promise<void> | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly url: string, private readonly key: string) {
    this.url = url.replace(/\/+$/, '');
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) {
        this.session = readStored();
        this.emit();
      }
    });
  }

  now(): number {
    return Date.now();
  }

  // ---------- Anmeldung ----------

  currentUser(): SessionUser | null {
    return this.session?.user ?? null;
  }

  onAuthChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit() {
    this.listeners.forEach((cb) => cb());
  }

  private setSession(s: StoredSession | null) {
    this.session = s;
    writeStored(s);
    this.emit();
  }

  private fromAuth(r: AuthResponse): StoredSession {
    return {
      access_token: r.access_token,
      refresh_token: r.refresh_token,
      expires_at: r.expires_at ?? Math.floor(Date.now() / 1000) + r.expires_in,
      user: { id: r.user.id, email: r.user.email ?? '' },
    };
  }

  private async authFetch<T>(path: string, body: unknown, token?: string): Promise<T> {
    const res = await fetch(`${this.url}/auth/v1/${path}`, {
      method: 'POST',
      headers: {
        apikey: this.key,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await toError(res);
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  async sendCode(email: string): Promise<void> {
    await this.authFetch('otp', { email: email.trim().toLowerCase(), create_user: true });
  }

  async verifyCode(email: string, code: string): Promise<void> {
    const r = await this.authFetch<AuthResponse>('verify', {
      type: 'email',
      email: email.trim().toLowerCase(),
      token: code.trim(),
    });
    this.setSession(this.fromAuth(r));
  }

  async signOut(): Promise<void> {
    const token = this.session?.access_token;
    this.setSession(null);
    if (token) {
      try {
        await this.authFetch('logout', {}, token);
      } catch {
        /* lokal abgemeldet reicht */
      }
    }
  }

  private async refresh(): Promise<void> {
    if (!this.session) return;
    if (!this.refreshing) {
      const refreshToken = this.session.refresh_token;
      this.refreshing = this.authFetch<AuthResponse>('token?grant_type=refresh_token', { refresh_token: refreshToken })
        .then((r) => this.setSession(this.fromAuth(r)))
        .catch((err) => {
          if (err instanceof ApiError && err.status && err.status >= 400 && err.status < 500) {
            this.setSession(null);
          }
          throw err;
        })
        .finally(() => {
          this.refreshing = null;
        });
    }
    await this.refreshing;
  }

  private async token(): Promise<string | null> {
    if (!this.session) return null;
    if (this.session.expires_at - 60 <= Date.now() / 1000) await this.refresh();
    return this.session?.access_token ?? null;
  }

  // ---------- REST ----------

  private async rest<T>(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<T> {
    const token = await this.token();
    const doFetch = (tok: string | null) =>
      fetch(`${this.url}/rest/v1/${path}`, {
        method: init.method ?? 'GET',
        headers: {
          apikey: this.key,
          'Content-Type': 'application/json',
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
          ...(init.prefer ? { Prefer: init.prefer } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    let res = await doFetch(token);
    if (res.status === 401 && this.session) {
      await this.refresh();
      res = await doFetch(this.session?.access_token ?? null);
    }
    if (!res.ok) throw await toError(res);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  private rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.rest<T>(`rpc/${fn}`, { method: 'POST', body: args });
  }

  // ---------- Lesen ----------

  async loadMe(): Promise<Profile | null> {
    const user = this.currentUser();
    if (!user) return null;
    const rows = await this.rest<Profile[]>(`profiles?id=eq.${user.id}&select=*`);
    return rows[0] ?? null;
  }

  loadMembers(): Promise<Profile[]> {
    return this.rest<Profile[]>('profiles?select=*&is_member=eq.true&order=display_name.asc');
  }

  loadTours(): Promise<Tour[]> {
    return this.rest<Tour[]>('tours?select=*&order=start_date.asc');
  }

  async loadTourData(tour: Tour): Promise<TourData> {
    const t = encodeURIComponent(tour.id);
    const [stages, riders, bonusTips, bonusResults, scale] = await Promise.all([
      this.rest<Stage[]>(`stages?tour_id=eq.${t}&select=*&order=number.asc`),
      this.rest<Rider[]>(`riders?tour_id=eq.${t}&select=*&order=bib.asc.nullslast,name.asc`),
      this.rest<BonusTip[]>(`bonus_tips?tour_id=eq.${t}&select=tour_id,user_id,category,rider_id,team`),
      this.rest<BonusResult[]>(`bonus_results?tour_id=eq.${t}&select=tour_id,category,position,rider_id,team&order=category.asc,position.asc`),
      this.rest<PointScale[]>('stage_point_scale?select=*&order=position.asc'),
    ]);
    let tips: StageTip[] = [];
    let results: StageResult[] = [];
    let standings: StageStanding[] = [];
    if (stages.length) {
      const ids = stages.map((s) => s.id).join(',');
      [tips, results, standings] = await Promise.all([
        this.rest<StageTip[]>(`stage_tips?stage_id=in.(${ids})&select=stage_id,user_id,rider_id,updated_at`),
        this.rest<StageResult[]>(`stage_results?stage_id=in.(${ids})&select=*&order=position.asc`),
        // ältere Datenbank ohne Tabelle: einfach ohne Wertungsstände weiter
        this.rest<StageStanding[]>(`stage_standings?stage_id=in.(${ids})&select=*&order=position.asc`).catch(() => []),
      ]);
    }
    return {
      tour,
      stages: stages.map((s) => ({ ...s, distance_km: s.distance_km === null ? null : Number(s.distance_km) })),
      riders,
      tips,
      results,
      bonusTips,
      bonusResults,
      scale,
      standings,
    };
  }

  async loadStageProfile(stageId: number): Promise<StageProfileData | null> {
    try {
      const rows = await this.rest<StageProfileData[]>(`stage_profiles?stage_id=eq.${stageId}&select=points,waypoints,source`);
      return rows[0] ?? null;
    } catch {
      try {
        // ältere Datenbank ohne Spalte „waypoints“
        const rows = await this.rest<StageProfileData[]>(`stage_profiles?stage_id=eq.${stageId}&select=points`);
        return rows[0] ?? null;
      } catch {
        return null;
      }
    }
  }

  async saveStageProfile(stageId: number, points: ProfilePoint[] | null, source?: string): Promise<void> {
    if (!points) {
      await this.rest(`stage_profiles?stage_id=eq.${stageId}`, { method: 'DELETE' });
      return;
    }
    await this.rest('stage_profiles?on_conflict=stage_id', {
      method: 'POST',
      body: { stage_id: stageId, points, source: source ?? null, updated_at: new Date().toISOString() },
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  async loadProfilesFor(stageIds: number[]): Promise<Record<number, ProfilePoint[]>> {
    if (!stageIds.length) return {};
    try {
      const rows = await this.rest<{ stage_id: number; points: ProfilePoint[] }[]>(`stage_profiles?stage_id=in.(${stageIds.join(',')})&select=stage_id,points`);
      return Object.fromEntries(rows.map((r) => [r.stage_id, r.points]));
    } catch {
      return {};
    }
  }

  async listStageProfiles(stageIds: number[]): Promise<number[]> {
    if (!stageIds.length) return [];
    try {
      const rows = await this.rest<{ stage_id: number }[]>(`stage_profiles?stage_id=in.(${stageIds.join(',')})&select=stage_id`);
      return rows.map((r) => r.stage_id);
    } catch {
      return [];
    }
  }

  async submitScore(game: GameId, score: number, meters?: number): Promise<void> {
    const body: Record<string, unknown> = { game, score: Math.round(score) };
    if (meters !== undefined) body.meters = Math.max(0, Math.round(meters));
    await this.rest('game_scores', { method: 'POST', body, prefer: 'return=minimal' });
  }

  async myRuns(since: string): Promise<GameRun[]> {
    const rows = await this.rest<{ game: GameId; meters: number | null; created_at: string }[]>(
      `game_scores?user_id=eq.${this.me()}&created_at=gte.${encodeURIComponent(since)}&select=game,meters,created_at&order=created_at.asc&limit=2000`,
    );
    return rows.map((r) => ({ game: r.game, meters: r.meters ?? 0, created_at: r.created_at }));
  }

  async gameLeaderboard(game: GameId, since?: string): Promise<GameBest[]> {
    const rows = await this.rpc<GameBest[]>('game_leaderboard', since ? { p_game: game, p_since: since } : { p_game: game });
    return rows.map((r) => ({ ...r, best_m: Number(r.best_m ?? 0), total_m: Number(r.total_m ?? 0), runs: Number(r.runs) }));
  }

  async ttGhosts(day: string): Promise<TtGhostRow[]> {
    // je Mitglied der letzte Geist (heute oder davor) – eine Zeile je Mitglied; ohne die Sicht (ältere Datenbank) nur heute
    const sel = 'select=user_id,day,time_ms,bike,splits,trace,created_at';
    const rows = await this.rest<TtGhostRow[]>(`tt_ghosts_latest?day=lte.${encodeURIComponent(day)}&${sel}&order=day.desc,time_ms.asc&limit=80`)
      .catch(() => this.rest<TtGhostRow[]>(`tt_ghosts?day=eq.${encodeURIComponent(day)}&${sel}&order=time_ms.asc&limit=60`));
    return rows.map((r) => ({ ...r, splits: Array.isArray(r.splits) ? r.splits.map(Number) : [], trace: Array.isArray(r.trace) ? r.trace : [] }));
  }

  async saveTtGhost(g: Omit<TtGhostRow, 'user_id' | 'created_at'>): Promise<void> {
    // ein Eintrag je Mitglied und Tag; ist die gespeicherte Fahrt schneller, behält die Datenbank sie (Trigger)
    await this.rest('tt_ghosts?on_conflict=user_id,day', {
      method: 'POST',
      body: { user_id: this.me(), day: g.day, time_ms: Math.round(g.time_ms), bike: g.bike, splits: g.splits.map((x) => Math.round(x)), trace: g.trace, created_at: new Date().toISOString() },
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  async gameGhosts(game: GameGhostRow['game']): Promise<GameGhostRow[]> {
    const rows = await this.rest<GameGhostRow[]>(`game_ghosts_latest?game=eq.${game}&select=user_id,game,day,score,meters,bike,trace,created_at&order=day.desc,score.desc&limit=80`);
    return rows.map((r) => ({ ...r, score: Number(r.score), meters: Number(r.meters), trace: Array.isArray(r.trace) ? r.trace : [] }));
  }

  async saveGameGhost(g: Omit<GameGhostRow, 'user_id' | 'created_at'>): Promise<void> {
    // ein Eintrag je Mitglied, Spiel und Tag; hat der gespeicherte Lauf mehr Punkte, behält die Datenbank ihn (Trigger)
    await this.rest('game_ghosts?on_conflict=user_id,game,day', {
      method: 'POST',
      body: { user_id: this.me(), game: g.game, day: g.day, score: Math.max(0, Math.round(g.score)), meters: Math.max(0, Math.round(g.meters)), bike: g.bike, trace: g.trace, created_at: new Date().toISOString() },
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  async listFavorites(): Promise<number[]> {
    try {
      const rows = await this.rest<{ cyclist_id: number }[]>('favorite_cyclists?select=cyclist_id');
      return rows.map((r) => r.cyclist_id);
    } catch {
      return [];
    }
  }

  async setFavorite(cyclistId: number, on: boolean): Promise<void> {
    if (on) {
      await this.rest('favorite_cyclists?on_conflict=user_id,cyclist_id', {
        method: 'POST',
        body: { cyclist_id: cyclistId },
        prefer: 'resolution=ignore-duplicates,return=minimal',
      });
    } else {
      await this.rest(`favorite_cyclists?cyclist_id=eq.${cyclistId}`, { method: 'DELETE' });
    }
  }

  stageTippers(stageId: number): Promise<string[]> {
    return this.rpc<string[]>('stage_tippers', { p_stage: stageId });
  }

  // ---------- Spieler ----------

  async joinGroup(code: string, name: string): Promise<void> {
    await this.rpc('join_group', { p_code: code, p_name: name });
  }

  async updateProfile(name: string, color: string): Promise<void> {
    await this.rpc('update_my_profile', { p_name: name, p_color: color });
  }

  async requestPro(request: boolean): Promise<void> {
    await this.rpc('request_pro', { p_request: request });
  }

  async deleteAccount(): Promise<void> {
    await this.rpc('delete_my_account');
    this.setSession(null);
  }

  private me(): string {
    const u = this.currentUser();
    if (!u) throw new ApiError('not_authenticated');
    return u.id;
  }

  async saveStageTip(stageId: number, riderId: number): Promise<void> {
    await this.rest('stage_tips?on_conflict=stage_id,user_id', {
      method: 'POST',
      body: { stage_id: stageId, user_id: this.me(), rider_id: riderId },
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  async deleteStageTip(stageId: number): Promise<void> {
    await this.rest(`stage_tips?stage_id=eq.${stageId}&user_id=eq.${this.me()}`, { method: 'DELETE' });
  }

  async saveBonusTip(tourId: string, category: BonusCategory, riderId: number | null, team: string | null): Promise<void> {
    await this.rest('bonus_tips?on_conflict=tour_id,user_id,category', {
      method: 'POST',
      body: { tour_id: tourId, user_id: this.me(), category, rider_id: riderId, team },
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  async deleteBonusTip(tourId: string, category: BonusCategory): Promise<void> {
    await this.rest(
      `bonus_tips?tour_id=eq.${encodeURIComponent(tourId)}&category=eq.${category}&user_id=eq.${this.me()}`,
      { method: 'DELETE' },
    );
  }

  // ---------- Admin ----------

  adminListUsers(): Promise<AdminUser[]> {
    return this.rpc<AdminUser[]>('admin_list_users');
  }

  async adminSetFlags(userId: string, member: boolean, admin: boolean, pro: boolean): Promise<void> {
    await this.rpc('admin_set_flags', { p_user: userId, p_member: member, p_admin: admin, p_pro: pro });
  }

  async getInviteCode(): Promise<string> {
    const rows = await this.rest<{ value: string }[]>('app_settings?key=eq.invite_code&select=value');
    return rows[0]?.value ?? '';
  }

  async setInviteCode(code: string): Promise<void> {
    await this.rest('app_settings?on_conflict=key', {
      method: 'POST',
      body: { key: 'invite_code', value: code.trim().toUpperCase() },
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  async saveTour(tour: TourInput): Promise<void> {
    await this.rest('tours?on_conflict=id', {
      method: 'POST',
      body: tour,
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  async deleteTour(id: string): Promise<void> {
    await this.rest(`tours?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async saveStages(tourId: string, stages: StageInput[]): Promise<void> {
    if (!stages.length) return;
    await this.rest('stages?on_conflict=tour_id,number', {
      method: 'POST',
      body: stages.map((s) => ({ ...s, tour_id: tourId })),
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  async updateStage(id: number, patch: Partial<StageInput>): Promise<void> {
    await this.rest(`stages?id=eq.${id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
  }

  async deleteStage(id: number): Promise<void> {
    await this.rest(`stages?id=eq.${id}`, { method: 'DELETE' });
  }

  async importRiders(tourId: string, riders: RiderInput[]): Promise<void> {
    if (!riders.length) return;
    await this.rest('riders?on_conflict=tour_id,name', {
      method: 'POST',
      body: riders.map((r) => ({ ...r, tour_id: tourId })),
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  async updateRider(id: number, patch: RiderPatch): Promise<void> {
    await this.rest(`riders?id=eq.${id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
  }

  async deleteRider(id: number): Promise<void> {
    await this.rest(`riders?id=eq.${id}`, { method: 'DELETE' });
  }

  async setStageResults(stageId: number, riderIds: number[]): Promise<void> {
    await this.rest(`stage_results?stage_id=eq.${stageId}`, { method: 'DELETE' });
    if (riderIds.length) {
      await this.rest('stage_results', {
        method: 'POST',
        body: riderIds.map((rider_id, i) => ({ stage_id: stageId, position: i + 1, rider_id })),
        prefer: 'return=minimal',
      });
    }
  }

  async setStagePublished(stageId: number, published: boolean): Promise<void> {
    await this.rest(`stages?id=eq.${stageId}`, {
      method: 'PATCH',
      body: { results_published: published },
      prefer: 'return=minimal',
    });
  }

  async setBonusResults(tourId: string, category: BonusResult['category'], entries: BonusResultInput[]): Promise<void> {
    await this.rest(`bonus_results?tour_id=eq.${encodeURIComponent(tourId)}&category=eq.${category}`, { method: 'DELETE' });
    if (entries.length) {
      await this.rest('bonus_results', {
        method: 'POST',
        body: entries.map((e) => ({ ...e, tour_id: tourId, category })),
        prefer: 'return=minimal',
      });
    }
  }

  // ---------- Automatische Ergebnisse ----------

  async loadSyncStatus(tourId: string, stageIds: number[]): Promise<SyncStatus> {
    return schemaCheck(async () => {
      const [stages, log] = await Promise.all([
        stageIds.length
          ? this.rest<StageSyncInfo[]>(`stage_sync?stage_id=in.(${stageIds.join(',')})&select=stage_id,paused,paused_reason,checked_at,synced_at,status,source_url,last_error`)
          : Promise.resolve([]),
        this.rest<SyncLogEntry[]>(`sync_log?tour_id=eq.${encodeURIComponent(tourId)}&select=id,at,stage_id,level,message&order=at.desc,id.desc&limit=40`),
      ]);
      return { stages, log };
    });
  }

  async setSyncMode(tourId: string, mode: SyncMode): Promise<void> {
    await schemaCheck(() => this.rest(`tours?id=eq.${encodeURIComponent(tourId)}`, { method: 'PATCH', body: { sync_mode: mode }, prefer: 'return=minimal' }));
  }

  async loadWorldEdits(key: string): Promise<unknown | null> {
    const rows = await this.rest<{ data: unknown }[]>(`world_edits?key=eq.${encodeURIComponent(key)}&select=data`);
    return rows[0]?.data ?? null;
  }

  async saveWorldEdits(key: string, data: unknown | null): Promise<void> {
    if (data === null) {
      await this.rest(`world_edits?key=eq.${encodeURIComponent(key)}`, { method: 'DELETE' });
      return;
    }
    await this.rest('world_edits?on_conflict=key', {
      method: 'POST',
      body: { key, data, updated_by: this.currentUser()?.id ?? null, updated_at: new Date().toISOString() },
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  async listWorldEdits(): Promise<{ key: string; updated_at: string }[]> {
    try {
      return await this.rest<{ key: string; updated_at: string }[]>('world_edits?select=key,updated_at&order=updated_at.desc');
    } catch {
      return [];
    }
  }

  async setStageSyncPaused(stageId: number, paused: boolean): Promise<void> {
    await schemaCheck(() => this.rpc('admin_set_stage_sync_paused', { p_stage: stageId, p_paused: paused }));
  }
}

/** Fehlende Tabelle/Spalte/Funktion = schema.sql noch nicht neu eingespielt */
async function schemaCheck<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError && (['PGRST205', 'PGRST204', 'PGRST202', '42P01', '42703'].includes(err.code ?? '') || err.status === 404)) {
      throw new ApiError('schema_outdated', 'schema_outdated', err.status);
    }
    throw err;
  }
}

async function toError(res: Response): Promise<ApiError> {
  let message = `HTTP ${res.status}`;
  let code: string | undefined;
  try {
    const body = await res.json();
    message = body.message ?? body.msg ?? body.error_description ?? body.error ?? message;
    code = body.code ?? body.error_code;
    if (typeof code === 'number') code = String(code);
  } catch {
    /* kein JSON */
  }
  return new ApiError(String(message), code, res.status);
}
