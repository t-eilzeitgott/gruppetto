import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { acquireStage, hasWarmStage, prewarm, releaseStage, type Stage } from '../game/abfahrt/pool';
import type { WarmArgs } from '../app/warm';
import { afterPaint } from '../lib/afterPaint';
import { useApp } from '../app/context';
import { useMembers } from '../app/hooks';
import { invalidate, useQuery } from '../app/query';
import { navigate } from '../app/router';
import { source } from '../app/config';
import type { GameBest } from '../data/source';
import type { Profile } from '../lib/types';
import { Abfahrt, type Friend, type GameEvent, type HudState, type RunResult, type ScoreCat } from '../game/abfahrt/engine';
import { Renderer3D } from '../game/abfahrt/render3d';
import { FpsMeter } from '../game/fpsMeter';
import { FrameClock } from '../game/frameClock';
import { QualityGovernor, storedQuality } from '../game/abfahrt/quality';
import { Track } from '../game/abfahrt/track';
import { nextWeatherName } from '../game/abfahrt/weather';
import { berlinDayKey, berlinDayStart } from '../game/abfahrt/rng';
import { dailyMissions, type Mission } from '../game/abfahrt/missions';
import { Avatar, Segmented, cx, useTitle } from '../ui/kit';
import { useBikes, type Bikes } from '../ui/useBikes';
import { BikeChip, NewBikePill } from './bikeChip';
import { Icon } from '../ui/Icon';
import { GameIcon } from '../ui/GameIcon';
import { HudBanner, PowerRing, RaceBar, TvAd, writeBar, writeRing, type BarState } from './hud';
import { FpsSwitch, GfxSwitches, RangePicker, PauseIcon, PlayIcon, useCountUp } from './gameKit';

export { PauseIcon, PlayIcon, useCountUp };

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

/** Startbild der Abfahrt ohne Seite: beim App-Start unsichtbar vorwärmen (siehe app/warm.ts) */
export function warmAbfahrt(a: WarmArgs): Promise<void> {
  return prewarm(() => new Abfahrt({
    dayKey: a.day,
    names: a.names,
    friends: [],
    kit: { jersey: a.accent, side: '#ffffff', helmet: '#ffffff', shorts: '#16171a', skin: '#f0c4a0', shoes: '#ffffff', number: '27', bike: a.bike },
    best: 0,
    missions: dailyMissions(a.day),
    missionsDone: new Set(),
    tutorial: false,
    onEvent: () => undefined,
    onOver: () => undefined,
  }), { accent: a.accent, dark: a.dark });
}

export function readAccent(): string {
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
  const bikes = useBikes();
  const today = useQuery<GameBest[]>(`game:abfahrt:day:${day}`, () => source.gameLeaderboard('abfahrt', since));
  const missions = useMemo(() => dailyMissions(day), [day]);
  const [doneIds, setDoneIds] = useState<string[]>(() => { try { return JSON.parse(lsGet(missionKey(day)) ?? '[]'); } catch { return []; } });

  const stageRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<Abfahrt | null>(null);
  /** Testfahrt (nur Admin): 0 = normal, 2/3 = Zeitraffer ohne Hindernisse, ohne Wertung */
  const cruiseRef = useRef(0);
  const rendererRef = useRef<Renderer3D | null>(null);
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
      kit: { jersey: accent, side: '#ffffff', helmet: '#ffffff', shorts: '#16171a', skin: '#f0c4a0', shoes: '#ffffff', number: '27', bike: bikes.current },
      best: myBest,
      missions,
      missionsDone: new Set(doneIds),
      tutorial: !(playing && cruiseRef.current) && (Number(lsGet(LS_TUTORIAL)) || 0) < 4,
      cruise: playing && cruiseRef.current ? cruiseRef.current : undefined,
      onEvent: (e) => onEvent(e),
      onOver: (r) => onOver(r),
    });
    eng.setViewport(stageRef.current?.getBoundingClientRect().width ?? 390);
    return eng;
  };

  // Vorschau im Startbildschirm mit dem gewählten Rad (die Freischaltungen laden ggf. erst später)
  useEffect(() => {
    if (uiRef.current === 'ready' && engineRef.current) engineRef.current = makeEngine(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bikes.current]);

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
        if (cruiseRef.current) break;
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
    // Testfahrt: nichts speichern, nichts werten
    if (cruiseRef.current) return;
    const runs = (Number(lsGet(LS_TUTORIAL)) || 0) + 1;
    lsSet(LS_TUTORIAL, String(runs));
    lsSet(LS_COACH, String((Number(lsGet(LS_COACH)) || 0) + 1));
    if (r.score > (Number(lsGet(LS_BEST)) || 0)) { lsSet(LS_BEST, String(r.score)); setBest(r.score); }
    if (r.score > 0) {
      source.submitScore('abfahrt', r.score, r.meters).then(() => invalidate('game:abfahrt')).catch(() => undefined);
    }
  };

  // Neuaufbau der 3D-Ansicht (neue Leinwand), wenn der Browser den Kontext entzogen hat
  const [glGen, setGlGen] = useState(0);

  // Spielschleife
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    // Testmodus ohne 3D (?nogl): nur Spiellogik und Oberfläche – für schnelle automatische Layout-Checks
    if (/[?&]nogl\b/.test(window.location.search)) {
      engineRef.current = makeEngine(false);
      let raf = 0;
      let prev = performance.now();
      const tick = (now: number) => {
        const dt = Math.min(0.05, (now - prev) / 1000);
        prev = now;
        if (uiRef.current !== 'paused') engineRef.current!.update(dt);
        hudRef.current(engineRef.current!, dt);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      (window as unknown as { __abfahrt?: unknown }).__abfahrt = { engine: () => engineRef.current, renderer: null };
      return () => cancelAnimationFrame(raf);
    }
    // 3D erst nach dem ersten Bild aufbauen: Startkarte und Bühne stehen sofort, die Szene blendet ein
    const start = (): (() => void) | undefined => {
      // fertige Bühne aus dem Vorrat (beim App-Start vorgewärmt) oder eine neue
      const warm = hasWarmStage();
      let st: Stage;
      try {
        st = acquireStage();
      } catch {
        setGlError(true);
        return undefined;
      }
      const { renderer, canvas, overlay } = st;
      stage.append(canvas, overlay);
      renderer.resize();
      renderer.setTheme(readAccent(), document.documentElement.dataset.theme === 'dark');
      rendererRef.current = renderer;
      // Testmodus (?lowgfx): winzige Auflösung, selten zeichnen – für schnelle automatische Layout-Checks
      const low = /[?&]lowgfx\b/.test(window.location.search);
      if (low) { renderer.quality = 0.25; renderer.resize(); }
      // zuletzt gefundene Auflösungsstufe dieses Geräts
      else if (renderer.quality !== storedQuality()) { renderer.quality = storedQuality(); renderer.resize(); }
      const gov = new QualityGovernor(0.5);
      // beim Neuaufbau läuft die Fahrt weiter
      if (!engineRef.current || (glGen === 0 && uiRef.current === 'ready')) engineRef.current = makeEngine(false);
      // vorgewärmt: gleich ein Bild zeichnen – die Welt steht, bevor die Seite erscheint
      if (warm) renderer.draw(engineRef.current!, 0);
      let raf = 0;
      // Spielzeit im Takt des Bildschirms (gleichmäßige Schritte, ausgefallene Bilder ohne Sprung nachholen)
      const clock = new FrameClock();
      let acc = 0;
      let frames = 0;
      let lostT = 0;
      let rebuilt = false;
      let drawn = false;
      const rebuild = () => { if (!rebuilt) { rebuilt = true; setGlGen((x) => x + 1); } };
      // Bildrate (im Pausenmenü einschaltbar)
      const fps = new FpsMeter(stage);
      const loop = (now: number) => {
        const dt = clock.tick(now);
        const raw = clock.raw;
        const eng = engineRef.current!;
        // Kontext verloren und nicht zurückgekommen: neue Leinwand statt schwarzem Bild
        if (renderer.lost) {
          lostT += dt;
          if (lostT > 0.8) { rebuild(); return; }
          raf = requestAnimationFrame(loop);
          return;
        }
        lostT = 0;
        if (uiRef.current !== 'paused') eng.update(dt);
        const c0 = performance.now();
        renderer.period = Math.max(1000 / 144, Math.min(1000 / 30, clock.period));
        if (!low || frames % 30 === 0) renderer.draw(eng, uiRef.current === 'paused' ? 0 : dt, raw);
      if (!drawn) { drawn = true; canvas.classList.add('is-drawn'); }
        hudRef.current(eng, dt);
        fps.frame(raw * 1000, performance.now() - c0, renderer.quality, renderer.shaderErrors);
        // Bildrate beobachten und notfalls die Qualität senken
        acc += dt;
        frames += 1;
        // Auflösung nach Bildzeit regeln: alle Bilder der Fahrt zählen (Median – Nachladeruckler stören nicht)
        if (uiRef.current === 'playing' && !low) {
          const nq = gov.frame(raw, renderer.quality);
          if (nq !== null) renderer.setQuality(nq); // wirkt direkt vor dem nächsten Bild (kein schwarzes Bild)
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      const onResize = () => { renderer.requestResize(); engineRef.current?.setViewport(canvas.getBoundingClientRect().width); };
      const onVis = () => {
        if (document.hidden && uiRef.current === 'playing') setUi('paused');
        if (!document.hidden && renderer.lost) rebuild();
      };
      const onLost = (e: Event) => { e.preventDefault(); };
      const onRestored = () => rebuild();
      canvas.addEventListener('webglcontextlost', onLost);
      canvas.addEventListener('webglcontextrestored', onRestored);
      const onTheme = () => window.setTimeout(() => renderer.setTheme(readAccent(), document.documentElement.dataset.theme === 'dark'), 30);
      const obs = new MutationObserver(onTheme);
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-tour'] });
      window.addEventListener('resize', onResize);
      // Homescreen-App auf iOS: 100vh ist dort zu kurz, darum die echte Bildschirmhöhe nehmen
      const root = stage.parentElement as HTMLElement | null;
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
        fps.dispose();
        canvas.removeEventListener('webglcontextlost', onLost);
        canvas.removeEventListener('webglcontextrestored', onRestored);
        ro?.disconnect();
        window.removeEventListener('orientationchange', fit);
        releaseStage(st);
        window.removeEventListener('resize', onResize);
        document.removeEventListener('visibilitychange', onVis);
        obs.disconnect();
      };
    };
    // vorgewärmte Bühne: sofort (das erste Bild ist schon im Übergang zu sehen), sonst nach dem ersten Bild
    let stop: (() => void) | undefined;
    let cancel = () => {};
    if (hasWarmStage()) stop = start();
    else cancel = afterPaint(() => { stop = start(); });
    return () => { cancel(); stop?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glGen]);

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
    set('mult', `×${h.mult}`);
    const multEl = hud.current.multWrap;
    if (multEl) {
      multEl.style.opacity = h.mult > 1 ? '1' : '0';
      multEl.style.setProperty('--left', String(h.multLeft));
    }
    writeBar(hud.current, last.current, barState(h.meters));
    writeRing(hud.current, last.current, {
      kmh: h.kmh, fill: Math.min(1, h.kmh / 100), tone: 'speed',
      mode: h.wantTuck ? 'go' : h.wantBrake > 0.3 ? 'ease' : 'sit', draft: h.draft,
    });
  };

  const profileMax = useMemo(() => Math.max(2000, ...friends.map((f) => f.meters * 1.12)), [friends]);
  // die Schleife läuft seit dem ersten Render: immer die aktuelle HUD-Funktion (mit geladener Bestenliste) aufrufen
  const hudRef = useRef(writeHud);
  hudRef.current = writeHud;

  /** Rennleiste: Platz unter den Bestmarken der Runde (live), Abstand zum Nächsten, gefahrene Strecke */
  const barState = (meters: number): BarState => {
    const field = friends.filter((f) => f.userId !== 'me');
    const first = (n: string) => n.trim().split(/\s+/)[0] ?? n;
    const ahead = field.filter((f) => f.meters > meters).sort((a, b) => a.meters - b.meters)[0];
    const own = friends.find((f) => f.userId === 'me');
    let gap = '';
    let label = '';
    if (ahead) { gap = `+${km(ahead.meters - meters)}`; label = `bis ${first(ahead.name)}`; }
    else if (field.length) { gap = `+${km(meters - Math.max(...field.map((f) => f.meters)))}`; label = 'Vorsprung'; }
    else if (own && own.meters > meters) { gap = `+${km(own.meters - meters)}`; label = 'bis Bestmarke'; }
    return {
      place: field.length ? `${1 + field.filter((f) => f.meters > meters).length}.` : '',
      gap, label, dist: km(meters), icon: 'road', lead: field.length > 0 && !ahead, progress: meters / profileMax,
    };
  };

  const start = (cruise = 0) => {
    if (!stageRef.current) return;
    cruiseRef.current = me.is_admin ? cruise : 0;
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

  const boardRows = board === 'day' ? today.data ?? [] : season.data ?? [];
  // Wetter der nächsten Fahrt (wechselt über den Tag, siehe weather.ts)
  const wetter = nextWeatherName();

  return (
    <div className={cx('abf', `abf--${ui}`)}>
      {/* 3D-Bühne: die Leinwand kommt aus dem Vorrat (pool.ts) und wird hier eingehängt */}
      <div
        key={glGen}
        ref={stageRef}
        className="abf__stage"
        role="application"
        aria-label="Spielfeld: Daumen seitlich ziehen zum Lenken, nach oben zum Ducken, nach unten zum Bremsen"
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

      {/* HUD */}
      {cruiseRef.current && (ui === 'playing' || ui === 'countdown') ? <DebugBar eng={() => engineRef.current} /> : null}
      {ui === 'playing' || ui === 'paused' || ui === 'countdown' ? (
        <div className="abf-hud hud" aria-hidden={ui === 'countdown'}>
          <div className="hud-top hud-top--score">
            <button type="button" className="abf-round" onClick={togglePause} aria-label={ui === 'paused' ? 'Weiter' : 'Pause'}>
              {ui === 'paused' ? <PlayIcon /> : <PauseIcon />}
            </button>
            <div className="hud-score">
              <strong ref={bind('score')}>0</strong>
              <span className="abf-mult" ref={bind('multWrap')}>
                <span ref={bind('mult')}>×1</span>
                <i aria-hidden="true" />
              </span>
            </div>
            <PowerRing bind={bind} />
          </div>
          <RaceBar bind={bind} wide marks={friends.map((f) => ({ at: f.meters / profileMax, kind: 'friend' as const, color: f.color }))} />
          {banner && (ui === 'playing' || ui === 'countdown') ? <HudBanner banner={banner} onEnd={() => setBanner(null)} /> : null}
          <div className="abf-thumb" ref={bind('thumb')} aria-hidden="true">
            <span className="abf-thumb__up"><TuckIcon /></span>
            <span className="abf-thumb__dot" />
            <span className="abf-thumb__down"><BrakeIcon /></span>
          </div>
          <TvAd hidden={!!coach || ui !== 'playing'} />
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
          <div className="abf-card abf-card--small abf-scroll">
            <h2 className="abf-title">Pause</h2>
            <button type="button" className="btn btn--primary btn--full" onClick={() => setUi('playing')}><span>Weiterfahren</span></button>
            <button type="button" className="btn btn--secondary btn--full" onClick={() => navigate('/')}><span>Aufhören</span></button>
            <RangePicker />
            <FpsSwitch />
            <GfxSwitches />
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
                  <GameIcon size={44} />
                  <div>
                    <h1 className="abf-title">Abfahrt</h1>
                    <p className="abf-sub">{track.title}{wetter ? ` · ${wetter}` : ''}</p>
                  </div>
                </div>
                <DescentProfile track={track} friends={friends} members={members.data ?? []} max={profileMax} />
                <Missions missions={missions} done={doneIds} compact />
                <button type="button" className="btn btn--primary btn--full abf-go" onClick={() => start()}><span>Losfahren</span></button>
                {me.is_admin ? (
                  <div className="abf-cruise">
                    <span className="abf-muted">Testfahrt ohne Hindernisse und Wertung</span>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => start(2)}>2×</button>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => start(3)}>3×</button>
                  </div>
                ) : null}
                <BikeChip bikes={bikes} />
                <MiniBoard rows={today.data?.length ? today.data : season.data ?? []} label={today.data?.length ? 'Heute' : 'Saison'} members={members.data ?? []} meId={me.id} onOpen={() => setShowBoard(true)} totalM={mine?.total_m ?? 0} />
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
                bikes={bikes}
                result={result}
                record={!cruiseRef.current && result.score >= myBest && result.score > 0}
                prevRank={prevRank}
                today={today.data ?? []}
                season={season.data ?? []}
                meId={me.id}
                totalM={(mine?.total_m ?? 0)}
                missions={missions}
                done={doneIds}
                onAgain={() => start(cruiseRef.current)}
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

/** Prüfpult der Testfahrt (Admin): stehen bleiben, vor/zurück schieben, Zeitraffer */
function DebugBar({ eng }: { eng: () => Abfahrt | null }) {
  const [speed, setSpeed] = useState(() => eng()?.dbg.speed ?? 1);
  const [freeze, setFreeze] = useState(false);
  const hold = (move: number) => ({
    onPointerDown: (e: RPointerEvent) => { e.preventDefault(); const g = eng(); if (g) g.dbg.move = move; },
    onPointerUp: () => { const g = eng(); if (g) g.dbg.move = 0; },
    onPointerCancel: () => { const g = eng(); if (g) g.dbg.move = 0; },
    onPointerLeave: () => { const g = eng(); if (g) g.dbg.move = 0; },
  });
  return (
    <div className="abf-dbg" role="group" aria-label="Prüfpult">
      <button type="button" className={cx('abf-dbg__btn', freeze && 'is-on')} onClick={() => { const g = eng(); if (!g) return; g.dbg.freeze = !g.dbg.freeze; setFreeze(g.dbg.freeze); }}>{freeze ? '▶' : '⏸'}</button>
      <button type="button" className="abf-dbg__btn" {...hold(-1)} aria-label="Zurück">◀</button>
      <button type="button" className="abf-dbg__btn" {...hold(1)} aria-label="Vor">▶▶</button>
      {[1, 2, 3, 5].map((k) => (
        <button key={k} type="button" className={cx('abf-dbg__btn', speed === k && 'is-on')} onClick={() => { const g = eng(); if (!g) return; g.dbg.speed = k; setSpeed(k); }}>{k}×</button>
      ))}
    </div>
  );
}

function Missions({ missions, done, compact }: { missions: Mission[]; done: string[]; compact?: boolean }) {
  return (
    <section className={cx('abf-missions', compact && 'abf-missions--compact')} aria-label="Aufgaben heute">
      {compact ? null : <h2 className="abf-eyebrow">Aufgaben heute</h2>}
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
    </figure>
  );
}

function MiniBoard({ rows, label, members, meId, onOpen, totalM }: {
  rows: GameBest[]; label: string; members: Profile[]; meId: string; onOpen: () => void; totalM: number;
}) {
  const myIdx = rows.findIndex((r) => r.user_id === meId);
  const shown = rows.slice(0, 3).map((r, i) => ({ r, i }));
  if (myIdx >= 3) shown.push({ r: rows[myIdx], i: myIdx });
  const rank = rankFor(totalM / 1000);
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
      ) : <p className="abf-muted">Noch keine Läufe – fahr die erste Bestmarke!</p>}
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

function Summary({ bikes, result, record, prevRank, today, season, meId, totalM, missions, done, onAgain, onBoard }: {
  bikes: Bikes; result: RunResult; record: boolean; prevRank: { day: number; season: number } | null; today: GameBest[]; season: GameBest[];
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
        <div className="abf-badges">
          <span className={cx('abf-badge', record && 'is-gold')}>
            <Icon name={record ? 'trophy' : 'flame'} size={14} />
            {record ? 'Bestleistung' : result.reason || 'Ende'}
          </span>
          <NewBikePill bikes={bikes} />
        </div>
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

// ------------------------------------------------------------------ Symbole

export function TuckIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V5M8 9l4-4 4 4" /></svg>;
}
export function BrakeIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v15M8 15l4 4 4-4" /></svg>;
}
