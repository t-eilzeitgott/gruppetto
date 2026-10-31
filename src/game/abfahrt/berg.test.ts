import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOUNTAIN_FINISH, MOUNTAIN_TOP, SEG, Track } from './track';
import { BergRace, type BergResult } from './berg';
import { rivalNames } from './sprintRiders';
import type { TourData } from '../../lib/types';

const kit = { jersey: '#ff5fa2', side: '#fff', helmet: '#fff', shorts: '#111', skin: '#f0c4a0', shoes: '#fff', number: '27' };

test('Bergfinale-Strecke: bergauf bis zur Bergwertung, bergab ins Ziel, gleich für alle', () => {
  const a = new Track('2027-05-20', [], 'mountain', 'Bormio');
  const b = new Track('2027-05-20', [], 'mountain', 'Bormio');
  assert.match(a.title, /→ Bormio$/);
  const top = MOUNTAIN_TOP / SEG;
  const fin = MOUNTAIN_FINISH / SEG;
  assert.equal(a.seg(top).banner?.kind, 'gpm');
  assert.equal(a.seg(fin).banner?.kind, 'finish');
  for (let i = 0; i < fin; i += 5) {
    assert.equal(a.seg(i).curve, b.seg(i).curve);
    assert.ok(!a.seg(i).objs?.length, 'keine Hindernisse');
    assert.ok(!a.seg(i).tunnel, 'keine Tunnel');
    if (i < top - 40) assert.ok(a.seg(i).grade > 0.01, `bergauf bei ${i * SEG} m`);
    if (i > top + 30 && i < fin - 200) assert.ok(a.seg(i).grade < 0, `bergab bei ${i * SEG} m`);
  }
  assert.ok(a.seg(top).y - a.seg(0).y > 45, 'echter Anstieg');
  assert.ok(a.seg(top).y - a.seg(fin).y > 45, 'echte Abfahrt');
});

test('Bergfinale: Rennen endet, Punkte stimmen, Gruppe zerfällt am Berg', () => {
  for (const day of ['2027-05-20', '2027-05-21']) {
    let over: BergResult | null = null;
    const g = new BergRace({ dayKey: day, names: [], rider: { name: 'Test', type: 'climber', number: '27' }, rivals: ['Pogačar', 'Vingegaard'], kit, onOver: (r) => { over = r; } });
    g.start();
    let t = 0;
    let spread = 0;
    while (!over && t < 400) {
      const toTop = MOUNTAIN_TOP - g.p.z;
      g.key('up', toTop > 0 && toTop < 250 && g.energy > 0.05);
      g.update(1 / 30);
      t += 1 / 30;
      if (g.p.z >= MOUNTAIN_TOP && !spread) spread = Math.max(...g.opps.map((o) => o.z)) - Math.min(...g.opps.map((o) => o.z));
      // (nach einem Sturz liegt man kurz und fährt aus dem Stand wieder an)
      if (g.phase === 'playing' && g.p.z < MOUNTAIN_FINISH && !g.wreck && g.crashes === 0) assert.ok(g.p.v > 2, 'Spieler fährt');
    }
    assert.ok(over, `Rennen am ${day} beendet`);
    const r = over as BergResult;
    assert.ok(r.place >= 1 && r.place <= r.riders);
    assert.ok(r.gpmPlace >= 1 && r.gpmPlace <= r.riders);
    assert.equal(r.score, r.parts.place + r.parts.gpm + r.parts.gap + r.parts.type);
    assert.ok(spread > 40, `am Gipfel liegt die Gruppe auseinander (${spread.toFixed(0)} m)`);
    assert.ok(t > 100 && t < 260, `Dauer ${t.toFixed(0)} s`);
  }
});

test('Bergfinale: wer geduckt in die Kehren fährt, rutscht raus – mit Bremshilfe nicht', () => {
  const run = (tuck: boolean) => {
    const g = new BergRace({ dayKey: '2026-10-27', names: [], rider: { name: 'Test', type: 'climber', number: '27' }, rivals: [], kit });
    g.start();
    g.opps = [];
    for (let i = 0; i < 60 * 300 && g.p.z < MOUNTAIN_FINISH - 400; i++) {
      g.key('up', tuck && g.p.z > MOUNTAIN_TOP);
      g.update(1 / 60);
    }
    return g.slides;
  };
  assert.ok(run(true) > 0, 'geduckt durch die Kehren');
  assert.equal(run(false), 0, 'mit Bremshilfe');
});

test('Gegner am Berg: Kletterer zuerst', () => {
  const riders = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, tour_id: 't', bib: i + 1, name: `Fahrer ${i + 1}`, team: 'T', tip_limit: null, excluded_from_rest: false, status: 'active' as const }));
  const data = {
    tour: {} as TourData['tour'], riders, tips: [], bonusTips: [], bonusResults: [], scale: [],
    stages: [
      { id: 1, tour_id: 't', number: 1, starts_at: '2027-05-08T11:00:00Z', kind: 'flat', departure: null, arrival: null, distance_km: 180, results_published: true },
      { id: 2, tour_id: 't', number: 2, starts_at: '2027-05-09T11:00:00Z', kind: 'mountain', departure: null, arrival: null, distance_km: 160, results_published: true },
    ],
    results: [{ stage_id: 1, position: 1, rider_id: 3 }, { stage_id: 2, position: 1, rider_id: 9 }],
  } as unknown as TourData;
  assert.equal(rivalNames(data, null, 'climb')[0], 'Fahrer 9');
  assert.equal(rivalNames(data, null, 'sprint')[0], 'Fahrer 3');
});
