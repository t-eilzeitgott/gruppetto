import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateRun } from './ghostSim.ts';
import { SprintRace } from './sprint.ts';
import { BergRace } from './berg.ts';
import { Abfahrt } from './engine.ts';
import { dailyMissions } from './missions.ts';
import { pickScoreGhosts } from '../ghosts.ts';
import type { GhostRider } from '../tt.ts';

const kit = { jersey: '#ff5fa2', side: '#fff', helmet: '#fff', shorts: '#111', skin: '#f0c4a0', shoes: '#fff', number: '27' };
const day = '2027-05-09';

test('jedes Spiel zeichnet die eigene Fahrspur auf (Punkte, Strecke, Spur)', () => {
  for (const game of ['abfahrt', 'sprint', 'berg'] as const) {
    const t0 = Date.now();
    const r = simulateRun(game, day, 0.8, 42);
    assert.ok(r.trace.length >= 30 && r.trace.length % 3 === 0, `${game}: Spur ${r.trace.length}`);
    assert.ok(r.score > 0, `${game}: Punkte`);
    // Strecke steigt (fast) monoton
    for (let i = 3; i < r.trace.length; i += 3) assert.ok(r.trace[i] >= r.trace[i - 3] - 5, `${game}: rückwärts bei ${i}`);
    assert.ok(Date.now() - t0 < 8000, `${game}: Simulation zu langsam`);
  }
});

function ghostOf(trace: number[], score: number): GhostRider {
  return { id: 'u-x', name: 'Felix Test', color: '#3366ff', bike: 'aero', timeMs: 0, splits: [], trace, score };
}

test('Sprint: der Geist fährt die gespeicherte Fahrt nach – gleiche Stelle zur gleichen Zeit, kein Gegner', () => {
  const rec = simulateRun('sprint', day, 0.9, 7);
  const g = new SprintRace({ dayKey: day, names: [], rider: { name: 'Test', type: 'sprinter', number: '27' }, rivals: [], kit, ghosts: [ghostOf(rec.trace, rec.score)] });
  const opps = g.opps.length;
  g.start();
  while (g.phase !== 'playing') g.update(1 / 30); // Countdown
  let t = 1 / 30; // das Bild des Wechsels zählt schon mit
  for (let i = 0; i < 30 * 20; i++) { g.update(1 / 30); t += 1 / 30; }
  const gh = g.ghosts[0];
  // Spur bei 20 s: Stützpunkt 80
  const want = rec.trace[Math.round(t / 0.25) * 3] / 10;
  assert.ok(Math.abs(gh.z - want) < 4, `Geist bei ${gh.z.toFixed(1)} m, erwartet ${want.toFixed(1)} m`);
  assert.ok(gh.ghost! > 0.2, 'sichtbar');
  assert.equal(g.opps.length, opps, 'Geist zählt nicht zu den Gegnern');
});

test('Abfahrt und Bergfinale: Geister sichtbar ab Los, Namensschild für den nächsten voraus', () => {
  const recA = simulateRun('abfahrt', day, 0.9, 3);
  const a = new Abfahrt({ dayKey: day, names: [], friends: [], kit, best: 0, missions: dailyMissions(day), missionsDone: new Set(), tutorial: false, ghosts: [ghostOf(recA.trace, recA.score)] });
  assert.equal(a.ghosts.length, 1);
  assert.equal(a.ghosts[0].ghost, 0, 'vor dem Start unsichtbar');
  a.start();
  for (let t = 0; t < 8; t += 1 / 30) { a.tx = 0; a.update(1 / 30); }
  assert.ok(a.ghosts[0].ghost! > 0.2);
  const recB = simulateRun('berg', day, 0.9, 5);
  const b = new BergRace({ dayKey: day, names: [], rider: { name: 'Test', type: 'climber', number: '27' }, rivals: [], kit, ghosts: [ghostOf(recB.trace, recB.score)] });
  b.start();
  for (let t = 0; t < 12; t += 1 / 30) b.update(1 / 30);
  assert.ok(b.ghosts[0].ghost! > 0.2);
});

test('Auswahl: Tagesbester, eigener Bestlauf, dann die mit ähnlichen Punkten', () => {
  const mk = (id: string, score: number, me = false): GhostRider => ({ id, name: id, color: '#000', bike: 'aero', timeMs: 0, splits: [], trace: [0, 0, 0, 1, 0, 0], score, me });
  const all = [mk('a', 3000), mk('b', 2000), mk('c', 1500), mk('d', 1100), mk('e', 400), mk('me', 1200, true)];
  const out = pickScoreGhosts(all, 3);
  assert.deepEqual(out.map((g) => g.id), ['a', 'me', 'd']);
});
