import { test } from 'node:test';
import assert from 'node:assert/strict';
import { list, pts, roundNews } from './roundNews';
import type { BonusTip, Profile, Rider, Stage, StageResult, StageTip, TourData } from './types';

const stage = (id: number, number: number, published = true): Stage => ({
  id, tour_id: 't', number, starts_at: `2027-05-${String(7 + number).padStart(2, '0')}T10:00:00Z`, kind: 'flat',
  departure: null, arrival: null, distance_km: null, results_published: published,
});
const tip = (stage_id: number, user_id: string, rider_id: number): StageTip => ({ stage_id, user_id, rider_id, updated_at: '' });
const res = (stage_id: number, ids: number[]): StageResult[] => ids.map((rider_id, i) => ({ stage_id, position: i + 1, rider_id }));
const member = (id: string, name: string): Profile => ({
  id, display_name: name, avatar_color: '#000000', is_member: true, is_admin: false, is_pro: false, created_at: '',
});
const rider = (id: number): Rider => ({ id, tour_id: 't', bib: id, name: `Fahrer ${id}`, team: `Team ${id % 4}`, tip_limit: null, excluded_from_rest: false, status: 'active' });

const NOW = Date.parse('2027-06-30T12:00:00Z');
const ANNA = member('anna', 'Anna');
const BEN = member('ben', 'Ben');
const CARL = member('carl', 'Carl');
const DORA = member('dora', 'Dora');

/** Rundfahrt mit `total` Etappen; je Etappe Ergebnis (Fahrer nach Platz) und Tipps (Mitglied → Fahrer) */
function tour(total: number, days: { order: number[]; tips: Record<string, number> }[], bonus_final = false): TourData {
  return {
    tour: { id: 't', name: 'Giro Test', short_name: 'Giro', theme: 'giro', year: 2027, start_date: '2027-05-08', end_date: '2027-05-30', is_visible: true, bonus_final, pcs_slug: null },
    stages: Array.from({ length: total }, (_, i) => stage(i + 1, i + 1, i < days.length)),
    riders: Array.from({ length: 20 }, (_, i) => rider(i + 1)),
    tips: days.flatMap((d, i) => Object.entries(d.tips).map(([u, r]) => tip(i + 1, u, r))),
    results: days.flatMap((d, i) => res(i + 1, d.order)),
    bonusTips: [],
    bonusResults: [],
    scale: [],
  };
}

test('Sprache: Einzahl und Aufzählung', () => {
  assert.equal(pts(1), '1 Punkt');
  assert.equal(pts(0), '0 Punkte');
  assert.equal(list(['A']), 'A');
  assert.equal(list(['A', 'B']), 'A und B');
  assert.equal(list(['A', 'B', 'C']), 'A, B und C');
});

test('ohne Ergebnis keine Meldung', () => {
  assert.deepEqual(roundNews(tour(3, []), [ANNA, BEN], NOW), []);
});

test('Auftakt: Spitze, Tabelle, Kennung', () => {
  const data = tour(5, [{ order: [1, 2, 3], tips: { anna: 1, ben: 2, carl: 3 } }]);
  const [n] = roundNews(data, [ANNA, BEN, CARL], NOW);
  assert.equal(n.kind, 'start');
  assert.equal(n.id, 'round:t:1');
  assert.match(n.title, /Anna/);
  assert.deepEqual(n.table.map((r) => [r.name, r.rank, r.total, r.move]), [['Anna', 1, 21, null], ['Ben', 2, 15, null], ['Carl', 3, 10, null]]);
  assert.match(n.text, /Ben/); // Abstand auf Platz zwei
});

test('Auftakt mit Gleichstand', () => {
  const data = tour(5, [{ order: [1, 2], tips: { anna: 1, ben: 1 } }]);
  const [n] = roundNews(data, [ANNA, BEN], NOW);
  assert.equal(n.kind, 'start');
  assert.match(n.title, /Anna und Ben/);
});

test('Führungswechsel mit Außenseiter-Bonus', () => {
  const data = tour(5, [
    { order: [1, 2, 3], tips: { anna: 1, ben: 2, carl: 3 } },
    { order: [5, 2, 1], tips: { anna: 9, ben: 5, carl: 9 } },
  ]);
  const [n] = roundNews(data, [ANNA, BEN, CARL], NOW);
  assert.equal(n.kind, 'change');
  assert.match(n.title, /Ben/);
  assert.match(n.text, /Ben/);
  assert.match(n.text, /2 (Bonus)?[Pp]unkte|Außenseiter/);
  assert.doesNotMatch(roundNews(data, [ANNA, BEN, CARL], NOW).map((x) => x.text).join(' '), /mit (je )?\d+ Punkte\b/);
});

test('Nullrunde und vergessene Tipps', () => {
  const data = tour(5, [
    { order: [1, 2, 3], tips: { anna: 1, ben: 2, carl: 3 } },
    { order: [1, 2, 3], tips: { anna: 15, ben: 16 } },
  ]);
  const [n] = roundNews(data, [ANNA, BEN, CARL], NOW);
  assert.equal(n.kind, 'lead');
  assert.match(n.title, /Anna/);
  assert.match(n.title, /Nullrunde|Stillstand/);
  assert.match(n.text, /Carl/);
});

test('niemand hat Punkte', () => {
  const data = tour(5, [{ order: [1, 2, 3], tips: { anna: 11, ben: 12 } }]);
  const [n] = roundNews(data, [ANNA, BEN], NOW);
  assert.equal(n.kind, 'none');
});

test('lange Führung: neueste zuerst, keine Überschrift zweimal hintereinander gleich, Halbzeit und Finale', () => {
  const days = Array.from({ length: 12 }, () => ({ order: [1, 2, 3], tips: { anna: 1, ben: 2, carl: 3 } }));
  const news = roundNews(tour(12, days), [ANNA, BEN, CARL], NOW);
  assert.equal(news.length, 12);
  assert.deepEqual(news.map((n) => n.stageNumber), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  const shape = news.map((n) => n.title.replace(/\d+/g, '#'));
  for (let i = 1; i < shape.length; i++) assert.notEqual(shape[i], shape[i - 1], `Etappe ${news[i].stageNumber}`);
  assert.equal(news[0].kind, 'open'); // letzte Etappe, Bonuswertung noch offen
  assert.match(news.find((n) => n.stageNumber === 6)!.title, /Halbzeit|Bergfest/);
  assert.match(news.find((n) => n.stageNumber === 11)!.title, /Schlussetappe|Eine Etappe noch|Finale/);
  assert.match(news.find((n) => n.stageNumber === 5)!.title, /5/); // seit 5 Etappen vorn
});

test('Schluss mit Bonuswertung: Gesamtsieg, die Bonuspunkte drehen das Ergebnis', () => {
  const data = tour(3, [
    { order: [1, 2, 3], tips: { anna: 1, ben: 2, carl: 3 } },
    { order: [1, 2, 3], tips: { anna: 2, ben: 2, carl: 3 } },
    { order: [1, 2, 3], tips: { anna: 2, ben: 2, carl: 3 } },
  ], true);
  data.bonusResults = [{ tour_id: 't', category: 'gc', position: 1, rider_id: 7, team: null }];
  data.bonusTips = [{ tour_id: 't', user_id: 'ben', category: 'gc', rider_id: 7, team: null } as BonusTip];
  const [n] = roundNews(data, [ANNA, BEN, CARL], NOW);
  // Anna 21+15+15 = 51, Ben 15+15+15+15 Bonus = 60
  assert.equal(n.kind, 'final');
  assert.match(n.title, /Ben/);
  assert.match(n.text, /Bonus/);
  assert.equal(n.table[0].name, 'Ben');
  assert.equal(n.table[0].total, 60);
});

test('Zeitpunkt nie in der Zukunft', () => {
  const data = tour(3, [{ order: [1], tips: { anna: 1 } }]);
  const early = Date.parse('2027-05-08T12:00:00Z');
  const [n] = roundNews(data, [ANNA], early);
  assert.equal(n.at, new Date(early).toISOString());
});

// Zufallsrunden: keine Lücken, keine Platzhalter, immer gleich beim zweiten Aufruf
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

test('Zufallsrunden: saubere Sätze in allen Lagen', () => {
  const names = ['Anna', 'Ben', 'Carl', 'Dora', 'Emil', 'Fritzi', 'Gabi', 'Hans', 'Ida'];
  const seen = new Set<string>();
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed);
    const n = 1 + Math.floor(r() * names.length);
    const members = names.slice(0, n).map((x) => member(x.toLowerCase(), x));
    const total = 3 + Math.floor(r() * 19);
    const played = Math.floor(r() * (total + 1));
    const pool = 2 + Math.floor(r() * 10);
    const days = Array.from({ length: played }, () => {
      const order = Array.from({ length: 12 }, (_, i) => i + 1).sort(() => r() - 0.5).slice(0, 10);
      const tips: Record<string, number> = {};
      for (const m of members) if (r() > 0.15) tips[m.id] = 1 + Math.floor(r() * pool);
      return { order, tips };
    });
    const data = tour(total, days, r() > 0.5);
    if (data.tour.bonus_final) {
      data.bonusResults = [{ tour_id: 't', category: 'gc', position: 1, rider_id: 3, team: null }];
      data.bonusTips = members.filter(() => r() > 0.6).map((m) => ({ tour_id: 't', user_id: m.id, category: 'gc', rider_id: 3, team: null }) as BonusTip);
    }
    const a = roundNews(data, members, NOW);
    assert.deepEqual(roundNews(data, members, NOW), a, `seed ${seed}: nicht stabil`);
    assert.equal(a.length, played);
    for (const x of a) {
      seen.add(x.kind);
      const all = `${x.title} | ${x.text}`;
      assert.ok(x.title.length > 5, `seed ${seed}: leere Überschrift`);
      assert.doesNotMatch(all, /undefined|NaN|\bnull\b(?! Punkte)|mit (je )?\d+ Punkte\b|\s{2}|\s[.,:]|:\s*$|\(\)|\bvor\s*$/, `seed ${seed}: ${all}`);
      assert.ok(x.table.length >= 1 && x.table.every((t) => t.rank <= 3));
      assert.ok(x.text.split(/(?<=[.!])\s/).length <= 4, `seed ${seed}: zu lang: ${x.text}`);
    }
  }
  for (const k of ['start', 'lead', 'change', 'tie', 'final', 'open', 'none']) assert.ok(seen.has(k), `Lage ${k} kommt nie vor`);
});

test('nur Mitglieder mit Namen zählen', () => {
  const data = tour(3, [{ order: [1, 2], tips: { anna: 1, ghost: 2 } }]);
  const ghost = { ...member('ghost', 'Ghost'), is_member: false };
  const [n] = roundNews(data, [ANNA, ghost], NOW);
  assert.doesNotMatch(`${n.title} ${n.text}`, /Ghost/);
  assert.deepEqual(n.table.map((t) => t.name), ['Anna']);
  assert.deepEqual(roundNews(data, [ghost], NOW), []);
});

test('Dora ist neu am Tabellenende: rote Laterne', () => {
  const data = tour(8, [
    { order: [1, 2, 3, 4], tips: { anna: 1, ben: 2, carl: 3, dora: 4 } },
    { order: [1, 2, 3, 4], tips: { anna: 1, ben: 2, carl: 4, dora: 3 } },
    { order: [9, 8, 7, 6], tips: { anna: 1, ben: 2, carl: 3, dora: 5 } },
  ]);
  const news = roundNews(data, [ANNA, BEN, CARL, DORA], NOW);
  // nach 2: Carl 17, Dora 17 geteilt letzter Platz, nach 3 unverändert → keine neue Laterne
  assert.ok(news.every((n) => !/Laterne|Ende der Tabelle/.test(n.text) || n.stageNumber > 1));
});
