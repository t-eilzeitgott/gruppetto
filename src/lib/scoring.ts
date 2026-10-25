import type {
  BonusCategory, Profile, Rider, Stage, StageResult, StageTip, TourData, PointScale,
} from './types';

/** Extrapunkte, wenn man als Einziger den Etappensieger getippt hat. */
export const UNDERDOG_BONUS = 3;

/** Punkte für Platz 1/2/3 einer Bonuswertung. */
export const BONUS_POINTS: Record<number, number> = { 1: 15, 2: 10, 3: 5 };

export const DEFAULT_SCALE: PointScale[] = [
  { position: 1, points: 20 }, { position: 2, points: 15 }, { position: 3, points: 10 },
  { position: 4, points: 7 }, { position: 5, points: 6 }, { position: 6, points: 5 },
  { position: 7, points: 4 }, { position: 8, points: 3 }, { position: 9, points: 2 },
  { position: 10, points: 1 },
];

export interface StageScore {
  userId: string;
  riderId: number;
  position: number | null;
  base: number;
  bonus: number;
  total: number;
}

function scaleMap(scale: PointScale[]): Map<number, number> {
  const source = scale.length ? scale : DEFAULT_SCALE;
  return new Map(source.map((s) => [s.position, s.points]));
}

/**
 * Punkte aller Tipps einer Etappe. Gibt nur für veröffentlichte Etappen Werte zurück.
 * Außenseiter-Bonus: Wer als Einziger den Etappensieger getippt hat, bekommt +3
 * (mindestens zwei Tipps auf der Etappe).
 */
export function scoreStage(
  stage: Stage,
  tips: StageTip[],
  results: StageResult[],
  scale: PointScale[],
): StageScore[] {
  if (!stage.results_published) return [];
  const stageTips = tips.filter((t) => t.stage_id === stage.id);
  const stageResults = results.filter((r) => r.stage_id === stage.id);
  const posByRider = new Map(stageResults.map((r) => [r.rider_id, r.position]));
  const points = scaleMap(scale);
  const winner = stageResults.find((r) => r.position === 1)?.rider_id ?? null;
  const winnerTips = winner === null ? 0 : stageTips.filter((t) => t.rider_id === winner).length;

  return stageTips.map((t) => {
    const position = posByRider.get(t.rider_id) ?? null;
    const base = position === null ? 0 : points.get(position) ?? 0;
    const bonus = position === 1 && winnerTips === 1 && stageTips.length >= 2 ? UNDERDOG_BONUS : 0;
    return { userId: t.user_id, riderId: t.rider_id, position, base, bonus, total: base + bonus };
  });
}

export interface StandingEntry {
  category: BonusCategory;
  position: number;
  riderId: number | null;
  team: string | null;
  wins?: number;
}

/** Wettkampf-Ranking (1, 1, 3): gleiche Werte teilen sich den Platz. */
export function competitionRanks<T>(items: T[], value: (item: T) => number): Map<T, number> {
  const sorted = [...items].sort((a, b) => value(b) - value(a));
  const ranks = new Map<T, number>();
  sorted.forEach((item, i) => {
    const prev = sorted[i - 1];
    ranks.set(item, prev !== undefined && value(prev) === value(item) ? ranks.get(prev)! : i + 1);
  });
  return ranks;
}

/** Stand aller Bonuswertungen inkl. automatisch berechneter „Meiste Etappensiege“. */
export function bonusStandings(data: TourData): StandingEntry[] {
  const entries: StandingEntry[] = data.bonusResults.map((r) => ({
    category: r.category, position: r.position, riderId: r.rider_id, team: r.team,
  }));
  const published = new Set(data.stages.filter((s) => s.results_published).map((s) => s.id));
  const wins = new Map<number, number>();
  for (const r of data.results) {
    if (r.position === 1 && published.has(r.stage_id)) {
      wins.set(r.rider_id, (wins.get(r.rider_id) ?? 0) + 1);
    }
  }
  const riders = [...wins.keys()];
  const ranks = competitionRanks(riders, (id) => wins.get(id)!);
  for (const id of riders) {
    const position = ranks.get(id)!;
    if (position <= 3) {
      entries.push({ category: 'stage_wins', position, riderId: id, team: null, wins: wins.get(id) });
    }
  }
  return entries;
}

export interface BonusScore {
  category: BonusCategory;
  position: number | null;
  points: number;
}

/** Bonuspunkte eines Spielers je Wertung (Hochrechnung bzw. Endstand). */
export function bonusScoresFor(data: TourData, userId: string, standings = bonusStandings(data)): BonusScore[] {
  return data.bonusTips
    .filter((t) => t.user_id === userId)
    .map((t) => {
      const matches = standings.filter((s) =>
        s.category === t.category &&
        ((t.rider_id !== null && s.riderId === t.rider_id) || (t.team !== null && s.team === t.team)));
      const best = matches.reduce<number | null>((min, s) => (min === null || s.position < min ? s.position : min), null);
      return { category: t.category, position: best, points: best === null ? 0 : BONUS_POINTS[best] ?? 0 };
    });
}

export interface LeaderRow {
  userId: string;
  name: string;
  color: string;
  isPro: boolean;
  stagePoints: number;
  bonusProjection: number;
  bonusPoints: number;
  total: number;
  rank: number;
  prevRank: number | null;
  lastStagePoints: number | null;
  winnersHit: number;
  underdogHits: number;
  perStage: Map<number, StageScore>;
}

export function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
}

/** Rangliste einer Rundfahrt. */
export function leaderboard(data: TourData, members: Profile[]): LeaderRow[] {
  const published = data.stages.filter((s) => s.results_published).sort((a, b) => a.number - b.number);
  const scoresByStage = new Map(published.map((s) => [s.id, scoreStage(s, data.tips, data.results, data.scale)]));
  const lastStage = published[published.length - 1] ?? null;
  const standings = bonusStandings(data);

  const rows: LeaderRow[] = members
    .filter((m) => m.is_member && m.display_name)
    .map((m) => {
      const perStage = new Map<number, StageScore>();
      let stagePoints = 0;
      let winnersHit = 0;
      let underdogHits = 0;
      for (const s of published) {
        const score = scoresByStage.get(s.id)!.find((x) => x.userId === m.id);
        if (!score) continue;
        perStage.set(s.id, score);
        stagePoints += score.total;
        if (score.position === 1) winnersHit += 1;
        if (score.bonus > 0) underdogHits += 1;
      }
      const bonusProjection = bonusScoresFor(data, m.id, standings).reduce((sum, b) => sum + b.points, 0);
      const bonusPoints = data.tour.bonus_final ? bonusProjection : 0;
      const lastStagePoints = lastStage ? perStage.get(lastStage.id)?.total ?? 0 : null;
      return {
        userId: m.id,
        name: m.display_name!,
        color: m.avatar_color,
        isPro: m.is_pro,
        stagePoints,
        bonusProjection,
        bonusPoints,
        total: stagePoints + bonusPoints,
        rank: 0,
        prevRank: null,
        lastStagePoints,
        winnersHit,
        underdogHits,
        perStage,
      };
    });

  const ranks = competitionRanks(rows, (r) => r.total);
  const prevRanks = published.length >= 2
    ? competitionRanks(rows, (r) => r.total - (r.lastStagePoints ?? 0))
    : null;
  for (const r of rows) {
    r.rank = ranks.get(r)!;
    r.prevRank = prevRanks ? prevRanks.get(r)! : null;
  }
  return rows.sort((a, b) => a.rank - b.rank || byName(a, b));
}

export interface SeasonRow {
  userId: string;
  name: string;
  color: string;
  total: number;
  rank: number;
  perTour: Map<string, number>;
}

/** Saisonwertung: Summe der Gesamtpunkte aller Rundfahrten eines Jahres. */
export function seasonLeaderboard(boards: { tourId: string; rows: LeaderRow[] }[], members: Profile[]): SeasonRow[] {
  const rows: SeasonRow[] = members
    .filter((m) => m.is_member && m.display_name)
    .map((m) => {
      const perTour = new Map<string, number>();
      let total = 0;
      for (const b of boards) {
        const row = b.rows.find((r) => r.userId === m.id);
        const pts = row?.total ?? 0;
        perTour.set(b.tourId, pts);
        total += pts;
      }
      return { userId: m.id, name: m.display_name!, color: m.avatar_color, total, rank: 0, perTour };
    });
  const ranks = competitionRanks(rows, (r) => r.total);
  for (const r of rows) r.rank = ranks.get(r)!;
  return rows.sort((a, b) => a.rank - b.rank || byName(a, b));
}

/** Wie oft hat ein Spieler Fahrer mit Joker-Limit schon getippt? */
export function jokerUsage(tips: StageTip[], riders: Rider[], userId: string): Map<number, number> {
  const limited = new Set(riders.filter((r) => r.tip_limit !== null).map((r) => r.id));
  const used = new Map<number, number>();
  for (const t of tips) {
    if (t.user_id === userId && limited.has(t.rider_id)) {
      used.set(t.rider_id, (used.get(t.rider_id) ?? 0) + 1);
    }
  }
  return used;
}

/** Joker übrig, wenn man für `stageId` Fahrer `riderId` tippen würde (eigener Tipp zählt nicht doppelt). */
export function jokerRemaining(rider: Rider, tips: StageTip[], userId: string, stageId: number): number | null {
  if (rider.tip_limit === null) return null;
  const used = tips.filter((t) => t.user_id === userId && t.rider_id === rider.id && t.stage_id !== stageId).length;
  return Math.max(0, rider.tip_limit - used);
}
