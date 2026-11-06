import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rivalGap, rivalOf, rivalVerdict } from './rival';
import type { GameBest } from '../data/source';
import type { Profile } from '../lib/types';

const row = (user_id: string, best: number): GameBest => ({ user_id, best, best_m: 0, runs: 1, total_m: 0, last_at: '' });
const people = ['a', 'b', 'me', 'c'].map((id) => ({ id, display_name: `${id.toUpperCase()} Name`, avatar_color: '#123' })) as unknown as Profile[];

test('Rivale: direkt vor einem, vorn: wer einen jagt, ohne Ergebnis: der Letzte', () => {
  const board = [row('a', 900), row('b', 800), row('me', 760), row('c', 500)];
  const r = rivalOf(board, 'me', people);
  assert.equal(r?.userId, 'b');
  assert.equal(r?.gap, 40);
  assert.equal(r?.ahead, true);
  assert.equal(r?.place, 2);
  assert.equal(r?.name, 'B');
  const top = rivalOf([row('me', 1000), row('a', 900)], 'me', people);
  assert.equal(top?.userId, 'a');
  assert.equal(top?.ahead, false);
  const none = rivalOf([row('a', 900), row('c', 500)], 'me', people);
  assert.equal(none?.userId, 'c');
  assert.equal(none?.gap, null);
  assert.equal(rivalOf([row('me', 1)], 'me', people), null);
});

test('Rivale: geschlagen oder knapp – und als Text', () => {
  const r = rivalOf([row('b', 800), row('me', 760)], 'me', people);
  assert.deepEqual(rivalVerdict('sprint', r, 820), { name: 'B', beaten: true });
  assert.deepEqual(rivalVerdict('sprint', r, 700), { name: 'B', beaten: false, close: '40 Pkt' });
  assert.equal(rivalGap('zeitfahren', 840), '0,8 s');
  assert.equal(rivalGap('zeitfahren', 60), '0,06 s');
});
