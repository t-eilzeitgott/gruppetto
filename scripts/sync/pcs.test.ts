import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDate, parseDuration, parseStagePage, parseStartTime, stagePath, fetchPcsPage, PcsError } from './pcs.ts';
import { parseHtml, select, selectAll, text } from './html.ts';

// Echte PCS-Seiten (aktueller Aufbau: Giro 2026, älterer: Tour 2018/2022), gekürzt auf die ersten
// 12 Plätze je Wertung (Aufbau unverändert), siehe fixtures/README.md
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf8');

test('HTML-Parser: Selektoren, Entities, kaputte Tags', () => {
  const doc = parseHtml('<div class="a b"><ul><li>Eins<li>Zwei &amp; Drei</ul><p>x<br>y</p><table><tr><td>1<td>2</table></div><span>&#8243;&nbsp;</span>');
  assert.equal(selectAll(doc, 'div.a li').length, 2);
  assert.equal(text(selectAll(doc, 'li')[1]), 'Zwei & Drei');
  assert.equal(selectAll(doc, 'table td').length, 2);
  assert.equal(select(doc, 'div.b > ul > li')?.tag, 'li');
  assert.equal(select(doc, 'ul > p'), null);
  assert.equal(text(select(doc, 'span')), '″');
  assert.equal(select(parseHtml('<a href="rider/x">x</a>'), 'a[href^="rider/"]')?.attrs.href, 'rider/x');
});

test('Hilfsfunktionen für Datum, Start- und Siegerzeit', () => {
  assert.equal(parseDate('24 July 2022'), '2022-07-24');
  assert.equal(parseDate('9 May 2027, Saturday'), '2027-05-09');
  assert.equal(parseStartTime('16:45 '), '16:45');
  assert.equal(parseStartTime('13:05 (12:05 CET)'), '12:05');
  // Platzhalter bei künftigen Etappen
  assert.equal(parseStartTime('00:00:00'), null);
  assert.equal(parseStartTime('01:00:00'), null);
  assert.equal(parseDuration('2:58:32'), 10712);
  assert.equal(parseDuration('38:46'), 2326);
  assert.equal(stagePath('giro-d-italia/2027', 7), 'race/giro-d-italia/2027/stage-7');
  assert.equal(stagePath('/race/tour-de-france/2027/', 1, 'prologue'), 'race/tour-de-france/2027/prologue');
});

test('Aktueller Aufbau: Giro 2026, Etappe 7 (Bergankunft Blockhaus)', () => {
  const st = parseStagePage(fixture('giro-d-italia-2026-stage-7'));
  assert.equal(st.type, 'RR');
  assert.equal(st.date, '2026-05-15');
  assert.equal(st.startTime, '10:55');
  assert.equal(st.distanceKm, 244);
  assert.equal(st.departure, 'Formia');
  assert.equal(st.arrival, 'Blockhaus');
  assert.equal(st.profile, 'p5');
  assert.equal(st.wonHow, '4.5 km solo');
  assert.deepEqual(st.tabs, ['stage', 'gc', 'points', 'kom', 'youth', 'teams']);
  const top = st.stage.filter((r) => r.rank !== null);
  assert.deepEqual(top.slice(0, 3).map((r) => [r.rank, r.name, r.bib, r.slug, r.team]), [
    [1, 'Jonas Vingegaard', 171, 'jonas-vingegaard', 'Team Visma | Lease a Bike'],
    [2, 'Felix Gall', 31, 'felix-gall', 'Decathlon CMA CGM Team'],
    [3, 'Jai Hindley', 121, 'jai-hindley', 'Red Bull - BORA - hansgrohe'],
  ]);
  assert.equal(parseDuration(top[0].time), 6 * 3600 + 9 * 60 + 15);
  assert.equal(st.gc[0].name, 'Afonso Eulálio');
  assert.equal(st.gc[1].name, 'Jonas Vingegaard');
  assert.equal(st.points[0].name, 'Paul Magnier');
  assert.equal(st.kom[0].name, 'Jonas Vingegaard');
  assert.equal(st.youth[0].name, 'Afonso Eulálio');
  assert.equal(st.teams[0].team, 'Red Bull - BORA - hansgrohe');
});

test('Aktueller Aufbau: Einzelzeitfahren mit Hundertstel, Ausstiege (DNF, DNS)', () => {
  const itt = parseStagePage(fixture('giro-d-italia-2026-stage-10'));
  assert.equal(itt.type, 'ITT');
  assert.equal(itt.stage[0].name, 'Filippo Ganna');
  assert.equal(itt.stage[0].time, '45:53,87');
  assert.equal(parseDuration(itt.stage[0].time), 45 * 60 + 53);
  assert.equal(itt.startTime, '13:15');

  const e14 = parseStagePage(fixture('giro-d-italia-2026-stage-14'));
  assert.deepEqual(e14.stage.filter((r) => r.rank === null).map((r) => [r.status, r.name, r.bib]), [['DNF', 'Christian Scaroni', 226]]);
  assert.equal(e14.arrival, 'Pila (Gressan)');

  const e21 = parseStagePage(fixture('giro-d-italia-2026-stage-21'));
  assert.deepEqual(e21.stage.filter((r) => r.rank === null).map((r) => [r.status, r.name]), [['DNS', 'Sean Flynn']]);
  assert.equal(e21.stage[0].name, 'Jonathan Milan');
  assert.equal(e21.gc[0].name, 'Jonas Vingegaard');
  assert.equal(e21.kom[0].name, 'Giulio Ciccone');
});

test('Älterer Aufbau: Tour de France 2022, Etappe 21 (Sprint, DNS, Disqualifikation)', () => {
  const st = parseStagePage(fixture('tour-de-france-2022-stage-21'));
  assert.equal(st.type, 'RR');
  assert.equal(st.date, '2022-07-24');
  assert.equal(st.startTime, '16:45');
  assert.equal(st.distanceKm, 115.6);
  assert.equal(st.departure, 'Paris La Défense');
  assert.equal(st.arrival, 'Paris (Champs-Élysées)');
  assert.equal(st.profile, 'p1');
  assert.equal(st.wonHow, 'Sprint of large group');
  assert.deepEqual(st.tabs, ['stage', 'gc', 'points', 'kom', 'youth', 'teams']);

  const top = st.stage.filter((r) => r.rank !== null);
  assert.deepEqual(top.slice(0, 3).map((r) => [r.rank, r.name, r.bib, r.slug]), [
    [1, 'Jasper Philipsen', 105, 'jasper-philipsen'],
    [2, 'Dylan Groenewegen', 204, 'dylan-groenewegen'],
    [3, 'Alexander Kristoff', 121, 'alexander-kristoff'],
  ]);
  assert.equal(top[0].team, 'Alpecin - Deceuninck');
  assert.equal(parseDuration(top[0].time), 10712);
  // Quintana wurde nachträglich disqualifiziert (durchgestrichener Platz)
  const quintana = st.stage.find((r) => r.slug === 'nairo-quintana');
  assert.ok(quintana?.removed);
  assert.equal(quintana?.rank, null);
  assert.deepEqual(st.stage.filter((r) => r.status === 'DNS').map((r) => r.name), ['Gorka Izagirre', 'Michael Woods', 'Guillaume Boivin']);

  assert.equal(st.gc[0].name, 'Jonas Vingegaard');
  assert.equal(st.gc[1].name, 'Tadej Pogačar');
  assert.equal(st.points[0].name, 'Wout van Aert');
  assert.equal(st.kom[0].name, 'Jonas Vingegaard');
  assert.equal(st.youth[0].name, 'Tadej Pogačar');
  assert.equal(st.teams[0].team, 'INEOS Grenadiers');
});

test('Älterer Aufbau: Tour de France 2018, Etappe 19 (Bergetappe mit Ausstieg)', () => {
  const st = parseStagePage(fixture('tour-de-france-2018-stage-19'));
  assert.equal(st.type, 'RR');
  assert.equal(st.startTime, '12:15');
  assert.equal(st.profile, 'p4');
  assert.equal(st.stage[0].name, 'Primož Roglič');
  assert.equal(st.stage[1].name, 'Geraint Thomas');
  assert.deepEqual(st.stage.filter((r) => r.status === 'DNF').map((r) => r.name), ['Jelle Vanendert']);
  assert.equal(st.gc[0].name, 'Geraint Thomas');
  assert.equal(st.stage.filter((r) => r.rank !== null).length, 12);
});

test('Älterer Aufbau: Mannschaftszeitfahren wird erkannt, Gesamtwertung trotzdem gelesen', () => {
  const st = parseStagePage(fixture('tour-de-france-2018-stage-3'));
  assert.equal(st.type, 'TTT');
  assert.equal(st.stage.length, 0);
  assert.equal(st.gc[0].name, 'Greg Van Avermaet');
  assert.ok(st.gc.length >= 10);
});

test('Etappenseite vor dem Rennen: keine Ergebnisse, aber Infos', () => {
  const html = fixture('giro-d-italia-2026-stage-7').replace(/<tbody>[\s\S]*?<\/tbody>/g, '<tbody></tbody>');
  const st = parseStagePage(html);
  assert.equal(st.stage.length, 0);
  assert.equal(st.gc.length, 0);
  assert.equal(st.distanceKm, 244);
  assert.equal(st.startTime, '10:55');
});

test('Abruf: Cloudflare-Sperre wird als solche gemeldet, 404 ohne Wiederholung', async () => {
  let calls = 0;
  const blocked = (async () => {
    calls += 1;
    return new Response('<html><title>Just a moment...</title></html>', { status: 403, headers: { 'cf-mitigated': 'challenge' } });
  }) as typeof fetch;
  await assert.rejects(fetchPcsPage('race/x/2027/stage-1', { fetchImpl: blocked, retries: 2 }), (e: unknown) => e instanceof PcsError && e.blocked);
  assert.equal(calls, 1);

  let tries = 0;
  const flaky = (async () => {
    tries += 1;
    if (tries < 2) throw new TypeError('fetch failed');
    return new Response('<html>ok</html>', { status: 200 });
  }) as typeof fetch;
  assert.equal(await fetchPcsPage('race/x/2027/stage-1', { fetchImpl: flaky, retries: 2, retryDelayMs: 1 }), '<html>ok</html>');
});
