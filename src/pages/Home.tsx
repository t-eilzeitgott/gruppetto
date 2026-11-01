import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTourContext } from '../app/context';
import { useNow } from '../app/hooks';
import { leaderboard, jokerRemaining, bonusScoresFor, scoreStage, tipUsage, tourTipLimit } from '../lib/scoring';
import { bonusDeadline, fmtDay, lastPublishedStage, nextOpenStage, runningStages, tourPhase, dayDiff, fmtClock, fmtKm } from '../lib/time';
import { BONUS_CATEGORIES, type Stage, type TourData } from '../lib/types';
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

type HomeTab = 'heute' | 'news';
const TAB_KEY = 'gruppetto.home.tab';
let homeTab: HomeTab | null = null;
/** schon einmal zwischen den Tabs gewechselt: dann übernimmt die Wechsel-Animation das Einblenden */
let switched = false;
function initialTab(): HomeTab {
  if (homeTab) return homeTab;
  try { return sessionStorage.getItem(TAB_KEY) === 'news' ? 'news' : 'heute'; } catch { return 'heute'; }
}

/** „Heute | News“ als große Überschriften; Punkt am News-Tab, wenn es Neues gibt. Wie hell welcher Titel ist,
 *  steuert der Pager über --p (0 = Heute, 1 = News): beim Wischen folgt das dem Finger, sonst der Bewegung. */
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
const ORDER: HomeTab[] = ['heute', 'news'];
/** Einrasten wie ein iOS-Pager: sehr schnell los, lang und weich auslaufend (gut 90 % des Wegs im ersten Drittel) */
const SNAP_MS = 380;

/** liegt der Finger auf etwas, das selbst seitlich scrollt (Spielkarte, Tabellen) oder auf einem Eingabefeld? */
function scrollsX(el: Element | null) {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    if (e.matches('input, textarea, select, [role=slider]')) return true;
    const ox = getComputedStyle(e).overflowX;
    if ((ox === 'auto' || ox === 'scroll') && e.scrollWidth > e.clientWidth + 1) return true;
  }
  return false;
}

/**
 * Heute und News als Pager wie in nativen Apps: beide Seiten liegen randlos nebeneinander auf einer Schiene und
 * bleiben geladen; der Kopf mit den Titeln steht still. Beim Wischen folgt die Schiene dem Finger 1:1, beim Loslassen
 * (oder Tippen auf einen Titel) rastet sie mit einer schnellen, weich auslaufenden Bewegung ein – die Kurve setzt mit
 * dem Tempo des Fingers an, ohne Ruck. Keine Blende, kein Abbild, kein Neuaufbau: nur ein transform auf der
 * Grafikkarte. Die Titel hellen dabei stufenlos auf bzw. ab. Der React-Zustand (Titel der Seite, gelesen-Markierung)
 * wechselt erst, wenn die Bewegung steht – so rechnet während des Gleitens nichts dazwischen.
 * Die gerade nicht sichtbare Seite ist zusammengeklappt (Höhe 0, unsichtbar), die Seite ist nur so lang wie die sichtbare.
 */
function usePager(tab: HomeTab, commit: (t: HomeTab) => void, tabs: RefObject<TabsCtl | null>, wantNews: () => void) {
  const pager = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const idx = useRef(ORDER.indexOf(tab));
  const run = useRef<{ raf: number; timer: number; t: HTMLElement | null; onEnd: ((e: TransitionEvent) => void) | null } | null>(null);
  const pages = () => Array.from(track.current?.children ?? []) as HTMLElement[];
  const width = () => pager.current?.clientWidth || window.innerWidth;

  const show = (i: number, on: boolean) => {
    const el = pages()[i];
    if (!el) return;
    el.classList.toggle('is-away', !on);
    if (on) { el.removeAttribute('aria-hidden'); el.removeAttribute('inert'); } else { el.setAttribute('aria-hidden', 'true'); el.setAttribute('inert', ''); }
  };
  const place = (x: number, ms = 0, ease = '') => {
    const t = track.current;
    if (!t) return;
    t.style.transition = ms > 0 ? `transform ${ms}ms ${ease}` : 'none';
    // in Ruhe auf der ersten Seite ganz ohne transform: sonst wären feste Ebenen darin an der Schiene statt am Schirm
    const rest = ms === 0 && Math.abs(x) < 0.01;
    t.style.transform = rest ? '' : `translate3d(${x.toFixed(2)}px, 0, 0)`;
    t.style.willChange = rest ? '' : 'transform';
  };
  /** wo die Schiene gerade wirklich steht (auch mitten in der Bewegung) */
  const now = () => {
    const t = track.current;
    if (!t) return -idx.current * width();
    try { return new DOMMatrixReadOnly(getComputedStyle(t).transform).m41; } catch { return -idx.current * width(); }
  };
  const stop = () => {
    const r = run.current;
    if (!r) return;
    cancelAnimationFrame(r.raf);
    window.clearTimeout(r.timer);
    if (r.t && r.onEnd) r.t.removeEventListener('transitionend', r.onEnd);
    run.current = null;
  };

  // Ausgangslage beim Einhängen
  useLayoutEffect(() => {
    idx.current = ORDER.indexOf(tab);
    ORDER.forEach((_, i) => show(i, i === idx.current));
    place(-idx.current * width());
    const onResize = () => { if (!run.current) place(-idx.current * width()); };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Bewegung beendet: alte Seite zuklappen, Zustand übernehmen */
  const settle = (i: number) => {
    stop();
    pages().forEach((el) => { el.style.transform = ''; });
    ORDER.forEach((_, k) => show(k, k === i));
    place(-i * width());
    tabs.current?.set(i);
    commit(ORDER[i]);
  };

  /**
   * Zur Seite i gleiten, von der Stelle x aus, mit dem Fingertempo v (px/ms, Vorzeichen wie die Bewegung). Die Kurve
   * (cubic-bezier) beginnt mit genau diesem Tempo und läuft weich aus.
   */
  const snap = (i: number, x: number, v: number) => {
    stop();
    const w = width();
    const target = -i * w;
    const dist = target - x;
    idx.current = i;
    if (calm() || Math.abs(dist) < 0.5) { settle(i); return; }
    // Dauer nach Restweg: ganze Seite ≈ SNAP_MS, kurze Wege kürzer
    const ms = Math.round(Math.max(220, Math.min(SNAP_MS, SNAP_MS * Math.sqrt(Math.abs(dist) / w))));
    // Anfangssteigung der Kurve = Fingertempo (in Anteilen der Strecke je Anteil der Zeit); ohne Finger: zügiger Start
    const along = Math.sign(dist) === Math.sign(v) ? Math.abs(v) : 0;
    const slope = along > 0 ? (along * ms) / Math.abs(dist) : 3.2;
    const x1 = 0.2;
    const y1 = Math.max(0.5, Math.min(1, slope * x1));
    const ease = `cubic-bezier(${x1}, ${y1.toFixed(3)}, 0.24, 1)`;
    place(x);
    const t = track.current;
    const r: { raf: number; timer: number; t: HTMLElement | null; onEnd: ((e: TransitionEvent) => void) | null } = { raf: 0, timer: 0, t, onEnd: null };
    run.current = r;
    const follow = () => {
      // Titel hellen mit der tatsächlichen Lage auf
      tabs.current?.set(-now() / w);
      r.raf = requestAnimationFrame(follow);
    };
    // Stil erst im nächsten Bild ändern, damit der Startpunkt gezeichnet ist (sonst springt die Bewegung)
    r.raf = requestAnimationFrame(() => {
      if (run.current !== r) return;
      place(target, ms, ease);
      r.raf = requestAnimationFrame(follow);
      r.onEnd = (e) => { if (e.target === t && e.propertyName === 'transform') settle(i); };
      t?.addEventListener('transitionend', r.onEnd);
      r.timer = window.setTimeout(() => { if (run.current === r) settle(i); }, ms + 150);
    });
  };

  /** beide Seiten zeigen (vor einer Bewegung); war man weit unten, den Kopf wieder ins Bild holen, ohne dass die
   *  aktuelle Seite dabei optisch springt */
  const open = (towards: number) => {
    const all = pages();
    const cur = all[idx.current];
    ORDER.forEach((_, k) => show(k, true));
    const head = document.querySelector<HTMLElement>('.home-tabs');
    if (!head || !cur || towards === idx.current) return;
    const keep = Math.max(0, head.getBoundingClientRect().top + window.scrollY - 12);
    const lift = window.scrollY - keep;
    if (lift > 0) {
      window.scrollTo(0, keep);
      cur.style.transform = `translate3d(0, ${-lift}px, 0)`;
    }
  };

  const go = (t: HomeTab) => {
    const i = ORDER.indexOf(t);
    if (i === idx.current && !run.current) return;
    if (t === 'news') wantNews();
    const moving = !!run.current;
    const x = now();
    stop();
    if (!moving) open(i);
    snap(i, x, 0);
  };

  // Wischen: folgt dem Finger, rastet nach Weg (über die Hälfte) oder Tempo ein
  useEffect(() => {
    const el = pager.current;
    if (!el) return;
    let s: { x0: number; y0: number; base: number; lock: 0 | 1 | 2; pts: { x: number; t: number }[] } | null = null;
    const down = (e: TouchEvent) => {
      const p = e.touches[0];
      if (e.touches.length !== 1 || p.clientX < 14 || scrollsX(e.target as Element)) { s = null; return; }
      // in eine laufende Bewegung greifen: dort festhalten, wo die Schiene gerade ist
      let base = -idx.current * width();
      if (run.current) { base = now(); stop(); place(base); }
      s = { x0: p.clientX, y0: p.clientY, base, lock: 0, pts: [{ x: p.clientX, t: e.timeStamp }] };
    };
    const move = (e: TouchEvent) => {
      if (!s) return;
      const p = e.touches[0];
      const dx = p.clientX - s.x0;
      const dy = p.clientY - s.y0;
      if (s.lock === 0) {
        if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return;
        s.lock = Math.abs(dx) > Math.abs(dy) * 1.1 ? 1 : 2;
        if (s.lock === 2) {
          // senkrecht: normal scrollen; hatte man in eine Bewegung gegriffen, sauber zu Ende einrasten
          const w = width();
          if (Math.abs(s.base + idx.current * w) > 0.5) snap(Math.round(-s.base / w), s.base, 0);
          s = null;
          return;
        }
        wantNews();
        const i = idx.current;
        open(i === 0 && dx < 0 ? 1 : i === ORDER.length - 1 && dx > 0 ? i - 1 : i);
        // ab hier zählt der Weg ab dem Einrasten der Achse – kein Sprung um die ersten Pixel
        s.x0 = p.clientX - Math.sign(dx);
      }
      if (e.cancelable) e.preventDefault();
      const w = width();
      const min = -(ORDER.length - 1) * w;
      let x = s.base + (p.clientX - s.x0);
      // über den Rand hinaus gummiartig nachgeben
      if (x > 0) x *= 0.3;
      else if (x < min) x = min + (x - min) * 0.3;
      place(x);
      tabs.current?.set(-x / w);
      s.pts.push({ x: p.clientX, t: e.timeStamp });
      if (s.pts.length > 6) s.pts.shift();
    };
    const up = (e: TouchEvent) => {
      const st = s;
      s = null;
      if (!st || st.lock !== 1) return;
      const w = width();
      const x = now();
      // Tempo aus den letzten ~100 ms
      const end = e.timeStamp;
      const pts = st.pts.filter((q) => end - q.t < 100);
      const v = pts.length > 1 ? (pts[pts.length - 1].x - pts[0].x) / Math.max(8, pts[pts.length - 1].t - pts[0].t) : 0;
      const pos = -x / w; // 0 … 1: wie weit Richtung News
      let to = Math.round(pos);
      if (Math.abs(v) > 0.3) to = v < 0 ? Math.ceil(pos - 0.02) : Math.floor(pos + 0.02);
      to = Math.max(0, Math.min(ORDER.length - 1, to));
      snap(to, x, v);
    };
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', up);
    el.addEventListener('touchcancel', up);
    return () => {
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', up);
      el.removeEventListener('touchcancel', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { pager, track, go };
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
    switched = true;
    try { sessionStorage.setItem(TAB_KEY, t); } catch { /* egal */ }
    setTabState(t);
  };
  const { pager, track, go } = usePager(tab, commit, tabs, () => setNewsOn(true));
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

  let today: ReactNode;
  if (!tour) {
    today = (
      <div className="stack">
        <Empty title="Noch keine Rundfahrt">Sobald der Admin eine Rundfahrt anlegt, kannst du hier tippen.</Empty>
        <GamesCard />
      </div>
    );
  } else if (error) today = <ErrorBox error={error} onRetry={reload} />;
  else if (loading || !data || !members) today = <HomeSkeleton />;
  else {
    today = (
      <div className={cx('stack', waited.current && !switched && 'reveal')}>
        <TourPicker tour={tour} tours={tours} />
        <HomeBody data={data} members={members} me={me} now={now} onNews={() => go('news')} />
      </div>
    );
  }

  return (
    <>
      <HomeHead me={me} />
      <HomeTabs tab={tab} onTab={go} unread={unread} ctl={tabs} />
      <div className="home-pager" ref={pager}>
        <div className="home-track" ref={track}>
          <div className="home-page" id="home-panel-heute" role="tabpanel" aria-labelledby="home-tab-heute">{today}</div>
          <div className="home-page" id="home-panel-news" role="tabpanel" aria-labelledby="home-tab-news">
            {newsOn ? <div className="stack"><NewsTab data={tour && !error ? data ?? null : null} members={members ?? null} now={now} /></div> : null}
          </div>
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
  const route = stageRoute(stage);
  return (
    <section className={cx('card tip-card', !myTip && 'card--accent')} aria-labelledby={`next-${stage.id}`}>
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
        <Link to={`/tipp/${stage.id}`} className="my-tip" ariaLabel={`Dein Tipp: ${riderName(data, myTip.rider_id)} – ändern`}>
          <Icon name="check" size={18} />
          <strong className="my-tip__name">{riderName(data, myTip.rider_id)}</strong>
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
  const scores = scoreStage(stage, data.tips, data.results, data.scale);
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
