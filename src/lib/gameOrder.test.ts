import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameOrderByPlays } from '../game/games';

const ids = (g: { id: string }[]) => g.map((x) => x.id);

test('Spiele-Reihenfolge: meistgespieltes zuerst, bei Gleichstand wie bisher', () => {
  // ohne Läufe / gleich oft: Etappen-Reihenfolge bleibt
  assert.deepEqual(ids(gameOrderByPlays('flat', null)), ['sprint', 'berg', 'abfahrt']);
  assert.deepEqual(ids(gameOrderByPlays('mountain', { abfahrt: 0, sprint: 0, berg: 0 })), ['berg', 'sprint', 'abfahrt']);
  assert.deepEqual(ids(gameOrderByPlays('flat', { abfahrt: 4, sprint: 4, berg: 4 })), ['sprint', 'berg', 'abfahrt']);
  // meistgespieltes vorn, Rest in der bisherigen Reihenfolge
  assert.deepEqual(ids(gameOrderByPlays('flat', { abfahrt: 12, sprint: 3, berg: 3 })), ['abfahrt', 'sprint', 'berg']);
  assert.deepEqual(ids(gameOrderByPlays('flat', { abfahrt: 12, sprint: 1, berg: 5 })), ['abfahrt', 'berg', 'sprint']);
  assert.deepEqual(ids(gameOrderByPlays(null, { berg: 2 })), ['berg', 'sprint', 'abfahrt']);
});
