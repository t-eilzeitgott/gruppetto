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

test('Strecke führt nie über oder unter sich selbst hindurch', () => {
  for (let d = 0; d < 16; d++) {
    const day = new Date(Date.UTC(2027, 4, 1 + d * 3)).toISOString().slice(0, 10);
    const t = new Track(day);
    const P: [number, number, number][] = [];
    for (let i = 0; i < 3000; i += 2) { const s = t.seg(i); P.push([s.wx, s.wz, s.y]); }
    for (let a = 0; a < P.length; a++) {
      for (let b = a + 75; b < P.length; b++) {
        const dd = Math.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1]);
        if (dd > 200) continue;
        assert.ok(dd > 18, `${day}: Straßenstücke bei ${a * 2 * SEG} m und ${b * 2 * SEG} m nur ${dd.toFixed(1)} m auseinander`);
        assert.ok(Math.abs(P[a][2] - P[b][2]) < 2 * dd, `${day}: zu steil übereinander (${a * 2 * SEG} m / ${b * 2 * SEG} m)`);
      }
    }
  }
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
  // wählt die Spur mit dem meisten Platz: Hindernisse meiden (auch auf dem Weg dorthin), Flaschen mitnehmen
  const pilot = (g: Abfahrt) => {
    const p = g.p;
    let best = 0;
    let bestScore = -Infinity;
    for (const lx of [-2.2, -1.1, 0, 1.1, 2.2]) {
      let score = -Math.abs(lx - p.x) * 0.15;
      for (const o of g.opps) if (o.z > p.z - 1 && o.z - p.z < 10) score -= Math.max(0, 1.3 - Math.abs(o.x - lx)) * 4;
      for (let d = 0; d < 40; d += 2) {
        for (const o of g.track.segAt(p.z + d).objs ?? []) {
          if (o.done || o.z <= p.z) continue;
          const good = o.k === 'bidon' || o.k === 'gold';
          const dz = o.z - p.z;
          score += (good ? 1 : -6) * Math.max(0, (good ? 1.0 : 1.7) - Math.abs(o.x - lx)) * (1 - dz / 45);
          if (!good && dz < 20 && o.x > Math.min(p.x, lx) - 0.9 && o.x < Math.max(p.x, lx) + 0.9) score -= 8 * (1 - dz / 20);
        }
      }
      if (score > bestScore) { bestScore = score; best = lx; }
    }
    g.tx = best;
    g.key('up', true);
  };
  // (die Abfahrt beginnt im Startort, dann Landstraße, Tunnel und Panorama-Kehre ohne Feld und Flaschen – das Rennen
  // geht erst danach los, darum etwas länger)
  const { g } = run('2027-05-09', pilot, 120);
  assert.ok(g.p.z > 1000, `weit gekommen: ${Math.round(g.p.z)} m`);
  assert.ok(g.stats.overtakes > 0, 'überholt');
  assert.ok(g.stats.bidons > 0, 'Flaschen gesammelt');
  assert.ok(g.score.friends >= 100, 'Felix geschlagen');
  assert.ok(g.stats.topKmh > 60);
});

test('Testfahrt (Admin): Zeitraffer, keine Hindernisse, kein Sturz', () => {
  const day = '2027-05-09';
  let over: RunResult | null = null;
  const mk = (cruise?: number) => new Abfahrt({
    dayKey: day, names: [], friends: [], kit, best: 0,
    missions: dailyMissions(day), missionsDone: new Set(), tutorial: false, cruise, onOver: (r) => { over = r; },
  });
  const g = mk(3);
  const n = mk();
  g.start();
  n.start();
  for (let t = 0; t < 40; t += 1 / 60) { g.update(1 / 60); n.update(1 / 60); }
  assert.equal(over, null);
  assert.equal(g.phase, 'playing');
  assert.ok(g.p.z > 1500, `nur ${g.p.z} m`);
  for (let i = 0; i < Math.floor(g.p.z / 2) + 200; i++) {
    for (const o of g.track.seg(i).objs ?? []) assert.ok(!Track.HAZARDS.has(o.k), `Hindernis ${o.k} bei Segment ${i}`);
  }
});
