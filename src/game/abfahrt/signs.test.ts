import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAN_CELLS, SIGN_COUNT, fanCell, fanTexts, signTexts } from './tex3d';

const NAMES = ['JEROME', 'MILAN', 'JULIAN', 'FELIX', 'CHRISTOPH', 'ANNA', 'LEA'];

test('Pappschilder: jedes Rennen andere Sprüche, gleicher Startwert gleiche Schilder', () => {
  const a = signTexts(NAMES, 1);
  assert.equal(a.length, SIGN_COUNT);
  assert.deepEqual(signTexts(NAMES, 1), a);
  // über mehrere Rennen kommen deutlich mehr verschiedene Sprüche auf die Schilder als in eines passen
  const seen = new Set<string>();
  for (let seed = 0; seed < 30; seed++) for (const t of signTexts(NAMES, seed)) seen.add(t);
  assert.ok(seen.size > SIGN_COUNT * 1.6, `nur ${seen.size} verschiedene Sprüche`);
  assert.notDeepEqual(signTexts(NAMES, 2), a);
});

test('Pappschilder: Namen der Runde stehen drauf – je Rennen andere Mitspieler', () => {
  const withName = (seed: number) => new Set(NAMES.filter((n) => signTexts(NAMES, seed).some((t) => t.includes(n))));
  assert.equal(withName(3).size, 6);
  const all = new Set<string>();
  for (let seed = 0; seed < 20; seed++) for (const n of withName(seed)) all.add(n);
  assert.equal(all.size, NAMES.length);
  // ohne Namen nur Sprüche, keine Platzhalter
  for (const t of signTexts([], 5)) assert.ok(!t.includes('%'));
});

test('Spruchbänder: neun Bänder, je Rennen andere, mit Namen', () => {
  const a = fanTexts(NAMES, 11);
  assert.equal(a.length, FAN_CELLS);
  assert.ok(a.slice(0, 4).every((t) => NAMES.some((n) => t.includes(n))));
  assert.notDeepEqual(fanTexts(NAMES, 12), a);
  for (const t of fanTexts([], 11)) assert.ok(!t.includes('%'));
});

test('Spruchbänder: Zellen im Atlas überlappen nicht', () => {
  for (let i = 0; i < FAN_CELLS; i++) {
    const [u0, v0, u1, v1] = fanCell(i);
    assert.ok(u0 < u1 && v0 < v1 && v0 > 0 && v1 <= 1);
    if (i > 0) assert.ok(v1 < fanCell(i - 1)[1], `Zelle ${i} überlappt`);
  }
});
