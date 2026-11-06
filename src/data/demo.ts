import type { ProfilePoint, StageProfileData } from '../lib/gpx';
import type {
  AdminUser, BonusCategory, BonusResult, BonusTip, Group, NewsItem, Profile, Rider, Stage, StageResult, StageTip, Tour, TourData,
  SyncLogEntry, SyncMode, SyncStatus, StageSyncInfo,
} from '../lib/types';
import { DEFAULT_RULES, scaleOf, tipLimit } from '../lib/scoring';
import { bonusDeadline } from '../lib/time';
import { TRACE_DT, ttScore, type GameGhostRow, type TtGhostRow } from '../game/tt';
import { berlinDayKey, hashStr } from '../game/abfahrt/rng';
import {
  ApiError, type BonusResultInput, type DataSource, type RiderInput, type RiderPatch, type SessionUser,
  type StageInput, type TourInput, type GameId, type GameBest, type GameRun, type RunStats, cleanStats,
  type LivePeer, type LivePing, type LiveSnapshot, type GroupInput,
} from './source';
import {
  DEMO_BONUS_RESULTS, DEMO_BONUS_TIPS, DEMO_ME, DEMO_NOW, DEMO_PROFILES, DEMO_RESULTS, DEMO_RIDERS, DEMO_STAGES,
  DEMO_STANDINGS, DEMO_TIPS, DEMO_TOURS, DEMO_REAL_PROFILES,
} from './demoData';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** Demo: Kennzahlen eines Laufs, je Fahrer und Lauf fest (nicht bei jedem Laden neu gewürfelt) */
function demoStats(game: GameId, key: string): RunStats {
  const r = (n: number) => (hashStr(`${key}:${n}`) % 1000) / 1000;
  const bikes = ['aero', 'acciaio', 'zeit', 'feder', 'titan', 'pave', 'allround'];
  const types = ['Allrounder', 'Sprinter', 'Puncheur', 'Rouleur', 'Kletterer'];
  const bike = bikes[Math.floor(r(9) * bikes.length)];
  if (game === 'abfahrt') return { avg_kmh: Math.round((54 + r(1) * 14) * 10) / 10, top_kmh: Math.round(78 + r(2) * 24), bike, slides: Math.floor(r(3) * 3) };
  if (game === 'sprint') return { avg_kmh: Math.round((45 + r(1) * 5) * 10) / 10, top_kmh: Math.round(62 + r(2) * 10), reserve: Math.round(r(3) * r(3) * 40) / 100, place: 1 + Math.floor(r(4) * 12), riders: 30, bike, type: types[Math.floor(r(5) * types.length)] };
  return { avg_kmh: Math.round((21 + r(1) * 6) * 10) / 10, top_kmh: Math.round(64 + r(2) * 18), reserve: Math.round(r(3) * r(3) * 45) / 100, place: 1 + Math.floor(r(4) * 10), riders: 24, bike, type: types[Math.floor(r(5) * types.length)], slides: Math.floor(r(6) * 3) };
}

/** Demo: simulierter Live-Lauf je Spiel – Tempo (m/s) und Länge bis zum Ziel (m) */
const DEMO_SIM: Record<GameId, { v: number; len: number }> = {
  abfahrt: { v: 15, len: 5000 }, sprint: { v: 12.6, len: 2400 }, berg: { v: 6.4, len: 2000 }, zeitfahren: { v: 11.8, len: 3000 },
};

/** Demo: Antwortzeit (zum Prüfen der Ladezustände: ?langsam=ms) */
const SLOW = (() => { try { const m = /[?&]langsam=(\d+)/.exec(window.location.search); return m ? Number(m[1]) : 0; } catch { return 0; } })();
const wait = (ms = 120) => new Promise((r) => setTimeout(r, Math.max(ms, SLOW)));

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
  /** die Gruppe der Demo – „du“ leitest sie */
  private group: Group = {
    id: 'g-demo', name: 'Gruppetto', owner_id: DEMO_ME, created_at: new Date(DEMO_NOW - 200 * 864e5).toISOString(),
    ...clone(DEFAULT_RULES), can_manage: true, invite_code: 'GIRO27',
  };
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
    const t = { ...(this.tours.find((x) => x.id === tour.id) ?? tour), tip_limit: this.group.tip_limit };
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
      scale: scaleOf(this.group.stage_points),
      rules: { stage_points: this.group.stage_points, bonus_points: this.group.bonus_points, tip_limit: this.group.tip_limit, underdog_bonus: this.group.underdog_bonus },
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

  private scores: { user_id: string; game: GameId; score: number; meters: number; at: string; stats?: RunStats }[] = [
    ['u-felix', 14210, 3480, 2], ['u-julian', 11885, 2950, 30], ['u-lena', 9630, 2610, 5], ['u-christoph', 7410, 2080, 50],
    ['u-tobi', 6190, 1760, 70], ['u-anna', 4860, 1320, 3], ['u-ben', 2540, 860, 90], ['u-felix', 9800, 2400, 1], ['u-julian', 7300, 2010, 1],
    [DEMO_ME, 5120, 2210, 6], [DEMO_ME, 8450, 4120, 29], [DEMO_ME, 3310, 1400, 52],
  ].map(([user_id, score, meters, h]) => ({
    user_id: user_id as string, game: 'abfahrt' as GameId, score: score as number, meters: meters as number,
    at: new Date(Date.now() - (h as number) * 3600e3).toISOString(), stats: demoStats('abfahrt', `${user_id}:${score}`),
  })).concat([
    ['u-julian', 1480, 1], ['u-lena', 1210, 2], ['u-felix', 960, 26], ['u-tobi', 720, 4],
  ].map(([user_id, score, h]) => ({
    user_id: user_id as string, game: 'sprint' as GameId, score: score as number, meters: 2400,
    at: new Date(Date.now() - (h as number) * 3600e3).toISOString(), stats: demoStats('sprint', `${user_id}:${score}`),
  }))).concat([
    ['u-lena', 1420, 3], ['u-ben', 1180, 2], ['u-julian', 760, 30], [DEMO_ME, 640, 28],
  ].map(([user_id, score, h]) => ({
    user_id: user_id as string, game: 'berg' as GameId, score: score as number, meters: 2000,
    at: new Date(Date.now() - (h as number) * 3600e3).toISOString(), stats: demoStats('berg', `${user_id}:${score}`),
  })));

  async submitScore(game: GameId, score: number, meters = 0, stats?: RunStats): Promise<void> {
    await wait(80);
    this.scores.push({ user_id: DEMO_ME, game, score: Math.round(score), meters: Math.round(meters), at: new Date().toISOString(), stats: stats ? cleanStats(stats) : undefined });
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
    for (const g of rows) {
      if (g.user_id === 'u-me-demo') continue;
      const r = (hashStr(`${g.user_id}:${day}:k`) % 1000) / 1000;
      this.scores.push({
        user_id: g.user_id, game: 'zeitfahren', score: ttScore(g.time_ms), meters: 3000, at: g.created_at,
        stats: { avg_kmh: Math.round(3000 / (g.time_ms / 1000) * 36) / 10, top_kmh: 62 + Math.round(r * 14), reserve: Math.round((0.02 + r * r * 0.4) * 100) / 100, bike: g.bike },
      });
    }
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

  // ---------- Live und Lobby (Demo): Lena fährt mit, Felix schaut zu ----------

  /** simulierte Läufe je Spiel: Start (Wanduhr, ms) */
  private liveSims = new Map<GameId, { start: number; run: string }>();
  private demoLobby: { code: string; seq: number; game: GameId | null; at: number | null; by: string | null; members: string[]; since: number } | null = null;

  /** Lenas Lauf: Spur bis jetzt (gleichmäßig mit etwas Wellengang, am Start anrollen) und ob sie im Ziel ist */
  private simRun(game: GameId, start: number, now: number): { trace: number[]; over: boolean } {
    const sim = DEMO_SIM[game];
    const n = Math.max(1, Math.floor((now - start) / 1000 / TRACE_DT) + 1);
    const trace: number[] = [];
    let z = 0;
    for (let i = 0; i < n; i++) {
      const t = i * TRACE_DT;
      const v = sim.v * (t < 4 ? 0.35 + 0.65 * (t / 4) : 1 + 0.07 * Math.sin(t / 6));
      if (i) z += v * TRACE_DT;
      if (z >= sim.len) return { trace, over: true };
      trace.push(Math.round(z * 10), Math.round(70 * Math.sin(t / 9)), Math.sin(t / 5) > 0.35 ? 1 : 0);
    }
    return { trace, over: false };
  }

  private liveSnap(game: GameId | null, course: string | null, me: { state: string; n: number; tail: number[]; run: string } | null): LiveSnapshot {
    const now = Date.now();
    const peers: LivePeer[] = [];
    const l = this.demoLobby;
    if (l) {
      // in der Lobby: Lena und Felix kommen nach ein paar Sekunden dazu
      const t = now - l.since;
      for (const [id, after] of [['u-lena', 2500], ['u-felix', 6000]] as const) if (t > after && !l.members.includes(id)) l.members.push(id);
    }
    if (game && course !== null && me && me.state !== 'menu' && me.n > 0) {
      // fährt man selbst, fährt Lena neben einem her – ein paar Meter voraus, mal mehr, mal weniger (ihre Spur ist
      // die eigene, versetzt: so steht sie auch bei ruckelnder Grafik neben einem)
      const k = Math.floor(me.tail.length / 3);
      const tail: number[] = [];
      for (let j = 0; j < k; j++) {
        const i = me.n - k + j;
        tail.push(me.tail[j * 3] + Math.round((4 + 3 * Math.sin((i * TRACE_DT) / 5)) * 10), me.tail[j * 3 + 1] + 120, me.tail[j * 3 + 2]);
      }
      peers.push({ user_id: 'u-lena', game, course, state: me.state === 'over' ? 'over' : 'race', run: `mirror-${me.run}`, n: me.n, tail, bike: 'aero', score: me.state === 'over' ? 1180 : null, age_ms: 120 });
    } else if (game && course !== null) {
      // im Startblatt: Lena ist schon unterwegs
      let sim = this.liveSims.get(game);
      if (!sim || (this.simRun(game, sim.start, now).over && now - sim.start > 240_000)) {
        sim = { start: now - 18_000, run: `demo-${now}:menu` };
        this.liveSims.set(game, sim);
      }
      const r = this.simRun(game, sim.start, now);
      const k = Math.floor(r.trace.length / 3);
      peers.push({
        user_id: 'u-lena', game, course, state: r.over ? 'over' : 'race', run: sim.run, n: k, tail: r.trace.slice(Math.max(0, k - 40) * 3),
        bike: 'aero', score: r.over ? 1180 : null, age_ms: 140,
      });
    } else {
      peers.push({ user_id: 'u-lena', game: 'zeitfahren', course: 'demo', state: 'race', run: 'demo', n: 400, tail: [11800, 40, 1], bike: 'aero', score: null, age_ms: 300 });
    }
    peers.push({ user_id: 'u-felix', game: game === 'sprint' ? 'berg' : 'sprint', course: 'demo', state: 'menu', run: '', n: 0, tail: [], bike: 'allround', score: null, age_ms: 900 });
    return {
      now,
      peers,
      lobby: l ? { code: l.code, seq: l.seq, game: l.game, at: l.at, by: l.by, members: l.members.map((id, i) => ({ user_id: id, seen_ms: id === DEMO_ME ? 0 : 400 + i * 300 })) } : null,
    };
  }

  async livePing(p: LivePing): Promise<LiveSnapshot | null> {
    await wait(70);
    return this.liveSnap(p.game, p.course, { state: p.state, n: p.n, tail: p.tail, run: p.run });
  }

  async liveList(): Promise<LiveSnapshot | null> {
    await wait(70);
    return this.liveSnap(null, null, null);
  }

  rtConfig() {
    return null;
  }

  async liveLeave(): Promise<void> {
    await wait(20);
  }

  async lobbyCreate(): Promise<string> {
    await wait(200);
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
    this.demoLobby = { code, seq: 0, game: null, at: null, by: null, members: [DEMO_ME], since: Date.now() };
    return code;
  }

  async lobbyJoin(code: string): Promise<string> {
    await wait(200);
    const c = code.replace(/\s/g, '').toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(c)) throw new ApiError('lobby_not_found');
    this.demoLobby = { code: c, seq: 0, game: null, at: null, by: null, members: ['u-lena', 'u-felix', DEMO_ME], since: Date.now() - 10_000 };
    return c;
  }

  async lobbyLeave(): Promise<void> {
    await wait(120);
    this.demoLobby = null;
  }

  async lobbyStart(game: GameId): Promise<LiveSnapshot | null> {
    await wait(120);
    const l = this.demoLobby;
    if (!l) throw new ApiError('no_lobby');
    l.seq += 1;
    l.game = game;
    l.at = Date.now() + 12_000;
    l.by = DEMO_ME;
    return this.liveSnap(null, null, null);
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
      if (!b) by.set(s.user_id, { user_id: s.user_id, best: s.score, best_m: s.meters, runs: 1, total_m: s.meters, last_at: s.at, best_at: s.at, stats: s.stats ?? null });
      else {
        if (s.score > b.best) { b.best_at = s.at; b.stats = s.stats ?? null; }
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

  /** Beispielmeldungen (ausgedacht, ohne echte Personen) – Zeiten relativ zu „jetzt“ */
  async loadNews(): Promise<NewsItem[]> {
    await wait(120);
    const now = this.now();
    return DEMO_NEWS.map(([h, lang, topics, sources, score, title, summary], i) => ({
      id: `demo-${i}`, source: 'beispiel', lang, title, summary, url: 'https://example.org/',
      published_at: new Date(now - h * 3600e3).toISOString(), topics, cluster: sources > 1 ? `demo-${i}` : null, sources, score,
      fetched_at: new Date(now - 0.4 * 3600e3).toISOString(),
    }));
  }

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

  // ---------- Gruppe ----------

  async joinGroup(code: string, name: string): Promise<void> {
    await wait(300);
    if (code.trim().toUpperCase() !== this.group.invite_code) throw new ApiError('invalid_code');
    this.checkName(name);
    const me = this.profiles.find((p) => p.id === DEMO_ME)!;
    me.display_name = name.trim();
    me.is_member = true;
  }

  async createGroup(groupName: string, name: string): Promise<string> {
    await wait(300);
    const title = groupName.trim();
    if (title.length < 2 || title.length > 30) throw new ApiError('invalid_group_name');
    this.checkName(name);
    const me = this.profiles.find((p) => p.id === DEMO_ME)!;
    me.display_name = name.trim();
    me.is_member = true;
    this.group = { ...this.group, ...clone(DEFAULT_RULES), name: title, owner_id: DEMO_ME, invite_code: this.randomCode() };
    return this.group.invite_code!;
  }

  private randomCode(): string {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
  }

  async loadGroup(): Promise<Group | null> {
    await wait();
    const me = this.profiles.find((p) => p.id === DEMO_ME);
    return me?.is_member ? clone(this.group) : null;
  }

  async updateGroup(input: GroupInput): Promise<void> {
    await wait();
    const title = input.name.trim();
    if (title.length < 2 || title.length > 30) throw new ApiError('invalid_group_name');
    const ok = (list: number[], min: number, max: number) => list.length >= min && list.length <= max && list.every((x) => Number.isInteger(x) && x >= 0 && x <= 100);
    if (!ok(input.stage_points, 1, 10) || !ok(input.bonus_points, 3, 3) || (input.tip_limit !== null && (input.tip_limit < 1 || input.tip_limit > 21))) throw new ApiError('invalid_rules');
    this.group = { ...this.group, name: title, stage_points: [...input.stage_points], bonus_points: [...input.bonus_points], tip_limit: input.tip_limit, underdog_bonus: input.underdog_bonus };
  }

  async newInviteCode(): Promise<string> {
    await wait();
    this.group.invite_code = this.randomCode();
    return this.group.invite_code;
  }

  async removeMember(userId: string): Promise<void> {
    await wait();
    if (userId === DEMO_ME) throw new ApiError('cannot_remove_self');
    const p = this.profiles.find((x) => x.id === userId);
    if (p) p.is_member = false;
  }

  async transferGroup(userId: string): Promise<void> {
    await wait();
    if (!this.profiles.some((p) => p.id === userId && p.is_member)) throw new ApiError('not_in_group');
    // Demo: du bleibst Admin der App und kannst die Gruppe deshalb weiter verwalten
    this.group.owner_id = userId;
  }

  // ---------- Spieler ----------

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
    const tour = { ...this.tours.find((t) => t.id === stage.tour_id)!, tip_limit: this.group.tip_limit };
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
    return clone(this.profiles.map((p) => ({ ...p, email: `${p.id.slice(2)}@beispiel.de`, group_name: p.is_member ? this.group.name : null, is_owner: p.id === this.group.owner_id })));
  }

  async adminSetFlags(userId: string, member: boolean, admin: boolean, pro: boolean): Promise<void> {
    await wait();
    if (userId === DEMO_ME && !admin) throw new ApiError('cannot_remove_own_admin');
    const p = this.profiles.find((x) => x.id === userId)!;
    Object.assign(p, { is_member: member, is_admin: admin, is_pro: pro });
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

/** [vor Stunden, Sprache, Themen, Quellen, Gewicht, Überschrift, Anriss] – frei erfunden, ohne echte Personen */
const DEMO_NEWS: [number, 'de' | 'en', string[], number, number, string, string | null][] = [
  [1.2, 'de', ['rennen'], 3, 2.6, 'Königsetappe am Passo San Marco: Die Favoriten belauern sich bis zum Schlussanstieg', 'Vor der ersten großen Bergankunft halten sich die Kapitäne bedeckt – die Teams rechnen mit einer Vorentscheidung im Gesamtklassement.'],
  [2.5, 'en', ['rennen'], 1, 1.6, 'Stage preview: why the breakaway may finally get its chance', 'Rolling terrain, a late climb and tired sprint teams – the ingredients for a day for the opportunists.'],
  [4, 'de', ['verletzung'], 2, 2.3, 'Sturz im Finale: Mehrere Fahrer mit Prellungen, Rennarzt gibt Entwarnung', 'Auf nasser Straße kam es drei Kilometer vor dem Ziel zu einem Massensturz. Alle Beteiligten konnten weiterfahren.'],
  [5, 'de', ['rennen'], 1, 1.5, 'Ausreißer gewinnt am Colle di Zambla – Favoriten kommen gemeinsam ins Ziel', 'Nach 180 Kilometern in der Spitzengruppe setzte sich der Ausreißer am letzten Anstieg ab und rettete 25 Sekunden ins Ziel.'],
  [6, 'de', ['transfer'], 1, 1.4, 'Transfermarkt: Zwei WorldTour-Teams werben um junges Klassikertalent', 'Der Vertrag des U23-Siegers läuft aus – die Entscheidung soll noch vor der Tour fallen.'],
  [9, 'en', ['team'], 1, 1.1, 'Team doctors warn of heat as the race heads south', null],
  [20, 'de', ['rennen'], 2, 1.8, 'Etappensieg aus der Fluchtgruppe – die Favoriten sparen Kräfte', 'Die Ausreißer retteten 40 Sekunden ins Ziel, im Feld blieb es bis zum Schluss ruhig.'],
  [23, 'en', ['rennen'], 1, 1.2, 'Analysis: the rest day could reshape the GC battle', 'Three teams, three plans – and one mountain stage that might decide everything.'],
  [27, 'de', ['team'], 1, 1.0, 'Neues Material: Teams testen breitere Reifen für die Schotterpassage', null],
  [44, 'en', ['transfer'], 1, 1.1, 'Rumours: Grand Tour contender weighing two-year deal', null],
  [49, 'de', ['rennen'], 1, 1.0, 'Nachwuchs: Rundfahrt der U23 mit Rekordbeteiligung', 'Über 170 Fahrerinnen und Fahrer aus 24 Nationen stehen am Start.'],
];
