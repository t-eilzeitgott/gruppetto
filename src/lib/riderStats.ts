import type { Rider, Stage, StageKind, TourData, TourTheme } from './types';
import { bonusStandings, jokerRemaining, tipLimit, type StandingEntry } from './scoring';
import { sortStages } from './time';

export interface RiderStats {
  placings: { stage: Stage; pos: number }[];
  wins: number;
  podiums: number;
  best: number | null;
  /** Position in der Gesamtwertung nach jeder veröffentlichten Etappe (null = nicht in den Top 10) */
  gc: { stage: Stage; pos: number | null }[];
  gcNow: number | null;
  bestGc: number | null;
  leaderDays: number;
  youthLeaderDays: number;
  byKind: Partial<Record<StageKind, number>>;
  strength: string | null;
  tipsTotal: number;
  tippedBy: Map<string, number>;
  mine: number;
  left: number | null;
  limit: number | null;
  standings: StandingEntry[];
  lastSeen: Stage | null;
}

const STRENGTH: Record<StageKind, string> = {
  flat: 'Sprinter',
  hilly: 'Puncheur/Ausreißer',
  mountain: 'Kletterer',
  itt: 'Zeitfahrer',
  ttt: 'Zeitfahrer',
};

export function leaderLabel(theme: TourTheme): string {
  return theme === 'giro' ? 'Tage in Rosa' : theme === 'tour' ? 'Tage in Gelb' : theme === 'vuelta' ? 'Tage in Rot' : 'Tage in Führung';
}

export function riderStats(data: TourData, rider: Rider, now: number, meId: string): RiderStats {
  const published = sortStages(data.stages).filter((s) => s.results_published);
  const placings = published
    .map((s) => ({ stage: s, pos: data.results.find((r) => r.stage_id === s.id && r.rider_id === rider.id)?.position ?? null }))
    .filter((p): p is { stage: Stage; pos: number } => p.pos !== null);
  const standings = data.standings ?? [];
  const youngIds = new Set(data.riders.filter((r) => r.young).map((r) => r.id));
  const gc = published
    .filter((s) => standings.some((x) => x.stage_id === s.id && x.category === 'gc'))
    .map((s) => ({ stage: s, pos: standings.find((x) => x.stage_id === s.id && x.category === 'gc' && x.rider_id === rider.id)?.position ?? null }));
  let youthLeaderDays = 0;
  if (rider.young) {
    for (const s of published) {
      const list = standings.filter((x) => x.stage_id === s.id && x.category === 'gc').sort((a, b) => a.position - b.position);
      const bestYoung = list.find((x) => youngIds.has(x.rider_id));
      if (bestYoung?.rider_id === rider.id) youthLeaderDays += 1;
    }
  }
  const byKind: Partial<Record<StageKind, number>> = {};
  for (const p of placings) byKind[p.stage.kind] = (byKind[p.stage.kind] ?? 0) + 1;
  const topKind = (Object.entries(byKind) as [StageKind, number][]).sort((a, b) => b[1] - a[1])[0];

  const started = new Set(data.stages.filter((s) => new Date(s.starts_at).getTime() <= now).map((s) => s.id));
  const visible = data.tips.filter((t) => t.rider_id === rider.id && started.has(t.stage_id));
  const tippedBy = new Map<string, number>();
  for (const t of visible) tippedBy.set(t.user_id, (tippedBy.get(t.user_id) ?? 0) + 1);
  const gcPositions = gc.map((g) => g.pos).filter((p): p is number => p !== null);
  const lastPlacing = placings[placings.length - 1]?.stage ?? null;

  return {
    placings,
    wins: placings.filter((p) => p.pos === 1).length,
    podiums: placings.filter((p) => p.pos <= 3).length,
    best: placings.length ? Math.min(...placings.map((p) => p.pos)) : null,
    gc,
    gcNow: gc.length ? gc[gc.length - 1].pos : null,
    bestGc: gcPositions.length ? Math.min(...gcPositions) : null,
    leaderDays: gc.filter((g) => g.pos === 1).length,
    youthLeaderDays,
    byKind,
    strength: topKind ? STRENGTH[topKind[0]] : null,
    tipsTotal: visible.length,
    tippedBy,
    mine: data.tips.filter((t) => t.rider_id === rider.id && t.user_id === meId).length,
    left: jokerRemaining(data.tour, rider, data.tips, meId, -1),
    limit: tipLimit(data.tour, rider),
    standings: bonusStandings(data).filter((s) => s.riderId === rider.id || (s.team !== null && s.team === rider.team)),
    lastSeen: lastPlacing,
  };
}

/** Kennzahlen eines Teams */
export function teamStats(data: TourData, team: string) {
  const riders = data.riders.filter((r) => r.team === team);
  const ages = riders.map((r) => r.age).filter((a): a is number => typeof a === 'number');
  const nations = new Set(riders.map((r) => r.nationality).filter(Boolean));
  const ids = new Set(riders.map((r) => r.id));
  const published = new Set(data.stages.filter((s) => s.results_published).map((s) => s.id));
  const results = data.results.filter((r) => published.has(r.stage_id) && ids.has(r.rider_id));
  return {
    riders,
    active: riders.filter((r) => r.status === 'active').length,
    avgAge: ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null,
    nations: nations.size,
    wins: results.filter((r) => r.position === 1).length,
    top10: results.length,
    young: riders.filter((r) => r.young).length,
  };
}
