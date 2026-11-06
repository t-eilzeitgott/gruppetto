import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTourContext } from '../app/context';
import { useNow } from '../app/hooks';
import { leaderboard, jokerRemaining, bonusScoresFor, scoreStageOf, tipUsage, tourTipLimit } from '../lib/scoring';
import { bonusDeadline, fmtDay, lastPublishedStage, nextOpenStage, runningStages, tourPhase, dayDiff, fmtClock, fmtKm } from '../lib/time';
import { BONUS_CATEGORIES, type Stage, type Tour, type TourData } from '../lib/types';
import { Avatar, Countdown, Empty, ErrorBox, Link, LinkButton, cx, useTitle } from '../ui/kit';
import { HomeSkeleton, Skel, firstContent } from '../ui/skeleton';
import { prefetchGames } from '../app/pages';
import { introReady } from '../app/intro';
import { Icon } from '../ui/Icon';
import { KindChip, lastName, riderName, stageRoute, useRefreshAtStart } from '../ui/bits';
import { TourPicker, Wordmark } from '../ui/Shell';
import { useQuery } from '../app/query';
import { source } from '../app/config';
import { GamesCard } from '../ui/GamesCard';
import { stageOfDay } from '../game/abfahrt/sprintRiders';
import { berlinDayKey } from '../game/abfahrt/rng';
import type { Profile } from '../lib/types';
import { NewsPeek, NewsTab, hasUnread, markNewsSeen, newestAt, useNewsItems, useRoundNews } from '../ui/NewsFeed';
import { markUiBusy, uiBusy } from '../game/uiBusy';

type HomeTab = 'heute' | 'news';
const TAB_KEY = 'gruppetto.home.tab';
let homeTab: HomeTab | null = null;
function initialTab(): HomeTab {
  // (zuerst der gespeicherte Tab: über „Heute“ unten von einer anderen Seite zurück hat frame.tsx ihn auf Heute gesetzt)
  try { const v = sessionStorage.getItem(TAB_KEY); if (v) return v === 'news' ? 'news' : 'heute'; } catch { /* egal */ }
  return homeTab ?? 'heute';
}

/** „Heute | News“ als große Überschriften; Punkt am News-Tab, wenn es Neues gibt. Wie hell welcher Titel ist,
 *  steuert der Pager über --p (0 = Heute, 1 = News) – stufenlos mit der Lage der Seiten. */
type TabsCtl = { set: (p: number) => void };
function HomeTabs({ tab, onTab, unread, ctl }: { tab: HomeTab; onTab: (t: HomeTab) => void; unread: boolean; ctl: RefObject<TabsCtl | null> }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    let last = -1;
    ctl.current = {
      set: (p) => {
        const k = Math.round(Math.max(0, Math.min(1, p)) * 1000) / 1000;
        if (k === last) return;
        last = k;
        box.current?.style.setProperty('--p', String(k));
      },
    };
    ctl.current.set(ORDER.indexOf(tab));
    // nur beim Einhängen; danach steuert der Pager
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const item = (id: HomeTab, label: string) => (
    <button
      type="button" role="tab" id={`home-tab-${id}`} aria-selected={tab === id} aria-controls={`home-panel-${id}`}
      className={cx('home-tab', tab === id && 'is-on')} onClick={() => onTab(id)}
    >
      {label}
      {id === 'news' && unread && tab !== 'news' ? <span className="home-tab__dot" aria-label="neue Meldungen" /> : null}
    </button>
  );
  return <div className="home-tabs" role="tablist" aria-label="Startseite" ref={box}>{item('heute', 'Heute')}{item('news', 'News')}</div>;
}

const calm = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
/** iPhone/iPad (WebKit) – dort gibt es die Zeichenfehler, die der Pager unten ausgleicht */
const IOS = typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const ORDER: HomeTab[] = ['heute', 'news'];

/**
 * Heute und News als Pager mit dem echten Scrollen des Systems (scroll-snap): Wischen, Mitziehen, Schwung,
 * Einrasten und Nachfedern am Rand macht das iPhone selbst – mit voller Bildrate (120 Hz) und unabhängig davon, ob
 * die Seite gerade rechnet. Genau so fühlen sich native Apps an. Tippen auf einen Titel scrollt weich dorthin.
 *
 * Drumherum nur Kleinigkeiten, nichts davon in der Bewegung selbst:
 * - Die Titel hellen mit der Lage auf bzw. ab (--p, aus den Scroll-Ereignissen).
 * - Die nicht sichtbare Seite ist auf Bildschirmhöhe gekürzt (die Seite ist so lang wie die sichtbare), aber
 *   gezeichnet; ist man weit unten, steht ihr Anfang dort, wo er mit Kopf stünde (vorab versetzt, eigene Ebene).
 * - Steht die Bewegung, werden die Seiten getauscht, ggf. der Kopf zurückgescrollt (Versatz und Scrollen im selben
 *   Bild – kein Sprung) und der React-Zustand übernommen.
 * - Solange sich etwas bewegt, gilt die Oberfläche als beschäftigt (uiBusy): Hintergrundarbeit wartet.
 */
function usePager(tab: HomeTab, commit: (t: HomeTab) => void, tabs: RefObject<TabsCtl | null>, wantNews: () => void) {
  const pager = useRef<HTMLDivElement>(null);
  const idx = useRef(ORDER.indexOf(tab));
  const pages = () => Array.from(pager.current?.children ?? []) as HTMLElement[];
  const width = () => pager.current?.clientWidth || window.innerWidth;
  /** Scrollhöhe, bei der der Kopf (Titel) gerade noch oben im Bild steht */
  const keep = () => {
    const head = document.querySelector<HTMLElement>('.home-tabs');
    return head ? Math.max(0, head.getBoundingClientRect().top + window.scrollY - 12) : 0;
  };

  /** nicht sichtbare Seiten so versetzen, dass ihr Anfang beim Hereinwischen oben im Bild steht */
  const align = () => {
    const d = Math.max(0, Math.round(window.scrollY - keep()));
    pages().forEach((el, k) => {
      const tf = k === idx.current || d === 0 ? '' : `translate3d(0, ${d}px, 0)`;
      if (el.style.transform !== tf) el.style.transform = tf;
    });
  };
  /** welche Seite gilt (die andere: gekürzt und für Bildschirmleser stumm) */
  const activate = (i: number) => {
    pages().forEach((el, k) => {
      const on = k === i;
      el.classList.toggle('is-away', !on);
      if (on) el.removeAttribute('aria-hidden'); else el.setAttribute('aria-hidden', 'true');
    });
  };

  /** Bewegung steht auf Seite i: tauschen, Kopf zurückholen, Zustand übernehmen */
  const settle = (i: number) => {
    tabs.current?.set(i);
    if (i === idx.current) return;
    const k = keep();
    const back = window.scrollY > k;
    idx.current = i;
    activate(i);
    pages()[i].style.transform = '';
    if (back) window.scrollTo(0, k);
    align();
    commit(ORDER[i]);
  };

  // Ausgangslage, Scrollen beobachten
  useLayoutEffect(() => {
    const el = pager.current;
    if (!el) return;
    activate(idx.current);
    el.scrollLeft = idx.current * width();
    align();
    let touching = false;
    let timer = 0;
    let raf = 0;
    const check = () => {
      window.clearTimeout(timer);
      const p = el.scrollLeft / width();
      const i = Math.round(p);
      // noch am Finger oder noch nicht eingerastet: gleich noch einmal schauen
      if (touching || Math.abs(p - i) > 0.01) { timer = window.setTimeout(check, 120); return; }
      settle(Math.max(0, Math.min(ORDER.length - 1, i)));
    };
    const onScroll = () => {
      markUiBusy(350);
      tabs.current?.set(el.scrollLeft / width());
      window.clearTimeout(timer);
      timer = window.setTimeout(check, 140);
    };
    const onEnd = () => check();
    const onDown = () => { touching = true; wantNews(); };
    const onUp = () => { touching = false; };
    const onWinScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; align(); });
    };
    const onResize = () => { el.scrollLeft = idx.current * width(); align(); };
    // iPhone (WebKit): wächst oder schrumpft eine Seite (Daten geladen, Bestenlisten da), bleiben manchmal Teile der
    // Seite unbemalt stehen, bis man wischt. Nach jeder Größenänderung – in einem ruhigen Moment – einmal neu
    // zeichnen lassen: der Pager bekommt für zwei Bilder eine eigene Ebene (sichtbar ändert sich nichts).
    let healT = 0;
    const heal = () => {
      if (uiBusy()) { healT = window.setTimeout(heal, 300); return; }
      el.style.opacity = '0.999';
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = ''; }));
    };
    const healSoon = () => { window.clearTimeout(healT); healT = window.setTimeout(heal, 160); };
    const ro = IOS && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(healSoon) : null;
    if (ro) for (const p of pages()) ro.observe(p);
    const onShow = () => { if (IOS && !document.hidden) healSoon(); };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('pageshow', onShow);
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('scrollend', onEnd);
    el.addEventListener('touchstart', onDown, { passive: true });
    el.addEventListener('touchend', onUp, { passive: true });
    el.addEventListener('touchcancel', onUp, { passive: true });
    window.addEventListener('scroll', onWinScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(healT);
      ro?.disconnect();
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('pageshow', onShow);
      el.style.opacity = '';
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('scrollend', onEnd);
      el.removeEventListener('touchstart', onDown);
      el.removeEventListener('touchend', onUp);
      el.removeEventListener('touchcancel', onUp);
      window.removeEventListener('scroll', onWinScroll);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Tippen auf einen Titel: weich hinscrollen (das System animiert) */
  const go = (t: HomeTab) => {
    const el = pager.current;
    const i = ORDER.indexOf(t);
    if (!el) return;
    if (t === 'news') wantNews();
    align();
    markUiBusy(600);
    el.scrollTo({ left: i * width(), behavior: calm() ? 'auto' : 'smooth' });
  };

  return { pager, go };
}

/** Kopf der Startseite: Wortmarke und Profilbild */
export function HomeHead({ me }: { me: Profile }) {
  return (
    <header className="home-head">
      <Wordmark />
      <Link to="/profil" className="home-head__me" ariaLabel="Dein Profil">
        <Avatar name={me.display_name} color={me.avatar_color} size={36} />
      </Link>
    </header>
  );
}

/** Inhalt der Seite „Heute“ – memo: Wechselt nur der Tab, wird hier nichts neu berechnet */
const TodayPage = memo(function TodayPage({ tour, tours, data, members, me, now, error, loading, reveal, onRetry, onNews }: {
  tour: Tour | null; tours: Tour[]; data: TourData | undefined; members: Profile[] | undefined; me: Profile; now: number;
  error: unknown; loading: boolean; reveal: boolean; onRetry: () => void; onNews: () => void;
}) {
  if (!tour) {
    return (
      <div className="stack">
        <Empty title="Noch keine Rundfahrt">Sobald der Admin eine Rundfahrt anlegt, kannst du hier tippen.</Empty>
        <GamesCard />
      </div>
    );
  }
  if (error) return <ErrorBox error={error} onRetry={onRetry} />;
  if (loading || !data || !members) return <HomeSkeleton />;
  return (
    <div className={cx('stack', reveal && 'reveal')}>
      <TourPicker tour={tour} tours={tours} />
      <HomeBody data={data} members={members} me={me} now={now} onNews={onNews} />
    </div>
  );
});

/** Inhalt der Seite „News“ – memo wie oben */
const NewsPage = memo(function NewsPage({ data, members, now }: { data: TourData | null; members: Profile[] | null; now: number }) {
  return <div className="stack"><NewsTab data={data} members={members} now={now} /></div>;
});

export function Home() {
  const [tab, setTabState] = useState<HomeTab>(initialTab);
  useTitle(tab === 'news' ? 'News' : 'Heute');
  const { me, tour, tours, data, members, loading, error, reload } = useTourContext();
  const now = useNow();
  const news = useNewsItems();
  const rounds = useRoundNews(data ?? null, members ?? null, now);
  const unread = hasUnread(news.items, rounds);
  const latest = newestAt(news.items, rounds);
  // im News-Tab gilt alles Angezeigte als gelesen
  useEffect(() => { if (tab === 'news' && latest) markNewsSeen(latest); }, [tab, latest]);
  // News-Seite: bei Bedarf bzw. im Leerlauf aufbauen – dann steht sie, bevor man hinwischt
  const [newsOn, setNewsOn] = useState(tab === 'news');
  const tabs = useRef<TabsCtl | null>(null);
  const commit = (t: HomeTab) => {
    homeTab = t;
    try { sessionStorage.setItem(TAB_KEY, t); } catch { /* egal */ }
    setTabState(t);
  };
  const { pager, go } = usePager(tab, commit, tabs, () => setNewsOn(true));
  // gleichbleibende Rückrufe für die memo-Seiten
  const goRef = useRef(go);
  goRef.current = go;
  // „Heute“ unten in der Leiste: zurück auf den Heute-Tab
  useEffect(() => {
    const f = () => { homeTab = 'heute'; goRef.current('heute'); };
    window.addEventListener('gruppetto-home-today', f);
    return () => window.removeEventListener('gruppetto-home-today', f);
  }, []);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const onNews = useCallback(() => goRef.current('news'), []);
  const onRetry = useCallback(() => reloadRef.current(), []);
  useRefreshAtStart(data?.stages, now);
  // Inhalt, der erst während dieses Besuchs kommt, weich einblenden (aus dem Zwischenspeicher: sofort da)
  const waited = useRef(false);
  if (loading) { waited.current = true; firstContent(); } else if (!waited.current && data && members && firstContent()) waited.current = true;
  // Spiele und Garage im Leerlauf vorab laden: der Wechsel ins Minispiel ohne Ladepause
  useEffect(() => {
    const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const id = idle ? idle(() => prefetchGames(), { timeout: 2500 }) : window.setTimeout(prefetchGames, 1200);
    return () => { if (!idle) window.clearTimeout(id); };
  }, []);

  // Intro beenden, sobald die Startseite mit Inhalt steht (oder es nichts zu laden gibt)
  const shown = !tour || !!error || (!loading && !!data && !!members);
  useEffect(() => {
    if (shown) introReady('content');
  }, [shown]);
  useEffect(() => {
    if (!shown || newsOn) return;
    const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const id = idle ? idle(() => setNewsOn(true), { timeout: 3000 }) : window.setTimeout(() => setNewsOn(true), 1500);
    return () => { if (!idle) window.clearTimeout(id); };
  }, [shown, newsOn]);

  return (
    <>
      <HomeHead me={me} />
      <HomeTabs tab={tab} onTab={go} unread={unread} ctl={tabs} />
      <div className="home-pager" ref={pager}>
        <div className="home-page" id="home-panel-heute" role="tabpanel" aria-labelledby="home-tab-heute">
          <TodayPage
            tour={tour} tours={tours} data={data} members={members} me={me} now={now} error={error} loading={loading}
            reveal={waited.current} onRetry={onRetry} onNews={onNews}
          />
        </div>
        <div className="home-page" id="home-panel-news" role="tabpanel" aria-labelledby="home-tab-news">
          {newsOn ? <NewsPage data={tour && !error ? data ?? null : null} members={members ?? null} now={now} /> : null}
        </div>
      </div>
    </>
  );
}

function HomeBody({ data, members, me, now, onNews }: { data: TourData; members: Profile[]; me: Profile; now: number; onNews: () => void }) {
  const phase = tourPhase(data.tour, data.stages, now);
  const todayStage = stageOfDay(data.stages, berlinDayKey());
  const board = useMemo(() => leaderboard(data, members), [data, members]);
  const myRow = board.find((r) => r.userId === me.id);
  const next = nextOpenStage(data.stages, now);
  const running = runningStages(data.stages, now);
  const last = lastPublishedStage(data.stages);
  const deadline = bonusDeadline(data.tour, data.stages);
  const myBonusCount = data.bonusTips.filter((b) => b.user_id === me.id).length;

  return (
    <>
      {phase === 'upcoming' ? null : myRow ? (
        <section className="hero" aria-label="Dein Stand">
          <span className="muted">{last ? `${data.tour.short_name} · nach Etappe\u00a0${last.number}` : data.tour.name}</span>
          <p className="hero__big">
            {myRow.total}
            <span className="hero__unit">Punkte</span>
          </p>
          <p className="hero__meta">
            {myRow.lastStagePoints !== null ? <span className="pos">+{myRow.lastStagePoints} zuletzt</span> : null}
            <span className="muted">
              Platz&nbsp;{myRow.rank} von&nbsp;{board.length}
              {myRow.prevRank !== null && myRow.prevRank !== myRow.rank
                ? ` · ${myRow.prevRank > myRow.rank ? '↑' : '↓'} ${Math.abs(myRow.prevRank - myRow.rank)}`
                : ''}
            </span>
          </p>
        </section>
      ) : null}

      {running.length ? <RunningCard stage={running[running.length - 1]} data={data} me={me} more={running.length - 1} /> : null}

      {next ? <NextStageCard stage={next} data={data} me={me} members={members} now={now} /> : null}

      {phase === 'upcoming' ? <BonusRow count={myBonusCount} deadline={deadline} now={now} /> : null}

      {!next && phase !== 'finished' && data.stages.length === 0 ? (
        <section className="card">
          <h2 className="card__title">Etappenplan folgt</h2>
          <p className="muted">Sobald die Etappen eingetragen sind, kannst du hier tippen.</p>
        </section>
      ) : null}

      {last ? <LastResultCard stage={last} data={data} me={me} /> : null}

      <NewsPeek data={data} members={members} now={now} onOpen={onNews} />

      {phase === 'finished' ? <FinalCard data={data} board={board} /> : null}

      {phase !== 'upcoming' ? <Tiles data={data} me={me} next={next} /> : null}

      <GamesCard stageKind={todayStage?.kind ?? null} tourName={data.tour.name} stages={data.stages} />
    </>
  );
}

function dayLabel(stage: Stage, now: number): string {
  const diff = dayDiff(new Date(now), stage.starts_at);
  if (diff === 0) return `Heute · ${fmtDay(stage.starts_at)}`;
  if (diff === 1) return `Morgen · ${fmtDay(stage.starts_at)}`;
  return fmtDay(stage.starts_at);
}

function NextStageCard({ stage, data, me, members, now }: {
  stage: Stage; data: TourData; me: Profile; members: Profile[]; now: number;
}) {
  const myTip = data.tips.find((t) => t.stage_id === stage.id && t.user_id === me.id);
  // getippter Fahrer ausgestiegen: schon hier sichtbar (wie fehlender Tipp hervorgehoben), nicht erst in der Etappe
  const out = !!myTip && data.riders.find((r) => r.id === myTip.rider_id)?.status === 'out';
  const route = stageRoute(stage);
  return (
    <section className={cx('card tip-card', (!myTip || out) && 'card--accent')} aria-labelledby={`next-${stage.id}`}>
      <div className="card__row">
        <span className="eyebrow">{dayLabel(stage, now)}</span>
        <span className="time-chip" title="Tippschluss"><Icon name="clock" size={15} /><Countdown to={stage.starts_at} now={now} prefix="" /></span>
      </div>
      <Link to={`/etappe/${stage.id}`} className="card__link">
        <h2 id={`next-${stage.id}`} className="card__title">Etappe&nbsp;{stage.number}</h2>
        {route ? <p className="card__sub">{route}</p> : null}
      </Link>
      <div className="tip-facts">
        <KindChip stage={stage} />
        {stage.distance_km ? <span className="fact"><Icon name="flag" size={14} />{fmtKm(stage.distance_km)}</span> : null}
        <span className="fact"><Icon name="clock" size={14} />{fmtClock(stage.starts_at)}</span>
        <TipCount stage={stage} members={members} />
      </div>
      {myTip ? (
        <Link to={`/tipp/${stage.id}`} className={cx('my-tip', out && 'my-tip--out')} ariaLabel={`Dein Tipp: ${riderName(data, myTip.rider_id)}${out ? ' – ausgestiegen, neu tippen' : ' – ändern'}`}>
          <Icon name={out ? 'info' : 'check'} size={18} />
          {out ? (
            <span className="my-tip__text">
              <strong className="my-tip__name">{riderName(data, myTip.rider_id)}</strong>
              <span className="my-tip__warn">ausgestiegen – bitte neu tippen</span>
            </span>
          ) : <strong className="my-tip__name">{riderName(data, myTip.rider_id)}</strong>}
          <Icon name="pencil" size={17} className="muted" />
        </Link>
      ) : (
        <LinkButton to={`/tipp/${stage.id}`} full>Jetzt tippen</LinkButton>
      )}
    </section>
  );
}

/** Wer schon getippt hat: Avatare und „3/3“ – die Tipps selbst bleiben bis zum Start verdeckt */
function TipCount({ stage, members }: { stage: Stage; members: Profile[] }) {
  const q = useQuery<string[]>(`tippers:${stage.id}`, () => source.stageTippers(stage.id));
  if (q.loading || !q.data) {
    // Platz freihalten, damit die Karte nicht wächst, wenn die Zahl kommt
    return (
      <span className="fact tip-count" aria-hidden="true">
        <span className="avatar-stack avatar-stack--sm">{[0, 1, 2].map((i) => <Skel key={i} w={20} h={20} r="50%" />)}</span>
        <span className="tip-count__skel">0/{members.length}</span>
      </span>
    );
  }
  const ids = new Set(q.data);
  const tipped = members.filter((m) => ids.has(m.id));
  return (
    <span className="fact tip-count" title={`${tipped.length} von ${members.length} getippt, sichtbar ab ${fmtClock(stage.starts_at)}`}>
      <span className="avatar-stack avatar-stack--sm" aria-hidden="true">
        {tipped.slice(0, 3).map((m) => <Avatar key={m.id} name={m.display_name} color={m.avatar_color} size={20} />)}
      </span>
      <span>{tipped.length}/{members.length}</span>
      <span className="sr-only">getippt</span>
    </span>
  );
}

/** Bonustipps als kompakte Zeile mit Fortschrittsring */
function BonusRow({ count, deadline, now }: { count: number; deadline: Date | string; now: number }) {
  const total = BONUS_CATEGORIES.length;
  const done = count >= total;
  const t = Math.min(1, count / total);
  return (
    <Link to="/bonus" className={cx('card card--row home-bonus', !done && 'card--accent')} ariaLabel={`Bonustipps: ${count} von ${total}`}>
      <span className="ring" style={{ ['--t' as string]: t.toFixed(3) }} aria-hidden="true">
        <Icon name={done ? 'check' : 'star'} size={18} />
      </span>
      <span className="card__main">
        <strong>Bonustipps</strong>
        <span className="muted">{done ? 'Alle abgegeben' : <>{count}/{total} · noch <Countdown to={deadline} now={now} prefix="" /></>}</span>
      </span>
      <Icon name="chevron" className="muted" />
    </Link>
  );
}

function RunningCard({ stage, data, me, more }: { stage: Stage; data: TourData; me: Profile; more: number }) {
  const myTip = data.tips.find((t) => t.stage_id === stage.id && t.user_id === me.id);
  return (
    <Link to={`/etappe/${stage.id}`} className="card card--row card--live">
      <div className="card__main">
        <span className="eyebrow status-eyebrow"><Icon name="clock" size={13} />Etappe&nbsp;{stage.number} · Ergebnis folgt</span>
        <strong>Tipps sind aufgedeckt</strong>
        <span className="muted">{myTip ? `Dein Tipp: ${riderName(data, myTip.rider_id)}` : 'Du hast nicht getippt'}</span>
        {more > 0 ? <span className="muted small">{more === 1 ? 'Eine weitere Etappe wartet' : `${more} weitere Etappen warten`} auf das Ergebnis.</span> : null}
      </div>
      <Icon name="chevron" className="muted" />
    </Link>
  );
}

// Neues Ergebnis: beim ersten App-Start danach grün hervorgehoben (für die ganze Sitzung), danach normal
const RESULT_SEEN = 'gruppetto.resultSeen';
const freshResults = new Set<number>();
function isFreshResult(stageId: number): boolean {
  if (freshResults.has(stageId)) return true;
  let seen: string | null = null;
  try { seen = localStorage.getItem(RESULT_SEEN); } catch { return false; }
  if (seen === String(stageId)) return false;
  freshResults.add(stageId);
  try { localStorage.setItem(RESULT_SEEN, String(stageId)); } catch { /* egal */ }
  return true;
}

function LastResultCard({ stage, data, me }: { stage: Stage; data: TourData; me: Profile }) {
  const scores = scoreStageOf(data, stage);
  const mine = scores.find((s) => s.userId === me.id);
  const winner = data.results.find((r) => r.stage_id === stage.id && r.position === 1);
  const fresh = useMemo(() => isFreshResult(stage.id), [stage.id]);
  return (
    <Link to={`/etappe/${stage.id}`} className={cx('card card--row', fresh && 'card--done')}>
      <div className="card__main">
        <span className={cx('eyebrow', fresh && 'status-eyebrow')}>{fresh ? <Icon name="check" size={13} /> : null}{fresh ? 'Neu' : 'Zuletzt'} · Etappe&nbsp;{stage.number}</span>
        <strong>{winner ? `${lastName(riderName(data, winner.rider_id))} gewinnt` : 'Ergebnis veröffentlicht'}</strong>
        <span className="muted">
          {mine ? `Dein Tipp: ${lastName(riderName(data, mine.riderId))} · ${mine.position ? `${mine.position}. Platz` : 'nicht in den Top 10'}` : 'Kein Tipp abgegeben'}
        </span>
      </div>
      <span className={mine && mine.total > 0 ? 'points pos' : 'points muted'}>+{mine?.total ?? 0}</span>
      <Icon name="chevron" className="muted" />
    </Link>
  );
}

function Tiles({ data, me, next }: { data: TourData; me: Profile; next: Stage | null }) {
  const limit = tourTipLimit(data.tour);
  const usage = tipUsage(data.tips, me.id, next?.id);
  const near = data.riders
    .map((r) => ({ r, left: jokerRemaining(data.tour, r, data.tips, me.id, next?.id ?? -1), used: usage.get(r.id) ?? 0 }))
    .filter((x) => x.used > 0 && x.left !== null && x.left <= 1)
    .sort((a, b) => (a.left ?? 0) - (b.left ?? 0) || b.used - a.used)
    .slice(0, 3);
  const bonus = bonusScoresFor(data, me.id).reduce((s, b) => s + b.points, 0);
  return (
    <div className="tiles">
      {near.length ? (
        <div className="tile-card">
          <span className="muted">Noch tippbar</span>
          {near.map(({ r, left }) => (
            <span key={r.id} className="tile-card__line">
              <span>{lastName(r.name)}</span>
              <strong>{left}×</strong>
            </span>
          ))}
        </div>
      ) : limit !== null ? (
        <div className="tile-card">
          <span className="muted">Pro Fahrer</span>
          <span className="tile-card__big">{limit}×</span>
          <span className="muted">pro Rundfahrt</span>
        </div>
      ) : null}
      <Link to="/bonus" className="tile-card">
        <span className="muted">{data.tour.bonus_final ? 'Bonuspunkte' : 'Bonus-Hochrechnung'}</span>
        <span className="tile-card__big">{bonus}</span>
        <span className="muted">{data.tour.bonus_final ? 'Endstand' : 'wenn es so bleibt'}</span>
      </Link>
    </div>
  );
}

function FinalCard({ data, board }: { data: TourData; board: ReturnType<typeof leaderboard> }) {
  const top = board.slice(0, 3);
  return (
    <section className="card">
      <span className="eyebrow">{data.tour.name} · beendet</span>
      <h2 className="card__title">Endstand</h2>
      <ol className="mini-board">
        {top.map((r) => (
          <li key={r.userId}>
            <span className="mini-board__rank">{r.rank}.</span>
            <Avatar name={r.name} color={r.color} size={28} />
            <span className="mini-board__name">{r.name}</span>
            <strong>{r.total}</strong>
          </li>
        ))}
      </ol>
      <LinkButton to="/rangliste" variant="secondary" full>Zur Rangliste</LinkButton>
      {!data.tour.bonus_final ? <p className="hint">Die Bonuspunkte kommen dazu, sobald der Endstand eingetragen ist.</p> : null}
    </section>
  );
}
