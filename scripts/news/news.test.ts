import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clip, decode, parseFeed, plain } from './parse.ts';
import { FEEDS, build, cluster, importance, keys, topics, wanted } from './rank.ts';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Radsport</title>
<item><title><![CDATA[Pogačar gewinnt die Lombardei-Rundfahrt zum fünften Mal]]></title>
<link>https://www.radsport-news.com/sport/sportnews_1.htm</link>
<description><![CDATA[<p>Der Slowene siegte nach einer <b>Soloattacke</b> &amp; 30 km Flucht.</p><img src="x.jpg"/>]]></description>
<pubDate>Sat, 31 Oct 2026 16:20:00 +0100</pubDate><category>Straße</category></item>
<item><title>Ohne Datum</title><link>https://example.org/a</link></item>
<item><title>Lipowitz verl&#228;ngert bei Red Bull &#8211; Vertrag bis 2029</title><link>https://www.radsport-news.com/sport/sportnews_2.htm</link>
<pubDate>Sun, 01 Nov 2026 09:00:00 +0100</pubDate></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Sportschau Radsport</title>
<entry><title>Pogačar holt Lombardei-Sieg</title><link rel="alternate" href="https://www.sportschau.de/radsport/lombardei-100.html"/>
<link rel="enclosure" href="https://www.sportschau.de/x.jpg"/><summary>Tadej Pogačar hat erneut gewonnen.</summary>
<published>2026-10-31T17:05:00+01:00</published><updated>2026-10-31T18:00:00+01:00</updated></entry></feed>`;

test('RSS: CDATA, Entitäten, HTML im Anriss; Einträge ohne Datum fallen weg', () => {
  const items = parseFeed(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Pogačar gewinnt die Lombardei-Rundfahrt zum fünften Mal');
  assert.equal(items[0].summary, 'Der Slowene siegte nach einer Soloattacke & 30 km Flucht.');
  assert.deepEqual(items[0].categories, ['Straße']);
  assert.equal(items[1].title, 'Lipowitz verlängert bei Red Bull – Vertrag bis 2029');
  assert.equal(items[0].published.toISOString(), '2026-10-31T15:20:00.000Z');
});

test('Atom: Link „alternate“, Zusammenfassung, Veröffentlichung', () => {
  const [e] = parseFeed(ATOM);
  assert.equal(e.url, 'https://www.sportschau.de/radsport/lombardei-100.html');
  assert.equal(e.summary, 'Tadej Pogačar hat erneut gewonnen.');
  assert.equal(e.published.toISOString(), '2026-10-31T16:05:00.000Z');
});

test('Hilfen: Entitäten, Fließtext, Kürzen an der Wortgrenze', () => {
  assert.equal(decode('&#x2019;&auml;&nbsp;&quot;'), '’ä "');
  assert.equal(plain('<p>Hallo</p><p>Welt</p> The post X appeared first on Y.'), 'Hallo Welt');
  assert.equal(clip('Ein sehr langer Satz mit vielen Wörtern', 22), 'Ein sehr langer Satz…');
});

test('Profi-Radsport: Tests, Angebote und Kaufberatung fallen weg; Rubrik-Filter je Quelle', () => {
  const cn = FEEDS.find((f) => f.id === 'cyclingnews')!;
  const item = (title: string, url: string) => ({ title, url, summary: '', published: new Date(), categories: [] });
  assert.equal(wanted(cn, item('Evenepoel wins Worlds time trial', 'https://www.cyclingnews.com/pro-cycling/races/x/')), true);
  assert.equal(wanted(cn, item('Best road bike deals for Black Friday', 'https://www.cyclingnews.com/pro-cycling/x/')), false);
  assert.equal(wanted(cn, item('Specialized Tarmac SL9 review', 'https://www.cyclingnews.com/reviews/x/')), false);
  const rn = FEEDS.find((f) => f.id === 'radsport-news')!;
  assert.equal(wanted(rn, item('Rennrad im Test: das neue Aero-Rad', 'https://www.radsport-news.com/x')), false);
});

test('Themen und Namen', () => {
  assert.deepEqual(topics('Lipowitz verlängert bei Red Bull', ''), ['transfer']);
  assert.ok(topics('Sturz auf der 3. Etappe: Kämna mit Schlüsselbeinbruch', '').includes('verletzung'));
  assert.ok(topics('Pogačar wins Il Lombardia again', '').includes('rennen'));
  assert.deepEqual(keys('Tadej Pogačar gewinnt Lombardei'), ['pogacar', 'lombard']);
});

test('Bündeln: dieselbe Meldung bei zwei Quellen (auch über die Sprache hinweg), nicht innerhalb einer Quelle', () => {
  const t = new Date('2026-10-31T16:00:00Z');
  const list = [
    { id: 'a', source: 'Radsport-News', title: 'Pogačar gewinnt die Lombardei-Rundfahrt zum fünften Mal', published: t },
    { id: 'b', source: 'Cyclingnews', title: 'Pogačar wins Il Lombardia for fifth time', published: new Date(t.getTime() + 3600e3) },
    { id: 'c', source: 'Sportschau', title: 'Lipowitz verlängert bei Red Bull', published: t },
    { id: 'd', source: 'Radsport-News', title: 'Pogačar: Saisonplanung für 2027 steht', published: t },
  ];
  const cl = cluster(list);
  assert.equal(cl.get('a'), cl.get('b'));
  assert.notEqual(cl.get('a'), cl.get('c'));
  assert.notEqual(cl.get('a'), cl.get('d'));
});

test('Zeilen für die Datenbank: doppelte Links einmal, Bündel zählt Quellen, Stars und Bündel wiegen mehr', () => {
  const rn = FEEDS.find((f) => f.id === 'radsport-news')!;
  const cn = FEEDS.find((f) => f.id === 'cyclingnews')!;
  const now = new Date('2026-11-01T12:00:00Z');
  const it = (title: string, url: string, h: number) => ({ title, url, summary: '', published: new Date(now.getTime() - h * 3600e3), categories: [] });
  const rows = build([
    { feed: rn, item: it('Pogačar gewinnt die Lombardei-Rundfahrt', 'https://www.radsport-news.com/1', 20) },
    { feed: rn, item: it('Pogačar gewinnt die Lombardei-Rundfahrt', 'https://www.radsport-news.com/1/', 20) },
    { feed: cn, item: it('Pogačar wins Il Lombardia', 'https://www.cyclingnews.com/pro-cycling/races/1/', 19) },
    { feed: rn, item: it('Neuer Sponsor für Kontinental-Team', 'https://www.radsport-news.com/2', 2) },
    { feed: rn, item: it('Zeitstempel aus der Zukunft', 'https://www.radsport-news.com/3', -5) },
  ], [], now);
  assert.equal(rows.length, 4);
  const pog = rows.find((r) => r.url.endsWith('/1'))!;
  assert.equal(pog.sources, 2);
  assert.ok(pog.cluster);
  assert.ok(pog.score > rows.find((r) => r.url.endsWith('/2'))!.score);
  assert.equal(rows.find((r) => r.url.endsWith('/3'))!.published_at, now.toISOString());
  assert.ok(importance('Pogačar und Vingegaard bei der Tour', ['rennen'], 1, 'en') > importance('Neues Team', ['team'], 1, 'en'));
});
