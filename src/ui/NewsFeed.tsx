/**
 * Startseite, Tab „News“: Meldungen aus der Szene (stündlich geholt, scripts/news) und Meldungen aus der eigenen
 * Tipprunde nach jeder Etappe. Oben „Das Wichtigste“ (Aufmacher und weitere wichtige Meldungen zum Wischen), darunter
 * alle Meldungen nach Tagen – mit Anriss zum Lesen, wichtige markiert.
 * Ohne Pressefotos (Rechte): jede Meldung bekommt ein eigenes Bild aus Farbe der Art (Rennen, Sieg, Verletzung,
 * Transfer, Teams) und einem Höhenprofil, das aus ihrer Kennung entsteht – immer gleich, nie zweimal dasselbe.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useQuery } from '../app/query';
import { source } from '../app/config';
import { useFavorites } from '../app/hooks';
import { roundNews, type RoundNews } from '../lib/roundNews';
import {
  KIND_LABEL, NEWS_FILTERS, ago, bundle, byDay, fetchedAt, filterCounts, highlight, isImportant, matches, mostImportant,
  nameMarks, seedOf, sourceName, storyKind,
  type FeedEntry, type FeedNews, type NameMark, type NewsFilter, type StoryKind,
} from '../lib/newsFeed';
import { fmtTime } from '../lib/time';
import type { NewsItem, Profile, TourData } from '../lib/types';
import { Avatar, Link, cx } from './kit';
import { Icon, type IconName } from './Icon';
import { Skel, SkelText } from './skeleton';
import { lastName } from './bits';

// ------------------------------------------------------------------ Daten

const ROUND_FRESH_MS = 3 * 864e5;
/** so oft holt der Workflow „News“ neue Meldungen (siehe .github/workflows/news.yml) */
export const NEWS_SCHEDULE = 'tagsüber jede Stunde';

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

// ------------------------------------------------------------------ Bild einer Meldung

const KIND_ICON: Record<StoryKind, IconName> = {
  sieg: 'trophy', rennen: 'flag', verletzung: 'medical', transfer: 'swap', team: 'users', szene: 'news',
};

/** Höhenprofil aus einer Zahl: zwei Bergketten, die vordere mit Gipfel */
function profile(seed: number, w: number, h: number, base: number, amp: number, phase: number): { d: string; peak: [number, number] } {
  let s = seed || 1;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
  const f1 = 1 + rnd() * 1.6;
  const f2 = 2.5 + rnd() * 3;
  const p1 = rnd() * 6 + phase;
  const p2 = rnd() * 6;
  const climbAt = 0.35 + rnd() * 0.45;
  const pts: [number, number][] = [];
  const n = 36;
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * w;
    const u = i / n;
    const climb = Math.exp(-((u - climbAt) ** 2) / 0.018) * 0.9;
    const y = base - amp * (0.35 * Math.sin(u * Math.PI * f1 + p1) + 0.18 * Math.sin(u * Math.PI * f2 + p2) + climb);
    pts.push([x, Math.max(h * 0.12, Math.min(h, y))]);
  }
  const peak = pts.reduce((m, p) => (p[1] < m[1] ? p : m), pts[0]);
  const d = `M0 ${h}L${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}L${w} ${h}Z`;
  return { d, peak };
}

function Cover({ id, kind, size, children }: { id: string; kind: StoryKind; size: 'lead' | 'card' | 'tile'; children?: ReactNode }) {
  const seed = seedOf(id);
  const W = 160;
  const H = size === 'tile' ? 160 : size === 'lead' ? 80 : 90;
  const back = profile(seed ^ 0x9e3779b9, W, H, H * 0.62, H * 0.42, 1.3);
  const front = profile(seed, W, H, H * 0.86, H * 0.5, 0);
  const flag = kind === 'sieg' || kind === 'rennen';
  return (
    <span className={cx('news-cover', `news-cover--${kind}`, `news-cover--${size}`)} aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="news-cover__art">
        <path d={back.d} className="news-cover__ridge news-cover__ridge--back" />
        <path d={front.d} className="news-cover__ridge" />
      </svg>
      {flag && size !== 'tile' ? (
        <span className="news-cover__peak" style={{ left: `${(front.peak[0] / W) * 100}%`, top: `${(front.peak[1] / H) * 100}%` } as CSSProperties} />
      ) : null}
      <span className="news-cover__icon"><Icon name={KIND_ICON[kind]} size={size === 'tile' ? 22 : 18} /></span>
      {children}
    </span>
  );
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

/** „VERLETZUNG · vor 3 Std. · Radsport-News“ */
function Kicker({ item, now, clock }: { item: FeedNews; now: number; clock?: boolean }) {
  const kind = storyKind(item);
  const t = Date.parse(item.published_at);
  return (
    <span className="news-kicker">
      <span className={cx('news-kicker__kind', `news-kind--${kind}`)}>{KIND_LABEL[kind]}</span>
      <span className="news-kicker__dot" aria-hidden="true">·</span>
      <time dateTime={item.published_at}>{clock ? fmtTime(new Date(t)) : ago(t, now)}</time>
      <span className="news-kicker__dot" aria-hidden="true">·</span>
      <span className="news-kicker__src">{sourceName(item.source)}</span>
    </span>
  );
}

function Badges({ item }: { item: FeedNews }) {
  const n = Math.max(item.sources, item.also.length + 1);
  if (!isImportant(item) && n < 2 && item.lang === 'de') return null;
  return (
    <span className="news-badges">
      {isImportant(item) ? <span className="news-badge news-badge--hot"><Icon name="flame" size={12} />Wichtig</span> : null}
      {n > 1 ? <span className="news-badge" title={item.also.length ? `auch bei ${item.also.map(sourceName).join(', ')}` : undefined}>{n} Quellen</span> : null}
      {item.lang !== 'de' ? <span className="news-badge news-badge--lang" title="Meldung auf Englisch">{item.lang.toUpperCase()}</span> : null}
    </span>
  );
}

function Lead({ item, marks, now }: { item: FeedNews; marks: NameMark[]; now: number }) {
  return (
    <Out item={item} className="news-lead" label={`${item.title} – bei ${sourceName(item.source)} lesen`}>
      <Cover id={item.id} kind={storyKind(item)} size="lead">
        <span className="news-cover__tag">{isImportant(item) ? 'Topthema' : 'Aktuell'}</span>
      </Cover>
      <span className="news-lead__body">
        <Kicker item={item} now={now} />
        <h2 className="news-lead__title"><Marked text={item.title} marks={marks} /></h2>
        {item.summary ? <p className="news-lead__sum">{item.summary}</p> : null}
        <span className="news-lead__foot">
          <Badges item={item} />
          {item.source !== 'beispiel' ? <span className="news-lead__more">Weiterlesen<Icon name="external" size={14} /></span> : null}
        </span>
      </span>
    </Out>
  );
}

function StoryCard({ item, marks, now }: { item: FeedNews; marks: NameMark[]; now: number }) {
  return (
    <Out item={item} className="news-card" label={`${item.title} – ${sourceName(item.source)}`}>
      <Cover id={item.id} kind={storyKind(item)} size="card" />
      <span className="news-card__body">
        <Kicker item={item} now={now} />
        <span className="news-card__title"><Marked text={item.title} marks={marks} /></span>
        <Badges item={item} />
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
        <span className="round-card__kicker"><Icon name={final ? 'trophy' : 'users'} size={14} />Tipprunde · {final ? `${tour} Endstand`.trim() : `Etappe ${item.stageNumber}`}</span>
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

function NewsRow({ item, marks, now }: { item: FeedNews; marks: NameMark[]; now: number }) {
  const hot = isImportant(item);
  return (
    <li>
      <Out item={item} className={cx('news-row', hot && 'news-row--hot')} label={`${item.title} – ${sourceName(item.source)}`}>
        <Cover id={item.id} kind={storyKind(item)} size="tile" />
        <span className="news-row__main">
          <Kicker item={item} now={now} clock />
          <span className="news-row__title"><Marked text={item.title} marks={marks} /></span>
          {item.summary ? <span className="news-row__sum">{item.summary}</span> : null}
          <Badges item={item} />
        </span>
      </Out>
    </li>
  );
}

function RoundRow({ item }: { item: RoundNews }) {
  return (
    <li>
      <Link to={`/etappe/${item.stageId}`} className="news-row news-row--round" ariaLabel={`Tipprunde, Etappe ${item.stageNumber}: ${item.title}`}>
        <span className="news-tile-round" aria-hidden="true"><Icon name="users" size={22} /><span>{item.stageNumber}</span></span>
        <span className="news-row__main">
          <span className="news-kicker">
            <span className="news-kicker__kind news-kind--runde">Tipprunde</span>
            <span className="news-kicker__dot" aria-hidden="true">·</span>
            <time dateTime={item.at}>{fmtTime(new Date(item.at))}</time>
            <span className="news-kicker__dot" aria-hidden="true">·</span>
            <span>Etappe&nbsp;{item.stageNumber}</span>
          </span>
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
      <div className="news-lead news-lead--skel">
        <Skel w="100%" h={150} r={0} />
        <span className="news-lead__body">
          <SkelText w={160} size={12} />
          <SkelText w="92%" size={22} />
          <SkelText w="70%" size={22} />
          <SkelText w="100%" size={15} />
        </span>
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="news-row">
          <Skel w={64} h={64} r={14} />
          <span className="news-row__main"><SkelText w={130} size={12} /><SkelText w={`${92 - i * 9}%`} size={16} /><SkelText w="80%" size={14} /></span>
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
  const counts = useMemo(() => filterCounts(items), [items]);

  const pool = filter === 'runde' ? [] : items.filter((i) => matches(i, filter));
  // Das Wichtigste: Aufmacher und bis zu drei weitere zum Wischen (nicht noch einmal im Strom)
  const important = mostImportant(pool, now, 4);
  const [lead, ...more] = important;
  const shown = new Set(important.map((i) => i.id));
  // die neueste Rundenmeldung als Karte (frisch); ältere laufen im Strom mit
  const roundLead = rounds[0] && now - Date.parse(rounds[0].at) < ROUND_FRESH_MS ? rounds[0] : null;
  const roundFirst = !!roundLead && now - Date.parse(roundLead.at) < 864e5;
  const entries: FeedEntry[] = [];
  for (const it of pool) if (!shown.has(it.id)) entries.push({ type: 'news', at: Date.parse(it.published_at), item: it });
  if (filter === 'alle') for (const r of rounds) if (r !== roundLead) entries.push({ type: 'round', at: Date.parse(r.at), item: r });
  const days = byDay(entries, now);
  const stamp = fetchedAt(raw);
  const empty = !loading && !lead && !days.length && (filter === 'runde' ? !rounds.length : !roundLead || filter !== 'alle');
  const roundCard = filter === 'alle' && roundLead ? <RoundCard item={roundLead} now={now} tour={tour} /> : null;

  return (
    <div className="news">
      <div className="news-filters" role="toolbar" aria-label="Meldungen filtern">
        {NEWS_FILTERS.filter((f) => f.id !== 'runde' || rounds.length).map((f) => {
          const n = f.id === 'runde' ? rounds.length : counts[f.id];
          return (
            <button key={f.id} type="button" className={cx('news-chip', filter === f.id && 'is-on')} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
              {f.id !== 'alle' && n ? <span className="news-chip__n">{n}</span> : null}
            </button>
          );
        })}
      </div>

      {filter === 'runde' ? rounds.map((r) => <RoundCard key={r.id} item={r} now={now} tour={tour} />) : null}
      {roundFirst ? roundCard : null}

      {loading && filter !== 'runde' ? <NewsSkeleton /> : null}
      {lead ? (
        <section className="news-top" aria-label="Das Wichtigste">
          <h3 className="news-section">Das Wichtigste</h3>
          <Lead item={lead} marks={marks} now={now} />
          {more.length ? (
            <div className="news-rail" aria-label="Weitere wichtige Meldungen">
              {more.map((it) => <StoryCard key={it.id} item={it} marks={marks} now={now} />)}
            </div>
          ) : null}
        </section>
      ) : null}

      {!roundFirst ? roundCard : null}

      {days.map((d) => (
        <section key={d.key} className="news-day" aria-label={d.label}>
          <h3 className="news-day__h">{d.label}</h3>
          <ul className="news-list">
            {d.entries.map((e) => (e.type === 'news'
              ? <NewsRow key={e.item.id} item={e.item} marks={marks} now={now} />
              : <RoundRow key={e.item.id} item={e.item} />))}
          </ul>
        </section>
      ))}

      {empty ? (
        <div className="news-empty">
          <Icon name="news" size={28} />
          <strong>{filter === 'alle' ? 'Gerade keine Meldungen' : 'Dazu gibt es gerade nichts'}</strong>
          <span className="muted">{filter === 'runde' ? 'Nach der ersten Etappe mit Ergebnis steht hier, was in der Runde passiert ist.' : `Neue Meldungen kommen ${NEWS_SCHEDULE}.`}</span>
        </div>
      ) : null}

      {!loading && raw.length ? (
        <p className="news-foot">
          <span>Aktualisiert {NEWS_SCHEDULE}{stamp ? <> · zuletzt {fmtTime(new Date(stamp))}&nbsp;Uhr</> : null}</span>
          <span>Quellen: {[...new Set(raw.map((r) => sourceName(r.source)))].sort((a, b) => a.localeCompare(b, 'de')).join(', ')}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Vorschau auf dem Tab „Heute“: frische Rundenmeldung und die wichtigste Meldung, ein Tipp öffnet den News-Tab */
export function NewsPeek({ data, members, now, onOpen }: { data: TourData; members: Profile[]; now: number; onOpen: () => void }) {
  const { items } = useNewsItems();
  const rounds = useRoundNews(data, members, now);
  const round = rounds[0] && now - Date.parse(rounds[0].at) < 1.5 * 864e5 ? rounds[0] : null;
  const [top] = mostImportant(items, now, 1);
  if (!round && !top) return null;
  return (
    <button type="button" className="card news-peek" onClick={onOpen}>
      <span className="news-peek__head">
        <span className="eyebrow">News</span>
        <span className="news-peek__all">Alle<Icon name="chevron" size={16} /></span>
      </span>
      {round ? (
        <span className="news-peek__line">
          <span className="news-tile-round" aria-hidden="true"><Icon name="users" size={18} /><span>{round.stageNumber}</span></span>
          <span className="news-peek__text">
            <span className="news-peek__kicker news-peek__kicker--round">Tipprunde · Etappe&nbsp;{round.stageNumber}</span>
            <span className="news-peek__title">{round.title}</span>
          </span>
        </span>
      ) : null}
      {top ? (
        <span className="news-peek__line">
          <Cover id={top.id} kind={storyKind(top)} size="tile" />
          <span className="news-peek__text">
            <span className="news-peek__kicker">
              {isImportant(top) ? <span className="news-badge news-badge--hot"><Icon name="flame" size={12} />Wichtig</span> : null}
              {sourceName(top.source)} · {ago(Date.parse(top.published_at), now)}
            </span>
            <span className="news-peek__title">{top.title}</span>
          </span>
        </span>
      ) : null}
    </button>
  );
}
