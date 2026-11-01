/**
 * News-Tab: Meldungen aufbereiten – gleiche Meldung mehrerer Quellen zu einer bündeln, Topthema wählen, nach Tagen
 * gliedern, Fahrernamen aus Startliste und Favoriten hervorheben. Reine Funktionen (getestet).
 */
import type { NewsItem } from './types';
import type { RoundNews } from './roundNews';

export const SOURCE_NAMES: Record<string, string> = {
  'radsport-news': 'Radsport-News',
  sportschau: 'Sportschau',
  cyclingnews: 'Cyclingnews',
  cyclingweekly: 'Cycling Weekly',
  velo: 'Velo',
  inrng: 'The Inner Ring',
  escape: 'Escape Collective',
  beispiel: 'Beispiel',
};
export const sourceName = (id: string) => SOURCE_NAMES[id] ?? id.replace(/(^|-)(\w)/g, (_, d: string, c: string) => `${d ? ' ' : ''}${c.toUpperCase()}`);

export type NewsFilter = 'alle' | 'runde' | 'rennen' | 'transfer' | 'verletzung';
export const NEWS_FILTERS: { id: NewsFilter; label: string }[] = [
  { id: 'alle', label: 'Alle' },
  { id: 'runde', label: 'Tipprunde' },
  { id: 'rennen', label: 'Rennen' },
  { id: 'transfer', label: 'Transfers' },
  { id: 'verletzung', label: 'Verletzungen' },
];

/** eine Meldung im Feed – bei mehreren Quellen die beste Fassung (Deutsch zuerst) mit den übrigen Quellen */
export interface FeedNews extends NewsItem {
  /** weitere Quellen derselben Meldung (Kurznamen) */
  also: string[];
}

export type FeedEntry =
  | { type: 'news'; at: number; item: FeedNews }
  | { type: 'round'; at: number; item: RoundNews };

/** Bündel zusammenfassen: je Cluster eine Meldung (Deutsch, dann Gewicht, dann früheste), Zeit der ersten Meldung */
export function bundle(items: NewsItem[]): FeedNews[] {
  const groups = new Map<string, NewsItem[]>();
  for (const it of items) {
    const key = it.cluster ?? `id:${it.id}`;
    const g = groups.get(key);
    if (g) g.push(it); else groups.set(key, [it]);
  }
  const out: FeedNews[] = [];
  for (const g of groups.values()) {
    const best = [...g].sort((a, b) => Number(b.lang === 'de') - Number(a.lang === 'de') || b.score - a.score || a.published_at.localeCompare(b.published_at))[0];
    const first = g.reduce((m, x) => (x.published_at < m ? x.published_at : m), best.published_at);
    const also = [...new Set(g.filter((x) => x !== best).map((x) => x.source).filter((s) => s !== best.source))];
    out.push({ ...best, published_at: first, also, sources: Math.max(best.sources, also.length + 1), score: Math.max(...g.map((x) => x.score)) });
  }
  return out.sort((a, b) => b.published_at.localeCompare(a.published_at));
}

/** Topthema: gewichtig und frisch (Gewicht fällt mit dem Alter), höchstens zwei Tage alt */
export function topStory(items: FeedNews[], now: number): FeedNews | null {
  let best: FeedNews | null = null;
  let bestRank = -1;
  for (const it of items) {
    const age = (now - Date.parse(it.published_at)) / 3600e3;
    if (age > 48 || age < -1) continue;
    const rank = it.score / (1 + Math.max(0, age) / 10);
    if (rank > bestRank) { best = it; bestRank = rank; }
  }
  return best;
}

export function matches(item: FeedNews, filter: NewsFilter): boolean {
  if (filter === 'alle') return true;
  if (filter === 'runde') return false;
  return item.topics.includes(filter);
}

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** „Heute“, „Gestern“, „Mittwoch, 14. Mai“ */
export function dayLabel(t: number, now: number): string {
  const diff = Math.round((startOfDay(now) - startOfDay(t)) / 864e5);
  if (diff <= 0) return 'Heute';
  if (diff === 1) return 'Gestern';
  const d = new Date(t);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
}

/** „gerade eben“, „vor 12 Min.“, „vor 3 Std.“, „gestern“, „vor 3 Tagen“ */
export function ago(t: number, now: number): string {
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 2) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.floor(min / 60);
  if (h < 12 || startOfDay(t) === startOfDay(now)) return `vor ${h} Std.`;
  const days = Math.round((startOfDay(now) - startOfDay(t)) / 864e5);
  if (days <= 1) return 'gestern';
  return `vor ${days} Tagen`;
}

/** nach Tagen gliedern (neueste zuerst) */
export function byDay(entries: FeedEntry[], now: number): { label: string; key: number; entries: FeedEntry[] }[] {
  const out: { label: string; key: number; entries: FeedEntry[] }[] = [];
  for (const e of [...entries].sort((a, b) => b.at - a.at)) {
    const key = startOfDay(e.at);
    const last = out[out.length - 1];
    if (last && last.key === key) last.entries.push(e);
    else out.push({ label: dayLabel(e.at, now), key, entries: [e] });
  }
  return out;
}

// ------------------------------------------------------------------ Namen hervorheben

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface NameMark { name: string; fav: boolean }
export type Segment = { text: string; mark?: 'fav' | 'start' };

/** Nachnamen (ab 4 Buchstaben) zum Hervorheben; Favoriten gewinnen bei gleichem Namen */
export function nameMarks(riders: { name: string; fav: boolean }[], last: (n: string) => string): NameMark[] {
  const by = new Map<string, NameMark>();
  for (const r of riders) {
    const n = last(r.name).trim();
    if (fold(n).replace(/[^a-z]/g, '').length < 4) continue;
    const k = fold(n);
    const prev = by.get(k);
    if (!prev || (r.fav && !prev.fav)) by.set(k, { name: n, fav: r.fav || !!prev?.fav });
  }
  // längere Namen zuerst („van der Poel“ vor „Poel“)
  return [...by.values()].sort((a, b) => b.name.length - a.name.length);
}

/** Überschrift in Stücke teilen: Namen aus der Liste markiert (ohne Rücksicht auf Akzente und Groß/klein) */
export function highlight(text: string, marks: NameMark[]): Segment[] {
  if (!marks.length || !text) return [{ text }];
  const folded = fold(text);
  // gefaltete Länge kann abweichen (ß bleibt ß, Akzente fallen weg): Zeichen für Zeichen abbilden
  const map: number[] = [];
  let acc = '';
  for (let i = 0; i < text.length; i++) {
    const f = fold(text[i]);
    for (let j = 0; j < f.length; j++) map.push(i);
    acc += f;
  }
  if (acc !== folded) return [{ text }];
  const hits: { from: number; to: number; ff: number; ft: number; fav: boolean }[] = [];
  const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
  for (const m of marks) {
    const needle = fold(m.name);
    let at = folded.indexOf(needle);
    while (at >= 0) {
      const end = at + needle.length;
      // Wortgrenzen; ein angehängtes „s“ (Genitiv) zählt mit: „Pogačars“
      const after = folded[end] === 's' && !isWord(folded[end + 1]) ? end + 1 : end;
      if (!isWord(folded[at - 1]) && !isWord(folded[after]) && !hits.some((h) => at < h.ft && after > h.ff)) {
        hits.push({ from: map[at], to: map[after - 1] + 1, ff: at, ft: after, fav: m.fav });
      }
      at = folded.indexOf(needle, at + 1);
    }
  }
  if (!hits.length) return [{ text }];
  hits.sort((a, b) => a.from - b.from);
  const out: Segment[] = [];
  let pos = 0;
  for (const h of hits) {
    if (h.from > pos) out.push({ text: text.slice(pos, h.from) });
    out.push({ text: text.slice(h.from, h.to), mark: h.fav ? 'fav' : 'start' });
    pos = h.to;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}

/** zuletzt geholt (für „Stand 14:17“) */
export function fetchedAt(items: NewsItem[]): number | null {
  let t = 0;
  for (const it of items) if (it.fetched_at) t = Math.max(t, Date.parse(it.fetched_at));
  return t || null;
}
