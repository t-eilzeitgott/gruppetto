import type {
  AdminUser, BonusCategory, BonusResult, BonusTip, Profile, Rider, Stage, StageResult, StageTip, Tour, TourData,
} from '../lib/types';
import { DEFAULT_SCALE, tipLimit } from '../lib/scoring';
import { bonusDeadline } from '../lib/time';
import {
  ApiError, type BonusResultInput, type DataSource, type RiderInput, type RiderPatch, type SessionUser,
  type StageInput, type TourInput,
} from './source';
import {
  DEMO_BONUS_RESULTS, DEMO_BONUS_TIPS, DEMO_ME, DEMO_NOW, DEMO_PROFILES, DEMO_RESULTS, DEMO_RIDERS, DEMO_STAGES,
  DEMO_TIPS, DEMO_TOURS,
} from './demoData';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));

/** Demo-Modus: alle Daten im Speicher, gleiche Regeln wie in der Datenbank. */
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

  constructor(start: 'app' | 'login' | 'join' = 'app', baseTime?: number) {
    this.base = baseTime ?? DEMO_NOW;
    this.signedIn = start !== 'login';
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
    });
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
  }

  async setStagePublished(stageId: number, published: boolean): Promise<void> {
    await wait();
    const stage = this.stages.find((s) => s.id === stageId)!;
    if (published && new Date(stage.starts_at).getTime() > this.now()) throw new ApiError('stage_not_started');
    stage.results_published = published;
  }

  async setBonusResults(tourId: string, category: BonusResult['category'], entries: BonusResultInput[]): Promise<void> {
    await wait();
    this.bonusResults = this.bonusResults.filter((b) => !(b.tour_id === tourId && b.category === category));
    for (const e of entries) this.bonusResults.push({ ...e, tour_id: tourId, category });
  }
}
