import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PcsError } from './pcs.ts';
import { DEFAULT_RUN, formatReport, runSync, type RunOptions } from './sync.ts';
import { MemoryStore, fixture, fixtureHtml, memoryDb, ridersFrom, stage, tour } from './testkit.ts';
import type { SyncTour } from './plan.ts';

const html19 = fixtureHtml('tour-de-france-2018-stage-19');
const riders = ridersFrom(fixture('tour-de-france-2018-stage-19'));
const at = (hhmm: string, day = '27') => new Date(`2018-07-${day}T${hhmm}:00+02:00`);

// Etappe 18 ist schon veröffentlicht, 19 läuft heute, 20 ist morgen, 21 übermorgen
function setup(t: Partial<SyncTour> = {}) {
  const stages = [
    stage({ id: 18, number: 18, starts_at: '2018-07-26T10:00:00Z', results_published: true }),
    stage({ id: 19, number: 19 }),
    stage({ id: 20, number: 20, starts_at: '2018-07-28T10:00:00Z', distance_km: 31, kind: 'itt' }),
    stage({ id: 21, number: 21, starts_at: '2018-07-29T14:00:00Z', distance_km: 116 }),
  ];
  const db = memoryDb(tour(t), stages, riders.map((r) => ({ ...r })));
  // Etappe 18 wurde eben erst nachkontrolliert
  db.sync.push({ stage_id: 18, paused: false, paused_reason: null, checked_at: at('17:55').toISOString(), candidate: null, candidate_at: null, synced_at: null, status: 'veröffentlicht', source_url: null, last_error: null });
  return new MemoryStore(db);
}

function fetcher(pages: Record<string, string | Error> = {}) {
  const calls: string[] = [];
  const fetchPage = async (path: string) => {
    calls.push(path);
    const page = pages[path] ?? (path.endsWith('stage-19') ? html19 : new PcsError(`Seite nicht gefunden: ${path}`, 404, false));
    if (page instanceof Error) throw page;
    return page;
  };
  return { calls, fetchPage };
}

const opts = (patch: Partial<RunOptions>): RunOptions => ({
  ...DEFAULT_RUN, now: at('18:00'), dryRun: false, delayMs: 0, completeness: 0, ...patch,
});
const noSleep = async () => undefined;

test('Zwei Läufe: erst lesen, dann veröffentlichen – samt Ausstieg und Bonus-Zwischenstand', async () => {
  const store = setup();
  const f = fetcher();
  // 18:00: Etappe 19 gelesen; Etappe 20 (morgen) auf Änderungen geprüft; 18 nicht erneut (eben geprüft), 21 zu weit weg
  const r1 = await runSync(opts({}), { store, fetchPage: f.fetchPage, sleep: noSleep });
  assert.deepEqual(f.calls, ['race/tour-de-france/2018/stage-19', 'race/tour-de-france/2018/stage-20']);
  assert.equal(store.db.stages.find((s) => s.id === 19)!.results_published, false);
  assert.match(r1.tours[0].stages.find((s) => s.number === 19)!.status, /Prüfung bis/);

  const r2 = await runSync(opts({ now: at('18:11') }), { store, fetchPage: f.fetchPage, sleep: noSleep });
  const s19 = store.db.stages.find((s) => s.id === 19)!;
  assert.equal(s19.results_published, true);
  assert.equal(store.db.results.filter((r) => r.stage_id === 19).length, 10);
  assert.equal(store.db.riders.find((r) => r.name === 'Jelle Vanendert')!.status, 'out');
  assert.equal(store.db.bonus.find((b) => b.category === 'gc' && b.position === 1)?.rider_id, riders.find((r) => r.name === 'Geraint Thomas')!.id);
  assert.equal(r2.newErrors, 0);
  const md = formatReport(r2, opts({ now: at('18:11') }));
  assert.match(md, /Ergebnis veröffentlicht: 1\. Primož Roglič, 2\. Geraint Thomas, 3\. Romain Bardet/);
  assert.match(md, /Bonus-Zwischenstand nach Etappe 19/);
});

test('Probelauf schreibt nichts', async () => {
  const store = setup();
  const f = fetcher();
  const r = await runSync(opts({ dryRun: true, force: true }), { store, fetchPage: f.fetchPage, sleep: noSleep });
  assert.equal(store.db.applied.length, 0);
  assert.equal(store.db.stages.find((s) => s.id === 19)!.results_published, false);
  assert.match(formatReport(r, opts({ dryRun: true })), /Probelauf.*\n[\s\S]*Ergebnis veröffentlicht/);
});

test('PCS blockiert: Fehler einmal melden, nicht weiter abrufen, beim nächsten Lauf nicht erneut', async () => {
  const store = setup();
  const blocked = new PcsError('procyclingstats.com blockiert den Abruf (HTTP 403, Cloudflare-Prüfung)', 403, true);
  const f = fetcher({ 'race/tour-de-france/2018/stage-19': blocked });
  const r1 = await runSync(opts({}), { store, fetchPage: f.fetchPage, sleep: noSleep });
  assert.equal(r1.newErrors, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(store.db.logs.filter((l) => l.level === 'error').length, 1);
  const r2 = await runSync(opts({ now: at('18:10') }), { store, fetchPage: f.fetchPage, sleep: noSleep });
  assert.equal(r2.newErrors, 0);
  assert.equal(store.db.logs.filter((l) => l.level === 'error').length, 1);
});

test('Automatik aus, außerhalb des Zeitraums, pausierte Etappe', async () => {
  const off = setup({ sync_mode: 'off' });
  const f = fetcher();
  assert.equal((await runSync(opts({}), { store: off, fetchPage: f.fetchPage })).tours.length, 0);
  // Probelauf einer Rundfahrt mit Automatik „aus“ geht mit --tour und --modus
  const dry = await runSync(opts({ dryRun: true, tourId: 't', mode: 'auto', stage: 19, force: true }), { store: off, fetchPage: f.fetchPage, sleep: noSleep });
  assert.equal(dry.tours[0].stages[0].status, 'veröffentlicht');

  const later = setup();
  const r = await runSync(opts({ now: new Date('2018-08-05T12:00:00+02:00') }), { store: later, fetchPage: f.fetchPage });
  assert.match(r.tours[0].skipped ?? '', /außerhalb des Zeitraums/);

  const paused = setup();
  paused.db.sync.push({ stage_id: 19, paused: true, paused_reason: 'Ergebnis von Hand geändert', checked_at: null, candidate: null, candidate_at: null, synced_at: null, status: 'pausiert', source_url: null, last_error: null });
  const f2 = fetcher();
  const rp = await runSync(opts({}), { store: paused, fetchPage: f2.fetchPage, sleep: noSleep });
  assert.ok(!f2.calls.includes('race/tour-de-france/2018/stage-19'));
  assert.equal(rp.tours[0].stages.find((s) => s.number === 19)?.status, 'pausiert');
});

test('Letzte Etappe: Hinweis, den Endstand von Hand zu setzen', async () => {
  const store = setup();
  // Etappe 19 als letzte Etappe der Rundfahrt
  store.db.stages = store.db.stages.filter((s) => s.number <= 19);
  const f = fetcher();
  await runSync(opts({ force: true }), { store, fetchPage: f.fetchPage, sleep: noSleep });
  assert.ok(store.db.logs.some((l) => /Letzte Etappe übernommen/.test(l.message)));
});
