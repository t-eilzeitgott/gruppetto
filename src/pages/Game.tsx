import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useApp } from '../app/context';
import { useMembers } from '../app/hooks';
import { invalidate, useQuery } from '../app/query';
import { navigate } from '../app/router';
import { source } from '../app/config';
import type { GameBest } from '../data/source';
import type { Profile } from '../lib/types';
import { Abfahrt, type Friend, type GameEvent, type HudState, type RunResult, type ScoreCat } from '../game/abfahrt/engine';
import { Renderer3D } from '../game/abfahrt/render3d';
import { Track } from '../game/abfahrt/track';
import { berlinDayKey, berlinDayStart } from '../game/abfahrt/rng';
import { dailyMissions, type Mission } from '../game/abfahrt/missions';
import { Avatar, Segmented, cx, useTitle } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { GameIcon } from '../ui/GameIcon';

const LS_BEST = 'gruppetto.abfahrt.best';
const LS_TUTORIAL = 'gruppetto.abfahrt.runs';
const LS_LEARN = 'gruppetto.abfahrt.learned';
/** eigener Zähler fürs Tutorial: die neue Steuerung (ducken, bremsen) sieht jeder einmal */
const LS_COACH = 'gruppetto.abfahrt.coachRuns';

/** Tutorial der ersten Läufe: eine Geste nach der anderen, bis sie einmal geklappt hat */
type Step = 'steer' | 'tuck' | 'brake';
const STEPS: Step[] = ['steer', 'tuck', 'brake'];
const COACH: Record<Step, { t: string; s: string }> = {
  steer: { t: 'Lenken', s: 'Daumen seitlich ziehen' },
  tuck: { t: 'Ducken = schneller', s: 'Daumen nach oben schieben' },
  brake: { t: 'Bremsen', s: 'Daumen nach unten ziehen' },
};
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const missionKey = (day: string) => `gruppetto.abfahrt.missions.${day}`;

type Ui = 'ready' | 'countdown' | 'playing' | 'paused' | 'over';
type Board = 'day' | 'season';

const nf = (n: number) => Math.round(n).toLocaleString('de-DE');
const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`);

/** Ränge nach Gesamtstrecke über die Saison */
export const RANKS: [number, string][] = [[0, 'Gruppetto'], [5, 'Domestik'], [15, 'Ausreißer'], [35, 'Abfahrer'], [70, 'Kamikaze'], [120, 'Teufelsabfahrer'], [200, 'Legende']];
export function rankFor(totalKm: number) {
  let i = 0;
  while (i < RANKS.length - 1 && totalKm >= RANKS[i + 1][0]) i++;
  const next = RANKS[i + 1];
  return { name: RANKS[i][1], from: RANKS[i][0], to: next?.[0] ?? null, nextName: next?.[1] ?? null };
}

function readAccent(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff5fa2';
}

/** Minispiel „Abfahrt“: Pass-Abfahrt in 3D mit Gegnern, Windschatten und Bestenliste der Runde */
export function GamePage() {
  useTitle('Abfahrt');
  const { me } = useApp();
  const members = useMembers();
  const day = berlinDayKey();
  const since = useMemo(() => berlinDayStart().toISOString(), [day]);
  const season = useQuery<GameBest[]>('game:abfahrt:season', () => source.gameLeaderboard('abfahrt'));
  const today = useQuery<GameBest[]>(`game:abfahrt:day:${day}`, () => source.gameLeaderboard('abfahrt', since));
  const missions = useMemo(() => dailyMissions(day), [day]);
  const [doneIds, setDoneIds] = useState<string[]>(() => { try { return JSON.parse(lsGet(missionKey(day)) ?? '[]'); } catch { return []; } });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Abfahrt | null>(null);
  const rendererRef = useRef<Renderer3D | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const [glError, setGlError] = useState(false);
  const [ui, setUi] = useState<Ui>('ready');
  const [count, setCount] = useState(3);
  const [result, setResult] = useState<RunResult | null>(null);
  const [prevRank, setPrevRank] = useState<{ day: number; season: number } | null>(null);
  const [banner, setBanner] = useState<{ key: number; title: string; sub?: string; tone?: 'gold' | 'accent' } | null>(null);
  const [board, setBoard] = useState<Board>('day');
  const [showBoard, setShowBoard] = useState(false);
  const [best, setBest] = useState(() => Number(lsGet(LS_BEST)) || 0);
  const hud = useRef<Record<string, HTMLElement | null>>({});
  const last = useRef<Record<string, string>>({});
  const bind = (key: string) => (el: HTMLElement | null) => { hud.current[key] = el; };
  const uiRef = useRef<Ui>('ready');
  uiRef.current = ui;
  const [coach, setCoach] = useState<Step | null>(null);
  const coachRef = useRef<{ on: boolean; step: Step | null; t: number; hold: number; learned: Set<Step> }>({ on: false, step: null, t: 0, hold: 0, learned: new Set() });

  const names = useMemo(() => (members.data ?? []).map((m) => m.display_name ?? '').filter(Boolean), [members.data]);
  const track = useMemo(() => new Track(day, names), [day, names]);
  const mine = season.data?.find((b) => b.user_id === me.id);
  const myBest = Math.max(best, mine?.best ?? 0);

  const friends: Friend[] = useMemo(() => {
    const list: Friend[] = [];
    for (const b of season.data ?? []) {
      if (!b.best_m) continue;
      const m = members.data?.find((x) => x.id === b.user_id);
      if (b.user_id === me.id) list.push({ userId: 'me', name: 'Du', color: readAccent(), meters: b.best_m });
      else list.push({ userId: b.user_id, name: m?.display_name ?? 'Jemand', color: m?.avatar_color ?? '#888', meters: b.best_m });
    }
    return list;
  }, [season.data, members.data, me.id]);

  const makeEngine = (playing: boolean) => {
    const accent = readAccent();
    const eng = new Abfahrt({
      dayKey: day,
      names,
      friends: playing ? friends : [],
      kit: { jersey: accent, side: '#ffffff', helmet: '#ffffff', shorts: '#16171a', skin: '#f0c4a0', shoes: '#ffffff', number: '27' },
      best: myBest,
      missions,
      missionsDone: new Set(doneIds),
      tutorial: (Number(lsGet(LS_TUTORIAL)) || 0) < 4,
      onEvent: (e) => onEvent(e),
      onOver: (r) => onOver(r),
    });
    eng.setViewport(canvasRef.current?.getBoundingClientRect().width ?? 390);
    return eng;
  };

  // Ereignisse aus dem Spiel
  const bannerKey = useRef(0);
  const onEvent = (e: GameEvent) => {
    switch (e.type) {
      case 'count':
        setCount(e.n);
        break;
      case 'section':
        bannerKey.current += 1;
        setBanner({ key: bannerKey.current, title: e.name, sub: `${e.alt.toLocaleString('de-DE')} m` });
        break;
      case 'mission':
        bannerKey.current += 1;
        setBanner({ key: bannerKey.current, title: 'Aufgabe erfüllt', sub: e.text, tone: 'gold' });
        setDoneIds((d) => {
          const next = d.includes(e.id) ? d : [...d, e.id];
          lsSet(missionKey(day), JSON.stringify(next));
          return next;
        });
        break;
      case 'friend':
        bannerKey.current += 1;
        setBanner({ key: bannerKey.current, title: `${e.name} geschlagen`, sub: 'Weiter so!', tone: 'accent' });
        break;
      case 'record':
        bannerKey.current += 1;
        setBanner({ key: bannerKey.current, title: 'Neue Bestleistung', sub: 'Jeder Meter zählt jetzt extra', tone: 'gold' });
        break;
      case 'tip':
        bannerKey.current += 1;
        setBanner({ key: bannerKey.current, title: e.text });
        break;
    }
  };

  const onOver = (r: RunResult) => {
    setResult(r);
    setUi('over');
    const runs = (Number(lsGet(LS_TUTORIAL)) || 0) + 1;
    lsSet(LS_TUTORIAL, String(runs));
    lsSet(LS_COACH, String((Number(lsGet(LS_COACH)) || 0) + 1));
    if (r.score > (Number(lsGet(LS_BEST)) || 0)) { lsSet(LS_BEST, String(r.score)); setBest(r.score); }
    if (r.score > 0) {
      source.submitScore('abfahrt', r.score, r.meters).then(() => invalidate('game:abfahrt')).catch(() => undefined);
    }
  };

  // Spielschleife
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return undefined;
    let renderer: Renderer3D;
    try {
      renderer = new Renderer3D(canvas, overlay);
    } catch {
      setGlError(true);
      return undefined;
    }
    renderer.setTheme(readAccent(), document.documentElement.dataset.theme === 'dark');
    rendererRef.current = renderer;
    renderer.warm();
    engineRef.current = makeEngine(false);
    let raf = 0;
    let prev = performance.now();
    let acc = 0;
    let frames = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const eng = engineRef.current!;
      if (uiRef.current !== 'paused') eng.update(dt);
      renderer.draw(eng, uiRef.current === 'paused' ? 0 : dt);
      writeHud(eng, dt);
      // Bildrate beobachten und notfalls die Qualität senken
      acc += dt;
      frames += 1;
      if (acc > 2.5) {
        const fps = frames / acc;
        if (fps < 45 && renderer.quality > 0.55) { renderer.quality = Math.max(0.55, renderer.quality - 0.15); renderer.resize(); }
        acc = 0;
        frames = 0;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onResize = () => { renderer.resize(); engineRef.current?.setViewport(canvas.getBoundingClientRect().width); };
    const onVis = () => { if (document.hidden && uiRef.current === 'playing') setUi('paused'); };
    const onTheme = () => window.setTimeout(() => renderer.setTheme(readAccent(), document.documentElement.dataset.theme === 'dark'), 30);
    const obs = new MutationObserver(onTheme);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-tour'] });
    window.addEventListener('resize', onResize);
    // Homescreen-App auf iOS: 100vh ist dort zu kurz, darum die echte Bildschirmhöhe nehmen
    const root = canvas.parentElement as HTMLElement | null;
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    const fit = () => {
      if (!root || !standalone) return;
      const portrait = window.innerHeight >= window.innerWidth;
      const h = portrait ? Math.max(screen.height, screen.width) : Math.min(screen.height, screen.width);
      root.style.height = `${Math.max(window.innerHeight, h)}px`;
    };
    fit();
    window.addEventListener('orientationchange', fit);
    // Größe zuverlässig verfolgen (iOS meldet nicht jede Änderung als resize)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    ro?.observe(canvas);
    document.addEventListener('visibilitychange', onVis);
    (window as unknown as { __abfahrt?: unknown }).__abfahrt = { engine: () => engineRef.current, renderer };
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('orientationchange', fit);
      renderer.dispose();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      obs.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kein Zoomen, kein Scrollen, kein Zurückwischen während des Spiels
  useEffect(() => {
    const meta = document.querySelector('meta[name=viewport]');
    const before = meta?.getAttribute('content') ?? '';
    meta?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
    document.documentElement.classList.add('game-lock');
    const stop = (e: Event) => e.preventDefault();
    const touchMove = (e: TouchEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest('.abf-scroll') && e.touches.length === 1) return;
      e.preventDefault();
    };
    const touchStart = (e: TouchEvent) => { if (e.touches.length > 1) e.preventDefault(); };
    let lastTap = 0;
    const touchEnd = (e: TouchEvent) => {
      const now = Date.now();
      if (now - lastTap < 320 && !(e.target as HTMLElement | null)?.closest('button, a')) e.preventDefault();
      lastTap = now;
    };
    document.addEventListener('gesturestart', stop, { passive: false } as AddEventListenerOptions);
    document.addEventListener('gesturechange', stop, { passive: false } as AddEventListenerOptions);
    document.addEventListener('touchmove', touchMove, { passive: false });
    document.addEventListener('touchstart', touchStart, { passive: false });
    document.addEventListener('touchend', touchEnd, { passive: false });
    document.addEventListener('dblclick', stop);
    document.addEventListener('contextmenu', stop);
    window.scrollTo(0, 0);
    return () => {
      if (meta) meta.setAttribute('content', before);
      document.documentElement.classList.remove('game-lock');
      document.removeEventListener('gesturestart', stop);
      document.removeEventListener('gesturechange', stop);
      document.removeEventListener('touchmove', touchMove);
      document.removeEventListener('touchstart', touchStart);
      document.removeEventListener('touchend', touchEnd);
      document.removeEventListener('dblclick', stop);
      document.removeEventListener('contextmenu', stop);
    };
  }, []);

  // Tastatur
  useEffect(() => {
    const map: Record<string, 'left' | 'right' | 'down' | 'up'> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down', ArrowUp: 'up', a: 'left', d: 'right', s: 'down', w: 'up' };
    const down = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        if (uiRef.current === 'ready' || uiRef.current === 'over') { e.preventDefault(); start(); }
        return;
      }
      if (e.key === 'Escape' || e.key === 'p') { togglePause(); return; }
      const k = map[e.key];
      if (k) { e.preventDefault(); engineRef.current?.key(k, true); }
    };
    const up = (e: KeyboardEvent) => { const k = map[e.key]; if (k) engineRef.current?.key(k, false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  });

  /** Tutorial: nächste Geste zeigen, sobald es passt; abhaken, sobald sie einmal geklappt hat */
  const runCoach = (h: HudState, dt: number) => {
    const c = coachRef.current;
    if (!c.on || uiRef.current !== 'playing') return;
    c.t += dt;
    if (!c.step) {
      const next = STEPS.find((x) => !c.learned.has(x));
      if (!next) { c.on = false; return; }
      const ready = next === 'steer' ? c.t > 0.2 : next === 'tuck' ? c.t > 1.4 : h.curveIn < 120 || c.t > 5;
      if (ready) { c.step = next; c.t = 0; c.hold = 0; setCoach(next); }
      return;
    }
    let ok = false;
    if (c.step === 'steer') ok = h.steered > 2.2;
    else if (c.step === 'tuck') { c.hold = h.tuck > 0.7 ? c.hold + dt : 0; ok = c.hold > 0.7; }
    else { c.hold = h.wantBrake > 0.4 ? c.hold + dt : 0; ok = c.hold > 0.2; }
    if (!ok) return;
    c.learned.add(c.step);
    lsSet(LS_LEARN, JSON.stringify([...c.learned]));
    c.step = null;
    c.t = 0;
    setCoach(null);
    bannerKey.current += 1;
    setBanner({ key: bannerKey.current, title: c.learned.size === STEPS.length ? 'Perfekt – du hast es drauf' : 'Gut so!', tone: 'accent' });
  };

  const writeHud = (eng: Abfahrt, dt = 0) => {
    if (uiRef.current !== 'playing' && uiRef.current !== 'paused') return;
    const h = eng.hud();
    runCoach(h, dt);
    // Daumenring: zeigt Ankerpunkt, oben ducken, unten bremsen
    const th = hud.current.thumb;
    if (th) {
      if (h.touch && uiRef.current === 'playing') {
        th.style.opacity = '1';
        th.style.visibility = 'visible';
        th.style.transform = `translate(${h.touch.x.toFixed(0)}px, ${h.touch.y.toFixed(0)}px)`;
        th.classList.toggle('is-tuck', h.wantTuck);
        th.classList.toggle('is-brake', h.wantBrake > 0.3);
      } else { th.style.opacity = '0'; th.style.visibility = 'hidden'; }
    }
    const set = (key: string, val: string) => {
      if (last.current[key] === val) return;
      last.current[key] = val;
      const el = hud.current[key];
      if (el) el.textContent = val;
    };
    set('score', nf(h.score));
    set('kmh', String(h.kmh));
    set('dist', km(h.meters));
    set('mult', `×${h.mult}`);
    const multEl = hud.current.multWrap;
    if (multEl) {
      multEl.style.opacity = h.mult > 1 ? '1' : '0';
      multEl.style.setProperty('--left', String(h.multLeft));
    }
    const draftEl = hud.current.draft;
    if (draftEl) {
      draftEl.style.opacity = h.draft > 0.15 ? '1' : '0';
      draftEl.style.setProperty('--d', h.draft.toFixed(2));
    }
    const nextEl = hud.current.next;
    if (nextEl) {
      if (h.next) {
        set('nextName', h.next.name === 'Du' ? 'Deine Bestmarke' : h.next.name);
        set('nextDist', km(h.next.dist));
        nextEl.style.opacity = '1';
        nextEl.style.setProperty('--c', h.next.color);
      } else nextEl.style.opacity = '0';
    }
    const dot = hud.current.dot;
    if (dot) dot.style.left = `${Math.min(100, (h.meters / profileMax) * 100).toFixed(2)}%`;
  };

  const profileMax = useMemo(() => Math.max(2000, ...friends.map((f) => f.meters * 1.12)), [friends]);

  const start = () => {
    if (!canvasRef.current) return;
    // Plätze vorher merken für „↑ 2“
    const pos = (list: GameBest[] | undefined) => (list ?? []).findIndex((b) => b.user_id === me.id);
    setPrevRank({ day: pos(today.data), season: pos(season.data) });
    engineRef.current = makeEngine(true);
    engineRef.current.start();
    setResult(null);
    setShowBoard(false);
    setBanner(null);
    last.current = {};
    let learned = new Set<Step>();
    try { learned = new Set(JSON.parse(lsGet(LS_LEARN) ?? '[]') as Step[]); } catch { /* neu anfangen */ }
    coachRef.current = { on: (Number(lsGet(LS_COACH)) || 0) < 3, step: null, t: 0, hold: 0, learned };
    setCoach(null);
    setUi('countdown');
    window.setTimeout(() => {
      if (uiRef.current === 'countdown') setUi('playing');
    }, 2300);
  };

  const togglePause = () => {
    if (uiRef.current === 'playing') setUi('paused');
    else if (uiRef.current === 'paused') setUi('playing');
  };

  // Daumensteuerung
  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (ui !== 'playing' && ui !== 'countdown') return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    engineRef.current?.pointerDown(e.clientX, e.clientY);
  };
  const onPointerMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.buttons === 0) return;
    engineRef.current?.pointerMove(e.clientX, e.clientY);
  };
  const onPointerUp = () => engineRef.current?.pointerUp();

  const boardRows = board === 'day' ? today.data ?? [] : season.data ?? [];

  return (
    <div className={cx('abf', `abf--${ui}`)}>
      <canvas
        ref={canvasRef}
        className="abf__canvas"
        aria-label="Spielfeld: Daumen seitlich ziehen zum Lenken, nach oben zum Ducken, nach unten zum Bremsen"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <canvas ref={overlayRef} className="abf__overlay" aria-hidden="true" />
      {glError ? (
        <div className="abf-layer">
          <div className="abf-card abf-card--small">
            <h2 className="abf-title">3D nicht verfügbar</h2>
            <p className="abf-muted">Dein Browser kann gerade keine 3D-Grafik (WebGL) anzeigen. Probier es in Safari oder Chrome noch einmal.</p>
            <button type="button" className="btn btn--secondary btn--full" onClick={() => navigate('/')}><span>Zurück</span></button>
          </div>
        </div>
      ) : null}

      {/* HUD */}
      {ui === 'playing' || ui === 'paused' || ui === 'countdown' ? (
        <div className="abf-hud" aria-hidden={ui === 'countdown'}>
          <div className="abf-hud__top">
            <button type="button" className="abf-round" onClick={togglePause} aria-label={ui === 'paused' ? 'Weiter' : 'Pause'}>
              {ui === 'paused' ? <PlayIcon /> : <PauseIcon />}
            </button>
            <div className="abf-hud__score">
              <strong ref={bind('score')}>0</strong>
              <span className="abf-mult" ref={bind('multWrap')}>
                <span ref={bind('mult')}>×1</span>
                <i aria-hidden="true" />
              </span>
            </div>
            <div className="abf-hud__speed">
              <span><strong ref={bind('kmh')}>0</strong>&nbsp;km/h</span>
              <span className="abf-hud__dist" ref={bind('dist')}>0&nbsp;m</span>
            </div>
          </div>
          <div className="abf-strip" aria-hidden="true">
            <div className="abf-strip__line" />
            {friends.map((f) => (
              <span key={f.userId} className={cx('abf-strip__mark', f.userId === 'me' && 'is-me')} style={{ left: `${Math.min(100, (f.meters / profileMax) * 100)}%`, background: f.color }} />
            ))}
            <span className="abf-strip__dot" ref={bind('dot')} />
          </div>
          <div className="abf-next" ref={bind('next')}>
            <span className="abf-next__dot" />
            <span ref={bind('nextName')} />
            <strong ref={bind('nextDist')} />
          </div>
          <div className="abf-thumb" ref={bind('thumb')} aria-hidden="true">
            <span className="abf-thumb__up"><TuckIcon /></span>
            <span className="abf-thumb__dot" />
            <span className="abf-thumb__down"><BrakeIcon /></span>
          </div>
          <div className="abf-draft" ref={bind('draft')}>
            <span>Windschatten</span>
            <i aria-hidden="true" />
          </div>
        </div>
      ) : null}

      {banner && (ui === 'playing' || ui === 'countdown') ? (
        <div key={banner.key} className={cx('abf-banner', banner.tone && `abf-banner--${banner.tone}`)} onAnimationEnd={() => setBanner(null)}>
          <strong>{banner.title}</strong>
          {banner.sub ? <span>{banner.sub}</span> : null}
        </div>
      ) : null}

      {coach && ui === 'playing' ? (
        <div key={coach} className="abf-coach" role="status">
          <span className={cx('abf-coach__gesture', `is-${coach}`)} aria-hidden="true"><i /></span>
          <span className="abf-coach__text"><strong>{COACH[coach].t}</strong><span>{COACH[coach].s}</span></span>
        </div>
      ) : null}

      {ui === 'countdown' ? (
        <div className="abf-count" aria-live="assertive">
          <span key={count}>{count > 0 ? count : 'Los!'}</span>
        </div>
      ) : null}

      {ui === 'paused' ? (
        <div className="abf-layer">
          <div className="abf-card abf-card--small">
            <h2 className="abf-title">Pause</h2>
            <button type="button" className="btn btn--primary btn--full" onClick={() => setUi('playing')}><span>Weiterfahren</span></button>
            <button type="button" className="btn btn--secondary btn--full" onClick={() => navigate('/')}><span>Aufhören</span></button>
          </div>
        </div>
      ) : null}

      {ui === 'ready' ? (
        <div className="abf-layer">
          <button type="button" className="abf-round abf-close" onClick={() => navigate('/')} aria-label="Schließen"><Icon name="x" size={20} /></button>
          <div className="abf-card abf-scroll">
            {showBoard ? (
              <BoardView rows={boardRows} board={board} setBoard={setBoard} members={members.data ?? []} meId={me.id} onBack={() => setShowBoard(false)} />
            ) : (
              <>
                <div className="abf-head">
                  <GameIcon size={48} />
                  <div>
                    <h1 className="abf-title">Abfahrt</h1>
                    <p className="abf-sub">Tagesstrecke · {track.title}</p>
                  </div>
                </div>
                <DescentProfile track={track} friends={friends} members={members.data ?? []} max={profileMax} />
                <Missions missions={missions} done={doneIds} />
                <ul className="abf-controls" aria-label="Steuerung">
                  <li><ThumbIcon /><span>Lenken</span></li>
                  <li><TuckIcon /><span>Ducken</span></li>
                  <li><BrakeIcon /><span>Bremsen</span></li>
                </ul>
                <button type="button" className="btn btn--primary btn--full abf-go" onClick={start}><span>Losfahren</span></button>
                <MiniBoard rows={today.data?.length ? today.data : season.data ?? []} label={today.data?.length ? 'Heute' : 'Saison'} members={members.data ?? []} meId={me.id} onOpen={() => setShowBoard(true)} best={myBest} totalM={mine?.total_m ?? 0} />
              </>
            )}
          </div>
        </div>
      ) : null}

      {ui === 'over' && result ? (
        <div className="abf-layer">
          <button type="button" className="abf-round abf-close" onClick={() => navigate('/')} aria-label="Schließen"><Icon name="x" size={20} /></button>
          <div className="abf-card abf-scroll">
            {showBoard ? (
              <BoardView rows={boardRows} board={board} setBoard={setBoard} members={members.data ?? []} meId={me.id} onBack={() => setShowBoard(false)} />
            ) : (
              <Summary
                result={result}
                record={result.score >= myBest && result.score > 0}
                prevRank={prevRank}
                today={today.data ?? []}
                season={season.data ?? []}
                meId={me.id}
                totalM={(mine?.total_m ?? 0)}
                missions={missions}
                done={doneIds}
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

// ------------------------------------------------------------------ Bausteine

function Missions({ missions, done }: { missions: Mission[]; done: string[] }) {
  return (
    <section className="abf-missions" aria-label="Aufgaben heute">
      <h2 className="abf-eyebrow">Aufgaben heute</h2>
      <ul>
        {missions.map((m) => {
          const ok = done.includes(m.id);
          return (
            <li key={m.id} className={cx(ok && 'is-done')}>
              <span className="abf-check" aria-hidden="true">{ok ? <Icon name="check" size={14} /> : null}</span>
              <span>{m.text}</span>
              {ok ? null : <span className="abf-missions__pts">+300</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Höhenprofil der Tagesstrecke mit den Bestmarken der Runde */
function DescentProfile({ track, friends, members, max }: { track: Track; friends: Friend[]; members: Profile[]; max: number }) {
  const W = 300;
  const H = 74;
  const pts = useMemo(() => {
    const n = 48;
    const ys: number[] = [];
    for (let i = 0; i <= n; i++) ys.push(track.heightAt((i / n) * max));
    const top = Math.max(...ys);
    const low = Math.min(...ys);
    return ys.map((y, i) => [(i / n) * W, 8 + ((top - y) / Math.max(1, top - low)) * (H - 22)] as [number, number]);
  }, [track, max]);
  const yAt = (m: number) => {
    const t = Math.max(0, Math.min(1, m / max)) * (pts.length - 1);
    const i = Math.floor(t);
    const a = pts[i];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    return a[1] + (b[1] - a[1]) * (t - i);
  };
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const sorted = [...friends].sort((a, b) => b.meters - a.meters);
  return (
    <figure className="abf-profile" aria-label="Höhenprofil der Tagesstrecke mit den Bestmarken">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={`${line} L${W},${H} L0,${H} Z`} className="abf-profile__area" />
        <path d={line} className="abf-profile__line" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="abf-profile__marks">
        {sorted.map((f) => {
          const m = members.find((x) => x.id === f.userId);
          return (
            <span
              key={f.userId}
              className={cx('abf-pin', f.userId === 'me' && 'is-me')}
              style={{ left: `${(Math.min(1, f.meters / max) * 100).toFixed(1)}%`, top: `${((yAt(f.meters) / H) * 100).toFixed(1)}%` }}
              title={`${f.name}: ${km(f.meters)}`}
            >
              <Avatar name={f.userId === 'me' ? 'Du' : m?.display_name ?? f.name} color={f.color} size={20} />
            </span>
          );
        })}
      </div>
      <figcaption className="abf-profile__cap">
        <span>Start</span>
        <span>{friends.length ? 'Bestmarken der Runde' : 'Noch keine Bestmarken'}</span>
        <span>{km(max)}</span>
      </figcaption>
    </figure>
  );
}

function MiniBoard({ rows, label, members, meId, onOpen, best, totalM }: {
  rows: GameBest[]; label: string; members: Profile[]; meId: string; onOpen: () => void; best: number; totalM: number;
}) {
  const top = rows.slice(0, 3);
  const myIdx = rows.findIndex((r) => r.user_id === meId);
  const rank = rankFor(totalM / 1000);
  return (
    <section className="abf-mini" aria-label="Bestenliste">
      <div className="abf-row">
        <h2 className="abf-eyebrow">Bestenliste · {label}</h2>
        <button type="button" className="abf-link" onClick={onOpen}>Alle<Icon name="chevron" size={14} /></button>
      </div>
      {top.length ? (
        <ol className="abf-podium">
          {top.map((r, i) => {
            const m = members.find((x) => x.id === r.user_id);
            return (
              <li key={r.user_id} className={cx(`is-${i + 1}`, r.user_id === meId && 'is-me')}>
                <Avatar name={m?.display_name} color={m?.avatar_color ?? '#888'} size={i === 0 ? 34 : 28} ring={i === 0 ? 'accent' : undefined} />
                <span className="abf-podium__name">{m?.display_name ?? '–'}</span>
                <strong>{nf(r.best)}</strong>
                <span className="abf-podium__step">{i + 1}</span>
              </li>
            );
          })}
        </ol>
      ) : <p className="abf-muted">Noch keine Läufe – fahr die erste Bestmarke!</p>}
      <div className="abf-me">
        <span>{myIdx >= 0 ? `Du: Platz\u00a0${myIdx + 1}` : label === 'Heute' ? 'Heute noch kein Lauf' : 'Noch kein Lauf'}</span>
        <span>Bestleistung {nf(best)}</span>
      </div>
      <RankBar totalM={totalM} name={rank.name} />
    </section>
  );
}

function RankBar({ totalM, name, gained = 0 }: { totalM: number; name: string; gained?: number }) {
  const r = rankFor(totalM / 1000);
  const t = r.to ? Math.min(1, (totalM / 1000 - r.from) / (r.to - r.from)) : 1;
  return (
    <div className="abf-rank">
      <div className="abf-row">
        <span className="abf-rank__name"><strong>{name}</strong>{r.nextName ? <span className="abf-muted"> → {r.nextName}</span> : null}</span>
        <span className="abf-muted">{r.to ? `${(totalM / 1000).toFixed(1).replace('.', ',')}/${r.to}\u00a0km` : km(totalM)}</span>
      </div>
      <div className="abf-rank__bar"><i style={{ width: `${(t * 100).toFixed(1)}%` }} />{gained > 0 ? <b style={{ width: `${Math.min(100, t * 100).toFixed(1)}%` }} /> : null}</div>
    </div>
  );
}

function BoardView({ rows, board, setBoard, members, meId, onBack }: {
  rows: GameBest[]; board: Board; setBoard: (b: Board) => void; members: Profile[]; meId: string; onBack: () => void;
}) {
  return (
    <section className="abf-board" aria-label="Bestenliste">
      <div className="abf-row">
        <button type="button" className="abf-link" onClick={onBack}><Icon name="back" size={16} />Zurück</button>
        <h2 className="abf-eyebrow">Bestenliste</h2>
      </div>
      <Segmented<Board> label="Zeitraum" value={board} onChange={setBoard} options={[{ value: 'day', label: 'Heute' }, { value: 'season', label: 'Saison' }]} />
      {rows.length === 0 ? <p className="abf-muted">{board === 'day' ? 'Heute ist noch niemand gefahren.' : 'Noch keine Läufe.'}</p> : (
        <ol className="list abf-list">
          {rows.slice(0, 30).map((r, i) => {
            const m = members.find((x) => x.id === r.user_id);
            const rank = rankFor(r.total_m / 1000);
            return (
              <li key={r.user_id} className={cx('person-row', r.user_id === meId && 'is-me')}>
                <span className="rank">{i + 1}</span>
                <Avatar name={m?.display_name ?? '?'} color={m?.avatar_color ?? '#888'} size={30} />
                <span className="person-row__main">
                  <span className="person-row__name">{m?.display_name ?? 'Ehemaliges Mitglied'}{r.user_id === meId ? ' (du)' : ''}</span>
                  <span className="person-row__sub">{km(r.best_m)} weit · {rank.name}</span>
                </span>
                <span className="points">{nf(r.best)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** kurze Namen für die Kacheln im Ergebnis */
const PART_SHORT: Record<ScoreCat, string> = {
  dist: 'Strecke', overtake: 'Überholt', bidons: 'Flaschen', draft: 'Windschatten', curves: 'Kurven',
  near: 'Knapp', air: 'Sprünge', bonus: 'Sprints', friends: 'Freunde', missions: 'Aufgaben',
};
const ORDER: ScoreCat[] = ['dist', 'overtake', 'bidons', 'draft', 'curves', 'near', 'air', 'bonus', 'friends', 'missions'];

function Summary({ result, record, prevRank, today, season, meId, totalM, missions, done, onAgain, onBoard }: {
  result: RunResult; record: boolean; prevRank: { day: number; season: number } | null; today: GameBest[]; season: GameBest[];
  meId: string; totalM: number; missions: Mission[]; done: string[]; onAgain: () => void; onBoard: () => void;
}) {
  const shown = useCountUp(result.score);
  // vorläufiger Platz: eigener Lauf gegen die Bestwerte der anderen
  const placeIn = (list: GameBest[]) => {
    const others = list.filter((b) => b.user_id !== meId).map((b) => b.best);
    const mineBest = Math.max(result.score, list.find((b) => b.user_id === meId)?.best ?? 0);
    return others.filter((s) => s > mineBest).length + 1;
  };
  const dayPlace = placeIn(today);
  const seasonPlace = placeIn(season);
  const delta = (before: number, now: number) => (before >= 0 && now < before + 1 ? before + 1 - now : 0);
  const up = prevRank ? delta(prevRank.season, seasonPlace) : 0;
  const parts = ORDER.filter((k) => result.parts[k] > 0);
  const newTotal = totalM + result.meters;
  const rankNow = rankFor(newTotal / 1000);
  const rankBefore = rankFor(totalM / 1000);
  const beaten = result.friendsBeaten.filter((n) => n !== 'Du');
  return (
    <section className="abf-summary" aria-label="Ergebnis">
      <div className="abf-sum-top">
        <span className={cx('abf-badge', record && 'is-gold')}>
          <Icon name={record ? 'trophy' : 'flame'} size={14} />
          {record ? 'Bestleistung' : result.reason || 'Ende'}
        </span>
        <p className="abf-score"><strong>{nf(shown)}</strong><span className="sr-only"> Punkte</span></p>
        <div className="abf-stats">
          <span><Icon name="flag" size={15} />{km(result.meters)}</span>
          <span><Icon name="zap" size={15} />{result.topKmh}&nbsp;km/h</span>
          <span><b>×{result.stats.combo}</b>&nbsp;Kombo</span>
        </div>
        <div className="abf-places">
          <span><Icon name="podium" size={15} /><b>{dayPlace}.</b>&nbsp;heute</span>
          <span><Icon name="trophy" size={15} /><b>{seasonPlace}.</b>&nbsp;Saison{up > 0 ? <em className="pos">&nbsp;↑{up}</em> : null}</span>
        </div>
      </div>
      <dl className="abf-parts">
        {parts.map((k) => (
          <div key={k}>
            <dt>{PART_SHORT[k]}</dt>
            <dd>{nf(result.parts[k])}</dd>
          </div>
        ))}
      </dl>
      {result.friendsBeaten.length ? <p className="abf-note"><Icon name="users" size={15} />{beaten.length ? beaten.join(', ') : 'Eigene Bestmarke'} geschlagen</p> : null}
      <Missions missions={missions} done={done} />
      {rankNow.name !== rankBefore.name ? <p className="abf-levelup">Aufgestiegen: {rankNow.name}</p> : null}
      <RankBar totalM={newTotal} name={rankNow.name} gained={result.meters} />
      <div className="abf-actions">
        <button type="button" className="btn btn--primary btn--full" onClick={onAgain}><Icon name="refresh" size={18} /><span>Nochmal</span></button>
        <button type="button" className="btn btn--secondary abf-actions__board" onClick={onBoard} aria-label="Bestenliste"><Icon name="podium" size={20} /></button>
      </div>
    </section>
  );
}

function useCountUp(target: number) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const dur = Math.min(1600, 500 + target / 20);
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      setV(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

// ------------------------------------------------------------------ Symbole

function PauseIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" /></svg>;
}
function PlayIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor" /></svg>;
}
function ThumbIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3" /></svg>;
}
function TuckIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V5M8 9l4-4 4 4" /></svg>;
}
function BrakeIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v15M8 15l4 4 4-4" /></svg>;
}
