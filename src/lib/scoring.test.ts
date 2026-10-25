import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreStage, leaderboard, bonusStandings, bonusScoresFor, competitionRanks, jokerRemaining, DEFAULT_SCALE,
} from './scoring';
import type { Profile, Rider, Stage, StageResult, StageTip, TourData } from './types';

const stage = (id: number, number: number, published = true): Stage => ({
  id, tour_id: 't', number, starts_at: '2027-05-08T10:00:00Z', kind: 'flat',
  departure: null, arrival: null, distance_km: null, results_published: published,
});
const tip = (stage_id: number, user_id: string, rider_id: number): StageTip =>
  ({ stage_id, user_id, rider_id, updated_at: '' });
const res = (stage_id: number, ids: number[]): StageResult[] =>
  ids.map((rider_id, i) => ({ stage_id, position: i + 1, rider_id }));
const member = (id: string, name: string): Profile => ({
  id, display_name: name, avatar_color: '#000000', is_member: true, is_admin: false, is_pro: false, created_at: '',
});
const rider = (id: number, name: string, team = 'T', tip_limit: number | null = null): Rider => ({
  id, tour_id: 't', bib: id, name, team, tip_limit, excluded_from_rest: false, status: 'active',
});

test('Punkteskala 20/15/10/7…1, Platz 11 gibt 0', () => {
  const s = stage(1, 1);
  const results = res(1, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const tips = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((r) => tip(1, `u${r}`, r));
  const scores = scoreStage(s, tips, results, DEFAULT_SCALE);
  assert.deepEqual(scores.map((x) => x.base), [20, 15, 10, 7, 6, 5, 4, 3, 2, 1, 0]);
});

test('Außenseiter-Bonus nur, wenn man als Einziger den Sieger getippt hat', () => {
  const s = stage(1, 1);
  const results = res(1, [100, 200]);
  // Anna allein auf Sieger 100, drei Leute auf 200
  const tips = [tip(1, 'anna', 100), tip(1, 'ben', 200), tip(1, 'carl', 200), tip(1, 'dora', 200)];
  const scores = scoreStage(s, tips, results, DEFAULT_SCALE);
  assert.equal(scores.find((x) => x.userId === 'anna')!.total, 23);
  assert.equal(scores.find((x) => x.userId === 'ben')!.total, 15);
});

test('Außenseiter-Bonus = Tipps auf den Favoriten (4× Milan, allein Merlier → 24)', () => {
  const s = stage(1, 1);
  const results = res(1, [300, 100]);
  const tips = [tip(1, 'a', 100), tip(1, 'b', 100), tip(1, 'c', 100), tip(1, 'd', 100), tip(1, 'e', 200), tip(1, 'jerome', 300)];
  const scores = scoreStage(s, tips, results, DEFAULT_SCALE);
  assert.equal(scores.find((x) => x.userId === 'jerome')!.total, 24);
  assert.equal(scores.find((x) => x.userId === 'a')!.total, 15);
});

test('Außenseiter-Bonus: 3× Pogačar, allein Almeida gewinnt → 23', () => {
  const tips = [tip(1, 'a', 1), tip(1, 'b', 1), tip(1, 'c', 1), tip(1, 'd', 2), tip(1, 'jerome', 50)];
  const scores = scoreStage(stage(1, 1), tips, res(1, [50]), DEFAULT_SCALE);
  assert.equal(scores.find((x) => x.userId === 'jerome')!.total, 23);
});

test('Außenseiter-Bonus: alle tippen verschieden → +1', () => {
  const tips = [tip(1, 'a', 1), tip(1, 'b', 2), tip(1, 'jerome', 50)];
  const scores = scoreStage(stage(1, 1), tips, res(1, [50]), DEFAULT_SCALE);
  assert.equal(scores.find((x) => x.userId === 'jerome')!.total, 21);
});

test('Zwei Leute auf dem Sieger: kein Bonus (Beispiel Groves 2×, Milan 3×)', () => {
  const s = stage(1, 8);
  const results = res(1, [100, 200]);
  const tips = [tip(1, 'felix', 100), tip(1, 'lena', 100), tip(1, 'a', 200), tip(1, 'b', 200), tip(1, 'c', 200)];
  const scores = scoreStage(s, tips, results, DEFAULT_SCALE);
  assert.equal(scores.find((x) => x.userId === 'felix')!.total, 20);
  assert.equal(scores.find((x) => x.userId === 'lena')!.total, 20);
});

test('Einziger Tipper der Etappe bekommt keinen Bonus', () => {
  const scores = scoreStage(stage(1, 1), [tip(1, 'anna', 100)], res(1, [100]), DEFAULT_SCALE);
  assert.equal(scores[0].total, 20);
});

test('Unveröffentlichte Etappe zählt nicht', () => {
  const scores = scoreStage(stage(1, 1, false), [tip(1, 'anna', 100)], res(1, [100]), DEFAULT_SCALE);
  assert.equal(scores.length, 0);
});

test('Wettkampf-Ranking teilt Plätze (1, 1, 3)', () => {
  const items = [{ v: 10 }, { v: 12 }, { v: 12 }, { v: 3 }];
  const ranks = competitionRanks(items, (i) => i.v);
  assert.deepEqual(items.map((i) => ranks.get(i)), [3, 1, 1, 4]);
});

const baseData = (): TourData => ({
  tour: {
    id: 't', name: 'Test', short_name: 'T', theme: 'giro', year: 2027, start_date: '2027-05-08',
    end_date: '2027-05-30', is_visible: true, bonus_final: false, pcs_slug: null, tip_limit: 3,
  },
  stages: [stage(1, 1), stage(2, 2), stage(3, 3)],
  riders: [rider(100, 'Milan'), rider(200, 'Groves', 'Alpecin'), rider(300, 'Pogi', 'UAE')],
  tips: [],
  results: [...res(1, [100, 200]), ...res(2, [100, 300]), ...res(3, [300, 200])],
  bonusTips: [],
  bonusResults: [],
  scale: DEFAULT_SCALE,
});

test('Meiste Etappensiege wird automatisch berechnet (geteilte Plätze)', () => {
  const data = baseData();
  const standings = bonusStandings(data).filter((s) => s.category === 'stage_wins');
  assert.deepEqual(standings.map((s) => [s.riderId, s.position, s.wins]), [[100, 1, 2], [300, 2, 1]]);
});

test('Bonuspunkte 15/10/5 und Endstand-Flag', () => {
  const data = baseData();
  data.bonusResults = [
    { tour_id: 't', category: 'gc', position: 1, rider_id: 300, team: null },
    { tour_id: 't', category: 'gc', position: 2, rider_id: 200, team: null },
    { tour_id: 't', category: 'team', position: 3, rider_id: null, team: 'Alpecin' },
  ];
  data.bonusTips = [
    { tour_id: 't', user_id: 'anna', category: 'gc', rider_id: 200, team: null },
    { tour_id: 't', user_id: 'anna', category: 'team', rider_id: null, team: 'Alpecin' },
    { tour_id: 't', user_id: 'anna', category: 'stage_wins', rider_id: 100, team: null },
  ];
  const scores = bonusScoresFor(data, 'anna');
  assert.deepEqual(scores.map((s) => s.points), [10, 5, 15]);

  const members = [member('anna', 'Anna')];
  assert.equal(leaderboard(data, members)[0].bonusPoints, 0);
  assert.equal(leaderboard(data, members)[0].bonusProjection, 30);
  data.tour.bonus_final = true;
  assert.equal(leaderboard(data, members)[0].total, 30);
});

test('Rangliste mit Vortagesrang', () => {
  const data = baseData();
  data.tips = [
    tip(1, 'anna', 100), tip(1, 'ben', 200),
    tip(2, 'anna', 300), tip(2, 'ben', 100),
    tip(3, 'anna', 100), tip(3, 'ben', 300),
  ];
  const rows = leaderboard(data, [member('anna', 'Anna'), member('ben', 'Ben')]);
  // Sieger jeweils allein getippt, Favorit hat 1 Tipp → je +1
  const anna = rows.find((r) => r.userId === 'anna')!;
  const ben = rows.find((r) => r.userId === 'ben')!;
  assert.equal(anna.total, 21 + 15 + 0);
  assert.equal(ben.total, 15 + 21 + 21);
  assert.equal(ben.rank, 1);
  assert.equal(ben.prevRank, 1);
  assert.equal(ben.winnersHit, 2);
  assert.equal(ben.underdogHits, 2);
});

test('Tipp-Limit gilt für jeden Fahrer und ignoriert den Tipp der gleichen Etappe', () => {
  const tour = baseData().tour;
  const milan = rider(100, 'Milan');
  const tips = [tip(1, 'anna', 100), tip(2, 'anna', 100)];
  assert.equal(jokerRemaining(tour, milan, tips, 'anna', 3), 1);
  assert.equal(jokerRemaining(tour, milan, tips, 'anna', 2), 2);
  assert.equal(jokerRemaining({ ...tour, tip_limit: 5 }, milan, tips, 'anna', 3), 3);
  assert.equal(jokerRemaining({ ...tour, tip_limit: null }, milan, tips, 'anna', 3), null);
  assert.equal(jokerRemaining({ ...tour, tip_limit: null }, rider(300, 'Pogi', 'UAE', 1), tips, 'anna', 3), 1);
});
