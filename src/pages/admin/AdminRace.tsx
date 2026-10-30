/**
 * Abfahrt auf WebGPU (Admin): das ganze Spiel mit der neuen Grafik – Startkarte, Countdown, Fahrt mit Punkten,
 * Kombos, Hinweisen und Sturz, Ergebnis. Keine Bestenlisten, nichts wird gespeichert (nur die Einstellungen).
 * Im Pausenmenü: Himmel und Licht (dramatischer Himmel, Sonnenuntergangs-Licht …), Welt, Kamera, Technik und
 * die Messfahrt für Berichte vom Gerät.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '../../app/router';
import { useMembers, useTourData } from '../../app/hooks';
import { useApp } from '../../app/context';
import { useQuery } from '../../app/query';
import { source } from '../../app/config';
import { cx, Segmented, useTitle } from '../../ui/kit';
import { Icon } from '../../ui/Icon';
import { useGameLock, PauseIcon, PlayIcon, lsGet, lsSet } from '../gameKit';
import { HudBanner, PowerRing, RaceBar, writeBar, writeRing, type HudBannerData } from '../hud';
import { useBikes } from '../../ui/useBikes';
import { BUILD_ID } from '../../app/config';
import { berlinDayKey } from '../../game/abfahrt/rng';
import { SCORE_LABEL, type GameEvent, type HudState, type RunResult, type ScoreCat } from '../../game/abfahrt/engine';
import type { Kit } from '../../game/abfahrt/rider';
import type { TtEvent, TtHud, TtResult } from '../../game/abfahrt/zeitfahren';
import { stageRef } from '../../game/abfahrt/stageRef';
import { TT_FINISH, TT_SPLITS, TT_TOP } from '../../game/abfahrt/track';
import { firstName, fmtGap, fmtTime, pickGhosts, type GhostRider, type TtGhostRow } from '../../game/tt';
import { buildGhosts, GhostRow, pacerOf } from '../Zeitfahren';
import { dist, placeThumb } from '../finale';
import { raceBar } from '../hud';
import type { Race, RaceCam, RaceStats, TagView } from '../../game/gpu/race';
import type { Report } from '../../game/gpu/perf';
import { loadSettings, MOODS, RACE_DEFAULTS, RACE_KEY, TT_DEFAULTS, TT_KEY, type Settings } from '../../game/gpu/mood';
import { copyText, lsRead, lsWrite, shareFile } from './gpuKit';

type Ui = 'loading' | 'ready' | 'countdown' | 'playing' | 'paused' | 'over';

const LS_REPORT = 'gruppetto.gpu.race.lastReport';
const LS_FPS = 'gruppetto.gpu.race.fps';
const nf = (n: number) => Math.round(n).toLocaleString('de-DE');
const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`);

const SKY: { k: keyof Settings; label: string; hint: string }[] = [
  { k: 'drama', label: 'Dramatischer Himmel', hint: 'Quellwolken, angestrahlte Wolkenfelder, Strahlen – gebacken, kostet beim Fahren nichts' },
  { k: 'sunset', label: 'Sonnenuntergangs-Licht', hint: 'Warmer Schein um die tiefe Sonne, ganz dezent – fast kostenlos' },
  { k: 'bloom', label: 'Leuchten', hint: 'Glanz um helle Stellen (Bloom)' },
  { k: 'grade', label: 'Farbfilter', hint: 'Wärme, Kontrast, kühle Schatten' },
  { k: 'vignette', label: 'Vignette', hint: 'Dunklere Bildränder' },
  { k: 'grain', label: 'Filmkorn', hint: '' },
  { k: 'fog', label: 'Dunst', hint: 'Luftperspektive in der Ferne' },
  { k: 'rain', label: 'Regenstreifen', hint: 'Bei Regen' },
];
const WORLD: { k: keyof Settings; label: string; hint: string }[] = [
  { k: 'crowd', label: 'Zuschauer', hint: '' },
  { k: 'life', label: 'Blumen, Sträucher, Tiere', hint: '' },
  { k: 'grass', label: 'Grashalme', hint: 'Am Straßenrand' },
];
const CAMS: { value: RaceCam; label: string }[] = [
  { value: 'chase', label: 'Verfolger' },
  { value: 'low', label: 'Tief' },
  { value: 'side', label: 'Seite' },
  { value: 'drone', label: 'Drohne' },
];
const FPS_CAPS: { value: string; label: string }[] = [
  { value: '30', label: '30 fps' },
  { value: '60', label: '60 fps' },
  { value: '0', label: 'frei' },
];
const ORDER: ScoreCat[] = ['dist', 'overtake', 'bidons', 'draft', 'curves', 'near', 'air', 'bonus'];

function Switch({ on, label, hint, onChange }: { on: boolean; label: string; hint?: string; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={cx('abf-switch abf-switch--sub', on && 'is-on')} onClick={() => onChange(!on)}>
      <span className="abf-switch__text"><span>{label}</span>{hint ? <small>{hint}</small> : null}</span>
      <span className="abf-switch__track" aria-hidden="true"><span className="abf-switch__knob" /></span>
    </button>
  );
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="race-slider">
      <span>{label} <em>{value.toFixed(step >= 1 ? 0 : 2)}</em></span>
      <input type="range" min={min} max={max} step={step} value={value}
        onInput={(e: React.FormEvent<HTMLInputElement>) => onChange(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function TuckIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V5M8 9l4-4 4 4" /></svg>;
}
function BrakeIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v15M8 15l4 4 4-4" /></svg>;
}

/** Zeitfahren auf WebGPU: dieselbe Seite im Modus „tt“ */
export function TtGpuPage() { return <RaceGpuPage mode="tt" />; }

export function RaceGpuPage({ mode = 'abfahrt' }: { mode?: 'abfahrt' | 'tt' }) {
  const tt = mode === 'tt';
  useTitle(tt ? 'Zeitfahren · WebGPU' : 'Abfahrt · WebGPU');
  useGameLock();
  const members = useMembers();
  const bikes = useBikes();
  const { me, tour } = useApp();
  const tourData = useTourData(tt ? tour : null);
  const day = berlinDayKey();
  // Zeitfahren: Geister der Runde (beste Fahrt des Tages je Mitglied), echte Vorlage für Namen und Gegend
  const ghostQ = useQuery<TtGhostRow[]>(tt ? `tt:ghosts:${day}` : 'tt:ghosts:none', () => (tt ? source.ttGhosts(day) : Promise.resolve([])));
  const settled = !tt || ghostQ.data !== undefined || !!ghostQ.error;
  const ghosts = useMemo(() => {
    if (!tt) return [] as GhostRider[];
    const all = buildGhosts(ghostQ.data ?? [], members.data ?? [], me, null, day);
    const others = all.filter((g) => !g.me).length;
    return pickGhosts(all, all.find((g) => g.me && !g.old)?.timeMs ?? null, others < 3 && settled ? pacerOf(day) : null);
  }, [tt, ghostQ.data, settled, members.data, me, day]);
  const town = useMemo(() => (tt ? stageRef('tt', tour?.name, tourData.data?.stages, day) : null), [tt, tour?.name, tourData.data, day]);
  const ghostsRef = useRef(ghosts);
  ghostsRef.current = ghosts;
  const townRef = useRef(town);
  townRef.current = town;
  const DEFAULTS = tt ? TT_DEFAULTS : RACE_DEFAULTS;
  const KEY = tt ? TT_KEY : RACE_KEY;
  const [ttResult, setTtResult] = useState<TtResult | null>(null);
  const tagEls = useRef<(HTMLDivElement | null)[]>([]);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const raceRef = useRef<Race | null>(null);
  const [ui, setUi] = useState<Ui>('loading');
  const uiRef = useRef<Ui>('loading');
  uiRef.current = ui;
  const [stats, setStats] = useState<RaceStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(3);
  const [banner, setBanner] = useState<HudBannerData | null>(null);
  const bannerKey = useRef(0);
  const [result, setResult] = useState<RunResult | null>(null);
  const [cruise, setCruise] = useState(0);
  const [settings, setSettings] = useState<Settings>(() => loadSettings(KEY, DEFAULTS));
  const [cam, setCam] = useState<RaceCam>('chase');
  const [auto, setAuto] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [showFps, setShowFps] = useState(() => lsGet(LS_FPS) === '1');
  const [title, setTitle] = useState('');
  const [veil, setVeil] = useState(true);
  // Messfahrt
  const [measuring, setMeasuring] = useState(false);
  const [recInfo, setRecInfo] = useState({ s: 0, hitches: 0 });
  const [report, setReport] = useState<Report | null>(null);
  const [lastReport, setLastReport] = useState<string | null>(() => lsRead(LS_REPORT));
  const [copied, setCopied] = useState(false);
  // Kostenanalyse: Fortschritt und Ergebnis
  const [cost, setCost] = useState<{ i: number; n: number; label: string } | null>(null);
  const [costText, setCostText] = useState<string | null>(null);
  const [costCopied, setCostCopied] = useState(false);
  const hud = useRef<Record<string, HTMLElement | null>>({});
  const last = useRef<Record<string, string>>({});
  const bind = (key: string) => (el: HTMLElement | null) => { hud.current[key] = el; };
  const names = (members.data ?? []).map((m) => (m.display_name ?? '').trim()).filter(Boolean);
  const namesRef = useRef(names);
  namesRef.current = names;
  const bikeRef = useRef(bikes.current);
  bikeRef.current = bikes.current;

  const onEvent = (e: GameEvent) => {
    if (e.type === 'count') { setCount(e.n); if (e.n <= 0) window.setTimeout(() => { if (uiRef.current === 'countdown') setUi('playing'); }, 450); return; }
    if (e.type === 'section') { bannerKey.current += 1; setBanner({ key: bannerKey.current, title: e.name, sub: `${e.alt.toLocaleString('de-DE')} m` }); return; }
    if (e.type === 'tip') { bannerKey.current += 1; setBanner({ key: bannerKey.current, title: e.text }); }
  };
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onTtEvent = (e: TtEvent) => {
    if (e.type === 'count') { setCount(e.n); if (e.n <= 0) window.setTimeout(() => { if (uiRef.current === 'countdown') setUi('playing'); }, 450); return; }
    bannerKey.current += 1;
    if (e.type === 'split') {
      const sub = e.gapMs === null ? `${e.place}. Platz` : `${fmtGap(e.gapMs)} ${e.gapMs <= 0 ? 'vor' : 'hinter'} ${e.bestName ?? 'der Bestzeit'} · ${e.place}. von ${e.riders}`;
      setBanner({ key: bannerKey.current, title: `Zwischenzeit ${e.index + 1} · ${fmtTime(e.timeMs)}`, sub, tone: e.gapMs !== null && e.gapMs <= 0 ? 'gold' : e.gapMs === null ? undefined : 'accent' });
      try { navigator.vibrate?.(e.gapMs !== null && e.gapMs <= 0 ? [40, 60, 40] : 40); } catch { /* egal */ }
      return;
    }
    setBanner({ key: bannerKey.current, title: e.title, sub: e.sub, tone: e.tone });
  };
  const onTtEventRef = useRef(onTtEvent);
  onTtEventRef.current = onTtEvent;

  /** HUD jedes Bild direkt in die Elemente (kein React-Render) */
  const writeHud = () => {
    const r = raceRef.current;
    const u = uiRef.current;
    if (!r || (u !== 'playing' && u !== 'paused' && u !== 'countdown')) return;
    const h0 = r.hud();
    if (!h0) return;
    if (tt) { writeTtHud(r, h0 as TtHud, u); return; }
    const h = h0 as HudState;
    const th = hud.current.thumb;
    if (th) {
      if (h.touch && u === 'playing') {
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
    if (multEl) { multEl.style.opacity = h.mult > 1 ? '1' : '0'; multEl.style.setProperty('--left', String(h.multLeft)); }
    writeBar(hud.current, last.current, { place: '', gap: '', label: '', dist: km(h.meters), icon: 'road', lead: false, progress: (h.meters % 4000) / 4000 });
    writeRing(hud.current, last.current, { kmh: h.kmh, fill: Math.min(1, h.kmh / 100), tone: 'speed', mode: h.wantTuck ? 'go' : h.wantBrake > 0.3 ? 'ease' : 'sit', draft: h.draft });
  };
  /** Zeitfahren: Uhr, Rückstand auf die Bestzeit, Vorrat, Streckenleiste, Namensschilder */
  const writeTtHud = (r: Race, h: TtHud, u: Ui) => {
    placeThumb(hud.current.thumb, h.touch, u === 'playing', h.mode === 'go', h.mode === 'ease');
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
    // Namensschilder über den Geistern (Elemente, nur verschoben – kein Neuzeichnen)
    const tags: TagView[] = u === 'playing' ? r.tags() : [];
    tagEls.current.forEach((el, i) => {
      if (!el) return;
      const t = tags[i];
      if (!t) { if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'; return; }
      el.style.visibility = 'visible';
      el.style.transform = `translate(${t.x.toFixed(0)}px, ${t.y.toFixed(0)}px) translate(-50%, -100%) scale(${t.k.toFixed(2)})`;
      const k = `tag${i}`;
      const val = `${t.text}|${t.sub}|${t.color}`;
      if (last.current[k] !== val) {
        last.current[k] = val;
        el.style.setProperty('--tag', t.color);
        (el.firstElementChild as HTMLElement).textContent = t.text;
        (el.lastElementChild as HTMLElement).textContent = t.sub;
      }
    });
  };
  const writeHudRef = useRef(writeHud);
  writeHudRef.current = writeHud;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !settled) return;
    let alive = true;
    let race: Race | null = null;
    let lastUi = 0;
    void import('../../game/gpu/race').then(({ Race: R }) => {
      if (!alive) return;
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff5fa2';
      const kit: Kit = { jersey: accent, side: '#ffffff', helmet: '#ffffff', shorts: '#16171a', skin: '#f0c4a0', shoes: '#ffffff', number: tt ? '1' : '27', bike: bikeRef.current };
      race = new R(host, {
        dayKey: berlinDayKey(),
        names: namesRef.current,
        kit,
        settingsKey: KEY,
        defaults: DEFAULTS,
        tt: tt ? {
          rider: me.display_name ?? 'Du', ghosts: ghostsRef.current, myBest: ghostsRef.current.find((g) => g.me && !g.old)?.timeMs ?? null, town: townRef.current,
          onEvent: (e) => onTtEventRef.current(e), onOver: (res) => { setTtResult(res); setUi('over'); },
        } : undefined,
        onStats: (s) => {
          const now = performance.now();
          if (s.loading >= 1 && now - lastUi < 400) return;
          lastUi = now;
          if (s.loading >= 1) race?.perf.event(16);
          setStats({ ...s });
        },
        onReady: () => { setUi('ready'); setTitle(race?.title ?? ''); },
        onError: (e) => setError(String(e)),
        onEvent: (e) => onEventRef.current(e),
        onOver: (res) => { setResult(res); setUi('over'); },
        onFrame: () => writeHudRef.current(),
      });
      race.overlay.accent = accent;
      raceRef.current = race;
      (window as unknown as { __race?: Race }).__race = race;
      race.start().catch((e) => { console.error(e); setError(e instanceof Error ? e.message : String(e)); });
    }).catch((e) => setError(String(e)));
    const onResize = () => race?.resize();
    const onVis = () => { if (document.hidden && uiRef.current === 'playing') pause(true); };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      race?.dispose();
      raceRef.current = null;
      delete (window as unknown as { __race?: Race }).__race;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  useEffect(() => {
    if (ui === 'loading') return;
    const id = window.setTimeout(() => setVeil(false), 650);
    return () => window.clearTimeout(id);
  }, [ui]);

  const change = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    raceRef.current?.applySettings(next);
  };

  const go = (k = 0) => {
    const r = raceRef.current;
    if (!r) return;
    setCruise(k);
    setResult(null);
    setTtResult(null);
    setBanner(null);
    setSheet(false);
    last.current = {};
    r.autopilot = auto;
    r.go(k);
    setCount(tt ? 5 : 3);
    setUi('countdown');
  };
  const pause = (on: boolean) => {
    const r = raceRef.current;
    if (!r) return;
    if (on && uiRef.current !== 'playing' && uiRef.current !== 'countdown') return;
    r.paused = on;
    r.pointerUp();
    setUi(on ? 'paused' : 'playing');
  };
  const toStart = () => {
    raceRef.current?.toStart();
    setResult(null);
    setTtResult(null);
    setSheet(false);
    setUi('ready');
  };

  // Daumensteuerung (wie im Spiel)
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (ui !== 'playing' && ui !== 'countdown') return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    raceRef.current?.pointerDown(e.clientX, e.clientY);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.buttons === 0) return;
    raceRef.current?.pointerMove(e.clientX, e.clientY);
  };
  const onUp = () => raceRef.current?.pointerUp();

  // Tastatur
  useEffect(() => {
    const map: Record<string, 'left' | 'right' | 'down' | 'up'> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down', ArrowUp: 'up', a: 'left', d: 'right', s: 'down', w: 'up' };
    const down = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') { if (uiRef.current === 'ready' || uiRef.current === 'over') { e.preventDefault(); go(cruise); } return; }
      if (e.key === 'Escape' || e.key === 'p') { pause(uiRef.current !== 'paused'); return; }
      const k = map[e.key];
      if (k) { e.preventDefault(); raceRef.current?.key(k, true); }
    };
    const up = (e: KeyboardEvent) => { const k = map[e.key]; if (k) raceRef.current?.key(k, false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  });

  // Messfahrt
  const startMeasure = () => {
    const r = raceRef.current;
    if (!r) return;
    const diff: Partial<Settings> = {};
    for (const k of Object.keys(settings) as (keyof Settings)[]) if (settings[k] !== DEFAULTS[k]) (diff as Record<string, unknown>)[k] = settings[k];
    r.startMeasure({ version: BUILD_ID, einstellungen: diff, aufnahme: new Date().toISOString() });
    setMeasuring(true);
    setReport(null);
    if (uiRef.current === 'paused') pause(false);
  };
  const stopMeasure = () => {
    const r = raceRef.current?.stopMeasure() ?? null;
    setMeasuring(false);
    if (r) { setReport(r); setCopied(false); lsWrite(LS_REPORT, r.text); setLastReport(r.text); }
  };
  const runCost = () => {
    const r = raceRef.current;
    if (!r || cost) return;
    setCost({ i: 0, n: 1, label: 'startet' });
    void r.costAnalysis((i, n, label) => setCost({ i, n, label })).then((t) => { setCost(null); setCostText(t); setCostCopied(false); })
      .catch((e: unknown) => { setCost(null); setError(String(e)); });
  };
  useEffect(() => {
    if (!measuring) return;
    const id = window.setInterval(() => { const p = raceRef.current?.perf; if (p) setRecInfo({ s: p.recSeconds, hitches: p.hitches }); }, 500);
    return () => window.clearInterval(id);
  }, [measuring]);

  const pct = Math.round((stats?.loading ?? 0) * 100);
  const running = ui === 'playing' || ui === 'paused' || ui === 'countdown';

  const settingsPanel = (
    <>
      <div className="abf-gfx">
        <span className="abf-range__label">Himmel und Licht</span>
        {SKY.map((t) => <Switch key={t.k} on={!!settings[t.k]} label={t.label} hint={t.hint} onChange={(v) => change({ [t.k]: v } as Partial<Settings>)} />)}
      </div>
      <div className="abf-gfx">
        <span className="abf-range__label">Welt</span>
        {WORLD.map((t) => <Switch key={t.k} on={!!settings[t.k]} label={t.label} hint={t.hint} onChange={(v) => change({ [t.k]: v } as Partial<Settings>)} />)}
        <Slider label="Gegner im Bild (höchstens)" value={settings.oppMax} min={0} max={16} step={1} onChange={(v) => change({ oppMax: v })} />
        <Slider label="Bäume in der Ferne bis (m)" value={settings.treeFar} min={300} max={1850} step={50} onChange={(v) => change({ treeFar: v })} />
      </div>
      <div className="race-sec">
        <span className="abf-range__label">Kamera</span>
        <Segmented label="Kamera" value={cam} options={CAMS} onChange={(c) => { setCam(c); if (raceRef.current) raceRef.current.camMode = c; }} />
      </div>
      <div className="abf-gfx">
        <span className="abf-range__label">Technik</span>
        <Slider label="Bildauflösung (× Bildpunkte je Punkt)" value={settings.maxDpr} min={1} max={3} step={0.1} onChange={(v) => change({ maxDpr: v })} />
        <Slider label="Szene mindestens (kleiner gerechnet, hochskaliert und nachgeschärft)" value={settings.minDpr} min={0.8} max={3} step={0.05} onChange={(v) => change({ minDpr: v })} />
        <div className="race-sec">
          <span className="abf-range__label">Bildrate höchstens</span>
          <span className="abf-range__hint">Weniger Wärme und Akku – kann auf dem iPhone aber langsamer machen (die Grafik taktet in den Pausen herunter). „frei“: so viele, wie der Bildschirm zeigt</span>
          <Segmented label="Bildrate höchstens" value={String(settings.fpsMax > 0 ? settings.fpsMax : 0)} options={FPS_CAPS} onChange={(v) => change({ fpsMax: Number(v) })} />
        </div>
        <Switch on={settings.msaa > 0} label="Kantenglättung (4×)" hint="Wirkt nach Neuladen der Seite" onChange={(v) => { change({ msaa: v ? 4 : 0 }); window.setTimeout(() => location.reload(), 150); }} />
        <Switch on={showFps} label="Bildrate anzeigen" hint="Bildzeit, CPU, GPU, Auflösung, Nachladen" onChange={(v) => { setShowFps(v); lsSet(LS_FPS, v ? '1' : '0'); }} />
        <Switch on={auto} label="Autopilot" hint="Fährt selbst: Linie, Flaschen, weicht Hindernissen aus" onChange={(v) => { setAuto(v); if (raceRef.current) raceRef.current.autopilot = v; }} />
      </div>
      <div className="race-sec">
        <span className="abf-range__label">Messfahrt</span>
        <span className="abf-range__hint">Zeichnet jedes Bild auf (Bildzeit, CPU je Baustein, GPU, Nachladen der Welt, neue Shader). Danach Bericht kopieren und mir schicken.</span>
        <div className="race-row">
          {measuring ? <button type="button" className="btn btn--secondary btn--sm" onClick={stopMeasure}>Messung beenden</button>
            : <button type="button" className="btn btn--secondary btn--sm" onClick={startMeasure}>Messfahrt starten</button>}
          {lastReport ? <button type="button" className="btn btn--ghost btn--sm" onClick={() => { void copyText(lastReport).then((ok) => setCopied(ok)); }}>{copied ? 'Kopiert ✓' : 'Letzten Bericht kopieren'}</button> : null}
        </div>
      </div>
      <div className="race-sec">
        <span className="abf-range__label">Kostenanalyse</span>
        <span className="abf-range__hint">Misst an dieser Stelle je Ebene (Leuchten, Schatten, Gegner, Bäume, Landschaft …) und Auflösung, was sie kostet – etwa 30 s, das Spiel bleibt solange in der Pause.</span>
        <button type="button" className="btn btn--secondary btn--sm" onClick={runCost} disabled={!!cost}>{cost ? `${cost.i + 1}/${cost.n}: ${cost.label}` : 'Kostenanalyse starten'}</button>
      </div>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => change({ ...DEFAULTS })}>Grafik zurücksetzen</button>
    </>
  );

  return (
    <div className={cx('abf race', `abf--${ui === 'loading' ? 'ready' : ui}`)}>
      <div ref={hostRef} className="abf__stage" role="application" aria-label="Spielfeld: Daumen seitlich ziehen zum Lenken, nach oben zum Ducken, nach unten zum Bremsen"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />

      {running && tt ? (
        <div className="abf-hud hud" aria-hidden={ui === 'countdown'}>
          <div className="hud-top">
            <button type="button" className="abf-round" onClick={() => pause(ui !== 'paused')} aria-label={ui === 'paused' ? 'Weiter' : 'Pause'}>
              {ui === 'paused' ? <PlayIcon /> : <PauseIcon />}
            </button>
            <RaceBar bind={bind} marks={[...TT_SPLITS.map((z) => ({ at: z / TT_FINISH, kind: 'friend' as const, color: '#ffd23f' })), { at: TT_TOP / TT_FINISH, kind: 'gpm' as const }]} />
            <PowerRing bind={bind} badge />
          </div>
          <div className="tt-clock" aria-hidden="true">
            <b ref={bind('clock')}>0:00,0</b>
            <span className="tt-clock__gap" ref={bind('clockGap')} />
          </div>
          {[0, 1].map((i) => <div key={i} className="race-tag" ref={(el: HTMLDivElement | null) => { tagEls.current[i] = el; }} aria-hidden="true"><b /><span /></div>)}
          {banner && ui !== 'paused' ? <HudBanner banner={banner} onEnd={() => setBanner(null)} /> : null}
          <div className="abf-thumb" ref={bind('thumb')} aria-hidden="true">
            <span className="abf-thumb__up"><TuckIcon /></span>
            <span className="abf-thumb__dot" />
            <span className="abf-thumb__down"><BrakeIcon /></span>
          </div>
        </div>
      ) : null}

      {running && !tt ? (
        <div className="abf-hud hud" aria-hidden={ui === 'countdown'}>
          <div className="hud-top hud-top--score">
            <button type="button" className="abf-round" onClick={() => pause(ui !== 'paused')} aria-label={ui === 'paused' ? 'Weiter' : 'Pause'}>
              {ui === 'paused' ? <PlayIcon /> : <PauseIcon />}
            </button>
            <div className="hud-score">
              <strong ref={bind('score')}>0</strong>
              <span className="abf-mult" ref={bind('multWrap')}><span ref={bind('mult')}>×1</span><i aria-hidden="true" /></span>
            </div>
            <PowerRing bind={bind} />
          </div>
          <RaceBar bind={bind} wide />
          {banner && ui !== 'paused' ? <HudBanner banner={banner} onEnd={() => setBanner(null)} /> : null}
          <div className="abf-thumb" ref={bind('thumb')} aria-hidden="true">
            <span className="abf-thumb__up"><TuckIcon /></span>
            <span className="abf-thumb__dot" />
            <span className="abf-thumb__down"><BrakeIcon /></span>
          </div>
        </div>
      ) : null}

      {cruise && (ui === 'playing' || ui === 'countdown') ? <CruiseBar race={() => raceRef.current} /> : null}

      {showFps && stats && ui !== 'loading' ? (
        <div className="race-fps">
          <b>{Math.round(stats.fps)} fps</b> {stats.ms.toFixed(1)} ms · CPU {stats.cpu.toFixed(1)} ms{stats.gpu > 0 ? ` · GPU ${stats.gpu.toFixed(1)} ms (${Math.min(100, Math.round((100 * stats.gpu) / Math.max(1, stats.ms)))} % des Bilds)` : ''} · Szene ×{stats.dpr.toFixed(2)} · {stats.calls} Aufrufe
          <br />Welt bis {km(stats.built)} (+{Math.round(stats.built - stats.z)} m) · Nachladen {stats.buildMs.toFixed(2)} ms/Bild · {settings.cycle ? raceRef.current?.moodName : MOODS[settings.mood].name}
        </div>
      ) : null}

      {measuring ? (
        <div className="gpu-rec race-rec">
          <i />
          <span>Messung {Math.floor(recInfo.s / 60)}:{String(Math.floor(recInfo.s % 60)).padStart(2, '0')} · {recInfo.hitches} Ruckler</span>
          <button type="button" onClick={stopMeasure}>Stopp</button>
        </div>
      ) : null}

      {ui === 'countdown' ? (
        <div className="abf-count" aria-live="assertive"><span key={count}>{count > 0 ? count : 'Los!'}</span></div>
      ) : null}

      {ui === 'paused' ? (
        <div className="abf-layer">
          <div className="abf-card abf-scroll race-card">
            <h2 className="abf-title">Pause</h2>
            <button type="button" className="btn btn--primary btn--full" onClick={() => pause(false)}><span>Weiterfahren</span></button>
            <div className="race-row">
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => go(tt ? 0 : cruise)}>Neu starten</button>
              <button type="button" className="btn btn--secondary btn--sm" onClick={toStart}>Zum Start</button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate('/admin')}>Aufhören</button>
            </div>
            {settingsPanel}
          </div>
        </div>
      ) : null}

      {ui === 'ready' ? (
        <div className="abf-layer">
          <button type="button" className="abf-round abf-close" onClick={() => navigate('/admin')} aria-label="Schließen"><Icon name="x" size={20} /></button>
          <div className="abf-card abf-scroll race-card">
            <div className="abf-head">
              <span className="race-badge">GPU</span>
              <div>
                <h1 className="abf-title">{tt ? 'Zeitfahren' : 'Abfahrt'}</h1>
                <p className="abf-sub">{title || (tt ? 'Zeitfahren' : 'Passabfahrt')}{tt ? ` · ${(TT_FINISH / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1 })} km` : ''} · WebGPU · Admin-Test</p>
              </div>
            </div>
            {tt ? (
              <>
                <p className="abf-muted">3 km gegen die Uhr mit der neuen Grafik – Morgendunst, Torbögen, Publikum an Start und Ziel. Die Geister der Runde fahren mit; nichts wird gewertet oder gespeichert.</p>
                <GhostRow ghosts={ghosts} members={members.data ?? []} me={me} loading={ghostQ.loading} />
                <button type="button" className="btn btn--primary btn--full abf-go" onClick={() => go(0)}><span>Auf die Rampe</span></button>
              </>
            ) : (
              <>
                <p className="abf-muted">Das ganze Spiel mit der neuen Grafik: endlose Strecke, Gegner, Flaschen, Hindernisse, Tunnel. Ohne Bestenliste – nichts wird gespeichert.</p>
                <button type="button" className="btn btn--primary btn--full abf-go" onClick={() => go(0)}><span>Losfahren</span></button>
                <div className="abf-cruise">
                  <span className="abf-muted">Testfahrt ohne Hindernisse, Zeitraffer</span>
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => go(2)}>2×</button>
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => go(3)}>3×</button>
                </div>
              </>
            )}
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSheet((s) => !s)}>{sheet ? 'Grafik ausblenden' : 'Grafik und Technik'}</button>
            {sheet ? settingsPanel : null}
          </div>
        </div>
      ) : null}

      {ui === 'over' && tt && ttResult ? (
        <div className="abf-layer">
          <button type="button" className="abf-round abf-close" onClick={() => navigate('/admin')} aria-label="Schließen"><Icon name="x" size={20} /></button>
          <div className="abf-card abf-scroll race-card">
            <span className="abf-eyebrow">{ttResult.dayBest ? 'Tagesbestzeit' : ttResult.pb ? 'Persönliche Bestzeit' : 'Im Ziel'} · zählt nicht</span>
            <div className="race-result">
              <div><strong>{fmtTime(ttResult.timeMs)}</strong><span>Zeit</span></div>
              <div><strong>{ttResult.place}.</strong><span>von {ttResult.riders}</span></div>
              <div><strong>{Math.round(ttResult.topKmh)}</strong><span>km/h max.</span></div>
            </div>
            <p className="abf-muted">
              {ttResult.gapMs === null ? 'Allein gegen die Uhr.' : `${fmtGap(ttResult.gapMs)} ${ttResult.gapMs <= 0 ? 'vor' : 'hinter'} ${firstName(ttResult.leader?.name ?? '')} · Ø ${ttResult.avgKmh.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km/h`}
              {ttResult.reserve > 0.15 ? ` · noch ${Math.round(ttResult.reserve * 100)} % Vorrat im Ziel` : ''}
            </p>
            <ul className="race-parts">
              {[...ttResult.splits, ttResult.timeMs].map((t, i) => <li key={i}><span>{['1 km', '2 km', 'Ziel'][i]}</span><b>{fmtTime(t)}</b></li>)}
            </ul>
            {ttResult.podium.length ? (
              <ul className="race-parts">
                {ttResult.podium.slice(0, 5).map((p, i) => <li key={i} className={cx(p.me && 'is-me')}><span>{i + 1}. {p.name}</span><b>{fmtTime(p.timeMs)}</b></li>)}
              </ul>
            ) : null}
            <button type="button" className="btn btn--primary btn--full abf-go" onClick={() => go(0)}><span>Nochmal</span></button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={toStart}>Zur Rampe</button>
          </div>
        </div>
      ) : null}

      {ui === 'over' && !tt && result ? (
        <div className="abf-layer">
          <button type="button" className="abf-round abf-close" onClick={() => navigate('/admin')} aria-label="Schließen"><Icon name="x" size={20} /></button>
          <div className="abf-card abf-scroll race-card">
            <span className="abf-eyebrow">{cruise ? `Testfahrt ${cruise}× · zählt nicht` : result.reason || 'Fahrt beendet'}</span>
            <div className="race-result">
              <div><strong>{nf(result.score)}</strong><span>Punkte</span></div>
              <div><strong>{km(result.meters)}</strong><span>Strecke</span></div>
              <div><strong>{Math.round(result.topKmh)}</strong><span>km/h max.</span></div>
            </div>
            {result.sectionName ? <p className="abf-muted">Zuletzt: {result.sectionName}</p> : null}
            <ul className="race-parts">
              {ORDER.filter((k) => result.parts[k] > 0).map((k) => <li key={k}><span>{SCORE_LABEL[k]}</span><b>{nf(result.parts[k])}</b></li>)}
            </ul>
            <button type="button" className="btn btn--primary btn--full abf-go" onClick={() => go(0)}><span>Nochmal</span></button>
            <div className="abf-cruise">
              <span className="abf-muted">Testfahrt</span>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => go(2)}>2×</button>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => go(3)}>3×</button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={toStart}>Start</button>
            </div>
          </div>
        </div>
      ) : null}

      {costText ? (
        <div className="gpu-report">
          <strong>Kostenanalyse fertig</strong>
          <pre className="gpu-report__pre">{costText.split('\n').slice(3).join('\n')}</pre>
          <div className="gpu-menu__row gpu-menu__actions">
            <button type="button" className="gpu-chip is-on" onClick={() => { void copyText(costText).then((ok) => setCostCopied(ok)); }}>{costCopied ? 'Kopiert ✓' : 'Ergebnis kopieren'}</button>
            <button type="button" className="gpu-chip" onClick={() => setCostText(null)}>Schließen</button>
          </div>
        </div>
      ) : null}
      {report ? (
        <div className="gpu-report">
          <strong>Messfahrt fertig</strong>
          <div className="gpu-report__grid">
            <span>Dauer</span><b>{report.summary.s.toFixed(0)} s</b>
            <span>Bildrate</span><b>{report.summary.fps.toFixed(0)} fps (Takt {Math.round(1000 / report.summary.period)} Hz)</b>
            <span>1 % langsamste</span><b>{report.summary.low1.toFixed(0)} fps</b>
            <span>Ruckler</span><b>{report.summary.hitches}</b>
            <span>schlimmstes Bild</span><b>{report.summary.worst.toFixed(0)} ms</b>
            <span>CPU (95 %)</span><b>{report.summary.cpuP95.toFixed(1)} ms</b>
            <span>GPU (95 %)</span><b>{report.summary.gpuP95 !== null ? `${report.summary.gpuP95.toFixed(1)} ms` : 'nicht messbar'}</b>
          </div>
          <div className="gpu-menu__row gpu-menu__actions">
            <button type="button" className="gpu-chip is-on" onClick={() => { void copyText(report.text).then((ok) => setCopied(ok)); }}>{copied ? 'Kopiert ✓' : 'Bericht kopieren'}</button>
            <button type="button" className="gpu-chip" onClick={() => { void shareFile(report.full, `abfahrt-gpu-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`); }}>Vollständig als Datei</button>
            <button type="button" className="gpu-chip" onClick={() => setReport(null)}>Schließen</button>
          </div>
        </div>
      ) : null}

      {veil && !error ? (
        <div className={`gpu-load${ui === 'loading' ? '' : ' gpu-load--done'}`}>
          <div className="gpu-load__box">
            <strong>{tt ? 'Zeitfahren' : 'Abfahrt'}</strong>
            <span className="gpu-load__sub">WebGPU · Admin-Test</span>
            <div className="gpu-load__bar"><i style={{ transform: `scaleX(${(stats?.loading ?? 0).toFixed(3)})` }} /></div>
            <span className="gpu-load__stage">{ui === 'loading' ? `${stats?.stage ?? 'WebGPU startet'} … ${pct} %` : 'Los geht’s'}</span>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="gpu-load gpu-load--err">
          <span>{error}</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => navigate('/admin')}>Zurück</button>
        </div>
      ) : null}
    </div>
  );
}

/** Prüfpult der Testfahrt: stehen bleiben, Zeitraffer (wie im Spiel) */
function CruiseBar({ race }: { race: () => Race | null }) {
  const [speed, setSpeed] = useState(() => race()?.dbg?.speed ?? 1);
  const [freeze, setFreeze] = useState(false);
  return (
    <div className="abf-dbg" role="group" aria-label="Prüfpult">
      <button type="button" className={cx('abf-dbg__btn', freeze && 'is-on')} onClick={() => { const d = race()?.dbg; if (!d) return; d.freeze = !d.freeze; setFreeze(d.freeze); }}>{freeze ? '▶' : '⏸'}</button>
      {[1, 2, 3, 5].map((k) => (
        <button key={k} type="button" className={cx('abf-dbg__btn', speed === k && 'is-on')} onClick={() => { const d = race()?.dbg; if (!d) return; d.speed = k; setSpeed(k); }}>{k}×</button>
      ))}
    </div>
  );
}
