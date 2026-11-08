import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REACTIONS, arrivals, isReaction, recentPeople, summarize, toggle, type StageReaction } from './reactions';

const r = (user_id: string, emoji: StageReaction['emoji'], at: string): StageReaction => ({ stage_id: 1, user_id, emoji, created_at: `2027-07-03T12:00:${at}Z` });

test('Reaktionen: Zählung in fester Reihenfolge, eigene markiert, neueste zuerst', () => {
  const rows = [r('anna', '🔥', '01'), r('ben', '🔥', '05'), r('me', '😂', '03'), r('fremd', '🔥', '09')];
  const s = summarize(rows, 'me', new Set(['anna', 'ben', 'me']));
  assert.equal(s.length, REACTIONS.length);
  assert.deepEqual(s[0], { emoji: '🔥', count: 2, mine: false, users: ['ben', 'anna'] });
  assert.equal(s.find((x) => x.emoji === '😂')?.mine, true);
  assert.equal(s.find((x) => x.emoji === '🐐')?.count, 0);
});

test('Reaktionen: nur neue von anderen gelten als Ankunft', () => {
  const prev = [r('anna', '🔥', '01')];
  const next = [r('anna', '🔥', '01'), r('me', '👏', '02'), r('ben', '😱', '04'), r('lena', '🔥', '03')];
  assert.deepEqual(arrivals(prev, next, 'me').map((x) => x.user_id), ['lena', 'ben']);
});

test('Reaktionen: an/aus ohne Doppel, Liste der Leute', () => {
  let rows: StageReaction[] = [];
  rows = toggle(rows, r('me', '🔥', '01'), true);
  rows = toggle(rows, r('me', '🔥', '02'), true);
  assert.equal(rows.length, 1);
  rows = toggle(rows, r('anna', '🐐', '03'), true);
  rows = toggle(rows, r('me', '😂', '04'), true);
  assert.deepEqual(recentPeople(rows), [
    { user_id: 'me', emojis: ['😂', '🔥'], at: '2027-07-03T12:00:04Z' },
    { user_id: 'anna', emojis: ['🐐'], at: '2027-07-03T12:00:03Z' },
  ]);
  rows = toggle(rows, r('me', '🔥', '05'), false);
  assert.equal(rows.length, 2);
  assert.equal(isReaction('🔥'), true);
  assert.equal(isReaction('🍕'), false);
});
