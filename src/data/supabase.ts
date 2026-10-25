import type {
  AdminUser, BonusCategory, BonusResult, BonusTip, PointScale, Profile, Rider, Stage, StageResult, StageStanding, StageTip,
  Tour, TourData,
} from '../lib/types';
import {
  ApiError, type BonusResultInput, type DataSource, type RiderInput, type RiderPatch, type SessionUser,
  type StageInput, type TourInput,
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
