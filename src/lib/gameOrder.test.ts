import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtBest, gameOrderByPlays, isNewGame, GAMES } from '../game/games';

const ids = (g: { id: string }[]) => g.map((x) => x.id);

test('Spiele-Reihenfolge: neues Spiel zuerst, dann das meistgespielte, bei Gleichstand wie bisher', () => {
  // ohne Läufe / gleich oft: Zeitfahren (neu) vorn, dann die Etappen-Reihenfolge
  assert.deepEqual(ids(gameOrderByPlays('flat', null)), ['zeitfahren', 'sprint', 'berg', 'abfahrt']);
  assert.deepEqual(ids(gameOrderByPlays('mountain', { abfahrt: 0, sprint: 0, berg: 0, zeitfahren: 0 })), ['zeitfahren', 'berg', 'sprint', 'abfahrt']);
  // ungespieltes neues Spiel bleibt vorn, auch wenn die anderen oft gespielt sind
  assert.deepEqual(ids(gameOrderByPlays('flat', { abfahrt: 12, sprint: 3, berg: 3 })), ['zeitfahren', 'abfahrt', 'sprint', 'berg']);
  // einmal gespielt: wieder nach Häufigkeit
  assert.deepEqual(ids(gameOrderByPlays('flat', { abfahrt: 12, sprint: 1, berg: 5, zeitfahren: 2 })), ['abfahrt', 'berg', 'zeitfahren', 'sprint']);
  assert.deepEqual(ids(gameOrderByPlays('flat', { abfahrt: 4, sprint: 4, berg: 4, zeitfahren: 4 })), ['zeitfahren', 'sprint', 'berg', 'abfahrt']);
  assert.deepEqual(ids(gameOrderByPlays(null, { berg: 2, zeitfahren: 1 })), ['berg', 'zeitfahren', 'sprint', 'abfahrt']);
});

test('Neu-Markierung und Bestwert-Anzeige', () => {
  const tt = GAMES.find((g) => g.id === 'zeitfahren')!;
  const berg = GAMES.find((g) => g.id === 'berg')!;
  assert.equal(isNewGame(tt, { zeitfahren: 0 }), true);
  assert.equal(isNewGame(tt, { zeitfahren: 1 }), false);
  assert.equal(isNewGame(tt, null), false, 'solange nichts geladen ist, nichts markieren');
  assert.equal(isNewGame(berg, { berg: 0 }), false);
  assert.equal(fmtBest('zeitfahren', 1_000_000 - 224350), '3:44,4');
  assert.equal(fmtBest(berg, 1234), '1.234');
});
