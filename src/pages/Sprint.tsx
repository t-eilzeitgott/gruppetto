import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useApp } from '../app/context';
import { useMembers, useTourData } from '../app/hooks';
import { invalidate, useQuery } from '../app/query';
import { navigate } from '../app/router';
import { source } from '../app/config';
import type { GameBest } from '../data/source';
import type { Profile } from '../lib/types';
import { SprintRace, TYPE_STATS, typeBars, type SprintEvent, type SprintHud, type SprintResult } from '../game/abfahrt/sprint';
import { riderOptions, rivalNames, stageOfDay, type RiderOption } from '../game/abfahrt/sprintRiders';
import { Renderer3D } from '../game/abfahrt/render3d';
import { SPRINT_FINISH, Track } from '../game/abfahrt/track';
import { berlinDayKey, berlinDayStart } from '../game/abfahrt/rng';
import { Avatar, Segmented, cx, useTitle } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { SprintIcon } from '../ui/GameIcon';
import { BrakeIcon, PauseIcon, PlayIcon, TuckIcon, readAccent, useCountUp } from './Game';

const LS_RIDER = 'gruppetto.sprint.rider';
const LS_RUNS = 'gruppetto.sprint.runs';
const LS_BEST = 'gruppetto.sprint.best';
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };

type Ui = 'ready' | 'countdown' | 'playing' | 'paused' | 'over';
type Board = 'day' | 'season';
type Coach = 'steer' | 'go';
const COACH: Record<Coach, { t: string; s: string; g: string }> = {
  steer: { t: 'Hinterrad wechseln', s: 'Daumen seitlich ziehen – im Windschatten sparst du Kraft', g: 'is-steer' },
  go: { t: 'Antreten!', s: 'Daumen nach oben schieben und halten', g: 'is-tuck' },
};

const nf = (n: number) => Math.round(n).toLocaleString('de-DE');
const dist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`);

/** Minispiel „Sprintfinale“: die letzten 2,4 km im Feld – Windschatten, Position, Antritt */
export function SprintPage() {
  useTitle('Sprintfinale');
  const { me, tour } = useApp();
  const members = useMembers();
  const tourData = useTourData(tour);
  const day = berlinDayKey();
  const since = useMemo(() => berlinDayStart().toISOString(), [day]);
  const season = useQuery<GameBest[]>('game:sprint:season', () => source.gameLeaderboard('sprint'));
  const today = useQuery<GameBest[]>(`game:sprint:day:${day}`, () => source.gameLeaderboard('sprint', since));

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SprintRace | null>(null);
  const [glError, setGlError] = useState(false);
  const [ui, setUi] = useState<Ui>('ready');
  const uiRef = useRef<Ui>('ready');
  uiRef.current = ui;
  const [count, setCount] = useState(3);
  const [result, setResult] = useState<SprintResult | null>(null);
  const [banner, setBanner] = useState<{ key: number; title: string; sub?: string; tone?: 'gold' | 'accent' | 'red' } | null>(null);
  const [board, setBoard] = useState<Board>('day');
  const [showBoard, setShowBoard] = useState(false);
  const [coach, setCoach] = useState<Coach | null>(null);
  const coachRef = useRef<{ on: boolean; t: number; shown: Set<Coach>; cur: Coach | null }>({ on: false, t: 0, shown: new Set(), cur: null });
  const [best, setBest] = useState(() => Number(lsGet(LS_BEST)) || 0);
  const hud = useRef<Record<string, HTMLElement | null>>({});
  const last = useRef<Record<string, string>>({});
  const bind = (key: string) => (el: HTMLElement | null) => { hud.current[key] = el; };

  const names = useMemo(() => (members.data ?? []).map((m) => m.display_name ?? '').filter(Boolean), [members.data]);
  const options = useMemo(() => riderOptions(tourData.data, me, day), [tourData.data, me, day]);
  const [pickId, setPickId] = useState<string | null>(() => lsGet(LS_RIDER));
  const keyOf = (o: RiderOption) => `${o.id ?? 'x'}:${o.type}`;
  const chosen = options.find((o) => keyOf(o) === pickId) ?? options[0];
  const stage = useMemo(() => (tourData.data ? stageOfDay(tourData.data.stages, day) : null), [tourData.data, day]);
  const town = stage && (stage.kind === 'flat' || stage.kind === 'hilly') ? stage.arrival ?? '' : '';
  const track = useMemo(() => new Track(day, names, 'sprint', town), [day, names, town]);
  const mine = season.data?.find((b) => b.user_id === me.id);
  const myBest = Math.max(best, mine?.best ?? 0);

  const makeEngine = () => {
    const accent = readAccent();
    const eng = new SprintRace({
      dayKey: day,
      names,
      rider: chosen,
      rivals: rivalNames(tourData.data, chosen.id),
      kit: { jersey: accent, side: '#ffffff', helmet: '#ffffff', shorts: '#16171a', skin: '#f0c4a0', shoes: '#ffffff', number: chosen.number },
      town,
      onEvent: (e) => onEvent(e),
      onOver: (r) => onOver(r),
    });
    eng.setViewport(canvasRef.current?.getBoundingClientRect().width ?? 390);
    return eng;
  };

  const bannerKey = useRef(0);
  const onEvent = (e: SprintEvent) => {
    if (e.type === 'count') { setCount(e.n); return; }
    bannerKey.current += 1;
    setBanner({ key: bannerKey.current, title: e.title, sub: e.sub, tone: e.tone });
  };

  const onOver = (r: SprintResult) => {
    setResult(r);
    setUi('over');
    setCoach(null);
    lsSet(LS_RUNS, String((Number(lsGet(LS_RUNS)) || 0) + 1));
    if (r.score > (Number(lsGet(LS_BEST)) || 0)) { lsSet(LS_BEST, String(r.score)); setBest(r.score); }
    if (r.score > 0) source.submitScore('sprint', r.score, SPRINT_FINISH).then(() => invalidate('game:sprint')).catch(() => undefined);
  };

  // Spielschleife (Szene wird mit dem gewählten Fahrer neu aufgebaut, sobald sich die Daten ändern)
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return undefined;
    const g = window as unknown as { __abfahrt?: unknown };
    if (/[?&]nogl\b/.test(window.location.search)) {
      engineRef.current = makeEngine();
      let raf = 0;
      let prev = performance.now();
      const tick = (now: number) => {
        const dt = Math.min(0.05, (now - prev) / 1000);
        prev = now;
        if (uiRef.current !== 'paused') engineRef.current!.update(dt);
        writeHud(engineRef.current!, dt);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      g.__abfahrt = { engine: () => engineRef.current, renderer: null };
      return () => cancelAnimationFrame(raf);
    }
    let renderer: Renderer3D;
    try {
      renderer = new Renderer3D(canvas, overlay);
    } catch {
      setGlError(true);
      return undefined;
    }
    renderer.setTheme(readAccent(), document.documentElement.dataset.theme === 'dark');
    const low = /[?&]lowgfx\b/.test(window.location.search);
    if (low) { renderer.quality = 0.25; renderer.resize(); }
    renderer.warm();
    engineRef.current = makeEngine();
    let raf = 0;
    let prev = performance.now();
    let acc = 0;
    let frames = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const eng = engineRef.current!;
      if (uiRef.current !== 'paused') eng.update(dt);
      if (!low || frames % 30 === 0) renderer.draw(eng, uiRef.current === 'paused' ? 0 : dt);
      writeHud(eng, dt);
      acc += dt;
      frames += 1;
      if (acc > 2.5) {
        const fps = frames / acc;
        if (!low && fps < 48 && renderer.quality > 0.45) { renderer.quality = Math.max(0.45, renderer.quality - 0.15); renderer.resize(); }
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
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    ro?.observe(canvas);
    document.addEventListener('visibilitychange', onVis);
    g.__abfahrt = { engine: () => engineRef.current, renderer };
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

  // Vorschau im Startbildschirm: Feld des Tages mit dem gewählten Fahrer (sobald Namen/Zielort da sind)
  useEffect(() => {
    if (uiRef.current === 'ready' && engineRef.current) engineRef.current = makeEngine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names, town, chosen.name, chosen.type]);

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

  // Tastatur: Pfeile links/rechts wechseln das Hinterrad, hoch = antreten, runter = Tempo raus
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

  /** Tutorial der ersten Sprints: Hinterrad wechseln am Anfang, Antreten im Finale */
  const runCoach = (h: SprintHud, dt: number) => {
    const c = coachRef.current;
    if (!c.on || uiRef.current !== 'playing') return;
    c.t += dt;
    const show = (k: Coach | null) => { c.cur = k; c.t = 0; setCoach(k); };
    if (!c.shown.has('steer') && c.t > 1) { c.shown.add('steer'); show('steer'); return; }
    if (c.cur === 'steer' && c.t > 5) show(null);
    if (!c.shown.has('go') && h.toGo < 330 && h.toGo > 0) { c.shown.add('go'); show('go'); return; }
    if (c.cur === 'go' && (h.mode === 'go' || h.toGo <= 0 || c.t > 6)) { c.on = false; show(null); }
  };

  const writeHud = (eng: SprintRace, dt = 0) => {
    if (uiRef.current !== 'playing' && uiRef.current !== 'paused') return;
    const h = eng.hud();
    runCoach(h, dt);
    const th = hud.current.thumb;
    if (th) {
      if (h.touch && uiRef.current === 'playing') {
        th.style.opacity = '1';
        th.style.visibility = 'visible';
        th.style.transform = `translate(${h.touch.x.toFixed(0)}px, ${h.touch.y.toFixed(0)}px)`;
        th.classList.toggle('is-tuck', h.mode === 'go');
        th.classList.toggle('is-brake', h.mode === 'ease');
      } else { th.style.opacity = '0'; th.style.visibility = 'hidden'; }
    }
    const set = (key: string, val: string) => {
      if (last.current[key] === val) return;
      last.current[key] = val;
      const el = hud.current[key];
      if (el) el.textContent = val;
    };
    set('place', `${h.place}.`);
    set('riders', `von ${h.riders}`);
    set('kmh', String(h.kmh));
    set('toGo', h.toGo > 0 ? `noch ${dist(h.toGo)}` : 'Ziel');
    const en = hud.current.energy;
    if (en) {
      en.style.setProperty('--e', h.energy.toFixed(3));
      en.classList.toggle('is-go', h.mode === 'go');
      en.classList.toggle('is-low', h.energy < 0.18);
    }
    set('energyLabel', h.mode === 'go' ? 'Antritt' : h.mode === 'ease' ? 'Erholen' : 'Kraft');
    const draftEl = hud.current.draft;
    if (draftEl) {
      draftEl.style.opacity = h.draft > 0.15 ? '1' : '0';
      draftEl.style.setProperty('--d', h.draft.toFixed(2));
    }
    const wheel = hud.current.wheel;
    if (wheel) {
      if (h.ahead && h.toGo > 0) { set('wheelName', h.ahead); wheel.style.opacity = '1'; } else wheel.style.opacity = '0';
    }
    const dot = hud.current.dot;
    if (dot) dot.style.left = `${Math.min(100, (1 - h.toGo / SPRINT_FINISH) * 100).toFixed(2)}%`;
  };

  const start = () => {
    if (!canvasRef.current) return;
    engineRef.current = makeEngine();
    engineRef.current.start();
    setResult(null);
    setShowBoard(false);
    setBanner(null);
    last.current = {};
    coachRef.current = { on: (Number(lsGet(LS_RUNS)) || 0) < 3, t: 0, shown: new Set(), cur: null };
    setCoach(null);
    setUi('countdown');
    window.setTimeout(() => { if (uiRef.current === 'countdown') setUi('playing'); }, 2300);
  };

  const togglePause = () => {
    if (uiRef.current === 'playing') setUi('paused');
    else if (uiRef.current === 'paused') setUi('playing');
  };

  const choose = (o: RiderOption) => {
    setPickId(keyOf(o));
    lsSet(LS_RIDER, keyOf(o));
  };

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
  const flammePct = ((SPRINT_FINISH - 1000) / SPRINT_FINISH) * 100;

  return (
    <div className={cx('abf', 'abf--sprint', `abf--${ui}`)}>
      <canvas
        ref={canvasRef}
        className="abf__canvas"
        aria-label="Spielfeld: Daumen seitlich ziehen wechselt das Hinterrad, nach oben antreten, nach unten Tempo rausnehmen"
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

      {ui === 'playing' || ui === 'paused' || ui === 'countdown' ? (
        <div className="abf-hud" aria-hidden={ui === 'countdown'}>
          <div className="abf-hud__top">
            <button type="button" className="abf-round" onClick={togglePause} aria-label={ui === 'paused' ? 'Weiter' : 'Pause'}>
              {ui === 'paused' ? <PlayIcon /> : <PauseIcon />}
            </button>
            <div className="spr-place">
              <strong ref={bind('place')}>–</strong>
              <span ref={bind('riders')} />
            </div>
            <div className="abf-hud__speed">
              <span><strong ref={bind('kmh')}>0</strong>&nbsp;km/h</span>
              <span className="abf-hud__dist" ref={bind('toGo')} />
            </div>
          </div>
          <div className="abf-strip spr-strip" aria-hidden="true">
            <div className="abf-strip__line" />
            <span className="spr-strip__flamme" style={{ left: `${flammePct}%` }} />
            <span className="spr-strip__finish" />
            <span className="abf-strip__dot" ref={bind('dot')} />
          </div>
          <div className="spr-energy" ref={bind('energy')}>
            <span ref={bind('energyLabel')}>Kraft</span>
            <i aria-hidden="true" />
          </div>
          <div className="abf-next spr-wheel" ref={bind('wheel')}>
            <Icon name="users" size={14} />
            <span ref={bind('wheelName')} />
          </div>
          <div className="abf-draft spr-draft" ref={bind('draft')}>
            <span>Windschatten</span>
            <i aria-hidden="true" />
          </div>
          <div className="abf-thumb" ref={bind('thumb')} aria-hidden="true">
            <span className="abf-thumb__up"><TuckIcon /></span>
            <span className="abf-thumb__dot" />
            <span className="abf-thumb__down"><BrakeIcon /></span>
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
        <div key={coach} className="abf-coach spr-coach" role="status">
          <span className={cx('abf-coach__gesture', COACH[coach].g)} aria-hidden="true"><i /></span>
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
              <SprintBoard rows={boardRows} board={board} setBoard={setBoard} members={members.data ?? []} meId={me.id} onBack={() => setShowBoard(false)} />
            ) : (
              <>
                <div className="abf-head">
                  <SprintIcon size={44} />
                  <div>
                    <h1 className="abf-title">Sprintfinale</h1>
                    <p className="abf-sub">{stage && town ? `${stage.number}. Etappe · ` : ''}{track.title.replace('Sprintfinale in ', 'Ziel in ')} · 2,4 km</p>
                  </div>
                </div>
                <RiderPicker options={options} chosen={chosen} onChoose={choose} />
                <ul className="spr-howto" aria-label="Steuerung">
                  <li><span className="spr-howto__k">↔</span>Hinterrad wechseln: im Windschatten sparst du Kraft</li>
                  <li><span className="spr-howto__k">↑</span>Antreten – am besten 200–300 m vor dem Ziel</li>
                  <li><span className="spr-howto__k">↓</span>Tempo raus und erholen</li>
                </ul>
                <button type="button" className="btn btn--primary btn--full abf-go" onClick={start}><span>Losfahren</span></button>
                <SprintMini rows={today.data?.length ? today.data : season.data ?? []} label={today.data?.length ? 'Heute' : 'Saison'} members={members.data ?? []} meId={me.id} onOpen={() => setShowBoard(true)} />
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
              <SprintBoard rows={boardRows} board={board} setBoard={setBoard} members={members.data ?? []} meId={me.id} onBack={() => setShowBoard(false)} />
            ) : (
              <SprintSummary
                result={result}
                rider={chosen}
                record={result.score >= myBest && result.score > 0}
                today={today.data ?? []}
                season={season.data ?? []}
                meId={me.id}
                onAgain={start}
                onRider={() => { setResult(null); setUi('ready'); }}
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

function Bars({ type }: { type: RiderOption['type'] }) {
  const b = typeBars(type);
  const rows: [string, number][] = [['Endspeed', b.top], ['Antritt', b.acc], ['Ausdauer', b.end]];
  return (
    <span className="spr-bars" aria-hidden="true">
      {rows.map(([label, v]) => (
        <span key={label} className="spr-bars__row">
          <span>{label}</span>
          <i><b style={{ width: `${Math.round(12 + Math.max(0, Math.min(1, v)) * 88)}%` }} /></i>
        </span>
      ))}
    </span>
  );
}

function RiderPicker({ options, chosen, onChoose }: { options: RiderOption[]; chosen: RiderOption; onChoose: (o: RiderOption) => void }) {
  return (
    <section className="spr-pick" aria-label="Fahrer auswählen">
      <h2 className="abf-eyebrow">Dein Fahrer</h2>
      <div className="spr-pick__list" role="radiogroup" aria-label="Fahrer">
        {options.map((o) => {
          const on = o === chosen;
          const s = TYPE_STATS[o.type];
          return (
            <button
              key={`${o.id ?? 'x'}:${o.type}`}
              type="button"
              role="radio"
              aria-checked={on}
              className={cx('spr-rider', on && 'is-on')}
              onClick={() => onChoose(o)}
            >
              <span className="spr-rider__main">
                <span className="spr-rider__name">{o.id === null ? s.label : o.name}</span>
                <span className="spr-rider__sub">
                  <span className="spr-chip">{s.label}</span>
                  {o.tip ? <span className="spr-chip spr-chip--tip">Dein Tipp</span> : null}
                  {s.bonus > 1 ? <span className="spr-rider__bonus">Punkte ×{s.bonus.toFixed(2).replace(/0$/, '').replace('.', ',')}</span> : null}
                </span>
                {o.why ? <span className="spr-rider__why">{o.why}</span> : null}
              </span>
              <Bars type={o.type} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SprintMini({ rows, label, members, meId, onOpen }: { rows: GameBest[]; label: string; members: Profile[]; meId: string; onOpen: () => void }) {
  const myIdx = rows.findIndex((r) => r.user_id === meId);
  const shown = rows.slice(0, 3).map((r, i) => ({ r, i }));
  if (myIdx >= 3) shown.push({ r: rows[myIdx], i: myIdx });
  return (
    <section className="abf-mini" aria-label="Bestenliste">
      <div className="abf-row">
        <h2 className="abf-eyebrow">Bestenliste · {label}</h2>
        <button type="button" className="abf-link" onClick={onOpen}>Alle<Icon name="chevron" size={14} /></button>
      </div>
      {shown.length ? (
        <ol className="abf-top">
          {shown.map(({ r, i }) => {
            const m = members.find((x) => x.id === r.user_id);
            return (
              <li key={r.user_id} className={cx(r.user_id === meId && 'is-me')}>
                <span className="abf-top__rank">{i + 1}</span>
                <Avatar name={m?.display_name ?? '?'} color={m?.avatar_color ?? '#888'} size={24} />
                <span className="abf-top__name">{r.user_id === meId ? 'Du' : m?.display_name ?? 'Jemand'}</span>
                <strong>{nf(r.best)}</strong>
              </li>
            );
          })}
        </ol>
      ) : <p className="abf-muted">Noch keine Sprints – hol dir den ersten Tagessieg!</p>}
    </section>
  );
}

function SprintBoard({ rows, board, setBoard, members, meId, onBack }: {
  rows: GameBest[]; board: Board; setBoard: (b: Board) => void; members: Profile[]; meId: string; onBack: () => void;
}) {
  return (
    <section className="abf-board" aria-label="Bestenliste">
      <div className="abf-row">
        <button type="button" className="abf-link" onClick={onBack}><Icon name="back" size={16} />Zurück</button>
        <h2 className="abf-eyebrow">Bestenliste Sprint</h2>
      </div>
      <Segmented<Board> label="Zeitraum" value={board} onChange={setBoard} options={[{ value: 'day', label: 'Heute' }, { value: 'season', label: 'Saison' }]} />
      {rows.length === 0 ? <p className="abf-muted">{board === 'day' ? 'Heute ist noch niemand gesprintet.' : 'Noch keine Sprints.'}</p> : (
        <ol className="list abf-list">
          {rows.slice(0, 30).map((r, i) => {
            const m = members.find((x) => x.id === r.user_id);
            return (
              <li key={r.user_id} className={cx('person-row', r.user_id === meId && 'is-me')}>
                <span className="rank">{i + 1}</span>
                <Avatar name={m?.display_name ?? '?'} color={m?.avatar_color ?? '#888'} size={30} />
                <span className="person-row__main">
                  <span className="person-row__name">{m?.display_name ?? 'Ehemaliges Mitglied'}{r.user_id === meId ? ' (du)' : ''}</span>
                  <span className="person-row__sub">{r.runs === 1 ? '1 Sprint' : `${r.runs} Sprints`}</span>
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

function SprintSummary({ result, rider, record, today, season, meId, onAgain, onRider, onBoard }: {
  result: SprintResult; rider: RiderOption; record: boolean; today: GameBest[]; season: GameBest[]; meId: string;
  onAgain: () => void; onRider: () => void; onBoard: () => void;
}) {
  const shown = useCountUp(result.score);
  const placeIn = (list: GameBest[]) => {
    const others = list.filter((b) => b.user_id !== meId).map((b) => b.best);
    const mineBest = Math.max(result.score, list.find((b) => b.user_id === meId)?.best ?? 0);
    return others.filter((s) => s > mineBest).length + 1;
  };
  const win = result.place === 1;
  const parts: [string, number][] = [
    [`${result.place}. Platz`, result.parts.place],
    ['Windschatten', result.parts.draft],
    ['Plätze gutgemacht', result.parts.gain],
    [`${TYPE_STATS[rider.type].label}-Bonus`, result.parts.type],
  ];
  return (
    <section className="abf-summary" aria-label="Ergebnis">
      <div className="abf-sum-top">
        <span className={cx('abf-badge', (win || record) && 'is-gold')}>
          <Icon name={win ? 'trophy' : record ? 'star' : 'flag'} size={14} />
          {win ? 'Etappensieg!' : record ? 'Bestleistung' : `${result.place}. von ${result.riders}`}
        </span>
        <p className="abf-score"><strong>{nf(shown)}</strong><span className="sr-only"> Punkte</span></p>
        <div className="abf-stats">
          <span><Icon name="podium" size={15} />{result.place}.&nbsp;Platz</span>
          <span><Icon name="clock" size={15} />{win ? 'Sieger' : result.gap < 0.05 ? 'gleiche Zeit' : `+${result.gap.toFixed(2).replace('.', ',')} s`}</span>
          <span><Icon name="zap" size={15} />{result.topKmh}&nbsp;km/h</span>
        </div>
        <p className="abf-muted">{result.launchAt > 0 ? `Angetreten ${Math.round(result.launchAt)} m vor dem Ziel` : 'Nicht angetreten'}</p>
        <div className="abf-places">
          <span><Icon name="podium" size={15} /><b>{placeIn(today)}.</b>&nbsp;heute</span>
          <span><Icon name="trophy" size={15} /><b>{placeIn(season)}.</b>&nbsp;Saison</span>
        </div>
      </div>
      <ol className="spr-podium" aria-label="Podium">
        {result.podium.map((p, i) => (
          <li key={`${p.name}-${i}`} className={cx(p.me && 'is-me')}>
            <span className="spr-podium__pos">{i + 1}</span>
            <span className="spr-podium__name">{p.me ? `${p.name} (du)` : p.name}</span>
          </li>
        ))}
      </ol>
      <dl className="abf-parts spr-parts">
        {parts.filter(([, v]) => v > 0).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{nf(v)}</dd>
          </div>
        ))}
      </dl>
      <div className="abf-actions">
        <button type="button" className="btn btn--primary btn--full" onClick={onAgain}><Icon name="refresh" size={18} /><span>Nochmal</span></button>
        <button type="button" className="btn btn--secondary abf-actions__board" onClick={onBoard} aria-label="Bestenliste"><Icon name="podium" size={20} /></button>
      </div>
      <button type="button" className="abf-link spr-change" onClick={onRider}>Anderen Fahrer wählen<Icon name="chevron" size={14} /></button>
    </section>
  );
}
