import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Rider } from '../../src/lib/types.ts';
import { planBonus, planStartedStage, planUpcomingStage, type StartedStageInput, type StageSyncRow } from './plan.ts';
import { makeRiderMatcher, makeTeamMatcher } from './match.ts';
import { fixture, ridersFrom, stage, tour } from './testkit.ts';

// Tour de France 2018, Etappe 19: Start 12:15 Uhr, Siegerzeit 5:28:17 → Zielankunft gegen 17:43 Uhr
const pcs19 = fixture('tour-de-france-2018-stage-19');
const riders19 = ridersFrom(pcs19);
const id = (name: string) => riders19.find((r) => r.name === name)!.id;
const at = (hhmm: string) => new Date(`2018-07-27T${hhmm}:00+02:00`);

const base = (patch: Partial<StartedStageInput> = {}): StartedStageInput => ({
  now: at('18:00'),
  tour: tour(),
  stage: stage(),
  riders: riders19.map((r) => ({ ...r })),
  results: [],
  standings: [],
  sync: null,
  pcs: pcs19,
  url: 'https://www.procyclingstats.com/race/tour-de-france/2018/stage-19',
  options: { completeness: 0 }, // die Testseiten enthalten nur die ersten 12 Plätze
  ...patch,
});

const syncRow = (patch: Partial<StageSyncRow>): StageSyncRow => ({
  stage_id: 19, paused: false, paused_reason: null, checked_at: null, candidate: null, candidate_at: null,
  synced_at: null, status: null, source_url: null, last_error: null, ...patch,
});

test('Fahrerabgleich: Startnummer mit Namensprobe, Name in anderer Schreibweise, keine Verwechslung', () => {
  const riders: Rider[] = [
    { id: 1, tour_id: 't', bib: 166, name: 'Primoz Roglic', team: 'Jumbo', tip_limit: null, excluded_from_rest: false, status: 'active' },
    { id: 2, tour_id: 't', bib: 8, name: 'Mathieu van der Poel', team: 'Alpecin', tip_limit: null, excluded_from_rest: false, status: 'active' },
    { id: 3, tour_id: 't', bib: null, name: 'Geraint Thomas', team: 'Sky', tip_limit: null, excluded_from_rest: false, status: 'active' },
    { id: 4, tour_id: 't', bib: 31, name: 'Wout van Aert', team: 'Visma', tip_limit: null, excluded_from_rest: false, status: 'active' },
  ];
  const match = makeRiderMatcher(riders);
  assert.equal(match({ bib: 166, name: 'Primož Roglič' })?.id, 1);
  // Nr. 8 gehört in gruppetto jemand anderem → über den Namen finden, nicht über die Nummer
  assert.equal(match({ bib: 8, name: 'Geraint Thomas' })?.id, 3);
  // gemeinsamer Namenszusatz „van“ reicht nicht für die Startnummer
  assert.equal(match({ bib: 31, name: 'Mathieu van der Poel' })?.id, 2);
  assert.equal(match({ bib: 999, name: 'Unbekannter Fahrer' }), null);
  assert.equal(match({ bib: null, name: 'Roglič Primož', slug: 'primoz-roglic' })?.id, 1);

  const team = makeTeamMatcher(['Alpecin–Premier Tech', 'Team Bahrain Victorious', 'UAE Team Emirates XRG']);
  assert.equal(team('Alpecin - Premier Tech'), 'Alpecin–Premier Tech');
  assert.equal(team('Bahrain - Victorious'), 'Team Bahrain Victorious');
  assert.equal(team('INEOS Grenadiers'), null);
});

test('Vor der Zielankunft wird nichts übernommen', () => {
  const plan = planStartedStage(base({ now: at('16:30') }));
  assert.equal(plan.payload.results, undefined);
  assert.match(plan.payload.state.status, /Zielankunft \(17:48\)/);
});

test('Erst lesen, dann nach der Stabilitätsprüfung veröffentlichen (Automatik)', () => {
  const first = planStartedStage(base({ now: at('17:50') }));
  assert.equal(first.payload.results, undefined);
  assert.match(first.payload.state.status, /Prüfung bis 18:00/);
  assert.deepEqual(first.payload.state.candidate?.top.slice(0, 2), [id('Primož Roglič'), id('Geraint Thomas')]);

  const second = planStartedStage(base({
    now: at('18:01'),
    sync: syncRow({ candidate: first.payload.state.candidate!, candidate_at: first.payload.state.candidate_at! }),
  }));
  assert.equal(second.payload.publish, true);
  assert.equal(second.published, true);
  assert.equal(second.payload.results?.length, 10);
  assert.deepEqual(second.payload.results?.[0], { position: 1, rider_id: id('Primož Roglič') });
  assert.deepEqual(second.payload.out, [id('Jelle Vanendert')]);
  assert.equal(second.payload.standings?.gc?.[0].rider_id, id('Geraint Thomas'));
  assert.equal(second.payload.standings?.points?.[0].rider_id, id('Peter Sagan'));
  assert.ok(second.payload.logs.some((l) => l.level === 'change' && l.message === 'Etappe 19: Ergebnis veröffentlicht – 1. Primož Roglič, 2. Geraint Thomas, 3. Romain Bardet'));
  assert.ok(second.payload.logs.some((l) => l.message === 'Etappe 19: ausgestiegen – Jelle Vanendert'));
});

test('„sofort“ überspringt Zielankunft und Stabilität', () => {
  const plan = planStartedStage(base({ now: at('12:30'), options: { force: true, completeness: 0 } }));
  assert.equal(plan.payload.publish, true);
});

test('Gespeichertes, gleiches Ergebnis bleibt unberührt', () => {
  const first = planStartedStage(base({ options: { force: true, completeness: 0 } }));
  const results = first.payload.results!.map((r) => ({ stage_id: 19, ...r }));
  const standings = Object.entries(first.payload.standings!).flatMap(([category, rows]) =>
    rows!.map((r) => ({ stage_id: 19, category: category as 'gc', ...r })));
  const riders = riders19.map((r) => (r.id === id('Jelle Vanendert') ? { ...r, status: 'out' as const } : { ...r }));
  const again = planStartedStage(base({ stage: stage({ results_published: true }), results, standings, riders, options: { force: true, completeness: 0 } }));
  assert.equal(again.payload.results, undefined);
  assert.equal(again.payload.standings, undefined);
  assert.deepEqual(again.actions, ['unverändert']);
});

test('Nachträgliche Änderung (Jury): Automatik korrigiert, Vorschlagsmodus warnt nur', () => {
  // gespeichert: Thomas vor Roglič
  const results = [
    { stage_id: 19, position: 1, rider_id: id('Geraint Thomas') },
    { stage_id: 19, position: 2, rider_id: id('Primož Roglič') },
  ];
  const opts = { force: true, completeness: 0 };
  const auto = planStartedStage(base({ stage: stage({ results_published: true }), results, options: opts }));
  assert.equal(auto.payload.results?.[0].rider_id, id('Primož Roglič'));
  assert.ok(auto.payload.logs.some((l) => l.level === 'change' && /nachträglich geändert/.test(l.message)));

  const draft = planStartedStage(base({ tour: tour({ sync_mode: 'draft' }), stage: stage({ results_published: true }), results, options: opts }));
  assert.equal(draft.payload.results, undefined);
  assert.ok(draft.payload.logs.some((l) => l.level === 'warning' && /anderes Ergebnis/.test(l.message)));
});

test('Vorschlagsmodus trägt ein, veröffentlicht aber nicht', () => {
  const plan = planStartedStage(base({ tour: tour({ sync_mode: 'draft' }), options: { force: true, completeness: 0 } }));
  assert.equal(plan.payload.results?.length, 10);
  assert.equal(plan.payload.publish, undefined);
  assert.equal(plan.published, false);
  assert.match(plan.payload.state.status, /Vorschlag/);
});

test('Fahrer fehlt in der Startliste: kein Ergebnis, Fehler nur einmal melden', () => {
  const riders = riders19.filter((r) => r.name !== 'Romain Bardet');
  const plan = planStartedStage(base({ riders, options: { force: true, completeness: 0 } }));
  assert.equal(plan.payload.results, undefined);
  assert.equal(plan.newErrors, 1);
  const msg = plan.payload.logs[0].message;
  assert.match(msg, /Romain Bardet \(Nr\. 21\) nicht in der Startliste/);
  const again = planStartedStage(base({ riders, recent: new Set([msg]), options: { force: true, completeness: 0 } }));
  assert.equal(again.newErrors, 0);
  assert.equal(again.payload.logs.length, 0);
});

test('Unvollständiges Ergebnis (nur 13 von 40 Startern) wird nicht übernommen', () => {
  const extra: Rider[] = Array.from({ length: 30 }, (_, i) => ({
    id: 1000 + i, tour_id: 't', bib: 500 + i, name: `Fahrer ${i}`, team: 'X', tip_limit: null, excluded_from_rest: false, status: 'active',
  }));
  const plan = planStartedStage(base({ riders: [...riders19, ...extra], options: { force: true } }));
  assert.equal(plan.payload.results, undefined);
  assert.match(plan.payload.state.status, /unvollständig/);
});

test('Pausierte Etappe und Mannschaftszeitfahren werden nicht angefasst', () => {
  const paused = planStartedStage(base({ sync: syncRow({ paused: true, paused_reason: 'Ergebnis von Hand geändert' }) }));
  assert.equal(paused.payload.results, undefined);
  assert.equal(paused.payload.state.status, 'pausiert');

  const ttt = fixture('tour-de-france-2018-stage-3');
  const plan = planStartedStage(base({ pcs: ttt, riders: ridersFrom(ttt) }));
  assert.equal(plan.payload.results, undefined);
  assert.ok(plan.payload.logs.some((l) => /Mannschaftszeitfahren/.test(l.message)));
});

test('Bevorstehende Etappe: Distanz, fehlende Orte, früherer Start', () => {
  const now = at('08:00');
  const shortened = planUpcomingStage({ now, tour: tour(), stage: stage({ distance_km: 220 }), pcs: pcs19, url: '' });
  assert.equal(shortened.payload.stage?.distance_km, 200.5);
  assert.ok(shortened.payload.logs.some((l) => l.level === 'change' && /jetzt 200.5 km \(vorher 220 km\)/.test(l.message)));

  const same = planUpcomingStage({ now, tour: tour(), stage: stage({ distance_km: 201, departure: null }), pcs: pcs19, url: '' });
  assert.deepEqual(same.payload.stage, { departure: 'Lourdes' });

  // Tippschluss 12:30, Start laut PCS 12:15
  const early = planUpcomingStage({ now, tour: tour(), stage: stage({ starts_at: '2018-07-27T10:30:00Z' }), pcs: pcs19, url: '' });
  assert.ok(early.payload.logs.some((l) => l.level === 'warning' && /schon um 12:15 Uhr, Tippschluss ist 12:30/.test(l.message)));

  // anderes Datum in derselben Austragung
  const moved = planUpcomingStage({ now, tour: tour(), stage: stage({ starts_at: '2018-07-28T10:00:00Z' }), pcs: pcs19, url: '' });
  assert.ok(moved.payload.logs.some((l) => /laut PCS am 2018-07-27/.test(l.message)));

  // Generalprobe mit einer früheren Austragung: Datum/Startzeit nicht vergleichen
  const rehearsal = planUpcomingStage({ now, tour: tour({ year: 2027, start_date: '2027-05-08', end_date: '2027-05-30' }), stage: stage({ starts_at: '2027-05-20T10:30:00Z' }), pcs: pcs19, url: '' });
  assert.equal(rehearsal.payload.logs.length, 0);
});

test('Bonus-Zwischenstand aus den Wertungen, „Best of the Rest“ ohne Favoriten, Teams zugeordnet', () => {
  const pcs = fixture('tour-de-france-2022-stage-21');
  const riders = ridersFrom(pcs).map((r) => ({
    ...r,
    excluded_from_rest: r.name === 'Jonas Vingegaard' || r.name === 'Tadej Pogačar',
    team: r.team.replace(' - ', '–'),
  }));
  const rid = (name: string) => riders.find((r) => r.name === name)!.id;
  const { bonus, logs } = planBonus({ tour: tour(), stageNumber: 21, riders, current: [], pcs });
  assert.deepEqual(bonus?.gc?.map((b) => b.rider_id), [rid('Jonas Vingegaard'), rid('Tadej Pogačar'), rid('Geraint Thomas')]);
  assert.equal(bonus?.rest?.[0].rider_id, rid('Geraint Thomas'));
  assert.ok(!bonus?.rest?.some((b) => b.rider_id === rid('Tadej Pogačar')));
  assert.equal(bonus?.points?.[0].rider_id, rid('Wout van Aert'));
  assert.equal(bonus?.mountains?.[0].rider_id, rid('Jonas Vingegaard'));
  assert.equal(bonus?.youth?.[0].rider_id, rid('Tadej Pogačar'));
  assert.equal(bonus?.team?.[0].team, 'INEOS Grenadiers');
  assert.equal(logs.length, 0);

  // schon so gespeichert → nichts schreiben; Endstand gesetzt → nichts schreiben
  const current = Object.entries(bonus!).flatMap(([category, rows]) => rows!.map((r) => ({ tour_id: 't', category: category as 'gc', ...r })));
  assert.equal(planBonus({ tour: tour(), stageNumber: 21, riders, current, pcs }).bonus, undefined);
  assert.equal(planBonus({ tour: tour({ bonus_final: true }), stageNumber: 21, riders, current: [], pcs }).bonus, undefined);
});
