import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ago, bundle, byDay, dayLabel, highlight, nameMarks, sourceName, topStory, type FeedEntry } from './newsFeed';
import type { NewsItem } from './types';

const item = (id: string, h: number, over: Partial<NewsItem> = {}): NewsItem => ({
  id, source: 'cyclingnews', lang: 'en', title: `Meldung ${id}`, summary: null, url: `https://x.org/${id}`,
  published_at: new Date(NOW - h * 3600e3).toISOString(), topics: [], cluster: null, sources: 1, score: 1, ...over,
});
const NOW = new Date(2027, 4, 16, 15, 0).getTime();
const last = (n: string) => n.split(' ').slice(1).join(' ');

test('Quellen: bekannte Namen, sonst lesbar gemacht', () => {
  assert.equal(sourceName('inrng'), 'The Inner Ring');
  assert.equal(sourceName('radsport-news'), 'Radsport-News');
  assert.equal(sourceName('neue-quelle'), 'Neue Quelle');
});

test('Bündel: deutsche Fassung vorn, Zeit der ersten Meldung, übrige Quellen', () => {
  const list = bundle([
    item('a', 1, { cluster: 'c', score: 2 }),
    item('b', 3, { cluster: 'c', source: 'radsport-news', lang: 'de', score: 1.5 }),
    item('c', 2, { cluster: 'c', source: 'velo', score: 1 }),
    item('d', 0.5),
  ]);
  assert.equal(list.length, 2);
  const c = list.find((x) => x.cluster === 'c')!;
  assert.equal(c.id, 'b');
  assert.equal(c.published_at, item('x', 3).published_at);
  assert.deepEqual(c.also.sort(), ['cyclingnews', 'velo']);
  assert.equal(c.sources, 3);
  assert.equal(c.score, 2);
  assert.equal(list[0].id, 'd'); // neueste zuerst
});

test('Topthema: Gewicht und Frische, nichts Älteres als zwei Tage', () => {
  const list = bundle([item('alt', 50, { score: 9 }), item('frisch', 1, { score: 1.4 }), item('stark', 6, { score: 2.6 })]);
  assert.equal(topStory(list, NOW)?.id, 'stark');
  assert.equal(topStory(bundle([item('alt', 50, { score: 9 })]), NOW), null);
});

test('Tage und Zeiten', () => {
  assert.equal(dayLabel(NOW - 3600e3, NOW), 'Heute');
  assert.equal(dayLabel(NOW - 20 * 3600e3, NOW), 'Gestern');
  assert.equal(dayLabel(new Date(2027, 4, 12, 9).getTime(), NOW), 'Mittwoch, 12. Mai');
  assert.equal(ago(NOW - 30e3, NOW), 'gerade eben');
  assert.equal(ago(NOW - 12 * 60e3, NOW), 'vor 12 Min.');
  assert.equal(ago(NOW - 3 * 3600e3, NOW), 'vor 3 Std.');
  assert.equal(ago(NOW - 20 * 3600e3, NOW), 'gestern');
  assert.equal(ago(NOW - 75 * 3600e3, NOW), 'vor 3 Tagen');
  const e = (h: number): FeedEntry => ({ type: 'news', at: NOW - h * 3600e3, item: { ...item('x', h), also: [] } });
  const days = byDay([e(30), e(1), e(2), e(60)], NOW);
  assert.deepEqual(days.map((d) => [d.label, d.entries.length]), [['Heute', 2], ['Gestern', 1], ['Freitag, 14. Mai', 1]]);
});

test('Namen hervorheben: Akzente, Groß/klein, Genitiv, Wortgrenzen, Favoriten', () => {
  const marks = nameMarks([
    { name: 'Tadej Pogačar', fav: true }, { name: 'Jonas Vingegaard', fav: false },
    { name: 'Mathieu van der Poel', fav: false }, { name: 'Ion Izagirre', fav: false }, { name: 'Max Kanter', fav: false },
  ], last);
  const segs = highlight('Pogacars Angriff: VINGEGAARD kontert, van der Poel und Kanters Team', marks);
  assert.deepEqual(segs.filter((s) => s.mark).map((s) => [s.text, s.mark]), [
    ['Pogacars', 'fav'], ['VINGEGAARD', 'start'], ['van der Poel', 'start'], ['Kanters', 'start'],
  ]);
  assert.equal(segs.map((s) => s.text).join(''), 'Pogacars Angriff: VINGEGAARD kontert, van der Poel und Kanters Team');
  // kein Treffer mitten im Wort
  assert.equal(highlight('Kanterssieg und Pogačarfans', marks).filter((s) => s.mark).length, 0);
  // mit Akzent im Text
  assert.deepEqual(highlight('Sieg für Pogačar', marks).map((s) => s.text), ['Sieg für ', 'Pogačar']);
  assert.deepEqual(highlight('Ohne Namen', []), [{ text: 'Ohne Namen' }]);
});
