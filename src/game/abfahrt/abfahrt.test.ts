import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EDGE, ROAD_HALF, SEG, Track } from './track';
import { Abfahrt, type RunResult } from './engine';
import { dailyMissions } from './missions';
import { berlinDayKey, berlinDayStart } from './rng';

const kit = { jersey: '#ff5fa2', side: '#fff', helmet: '#fff', shorts: '#111', skin: '#f0c4a0', shoes: '#fff', number: '27' };

test('Tagesstrecke ist für alle gleich und ändert sich täglich', () => {
  const a = new Track('2027-05-09');
  const b = new Track('2027-05-09');
  const c = new Track('2027-05-10');
  for (let i = 0; i < 3000; i += 37) {
    assert.equal(a.seg(i).curve, b.seg(i).curve);
    assert.equal(a.seg(i).y, b.seg(i).y);
  }
  assert.equal(a.title, b.title);
  let diff = 0;
  for (let i = 0; i < 3000; i += 37) if (a.seg(i).curve !== c.seg(i).curve) diff++;
  assert.ok(diff > 10, 'andere Strecke am nächsten Tag');
});

test('Strecke: geht bergab, Krümmung begrenzt, alle Täler kommen vor', () => {
  const t = new Track('2027-05-12', ['Felix', 'Lena']);
  const biomes = new Set<string>();
  let maxK = 0;
  for (let i = 0; i < 5000; i++) {
    const s = t.seg(i);
    assert.ok(Number.isFinite(s.y) && Number.isFinite(s.curve));
    assert.ok(s.grade <= 0, 'immer bergab oder eben');
    maxK = Math.max(maxK, Math.abs(s.curve));
    biomes.add(t.sections[s.sec].biome);
    for (const o of s.objs ?? []) {
      assert.ok(Math.abs(o.x) <= EDGE + 2, 'Objekt nahe der Straße');
      if (o.k !== 'cow') assert.ok(Math.abs(o.x) <= ROAD_HALF, 'Hindernis auf der Fahrbahn');
    }
  }
  assert.ok(maxK < 0.05);
  for (const b of ['pass', 'alpine', 'forest', 'village']) assert.ok(biomes.has(b), b);
  assert.ok(t.heightAt(5000 * SEG) < t.heightAt(0) - 200);
  assert.match(t.title, / → /);
});

test('Kehren sind auf der Außenseite immer gesichert', () => {
  const t = new Track('2027-05-14');
  for (let i = 1; i < 6000; i++) {
    const s = t.seg(i);
    if (!s.hairpin || s.tunnel) continue;
    const outside = s.curve > 0 ? s.L : s.R;
    if (outside.drop && outside.wall === 0) assert.notEqual(outside.barrier, 'none', `Kehre bei ${i}`);
  }
});

test('Tagesaufgaben: drei verschiedene, leicht bis schwer', () => {
  const m = dailyMissions('2027-05-09');
  assert.equal(m.length, 3);
  assert.equal(new Set(m.map((x) => x.stat)).size, 3);
  assert.deepEqual(dailyMissions('2027-05-09'), m);
});

test('Berliner Tag: Mitternacht und Schlüssel passen zusammen', () => {
  const d = new Date('2027-05-09T21:30:00Z'); // 23:30 in Berlin
  assert.equal(berlinDayKey(d), '2027-05-09');
  assert.equal(berlinDayStart(d).toISOString(), '2027-05-08T22:00:00.000Z');
  assert.equal(berlinDayKey(new Date('2027-05-09T22:30:00Z')), '2027-05-10');
});

function run(day: string, steer: (g: Abfahrt) => void, maxT = 120): { g: Abfahrt; over: RunResult | null } {
  let over: RunResult | null = null;
  const g = new Abfahrt({
    dayKey: day, names: [], friends: [{ userId: 'x', name: 'Felix', color: '#f00', meters: 400 }], kit, best: 0,
    missions: dailyMissions(day), missionsDone: new Set(), tutorial: false, onOver: (r) => { over = r; },
  });
  g.start();
  for (let t = 0; t < maxT && !over; t += 1 / 60) {
    steer(g);
    g.update(1 / 60);
  }
  return { g, over };
}

test('Spiel: ohne Lenken landet man irgendwann im Aus, Punkte und Strecke stimmen', () => {
  const { over } = run('2027-05-09', () => undefined, 200);
  assert.ok(over, 'Lauf endet');
  const r = over as RunResult;
  assert.ok(r.meters > 20);
  const sum = Object.values(r.parts).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - r.score) <= 2, 'Summe der Teilpunkte = Gesamtpunkte');
  assert.ok(r.reason.length > 3);
});

test('Spiel: Autopilot fährt weit, überholt, sammelt und bekommt Kombos', () => {
  const pilot = (g: Abfahrt) => {
    const p = g.p;
    let want = 0;
    for (const o of g.opps) if (o.z > p.z && o.z - p.z < 8 && Math.abs(o.x - want) < 0.8) want = o.x > 0 ? o.x - 1.3 : o.x + 1.3;
    for (let d = 2; d < 40; d += 2) {
      const s = g.track.segAt(p.z + d);
      for (const o of s.objs ?? []) if (!o.done && o.k !== 'bidon' && o.k !== 'gold' && o.z > p.z && Math.abs(o.x - want) < 1.3) want = o.x > 0 ? o.x - 1.5 : o.x + 1.5;
    }
    g.tx = Math.max(-2.4, Math.min(2.4, want));
  };
  const { g } = run('2027-05-09', pilot, 90);
  assert.ok(g.p.z > 1000, `weit gekommen: ${Math.round(g.p.z)} m`);
  assert.ok(g.stats.overtakes > 0, 'überholt');
  assert.ok(g.stats.bidons > 0, 'Flaschen gesammelt');
  assert.ok(g.score.friends >= 100, 'Felix geschlagen');
  assert.ok(g.stats.topKmh > 60);
});
