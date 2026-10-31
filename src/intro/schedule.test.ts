import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALTS, pickIntro } from './schedule';

test('Auswahl: gewohnt, jedes dritte Mal Abwechslung reihum', () => {
  const day = '2026-12-24';
  assert.equal(pickIntro({ day, n: 1, firstToday: true }).id, 'base');
  assert.equal(pickIntro({ day, n: 2, firstToday: false }).id, 'base');
  const seen = new Set<string>();
  for (let n = 3; n <= 3 * ALTS.length; n += 3) {
    const p = pickIntro({ day, n, firstToday: false });
    assert.equal(p.why, 'abwechslung');
    seen.add(p.id);
  }
  assert.equal(seen.size, ALTS.length);
  // keine Feiertags-Themen mehr
  for (const d of ['2026-10-31', '2026-12-24', '2026-12-31', '2027-03-28']) assert.equal(pickIntro({ day: d, n: 1, firstToday: true }).id, 'base');
});

test('Renntag und Vorschau', () => {
  const race = { t: 'giro', n: 7, k: 'mountain' };
  const r = pickIntro({ day: '2027-05-14', n: 1, firstToday: true, race });
  assert.equal(r.id, 'renntag');
  assert.equal(r.race?.n, 7);
  // am ersten Start des Tages immer, sonst jedes dritte Mal Abwechslung
  assert.equal(pickIntro({ day: '2027-05-14', n: 3, firstToday: true, race }).id, 'renntag');
  assert.equal(pickIntro({ day: '2027-05-14', n: 6, firstToday: false, race }).why, 'abwechslung');
  assert.deepEqual(pickIntro({ day: '2027-06-15', n: 5, firstToday: false, force: 'welle' }), { id: 'welle', why: 'vorschau' });
  assert.equal(pickIntro({ day: '2027-06-15', n: 5, firstToday: false, force: 'renntag:itt' }).race?.k, 'itt');
  assert.equal(pickIntro({ day: '2027-06-15', n: 5, firstToday: false, force: 'halloween' }).why, 'standard');
});
