import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
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

/** „Heute | News“ als große Überschriften; Punkt am News-Tab, wenn es Neues gibt; darunter eine kleine
 *  Akzentlinie, die beim Wechsel elastisch zum anderen Titel läuft (erst lang, dann wieder kurz) */
function HomeTabs({ tab, onTab, unread }: { tab: HomeTab; onTab: (t: HomeTab) => void; unread: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const ink = useRef<HTMLSpanElement>(null);
  const last = useRef<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    // Linie fest 100 px breit, Länge und Lage nur über transform (scaleX, translateX) – läuft auf der Grafikkarte,
    // auch wenn die Seite gerade die neue Ansicht aufbaut
    const place = (animate: boolean) => {
      const b = box.current;
      const el = ink.current;
      const on = b?.querySelector<HTMLElement>('.home-tab.is-on');
      if (!b || !el || !on) return;
      const w = Math.min(34, on.offsetWidth * 0.36);
      const x = on.offsetLeft;
      const from = last.current;
      last.current = { x, w };
      const tf = (px: number, len: number) => `translateX(${px.toFixed(1)}px) scaleX(${(len / INK_W).toFixed(4)})`;
      el.style.transform = tf(x, w);
      el.style.opacity = '1';
      if (!animate || !from || from.x === x || calm()) return;
      // dehnen bis zum Ziel, dann zusammenziehen
      const lo = Math.min(from.x, x);
      const hi = Math.max(from.x + from.w, x + w);
      try {
        el.animate([
          { transform: tf(from.x, from.w) },
          { transform: tf(lo, hi - lo), offset: 0.42 },
          { transform: tf(x, w) },
        ], { duration: 520, easing: 'cubic-bezier(0.3, 0.75, 0.2, 1)' });
      } catch { /* ohne Animation */ }
    };
    place(true);
    const onResize = () => place(false);
    // Schrift nachgeladen: Titel sind dann etwas anders breit
    document.fonts?.ready.then(onResize).catch(() => undefined);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [tab]);
  const item = (id: HomeTab, label: string) => (
    <button
      type="button" role="tab" id={`home-tab-${id}`} aria-selected={tab === id} aria-controls="home-panel"
      className={cx('home-tab', tab === id && 'is-on')} onClick={() => onTab(id)}
    >
      {label}
      {id === 'news' && unread && tab !== 'news' ? <span className="home-tab__dot" aria-label="neue Meldungen" /> : null}
    </button>
  );
  return (
    <div className="home-tabs" role="tablist" aria-label="Startseite" ref={box}>
      {item('heute', 'Heute')}{item('news', 'News')}
      <span className="home-tabs__ink" ref={ink} aria-hidden="true" />
    </div>
  );
}

const calm = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const ORDER: HomeTab[] = ['heute', 'news'];
/** Grundbreite der Akzentlinie (px) – gezeichnet wird sie über scaleX */
const INK_W = 100;
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const SHIFT = 56;

/**
 * Weicher Wechsel zwischen „Heute“ und „News“ – ohne leeres Bild dazwischen: Beim Tippen wird die alte Seite als
 * Abbild (Kopie) an ihrer Stelle festgehalten, die neue Seite steht sofort darunter. Dann gleiten beide gleichzeitig
 * in Wechselrichtung: das Abbild hinaus und blasser, die neue Seite herein und deckend – wie ein weiches Schieben.
 * Nur Transform und Deckkraft, beides auf der Grafikkarte.
 */
function useTabMotion(tab: HomeTab, setTabState: (t: HomeTab) => void, panel: RefObject<HTMLDivElement | null>) {
  const pending = useRef<{ dir: number; ghost: HTMLElement | null } | null>(null);
  const ghosts = useRef<HTMLElement[]>([]);
  const go = (t: HomeTab) => {
    if (t === tab) return;
    switched = true;
    const dir = ORDER.indexOf(t) > ORDER.indexOf(tab) ? 1 : -1;
    const el = panel.current;
    let ghost: HTMLElement | null = null;
    if (el && !calm() && typeof el.animate === 'function') {
      try {
        // ältere Abbilder (schnelles Hin und Her) sofort weg
        for (const g of ghosts.current) g.remove();
        ghosts.current = [];
        const r = el.getBoundingClientRect();
        const docTop = r.top + window.scrollY;
        ghost = el.cloneNode(true) as HTMLElement;
        ghost.removeAttribute('id');
        ghost.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
        ghost.setAttribute('aria-hidden', 'true');
        ghost.classList.add('home-ghost');
        ghost.classList.remove('reveal');
        ghost.querySelectorAll('.reveal').forEach((n) => n.classList.remove('reveal'));
        // springt die Seite gleich nach oben, beginnt die neue Seite unter dem Kopf: das Abbild darüber abschneiden
        const clip = window.scrollY > docTop ? window.scrollY : 0;
        ghost.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;margin:0;`
          + `pointer-events:none;z-index:5;clip-path:inset(${clip}px 0 0 0);`;
        // im selben Rahmen wie die Seite (gleiche Schrift und Abstände)
        (el.parentElement ?? document.body).append(ghost);
        // seitlich gescrollte Bereiche (Spielkarte) an derselben Stelle zeigen
        const src = el.querySelectorAll<HTMLElement>('*');
        const dst = ghost.querySelectorAll<HTMLElement>('*');
        for (let i = 0; i < src.length && i < dst.length; i++) if (src[i].scrollLeft) dst[i].scrollLeft = src[i].scrollLeft;
        ghosts.current.push(ghost);
      } catch { ghost = null; }
    }
    pending.current = { dir, ghost };
    setTabState(t);
  };
  useLayoutEffect(() => {
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    // neue Seite oben beginnen – aber den Kopf nicht wegscrollen, wenn man ohnehin oben war
    const el = panel.current;
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY;
      if (window.scrollY > top) window.scrollTo({ top: 0 });
    }
    if (!el || !p.ghost || typeof el.animate !== 'function') { p.ghost?.remove(); return; }
    const g = p.ghost;
    el.animate(
      [{ opacity: 0, transform: `translateX(${p.dir * SHIFT}px)` }, { opacity: 1, transform: 'none' }],
      { duration: 440, delay: 40, easing: EASE_OUT, fill: 'backwards' },
    );
    const a = g.animate(
      [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-p.dir * SHIFT * 0.8}px)` }],
      { duration: 260, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' },
    );
    const done = () => { g.remove(); ghosts.current = ghosts.current.filter((x) => x !== g); };
    a.finished.then(done, done);
  }, [tab, panel]);
  useEffect(() => () => { for (const g of ghosts.current) g.remove(); }, []);
  return go;
}

/** Wischen nach links/rechts wechselt den Tab – nicht in Bereichen, die selbst seitlich scrollen (Spielkarte,
 *  Tabellen), nicht vom linken Rand (dort ist die Zurück-Geste des Systems) */
type Pt = { clientX: number; clientY: number };
type TouchLike = { touches: { length: number; [i: number]: Pt }; changedTouches: { length: number; [i: number]: Pt }; target: EventTarget | null };

function useSwipe(onSwipe: (dir: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const scrollsX = (el: Element | null) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      if (e.matches('input, textarea, select, [role=slider]')) return true;
      const ox = getComputedStyle(e).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && e.scrollWidth > e.clientWidth + 1) return true;
    }
    return false;
  };
  return {
    onTouchStart: (e: TouchLike) => {
      const p = e.touches[0];
      start.current = e.touches.length === 1 && p.clientX > 28 && !scrollsX(e.target as Element) ? { x: p.clientX, y: p.clientY, t: performance.now() } : null;
    },
    onTouchEnd: (e: TouchLike) => {
      const s = start.current;
      start.current = null;
      const p = e.changedTouches[0];
      if (!s || !p) return;
      const dx = p.clientX - s.x;
      const dy = p.clientY - s.y;
      const dt = performance.now() - s.t;
      if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.8 && dt < 700) onSwipe(dx < 0 ? 1 : -1);
    },
  };
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
  const panel = useRef<HTMLDivElement>(null);
  const move = useTabMotion(tab, setTabState, panel);
  const setTab = (t: HomeTab) => {
    homeTab = t;
    try { sessionStorage.setItem(TAB_KEY, t); } catch { /* egal */ }
    move(t);
  };
  const swipe = useSwipe((d) => setTab(d > 0 ? 'news' : 'heute'));
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

  const header = (
    <>
      <HomeHead me={me} />
      <HomeTabs tab={tab} onTab={setTab} unread={unread} />
    </>
  );
  // Intro beenden, sobald die Startseite mit Inhalt steht (oder es nichts zu laden gibt)
  const shown = !tour || !!error || (!loading && !!data && !!members);
  useEffect(() => {
    if (shown) introReady('content');
  }, [shown]);

  if (tab === 'news') {
    return (
      <>
        {header}
        <div className="stack home-panel" id="home-panel" role="tabpanel" aria-labelledby="home-tab-news" ref={panel} {...swipe}>
          <NewsTab data={tour && !error ? data ?? null : null} members={members ?? null} now={now} />
        </div>
      </>
    );
  }

  if (!tour) {
    return (
      <>
        {header}
        <div className="stack home-panel" ref={panel} {...swipe}>
          <Empty title="Noch keine Rundfahrt">Sobald der Admin eine Rundfahrt anlegt, kannst du hier tippen.</Empty>
          <GamesCard />
        </div>
      </>
    );
  }
  if (error) return <>{header}<div className="home-panel" ref={panel} {...swipe}><ErrorBox error={error} onRetry={reload} /></div></>;
  if (loading || !data || !members) return <>{header}<div className="home-panel" ref={panel} {...swipe}><HomeSkeleton /></div></>;

  return (
    <>
      {header}
      <div className={cx('stack home-panel', waited.current && !switched && 'reveal')} id="home-panel" role="tabpanel" aria-labelledby="home-tab-heute" ref={panel} {...swipe}>
        <TourPicker tour={tour} tours={tours} />
        <HomeBody data={data} members={members} me={me} now={now} onNews={() => setTab('news')} />
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
