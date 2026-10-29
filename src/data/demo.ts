import type { ProfilePoint, StageProfileData } from '../lib/gpx';
import type {
  AdminUser, BonusCategory, BonusResult, BonusTip, Profile, Rider, Stage, StageResult, StageTip, Tour, TourData,
  SyncLogEntry, SyncMode, SyncStatus, StageSyncInfo,
} from '../lib/types';
import { DEFAULT_SCALE, tipLimit } from '../lib/scoring';
import { bonusDeadline } from '../lib/time';
import { ttScore, type GameGhostRow, type TtGhostRow } from '../game/tt';
import { berlinDayKey, hashStr } from '../game/abfahrt/rng';
import {
  ApiError, type BonusResultInput, type DataSource, type RiderInput, type RiderPatch, type SessionUser,
  type StageInput, type TourInput, type GameId, type GameBest, type GameRun,
} from './source';
import {
  DEMO_BONUS_RESULTS, DEMO_BONUS_TIPS, DEMO_ME, DEMO_NOW, DEMO_PROFILES, DEMO_RESULTS, DEMO_RIDERS, DEMO_STAGES,
  DEMO_STANDINGS, DEMO_TIPS, DEMO_TOURS, DEMO_REAL_PROFILES,
} from './demoData';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));

/** Demo-Modus: alle Daten im Speicher, gleiche Regeln wie in der Datenbank. */
/** Demo-Zeitfahrer: Stärke, Linie */
const DEMO_TT: [string, number, number][] = [['u-felix', 1.03, 0.9], ['u-julian', 1.0, 0.7], ['u-lena', 0.99, 0.95], ['u-tobi', 0.96, 0.5], ['u-anna', 0.94, 0.8], ['u-ben', 0.91, 0.3], ['u-me-demo', 0.97, 0.75]];
/** wer in der Demo heute schon gefahren ist */
const DEMO_TT_TODAY = ['u-felix', 'u-lena', 'u-ben'];
const shiftDay = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export class DemoSource implements DataSource {
  readonly mode = 'demo' as const;
  private readonly started = Date.now();
  private readonly base: number;
  private listeners = new Set<() => void>();
  private signedIn: boolean;
  private tours: Tour[] = clone(DEMO_TOURS);
  private stages: Stage[] = clone(DEMO_STAGES);
  private riders: Rider[] = clone(DEMO_RIDERS);
  private tips: StageTip[] = clone(DEMO_TIPS);
  private results: StageResult[] = clone(DEMO_RESULTS);
  private bonusTips: BonusTip[] = clone(DEMO_BONUS_TIPS);
  private bonusResults: BonusResult[] = clone(DEMO_BONUS_RESULTS);
  private profiles: Profile[] = clone(DEMO_PROFILES);
  private inviteCode = 'GIRO27';
  private nextId = 50000;
  /** Automatik: von Hand pausierte Etappen (wie der Trigger in der Datenbank) und eigene Protokolleinträge */
  private syncPaused = new Map<number, string>();
  private syncLog: SyncLogEntry[] = [];

  constructor(start: 'app' | 'login' | 'join' = 'app', baseTime?: number) {
    this.base = baseTime ?? DEMO_NOW;
    this.signedIn = start !== 'login';
    for (const t of this.tours) t.sync_mode = t.sync_mode ?? 'auto';
    if (start !== 'app') {
      const me = this.profiles.find((p) => p.id === DEMO_ME)!;
      me.is_member = false;
      me.display_name = null;
    }
  }

  now(): number {
    return this.base + (Date.now() - this.started);
  }

  currentUser(): SessionUser | null {
    return this.signedIn ? { id: DEMO_ME, email: 'christoph@beispiel.de' } : null;
  }

  onAuthChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit() {
    this.listeners.forEach((cb) => cb());
  }

  async sendCode(email: string): Promise<void> {
    await wait(400);
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new ApiError('Bitte gib eine gültige E-Mail-Adresse ein.');
  }

  async verifyCode(_email: string, code: string): Promise<void> {
    await wait(400);
    if (code.trim() !== '123456') throw new ApiError('otp_expired', 'otp_expired', 403);
    this.signedIn = true;
    this.emit();
  }

  async signOut(): Promise<void> {
    this.signedIn = false;
    this.emit();
  }

  // ---------- Lesen ----------

  async loadMe(): Promise<Profile | null> {
    await wait();
    return this.signedIn ? clone(this.profiles.find((p) => p.id === DEMO_ME) ?? null) : null;
  }

  async loadMembers(): Promise<Profile[]> {
    await wait();
    return clone(this.profiles.filter((p) => p.is_member));
  }

  async loadTours(): Promise<Tour[]> {
    await wait();
    return clone([...this.tours].sort((a, b) => a.start_date.localeCompare(b.start_date)));
  }

  async loadTourData(tour: Tour): Promise<TourData> {
    await wait(180);
    const now = this.now();
    const stages = this.stages.filter((s) => s.tour_id === tour.id).sort((a, b) => a.number - b.number);
    const ids = new Set(stages.map((s) => s.id));
    const started = new Set(stages.filter((s) => new Date(s.starts_at).getTime() <= now).map((s) => s.id));
    const published = new Set(stages.filter((s) => s.results_published).map((s) => s.id));
    const t = this.tours.find((x) => x.id === tour.id) ?? tour;
    const bonusOpen = now < bonusDeadline(t, stages).getTime();
    return clone({
      tour: t,
      stages,
      riders: this.riders.filter((r) => r.tour_id === tour.id)
        .sort((a, b) => (a.bib ?? 9999) - (b.bib ?? 9999) || a.name.localeCompare(b.name)),
      tips: this.tips.filter((x) => ids.has(x.stage_id) && (x.user_id === DEMO_ME || started.has(x.stage_id))),
      results: this.results.filter((r) => published.has(r.stage_id)).sort((a, b) => a.position - b.position),
      bonusTips: this.bonusTips.filter((b) => b.tour_id === tour.id && (b.user_id === DEMO_ME || !bonusOpen)),
      bonusResults: this.bonusResults.filter((b) => b.tour_id === tour.id),
      scale: DEFAULT_SCALE,
      standings: DEMO_STANDINGS.filter((x) => published.has(x.stage_id)),
    });
  }

  private heightProfiles = new Map<number, ProfilePoint[]>();

  // Welt-Editor: im Demo-Modus nur im Browser gespeichert
  async loadWorldEdits(key: string): Promise<unknown | null> {
    try { const t = localStorage.getItem(`gruppetto.world.${key}`); return t ? JSON.parse(t) : null; } catch { return null; }
  }

  async saveWorldEdits(key: string, data: unknown | null): Promise<void> {
    try {
      if (data === null) localStorage.removeItem(`gruppetto.world.${key}`);
      else localStorage.setItem(`gruppetto.world.${key}`, JSON.stringify(data));
    } catch { /* egal */ }
  }

  async listWorldEdits(): Promise<{ key: string; updated_at: string }[]> {
    const out: { key: string; updated_at: string }[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) ?? '';
        if (k.startsWith('gruppetto.world.')) out.push({ key: k.slice(16), updated_at: '' });
      }
    } catch { /* egal */ }
    return out;
  }

  async loadStageProfile(stageId: number): Promise<StageProfileData | null> {
    await wait(80);
    if (this.heightProfiles.has(stageId)) return { points: this.heightProfiles.get(stageId)! };
    if (DEMO_REAL_PROFILES[stageId]) return DEMO_REAL_PROFILES[stageId];
    const stage = this.stages.find((s) => s.id === stageId);
    const points = stage ? demoProfile(stage) : null;
    if (!points || !stage) return null;
    // Beispiel-Durchfahrtsorte: Start, jede Bergwertung, Ziel
    const waypoints = [
      { km: 0, alt: points[0][1], name: (stage.departure ?? 'Start').toUpperCase() },
      ...(stage.climbs ?? []).map((c) => ({ km: c.km, alt: points.find((p) => p[0] >= c.km)?.[1] ?? 0, name: c.name })),
      { km: stage.distance_km ?? 0, alt: points[points.length - 1][1], name: (stage.arrival ?? 'Ziel').toUpperCase() },
    ];
    return { points, waypoints, source: 'Demo' };
  }

  async saveStageProfile(stageId: number, points: ProfilePoint[] | null): Promise<void> {
    await wait();
    if (points) this.heightProfiles.set(stageId, points); else this.heightProfiles.delete(stageId);
  }

  async loadProfilesFor(stageIds: number[]): Promise<Record<number, ProfilePoint[]>> {
    await wait(80);
    const out: Record<number, ProfilePoint[]> = {};
    for (const id of stageIds) {
      const st = this.stages.find((s) => s.id === id);
      const pts = this.heightProfiles.get(id) ?? DEMO_REAL_PROFILES[id]?.points ?? (st ? demoProfile(st) : null);
      if (pts) out[id] = pts;
    }
    return out;
  }

  async listStageProfiles(stageIds: number[]): Promise<number[]> {
    await wait(60);
    return stageIds.filter((id) => this.heightProfiles.has(id) || !!DEMO_REAL_PROFILES[id] || !!demoProfile(this.stages.find((s) => s.id === id)!));
  }

  private scores: { user_id: string; game: GameId; score: number; meters: number; at: string }[] = [
    ['u-felix', 14210, 3480, 2], ['u-julian', 11885, 2950, 30], ['u-lena', 9630, 2610, 5], ['u-christoph', 7410, 2080, 50],
    ['u-tobi', 6190, 1760, 70], ['u-anna', 4860, 1320, 3], ['u-ben', 2540, 860, 90], ['u-felix', 9800, 2400, 1], ['u-julian', 7300, 2010, 1],
    [DEMO_ME, 5120, 2210, 6], [DEMO_ME, 8450, 4120, 29], [DEMO_ME, 3310, 1400, 52],
  ].map(([user_id, score, meters, h]) => ({
    user_id: user_id as string, game: 'abfahrt' as GameId, score: score as number, meters: meters as number,
    at: new Date(Date.now() - (h as number) * 3600e3).toISOString(),
  })).concat([
    ['u-julian', 1480, 1], ['u-lena', 1210, 2], ['u-felix', 960, 26], ['u-tobi', 720, 4],
  ].map(([user_id, score, h]) => ({
    user_id: user_id as string, game: 'sprint' as GameId, score: score as number, meters: 2400,
    at: new Date(Date.now() - (h as number) * 3600e3).toISOString(),
  }))).concat([
    ['u-lena', 1420, 3], ['u-ben', 1180, 2], ['u-julian', 760, 30], [DEMO_ME, 640, 28],
  ].map(([user_id, score, h]) => ({
    user_id: user_id as string, game: 'berg' as GameId, score: score as number, meters: 2000,
    at: new Date(Date.now() - (h as number) * 3600e3).toISOString(),
  })));

  async submitScore(game: GameId, score: number, meters = 0): Promise<void> {
    await wait(80);
    this.scores.push({ user_id: DEMO_ME, game, score: Math.round(score), meters: Math.round(meters), at: new Date().toISOString() });
  }

  // Zeitfahren: Geister der Demo-Runde werden je Tag einmal durchgerechnet (Tempomacher-Simulation mit
  // verschiedener Stärke und Linienwahl); ihre Zeiten stehen danach auch in der Bestenliste
  private ttDays = new Map<string, TtGhostRow[]>();
  private myGhost = new Map<string, TtGhostRow>();

  /**
   * Demo-Geister eines Tages. who: nur diese Mitglieder (heute fahren drei, die übrigen zeigen ihren letzten Lauf
   * von einem Tag davor – wie in der echten Runde)
   */
  private async ttDemo(day: string, who?: string[]): Promise<TtGhostRow[]> {
    const key = `${day}:${who?.join(',') ?? '*'}`;
    let rows = this.ttDays.get(key);
    if (rows) return rows;
    const { simulateGhost } = await import('../game/abfahrt/zeitfahren');
    const bikes = ['aero', 'acciaio', 'zeit', 'feder', 'titan', 'pave', 'allround'];
    const people = DEMO_TT.filter(([id]) => !who || who.includes(id));
    const noon = new Date(`${day}T11:00:00Z`).getTime();
    const today = day === berlinDayKey();
    rows = people.map(([id, strength, line]) => {
      const i = DEMO_TT.findIndex(([x]) => x === id);
      const g = simulateGhost(day, { strength, line, seed: hashStr(`${id}:${day}`) });
      return { user_id: id, day, time_ms: g.timeMs, bike: bikes[i % bikes.length], splits: g.splits, trace: g.trace, created_at: new Date(today ? Date.now() - (i + 1) * 1700e3 : noon + i * 1700e3).toISOString() };
    }).filter((g) => g.time_ms > 0);
    this.ttDays.set(key, rows);
    for (const g of rows) if (g.user_id !== 'u-me-demo') this.scores.push({ user_id: g.user_id, game: 'zeitfahren', score: ttScore(g.time_ms), meters: 3000, at: g.created_at });
    return rows;
  }

  async ttGhosts(day: string): Promise<TtGhostRow[]> {
    // heute drei Mitglieder, die übrigen mit ihrer letzten Fahrt (gestern bzw. vor ein paar Tagen)
    const rows = [...await this.ttDemo(day, DEMO_TT_TODAY)];
    for (const [k, [id]] of DEMO_TT.entries()) {
      if (DEMO_TT_TODAY.includes(id) || id === 'u-me-demo') continue;
      rows.push(...await this.ttDemo(shiftDay(day, -1 - (k % 3)), [id]));
    }
    // eigener Geist: heute der Bestlauf, sonst der letzte (in der Demo: vorgestern)
    const mine = [...this.myGhost.values()].filter((g) => g.day <= day).sort((a, b) => (a.day < b.day ? 1 : -1) || a.time_ms - b.time_ms)[0]
      ?? (await this.ttDemo(shiftDay(day, -2), ['u-me-demo'])).map((g) => ({ ...g, user_id: DEMO_ME }))[0];
    return [...rows, ...(mine ? [mine] : [])].sort((a, b) => a.time_ms - b.time_ms);
  }

  private gameGhostStore = new Map<string, GameGhostRow>();

  async gameGhosts(game: GameGhostRow['game']): Promise<GameGhostRow[]> {
    await wait(60);
    // nur eigene Läufe (die Demo hat keine Fahrspuren der anderen): je Spiel der letzte
    const mine = [...this.gameGhostStore.values()].filter((g) => g.game === game).sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.score - a.score));
    return mine.slice(0, 1);
  }

  async saveGameGhost(g: Omit<GameGhostRow, 'user_id' | 'created_at'>): Promise<void> {
    await wait(60);
    const key = `${g.game}:${g.day}`;
    const prev = this.gameGhostStore.get(key);
    if (prev && prev.score >= g.score) return;
    this.gameGhostStore.set(key, { ...g, user_id: DEMO_ME, created_at: new Date().toISOString() });
  }

  async saveTtGhost(g: Omit<TtGhostRow, 'user_id' | 'created_at'>): Promise<void> {
    await wait(60);
    const prev = this.myGhost.get(g.day);
    if (prev && prev.time_ms <= g.time_ms) return;
    this.myGhost.set(g.day, { ...g, user_id: DEMO_ME, created_at: new Date().toISOString() });
  }

  async myRuns(since: string): Promise<GameRun[]> {
    await wait(60);
    return this.scores.filter((x) => x.user_id === DEMO_ME && x.at >= since).map((x) => ({ game: x.game, meters: x.meters, created_at: x.at }));
  }

  async gameLeaderboard(game: GameId, since?: string): Promise<GameBest[]> {
    await wait(80);
    if (game === 'zeitfahren') await this.ttDemo(berlinDayKey(), DEMO_TT_TODAY);
    const by = new Map<string, GameBest>();
    for (const s of this.scores.filter((x) => x.game === game && (!since || x.at >= since))) {
      const b = by.get(s.user_id);
      if (!b) by.set(s.user_id, { user_id: s.user_id, best: s.score, best_m: s.meters, runs: 1, total_m: s.meters, last_at: s.at });
      else {
        b.best = Math.max(b.best, s.score);
        b.best_m = Math.max(b.best_m, s.meters);
        b.runs += 1;
        b.total_m += s.meters;
        if (s.at > b.last_at) b.last_at = s.at;
      }
    }
    return [...by.values()].sort((a, b) => b.best - a.best);
  }

  private favorites = new Set<number>([1, 44]);

  async listFavorites(): Promise<number[]> {
    await wait(60);
    return [...this.favorites];
  }

  async setFavorite(cyclistId: number, on: boolean): Promise<void> {
    await wait(60);
    if (on) this.favorites.add(cyclistId);
    else this.favorites.delete(cyclistId);
  }

  async stageTippers(stageId: number): Promise<string[]> {
    await wait();
    return this.tips.filter((t) => t.stage_id === stageId).map((t) => t.user_id);
  }

  // ---------- Spieler ----------

  async joinGroup(code: string, name: string): Promise<void> {
    await wait(300);
    if (code.trim().toUpperCase() !== this.inviteCode) throw new ApiError('invalid_code');
    this.checkName(name);
    const me = this.profiles.find((p) => p.id === DEMO_ME)!;
    me.display_name = name.trim();
    me.is_member = true;
  }

  private checkName(name: string) {
    const n = name.trim();
    if (n.length < 2 || n.length > 20) throw new ApiError('invalid_name');
    if (this.profiles.some((p) => p.id !== DEMO_ME && p.display_name?.toLowerCase() === n.toLowerCase())) {
      throw new ApiError('name_taken');
    }
  }

  async updateProfile(name: string, color: string): Promise<void> {
    await wait();
    this.checkName(name);
    const me = this.profiles.find((p) => p.id === DEMO_ME)!;
    me.display_name = name.trim();
    me.avatar_color = color;
  }

  async requestPro(request: boolean): Promise<void> {
    await wait();
    const me = this.profiles.find((p) => p.id === DEMO_ME)!;
    me.pro_requested_at = request ? me.pro_requested_at ?? new Date(this.now()).toISOString() : null;
  }

  async deleteAccount(): Promise<void> {
    await wait();
    throw new ApiError('Im Demo-Modus kann kein Konto gelöscht werden.');
  }

  async saveStageTip(stageId: number, riderId: number): Promise<void> {
    await wait();
    const stage = this.stages.find((s) => s.id === stageId)!;
    if (new Date(stage.starts_at).getTime() <= this.now()) throw new ApiError('new row violates row-level security policy');
    const rider = this.riders.find((r) => r.id === riderId)!;
    if (rider.tour_id !== stage.tour_id) throw new ApiError('rider_not_in_tour');
    if (rider.status !== 'active') throw new ApiError('rider_not_active');
    const tour = this.tours.find((t) => t.id === stage.tour_id)!;
    const limit = tipLimit(tour, rider);
    if (limit !== null) {
      const tourStages = new Set(this.stages.filter((s) => s.tour_id === stage.tour_id).map((s) => s.id));
      const used = this.tips.filter((t) => t.user_id === DEMO_ME && t.rider_id === riderId && t.stage_id !== stageId && tourStages.has(t.stage_id)).length;
      if (used >= limit) throw new ApiError('joker_limit_reached');
    }
    this.tips = this.tips.filter((t) => !(t.stage_id === stageId && t.user_id === DEMO_ME));
    this.tips.push({ stage_id: stageId, user_id: DEMO_ME, rider_id: riderId, updated_at: new Date(this.now()).toISOString() });
  }

  async deleteStageTip(stageId: number): Promise<void> {
    await wait();
    this.tips = this.tips.filter((t) => !(t.stage_id === stageId && t.user_id === DEMO_ME));
  }

  async saveBonusTip(tourId: string, category: BonusCategory, riderId: number | null, team: string | null): Promise<void> {
    await wait();
    const tour = this.tours.find((t) => t.id === tourId)!;
    const stages = this.stages.filter((s) => s.tour_id === tourId);
    if (this.now() >= bonusDeadline(tour, stages).getTime()) throw new ApiError('new row violates row-level security policy');
    this.bonusTips = this.bonusTips.filter((b) => !(b.tour_id === tourId && b.user_id === DEMO_ME && b.category === category));
    this.bonusTips.push({ tour_id: tourId, user_id: DEMO_ME, category, rider_id: riderId, team });
  }

  async deleteBonusTip(tourId: string, category: BonusCategory): Promise<void> {
    await wait();
    this.bonusTips = this.bonusTips.filter((b) => !(b.tour_id === tourId && b.user_id === DEMO_ME && b.category === category));
  }

  // ---------- Admin ----------

  async adminListUsers(): Promise<AdminUser[]> {
    await wait();
    return clone(this.profiles.map((p) => ({ ...p, email: `${p.id.slice(2)}@beispiel.de` })));
  }

  async adminSetFlags(userId: string, member: boolean, admin: boolean, pro: boolean): Promise<void> {
    await wait();
    if (userId === DEMO_ME && !admin) throw new ApiError('cannot_remove_own_admin');
    const p = this.profiles.find((x) => x.id === userId)!;
    Object.assign(p, { is_member: member, is_admin: admin, is_pro: pro });
  }

  async getInviteCode(): Promise<string> {
    await wait();
    return this.inviteCode;
  }

  async setInviteCode(code: string): Promise<void> {
    await wait();
    this.inviteCode = code.trim().toUpperCase();
  }

  async saveTour(tour: TourInput): Promise<void> {
    await wait();
    this.tours = this.tours.filter((t) => t.id !== tour.id);
    this.tours.push({ ...tour });
  }

  async deleteTour(id: string): Promise<void> {
    await wait();
    const stageIds = new Set(this.stages.filter((s) => s.tour_id === id).map((s) => s.id));
    this.tours = this.tours.filter((t) => t.id !== id);
    this.stages = this.stages.filter((s) => s.tour_id !== id);
    this.riders = this.riders.filter((r) => r.tour_id !== id);
    this.tips = this.tips.filter((t) => !stageIds.has(t.stage_id));
    this.results = this.results.filter((r) => !stageIds.has(r.stage_id));
    this.bonusTips = this.bonusTips.filter((b) => b.tour_id !== id);
    this.bonusResults = this.bonusResults.filter((b) => b.tour_id !== id);
  }

  async saveStages(tourId: string, stages: StageInput[]): Promise<void> {
    await wait();
    for (const s of stages) {
      const existing = this.stages.find((x) => x.tour_id === tourId && x.number === s.number);
      if (existing) Object.assign(existing, s);
      else this.stages.push({ ...s, id: this.nextId++, tour_id: tourId, results_published: false });
    }
  }

  async updateStage(id: number, patch: Partial<StageInput>): Promise<void> {
    await wait();
    Object.assign(this.stages.find((s) => s.id === id)!, patch);
  }

  async deleteStage(id: number): Promise<void> {
    await wait();
    this.stages = this.stages.filter((s) => s.id !== id);
    this.tips = this.tips.filter((t) => t.stage_id !== id);
    this.results = this.results.filter((r) => r.stage_id !== id);
  }

  async importRiders(tourId: string, riders: RiderInput[]): Promise<void> {
    await wait();
    for (const r of riders) {
      const existing = this.riders.find((x) => x.tour_id === tourId && x.name === r.name);
      if (existing) Object.assign(existing, r);
      else this.riders.push({ ...r, id: this.nextId++, tour_id: tourId, tip_limit: null, excluded_from_rest: false, status: 'active' });
    }
  }

  async updateRider(id: number, patch: RiderPatch): Promise<void> {
    await wait();
    Object.assign(this.riders.find((r) => r.id === id)!, patch);
  }

  async deleteRider(id: number): Promise<void> {
    await wait();
    this.riders = this.riders.filter((r) => r.id !== id);
  }

  async setStageResults(stageId: number, riderIds: number[]): Promise<void> {
    await wait();
    this.results = this.results.filter((r) => r.stage_id !== stageId);
    riderIds.forEach((rider_id, i) => this.results.push({ stage_id: stageId, position: i + 1, rider_id }));
    this.pauseSync(stageId, 'Ergebnis von Hand geändert');
  }

  async setStagePublished(stageId: number, published: boolean): Promise<void> {
    await wait();
    const stage = this.stages.find((s) => s.id === stageId)!;
    if (published && new Date(stage.starts_at).getTime() > this.now()) throw new ApiError('stage_not_started');
    if (stage.results_published && !published) this.pauseSync(stageId, 'Veröffentlichung von Hand zurückgezogen');
    stage.results_published = published;
  }

  private pauseSync(stageId: number, reason: string) {
    if (!this.syncPaused.has(stageId)) this.syncPaused.set(stageId, reason);
  }

  // ---------- Automatische Ergebnisse (Demo: plausibler Verlauf aus den Beispieldaten) ----------

  async loadSyncStatus(tourId: string, stageIds: number[]): Promise<SyncStatus> {
    await wait();
    const now = this.now();
    const tour = this.tours.find((t) => t.id === tourId);
    const iso = (ms: number) => new Date(Math.min(ms, now)).toISOString();
    const stages: StageSyncInfo[] = [];
    const log: SyncLogEntry[] = [];
    let id = 1;
    for (const s of this.stages.filter((x) => stageIds.includes(x.id)).sort((a, b) => a.number - b.number)) {
      const start = new Date(s.starts_at).getTime();
      const paused = this.syncPaused.get(s.id) ?? null;
      const url = tour?.pcs_slug ? `https://www.procyclingstats.com/race/${tour.pcs_slug}/stage-${s.number}` : null;
      const row: StageSyncInfo = { stage_id: s.id, paused: !!paused, paused_reason: paused, checked_at: null, synced_at: null, status: null, source_url: url, last_error: null };
      if (start <= now) {
        const synced = start + 4.8 * 3_600_000;
        if (s.results_published && synced <= now) {
          row.synced_at = iso(synced);
          row.checked_at = iso(Math.min(now - 20 * 60_000, synced + 30 * 3_600_000));
          row.status = 'veröffentlicht';
          const names = this.results.filter((r) => r.stage_id === s.id).sort((a, b) => a.position - b.position).slice(0, 3)
            .map((r, i) => `${i + 1}. ${this.riders.find((x) => x.id === r.rider_id)?.name ?? '?'}`).join(', ');
          log.push({ id: id++, at: row.synced_at, stage_id: s.id, level: 'change', message: `Etappe ${s.number}: Ergebnis veröffentlicht – ${names}` });
        } else {
          row.checked_at = iso(now - 4 * 60_000);
          row.status = now < start + 4 * 3_600_000 ? 'wartet auf die Zielankunft' : 'Ergebnis gelesen, Prüfung läuft';
        }
      } else if (start - now <= 36 * 3_600_000) {
        row.checked_at = iso(now - 50 * 60_000);
        row.status = 'Etappendaten geprüft';
      } else {
        continue;
      }
      if (paused) row.status = 'pausiert';
      stages.push(row);
    }
    return { stages, log: [...this.syncLog, ...log].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40) };
  }

  async setSyncMode(tourId: string, mode: SyncMode): Promise<void> {
    await wait();
    const tour = this.tours.find((t) => t.id === tourId);
    if (tour) tour.sync_mode = mode;
  }

  async setStageSyncPaused(stageId: number, paused: boolean): Promise<void> {
    await wait();
    const stage = this.stages.find((s) => s.id === stageId);
    if (paused) this.syncPaused.set(stageId, 'von Hand angehalten');
    else this.syncPaused.delete(stageId);
    this.syncLog.unshift({
      id: this.nextId++, at: new Date(this.now()).toISOString(), stage_id: stageId, level: 'info',
      message: `Automatik für Etappe ${stage?.number ?? '?'} ${paused ? 'angehalten' : 'fortgesetzt'}`,
    });
  }

  async setBonusResults(tourId: string, category: BonusResult['category'], entries: BonusResultInput[]): Promise<void> {
    await wait();
    this.bonusResults = this.bonusResults.filter((b) => !(b.tour_id === tourId && b.category === category));
    for (const e of entries) this.bonusResults.push({ ...e, tour_id: tourId, category });
  }
}

/** Beispiel-Höhenprofil für Demo-Etappen mit Anstiegen (aus Länge und Steigung, mit etwas Gelände) */
function demoProfile(stage: Stage): ProfilePoint[] | null {
  const climbs = stage.climbs ?? [];
  const km = stage.distance_km ?? 0;
  if (!climbs.length || !km) return null;
  let seed = stage.id * 9301;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const base = 120 + Math.round(rnd() * 200);
  const pts: ProfilePoint[] = [];
  let wobble = 0;
  for (let k = 0; k <= km + 1e-9; k += 0.5) {
    wobble = wobble * 0.92 + (rnd() - 0.5) * 14;
    let h = base + (k / km) * 120 + wobble * 3;
    for (const c of climbs) {
      const len = c.len ?? 5;
      const gain = len * (c.grad ?? 6) * 10;
      const top = (c.alt ?? base + gain + 200) ;
      const foot = top - gain;
      if (k >= c.km - len && k <= c.km) h = Math.max(h, foot + gain * ((k - (c.km - len)) / len));
      else if (k > c.km && k <= c.km + len * 0.9) h = Math.max(h, top - (top - base) * ((k - c.km) / (len * 0.9)));
    }
    pts.push([Math.round(k * 10) / 10, Math.round(h)]);
  }
  return pts;
}
