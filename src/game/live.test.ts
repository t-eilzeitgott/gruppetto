import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_EXTRAP, LIVE_ROLL, feedTime, liveAdvance, liveAt, liveDone, liveEnd, liveSamples, liveTail, mergeTail, newFeed } from './live';
import { TRACE_DT } from './tt';

/** Spur mit gleichmäßigem Tempo v (m/s): n Proben */
const run = (n: number, v = 10, x = 0) => Array.from({ length: n }, (_, i) => [Math.round(i * TRACE_DT * v * 10), x, 1]).flat();
const feed = () => newFeed({ userId: 'u1', name: 'Lena', color: '#c33', bike: 'aero', run: 'r1' });

test('Meldungen hängen nur Neues an (Wiederholungen der letzten 10 s zählen nicht doppelt)', () => {
  const all = run(60);
  const f = feed();
  mergeTail(f, 20, liveTail(all.slice(0, 20 * 3)));
  mergeTail(f, 24, liveTail(all.slice(0, 24 * 3)));
  mergeTail(f, 24, liveTail(all.slice(0, 24 * 3)));
  mergeTail(f, 30, liveTail(all.slice(0, 30 * 3)));
  assert.equal(liveSamples(f), 30);
  assert.deepEqual(f.trace, all.slice(0, 90));
});

test('später dazugekommen: Anfang aufgefüllt, Zeit stimmt', () => {
  const all = run(200);
  const f = feed();
  mergeTail(f, 200, liveTail(all));
  assert.equal(liveSamples(f), 200);
  assert.equal(liveEnd(f), 199 * TRACE_DT);
  const out = { z: 0, x: 0, m: 0 };
  liveAt(f, 180 * TRACE_DT, out);
  assert.ok(Math.abs(out.z - 180 * TRACE_DT * 10) < 0.2);
});

test('ausgefallene Meldungen: Lücke geradlinig überbrückt', () => {
  const all = run(120);
  const f = feed();
  mergeTail(f, 10, liveTail(all.slice(0, 30)));
  mergeTail(f, 100, liveTail(all.slice(0, 300)));
  assert.equal(liveSamples(f), 100);
  for (let i = 1; i < 100; i++) assert.ok(f.trace[i * 3] >= f.trace[(i - 1) * 3], 'Strecke steigt');
});

test('Uhr: dort, wo der andere jetzt ist – fortgeschrieben, solange nichts Neues kommt', () => {
  const all = run(41, 12);
  const f = feed();
  mergeTail(f, 41, liveTail(all));
  feedTime(f, 300, 1000);
  const out = { z: 0, x: 0, m: 0 };
  // gleich nach dem Empfang: letzte Probe (10 s) + 0,3 s Alter − kleiner Puffer
  const t0 = liveAdvance(f, 0, 1000);
  assert.ok(t0 > 10 && t0 < 10.3, `t0 ${t0}`);
  // eine Sekunde später, ohne neue Meldung: fortgeschrieben mit 12 m/s
  let t = t0;
  for (let i = 0; i < 60; i++) t = liveAdvance(f, 1 / 60, 1000 + (i + 1) * (1000 / 60));
  liveAt(f, t, out);
  assert.ok(Math.abs(out.z - t * 12) < 1, `z ${out.z} statt ${t * 12}`);
  // nie weiter als LIVE_EXTRAP über die Spur hinaus
  const far = liveAdvance(f, 10, 20000);
  assert.ok(far <= liveEnd(f) + LIVE_EXTRAP + 1e-9);
});

test('fertig: rollt aus und ist dann weg', () => {
  const f = feed();
  mergeTail(f, 41, liveTail(run(41, 10)));
  feedTime(f, 0, 0);
  f.racing = false;
  assert.equal(liveDone(f), false);
  for (let i = 0; i <= 10; i++) liveAdvance(f, i ? 1 : 0, i * 1000);
  assert.equal(f.shown, liveEnd(f) + LIVE_ROLL);
  assert.equal(liveDone(f), true);
  const out = { z: 0, x: 0, m: 0 };
  liveAt(f, f.shown, out);
  // ausgerollt: halber Weg der Rollzeit bei altem Tempo
  assert.ok(Math.abs(out.z - (100 + 10 * LIVE_ROLL / 2)) < 0.5, `z ${out.z}`);
});

test('eigene Meldung: höchstens die letzten 40 Proben', () => {
  assert.equal(liveTail(run(100)).length, 120);
  assert.equal(liveTail(run(5)).length, 15);
  assert.deepEqual(liveTail(run(100)).slice(0, 3), run(100).slice(60 * 3, 61 * 3));
});
