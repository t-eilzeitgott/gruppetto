import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HIT_MIN, HIT_SHAKY, LIVE_EXTRAP, LIVE_ROLL, RT_AHEAD_X, RT_FRESH, feedTime, hitEffect, liveAdvance, liveAt, liveDone, liveEnd, liveSamples, liveTail,
  mergeTail, newFeed, rtAt, rtFresh, rtSet,
} from './live';
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

test('Echtzeit: frische Meldung schlägt die Spur, wird mit dem Tempo fortgeschrieben und verfällt', () => {
  const f = feed();
  const out = { z: 0, x: 0, m: 0 };
  assert.equal(rtAt(f, 1000, out), false);
  // Meldung war beim Empfang (t = 1000 ms) 80 ms alt: 100 m, 16 m/s, zieht mit 2 m/s nach rechts
  rtSet(f, { z: 100, x: 0.5, v: 16, vx: 2, m: 1 }, 80, 1000);
  assert.equal(rtFresh(f, 1000), true);
  assert.equal(rtAt(f, 1000, out), true);
  assert.ok(Math.abs(out.z - (100 + 16 * 0.08)) < 1e-6);
  assert.ok(Math.abs(out.x - (0.5 + 2 * 0.08)) < 1e-6);
  assert.equal(out.m, 1);
  // 300 ms später ohne neue Meldung: längs weiter, seitlich nur ein kurzes Stück
  rtAt(f, 1300, out);
  assert.ok(Math.abs(out.z - (100 + 16 * 0.38)) < 1e-6);
  assert.ok(Math.abs(out.x - (0.5 + 2 * RT_AHEAD_X)) < 1e-6);
  // eine ältere Meldung, die später ankommt, zählt nicht
  rtSet(f, { z: 90, x: 0, v: 16, vx: 0, m: 0 }, 400, 1100);
  assert.equal(f.rt!.z, 100);
  // nach RT_FRESH ohne Meldung gilt wieder die Spur
  assert.equal(rtAt(f, 920 + RT_FRESH * 1000 + 1, out), false);
});

test('Rempler: der Gerammte fliegt weiter und verliert mehr – erst der zweite bringt ihn zu Boden', () => {
  const v = hitEffect(4.5, 'v', false, 0.9);
  const a = hitEffect(4.5, 'a', false, 0.9);
  assert.ok(v.kick > a.kick && v.slow > a.slow && v.energy > a.energy);
  assert.equal(v.down, false);
  assert.equal(a.down, false);
  // noch wacklig vom letzten Rempler: der Gerammte liegt, wer rammt nur manchmal
  assert.equal(hitEffect(1, 'v', true, 0.9).down, true);
  assert.equal(hitEffect(4.5, 'a', true, 0.2).down, true);
  assert.equal(hitEffect(4.5, 'a', true, 0.8).down, false);
  assert.ok(HIT_MIN > 0 && HIT_SHAKY > 1);
});
