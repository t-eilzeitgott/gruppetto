import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GhostPack, GhostRecorder, pickGameGhosts } from './ghosts';
import { Track } from './track';
import { TRACE_DT, ghostDayLabel, ghostName, pickGhosts, type GhostRider } from '../tt';
import { feedTime, liveTail, mergeTail, newFeed } from '../live';

const mk = (id: string, timeMs: number, extra: Partial<GhostRider> = {}): GhostRider =>
  ({ id, name: id, color: '#123456', bike: 'allround', timeMs, splits: [], trace: [0, 0, 0, 30, 0, 0, 60, 0, 0], ...extra });

test('Geister: Tag des älteren Geists', () => {
  assert.equal(ghostDayLabel('2026-10-28', '2026-10-29'), 'gestern');
  assert.equal(ghostDayLabel('2026-10-26', '2026-10-29'), 'Mo.');
  assert.equal(ghostDayLabel('2026-10-12', '2026-10-29'), '12.10.');
  assert.equal(ghostName(mk('x', 1, { name: 'Felix Müller', old: 'gestern' })), 'Felix (gestern)');
  assert.equal(ghostName(mk('me', 1, { me: true, old: 'Mo.' })), 'Dein Lauf Mo.');
});

test('Zeitfahren: eigener älterer Geist fährt mit, heutige zuerst', () => {
  const all = [mk('a', 230000), mk('b', 228000, { old: 'gestern' }), mk('me', 240000, { me: true, old: 'Mo.' }), mk('c', 260000)];
  const picked = pickGhosts(all, null, null, 3);
  assert.equal(picked[0].id, 'a');
  assert.ok(picked.some((g) => g.me), 'eigener Geist dabei');
  assert.equal(picked.length, 3);
  assert.ok(!picked.some((g) => g.id === 'b'), 'ältere erst nach den heutigen');
});

test('Spiele: je Mitglied der letzte Geist, eigener zuerst, heute vor älteren', () => {
  const row = (user_id: string, day: string, score: number) => ({ user_id, game: 'abfahrt' as const, day, score, meters: 1000, bike: 'aero', trace: [0, 0, 0, 40, 0, 0], created_at: '' });
  const rows = [row('u1', '2026-10-29', 900), row('u2', '2026-10-27', 1500), row('u2', '2026-10-25', 3000), row('me', '2026-10-28', 700), row('u3', '2026-10-29', 1200)];
  const g = pickGameGhosts(rows, 'me', '2026-10-29', (id) => ({ name: id, color: '#000' }));
  assert.deepEqual(g.map((x) => x.id), ['me', 'u3', 'u1', 'u2']);
  assert.equal(g[0].old, 'gestern');
  assert.equal(g[3].old, 'Di.');
  assert.equal(g[1].old, undefined);
});

test('Geister: Spur aufzeichnen und genau nachfahren', () => {
  const rec = new GhostRecorder();
  let z = 0;
  for (let i = 0; i < 400; i++) { const dt = 1 / 60; z += 10 * dt; rec.step(dt, z, 0.5, 10, 1); }
  assert.ok(Math.abs(rec.time - 400 / 60) < 1e-6);
  assert.equal(rec.trace.length % 3, 0);
  // Stützpunkte im Takt: nach n·TRACE_DT Sekunden n·2,5 m
  const n = 8;
  assert.ok(Math.abs(rec.trace[n * 3] / 10 - (n * TRACE_DT * 10 + 10 / 60)) < 0.2);
  const track = new Track('2026-10-29', [], 'sprint');
  const pack = new GhostPack(track, [mk('me', 0, { me: true, trace: rec.trace })]);
  for (let i = 0; i < 60; i++) pack.step(3, true, 1 / 60);
  assert.ok(Math.abs(pack.opps[0].z - 30) < 0.5, `bei 3 s auf ${pack.opps[0].z}`);
  assert.ok(pack.opps[0].ghost > 0);
  const tag = pack.tag(2, 10);
  assert.ok(tag && tag.text === 'Dein Bestlauf');
  // nach dem Ende der Spur blendet der Geist aus
  for (let i = 0; i < 200; i++) pack.step(20 + i / 60, true, 1 / 60);
  assert.equal(pack.opps[0].ghost, 0);
});

test('Live-Geist: kommt dazu, fährt dort, wo der andere jetzt ist, und verschwindet, wenn er geht', () => {
  const track = new Track('2026-10-29', [], 'sprint');
  const pack = new GhostPack(track, []);
  const feed = newFeed({ userId: 'u-lena', name: 'Lena Berg', color: '#b23a6b', bike: 'aero', run: 'r1' });
  // Lena ist 10 s unterwegs (10 m/s), die Meldung kam eben an
  const trace = Array.from({ length: 41 }, (_, i) => [Math.round(i * TRACE_DT * 100), 50, 1]).flat();
  mergeTail(feed, 41, liveTail(trace));
  feedTime(feed, 0, performance.now());
  pack.syncLive([feed]);
  assert.equal(pack.count, 1);
  assert.equal(pack.opps[0].rider.live, feed);
  for (let i = 0; i < 30; i++) pack.step(1, true, 1 / 60);
  const o = pack.opps[0];
  assert.ok(Math.abs(o.z - 100) < 6, `Lena bei ${o.z} m`);
  assert.ok(o.ghost > 0, 'sichtbar');
  // Namensschild mit „live“, wenn sie vor einem fährt
  const tag = pack.tag(1, o.z - 10);
  assert.ok(tag && tag.text === 'Lena' && tag.sub === 'live');
  // nicht mehr gemeldet: rollt aus, blendet aus, verschwindet aus der Liste
  pack.syncLive([]);
  assert.equal(feed.gone, true);
  for (let i = 0; i < 600 && pack.count; i++) pack.step(1, true, 1 / 60);
  assert.equal(pack.count, 0);
});

test('Windschatten nur hinter Live-Geistern, nicht hinter gespeicherten', () => {
  const track = new Track('2026-10-29', [], 'sprint');
  const trace = Array.from({ length: 41 }, (_, i) => [Math.round(i * TRACE_DT * 100), 0, 1]).flat();
  const stored = new GhostPack(track, [mk('u2', 0, { trace })]);
  for (let i = 0; i < 30; i++) stored.step(10, true, 1 / 60);
  assert.equal(stored.liveDraft(stored.opps[0].z - 3, 0, 9, 0.85), 0);
  const pack = new GhostPack(track, []);
  const feed = newFeed({ userId: 'u-lena', name: 'Lena Berg', color: '#b23a6b', bike: 'aero', run: 'r1' });
  mergeTail(feed, 41, liveTail(trace));
  feedTime(feed, 0, performance.now());
  pack.syncLive([feed]);
  for (let i = 0; i < 30; i++) pack.step(1, true, 1 / 60);
  const o = pack.opps[0];
  assert.ok(pack.liveDraft(o.z - 3, o.x, 9, 0.85) > 0.5, 'dicht dahinter');
  assert.equal(pack.draftBy, 'Lena');
  assert.equal(pack.liveDraft(o.z - 3, o.x + 2, 9, 0.85), 0, 'daneben kein Windschatten');
});

test('Rivale: fährt immer mit und meldet Überholen', () => {
  const track = new Track('2026-10-29', [], 'sprint');
  const rows = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'].map((u, i) => ({ user_id: u, game: 'sprint' as const, day: '2026-10-29', score: 1000 - i * 10, meters: 1000, bike: 'aero', trace: [0, 0, 0, 40, 0, 0, 80, 0, 0], created_at: '' }));
  const g = pickGameGhosts(rows, 'me', '2026-10-29', (id) => ({ name: id, color: '#000' }), 3, 'u7');
  assert.ok(g.some((x) => x.id === 'u7' && x.rival), 'Rivale dabei, obwohl er der Schwächste ist');
  const trace = Array.from({ length: 81 }, (_, i) => [Math.round(i * TRACE_DT * 100), 0, 1]).flat();
  const pack = new GhostPack(track, [mk('u7', 0, { name: 'Felix Müller', trace, rival: true })]);
  pack.step(5, true, 1 / 60);
  for (let i = 0; i < 30; i++) pack.step(5, true, 1 / 60);
  assert.equal(pack.rivalEvent(5, 40), null, 'erst die Seite merken');
  assert.equal(pack.rivalEvent(5.1, 40), null);
  const ev = pack.rivalEvent(5.2, 60);
  assert.deepEqual(ev, { kind: 'passed', name: 'Felix' });
  const tag = pack.tag(5, 45);
  assert.ok(tag && tag.sub?.startsWith('Rivale'));
});
