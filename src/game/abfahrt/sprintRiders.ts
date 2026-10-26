/**
 * Fahrerauswahl fürs Sprintfinale: aus der Startliste der Rundfahrt je Fahrertyp den passendsten
 * Fahrer (nach seinen Top-10-Plätzen auf den bisherigen Etappen), dazu der eigene Tipp des Tages.
 */
import type { Profile, Stage, StageKind, TourData } from '../../lib/types';
import { berlinDayKey, hashStr } from './rng';
import type { RiderType, SprintRider } from './sprint';

export interface RiderOption extends SprintRider {
  /** Fahrer-ID aus der Startliste (null = ohne Rundfahrt) */
  id: number | null;
  team: string;
  /** kurze Begründung, z. B. „2 × Top 10 im Sprint“ */
  why: string;
  tip: boolean;
}

export const TYPE_ORDER: RiderType[] = ['sprinter', 'puncheur', 'allround', 'rouleur', 'climber'];
const KIND_TYPE: Record<StageKind, RiderType> = { flat: 'sprinter', hilly: 'puncheur', mountain: 'climber', itt: 'rouleur', ttt: 'rouleur' };
const KIND_WORD: Record<RiderType, string> = {
  sprinter: 'auf Flachetappen', puncheur: 'auf welligen Etappen', allround: 'in der Gesamtwertung', rouleur: 'im Zeitfahren', climber: 'am Berg',
};

type Scores = Map<number, Record<RiderType, number> & { top: Record<RiderType, number> }>;

/** Punkte je Fahrer und Typ aus den veröffentlichten Ergebnissen und der Gesamtwertung */
function scoreRiders(data: TourData): Scores {
  const out: Scores = new Map();
  const get = (id: number) => {
    let s = out.get(id);
    if (!s) {
      s = { sprinter: 0, puncheur: 0, allround: 0, rouleur: 0, climber: 0, top: { sprinter: 0, puncheur: 0, allround: 0, rouleur: 0, climber: 0 } };
      out.set(id, s);
    }
    return s;
  };
  const stages = new Map(data.stages.filter((s) => s.results_published).map((s) => [s.id, s]));
  for (const r of data.results) {
    const st = stages.get(r.stage_id);
    if (!st || r.position > 10) continue;
    const t = KIND_TYPE[st.kind];
    const s = get(r.rider_id);
    s[t] += 11 - r.position;
    s.top[t] += 1;
  }
  // Gesamtwertung nach der letzten Etappe mit Stand: gute Plätze = Allrounder
  const gc = (data.standings ?? []).filter((x) => x.category === 'gc');
  const lastId = [...stages.values()].sort((a, b) => b.number - a.number).find((st) => gc.some((x) => x.stage_id === st.id))?.id;
  for (const x of gc) {
    if (x.stage_id !== lastId || x.position > 10) continue;
    const s = get(x.rider_id);
    s.allround += 24 - 2 * x.position;
    s.top.allround = x.position;
  }
  return out;
}

/** Fahrertyp eines Fahrers (null = noch keine Ergebnisse) */
export function typeOf(scores: Scores, id: number): RiderType | null {
  const s = scores.get(id);
  if (!s) return null;
  let best: RiderType | null = null;
  for (const t of TYPE_ORDER) if (s[t] > 0 && (!best || s[t] > s[best])) best = t;
  return best;
}

function whyFor(scores: Scores, id: number, t: RiderType): string {
  const s = scores.get(id);
  if (!s || s[t] <= 0) return '';
  if (t === 'allround') return `${s.top.allround}. ${KIND_WORD.allround}`;
  const n = s.top[t];
  return `${n} × Top 10 ${KIND_WORD[t]}`;
}

/** Etappe des Tages (sonst die nächste) */
export function stageOfDay(stages: Stage[], dayKey: string): Stage | null {
  const key = (iso: string) => berlinDayKey(new Date(iso));
  const sorted = [...stages].sort((a, b) => a.number - b.number);
  return sorted.find((s) => key(s.starts_at) === dayKey) ?? sorted.find((s) => key(s.starts_at) > dayKey) ?? null;
}

/** Auswahl: je Typ ein Fahrer, der eigene Tipp zuerst */
export function riderOptions(data: TourData | null | undefined, me: Profile, dayKey: string): RiderOption[] {
  const active = (data?.riders ?? []).filter((r) => r.status !== 'out');
  if (!data || active.length < 6) {
    const name = me.display_name || 'Du';
    return TYPE_ORDER.map((type, i) => ({ id: null, name, type, number: String(11 + i * 10), team: '', why: '', tip: false }));
  }
  const scores = scoreRiders(data);
  const used = new Set<number>();
  const opts: RiderOption[] = [];
  const stage = stageOfDay(data.stages, dayKey);
  const tip = stage ? data.tips.find((t) => t.user_id === me.id && t.stage_id === stage.id) : undefined;
  const tipRider = tip ? active.find((r) => r.id === tip.rider_id) : undefined;
  if (tipRider) {
    const type = typeOf(scores, tipRider.id) ?? 'allround';
    used.add(tipRider.id);
    opts.push({ id: tipRider.id, name: tipRider.name, type, number: String(tipRider.bib ?? 1), team: tipRider.team, why: whyFor(scores, tipRider.id, type), tip: true });
  }
  for (const type of TYPE_ORDER) {
    if (opts.some((o) => o.type === type)) continue;
    let best = -1;
    let bestScore = 0;
    for (const r of active) {
      if (used.has(r.id)) continue;
      const s = scores.get(r.id)?.[type] ?? 0;
      if (s > bestScore) { bestScore = s; best = r.id; }
    }
    if (best < 0) {
      // noch keine passenden Ergebnisse: fester Fahrer des Tages aus der Startliste
      const free = active.filter((r) => !used.has(r.id));
      best = free[hashStr(`${dayKey}:${type}`) % free.length].id;
    }
    const r = active.find((x) => x.id === best)!;
    used.add(r.id);
    opts.push({ id: r.id, name: r.name, type, number: String(r.bib ?? 1), team: r.team, why: whyFor(scores, r.id, type), tip: false });
  }
  return opts;
}

/**
 * Gegnernamen: im Sprint zuerst die schnellen Männer der Rundfahrt, am Berg zuerst die Kletterer und
 * die Besten der Gesamtwertung – dann der Rest der Startliste
 */
export function rivalNames(data: TourData | null | undefined, chosen: number | null, kind: 'sprint' | 'climb' = 'sprint'): string[] {
  const active = (data?.riders ?? []).filter((r) => r.status !== 'out' && r.id !== chosen);
  if (!active.length) return [];
  const scores = scoreRiders(data!);
  const score = (id: number) => {
    const s = scores.get(id);
    if (!s) return 0;
    return kind === 'climb' ? s.climber * 2 + s.allround * 1.5 + s.puncheur : s.sprinter * 2 + s.puncheur;
  };
  return active
    .map((r) => ({ n: r.name, s: score(r.id) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 40)
    .map((x) => x.n);
}
