/**
 * Meldungen aus der eigenen Tipprunde (News-Tab): nach jeder Etappe mit Ergebnis eine kurze Meldung wie in der
 * Sportpresse – wer führt (verteidigt, übernommen, geteilt, ausgebaut, knapp), wer den Tag gewonnen hat, wer als
 * Einzige(r) auf den Sieger gesetzt hat, Sprünge, Serien, vergessene Tipps, rote Laterne, am Ende der Gesamtsieg.
 *
 * Die Formulierungen wechseln: je Lage gibt es mehrere Fassungen, gewählt mit einem Würfel aus Rundfahrt und
 * Etappe (beim Neuladen dieselbe Meldung) – und nie zweimal hintereinander dieselbe Fassung einer Lage.
 * Ohne Personalpronomen und ohne „der Sieger“/„die Siegerin“ für Mitglieder (wir kennen kein Geschlecht).
 */
import { bonusScoresFor, bonusStandings, competitionRanks, scoreStageOf } from './scoring';
import type { Profile, Stage, TourData } from './types';

export type RoundKind = 'start' | 'lead' | 'change' | 'tie' | 'final' | 'open' | 'none';

export interface RoundStanding {
  userId: string;
  name: string;
  color: string;
  rank: number;
  total: number;
  /** Plätze gutgemacht (+) oder verloren (−) seit der Etappe davor; null am ersten Tag */
  move: number | null;
  /** Punkte dieser Etappe */
  day: number;
}

export interface RoundNews {
  id: string;
  stageId: number;
  stageNumber: number;
  /** Zeitpunkt der Meldung (Ergebnis der Etappe, geschätzt) */
  at: string;
  kind: RoundKind;
  title: string;
  /** ein bis drei Sätze */
  text: string;
  /** die Spitze der Tabelle danach (Plätze 1–3, bei Gleichstand mehr) */
  table: RoundStanding[];
}

// ------------------------------------------------------------------ Sprache

export const pts = (n: number) => (n === 1 ? '1 Punkt' : `${n} Punkte`);
/** nach „mit“: „mit 1 Punkt“, „mit 5 Punkten“ */
export const ptsD = (n: number) => (n === 1 ? '1 Punkt' : `${n} Punkten`);
const bonusPts = (n: number) => (n === 1 ? '1 Bonuspunkt' : `${n} Bonuspunkte`);
/** „A“, „A und B“, „A, B und C“ */
export function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Würfel je Rundfahrt, Etappe und Lage – nie zweimal hintereinander dieselbe Fassung einer Lage */
class Picker {
  private last = new Map<string, number>();
  private seed: string;
  constructor(private tour: string) { this.seed = tour; }
  pick<C>(key: string, variants: ((c: C) => string)[], c: C): string {
    let i = hash(`${this.seed}:${key}`) % variants.length;
    if (variants.length > 1 && this.last.get(key) === i) i = (i + 1) % variants.length;
    this.last.set(key, i);
    return variants[i](c);
  }
  /** neue Etappe: neuer Würfel, die Erinnerung an die letzte Fassung bleibt */
  stage(n: number) { this.seed = `${this.tour}#${n}`; }
}

// ------------------------------------------------------------------ Überschriften

interface T { L: string; Ls: string; O: string; S: string; m: number; r: number; k: number; n: number; tour: string }

const TITLE: Record<string, ((c: T) => string)[]> = {
  start: [
    (c) => `${c.L} führt nach dem Auftakt`,
    (c) => `Die erste Führung der Runde geht an ${c.L}`,
    (c) => `${c.L} startet vorneweg`,
    (c) => `Auftakt nach Maß für ${c.L}`,
  ],
  startTie: [
    (c) => `Geteilte Spitze zum Auftakt: ${c.Ls}`,
    (c) => `${c.Ls} starten punktgleich vorn`,
    (c) => `Keine klare Spitze am ersten Tag – ${c.Ls} gleichauf`,
  ],
  change: [
    (c) => `${c.L} übernimmt die Führung`,
    (c) => `Wachwechsel: ${c.L} löst ${c.O} ab`,
    (c) => `Neu an der Spitze: ${c.L}`,
    (c) => `${c.L} schnappt sich Platz eins`,
    (c) => `Führungswechsel – ${c.L} jetzt vorn`,
  ],
  comeback: [
    (c) => `Von Platz ${c.r} an die Spitze: ${c.L}`,
    (c) => `${c.L} stürmt von Rang ${c.r} nach ganz vorn`,
    (c) => `Großer Sprung: ${c.L} führt plötzlich`,
  ],
  untie: [
    (c) => `${c.L} setzt sich allein an die Spitze`,
    (c) => `Gleichstand aufgelöst: ${c.L} führt allein`,
    (c) => `${c.L} löst sich aus der geteilten Führung`,
  ],
  tieNew: [
    (c) => `Gleichstand an der Spitze: ${c.Ls}`,
    (c) => `Punktgleich vorn: ${c.Ls}`,
    (c) => `Alles wieder offen – ${c.Ls} teilen sich Platz eins`,
  ],
  catchUp: [
    (c) => `${c.S} schließt zu ${c.L} auf`,
    (c) => `${c.S} zieht mit ${c.L} gleich`,
    (c) => `Eingeholt: ${c.S} jetzt punktgleich mit ${c.L}`,
  ],
  tieKeep: [
    (c) => `${c.Ls} weiter gleichauf`,
    (c) => `Noch immer keine Entscheidung: ${c.Ls} teilen sich die Spitze`,
    (c) => `Kopf an Kopf: ${c.Ls} weiter punktgleich`,
  ],
  defend: [
    (c) => `${c.L} verteidigt die Führung`,
    (c) => `${c.L} bleibt vorn`,
    (c) => `${c.L} hält die Spitze`,
    (c) => `Alles beim Alten: ${c.L} führt`,
    (c) => `${c.L} weiter auf Platz eins`,
  ],
  extend: [
    (c) => `${c.L} baut die Führung aus`,
    (c) => `${c.L} setzt sich weiter ab – ${pts(c.m)} Vorsprung`,
    (c) => `${c.L} legt nach: jetzt ${pts(c.m)} vor ${c.S}`,
    (c) => `Der Vorsprung wächst: ${c.L} ${pts(c.m)} vorn`,
  ],
  dominate: [
    (c) => `${c.L} enteilt – ${pts(c.m)} Vorsprung`,
    (c) => `Einsam an der Spitze: ${c.L} mit ${ptsD(c.m)} Polster`,
    (c) => `${c.L} zieht davon: ${pts(c.m)} vor ${c.S}`,
  ],
  shrink: [
    (c) => `${c.L} bleibt vorn – aber ${c.S} kommt näher`,
    (c) => `Der Vorsprung schmilzt: ${c.L} nur noch ${pts(c.m)} vor ${c.S}`,
    (c) => `${c.S} rückt ${c.L} auf die Pelle`,
  ],
  razor: [
    (c) => `Hauchdünn: ${c.L} nur ${pts(c.m)} vor ${c.S}`,
    (c) => `Knapper geht es kaum – ${c.L} führt mit ${ptsD(c.m)}`,
    (c) => `${c.L} zittert sich an der Spitze durch`,
  ],
  zero: [
    (c) => `${c.L} trotz Nullrunde weiter vorn`,
    (c) => `Leerer Tag für ${c.L} – die Führung bleibt trotzdem`,
    (c) => `${c.L} ohne Punkte, aber weiter auf Platz eins`,
  ],
  still: [
    (c) => `Nullrunde für alle – ${c.L} bleibt vorn`,
    (c) => `Stillstand: niemand punktet, ${c.L} führt weiter`,
  ],
  streak: [
    (c) => `${c.L} seit ${c.k} Etappen an der Spitze`,
    (c) => `Die ${c.k}. Etappe in Folge: ${c.L} führt`,
    (c) => `${c.L} gibt Platz eins nicht her – ${c.k} Etappen und kein Ende`,
  ],
  half: [
    (c) => `Halbzeit: ${c.L} führt die Runde an`,
    (c) => `Zur Halbzeit vorn: ${c.L}`,
    (c) => `Bergfest mit ${c.L} an der Spitze`,
  ],
  eve: [
    (c) => `Vor der Schlussetappe: ${c.L} ${pts(c.m)} vorn`,
    (c) => `Eine Etappe noch – ${c.L} führt mit ${ptsD(c.m)}`,
    (c) => `${c.L} geht mit ${ptsD(c.m)} Vorsprung ins Finale`,
  ],
  final: [
    (c) => `${c.L} gewinnt die Tipprunde!`,
    (c) => `Gesamtsieg in der Tipprunde ${c.tour}: ${c.L}`,
    (c) => `Geschafft: ${c.L} holt den Gesamtsieg`,
  ],
  finalTie: [
    (c) => `Geteilter Gesamtsieg: ${c.Ls}`,
    (c) => `${c.Ls} gewinnen die Tipprunde gemeinsam`,
  ],
  open: [
    (c) => `Nach der Schlussetappe: ${c.L} vorn – die Bonuswertung entscheidet`,
    (c) => `${c.L} führt nach der letzten Etappe, die Bonuspunkte stehen noch aus`,
  ],
  openTie: [
    (c) => `Gleichstand nach der Schlussetappe – die Bonuswertung entscheidet zwischen ${c.Ls}`,
  ],
  none: [
    (c) => `Noch keine Punkte nach Etappe ${c.n}`,
    () => 'Alles offen: noch hat niemand gepunktet',
  ],
};

// ------------------------------------------------------------------ Sätze

interface F { D: string; Ds: string; p: number; R: string; H: string; hn: number; U: string; b: number; J: string; X: string; xn: number; k: number; r: number; pos: number; n: number; S: string; t2: number; T3: string; t3: number }

const FACT: Record<string, ((c: F) => string)[]> = {
  underdog: [
    (c) => `Nur ${c.U} hatte ${c.R} getippt – dafür gibt es ${bonusPts(c.b)} extra.`,
    (c) => `Außenseiter-Coup: ${c.U} setzt allein auf ${c.R} und kassiert ${pts(c.b)} obendrauf.`,
    (c) => `${c.R} gewinnt – und nur ${c.U} lag richtig: ${pts(c.b)} Außenseiter-Bonus.`,
  ],
  day: [
    (c) => `${c.D} holt mit ${ptsD(c.p)} die meisten Punkte des Tages.`,
    (c) => `Bester Tipp des Tages: ${c.D} mit ${ptsD(c.p)}.`,
    (c) => `${pts(c.p)} für ${c.D} – das war das Maß der Dinge.`,
    (c) => `${c.D} räumt mit ${ptsD(c.p)} am meisten ab.`,
  ],
  dayTie: [
    (c) => `${c.Ds} holen je ${pts(c.p)} – mehr gab es an diesem Tag nicht.`,
    (c) => `Bester Tag: ${c.Ds} mit je ${ptsD(c.p)}.`,
    (c) => `${c.Ds} teilen sich den Tagessieg mit je ${ptsD(c.p)}.`,
  ],
  dayMany: [
    (c) => `Gleich ${c.k} aus der Runde holen je ${pts(c.p)}.`,
    (c) => `${c.k}-mal ${pts(c.p)} – die Runde lag dicht beieinander.`,
  ],
  hit: [
    (c) => `${c.R} gewinnt die Etappe – getippt von ${c.H}.`,
    (c) => `Den Etappensieger ${c.R} ${c.hn > 1 ? 'hatten' : 'hatte'} ${c.H} auf dem Zettel.`,
    (c) => `Treffer: ${c.H} ${c.hn > 1 ? 'setzten' : 'setzte'} auf Etappensieger ${c.R}.`,
  ],
  dayHit: [
    (c) => `${c.H} ${c.hn > 1 ? 'lagen' : 'lag'} mit Etappensieger ${c.R} richtig – ${c.hn > 1 ? 'je ' : ''}${pts(c.p)}.`,
    (c) => `Volltreffer für ${c.H}: ${c.R} gewinnt die Etappe, ${c.hn > 1 ? 'je ' : ''}${pts(c.p)}.`,
    (c) => `${c.R} gewinnt – und ${c.H} ${c.hn > 1 ? 'hatten' : 'hatte'} den richtigen Riecher: ${c.hn > 1 ? 'je ' : ''}${pts(c.p)}.`,
  ],
  dayHitMany: [
    (c) => `Gleich ${c.hn} aus der Runde lagen mit Etappensieger ${c.R} richtig – je ${pts(c.p)}.`,
    (c) => `${c.R} gewinnt, und ${c.hn} aus der Runde hatten den Sieg kommen sehen: je ${pts(c.p)}.`,
  ],
  hitMany: [
    (c) => `Etappensieger ${c.R} stand auf ${c.hn} Tippzetteln.`,
    (c) => `${c.hn} aus der Runde hatten Etappensieger ${c.R} getippt.`,
  ],
  miss: [
    (c) => `${c.R} gewinnt – auf diesen Sieg hatte niemand gesetzt.`,
    (c) => `Etappensieger ${c.R} stand auf keinem Tippzettel.`,
    (c) => `${c.R} holt die Etappe, ohne dass es jemand kommen sah.`,
    (c) => `Mit ${c.R} als Etappensieger hatte niemand gerechnet.`,
  ],
  nobody: [
    () => 'Ein Tag zum Vergessen: niemand holt Punkte.',
    () => 'Nullnummer für die ganze Runde – kein Tipp landete in den Punkten.',
  ],
  noTips: [
    (c) => `Für Etappe ${c.n} hat niemand getippt.`,
  ],
  sameWin: [
    (c) => `Alle setzten auf ${c.R} – und ${c.R} gewinnt. Gleiche Punkte für alle.`,
    (c) => `Einstimmig ${c.R}, einstimmig richtig: der Etappensieg bringt allen dieselben Punkte.`,
  ],
  same: [
    (c) => `Einigkeit in der Runde: alle auf ${c.R}, am Ende Platz ${c.pos}.`,
    (c) => `Alle tippten ${c.R} – es wurde Platz ${c.pos}.`,
  ],
  sameZero: [
    (c) => `Alle auf ${c.R} – und keiner punktet.`,
    (c) => `Die ganze Runde setzte auf ${c.R} – ohne einen einzigen Punkt.`,
  ],
  jump: [
    (c) => `${c.J} springt ${c.k} Plätze nach vorn auf Rang ${c.r}.`,
    (c) => `Sprung des Tages: ${c.J}, jetzt auf Platz ${c.r}.`,
    (c) => `${c.J} macht ${c.k} Plätze gut und steht jetzt auf Rang ${c.r}.`,
  ],
  fall: [
    (c) => `${c.J} rutscht auf Platz ${c.r} ab.`,
    (c) => `Rückschlag für ${c.J}: ${c.k} Plätze verloren.`,
  ],
  forgot: [
    (c) => `Ohne Tipp: ${c.X}.`,
    (c) => `${c.X} ${c.xn > 1 ? 'haben' : 'hat'} das Tippen vergessen – null Punkte.`,
    (c) => `Vergessen zu tippen: ${c.X}.`,
  ],
  forgotMany: [
    (c) => `${c.xn} aus der Runde haben nicht getippt.`,
    (c) => `Gleich ${c.xn} Tippzettel blieben leer.`,
  ],
  drought: [
    (c) => `${c.X} wartet seit ${c.k} Etappen auf Punkte.`,
    (c) => `Durststrecke: ${c.X} seit ${c.k} Etappen ohne Punkte.`,
  ],
  best: [
    (c) => `${c.X} mit ${ptsD(c.p)} so stark wie noch nie in dieser Runde.`,
    (c) => `Bestwert für ${c.X}: ${pts(c.p)} an einem Tag.`,
  ],
  series: [
    (c) => `${c.D} gewinnt den Tag zum ${c.k}. Mal in Folge.`,
    (c) => `Serie: der ${c.k}. Tagessieg hintereinander für ${c.D}.`,
  ],
  lantern: [
    (c) => `Die rote Laterne trägt jetzt ${c.X}.`,
    (c) => `Neu am Ende der Tabelle: ${c.X}.`,
  ],
  gap: [
    (c) => `Der Abstand auf ${c.S}: ${pts(c.p)}.`,
    (c) => `${c.S} folgt mit ${ptsD(c.p)} Rückstand.`,
    (c) => `Auf Platz zwei: ${c.S}, ${pts(c.p)} dahinter.`,
    (c) => `Platz zwei geht an ${c.S}, ${pts(c.p)} zurück.`,
  ],
  gapMany: [
    (c) => `Dahinter lauern ${c.S} mit je ${ptsD(c.p)} Rückstand.`,
    (c) => `${c.S} folgen punktgleich, ${pts(c.p)} dahinter.`,
  ],
  podium: [
    (c) => `Dahinter ${c.S} (${c.t2}) und ${c.T3} (${c.t3}).`,
    (c) => `Auf den Plätzen: ${c.S} mit ${ptsD(c.t2)} und ${c.T3} mit ${ptsD(c.t3)}.`,
  ],
  bonusSwing: [
    (c) => `Erst die Bonuswertung brachte die Entscheidung – nach den Etappen lag noch ${c.S} vorn.`,
    (c) => `Die Bonuspunkte drehten das Ergebnis: nach den Etappen führte ${c.S}.`,
  ],
  bonusHold: [
    () => 'Auch die Bonuswertung änderte an der Spitze nichts mehr.',
    () => 'Die Bonuspunkte bestätigen, was die Etappen schon gezeigt hatten.',
  ],
};

// ------------------------------------------------------------------ Berechnen

interface Row { id: string; name: string; color: string }

/** geschätzter Zeitpunkt des Ergebnisses: sechs Stunden nach dem Start, nicht in der Zukunft */
function resultTime(stage: Stage, now: number): string {
  const t = Math.min(new Date(stage.starts_at).getTime() + 6 * 3600e3, now);
  return new Date(t).toISOString();
}

export function roundNews(data: TourData, members: Profile[], now: number): RoundNews[] {
  const rows: Row[] = members.filter((m) => m.is_member && m.display_name).map((m) => ({ id: m.id, name: m.display_name!, color: m.avatar_color }));
  if (!rows.length) return [];
  const stages = [...data.stages].sort((a, b) => a.number - b.number);
  const published = stages.filter((s) => s.results_published);
  const lastNumber = stages.length ? stages[stages.length - 1].number : 0;
  const riderName = (id: number | null | undefined) => data.riders.find((r) => r.id === id)?.name ?? null;
  const nameOf = new Map(rows.map((r) => [r.id, r.name]));
  const name = (id: string) => nameOf.get(id)!;
  const P = new Picker(data.tour.id);

  const totals = new Map(rows.map((r) => [r.id, 0]));
  const best = new Map(rows.map((r) => [r.id, 0]));
  const zeroRun = new Map(rows.map((r) => [r.id, 0]));
  let prevRanks: Map<string, number> | null = null;
  let prevLeaders: string[] = [];
  let prevMargin: number | null = null;
  let leadStreak = 0;
  let prevDayWinner: string | null = null;
  let dayStreak = 0;
  let prevLantern: string | null = null;
  const out: RoundNews[] = [];

  const rankOf = (vals: Map<string, number>) => {
    const m = competitionRanks(rows, (r) => vals.get(r.id)!);
    return new Map(rows.map((r) => [r.id, m.get(r)!]));
  };

  published.forEach((stage, idx) => {
    P.stage(stage.number);
    const scores = scoreStageOf(data, stage).filter((s) => nameOf.has(s.userId));
    const day = new Map(rows.map((r) => [r.id, scores.find((s) => s.userId === r.id)?.total ?? 0]));
    const tipped = new Set(scores.map((s) => s.userId));
    for (const r of rows) totals.set(r.id, totals.get(r.id)! + day.get(r.id)!);
    const last = stage.number === lastNumber;

    // Schluss: mit den Bonuspunkten, sobald die Bonuswertung feststeht
    const shown = new Map(totals);
    const final = last && data.tour.bonus_final;
    if (final) {
      const st = bonusStandings(data);
      for (const r of rows) shown.set(r.id, shown.get(r.id)! + bonusScoresFor(data, r.id, st).reduce((a, b) => a + b.points, 0));
    }
    const ranks = rankOf(shown);
    const sorted = [...rows].sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)! || a.name.localeCompare(b.name, 'de'));
    const leaders = sorted.filter((r) => ranks.get(r.id) === 1).map((r) => r.id);
    const top = shown.get(leaders[0])!;
    const chasers = sorted.filter((r) => ranks.get(r.id) === leaders.length + 1);
    const second = chasers[0];
    const margin = leaders.length === 1 && second ? top - shown.get(second.id)! : 0;

    // der Tag: beste Punkte, Treffer, Außenseiter, vergessene Tipps
    const dayBest = Math.max(...day.values());
    const dayWinners = dayBest > 0 ? rows.filter((r) => day.get(r.id) === dayBest).map((r) => r.id) : [];
    const winnerRiderId = data.results.find((r) => r.stage_id === stage.id && r.position === 1)?.rider_id ?? null;
    const winnerRider = riderName(winnerRiderId);
    const hitters = scores.filter((s) => s.position === 1).map((s) => s.userId);
    const underdog = scores.find((s) => s.bonus > 0);
    const forgot = rows.filter((r) => !tipped.has(r.id)).map((r) => r.id);
    const tippedRiders = new Set(scores.map((s) => s.riderId));
    const allSame = tipped.size >= 3 && tippedRiders.size === 1 ? [...tippedRiders][0] : null;

    // Serien und Bestwerte
    if (leaders.length === 1 && prevLeaders.length === 1 && prevLeaders[0] === leaders[0]) leadStreak += 1;
    else leadStreak = 1;
    const dayWinner = dayWinners.length === 1 ? dayWinners[0] : null;
    if (dayWinner && dayWinner === prevDayWinner) dayStreak += 1;
    else dayStreak = dayWinner ? 1 : 0;
    const bestNow: string[] = [];
    for (const r of rows) {
      const d = day.get(r.id)!;
      if (idx >= 3 && d >= 15 && d > best.get(r.id)! && !dayWinners.includes(r.id)) bestNow.push(r.id);
      best.set(r.id, Math.max(best.get(r.id)!, d));
      zeroRun.set(r.id, d > 0 ? 0 : zeroRun.get(r.id)! + 1);
    }

    // ---------- Überschrift
    const t: T = {
      L: name(leaders[0]), Ls: list(leaders.map(name)), O: list(prevLeaders.map(name)), S: second?.name ?? '',
      m: margin, r: 0, k: leadStreak, n: stage.number, tour: data.tour.short_name || data.tour.name,
    };
    const half = lastNumber >= 6 && stage.number === Math.ceil(lastNumber / 2);
    const eve = lastNumber >= 3 && stage.number === lastNumber - 1;
    let kind: RoundKind;
    let title: string;
    let saysNobody = false;
    if (top === 0) { kind = 'none'; title = P.pick('none', TITLE.none, t); saysNobody = true; }
    else if (final) { kind = 'final'; title = leaders.length > 1 ? P.pick('finalTie', TITLE.finalTie, t) : P.pick('final', TITLE.final, t); }
    else if (last) { kind = 'open'; title = leaders.length > 1 ? P.pick('openTie', TITLE.openTie, t) : P.pick('open', TITLE.open, t); }
    else if (!prevRanks) { kind = 'start'; title = leaders.length > 1 ? P.pick('startTie', TITLE.startTie, t) : P.pick('start', TITLE.start, t); }
    else if (leaders.length > 1) {
      kind = 'tie';
      const wasLeader = prevLeaders.length === 1 && leaders.includes(prevLeaders[0]) ? prevLeaders[0] : null;
      if (prevLeaders.length > 1 && leaders.length === prevLeaders.length && leaders.every((id) => prevLeaders.includes(id))) title = P.pick('tieKeep', TITLE.tieKeep, t);
      else if (wasLeader && leaders.length === 2) title = P.pick('catchUp', TITLE.catchUp, { ...t, L: name(wasLeader), S: name(leaders.find((id) => id !== wasLeader)!) });
      else title = P.pick('tieNew', TITLE.tieNew, t);
    } else if (!prevLeaders.includes(leaders[0])) {
      kind = 'change';
      const from = prevRanks.get(leaders[0]) ?? 1;
      title = from >= 3 ? P.pick('comeback', TITLE.comeback, { ...t, r: from }) : P.pick('change', TITLE.change, t);
    } else if (prevLeaders.length > 1) {
      kind = 'change';
      title = P.pick('untie', TITLE.untie, t);
    } else {
      kind = 'lead';
      const grew = prevMargin === null ? null : margin - prevMargin;
      const lone = !!second;
      if (dayBest === 0) { title = P.pick('still', TITLE.still, t); saysNobody = true; }
      else if (day.get(leaders[0]) === 0) title = P.pick('zero', TITLE.zero, t);
      else if (eve && lone) title = P.pick('eve', TITLE.eve, t);
      else if (margin <= 2 && lone) title = P.pick('razor', TITLE.razor, t);
      else if (half) title = P.pick('half', TITLE.half, t);
      else if (leadStreak >= 5 && leadStreak % 4 === 1) title = P.pick('streak', TITLE.streak, t);
      else if (lone && margin >= 25 && grew !== null && grew > 0) title = P.pick('dominate', TITLE.dominate, t);
      else if (lone && grew !== null && grew >= 5) title = P.pick('extend', TITLE.extend, t);
      else if (lone && grew !== null && grew <= -3) title = P.pick('shrink', TITLE.shrink, t);
      else title = P.pick('defend', TITLE.defend, t);
    }
    /** die Überschrift nennt den Abstand schon */
    const saysGap = /Punkt(e|en)? (vorn|vor |Vorsprung|Polster)|führt mit/.test(title);

    // ---------- Sätze (wichtigste zuerst, höchstens drei)
    const facts: string[] = [];
    const f = (key: string, c: Partial<F>) => { if (facts.length < 3) facts.push(P.pick(key, FACT[key], c as F)); };
    const R = winnerRider ?? '';
    if (tipped.size === 0) f('noTips', { n: stage.number });
    else if (allSame !== null) {
      const pos = data.results.find((r) => r.stage_id === stage.id && r.rider_id === allSame)?.position ?? null;
      const same = riderName(allSame) ?? 'denselben Fahrer';
      if (pos === 1) f('sameWin', { R: same });
      else if (dayBest > 0 && pos !== null) f('same', { R: same, pos });
      else f('sameZero', { R: same });
    } else {
      if (underdog && winnerRider) f('underdog', { R, U: name(underdog.userId), b: underdog.bonus });
      // Tagesbeste sind genau die, die den Etappensieger hatten: ein Satz statt zwei
      const hitDay = !underdog && winnerRider && hitters.length > 0 && dayStreak < 2
        && hitters.length === dayWinners.length && hitters.every((id) => dayWinners.includes(id));
      if (dayBest === 0) { if (!saysNobody) f('nobody', {}); }
      else if (hitDay) f(hitters.length > 3 ? 'dayHitMany' : 'dayHit', { R, H: list(hitters.map(name)), hn: hitters.length, p: dayBest });
      else if (kind === 'start') { /* am ersten Tag sind Tagesbeste und Spitze dasselbe */ }
      else if (underdog && underdog.userId === dayWinner) { /* der Außenseiter-Satz nennt den Tag schon */ }
      else if (dayWinners.length >= 4) f('dayMany', { k: dayWinners.length, p: dayBest });
      else if (dayWinners.length > 1) f('dayTie', { Ds: list(dayWinners.map(name)), p: dayBest });
      else if (dayStreak >= 2) f('series', { D: name(dayWinner!), k: dayStreak });
      else f('day', { D: name(dayWinner!), p: dayBest });
      if (!underdog && winnerRider && !hitDay) {
        if (hitters.length > 3) f('hitMany', { R, hn: hitters.length });
        else if (hitters.length) f('hit', { R, H: list(hitters.map(name)), hn: hitters.length });
        else f('miss', { R });
      }
    }
    if (kind === 'final' && leaders.length === 1) {
      const stageRanks = rankOf(totals);
      const stageLeaders = rows.filter((r) => stageRanks.get(r.id) === 1).map((r) => r.id);
      if (!stageLeaders.includes(leaders[0])) f('bonusSwing', { S: list(stageLeaders.map(name)) });
      else if (data.bonusTips.length && facts.length < 2) f('bonusHold', {});
      if (sorted.length >= 3) {
        const [, b, c] = sorted;
        f('podium', { S: b.name, t2: shown.get(b.id)!, T3: c.name, t3: shown.get(c.id)! });
      }
    }
    if ((kind === 'start' || kind === 'change' || kind === 'lead') && !saysGap && leaders.length === 1 && second && margin > 0) {
      if (chasers.length > 1) f('gapMany', { S: list(chasers.slice(0, 3).map((r) => r.name)), p: margin });
      else f('gap', { S: second.name, p: margin });
    }
    if (prevRanks && kind !== 'final') {
      const pr = prevRanks;
      const moves = rows
        .map((r) => ({ id: r.id, d: pr.get(r.id)! - ranks.get(r.id)! }))
        .filter((x) => !(leaders.includes(x.id) && (kind === 'change' || kind === 'tie')));
      const up = moves.filter((x) => x.d >= 2).sort((a, b) => b.d - a.d)[0];
      const down = moves.filter((x) => x.d <= -2).sort((a, b) => a.d - b.d)[0];
      if (up) f('jump', { J: name(up.id), k: up.d, r: ranks.get(up.id)! });
      else if (down && facts.length < 2) f('fall', { J: name(down.id), k: -down.d, r: ranks.get(down.id)! });
    }
    if (forgot.length && tipped.size > 0) {
      if (forgot.length > 3) f('forgotMany', { xn: forgot.length });
      else f('forgot', { X: list(forgot.map(name)), xn: forgot.length });
    }
    const dry = rows.filter((r) => zeroRun.get(r.id)! >= 3 && tipped.has(r.id)).sort((a, b) => zeroRun.get(b.id)! - zeroRun.get(a.id)!)[0];
    if (dry && dayBest > 0 && zeroRun.get(dry.id)! % 2 === 1) f('drought', { X: dry.name, k: zeroRun.get(dry.id)! });
    if (bestNow.length) f('best', { X: name(bestNow[0]), p: day.get(bestNow[0])! });
    const lastRow = sorted[sorted.length - 1];
    const lantern = sorted.length >= 4 && ranks.get(lastRow.id)! > ranks.get(sorted[sorted.length - 2].id)! ? lastRow.id : null;
    if (lantern && prevLantern && lantern !== prevLantern && kind !== 'final') f('lantern', { X: name(lantern) });

    const table = sorted.filter((r) => ranks.get(r.id)! <= 3).map((r) => ({
      userId: r.id, name: r.name, color: r.color, rank: ranks.get(r.id)!, total: shown.get(r.id)!,
      move: prevRanks ? prevRanks.get(r.id)! - ranks.get(r.id)! : null, day: day.get(r.id)!,
    }));
    out.push({ id: `round:${data.tour.id}:${stage.number}`, stageId: stage.id, stageNumber: stage.number, at: resultTime(stage, now), kind, title: title.replace(/ – /g, '\u00a0– '), text: facts.join(' '), table });

    prevRanks = ranks;
    prevLeaders = leaders;
    prevMargin = leaders.length === 1 ? margin : null;
    prevDayWinner = dayWinner;
    prevLantern = lantern;
  });
  return out.reverse();
}
