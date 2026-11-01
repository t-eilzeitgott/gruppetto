/**
 * Embleme fürs eigene Profil: Medaillen (Gold, Silber, Bronze) für die Plätze der Tipprunde ab dem Giro 2026 und
 * Abzeichen für besondere Leistungen – Serien, Trikots, Treffer, Außenseiter, ganze Saisons.
 *
 * Der Katalog bleibt verborgen: das Profil zeigt nur, was man schon hat. Alles wird aus den Tipps und Ergebnissen
 * berechnet (keine eigene Tabelle) – auf jedem Gerät dasselbe, rückwirkend für alle gespielten Rundfahrten.
 * Jedes Emblem hat einen festen Schlüssel; daran merkt sich das Gerät, ob es schon verliehen (gezeigt) wurde.
 */
import { bonusScoresFor, bonusStandings, competitionRanks, scoreStage, type StageScore } from './scoring';
import type { Profile, Stage, Tour, TourData, TourTheme } from './types';

/** Embleme zählen ab dem Giro 2026 (der ersten Runde mit der App) */
export const EMBLEM_SINCE = '2026-10-01';

export type Shape = 'medal' | 'hex' | 'shield' | 'round' | 'star' | 'jersey';
export type Tone = 'gold' | 'silver' | 'bronze' | 'steel' | 'azure' | 'violet' | 'prism' | 'ember' | 'rosa' | 'jaune' | 'rojo' | 'leader';
export type Rarity = 'medaille' | 'klassisch' | 'selten' | 'episch' | 'legendaer';

export interface Look {
  shape: Shape;
  tone: Tone;
  /** Zeichen in der Mitte: Name eines Symbols oder kurzer Text („3“, „×2“) */
  glyph: string;
  /** Farbe des Bandes (Medaillen): Rundfahrt */
  ribbon?: TourTheme;
}

export interface Emblem {
  /** fester Schlüssel einer Verleihung (z. B. „gold:giro-2026“, „hattrick:giro-2026:9“) */
  key: string;
  /** Art des Emblems (gleiche Art = ein Fach in der Vitrine, mit Anzahl) */
  id: string;
  name: string;
  /** warum – konkret, mit Rundfahrt und Etappe */
  text: string;
  rarity: Rarity;
  look: Look;
  /** wann verdient (Ergebnis der Etappe bzw. Ende der Rundfahrt) */
  at: string;
  tour: { id: string; label: string; theme: TourTheme } | null;
}

// ------------------------------------------------------------------ Hilfen

const pts = (n: number) => (n === 1 ? '1 Punkt' : `${n} Punkte`);
/** „Giro 2026“ – auch wenn der Kurzname schon eine Jahreszahl trägt („Giro 26“) */
export const tourLabel = (t: Tour) => `${(t.short_name || t.name).replace(/\s*'?\d{2,4}$/, '')} ${t.year}`;
const resultAt = (s: Stage) => new Date(new Date(s.starts_at).getTime() + 6 * 3600e3).toISOString();

const JERSEY: Record<TourTheme, { name: string; tone: Tone }> = {
  giro: { name: 'Maglia Rosa', tone: 'rosa' },
  tour: { name: 'Maillot Jaune', tone: 'jaune' },
  vuelta: { name: 'Maillot Rojo', tone: 'rojo' },
  neutral: { name: 'Leadertrikot', tone: 'leader' },
};

function berlinHour(iso: string): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const part = new Intl.DateTimeFormat('de-DE', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Berlin' }).formatToParts(new Date(t)).find((p) => p.type === 'hour');
  const h = Number(part?.value);
  return Number.isFinite(h) ? h : null;
}

/** Ist die Rundfahrt vorbei und der Endstand (mit Bonuswertung) eingetragen? */
export function tourFinished(d: TourData): boolean {
  return d.stages.length > 0 && d.stages.every((s) => s.results_published) && d.tour.bonus_final;
}

interface TourRun {
  data: TourData;
  stages: Stage[];
  /** je Etappe: Punkte aller Mitglieder, Gesamtstand und Plätze danach */
  steps: { stage: Stage; scores: StageScore[]; day: Map<string, number>; ranks: Map<string, number>; best: number }[];
  participants: Set<string>;
  final: Map<string, number> | null;
  finalRanks: Map<string, number> | null;
}

function runTour(data: TourData, ids: string[]): TourRun {
  const stages = data.stages.filter((s) => s.results_published).sort((a, b) => a.number - b.number);
  const totals = new Map(ids.map((id) => [id, 0]));
  const participants = new Set<string>();
  const rank = (vals: Map<string, number>) => {
    const r = competitionRanks(ids, (id) => vals.get(id)!);
    return new Map(ids.map((id) => [id, r.get(id)!]));
  };
  const steps = stages.map((stage) => {
    const scores = scoreStage(stage, data.tips, data.results, data.scale).filter((s) => totals.has(s.userId));
    const day = new Map(ids.map((id) => [id, 0]));
    for (const s of scores) { day.set(s.userId, s.total); participants.add(s.userId); }
    for (const id of ids) totals.set(id, totals.get(id)! + day.get(id)!);
    return { stage, scores, day, ranks: rank(totals), best: Math.max(0, ...day.values()) };
  });
  let final: Map<string, number> | null = null;
  let finalRanks: Map<string, number> | null = null;
  if (tourFinished(data)) {
    const st = bonusStandings(data);
    final = new Map(ids.map((id) => [id, totals.get(id)! + bonusScoresFor(data, id, st).reduce((a, b) => a + b.points, 0)]));
    finalRanks = rank(final);
  }
  return { data, stages, steps, participants, final, finalRanks };
}

// ------------------------------------------------------------------ Verleihen

/**
 * Alle Embleme eines Mitglieds über alle Rundfahrten (ab EMBLEM_SINCE), älteste zuerst.
 * `datas`: geladene Rundfahrten (beliebige Reihenfolge), `members`: Mitglieder (für Plätze und Tagesbeste).
 */
export function emblemsFor(me: string, datas: TourData[], members: Profile[]): Emblem[] {
  const ids = members.filter((m) => m.is_member && m.display_name).map((m) => m.id);
  if (!ids.includes(me)) return [];
  const runs = datas
    .filter((d) => d.tour.start_date >= EMBLEM_SINCE)
    .sort((a, b) => a.tour.start_date.localeCompare(b.tour.start_date))
    .map((d) => runTour(d, ids));

  const out: Emblem[] = [];
  const add = (e: Omit<Emblem, 'at'> & { at: string }) => { if (!out.some((x) => x.key === e.key)) out.push(e); };
  const tourRef = (t: Tour) => ({ id: t.id, label: tourLabel(t), theme: t.theme });

  // über alle Rundfahrten mitgezählt
  let tipped = 0;
  let winners = 0;
  let underdogs = 0;
  let firstNight = false;
  let firstEarly = false;
  let firstLate = false;
  const joined: { tour: Tour; at: string }[] = [];
  const podiums: { tour: Tour; place: number; at: string }[] = [];
  const wins: { tour: Tour; at: string }[] = [];

  for (const run of runs) {
    const { data, steps } = run;
    const tour = data.tour;
    const T = tourRef(tour);
    const L = tourLabel(tour);
    let tourWinners = 0;
    let bestStreak = 0;
    let soleLead = 0;
    let lastHit = -2;
    let dry = 0;
    let scoredHere = false;
    let joinedHere = false;

    steps.forEach((step, i) => {
      const { stage, scores, day, ranks, best } = step;
      const at = resultAt(stage);
      const E = `Etappe ${stage.number}`;
      const mine = scores.find((s) => s.userId === me);
      const myDay = day.get(me)!;

      if (mine) {
        tipped += 1;
        if (!joinedHere) { joinedHere = true; joined.push({ tour, at }); }
        if (tipped === 1) {
          add({ key: 'start', id: 'start', name: 'Im Gruppetto', text: `Dein erster Tipp mit Ergebnis: ${L}, ${E}. Willkommen im Gruppetto.`, rarity: 'klassisch', look: { shape: 'round', tone: 'steel', glyph: 'bike' }, at, tour: T });
        }
        // Etappensieger getippt
        if (mine.position === 1) {
          winners += 1;
          tourWinners += 1;
          if (winners === 1) add({ key: 'treffer', id: 'treffer', name: 'Volltreffer', text: `Zum ersten Mal den Etappensieger getippt: ${L}, ${E}.`, rarity: 'klassisch', look: { shape: 'hex', tone: 'steel', glyph: 'target' }, at, tour: T });
          if (winners === 10) add({ key: 'instinkt', id: 'instinkt', name: 'Siegerinstinkt', text: `Zehn Etappensieger richtig getippt – der zehnte: ${L}, ${E}.`, rarity: 'episch', look: { shape: 'star', tone: 'violet', glyph: '10' }, at, tour: T });
          if (tourWinners === 5) add({ key: `zielwasser:${tour.id}`, id: 'zielwasser', name: 'Zielwasser', text: `Fünf Etappensieger in einer Rundfahrt getippt: ${L}, der fünfte auf ${E}.`, rarity: 'selten', look: { shape: 'hex', tone: 'azure', glyph: 'crosshair' }, at, tour: T });
          if (lastHit === i - 1) add({ key: `doppel:${tour.id}:${stage.number}`, id: 'doppel', name: 'Doppelschlag', text: `Zwei Etappensieger hintereinander getippt: ${L}, Etappen ${steps[i - 1].stage.number} und ${stage.number}.`, rarity: 'selten', look: { shape: 'hex', tone: 'azure', glyph: '×2' }, at, tour: T });
          lastHit = i;
        }
        // Außenseiter-Bonus
        if (mine.bonus > 0) {
          underdogs += 1;
          if (underdogs === 1) add({ key: 'aussenseiter', id: 'aussenseiter', name: 'Außenseiter-Coup', text: `Als Einzige(r) auf den Etappensieger gesetzt: ${L}, ${E} – ${pts(mine.bonus)} Bonus.`, rarity: 'selten', look: { shape: 'round', tone: 'azure', glyph: 'dice' }, at, tour: T });
          if (underdogs === 3) add({ key: 'riecher', id: 'riecher', name: 'Goldener Riecher', text: `Dreimal als Einzige(r) den Sieger getippt – zuletzt ${L}, ${E}.`, rarity: 'episch', look: { shape: 'star', tone: 'violet', glyph: 'sparkle' }, at, tour: T });
        }
        if (mine.total >= 25) add({ key: `jackpot:${tour.id}:${stage.number}`, id: 'jackpot', name: 'Jackpot', text: `${pts(mine.total)} an einem Tag: ${L}, ${E}.`, rarity: 'episch', look: { shape: 'star', tone: 'violet', glyph: 'diamond' }, at, tour: T });
        // eigener Kopf: niemand sonst auf diesem Fahrer, Platz zwei oder drei (den Sieger deckt der Außenseiter-Coup ab)
        if (mine.total >= 10 && mine.position !== 1 && scores.filter((s) => s.riderId === mine.riderId).length === 1 && scores.length >= 3) {
          add({ key: `kopf:${tour.id}:${stage.number}`, id: 'kopf', name: 'Eigener Kopf', text: `Als Einzige(r) auf diesen Fahrer gesetzt und ${pts(mine.total)} geholt: ${L}, ${E}.`, rarity: 'selten', look: { shape: 'round', tone: 'azure', glyph: 'bulb' }, at, tour: T });
        }
        // Zeitpunkt des Tipps
        const tip = data.tips.find((t) => t.stage_id === stage.id && t.user_id === me);
        const saved = tip ? Date.parse(tip.updated_at) : NaN;
        if (Number.isFinite(saved)) {
          const before = Date.parse(stage.starts_at) - saved;
          if (!firstLate && before >= 0 && before <= 3 * 60e3 && mine.total > 0) {
            firstLate = true;
            add({ key: 'drucker', id: 'drucker', name: 'Auf den letzten Drücker', text: `Tipp in den letzten drei Minuten vor dem Start – und gepunktet: ${L}, ${E}.`, rarity: 'klassisch', look: { shape: 'round', tone: 'steel', glyph: 'hourglass' }, at, tour: T });
          }
          if (!firstEarly && before >= 3 * 864e5 && mine.position !== null && mine.position <= 3) {
            firstEarly = true;
            add({ key: 'vogel', id: 'vogel', name: 'Früher Vogel', text: `Tipp mehr als drei Tage vor dem Start – und aufs Podium: ${L}, ${E}.`, rarity: 'klassisch', look: { shape: 'round', tone: 'steel', glyph: 'sunrise' }, at, tour: T });
          }
          const h = berlinHour(tip!.updated_at);
          if (!firstNight && h !== null && h < 4) {
            firstNight = true;
            add({ key: 'eule', id: 'eule', name: 'Nachteule', text: `Getippt mitten in der Nacht: ${L}, ${E}.`, rarity: 'klassisch', look: { shape: 'round', tone: 'steel', glyph: 'moon' }, at, tour: T });
          }
        }
      }

      // nach einer Durststrecke wieder gepunktet
      // nur „wieder“, wenn man in dieser Rundfahrt schon einmal gepunktet hatte (nicht beim späten Einstieg)
      if (myDay > 0 && dry >= 4 && scoredHere) add({ key: `wieder:${tour.id}:${stage.number}`, id: 'wieder', name: 'Wieder da', text: `Nach ${dry} Etappen ohne Punkte wieder gepunktet: ${L}, ${E}.`, rarity: 'klassisch', look: { shape: 'round', tone: 'steel', glyph: 'refresh' }, at, tour: T });
      dry = myDay > 0 ? 0 : dry + 1;
      if (myDay > 0) scoredHere = true;

      // Tagesbeste (auch geteilt)
      const dayBest = best > 0 && myDay === best;
      bestStreak = dayBest ? bestStreak + 1 : 0;
      if (dayBest) {
        add({ key: `tagessieg:${tour.id}:${stage.number}`, id: 'tagessieg', name: 'Tagessieg', text: `Die meisten Punkte der Runde an einem Tag: ${L}, ${E} mit ${pts(myDay)}.`, rarity: 'klassisch', look: { shape: 'hex', tone: 'steel', glyph: 'star' }, at, tour: T });
        if (bestStreak === 3) add({ key: `hattrick:${tour.id}:${stage.number}`, id: 'hattrick', name: 'Hattrick', text: `Dreimal hintereinander die meisten Punkte der Runde: ${L}, Etappen ${steps[i - 2].stage.number}–${stage.number}.`, rarity: 'episch', look: { shape: 'star', tone: 'violet', glyph: '3' }, at, tour: T });
        if (bestStreak === 5) add({ key: `unaufhaltsam:${tour.id}:${stage.number}`, id: 'unaufhaltsam', name: 'Unaufhaltsam', text: `Fünfmal hintereinander die meisten Punkte der Runde: ${L}, Etappen ${steps[i - 4].stage.number}–${stage.number}.`, rarity: 'legendaer', look: { shape: 'star', tone: 'prism', glyph: '5' }, at, tour: T });
      }

      // Führung
      const rank = ranks.get(me)!;
      const lead = rank === 1 && totalsPositive(steps, i, me);
      const sole = lead && [...ranks.values()].filter((r) => r === 1).length === 1;
      if (lead) {
        const j = JERSEY[tour.theme];
        add({ key: `trikot:${tour.id}`, id: `trikot-${tour.theme}`, name: j.name, text: `An der Spitze der Tipprunde: ${L}, zum ersten Mal nach ${E}.`, rarity: 'selten', look: { shape: 'jersey', tone: j.tone, glyph: '' }, at, tour: T });
      }
      soleLead = sole ? soleLead + 1 : 0;
      if (soleLead === 5) {
        const j = JERSEY[tour.theme];
        add({ key: `trikot5:${tour.id}`, id: 'trikot5', name: 'Trikotverteidigung', text: `Fünf Etappen am Stück allein vorn: ${L}, bis ${E}.`, rarity: 'episch', look: { shape: 'jersey', tone: j.tone, glyph: '5' }, at, tour: T });
      }
      // Sprung nach vorn
      if (i > 0) {
        const gained = steps[i - 1].ranks.get(me)! - rank;
        if (gained >= 5 && myDay > 0) add({ key: `ueberholspur:${tour.id}:${stage.number}`, id: 'ueberholspur', name: 'Überholspur', text: `${gained} Plätze an einem Tag gutgemacht: ${L}, ${E}, jetzt Platz ${rank}.`, rarity: 'klassisch', look: { shape: 'hex', tone: 'steel', glyph: 'chevronsUp' }, at, tour: T });
      }
    });

    // ---------- Ende der Rundfahrt
    if (!run.final || !run.finalRanks || !run.participants.has(me)) continue;
    const last = steps[steps.length - 1];
    const at = resultAt(last.stage);
    const place = run.finalRanks.get(me)!;
    const total = run.final.get(me)!;
    const shared = [...run.finalRanks.values()].filter((r) => r === place).length > 1;
    const MEDAL = { 1: ['gold', 'Gold'], 2: ['silver', 'Silber'], 3: ['bronze', 'Bronze'] } as const;
    if (place <= 3) {
      const [tone, word] = MEDAL[place as 1 | 2 | 3];
      add({
        key: `${tone}:${tour.id}`, id: `medaille:${tour.id}`, name: `${word} · ${L}`,
        text: `Platz ${place}${shared ? ' (geteilt)' : ''} in der Tipprunde ${L} mit ${pts(total)}.`,
        rarity: 'medaille', look: { shape: 'medal', tone, glyph: String(place), ribbon: tour.theme }, at, tour: T,
      });
      podiums.push({ tour, place, at });
      if (place === 1) wins.push({ tour, at });
    }
    if (place === 1 && !shared) {
      const second = Math.max(...[...run.final.entries()].filter(([id]) => id !== me).map(([, v]) => v), 0);
      if (total - second <= 3) add({ key: `fotofinish:${tour.id}`, id: 'fotofinish', name: 'Fotofinish', text: `Gesamtsieg mit nur ${pts(total - second)} Vorsprung: ${L}.`, rarity: 'episch', look: { shape: 'shield', tone: 'violet', glyph: 'camera' }, at, tour: T });
      if (steps.every((s) => s.ranks.get(me) === 1 && [...s.ranks.values()].filter((r) => r === 1).length === 1)) {
        add({ key: `startziel:${tour.id}`, id: 'startziel', name: 'Start-Ziel-Sieg', text: `Nach jeder Etappe allein vorn und am Ende gewonnen: ${L}.`, rarity: 'legendaer', look: { shape: 'shield', tone: 'prism', glyph: 'flag' }, at, tour: T });
      }
      const half = steps[Math.ceil(steps.length / 2) - 1];
      if (half && half.ranks.get(me)! >= 5) add({ key: `aufholjagd:${tour.id}`, id: 'aufholjagd', name: 'Aufholjagd', text: `Zur Halbzeit nur Platz ${half.ranks.get(me)}, am Ende ganz vorn: ${L}.`, rarity: 'episch', look: { shape: 'shield', tone: 'violet', glyph: 'trendUp' }, at, tour: T });
    }
    // rote Laterne: Letzte(r) unter allen, die mitgetippt haben (ab vier)
    const players = [...run.participants];
    if (players.length >= 4) {
      const worst = Math.max(...players.map((id) => run.finalRanks!.get(id)!));
      if (place === worst && players.filter((id) => run.finalRanks!.get(id) === worst).length === 1) {
        add({ key: `laterne:${tour.id}`, id: 'laterne', name: 'Lanterne Rouge', text: `Letzter Platz in der Tipprunde ${L} – angekommen ist angekommen.`, rarity: 'klassisch', look: { shape: 'round', tone: 'ember', glyph: 'lantern' }, at, tour: T });
      }
    }
    // jede Etappe getippt / in jeder Etappe gepunktet
    const allStages = data.stages.length === steps.length && steps.length >= 5;
    if (allStages && steps.every((s) => s.scores.some((x) => x.userId === me))) {
      add({ key: `lueckenlos:${tour.id}`, id: 'lueckenlos', name: 'Lückenlos', text: `Alle ${steps.length} Etappen getippt: ${L}.`, rarity: 'selten', look: { shape: 'shield', tone: 'azure', glyph: 'calendarCheck' }, at, tour: T });
      if (steps.every((s) => s.day.get(me)! > 0)) add({ key: `punkte:${tour.id}`, id: 'punkte', name: 'Immer in den Punkten', text: `Auf jeder einzelnen Etappe gepunktet: ${L}.`, rarity: 'legendaer', look: { shape: 'shield', tone: 'prism', glyph: 'sparkle' }, at, tour: T });
    }
    // Spezialist: die meisten Punkte auf Bergetappen, Flachetappen, Zeitfahren
    const spec = (kinds: string[], min: number, key: string, name: string, glyph: string, what: string) => {
      const part = steps.filter((s) => kinds.includes(s.stage.kind));
      if (part.length < min) return;
      const sum = (id: string) => part.reduce((a, s) => a + s.day.get(id)!, 0);
      const mineSum = sum(me);
      if (mineSum > 0 && ids.every((id) => sum(id) <= mineSum)) add({ key: `${key}:${tour.id}`, id: key, name, text: `Die meisten Punkte auf ${what}: ${L}, ${pts(mineSum)}.`, rarity: 'selten', look: { shape: 'hex', tone: 'azure', glyph }, at, tour: T });
    };
    spec(['mountain'], 3, 'bergfloh', 'Bergfloh', 'mountain', 'den Bergetappen');
    spec(['flat'], 3, 'sprintkrone', 'Sprintkrone', 'zap', 'den Flachetappen');
    spec(['itt', 'ttt'], 2, 'uhrwerk', 'Uhrwerk', 'stopwatch', 'den Zeitfahren');
    // Schlussetappe allein gewonnen
    if (last.best > 0 && last.day.get(me) === last.best && [...last.day.values()].filter((v) => v === last.best).length === 1) {
      add({ key: `schluss:${tour.id}`, id: 'schluss', name: 'Schlussakkord', text: `Allein die meisten Punkte auf der letzten Etappe: ${L}.`, rarity: 'selten', look: { shape: 'hex', tone: 'azure', glyph: 'flag' }, at, tour: T });
    }
    // Bonuswertung
    const bonus = bonusScoresFor(data, me);
    if (bonus.some((b) => b.category === 'gc' && b.position === 1)) add({ key: `glaskugel:${tour.id}`, id: 'glaskugel', name: 'Glaskugel', text: `Den Gesamtsieger schon vor dem Start richtig getippt: ${L}.`, rarity: 'selten', look: { shape: 'round', tone: 'azure', glyph: 'orb' }, at, tour: T });
    const scored = bonus.filter((b) => b.points > 0).length;
    if (scored >= 5) add({ key: `kaffeesatz:${tour.id}`, id: 'kaffeesatz', name: 'Kaffeesatz', text: `In ${scored} Bonuswertungen gepunktet: ${L}, ${pts(bonus.reduce((a, b) => a + b.points, 0))}.`, rarity: 'episch', look: { shape: 'round', tone: 'violet', glyph: 'cup' }, at, tour: T });
  }

  // ---------- über Rundfahrten hinweg
  if (joined.length >= 3) {
    const j = joined[2];
    add({ key: 'stammgast', id: 'stammgast', name: 'Stammgast', text: `Bei drei Rundfahrten dabei – die dritte: ${tourLabel(j.tour)}.`, rarity: 'selten', look: { shape: 'round', tone: 'azure', glyph: 'ticket' }, at: j.at, tour: tourRef(j.tour) });
  }
  const byYear = new Map<number, { tour: Tour; at: string }[]>();
  for (const j of joined) byYear.set(j.tour.year, [...(byYear.get(j.tour.year) ?? []), j]);
  for (const [year, list] of byYear) {
    const themes = new Set(list.map((x) => x.tour.theme));
    if (themes.has('giro') && themes.has('tour') && themes.has('vuelta')) {
      const third = list.find((x) => x.tour.theme === 'vuelta') ?? list[list.length - 1];
      add({ key: `saison:${year}`, id: 'saison', name: `Saisonkarte ${year}`, text: `Giro, Tour und Vuelta ${year} mitgetippt.`, rarity: 'episch', look: { shape: 'shield', tone: 'violet', glyph: String(year).slice(2) }, at: third.at, tour: null });
    }
  }
  if (podiums.length >= 3) {
    const p = podiums[2];
    add({ key: 'treppchen', id: 'treppchen', name: 'Treppchen-Abo', text: `Dreimal auf dem Podium der Tipprunde – zuletzt ${tourLabel(p.tour)}.`, rarity: 'episch', look: { shape: 'star', tone: 'violet', glyph: 'podium' }, at: p.at, tour: tourRef(p.tour) });
  }
  // Titel verteidigt: zwei abgeschlossene Rundfahrten hintereinander gewonnen
  const finished = runs.filter((r) => r.finalRanks);
  for (let i = 1; i < finished.length; i++) {
    const a = finished[i - 1];
    const b = finished[i];
    if (a.finalRanks!.get(me) === 1 && b.finalRanks!.get(me) === 1 && a.participants.has(me) && b.participants.has(me)) {
      const w = wins.find((x) => x.tour.id === b.data.tour.id)!;
      add({ key: `titel:${b.data.tour.id}`, id: 'titel', name: 'Titelverteidigung', text: `Zwei Rundfahrten hintereinander gewonnen: ${tourLabel(a.data.tour)} und ${tourLabel(b.data.tour)}.`, rarity: 'legendaer', look: { shape: 'shield', tone: 'prism', glyph: 'crown' }, at: w.at, tour: tourRef(b.data.tour) });
    }
  }
  const winYears = new Map<number, Set<TourTheme>>();
  for (const w of wins) winYears.set(w.tour.year, new Set([...(winYears.get(w.tour.year) ?? []), w.tour.theme]));
  for (const [year, themes] of winYears) {
    if (themes.has('giro') && themes.has('tour') && themes.has('vuelta')) {
      const w = wins.filter((x) => x.tour.year === year).sort((a, b) => a.at.localeCompare(b.at)).pop()!;
      add({ key: `triple:${year}`, id: 'triple', name: `Grand-Tour-Triple ${year}`, text: `Giro, Tour und Vuelta ${year} gewonnen. Mehr geht nicht.`, rarity: 'legendaer', look: { shape: 'star', tone: 'prism', glyph: 'crown' }, at: w.at, tour: null });
    }
  }

  return out.sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
}

/** Spitze zählt erst, wenn man schon Punkte hat (nicht alle punktgleich bei null) */
function totalsPositive(steps: TourRun['steps'], i: number, me: string): boolean {
  let t = 0;
  for (let k = 0; k <= i; k++) t += steps[k].day.get(me)!;
  return t > 0;
}

// ------------------------------------------------------------------ Vitrine

export interface ShelfItem {
  /** Fach: Art des Emblems (Medaillen: je Rundfahrt eines) */
  id: string;
  /** das zuletzt verdiente – zeigt Bild und Namen */
  latest: Emblem;
  all: Emblem[];
}

const RARITY_ORDER: Record<Rarity, number> = { medaille: 0, legendaer: 1, episch: 2, selten: 3, klassisch: 4 };
const MEDAL_ORDER: Record<string, number> = { gold: 0, silver: 1, bronze: 2 };

/** Vitrine: Medaillen zuerst (Gold, Silber, Bronze, neueste zuerst), dann Abzeichen nach Seltenheit */
export function shelf(list: Emblem[]): { medals: ShelfItem[]; badges: ShelfItem[]; count: { gold: number; silver: number; bronze: number } } {
  const groups = new Map<string, Emblem[]>();
  for (const e of list) {
    const k = e.rarity === 'medaille' ? e.key : e.id;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const items: ShelfItem[] = [...groups.entries()].map(([id, all]) => ({ id, all, latest: all[all.length - 1] }));
  const medals = items.filter((i) => i.latest.rarity === 'medaille')
    .sort((a, b) => MEDAL_ORDER[a.latest.look.tone] - MEDAL_ORDER[b.latest.look.tone] || b.latest.at.localeCompare(a.latest.at));
  const badges = items.filter((i) => i.latest.rarity !== 'medaille')
    .sort((a, b) => RARITY_ORDER[a.latest.rarity] - RARITY_ORDER[b.latest.rarity] || b.latest.at.localeCompare(a.latest.at));
  const count = { gold: 0, silver: 0, bronze: 0 };
  for (const m of medals) count[m.latest.look.tone as 'gold' | 'silver' | 'bronze'] += 1;
  return { medals, badges, count };
}

export const RARITY_LABEL: Record<Rarity, string> = {
  medaille: 'Medaille', klassisch: 'Emblem', selten: 'Selten', episch: 'Episch', legendaer: 'Legendär',
};
