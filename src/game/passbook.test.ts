import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passStamps } from './passbook';
import { Track, SEG } from './abfahrt/track';

test('Passbuch: Abfahrt stempelt die erreichten Passhöhen, Bergfinale den Anstieg des Tages, Mehrfachfahrten zählen', () => {
  const day = '2026-10-27T12:00:00+01:00';
  const t = new Track('2026-10-27', [], 'descent');
  t.seg(6000 / SEG);
  const passes = t.sections.filter((s) => s.biome === 'pass');
  assert.ok(passes.length >= 2, 'mindestens zwei Pässe auf 6 km');
  const second = passes[1].start * SEG;
  const stamps = passStamps([
    { game: 'abfahrt', meters: second + 50, created_at: day },
    { game: 'abfahrt', meters: 300, created_at: day },
    { game: 'sprint', meters: 2400, created_at: day },
    { game: 'berg', meters: 2000, created_at: day },
  ], null, null);
  const first = stamps.find((s) => s.name === passes[0].name)!;
  assert.equal(first.count, 2, 'Startpass zweimal');
  assert.equal(stamps.find((s) => s.name === passes[1].name)?.count, 1);
  assert.ok(stamps.length >= 3, 'dazu der Pass des Bergfinales');
  assert.ok(stamps.every((s) => s.alt > 500 && s.first === '2026-10-27'));
  // Sortierung: höchster Pass zuerst
  for (let i = 1; i < stamps.length; i++) assert.ok(stamps[i - 1].alt >= stamps[i].alt);
});
