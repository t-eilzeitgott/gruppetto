import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { prewarm } from '../game/abfahrt/pool';
import type { WarmArgs } from '../app/warm';
import { useApp } from '../app/context';
import { useMembers, useTourData } from '../app/hooks';
import { invalidate, useQuery } from '../app/query';
import { navigate } from '../app/router';
import { source } from '../app/config';
import type { GameBest } from '../data/source';
import { TimeTrial, sectorGap, simulateGhost, type TtEvent, type TtHud, type TtResult } from '../game/abfahrt/zeitfahren';
import { stageRef, type StageRef } from '../game/abfahrt/stageRef';
import { gameSubFor } from '../game/gameSub';
import { TT_FINISH, TT_SPLITS, TT_TOP, Track } from '../game/abfahrt/track';
import { berlinDayKey, berlinDayStart } from '../game/abfahrt/rng';
import { firstName, fmtGap, fmtTime, ghostDayLabel, pickGhosts, ttMs, ttScore, type GhostRider, type TtGhostRow } from '../game/tt';
import { bikeById } from '../game/bikes';
import { HudBanner, PowerRing, RaceBar, TvAd, raceBar, writeBar, writeRing } from './hud';
import { Avatar, cx, useTitle } from '../ui/kit';
import { useBikes, type Bikes } from '../ui/useBikes';
import { BikeChip, NewBikePill } from './bikeChip';
import { Icon } from '../ui/Icon';
import { Skel, SkelText } from '../ui/skeleton';
import { BoardLink, Countdown, StartSheet } from './startSheet';
import { BrakeIcon, PauseIcon, PlayIcon, TuckIcon, readAccent } from './Game';
import { FpsSwitch, GfxSwitches, RangePicker } from './gameKit';
import {
  FinaleBoard, HowTo, dist, lsGet, lsSet, placeIn, placeThumb,
  useGameLock, useRaceKeys, useRaceLoop, type Board, type Ui,
} from './finale';
import type { Profile } from '../lib/types';

const LS_RUNS = 'gruppetto.zeitfahren.runs';
const LS_BEST = 'gruppetto.zeitfahren.best';

type Coach = 'line' | 'climb' | 'tuck';
const COACH: Record<Coach, { t: string; s: string; g: string }> = {
  line: { t: 'Die Linie zählt', s: 'Innen durch die Kurve ist der Weg kürzer – Daumen seitlich', g: 'is-steer' },
  climb: { t: 'Jetzt drücken', s: 'Daumen hoch – am Berg lohnt sich der Vorrat am meisten', g: 'is-tuck' },
  tuck: { t: 'Abfahrt: ducken', s: 'Daumen hoch = schneller · vor engen Kurven loslassen', g: 'is-tuck' },
};

/** Tempomacher des Tages (einmal je Tag durchgerechnet) */
const pacers = new Map<string, GhostRider>();
export function pacerOf(day: string): GhostRider {
  let g = pacers.get(day);
  if (!g) {
    const r = simulateGhost(day, { strength: 1, line: 0.8, seed: 7 });
    g = { id: 'bot', name: 'Tempomacher', color: '#9aa0a8', bike: 'zeit', timeMs: r.timeMs, splits: r.splits, trace: r.trace, bot: true };
    pacers.set(day, g);
  }
  return g;
}

/**
 * Geister aus den gespeicherten Fahrten: je Mitglied die beste Fahrt von heute, sonst seine letzte (als älterer
 * Geist mit Tag). Der eigene Geist ebenso – heute der Bestlauf (auch der gerade gefahrene, bevor er gespeichert ist).
 */
export function buildGhosts(rows: TtGhostRow[], members: Profile[], me: Profile, local: TtGhostRow | null, day: string): GhostRider[] {
  const list: GhostRider[] = [];
  const latest = new Map<string, TtGhostRow>();
  for (const r of [...rows, ...(local ? [local] : [])]) {
    if (r.day > day) continue;
    const prev = latest.get(r.user_id);
    if (!prev || r.day > prev.day || (r.day === prev.day && r.time_ms < prev.time_ms)) latest.set(r.user_id, r);
  }
  for (const r of latest.values()) {
    const old = r.day < day ? ghostDayLabel(r.day, day) : undefined;
    if (r.user_id === me.id) {
      list.push({ id: 'me', name: 'Du', color: me.avatar_color, bike: r.bike || 'allround', timeMs: r.time_ms, splits: r.splits, trace: r.trace, me: true, old });
      continue;
    }
    const m = members.find((x) => x.id === r.user_id);
    list.push({ id: r.user_id, name: m?.display_name ?? 'Jemand', color: m?.avatar_color ?? '#888888', bike: r.bike || 'allround', timeMs: r.time_ms, splits: r.splits, trace: r.trace, old });
  }
  return list;
}

/** Startbild des Zeitfahrens ohne Seite: beim App-Start unsichtbar vorwärmen (siehe app/warm.ts) */
export function warmZeitfahren(a: WarmArgs, reuse = false): Promise<void> {
  const town = stageRef('tt', a.tour?.name, a.data?.stages, a.day);
  return prewarm(() => new TimeTrial({
    dayKey: a.day,
    names: a.names,
    rider: a.me.display_name ?? 'Du',
    kit: { jersey: a.accent, side: '#ffffff', helmet: '#ffffff', shorts: '#16171a', skin: '#f0c4a0', shoes: '#ffffff', number: '1', bike: a.bike },
    town,
    ghosts: [],
    myBest: null,
    onEvent: () => undefined,
    onOver: () => undefined,
  }), { accent: a.accent, dark: a.dark }, 'zeitfahren', reuse);
}

/** Minispiel „Zeitfahren“: 3 km gegen die Uhr, mit den Geistern der Runde auf der Strecke */
export function ZeitfahrenPage() {
  useTitle('Zeitfahren');
  const { me, tour } = useApp();
  const members = useMembers();
  const tourData = useTourData(tour);
  const day = berlinDayKey();
  const since = useMemo(() => berlinDayStart().toISOString(), [day]);
  const season = useQuery<GameBest[]>('game:zeitfahren:season', () => source.gameLeaderboard('zeitfahren'));
  const today = useQuery<GameBest[]>(`game:zeitfahren:day:${day}`, () => source.gameLeaderboard('zeitfahren', since));
  const ghostQ = useQuery<TtGhostRow[]>(`tt:ghosts:${day}`, () => source.ttGhosts(day));
  const bikes = useBikes();

  const stageEl = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<TimeTrial | null>(null);
  const [glError, setGlError] = useState(false);
  const [ui, setUi] = useState<Ui>('ready');
  const uiRef = useRef<Ui>('ready');
  uiRef.current = ui;
  const [count, setCount] = useState(5);
  const [result, setResult] = useState<TtResult | null>(null);
  const [banner, setBanner] = useState<{ key: number; title: string; sub?: string; tone?: 'gold' | 'accent' | 'red' } | null>(null);
  const [board, setBoard] = useState<Board>('day');
  const [showBoard, setShowBoard] = useState(false);
  const [coach, setCoach] = useState<Coach | null>(null);
  const coachRef = useRef<{ on: boolean; t: number; shown: Set<Coach>; cur: Coach | null }>({ on: false, t: 0, shown: new Set(), cur: null });
  const [saveFailed, setSaveFailed] = useState(false);
  /** eigene Bestzeit beim Start des Laufs (für „Persönliche Bestzeit“ im Ergebnis) */
  const bestAtStart = useRef<number | null>(null);
  // eigener Bestlauf des Tages, auch bevor die Geister neu geladen sind (und auf diesem Gerät gemerkt)
  const [local, setLocal] = useState<TtGhostRow | null>(null);
  const hud = useRef<Record<string, HTMLElement | null>>({});
  const last = useRef<Record<string, string>>({});
  const bind = (key: string) => (el: HTMLElement | null) => { hud.current[key] = el; };

  const names = useMemo(() => (members.data ?? []).map((m) => m.display_name ?? '').filter(Boolean), [members.data]);
  // echte Vorlage: nächstes Einzelzeitfahren der Rundfahrt (sonst aus dem Plan der Tour 2027) – nur Namen und Gegend
  const ref = useMemo(() => stageRef('tt', tour?.name, tourData.data?.stages, day), [tour?.name, tourData.data, day]);
  const track = useMemo(() => new Track(day, names, 'tt', ref), [day, names, ref]);
  const ghostRows = ghostQ.data;
  // Geister stehen fest (geladen oder nicht erreichbar): bei weniger als drei Mitspielern fährt der Tempomacher mit
  const settled = ghostRows !== undefined || !!ghostQ.error;
  const ghosts = useMemo(() => {
    const all = buildGhosts(ghostRows ?? [], members.data ?? [], me, local, day);
    const others = all.filter((g) => !g.me).length;
    return pickGhosts(all, all.find((g) => g.me && !g.old)?.timeMs ?? null, others < 3 && settled ? pacerOf(day) : null);
  }, [ghostRows, settled, members.data, me, local, day]);
  // Bestzeit und Tagesführung: nur Fahrten von heute (ältere Geister fuhren eine andere Strecke)
  const myBest = ghosts.find((g) => g.me && !g.old)?.timeMs ?? null;
  const leader = useMemo(() => [...ghosts].filter((g) => !g.bot && !g.old).sort((a, b) => a.timeMs - b.timeMs)[0] ?? null, [ghosts]);

  const makeEngine = () => {
    const accent = readAccent();
    const eng = new TimeTrial({
      dayKey: day,
      names,
      rider: me.display_name ?? 'Du',
      kit: { jersey: accent, side: '#ffffff', helmet: '#ffffff', shorts: '#16171a', skin: '#f0c4a0', shoes: '#ffffff', number: String(Math.max(1, (today.data?.findIndex((b) => b.user_id === me.id) ?? -1) + 1)), bike: bikes.current },
      town: ref,
      ghosts,
      myBest,
      onEvent: (e) => onEvent(e),
      onOver: (r) => onOver(r),
    });
    eng.setViewport(stageEl.current?.getBoundingClientRect().width ?? 390);
    return eng;
  };

  const bannerKey = useRef(0);
  const show = (title: string, sub?: string, tone?: 'gold' | 'accent' | 'red') => {
    bannerKey.current += 1;
    setBanner({ key: bannerKey.current, title, sub, tone });
  };
  const onEvent = (e: TtEvent) => {
    if (e.type === 'count') {
      setCount(e.n);
      if (e.n === 0 && uiRef.current === 'countdown') setUi('playing');
      return;
    }
    if (e.type === 'split') {
      const sub = e.gapMs === null ? `${e.place}. Platz` : `${fmtGap(e.gapMs)} ${e.gapMs <= 0 ? 'vor' : 'hinter'} ${e.bestName ?? 'der Bestzeit'} · ${e.place}. von ${e.riders}`;
      show(`Zwischenzeit ${e.index + 1} · ${fmtTime(e.timeMs)}`, sub, e.gapMs !== null && e.gapMs <= 0 ? 'gold' : e.gapMs === null ? undefined : 'accent');
      try { navigator.vibrate?.(e.gapMs !== null && e.gapMs <= 0 ? [40, 60, 40] : 40); } catch { /* egal */ }
      return;
    }
    show(e.title, e.sub, e.tone);
  };

  const onOver = (r: TtResult) => {
    setResult(r);
    setUi('over');
    setCoach(null);
    setSaveFailed(false);
    lsSet(LS_RUNS, String((Number(lsGet(LS_RUNS)) || 0) + 1));
    const lb = `${LS_BEST}.${day}`;
    const prev = Number(lsGet(lb)) || 0;
    if (!prev || r.timeMs < prev) lsSet(lb, String(r.timeMs));
    source.submitScore('zeitfahren', ttScore(r.timeMs), TT_FINISH).then(() => invalidate('game:zeitfahren')).catch(() => setSaveFailed(true));
    if (r.pb) {
      const row: TtGhostRow = { user_id: me.id, day, time_ms: r.timeMs, bike: bikes.current, splits: r.splits, trace: r.trace, created_at: new Date().toISOString() };
      setLocal(row);
      source.saveTtGhost({ day, time_ms: r.timeMs, bike: bikes.current, splits: r.splits, trace: r.trace }).then(() => invalidate(`tt:ghosts:${day}`)).catch(() => setSaveFailed(true));
    }
  };

  /** Tutorial der ersten Läufe: Linie im Tal, drücken an der Côte, ducken in der Abfahrt */
  const runCoach = (h: TtHud, dt: number) => {
    const c = coachRef.current;
    if (!c.on || uiRef.current !== 'playing') return;
    c.t += dt;
    const showC = (k: Coach | null) => { c.cur = k; c.t = 0; setCoach(k); };
    const z = TT_FINISH - h.toGo;
    if (!c.shown.has('line') && z > 300 && z < 900) { c.shown.add('line'); showC('line'); return; }
    if (c.cur === 'line' && c.t > 5) showC(null);
    if (!c.shown.has('climb') && z > 1060 && z < 1400) { c.shown.add('climb'); showC('climb'); return; }
    if (c.cur === 'climb' && (h.mode === 'go' || c.t > 5)) showC(null);
    if (!c.shown.has('tuck') && h.down && z > TT_TOP + 40) { c.shown.add('tuck'); showC('tuck'); return; }
    if (c.cur === 'tuck' && c.t > 5.5) { c.on = false; showC(null); }
  };

  const strip = useMemo(() => stripPoints(track), [track]);
  const writeHud = (eng: TimeTrial, dt = 0) => {
    if (uiRef.current !== 'playing' && uiRef.current !== 'paused') return;
    const h = eng.hud();
    runCoach(h, dt);
    placeThumb(hud.current.thumb, h.touch, uiRef.current === 'playing', h.mode === 'go', h.mode === 'ease');
    const set = (key: string, val: string) => {
      if (last.current[key] === val) return;
      last.current[key] = val;
      const el = hud.current[key];
      if (el) el.textContent = val;
    };
    writeBar(hud.current, last.current, raceBar(h.board, h.toGo > 0 ? dist(h.toGo) : 'Ziel', 'flag', 1 - h.toGo / TT_FINISH));
    const g = Math.round(h.grade);
    writeRing(hud.current, last.current, { kmh: h.kmh, fill: h.energy, tone: 'energy', mode: h.mode, draft: 0, badge: h.toGo > 0 ? `${g > 0 ? '▲' : g < 0 ? '▼' : ''} ${Math.abs(g)} %` : '' });
    set('clock', fmtTime(h.time * 1000));
    if (h.gapBest !== null) {
      const gapMs = Math.round(h.gapBest * 1000);
      set('clockGap', `${fmtGap(gapMs)} · ${h.bestName ?? ''}`);
      const key = gapMs <= 0 ? 'ahead' : 'behind';
      if (last.current.gapTone !== key) {
        last.current.gapTone = key;
        hud.current.clockGap?.classList.toggle('is-ahead', gapMs <= 0);
        hud.current.clockGap?.classList.toggle('is-behind', gapMs > 0);
      }
    } else set('clockGap', '');
    // Streckenleiste: eigener Punkt und die Geister
    const place = (el: HTMLElement | null | undefined, z: number) => {
      if (!el) return;
      const [x, y] = stripXY(strip, z);
      el.style.left = `${((x / STRIP_W) * 100).toFixed(2)}%`;
      el.style.top = `${((y / STRIP_H) * 100).toFixed(2)}%`;
    };
    place(hud.current.stripMe, TT_FINISH - h.toGo);
    for (const gh of h.ghosts) place(hud.current[`strip:${gh.id}`], gh.z);
  };

  const glGen = useRaceLoop({
    game: 'zeitfahren',
    stageRef: stageEl, engineRef, uiRef,
    make: makeEngine,
    onFrame: writeHud,
    onGlError: () => setGlError(true),
    onHidden: () => setUi('paused'),
  });

  // Vorschau im Startbildschirm: sobald Namen, Vorlage oder Geister da sind
  useEffect(() => {
    if (uiRef.current === 'ready' && engineRef.current) engineRef.current = makeEngine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names, ref, ghosts, bikes.current]);

  useGameLock();

  const start = () => {
    if (!stageEl.current) return;
    bestAtStart.current = myBest;
    engineRef.current = makeEngine();
    engineRef.current.start();
    setResult(null);
    setShowBoard(false);
    setBanner(null);
    setCount(5);
    last.current = {};
    coachRef.current = { on: (Number(lsGet(LS_RUNS)) || 0) < 3, t: 0, shown: new Set(), cur: null };
    setCoach(null);
    setUi('countdown');
  };

  const togglePause = () => {
    if (uiRef.current === 'playing') setUi('paused');
    else if (uiRef.current === 'paused') setUi('playing');
  };

  useRaceKeys(engineRef, uiRef, start, togglePause);

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (ui !== 'playing' && ui !== 'countdown') return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    engineRef.current?.pointerDown(e.clientX, e.clientY);
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.buttons === 0) return;
    engineRef.current?.pointerMove(e.clientX, e.clientY);
  };
  const onPointerUp = () => engineRef.current?.pointerUp();

  const fmtBest = (b: number) => fmtTime(ttMs(b));
  const boardRows = board === 'day' ? today.data ?? [] : season.data ?? [];
  const boardView = (
    <FinaleBoard title="Bestenliste Zeitfahren" rows={boardRows} board={board} setBoard={setBoard} members={members.data ?? []} meId={me.id} onBack={() => setShowBoard(false)} unit={['Fahrt', 'Fahrten']} fmt={fmtBest} />
  );
  const sub = gameSubFor('zeitfahren', day, ref);

  return (
    <div className={cx('abf', 'abf--sprint', 'abf--tt', `abf--${ui}`)}>
      {/* 3D-Bühne: die Leinwand kommt aus dem Vorrat (pool.ts) und wird hier eingehängt */}
      <div
        key={glGen}
        ref={stageEl}
        className="abf__stage"
        role="application"
        aria-label="Spielfeld: Daumen seitlich ziehen lenkt (Linie), nach oben drücken (bergab ducken), nach unten erholen (bergab bremsen)"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {glError ? (
        <div className="abf-layer">
          <div className="abf-card abf-card--small">
            <h2 className="abf-title">3D nicht verfügbar</h2>
            <p className="abf-muted">Dein Browser kann gerade keine 3D-Grafik (WebGL) anzeigen. Probier es in Safari oder Chrome noch einmal.</p>
            <button type="button" className="btn btn--secondary btn--full" onClick={() => navigate('/')}><span>Zurück</span></button>
          </div>
        </div>
      ) : null}

      {/* HUD erst mit „Los“ (gestaffelt herein) – im Countdown nur Welt und Ring */}
      {ui === 'playing' || ui === 'paused' ? (
        <div className="abf-hud hud">
          <div className="hud-top">
            <button type="button" className="abf-round" onClick={togglePause} aria-label={ui === 'paused' ? 'Weiter' : 'Pause'}>
              {ui === 'paused' ? <PlayIcon /> : <PauseIcon />}
            </button>
            <RaceBar bind={bind} marks={[...TT_SPLITS.map((z) => ({ at: z / TT_FINISH, kind: 'friend' as const, color: '#ffd23f' })), { at: TT_TOP / TT_FINISH, kind: 'gpm' as const }]} />
            <PowerRing bind={bind} badge />
          </div>
          <div className="tt-clock" aria-hidden="true">
            <b ref={bind('clock')}>0:00,0</b>
            <span className="tt-clock__gap" ref={bind('clockGap')} />
          </div>
          <TtStrip strip={strip} ghosts={ghosts} bind={bind} />
          {banner && ui === 'playing' ? <HudBanner banner={banner} onEnd={() => setBanner(null)} /> : null}
          <div className="abf-thumb" ref={bind('thumb')} aria-hidden="true">
            <span className="abf-thumb__up"><TuckIcon /></span>
            <span className="abf-thumb__dot" />
            <span className="abf-thumb__down"><BrakeIcon /></span>
          </div>
          <TvAd hidden={!!coach || ui !== 'playing'} seed={8} />
        </div>
      ) : null}

      {coach && ui === 'playing' ? (
        <div key={coach} className="abf-coach spr-coach" role="status">
          <span className={cx('abf-coach__gesture', COACH[coach].g)} aria-hidden="true"><i /></span>
          <span className="abf-coach__text"><strong>{COACH[coach].t}</strong><span>{COACH[coach].s}</span></span>
        </div>
      ) : null}

      {ui === 'countdown' ? <Countdown count={count} step={0.6} /> : null}

      {ui === 'paused' ? (
        <div className="abf-layer">
          <div className="abf-card abf-card--small abf-scroll">
            <h2 className="abf-title">Pause</h2>
            <p className="abf-muted">Die Uhr steht – die Geister warten mit.</p>
            <button type="button" className="btn btn--primary btn--full" onClick={() => setUi('playing')}><span>Weiterfahren</span></button>
            <button type="button" className="btn btn--secondary btn--full" onClick={() => navigate('/')}><span>Aufhören</span></button>
            <RangePicker />
            <FpsSwitch />
            <GfxSwitches />
          </div>
        </div>
      ) : null}

      {ui === 'ready' ? (
        <StartSheet game="zeitfahren" title="Zeitfahren" sub={sub} cta="Auf die Rampe" onStart={start} onClose={() => navigate('/')} plain={showBoard}>
          {showBoard ? boardView : (
            <>
              <TtProfile track={track} ref_={ref} />
              <HotSeat leader={leader} myBest={myBest} today={today.data ?? []} meId={me.id} members={members.data ?? []} error={!!ghostQ.error && !ghostQ.data} />
              <GhostRow ghosts={ghosts} members={members.data ?? []} me={me} loading={ghostQ.loading} />
              <HowTo items={[['↔', 'Linie'], ['↑', 'Drücken'], ['↓', 'Erholen']]} />
              <BikeChip bikes={bikes} />
              <BoardLink rows={today.data?.length ? today.data : season.data ?? []} label={today.data?.length ? 'Heute' : 'Saison'} members={members.data ?? []} meId={me.id} onOpen={() => setShowBoard(true)} fmt={fmtBest} />
            </>
          )}
        </StartSheet>
      ) : null}

      {ui === 'over' && result ? (
        <div className="abf-layer">
          <button type="button" className="abf-round abf-close" onClick={() => navigate('/')} aria-label="Schließen"><Icon name="x" size={20} /></button>
          <div className="abf-card abf-scroll">
            {showBoard ? boardView : (
              <TtSummary
                bikes={bikes}
                result={result}
                today={today.data ?? []}
                season={season.data ?? []}
                meId={me.id}
                hadBest={bestAtStart.current !== null}
                saveFailed={saveFailed}
                onAgain={start}
                onBoard={() => setShowBoard(true)}
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ Streckenleiste und Profil

const STRIP_W = 300;
const STRIP_H = 30;
type Strip = { ys: number[]; n: number };

/** Höhenprofil als Stützpunkte (y in px der Leiste, 0 = oben) */
function stripPoints(track: Track): Strip {
  const n = 100;
  const hs: number[] = [];
  for (let i = 0; i <= n; i++) hs.push(track.heightAt((i / n) * TT_FINISH));
  const top = Math.max(...hs);
  const low = Math.min(...hs);
  return { ys: hs.map((h) => 5 + ((top - h) / Math.max(1, top - low)) * (STRIP_H - 10)), n };
}

function stripXY(s: Strip, z: number): [number, number] {
  const f = Math.max(0, Math.min(1, z / TT_FINISH)) * s.n;
  const i = Math.floor(f);
  const y = s.ys[i] + (s.ys[Math.min(s.n, i + 1)] - s.ys[i]) * (f - i);
  return [(z / TT_FINISH) * STRIP_W, y];
}

/** HUD: Höhenprofil der Strecke mit Zwischenzeit-Marken, Côte und den Punkten aller Fahrer (wird je Bild beschrieben) */
function TtStrip({ strip, ghosts, bind }: { strip: Strip; ghosts: GhostRider[]; bind: (k: string) => (el: HTMLElement | null) => void }) {
  const line = strip.ys.map((y, i) => `${i ? 'L' : 'M'}${((i / strip.n) * STRIP_W).toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <div className="tt-strip" aria-hidden="true">
      <svg viewBox={`0 0 ${STRIP_W} ${STRIP_H}`} preserveAspectRatio="none">
        <path d={`${line} L${STRIP_W},${STRIP_H} L0,${STRIP_H} Z`} className="tt-strip__area" />
        <path d={line} className="tt-strip__line" vectorEffect="non-scaling-stroke" />
        {TT_SPLITS.map((z) => <line key={z} x1={(z / TT_FINISH) * STRIP_W} x2={(z / TT_FINISH) * STRIP_W} y1={0} y2={STRIP_H} className="tt-strip__split" vectorEffect="non-scaling-stroke" />)}
      </svg>
      <div className="tt-strip__dots">
        {ghosts.map((g) => <i key={g.id} ref={bind(`strip:${g.id}`)} className={cx('tt-strip__dot', g.me && 'is-mine')} style={{ background: g.bot ? '#9aa0a8' : g.color }} />)}
        <i ref={bind('stripMe')} className="tt-strip__dot is-me" />
      </div>
    </div>
  );
}

/** Startkarte: Höhenprofil mit Start, Zwischenzeiten, Côte und Ziel */
function TtProfile({ track, ref_ }: { track: Track; ref_: StageRef | null }) {
  const W = 300;
  const H = 46;
  const pts = useMemo(() => {
    const n = 90;
    const ys: number[] = [];
    for (let i = 0; i <= n; i++) ys.push(track.heightAt((i / n) * TT_FINISH));
    const top = Math.max(...ys);
    const low = Math.min(...ys);
    return ys.map((y, i) => [(i / n) * W, 4 + ((top - y) / Math.max(1, top - low)) * (H - 10)] as [number, number]);
  }, [track]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const climb = ref_?.climb?.grad ? `${ref_.climb.grad.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %` : 'bis 8,5 %';
  return (
    <figure className="abf-profile tt-profile" aria-label={`Profil: Start in ${track.startTown}, Zwischenzeiten bei 1 und 2 km, ${track.climbName} bei 1,5 km, Ziel in ${track.finishTown}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={`${line} L${W},${H} L0,${H} Z`} className="abf-profile__area" />
        <path d={line} className="abf-profile__line" vectorEffect="non-scaling-stroke" />
        {TT_SPLITS.map((z) => <line key={z} x1={(z / TT_FINISH) * W} x2={(z / TT_FINISH) * W} y1={0} y2={H} className="tt-profile__split" vectorEffect="non-scaling-stroke" />)}
      </svg>
      <span className="tt-profile__cote" style={{ left: `${(TT_TOP / TT_FINISH) * 100}%` }}>
        <span>{track.climbName} · {climb}</span>
      </span>
      <span className="tt-profile__mark" style={{ left: `${(TT_SPLITS[0] / TT_FINISH) * 100}%` }}>ZZ1</span>
      <span className="tt-profile__mark" style={{ left: `${(TT_SPLITS[1] / TT_FINISH) * 100}%` }}>ZZ2</span>
      <span className="tt-profile__start">{track.startTown}</span>
      <span className="tt-profile__finish">{track.finishTown}</span>
    </figure>
  );
}

/** Heißer Stuhl: wer gerade die Tagesbestzeit hält, und die eigene Zeit */
function HotSeat({ leader, myBest, today, meId, members, error }: { leader: GhostRider | null; myBest: number | null; today: GameBest[]; meId: string; members: Profile[]; error: boolean }) {
  const m = leader ? members.find((x) => x.id === leader.id) : null;
  const myPlace = myBest !== null ? placeIn(today, meId, ttScore(myBest)) : null;
  const lead = leader?.me ? 'Du' : m?.display_name ?? leader?.name ?? null;
  return (
    <div className="tt-hot" aria-label="Heißer Stuhl">
      <span className="tt-hot__seat" aria-hidden="true"><Icon name="flame" size={18} /></span>
      <span className="tt-hot__main">
        <span className="tt-hot__label">Heißer Stuhl</span>
        {leader ? (
          <span className="tt-hot__who">
            <Avatar name={lead ?? '?'} color={leader.me ? 'var(--accent)' : leader.color} size={20} />
            <strong>{lead}</strong>
            <b>{fmtTime(leader.timeMs)}</b>
          </span>
        ) : <span className="tt-hot__who"><strong>{error ? 'Geister gerade nicht erreichbar' : 'Noch leer – fahr die erste Zeit des Tages'}</strong></span>}
      </span>
      <span className="tt-hot__me">
        <span className="tt-hot__label">Du heute</span>
        <strong>{myBest !== null ? fmtTime(myBest) : '–'}</strong>
        {myPlace !== null && myBest !== null ? <small>{myPlace}.{leader && !leader.me ? ` · ${fmtGap(myBest - leader.timeMs)}` : ''}</small> : <small>noch keine Zeit</small>}
      </span>
    </div>
  );
}

/** Wer heute als Geist mitfährt – mit seinem Rad */
export function GhostRow({ ghosts, members, me, loading }: { ghosts: GhostRider[]; members: Profile[]; me: Profile; loading: boolean }) {
  // beim Laden schon so hoch wie die Liste (vier Zeilen): das Startblatt springt dann nicht
  if (loading) {
    return (
      <div className="tt-ghosts" aria-busy="true" aria-label="Geister werden geladen">
        <span className="tt-ghosts__label">Auf der Strecke</span>
        <ul className="tt-ghosts__list">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} aria-hidden="true">
              <Skel w={22} h={22} r="50%" />
              <SkelText w={['38%', '30%', '34%', '28%'][i]} size={13.5} />
              <SkelText w={44} size={13} className="skel-right" />
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (!ghosts.length) return <p className="abf-muted tt-ghosts">Noch niemand auf der Strecke – du fährst allein gegen die Uhr.</p>;
  // heute zuerst (nach Zeit), dann die älteren Geister
  const sorted = [...ghosts].sort((a, b) => Number(!!a.old) - Number(!!b.old) || a.timeMs - b.timeMs);
  return (
    <div className="tt-ghosts" aria-label="Geister auf der Strecke">
      <span className="tt-ghosts__label">Auf der Strecke</span>
      <ul className="tt-ghosts__list">
        {sorted.map((g) => {
          const m = g.me ? me : members.find((x) => x.id === g.id);
          const name = g.bot ? 'Tempomacher' : g.me ? (g.old ? 'Dein letzter Lauf' : 'Dein Bestlauf') : m?.display_name ?? g.name;
          return (
            <li key={g.id} className={cx(g.old && 'is-old')} title={`${name} · ${fmtTime(g.timeMs)} · ${bikeById(g.bike).name}${g.old ? ` · ${g.old}, andere Strecke` : ''}`}>
              <Avatar name={g.bot ? 'T' : g.me ? me.display_name ?? 'Du' : name} color={g.bot ? '#9aa0a8' : g.me ? me.avatar_color : g.color} size={22} />
              <span className="tt-ghosts__name">{g.me ? 'Du' : firstName(name)}</span>
              <span className="tt-ghosts__bike"><Icon name="bike" size={12} />{bikeById(g.bike).name}</span>
              {g.old ? <span className="tt-ghosts__old">{g.old}</span> : <b>{fmtTime(g.timeMs)}</b>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ Ergebnis

function TtSummary({ bikes, result, today, season, meId, hadBest, saveFailed, onAgain, onBoard }: {
  bikes: Bikes; result: TtResult; today: GameBest[]; season: GameBest[]; meId: string; hadBest: boolean; saveFailed: boolean;
  onAgain: () => void; onBoard: () => void;
}) {
  const r = result;
  const score = ttScore(r.timeMs);
  const badge = r.dayBest ? ['trophy', 'Tagesbestzeit!', true] as const
    : r.pb && hadBest ? ['star', 'Persönliche Bestzeit', true] as const
      : r.riders > 1 ? ['clock', `${r.place}. von ${r.riders}`, false] as const
        : ['flag', 'Erste Zeit des Tages', true] as const;
  const gapText = r.gapMs === null ? 'allein gegen die Uhr' : r.gapMs <= 0 ? `${fmtGap(r.gapMs)} vor ${firstName(r.leader?.name ?? '')}` : `${fmtGap(r.gapMs)} hinter ${firstName(r.leader?.name ?? '')}`;
  // Zwischenzeiten mit Rückstand auf den Tagesbesten an der Station
  const leaderCum: (number | null)[] = [];
  let acc: number | null = 0;
  for (const s of r.sectors) { acc = acc !== null && s.leader !== null ? acc + s.leader : null; leaderCum.push(acc); }
  const myCum = [...r.splits, r.timeMs];
  const names = ['1 km', '2 km', 'Ziel'];
  const secNames = ['Tal', 'Côte', 'Abfahrt & Ziel'];
  return (
    <section className="abf-summary" aria-label="Ergebnis">
      <div className="abf-sum-top">
        <div className="abf-badges">
          <span className={cx('abf-badge', badge[2] && 'is-gold')}>
            <Icon name={badge[0]} size={14} />
            {badge[1]}
          </span>
          <NewBikePill bikes={bikes} />
        </div>
        <p className="abf-score tt-time"><strong>{fmtTime(r.timeMs)}</strong><span className="sr-only"> Minuten</span></p>
        <div className="abf-stats">
          <span><Icon name="podium" size={15} />{r.place}.&nbsp;Platz</span>
          <span><Icon name="clock" size={15} />{gapText}</span>
          <span><Icon name="zap" size={15} />Ø {r.avgKmh.toLocaleString('de-DE', { maximumFractionDigits: 1 })}&nbsp;km/h</span>
        </div>
        <p className="abf-muted">
          {r.reserve > 0.15 ? `Noch ${Math.round(r.reserve * 100)} % Vorrat im Ziel – da war mehr drin.` : r.slides > 0 ? `${r.slides}× abgerutscht – vor engen Kurven loslassen.` : r.passed.length ? `Überholt: ${r.passed.map(firstName).join(', ')}` : `Spitze ${r.topKmh} km/h – alles gegeben.`}
          {r.slides > 0 && r.reserve > 0.15 ? ` ${r.slides}× abgerutscht.` : ''}
        </p>
        <div className="abf-places">
          <span><Icon name="podium" size={15} /><b>{placeIn(today, meId, score)}.</b>&nbsp;heute</span>
          <span><Icon name="trophy" size={15} /><b>{placeIn(season, meId, score)}.</b>&nbsp;Saison</span>
        </div>
        {saveFailed ? <p className="tt-warn">Die Zeit konnte nicht gespeichert werden – Verbindung oder Datenbank prüfen.</p> : null}
      </div>
      <dl className="tt-splits" aria-label="Zwischenzeiten">
        {myCum.map((t, i) => {
          const lc = leaderCum[i];
          const d = lc !== null && lc !== undefined ? t - lc : null;
          return (
            <div key={i}>
              <dt>{names[i]}</dt>
              <dd>{fmtTime(t)}</dd>
              {d !== null ? <small className={cx(d <= 0 ? 'is-ahead' : 'is-behind')}>{fmtGap(d)}</small> : <small>–</small>}
            </div>
          );
        })}
      </dl>
      {r.sectors.some((s) => s.best !== null) ? (
        <ol className="tt-sectors" aria-label="Sektoren">
          {r.sectors.map((s, i) => {
            const g = sectorGap(s);
            const ahead = s.best !== null && s.me <= s.best;
            return (
              <li key={i}>
                <span className="tt-sectors__name">{secNames[i]}</span>
                <span className="tt-sectors__bar" aria-hidden="true"><i style={{ width: `${Math.round(Math.min(1, (s.best ?? s.me) / s.me) * 100)}%` }} className={cx(ahead && 'is-ahead')} /></span>
                <b className={cx(ahead ? 'is-ahead' : 'is-behind')}>{ahead ? 'Bestzeit' : g}</b>
                <small>{ahead ? 'im Sektor' : `auf ${s.bestName ?? ''}`}</small>
              </li>
            );
          })}
        </ol>
      ) : null}
      <ol className="spr-podium tt-podium" aria-label="Tagesbestzeiten">
        {r.podium.map((p, i) => (
          <li key={`${p.name}-${i}`} className={cx(p.me && 'is-me')}>
            <span className="spr-podium__pos">{i + 1}</span>
            <span className="spr-podium__name">{p.me ? `${p.name} (du)` : p.name}</span>
            <b>{fmtTime(p.timeMs)}</b>
          </li>
        ))}
      </ol>
      <div className="abf-actions">
        <button type="button" className="btn btn--primary btn--full" onClick={onAgain}><Icon name="refresh" size={18} /><span>Nochmal</span></button>
        <button type="button" className="btn btn--secondary abf-actions__board" onClick={onBoard} aria-label="Bestenliste"><Icon name="podium" size={20} /></button>
      </div>
    </section>
  );
}
