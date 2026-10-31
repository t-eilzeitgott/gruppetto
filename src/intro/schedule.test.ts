import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALTS, advent4, dayNo, easter, pickIntro, plan, seasonOf } from './schedule';

const iso = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);

test('Ostern und Advent', () => {
  assert.equal(iso(easter(2026)), '2026-04-05');
  assert.equal(iso(easter(2027)), '2027-03-28');
  assert.equal(iso(easter(2028)), '2028-04-16');
  assert.equal(iso(advent4(2026)), '2026-12-20');
  assert.equal(iso(advent4(2027)), '2027-12-19');
  // Heiligabend an einem Sonntag: dann ist er der 4. Advent
  assert.equal(iso(advent4(2023)), '2023-12-24');
  assert.equal(dayNo(1970, 1, 1), 0);
});

test('Themen bis Jahresende 2026 und Feiertage 2027', () => {
  const at = (k: string) => { const s = seasonOf(k); return s ? `${s.id}${s.p ? ':' + s.p : ''}${s.day ? '!' : ''}` : null; };
  assert.equal(at('2026-10-31'), 'halloween!');
  assert.equal(at('2026-10-26'), 'halloween');
  assert.equal(at('2026-11-01'), 'halloween');
  assert.equal(at('2026-11-02'), 'laub');
  assert.equal(at('2026-11-11'), 'laterne!');
  assert.equal(at('2026-11-20'), 'nebel');
  assert.equal(at('2026-11-23'), 'frost');
  assert.equal(at('2026-11-28'), 'frost');
  assert.equal(at('2026-11-29'), 'advent:1!');
  assert.equal(at('2026-12-05'), 'advent:1');
  assert.equal(at('2026-12-06'), 'advent:2!');
  assert.equal(at('2026-12-13'), 'advent:3!');
  assert.equal(at('2026-12-20'), 'advent:4!');
  assert.equal(at('2026-12-23'), 'advent:4');
  assert.equal(at('2026-12-24'), 'weihnachten!');
  assert.equal(at('2026-12-27'), 'weihnachten');
  assert.equal(at('2026-12-29'), 'winter');
  assert.equal(at('2026-12-31'), 'silvester!');
  assert.equal(at('2027-01-01'), 'silvester!');
  assert.equal(at('2027-01-03'), 'neujahr:2027');
  assert.equal(at('2027-01-07'), null);
  assert.equal(at('2027-02-14'), 'valentin!');
  assert.equal(at('2027-02-04'), 'karneval');
  assert.equal(at('2027-02-08'), 'karneval!');
  assert.equal(at('2027-02-10'), null);
  assert.equal(at('2027-03-26'), 'ostern');
  assert.equal(at('2027-03-28'), 'ostern!');
  assert.equal(at('2027-03-29'), 'ostern');
  assert.equal(at('2027-06-15'), null);
});

test('Auswahl: Thema, jedes dritte Mal Abwechslung, Renntag, Vorschau', () => {
  const day = '2026-10-31';
  // erster Start des Tages: immer das Thema – auch wenn es der dritte wäre
  assert.equal(pickIntro({ day, n: 3, firstToday: true }).id, 'halloween');
  assert.equal(pickIntro({ day, n: 4, firstToday: false }).id, 'halloween');
  const alt = pickIntro({ day, n: 6, firstToday: false });
  assert.equal(alt.why, 'abwechslung');
  assert.ok(ALTS.includes(alt.id));
  // ohne Thema: gewohnt, jedes dritte Mal reihum eine Abwechslung
  const plain = '2027-06-15';
  assert.equal(pickIntro({ day: plain, n: 1, firstToday: true }).id, 'base');
  assert.equal(pickIntro({ day: plain, n: 2, firstToday: false }).id, 'base');
  const seen = new Set<string>();
  for (let n = 3; n <= 3 * ALTS.length; n += 3) seen.add(pickIntro({ day: plain, n, firstToday: false }).id);
  assert.equal(seen.size, ALTS.length);
  // Renntag geht vor
  const race = { t: 'giro', n: 7, k: 'mountain' };
  const r = pickIntro({ day: plain, n: 1, firstToday: true, race });
  assert.equal(r.id, 'renntag');
  assert.equal(r.race?.n, 7);
  // Vorschau
  assert.deepEqual(pickIntro({ day: plain, n: 5, firstToday: false, force: 'advent:3' }), { id: 'advent', p: '3', why: 'vorschau' });
  assert.equal(pickIntro({ day: plain, n: 5, firstToday: false, force: 'renntag:itt' }).race?.k, 'itt');
  assert.equal(pickIntro({ day: plain, n: 5, firstToday: false, force: 'unsinn' }).why, 'standard');
});

test('Plan: Abschnitte bis Jahresende', () => {
  const p = plan('2026-10-31', 70);
  assert.deepEqual(p.slice(0, 3).map((s) => `${s.id} ${s.from}–${s.to}`), [
    'halloween 2026-10-31–2026-11-01', 'laub 2026-11-02–2026-11-08', 'laterne 2026-11-09–2026-11-15',
  ]);
  assert.ok(p.some((s) => s.id === 'advent' && s.p === '4' && s.from === '2026-12-20' && s.to === '2026-12-23'));
  assert.ok(p.some((s) => s.id === 'silvester' && s.from === '2026-12-31' && s.to === '2027-01-01'));
});
