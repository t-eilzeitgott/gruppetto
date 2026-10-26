import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overtaken } from './overtaken';

test('Überholt: nur ein Rückfall von Platz 1 oder 2 zählt, mit den neuen Vorderleuten', () => {
  assert.deepEqual(overtaken({ rank: 1, above: [] }, { rank: 2, above: ['lena'] }), { from: 1, to: 2, by: ['lena'] });
  assert.deepEqual(overtaken({ rank: 2, above: ['ben'] }, { rank: 4, above: ['ben', 'lena', 'tobi'] }), { from: 2, to: 4, by: ['lena', 'tobi'] });
  assert.equal(overtaken({ rank: 3, above: ['a', 'b'] }, { rank: 5, above: ['a', 'b', 'c', 'd'] }), null, 'ab Platz 3 kein Hinweis');
  assert.equal(overtaken({ rank: 2, above: ['a'] }, { rank: 1, above: [] }), null, 'verbessert');
  assert.equal(overtaken({ rank: 1, above: [] }, { rank: 1, above: [] }), null, 'gleich');
  assert.equal(overtaken(null, { rank: 3, above: ['a', 'b'] }), null, 'nichts gesehen');
});
