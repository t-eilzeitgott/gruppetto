/**
 * Startseite, Tab „News“: Meldungen aus der Szene (mehrmals täglich geholt, scripts/news) und Meldungen aus der
 * eigenen Tipprunde nach jeder Etappe – in einem Strom, nach Tagen gegliedert, oben das Topthema.
 * Ohne Pressefotos (Rechte): die Gestaltung lebt von Schrift, Abstand und der Farbe der Rundfahrt.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '../app/query';
import { source } from '../app/config';
import { useFavorites } from '../app/hooks';
import { roundNews, type RoundNews } from '../lib/roundNews';
import {
  NEWS_FILTERS, ago, bundle, byDay, fetchedAt, highlight, matches, nameMarks, sourceName, topStory,
  type FeedEntry, type FeedNews, type NameMark, type NewsFilter,
} from '../lib/newsFeed';
import { fmtTime } from '../lib/time';
import type { NewsItem, Profile, TourData } from '../lib/types';
import { Avatar, Link, cx } from './kit';
import { Icon } from './Icon';
import { Skel, SkelText } from './skeleton';
import { lastName } from './bits';

// ------------------------------------------------------------------ Daten

const ROUND_FRESH_MS = 3 * 864e5;

export function useNewsItems(): { items: FeedNews[]; raw: NewsItem[]; loading: boolean } {
  const q = useQuery<NewsItem[]>('news', () => source.loadNews());
  const raw = q.data ?? [];
  const items = useMemo(() => bundle(raw), [raw]);
  return { items, raw, loading: q.loading };
}

export function useRoundNews(data: TourData | null, members: Profile[] | null, now: number): RoundNews[] {
  const minute = Math.floor(now / 60000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (data && members ? roundNews(data, members, minute * 60000) : []), [data, members, minute]);
}

// Ungelesen-Punkt am Tab: neueste Meldung jünger als beim letzten Öffnen
const SEEN = 'gruppetto.news.seen';
function readSeen(): number {
  try { return Number(localStorage.getItem(SEEN) ?? 0) || 0; } catch { return Number.MAX_SAFE_INTEGER; }
}
export function markNewsSeen(at: number) {
  try { if (at > readSeen()) localStorage.setItem(SEEN, String(at)); } catch { /* egal */ }
}
export function newestAt(items: FeedNews[], rounds: RoundNews[]): number {
  let t = 0;
  for (const it of items) t = Math.max(t, Date.parse(it.published_at));
  for (const r of rounds) t = Math.max(t, Date.parse(r.at));
  return t;
}
export function hasUnread(items: FeedNews[], rounds: RoundNews[]): boolean {
  const t = newestAt(items, rounds);
  return t > 0 && t > readSeen();
}

function useMarks(data: TourData | null): NameMark[] {
  const fav = useFavorites();
  const riders = data?.riders;
  const key = riders ? riders.map((r) => (fav.has(r) ? 1 : 0)).join('') : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (riders ? nameMarks(riders.map((r) => ({ name: r.name, fav: fav.has(r) })), lastName) : []), [riders, key]);
}

// ------------------------------------------------------------------ Bausteine

function Marked({ text, marks }: { text: string; marks: NameMark[] }) {
  const segs = useMemo(() => highlight(text, marks), [text, marks]);
  return <>{segs.map((s, i) => (s.mark ? <b key={i} className={cx('news-name', s.mark === 'fav' && 'news-name--fav')}>{s.text}</b> : <span key={i}>{s.text}</span>))}</>;
}

/** externer Link auf die Originalmeldung (Beispielmeldungen im Demo-Modus: ohne Link) */
function Out({ item, className, children, label }: { item: FeedNews; className: string; children: ReactNode; label: string }) {
  if (item.source === 'beispiel') return <div className={className}>{children}</div>;
  return (
    <a className={className} href={item.url} target="_blank" rel="noopener noreferrer" aria-label={label}>
      {children}
    </a>
  );
}

function Sources({ item }: { item: FeedNews }) {
  return (
    <>
      <span className="news-src">{sourceName(item.source)}</span>
      {item.lang !== 'de' ? <span className="news-lang" title="Meldung auf Englisch">{item.lang.toUpperCase()}</span> : null}
      {item.also.length ? <span className="news-more" title={item.also.map(sourceName).join(', ')}>+{item.also.length} {item.also.length === 1 ? 'Quelle' : 'Quellen'}</span> : null}
    </>
  );
}

function TopStory({ item, marks, now }: { item: FeedNews; marks: NameMark[]; now: number }) {
  return (
    <Out item={item} className="news-top" label={`Topthema: ${item.title} – bei ${sourceName(item.source)} lesen`}>
      <span className="news-top__kicker">
        <span className="news-top__badge">Topthema</span>
        <span>{ago(Date.parse(item.published_at), now)}</span>
      </span>
      <h2 className="news-top__title"><Marked text={item.title} marks={marks} /></h2>
      {item.summary ? <p className="news-top__sum">{item.summary}</p> : null}
      <span className="news-top__foot">
        <span className="news-meta"><Sources item={item} /></span>
        {item.source !== 'beispiel' ? <Icon name="external" size={16} /> : null}
      </span>
    </Out>
  );
}

function Move({ move }: { move: number | null }) {
  if (move === null || move === 0) return <span className="round-move round-move--same" aria-label="unverändert">–</span>;
  return move > 0
    ? <span className="round-move round-move--up" aria-label={`${move} Plätze gewonnen`}>▲{move}</span>
    : <span className="round-move round-move--down" aria-label={`${-move} Plätze verloren`}>▼{-move}</span>;
}

export function RoundCard({ item, now, tour }: { item: RoundNews; now: number; tour: string }) {
  const final = item.kind === 'final';
  return (
    <Link to="/rangliste" className={cx('card round-card', final && 'round-card--final')} ariaLabel={`${item.title}. Zur Rangliste`}>
      <span className="round-card__top">
        <span className="round-card__kicker"><Icon name={final ? 'trophy' : 'users'} size={14} />Tipprunde · {final ? `${tour} Endstand`.trim() : `Etappe ${item.stageNumber}`}</span>
        <span className="muted small">{ago(Date.parse(item.at), now)}</span>
      </span>
      <h2 className="round-card__title">{item.title}</h2>
      {item.text ? <p className="round-card__text">{item.text}</p> : null}
      <ol className="round-table" aria-label="Spitze der Tabelle">
        {item.table.map((r) => (
          <li key={r.userId}>
            <span className="round-table__rank">{r.rank}.</span>
            <Avatar name={r.name} color={r.color} size={26} />
            <span className="round-table__name">{r.name}</span>
            {r.day > 0 ? <span className="round-table__day">+{r.day}</span> : null}
            <Move move={r.move} />
            <strong className="round-table__total">{r.total}</strong>
          </li>
        ))}
      </ol>
    </Link>
  );
}

function NewsRow({ item, marks }: { item: FeedNews; marks: NameMark[] }) {
  const t = Date.parse(item.published_at);
  return (
    <li>
      <Out item={item} className="news-row" label={`${item.title} – ${sourceName(item.source)}`}>
        <time className="news-row__time" dateTime={item.published_at}>{fmtTime(new Date(t))}</time>
        <span className="news-row__main">
          <span className="news-row__title"><Marked text={item.title} marks={marks} /></span>
          {item.score >= 2.2 && item.summary && item.lang === 'de' ? <span className="news-row__sum">{item.summary}</span> : null}
          <span className="news-meta"><Sources item={item} /></span>
        </span>
      </Out>
    </li>
  );
}

function RoundRow({ item }: { item: RoundNews }) {
  return (
    <li>
      <Link to={`/etappe/${item.stageId}`} className="news-row news-row--round" ariaLabel={`Tipprunde, Etappe ${item.stageNumber}: ${item.title}`}>
        <time className="news-row__time" dateTime={item.at}>{fmtTime(new Date(item.at))}</time>
        <span className="news-row__main">
          <span className="news-row__kicker">Tipprunde · Etappe&nbsp;{item.stageNumber}</span>
          <span className="news-row__title">{item.title}</span>
          {item.text ? <span className="news-row__sum">{item.text}</span> : null}
        </span>
      </Link>
    </li>
  );
}

function NewsSkeleton() {
  return (
    <div className="news-skel" aria-hidden="true">
      <div className="news-top news-top--skel">
        <Skel w={92} h={22} r={999} />
        <SkelText w="92%" size={24} />
        <SkelText w="70%" size={24} />
        <SkelText w="100%" size={15} />
        <SkelText w="80%" size={15} />
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="news-row">
          <SkelText w={38} size={13} />
          <span className="news-row__main"><SkelText w={`${92 - i * 9}%`} size={16} /><SkelText w={110} size={12} /></span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Tab

let lastFilter: NewsFilter = 'alle';

export function NewsTab({ data, members, now }: { data: TourData | null; members: Profile[] | null; now: number }) {
  const { items, raw, loading } = useNewsItems();
  const rounds = useRoundNews(data, members, now);
  const marks = useMarks(data);
  const [filter, setFilterState] = useState<NewsFilter>(lastFilter);
  const setFilter = (f: NewsFilter) => { lastFilter = f; setFilterState(f); };
  const tour = data?.tour.short_name ?? '';

  // die neueste Rundenmeldung als Karte oben (frisch); ältere laufen im Strom mit
  const lead = rounds[0] && now - Date.parse(rounds[0].at) < ROUND_FRESH_MS ? rounds[0] : null;
  const top = filter === 'runde' ? null : topStory(items.filter((i) => matches(i, filter)), now);
  const entries: FeedEntry[] = [];
  if (filter !== 'runde') {
    for (const it of items) if (it !== top && matches(it, filter)) entries.push({ type: 'news', at: Date.parse(it.published_at), item: it });
  }
  if (filter === 'alle') for (const r of rounds) if (r !== lead) entries.push({ type: 'round', at: Date.parse(r.at), item: r });
  const days = byDay(entries, now);
  const stamp = fetchedAt(raw);
  const empty = !loading && !top && !days.length && (filter === 'runde' ? !rounds.length : !lead || filter !== 'alle');

  return (
    <div className="news">
      <div className="news-filters" role="toolbar" aria-label="Meldungen filtern">
        {NEWS_FILTERS.filter((f) => f.id !== 'runde' || rounds.length).map((f) => (
          <button key={f.id} type="button" className={cx('news-chip', filter === f.id && 'is-on')} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {filter === 'runde'
        ? rounds.map((r) => <RoundCard key={r.id} item={r} now={now} tour={tour} />)
        : null}
      {filter === 'alle' && lead ? <RoundCard item={lead} now={now} tour={tour} /> : null}

      {loading && filter !== 'runde' ? <NewsSkeleton /> : null}
      {top ? <TopStory item={top} marks={marks} now={now} /> : null}

      {days.map((d) => (
        <section key={d.key} className="news-day" aria-label={d.label}>
          <h3 className="news-day__h">{d.label}</h3>
          <ul className="news-list">
            {d.entries.map((e) => (e.type === 'news'
              ? <NewsRow key={e.item.id} item={e.item} marks={marks} />
              : <RoundRow key={e.item.id} item={e.item} />))}
          </ul>
        </section>
      ))}

      {empty ? (
        <div className="news-empty">
          <Icon name="news" size={28} />
          <strong>{filter === 'alle' ? 'Gerade keine Meldungen' : 'Dazu gibt es gerade nichts'}</strong>
          <span className="muted">{filter === 'runde' ? 'Nach der ersten Etappe mit Ergebnis steht hier, was in der Runde passiert ist.' : 'Neue Meldungen kommen mehrmals am Tag.'}</span>
        </div>
      ) : null}

      {!loading && raw.length ? (
        <p className="news-foot">
          Meldungen von {[...new Set(raw.map((r) => r.source))].map(sourceName).sort((a, b) => a.localeCompare(b, 'de')).join(', ')}
          {stamp ? <> · Stand {fmtTime(new Date(stamp))}&nbsp;Uhr</> : null}
        </p>
      ) : null}
    </div>
  );
}

/** Vorschau auf dem Tab „Heute“: frische Rundenmeldung und Topthema, ein Tipp öffnet den News-Tab */
export function NewsPeek({ data, members, now, onOpen }: { data: TourData; members: Profile[]; now: number; onOpen: () => void }) {
  const { items } = useNewsItems();
  const rounds = useRoundNews(data, members, now);
  const round = rounds[0] && now - Date.parse(rounds[0].at) < 1.5 * 864e5 ? rounds[0] : null;
  const top = topStory(items, now);
  if (!round && !top) return null;
  return (
    <button type="button" className="card news-peek" onClick={onOpen}>
      <span className="news-peek__head">
        <span className="eyebrow">News</span>
        <span className="news-peek__all">Alle<Icon name="chevron" size={16} /></span>
      </span>
      {round ? (
        <span className="news-peek__line">
          <span className="news-peek__kicker news-peek__kicker--round">Tipprunde · Etappe&nbsp;{round.stageNumber}</span>
          <span className="news-peek__title">{round.title}</span>
        </span>
      ) : null}
      {top ? (
        <span className="news-peek__line">
          <span className="news-peek__kicker">{sourceName(top.source)} · {ago(Date.parse(top.published_at), now)}</span>
          <span className="news-peek__title">{top.title}</span>
        </span>
      ) : null}
    </button>
  );
}
