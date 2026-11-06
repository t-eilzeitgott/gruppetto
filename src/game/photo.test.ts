import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossOffset, photoFinish, photoGap } from './photo';

test('Fotofinish nur, wenn es knapp war – zwei davor, zwei dahinter', () => {
  const me = { name: 'Du', color: '#fc0' };
  assert.equal(photoFinish([{ id: 'a', name: 'A', color: '#111', t: -0.9 }], me, 16), null, 'zu weit weg');
  const p = photoFinish([
    { id: 'a', name: 'A', color: '#111', t: -0.05 }, { id: 'b', name: 'B', color: '#222', t: -0.3 }, { id: 'c', name: 'C', color: '#333', t: -1.1 },
    { id: 'd', name: 'D', color: '#444', t: 0.2 }, { id: 'e', name: 'E', color: '#555', t: 0.4 }, { id: 'f', name: 'F', color: '#666', t: 0.5 }, { id: 'g', name: 'G', color: '#777', t: 3 },
  ], me, 16);
  assert.ok(p);
  assert.deepEqual(p.riders.map((r) => r.id), ['b', 'a', 'me', 'd', 'e']);
});

test('Zielzeit aus der Lage beim eigenen Zieldurchgang', () => {
  // man ist 2 m über der Linie (16 m/s), der andere 3 m davor (15 m/s): er kommt 0,2 + 0,125 s später
  assert.ok(Math.abs(crossOffset(1000, 997, 15, 1002, 16) - (0.2 + 0.125)) < 1e-9);
  assert.equal(photoGap(0.009, 16), '14 cm');
  assert.equal(photoGap(-0.2, 16), '3,2 m');
});
