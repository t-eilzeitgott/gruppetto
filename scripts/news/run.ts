// Nachrichten holen (Workflow „News“, mehrmals täglich): alle Feeds lesen, auf Profi-Radsport filtern, bündeln,
// gewichten und in public.news schreiben; Meldungen älter als 21 Tage löschen.
//   node --no-warnings scripts/news/run.ts [--probelauf]
// Umgebung: SUPABASE_URL, SUPABASE_SECRET_KEY (ohne beides: nur Probelauf)
import { FEEDS, build, wanted, type NewsRow, type Scored } from './rank.ts';
import { parseFeed } from './parse.ts';

const dry = process.argv.includes('--probelauf') || !process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY;
const URL_ = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SECRET_KEY ?? '';
const KEEP_DAYS = 21;
/** nur Meldungen der letzten Tage (manche Feeds liefern Monate zurück) */
const MAX_AGE_DAYS = 6;

async function db<T>(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { apikey: KEY, 'Content-Type': 'application/json' };
  if (KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${KEY}`;
  if (init.prefer) headers.Prefer = init.prefer;
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const t = await res.text();
  return (t ? JSON.parse(t) : null) as T;
}

async function fetchFeed(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'gruppetto-news/1.0 (+https://github.com/t-eilzeitgott/gruppetto)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' },
    signal: AbortSignal.timeout(20000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const now = new Date();
  const items: Scored[] = [];
  const report: string[] = [];
  await Promise.all(FEEDS.map(async (feed) => {
    try {
      const raw = parseFeed(await fetchFeed(feed.url));
      const recent = raw.filter((i) => now.getTime() - i.published.getTime() < MAX_AGE_DAYS * 86400e3);
      const keep = recent.filter((i) => wanted(feed, i));
      for (const item of keep) items.push({ feed, item });
      report.push(`${feed.name}: ${raw.length} im Feed, ${recent.length} aktuell, ${keep.length} übernommen`);
    } catch (e) {
      report.push(`${feed.name}: FEHLER ${String(e instanceof Error ? e.message : e)}`);
    }
  }));
  report.sort();
  for (const r of report) console.log(r);
  if (report.every((r) => r.includes('FEHLER'))) throw new Error('keine Quelle erreichbar');

  let prior: { id: string; source: string; title: string; published_at: string; lang?: 'de' | 'en' }[] = [];
  if (!dry) {
    const since = new Date(now.getTime() - 3 * 86400e3).toISOString();
    prior = await db(`news?select=id,source,title,published_at,lang&published_at=gte.${encodeURIComponent(since)}`);
  }
  const rows: NewsRow[] = build(items, prior, now);
  rows.sort((a, b) => b.published_at.localeCompare(a.published_at));
  console.log(`\n${rows.length} Meldungen, davon ${rows.filter((r) => r.sources > 1).length} bei mehreren Quellen`);
  for (const r of [...rows].sort((a, b) => b.score - a.score).slice(0, 12)) {
    console.log(`  ${r.score.toFixed(2)}  ${r.published_at.slice(5, 16).replace('T', ' ')}  [${r.source}${r.sources > 1 ? ` +${r.sources - 1}` : ''}] ${r.title}${r.topics.length ? `  (${r.topics.join(', ')})` : ''}`);
  }
  if (dry) { console.log('\nProbelauf: nichts gespeichert'); return; }
  if (!rows.length) { console.log('nichts zu speichern'); return; }
  const fetched_at = now.toISOString();
  for (let i = 0; i < rows.length; i += 100) {
    await db('news?on_conflict=id', { method: 'POST', body: rows.slice(i, i + 100).map((r) => ({ ...r, fetched_at })), prefer: 'resolution=merge-duplicates,return=minimal' });
  }
  const old = new Date(now.getTime() - KEEP_DAYS * 86400e3).toISOString();
  await db(`news?published_at=lt.${encodeURIComponent(old)}`, { method: 'DELETE', prefer: 'return=minimal' });
  console.log(`gespeichert: ${rows.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
